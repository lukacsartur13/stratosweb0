// =============================================================================
// POST /api/lead
//
// The only write path from the public site into the database, and the only one
// every public form uses: the newsletter, the contact form, the Impact Program
// application and the questionnaire all arrive here in the same shape.
//
// It exists because the previous arrangement — a Web3Forms access key sitting
// in assets/js/main.js where anyone could read it — gave every visitor a token
// that posts mail as us, with no validation and no ceiling on volume.
//
// Everything the browser sends is treated as hostile: re-validated here, length
// capped, and inserted with an explicit column list so no extra field in the
// payload can reach a column it was not meant to.
// =============================================================================

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const IP_SALT = process.env.IP_HASH_SALT || '';

// message is the widest because the questionnaire posts its whole transcript
// through it — forty-odd labelled answers in one field. It is still a cap.
const MAX = {
  name: 120, company: 160, email: 254, phone: 40, website: 300,
  service_interest: 80, budget_range: 60, timeframe: 60, message: 8000,
};

// Sources the public site actually has forms for. Anything else is stored as
// 'website' rather than trusted into the column.
const SOURCES = new Set(['newsletter', 'contact', 'impact', 'questionnaire', 'website']);

const EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

/** Trim, cap, and drop control characters. */
function clean(value, limit) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, limit);
}

/**
 * In-memory rate limit, per instance.
 *
 * This stops a single client hammering one warm Lambda; it does NOT survive a
 * cold start and does not coordinate across concurrent instances. It is the
 * cheap inner layer. The real ceiling is the Cloudflare rate limiting rule
 * documented in CLOUDFLARE.md, which sees every request before Netlify does.
 */
const hits = new Map();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 5;

function overLimit(key) {
  const now = Date.now();
  const seen = (hits.get(key) || []).filter((t) => now - t < WINDOW_MS);
  seen.push(now);
  hits.set(key, seen);
  if (hits.size > 5000) hits.clear();   // bound the map
  return seen.length > MAX_PER_WINDOW;
}

async function hashIp(ip) {
  if (!ip || !IP_SALT) return null;
  const data = new TextEncoder().encode(`${IP_SALT}:${ip}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

export default async (request) => {
  if (request.method !== 'POST') return json(405, { ok: false, error: 'Method not allowed.' });

  const ip =
    request.headers.get('x-nf-client-connection-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown';

  if (overLimit(ip)) {
    return json(429, { ok: false, error: 'Too many submissions. Please wait a minute.' });
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json(400, { ok: false, error: 'Could not read the submission.' });
  }

  // ---- spam gates -----------------------------------------------------------
  // A field hidden from humans by CSS. Anything filling it in is automated, and
  // gets the same success response a real submission would, so the bot has no
  // signal to tune against.
  if (clean(payload.company_website, 200)) return json(200, { ok: true });

  // Nothing renders, reads and completes this form in under three seconds.
  const elapsed = Number(payload.elapsed_ms);
  if (Number.isFinite(elapsed) && elapsed < 3000) return json(200, { ok: true });

  // ---- validation -----------------------------------------------------------
  const lead = {
    name: clean(payload.name, MAX.name),
    company: clean(payload.company, MAX.company) || null,
    email: clean(payload.email, MAX.email).toLowerCase(),
    phone: clean(payload.phone, MAX.phone) || null,
    website: clean(payload.website, MAX.website) || null,
    service_interest: clean(payload.service_interest, MAX.service_interest) || null,
    budget_range: clean(payload.budget_range, MAX.budget_range) || null,
    timeframe: clean(payload.timeframe, MAX.timeframe) || null,
    message: clean(payload.message, MAX.message) || null,
    source: SOURCES.has(payload.source) ? payload.source : 'website',
    locale: ['hu', 'en', 'de'].includes(payload.locale) ? payload.locale : 'hu',
  };

  const errors = {};
  // A newsletter subscriber gives one thing: an address. Every other form asks
  // for a name and is held to it. The column is NOT NULL, so this source gets a
  // stand-in rather than an exemption from the constraint.
  if (lead.source === 'newsletter') {
    if (!lead.name) lead.name = 'Newsletter subscriber';
  } else if (lead.name.length < 2) {
    errors.name = 'Please give us a name.';
  }
  if (!EMAIL.test(lead.email)) errors.email = 'That email address does not look right.';
  if (Object.keys(errors).length) return json(422, { ok: false, errors });

  // ---- store ----------------------------------------------------------------
  if (!SUPABASE_URL || !SERVICE_KEY) {
    // Misconfiguration is ours, not the visitor's. Log loudly, and tell them
    // something true and useful rather than "500".
    console.error('submit-lead: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing.');
    return json(503, {
      ok: false,
      error: 'The form is temporarily unavailable. Please email lukacs.artur@media-stratos.com.',
    });
  }

  // Imported here rather than at module scope: every rejection above returns
  // without paying for the SDK, and the validation above stays importable —
  // and therefore testable — in a process that has no Supabase client installed.
  const { createClient } = await import('@supabase/supabase-js');

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error } = await supabase.from('leads').insert({
    ...lead,
    ip_hash: await hashIp(ip),
    user_agent: clean(request.headers.get('user-agent') || '', 300) || null,
  });

  if (error) {
    // The Postgres message can name columns and constraints. It belongs in the
    // function log, not in a response body.
    console.error('submit-lead insert failed:', error.message);
    return json(500, {
      ok: false,
      error: 'We could not save that. Please email lukacs.artur@media-stratos.com.',
    });
  }

  return json(200, { ok: true });
};

export const config = { path: '/api/lead' };

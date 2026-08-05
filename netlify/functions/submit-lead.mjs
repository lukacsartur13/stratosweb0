// =============================================================================
// POST /api/lead
//
// The only write path from the public site into the database, and the only one
// every public form uses: the newsletter, the contact form, the Impact Program
// application and the questionnaire all arrive here in the same envelope.
//
//     { submissionId, formType, locale, route, fields, meta }
//
// The shape, the per-form schemas, the field-to-column mapping and the visitor-
// facing copy all live in `lead-contract.mjs`. This file is the transport and
// the store: it decides what to refuse, in what order, and what to say about it.
//
// It exists because the previous arrangement — a Web3Forms access key sitting
// in assets/js/main.js where anyone could read it — gave every visitor a token
// that posts mail as us, with no validation and no ceiling on volume.
//
// Everything the browser sends is treated as hostile. It is re-validated here
// against a closed schema, capped, stripped of anything the schema does not
// declare, and inserted with an explicit column list, so no extra field in the
// payload can reach a column it was not meant to.
//
//
// ORDER OF GATES
// --------------
// Cheapest and most certain first, so a flood costs as little as possible and
// so that nothing expensive runs on a request that was never going to be
// stored:
//
//   1. method            405   not a POST
//   2. content type      415   not JSON
//   3. declared size     413   Content-Length over the ceiling
//   4. rate limit        429   per-IP, per-instance
//   5. actual size       413   measured after reading, before parsing
//   6. JSON parse        400   malformed
//   7. envelope shape    400   bad submissionId / formType / locale / route
//   8. spam gates        200   honeypot or impossible fill time — see below
//   9. field schema      422   with per-field messages
//  10. store            200/500
//
// The spam gates answer 200 with a well-formed success body. That is
// deliberate: a bot that can tell "rejected as spam" from "accepted" can tune
// against the filter, and a filter you can tune against stops working. The
// `leadId` in that response is a fresh UUID that matches no row, which is the
// only way to keep the two responses indistinguishable without storing spam.
// Nothing downstream reads a leadId back, so nothing is misled but the bot.
// =============================================================================

import {
  MAX_BODY_BYTES,
  MIN_FILL_MS,
  clean,
  messagesFor,
  toLeadRow,
  validateEnvelope,
} from './lead-contract.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
// Supabase's newer secret keys (`sb_secret_…`) and the legacy service-role JWT
// are both accepted here and are used the same way: as the server-side key that
// bypasses RLS on the one table the public may write to. Whichever is set, it
// exists only in the Netlify function environment — never in the browser,
// never in generated HTML, never in netlify.toml, never in the repository.
const SERVICE_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const IP_SALT = process.env.IP_HASH_SALT || '';

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

/**
 * How the handler reaches the database.
 *
 * A test seam, and the only one in this file. The two outcomes §6.12 requires
 * cover — a duplicate submissionId and a failed insert — are decided by
 * Postgres, so there is no way to exercise them without either a live database
 * in CI or a way to stand in for one. This is the smaller of the two.
 *
 * `create()` returns null when the function is not configured, which is what
 * the 503 branch reads. Everything else about the store step goes through the
 * returned object, so a test replaces exactly the I/O and nothing else.
 */
export const __store = {
  async create() {
    if (!SUPABASE_URL || !SERVICE_KEY) return null;

    // Imported here rather than at module scope: every rejection above returns
    // without paying for the SDK, and the validation stays importable — and
    // therefore testable — in a process that has no Supabase client installed.
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    return {
      insert: (row) => supabase.from('leads').insert(row).select('id').single(),
      findBySubmissionId: (id) =>
        supabase.from('leads').select('id').eq('submission_id', id).maybeSingle(),
    };
  },
};

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

const fail = (status, code, message, extra) =>
  json(status, { ok: false, code, message, ...extra });

/**
 * The response a silently-dropped submission gets.
 *
 * Byte-for-byte the shape of a real success. See the note at the top of the
 * file: the `leadId` is a fresh UUID that corresponds to no row, and that is
 * the point rather than an oversight.
 */
const dropSilently = (submissionId) =>
  json(200, { ok: true, submissionId, leadId: crypto.randomUUID() });

/**
 * Log a submission without logging what was submitted.
 *
 * Questionnaire payloads carry a business's plans, budget and contact details.
 * None of that belongs in a function log that is readable by anyone with
 * dashboard access and retained on someone else's schedule. Ids, type, timing
 * and outcome are enough to debug a delivery problem; the answers are not.
 */
function audit(event, envelope, extra = {}) {
  console.log(JSON.stringify({
    event,
    submissionId: envelope?.submissionId ?? null,
    formType: envelope?.formType ?? null,
    locale: envelope?.locale ?? null,
    route: envelope?.route ?? null,
    fieldCount: envelope ? Object.keys(envelope.fields).length : 0,
    ...extra,
  }));
}

export default async (request) => {
  // ---- 1. method ------------------------------------------------------------
  // Decided before the locale is known, so the default table is used. A client
  // that cannot manage the right verb is not owed a translated message.
  const en = messagesFor('en');
  if (request.method !== 'POST') {
    return fail(405, 'METHOD_NOT_ALLOWED', en.method);
  }

  // ---- 2. content type ------------------------------------------------------
  const contentType = (request.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('application/json')) {
    return fail(415, 'UNSUPPORTED_MEDIA_TYPE', en.mediaType);
  }

  // ---- 3. declared size -----------------------------------------------------
  // A truthful Content-Length lets us refuse before reading the body at all.
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return fail(413, 'BODY_TOO_LARGE', en.tooLarge);
  }

  // ---- 4. rate limit --------------------------------------------------------
  const ip =
    request.headers.get('x-nf-client-connection-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown';

  if (overLimit(ip)) {
    return fail(429, 'RATE_LIMITED', en.limited);
  }

  // ---- 5. actual size, then 6. parse ---------------------------------------
  // Content-Length can lie or be absent, so the body is measured as read.
  let raw;
  try {
    raw = await request.text();
  } catch {
    return fail(400, 'MALFORMED_JSON', en.malformed);
  }
  if (raw.length > MAX_BODY_BYTES) {
    return fail(413, 'BODY_TOO_LARGE', en.tooLarge);
  }

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return fail(400, 'MALFORMED_JSON', en.malformed);
  }

  // Chosen from the untrusted body only to pick a language for the error text.
  // `validateEnvelope` re-checks it against the allow-list before it is stored.
  const t = messagesFor(clean(body?.locale, 5));

  // ---- 7. envelope shape, 9. field schema ----------------------------------
  const result = validateEnvelope(body, t);

  // ---- 8. spam gates --------------------------------------------------------
  // Run against the raw body, before the schema verdict, so a bot that also
  // fills a required field wrong still gets the indistinguishable 200 rather
  // than a 422 that tells it which field to fix.
  //
  // The honeypot is a field hidden from humans by CSS. It lives in `meta`, not
  // in `fields`, so it can never be declared by a schema and can never reach a
  // column even by accident.
  const submissionId = clean(body?.submissionId, 64).toLowerCase() || crypto.randomUUID();

  if (clean(body?.meta?.botField, 200)) {
    audit('drop.honeypot', null, { submissionId });
    return dropSilently(submissionId);
  }

  const elapsed = Number(body?.meta?.elapsedMs);
  if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < MIN_FILL_MS) {
    audit('drop.tooFast', null, { submissionId, elapsedMs: Math.round(elapsed) });
    return dropSilently(submissionId);
  }

  if (!result.ok) {
    const { code, message, errors } = result;
    const status = code === 'VALIDATION_FAILED' ? 422
      : code === 'UNSUPPORTED_FORM_TYPE' ? 422
        : 400;
    audit('reject', null, { submissionId, code });
    return fail(status, code, message, errors ? { errors } : undefined);
  }

  const { envelope } = result;

  // ---- 10. store ------------------------------------------------------------
  const store = await __store.create();
  if (!store) {
    // Misconfiguration is ours, not the visitor's. Log loudly, and tell them
    // something true and useful rather than "500".
    console.error('submit-lead: SUPABASE_URL or the Supabase secret key is missing.');
    return fail(503, 'SERVICE_UNAVAILABLE', t.unavailable);
  }

  const row = {
    ...toLeadRow(envelope),
    ip_hash: await hashIp(ip),
    user_agent: clean(request.headers.get('user-agent') || '', 300) || null,
  };

  if (envelope.dropped.length) {
    audit('fields.dropped', envelope, { dropped: envelope.dropped });
  }

  const { data, error } = await store.insert(row);

  if (!error) {
    audit('stored', envelope, { leadId: data.id });
    return json(200, { ok: true, submissionId: envelope.submissionId, leadId: data.id });
  }

  // ---- idempotency ----------------------------------------------------------
  // 23505 is unique_violation. The only unique constraint this insert can hit
  // is `leads_submission_id_key`, so reaching here means this exact submission
  // was already stored — a retry after a timeout, a double-fired submit, or a
  // visitor who pressed the button again on a flaky connection.
  //
  // The guarantee is Postgres's, not this function's: two concurrent inserts of
  // the same submissionId cannot both succeed, whichever instance is serving
  // them. The loser reads the winner's row back and reports the same success.
  if (error.code === '23505') {
    const { data: existing } = await store.findBySubmissionId(envelope.submissionId);

    audit('idempotent.replay', envelope, { leadId: existing?.id ?? null });
    return json(200, {
      ok: true,
      submissionId: envelope.submissionId,
      leadId: existing?.id ?? null,
      duplicate: true,
    });
  }

  // The Postgres message can name columns and constraints. It belongs in the
  // function log, not in a response body.
  console.error('submit-lead insert failed:', error.code, error.message);
  return fail(500, 'STORE_FAILED', t.storeFailed);
};

export const config = { path: '/api/lead' };

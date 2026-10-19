// =============================================================================
// /api/newsletter/* — the links in the newsletter's e-mails, Resend's webhook,
// and the Portal's preview and test (20261019000100_newsletter.sql)
//
//   GET  confirm?t=…&l=hu        a page with ONE button; nothing changes yet
//   POST confirm                 (form: t) confirms, sends the welcome e-mail
//   GET  unsubscribe?t=…&l=hu    a page with ONE button
//   POST unsubscribe             form (t, a=leave|rejoin) — or the mail app's
//                                own button (RFC 8058: the body is
//                                `List-Unsubscribe=One-Click`, the token in
//                                the address), which leaves at once
//   POST webhook                 Resend: a hard bounce or a spam complaint
//                                takes the address off the list
//   POST preview | test          Portal admins (Bearer = their session): the
//                                campaign rendered, or sent to themselves
//
// Why a button and not the link itself: mail scanners open links, they do not
// press buttons. A link that subscribed on GET would let a scanner confirm an
// address its owner never saw; one that unsubscribed would empty the list.
//
// Configuration: newsletter-core.mjs, plus SUPABASE_ANON_KEY for the Portal's
// two. Nothing personal is logged.
// =============================================================================
import { TOKEN_RE, campaignEmail, page, pickLang, verifyWebhook } from './newsletter-lib.mjs';
import { __net, confirm, mailConfig, originOf, resubscribe, sendOne, serverDb, unsubscribe } from './newsletter-core.mjs';

const env = (k) => (typeof process !== 'undefined' ? process.env[k] : undefined);
const MAX_BODY = 64 * 1024;

const CSP = "default-src 'none'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";
const html = (status, body) => new Response(body, {
  status,
  headers: {
    'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer',
    'x-robots-tag': 'noindex, nofollow', 'content-security-policy': CSP, 'x-content-type-options': 'nosniff',
  },
});
const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});

// Per instance, like /api/lead: the cheap inner layer under Cloudflare's rule.
// A token is 256 bits; this is about load, not guessing.
const hits = new Map();
export function overLimit(key, now = Date.now(), max = 30, windowMs = 10 * 60_000) {
  const seen = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  seen.push(now);
  hits.set(key, seen);
  if (hits.size > 5000) hits.clear();
  return seen.length > max;
}
export const __resetLimits = () => hits.clear();

async function readForm(req) {
  const text = await req.text();
  if (text.length > MAX_BODY) return null;
  return new URLSearchParams(text);
}

/** The person behind a Portal session, if they are an admin: their e-mail. */
async function adminEmail(req, c) {
  const token = /^Bearer\s+(.+)$/i.exec(req.headers.get('authorization') || '')?.[1];
  if (!token || !c.supabase || !c.publicKey) return { status: 401 };
  const asUser = { apikey: c.publicKey, authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  try {
    const me = await __net.fetch(`${c.supabase}/auth/v1/user`, { headers: asUser });
    const user = me.ok ? await me.json() : null;
    if (!user?.id || !user.email) return { status: 401 };
    const admin = await __net.fetch(`${c.supabase}/rest/v1/rpc/is_admin`, { method: 'POST', headers: asUser, body: '{}' });
    if (!admin.ok || (await admin.json()) !== true) return { status: 403 };
    return { status: 200, email: user.email };
  } catch {
    return { status: 502 };
  }
}

export function makeHandler({ db, mail, origin, creds = {}, webhookSecret = null, now = () => Date.now() }) {
  return async (req) => {
    const url = new URL(req.url);
    const route = url.pathname.replace(/^\/api\/newsletter\/?/, '').replace(/\/+$/, '');
    const ip = req.headers.get('x-nf-client-connection-ip') || req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const lang = pickLang(url.searchParams.get('l'));

    try {
      /* ------------------------------------------------ confirm */
      if (route === 'confirm') {
        if (overLimit(`page:${ip}`, now())) return html(429, page({ lang, state: 'error', origin }));
        if (req.method === 'GET') {
          const t = url.searchParams.get('t') || '';
          if (!TOKEN_RE.test(t)) return html(200, page({ lang, state: 'confirm_unknown', origin }));
          return html(200, page({ lang, state: 'confirm_ask', origin, form: { action: `/api/newsletter/confirm?l=${lang}`, fields: { t } } }));
        }
        if (req.method !== 'POST') return html(405, page({ lang, state: 'error', origin }));
        const form = await readForm(req);
        const t = form?.get('t') || url.searchParams.get('t') || '';
        if (!TOKEN_RE.test(t)) return html(200, page({ lang, state: 'confirm_unknown', origin }));
        if (!db) return html(503, page({ lang, state: 'error', origin }));
        const r = await confirm(db, mail, { token: t, origin });
        console.log('[newsletter] confirm', r.state);
        return html(r.state === 'error' ? 503 : 200, page({ lang: r.lang ?? lang, state: r.state, origin }));
      }

      /* -------------------------------------------- unsubscribe */
      if (route === 'unsubscribe') {
        if (overLimit(`page:${ip}`, now())) return html(429, page({ lang, state: 'error', origin }));
        if (req.method === 'GET') {
          const t = url.searchParams.get('t') || '';
          if (!TOKEN_RE.test(t)) return html(200, page({ lang, state: 'unsubscribe_unknown', origin }));
          return html(200, page({ lang, state: 'unsubscribe_ask', origin, form: { action: `/api/newsletter/unsubscribe?l=${lang}`, fields: { t, a: 'leave' } } }));
        }
        if (req.method !== 'POST') return html(405, page({ lang, state: 'error', origin }));
        const form = await readForm(req);
        // RFC 8058: the mail app posts exactly this, to the address in the header.
        if (form?.get('List-Unsubscribe') === 'One-Click') {
          const t = url.searchParams.get('t') || '';
          if (!TOKEN_RE.test(t) || !db) return new Response(null, { status: TOKEN_RE.test(t) ? 503 : 400 });
          const r = await unsubscribe(db, { token: t, how: 'one_click' });
          console.log('[newsletter] one-click', r.state);
          return new Response(null, { status: r.state === 'error' ? 503 : 200 });
        }
        const t = form?.get('t') || url.searchParams.get('t') || '';
        if (!TOKEN_RE.test(t)) return html(200, page({ lang, state: 'unsubscribe_unknown', origin }));
        if (!db) return html(503, page({ lang, state: 'error', origin }));
        if (form?.get('a') === 'rejoin') {
          const r = await resubscribe(db, { token: t });
          console.log('[newsletter] rejoin', r.state);
          return html(r.state === 'error' ? 503 : 200, page({ lang: r.lang ?? lang, state: r.state, origin }));
        }
        const r = await unsubscribe(db, { token: t, how: 'link' });
        console.log('[newsletter] unsubscribe', r.state);
        const l = r.lang ?? lang;
        return html(r.state === 'error' ? 503 : 200, page({
          lang: l, state: r.state, origin,
          // "I clicked by mistake": the same token, straight back.
          form: r.state === 'unsubscribe_done' ? { action: `/api/newsletter/unsubscribe?l=${l}`, fields: { t, a: 'rejoin' } } : null,
        }));
      }

      /* ------------------------------------------------ webhook */
      if (route === 'webhook') {
        if (req.method !== 'POST') return json(405, { ok: false, code: 'METHOD' });
        if (!webhookSecret || !db) return json(503, { ok: false, code: 'NOT_CONFIGURED' });
        const body = await req.text();
        if (body.length > MAX_BODY) return json(413, { ok: false, code: 'TOO_LARGE' });
        const signed = verifyWebhook({
          secret: webhookSecret, body, now: now(),
          id: req.headers.get('svix-id'), timestamp: req.headers.get('svix-timestamp'), signature: req.headers.get('svix-signature'),
        });
        if (!signed) return json(401, { ok: false, code: 'SIGNATURE' });
        let event;
        try { event = JSON.parse(body); } catch { return json(400, { ok: false, code: 'JSON' }); }
        const reason = event?.type === 'email.complained' ? 'complained'
          // A transient bounce (a full mailbox, a server down) is not a reason to drop anyone.
          : event?.type === 'email.bounced' && event?.data?.bounce?.type !== 'Transient' ? 'bounced'
            : null;
        if (!reason) return json(200, { ok: true, ignored: true });
        const to = [].concat(event?.data?.to ?? []).filter((x) => typeof x === 'string').slice(0, 50);
        let listed = 0;
        for (const address of to) {
          const r = await db.rpc('newsletter_suppress', { p_email: address, p_reason: reason });
          if (r.error) return json(503, { ok: false, code: 'DATABASE' });   // Resend retries
          if (r.data === true) listed += 1;
        }
        console.log('[newsletter] webhook', reason, listed);
        return json(200, { ok: true, listed });
      }

      /* --------------------------------- the Portal's preview and test */
      if (route === 'preview' || route === 'test') {
        if (req.method !== 'POST') return json(405, { ok: false, code: 'METHOD' });
        if (!(req.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) return json(415, { ok: false, code: 'CONTENT_TYPE' });
        const who = await adminEmail(req, creds);
        if (who.status !== 200) return json(who.status, { ok: false, code: who.status === 403 ? 'FORBIDDEN' : who.status === 502 ? 'UNREACHABLE' : 'UNAUTHORIZED' });
        const text = await req.text();
        if (text.length > MAX_BODY) return json(413, { ok: false, code: 'TOO_LARGE' });
        let body;
        try { body = JSON.parse(text); } catch { return json(400, { ok: false, code: 'JSON' }); }
        const subject = String(body?.subject ?? '').trim();
        const content = String(body?.body ?? '');
        const preheader = String(body?.preheader ?? '').trim();
        if (!subject || subject.length > 200 || !content.trim() || content.length > 50_000 || preheader.length > 200) {
          return json(422, { ok: false, code: 'INVALID' });
        }
        // A real-looking but dead unsubscribe link: the test reader is not on the list.
        const msg = campaignEmail({
          lang: pickLang(body?.locale), origin, subject, preheader, body: content,
          unsubscribeToken: '0'.repeat(64), test: route === 'test',
        });
        if (route === 'preview') return json(200, { ok: true, subject: msg.subject, html: msg.html, text: msg.text });
        if (!mail?.key) return json(503, { ok: false, code: 'NOT_CONFIGURED' });
        const sent = await sendOne(mail, who.email, { ...msg, subject: `[TEST] ${msg.subject}`.slice(0, 200) });
        if (!sent.ok) { console.error('[newsletter] test', sent.error); return json(502, { ok: false, code: 'SEND_FAILED' }); }
        return json(200, { ok: true, to: who.email });
      }

      return json(404, { ok: false, code: 'NOT_FOUND' });
    } catch (e) {
      console.error('[newsletter] failed', String(e?.name ?? 'error'));
      return route === 'confirm' || route === 'unsubscribe'
        ? html(500, page({ lang, state: 'error', origin }))
        : json(500, { ok: false, code: 'FAILED' });
    }
  };
}

export default async (req) => makeHandler({
  db: serverDb(),
  mail: mailConfig(),
  origin: originOf(),
  creds: {
    supabase: (env('SUPABASE_URL') || env('VITE_SUPABASE_URL') || '').replace(/\/+$/, ''),
    publicKey: env('SUPABASE_ANON_KEY') || env('VITE_SUPABASE_ANON_KEY'),
  },
  webhookSecret: env('RESEND_WEBHOOK_SECRET') || null,
})(req);

export const config = { path: '/api/newsletter/*' };

// =============================================================================
// The newsletter's moving parts (20261019000100_newsletter.sql): sending
// through Resend, and every step that sends — a signup, a confirmation click,
// leaving, a bounce, and the dispatcher's minute. The words are in
// newsletter-lib.mjs; the HTTP side is newsletter.mjs; the schedule is
// newsletter-dispatch.mjs; a signup arrives through submit-lead.mjs.
//
// `db` is anything with `rpc(name, args) → { data, error }` — PostgREST in
// production (restRpc below), PGlite in the tests. `mail` is mailConfig().
//
// Configuration (Netlify → Environment variables, Functions scope):
//   RESEND_API_KEY        without it nothing is sent (logged); signups are
//                         still stored and retried by the dispatcher
//   NEWSLETTER_FROM       default: Stratos <hirlevel@stratosweb.hu>
//   NEWSLETTER_REPLY_TO   default: hello@stratosweb.hu
//   RESEND_WEBHOOK_SECRET bounces and complaints (newsletter.mjs)
//   SUPABASE_URL + SUPABASE_SECRET_KEY / SUPABASE_SERVICE_ROLE_KEY
//   PORTAL_ORIGIN or URL  the links in the e-mails
//
// Nothing personal is logged: outcomes, counts and HTTP statuses only.
// =============================================================================
import { createHash } from 'node:crypto';
import { campaignEmail, confirmationEmail, pickLang, welcomeEmail } from './newsletter-lib.mjs';

const env = (k) => (typeof process !== 'undefined' ? process.env[k] : undefined);
export const __net = { fetch: (...args) => globalThis.fetch(...args) };
export const sha = (s) => createHash('sha256').update(String(s)).digest('hex');

export function mailConfig() {
  return {
    key: env('RESEND_API_KEY') || null,
    from: env('NEWSLETTER_FROM') || 'Stratos <hirlevel@stratosweb.hu>',
    replyTo: env('NEWSLETTER_REPLY_TO') || 'hello@stratosweb.hu',
  };
}

export const originOf = () => (env('PORTAL_ORIGIN') || env('URL') || 'https://stratosweb.hu').replace(/\/+$/, '');

/** The database through PostgREST with the server key. Never throws. */
export function restRpc({ url, key }) {
  return {
    async rpc(fn, args = {}) {
      try {
        const res = await __net.fetch(`${url}/rest/v1/rpc/${fn}`, {
          method: 'POST',
          headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
          body: JSON.stringify(args),
          signal: AbortSignal.timeout(8000),
        });
        const text = await res.text();
        let body = null;
        try { body = text ? JSON.parse(text) : null; } catch { body = null; }
        return res.ok ? { data: body, error: null } : { data: null, error: { code: body?.code ?? String(res.status), message: body?.message ?? '' } };
      } catch (e) {
        return { data: null, error: { code: 'NETWORK', message: String(e?.name ?? e) } };
      }
    },
  };
}

export function serverDb() {
  const url = (env('SUPABASE_URL') || env('VITE_SUPABASE_URL') || '').replace(/\/+$/, '');
  const key = env('SUPABASE_SECRET_KEY') || env('SUPABASE_SERVICE_ROLE_KEY');
  return url && key ? restRpc({ url, key }) : null;
}

/* =============================================================== sending */

const toResend = (mail, to, msg) => ({
  from: mail.from, reply_to: mail.replyTo, to: [to],
  subject: msg.subject, html: msg.html, text: msg.text,
  ...(Object.keys(msg.headers ?? {}).length ? { headers: msg.headers } : {}),
});

async function post(mail, path, payload, idempotencyKey, timeoutMs) {
  if (!mail?.key) return { ok: false, status: 0, error: 'RESEND_API_KEY is not set' };
  try {
    const res = await __net.fetch(`https://api.resend.com${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${mail.key}`, 'Content-Type': 'application/json',
        // Resend answers a repeated key (24 h) with the first answer and sends
        // nothing again — so a retry after a timeout cannot double a mail.
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.ok) return { ok: true, status: res.status };
    return { ok: false, status: res.status, error: `resend ${res.status}` };
  } catch (e) {
    return { ok: false, status: 0, error: `resend ${e?.name === 'TimeoutError' ? 'timeout' : 'network'}` };
  }
}

/** One e-mail. → { ok, status, error? } */
export const sendOne = (mail, to, msg, { idempotencyKey, timeoutMs = 8000 } = {}) =>
  post(mail, '/emails', toResend(mail, to, msg), idempotencyKey, timeoutMs);

/** Up to 100 e-mails in one call. → { ok, status, error? } */
export const sendBatch = (mail, items, { idempotencyKey, timeoutMs = 20000 } = {}) =>
  post(mail, '/emails/batch', items.map(({ to, msg }) => toResend(mail, to, msg)), idempotencyKey, timeoutMs);

/* ================================================================ steps */

/**
 * A signup from a public form (submit-lead.mjs, after the lead is stored).
 * Never throws: the visitor's answer does not depend on it. A confirmation
 * that could not be sent stays due, and the dispatcher retries it.
 */
export async function subscribe(db, mail, { email, locale, source, route = null, ipHash = null, origin }) {
  try {
    const r = await db.rpc('newsletter_subscribe', {
      p_email: email, p_locale: pickLang(locale), p_source: source, p_route: route, p_ip_hash: ipHash,
    });
    if (r.error) return { outcome: 'error', code: r.error.code };
    const row = Array.isArray(r.data) ? r.data[0] : null;
    if (!row || row.outcome !== 'send') return { outcome: row?.outcome ?? 'error' };
    const msg = confirmationEmail({ lang: row.locale, origin, token: row.token });
    const sent = await sendOne(mail, row.email, msg, { idempotencyKey: `nl-confirm/${sha(row.token)}`, timeoutMs: 4000 });
    await db.rpc('newsletter_confirmation_done', { p_id: row.subscriber_id, p_error: sent.ok ? null : sent.error });
    return { outcome: 'send', sent: sent.ok, status: sent.status };
  } catch (e) {
    return { outcome: 'error', code: String(e?.name ?? 'error') };
  }
}

async function sendWelcome(db, mail, { id, email, locale, unsubscribeToken, origin }) {
  const msg = welcomeEmail({ lang: locale, origin, unsubscribeToken });
  const sent = await sendOne(mail, email, msg, { idempotencyKey: `nl-welcome/${id}`, timeoutMs: 6000 });
  await db.rpc('newsletter_welcome_done', { p_id: id, p_error: sent.ok ? null : sent.error });
  return sent.ok;
}

const CONFIRM_STATE = { confirmed: 'confirm_done', already: 'confirm_already', expired: 'confirm_expired', unknown: 'confirm_unknown' };

/** The confirmation button. → { state, lang } for newsletter-lib's page(). */
export async function confirm(db, mail, { token, origin }) {
  const r = await db.rpc('newsletter_confirm', { p_token: token });
  if (r.error) return { state: 'error', lang: null };
  const row = Array.isArray(r.data) ? r.data[0] : null;
  if (!row) return { state: 'confirm_unknown', lang: null };
  if (row.outcome === 'confirmed') {
    await sendWelcome(db, mail, { id: row.subscriber_id, email: row.email, locale: row.locale, unsubscribeToken: row.unsubscribe_token, origin });
  }
  return { state: CONFIRM_STATE[row.outcome] ?? 'confirm_unknown', lang: row.locale ?? null };
}

/** The unsubscribe link's button, or a mail app's one-click (`how`). */
export async function unsubscribe(db, { token, how = 'link' }) {
  const r = await db.rpc('newsletter_unsubscribe', { p_token: token, p_how: how });
  if (r.error) return { state: 'error', lang: null };
  const row = Array.isArray(r.data) ? r.data[0] : null;
  return { state: `unsubscribe_${row?.outcome === 'done' || row?.outcome === 'already' ? row.outcome : 'unknown'}`, lang: row?.locale ?? null };
}

export async function resubscribe(db, { token }) {
  const r = await db.rpc('newsletter_resubscribe', { p_token: token });
  if (r.error) return { state: 'error', lang: null };
  const row = Array.isArray(r.data) ? r.data[0] : null;
  return { state: row?.outcome === 'done' ? 'resubscribe_done' : 'resubscribe_no', lang: row?.locale ?? null };
}

/* ============================================================ dispatcher */

const BATCH = 100;      // Resend's batch ceiling
const BATCHES = 5;      // campaign batches per run: 500 e-mails a minute at most
// Resend's default rate limit is two requests a second; a run makes at most
// seven, one after another, this far apart.
export const __pace = { ms: 600, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };

/** Send a claimed list as one batch; report each row's fate to `done`. */
export async function batch(mail, rows, build, key, done) {
  const sent = await sendBatch(mail, rows.map(build), { idempotencyKey: key });
  await done(sent.ok ? null : sent.error);
  await __pace.sleep(__pace.ms);
  return sent;
}

/**
 * One run (every minute): the 30-day clean-up, confirmations and welcomes
 * that are due, then campaigns in batches of 100. A 429 from Resend (rate
 * limit or the plan's daily quota) ends the run; a campaign batch goes back
 * to the queue without spending an attempt. Exported for the tests.
 */
export async function dispatch(db, mail, { origin }) {
  const out = { purged: 0, confirmations: 0, welcomes: 0, sent: 0, failed: 0, released: 0, closed: 0 };

  const purged = await db.rpc('newsletter_purge');
  if (purged.error) {
    // Not installed (or the database is down): nothing else can work either.
    console.error('[newsletter] purge', purged.error.code);
    return { ...out, error: purged.error.code };
  }
  out.purged = Number(purged.data) || 0;

  if (!mail?.key) {
    console.error('[newsletter] RESEND_API_KEY is not set: nothing sent');
    return { ...out, error: 'NO_KEY' };
  }

  const confirmations = (await db.rpc('newsletter_confirmations_due', { p_limit: BATCH })).data ?? [];
  if (confirmations.length) {
    const sent = await batch(mail, confirmations,
      (r) => ({ to: r.email, msg: confirmationEmail({ lang: r.locale, origin, token: r.token }) }),
      `nl-confirm-batch/${sha(confirmations.map((r) => r.token).join(','))}`,
      async (error) => { for (const r of confirmations) await db.rpc('newsletter_confirmation_done', { p_id: r.subscriber_id, p_error: error }); });
    if (sent.ok) out.confirmations = confirmations.length;
    if (sent.status === 429) return finish(db, out, 'rate limited');
  }

  const welcomes = (await db.rpc('newsletter_welcomes_due', { p_limit: BATCH })).data ?? [];
  if (welcomes.length) {
    const sent = await batch(mail, welcomes,
      (r) => ({ to: r.email, msg: welcomeEmail({ lang: r.locale, origin, unsubscribeToken: r.unsubscribe_token }) }),
      `nl-welcome-batch/${sha(welcomes.map((r) => r.subscriber_id).join(','))}`,
      async (error) => { for (const r of welcomes) await db.rpc('newsletter_welcome_done', { p_id: r.subscriber_id, p_error: error }); });
    if (sent.ok) out.welcomes = welcomes.length;
    if (sent.status === 429) return finish(db, out, 'rate limited');
  }

  for (let i = 0; i < BATCHES; i += 1) {
    const claimed = await db.rpc('newsletter_claim_deliveries', { p_limit: BATCH });
    if (claimed.error) { console.error('[newsletter] claim', claimed.error.code); break; }
    const rows = claimed.data ?? [];
    if (rows.length === 0) break;
    const ids = rows.map((r) => r.delivery_id);
    let result = 'sent';
    const sent = await batch(mail, rows,
      (r) => ({ to: r.email, msg: campaignEmail({ lang: r.locale, origin, subject: r.subject, preheader: r.preheader, body: r.body, unsubscribeToken: r.unsubscribe_token }) }),
      `nl-batch/${sha(ids.join(','))}`,
      async (error) => {
        result = error === null ? 'sent' : (/ 429$/.test(error) ? 'released' : 'failed');
        await db.rpc('newsletter_deliveries_done', { p_ids: ids, p_result: result, p_error: error });
      });
    if (result === 'sent') out.sent += ids.length;
    else if (result === 'released') { out.released += ids.length; return finish(db, out, 'rate limited'); }
    else { out.failed += ids.length; console.error('[newsletter] batch', sent.error); }
  }
  return finish(db, out);
}

async function finish(db, out, note) {
  const settled = await db.rpc('newsletter_campaigns_settle');
  out.closed = Number(settled.data) || 0;
  if (note) out.note = note;
  if (out.purged || out.confirmations || out.welcomes || out.sent || out.failed || out.released || out.closed) {
    console.log('[newsletter]', JSON.stringify(out));
  }
  return out;
}

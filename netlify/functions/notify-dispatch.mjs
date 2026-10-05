// =============================================================================
// Every minute: send what is waiting in `notification_outbox`
// (20261013000100_notifications.sql).
//
//   owner messages    to the owner and every admin (20261013000200): push to
//                     every device they registered, and an e-mail unless they
//                     turned e-mails off in Settings
//   client messages   an e-mail to every client the database names as a
//                     recipient AT SEND TIME (active account, still has the
//                     project, and — if the owner named accounts — one of those)
//   (and, first, the automations and the quarterly satisfaction surveys that are due)
//
// Several messages to one person in one run become ONE e-mail and ONE push.
// Each message is then marked sent, or given back with its error (the database
// retries it on a later run, five attempts in all).
//
// Configuration (Netlify → Environment variables, Functions scope):
//   RESEND_API_KEY       e-mail; without it nothing is e-mailed (logged)
//   VAPID_PRIVATE_KEY    push;  without it nothing is pushed (logged)
//   NOTIFY_FROM          default: Stratos <portal@stratosweb.hu>
//   NOTIFY_REPLY_TO      default: lukacs.artur@media-stratos.com
//   SUPABASE_URL + SUPABASE_SECRET_KEY / SUPABASE_SERVICE_ROLE_KEY (as for the other functions)
//   PORTAL_ORIGIN or URL  the links in the messages
//
// Nothing personal is logged: counts, kinds and HTTP statuses only.
// =============================================================================
import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';
import { compose, pickLang } from './notify-templates.mjs';

export const VAPID_PUBLIC_KEY = 'BOa0bTvJd819zVBs0Ze0RpdvLzQPTt3G55Dtx00THYrs2hjesLhRneKODO7kxIgcablM2tYhLppE9RRBciFKCSg';

const env = (k) => (typeof process !== 'undefined' ? process.env[k] : undefined);

export const __net = { fetch: (...args) => globalThis.fetch(...args) };

/** One e-mail through Resend. Returns null or an error string. */
async function sendEmail({ to, subject, text, html }) {
  const key = env('RESEND_API_KEY');
  if (!key) return 'RESEND_API_KEY is not set';
  const res = await __net.fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env('NOTIFY_FROM') || 'Stratos <portal@stratosweb.hu>',
      reply_to: env('NOTIFY_REPLY_TO') || 'lukacs.artur@media-stratos.com',
      to: [to], subject, text, html,
    }),
  });
  if (res.ok) return null;
  return `resend ${res.status}`;
}

/** Push to every device of `userIds`; drops devices the push service says are gone. */
async function sendPush(db, userIds, payload) {
  const priv = env('VAPID_PRIVATE_KEY');
  if (!priv || userIds.length === 0) return { sent: 0, skipped: !priv };
  webpush.setVapidDetails(`mailto:${env('NOTIFY_REPLY_TO') || 'lukacs.artur@media-stratos.com'}`, VAPID_PUBLIC_KEY, priv);
  const { data: subs, error } = await db.from('push_subscriptions').select('id, endpoint, p256dh, auth, failures').in('user_id', userIds);
  if (error) { console.error('[notify] push_subscriptions', error.code); return { sent: 0 }; }
  let sent = 0;
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 24 * 3600 });
      sent += 1;
      await db.from('push_subscriptions').update({ last_success_at: new Date().toISOString(), failures: 0 }).eq('id', s.id);
    } catch (e) {
      const status = e?.statusCode;
      console.error('[notify] push', status ?? 'error');
      if (status === 404 || status === 410 || (s.failures ?? 0) >= 9) await db.from('push_subscriptions').delete().eq('id', s.id);
      else await db.from('push_subscriptions').update({ failures: (s.failures ?? 0) + 1 }).eq('id', s.id);
    }
  }
  return { sent };
}

/** One run. Exported for the tests, which pass a fake database. */
export async function dispatch(db, { origin }) {
  // In a quarter's last month: the satisfaction survey of each running monthly
  // contract (20261014000100). Idempotent; its e-mails are claimed just below.
  // The automations (20261015000100): alerts on Today, and their notifications
  // queued for this same run.
  const auto = await db.rpc('automation_run');
  if (auto.error) console.error('[notify] automation_run', auto.error.code);
  else if (auto.data) console.log('[notify] automation alerts', auto.data);

  const due = await db.rpc('survey_quarterly_due');
  if (due.error) console.error('[notify] survey_quarterly_due', due.error.code);
  else if (due.data) console.log('[notify] quarterly surveys', due.data);

  const { data: rows, error } = await db.rpc('notification_claim', { p_limit: 50 });
  if (error) { console.error('[notify] claim', error.code, error.message); return { messages: 0, error: error.code }; }
  if (!rows || rows.length === 0) return { messages: 0 };

  // Who did it, for the owner's lines ("Kovács Anna uploaded a file").
  const accountIds = [...new Set(rows.map((r) => r.payload?.account_id).filter(Boolean))];
  const names = new Map();
  if (accountIds.length > 0) {
    const { data } = await db.from('client_accounts').select('id, full_name').in('id', accountIds);
    for (const a of data ?? []) names.set(a.id, a.full_name);
  }

  // Group by recipient: one e-mail and one push per person per run.
  const byPerson = new Map();
  for (const r of rows) {
    const payload = { ...(r.payload ?? {}), client_name: names.get(r.payload?.account_id) ?? null };
    for (const p of r.recipients ?? []) {
      if (!p?.email) continue;
      const key = `${r.audience}|${p.email.toLowerCase()}`;
      const entry = byPerson.get(key) ?? { audience: r.audience, person: p, messages: [] };
      entry.messages.push({ ...r, payload });
      byPerson.set(key, entry);
    }
  }

  const failed = new Map(); // message id → error
  let emails = 0;
  let pushes = 0;
  for (const { audience, person, messages } of byPerson.values()) {
    const lang = pickLang(person.locale, audience === 'client' ? 'hu' : 'en');
    const msg = compose(messages, { audience, lang, name: person.name, origin });
    const wantsMail = audience === 'client' || person.email_on !== false;
    const mailError = wantsMail ? await sendEmail({ to: person.email, subject: msg.subject, text: msg.text, html: msg.html }) : null;
    if (!wantsMail) {
      // E-mails off (Settings): push only.
    } else if (mailError) {
      console.error('[notify] email', audience, mailError);
      // A test, and owner messages, still count as delivered when the push went out.
      if (audience === 'client') for (const m of messages) failed.set(m.id, mailError);
    } else {
      emails += 1;
    }
    if (audience === 'owner' && person.user_id) {
      const r = await sendPush(db, [person.user_id], msg.push);
      pushes += r.sent;
      if (mailError && r.sent === 0) for (const m of messages) failed.set(m.id, mailError);
    }
  }

  for (const r of rows) await db.rpc('notification_done', { p_id: r.id, p_error: failed.get(r.id) ?? null });
  console.log('[notify]', JSON.stringify({ messages: rows.length, people: byPerson.size, emails, pushes, failed: failed.size }));
  return { messages: rows.length, people: byPerson.size, emails, pushes, failed: failed.size };
}

export default async () => {
  const url = (env('SUPABASE_URL') || env('VITE_SUPABASE_URL') || '').replace(/\/+$/, '');
  const key = env('SUPABASE_SECRET_KEY') || env('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) { console.error('[notify] Supabase is not configured'); return new Response(null, { status: 204 }); }
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const origin = (env('PORTAL_ORIGIN') || env('URL') || 'https://stratosweb.hu').replace(/\/+$/, '');
  await dispatch(db, { origin });
  return new Response(null, { status: 204 });
};

// Every minute (Netlify Scheduled Functions; runs on the published deploy only).
export const config = { schedule: '* * * * *' };

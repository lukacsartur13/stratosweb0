// =============================================================================
// The automatic e-mails (20261019000200_email_automations.sql):
//
//   sendReceipt              "we have it" — from submit-lead.mjs, after a
//                            contact form, quote questionnaire or Impact
//                            application is stored; one per address per day
//   dispatchBookingReminders about a day before a booked call
//   dispatchSeries           the welcome series, step by step
//   announce                 new articles and case studies on the site's list
//                            become campaigns (sent by `dispatch`)
//
// The last three run every minute from newsletter-dispatch.mjs (announce
// every ten). The words are in newsletter-lib.mjs. Transactional mail — the
// receipt and the reminder — comes from the Portal's sender; the series is
// newsletter, from the newsletter's.
//
// Configuration: as newsletter-core.mjs; NOTIFY_FROM (default
// Stratos <portal@stratosweb.hu>) for the transactional two.
// Nothing personal is logged.
// =============================================================================
import { announcement, bookingReminder, campaignEmail, pickLang, receiptEmail } from './newsletter-lib.mjs';
import { __net, batch, sendOne, sha } from './newsletter-core.mjs';

const env = (k) => (typeof process !== 'undefined' ? process.env[k] : undefined);

/** The sender of the transactional mail: the Portal's, replies to hello@. */
export function transactionalMail() {
  return {
    key: env('RESEND_API_KEY') || null,
    from: env('NOTIFY_FROM') || 'Stratos <portal@stratosweb.hu>',
    replyTo: 'hello@stratosweb.hu',
  };
}

export const RECEIPT_FORMS = ['contact', 'questionnaire', 'impact'];

/**
 * "We have it." Never throws, capped at 4 s: the visitor's answer does not
 * wait on it and does not change with it. Not sent when this address already
 * sent a form in the last 24 hours (the database counts).
 */
export async function sendReceipt(db, mail, { leadId, email, formType, locale, origin }) {
  try {
    if (!RECEIPT_FORMS.includes(formType) || !email) return { sent: false, reason: 'not_applicable' };
    const allowed = await db.rpc('lead_confirmation_allowed', { p_email: email });
    if (allowed.error) return { sent: false, reason: 'database' };
    if (allowed.data !== true) return { sent: false, reason: 'already_today' };
    const msg = receiptEmail({ lang: pickLang(locale), origin, formType });
    const r = await sendOne(mail, email, msg, { idempotencyKey: `lead-receipt/${leadId}`, timeoutMs: 4000 });
    return { sent: r.ok, reason: r.ok ? 'sent' : r.error };
  } catch (e) {
    return { sent: false, reason: String(e?.name ?? 'error') };
  }
}

/** Calls in the next 24 hours, one batch. */
export async function dispatchBookingReminders(db, mail, { origin }) {
  if (!mail?.key) return { reminders: 0, error: 'NO_KEY' };
  const due = await db.rpc('booking_reminders_due', { p_limit: 100 });
  if (due.error) {
    // 42883 / PGRST202: not installed yet. Quiet, like the other queues.
    if (!['42883', 'PGRST202'].includes(due.error.code)) console.error('[mail] booking reminders', due.error.code);
    return { reminders: 0, error: due.error.code };
  }
  const rows = due.data ?? [];
  if (!rows.length) return { reminders: 0 };
  const sent = await batch(mail, rows,
    (r) => ({ to: r.email, msg: bookingReminder({ lang: r.locale, origin, kind: r.kind, startsAt: r.starts_at, timeZone: r.time_zone, meetUrl: r.meet_url }) }),
    `booking-reminder/${sha(rows.map((r) => `${r.booking_id}@${r.starts_at}`).join(','))}`,
    async (error) => { for (const r of rows) await db.rpc('booking_reminder_done', { p_id: r.booking_id, p_error: error }); });
  const out = { reminders: sent.ok ? rows.length : 0, ...(sent.ok ? {} : { error: sent.error }) };
  console.log('[mail] booking reminders', JSON.stringify(out));
  return out;
}

/** The welcome series' due steps, one batch. */
export async function dispatchSeries(db, mail, { origin }) {
  if (!mail?.key) return { series: 0, error: 'NO_KEY' };
  const due = await db.rpc('newsletter_series_due', { p_limit: 100 });
  if (due.error) {
    if (!['42883', 'PGRST202'].includes(due.error.code)) console.error('[mail] series', due.error.code);
    return { series: 0, error: due.error.code };
  }
  const rows = due.data ?? [];
  if (!rows.length) return { series: 0 };
  const sent = await batch(mail, rows,
    (r) => ({ to: r.email, msg: campaignEmail({ lang: r.locale, origin, subject: r.subject, preheader: r.preheader, body: r.body, unsubscribeToken: r.unsubscribe_token }) }),
    `series/${sha(rows.map((r) => `${r.subscriber_id}#${r.step}`).join(','))}`,
    async (error) => { for (const r of rows) await db.rpc('newsletter_series_done', { p_id: r.subscriber_id, p_position: r.step, p_error: error }); });
  const out = { series: sent.ok ? rows.length : 0, ...(sent.ok ? {} : { error: sent.error }) };
  console.log('[mail] series', JSON.stringify(out));
  return out;
}

export const FEED_PATH = '/assets/data/newsletter-feed.json';

/**
 * Read the site's list of articles and case studies (written by the build,
 * _build/build.py write_newsletter_feed) and hand it to the database, which
 * remembers what it has seen and makes the campaigns (newsletter_announce).
 * A list that cannot be read is no news: nothing happens.
 */
export async function announce(db, { origin }) {
  let feed;
  try {
    const res = await __net.fetch(`${origin}${FEED_PATH}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { campaigns: 0, error: `feed ${res.status}` };
    feed = await res.json();
  } catch (e) {
    return { campaigns: 0, error: 'feed unreadable' };
  }
  const items = (Array.isArray(feed?.items) ? feed.items : [])
    .filter((i) => typeof i?.key === 'string' && (i.type === 'post' || i.type === 'case'))
    .map((i) => ({ key: i.key, type: i.type, campaigns: announcement(i, origin) }));
  if (!items.length) return { campaigns: 0 };
  const r = await db.rpc('newsletter_announce', { p_items: items });
  if (r.error) {
    if (!['42883', 'PGRST202'].includes(r.error.code)) console.error('[mail] announce', r.error.code);
    return { campaigns: 0, error: r.error.code };
  }
  const made = Number(r.data) || 0;
  if (made) console.log('[mail] announced', made);
  return { campaigns: made };
}

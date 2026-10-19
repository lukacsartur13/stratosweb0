// =============================================================================
// Every minute: the newsletter's queue (20261019000100_newsletter.sql) —
// unconfirmed requests older than 30 days deleted, confirmation and welcome
// e-mails whose first try failed, and the campaigns being sent, 500 e-mails a
// run at most — and the automatic e-mails (20261019000200): new articles and
// case studies announced (every ten minutes), the welcome series, and the
// reminders before booked calls. The work is `dispatch` in newsletter-core.mjs
// and the rest in mail-automations.mjs.
// =============================================================================
import { dispatch, mailConfig, originOf, serverDb } from './newsletter-core.mjs';
import { announce, dispatchBookingReminders, dispatchSeries, transactionalMail } from './mail-automations.mjs';

export default async () => {
  const db = serverDb();
  if (!db) { console.error('[newsletter] Supabase is not configured'); return new Response(null, { status: 204 }); }
  const origin = originOf();
  // First, so that a new article's campaigns go out in this same run.
  if (new Date().getUTCMinutes() % 10 === 0) await announce(db, { origin });
  await dispatch(db, mailConfig(), { origin });
  await dispatchSeries(db, mailConfig(), { origin });
  await dispatchBookingReminders(db, transactionalMail(), { origin });
  return new Response(null, { status: 204 });
};

// Netlify Scheduled Functions; runs on the published deploy only.
export const config = { schedule: '* * * * *' };

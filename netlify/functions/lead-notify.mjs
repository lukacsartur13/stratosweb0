// =============================================================================
// "A lead arrived." — Phase 9, Workstream K.
//
// Not a handler. A module `submit-lead.mjs` calls once, after a row exists.
//
// THE GAP THIS CLOSES
// -------------------
// Until now a submission was stored and nobody was told. The Portal was the
// only place a new enquiry appeared, so an enquiry was seen when someone
// happened to log in — against a footer that promises a reply within a few
// hours. The audit called it the most consequential operational gap in the
// phase, and it was an operational gap rather than a bug: nothing was broken,
// nothing logged an error, and the lead was safely in the database the whole
// time.
//
// THE VENDOR IS THE OWNER'S CHOICE
// --------------------------------
// Phase 9 forbade picking a production notification vendor without approval,
// and rightly: the choice has cost, data-processing and legal-basis
// consequences that belong to the site owner rather than to this file.
//
// So the transport is an env var. 'webhook' is a plain JSON POST, which is
// what Slack, Discord, a Zapier or Make hook, a CRM endpoint and a self-hosted
// receiver all accept. 'email' (the owner's choice, 2026-10-18) is one e-mail
// to the company inbox through Resend — the vendor the Portal's own e-mails
// already go through — carrying exactly the same fields. Choosing none is the
// default, and the default is what ships.
//
//     LEAD_NOTIFY_TRANSPORT   'none' (default) | 'webhook' | 'email'
//     LEAD_NOTIFY_WEBHOOK_URL an https:// endpoint            (webhook)
//     LEAD_NOTIFY_EMAIL_TO    e.g. hello@stratosweb.hu        (email)
//     RESEND_API_KEY          as for notify-dispatch.mjs      (email)
//     NOTIFY_FROM             default: Stratos <portal@stratosweb.hu>
//
// WHAT IT SENDS, AND EVERYTHING IT DOES NOT
// -----------------------------------------
// Identifiers, form type, locale, route, timestamp, and a link to the Portal.
//
// **No personal data at all.** Not the name, not the email address, not the
// phone number, not the message, and not one questionnaire answer. The brief
// requires the full questionnaire payload be kept out; this goes further and
// keeps everything out, because the destination is an unknown third party —
// whichever one the owner eventually picks — with its own retention, its own
// access model and its own breach surface. A notification is a doorbell. It
// does not need to read the letter, and the Portal, which is authenticated and
// covered by the privacy policy, is where the letter is read.
//
// That also keeps this module out of the processor argument in the privacy
// policy: an endpoint that receives "a contact form was submitted from /kkv.html
// in Hungarian" receives no personal data to process.
// =============================================================================

const TRANSPORT = process.env.LEAD_NOTIFY_TRANSPORT || 'none';
const WEBHOOK_URL = process.env.LEAD_NOTIFY_WEBHOOK_URL || '';
const EMAIL_TO = (process.env.LEAD_NOTIFY_EMAIL_TO || '').trim();
const RESEND_KEY = process.env.RESEND_API_KEY || '';
// The Portal's sender (notify-dispatch.mjs), duplicated for the same reason
// `portalUrl()` below is: this module is bundled on its own.
const EMAIL_FROM = process.env.NOTIFY_FROM || 'Stratos <portal@stratosweb.hu>';
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * How long a notification may delay the visitor's response.
 *
 * It delays it at all only because a Netlify function stops executing when it
 * returns — there is no reliable "after the response" in this runtime, so
 * fire-and-forget would mean fire-and-usually-never. Two seconds is the ceiling
 * on that borrowed time; past it the visitor's success message matters more
 * than the doorbell, and the abort below is what enforces it.
 */
const TIMEOUT_MS = 2000;

/** Nothing here is a secret, but a URL with a token in its path is common. */
const redact = (url) => {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return '(unparseable)';
  }
};

/**
 * Where the Portal lives, for the link in the notification.
 *
 * Resolved the same way `scripts/site-origin.mjs` resolves it, and duplicated
 * rather than imported on purpose: Netlify bundles this directory, and a
 * function that reaches up into `scripts/` for four lines is a function that
 * breaks the first time the bundler is stricter about it. If the rule ever
 * changes in more than one place, that file is the one that is right.
 */
function portalUrl() {
  const origin = (process.env.SITE_URL || process.env.URL || 'https://stratosweb.hu')
    .trim().replace(/\/+$/, '');
  return `${origin}/portal/leads`;
}

/**
 * The message body. Exported so the suite can assert what is in it — and, more
 * usefully, what is not.
 *
 * `text` is a courtesy: Slack and Discord render a bare `text` field without
 * any mapping configuration, so the commonest destinations work with a URL and
 * nothing else. Everything is also present as a field, for a destination that
 * wants to parse rather than display.
 */
export function buildNotification({ leadId, submissionId, formType, locale, route }) {
  return {
    type: 'lead.created',
    leadId: leadId ?? null,
    submissionId: submissionId ?? null,
    formType: formType ?? null,
    locale: locale ?? null,
    route: route ?? null,
    receivedAt: new Date().toISOString(),
    portalUrl: portalUrl(),
    text: `New ${formType || 'lead'} from ${route || 'the site'} (${locale || '—'}). `
      + 'Open the Portal to read it — this message deliberately carries no personal data.',
  };
}

/**
 * The e-mail: the notification above, as words. Built from `buildNotification`
 * and nothing else, so it carries exactly the same closed set of fields — no
 * personal data. Hungarian, because it goes to the company inbox. Exported for
 * the suite.
 */
export function buildEmail(summary) {
  const n = buildNotification(summary);
  const when = new Date(n.receivedAt).toLocaleString('hu-HU', { timeZone: 'Europe/Budapest' });
  return {
    subject: `Új beküldés a weboldalról: ${n.formType || 'űrlap'} (${n.locale || '—'})`,
    text: [
      'Új beküldés érkezett a weboldalról.',
      '',
      `Űrlap: ${n.formType || '—'}`,
      `Nyelv: ${n.locale || '—'}`,
      `Oldal: ${n.route || '—'}`,
      `Időpont: ${when}`,
      `Azonosító: ${n.leadId || '—'}`,
      '',
      `Megnyitás a Portálban: ${n.portalUrl}`,
      '',
      'Ez a levél szándékosan nem tartalmaz személyes adatot; a beküldés a Portálban olvasható.',
    ].join('\n'),
    leadId: n.leadId,
    formType: n.formType,
  };
}

/** The 'email' transport. Same contract as the webhook: never throws. */
async function sendEmail(summary) {
  if (!RESEND_KEY) {
    console.error('lead-notify: LEAD_NOTIFY_TRANSPORT is "email" but RESEND_API_KEY is not set. '
      + 'Nothing was sent.');
    return { sent: false, reason: 'no-key' };
  }
  if (!EMAIL_RE.test(EMAIL_TO)) {
    console.error('lead-notify: LEAD_NOTIFY_EMAIL_TO is not an e-mail address. Nothing was sent.');
    return { sent: false, reason: 'bad-address' };
  }

  const mail = buildEmail(summary);

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${RESEND_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: EMAIL_FROM, to: [EMAIL_TO], subject: mail.subject, text: mail.text }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
      console.error(`lead-notify: resend answered ${res.status} for lead ${mail.leadId}. `
        + 'The lead is stored; the notification is not.');
      return { sent: false, reason: `status-${res.status}` };
    }

    console.log(JSON.stringify({ event: 'notify.sent', leadId: mail.leadId, formType: mail.formType }));
    return { sent: true, reason: 'ok' };
  } catch (error) {
    console.error(`lead-notify: could not reach resend for lead ${mail.leadId} — ${error.name}. `
      + 'The lead is stored; the notification is not.');
    return { sent: false, reason: error.name === 'TimeoutError' ? 'timeout' : 'unreachable' };
  }
}

/**
 * Tell someone. Never throw, never reject, never take longer than TIMEOUT_MS.
 *
 * THE ONE RULE THIS MODULE HAS
 * ----------------------------
 * A notification failure must never affect a stored lead. The row is already
 * committed before this is called; the visitor has already been told it worked,
 * because it did. So every failure below — no transport, bad URL, DNS failure,
 * a 500 from the destination, a timeout — is logged and swallowed, and the
 * caller is given a result it is free to ignore.
 *
 * The failure this protects against is specific and has happened to other
 * people: a `throw` here, inside the handler's success path, would turn a
 * stored lead into a 500 for the visitor, who would submit again, and the
 * second submission would be deduplicated by `submissionId`… or not, if they
 * reloaded first. A doorbell that can eat the post is worse than no doorbell.
 *
 * @returns {Promise<{ sent: boolean, reason: string }>}
 */
export async function notifyLeadCreated(summary) {
  if (TRANSPORT === 'none') {
    return { sent: false, reason: 'disabled' };
  }

  if (TRANSPORT === 'email') {
    return sendEmail(summary);
  }

  if (TRANSPORT !== 'webhook') {
    console.error(`lead-notify: unknown LEAD_NOTIFY_TRANSPORT ${JSON.stringify(TRANSPORT)}; `
      + 'expected "none", "webhook" or "email". Nothing was sent.');
    return { sent: false, reason: 'unknown-transport' };
  }

  // https only. A misconfigured http endpoint would put the route, the locale
  // and the lead id on the wire in clear — not a disaster, and not something to
  // do by accident either.
  let target;
  try {
    target = new URL(WEBHOOK_URL);
  } catch {
    console.error('lead-notify: LEAD_NOTIFY_WEBHOOK_URL is not a URL. Nothing was sent.');
    return { sent: false, reason: 'bad-url' };
  }
  if (target.protocol !== 'https:') {
    console.error(`lead-notify: LEAD_NOTIFY_WEBHOOK_URL must be https, got ${target.protocol}. `
      + 'Nothing was sent.');
    return { sent: false, reason: 'not-https' };
  }

  const body = buildNotification(summary);

  try {
    const res = await fetch(target.href, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
      console.error(`lead-notify: ${redact(target.href)} answered ${res.status} `
        + `for lead ${body.leadId}. The lead is stored; the notification is not.`);
      return { sent: false, reason: `status-${res.status}` };
    }

    console.log(JSON.stringify({
      event: 'notify.sent', leadId: body.leadId, formType: body.formType,
    }));
    return { sent: true, reason: 'ok' };
  } catch (error) {
    // `AbortSignal.timeout` rejects with a TimeoutError; everything else is a
    // network fault. Both are the same to the caller and neither is the
    // visitor's problem.
    console.error(`lead-notify: could not reach ${redact(target.href)} for lead ${body.leadId} `
      + `— ${error.name}. The lead is stored; the notification is not.`);
    return { sent: false, reason: error.name === 'TimeoutError' ? 'timeout' : 'unreachable' };
  }
}

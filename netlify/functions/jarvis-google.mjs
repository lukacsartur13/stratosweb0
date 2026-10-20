// =============================================================================
// Jarvis — Google, for the external tools (JARVIS_SPEC.md §3, phase 6)
//
//   googleToken   an access token for ONE person's own Google account
//   gapi          one Google API call
//   draftRaw      a plain-text e-mail as Gmail's `raw` (RFC 2822, base64url)
//
// The refresh token is sealed (google-lib.mjs, GOOGLE_TOKEN_KEY) and its
// column is readable by no API role at all, not even by its owner
// (20261017000100_google.sql). So this is the one read in Jarvis that uses the
// server key: the row of the person the request was verified for (GoTrue, in
// jarvis.mjs), and nothing else — the same read google-sync.mjs and
// booking.mjs make. It runs only when a person approves an external action
// (jarvis-writes.mjs decide), as that person.
// =============================================================================
import { accessToken, openToken } from './google-lib.mjs';
import { __net, UUID, cfg } from './jarvis-lib.mjs';

const env = (k) => (typeof process !== 'undefined' ? process.env[k] : undefined);

/** A refusal worded for the person and for Jarvis. */
export class GoogleError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const SCOPE_WORDS = {
  'https://www.googleapis.com/auth/gmail.compose': 'manage Gmail drafts',
  'https://www.googleapis.com/auth/calendar.events': 'manage Calendar events',
};

/** An access token for `userId`'s own Google account, if it allows `scope`. Throws GoogleError. */
export async function googleToken(userId, scope) {
  const c = cfg();
  const serverKey = env('SUPABASE_SECRET_KEY') || env('SUPABASE_SERVICE_ROLE_KEY');
  const creds = { clientId: env('GOOGLE_CLIENT_ID'), clientSecret: env('GOOGLE_CLIENT_SECRET') };
  if (!serverKey || !creds.clientId || !creds.clientSecret || !env('GOOGLE_TOKEN_KEY')) {
    throw new GoogleError('GOOGLE_NOT_CONFIGURED', 'Google is not set up on this deployment.');
  }
  if (!UUID.test(String(userId ?? ''))) throw new GoogleError('GOOGLE_NOT_CONNECTED', 'No Google account is connected.');
  const res = await __net.fetch(`${c.supabase}/rest/v1/google_accounts?select=google_email,scopes,refresh_token_enc,last_error&user_id=eq.${userId}`, {
    headers: { apikey: serverKey, authorization: `Bearer ${serverKey}` }, signal: AbortSignal.timeout(9000),
  });
  const rows = res.ok ? await res.json().catch(() => []) : [];
  const account = Array.isArray(rows) ? rows[0] : null;
  if (!account) throw new GoogleError('GOOGLE_NOT_CONNECTED', 'No Google account is connected: connect Google in the Portal\'s Settings first.');
  const allowed = String(account.scopes ?? '').split(/\s+/).includes(scope);
  if (account.last_error === 'revoked' || !allowed) {
    throw new GoogleError('GOOGLE_RECONNECT', `Google does not allow this yet: connect Google again in Settings and allow it to ${SCOPE_WORDS[scope] ?? 'do this'}.`);
  }
  try {
    return { token: await accessToken({ refreshToken: openToken(account.refresh_token_enc), ...creds }), email: account.google_email };
  } catch (e) {
    if (String(e?.message) === 'revoked') throw new GoogleError('GOOGLE_RECONNECT', 'Google no longer accepts this connection: connect Google again in Settings.');
    throw new GoogleError('GOOGLE_UNREACHABLE', 'Google could not be reached. Try again.');
  }
}

/** One Google API call → { ok, status, body }. */
export async function gapi(token, url, init = {}) {
  const res = await __net.fetch(url, {
    ...init, signal: AbortSignal.timeout(12000),
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  const text = await res.text().catch(() => '');
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  return { ok: res.ok, status: res.status, body };
}

/** A header value: plain ASCII as it is, anything else as an RFC 2047 encoded word. Never a line break. */
const headerText = (s) => {
  const one = String(s).replace(/[\r\n]+/g, ' ').trim();
  return /^[\x20-\x7e]*$/.test(one) ? one : `=?UTF-8?B?${Buffer.from(one, 'utf8').toString('base64')}?=`;
};

/** A plain-text e-mail as Gmail's `raw`: To, Cc, Subject, the body in UTF-8. Gmail adds From. */
export function draftRaw({ to, cc = [], subject, body }) {
  const lines = [
    `To: ${to.join(', ')}`,
    ...(cc.length ? [`Cc: ${cc.join(', ')}`] : []),
    `Subject: ${headerText(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
  ];
  const encoded = Buffer.from(String(body).replace(/\r?\n/g, '\r\n'), 'utf8').toString('base64').replace(/.{1,76}/g, '$&\r\n');
  return Buffer.from(`${lines.join('\r\n')}\r\n\r\n${encoded}`, 'utf8').toString('base64url');
}

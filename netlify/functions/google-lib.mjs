// =============================================================================
// Google — what google-oauth.mjs and google-sync.mjs share
// (20261017000100_google.sql). Pure except for `__net`, which the tests replace.
//
//   sealToken / openToken   AES-256-GCM with GOOGLE_TOKEN_KEY (32 bytes, base64):
//                           the refresh token is never stored in clear
//   signState / readState   the OAuth `state`: who started it and until when,
//                           HMAC-signed with the same key — a callback cannot
//                           attach an account to anybody else
//   accessToken             a fresh access token from a refresh token
//   parseAddresses          "Name <a@b>, c@d" → [{ email, name }]
//   eventBody               a Portal meeting as a Google Calendar event
// =============================================================================
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const SCOPES = [
  'openid', 'email',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar.events',
];
export const REDIRECT_PATH = '/api/google-oauth';

export const __net = { fetch: (...args) => globalThis.fetch(...args) };

const env = (k) => (typeof process !== 'undefined' ? process.env[k] : undefined);
const b64u = (buf) => Buffer.from(buf).toString('base64url');

function key() {
  const raw = env('GOOGLE_TOKEN_KEY');
  if (!raw) throw new Error('GOOGLE_TOKEN_KEY is not set');
  const k = Buffer.from(raw, 'base64');
  if (k.length !== 32) throw new Error('GOOGLE_TOKEN_KEY must be 32 bytes, base64');
  return k;
}

export function sealToken(plain) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return `v1.${b64u(iv)}.${b64u(c.getAuthTag())}.${b64u(body)}`;
}

export function openToken(sealed) {
  const [v, iv, tag, body] = String(sealed).split('.');
  if (v !== 'v1' || !iv || !tag || !body) throw new Error('not a sealed token');
  const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(body, 'base64url')), d.final()]).toString('utf8');
}

const mac = (data) => createHmac('sha256', key()).update(`google-state:${data}`).digest();

/** `state` for the consent screen: the user, an expiry (10 minutes), a nonce. */
export function signState(userId, now = Date.now()) {
  const data = b64u(JSON.stringify({ u: userId, e: now + 10 * 60_000, n: b64u(randomBytes(9)) }));
  return `${data}.${b64u(mac(data))}`;
}

/** The user id in a valid, unexpired state; null otherwise. */
export function readState(state, now = Date.now()) {
  const [data, sig] = String(state ?? '').split('.');
  if (!data || !sig) return null;
  const want = mac(data);
  const got = Buffer.from(sig, 'base64url');
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const { u, e } = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    return typeof u === 'string' && typeof e === 'number' && e > now ? u : null;
  } catch {
    return null;
  }
}

export function consentUrl({ clientId, origin, state, loginHint }) {
  const q = new URLSearchParams({
    client_id: clientId, redirect_uri: `${origin}${REDIRECT_PATH}`, response_type: 'code', scope: SCOPES.join(' '),
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state,
  });
  if (loginHint) q.set('login_hint', loginHint);
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

/** Code → tokens. Returns { refresh_token, access_token, email, scope } or throws with a short reason. */
export async function exchangeCode({ code, clientId, clientSecret, origin }) {
  const res = await __net.fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: `${origin}${REDIRECT_PATH}`, grant_type: 'authorization_code' }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`token ${res.status} ${body.error ?? ''}`.trim());
  if (!body.refresh_token) throw new Error('no refresh token');
  // The id_token came straight from Google's token endpoint over TLS: its
  // payload is read, not re-verified.
  const payload = JSON.parse(Buffer.from(String(body.id_token ?? '').split('.')[1] ?? '', 'base64url').toString('utf8') || '{}');
  return { refresh_token: body.refresh_token, access_token: body.access_token, email: String(payload.email ?? ''), scope: String(body.scope ?? '') };
}

/** Refresh token → access token. Throws Error('revoked') when Google says the grant is gone. */
export async function accessToken({ refreshToken, clientId, clientSecret }) {
  const res = await __net.fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret, grant_type: 'refresh_token' }),
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 400 && body.error === 'invalid_grant') throw new Error('revoked');
  if (!res.ok || !body.access_token) throw new Error(`refresh ${res.status}`);
  return body.access_token;
}

/** "Anna <a@b.hu>, c@d.hu" → [{ email: 'a@b.hu', name: 'Anna' }, { email: 'c@d.hu', name: null }] */
export function parseAddresses(header) {
  const out = [];
  for (const part of String(header ?? '').split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)) {
    const m = /^\s*(?:"?([^"<]*?)"?\s*)?<([^<>\s]+@[^<>\s]+)>\s*$/.exec(part) ?? /^\s*([^\s<>,]+@[^\s<>,]+)\s*$/.exec(part);
    if (!m) continue;
    const email = (m[2] ?? m[1]).toLowerCase();
    const name = m[2] ? (m[1] || '').trim() || null : null;
    out.push({ email, name });
  }
  return out;
}

/** A Portal meeting (google_sync_targets row) as a Calendar event. */
export function eventBody(m, { origin }) {
  const lines = [m.note, m.join_url ? `${m.join_url}` : null, `${origin}/portal/projects`].filter(Boolean);
  const body = {
    summary: m.project_name ? `${m.title} — ${m.project_name}` : m.title,
    description: lines.join('\n\n'),
    location: m.location || (m.join_url ?? undefined),
    start: { dateTime: new Date(m.starts_at).toISOString(), timeZone: m.time_zone },
    end: { dateTime: new Date(m.ends_at).toISOString(), timeZone: m.time_zone },
    attendees: (m.invite ?? []).map((email) => ({ email })),
    source: { title: 'Stratos', url: `${origin}/portal/` },
  };
  if (m.want_meet && !m.join_url) {
    body.conferenceData = { createRequest: { requestId: `${m.meeting_id}-${new Date(m.dirty_at ?? Date.now()).getTime()}`, conferenceSolutionKey: { type: 'hangoutsMeet' } } };
  }
  return body;
}

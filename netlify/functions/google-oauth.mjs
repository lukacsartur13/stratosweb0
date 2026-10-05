// =============================================================================
// /api/google-oauth — connecting a person's own Google account
// (20261017000100_google.sql)
//
//   POST {action:'start'}       (Bearer = the person's Supabase session)
//        → { url } of Google's consent screen. Admins only. The `state` names
//          the person and expires in 10 minutes (HMAC, google-lib.mjs).
//   GET  ?code=…&state=…        Google's redirect after consent
//        → stores the account with the refresh token SEALED, then back to
//          /portal/settings?google=connected (or ?google=error&reason=…)
//   POST {action:'disconnect'}  (Bearer) → revokes the grant at Google and
//          deletes the row.
//
// Configuration (Netlify, Functions scope): GOOGLE_CLIENT_ID,
// GOOGLE_CLIENT_SECRET, GOOGLE_TOKEN_KEY; SUPABASE_URL + the public and the
// server key, as for the other functions; PORTAL_ORIGIN or URL.
// Nothing secret is logged or returned.
// =============================================================================
import { __net, consentUrl, exchangeCode, openToken, readState, sealToken, signState } from './google-lib.mjs';

const env = (k) => (typeof process !== 'undefined' ? process.env[k] : undefined);
const cfg = () => ({
  supabase: (env('SUPABASE_URL') || env('VITE_SUPABASE_URL') || '').replace(/\/+$/, ''),
  publicKey: env('SUPABASE_ANON_KEY') || env('VITE_SUPABASE_ANON_KEY'),
  serverKey: env('SUPABASE_SECRET_KEY') || env('SUPABASE_SERVICE_ROLE_KEY'),
  clientId: env('GOOGLE_CLIENT_ID'),
  clientSecret: env('GOOGLE_CLIENT_SECRET'),
  origin: (env('PORTAL_ORIGIN') || env('URL') || 'https://stratosweb.hu').replace(/\/+$/, ''),
});

const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store, max-age=0' },
});
const back = (origin, query) => new Response(null, { status: 302, headers: { location: `${origin}/portal/settings?${query}`, 'cache-control': 'no-store' } });

async function call(url, init) {
  const res = await __net.fetch(url, init);
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  return { ok: res.ok, status: res.status, body };
}

/** The signed-in person behind a session token, if they are an admin. */
async function admin(c, token) {
  if (!token) return null;
  const me = await call(`${c.supabase}/auth/v1/user`, { headers: { apikey: c.publicKey, authorization: `Bearer ${token}` } });
  if (!me.ok || !me.body?.id) return null;
  const ok = await call(`${c.supabase}/rest/v1/rpc/is_admin`, {
    method: 'POST', headers: { apikey: c.publicKey, authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{}',
  });
  return ok.ok && ok.body === true ? { id: me.body.id, email: me.body.email ?? null } : null;
}

const asServer = (c) => ({ apikey: c.serverKey, authorization: `Bearer ${c.serverKey}`, 'content-type': 'application/json' });

export default async (req) => {
  const c = cfg();
  if (!c.supabase || !c.publicKey || !c.serverKey) return json(503, { ok: false, code: 'NOT_CONFIGURED' });
  if (!c.clientId || !c.clientSecret || !env('GOOGLE_TOKEN_KEY')) return json(503, { ok: false, code: 'GOOGLE_NOT_CONFIGURED' });
  const url = new URL(req.url);

  // ------------------------------------------------------ Google's redirect
  if (req.method === 'GET') {
    if (url.searchParams.get('error')) return back(c.origin, 'google=error&reason=declined');
    const userId = readState(url.searchParams.get('state'));
    const code = url.searchParams.get('code');
    if (!userId || !code) return back(c.origin, 'google=error&reason=expired');
    try {
      const t = await exchangeCode({ code, clientId: c.clientId, clientSecret: c.clientSecret, origin: c.origin });
      const saved = await call(`${c.supabase}/rest/v1/google_accounts`, {
        method: 'POST',
        headers: { ...asServer(c), prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({
          user_id: userId, google_email: t.email.slice(0, 320), scopes: t.scope.slice(0, 2000),
          refresh_token_enc: sealToken(t.refresh_token), connected_at: new Date().toISOString(), last_error: null,
          gmail_synced_at: null, calendar_synced_at: null,
        }),
      });
      if (!saved.ok) { console.error('[google-oauth] save', saved.status); return back(c.origin, 'google=error&reason=save'); }
      // The meetings this person made go into their calendar from now on.
      await call(`${c.supabase}/rest/v1/project_meetings?created_by=eq.${userId}&ends_at=gt.${encodeURIComponent(new Date().toISOString())}`, {
        method: 'PATCH', headers: { ...asServer(c), prefer: 'return=minimal' }, body: JSON.stringify({ google_dirty_at: new Date().toISOString() }),
      });
      return back(c.origin, 'google=connected');
    } catch (e) {
      console.error('[google-oauth] exchange', String(e?.message ?? e).slice(0, 60));
      return back(c.origin, `google=error&reason=${/no refresh token/.test(String(e?.message)) ? 'norefresh' : 'exchange'}`);
    }
  }

  if (req.method !== 'POST') return json(405, { ok: false, code: 'METHOD' });
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const who = await admin(c, token);
  if (!who) return json(403, { ok: false, code: 'FORBIDDEN' });
  let input = {};
  try { input = JSON.parse((await req.text()).slice(0, 2000) || '{}'); } catch { input = {}; }

  if (input.action === 'start') {
    return json(200, { ok: true, url: consentUrl({ clientId: c.clientId, origin: c.origin, state: signState(who.id), loginHint: who.email }) });
  }

  if (input.action === 'disconnect') {
    const row = await call(`${c.supabase}/rest/v1/google_accounts?user_id=eq.${who.id}&select=refresh_token_enc`, { headers: asServer(c) });
    const sealed = Array.isArray(row.body) ? row.body[0]?.refresh_token_enc : null;
    if (sealed) {
      try {
        await __net.fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(openToken(sealed))}`, {
          method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        });
      } catch { /* already gone at Google: deleting the row is what matters */ }
    }
    const del = await call(`${c.supabase}/rest/v1/google_accounts?user_id=eq.${who.id}`, { method: 'DELETE', headers: { ...asServer(c), prefer: 'return=minimal' } });
    return del.ok ? json(200, { ok: true }) : json(502, { ok: false, code: 'DELETE_FAILED' });
  }

  return json(400, { ok: false, code: 'ACTION' });
};

export const config = { path: '/api/google-oauth' };

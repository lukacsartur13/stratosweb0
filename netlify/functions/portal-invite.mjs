// =============================================================================
// POST /api/portal-invite
//
// The owner invites a client account: creates (or finds) the auth user and
// returns ONE sign-in link for the owner to send by hand. No e-mail is sent —
// Supabase's `generate_link` only generates (supabase.com/docs →
// auth.admin.generateLink: "does not send emails").
//
// WHO MAY CALL IT
// ---------------
// Only the designated portal owner: the caller's own JWT is verified with
// GoTrue, then `is_owner()` is asked WITH THAT JWT. Everything the database
// does for the invite runs as the owner too (client_invite_prepare /
// client_invite_attach, SECURITY INVOKER, owner-only). The server key is used
// for exactly two things the owner's token cannot do: finding an existing auth
// user by e-mail, and generating the link (which creates the user if needed).
//
// THE ORDER, AND WHY A RETRY IS SAFE
// ----------------------------------
//   1. prepare   (DB, as owner) — the account row, the requested projects, the
//                limits, and the refusals: a staff address, another company.
//                Idempotent per e-mail. Opens nothing yet.
//   2. user      (Auth) — the existing profile for that e-mail, or a new auth
//                user created by generate_link(invite).
//   3. attach    (DB, as owner) — links the account to that user ONLY if the
//                user's profile has that e-mail, is a plain client and belongs
//                to no other company. From here the client has access.
//   4. link      (Auth) — invite (not yet confirmed) or recovery (confirmed).
//
// A failure after 2 leaves an auth user with no access at all (the account
// opens nothing until 3). Calling again repeats 1 (no duplicate), finds the
// user in 2, and finishes 3 and 4. A link is only returned after 3 succeeded,
// and generating a new one makes the previous one invalid (GoTrue keeps one
// token per user).
//
// THE LINK
// --------
// `<origin>/portal/accept-invite#token_hash=…&type=…`. In the FRAGMENT, so it
// never reaches a server log; the page reads it, removes it from the address
// bar and exchanges it with verifyOtp(). It is returned once in this response
// (no-store) and is never logged, stored or sent anywhere else.
// =============================================================================

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '');
const SERVER_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
// The public key: the owner's own calls go through PostgREST as the owner.
const PUBLIC_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
// Where the link points. PORTAL_ORIGIN wins; Netlify's URL is the site's main address.
const ORIGIN = (process.env.PORTAL_ORIGIN || process.env.URL || '').replace(/\/+$/, '');

const MAX_BODY = 8 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store, max-age=0' },
});
const fail = (status, code, message) => json(status, { ok: false, code, message });

/** The database's refusals, as codes the Portal words. Never the raw text. */
const REFUSALS = {
  owner_only: [403, 'FORBIDDEN'],
  invite_limit: [429, 'INVITE_LIMIT'],
  client_email_invalid: [422, 'EMAIL_INVALID'],
  client_email_is_staff: [409, 'EMAIL_IS_STAFF'],
  client_other_company: [409, 'OTHER_COMPANY'],
  client_project_other_company: [422, 'PROJECT_OTHER_COMPANY'],
  client_contact_other_company: [422, 'CONTACT_OTHER_COMPANY'],
  client_account_revoked: [409, 'ACCOUNT_REVOKED'],
  client_user_mismatch: [409, 'USER_MISMATCH'],
  client_user_fixed: [409, 'USER_MISMATCH'],
};
function refusal(body) {
  const m = /stratos:([a-z_]+)/.exec(String(body?.message ?? ''))?.[1];
  const hit = m && REFUSALS[m];
  return hit ? { status: hit[0], code: hit[1] } : null;
}

/** Network seam, replaced in tests. */
export const __net = { fetch: (...args) => globalThis.fetch(...args) };

const call = (url, init) => __net.fetch(url, { ...init, signal: AbortSignal.timeout(10000) });
const asOwner = (token) => ({ apikey: PUBLIC_KEY, authorization: `Bearer ${token}`, 'content-type': 'application/json' });
const asServer = () => ({ apikey: SERVER_KEY, authorization: `Bearer ${SERVER_KEY}`, 'content-type': 'application/json' });

async function rpc(token, fn, args) {
  const res = await call(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: asOwner(token), body: JSON.stringify(args),
  });
  const body = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, body };
}

async function generateLink(type, email, fullName) {
  const res = await call(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
    method: 'POST', headers: asServer(),
    body: JSON.stringify({ type, email, data: fullName ? { full_name: fullName } : undefined }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) return { ok: false, status: res.status, code: body?.error_code ?? body?.code ?? null };
  const hash = body?.properties?.hashed_token ?? body?.hashed_token;
  const userId = body?.user?.id ?? body?.id;
  return hash && userId ? { ok: true, hash, userId, type: body?.properties?.verification_type ?? type } : { ok: false, status: 502 };
}

/** The profile for this e-mail, if any — found with the server key (the owner may not search users). */
async function profileByEmail(email) {
  const escaped = email.replace(/[\\%_*]/g, (c) => `\\${c}`);
  const res = await call(
    `${SUPABASE_URL}/rest/v1/profiles?select=id,role,organization_id&email=ilike.${encodeURIComponent(escaped)}&limit=2`,
    { headers: asServer() },
  );
  if (!res.ok) return { ok: false };
  const rows = await res.json().catch(() => null);
  return { ok: Array.isArray(rows), rows: rows ?? [] };
}

async function isConfirmed(userId) {
  const res = await call(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`, { headers: asServer() });
  if (!res.ok) return null;
  const user = await res.json().catch(() => null);
  return Boolean(user?.email_confirmed_at || user?.confirmed_at || user?.last_sign_in_at);
}

export default async (request) => {
  if (request.method !== 'POST') return fail(405, 'METHOD_NOT_ALLOWED', 'Use POST.');
  if (!SUPABASE_URL || !SERVER_KEY || !PUBLIC_KEY || !ORIGIN) {
    return fail(503, 'NOT_CONFIGURED', 'Invitations are not configured on this deployment.');
  }

  const token = /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization') || '')?.[1]?.trim();
  if (!token) return fail(401, 'UNAUTHENTICATED', 'Sign in first.');

  const raw = await request.text().catch(() => '');
  if (raw.length > MAX_BODY) return fail(413, 'TOO_LARGE', 'The request is too large.');
  let input;
  try { input = JSON.parse(raw); } catch { return fail(400, 'BAD_REQUEST', 'Send JSON.'); }

  const organization = String(input?.organization_id ?? '');
  const contact = input?.contact_id ? String(input.contact_id) : null;
  const fullName = String(input?.full_name ?? '').trim().slice(0, 200);
  const email = String(input?.email ?? '').trim().toLowerCase();
  const projects = Array.isArray(input?.project_ids) ? input.project_ids.map(String) : [];
  if (!UUID.test(organization) || (contact && !UUID.test(contact)) || projects.some((p) => !UUID.test(p))
      || projects.length > 50 || !fullName || !EMAIL.test(email) || email.length > 320) {
    return fail(422, 'INVALID', 'Name, a valid e-mail and the client are required.');
  }

  try {
    // Who is asking — GoTrue checks the token; is_owner() is asked AS them.
    const me = await call(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: PUBLIC_KEY, authorization: `Bearer ${token}` } });
    if (!me.ok) return fail(401, 'UNAUTHENTICATED', 'Sign in first.');
    const owner = await rpc(token, 'is_owner', {});
    if (!owner.ok || owner.body !== true) return fail(403, 'FORBIDDEN', 'Only the portal owner can invite clients.');

    // 1. prepare
    const prep = await rpc(token, 'client_invite_prepare', {
      p_organization: organization, p_contact: contact, p_name: fullName, p_email: email, p_projects: projects,
    });
    if (!prep.ok) {
      const r = refusal(prep.body);
      if (r) return fail(r.status, r.code, 'The invitation was refused.');
      console.error('[portal-invite] prepare', prep.status);
      return fail(502, 'PREPARE_FAILED', 'The invitation could not be recorded. Try again.');
    }
    const account = Array.isArray(prep.body) ? prep.body[0] : null;
    if (!account?.account_id) return fail(502, 'PREPARE_FAILED', 'The invitation could not be recorded. Try again.');

    // 2. the auth user
    let userId = account.user_id ?? null;
    let generated = null;
    if (!userId) {
      const found = await profileByEmail(email);
      if (!found.ok) return fail(502, 'AUTH_LOOKUP_FAILED', 'The account could not be checked. Try again.');
      if (found.rows.length > 1) return fail(409, 'AMBIGUOUS', 'More than one account has this e-mail.');
      userId = found.rows[0]?.id ?? null;
      if (!userId) {
        const created = await generateLink('invite', email, fullName);
        if (created.ok) {
          userId = created.userId;
          generated = created;
        } else {
          // Two invitations of the same new address at once: GoTrue creates the
          // user for one and refuses the other (observed on a real local stack:
          // 500, unique violation). The user now exists — use it, as a retry
          // would, instead of failing this request.
          const raced = await profileByEmail(email);
          if (!raced.ok || raced.rows.length !== 1) {
            console.error('[portal-invite] create', created.status, created.code);
            return fail(502, 'AUTH_CREATE_FAILED', 'The sign-in account could not be created. Try again.');
          }
          userId = raced.rows[0].id;
        }
      }
    }

    // 3. attach — the moment access begins
    const attach = await rpc(token, 'client_invite_attach', { p_account: account.account_id, p_user: userId });
    if (!attach.ok) {
      const r = refusal(attach.body);
      if (r) return fail(r.status, r.code, 'The account could not be linked.');
      console.error('[portal-invite] attach', attach.status);
      return fail(502, 'PARTIAL', 'The sign-in account exists but was not linked yet. Try again — nothing is duplicated.');
    }

    // 4. the link (a fresh one on every call; the previous one stops working)
    if (!generated) {
      const confirmed = await isConfirmed(userId);
      if (confirmed === null) return fail(502, 'AUTH_LOOKUP_FAILED', 'The account could not be checked. Try again.');
      generated = await generateLink(confirmed ? 'recovery' : 'invite', email, fullName);
      if (!generated.ok) {
        console.error('[portal-invite] generate', generated.status, generated.code);
        return fail(502, 'LINK_FAILED', 'The account is ready, but no link could be made. Try again.');
      }
    }

    const kind = generated.type === 'recovery' ? 'recovery' : 'invite';
    const url = `${ORIGIN}/portal/accept-invite#token_hash=${encodeURIComponent(generated.hash)}&type=${kind}`;
    return json(200, { ok: true, account_id: account.account_id, kind, link: url });
  } catch (error) {
    console.error('[portal-invite] failed', error?.name ?? 'error');
    return fail(502, 'UNAVAILABLE', 'The invitation service is unavailable. Try again.');
  }
};

export const config = { path: '/api/portal-invite' };

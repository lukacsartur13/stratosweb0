// =============================================================================
// GET /api/portal-health
//
// What the Portal's System Health block reads.
//
// WHY THIS IS NOT PART OF /api/portal-analytics
// ---------------------------------------------
// Because system health is not analytics. The analytics endpoint answers
// `configured: false` and stops when Google is not set up, which is exactly the
// moment somebody most needs to know whether Supabase, the lead API and the
// notification adapter are fine. A health check that goes dark whenever one of
// the things it reports on is unavailable is not a health check.
//
// WHAT IT WILL NEVER RETURN
// -------------------------
// Any value of any variable. Every field below is a boolean, an enum or a
// name — `true`, `"none"`, `"GOOGLE_PRIVATE_KEY"`. There is no code path here
// that reads a secret INTO a response: `configured()` takes an environment
// variable and returns whether it is a non-empty string, and the value goes out
// of scope in the same expression.
//
// That is a structural guarantee rather than a discipline, and it is asserted:
// see `never returns a value, only whether one exists` in the suite.
//
// WEBHOOK URLS IN PARTICULAR
// --------------------------
// `LEAD_NOTIFY_WEBHOOK_URL` is a capability, not a configuration: anyone
// holding it can post into the channel it addresses. It is reported as
// `configured: true/false` and never as a host, a path or a length, because
// even the host names the service and the length narrows a guess.
//
// AUTHENTICATION
// --------------
// The same gate as the analytics endpoint, and for a stronger reason: which
// integrations exist, and which are broken, is a map of the system's soft
// spots. An anonymous caller gets 401 and learns nothing at all.
// =============================================================================

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

/** True when the variable holds something. Never what it holds. */
const configured = (value) => typeof value === 'string' && value.trim().length > 0;

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'private, no-store, max-age=0',
    },
  });

const fail = (status, code, message) => json(status, { ok: false, code, message });

/** Who is asking. The same seam, and the same reasoning, as portal-analytics. */
export const __auth = {
  async identify(token) {
    if (!SUPABASE_URL || !SUPABASE_KEY) return null;

    const user = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_KEY, authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    }).catch(() => null);
    if (!user?.ok) return null;

    const body = await user.json().catch(() => null);
    const id = body?.id;
    if (!id) return null;

    // The role comes from `profiles`, never from user metadata — metadata is
    // user-writable and would be a privilege escalation waiting to happen.
    const profile = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(id)}&select=role`,
      { headers: { apikey: SUPABASE_KEY, authorization: `Bearer ${SUPABASE_KEY}` },
        signal: AbortSignal.timeout(8000) },
    ).catch(() => null);
    if (!profile?.ok) return null;

    const rows = await profile.json().catch(() => null);
    const role = Array.isArray(rows) ? rows[0]?.role : null;
    return role ? { id, role } : null;
  },
};

/**
 * Is Supabase actually answering, or merely configured?
 *
 * A variable being set and a database being reachable are different facts, and
 * the second is the one an operator wants at 9am. One unauthenticated GET
 * against PostgREST's root with the service key: it returns the OpenAPI
 * document, touches no table, and proves both the URL and the key.
 */
async function reachSupabase() {
  if (!configured(SUPABASE_URL) || !configured(SUPABASE_KEY)) return 'unconfigured';
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/`, {
      headers: { apikey: SUPABASE_KEY, authorization: `Bearer ${SUPABASE_KEY}` },
      signal: AbortSignal.timeout(5000),
    });
    return res.ok ? 'ok' : 'unreachable';
  } catch {
    return 'unreachable';
  }
}

export default async (request) => {
  if (request.method !== 'GET') {
    return fail(405, 'METHOD_NOT_ALLOWED', 'Use GET.');
  }

  const header = request.headers.get('authorization') || '';
  const token = /^Bearer\s+(.+)$/i.exec(header)?.[1]?.trim();
  if (!token) return fail(401, 'UNAUTHENTICATED', 'Sign in to view system health.');

  const caller = await __auth.identify(token).catch(() => null);
  if (!caller) return fail(401, 'UNAUTHENTICATED', 'Sign in to view system health.');
  if (caller.role !== 'super_admin' && caller.role !== 'admin') {
    return fail(403, 'FORBIDDEN', 'This account cannot view system health.');
  }

  const supabase = await reachSupabase();

  return json(200, {
    ok: true,
    checkedAt: new Date().toISOString(),

    /**
     * Which deployment this is.
     *
     * `CONTEXT` is Netlify's own: `production`, `deploy-preview`, `branch-deploy`
     * or absent when running locally. It is the deploy's context, not a
     * hostname, so it says which environment without naming an address.
     */
    environment: process.env.CONTEXT || 'local',

    services: {
      supabase: {
        // `ok` proves the URL and the key together. `unconfigured` means the
        // variables are absent; `unreachable` means they are present and wrong,
        // or the project is down. An operator acts differently on each.
        state: supabase,
        // Present-or-absent only. Never the URL, which names the project.
        urlConfigured: configured(SUPABASE_URL),
        serviceKeyConfigured: configured(SUPABASE_KEY),
      },

      /**
       * The lead API, which is this same function bundle.
       *
       * Not probed with a request: POST /api/lead writes a row, and a health
       * check that creates a lead every time somebody opens the Portal is not a
       * health check, it is a data-quality problem. What is reported instead is
       * the configuration the endpoint needs in order to store anything, which
       * is the failure this check exists to catch — a deploy where the service
       * key is missing accepts submissions and drops them.
       */
      leadApi: {
        state: configured(SUPABASE_URL) && configured(SUPABASE_KEY) ? 'ok' : 'degraded',
        storeConfigured: configured(SUPABASE_URL) && configured(SUPABASE_KEY),
        // The IP salt is what makes `ip_hash` a hash rather than a record of
        // who submitted from where. Its absence is a privacy fact worth
        // surfacing, and its value is a secret.
        ipSaltConfigured: configured(process.env.IP_HASH_SALT),
      },

      ga4: {
        state:
          configured(process.env.GA4_PROPERTY_ID)
          && configured(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL)
          && configured(process.env.GOOGLE_PRIVATE_KEY)
            ? 'ok'
            : 'unconfigured',
        // NAMES of what is missing, which is what the setup screen renders.
        missing: [
          ['GA4_PROPERTY_ID', process.env.GA4_PROPERTY_ID],
          ['GOOGLE_SERVICE_ACCOUNT_EMAIL', process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL],
          ['GOOGLE_PRIVATE_KEY', process.env.GOOGLE_PRIVATE_KEY],
        ].filter(([, value]) => !configured(value)).map(([name]) => name),
      },

      notifications: {
        /**
         * `none` is a valid, deliberate state and is reported as such.
         *
         * The adapter defaults to sending nothing, which is not a fault: leads
         * land in the Portal and in the database whether or not a doorbell
         * rings. Painting it red would train whoever reads this screen to
         * ignore the colour.
         */
        transport: process.env.LEAD_NOTIFY_TRANSPORT || 'none',
        state:
          (process.env.LEAD_NOTIFY_TRANSPORT || 'none') === 'none'
            ? 'disabled'
            : configured(process.env.LEAD_NOTIFY_WEBHOOK_URL) ? 'ok' : 'degraded',
        // Whether a destination exists. NEVER the destination: a webhook URL is
        // a capability, and its host alone names the service.
        destinationConfigured: configured(process.env.LEAD_NOTIFY_WEBHOOK_URL),
      },
    },
  });
};

export const config = { path: '/api/portal-health' };

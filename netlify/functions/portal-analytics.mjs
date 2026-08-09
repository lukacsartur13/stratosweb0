// =============================================================================
// GET /api/portal-analytics
//
// The Portal's reporting screen, and the only place the GA4 Data API is ever
// called from. Phase 9, Workstream M.
//
//     GA4 → Analytics Data API → this function → Portal Analytics screen
//
// WHY A FUNCTION AND NOT A FETCH FROM THE PORTAL
// ----------------------------------------------
// Reading a GA4 property requires a Google service account, and a service
// account is a private RSA key. There is no browser-safe way to hold one: any
// key the portal could use to sign a request is a key anyone with the bundle
// can extract and use against the property themselves. So the key stays here,
// in the function environment, and the browser is only ever shown numbers.
//
// Two things follow, and both are asserted in tests/portal-analytics.spec.ts:
//
//   * nothing in this file's response contains a credential, a token, an email
//     or the private key, and
//   * the numeric Property ID does not appear in any browser bundle either. It
//     is not a secret, but it is not the browser's business, and keeping it
//     server-side means the portal cannot accidentally become a second caller.
//
// MEASUREMENT AND REPORTING ARE SEPARATE SYSTEMS
// ----------------------------------------------
// The public site measures with the GA4 *Measurement ID* (`G-JZD43PHJ41`,
// public, ships in the page). This function reports with the GA4 *Property ID*
// (`15392224433`) plus server-side Google credentials. They are two different
// identifiers for two different jobs and neither substitutes for the other.
//
// WHAT THE NUMBERS MEAN, AND THE CAVEAT THAT TRAVELS WITH THEM
// ------------------------------------------------------------
// The site runs Basic Consent Mode read strictly: gtag.js is not injected until
// a visitor consents, so a refusal produces no contact with Google at all — not
// even a cookieless ping. Everything below therefore describes **consented,
// measured traffic**, which is a subset of real traffic of unknown size. The
// screen says so; see `MEASUREMENT_BASIS` and the note it renders.
//
// GA4 terminology is used exactly. `activeUsers` is active users, `sessions`
// are sessions, `screenPageViews` are views. None of them is "visitors", and
// this file does not invent a metric that GA4 does not have.
//
// ORDER OF GATES
// --------------
//   1. method          405   not a GET
//   2. authentication  401   no bearer token, or Supabase rejects it
//   3. authorization   403   authenticated, but not staff
//   4. range           400   not on the allow-list
//   5. configured      200   { configured: false } — see below
//   6. cache hit       200   served without touching Google
//   7. Google          200 / 502
//
// Authentication comes before EVERYTHING, including the configured check. Which
// third-party integrations a private admin has wired up is not a fact the open
// internet is owed, and answering "not configured" to an anonymous GET would
// give it away for free.
//
// THE UNCONFIGURED STATE IS A SUCCESS, NOT AN ERROR
// -------------------------------------------------
// No service account exists yet — creating one is a user-side step this
// repository cannot perform. So the endpoint answers 200 with
// `configured: false` and a list of exactly which variables are missing (their
// NAMES, never their values). The screen renders a setup state from it. This is
// the difference between a feature that is waiting for credentials and a
// feature that is broken, and the two should not look the same to whoever opens
// the page.
// =============================================================================

import crypto from 'node:crypto';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

const GA4_PROPERTY_ID = process.env.GA4_PROPERTY_ID;
const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY;

/** Read-only. The Data API needs nothing more, and asking for more is how a
 *  reporting integration quietly becomes an editing one. */
const GA4_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DATA_API = 'https://analyticsdata.googleapis.com/v1beta';

/** Sent to the browser with every payload so the caveat cannot be separated
 *  from the numbers by a later refactor. */
export const MEASUREMENT_BASIS = 'consented';

/**
 * The two events that mean a real enquiry arrived.
 *
 * These are names from the Phase 9 event taxonomy, not guesses:
 * `form_submit_success` is the conversion for the newsletter, contact and
 * Impact forms, and `questionnaire_submit_success` is the questionnaire's
 * success screen. See `_build/reports/phase9-event-taxonomy.md` §6.
 *
 * They are counted here rather than read from GA4's `keyEvents` metric on
 * purpose: `keyEvents` counts whatever someone ticked "mark as key event" for
 * in the GA4 interface, which is a console setting this repository cannot see,
 * cannot test and cannot keep in step. Counting the events by name gives the
 * same answer without depending on a checkbox.
 */
const LEAD_EVENTS = ['form_submit_success', 'questionnaire_submit_success'];

/**
 * Ranges the caller may ask for, and nothing else.
 *
 * An allow-list rather than a validated pass-through: `startDate` and
 * `endDate` reach Google verbatim, and the set of useful windows is small and
 * known. There is no reason for a client to be able to compose an arbitrary
 * one.
 */
const RANGES = {
  '7d': { start: '6daysAgo', label: 'Last 7 days' },
  '28d': { start: '27daysAgo', label: 'Last 28 days' },
  '90d': { start: '89daysAgo', label: 'Last 90 days' },
};
const DEFAULT_RANGE = '28d';

const json = (status, body, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      // Reporting on a private admin. `private` keeps it out of any shared
      // cache and `no-store` keeps it off disk; the /api/* rule in netlify.toml
      // sets no-store too, and this is the belt to that pair of braces.
      'cache-control': 'private, no-store, max-age=0',
      ...extra,
    },
  });

const fail = (status, code, message) => json(status, { ok: false, code, message });

/* ============================================================== the seams ===
 * Three of them, and they exist so the suite can exercise this file without a
 * Supabase project, without a Google service account and — the one that
 * matters — without ever sending a request to the real property. A test that
 * hits production analytics pollutes the data it is meant to be reporting on.
 * ========================================================================== */

/** Who is asking. Replaced in tests; talks to Supabase in production. */
export const __auth = {
  /**
   * Verify the caller's Supabase access token and return their role.
   *
   * Plain `fetch` against PostgREST and GoTrue rather than
   * `@supabase/supabase-js`. Two reasons: this function performs exactly two
   * reads, and the SDK's `createClient` builds a realtime client that needs a
   * global WebSocket — the thing that pinned NODE_VERSION to 22 and took
   * POST /api/lead down for every submission before that. See the note on
   * `__store` in submit-lead.mjs; this is that note's suggestion, taken.
   *
   * Returns `{ id, role }`, or null for any failure. The caller does not get
   * to know which failure — see the 401 below.
   */
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

    // The role is read from `profiles`, never from the JWT's user metadata.
    // Metadata is user-writable, so trusting it here would let any signed-in
    // account promote itself to admin and read the whole property. The portal's
    // AuthProvider takes the same care for the same reason.
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

/** Google. Replaced in tests with fixed responses. */
export const __google = {
  /**
   * A service-account access token, signed here rather than by a library.
   *
   * The whole of Google's server-to-server flow is: build a JWT, sign it with
   * the service account's private key, POST it, receive a bearer token. That is
   * thirty lines of `node:crypto` and no dependency — and a dependency here
   * would be a dependency with access to the signing key, in a function that
   * Netlify bundles from the root manifest.
   */
  async accessToken() {
    const now = Math.floor(Date.now() / 1000);
    const b64 = (v) => Buffer.from(v).toString('base64url');

    const claim = {
      iss: GOOGLE_CLIENT_EMAIL,
      scope: GA4_SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    };
    const input = `${b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64(JSON.stringify(claim))}`;

    // Netlify's UI stores a multi-line value with literal \n. A key that fails
    // to parse throws here, is caught by the caller, and is reported as a
    // configuration fault — never with the key in the message.
    const key = String(GOOGLE_PRIVATE_KEY).replace(/\\n/g, '\n');
    const signature = crypto.createSign('RSA-SHA256').update(input).sign(key);

    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${input}.${b64(signature)}`,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) throw new Error(`token endpoint answered ${res.status}`);
    const body = await res.json();
    if (!body?.access_token) throw new Error('token endpoint returned no access_token');
    return { token: body.access_token, expiresIn: Number(body.expires_in) || 3600 };
  },

  /** One Data API call. `method` is `batchRunReports` or `runRealtimeReport`. */
  async call(method, token, body) {
    const res = await fetch(`${DATA_API}/properties/${GA4_PROPERTY_ID}:${method}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      // Google's error body can quote the request, the property and the service
      // account address. It is useful in a function log and belongs nowhere
      // near a response. The status is what the caller gets.
      const detail = await res.text().catch(() => '');
      console.error(`portal-analytics: ${method} answered ${res.status}`, detail.slice(0, 400));
      throw new Error(`Data API answered ${res.status}`);
    }
    return res.json();
  },
};

/**
 * Server-side cache, per warm instance.
 *
 * Honest about what it is: a `Map` in one Lambda's memory. It does not survive
 * a cold start and does not coordinate between concurrent instances, so a
 * five-minute TTL means "at most one Google call per five minutes per warm
 * instance", not "per five minutes". That is still the whole point — the Data
 * API has per-property quotas, a dashboard that refetches on every mount will
 * spend them, and analytics data that is five minutes stale is analytics data.
 *
 * It is deliberately NOT called a rate limiter and is not load-bearing for
 * anything but cost. If a durable cache is ever wanted, it is a shared store
 * behind this same interface.
 */
export const __cache = {
  ttlMs: 5 * 60 * 1000,
  entries: new Map(),
  token: null,

  get(key) {
    const hit = this.entries.get(key);
    if (!hit) return null;
    if (Date.now() > hit.expires) { this.entries.delete(key); return null; }
    return hit.value;
  },
  set(key, value) {
    if (this.entries.size > 32) this.entries.clear();
    this.entries.set(key, { value, expires: Date.now() + this.ttlMs });
  },
  clear() { this.entries.clear(); this.token = null; },
};

/** Which required variables are absent. Names only — never values. */
function missingConfig() {
  return [
    ['GA4_PROPERTY_ID', GA4_PROPERTY_ID],
    ['GOOGLE_SERVICE_ACCOUNT_EMAIL', GOOGLE_CLIENT_EMAIL],
    ['GOOGLE_PRIVATE_KEY', GOOGLE_PRIVATE_KEY],
  ].filter(([, value]) => !value).map(([name]) => name);
}

/* ----------------------------------------------------------- GA4 responses */

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** The metric values of a report that has no dimensions — one row, or none. */
function totals(report, names) {
  const row = report?.rows?.[0];
  const out = {};
  names.forEach((name, i) => { out[name] = num(row?.metricValues?.[i]?.value); });
  return out;
}

/** Rows of a one-dimension report, as `{ key, value }`. */
function breakdown(report, limit = 10) {
  return (report?.rows ?? []).slice(0, limit).map((row) => ({
    key: String(row?.dimensionValues?.[0]?.value ?? '(not set)'),
    value: num(row?.metricValues?.[0]?.value),
  }));
}

const SUMMARY_METRICS = ['activeUsers', 'sessions', 'screenPageViews', 'newUsers'];

function summaryRequest(startDate, endDate = 'today') {
  return {
    dateRanges: [{ startDate, endDate }],
    metrics: SUMMARY_METRICS.map((name) => ({ name })),
  };
}

/**
 * Everything the screen shows, in three calls.
 *
 * A batch of five (the API's maximum per `batchRunReports`), one more for the
 * lead events, and one realtime. Six separate round trips would be the naive
 * shape and would cost six times the quota for the same answer.
 */
async function collect(token, range) {
  const { start } = RANGES[range];

  const batch = await __google.call('batchRunReports', token, {
    requests: [
      summaryRequest('today'),
      summaryRequest('6daysAgo'),
      summaryRequest(start),
      {
        dateRanges: [{ startDate: start, endDate: 'today' }],
        dimensions: [{ name: 'pagePath' }],
        metrics: [{ name: 'screenPageViews' }],
        orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
        limit: 10,
      },
      {
        dateRanges: [{ startDate: start, endDate: 'today' }],
        dimensions: [{ name: 'sessionSourceMedium' }],
        metrics: [{ name: 'sessions' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 10,
      },
    ],
  });

  const leads = await __google.call('batchRunReports', token, {
    requests: [{
      dateRanges: [{ startDate: start, endDate: 'today' }],
      dimensions: [{ name: 'eventName' }],
      metrics: [{ name: 'eventCount' }],
      dimensionFilter: {
        filter: { fieldName: 'eventName', inListFilter: { values: LEAD_EVENTS } },
      },
    }],
  });

  const realtime = await __google
    .call('runRealtimeReport', token, {
      metrics: [{ name: 'activeUsers' }],
      minuteRanges: [{ startMinutesAgo: 29, endMinutesAgo: 0 }],
    })
    // Realtime is the one number the screen can do without. If it fails while
    // the rest succeeded, the dashboard should still render.
    .catch((error) => {
      console.error('portal-analytics: realtime unavailable —', error.message);
      return null;
    });

  const reports = batch?.reports ?? [];
  const leadRows = breakdown(leads?.reports?.[0], LEAD_EVENTS.length);
  const leadTotal = leadRows.reduce((sum, row) => sum + row.value, 0);
  const window = totals(reports[2], SUMMARY_METRICS);

  return {
    range,
    rangeLabel: RANGES[range].label,
    basis: MEASUREMENT_BASIS,
    activeUsers: {
      today: totals(reports[0], SUMMARY_METRICS).activeUsers,
      last7Days: totals(reports[1], SUMMARY_METRICS).activeUsers,
      inRange: window.activeUsers,
    },
    sessions: window.sessions,
    screenPageViews: window.screenPageViews,
    newUsers: window.newUsers,
    leadEvents: {
      total: leadTotal,
      byName: leadRows,
      // Lead events divided by sessions, over the same window. Named for what
      // it divides rather than "conversion rate" alone, because GA4's own
      // "session key event rate" counts key events — a console setting — and
      // two numbers called the same thing that disagree is worse than one
      // number with a longer name.
      perSession: window.sessions > 0
        ? Number((leadTotal / window.sessions).toFixed(4))
        : null,
    },
    topPages: breakdown(reports[3]),
    trafficSources: breakdown(reports[4]),
    realtimeActiveUsers: realtime
      ? totals(realtime, ['activeUsers']).activeUsers
      : null,
    fetchedAt: new Date().toISOString(),
  };
}

/* -------------------------------------------------------------- the handler */

export default async (request) => {
  // ---- 1. method ------------------------------------------------------------
  if (request.method !== 'GET') {
    return fail(405, 'METHOD_NOT_ALLOWED', 'Use GET.');
  }

  // ---- 2. authentication ----------------------------------------------------
  // One message for every way this can fail: no header, malformed header,
  // expired token, forged token, Supabase unreachable. Telling an unauthorised
  // caller *which* of those happened is telling them how to get closer.
  const header = request.headers.get('authorization') || '';
  const token = /^Bearer\s+(.+)$/i.exec(header)?.[1]?.trim();
  if (!token) {
    return fail(401, 'UNAUTHENTICATED', 'Sign in to view analytics.');
  }

  const caller = await __auth.identify(token).catch(() => null);
  if (!caller) {
    return fail(401, 'UNAUTHENTICATED', 'Sign in to view analytics.');
  }

  // ---- 3. authorization -----------------------------------------------------
  // Property-wide traffic reporting is a business-level view. `team_member` and
  // `client` can both hold a valid session, and neither should read it. This
  // mirrors `view_analytics` in portal/src/lib/permissions.ts — the UI hides the
  // screen, and this decides whether the data exists to be read, which is the
  // half that matters.
  if (caller.role !== 'super_admin' && caller.role !== 'admin') {
    return fail(403, 'FORBIDDEN', 'This account cannot view analytics.');
  }

  // ---- 4. range -------------------------------------------------------------
  const asked = new URL(request.url).searchParams.get('range') || DEFAULT_RANGE;
  if (!Object.hasOwn(RANGES, asked)) {
    return fail(400, 'BAD_RANGE', `range must be one of: ${Object.keys(RANGES).join(', ')}.`);
  }

  // ---- 5. configured? -------------------------------------------------------
  const missing = missingConfig();
  if (missing.length) {
    return json(200, {
      ok: true,
      configured: false,
      missing,
      basis: MEASUREMENT_BASIS,
      message: 'Portal Analytics is not connected to a Google Analytics property yet.',
    });
  }

  // ---- 6. cache -------------------------------------------------------------
  const cached = __cache.get(asked);
  if (cached) {
    return json(200, { ok: true, configured: true, cached: true, data: cached });
  }

  // ---- 7. Google ------------------------------------------------------------
  try {
    if (!__cache.token || Date.now() > __cache.token.expires) {
      const { token: access, expiresIn } = await __google.accessToken();
      // Renewed a minute early, so a request cannot start with 3 seconds left
      // on the clock and finish after it has expired.
      __cache.token = { value: access, expires: Date.now() + (expiresIn - 60) * 1000 };
    }

    const data = await collect(__cache.token.value, asked);
    __cache.set(asked, data);
    return json(200, { ok: true, configured: true, cached: false, data });
  } catch (error) {
    // A bad key, a revoked service account, a property the account cannot read,
    // a Google outage. The distinction is in the log; the screen gets one
    // message, because none of the four is something the viewer can act on
    // differently and the detail names our own configuration.
    console.error('portal-analytics: report failed —', error.message);
    __cache.token = null;   // force a fresh token on the next attempt
    return fail(502, 'UPSTREAM_FAILED', 'Analytics could not be loaded right now.');
  }
};

export const config = { path: '/api/portal-analytics' };

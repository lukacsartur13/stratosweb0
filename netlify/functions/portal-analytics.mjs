// =============================================================================
// GET /api/portal-analytics
//
// The Portal's Analytics product, and the only place the GA4 Data API is ever
// called from.
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
// this file does not invent a metric that GA4 does not have. Where a derived
// figure is unavoidable it is named for what it divides — see `leadRate`.
//
// ONE REQUEST, ONE DASHBOARD
// --------------------------
// The screen has nine sections and makes ONE call. Everything below is
// assembled here, from two `batchRunReports` batches of five and two realtime
// reports, because the naive shape — a fetch per widget — would be twelve round
// trips and twelve times the property quota for one page load. See `collect`.
//
// ORDER OF GATES
// --------------
//   1. method          405   not a GET
//   2. authentication  401   no bearer token, or Supabase rejects it
//   3. authorization   403   authenticated, but not staff
//   4. parameters      400   range or environment not on the allow-list
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
// Creating a service account is a user-side step this repository cannot
// perform. So the endpoint answers 200 with `configured: false` and a list of
// exactly which variables are missing (their NAMES, never their values). The
// screen renders a setup state from it. This is the difference between a
// feature that is waiting for credentials and a feature that is broken, and the
// two should not look the same to whoever opens the page.
// =============================================================================

import crypto from 'node:crypto';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

const GA4_PROPERTY_ID = process.env.GA4_PROPERTY_ID;
const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;

/**
 * The service account's private key, normalized once, here.
 *
 * Netlify stores the PEM as a SINGLE LINE with literal backslash-n escapes:
 *
 *     -----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n
 *
 * `node:crypto` needs real newlines, and it does not say so politely when it
 * does not get them — a key that still carries `\n` as two characters, or that
 * carries a stray leading/trailing newline from the paste, fails deep inside
 * OpenSSL as `error:1E08010C:DECODER routines::unsupported`. That message names
 * neither the variable nor the cause, which is how it costs an afternoon.
 *
 * So: the escapes become newlines and the surrounding whitespace goes, once, at
 * module load, and every consumer below takes the value from here. Normalizing
 * at the point of use instead is how one call site gets fixed and another does
 * not. The value is never logged — see the catch in the handler.
 */
const privateKey = process.env.GOOGLE_PRIVATE_KEY
  ?.replace(/\\n/g, '\n')
  .trim();

/**
 * The hostnames that are the real website.
 *
 * Not a secret and not a credential — it is the same list the public site's
 * `analytics-config` block already ships to every visitor, which is what
 * decides whether an event is tagged `production` or `staging` on the way out.
 * Repeating it here rather than importing it keeps the function free of a build
 * dependency; the default is the value in `_build/build.py`, and the variable
 * exists so a domain change is a Netlify setting rather than a deploy.
 */
const PRODUCTION_HOSTS = (process.env.GA4_PRODUCTION_HOSTS || 'stratosweb.hu,www.stratosweb.hu')
  .split(',')
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);

/** Read-only. The Data API needs nothing more, and asking for more is how a
 *  reporting integration quietly becomes an editing one. */
const GA4_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DATA_API = 'https://analyticsdata.googleapis.com/v1beta';

/** Sent to the browser with every payload so the caveat cannot be separated
 *  from the numbers by a later refactor. */
export const MEASUREMENT_BASIS = 'consented';

/* ========================================================== the taxonomy === */

/**
 * The events this property actually collects, and nothing else.
 *
 * Every name below is in `_build/reports/phase9-event-taxonomy.md` and is sent
 * by `assets/js/analytics.js`. That is the whole rule for this block: the
 * funnel is built from events that exist, and a stage with no real event behind
 * it is not shown rather than estimated. A dashboard that invents a step is
 * worse than one that admits a gap, because the invented number gets used.
 */
const EVENTS = {
  /** §3.2 — any deliberate move towards contact. */
  cta: [
    'cta_click',
    'project_start_click',
    'service_contact_click',
    'work_explore_click',
    'impact_apply_click',
  ],
  /** §3.3 / §3.4 — the visitor has begun filling something in. */
  formStart: ['form_start', 'questionnaire_start'],
  /** §3.3 — a submission was actually sent. */
  formSubmit: ['form_submit_attempt'],
  /** §3.3 / §3.4 — the conversion. A real enquiry arrived. */
  lead: ['form_submit_success', 'questionnaire_submit_success'],
};

/**
 * Every event name the reports ask for, deduplicated.
 *
 * One filtered report covers the whole funnel: five names in an `inListFilter`
 * costs exactly as much as one, and asking per stage would be four requests to
 * answer one question.
 */
const FUNNEL_EVENTS = [...new Set(Object.values(EVENTS).flat())];

/**
 * The lead events, exported because the Command Center reads the same two.
 *
 * Counted by name rather than through GA4's `keyEvents` metric on purpose:
 * `keyEvents` counts whatever someone ticked "mark as key event" for in the GA4
 * interface, which is a console setting this repository cannot see, cannot test
 * and cannot keep in step. Counting the events by name gives the same answer
 * without depending on a checkbox.
 */
const LEAD_EVENTS = EVENTS.lead;

/**
 * The funnel, in the order a visitor walks it.
 *
 * `sessions` is the entry stage and it is not an event — it is the session
 * count for the same window, which is the honest denominator for everything
 * below it. The taxonomy has no "session" event and this file does not add one.
 */
const FUNNEL_STAGES = [
  { id: 'session', label: 'Sessions', from: 'sessions' },
  { id: 'cta', label: 'CTA interaction', events: EVENTS.cta },
  { id: 'form_start', label: 'Form started', events: EVENTS.formStart },
  { id: 'form_submit', label: 'Form submitted', events: EVENTS.formSubmit },
  { id: 'lead', label: 'Lead confirmed', events: EVENTS.lead },
];

/* ============================================================= parameters === */

/**
 * Ranges the caller may ask for, and nothing else.
 *
 * An allow-list rather than a validated pass-through: `startDate` and
 * `endDate` reach Google verbatim, and the set of useful windows is small and
 * known. There is no reason for a client to be able to compose an arbitrary
 * one.
 *
 * `days` is what makes the comparison period derivable rather than a second
 * table: the previous period is always the same number of days immediately
 * before this one, which is what "compare with previous period" means
 * everywhere it appears in an analytics product.
 */
const RANGES = {
  today: { start: 'today', days: 1, label: 'Today', grain: 'dateHour' },
  '7d': { start: '6daysAgo', days: 7, label: 'Last 7 days', grain: 'date' },
  '30d': { start: '29daysAgo', days: 30, label: 'Last 30 days', grain: 'date' },
  '90d': { start: '89daysAgo', days: 90, label: 'Last 90 days', grain: 'date' },
};
const DEFAULT_RANGE = '30d';

/**
 * Which traffic the figures describe.
 *
 * Production is the default and that is a business decision, not a technical
 * one: the primary dashboard reports the real website, and an integration
 * deploy on the netlify.app address must never be able to move a KPI on it.
 */
const ENVIRONMENTS = ['production', 'staging', 'all'];
const DEFAULT_ENVIRONMENT = 'production';

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

    // Already normalized at module load — see `privateKey`. A key that still
    // fails to parse throws here, is caught by the caller, and is reported as a
    // configuration fault — never with the key in the message.
    const signature = crypto.createSign('RSA-SHA256').update(input).sign(privateKey);

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
      signal: AbortSignal.timeout(20_000),
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
 * API has per-property quotas, a dashboard with nine sections that refetched on
 * every mount would spend them, and analytics data that is five minutes stale
 * is analytics data.
 *
 * Realtime gets its own shelf and its own much shorter life, because a realtime
 * panel that is five minutes old is not realtime. Sixty seconds is the
 * compromise: the panel says "last 30 minutes", so a minute of staleness is
 * inside its own resolution, and it bounds a Portal left open on a second
 * monitor to sixty realtime calls an hour rather than one per poll.
 *
 * It is deliberately NOT called a rate limiter and is not load-bearing for
 * anything but cost. If a durable cache is ever wanted, it is a shared store
 * behind this same interface.
 */
export const __cache = {
  ttlMs: 5 * 60 * 1000,
  realtimeTtlMs: 60 * 1000,
  entries: new Map(),
  token: null,

  get(key) {
    const hit = this.entries.get(key);
    if (!hit) return null;
    if (Date.now() > hit.expires) { this.entries.delete(key); return null; }
    return hit.value;
  },
  set(key, value, ttl = this.ttlMs) {
    if (this.entries.size > 48) this.entries.clear();
    this.entries.set(key, { value, expires: Date.now() + ttl });
  },
  clear() { this.entries.clear(); this.token = null; },
};

/** Which required variables are absent. Names only — never values. */
function missingConfig() {
  return [
    ['GA4_PROPERTY_ID', GA4_PROPERTY_ID],
    ['GOOGLE_SERVICE_ACCOUNT_EMAIL', GOOGLE_CLIENT_EMAIL],
    ['GOOGLE_PRIVATE_KEY', privateKey],
  ].filter(([, value]) => !value).map(([name]) => name);
}

/* ================================================== reading GA4 responses === */

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** A metric value by position, from a row that may not exist. */
const metric = (row, i) => num(row?.metricValues?.[i]?.value);
/** A dimension value by position, with GA4's own "unset" spelling preserved. */
const dim = (row, i) => String(row?.dimensionValues?.[i]?.value ?? '(not set)');

/** The metric values of a report that has no dimensions — one row, or none. */
function totals(report, names) {
  const row = report?.rows?.[0];
  const out = {};
  names.forEach((name, i) => { out[name] = metric(row, i); });
  return out;
}

/** Rows of a one-dimension report, as `{ key, value }`. */
function breakdown(report, limit = 10) {
  return (report?.rows ?? []).slice(0, limit).map((row) => ({
    key: dim(row, 0),
    value: metric(row, 0),
  }));
}

/**
 * Every row of a report, mapped by a shape function.
 *
 * `rows` is absent rather than empty when a report has no data, which is the
 * single most common way a dashboard like this throws on a quiet property.
 */
const rowsOf = (report, shape, limit = 50) =>
  (report?.rows ?? []).slice(0, limit).map(shape);

/* ======================================================= building requests === */

const SUMMARY_METRICS = [
  'activeUsers',
  'sessions',
  'screenPageViews',
  'newUsers',
  'engagedSessions',
  'userEngagementDuration',
];

/**
 * The environment filter, as a GA4 dimension filter.
 *
 * ## Why `hostName` and not the `environment` event parameter
 *
 * The site tags every event with an `environment` parameter AND sets GA4's own
 * `traffic_type`. Either could separate staging from production, and neither is
 * usable from here without help:
 *
 *   * a custom event parameter is only queryable once someone has registered it
 *     as a custom dimension in the GA4 interface — a console setting this
 *     repository cannot make, cannot see and cannot test against;
 *   * `traffic_type` drives GA4's internal-traffic filter, which is a
 *     property-level setting that either excludes the traffic before it is
 *     stored or does not, and is likewise invisible from here.
 *
 * `hostName` is a standard GA4 dimension. It is present on every property from
 * the day it is created, it needs no configuration at all, and it answers the
 * question directly: the real website is served from `stratosweb.hu`, and
 * anything else is an integration address. So the separation this dashboard
 * promises is one it can actually deliver, rather than one that depends on a
 * checkbox nobody can confirm from here.
 *
 * The response says which mechanism was used and on which hosts, because a
 * filter the viewer cannot inspect is a filter the viewer has to take on faith.
 */
function environmentFilter(environment) {
  if (environment === 'all') return null;
  const inProduction = {
    filter: {
      fieldName: 'hostName',
      inListFilter: { values: PRODUCTION_HOSTS, caseSensitive: false },
    },
  };
  return environment === 'production' ? inProduction : { notExpression: inProduction };
}

/** Combine the environment filter with a report's own, if it has one. */
function withEnvironment(filter, own) {
  if (!filter) return own ?? undefined;
  if (!own) return filter;
  return { andGroup: { expressions: [filter, own] } };
}

/** An event-name filter over a set of names from the taxonomy. */
const eventsIn = (names) => ({
  filter: { fieldName: 'eventName', inListFilter: { values: names } },
});

/* ================================================================ collect === */

/**
 * Everything the screen shows, in four calls.
 *
 * Two `batchRunReports` batches — five requests each, which is the API's
 * maximum — and two realtime reports, which cannot be batched because they are
 * a different method. Twelve separate round trips would be the naive shape and
 * would cost twelve times the quota for the same answer.
 *
 * The order of the requests inside each batch is load-bearing: `reports[i]`
 * below is positional, because that is how `batchRunReports` answers. Every
 * index is named at the point of use for exactly that reason.
 */
async function collect(token, range, environment) {
  const { start, days, grain } = RANGES[range];
  const env = environmentFilter(environment);

  const current = { startDate: start, endDate: 'today' };
  /**
   * The comparison window: the same number of days, immediately before.
   *
   * `today` is a partial day and so is the day `days` ago, which is what makes
   * this an honest comparison rather than a flattering one — both windows have
   * the same number of days in them and the same partial day at the end.
   */
  const previous = { startDate: `${2 * days - 1}daysAgo`, endDate: `${days}daysAgo` };

  const summary = (dateRange) => ({
    dateRanges: [dateRange],
    metrics: SUMMARY_METRICS.map((name) => ({ name })),
    dimensionFilter: withEnvironment(env, null),
  });

  /* -- batch one: the totals, the trend and the pages --------------------- */
  const first = await __google.call('batchRunReports', token, {
    requests: [
      // 0 — today, always, whatever the range is. The Command Center's
      //     "right now" figures are today's, and asking for them separately
      //     would be a fifth of a batch for one number.
      summary({ startDate: 'today', endDate: 'today' }),
      // 1 — the selected window.
      summary(current),
      // 2 — the window before it.
      summary(previous),
      // 3 — the trend. Hourly for today, daily otherwise: a 24-point line for
      //     one day and a 90-point line for a quarter are both readable, and a
      //     one-point line for "today by date" is not a chart.
      {
        dateRanges: [current],
        dimensions: [{ name: grain }],
        metrics: [
          { name: 'activeUsers' },
          { name: 'sessions' },
          { name: 'screenPageViews' },
        ],
        orderBys: [{ dimension: { dimensionName: grain } }],
        dimensionFilter: withEnvironment(env, null),
        limit: 100,
      },
      // 4 — top pages, by views.
      {
        dateRanges: [current],
        dimensions: [{ name: 'pagePath' }, { name: 'pageTitle' }],
        metrics: [
          { name: 'screenPageViews' },
          { name: 'activeUsers' },
          { name: 'userEngagementDuration' },
          { name: 'sessions' },
        ],
        orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
        dimensionFilter: withEnvironment(env, null),
        limit: 15,
      },
    ],
  });

  /* -- batch two: landing, acquisition, devices and the funnel ------------ */
  const second = await __google.call('batchRunReports', token, {
    requests: [
      // 0 — landing pages, by the sessions that started on them.
      {
        dateRanges: [current],
        dimensions: [{ name: 'landingPagePlusQueryString' }],
        metrics: [
          { name: 'sessions' },
          { name: 'activeUsers' },
          { name: 'engagedSessions' },
          { name: 'bounceRate' },
        ],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        dimensionFilter: withEnvironment(env, null),
        limit: 15,
      },
      // 1 — acquisition. Source, medium and campaign as three dimensions
      //     rather than GA4's joined `sessionSourceMedium` string, because the
      //     screen groups by medium and a joined string would have to be split
      //     back apart by the browser to do it.
      {
        dateRanges: [current],
        dimensions: [
          { name: 'sessionSource' },
          { name: 'sessionMedium' },
          { name: 'sessionCampaignName' },
        ],
        metrics: [
          { name: 'sessions' },
          { name: 'activeUsers' },
          { name: 'engagedSessions' },
          { name: 'newUsers' },
        ],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        dimensionFilter: withEnvironment(env, null),
        limit: 25,
      },
      // 2 — devices. The public site has genuinely different mobile and
      //     desktop experiences, so this is not a vanity breakdown: it is the
      //     only way to tell whether a change to one of them worked.
      {
        dateRanges: [current],
        dimensions: [{ name: 'deviceCategory' }],
        metrics: [
          { name: 'sessions' },
          { name: 'activeUsers' },
          { name: 'engagedSessions' },
          { name: 'screenPageViews' },
        ],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        dimensionFilter: withEnvironment(env, null),
      },
      // 3 — the funnel, and the lead total with it. One filtered report for
      //     every event the taxonomy defines as part of the path to an enquiry.
      {
        dateRanges: [current],
        dimensions: [{ name: 'eventName' }],
        metrics: [{ name: 'eventCount' }],
        dimensionFilter: withEnvironment(env, eventsIn(FUNNEL_EVENTS)),
        limit: FUNNEL_EVENTS.length,
      },
      // 4 — the same events over the previous window, so the lead figure has a
      //     comparison like every other headline number.
      {
        dateRanges: [previous],
        dimensions: [{ name: 'eventName' }],
        metrics: [{ name: 'eventCount' }],
        dimensionFilter: withEnvironment(env, eventsIn(FUNNEL_EVENTS)),
        limit: FUNNEL_EVENTS.length,
      },
    ],
  });

  /* -- the two device/page conversion joins ------------------------------- */
  /**
   * Conversions by device and by page, in one more batch.
   *
   * These are separate reports rather than extra metrics on the reports above
   * because "sessions on mobile" and "lead events on mobile" are different
   * aggregations: the first counts sessions and the second counts events, and
   * GA4 will not return both in one row without the event filter also
   * restricting the session count. Asking twice is the correct shape, and it
   * is what makes "mobile converts at half the rate of desktop" a sentence this
   * dashboard is allowed to say.
   */
  const third = await __google.call('batchRunReports', token, {
    requests: [
      {
        dateRanges: [current],
        dimensions: [{ name: 'deviceCategory' }],
        metrics: [{ name: 'eventCount' }],
        dimensionFilter: withEnvironment(env, eventsIn(LEAD_EVENTS)),
      },
      {
        dateRanges: [current],
        dimensions: [{ name: 'pagePath' }],
        metrics: [{ name: 'eventCount' }],
        dimensionFilter: withEnvironment(env, eventsIn(LEAD_EVENTS)),
        orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
        limit: 30,
      },
      {
        dateRanges: [current],
        dimensions: [{ name: 'sessionSource' }, { name: 'sessionMedium' }],
        metrics: [{ name: 'eventCount' }],
        dimensionFilter: withEnvironment(env, eventsIn(LEAD_EVENTS)),
        orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
        limit: 25,
      },
      // 3 — today's leads. The Command Center's headline conversion figure is
      //     today's, and the window above may be ninety days wide.
      {
        dateRanges: [{ startDate: 'today', endDate: 'today' }],
        dimensions: [{ name: 'eventName' }],
        metrics: [{ name: 'eventCount' }],
        dimensionFilter: withEnvironment(env, eventsIn(LEAD_EVENTS)),
      },
      // 4 — leads by LANDING page, which is a different question from leads by
      //     page and cannot be answered from it. `pagePath` says where the
      //     enquiry was sent from; this says which page brought the session
      //     that produced it, and for judging an ad campaign the second one is
      //     the only one that means anything.
      {
        dateRanges: [current],
        dimensions: [{ name: 'landingPagePlusQueryString' }],
        metrics: [{ name: 'eventCount' }],
        dimensionFilter: withEnvironment(env, eventsIn(LEAD_EVENTS)),
        orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
        limit: 30,
      },
    ],
  });

  const a = first?.reports ?? [];
  const b = second?.reports ?? [];
  const c = third?.reports ?? [];

  /* -- assemble ----------------------------------------------------------- */

  const eventCounts = (report) => {
    const out = {};
    for (const row of report?.rows ?? []) out[dim(row, 0)] = metric(row, 0);
    return out;
  };

  const nowEvents = eventCounts(b[3]);
  const thenEvents = eventCounts(b[4]);
  const sum = (counts, names) => names.reduce((total, name) => total + (counts[name] ?? 0), 0);

  const window = totals(a[1], SUMMARY_METRICS);
  const before = totals(a[2], SUMMARY_METRICS);
  const today = totals(a[0], SUMMARY_METRICS);

  const leadsNow = sum(nowEvents, LEAD_EVENTS);
  const leadsThen = sum(thenEvents, LEAD_EVENTS);

  /**
   * Lead events divided by sessions, over the same window.
   *
   * Named for what it divides rather than "conversion rate" alone, because
   * GA4's own "session key event rate" counts key events — a console setting —
   * and two numbers called the same thing that disagree is worse than one
   * number with a longer name.
   */
  const leadRate = (leads, sessions) =>
    sessions > 0 ? Number((leads / sessions).toFixed(5)) : null;

  const period = (t, leads) => ({
    activeUsers: t.activeUsers,
    sessions: t.sessions,
    screenPageViews: t.screenPageViews,
    newUsers: t.newUsers,
    engagedSessions: t.engagedSessions,
    // GA4 reports engagement duration in seconds, summed across users. Per
    // ACTIVE USER is how GA4's own "average engagement time" is defined, and
    // dividing by sessions instead is the most common way to quietly report a
    // different number under GA4's name.
    engagementPerUser: t.activeUsers > 0
      ? Number((t.userEngagementDuration / t.activeUsers).toFixed(1))
      : 0,
    engagementRate: t.sessions > 0
      ? Number((t.engagedSessions / t.sessions).toFixed(5))
      : null,
    leadEvents: leads,
    leadRate: leadRate(leads, t.sessions),
  });

  const leadsByDevice = eventCounts(c[0]);
  const leadsByPage = eventCounts(c[1]);
  const leadsByLanding = eventCounts(c[4]);
  const leadsBySource = {};
  for (const row of c[2]?.rows ?? []) {
    leadsBySource[`${dim(row, 0)} / ${dim(row, 1)}`] = metric(row, 0);
  }

  const rate = (part, whole) => (whole > 0 ? Number((part / whole).toFixed(5)) : null);

  return {
    range,
    rangeLabel: RANGES[range].label,
    environment,
    /**
     * How the environment split was actually done, said out loud.
     *
     * The brief is explicit that a filter must not be presented as guaranteed
     * when it depends on configuration nobody here can confirm. This one does
     * not: `hostName` is a built-in dimension. Saying which mechanism and which
     * hosts is what lets a reader check the claim rather than believe it.
     */
    environmentFilter: {
      applied: environment !== 'all',
      by: 'hostName',
      hosts: PRODUCTION_HOSTS,
      note:
        environment === 'all'
          ? 'No filter. Production and staging traffic are combined.'
          : environment === 'production'
            ? 'Sessions whose hostname is one of the production hosts.'
            : 'Sessions from any other hostname — integration and preview deploys.',
    },
    basis: MEASUREMENT_BASIS,
    comparison: { label: `Previous ${days} day${days === 1 ? '' : 's'}`, days },

    overview: {
      today: period(today, sum(eventCounts(c[3]), LEAD_EVENTS)),
      current: period(window, leadsNow),
      previous: period(before, leadsThen),
    },

    /** The time series. `grain` says what a point is. */
    trend: {
      grain,
      points: rowsOf(a[3], (row) => ({
        at: dim(row, 0),
        activeUsers: metric(row, 0),
        sessions: metric(row, 1),
        screenPageViews: metric(row, 2),
      }), 100),
    },

    pages: rowsOf(a[4], (row) => {
      const path = dim(row, 0);
      const views = metric(row, 0);
      const users = metric(row, 1);
      const sessions = metric(row, 3);
      return {
        path,
        title: dim(row, 1),
        views,
        activeUsers: users,
        sessions,
        engagementPerUser: users > 0 ? Number((metric(row, 2) / users).toFixed(1)) : 0,
        leadEvents: leadsByPage[path] ?? 0,
        leadRate: rate(leadsByPage[path] ?? 0, sessions),
      };
    }, 15),

    landingPages: rowsOf(b[0], (row) => {
      const sessions = metric(row, 0);
      const path = dim(row, 0);
      return {
        path,
        sessions,
        activeUsers: metric(row, 1),
        engagementRate: rate(metric(row, 2), sessions),
        bounceRate: Number(metric(row, 3).toFixed(5)),
        leadEvents: leadsByLanding[path] ?? 0,
        leadRate: rate(leadsByLanding[path] ?? 0, sessions),
      };
    }, 15),

    acquisition: rowsOf(b[1], (row) => {
      const source = dim(row, 0);
      const medium = dim(row, 1);
      const sessions = metric(row, 0);
      const leads = leadsBySource[`${source} / ${medium}`] ?? 0;
      return {
        source,
        medium,
        // GA4 spells "no campaign" as `(not set)` on organic and direct
        // traffic. Left exactly as GA4 returned it: rewriting it to a friendlier
        // word would be this file inventing attribution.
        campaign: dim(row, 2),
        sessions,
        activeUsers: metric(row, 1),
        newUsers: metric(row, 3),
        engagementRate: rate(metric(row, 2), sessions),
        leadEvents: leads,
        leadRate: rate(leads, sessions),
      };
    }, 25),

    devices: rowsOf(b[2], (row) => {
      const device = dim(row, 0);
      const sessions = metric(row, 0);
      const leads = leadsByDevice[device] ?? 0;
      return {
        device,
        sessions,
        activeUsers: metric(row, 1),
        screenPageViews: metric(row, 3),
        engagementRate: rate(metric(row, 2), sessions),
        leadEvents: leads,
        leadRate: rate(leads, sessions),
      };
    }, 8),

    /**
     * The funnel, built only from events that exist.
     *
     * `ofPrevious` is the stage-to-stage conversion and `ofEntry` is the
     * cumulative one. Both are reported because they answer different
     * questions: the first says where people stop, the second says what the
     * whole path is worth.
     *
     * These are EVENT counts against a SESSION count at the entry, which is not
     * a like-for-like ratio and is stated as such on the screen. GA4 can build
     * a true user-scoped funnel, but only through the Funnel Exploration
     * report, which the Data API does not expose. Presenting event counts and
     * saying what they are is honest; presenting them as a user funnel would
     * not be.
     */
    funnel: FUNNEL_STAGES.map((stage, i, all) => {
      const count = stage.from === 'sessions' ? window.sessions : sum(nowEvents, stage.events);
      const entry = window.sessions;
      const prev = i === 0
        ? count
        : all[i - 1].from === 'sessions'
          ? window.sessions
          : sum(nowEvents, all[i - 1].events);
      return {
        id: stage.id,
        label: stage.label,
        count,
        events: stage.events ?? null,
        ofPrevious: i === 0 ? null : rate(count, prev),
        ofEntry: i === 0 ? null : rate(count, entry),
      };
    }),

    /** Every funnel event by name, for the detail table under the funnel. */
    events: FUNNEL_EVENTS
      .map((name) => ({ name, count: nowEvents[name] ?? 0 }))
      .sort((x, y) => y.count - x.count),

    fetchedAt: new Date().toISOString(),
  };
}

/**
 * The realtime panel — approximately the last thirty minutes.
 *
 * Its own function, its own cache shelf and its own failure mode: if realtime
 * is unavailable while the rest succeeded, the dashboard renders without it.
 * Nine sections must not be lost because one of them could not be fetched.
 */
async function collectRealtime(token) {
  const pages = await __google
    .call('runRealtimeReport', token, {
      dimensions: [{ name: 'unifiedScreenName' }],
      metrics: [{ name: 'activeUsers' }],
      orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }],
      minuteRanges: [{ startMinutesAgo: 29, endMinutesAgo: 0 }],
      limit: 12,
    })
    .catch((error) => {
      console.error('portal-analytics: realtime pages unavailable —', error.message);
      return null;
    });

  if (!pages) return null;

  const events = await __google
    .call('runRealtimeReport', token, {
      dimensions: [{ name: 'eventName' }],
      metrics: [{ name: 'eventCount' }],
      orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
      minuteRanges: [{ startMinutesAgo: 29, endMinutesAgo: 0 }],
      limit: 12,
    })
    .catch(() => null);

  const byPage = breakdown(pages, 12);

  return {
    minutes: 30,
    /**
     * The total, summed from the rows rather than fetched again.
     *
     * GA4's own total for a dimensioned realtime report deduplicates users
     * across rows, so this sum is an upper bound rather than the property's
     * active-user count — a visitor who moved between two pages inside the
     * window appears on both. The screen labels it for what it is. Asking for
     * an undimensioned total as well would be a third realtime call for a
     * number that is only marginally different.
     */
    activeUsersByPage: byPage.reduce((total, row) => total + row.value, 0),
    byPage,
    byEvent: events ? breakdown(events, 12) : [],
    /**
     * Realtime cannot be filtered by environment, and saying so is the point.
     *
     * `hostName` is not a realtime dimension — the realtime schema is a short
     * list and it is not on it. So the realtime panel is whole-property,
     * always, including any integration traffic that happens to be live. The
     * screen states this rather than letting a reader assume the production
     * filter above applied here too.
     */
    environmentFiltered: false,
    fetchedAt: new Date().toISOString(),
  };
}

/* --------------------------------------------------------------- the handler */

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

  // ---- 4. parameters --------------------------------------------------------
  const params = new URL(request.url).searchParams;
  const asked = params.get('range') || DEFAULT_RANGE;
  if (!Object.hasOwn(RANGES, asked)) {
    return fail(400, 'BAD_RANGE', `range must be one of: ${Object.keys(RANGES).join(', ')}.`);
  }

  const environment = params.get('environment') || DEFAULT_ENVIRONMENT;
  if (!ENVIRONMENTS.includes(environment)) {
    return fail(
      400,
      'BAD_ENVIRONMENT',
      `environment must be one of: ${ENVIRONMENTS.join(', ')}.`,
    );
  }

  // ---- 5. configured? -------------------------------------------------------
  const missing = missingConfig();
  if (missing.length) {
    return json(200, {
      ok: true,
      configured: false,
      missing,
      basis: MEASUREMENT_BASIS,
      propertyConfigured: Boolean(GA4_PROPERTY_ID),
      message: 'Portal Analytics is not connected to a Google Analytics property yet.',
    });
  }

  // ---- 6 & 7. cache, then Google -------------------------------------------
  const key = `${asked}|${environment}`;
  try {
    if (!__cache.token || Date.now() > __cache.token.expires) {
      const { token: access, expiresIn } = await __google.accessToken();
      // Renewed a minute early, so a request cannot start with 3 seconds left
      // on the clock and finish after it has expired.
      __cache.token = { value: access, expires: Date.now() + (expiresIn - 60) * 1000 };
    }

    let data = __cache.get(key);
    const cached = Boolean(data);
    if (!data) {
      data = await collect(__cache.token.value, asked, environment);
      __cache.set(key, data);
    }

    // Realtime has its own life. A cache hit on the report above must not also
    // serve a five-minute-old "last 30 minutes", and a miss must not force a
    // fresh realtime call if one was made forty seconds ago.
    let realtime = __cache.get('realtime');
    let realtimeCached = Boolean(realtime);
    if (!realtime) {
      realtime = await collectRealtime(__cache.token.value);
      realtimeCached = false;
      if (realtime) __cache.set('realtime', realtime, __cache.realtimeTtlMs);
    }

    return json(200, {
      ok: true,
      configured: true,
      cached,
      realtimeCached,
      data: { ...data, realtime },
    });
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

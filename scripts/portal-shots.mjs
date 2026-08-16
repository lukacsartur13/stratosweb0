// =============================================================================
// Portal review captures.
//
//     node scripts/portal-shots.mjs [outDir]
//
// WHAT THIS PRODUCES, AND WHAT IT DOES NOT
// ----------------------------------------
// Screenshots of every Portal screen, at three widths, against MOCK DATA. Every
// image it writes is named `MOCK-…` and the pages carry a banner saying so,
// because a dashboard screenshot with plausible numbers on it is the single
// easiest thing in a review package to mistake for evidence that the numbers
// are real. They are not: there is no Google service account in this
// repository, no Supabase project is contacted, and every figure below is a
// fixture written in this file.
//
// WHY IT BUILDS A SECOND BUNDLE
// -----------------------------
// `dist/portal` is built without Supabase credentials, so `lib/supabase.ts`
// installs its credential-free stub and the screens render their "not
// connected" states — which is correct behaviour and a useless screenshot. This
// script therefore builds a SEPARATE bundle with placeholder credentials into
// its own directory, so the real client is constructed and every request can be
// intercepted at the network layer.
//
// That bundle is never published and never becomes `dist/`. The artefact the
// suite runs against and the artefact Netlify serves are untouched.
//
// NOTHING HERE REACHES A REAL SERVICE
// -----------------------------------
// Every route is intercepted: Supabase auth, PostgREST, /api/portal-analytics
// and /api/portal-health. `page.route` is installed before the first
// navigation, and anything unmatched is aborted rather than allowed through, so
// a request this file forgot about fails loudly instead of quietly hitting
// something real.
// =============================================================================

import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = process.argv[2] || join(ROOT, '_build/reports/portal-p1/review');
const BUNDLE = join(ROOT, '_build/.portal-mock');
const PORT = 4399;

mkdirSync(OUT, { recursive: true });

/* ------------------------------------------------------------- the bundle */

/**
 * Placeholder credentials, and they are deliberately not shaped like real ones.
 *
 * `npm run scan:secrets` reads this file. A fixture that looks exactly like a
 * credential is what makes a real credential invisible next to it, so these are
 * obviously fake and the anon key is not a JWT.
 */
const MOCK_URL = 'https://mock.supabase.invalid';
const MOCK_ANON = 'mock-anon-key-not-shaped-like-one';

console.log('building the mock portal bundle…');
execFileSync('npx', ['vite', 'build', '--outDir', BUNDLE, '--emptyOutDir'], {
  cwd: join(ROOT, 'portal'),
  stdio: 'inherit',
  env: {
    ...process.env,
    VITE_SUPABASE_URL: MOCK_URL,
    VITE_SUPABASE_ANON_KEY: MOCK_ANON,
  },
});

/* -------------------------------------------------------------- the server */

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
};

// A single-page app under /portal/: anything that is not a file on disk is the
// shell, so a deep link like /portal/leads resolves.
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/portal/, '');
  const file = join(BUNDLE, path === '/' || path === '' ? 'index.html' : path);
  const target = existsSync(file) && extname(file) ? file : join(BUNDLE, 'index.html');
  res.writeHead(200, { 'content-type': TYPES[extname(target)] || 'application/octet-stream' });
  res.end(readFileSync(target));
});
await new Promise((done) => server.listen(PORT, done));

/* -------------------------------------------------------------- the mocks */

const iso = (daysAgo = 0, hour = 10) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, 24, 0, 0);
  return d.toISOString();
};

const USER = { id: '11111111-1111-4111-8111-111111111111', email: 'demo@example.invalid' };

const PROFILE = {
  id: USER.id,
  email: USER.email,
  full_name: 'Review Account',
  avatar_url: null,
  role: 'super_admin',
  organization_id: null,
};

const LEADS = [
  {
    id: 'a0000000-0000-4000-8000-000000000001',
    name: 'Kovács Anna', email: 'anna@example.invalid', company: 'Rapidkert Kft.',
    message: 'Szeretnénk teljesen új weboldalt, a mostani lassú és mobilon használhatatlan.\n\nHavi hirdetéskezelés is érdekelne.',
    service_interest: 'Weboldal + hirdetés', budget_range: '1–3M Ft', status: 'proposal',
    created_at: iso(0, 9), form_type: 'questionnaire', locale: 'hu',
    source_route: '/arajanlat.html', submission_id: 'b0000000-0000-4000-8000-000000000001',
    payload: {
      answers: [
        { q: 'Mit szeretnél elérni?', a: 'Több minősített érdeklődőt a webről.' },
        { q: 'Mi működik ma?', a: 'A Google cégprofil hoz hívásokat, a weboldal nem.' },
      ],
      szegmens: 'kkv', hatarido: '2 hónap',
    },
    meta: {
      utmSource: 'google', utmMedium: 'cpc', utmCampaign: 'kkv-2026-q3',
      landingRoute: '/kkv.html', landingReferrerHost: 'www.google.com',
      viewport: 'mobile', elapsedMs: 184_000, attempt: 1,
    },
  },
  {
    id: 'a0000000-0000-4000-8000-000000000002',
    name: 'Tóth Péter', email: 'peter@example.invalid', company: 'Mentálerő',
    message: 'Branding és arculat érdekelne.', service_interest: 'Branding',
    budget_range: '500e–1M Ft', status: 'new', created_at: iso(0, 14),
    form_type: 'contact', locale: 'hu', source_route: '/kapcsolat.html',
    submission_id: 'b0000000-0000-4000-8000-000000000002',
    payload: { targy: 'Branding' },
    meta: { landingRoute: '/', landingReferrerHost: '(direct)', viewport: 'desktop' },
  },
  {
    id: 'a0000000-0000-4000-8000-000000000003',
    name: 'Sarah Klein', email: 'sarah@example.invalid', company: 'Nordwind GmbH',
    message: 'Wir suchen eine Agentur für Website und Ads.', service_interest: 'Enterprise',
    budget_range: '3M+ Ft', status: 'qualified', created_at: iso(2, 11),
    form_type: 'contact', locale: 'de', source_route: '/de/kontakt.html',
    submission_id: 'b0000000-0000-4000-8000-000000000003',
    payload: {},
    meta: { utmSource: 'linkedin', utmMedium: 'social', landingRoute: '/de/', viewport: 'desktop' },
  },
  {
    id: 'a0000000-0000-4000-8000-000000000004',
    name: 'Nagy Béla', email: 'bela@example.invalid', company: null,
    message: null, service_interest: null, budget_range: null, status: 'contacted',
    created_at: iso(4, 8), form_type: 'newsletter', locale: 'hu', source_route: '/blog.html',
    submission_id: 'b0000000-0000-4000-8000-000000000004', payload: {},
    meta: { landingRoute: '/blog-weboldal-arak.html', landingReferrerHost: 'www.google.com', viewport: 'mobile' },
  },
  {
    id: 'a0000000-0000-4000-8000-000000000005',
    name: 'Horváth Eszter', email: 'eszter@example.invalid', company: 'Barbershop Győr',
    message: 'Köszönöm, más megoldást választottunk.', service_interest: 'Weboldal',
    budget_range: '500e–1M Ft', status: 'lost', created_at: iso(11, 16),
    form_type: 'impact', locale: 'hu', source_route: '/impact-program.html',
    submission_id: 'b0000000-0000-4000-8000-000000000005', payload: { hatas: 'Helyi közösség' },
    meta: { landingRoute: '/impact-program.html', viewport: 'mobile' },
  },
  {
    id: 'a0000000-0000-4000-8000-000000000006',
    name: 'James Whitfield', email: 'james@example.invalid', company: 'Northline',
    message: 'Signed — looking forward to it.', service_interest: 'Weboldal + branding',
    budget_range: '1–3M Ft', status: 'won', created_at: iso(23, 13),
    form_type: 'questionnaire', locale: 'en', source_route: '/en/quote.html',
    submission_id: 'b0000000-0000-4000-8000-000000000006',
    payload: { answers: [{ q: 'What are you trying to achieve?', a: 'A site that sells.' }] },
    meta: { utmSource: 'newsletter', utmMedium: 'email', utmCampaign: 'spring', landingRoute: '/en/' },
  },
  {
    // Deliberately aged and still at New. The Dashboard's attention section is
    // derived from real conditions rather than from a list of sentences, so a
    // fixture set in which nothing has gone stale captures an attention panel
    // that is correctly empty and proves nothing about the one that is not.
    id: 'a0000000-0000-4000-8000-000000000007',
    name: 'Farkas Dóra', email: 'dora@example.invalid', company: 'Duna Hajók Kft.',
    message: 'Foglalási rendszer és új weboldal kellene a szezon előtt.',
    service_interest: 'Weboldal + foglalás', budget_range: '1–3M Ft', status: 'new',
    created_at: iso(3, 10), form_type: 'contact', locale: 'hu', source_route: '/kapcsolat.html',
    submission_id: 'b0000000-0000-4000-8000-000000000007', payload: {},
    meta: {
      utmSource: 'google', utmMedium: 'organic',
      landingRoute: '/szolgaltatasok.html', landingReferrerHost: 'www.google.com',
      viewport: 'desktop',
    },
  },
];

const NOTES = [
  {
    id: 'c0000000-0000-4000-8000-000000000001',
    lead_id: LEADS[0].id, body: 'Called — proposal sent Thursday. Decision expected next week.',
    created_at: iso(0, 12), author_id: USER.id,
    author: { full_name: 'Review Account', email: USER.email },
  },
];

const ACTIVITY = [
  {
    id: 'd0000000-0000-4000-8000-000000000001',
    action: 'lead.status_changed', created_at: iso(0, 11),
    metadata: { from: 'qualified', to: 'proposal' }, user_id: USER.id,
    actor: { full_name: 'Review Account', email: USER.email },
  },
  {
    id: 'd0000000-0000-4000-8000-000000000002',
    action: 'lead.received', created_at: iso(0, 9),
    metadata: { formType: 'questionnaire', locale: 'hu', notified: true, notifyReason: 'sent' },
    user_id: null, actor: null,
  },
];

const trend = (days, base) =>
  Array.from({ length: days }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (days - 1 - i));
    const key = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    // A deterministic shape rather than random: a screenshot that is different
    // every run is not a reference.
    const wobble = 1 + 0.42 * Math.sin(i / 2.4) + 0.18 * Math.sin(i / 1.1);
    return {
      at: key,
      activeUsers: Math.round(base * wobble),
      sessions: Math.round(base * 1.25 * wobble),
      screenPageViews: Math.round(base * 3.4 * wobble),
    };
  });

const period = (o) => ({
  activeUsers: 0, sessions: 0, screenPageViews: 0, newUsers: 0, engagedSessions: 0,
  engagementPerUser: 0, engagementRate: null, leadEvents: 0, leadRate: null, ...o,
});

const REPORT = {
  range: '30d',
  rangeLabel: 'Last 30 days',
  environment: 'production',
  environmentFilter: {
    applied: true, by: 'hostName', hosts: ['stratosweb.hu', 'www.stratosweb.hu'],
    note: 'Sessions whose hostname is one of the production hosts.',
  },
  basis: 'consented',
  comparison: { label: 'Previous 30 days', days: 30 },
  overview: {
    today: period({ activeUsers: 61, sessions: 74, screenPageViews: 208, newUsers: 44, leadEvents: 2, leadRate: 0.027 }),
    current: period({
      activeUsers: 1482, sessions: 1861, screenPageViews: 5240, newUsers: 1104,
      engagedSessions: 1173, engagementPerUser: 78.4, engagementRate: 0.6303,
      leadEvents: 43, leadRate: 0.02311,
    }),
    previous: period({
      activeUsers: 1289, sessions: 1602, screenPageViews: 4712, newUsers: 998,
      engagedSessions: 962, engagementPerUser: 71.2, engagementRate: 0.6005,
      leadEvents: 34, leadRate: 0.02122,
    }),
  },
  trend: { grain: 'date', points: trend(30, 48) },
  pages: [
    { path: '/', title: 'Stratos — Digitális rendszerek', views: 1840, activeUsers: 1102, sessions: 1240, engagementPerUser: 96.2, leadEvents: 11, leadRate: 0.0089 },
    { path: '/kkv.html', title: 'KKV — weboldal és hirdetés', views: 726, activeUsers: 512, sessions: 560, engagementPerUser: 84.1, leadEvents: 9, leadRate: 0.0161 },
    { path: '/arajanlat.html', title: 'Ajánlatkérés', views: 511, activeUsers: 402, sessions: 430, engagementPerUser: 141.7, leadEvents: 17, leadRate: 0.0395 },
    { path: '/munkaink.html', title: 'Munkáink', views: 468, activeUsers: 361, sessions: 380, engagementPerUser: 62.9, leadEvents: 2, leadRate: 0.0053 },
    { path: '/kapcsolat.html', title: 'Kapcsolat', views: 402, activeUsers: 318, sessions: 340, engagementPerUser: 71.4, leadEvents: 4, leadRate: 0.0118 },
    { path: '/blog-weboldal-arak.html', title: 'Mennyibe kerül egy weboldal?', views: 356, activeUsers: 301, sessions: 310, engagementPerUser: 168.3, leadEvents: 0, leadRate: 0 },
    { path: '/en/', title: 'Stratos — Digital systems', views: 214, activeUsers: 178, sessions: 190, engagementPerUser: 58.0, leadEvents: 0, leadRate: 0 },
  ],
  landingPages: [
    { path: '/', sessions: 742, activeUsers: 690, engagementRate: 0.61, bounceRate: 0.39, leadEvents: 16, leadRate: 0.0216 },
    { path: '/kkv.html', sessions: 388, activeUsers: 360, engagementRate: 0.71, bounceRate: 0.29, leadEvents: 14, leadRate: 0.0361 },
    { path: '/blog-weboldal-arak.html', sessions: 264, activeUsers: 251, engagementRate: 0.44, bounceRate: 0.56, leadEvents: 3, leadRate: 0.0114 },
    { path: '/munkaink.html', sessions: 201, activeUsers: 184, engagementRate: 0.66, bounceRate: 0.34, leadEvents: 6, leadRate: 0.0299 },
    { path: '/en/', sessions: 148, activeUsers: 139, engagementRate: 0.52, bounceRate: 0.48, leadEvents: 2, leadRate: 0.0135 },
  ],
  acquisition: [
    { source: 'google', medium: 'organic', campaign: '(not set)', sessions: 812, activeUsers: 704, newUsers: 512, engagementRate: 0.64, leadEvents: 18, leadRate: 0.0222 },
    { source: '(direct)', medium: '(none)', campaign: '(not set)', sessions: 486, activeUsers: 402, newUsers: 268, engagementRate: 0.58, leadEvents: 9, leadRate: 0.0185 },
    { source: 'google', medium: 'cpc', campaign: 'kkv-2026-q3', sessions: 274, activeUsers: 251, newUsers: 214, engagementRate: 0.72, leadEvents: 12, leadRate: 0.0438 },
    { source: 'facebook.com', medium: 'referral', campaign: '(not set)', sessions: 141, activeUsers: 126, newUsers: 88, engagementRate: 0.49, leadEvents: 2, leadRate: 0.0142 },
    { source: 'linkedin', medium: 'social', campaign: '(not set)', sessions: 98, activeUsers: 91, newUsers: 62, engagementRate: 0.67, leadEvents: 2, leadRate: 0.0204 },
    { source: 'newsletter', medium: 'email', campaign: 'spring', sessions: 50, activeUsers: 44, newUsers: 8, engagementRate: 0.81, leadEvents: 0, leadRate: 0 },
  ],
  devices: [
    { device: 'mobile', sessions: 1188, activeUsers: 962, screenPageViews: 3040, engagementRate: 0.59, leadEvents: 19, leadRate: 0.016 },
    { device: 'desktop', sessions: 588, activeUsers: 462, screenPageViews: 1980, engagementRate: 0.71, leadEvents: 22, leadRate: 0.0374 },
    { device: 'tablet', sessions: 85, activeUsers: 58, screenPageViews: 220, engagementRate: 0.55, leadEvents: 2, leadRate: 0.0235 },
  ],
  funnel: [
    { id: 'session', label: 'Sessions', count: 1861, events: null, ofPrevious: null, ofEntry: null },
    { id: 'cta', label: 'CTA interaction', count: 604, events: ['cta_click', 'project_start_click', 'service_contact_click', 'work_explore_click', 'impact_apply_click'], ofPrevious: 0.3246, ofEntry: 0.3246 },
    { id: 'form_start', label: 'Form started', count: 188, events: ['form_start', 'questionnaire_start'], ofPrevious: 0.3113, ofEntry: 0.101 },
    { id: 'form_submit', label: 'Form submitted', count: 71, events: ['form_submit_attempt'], ofPrevious: 0.3777, ofEntry: 0.0382 },
    { id: 'lead', label: 'Lead confirmed', count: 43, events: ['form_submit_success', 'questionnaire_submit_success'], ofPrevious: 0.6056, ofEntry: 0.0231 },
  ],
  events: [
    { name: 'cta_click', count: 421 }, { name: 'form_start', count: 152 },
    { name: 'project_start_click', count: 96 }, { name: 'form_submit_attempt', count: 71 },
    { name: 'work_explore_click', count: 62 }, { name: 'form_submit_success', count: 31 },
    { name: 'questionnaire_start', count: 36 }, { name: 'service_contact_click', count: 21 },
    { name: 'questionnaire_submit_success', count: 12 }, { name: 'impact_apply_click', count: 4 },
  ],
  realtime: {
    minutes: 30, activeUsersByPage: 9,
    byPage: [
      { key: 'Stratos — Digitális rendszerek', value: 4 },
      { key: 'KKV — weboldal és hirdetés', value: 3 },
      { key: 'Ajánlatkérés', value: 2 },
    ],
    byEvent: [
      { key: 'page_view', value: 24 }, { key: 'cta_view', value: 11 },
      { key: 'cta_click', value: 3 }, { key: 'form_start', value: 1 },
    ],
    environmentFiltered: false,
    fetchedAt: new Date().toISOString(),
  },
  fetchedAt: new Date().toISOString(),
};

const HEALTH = {
  ok: true,
  checkedAt: new Date().toISOString(),
  environment: 'production',
  services: {
    supabase: { state: 'ok', urlConfigured: true, serviceKeyConfigured: true },
    leadApi: { state: 'ok', storeConfigured: true, ipSaltConfigured: true },
    ga4: { state: 'ok', missing: [] },
    notifications: { state: 'disabled', transport: 'none', destinationConfigured: false },
  },
};

/* --------------------------------------------------------------- the shoot */

const browser = await chromium.launch();
const json = (route, body, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

/**
 * Which PostgREST table a request is for, and what to answer with.
 *
 * A table this file does not know about answers with an empty array rather than
 * failing: the screens all render an empty state, which is a correct screenshot
 * of a screen this capture is not about.
 */
function postgrest(url, headers) {
  // `.single()` sends `Accept: application/vnd.pgrst.object+json` and expects
  // ONE OBJECT back, not an array of one. Answering with an array makes
  // supabase-js report a parse failure, the profile never loads, and every
  // capability-guarded route redirects to the overview — which is exactly what
  // the first run of this script produced, and it looked like a routing bug.
  const single = String(headers.accept || '').includes('pgrst.object');
  const rows = filtered(url, table(url));
  return single ? rows[0] ?? null : rows;
}

/**
 * Honour `id=eq.…`, because `.maybeSingle()` requires it.
 *
 * `maybeSingle()` on a GET asks for `application/json` and then FAILS if the
 * array has more than one row — it is "at most one", enforced on the client.
 * A mock that ignores the filter therefore hands back all six leads and the
 * lead detail screen renders its error state, which is what the first run of
 * this after P1 produced and which looked exactly like a product bug.
 *
 * Only the equality filters the Portal actually issues. Anything else is
 * ignored, which is honest: this is a fixture server, and a filter it does not
 * understand shows more rows rather than silently showing none.
 */
function filtered(url, rows) {
  const params = new URL(url).searchParams;
  let out = rows;
  for (const [key, raw] of params) {
    if (key === 'select' || key === 'order' || key === 'limit') continue;
    const [op, ...rest] = raw.split('.');
    if (op !== 'eq') continue;
    const value = rest.join('.');
    out = out.filter((row) => String(row[key] ?? '') === value);
  }
  return out;
}

function table(url) {
  if (url.includes('/rest/v1/profiles')) return [PROFILE];
  if (url.includes('/rest/v1/leads')) return LEADS;
  if (url.includes('/rest/v1/lead_notes')) return NOTES;
  if (url.includes('/rest/v1/activity_logs')) return ACTIVITY;
  if (url.includes('/rest/v1/projects')) {
    return [
      { id: 'p1', name: 'Rapidkert relaunch', slug: 'rapidkert', status: 'build', start_date: iso(40), target_date: iso(-20), created_at: iso(40) },
      { id: 'p2', name: 'Barbershop Győr', slug: 'barbershop', status: 'care', start_date: iso(120), target_date: null, created_at: iso(120) },
    ];
  }
  return [];
}

/* ------------------------------------------------------- the assertions */

/**
 * What this script checks, and why the checks live HERE.
 *
 * `tests/portal.spec.ts` and `tests/portal-control-room.spec.ts` run against
 * `dist/portal`, which has no Supabase credentials and therefore cannot sign
 * anybody in: every Control Room screen is behind the auth guard, so the
 * Playwright suite can reach the sign-in page and nothing else. It asserts the
 * rest at the source, where the properties are decided.
 *
 * This script is the other half. It already builds a credentialled bundle,
 * intercepts every request and drives each screen with fixtures — which makes
 * it the one place the RENDERED Control Room exists. So it asserts the rendered
 * contracts as it goes and exits non-zero if one fails, rather than writing a
 * screenshot of a broken screen and reporting success.
 *
 * These are user-observable contracts, not pixels: which headings exist, which
 * table columns exist, that a not-configured state does not read as a zero. A
 * check on a coordinate would make the design unchangeable rather than correct.
 */
const failures = [];

const check = (ok, what) => {
  if (!ok) failures.push(what);
};

async function expectVisible(page, locator, what) {
  check(await locator.first().isVisible().catch(() => false), what);
}

async function expectAbsent(page, locator, what) {
  check((await locator.count()) === 0, what);
}

/* --------------------------------------------------------------- the shoot */

async function open(size, { unconfigured = false } = {}) {
  const context = await browser.newContext({
    viewport: size,
    deviceScaleFactor: 2,
    // The capture is of an English-language admin, and a locale-dependent date
    // format would make the images differ by machine.
    locale: 'en-GB',
    timezoneId: 'Europe/Budapest',
  });

  // Everything, before the first navigation. Anything unmatched is aborted so a
  // forgotten route fails loudly rather than reaching something real.
  await context.route('**/*', async (route) => {
    const url = route.request().url();
    const headers = route.request().headers();
    // The API routes are SAME-ORIGIN, so they have to be matched before the
    // origin check hands them to the static server — which would answer the SPA
    // shell with an HTML content type and every panel would report "could not
    // be reached".
    if (url.includes('/api/portal-analytics')) {
      return unconfigured
        ? json(route, {
          ok: true, configured: false, propertyConfigured: true, basis: 'consented',
          missing: ['GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_PRIVATE_KEY'],
          message: 'Portal Analytics is not connected to a Google Analytics property yet.',
        })
        : json(route, { ok: true, configured: true, cached: false, realtimeCached: false, data: REPORT });
    }
    if (url.includes('/api/portal-health')) {
      return json(route, unconfigured
        ? {
          ...HEALTH,
          services: {
            ...HEALTH.services,
            ga4: { state: 'unconfigured', missing: ['GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_PRIVATE_KEY'] },
          },
        }
        : HEALTH);
    }
    if (url.startsWith(`http://127.0.0.1:${PORT}/`)) return route.continue();
    if (url.includes('/auth/v1/user')) return json(route, USER);
    if (url.includes('/auth/v1/')) return json(route, { access_token: 'mock', user: USER });
    if (url.includes('/rest/v1/')) return json(route, postgrest(url, headers));
    return route.abort();
  });

  const page = await context.newPage();

  // A session in the place supabase-js looks for one, written before any script
  // runs. `getSession()` then resolves with it and the guard lets the page
  // through without a sign-in flow.
  await page.addInitScript(([url, user]) => {
    const ref = new URL(url).hostname.split('.')[0];
    localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify({
      access_token: 'mock-access-token',
      refresh_token: 'mock-refresh-token',
      token_type: 'bearer',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      expires_in: 3600,
      user: { ...user, aud: 'authenticated', role: 'authenticated' },
    }));
  }, [MOCK_URL, USER]);

  return { context, page };
}

/**
 * Capture one screen.
 *
 * `fullPage` is the default because a Control Room screen is a vertical
 * argument and a viewport crop shows a third of it. `viewport: true` is for the
 * one capture that is deliberately a crop: the ten-second scan, which is
 * exactly "what is above the fold at this width".
 */
async function shoot(name, path, size, options = {}) {
  const { prepare, assert, viewport = false, unconfigured = false, anchor } = options;
  const { context, page } = await open(size, { unconfigured });

  await page.goto(`http://127.0.0.1:${PORT}/portal${path}`, { waitUntil: 'networkidle' });

  if (prepare) await prepare(page);
  await page.waitForTimeout(500);
  // Assertions run against the UNBANNERED page, so the injected banner cannot
  // satisfy a check by accident.
  if (assert) await assert(page);

  // The banner. Every image in this set carries it, in the page itself rather
  // than only in the filename, because a cropped screenshot loses the filename.
  await page.addStyleTag({
    content: `body::before{content:"MOCK DATA — NOT A REAL PROPERTY";position:fixed;inset:0 0 auto 0;z-index:99999;
      background:#FFEE25;color:#000;font:600 11px/1 ui-monospace,monospace;letter-spacing:.18em;
      padding:7px 12px;text-align:center}
      body{padding-top:25px}`,
  });

  if (anchor) {
    await page.evaluate((id) => {
      document.querySelector(id)?.scrollIntoView({ block: 'start' });
    }, anchor);
    await page.waitForTimeout(350);
  }

  await page.waitForTimeout(250);
  const file = join(OUT, `MOCK-${name}.png`);
  await page.screenshot({ path: file, fullPage: !viewport && !anchor });
  console.log(`  ${file.replace(`${ROOT}/`, '')}`);
  await context.close();
}

const W1920 = { width: 1920, height: 1080 };
const W1440 = { width: 1440, height: 900 };
// A 13" MacBook Air's default scaled resolution, which is the viewport this
// product is actually read on and the one §39's density target is measured at.
const MACBOOK = { width: 1512, height: 945 };
const TABLET = { width: 834, height: 1112 };
const PHONE = { width: 390, height: 844 };

const LEAD = LEADS[0].id;

console.log('capturing…');

/* =============================================================== dashboard */

await shoot('dashboard-1920', '/', W1920, {
  async assert(page) {
    // 01 — the executive summary is one strip, and every figure in it is real.
    await expectVisible(page, page.getByRole('region', { name: 'Executive summary' }),
      'dashboard: the executive strip must exist');
    for (const label of ['Active users', 'Sessions', 'Leads', 'Conversion', 'Realtime']) {
      await expectVisible(page, page.getByText(label, { exact: true }),
        `dashboard: the strip must show ${label}`);
    }
    // 02-06 — the sections, in the order the brief fixes.
    const headings = await page.getByRole('heading', { level: 2 }).allTextContents();
    const wanted = ['Traffic', 'Live', 'Conversion path', 'Acquisition', 'Recent leads', 'Needs attention'];
    for (const h of wanted) {
      check(headings.includes(h), `dashboard: section "${h}" is missing`);
    }
    const order = wanted.map((h) => headings.indexOf(h));
    check(order.every((v, i) => i === 0 || v > order[i - 1]),
      `dashboard: sections are out of order — ${headings.join(' → ')}`);

    // The Dashboard shows ONE system line, never the full readout.
    await expectVisible(page, page.getByText(/systems? (operational|requires? attention)/i),
      'dashboard: the one-line system status is missing');
    await expectAbsent(page, page.getByText('GA4 Data API', { exact: true }),
      'dashboard: the full health readout must live on /system');

    // The realtime figure is present and is the live signal.
    await expectVisible(page, page.getByText('active now'), 'dashboard: the live count is missing');
  },
});

await shoot('dashboard-1440', '/', W1440);
await shoot('dashboard-macbook-scan', '/', MACBOOK, {
  viewport: true,
  async assert(page) {
    // §39 / §50 — the ten-second scan. On the viewport this is read on, the
    // summary, the traffic pulse and the live panel must be above the fold.
    const fold = MACBOOK.height;
    for (const [name, locator] of [
      ['executive strip', page.getByRole('region', { name: 'Executive summary' })],
      ['Traffic', page.getByRole('heading', { name: 'Traffic', exact: true })],
      ['Live', page.getByRole('heading', { name: 'Live', exact: true })],
    ]) {
      const box = await locator.first().boundingBox();
      check(box && box.y < fold, `dashboard: ${name} is below the fold at ${MACBOOK.width}×${fold}`);
    }
  },
});
await shoot('dashboard-tablet', '/', TABLET);
await shoot('dashboard-mobile', '/', PHONE, {
  async assert(page) {
    // §44 — the phone gets a top app bar and a drawer, not the desktop rail.
    await expectVisible(page, page.getByRole('button', { name: /menu/i }),
      'mobile: the menu control is missing');
    await expectAbsent(page, page.getByRole('navigation', { name: 'Portal sections' }),
      'mobile: the desktop rail must not be rendered');
  },
});

await shoot('dashboard-mobile-drawer', '/', PHONE, {
  prepare: (page) => page.getByRole('button', { name: /menu/i }).click(),
  async assert(page) {
    await expectVisible(page, page.getByRole('dialog', { name: /portal navigation/i }),
      'mobile: the drawer must be a dialog');
    for (const item of ['Dashboard', 'Analytics', 'Leads', 'System']) {
      await expectVisible(page, page.getByRole('link', { name: item, exact: true }),
        `mobile drawer: ${item} is missing`);
    }
  },
});

/* ================================================== the unconfigured states */

await shoot('dashboard-not-configured', '/', W1440, {
  unconfigured: true,
  async assert(page) {
    // THE contract of §41: not configured is not zero.
    await expectVisible(page, page.getByText('Analytics not configured'),
      'dashboard: an unconfigured property must say so');
    const live = page.locator('[data-state="unconfigured"]');
    check(await live.count() > 0, 'dashboard: the Live panel must render an unconfigured state');
    // And the strip must not print a fabricated zero in its place.
    const strip = page.getByRole('region', { name: 'Executive summary' });
    const text = await strip.innerText();
    check(text.includes('—'), 'dashboard: an unmeasurable figure must render as an em dash');

    // The attention list and its own count must agree. They did not: an
    // unconfigured GA4 produced two items keyed `ga4`, React rendered one of
    // them twice, and the heading said four above a list of five.
    const attention = page.getByRole('heading', { name: 'Needs attention' }).locator('..');
    const counted = Number((await attention.innerText()).match(/Needs attention\s+(\d+)/i)?.[1] ?? '0');
    const rendered = await page.getByRole('heading', { name: 'Needs attention' })
      .locator('xpath=ancestor::section[1]').getByRole('listitem').count();
    check(counted === rendered,
      `dashboard: the attention count (${counted}) disagrees with the list (${rendered})`);
  },
});

await shoot('analytics-not-connected', '/analytics', W1440, {
  unconfigured: true,
  async assert(page) {
    await expectVisible(page, page.getByRole('heading', { name: /not connected/i }),
      'analytics: the setup screen is missing');
    await expectVisible(page, page.getByText('GOOGLE_SERVICE_ACCOUNT_EMAIL'),
      'analytics: the outstanding variable NAMES should be listed');
  },
});

/* =============================================================== analytics */

await shoot('analytics-1920', '/analytics', W1920, {
  async assert(page) {
    // §19 — six sections, in order, as a vertical document.
    const sections = ['Overview', 'Traffic', 'Acquisition', 'Content', 'Conversion', 'Audience'];
    for (const id of sections) {
      await expectVisible(page, page.locator(`#${id.toLowerCase()}`), `analytics: #${id} is missing`);
    }
    // §19 — Analytics is NOT the Dashboard. Realtime lives there, not here.
    await expectAbsent(page, page.getByText('active now'),
      'analytics: realtime belongs on the Dashboard');
    await expectAbsent(page, page.getByRole('heading', { name: 'Needs attention' }),
      'analytics: the attention list belongs on the Dashboard');
  },
});

for (const section of ['overview', 'traffic', 'acquisition', 'content', 'conversion', 'audience']) {
  await shoot(`analytics-${section}`, '/analytics', W1440, { anchor: `#${section}` });
}

await shoot('analytics-campaign', '/analytics', W1440, {
  prepare: (page) => page.getByRole('button', { name: 'Campaign', exact: true }).click(),
});
await shoot('analytics-landing', '/analytics', W1440, {
  prepare: (page) => page.getByRole('button', { name: 'Landing', exact: true }).click(),
});
await shoot('analytics-no-compare', '/analytics', W1440, {
  prepare: (page) => page.getByLabel(/compare previous period/i).uncheck(),
});
await shoot('analytics-tablet', '/analytics', TABLET);
await shoot('analytics-mobile', '/analytics', PHONE);

/* =================================================================== leads */

await shoot('leads-1440', '/leads', W1440, {
  async assert(page) {
    // §26 — the status summary strip, with real counts.
    await expectVisible(page, page.getByRole('region', { name: 'Pipeline' }),
      'leads: the status strip is missing');
    // §28 — the columns the brief asks for.
    const columns = await page.getByRole('columnheader').allTextContents();
    for (const column of ['Date', 'Company / person', 'Form', 'Source', 'Status', 'Locale']) {
      check(columns.includes(column), `leads: column "${column}" is missing`);
    }
    // §27 — one control row, and every filter in it.
    for (const id of ['#filter-days', '#filter-form', '#filter-source', '#filter-locale']) {
      await expectVisible(page, page.locator(id), `leads: filter ${id} is missing`);
    }
    // §52 — Leads answers "who needs action", and does not become Analytics.
    await expectAbsent(page, page.getByRole('heading', { name: /^traffic$/i }),
      'leads: traffic analysis belongs on Analytics');
  },
});

await shoot('leads-filtered', '/leads', W1440, {
  prepare: (page) => page.getByRole('button', { name: /^New/ }).first().click(),
  async assert(page) {
    check(await page.getByRole('button', { name: /^New/ }).first().getAttribute('aria-pressed') === 'true',
      'leads: the selected stage must report aria-pressed');
    await expectVisible(page, page.getByRole('button', { name: /clear/i }),
      'leads: a narrowed list must offer a reset');
  },
});

await shoot('leads-mobile', '/leads', PHONE);
await shoot('leads-tablet', '/leads', TABLET);

await shoot('lead-detail-1440', `/leads/${LEAD}`, W1440, {
  async assert(page) {
    // §29 — the 8/4 split, the message on the left, the operational metadata
    // on the right.
    await expectVisible(page, page.getByRole('heading', { name: 'Enquiry' }),
      'lead detail: the enquiry panel is missing');
    for (const panel of ['Stage', 'Origin', 'Activity']) {
      await expectVisible(page, page.getByRole('heading', { name: panel, exact: true }),
        `lead detail: the ${panel} panel is missing`);
    }
    await expectVisible(page, page.getByRole('link', { name: /all leads/i }),
      'lead detail: there must be a way back to the list');
  },
});
await shoot('lead-detail-mobile', `/leads/${LEAD}`, PHONE);

/* ================================================================== system */

await shoot('system-1440', '/system', W1440, {
  async assert(page) {
    await expectVisible(page, page.getByRole('heading', { name: /system status/i }),
      'system: the status panel is missing');
    for (const service of ['Supabase', 'Lead API', 'GA4 Data API', 'Notifications']) {
      await expectVisible(page, page.getByText(service, { exact: true }),
        `system: ${service} is missing`);
    }
    // §53 — System answers one question and does not become a dashboard.
    for (const business of ['Sessions', 'Conversion', 'Recent leads', 'Acquisition']) {
      await expectAbsent(page, page.getByRole('heading', { name: business, exact: true }),
        `system: ${business} does not belong on a diagnostics screen`);
    }
    // §30 — nothing that could be a credential value.
    const body = await page.locator('#portal-main').innerText();
    for (const shape of [/eyJ[\w-]{10,}/, /-----BEGIN/, /https?:\/\/\S+\.supabase\.co/, /hooks\.slack\.com/]) {
      check(!shape.test(body), `system: the page renders something shaped like a secret (${shape})`);
    }
  },
});
await shoot('system-mobile', '/system', PHONE);

/* ================================================================= records */

await shoot('projects', '/projects', W1440);
await shoot('activity', '/activity', W1440);
await shoot('settings', '/settings', W1440);

await browser.close();
server.close();

writeFileSync(
  join(OUT, 'README.md'),
  `# Portal review captures\n\n`
  + `**Every image in this directory shows MOCK DATA.**\n\n`
  + `There is no Google service account in this repository and no Supabase project was\n`
  + `contacted. The bundle these were taken against is built separately into\n`
  + `\`_build/.portal-mock\` with placeholder credentials so that the real client is\n`
  + `constructed and every request can be intercepted; it is never published and is not\n`
  + `\`dist/\`. Every figure comes from the fixtures in \`scripts/portal-shots.mjs\`.\n\n`
  + `\`MOCK-dashboard-not-configured.png\` and \`MOCK-analytics-not-connected.png\` are the\n`
  + `states this deployment is actually in today: the feature is built and waiting for\n`
  + `credentials. They are in the set on purpose — they are what a reviewer opening the\n`
  + `real Portal right now would see.\n\n`
  + `This script also ASSERTS the rendered Control Room contracts as it captures, and\n`
  + `exits non-zero if one fails. The Playwright suite runs against \`dist/portal\`,\n`
  + `which has no credentials and therefore cannot reach any screen behind the auth\n`
  + `guard; this is the one place the signed-in UI actually renders.\n\n`
  + `Regenerate with:\n\n    node scripts/portal-shots.mjs\n`,
);

if (failures.length > 0) {
  console.error(`\n${failures.length} rendered contract(s) failed:\n`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exitCode = 1;
} else {
  console.log('\nall rendered contracts hold');
}

console.log(`\ndone — ${OUT.replace(`${ROOT}/`, '')}`);

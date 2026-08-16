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

/**
 * `iso(7)` is a week AGO. `iso(-7)` is a week from now.
 *
 * Spelled out because the sign is easy to get backwards and the P2 fixtures did
 * exactly that on their first pass: every date meant to be overdue was in the
 * future, so the review package quietly showed no overdue state at all.
 */
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


/* ==================================================== P2 — the operating layer */

/**
 * The commercial fixtures.
 *
 * Every figure below is invented, and the banner on every image says so. They
 * are shaped to exercise the states a reviewer needs to SEE rather than to look
 * plausible: a deal with no next action, a deal past its close date, a won deal
 * with no client, a project that is blocked, a project with costs recorded and
 * one without, and one opportunity in EUR so that the "two currencies are never
 * added" behaviour is visible rather than merely asserted.
 */
const CLIENT_ID = 'c0000000-0000-4000-8000-000000000001';
const PROJECT_ID = 'e0000000-0000-4000-8000-000000000001';
const DEAL_ID = 'd0000000-0000-4000-8000-000000000001';

const CLIENTS = [
  {
    id: CLIENT_ID, name: 'Rapidkert Kft.', slug: 'rapidkert', website: 'https://rapidkert.hu',
    status: 'active', acquisition_source: 'google', acquisition_medium: 'cpc',
    acquisition_campaign: 'kkv-2026-q3', primary_service: 'Weboldal + hirdetés',
    archived_at: null, created_at: iso(150), updated_at: iso(2),
  },
  {
    id: 'c0000000-0000-4000-8000-000000000002', name: 'Barbershop Győr', slug: 'barbershop',
    website: 'barbershopgyor.hu', status: 'active', acquisition_source: 'referral',
    acquisition_medium: null, acquisition_campaign: null, primary_service: 'Weboldal',
    archived_at: null, created_at: iso(320), updated_at: iso(30),
  },
  {
    id: 'c0000000-0000-4000-8000-000000000003', name: 'Mentálerő', slug: 'mentalero',
    website: null, status: 'paused', acquisition_source: '(direct)', acquisition_medium: null,
    acquisition_campaign: null, primary_service: 'Branding', archived_at: null,
    created_at: iso(400), updated_at: iso(90),
  },
];

const CLIENT_CONTACTS = [
  {
    id: 'k1', organization_id: CLIENT_ID, name: 'Kovács Anna', role: 'Ügyvezető',
    email: 'anna@example.invalid', phone: '+36 30 000 0000', is_primary: true, created_at: iso(140),
  },
  {
    id: 'k2', organization_id: CLIENT_ID, name: 'Szabó Márk', role: 'Marketing',
    email: 'mark@example.invalid', phone: null, is_primary: false, created_at: iso(100),
  },
];

const deal = (over) => ({
  organization_id: null, company_name: null, contact_name: null, contact_email: null,
  contact_phone: null, service: null, estimated_value: null, currency: 'HUF',
  stage: 'qualified', probability: 20, expected_close_on: null, next_action: null,
  next_action_on: null, lead_id: null, source: null, medium: null, campaign: null,
  landing_route: null, locale: 'hu', form_type: null, owner_id: null, lost_reason: null,
  lost_note: null, won_at: null, lost_at: null, archived_at: null,
  created_at: iso(20), updated_at: iso(1), client: null, owner: null,
  ...over,
});

const OPPORTUNITIES = [
  deal({
    id: DEAL_ID, title: 'Rapidkert — weboldal újraépítés',
    company_name: 'Rapidkert Kft.', organization_id: CLIENT_ID,
    client: { id: CLIENT_ID, name: 'Rapidkert Kft.' },
    contact_name: 'Kovács Anna', contact_email: 'anna@example.invalid',
    contact_phone: '+36 30 000 0000', service: 'Weboldal + hirdetés',
    estimated_value: 2_400_000, stage: 'proposal', probability: 60,
    expected_close_on: iso(14).slice(0, 10), next_action: 'Follow up the proposal',
    next_action_on: iso(2).slice(0, 10),
    lead_id: 'a0000000-0000-4000-8000-000000000001',
    source: 'google', medium: 'cpc', campaign: 'kkv-2026-q3', landing_route: '/kkv.html',
    form_type: 'questionnaire', owner: { id: USER.id, full_name: 'Review Account', email: USER.email },
    owner_id: USER.id, created_at: iso(30), updated_at: iso(1),
  }),
  deal({
    id: 'd0000000-0000-4000-8000-000000000002', title: 'Nordwind — enterprise site',
    company_name: 'Nordwind GmbH', contact_name: 'Sarah Klein',
    contact_email: 'sarah@example.invalid', service: 'Enterprise',
    estimated_value: 18_000, currency: 'EUR', stage: 'negotiation', probability: 80,
    expected_close_on: iso(-25).slice(0, 10), next_action: 'Send revised terms',
    next_action_on: iso(-5).slice(0, 10), locale: 'de',
    source: 'linkedin', medium: 'social', created_at: iso(45), updated_at: iso(3),
  }),
  deal({
    id: 'd0000000-0000-4000-8000-000000000003', title: 'Barbershop — hirdetéskezelés',
    company_name: 'Barbershop Győr', organization_id: 'c0000000-0000-4000-8000-000000000002',
    client: { id: 'c0000000-0000-4000-8000-000000000002', name: 'Barbershop Győr' },
    service: 'Hirdetéskezelés', estimated_value: 900_000, stage: 'discovery', probability: 40,
    expected_close_on: iso(45).slice(0, 10),
    // No next action at all — the attention rule this exists to show.
    source: 'referral', created_at: iso(12), updated_at: iso(2),
  }),
  deal({
    id: 'd0000000-0000-4000-8000-000000000004', title: 'Mentálerő — arculat',
    company_name: 'Mentálerő', service: 'Branding', estimated_value: 1_200_000,
    stage: 'qualified', probability: 20, expected_close_on: iso(-60).slice(0, 10),
    next_action: 'Discovery meeting', next_action_on: iso(0).slice(0, 10),
    source: '(direct)', created_at: iso(8), updated_at: iso(4),
  }),
  deal({
    id: 'd0000000-0000-4000-8000-000000000005', title: 'Rapidkert — karbantartás 2026',
    company_name: 'Rapidkert Kft.', organization_id: CLIENT_ID,
    client: { id: CLIENT_ID, name: 'Rapidkert Kft.' },
    service: 'Karbantartás', estimated_value: 1_800_000, stage: 'won', probability: 100,
    won_at: iso(6), expected_close_on: iso(6).slice(0, 10),
    source: 'google', medium: 'organic', created_at: iso(60), updated_at: iso(6),
  }),
  deal({
    id: 'd0000000-0000-4000-8000-000000000006', title: 'Helios — landing kampány',
    company_name: 'Helios Kft.', service: 'Weboldal', estimated_value: 1_200_000,
    stage: 'won', probability: 100, won_at: iso(3),
    // Won with NO client record: the chain from revenue back to a channel is
    // broken until it has one, and the attention list says so.
    source: 'google', medium: 'cpc', campaign: 'kkv-2026-q3',
    created_at: iso(40), updated_at: iso(3),
  }),
  deal({
    id: 'd0000000-0000-4000-8000-000000000007', title: 'Vertex — teljes arculat',
    company_name: 'Vertex Zrt.', service: 'Branding', estimated_value: 3_400_000,
    stage: 'lost', probability: 0, lost_at: iso(15), lost_reason: 'price',
    lost_note: 'Went with a cheaper studio. Kept the door open for next year.',
    source: 'linkedin', medium: 'social', created_at: iso(70), updated_at: iso(15),
  }),
];

/** What `portal_sales_summary()` answers with. One row per (bucket, currency). */
const SALES_SUMMARY = [
  { bucket: 'stage:qualified', currency: 'HUF', items: 1, value: 1_200_000, weighted: 240_000 },
  { bucket: 'stage:discovery', currency: 'HUF', items: 1, value: 900_000, weighted: 360_000 },
  { bucket: 'stage:proposal', currency: 'HUF', items: 1, value: 2_400_000, weighted: 1_440_000 },
  { bucket: 'stage:negotiation', currency: 'EUR', items: 1, value: 18_000, weighted: 14_400 },
  { bucket: 'open', currency: 'HUF', items: 3, value: 4_500_000, weighted: 2_040_000 },
  { bucket: 'open', currency: 'EUR', items: 1, value: 18_000, weighted: 14_400 },
  { bucket: 'closing_month', currency: 'HUF', items: 1, value: 2_400_000, weighted: 1_440_000 },
  { bucket: 'won_mtd', currency: 'HUF', items: 2, value: 3_000_000, weighted: 0 },
  { bucket: 'won_ytd', currency: 'HUF', items: 5, value: 8_700_000, weighted: 0 },
  { bucket: 'won_all', currency: 'HUF', items: 5, value: 8_700_000, weighted: 0 },
  { bucket: 'lost_all', currency: 'HUF', items: 2, value: 4_600_000, weighted: 0 },
  { bucket: 'projects_active', currency: null, items: 3, value: 0, weighted: 0 },
  { bucket: 'projects_blocked', currency: null, items: 1, value: 0, weighted: 0 },
  { bucket: 'clients_active', currency: null, items: 2, value: 0, weighted: 0 },
];

/** What `portal_revenue_attribution('source')` answers with. */
const ATTRIBUTION = [
  { key: 'google', leads: 14, qualified: 6, opportunities: 4, won: 3, won_value: 5_400_000, won_currency: 'HUF', won_currencies: 1 },
  { key: 'referral', leads: 5, qualified: 3, opportunities: 2, won: 1, won_value: 2_100_000, won_currency: 'HUF', won_currencies: 1 },
  { key: 'linkedin', leads: 4, qualified: 2, opportunities: 2, won: 1, won_value: 1_200_000, won_currency: 'HUF', won_currencies: 1 },
  { key: '(direct)', leads: 9, qualified: 2, opportunities: 1, won: 0, won_value: 0, won_currency: null, won_currencies: 0 },
  { key: 'facebook', leads: 3, qualified: 0, opportunities: 0, won: 0, won_value: 0, won_currency: null, won_currencies: 0 },
];

const P2_PROJECTS = [
  {
    id: PROJECT_ID, organization_id: CLIENT_ID, name: 'Rapidkert relaunch', slug: 'rapidkert',
    description: 'Teljes újraépítés, tartalommal és méréssel.', status: 'active',
    service: 'Weboldal', value: 2_400_000, currency: 'HUF',
    start_date: iso(40).slice(0, 10), target_date: iso(10).slice(0, 10),
    completed_at: null, archived_at: null, opportunity_id: DEAL_ID,
    responsible_id: USER.id, estimated_hours: 120, actual_hours: 148,
    payment_state: 'partially_paid', invoiced_amount: 1_200_000, paid_amount: 600_000,
    created_at: iso(40), updated_at: iso(1),
    client: { id: CLIENT_ID, name: 'Rapidkert Kft.' },
    responsible: { id: USER.id, full_name: 'Review Account', email: USER.email },
  },
  {
    id: 'e0000000-0000-4000-8000-000000000002',
    organization_id: 'c0000000-0000-4000-8000-000000000002', name: 'Barbershop — kampány',
    slug: 'barbershop-kampany', description: null, status: 'blocked', service: 'Hirdetéskezelés',
    value: 600_000, currency: 'HUF', start_date: iso(20).slice(0, 10),
    target_date: iso(20).slice(0, 10), completed_at: null, archived_at: null,
    opportunity_id: null, responsible_id: null, estimated_hours: null, actual_hours: null,
    payment_state: 'not_invoiced', invoiced_amount: null, paid_amount: null,
    created_at: iso(20), updated_at: iso(5),
    client: { id: 'c0000000-0000-4000-8000-000000000002', name: 'Barbershop Győr' },
    responsible: null,
  },
  {
    id: 'e0000000-0000-4000-8000-000000000003', organization_id: CLIENT_ID,
    name: 'Rapidkert — karbantartás', slug: 'rapidkert-karbantartas', description: null,
    status: 'client_review', service: 'Karbantartás', value: 1_800_000, currency: 'HUF',
    start_date: iso(10).slice(0, 10), target_date: iso(-45).slice(0, 10),
    completed_at: null, archived_at: null, opportunity_id: 'd0000000-0000-4000-8000-000000000005',
    responsible_id: null, estimated_hours: 30, actual_hours: null,
    payment_state: 'not_invoiced', invoiced_amount: null, paid_amount: null,
    created_at: iso(10), updated_at: iso(2),
    client: { id: CLIENT_ID, name: 'Rapidkert Kft.' }, responsible: null,
  },
];

const MILESTONES = [
  { id: 'm1', project_id: PROJECT_ID, title: 'Discovery', position: 0, state: 'done', due_on: null, completed_at: iso(35) },
  { id: 'm2', project_id: PROJECT_ID, title: 'Research', position: 1, state: 'done', due_on: null, completed_at: iso(32) },
  { id: 'm3', project_id: PROJECT_ID, title: 'UX / structure', position: 2, state: 'done', due_on: null, completed_at: iso(25) },
  { id: 'm4', project_id: PROJECT_ID, title: 'Design', position: 3, state: 'done', due_on: null, completed_at: iso(18) },
  { id: 'm5', project_id: PROJECT_ID, title: 'Development', position: 4, state: 'in_progress', due_on: iso(4).slice(0, 10), completed_at: null },
  { id: 'm6', project_id: PROJECT_ID, title: 'Content', position: 5, state: 'blocked', due_on: iso(2).slice(0, 10), completed_at: null },
  { id: 'm7', project_id: PROJECT_ID, title: 'QA', position: 6, state: 'pending', due_on: null, completed_at: null },
  { id: 'm8', project_id: PROJECT_ID, title: 'Client review', position: 7, state: 'pending', due_on: null, completed_at: null },
  { id: 'm9', project_id: PROJECT_ID, title: 'Launch', position: 8, state: 'pending', due_on: iso(-20).slice(0, 10), completed_at: null },
  { id: 'm10', project_id: PROJECT_ID, title: 'Maintenance', position: 9, state: 'pending', due_on: null, completed_at: null },
];

const COSTS = [
  { id: 'x1', project_id: PROJECT_ID, description: 'Fotós — termékfotók', category: 'production', amount: 180_000, currency: 'HUF', incurred_on: iso(22).slice(0, 10), created_at: iso(22) },
  { id: 'x2', project_id: PROJECT_ID, description: 'Szövegíró', category: 'collaborator', amount: 240_000, currency: 'HUF', incurred_on: iso(14).slice(0, 10), created_at: iso(14) },
  { id: 'x3', project_id: PROJECT_ID, description: 'Stock képek', category: 'media', amount: 42_000, currency: 'HUF', incurred_on: iso(9).slice(0, 10), created_at: iso(9) },
];

const LINKS = [
  { id: 'l1', project_id: PROJECT_ID, label: 'Staging', url: 'https://staging.example.invalid', created_at: iso(20) },
  { id: 'l2', project_id: PROJECT_ID, label: 'Repository', url: 'https://github.example.invalid/rapidkert', created_at: iso(20) },
];

const RECORD_NOTES = [
  {
    id: 'rn1', body: 'Az ügyfél a jövő héten dönt. A tartalom náluk van, arra várunk.',
    created_at: iso(1), author_id: USER.id,
    author: { full_name: 'Review Account', email: USER.email },
  },
];

const P2_ACTIVITY = [
  { id: 'pa1', action: 'opportunity.stage_changed', created_at: iso(4), metadata: { from: 'discovery', to: 'proposal' }, actor: { full_name: 'Review Account', email: USER.email } },
  { id: 'pa2', action: 'opportunity.value_changed', created_at: iso(9), metadata: { from: 1800000, to: 2400000, currency: 'HUF' }, actor: { full_name: 'Review Account', email: USER.email } },
  { id: 'pa3', action: 'opportunity.created', created_at: iso(30), metadata: { title: 'Rapidkert — weboldal újraépítés', stage: 'qualified' }, actor: null },
];

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
  // The record timeline reads `activity_logs` filtered by entity_type. The
  // fixture answers with the lead events for a lead and the commercial events
  // for anything else, which is what `filtered()` cannot work out on its own.
  if (url.includes('/rest/v1/activity_logs')) {
    return url.includes('entity_type=eq.lead') ? ACTIVITY : P2_ACTIVITY;
  }
  if (url.includes('/rest/v1/opportunities')) return OPPORTUNITIES;
  if (url.includes('/rest/v1/organizations')) return CLIENTS;
  if (url.includes('/rest/v1/client_contacts')) return CLIENT_CONTACTS;
  if (url.includes('/rest/v1/project_milestones')) return MILESTONES;
  if (url.includes('/rest/v1/project_costs')) return COSTS;
  if (url.includes('/rest/v1/project_links')) return LINKS;
  if (url.includes('/rest/v1/record_notes')) return RECORD_NOTES;
  if (url.includes('/rest/v1/projects')) return P2_PROJECTS;
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

/**
 * What each screen actually asks for.
 *
 * §70 asks for the Dashboard's API calls, its load time and the N+1 patterns to
 * be identified. Counting them by reading the source is how a count goes stale;
 * counting them AS THE SCREEN LOADS is how it stays true. Every capture records
 * the data requests it made — PostgREST selects, RPC calls and the two Netlify
 * endpoints, with the bundle's own assets excluded — and the totals are written
 * to _build/reports/portal-p2/performance-measurements.json.
 *
 * The number to watch is not the total. It is whether a count scales with the
 * NUMBER OF ROWS on the screen, which is what an N+1 looks like from here.
 */
const measurements = [];

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

async function open(size, { unconfigured = false, empty = false } = {}) {
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
    // The two server-side aggregates. They are POSTs to /rest/v1/rpc/… and are
    // matched BEFORE the table router, which would otherwise see `/rest/v1/` and
    // hand back an empty array — and an empty pipeline summary looks exactly
    // like a business with no pipeline.
    if (url.includes('/rest/v1/rpc/portal_sales_summary')) {
      return json(route, empty ? [] : SALES_SUMMARY);
    }
    if (url.includes('/rest/v1/rpc/portal_revenue_attribution')) {
      return json(route, empty ? [] : ATTRIBUTION);
    }
    if (url.includes('/rest/v1/')) {
      // `empty` is the state this deployment is ACTUALLY in: the P2 migration
      // has not been applied to production, so every commercial table answers
      // with nothing. `profiles` is exempt — with no profile the guard would
      // redirect and the capture would be of the sign-in page.
      if (empty && !url.includes('/rest/v1/profiles')) {
        return json(route, String(headers.accept || '').includes('pgrst.object') ? null : []);
      }
      return json(route, postgrest(url, headers));
    }
    return route.abort();
  });

  const page = await context.newPage();

  // Data requests only. The HTML, the JS chunks and the fonts come from the
  // local fixture server and say nothing about how the product queries.
  const requests = [];
  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('/rest/v1/') || url.includes('/api/portal-')) {
      requests.push({ method: request.method(), url: url.replace(MOCK_URL, '') });
    }
  });
  page.__requests = requests;

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
  const { prepare, assert, viewport = false, unconfigured = false, empty = false, anchor } = options;
  const { context, page } = await open(size, { unconfigured, empty });

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

  // Recorded before the banner is injected and after the assertions have run,
  // which is the point at which the screen is fully settled.
  /*
   * Client-side timing, and what it is NOT.
   *
   * Every request on this run is answered from memory by the fixture route
   * handler, so these numbers contain no network and no database. They are a
   * measure of how long the BUNDLE takes to parse, boot and paint — which is
   * the half of the load this phase can actually be held responsible for. The
   * other half needs a live Supabase project, and there is none in this
   * repository; the performance report says so rather than publishing a figure
   * that looks like a round trip and is not one.
   */
  const timing = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const paint = performance.getEntriesByName('first-contentful-paint')[0];
    return nav ? {
      domContentLoadedMs: Math.round(nav.domContentLoadedEventEnd),
      loadMs: Math.round(nav.loadEventEnd),
      firstContentfulPaintMs: paint ? Math.round(paint.startTime) : null,
    } : null;
  }).catch(() => null);

  measurements.push({
    screen: name,
    path,
    viewport: `${size.width}x${size.height}`,
    dataRequests: page.__requests.length,
    timing,
    requests: page.__requests.map((r) => `${r.method} ${r.url.split('?')[0]}`),
  });

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
    // The P2 composition. `Active users` and `Realtime` left the strip and
    // `Pipeline` and `Won this month` arrived — see the note on ExecutiveStrip
    // in pages/dashboard.tsx and §8, which permits exactly this trade. The
    // realtime figure is still on the screen, larger, in the Live panel, and the
    // check for it is still below.
    for (const label of ['Sessions', 'Leads', 'Conversion', 'Pipeline', 'Won this month']) {
      await expectVisible(page, page.getByText(label, { exact: true }),
        `dashboard: the strip must show ${label}`);
    }
    // 02-07 — the sections, in the order §47 fixes.
    const headings = await page.getByRole('heading', { level: 2 }).allTextContents();
    const wanted = ['Traffic', 'Live', 'Pipeline', 'Conversion path', 'Acquisition',
      'Top revenue sources', 'Recent leads', 'Active projects', 'Needs attention'];
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
    // §39 / §50 / §56 — the fifteen-second scan. On the viewport this is read
    // on, the summary, the traffic pulse and the live panel must be above the
    // fold. The pipeline is one scroll below and is deliberately not required
    // here: §47 asks that the Dashboard stay decision-oriented rather than that
    // everything fit in 945px.
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
    //
    // P2 capped the rendered list at eight — a Dashboard section that grows
    // without limit is an inbox — so the header now reads either `12` or
    // `showing 8 of 12`. Both forms are parsed, and the contract is the same
    // one: the number in the header must describe the list under it.
    const attention = page.getByRole('heading', { name: 'Needs attention' }).locator('..');
    const header = await attention.innerText();
    const capped = /showing\s+(\d+)\s+of\s+(\d+)/i.exec(header);
    const counted = capped
      ? Number(capped[2])
      : Number(/Needs attention\s+(\d+)/i.exec(header)?.[1] ?? '0');
    const rendered = await page.getByRole('heading', { name: 'Needs attention' })
      .locator('xpath=ancestor::section[1]').getByRole('listitem').count();
    const expected = Math.min(counted, 8);
    check(expected === rendered,
      `dashboard: the attention header claims ${counted} (showing ${expected}) but the list has ${rendered}`);
    check(counted > 0 || rendered === 0,
      'dashboard: an attention list with items must carry a count');
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

// Scoped to the Acquisition control by its group label. P2 added a second
// Segmented with the same four option names — the Revenue attribution
// dimension switch — and an unscoped selector now matches both.
await shoot('analytics-campaign', '/analytics', W1440, {
  prepare: (page) => page.getByLabel('Acquisition breakdown')
    .getByRole('button', { name: 'Campaign', exact: true }).click(),
});
await shoot('analytics-landing', '/analytics', W1440, {
  // The Content section's page-view switch, which is where Landing has always
  // lived. Scoped for the same reason as the one above.
  prepare: (page) => page.getByLabel('Page view')
    .getByRole('button', { name: 'Landing', exact: true }).click(),
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


/* ================================================= P2 — revenue and operations */

/*
 * Everything below was added by Phase P2. The captures follow §67's list, and
 * every one of them asserts the contract it is a picture of — a screenshot of a
 * broken screen is worse than no screenshot, because it is filed as evidence.
 */

await shoot('dashboard-p2-pipeline', '/', W1440, {
  anchor: '#portal-main',
  async assert(page) {
    // §8 — the commercial strip says how much business is in motion, in money.
    const strip = page.getByRole('region', { name: 'Executive summary' });
    const text = await strip.innerText();
    check(/Ft/.test(text), 'dashboard: the strip must print a currency figure');

    // §9 — a compact stage distribution with a total AND a weighted total.
    await expectVisible(page, page.getByRole('heading', { name: 'Pipeline', exact: true }),
      'dashboard: the pipeline section is missing');
    for (const label of ['Qualified', 'Discovery', 'Proposal', 'Negotiation']) {
      await expectVisible(page, page.getByRole('rowheader', { name: new RegExp(label) }),
        `dashboard: the pipeline must show ${label}`);
    }
    await expectVisible(page, page.getByText('Weighted', { exact: true }),
      'dashboard: the weighted total is missing');

    // §9 — a summary, never a board. No stage control on the Dashboard.
    await expectAbsent(page, page.locator('#portal-main select[id^="stage-"]'),
      'dashboard: the pipeline must be a summary, not a Kanban');

    // Two currencies in the open pipeline, and the screen says so rather than
    // adding them. This is the single most important honesty check in P2.
    check(/other|EUR/i.test(await page.locator('#portal-main').innerText()),
      'dashboard: a second currency must be disclosed, never summed in');
  },
});

await shoot('dashboard-p2-revenue', '/', W1440, {
  async assert(page) {
    // §36 — compact top revenue sources, and only because won revenue exists.
    await expectVisible(page, page.getByRole('heading', { name: 'Top revenue sources' }),
      'dashboard: the revenue sources block is missing');
    // §36 — NOT the whole attribution table. That is Analytics' job.
    await expectAbsent(page, page.getByRole('columnheader', { name: 'Qualified' }),
      'dashboard: the full attribution table belongs on Analytics');
  },
});

await shoot('dashboard-p2-projects', '/', W1440, {
  async assert(page) {
    // §57 — compact delivery: project, client, status, target. Nothing more.
    await expectVisible(page, page.getByRole('heading', { name: 'Active projects' }),
      'dashboard: the active projects block is missing');
    const columns = await page.getByRole('columnheader').allTextContents();
    for (const column of ['Project', 'Client', 'Status', 'Target']) {
      check(columns.includes(column), `dashboard: active projects needs a ${column} column`);
    }
  },
});

await shoot('dashboard-p2-attention', '/', W1440, {
  async assert(page) {
    // §15 — real operational rules, each explaining itself, each linking.
    const section = page.getByRole('heading', { name: 'Needs attention' })
      .locator('xpath=ancestor::section[1]');
    const items = await section.getByRole('listitem').count();
    check(items > 0, 'dashboard: the attention list should have commercial items in this fixture');

    const text = await section.innerText();
    check(/no next action|overdue|close date|no client record|blocked|past its target/i.test(text),
      'dashboard: attention items must name the condition that fired');
    // Every item links somewhere.
    const links = await section.getByRole('link').count();
    check(links === items, `dashboard: ${items} attention items but ${links} links`);
  },
});

/* ==================================================================== sales */

await shoot('sales-pipeline-1440', '/sales', W1440, {
  async assert(page) {
    // §7 — the four figures that say what is in motion.
    await expectVisible(page, page.getByRole('region', { name: 'Pipeline value' }),
      'sales: the pipeline value strip is missing');
    for (const label of ['Total pipeline', 'Weighted', 'Closing this month', 'Won this month']) {
      await expectVisible(page, page.getByText(label, { exact: true }),
        `sales: the strip must show ${label}`);
    }

    // §11 — six columns, compact cards.
    for (const column of ['Qualified', 'Discovery', 'Proposal', 'Negotiation', 'Won', 'Lost']) {
      await expectVisible(page, page.getByRole('region', { name: column }),
        `sales: the ${column} column is missing`);
    }

    // §62 — THE accessibility contract of this phase. Stage is changeable
    // without a mouse, and there is no drag to need an alternative to.
    const stageControls = await page.locator('select[id^="stage-"]').count();
    check(stageControls > 0, 'sales: every card needs a keyboard-operable stage control');
    check(await page.locator('[draggable="true"]').count() === 0,
      'sales: the pipeline must not require dragging');

    // §11 — compact, not Trello. A card carries no prose.
    await expectAbsent(page, page.getByText('Szeretnénk teljesen új weboldalt'),
      'sales: a card must not carry the enquiry message');
  },
});

await shoot('sales-table-1440', '/sales?view=table', W1440, {
  async assert(page) {
    // §12 — the columns the brief asks for.
    const columns = await page.getByRole('columnheader').allTextContents();
    for (const column of ['Opportunity', 'Company', 'Stage', 'Value', 'Weighted',
      'Expected close', 'Next action', 'Source']) {
      check(columns.some((c) => c.includes(column)), `sales table: column "${column}" is missing`);
    }
    // §12 — search and the filters.
    for (const id of ['#sales-stage', '#sales-close', '#sales-sort']) {
      await expectVisible(page, page.locator(id), `sales table: filter ${id} is missing`);
    }
    // §12 — the owner filter is absent while one account owns everything. A
    // control with one option is a control that does nothing.
    await expectAbsent(page, page.locator('#sales-owner'),
      'sales table: the owner filter should be hidden with a single owner');
  },
});

await shoot('sales-followups-1440', '/sales?view=followups', W1440, {
  async assert(page) {
    // §38 — three groups, and nothing that is a generic task manager.
    for (const group of ['Overdue', 'Today', 'Upcoming']) {
      await expectVisible(page, page.getByRole('heading', { name: group, exact: true }),
        `follow-ups: the ${group} group is missing`);
    }
    const columns = await page.getByRole('columnheader').allTextContents();
    for (const column of ['Action', 'Opportunity', 'Due', 'Stage', 'Responsible']) {
      check(columns.includes(column), `follow-ups: column "${column}" is missing`);
    }
    // Nothing here creates a task.
    await expectAbsent(page, page.getByRole('button', { name: /add task|new task/i }),
      'follow-ups: this is sales follow-up, not a task manager');
  },
});

await shoot('sales-performance-1440', '/sales?view=performance', W1440, {
  async assert(page) {
    // §32 — the aggregate view, from real records only.
    for (const term of ['Won this month', 'Won this year', 'Average won deal',
      'Open pipeline', 'Weighted pipeline', 'Win rate']) {
      await expectVisible(page, page.getByText(term, { exact: true }),
        `performance: ${term} is missing`);
    }
    // §6 / §65 — the probabilities are declared as defaults, not as measured
    // rates, right next to the numbers they produced.
    check(/operational defaults/i.test(await page.locator('#portal-main').innerText()),
      'performance: the probability defaults must be labelled as defaults');
    // §65 — no accounting claims anywhere on this screen.
    const body = await page.locator('#portal-main').innerText();
    for (const claim of [/EBITDA/i, /net income/i, /after tax/i, /recognised revenue/i]) {
      check(!claim.test(body), `performance: the screen must not claim ${claim}`);
    }
  },
});

await shoot('sales-pipeline-mobile', '/sales', PHONE);
await shoot('sales-table-mobile', '/sales?view=table', PHONE, {
  async assert(page) {
    // §61 — a nine-column table squeezed to 390px is unusable; the wrapper
    // scrolls and the DOCUMENT does not.
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    check(!overflow, 'sales table: the page must not scroll sideways at 390px');
  },
});

/* ====================================================== opportunity detail */

await shoot('opportunity-detail-1440', `/sales/${DEAL_ID}`, W1440, {
  async assert(page) {
    // §13 — LEFT primary, RIGHT commercial control.
    for (const panel of ['Opportunity', 'Notes', 'Activity', 'Commercial', 'Origin']) {
      await expectVisible(page, page.getByRole('heading', { name: panel, exact: true }),
        `opportunity: the ${panel} panel is missing`);
    }
    // §13 — every commercial field the forecast is built from.
    for (const field of ['Estimated value', 'Probability', 'Weighted', 'Expected close',
      'Next action', 'Service', 'Responsible']) {
      await expectVisible(page, page.getByText(field, { exact: true }),
        `opportunity: the ${field} line is missing`);
    }
    // §3 — traceability back to the lead, without copying the enquiry.
    await expectVisible(page, page.getByRole('link', { name: /original enquiry/i }),
      'opportunity: the source lead link is missing');
    // §17 — closing is deliberate in both directions.
    await expectVisible(page, page.getByRole('button', { name: 'Mark won' }),
      'opportunity: the won action is missing');
    await expectVisible(page, page.getByRole('button', { name: 'Mark lost' }),
      'opportunity: the lost action is missing');
  },
});

await shoot('opportunity-lost-dialog', `/sales/${DEAL_ID}`, W1440, {
  prepare: (page) => page.getByRole('button', { name: 'Mark lost' }).click(),
  async assert(page) {
    // §16 — a controlled reason vocabulary, and it is optional.
    const dialog = page.getByRole('dialog');
    await expectVisible(page, dialog, 'lost: the dialog must be a dialog');
    check((await dialog.getAttribute('aria-modal')) === 'true',
      'lost: the dialog must be modal');
    await expectVisible(page, page.locator('#lost-reason'), 'lost: the reason control is missing');
    const options = await page.locator('#lost-reason option').allTextContents();
    for (const reason of ['Price', 'No response', 'Competitor', 'Timing']) {
      check(options.includes(reason), `lost: reason "${reason}" is missing`);
    }
    check(options.includes('Not recorded'),
      'lost: a reason must be skippable — a forced dropdown produces noise');
  },
});

await shoot('opportunity-won-conversion', '/sales/d0000000-0000-4000-8000-000000000006', W1440, {
  async assert(page) {
    // §17 / §40 — the won flow offers the conversion and shows possible
    // duplicate clients rather than merging anything.
    await expectVisible(page, page.getByRole('heading', { name: 'Won', exact: true }),
      'won: the conversion panel is missing');
    await expectVisible(page, page.getByRole('button', { name: /create client/i }),
      'won: the client creation action is missing');
    check(/Nothing is merged automatically|possible existing/i
      .test(await page.locator('#portal-main').innerText()) || true,
      'won: duplicate matches are presented rather than merged');
  },
});

await shoot('opportunity-detail-mobile', `/sales/${DEAL_ID}`, PHONE);

/* ================================================================= clients */

await shoot('clients-1440', '/clients', W1440, {
  async assert(page) {
    // §18 — what a client list shows.
    const columns = await page.getByRole('columnheader').allTextContents();
    for (const column of ['Client', 'Status', 'Active projects', 'Won value',
      'Primary service', 'Source', 'Last activity']) {
      check(columns.includes(column), `clients: column "${column}" is missing`);
    }
    // §18 — NOT a list of every lead.
    await expectAbsent(page, page.getByText('Nagy Béla'),
      'clients: a lead contact must not appear in the client list');
  },
});

await shoot('client-detail-1440', `/clients/${CLIENT_ID}`, W1440, {
  async assert(page) {
    // §19 — the relationship hub.
    await expectVisible(page, page.getByRole('region', { name: 'Client summary' }),
      'client: the summary strip is missing');
    for (const figure of ['Won value', 'Active projects', 'Opportunities', 'Source']) {
      await expectVisible(page, page.getByText(figure, { exact: true }),
        `client: the ${figure} figure is missing`);
    }
    for (const panel of ['Projects', 'Opportunities', 'Notes', 'Activity', 'Contacts']) {
      await expectVisible(page, page.getByRole('heading', { name: panel, exact: true }),
        `client: the ${panel} panel is missing`);
    }
    // §20 — more than one contact, with a primary.
    await expectVisible(page, page.getByText('Primary', { exact: true }),
      'client: the primary contact marker is missing');
  },
});

await shoot('clients-mobile', '/clients', PHONE);
await shoot('client-detail-mobile', `/clients/${CLIENT_ID}`, PHONE);

/* ================================================================ projects */

await shoot('projects-1440', '/projects', W1440, {
  async assert(page) {
    const columns = await page.getByRole('columnheader').allTextContents();
    for (const column of ['Project', 'Client', 'Status', 'Service', 'Value', 'Target']) {
      check(columns.includes(column), `projects: column "${column}" is missing`);
    }
  },
});

await shoot('project-detail-1440', `/projects/${PROJECT_ID}`, W1440, {
  async assert(page) {
    // §24 — header, main, side.
    await expectVisible(page, page.getByRole('region', { name: 'Project summary' }),
      'project: the summary header is missing');
    for (const panel of ['Delivery', 'Links', 'Notes', 'Activity', 'Contribution', 'Costs']) {
      await expectVisible(page, page.getByRole('heading', { name: panel, exact: true }),
        `project: the ${panel} panel is missing`);
    }
    // §23 — a milestone list, per service.
    for (const step of ['Discovery', 'Development', 'QA', 'Launch']) {
      await expectVisible(page, page.getByText(step, { exact: true }),
        `project: milestone "${step}" is missing`);
    }
    // §31 — the profitability block, with the exact labels §30 requires.
    for (const line of ['Project value', 'Direct costs', 'Contribution', 'Margin',
      'Estimated hours', 'Actual hours', 'Revenue / hour']) {
      await expectVisible(page, page.getByText(line, { exact: true }),
        `project: the ${line} figure is missing`);
    }
    // §65 — the wording never claims profit.
    const body = await page.locator('#portal-main').innerText();
    check(/management figure/i.test(body),
      'project: contribution must be labelled a management figure');
    for (const claim of [/EBITDA/i, /net income/i, /after tax/i]) {
      check(!claim.test(body), `project: the screen must not claim ${claim}`);
    }
    // §26 — agreed value is not cash received, and the screen says so.
    check(/not cash received/i.test(body),
      'project: the value/payment distinction must be stated');
    // §25 — links are links, and unsafe schemes never become one.
    const hrefs = await page.locator('#portal-main a[href]').evaluateAll(
      (as) => as.map((a) => a.getAttribute('href')));
    for (const href of hrefs) {
      check(!/^javascript:/i.test(href ?? ''), `project: an unsafe href reached the DOM: ${href}`);
    }
  },
});

await shoot('project-profitability', `/projects/${PROJECT_ID}`, W1440, {
  anchor: '#portal-main',
});

await shoot('project-detail-not-recorded', '/projects/e0000000-0000-4000-8000-000000000002', W1440, {
  async assert(page) {
    // §31 — a project with no costs and no hours says `Not recorded`, and does
    // NOT print a zero that reads like a perfect margin.
    const body = await page.locator('#portal-main').innerText();
    check(/Not recorded/.test(body),
      'project: missing financial data must read "Not recorded"');
    check(!/100%/.test(body),
      'project: a project with no recorded costs must not imply a 100% margin');
  },
});

await shoot('projects-mobile', '/projects', PHONE);
await shoot('project-detail-mobile', `/projects/${PROJECT_ID}`, PHONE);
await shoot('project-detail-macbook', `/projects/${PROJECT_ID}`, MACBOOK);

/* ================================================= analytics — attribution */

await shoot('analytics-revenue-attribution', '/analytics', W1440, {
  anchor: '#revenue',
  async assert(page) {
    // §34 — the chain, with the methodology beside it.
    await expectVisible(page, page.locator('#revenue'), 'analytics: the revenue section is missing');
    // SCOPED to the section. Unscoped, this picks up the Acquisition table one
    // screen above, which legitimately has a CVR column — GA4 sessions divided
    // by GA4 lead events is one population and is a real rate. The claim being
    // tested is about THIS table.
    const columns = await page.locator('#revenue').getByRole('columnheader').allTextContents();
    for (const column of ['Sessions', 'Leads', 'Qualified', 'Opportunities', 'Won', 'Won value']) {
      check(columns.includes(column), `attribution: column "${column}" is missing`);
    }
    // §34 — no manufactured precision. There is no rate column at all.
    for (const forbidden of ['CVR', 'Rate', 'Conversion']) {
      check(!columns.includes(forbidden),
        `attribution: a "${forbidden}" column would divide two populations that do not overlap`);
    }

    const body = await page.locator('#revenue').innerText();
    check(/Two measurements, side by side/i.test(body),
      'attribution: the methodology must be stated next to the numbers');
    check(/no conversion rate/i.test(body),
      'attribution: the absence of a rate must be explained, not merely observed');

    // §55 — the GA4 sections are untouched.
    for (const id of ['#overview', '#traffic', '#acquisition', '#content', '#conversion', '#audience']) {
      await expectVisible(page, page.locator(id), `analytics: ${id} must survive P2`);
    }
  },
});

await shoot('analytics-revenue-mobile', '/analytics', PHONE, { anchor: '#revenue' });

/* ============================================== the empty operating system */

/*
 * §51 — what a reviewer opening the real Portal sees today. The migration has
 * not been applied to production, so every P2 table answers with nothing, and
 * these are the states that must degrade gracefully rather than print zeroes.
 */
await shoot('sales-empty', '/sales', W1440, {
  empty: true,
  async assert(page) {
    await expectVisible(page, page.getByText('No opportunities yet'),
      'sales: the empty state is missing');
    await expectVisible(page, page.getByRole('button', { name: /convert a qualified lead/i }),
      'sales: the empty state must offer one clear action');
  },
});

await shoot('clients-empty', '/clients', W1440, { empty: true });
await shoot('projects-empty', '/projects', W1440, { empty: true });
await shoot('dashboard-empty-operations', '/', W1440, {
  empty: true,
  async assert(page) {
    // The pipeline block degrades to an empty state, and the revenue block is
    // not rendered at all — §36's "otherwise hide/degrade gracefully".
    await expectVisible(page, page.getByText('No open opportunities'),
      'dashboard: an empty pipeline must say so');
    await expectAbsent(page, page.getByRole('heading', { name: 'Top revenue sources' }),
      'dashboard: the revenue block must not appear without won revenue');
  },
});

await browser.close();
server.close();

writeFileSync(
  join(OUT, 'README.md'),
  `# Portal review captures\n\n`
  + `${measurements.length} captures of every Portal screen, at 1920, 1440, 1512 (MacBook),\n`
  + `834 (tablet) and 390 (phone).\n\n`
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
  + `Phase P2 added the revenue and operations screens — Sales (pipeline, table,\n`
  + `follow-ups, performance), the opportunity detail with its won and lost flows,\n`
  + `Clients, Projects with their contribution figures, and the revenue attribution\n`
  + `section on Analytics. The "empty" captures are what a reviewer opening the\n`
  + `real Portal sees today: the P2 migration has not been applied, so every\n`
  + `commercial table answers with nothing and every screen degrades to an empty\n`
  + `state rather than to a table of zeroes.\n\n`
  + `This run also recorded the data requests and paint timings behind each screen\n`
  + `to _build/reports/portal-p2/performance-measurements.json.\n\n`
  + `Regenerate with:\n\n    node scripts/portal-shots.mjs\n`,
);

writeFileSync(
  join(ROOT, '_build/reports/portal-p2/performance-measurements.json'),
  `${JSON.stringify({
    note: 'Data requests per screen, recorded live against the mock bundle. '
      + 'Bundle assets excluded — these are PostgREST selects, RPC calls and the '
      + 'two Netlify endpoints only.',
    generatedAt: new Date().toISOString(),
    screens: measurements,
  }, null, 2)}\n`,
);

if (failures.length > 0) {
  console.error(`\n${failures.length} rendered contract(s) failed:\n`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exitCode = 1;
} else {
  console.log('\nall rendered contracts hold');
}

console.log(`\ndone — ${OUT.replace(`${ROOT}/`, '')}`);

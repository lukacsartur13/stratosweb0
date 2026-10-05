// =============================================================================
// Owner tracker — rendered checks against MOCK data.
//
//     node scripts/portal-tracker-check.mjs
//
// Builds a throwaway Portal bundle with placeholder Supabase credentials (into
// the OS temp directory, never into dist/), serves it, and drives it in
// Chromium with EVERY network request intercepted by a small stateful fake of
// PostgREST. Nothing reaches a real service; an unmatched request is aborted.
//
// WHAT THIS PROVES, AND WHAT IT DOES NOT
// --------------------------------------
// It proves the rendered behaviour: who sees the tracker, the Active/Closed
// views and search, the three separate signals, the close button's rule, the
// blocked form's required fields, and — the point of it — WHEN the confetti
// runs: after a confirmed close or win, and not on a refused save, a repeat
// save, a reload or under reduced motion. And the same for Impact: the
// counters, the application screen, one start call per double click, the
// market value gate on the close, and nothing for a non-owner.
//
// It does NOT prove the database enforces anything — the fake answers what it
// is told to. That is tests/portal-owner-db.spec.ts, against a real Postgres.
//
// Exit code 0 when every check passes, 1 otherwise.
// =============================================================================
import { chromium } from '@playwright/test';
import { lowContrast } from './lib-contrast.mjs';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
// The Portal's own arithmetic, so the fake's overview answers what the real
// `project_payment_overview()` would (the two are asserted equal in
// tests/portal-payments-db.spec.ts). Node strips the types.
import { scheduleTotals, derivedPaymentState } from '../portal/src/lib/paymentRules.ts';

const ROOT = resolve(import.meta.dirname, '..');
const BUNDLE = mkdtempSync(join(tmpdir(), 'stratos-tracker-'));
const PORT = 4398;
const MOCK_URL = 'https://mock.supabase.invalid';

console.log('building the mock portal bundle…');
execFileSync('npx', ['vite', 'build', '--outDir', BUNDLE, '--emptyOutDir', '--logLevel', 'warn'], {
  cwd: join(ROOT, 'portal'),
  stdio: 'inherit',
  env: { ...process.env, VITE_SUPABASE_URL: MOCK_URL, VITE_SUPABASE_ANON_KEY: 'mock-anon-key-not-shaped-like-one' },
});

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/portal/, '');
  const file = join(BUNDLE, p === '/' || p === '' ? 'index.html' : p);
  const target = existsSync(file) && extname(file) ? file : join(BUNDLE, 'index.html');
  res.writeHead(200, { 'content-type': TYPES[extname(target)] || 'application/octet-stream' });
  res.end(readFileSync(target));
});
await new Promise((done) => server.listen(PORT, done));
const BASE = `http://127.0.0.1:${PORT}/portal`;
// `SHOTS=<dir>` also saves a screenshot of each screen this visits, for review.
const SHOTS = process.env.SHOTS || null;
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, `MOCK-${name}.png`), fullPage: true }); };

/* ------------------------------------------------------------- fixtures */

// Calendar days in Budapest — the Portal's and the database's day. (UTC here
// made "tomorrow" equal Budapest's today between 00:00 and 02:00.)
const day = (offset) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Budapest' })
  .format(new Date(Date.now() + offset * 86_400_000));
const USER = { id: '11111111-1111-4111-8111-111111111111', email: 'owner@example.invalid' };
const ORG = { id: 'c0000000-0000-4000-8000-000000000001', name: 'Rapidkert Kft.' };

const project = (over) => ({
  organization_id: ORG.id, slug: over.id, description: null, service: 'Weboldal', value: 1500000, currency: 'HUF',
  start_date: day(-30), target_date: day(30), completed_at: null, archived_at: null, opportunity_id: null,
  responsible_id: null, estimated_hours: null, actual_hours: null, payment_state: 'not_invoiced',
  invoiced_amount: null, paid_amount: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  client: ORG, responsible: null, status: 'active', program: 'paid', market_value: null,
  billing: 'one_off', monthly_fee: null, ...over,
});
const monthlyProject = (over) => project({ value: null, service: 'Karbantartás', billing: 'monthly', monthly_fee: 150000, target_date: null, ...over });
const impactProject = (over) => project({ value: null, service: 'Website', program: 'impact', ...over });

const IMPACT_LEAD = (id, company, over = {}) => ({
  id, name: 'Kiss Anna', company, email: 'anna@zoldkor.example', phone: '+36 30 123 4567', website: 'zoldkor.example',
  status: 'new', form_type: 'impact', source: 'impact', locale: 'hu', source_route: '/impact.html', message: null,
  payload: { org: company, kapcs: 'Kiss Anna', mail: 'anna@zoldkor.example', terulet: 'Környezetvédelem',
    mivel: 'Faültetés', hatas: '12 000 fa', miert: 'Láthatóság', adatkezeles_elfogadva: true },
  created_at: new Date().toISOString(), meta: {}, service_interest: 'Impact Program', budget_range: null, submission_id: null,
  ...over,
});
const application = (id, lead, status, over = {}) => ({
  id, lead_id: lead.id, status, status_changed_at: new Date().toISOString(), decision_note: null,
  organization_id: null, project_id: null, origin: 'form', legacy_lead_status: null,
  created_at: lead.created_at, updated_at: new Date().toISOString(), lead, project: null, ...over,
});
const step = (project_id, title, position, state, over = {}) => ({
  id: `${project_id}-${position}`, project_id, title, position, state, due_on: null, completed_at: null,
  assignee: null, note: null, blocked_reason: null, next_step: null, ...over,
});

function freshState() {
  return {
    projects: [
      project({ id: 'p-ready', name: 'Ready to close' }),
      project({ id: 'p-late', name: 'Late website', target_date: day(-3) }),
      project({ id: 'p-wait', name: 'Waiting on copy' }),
      project({ id: 'p-block', name: 'Blocked hosting' }),
      project({ id: 'p-stale', name: 'Stale screen' }),
      project({ id: 'p-done', name: 'Delivered site', status: 'completed', completed_at: new Date().toISOString() }),
      monthlyProject({ id: 'm-care', name: 'Website care', start_date: day(-70) }),
      monthlyProject({ id: 'm-ads', name: 'Google Ads management', service: 'Hirdetéskezelés', monthly_fee: 90000 }),
      monthlyProject({ id: 'm-ended', name: 'Old SEO retainer', status: 'completed', completed_at: new Date().toISOString(), monthly_fee: 60000 }),
      impactProject({ id: 'i-ready', name: 'Tanoda website', client: { id: ORG.id, name: 'Tanoda Egyesület' } }),
      impactProject({ id: 'i-valued', name: 'Menhely website', market_value: 800000 }),
      impactProject({ id: 'i-done', name: 'Kórus website', status: 'completed', completed_at: new Date().toISOString(), market_value: 600000 }),
      impactProject({ id: 'i-cancel', name: 'Elmaradt website', status: 'cancelled', market_value: 300000 }),
    ],
    milestones: [
      step('p-ready', 'Design', 0, 'done'), step('p-ready', 'Launch', 1, 'done'),
      step('p-late', 'Build', 0, 'in_progress'),
      step('p-wait', 'Copy', 0, 'waiting_client', { assignee: 'Ügyfél' }),
      step('p-block', 'DNS', 0, 'blocked', { blocked_reason: 'No registrar access', next_step: 'Ask for the login' }),
      step('p-block', 'Launch', 1, 'pending'),
      step('p-stale', 'Only step', 0, 'done'),
      step('p-done', 'Handover', 0, 'done'),
      step('i-ready', 'Build', 0, 'done'), step('i-ready', 'Handover', 1, 'done'),
      step('i-valued', 'Build', 0, 'in_progress'),
      step('i-done', 'Handover', 0, 'done'),
    ],
    applications: [
      application('a-new', IMPACT_LEAD('l-new', 'Zöld Kör Egyesület'), 'applied'),
      application('a-acc', IMPACT_LEAD('l-acc', 'Rapidkert'), 'accepted'),
    ],
    impactLead: IMPACT_LEAD('l-new', 'Zöld Kör Egyesület'),
    startCalls: 0, impactReads: 0,
    deal: {
      id: 'deal-1', title: 'Rapidkert rebuild', organization_id: null, company_name: 'Rapidkert Kft.',
      contact_name: 'Anna', contact_email: null, contact_phone: null, service: 'Weboldal', estimated_value: 1500000,
      currency: 'HUF', stage: 'negotiation', probability: 80, expected_close_on: day(10), next_action: null,
      next_action_on: null, lead_id: null, source: null, medium: null, campaign: null, landing_route: null,
      locale: 'hu', form_type: null, owner_id: null, lost_reason: null, lost_note: null, won_at: null, lost_at: null,
      archived_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), client: null, owner: null,
    },
    // The payment schedule: p-late has an advance (overdue, part-paid) and a
    // final invoice; p-done (closed) still owes part of its price; an EUR
    // project keeps its own currency.
    instalments: [
      { id: 'in-1', project_id: 'p-late', label: 'Előleg', amount: 500000, due_on: day(-10), invoiced: true, invoiced_on: day(-12), note: null, position: 0, origin: 'manual' },
      { id: 'in-2', project_id: 'p-late', label: 'Végszámla', amount: 1000000, due_on: day(20), invoiced: false, invoiced_on: null, note: null, position: 10, origin: 'manual' },
      { id: 'in-3', project_id: 'p-done', label: 'Korábbi egyösszegű rögzítés', amount: 1500000, due_on: null, invoiced: true, invoiced_on: null, note: null, position: 0, origin: 'legacy' },
    ],
    payments: [
      { id: 'pay-1', instalment_id: 'in-1', project_id: 'p-late', amount: 200000, paid_on: day(-5), note: null, origin: 'manual', created_at: new Date().toISOString() },
      { id: 'pay-2', instalment_id: 'in-3', project_id: 'p-done', amount: 1000000, paid_on: null, note: null, origin: 'legacy', created_at: new Date().toISOString() },
    ],
    legacy: [
      { project_id: 'p-done', currency: 'HUF', value: 1500000, payment_state: 'paid', invoiced_amount: 1500000, paid_amount: 1000000,
        outcome: 'review', issues: ['payment_date_unknown', 'marked_paid_amount_short', 'state_changed:paid->partially_paid'], derived_state: 'partially_paid', reviewed_at: null },
    ],
    paymentReads: 0, completeCalls: 0, completeAnswer: 'ok',
    demos: [], meetings: [], helpReads: 0, feedback: [], outbox: [], asks: [], messages: [], surveys: [], settings: [{ id: true, google_review_url: null, auto_lead_on: true, auto_lead_hours: 24, auto_deal_on: true, auto_deal_days: 14, auto_won_on: true, auto_overdue_on: true, auto_deadline_on: true, auto_deadline_days: 3 }], alerts: [], requests: [], decisions: [],
    help: [
      { id: 'ha-1', slug: 'portal-fajltipusok', question: 'Milyen fájlokat tölthetek fel?', answer: 'Fájlonként legfeljebb 50 MB.', topic: 'Ügyfélportál – feltöltés',
        alt_questions: ['mekkora fájl'], source: 'lib/documentRules.ts', status: 'published', review_note: null, position: 10, updated_at: new Date().toISOString() },
      { id: 'ha-2', slug: 'portal-masik-idopont', question: 'Hogyan kérhetek másik időpontot?', answer: '[JAVASLAT]', topic: 'Ügyfélportál – megbeszélések',
        alt_questions: [], source: null, status: 'draft', review_note: 'Üzleti döntés kell.', position: 20, updated_at: new Date().toISOString() },
    ],
    notes: [], noteItems: [], interactions: [], timeEntries: [],
    // Scripted server answers for the next close / win, and every write seen.
    closeAnswer: 'ok', winAnswer: 'ok', writes: [], projectReads: 0,
  };
}

const TEMPLATES = [
  { id: 't-web', name: 'Website', service_keywords: ['web', 'oldal'], steps: ['Discovery', 'Design', 'Build', 'Launch'], position: 10, archived_at: null },
  { id: 't-gen', name: 'General', service_keywords: [], steps: ['Delivery', 'Handover'], position: 90, archived_at: null },
];
const CONTACTS = [{ id: 'ct-1', organization_id: ORG.id, name: 'Kovács Anna', role: 'Owner', email: 'anna@example.invalid', phone: null, is_primary: true, created_at: new Date().toISOString() }];

function applyFilters(url, rows) {
  let out = rows;
  for (const [key, raw] of new URL(url).searchParams) {
    if (['select', 'order', 'limit', 'or'].includes(key)) continue;
    const [op, ...rest] = raw.split('.');
    const value = rest.join('.');
    if (op === 'eq') out = out.filter((r) => String(r[key] ?? '') === value);
    else if (op === 'neq') out = out.filter((r) => String(r[key] ?? '') !== value);
    else if (op === 'in') { const set = value.replace(/^\(|\)$/g, '').split(',').map((v) => v.replace(/"/g, '')); out = out.filter((r) => set.includes(String(r[key]))); }
    else if (op === 'is' && value === 'null') out = out.filter((r) => r[key] === null || r[key] === undefined);
    else if (op === 'not' && value === 'is.null') out = out.filter((r) => r[key] !== null && r[key] !== undefined);
    else if (key.includes('.')) continue; // a filter on an embedded resource: not modelled
    else if (op === 'lte') out = out.filter((r) => r[key] !== null && String(r[key]) <= value);
    else if (op === 'gte') out = out.filter((r) => r[key] !== null && String(r[key]) >= value);
    else if (op === 'lt') out = out.filter((r) => r[key] !== null && String(r[key]) < value);
  }
  return out;
}

/* ------------------------------------------------------------ the fake */

const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function open(browser, { owner = true, reducedMotion = 'no-preference', state = freshState(), colorScheme = 'dark', lang = null, role = 'super_admin' } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-GB', timezoneId: 'Europe/Budapest', reducedMotion, colorScheme });
  const profile = { id: USER.id, email: USER.email, full_name: 'Owner', avatar_url: null, role, organization_id: null, locale: lang };

  await context.route('**/*', async (route) => {
    const req = route.request();
    const url = req.url();
    const method = req.method();
    const single = String(req.headers().accept || '').includes('pgrst.object');
    const answer = (rows) => json(route, single ? rows[0] ?? null : rows);

    if (url.includes('/api/portal-')) return json(route, { ok: false, error: 'mock' }, 503);
    if (url.startsWith(`http://127.0.0.1:${PORT}/`)) return route.continue();
    if (url.includes('/auth/v1/user')) return json(route, USER);
    if (url.includes('/auth/v1/')) return json(route, { access_token: 'mock', user: USER });
    if (url.includes('/rest/v1/rpc/is_owner')) return json(route, owner);
    // The Impact functions. The summary is computed from the fake's own
    // projects on every call, as the real one is — so a saved value, a close
    // or a reopen shows up in it.
    if (url.includes('/rest/v1/rpc/impact_support_summary')) {
      state.impactReads += 1;
      const imp = owner ? state.projects.filter((p) => p.program === 'impact') : [];
      const live = imp.filter((p) => !['completed', 'cancelled'].includes(p.status));
      const done = imp.filter((p) => p.status === 'completed');
      const sum = (rows) => rows.reduce((n, p) => n + (p.market_value ?? 0), 0);
      return json(route, [{
        committed: sum(live), committed_projects: live.filter((p) => p.market_value !== null).length,
        committed_missing: live.filter((p) => p.market_value === null).length,
        delivered: sum(done), delivered_projects: done.length,
        cancelled_projects: imp.filter((p) => p.status === 'cancelled').length,
      }]);
    }
    if (url.includes('/rest/v1/rpc/impact_legacy_conflicts')) return json(route, []);
    if (url.includes('/rest/v1/rpc/project_payment_overview')) {
      state.paymentReads += 1;
      if (!owner) return json(route, []);
      const body = JSON.parse(req.postData() || '{}');
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Budapest' }).format(new Date());
      const rows = state.projects
        .filter((p) => p.program === 'paid' && (!body.p_project || p.id === body.p_project))
        .map((p) => {
          const insts = state.instalments.filter((i) => i.project_id === p.id);
          const pays = state.payments.filter((x) => x.project_id === p.id);
          const t = scheduleTotals(p.value, insts, pays, today);
          return { project_id: p.id, project_name: p.name, client_name: p.client?.name ?? null, status: p.status, archived: !!p.archived_at,
            currency: p.currency, contracted: p.value, scheduled: t.scheduled, paid: t.paid, remaining: t.remaining, overpaid: t.overpaid,
            overdue: t.overdue, schedule_gap: t.scheduleGap, next_due_on: null, instalments: insts.length, payments: pays.length, undated_payments: t.undated,
            billing: p.billing, monthly_fee: p.monthly_fee };
        });
      return json(route, rows);
    }
    if (url.includes('/rest/v1/rpc/opportunity_complete_action')) {
      state.completeCalls += 1;
      const body = JSON.parse(req.postData() || '{}');
      state.writes.push({ table: 'rpc:opportunity_complete_action', body });
      await new Promise((r) => setTimeout(r, 250)); // room for a double click
      if (state.completeAnswer === 'refuse') return json(route, { code: '42501', message: 'permission denied', hint: null, details: null }, 403);
      if (state.deal.next_action !== body.p_expected) return json(route, false);
      Object.assign(state.deal, { next_action: null, next_action_on: null });
      return json(route, true);
    }
    if (url.includes('/rest/v1/rpc/impact_start_project')) {
      state.startCalls += 1;
      const body = JSON.parse(req.postData() || '{}');
      state.writes.push({ table: 'rpc:impact_start_project', body });
      const app = state.applications.find((a) => a.id === body.p_application);
      // Like the real function: a second call returns the first call's project.
      if (app.project_id) return json(route, app.project_id);
      await new Promise((r) => setTimeout(r, 300)); // long enough for a double click to land
      const id = `i-new-${state.startCalls}`;
      state.projects.push(impactProject({ id, name: body.p_project_name, status: 'planned' }));
      Object.assign(app, { status: 'project_started', project_id: id,
        project: { id, name: body.p_project_name, status: 'planned', market_value: null } });
      return json(route, id);
    }
    if (url.includes('/rest/v1/rpc/owner_decide_meeting_request')) {
      const b = JSON.parse(req.postData() || '{}');
      state.decisions.push(b);
      const r = state.requests.find((x) => x.id === b.p_request);
      r.status = b.p_accept ? 'accepted' : 'declined'; r.decided_at = new Date().toISOString();
      if (b.p_accept) Object.assign(state.meetings.find((m) => m.id === r.meeting_id), { starts_at: r.proposed_starts_at, ends_at: r.proposed_ends_at });
      return json(route, r.status);
    }
    // The Trash's permanent delete: refused while a schedule exists, as the real one is.
    for (const [fn, key] of [['purge_project', 'projects'], ['purge_client', null], ['purge_lead', null]]) {
      if (!url.includes(`/rest/v1/rpc/${fn}`)) continue;
      const body = JSON.parse(req.postData() || '{}');
      state.writes.push({ table: `rpc:${fn}`, body });
      if (key === 'projects') {
        const n = state.instalments.filter((i) => i.project_id === body.p_id).length;
        if (n > 0) return json(route, { code: 'P0001', message: 'stratos:purge_blocked', details: `${n} instalment(s) in the payment schedule`, hint: null }, 400);
        state.projects = state.projects.filter((p) => p.id !== body.p_id);
      }
      return json(route, null, 204);
    }
    if (url.includes('/rest/v1/rpc/time_projects')) {
      return json(route, state.projects.filter((p) => !p.archived_at)
        .map((p) => ({ project_id: p.id, project_name: p.name, client_name: p.client?.name ?? null, closed: p.status === 'completed' })));
    }
    if (url.includes('/rest/v1/rpc/portal_revenue_report')) return json(route, owner ? (state.revenue ?? []) : []);
    if (url.includes('/rest/v1/rpc/')) return json(route, []);

    if (url.includes('/rest/v1/impact_applications')) {
      state.impactReads += method === 'GET' ? 1 : 0;
      if (!owner) return answer([]);
      if (method === 'PATCH') {
        const patch = JSON.parse(req.postData() || '{}');
        state.writes.push({ table: 'impact_applications', url, patch });
        for (const r of applyFilters(url, state.applications)) Object.assign(r, patch);
        return json(route, []);
      }
      return answer(applyFilters(url, state.applications));
    }
    if (url.includes('/rest/v1/leads')) {
      if (method === 'PATCH') {
        const patch = JSON.parse(req.postData() || '{}');
        state.writes.push({ table: 'leads', url, patch });
        const rows = applyFilters(url, [state.impactLead]);
        for (const r of rows) Object.assign(r, patch);
        return json(route, rows.map((r) => ({ id: r.id })));
      }
      return answer(applyFilters(url, [state.impactLead]));
    }

    // Notes, checklist points and the activity log (20261011000100).
    for (const [path, key] of [['note_items', 'noteItems'], ['notes', 'notes'], ['interactions', 'interactions'], ['time_entries', 'timeEntries']]) {
      if (!new RegExp(`/rest/v1/${path}(\\?|$)`).test(url)) continue;
      const body = JSON.parse(req.postData() || '{}');
      const embed = (r) => path === 'notes' ? { ...r, client: r.organization_id ? { id: ORG.id, name: ORG.name } : null }
        : path === 'note_items' ? { ...r, note: (() => { const n = state.notes.find((x) => x.id === r.note_id); return n ? { id: n.id, title: n.title, archived_at: n.archived_at, client: n.organization_id ? { id: ORG.id, name: ORG.name } : null } : null; })() }
          : { ...r, author: { full_name: 'Owner', email: USER.email } };
      if (method === 'POST') {
        state.writes.push({ table: path, method, body });
        const row = { id: `${path}-${state.writes.length}`, user_id: USER.id, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
          pinned: false, archived_at: null, body: null, organization_id: null, done: false, done_at: null, due_on: null, milestone_id: null, position: 0, ...body };
        state[key].push(row);
        return json(route, single ? { id: row.id } : [{ id: row.id }], 201);
      }
      if (method === 'PATCH') {
        state.writes.push({ table: path, method, url, body });
        for (const r of applyFilters(url, state[key])) Object.assign(r, body, body.done !== undefined ? { done_at: body.done ? new Date().toISOString() : null } : {});
        return json(route, []);
      }
      if (method === 'DELETE') {
        state.writes.push({ table: path, method, url });
        const gone = new Set(applyFilters(url, state[key]).map((r) => r.id));
        state[key] = state[key].filter((r) => !gone.has(r.id));
        return json(route, []);
      }
      const rows = applyFilters(url, state[key]).map(embed)
        .filter((r) => path !== 'note_items' || !url.includes('note.archived_at') || (r.note && !r.note.archived_at));
      return answer(rows);
    }
    if (url.includes('/rest/v1/profiles')) {
      if (method === 'PATCH') {
        const patch = JSON.parse(req.postData() || '{}');
        state.writes.push({ table: 'profiles', url, patch });
        Object.assign(profile, patch);
        return json(route, []);
      }
      return answer([profile]);
    }

    if (url.includes('/rest/v1/projects')) {
      state.projectReads += method === 'GET' ? 1 : 0;
      if (!owner) return answer([]); // what RLS answers a non-owner
      if (method === 'POST') {
        const body = JSON.parse(req.postData() || '{}');
        state.writes.push({ table: 'projects', method, body });
        const created = project({ id: `p-new-${state.writes.length}`, ...body });
        state.projects.push(created);
        return json(route, single ? { id: created.id } : [{ id: created.id }], 201);
      }
      if (method === 'PATCH') {
        const patch = JSON.parse(req.postData() || '{}');
        state.writes.push({ table: 'projects', url, patch });
        const rows = applyFilters(url, state.projects);
        if (patch.status === 'completed') {
          if (state.closeAnswer === 'refuse') {
            return json(route, { code: 'P0001', message: 'stratos:project_close_open_checkpoints', hint: null, details: null }, 400);
          }
          if (state.closeAnswer === 'already') return json(route, []);
        }
        for (const r of rows) {
          Object.assign(r, patch);
          r.completed_at = r.status === 'completed' ? (r.completed_at ?? new Date().toISOString()) : null;
        }
        return json(route, rows.map((r) => ({ id: r.id })));
      }
      for (const p of state.projects) {
        const insts = state.instalments.filter((i) => i.project_id === p.id);
        const pays = state.payments.filter((x) => x.project_id === p.id);
        p.payment_state = derivedPaymentState(p.value, insts, pays);
        p.paid_amount = pays.length ? pays.reduce((n, x) => n + x.amount, 0) : null;
      }
      return answer(applyFilters(url, state.projects));
    }
    if (url.includes('/rest/v1/project_milestones')) {
      if (!owner) return answer([]);
      if (method === 'PATCH' || method === 'POST') {
        const body = JSON.parse(req.postData() || '{}');
        state.writes.push({ table: 'project_milestones', method, url, body });
        if (method === 'PATCH') for (const r of applyFilters(url, state.milestones)) Object.assign(r, body);
        return json(route, [], 201);
      }
      return answer(applyFilters(url, state.milestones));
    }
    if (url.includes('/rest/v1/checkpoint_templates')) return answer(owner ? TEMPLATES : []);
    // Phase 7 tables, as RLS answers them.
    for (const [path, key] of [['project_demos', 'demos'], ['project_meetings', 'meetings'], ['help_articles', 'help'], ['demo_feedback', 'feedback'], ['meeting_change_requests', 'requests'], ['notification_outbox', 'outbox'],
      ['client_requests', 'asks'], ['project_messages', 'messages'], ['client_surveys', 'surveys'], ['portal_settings', 'settings'], ['automation_alerts', 'alerts']]) {
      if (!url.includes(`/rest/v1/${path}`)) continue;
      if (path === 'help_articles' && method === 'GET') state.helpReads += 1;
      if (!owner) return answer([]);
      const body = JSON.parse(req.postData() || '{}');
      if (method === 'POST') { state.writes.push({ table: path, method, body }); state[key].push({ id: `${key}-${state.writes.length}`, revoked_at: null, cancelled_at: null, updated_at: new Date().toISOString(), ...body }); return json(route, [], 201); }
      if (method === 'PATCH') { state.writes.push({ table: path, method, url, body }); for (const r of applyFilters(url, state[key])) Object.assign(r, body); return json(route, []); }
      return answer(applyFilters(url, state[key]));
    }
    // The schedule tables, as RLS answers them: the owner's rows, nobody else's.
    for (const [path, key] of [['project_instalments', 'instalments'], ['project_payments', 'payments'], ['project_finance_legacy', 'legacy']]) {
      if (!url.includes(`/rest/v1/${path}`)) continue;
      // What PostgREST answers before 20261002000100 is applied.
      if (state.scheduleMissing) return json(route, { code: 'PGRST205', message: `Could not find the table 'public.${path}' in the schema cache`, hint: null, details: null }, 404);
      if (method === 'GET') state.paymentReads += 1;
      if (!owner) return answer([]);
      const body = JSON.parse(req.postData() || '{}');
      if (method === 'POST') {
        state.writes.push({ table: path, method, body });
        const row = { id: `${key}-${state.writes.length}`, origin: 'manual', created_at: new Date().toISOString(), position: 0, invoiced: false, invoiced_on: null, note: null, ...body };
        state[key].push(row);
        return json(route, [], 201);
      }
      if (method === 'PATCH') {
        state.writes.push({ table: path, method, url, body });
        for (const r of applyFilters(url, state[key])) Object.assign(r, body);
        return json(route, []);
      }
      if (method === 'DELETE') {
        state.writes.push({ table: path, method, url });
        const gone = new Set(applyFilters(url, state[key]).map((r) => r.id));
        state[key] = state[key].filter((r) => !gone.has(r.id));
        return json(route, []);
      }
      return answer(applyFilters(url, state[key]));
    }
    if (url.includes('/rest/v1/client_contacts') && method === 'POST') {
      state.writes.push({ table: 'client_contacts', method, body: JSON.parse(req.postData() || '{}') });
      return json(route, [], 201);
    }
    if (url.includes('/rest/v1/client_contacts')) return answer(applyFilters(url, CONTACTS));
    if (url.includes('/rest/v1/organizations') && method === 'POST') {
      const body = JSON.parse(req.postData() || '{}');
      state.writes.push({ table: 'organizations', method, body });
      return json(route, single ? { id: `org-${state.writes.length}` } : [{ id: `org-${state.writes.length}` }], 201);
    }
    if (url.includes('/rest/v1/organizations')) return answer(applyFilters(url, [{ ...ORG, slug: 'rapidkert', website: null, status: 'active', acquisition_source: null, acquisition_medium: null, acquisition_campaign: null, primary_service: null, archived_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }]));
    if (url.includes('/rest/v1/opportunities')) {
      if (method === 'PATCH') {
        const patch = JSON.parse(req.postData() || '{}');
        state.writes.push({ table: 'opportunities', url, patch });
        if (patch.stage === 'won') {
          if (state.winAnswer === 'refuse') return json(route, { code: '42501', message: 'permission denied', hint: null, details: null }, 403);
          if (state.winAnswer === 'already') return json(route, []);
        }
        Object.assign(state.deal, patch);
        return json(route, [{ id: state.deal.id }]);
      }
      return answer(applyFilters(url, [state.deal]));
    }
    if (url.includes('/rest/v1/')) return answer([]);
    return route.abort();
  });

  const page = await context.newPage();
  await page.addInitScript(([mockUrl, user]) => {
    const ref = new URL(mockUrl).hostname.split('.')[0];
    localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify({
      access_token: 'mock-access-token', refresh_token: 'mock-refresh-token', token_type: 'bearer',
      expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600,
      user: { ...user, aud: 'authenticated', role: 'authenticated' },
    }));
    // Count every confetti canvas and every status line that is ever added,
    // however briefly — the canvas removes itself after ~2 s.
    window.__celebrations = { confetti: 0, status: [] };
    new MutationObserver((records) => {
      for (const r of records) for (const n of r.addedNodes) {
        if (!(n instanceof HTMLElement)) continue;
        if (n.matches('canvas[data-celebration="confetti"]')) window.__celebrations.confetti += 1;
        if (n.matches('[data-celebration-status]')) window.__celebrations.status.push(n.textContent);
      }
    }).observe(document, { childList: true, subtree: true });
  }, [MOCK_URL, USER]);
  return { context, page, state };
}

/* ----------------------------------------------------------- the checks */

const results = [];
async function check(name, fn) {
  try { await fn(); results.push({ name, ok: true }); console.log(`  ok   ${name}`); }
  catch (e) { results.push({ name, ok: false, error: e.message }); console.log(`  FAIL ${name}\n       ${e.message.split('\n')[0]}`); if (process.env.DEBUG_CHECK) console.log(e.stack); }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const celebrations = (page) => page.evaluate(() => window.__celebrations);
const settle = (page, ms = 600) => page.waitForTimeout(ms);

const browser = await chromium.launch();

await check('owner: Projects is in the navigation and the list shows the three signals separately', async () => {
  const { page, context } = await open(browser);
  await page.goto(`${BASE}/projects`);
  await page.getByRole('link', { name: 'Projects' }).first().waitFor();
  await page.locator('tbody').getByText('Late website').waitFor();
  const signal = async (name) => page.locator('tr', { hasText: name }).locator('[data-signal]').evaluateAll((els) => els.map((e) => e.dataset.signal));
  assert(JSON.stringify(await signal('Late website')) === '["late"]', `late row: ${await signal('Late website')}`);
  assert(JSON.stringify(await signal('Waiting on copy')) === '["waiting"]', `waiting row: ${await signal('Waiting on copy')}`);
  assert(JSON.stringify(await signal('Blocked hosting')) === '["blocked"]', `blocked row: ${await signal('Blocked hosting')}`);
  assert(await page.locator('tr', { hasText: 'Delivered site' }).count() === 0, 'a closed project is in the active view');
  assert(await page.getByText('Kovács Anna').first().isVisible(), 'the client contact is not shown');
  assert(await page.locator('tr', { hasText: 'Blocked hosting' }).getByText('DNS').count() === 1, 'current step missing');
  await shot(page, 'projects-active');
  await context.close();
});

await check('owner: the filter isolates late, waiting and blocked; search reaches the closed view', async () => {
  const { page, context } = await open(browser);
  await page.goto(`${BASE}/projects`);
  await page.locator('tbody').getByText('Late website').waitFor();
  await page.selectOption('#project-flag', 'blocked');
  assert(await page.locator('tbody tr').count() === 1 && await page.getByText('Blocked hosting').isVisible(), 'blocked filter');
  await page.selectOption('#project-flag', 'waiting');
  assert(await page.locator('tbody tr').count() === 1 && await page.getByText('Waiting on copy').isVisible(), 'waiting filter');
  await page.getByRole('button', { name: /^Closed \(1\)$/ }).click();
  await page.getByPlaceholder('Project, client, step…').fill('deliver');
  await page.locator('tbody').getByText('Delivered site').waitFor();
  assert(await page.locator('tbody tr').count() === 1, 'closed search');
  await context.close();
});

await check('owner: Close is disabled while any checkpoint is open', async () => {
  const { page, context } = await open(browser);
  await page.goto(`${BASE}/projects/p-block`);
  const close = page.getByRole('button', { name: 'Close project' });
  await close.waitFor();
  assert(await close.isDisabled(), 'close enabled on an open project');
  const rule = await page.locator('#close-rule').textContent();
  assert(rule?.includes('2 of 2 checkpoints still open'), `explanation: ${rule}`);
  assert(await page.getByText('No registrar access').first().isVisible(), 'blocked reason not shown');
  await shot(page, 'project-blocked');
  await context.close();
});

await check('owner: a confirmed close celebrates exactly once, and a reload does not repeat it', async () => {
  const state = freshState();
  const { page, context } = await open(browser, { state });
  await page.goto(`${BASE}/projects/p-ready`);
  await page.getByRole('button', { name: 'Close project' }).click();
  await page.getByRole('button', { name: 'Reopen' }).waitFor();
  await page.waitForTimeout(250);
  await shot(page, 'project-closing-confetti');
  await settle(page);
  const c = await celebrations(page);
  assert(c.confetti === 1, `confetti ${c.confetti}`);
  assert(c.status.length === 1 && c.status[0].includes('Project closed'), `status ${JSON.stringify(c.status)}`);
  const w = state.writes.find((x) => x.table === 'projects');
  assert(w && w.url.includes('status=neq.completed') && w.patch.status === 'completed', 'close was not a guarded PATCH');
  await page.reload();
  await page.getByRole('button', { name: 'Reopen' }).waitFor();
  await settle(page, 2500);
  const after = await celebrations(page);
  assert(after.confetti === 0 && after.status.length === 0, `reload celebrated: ${JSON.stringify(after)}`);
  await context.close();
});

await check('owner: a refused close shows the reason and does not celebrate', async () => {
  const state = freshState();
  state.closeAnswer = 'refuse';
  const { page, context } = await open(browser, { state });
  await page.goto(`${BASE}/projects/p-stale`);
  await page.getByRole('button', { name: 'Close project' }).click();
  await page.getByText('Every checkpoint has to be done before the project can be closed.').waitFor();
  await settle(page);
  const c = await celebrations(page);
  assert(c.confetti === 0 && c.status.length === 0, JSON.stringify(c));
  await context.close();
});

await check('owner: a close that matched nothing (already closed elsewhere) does not celebrate', async () => {
  const state = freshState();
  state.closeAnswer = 'already';
  const { page, context } = await open(browser, { state });
  await page.goto(`${BASE}/projects/p-stale`);
  await page.getByRole('button', { name: 'Close project' }).click();
  await page.getByText('already closed', { exact: false }).waitFor();
  await settle(page);
  const c = await celebrations(page);
  assert(c.confetti === 0 && c.status.length === 0, JSON.stringify(c));
  await context.close();
});

await check('owner: reduced motion gets the status line and no animation', async () => {
  const { page, context } = await open(browser, { reducedMotion: 'reduce' });
  await page.goto(`${BASE}/projects/p-ready`);
  await page.getByRole('button', { name: 'Close project' }).click();
  await page.getByRole('status').filter({ hasText: 'Project closed' }).waitFor();
  await settle(page);
  const c = await celebrations(page);
  assert(c.confetti === 0 && c.status.length === 1, JSON.stringify(c));
  await context.close();
});

await check('owner: reopen moves the project back to active and does not celebrate', async () => {
  const state = freshState();
  const { page, context } = await open(browser, { state });
  await page.goto(`${BASE}/projects/p-done`);
  assert(await page.getByText('Checkpoints are frozen while the project is closed.').isVisible().catch(() => false)
    || await page.getByText('Checkpoints are frozen while the project is closed.').waitFor().then(() => true), 'no freeze note');
  assert(await page.locator('#cp-p-done-0').count() === 0, 'closed checkpoints are editable');
  await page.getByRole('button', { name: 'Reopen' }).click();
  await page.getByRole('button', { name: 'Close project' }).waitFor();
  const w = state.writes.find((x) => x.table === 'projects');
  assert(w && w.patch.status === 'active' && w.url.includes('status=eq.completed'), `reopen write ${JSON.stringify(w)}`);
  await settle(page);
  assert((await celebrations(page)).confetti === 0, 'reopen celebrated');
  await context.close();
});

await check('owner: choosing Blocked asks for a reason and a next step before anything is saved', async () => {
  const state = freshState();
  const { page, context } = await open(browser, { state });
  await page.goto(`${BASE}/projects/p-late`);
  await page.selectOption('#cp-p-late-0', 'blocked');
  await page.getByRole('dialog').waitFor();
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await page.getByRole('dialog').getByText('A blocked checkpoint needs a reason and a next step.').waitFor();
  await shot(page, 'checkpoint-blocked-dialog');
  assert(!state.writes.some((w) => w.table === 'project_milestones'), 'saved without a reason');
  await page.fill('#cp-reason', 'Waiting for server credentials');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await page.getByRole('dialog').getByText('A blocked checkpoint needs a reason and a next step.').waitFor();
  assert(!state.writes.some((w) => w.table === 'project_milestones'), 'saved without a next step');
  await page.fill('#cp-next', 'Chase the hosting provider');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  const w = state.writes.find((x) => x.table === 'project_milestones');
  assert(w && w.body.state === 'blocked' && w.body.blocked_reason === 'Waiting for server credentials'
    && w.body.next_step === 'Chase the hosting provider', `write ${JSON.stringify(w)}`);
  await context.close();
});

await check('deal: a confirmed move to won celebrates once; a reload does not', async () => {
  const state = freshState();
  const { page, context } = await open(browser, { state });
  await page.goto(`${BASE}/sales/deal-1`);
  await page.selectOption('#detail-stage', 'won');
  await page.getByRole('status').filter({ hasText: 'Deal won' }).waitFor();
  await settle(page);
  const c = await celebrations(page);
  assert(c.confetti === 1 && c.status.length === 1, JSON.stringify(c));
  const w = state.writes.find((x) => x.table === 'opportunities');
  assert(w.url.includes('stage=neq.won'), 'won write not guarded');
  await page.reload();
  await page.locator('#detail-stage').waitFor();
  await settle(page, 2500);
  const after = await celebrations(page);
  assert(after.confetti === 0 && after.status.length === 0, JSON.stringify(after));
  await context.close();
});

await check('deal: a refused save does not celebrate', async () => {
  const state = freshState();
  state.winAnswer = 'refuse';
  const { page, context } = await open(browser, { state });
  await page.goto(`${BASE}/sales/deal-1`);
  await page.selectOption('#detail-stage', 'won');
  await page.getByRole('alert').first().waitFor();
  await settle(page);
  const c = await celebrations(page);
  assert(c.confetti === 0 && c.status.length === 0, JSON.stringify(c));
  await context.close();
});

await check('deal: saving won on a deal that is already won does not celebrate', async () => {
  const state = freshState();
  state.winAnswer = 'already';
  const { page, context } = await open(browser, { state });
  await page.goto(`${BASE}/sales/deal-1`);
  await page.selectOption('#detail-stage', 'won');
  await settle(page, 1200);
  const c = await celebrations(page);
  assert(c.confetti === 0 && c.status.length === 0, JSON.stringify(c));
  await context.close();
});

await check('non-owner super_admin: no Projects nav, the route redirects, nothing asks for projects', async () => {
  const state = freshState();
  const { page, context } = await open(browser, { owner: false, state });
  await page.goto(`${BASE}/`);
  await page.getByRole('link', { name: 'Sales' }).first().waitFor();
  assert(await page.getByRole('link', { name: 'Projects' }).count() === 0, 'Projects in nav');
  await page.goto(`${BASE}/projects`);
  await page.waitForURL(/\/portal\/?$/);
  await page.goto(`${BASE}/projects/templates`);
  await page.waitForURL(/\/portal\/?$/);
  await page.goto(`${BASE}/clients/${ORG.id}`);
  await page.getByText('Private to the portal owner').waitFor();
  await page.goto(`${BASE}/sales/deal-1`);
  await page.locator('#detail-stage').waitFor();
  await settle(page);
  assert(state.projectReads === 0, `${state.projectReads} project reads by a non-owner`);
  await context.close();
});

/* ---------------------------------------------------------- Impact */

await check('impact: owner sees the nav item, counters computed from the projects, and the missing-value warning', async () => {
  const { page, context } = await open(browser);
  await page.goto(`${BASE}/impact`);
  await page.getByRole('link', { name: 'Impact' }).first().waitFor();
  const strip = page.getByLabel('Impact support');
  await strip.getByText('800 000 Ft').waitFor();
  assert(await strip.getByText('600 000 Ft').isVisible(), 'delivered 600 000 Ft not shown');
  const missing = await strip.locator('[data-impact-missing]').textContent();
  assert(missing.includes('1 in progress without a market value'), `missing warning: ${missing}`);
  // The cancelled project's 300 000 is in neither figure.
  assert(await strip.getByText('1 100 000 Ft').count() === 0 && await strip.getByText('900 000 Ft').count() === 0, 'cancelled counted');
  await page.getByText('Zöld Kör Egyesület').waitFor();
  await shot(page, 'impact-applications');
  await page.getByRole('button', { name: /^Active projects \(2\)$/ }).click();
  await page.getByText('Tanoda website').waitFor();
  await page.getByRole('button', { name: /^Closed projects \(2\)$/ }).click();
  await page.getByText('Cancelled · not counted').waitFor();
  await shot(page, 'impact-closed');
  await context.close();
});

await check('impact: the paid Projects list does not contain Impact projects', async () => {
  const { page, context } = await open(browser);
  await page.goto(`${BASE}/projects`);
  await page.locator('tbody').getByText('Late website').waitFor();
  assert(await page.getByText('Tanoda website').count() === 0, 'Impact project in the paid list');
  await context.close();
});

await check('impact: the application shows the original answers and contact; status changes are saved', async () => {
  const state = freshState();
  const { page, context } = await open(browser, { state });
  await page.goto(`${BASE}/impact/applications/a-new`);
  await page.getByText('12 000 fa').waitFor();
  assert(await page.getByText('Elért hatás').isVisible(), 'question label missing');
  assert(await page.getByText('anna@zoldkor.example').first().isVisible(), 'contact email missing');
  assert(await page.getByRole('button', { name: 'Start Impact project' }).count() === 0, 'start offered before acceptance');
  const opts = await page.locator('#impact-app-status option').evaluateAll((els) => els.map((e) => e.value));
  assert(!opts.includes('project_started'), 'project_started offered');
  await page.selectOption('#impact-app-status', 'review');
  await settle(page);
  const w = state.writes.find((x) => x.table === 'impact_applications');
  assert(w && w.patch.status === 'review', `status write ${JSON.stringify(w)}`);
  await shot(page, 'impact-application');
  await context.close();
});

await check('impact: starting a project offers the existing-client match, and a double click makes ONE call', async () => {
  const state = freshState();
  const { page, context } = await open(browser, { state });
  await page.goto(`${BASE}/impact/applications/a-acc`);
  await page.getByRole('button', { name: 'Start Impact project' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByText('Possible existing clients').waitFor();
  assert(await dialog.getByText('Rapidkert Kft.').isVisible(), 'match not shown');
  await shot(page, 'impact-start-dialog');
  await dialog.getByRole('button', { name: 'Start project' }).dblclick();
  await page.waitForURL(/\/projects\/i-new-1$/);
  await settle(page);
  assert(state.startCalls === 1, `${state.startCalls} start calls`);
  const call = state.writes.find((x) => x.table === 'rpc:impact_start_project');
  assert(call.body.p_organization === null && call.body.p_client_name === 'Rapidkert', `payload ${JSON.stringify(call.body)}`);
  assert(Array.isArray(call.body.p_steps) && call.body.p_steps.length > 0, 'no checkpoints sent');
  await context.close();
});

await check('impact: no close without a market value; the free project hides fee and payment', async () => {
  const { page, context } = await open(browser);
  await page.goto(`${BASE}/projects/i-ready`);
  const close = page.getByRole('button', { name: 'Close project' });
  await close.waitFor();
  assert(await close.isDisabled(), 'close enabled without a market value');
  const rule = await page.locator('#close-rule').textContent();
  assert(rule.includes('the market value of the donated work'), `rule: ${rule}`);
  assert(await page.getByText('Impact project · free').isVisible(), 'not labelled Impact');
  assert(await page.getByText('Payment', { exact: true }).count() === 0, 'payment line shown');
  assert(await page.getByText('Opportunity', { exact: true }).count() === 0, 'opportunity line shown');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  assert(await page.locator('#ep-value, #ep-paid, #ep-invoiced, #ep-payment, #ep-currency').count() === 0, 'fee fields in edit');
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  await shot(page, 'impact-project-missing-value');
  await context.close();
});

await check('impact: saving the market value enables the close; the close celebrates once, a reload does not', async () => {
  const state = freshState();
  const { page, context } = await open(browser, { state });
  await page.goto(`${BASE}/projects/i-ready`);
  await page.fill('#impact-market-value', '12,5');
  await page.getByRole('button', { name: 'Save value' }).click();
  await page.getByText('whole number of forints', { exact: false }).waitFor();
  assert(!state.writes.some((w) => w.patch && 'market_value' in w.patch), 'saved an invalid value');
  await page.fill('#impact-market-value', '1 250 000');
  await page.getByRole('button', { name: 'Save value' }).click();
  await page.getByLabel('Market value').getByText('1 250 000 Ft').first().waitFor();
  const w = state.writes.find((x) => x.patch && 'market_value' in x.patch);
  assert(w.patch.market_value === 1250000, `value write ${JSON.stringify(w.patch)}`);
  const close = page.getByRole('button', { name: 'Close project' });
  await page.waitForFunction(() => !document.querySelector('[aria-describedby="close-rule"]')?.hasAttribute('disabled'));
  await close.click();
  await page.getByRole('button', { name: 'Reopen' }).waitFor();
  await settle(page);
  const c = await celebrations(page);
  assert(c.confetti === 1 && c.status.length === 1 && c.status[0].includes('Project closed'), JSON.stringify(c));
  await page.reload();
  await page.getByRole('button', { name: 'Reopen' }).waitFor();
  await settle(page, 2500);
  const after = await celebrations(page);
  assert(after.confetti === 0 && after.status.length === 0, `reload celebrated ${JSON.stringify(after)}`);
  await context.close();
});

await check('impact: reduced motion — status line, no confetti', async () => {
  const state = freshState();
  state.projects.find((p) => p.id === 'i-ready').market_value = 0;
  const { page, context } = await open(browser, { state, reducedMotion: 'reduce' });
  await page.goto(`${BASE}/projects/i-ready`);
  await page.getByRole('button', { name: 'Close project' }).click();
  await page.getByRole('status').filter({ hasText: 'Project closed' }).waitFor();
  await settle(page);
  const c = await celebrations(page);
  assert(c.confetti === 0 && c.status.length === 1, JSON.stringify(c));
  await context.close();
});

await check('impact: an Impact lead offers no conversion to a paid opportunity', async () => {
  const { page, context } = await open(browser);
  await page.goto(`${BASE}/leads/l-new`);
  await page.getByText('This is an Impact application.', { exact: false }).waitFor();
  assert(await page.getByRole('button', { name: /Convert/ }).count() === 0, 'convert offered');
  await context.close();
});

await check('impact: a non-owner super_admin gets no nav item, the routes redirect, nothing is read', async () => {
  const state = freshState();
  const { page, context } = await open(browser, { owner: false, state });
  await page.goto(`${BASE}/`);
  await page.getByRole('link', { name: 'Sales' }).first().waitFor();
  assert(await page.getByRole('link', { name: 'Impact' }).count() === 0, 'Impact in nav');
  await page.goto(`${BASE}/impact`);
  await page.waitForURL(/\/portal\/?$/);
  await page.goto(`${BASE}/impact/applications/a-new`);
  await page.waitForURL(/\/portal\/?$/);
  await settle(page);
  assert(state.impactReads === 0, `${state.impactReads} Impact reads by a non-owner`);
  await context.close();
});

/* ------------------------------------------------------ payment schedule */

const noHorizontalScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

await check('payments: the schedule shows contracted, scheduled, paid, remaining and overdue from the payments', async () => {
  const { page, context } = await open(browser);
  await page.goto(`${BASE}/projects/p-late`);
  const panel = page.getByRole('region', { name: 'Payment schedule' });
  await panel.getByText('Előleg').waitFor();
  const fig = (k) => panel.locator(`[data-figure="${k}"]`).textContent();
  assert((await fig('paid'))?.replace(/\s/g, '').includes('200000'), `paid ${await fig('paid')}`);
  assert((await fig('remaining'))?.replace(/\s/g, '').includes('1300000'), `remaining ${await fig('remaining')}`);
  assert((await fig('overdue'))?.replace(/\s/g, '').includes('300000'), `overdue ${await fig('overdue')}`);
  assert(await panel.locator('[data-instalment]').first().getByText('Overdue').isVisible(), 'overdue badge');
  assert(await panel.getByText('not invoiced').count() === 1, 'invoicing shown per instalment');
  assert(await page.locator('[data-signal="schedule-mismatch"]').count() === 0, 'a matching schedule flagged');
  await shot(page, 'payments-project');
  await context.close();
});

await check('payments: the edit dialog no longer offers payment state, invoiced or paid amount', async () => {
  const { page, context } = await open(browser);
  await page.goto(`${BASE}/projects/p-late`);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  assert(await page.locator('#ep-payment, #ep-paid, #ep-invoiced').count() === 0, 'legacy payment fields still editable');
  assert(await page.locator('[data-payment-moved]').isVisible(), 'no pointer to the schedule');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await context.close();
  // A save sends none of the three derived columns.
  const state = freshState();
  const again = await open(browser, { state });
  await again.page.goto(`${BASE}/projects/p-late`);
  await again.page.getByRole('button', { name: 'Edit', exact: true }).click();
  await again.page.getByRole('button', { name: 'Save' }).click();
  await again.page.getByRole('dialog').waitFor({ state: 'detached' });
  const w = state.writes.find((x) => x.table === 'projects');
  assert(w && !('payment_state' in w.patch) && !('paid_amount' in w.patch) && !('invoiced_amount' in w.patch) && !('currency' in w.patch),
    `edit sent ${JSON.stringify(w?.patch)}`);
  await again.context.close();
});

await check('payments: an instalment and a part payment are recorded by keyboard; over-payment is warned, not blocked', async () => {
  const state = freshState();
  const { page, context } = await open(browser, { state });
  await page.goto(`${BASE}/projects/p-ready`);
  const panel = page.getByRole('region', { name: 'Payment schedule' });
  await panel.getByText('No instalments yet', { exact: false }).waitFor();
  await panel.getByRole('button', { name: 'Instalment' }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('dialog', { name: 'New instalment' }).waitFor();
  assert(await page.evaluate(() => document.activeElement?.id) === 'pi-label', 'focus did not move into the dialog');
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  assert(await page.evaluate(() => document.activeElement?.textContent?.includes('Instalment')), 'focus did not return');
  await panel.getByRole('button', { name: 'Instalment' }).click();
  await page.fill('#pi-label', 'Előleg');
  await page.fill('#pi-amount', '1 500 000');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByText('An instalment needs a due date.').waitFor();
  assert(!state.writes.some((w) => w.table === 'project_instalments'), 'sent without a due date');
  await page.fill('#pi-due', day(14));
  await page.getByRole('button', { name: 'Save' }).click();
  await panel.getByText('Előleg').waitFor();
  const ins = state.writes.find((w) => w.table === 'project_instalments');
  assert(ins.body.amount === 1500000 && ins.body.project_id === 'p-ready' && !('origin' in ins.body), `instalment ${JSON.stringify(ins.body)}`);

  await panel.getByRole('button', { name: 'Payment' }).click();
  await page.fill('#pp-amount', '1 600 000');
  await page.getByText('over its amount', { exact: false }).waitFor();
  await page.fill('#pp-date', day(1));
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByText('that date is in the future', { exact: false }).waitFor();
  await page.fill('#pp-date', day(0));
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await panel.locator('[data-figure="overpaid"]').waitFor();
  const pay = state.writes.find((w) => w.table === 'project_payments');
  assert(pay.body.amount === 1600000 && pay.body.paid_on === day(0), `payment ${JSON.stringify(pay.body)}`);
  await shot(page, 'payments-overpaid');
  await context.close();
});

await check('payments: a closed project keeps its schedule editable, shows what is owed and the carry-over findings', async () => {
  const { page, context } = await open(browser);
  await page.goto(`${BASE}/projects/p-done`);
  const panel = page.getByRole('region', { name: 'Payment schedule' });
  await panel.getByText('Carried over', { exact: true }).waitFor();
  assert((await panel.locator('[data-figure="remaining"]').textContent())?.replace(/\s/g, '').includes('500000'), 'remaining on a closed project');
  assert(await panel.getByText('date not recorded').isVisible(), 'undated legacy payment not marked');
  assert(await panel.getByRole('button', { name: 'Payment', exact: true }).isEnabled(), 'payment not recordable after close');
  assert(await panel.getByText('now reads "Partially paid"', { exact: false }).isVisible(), 'state change not explained');
  await context.close();
});

await check('payments: an Impact project has no schedule panel; a non-owner reads no payment data', async () => {
  const { page, context } = await open(browser);
  await page.goto(`${BASE}/projects/i-valued`);
  await page.getByRole('region', { name: 'Market value' }).waitFor();
  assert(await page.getByRole('region', { name: 'Payment schedule' }).count() === 0, 'schedule on an Impact project');
  await context.close();
  const state = freshState();
  const other = await open(browser, { owner: false, state });
  await other.page.goto(`${BASE}/projects/p-late`);
  await other.page.waitForURL(/\/portal\/?$/);
  await settle(other.page);
  assert(state.paymentReads === 0, `${state.paymentReads} payment reads by a non-owner`);
  await other.context.close();
});

await check('payments: before the migration, the panel says so and the rest of the project still works', async () => {
  const state = freshState();
  state.scheduleMissing = true;
  const { page, context } = await open(browser, { state });
  await page.goto(`${BASE}/projects/p-late`);
  const panel = page.getByRole('region', { name: 'Payment schedule' });
  await panel.getByText('not installed on this database yet', { exact: false }).waitFor();
  assert(await panel.getByRole('button', { name: /Retry|Try again/ }).count() >= 1, 'no retry offered');
  assert(await page.getByRole('button', { name: 'Close project' }).isVisible(), 'the rest of the project did not render');
  await context.close();
});

await check('payments: receivables are listed per currency, closed projects included', async () => {
  const state = freshState();
  state.projects.push(project({ id: 'p-eur', name: 'Berlin shop', currency: 'EUR', value: 4000 }));
  state.instalments.push({ id: 'in-eur', project_id: 'p-eur', label: 'Anzahlung', amount: 4000, due_on: day(-2), invoiced: true, invoiced_on: null, note: null, position: 0, origin: 'manual' });
  const { page, context } = await open(browser, { state });
  await page.goto(`${BASE}/projects`);
  const panel = page.getByRole('region', { name: 'Receivables' });
  await panel.locator('[data-currency="EUR"]').waitFor();
  assert(await panel.locator('[data-currency]').count() === 2, 'currencies merged');
  assert(await panel.getByText('Delivered site').isVisible(), 'closed project with a debt not listed');
  await context.close();
});

await check('payments: phone width — no horizontal scroll on the project and the dialogs', async () => {
  const { page, context } = await open(browser);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/projects/p-late`);
  await page.getByRole('region', { name: 'Payment schedule' }).getByText('Előleg').waitFor();
  assert(await noHorizontalScroll(page), 'project page scrolls sideways at 390px');
  await page.getByRole('region', { name: 'Payment schedule' }).getByRole('button', { name: 'Payment' }).first().click();
  await page.getByRole('dialog').waitFor();
  assert(await noHorizontalScroll(page), 'payment dialog scrolls sideways at 390px');
  await shot(page, 'payments-phone');
  await context.close();
});

/* ------------------------------------------------------ monthly contracts */

await check('monthly: a view of its own, with the running fees per currency; Active and Closed exclude it', async () => {
  const { page, context } = await open(browser);
  await page.goto(`${BASE}/projects`);
  await page.getByRole('link', { name: 'Ready to close' }).waitFor();
  assert(!(await page.getByText('Website care').isVisible()), 'a monthly contract is listed under Active');
  await page.getByRole('button', { name: 'Monthly contracts (2)' }).click();
  await page.getByRole('link', { name: 'Website care' }).waitFor();
  assert(await page.getByRole('button', { name: 'Monthly contracts (2)' }).getAttribute('aria-current') === 'page', 'the Monthly tab is not marked current');
  assert(await page.getByRole('button', { name: /^Active/ }).getAttribute('aria-current') === null, 'Active is still marked current');
  const total = page.locator('[data-monthly-total="HUF"]');
  assert((await total.innerText()).replace(/\s/g, '').includes('240000'), `running total wrong: ${await total.innerText()}`);
  assert(await page.getByRole('link', { name: 'Old SEO retainer' }).isVisible(), 'an ended contract is not listed');
  assert(!(await page.getByRole('link', { name: 'Ready to close' }).isVisible()), 'a one-off project is listed under Monthly');
  await shot(page, 'monthly-list');
  await page.getByRole('button', { name: /Closed/ }).click();
  await page.getByRole('link', { name: 'Delivered site' }).first().waitFor();
  assert(!(await page.getByText('Old SEO retainer').isVisible()), 'an ended monthly contract is listed under Closed');
  await context.close();
});

await check('monthly: the contract shows its fee, ends without checkpoints, and + Month fills in the next month', async () => {
  const state = freshState();
  state.instalments.push({ id: 'in-m1', project_id: 'm-care', label: 'július', amount: 150000, due_on: '2026-07-31', invoiced: true, invoiced_on: null, note: null, position: 0, origin: 'manual' });
  const { page, context } = await open(browser, { state });
  await page.goto(`${BASE}/projects/m-care`);
  await page.locator('[data-figure="monthly-fee"]').waitFor();
  assert((await page.locator('[data-figure="monthly-fee"]').innerText()).replace(/\s/g, '').includes('150000'), 'fee not shown');
  assert(await page.getByRole('region', { name: 'Monthly contract' }).isVisible(), 'no monthly panel');
  assert(!(await page.getByText('Contribution', { exact: true }).isVisible()), 'the one-off contribution panel is shown');
  const schedule = page.getByRole('region', { name: 'Payment schedule' });
  assert(!(await schedule.locator('[data-signal="schedule-mismatch"]').count()), 'a monthly schedule is flagged as a mismatch');
  const end = page.getByRole('button', { name: 'End contract' });
  assert(await end.isEnabled(), 'End contract is disabled without checkpoints');
  await schedule.getByRole('button', { name: 'Month' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  assert(await dialog.getByLabel('Name').inputValue() === '2026. augusztus', `label: ${await dialog.getByLabel('Name').inputValue()}`);
  assert(await dialog.getByLabel(/Amount/).inputValue() === '150000', 'amount not the fee');
  assert(await dialog.getByLabel('Due').inputValue() === '2026-08-31', `due: ${await dialog.getByLabel('Due').inputValue()}`);
  await shot(page, 'monthly-next-month');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await end.click();
  await settle(page);
  assert((await celebrations(page)).confetti === 0, 'ending a monthly contract celebrated');
  const patch = state.writes.find((w) => w.table === 'projects' && w.patch?.status === 'completed');
  assert(patch && patch.url.includes('m-care'), 'the end was not sent');
  await shot(page, 'monthly-detail');
  await context.close();
});

await check('monthly: New project → Monthly contract sends billing and the fee, never a value', async () => {
  const state = freshState();
  const { page, context } = await open(browser, { state });
  await page.goto(`${BASE}/projects?view=monthly`);
  await page.getByRole('button', { name: 'New project' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('heading', { name: 'New monthly contract' }).waitFor();
  await dialog.getByLabel('Client').selectOption(ORG.id);
  await dialog.getByLabel('Contract name').fill('SEO retainer');
  await dialog.getByRole('button', { name: 'Create' }).click();
  await dialog.getByRole('alert').waitFor();
  assert((await dialog.getByRole('alert').innerText()).includes('monthly fee'), 'a monthly contract without a fee was accepted');
  await dialog.getByLabel('Monthly fee').fill('120 000');
  await shot(page, 'monthly-new');
  await dialog.getByRole('button', { name: 'Create' }).click();
  await page.waitForURL(/\/projects\/p-new-/);
  const post = state.writes.find((w) => w.table === 'projects' && w.method === 'POST');
  assert(post.body.billing === 'monthly' && post.body.monthly_fee === 120000 && post.body.value === null,
    `wrong insert: ${JSON.stringify(post.body)}`);
  assert(!state.writes.some((w) => w.table === 'project_milestones'), 'checkpoints were seeded on a monthly contract');
  await context.close();
});

await check('monthly: phone width — no horizontal scroll on the list and the contract', async () => {
  const { page, context } = await open(browser);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/projects?view=monthly`);
  await page.getByRole('link', { name: 'Website care' }).waitFor();
  assert(await noHorizontalScroll(page), 'monthly list scrolls sideways at 390px');
  await shot(page, 'monthly-phone');
  await page.goto(`${BASE}/projects/m-care`);
  await page.locator('[data-figure="monthly-fee"]').waitFor();
  assert(await noHorizontalScroll(page), 'monthly contract scrolls sideways at 390px');
  await context.close();
});

/* --------------------------------------------------------------- Trash */

await check('trash: a project moved to the Trash leaves Projects; Restore brings it back; Delete removes it', async () => {
  const state = freshState();
  const { page, context } = await open(browser, { state });
  await page.goto(`${BASE}/projects/p-ready`);
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Move to trash' }).click();
  await page.waitForURL(/\/projects$/);
  await page.getByRole('link', { name: 'Late website' }).first().waitFor();
  assert(!(await page.getByRole('link', { name: 'Ready to close' }).isVisible()), 'a trashed project is still listed');
  await page.getByRole('link', { name: 'Trash' }).click();
  const section = page.getByRole('region', { name: 'Trash: Projects' });
  await section.getByRole('link', { name: 'Ready to close' }).waitFor();
  await shot(page, 'trash');
  await section.getByRole('button', { name: 'Restore' }).click();
  await settle(page);
  assert(state.projects.find((p) => p.id === 'p-ready').archived_at === null, 'restore did not clear the Trash mark');
  assert(!(await section.getByRole('link', { name: 'Ready to close' }).isVisible()), 'restored project still in the Trash');
  state.projects.find((p) => p.id === 'p-ready').archived_at = new Date().toISOString();
  await page.reload();
  await section.getByRole('link', { name: 'Ready to close' }).waitFor();
  page.once('dialog', (d) => d.accept());
  await section.getByRole('button', { name: 'Delete permanently' }).click();
  await settle(page);
  assert(!state.projects.some((p) => p.id === 'p-ready'), 'the project was not deleted');
  assert(state.writes.filter((w) => w.table === 'rpc:purge_project').length === 1, 'not exactly one delete call');
  assert(!(await section.getByRole('link', { name: 'Ready to close' }).isVisible()), 'deleted project still listed');
  await context.close();
});

await check('trash: a delete that money blocks says why, and nothing is removed', async () => {
  const state = freshState();
  state.projects.find((p) => p.id === 'p-late').archived_at = new Date().toISOString();
  const { page, context } = await open(browser, { state });
  await page.goto(`${BASE}/trash`);
  const section = page.getByRole('region', { name: 'Trash: Projects' });
  await section.getByRole('link', { name: 'Late website' }).waitFor();
  page.once('dialog', (d) => d.accept());
  await section.getByRole('button', { name: 'Delete permanently' }).click();
  const alert = section.getByRole('alert');
  await alert.waitFor();
  assert((await alert.innerText()).includes('2 instalment(s)'), `reason not shown: ${await alert.innerText()}`);
  assert(state.projects.some((p) => p.id === 'p-late'), 'a blocked project was removed');
  await shot(page, 'trash-blocked');
  await context.close();
});

await check('trash: a project in the Trash says so on its page and can be restored there', async () => {
  const state = freshState();
  state.projects.find((p) => p.id === 'p-late').archived_at = new Date().toISOString();
  const { page, context } = await open(browser, { state });
  await page.goto(`${BASE}/projects/p-late`);
  const banner = page.locator('[data-in-trash="project"]');
  await banner.waitFor();
  assert(!(await page.getByRole('button', { name: 'Move to trash' }).isVisible()), 'Move to trash offered on a trashed project');
  await banner.getByRole('button', { name: 'Restore' }).click();
  await page.getByRole('button', { name: 'Move to trash' }).waitFor();
  assert(state.projects.find((p) => p.id === 'p-late').archived_at === null, 'not restored');
  await context.close();
});

await check('trash: a lead moved to the Trash leaves Leads and shows the banner on its page', async () => {
  const state = freshState();
  const { page, context } = await open(browser, { state });
  await page.goto(`${BASE}/leads/l-new`);
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Move to trash' }).click();
  await page.waitForURL(/\/leads$/);
  assert(state.impactLead.trashed_at, 'the lead was not marked');
  await settle(page);
  assert(!(await page.getByText('Kiss Anna').first().isVisible()), 'a trashed lead is still listed');
  await page.goto(`${BASE}/leads/l-new`);
  await page.locator('[data-in-trash="lead"]').waitFor();
  await page.goto(`${BASE}/trash`);
  await page.getByRole('region', { name: 'Trash: Leads' }).getByRole('link', { name: 'Kiss Anna' }).waitFor();
  await context.close();
});

/* ------------------------------------------------- All, Impact direct */

await check('all: one list of every kind with its own figures; the kind filter narrows it', async () => {
  const { page, context } = await open(browser);
  await page.goto(`${BASE}/projects`);
  await page.getByRole('button', { name: /^All \(/ }).click();
  const list = page.getByRole('table');
  for (const name of ['Late website', 'Website care', 'Tanoda website', 'Delivered site']) {
    await list.getByRole('link', { name }).waitFor();
  }
  const strip = page.getByRole('region', { name: 'All projects' });
  assert((await strip.innerText()).replace(/\s/g, '').includes('240000Ft'), 'monthly fees missing from the figures');
  await shot(page, 'all-projects');
  await page.getByLabel('Kind').selectOption('impact');
  await list.getByRole('link', { name: 'Tanoda website' }).waitFor();
  assert(!(await list.getByRole('link', { name: 'Late website' }).isVisible()), 'the kind filter did not narrow');
  await context.close();
});

await check('impact: New Impact project creates a free, direct project without an application', async () => {
  const state = freshState();
  const { page, context } = await open(browser, { state });
  await page.goto(`${BASE}/impact`);
  await page.getByRole('button', { name: 'New Impact project' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Client', { exact: true }).selectOption(ORG.id);
  await dialog.getByLabel('Project name').fill('Menedékház website');
  await dialog.getByLabel(/Market value/).fill('900 000');
  await shot(page, 'impact-new');
  await dialog.getByRole('button', { name: 'Create' }).click();
  await page.waitForURL(/\/projects\/p-new-/);
  const post = state.writes.find((w) => w.table === 'projects' && w.method === 'POST');
  assert(post.body.program === 'impact' && post.body.impact_direct === true && post.body.value === null
    && post.body.currency === 'HUF' && post.body.market_value === 900000, `wrong insert: ${JSON.stringify(post.body)}`);
  assert(!state.writes.some((w) => w.table.startsWith('rpc:impact_start_project')), 'went through the application path');
  await context.close();
});

await check('impact: an applicant\'s lead goes to the Trash from the application screen', async () => {
  const state = freshState();
  const { page, context } = await open(browser, { state });
  await page.goto(`${BASE}/impact/applications/a-new`);
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Move to trash' }).click();
  await page.waitForURL(/\/impact$/);
  assert(state.impactLead.trashed_at, 'the Impact lead was not moved to the Trash');
  await context.close();
});

/* ------------------------------------------- notes, today, activity log */

await check('notes: a checklist about a client is written line by line with Enter; a dated point shows on Today and is ticked off there', async () => {
  const state = freshState();
  const { page, context } = await open(browser, { state });
  await page.goto(`${BASE}/notes`);
  await page.getByRole('button', { name: 'New checklist' }).click();
  await page.getByLabel('Title').fill('Kick-off with Rapidkert');
  await page.getByLabel('Title').blur();
  await page.getByLabel('About').selectOption(ORG.id);
  const line = page.getByLabel('New point');
  await line.fill('Ask for the logo');
  await line.press('Enter');
  await page.locator('[data-item]').first().waitFor();
  await page.locator('#note-new-due').fill(day(0));
  await line.fill('Send the offer');
  await line.press('Enter');
  await page.locator('[data-item]').nth(1).waitFor();
  assert(await line.evaluate((el) => el === document.activeElement), 'the cursor left the new-point line');
  const note = state.notes.at(-1);
  assert(note.title === 'Kick-off with Rapidkert' && note.organization_id === ORG.id && note.kind === 'checklist', `note: ${JSON.stringify(note)}`);
  assert(state.noteItems.length === 2 && state.noteItems[1].due_on === day(0), `items: ${JSON.stringify(state.noteItems)}`);
  await shot(page, 'notes');

  await page.getByRole('link', { name: 'Today' }).first().click();
  const task = page.locator(`[data-task="${state.noteItems[1].id}"]`);
  await task.waitFor();
  await task.getByRole('checkbox').click(); // the line leaves the list once done
  await settle(page);
  assert(state.noteItems[1].done === true, 'the task was not ticked off');
  await shot(page, 'today');
  await context.close();
});

await check('notes: a quick task on Today goes into the Tasks list, made on first use', async () => {
  const state = freshState();
  const { page, context } = await open(browser, { state });
  await page.goto(`${BASE}/today`);
  await page.getByLabel('Task', { exact: true }).fill('Call Rapidkert about the texts');
  await page.getByRole('button', { name: 'Add' }).click();
  await settle(page);
  assert(state.notes.length === 1 && state.notes[0].title === 'Tasks' && state.notes[0].kind === 'checklist', `inbox: ${JSON.stringify(state.notes)}`);
  assert(state.noteItems[0]?.text === 'Call Rapidkert about the texts' && state.noteItems[0].due_on === day(0), 'the task was not stored for today');
  await context.close();
});

await check('activity log: a call is logged on the client page and listed; the client page shows its notes', async () => {
  const state = freshState();
  state.notes.push({ id: 'n-1', kind: 'note', title: 'Brand ideas', body: 'Green, calm', organization_id: ORG.id, pinned: true, archived_at: null,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
  const { page, context } = await open(browser, { state });
  await page.goto(`${BASE}/clients/${ORG.id}`);
  await page.getByRole('region', { name: 'Notes and checklists' }).getByRole('link', { name: 'Brand ideas' }).waitFor();
  const log = page.getByRole('region', { name: 'Activity log' });
  await log.getByRole('button', { name: 'Log' }).click();
  await log.getByLabel('What was said or agreed').fill('Agreed the homepage texts by Friday.');
  await log.getByRole('button', { name: 'Save' }).click();
  await log.getByText('Agreed the homepage texts by Friday.').waitFor();
  const w = state.writes.find((x) => x.table === 'interactions' && x.method === 'POST');
  assert(w.body.organization_id === ORG.id && w.body.kind === 'call', `logged: ${JSON.stringify(w.body)}`);
  await shot(page, 'client-activity');
  await context.close();
});

/* ------------------------------------------------------------------ hours */

await check('hours: a line on a project and one on Other are logged; the week shows everybody; the project counts its logged hours', async () => {
  const state = freshState();
  state.timeEntries.push({ id: 'te-colleague', user_id: 'admin-2', work_date: day(0), hours: 3, project_id: null, label: 'Sales calls', note: null });
  const { page, context } = await open(browser, { state });
  await page.goto(`${BASE}/hours`);
  const form = page.getByRole('region', { name: 'Log hours' });
  await form.getByLabel('Hours', { exact: true }).fill('6,5');
  await form.getByLabel('On', { exact: true }).selectOption('p-late');
  await form.getByLabel('Note (optional)').fill('Homepage build');
  await form.getByRole('button', { name: 'Log hours' }).click();
  await settle(page);
  await form.getByLabel('Hours', { exact: true }).fill('1.25');
  await form.getByLabel('On', { exact: true }).selectOption('__other__');
  await form.getByLabel('What was it?').fill('Administration');
  await form.getByRole('button', { name: 'Log hours' }).click();
  await settle(page);
  const posts = state.writes.filter((w) => w.table === 'time_entries' && w.method === 'POST').map((w) => w.body);
  assert(posts.length === 2, `posted ${posts.length}`);
  assert(posts[0].project_id === 'p-late' && posts[0].hours === 6.5 && posts[0].work_date === day(0) && posts[0].label === null, `first: ${JSON.stringify(posts[0])}`);
  assert(posts[1].project_id === null && posts[1].label === 'Administration' && posts[1].hours === 1.25, `second: ${JSON.stringify(posts[1])}`);
  const week = page.locator('[data-hours-week]');
  await week.locator(`[data-person="${USER.id}"]`).getByText('7.75').first().waitFor();
  await week.locator('[data-person="admin-2"]').getByText('3').first().waitFor();
  // A colleague's line is shown with what it was on.
  await page.getByText('Sales calls').waitFor();
  await shot(page, 'hours');

  // Refused before anything is sent: not quarter hours.
  await form.getByLabel('Hours', { exact: true }).fill('1.1');
  await form.getByRole('button', { name: 'Log hours' }).click();
  await form.getByRole('alert').waitFor();
  assert(state.writes.filter((w) => w.table === 'time_entries' && w.method === 'POST').length === 2, 'invalid hours were sent');

  await page.goto(`${BASE}/projects/p-late`);
  await page.getByText('0 entered + 6.5 logged').waitFor();
  await context.close();
});

/* ------------------------------------------------------------ languages */

await check('help centre: an article takes English and German; a half-filled language is refused; the list marks what is missing', async () => {
  const state = freshState();
  const { page, context } = await open(browser, { state });
  await page.goto(`${BASE}/help`);
  await page.locator('[data-help-untranslated]').waitFor();
  await page.getByRole('button', { name: /^Edit Milyen fájlokat/ }).click();
  const dialog = page.getByRole('dialog');
  const en = dialog.locator('[data-translation="en"]');
  await en.getByLabel('Question').fill('Which files can I upload?');
  await en.getByLabel('Answer').fill('Up to 50 MB per file.');
  await en.getByLabel('Topic').fill('Client portal – uploads');
  await dialog.locator('[data-translation="de"]').getByLabel('Question').fill('Welche Dateien?');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await dialog.getByRole('alert').waitFor();
  assert((await dialog.getByRole('alert').innerText()).startsWith('Deutsch:'), 'a half-filled German was not refused');
  await dialog.locator('[data-translation="de"]').getByLabel('Question').fill('');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await settle(page);
  const patch = state.writes.find((w) => w.table === 'help_articles' && w.method === 'PATCH');
  assert(patch?.body.translations?.en?.question === 'Which files can I upload?' && !patch.body.translations.de,
    `wrong translations saved: ${JSON.stringify(patch?.body.translations)}`);
  await shot(page, 'help-translations');
  await context.close();
});

await check('language: Magyar in the sidebar turns the owner portal Hungarian and saves it on the account', async () => {
  const state = freshState();
  const { page, context } = await open(browser, { state });
  await page.goto(`${BASE}/projects`);
  await page.getByRole('link', { name: 'Late website' }).first().waitFor();
  await page.getByRole('radio', { name: 'Magyar' }).first().click();
  await page.getByRole('link', { name: 'Projektek' }).first().waitFor();
  const patch = state.writes.find((w) => w.table === 'profiles');
  assert(patch?.patch.locale === 'hu', 'the choice was not saved on the profile');
  assert(await page.evaluate(() => document.documentElement.lang) === 'hu', 'html lang not set');
  await page.reload();
  await page.getByRole('link', { name: 'Projektek' }).first().waitFor();
  await shot(page, 'lang-hu-projects');
  await context.close();
});

await check('language: the account\'s choice applies on a new device; German pages read and fit', async () => {
  const { page, context } = await open(browser, { lang: 'de' });
  await page.goto(`${BASE}/projects`);
  await page.getByRole('link', { name: 'Projekte' }).first().waitFor();
  for (const path of ['/projects?view=all', '/projects/p-late', '/projects/m-care', '/trash', '/impact', '/sales?view=table']) {
    await page.goto(`${BASE}${path}`);
    await page.waitForLoadState('networkidle');
    const bad = await lowContrast(page);
    assert(bad.length === 0, `de ${path}: ${JSON.stringify(bad.slice(0, 3))}`);
  }
  await shot(page, 'lang-de-sales');
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ['/projects', '/projects/p-late', '/trash']) {
    await page.goto(`${BASE}${path}`);
    await page.waitForLoadState('networkidle');
    assert(await noHorizontalScroll(page), `de ${path} scrolls sideways at 390px`);
  }
  await context.close();
});

/* ------------------------------------------------------------- Sales */

await check('sales: "Done" is one call per double click; the action leaves the follow-ups; a failure leaves it', async () => {
  const state = freshState();
  Object.assign(state.deal, { next_action: 'Send the offer', next_action_on: day(-2) });
  const { page, context } = await open(browser, { state });
  await page.goto(`${BASE}/sales?view=followups`);
  const done = page.getByRole('button', { name: 'Mark done: Send the offer' });
  await done.waitFor();
  await done.dblclick();
  await page.getByText('Send the offer').waitFor({ state: 'detached' });
  await settle(page);
  assert(state.completeCalls === 1, `${state.completeCalls} calls`);
  assert(state.writes.every((w) => w.table !== 'record_notes' && w.table !== 'opportunities'), 'the screen wrote a note or patched the deal itself');
  await context.close();

  const s2 = freshState();
  Object.assign(s2.deal, { next_action: 'Call Anna', next_action_on: day(-1) });
  s2.completeAnswer = 'refuse';
  const again = await open(browser, { state: s2 });
  await again.page.goto(`${BASE}/sales?view=followups`);
  await again.page.getByRole('button', { name: 'Mark done: Call Anna' }).click();
  await again.page.getByRole('alert').first().waitFor();
  assert(await again.page.getByText('Call Anna').first().isVisible(), 'a refused Done removed the action');
  await again.context.close();
});

await check('sales: the table opens on this month; Clear shows every deal, converted ones included', async () => {
  const state = freshState();
  Object.assign(state.deal, { stage: 'won', organization_id: ORG.id, expected_close_on: day(-60), client: { id: ORG.id, name: ORG.name } });
  const { page, context } = await open(browser, { state });
  await page.goto(`${BASE}/sales?view=table`);
  await page.getByText('Nothing matches').waitFor();
  assert(await page.locator('#sales-close').inputValue() === 'month', 'default is not this month');
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await page.getByText('Rapidkert rebuild').first().waitFor();
  assert(await page.locator('#sales-close').inputValue() === 'all' && await page.locator('#sales-stage').inputValue() === 'all', 'clear did not clear');
  await context.close();
});

/* ------------------------------------------------ phase 7: owner side */

await check('owner: the project page manages demo links — unsafe URLs refused before any write; unpublished by default; the public-site caveat is shown', async () => {
  const state = freshState();
  const { page, context } = await open(browser, { state });
  await page.goto(`${BASE}/projects/p-late`);
  const panel = page.getByRole('region', { name: 'Client portal view' });
  await panel.locator('[data-demo-public-warning]').waitFor();
  await panel.getByRole('button', { name: 'Demo link' }).click();
  await page.fill('#demo-title', 'Weboldal demó');
  for (const bad of ['javascript:alert(1)', 'http://demo.example.com', 'https://user:pw@demo.example.com']) {
    await page.fill('#demo-url', bad);
    await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
    await page.getByRole('dialog').getByText('Only a plain https:// address', { exact: false }).waitFor();
  }
  assert(!state.writes.some((w) => w.table === 'project_demos'), 'an unsafe URL was sent');
  await page.fill('#demo-url', 'https://demo.example.com/rapidkert');
  assert(!(await page.getByLabel('Visible to the client').isChecked()), 'published by default');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  const w = state.writes.find((x) => x.table === 'project_demos');
  assert(w.body.published === false && w.body.url === 'https://demo.example.com/rapidkert' && w.body.project_id === 'p-late', JSON.stringify(w.body));
  await panel.getByText('Not published').waitFor();
  await panel.getByRole('button', { name: 'Publish' }).click();
  await panel.getByText('Visible to the client').waitFor();
  await shot(page, 'owner-client-view');
  await context.close();
});

await check('owner: meetings — a time skipped by DST is refused, a repeated one needs a second Save; UTC is stored', async () => {
  const state = freshState();
  const { page, context } = await open(browser, { state });
  await page.goto(`${BASE}/projects/p-late`);
  const panel = page.getByRole('region', { name: 'Client portal view' });
  await panel.getByRole('button', { name: 'Meeting', exact: true }).click();
  await page.fill('#mt-title', 'Egyeztetés');
  await page.fill('#mt-date', '2026-03-29');
  await page.fill('#mt-start', '02:30');
  await page.fill('#mt-end', '03:30');
  await page.fill('#mt-join', 'https://meet.example.com/abc');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await page.getByText('does not exist in this time zone', { exact: false }).waitFor();
  assert(!state.writes.some((x) => x.table === 'project_meetings'), 'nonexistent time saved');
  await page.fill('#mt-date', '2026-10-25');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await page.getByText('occurs twice', { exact: false }).waitFor();
  assert(!state.writes.some((x) => x.table === 'project_meetings'), 'ambiguous time saved without confirmation');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  const w = state.writes.find((x) => x.table === 'project_meetings');
  assert(w.body.starts_at === '2026-10-25T00:30:00.000Z' && w.body.ends_at === '2026-10-25T02:30:00.000Z' && w.body.time_zone === 'Europe/Budapest', JSON.stringify(w.body));
  await context.close();
});

await check('owner: the help centre lists drafts with their review note, and the tester answers from published articles only', async () => {
  const { page, context } = await open(browser);
  await page.goto(`${BASE}/help`);
  await page.getByText('1 published · 1 draft').waitFor();
  assert(await page.getByText('Üzleti döntés kell.').isVisible(), 'review note missing');
  await page.getByLabel('Kérdésed').fill('Hogyan kérhetek másik időpontot?');
  await page.keyboard.press('Enter');
  await page.locator('[data-reply]').last().waitFor();
  assert((await page.locator('[data-reply]').last().getAttribute('data-reply')) !== 'answer', 'a draft was answered in the tester');
  await context.close();
});

await check('non-owner: no Help centre, and no help or client-view request', async () => {
  const state = freshState();
  const { page, context } = await open(browser, { owner: false, state });
  await page.goto(`${BASE}/`);
  await page.getByRole('link', { name: 'Sales' }).first().waitFor();
  assert(await page.getByRole('link', { name: 'Help centre' }).count() === 0, 'Help centre in the nav');
  await page.goto(`${BASE}/help`);
  await page.waitForURL(/\/portal\/?$/);
  await settle(page);
  assert(state.helpReads === 0 && !state.writes.length, 'help read by a non-owner');
  await context.close();
});

await check('owner: client feedback shows under the demo and in the inbox; a proposed time is accepted through the decision function', async () => {
  const state = freshState();
  const h = (n) => new Date(Date.now() + n * 3600e3).toISOString();
  state.demos.push({ id: 'dm-1', project_id: 'p-late', title: 'Weboldal demó', url: 'https://demo.example.com', client_note: null, published: true, revoked_at: null, position: 0, updated_at: h(0) });
  state.meetings.push({ id: 'mt-1', project_id: 'p-late', title: 'Egyeztetés', starts_at: h(48), ends_at: h(49), time_zone: 'Europe/Budapest', join_url: 'https://meet.example.com/a', location: null, client_note: null, cancelled_at: null, updated_at: h(0) });
  state.feedback.push({ id: 'fb-1', demo_id: 'dm-1', project_id: 'p-late', body: 'A logó legyen nagyobb.', created_at: h(-1), read_at: null, account: { full_name: 'Kovács Anna', email: 'anna@a.example' },
    project: { name: 'Late website' }, demo: { title: 'Weboldal demó' } });
  state.requests.push({ id: 'rq-1', meeting_id: 'mt-1', project_id: 'p-late', proposed_starts_at: h(72), proposed_ends_at: h(73), time_zone: 'Europe/Budapest', message: 'Csütörtök?',
    status: 'pending', owner_note: null, created_at: h(-1), decided_at: null, account: { full_name: 'Kovács Anna', email: 'anna@a.example' }, project: { name: 'Late website' }, meeting: { title: 'Egyeztetés' } });
  const { page, context } = await open(browser, { state });
  await page.goto(`${BASE}/projects`);
  const inbox = page.getByRole('region', { name: 'Client inbox' });
  await inbox.getByText('2 waiting').waitFor();
  await page.goto(`${BASE}/projects/p-late`);
  const panel = page.getByRole('region', { name: 'Client portal view' });
  await panel.getByText('A logó legyen nagyobb.').waitFor();
  await panel.getByRole('button', { name: 'Mark read' }).click();
  await page.waitForTimeout(300);
  const w = state.writes.find((x) => x.table === 'demo_feedback');
  assert(w && w.body.read_at && Object.keys(w.body).length === 1, `read write ${JSON.stringify(w)}`);
  await panel.getByText('Csütörtök?', { exact: false }).waitFor();
  await panel.getByRole('button', { name: 'Accept — move the meeting' }).click();
  await page.waitForTimeout(400);
  assert(state.decisions.length === 1 && state.decisions[0].p_request === 'rq-1' && state.decisions[0].p_accept === true, JSON.stringify(state.decisions));
  assert(!state.writes.some((x) => x.table === 'meeting_change_requests'), 'the request table was written directly');
  await context.close();
});

await check('notifications: publishing a demo and answering feedback e-mail the client; unticked, nothing is queued', async () => {
  const state = freshState();
  const h = (n) => new Date(Date.now() + n * 3600e3).toISOString();
  state.demos.push({ id: 'dm-1', project_id: 'p-late', title: 'Weboldal demó', url: 'https://demo.example.com', client_note: null, published: false, revoked_at: null, position: 0, updated_at: h(0) });
  state.feedback.push({ id: 'fb-1', demo_id: 'dm-1', project_id: 'p-late', account_id: 'ca-1', body: 'A logó legyen nagyobb.', created_at: h(-1), read_at: null, owner_reply: null, replied_at: null,
    account: { full_name: 'Kovács Anna', email: 'anna@a.example' }, project: { name: 'Late website' }, demo: { title: 'Weboldal demó' } });
  const { page, context } = await open(browser, { state });
  await page.goto(`${BASE}/projects/p-late`);
  const panel = page.getByRole('region', { name: 'Client portal view' });
  const box = panel.getByLabel('E-mail the client');
  assert(await box.isChecked(), 'notify is not on by default');
  await panel.getByRole('button', { name: 'Publish' }).click();
  await panel.getByText('Visible to the client').waitFor();
  await page.waitForTimeout(300);
  let q = state.writes.filter((x) => x.table === 'notification_outbox');
  assert(q.length === 1 && q[0].body.kind === 'demo_published' && q[0].body.audience === 'client' && q[0].body.project_id === 'p-late' && q[0].body.payload.title === 'Weboldal demó', JSON.stringify(q));
  await panel.getByRole('button', { name: 'Answer', exact: true }).click();
  await panel.getByPlaceholder('Your answer — the client sees it under their feedback.').fill('Rendben, nagyobb lesz.');
  await panel.getByRole('button', { name: 'Send the answer' }).click();
  await page.waitForTimeout(400);
  const w = state.writes.find((x) => x.table === 'demo_feedback' && x.body.owner_reply);
  assert(w && w.body.owner_reply === 'Rendben, nagyobb lesz.', JSON.stringify(w));
  q = state.writes.filter((x) => x.table === 'notification_outbox');
  assert(q.length === 2 && q[1].body.kind === 'feedback_replied' && JSON.stringify(q[1].body.account_ids) === '["ca-1"]', JSON.stringify(q));
  await box.uncheck();
  await panel.getByRole('button', { name: 'Unpublish' }).click();
  await page.waitForTimeout(400);
  assert(state.writes.filter((x) => x.table === 'notification_outbox').length === 2, 'queued while unticked');
  await context.close();
});

await check('notifications: Settings explains push on this device and does not claim it is on', async () => {
  const { page, context } = await open(browser);
  await page.goto(`${BASE}/settings`);
  await page.getByText('When a client uploads a file', { exact: false }).waitFor();
  await page.locator('[data-push-state]:not([data-push-state="loading"])').waitFor();
  const st = await page.locator('[data-push-state]').getAttribute('data-push-state');
  assert(['off', 'unsupported', 'denied'].includes(st), `push state ${st}`);
  if (st === 'denied') await page.getByText('Notifications are blocked for this site', { exact: false }).waitFor();
  assert(!(await page.getByText('On for this device').count()), 'push shown as on without a subscription');
  await context.close();
});

await check('notifications: an admin (not the owner) has Settings, the same notifications, a test of their own and an e-mail switch', async () => {
  const state = freshState();
  const { page, context } = await open(browser, { owner: false, role: 'admin', state });
  await page.goto(`${BASE}/`);
  await page.getByRole('link', { name: 'Settings' }).first().click();
  await page.waitForURL(/\/settings$/);
  await page.getByText('When a client uploads a file', { exact: false }).waitFor();
  await page.locator('[data-push-state]:not([data-push-state="loading"])').waitFor();
  const mail = page.locator('[data-notify-email]');
  await mail.waitFor();
  assert(await mail.isChecked(), 'e-mails are off by default');
  await mail.uncheck();
  await page.waitForTimeout(300);
  await context.close();
});

await check('client experience: answers show in the inbox; a request, a message and an approval request are e-mailed; Ask now makes a survey', async () => {
  const state = freshState();
  const h = (n) => new Date(Date.now() + n * 3600e3).toISOString();
  state.demos.push({ id: 'dm-1', project_id: 'p-late', title: 'Weboldal demó', url: 'https://demo.example.com', client_note: null, published: true, revoked_at: null, position: 0, updated_at: h(0),
    approval_requested_at: null, approval_state: null });
  state.messages.push({ id: 'ms-1', project_id: 'p-late', account_id: 'ca-1', author_name: 'Kovács Anna', body: 'Mikor lesz kész?', created_at: h(-2), read_at: null, project: { name: 'Late website' } });
  state.asks.push({ id: 'rq-1', project_id: 'p-late', title: 'Logó SVG-ben', details: null, due_on: null, created_at: h(-48), done_at: h(-1), done_note: 'Feltöltöttem.',
    seen_at: null, cancelled_at: null, done_account: { full_name: 'Kovács Anna' }, project: { name: 'Late website' } });
  state.surveys.push({ id: 'sv-1', project_id: 'p-late', reason: 'manual', period: null, created_at: h(-30), score: 9, comment: 'Gyorsak vagytok.', answered_at: h(-3),
    google_clicked_at: h(-3), seen_at: null, cancelled_at: null, account: { full_name: 'Kovács Anna' }, project: { name: 'Late website' } });
  const { page, context } = await open(browser, { state });
  await page.goto(`${BASE}/projects`);
  const inbox = page.getByRole('region', { name: 'Client inbox' });
  await inbox.getByText('3 waiting').waitFor();
  for (const text of ['Mikor lesz kész?', 'Logó SVG-ben — Feltöltöttem.', '9/10 — Gyorsak vagytok.']) await inbox.getByText(text).waitFor();

  await page.goto(`${BASE}/projects/p-late`);
  const panel = page.getByRole('region', { name: 'Client portal view' });
  const outbox = () => state.writes.filter((x) => x.table === 'notification_outbox').map((x) => x.body);

  await panel.getByRole('button', { name: 'Ask for approval' }).click();
  await panel.getByText('Waiting for approval').waitFor();
  assert(state.writes.some((x) => x.table === 'project_demos' && x.body.approval_requested_at), 'approval not asked');
  assert(outbox().some((o) => o.kind === 'approval_requested' && o.payload.title === 'Weboldal demó'), JSON.stringify(outbox()));

  const waiting = panel.getByRole('region', { name: 'Waiting on the client' });
  await waiting.getByText('Feltöltöttem.').waitFor();
  await waiting.getByRole('button', { name: 'Mark seen' }).click();
  await page.waitForTimeout(300);
  assert(state.writes.some((x) => x.table === 'client_requests' && x.method === 'PATCH' && x.body.seen_at), 'not marked seen');
  await waiting.getByRole('button', { name: 'Request' }).click();
  await waiting.getByRole('button', { name: 'Add request' }).click();
  await waiting.getByText('Say what you need', { exact: false }).waitFor();
  await waiting.getByPlaceholder('What do you need?').fill('Szövegek a Rólunk oldalra');
  await waiting.getByLabel('Due').fill('2026-10-20');
  await waiting.getByRole('button', { name: 'Add request' }).click();
  await page.waitForTimeout(400);
  const rq = state.writes.find((x) => x.table === 'client_requests' && x.method === 'POST');
  assert(rq && rq.body.title === 'Szövegek a Rólunk oldalra' && rq.body.due_on === '2026-10-20' && rq.body.project_id === 'p-late', JSON.stringify(rq));
  assert(outbox().some((o) => o.kind === 'request_added' && o.payload.due_on === '2026-10-20'), JSON.stringify(outbox()));

  const messages = panel.getByRole('region', { name: 'Messages' });
  await messages.getByText('1 new').waitFor();
  await messages.getByPlaceholder('Message to the client').fill('Pénteken.');
  await messages.getByRole('button', { name: 'Send' }).click();
  await page.waitForTimeout(400);
  const ms = state.writes.find((x) => x.table === 'project_messages' && x.method === 'POST');
  assert(ms && ms.body.body === 'Pénteken.' && ms.body.project_id === 'p-late' && !('account_id' in ms.body), JSON.stringify(ms));
  assert(outbox().some((o) => o.kind === 'message_posted' && o.payload.excerpt === 'Pénteken.'), JSON.stringify(outbox()));

  const sat = panel.getByRole('region', { name: 'Satisfaction' });
  await sat.getByText('9/10').waitFor();
  await sat.getByText('opened the Google review page', { exact: false }).waitFor();
  await sat.getByRole('button', { name: 'Ask now' }).click();
  await page.waitForTimeout(300);
  const sv = state.writes.find((x) => x.table === 'client_surveys' && x.method === 'POST');
  assert(sv && sv.body.reason === 'manual' && sv.body.project_id === 'p-late', JSON.stringify(sv));
  await shot(page, 'owner-client-experience');
  await context.close();
});

await check('settings: the Google review link refuses a non-https address and saves an https one', async () => {
  const state = freshState();
  const { page, context } = await open(browser, { state });
  await page.goto(`${BASE}/settings`);
  await page.getByText('No link yet', { exact: false }).waitFor();
  const input = page.locator('#google-review-url');
  await input.fill('http://g.page/r/x');
  await page.getByRole('region', { name: 'Google review link' }).getByRole('button', { name: 'Save' }).click();
  await page.getByText('The link must be a plain https:// address.').waitFor();
  assert(!state.writes.some((x) => x.table === 'portal_settings'), 'an http link was saved');
  await input.fill('https://g.page/r/stratos/review');
  await page.getByRole('region', { name: 'Google review link' }).getByRole('button', { name: 'Save' }).click();
  await page.getByText('Saved.').waitFor();
  const w = state.writes.find((x) => x.table === 'portal_settings');
  assert(w && w.body.google_review_url === 'https://g.page/r/stratos/review', JSON.stringify(w));
  await context.close();
});

await check('automations: Today lists what needs attention with links; Done ticks one off; Settings switches a rule and its threshold', async () => {
  const state = freshState();
  const now = new Date().toISOString();
  const base = { detail: null, due_on: null, amount: null, currency: null, created_at: now, lead_id: null, opportunity_id: null, project_id: null, done_at: null, resolved_at: null };
  state.alerts.push(
    { ...base, id: 'al-1', kind: 'lead_unanswered', title: 'Kovács Anna', detail: 'Rapidkert', lead_id: 'l-1' },
    { ...base, id: 'al-2', kind: 'instalment_overdue', title: 'Late website', detail: 'Rapidkert Kft.', project_id: 'p-late', amount: 300000, currency: 'HUF', due_on: '2026-09-25' },
    { ...base, id: 'al-3', kind: 'deal_stale', title: 'Webshop', opportunity_id: state.deal.id },
  );
  const { page, context } = await open(browser, { state });
  await page.goto(`${BASE}/today`);
  const panel = page.getByRole('region', { name: 'Needs attention' });
  await panel.getByText('Overdue payment').waitFor();
  assert(await panel.getByRole('link', { name: /Kovács Anna/ }).getAttribute('href') === '/portal/leads/l-1', 'lead link');
  assert(await panel.getByRole('link', { name: /Late website/ }).getAttribute('href') === '/portal/projects/p-late', 'project link');
  assert(/300/.test(await panel.locator('[data-alert="instalment_overdue"]').innerText()), 'amount shown');
  await panel.locator('[data-alert="deal_stale"]').getByRole('button', { name: 'Done' }).click();
  await page.waitForTimeout(300);
  const w = state.writes.find((x) => x.table === 'automation_alerts');
  assert(w && w.method === 'PATCH' && w.body.done_at && /id=eq.al-3/.test(w.url), JSON.stringify(w));

  await page.goto(`${BASE}/settings`);
  const auto = page.getByRole('region', { name: 'Automations' });
  await auto.getByText('A stalled deal').waitFor();
  await auto.locator('[data-auto="auto_won_on"]').uncheck();
  const hours = auto.getByLabel('Hours');
  await hours.fill('8');
  await hours.blur();
  await page.waitForTimeout(400);
  const ws = state.writes.filter((x) => x.table === 'portal_settings').map((x) => x.body);
  assert(ws.some((b) => b.auto_won_on === false) && ws.some((b) => b.auto_lead_hours === 8), JSON.stringify(ws));
  await shot(page, 'owner-automations');
  await context.close();
});

await check('revenue: owner sees collected, monthly fees, where it came from and the forecast; a non-owner has no Revenue', async () => {
  const state = freshState();
  const m = (offset) => { const d = new Date(); return new Date(Date.UTC(d.getFullYear(), d.getMonth() + offset, 1)).toISOString().slice(0, 10); };
  state.revenue = [
    { section: 'collected', month: m(0), key: null, label: null, currency: 'HUF', amount: 400000 },
    { section: 'collected', month: m(-1), key: null, label: null, currency: 'HUF', amount: 250000 },
    { section: 'client', month: m(0), key: 'o1', label: 'Rapidkert Kft.', currency: 'HUF', amount: 400000 },
    { section: 'client', month: m(-1), key: 'o2', label: 'Ló Bt.', currency: 'HUF', amount: 250000 },
    { section: 'service', month: m(0), key: 'Weboldal', label: 'Weboldal', currency: 'HUF', amount: 400000 },
    { section: 'mrr', month: m(0), key: null, label: null, currency: 'HUF', amount: 150000 },
    { section: 'forecast', month: m(1), key: 'scheduled', label: null, currency: 'HUF', amount: 1000000 },
    { section: 'forecast', month: m(1), key: 'monthly', label: null, currency: 'HUF', amount: 150000 },
    { section: 'forecast', month: m(2), key: 'pipeline', label: null, currency: 'HUF', amount: 600000 },
    { section: 'collected', month: m(0), key: null, label: null, currency: 'EUR', amount: 1200 },
  ];
  const { page, context } = await open(browser, { state });
  await page.goto(`${BASE}/`);
  await page.getByRole('link', { name: 'Revenue' }).first().click();
  await page.waitForURL(/\/revenue$/);
  await page.getByRole('region', { name: 'Key figures' }).getByText('Monthly fees now').waitFor();
  const where = page.getByRole('region', { name: 'Where it came from' });
  await where.getByText('Rapidkert Kft.').waitFor();
  await where.getByRole('button', { name: 'Services' }).click();
  await where.getByText('Weboldal').waitFor();
  const next = page.locator(`[data-forecast="${m(1)}"]`);
  const text = await next.innerText();
  assert(/1\s?150\s?000/.test(text.replace(/\u00a0/g, ' ')), `forecast row: ${text}`);
  // EUR is shown on its own, never added to HUF.
  await page.getByRole('group', { name: 'Currency' }).getByRole('button', { name: 'EUR' }).click();
  await where.getByText('Nothing collected in this period.').waitFor();
  const pressed = await page.getByRole('group', { name: 'Currency' }).getByRole('button', { name: 'EUR' }).getAttribute('aria-pressed');
  assert(pressed === 'true', `EUR pressed: ${pressed}`);
  await shot(page, 'owner-revenue');
  await context.close();

  const other = await open(browser, { owner: false, state: freshState() });
  await other.page.goto(`${BASE}/`);
  await other.page.getByRole('link', { name: 'Sales' }).first().waitFor();
  assert(await other.page.getByRole('link', { name: 'Revenue' }).count() === 0, 'Revenue in a non-owner nav');
  await other.context.close();
});

await check('import & export: a client list downloads as an Excel-ready CSV; an import shows its plan, skips duplicates and writes only on confirm', async () => {
  const state = freshState();
  const { page, context } = await open(browser, { state });
  await page.goto(`${BASE}/`);
  await page.getByRole('link', { name: 'Import & export' }).first().click();
  await page.waitForURL(/\/data$/);
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-export="clients"]').click()]);
  const csv = await (await import('node:fs/promises')).readFile(await download.path(), 'utf8');
  assert(csv.charCodeAt(0) === 0xfeff, 'no BOM');
  assert(csv.slice(1).split('\r\n')[0].startsWith('Client;Website;Status'), csv.slice(0, 80));
  assert(csv.includes('Rapidkert Kft.'), 'client missing from the export');
  assert(/stratos-clients-\d{4}-\d{2}-\d{2}\.csv/.test(download.suggestedFilename()), download.suggestedFilename());
  // The owner exports projects and payments too.
  assert(await page.locator('[data-export="payments"]').count() === 1, 'owner has no payments export');

  const file = '\ufeffCégnév;Weboldal;Kapcsolattartó;E-mail;Kedvenc szín\r\nRapidkert Kft.;;;;\r\nKert Bt.;https://kert.example;Kiss Éva;eva@kert.example;zöld\r\n;;Senki;x@y.hu;\r\nRossz Kft.;;;nem-email;\r\n';
  await page.locator('[data-import-file]').setInputFiles({ name: 'ugyfelek.csv', mimeType: 'text/csv', buffer: Buffer.from(file, 'utf8') });
  const plan = page.locator('[data-import-plan]');
  await plan.getByText('1 to import').waitFor();
  await plan.getByText('3 skipped').waitFor();
  await plan.getByText('ignored: Kedvenc szín', { exact: false }).waitFor();
  assert(!state.writes.some((w) => w.table === 'organizations'), 'written before confirming');
  await page.locator('[data-import-go]').click();
  await page.locator('[data-import-result]').getByText('1 imported.').waitFor();
  const org = state.writes.find((w) => w.table === 'organizations');
  assert(org.body.name === 'Kert Bt.' && org.body.slug === 'kert-bt' && org.body.website === 'https://kert.example' && org.body.acquisition_source === 'import', JSON.stringify(org.body));
  const contact = state.writes.find((w) => w.table === 'client_contacts');
  assert(contact.body.name === 'Kiss Éva' && contact.body.email === 'eva@kert.example' && contact.body.is_primary === true, JSON.stringify(contact.body));
  await shot(page, 'owner-import');
  await context.close();
});

/* ============================================================ theme === */

await check('owner: Appearance in the sidebar — System follows the device, Light/Dark stick; every owner screen reads at 4.5:1 in both', async () => {
  const { page, context } = await open(browser, { colorScheme: 'light' });
  await page.goto(`${BASE}/`);
  const sw = page.getByRole('radiogroup', { name: 'Appearance' }).first();
  await sw.waitFor();
  assert(await page.evaluate(() => document.documentElement.dataset.theme) === 'light', 'system light not applied');
  await sw.getByRole('radio', { name: 'Dark' }).click();
  assert(await page.evaluate(() => [document.documentElement.dataset.theme, localStorage.getItem('stratos.portal.theme')].join()) === 'dark,dark', 'Dark not stored');
  await page.reload({ waitUntil: 'domcontentloaded' });
  assert(await page.evaluate(() => document.documentElement.dataset.theme) === 'dark', 'Dark lost on reload');
  await page.getByRole('radiogroup', { name: 'Appearance' }).first().getByRole('radio', { name: 'System' }).click();
  assert(await page.evaluate(() => document.documentElement.dataset.theme) === 'light', 'System did not return to the device');

  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForFunction((t) => document.documentElement.dataset.theme === t, scheme);
    for (const path of ['/', '/today', '/notes', '/hours', '/projects', '/projects?view=all', '/projects/p-late', '/projects?view=monthly', '/projects/m-care', '/trash', '/sales?view=table', '/sales/deal-1', '/leads/l-new', '/impact', '/help', `/clients/${ORG.id}`]) {
      await page.goto(`${BASE}${path}`);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(150);
      const bad = await lowContrast(page);
      assert(bad.length === 0, `${scheme} ${path}: ${JSON.stringify(bad.slice(0, 5))}`);
      if (path === '/' || path === '/projects/p-late') await shot(page, `theme-${scheme}${path.replace(/\//g, '-')}`);
    }
  }
  await context.close();
});

await browser.close();
server.close();
rmSync(BUNDLE, { recursive: true, force: true });

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);

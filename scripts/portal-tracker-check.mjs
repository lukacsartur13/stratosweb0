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

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
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
  client: ORG, responsible: null, status: 'active', program: 'paid', market_value: null, ...over,
});
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
    demos: [], meetings: [], helpReads: 0, feedback: [], requests: [], decisions: [],
    help: [
      { id: 'ha-1', slug: 'portal-fajltipusok', question: 'Milyen fájlokat tölthetek fel?', answer: 'Fájlonként legfeljebb 50 MB.', topic: 'Ügyfélportál – feltöltés',
        alt_questions: ['mekkora fájl'], source: 'lib/documentRules.ts', status: 'published', review_note: null, position: 10, updated_at: new Date().toISOString() },
      { id: 'ha-2', slug: 'portal-masik-idopont', question: 'Hogyan kérhetek másik időpontot?', answer: '[JAVASLAT]', topic: 'Ügyfélportál – megbeszélések',
        alt_questions: [], source: null, status: 'draft', review_note: 'Üzleti döntés kell.', position: 20, updated_at: new Date().toISOString() },
    ],
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
  }
  return out;
}

/* ------------------------------------------------------------ the fake */

const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function open(browser, { owner = true, reducedMotion = 'no-preference', state = freshState(), colorScheme = 'dark' } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-GB', timezoneId: 'Europe/Budapest', reducedMotion, colorScheme });
  const profile = { id: USER.id, email: USER.email, full_name: 'Owner', avatar_url: null, role: 'super_admin', organization_id: null };

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
            overdue: t.overdue, schedule_gap: t.scheduleGap, next_due_on: null, instalments: insts.length, payments: pays.length, undated_payments: t.undated };
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
    if (url.includes('/rest/v1/leads')) return answer([state.impactLead]);

    if (url.includes('/rest/v1/profiles')) return answer([profile]);

    if (url.includes('/rest/v1/projects')) {
      state.projectReads += method === 'GET' ? 1 : 0;
      if (!owner) return answer([]); // what RLS answers a non-owner
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
    for (const [path, key] of [['project_demos', 'demos'], ['project_meetings', 'meetings'], ['help_articles', 'help'], ['demo_feedback', 'feedback'], ['meeting_change_requests', 'requests']]) {
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
    if (url.includes('/rest/v1/client_contacts')) return answer(applyFilters(url, CONTACTS));
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
    for (const path of ['/', '/projects', '/projects/p-late', '/sales?view=table', '/sales/deal-1', '/leads/l-new', '/impact', '/help', `/clients/${ORG.id}`]) {
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

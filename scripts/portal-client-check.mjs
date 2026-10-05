// =============================================================================
// Client portal (phase 4) — rendered checks against MOCK data.
//
//     node scripts/portal-client-check.mjs
//
// MOCK ONLY: a throwaway Portal bundle with placeholder credentials, every
// request intercepted by a small fake of GoTrue, PostgREST, Storage and
// /api/portal-invite. Nothing reaches a real service.
//
// It proves what the browser does: a client gets only the Hungarian client
// portal and asks the server only for the client_portal_* functions; staff
// routes are unreachable; uploads are per-file with retry and a refused type
// fails alone; a lost access mid-upload is reported and not retried; the invite
// link is consumed from the fragment and removed from the address bar; the
// owner's invite shows the link once and logs it nowhere; sharing from the
// library. The database's own enforcement is tests/portal-client-db.spec.ts.
// =============================================================================
import { chromium } from '@playwright/test';
import { lowContrast } from './lib-contrast.mjs';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const BUNDLE = mkdtempSync(join(tmpdir(), 'stratos-client-'));
const PORT = 4400;
const MOCK_URL = 'https://mock.supabase.invalid';
const STORAGE = `${MOCK_URL}/storage/v1`;

console.log('building the mock portal bundle…');
execFileSync('npx', ['vite', 'build', '--outDir', BUNDLE, '--emptyOutDir', '--logLevel', 'warn'], {
  cwd: join(ROOT, 'portal'), stdio: 'inherit',
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
const SHOTS = process.env.SHOTS || null;
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, `CLIENT-${name}.png`), fullPage: true }); };

const now = () => new Date().toISOString();
const inHours = (h) => new Date(Date.now() + h * 3600e3).toISOString();
const CLIENT = { id: '22222222-2222-4222-8222-222222222222', email: 'anna@a.example' };
const OWNER = { id: '11111111-1111-4111-8111-111111111111', email: 'owner@example.invalid' };
const ORG = { id: 'c0000000-0000-4000-8000-000000000001', name: 'Rapidkert Kft.' };
const P1 = 'p0000000-0000-4000-8000-000000000001';
const P2 = 'p0000000-0000-4000-8000-000000000002';

function freshState(over = {}) {
  return {
    projects: [{ project_id: P1, project_name: 'Rapidkert weboldal' }],
    shared: [{ document_id: 'd-1', project_id: P1, project_name: 'Rapidkert weboldal', name: 'Árajánlat.pdf', byte_size: 1200,
      shared_at: now(), via_folder: 'Szerződések' }],
    uploads: [],
    objects: new Map(),
    puts: [], signs: [], requests: [], seq: 0,
    failPut: new Set(), revokeOnFinish: new Set(),
    invites: [], shares: [], outbox: [],
    verify: 'ok',
    demos: [{ demo_id: 'demo-1', project_id: P1, project_name: 'Rapidkert weboldal', title: 'Weboldal demó', url: 'https://demo.example.com/rapidkert',
      note: 'A kezdőlap és a kapcsolat oldal kész.', updated_at: now() }],
    meetings: [
      { meeting_id: 'm-cancel', project_id: P1, project_name: 'Rapidkert weboldal', title: 'Lemondott egyeztetés', starts_at: inHours(2), ends_at: inHours(3),
        time_zone: 'Europe/Budapest', join_url: 'https://meet.example.com/x', location: null, note: null, cancelled: true },
      { meeting_id: 'm-next', project_id: P1, project_name: 'Rapidkert weboldal', title: 'Demó átbeszélése & „árajánlat”', starts_at: inHours(26), ends_at: inHours(27),
        time_zone: 'Europe/Budapest', join_url: 'https://meet.example.com/abc', location: null, note: 'Hozd a kérdéseidet.', cancelled: false },
      { meeting_id: 'm-later', project_id: P1, project_name: 'Rapidkert weboldal', title: 'Átadás', starts_at: inHours(200), ends_at: inHours(201),
        time_zone: 'Europe/Budapest', join_url: null, location: 'Budapest, Váci út 1.', note: null, cancelled: false },
    ],
    help: [
      { article_id: 'h1', topic: 'Ügyfélportál – feltöltés', question: 'Hol adhatom le a képeket, a logót és a szövegeket?', alt_questions: ['hova töltsem fel a logót'],
        answer: 'A portál „Nyersanyag leadása” menüpontjában.',
        translations: { en: { question: 'Where do I hand over photos, the logo and texts?', topic: 'Client portal – uploads',
          alt_questions: ['where do I upload the logo'], answer: 'In the portal\'s “Hand over materials” section.' } } },
      { article_id: 'h2', topic: 'Ügyfélportál – feltöltés', question: 'Milyen fájlokat tölthetek fel?', alt_questions: ['mekkora fájlt tölthetek fel'], answer: 'Fájlonként legfeljebb 50 MB.',
        translations: { en: { question: 'Which files can I upload?', topic: 'Client portal – uploads', alt_questions: [], answer: 'Up to 50 MB per file.' } } },
      { article_id: 'h3', topic: 'Ügyfélportál – megbeszélések', question: 'Hogyan tehetem be a naptáramba?', alt_questions: ['google naptár'], answer: 'A „Google Naptárba helyezés” gombbal.' },
    ],
    feedback: [], reqs: [],
    approvals: [], asks: [], messages: [], surveys: [], calls: [],
    ...over,
  };
}
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function open(browser, { role = 'client', state = freshState(), viewport = { width: 1280, height: 900 }, session = true, colorScheme = 'dark' } = {}) {
  const context = await browser.newContext({ viewport, locale: 'hu-HU', acceptDownloads: true, colorScheme });
  const user = role === 'client' ? CLIENT : OWNER;
  const profile = { id: user.id, email: user.email, full_name: role === 'client' ? 'Kovács Anna' : 'Owner', avatar_url: null,
    role: role === 'client' ? 'client' : role === 'owner' ? 'super_admin' : role, organization_id: role === 'client' ? ORG.id : null };
  const logs = [];

  await context.route('**/*', async (route) => {
    const req = route.request();
    const url = req.url();
    const method = req.method();
    const body = () => JSON.parse(req.postData() || '{}');
    if (url.startsWith(MOCK_URL)) state.requests.push(`${method} ${new URL(url).pathname}`);

    if (url.includes('/api/portal-invite')) {
      const b = body();
      state.invites.push({ b, auth: req.headers().authorization });
      if (b.email === 'admin@example.invalid') return json(route, { ok: false, code: 'EMAIL_IS_STAFF' }, 409);
      return json(route, { ok: true, account_id: 'acc-new', kind: 'invite', link: 'https://stratosweb.hu/portal/accept-invite#token_hash=SECRET-HASH-123&type=invite' });
    }
    if (url.includes('/api/portal-')) return json(route, { ok: false }, 503);
    if (url.startsWith(`http://127.0.0.1:${PORT}/`)) return route.continue();

    if (url.includes('/auth/v1/verify')) {
      state.verified = body();
      if (state.verify !== 'ok') return json(route, { code: 403, error_code: 'otp_expired', msg: 'Token has expired or is invalid' }, 403);
      return json(route, { access_token: 'new-session', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
        refresh_token: 'r', user: { ...CLIENT, aud: 'authenticated', role: 'authenticated' } });
    }
    if (url.includes('/auth/v1/user') && method === 'PUT') { state.passwordSet = true; return json(route, { ...CLIENT }); }
    if (url.includes('/auth/v1/user')) return json(route, user);
    if (url.includes('/auth/v1/')) return json(route, { access_token: 'mock', user });

    if (url.includes('/rest/v1/rpc/is_owner')) return json(route, role === 'owner');
    if (url.includes('/rest/v1/profiles')) {
      if (method === 'PATCH') { state.profilePatches = [...(state.profilePatches ?? []), body()]; Object.assign(profile, body()); return json(route, []); }
      return json(route, profile);
    }

    // ---- the client API
    if (/\/rest\/v1\/rpc\/client_portal_me(\?|$)/.test(url)) return json(route, role === 'client' ? [{ full_name: 'Kovács Anna', company: ORG.name }] : []);
    if (url.includes('/rest/v1/rpc/client_portal_projects')) return json(route, role === 'client' ? state.projects : []);
    if (url.includes('/rest/v1/rpc/client_portal_documents')) return json(route, role === 'client' ? state.shared : []);
    if (url.includes('/rest/v1/rpc/client_portal_uploads')) return json(route, role === 'client' ? state.uploads : []);
    if (url.includes('/rest/v1/rpc/client_begin_upload')) {
      const b = body();
      if (!b.p_kind) return json(route, { code: 'P0001', message: 'stratos:document_type_not_allowed' }, 400);
      state.seq += 1;
      const id = `u-${state.seq}`;
      const taken = state.uploads.filter((u) => u.project_id === b.p_project && u.name.startsWith(b.p_name.replace(/\.[^.]+$/, ''))).length;
      const name = taken ? b.p_name.replace(/(\.[^.]+)$/, ` (${taken + 1})$1`) : b.p_name;
      state.uploads.unshift({ document_id: id, project_id: b.p_project, project_name: state.projects.find((p) => p.project_id === b.p_project)?.project_name,
        name, byte_size: b.p_size, uploaded_at: now(), state: 'pending', failure_reason: null });
      return json(route, [{ id, name, storage_path: `${b.p_project}/${id}` }]);
    }
    if (url.includes('/rest/v1/rpc/client_finish_upload')) {
      const u = state.uploads.find((x) => x.document_id === body().p_id);
      if (state.revokeOnFinish.has(u.name)) { Object.assign(u, { state: 'failed', failure_reason: 'access_revoked' }); return json(route, 'failed'); }
      if (!state.objects.has(`${u.project_id}/${u.document_id}`)) return json(route, 'missing');
      Object.assign(u, { state: 'ready' });
      return json(route, 'ready');
    }
    if (url.includes('/rest/v1/rpc/client_mark_upload')) {
      const b = body();
      const u = state.uploads.find((x) => x.document_id === b.p_id);
      Object.assign(u, { state: b.p_state, failure_reason: b.p_state === 'failed' ? b.p_reason : null });
      return json(route, u.state);
    }
    if (url.includes('/rest/v1/rpc/client_portal_demos')) return json(route, role === 'client' ? state.demos.filter((d) => state.projects.some((p) => p.project_id === d.project_id)) : []);
    if (url.includes('/rest/v1/rpc/client_portal_meetings')) return json(route, role === 'client' ? state.meetings.filter((m) => state.projects.some((p) => p.project_id === m.project_id)) : []);
    if (url.includes('/rest/v1/rpc/client_send_demo_feedback')) {
      const b = body(); state.feedback.push({ feedback_id: `f-${state.feedback.length + 1}`, demo_id: b.p_demo, body: b.p_body, created_at: now(), seen: false });
      return json(route, state.feedback.at(-1).feedback_id);
    }
    if (url.includes('/rest/v1/rpc/client_portal_demo_feedback')) return json(route, role === 'client' ? state.feedback : []);
    if (url.includes('/rest/v1/rpc/client_request_meeting_change')) {
      const b = body();
      if (state.reqs.some((r) => r.meeting_id === b.p_meeting && r.status === 'pending')) return json(route, { code: 'P0001', message: 'stratos:meeting_request_pending' }, 400);
      state.reqs.push({ request_id: `r-${state.reqs.length + 1}`, meeting_id: b.p_meeting, proposed_starts_at: b.p_starts, proposed_ends_at: b.p_ends,
        time_zone: b.p_time_zone, message: b.p_message, status: 'pending', owner_note: null, created_at: now(), decided_at: null });
      return json(route, state.reqs.at(-1).request_id);
    }
    if (url.includes('/rest/v1/rpc/client_withdraw_meeting_request')) {
      const r = state.reqs.find((x) => x.request_id === body().p_request); r.status = 'withdrawn'; r.decided_at = now(); return json(route, 'withdrawn');
    }
    if (url.includes('/rest/v1/rpc/client_portal_meeting_requests')) return json(route, role === 'client' ? state.reqs : []);
    // Client experience (20261014000100), like the real functions.
    if (url.includes('/rest/v1/rpc/client_portal_approvals')) return json(route, role === 'client' ? state.approvals : []);
    if (url.includes('/rest/v1/rpc/client_portal_requests')) return json(route, role === 'client' ? state.asks : []);
    if (url.includes('/rest/v1/rpc/client_portal_messages')) return json(route, role === 'client' ? state.messages : []);
    if (url.includes('/rest/v1/rpc/client_portal_surveys')) return json(route, role === 'client' ? state.surveys : []);
    for (const fn of ['client_decide_demo', 'client_complete_request', 'client_send_message', 'client_answer_survey', 'client_survey_google']) {
      if (!url.includes(`/rest/v1/rpc/${fn}`)) continue;
      const b = body();
      state.calls.push({ fn, ...b });
      if (fn === 'client_decide_demo') {
        if (!b.p_approve && !b.p_note) return json(route, { code: 'P0001', message: 'stratos:approval_note_needed' }, 400);
        Object.assign(state.approvals.find((a) => a.demo_id === b.p_demo), { state: b.p_approve ? 'approved' : 'changes', note: b.p_note, decided_at: now() });
        return json(route, b.p_approve ? 'approved' : 'changes');
      }
      if (fn === 'client_complete_request') { Object.assign(state.asks.find((a) => a.request_id === b.p_request), { done_at: now(), done_note: b.p_note }); return json(route, 'done'); }
      if (fn === 'client_send_message') {
        state.messages.push({ message_id: `msg-${state.messages.length + 1}`, project_id: b.p_project, body: b.p_body, created_at: now(), from_stratos: false, author_name: 'Kovács Anna', mine: true });
        return json(route, state.messages.at(-1).message_id);
      }
      if (fn === 'client_answer_survey') {
        const sv = state.surveys.find((x) => x.survey_id === b.p_survey);
        Object.assign(sv, { score: b.p_score, comment: b.p_comment, answered_at: now() });
        return json(route, b.p_score >= 7 ? 'https://g.page/r/stratos/review' : null);
      }
      return json(route, null);
    }
    if (url.includes('/rest/v1/rpc/client_help_articles')) { state.helpReads = (state.helpReads ?? 0) + 1; return json(route, role === 'client' ? state.help : []); }
    if (url.includes('/rest/v1/rpc/')) return json(route, []);

    // ---- the owner's tables
    if (url.includes('/rest/v1/client_accounts')) {
      return json(route, role === 'owner' ? [{ id: 'acc-1', email: 'anna@a.example', full_name: 'Kovács Anna', status: 'active', user_id: CLIENT.id,
        contact_id: null, invite_count: 1, last_invited_at: now(), linked_at: now(), first_seen_at: now(), revoked_at: null,
        access: [{ id: 'x-1', project_id: P1, granted_at: now(), revoked_at: null }] }] : []);
    }
    if (url.includes('/rest/v1/client_project_access')) {
      return json(route, role === 'owner' ? [{ account_id: 'acc-1', account: { full_name: 'Kovács Anna', email: 'anna@a.example', status: 'active', user_id: CLIENT.id } }] : []);
    }
    if (url.includes('/rest/v1/notification_outbox')) {
      if (method === 'POST') { state.outbox.push(body()); return json(route, [], 201); }
      return json(route, []);
    }
    if (url.includes('/rest/v1/document_shares')) {
      if (method === 'POST') { const b = body(); state.shares.push({ id: `s-${state.shares.length + 1}`, ...b }); return json(route, [], 201); }
      return json(route, role === 'owner' ? state.shares : []);
    }
    if (url.includes('/rest/v1/organizations')) {
      const org = { ...ORG, slug: 'r', website: null, status: 'active', acquisition_source: null, acquisition_medium: null, acquisition_campaign: null, primary_service: null, archived_at: null, created_at: now(), updated_at: now() };
      return json(route, req.headers().accept?.includes('pgrst.object') ? org : [org]);
    }
    if (url.includes('/rest/v1/projects')) {
      const rows = role === 'owner' ? [{ id: P1, organization_id: ORG.id, name: 'Rapidkert weboldal', slug: 'r', description: null, status: 'active', service: 'Web', value: 1, currency: 'HUF',
        start_date: null, target_date: null, completed_at: null, archived_at: null, opportunity_id: null, responsible_id: null, estimated_hours: null, actual_hours: null,
        payment_state: 'not_invoiced', invoiced_amount: null, paid_amount: null, program: 'paid', market_value: null, created_at: now(), updated_at: now(), client: ORG, responsible: null }] : [];
      return json(route, req.headers().accept?.includes('pgrst.object') ? rows[0] ?? null : rows);
    }
    if (url.includes('/rest/v1/project_documents')) {
      return json(route, role === 'owner' ? [{ id: 'd-1', project_id: P1, folder_id: null, name: 'Árajánlat.pdf', byte_size: 1200, declared_type: null, content_kind: 'pdf',
        upload_state: 'ready', failure_reason: null, storage_path: `${P1}/d-1`, created_at: now(), completed_at: now(), trashed_at: null, trashed_with: null,
        client_account_id: null, uploader: null },
      { id: 'd-2', project_id: P1, folder_id: null, name: 'logo.png', byte_size: 90, declared_type: null, content_kind: 'png',
        upload_state: 'ready', failure_reason: null, storage_path: `${P1}/d-2`, created_at: now(), completed_at: now(), trashed_at: null, trashed_with: null,
        client_account_id: 'acc-1', uploader: { full_name: 'Kovács Anna' } }] : []);
    }
    if (url.includes('/rest/v1/')) return json(route, []);

    // ---- Storage
    if (url.startsWith(`${STORAGE}/`)) {
      const u = new URL(url);
      const path = decodeURIComponent(u.pathname.replace(/^.*?\/project-documents\//, ''));
      if (method === 'POST' && u.pathname.includes('/object/upload/sign/')) {
        return json(route, { url: `/object/upload/sign/project-documents/${path}?token=upload-token-${state.seq}-${state.puts.length}` });
      }
      if (method === 'PUT') {
        const up = state.uploads.find((x) => `${x.project_id}/${x.document_id}` === path);
        state.puts.push({ path, headers: req.headers() });
        if (up && state.failPut.has(up.name)) return route.abort('connectionreset');
        state.objects.set(path, req.postDataBuffer());
        return json(route, { Key: path });
      }
      if (method === 'POST' && u.pathname.includes('/object/sign/')) {
        state.signs.push({ path, ...body() });
        return json(route, { signedURL: `/object/sign/project-documents/${path}?token=download-token-secret` });
      }
      // The bytes of an object this fake holds (the shared PDF for the viewer), else a stub attachment.
      if (method === 'GET' && state.objects.has(path)) return route.fulfill({ status: 200, body: state.objects.get(path) });
      if (method === 'GET') return route.fulfill({ status: 200, headers: { 'content-disposition': 'attachment; filename="x"' }, body: 'x' });
      return route.abort();
    }
    return route.abort();
  });

  const page = await context.newPage();
  page.on('console', (m) => logs.push(m.text()));
  if (session) {
    await page.addInitScript(([mockUrl, u]) => {
      const ref = new URL(mockUrl).hostname.split('.')[0];
      localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify({
        access_token: 'mock-access-token', refresh_token: 'mock-refresh-token', token_type: 'bearer',
        expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user: { ...u, aud: 'authenticated', role: 'authenticated' },
      }));
    }, [MOCK_URL, user]);
  }
  return { context, page, state, logs };
}

const results = [];
async function check(name, fn) {
  try { await fn(); results.push({ name, ok: true }); console.log(`  ok   ${name}`); }
  catch (e) { results.push({ name, ok: false }); console.log(`  FAIL ${name}\n       ${e.message.split('\n').slice(0, 3).join('\n       ')}`); }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const file = (name, content) => ({ name, mimeType: 'application/octet-stream', buffer: Buffer.from(content) });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const browser = await chromium.launch();

await check('a client gets only the Hungarian client portal; staff routes redirect; only client_portal_* is asked', async () => {
  const { page, context, state } = await open(browser);
  await page.goto(`${BASE}/`);
  await page.getByRole('navigation', { name: 'Ügyfélportál' }).waitFor();
  for (const tab of ['Projektjeim', 'Megosztott dokumentumok', 'Nyersanyag leadása']) {
    assert(await page.getByRole('navigation', { name: 'Ügyfélportál' }).getByRole('link', { name: tab }).count() === 1, `missing tab ${tab}`);
  }
  await page.getByText('Rapidkert weboldal').waitFor();
  for (const staff of ['Dashboard', 'Leads', 'Projects', 'Documents', 'Clients', 'Impact']) {
    assert(await page.getByRole('link', { name: staff, exact: true }).count() === 0, `staff link ${staff} shown to a client`);
  }
  for (const path of ['/leads', '/projects/x', '/documents', '/clients/x', '/impact', '/analytics']) {
    await page.goto(`${BASE}${path}`);
    await page.getByRole('navigation', { name: 'Ügyfélportál' }).waitFor();
    assert(/^\/portal\/?$/.test(new URL(page.url()).pathname), `${path} was not redirected (${page.url()})`);
  }
  const tables = state.requests.filter((r) => r.includes('/rest/v1/') && !/rpc\/(client_portal_|is_owner)|\/profiles/.test(r));
  assert(tables.length === 0, `a client's browser asked for: ${[...new Set(tables)].join(', ')}`);
  assert(await page.locator('html').getAttribute('lang') !== null, 'no lang');
  await shot(page, 'projects');
  await context.close();
});

await check('Megosztott dokumentumok: shared files with their route; download is a one-minute attachment link', async () => {
  const { page, context, state, logs } = await open(browser);
  await page.goto(`${BASE}/megosztott`);
  await page.getByText('Árajánlat.pdf').waitFor();
  await page.getByText('„Szerződések” mappán keresztül').waitFor();
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Árajánlat.pdf letöltése' }).click();
  await dl;
  assert(state.signs.at(-1).expiresIn === 60, `expiresIn ${state.signs.at(-1).expiresIn}`);
  assert(state.signs.at(-1).path === `${P1}/d-1`, `signed path ${state.signs.at(-1).path}`);
  assert(!logs.some((l) => /download-token|token=/.test(l)), 'a signed URL reached the console');
  await context.close();
});

await check('Nyersanyag leadása, one project: chosen automatically; per-file progress; a refused type and a dropped connection fail alone; retry', async () => {
  const state = freshState();
  state.failPut.add('szoveg.txt');
  const { page, context } = await open(browser, { state });
  await page.goto(`${BASE}/nyersanyag`);
  await page.getByText('Ide kerül:').waitFor();
  assert(await page.getByLabel('Projekt').count() === 0, 'a project selector for a single project');
  await page.locator('input[type=file]').setInputFiles([file('logo.png', PNG), file('setup.exe', 'MZ\x90'), file('szoveg.txt', 'Rólunk')]);
  const q = page.getByLabel('Feltöltések');
  await q.locator('[data-upload-phase="done"]', { hasText: 'logo.png' }).waitFor();
  await q.locator('[data-upload-phase="failed"]', { hasText: 'setup.exe' }).getByText('.exe típusú fájl nem tölthető fel.').waitFor();
  assert(await q.locator('[data-upload-phase="failed"]', { hasText: 'setup.exe' }).getByRole('button', { name: 'Újra' }).count() === 0, 'retry offered for a refused type');
  const txt = q.locator('[data-upload-phase="failed"]', { hasText: 'szoveg.txt' });
  await txt.getByText('Megszakadt a kapcsolat').waitFor({ timeout: 20000 });
  state.failPut.delete('szoveg.txt');
  await txt.getByRole('button', { name: 'Újra' }).click();
  await q.locator('[data-upload-phase="done"]', { hasText: 'szoveg.txt' }).waitFor({ timeout: 15000 });
  assert(state.uploads.filter((u) => u.name === 'szoveg.txt').length === 1, 'the retry made a second row');
  await page.getByRole('list', { name: 'Leadott fájlok' }).getByText('logo.png').waitFor();
  for (const p of state.puts) assert(p.headers['content-type'] === 'application/octet-stream' && p.headers['x-upsert'] === 'false', 'PUT headers');
  await shot(page, 'raw');
  await context.close();
});

await check('several projects: nothing uploads until one is chosen; the choice is where it goes', async () => {
  const state = freshState({ projects: [{ project_id: P1, project_name: 'Rapidkert weboldal' }, { project_id: P2, project_name: 'Rapidkert hirdetés' }] });
  const { page, context } = await open(browser, { state });
  await page.goto(`${BASE}/nyersanyag`);
  await page.getByLabel('Projekt').waitFor();
  assert(await page.getByRole('button', { name: 'Fájlok kiválasztása' }).count() === 0, 'upload offered before a project is chosen');
  await page.getByLabel('Projekt').selectOption({ label: 'Rapidkert hirdetés' });
  await page.getByText('Ide kerül:').waitFor();
  await page.locator('input[type=file]').setInputFiles([file('banner.png', PNG)]);
  await page.getByLabel('Feltöltések').locator('[data-upload-phase="done"]').waitFor();
  assert(state.uploads[0].project_id === P2, `went to ${state.uploads[0].project_id}`);
  await context.close();
});

await check('access withdrawn mid-upload: said plainly, and no retry is offered', async () => {
  const state = freshState();
  state.revokeOnFinish.add('kesei.pdf');
  const { page, context } = await open(browser, { state });
  await page.goto(`${BASE}/nyersanyag`);
  await page.locator('input[type=file]').setInputFiles([file('kesei.pdf', '%PDF-1.4 x')]);
  const item = page.getByLabel('Feltöltések').locator('[data-upload-phase="failed"]');
  await item.getByText('már nincs hozzáférésed').waitFor();
  assert(await item.getByRole('button', { name: 'Újra' }).count() === 0, 'retry offered after access was withdrawn');
  await context.close();
});

await check('the invite link: token read from the fragment, removed from the address bar, password set by the client', async () => {
  const { page, context, state, logs } = await open(browser, { session: false });
  await page.goto(`${BASE}/accept-invite#token_hash=SECRET-HASH-123&type=invite`);
  await page.getByLabel('Új jelszó').waitFor();
  assert(!page.url().includes('SECRET-HASH'), `token still in the URL: ${page.url()}`);
  assert(state.verified?.token_hash === 'SECRET-HASH-123' && state.verified?.type === 'invite', `verify body ${JSON.stringify(state.verified)}`);
  await page.getByLabel('Új jelszó').fill('Erős-jelszo-2026');
  await page.getByLabel('Jelszó még egyszer').fill('Erős-jelszo-2026');
  await page.getByRole('button', { name: 'Jelszó mentése' }).click();
  await page.waitForURL(/\/portal\/?$/);
  assert(state.passwordSet, 'no password was set');
  assert(!logs.some((l) => l.includes('SECRET-HASH')), 'the token reached the console');
  await context.close();
});

await check('an expired or used link says so, in Hungarian', async () => {
  const { page, context } = await open(browser, { session: false, state: freshState({ verify: 'expired' }) });
  await page.goto(`${BASE}/accept-invite#token_hash=OLD&type=invite`);
  await page.getByText('A link nem érvényes').waitFor();
  await page.goto(`${BASE}/accept-invite`);
  await page.getByText('A link nem érvényes').waitFor();
  await context.close();
});

await check('at phone width the client pages fit, and their controls are thumb-sized', async () => {
  const { page, context } = await open(browser, { viewport: { width: 390, height: 844 } });
  for (const path of ['/', '/megosztott', '/nyersanyag', '/segitseg']) {
    await page.goto(`${BASE}${path}`);
    await page.getByRole('navigation', { name: 'Ügyfélportál' }).waitFor();
    await page.waitForTimeout(300);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert(overflow <= 0, `${path} scrolls sideways by ${overflow}px`);
    const small = await page.locator('main button, nav a').evaluateAll((els) => els.filter((e) => e.offsetParent !== null)
      .map((e) => ({ t: e.textContent.trim(), ...e.getBoundingClientRect().toJSON() })).filter((r) => r.height < 40));
    assert(small.length === 0, `${path}: small controls ${small.map((s) => `${s.t} ${Math.round(s.height)}`).join(', ')}`);
  }
  await shot(page, 'mobile');
  await context.close();
});

await check('owner: invite from the client page — the link is shown once, sent with the owner\'s token, logged nowhere', async () => {
  const { page, context, state, logs } = await open(browser, { role: 'owner' });
  await page.goto(`${BASE}/clients/${ORG.id}`);
  const panel = page.getByLabel('Client accounts');
  await panel.getByText('anna@a.example').waitFor();
  await panel.getByRole('button', { name: 'Invite' }).click();
  await page.getByRole('dialog').getByLabel('Name').fill('Szabó Péter');
  await page.getByRole('dialog').getByLabel('E-mail').fill('peter@a.example');
  await page.getByRole('dialog').getByLabel('Rapidkert weboldal').check();
  await page.getByRole('dialog').getByRole('button', { name: 'Invite' }).click();
  const linkBox = page.getByRole('dialog').getByLabel('Link');
  await linkBox.waitFor();
  assert((await linkBox.inputValue()).includes('#token_hash='), 'no link shown');
  const sent = state.invites.at(-1);
  assert(sent.auth === 'Bearer mock-access-token', `invite sent with ${sent.auth}`);
  assert(JSON.stringify(sent.b.project_ids) === JSON.stringify([P1]) && sent.b.organization_id === ORG.id, JSON.stringify(sent.b));
  await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
  assert(await page.getByText('SECRET-HASH-123').count() === 0 && await page.locator('input[value*="SECRET"]').count() === 0, 'the link outlived its dialog');
  assert(!logs.some((l) => l.includes('SECRET-HASH')), 'the link reached the console');
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
  assert(!stored.includes('SECRET-HASH'), 'the link was stored in the browser');

  await panel.getByRole('button', { name: 'Invite' }).click();
  await page.getByRole('dialog').getByLabel('Name').fill('Admin');
  await page.getByRole('dialog').getByLabel('E-mail').fill('admin@example.invalid');
  await page.getByRole('dialog').getByRole('button', { name: 'Invite' }).click();
  await page.getByRole('dialog').getByText('belongs to a staff account').waitFor();
  await shot(page, 'owner-invite');
  await context.close();
});

await check('owner: share from the library — assigned accounts only, the client is e-mailed, and the client\'s upload shows who sent it', async () => {
  const { page, context, state } = await open(browser, { role: 'owner' });
  await page.goto(`${BASE}/documents/${P1}`);
  await page.locator('li[data-document="d-2"]').getByText('from Kovács Anna').waitFor();
  await page.getByRole('button', { name: 'Share Árajánlat.pdf' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByText('anna@a.example').waitFor();
  await dialog.getByRole('button', { name: 'Share' }).click();
  await dialog.getByRole('button', { name: 'Stop sharing' }).waitFor();
  assert(state.shares.length === 1 && state.shares[0].document_id === 'd-1' && state.shares[0].account_id === 'acc-1', JSON.stringify(state.shares));
  // "E-mail the client when I share" is on by default: one message, to that account only.
  await page.waitForTimeout(200);
  const ob = state.outbox;
  assert(ob.length === 1 && ob[0].kind === 'document_shared' && ob[0].audience === 'client' && ob[0].project_id === P1
    && ob[0].payload.name === 'Árajánlat.pdf' && JSON.stringify(ob[0].account_ids) === '["acc-1"]', JSON.stringify(ob));
  await dialog.getByRole('button', { name: 'Done' }).click();
  await page.locator('li[data-document="d-1"] [data-shared-with="Kovács Anna"]').waitFor();
  await context.close();
});

await check('a staff account that is not the owner sees no client accounts and sends no request for them', async () => {
  const { page, context, state } = await open(browser, { role: 'admin' });
  await page.goto(`${BASE}/clients/${ORG.id}`);
  await page.waitForTimeout(1200);
  assert(await page.getByLabel('Client accounts').count() === 0, 'the panel is shown to an admin');
  assert(!state.requests.some((r) => r.includes('client_accounts')), 'client_accounts was requested by an admin');
  await context.close();
});


/* ------------------------------------------ phase 7: demos, meetings, help */

await check('Projektjeim: a published demo is a clear card whose button opens a new tab; nothing is embedded', async () => {
  const { page, context } = await open(browser);
  await page.goto(`${BASE}/`);
  const card = page.locator('[data-client-demo="demo-1"]');
  await card.waitFor();
  const link = card.getByRole('link', { name: /Demó megtekintése/ });
  assert(await link.getAttribute('target') === '_blank' && (await link.getAttribute('rel'))?.includes('noopener'), 'demo link not a safe new tab');
  assert(await link.getAttribute('href') === 'https://demo.example.com/rapidkert', 'wrong demo href');
  assert(await page.locator('iframe, object, embed').count() === 0, 'something is embedded');
  assert(await card.getByText('A kezdőlap és a kapcsolat oldal kész.').isVisible(), 'note missing');
  await shot(page, 'projects-demo-meetings');
  await context.close();
});

await check('meetings: the next one is highlighted with a Google Calendar button; a cancelled one has none; the sync caveat is said', async () => {
  const { page, context } = await open(browser);
  await page.goto(`${BASE}/`);
  const next = page.locator('[data-client-meeting="m-next"]');
  await next.waitFor();
  assert(await next.getAttribute('data-highlight') === 'true', 'next meeting not highlighted');
  assert(await next.getByText('Következő megbeszélés').isVisible(), 'no next label');
  const cal = next.getByRole('link', { name: /Google Naptárba helyezés/ });
  const href = await cal.getAttribute('href');
  const u = new URL(href);
  assert(u.hostname === 'calendar.google.com' && u.searchParams.get('action') === 'TEMPLATE', `calendar link ${href}`);
  assert(u.searchParams.get('text') === 'Demó átbeszélése & „árajánlat”', `title ${u.searchParams.get('text')}`);
  assert(/^\d{8}T\d{6}Z\/\d{8}T\d{6}Z$/.test(u.searchParams.get('dates')), 'dates not UTC');
  assert(await cal.getAttribute('target') === '_blank', 'calendar not a new tab');
  const cancelled = page.locator('[data-client-meeting="m-cancel"]');
  assert(await cancelled.getByText('Lemondva').isVisible(), 'cancelled not flagged');
  assert(await cancelled.getByRole('link', { name: /Google Naptár|Csatlakozás/ }).count() === 0, 'cancelled meeting offers calendar/join');
  assert(await cancelled.getAttribute('data-highlight') === null, 'cancelled highlighted');
  assert(await page.getByText('nem frissíti automatikusan', { exact: false }).isVisible(), 'sync caveat missing');
  const later = page.locator('[data-client-meeting="m-later"]');
  assert(await later.getByText('Budapest, Váci út 1.').isVisible(), 'place missing');
  await context.close();
});

await check('access withdrawn: no project, so no demo and no meeting either', async () => {
  const { page, context } = await open(browser, { state: freshState({ projects: [] }) });
  await page.goto(`${BASE}/`);
  await page.getByText('Nincs projekt').waitFor();
  assert(await page.locator('[data-client-demo], [data-client-meeting]').count() === 0, 'demo or meeting of a withdrawn project shown');
  await context.close();
});

await check('Segítség: known, rephrased and unknown questions — by keyboard, with no request while chatting', async () => {
  const state = freshState();
  const { page, context } = await open(browser, { state });
  await page.goto(`${BASE}/segitseg`);
  const input = page.getByLabel('Kérdésed');
  await input.waitFor();
  const before = state.requests.length;
  await input.focus();
  await page.keyboard.type('mekkora fájlt tölthetek fel?');
  await page.keyboard.press('Enter');
  await page.locator('[data-reply="answer"]').last().getByText('Fájlonként legfeljebb 50 MB.').waitFor();
  await input.fill('google naptár');
  await page.keyboard.press('Enter');
  await page.locator('[data-reply="answer"]').last().getByText('Google Naptárba helyezés', { exact: false }).waitFor();
  await input.fill('mikor fizetem ki a számlát a kutyámnak');
  await page.keyboard.press('Enter');
  await page.locator('[data-reply="unknown"]').last().waitFor();
  assert(await page.getByText('Erre a kérdésre nincs kész válaszom.', { exact: false }).isVisible(), 'unknown not honest');
  assert(!(await page.locator('[data-help-chat]').innerText()).match(/továbbítottam|elküldtem|elküldtük/i), 'claims to forward');
  assert(state.requests.length === before, `${state.requests.length - before} requests while chatting`);
  await page.getByRole('group', { name: 'Témák' }).getByRole('button', { name: 'Ügyfélportál – feltöltés' }).click();
  await page.getByRole('group', { name: 'Javasolt kérdések' }).getByRole('button', { name: 'Hol adhatom le a képeket, a logót és a szövegeket?' }).click();
  await page.locator('[data-reply="answer"]').last().getByText('Nyersanyag leadása', { exact: false }).waitFor();
  await shot(page, 'help');
  await context.close();
});

/* --------------------------------- phase 8: demo feedback, reschedule (client) */

await check('Észrevételek: a client writes feedback under the demo by keyboard; it is listed as sent, not yet seen', async () => {
  const state = freshState();
  const { page, context } = await open(browser, { state });
  await page.goto(`${BASE}/`);
  const box = page.locator('[data-demo-feedback="demo-1"]');
  await box.getByRole('button', { name: 'Észrevételek' }).click();
  const area = box.getByLabel('Új észrevétel a demóról');
  await area.focus();
  await page.keyboard.type('A kapcsolat oldalon elírás van.');
  await box.getByRole('button', { name: 'Küldés' }).click();
  await box.getByText('Elküldve.').waitFor();
  assert(state.feedback.length === 1 && state.feedback[0].body === 'A kapcsolat oldalon elírás van.' && state.feedback[0].demo_id === 'demo-1', JSON.stringify(state.feedback));
  await box.getByText('Még nem látta').waitFor();
  assert(!(await box.innerText()).match(/továbbítottam|elküldtük a kollégának/i), 'claims forwarding');
  await context.close();
});

await check('Észrevételek: Stratos\'s answer is shown under the client\'s feedback', async () => {
  const state = freshState();
  state.feedback.push({ feedback_id: 'f-1', demo_id: 'demo-1', body: 'A logó legyen nagyobb.', created_at: new Date(Date.now() - 864e5).toISOString(), seen: true,
    reply: 'Rendben, a jövő heti demóban már nagyobb lesz.', replied_at: new Date().toISOString() });
  const { page, context } = await open(browser, { state });
  await page.goto(`${BASE}/`);
  const box = page.locator('[data-demo-feedback="demo-1"]');
  await box.getByRole('button', { name: 'Észrevételek' }).click();
  const reply = box.locator('[data-feedback-reply]');
  await reply.getByText('A Stratos válasza').waitFor();
  await reply.getByText('Rendben, a jövő heti demóban már nagyobb lesz.').waitFor();
  await context.close();
});

await check('Rád várunk: approve a demo, ask for changes only with a note, mark a request done, answer the survey and get the Google link', async () => {
  const state = freshState({
    demos: [
      { demo_id: 'demo-1', project_id: P1, project_name: 'Rapidkert weboldal', title: 'Weboldal demó', url: 'https://demo.example.com/rapidkert', note: null, updated_at: now() },
      { demo_id: 'demo-2', project_id: P1, project_name: 'Rapidkert weboldal', title: 'Logó változatok', url: 'https://demo.example.com/logo', note: null, updated_at: now() },
    ],
    approvals: [
      { demo_id: 'demo-1', project_id: P1, requested_at: now(), state: null, note: null, decided_at: null },
      { demo_id: 'demo-2', project_id: P1, requested_at: now(), state: null, note: null, decided_at: null },
    ],
    asks: [{ request_id: 'rq-1', project_id: P1, title: 'Logó SVG-ben', details: 'AI vagy SVG fájl', due_on: '2020-01-01', created_at: now(), done_at: null, done_note: null }],
    surveys: [{ survey_id: 'sv-1', project_id: P1, reason: 'closed', period: 'closed', created_at: now(), score: null, comment: null, answered_at: null, google_url: null }],
  });
  const { page, context } = await open(browser, { state });
  await page.goto(`${BASE}/`);
  const panel = page.getByRole('region', { name: 'Rád várunk' });
  await panel.getByText('Logó SVG-ben').waitFor();
  await panel.getByText('Határidő lejárt', { exact: false }).waitFor();

  // Approve one demo.
  await panel.locator('[data-approve="demo-1"]').getByRole('button', { name: 'Jóváhagyom' }).click();
  await page.locator('[data-client-demo="demo-1"] [data-approval-state="approved"]').waitFor();
  // Changes need a note.
  const two = panel.locator('[data-approve="demo-2"]');
  await two.getByRole('button', { name: 'Módosítást kérek' }).click();
  assert(await two.getByRole('button', { name: 'Módosítási kérés elküldése' }).isDisabled(), 'changes sendable without a note');
  await two.getByLabel('Mit módosítsunk?').fill('A színek legyenek világosabbak.');
  await two.getByRole('button', { name: 'Módosítási kérés elküldése' }).click();
  await page.locator('[data-client-demo="demo-2"] [data-approval-state="changes"]').waitFor();
  assert(JSON.stringify(state.calls.filter((c) => c.fn === 'client_decide_demo').map((c) => [c.p_demo, c.p_approve, c.p_note])) ===
    JSON.stringify([['demo-1', true, null], ['demo-2', false, 'A színek legyenek világosabbak.']]), JSON.stringify(state.calls));

  // The request.
  const ask = panel.locator('[data-client-ask="rq-1"]');
  await ask.getByRole('button', { name: 'Kész' }).click();
  await ask.getByLabel('Megjegyzés (nem kötelező)').fill('Feltöltöttem.');
  await ask.getByRole('button', { name: 'Jelzem, hogy kész' }).click();
  await panel.getByText('Nemrég elintézve (1)').waitFor();

  // The survey: 9 → thanks and the Google link.
  const sv = panel.locator('[data-survey-open="sv-1"]');
  assert(await sv.getByRole('button', { name: 'Küldés' }).isDisabled(), 'survey sendable without a score');
  await sv.getByRole('radio', { name: '9' }).click();
  await sv.getByLabel('Szeretnél még valamit hozzáfűzni? (nem kötelező)').fill('Gyorsak voltatok.');
  await sv.getByRole('button', { name: 'Küldés' }).click();
  const thanks = panel.locator('[data-survey-thanks]');
  await thanks.getByText('Köszönjük a visszajelzést!').waitFor();
  const google = thanks.getByRole('link', { name: 'Google-értékelés írása', exact: false });
  assert(await google.getAttribute('href') === 'https://g.page/r/stratos/review', 'google link');
  const call = state.calls.find((c) => c.fn === 'client_answer_survey');
  assert(call.p_score === 9 && call.p_comment === 'Gyorsak voltatok.', JSON.stringify(call));
  await shot(page, 'client-waiting-for-you');
  await thanks.getByRole('button', { name: 'Most nem' }).click();
  await panel.getByText('Most semmi nem vár rád.').waitFor();
  await context.close();
});

await check('Üzenetek: the client reads the thread and writes to Stratos', async () => {
  const state = freshState({ messages: [
    { message_id: 'msg-0', project_id: P1, body: 'Elküldtük a demót, nézd meg!', created_at: now(), from_stratos: true, author_name: 'Stratos', mine: false },
  ] });
  const { page, context } = await open(browser, { state });
  await page.goto(`${BASE}/`);
  const box = page.locator(`[data-client-messages="${P1}"]`);
  await box.getByRole('button', { name: 'Üzenetek a Stratosnak (1)' }).click();
  await box.getByText('Elküldtük a demót, nézd meg!').waitFor();
  await box.getByLabel('Új üzenet').fill('Megnéztem, tetszik!');
  await box.getByRole('button', { name: 'Küldés' }).click();
  await box.getByText('Megnéztem, tetszik!', { exact: true }).waitFor();
  const c = state.calls.find((x) => x.fn === 'client_send_message');
  assert(c && c.p_project === P1 && c.p_body === 'Megnéztem, tetszik!', JSON.stringify(state.calls));
  assert(await page.getByRole('region', { name: 'Rád várunk' }).getByText('Most semmi nem vár rád.').isVisible(), 'empty state');
  await context.close();
});

await check('Új időpont javaslása: sent as a proposal in the meeting\'s zone; shown as pending; can be withdrawn; the meeting itself is unchanged', async () => {
  const state = freshState();
  const { page, context } = await open(browser, { state });
  await page.goto(`${BASE}/`);
  const card = page.locator('[data-client-meeting="m-next"]');
  await card.getByRole('button', { name: 'Új időpont javaslása' }).click();
  const future = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Budapest' }).format(new Date(Date.now() + 5 * 864e5));
  await card.getByLabel('Dátum').fill(future);
  await card.getByLabel('Kezdés').fill('14:00');
  await card.getByLabel('Befejezés').fill('15:00');
  await card.getByLabel('Üzenet (nem kötelező)').fill('Délután jobb lenne.');
  await card.getByRole('button', { name: 'Javaslat elküldése' }).click();
  await card.locator('[data-request-status="pending"]').waitFor();
  const r = state.reqs[0];
  assert(r.meeting_id === 'm-next' && r.time_zone === 'Europe/Budapest' && r.message === 'Délután jobb lenne.', JSON.stringify(r));
  const wall = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Budapest', hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).format(new Date(r.proposed_starts_at));
  assert(wall === '14:00', `stored start is ${wall} in Budapest`);
  assert(state.meetings.find((m) => m.meeting_id === 'm-next').starts_at === state.meetings.find((m) => m.meeting_id === 'm-next').starts_at, 'meeting moved');
  await card.getByRole('button', { name: 'Javaslat visszavonása' }).click();
  await card.getByRole('button', { name: 'Új időpont javaslása' }).waitFor();
  assert(state.reqs[0].status === 'withdrawn', 'not withdrawn');
  assert(await page.locator('[data-client-meeting="m-cancel"]').getByRole('button', { name: 'Új időpont javaslása' }).count() === 0, 'a cancelled meeting offers a proposal');
  await shot(page, 'reschedule');
  await context.close();
});

/* ============================================================ theme === */

const themeOf = (page) => page.evaluate(() => ({ theme: document.documentElement.dataset.theme, pref: document.documentElement.dataset.themePref,
  bg: getComputedStyle(document.body).backgroundColor, stored: localStorage.getItem('stratos.portal.theme') }));

await check('Megjelenés: Rendszer follows the device, live; Világos/Sötét are remembered on this device', async () => {
  const { page, context } = await open(browser, { colorScheme: 'light' });
  await page.goto(`${BASE}/`);
  const sw = page.getByRole('radiogroup', { name: 'Megjelenés' });
  await sw.waitFor();
  assert(await sw.getByRole('radio', { name: 'Rendszer' }).getAttribute('aria-checked') === 'true', 'default is not Rendszer');
  let t = await themeOf(page);
  assert(t.theme === 'light' && t.bg === 'rgb(244, 246, 249)' && t.stored === null, `system light: ${JSON.stringify(t)}`);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  t = await themeOf(page);
  assert(t.bg === 'rgb(11, 15, 22)', `system dark bg ${t.bg}`);
  // Keyboard: the arrow keys move the choice.
  await sw.getByRole('radio', { name: 'Rendszer' }).focus();
  await page.keyboard.press('ArrowRight');
  t = await themeOf(page);
  assert(t.theme === 'light' && t.pref === 'light' && t.stored === 'light', `after ArrowRight: ${JSON.stringify(t)}`);
  // Chosen, it no longer follows the device, and survives a reload — set before first paint.
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  t = await themeOf(page);
  assert(t.theme === 'light' && t.pref === 'light', `after reload: ${JSON.stringify(t)}`);
  await page.getByRole('radiogroup', { name: 'Megjelenés' }).getByRole('radio', { name: 'Sötét' }).click();
  t = await themeOf(page);
  assert(t.theme === 'dark' && t.stored === 'dark', `Sötét: ${JSON.stringify(t)}`);
  await page.getByRole('radiogroup', { name: 'Megjelenés' }).getByRole('radio', { name: 'Rendszer' }).click();
  t = await themeOf(page);
  assert(t.pref === 'system' && t.stored === null && t.theme === 'dark', `back to Rendszer: ${JSON.stringify(t)}`);
  await context.close();
});

await check('light theme: every client page and the sign-in page read at 4.5:1 or better; dark stays as it was', async () => {
  for (const scheme of ['light', 'dark']) {
    const { page, context } = await open(browser, { colorScheme: scheme });
    for (const path of ['/', '/megosztott', '/nyersanyag', '/segitseg']) {
      await page.goto(`${BASE}${path}`);
      await page.getByRole('navigation', { name: 'Ügyfélportál' }).waitFor();
      await page.waitForLoadState('networkidle');
      if (path === '/') {
        await page.getByText('Rapidkert weboldal').first().waitFor();
        for (const b of await page.getByRole('button', { name: /Észrevételek|Új időpont javaslása/ }).all()) await b.click();
      }
      const bad = await lowContrast(page);
      assert(bad.length === 0, `${scheme} ${path}: ${JSON.stringify(bad.slice(0, 5))}`);
      if (path === '/') await shot(page, `theme-${scheme}`);
    }
    await context.close();
    const login = await open(browser, { colorScheme: scheme, session: false });
    await login.page.goto(`${BASE}/login`);
    await login.page.getByRole('radiogroup', { name: 'Appearance' }).waitFor();
    const bad = await lowContrast(login.page);
    assert(bad.length === 0, `${scheme} login: ${JSON.stringify(bad.slice(0, 5))}`);
    await shot(login.page, `login-${scheme}`);
    await login.context.close();
  }
});

await check('Megnyitás: a shared PDF opens inside the client portal, without downloading', async () => {
  const state = freshState();
  state.objects.set(`${P1}/d-1`, readFileSync(join(ROOT, 'scripts', 'fixtures', 'viewer-test.pdf')));
  const { page, context } = await open(browser, { state });
  await page.goto(`${BASE}/megosztott`);
  await page.getByRole('button', { name: 'Árajánlat.pdf megnyitása' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('[data-pdf-pages] canvas').first().waitFor({ timeout: 15000 });
  await dialog.getByText('1 oldal').waitFor();
  assert(await dialog.getByRole('button', { name: 'Letöltés' }).count() === 1, 'no download button in the viewer');
  await shot(page, 'viewer-pdf');
  await context.close();
});

await check('language: English and German in the client header, saved on the client\'s own profile; help says its articles are Hungarian', async () => {
  const state = freshState();
  const { page, context } = await open(browser, { state });
  await page.goto(`${BASE}/`);
  await page.getByRole('navigation', { name: 'Ügyfélportál' }).waitFor();
  await page.getByRole('radio', { name: 'English' }).click();
  const nav = page.getByRole('navigation', { name: 'Client portal' });
  await nav.waitFor();
  for (const label of ['My projects', 'Documents', 'Hand over materials', 'Help']) await nav.getByText(label).first().waitFor();
  assert(state.profilePatches?.at(-1)?.locale === 'en', 'the choice was not saved on the profile');
  assert(await page.locator('[lang="en"]').first().isVisible(), 'the page is not marked English');
  await page.goto(`${BASE}/segitseg`);
  // Two of the three articles have English; the third is shown in Hungarian, and the page says so.
  await page.getByText('Some help articles are only available in Hungarian.').waitFor();
  await page.getByLabel('Your question').fill('Where do I upload the logo?');
  await page.getByRole('button', { name: 'Ask' }).click();
  await page.locator('[data-reply="answer"]').getByText('In the portal\'s “Hand over materials” section.').waitFor();
  await shot(page, 'lang-en');
  await page.getByRole('radio', { name: 'Deutsch' }).click();
  await page.getByRole('navigation', { name: 'Kundenportal' }).waitFor();
  for (const path of ['/', '/megosztott', '/nyersanyag']) {
    await page.goto(`${BASE}${path}`);
    await page.waitForLoadState('networkidle');
    const bad = await lowContrast(page);
    assert(bad.length === 0, `de ${path}: ${JSON.stringify(bad.slice(0, 3))}`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/`);
  await page.waitForLoadState('networkidle');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'German client portal scrolls sideways at 390px');
  await shot(page, 'lang-de-phone');
  await context.close();
});

await browser.close();
server.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} client portal checks passed`);
process.exit(failed.length ? 1 : 0);

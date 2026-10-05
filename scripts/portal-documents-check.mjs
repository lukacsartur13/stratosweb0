// =============================================================================
// Document library — rendered checks against MOCK data.
//
//     node scripts/portal-documents-check.mjs
//
// Same method as scripts/portal-tracker-check.mjs: a throwaway Portal bundle
// with placeholder Supabase credentials (built into the OS temp directory,
// never into dist/), driven in Chromium with EVERY request intercepted. The
// fake here also plays Supabase Storage — signed upload URLs, the PUT, signed
// download URLs and downloads — so the whole upload path runs in the browser
// exactly as it would against the real service. Nothing reaches a real one;
// an unmatched request is aborted.
//
// It proves the rendered behaviour: who sees the library, the project facts,
// folders, multi-file upload with per-file progress and errors, retry, the
// same-name numbering the server answers with, rename, move, trash/restore,
// search, preview only of sniffed-safe bytes, the download link's lifetime,
// what the upload request carries, and that no signed URL is ever logged.
//
// It does NOT prove the database or Storage enforce anything — the fake does
// what it is told. That is tests/portal-documents-db.spec.ts.
//
// Exit code 0 when every check passes, 1 otherwise.
// =============================================================================
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const BUNDLE = mkdtempSync(join(tmpdir(), 'stratos-documents-'));
const PORT = 4399;
const MOCK_URL = 'https://mock.supabase.invalid';
const STORAGE = `${MOCK_URL}/storage/v1`;

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
const SHOTS = process.env.SHOTS || null;
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, `DOCS-${name}.png`), fullPage: true }); };

/* ------------------------------------------------------------- fixtures */

const now = () => new Date().toISOString();
const USER = { id: '11111111-1111-4111-8111-111111111111', email: 'owner@example.invalid' };
const ORG = { id: 'c0000000-0000-4000-8000-000000000001', name: 'Rapidkert Kft.' };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

const project = (over) => ({
  organization_id: ORG.id, slug: over.id, description: null, service: 'Weboldal', value: 1500000, currency: 'HUF',
  start_date: null, target_date: null, completed_at: null, archived_at: null, opportunity_id: null,
  responsible_id: null, estimated_hours: null, actual_hours: null, payment_state: 'partially_paid',
  invoiced_amount: 1000000, paid_amount: 500000, created_at: now(), updated_at: now(),
  client: ORG, responsible: null, status: 'active', program: 'paid', market_value: null, ...over,
});

function freshState() {
  return {
    projects: [
      project({ id: 'p-web', name: 'Rapidkert website' }),
      project({ id: 'p-old', name: 'Old brochure', status: 'completed', completed_at: now(), archived_at: now() }),
      project({ id: 'i-web', name: 'Tanoda website', program: 'impact', value: null, payment_state: 'not_invoiced',
        invoiced_amount: null, paid_amount: null, market_value: 800000, service: 'Website' }),
    ],
    milestones: [
      { id: 'm1', project_id: 'p-web', title: 'Design', position: 0, state: 'done', due_on: null, completed_at: null, assignee: null, note: null, blocked_reason: null, next_step: null },
      { id: 'm2', project_id: 'p-web', title: 'Content', position: 1, state: 'blocked', due_on: null, completed_at: null, assignee: null, note: null, blocked_reason: 'No copy yet', next_step: 'Chase the client', },
    ],
    folders: [],
    docs: [],
    objects: new Map(),     // storage_path → Buffer
    puts: [],               // headers of every upload PUT
    signs: [],              // every signed-download request body
    failPut: new Set(),     // doc names whose PUT always drops
    dropOnce: new Set(),    // doc names whose FIRST PUT drops
    seq: 0,
    documentRequests: 0,
    signs_upload: 0,
    begins: [],             // every begin call's body
    failBegin: 0,           // answer the next N begins with a database error
    failFinish: 0,          // answer the next N finishes with a database error
    expireFirstPut: new Set(), // doc names whose first PUT meets an expired link
  };
}

const CONTACTS = [
  { id: 'ct-1', organization_id: ORG.id, name: 'Kovács Anna', role: 'Owner', email: 'anna@example.invalid', phone: '+36 30 111 2222', is_primary: true, created_at: now() },
  { id: 'ct-2', organization_id: ORG.id, name: 'Szabó Péter', role: 'Marketing', email: null, phone: null, is_primary: false, created_at: now() },
];

function applyFilters(url, rows) {
  let out = rows;
  for (const [key, raw] of new URL(url).searchParams) {
    if (['select', 'order', 'limit', 'or'].includes(key)) continue;
    const [op, ...rest] = raw.split('.');
    const value = rest.join('.');
    if (op === 'eq') out = out.filter((r) => String(r[key] ?? '') === value);
    else if (op === 'is' && value === 'null') out = out.filter((r) => r[key] === null || r[key] === undefined);
    else if (op === 'ilike') {
      const needle = value.replace(/^%|%$/g, '').replace(/\\([\\%_])/g, '$1').toLowerCase();
      out = out.filter((r) => String(r[key] ?? '').toLowerCase().includes(needle));
    }
  }
  return out;
}

/** The server's naming rule: a taken name in the folder is numbered. */
function freeName(state, projectId, folderId, name, except) {
  const ext = name.match(/(\.[^.\s]{1,16})$/)?.[1] ?? '';
  const stem = name.slice(0, name.length - ext.length);
  const taken = (n) => state.docs.some((d) => d.project_id === projectId && d.folder_id === folderId
    && !d.trashed_at && d.name.toLowerCase() === n.toLowerCase() && d.id !== except);
  let candidate = name;
  for (let i = 2; taken(candidate); i += 1) candidate = `${stem} (${i})${ext}`;
  return candidate;
}

/* ------------------------------------------------------------ the fake */

const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function open(browser, { owner = true, state = freshState(), viewport = { width: 1280, height: 900 } } = {}) {
  const context = await browser.newContext({ viewport, locale: 'en-GB', acceptDownloads: true });
  const profile = { id: USER.id, email: USER.email, full_name: 'Owner', avatar_url: null, role: 'super_admin', organization_id: null };
  const logs = [];

  await context.route('**/*', async (route) => {
    const req = route.request();
    const url = req.url();
    const method = req.method();
    const single = String(req.headers().accept || '').includes('pgrst.object');
    const answer = (rows) => json(route, single ? rows[0] ?? null : rows);
    const body = () => JSON.parse(req.postData() || '{}');
    const docById = (id) => state.docs.find((d) => d.id === id);

    if (url.includes('/api/portal-')) return json(route, { ok: false, error: 'mock' }, 503);
    if (url.startsWith(`http://127.0.0.1:${PORT}/`)) return route.continue();
    if (url.includes('/auth/v1/user')) return json(route, USER);
    if (url.includes('/auth/v1/')) return json(route, { access_token: 'mock', user: USER });
    if (url.includes('/rest/v1/rpc/is_owner')) return json(route, owner);

    // ---------------------------------------------------------- Storage
    if (url.startsWith(`${STORAGE}/`)) {
      state.documentRequests += 1;
      const u = new URL(url);
      const path = decodeURIComponent(u.pathname.replace(/^.*?\/project-documents\//, ''));
      if (!owner) return json(route, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' }, 400);
      if (method === 'POST' && u.pathname.includes('/object/upload/sign/')) {
        const doc = state.docs.find((d) => d.storage_path === path);
        if (!doc || doc.upload_state !== 'pending' || doc.trashed_at) {
          return json(route, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' }, 400);
        }
        state.signs_upload += 1;
        return json(route, { url: `/object/upload/sign/project-documents/${path}?token=upload-token-${doc.id}-${state.signs_upload}` });
      }
      if (method === 'PUT' && u.pathname.includes('/object/upload/sign/')) {
        const doc = state.docs.find((d) => d.storage_path === path);
        state.puts.push({ path, headers: req.headers(), token: u.searchParams.get('token') });
        if (doc && state.expireFirstPut.has(doc.name)) {
          state.expireFirstPut.delete(doc.name);
          return json(route, { statusCode: '400', error: 'InvalidJWT', message: 'jwt expired' }, 400);
        }
        if (doc && (state.failPut.has(doc.name) || state.dropOnce.has(doc.name))) {
          state.dropOnce.delete(doc.name);
          return route.abort('connectionreset');
        }
        if (state.objects.has(path)) return json(route, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' }, 400);
        await new Promise((r) => setTimeout(r, 150));
        state.objects.set(path, req.postDataBuffer() ?? Buffer.alloc(0));
        return json(route, { Key: `project-documents/${path}` });
      }
      if (method === 'POST' && u.pathname.includes('/object/sign/')) {
        state.signs.push(body());
        return json(route, { signedURL: `/object/sign/project-documents/${path}?token=download-token-secret` });
      }
      if (method === 'GET' && u.pathname.includes('/object/sign/')) {
        return route.fulfill({ status: 200, headers: { 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename="${u.searchParams.get('download') ?? 'file'}"` }, body: state.objects.get(path) ?? Buffer.alloc(0) });
      }
      if (method === 'GET' && u.pathname.includes('/object/project-documents/')) {
        const bytes = state.objects.get(path);
        return bytes ? route.fulfill({ status: 200, contentType: 'application/octet-stream', body: bytes })
          : json(route, { statusCode: '404', error: 'not_found', message: 'Object not found' }, 400);
      }
      return route.abort();
    }

    // ------------------------------------------------ document functions
    if (url.includes('/rest/v1/rpc/document_')) {
      state.documentRequests += 1;
      if (!owner) return json(route, { code: '42501', message: 'stratos:document_owner_only', hint: null, details: null }, 403);
      const b = body();
      const fn = url.match(/rpc\/(document_\w+)/)[1];
      if (fn === 'document_begin_upload') {
        state.begins.push(b);
        if (state.failBegin > 0) {
          state.failBegin -= 1;
          return json(route, { code: '08006', message: 'connection failure', hint: null, details: null }, 503);
        }
        if (!b.p_kind) return json(route, { code: 'P0001', message: 'stratos:document_type_not_allowed', hint: null, details: null }, 400);
        state.seq += 1;
        const id = `d${String(state.seq).padStart(3, '0')}`;
        const name = freeName(state, b.p_project, b.p_folder, b.p_name);
        const doc = { id, project_id: b.p_project, folder_id: b.p_folder, name, byte_size: b.p_size, declared_type: b.p_type, content_kind: b.p_kind,
          upload_state: 'pending', failure_reason: null, storage_path: `${b.p_project}/${id}`, created_at: now(),
          completed_at: null, trashed_at: null, trashed_with: null };
        state.docs.push(doc);
        return json(route, [{ id, name, storage_path: doc.storage_path }]);
      }
      if (fn === 'document_finish_upload') {
        if (state.failFinish > 0) {
          state.failFinish -= 1;
          return json(route, { code: '08006', message: 'connection failure', hint: null, details: null }, 503);
        }
        const d = docById(b.p_id);
        if (d.upload_state === 'ready') return json(route, 'ready');
        const obj = state.objects.get(d.storage_path);
        if (!obj) return json(route, 'missing');
        if (obj.length !== d.byte_size) { Object.assign(d, { upload_state: 'failed', failure_reason: 'size_mismatch' }); return json(route, 'failed'); }
        Object.assign(d, { upload_state: 'ready', failure_reason: null, completed_at: now() });
        return json(route, 'ready');
      }
      if (fn === 'document_move') {
        const d = docById(b.p_id);
        Object.assign(d, { folder_id: b.p_folder, name: freeName(state, d.project_id, b.p_folder, d.name, d.id) });
        return json(route, d.name);
      }
      if (fn === 'document_restore') {
        const d = docById(b.p_id);
        Object.assign(d, { trashed_at: null, trashed_with: null, name: freeName(state, d.project_id, d.folder_id, d.name, d.id) });
        return json(route, d.name);
      }
      if (fn === 'document_trash_folder') {
        const f = state.folders.find((x) => x.id === b.p_folder);
        f.trashed_at = now();
        for (const d of state.docs.filter((x) => x.folder_id === f.id && !x.trashed_at)) Object.assign(d, { trashed_at: now(), trashed_with: f.id });
        return json(route, 1);
      }
      if (fn === 'document_restore_folder') {
        const f = state.folders.find((x) => x.id === b.p_folder);
        f.trashed_at = null;
        for (const d of state.docs.filter((x) => x.trashed_with === f.id)) Object.assign(d, { trashed_at: null, trashed_with: null });
        return json(route, f.name);
      }
      if (fn === 'document_reconcile') return json(route, [{ finished: 0, expired: 0 }]);
      if (fn === 'document_storage_report') return json(route, []);
      return json(route, []);
    }
    if (url.includes('/rest/v1/rpc/')) return json(route, []);

    // ---------------------------------------------------- document tables
    if (url.includes('/rest/v1/document_folders')) {
      state.documentRequests += 1;
      if (!owner) return answer([]);
      if (method === 'POST') {
        const b = body();
        if (state.folders.some((f) => f.project_id === b.project_id && f.parent_id === b.parent_id && !f.trashed_at
          && f.name.toLowerCase() === b.name.toLowerCase())) {
          return json(route, { code: '23505', message: 'duplicate key value violates unique constraint "document_folders_sibling_name"', hint: null, details: null }, 409);
        }
        state.seq += 1;
        state.folders.push({ id: `f${state.seq}`, project_id: b.project_id, parent_id: b.parent_id, name: b.name, created_at: now(), trashed_at: null, trashed_with: null });
        return json(route, [], 201);
      }
      if (method === 'PATCH') { for (const r of applyFilters(url, state.folders)) Object.assign(r, body()); return json(route, []); }
      return answer(applyFilters(url, state.folders));
    }
    if (url.includes('/rest/v1/project_documents')) {
      state.documentRequests += 1;
      if (!owner) return answer([]);
      if (method === 'PATCH') {
        const patch = body();
        for (const r of applyFilters(url, state.docs)) {
          if (patch.name && state.docs.some((d) => d.id !== r.id && d.project_id === r.project_id && d.folder_id === r.folder_id
            && !d.trashed_at && d.name.toLowerCase() === patch.name.toLowerCase())) {
            return json(route, { code: '23505', message: 'duplicate key value violates unique constraint', hint: null, details: null }, 409);
          }
          Object.assign(r, patch);
          if (patch.upload_state && patch.upload_state !== 'failed') r.failure_reason = null;
        }
        return json(route, []);
      }
      const rows = applyFilters(url, state.docs).map((d) => ({
        ...d,
        project: (({ id, name }) => ({ id, name }))(state.projects.find((p) => p.id === d.project_id)),
        folder: d.folder_id ? (({ id, name }) => ({ id, name }))(state.folders.find((f) => f.id === d.folder_id)) : null,
      }));
      return answer(rows);
    }

    if (url.includes('/rest/v1/profiles')) return answer([profile]);
    if (url.includes('/rest/v1/projects')) return answer(owner ? applyFilters(url, state.projects) : []);
    if (url.includes('/rest/v1/project_milestones')) return answer(owner ? applyFilters(url, state.milestones) : []);
    if (url.includes('/rest/v1/client_contacts')) return answer(applyFilters(url, CONTACTS));
    if (url.includes('/rest/v1/')) return answer([]);
    return route.abort();
  });

  const page = await context.newPage();
  page.on('console', (m) => logs.push(m.text()));
  await page.addInitScript(([mockUrl, user]) => {
    const ref = new URL(mockUrl).hostname.split('.')[0];
    localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify({
      access_token: 'mock-access-token', refresh_token: 'mock-refresh-token', token_type: 'bearer',
      expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600,
      user: { ...user, aud: 'authenticated', role: 'authenticated' },
    }));
  }, [MOCK_URL, USER]);
  return { context, page, state, logs };
}

/* ----------------------------------------------------------- the checks */

const results = [];
async function check(name, fn) {
  try { await fn(); results.push({ name, ok: true }); console.log(`  ok   ${name}`); }
  catch (e) { results.push({ name, ok: false, error: e.message }); console.log(`  FAIL ${name}\n       ${e.message.split("\n").slice(0, 4).join("\n       ")}`); }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const file = (name, content, mimeType = 'application/octet-stream') => ({ name, mimeType, buffer: Buffer.isBuffer(content) ? content : Buffer.from(content) });
const docRow = (page, name) => page.locator('li[data-document]', { hasText: name });

const browser = await chromium.launch();

await check('a non-owner has no Documents navigation, is redirected, and sends no document request', async () => {
  const { page, context, state } = await open(browser, { owner: false });
  await page.goto(`${BASE}/`);
  await page.getByRole('link', { name: 'Dashboard' }).first().waitFor();
  assert(await page.getByRole('link', { name: 'Documents' }).count() === 0, 'Documents link shown to a non-owner');
  await page.goto(`${BASE}/documents/p-web`);
  await page.waitForTimeout(800);
  assert(!page.url().includes('/documents'), `not redirected: ${page.url()}`);
  await page.goto(`${BASE}/documents`);
  await page.waitForTimeout(800);
  assert(!page.url().includes('/documents'), `not redirected: ${page.url()}`);
  assert(state.documentRequests === 0, `${state.documentRequests} document requests sent for a non-owner`);
  await context.close();
});

await check('owner: every project is a folder — paid, Impact, and closed/archived ones on request', async () => {
  const { page, context } = await open(browser);
  await page.goto(`${BASE}/`);
  await page.getByRole('link', { name: 'Documents' }).first().click();
  await page.getByRole('link', { name: 'Rapidkert website' }).waitFor();
  assert(await page.getByRole('link', { name: 'Tanoda website' }).count() === 1, 'Impact project missing');
  assert(await page.getByRole('link', { name: 'Old brochure' }).count() === 0, 'archived project shown among open ones');
  await page.getByLabel('Show').selectOption('closed');
  await page.getByRole('link', { name: 'Old brochure' }).waitFor();
  await shot(page, 'index');
  await context.close();
});

await check('the project folder shows client, contacts, service, status, checkpoint, blocker and the recorded payment — no schedule', async () => {
  const { page, context } = await open(browser);
  await page.goto(`${BASE}/documents/p-web`);
  const facts = page.getByLabel('Project facts');
  await facts.getByText('Rapidkert website').waitFor();
  const text = (await page.locator('main').innerText());
  for (const s of ['Rapidkert Kft.', 'Kovács Anna', 'anna@example.invalid', '+36 30 111 2222', 'Szabó Péter', 'Weboldal',
    'Active', 'Content', '1/2 done', 'No copy yet', 'Chase the client', 'Partially paid', 'No payment schedule is kept']) {
    assert(text.includes(s), `missing: ${s}`);
  }
  assert(/1[\s ]500[\s ]000/.test(text) && /500[\s ]000/.test(text), 'contract value / paid amount not shown');
  assert(!/instal|due on|next payment/i.test(text), 'something schedule-like is shown');
  await page.goto(`${BASE}/documents/i-web`);
  await page.getByLabel('Impact value').waitFor();
  const impact = await page.getByLabel('Impact value').innerText();
  assert(/Free/.test(impact) && /800[\s ]000/.test(impact), `impact panel: ${impact}`);
  assert(await page.getByLabel('Payment').count() === 0, 'an Impact project shows a payment panel');
  await context.close();
});

await check('folders: create, open, breadcrumb; a duplicate sibling name is refused in words', async () => {
  const { page, context } = await open(browser);
  await page.goto(`${BASE}/documents/p-web`);
  await page.getByRole('button', { name: 'Folder', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill('Szerződések');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('list', { name: 'Folder contents' }).getByRole('button', { name: /^Szerződések/ }).click();
  await page.getByRole('navigation', { name: 'Folder path' }).getByText('Szerződések').waitFor();
  assert(page.url().includes('folder='), 'the folder is not in the URL');
  await page.getByRole('button', { name: 'Project files' }).click();
  await page.getByRole('button', { name: 'Folder', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill('szerződések');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByText('Something in this folder already has that name.').waitFor();
  await context.close();
});

await check('multi-file upload: per-file progress and outcome; one failure does not stop the others; retry finishes it', async () => {
  const { page, context, state, logs } = await open(browser);
  state.failPut.add('broken.pdf');
  state.dropOnce.add('flaky.txt');
  await page.goto(`${BASE}/documents/p-web`);
  await page.getByText('No documents yet.').waitFor();
  await page.locator('input[type=file]').setInputFiles([
    file('photo.png', PNG, 'image/png'), file('flaky.txt', 'hello\nworld\n', 'text/plain'), file('broken.pdf', '%PDF-1.4 x'),
  ]);
  const uploads = page.getByLabel('Uploads');
  await uploads.locator('[data-upload-phase="done"]', { hasText: 'photo.png' }).waitFor({ timeout: 15000 });
  await uploads.locator('[data-upload-phase="done"]', { hasText: 'flaky.txt' }).waitFor({ timeout: 15000 });   // auto-retried
  await uploads.locator('[data-upload-phase="failed"]', { hasText: 'broken.pdf' }).waitFor({ timeout: 20000 });
  assert(await uploads.getByText('The connection dropped during the upload.').count() === 1, 'no per-file error for broken.pdf');
  assert(state.docs.find((d) => d.name === 'broken.pdf').upload_state === 'failed', 'the failed upload is not recorded as failed');
  await docRow(page, 'photo.png').waitFor();
  await shot(page, 'upload-failed');

  state.failPut.delete('broken.pdf');
  await uploads.locator('[data-upload-phase="failed"]', { hasText: 'broken.pdf' }).getByRole('button', { name: 'Retry' }).click();
  await uploads.locator('[data-upload-phase="done"]', { hasText: 'broken.pdf' }).waitFor({ timeout: 15000 });
  assert(state.docs.filter((d) => d.name === 'broken.pdf').length === 1, 'the retry created a second row instead of reusing the first');

  for (const p of state.puts) {
    assert(p.headers['content-type'] === 'application/octet-stream', `PUT content-type ${p.headers['content-type']}`);
    assert(p.headers['x-upsert'] === 'false', `PUT x-upsert ${p.headers['x-upsert']}`);
    assert(/^[\w-]+\/d\d{3}$/.test(p.path), `object path is not <project>/<id>: ${p.path}`);
  }
  assert(!logs.some((l) => /token=|upload-token|download-token/.test(l)), `a signed URL reached the console: ${logs.find((l) => /token/.test(l))}`);
  await context.close();
});

await check('the same name twice is numbered by the server, never overwritten', async () => {
  const { page, context, state } = await open(browser);
  await page.goto(`${BASE}/documents/p-web`);
  await page.getByText('No documents yet.').waitFor();
  const done = page.getByLabel('Uploads').locator('[data-upload-phase="done"]');
  await page.locator('input[type=file]').setInputFiles([file('offer.pdf', '%PDF-1 a')]);
  await done.first().waitFor();
  await page.locator('input[type=file]').setInputFiles([file('offer.pdf', '%PDF-1 bb')]);
  await done.nth(1).waitFor();
  await docRow(page, 'offer (2).pdf').waitFor();
  assert(await done.nth(1).getByText('offer (2).pdf').count() === 1, 'the queue does not show the numbered name');
  assert(state.objects.size === 2, `${state.objects.size} stored objects`);
  await context.close();
});

await check('rename, move, trash and restore', async () => {
  const state = freshState();
  const { page, context } = await open(browser, { state });
  await page.goto(`${BASE}/documents/p-web`);
  await page.getByRole('button', { name: 'Folder', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill('Archive');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.locator('input[type=file]').setInputFiles([file('draft.txt', 'v1')]);
  await page.getByLabel('Uploads').locator('[data-upload-phase="done"]').waitFor();
  await docRow(page, 'draft.txt').waitFor();
  const path = state.docs[0].storage_path;

  await page.getByRole('button', { name: 'Rename draft.txt' }).click();
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill('final.txt');
  await page.getByRole('button', { name: 'Save' }).click();
  await docRow(page, 'final.txt').waitFor();

  await page.getByRole('button', { name: 'Move final.txt', exact: true }).click();
  await page.getByLabel('Folder', { exact: true }).selectOption({ label: 'Archive' });
  await page.getByRole('dialog').getByRole('button', { name: 'Move' }).click();
  await page.getByRole('list', { name: 'Folder contents' }).getByRole('button', { name: /^Archive/ }).click();
  await docRow(page, 'final.txt').waitFor();
  assert(state.docs[0].storage_path === path, 'rename or move changed the storage path');

  await page.getByRole('button', { name: 'Move final.txt to the trash' }).click();
  await page.getByText('This folder is empty.').waitFor();
  await page.getByRole('button', { name: 'Trash' }).click();
  await page.getByText('still occupies storage').waitFor();
  const trash = page.getByRole('list', { name: 'Trash' });
  await trash.getByText('final.txt').waitFor();
  await trash.getByRole('button', { name: 'Restore' }).click();
  await page.getByText('The trash is empty.').waitFor();
  assert(state.docs[0].trashed_at === null && state.objects.has(path), 'restore did not bring the file back');
  await shot(page, 'trash');
  await context.close();
});

await check('search finds a file name across projects and opens it in its folder', async () => {
  const state = freshState();
  state.folders.push({ id: 'f-x', project_id: 'i-web', parent_id: null, name: 'Brief', created_at: now(), trashed_at: null, trashed_with: null });
  state.docs.push({ id: 'd900', project_id: 'i-web', folder_id: 'f-x', name: 'Tanoda arculat_v2.pdf', byte_size: 10, declared_type: null,
    upload_state: 'ready', failure_reason: null, storage_path: 'i-web/d900', created_at: now(), completed_at: now(), trashed_at: null, trashed_with: null });
  state.objects.set('i-web/d900', Buffer.from('%PDF-1.4 hi'));
  const { page, context } = await open(browser, { state });
  await page.goto(`${BASE}/documents`);
  await page.getByLabel('Search file names').fill('arculat_');
  const hit = page.getByRole('list', { name: 'Files found' }).getByRole('link', { name: 'Tanoda arculat_v2.pdf' });
  await hit.waitFor();
  await hit.click();
  await page.waitForURL(/\/documents\/i-web\?folder=f-x&file=d900/);
  await docRow(page, 'Tanoda arculat_v2.pdf').waitFor();
  await context.close();
});

await check('preview shows sniffed-safe bytes only; download uses a one-minute attachment link', async () => {
  const fixture = (name) => readFileSync(join(ROOT, 'scripts', 'fixtures', name));
  const state = freshState();
  const add = (id, name, bytes) => {
    state.docs.push({ id, project_id: 'p-web', folder_id: null, name, byte_size: bytes.length, declared_type: null, upload_state: 'ready',
      failure_reason: null, storage_path: `p-web/${id}`, created_at: now(), completed_at: now(), trashed_at: null, trashed_with: null });
    state.objects.set(`p-web/${id}`, bytes);
  };
  add('d1', 'logo.png', PNG);
  add('d2', 'notes.txt', Buffer.from('Első sor\nsecond line'));
  add('d3', 'invoice.pdf', fixture('viewer-test.pdf'));
  add('d5', 'offer.docx', fixture('viewer-test.docx'));
  add('d6', 'prices.xlsx', fixture('viewer-test.xlsx'));
  add('d8', 'fake.png', Buffer.from('<html><script>alert(1)</script></html>'));
  add('d4', 'drawing.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'));
  const { page, context, logs } = await open(browser, { state });
  await page.goto(`${BASE}/documents/p-web`);

  await page.getByRole('button', { name: 'Preview logo.png' }).click();
  await page.getByRole('dialog').locator('img[src^="blob:"]').waitFor();
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).first().click();

  await page.getByRole('button', { name: 'Preview notes.txt' }).click();
  await page.getByRole('dialog').getByText('Első sor').waitFor();
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).first().click();

  await page.getByRole('button', { name: 'Preview fake.png' }).click();
  await page.getByRole('dialog').getByText('not shown inside the Portal').waitFor();
  assert(await page.getByRole('dialog').locator('iframe, img, object, embed').count() === 0, 'HTML bytes named .png were rendered');
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).first().click();
  assert(await page.getByRole('button', { name: 'Preview drawing.svg' }).count() === 0, 'SVG offered for preview');
  assert(await page.getByRole('button', { name: 'Download invoice.pdf' }).count() === 1, 'PDF cannot be downloaded');

  // PDF: drawn by PDF.js onto a canvas, in the Portal.
  await page.getByRole('button', { name: 'Preview invoice.pdf' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('[data-pdf-pages] canvas').first().waitFor({ timeout: 15000 });
  await dialog.getByText('1 pages').waitFor();
  const painted = await dialog.locator('[data-pdf-pages] canvas').first().evaluate((c) => {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let dark = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 128) dark += 1; return dark;
  });
  assert(painted > 100, 'the PDF page was not drawn');
  await shot(page, 'viewer-pdf');
  await dialog.getByRole('button', { name: 'Close' }).first().click();

  // .docx: rebuilt as text — the heading and table are there; the javascript: link is not a link; markup is text.
  await page.getByRole('button', { name: 'Preview offer.docx' }).click();
  const docx = page.locator('[data-docx]');
  await docx.locator('h1', { hasText: 'Árajánlat — weboldal' }).waitFor({ timeout: 15000 });
  assert(await docx.locator('td', { hasText: '450 000 Ft' }).count() === 1, 'the table was not shown');
  assert(await docx.locator('a, script, iframe, object, embed').count() === 0, 'an active element came through from the .docx');
  assert(await docx.getByText('veszélyes link').count() === 1, 'the link text is missing');
  assert(await docx.getByText('<script>alert(1)</script>').count() === 1, 'written markup was not shown as text');
  await shot(page, 'viewer-docx');
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).first().click();

  // .xlsx: values in a table, one tab per sheet.
  await page.getByRole('button', { name: 'Preview prices.xlsx' }).click();
  const xlsx = page.locator('[data-xlsx]');
  await xlsx.getByText('450000').waitFor({ timeout: 15000 });
  await page.getByRole('tab', { name: 'Második' }).click();
  await xlsx.getByText('SEO').waitFor();
  await shot(page, 'viewer-xlsx');
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).first().click();
  assert(await page.locator('iframe').count() === 0, 'an iframe exists on the page');

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download notes.txt' }).click();
  const d = await download;
  assert(d.suggestedFilename() === 'notes.txt', `download name ${d.suggestedFilename()}`);
  assert(state.signs.at(-1)?.expiresIn === 60, 'download link is not one minute');
  assert(state.signs.at(-1)?.expiresIn === 60, `signed URL lifetime ${state.signs.at(-1)?.expiresIn}`);
  assert(!logs.some((l) => /token=|download-token/.test(l)), 'a signed URL reached the console');
  await shot(page, 'preview');
  await context.close();
});

await check('the project screen shows the same files, from the same rows', async () => {
  const state = freshState();
  state.docs.push({ id: 'd5', project_id: 'p-web', folder_id: null, name: 'kickoff.pdf', byte_size: 3, declared_type: null, upload_state: 'ready',
    failure_reason: null, storage_path: 'p-web/d5', created_at: now(), completed_at: now(), trashed_at: null, trashed_with: null });
  const { page, context } = await open(browser, { state });
  await page.goto(`${BASE}/projects/p-web`);
  await docRow(page, 'kickoff.pdf').waitFor();
  await page.getByRole('link', { name: 'Open in Documents' }).click();
  await page.waitForURL(/\/documents\/p-web$/);
  await docRow(page, 'kickoff.pdf').waitFor();
  await context.close();
});

await check('an unfinished upload from an earlier session is labelled, not shown as a finished file', async () => {
  const state = freshState();
  state.docs.push({ id: 'd6', project_id: 'p-web', folder_id: null, name: 'half.zip', byte_size: 99, declared_type: null, upload_state: 'failed',
    failure_reason: 'network', storage_path: 'p-web/d6', created_at: now(), completed_at: null, trashed_at: null, trashed_with: null });
  const { page, context } = await open(browser, { state });
  await page.goto(`${BASE}/documents/p-web`);
  const row = docRow(page, 'half.zip');
  await row.getByText('Upload failed').waitFor();
  assert(await page.getByRole('button', { name: 'Download half.zip' }).count() === 0, 'an unfinished file offers a download');
  await context.close();
});

await check('a refused type fails on its own, before any request; the other files still upload', async () => {
  const { page, context, state } = await open(browser);
  await page.goto(`${BASE}/documents/p-web`);
  await page.getByText('No documents yet.').waitFor();
  await page.locator('input[type=file]').setInputFiles([
    file('setup.exe', 'MZ\x90\x00'), file('invoice.pdf', '<html><script>alert(1)</script></html>'), file('real.pdf', '%PDF-1.4 ok'),
  ]);
  const uploads = page.getByLabel('Uploads');
  await uploads.locator('[data-upload-phase="done"]', { hasText: 'real.pdf' }).waitFor();
  const exe = uploads.locator('[data-upload-phase="failed"]', { hasText: 'setup.exe' });
  const fake = uploads.locator('[data-upload-phase="failed"]', { hasText: 'invoice.pdf' });
  await exe.getByText('.exe files are not accepted.').waitFor();
  await fake.getByText('does not match .pdf').waitFor();
  assert(await exe.getByRole('button', { name: 'Retry' }).count() === 0, 'a refused type offers a pointless Retry');
  assert(state.begins.length === 1 && state.begins[0].p_name === 'real.pdf' && state.begins[0].p_kind === 'pdf',
    `begin calls: ${JSON.stringify(state.begins.map((b) => [b.p_name, b.p_kind]))}`);
  await context.close();
});

await check('a failed database save at the start is per-file and retryable, with no orphan row', async () => {
  const { page, context, state } = await open(browser);
  state.failBegin = 1;
  await page.goto(`${BASE}/documents/p-web`);
  await page.getByText('No documents yet.').waitFor();
  await page.locator('input[type=file]').setInputFiles([file('first.txt', 'a'), file('second.txt', 'b')]);
  const uploads = page.getByLabel('Uploads');
  const failed = uploads.locator('[data-upload-phase="failed"]');
  await failed.waitFor();
  await uploads.locator('[data-upload-phase="done"]').waitFor();
  assert(state.puts.length === 1, `${state.puts.length} PUTs: a file without a row was sent`);
  await failed.getByRole('button', { name: 'Retry' }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-upload-phase="done"]').length === 2);
  assert(state.docs.length === 2, `${state.docs.length} rows`);
  await context.close();
});

await check('a lost finish is retried by asking, not by sending the file again', async () => {
  const { page, context, state } = await open(browser);
  state.failFinish = 1;
  await page.goto(`${BASE}/documents/p-web`);
  await page.getByText('No documents yet.').waitFor();
  await page.locator('input[type=file]').setInputFiles([file('brief.txt', 'content')]);
  const uploads = page.getByLabel('Uploads');
  await uploads.getByText('could not be confirmed').waitFor();
  assert(state.puts.length === 1, 'no PUT before the failed finish');
  await uploads.getByRole('button', { name: 'Retry' }).click();
  await uploads.locator('[data-upload-phase="done"]').waitFor();
  assert(state.puts.length === 1, `the retry sent the file again (${state.puts.length} PUTs)`);
  assert(state.docs[0].upload_state === 'ready', 'not finished');
  await context.close();
});

await check('an expired upload link is replaced by a fresh one, never reused', async () => {
  const { page, context, state } = await open(browser);
  state.expireFirstPut.add('late.txt');
  await page.goto(`${BASE}/documents/p-web`);
  await page.getByText('No documents yet.').waitFor();
  await page.locator('input[type=file]').setInputFiles([file('late.txt', 'x')]);
  await page.getByLabel('Uploads').locator('[data-upload-phase="done"]').waitFor({ timeout: 15000 });
  const tokens = state.puts.map((p) => p.token);
  assert(tokens.length === 2 && tokens[0] !== tokens[1], `tokens: ${tokens.join(', ')}`);
  await context.close();
});

await check('keyboard only: pick files, open a folder, rename and move — the file input is not a stray tab stop', async () => {
  const state = freshState();
  state.folders.push({ id: 'f-k', project_id: 'p-web', parent_id: null, name: 'Contracts', created_at: now(), trashed_at: null, trashed_with: null });
  const { page, context } = await open(browser, { state });
  await page.goto(`${BASE}/documents/p-web`);
  const upload = page.getByRole('button', { name: 'Upload', exact: true });
  await upload.waitFor();
  assert(await page.locator('input[type=file]').getAttribute('tabindex') === '-1', 'the hidden file input is tabbable');
  await upload.focus();
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('Enter');
  await (await chooser).setFiles([file('kb.txt', 'typed')]);
  await docRow(page, 'kb.txt').waitFor();
  await page.getByLabel('Uploads').locator('[data-upload-phase="done"]').waitFor();

  await page.getByRole('button', { name: 'Rename kb.txt' }).focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('keyboard.txt');
  await page.keyboard.press('Enter');
  await docRow(page, 'keyboard.txt').waitFor();

  await page.getByRole('button', { name: 'Move keyboard.txt', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('dialog').getByLabel('Folder', { exact: true }).selectOption({ label: 'Contracts' });
  await page.getByRole('dialog').getByRole('button', { name: 'Move' }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('dialog').waitFor({ state: 'detached' });

  await page.getByRole('list', { name: 'Folder contents' }).getByRole('button', { name: /^Contracts/ }).focus();
  await page.keyboard.press('Enter');
  await docRow(page, 'keyboard.txt').waitFor();
  await context.close();
});

await check('on a phone every folder and file control is at least 40px, and the picker uploads', async () => {
  const state = freshState();
  state.folders.push({ id: 'f-p', project_id: 'p-web', parent_id: null, name: 'Photos', created_at: now(), trashed_at: null, trashed_with: null });
  const { page, context } = await open(browser, { state, viewport: { width: 390, height: 844 } });
  await page.goto(`${BASE}/documents/p-web`);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  await (await chooser).setFiles([file('phone.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]))]);
  await page.getByLabel('Uploads').locator('[data-upload-phase="done"]').waitFor();
  const small = await page.locator('section[aria-label="Documents"] button').evaluateAll((els) => els
    .filter((e) => e.offsetParent !== null)
    .map((e) => ({ name: e.getAttribute('aria-label') || e.textContent.trim(), ...e.getBoundingClientRect().toJSON() }))
    .filter((r) => r.height < 40 || r.width < 40)
    .filter((r) => !/^(Project files|Photos\d*)$/.test(r.name)));
  assert(small.length === 0, `too small: ${small.map((r) => `${r.name} ${Math.round(r.width)}x${Math.round(r.height)}`).join(', ')}`);
  await context.close();
});

await check('at phone width the folder, its actions and the facts fit without sideways scrolling', async () => {
  const state = freshState();
  state.folders.push({ id: 'f-m', project_id: 'p-web', parent_id: null, name: 'Szerződések és ajánlatok', created_at: now(), trashed_at: null, trashed_with: null });
  state.docs.push({ id: 'd7', project_id: 'p-web', folder_id: null, name: 'Rapidkert_arajanlat_vegleges_alairt_2026-09-27_v3.pdf', byte_size: 1234567,
    declared_type: null, upload_state: 'ready', failure_reason: null, storage_path: 'p-web/d7', created_at: now(), completed_at: now(), trashed_at: null, trashed_with: null });
  const { page, context } = await open(browser, { state, viewport: { width: 390, height: 844 } });
  await page.goto(`${BASE}/documents/p-web`);
  await docRow(page, 'Rapidkert_arajanlat').waitFor();
  await page.getByLabel('Project facts').waitFor();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert(overflow <= 0, `the page scrolls sideways by ${overflow}px`);
  await shot(page, 'mobile');
  await context.close();
});

await browser.close();
server.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} document checks passed`);
process.exit(failed.length ? 1 : 0);

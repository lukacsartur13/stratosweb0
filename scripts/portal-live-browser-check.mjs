// =============================================================================
// The Portal in a real browser against a REAL, LOCAL Supabase — no mock.
//
//     LIVE_SUPABASE_URL=http://127.0.0.1:54321 LIVE_SUPABASE_ANON_KEY=… \
//     LIVE_SUPABASE_SECRET_KEY=… LIVE_CONFIRM_LOCAL=yes \
//     OWNER_CREDENTIALS_FILE=<from scripts/local-supabase-release.mjs> \
//     node scripts/portal-live-browser-check.mjs
//
// Builds the Portal with the LOCAL URL and the LOCAL public key into a temp
// folder, serves it at http://127.0.0.1:4322/portal (the local Auth site URL)
// and answers POST /api/portal-invite with the real Netlify function handler,
// which talks to the real local GoTrue and PostgREST. Then, in Chromium:
//
//   owner signs in → invites a client from the client page (the link is shown
//   in the dialog: no e-mail) → records an instalment and a part payment →
//   uploads a document and shares it → the client opens the link in a fresh
//   browser, sets a password, sees the Hungarian portal with only its project,
//   downloads the shared file, hands in a file (Nyersanyag leadása), signs out
//   → the owner sees the handed-in file → at phone width nothing scrolls
//   sideways.
//
// LOCAL ONLY; refuses any other host. Test users only (@example.invalid).
// Passwords and links are never printed. Exit 0 = all passed.
// =============================================================================
import { chromium } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';

const ROOT = resolve(import.meta.dirname, '..');
const URL_ = process.env.LIVE_SUPABASE_URL ?? '';
const ANON = process.env.LIVE_SUPABASE_ANON_KEY ?? '';
const SERVER = process.env.LIVE_SUPABASE_SECRET_KEY ?? '';
const refuse = (why) => { console.error(`portal-live-browser-check: refusing to run — ${why}`); process.exit(2); };
let host = '';
try { host = new URL(URL_).hostname; } catch { refuse('LIVE_SUPABASE_URL is missing'); }
if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) refuse(`${host} is not local`);
if (process.env.LIVE_CONFIRM_LOCAL !== 'yes') refuse('set LIVE_CONFIRM_LOCAL=yes');
if (!ANON || !SERVER || !process.env.OWNER_CREDENTIALS_FILE) refuse('keys and OWNER_CREDENTIALS_FILE are required');

const PORT = 4322;
const ORIGIN = `http://127.0.0.1:${PORT}`;
Object.assign(process.env, { SUPABASE_URL: URL_, SUPABASE_SECRET_KEY: SERVER, SUPABASE_ANON_KEY: ANON, PORTAL_ORIGIN: ORIGIN });
const invite = (await import('../netlify/functions/portal-invite.mjs')).default;
const cred = JSON.parse(readFileSync(process.env.OWNER_CREDENTIALS_FILE, 'utf8'));
const admin = createClient(URL_, SERVER, { auth: { persistSession: false } });
const run = randomUUID().slice(0, 6);
const SHOTS = process.env.SHOTS || null;

// The local owner is the designated one again (the node live checks re-designate).
const d = await admin.rpc('portal_set_owner', { p_email: cred.owner.email });
if (d.error) refuse(`portal_set_owner: ${d.error.message}`);
const org = (await admin.from('organizations').insert({ name: `Böngésző Kft. ${run}`, slug: `bongeszo-${run}` }).select('id').single()).data.id;
const project = (await admin.from('projects').insert({ organization_id: org, name: `Webshop ${run}`, slug: `webshop-${run}`, status: 'active', value: 1000000, currency: 'HUF' }).select('id').single()).data.id;
await admin.from('client_contacts').insert({ organization_id: org, name: 'Fehér Gábor', email: `gabor-${run}@example.invalid`, is_primary: true });

console.log('building the Portal against the local Supabase…');
const BUNDLE = mkdtempSync(join(tmpdir(), 'stratos-live-'));
execFileSync('npx', ['vite', 'build', '--outDir', BUNDLE, '--emptyOutDir', '--logLevel', 'warn'], {
  cwd: join(ROOT, 'portal'), stdio: 'inherit', env: { ...process.env, VITE_SUPABASE_URL: URL_, VITE_SUPABASE_ANON_KEY: ANON },
});
// The production Content-Security-Policy from netlify.toml, with the hosted
// Supabase origin swapped for the local one (and no https upgrade on
// http://127.0.0.1). Any violation fails the run.
const toml = readFileSync(join(ROOT, 'netlify.toml'), 'utf8');
const CSP = /Content-Security-Policy = """([\s\S]*?)"""/.exec(toml)[1]
  .split('\n').map((l) => l.trim()).filter(Boolean).join(' ')
  .replace(/https:\/\/\*\.supabase\.co/g, URL_).replace(/wss:\/\/\*\.supabase\.co/g, URL_.replace('http', 'ws'))
  .replace(/\s*upgrade-insecure-requests/, '');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, ORIGIN).pathname);
  if (path === '/api/portal-invite') {
    const body = await new Promise((ok) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => ok(b)); });
    const r = await invite(new Request(`${ORIGIN}${path}`, { method: req.method, headers: req.headers, body: req.method === 'POST' ? body : undefined }));
    res.writeHead(r.status, Object.fromEntries(r.headers));
    return res.end(await r.text());
  }
  const p = path.replace(/^\/portal/, '');
  const file = join(BUNDLE, p === '/' || p === '' ? 'index.html' : p);
  const target = existsSync(file) && extname(file) ? file : join(BUNDLE, 'index.html');
  res.writeHead(200, { 'content-type': TYPES[extname(target)] || 'application/octet-stream',
    ...(extname(target) === '.html' ? { 'content-security-policy': CSP } : {}) });
  res.end(readFileSync(target));
});
await new Promise((ok) => server.listen(PORT, '127.0.0.1', ok));

const results = [];
async function check(name, fn) {
  try { const n = await fn(); results.push(true); console.log(`  ok   ${name}${n ? ` — ${n}` : ''}`); }
  catch (e) {
    results.push(false); console.log(`  FAIL ${name}\n       ${String(e.message).split('\n')[0]}`);
    if (SHOTS) for (const [i, p] of openPages.entries()) await p.screenshot({ path: join(SHOTS, `LIVE-FAIL-${results.length}-${i}.png`), fullPage: true }).catch(() => {});
  }
}
const openPages = [];
const assert = (c, m) => { if (!c) throw new Error(m); };
const browser = await chromium.launch();
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, `LIVE-${name}.png`), fullPage: true }); };
const offLocal = [];
async function context(viewport = { width: 1280, height: 900 }) {
  const c = await browser.newContext({ viewport, locale: 'hu-HU', timezoneId: 'Europe/Budapest', acceptDownloads: true });
  // Nothing may leave this machine.
  await c.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (['127.0.0.1', 'localhost'].includes(u.hostname) || u.protocol === 'data:' || u.protocol === 'blob:') return route.continue();
    offLocal.push(u.hostname);
    return route.abort();
  });
  c.on('console', (m) => { if (/Content Security Policy|Refused to (connect|load|execute)/i.test(m.text())) cspViolations.push(m.text().slice(0, 160)); });
  return c;
}
const cspViolations = [];

const ownerCtx = await context();
const owner = await ownerCtx.newPage();
openPages.push(owner);
const clientEmail = `feher-${run}@example.invalid`;
let link = '';

await check('owner signs in with real GoTrue and sees the owner navigation', async () => {
  await owner.goto(`${ORIGIN}/portal/login`);
  await owner.fill('#email', cred.owner.email);
  await owner.fill('#password', cred.owner.password);
  await owner.getByRole('button', { name: 'Sign in' }).click();
  for (const name of ['Projects', 'Impact', 'Documents']) await owner.getByRole('link', { name }).first().waitFor();
});

// Every screen the owner has, visited on the real API: any 4xx/5xx from
// PostgREST, Storage or Auth is a query the mock could not catch.
const apiFailures = [];
owner.on('response', (r) => {
  const u = new URL(r.url());
  if (u.port === new URL(URL_).port && r.status() >= 400) apiFailures.push(`${r.status()} ${r.request().method()} ${u.pathname}${u.search.slice(0, 160)}`);
});
await check('every owner screen reads the real API without an error', async () => {
  const routes = ['/', '/leads', '/sales', '/sales?view=table', '/sales?view=followups', '/sales?view=performance', '/clients',
    `/clients/${org}`, '/projects', '/projects?view=closed', `/projects/${project}`, '/projects/templates', '/impact', '/impact?view=closed',
    '/documents', '/activity', '/users', '/system', '/settings', '/case-studies'];
  for (const r of routes) {
    await owner.goto(`${ORIGIN}/portal${r}`);
    await owner.waitForLoadState('networkidle');
  }
  const unique = [...new Set(apiFailures)];
  assert(unique.length === 0, unique.join(' | '));
  return `${routes.length} screens`;
});

await check('invite from the client page through the real function; the link is shown, not e-mailed', async () => {
  await owner.goto(`${ORIGIN}/portal/clients/${org}`);
  const panel = owner.getByRole('region', { name: 'Client accounts' });
  await panel.getByRole('button', { name: 'Invite' }).click();
  await owner.fill('#invite-name', 'Fehér Gábor');
  await owner.fill('#invite-email', clientEmail);
  await owner.getByRole('checkbox', { name: `Webshop ${run}` }).check();
  await owner.getByRole('dialog').getByRole('button', { name: 'Invite' }).click();
  await owner.locator('#invite-link').waitFor();
  link = await owner.locator('#invite-link').inputValue();
  assert(link.startsWith(`${ORIGIN}/portal/accept-invite#token_hash=`), 'the link is not a fragment link to this origin');
  await owner.getByRole('button', { name: 'Done' }).click();
  await panel.locator(`[data-account="${clientEmail}"]`).waitFor();
});

await check('owner records an instalment and a part payment on the real database', async () => {
  await owner.goto(`${ORIGIN}/portal/projects/${project}`);
  const panel = owner.getByRole('region', { name: 'Payment schedule' });
  await panel.getByText('No instalments yet', { exact: false }).waitFor();
  await panel.getByRole('button', { name: 'Instalment' }).click();
  await owner.fill('#pi-label', 'Előleg');
  await owner.fill('#pi-amount', '1 000 000');
  await owner.fill('#pi-due', new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10));
  await owner.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await panel.getByText('Előleg').waitFor();
  await panel.getByRole('button', { name: 'Payment', exact: true }).click();
  await owner.fill('#pp-amount', '400 000');
  await owner.fill('#pp-date', new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Budapest' }).format(new Date()));
  await owner.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await owner.getByRole('dialog').waitFor({ state: 'detached' });
  await owner.waitForFunction(() => document.querySelector('[data-figure="paid"]')?.textContent?.replace(/\s/g, '').includes('400000'));
  const overdue = (await panel.locator('[data-figure="overdue"]').textContent())?.replace(/\s/g, '');
  const state = (await admin.from('projects').select('payment_state, paid_amount').eq('id', project).single()).data;
  assert(overdue?.includes('600000'), `overdue ${overdue}`);
  assert(state.payment_state === 'partially_paid' && Number(state.paid_amount) === 400000, JSON.stringify(state));
  await shot(owner, 'owner-payments');
});

await check('owner uploads a PDF into real Storage and shares it with the invited account', async () => {
  const lib = owner.getByRole('region', { name: 'Documents' });
  await lib.getByLabel('Upload files').setInputFiles({ name: 'Ajánlat.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n% live\n') });
  await lib.getByText('Ajánlat.pdf').first().waitFor();
  await owner.waitForFunction(() => !document.querySelector('[aria-label="Uploads"] [role="progressbar"]'), null, { timeout: 20000 }).catch(() => {});
  await lib.getByRole('button', { name: 'Share Ajánlat.pdf' }).click();
  await owner.getByRole('dialog').getByRole('button', { name: 'Share' }).click();
  await owner.getByRole('dialog').getByRole('button', { name: 'Stop sharing' }).waitFor();
  await owner.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
  const doc = (await admin.from('project_documents').select('upload_state').eq('project_id', project).eq('name', 'Ajánlat.pdf').single()).data;
  assert(doc.upload_state === 'ready', `document ${doc.upload_state}`);
});

await check('owner adds a published demo link and a meeting from the project page', async () => {
  await owner.goto(`${ORIGIN}/portal/projects/${project}`);
  const panel = owner.getByRole('region', { name: 'Client portal view' });
  await panel.getByRole('button', { name: 'Demo link' }).click();
  await owner.fill('#demo-title', 'Weboldal demó');
  await owner.fill('#demo-url', 'https://demo.example.com/webshop');
  await owner.getByLabel('Visible to the client').check();
  await owner.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await panel.getByText('Visible to the client').waitFor();
  await panel.getByRole('button', { name: 'Meeting', exact: true }).click();
  const d = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Budapest' }).format(new Date(Date.now() + 2 * 864e5));
  await owner.fill('#mt-title', 'Demó átbeszélése');
  await owner.fill('#mt-date', d);
  await owner.fill('#mt-start', '10:00');
  await owner.fill('#mt-end', '11:00');
  await owner.fill('#mt-join', 'https://meet.example.com/abc');
  await owner.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await panel.getByText('Demó átbeszélése').waitFor();
});

const clientCtx = await context();
const client = await clientCtx.newPage();
openPages.push(client);
const clientPassword = randomBytes(12).toString('base64url') + 'Aa1';

await check('the client opens the link, the fragment is removed, a password is set', async () => {
  await client.goto(link);
  await client.locator('#new-password').waitFor();
  assert(!client.url().includes('token_hash'), 'the token is still in the address bar');
  await client.fill('#new-password', clientPassword);
  await client.fill('#confirm-password', clientPassword);
  await client.getByRole('button', { name: 'Jelszó mentése' }).click();
  await client.getByRole('navigation', { name: 'Ügyfélportál' }).waitFor();
});

await check('the Hungarian client portal shows only its project and no internal figure', async () => {
  await client.getByText(`Webshop ${run}`).first().waitFor();
  const text = await client.locator('main').innerText();
  assert(!/1\s?000\s?000|400\s?000|Előleg|Payment|Checkpoint|Blocked|market/i.test(text), 'an internal figure is on the client screen');
  assert((await client.locator('html').getAttribute('lang')) === 'hu' || (await client.locator('[lang="hu"]').count()) > 0, 'not marked Hungarian');
  await shot(client, 'client-projects');
});

await check('the client sees the demo card (new tab) and the next meeting with a Google Calendar link', async () => {
  const card = client.locator('[data-client-demo]').first();
  await card.waitFor();
  const link = card.getByRole('link', { name: /Demó megtekintése/ });
  assert(await link.getAttribute('href') === 'https://demo.example.com/webshop' && await link.getAttribute('target') === '_blank', 'demo link');
  const meeting = client.locator('[data-client-meeting][data-highlight="true"]');
  await meeting.waitFor();
  const cal = new URL(await meeting.getByRole('link', { name: /Google Naptárba helyezés/ }).getAttribute('href'));
  assert(cal.searchParams.get('text') === 'Demó átbeszélése' && cal.searchParams.get('ctz') === 'Europe/Budapest', cal.toString());
  assert(/T080000Z\/\d{8}T090000Z$/.test(cal.searchParams.get('dates')) || /T090000Z\/\d{8}T100000Z$/.test(cal.searchParams.get('dates')), `dates ${cal.searchParams.get('dates')}`);
});

await check('Segítség answers from the real, published knowledge base — by keyboard', async () => {
  await client.getByRole('link', { name: 'Segítség' }).click();
  const input = client.getByLabel('Kérdésed');
  await input.waitFor();
  await input.focus();
  await client.keyboard.type('mekkora fájlokat tölthetek fel');
  await client.keyboard.press('Enter');
  await client.locator('[data-reply="answer"]').last().getByText('50 MB', { exact: false }).waitFor();
  await input.fill('szeretnék pizzát rendelni');
  await client.keyboard.press('Enter');
  await client.locator('[data-reply="unknown"]').last().waitFor();
  await client.getByRole('link', { name: 'Projektjeim' }).click();
});

await check('the client downloads the shared file through a signed link', async () => {
  await client.getByRole('link', { name: 'Megosztott dokumentumok' }).click();
  const [download] = await Promise.all([
    client.waitForEvent('download'),
    client.getByRole('button', { name: 'Ajánlat.pdf letöltése' }).click(),
  ]);
  const path = await download.path();
  assert(readFileSync(path, 'utf8') === '%PDF-1.4\n% live\n', 'wrong bytes');
  assert(download.suggestedFilename() === 'Ajánlat.pdf', `saved as ${download.suggestedFilename()}`);
  return `saved as ${download.suggestedFilename()}`;
});

await check('the client hands in a file (Nyersanyag leadása) and sees it under its own uploads', async () => {
  await client.getByRole('link', { name: 'Nyersanyag leadása' }).click();
  await client.getByLabel('Fájlok kiválasztása').setInputFiles({ name: 'logo.png', mimeType: 'image/png',
    buffer: Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6300010000050001', 'hex') });
  await client.getByRole('list', { name: 'Leadott fájlok' }).getByText('logo.png').waitFor({ timeout: 20000 });
  let row;
  for (let i = 0; i < 40; i += 1) {
    row = (await admin.from('project_documents').select('upload_state, client_account_id').eq('project_id', project).eq('name', 'logo.png').single()).data;
    if (row?.upload_state !== 'pending') break;
    await new Promise((r) => setTimeout(r, 500));
  }
  assert(row.upload_state === 'ready' && row.client_account_id, JSON.stringify(row));
});

await check('a refused file type is refused on the client screen before any request', async () => {
  await client.getByLabel('Fájlok kiválasztása').setInputFiles({ name: 'setup.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('MZ\x90\x00') });
  await client.getByText('setup.exe').first().waitFor();
  const n = (await admin.from('project_documents').select('id', { count: 'exact', head: true }).eq('name', 'setup.exe')).count;
  assert(n === 0, 'a row was created for .exe');
});

await check('phone width: the client portal does not scroll sideways', async () => {
  await client.setViewportSize({ width: 390, height: 844 });
  for (const tab of ['Projektjeim', 'Megosztott dokumentumok', 'Nyersanyag leadása', 'Segítség']) {
    await client.getByRole('link', { name: tab }).click();
    assert(await client.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${tab} scrolls sideways`);
  }
  await shot(client, 'client-phone');
});

await check('the client signs out and is back at the sign-in page; the portal is closed to it', async () => {
  await client.getByRole('button', { name: 'Kijelentkezés' }).click();
  await client.waitForURL(/\/portal\/login/);
  await client.goto(`${ORIGIN}/portal/`);
  await client.waitForURL(/\/portal\/login/);
});

await check('the owner sees the handed-in file in the project library', async () => {
  await owner.goto(`${ORIGIN}/portal/projects/${project}`);
  await owner.getByRole('region', { name: 'Documents' }).getByText('Ügyféltől érkezett nyersanyagok', { exact: false }).first().waitFor();
});

await check('the production CSP (local origin) was never violated', async () => { assert(cspViolations.length === 0, cspViolations.join(' | ')); });

await check('no request left this machine', async () => { assert(offLocal.length === 0, `off-machine requests: ${[...new Set(offLocal)]}`); });

await browser.close();
server.close();
rmSync(BUNDLE, { recursive: true, force: true });
console.log(`\n${results.filter(Boolean).length}/${results.length} live browser checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);

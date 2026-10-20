// =============================================================================
// Jarvis panel (phase 4) — rendered checks against MOCK data.
//
//     node scripts/portal-jarvis-check.mjs          (SHOTS=<dir> also saves screenshots)
//
// MOCK ONLY: a throwaway Portal bundle with placeholder credentials, every
// request intercepted: a small fake of GoTrue and PostgREST, and /api/jarvis
// answering with scripted server-sent events in the shape
// netlify/functions/jarvis.mjs sends. Nothing reaches a real service.
//
// It proves what the browser does: who sees Jarvis; Cmd/Ctrl+J and Escape;
// the panel's chunk loads only when it is first opened; what a message sends
// (the route, the record, the person's token); the streamed answer, drawn as
// elements and never as HTML; tool rows with their parameters; `continue`
// followed on its own; errors with "send again" and "continue"; stored
// conversations read back; the conversation surviving a move to another
// screen; the phone layout; contrast in both themes. The function itself is
// tests/jarvis.spec.ts; the database tests/portal-jarvis-db.spec.ts.
// =============================================================================
import { chromium } from '@playwright/test';
import { lowContrast } from './lib-contrast.mjs';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const BUNDLE = mkdtempSync(join(tmpdir(), 'stratos-jarvis-'));
const PORT = Number(process.env.PORT) || 4431;
const MOCK_URL = 'https://mock.supabase.invalid';

console.log('building the mock portal bundle…');
execFileSync('npx', ['vite', 'build', '--outDir', BUNDLE, '--emptyOutDir', '--logLevel', 'error'], {
  cwd: join(ROOT, 'portal'), stdio: 'inherit',
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
const SHOTS = process.env.SHOTS || null;
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, `JARVIS-${name}.png`), fullPage: false }); };

const LEAD = '00000000-0000-4000-8000-000000000401';
const THREAD = '00000000-0000-4000-8000-000000000501';
const OWNER = { id: '00000000-0000-4000-8000-000000000001', email: 'owner@example.invalid' };
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const sse = (events) => events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('');

/** What /api/jarvis answers, in order: { events: [[name, data], …] } or { status, body }. */
const answer = (text, extra = []) => ({ events: [
  ['thread', { id: THREAD, title: 'Kérdés', model: 'claude-sonnet-5-5', over_budget: false }],
  ['step', { n: 1 }], ...extra, ['text', { delta: text }], ['done', { stop_reason: 'end_turn', model: 'claude-sonnet-5-5', usage: {} }],
] });

function freshState(over = {}) {
  return {
    replies: [], jarvis: [], requests: [], chunks: [],
    threads: [{ id: THREAD, title: 'Hol tart a pipeline?', updated_at: '2026-10-20T07:30:00Z', context_entity_type: null }],
    messages: [
      { id: 'm1', role: 'user', model: null, content: [{ type: 'text', text: '[Portál-kontextus — a Portál írta, nem a felhasználó]\nMost: …' }, { type: 'text', text: 'Hol tart a pipeline?' }] },
      { id: 'm2', role: 'assistant', model: 'claude-sonnet-5-5', content: [{ type: 'thinking', thinking: '', signature: 's' }, { type: 'tool_use', id: 'tu1', name: 'pipeline_summary', input: {} }, { type: 'tool_use', id: 'tu2', name: 'list_leads', input: { status: 'new' } }] },
      { id: 'm3', role: 'tool', model: null, content: [{ type: 'tool_result', tool_use_id: 'tu1', content: '{}' }, { type: 'tool_result', tool_use_id: 'tu2', content: '{"error":"x"}', is_error: true }] },
      { id: 'm4', role: 'assistant', model: 'claude-sonnet-5-5', content: [{ type: 'text', text: 'Három deal van **ajánlati** szakaszban.' }] },
    ],
    ...over,
  };
}

async function open(browser, { role = 'super_admin', owner = true, state = freshState(), viewport = { width: 1440, height: 900 }, colorScheme = 'dark' } = {}) {
  const context = await browser.newContext({ viewport, locale: 'hu-HU', colorScheme });
  const profile = { id: OWNER.id, email: OWNER.email, full_name: 'Lukács Artúr', avatar_url: null, role, organization_id: null, locale: null };

  await context.route('**/*', async (route) => {
    const req = route.request();
    const url = req.url();
    const method = req.method();
    if (url.startsWith(MOCK_URL)) state.requests.push(`${method} ${new URL(url).pathname}`);
    if (/\/assets\/JarvisPanel-[^/]+\.js$/.test(url)) state.chunks.push(url);

    if (url.includes('/api/jarvis')) {
      state.jarvis.push({ body: JSON.parse(req.postData() || '{}'), auth: req.headers().authorization ?? null });
      const next = state.replies.shift() ?? answer('Rendben.');
      if (next.status) return json(route, next.body, next.status);
      return route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8' }, body: sse(next.events) });
    }
    if (url.includes('/api/')) return json(route, { ok: false }, 503);
    if (url.startsWith(`http://127.0.0.1:${PORT}/`)) return route.continue();

    if (url.includes('/auth/v1/user')) return json(route, OWNER);
    if (url.includes('/auth/v1/')) return json(route, { access_token: 'mock', user: OWNER });
    if (url.includes('/rest/v1/rpc/is_owner')) return json(route, owner);
    if (url.includes('/rest/v1/profiles')) return json(route, profile);
    if (url.includes('/rest/v1/jarvis_threads')) return json(route, state.threads);
    if (url.includes('/rest/v1/jarvis_messages')) return json(route, state.messages);
    if (url.includes('/rest/v1/')) return json(route, []);
    return route.abort();
  });

  const page = await context.newPage();
  const logs = [];
  // Script errors only: the mock answers the other /api/* functions 503 on purpose.
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) logs.push(m.text()); });
  page.on('pageerror', (e) => logs.push(String(e)));
  await page.addInitScript(([mockUrl, u]) => {
    const ref = new URL(mockUrl).hostname.split('.')[0];
    localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify({
      access_token: 'mock-access-token', refresh_token: 'mock-refresh-token', token_type: 'bearer',
      expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user: { ...u, aud: 'authenticated', role: 'authenticated' },
    }));
  }, [MOCK_URL, OWNER]);
  return { context, page, state, logs };
}

const results = [];
async function check(name, fn) {
  try { await fn(); results.push({ name, ok: true }); console.log(`  ok   ${name}`); }
  catch (e) { results.push({ name, ok: false }); console.log(`  FAIL ${name}\n       ${e.message.split('\n').slice(0, 3).join('\n       ')}`); }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const panel = (page) => page.locator('[data-jarvis-panel]');
const focusedInput = (page) => page.waitForFunction(() => document.activeElement?.id === 'jarvis-input', null, { timeout: 5000 });
/** The shell first (the shortcut is registered by it), then Ctrl+J, then the panel with the cursor in it. */
async function openJarvis(page) {
  await page.locator('[data-jarvis-open]:visible').waitFor();
  await page.keyboard.press('Control+j');
  await panel(page).waitFor();
  await focusedInput(page);
}
const browser = await chromium.launch();

await check('Ctrl+J opens Jarvis from any screen, its chunk loads only then, Escape closes it and focus goes back', async () => {
  const { page, context, state, logs } = await open(browser);
  await page.goto(`${BASE}/leads/${LEAD}`);
  const button = page.locator('[data-jarvis-open]:visible');
  await button.waitFor();
  assert(state.chunks.length === 0, 'the Jarvis chunk loaded before the panel was opened');
  assert(await panel(page).count() === 0, 'the panel is in the page before it was opened');
  await page.keyboard.press('Control+j');
  await panel(page).waitFor();
  assert(state.chunks.length === 1, 'the Jarvis chunk did not load on open');
  await focusedInput(page).catch(() => { throw new Error('the question field does not have the focus'); });
  await page.locator('[data-jarvis-context]').getByText('Lead').waitFor();
  assert(await button.getAttribute('aria-expanded') === 'true', 'the button does not say the panel is open');
  await shot(page, 'empty');
  await page.keyboard.press('Escape');
  await panel(page).waitFor({ state: 'hidden' });
  await button.click();
  await panel(page).waitFor();
  await focusedInput(page);
  await page.keyboard.press('Escape');
  await panel(page).waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.activeElement?.hasAttribute('data-jarvis-open'), null, { timeout: 3000 })
    .catch(() => { throw new Error('focus did not go back to the Jarvis button'); });
  await page.keyboard.press('Meta+j');
  await panel(page).waitFor();
  assert(logs.length === 0, `console errors: ${logs.join(' | ')}`);
  await context.close();
});

await check('a question sends the route, the record and the person\'s token; the answer streams in as elements, tools as rows', async () => {
  const state = freshState();
  state.replies.push({ events: [
    ['thread', { id: THREAD, title: 'Erről mit tudunk?', model: 'claude-sonnet-5-5', over_budget: false }],
    ['step', { n: 1 }],
    ['tool', { id: 'tu1', name: 'get_record', status: 'running', input: { entity_type: 'lead', id: LEAD } }],
    ['tool', { id: 'tu1', name: 'get_record', status: 'done', label: 'Rekord megnyitva · Kiss Péter' }],
    ['tool', { id: 'tu2', name: 'email_search', status: 'error', input: { lead_id: LEAD }, label: 'email_search: adatbázis-hiba' }],
    ['step', { n: 2 }],
    ['text', { delta: '**Kiss Péter** új lead.\n\n- Még nem kerestük\n- Weboldalt kér\n\n' }],
    ['text', { delta: '<img src=x onerror="window.__pwned=1"> https://evil.example/login' }],
    ['done', { stop_reason: 'end_turn', model: 'claude-sonnet-5-5', usage: {} }],
  ] });
  const { page, context } = await open(browser, { state });
  await page.goto(`${BASE}/leads/${LEAD}`);
  await openJarvis(page);
  await page.locator('#jarvis-input').fill('Erről mit tudunk?');
  await page.keyboard.press('Enter');
  const log = page.locator('[data-jarvis-log]');
  await log.getByText('Kiss Péter', { exact: true }).waitFor();
  const [sent] = state.jarvis;
  assert(sent.auth === 'Bearer mock-access-token', `token: ${sent.auth}`);
  assert(sent.body.message === 'Erről mit tudunk?' && !sent.body.thread_id, `body: ${JSON.stringify(sent.body)}`);
  assert(JSON.stringify(sent.body.context) === JSON.stringify({ route: `/portal/leads/${LEAD}`, entity_type: 'lead', entity_id: LEAD }), `context: ${JSON.stringify(sent.body.context)}`);
  assert(await log.locator('strong', { hasText: 'Kiss Péter' }).count() === 1, 'bold was not drawn');
  assert(await log.locator('ul > li', { hasText: 'Weboldalt kér' }).count() === 1, 'the list was not drawn');
  assert(await log.locator('img, a').count() === 0, 'an answer produced an image or a link');
  assert(await page.evaluate(() => window.__pwned) === undefined, 'markup in an answer ran');
  await log.getByText('<img src=x onerror="window.__pwned=1"> https://evil.example/login').waitFor();
  const done = log.locator('[data-jarvis-tool="done"]');
  await done.getByText('Rekord megnyitva · Kiss Péter').waitFor();
  await done.locator('summary').click();
  await done.getByText('entity_type: lead').waitFor();
  await log.locator('[data-jarvis-tool="error"]').getByText('email_search: adatbázis-hiba').waitFor();
  await page.getByRole('button', { name: 'Send', exact: true }).waitFor();
  // At 1440px the page moves aside: nothing of it is under the panel.
  const main = await page.locator('#portal-main').boundingBox();
  const side = await panel(page).boundingBox();
  assert(main && side && main.x + main.width <= side.x + 1, `the page is under the panel (${JSON.stringify({ main, side })})`);

  // The next question goes into the same conversation.
  state.replies.push(answer('Igen.'));
  await page.locator('#jarvis-input').fill('És a dealje?');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await log.getByText('Igen.').waitFor();
  assert(state.jarvis[1].body.thread_id === THREAD, 'the second question started a new conversation');
  await shot(page, 'answer');
  await context.close();
});

await check('`continue` is followed on its own: one answer on screen, two requests', async () => {
  const state = freshState();
  state.replies.push({ events: [
    ['thread', { id: THREAD, title: 'x', model: 'claude-sonnet-5-5', over_budget: false }],
    ['step', { n: 1 }],
    ['tool', { id: 'tu1', name: 'open_alerts', status: 'running', input: {} }],
    ['tool', { id: 'tu1', name: 'open_alerts', status: 'done', label: 'Nyitott figyelmeztetések · 0' }],
    ['continue', {}],
  ] });
  state.replies.push({ events: [
    ['thread', { id: THREAD, title: 'x', model: 'claude-sonnet-5-5', over_budget: false }],
    ['step', { n: 1 }], ['text', { delta: 'Nincs nyitott figyelmeztetés.' }],
    ['done', { stop_reason: 'end_turn', model: 'claude-sonnet-5-5', usage: {} }],
  ] });
  const { page, context } = await open(browser, { state });
  await page.goto(`${BASE}/`);
  await openJarvis(page);
  await page.getByRole('button', { name: 'What needs my attention today?' }).click();
  await page.locator('[data-jarvis-log]').getByText('Nincs nyitott figyelmeztetés.').waitFor();
  assert(state.jarvis.length === 2, `${state.jarvis.length} requests`);
  assert(JSON.stringify(state.jarvis[1].body) === JSON.stringify({ thread_id: THREAD, continue: true }), `second: ${JSON.stringify(state.jarvis[1].body)}`);
  assert(await page.locator('[data-jarvis-turn="assistant"]').count() === 1, 'the continuation became a second answer');
  assert(await page.locator('[data-jarvis-notice]').count() === 0, 'a notice appeared');
  await context.close();
});

await check('errors: refused before anything was stored → "send again"; cut off after → "continue"; the budget notice', async () => {
  const state = freshState();
  state.replies.push({ status: 429, body: { ok: false, code: 'RATE_LIMIT' } });
  state.replies.push(answer('Most már megy.'));
  const { page, context } = await open(browser, { state });
  await page.goto(`${BASE}/`);
  await openJarvis(page);
  await page.locator('#jarvis-input').fill('Szia');
  await page.keyboard.press('Enter');
  await page.locator('[data-jarvis-notice="danger"]').getByText('Too many messages in a minute').waitFor();
  await page.locator('[data-jarvis-retry]').getByText('Send again').click();
  await page.locator('[data-jarvis-log]').getByText('Most már megy.').waitFor();
  assert(await page.locator('[data-jarvis-turn="user"]').count() === 1, 'the question shows twice');
  assert(await page.locator('[data-jarvis-notice]').count() === 0, 'the old error stayed');

  state.replies.push({ events: [['thread', { id: THREAD, title: 'x', model: 'claude-sonnet-5-5', over_budget: false }], ['step', { n: 1 }], ['error', { code: 'API_OVERLOADED' }]] });
  state.replies.push({ events: [
    ['thread', { id: THREAD, title: 'x', model: 'claude-haiku-5-5', over_budget: true }],
    ['notice', { code: 'BUDGET', text: 'A mai tokenkeret elfogyott: ma a kisebb modell (Haiku) válaszol.' }],
    ['step', { n: 1 }], ['text', { delta: 'Folytatom.' }], ['done', { stop_reason: 'end_turn', model: 'claude-haiku-5-5', usage: {} }],
  ] });
  await page.locator('#jarvis-input').fill('És most?');
  await page.keyboard.press('Enter');
  await page.locator('[data-jarvis-notice="danger"]').getByText('Claude is busy right now').waitFor();
  await page.locator('[data-jarvis-retry]').getByText('Continue').click();
  await page.locator('[data-jarvis-log]').getByText('Folytatom.').waitFor();
  assert(JSON.stringify(state.jarvis.at(-1).body) === JSON.stringify({ thread_id: THREAD, continue: true }), 'continue did not resume the stored conversation');
  await page.locator('[data-jarvis-notice="warn"]').getByText('A mai tokenkeret elfogyott').waitFor();
  await shot(page, 'errors');
  await context.close();
});

await check('History: stored conversations read back — no context block, tool rows from the stored calls', async () => {
  const { page, context, state } = await open(browser);
  await page.goto(`${BASE}/`);
  await openJarvis(page);
  await page.getByRole('button', { name: 'Conversations' }).click();
  await page.locator('[data-jarvis-threads]').getByText('Hol tart a pipeline?').click();
  const log = page.locator('[data-jarvis-log]');
  await log.getByText('ajánlati').waitFor();
  assert(await log.getByText('Portál-kontextus').count() === 0, 'the context block is shown');
  await log.locator('[data-jarvis-turn="user"]').getByText('Hol tart a pipeline?').waitFor();
  await log.locator('[data-jarvis-tool="done"]').getByText('Pipeline queried').waitFor();
  await log.locator('[data-jarvis-tool="error"]').getByText('Leads queried').waitFor();
  assert(state.requests.some((r) => r.includes('/rest/v1/jarvis_messages')), 'the messages were not read');

  state.replies.push(answer('Tovább.'));
  await page.locator('#jarvis-input').fill('Tovább');
  await page.keyboard.press('Enter');
  await log.getByText('Tovább.').waitFor();
  assert(state.jarvis[0].body.thread_id === THREAD, 'a message in an opened conversation started a new one');
  await page.getByRole('button', { name: 'New conversation' }).click();
  assert(await page.locator('[data-jarvis-log]').count() === 0, 'New conversation kept the old one');
  await context.close();
});

await check('the conversation survives moving to another screen; the record context follows the screen', async () => {
  const state = freshState();
  state.replies.push(answer('Megvan.'));
  const { page, context } = await open(browser, { state });
  await page.goto(`${BASE}/leads/${LEAD}`);
  await openJarvis(page);
  await page.locator('#jarvis-input').fill('Első');
  await page.keyboard.press('Enter');
  await page.locator('[data-jarvis-log]').getByText('Megvan.').waitFor();
  await page.getByRole('navigation', { name: 'Portal sections' }).getByRole('link', { name: 'Sales' }).click();
  await page.waitForURL(/\/portal\/sales$/);
  await page.locator('[data-jarvis-log]').getByText('Megvan.').waitFor();
  assert(await page.locator('[data-jarvis-context]').count() === 0, 'a list screen shows a record context');
  state.replies.push(answer('Itt is.'));
  await page.locator('#jarvis-input').fill('Második');
  await page.keyboard.press('Enter');
  await page.locator('[data-jarvis-log]').getByText('Itt is.').waitFor();
  assert(JSON.stringify(state.jarvis[1].body.context) === JSON.stringify({ route: '/portal/sales' }), `context: ${JSON.stringify(state.jarvis[1].body.context)}`);
  await context.close();
});

await check('a team member sees no Jarvis, and Ctrl+J does nothing', async () => {
  const { page, context, state } = await open(browser, { role: 'team_member', owner: false });
  await page.goto(`${BASE}/`);
  await page.getByRole('navigation', { name: 'Portal sections' }).waitFor();
  assert(await page.locator('[data-jarvis-open]').count() === 0, 'a team member has the Jarvis button');
  await page.keyboard.press('Control+j');
  await page.waitForTimeout(300);
  assert(await panel(page).count() === 0 && state.chunks.length === 0, 'Ctrl+J opened Jarvis for a team member');
  await context.close();
});

await check('on a phone: the button in the top bar, the panel is the whole screen, nothing scrolls sideways', async () => {
  const state = freshState();
  state.replies.push({ events: answer('| Szakasz | Deal | Érték |\n|---|---|---|\n| Ajánlat | 3 | 900 000 HUF |\n| Tárgyalás | 1 | 450 000 HUF |').events });
  const { page, context } = await open(browser, { viewport: { width: 390, height: 844 }, state });
  await page.goto(`${BASE}/`);
  await page.locator('header [data-jarvis-open]').click();
  await panel(page).waitFor();
  const box = await panel(page).boundingBox();
  assert(box && box.width === 390 && box.height === 844, `panel box ${JSON.stringify(box)}`);
  await page.locator('#jarvis-input').fill('Pipeline?');
  await page.keyboard.press('Enter');
  await page.locator('[data-jarvis-log] table').waitFor();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'the page scrolls sideways');
  assert(await page.evaluate(() => document.body.style.overflow) === 'hidden', 'the page behind scrolls');
  await shot(page, 'phone');
  await page.getByRole('button', { name: 'Close Jarvis' }).click();
  await panel(page).waitFor({ state: 'hidden' });
  assert(await page.evaluate(() => document.body.style.overflow) !== 'hidden', 'the page stayed locked');
  await context.close();
});

await check('contrast: the panel with a conversation passes 4.5:1 in both themes', async () => {
  for (const scheme of ['dark', 'light']) {
    const { page, context } = await open(browser, { colorScheme: scheme });
    await page.goto(`${BASE}/`);
    await openJarvis(page);
    await page.getByRole('button', { name: 'Conversations' }).click();
    await page.locator('[data-jarvis-threads]').getByText('Hol tart a pipeline?').click();
    await page.locator('[data-jarvis-log]').getByText('ajánlati').waitFor();
    const bad = await lowContrast(page);
    assert(bad.length === 0, `${scheme}: ${JSON.stringify(bad.slice(0, 5))}`);
    await shot(page, `theme-${scheme}`);
    await context.close();
  }
});

await browser.close();
server.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} Jarvis panel checks passed`);
process.exit(failed.length ? 1 : 0);

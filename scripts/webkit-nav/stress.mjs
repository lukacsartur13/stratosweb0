#!/usr/bin/env node
/**
 * A focused reproduction harness for the rare `mobile-390` navigation stall.
 *
 * WHY THIS EXISTS RATHER THAN MORE FULL-SUITE RUNS (§4)
 * ----------------------------------------------------
 * The reported rate is around one stall in fifteen hundred navigations. A full
 * repository-wide run takes four minutes and performs a few hundred
 * navigations, so reproducing the failure by repeating the suite costs roughly
 * half an hour per observation and produces one bit of information when it
 * lands. This harness performs the *same* navigation — same engine, same device
 * descriptor, same server, same route, same `page.goto` contract — thousands of
 * times, and records enough about each one that a single reproduction is
 * conclusive.
 *
 * WHAT IS HELD IDENTICAL TO THE SUITE
 * -----------------------------------
 *   engine       WebKit, from the same Playwright 1.62.1 install
 *   device       `devices['iPhone 13']`, unmodified — exactly what the
 *                `mobile-390` project uses, including its 390x664 content
 *                viewport, DPR 3, `isMobile` and `hasTouch`
 *   server       `scripts/webkit-nav/nav-server.mjs`, whose serving half is a
 *                verbatim copy of `scripts/test-server.mjs`
 *   navigation   real `page.goto(path)`, default `waitUntil: 'load'` unless the
 *                diagnostic matrix says otherwise (§9)
 *   timeout      30 000 ms, the suite's own test budget, unless a run is
 *                explicitly labelled DIAGNOSTIC EXTENDED OBSERVATION (§32)
 *
 * WHAT IS DELIBERATELY NOT DONE
 * -----------------------------
 *   * no retry — §31. The first outcome of each attempt is the outcome.
 *   * no shortened timeout to manufacture failures — §4.
 *   * no `fetch`, no history mutation, no mocked navigation on the primary
 *     path — §5. Those exist only as separately labelled controls.
 *   * no query parameter for correlation — §6. Correlation is an `x-nav-id`
 *     request header, which no route, rewrite or cache key in this project
 *     looks at.
 *
 * Usage:
 *   node scripts/webkit-nav/stress.mjs --label a1 --n 1000 --path /kkv.html
 *
 * Options:
 *   --label      run identifier; names the artefact directory              (required)
 *   --n          number of navigation attempts                             (default 1000)
 *   --path       route(s) to navigate, comma-separated, cycled in order    (default /kkv.html)
 *   --wait       commit | domcontentloaded | load                          (default load)
 *   --timeout    per-navigation ceiling in ms                              (default 30000)
 *   --mode       same-page | new-page | new-context | new-browser          (default new-context)
 *   --batch      iterations per context/browser in the batched modes       (default 25)
 *   --server     nav | node | python | none                                (default nav)
 *   --port       server port                                               (default 4451)
 *   --rate       serial | burst                                            (default serial)
 *   --action     goto | reload | link                                      (default goto)
 *   --settle     ms to wait between attempts                               (default 0)
 *   --reduced-motion   run the context with prefers-reduced-motion: reduce
 *   --out        artefact root  (default _build/reports/webkit-navigation)
 */

import { webkit, devices } from '@playwright/test';
import { spawn, execFile } from 'node:child_process';
import { mkdir, writeFile, readFile, appendFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import os from 'node:os';

const execFileAsync = promisify(execFile);
const now = () => performance.timeOrigin + performance.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Arguments.
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const flag = (name) => argv.includes(`--${name}`);

const LABEL = arg('label');
if (!LABEL) { console.error('--label is required'); process.exit(2); }

const N = Number(arg('n', 1000));
const PATHS = String(arg('path', '/kkv.html')).split(',').map((s) => s.trim()).filter(Boolean);
const WAIT = arg('wait', 'load');
const TIMEOUT = Number(arg('timeout', 30_000));
const MODE = arg('mode', 'new-context');
const BATCH = Number(arg('batch', 25));
const SERVER = arg('server', 'nav');
const PORT = Number(arg('port', 4451));
const RATE = arg('rate', 'serial');
const ACTION = arg('action', 'goto');
const SETTLE = Number(arg('settle', 0));
const REDUCED = flag('reduced-motion');
const OUT = resolve(arg('out', '_build/reports/webkit-navigation'));
const BASE = `http://127.0.0.1:${PORT}`;
const ROOT = resolve('dist');

// Raw per-event logs go to local scratch, never onto the iCloud-backed volume
// the server is reading `dist/` from. Writing a log line per event onto the
// same file provider would make the harness a participant in the phenomenon it
// is measuring.
const SCRATCH = process.env.STRATOS_NAV_SCRATCH
  ?? join(os.tmpdir(), 'stratos-webkit-nav');
const SERVER_LOG = arg('server-log', join(SCRATCH, `${LABEL}-server.ndjson`));

// ---------------------------------------------------------------------------
// Host sampling (§18) and run classification (§2).
// ---------------------------------------------------------------------------
const loadAverage = () => os.loadavg()[0];

async function processHealth() {
  try {
    const { stdout } = await execFileAsync('/bin/ps', ['-Ao', 'pid,pcpu,rss,comm']);
    const lines = stdout.split('\n').filter((l) => /ms-playwright\/webkit-/.test(l));
    const rssKb = lines.reduce((a, l) => a + Number(l.trim().split(/\s+/)[2] || 0), 0);
    const cpu = lines.reduce((a, l) => a + Number(l.trim().split(/\s+/)[1] || 0), 0);
    return { webkitProcs: lines.length, webkitRssMb: +(rssKb / 1024).toFixed(1), webkitCpu: +cpu.toFixed(1), load1: +loadAverage().toFixed(2) };
  } catch {
    return { webkitProcs: null, webkitRssMb: null, webkitCpu: null, load1: +loadAverage().toFixed(2) };
  }
}

// ---------------------------------------------------------------------------
// The static control page (§22).
//
// Written into the served root rather than a second server, because §22 asks
// for the same server and the same browser process. `dist/` is build output and
// is not tracked; `npm run build` clears it, so this is recreated on demand and
// never becomes a fixture anyone has to maintain.
// ---------------------------------------------------------------------------
const CONTROL_DIR = join(ROOT, '__navctl');
const CONTROL_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>navigation control</title></head>
<body><h1>control</h1><p>No stylesheet, no script, no font, no image. One document, one request.</p></body></html>
`;

async function ensureControlPage() {
  await mkdir(CONTROL_DIR, { recursive: true });
  await writeFile(join(CONTROL_DIR, 'control.html'), CONTROL_HTML);
}

// ---------------------------------------------------------------------------
// Server lifecycle.
// ---------------------------------------------------------------------------
let serverProc = null;

async function startServer() {
  if (SERVER === 'none') return;
  const cmd = {
    nav: ['node', ['scripts/webkit-nav/nav-server.mjs', String(PORT), 'dist', SERVER_LOG]],
    node: ['node', ['scripts/test-server.mjs', String(PORT), 'dist']],
    python: ['python3', ['-m', 'http.server', String(PORT), '--directory', 'dist']],
  }[SERVER];
  if (!cmd) throw new Error(`unknown --server ${SERVER}`);
  serverProc = spawn(cmd[0], cmd[1], { stdio: ['ignore', 'pipe', 'pipe'] });
  serverProc.stderr.on('data', () => {});
  serverProc.stdout.on('data', () => {});
  // Wait for it to answer rather than sleeping a guessed interval.
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`${BASE}/index.html`, { method: 'HEAD' });
      if (res.status < 500) return;
    } catch { /* not up yet */ }
    await sleep(100);
  }
  throw new Error('server did not come up');
}

async function stopServer() {
  if (!serverProc) return;
  const done = new Promise((r) => serverProc.once('exit', r));
  serverProc.kill('SIGTERM');
  await Promise.race([done, sleep(3_000)]);
  serverProc = null;
}

// ---------------------------------------------------------------------------
// Per-navigation record.
// ---------------------------------------------------------------------------
function newRecord(navId, path, ordinal) {
  return {
    navId, path, ordinal,
    // §7 client timeline. `null` means the event never arrived.
    gotoInvoked: null, requestIssued: null, responseReceived: null,
    committed: null, domcontentloaded: null, load: null,
    gotoResolved: null, failedAt: null,
    status: null, error: null,
    // Every request this navigation produced, for §10 and §26.
    resources: [],
    pageErrors: [], consoleErrors: [], crashed: false,
  };
}

/**
 * Attach the listeners once per page and route their events into whichever
 * navigation is currently in progress.
 *
 * Attaching and detaching per attempt would be the obvious shape and is the
 * wrong one: Playwright delivers some events (a late `requestfailed`, a
 * `response` for a resource the previous document started) after the attempt
 * that caused them has ended, and a harness that has already removed its
 * listeners silently loses exactly the evidence §26 asks for. Instead the
 * listeners live as long as the page and write into `ctx.current`, and events
 * that arrive with no navigation in progress are counted as strays rather than
 * dropped.
 */
function wire(page, ctx) {
  const stamp = (fn) => (...a) => { try { fn(...a); } catch { /* never let a listener kill a run */ } };

  page.on('request', stamp((req) => {
    const rec = ctx.current;
    if (!rec) { ctx.strays++; return; }
    const entry = {
      url: req.url(), method: req.method(), type: req.resourceType(),
      isNavigation: req.isNavigationRequest(), startedAt: now(),
      respondedAt: null, failedAt: null, status: null, errorText: null,
      fromCache: null, bodySize: null,
    };
    rec.resources.push(entry);
    if (entry.isNavigation && req.frame() === page.mainFrame() && rec.requestIssued === null) {
      rec.requestIssued = entry.startedAt;
    }
  }));

  page.on('response', stamp(async (res) => {
    const rec = ctx.current;
    if (!rec) { ctx.strays++; return; }
    const entry = [...rec.resources].reverse().find((r) => r.url === res.url() && r.respondedAt === null && r.failedAt === null);
    if (entry) {
      entry.respondedAt = now();
      entry.status = res.status();
    }
    if (res.request().isNavigationRequest() && res.frame() === page.mainFrame() && rec.responseReceived === null) {
      rec.responseReceived = now();
      rec.status = res.status();
    }
  }));

  page.on('requestfailed', stamp((req) => {
    const rec = ctx.current;
    if (!rec) { ctx.strays++; return; }
    const entry = [...rec.resources].reverse().find((r) => r.url === req.url() && r.respondedAt === null && r.failedAt === null);
    if (entry) {
      entry.failedAt = now();
      entry.errorText = req.failure()?.errorText ?? null;
    }
  }));

  page.on('framenavigated', stamp((frame) => {
    const rec = ctx.current;
    if (!rec || frame !== page.mainFrame()) return;
    if (rec.committed === null) rec.committed = now();
  }));

  page.on('domcontentloaded', stamp(() => {
    const rec = ctx.current;
    if (rec && rec.domcontentloaded === null) rec.domcontentloaded = now();
  }));

  page.on('load', stamp(() => {
    const rec = ctx.current;
    if (rec && rec.load === null) rec.load = now();
  }));

  page.on('pageerror', stamp((err) => {
    const rec = ctx.current;
    if (rec && rec.pageErrors.length < 10) rec.pageErrors.push(String(err.message ?? err));
  }));

  page.on('console', stamp((msg) => {
    if (msg.type() !== 'error') return;
    const rec = ctx.current;
    if (rec && rec.consoleErrors.length < 10) rec.consoleErrors.push(msg.text().slice(0, 400));
  }));

  page.on('crash', stamp(() => { if (ctx.current) ctx.current.crashed = true; ctx.crashes++; }));
}

// ---------------------------------------------------------------------------
// Failure artefacts (§29).
// ---------------------------------------------------------------------------
async function captureFailure(rec, page, runDir) {
  const dir = join(OUT, 'failures', `${LABEL}-${rec.navId}`);
  await mkdir(dir, { recursive: true });

  // Outstanding at failure time: requests that never got a response and never
  // failed. §10 — the point is that the main document is not automatically the
  // guilty party.
  const outstanding = rec.resources
    .filter((r) => r.respondedAt === null && r.failedAt === null)
    .map((r) => ({ ...r, pendingMs: +(now() - r.startedAt).toFixed(0) }));

  let url = null, title = null, readyState = null;
  try { url = page.url(); } catch { /* page may be gone */ }
  try {
    // Bounded by hand: a page whose navigation has stalled may never answer,
    // and `title()`/`evaluate()` take no timeout of their own.
    const probe = page.evaluate(() => ({ title: document.title, readyState: document.readyState }));
    const answer = await Promise.race([probe, sleep(2_000).then(() => null)]);
    if (answer) { title = answer.title; readyState = answer.readyState; }
  } catch { /* a stalled page cannot always answer */ }
  try {
    await page.screenshot({ path: join(dir, 'screenshot.png'), timeout: 5_000 });
  } catch { /* nothing to photograph */ }

  await writeFile(join(dir, 'timeline.json'), JSON.stringify({
    label: LABEL, run: runDir, record: rec, outstanding,
    pageUrl: url, title, readyState,
    boundary: classify(rec),
    host: await processHealth(),
  }, null, 2));
  await writeFile(join(dir, 'network.json'), JSON.stringify(rec.resources, null, 2));
  await writeFile(join(dir, 'error.txt'), String(rec.error ?? '(none)'));
  return dir;
}

/**
 * §8 — every failure is named by the last boundary it reached, never by the
 * word "stall" on its own.
 */
function classify(rec) {
  if (rec.gotoResolved !== null) return 'SUCCESS';
  if (rec.requestIssued === null) return 'A: goto invoked, no request issued';
  if (rec.responseReceived === null) return 'B: request issued, no response';
  if (rec.committed === null) return 'C: response received, no navigation commit';
  if (rec.domcontentloaded === null) return 'D: committed, no DOMContentLoaded';
  if (rec.load === null) return 'E: DOMContentLoaded, no load';
  return 'F: load fired, goto did not resolve';
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------
const runDir = join(OUT, 'runs', LABEL);

async function main() {
  await mkdir(SCRATCH, { recursive: true });
  await rm(SERVER_LOG, { force: true });
  await mkdir(runDir, { recursive: true });
  await ensureControlPage();
  await startServer();

  const startLoad = loadAverage();
  const startedAt = new Date().toISOString();
  let version = null;

  const records = [];
  const samples = [];
  let browser = null, context = null, page = null;
  const ctx = { current: null, strays: 0, crashes: 0 };

  const contextOptions = {
    ...devices['iPhone 13'],
    baseURL: BASE,
    ...(REDUCED ? { reducedMotion: 'reduce' } : {}),
  };

  const openBrowser = async () => { browser = await webkit.launch(); version ??= browser.version(); };
  const openContext = async () => {
    context = await browser.newContext(contextOptions);
    page = await context.newPage();
    wire(page, ctx);
  };
  const openPage = async () => {
    page = await context.newPage();
    wire(page, ctx);
  };

  await openBrowser();
  await openContext();

  const sampler = setInterval(async () => {
    samples.push({ at: new Date().toISOString(), i: records.length, ...(await processHealth()) });
  }, 10_000);
  sampler.unref();

  let previousUrl = null;

  for (let i = 1; i <= N; i++) {
    // Recycle at the boundary the mode asks for. §16.
    if (i > 1) {
      if (MODE === 'new-browser' && (i - 1) % BATCH === 0) {
        await browser.close(); await openBrowser(); await openContext();
      } else if (MODE === 'new-context' && (i - 1) % BATCH === 0) {
        await context.close(); await openContext();
      } else if (MODE === 'new-page') {
        await page.close(); await openPage();
      }
    }

    const path = PATHS[(i - 1) % PATHS.length];
    // Label-prefixed so that several drivers can share one server and one log
    // without their navigation identities colliding — which is what §15's
    // higher-rate pattern and the suite's five-worker shape both need.
    const navId = `${LABEL}-nav-${String(i).padStart(6, '0')}`;
    const rec = newRecord(navId, path, i);
    ctx.current = rec;

    // Out-of-band correlation. Set on the context so it reaches subresources
    // too, which is what makes §10's "which request was still outstanding"
    // answerable from the server side as well as the client side.
    await context.setExtraHTTPHeaders({ 'x-nav-id': navId });

    rec.gotoInvoked = now();
    try {
      if (ACTION === 'reload' && previousUrl === BASE + path) {
        const res = await page.reload({ waitUntil: WAIT, timeout: TIMEOUT });
        rec.status = res?.status() ?? rec.status;
      } else if (ACTION === 'link' && previousUrl) {
        // A real user-path navigation: click an anchor that points at the
        // target, which is the path `assets/js/transitions.js` participates in.
        const link = page.locator(`a[href$="${path.replace(/^\//, '')}"]`).first();
        await Promise.all([
          page.waitForURL(`**${path}`, { waitUntil: WAIT, timeout: TIMEOUT }),
          link.click({ timeout: TIMEOUT }),
        ]);
      } else {
        const res = await page.goto(path, { waitUntil: WAIT, timeout: TIMEOUT });
        rec.status = res?.status() ?? rec.status;
      }
      rec.gotoResolved = now();
      previousUrl = BASE + path;
    } catch (err) {
      rec.failedAt = now();
      rec.error = String(err?.message ?? err).split('\n').slice(0, 6).join('\n');
    }

    ctx.current = null;
    rec.boundary = classify(rec);
    rec.totalMs = +((rec.gotoResolved ?? rec.failedAt) - rec.gotoInvoked).toFixed(1);
    rec.load1 = +loadAverage().toFixed(2);

    if (rec.boundary !== 'SUCCESS') {
      const dir = await captureFailure(rec, page, LABEL);
      console.log(`  !! ${navId} ${path} — ${rec.boundary} (${rec.totalMs} ms) -> ${dir}`);
    }

    // Keep the in-memory record small: the resource list of a successful
    // navigation is 20 entries and 5 000 of them is a 200 MB JSON nobody reads.
    // §30's spirit applied to our own artefacts — rich for failures, a summary
    // line for successes.
    records.push(rec.boundary === 'SUCCESS'
      ? {
          navId, path, ordinal: i, boundary: 'SUCCESS', status: rec.status,
          totalMs: rec.totalMs, load1: rec.load1,
          requestMs: rec.requestIssued === null ? null : +(rec.requestIssued - rec.gotoInvoked).toFixed(1),
          responseMs: rec.responseReceived === null ? null : +(rec.responseReceived - rec.gotoInvoked).toFixed(1),
          commitMs: rec.committed === null ? null : +(rec.committed - rec.gotoInvoked).toFixed(1),
          dclMs: rec.domcontentloaded === null ? null : +(rec.domcontentloaded - rec.gotoInvoked).toFixed(1),
          loadMs: rec.load === null ? null : +(rec.load - rec.gotoInvoked).toFixed(1),
          resourceCount: rec.resources.length,
          failedResources: rec.resources.filter((r) => r.failedAt !== null)
            .map((r) => ({ url: r.url, type: r.type, errorText: r.errorText })),
        }
      : rec);

    if (SETTLE) await sleep(SETTLE);
    if (RATE === 'burst' && i % 50 === 0) await sleep(50);

    if (i % 250 === 0) {
      const fails = records.filter((r) => r.boundary !== 'SUCCESS').length;
      const h = await processHealth();
      console.log(`  ${i}/${N}  failures=${fails}  webkitProcs=${h.webkitProcs}  rss=${h.webkitRssMb}MB  load=${h.load1}`);
    }
  }

  clearInterval(sampler);
  await browser.close();
  await stopServer();

  const endLoad = loadAverage();
  // Classified on the load the run STARTED under, not the load it ended under.
  // §2's contamination is unrelated work sharing the machine; the load a
  // five-browser experiment generates is the experiment, and judging a run
  // contaminated because it succeeded in loading the host would make every
  // concurrent measurement in this workstream unusable. End load is recorded as
  // data either way.
  const contaminated = startLoad >= 4.0;

  const summary = {
    label: LABEL, startedAt, endedAt: new Date().toISOString(),
    classification: contaminated ? 'CONTAMINATED' : 'CONTROLLED',
    load1Start: +startLoad.toFixed(2), load1End: +endLoad.toFixed(2),
    config: { n: N, paths: PATHS, wait: WAIT, timeoutMs: TIMEOUT, mode: MODE, batch: BATCH, server: SERVER, rate: RATE, action: ACTION, settle: SETTLE, reducedMotion: REDUCED },
    engine: { playwright: '1.62.1', webkitVersion: version, node: process.version, platform: `${process.platform}-${process.arch}` },
    attempts: records.length,
    successes: records.filter((r) => r.boundary === 'SUCCESS').length,
    failures: records.filter((r) => r.boundary !== 'SUCCESS').length,
    strayEvents: ctx.strays,
    crashes: ctx.crashes,
    boundaries: records.reduce((a, r) => { a[r.boundary] = (a[r.boundary] ?? 0) + 1; return a; }, {}),
    latency: percentiles(records.filter((r) => r.boundary === 'SUCCESS').map((r) => r.totalMs)),
    byOrdinalBand: bands(records),
    serverLog: SERVER === 'nav' ? SERVER_LOG : null,
    hostSamples: samples,
  };

  await writeFile(join(runDir, 'summary.json'), JSON.stringify(summary, null, 2));
  await writeFile(join(runDir, 'records.json'), JSON.stringify(records, null, 2));

  console.log(`\n${LABEL}: ${summary.successes}/${summary.attempts} ok, ${summary.failures} failed  [${summary.classification}]`);
  console.log(`  boundaries: ${JSON.stringify(summary.boundaries)}`);
  console.log(`  p50=${summary.latency.p50} p95=${summary.latency.p95} p99=${summary.latency.p99} max=${summary.latency.max}`);

  // One line per run, appended, so the CSV is the accumulating record of the
  // whole investigation rather than a file that has to be regenerated.
  const csv = join(OUT, 'stress-summary.csv');
  if (!existsSync(csv)) {
    await writeFile(csv, 'label,class,server,path,wait,mode,action,rate,timeoutMs,n,ok,fail,failRate,p50,p95,p99,max,boundaries,load1Start,load1End,startedAt\n');
  }
  await appendFile(csv, [
    LABEL, summary.classification, SERVER, PATHS.join('|'), WAIT, MODE, ACTION, RATE, TIMEOUT,
    summary.attempts, summary.successes, summary.failures,
    (summary.failures / summary.attempts).toFixed(6),
    summary.latency.p50, summary.latency.p95, summary.latency.p99, summary.latency.max,
    `"${Object.entries(summary.boundaries).map(([k, v]) => `${k}=${v}`).join(' ')}"`,
    summary.load1Start, summary.load1End, startedAt,
  ].join(',') + '\n');
}

function percentiles(values) {
  if (!values.length) return { p50: null, p95: null, p99: null, max: null, min: null };
  const s = [...values].sort((a, b) => a - b);
  const at = (q) => s[Math.min(s.length - 1, Math.floor(q * s.length))];
  return { min: s[0], p50: at(0.5), p95: at(0.95), p99: at(0.99), max: s[s.length - 1] };
}

/** §17 — failure rate by navigation ordinal, to separate accumulation from a flat tail. */
function bands(records) {
  const out = {};
  for (const r of records) {
    const band = `${Math.floor((r.ordinal - 1) / 250) * 250 + 1}-${(Math.floor((r.ordinal - 1) / 250) + 1) * 250}`;
    out[band] ??= { n: 0, fail: 0 };
    out[band].n++;
    if (r.boundary !== 'SUCCESS') out[band].fail++;
  }
  return out;
}

main().catch(async (err) => {
  console.error(err);
  await stopServer();
  process.exit(1);
});

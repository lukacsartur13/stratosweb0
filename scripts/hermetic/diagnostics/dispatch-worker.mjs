#!/usr/bin/env node
/**
 * One process that executes the exact failing navigation contract over and over
 * under ONE controlled lifetime model, and narrates every protocol boundary it
 * crosses — §10, §16, §17, §19.
 *
 * WHY A SEPARATE PROCESS RATHER THAN A SPEC
 * -----------------------------------------
 * Because the question is about the layer BELOW the test runner. The G6 bundle
 * already proves everything a spec can prove: `page.goto` was called, no request
 * event arrived, the page stayed on `about:blank`. Adding assertions to a spec
 * would produce that same empty artefact again. What is missing is what
 * Playwright said to the browser and what the browser said back, and the only
 * supported way to see that is `DEBUG=pw:protocol` on the process that owns the
 * connection (§11: "prefer supported debugging/protocol facilities"; §11 also
 * forbids modifying Playwright internals, and nothing here does).
 *
 * So: this process turns that stream on, writes it to its OWN stderr, and
 * brackets each attempt with marker lines on the same stream. Because both go
 * to one file descriptor, ordering between a marker and a protocol frame is
 * guaranteed by the kernel rather than inferred from two clocks. The parent
 * slices the stream on the markers, which is exact.
 *
 * WHAT IT DOES NOT DO — §33
 * -------------------------
 * It never retries a stalled navigation and it never recovers one. A stall is
 * the deliverable. When one happens the attempt is held open, probed (§30-32)
 * and reported; it is not repaired.
 *
 * THE CONTRACT IT REPRODUCES — §18, "do not simplify first"
 * --------------------------------------------------------
 * `devices['iPhone 13']`, verbatim, which is what `mobile-390` spreads. Same
 * URL. `goto` called with NO options, so the same default `waitUntil: 'load'`.
 * The timeout is passed explicitly at 30 000 ms because outside the test runner
 * there is no test budget to inherit — the value is the one the runner would
 * have imposed, not a new policy (§34: normal timeouts are not increased).
 *
 * Usage (driven by nav-dispatch.mjs, not by hand):
 *   node dispatch-worker.mjs --model fresh-context --attempts 100 --base http://127.0.0.1:4322
 *        --route /nagyvallalat.html --id-prefix nav-dispatch --id-start 1 [--warmup] [--neighbours]
 */

import { webkit, devices } from 'playwright-core';
import os from 'node:os';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : argv[i + 1]; };
const has = (n) => argv.includes(`--${n}`);

const MODEL = arg('model', 'fresh-context');
const ATTEMPTS = Number(arg('attempts', 100));
const BASE = arg('base', 'http://127.0.0.1:4322');
const ROUTE = arg('route', '/nagyvallalat.html');
const PREFIX = arg('id-prefix', 'nav-dispatch');
const ID_START = Number(arg('id-start', 1));
const NAV_TIMEOUT = Number(arg('nav-timeout', 30_000));
/** §34 — after the contract's own budget expires, keep watching, separately. */
const EXTENDED_MS = Number(arg('extended', 120_000));
const WARMUP = has('warmup');          // §22
/**
 * CALIBRATION — the instrument is not trusted until it has been made to fire.
 *
 * 5 000 clean executions mean nothing if the stall path has never run. A
 * detector that cannot fire reports zero for the same reason a working one
 * reports zero, and the two are indistinguishable from the outside.
 *
 * `STRATOS_DISPATCH_FAULT=pre-request` replaces the navigation with a promise
 * that never settles — no command, no request event — which is the shape of the
 * G6 failure and nothing else. Everything downstream is untouched: the same
 * timeout, the same classifier, the same bundle, the same probes.
 *
 * This is a fault injector, not a code path the real arms can reach. It requires
 * an environment variable that nothing in the gate or the matrix sets, and the
 * injected attempt is reported with `synthetic: true` so a calibration record
 * can never be mistaken for a reproduction.
 */
const FAULT = process.env.STRATOS_DISPATCH_FAULT ?? null;
const NEIGHBOURS = has('neighbours');  // the two sibling routes that precede the target in the real file

/** §16 — six digits, monotonic, never encoded into the URL (§16 forbids that). */
const attemptId = (n) => `${PREFIX}-${String(n).padStart(6, '0')}`;

const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
/** Markers share stderr with the protocol stream, so their order is the kernel's. */
const mark = (kind, id, extra = {}) =>
  process.stderr.write(`@@NAVDISPATCH ${JSON.stringify({ kind, id, hr: Number(process.hrtime.bigint() / 1000n), ...extra })}\n`);

/**
 * §17 — the state machine, WebKit spelling.
 *
 * These are not guesses at what WebKit does. They are the frames observed in a
 * captured healthy `page.goto` on this exact build (webkit 26.5, revision 2336),
 * in this order:
 *
 *   SEND ► Playwright.navigate {url, pageProxyId, frameId}   DISPATCHED
 *   RECV   Page.willCheckNavigationPolicy {frameId}          POLICY_CHECK_STARTED
 *   RECV   {"result":{"loaderId":"17"},"id":<that id>}       ACKNOWLEDGED
 *   RECV   Page.didCheckNavigationPolicy {cancel:false}      POLICY_ALLOWED
 *   RECV   Network.requestWillBeSent                         NAVIGATION_STARTED
 *   ...    server, response, Page.frameNavigated, load       …
 *
 * The two policy frames matter more than their obscurity suggests: they sit
 * between the command and ANY network activity, so a navigation that dies
 * between them produces precisely the G6 signature — command sent, zero
 * requests, page still on about:blank. That is a hypothesis this instrument can
 * confirm or kill, which is the only reason it is written down here.
 */
const STATES = [
  'TEST_READY',
  'GOTO_CALLED',
  'PROTOCOL_COMMAND_DISPATCHED',
  'PROTOCOL_POLICY_CHECK_STARTED',
  'PROTOCOL_COMMAND_ACKNOWLEDGED',
  'PROTOCOL_POLICY_ALLOWED',
  'BROWSER_NAVIGATION_STARTED',
  'REQUEST_EVENT',
  'SERVER_RECEIVED',
  'RESPONSE_EVENT',
  'FRAME_NAVIGATED',
  'DOMCONTENTLOADED',
  'LOAD',
  'GOTO_RESOLVED',
];

const CONTEXT_OPTS = { ...devices['iPhone 13'] };

let browser = null;
let context = null;
let page = null;

async function newBrowser() { return webkit.launch(); }
async function newContext(b) { return b.newContext({ ...CONTEXT_OPTS, baseURL: BASE }); }

/** §28 — process and host state, sampled cheaply, only recorded on a stall. */
const procState = () => ({
  freememMB: Math.round(os.freemem() / 1048576),
  loadavg: os.loadavg(),
  rssMB: Math.round(process.memoryUsage().rss / 1048576),
  browserConnected: browser ? browser.isConnected() : null,
  contextPages: context ? context.pages().length : null,
  pageClosed: page ? page.isClosed() : null,
});

/**
 * §29 — an independent heartbeat, so a stalled navigation can be told apart
 * from a stalled Node event loop. It ticks on a plain timer that owes nothing
 * to Playwright; if the ticks keep coming while `goto` hangs, the driver is
 * alive and only the navigation is stuck.
 */
let beats = 0;
const heartbeat = setInterval(() => { beats += 1; }, 250);
heartbeat.unref();

/** §30-32 — probes. Diagnostic only; never a recovery path (§33). */
async function probes(id) {
  const r = { sameContextPage: null, freshContext: null, freshBrowser: null };
  const light = `${BASE}/index.html`;
  try {
    const p2 = await context.newPage();
    await p2.goto(light, { timeout: 10_000 });
    r.sameContextPage = 'ok';
    await p2.close();
  } catch (e) { r.sameContextPage = `FAILED: ${String(e).slice(0, 200)}`; }
  try {
    const c2 = await newContext(browser);
    const p3 = await c2.newPage();
    await p3.goto(light, { timeout: 10_000 });
    r.freshContext = 'ok';
    await c2.close();
  } catch (e) { r.freshContext = `FAILED: ${String(e).slice(0, 200)}`; }
  try {
    const b2 = await newBrowser();
    const c3 = await b2.newContext({ ...CONTEXT_OPTS });
    const p4 = await c3.newPage();
    await p4.goto(light, { timeout: 10_000 });
    r.freshBrowser = 'ok';
    await b2.close();
  } catch (e) { r.freshBrowser = `FAILED: ${String(e).slice(0, 200)}`; }
  mark('probes', id, r);
  return r;
}

/** Playwright-observable states for one attempt. */
function attach(p, reached, events) {
  const t0 = process.hrtime.bigint();
  const at = () => Number((process.hrtime.bigint() - t0) / 1000n);
  const hit = (s, extra = {}) => { reached.add(s); events.push({ us: at(), state: s, ...extra }); };
  // `at()` is exposed so the caller can stamp the goto's own start on the SAME
  // clock. Without it an event offset silently includes the neighbour
  // navigations that ran before it, and the dispatch latency — the one number
  // this investigation is about — cannot be read back out of the record.
  hit.at = at;
  p.on('request', (r) => {
    if (r.frame() === p.mainFrame() && r.isNavigationRequest()) hit('REQUEST_EVENT', { url: r.url() });
  });
  p.on('response', (r) => {
    if (r.request().frame() === p.mainFrame() && r.request().isNavigationRequest()) hit('RESPONSE_EVENT', { status: r.status() });
  });
  p.on('framenavigated', (f) => { if (f === p.mainFrame()) hit('FRAME_NAVIGATED', { url: f.url() }); });
  p.on('domcontentloaded', () => hit('DOMCONTENTLOADED'));
  p.on('load', () => hit('LOAD'));
  p.on('close', () => hit('PAGE_CLOSED'));
  p.on('crash', () => hit('PAGE_CRASHED'));
  return { hit, at };
}

/** §9 — the state of the page in the instant before the call under test. */
async function preGotoState(p) {
  let readyState = null;
  try { readyState = await p.evaluate(() => document.readyState); } catch { readyState = '<unavailable>'; }
  return {
    url: p.url(),
    pageClosed: p.isClosed(),
    contextClosed: false,
    browserConnected: browser.isConnected(),
    readyState,
    contextPages: context.pages().length,
    pageIndex: context.pages().indexOf(p),
  };
}

async function run() {
  browser = await newBrowser();
  const version = browser.version();
  out({ kind: 'worker-start', model: MODEL, attempts: ATTEMPTS, route: ROUTE, base: BASE,
        browser: 'webkit', browserVersion: version, contextOptions: CONTEXT_OPTS, states: STATES,
        pid: process.pid, node: process.version });

  if (MODEL !== 'fresh-browser') context = await newContext(browser);
  if (MODEL === 'reused-page') page = await context.newPage();

  let priorNavigations = 0;

  for (let i = 0; i < ATTEMPTS; i++) {
    const id = attemptId(ID_START + i);
    const reached = new Set(['TEST_READY']);
    const events = [];

    // -- lifetime model (§19). Exactly one variable differs between models. --
    if (MODEL === 'fresh-browser') {
      if (browser) await browser.close().catch(() => {});
      browser = await newBrowser();
      context = await newContext(browser);
      page = await context.newPage();
    } else if (MODEL === 'fresh-context') {
      if (context) await context.close().catch(() => {});
      context = await newContext(browser);
      page = await context.newPage();
    } else if (MODEL === 'fresh-page') {
      if (page) await page.close().catch(() => {});
      page = await context.newPage();
    } // reused-page: keep the same page, whatever it is showing

    const { hit } = attach(page, reached, events);

    // THE NEIGHBOURS RUN IN THEIR OWN CONTEXTS, AND THAT IS THE WHOLE POINT.
    //
    // `public-site.spec.ts` reaches the target after two sibling tests have
    // navigated to `/rolunk.html` and `/kkv.html` in the same worker — and
    // Playwright Test gives every test a FRESH context and a FRESH page. So in
    // the real contract those neighbours leave the browser warm and leave the
    // target's own page at `about:blank`.
    //
    // Driving them on the target's own page instead would warm the page as
    // well, which silently converts this arm into the §22 warm-up control and
    // destroys the one precondition §22 exists to isolate. The first version of
    // this worker did exactly that: 500 attempts ran with `urlBefore` set to a
    // real URL and NOT ONE started from `about:blank`. Those 500 measured a
    // contract this repository does not contain.
    if (NEIGHBOURS) {
      for (const n of ['/rolunk.html', '/kkv.html']) {
        let nc = null;
        try {
          nc = await newContext(browser);
          const np = await nc.newPage();
          await np.goto(`${BASE}${n}`, { timeout: 15_000 });
          priorNavigations += 1;
        } catch { /* a neighbour's own outcome is not this attempt's verdict */ }
        finally { if (nc) await nc.close().catch(() => {}); }
      }
    }

    // §22 — the about:blank control, and the ONLY thing here allowed to touch
    // the page under test before the call. Off by default, so the default arm
    // keeps the initial-navigation condition the real contract has.
    if (WARMUP) {
      try { await page.goto(`${BASE}/index.html`, { timeout: 15_000 }); } catch { /* recorded by outcome */ }
    }

    const pre = await preGotoState(page);
    const beatsBefore = beats;
    const target = /^https?:\/\//.test(ROUTE) ? ROUTE : `${BASE}${ROUTE}`;

    mark('goto-begin', id, { model: MODEL, target, urlBefore: pre.url, priorNavigations });
    const gotoAtUs = hit.at();
    reached.add('GOTO_CALLED');
    const wall0 = Date.now();
    const hr0 = Number(process.hrtime.bigint() / 1000n);

    let outcome = 'resolved';
    let status = null;
    let error = null;
    let extended = null;

    // The call under test. No options beyond the timeout the runner would have
    // imposed: same default waitUntil, same URL, same everything else.
    const gotoPromise = FAULT === 'pre-request'
      ? new Promise((_res, rej) => setTimeout(
          () => rej(new Error(`page.goto: Timeout ${NAV_TIMEOUT}ms exceeded.`)), NAV_TIMEOUT).unref?.())
      : page.goto(target, { timeout: NAV_TIMEOUT });
    try {
      const res = await gotoPromise;
      status = res ? res.status() : null;
      reached.add('GOTO_RESOLVED');
    } catch (e) {
      outcome = 'failed';
      error = e instanceof Error ? e.message : String(e);
      // §34 — the contract's own result stands. What happens AFTER it is
      // recorded separately and never overwrites it.
      if (/Timeout .* exceeded|exceeded/i.test(error) && !reached.has('REQUEST_EVENT')) {
        outcome = 'STALL_BEFORE_REQUEST';
      }
    }
    const hr1 = Number(process.hrtime.bigint() / 1000n);
    mark('goto-end', id, { outcome, status, durationUs: hr1 - hr0 });

    // ---- a dispatch stall: the deliverable (§28-32, §34, §35) -------------
    if (outcome === 'STALL_BEFORE_REQUEST') {
      const proc = procState();
      const beatsDuring = beats - beatsBefore;
      const inPage = await Promise.race([
        page.evaluate(() => ({ readyState: document.readyState, href: location.href,
                               bodyChildCount: document.body ? document.body.childElementCount : null,
                               resources: performance.getEntriesByType('resource').length })).catch((e) => ({ evaluateFailed: String(e).slice(0, 200) })),
        new Promise((r) => setTimeout(() => r({ evaluateFailed: 'deadline' }), 5000)),
      ]);
      const probeResults = await probes(id);
      // §34 — does the pending navigation ever land? Watched, never waited on
      // as part of the contract's own verdict.
      extended = await new Promise((resolve) => {
        const started = Date.now();
        let done = false;
        const finish = (how) => { if (!done) { done = true; resolve({ how, afterMs: Date.now() - started }); } };
        page.waitForURL(target, { timeout: EXTENDED_MS }).then(() => finish('navigated'), () => finish('never-before-cleanup'));
        setTimeout(() => finish('never-before-cleanup'), EXTENDED_MS + 1000).unref?.();
        void started;
      });
      out({ kind: 'stall', id, synthetic: FAULT === 'pre-request', fault: FAULT,
            model: MODEL, route: ROUTE, target, gotoAtUs, dispatchUs: null, pre, proc, inPage,
            probeResults, beatsDuring, driverResponsive: beatsDuring > 0, events,
            statesReached: STATES.filter((s) => reached.has(s)), error, extended,
            wallStart: new Date(wall0).toISOString(), durationUs: hr1 - hr0 });
    } else {
      const req = events.find((e) => e.state === 'REQUEST_EVENT');
      out({ kind: 'attempt', id, model: MODEL, route: ROUTE, outcome, status,
            durationUs: hr1 - hr0, gotoAtUs,
            // GOTO_CALLED → REQUEST_EVENT: the dispatch half, isolated from the
            // load half. A stall of the kind under investigation is a dispatch
            // latency that never ends, so this is the distribution whose tail
            // matters, and it is the one the old record could not express.
            dispatchUs: req ? req.us - gotoAtUs : null,
            pre, events, statesReached: STATES.filter((s) => reached.has(s)), error });
    }
    priorNavigations += 1;
  }

  out({ kind: 'worker-end', model: MODEL, attempts: ATTEMPTS });
  if (browser) await browser.close().catch(() => {});
}

run().then(
  () => process.exit(0),
  (e) => { out({ kind: 'worker-error', error: String(e && e.stack ? e.stack : e) }); process.exit(1); },
);

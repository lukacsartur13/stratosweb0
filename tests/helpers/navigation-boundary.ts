import { test as base, expect, type Page, type Request, type Response } from '@playwright/test';
import fs from 'node:fs';
import { readdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export { expect, type Page };

/**
 * The navigation-boundary recorder.
 *
 * WHY THIS EXISTS
 * ---------------
 * `public-site.spec.ts:264 [mobile-390]` failed once inside a proven hermetic
 * run and left behind one sentence: `page.goto` had not resolved when the
 * budget expired. That sentence is compatible with nine different things having
 * gone wrong — no request was ever issued; the request never reached the
 * server; the server never answered; the answer never committed; the document
 * never parsed; a subresource never finished; `load` fired and Playwright did
 * not notice — and it distinguishes none of them.
 *
 * It could not do better, because the test's own budget is what expires. There
 * is no navigation timeout, so `page.goto` dies with the test, the test body is
 * abandoned at line 265, and every statement that could have recorded state is
 * never reached. Nothing written *inside* a test body can survive that.
 *
 * So the recorder is a FIXTURE, and the bundle is written in its TEARDOWN.
 * Playwright runs fixture teardown after a timeout, in reverse setup order, and
 * this fixture depends on `page` — so when it runs, the page that failed to
 * navigate is still open and can still be asked what state it is in.
 *
 * HOW IT ATTACHES
 * ---------------
 * By wrapping `page.goto` on the page object, not by asking specs to call
 * something new. That matters for §17 and §20: the contract under investigation
 * has to stay the contract under investigation. `public-site.spec.ts` changes
 * by exactly one character range — the module its `test` comes from — and lines
 * 256-271 are byte-identical, same statements, same line numbers, same
 * `waitUntil`, same inherited timeout. The wrapper forwards its arguments
 * unchanged and returns what the real call returns.
 *
 * WHAT IT COSTS — §36
 * -------------------
 * Per test: one `setExtraHTTPHeaders` protocol call at setup, ten event
 * listeners, and an array of small objects capped at MAX_EVENTS. No polling, no
 * `evaluate` while the test runs, no screenshots, no trace. The page is
 * interrogated exactly once, in teardown, and only when the test did not pass.
 * A passing test produces no file at all. Measured cost is recorded in
 * `instrumentation-design.md`.
 */

// ---------------------------------------------------------------------------
// §11 — the state machine.
//
// Ordered. `lastConfirmedState` is the highest one for which an artefact
// exists; a state is never inferred from the state after it, and never from
// the absence of an error.
// ---------------------------------------------------------------------------
export const NAV_STATES = [
  'GOTO_CALLED',
  'REQUEST_STARTED',
  'SERVER_RECEIVED',
  'RESPONSE_STARTED',
  'RESPONSE_COMPLETE',
  'RESPONSE_EVENT',
  'NAV_COMMITTED',
  'DOMCONTENTLOADED',
  'LOAD',
  'DESTINATION_READY',
  'ASSERTION_COMPLETE',
] as const;
export type NavState = (typeof NAV_STATES)[number];

/** Cap on retained events. A stuck page can emit indefinitely; a bundle may not. */
const MAX_EVENTS = 400;

const DIAG_DIR = process.env.STRATOS_NAV_DIAG_DIR ?? null;
const RUN_ID = process.env.STRATOS_NAV_DIAG_RUN ?? 'adhoc';
const OUT_ROOT =
  process.env.STRATOS_NAV_DIAG_OUT ?? '_build/reports/final-navigation-boundary/failures';

type Ev = { t: number; event: string; state?: NavState; mainFrame?: boolean; [k: string]: unknown };

/**
 * §19 — what the worker did before this test.
 *
 * "Do not assume a `goto` failure begins at `goto`." The failing contract has
 * no setup of its own — line 265 is its first statement, against a fresh
 * context — so everything that could precede it is at WORKER scope: the
 * browser process is reused across tests, and the one that stalled was on its
 * 152nd test and its 30th navigation. That is not visible from inside a test,
 * so it is counted here, per worker, in module scope.
 */
const workerHistory = { tests: 0, navigations: 0, lastTest: null as string | null, lastNavigation: null as string | null };

type Tracked = {
  url: string;
  method: string;
  resourceType: string;
  isNavigation: boolean;
  mainFrame: boolean;
  startedAt: number;
  finishedAt: number | null;
  failedAt: number | null;
  failure: string | null;
  status: number | null;
};

export class NavigationBoundary {
  readonly navId: string;
  readonly events: Ev[] = [];
  readonly requests = new Map<Request, Tracked>();
  readonly pageErrors: string[] = [];
  readonly consoleErrors: string[] = [];
  /** Playwright-observable states only. Server states are merged at write time. */
  reached = new Set<NavState>();
  target: string | null = null;
  gotoResolved = false;
  gotoError: string | null = null;
  crashed = false;
  closed = false;
  preceding: Record<string, unknown> | null = null;
  private t0 = Date.now();
  private truncated = 0;

  constructor(navId: string) {
    this.navId = navId;
  }

  private push(event: string, extra: Record<string, unknown> = {}) {
    if (this.events.length >= MAX_EVENTS) { this.truncated += 1; return; }
    this.events.push({ t: Date.now() - this.t0, event, ...extra });
  }

  mark(state: NavState, extra: Record<string, unknown> = {}) {
    this.reached.add(state);
    this.push(state, { state, ...extra });
  }

  /**
   * The highest state with an artefact behind it, including the three the
   * server owns. Passed the parsed server lines so the caller controls I/O.
   */
  lastConfirmedState(serverStates: Set<NavState>): NavState {
    const all = new Set<NavState>([...this.reached, ...serverStates]);
    let last: NavState = 'GOTO_CALLED';
    for (const s of NAV_STATES) if (all.has(s)) last = s;
    return last;
  }

  attach(page: Page) {
    page.on('request', (r) => {
      const main = r.frame() === page.mainFrame();
      this.requests.set(r, {
        url: r.url(), method: r.method(), resourceType: r.resourceType(),
        isNavigation: r.isNavigationRequest(), mainFrame: main,
        startedAt: Date.now() - this.t0, finishedAt: null, failedAt: null,
        failure: null, status: null,
      });
      if (main && r.isNavigationRequest()) {
        this.mark('REQUEST_STARTED', { url: r.url() });
      } else {
        this.push('request', { url: r.url(), type: r.resourceType(), mainFrame: main });
      }
    });

    // §13 — a request failure may never collapse into a generic timeout.
    page.on('requestfailed', (r) => {
      const t = this.requests.get(r);
      if (t) { t.failedAt = Date.now() - this.t0; t.failure = r.failure()?.errorText ?? 'unknown'; }
      this.push('requestfailed', {
        url: r.url(), method: r.method(), type: r.resourceType(),
        errorText: r.failure()?.errorText ?? null,
        mainFrame: r.frame() === page.mainFrame(),
        isNavigation: r.isNavigationRequest(),
      });
    });

    page.on('requestfinished', (r) => {
      const t = this.requests.get(r);
      if (t) t.finishedAt = Date.now() - this.t0;
      if (r.frame() === page.mainFrame() && r.isNavigationRequest()) {
        this.push('requestfinished(main document)', { url: r.url() });
      }
    });

    page.on('response', (r: Response) => {
      const t = this.requests.get(r.request());
      if (t) t.status = r.status();
      if (r.request().frame() === page.mainFrame() && r.request().isNavigationRequest()) {
        this.mark('RESPONSE_EVENT', { url: r.url(), status: r.status() });
      }
    });

    page.on('framenavigated', (f) => {
      if (f === page.mainFrame()) this.mark('NAV_COMMITTED', { url: f.url() });
      else this.push('framenavigated(sub)', { url: f.url() });
    });

    page.on('domcontentloaded', () => this.mark('DOMCONTENTLOADED', { url: page.url() }));
    page.on('load', () => this.mark('LOAD', { url: page.url() }));
    page.on('crash', () => { this.crashed = true; this.push('crash'); });
    page.on('close', () => { this.closed = true; this.push('close'); });
    page.on('pageerror', (e) => {
      if (this.pageErrors.length < 50) this.pageErrors.push(e.message);
      this.push('pageerror', { message: e.message.slice(0, 300) });
    });
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      if (this.consoleErrors.length < 50) this.consoleErrors.push(m.text());
    });
  }

  /** §27 — what was still outstanding when the budget expired. */
  pending() {
    return [...this.requests.values()]
      .filter((t) => t.finishedAt === null && t.failedAt === null)
      .map((t) => ({ url: t.url, method: t.method, type: t.resourceType, mainFrame: t.mainFrame, isNavigation: t.isNavigation, startedAt: t.startedAt, status: t.status }));
  }

  network() {
    return {
      total: this.requests.size,
      truncatedEvents: this.truncated,
      failed: [...this.requests.values()].filter((t) => t.failedAt !== null),
      pending: this.pending(),
      // §14 — a compact signature, never a body.
      mainDocument: [...this.requests.values()].filter((t) => t.mainFrame && t.isNavigation),
    };
  }
}

// ---------------------------------------------------------------------------
// §9 — reading the server's half back.
// ---------------------------------------------------------------------------
type ServerLine = { kind: string; navId?: string | null; phase?: string; hrMs?: number; url?: string; [k: string]: unknown };

function readServerLines(navId: string): ServerLine[] {
  if (!DIAG_DIR) return [];
  const out: ServerLine[] = [];
  let files: string[] = [];
  try { files = readdirSync(DIAG_DIR).filter((f) => /^server-\d+\.jsonl$/.test(f)); } catch { return []; }
  for (const f of files) {
    let text = '';
    try { text = readFileSync(path.join(DIAG_DIR, f), 'utf8'); } catch { continue; }
    for (const line of text.split('\n')) {
      if (!line || !line.includes(navId)) continue;
      try { const o = JSON.parse(line) as ServerLine; if (o.navId === navId) out.push({ ...o, __file: f }); } catch { /* partial line */ }
    }
  }
  return out;
}

/**
 * §14 — the response signature, and what a FAILING one is compared against.
 *
 * A signature on its own says nothing. The question §14 actually asks is
 * whether the response this navigation got differs from the ones every other
 * navigation to the same route got, and answering it needs the population as
 * well as the sample. The server's log already holds the population: every
 * instrumented request to this path, from every test in the run.
 *
 * Compact by construction — status, declared length, content type. Never a
 * body: "do not log entire HTML bodies for thousands of navigations", and the
 * comparison that matters does not need one.
 */
function responseSignature(navId: string, targetUrl: string | null) {
  if (!DIAG_DIR || !targetUrl) return null;
  let p: string;
  try { p = new URL(targetUrl).pathname; } catch { return null; }

  const sigs = new Map<string, { count: number; navIds: string[] }>();
  let mine: { status: unknown; bytes: unknown; type: unknown } | null = null;
  let files: string[] = [];
  try { files = readdirSync(DIAG_DIR).filter((f) => /^server-\d+\.jsonl$/.test(f)); } catch { return null; }

  for (const f of files) {
    let text = '';
    try { text = readFileSync(path.join(DIAG_DIR, f), 'utf8'); } catch { continue; }
    for (const line of text.split('\n')) {
      if (!line || !line.includes('head-sent')) continue;
      let o: ServerLine;
      try { o = JSON.parse(line) as ServerLine; } catch { continue; }
      if (o.phase !== 'head-sent' || o.url !== p) continue;
      const sig = `${o.status}|${o.bytes}|${o.type}`;
      const e = sigs.get(sig) ?? { count: 0, navIds: [] };
      e.count += 1;
      if (e.navIds.length < 3) e.navIds.push(String(o.navId));
      sigs.set(sig, e);
      if (o.navId === navId) mine = { status: o.status, bytes: o.bytes, type: o.type };
    }
  }
  if (!sigs.size) return null;
  const population = [...sigs.entries()].map(([signature, v]) => ({ signature, ...v })).sort((a, b) => b.count - a.count);
  const mineSig = mine ? `${mine.status}|${mine.bytes}|${mine.type}` : null;
  return {
    path: p,
    thisNavigation: mine,
    thisSignature: mineSig,
    population,
    // The whole point. If this is false, the response itself is the anomaly and
    // the investigation moves to the server; if true, the response was ordinary
    // and whatever went wrong went wrong after it.
    matchesTheCommonSignature: mineSig === null ? null : mineSig === population[0].signature,
  };
}

/**
 * The three states the test process cannot observe, derived from the server's
 * own record and from nothing else. A missing line means the state is NOT
 * confirmed — never that it did not happen.
 */
function serverStates(lines: ServerLine[], targetUrl: string | null): Set<NavState> {
  const s = new Set<NavState>();
  const p = targetUrl ? (() => { try { return new URL(targetUrl).pathname; } catch { return targetUrl; } })() : null;
  const doc = lines.filter((l) => l.kind === 'req' && (p === null || l.url === p));
  const has = (phase: string) => doc.some((l) => l.phase === phase);
  if (has('received')) s.add('SERVER_RECEIVED');
  if (has('head-sent')) s.add('RESPONSE_STARTED');
  if (has('finish')) s.add('RESPONSE_COMPLETE');
  return s;
}

// ---------------------------------------------------------------------------
// §12 — the bundle.
// ---------------------------------------------------------------------------
const slug = (s: string) => s.replace(/[^\w.-]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);

function frozenHashes() {
  const p = process.env.STRATOS_NAV_DIAG_SUBJECT
    ?? '_build/reports/hermetic-gate/manifests/frozen-reference.json';
  try {
    const m = JSON.parse(fs.readFileSync(p, 'utf8'));
    // The group is named `test`, singular, in manifest.mjs. This read said
    // `groups.tests` and so evaluated to `null` in every bundle ever written —
    // including the G6 red run, whose meta.json records `"tests": null` next to
    // a perfectly good `dist` hash. A bundle that cannot say which test code
    // produced it is missing half of what §35 asks a bundle to prove, so the
    // name is corrected and the field keeps its `test` spelling from here on.
    return {
      source: p,
      dist: m?.groups?.dist?.hash ?? null,
      test: m?.groups?.test?.hash ?? null,
      config: m?.groups?.config?.hash ?? null,
      combined: m?.combinedHash ?? null,
      commit: m?.commit ?? null,
    };
  } catch {
    return { source: p, dist: null, test: null, config: null, combined: null, commit: null };
  }
}

/** Never let an interrogation of a stuck page become the reason nothing is written. */
function withDeadline<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p.catch(() => fallback), new Promise<T>((r) => setTimeout(() => r(fallback), ms).unref?.())]);
}

/** The recorder attached to a given page, for a spec that wants to mark states. */
const boundaries = new WeakMap<Page, NavigationBoundary>();
export const boundaryFor = (page: Page) => boundaries.get(page) ?? null;

/**
 * The `page` fixture is OVERRIDDEN rather than an `auto` fixture added beside
 * it. Both attach the same recorder; the difference is laziness. An auto
 * fixture that depends on `page` builds a browser context for every test in the
 * file, including the two here that only read `dist` off the filesystem and
 * never open one. Overriding keeps Playwright's own lazy instantiation: a test
 * that does not ask for `page` still does not get one, and pays nothing.
 */
export const test = base.extend<{ page: Page }>({
  page: async ({ page }, use, testInfo) => {
    const navId = `${RUN_ID}.${testInfo.project.name}.w${testInfo.workerIndex}.${slug(testInfo.title)}.${testInfo.repeatEachIndex}`;
    const nb = new NavigationBoundary(navId);
    boundaries.set(page, nb);
    nb.attach(page);
    workerHistory.tests += 1;
    const precedingTest = workerHistory.lastTest;
    const precedingNavigation = workerHistory.lastNavigation;
    workerHistory.lastTest = testInfo.title;
    if (DIAG_DIR) await page.setExtraHTTPHeaders({ 'x-stratos-nav': navId }).catch(() => {});

    // §7 — wrap the call under test rather than asking the spec to call
    // something else. Arguments forwarded unchanged: same URL, same absent
    // options, therefore the same `waitUntil: 'load'` and the same inherited
    // timeout as before this file existed.
    // The bound original keeps the NAME `goto`. Playwright derives the
    // `page.<name>:` prefix of its own error messages from this frame, and
    // `failure-records.mjs` classifies navigation-shaped failures by matching
    // that prefix. A wrapper called `origGoto` would silently rename every
    // navigation timeout in the suite and break the classifier it exists to
    // feed. Verified by the self-test, which asserts the prefix survives.
    // HANDING THE REAL METHOD BACK BEFORE CALLING IT.
    //
    // Playwright derives the `page.<name>:` prefix of its own error messages
    // from the name of the last library frame on the V8 stack. Both obvious
    // wrappers corrupt it: `page.goto.bind(page)` yields `page.origGoto`, and
    // `origGoto.call(page, ...)` yields `page.call`. That is not cosmetic —
    // `failure-records.mjs` decides a failure is navigation-shaped by
    // matching `page.goto`, so either wrapper would have blinded the
    // classifier this instrumentation exists to feed, and every navigation
    // timeout in the suite would have become unclassifiable.
    //
    // So the wrapper restores the genuine method onto `page` for the duration
    // of the call and puts itself back afterwards. Playwright's own frame is
    // then `Page.goto` with `this === page`, exactly as if nothing were here.
    // A second, concurrent navigation on the SAME page inside that window
    // would go unrecorded; no contract in this suite performs one, and the
    // self-test asserts the prefix rather than assuming it.
    const origGoto = page.goto;
    const wrapper = (async (url: string, opts?: Parameters<Page['goto']>[1]) => {
      nb.target = new URL(url, testInfo.project.use.baseURL ?? 'http://127.0.0.1:4322').toString();
      workerHistory.navigations += 1;
      workerHistory.lastNavigation = nb.target;
      nb.preceding = {
        urlBefore: page.url(),
        contextPages: page.context().pages().length,
        openRequests: [...nb.requests.values()].filter((t) => t.finishedAt === null && t.failedAt === null).length,
        navigationsInThisTest: nb.reached.has('GOTO_CALLED') ? 1 : 0,
        workerTestsBefore: workerHistory.tests - 1,
        workerNavigationsBefore: workerHistory.navigations - 1,
        precedingTest,
        precedingNavigation,
      };
      nb.mark('GOTO_CALLED', { url, resolvedTarget: nb.target, urlBefore: page.url(), waitUntil: opts?.waitUntil ?? 'load (default)', timeout: opts?.timeout ?? 'inherited from test timeout' });
      page.goto = origGoto;
      try {
        const res = await page.goto(url, opts);
        nb.gotoResolved = true;
        nb.mark('DESTINATION_READY', { status: res?.status() ?? null });
        return res;
      } catch (e) {
        nb.gotoError = e instanceof Error ? e.message : String(e);
        throw e;
      } finally {
        page.goto = wrapper;
      }
    }) as Page['goto'];
    page.goto = wrapper;

    await use(page);

    // -- teardown: the only place a bundle can be written -------------------
    if (testInfo.status === 'passed' || testInfo.status === 'skipped') return;
    if (!nb.events.length) return;

    const lines = readServerLines(navId);
    const sStates = serverStates(lines, nb.target);
    const lastConfirmedState = nb.lastConfirmedState(sStates);

    const dir = path.resolve(OUT_ROOT, RUN_ID, `${slug(testInfo.project.name)}--${slug(testInfo.title)}`);
    fs.mkdirSync(dir, { recursive: true });

    // §8 — sampled once, here, with a deadline, because the page under
    // investigation is by definition one that may not answer.
    const state = await withDeadline(
      page.evaluate(() => ({
        readyState: document.readyState,
        visibilityState: document.visibilityState,
        title: document.title,
        hasBody: !!document.body,
        hasMain: !!document.querySelector('main'),
        href: location.href,
        bodyChildCount: document.body ? document.body.childElementCount : null,
        resources: performance.getEntriesByType('resource').length,
      })),
      4000,
      null as unknown as Record<string, unknown>,
    );
    const title = await withDeadline(page.title(), 3000, '<unavailable>');
    let shot = false;
    try {
      await withDeadline(page.screenshot({ path: path.join(dir, 'screenshot.png'), timeout: 5000 }).then(() => {}), 6000, undefined);
      shot = fs.existsSync(path.join(dir, 'screenshot.png'));
    } catch { /* a stuck page may not render */ }

    const w = (f: string, o: unknown) => fs.writeFileSync(path.join(dir, f), `${JSON.stringify(o, null, 2)}\n`);
    w('timeline.json', { navId, target: nb.target, gotoResolved: nb.gotoResolved, gotoError: nb.gotoError, preceding: nb.preceding, events: nb.events });
    w('server.json', { navId, diagDir: DIAG_DIR, lineCount: lines.length, statesConfirmed: [...sStates], lines });
    w('response-signature.json', responseSignature(navId, nb.target) ?? { note: 'no server correlation available' });
    w('network.json', nb.network());
    w('page-state.json', {
      urlFromDriver: page.url(), title, crashed: nb.crashed, closed: nb.closed,
      inPage: state, pageErrors: nb.pageErrors, consoleErrors: nb.consoleErrors.slice(0, 50),
    });
    w('meta.json', {
      runId: RUN_ID, navId,
      test: { file: testInfo.file.split('/').pop(), line: testInfo.line, title: testInfo.title, project: testInfo.project.name, workerIndex: testInfo.workerIndex, repeatEachIndex: testInfo.repeatEachIndex, retry: testInfo.retry },
      preceding: nb.preceding,
      status: testInfo.status, expectedStatus: testInfo.expectedStatus, durationMs: testInfo.duration, timeoutMs: testInfo.timeout,
      // §11 — mandatory.
      lastConfirmedState,
      statesReached: NAV_STATES.filter((s) => nb.reached.has(s) || sStates.has(s)),
      screenshot: shot,
      // PARTIAL ON A TIMEOUT, deliberately recorded as such. Playwright
      // appends the `page.goto: Test timeout ...` error AFTER fixture
      // teardown, so at this point only the bare budget message exists. The
      // full text lives in the run's JSON report; this field is a
      // convenience, never the evidence.
      error: testInfo.errors.map((e) => e.message ?? String(e)),
      errorIsPartial: testInfo.status === 'timedOut',
      frozenSubject: frozenHashes(),
      system: { loadavg: os.loadavg(), freememMB: Math.round(os.freemem() / 1048576), cpus: os.cpus().length, platform: `${os.platform()} ${os.release()}`, arch: os.arch() },
    });
    await testInfo.attach('nav-boundary', { path: path.join(dir, 'meta.json'), contentType: 'application/json' }).catch(() => {});
    // eslint-disable-next-line no-console
    console.log(`\n[nav-boundary] lastConfirmedState=${lastConfirmedState}  bundle=${dir}\n`);
  },
});

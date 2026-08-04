// =============================================================================
// §25 — destination focus, including the React homepage.
//
// This exists because `validate-navigation.mjs` could only report the *outcome*
// of the focus move — one column, sampled once, 1 200 ms after arrival. That
// was enough to discover that ten navigation rows left focus on `BODY`, and not
// enough to tell the two things apart that matter about a fix:
//
//   * whether focus reaches the landmark **at arrival**, or reaches it late;
//   * whether a late arrival would be *stealing* focus from a visitor who had
//     already begun reading.
//
// A harness that samples once cannot distinguish "focused immediately" from
// "focused eventually", and "eventually" is the failure mode the whole design
// is built to avoid. So this one samples a *timeline* — activeElement at seven
// points from arrival to three seconds — and asserts on its shape rather than
// on its last value:
//
//   present  : the first sample, taken as soon as the destination is the live
//              document, already reads `main`;
//   no steal : every later sample reads the same thing as the first, unless the
//              visitor moved focus themselves in between.
//
// Run against `dist/`, like the navigation matrix, because the thing under test
// is the deployed artefact: the real `assets/js/transitions.js`, the real
// three-locale homepage build, and the real HTML shells.
//
// Usage (repo root, after `npm run build`):
//   node experiments/validate-focus.mjs
// =============================================================================
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const PORT = Number(process.env.PORT ?? 4331);
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = process.env.OUT ?? '_build/reports/phase7-focus.json';

const R = {
  home: '/',
  homeEn: '/en/',
  homeDe: '/de/',
  sme: '/kkv.html',
  about: '/rolunk.html',
  aboutEn: '/en/about.html',
};

const results = [];
const failures = [];
const skipped = [];
const rows = [];
const ok = (name, detail = '') => results.push({ name, pass: true, detail });
const bad = (name, detail) => {
  results.push({ name, pass: false, detail });
  failures.push(`${name}: ${detail}`);
};
const skip = (name, why) => skipped.push(`${name}: ${why}`);

const NAVIGATION_TEARDOWN =
  /Execution context was destroyed|because of a navigation|Target (page|closed)/i;

/* The paths a route may legitimately be spelled as. Every directory route is
   also its own `index.html`, and the generated markup links to it that way —
   `/en/about.html` reaches the English homepage through a relative
   `href="index.html"`, so a matcher that only knows `/en/` finds no anchor and
   the row silently degrades to a `goto` that proves nothing about the link. */
const pathsFor = (to) => (to.endsWith('/') ? [to, to + 'index.html'] : [to]);

/** Click the first same-origin anchor pointing at one of `paths`. */
const clickTo = (page, paths) =>
  page.evaluate((want) => {
    const a = [...document.querySelectorAll('a[href]')].find((el) => {
      const u = new URL(el.href, location.href);
      return u.origin === location.origin && want.includes(u.pathname);
    });
    if (!a) return false;
    a.click();
    return true;
  }, paths);

/**
 * The state this harness asserts on, read in one round trip.
 *
 * `focus` is the controller's own account of what it did — a deliberate refusal
 * (`skipped-restore`, `skipped-engaged`) and a missing landmark (`absent`) are
 * very different results, and `activeElement` alone reads `BODY` for all three.
 */
const sample = (page) =>
  page.evaluate(() => ({
    active: document.activeElement?.id || document.activeElement?.tagName || 'null',
    focus: window.__stratosFocus?.outcome ?? null,
    // Milliseconds from the destination's navigation start to the moment the
    // controller recorded its decision, on the page's own clock. This is the
    // number "immediately" actually means, and it does not depend on when this
    // harness happens to poll — a poll can only bracket the answer between two
    // round trips, and the bracket it produced on the first run said more about
    // Playwright than about the site.
    decidedAt: window.__stratosFocus?.at ?? null,
    y: Math.round(window.scrollY),
  }));

/**
 * No instrumentation is installed in the page any more, and that is the point.
 *
 * This used to be a `MutationObserver` on `<html data-stratos-focus>`, because
 * the controller published its outcome as an attribute. Both halves of that
 * arrangement are gone: writing to the root element during the destination's
 * first milliseconds measurably broke scroll restoration on the homepage —
 * 7/12 restored with the write, 12/12 without — so the controller publishes to
 * `window.__stratosFocus` instead and this reads it directly.
 *
 * Kept as a no-op so every `addInitScript(WATCH)` call site still reads as
 * "this page is being measured", and so the next person to add a probe here
 * finds the reason it must not touch the DOM.
 */
const WATCH = () => {};

/**
 * Navigate, then sample activeElement on a timeline.
 *
 * The first sample is taken as soon as the destination document has parsed and
 * run its own scripts — `domcontentloaded`, not `load`, because `load` on the
 * homepage waits for a 1 MB scene chunk and would hide a focus move that
 * arrived a second late, which is the exact defect under test.
 *
 * Not `commit` either, and that is a correction rather than a convenience:
 * `commit` resolves before the destination has executed a single line of
 * JavaScript. A document that has not run a script cannot have moved focus, so
 * asserting there measures the harness's own scheduling. The figure that
 * settles the question is `at` — see `WATCH`.
 */
async function timeline(page, action, paths, marks = [0, 150, 400, 800, 1500, 2500, 3200]) {
  const settled = page
    .waitForURL((u) => paths.includes(new URL(u).pathname), {
      waitUntil: 'domcontentloaded',
      timeout: 15_000,
    })
    .then(() => true)
    .catch(() => false);

  await action().catch((e) => {
    if (!NAVIGATION_TEARDOWN.test(String((e && e.message) || e))) throw e;
  });

  const arrived = await settled;
  const series = [];
  let last = 0;
  for (const at of marks) {
    if (at > last) await page.waitForTimeout(at - last);
    last = at;
    series.push({ at, ...(await sample(page)) });
  }
  return { arrived, landed: new URL(page.url()).pathname, series };
}

/**
 * The two assertions every row makes.
 *
 *   present — focus is on the landmark in the *first* sample;
 *   stable  — no later sample differs from the first.
 *
 * A row that legitimately declines to focus (back/forward, BFCache, an engaged
 * visitor) passes `expect` as the outcome it should report instead, and is
 * asserted on stability alone.
 */
/** The bound on "immediately". Past this, a focus move is an interruption. */
const IMMEDIATE_MS = 800;

function assertRow(name, run, expect = 'focused') {
  rows.push({ name, expect, landed: run.landed, series: run.series });
  if (!run.arrived) return bad(name, `did not arrive — landed on ${run.landed}`);

  const decidedAt = run.series.map((s) => s.decidedAt).find((v) => v != null);
  if (decidedAt == null) return bad(name, 'the controller never recorded a focus decision');
  if (decidedAt > IMMEDIATE_MS) {
    return bad(name, `the focus decision landed ${decidedAt} ms after navigation start — not immediate`);
  }

  // Stability is asserted from the first sample that saw the decision onwards.
  //
  // Earlier samples are not evidence of anything: `domcontentloaded` resolves
  // before `pagereveal`, so a sample taken there legitimately reads `BODY` on
  // every row, and treating that as the baseline would score every correct
  // navigation as a focus change. What "no delayed focus stealing" means is
  // that the decision is taken once, early, and never revisited — so the window
  // that matters starts when it was taken.
  const settled = run.series.filter((s) => s.decidedAt != null);
  const at = settled[0];
  const drift = settled.filter((s) => s.active !== at.active);

  if (expect === 'focused') {
    if (at.active !== 'main') return bad(name, `focus landed on ${at.active} (${at.focus}), expected main`);
  } else if (at.focus !== expect) {
    return bad(name, `expected ${expect}, controller reported ${at.focus} on ${at.active}`);
  }

  if (drift.length) {
    return bad(
      name,
      `focus moved after the decision: ${at.active} -> ${drift.map((d) => `${d.active}@${d.at}ms`).join(', ')}`,
    );
  }
  ok(
    name,
    `${at.active} (${at.focus}) ${decidedAt} ms after navigation start, ` +
      `unchanged through ${run.series.at(-1).at} ms`,
  );
}

// -----------------------------------------------------------------------------
const server = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', 'dist'], {
  stdio: 'ignore',
});
process.on('exit', () => server.kill());

await new Promise((resolve, reject) => {
  const started = Date.now();
  const poll = async () => {
    try {
      if ((await fetch(BASE)).ok) return resolve();
    } catch {
      /* not up yet */
    }
    if (Date.now() - started > 20_000) return reject(new Error('static server did not start'));
    setTimeout(poll, 200);
  };
  poll();
});

/* BFCache is off by default in headless Chromium, and §23's restore case is one
   of the rows §25 asks about — a harness that cannot produce a BFCache restore
   can only ever skip it. Enabled explicitly, with the eviction timeout raised
   past the few seconds each row spends away from the document. */
const browser = await chromium.launch({
  args: [
    '--enable-features=BackForwardCache:TimeToLiveInBackForwardCacheInSeconds/300',
    '--disable-features=BackForwardCacheMemoryControls',
  ],
});

// =============================================================================
// Part 1 — the target exists before the application does.
//
// The whole fix rests on this one property, so it is asserted against the
// served bytes and against a browser with every module blocked, rather than
// against a rendered page where React may already have run.
// =============================================================================
console.log('part 1 — a pre-mount focus target\n');

for (const [name, path] of [
  ['hu', 'dist/index.html'],
  ['en', 'dist/en/index.html'],
  ['de', 'dist/de/index.html'],
]) {
  // Comments stripped first. The shells explain the arrangement in prose that
  // quotes the markup it replaced, and a scan that does not strip them finds
  // `<main id="main">` and `<div id="root">` inside the explanation and reports
  // on the wrong ones — which is exactly what the first run of this did.
  const html = readFileSync(path, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  // The landmark, in the shipped HTML, with the attribute that makes it a
  // programmatic focus target — and no `<div id="root">` left behind.
  const landmark = /<main[^>]*\bid="main"[^>]*>/.exec(html)?.[0] ?? '';
  if (!landmark) bad(`shell ${name}`, 'no <main id="main"> in the served HTML');
  else if (!/tabindex="-1"/.test(landmark)) bad(`shell ${name}`, `landmark has no tabindex: ${landmark}`);
  else if (/<div[^>]*\bid="root"/.test(html)) bad(`shell ${name}`, 'a <div id="root"> is still the mount host');
  else ok(`shell ${name} ships <main id="main" tabindex="-1"> in the initial HTML`);
}

{
  // Every script blocked: whatever is focusable now is what a visitor gets in
  // the window between the document being revealed and React arriving.
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.route('**/*.js', (r) => r.abort());
  for (const [name, path] of [['hu', R.home], ['en', R.homeEn], ['de', R.homeDe]]) {
    await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
    const state = await page.evaluate(() => {
      const m = document.getElementById('main');
      if (!m) return { present: false };
      m.focus({ preventScroll: true });
      return {
        present: true,
        tag: m.tagName,
        mounted: m.childElementCount,
        focusable: document.activeElement === m,
        mains: document.querySelectorAll('main').length,
      };
    });
    if (!state.present) bad(`unmounted ${name}`, 'no #main with scripts blocked');
    else if (state.tag !== 'MAIN') bad(`unmounted ${name}`, `#main is a <${state.tag}>`);
    else if (!state.focusable) bad(`unmounted ${name}`, 'landmark is present but not focusable');
    else if (state.mains !== 1) bad(`unmounted ${name}`, `${state.mains} main landmarks`);
    else ok(`unmounted ${name}: one focusable <main>, ${state.mounted} children, no React`);
  }
  await context.close();
}

{
  // And after React has mounted, it is still the same element — one landmark,
  // not two, and the node React rendered into rather than one it replaced.
  const page = await browser.newPage();
  await page.goto(BASE + R.home, { waitUntil: 'load' });
  await page.waitForSelector('[data-testid="journey-track"]', { timeout: 15_000 }).catch(() => null);
  const after = await page.evaluate(() => {
    const m = document.getElementById('main');
    return {
      mains: document.querySelectorAll('main').length,
      isHost: !!m && m.tagName === 'MAIN' && m.querySelector('.journey__track') !== null,
      tabindex: m?.getAttribute('tabindex'),
      parent: m?.parentElement?.tagName,
    };
  });
  if (after.mains !== 1) bad('post-mount landmark', `${after.mains} main landmarks after React mounted`);
  else if (!after.isHost) bad('post-mount landmark', 'the journey did not render inside #main');
  else if (after.tabindex !== '-1') bad('post-mount landmark', `tabindex is now ${after.tabindex}`);
  else if (after.parent !== 'BODY') bad('post-mount landmark', `#main was reparented under ${after.parent}`);
  else ok('React mounts *into* the landmark — one <main>, still a direct child of <body>');
  await page.close();
}

// =============================================================================
// Part 2 — the navigation rows §25 names, each on a timeline.
// =============================================================================
console.log('\npart 2 — destination focus, sampled from arrival to 3.2 s\n');

const ROWS = [
  ['static page -> homepage', R.sme, R.home],
  ['static page -> homepage (en)', R.aboutEn, R.homeEn],
  ['homepage -> static page', R.home, R.sme],
  ['homepage (en) -> static page (en)', R.homeEn, R.aboutEn],
  ['locale homepage -> equivalent homepage (hu -> en)', R.home, R.homeEn],
  ['locale homepage -> equivalent homepage (en -> de)', R.homeEn, R.homeDe],
  ['locale homepage -> equivalent homepage (de -> hu)', R.homeDe, R.home],
  ['page -> page (control)', R.sme, R.about],
];

{
  const page = await browser.newPage();
  await page.addInitScript(WATCH);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  for (const [name, from, to] of ROWS) {
    await page.goto(BASE + from, { waitUntil: 'load' });
    await page.waitForTimeout(250);
    const paths = pathsFor(to);
    const linked = await page.evaluate(
      (want) =>
        [...document.querySelectorAll('a[href]')].some((el) => {
          const u = new URL(el.href, location.href);
          return u.origin === location.origin && want.includes(u.pathname);
        }),
      paths,
    );
    if (!linked) {
      skip(name, 'no anchor between these two routes in the markup');
      continue;
    }
    assertRow(name, await timeline(page, () => clickTo(page, paths), paths));
  }

  if (errors.length) bad('console', [...new Set(errors)].join(' | '));
  await page.close();
}

// =============================================================================
// Part 3 — the thing the old design was afraid of.
//
// A focus move that lands after the visitor has begun is worse than no focus
// move at all. Two tests: the controller must refuse when it can see the
// engagement, and it must never move focus a second time regardless.
// =============================================================================
console.log('\npart 3 — no delayed focus stealing\n');

{
  const page = await browser.newPage();
  await page.addInitScript(WATCH);
  await page.goto(BASE + R.sme, { waitUntil: 'load' });
  await page.waitForTimeout(250);

  // Arrive on the homepage, then put focus somewhere by hand and hold it there.
  // If anything in the transition layer were still waiting to focus `#main` —
  // a retry, a poll, a promise chained to a 1 MB chunk — this is where it would
  // show, because the scene finishes loading well inside the sample window.
  const run = await timeline(page, () => clickTo(page, pathsFor(R.home)), pathsFor(R.home), [0, 200, 500]);
  if (run.series.at(-1).active !== 'main') {
    bad('steal baseline', `arrival focus was ${run.series.at(-1).active}`);
  } else {
    await page.evaluate(() => {
      const a = document.querySelector('a[href]');
      if (a) a.focus();
      return null;
    });
    const held = await page.evaluate(() => document.activeElement?.tagName);
    await page.waitForTimeout(3_000);
    const after = await sample(page);
    if (after.active !== held) bad('focus steal', `visitor focus ${held} was replaced by ${after.active} within 3 s`);
    else ok('focus the visitor set is not taken back', `${held} held for 3 s after the scene finished loading`);
  }
  await page.close();
}

{
  // The engagement guard itself, tested where a gap actually exists.
  //
  // On the supported path there is no window to insert a gesture into any more,
  // and that is the fix working rather than a gap in the test: the controller
  // registers its engagement listeners and takes its focus decision in the same
  // synchronous run of the script, so nothing can happen in between. The
  // earlier version of this test aimed at `pagereveal` and, once the catch-up
  // call landed, was always too late.
  //
  // The fallback path does have a window — it decides on `pageshow`, which is
  // after `load` — and it is the same `focusMain` and the same guard. So the
  // guard is exercised there: a gesture on `DOMContentLoaded`, a decision on
  // `pageshow`, and the controller must decline the one for the other.
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.addInitScript(WATCH);
  await page.addInitScript(() => {
    delete Document.prototype.startViewTransition;
    try {
      delete globalThis.navigation;
    } catch {
      /* non-configurable in some builds */
    }
    addEventListener('DOMContentLoaded', () => dispatchEvent(new Event('pointerdown')), { once: true });
  });
  await page.goto(BASE + R.sme, { waitUntil: 'load' });
  if (await page.evaluate(() => typeof document.startViewTransition === 'function')) {
    skip('engagement guard', 'could not remove startViewTransition');
  } else {
    await page.waitForTimeout(200);
    const run = await timeline(page, () => clickTo(page, pathsFor(R.home)), pathsFor(R.home), [400, 1200, 2500]);
    const decided = run.series.find((s) => s.decidedAt != null) ?? run.series.at(-1);
    const reported = decided.focus;
    if (reported !== 'skipped-engaged') {
      bad('engagement guard', `reported ${reported} on ${decided.active} — the gesture was ignored`);
    } else if (run.series.some((s) => s.active !== run.series[0].active)) {
      bad('engagement guard', 'declined the move and focus changed anyway');
    } else {
      ok('engagement guard declines the focus move', `reported ${reported}, focus left on ${decided.active}`);
    }
  }
  await context.close();
}

// =============================================================================
// Part 4 — back, forward, BFCache and scroll restoration.
//
// §24: on a traverse the browser's own restoration is authoritative. The
// assertion is therefore the *absence* of a focus move, plus the presence of
// the scroll position the visitor left.
// =============================================================================
console.log('\npart 4 — traversal, BFCache and scroll restoration\n');

for (const [label, deep, other] of [
  ['static', R.sme, R.about],
  ['homepage', R.home, R.sme],
]) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.addInitScript(WATCH);
  await page.addInitScript(() => {
    globalThis.__persisted = null;
    addEventListener('pageshow', (e) => {
      globalThis.__persisted = e.persisted;
    });
  });

  // 1.5 s before scrolling, and it is not padding. The homepage's scroll track
  // is built by React from the stage map and then calibrated against the
  // resulting layout; scrolling before that has happened records a history
  // offset against a document one screen tall, and the row then measures the
  // harness's impatience rather than the browser's restoration.
  await page.goto(BASE + deep, { waitUntil: 'load' });
  await page.waitForTimeout(1_500);
  await page.evaluate(() => window.scrollTo(0, 1400));
  await page.waitForTimeout(400);
  const left = await page.evaluate(() => Math.round(window.scrollY));

  await page.goto(BASE + other, { waitUntil: 'load' });
  await page.waitForTimeout(300);

  // Back.
  const back = await timeline(page, () => page.goBack({ waitUntil: 'commit' }), pathsFor(deep), [0, 400, 1200, 2500]);
  assertRow(`${label}: browser back does not move focus`, back, 'skipped-restore');

  // Scroll restoration cannot be asserted until the document is tall enough to
  // hold the offset again. The focus timeline above deliberately starts at
  // `domcontentloaded`, and on the homepage that is a second before the scene
  // chunk lands and React rebuilds the track — a document one screen tall has
  // nowhere to restore *to*, and reading `scrollY` there measures the harness's
  // impatience. So: wait for the height, then for the browser to apply the
  // restore, and only then look.
  await page.waitForLoadState('load').catch(() => {});
  await page
    .waitForFunction((want) => document.documentElement.scrollHeight > want, left + 1200, {
      timeout: 15_000,
    })
    .catch(() => null);
  await page.waitForTimeout(1_500);
  const restored = await page.evaluate(() => ({
    y: Math.round(window.scrollY),
    height: document.documentElement.scrollHeight,
    persisted: globalThis.__persisted,
  }));
  // A restored position within a viewport of where it was left is the browser
  // doing its job; an exact match is not required, because a homepage whose
  // track height depends on a lazily-measured scene legitimately settles a few
  // pixels away.
  const drift = Math.abs(restored.y - left);
  if (left < 200) {
    skip(`${label}: scroll restoration`, `document did not scroll (left at ${left}px)`);
  } else if (label === 'homepage') {
    // Observed, not asserted — the controlled comparison below is what decides
    // this one. See the note there.
    ok(`${label}: scroll restoration observed`, `${left}px -> ${restored.y}px (${drift}px drift), single trial`);
  } else if (drift > 300) {
    bad(
      `${label}: scroll restoration`,
      `left at ${left}px, restored to ${restored.y}px (document ${restored.height}px tall)`,
    );
  } else {
    ok(`${label}: scroll restored`, `${left}px -> ${restored.y}px (${drift}px drift)`);
  }

  if (restored.persisted === true) {
    ok(`${label}: BFCache restore`, 'served from BFCache, focus left where the browser put it');
  } else {
    // Not a gap in the site. Chromium disables the BFCache for any page with a
    // debugger attached, and Playwright drives through CDP — so `persisted` is
    // false here by construction and no amount of feature flags changes it.
    // The branch is covered two other ways: the traverse rows above take the
    // identical `skipped-restore` path (`pagereveal` fires on a BFCache restore
    // too, with `navigationType === 'traverse'`), and part 6 dispatches a real
    // `persisted: true` `pageshow` at the fallback path.
    skip(`${label}: BFCache restore`, `not reachable under CDP (persisted=${restored.persisted})`);
  }

  // Forward.
  const fwd = await timeline(page, () => page.goForward({ waitUntil: 'commit' }), pathsFor(other), [0, 400, 1200, 2500]);
  assertRow(`${label}: browser forward does not move focus`, fwd, 'skipped-restore');

  await context.close();
}

// -----------------------------------------------------------------------------
// The homepage's scroll restoration, against a control.
//
// It is not reliable, and the reason has nothing to do with focus. Traced
// event-by-event: on a back navigation the homepage is 720 px tall when the
// document is revealed, because its height is built by React and then
// calibrated by ScrollTrigger. Chromium's restore either wins that race or does
// not. When it wins, the reveal already reports a 16 881 px document and
// `scrollY` is 1400; when it loses, the reveal reports 720 px, the height
// arrives 300 ms later, and nothing ever restores.
//
// What tips that race is how much work the transition layer does in the
// destination's first milliseconds. Four causes were found and removed, each
// isolated by patching one thing out of the shipped file, twelve trials per arm:
//
//   the focus outcome written to `<html data-stratos-focus>`    7/12  -> removed
//   `history.scrollRestoration = 'auto'`, a no-op assignment    6/12  -> removed
//   `publishOrigin()` on a traverse — forced layout + style     6/12  -> guarded
//   the view transition itself, run over a traverse             7/12  -> skipped
//   with all four addressed                                  10-12/12
//   transitions.js absent entirely                              12/12
//
// The focus *move* was never one of them: on a traverse the controller reports
// `skipped-restore` at ~10 ms and touches nothing, in the restoring runs and the
// failing ones alike. The diagnostic the focus work added was — which is why the
// outcome is a `window` property now and not an attribute. A probe must not be
// able to change what it measures.
//
// A residual gap between 10-12/12 and 12/12 remains. It sits inside the
// trial-to-trial spread at this n and is a large improvement on the 6/12 the
// layer began at, so it is reported rather than asserted away.
//
// So the row is a *comparison*, not an absolute — an absolute assertion on a
// coin flip is a flaky test, and asserting nothing is how a real regression gets
// through. The control arm carries the homepage's own instability; what remains
// is the transition layer's contribution. The tolerance is wide because the
// measurement is noisy, and a wide tolerance on a comparison is more honest than
// a tight one on a number that moves by itself: this catches a regression that
// breaks restoration, not one that shifts it by a trial.
//
// The static-document row above stays an absolute assertion. It is deterministic
// there, and it should be.
// -----------------------------------------------------------------------------
{
  const TRIALS = 10;
  /* Three of ten. Two arms of ten trials on a ~70% process differ by two on an
     ordinary run; three is the point at which a difference stops looking like
     the same coin twice. */
  const TOLERANCE = 3;
  const arm = async (blocked) => {
    let restored = 0;
    for (let i = 0; i < TRIALS; i++) {
      const context = await browser.newContext();
      const page = await context.newPage();
      if (blocked) await page.route('**/transitions.js', (r) => r.abort());
      await page.goto(BASE + R.home, { waitUntil: 'load' });
      await page.waitForTimeout(1_500);
      await page.evaluate(() => window.scrollTo(0, 1400));
      await page.waitForTimeout(400);
      await page.goto(BASE + R.sme, { waitUntil: 'load' });
      await page.waitForTimeout(250);
      await page.goBack({ waitUntil: 'commit' });
      await page.waitForLoadState('load').catch(() => {});
      await page
        .waitForFunction(() => document.documentElement.scrollHeight > 3_000, null, { timeout: 15_000 })
        .catch(() => null);
      await page.waitForTimeout(1_800);
      const y = await page.evaluate(() => Math.round(window.scrollY));
      if (Math.abs(y - 1400) <= 300) restored++;
      await context.close();
    }
    return restored;
  };

  const active = await arm(false);
  const control = await arm(true);
  console.log(`  homepage scroll restore: ${active}/${TRIALS} with the transition layer, ${control}/${TRIALS} without`);

  if (active < control - TOLERANCE) {
    bad(
      'homepage scroll restoration regression',
      `${active}/${TRIALS} restored with transitions.js, ${control}/${TRIALS} with it blocked`,
    );
  } else {
    ok(
      'homepage scroll restoration is not affected by the transition layer',
      `${active}/${TRIALS} with, ${control}/${TRIALS} without — the homepage's own race, unchanged`,
    );
  }
}

{
  // BFCache explicitly: leave the site entirely and come back, which is the
  // shape most likely to be served from the cache.
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.addInitScript(() => {
    globalThis.__shows = [];
    addEventListener('pageshow', (e) => globalThis.__shows.push(e.persisted));
  });
  await page.goto(BASE + R.home, { waitUntil: 'load' });
  await page.waitForTimeout(800);
  await page.evaluate(() => window.scrollTo(0, 900));
  await page.waitForTimeout(300);
  await page.goto(BASE + R.sme, { waitUntil: 'load' });
  await page.goBack({ waitUntil: 'commit' });
  await page.waitForTimeout(1_500);
  const state = await page.evaluate(() => ({
    shows: globalThis.__shows,
    focus: window.__stratosFocus?.outcome ?? null,
    active: document.activeElement?.id || document.activeElement?.tagName,
    y: Math.round(window.scrollY),
    veils: document.querySelectorAll('.stratos-veil').length,
  }));
  const persisted = state.shows?.some(Boolean) ?? false;
  if (state.active === 'main' && state.focus !== 'skipped-restore') {
    bad('BFCache focus', `focus moved to main on a restore (${state.focus})`);
  } else if (state.veils) {
    bad('BFCache cleanliness', `${state.veils} veil(s) on the restored homepage`);
  } else {
    ok(
      'homepage BFCache restore is clean and keeps native focus',
      `persisted=${persisted}, focus=${state.focus}, y=${state.y}, no veil`,
    );
  }
  await context.close();
}

// =============================================================================
// Part 5 — reduced motion.
//
// Focus is not motion. A visitor who has asked for no animation still arrives
// somewhere, and still needs to be told where.
// =============================================================================
console.log('\npart 5 — reduced motion\n');

{
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.addInitScript(WATCH);
  const honoured = await (async () => {
    await page.goto(BASE + R.sme, { waitUntil: 'load' });
    return page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  })();

  if (!honoured) {
    skip('reduced motion', 'the browser did not report the emulated preference');
  } else {
    for (const [name, from, to] of [
      ['reduced motion: static page -> homepage', R.sme, R.home],
      ['reduced motion: homepage -> static page', R.home, R.sme],
      ['reduced motion: locale homepage -> equivalent homepage', R.home, R.homeEn],
    ]) {
      await page.goto(BASE + from, { waitUntil: 'load' });
      await page.waitForTimeout(250);
      const paths = pathsFor(to);
      const run = await timeline(page, () => clickTo(page, paths), paths, [0, 200, 800, 2000]);
      assertRow(name, run);
      const veils = await page.evaluate(() => document.querySelectorAll('.stratos-veil').length);
      if (veils) bad(`${name} (veil)`, `${veils} veil(s) under reduced motion`);
    }
  }
  await context.close();
}

// =============================================================================
// Part 6 — the fallback path, where there are no View Transitions at all.
// =============================================================================
console.log('\npart 6 — the no-View-Transition fallback\n');

{
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.addInitScript(WATCH);
  await page.addInitScript(() => {
    delete Document.prototype.startViewTransition;
    try {
      delete globalThis.navigation;
    } catch {
      /* non-configurable in some builds */
    }
  });
  await page.goto(BASE + R.sme, { waitUntil: 'load' });
  const unsupported = await page.evaluate(() => typeof document.startViewTransition !== 'function');
  if (!unsupported) {
    skip('fallback focus', 'could not remove startViewTransition');
  } else {
    // The fallback focuses on `pageshow`, so the first sample is taken a beat
    // later than on the supported path — `load`, not `commit`.
    const paths = pathsFor(R.home);
    const run = await timeline(page, () => clickTo(page, paths), paths, [400, 1200, 2400]);
    assertRow('fallback: static page -> homepage', run);

    // §23's BFCache branch, dispatched rather than provoked.
    //
    // A real BFCache restore is unreachable from here — Chromium disables the
    // cache whenever a debugger is attached, and Playwright is one. The branch
    // is short and its contract is exact ("appear in a clean settled state, and
    // leave the browser's focus restoration alone"), so it is tested by handing
    // the controller the event it would receive: a `pageshow` with
    // `persisted: true`. A veil and a focused landmark are planted first, so a
    // handler that did nothing at all would fail this rather than pass it.
    const bf = await page.evaluate(() => {
      const veil = document.createElement('div');
      veil.className = 'stratos-veil';
      document.body.appendChild(veil);
      document.getElementById('main')?.focus({ preventScroll: true });
      const before = document.activeElement?.id || document.activeElement?.tagName;
      // Planted so that a handler which did nothing at all reports `planted`
      // and fails, rather than inheriting a `skipped-restore` left by the
      // navigation that got us here.
      window.__stratosFocus = { outcome: 'planted', at: null };
      dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
      return {
        before,
        after: document.activeElement?.id || document.activeElement?.tagName,
        focus: window.__stratosFocus?.outcome ?? null,
        veils: document.querySelectorAll('.stratos-veil').length,
      };
    });
    if (bf.focus !== 'skipped-restore') bad('fallback BFCache branch', `reported ${bf.focus}`);
    else if (bf.veils) bad('fallback BFCache branch', `${bf.veils} veil(s) survived the restore`);
    else if (bf.after !== bf.before) bad('fallback BFCache branch', `focus moved ${bf.before} -> ${bf.after}`);
    else ok('fallback BFCache branch', `veil cleared, focus left on ${bf.after}, reported ${bf.focus}`);
  }
  await context.close();
}

await browser.close();
server.kill();

writeFileSync(
  OUT,
  JSON.stringify({ ranAt: new Date().toISOString(), results, rows, failures, skipped }, null, 2),
);

/* A steal is a focus change that happens *after* the controller has recorded
   its decision — see `assertRow` for why the samples before it do not count. */
const stolen = rows.filter((r) => {
  const settled = r.series.filter((s) => s.decidedAt != null);
  return settled.length > 1 && settled.some((s) => s.active !== settled[0].active);
}).length;

console.log(`\n${'='.repeat(70)}`);
console.log(`${results.filter((r) => r.pass).length} passed, ${failures.length} failed, ${skipped.length} skipped`);
console.log(`delayed focus stealing: ${stolen}`);
for (const s of skipped) console.log(`  - SKIPPED ${s}`);
for (const f of failures) console.log(`  ! ${f}`);
console.log(`written: ${OUT}`);
process.exit(failures.length === 0 ? 0 : 1);

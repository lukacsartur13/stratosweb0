// =============================================================================
// The navigation matrix (§30) and the ten-cycle lifecycle audit (§29).
//
// Runs against `dist/`, not the dev server: §30 is about the artefact that
// deploys, including the real `assets/js/transitions.js` and the real
// `@view-transition` opt-in, and a dev-server module graph is not that.
//
// ## The routes this site actually has
//
// §30's matrix names "work", "case study" and a services index. This site has
// none of them — see `_build/reports/phase7-baseline.md` §3. The twelve route
// keys are index, about, five services, blog, contact, quote, privacy and
// imprint. Rows of the matrix with no counterpart are reported as SKIPPED with
// the reason, not silently dropped and not silently substituted: `blog.html` is
// used where the matrix says "work" because it is the nearest index-shaped
// document, and every such substitution is labelled in the output.
//
// Usage (repo root, after `npm run build`):
//   node experiments/validate-navigation.mjs
// =============================================================================
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const PORT = Number(process.env.PORT ?? 4329);
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = process.env.OUT ?? '_build/reports/phase7-navigation.json';

const R = {
  home: '/',
  homeEn: '/en/',
  homeDe: '/de/',
  about: '/rolunk.html',
  aboutEn: '/en/about.html',
  aboutDe: '/de/ueber-uns.html',
  sme: '/kkv.html',
  enterprise: '/nagyvallalat.html',
  branding: '/branding.html',
  ads: '/hirdeteskezeles.html',
  blog: '/blog.html',
  contact: '/ugyfelszolgalat.html',
  quote: '/arajanlat.html',
};

const results = [];
const failures = [];
const skipped = [];
const ok = (name, detail = '') => results.push({ name, pass: true, detail });
const bad = (name, detail) => {
  results.push({ name, pass: false, detail });
  failures.push(`${name}: ${detail}`);
};
const skip = (name, why) => skipped.push(`${name}: ${why}`);

/**
 * Perform an action that starts a navigation, and wait for the *destination*
 * document to be the live one.
 *
 * ## Why `waitForLoadState` is the wrong instrument here
 *
 * It was `await action(); await page.waitForLoadState('load')`, and that is a
 * race the harness lost rather than a defect in the site. A click handed to the
 * page does not commit its navigation synchronously — the browser finishes the
 * task, fires `pageswap`, and only then swaps documents. `waitForLoadState`
 * asked "is a document loaded?" and the *outgoing* one still was, so it resolved
 * immediately, and the state read that followed landed in the gap where the old
 * execution context had been torn down and the new one did not yet exist:
 *
 *   page.evaluate: Execution context was destroyed, most likely because of a
 *   navigation
 *
 * Waiting on the URL instead waits for the thing actually being asserted — that
 * the browser arrived at the destination — and `waitUntil: 'load'` then applies
 * to the document that arrived rather than the one being left.
 *
 * The action's own rejection is swallowed only for the three messages that mean
 * "the navigation you asked for is under way": an `evaluate` whose context is
 * destroyed by the click it just dispatched has *succeeded*, and rethrowing
 * there would fail a passing case. Every other error propagates.
 */
const NAVIGATION_TEARDOWN =
  /Execution context was destroyed|because of a navigation|Target (page|closed)/i;

async function navigateBy(page, action, expectedPaths, timeout = 15_000) {
  const started = Date.now();
  // Armed *before* the action, or a fast navigation completes before anything
  // is listening and the wait then times out against a URL that already matches.
  const settled = page
    .waitForURL((u) => expectedPaths.includes(new URL(u).pathname), { waitUntil: 'load', timeout })
    .then(() => true)
    .catch(() => false);

  await action().catch((e) => {
    if (!NAVIGATION_TEARDOWN.test(String((e && e.message) || e))) throw e;
  });

  const arrived = await settled;
  return { arrived, landed: new URL(page.url()).pathname, elapsed: Date.now() - started };
}

/** The paths a route may legitimately resolve to. `/` and `/index.html` are the
 *  same document served two ways, and a static file server returns whichever
 *  the link asked for. */
const pathsFor = (to) => (to === '/' ? ['/', '/index.html'] : [to]);

// -----------------------------------------------------------------------------
const server = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', 'dist'], {
  stdio: 'ignore',
});
const stop = () => server.kill();
process.on('exit', stop);

await new Promise((resolve, reject) => {
  const started = Date.now();
  const poll = async () => {
    try {
      const r = await fetch(BASE);
      if (r.ok) return resolve();
    } catch {
      /* not up yet */
    }
    if (Date.now() - started > 20_000) return reject(new Error('static server did not start'));
    setTimeout(poll, 200);
  };
  poll();
});

const browser = await chromium.launch();

// =============================================================================
// Part 1 — the transition layer is present, correct and CSP-clean.
// =============================================================================
console.log('part 1 — the transition layer\n');

{
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  for (const [name, path] of Object.entries(R)) {
    await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
    const state = await page.evaluate(() => ({
      css: !!document.querySelector('link[href*="transitions.css"]'),
      js: !!document.querySelector('script[src*="transitions.js"]'),
      inlineScripts: [...document.querySelectorAll('script')].filter(
        (s) => !s.src && s.type !== 'application/json',
      ).length,
      inlineHandlers: [...document.querySelectorAll('*')].filter((el) =>
        [...el.attributes].some((a) => /^on/i.test(a.name)),
      ).length,
      curtain: !!document.querySelector('.curtain'),
      veils: document.querySelectorAll('.stratos-veil').length,
      main: !!document.getElementById('main'),
    }));

    if (!state.css) bad(`transitions.css on ${name}`, 'missing');
    if (!state.js) bad(`transitions.js on ${name}`, 'missing');
    if (state.inlineScripts) bad(`CSP on ${name}`, `${state.inlineScripts} inline <script>`);
    if (state.inlineHandlers) bad(`CSP on ${name}`, `${state.inlineHandlers} inline on* handlers`);
    if (state.curtain) bad(`old curtain on ${name}`, 'still present');
    if (state.veils) bad(`stale veil on ${name}`, `${state.veils} on first load`);
    if (!state.main) bad(`focus target on ${name}`, 'no #main');
  }
  ok('transition layer present on all 13 sampled routes, no inline script, no old curtain');

  // The portal must NOT carry it — §21/§4 of the architecture note.
  await page.goto(`${BASE}/portal/`, { waitUntil: 'domcontentloaded' });
  const portal = await page.evaluate(() => ({
    css: !!document.querySelector('link[href*="transitions.css"]'),
    js: !!document.querySelector('script[src*="transitions.js"]'),
  }));
  if (portal.css || portal.js) bad('portal exclusion', 'portal carries the transition layer');
  else ok('portal excluded from the transition layer');

  if (errors.length) bad('console', [...new Set(errors)].join(' | '));
  await page.close();
}

// =============================================================================
// Part 2 — §20 link eligibility. The rules that must NOT be applied.
// =============================================================================
console.log('part 2 — link interception rules (§20)\n');

{
  const page = await browser.newPage();
  await page.goto(BASE + R.sme, { waitUntil: 'load' });

  // ⌘-click must open a new tab, not navigate the current one. This is the
  // defect the old curtain had: `preventDefault()` unconditionally.
  const before = page.url();
  const context = page.context();
  const opened = context.waitForEvent('page', { timeout: 3000 }).catch(() => null);
  await page.click('a[href="index.html"]', { modifiers: ['Meta'] }).catch(() => {});
  const newTab = await opened;
  await page.waitForTimeout(500);
  if (page.url() !== before) {
    bad('meta-click', `current tab navigated to ${page.url()} — modified click was intercepted`);
  } else {
    ok('meta-click leaves the current tab alone');
  }
  if (newTab) await newTab.close();

  // A middle click must not be intercepted either.
  const beforeMiddle = page.url();
  await page.click('a[href="index.html"]', { button: 'middle' }).catch(() => {});
  await page.waitForTimeout(400);
  if (page.url() !== beforeMiddle) bad('middle-click', 'current tab navigated');
  else ok('middle-click leaves the current tab alone');

  // Keyboard activation must work: focus the link and press Enter.
  await page.goto(BASE + R.sme, { waitUntil: 'load' });
  await page.evaluate(() => document.querySelector('a[href="index.html"]').focus());
  const keyboard = await navigateBy(page, () => page.keyboard.press('Enter'), pathsFor('/'));
  if (keyboard.arrived) ok('keyboard activation navigates');
  else bad('keyboard activation', `landed on ${keyboard.landed}`);

  // mailto: / tel: / external / download must be left alone. Asserted against
  // the eligibility rule itself rather than by clicking, because clicking a
  // mailto: in a test opens a mail client.
  await page.goto(BASE + R.contact, { waitUntil: 'load' });
  const hrefs = await page.evaluate(() =>
    [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')),
  );
  const external = hrefs.filter((h) => /^(mailto:|tel:|https?:\/\/(?!127\.0\.0\.1))/.test(h));
  ok(`${external.length} non-navigable/external hrefs present on contact and left to the browser`);

  await page.close();
}

// =============================================================================
// Part 3 — §30's matrix.
// =============================================================================
console.log('part 3 — the navigation matrix (§30)\n');

const MATRIX = [
  ['homepage -> services', R.home, R.sme],
  ['homepage -> work (SUBSTITUTED: blog, no work route)', R.home, R.blog],
  ['homepage -> about', R.home, R.about],
  ['homepage -> contact', R.home, R.contact],
  ['services -> homepage', R.sme, R.home],
  ['work -> homepage (SUBSTITUTED: blog)', R.blog, R.home],
  ['about -> homepage', R.about, R.home],
  ['contact -> homepage', R.contact, R.home],
  ['services -> work (SUBSTITUTED: blog)', R.sme, R.blog],
  ['work -> about (SUBSTITUTED: blog)', R.blog, R.about],
  ['about -> contact', R.about, R.contact],
  ['hu -> en', R.home, R.homeEn],
  ['en -> hu', R.homeEn, R.home],
  ['hu -> de', R.home, R.homeDe],
  ['de -> hu', R.homeDe, R.home],
  ['en -> de', R.homeEn, R.homeDe],
  ['de -> en', R.homeDe, R.homeEn],
  ['about hu -> about en', R.about, R.aboutEn],
  ['about en -> about de', R.aboutEn, R.aboutDe],
];

skip('work index -> case study', 'no work index and no case-study routes exist (see phase7-baseline.md §3)');
skip('case study -> work index', 'same');

{
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`${page.url()}: ${e.message}`));

  for (const [name, from, to] of MATRIX) {
    await page.goto(BASE + from, { waitUntil: 'load' });
    await page.waitForTimeout(150);

    // Navigate by clicking a real anchor where one exists, so the eligibility
    // rules are exercised; fall back to a direct goto where the route pair is
    // not linked in the markup (which is itself worth knowing).
    // Same-origin is part of the match, not an afterthought.
    //
    // This was `pathname === href` alone, and it silently made every
    // `* -> homepage` row fail. The footer's social links are
    // `https://www.linkedin.com`, `https://www.instagram.com` and
    // `https://www.facebook.com` — each of which resolves to a URL whose
    // *pathname is `/`*. Matching on pathname alone therefore found LinkedIn
    // when it asked for the homepage, clicked it, and left the origin; the
    // wait then timed out against a URL that was never going to match.
    //
    // Worth recording that the four failures it produced were the harness
    // mis-aiming and not the site mis-behaving: `transitions.js` declined to
    // intercept the cross-origin click, which is exactly §20.
    // Matched against *every* path the destination may legitimately be spelled
    // as, so `/` also finds the `index.html` link the generated markup actually
    // emits and the row exercises a real click rather than falling through to a
    // `goto` that proves nothing about the anchor.
    const expected = pathsFor(to);

    const linked = await page.evaluate((paths) => {
      const a = [...document.querySelectorAll('a[href]')].find((el) => {
        const u = new URL(el.href, location.href);
        return u.origin === location.origin && paths.includes(u.pathname);
      });
      if (a) a.scrollIntoView({ block: 'center' });
      return !!a;
    }, expected);

    if (linked) {
      await navigateBy(
        page,
        () =>
          page.evaluate((paths) => {
            [...document.querySelectorAll('a[href]')]
              .find((el) => {
                const u = new URL(el.href, location.href);
                return u.origin === location.origin && paths.includes(u.pathname);
              })
              .click();
          }, expected),
        expected,
      );
    } else {
      await page.goto(BASE + to, { waitUntil: 'load' });
    }

    // The settle window is for the *destination's* own transition cleanup — the
    // veil fade-out and the focus move — not for the navigation, which
    // `navigateBy` has already established has happened.
    //
    // 1 200 ms, not 400. §25's focus move runs off `viewTransition.finished`,
    // and the longest authored transition is `page-to-home` at 620 ms with a
    // 180 ms delay — so at 400 ms the focus column read `BODY` on almost every
    // row and looked like absent focus management. It was a sample taken before
    // the thing it was sampling had happened: a probe at 200/400/800/1500/2500
    // ms shows `BODY, BODY, main, main, main`. The window is now comfortably
    // past the longest transition, so the column means what it appears to mean.
    await page.waitForTimeout(1_200);
    const landed = new URL(page.url()).pathname;
    const state = await page.evaluate(() => ({
      veils: document.querySelectorAll('.stratos-veil').length,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      focused: document.activeElement?.id || document.activeElement?.tagName,
    }));

    if (!expected.includes(landed)) bad(name, `landed on ${landed}, expected ${to}`);
    else if (state.veils > 0) bad(name, `${state.veils} veil(s) left mounted after navigation`);
    else if (state.overflow > 0) bad(name, `horizontal overflow ${state.overflow}px`);
    else ok(name, `${linked ? 'via anchor' : 'direct'}, focus ${state.focused}`);
  }

  if (errors.length) bad('matrix console', [...new Set(errors)].join(' | '));
  await page.close();
}

// =============================================================================
// Part 4 — §23 history and BFCache.
// =============================================================================
console.log('part 4 — history, back/forward and BFCache (§23)\n');

{
  const page = await browser.newPage();

  await page.goto(BASE + R.home, { waitUntil: 'load' });
  await page.goto(BASE + R.sme, { waitUntil: 'load' });
  await page.goto(BASE + R.blog, { waitUntil: 'load' });

  await page.goBack({ waitUntil: 'load' });
  if (new URL(page.url()).pathname !== R.sme) bad('back', `landed on ${page.url()}`);
  else ok('back returns to the previous document');

  await page.goForward({ waitUntil: 'load' });
  if (new URL(page.url()).pathname !== R.blog) bad('forward', `landed on ${page.url()}`);
  else ok('forward returns');

  // A restored document must be clean: no veil, no stale class.
  await page.goBack({ waitUntil: 'load' });
  await page.waitForTimeout(500);
  const restored = await page.evaluate(() => ({
    veils: document.querySelectorAll('.stratos-veil').length,
    curtain: document.querySelectorAll('.curtain.is-up').length,
  }));
  if (restored.veils || restored.curtain) {
    bad('BFCache cleanliness', `${restored.veils} veils, ${restored.curtain} curtains after restore`);
  } else {
    ok('restored document is clean — no veil, no stale overlay');
  }

  // No duplicate history entries: three gotos plus back/forward/back must leave
  // exactly one step back to the homepage.
  await page.goBack({ waitUntil: 'load' });
  if (new URL(page.url()).pathname === R.home || new URL(page.url()).pathname === '/index.html') {
    ok('no duplicate history entries');
  } else {
    bad('history entries', `one step back from ${R.sme} landed on ${page.url()}, expected the homepage`);
  }

  // Reload after a transition.
  await page.goto(BASE + R.about, { waitUntil: 'load' });
  await page.reload({ waitUntil: 'load' });
  const afterReload = await page.evaluate(() => document.querySelectorAll('.stratos-veil').length);
  if (afterReload) bad('reload', `${afterReload} veils after reload`);
  else ok('reload leaves no overlay');

  await page.close();
}

// =============================================================================
// Part 5 — §26 reduced motion, and §21's unsupported-browser fallback.
// =============================================================================
console.log('part 5 — reduced motion and unsupported environments (§21, §26)\n');

{
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto(BASE + R.sme, { waitUntil: 'load' });

  const rm = await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  if (!rm) {
    skip('reduced motion', 'the browser did not report the emulated preference');
  } else {
    const run = await navigateBy(
      page,
      () => page.evaluate(() => document.querySelector('a[href="index.html"]').click()),
      pathsFor('/'),
    );
    const elapsed = run.elapsed;
    const veils = await page.evaluate(() => document.querySelectorAll('.stratos-veil').length);
    // §26: "Reduced motion must never delay navigation."
    if (!run.arrived) bad('reduced motion navigation', `landed on ${run.landed}`);
    else if (elapsed > 800) bad('reduced motion delay', `navigation took ${elapsed}ms`);
    else ok(`reduced motion navigates immediately (${elapsed}ms)`);
    if (veils) bad('reduced motion veil', `${veils} veils`);
    else ok('reduced motion shows no veil');
  }
  await context.close();
}

{
  // §21: "Do not make browser support a requirement for basic navigation."
  // The API is removed before any application code runs, which is the closest
  // reproduction available of a browser that never had it.
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.addInitScript(() => {
    delete Document.prototype.startViewTransition;
    try {
      delete globalThis.navigation;
    } catch {
      /* non-configurable in some builds; the startViewTransition removal is
         enough to force the fallback path */
    }
  });
  await page.goto(BASE + R.sme, { waitUntil: 'load' });
  const supported = await page.evaluate(() => typeof document.startViewTransition === 'function');
  if (supported) {
    skip('unsupported-VT fallback', 'could not remove startViewTransition');
  } else {
    const run = await navigateBy(
      page,
      () => page.evaluate(() => document.querySelector('a[href="index.html"]').click()),
      pathsFor('/'),
    );
    const elapsed = run.elapsed;
    const landed = run.landed;
    if (!run.arrived) bad('fallback navigation', `landed on ${landed}`);
    else if (elapsed > 2500) bad('fallback delay', `navigation took ${elapsed}ms — timeout not bounded`);
    else ok(`fallback navigates within the bound (${elapsed}ms)`);

    await page.waitForTimeout(900);
    const veils = await page.evaluate(() => document.querySelectorAll('.stratos-veil').length);
    if (veils) bad('fallback cleanup', `${veils} veils left after the fade`);
    else ok('fallback removes its overlay');
  }
  await context.close();
}

{
  // §20/§30: JavaScript disabled. Links must still navigate.
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(BASE + R.sme, { waitUntil: 'domcontentloaded' });
  const nojs = await navigateBy(page, () => page.click('a[href="index.html"]'), pathsFor('/'));
  const landed = nojs.landed;
  if (nojs.arrived) ok('navigation works with JavaScript disabled');
  else bad('no-JS navigation', `landed on ${landed}`);
  await context.close();
}

// =============================================================================
// Part 6 — §29 the ten-cycle lifecycle audit.
// =============================================================================
console.log('part 6 — ten-cycle lifecycle audit (§29)\n');

const CYCLE = [
  ['home', R.home],
  ['services', R.sme],
  ['work (SUBSTITUTED: blog)', R.blog],
  ['case study (SUBSTITUTED: branding)', R.branding],
  ['about', R.about],
  ['home', R.home],
];

const cycles = [];
{
  const context = await browser.newContext();
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  await cdp.send('HeapProfiler.enable');

  const metrics = async () => {
    // Collect before counting, or the audit measures *collection timing* rather
    // than retention.
    //
    // Without this the ten cycles read 6 890, 6 897, 958, 7 977, 14 995, 6 909,
    // 13 928, 6 884, 13 902, 5 883 nodes — a signal that triples and returns to
    // baseline repeatedly, because `Performance.getMetrics` counts detached
    // documents that are still reachable from the collector's point of view but
    // no longer from the page's. Comparing early cycles with late ones on that
    // series reports a leak whenever the last sample happens to land before a
    // GC, and reports nothing whenever it happens to land after one; both
    // answers are noise. §29 asks whether repeated navigation causes
    // *continuous growth*, which is a question about what survives collection.
    await cdp.send('HeapProfiler.collectGarbage');
    const { metrics: m } = await cdp.send('Performance.getMetrics');
    const get = (n) => m.find((x) => x.name === n)?.value ?? 0;
    const dom = await page.evaluate(() => ({
      veils: document.querySelectorAll('.stratos-veil').length,
      curtains: document.querySelectorAll('.curtain').length,
      canvases: document.querySelectorAll('canvas').length,
      rafPending: typeof globalThis.__rafCount === 'number' ? globalThis.__rafCount : null,
    }));
    return {
      nodes: get('Nodes'),
      listeners: get('JSEventListeners'),
      documents: get('Documents'),
      frames: get('Frames'),
      heapBytes: get('JSHeapUsedSize'),
      ...dom,
    };
  };

  for (let i = 0; i < 10; i++) {
    for (const [, path] of CYCLE) {
      await page.goto(BASE + path, { waitUntil: 'load' });
      await page.waitForTimeout(220);
    }
    // Settle, and give the collector a chance, so the heap column reads as a
    // trend rather than as allocation noise.
    await page.waitForTimeout(400);
    const m = await metrics();
    cycles.push({ cycle: i + 1, ...m });
    console.log(
      `  cycle ${String(i + 1).padStart(2)}  nodes ${String(m.nodes).padStart(5)}  ` +
        `listeners ${String(m.listeners).padStart(4)}  docs ${m.documents}  frames ${m.frames}  ` +
        `canvas ${m.canvases}  veils ${m.veils}  curtains ${m.curtains}  ` +
        `heap ${(m.heapBytes / 1048576).toFixed(1)} MB`,
    );
  }

  // §29: any increase must be fixed, shown to be one-time lazy initialisation,
  // or documented as bounded browser caching. Compare the last five cycles with
  // cycles 2–6, so one-time warm-up is excluded from both windows.
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const early = cycles.slice(1, 6);
  const late = cycles.slice(5, 10);
  for (const key of ['nodes', 'listeners', 'documents', 'frames', 'veils', 'curtains', 'canvases']) {
    const a = mean(early.map((c) => c[key]));
    const b = mean(late.map((c) => c[key]));
    if (b > a) bad(`lifecycle ${key}`, `mean rose from ${a.toFixed(1)} to ${b.toFixed(1)} across cycles`);
    else ok(`lifecycle ${key} stable`, `${a.toFixed(1)} -> ${b.toFixed(1)}`);
  }
  const heapEarly = mean(early.map((c) => c.heapBytes));
  const heapLate = mean(late.map((c) => c.heapBytes));
  const growth = (heapLate - heapEarly) / heapEarly;
  // The heap is an observation, not an assertion: a JS heap that has not been
  // collected is not a leak. 25% across five cycles is the threshold at which
  // it stops being noise and starts being worth explaining.
  if (growth > 0.25) {
    bad('lifecycle heap', `grew ${(growth * 100).toFixed(1)}% (${(heapEarly / 1048576).toFixed(1)} -> ${(heapLate / 1048576).toFixed(1)} MB)`);
  } else {
    ok('lifecycle heap bounded', `${(growth * 100).toFixed(1)}% across cycles 2-6 vs 6-10`);
  }

  await context.close();
}

await browser.close();
stop();

writeFileSync(
  OUT,
  JSON.stringify({ ranAt: new Date().toISOString(), results, cycles, failures, skipped }, null, 2),
  );

console.log(`\n${'='.repeat(70)}`);
console.log(`${results.filter((r) => r.pass).length} passed, ${failures.length} failed, ${skipped.length} skipped`);
for (const s of skipped) console.log(`  - SKIPPED ${s}`);
for (const f of failures) console.log(`  ! ${f}`);
console.log(`written: ${OUT}`);
process.exit(failures.length === 0 ? 0 : 1);

// =============================================================================
// Memory and lifecycle audit — ten enter/traverse/leave/return cycles.
//
// ## What "leave the section" means here, and why
//
// The journey is one page with one sticky canvas, so there is no route to
// navigate away from. Scrolling past the canvas does not remount anything — it
// parks the frameloop, which is a different thing and is tested separately
// below. The real mount/unmount boundary in this route is the *capability*
// switch in FullAscent: when `prefers-reduced-motion` turns on, `detect()`
// returns a failure, `<JourneyScene>` is replaced by `<JourneyFallback>`, and
// the entire WebGL subtree — canvas, renderer, geometries, materials, textures
// — is unmounted. Turning the preference back off remounts it.
//
// That is a genuine remount of everything the audit asks about, it is reachable
// without a debug hook, and it is a thing that actually happens to a visitor who
// toggles the system setting while reading. So each cycle is:
//
//     enter (scene mounted) → traverse 0 → 30 000 → 0
//       → leave (reduced motion on, scene unmounts)
//       → return (reduced motion off, scene remounts)
//
// ## What is measured, and what each number would look like if it leaked
//
//   * JS heap, after a forced collection — a leak is monotonic growth per cycle.
//   * live WebGL programs / textures / buffers / framebuffers, counted as
//     created-minus-deleted at the driver boundary. These are the ground truth
//     for "no retained textures / materials / geometries": three.js's own
//     bookkeeping is not reachable from a production build, and the driver's is
//     the number that matters anyway.
//   * WebGL contexts created. A renderer that is not disposed leaves its context
//     alive and the next mount makes another; browsers cap this at ~16 and then
//     start killing the oldest, so an unbounded count is the most damaging leak
//     available here.
//   * live listeners: media-query, resize, scroll, visibilitychange, and
//     IntersectionObservers, counted as added-minus-removed.
//   * rAF callbacks scheduled per frame. Two render loops means roughly twice
//     the callbacks; this is the direct test for a duplicated loop.
//   * whether the parked frameloop actually stops work — draw calls issued while
//     the canvas is scrolled out of view should be zero, not merely fewer.
//
// Usage:  node experiments/bench-lifecycle.mjs
// =============================================================================
import { chromium } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';
import { instrumentation } from './bench-instrument.mjs';

const ORIGIN = process.env.ORIGIN ?? 'http://127.0.0.1:4324';
const BASE_PATH = process.env.BASE_PATH ?? '/experiments/stratos-ascent-full/';
const URL = `${ORIGIN}${BASE_PATH}`;
const CYCLES = Number(process.env.CYCLES ?? 10);
const OUT = process.env.OUT ?? 'experiments/bench-out';
const LABEL = process.env.LABEL ?? 'current';

const browser = await chromium.launch({
  headless: false,
  args: ['--enable-precise-memory-info'],
});

const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));

await page.addInitScript(instrumentation);
const cdp = await context.newCDPSession(page);
await cdp.send('HeapProfiler.enable');
await cdp.send('DOMDebugger.enable').catch(() => {});

async function heapKB() {
  // Three collections: the first drops the obvious garbage, and the later ones
  // give finalisers and the renderer's own deferred disposal a chance to run.
  // One collection reports a heap that is still holding a cycle's worth of
  // rubbish and turns every run into a false positive.
  for (let i = 0; i < 3; i++) {
    await cdp.send('HeapProfiler.collectGarbage');
    await page.waitForTimeout(120);
  }
  const { result } = await cdp.send('Runtime.evaluate', {
    expression: 'performance.memory ? performance.memory.usedJSHeapSize : 0',
  });
  return Math.round((result.value ?? 0) / 1024);
}

/** Real listener counts off the debugger, not off our own wrappers. */
async function domListeners(expression) {
  try {
    const { result } = await cdp.send('Runtime.evaluate', { expression });
    const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId });
    const byType = {};
    for (const l of listeners) byType[l.type] = (byType[l.type] ?? 0) + 1;
    return byType;
  } catch {
    return null;
  }
}

const waitForScene = () =>
  page.waitForFunction(() => document.querySelectorAll('canvas').length > 0, { timeout: 20_000 });
const waitForNoScene = () =>
  page.waitForFunction(() => document.querySelectorAll('canvas').length === 0, { timeout: 20_000 });

/** rAF callbacks scheduled per rendered frame, over a one-second window. */
async function rafPerFrame() {
  await page.evaluate(() => window.__bench.begin());
  await page.waitForTimeout(1000);
  return page.evaluate(() => {
    const r = window.__bench.end();
    return { rafPerFrame: +r.rafPerFrame.toFixed(2), drawsPerFrame: +r.drawsPerFrame.toFixed(1) };
  });
}

async function snapshot() {
  const live = await page.evaluate(() => ({
    gl: { ...window.__gl, peak: undefined, tick: undefined, liveByContext: undefined },
    byContext: window.__gl.liveByContext(),
    listeners: { ...window.__listeners },
    canvases: document.querySelectorAll('canvas').length,
  }));
  return {
    heapKB: await heapKB(),
    ...live,
    windowListeners: await domListeners('window'),
    documentListeners: await domListeners('document'),
  };
}

await page.goto(URL, { waitUntil: 'load' });
await waitForScene();
await page.waitForTimeout(3000);

const baseline = await snapshot();
const rows = [];

for (let cycle = 1; cycle <= CYCLES; cycle++) {
  // --- traverse -------------------------------------------------------------
  await page.evaluate(async () => {
    const max = document.documentElement.scrollHeight - innerHeight;
    const start = performance.now();
    await new Promise((done) => {
      const step = (now) => {
        const t = (now - start) / 3000;
        if (t >= 1) return done();
        const p = t < 0.5 ? t / 0.5 : 1 - (t - 0.5) / 0.5;
        scrollTo({ top: max * p, behavior: 'instant' });
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    scrollTo({ top: 0, behavior: 'instant' });
  });
  await page.waitForTimeout(400);

  // --- leave: the capability flips and the whole WebGL subtree unmounts ------
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await waitForNoScene();
  await page.waitForTimeout(600);
  const away = await snapshot();

  // --- return ---------------------------------------------------------------
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await waitForScene();
  await page.waitForTimeout(2200); // the lazy chunk is cached; the scene rebuilds
  const back = await snapshot();
  const loops = await rafPerFrame();

  rows.push({ cycle, away, back, loops });
  const L = back.byContext.live;
  process.stdout.write(
    `cycle ${String(cycle).padStart(2)} | heap away ${String(away.heapKB).padStart(6)} KB · back ${String(back.heapKB).padStart(6)} KB ` +
      `| ctx ${back.byContext.contexts} (alive ${back.byContext.alive} lost ${back.byContext.lost} collected ${back.byContext.collected}) ` +
      `| ON LIVE CONTEXTS prog ${L.programs ?? 0} tex ${L.textures ?? 0} buf ${L.buffers ?? 0} fbo ${L.framebuffers ?? 0} vao ${L.vaos ?? 0} ` +
      `| rAF/frame ${loops.rafPerFrame} draws/frame ${loops.drawsPerFrame}\n`,
  );
}

// --- the parked-frameloop check ----------------------------------------------
//
// QualityManager parks the loop on two signals — an IntersectionObserver on the
// canvas, and `visibilitychange` — and the honest test of either is not "fewer
// draw calls" but "no draw calls at all".
//
// The earlier version of this check scrolled to the bottom of the document and
// counted draws, and reported 9 720. That was read as a failure and it was not
// one: at 1440x900 the sticky stage is pinned to the bottom of its track and the
// footer beneath it is only 188 px tall, so at maximum scroll the canvas is
// still 712 px on screen. It was *correct* to keep drawing, and the check was
// measuring a canvas it believed was hidden. Every sample below therefore
// records the canvas rectangle that produced it, so a state that never actually
// occurred cannot be reported as a state that failed.
const sampleDraws = async (ms = 1500) =>
  page.evaluate(async (windowMs) => {
    const c = document.querySelector('canvas');
    const r = c ? c.getBoundingClientRect() : null;
    const before = window.__gl.draws;
    await new Promise((res) => setTimeout(res, windowMs));
    return {
      draws: window.__gl.draws - before,
      visibility: document.visibilityState,
      canvasOnScreen: !!r && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth,
      canvasRect: r ? { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height) } : null,
      innerHeight,
      scrollY: Math.round(scrollY),
      maxScroll: Math.round(document.documentElement.scrollHeight - innerHeight),
    };
  }, ms);

const toBottom = () =>
  page.evaluate(() => scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));

// The leak-relevant reading is taken here, before any of the manipulation below.
// The parking checks resize the viewport and walk the whole track, which mounts
// and unmounts staged geometry; a snapshot taken afterwards is a snapshot of the
// probe's own scrolling, not of ten lifecycle cycles.
const final = await snapshot();

// 1. Maximum scroll at the audit viewport — the state a visitor can actually
//    reach. Drawing here is correct if the canvas is still on screen, and the
//    rectangle in the output says whether it is.
await toBottom();
await page.waitForTimeout(1200);
const atBottom = await sampleDraws();
await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
await page.waitForTimeout(1000);

// 2. The IntersectionObserver path.
//
//    It cannot be reached by scrolling. The sticky stage is one viewport tall
//    and is pinned to the bottom of its track, so at maximum scroll the canvas
//    sits exactly one footer-height above the fold — 188 px at 1440 wide. The
//    canvas therefore stays partly visible at *every* viewport taller than the
//    footer, and shrinking the viewport does not help because the canvas shrinks
//    with it. So the observer is exercised with an injected spacer instead,
//    which tests the wiring honestly while making it explicit that this state is
//    not one the current layout produces on its own.
const spacer = await page.evaluate(() => {
  const el = document.createElement('div');
  el.id = '__bench_spacer';
  el.style.height = '400vh';
  document.querySelector('.journey__footer')?.after(el);
  return document.documentElement.scrollHeight;
});
await page.waitForTimeout(1200);
await toBottom();
await page.waitForTimeout(1500);
const offScreen = await sampleDraws();
await page.evaluate(() => {
  document.getElementById('__bench_spacer')?.remove();
  scrollTo({ top: 0, behavior: 'instant' });
});
await page.waitForTimeout(1200);

// 3. The visibilitychange path.
//
//    Backgrounding the tab for real was tried first and does not work here:
//    Playwright's second page is its own window, so the page under test stays
//    `visible` and merely occluded. What QualityManager actually owns is the
//    handler, so the handler is what is tested — `visibilityState` is overridden
//    and the event dispatched. This deliberately does not claim to measure the
//    browser's own background rAF throttling, which is a separate mechanism.
await page.evaluate(() => {
  // `visibilityState` lives on Document.prototype, not on the document's
  // immediate prototype. Overriding the wrong one shadows the real accessor
  // instead of replacing it, and `delete`-ing the override afterwards removes
  // the native accessor outright — both were tried, and both made the restored
  // page report `undefined`, which reads exactly like a page that stayed parked.
  // Keep the real descriptor and put it back.
  window.__realVisibility = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState');
  Object.defineProperty(Document.prototype, 'visibilityState', { configurable: true, get: () => 'hidden' });
  document.dispatchEvent(new Event('visibilitychange'));
});
await page.waitForTimeout(1000);
const hidden = await sampleDraws();
await page.evaluate(() => {
  Object.defineProperty(Document.prototype, 'visibilityState', window.__realVisibility);
  document.dispatchEvent(new Event('visibilitychange'));
});
await page.waitForTimeout(1200);
const refocused = await sampleDraws();

const parked = { atBottom, offScreen, hidden, refocused, spacerScrollHeight: spacer };

// Not `final` — see the note above. This one is only here to show what the
// parking probe's own scrolling and spacer cost, so it cannot be mistaken for a
// lifecycle number.
const afterParking = await snapshot();

await context.close();
await browser.close();

const heaps = rows.map((r) => r.back.heapKB);
const slope = heaps.length > 1 ? (heaps[heaps.length - 1] - heaps[0]) / (heaps.length - 1) : 0;

const report = {
  label: LABEL,
  url: URL,
  cycles: CYCLES,
  baseline,
  rows,
  final,
  afterParking,
  parked,
  heapSlopeKBPerCycle: +slope.toFixed(1),
  errors,
};

mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/lifecycle-${LABEL}.json`, JSON.stringify(report, null, 2));

console.log('\n=== lifecycle audit ===');
console.log(`cycles                       : ${CYCLES}`);
console.log(`heap  baseline → final       : ${baseline.heapKB} KB → ${final.heapKB} KB`);
console.log(`heap  slope per cycle        : ${slope.toFixed(1)} KB`);
console.log(`WebGL contexts created       : ${baseline.gl.contexts} → ${final.gl.contexts}`);
console.log(
  `  of those: alive ${final.byContext.alive} · force-lost ${final.byContext.lost} · collected ${final.byContext.collected}`,
);

// The leak detector. Everything on a lost or collected context has already been
// reclaimed by the driver, and no `deleteX` will ever be issued for it — see the
// note on `gl.programs` in bench-instrument.mjs.
const fmt = (o) =>
  ['programs', 'textures', 'buffers', 'framebuffers', 'renderbuffers', 'vaos']
    .map((k) => `${k} ${o[k] ?? 0}`)
    .join(' · ');
console.log(`resources ON LIVE CONTEXTS   : ${fmt(baseline.byContext.live)}`);
console.log(`                       final : ${fmt(final.byContext.live)}`);
console.log(`resources on dead contexts   : ${fmt(final.byContext.dead)}  (reclaimed with the context)`);
console.log(`pooled created-minus-deleted : programs ${final.gl.programs} · textures ${final.gl.textures} · buffers ${final.gl.buffers} — NOT a leak count`);
// Wrapper counts. `resize` rises by one per cycle here and does *not* rise in
// the debugger's census below, and the debugger is the one telling the truth:
// ScrollTrigger re-adds one module-level `_onResize` on every enable, and adding
// an identical (type, listener, capture) triple is a no-op per the DOM spec. The
// wrapper counts calls; the browser counts listeners.
console.log(`media-query listeners (calls): ${baseline.listeners.media} → ${final.listeners.media}`);
console.log(`resize listeners      (calls): ${baseline.listeners.resize} → ${final.listeners.resize}  ← see note, compare with the census below`);
console.log(`scroll listeners      (calls): ${baseline.listeners.scroll} → ${final.listeners.scroll}`);
console.log(`visibilitychange      (calls): ${baseline.listeners.visibility} → ${final.listeners.visibility}`);
console.log(`IntersectionObservers live   : ${baseline.listeners.observers} → ${final.listeners.observers}`);
console.log(`window listeners (debugger)  : ${JSON.stringify(final.windowListeners)}`);
console.log(`  baseline was              : ${JSON.stringify(baseline.windowListeners)}`);
console.log(`document listeners (debugger): ${JSON.stringify(final.documentListeners)}`);
console.log(`rAF callbacks per frame      : ${rows.map((r) => r.loops.rafPerFrame).join(' ')}`);
console.log(`draws per frame after remount: ${rows.map((r) => r.loops.drawsPerFrame).join(' ')}`);
console.log('\n--- frameloop parking (each sample records the canvas that produced it) ---');
for (const [name, p] of Object.entries(parked)) {
  if (typeof p !== 'object' || p === null) continue;
  console.log(
    `${name.padEnd(10)} draws ${String(p.draws).padStart(6)} | visibility ${p.visibility} | canvas on screen ${p.canvasOnScreen} ` +
      `rect ${JSON.stringify(p.canvasRect)} in viewport h ${p.innerHeight} | scrollY ${p.scrollY}/${p.maxScroll}`,
  );
}
console.log(`context-lost events          : ${final.gl.contextsLost}`);
console.log(`errors                       : ${errors.length ? [...new Set(errors)].join(' | ') : 'none'}`);
console.log(`\nwritten: ${OUT}/lifecycle-${LABEL}.json`);

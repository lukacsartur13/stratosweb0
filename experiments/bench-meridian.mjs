// =============================================================================
// Altitude-resolved performance benchmark for the Altimeter Meridian.
//
// `bench.mjs` answers "what does this route cost compared to the current hero",
// across one scripted scroll. It cannot answer the question this file exists
// for — *which altitude* is expensive — because it averages the whole journey
// into one median, and it reports nothing about the scene's actual workload.
//
// This one parks the instrument at each of the seven canonical stops, samples a
// fixed window there, and reports frame pacing alongside the draw calls,
// triangles, live programs, textures and contexts that produced it.
//
// Two things about the method are load-bearing and both are honest limitations
// rather than details:
//
//   * **It drives the production build by scrolling, not by a debug hook.** The
//     `__stratos` handle is compiled out of production, so parking at 18 000 m
//     means finding the scroll position that produces 18 000 m. That is what
//     `seek` does, and the achieved altitude is reported next to the requested
//     one so a miss is visible rather than assumed away.
//
//   * **Frame time on a 120 Hz display is vsync-clamped, so it cannot compare
//     two builds.** A scene using 2 ms of an 8.3 ms budget and one using 6 ms
//     both report 8.3 ms. Wall-clock frame time is still the number a visitor
//     experiences and it is what the thresholds are written against, but the
//     column that can detect a change is `GPUmed`: per-frame GPU time from
//     `EXT_disjoint_timer_query_webgl2`, which is immune to vsync.
//
//     `MODE=unlocked` exists and is *not* recommended. Relaunching with
//     `--disable-gpu-vsync --disable-frame-rate-limit` does raise the frame rate
//     to ~780 fps, but at that point the loop measures rAF and compositor
//     overhead rather than the scene, and the same unchanged build reported 780
//     fps in one sample and 120 in the next depending on window occlusion. It is
//     kept for inspection, not for comparison.
//
// Usage:
//   node experiments/bench-meridian.mjs                       # five brief targets
//   TARGETS=stress node experiments/bench-meridian.mjs        # fragment-amplified
//   BUILDS="current=/experiments/stratos-ascent-full/,\
//   baseline=/experiments/stratos-ascent-full-baseline/" \
//     node experiments/bench-meridian.mjs                     # interleaved A/B
// =============================================================================
import { chromium } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';
import { instrumentation, frameStats, gpuStats, medianOf } from './bench-instrument.mjs';

const ORIGIN = process.env.ORIGIN ?? 'http://127.0.0.1:4324';

/**
 * One or more builds to measure, as `label=path` pairs.
 *
 * More than one turns the run into an interleaved A/B: run 1 of build A, run 1
 * of build B, run 2 of A, run 2 of B, … in a single browser process.
 *
 * The interleaving is the whole point and it is not fussiness. Measuring all of
 * A and then all of B compares two builds *and* two points in the machine's
 * afternoon — and the second of those turned out to be the larger effect here.
 * Two sessions of the same unchanged build, half an hour apart, reported median
 * GPU times of 1.44 ms and 1.27 ms; a lighting change worth less than that
 * would be invisible under one ordering and "confirmed" under the other.
 * Alternating makes thermal drift and background load common-mode.
 */
const BUILDS = (process.env.BUILDS ?? `current=${process.env.BASE_PATH ?? '/experiments/stratos-ascent-full/'}`)
  .split(',')
  .map((pair) => {
    const [label, path] = pair.split('=');
    return { label: label.trim(), url: `${ORIGIN}${path.trim()}` };
  });

const MODE = process.env.MODE ?? 'vsync'; // 'vsync' | 'unlocked'
const RUNS = Number(process.env.RUNS ?? 3);
const WARMUP = Number(process.env.WARMUP ?? 1);
const SAMPLE_MS = Number(process.env.SAMPLE_MS ?? 2000);
const SETTLE_MS = Number(process.env.SETTLE_MS ?? 1400);
const LABEL = process.env.LABEL ?? 'current';
const OUT = process.env.OUT ?? 'experiments/bench-out';

const STOPS = [0, 3_000, 7_000, 12_000, 18_000, 24_000, 30_000];

// The five profiles from the brief. `dsf` is the device scale factor, `mobile`
// switches Playwright's touch emulation on — which is what makes
// `(pointer: coarse)` match, and therefore what actually selects the reduced
// quality tier in lib/capabilities.ts. Setting only the width would give a
// phone-sized viewport running the desktop tier and the row would be a lie.
const ALL_TARGETS = [
  { id: 'desktop', width: 1440, height: 900, dsf: 1, mobile: false, tier: 'full' },
  { id: 'laptop', width: 1280, height: 800, dsf: 2, mobile: false, tier: 'full' },
  { id: 'mobile-a', width: 390, height: 844, dsf: 3, mobile: true, tier: 'reduced' },
  { id: 'mobile-b', width: 360, height: 800, dsf: 3, mobile: true, tier: 'reduced' },
  { id: 'reduced-motion', width: 390, height: 844, dsf: 3, mobile: true, tier: 'reduced', reducedMotion: true },
  // Not a shipping configuration, and not reported as one.
  //
  // The lighting change is a *fragment* cost: it puts a third directional light
  // into the scene, so every lit pixel of every material evaluates one more
  // light. At 1440x900 on an M4 that is somewhere under the measurement floor —
  // the unlocked loop runs at ~780 fps and the per-frame difference disappears
  // into rAF overhead. This target renders 5120x2880, roughly eleven times the
  // fragments of the desktop row, purely so a per-pixel regression has room to
  // become visible. It answers "is the added light fragment-bound and by how
  // much", not "what does a visitor get".
  { id: 'stress', width: 2560, height: 1440, dsf: 2, mobile: false, tier: 'full', stress: true },
];

const selected = process.env.TARGETS
  ? process.env.TARGETS.split(',').map((id) => {
      const t = ALL_TARGETS.find((x) => x.id === id.trim());
      if (!t) throw new Error(`unknown target: ${id}`);
      return t;
    })
  : ALL_TARGETS.filter((t) => !t.stress); // opt in with TARGETS=stress

// Headed, always. Headless Chromium renders WebGL on SwiftShader, and a
// software-rendered frame time is not a slower version of the real one — it is
// a measurement of a different renderer. See PERFORMANCE_COMPARISON.md §0.
const LAUNCH_ARGS = [
  '--enable-precise-memory-info', // performance.memory in bytes, not 100 KB buckets
  ...(MODE === 'unlocked' ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : []),
];

// -----------------------------------------------------------------------------

async function heap(cdp) {
  await cdp.send('HeapProfiler.collectGarbage');
  const { result } = await cdp.send('Runtime.evaluate', {
    expression: 'performance.memory ? performance.memory.usedJSHeapSize : 0',
  });
  return Math.round((result.value ?? 0) / 1024); // KB
}

const readAltitude = (page) =>
  page.evaluate(() => {
    const el = document.querySelector('[data-testid="altitude-value"]');
    if (!el) return null;
    // Hungarian grouping uses a narrow no-break space; strip everything that is
    // not a digit rather than guessing which space it is this month.
    return Number((el.textContent ?? '').replace(/[^\d]/g, ''));
  });

/**
 * Build a scroll-progress → altitude table for this viewport.
 *
 * The altitude curve is recalibrated at runtime from the *measured* panel
 * layout (see journey.ts `calibrate`), so it differs between 1440 px and
 * 360 px and cannot be precomputed from the source. Forty-nine samples is
 * enough to bracket any stop; `seek` refines inside the bracket.
 *
 * Cached per target: the layout is deterministic for a given viewport, and the
 * table is only ever used as a starting guess that `seek` then verifies.
 */
async function altitudeTable(page) {
  const max = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  const table = [];
  for (let i = 0; i <= 32; i++) {
    const p = i / 32;
    await page.evaluate((y) => scrollTo({ top: y, behavior: 'instant' }), max * p);
    await page.waitForTimeout(220);
    table.push({ p, m: (await readAltitude(page)) ?? 0 });
  }
  // Scroll positions that have already been solved for an exact stop, reused
  // across the passes of one target. The layout — and therefore the whole
  // altitude curve — is identical for a given viewport, so the warm-up pass's
  // answer is the right first guess for the measured passes, and the loop below
  // still verifies it rather than trusting it.
  return { max, table, solved: {} };
}

/** Park the journey at `metres`, and report where it actually landed. */
async function seek(page, metres, cal) {
  const { max, table } = cal;

  let guess = cal.solved[metres];
  if (guess === undefined) {
    guess = 0;
    for (let i = 1; i < table.length; i++) {
      if (table[i].m >= metres) {
        const a = table[i - 1];
        const b = table[i];
        guess = b.m === a.m ? b.p : a.p + ((metres - a.m) / (b.m - a.m)) * (b.p - a.p);
        break;
      }
      guess = table[i].p;
    }
  }

  let achieved = 0;
  for (let attempt = 0; attempt < 6; attempt++) {
    await page.evaluate((y) => scrollTo({ top: y, behavior: 'instant' }), Math.max(0, max * guess));
    await page.waitForTimeout(420);
    achieved = (await readAltitude(page)) ?? 0;
    if (Math.abs(achieved - metres) <= 30) {
      cal.solved[metres] = guess;
      break;
    }

    // Secant step against the local slope, taken from the table bracket. The
    // curve is piecewise linear and monotonic, so this converges in two or
    // three steps everywhere except the flat destination plateau, where the
    // first probe already lands exactly on 30 000.
    const window = 0.01;
    const lo = Math.max(0, guess - window);
    const hi = Math.min(1, guess + window);
    await page.evaluate((y) => scrollTo({ top: y, behavior: 'instant' }), max * hi);
    await page.waitForTimeout(300);
    const mHi = (await readAltitude(page)) ?? 0;
    const slope = (mHi - achieved) / (hi - guess || 1);
    if (!Number.isFinite(slope) || Math.abs(slope) < 1) break;
    guess = Math.min(1, Math.max(0, guess + (metres - achieved) / slope));
    void lo;
  }
  return achieved;
}

async function sample(page, ms) {
  await page.evaluate(() => window.__bench.begin());
  await page.waitForTimeout(ms);
  const raw = await page.evaluate(() => window.__bench.end());
  return { ...frameStats(raw.times), ...raw, gpu: gpuStats(raw.gpuMs), times: undefined, gpuMs: undefined };
}

/** One page load: seven parked samples plus one full traversal. */
async function onePass(browser, target, cal, url) {
  const context = await browser.newContext({
    viewport: { width: target.width, height: target.height },
    deviceScaleFactor: target.dsf,
    isMobile: target.mobile,
    hasTouch: target.mobile,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.addInitScript(instrumentation);
  if (target.reducedMotion) await page.emulateMedia({ reducedMotion: 'reduce' });

  const cdp = await context.newCDPSession(page);
  await cdp.send('HeapProfiler.enable');

  await page.goto(url, { waitUntil: 'load' });

  if (target.reducedMotion) {
    const active = await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
    if (!active) throw new Error('reduced motion did not take effect — measurement void');
  }

  // Renderer initialisation: from navigation start to the first frame the
  // canvas actually draws. Polled rather than hooked, because the hook would
  // have to live in the application.
  const initStart = Date.now();
  let rendererReady = null;
  if (!target.reducedMotion) {
    try {
      await page.waitForFunction(() => window.__gl && window.__gl.draws > 0, { timeout: 30_000 });
      rendererReady = Date.now() - initStart;
    } catch {
      rendererReady = null;
    }
  }

  await page.waitForTimeout(2500); // lazy chunk, GLB decode, environment probe
  const heapBefore = await heap(cdp);

  /**
   * What the page actually decided, rather than what the target row claims.
   *
   * This used to double as a tier probe: `cappedDpr()` ceilinged the backing
   * store at 1.5 on a handheld and 2 elsewhere, and the reduced tier turned
   * antialiasing off, so the backing-store ratio told you which tier had run.
   * Phase 6.5 removed both signals — `renderScale()` is now one policy for every
   * form factor and multisampling is always on — so **the ratio no longer
   * identifies the tier**. `pointer: coarse` below is what distinguishes a
   * handheld now; the tier still is not exposed in production.
   *
   * What the ratio is still worth reading for is the thing it was always
   * measuring underneath: whether the buffer is at policy. A row whose canvas
   * came back at 3.0, or at 1.0 on a 3x viewport, is a run whose renderer was
   * not configured the way the shipped page configures it, and every number in
   * it is describing something no visitor will ever get.
   */
  const surface = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return { canvases: 0, canvasDpr: null, coarsePointer: matchMedia('(pointer: coarse)').matches };
    const css = canvas.getBoundingClientRect().width || 1;
    return {
      canvases: document.querySelectorAll('canvas').length,
      canvasDpr: +(canvas.width / css).toFixed(2),
      backingStore: `${canvas.width}x${canvas.height}`,
      coarsePointer: matchMedia('(pointer: coarse)').matches,
      devicePixelRatio,
    };
  });
  const canvases = surface.canvases;

  const calibration = cal ?? (await altitudeTable(page));

  const altitudes = [];
  for (const metres of STOPS) {
    const achieved = await seek(page, metres, calibration);
    await page.waitForTimeout(SETTLE_MS); // damped lights and rings arrive
    const stats = await sample(page, SAMPLE_MS);
    altitudes.push({ requested: metres, achieved, ...stats });
  }

  // One controlled traversal, 0 → 30 000 → 0, sampled end to end.
  await page.evaluate((y) => scrollTo({ top: y, behavior: 'instant' }), 0);
  await page.waitForTimeout(800);
  await page.evaluate(() => window.__bench.begin());
  await page.evaluate(async (ms) => {
    const max = document.documentElement.scrollHeight - innerHeight;
    const start = performance.now();
    await new Promise((done) => {
      const step = (now) => {
        const t = (now - start) / ms;
        if (t >= 1) return done();
        const p = t < 0.5 ? t / 0.5 : 1 - (t - 0.5) / 0.5;
        scrollTo({ top: max * p, behavior: 'instant' });
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }, 10_000);
  const rawTraversal = await page.evaluate(() => window.__bench.end());
  const traversal = {
    ...frameStats(rawTraversal.times),
    ...rawTraversal,
    gpu: gpuStats(rawTraversal.gpuMs),
    times: undefined,
    gpuMs: undefined,
  };

  const heapAfter = await heap(cdp);
  const longTasks = await page.evaluate(() => window.__long.length);

  await context.close();

  return {
    heapBeforeKB: heapBefore,
    heapAfterKB: heapAfter,
    rendererReadyMs: rendererReady,
    canvases,
    surface,
    longTasks,
    altitudes,
    traversal,
    errors,
    calibration,
  };
}

/**
 * Retry a pass that died for a reason that is not about the page.
 *
 * A long headed run occasionally loses its execution context mid-evaluate —
 * "Execution context was destroyed" — and one of those took out a
 * forty-minute campaign after it had already produced good data. Retried
 * rather than tolerated: the pass is discarded and repeated in full, so a
 * partial sample never reaches the medians. Console and page errors from the
 * application are *not* caught here; they are collected and reported.
 */
async function passWithRetry(browser, target, cal, url, attempts = 3) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      return await onePass(browser, target, cal, url);
    } catch (error) {
      last = error;
      process.stdout.write(`    ! pass failed (${error.message.split('\n')[0]}), retrying ${i + 1}/${attempts - 1}\n`);
    }
  }
  throw last;
}

// -----------------------------------------------------------------------------

const browser = await chromium.launch({ headless: false, args: LAUNCH_ARGS });

const env = await (async () => {
  const c = await browser.newContext();
  const p = await c.newPage();
  await p.goto('about:blank');
  const info = await p.evaluate(() => {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    const dbg = gl && gl.getExtension('WEBGL_debug_renderer_info');
    return {
      ua: navigator.userAgent,
      renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unavailable',
      vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : 'unavailable',
      timerQuery: gl
        ? gl.getExtension('EXT_disjoint_timer_query_webgl2')
          ? 'available'
          : 'unavailable'
        : 'no-context',
    };
  });
  await c.close();
  return info;
})();

const results = {
  label: LABEL,
  mode: MODE,
  builds: BUILDS,
  runs: RUNS,
  warmup: WARMUP,
  sampleMs: SAMPLE_MS,
  env,
  targets: [],
};

for (const target of selected) {
  process.stdout.write(
    `\n### ${target.id} ${target.width}x${target.height} @${target.dsf}x${target.reducedMotion ? ' reduced-motion' : ''} [${MODE}] builds: ${BUILDS.map((b) => b.label).join(' vs ')}\n`,
  );

  // One calibration per build: the two builds are the same layout, but reading
  // the table off each one costs a few seconds and removes any doubt about
  // whether a difference came from the scene or from landing on a different
  // altitude.
  const cals = Object.fromEntries(BUILDS.map((b) => [b.label, null]));
  const runsByBuild = Object.fromEntries(BUILDS.map((b) => [b.label, []]));

  for (let i = 0; i < WARMUP; i++) {
    for (const build of BUILDS) {
      const warm = await passWithRetry(browser, target, cals[build.label], build.url);
      cals[build.label] = warm.calibration;
      process.stdout.write(`  warm-up ${i + 1} [${build.label}]: discarded\n`);
    }
  }

  for (let i = 0; i < RUNS; i++) {
    for (const build of BUILDS) {
      const run = await passWithRetry(browser, target, cals[build.label], build.url);
      cals[build.label] = run.calibration;
      runsByBuild[build.label].push(run);
      const gpuMedians = run.altitudes.map((a) => (a.gpu.median ?? 0).toFixed(2)).join(' ');
      process.stdout.write(
        `  run ${i + 1} [${build.label}]: GPU ms ${gpuMedians} | frame med ${run.altitudes[0].median.toFixed(1)} | heap ${run.heapBeforeKB}→${run.heapAfterKB} KB${run.errors.length ? ` | ERRORS ${run.errors.length}` : ''}\n`,
      );
    }
  }

  for (const build of BUILDS) {
    results.targets.push(summarise(target, build, runsByBuild[build.label]));
  }
}

function summarise(target, build, runs) {
  const perStop = STOPS.map((metres, i) => {
    const rows = runs.map((r) => r.altitudes[i]);
    return {
      altitude: metres,
      achieved: medianOf(rows, (r) => r.achieved),
      avgFps: medianOf(rows, (r) => r.avgFps),
      median: medianOf(rows, (r) => r.median),
      p95: medianOf(rows, (r) => r.p95),
      p99: medianOf(rows, (r) => r.p99),
      over16: medianOf(rows, (r) => r.over16),
      over33: medianOf(rows, (r) => r.over33),
      worst: medianOf(rows, (r) => r.worst),
      longestRun: medianOf(rows, (r) => r.longestRun),
      // Median-of-medians across runs, plus the spread between the three run
      // medians, which is the only honest way to say whether a difference
      // between two builds is bigger than this machine's own noise.
      gpuMedian: +medianOf(rows, (r) => r.gpu.median ?? 0).toFixed(3),
      gpuP95: +medianOf(rows, (r) => r.gpu.p95 ?? 0).toFixed(3),
      gpuSpread: +(
        Math.max(...rows.map((r) => r.gpu.median ?? 0)) - Math.min(...rows.map((r) => r.gpu.median ?? 0))
      ).toFixed(3),
      gpuSamples: rows.reduce((a, r) => a + (r.gpu.n ?? 0), 0),
      gpuDisjoint: rows.reduce((a, r) => a + (r.gpuDisjoint ?? 0), 0),
      // Kept per run, not just as a median, because the medians turned out to
      // be noisy enough at desktop resolution that a median-of-three hides how
      // much of the difference between two builds is the machine. The pooled
      // mean below is the sample-weighted average over every timer query in
      // every run of this stop — hundreds of frames rather than three numbers —
      // and it is what the A/B verdict is computed from.
      gpuRunMedians: rows.map((r) => r.gpu.median ?? 0),
      gpuRunMeans: rows.map((r) => r.gpu.mean ?? 0),
      gpuPooledMean: +(
        rows.reduce((a, r) => a + (r.gpu.mean ?? 0) * (r.gpu.n ?? 0), 0) /
        Math.max(1, rows.reduce((a, r) => a + (r.gpu.n ?? 0), 0))
      ).toFixed(3),
      draws: +medianOf(rows, (r) => r.drawsPerFrame).toFixed(1),
      tris: Math.round(medianOf(rows, (r) => r.trisPerFrame)),
      rafPerFrame: +medianOf(rows, (r) => r.rafPerFrame).toFixed(2),
      programs: medianOf(rows, (r) => r.live.programs),
      textures: medianOf(rows, (r) => r.live.textures),
      buffers: medianOf(rows, (r) => r.live.buffers),
      framebuffers: medianOf(rows, (r) => r.live.framebuffers),
      contexts: medianOf(rows, (r) => r.live.contexts),
    };
  });

  const traversalRows = runs.map((r) => r.traversal);
  return {
    ...target,
    build: build.label,
    url: build.url,
    runs: runs.length,
    heapBeforeKB: medianOf(runs, (r) => r.heapBeforeKB),
    heapAfterKB: medianOf(runs, (r) => r.heapAfterKB),
    rendererReadyMs: medianOf(runs, (r) => r.rendererReadyMs ?? 0),
    canvases: medianOf(runs, (r) => r.canvases),
    surface: runs[0].surface,
    longTasks: medianOf(runs, (r) => r.longTasks),
    timerQuery: runs[0].altitudes[0].timerQuery,
    stops: perStop,
    traversal: {
      avgFps: medianOf(traversalRows, (r) => r.avgFps),
      median: medianOf(traversalRows, (r) => r.median),
      p95: medianOf(traversalRows, (r) => r.p95),
      p99: medianOf(traversalRows, (r) => r.p99),
      over16: medianOf(traversalRows, (r) => r.over16),
      over33: medianOf(traversalRows, (r) => r.over33),
      worst: medianOf(traversalRows, (r) => r.worst),
      longestRun: medianOf(traversalRows, (r) => r.longestRun),
      gpuMedian: +medianOf(traversalRows, (r) => r.gpu.median ?? 0).toFixed(3),
      gpuP95: +medianOf(traversalRows, (r) => r.gpu.p95 ?? 0).toFixed(3),
      draws: +medianOf(traversalRows, (r) => r.drawsPerFrame).toFixed(1),
    },
    errors: runs.flatMap((r) => r.errors),
  };
}

await browser.close();

mkdirSync(OUT, { recursive: true });
const file = `${OUT}/${LABEL}-${MODE}.json`;
writeFileSync(file, JSON.stringify(results, null, 2));

// --- report -------------------------------------------------------------------
console.log(`\n\n=== ${LABEL} · ${MODE} · ${RUNS} runs + ${WARMUP} warm-up · ${SAMPLE_MS} ms samples ===`);
console.log(`GPU: ${env.renderer}`);
console.log(`EXT_disjoint_timer_query_webgl2: ${env.timerQuery}`);
console.log(`UA: ${env.ua}\n`);

for (const t of results.targets) {
  console.log(
    `--- [${t.build}] ${t.id} · ${t.width}x${t.height} @${t.dsf}x · tier ${t.tier}${t.reducedMotion ? ' · reduced motion' : ''} · canvases ${t.canvases} · renderer ready ${t.rendererReadyMs} ms · heap ${t.heapBeforeKB}→${t.heapAfterKB} KB`,
  );
  console.log(
    `    measured surface: backing store ${t.surface?.backingStore ?? 'none'} · canvas DPR ${t.surface?.canvasDpr ?? 'n/a'} (window devicePixelRatio ${t.surface?.devicePixelRatio ?? '?'}) · pointer:coarse ${t.surface?.coarsePointer}`,
  );
  console.log(
    '   alt |  fps | med  | p95  | p99  | >16.7 | >33.3 | worst | run | GPUmed | GPUp95 | GPU± | draws |    tris | prog | tex | ctx',
  );
  for (const s of t.stops) {
    console.log(
      `${String(s.altitude).padStart(6)} |${String(s.avgFps).padStart(6)} |${s.median.toFixed(2).padStart(6)} |${s.p95.toFixed(2).padStart(6)} |${s.p99.toFixed(2).padStart(6)} |${String(s.over16).padStart(6)}% |${String(s.over33).padStart(6)}% |${String(s.worst).padStart(6)} |${String(s.longestRun).padStart(4)} |${s.gpuMedian.toFixed(3).padStart(7)} |${s.gpuP95.toFixed(3).padStart(7)} |${s.gpuSpread.toFixed(3).padStart(5)} |${String(s.draws).padStart(6)} |${String(s.tris).padStart(8)} |${String(s.programs).padStart(5)} |${String(s.textures).padStart(4)} |${String(s.contexts).padStart(4)}`,
    );
  }
  const v = t.traversal;
  console.log(
    ` trav. |${String(v.avgFps).padStart(6)} |${v.median.toFixed(2).padStart(6)} |${v.p95.toFixed(2).padStart(6)} |${v.p99.toFixed(2).padStart(6)} |${String(v.over16).padStart(6)}% |${String(v.over33).padStart(6)}% |${String(v.worst).padStart(6)} |${String(v.longestRun).padStart(4)} |${v.gpuMedian.toFixed(3).padStart(7)} |${v.gpuP95.toFixed(3).padStart(7)} |      |${String(v.draws).padStart(6)} |`,
  );
  const disjoint = t.stops.reduce((a, s) => a + s.gpuDisjoint, 0);
  const gpuN = t.stops.reduce((a, s) => a + s.gpuSamples, 0);
  console.log(`   GPU timer: ${gpuN} samples, ${disjoint} disjoint events${gpuN === 0 ? ' — GPU TIMING UNAVAILABLE' : ''}`);
  if (t.errors.length) console.log(`   console/page errors: ${[...new Set(t.errors)].join(' | ')}`);
  console.log('');
}

// --- A/B delta ----------------------------------------------------------------
// Printed only when two builds were interleaved, and printed as a difference
// against the run-to-run spread rather than as a bare percentage: a 4% change
// means nothing next to a 9% spread, and saying so is the point of the column.
if (BUILDS.length === 2) {
  const [a, b] = BUILDS;
  console.log(`=== A/B · ${b.label} → ${a.label} · GPU ms per frame, median of ${RUNS} interleaved runs ===`);
  for (const target of selected) {
    const ta = results.targets.find((t) => t.id === target.id && t.build === a.label);
    const tb = results.targets.find((t) => t.id === target.id && t.build === b.label);
    if (!ta || !tb) continue;
    console.log(`--- ${target.id}`);
    // Medians, and a paired sign test — never the mean.
    //
    // The mean of a GPU-time sample is not robust here and is not worth
    // rescuing: one long frame during a mount or a resolution change is worth
    // hundreds of ordinary ones, so the mean answers "was there an unusual
    // frame" when the question is "what does a frame cost".
    //
    // The sign test is what makes a difference smaller than the noise floor
    // still legible. Run-to-run spread on this machine is comparable to the
    // effect being looked for, so no single pair proves anything — but the two
    // builds are measured alternately under the same conditions, so if the
    // change were free, current would be slower in about half the pairs. Twenty
    // one out of twenty one is a different statement from "+5%", and a more
    // durable one.
    console.log('   alt |  base | curr  |  delta |    % | noise(±) | pairs | verdict      | draws b→c | prog b→c');
    let wins = 0;
    let pairs = 0;
    let sumBase = 0;
    let sumCurr = 0;
    const mid = (xs) => [...xs].sort((x, y) => x - y)[Math.floor(xs.length / 2)];
    for (let i = 0; i < STOPS.length; i++) {
      const sa = ta.stops[i];
      const sb = tb.stops[i];
      const mb = mid(sb.gpuRunMedians ?? [sb.gpuMedian]);
      const mc = mid(sa.gpuRunMedians ?? [sa.gpuMedian]);
      sumBase += mb;
      sumCurr += mc;
      let stopWins = 0;
      const n = Math.min(sa.gpuRunMedians?.length ?? 0, sb.gpuRunMedians?.length ?? 0);
      for (let k = 0; k < n; k++) {
        pairs++;
        if (sa.gpuRunMedians[k] > sb.gpuRunMedians[k]) {
          wins++;
          stopWins++;
        }
      }
      const delta = mc - mb;
      const pct = mb ? (100 * delta) / mb : 0;
      const noise = Math.max(sa.gpuSpread, sb.gpuSpread);
      const verdict = Math.abs(delta) <= noise ? 'within noise' : delta > 0 ? 'SLOWER' : 'faster';
      console.log(
        `${String(STOPS[i]).padStart(6)} |${mb.toFixed(3).padStart(6)} |${mc.toFixed(3).padStart(6)} |${delta.toFixed(3).padStart(7)} |${pct.toFixed(1).padStart(5)}% |${noise.toFixed(3).padStart(9)} | ${stopWins}/${n}   | ${verdict.padEnd(12)} | ${String(sb.draws).padStart(4)}→${String(sa.draws).padEnd(4)} | ${String(sb.programs).padStart(4)}→${String(sa.programs)}`,
      );
    }
    console.log(
      `   ALL   |${sumBase.toFixed(3).padStart(6)} |${sumCurr.toFixed(3).padStart(6)} |${(sumCurr - sumBase).toFixed(3).padStart(7)} |${((100 * (sumCurr - sumBase)) / sumBase).toFixed(1).padStart(5)}% |          | ${wins}/${pairs} | current slower in ${wins} of ${pairs} paired runs`,
    );
    console.log('');
  }
}

console.log(`written: ${file}`);

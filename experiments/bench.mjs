// =============================================================================
// Side-by-side measurement of the current hero and the 3D prototype.
//
// Neither number means anything on its own — a WebGL hero always costs more
// than a document — so both pages are driven through the same scripted scroll,
// in the same browser, under the same CPU throttle, and the two columns are
// reported together. Run with:  node experiments/bench.mjs
// =============================================================================
import { chromium } from '@playwright/test';
import { gzipSync } from 'node:zlib';
import { readFileSync, readdirSync } from 'node:fs';

const BASE = 'http://127.0.0.1:4324';
const TARGETS = [
  { id: 'current hero (SVG + WebGL sky)', url: `${BASE}/index.html` },
  { id: '0–8 000 m prototype (Blender + R3F)', url: `${BASE}/experiments/stratos-ascent/` },
  { id: '0–30 000 m full journey', url: `${BASE}/experiments/stratos-ascent-full/` },
];

// The reduced-motion path measured as its own target. It is the one the
// fallback strategy makes promises about — that it never downloads the
// renderer — and a claim about payload is worth exactly as much as its
// measurement. Driven through the same scripted scroll as the others.
const REDUCED_TARGETS = [
  { id: '0–30 000 m full journey (reduced motion)', url: `${BASE}/experiments/stratos-ascent-full/` },
];

const CPU_THROTTLE = Number(process.env.CPU ?? 4); // mid-range laptop, roughly
const SCROLL_MS = 6000;

// Headed by default, and it matters. Headless Chromium falls back to SwiftShader
// — WebGL on the CPU — which makes any 3D scene look catastrophic for reasons
// that have nothing to do with the scene. Both pages here use WebGL, so a
// software-rendered comparison is not merely pessimistic, it is wrong.
const HEADLESS = process.env.HEADLESS === '1';

async function measure(browser, { id, url, reducedMotion }) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  // Runtime emulation, then verified after navigation — never the declarative
  // context option, which does not reach `matchMedia` on Playwright 1.62.1.
  // A "reduced motion payload" row measured against a page that was actually
  // running the animated path would be the most misleading number in this file.
  // See tests/helpers/reduced-motion.ts.
  if (reducedMotion) await page.emulateMedia({ reducedMotion: 'reduce' });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE });

  // Transferred bytes, counted off the wire and also gzipped from disk, because
  // Netlify compresses and the uncompressed figure flatters nobody.
  const seen = new Map();
  page.on('response', (r) => {
    const len = Number(r.headers()['content-length'] ?? 0);
    if (len && !seen.has(r.url())) seen.set(r.url(), len);
  });

  await page.addInitScript(() => {
    const w = window;
    w.__long = [];
    w.__frames = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.__long.push(e.duration);
    }).observe({ entryTypes: ['longtask'] });
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.__lcp = e.startTime;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  });

  await page.goto(url, { waitUntil: 'load' });

  if (reducedMotion) {
    const active = await page.evaluate(
      () => matchMedia('(prefers-reduced-motion: reduce)').matches,
    );
    if (!active) throw new Error(`${id}: reduced motion did not take effect — measurement void`);
  }

  await page.waitForTimeout(2500); // let lazy chunks and the model settle

  const heapAfterLoad = await heap(cdp);

  // One scripted scroll, identical for both pages: down the whole document and
  // part of the way back, sampling every frame.
  await page.evaluate(async (ms) => {
    const w = window;
    w.__frames = [];
    const max = document.documentElement.scrollHeight - innerHeight;
    const start = performance.now();
    let last = start;
    await new Promise((done) => {
      const step = (now) => {
        w.__frames.push(now - last);
        last = now;
        const t = (now - start) / ms;
        if (t >= 1) return done();
        // down for the first 75%, back up for the rest
        const p = t < 0.75 ? t / 0.75 : 1 - (t - 0.75) / 0.25;
        scrollTo({ top: max * p, behavior: 'instant' });
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }, SCROLL_MS);

  const heapAfterScroll = await heap(cdp);

  const result = await page.evaluate(() => {
    const w = window;
    const frames = w.__frames.slice(1);
    const sorted = [...frames].sort((a, b) => a - b);
    const pct = (p) => sorted[Math.floor(sorted.length * p)] ?? 0;
    return {
      lcp: Math.round(w.__lcp ?? 0),
      longTasks: w.__long.length,
      longTaskMs: Math.round(w.__long.reduce((a, b) => a + b, 0)),
      worstTaskMs: Math.round(Math.max(0, ...w.__long)),
      frames: frames.length,
      medianFrameMs: +pct(0.5).toFixed(1),
      p95FrameMs: +pct(0.95).toFixed(1),
      jankFrames: frames.filter((f) => f > 33.4).length, // worse than 30fps
    };
  });

  await context.close();
  return { id, bytes: [...seen.values()].reduce((a, b) => a + b, 0), heapAfterLoad, heapAfterScroll, ...result };
}

async function heap(cdp) {
  await cdp.send('HeapProfiler.enable');
  await cdp.send('HeapProfiler.collectGarbage');
  const { result } = await cdp.send('Runtime.evaluate', {
    expression: 'performance.memory ? performance.memory.usedJSHeapSize : 0',
  });
  return Math.round((result.value ?? 0) / 1024 / 1024);
}

// --- static asset weight, gzipped, straight off disk --------------------------
const gz = (paths) =>
  Math.round(
    paths.reduce((total, p) => {
      try {
        return total + gzipSync(readFileSync(p), { level: 9 }).length;
      } catch {
        return total;
      }
    }, 0) / 1024,
  );

const RUNS = Number(process.env.RUNS ?? 1);

const browser = await chromium.launch({ headless: HEADLESS });
const rows = [];
for (const t of TARGETS) rows.push(await runTarget(browser, t));
for (const t of REDUCED_TARGETS) rows.push(await runTarget(browser, { ...t, reducedMotion: true }));
await browser.close();

/**
 * Run a target `RUNS` times and keep the median of each metric.
 *
 * One run of a scroll benchmark on a shared machine is a sample of the
 * machine's mood, not of the page. Medians across three runs are what the
 * comparison document quotes.
 */
async function runTarget(browser, target) {
  const runs = [];
  for (let i = 0; i < RUNS; i++) runs.push(await measure(browser, target));
  if (runs.length === 1) return runs[0];

  const median = (key) => {
    const sorted = runs.map((r) => r[key]).sort((a, b) => a - b);
    const mid = sorted[Math.floor(sorted.length / 2)];
    return typeof mid === 'number' ? +mid.toFixed(1) : mid;
  };
  const out = { id: target.id, runs: runs.length };
  for (const key of Object.keys(runs[0])) {
    out[key] = typeof runs[0][key] === 'number' ? median(key) : runs[0][key];
  }
  out.id = target.id;
  return out;
}

console.log(
  '\n=== %dx CPU throttle · 1440x900 · %dms scripted scroll · renderer: %s ===\n',
  CPU_THROTTLE,
  SCROLL_MS,
  HEADLESS ? 'SwiftShader (software)' : 'GPU',
);
for (const r of rows) {
  console.log(`${r.id}`);
  console.log(`  transferred (uncompressed) : ${(r.bytes / 1024).toFixed(0)} KB`);
  console.log(`  LCP                        : ${r.lcp} ms`);
  console.log(`  long tasks (>50ms)         : ${r.longTasks}  total ${r.longTaskMs} ms  worst ${r.worstTaskMs} ms`);
  console.log(`  frame time  median / p95   : ${r.medianFrameMs} ms / ${r.p95FrameMs} ms`);
  console.log(`  frames worse than 30fps    : ${r.jankFrames} of ${r.frames}`);
  console.log(`  JS heap  after load/scroll : ${r.heapAfterLoad} MB / ${r.heapAfterScroll} MB`);
  console.log('');
}

console.log('gzipped asset weight from disk:');
console.log(
  // The old homepage's `flight.css` / `flight.js` were removed when the
  // Altimeter Meridian became the homepage, so this arm can no longer be
  // measured. Its recorded numbers are preserved in CURRENT_HERO_NOTE.md
  // (p95 25.1 ms, 2/563 frames under 30 fps) and in the regression
  // baseline; they are history now, not a live comparison.
  `  site chrome   css+js : ${gz(['assets/css/main.css', 'assets/js/main.js'])} KB`,
);
console.log(
  `  shared        glb    : ${gz(['public/models/stratos-altimeter.glb'])} KB`,
);

// Eager vs lazy, straight off the built route, so the split is a fact about the
// artefact rather than an inference from the network log.
try {
  const dir = 'dist/experiments/stratos-ascent-full/assets';
  const html = readFileSync('dist/experiments/stratos-ascent-full/index.html', 'utf8');
  const eagerNames = [...html.matchAll(/(?:src|href)="[^"]*\/assets\/([^"]+)"/g)].map((m) => m[1]);
  const all = readdirSync(dir);
  const eager = eagerNames.map((n) => `${dir}/${n}`);
  const lazy = all.filter((f) => !eagerNames.includes(f)).map((f) => `${dir}/${f}`);
  console.log(`  full route    eager  : ${gz(eager)} KB  (${eagerNames.length} files)`);
  console.log(`  full route    lazy   : ${gz(lazy)} KB  (${lazy.length} files)`);
} catch (error) {
  console.log(`  full route    eager  : not built (${error.message})`);
}

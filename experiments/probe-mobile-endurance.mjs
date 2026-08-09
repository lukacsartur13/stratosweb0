/**
 * Sixty seconds of scrolling — §26's long-session test.
 *
 * The question is not "what is the frame rate", which on a desktop CPU
 * pretending to be a phone means very little. It is "does it get WORSE", which
 * is a property of the architecture and survives the translation: a leak, an
 * observer that is never disconnected, a listener registered per section, a
 * growing array — all of them show up as the last third being slower than the
 * first, on any hardware.
 *
 * Also reported: heap growth over the same window, for the same reason.
 *
 *   node experiments/probe-mobile-endurance.mjs [--origin http://localhost:4322] [--seconds 60]
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};
const ORIGIN = arg('origin', 'http://localhost:4322');
const SECONDS = Number(arg('seconds', '60'));
const LABEL = arg('label', 'after');

const VIEWPORT = { width: 390, height: 844 };

/**
 * On the platform's own GPU, for the reason `probe-mobile-cost.mjs` sets out at
 * length: Playwright's default Chromium rasterises WebGL on the CPU, and on a
 * page with a live canvas that turns a frame-pacing measurement into a
 * measurement of SwiftShader. `--software` restores the default.
 */
const browser = await chromium.launch(
  args.includes('--software')
    ? {}
    : { args: ['--use-gl=angle', '--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist'] },
);
const context = await browser.newContext({
  viewport: VIEWPORT,
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();
const cdp = await context.newCDPSession(page);

await page.goto(ORIGIN + '/', { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);

const backend = await page.evaluate(() => {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    const name = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'unknown';
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return name;
  } catch {
    return 'unavailable';
  }
});

// Frame intervals, recorded in the page, from rAF. The gaps between callbacks
// are what a visitor perceives as smoothness.
await page.evaluate(() => {
  const w = /** @type {any} */ (window);
  w.__frames = [];
  let last = performance.now();
  const tick = (now) => {
    w.__frames.push(now - last);
    last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

const heapAt = async () => {
  const { usedSize } = await cdp.send('Runtime.getHeapUsage').catch(() => ({ usedSize: 0 }));
  return Math.round(usedSize / 1024);
};

const heapStart = await heapAt();
const started = Date.now();
let down = true;

while ((Date.now() - started) / 1000 < SECONDS) {
  await cdp.send('Input.synthesizeScrollGesture', {
    x: Math.round(VIEWPORT.width / 2),
    y: Math.round(VIEWPORT.height / 2),
    xDistance: 0,
    yDistance: down ? -1800 : 1800,
    speed: 3200,
    gestureSourceType: 'touch',
    preventFling: false,
  });
  await page.waitForTimeout(180);
  // Turn around at the ends rather than pinning against them: a probe that
  // spends half its minute stuck at the bottom of the document is measuring an
  // idle page and reporting it as a scroll.
  const at = await page.evaluate(() => scrollY / Math.max(1, document.documentElement.scrollHeight - innerHeight));
  if (at > 0.95) down = false;
  if (at < 0.05) down = true;
}

const heapEnd = await heapAt();

const frames = await page.evaluate(() => /** @type {any} */ (window).__frames);
await browser.close();

/** Trim the first second: startup is not the thing being measured. */
const usable = frames.slice(60);
const third = Math.floor(usable.length / 3);
const slice = (a, b) => usable.slice(a, b);

const stats = (xs) => {
  if (xs.length === 0) return { frames: 0 };
  const sorted = [...xs].sort((a, b) => a - b);
  const at = (q) => sorted[Math.floor(sorted.length * q)];
  return {
    frames: xs.length,
    medianMs: Number(at(0.5).toFixed(2)),
    p95Ms: Number(at(0.95).toFixed(2)),
    worstMs: Number(sorted[sorted.length - 1].toFixed(2)),
    over32ms: xs.filter((v) => v > 32).length,
  };
};

const first = stats(slice(0, third));
const last = stats(slice(third * 2));

const report = {
  label: LABEL,
  origin: ORIGIN,
  rasteriser: backend,
  seconds: SECONDS,
  viewport: `${VIEWPORT.width}x${VIEWPORT.height}`,
  heapKbStart: heapStart,
  heapKbEnd: heapEnd,
  heapKbGrowth: heapEnd - heapStart,
  firstThird: first,
  lastThird: last,
  medianDriftMs: Number((last.medianMs - first.medianMs).toFixed(2)),
};

const out = resolve(ROOT, '_build/reports', `mobile-endurance-${LABEL}.json`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(report, null, 2));

console.log(`rasteriser: ${backend}\n`);
console.log(`first third  median ${first.medianMs}ms  p95 ${first.p95Ms}ms  worst ${first.worstMs}ms  >32ms: ${first.over32ms}`);
console.log(`last third   median ${last.medianMs}ms  p95 ${last.p95Ms}ms  worst ${last.worstMs}ms  >32ms: ${last.over32ms}`);
console.log(`median drift ${report.medianDriftMs}ms   heap ${heapStart} -> ${heapEnd} KB (+${report.heapKbGrowth})`);
console.log(`\nwrote ${out}`);

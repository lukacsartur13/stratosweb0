// =============================================================================
// §25 · THE ARRIVAL INSTRUMENT, MEASURED.
//
// The production report's §L5 records the defect and this measures it: the
// object at 28 000 m is dark metal on a black sky, and the report's concern is
// that it reads as a black patch rather than as a precision object.
//
// "Black object with legible form" is a measurable claim. What is measured is
// the crop the dial occupies:
//
//   floor    the 5th-percentile luminance — how deep the housing's black is.
//            §25 requires it to STAY deep, so this must not rise much.
//   ceiling  the 99th percentile — the brightest specular. §25 forbids bright,
//            glowing, silver and gaming-like, so this must not run away.
//   spread   p99 - p05, which is what "legible form" actually is: form is read
//            from the range between the lit edge and the shadow, not from the
//            average.
//   ink      the share of pixels above the field's own black, i.e. how much of
//            the crop is object at all rather than sky.
//
// Usage:  npm run dev:home
//         node experiments/probe-arrival-instrument.mjs --tag before
// =============================================================================
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { stats } from './png-luma.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const TAG = arg('tag', 'before');
const OUT = '_build/reports/luxury-art-direction/continuity/instrument';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })).newPage();
await page.goto(process.env.URL ?? 'http://localhost:5177/home/hu.html', { waitUntil: 'networkidle' });
await page.addStyleTag({ content: 'vite-error-overlay, .debug, .debug__toggle { display: none !important; }' });
await page.waitForFunction(() => !!globalThis.__stratos, { timeout: 30_000 });
await page.waitForTimeout(2800);

const out = [];
for (const [id, stage, clip] of [
  ['a1', 'calibration', { x: 1050, y: 160, width: 320, height: 290 }],
  ['a6', 'full-stratosphere', { x: 570, y: 520, width: 300, height: 300 }],
]) {
  await page.evaluate((s) => {
    const el = document.querySelector(`.panel[data-stage="${s}"]`);
    scrollTo({ top: el.offsetTop + 0.4 * innerHeight, behavior: 'instant' });
  }, stage);
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${OUT}/${TAG}-${id}.png`, clip });
  // Whole frame too, so the statement's primacy can be judged — §53.
  await page.screenshot({ path: `${OUT}/${TAG}-${id}-frame.png` });

  const st = stats(`${OUT}/${TAG}-${id}.png`);
  out.push({ tag: TAG, id, stage, ...st });
  console.log(
    `${TAG} ${id} ${stage.padEnd(18)} p05 ${String(st.p05).padStart(5)}  p50 ${String(st.p50).padStart(5)}  ` +
    `p95 ${String(st.p95).padStart(5)}  p99 ${String(st.p99).padStart(5)}  spread ${String(st.spread).padStart(5)}  ` +
    `ink ${String(st.ink).padStart(5)}%  blown ${st.blown}`,
  );
}
writeFileSync(`${OUT}/${TAG}.json`, JSON.stringify(out, null, 2));
await browser.close();

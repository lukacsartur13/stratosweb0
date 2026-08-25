// =============================================================================
// PHASE 5.2A · §33 · THE THREE PROOF SCENES, IN MOTION.
//
// §33 asks for the three scenes AND THE TRANSITIONS BETWEEN THEM, and for one
// reason: object continuity, pose interpolation, reading-light timing and mask
// tracking are all properties of movement. A still cannot show a mask lagging
// the object by a frame; a still cannot show a light front that reads as a fade.
//
// This is deliberately NOT the whole-homepage recording — §52 says not to
// produce the rollout assets yet. It starts a screen before Act I, runs at a
// reading pace to Act V's release, and holds on each of the three composed
// frames long enough to be looked at.
//
//   node experiments/record-depth-scenes.mjs
// =============================================================================
import { chromium } from '@playwright/test';
import { mkdirSync, renameSync, readdirSync, statSync } from 'node:fs';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const LOCALE = arg('locale', 'hu');
const BASE = process.env.URL ?? `http://localhost:5177/home/${LOCALE}.html`;
const OUT = '_build/reports/luxury-art-direction/depth';
const VIEW = { width: 1440, height: 900 };

/** The same pace the whole-journey recording uses: one viewport per 1.4 s. */
const SECONDS_PER_SCREEN = 1.4;
const FPS = 25;
/** How long the recording rests on each composed frame, in seconds. */
const DWELL = 2.2;

mkdirSync(`${OUT}/_raw`, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: VIEW,
  deviceScaleFactor: 1,
  recordVideo: { dir: `${OUT}/_raw`, size: VIEW },
});
const page = await context.newPage();
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.addStyleTag({ content: 'vite-error-overlay, .debug, .debug__toggle { display: none !important; }' });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(4000);

const anchors = await page.evaluate(() =>
  ['calibration', 'lower-atmosphere', 'stratosphere-transition', 'full-stratosphere'].map((id) => ({
    id,
    top: document.querySelector(`.panel[data-stage="${id}"]`).offsetTop,
  })),
);
const start = 0;
// Stop where Act V's own frame lets go, which is one hold past its panel top.
const end = Math.round(anchors[2].top + 1.8 * VIEW.height);
const step = Math.max(4, Math.round(VIEW.height / (SECONDS_PER_SCREEN * FPS)));
const dwellAt = new Set(anchors.slice(0, 3).map((a) => Math.round((a.top + 0.4 * VIEW.height) / step) * step));
console.log(`${((end - start) / VIEW.height).toFixed(1)} screens · ${step}px/frame · dwelling at ${[...dwellAt].join(', ')}`);

await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
await page.waitForTimeout(2000);

for (let y = start; y <= end; y += step) {
  await page.evaluate((top) => scrollTo({ top, behavior: 'instant' }), y);
  await page.waitForTimeout(1000 / FPS);
  if (dwellAt.has(y)) await page.waitForTimeout(DWELL * 1000);
}
await page.waitForTimeout(1500);

await context.close();
await browser.close();

const raw = readdirSync(`${OUT}/_raw`)
  .filter((f) => f.endsWith('.webm'))
  .map((f) => ({ f, t: statSync(`${OUT}/_raw/${f}`).mtimeMs }))
  .sort((a, b) => b.t - a.t);
renameSync(`${OUT}/_raw/${raw[0].f}`, `${OUT}/three-scene-motion.webm`);
console.log(`wrote ${OUT}/three-scene-motion.webm`);

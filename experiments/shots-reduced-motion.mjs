// =============================================================================
// §30, §53 · THE REDUCED-MOTION PATH, PHOTOGRAPHED.
//
// §30 asks for the Master/Passage hierarchy to remain visually intact on a path
// with no clock, and for it not to fall back to the previous visual system.
// `six-acts.spec.ts` asserts both as numbers; this is the picture, because
// "visually intact" is a judgement and the review needs something to judge.
//
// The reduced-motion homepage is one long static document — no canvas, no
// sticky frames, every act and every passage composed and still — so it is
// captured as a full-page strip rather than as viewport frames.
//
// Usage:  npm run dev:home
//         node experiments/shots-reduced-motion.mjs
// =============================================================================
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const LOCALE = arg('locale', 'hu');
const BASE = process.env.URL ?? `http://localhost:5177/home/${LOCALE}.html`;
const OUT = '_build/reports/luxury-art-direction/continuity/reduced-motion';

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  reducedMotion: 'reduce',
});
const page = await context.newPage();
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.addStyleTag({ content: 'vite-error-overlay, .debug, .debug__toggle { display: none !important; }' });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(2500);

const state = await page.evaluate(() => ({
  reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
  canvases: document.querySelectorAll('canvas').length,
  masters: document.querySelectorAll('.panel[data-level="master"]').length,
  passages: document.querySelectorAll('.panel[data-level="passage"]').length,
  // Every frame's presence, as the page states it. On this path nothing
  // publishes `--pass`, so the ramp has to fall back to fully present.
  presence: [...document.querySelectorAll('.panel[data-level] .act, .panel[data-level] .passage')].map(
    (el) => +parseFloat(getComputedStyle(el).opacity).toFixed(2),
  ),
  // The rejected composition, asserted the same way the suite asserts it.
  rejected: ['.panel__eyebrow', '.notes', '.system', '.check', '.ladder', '.horizon']
    .map((sel) => [sel, document.querySelectorAll(sel).length]),
  height: +(document.documentElement.scrollHeight / innerHeight).toFixed(1),
}));
console.log(JSON.stringify(state, null, 2));

// The seven acts and the four passages, in one strip, at their own scale.
for (const [id, stage] of [
  ['r-i', 'calibration'],
  ['r-x1', 'cloud-entry'],
  ['r-x2', 'cloud-breakthrough'],
  ['r-iv', 'selected-work'],
  ['r-x3', 'system'],
  ['r-x4', 'process'],
  ['r-vi', 'full-stratosphere'],
  ['r-action', 'destination'],
]) {
  await page.evaluate((s) => {
    const el = document.querySelector(`.panel[data-stage="${s}"]`);
    el.scrollIntoView({ block: 'start', behavior: 'instant' });
  }, stage);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/${id}-${LOCALE}.png` });
  process.stdout.write(`${id} ${stage}\n`);
}
await browser.close();
console.log(`\nwrote ${OUT}`);

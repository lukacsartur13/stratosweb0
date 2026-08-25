/**
 * A DENSE SETTLED SEQUENCE OF ONE CHAPTER — §26's sheet.
 *
 * Sampled across the CHAPTER'S OWN EXTENT rather than across the track, because
 * the whole question is how one chapter reads from its first frame to its last,
 * and the two states being compared are different lengths. Equal
 * chapter-progress is the only sampling under which "the old system sequence"
 * and "the new system sequence" are the same measurement.
 *
 * The extent is the panel's own box plus the screen it unpins into: a chapter
 * begins when its panel reaches the top of the viewport and ends when the next
 * one does, which is exactly `journey.ts`'s own definition of a stage boundary.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const W = Number(arg('width', 1440)), H = Number(arg('height', 900));
const STAGE = arg('stage', 'system');
const N = Number(arg('steps', 15));
const TAG = arg('tag', `${STAGE}`);
const OUT = arg('out', '_build/reports/luxury-art-direction/compression');
const DIR = `${OUT}/chapter-${TAG}`;
mkdirSync(DIR, { recursive: true });

const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal', '--enable-unsafe-swiftshader'] });
const c = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const p = await c.newPage();
await p.goto('http://localhost:4322/index.html', { waitUntil: 'networkidle' });
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(2500);

const extent = await p.evaluate((stage) => {
  const panels = [...document.querySelectorAll('.panel[data-stage]')];
  const i = panels.findIndex((x) => x.dataset.stage === stage);
  const top = panels[i].getBoundingClientRect().top + scrollY;
  const next = panels[i + 1];
  const end = next ? next.getBoundingClientRect().top + scrollY : top + panels[i].offsetHeight;
  return { top, end };
}, STAGE);

const rows = [];
for (let i = 0; i <= N; i++) {
  const y = extent.top + ((extent.end - extent.top) * i) / N;
  await p.evaluate((top) => scrollTo({ top, behavior: 'instant' }), y);
  await p.waitForTimeout(90);
  const st = await p.evaluate(() => ({
    metres: Math.round(Number(getComputedStyle(document.documentElement).getPropertyValue('--alt')) * 30000),
  }));
  await p.screenshot({ path: `${DIR}/c${String(i).padStart(2, '0')}.png` });
  rows.push({ i, k: +(i / N).toFixed(3), screens: +((y - extent.top) / H).toFixed(3), ...st });
}
writeFileSync(`${OUT}/chapter-${TAG}.json`, JSON.stringify({
  meta: { tag: TAG, stage: STAGE, width: W, height: H, steps: N, dir: `chapter-${TAG}`,
          screens: +((extent.end - extent.top) / H).toFixed(3) }, rows }, null, 1));
console.log(`chapter-${TAG}: ${STAGE} is ${((extent.end - extent.top) / H).toFixed(2)} screens, ${rows.length} shots`);
await b.close();

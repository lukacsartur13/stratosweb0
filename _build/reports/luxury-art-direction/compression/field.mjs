/**
 * THE PAINTED FIELD, AT SETTLED SCROLL POSITIONS — §14.
 *
 * `temporal/background.py` answered §20's question (does the sky STEP?) off a
 * real-time recording. §14 asks a different one — does the field EVOLVE enough
 * to be SEEN? — and that one is better asked at settled positions, because it
 * is about the difference between two frames a visitor stops on, not between
 * two compositor frames 33 ms apart.
 *
 * This writes the shots and the state at each one; `field.py` reads them.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const W = Number(arg('width', 1440)), H = Number(arg('height', 900));
const N = Number(arg('steps', 60));
const TAG = arg('tag', 'field');
const OUT = arg('out', '_build/reports/luxury-art-direction/compression');
const DIR = `${OUT}/field-${TAG}`;
mkdirSync(DIR, { recursive: true });

const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal', '--enable-unsafe-swiftshader'] });
const c = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const p = await c.newPage();
await p.goto('http://localhost:4322/index.html', { waitUntil: 'networkidle' });
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(2500);

const track = await p.evaluate(() => {
  const t = document.querySelector('[data-testid="journey-track"]');
  return { top: t.offsetTop, height: t.offsetHeight };
});
const scrollable = track.height - H;

const rows = [];
for (let i = 0; i <= N; i++) {
  const y = track.top + (scrollable * i) / N;
  await p.evaluate((top) => scrollTo({ top, behavior: 'instant' }), y);
  await p.waitForTimeout(90);
  const state = await p.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const owner = [...document.querySelectorAll('.panel')].find((pl) => {
      const r = pl.getBoundingClientRect();
      return r.top <= innerHeight * 0.5 && r.bottom >= innerHeight * 0.5;
    });
    return {
      metres: Math.round(Number(cs.getPropertyValue('--alt')) * 30000),
      instrument: +(Number(cs.getPropertyValue('--instrument')) || 0).toFixed(3),
      stage: owner ? owner.dataset.stage : null,
    };
  });
  await p.screenshot({ path: `${DIR}/f${String(i).padStart(3, '0')}.png` });
  rows.push({ i, screens: +((y - track.top) / H).toFixed(3), ...state });
}
writeFileSync(`${OUT}/field-${TAG}.json`, JSON.stringify({ meta: { tag: TAG, width: W, height: H, steps: N, dir: `field-${TAG}` }, rows }, null, 1));
console.log(`field-${TAG}: ${rows.length} settled shots`);
await b.close();

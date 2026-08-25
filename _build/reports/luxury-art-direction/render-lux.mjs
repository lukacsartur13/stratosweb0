/**
 * §49 — THE ALTIMETER PRESENTATION STUDY, AND THE PLATES THE SIX ACTS USE.
 *
 * Production is untouched: `public/models/stratos-altimeter.glb`,
 * `components/MeridianLights.tsx` and `scene.ts` are read, never written. What
 * this file varies is what a photographer varies — lamp intensity, lamp
 * colour, lens length, exposure — on the object that already exists.
 *
 * `A` is the current presentation, exactly: MeridianLights' four lamps at
 * their shipped intensities and colours, the 28° lens, exposure 1.0, in the
 * pose Phase 1 used for the hero. Everything after it changes ONE group of
 * values at a time, so the comparison sheet shows which change did the work.
 *
 * Usage:
 *   sh _build/reports/luxury-art-direction/stage-studio.sh
 *   python3 -m http.server 4327 --directory _studio
 *   node _build/reports/luxury-art-direction/render-lux.mjs
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const OUT = `${here}assets`;
mkdirSync(OUT, { recursive: true });

/* The Phase 1 hero pose, held constant across the whole comparison so the
   variable is the lighting and never the angle. */
const POSE = { rx: -0.05, ry: 0.09, rz: 0 };

/* THE FOUR STEPS. Each inherits the one above it, so the comparison sheet
   shows which change did the work rather than only that four of them did. */
const CURRENT = { ...POSE, dist: 3.95, fov: 28, exposure: 1.06, keyI: 5.4, rimI: 2.4, ambI: 0.50, fillI: 1.7 };
/* B · DEEP BLACKS. The ambient is what was filling the shadow side and the
   inside of the housing with a flat, even blue; at 0.50 there is no true black
   anywhere on the object, and form that is read from tone rather than from
   light is the render signature of a game asset. Fill comes down with it.
   Nothing else moves. This is the largest single step in the study. */
const B = { ...CURRENT, ambI: 0.14, fillI: 0.70 };
/* C · A LONGER LENS. 28° over an object this small is a wide lens: it bows the
   bezel and spreads the dial's perspective. 17° at a matched distance is the
   product-photography equivalent, and the exposure comes down with it so the
   machined highlights stop blooming. */
const C = { ...B, fov: 17, dist: 6.35, exposure: 0.95 };
/* D · THE RIM SEPARATES, NOT THE KEY. The key is reduced and neutralised — a
   cold-blue key on a dark object is a large part of what reads as "futuristic
   interface" — and the rim is raised so the housing's edge is drawn against a
   near-black field without the exposure being raised to do it. This is the
   recipe the study recommends, and the one the six acts use. */
const D = { ...C, keyI: 4.2, keyC: 0xf2f5f9, rimI: 3.2, rimC: 0xc8d6e8 };

const PLATES = [
  ['lux-a-current',  CURRENT],
  ['lux-b-blacks',   B],
  ['lux-c-lens',     C],
  ['lux-d-rim',      D],
  /* The three plates the six acts actually use, all in recipe D. Different
     poses, because each appearance has to be a different object in the frame
     rather than the same object at a different size. */
  ['lux-hero',    { ...D }],
  /* Act III is consulted rather than presented: turned away, lower key, and
     deliberately short of the angle that catches a blown highlight on the
     upper bezel — which the first pass did at ry −0.40. */
  ['lux-system',  { ...D, rx: 0.10, ry: -0.28, rz: 0.03, exposure: 0.86, keyI: 3.6, rimI: 3.0 }],
  /* Act VI is the return: square-on, the lowest key in the set, the rim doing
     nearly all of the work. Completion, not repetition. */
  ['lux-arrival', { ...D, rx: -0.01, ry: 0.015, rz: 0, exposure: 0.90, keyI: 3.4, rimI: 3.8 }],
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 1200 }, deviceScaleFactor: 2 });
await page.goto('http://localhost:4327/lux/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });

for (const [name, opts] of PLATES) {
  await page.evaluate((o) => window.__render(o), opts);
  await page.waitForTimeout(180);
  await page.locator('canvas').screenshot({ path: `${OUT}/${name}.png`, omitBackground: true });
  console.log('rendered', name);
}
await browser.close();

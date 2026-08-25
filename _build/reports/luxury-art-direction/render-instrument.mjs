/**
 * Phase 1 — instrument plates for the six static composition studies.
 *
 * The studies are static frames, so the Meridian appears in them as a flat
 * image rather than as a live scene. These are renders of the SAME asset the
 * homepage loads (`public/models/stratos-altimeter.glb`) under the SAME four
 * lights `components/MeridianLights.tsx` sets, so nothing in the studies is a
 * drawing of the instrument — it is the instrument, photographed.
 *
 * Three poses, because the direction asks for three or four appearances and
 * each one has to be a different object in the frame, not the same object at a
 * different size (§11, §12).
 *
 * Run against the review scratch server — `sh
 * _build/reports/luxury-art-direction/stage-studio.sh` then `python3 -m
 * http.server 4327 --directory _studio`. The studio page is its own document
 * root and lives OUTSIDE `dist/`, so it is not crawled as a public route.
 * Nothing here is part of the site build.
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const OUT = process.argv[2] ?? new URL('./assets/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const POSES = [
  // ACT I — the iconic introduction. Face-on, a degree of tilt, keyed hard so
  // the machined bevel carries the frame on its own.
  { name: 'instrument-hero',    rx: -0.05, ry: 0.09,  rz: 0,    dist: 3.95, exposure: 1.06, keyI: 5.4, rimI: 2.4, ambI: 0.50 },
  // ACT III — read at an angle, cooler and darker: an instrument being
  // consulted rather than presented.
  { name: 'instrument-system',  rx: 0.14,  ry: -0.42, rz: 0.05, dist: 4.30, exposure: 0.96, keyI: 4.4, rimI: 3.0, ambI: 0.34 },
  // ACT VI — the return. Symmetrical and rim-lit, so the silhouette separates
  // from a near-black sky without the exposure being raised.
  { name: 'instrument-arrival', rx: -0.02, ry: 0.02,  rz: 0,    dist: 4.05, exposure: 1.02, keyI: 4.8, rimI: 3.4, ambI: 0.42 },
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 1200 }, deviceScaleFactor: 2 });
await page.goto('http://localhost:4327/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });

for (const pose of POSES) {
  await page.evaluate((p) => window.__render(p), pose);
  await page.waitForTimeout(150);
  await page.locator('canvas').screenshot({ path: `${OUT}/${pose.name}.png`, omitBackground: true });
  console.log('rendered', pose.name);
}

await browser.close();

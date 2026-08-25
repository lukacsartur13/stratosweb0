// Fast two-frame check for the instrument's presentation: Act I and Act VI only.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const OUT = '_build/reports/luxury-art-direction/production/instrument';
mkdirSync(OUT, { recursive: true });
const b = await chromium.launch();
const c = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await c.newPage();
await p.goto('http://localhost:5177/home/hu.html', { waitUntil: 'networkidle' });
await p.waitForFunction(() => !!globalThis.__stratos, { timeout: 30000 });
await p.waitForTimeout(2600);
for (const [id, stage] of [['a1','calibration'],['a6','full-stratosphere']]) {
  await p.evaluate((s) => {
    const el = document.querySelector(`.panel[data-stage="${s}"]`);
    scrollTo({ top: el.offsetTop + 0.4 * innerHeight, behavior: 'instant' });
  }, stage);
  await p.waitForTimeout(2800);
  const box = id === 'a1' ? { x: 1020, y: 140, width: 380, height: 320 } : { x: 480, y: 440, width: 520, height: 460 };
  await p.screenshot({ path: `${OUT}/${id}.png`, clip: box });
  const lum = await p.evaluate(() => {
    const cv = document.querySelector('canvas');
    return cv ? [cv.width, cv.height] : null;
  });
  console.log(id, 'canvas', lum);
}
await b.close();

/**
 * Photograph the six composition studies at 1440 × 900, and build the review
 * sheet that shows them in journey order.
 *
 * Static frames only: no scroll, no animation, no scene. The point of the
 * exercise is that each one has to hold completely still (§31).
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const OUT = `${here}frames`;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1540, height: 1000 }, deviceScaleFactor: 2 });
await page.goto(pathToFileURL(`${here}frames.html`).href, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(400);

for (const el of await page.locator('.frame').all()) {
  const act = await el.getAttribute('data-act');
  await el.screenshot({ path: `${OUT}/${act}.png` });
  console.log('shot', act);
}

await browser.close();

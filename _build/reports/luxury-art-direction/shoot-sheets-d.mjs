/* The five review sheets. Shot separately rather than as one long page so a
   human can open exactly the one they are arguing about. */
import { chromium } from '@playwright/test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fontsReady } from './fonts-ready.mjs';
const here = fileURLToPath(new URL('.', import.meta.url));
const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
const page = await browser.newPage({ viewport: { width: 2000, height: 1200 }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(`${here}sheets-d.html`).href, { waitUntil: 'networkidle' });
await fontsReady(page);
await page.waitForTimeout(400);
for (const [id, file] of [
  ['d-main',     'direction-d-main.png'],
  ['d-vs-ac',    'direction-d-vs-ac.png'],
  ['d-locales',  'direction-d-locales.png'],
  ['d-distance', 'direction-d-distance.png'],
  ['d-breaks',   'direction-d-breaks.png'],
]) {
  await page.locator(`#${id}`).screenshot({ path: `${here}direction-d/${file}` });
  console.log('shot', file);
}
await browser.close();

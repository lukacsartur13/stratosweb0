/* The four review sheets. Shot separately rather than as one long page so a
   human can open exactly the one they are arguing about. */
import { chromium } from '@playwright/test';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = fileURLToPath(new URL('.', import.meta.url));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1200 }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(`${here}sheets.html`).href, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(400);
for (const [id, file] of [
  ['sheet-a', 'sheet-1-direction-a.png'],
  ['sheet-b', 'sheet-2-direction-b.png'],
  ['sheet-c', 'sheet-3-direction-c.png'],
  ['sheet-all', 'sheet-4-comparison.png'],
  ['sheet-locale', 'sheet-5-locale-stress.png'],
]) {
  await page.locator(`#${id}`).screenshot({ path: `${here}typography/${file}` });
  console.log('shot', file);
}
await browser.close();

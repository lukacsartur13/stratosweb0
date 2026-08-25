/* The review sheets. Shot separately rather than as one long page so a human
   can open exactly the one they are arguing about. */
import { chromium } from '@playwright/test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fontsReady } from './fonts-ready.mjs';
const here = fileURLToPath(new URL('.', import.meta.url));
const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
const page = await browser.newPage({ viewport: { width: 1900, height: 1200 }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(`${here}sheets-six.html`).href, { waitUntil: 'networkidle' });
await fontsReady(page);
await page.waitForTimeout(600);
for (const [id, file] of [
  ['s-mono',      'six-act-monochrome.png'],
  ['s-color',     'six-act-color.png'],
  ['s-distance',  'six-act-distance.png'],
  ['s-width',     'direction-d-width-study.png'],
  ['s-locales',   'six-act-locales.png'],
  ['s-decisions', 'six-act-decisions.png'],
]) {
  await page.locator(`#${id}`).screenshot({ path: `${here}six-act/${file}` });
  console.log('shot', file);
}
await browser.close();

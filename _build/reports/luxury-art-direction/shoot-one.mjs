/* Shoot one element from one page. `node shoot-one.mjs <page.html> <#id> <out.png> [width]` */
import { chromium } from '@playwright/test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fontsReady } from './fonts-ready.mjs';
const here = fileURLToPath(new URL('.', import.meta.url));
const [pageFile, sel, out, w] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
const page = await browser.newPage({ viewport: { width: Number(w) || 1900, height: 1200 }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(`${here}${pageFile}`).href, { waitUntil: 'networkidle' });
await fontsReady(page);
await page.waitForTimeout(400);
await page.locator(sel).screenshot({ path: `${here}${out}` });
console.log('shot', out);
await browser.close();

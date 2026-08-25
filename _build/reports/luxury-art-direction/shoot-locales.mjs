import { chromium } from '@playwright/test';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = fileURLToPath(new URL('.', import.meta.url));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await page.goto(pathToFileURL(`${here}typography-locales.html`).href, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(300);
/* Report the real overflow of each monument against the 1232px measure, so the
   sheet's claim is a number and not an impression. */
const fit = await page.evaluate(() => [...document.querySelectorAll('.frame')].map(f => {
  const m = f.querySelector('.monument');
  /* A block-level span fills the column, so its box width says nothing about
     the type. Range.getBoundingClientRect measures the TEXT. */
  const widest = Math.max(...[...m.querySelectorAll('span')].map(s => {
    const r = document.createRange(); r.selectNodeContents(s);
    return r.getBoundingClientRect().width;
  }));
  return { id: f.id, px: parseFloat(getComputedStyle(m).fontSize), widest: Math.round(widest), over: Math.round(widest - 1232) };
}));
console.table(fit);
for (const f of ['l1', 'l2', 'l3', 'l4']) await page.locator(`#${f}`).screenshot({ path: `${here}typography/${f}.png` });
await browser.close();

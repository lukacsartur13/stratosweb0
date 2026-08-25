/* The three rejected breaks, photographed. Same audit rules as the nine —
   a rejected setting still has to be a legal frame, or the comparison is
   between a real composition and a broken one. */
import { chromium } from '@playwright/test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fontsReady } from './fonts-ready.mjs';
const here = fileURLToPath(new URL('.', import.meta.url));
const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await page.goto(pathToFileURL(`${here}breaks-d.html`).href, { waitUntil: 'networkidle' });
await fontsReady(page);
for (const id of ['x1', 'x2', 'x3', 'x4']) {
  const over = await page.evaluate((i) => {
    const f = document.getElementById(i), fb = f.getBoundingClientRect();
    return [...f.querySelectorAll('.monument span')].map(s => {
      const r = document.createRange(); r.selectNodeContents(s);
      return Math.round(r.getBoundingClientRect().width);
    }).filter(w => w > 1200);
  }, id);
  if (over.length) console.log(`  ! ${id}: a line sets ${over.join(', ')}px against the 1 200px field`);
  await page.locator(`#${id}`).screenshot({ path: `${here}direction-d/${id}.png` });
  console.log('shot', id);
}
await browser.close();

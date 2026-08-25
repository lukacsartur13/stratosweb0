/* The nine width-axis frames and the three rejected breaks. Audited by the
   same rules as the masters — a variant that overflows is not evidence. */
import { chromium } from '@playwright/test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fontsReady } from './fonts-ready.mjs';
const here = fileURLToPath(new URL('.', import.meta.url));
const IDS = ['w-a1-96','w-a1-100','w-a1-104','w-a3-96','w-a3-100','w-a3-104','w-a5-96','w-a5-100','w-a5-104','y1','y2','y3'];
const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await page.goto(pathToFileURL(`${here}variants-six.html`).href, { waitUntil: 'networkidle' });
await fontsReady(page);
await page.waitForTimeout(300);
const bad = await page.evaluate((ids) => {
  const out = {};
  for (const id of ids) {
    const f = document.getElementById(id), fb = f.getBoundingClientRect(), p = [];
    for (const s of f.querySelectorAll('.monument span')) {
      const rg = document.createRange(); rg.selectNodeContents(s);
      const r = rg.getBoundingClientRect();
      const w = Math.round(r.width);
      if (w > 1200) p.push(`"${s.textContent}" sets ${w}px against a 1200px field`);
      if (Math.round(r.left - fb.left) < 119) p.push(`"${s.textContent}" breaks the left margin`);
      if (Math.round(r.right - fb.left) > 1321) p.push(`"${s.textContent}" breaks the right margin`);
      if (Math.round(r.top - fb.top) < 119) p.push(`"${s.textContent}" breaks the top margin`);
      if (s.getClientRects().length > 1) p.push(`"${s.textContent}" was re-broken by the browser`);
    }
    out[id] = { stretch: getComputedStyle(f.querySelector('.monument')).fontStretch, size: getComputedStyle(f.querySelector('.monument')).fontSize, problems: p };
  }
  return out;
}, IDS);
let failed = false;
for (const [id, r] of Object.entries(bad)) {
  if (r.problems.length) failed = true;
  console.log(`[${r.problems.length ? 'FAIL' : ' ok '}] ${id.padEnd(9)} stretch ${String(r.stretch).padEnd(7)} size ${r.size}`);
  r.problems.forEach(p => console.log(`         · ${p}`));
}
if (!failed || process.argv.includes('--force')) {
  for (const id of IDS) await page.locator(`#${id}`).screenshot({ path: `${here}six-act/${id}.png` });
  console.log(`\n${IDS.length} variant frames shot`);
} else console.log('\nnot shooting.');
await browser.close();
process.exit(failed && !process.argv.includes('--force') ? 1 : 0);

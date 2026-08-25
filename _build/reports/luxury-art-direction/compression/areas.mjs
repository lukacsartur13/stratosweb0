/**
 * THE LAYER'S NAME LINE, MEASURED IN EVERY SHAPE IT HAS TO SET IN.
 *
 * The three lines are the only new object phase 5.1 puts on the page, and the
 * one failure mode they have is a line that cannot break: the middot used to be
 * spaced with padding, which is not a break opportunity, so the operation
 * layer's four names were one unbreakable word wider than the column.
 * `over` must be 0 everywhere.
 */
import { chromium } from '@playwright/test';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal', '--enable-unsafe-swiftshader'] });
const CASES = [[1440, 900, 'hu'], [1440, 900, 'de'], [1280, 800, 'de'],
                [390, 844, 'hu'], [360, 800, 'hu'], [390, 844, 'de'], [360, 800, 'de'], [390, 844, 'en']];
let bad = 0;
for (const [w, h, loc] of CASES) {
  const c = await b.newContext({ viewport: { width: w, height: h }, isMobile: w < 768, hasTouch: w < 768 });
  const p = await c.newPage();
  await p.goto(`http://localhost:4322/${loc === 'hu' ? '' : loc + '/'}index.html`, { waitUntil: 'networkidle' });
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(1500);
  const r = await p.evaluate(() => {
    const sel = innerWidth < 768 ? '.mv-passage__areas' : '.passage__areas';
    return {
      lines: [...document.querySelectorAll(sel)].map((el) => ({
        t: el.textContent.trim().slice(0, 46),
        over: el.scrollWidth - el.clientWidth,
        rows: Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)),
      })),
      docOver: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  const worst = Math.max(0, ...r.lines.map((l) => l.over));
  if (worst > 0 || r.docOver > 0) bad++;
  console.log(`${String(w).padStart(4)}x${h} ${loc}  docOver=${r.docOver}  ` +
    r.lines.map((l) => `[${l.rows}L over=${l.over}] ${l.t}`).join('   '));
  await c.close();
}
await b.close();
console.log(bad ? `\n! ${bad} shapes overflow` : '\nno line overflows its column, in any shape or locale.');
process.exitCode = bad ? 1 : 0;

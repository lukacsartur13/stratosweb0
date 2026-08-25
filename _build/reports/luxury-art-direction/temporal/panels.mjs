/**
 * PANEL GEOMETRY — the authored share against the measured one.
 *
 * `journey.ts` declares how many screens a chapter should get. The layout then
 * decides how many it actually gets, because a panel is at least as tall as
 * the copy in it, and `calibrate()` moves the altitude bounds to follow. So a
 * chapter can be authored at 1.4 screens and rendered at 2.2 without anything
 * being wrong in either file — and nothing in the build reports the gap.
 *
 * This does. It is the arithmetic behind §7's question: has a passage become
 * as long as an act?
 */
import { chromium } from '@playwright/test';
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const W = Number(arg('width', 1440)), H = Number(arg('height', 900));
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal'] });
const c = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, isMobile: W < 768, hasTouch: W < 768 });
const p = await c.newPage();
await p.goto(arg('base', 'http://localhost:4322') + '/index.html', { waitUntil: 'networkidle' });
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(2500);
const rows = await p.evaluate((H) => [...document.querySelectorAll('.panel')].map((el) => {
  const cs = getComputedStyle(el);
  const hold = el.querySelector('.act__hold, .passage__hold');
  const body = el.querySelector('.act__body, .passage__body');
  return {
    stage: el.dataset.stage, level: el.dataset.level,
    share: +cs.getPropertyValue('--share'),
    authoredHold: +(getComputedStyle(hold || el).getPropertyValue('--act-hold') || 0),
    panel: +(el.getBoundingClientRect().height / H).toFixed(3),
    hold: hold ? +(hold.getBoundingClientRect().height / H).toFixed(3) : 0,
    body: body ? +(body.getBoundingClientRect().height / H).toFixed(3) : 0,
    bodyInner: body ? +(body.firstElementChild.getBoundingClientRect().height / H).toFixed(3) : 0,
  };
}), H);
const tot = rows.reduce((s, r) => s + r.panel, 0);
console.log(`${W}x${H}   track ${tot.toFixed(2)} screens`);
console.log('stage                     level      share   hold  +body  = panel   overrun');
for (const r of rows) {
  const overrun = r.panel - Math.max(r.share, r.hold);
  console.log(
    `${r.stage.padEnd(26)}${r.level.padEnd(9)}${r.share.toFixed(2).padStart(6)}` +
    `${r.hold.toFixed(2).padStart(7)}${r.body.toFixed(2).padStart(7)}${r.panel.toFixed(2).padStart(8)}` +
    `${overrun.toFixed(2).padStart(10)}${overrun > 0.35 ? '  <-- taller than authored' : ''}`);
}
await b.close();

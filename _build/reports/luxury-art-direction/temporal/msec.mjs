import { chromium } from '@playwright/test';
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const W = Number(arg('width', 390)), H = Number(arg('height', 844));
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal'] });
const c = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const p = await c.newPage();
await p.goto(arg('base', 'http://localhost:4322') + '/index.html', { waitUntil: 'networkidle' });
await p.evaluate(() => document.fonts.ready);
// Reveal everything so nothing is measured mid-transition.
await p.evaluate(() => document.querySelectorAll('.mv-text,.mv-lines,.mv-copy,.mv-label,.mv-rule,.mv-head').forEach(e => e.classList.add('is-in')));
await p.waitForTimeout(1500);
const rows = await p.evaluate((H) => [...document.querySelectorAll('.mv-sec')].map((s) => ({
  stage: s.dataset.stage, level: s.dataset.level, tier: s.dataset.monument,
  h: Math.round(s.getBoundingClientRect().height),
  screens: +(s.getBoundingClientRect().height / H).toFixed(2),
  marginTop: Math.round(parseFloat(getComputedStyle(s).marginBlockStart)),
  kids: [...s.children].map((k) => `${k.tagName.toLowerCase()}.${(k.className || '').toString().split(' ')[0]}:${Math.round(k.getBoundingClientRect().height)}`),
})), H);
const total = await p.evaluate(() => document.documentElement.scrollHeight);
console.log(`${W}x${H}  document ${total}px = ${(total / H).toFixed(2)} screens`);
for (const r of rows) console.log(`${r.stage.padEnd(24)}${r.level.padEnd(9)}${String(r.tier).padEnd(10)}${String(r.h).padStart(6)}px ${String(r.screens).padStart(6)} sc  +${r.marginTop}mt   ${r.kids.join(' ')}`);
await b.close();

// =============================================================================
// §22 · THE YELLOW BUDGET, COUNTED ON THE RUNNING PAGE.
//
// "Most of the entire homepage journey should contain ZERO yellow" is a claim
// about pixels, and it is not answerable from a stylesheet: `--signal` is
// inherited, overridden per subtree, and reached through gradients, borders and
// transforms. So this walks the page and asks every element what colour it
// actually resolved to, in every property that can paint.
//
// Reports one row per element that paints the signal colour, with the chapter
// it is in and whether that chapter is a master act or a passage.
//
// Usage:  npm run dev:home
//         node experiments/probe-yellow.mjs [--mobile]
// =============================================================================
import { chromium, devices } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const MOBILE = process.argv.includes('--mobile');
const LOCALE = 'hu';
const BASE = process.env.URL ?? `http://localhost:5177/home/${LOCALE}.html`;
const OUT = '_build/reports/luxury-art-direction/continuity';

const browser = await chromium.launch();
mkdirSync(OUT, { recursive: true });
const context = await browser.newContext(
  MOBILE
    ? { ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 }
    : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
);
const page = await context.newPage();
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.addStyleTag({ content: 'vite-error-overlay, .debug, .debug__toggle { display: none !important; }' });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(2500);

const found = await page.evaluate((mobile) => {
  // The signal, as the page defines it, plus the tolerance a gradient stop or a
  // partial alpha lands in. Anything whose red and green are high, whose blue is
  // low and which is not grey.
  const isSignal = (c) => {
    const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.]+))?/.exec(c || '');
    if (!m) return false;
    const [r, g, b] = [+m[1], +m[2], +m[3]];
    const a = m[4] === undefined ? 1 : +m[4];
    return a > 0.05 && r > 150 && g > 130 && b < 110 && r - b > 90 && g - b > 70;
  };
  const PROPS = ['color', 'backgroundColor', 'borderTopColor', 'borderBottomColor', 'borderLeftColor', 'borderRightColor', 'outlineColor', 'textDecorationColor', 'fill', 'stroke', 'boxShadow', 'backgroundImage'];
  const chapterOf = (el) => {
    const sec = el.closest(mobile ? '.mv-sec' : '.panel');
    return sec ? { stage: sec.dataset.stage, level: sec.dataset.level ?? (sec.classList.contains('panel--act') ? 'master' : 'passage') } : { stage: '(chrome)', level: '(chrome)' };
  };
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const hits = PROPS.filter((p) => isSignal(cs[p]));
    if (!hits.length) continue;
    const r = el.getBoundingClientRect();
    // Zero-area boxes paint nothing.
    if (r.width < 1 || r.height < 1) continue;
    out.push({
      ...chapterOf(el),
      sel: `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''}`.slice(0, 70),
      props: hits,
      text: (el.textContent || '').trim().slice(0, 28),
      area: Math.round(r.width * r.height),
    });
  }
  return out;
}, MOBILE);

const surface = MOBILE ? 'mobile-390' : 'desktop-1440';
writeFileSync(`${OUT}/yellow-${surface}.json`, JSON.stringify(found, null, 2));
console.log(`\n${surface} — ${found.length} element(s) paint the signal colour\n`);
for (const f of found) {
  console.log(`  ${String(f.stage).padEnd(24)} ${String(f.level).padEnd(9)} ${f.sel.padEnd(46)} ${f.props.join(',').padEnd(28)} ${JSON.stringify(f.text)}`);
}
await browser.close();

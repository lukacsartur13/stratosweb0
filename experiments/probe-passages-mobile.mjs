// =============================================================================
// §27 · the crossing inventory and its verification, at 390 × 844.
//
// The same question as `probe-crossings.mjs` asks of the desktop: what does a
// visitor actually meet in one frame, and how much of the old visual language
// is in it. The mobile composition is a separate one — native document scroll,
// eleven block-flow chapters — so it needs its own walk rather than a viewport
// switch on the desktop probe.
// =============================================================================
import { chromium, devices } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const TAG = arg('tag', 'before');
const LOCALE = arg('locale', 'hu');
const BASE = process.env.URL ?? `http://localhost:5177/home/${LOCALE}.html`;
const OUT = `_build/reports/luxury-art-direction/continuity/${TAG}/mobile`;

const STAGES = ['cloud-entry', 'cloud-breakthrough', 'system', 'process'];

/** §6's list, as selectors, in the portrait composition's own class names. */
const OLD = {
  'rails': '.mv-spine__rule, .mv-rule',
  'yellow index numerals': '.mv-layer__index, .mv-check__index',
  'multi-column technical grid': '.mv-check__grid',
  'chapter marker / eyebrow': '.mv-sec:not([data-level="master"]) .mv-eyebrow',
  'altitude decoration': '.mv-eyebrow__at, .mv-check__at, .mv-spine__at',
  'card-like information block': '.mv-check, .mv-layer',
  'mono microcopy cluster': '.mv-notes',
  'word-level emphasis in a statement': '.mv-sec:not([data-level="master"]) .mv-title em',
};

const browser = await chromium.launch();
mkdirSync(OUT, { recursive: true });
const context = await browser.newContext({
  ...devices['iPhone 13'],
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
});
const page = await context.newPage();
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.addStyleTag({ content: 'vite-error-overlay, .debug, .debug__toggle { display: none !important; }' });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(2500);

const report = [];
for (const stage of STAGES) {
  // Walk the chapter in screen steps, so the measurement is of what a thumb
  // actually produces rather than of one lucky offset.
  const steps = await page.evaluate((s) => {
    const el = document.querySelector(`.mv-sec[data-stage="${s}"]`);
    const n = Math.max(1, Math.ceil(el.offsetHeight / innerHeight));
    return { top: el.offsetTop, n, height: +(el.offsetHeight / innerHeight).toFixed(2) };
  }, stage);

  for (let i = 0; i < steps.n; i++) {
    await page.evaluate(({ top, i }) => scrollTo({ top: top + i * innerHeight * 0.92, behavior: 'instant' }), { top: steps.top, i });
    await page.waitForTimeout(900);
    const state = await page.evaluate((OLD) => {
      const vh = innerHeight;
      const legible = (el) => {
        const r = el.getBoundingClientRect();
        if (r.bottom < 8 || r.top > vh - 8 || r.width < 2 || r.height < 2) return false;
        let o = 1, n = el;
        while (n && n !== document.documentElement) { o *= parseFloat(getComputedStyle(n).opacity || '1'); n = n.parentElement; }
        return o > 0.06;
      };
      const objects = [...document.querySelectorAll(
        '.mv-sec h1, .mv-sec h2, .mv-sec h3, .mv-sec p, .mv-sec li, .mv-sec dt, .mv-sec dd, .mv-sec img',
      )].filter(legible);
      const old = {};
      for (const [k, sel] of Object.entries(OLD)) old[k] = [...document.querySelectorAll(sel)].filter(legible).length;
      const px = objects.map((el) => Math.round(parseFloat(getComputedStyle(el).fontSize)));
      return {
        count: objects.length,
        largestPx: Math.max(0, ...px),
        old,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    }, OLD);
    if (i === 0) await page.screenshot({ path: `${OUT}/${stage}-${LOCALE}.png` });
    else if (i === 1) await page.screenshot({ path: `${OUT}/${stage}-${LOCALE}-b.png` });
    report.push({ stage, step: i, screens: steps.height, ...state });
    const flags = Object.entries(state.old).filter(([, n]) => n > 0).map(([k, n]) => `${k}×${n}`);
    process.stdout.write(
      `${stage.padEnd(20)} +${i}  ${String(steps.height).padStart(5)} scr  objects:${String(state.count).padStart(3)}  ` +
      `max:${String(state.largestPx).padStart(3)}px  overflow:${state.overflow}\n          ${flags.join(' · ') || '—'}\n`,
    );
  }
}
writeFileSync(`${OUT}/inventory-${LOCALE}.json`, JSON.stringify(report, null, 2));
await browser.close();
console.log(`\nwrote ${OUT}`);

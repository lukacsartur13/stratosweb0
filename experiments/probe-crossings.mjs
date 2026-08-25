// =============================================================================
// PHASE A · the crossing inventory.
//
// §36 asks for a complete inventory of every non-master visual state a visitor
// meets on the homepage, recorded BEFORE anything is styled. This measures it
// off the running page rather than off the source, because the question is what
// the visitor encounters and the source is what was intended.
//
// For every panel that is not a master act it records: the altitude band, the
// stage, every visible element with its box and its type size, the count of
// simultaneously visible objects, and which of the rejected old-language
// patterns are present in it.
//
// Usage:  npm run dev:home                       # :5177
//         node experiments/probe-crossings.mjs --tag before
// =============================================================================
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const TAG = arg('tag', 'before');
const LOCALE = arg('locale', 'hu');
const BASE = process.env.URL ?? `http://localhost:5177/home/${LOCALE}.html`;
const OUT = `_build/reports/luxury-art-direction/continuity/${TAG}`;

/** Where inside each panel to stand, in screens from its top. */
const SAMPLES = [
  { id: 'x1', stage: 'cloud-entry', at: 0.2 },
  { id: 'x1b', stage: 'cloud-entry', at: 1.0 },
  { id: 'x2', stage: 'cloud-breakthrough', at: 0.2 },
  { id: 'x2b', stage: 'cloud-breakthrough', at: 0.9 },
  { id: 'x3', stage: 'system', at: 0.2 },
  { id: 'x3b', stage: 'system', at: 1.3 },
  { id: 'x3c', stage: 'system', at: 2.0 },
  { id: 'x3d', stage: 'system', at: 2.7 },
  { id: 'x4', stage: 'process', at: 0.2 },
  { id: 'x4b', stage: 'process', at: 1.4 },
  { id: 'x4c', stage: 'process', at: 2.6 },
  { id: 'x4d', stage: 'process', at: 3.8 },
  { id: 'x4e', stage: 'process', at: 4.9 },
];

/** The old visual language, as selectors. §6 of the brief, item by item. */
const OLD = {
  'rails': '.rail, .panel__rail, [class*="rail"]',
  'orbit / concentric geometry': '.system__ring, .orbit, [class*="orbit"], [class*="concentric"]',
  'yellow index numerals': '.system__ring-index, .check__index',
  'multi-column technical grid': '.check__grid, .system',
  'chapter marker / eyebrow': '.panel__eyebrow',
  'altitude decoration': '.panel__altitude, .check__at',
  'card-like information block': '.check, .system__ring',
  'notes cluster': '.notes',
  'horizon fragment': '.horizon',
};

const browser = await chromium.launch();
mkdirSync(OUT, { recursive: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await context.newPage();
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.addStyleTag({ content: '.debug, .debug__toggle { display: none !important; }' });
await page.evaluate(() => document.fonts.ready);
await page.waitForFunction(() => !!globalThis.__stratos, { timeout: 30_000 });
await page.waitForTimeout(2500);

const report = [];
for (const s of SAMPLES) {
  await page.evaluate(({ stage, at }) => {
    const p = document.querySelector(`.panel[data-stage="${stage}"]`);
    scrollTo({ top: p.offsetTop + at * innerHeight, behavior: 'instant' });
  }, s);
  await page.waitForTimeout(2200);

  const state = await page.evaluate((OLD) => {
    const vw = innerWidth, vh = innerHeight;
    const legible = (el) => {
      const r = el.getBoundingClientRect();
      if (r.bottom < 8 || r.top > vh - 8 || r.width < 2 || r.height < 2) return false;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') return false;
      // Opacity is inherited through the ancestor chain here — every ramp on
      // this page is an opacity on a wrapper.
      let o = 1, n = el;
      while (n && n !== document.documentElement) { o *= parseFloat(getComputedStyle(n).opacity || '1'); n = n.parentElement; }
      return o > 0.06;
    };
    // Leaf-ish text nodes and images: the things a visitor counts as objects.
    const objects = [...document.querySelectorAll(
      '.panel h1, .panel h2, .panel h3, .panel p, .panel li, .panel img, .panel a, .panel dt, .panel dd, .panel span.system__ring-index, .panel span.check__index'
    )].filter(legible).map((el) => {
      const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
      return {
        sel: el.className ? `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}` : el.tagName.toLowerCase(),
        px: Math.round(parseFloat(cs.fontSize)),
        colour: cs.color,
        box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
        text: (el.textContent || '').trim().slice(0, 60),
      };
    });
    const old = {};
    for (const [name, sel] of Object.entries(OLD)) {
      old[name] = [...document.querySelectorAll(sel)].filter(legible).length;
    }
    // Yellow, as the page actually paints it.
    const signal = getComputedStyle(document.documentElement).getPropertyValue('--signal').trim();
    const yellow = objects.filter((o) => /rgb\(\s*2[0-9]{2},\s*1[0-9]{2},\s*[0-9]{1,2}\)/.test(o.colour)).length;
    return {
      metres: Math.round(globalThis.__stratos.journey.altitude),
      stage: globalThis.__stratos.journey.stage,
      instrument: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--instrument') || '0'),
      objects, count: objects.length, old, yellow, signal,
      largestPx: Math.max(0, ...objects.map((o) => o.px)),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  }, OLD);

  await page.screenshot({ path: `${OUT}/${s.id}-${LOCALE}.png` });
  report.push({ ...s, ...state });
  const flags = Object.entries(state.old).filter(([, n]) => n > 0).map(([k, n]) => `${k}×${n}`);
  process.stdout.write(
    `${s.id.padEnd(4)} ${s.stage.padEnd(20)} ${String(state.metres).padStart(6)} m  ` +
    `objects:${String(state.count).padStart(3)}  max:${String(state.largestPx).padStart(3)}px  ` +
    `yellow:${state.yellow}  instr:${state.instrument.toFixed(2)}\n        ${flags.join(' · ') || '—'}\n`,
  );
}
writeFileSync(`${OUT}/inventory-${LOCALE}.json`, JSON.stringify(report, null, 2));
await browser.close();
console.log(`\nwrote ${OUT}/inventory-${LOCALE}.json`);

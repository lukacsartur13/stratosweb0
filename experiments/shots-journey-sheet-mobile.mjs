// =============================================================================
// §47, §48, §27 · THE FULL-JOURNEY REVIEW SHEET, IN PORTRAIT.
//
// The same question as the desktop sheet asks — does the whole journey speak
// one visual language — of the composition a phone actually renders, which is a
// separate one rather than the desktop at a narrower viewport.
//
// Usage:  npm run dev:home
//         node experiments/shots-journey-sheet-mobile.mjs
// =============================================================================
import { chromium, devices } from '@playwright/test';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const LOCALE = arg('locale', 'hu');
const BASE = process.env.URL ?? `http://localhost:5177/home/${LOCALE}.html`;
const OUT = `_build/reports/luxury-art-direction/continuity/after/journey-mobile`;

/** `at` is in screens from the chapter's own top, as on the desktop sheet. */
const STATES = [
  { id: '01', stage: 'calibration', at: 0, level: 'master', name: 'I · Ground' },
  { id: '02', stage: 'initial-ascent', at: 0, level: 'master', name: 'II · Noise' },
  { id: '03', stage: 'initial-ascent', at: 0.85, level: 'structure', name: 'II · body' },
  { id: '04', stage: 'lower-atmosphere', at: 0, level: 'master', name: 'III · System' },
  { id: '05', stage: 'lower-atmosphere', at: 1.1, level: 'structure', name: 'III · the ladder' },
  { id: '06', stage: 'cloud-entry', at: 0, level: 'passage', name: 'passage — a website on its own' },
  { id: '07', stage: 'cloud-breakthrough', at: 0, level: 'passage', name: 'passage — the same direction' },
  { id: '08', stage: 'selected-work', at: 0, level: 'master', name: 'IV · Proof' },
  { id: '09', stage: 'selected-work', at: 1.0, level: 'structure', name: 'IV · the case' },
  { id: '10', stage: 'system', at: 0, level: 'passage', name: 'passage — nine areas' },
  { id: '11', stage: 'system', at: 0.9, level: 'structure', name: 'passage body — a layer' },
  { id: '12', stage: 'process', at: 0, level: 'passage', name: 'passage — seven checkpoints' },
  { id: '13', stage: 'process', at: 1.1, level: 'structure', name: 'passage body — a checkpoint' },
  { id: '14', stage: 'process', at: 2.4, level: 'structure', name: 'passage body — later' },
  { id: '15', stage: 'stratosphere-transition', at: 0, level: 'master', name: 'V · High altitude' },
  { id: '16', stage: 'full-stratosphere', at: 0, level: 'master', name: 'VI · Arrival' },
  { id: '17', stage: 'full-stratosphere', at: 1.0, level: 'structure', name: 'VI · the closing matter' },
  { id: '18', stage: 'destination', at: 0, level: 'master', name: 'action — ready to ascend?' },
];

const browser = await chromium.launch();
mkdirSync(OUT, { recursive: true });
const page = await (await browser.newContext({
  ...devices['iPhone 13'],
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
})).newPage();
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.addStyleTag({ content: 'vite-error-overlay, .debug, .debug__toggle { display: none !important; }' });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(3000);

const report = [];
for (const s of STATES) {
  await page.evaluate(({ stage, at }) => {
    const el = document.querySelector(`.mv-sec[data-stage="${stage}"]`);
    scrollTo({ top: el.offsetTop + at * innerHeight, behavior: 'instant' });
  }, s);
  // The reveals are IntersectionObserver-driven and transition in.
  await page.waitForTimeout(1400);
  await page.screenshot({ path: `${OUT}/${s.id}-${LOCALE}.png` });
  report.push(s);
  process.stdout.write(`${s.id} ${s.level.padEnd(9)} ${s.name}\n`);
}
writeFileSync(`${OUT}/states-${LOCALE}.json`, JSON.stringify(report, null, 2));

const card = (s, w) => `
  <figure style="margin:0;width:${w}px">
    <img src="data:image/png;base64,${readFileSync(`${OUT}/${s.id}-${LOCALE}.png`).toString('base64')}" style="display:block;width:100%;height:auto;border:1px solid #1b2027">
    <figcaption style="padding:6px 2px 0;font:10px/1.4 ui-monospace,monospace;color:#6d7681">
      <b style="color:#aeb7c1">${s.id}</b> ${s.name}<br>${s.level}
    </figcaption>
  </figure>`;

async function sheet(name, w, cols) {
  const p = await (await browser.newContext({ viewport: { width: cols * (w + 18) + 40, height: 800 }, deviceScaleFactor: 1 })).newPage();
  await p.setContent(
    `<body style="margin:0;padding:20px;background:#07090d;display:grid;grid-template-columns:repeat(${cols},${w}px);grid-auto-rows:min-content;align-content:start;gap:26px 18px">` +
    report.map((s) => card(s, w)).join('') + '</body>',
  );
  await p.screenshot({ path: `${OUT}/${name}-${LOCALE}.png`, fullPage: true });
  console.log(`wrote ${OUT}/${name}-${LOCALE}.png`);
}
await sheet('sheet', 250, 6);
await sheet('thumbnails', 104, 18);
await browser.close();

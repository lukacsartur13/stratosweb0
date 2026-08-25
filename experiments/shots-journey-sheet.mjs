// =============================================================================
// §47 · THE FULL-JOURNEY REVIEW SHEET.
//
// "This sheet is now more important than another six-frame master sheet. The
// question is: DOES THE ENTIRE JOURNEY SPEAK ONE VISUAL LANGUAGE?"
//
// So it captures the whole track in chronological order — every master act,
// every passage, the silences between them and the structural states — rather
// than the seven frames the previous phase's sheet showed. Twenty states at
// 1440 × 900, and §48's second version of the same twenty at thumbnail scale,
// where the only question is whether the acts still read as stronger than
// everything around them.
//
// The states are named by what they are, not by where they are, so the sheet
// can be read against the classification in §B of the report.
//
// Usage:  npm run dev:home
//         node experiments/shots-journey-sheet.mjs [--locale hu] [--tag after]
// =============================================================================
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const TAG = arg('tag', 'after');
const LOCALE = arg('locale', 'hu');
const BASE = process.env.URL ?? `http://localhost:5177/home/${LOCALE}.html`;
const OUT = process.env.OUT ?? `_build/reports/luxury-art-direction/continuity/${TAG}/journey`;

/**
 * Twenty states, in the order a visitor meets them.
 *
 * `at` is in SCREENS from the chapter's own top, so a position is stated in the
 * unit the composition is authored in and stays meaningful when a chapter's
 * length changes. `level` is what the state is supposed to be, and it is what
 * §48 is judged against: master acts obvious, passages quiet, silences empty.
 */
const STATES = [
  { id: '01', stage: 'calibration', at: 0.35, level: 'master', name: 'I · Ground' },
  { id: '02', stage: 'calibration', at: 1.45, level: 'silence', name: 'silence — the ground leaves' },
  { id: '03', stage: 'initial-ascent', at: 0.35, level: 'master', name: 'II · Noise' },
  { id: '04', stage: 'initial-ascent', at: 1.55, level: 'structure', name: 'II · body — the diagnosis' },
  { id: '05', stage: 'lower-atmosphere', at: 0.35, level: 'master', name: 'III · System' },
  { id: '06', stage: 'lower-atmosphere', at: 1.9, level: 'structure', name: 'III · body — the ladder' },
  { id: '07', stage: 'cloud-entry', at: 0.2, level: 'passage', name: 'passage — a website on its own' },
  { id: '08', stage: 'cloud-entry', at: 1.05, level: 'structure', name: 'passage body — the symptoms' },
  { id: '09', stage: 'cloud-breakthrough', at: 0.2, level: 'passage', name: 'passage — the same direction' },
  { id: '10', stage: 'cloud-breakthrough', at: 0.95, level: 'silence', name: 'silence — before the proof' },
  { id: '11', stage: 'selected-work', at: 0.35, level: 'master', name: 'IV · Proof' },
  { id: '12', stage: 'selected-work', at: 1.85, level: 'structure', name: 'IV · body — the case' },
  { id: '13', stage: 'system', at: 0.2, level: 'passage', name: 'passage — nine areas' },
  { id: '14', stage: 'system', at: 1.5, level: 'structure', name: 'passage body — a layer' },
  { id: '15', stage: 'process', at: 0.2, level: 'passage', name: 'passage — seven checkpoints' },
  // TWO STATES, NOT THREE — phase 4. The third stood 4.6 screens into a chapter
  // that is 2.23 screens long now: the compressed passage is a statement frame
  // and one editorial beat, and a sheet with a third process frame on it would
  // be photographing the next chapter and captioning it as this one.
  { id: '16', stage: 'process', at: 1.2, level: 'structure', name: 'passage body — the three principles' },
  { id: '17', stage: 'stratosphere-transition', at: 0.35, level: 'master', name: 'V · High altitude' },
  { id: '18', stage: 'full-stratosphere', at: 0.35, level: 'master', name: 'VI · Arrival' },
  { id: '19', stage: 'destination', at: 0.35, level: 'master', name: 'action — ready to ascend?' },
];

const browser = await chromium.launch();
mkdirSync(OUT, { recursive: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })).newPage();
await page.addInitScript(() => {
  // The idle ring rotation makes two runs of the same frame differ.
  let v;
  Object.defineProperty(globalThis, '__stratos', {
    configurable: true,
    get: () => v,
    set: (x) => { v = x; if (x?.journey?.debug) x.journey.debug.ringRotation = 0; },
  });
});
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.addStyleTag({ content: 'vite-error-overlay, .debug, .debug__toggle { display: none !important; }' });
await page.evaluate(() => document.fonts.ready);
await page.waitForFunction(() => !!globalThis.__stratos, { timeout: 30_000 });
await page.waitForTimeout(3000);

const report = [];
for (const s of STATES) {
  await page.evaluate(({ stage, at }) => {
    const el = document.querySelector(`.panel[data-stage="${stage}"]`);
    scrollTo({ top: el.offsetTop + at * innerHeight, behavior: 'instant' });
  }, s);
  await page.waitForTimeout(2400);
  const state = await page.evaluate(() => ({
    metres: Math.round(globalThis.__stratos.journey.altitude),
    stage: globalThis.__stratos.journey.stage,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  await page.screenshot({ path: `${OUT}/${s.id}-${LOCALE}.png` });
  report.push({ ...s, ...state });
  process.stdout.write(`${s.id} ${String(state.metres).padStart(6)} m  ${s.level.padEnd(9)} ${s.name}\n`);
}
writeFileSync(`${OUT}/states-${LOCALE}.json`, JSON.stringify(report, null, 2));

// ---------------------------------------------------------------- the sheets
const card = (s, w) => `
  <figure style="margin:0;width:${w}px">
    <img src="data:image/png;base64,${readFileSync(`${OUT}/${s.id}-${LOCALE}.png`).toString('base64')}" style="display:block;width:100%;height:auto;border:1px solid #1b2027">
    <figcaption style="padding:6px 2px 0;font:10px/1.4 ui-monospace,monospace;color:#6d7681">
      <b style="color:#aeb7c1">${s.id}</b> ${s.name}<br>${s.metres} m · ${s.level}
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

// §47 — readable, four across.
await sheet('sheet', 320, 4);
// §48 — thumbnail. Small enough that no word can be read, which is the point:
// the only thing left to judge is the silhouette.
await sheet('thumbnails', 132, 10);

await browser.close();

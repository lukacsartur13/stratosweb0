/**
 * §24 — does one typographic system survive Hungarian, English and German?
 *
 * The system is NOT redesigned per locale. What is measured is whether each
 * statement, at each direction's monument size, still fits the 1232px measure
 * on the line breaks authored for Hungarian — and where it does not, what the
 * locale-specific break has to be.
 */
import { chromium } from '@playwright/test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
const here = fileURLToPath(new URL('.', import.meta.url));

const MEASURE = 1232;                          // 1440 − 2 × 104
const DIRECTIONS = {
  A: { hero: { px: 116, wdth: '100%', ls: '-.032em' }, system: { px: 108, wdth: '100%', ls: '-.032em' }, altitude: { px: 124, wdth: '100%', ls: '-.032em' } },
  B: { hero: { px: 128, wdth: '100%', ls: '-.036em' }, system: { px: 132, wdth: '100%', ls: '-.036em' }, altitude: { px: 140, wdth: '100%', ls: '-.036em' } },
  C: { hero: { px: 148, wdth: '88%',  ls: '-.026em' }, system: { px: 152, wdth: '88%',  ls: '-.026em' }, altitude: { px: 168, wdth: '88%',  ls: '-.026em' } },
};
/* The Hungarian breaks the study authored, and the same statement in the two
   other locales broken at its own most natural point. All strings verbatim
   from locales/messages.ts. */
const COPY = {
  hero: {
    hu: [['Magasságot', 'építünk.']],
    en: [['Altitude', 'is what we build.'], ['Altitude is what', 'we build.']],
    de: [['Höhe', 'bauen wir.'], ['Höhe bauen wir.']],
  },
  system: {
    hu: [['Hat terület,', 'egy rendszer.']],
    en: [['Six areas,', 'one system.']],
    de: [['Sechs Bereiche,', 'ein System.']],
  },
  altitude: {
    hu: [['Innen már látni', 'a görbületet.'], ['Innen már', 'látni a görbületet.']],
    en: [['From here you can', 'see the curvature.']],
    de: [['Von hier aus ist', 'die Krümmung zu sehen.'], ['Von hier aus ist die', 'Krümmung zu sehen.'], ['Von hier aus', 'ist die Krümmung', 'zu sehen.']],
  },
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(pathToFileURL(`${here}font-audit.html`).href, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);

const out = await page.evaluate(({ DIRECTIONS, COPY, MEASURE }) => {
  const el = document.getElementById('p');
  const width = (text, spec) => {
    Object.assign(el.style, {
      fontFamily: "'Archivo'", fontWeight: '400', fontStyle: 'normal',
      fontSize: `${spec.px}px`, fontStretch: spec.wdth, letterSpacing: spec.ls,
      whiteSpace: 'pre',
    });
    el.textContent = text;
    return Math.round(el.getBoundingClientRect().width * 10) / 10;
  };
  const rows = [];
  for (const [dir, scenes] of Object.entries(DIRECTIONS)) {
    for (const [scene, spec] of Object.entries(scenes)) {
      for (const [loc, options] of Object.entries(COPY[scene])) {
        options.forEach((lines, i) => {
          const widths = lines.map(l => width(l, spec));
          const widest = Math.max(...widths);
          rows.push({
            dir, scene, loc, option: i, lines: lines.length,
            text: lines.join(' / '),
            widestPx: widest,
            overflowPx: Math.round((widest - MEASURE) * 10) / 10,
            fits: widest <= MEASURE,
          });
        });
      }
    }
  }
  return rows;
}, { DIRECTIONS, COPY, MEASURE });

writeFileSync(`${here}locale-fit.json`, JSON.stringify(out, null, 2));
const hdr = `dir scene      loc opt lines widest   vs 1232   setting`;
console.log(hdr); console.log('-'.repeat(96));
for (const r of out) {
  console.log(`${r.dir}   ${r.scene.padEnd(10)} ${r.loc}  ${r.option}   ${r.lines}    ${String(r.widestPx).padStart(6)}  ${(r.fits ? 'fits' : `OVER +${r.overflowPx}`).padEnd(11)} ${r.text}`);
}
await browser.close();

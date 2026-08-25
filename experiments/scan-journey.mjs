// =============================================================================
// THE WHOLE SCROLL, NOT ONLY THE MASTER FRAMES. §49.
//
// Steps down the track and asks one question at every step: is there anything
// legible in this frame, and if so, how much and how big?
//
// It exists because master-frame matching cannot see the two failures that
// matter most between the frames — a stretch of journey with nothing in it, and
// two statements legible at once — and because the six-act design deliberately
// permits SILENCE, so "empty" has to be measured rather than assumed to be a
// bug. A composed silence is a short one between two frames; a dead stage is a
// long one, and the difference is a number.
//
// Usage:  npm run dev:home
//         node experiments/scan-journey.mjs [--steps 140] [--locale hu]
// =============================================================================
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const STEPS = Number(arg('steps', 140));
const LOCALE = arg('locale', 'hu');
const WIDTH = Number(arg('width', 1440));
const HEIGHT = Number(arg('height', 900));
const OUT = process.env.OUT ?? '_build/reports/luxury-art-direction/production';

/** Anything below this is not text a visitor can read. */
const LEGIBLE = 0.14;

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT } });
const page = await context.newPage();
const BASE = process.env.SCAN_URL ?? `http://localhost:5177/home/${LOCALE}.html`;
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
// The composition publisher's first pass. `__stratos` is a development handle
// and is compiled out of the production build, so the scan waits on a value
// the shipped page actually publishes.
await page.waitForFunction(
  () => getComputedStyle(document.documentElement).getPropertyValue('--instrument').trim() !== '',
  { timeout: 30_000 },
);
await page.waitForTimeout(2500);

const track = await page.evaluate(() => {
  const t = document.querySelector('[data-testid="journey-track"]');
  return { top: t.offsetTop, height: t.offsetHeight };
});

const samples = [];
for (let i = 0; i <= STEPS; i++) {
  const y = track.top + ((track.height - HEIGHT) * i) / STEPS;
  await page.evaluate((top) => scrollTo({ top, behavior: 'instant' }), y);
  await page.waitForTimeout(90);
  const s = await page.evaluate((legible) => {
    /** Effective opacity: an element inside a faded ancestor is faded. */
    const effective = (el) => {
      let o = 1;
      for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
        const v = parseFloat(getComputedStyle(n).opacity);
        if (Number.isFinite(v)) o *= v;
        if (o < 0.005) return 0;
      }
      return o;
    };
    // Every text leaf inside a panel, so the measure cannot drift out of step
    // with the markup — see the same note in `six-acts.spec.ts`.
    const all = [...document.querySelectorAll('.panel :is(p, h1, h2, h3, h4, li, dt, dd, figcaption, a)')].filter(
      (el) => (el.textContent || '').trim().length > 1,
    );
    const nodes = all.filter((el) => !all.some((other) => other !== el && el.contains(other)));
    let ink = 0;
    let biggest = 0;
    let biggestText = '';
    const statements = [];
    for (const el of nodes) {
      const r = el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight || r.width < 2 || r.height < 2) continue;
      const o = effective(el);
      if (o < legible) continue;
      const visible = Math.min(r.bottom, innerHeight) - Math.max(r.top, 0);
      ink += r.width * visible * o;
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (size > biggest) { biggest = size; biggestText = (el.textContent || '').trim().slice(0, 40); }
      // A "statement" is display type. Two of them legible in one frame is the
      // collision §49 asks about, and it is the one thing the master frames
      // cannot show.
      if (size >= 56) statements.push({ text: (el.textContent || '').trim().slice(0, 32), size: Math.round(size), o: +o.toFixed(2) });
    }
    return {
      metres: Math.round(Number(getComputedStyle(document.documentElement).getPropertyValue('--alt')) * 30000),
      stage: (document.querySelector('[data-testid="altitude-stage"]')?.textContent ?? '').trim(),
      ink: Math.round(ink),
      biggest: Math.round(biggest),
      biggestText,
      statements,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  }, LEGIBLE);
  samples.push({ i, y: Math.round(y), p: +(i / STEPS).toFixed(4), ...s });
}

// --- the findings ------------------------------------------------------------
const frameArea = WIDTH * HEIGHT;
const EMPTY = 0.004; // 0.4% of the frame covered in legible ink
const empties = samples.map((s) => s.ink / frameArea < EMPTY);

const runs = [];
let start = -1;
for (let i = 0; i <= empties.length; i++) {
  if (empties[i]) { if (start < 0) start = i; }
  else if (start >= 0) {
    runs.push({
      fromStep: start, toStep: i - 1,
      screens: +(((i - start) / STEPS) * (track.height / HEIGHT)).toFixed(2),
      fromMetres: samples[start].metres, toMetres: samples[i - 1].metres,
      stages: [...new Set(samples.slice(start, i).map((s) => s.stage))],
    });
    start = -1;
  }
}

const collisions = samples
  .filter((s) => s.statements.length > 1)
  .map((s) => ({ p: s.p, metres: s.metres, stage: s.stage, statements: s.statements }));

const altitudes = samples.map((s) => s.metres);
let monotonic = true;
for (let i = 1; i < altitudes.length; i++) if (altitudes[i] < altitudes[i - 1] - 1) monotonic = false;

const overflow = samples.filter((s) => s.overflow > 0).map((s) => ({ p: s.p, overflow: s.overflow }));

const result = {
  viewport: [WIDTH, HEIGHT], locale: LOCALE, steps: STEPS,
  trackScreens: +(track.height / HEIGHT).toFixed(2),
  monotonicAltitude: monotonic,
  longestSilenceScreens: runs.reduce((m, r) => Math.max(m, r.screens), 0),
  silences: runs,
  statementCollisions: collisions,
  horizontalOverflow: overflow,
  samples,
};

mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/journey-scan-${LOCALE}-${WIDTH}x${HEIGHT}.json`, JSON.stringify(result, null, 1));

console.log(`track ${result.trackScreens} screens · altitude monotonic: ${monotonic}`);
console.log(`longest silence: ${result.longestSilenceScreens} screens`);
for (const r of runs) console.log(`  silence ${r.screens} screens · ${r.fromMetres}–${r.toMetres} m · ${r.stages.join(', ')}`);
console.log(`statement collisions: ${collisions.length}`);
for (const c of collisions.slice(0, 8)) console.log(`  ${c.metres} m ${c.stage}: ${c.statements.map((s) => `"${s.text}" ${s.size}px @${s.o}`).join(' + ')}`);
console.log(`horizontal overflow samples: ${overflow.length}`);

await browser.close();

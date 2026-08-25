// =============================================================================
// §46 · MASTER FRAME PROTECTION, MEASURED.
//
// "After implementing crossings, capture all approved master frames again. They
// must remain visually equivalent to the accepted implementation. A crossing
// change must not accidentally alter master vertical positioning, monument
// scale, master Altimeter size, Rapidkert framing, High Altitude composition,
// Arrival placement, Action composition."
//
// Seven of those eight are GEOMETRY, and geometry is the honest thing to
// compare: a pixel diff over a live WebGL scene fails on a driver update and
// says nothing about whether the composition moved. So this reads the frames'
// own boxes — every object's rectangle in the reference frame's coordinates,
// and every monument's size — and compares them to a baseline captured the same
// way.
//
//   node experiments/probe-master-frames.mjs --tag after
//   node experiments/probe-master-frames.mjs --tag after --against baseline
//
// A frame that has moved reports which object moved and by how much, in
// reference pixels, which is what a designer can act on.
//
// AND IT PHOTOGRAPHS THEM AGAIN, against the accepted implementation's own
// published stills — `luxury-art-direction/production/after/`, which are the
// captures §46 calls "the accepted implementation". The comparison is reported
// as a share of pixels that differ rather than as a pass/fail: the frames sit
// on a live 3D scene, so a driver, a decode order or a damped light one frame
// early moves pixels that no design decision moved. What the number is for is
// SIZE — a composition that shifted is tens of per cent, and a scene that
// settled differently is a fraction of one.
//
// The side-by-side sheet it writes is the artefact a human judges; the number
// is what says whether they need to look hard.
// =============================================================================
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { luminance } from './png-luma.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const TAG = arg('tag', 'after');
const AGAINST = arg('against', null);
const LOCALE = arg('locale', 'hu');
const BASE = process.env.URL ?? `http://localhost:5177/home/${LOCALE}.html`;
const OUT = '_build/reports/luxury-art-direction/continuity/master-frames';
/** Reference pixels. Half a pixel of the study's own grid. */
const TOLERANCE = 0.5;

/** The act, its stage, and the accepted implementation's still for it. */
const ACTS = [
  ['i', 'calibration', 'a1'],
  ['ii', 'initial-ascent', 'a2'],
  ['iii', 'lower-atmosphere', 'a3'],
  ['iv', 'selected-work', 'a4'],
  ['v', 'stratosphere-transition', 'a5'],
  ['vi', 'full-stratosphere', 'a6'],
  ['action', 'destination', 'a6b'],
];

/** Where the accepted implementation's stills live. */
const ACCEPTED = '_build/reports/luxury-art-direction/production/after';

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })).newPage();
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.addStyleTag({ content: 'vite-error-overlay, .debug, .debug__toggle { display: none !important; }' });
await page.evaluate(() => document.fonts.ready);
await page.waitForFunction(() => !!globalThis.__stratos, { timeout: 30_000 });
await page.waitForTimeout(3000);

const measured = {};
for (const [act, stage, still] of ACTS) {
  await page.evaluate((s) => {
    const el = document.querySelector(`.panel[data-stage="${s}"]`);
    scrollTo({ top: el.offsetTop + 0.4 * innerHeight, behavior: 'instant' });
  }, stage);
  await page.waitForTimeout(2400);

  measured[act] = await page.evaluate((act) => {
    const field = document.querySelector(`[data-act="${act}"] .act__field`);
    const f = field.getBoundingClientRect();
    // One reference pixel, so every number below is in the study's own grid and
    // is comparable across viewports.
    const u = f.width / 1440;
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return [
        +((r.x - f.x) / u).toFixed(2),
        +((r.y - f.y) / u).toFixed(2),
        +(r.width / u).toFixed(2),
        +(r.height / u).toFixed(2),
      ];
    };
    const objects = {};
    for (const el of field.querySelectorAll(
      '.act__monument, .act__editorial, .act__micro, .act__action, .act__index, .act__marks, .act__shot, .act__routes',
    )) {
      const key = [...el.classList].find((c) => c.startsWith('act__')) ?? el.tagName.toLowerCase();
      objects[key] = box(el);
    }
    const monument = field.querySelector('.act__monument');
    return {
      objects,
      monumentPx: monument ? +(parseFloat(getComputedStyle(monument).fontSize) / u).toFixed(2) : 0,
      // The instrument, as the page publishes it — the master Altimeter size
      // §46 protects is this number and the placement in `acts.ts`.
      instrument: +Number(
        getComputedStyle(document.documentElement).getPropertyValue('--instrument'),
      ).toFixed(3),
    };
  }, act);
  await page.screenshot({ path: `${OUT}/${TAG}-${still}-${LOCALE}.png` });
  process.stdout.write(`${act.padEnd(7)} ${Object.keys(measured[act].objects).length} objects · monument ${measured[act].monumentPx}u · instrument ${measured[act].instrument}\n`);
}

writeFileSync(`${OUT}/${TAG}-${LOCALE}.json`, JSON.stringify(measured, null, 2));

// ---------------------------------------------------------------------------
// The photographic half of §46.
// ---------------------------------------------------------------------------
const photo = [];
for (const [act, , still] of ACTS) {
  const acceptedPath = `${ACCEPTED}/${still}-${LOCALE}.png`;
  if (!existsSync(acceptedPath)) { photo.push({ act, still, note: 'no accepted still' }); continue; }
  const a = luminance(acceptedPath);
  const b = luminance(`${OUT}/${TAG}-${still}-${LOCALE}.png`);
  if (a.width !== b.width || a.height !== b.height) {
    photo.push({ act, still, note: `size ${a.width}x${a.height} vs ${b.width}x${b.height}` });
    continue;
  }
  let sum = 0, over8 = 0, over32 = 0;
  for (let i = 0; i < a.lum.length; i++) {
    const d = Math.abs(a.lum[i] - b.lum[i]);
    sum += d;
    if (d > 8) over8++;
    if (d > 32) over32++;
  }
  const n = a.lum.length;
  photo.push({
    act, still,
    meanDelta: +(sum / n).toFixed(2),
    /** Anything an eye could notice at all. */
    pctOver8: +((over8 / n) * 100).toFixed(2),
    /** A composition that moved. Type against field is 200+ levels apart. */
    pctOver32: +((over32 / n) * 100).toFixed(2),
  });
}
writeFileSync(`${OUT}/photo-${TAG}-${LOCALE}.json`, JSON.stringify(photo, null, 2));
console.log('\n§46 · against the accepted implementation\'s published stills');
for (const p of photo) {
  console.log(
    p.note
      ? `  ${p.act.padEnd(7)} ${p.note}`
      : `  ${p.act.padEnd(7)} mean ${String(p.meanDelta).padStart(6)}  >8: ${String(p.pctOver8).padStart(6)}%  >32: ${String(p.pctOver32).padStart(6)}%`,
  );
}

// The side-by-side, which is the thing a human judges.
const sheet = await (await browser.newContext({ viewport: { width: 1520, height: 900 }, deviceScaleFactor: 1 })).newPage();
const row = ([act, , still]) => {
  const acceptedPath = `${ACCEPTED}/${still}-${LOCALE}.png`;
  const img = (p) => existsSync(p)
    ? `<img src="data:image/png;base64,${readFileSync(p).toString('base64')}" style="display:block;width:720px;height:auto;border:1px solid #1b2027">`
    : '<div style="width:720px;height:450px;background:#12161c"></div>';
  const stat = photo.find((x) => x.act === act);
  return `<div style="display:grid;grid-template-columns:720px 720px;gap:12px;margin-bottom:8px">
    ${img(acceptedPath)}${img(`${OUT}/${TAG}-${still}-${LOCALE}.png`)}
  </div>
  <p style="margin:0 0 26px;font:11px/1.5 ui-monospace,monospace;color:#6d7681">
    <b style="color:#aeb7c1">${act}</b> — accepted (left) · ${TAG} (right)${stat && !stat.note ? ` · mean Δ ${stat.meanDelta}, ${stat.pctOver32}% of pixels beyond 32 levels` : ''}
  </p>`;
};
await sheet.setContent(`<body style="margin:0;padding:20px;background:#07090d">${ACTS.map(row).join('')}</body>`);
await sheet.screenshot({ path: `${OUT}/accepted-vs-${TAG}-${LOCALE}.png`, fullPage: true });
console.log(`\nwrote ${OUT}/accepted-vs-${TAG}-${LOCALE}.png`);

await browser.close();

if (AGAINST) {
  const path = `${OUT}/${AGAINST}-${LOCALE}.json`;
  if (!existsSync(path)) {
    console.error(`\nno baseline at ${path}`);
    process.exit(2);
  }
  const base = JSON.parse(readFileSync(path, 'utf8'));
  const drift = [];
  for (const [act, now] of Object.entries(measured)) {
    const was = base[act];
    if (!was) { drift.push(`${act}: absent from the baseline`); continue; }
    if (Math.abs(now.monumentPx - was.monumentPx) > TOLERANCE) {
      drift.push(`${act}: monument ${was.monumentPx}u -> ${now.monumentPx}u`);
    }
    if (Math.abs(now.instrument - was.instrument) > 0.02) {
      drift.push(`${act}: instrument presence ${was.instrument} -> ${now.instrument}`);
    }
    for (const [key, box] of Object.entries(now.objects)) {
      const old = was.objects[key];
      if (!old) { drift.push(`${act}: ${key} is new`); continue; }
      const worst = Math.max(...box.map((v, i) => Math.abs(v - old[i])));
      if (worst > TOLERANCE) drift.push(`${act}: ${key} moved ${worst.toFixed(2)}u — ${JSON.stringify(old)} -> ${JSON.stringify(box)}`);
    }
    for (const key of Object.keys(was.objects)) {
      if (!(key in now.objects)) drift.push(`${act}: ${key} is gone`);
    }
  }
  console.log(`\n§46 · ${TAG} against ${AGAINST}: ${drift.length ? `${drift.length} DIFFERENCE(S)` : 'every master frame is unchanged'}`);
  for (const d of drift) console.log(`  ${d}`);
  writeFileSync(`${OUT}/drift-${TAG}-vs-${AGAINST}-${LOCALE}.json`, JSON.stringify(drift, null, 2));
}

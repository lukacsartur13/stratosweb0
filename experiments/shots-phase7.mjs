// =============================================================================
// Phase 7 stills: the regression baseline, and the cloud review set.
//
// One script for both because they are the same operation with two constant
// tables, and two copies of the parking logic would be two things to keep in
// step. The parking logic itself is lifted from `shots-meridian.mjs` unchanged
// — including the reason it is shaped the way it is:
//
//   * ring rotation is the only integrated quantity in the instrument, so it is
//     the only thing that can differ between two runs. It is switched off via a
//     property setter installed on `globalThis.__stratos` *before* the
//     application assigns the handle, because setting it afterwards leaves
//     however many frames of idle rotation the page happened to accumulate
//     while starting up;
//   * the altitude is forced through `debug.altitude`, and the *document* is
//     then scrolled to the position that altitude belongs to, so each still is
//     a picture of the page rather than of the object in isolation.
//
// Usage (repo root, with `npm run dev:full` running on :5176):
//
//   node experiments/shots-phase7.mjs                    # baseline set, §1
//   SET=cloud node experiments/shots-phase7.mjs          # cloud review set, §31
//   SET=cloud SUFFIX=-after node experiments/shots-phase7.mjs
//   LOCALE=en SET=cloud node experiments/shots-phase7.mjs
// =============================================================================
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const SET = process.env.SET ?? 'baseline';
const SUFFIX = process.env.SUFFIX ?? '';
const LOCALE = process.env.LOCALE ?? 'hu';
const BASE = process.env.URL ?? 'http://localhost:5176/experiments/stratos-ascent-full/full.html';
const URL = LOCALE === 'hu' ? BASE : `${BASE}?lang=${LOCALE}`;
const OUT = process.env.OUT ?? `experiments/screenshots/phase7-${SET}${LOCALE === 'hu' ? '' : `-${LOCALE}`}`;

// §1 — the accepted homepage, as the regression baseline.
const BASELINE_STOPS = [0, 7_000, 12_000, 18_000, 24_000, 30_000];
// §31 — the cloud sequence, dense through the breakthrough.
const CLOUD_STOPS = [7_000, 9_500, 10_500, 11_500, 11_800, 12_000, 12_200, 12_500];

const STOPS = process.env.STOPS
  ? process.env.STOPS.split(',').map(Number)
  : SET === 'cloud'
    ? CLOUD_STOPS
    : BASELINE_STOPS;

// §1 and §31 viewport matrices. 360x800 is in the §31 list only; it is carried
// here for both because a stills set that covers one more small phone costs one
// more context and closes the gap between the two lists.
const VIEWS = [
  { id: '1440x900', width: 1440, height: 900, dsf: 1, mobile: false },
  { id: '1366x768', width: 1366, height: 768, dsf: 1, mobile: false },
  { id: '1024x768', width: 1024, height: 768, dsf: 2, mobile: false },
  { id: '430x932', width: 430, height: 932, dsf: 3, mobile: true },
  { id: '390x844', width: 390, height: 844, dsf: 3, mobile: true },
  { id: '360x800', width: 360, height: 800, dsf: 3, mobile: true },
  { id: '844x390', width: 844, height: 390, dsf: 3, mobile: true },
];

const ONLY = process.env.VIEWS ? new Set(process.env.VIEWS.split(',')) : null;
const SELECTED = ONLY ? VIEWS.filter((v) => ONLY.has(v.id)) : VIEWS;

function freezeIdleRotation() {
  let value;
  Object.defineProperty(globalThis, '__stratos', {
    configurable: true,
    get: () => value,
    set: (v) => {
      value = v;
      if (v?.journey?.debug) v.journey.debug.ringRotation = 0;
    },
  });
}

const browser = await chromium.launch();
mkdirSync(OUT, { recursive: true });

const digests = {};
const observations = [];

for (const view of SELECTED) {
  const context = await browser.newContext({
    viewport: { width: view.width, height: view.height },
    deviceScaleFactor: view.dsf,
    isMobile: view.mobile,
    hasTouch: view.mobile,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.addInitScript(freezeIdleRotation);
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.addStyleTag({ content: '.debug, .debug__toggle { display: none !important; }' });

  await page.waitForSelector('canvas');
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => !!globalThis.__stratos, { timeout: 20_000 });
  await page.waitForTimeout(3000);

  for (const metres of STOPS) {
    await page.evaluate((m) => {
      globalThis.__stratos.journey.debug.altitude = m;
    }, metres);
    await page.waitForTimeout(120);
    await page.evaluate(() => {
      const max = document.documentElement.scrollHeight - innerHeight;
      scrollTo({ top: max * globalThis.__stratos.journey.current, behavior: 'instant' });
    });
    await page.waitForTimeout(2600);

    // Recorded alongside the pixels so a still that looks wrong can be tied to
    // the state that produced it without re-running anything.
    const state = await page.evaluate(() => {
      const h = globalThis.__stratos;
      const cloud = h.cloud ?? null;
      return {
        altitude: Math.round(h.journey.altitude),
        stage: h.journey.stage,
        aperture: +h.meridian.apertureOpen.toFixed(4),
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        cloud: cloud && {
          visible: cloud.visible,
          coverage: +cloud.coverage.toFixed(4),
          opacity: +cloud.opacity.toFixed(4),
          layers: cloud.layerCount,
          mountainFade: +cloud.mountainFade.toFixed(4),
        },
      };
    });

    const name = `${view.id}-${String(metres).padStart(5, '0')}${SUFFIX}.png`;
    await page.screenshot({ path: `${OUT}/${name}`, animations: 'disabled' });
    digests[name] = createHash('sha256').update(readFileSync(`${OUT}/${name}`)).digest('hex').slice(0, 16);
    observations.push({ view: view.id, metres, ...state });

    const c = state.cloud;
    console.log(
      `${name.padEnd(30)} alt ${String(state.altitude).padStart(5)}  ${state.stage.padEnd(24)}` +
        (c ? `  cloud cov ${c.coverage.toFixed(3)} op ${c.opacity.toFixed(3)} layers ${c.layers}` : '  cloud n/a') +
        (state.overflow ? '  !! HORIZONTAL OVERFLOW' : ''),
    );
  }

  if (errors.length) console.log(`  !! ${view.id} errors: ${[...new Set(errors)].join(' | ')}`);
  await context.close();
}

await browser.close();

writeFileSync(`${OUT}/digests${SUFFIX}.json`, JSON.stringify(digests, null, 2));
writeFileSync(`${OUT}/state${SUFFIX}.json`, JSON.stringify(observations, null, 2));
console.log(`\nwritten: ${OUT} (${Object.keys(digests).length} images)`);

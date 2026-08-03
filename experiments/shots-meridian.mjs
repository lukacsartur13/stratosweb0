// =============================================================================
// Deterministic captures of the seven canonical altitude states.
//
// ## Why this runs against the dev server and the benchmark does not
//
// They need opposite things. The benchmark must measure the artefact that
// ships, so it drives the production build by scrolling. A screenshot must be
// *reproducible*, and the only way to park the instrument on an exact altitude
// with its idle rotation stopped is the `__stratos` handle — which is compiled
// out of production on purpose. Vite's dev server changes how the modules are
// delivered; it does not change a single vertex, material or shader, so the
// pixels are the same pixels.
//
// ## What makes a capture deterministic
//
// Ring rotation is the only quantity in the whole instrument that is integrated
// rather than derived (see MeridianRing: `spin.current += …`), so it is the only
// thing that can differ between two runs of the same script. Two measures:
//
//   1. `debug.ringRotation = 0` is installed *before the application assigns
//      the handle*, via a property setter on `globalThis.__stratos`. Setting it
//      after load would leave however many frames' worth of idle rotation the
//      page happened to accumulate while starting up — a different amount every
//      run, and visibly different engraving positions at 30 000 m.
//   2. The altitude stops are always visited in the same order. With the idle
//      term at zero the remaining contribution is `dAltitude × rotationGain`,
//      which telescopes to the same total for the same sequence.
//
// The script verifies this rather than asserting it: `VERIFY=1` captures twice
// and compares SHA-256 digests.
//
// Usage:
//   npm run dev:full                 # in another terminal, serves :5176
//   node experiments/shots-meridian.mjs
//   VERIFY=1 node experiments/shots-meridian.mjs
// =============================================================================
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const URL = process.env.URL ?? 'http://localhost:5176/experiments/stratos-ascent-full/full.html';
const OUT = process.env.OUT ?? 'experiments/screenshots/meridian';
const VERIFY = process.env.VERIFY === '1';
const SUFFIX = process.env.SUFFIX ?? '';

const STOPS = [0, 3_000, 7_000, 12_000, 18_000, 24_000, 30_000];

const VIEWS = [
  { id: 'desktop', width: 1440, height: 900, dsf: 1, mobile: false },
  { id: 'mobile', width: 390, height: 844, dsf: 3, mobile: true },
];

/**
 * Installed before any application code runs.
 *
 * `__stratos` is assigned once, asynchronously, by main.tsx. Defining an
 * accessor for it means the idle rotation is switched off on the same tick the
 * handle appears — which is before the canvas has rendered a frame.
 */
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

for (const view of VIEWS) {
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

  // The development-only debug affordance is not part of the object being
  // judged. Hidden rather than not mounted, because not mounting it would mean
  // running a different build from the one the audit is about.
  await page.addStyleTag({ content: '.debug, .debug__toggle { display: none !important; }' });

  await page.waitForSelector('canvas');
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => !!globalThis.__stratos, { timeout: 20_000 });
  await page.waitForTimeout(3000); // GLB decode, environment probe, first settle

  for (const metres of STOPS) {
    // Two steps, and the second one is what makes these captures a picture of
    // the *page* rather than of the object in isolation.
    //
    // Setting `debug.altitude` parks the instrument exactly, but it does not
    // move the document, so every still would show the finished Meridian behind
    // the calibration headline — the wrong copy, the wrong plate, and no way to
    // judge whether text overlaps the object at 24 000 m.
    //
    // `advance()` resolves a forced altitude by writing `journey.current =
    // progressAt(metres)`, so the scroll position that belongs to this altitude
    // can simply be read back off the singleton a frame later and applied to the
    // document. The override still wins, so the altitude stays exact while the
    // narrative panel is the one a visitor would actually be reading here.
    await page.evaluate((m) => {
      globalThis.__stratos.journey.debug.altitude = m;
    }, metres);
    await page.waitForTimeout(120);
    await page.evaluate(() => {
      const max = document.documentElement.scrollHeight - innerHeight;
      scrollTo({ top: max * globalThis.__stratos.journey.current, behavior: 'instant' });
    });

    // Long enough for the damped lighting (0.88/0.9 per 1/60 s) to arrive: the
    // slower of the two is within a thousandth of its target after ~1.6 s.
    await page.waitForTimeout(2600);

    const state = await page.evaluate(() => {
      const m = globalThis.__stratos.meridian;
      return {
        altitude: Math.round(m.altitude),
        aperture: +m.apertureOpen.toFixed(4),
        rings: m.rings.map((r) => +r.settle.toFixed(3)),
        finalCalibration: +m.finalCalibration.toFixed(3),
      };
    });

    const name = `altimeter-meridian-${view.id}-${String(metres).padStart(5, '0')}${SUFFIX}.png`;
    const path = `${OUT}/${name}`;
    await page.screenshot({ path, animations: 'disabled' });
    digests[name] = createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 16);

    console.log(
      `${name}  alt ${String(state.altitude).padStart(5)}  aperture ${state.aperture.toFixed(3)}  rings ${state.rings.join('/')}  final ${state.finalCalibration}`,
    );
  }

  if (errors.length) console.log(`  !! ${view.id} errors: ${[...new Set(errors)].join(' | ')}`);
  await context.close();
}

await browser.close();

writeFileSync(`${OUT}/digests${SUFFIX}.json`, JSON.stringify(digests, null, 2));
console.log(`\nwritten: ${OUT} (${Object.keys(digests).length} images)`);

if (VERIFY) {
  const previous = JSON.parse(readFileSync(`${OUT}/digests.json`, 'utf8'));
  const differing = Object.keys(digests).filter((k) => previous[k] && previous[k] !== digests[k]);
  console.log(
    differing.length
      ? `NOT DETERMINISTIC — ${differing.length} of ${Object.keys(digests).length} differ:\n  ${differing.join('\n  ')}`
      : `deterministic: all ${Object.keys(digests).length} digests reproduced`,
  );
}

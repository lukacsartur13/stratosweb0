// =============================================================================
// The Phase 6 rail composition — §14's evaluation stills.
//
//     npm run dev:full                    # in another terminal, serves :5176
//     node experiments/shots-rails.mjs
//     VERIFY=1 node experiments/shots-rails.mjs
//
// ## Why this is a second script and not more stops in shots-meridian.mjs
//
// They photograph two different things. `shots-meridian.mjs` is the instrument's
// own record — the seven canonical altitude states, on the two viewports the
// object was designed against, with a digest file that is a regression baseline
// for the *geometry*. Adding rail states and two more viewports to it would
// change every digest in that baseline and lose the comparison it exists for.
//
// This set is the *composition's* record: the seven compositional acts §2
// scripts, on the four viewport classes §10 distinguishes, framed to show where
// the instrument stands and what room that leaves the copy. It has its own
// digest file and its own determinism check.
//
// Determinism is bought exactly the way the other script buys it, and for the
// same reason: ring rotation is the one integrated quantity in the instrument,
// so it is zeroed through a property setter installed before the application
// assigns the handle, and the stops are always visited in the same order.
// =============================================================================
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const URL = process.env.URL ?? 'http://localhost:5176/experiments/stratos-ascent-full/full.html';
const OUT = process.env.OUT ?? 'experiments/screenshots/rails';
const VERIFY = process.env.VERIFY === '1';
const LOCALES = (process.env.LOCALES ?? 'hu').split(',');

/**
 * The seven acts, at an altitude well inside each one rather than on its edge.
 *
 * Each is picked to be past the end of its own incoming handoff, because a
 * still taken mid-crossing photographs the transition rather than the
 * composition — the instrument part-way to its rail and the copy part-way
 * through its yield. The transitions are validated, not photographed;
 * `validate-meridian` samples all five of them at seven points each.
 */
const ACTS = [
  { id: '1-centre-opening', metres: 0, note: 'Meridian centred, the object established before anything moves' },
  { id: '2-right-rail', metres: 4_500, note: 'lower ascent — instrument right, narrative left' },
  { id: '3-left-rail', metres: 9_500, note: 'cloud breakthrough — instrument left, narrative right' },
  { id: '4-aperture', metres: 12_000, note: 'aperture breakthrough — instrument right, narrative left' },
  { id: '5-ring-stages', metres: 20_000, note: 'later ring stages — instrument left, narrative right' },
  { id: '6-return-centre', metres: 29_000, note: 'final calibration — the frame comes back to centre' },
  { id: '7-final-cta', metres: 30_000, note: 'the closing state and the call to action' },
];

/** §10's four classes. `dsf` is 1 everywhere so the stills compare pixel for pixel. */
const VIEWS = [
  { id: 'desktop', width: 1440, height: 900, mobile: false },
  { id: 'tablet', width: 1024, height: 768, mobile: false },
  { id: 'mobile-landscape', width: 844, height: 390, mobile: true },
  { id: 'portrait-mobile', width: 390, height: 844, mobile: true },
];

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
const index = [];

for (const locale of LOCALES) {
  for (const view of VIEWS) {
    const context = await browser.newContext({
      viewport: { width: view.width, height: view.height },
      deviceScaleFactor: 1,
      isMobile: view.mobile,
      hasTouch: view.mobile,
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    // The locale is a property of the document, not of the URL — the single dev
    // route is one shell and says `lang="hu"`. Rewriting the attribute in the
    // served HTML is what the production `/de/` shell does statically, and it
    // is the only way to photograph German copy on this route. A `?lang=`
    // parameter does nothing at all: no module reads the query string.
    await page.route(URL.split('?')[0], async (route) => {
      const response = await route.fetch();
      const body = await response.text();
      await route.fulfill({ response, body: body.replace(/<html\s+lang="[^"]*"/i, `<html lang="${locale}"`) });
    });

    await page.addInitScript(freezeIdleRotation);
    await page.goto(URL, { waitUntil: 'networkidle' });
    // Development-only affordances are not part of the object being judged.
    await page.addStyleTag({ content: '.debug, .debug__toggle { display: none !important; }' });

    await page.waitForSelector('canvas');
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => !!globalThis.__stratos?.composition?.measurement?.(), { timeout: 30_000 });
    await page.waitForTimeout(3000); // GLB decode, environment probe, first settle

    for (const act of ACTS) {
      // Park the altitude, then move the document to where that altitude
      // actually is. Forcing alone photographs the finished Meridian behind the
      // opening headline: the right object and the wrong page.
      await page.evaluate((m) => {
        globalThis.__stratos.journey.debug.altitude = m;
      }, act.metres);
      await page.waitForTimeout(140);
      await page.evaluate(() => {
        const track = document.querySelector('[data-testid="journey-track"]');
        const travel = (track?.offsetHeight ?? document.documentElement.scrollHeight) - innerHeight;
        scrollTo({ top: travel * globalThis.__stratos.journey.current, behavior: 'instant' });
      });
      // The damped lighting is within a thousandth of its target after ~1.6s;
      // the camera dolly and the rail solve land exactly, and sooner.
      await page.waitForTimeout(2600);

      const state = await page.evaluate(() => {
        const s = globalThis.__stratos;
        const c = s.composition;
        const m = s.journey.altitude;
        const panel = [...document.querySelectorAll('.panel')].find((p) => p.dataset.stage === s.journey.stage);
        const inner = panel?.querySelector('.panel__inner');
        const box = inner?.getBoundingClientRect();
        return {
          altitude: Math.round(m),
          stage: s.journey.stage,
          rail: c.railOf(s.journey.stage),
          railAt: +(c.railAt(m) * 100).toFixed(1),
          copy: panel?.dataset.copy ?? 'flow',
          column: box ? Math.round(box.width) : 0,
          columnVw: box ? +((box.width / innerWidth) * 100).toFixed(1) : 0,
          veil: panel?.style.getPropertyValue('--panel-veil') || '1',
        };
      });

      const name = `rails-${locale}-${view.id}-${act.id}.png`;
      const path = `${OUT}/${name}`;
      await page.screenshot({ path, animations: 'disabled' });
      digests[name] = createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 16);
      index.push({ locale, view: view.id, act: act.id, note: act.note, ...state });

      console.log(
        `${name.padEnd(46)} ${String(state.altitude).padStart(5)}m  ` +
          `rail=${state.rail.padEnd(6)} at ${String(state.railAt).padStart(5)}%  ` +
          `copy=${state.copy.padEnd(6)} ${String(state.column).padStart(4)}px/${state.columnVw}vw  veil=${state.veil}`,
      );
    }

    if (errors.length) console.log(`  !! ${view.id} errors: ${[...new Set(errors)].join(' | ')}`);
    await context.close();
  }
}

await browser.close();

writeFileSync(`${OUT}/index.json`, JSON.stringify({ generatedAt: new Date().toISOString(), index }, null, 1));
writeFileSync(`${OUT}/digests${VERIFY ? '.verify' : ''}.json`, JSON.stringify(digests, null, 2));
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

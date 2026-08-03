// =============================================================================
// Why the same scroll position reports two altitudes.
//
//     npm run build:full
//     python3 -m http.server 4327 --directory dist   # in another terminal
//     node experiments/probe-calibration-drift.mjs
//
// The full-ascent suite's direction test fails at the 11 000 m boundary: scroll
// 7020 reads 10 990 m / cloud-breakthrough going up and 11 000 m / selected-work
// coming down. The suite can only see the rounded readout, so it cannot say
// whether the clock is direction-dependent or whether the *map from scroll to
// altitude* moved underneath it.
//
// `useStageCalibration` derives that map from where each stage panel actually
// sits. This probe recomputes the same measurement straight from the DOM at
// three moments — after first paint, after the test's warm-up walk, and after a
// full traversal to the top — and prints the panel offsets side by side. If the
// offsets move, the clock is innocent and the calibration is the defect.
// =============================================================================
import { chromium } from '@playwright/test';

const URL = process.env.URL ?? 'http://127.0.0.1:4327/experiments/stratos-ascent-full/';
const PROBE_Y = Number(process.env.PROBE_Y ?? 7020);

const STAGE_IDS = [
  'calibration', 'initial-ascent', 'lower-atmosphere', 'cloud-entry',
  'cloud-breakthrough', 'selected-work', 'system', 'process',
  'stratosphere-transition', 'full-stratosphere', 'destination',
];

/** The exact measurement `useStageCalibration` performs, read from the page. */
const readCalibration = (ids) =>
  ({ ids }, ) => 0; // placeholder, replaced below

const page = await (await chromium.launch()).newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(URL);
await page.locator('canvas').waitFor({ state: 'visible', timeout: 20_000 });
await page.waitForTimeout(1_500);

const measure = () =>
  page.evaluate((ids) => {
    const track = document.querySelector('[data-testid="journey-track"]');
    const travel = (track?.offsetHeight ?? document.documentElement.scrollHeight) - innerHeight;
    const trackTop = (track?.getBoundingClientRect().top ?? 0) + scrollY;
    const starts = {};
    for (const id of ids) {
      const el = document.getElementById(`stage-${id}`);
      if (!el) continue;
      starts[id] = (el.getBoundingClientRect().top + scrollY - trackTop) / travel;
    }
    return { travel, trackTop, scrollHeight: document.documentElement.scrollHeight, starts };
  }, STAGE_IDS);

const readAt = async (y) => {
  await page.evaluate((to) => scrollTo({ top: to, behavior: 'instant' }), y);
  await page.waitForTimeout(1_700);
  return page.evaluate(() => ({
    stage: document.querySelector('.hud')?.dataset.stage ?? '',
    metres: (document.querySelector('[data-testid="altitude-value"]')?.textContent ?? '').replace(/\D/g, ''),
  }));
};

const walk = async (steps) => {
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let i = 0; i <= steps; i++) {
    await page.evaluate((y) => scrollTo({ top: y, behavior: 'instant' }), (h * i) / steps);
    await page.waitForTimeout(240);
  }
};

const snaps = [];

snaps.push(['first paint', await measure()]);

// The warm-up the test performs before it measures anything.
await walk(12);
await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
await page.waitForTimeout(2_000);
snaps.push(['after warm-up', await measure()]);

// Forward reading, exactly as the test takes it.
await readAt(Math.max(0, PROBE_Y - 600));
const forward = await readAt(PROBE_Y);
snaps.push(['at forward read', await measure()]);

// The rest of the forward loop climbs well past this boundary before coming back.
await walk(12);
snaps.push(['after full traversal', await measure()]);

// Reverse reading.
await readAt(PROBE_Y + 600);
const back = await readAt(PROBE_Y);
snaps.push(['at reverse read', await measure()]);

console.log(`\nscroll ${PROBE_Y}:  forward ${forward.metres} m / ${forward.stage}`);
console.log(`scroll ${PROBE_Y}:  reverse ${back.metres} m / ${back.stage}`);
console.log(forward.metres === back.metres && forward.stage === back.stage ? '  -> AGREE' : '  -> DIFFER');

console.log('\nscrollHeight / track travel:');
for (const [label, s] of snaps) {
  console.log(`  ${label.padEnd(22)} scrollHeight=${s.scrollHeight}  travel=${s.travel}  trackTop=${s.trackTop}`);
}

console.log('\nmeasured stage starts (progress 0..1):');
const header = snaps.map(([l]) => l.padStart(14)).join('');
console.log('  ' + 'stage'.padEnd(26) + header);
for (const id of STAGE_IDS) {
  const cells = snaps
    .map(([, s]) => (s.starts[id] === undefined ? '—' : s.starts[id].toFixed(6)).padStart(14))
    .join('');
  const values = snaps.map(([, s]) => s.starts[id]).filter((v) => v !== undefined);
  const moved = values.length > 1 && Math.max(...values) - Math.min(...values) > 1e-9;
  console.log('  ' + (id + (moved ? ' *' : '')).padEnd(26) + cells);
}
console.log('\n  * = this boundary moved between snapshots');

await page.context().browser().close();

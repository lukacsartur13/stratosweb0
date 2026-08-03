// =============================================================================
// The 11 000 m boundary, at full precision.
//
//     node experiments/probe-boundary-precision.mjs
//
// The drift probe ruled out the calibration: every stage boundary is identical
// to the bit across a full traversal. Both directions also settle to the same
// displayed altitude. Only the stage label differs, which means `journey.current`
// is landing on opposite sides of one boundary while rounding to the same 10 m.
//
// This prints the two numbers the readout cannot show: the exact progress the
// boundary sits at, and the exact progress the scroll position produces — plus
// whether the stage is still moving after a long settle.
// =============================================================================
import { chromium } from '@playwright/test';

const URL = process.env.URL ?? 'http://127.0.0.1:4327/experiments/stratos-ascent-full/';

const page = await (await chromium.launch()).newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(URL);
await page.locator('canvas').waitFor({ state: 'visible', timeout: 20_000 });
await page.waitForTimeout(2_000);

const geometry = await page.evaluate(() => {
  const track = document.querySelector('[data-testid="journey-track"]');
  const travel = track.offsetHeight - innerHeight;
  const trackTop = track.getBoundingClientRect().top + scrollY;
  const el = document.getElementById('stage-selected-work');
  const px = el.getBoundingClientRect().top + scrollY - trackTop;
  return { travel, trackTop, px, progress: px / travel, rounded: Math.round(px) };
});

console.log('\nselected-work panel (the 11 000 m boundary)');
console.log(`  exact top      ${geometry.px} px`);
console.log(`  rounded by test ${geometry.rounded} px      <- the scroll position the test uses`);
console.log(`  track travel   ${geometry.travel} px`);
console.log(`  boundary progress ${geometry.progress}`);
console.log(`  progress at ${geometry.rounded}px  ${geometry.rounded / geometry.travel}`);
console.log(
  `  the sampled position is ${geometry.rounded < geometry.px ? 'BELOW' : geometry.rounded > geometry.px ? 'ABOVE' : 'EXACTLY ON'} the boundary` +
    ` (by ${Math.abs(geometry.rounded - geometry.px).toFixed(6)} px)`,
);

/** Poll the readout for a while, to see whether it is still converging. */
const observe = async (y, label, settleMs) => {
  await page.evaluate((to) => scrollTo({ top: to, behavior: 'instant' }), y);
  await page.waitForTimeout(settleMs);
  const series = [];
  for (let i = 0; i < 6; i++) {
    series.push(
      await page.evaluate(() => ({
        stage: document.querySelector('.hud')?.dataset.stage ?? '',
        m: (document.querySelector('[data-testid="altitude-value"]')?.textContent ?? '').replace(/\D/g, ''),
        fill: getComputedStyle(document.querySelector('.hud__bar') ?? document.body).getPropertyValue('--fill').trim(),
      })),
    );
    await page.waitForTimeout(500);
  }
  const stages = [...new Set(series.map((s) => s.stage))];
  const fills = [...new Set(series.map((s) => s.fill))];
  console.log(
    `  ${label.padEnd(28)} stage=${series.at(-1).stage.padEnd(20)} m=${series.at(-1).m.padEnd(7)} fill=${series.at(-1).fill}` +
      `${stages.length > 1 ? `   STILL MOVING (${stages.join(' -> ')})` : ''}${fills.length > 1 ? ' [fill moving]' : ''}`,
  );
  return series.at(-1);
};

const y = geometry.rounded;

console.log(`\napproaching ${y} from below, settling 1.7 s (what the suite does):`);
await observe(Math.max(0, y - 600), 'park at y-600', 1_700);
const fwdShort = await observe(y, 'read at y', 1_700);

console.log(`\napproaching ${y} from above, settling 1.7 s:`);
await observe(y + 600, 'park at y+600', 1_700);
const revShort = await observe(y, 'read at y', 1_700);

console.log(`\n  1.7 s settle: ${fwdShort.stage === revShort.stage ? 'AGREE' : `DIFFER (${fwdShort.stage} vs ${revShort.stage})`}`);

console.log(`\nsame two approaches, settling 12 s:`);
await observe(Math.max(0, y - 600), 'park at y-600', 1_700);
const fwdLong = await observe(y, 'read at y (12 s)', 12_000);
await observe(y + 600, 'park at y+600', 1_700);
const revLong = await observe(y, 'read at y (12 s)', 12_000);

console.log(`\n  12 s settle: ${fwdLong.stage === revLong.stage ? 'AGREE' : `DIFFER (${fwdLong.stage} vs ${revLong.stage})`}`);
console.log(
  fwdLong.stage === revLong.stage
    ? '\n  => the damper simply had not finished in 1.7 s. Convergence is too slow, not direction-dependent.'
    : '\n  => genuinely direction-dependent after full settle: `settle` is not snapping here.',
);

await page.context().browser().close();

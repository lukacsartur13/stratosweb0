// =============================================================================
// Settled-state captures of the six acts, against the live homepage route.
//
// One frame per act, at the altitude the act's peak stage sits in the middle
// of, taken the same way `shots-meridian.mjs` takes its stills: park the
// altitude through the dev handle, read back the scroll position the journey
// resolves it to, apply it to the document, and wait for the damped clock.
//
// `--tag before` / `--tag after` names the run, so the two sets can be put
// side by side against the approved master frames.
//
// Usage:  npm run dev:home        # serves :5177
//         node experiments/shots-acts.mjs --tag before
// =============================================================================
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};

const TAG = arg('tag', 'after');
const LOCALE = arg('locale', 'hu');
const BASE = process.env.URL ?? `http://localhost:5177/home/${LOCALE}.html`;
const OUT = `_build/reports/luxury-art-direction/production/${TAG}`;

/**
 * The seven frames and the four crossings, sampled where they are SETTLED.
 *
 * `at` is where inside the stage's panel to stand, in screens from its top. A
 * peak act's frame is pinned for the first 0.8 of a screen — see `ACT_HOLD` —
 * so 0.4 is the middle of the state the visitor actually arrives at, and it is
 * the frame the master study has to be compared against.
 *
 * Scrolled rather than driven through the debug altitude override, which is
 * what the first version of this script did. The override parks the instrument
 * exactly and says nothing about where the document is, so every still was of
 * the right altitude and the wrong frame. Scrolling to the panel and letting
 * the real clock resolve the altitude is both simpler and the thing being
 * judged.
 */
const FRAMES = [
  { id: 'a1', act: 'I · ground', stage: 'calibration', at: 0.4 },
  { id: 'a2', act: 'II · noise', stage: 'initial-ascent', at: 0.4 },
  { id: 'a3', act: 'III · system', stage: 'lower-atmosphere', at: 0.4 },
  { id: 'x1', act: 'crossing · cloud entry', stage: 'cloud-entry', at: 0.25 },
  { id: 'x2', act: 'crossing · breakthrough', stage: 'cloud-breakthrough', at: 0.25 },
  { id: 'a4', act: 'IV · proof', stage: 'selected-work', at: 0.4 },
  { id: 'x3', act: 'crossing · nine areas', stage: 'system', at: 0.35 },
  { id: 'x4', act: 'crossing · process', stage: 'process', at: 0.35 },
  { id: 'a5', act: 'V · high altitude', stage: 'stratosphere-transition', at: 0.4 },
  { id: 'a6', act: 'VI · arrival', stage: 'full-stratosphere', at: 0.4 },
  { id: 'a6b', act: 'VI · action', stage: 'destination', at: 0.4 },
];

const VIEWS = (arg('views', '1440x900') === 'all'
  ? ['1440x900', '1920x1080', '1280x800', '1024x768']
  : arg('views', '1440x900').split(',')
).map((s) => {
  const [width, height] = s.split('x').map(Number);
  return { id: s, width, height };
});

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

for (const view of VIEWS) {
  const context = await browser.newContext({
    viewport: { width: view.width, height: view.height },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.addInitScript(freezeIdleRotation);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.addStyleTag({ content: '.debug, .debug__toggle { display: none !important; }' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => !!globalThis.__stratos, { timeout: 30_000 });
  await page.waitForTimeout(3000);

  const report = [];
  for (const frame of FRAMES) {
    await page.evaluate(
      ({ stage, at }) => {
        // `.panel[data-stage]`, not `[data-stage]`: the HUD carries the same
        // attribute — it publishes the stage it is reading — and it is earlier
        // in the document, so the bare selector scrolled every frame to the
        // instrument readout's offset instead of to its own panel.
        const panel = document.querySelector(`.panel[data-stage="${stage}"]`);
        scrollTo({ top: panel.offsetTop + at * innerHeight, behavior: 'instant' });
      },
      frame,
    );
    // The damped clock and the damped lighting both have to arrive. The slower
    // of the two is within a thousandth of its target after ~1.6 s.
    await page.waitForTimeout(2800);
    const state = await page.evaluate(() => ({
      metres: Math.round(globalThis.__stratos.journey.altitude),
      stage: globalThis.__stratos.journey.stage,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }));
    const suffix = view.id === '1440x900' ? '' : `-${view.id}`;
    await page.screenshot({ path: `${OUT}/${frame.id}-${LOCALE}${suffix}.png` });
    report.push({ ...frame, ...state });
    process.stdout.write(
      `${TAG} ${view.id} ${frame.id.padEnd(4)} ${frame.act.padEnd(24)} ${String(state.metres).padStart(6)} m  ${state.stage}\n`,
    );
  }
  writeFileSync(`${OUT}/frames-${LOCALE}-${view.id}.json`, JSON.stringify(report, null, 2));

  if (errors.length) console.error(`\nconsole errors on ${view.id}:\n  ${errors.join('\n  ')}`);
  await context.close();
}

await browser.close();
console.log(`\nwrote ${OUT}`);

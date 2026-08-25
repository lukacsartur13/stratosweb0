// =============================================================================
// WHAT THE SIX-ACT DESIGN COSTS, MEASURED ON THE PAGE THAT SHIPS. §45, §J.
//
// Three numbers per act, taken at the act's settled frame:
//
//   draws / triangles  from the renderer's own info counters, through the dev
//                      handle. The instrument is absent from nine chapters of
//                      eleven, and this is what that is worth.
//   frame time         the median interval over ~4 s of scripted scrolling,
//                      from `requestAnimationFrame`.
//   style/layout       Chrome's own `RecalcStyleCount` and `LayoutCount`
//                      deltas over the same window, which is where a
//                      composition that measures text would show up.
//
// Run against the dev server, because the counters need the handle:
//   npm run dev:home && node experiments/probe-act-cost.mjs
// =============================================================================
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = process.env.OUT ?? '_build/reports/luxury-art-direction/production';
// The eleven chapters, not the seven acts.
//
// The four passages were added by the continuity pass, and the two structural
// ones are the reason: `SystemRings` and `Checkpoints` mounted inside them, so
// "what does a crossing cost" was a question this probe could not answer while
// it only stopped at the acts. §54 asks for the pass to be shown not to have
// increased runtime work, and the two chapters where geometry was removed are
// exactly where the evidence is.
const STOPS = [
  ['I · ground', 'calibration'],
  ['II · noise', 'initial-ascent'],
  ['III · system', 'lower-atmosphere'],
  ['passage · cloud entry', 'cloud-entry'],
  ['passage · breakthrough', 'cloud-breakthrough'],
  ['IV · proof', 'selected-work'],
  ['passage · nine areas', 'system'],
  ['passage · process', 'process'],
  ['V · high altitude', 'stratosphere-transition'],
  ['VI · arrival', 'full-stratosphere'],
  ['VI · action', 'destination'],
];

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
// §30 asks what the depth proof COSTS, and the only honest way to answer that
// with one build is to run the same sweep twice — once as it ships and once
// with the one rule the proof added switched off. `NOMASK=1` is the second run.
const NOMASK = process.env.NOMASK === '1';
const cdp = await context.newCDPSession(page);
await cdp.send('Performance.enable');

await page.goto('http://localhost:5177/home/hu.html', { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.waitForFunction(() => !!globalThis.__stratos, { timeout: 30_000 });
await page.waitForTimeout(3000);
if (NOMASK) {
  await page.addStyleTag({ content: '[data-occlusion="monument"] .act__monument { -webkit-mask-image: none !important; mask-image: none !important; }' });
  await page.waitForTimeout(600);
}

const metric = (m, name) => m.metrics.find((x) => x.name === name)?.value ?? 0;
const rows = [];

for (const [label, stage] of STOPS) {
  await page.evaluate((s) => {
    const el = document.querySelector(`.panel[data-stage="${s}"]`);
    scrollTo({ top: el.offsetTop + 0.4 * innerHeight, behavior: 'instant' });
  }, stage);
  await page.waitForTimeout(2600);

  const before = await cdp.send('Performance.getMetrics');
  const sample = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const frames = [];
        let last = performance.now();
        const start = last;
        const tick = (now) => {
          frames.push(now - last);
          last = now;
          // Keep the page moving, so this measures a scrolling frame and not an
          // idle one: a composition's cost is what it does while the finger is
          // down.
          scrollBy(0, 2);
          if (now - start < 4000) requestAnimationFrame(tick);
          else resolve(frames);
        };
        requestAnimationFrame(tick);
      }),
  );
  const after = await cdp.send('Performance.getMetrics');

  const sorted = [...sample].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];

  const gl = await page.evaluate(() => {
    const info = globalThis.__stratos?.gl?.info;
    const presence = Number(getComputedStyle(document.documentElement).getPropertyValue('--instrument'));
    return info
      ? { draws: info.render.calls, triangles: info.render.triangles, programs: info.programs?.length ?? null, presence }
      : { presence };
  });

  rows.push({
    act: label,
    stage,
    instrument: gl.presence,
    draws: gl.draws,
    triangles: gl.triangles,
    frameMedianMs: Number(median.toFixed(2)),
    frameP95Ms: Number(p95.toFixed(2)),
    styleRecalcs: metric(after, 'RecalcStyleCount') - metric(before, 'RecalcStyleCount'),
    layouts: metric(after, 'LayoutCount') - metric(before, 'LayoutCount'),
    nodes: metric(after, 'Nodes'),
  });
  console.log(
    `${label.padEnd(18)} inst ${String(gl.presence).padEnd(4)} draws ${String(gl.draws).padStart(4)}  tris ${String(gl.triangles).padStart(7)}  frame ${median.toFixed(1)}/${p95.toFixed(1)} ms  style ${rows.at(-1).styleRecalcs}  layout ${rows.at(-1).layouts}`,
  );
}

mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/act-cost${NOMASK ? '-nomask' : ''}.json`, JSON.stringify(rows, null, 2));
console.log(`\nwrote ${OUT}/act-cost${NOMASK ? '-nomask' : ''}.json`);
await browser.close();

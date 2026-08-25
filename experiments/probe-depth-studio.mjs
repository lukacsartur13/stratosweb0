// =============================================================================
// PHASE 5.2A · THE DEPTH STUDIO.
//
// §16, §18 and §21 all ask for several compositions to be TRIED and judged as
// images before any of them is authored. This is the harness for that: it drives
// `journey.debug.placement`, photographs one candidate per frame at 1440x900,
// and writes them side by side. Nothing here ships and nothing here is a test —
// it is the contact sheet the three visual gates are judged on.
//
//   node experiments/probe-depth-studio.mjs --scene hero --set a
// =============================================================================
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const LOCALE = arg('locale', 'hu');
const BASE = process.env.URL ?? `http://localhost:5177/home/${LOCALE}.html`;
const OUT = '_build/reports/luxury-art-direction/depth/studio';
const SCENE = arg('scene', 'hero');
const SET = arg('set', 'a');
const INTO = Number(arg('into', 0.4));
// A crop, for inspecting the mask edge at the scale §8 says to inspect it at.
const CLIP = arg('clip', null);
const clip = CLIP ? (([x, y, w, h]) => ({ x, y, width: w, height: h }))(CLIP.split(',').map(Number)) : undefined;

const STAGE = { hero: 'calibration', system: 'lower-atmosphere', high: 'stratosphere-transition', arrival: 'full-stratosphere' }[SCENE];

// Candidates, per scene per set. Reference-frame px: dial centre and diameter,
// plus the pose in degrees off the base pose.
const CANDIDATES = JSON.parse(process.env.CANDIDATES ?? '[]');

mkdirSync(`${OUT}`, { recursive: true });
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })).newPage();
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.addStyleTag({ content: 'vite-error-overlay, .debug, .debug__toggle { display: none !important; }' });
await page.evaluate(() => document.fonts.ready);
await page.waitForFunction(() => !!globalThis.__stratos?.scene, { timeout: 30_000 });
await page.waitForTimeout(3000);

await page.evaluate(([s, i]) => {
  const el = document.querySelector(`.panel[data-stage="${s}"]`);
  scrollTo({ top: el.offsetTop + i * innerHeight, behavior: 'instant' });
}, [STAGE, INTO]);
await page.waitForTimeout(2400);

const report = [];
for (const c of CANDIDATES) {
  await page.evaluate((c) => {
    const j = globalThis.__stratos.journey;
    j.debug.placement = c.placement;
    document.querySelectorAll('.panel--act').forEach((p) => p.setAttribute('data-occlusion', 'monument'));
  }, c);
  await page.waitForTimeout(Number(c.dwell ?? 1400));
  const measured = await page.evaluate((stage) => {
    const root = getComputedStyle(document.documentElement);
    const read = (n) => Number(root.getPropertyValue(n));
    const cx = read('--occl-x'), cy = read('--occl-y');
    const rx = read('--occl-rx'), ry = read('--occl-ry');

    // §45's contract, measured rather than eyeballed: which of the frame's
    // objects the housing's projected silhouette actually stands in front of.
    // The ellipse is sampled against each element's own reference-frame box.
    const field = document.querySelector(`.panel[data-stage="${stage}"] .act__field`);
    const f = field.getBoundingClientRect();
    const u = f.width / 1440;
    const hits = {};
    for (const el of field.querySelectorAll('[class*="act__"]')) {
      const key = [...el.classList].find((c) => c.startsWith('act__') && c !== 'act__field');
      if (!key || hits[key]) continue;
      const r = el.getBoundingClientRect();
      const box = [(r.x - f.x) / u, (r.y - f.y) / u, r.width / u, r.height / u];
      // Fraction of the element's box covered by the ellipse, on a 4px lattice.
      let inside = 0, total = 0;
      for (let y = box[1]; y < box[1] + box[3]; y += 4) {
        for (let x = box[0]; x < box[0] + box[2]; x += 4) {
          total++;
          const dx = (x - cx) / rx, dy = (y - cy) / ry;
          if (dx * dx + dy * dy <= 1) inside++;
        }
      }
      if (inside) hits[key] = +(inside / Math.max(total, 1)).toFixed(3);
    }
    return {
      occl: root.getPropertyValue('--occl').trim(),
      x: cx, y: cy, rx: +rx.toFixed(1), ry: +ry.toFixed(1),
      hits,
    };
  }, STAGE);
  const path = `${OUT}/${SCENE}-${SET}-${c.id}.png`;
  await page.screenshot({ path, clip });
  report.push({ id: c.id, ...c.placement, ...measured });
  const collide = Object.entries(measured.hits).map(([k, v]) => `${k.replace('act__', '')} ${(v * 100).toFixed(0)}%`).join('  ');
  console.log(`${c.id.padEnd(10)} r ${measured.rx}x${measured.ry}  box ${(measured.x - measured.rx).toFixed(0)}..${(measured.x + measured.rx).toFixed(0)} x ${(measured.y - measured.ry).toFixed(0)}..${(measured.y + measured.ry).toFixed(0)}  |  ${collide || 'no overlap'}`);
}
writeFileSync(`${OUT}/${SCENE}-${SET}.json`, JSON.stringify(report, null, 2));
console.log(`\nwrote ${CANDIDATES.length} frames to ${OUT}`);
await browser.close();

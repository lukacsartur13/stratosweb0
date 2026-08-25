// =============================================================================
// PHASE 5.2A · WHERE THE OBJECT ACTUALLY IS, AND WHERE THE MASK THINKS IT IS.
//
// §8 asks whether the simple mask is perceptually invisible or reads as a hole
// cut in the text, and §28 asks for the mask and the renderer to be shown to
// agree at intermediate scroll positions. Both are questions about pixels, and
// on a near-black object against a near-black sky neither can be answered by
// looking at a screenshot.
//
// So: photograph the frame twice — once as composed, once with the instrument
// taken out of the picture and nothing else changed — and subtract. What is
// left is the object's VISIBLE footprint, which is not its geometry: a triangle
// that renders at one part in a thousand above the sky is in the bounding box
// and is not in the picture. Compare that footprint against the ellipse the
// stylesheet is cutting, and the answer is a number.
//
// This is a measurement taken in a probe, off two files. Nothing here runs at
// runtime and nothing here reads back a live canvas — §29.
//
//   node experiments/probe-mask-align.mjs --scene hero
// =============================================================================
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { luminance } from './png-luma.mjs';
import { writePng } from './png-write.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const LOCALE = arg('locale', 'hu');
const BASE = process.env.URL ?? `http://localhost:5177/home/${LOCALE}.html`;
const OUT = '_build/reports/luxury-art-direction/depth/align';
const TAG = arg('tag', 'proof');

// Scene, stage, and how far into the panel to stand. `at` values other than the
// composed 0.4 are §28's intermediate samples.
const SAMPLES = JSON.parse(process.env.SAMPLES ?? JSON.stringify([
  ['hero', 'calibration', 0.4, null],
]));

// How far above the background plate a pixel has to be to count as the object.
// The sky's own frame-to-frame noise is under a quarter of a step at 8 bits;
// this is four steps, which is the smallest difference that is a rendered
// surface rather than a dither pattern.
const VISIBLE = Number(process.env.VISIBLE ?? 1.5);

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })).newPage();
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.addStyleTag({ content: 'vite-error-overlay, .debug, .debug__toggle { display: none !important; }' });
await page.evaluate(() => document.fonts.ready);
await page.waitForFunction(() => !!globalThis.__stratos?.scene, { timeout: 30_000 });
await page.waitForTimeout(3000);

const report = {};
for (const [name, stage, at, placement] of SAMPLES) {
  await page.evaluate(([s, i, pl]) => {
    globalThis.__stratos.journey.debug.placement = pl ?? null;
    // `stage` is either one panel — scrolled to `at` screens into it — or a pair
    // of them, in which case `at` is the FRACTION of the way from the first to
    // the second. §28's intermediate samples are the second form: the points
    // between two authored poses, which is where a mask that is authored beside
    // the object rather than solved with it comes off it.
    if (Array.isArray(s)) {
      const a = document.querySelector(`.panel[data-stage="${s[0]}"]`);
      const b = document.querySelector(`.panel[data-stage="${s[1]}"]`);
      scrollTo({ top: a.offsetTop + i * (b.offsetTop - a.offsetTop), behavior: 'instant' });
    } else {
      const el = document.querySelector(`.panel[data-stage="${s}"]`);
      scrollTo({ top: el.offsetTop + i * innerHeight, behavior: 'instant' });
    }
  }, [stage, at, placement]);
  await page.waitForTimeout(2600);

  const mask = await page.evaluate(() => {
    const r = getComputedStyle(document.documentElement);
    const n = (k) => Number(r.getPropertyValue(k));
    return {
      on: n('--occl'), x: n('--occl-x'), y: n('--occl-y'), rx: n('--occl-rx'), ry: n('--occl-ry'),
      presence: n('--instrument'),
      alt: Math.round(n('--alt') * 30000),
    };
  });
  if (!mask.on) {
    report[name] = { stage, at, mask, note: 'no mask published — the object is not standing in front of a statement here' };
    console.log(`${name.padEnd(14)} no mask   presence ${mask.presence}  ${mask.alt} m`);
    continue;
  }

  // The two plates. The instrument is hidden for the second and nothing else
  // moves — same scroll, same altitude, same ramp, same type.
  const withObj = `${OUT}/${TAG}-${name}-with.png`;
  const without = `${OUT}/${TAG}-${name}-without.png`;
  await page.screenshot({ path: withObj });
  await page.evaluate(() => { globalThis.__stratos.journey.debug.hideInstrument = true; });
  await page.waitForTimeout(900);
  await page.screenshot({ path: without });
  await page.evaluate(() => { globalThis.__stratos.journey.debug.hideInstrument = false; });
  await page.waitForTimeout(500);

  const a = luminance(withObj);
  const b = luminance(without);
  const W = a.width, H = a.height;

  // The object's visible footprint, and the mask's ellipse, as two bitmaps —
  // then the three numbers that matter.
  //
  //   covered    mask pixels that are on the object          (a correct cut)
  //   dilated    mask pixels that are NOT on the object      (§8's hole)
  //   eroded     object pixels the mask misses, next to it   (glyph over rim)
  let inMask = 0, dilated = 0, objectPx = 0;
  let worstDilate = 0;
  const diff = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const d = Math.abs(a.lum[i] - b.lum[i]);
    diff[i] = d;
    if (d > VISIBLE) objectPx++;
  }
  // THE EDGE TEST, WALKED ALONG THE MASK RATHER THAN OUT FROM ITS CENTRE.
  //
  // A radial sweep from the centre cannot measure a mask whose centre is off the
  // frame, which two of the three proof placements have on purpose. So walk the
  // ellipse itself: at every boundary point that is inside the frame, step INWARD
  // along the local normal and find the first pixel where the object is visible.
  //
  //   0   the mask's edge is exactly on the object's edge
  //   +n  the mask reaches n px past the object — a cut with nothing behind it,
  //       which is §8's hole, and the number is how wide the hole's rim is
  //
  // Stepping OUTWARD instead answers the other half: how far the object goes on
  // past the mask, which is a glyph painted over the case's dark rim and is the
  // error this system is deliberately biased toward.
  const edge = [];
  const STEPS = 720;
  for (let i = 0; i < STEPS; i++) {
    const th = (i * 2 * Math.PI) / STEPS;
    const ex = mask.x + mask.rx * Math.cos(th);
    const ey = mask.y + mask.ry * Math.sin(th);
    if (ex < 2 || ey < 2 || ex >= W - 2 || ey >= H - 2) continue;
    // Outward normal of the ellipse at this point.
    let nx = Math.cos(th) / mask.rx, ny = Math.sin(th) / mask.ry;
    const nl = Math.hypot(nx, ny) || 1;
    nx /= nl; ny /= nl;
    let inward = null;
    for (let d = 0; d < 260; d++) {
      const x = Math.round(ex - nx * d), y = Math.round(ey - ny * d);
      if (x < 0 || y < 0 || x >= W || y >= H) break;
      if (diff[y * W + x] > VISIBLE) { inward = d; break; }
    }
    let outward = 0;
    for (let d = 1; d < 260; d++) {
      const x = Math.round(ex + nx * d), y = Math.round(ey + ny * d);
      if (x < 0 || y < 0 || x >= W || y >= H) break;
      if (diff[y * W + x] > VISIBLE) outward = d; else if (outward && d - outward > 8) break;
    }
    edge.push({ deg: +((th * 180) / Math.PI).toFixed(0), x: +ex.toFixed(0), y: +ey.toFixed(0), in: inward, out: outward });
  }
  const gaps = edge.map((e) => (e.in === null ? 260 : e.in));
  gaps.sort((a, b) => a - b);
  const pct = (q) => (gaps.length ? gaps[Math.min(gaps.length - 1, Math.floor(q * gaps.length))] : -1);
  worstDilate = gaps.length ? gaps[gaps.length - 1] : -1;
  const edgeStats = {
    points: edge.length,
    medianGapPx: pct(0.5),
    p90GapPx: pct(0.9),
    worstGapPx: worstDilate,
    overhangPx: edge.length ? Math.max(...edge.map((e) => e.out)) : 0,
  };

  // Mask area accounting, on a 2px lattice.
  for (let y = 0; y < H; y += 2) {
    for (let x = 0; x < W; x += 2) {
      const ux = (x - mask.x) / mask.rx, uy = (y - mask.y) / mask.ry;
      if (ux * ux + uy * uy > 1) continue;
      inMask++;
      if (diff[y * W + x] <= VISIBLE) dilated++;
    }
  }
  // §27's view. The object's own contribution, amplified until a difference of
  // one level out of 255 is a visible grey, with the mask's ellipse drawn over
  // it in yellow and its centre crossed. Where the yellow line runs over grey
  // the mask is on the object; where it runs over black the mask is cutting
  // type in front of nothing, which is the failure §8 names.
  {
    const rgb = new Uint8Array(W * H * 3);
    for (let i = 0; i < W * H; i++) {
      const v = Math.min(255, Math.round(diff[i] * 26));
      rgb[i * 3] = v; rgb[i * 3 + 1] = v; rgb[i * 3 + 2] = v;
    }
    const put = (x, y, r, g, b) => {
      if (x < 0 || y < 0 || x >= W || y >= H) return;
      const i = (Math.round(y) * W + Math.round(x)) * 3;
      rgb[i] = r; rgb[i + 1] = g; rgb[i + 2] = b;
    };
    for (let deg = 0; deg < 3600; deg++) {
      const th = (deg * Math.PI) / 1800;
      put(mask.x + mask.rx * Math.cos(th), mask.y + mask.ry * Math.sin(th), 255, 218, 5);
    }
    for (let k = -14; k <= 14; k++) { put(mask.x + k, mask.y, 255, 218, 5); put(mask.x, mask.y + k, 255, 218, 5); }
    writePng(`${OUT}/${TAG}-${name}-debug.png`, W, H, rgb);
  }

  report[name] = {
    stage, at, mask,
    objectPx,
    maskPx: inMask * 4,
    maskOffObject: +(dilated / Math.max(inMask, 1)).toFixed(4),
    worstDilatePx: +worstDilate.toFixed(1),
    edgeStats,
    edge,
  };
  console.log(
    `${name.padEnd(14)} p=${mask.presence.toFixed(2)} mask ${mask.rx.toFixed(0)}x${mask.ry.toFixed(0)} at ${mask.x},${mask.y}` +
    `  off-object ${(dilated / Math.max(inMask, 1) * 100).toFixed(1)}%` +
    `  edge gap median ${edgeStats.medianGapPx}px  p90 ${edgeStats.p90GapPx}px  worst ${edgeStats.worstGapPx}px` +
    `  overhang ${edgeStats.overhangPx}px  (${edgeStats.points}/720 edge points in frame)`
  );
}
writeFileSync(`${OUT}/${TAG}-${LOCALE}.json`, JSON.stringify(report));
console.log(`\nwrote ${OUT}/${TAG}-${LOCALE}.json`);
await browser.close();

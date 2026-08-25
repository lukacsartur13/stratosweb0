// =============================================================================
// PHASE 5.2A · WHAT SHAPE IS THE INSTRUMENT, ACTUALLY?
//
// §8 asks for the simplest mask that could plausibly work to be tried first and
// then INSPECTED CRITICALLY, and §9 warns that a generic radial mask may fail
// once the housing rotates. Neither question can be answered by looking at a
// dark object on a dark field. This measures it instead: the real projected
// silhouette of the shipped geometry, rasterised from the scene graph, and the
// radial signature that says how far from a circle it is.
//
// No pixels are read back off the canvas and nothing here runs at runtime —
// this is a design measurement taken once, which is what §10's "small authored
// silhouette vocabulary" has to be authored FROM.
//
//   node experiments/probe-silhouette.mjs
// =============================================================================
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const LOCALE = arg('locale', 'hu');
const BASE = process.env.URL ?? `http://localhost:5177/home/${LOCALE}.html`;
const OUT = '_build/reports/luxury-art-direction/depth';

// Where to stand. The two acts that carry the object today plus three points on
// the way, so the signature is sampled across the pose range rather than at one
// pose that happens to be near-frontal.
const STOPS = JSON.parse(process.env.STOPS ?? JSON.stringify([
  ['hero', 'calibration', 0.4],
  ['mid', 'lower-atmosphere', 0.4],
  ['high', 'stratosphere-transition', 0.4],
  ['arrival', 'full-stratosphere', 0.4],
]));

const PAGE_FN = () => {
  const s = globalThis.__stratos;
  const THREE = s.three;
  let root = null;
  let gimbal = null;
  s.scene.traverse((o) => {
    if (o.userData?.meridianRoot) root = o;
    if (o.userData?.meridianGimbal) gimbal = o;
  });
  if (!root) return null;
  const inG = new Set();
  if (gimbal) gimbal.traverse((o) => inG.add(o));

  const camera = s.camera;
  const canvas = s.gl.domElement;
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;

  // One cell is 2 CSS px. Fine enough that the radial signature is exact to a
  // quarter of a per cent of the dial, coarse enough to rasterise a whole
  // instrument in a few milliseconds.
  const CELL = 2;
  // A margin of one viewport on each side, so an object cropped by a frame edge
  // is measured whole rather than measured clipped. Screen coordinates are
  // offset by `PAD` inside the grid and taken back out on the way to the report.
  const PAD = 900;
  const gw = Math.ceil((W + 2 * PAD) / CELL);
  const gh = Math.ceil((H + 2 * PAD) / CELL);

  const rasterise = (want) => {
    const grid = new Uint8Array(gw * gh);
    const v = new THREE.Vector3();
    let tris = 0;
    root.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      if (o.visible === false) return;
      const isRing = inG.has(o);
      if (want === 'essential' && isRing) return;
      if (want === 'rings' && !isRing) return;
      const geo = o.geometry;
      const pos = geo.attributes?.position;
      if (!pos) return;
      const idx = geo.index;
      const count = idx ? idx.count : pos.count;
      const px = new Float32Array(3);
      const py = new Float32Array(3);
      for (let t = 0; t + 2 < count; t += 3) {
        for (let k = 0; k < 3; k++) {
          const i = idx ? idx.getX(t + k) : t + k;
          v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).project(camera);
          px[k] = (((v.x + 1) / 2) * W + PAD) / CELL;
          py[k] = (((1 - v.y) / 2) * H + PAD) / CELL;
        }
        tris++;
        // Scanline fill of one triangle into the coverage grid.
        let y0 = Math.max(0, Math.floor(Math.min(py[0], py[1], py[2])));
        let y1 = Math.min(gh - 1, Math.ceil(Math.max(py[0], py[1], py[2])));
        if (y1 - y0 > gh) continue;
        for (let y = y0; y <= y1; y++) {
          const cy = y + 0.5;
          let lo = Infinity;
          let hi = -Infinity;
          for (let e = 0; e < 3; e++) {
            const a = e, b = (e + 1) % 3;
            const ya = py[a], yb = py[b];
            if ((cy < ya && cy < yb) || (cy >= ya && cy >= yb)) continue;
            const f = (cy - ya) / (yb - ya);
            const x = px[a] + f * (px[b] - px[a]);
            if (x < lo) lo = x;
            if (x > hi) hi = x;
          }
          if (lo > hi) continue;
          const x0 = Math.max(0, Math.floor(lo));
          const x1 = Math.min(gw - 1, Math.ceil(hi));
          const row = y * gw;
          for (let x = x0; x <= x1; x++) grid[row + x] = 1;
        }
      }
    });
    return { grid, tris };
  };

  const measure = (grid) => {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, area = 0, sx = 0, sy = 0;
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        if (!grid[y * gw + x]) continue;
        area++; sx += x; sy += y;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
    if (!area) return null;
    const cx = sx / area, cy = sy / area;
    // Radial signature from the area centroid: the furthest filled cell along
    // each of 360 rays, and the nearest EMPTY cell along the same ray (which is
    // what an inscribed mask may not exceed).
    const outer = [];
    const inner = [];
    const step = 0.5;
    const reach = Math.hypot(gw, gh);
    for (let a = 0; a < 360; a++) {
      const th = (a * Math.PI) / 180;
      const dx = Math.cos(th), dy = Math.sin(th);
      let last = 0;
      let firstGap = Infinity;
      let seen = false;
      for (let r = 0; r < reach; r += step) {
        const x = Math.round(cx + dx * r), y = Math.round(cy + dy * r);
        if (x < 0 || y < 0 || x >= gw || y >= gh) break;
        if (grid[y * gw + x]) { last = r; seen = true; }
        else if (seen && firstGap === Infinity) firstGap = r;
      }
      outer.push(+(last * CELL).toFixed(1));
      inner.push(+(Math.min(firstGap === Infinity ? last : firstGap, last) * CELL).toFixed(1));
    }
    return {
      box: [minX * CELL - PAD, minY * CELL - PAD, (maxX - minX + 1) * CELL, (maxY - minY + 1) * CELL].map((n) => +n.toFixed(1)),
      centroid: [+(cx * CELL - PAD).toFixed(1), +(cy * CELL - PAD).toFixed(1)],
      areaPx: +(area * CELL * CELL).toFixed(0),
      outer,
      inner,
    };
  };

  const out = { nodes: {} };
  {
    // Per-node extents, so the housing can be told from the axis, the aperture
    // and the rings rather than assumed. Screen-space AABB per named mesh.
    const v = new THREE.Vector3();
    root.traverse((o) => {
      if (!o.isMesh || !o.geometry || o.visible === false) return;
      const geo = o.geometry;
      const pos = geo.attributes?.position;
      if (!pos) return;
      let mnx = Infinity, mxx = -Infinity, mny = Infinity, mxy = -Infinity;
      const step = Math.max(1, Math.floor(pos.count / 400));
      for (let i = 0; i < pos.count; i += step) {
        v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).project(camera);
        const x = ((v.x + 1) / 2) * W, y = ((1 - v.y) / 2) * H;
        if (x < mnx) mnx = x; if (x > mxx) mxx = x;
        if (y < mny) mny = y; if (y > mxy) mxy = y;
      }
      const name = o.name || '(anon)';
      const b = [mnx, mny, mxx - mnx, mxy - mny].map((n) => +n.toFixed(0));
      out.nodes[name] = out.nodes[name] ? out.nodes[name] : b;
    });
  }
  for (const want of ['essential', 'rings', 'all']) {
    const { grid, tris } = rasterise(want);
    const m = measure(grid);
    out[want] = m ? { ...m, tris } : { tris, empty: true };
  }
  out.viewport = [W, H];
  // What the placement table needs: the housing's projected silhouette as four
  // fractions of the authored dial. The bezel is the outermost part of the case
  // at every pose, so it — and not the whole subtree, which at high altitude
  // includes a deployed axis — is what a mask has to be the shape of.
  const e = out.essential;
  const st = globalThis.__stratos.composition?.instrumentStateAt?.(globalThis.__stratos.journey.current);
  if (e && !e.empty && st) {
    const b = e.box;
    out.calibration = {
      dial: +st.dial.toFixed(1),
      authored: [+st.x.toFixed(1), +st.y.toFixed(1)],
      box: b,
      dx: +(((b[0] + b[2] / 2) - st.x) / st.dial).toFixed(4),
      dy: +(((b[1] + b[3] / 2) - st.y) / st.dial).toFixed(4),
      rx: +((b[2] / 2) / st.dial).toFixed(4),
      ry: +((b[3] / 2) / st.dial).toFixed(4),
    };
  }
  return out;
};

mkdirSync(`${OUT}/silhouette`, { recursive: true });
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })).newPage();
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.waitForFunction(() => !!globalThis.__stratos?.scene, { timeout: 30_000 });
await page.waitForTimeout(3000);

const all = {};
for (const [name, stage, into] of STOPS) {
  await page.evaluate(([s, i]) => {
    const el = document.querySelector(`.panel[data-stage="${s}"]`);
    scrollTo({ top: el.offsetTop + i * innerHeight, behavior: 'instant' });
  }, [stage, into]);
  await page.waitForTimeout(1200);
  await page.evaluate((pl) => { globalThis.__stratos.journey.debug.placement = pl ?? null; }, STOPS.find((x) => x[0] === name)[3] ?? null);
  await page.waitForTimeout(2000);
  const m = await page.evaluate(PAGE_FN);
  all[name] = m;
  if (!m) { console.log(`${name}: no instrument`); continue; }
  const e = m.essential;
  if (e.empty) { console.log(`${name.padEnd(8)} essential empty (${e.tris} tris)`); continue; }
  const o = e.outer;
  const mean = o.reduce((a, b) => a + b, 0) / o.length;
  const min = Math.min(...o), max = Math.max(...o);
  console.log(
    `${name.padEnd(8)} box ${e.box.join(',').padEnd(24)} centroid ${e.centroid.join(',').padEnd(14)}` +
    ` r ${min.toFixed(0)}..${max.toFixed(0)} mean ${mean.toFixed(1)} spread ${((max - min) / mean * 100).toFixed(1)}%`
  );
  if (m.calibration) {
    const c = m.calibration;
    console.log(`         mask: { dx: ${c.dx}, dy: ${c.dy}, rx: ${c.rx}, ry: ${c.ry} }   dial ${c.dial} at ${c.authored.join(',')}`);
  }
}
writeFileSync(`${OUT}/silhouette/signature-${LOCALE}.json`, JSON.stringify(all));
console.log(`\nwrote ${OUT}/silhouette/signature-${LOCALE}.json`);
await browser.close();

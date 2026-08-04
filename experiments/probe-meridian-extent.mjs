// =============================================================================
// Local extent of the instrument, sampled off the live scene graph.
//
//     npm run dev:full                            # in another terminal
//     node experiments/probe-meridian-extent.mjs
//
// This is the generator behind the `COMPOSITION_WIDTH` and `ESSENTIAL_WIDTH`
// tables in `composition.ts`. Paste both; they are read together and a run that
// updated one of them would put the rail budget and the copy budget on
// measurements of two different scenes.
//
// ## Why a table rather than a formula
//
// The essential silhouette is one rigid body, so its local AABB is very nearly a
// constant (see ESSENTIAL_LOCAL_HEIGHT) and a closed form is exact. The *ring
// composition* is not: three rings unseat, tilt, translate and lock at their own
// altitudes, so the extent of the gimbal subtree in the instrument's own frame
// is a function of altitude with no useful closed form — reconstructing it would
// mean a second implementation of `meridian.ts`'s ring timeline, in a module
// that is forbidden from importing `three`, and a second implementation is a
// second thing that can drift.
//
// So it is measured, at one metre-spacing fine enough to interpolate, and the
// numbers are pasted in. What is measured is scale-free and viewport-free — the
// AABB corners of every visible ring mesh, expressed in the instrument root's
// *local* frame — so one run describes every viewport. The probe re-measures on
// three aspect ratios and reports the spread precisely so that claim is checked
// rather than assumed.
// =============================================================================
import { chromium } from '@playwright/test';

const BASE = process.env.URL ?? 'http://localhost:5176/experiments/stratos-ascent-full/full.html';
const STEP = Number(process.env.STEP ?? 500);
const CHECK = [
  { w: 1440, h: 900 },
  { w: 1024, h: 768 },
  { w: 844, h: 390 },
];

const ALTITUDES = Array.from({ length: Math.round(30_000 / STEP) + 1 }, (_, i) => i * STEP);

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

  // The *effective* extent: the width in world units that, placed flat on the
  // view plane at the instrument's own distance, would project to the same
  // number of pixels the real geometry does.
  //
  // Deliberately not the model's own AABB, and deliberately not the root's local
  // frame either. Two things separate the object from its silhouette and both
  // have to be inside the number:
  //
  //   * **The pose.** The ground pose's −7° pitch and 12° yaw, and the reveal's
  //     27° yaw above 24 000 m, swing the housing and the ring corners wide. A
  //     budget built on the un-rotated box is 4% too small at 0 m and 8% too
  //     small at 30 000 m — the two altitudes the instrument is largest.
  //   * **The depth.** The rings unseat *towards the camera*, so their near
  //     corners magnify: measured, the ring at 7 000 m projects 6.5% wider than
  //     its world extent divided by the instrument's distance would predict.
  //
  // Dividing the measured pixel extent back through the projection absorbs both,
  // and what is left is a pure function of altitude. That it is genuinely
  // viewport-free is not assumed: the probe repeats the sweep on three aspect
  // ratios and prints the spread.
  const camera = s.camera;
  const canvas = s.gl.domElement;
  const origin = new THREE.Vector3().setFromMatrixPosition(root.matrixWorld);
  const scale = new THREE.Vector3().setFromMatrixScale(root.matrixWorld).x || 1;
  const distance = camera.position.distanceTo(origin);
  const tanV = Math.tan((camera.fov * Math.PI) / 360);
  const tanH = Math.tan(Math.atan(tanV * camera.aspect));
  const worldW = 2 * distance * tanH;
  const worldH = 2 * distance * tanV;
  const v = new THREE.Vector3();

  const extent = (meshes) => {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let any = false;
    for (const o of meshes) {
      const geo = o.geometry;
      if (!geo) continue;
      if (!geo.boundingBox) geo.computeBoundingBox();
      const bb = geo.boundingBox;
      if (!bb) continue;
      for (let i = 0; i < 8; i++) {
        v.set(i & 1 ? bb.max.x : bb.min.x, i & 2 ? bb.max.y : bb.min.y, i & 4 ? bb.max.z : bb.min.z);
        v.applyMatrix4(o.matrixWorld).project(camera);
        minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
        minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
        any = true;
      }
    }
    if (!any) return null;
    void canvas;
    // Clip space is −1..1 across the frame, so the span is half the fraction of
    // the viewport. Divided by the scale so what comes back describes the
    // instrument at scale 1 and the recede is applied by the consumer.
    return { x: ((maxX - minX) / 2) * worldW / scale, y: ((maxY - minY) / 2) * worldH / scale };
  };

  const ess = [];
  const ring = [];
  root.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    for (let p = o.parent; p; p = p.parent) if (!p.visible) return;
    (inG.has(o) ? ring : ess).push(o);
  });
  // `ring` is the whole composition — the gimbal subtree *and* the instrument it
  // surrounds. §9 protects "the final combined Meridian state", not the rings on
  // their own, and below 6 500 m the rings are still seated inside the housing,
  // where the housing is the wider of the two.
  return { essential: extent(ess), ring: extent([...ess, ...ring]) };
};

const settleFrames = () =>
  new Promise((res) => {
    let last = null;
    let stable = 0;
    let frames = 0;
    // Every mesh, not the root.
    //
    // Watching the root alone is what made the first run of this probe read
    // 1.486 for the ring at 7 000 m against a directly projected 1.55. 7 000 m
    // is where Ring 1 unseats: the root's own transform is nearly stationary
    // through it, so the predicate fired three frames after the override while
    // the ring was still travelling, and the sample was taken part-way through
    // the lift. The thing being measured has to be the thing being waited for.
    const tick = () => {
      const s = globalThis.__stratos;
      let root = null;
      s.scene.traverse((o) => {
        if (o.userData?.meridianRoot) root = o;
      });
      let p = '';
      if (root) root.traverse((o) => { p += o.matrixWorld.elements.join(','); });
      if (p === last) stable++;
      else stable = 0;
      last = p;
      if (stable >= 4 || ++frames > 600) return res();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

const browser = await chromium.launch();
const perViewport = [];

/**
 * A sweep is sixty-one settles long and the renderer occasionally loses its
 * context — a laptop suspending mid-run is enough. Rebuilding the page and
 * retrying the sample costs a second and turns a five-minute run that throws at
 * sample forty into one that finishes.
 */
const open = async (vp) => {
  const page = await browser.newPage({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1 });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.locator('canvas').waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForFunction(() => globalThis.__stratos?.scene && globalThis.__stratos?.journey, null, {
    timeout: 30_000,
  });
  await page.waitForTimeout(1_000);
  return page;
};

for (const vp of CHECK) {
  let page = await open(vp);
  const rows = [];
  for (const a of ALTITUDES) {
    for (let attempt = 0; ; attempt++) {
      try {
        await page.evaluate((mm) => {
          globalThis.__stratos.journey.debug.altitude = mm;
        }, a);
        await page.evaluate(settleFrames);
        rows.push({ a, ...(await page.evaluate(PAGE_FN)) });
        break;
      } catch (error) {
        if (attempt >= 3) throw error;
        console.error(`  retry ${vp.w}x${vp.h} @ ${a}m: ${String(error).split('\n')[0]}`);
        await page.close().catch(() => {});
        page = await open(vp);
      }
    }
  }
  perViewport.push({ vp, rows });
  await page.close();
}

await browser.close();

// --- agreement across aspects -------------------------------------------------
let worst = 0;
for (let i = 0; i < ALTITUDES.length; i++) {
  const vals = perViewport.map((p) => p.rows[i].ring?.x ?? 0);
  const spread = Math.max(...vals) - Math.min(...vals);
  worst = Math.max(worst, spread / Math.max(...vals, 1e-6));
}
console.log(`ring width agreement across ${CHECK.length} aspects: worst relative spread ${(worst * 100).toFixed(2)}%`);

const maxOver = (key, pick) =>
  ALTITUDES.map((_, i) => Math.max(...perViewport.map((p) => pick(p.rows[i])?.[key] ?? 0)));

const ringX = maxOver('x', (r) => r.ring);
const ringY = maxOver('y', (r) => r.ring);
const essX = maxOver('x', (r) => r.essential);
const essY = maxOver('y', (r) => r.essential);

console.log(`\nessential  max width ${Math.max(...essX).toFixed(4)}  max height ${Math.max(...essY).toFixed(4)}`);
console.log(`whole      max width ${Math.max(...ringX).toFixed(4)}  max height ${Math.max(...ringY).toFixed(4)}`);

const fmt = (arr) => {
  const out = [];
  for (let i = 0; i < arr.length; i += 8) {
    out.push('  ' + arr.slice(i, i + 8).map((v) => v.toFixed(3)).join(', ') + ',');
  }
  return out.join('\n');
};

console.log(`\n// step = ${STEP} m, 0 … 30 000`);
console.log('const RING_WIDTH = [\n' + fmt(ringX) + '\n];');
console.log('const RING_HEIGHT = [\n' + fmt(ringY) + '\n];');
console.log('const ESSENTIAL_WIDTH = [\n' + fmt(essX) + '\n];');
console.log('const ESSENTIAL_HEIGHT = [\n' + fmt(essY) + '\n];');

// Station-offset sweep. Asks one question: can the existing stationForward /
// stationRise debug knobs bring MNT_FOREGROUND_* into the frustum without
// pushing a mass in front of the Meridian?
import { chromium } from '@playwright/test';

const URL = process.env.URL ?? 'http://localhost:5177/home/hu.html';
const VIEWS = [
  { id: 'desktop', width: 1440, height: 900, dsf: 1, mobile: false },
  { id: '390x844', width: 390, height: 844, dsf: 3, mobile: true },
];
const FORWARD = [-600, -400, -250, -120, 0, 120];
const RISE = [-150, 0, 150];

function freeze() {
  let v;
  Object.defineProperty(globalThis, '__stratos', {
    configurable: true,
    get: () => v,
    set: (x) => {
      v = x;
      if (x?.journey?.debug) x.journey.debug.ringRotation = 0;
    },
  });
}

function sample() {
  const s = globalThis.__stratos;
  const THREE = s.three;
  const { scene, camera, gl } = s;
  const ctx = gl.getContext();
  const W = ctx.drawingBufferWidth;
  const H = ctx.drawingBufferHeight;
  camera.updateMatrixWorld();

  const isMountain = (o) => {
    let p = o;
    while (p) {
      if (p.userData?.mountainRoot) return true;
      p = p.parent;
    }
    return false;
  };

  const all = [];
  let meridianRoot = null;
  scene.traverse((o) => {
    if ((o.isMesh || o.isPoints || o.isSprite) && o.visible) all.push(o);
    if (o.userData?.meridianRoot) meridianRoot = o;
  });
  const mountains = all.filter(isMountain);

  gl.render(scene, camera);
  const real = new Uint8Array(W * H * 4);
  ctx.readPixels(0, 0, W, H, ctx.RGBA, ctx.UNSIGNED_BYTE, real);

  const prevOverride = scene.overrideMaterial;
  const prevClear = new THREE.Color();
  gl.getClearColor(prevClear);
  const prevAlpha = gl.getClearAlpha();
  const white = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
  const restore = new Map();
  for (const o of all) restore.set(o, o.visible);

  const maskOf = (targets) => {
    for (const o of all) o.visible = targets.includes(o);
    gl.setClearColor(0x000000, 1);
    scene.overrideMaterial = white;
    gl.render(scene, camera);
    const px = new Uint8Array(W * H * 4);
    ctx.readPixels(0, 0, W, H, ctx.RGBA, ctx.UNSIGNED_BYTE, px);
    let n = 0;
    let lum = 0;
    for (let i = 0; i < W * H; i++) {
      if (px[i * 4] <= 127) continue;
      n++;
      lum += 0.2126 * real[i * 4] + 0.7152 * real[i * 4 + 1] + 0.0722 * real[i * 4 + 2];
    }
    return { cov: n / (W * H), lum: n ? lum / n : null };
  };

  const byName = (re) => mountains.filter((o) => re.test(o.name));
  const fg = maskOf(byName(/FOREGROUND/));
  const floor = maskOf(byName(/VALLEY_FLOOR/));
  const walls = maskOf(byName(/VALLEY_WALL/));
  const left = maskOf(byName(/_L(_|$|\d)/));
  const right = maskOf(byName(/_R(_|$|\d)/));
  const allM = maskOf(mountains);

  for (const [o, v] of restore) o.visible = v;
  scene.overrideMaterial = prevOverride;
  gl.setClearColor(prevClear, prevAlpha);
  white.dispose();
  gl.render(scene, camera);

  // Meridian occlusion, same method as shots-mountains.mjs
  let occluded = 0;
  let sampled = 0;
  if (meridianRoot) {
    const box = new THREE.Box3().setFromObject(meridianRoot);
    if (!box.isEmpty()) {
      const centre = box.getCenter(new THREE.Vector3());
      const radius = box.getSize(new THREE.Vector3()).length() / 2;
      const p = centre.clone().project(camera);
      const cx = (p.x + 1) / 2;
      const cy = (1 - p.y) / 2;
      const e = centre.clone().add(new THREE.Vector3(radius, 0, 0)).project(camera);
      const R = Math.max(Math.abs((e.x + 1) / 2 - cx), 0.02);
      const ray = new THREE.Raycaster();
      for (let iy = -3; iy <= 3; iy++) {
        for (let ix = -3; ix <= 3; ix++) {
          if (Math.hypot(ix / 3, iy / 3) > 1) continue;
          const nx = (cx + (ix / 3) * R) * 2 - 1;
          const ny = 1 - (cy + (iy / 3) * R * (innerWidth / innerHeight)) * 2;
          ray.setFromCamera({ x: nx, y: ny }, camera);
          sampled++;
          const hit = ray.intersectObjects(all, true).find((h) => h.object.visible);
          if (hit && isMountain(hit.object)) occluded++;
        }
      }
    }
  }

  const r = (v) => (v === null ? null : +v.toFixed(1));
  return {
    fgCov: +fg.cov.toFixed(4),
    floorCov: +floor.cov.toFixed(4),
    floorLum: r(floor.lum),
    wallCov: +walls.cov.toFixed(4),
    wallLum: r(walls.lum),
    leftLum: r(left.lum),
    rightLum: r(right.lum),
    split: left.lum && right.lum ? +(right.lum / left.lum).toFixed(2) : null,
    allCov: +allM.cov.toFixed(4),
    allLum: r(allM.lum),
    occluded,
    sampled,
  };
}

const browser = await chromium.launch();
for (const view of VIEWS) {
  const ctx = await browser.newContext({
    viewport: { width: view.width, height: view.height },
    deviceScaleFactor: view.dsf,
    isMobile: view.mobile,
    hasTouch: view.mobile,
  });
  const page = await ctx.newPage();
  await page.addInitScript(freeze);
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!globalThis.__stratos?.scene, { timeout: 30_000 });
  await page.waitForTimeout(5000);

  await page.evaluate(() => {
    globalThis.__stratos.journey.debug.altitude = 0;
  });
  await page.waitForTimeout(120);
  await page.evaluate(() => {
    const max = document.documentElement.scrollHeight - innerHeight;
    scrollTo({ top: max * globalThis.__stratos.journey.current, behavior: 'instant' });
  });
  await page.waitForTimeout(2000);

  console.log(`\n=== ${view.id} @ 0 m — station sweep ===`);
  console.log('  fwd  rise |  fgCov  floorCov floorLum  wallCov wallLum |  Llum  Rlum split | allCov allLum | occl');
  for (const f of FORWARD) {
    for (const ri of RISE) {
      await page.evaluate(
        ([fv, rv]) => {
          const d = globalThis.__stratos.journey.debug.mountainLook;
          d.stationForward = fv;
          d.stationRise = rv;
        },
        [f, ri]
      );
      await page.waitForTimeout(700);
      const s = await page.evaluate(sample);
      console.log(
        `  ${String(f).padStart(4)} ${String(ri).padStart(5)} | ` +
          `${String(s.fgCov).padEnd(7)} ${String(s.floorCov).padEnd(8)} ${String(s.floorLum).padEnd(8)} ` +
          `${String(s.wallCov).padEnd(7)} ${String(s.wallLum).padEnd(7)} | ` +
          `${String(s.leftLum).padEnd(5)} ${String(s.rightLum).padEnd(5)} ${String(s.split).padEnd(5)} | ` +
          `${String(s.allCov).padEnd(6)} ${String(s.allLum).padEnd(6)} | ${s.occluded}/${s.sampled}`
      );
    }
  }
  await page.evaluate(() => {
    const d = globalThis.__stratos.journey.debug.mountainLook;
    d.stationForward = 0;
    d.stationRise = 0;
  });
  await ctx.close();
}
await browser.close();

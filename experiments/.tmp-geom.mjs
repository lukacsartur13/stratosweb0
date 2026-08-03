// Where each mass actually sits relative to the camera, in model metres, and
// where its bounding box projects. Answers "why is MNT_FOREGROUND_* drawing
// zero pixels" without guessing.
import { chromium } from '@playwright/test';

const URL = process.env.URL ?? 'http://localhost:5177/home/hu.html';
const VIEWS = [
  { id: 'desktop', width: 1440, height: 900, dsf: 1, mobile: false },
  { id: '390x844', width: 390, height: 844, dsf: 3, mobile: true },
];

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

function geom() {
  const s = globalThis.__stratos;
  const THREE = s.three;
  const { scene, camera } = s;
  camera.updateMatrixWorld();

  let root = null;
  scene.traverse((o) => {
    if (o.userData?.mountainRoot) root = o;
  });
  if (!root) return null;
  const scale = root.scale.x;

  const out = [];
  const box = new THREE.Box3();
  const c = new THREE.Vector3();
  const sz = new THREE.Vector3();
  root.traverse((o) => {
    if (!o.isMesh) return;
    box.setFromObject(o);
    box.getCenter(c);
    box.getSize(sz);

    // camera-relative, converted back to model metres
    const rel = c.clone().sub(camera.position).divideScalar(scale);

    // project the 8 corners; report the screen-space AABB in 0..1 frame units
    const pts = [];
    for (let i = 0; i < 8; i++) {
      const v = new THREE.Vector3(
        i & 1 ? box.max.x : box.min.x,
        i & 2 ? box.max.y : box.min.y,
        i & 4 ? box.max.z : box.min.z
      );
      const p = v.project(camera);
      pts.push({ x: (p.x + 1) / 2, y: (1 - p.y) / 2, z: p.z, behind: v.clone().sub(camera.position).dot(camera.getWorldDirection(new THREE.Vector3())) < 0 });
    }
    const inFront = pts.filter((p) => !p.behind);
    out.push({
      name: o.name || '(unnamed)',
      // model metres: +x right, +y up, -z forward (glTF)
      relX: Math.round(rel.x),
      relY: Math.round(rel.y),
      relZ: Math.round(rel.z),
      distance: Math.round(rel.length()),
      sizeM: [Math.round(sz.x / scale), Math.round(sz.y / scale), Math.round(sz.z / scale)],
      cornersBehindCamera: 8 - inFront.length,
      screenX: inFront.length
        ? [+Math.min(...inFront.map((p) => p.x)).toFixed(2), +Math.max(...inFront.map((p) => p.x)).toFixed(2)]
        : null,
      screenY: inFront.length
        ? [+Math.min(...inFront.map((p) => p.y)).toFixed(2), +Math.max(...inFront.map((p) => p.y)).toFixed(2)]
        : null,
    });
  });
  return {
    altitude: Math.round(s.journey.altitude),
    scale,
    camY: +camera.position.y.toFixed(3),
    fov: camera.fov,
    aspect: +camera.aspect.toFixed(3),
    near: camera.near,
    far: camera.far,
    objects: out,
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

  for (const m of [0, 7000]) {
    await page.evaluate((v) => {
      globalThis.__stratos.journey.debug.altitude = v;
    }, m);
    await page.waitForTimeout(120);
    await page.evaluate(() => {
      const max = document.documentElement.scrollHeight - innerHeight;
      scrollTo({ top: max * globalThis.__stratos.journey.current, behavior: 'instant' });
    });
    await page.waitForTimeout(2200);
    const r = await page.evaluate(geom);
    console.log(
      `\n=== ${view.id} @ ${m} m  scale=${r.scale} fov=${r.fov} aspect=${r.aspect} near=${r.near} far=${r.far} ===`
    );
    for (const o of r.objects.sort((a, b) => a.distance - b.distance)) {
      console.log(
        `  ${o.name.padEnd(20)} rel(${String(o.relX).padStart(5)},${String(o.relY).padStart(5)},${String(o.relZ).padStart(6)})m ` +
          `d=${String(o.distance).padStart(5)} size=${o.sizeM.join('x')} ` +
          `behind=${o.cornersBehindCamera}/8 sx=${o.screenX ? o.screenX.join('..') : 'none'} sy=${o.screenY ? o.screenY.join('..') : 'none'}`
      );
    }
  }
  await ctx.close();
}
await browser.close();

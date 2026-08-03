// Which named mass produces each region of the frame, per viewport and altitude.
// Renders every mountain child alone as a white mask and reports its column
// span, coverage and mean luminance in the real render.
import { chromium } from '@playwright/test';

const URL = process.env.URL ?? 'http://localhost:5177/home/hu.html';
const VIEWS = [
  { id: 'desktop', width: 1440, height: 900, dsf: 1, mobile: false },
  { id: '390x844', width: 390, height: 844, dsf: 3, mobile: true },
];
const STOPS = [0, 3_000, 7_000];

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

function perObject() {
  const s = globalThis.__stratos;
  const THREE = s.three;
  const { scene, camera, gl } = s;
  const ctx = gl.getContext();
  const W = ctx.drawingBufferWidth;
  const H = ctx.drawingBufferHeight;

  const isMountain = (o) => {
    let p = o;
    while (p) {
      if (p.userData?.mountainRoot) return true;
      p = p.parent;
    }
    return false;
  };

  const all = [];
  scene.traverse((o) => {
    if ((o.isMesh || o.isPoints || o.isSprite) && o.visible) all.push(o);
  });
  const mountainMeshes = all.filter(isMountain);
  const others = all.filter((o) => !isMountain(o));

  // real frame first
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

  const readMask = () => {
    gl.setClearColor(0x000000, 1);
    scene.overrideMaterial = white;
    gl.render(scene, camera);
    const px = new Uint8Array(W * H * 4);
    ctx.readPixels(0, 0, W, H, ctx.RGBA, ctx.UNSIGNED_BYTE, px);
    return px;
  };

  const COLS = 60;
  const summarise = (px) => {
    let covered = 0;
    let minC = COLS;
    let maxC = -1;
    let lumSum = 0;
    let lumN = 0;
    const colFill = new Array(COLS).fill(0);
    for (let i = 0; i < W * H; i++) {
      if (px[i * 4] <= 127) continue;
      covered++;
      const x = i % W;
      const c = Math.min(COLS - 1, Math.floor((x / W) * COLS));
      colFill[c]++;
      if (c < minC) minC = c;
      if (c > maxC) maxC = c;
      const L = 0.2126 * real[i * 4] + 0.7152 * real[i * 4 + 1] + 0.0722 * real[i * 4 + 2];
      lumSum += L;
      lumN++;
    }
    // columns this object fills for >70% of the frame height = a curtain column
    const curtainCols = colFill.filter((n) => n / (W / COLS) / H > 0.7).length;
    return {
      coverage: +(covered / (W * H)).toFixed(4),
      colFrom: minC < 0 ? null : +(minC / COLS).toFixed(3),
      colTo: maxC < 0 ? null : +((maxC + 1) / COLS).toFixed(3),
      fullHeightCols: +(curtainCols / COLS).toFixed(3),
      meanLum: lumN ? +(lumSum / lumN).toFixed(1) : null,
    };
  };

  const out = [];
  for (const target of mountainMeshes) {
    for (const o of all) o.visible = o === target;
    const px = readMask();
    out.push({
      name: target.name || '(unnamed)',
      tris: target.geometry.index
        ? target.geometry.index.count / 3
        : target.geometry.attributes.position.count / 3,
      ...summarise(px),
    });
  }

  for (const [o, v] of restore) o.visible = v;
  scene.overrideMaterial = prevOverride;
  gl.setClearColor(prevClear, prevAlpha);
  white.dispose();
  gl.render(scene, camera);

  return { W, H, altitude: Math.round(s.journey.altitude), objects: out, otherCount: others.length };
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

  for (const m of STOPS) {
    await page.evaluate((v) => {
      globalThis.__stratos.journey.debug.altitude = v;
    }, m);
    await page.waitForTimeout(120);
    await page.evaluate(() => {
      const max = document.documentElement.scrollHeight - innerHeight;
      scrollTo({ top: max * globalThis.__stratos.journey.current, behavior: 'instant' });
    });
    await page.waitForTimeout(2200);
    const r = await page.evaluate(perObject);
    console.log(`\n=== ${view.id} @ ${m} m  (buffer ${r.W}x${r.H}) ===`);
    for (const o of r.objects.sort((a, b) => b.coverage - a.coverage)) {
      console.log(
        `  ${o.name.padEnd(24)} cov=${String(o.coverage).padEnd(7)} ` +
          `cols ${o.colFrom}..${o.colTo}  fullHeightCols=${o.fullHeightCols}  ` +
          `lum=${o.meanLum}  tris=${o.tris}`
      );
    }
  }
  await ctx.close();
}
await browser.close();

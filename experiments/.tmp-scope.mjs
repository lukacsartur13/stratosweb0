// Scratch: a scope, not a deliverable. Renders the canvas alone (no HTML
// panels), then writes three PNGs per state: the frame as it is, the same frame
// lifted by a fixed gamma so the structure is legible to a human eye on any
// monitor, and the mountain mask. Judging a near-black picture by eye without a
// scope is how the previous pass passed numeric checks and failed review.
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const URL = process.env.URL ?? 'http://localhost:5177/home/hu.html';
const OUT = process.env.OUT ?? 'experiments/screenshots/scope';
const TAG = process.env.TAG ?? 'now';
const OVERRIDE = process.env.OVERRIDE ? JSON.parse(process.env.OVERRIDE) : null;
const VIEWS = (process.env.VIEWS ?? 'desktop,390x844').split(',');
const STOPS = (process.env.STOPS ?? '0,7000').split(',').map(Number);
const GAMMA = Number(process.env.GAMMA ?? 2.1);

const ALL = {
  desktop: { width: 1440, height: 900, dsf: 1, mobile: false },
  '430x932': { width: 430, height: 932, dsf: 3, mobile: true },
  '390x844': { width: 390, height: 844, dsf: 3, mobile: true },
  '360x800': { width: 360, height: 800, dsf: 3, mobile: true },
};

function grab(gamma) {
  const s = globalThis.__stratos;
  const THREE = s.three;
  const { scene, camera, gl } = s;
  const isM = (o) => { let p = o; while (p) { if (p.userData?.mountainRoot) return true; p = p.parent; } return false; };
  const ctx = gl.getContext();
  const W = ctx.drawingBufferWidth, H = ctx.drawingBufferHeight;

  gl.render(scene, camera);
  const real = new Uint8Array(W * H * 4);
  ctx.readPixels(0, 0, W, H, ctx.RGBA, ctx.UNSIGNED_BYTE, real);

  const hidden = [];
  scene.traverse((o) => {
    if ((o.isMesh || o.isPoints || o.isSprite) && o.visible && !isM(o)) { o.visible = false; hidden.push(o); }
  });
  const prevOverride = scene.overrideMaterial;
  const pc = new THREE.Color(); gl.getClearColor(pc); const pa = gl.getClearAlpha();
  scene.overrideMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
  gl.setClearColor(0x000000, 1);
  gl.render(scene, camera);
  const mask = new Uint8Array(W * H * 4);
  ctx.readPixels(0, 0, W, H, ctx.RGBA, ctx.UNSIGNED_BYTE, mask);
  scene.overrideMaterial?.dispose?.();
  scene.overrideMaterial = prevOverride;
  gl.setClearColor(pc, pa);
  for (const o of hidden) o.visible = true;
  gl.render(scene, camera);

  // Luminance -> a stepped false colour. Nine bands, so a value difference the
  // eye cannot find in a near-black image becomes a colour boundary it cannot
  // miss. This is the only honest way to judge "is there a value ladder" on a
  // picture whose whole range lives under sRGB 90.
  const BANDS = [
    [0, 8, [10, 10, 14]],        // near-black
    [8, 18, [40, 20, 80]],       // violet
    [18, 30, [20, 40, 140]],     // blue
    [30, 42, [0, 120, 160]],     // teal
    [42, 56, [0, 150, 70]],      // green
    [56, 72, [170, 170, 0]],     // yellow
    [72, 92, [220, 120, 0]],     // orange
    [92, 120, [220, 40, 40]],    // red
    [120, 256, [255, 255, 255]], // white
  ];
  const toFalse = (src) => {
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const c2 = cv.getContext('2d');
    const img = c2.createImageData(W, H);
    for (let y = 0; y < H; y++) {
      const sy = H - 1 - y;
      for (let x = 0; x < W; x++) {
        const si = (sy * W + x) * 4, di = (y * W + x) * 4;
        const L = 0.2126 * src[si] + 0.7152 * src[si + 1] + 0.0722 * src[si + 2];
        const b = BANDS.find((v) => L >= v[0] && L < v[1]) ?? BANDS[0];
        img.data[di] = b[2][0]; img.data[di + 1] = b[2][1]; img.data[di + 2] = b[2][2];
        img.data[di + 3] = 255;
      }
    }
    c2.putImageData(img, 0, 0);
    return cv.toDataURL('image/png').split(',')[1];
  };

  const toPng = (src, lift) => {
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const c2 = cv.getContext('2d');
    const img = c2.createImageData(W, H);
    for (let y = 0; y < H; y++) {
      const sy = H - 1 - y; // readPixels is bottom-up
      for (let x = 0; x < W; x++) {
        const si = (sy * W + x) * 4, di = (y * W + x) * 4;
        for (let k = 0; k < 3; k++) {
          const v = src[si + k] / 255;
          img.data[di + k] = Math.round(255 * (lift ? Math.pow(v, 1 / lift) : v));
        }
        img.data[di + 3] = 255;
      }
    }
    c2.putImageData(img, 0, 0);
    return cv.toDataURL('image/png').split(',')[1];
  };

  return { raw: toPng(real, 0), lifted: toPng(real, gamma), mask: toPng(mask, 0), bands: toFalse(real) };
}

const browser = await chromium.launch();
mkdirSync(OUT, { recursive: true });

for (const id of VIEWS) {
  const v = ALL[id];
  const context = await browser.newContext({
    viewport: { width: v.width, height: v.height },
    deviceScaleFactor: 1, isMobile: v.mobile, hasTouch: v.mobile,
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.addInitScript(() => {
    let x;
    Object.defineProperty(globalThis, '__stratos', {
      configurable: true, get: () => x,
      set: (n) => { x = n; if (n?.journey?.debug) n.journey.debug.ringRotation = 0; },
    });
  });
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('canvas');
  await page.waitForFunction(() => !!globalThis.__stratos?.scene, { timeout: 30000 });
  await page.waitForTimeout(5000);
  if (OVERRIDE) await page.evaluate((o) => Object.assign(globalThis.__stratos.journey.debug.mountainLook, o), OVERRIDE);

  for (const metres of STOPS) {
    await page.evaluate((m) => { globalThis.__stratos.journey.debug.altitude = m; }, metres);
    await page.waitForTimeout(2400);
    const g = await page.evaluate(grab, GAMMA);
    const stem = `${OUT}/${TAG}-${id}-${String(metres).padStart(5, '0')}`;
    writeFileSync(`${stem}-raw.png`, Buffer.from(g.raw, 'base64'));
    writeFileSync(`${stem}-lift.png`, Buffer.from(g.lifted, 'base64'));
    if (process.env.MASK) writeFileSync(`${stem}-mask.png`, Buffer.from(g.mask, 'base64'));
    writeFileSync(`${stem}-bands.png`, Buffer.from(g.bands, 'base64'));
    console.log(`${stem}`);
  }
  await context.close();
}
await browser.close();

// Scratch probe: what is actually in the mountain subtree, and what colour is
// each region of the frame at 0 m desktop.
import { chromium } from '@playwright/test';

const URL = process.env.URL ?? 'http://localhost:5177/home/hu.html';
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await context.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
page.on('console', (m) => m.type() === 'error' && console.log('CONSOLE', m.text()));
await page.addInitScript(() => {
  let v;
  Object.defineProperty(globalThis, '__stratos', {
    configurable: true,
    get: () => v,
    set: (n) => { v = n; if (n?.journey?.debug) n.journey.debug.ringRotation = 0; },
  });
});
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForSelector('canvas');
await page.waitForFunction(() => !!globalThis.__stratos?.scene, { timeout: 30000 });
await page.waitForTimeout(6000);

const info = await page.evaluate(() => {
  const s = globalThis.__stratos;
  const out = { meshes: [], lights: [], env: null };
  s.scene.traverse((o) => {
    if (o.userData?.mountainRoot) {
      o.traverse((c) => {
        if (!c.isMesh) return;
        const m = Array.isArray(c.material) ? c.material[0] : c.material;
        out.meshes.push({
          node: c.name,
          mat: m?.name || '(unnamed)',
          type: m?.type,
          color: m?.color?.getHexString(),
          rough: m?.roughness,
          metal: m?.metalness,
          envInt: m?.envMapIntensity,
          hasEnv: !!m?.envMap,
        });
      });
    }
    if (o.isLight) out.lights.push({ type: o.type, i: +o.intensity.toFixed(3), col: o.color?.getHexString(), pos: o.position.toArray().map((v) => +v.toFixed(2)) });
  });
  out.env = { envMap: !!s.scene.environment, background: !!s.scene.background, fog: !!s.scene.fog };
  out.camera = { pos: s.camera.position.toArray().map((v) => +v.toFixed(3)), fov: s.camera.fov, near: s.camera.near, far: s.camera.far };
  out.toneMapping = { mode: s.gl.toneMapping, exposure: s.gl.toneMappingExposure, outputColorSpace: s.gl.outputColorSpace };
  return out;
});
console.log(JSON.stringify(info, null, 1));

// Colour map: readback of the real frame, downsampled.
for (const metres of [0, 3000, 7000]) {
  await page.evaluate((m) => { globalThis.__stratos.journey.debug.altitude = m; }, metres);
  await page.waitForTimeout(2500);
  const grid = await page.evaluate(() => {
    const s = globalThis.__stratos;
    const { scene, camera, gl } = s;
    gl.render(scene, camera);
    const ctx = gl.getContext();
    const W = ctx.drawingBufferWidth, H = ctx.drawingBufferHeight;
    const px = new Uint8Array(W * H * 4);
    ctx.readPixels(0, 0, W, H, ctx.RGBA, ctx.UNSIGNED_BYTE, px);
    const rows = [];
    for (let r = 0; r < 12; r++) {
      const line = [];
      for (let c = 0; c < 16; c++) {
        const x = Math.round(((c + 0.5) / 16) * W);
        const y = H - 1 - Math.round(((r + 0.5) / 12) * H);
        const i = (y * W + x) * 4;
        line.push(((px[i] << 16) | (px[i + 1] << 8) | px[i + 2]).toString(16).padStart(6, '0'));
      }
      rows.push(line.join(' '));
    }
    return rows;
  });
  console.log(`\n--- ${metres} m ---`);
  for (const r of grid) console.log(r);
}

await browser.close();

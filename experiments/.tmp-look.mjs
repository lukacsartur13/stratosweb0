// Scratch: fast look iteration. Renders a few states, writes PNGs, and prints
// a tone summary so the picture can be judged numerically between eyeballs.
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const URL = process.env.URL ?? 'http://localhost:5177/home/hu.html';
const OUT = process.env.OUT ?? 'experiments/screenshots/look';
const TAG = process.env.TAG ?? 'now';
const OVERRIDE = process.env.OVERRIDE ? JSON.parse(process.env.OVERRIDE) : null;
const VIEWS = (process.env.VIEWS ?? 'desktop,390x844').split(',');
const STOPS = (process.env.STOPS ?? '0,3000,7000,12000').split(',').map(Number);

const ALL = {
  desktop: { width: 1440, height: 900, dsf: 1, mobile: false },
  '430x932': { width: 430, height: 932, dsf: 3, mobile: true },
  '390x844': { width: 390, height: 844, dsf: 3, mobile: true },
  '360x800': { width: 360, height: 800, dsf: 3, mobile: true },
};

/** Silhouette mask + tone histogram of the mountain pixels only. */
function analyse() {
  const s = globalThis.__stratos;
  const THREE = s.three;
  const { scene, camera, gl } = s;
  const isM = (o) => { let p = o; while (p) { if (p.userData?.mountainRoot) return true; p = p.parent; } return false; };

  const ctx = gl.getContext();
  const W = ctx.drawingBufferWidth, H = ctx.drawingBufferHeight;

  // pass 1 — the real frame
  gl.render(scene, camera);
  const real = new Uint8Array(W * H * 4);
  ctx.readPixels(0, 0, W, H, ctx.RGBA, ctx.UNSIGNED_BYTE, real);

  // pass 2 — the same frame with the range removed.
  //
  // A white silhouette of the range is the wrong mask for a *tone* metric: it
  // marks every pixel the range projects onto, including the ones the Meridian
  // is drawn in front of, so the instrument's own values end up in the
  // mountains' histogram. Differencing against a mountain-free render marks
  // exactly the pixels a mountain actually wins, which is the population the
  // question is about.
  const roots = [];
  scene.traverse((o) => { if (o.userData?.mountainRoot && o.visible) roots.push(o); });
  for (const r of roots) r.visible = false;
  gl.render(scene, camera);
  const without = new Uint8Array(W * H * 4);
  ctx.readPixels(0, 0, W, H, ctx.RGBA, ctx.UNSIGNED_BYTE, without);
  for (const r of roots) r.visible = true;
  gl.render(scene, camera);

  const mask = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const d =
      Math.abs(real[i * 4] - without[i * 4]) +
      Math.abs(real[i * 4 + 1] - without[i * 4 + 1]) +
      Math.abs(real[i * 4 + 2] - without[i * 4 + 2]);
    mask[i * 4] = d > 2 ? 255 : 0;
  }
  void THREE; void isM;

  // --- tone of the mountain pixels ----------------------------------------
  const lum = [];
  const bins = new Array(16).fill(0);
  let n = 0;
  for (let i = 0; i < W * H; i++) {
    if (mask[i * 4] <= 127) continue;
    const L = 0.2126 * real[i * 4] + 0.7152 * real[i * 4 + 1] + 0.0722 * real[i * 4 + 2];
    bins[Math.min(15, Math.floor(L / 16))]++;
    n++;
    if (n % 37 === 0) lum.push(L);
  }
  lum.sort((a, b) => a - b);
  const q = (p) => (lum.length ? Math.round(lum[Math.floor((p / 100) * (lum.length - 1))]) : 0);

  // --- depth-band tone: near/mid/far thirds of the frame by mountain depth --
  // Split by screen row is meaningless; split by the range's own depth using a
  // second mask pass would be expensive. Instead report tone by frame region.
  const region = (x0, x1, y0, y1) => {
    let sum = 0, c = 0;
    for (let y = Math.floor(y0 * H); y < Math.floor(y1 * H); y += 3) {
      for (let x = Math.floor(x0 * W); x < Math.floor(x1 * W); x += 3) {
        const i = (y * W + x);
        if (mask[i * 4] <= 127) continue;
        sum += 0.2126 * real[i * 4] + 0.7152 * real[i * 4 + 1] + 0.0722 * real[i * 4 + 2];
        c++;
      }
    }
    return c ? +(sum / c).toFixed(1) : null;
  };

  return {
    coverage: +(n / (W * H)).toFixed(4),
    p05: q(5), p25: q(25), p50: q(50), p75: q(75), p95: q(95),
    range: q(95) - q(5),
    bins: bins.map((b) => (n ? Math.round((b / n) * 100) : 0)),
    // readPixels rows are bottom-up: y0=0 is the BOTTOM of the frame.
    bottom: region(0, 1, 0, 0.33),
    middle: region(0, 1, 0.33, 0.66),
    top: region(0, 1, 0.66, 1),
    left: region(0, 0.33, 0, 1),
    centre: region(0.33, 0.66, 0, 1),
    right: region(0.66, 1, 0, 1),
  };
}

const browser = await chromium.launch();
mkdirSync(OUT, { recursive: true });
const report = [];

for (const id of VIEWS) {
  const v = ALL[id];
  const context = await browser.newContext({
    viewport: { width: v.width, height: v.height },
    deviceScaleFactor: v.dsf, isMobile: v.mobile, hasTouch: v.mobile,
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  page.on('console', (m) => m.type() === 'error' && console.log('CONSOLE', m.text()));
  await page.addInitScript(() => {
    let x;
    Object.defineProperty(globalThis, '__stratos', {
      configurable: true, get: () => x,
      set: (n) => { x = n; if (n?.journey?.debug) n.journey.debug.ringRotation = 0; },
    });
  });
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.addStyleTag({ content: '.debug, .debug__toggle { display: none !important; }' });
  await page.waitForSelector('canvas');
  await page.waitForFunction(() => !!globalThis.__stratos?.scene, { timeout: 30000 });
  await page.waitForTimeout(5000);

  if (OVERRIDE) {
    await page.evaluate((o) => Object.assign(globalThis.__stratos.journey.debug.mountainLook, o), OVERRIDE);
  }

  for (const metres of STOPS) {
    await page.evaluate((m) => { globalThis.__stratos.journey.debug.altitude = m; }, metres);
    await page.waitForTimeout(120);
    await page.evaluate(() => {
      const max = document.documentElement.scrollHeight - innerHeight;
      scrollTo({ top: max * globalThis.__stratos.journey.current, behavior: 'instant' });
    });
    await page.waitForTimeout(2400);
    const a = await page.evaluate(analyse);
    await page.screenshot({ path: `${OUT}/${TAG}-${id}-${String(metres).padStart(5, '0')}.png`, animations: 'disabled' });
    report.push({ view: id, metres, ...a });
    console.log(
      `${id.padEnd(9)} ${String(metres).padStart(5)}m cover=${String(a.coverage).padEnd(6)} ` +
      `p05=${String(a.p05).padStart(3)} p25=${String(a.p25).padStart(3)} p50=${String(a.p50).padStart(3)} ` +
      `p75=${String(a.p75).padStart(3)} p95=${String(a.p95).padStart(3)} range=${String(a.range).padStart(3)} ` +
      `| btm=${a.bottom} mid=${a.middle} top=${a.top} | L=${a.left} C=${a.centre} R=${a.right}`
    );
  }
  await context.close();
}
await browser.close();
writeFileSync(`${OUT}/${TAG}.json`, JSON.stringify(report, null, 1) + '\n');
console.log(`\nwritten ${OUT}/${TAG}-*.png`);

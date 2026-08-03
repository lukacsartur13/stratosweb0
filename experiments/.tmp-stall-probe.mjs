// Targeted diagnostic: find what the worst frame of a traversal actually is.
//
// The traversal row reports a single frame in the hundreds of milliseconds while
// every parked sample is clean. This records, per frame, the wall time, the
// altitude and the live WebGL program count, so the spike can be attributed
// rather than guessed at.
import { chromium } from '@playwright/test';

const URL = process.env.URL ?? 'http://127.0.0.1:4324/experiments/stratos-ascent-full/';
const W = Number(process.env.W ?? 2560);
const H = Number(process.env.H ?? 1440);
const DSF = Number(process.env.DSF ?? 2);

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({
  viewport: { width: W, height: H },
  deviceScaleFactor: DSF,
});
const page = await context.newPage();

await page.addInitScript(() => {
  window.__trace = [];
  window.__progs = 0;
  window.__shaderCompiles = 0;
  const patch = (proto) => {
    if (!proto) return;
    const cp = proto.createProgram;
    proto.createProgram = function (...a) {
      window.__progs++;
      return cp.apply(this, a);
    };
    const ln = proto.linkProgram;
    proto.linkProgram = function (...a) {
      window.__shaderCompiles++;
      return ln.apply(this, a);
    };
  };
  patch(window.WebGLRenderingContext && window.WebGLRenderingContext.prototype);
  patch(window.WebGL2RenderingContext && window.WebGL2RenderingContext.prototype);
});

await page.goto(URL, { waitUntil: 'load' });
await page.waitForSelector('canvas');
await page.waitForTimeout(4000);

const trace = await page.evaluate(async () => {
  const out = [];
  const max = document.documentElement.scrollHeight - innerHeight;
  const readAlt = () =>
    Number((document.querySelector('[data-testid="altitude-value"]')?.textContent ?? '').replace(/[^\d]/g, ''));
  const start = performance.now();
  let last = start;
  await new Promise((done) => {
    const step = (now) => {
      out.push({ dt: now - last, alt: readAlt(), progs: window.__progs, links: window.__shaderCompiles });
      last = now;
      const t = (now - start) / 12000;
      if (t >= 1) return done();
      const p = t < 0.5 ? t / 0.5 : 1 - (t - 0.5) / 0.5;
      scrollTo({ top: max * p, behavior: 'instant' });
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  return out;
});

await browser.close();

const frames = trace.slice(2);
const sorted = [...frames].sort((a, b) => b.dt - a.dt);
console.log(`frames: ${frames.length}`);
console.log('\nworst 12 frames (dt ms · altitude · cumulative programs · cumulative links):');
for (const f of sorted.slice(0, 12)) {
  console.log(`  ${f.dt.toFixed(1).padStart(7)} ms  @ ${String(f.alt).padStart(6)} m   progs ${f.progs}  links ${f.links}`);
}

console.log('\nframes where the program count increased:');
for (let i = 1; i < frames.length; i++) {
  if (frames[i].progs !== frames[i - 1].progs) {
    console.log(
      `  @ ${String(frames[i].alt).padStart(6)} m  progs ${frames[i - 1].progs} → ${frames[i].progs}  frame ${frames[i].dt.toFixed(1)} ms  (next ${frames[i + 1]?.dt.toFixed(1)} ms)`,
    );
  }
}

const over33 = frames.filter((f) => f.dt > 33.3);
console.log(`\nframes over 33.3 ms: ${over33.length}`);
for (const f of over33) console.log(`  ${f.dt.toFixed(1)} ms @ ${f.alt} m`);

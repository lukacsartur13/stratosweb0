// Does the persistent mountain override actually survive the render loop?
// The previous A/B was invalid because MountainRange's useFrame re-asserted
// visibility on the next frame. This samples across many frames, not one.
import { chromium } from '@playwright/test';

const URL = process.env.URL ?? 'http://localhost:5177/home/hu.html';

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

function observe() {
  const s = globalThis.__stratos;
  const { scene, gl } = s;
  // `visible` is not inherited in three: hiding the root stops the subtree
  // being drawn but leaves every child's own `visible` true. Counting the mesh
  // flag alone therefore reports the same triangles in both arms — the exact
  // mistake that made the first A/B run invalid.
  const isMountain = (o) => {
    let p = o;
    while (p) {
      if (p.userData?.mountainRoot) return true;
      p = p.parent;
    }
    return false;
  };
  const drawn = (o) => {
    let p = o;
    while (p) {
      if (!p.visible) return false;
      p = p.parent;
    }
    return true;
  };
  let rootsVisible = 0;
  let roots = 0;
  let visibleTriangles = 0;
  scene.traverse((o) => {
    if (o.userData?.mountainRoot) {
      roots++;
      if (o.visible) rootsVisible++;
    }
    if (o.isMesh && drawn(o) && isMountain(o)) {
      const g = o.geometry;
      visibleTriangles += g.index ? g.index.count / 3 : g.attributes.position.count / 3;
    }
  });
  return {
    mode: s.journey.debug.mountains,
    roots,
    rootsVisible,
    visibleTriangles: Math.round(visibleTriangles),
    calls: gl.info.render.calls,
    renderedTriangles: gl.info.render.triangles,
  };
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.addInitScript(freeze);
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!globalThis.__stratos?.scene, { timeout: 30_000 });
await page.waitForTimeout(5000);

await page.evaluate(() => {
  globalThis.__stratos.journey.debug.altitude = 0;
});
await page.waitForTimeout(1500);

let failed = false;
for (const mode of ['timeline', 'forced-on', 'forced-off', 'timeline', 'forced-off']) {
  await page.evaluate((m) => {
    globalThis.__stratos.journey.debug.mountains = m;
  }, mode);

  // Sample over ~60 rendered frames, not one, and require every sample to agree.
  const series = [];
  for (let i = 0; i < 12; i++) {
    await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    );
    series.push(await page.evaluate(observe));
  }

  const tri = [...new Set(series.map((s) => s.visibleTriangles))];
  const vis = [...new Set(series.map((s) => s.rootsVisible))];
  const stable = tri.length === 1 && vis.length === 1;
  const s0 = series[0];

  const expectHidden = mode === 'forced-off';
  const correct = expectHidden ? s0.rootsVisible === 0 && s0.visibleTriangles === 0 : s0.visibleTriangles > 0;

  if (!stable || !correct) failed = true;
  console.log(
    `${mode.padEnd(11)} roots ${s0.rootsVisible}/${s0.roots}  ` +
      `visibleTriangles ${JSON.stringify(tri)}  rootsVisible ${JSON.stringify(vis)}  ` +
      `renderCalls ${s0.calls}  ` +
      `${stable ? 'stable' : 'UNSTABLE ACROSS FRAMES'} / ${correct ? 'correct' : 'WRONG STATE'}`
  );
}

await page.evaluate(() => {
  globalThis.__stratos.journey.debug.mountains = 'timeline';
});
await ctx.close();
await browser.close();
console.log(failed ? '\nA/B OVERRIDE: FAILED' : '\nA/B OVERRIDE: persistent and correct across all frames');
process.exit(failed ? 1 : 0);

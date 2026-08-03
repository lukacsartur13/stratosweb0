// Real reverse-scroll traversal.
//
// Not altitude injection: `journey.debug.altitude` bypasses the scroll driver,
// the easing and ScrollTrigger entirely, so it can only ever prove that
// `mountainStateAt` is a pure function — which the unit tests already do. This
// drives `window.scrollTo` on the real page, forwards through every station and
// then backwards through the same ones, and compares the two sweeps.
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const URL = process.env.URL ?? 'http://localhost:5177/home/hu.html';
const VIEWS = [
  { id: 'desktop', width: 1440, height: 900, dsf: 1, mobile: false },
  { id: '390x844', width: 390, height: 844, dsf: 3, mobile: true },
];

/** Altitudes to hit, in order out and back. */
const STATIONS = [0, 3_000, 7_000, 12_000, 18_000, 30_000];

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
  // Count rAF loops so a second render loop cannot be created unnoticed.
  globalThis.__rafCount = 0;
  const raf = globalThis.requestAnimationFrame.bind(globalThis);
  globalThis.requestAnimationFrame = (cb) => {
    globalThis.__rafCount++;
    return raf(cb);
  };
}

/** Everything that has to unwind, read in one frame. */
function snapshot() {
  const s = globalThis.__stratos;
  const { scene, camera, gl } = s;
  const j = s.journey;
  const m = s.meridian;

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

  let roots = 0;
  let rootPos = null;
  let rootScale = null;
  let meshes = 0;
  let drawnTriangles = 0;
  let opacity = null;
  const names = [];
  scene.traverse((o) => {
    if (o.userData?.mountainRoot) {
      roots++;
      rootPos = [+o.position.x.toFixed(5), +o.position.y.toFixed(5), +o.position.z.toFixed(5)];
      rootScale = +o.scale.x.toFixed(6);
    }
    if (o.isMesh && isMountain(o)) {
      meshes++;
      names.push(o.name);
      if (drawn(o)) {
        const g = o.geometry;
        drawnTriangles += g.index ? g.index.count / 3 : g.attributes.position.count / 3;
        if (opacity === null) opacity = o.material?.uniforms?.uOpacity?.value ?? o.material?.opacity ?? null;
      }
    }
  });

  const stageEl = document.querySelector('.hud__stage');
  const srEl = document.querySelector('[data-testid="meridian-description"]');

  return {
    scroll: Math.round(scrollY),
    altitude: Math.round(j.altitude),
    current: +j.current.toFixed(6),
    stage: j.stage,
    power: +j.power.toFixed(4),
    mountainRoots: roots,
    mountainMeshes: meshes,
    mountainMeshNames: names.slice().sort().join(','),
    drawnTriangles: Math.round(drawnTriangles),
    opacity: opacity === null ? null : +Number(opacity).toFixed(4),
    rootPos,
    rootScale,
    aperture: m ? +Number(m.apertureOpen).toFixed(4) : null,
    lightBreakthrough: m ? +Number(m.lightBreakthrough).toFixed(4) : null,
    finalCalibration: m ? +Number(m.finalCalibration).toFixed(4) : null,
    axisExtension: m ? +Number(m.axisExtension).toFixed(4) : null,
    clarity: m ? +Number(m.clarity).toFixed(4) : null,
    // Every numeric field of every ring, so "ring locks unwind" is checked
    // against the whole ring state rather than one hand-picked scalar.
    rings: m?.rings
      ? m.rings.map((r) =>
          Object.fromEntries(
            Object.entries(r)
              .filter(([, v]) => typeof v === 'number')
              .map(([k, v]) => [k, +v.toFixed(4)])
          )
        )
      : null,
    stageLabel: stageEl ? stageEl.textContent.trim() : null,
    announcement: srEl ? srEl.textContent.trim() : null,
    sceneChildren: scene.children.length,
    geometries: gl.info.memory.geometries,
    textures: gl.info.memory.textures,
    programs: gl.info.programs?.length ?? null,
    rafCount: globalThis.__rafCount,
    cameraY: +camera.position.y.toFixed(5),
  };
}

/**
 * Park the page at a scroll fraction and wait for the damped clock to converge.
 *
 * Waiting on convergence rather than on a fixed timeout is the whole point: the
 * journey clock eases towards its target, so a fixed sleep samples a different
 * point on the ramp depending on how far the last jump was — which is exactly
 * how a forward and a reverse sweep end up at different altitudes and produce a
 * page of "differences" that are nothing but the easing still running.
 */
async function settleAt(page, fraction) {
  await page.evaluate((f) => {
    // A fraction of *the journey track*, not of the document: the footer and
    // the case studies sit below the track, so document fraction 0.5 is not
    // half way up the mountain. Same geometry the Playwright suite uses.
    const track = document.querySelector('[data-testid="journey-track"]');
    const travel = track
      ? track.offsetHeight - innerHeight
      : document.documentElement.scrollHeight - innerHeight;
    scrollTo({ top: (track?.offsetTop ?? 0) + travel * f, behavior: 'instant' });
    globalThis.__settleRun = (globalThis.__settleRun ?? 0) + 1;
    globalThis.__stable = 0;
    globalThis.__lastCurrent = undefined;
  }, fraction);
  // Require several *consecutive* stable polls. One comparison is not enough:
  // the first poll of a new settle can read a value identical to the previous
  // settle's simply because the clock has not started moving yet, which is how
  // the first version of this returned instantly and measured the ramp.
  await page.waitForFunction(
    () => {
      const j = globalThis.__stratos.journey;
      const last = globalThis.__lastCurrent;
      globalThis.__lastCurrent = j.current;
      if (last !== undefined && Math.abs(j.current - last) < 1e-7) globalThis.__stable++;
      else globalThis.__stable = 0;
      return globalThis.__stable >= 4;
    },
    { timeout: 60_000, polling: 100 }
  );
}

/**
 * The scroll fraction whose settled altitude is `metres`.
 *
 * Found once, on the way out, and then *replayed* on the way back. Comparing
 * the two sweeps at identical scroll positions is what makes the comparison a
 * test of reversibility rather than a test of whether a binary search happened
 * to converge to the same place twice.
 */
async function findFraction(page, metres) {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    await settleAt(page, mid);
    const alt = await page.evaluate(() => globalThis.__stratos.journey.altitude);
    if (alt < metres) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

const browser = await chromium.launch();
const out = {};

for (const view of VIEWS) {
  const ctx = await browser.newContext({
    viewport: { width: view.width, height: view.height },
    deviceScaleFactor: view.dsf,
    isMobile: view.mobile,
    hasTouch: view.mobile,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(freeze);
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!globalThis.__stratos?.scene, { timeout: 30_000 });
  await page.waitForTimeout(5000);

  const forward = [];
  const reverse = [];

  // Locate every station once, from the bottom, before any measuring.
  const fractions = [];
  for (const m of STATIONS) fractions.push(await findFraction(page, m));

  await settleAt(page, 0);
  const baseline = await page.evaluate(snapshot);

  // Out: 0 -> 30 000, in order.
  for (const f of fractions) {
    await settleAt(page, f);
    forward.push(await page.evaluate(snapshot));
  }
  // Back: the same fractions, in the opposite order.
  for (let i = fractions.length - 1; i >= 0; i--) {
    await settleAt(page, fractions[i]);
    reverse[i] = await page.evaluate(snapshot);
  }

  await settleAt(page, 0);
  const returned = await page.evaluate(snapshot);

  out[view.id] = { baseline, forward, reverse, returned, errors: [...new Set(errors)] };

  console.log(`\n=== ${view.id} — forward vs reverse at equal altitude ===`);
  const KEYS = [
    'altitude',
    'stage',
    'mountainRoots',
    'mountainMeshes',
    'mountainMeshNames',
    'drawnTriangles',
    'opacity',
    'rootPos',
    'rootScale',
    'aperture',
    'lightBreakthrough',
    'finalCalibration',
    'axisExtension',
    'clarity',
    'rings',
    'stageLabel',
    'sceneChildren',
  ];
  for (let i = 0; i < STATIONS.length; i++) {
    const f = forward[i];
    const r = reverse[i];
    const diffs = KEYS.filter((k) => JSON.stringify(f[k]) !== JSON.stringify(r[k]));
    console.log(
      `  ${String(STATIONS[i]).padStart(5)} m  fwd alt=${String(f.altitude).padStart(5)} ` +
        `tri=${String(f.drawnTriangles).padStart(6)} op=${f.opacity} roots=${f.mountainRoots} ` +
        `| rev alt=${String(r.altitude).padStart(5)} tri=${String(r.drawnTriangles).padStart(6)} ` +
        `op=${r.opacity} roots=${r.mountainRoots}  ` +
        (diffs.length ? `DIFFER: ${diffs.join(', ')}` : 'identical')
    );
    for (const k of diffs) {
      console.log(`        ${k}: fwd ${JSON.stringify(f[k])}  rev ${JSON.stringify(r[k])}`);
    }
  }

  const base = { ...baseline };
  const ret = { ...returned };
  const ignore = new Set(['rafCount', 'scroll', 'programs', 'textures']);
  const backDiffs = Object.keys(base).filter(
    (k) => !ignore.has(k) && JSON.stringify(base[k]) !== JSON.stringify(ret[k])
  );
  console.log(`  return to 0 m: ${backDiffs.length ? `DIFFERS in ${backDiffs.join(', ')}` : 'exact'}`);
  for (const k of backDiffs) {
    console.log(`        ${k}: start ${JSON.stringify(base[k])}  end ${JSON.stringify(ret[k])}`);
  }
  console.log(
    `  remount below 12 000 m: roots ${forward.map((f) => f.mountainRoots).join('')} out, ` +
      `${reverse.map((r) => r.mountainRoots).join('')} back`
  );
  console.log(
    `  scene objects: children ${baseline.sceneChildren} -> ${returned.sceneChildren}, ` +
      `mountain meshes ${baseline.mountainMeshes} -> ${returned.mountainMeshes}, ` +
      `geometries ${baseline.geometries} -> ${returned.geometries}`
  );
  console.log(`  page errors: ${errors.length ? [...new Set(errors)].join(' | ') : 'none'}`);

  await ctx.close();
}

await browser.close();
writeFileSync('experiments/bench-out/reverse-traversal.json', JSON.stringify(out, null, 1) + '\n');
console.log('\nwritten: experiments/bench-out/reverse-traversal.json');

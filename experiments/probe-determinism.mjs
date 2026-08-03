// =============================================================================
// Phase 5C: the determinism probe.
//
//     npm run dev:home                      # in another terminal, serves :5177
//     node experiments/probe-determinism.mjs
//
// Three questions the Playwright suite cannot answer, because they need the
// state at full float precision and the built route deliberately does not
// publish it:
//
//   1. Is the settled journey state a *function of scroll position* — the same
//      number from either direction, to the last bit? The suite can only see
//      the readout, which rounds to 10 m, and a stage boundary is decided far
//      below that.
//   2. Does the mountain root carry its canonical transform while it is hidden,
//      including on a freshly mounted root coming down from above? Nothing is
//      drawn there, so no screenshot can show it.
//   3. Is the stage at exactly 3 000 m the same in both directions, on every
//      viewport?
//
// Exits non-zero on any failure, so it can be run as a gate.
// =============================================================================
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const URL = process.env.URL ?? 'http://localhost:5177/home/hu.html';
const OUT = process.env.OUT ?? 'experiments/bench-out';

const VIEWS = [
  { id: 'desktop', width: 1440, height: 900, dsf: 1, mobile: false },
  { id: '430x932', width: 430, height: 932, dsf: 3, mobile: true },
  { id: '390x844', width: 390, height: 844, dsf: 3, mobile: true },
  { id: '360x800', width: 360, height: 800, dsf: 3, mobile: true },
];

/** The boundary the defect was reported at, plus its two neighbours. */
const STAGE_PROBES = [2_999.999, 3_000, 3_000.001];

/**
 * Altitudes around the mountain hide boundary. 12 400 m is `HIDE_ABOVE`;
 * 13 600 m is `UNMOUNT_ABOVE`. The band between 12 000 and 12 400 is the one
 * that used to hold a stale transform, and the band above 12 400 is where a
 * root that mounted coming down had never been written at all.
 */
const MOUNTAIN_PROBES = [11_000, 11_900, 11_999, 12_000, 12_001, 12_399, 12_400, 12_401, 13_000, 13_600];

function freezeIdleRotation() {
  let value;
  Object.defineProperty(globalThis, '__stratos', {
    configurable: true,
    get: () => value,
    set: (v) => {
      value = v;
      if (v?.journey?.debug) v.journey.debug.ringRotation = 0;
    },
  });
}

/**
 * The mountain root's transform, exactly as three holds it.
 *
 * `offset` is the quantity that actually has to be direction-free. The range is
 * placed by a similarity transform *about the camera* — `group.position =
 * camera.position − scale · cameraStation(altitude)` — so the world position is
 * the sum of two things, only one of which is a function of altitude alone. The
 * offset isolates the authored half. The world position is recorded alongside
 * it because a camera that has genuinely settled makes both exact, and a
 * difference in the world position with an identical offset says the camera has
 * not settled rather than that the range has moved.
 */
function readRoot() {
  const { scene, camera } = globalThis.__stratos;
  let root = null;
  scene.traverse((o) => {
    if (o.userData?.mountainRoot) root = o;
  });
  if (!root) return null;
  root.updateWorldMatrix(true, false);
  return {
    position: [root.position.x, root.position.y, root.position.z],
    offset: [
      root.position.x - camera.position.x,
      root.position.y - camera.position.y,
      root.position.z - camera.position.z,
    ],
    scale: [root.scale.x, root.scale.y, root.scale.z],
    quaternion: [root.quaternion.x, root.quaternion.y, root.quaternion.z, root.quaternion.w],
    visible: root.visible,
    // Opacity is on the shared terrain material, which is what `applyLook`
    // writes. A hidden root whose look pass was skipped keeps a stale one.
    opacity: (() => {
      let v = null;
      root.traverse((o) => {
        if (v === null && o.isMesh) v = o.material?.uniforms?.uOpacity?.value ?? null;
      });
      return v;
    })(),
  };
}

/** Full-precision journey state. No rounding anywhere. */
function readState() {
  const j = globalThis.__stratos.journey;
  return {
    scroll: scrollY,
    target: j.target,
    current: j.current,
    altitude: j.altitude,
    stage: j.stage,
    power: j.power,
    camera: (() => {
      const c = globalThis.__stratos.camera;
      return [c.position.x, c.position.y, c.position.z];
    })(),
    label: document.querySelector('.hud__stage')?.textContent?.trim() ?? null,
    announced: document.querySelector('.hud')?.dataset.stage ?? null,
    root: (() => {
      try {
        return globalThis.__readRoot();
      } catch {
        return null;
      }
    })(),
  };
}

/** Park at a scroll position and wait for the clock to stop moving entirely. */
async function settleAt(page, y) {
  await page.evaluate((to) => {
    scrollTo({ top: to, behavior: 'instant' });
    globalThis.__stable = 0;
    globalThis.__last = undefined;
  }, y);
  await page.waitForFunction(
    () => {
      const j = globalThis.__stratos.journey;
      const last = globalThis.__last;
      globalThis.__last = j.current;
      // Exact equality, not a tolerance. With the settle snap in place the
      // clock reaches a fixed point rather than crawling towards one, and
      // asking for the fixed point is the whole experiment.
      if (last !== undefined && j.current === last) globalThis.__stable++;
      else globalThis.__stable = 0;
      return globalThis.__stable >= 6;
    },
    undefined,
    { timeout: 60_000, polling: 60 }
  );
}

/**
 * Hold an exact altitude through the debug override, and wait for the *camera*
 * to stop as well.
 *
 * Pinning the altitude fixes the clock instantly; it does not fix the camera,
 * whose dolly eases towards a target derived from that altitude. The first
 * version of this probe waited a flat 180 ms and reported the mountain root as
 * direction-dependent by two tenths of a scene unit — which was true of the
 * measurement and not of the application: 180 ms is about eleven frames, and at
 * a smoothing of 0.86 that leaves a fifth of the gap unclosed. Waiting for the
 * camera to reach a fixed point is what makes the reading describe the settled
 * state rather than the ramp.
 */
async function holdAt(page, metres, { allowMount = false } = {}) {
  await page.evaluate((m) => {
    globalThis.__stratos.journey.debug.altitude = m;
    globalThis.__camStable = 0;
    globalThis.__camLast = '';
  }, metres);
  // Crossing a residency threshold remounts the range, which re-runs the GLB
  // load. The asset is in the HTTP cache by now, but the decode is not free and
  // the root does not exist until it finishes.
  if (allowMount) await page.waitForTimeout(1_200);
  await page.waitForFunction(
    () => {
      const c = globalThis.__stratos.camera;
      const now = `${c.position.x},${c.position.y},${c.position.z}`;
      if (now === globalThis.__camLast) globalThis.__camStable++;
      else globalThis.__camStable = 0;
      globalThis.__camLast = now;
      return globalThis.__camStable >= 6;
    },
    undefined,
    { timeout: 30_000, polling: 60 }
  );
}

const release = (page) =>
  page.evaluate(() => {
    globalThis.__stratos.journey.debug.altitude = null;
  });

const browser = await chromium.launch();
mkdirSync(OUT, { recursive: true });

const results = {};
const failures = [];

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
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.addInitScript(freezeIdleRotation);
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!globalThis.__stratos?.scene, { timeout: 30_000 });
  await page.waitForTimeout(5_000); // the mountain GLB is fetched and decoded after the first frame
  await page.evaluate(`globalThis.__readRoot = ${readRoot.toString()}`);

  const view_out = { stage: [], mountain: [], scroll: [], errors: [] };

  // -------------------------------------------------------------------------
  // 1. The stage at an exact altitude, driven up to it and then down to it.
  // -------------------------------------------------------------------------
  for (const m of STAGE_PROBES) {
    await holdAt(page, 1_000); // approach from below
    const up = (await page.evaluate(readState)).stage;
    await holdAt(page, m);
    const upAt = await page.evaluate(readState);

    await holdAt(page, 5_000); // approach from above
    const down = (await page.evaluate(readState)).stage;
    await holdAt(page, m);
    const downAt = await page.evaluate(readState);

    const ok = upAt.stage === downAt.stage && upAt.altitude === downAt.altitude && upAt.label === downAt.label;
    view_out.stage.push({
      metres: m,
      fromBelow: { via: up, stage: upAt.stage, altitude: upAt.altitude, label: upAt.label },
      fromAbove: { via: down, stage: downAt.stage, altitude: downAt.altitude, label: downAt.label },
      ok,
    });
    if (!ok) failures.push(`${view.id}: stage at ${m} m is ${upAt.stage} up / ${downAt.stage} down`);
  }
  await release(page);

  // -------------------------------------------------------------------------
  // 2. The mountain root transform around the hide boundary, both directions.
  //
  // The descending pass starts from above `UNMOUNT_ABOVE`, so the root it finds
  // on the way down is a freshly mounted one. That is the case that used to
  // sit at the world origin for 1 600 m of travel.
  // -------------------------------------------------------------------------
  await holdAt(page, 0, { allowMount: true });
  const ascending = [];
  for (const m of MOUNTAIN_PROBES) {
    await holdAt(page, m);
    ascending.push(await page.evaluate(readState));
  }
  await holdAt(page, 16_000, { allowMount: true }); // past the unmount threshold — forces a remount coming back
  const descending = [];
  for (let i = MOUNTAIN_PROBES.length - 1; i >= 0; i--) {
    await holdAt(page, MOUNTAIN_PROBES[i], { allowMount: true });
    descending[i] = await page.evaluate(readState);
  }
  await release(page);

  for (let i = 0; i < MOUNTAIN_PROBES.length; i++) {
    const metres = MOUNTAIN_PROBES[i];
    const a = ascending[i];
    const d = descending[i];
    const same = (k) => JSON.stringify(a.root?.[k]) === JSON.stringify(d.root?.[k]);

    // Residency is allowed to be asymmetric and is not a finding. The mount
    // rule enters early and leaves late by construction — that hysteresis is
    // what stops a visitor parked on the boundary remounting every frame — so
    // above `HIDE_ABOVE`, where opacity is already zero and nothing is drawn,
    // the range can legitimately be mounted going up and not yet mounted
    // coming down. What must match is the *transform of a root that exists*.
    const residencyMayDiffer = metres > 12_400;
    const bothPresent = !!a.root === !!d.root;
    const comparable = a.root && d.root;
    const ok =
      (bothPresent || residencyMayDiffer) &&
      (!comparable || (same('offset') && same('scale') && same('quaternion') && same('visible') && same('opacity')));

    view_out.mountain.push({
      metres,
      up: a.root && { offset: a.root.offset, position: a.root.position, visible: a.root.visible, opacity: a.root.opacity },
      down: d.root && { offset: d.root.offset, position: d.root.position, visible: d.root.visible, opacity: d.root.opacity },
      camera: { up: a.camera, down: d.camera },
      residencyMayDiffer,
      ok,
    });
    if (!ok) {
      failures.push(
        `${view.id}: mountain root at ${metres} m differs — ` +
          `up offset=${JSON.stringify(a.root?.offset)} vis=${a.root?.visible} ` +
          `down offset=${JSON.stringify(d.root?.offset)} vis=${d.root?.visible}`
      );
    }
    // The property the fix exists for: a mounted root always carries its
    // canonical transform, drawn or not. An unwritten root sits at the world
    // origin, which the camera-relative offset can never be — the Blender
    // station is never nearer than 200 model metres.
    for (const [dir, s] of [
      ['up', a],
      ['down', d],
    ]) {
      if (s.root && Math.abs(s.root.offset[1]) < 1) {
        failures.push(
          `${view.id}: mountain root carried no station at ${metres} m (${dir}) — ` +
            `offset ${JSON.stringify(s.root.offset)}`
        );
      }
    }
  }

  // -------------------------------------------------------------------------
  // 3. Scroll reproducibility: the same scroll position from either direction.
  // -------------------------------------------------------------------------
  // The track is walked once first so every lazily decoded case-study image has
  // arrived and `useStageCalibration` has settled. Without that the map from
  // scroll position to altitude changes underneath the comparison and the
  // difference measured is a re-layout rather than a direction dependency.
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let i = 0; i <= 12; i++) {
    await page.evaluate((y) => scrollTo({ top: y, behavior: 'instant' }), (height * i) / 12);
    await page.waitForTimeout(200);
  }
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
  await page.waitForTimeout(1_500);

  const boundaries = await page.evaluate(() => {
    const track = document.querySelector('[data-testid="journey-track"]');
    const top = track?.offsetTop ?? 0;
    const travel = (track?.offsetHeight ?? document.documentElement.scrollHeight) - innerHeight;
    return Array.from(document.querySelectorAll('[id^="stage-"]'))
      .map((el) => top + Math.round(el.getBoundingClientRect().top + scrollY - top))
      .filter((y) => y > 0 && y < top + travel);
  });

  for (const y of boundaries) {
    await settleAt(page, Math.max(0, y - 600));
    await settleAt(page, y);
    const up = await page.evaluate(readState);
    await settleAt(page, y + 600);
    await settleAt(page, y);
    const down = await page.evaluate(readState);

    const ok = up.target === down.target && up.current === down.current && up.altitude === down.altitude;
    view_out.scroll.push({
      y,
      up: { target: up.target, current: up.current, altitude: up.altitude, stage: up.stage },
      down: { target: down.target, current: down.current, altitude: down.altitude, stage: down.stage },
      snapped: { up: up.current === up.target, down: down.current === down.target },
      ok,
      sameStage: up.stage === down.stage,
    });
    if (!ok) {
      failures.push(
        `${view.id}: scroll ${y} settled differently — ` +
          `up target=${up.target} current=${up.current} alt=${up.altitude} stage=${up.stage} / ` +
          `down target=${down.target} current=${down.current} alt=${down.altitude} stage=${down.stage}`
      );
    }
  }

  view_out.errors = [...new Set(errors)];
  results[view.id] = view_out;

  // --- report -------------------------------------------------------------
  console.log(`\n=== ${view.id} ============================================`);
  for (const s of view_out.stage) {
    console.log(
      `  stage @ ${String(s.metres).padStart(9)} m  up=${s.fromBelow.stage.padEnd(18)} ` +
        `down=${s.fromAbove.stage.padEnd(18)} ${s.ok ? 'identical' : 'DIFFER'}`
    );
  }
  for (const m of view_out.mountain) {
    const p = (r) =>
      r
        ? `offset [${r.offset.map((v) => v.toFixed(6)).join(', ')}] vis=${r.visible ? 1 : 0} ` +
          `op=${r.opacity === null ? '-' : Number(r.opacity).toFixed(4)}`
        : 'unmounted';
    console.log(
      `  root  @ ${String(m.metres).padStart(6)} m  ${m.ok ? 'identical' : 'DIFFER'}` +
        `${m.residencyMayDiffer ? '  (residency hysteresis band)' : ''}` +
        `\n        up   ${p(m.up)}\n        down ${p(m.down)}`
    );
  }
  for (const s of view_out.scroll) {
    console.log(
      `  scroll ${String(s.y).padStart(6)}  alt up=${s.up.altitude.toFixed(6)} down=${s.down.altitude.toFixed(6)}  ` +
        `snap=${s.snapped.up ? 1 : 0}${s.snapped.down ? 1 : 0}  ` +
        `${s.ok ? 'identical' : 'DIFFER'}${s.sameStage ? '' : '  STAGE FLIP'}`
    );
  }
  if (view_out.errors.length) console.log(`  !! errors: ${view_out.errors.slice(0, 4).join(' | ')}`);

  await ctx.close();
}

await browser.close();
writeFileSync(`${OUT}/determinism.json`, JSON.stringify(results, null, 1) + '\n');

console.log('\n--- verdict ----------------------------------------------------');
if (failures.length) {
  console.log(`NOT DETERMINISTIC — ${failures.length} failures:`);
  for (const f of failures) console.log(`  ${f}`);
} else {
  console.log('deterministic: stage, mountain root transform and settled scroll state');
  console.log('all reproduce exactly from either direction, on all four viewports.');
}
console.log(`written: ${OUT}/determinism.json`);
process.exitCode = failures.length ? 1 : 0;

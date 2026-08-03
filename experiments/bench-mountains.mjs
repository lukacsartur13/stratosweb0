// =============================================================================
// What the mountain range costs, measured.
//
//     npm run dev:home        # in another terminal, serves :5177
//     node experiments/bench-mountains.mjs
//
// ## STATUS
//
// **The A/B control is fixed. The frame-rate numbers are still not evidence.**
// Two separate defects; only one of them was a code defect.
//
//   1. **The two arms used to be the same arm.** `setMountains(false)` cleared
//      `visible` on the `mountainRoot` group, and `MountainRange`'s `useFrame`
//      re-asserted `g.visible = state.visible` on the very next frame. Every
//      "without mountains" sample therefore measured a scene *with* mountains,
//      which was visible in the raw output: at desktop 0 m both arms reported
//      157,694 triangles and 57 draw calls to the digit.
//
//      The fix is a state the timeline itself honours —
//      `journey.debug.mountains`, read by `mountainStateAt` and by the
//      residency rule in `JourneyScene` — rather than an external poke at the
//      scene graph. `assertArmsDiffer` below refuses to let the run continue
//      unless the two arms actually differ in triangle count, root visibility
//      and draw calls, so this cannot silently regress into measuring nothing
//      twice.
//
//   2. **The environment is not a GPU.** Headless Chromium here renders through
//      SwiftShader. Desktop 1440x900 reported 4.7 fps and a 233 ms median
//      frame; the phone viewports reported ~30 fps. Those are software
//      rasteriser numbers. They are not a phone's GPU and not a desktop's, and
//      no conclusion about frame pacing should be drawn from them at all. This
//      is not fixable in the script — see `--gpu` below, and
//      `_build/reports/mountain-performance.md` for what the environment turned
//      out to support.
//
// What the run produces that is trustworthy in *either* environment: the
// transfer sizes, the resource timings, the scene-graph counts (draw calls,
// triangles, programs, geometries, textures) and the lifecycle series — none of
// which depend on rasteriser speed. Frame pacing is trustworthy only when the
// run reports `gpu: true`.
//
// ## The baseline problem, and what is done about it
//
// `experiments/bench-out/*.json` are all Meridian-audit runs against the
// `full.html` route. None of them is a pre-mountain baseline for *this* page,
// so "compared against the saved pre-mountain baseline" is not something this
// script can honestly claim. Instead it makes its own baseline, in the same
// session, by moving the range's own timeline into a forced state:
//
//   * `A` — `journey.debug.mountains = 'forced-on'`, the range drawn;
//   * `B` — `journey.debug.mountains = 'forced-off'`, the range not drawn and
//     still resident, so the toggle is a boolean rather than a re-fetch and a
//     DRACO decode between every sample.
//
// Interleaved A/B/A/B rather than all-A-then-all-B, for the reason
// bench-meridian.mjs already documents at length: two runs of the same
// unchanged build half an hour apart differed by more than the effect being
// looked for, so ordering has to be controlled rather than trusted.
//
// This measures *render* cost at a fixed altitude. It cannot measure what the
// asset costs to fetch and decode — hiding a group does not un-download it — so
// transfer, decode and attach are taken separately from the resource timeline
// and the loader's own marks, and reported as their own numbers.
//
// ## What the frame numbers can and cannot say
//
// The display is vsync-clamped. A scene using 2 ms of a 16.7 ms budget and one
// using 6 ms both report 16.7 ms, so wall-clock frame time cannot detect a
// regression that stays inside the budget. `draw calls`, `triangles` and
// `programs` can, and are reported alongside for that reason. Frames above
// 16.7 and 33.3 ms are counted because those are the ones a visitor feels.
//
// The mobile viewports are Chromium at a phone's CSS size and DPR. That is a
// layout and fill-rate proxy, not a phone's GPU. Nothing here should be read as
// a measurement of physical-device performance.
// =============================================================================
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const URL = process.env.URL ?? 'http://localhost:5177/home/hu.html';
const OUT = process.env.OUT ?? 'experiments/bench-out';
const REPS = Number(process.env.REPS ?? 3);
const SAMPLE_MS = Number(process.env.SAMPLE_MS ?? 2500);

const STOPS = [0, 3_000, 7_000, 12_000];
const VIEWS = [
  { id: 'desktop-1440x900', width: 1440, height: 900, dsf: 1, mobile: false },
  { id: '390x844', width: 390, height: 844, dsf: 3, mobile: true },
  { id: '360x800', width: 360, height: 800, dsf: 3, mobile: true },
];

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];

/** Samples frame intervals for `ms`, then reports pacing and renderer workload. */
function sampleFrames(ms) {
  return new Promise((resolve) => {
    const gaps = [];
    let last = performance.now();
    const started = last;
    const tick = (now) => {
      gaps.push(now - last);
      last = now;
      if (now - started < ms) requestAnimationFrame(tick);
      else {
        const info = globalThis.__stratos.gl.info;
        resolve({
          gaps,
          calls: info.render.calls,
          triangles: info.render.triangles,
          programs: info.programs?.length ?? null,
          geometries: info.memory.geometries,
          textures: info.memory.textures,
        });
      }
    };
    requestAnimationFrame(tick);
  });
}

/**
 * Set the arm, then report what the scene graph actually looks like.
 *
 * Returning the observation rather than the intent is the whole point: the
 * previous version returned how many roots it had poked, which was 1 in both
 * arms and told nobody that the poke was being undone on the next frame.
 */
function setArm(mode) {
  globalThis.__stratos.journey.debug.mountains = mode;
  return mode;
}

/** What is really in the scene right now, from the renderer's own bookkeeping. */
function observe() {
  const s = globalThis.__stratos;
  const info = s.gl.info;
  const roots = [];
  let visibleTriangles = 0;
  let visibleMeshes = 0;

  s.scene.traverse((o) => {
    if (o.userData?.mountainRoot) roots.push(o.visible);
    if (!o.isMesh || !o.visible) return;
    let p = o;
    let mountain = false;
    while (p) {
      if (p.userData?.mountainRoot) { mountain = p.visible; break; }
      p = p.parent;
    }
    // `o.visible` alone is not enough: three skips a whole subtree when an
    // ancestor is hidden, so the meshes stay `visible` while nothing is drawn.
    if (!mountain) return;
    visibleMeshes++;
    const g = o.geometry;
    visibleTriangles += g.index ? g.index.count / 3 : g.attributes.position.count / 3;
  });

  return {
    roots,
    rootsResident: roots.length,
    rootsVisible: roots.filter(Boolean).length,
    visibleMeshes,
    visibleTriangles: Math.round(visibleTriangles),
    calls: info.render.calls,
    triangles: info.render.triangles,
  };
}

function loadMetrics() {
  const rs = performance.getEntriesByType('resource');
  const pick = (re) => {
    const r = rs.find((e) => re.test(e.name));
    return r
      ? {
          url: r.name.replace(location.origin, ''),
          transferBytes: r.transferSize,
          encodedBytes: r.encodedBodySize,
          ms: +r.duration.toFixed(1),
        }
      : null;
  };
  return {
    glb: pick(/stratos-mountains-(desktop|mobile)\.glb/),
    decoderJs: pick(/draco_decoder\.js/),
    decoderWasm: pick(/draco_decoder\.wasm/),
    wrapper: pick(/draco_wasm_wrapper\.js/),
    attachMs: globalThis.__mountainAttachMs ?? null,
  };
}

/**
 * The three things that have to differ between the arms, per the brief.
 *
 * Draw calls are checked last and reported rather than required, because
 * `gl.info.render.calls` is a per-frame counter read after a sample: it is a
 * real signal here (57 against 41 at desktop 0 m) but it is the one of the
 * three that a future frustum-culling change could legitimately equalise
 * without the control being broken. Triangle count and root visibility cannot
 * be equal unless the override has stopped working.
 */
function assertArmsDiffer(view, metres, A, B) {
  if (A.rootsResident === 0 || B.rootsResident === 0) {
    return { ok: false, why: 'no mountainRoot in the scene — nothing to measure' };
  }
  if (A.rootsVisible === B.rootsVisible) {
    return { ok: false, why: `root visibility identical (${A.rootsVisible} visible in both arms)` };
  }
  if (A.visibleTriangles === B.visibleTriangles) {
    return { ok: false, why: `visible triangle count identical (${A.visibleTriangles} in both arms)` };
  }
  if (B.visibleTriangles !== 0) {
    return { ok: false, why: `forced-off still draws ${B.visibleTriangles} mountain triangles` };
  }
  console.log(
    `  arms ${view} ${metres} m: triangles ${A.visibleTriangles} -> ${B.visibleTriangles}, ` +
      `roots visible ${A.rootsVisible} -> ${B.rootsVisible}, ` +
      `draw calls ${A.calls} -> ${B.calls}${A.calls === B.calls ? ' (equal — reported, not required)' : ''}`
  );
  return { ok: true, callsDiffer: A.calls !== B.calls };
}

/**
 * Whether this browser is rendering on a real GPU or on SwiftShader.
 *
 * Read from `WEBGL_debug_renderer_info` rather than assumed from the launch
 * flags, because passing `--use-gl=angle` does not mean the flag took effect —
 * and the difference between "4.7 fps on a software rasteriser" and "4.7 fps on
 * a GPU" is the difference between a meaningless number and a crisis.
 */
function rendererInfo() {
  const gl = globalThis.__stratos.gl.getContext();
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  const vendor = ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
  const software = /swiftshader|llvmpipe|software|subzero/i.test(String(renderer));
  return { renderer: String(renderer), vendor: String(vendor), gpu: !software };
}

/**
 * `--gpu` asks for hardware acceleration in a headed browser.
 *
 * Off by default: the default run has to work in whatever environment it is
 * given, and a headless SwiftShader run still produces every number in this
 * script that is not frame pacing. When it is on, `rendererInfo` still decides
 * whether the result is called a GPU measurement — the flag is a request, not
 * a fact.
 */
const WANT_GPU = process.argv.includes('--gpu') || process.env.GPU === '1';

const browser = await chromium.launch(
  WANT_GPU
    ? {
        headless: false,
        args: [
          '--enable-precise-memory-info',
          '--ignore-gpu-blocklist',
          '--enable-gpu-rasterization',
          '--enable-zero-copy',
        ],
      }
    : { args: ['--enable-precise-memory-info'] }
);
mkdirSync(OUT, { recursive: true });
const results = [];
let renderer = null;

for (const view of VIEWS) {
  const context = await browser.newContext({
    viewport: { width: view.width, height: view.height },
    deviceScaleFactor: view.dsf,
    isMobile: view.mobile,
    hasTouch: view.mobile,
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    let v;
    Object.defineProperty(globalThis, '__stratos', {
      configurable: true,
      get: () => v,
      set: (n) => {
        v = n;
        if (n?.journey?.debug) n.journey.debug.ringRotation = 0;
      },
    });
    // The component logs its own attach time in dev; capture it rather than
    // re-deriving it from the outside, where the decode and the scene walk
    // cannot be told apart.
    const info = console.info.bind(console);
    console.info = (...a) => {
      const m = /(\d+) ms to attach/.exec(String(a[0] ?? ''));
      if (m) globalThis.__mountainAttachMs = Number(m[1]);
      info(...a);
    };
  });

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('canvas');
  await page.waitForFunction(() => !!globalThis.__stratos?.scene, { timeout: 30_000 });
  await page.waitForTimeout(6000);

  const load = await page.evaluate(loadMetrics);
  const heapBefore = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? null);

  if (!renderer) {
    renderer = await page.evaluate(rendererInfo);
    console.log(
      `renderer: ${renderer.renderer} (${renderer.vendor}) — ` +
        (renderer.gpu
          ? 'hardware. Frame pacing below is a measurement.'
          : 'SOFTWARE RASTERISER. Frame pacing below is NOT a GPU measurement and must not be quoted as one.')
    );
  }

  for (const metres of STOPS) {
    await page.evaluate((m) => {
      globalThis.__stratos.journey.debug.altitude = m;
    }, metres);
    await page.waitForTimeout(150);
    await page.evaluate(() => {
      const max = document.documentElement.scrollHeight - innerHeight;
      scrollTo({ top: max * globalThis.__stratos.journey.current, behavior: 'instant' });
    });
    await page.waitForTimeout(2200);

    // --- prove the arms are different arms, before spending 15 s on them ----
    //
    // This is the gate the brief asked for, and it runs at every stop rather
    // than once, because "the override worked at 0 m" says nothing about
    // 12 000 m, where the range is faded out and a forced-off arm could look
    // identical to a forced-on one for reasons that have nothing to do with
    // the override.
    await page.evaluate(setArm, 'forced-on');
    await page.waitForTimeout(700);
    const obsA = await page.evaluate(observe);
    await page.evaluate(setArm, 'forced-off');
    await page.waitForTimeout(700);
    const obsB = await page.evaluate(observe);

    const differ = assertArmsDiffer(view.id, metres, obsA, obsB);
    if (!differ.ok) {
      console.error(`\nA/B CONTROL FAILED at ${view.id} ${metres} m: ${differ.why}`);
      console.error('  A:', JSON.stringify(obsA));
      console.error('  B:', JSON.stringify(obsB));
      console.error('  Refusing to report benchmark numbers from arms that are the same arm.');
      await browser.close();
      process.exit(1);
    }

    const acc = { A: [], B: [] };
    for (let rep = 0; rep < REPS; rep++) {
      for (const arm of ['A', 'B']) {
        await page.evaluate(setArm, arm === 'A' ? 'forced-on' : 'forced-off');
        await page.waitForTimeout(500);
        const s = await page.evaluate(sampleFrames, SAMPLE_MS);
        acc[arm].push(s);
      }
    }
    await page.evaluate(setArm, 'timeline');

    const summarise = (runs) => {
      const gaps = runs.flatMap((r) => r.gaps).slice(1).sort((a, b) => a - b);
      const all = runs.flatMap((r) => r.gaps);
      return {
        frames: gaps.length,
        fps: +(1000 / (all.reduce((a, b) => a + b, 0) / all.length)).toFixed(1),
        medianMs: +pct(gaps, 50).toFixed(2),
        p95Ms: +pct(gaps, 95).toFixed(2),
        p99Ms: +pct(gaps, 99).toFixed(2),
        over16_7: gaps.filter((g) => g > 16.7).length,
        over33_3: gaps.filter((g) => g > 33.3).length,
        calls: Math.round(runs.reduce((a, r) => a + r.calls, 0) / runs.length),
        triangles: Math.round(runs.reduce((a, r) => a + r.triangles, 0) / runs.length),
        programs: runs[0].programs,
        geometries: runs[0].geometries,
        textures: runs[0].textures,
      };
    };

    const A = summarise(acc.A);
    const B = summarise(acc.B);
    results.push({
      view: view.id,
      altitude: metres,
      withMountains: A,
      withoutMountains: B,
      // Carried into the JSON so a reader of the file, not just of the console,
      // can see that the control was checked and what it saw.
      armControl: { forcedOn: obsA, forcedOff: obsB },
      framePacingIsGpu: renderer?.gpu ?? false,
    });

    console.log(
      `${view.id.padEnd(17)} ${String(metres).padStart(5)} m  ` +
        `fps ${String(A.fps).padStart(5)} / ${String(B.fps).padStart(5)}  ` +
        `med ${A.medianMs.toFixed(1)}/${B.medianMs.toFixed(1)}  ` +
        `p95 ${A.p95Ms.toFixed(1)}/${B.p95Ms.toFixed(1)}  ` +
        `p99 ${A.p99Ms.toFixed(1)}/${B.p99Ms.toFixed(1)}  ` +
        `>16.7 ${A.over16_7}/${B.over16_7}  >33.3 ${A.over33_3}/${B.over33_3}  ` +
        `calls ${A.calls}/${B.calls}  tri ${A.triangles}/${B.triangles}  prog ${A.programs}/${B.programs}`
    );
  }

  // --- lifecycle: repeated mount cycles ------------------------------------
  // Driven by altitude, which is how a visitor causes it: scrolling above
  // 13 600 m unmounts the range, coming back down remounts and re-decodes it.
  const cycles = [];
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => {
      globalThis.__stratos.journey.debug.altitude = 20_000;
    });
    await page.waitForTimeout(1200);
    await page.evaluate(() => {
      globalThis.__stratos.journey.debug.altitude = 0;
    });
    await page.waitForTimeout(2500);
    cycles.push(
      await page.evaluate(() => {
        const info = globalThis.__stratos.gl.info;
        let mountainMeshes = 0;
        globalThis.__stratos.scene.traverse((o) => {
          let p = o;
          while (p) {
            if (p.userData?.mountainRoot) {
              if (o.isMesh) mountainMeshes++;
              break;
            }
            p = p.parent;
          }
        });
        return {
          heap: performance.memory?.usedJSHeapSize ?? null,
          geometries: info.memory.geometries,
          textures: info.memory.textures,
          programs: info.programs?.length ?? null,
          mountainMeshes,
        };
      })
    );
  }

  const heapAfter = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? null);
  const mb = (b) => (b == null ? null : +(b / 1048576).toFixed(2));

  console.log(
    `  load: glb ${load.glb ? `${load.glb.encodedBytes} B in ${load.glb.ms} ms` : 'none'}, ` +
      `decoder ${load.decoderJs ? `${load.decoderJs.encodedBytes} B in ${load.decoderJs.ms} ms` : 'none'}, ` +
      `attach ${load.attachMs ?? '?'} ms`
  );
  console.log(
    `  lifecycle: heap ${mb(heapBefore)} -> ${mb(heapAfter)} MB; ` +
      `geometries ${cycles.map((c) => c.geometries).join('/')}; ` +
      `programs ${cycles.map((c) => c.programs).join('/')}; ` +
      `meshes ${cycles.map((c) => c.mountainMeshes).join('/')}`
  );

  results.push({ view: view.id, load, lifecycle: { heapBefore, heapAfter, cycles } });
  await context.close();
}

await browser.close();
writeFileSync(
  `${OUT}/mountains.json`,
  JSON.stringify({ renderer, framePacingIsGpu: renderer?.gpu ?? false, results }, null, 1) + '\n'
);
console.log(`\nwritten: ${OUT}/mountains.json`);
if (!renderer?.gpu) {
  console.log(
    '\nREMINDER: this run used a software rasteriser. Transfer, decode, attach,\n' +
      'draw calls, triangles, programs, geometries and the lifecycle series are\n' +
      'valid. fps, medianMs, p95Ms, p99Ms and the over-budget counts are not.'
  );
}

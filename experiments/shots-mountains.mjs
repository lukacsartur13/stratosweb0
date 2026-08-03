// =============================================================================
// Deterministic stills of the mountain range, plus the browser-side composition
// checks the Blender validators cannot make.
//
//     npm run dev:home            # in another terminal, serves :5177
//     node experiments/shots-mountains.mjs
//     VERIFY=1 node experiments/shots-mountains.mjs
//
// ## Why this is separate from shots-meridian.mjs
//
// That script captures the instrument through the seven altitude stops of its
// own state machine. The range exists over four of them and is gone by 12 000 m,
// and it is judged on different questions — is a mass a vertical curtain, does
// the valley read as having depth, is the central column clear. Same method,
// different subject, so it is a sibling rather than a flag.
//
// ## What is measured, and why measuring it here is the point
//
// `blender/mountains/validate_stratos_mountains.py` already proves the source
// composition respects the Meridian safe zone — under *Blender's* camera, at
// Blender's aspect ratio. The brief is explicit that this is only a source
// guide, so everything below is measured against the actual browser projection:
//
//   * where the Meridian's bounding sphere lands on screen, as a fraction of
//     the frame, at seven altitudes;
//   * whether any mountain triangle is drawn in front of the instrument, by
//     raycasting a grid over the instrument's own projected disc and asking
//     what the nearest hit belongs to;
//   * the skyline shape — how much of the frame top a mass touches, and the
//     longest run of a single vertical edge — which is what "a curtain" and
//     "a panel touching the frame top" actually mean as numbers.
//
// ## Determinism — claimed, then measured, and it does not hold
//
// Idle ring rotation is frozen through a property setter installed before the
// application assigns the handle, and the stops are always visited in the same
// order. That was previously described here as making the capture
// deterministic, following shots-meridian.mjs. It does not: two consecutive
// runs of this script produce 10 differing images out of 16.
//
// The claim survived because `VERIFY=1` could not test it. It read
// `digests.json` back *after* this run had already overwritten it, so it
// compared the run against itself and reported success unconditionally —
// including on runs that were measurably not reproducible. VERIFY now compares
// against `digests.baseline.json`, which is read before the write and created
// only when absent: the first VERIFY run records a baseline, the second checks
// it, and a failed check exits non-zero.
//
// Until the residual variation is isolated, treat the PNGs as evidence for
// human review — which is what they are actually used for — and not as a
// byte-comparable regression baseline.
// =============================================================================
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { shapeMetrics, shapeVerdict, SHAPE } from './silhouette-metrics.mjs';

/*
 * `/home/hu.html`, not `/`.
 *
 * The homepage inputs are named `home/{hu,en,de}.html` in the source tree and
 * only become `/`, `/en/` and `/de/` at emit time — `vite.home.config.ts`
 * renames them. On the dev server `/` is still `experiments/index.html`, the
 * old AscentPrototype, which has its own canvas and its own `__stratos`-free
 * page. Pointing this script there produced a thirty-second timeout waiting for
 * a scene handle that page was never going to publish.
 */
const URL = process.env.URL ?? 'http://localhost:5177/home/hu.html';
const OUT = process.env.OUT ?? 'experiments/screenshots/mountains';
const VERIFY = process.env.VERIFY === '1';

/** The four the brief names. The range is gone above the last of them. */
const STOPS = [0, 3_000, 7_000, 12_000];

/** Where the Meridian's own position is checked. Wider than the stills. */
const PROJECTION_STOPS = [0, 3_000, 7_000, 12_000, 18_000, 24_000, 30_000];

const VIEWS = [
  { id: 'desktop', width: 1440, height: 900, dsf: 1, mobile: false },
  { id: '430x932', width: 430, height: 932, dsf: 3, mobile: true },
  { id: '390x844', width: 390, height: 844, dsf: 3, mobile: true },
  { id: '360x800', width: 360, height: 800, dsf: 3, mobile: true },
];

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
 * Runs in the page. Returns the composition measurements for the current state.
 *
 * Kept as one evaluate so every number describes the same frame — splitting it
 * would let the clock advance between the projection and the raycast.
 */
function measure() {
  const s = globalThis.__stratos;
  const THREE = s.three;
  const { scene, camera, gl } = s;
  camera.updateMatrixWorld();

  const isMountain = (o) => {
    let p = o;
    while (p) {
      if (p.userData?.mountainRoot) return true;
      p = p.parent;
    }
    return false;
  };

  // --- what is in the scene ------------------------------------------------
  const mountains = [];
  let meridianRoot = null;
  scene.traverse((o) => {
    if (o.userData?.mountainRoot) mountains.push(o);
    if (o.userData?.meridianRoot) meridianRoot = o;
  });

  const meshes = { mountain: [], other: [] };
  let mountainTriangles = 0;
  scene.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    if (isMountain(o)) {
      meshes.mountain.push(o);
      const g = o.geometry;
      mountainTriangles += g.index ? g.index.count / 3 : g.attributes.position.count / 3;
    } else {
      meshes.other.push(o);
    }
  });

  // --- where the instrument lands -----------------------------------------
  // Taken from the `meridianRoot` marker rather than inferred. The previous
  // version guessed by bounding-box size and camera distance and silently
  // reported "not found" on every portrait viewport.
  const box = new THREE.Box3();
  let found = false;
  if (meridianRoot) {
    box.setFromObject(meridianRoot);
    found = !box.isEmpty();
  }

  const project = (v) => {
    const p = v.clone().project(camera);
    return { x: (p.x + 1) / 2, y: (1 - p.y) / 2, z: p.z };
  };

  let meridian = null;
  if (found) {
    const centre = box.getCenter(new THREE.Vector3());
    const radius = box.getSize(new THREE.Vector3()).length() / 2;
    const c = project(centre);
    const edge = project(centre.clone().add(new THREE.Vector3(radius, 0, 0)));
    meridian = {
      centreX: +c.x.toFixed(4),
      centreY: +c.y.toFixed(4),
      radiusFrac: +Math.abs(edge.x - c.x).toFixed(4),
      distance: +centre.distanceTo(camera.position).toFixed(3),
    };
  }

  // --- is anything drawn in front of it ------------------------------------
  // A grid over the instrument's own projected disc. For each sample the
  // nearest hit decides: if it is a mountain and it is nearer than the
  // instrument, the instrument is obscured at that pixel.
  const ray = new THREE.Raycaster();
  const occluded = [];
  let sampled = 0;
  if (meridian && meshes.mountain.length) {
    const R = Math.max(meridian.radiusFrac, 0.02);
    for (let iy = -3; iy <= 3; iy++) {
      for (let ix = -3; ix <= 3; ix++) {
        const dx = (ix / 3) * R;
        const dy = (iy / 3) * R * (innerWidth / innerHeight);
        if (Math.hypot(ix / 3, iy / 3) > 1) continue;
        const nx = (meridian.centreX + dx) * 2 - 1;
        const ny = 1 - (meridian.centreY + dy) * 2;
        ray.setFromCamera({ x: nx, y: ny }, camera);
        sampled++;
        const hits = ray.intersectObjects([...meshes.mountain, ...meshes.other], true);
        const first = hits.find((h) => h.object.visible);
        if (first && isMountain(first.object)) {
          occluded.push({ nx: +nx.toFixed(3), ny: +ny.toFixed(3), obj: first.object.name });
        }
      }
    }
  }

  // --- renderer workload ---------------------------------------------------
  const info = gl.info;
  return {
    altitude: Math.round(s.journey.altitude),
    mountainsPresent: mountains.length > 0,
    mountainMeshes: meshes.mountain.length,
    mountainTriangles: Math.round(mountainTriangles),
    mountainVisible: meshes.mountain.length > 0,
    mountainOpacity: meshes.mountain[0]?.material?.opacity ?? null,
    meridian,
    occlusionSamples: sampled,
    occluded,
    render: {
      calls: info.render.calls,
      triangles: info.render.triangles,
      programs: info.programs?.length ?? null,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
    },
  };
}

/**
 * The mountain silhouette, as an exact mask rendered from the live scene.
 *
 * WHY NOT `drawImage(canvas)`
 * --------------------------
 * That was the first version and it measured nothing. The renderer is created
 * without `preserveDrawingBuffer`, so by the time a later task copies the
 * canvas the drawing buffer has been presented and cleared — every sample came
 * back black, every metric came back 0, and the checks reported a clean pass
 * for four viewports at four altitudes without ever looking at a mountain.
 *
 * WHY A MASK RATHER THAN A LUMINANCE THRESHOLD
 * --------------------------------------------
 * The palette is graphite and titanium against a near-black sky, deliberately.
 * "Darker than the sky by 0.06" is not a reliable separator for a scene whose
 * whole point is low contrast, and it gets less reliable exactly as the fog
 * closes in — which is when these checks matter most. Hiding everything that is
 * not the range and drawing what is left flat white gives an exact silhouette
 * with no threshold to tune: a pixel is mountain or it is not.
 *
 * The render is forced and read back inside a single task, before the frame is
 * presented, which is what makes `readPixels` legal here at all.
 */
function silhouette() {
  const s = globalThis.__stratos;
  const THREE = s.three;
  const { scene, camera, gl } = s;

  const isMountain = (o) => {
    let p = o;
    while (p) {
      if (p.userData?.mountainRoot) return true;
      p = p.parent;
    }
    return false;
  };

  // --- swap the scene for a mask ------------------------------------------
  const hidden = [];
  scene.traverse((o) => {
    if ((o.isMesh || o.isPoints || o.isSprite) && o.visible && !isMountain(o)) {
      o.visible = false;
      hidden.push(o);
    }
  });
  const prevOverride = scene.overrideMaterial;
  const prevClear = new THREE.Color();
  gl.getClearColor(prevClear);
  const prevAlpha = gl.getClearAlpha();

  scene.overrideMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
  gl.setClearColor(0x000000, 1);
  gl.render(scene, camera);

  const ctx = gl.getContext();
  const W = ctx.drawingBufferWidth;
  const H = ctx.drawingBufferHeight;
  const px = new Uint8Array(W * H * 4);
  ctx.readPixels(0, 0, W, H, ctx.RGBA, ctx.UNSIGNED_BYTE, px);

  scene.overrideMaterial?.dispose?.();
  scene.overrideMaterial = prevOverride;
  gl.setClearColor(prevClear, prevAlpha);
  for (const o of hidden) o.visible = true;
  gl.render(scene, camera);

  // --- read the mask -------------------------------------------------------
  // readPixels' origin is bottom-left; rows are flipped so `top` means top.
  const COLS = 240;
  const skyline = []; // fraction down the frame of the highest mountain pixel
  const cover = []; // fraction of the column's height the mountain occupies
  let covered = 0;
  for (let c = 0; c < COLS; c++) {
    const x = Math.min(W - 1, Math.round(((c + 0.5) / COLS) * W));
    let topRow = -1;
    let colCovered = 0;
    for (let row = 0; row < H; row++) {
      // row 0 = top of frame
      const y = H - 1 - row;
      if (px[(y * W + x) * 4] > 127) {
        if (topRow < 0) topRow = row;
        colCovered++;
      }
    }
    skyline.push(topRow < 0 ? 1 : topRow / H);
    cover.push(colCovered / H);
    covered += colCovered / H;
  }

  const present = skyline.filter((v) => v < 1);
  const touchingTop = skyline.filter((v) => v <= 0.005).length / COLS;
  const columnsWithMountain = present.length / COLS;

  // The longest run of columns whose silhouette height barely changes: a flat
  // run is what a slab or a curtain edge-on looks like from the front.
  let flat = 0;
  let longestFlat = 0;
  for (let i = 1; i < COLS; i++) {
    if (skyline[i] < 1 && skyline[i - 1] < 1 && Math.abs(skyline[i] - skyline[i - 1]) < 0.003) flat++;
    else flat = 0;
    longestFlat = Math.max(longestFlat, flat);
  }
  // A vertical edge: the silhouette jumping by more than 8% of frame height
  // between adjacent columns, repeatedly. That is a wall, not a ridge.
  let edge = 0;
  let longestEdge = 0;
  for (let i = 1; i < COLS; i++) {
    if (Math.abs(skyline[i] - skyline[i - 1]) > 0.08) edge++;
    else edge = 0;
    longestEdge = Math.max(longestEdge, edge);
  }

  const half = Math.floor(COLS / 2);
  const left = skyline.slice(0, half);
  const right = skyline.slice(COLS - half).reverse();
  const asymmetry = left.reduce((a, v, i) => a + Math.abs(v - right[i]), 0) / half;

  return {
    maskPixels: W * H,
    coverage: +(covered / COLS).toFixed(4),
    columnsWithMountain: +columnsWithMountain.toFixed(4),
    touchingFrameTop: +touchingTop.toFixed(4),
    /**
     * Kept, and kept *unnormalised*, because the report is a record and
     * rewriting a historical number in place is how a baseline stops being one.
     * It is not gated: its flatness tolerance is a fixed fraction of frame
     * height between columns a fixed fraction of frame *width* apart, which
     * makes the value a function of the device pixel ratio — see the note in
     * silhouette-metrics.mjs. `shape.flatRun` is the normalised replacement and
     * is the one the gate reads.
     */
    longestFlatRun: +(longestFlat / COLS).toFixed(4),
    longestVerticalEdgeRun: +(longestEdge / COLS).toFixed(4),
    skylineAsymmetry: +asymmetry.toFixed(4),
    highestPoint: +Math.min(...skyline).toFixed(4),
    // The raw columns, so the shape metrics are computed once, in Node, by the
    // same function that scores the kept masks from the rejected passes.
    columns: { skyline: skyline.map((v) => +v.toFixed(5)), cover: cover.map((v) => +v.toFixed(5)) },
  };
}

/**
 * The tonal question, which the silhouette cannot answer.
 *
 * "Flat grey slabs", "no uniform grey mass" and "visible layer separation" are
 * all statements about the *distribution of values inside the silhouette*, and
 * the first pass through this route proved that a composition can satisfy every
 * placement check and still fail all three: the measured frame had 62% mountain
 * coverage, a correct skyline and 0/29 occlusion samples, and the whole of it
 * lived between sRGB luminance 23 and 57 against a sky at 1.
 *
 * The mask here is a difference rather than a silhouette. Rendering the range
 * white marks every pixel it *projects onto*, including the ones the Meridian
 * is drawn in front of, which drags the instrument's own values into the
 * mountains' histogram — and the instrument is the brightest object in the
 * scene. Rendering the frame twice, with and without the range, and taking the
 * pixels that changed marks exactly the pixels a mountain wins.
 */
function tone() {
  const s = globalThis.__stratos;
  const { scene, camera, gl } = s;
  const ctx = gl.getContext();
  const W = ctx.drawingBufferWidth;
  const H = ctx.drawingBufferHeight;

  gl.render(scene, camera);
  const real = new Uint8Array(W * H * 4);
  ctx.readPixels(0, 0, W, H, ctx.RGBA, ctx.UNSIGNED_BYTE, real);

  const roots = [];
  scene.traverse((o) => {
    if (o.userData?.mountainRoot && o.visible) roots.push(o);
  });
  for (const r of roots) r.visible = false;
  gl.render(scene, camera);
  const without = new Uint8Array(W * H * 4);
  ctx.readPixels(0, 0, W, H, ctx.RGBA, ctx.UNSIGNED_BYTE, without);
  for (const r of roots) r.visible = true;
  gl.render(scene, camera);

  const lum = [];
  let mountainPixels = 0;
  const region = { bottom: [0, 0], middle: [0, 0], top: [0, 0] };
  for (let i = 0; i < W * H; i++) {
    const d =
      Math.abs(real[i * 4] - without[i * 4]) +
      Math.abs(real[i * 4 + 1] - without[i * 4 + 1]) +
      Math.abs(real[i * 4 + 2] - without[i * 4 + 2]);
    if (d <= 2) continue;
    mountainPixels++;
    const L = 0.2126 * real[i * 4] + 0.7152 * real[i * 4 + 1] + 0.0722 * real[i * 4 + 2];
    // Sample rather than keep every pixel: a 1440x900 frame is 1.3 M entries
    // and the percentiles do not move.
    if (mountainPixels % 31 === 0) lum.push(L);
    // readPixels' origin is bottom-left.
    const row = Math.floor(i / W) / H;
    const band = row < 1 / 3 ? region.bottom : row < 2 / 3 ? region.middle : region.top;
    band[0] += L;
    band[1]++;
  }

  lum.sort((a, b) => a - b);
  const q = (p) => (lum.length ? Math.round(lum[Math.floor((p / 100) * (lum.length - 1))]) : 0);
  const mean = ([sum, n]) => (n ? +(sum / n).toFixed(1) : null);

  return {
    visibleFraction: +(mountainPixels / (W * H)).toFixed(4),
    p05: q(5),
    p25: q(25),
    p50: q(50),
    p75: q(75),
    p95: q(95),
    /** The headline number: how much tonal room the range actually occupies. */
    range: q(95) - q(5),
    /** Interquartile spread — a slab has a wide silhouette and a narrow one of these. */
    iqr: q(75) - q(25),
    bottom: mean(region.bottom),
    middle: mean(region.middle),
    top: mean(region.top),
  };
}

/**
 * Every image in the document, and whether the browser actually drew it.
 *
 * A status-code check is not enough and that is not a hypothetical: on the dev
 * server `/assets/img/work-1.jpg` used to be answered by the SPA fallback with
 * **200 OK, `Content-Type: text/html`** — the index document in place of a
 * JPEG. No 404, no console error, no failed request. The only observable is
 * `naturalWidth === 0`, and every 12 000 m still, where the case studies are on
 * screen, carried the broken-image box while the checks below reported a clean
 * pass on the parts of the frame they were looking at.
 *
 * So the stills are no longer allowed to be captured over broken imagery
 * without saying so. This does not hide anything — nothing is suppressed or
 * substituted — it reports it, and the run exits non-zero.
 */
function brokenImages() {
  return Array.from(document.images)
    .filter((img) => img.naturalWidth === 0 || img.naturalHeight === 0)
    .map((img) => ({ src: img.currentSrc || img.src, alt: img.alt, complete: img.complete }));
}

const browser = await chromium.launch();
mkdirSync(OUT, { recursive: true });

const digests = {};
const report = [];
const brokenByView = {};
const shapeFailures = [];
const shapeWarnings = [];

for (const view of VIEWS) {
  const context = await browser.newContext({
    viewport: { width: view.width, height: view.height },
    deviceScaleFactor: view.dsf,
    isMobile: view.mobile,
    hasTouch: view.mobile,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.addInitScript(freezeIdleRotation);
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.addStyleTag({ content: '.debug, .debug__toggle { display: none !important; }' });

  await page.waitForSelector('canvas');
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => !!globalThis.__stratos?.scene, { timeout: 30_000 });
  // The mountain GLB is fetched and DRACO-decoded after the first frame.
  await page.waitForTimeout(5000);

  for (const metres of PROJECTION_STOPS) {
    await page.evaluate((m) => {
      globalThis.__stratos.journey.debug.altitude = m;
    }, metres);
    await page.waitForTimeout(120);
    await page.evaluate(() => {
      const max = document.documentElement.scrollHeight - innerHeight;
      scrollTo({ top: max * globalThis.__stratos.journey.current, behavior: 'instant' });
      globalThis.__stable = 0;
      globalThis.__lastCurrent = undefined;
    });
    // Wait for the damped journey clock to *converge*, not for a fixed 2 600 ms.
    //
    // This is a principled wait replacing a magic number, and it is NOT a fix
    // for the reproducibility problem — that was the hypothesis and the
    // measurement rejected it. Two consecutive captures still differ in 10 of
    // the 16 images with this in place (9 of 16 with the old fixed wait), so the
    // remaining source of variation is somewhere other than the journey clock.
    //
    // What the evidence says about where it is *not*: the four 0 m frames are
    // stable across runs, and 12 000 m — where the range is not drawn at all —
    // is among the least stable, so it is not the mountain material or the
    // mountain timeline. The unexplained variation is most likely in the DOM
    // layer the screenshot also captures (lazily decoded case-study imagery, the
    // sticky panel handoff) rather than in the scene. Not yet isolated; see the
    // Phase 5 report.
    //
    // Several consecutive stable polls rather than one: the first poll after a
    // jump can read the previous value simply because the clock has not started
    // moving yet.
    await page.waitForFunction(
      () => {
        const j = globalThis.__stratos.journey;
        const last = globalThis.__lastCurrent;
        globalThis.__lastCurrent = j.current;
        if (last !== undefined && Math.abs(j.current - last) < 1e-7) globalThis.__stable++;
        else globalThis.__stable = 0;
        return globalThis.__stable >= 5;
      },
      undefined,
      { timeout: 60_000, polling: 100 }
    );

    const m = await page.evaluate(measure);
    const wantsStill = STOPS.includes(metres);
    const sky = wantsStill ? await page.evaluate(silhouette) : null;
    const val = wantsStill ? await page.evaluate(tone) : null;

    // The shape gate. Computed here rather than in the page so that exactly one
    // implementation scores both the live mask and the kept masks from the
    // rejected passes — a threshold calibrated on one that means something
    // different on the other is not a threshold.
    const shape = sky ? shapeMetrics(sky.columns.skyline, sky.columns.cover) : null;
    const verdict = shape ? shapeVerdict(shape, { expectVisible: metres < 12_000 }) : null;
    if (verdict?.failures.length) {
      shapeFailures.push({ view: view.id, metres, failures: verdict.failures });
    }
    if (verdict?.warnings.length) {
      shapeWarnings.push({ view: view.id, metres, warnings: verdict.warnings });
    }

    if (wantsStill) {
      const name = `mountains-${view.id}-${String(metres).padStart(5, '0')}.png`;
      const path = `${OUT}/${name}`;
      await page.screenshot({ path, animations: 'disabled' });
      digests[name] = createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 16);
    }

    report.push({ view: view.id, requested: metres, ...m, sky, tone: val, shape });

    const mer = m.meridian;
    console.log(
      `${view.id.padEnd(8)} ${String(metres).padStart(5)} m  ` +
        `alt ${String(m.altitude).padStart(5)}  ` +
        `tri ${String(m.mountainTriangles).padStart(6)}  ` +
        `calls ${String(m.render.calls).padStart(3)}  ` +
        `meridian ${mer ? `(${mer.centreX.toFixed(3)}, ${mer.centreY.toFixed(3)}) r=${mer.radiusFrac.toFixed(3)}` : 'not found'}  ` +
        `occluded ${m.occluded.length}/${m.occlusionSamples}` +
        (sky ? `  cover=${sky.coverage} cols=${sky.columnsWithMountain} top=${sky.touchingFrameTop} edge=${sky.longestVerticalEdgeRun} flat=${sky.longestFlatRun} asym=${sky.skylineAsymmetry}` : '')
    );
    if (val) {
      console.log(
        `                    tone  seen=${val.visibleFraction}  ` +
          `p05=${String(val.p05).padStart(3)} p50=${String(val.p50).padStart(3)} p95=${String(val.p95).padStart(3)}  ` +
          `range=${String(val.range).padStart(3)} iqr=${String(val.iqr).padStart(3)}  ` +
          `btm=${val.bottom} mid=${val.middle} top=${val.top}`
      );
    }
  }

  // After the whole sweep, so every lazily decoded case-study image has been
  // asked for by the 12 000 m stop rather than still being below the fold.
  await page.evaluate(() =>
    Promise.all(Array.from(document.images).map((i) => i.decode().catch(() => undefined)))
  );
  brokenByView[view.id] = await page.evaluate(brokenImages);
  if (brokenByView[view.id].length) {
    console.log(`  !! ${view.id} broken images: ${brokenByView[view.id].map((b) => b.src).join(', ')}`);
  }

  if (errors.length) console.log(`  !! ${view.id} errors: ${[...new Set(errors)].slice(0, 4).join(' | ')}`);
  await context.close();
}

await browser.close();

writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 1) + '\n');

// The baseline is read *before* this run's digests overwrite it. The previous
// arrangement wrote `digests.json` here and then had VERIFY read the same path
// back, so `prev` was always this run's own output and the check reported
// "deterministic: all 16 digests reproduced" unconditionally — including on the
// run that was measurably not deterministic.
const BASELINE = `${OUT}/digests.baseline.json`;
const previous = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : null;
writeFileSync(`${OUT}/digests.json`, JSON.stringify(digests, null, 2) + '\n');

// --- verdicts ---------------------------------------------------------------
const occlusions = report.filter((r) => r.occluded.length > 0);
const topTouch = report.filter((r) => r.sky && r.sky.touchingFrameTop > 0.15);
const curtains = report.filter((r) => r.sky && r.sky.longestVerticalEdgeRun > 0.11);
const missing = report.filter((r) => r.requested <= 7_000 && r.mountainTriangles === 0);

// The tonal gate. Thresholds are not aspirations — they are the pre-pass
// measurement plus a margin. The failing frame that prompted this work had
// range 34 and iqr 21 at desktop 0 m; anything at or below that is the same
// picture with different numbers on it.
const present = report.filter((r) => r.tone && r.requested < 12_000);
const flat = present.filter((r) => r.tone.range < 40);
const uniform = present.filter((r) => r.tone.iqr < 24);
const blown = present.filter((r) => r.tone.p95 > 170);
const washed = present.filter((r) => r.tone.p05 > 45);

console.log('\n--- verdicts ---------------------------------------------------');
console.log(`meridian obscured by mountains : ${occlusions.length === 0 ? 'no' : `YES in ${occlusions.length} states`}`);
for (const o of occlusions.slice(0, 6)) {
  console.log(`   ${o.view} @ ${o.requested} m — ${o.occluded.length}/${o.occlusionSamples} samples, e.g. ${o.occluded[0].obj}`);
}
console.log(`geometry touching frame top>15%: ${topTouch.length === 0 ? 'no' : `YES in ${topTouch.length}`}`);
console.log(`vertical curtain edge >11%      : ${curtains.length === 0 ? 'no' : `YES in ${curtains.length}`}`);
console.log(`mountains absent at/below 7000m : ${missing.length === 0 ? 'no' : `YES in ${missing.length}`}`);
console.log(`flat slab (tonal range < 40)    : ${flat.length === 0 ? 'no' : `YES in ${flat.map((r) => `${r.view}@${r.requested}`).join(', ')}`}`);
console.log(`uniform mass (iqr < 24)         : ${uniform.length === 0 ? 'no' : `YES in ${uniform.map((r) => `${r.view}@${r.requested}`).join(', ')}`}`);
console.log(`overexposed (p95 > 170)         : ${blown.length === 0 ? 'no' : `YES in ${blown.map((r) => `${r.view}@${r.requested}`).join(', ')}`}`);
console.log(`fog wash (p05 > 45)             : ${washed.length === 0 ? 'no' : `YES in ${washed.map((r) => `${r.view}@${r.requested}`).join(', ')}`}`);

// --- the shape gate ---------------------------------------------------------
//
// The metric the vertical-edge check could not express. `longestVerticalEdgeRun`
// counts *consecutive* columns that each jump by more than 8% of frame height,
// and a curtain has exactly one such column per side — a clean vertical edge is
// one discontinuity, not a run of them — so it read 0.0 on the frames it existed
// to reject. See silhouette-metrics.mjs, and validate-flatrun.mjs for the
// measured separation between the rejected masks and these stills.
console.log('\n--- silhouette shape -------------------------------------------');
for (const r of report) {
  if (!r.shape) continue;
  const s = r.shape;
  console.log(
    `${r.view.padEnd(8)} ${String(r.requested).padStart(5)} m  ` +
      (s.present
        ? `contour=${String(s.contour).padStart(7)} flat=${String(s.flatRun).padStart(6)} ` +
          `curtain=${String(s.curtainRun).padStart(6)} wall=${String(s.wallRun).padStart(6)} ` +
          `edge=${String(s.edgeWedgeRun).padStart(6)}`
        : 'no mountain in frame (expected above 12 000 m)')
  );
}
console.log(`shape gate                      : ${shapeFailures.length === 0 ? 'pass' : `FAIL in ${shapeFailures.length}`}`);
for (const f of shapeFailures) for (const why of f.failures) console.log(`   ${f.view} @ ${f.metres} m — ${why}`);
for (const w of shapeWarnings) for (const why of w.warnings) console.log(`   warn: ${w.view} @ ${w.metres} m — ${why}`);
console.log(`thresholds                      : ${Object.entries(SHAPE).map(([k, v]) => `${k}=${v}`).join(' ')}`);

// --- broken imagery ---------------------------------------------------------
const brokenTotal = Object.values(brokenByView).reduce((n, list) => n + list.length, 0);
console.log(`broken images in the document   : ${brokenTotal === 0 ? 'none' : `YES — ${brokenTotal}`}`);
for (const [view, list] of Object.entries(brokenByView)) {
  for (const b of list) console.log(`   ${view} — ${b.src}`);
}

console.log(`\nwritten: ${OUT} (${Object.keys(digests).length} images)`);

// A capture over broken imagery, or over a silhouette that fails the shape
// gate, is not evidence. Both fail the run rather than being noted in passing.
if (shapeFailures.length || brokenTotal) process.exitCode = 1;

if (VERIFY) {
  if (!previous) {
    writeFileSync(BASELINE, JSON.stringify(digests, null, 2) + '\n');
    console.log(
      `no baseline yet — wrote ${Object.keys(digests).length} digests to ${BASELINE}.\n` +
        'Run VERIFY=1 again to compare a second capture against it.'
    );
  } else {
    const differing = Object.keys(digests).filter((k) => previous[k] && previous[k] !== digests[k]);
    const missing = Object.keys(previous).filter((k) => !digests[k]);
    console.log(
      differing.length || missing.length
        ? `NOT DETERMINISTIC — ${differing.length} differ, ${missing.length} missing:\n  ` +
            [...differing, ...missing.map((k) => `${k} (missing)`)].join('\n  ')
        : `deterministic: all ${Object.keys(digests).length} digests reproduced against the baseline`
    );
    process.exitCode = differing.length || missing.length ? 1 : 0;
  }
}

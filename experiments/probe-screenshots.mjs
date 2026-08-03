// =============================================================================
// Phase 5C: where the screenshot variation actually is.
//
//     npm run dev:home                      # in another terminal, serves :5177
//     node experiments/probe-screenshots.mjs
//     ISOLATE=1 node experiments/probe-screenshots.mjs   # the controlled set
//
// ## The observation
//
// Two consecutive runs of `shots-mountains.mjs` produced ten differing images
// out of sixteen. That was previously not measurable at all — `VERIFY=1` read
// the digest file back *after* the run had overwritten it, so it compared a run
// against itself and reported success unconditionally. That defect is fixed;
// this is the investigation the fix made possible.
//
// ## What this does that a digest cannot
//
// A SHA over a PNG answers "different" and nothing else. Every question worth
// asking is about *where* and *why*:
//
//   * how many pixels changed, by how much, and inside which bounding box;
//   * whether those pixels are inside the WebGL canvas or in the DOM around it;
//   * whether the application state that produced the two frames was identical.
//
// The last one is the one that decides the baseline strategy. If the state
// digests match and the pixels do not, the variation is below the application
// — rasterisation, text antialiasing, compositing — and no amount of
// application work will make the bytes reproduce. If the state digests differ,
// there is a real defect and byte comparison is the right tool for finding it.
//
// So this captures each state twice, with a full state digest taken
// immediately before each capture, and reports the two independently.
// =============================================================================
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const URL = process.env.URL ?? 'http://localhost:5177/home/hu.html';
const OUT = process.env.OUT ?? 'experiments/screenshots/determinism';
const RUNS = Number(process.env.RUNS ?? 2);
const ISOLATE = process.env.ISOLATE === '1';

const STOPS = [0, 3_000, 7_000, 12_000];
const VIEWS = [
  { id: 'desktop', width: 1440, height: 900, dsf: 1, mobile: false },
  { id: '390x844', width: 390, height: 844, dsf: 3, mobile: true },
];

// -----------------------------------------------------------------------------
// Validation mode.
//
// Everything below runs in the page before the application boots. Each item is
// one of the sources of frame-to-frame variation the brief lists, closed at the
// point it enters rather than papered over at the point it shows.
// -----------------------------------------------------------------------------
function validationMode() {
  // 1. Idle rotation. `ringRotation = 0` now gates every free-running rotation
  //    in the scene — the instrument's three rings and the system diagram —
  //    rather than only the instrument's idle rate. Installed through a
  //    property setter so it lands the instant the handle is published, before
  //    the first frame the application draws.
  let value;
  Object.defineProperty(globalThis, '__stratos', {
    configurable: true,
    get: () => value,
    set: (v) => {
      value = v;
      if (v?.journey?.debug) v.journey.debug.ringRotation = 0;
    },
  });

  // 2. Random seeds. Nothing in the scene calls `Math.random` today — the star
  //    field and the cloud layout are both authored pseudo-random sequences with
  //    fixed constants — but a future one would be invisible until it produced
  //    exactly this class of bug, so it is pinned rather than trusted.
  let seed = 0x2f6e2b1;
  Math.random = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };

  // 3. Transitions, animations, carets. Applied as a stylesheet at document
  //    start so nothing has a chance to be mid-transition when the first
  //    measurement is taken.
  addEventListener('DOMContentLoaded', () => {
    const style = document.createElement('style');
    style.textContent = `
      *, *::before, *::after {
        transition: none !important;
        animation: none !important;
        caret-color: transparent !important;
        scroll-behavior: auto !important;
      }
      .debug, .debug__toggle { display: none !important; }
      /* A scrollbar that appears on one run and not the other moves every
         pixel in the frame. Pinned rather than hidden, so the layout is the
         same one a visitor gets. */
      html { scrollbar-gutter: stable; }
    `;
    document.head.append(style);
  });
}

/**
 * The state digest: everything that decides what the frame should look like.
 *
 * Serialised in a fixed key order and hashed, and also returned in full so a
 * difference can be pointed at rather than merely detected. Numbers are rounded
 * to a fixed precision — not to hide a difference, but because a digest that
 * changes in the sixteenth decimal of a float would answer "different" for
 * every pair and tell us nothing. The precision is stated in the output.
 */
function sceneState() {
  const s = globalThis.__stratos;
  const { scene, camera, gl } = s;
  const j = s.journey;
  const m = s.meridian;
  const r = (v, p = 6) => (typeof v === 'number' ? +v.toFixed(p) : v);

  const isMountain = (o) => {
    let p = o;
    while (p) {
      if (p.userData?.mountainRoot) return true;
      p = p.parent;
    }
    return false;
  };

  let root = null;
  const meshNames = [];
  let drawnTriangles = 0;
  const materials = [];
  scene.traverse((o) => {
    if (o.userData?.mountainRoot) root = o;
    if (!o.isMesh) return;
    if (isMountain(o)) {
      meshNames.push(o.name);
      const g = o.geometry;
      drawnTriangles += g.index ? g.index.count / 3 : g.attributes.position.count / 3;
      const u = o.material?.uniforms;
      if (u && !materials.length) {
        materials.push(
          Object.fromEntries(
            Object.entries(u)
              .filter(([, v]) => typeof v?.value === 'number')
              .map(([k, v]) => [k, r(v.value)])
              .sort(([a], [b]) => a.localeCompare(b))
          )
        );
      }
    }
  });

  const lights = [];
  scene.traverse((o) => {
    if (o.isLight) lights.push({ type: o.type, intensity: r(o.intensity), color: o.color?.getHexString?.() ?? null });
  });

  return {
    altitude: r(j.altitude),
    current: r(j.current, 9),
    target: r(j.target, 9),
    stage: j.stage,
    power: r(j.power),
    scroll: scrollY,
    mountainRoot: root
      ? {
          position: [r(root.position.x), r(root.position.y), r(root.position.z)],
          scale: r(root.scale.x),
          quaternion: [r(root.quaternion.x), r(root.quaternion.y), r(root.quaternion.z), r(root.quaternion.w)],
          visible: root.visible,
        }
      : null,
    mountainMeshNames: meshNames.slice().sort(),
    drawnTriangles: Math.round(drawnTriangles),
    mountainMaterial: materials[0] ?? null,
    lights,
    fog: scene.fog ? { type: scene.fog.type, color: scene.fog.color.getHexString(), near: r(scene.fog.near), far: r(scene.fog.far) } : null,
    meridian: m
      ? {
          aperture: r(m.apertureOpen),
          clarity: r(m.clarity),
          lightBreakthrough: r(m.lightBreakthrough),
          finalCalibration: r(m.finalCalibration),
          axisExtension: r(m.axisExtension),
          rings: m.rings.map((ring) =>
            Object.fromEntries(
              Object.entries(ring)
                .filter(([, v]) => typeof v === 'number')
                .map(([k, v]) => [k, r(v)])
                .sort(([a], [b]) => a.localeCompare(b))
            )
          ),
        }
      : null,
    camera: {
      position: [r(camera.position.x), r(camera.position.y), r(camera.position.z)],
      rotation: [r(camera.rotation.x), r(camera.rotation.y), r(camera.rotation.z)],
      fov: r(camera.fov),
      near: r(camera.near),
      far: r(camera.far),
      aspect: r(camera.aspect),
    },
    viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
    renderer: {
      size: [gl.domElement.width, gl.domElement.height],
      pixelRatio: r(gl.getPixelRatio()),
      toneMapping: gl.toneMapping,
      exposure: r(gl.toneMappingExposure),
      geometries: gl.info.memory.geometries,
      textures: gl.info.memory.textures,
      programs: gl.info.programs?.length ?? null,
    },
    canvas: { width: gl.domElement.width, height: gl.domElement.height, css: [gl.domElement.clientWidth, gl.domElement.clientHeight] },
    fonts: {
      status: document.fonts.status,
      loaded: [...document.fonts].map((f) => `${f.family}/${f.weight}/${f.style}/${f.status}`).sort(),
    },
    images: Array.from(document.images)
      .map((i) => `${new URL(i.currentSrc || i.src, location.href).pathname}:${i.naturalWidth}x${i.naturalHeight}`)
      .sort(),
    /** Where each region of the frame is, for classifying changed pixels. */
    regions: (() => {
      const box = (el) => {
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)];
      };
      return {
        canvas: box(document.querySelector('canvas')),
        hud: box(document.querySelector('.hud')),
        images: Array.from(document.images).map((i) => box(i)).filter(Boolean),
        text: Array.from(document.querySelectorAll('h1, h2, h3, p, .btn, .panel__inner'))
          .map((el) => box(el))
          .filter((b) => b && b[2] > 0 && b[3] > 0 && b[1] < innerHeight && b[3] > 0),
      };
    })(),
  };
}

/** Wait for the journey clock and the camera to both reach a fixed point. */
async function settle(page) {
  await page.evaluate(() => {
    globalThis.__stable = 0;
    globalThis.__last = '';
  });
  await page.waitForFunction(
    () => {
      const s = globalThis.__stratos;
      const c = s.camera;
      const now = `${s.journey.current}|${c.position.x},${c.position.y},${c.position.z}`;
      if (now === globalThis.__last) globalThis.__stable++;
      else globalThis.__stable = 0;
      globalThis.__last = now;
      return globalThis.__stable >= 8;
    },
    undefined,
    { timeout: 60_000, polling: 60 }
  );
  // Fonts and image decodes, explicitly, before anything is captured.
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(Array.from(document.images).map((i) => i.decode().catch(() => undefined)));
  });
  // Two frames: ask for one, and let the one after it be the settled one.
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
  );
}

/**
 * Diff two PNGs, in a browser, and classify what changed.
 *
 * Region classification is by the element boxes recorded in the state digest,
 * in CSS pixels scaled to device pixels. A changed pixel is attributed to the
 * first region it falls inside, in the order canvas → images → HUD → text, so
 * "in the canvas" beats "also inside a panel that overlaps it".
 */
async function diff(page, aPath, bPath, regions, dsf) {
  const a = readFileSync(aPath).toString('base64');
  const b = readFileSync(bPath).toString('base64');
  return page.evaluate(
    async ({ aData, bData, regions: reg, scale }) => {
      const load = async (d) => {
        const img = new Image();
        img.src = `data:image/png;base64,${d}`;
        await img.decode();
        return img;
      };
      const [ia, ib] = await Promise.all([load(aData), load(bData)]);
      if (ia.naturalWidth !== ib.naturalWidth || ia.naturalHeight !== ib.naturalHeight) {
        return { sizeMismatch: [ia.naturalWidth, ia.naturalHeight, ib.naturalWidth, ib.naturalHeight] };
      }
      const W = ia.naturalWidth;
      const H = ia.naturalHeight;
      const grab = (img) => {
        const c = document.createElement('canvas');
        c.width = W;
        c.height = H;
        const x = c.getContext('2d', { willReadFrequently: true });
        x.drawImage(img, 0, 0);
        return x.getImageData(0, 0, W, H).data;
      };
      const pa = grab(ia);
      const pb = grab(ib);

      const inBox = (box, x, y) =>
        box && x >= box[0] * scale && x < box[2] * scale && y >= box[1] * scale && y < box[3] * scale;

      let changed = 0;
      let maxChannel = 0;
      let sum = 0;
      let minX = W;
      let minY = H;
      let maxX = -1;
      let maxY = -1;
      const byRegion = { canvas: 0, images: 0, hud: 0, text: 0, background: 0 };
      // A changed pixel with an unchanged 4-neighbourhood on one side is the
      // signature of an antialiased edge moving by a sub-pixel rather than of
      // content changing.
      let edgeLike = 0;

      // The amplified false-colour difference, built while scanning.
      const out = document.createElement('canvas');
      out.width = W;
      out.height = H;
      const octx = out.getContext('2d');
      const oimg = octx.createImageData(W, H);

      for (let i = 0; i < W * H; i++) {
        const dr = Math.abs(pa[i * 4] - pb[i * 4]);
        const dg = Math.abs(pa[i * 4 + 1] - pb[i * 4 + 1]);
        const db = Math.abs(pa[i * 4 + 2] - pb[i * 4 + 2]);
        const d = Math.max(dr, dg, db);
        // False colour: blue for a hair, green for a shade, red for real.
        const amp = Math.min(255, d * 24);
        oimg.data[i * 4] = d > 8 ? 255 : 0;
        oimg.data[i * 4 + 1] = d > 2 && d <= 8 ? amp : 0;
        oimg.data[i * 4 + 2] = d > 0 && d <= 2 ? 180 : 0;
        oimg.data[i * 4 + 3] = 255;
        if (d === 0) continue;

        changed++;
        sum += (dr + dg + db) / 3;
        if (d > maxChannel) maxChannel = d;
        const x = i % W;
        const y = (i / W) | 0;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;

        if (inBox(reg.canvas, x, y)) byRegion.canvas++;
        else if (reg.images.some((box) => inBox(box, x, y))) byRegion.images++;
        else if (inBox(reg.hud, x, y)) byRegion.hud++;
        else if (reg.text.some((box) => inBox(box, x, y))) byRegion.text++;
        else byRegion.background++;

        if (d <= 4) edgeLike++;
      }
      octx.putImageData(oimg, 0, 0);

      return {
        width: W,
        height: H,
        changedPixels: changed,
        changedFraction: +(changed / (W * H)).toFixed(8),
        maxChannelDiff: maxChannel,
        meanDiff: changed ? +(sum / changed).toFixed(4) : 0,
        meanDiffOverFrame: +(sum / (W * H)).toFixed(6),
        boundingBox: maxX < 0 ? null : [minX, minY, maxX, maxY],
        byRegion,
        /** Changed pixels whose max channel delta is <= 4 — antialiasing-scale. */
        subtleFraction: changed ? +(edgeLike / changed).toFixed(4) : 0,
        falseColour: out.toDataURL('image/png'),
      };
    },
    { aData: a, bData: b, regions, scale: dsf }
  );
}

const sha = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 16);

// -----------------------------------------------------------------------------
const browser = await chromium.launch();
mkdirSync(OUT, { recursive: true });
const diffPage = await (await browser.newContext()).newPage();

const results = [];

for (const view of VIEWS) {
  for (const metres of STOPS) {
    const captures = [];

    for (let run = 0; run < RUNS; run++) {
      const ctx = await browser.newContext({
        viewport: { width: view.width, height: view.height },
        deviceScaleFactor: view.dsf,
        isMobile: view.mobile,
        hasTouch: view.mobile,
      });
      const page = await ctx.newPage();
      await page.addInitScript(validationMode);
      await page.goto(URL, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => !!globalThis.__stratos?.scene, { timeout: 30_000 });
      await page.waitForTimeout(5_000); // mountain GLB fetch and DRACO decode

      await page.evaluate((m) => {
        globalThis.__stratos.journey.debug.altitude = m;
      }, metres);
      await page.evaluate(() => {
        const max = document.documentElement.scrollHeight - innerHeight;
        scrollTo({ top: max * globalThis.__stratos.journey.current, behavior: 'instant' });
      });
      await settle(page);

      const state = await page.evaluate(sceneState);
      const path = `${OUT}/${view.id}-${String(metres).padStart(5, '0')}-run${run}.png`;
      await page.screenshot({ path, animations: 'disabled' });

      captures.push({ state, path, digest: sha(readFileSync(path)) });
      await ctx.close();
    }

    // --- state comparison --------------------------------------------------
    const stateJson = captures.map((c) => JSON.stringify(c.state));
    const stateDigests = stateJson.map((j) => sha(Buffer.from(j)));
    const stateIdentical = stateJson.every((j) => j === stateJson[0]);
    const stateDiffKeys = stateIdentical
      ? []
      : Object.keys(captures[0].state).filter(
          (k) => JSON.stringify(captures[0].state[k]) !== JSON.stringify(captures[1].state[k])
        );

    // --- pixel comparison --------------------------------------------------
    const pixelIdentical = captures.every((c) => c.digest === captures[0].digest);
    const d = pixelIdentical
      ? null
      : await diff(diffPage, captures[0].path, captures[1].path, captures[0].state.regions, view.dsf);

    if (d?.falseColour) {
      const base = `${OUT}/${view.id}-${String(metres).padStart(5, '0')}-diff`;
      writeFileSync(`${base}.png`, Buffer.from(d.falseColour.split(',')[1], 'base64'));
      delete d.falseColour;
    }

    results.push({
      view: view.id,
      metres,
      digests: captures.map((c) => c.digest),
      pixelIdentical,
      stateDigests,
      stateIdentical,
      stateDiffKeys,
      diff: d,
    });

    const label = `${view.id.padEnd(8)} ${String(metres).padStart(5)} m`;
    if (pixelIdentical && stateIdentical) {
      console.log(`${label}  byte-identical, state-identical`);
    } else if (stateIdentical) {
      console.log(
        `${label}  STATE IDENTICAL, PIXELS DIFFER — ` +
          `${d.changedPixels} px (${(d.changedFraction * 100).toFixed(4)}%), max Δ${d.maxChannelDiff}, ` +
          `mean Δ${d.meanDiff}, bbox ${JSON.stringify(d.boundingBox)}\n` +
          `${' '.repeat(16)}regions: canvas=${d.byRegion.canvas} images=${d.byRegion.images} ` +
          `hud=${d.byRegion.hud} text=${d.byRegion.text} background=${d.byRegion.background}  ` +
          `subtle(Δ<=4)=${(d.subtleFraction * 100).toFixed(1)}%`
      );
    } else {
      console.log(`${label}  STATE DIFFERS in: ${stateDiffKeys.join(', ')}`);
      for (const k of stateDiffKeys) {
        console.log(`${' '.repeat(16)}${k}:\n${' '.repeat(18)}a ${JSON.stringify(captures[0].state[k]).slice(0, 300)}`);
        console.log(`${' '.repeat(18)}b ${JSON.stringify(captures[1].state[k]).slice(0, 300)}`);
      }
    }
  }
}

// -----------------------------------------------------------------------------
// The controlled comparisons.
//
// The pass above answers "is the application state reproducible". These answer
// "if the pixels still differ, which layer are they in" — by removing one layer
// at a time from the same settled page and re-capturing. Everything here runs
// inside a *single* page per variant so that nothing about page setup, asset
// decode order or first-frame timing can be the difference; the only thing that
// changes between two captures of a variant is the capture itself.
// -----------------------------------------------------------------------------
const isolation = [];

if (ISOLATE) {
  const view = VIEWS[0];
  console.log('\n--- controlled comparisons (desktop) ---------------------------');

  for (const metres of [0, 7_000, 12_000]) {
    const ctx = await browser.newContext({
      viewport: { width: view.width, height: view.height },
      deviceScaleFactor: view.dsf,
    });
    const page = await ctx.newPage();
    await page.addInitScript(validationMode);
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => !!globalThis.__stratos?.scene, { timeout: 30_000 });
    await page.waitForTimeout(5_000);
    await page.evaluate((m) => {
      globalThis.__stratos.journey.debug.altitude = m;
    }, metres);
    await page.evaluate(() => {
      const max = document.documentElement.scrollHeight - innerHeight;
      scrollTo({ top: max * globalThis.__stratos.journey.current, behavior: 'instant' });
    });
    await settle(page);

    const canvasBox = await page.locator('canvas').boundingBox();

    /** Capture the same page twice under one condition and diff the pair. */
    const twice = async (label, { setup, reset, clip, renders = 0 } = {}) => {
      if (setup) await page.evaluate(setup);
      const shots = [];
      for (let i = 0; i < 2; i++) {
        for (let r = 0; r < renders; r++) {
          await page.evaluate(() => {
            const s = globalThis.__stratos;
            s.gl.render(s.scene, s.camera);
          });
        }
        await page.evaluate(
          () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => res())))
        );
        const p = `${OUT}/iso-${String(metres).padStart(5, '0')}-${label}-${i}.png`;
        await page.screenshot({ path: p, animations: 'disabled', clip: clip ?? undefined });
        shots.push(p);
      }
      if (reset) await page.evaluate(reset);

      const identical = sha(readFileSync(shots[0])) === sha(readFileSync(shots[1]));
      const d = identical ? null : await diff(diffPage, shots[0], shots[1], (await page.evaluate(sceneState)).regions, view.dsf);
      if (d) delete d.falseColour;
      const row = { metres, label, identical, diff: d };
      isolation.push(row);
      console.log(
        `  ${String(metres).padStart(5)} m  ${label.padEnd(24)} ` +
          (identical
            ? 'byte-identical'
            : `${d.changedPixels} px (${(d.changedFraction * 100).toFixed(4)}%) maxΔ${d.maxChannelDiff} ` +
              `canvas=${d.byRegion.canvas} text=${d.byRegion.text} images=${d.byRegion.images} bg=${d.byRegion.background}`)
      );
      return row;
    };

    // 7 — the control. Nothing changes between the two captures at all. If this
    //     differs, the variation is in capture or compositing, not in the app.
    await twice('repeat-no-change');
    // 8, 9 — one explicit render, then several. If a single forced render makes
    //        the pair identical, the difference was which frame was presented.
    await twice('after-1-render', { renders: 1 });
    await twice('after-4-renders', { renders: 4 });
    // 1 — canvas only, by clipping the capture to the canvas element's box.
    await twice('canvas-only', { clip: canvasBox });
    // 2 — DOM only, with the canvas hidden.
    await twice('dom-only', {
      setup: () => (document.querySelector('canvas').style.visibility = 'hidden'),
      reset: () => (document.querySelector('canvas').style.visibility = ''),
    });
    // 3 — mountains forced off, through the timeline's own override so the next
    //     frame cannot put them back.
    await twice('mountains-off', {
      setup: () => (globalThis.__stratos.journey.debug.mountains = 'forced-off'),
      reset: () => (globalThis.__stratos.journey.debug.mountains = 'timeline'),
    });
    // 4 — the Meridian hidden, leaving the sky, the cloud deck and the range.
    await twice('meridian-hidden', {
      setup: () => {
        globalThis.__hidden = [];
        globalThis.__stratos.scene.traverse((o) => {
          if (o.userData?.meridianRoot && o.visible) {
            o.visible = false;
            globalThis.__hidden.push(o);
          }
        });
      },
      reset: () => {
        for (const o of globalThis.__hidden ?? []) o.visible = true;
      },
    });

    await ctx.close();
  }
}

await browser.close();
writeFileSync(`${OUT}/report.json`, JSON.stringify({ results, isolation }, null, 1) + '\n');

// -----------------------------------------------------------------------------
const stateDiffering = results.filter((r) => !r.stateIdentical);
const pixelDiffering = results.filter((r) => !r.pixelIdentical);
const belowApplication = results.filter((r) => r.stateIdentical && !r.pixelIdentical);

console.log('\n--- verdict ----------------------------------------------------');
console.log(`states captured             : ${results.length} (${RUNS} runs each)`);
console.log(`application state differs   : ${stateDiffering.length}`);
console.log(`PNG bytes differ            : ${pixelDiffering.length}`);
console.log(`state-exact, pixels differ  : ${belowApplication.length}`);

if (belowApplication.length) {
  const worst = belowApplication.reduce((a, b) => (a.diff.changedFraction > b.diff.changedFraction ? a : b));
  const canvasOnly = belowApplication.filter((r) => r.diff.byRegion.canvas === r.diff.changedPixels);
  console.log(`  largest change            : ${(worst.diff.changedFraction * 100).toFixed(4)}% of ${worst.view}@${worst.metres}`);
  console.log(`  max channel delta         : ${Math.max(...belowApplication.map((r) => r.diff.maxChannelDiff))}`);
  console.log(`  entirely inside the canvas: ${canvasOnly.length} of ${belowApplication.length}`);
}
if (stateDiffering.length) {
  console.log('\napplication state is not reproducible — this is a defect, not a rasteriser:');
  for (const r of stateDiffering) console.log(`  ${r.view}@${r.metres} — ${r.stateDiffKeys.join(', ')}`);
}
console.log(`\nwritten: ${OUT}`);
process.exitCode = stateDiffering.length ? 1 : 0;

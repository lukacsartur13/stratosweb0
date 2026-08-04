// =============================================================================
// Altimeter Meridian — permanent visibility and zero-overflow validation.
//
//     npm run dev:full                       # in another terminal
//     node experiments/validate-meridian.mjs
//
//     LOCALES=hu,en,de SAMPLES=101 node experiments/validate-meridian.mjs
//     VIEWPORTS=1440x900,390x844 node experiments/validate-meridian.mjs
//
// This is the check behind the brief's standing requirement: the instrument
// must remain visible, complete, central and uncrowded at *every* altitude, not
// only at the eleven named stations, and the page must never scroll sideways.
//
// ## Why this runs against the dev server
//
// It measures projected Three.js bounds in browser space, which needs the
// scene, the camera and the renderer. Those are published on `__stratos` by
// `DevSceneHandle`, behind `import.meta.env.DEV`, so they are statically
// stripped from production — `grep __stratos dist/` finds nothing. That is the
// correct arrangement (§12 of the brief excludes validation hooks from
// production) and it is why this is a standalone script rather than a case in
// the full-ascent suite, which runs against the production build.
//
// What it measures is not weakened by that. The geometry, the camera rig, the
// layout and the CSS are identical between the two builds; only the handle that
// lets a script *read* them differs. The two `userData` tags it navigates by —
// `meridianRoot` and `meridianGimbal` — are plain scene-graph data and do
// survive into production, so the objects being measured are the shipped ones.
//
// ## What "the essential instrument" means here
//
// The brief separates two things and gives them different rules: the essential
// silhouette (dial, body, needle, aperture, calibration detail) must never
// reach the viewport edge, while an active ring is *allowed* to approach it as
// long as it stays complete. So:
//
//     essential  = the `meridianRoot` subtree minus the `meridianGimbal` subtree
//     rings      = the `meridianGimbal` subtree
//     meridian   = both
//
// ## How the bounds are computed
//
// For every visible mesh, the eight corners of its geometry bounding box are
// transformed by `matrixWorld` and projected through the live camera to pixel
// space; the union of those points is the screen bound. This is the projected
// hull of each mesh's AABB, which is *conservative* — never smaller than the
// true projected silhouette, and slightly larger for a rotated mesh. A
// conservative bound is the right error direction: it can report a clip that is
// marginally not there, never miss one that is.
//
// Meshes behind the camera are the one case a naive projection gets wrong: `w`
// flips sign and the point lands mirrored on the far side of the screen. Any
// corner with a non-positive clip `w` marks the mesh as crossing the near
// plane, which is reported as a frustum failure rather than folded into a
// bound that would be nonsense.
//
// ## Usable viewport
//
// `visualViewport` where present, `innerWidth/innerHeight` otherwise, minus the
// safe-area insets read off the live computed style. §3 is explicit that
// centring against `window.innerHeight` is wrong where mobile browser chrome
// makes `visualViewport` more accurate.
// =============================================================================
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.URL ?? 'http://localhost:5176/experiments/stratos-ascent-full/full.html';
// Overridable so the sweep can be sharded across processes. The full matrix is
// 3 locales × 9 viewports × 102 altitudes, and each sample costs a scroll, a
// settle and a measurement; run in one process that is upwards of five hours,
// which is long enough that nobody runs it. Nine shards write nine files and
// `merge-meridian.mjs` joins them into the report the gate reads.
const OUT = process.env.OUT ? resolve(ROOT, process.env.OUT) : resolve(ROOT, '_build/reports/meridian-visibility.json');

/** §10's matrix. `landscape` marks the mobile-landscape row. */
const DEFAULT_VIEWPORTS = [
  { w: 1440, h: 900, tier: 'desktop' },
  { w: 1366, h: 768, tier: 'desktop' },
  { w: 1024, h: 768, tier: 'tablet' },
  { w: 768, h: 1024, tier: 'tablet' },
  { w: 430, h: 932, tier: 'mobile' },
  { w: 390, h: 844, tier: 'mobile' },
  { w: 360, h: 800, tier: 'mobile' },
  { w: 320, h: 568, tier: 'mobile' },
  { w: 844, h: 390, tier: 'mobile', landscape: true },
];

const VIEWPORTS = process.env.VIEWPORTS
  ? process.env.VIEWPORTS.split(',').map((s) => {
      const [w, h] = s.split('x').map(Number);
      return { w, h, tier: w >= 1280 ? 'desktop' : w >= 768 ? 'tablet' : 'mobile' };
    })
  : DEFAULT_VIEWPORTS;

const LOCALES = (process.env.LOCALES ?? 'hu,en,de').split(',');

/**
 * §13's four extra run states, as flags rather than as separate scripts.
 *
 *   ZOOM=2      200% browser zoom. Emulated by halving the *layout* viewport
 *               and doubling the device scale factor, which is precisely what a
 *               browser does at 200%: the CSS pixel gets twice as many device
 *               pixels and the page sees half as many of them. Setting a CSS
 *               `zoom` instead would leave `innerWidth` reporting the unzoomed
 *               width and every fraction-of-viewport figure in this file would
 *               be measured against a viewport the page is not laid out in.
 *
 *   REDUCED=1   `prefers-reduced-motion: reduce`. On this route that path does
 *               not mount the scene at all, so there is no instrument to clip
 *               and no collision to have; what has to hold is that all the copy
 *               is present, the reading order is the narrative order and the
 *               page does not scroll sideways. The harness therefore skips the
 *               projection entirely rather than waiting thirty seconds for a
 *               handle that is never going to be published.
 *
 *   FALLBACK=1  The metric-matched shim faces. The webfonts are aborted at the
 *               network layer, which is the honest way to reach this state —
 *               `document.fonts` cannot be made to fail from script, and a run
 *               that merely *asked* for a fallback family would measure a
 *               different stack from the one a visitor on a failed font load
 *               actually gets.
 */
const ZOOM = Number(process.env.ZOOM ?? 1);
const REDUCED = process.env.REDUCED === '1';
const FALLBACK = process.env.FALLBACK === '1';
const MODE = [ZOOM !== 1 && `zoom${ZOOM * 100}`, REDUCED && 'reduced', FALLBACK && 'fallback-font']
  .filter(Boolean)
  .join('+');
/** §13: at least 101 evenly distributed samples, and the seven named stops. */
const SAMPLES = Number(process.env.SAMPLES ?? 101);
const NAMED = [0, 3_000, 7_000, 12_000, 18_000, 24_000, 30_000];

/**
 * The rail handoffs, and why they are sampled by name.
 *
 * §8 asks for explicit no-collision transition states: "the middle of the
 * movement must not create a temporary collision that is absent at the
 * endpoints". An evenly spaced grid does not test that. The five crossings are
 * at 150, 6 000, 11 000, 17 000 and 28 000 m and each takes 0.9 screens of
 * scroll, which at the local altitude rates is between 60 and 900 metres wide —
 * so a 101-sample grid with a 300-metre step can step straight over the
 * narrowest of them, and lands on the middle of none of them by construction.
 *
 * Each crossing therefore contributes its midpoint and four points either side
 * of it, spaced by the altitude the handoff window actually spans there. Those
 * are the states in which the instrument is between rails and both the outgoing
 * and the incoming column may be on screen.
 */
const HANDOFFS = [150, 6_000, 11_000, 17_000, 28_000];
const handoffSamples = (spanFor) =>
  HANDOFFS.flatMap((m) => {
    const w = spanFor(m);
    return [-1, -0.6, -0.25, 0, 0.25, 0.6, 1].map((k) => Math.min(30_000, Math.max(0, m + k * w)));
  });

/**
 * The altitude width of one handoff half-window at each crossing, derived from
 * the stage map rather than guessed: a stage of `share` screens covers
 * `to - from` metres, so 0.45 screens of it is that fraction of its range. The
 * tighter of the two stages meeting at the crossing is the one that matters.
 */
const HANDOFF_SPAN = {
  150: 130,
  6_000: 520,
  11_000: 560,
  17_000: 900,
  28_000: 320,
};

const altitudes = (() => {
  const even = Array.from({ length: SAMPLES }, (_, i) => (i * 30_000) / (SAMPLES - 1));
  const handoff = handoffSamples((m) => HANDOFF_SPAN[m] ?? 300);
  return [...new Set([...even, ...NAMED, ...handoff].map((a) => Math.round(a)))].sort((a, b) => a - b);
})();

/** §4's minimum edge margins, as a fraction of the usable viewport or in px. */
const marginFor = (tier, vw, vh) =>
  tier === 'desktop'
    ? { x: 0.04 * vw, y: 0.04 * vh, label: '4%' }
    : tier === 'tablet'
      ? { x: 0.03 * vw, y: 0.03 * vh, label: '3%' }
      : { x: 16, y: 16, label: '16px' };

/**
 * §13's replacement for the old global centre tolerance.
 *
 * The previous rule — the projected centre within ±3% of the *viewport* centre
 * at every altitude — no longer applies and must not be left in place, because
 * on this composition it is not merely stricter, it is wrong: the instrument is
 * supposed to be 19% off the viewport centre for most of the journey, and a
 * check that failed it for doing so would fail the accepted design.
 *
 * What replaces it is stricter in the way that matters. The horizontal
 * deviation is measured against the rail the composition *intended* at that
 * altitude, read off the page's own `railAt` rather than reconstructed here, so
 * a wandering instrument is caught at ±3% wherever the rail happens to be. The
 * vertical deviation is still measured against the viewport centre, because the
 * rails move the composition laterally only and nothing in the revision loosens
 * the vertical.
 */
const RAIL_TOLERANCE = 0.03;

// -----------------------------------------------------------------------------
// The in-page measurement. Everything below `page.evaluate` runs in the browser.
// -----------------------------------------------------------------------------
const measure = (altitude) =>
  // eslint-disable-next-line no-undef
  new Promise((done) => done()).then(() => altitude);

const PAGE_FN = ({ altitude, railTolerance }) => {
  const s = globalThis.__stratos;
  const THREE = s.three;
  const camera = s.camera;
  const comp = s.composition ?? {};

  // --- usable viewport ------------------------------------------------------
  const vv = globalThis.visualViewport;
  const rootStyle = getComputedStyle(document.documentElement);
  const inset = (name) => {
    const probe = document.createElement('div');
    probe.style.cssText = `position:fixed;height:env(${name});width:0;visibility:hidden`;
    document.body.appendChild(probe);
    const v = probe.getBoundingClientRect().height;
    probe.remove();
    return Number.isFinite(v) ? v : 0;
  };
  const safe = {
    top: inset('safe-area-inset-top'),
    bottom: inset('safe-area-inset-bottom'),
    left: inset('safe-area-inset-left'),
    right: inset('safe-area-inset-right'),
  };
  void rootStyle;
  const vpW = (vv?.width ?? innerWidth) - safe.left - safe.right;
  const vpH = (vv?.height ?? innerHeight) - safe.top - safe.bottom;
  const vpX = (vv?.offsetLeft ?? 0) + safe.left;
  const vpY = (vv?.offsetTop ?? 0) + safe.top;

  // --- collect the two subtrees --------------------------------------------
  let root = null;
  let gimbal = null;
  s.scene.traverse((o) => {
    if (o.userData?.meridianRoot) root = o;
    if (o.userData?.meridianGimbal) gimbal = o;
  });
  if (!root) return { error: 'meridianRoot not found in scene' };

  const inGimbal = new Set();
  if (gimbal) gimbal.traverse((o) => inGimbal.add(o));

  // --- project ---------------------------------------------------------------
  const v = new THREE.Vector3();
  const canvas = s.gl.domElement;
  const cw = canvas.clientWidth;
  const ch = canvas.clientHeight;
  const canvasRect = canvas.getBoundingClientRect();

  const project = (objects) => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let any = false;
    let behind = false;
    for (const o of objects) {
      const geo = o.geometry;
      if (!geo) continue;
      if (!geo.boundingBox) geo.computeBoundingBox();
      const bb = geo.boundingBox;
      if (!bb) continue;
      for (let i = 0; i < 8; i++) {
        v.set(i & 1 ? bb.max.x : bb.min.x, i & 2 ? bb.max.y : bb.min.y, i & 4 ? bb.max.z : bb.min.z);
        v.applyMatrix4(o.matrixWorld);
        // Clip w before the perspective divide: a point at or behind the near
        // plane projects to a mirrored, meaningless pixel.
        const e = camera.projectionMatrix.elements;
        const mv = v.clone().applyMatrix4(camera.matrixWorldInverse);
        const w = e[3] * mv.x + e[7] * mv.y + e[11] * mv.z + e[15];
        if (w <= 1e-6) { behind = true; continue; }
        v.project(camera);
        const px = canvasRect.left + ((v.x + 1) / 2) * cw;
        const py = canvasRect.top + ((1 - v.y) / 2) * ch;
        minX = Math.min(minX, px); maxX = Math.max(maxX, px);
        minY = Math.min(minY, py); maxY = Math.max(maxY, py);
        any = true;
      }
    }
    if (!any) return null;
    return { left: minX, top: minY, right: maxX, bottom: maxY, behind };
  };

  const essentialMeshes = [];
  const ringMeshes = [];
  root.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    // An ancestor turned off hides it regardless of its own flag.
    for (let p = o.parent; p; p = p.parent) if (!p.visible) return;
    (inGimbal.has(o) ? ringMeshes : essentialMeshes).push(o);
  });

  const essential = project(essentialMeshes);
  const rings = project(ringMeshes);
  const whole = project([...essentialMeshes, ...ringMeshes]);

  // --- rail deviation ----------------------------------------------------------
  //
  // The horizontal is measured against the rail the composition intended at
  // this altitude, the vertical still against the viewport centre. `railAt`
  // returns a fraction of the *usable* width and is read off the page rather
  // than recomputed here — see RAIL_TOLERANCE above for why that distinction is
  // the whole point of the check.
  //
  // `budget` of zero means this viewport carries no lateral travel at all
  // (portrait, and any landscape viewport whose measurement leaves no room). It
  // is not a special case in the arithmetic — `railAt` returns exactly 0.5
  // there and the check reduces to the centre tolerance it replaced.
  const centreOf = (b) => (b ? { x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 } : null);
  const c = centreOf(essential);
  const metres = s.journey.altitude;
  const intended = typeof comp.railAt === 'function' ? comp.railAt(metres) : 0.5;
  const railBudget = typeof comp.railBudget === 'function' ? comp.railBudget() : 0;
  const rail = {
    intended,
    budget: railBudget,
    track: typeof comp.railTrack === 'function' ? comp.railTrack(metres) : 0,
    stage: typeof comp.railOf === 'function' ? comp.railOf(s.journey.stage) : null,
    copySide: typeof comp.copySideOf === 'function' ? comp.copySideOf(s.journey.stage) : null,
  };
  const centre = c
    ? {
        // Where it actually is, as a fraction of the usable width.
        at: (c.x - vpX) / vpW,
        // Deviation from the intended rail, and from the vertical centre.
        dx: (c.x - (vpX + intended * vpW)) / vpW,
        dy: (c.y - (vpY + vpH / 2)) / vpH,
      }
    : null;
  const railOk = centre
    ? Math.abs(centre.dx) <= railTolerance && Math.abs(centre.dy) <= railTolerance
    : false;

  // --- margins and clipping ---------------------------------------------------
  const marginsOf = (b) =>
    b
      ? {
          left: b.left - vpX,
          top: b.top - vpY,
          right: vpX + vpW - b.right,
          bottom: vpY + vpH - b.bottom,
        }
      : null;
  const em = marginsOf(essential);
  const rm = marginsOf(rings);
  const minMargin = (m) => (m ? Math.min(m.left, m.top, m.right, m.bottom) : null);

  // --- horizontal overflow ----------------------------------------------------
  const de = document.documentElement;
  const overflow = de.scrollWidth - de.clientWidth;

  // Which element is responsible, when there is one.
  let culprits = [];
  if (overflow > 1) {
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.right > de.clientWidth + 1 || r.left < -1) {
        culprits.push(
          `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''} ${Math.round(r.left)}..${Math.round(r.right)}`,
        );
      }
      if (culprits.length >= 6) break;
    }
  }

  // --- typography collision ----------------------------------------------------
  // §5: text is tested against the *live projected* instrument bounds expanded
  // by the visual safety margin, not against a design coordinate.
  //
  // The rect an element is tested by is its *painted* rect, which is its border
  // box intersected with every clipping ancestor. `getBoundingClientRect`
  // ignores `overflow`, so a paragraph scrolled out of a clipped region still
  // reports the position it would occupy if the region were unbounded — and a
  // check built on that cannot measure any page with a scrollable region on it
  // at all. The portrait composition has one, deliberately: the flow band is a
  // window onto copy taller than itself.
  //
  // This makes the check *more* faithful, not more permissive: an element that
  // is entirely clipped away contributes no pixels to the frame, which is the
  // same thing the `opacity` and `visibility` guards below already encode.
  const paintedRect = (el) => {
    let r = el.getBoundingClientRect();
    let left = r.left, top = r.top, right = r.right, bottom = r.bottom;
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const cs = getComputedStyle(p);
      const clipsX = cs.overflowX !== 'visible';
      const clipsY = cs.overflowY !== 'visible';
      if (!clipsX && !clipsY) continue;
      const pr = p.getBoundingClientRect();
      if (clipsX) { left = Math.max(left, pr.left); right = Math.min(right, pr.right); }
      if (clipsY) { top = Math.max(top, pr.top); bottom = Math.min(bottom, pr.bottom); }
    }
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  };

  const pad = Math.max(8, Math.min(vpW, vpH) * 0.015);
  const zone = essential
    ? { left: essential.left - pad, top: essential.top - pad, right: essential.right + pad, bottom: essential.bottom + pad }
    : null;
  const collisions = [];
  let overlapArea = 0;
  if (zone) {
    const sel = '.panel h1, .panel h2, .panel__lead, a.btn, .hud__digits, .hud__stage, .panel p';
    for (const el of document.querySelectorAll(sel)) {
      const r = paintedRect(el);
      if (r.width <= 0 || r.height <= 0) continue;
      // Off-screen or straddling the edge: being scrolled past, not read.
      if (r.bottom < vpY || r.top > vpY + vpH) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) continue;
      // An ancestor faded out takes its text with it.
      let faded = false;
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        if (Number(getComputedStyle(p).opacity) < 0.05) { faded = true; break; }
      }
      if (faded) continue;
      const ox = Math.min(r.right, zone.right) - Math.max(r.left, zone.left);
      const oy = Math.min(r.bottom, zone.bottom) - Math.max(r.top, zone.top);
      if (ox > 0 && oy > 0) {
        // §13 asks for the overlap *area*, not only the fact of a hit. A
        // four-pixel clip of a descender and a headline laid across the dial
        // are the same boolean and very different defects, and the area is what
        // tells them apart in the report without reopening the browser.
        overlapArea += ox * oy;
        collisions.push(
          `${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).trim().split(/\s+/)[0] : ''} ` +
            `${Math.round(ox)}×${Math.round(oy)}px "${(el.textContent ?? '').trim().slice(0, 24)}"`,
        );
      }
      if (collisions.length >= 6) break;
    }
  }

  // --- canvas sizing -----------------------------------------------------------
  const dpr = s.gl.getPixelRatio();
  const buffer = { w: canvas.width, h: canvas.height };
  const canvasOk =
    Math.abs(cw - vpW - safe.left - safe.right) <= 2 + safe.left + safe.right &&
    Math.abs(buffer.w - Math.round(cw * dpr)) <= 2 &&
    Math.abs(buffer.h - Math.round(ch * dpr)) <= 2 &&
    !(canvas.width === 300 && canvas.height === 150);

  // --- vertical clipping of essential content -----------------------------------
  // §13 asks for vertical essential-content clipping separately from the
  // instrument's own bounds: copy that runs off the bottom of the frame with no
  // scroll left to reach it is content loss, which §15 forbids outright.
  const de2 = document.documentElement;
  const atBottom = window.scrollY + innerHeight >= de2.scrollHeight - 2;
  let clippedCopy = [];
  if (atBottom) {
    for (const el of document.querySelectorAll('.panel--destination a, .panel--destination p')) {
      const r = el.getBoundingClientRect();
      if (r.height > 0 && r.top >= vpY + vpH) clippedCopy.push(el.className || el.tagName);
      if (clippedCopy.length >= 4) break;
    }
  }

  return {
    altitude,
    reported: s.journey.altitude,
    stage: s.journey.stage,
    viewport: { w: vpW, h: vpH, x: vpX, y: vpY, safe },
    essential,
    rings,
    whole,
    rail,
    centre,
    railOk,
    margins: { essential: em, rings: rm },
    minMargin: { essential: minMargin(em), rings: minMargin(rm) },
    overflow,
    culprits,
    collisions,
    overlapArea,
    clippedCopy,
    canvas: { css: { w: cw, h: ch }, buffer, dpr, ok: canvasOk },
  };
};

/**
 * The reduced-motion measurement.
 *
 * A separate function because it is a different page, not a degraded one: there
 * is no canvas, no camera and no instrument, so there is nothing to project and
 * the four instrument checks have no subject. What is left is what §12 and §15
 * actually require of this path — every panel present, in narrative order, with
 * its copy intact, and no horizontal overflow.
 *
 * Reading order is checked against the stage map rather than against a
 * hard-coded list, and it is checked in *document* order: §12 requires the DOM
 * order to be the narrative order and independent of visual placement, which is
 * exactly the property that a left/right composition can silently break by
 * reaching for `order` or `row-reverse` to move a column.
 */
const REDUCED_FN = ({ altitude, stages }) => {
  const de = document.documentElement;
  const vpW = (globalThis.visualViewport?.width ?? innerWidth);
  const order = [...document.querySelectorAll('.panel')].map((p) => p.dataset.stage);
  const empty = [...document.querySelectorAll('.panel')]
    .filter((p) => (p.textContent ?? '').trim().length < 40)
    .map((p) => p.dataset.stage);
  return {
    altitude,
    viewport: { w: vpW, h: globalThis.visualViewport?.height ?? innerHeight },
    overflow: de.scrollWidth - de.clientWidth,
    orderOk: order.length === stages.length && order.every((id, i) => id === stages[i]),
    order,
    empty,
    panels: order.length,
  };
};

// -----------------------------------------------------------------------------
const browser = await chromium.launch();
const results = [];
let failures = 0;

for (const locale of LOCALES) {
  for (const vp of VIEWPORTS) {
    const page = await browser.newPage({
      // 200% zoom halves the layout viewport and doubles the device pixel
      // ratio. Both halves matter: the first is what makes German wrap
      // differently, the second is what makes the canvas allocate the buffer it
      // would really allocate.
      viewport: { width: Math.round(vp.w / ZOOM), height: Math.round(vp.h / ZOOM) },
      deviceScaleFactor: ZOOM,
      reducedMotion: REDUCED ? 'reduce' : 'no-preference',
    });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    // The fallback-font state, reached the way a visitor reaches it: the font
    // files do not arrive. `document.fonts` has no failure mode that can be
    // triggered from script, so anything short of this measures a stack the
    // failure case never produces.
    if (FALLBACK) await page.route('**/*.woff2', (route) => route.abort());

    // The locale is a property of the *document*, not of the URL.
    //
    // `detectLocale` reads `<html lang>` — which is right, because it is
    // correct before any script runs and is the same value assistive technology
    // uses — and the three production homepages are three separate shells that
    // set it statically. The single dev route this harness measures is one
    // shell, `experiments/full.html`, and it says `lang="hu"`.
    //
    // So the `?lang=` this script used to append did nothing at all: no module
    // reads the query string. Every "three-locale" run measured Hungarian three
    // times and reported it as three passes — which is worse than not running
    // German, because it looks like coverage. Rewriting the attribute in the
    // served HTML makes the document genuinely German before the first module
    // evaluates, which is exactly what the production `/de/` shell does.
    await page.route(BASE.split('?')[0], async (route) => {
      const response = await route.fetch();
      const body = await response.text();
      await route.fulfill({
        response,
        body: body.replace(/<html\s+lang="[^"]*"/i, `<html lang="${locale}"`),
      });
    });
    await page.goto(BASE, { waitUntil: 'networkidle' });
    const served = await page.evaluate(() => document.documentElement.lang);
    if (served !== locale) {
      // A silent fallback to Hungarian is the failure mode this replaced. It
      // must not come back quietly.
      throw new Error(`locale rewrite failed: asked for ${locale}, document is ${served}`);
    }
    const label = `${locale} ${vp.w}x${vp.h}${vp.landscape ? ' (landscape)' : ''}${MODE ? ` [${MODE}]` : ''}`;
    const rows = [];

    if (REDUCED) {
      // No canvas, no handle, nothing to wait for beyond layout and fonts.
      await page.waitForSelector('.panel', { timeout: 30_000 });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(600);
      const stages = ['calibration', 'initial-ascent', 'lower-atmosphere', 'cloud-entry', 'cloud-breakthrough',
        'selected-work', 'system', 'process', 'stratosphere-transition', 'full-stratosphere', 'destination'];
      // Three positions rather than 101: with no scene there is no altitude,
      // and the only thing that varies with scroll is which copy is on screen.
      for (const frac of [0, 0.5, 1]) {
        await page.evaluate((f) => scrollTo({ top: (document.documentElement.scrollHeight - innerHeight) * f, behavior: 'instant' }), frac);
        await page.waitForTimeout(250);
        const r = await page.evaluate(REDUCED_FN, { altitude: frac, stages });
        const problems = [];
        if (r.overflow > 1) problems.push(`h-overflow ${r.overflow}px`);
        if (!r.orderOk) problems.push(`reading order ${r.order.join(',')}`);
        if (r.empty.length) problems.push(`empty panels: ${r.empty.join(', ')}`);
        if (r.panels !== stages.length) problems.push(`${r.panels} panels, expected ${stages.length}`);
        rows.push({ altitude: frac, overflow: r.overflow, orderOk: r.orderOk, empty: r.empty, panels: r.panels, problems });
        if (problems.length) failures++;
      }
      console.log(
        `${label.padEnd(34)} scrolls=${rows.length}  fail=${rows.filter((r) => r.problems.length).length}  ` +
          `panels=${rows[0]?.panels ?? '?'}  order=${rows[0]?.orderOk ? 'ok' : 'BAD'}` +
          (errors.length ? `  pageerrors=${errors.length}` : ''),
      );
      for (const b of rows.filter((r) => r.problems.length)) console.log(`    scroll ${b.altitude}  ${b.problems.join(' | ')}`);
      results.push({ locale, viewport: vp, mode: MODE, rows, errors });
      await page.close();
      continue;
    }

    await page.locator('canvas').waitFor({ state: 'visible', timeout: 30_000 });
    // The handle is published by a dynamic import and by the canvas mounting,
    // whichever lands last.
    await page.waitForFunction(() => globalThis.__stratos?.scene && globalThis.__stratos?.journey, null, {
      timeout: 30_000,
    });
    await page.waitForTimeout(1_200);

    for (const a of altitudes) {
      // Force the altitude *and* scroll the document to where that altitude
      // actually is.
      //
      // Forcing alone is not enough, and the way it fails is quiet. The debug
      // override drives `journey.current`, so the instrument, the camera and
      // the readout all go to the right state — but the DOM does not move, so
      // the copy on screen stays whatever was at scroll 0. Every altitude then
      // gets measured against the calibration panel, and a collision found at
      // 24 000 m is really the hero headline that is not on screen there at
      // all. The instrument half of the measurement was right; the typography
      // half was measuring a page nobody sees.
      //
      // `journey.current` is the progress the override resolved to, and the
      // track's scrollable travel maps it straight back to a scroll offset.
      //
      // It has to be *read a frame later*, and that is not a detail. `advance`
      // is what turns the forced altitude into a progress — `journey.current =
      // progressAt(forced)` — and it runs on the next frame, so the value
      // standing in `journey.current` at the instant the override is written is
      // still the previous sample's. Reading it synchronously scrolls the
      // document to where the *last* altitude was: at twelve samples that is
      // 2 700 m of lag, a whole stage, and the copy under test belongs to a
      // different panel from the instrument under test. It also makes the run
      // order-dependent, which is why two runs of the same tree reported
      // different failing altitudes. Two frames, because the first is the one
      // `advance` writes in and the second is the one anything reading it
      // downstream settles on.
      await page.evaluate(
        (m) =>
          new Promise((res) => {
            const s = globalThis.__stratos;
            s.journey.debug.altitude = m;
            requestAnimationFrame(() =>
              requestAnimationFrame(() => {
                const track = document.querySelector('[data-testid="journey-track"]');
                const travel = (track?.offsetHeight ?? document.documentElement.scrollHeight) - innerHeight;
                scrollTo({ top: s.journey.current * travel, behavior: 'instant' });
                // Scrolling rewrites the journey's target; the override still
                // wins on the next frame, but re-assert it so no frame is read
                // in between.
                s.journey.debug.altitude = m;
                res();
              }),
            );
          }),
        a,
      );
      // Forced altitude is applied as `progressAt(forced)` — no damping — but
      // the camera rig and the ring gimbal still need frames to write their
      // matrices. Wait until the projected centre stops moving rather than
      // guessing a duration, which is the same reasoning the full-ascent suite
      // uses for its settle predicate.
      await page.evaluate(
        () =>
          new Promise((res) => {
            let last = null;
            let stable = 0;
            let frames = 0;
            const tick = () => {
              const s = globalThis.__stratos;
              let root = null;
              s.scene.traverse((o) => {
                if (o.userData?.meridianRoot) root = o;
              });
              const p = root ? `${root.matrixWorld.elements.join(',')}` : '';
              if (p === last) stable++;
              else stable = 0;
              last = p;
              if (stable >= 3 || ++frames > 240) return res();
              requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
          }),
      );

      const r = await page.evaluate(PAGE_FN, { altitude: a, railTolerance: RAIL_TOLERANCE });
      if (r.error) {
        console.error(`  !! ${label} @ ${a}m: ${r.error}`);
        failures++;
        break;
      }

      const m = marginFor(vp.tier, r.viewport.w, r.viewport.h);
      const essentialClipped =
        !r.essential ||
        r.essential.behind ||
        r.minMargin.essential === null ||
        r.minMargin.essential < 0;
      const ringClipped = r.rings ? r.rings.behind || r.minMargin.rings < 0 : false;
      const marginOk = r.minMargin.essential !== null && r.minMargin.essential >= Math.min(m.x, m.y);

      const problems = [];
      if (r.overflow > 1) problems.push(`h-overflow ${r.overflow}px [${r.culprits.join('; ')}]`);
      if (essentialClipped) problems.push('essential clipped');
      if (ringClipped) problems.push('ring clipped');
      if (!r.railOk)
        problems.push(
          `rail ${(r.centre.at * 100).toFixed(1)}% vs ${(r.rail.intended * 100).toFixed(1)}% ` +
            `(dx ${(r.centre.dx * 100).toFixed(1)}%, dy ${(r.centre.dy * 100).toFixed(1)}%)`,
        );
      if (!marginOk)
        problems.push(`margin ${r.minMargin.essential?.toFixed(0)}px < ${m.label}`);
      if (r.collisions.length)
        problems.push(`text collision ${Math.round(r.overlapArea)}px²: ${r.collisions.join('; ')}`);
      if (r.clippedCopy.length) problems.push(`copy below the fold at rest: ${r.clippedCopy.join('; ')}`);
      if (!r.canvas.ok)
        problems.push(`canvas ${r.canvas.css.w}x${r.canvas.css.h} buf ${r.canvas.buffer.w}x${r.canvas.buffer.h}`);

      rows.push({
        altitude: a,
        stage: r.stage,
        overflow: r.overflow,
        rail: r.rail,
        centre: r.centre,
        minMarginEssential: r.minMargin.essential,
        minMarginRings: r.minMargin.rings,
        essentialClipped,
        ringClipped,
        collisions: r.collisions,
        overlapArea: r.overlapArea,
        canvasOk: r.canvas.ok,
        problems,
      });
      if (problems.length) failures++;
    }

    const bad = rows.filter((r) => r.problems.length);
    const worstMargin = rows.reduce(
      (acc, r) => (r.minMarginEssential !== null && r.minMarginEssential < acc ? r.minMarginEssential : acc),
      Infinity,
    );
    const worstRail = rows.reduce(
      (acc, r) => (r.centre ? Math.max(acc, Math.abs(r.centre.dx), Math.abs(r.centre.dy)) : acc),
      0,
    );
    const budget = rows[0]?.rail?.budget ?? 0;

    console.log(
      `${label.padEnd(28)} samples=${rows.length}  fail=${bad.length}  ` +
        `worstMargin=${Number.isFinite(worstMargin) ? worstMargin.toFixed(0) + 'px' : 'n/a'}  ` +
        `worstRail=${(worstRail * 100).toFixed(2)}%  ` +
        `rails=${budget > 0 ? `${((0.5 - budget) * 100).toFixed(1)}/${((0.5 + budget) * 100).toFixed(1)}%` : 'off'}` +
        (errors.length ? `  pageerrors=${errors.length}` : ''),
    );
    for (const b of bad.slice(0, 8)) console.log(`    ${String(b.altitude).padStart(6)}m  ${b.problems.join(' | ')}`);
    if (bad.length > 8) console.log(`    … ${bad.length - 8} more`);

    results.push({ locale, viewport: vp, rows, errors, worstMargin, worstRail, railBudget: budget });
    await page.close();
  }
}

await browser.close();
await mkdir(dirname(OUT), { recursive: true });
await writeFile(
  OUT,
  JSON.stringify({ generatedAt: new Date().toISOString(), mode: MODE || 'standard', locales: LOCALES, altitudes, results }, null, 1),
);

console.log(
  `\n${failures === 0 ? 'PASS' : 'FAIL'} — ${failures} problem sample(s)` +
    `${MODE ? ` [${MODE}]` : ''}. Report: ${OUT}`,
);
process.exit(failures === 0 ? 0 : 1);

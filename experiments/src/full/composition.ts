/**
 * The composition: where the instrument lands on screen, and what room that
 * leaves the copy.
 *
 * ## Why this module exists at all
 *
 * Three files used to answer the question "how big is the instrument, right
 * now, on this viewport" and none of them could answer it for the other two.
 * `JourneyCamera` owned the frame and the dolly, `AltimeterMeridian` owned the
 * recede, and `styles.css` owned a hand-tuned guess at where the dial would be
 * (the `38%`/`62%` stops in the portrait plate gradient). That guess was
 * measured once, on one viewport, at one altitude — and §9.2 of the Phase 6
 * report is the bill for it: on a 768×1024 the essential silhouette is 37% of
 * the viewport height, not the 23% the stops were tuned against, so the copy
 * bands were laid out over the dial.
 *
 * Everything here is a pure function of `(altitude, viewport)`. Nothing reads
 * the scroll position, nothing holds a timeline, and nothing is
 * direction-dependent — which is what makes forward and reverse traversal
 * identical by construction rather than by test (§7).
 *
 * ## The projection is exact, not approximate
 *
 * The instrument is centred on the view axis and rides at exactly the camera's
 * height (see `cameraHeightAt`), so its projected height is a closed form:
 *
 *     px = localHeight × scale / (2 × distance × tan(vFov / 2)) × viewportHeight
 *
 * Checked against the live renderer through the dev handle at eleven altitudes
 * on a 390×844: predicted 174.8px against a measured 175px at 0 m, and 153.3px
 * against 153px at 12 000 m. The one-pixel residual is the model's AABB being
 * conservative under the pose rotation, which is the safe error direction — the
 * band it sizes is never smaller than the object it has to clear.
 */

import {
  CEILING_M,
  STAGES,
  STAGE_BOUNDS,
  TRACK_VH,
  altitudeAt,
  clamp,
  ease,
  journey,
  lerp,
  progressAt,
  span,
  type StageId,
} from './journey';
import { ALTITUDE_STOPS, smoothRange } from './meridian';

// =============================================================================
// The camera frame.
//
// Moved here from JourneyCamera unchanged — same constants, same curves, same
// values at every aspect. It lives here now because the copy bands need the
// same numbers the camera uses, and a second copy of them is a second thing to
// keep in step. `JourneyCamera` imports them back.
// =============================================================================

/** The vertical field of view, in degrees. Set on the camera in JourneyScene. */
export const FOV = 32;

export const FRAME_WIDTH_PORTRAIT = 2.2;
export const FRAME_WIDTH_WIDE = 3.5;
export const FRAME_HEIGHT_BASE = 1.24;
export const FRAME_HEIGHT_LANDSCAPE = 2.15;
export const LANDSCAPE_ASPECT_FROM = 1.85;
export const LANDSCAPE_ASPECT_TO = 2.2;

/**
 * The distance at which the instrument exactly fills the frame, whichever axis
 * binds. Everything in the dolly is a multiple of this, so the composition
 * survives a resize and a phone.
 */
export function fitDistance(aspect: number, fov = FOV): number {
  const vFovHalf = (fov * Math.PI) / 360;
  const hFovHalf = Math.atan(Math.tan(vFovHalf) * Math.max(aspect, 1e-3));
  const frameWidth = lerp(FRAME_WIDTH_PORTRAIT, FRAME_WIDTH_WIDE, clamp((aspect - 1) / 1));
  const frameHeight = lerp(
    FRAME_HEIGHT_BASE,
    FRAME_HEIGHT_LANDSCAPE,
    clamp((aspect - LANDSCAPE_ASPECT_FROM) / (LANDSCAPE_ASPECT_TO - LANDSCAPE_ASPECT_FROM)),
  );
  return Math.max(frameWidth / 2 / Math.tan(hFovHalf), frameHeight / 2 / Math.tan(vFovHalf));
}

/** The dolly's four legs, as a multiple of `fitDistance`. */
export function dollyK(metres: number): number {
  let k = lerp(1.06, 0.94, ease(span(metres, 0, 2_400)));
  k = lerp(k, 1.14, ease(span(metres, 5_000, 9_500)));
  k = lerp(k, 1.3, ease(span(metres, 9_500, 17_000)));
  k = lerp(k, 1.38, ease(span(metres, 24_000, 30_000)));
  return k;
}

// =============================================================================
// The recede.
// =============================================================================

/**
 * Local height of the essential silhouette's world AABB at scale 1.
 *
 * Measured off the live scene graph at eleven altitudes: 1.010 at its smallest
 * (3 000 m, the instrument square to the camera) and 1.0454 at its largest
 * (0 m, where the ground pose's −7° pitch and 12° yaw swing the housing corners
 * widest). The maximum is the one that matters — the band this sizes has to
 * clear the object at its largest, not on average.
 */
export const ESSENTIAL_LOCAL_HEIGHT = 1.0454;

/** Scale the instrument group takes at a given recede. */
export const recededScale = (recede: number) => lerp(1, 0.62, recede);
/** How far back in depth the instrument group withdraws at a given recede. */
export const recededDepth = (recede: number) => -recede * 1.35;

/**
 * The narrative recede — the round trip that was already here.
 *
 *   12 300 → 15 600  hands over, through the four case studies
 *   16 200 → 19 200  comes most of the way back, for the system and process
 *   24 000 → 30 000  the rest of the way, for the Meridian state
 *
 * Unchanged in behaviour and unchanged on every landscape and desktop
 * viewport. `finalCalibration` is passed in rather than read off the meridian
 * singleton so this stays a pure function of altitude.
 */
export function narrativeRecede(metres: number, finalCalibration: number): number {
  const handover = ease(span(metres, 12_300, 15_600));
  const back = ease(span(metres, 16_200, 19_200)) * 0.66;
  return clamp(handover - back - finalCalibration * 0.26);
}

/**
 * How far the dense-stage recede may go, on top of the narrative one.
 *
 * 0.30 is not a taste value. Projected size goes as `scale / distance`, and
 * both terms move together here, so at the working distance on a 390×844
 * (9.78 world units at 12 000 m) a recede of 0.30 reads as
 *
 *     0.886 × 9.78 / (9.78 + 0.405) = 0.851
 *
 * — a 15% reduction in projected size, inside the 8–18% the decision asked to
 * search, and the smallest value that clears the measured collisions on the
 * standard portrait matrix (searched at 0.10/0.18/0.24/0.30/0.36; 0.24 still
 * left the ladder stage's lead band 11px short on a 360×800).
 *
 * It is added to the narrative recede and the sum is clamped to 1, so the
 * instrument never goes below the 0.62 scale the case studies already take it
 * to. There is no altitude at which this makes the instrument smaller than a
 * state the accepted composition already contains.
 */
export const DENSE_RECEDE_MAX = 0.3;

/** Metres of smoothstep at each end of a dense stage's altitude range. */
const DENSE_RAMP = 500;

/**
 * The stages whose copy does not fit the band pair, measured rather than
 * declared.
 *
 * Filled by `measureDensity()` from the live DOM after the fonts have settled,
 * because whether a panel is "dense" is a fact about the rendered copy at this
 * viewport in this locale, not about which class it carries. `.panel--centre`
 * is a layout choice; the cloud-breakthrough panel wears it and holds 181px of
 * copy, which fits any band this composition produces and must not trigger a
 * recede (§1: "Do not apply this recede to sparse portrait panels").
 */
const dense = new Set<StageId>();

/**
 * 0..1 — how strongly the dense-stage recede applies at this altitude.
 *
 * A pure function of the altitude and the measured dense set: same altitude,
 * same answer, whichever direction the visitor arrived from.
 */
export function denseAt(metres: number): number {
  let strongest = 0;
  for (const stage of STAGES) {
    if (!dense.has(stage.id)) continue;
    // Smoothstepped in over DENSE_RAMP at the bottom edge and out at the top,
    // so the instrument is never seen to step.
    const rise = ease(span(metres, stage.from - DENSE_RAMP, stage.from + DENSE_RAMP));
    const fall = 1 - ease(span(metres, stage.to - DENSE_RAMP, stage.to + DENSE_RAMP));
    strongest = Math.max(strongest, Math.min(rise, fall));
  }
  return strongest;
}

/**
 * The recede the instrument actually takes.
 *
 * `portrait` is the measured 0..1 portrait strength — 0 on every landscape and
 * desktop viewport, which is what confines this whole mechanism to portrait
 * without a second code path.
 */
export function recedeAt(metres: number, finalCalibration: number, portrait: number): number {
  return clamp(narrativeRecede(metres, finalCalibration) + DENSE_RECEDE_MAX * denseAt(metres) * portrait);
}

// =============================================================================
// The measured viewport.
// =============================================================================

export type Fit = {
  /** Usable width and height: `visualViewport` less the safe-area insets. */
  vw: number;
  vh: number;
  aspect: number;
  portrait: boolean;
  /**
   * 0..1 — how strongly the portrait composition applies. Zero at square and
   * above, so nothing landscape or desktop can ever see any of it.
   */
  strength: number;
  /**
   * The canvas box, and where the usable box sits inside it.
   *
   * The rails are expressed against the *usable* width — that is the box §1
   * names and the one the validator measures — but the instrument is placed by
   * projecting through a camera that fills the *canvas*. On every viewport in
   * the matrix the two are the same number, because the insets are zero; on a
   * notched phone held sideways they are not, and a rail computed against one
   * and applied through the other would land the instrument off its rail by
   * exactly the inset. Keeping both is what makes `railWorldX` exact rather
   * than exact-on-the-tested-devices.
   */
  canvasWidth: number;
  insetLeft: number;
};

/**
 * Read the usable viewport.
 *
 * `visualViewport` rather than `innerHeight`, because on a phone the two differ
 * by the browser chrome and §4 is explicit that the chrome-excluded box is the
 * one the centre tolerance and the bands are measured against. The safe-area
 * insets come off a probe element rather than from a guess, because `env()` is
 * only readable through layout.
 */
export function readFit(): Fit {
  if (typeof window === 'undefined') {
    return { vw: 1440, vh: 900, aspect: 1.6, portrait: false, strength: 0, canvasWidth: 1440, insetLeft: 0 };
  }
  const vv = window.visualViewport;
  const inset = (name: string) => {
    const probe = document.createElement('div');
    probe.style.cssText = `position:fixed;height:env(${name});width:0;visibility:hidden;pointer-events:none`;
    document.body.appendChild(probe);
    const v = probe.getBoundingClientRect().height;
    probe.remove();
    return Number.isFinite(v) ? v : 0;
  };
  // The *composition* box, not the visual viewport, when the two differ.
  //
  // `visualViewport` is the right box for §4's centre tolerance, and it is what
  // `validate-meridian` measures against. It is the wrong box for the bands,
  // and on a desktop or in a headless browser nothing reveals the difference
  // because there the two are the same number to the pixel.
  //
  // On a phone they are not. The sticky stage — which is the canvas, which is
  // what the instrument is centred in and projected onto — is `100svh`, the
  // *small* viewport height, deliberately: it does not resize while the browser
  // chrome slides away, so the scene does not reflow under the visitor's thumb.
  // `visualViewport.height` is the *current* height and grows by the height of
  // the chrome when it collapses. Sizing the bands from that while the plate,
  // the stage and the canvas are all sized from `svh` means two bands and a gap
  // that add up to more than the plate they are rows of, and the lower band
  // spills past the bottom of the frame. It also scales the projected height by
  // the wrong viewport, so the exclusion band is computed for an instrument
  // larger than the one on screen.
  //
  // So the box is read off the stage element when there is one, and falls back
  // to the visual viewport only where there is no scene to measure — the
  // reduced-motion and no-WebGL paths, which have no projected instrument to
  // clear either.
  const stage = document.querySelector('.journey__stage')?.getBoundingClientRect();
  const insetLeft = inset('safe-area-inset-left');
  const canvasWidth = stage && stage.width > 0 ? stage.width : (vv?.width ?? window.innerWidth);
  const vw = canvasWidth - insetLeft - inset('safe-area-inset-right');
  const vh =
    (stage && stage.height > 0 ? stage.height : (vv?.height ?? window.innerHeight)) -
    inset('safe-area-inset-top') -
    inset('safe-area-inset-bottom');
  const aspect = vw / Math.max(vh, 1);
  // Ramped rather than switched, so a viewport that is very nearly square does
  // not jump between two compositions on a one-pixel resize.
  const strength = clamp((1 - aspect) / 0.15);
  return { vw, vh, aspect, portrait: aspect < 1, strength, canvasWidth, insetLeft };
}

/**
 * The measured viewport, re-read by `measureComposition`. Declared here rather
 * than with the publication code below because the rails are budgeted against
 * it and they are the first thing that needs it.
 */
let fit: Fit = readFit();

/**
 * The instrument's projected height, in CSS pixels.
 *
 * The closed form checked against the renderer in the header comment. `recede`
 * is the live, damped value when the scene is mounted (see `setLiveRecede`) and
 * the analytic target otherwise, so the band never lags the object it clears.
 */
export function projectedEssentialHeight(fit: Fit, metres: number, recede: number): number {
  const distance = fitDistance(fit.aspect) * dollyK(metres) - recededDepth(recede);
  const worldHeight = 2 * distance * Math.tan((FOV * Math.PI) / 360);
  return (ESSENTIAL_LOCAL_HEIGHT * recededScale(recede)) / worldHeight * fit.vh;
}

/**
 * The exclusion band: the instrument's projected height, plus everything the
 * validator adds to it before it tests for a collision.
 *
 *   pad     the 1.5vmin visual safety margin `validate-meridian` expands the
 *           projected bounds by, on both edges. Budgeting to the bare
 *           silhouette passes geometry and fails the check — the same mistake
 *           the landscape copy budget made in §9.1.
 *   drift   the residual centre deviation. The instrument is centred by
 *           construction but the pointer parallax rotates the camera by up to
 *           two degrees and the measured `dy` runs to 0.6% of viewport height,
 *           so the band is grown symmetrically by twice that rather than
 *           assuming a perfectly centred projection.
 */
export function exclusionBand(fit: Fit, metres: number, recede: number): number {
  const pad = Math.max(8, Math.min(fit.vw, fit.vh) * 0.015);
  const drift = fit.vh * 0.012;
  return projectedEssentialHeight(fit, metres, recede) + 2 * pad + 2 * drift;
}

// =============================================================================
// The rails.
//
// This section supersedes the permanently centred composition. The instrument
// no longer sits at 50% for all 30 000 metres; it moves between three measured
// compositional rails, and the copy takes the side it is not on.
//
// Everything here obeys the same rule the rest of the module does: it is a pure
// function of `(altitude, viewport)`. There is no second scroll listener, no
// composition timeline, no direction-dependent state and no component-level
// easing — which is what makes forward and reverse traversal identical by
// construction rather than by test (§7).
// =============================================================================

/**
 * The width of the whole Meridian composition — instrument, housing, and all
 * three rings — in world units, at scale 1, every 500 metres.
 *
 * Generated by `experiments/probe-meridian-extent.mjs`, which is where the
 * reasoning for measuring rather than deriving lives. In short: the essential
 * silhouette is one rigid body and a closed form is exact for it, but the ring
 * composition unseats, tilts, translates and locks on its own timeline, so its
 * extent has no useful closed form that does not amount to a second
 * implementation of `meridian.ts` in a module that may not import `three`.
 *
 * What is tabulated is the *effective* extent: the width which, laid flat on
 * the view plane at the instrument's own distance, projects to the same pixels
 * the real geometry does. That absorbs both the pose rotation and the rings'
 * forward unseating, and what is left is genuinely viewport-free — the probe
 * repeats the sweep on three aspect ratios and reports the spread, which came
 * back at 2.58%.
 */
const COMPOSITION_WIDTH = [
  1.071, 1.060, 1.054, 1.049, 1.051, 1.051, 1.051, 1.051,
  1.057, 1.068, 1.079, 1.085, 1.226, 1.408, 1.486, 1.510,
  1.530, 1.546, 1.558, 1.566, 1.569, 1.567, 1.560, 1.548,
  1.531, 1.478, 1.390, 1.325, 1.331, 1.461, 1.567, 1.619,
  1.631, 1.622, 1.584, 1.506, 1.429, 1.388, 1.440, 1.498,
  1.535, 1.567, 1.594, 1.616, 1.634, 1.647, 1.683, 2.081,
  2.283, 2.306, 2.325, 2.340, 2.352, 2.359, 2.363, 2.365,
  2.364, 2.361, 2.357, 2.350, 2.342,
] as const;

/**
 * The same measurement for the essential silhouette alone — dial, body, needle,
 * aperture, calibration detail.
 *
 * The two are kept apart because §9 gives them different rules and always has:
 * a ring may approach the viewport edge as long as it stays whole, while the
 * dial may not, and text may pass a ring but not the dial. So the *rails* are
 * budgeted against the composition width, and the *copy column* is budgeted
 * against the essential width. Budgeting the column against the rings instead
 * would cost it 15–20% of its width to clear the corners of a bounding box that
 * are, in the frame, empty sky.
 */
const ESSENTIAL_WIDTH = [
  1.045, 1.038, 1.041, 1.043, 1.044, 1.044, 1.044, 1.044,
  1.044, 1.044, 1.044, 1.044, 1.043, 1.039, 1.041, 1.040,
  1.040, 1.040, 1.039, 1.039, 1.039, 1.039, 1.039, 1.039,
  1.039, 1.039, 1.037, 1.035, 1.030, 1.023, 1.017, 1.014,
  1.013, 1.014, 1.018, 1.001, 0.995, 1.005, 1.010, 1.011,
  1.011, 1.011, 1.013, 1.015, 1.017, 1.020, 1.022, 0.999,
  0.994, 0.994, 0.996, 0.997, 0.999, 1.002, 1.004, 1.007,
  1.009, 1.011, 1.012, 1.013, 1.014,
] as const;

/** Metres between samples in the two tables above. */
const WIDTH_STEP = 500;

function sampleWidth(table: readonly number[], metres: number): number {
  const i = clamp(metres / WIDTH_STEP, 0, table.length - 1);
  const lo = Math.floor(i);
  return lerp(table[lo], table[Math.min(lo + 1, table.length - 1)], i - lo);
}

/** Half the horizontal field of view, in radians, for a given aspect. */
const hFovHalf = (aspect: number) => Math.atan(Math.tan((FOV * Math.PI) / 360) * Math.max(aspect, 1e-3));

/** A tabulated extent's projected width, as a fraction of the usable width. */
function projectedWidth(table: readonly number[], fit: Fit, metres: number, recede: number): number {
  const distance = fitDistance(fit.aspect) * dollyK(metres) - recededDepth(recede);
  const worldWidth = 2 * distance * Math.tan(hFovHalf(fit.aspect));
  return (sampleWidth(table, metres) * recededScale(recede)) / worldWidth;
}

/** The whole Meridian composition's projected width, 0..1 of the usable width. */
export const compositionWidthAt = (fit: Fit, metres: number, recede: number) =>
  projectedWidth(COMPOSITION_WIDTH, fit, metres, recede);

/** The essential silhouette's projected width, 0..1 of the usable width. */
export const essentialWidthAt = (fit: Fit, metres: number, recede: number) =>
  projectedWidth(ESSENTIAL_WIDTH, fit, metres, recede);

/**
 * §9's minimum edge margin, as a fraction of the usable width.
 *
 * The tiers are the validator's, keyed the same way `validate-meridian` keys
 * them, so the budget the composition reserves and the budget the check demands
 * cannot come apart: desktop 4%, tablet 3%, and a flat 16 CSS pixels below
 * that, which on a mobile-landscape viewport is the tighter of the two.
 */
export function edgeMarginFraction(fit: Fit): number {
  if (fit.vw >= 1280) return 0.04;
  if (fit.vw >= 768) return 0.03;
  return 16 / Math.max(fit.vw, 1);
}

export type RailId = 'left' | 'centre' | 'right';
export type CopySide = 'left' | 'right';

/**
 * The design displacement, as a fraction of the usable width.
 *
 * 0.19 puts the side rails at 31% and 69%, inside the 30–34% / 66–70% the
 * decision asked to search from. It is a *ceiling*, not a value: `railBudget`
 * takes it down wherever the measured ring composition needs the room, which is
 * how a 1024×768 ends up at 33.4% / 66.6% and a 1440×900 at the full 31% / 69%.
 */
export const RAIL_OFFSET_TARGET = 0.19;

/** §13's replacement for the old global centre tolerance. */
export const RAIL_TOLERANCE = 0.03;

/**
 * The altitude-based composition, as §2 scripts it.
 *
 * −1 is the left rail, +1 the right, 0 the centre. Six compositional acts over
 * eleven stages, which is five handoffs — few enough that none of them is a
 * reaction to a text change, and each one lands on a structural event the
 * instrument is already having:
 *
 *   0 m            centre    the object is established before anything moves
 *   150–6 000      right     the lower ascent; the narrative owns the left
 *   6 000–11 000   left      Ring 1 unseats at 7 000 and the cloud deck arrives
 *   11 000–17 000  right     the aperture breaks through at 12 000
 *   17 000–28 000  left      Rings 2 and 3 lock, at 18 000 and 24 000
 *   28 000–30 000  centre    the final calibration takes the frame back
 *
 * The copy side is deliberately *not* simply the mirror of this. It changes
 * three times against the instrument's five, because a rail change and a
 * column change are different events and running them together at every
 * boundary is what would make the page read as a slider. At 150 m and at
 * 28 000 m the instrument moves and the copy stays exactly where it is, which
 * is what makes those two handoffs read as the camera recomposing rather than
 * as the layout dealing itself a new hand.
 */
const RAIL_OF: Record<StageId, -1 | 0 | 1> = {
  calibration: 0,
  'initial-ascent': 1,
  'lower-atmosphere': 1,
  'cloud-entry': -1,
  'cloud-breakthrough': -1,
  'selected-work': 1,
  system: -1,
  process: -1,
  'stratosphere-transition': -1,
  'full-stratosphere': 0,
  destination: 0,
};

/** −1 the copy is on the left, +1 on the right. */
const COPY_OF: Record<StageId, -1 | 1> = {
  calibration: -1,
  'initial-ascent': -1,
  'lower-atmosphere': -1,
  'cloud-entry': 1,
  'cloud-breakthrough': 1,
  'selected-work': -1,
  system: 1,
  process: 1,
  'stratosphere-transition': 1,
  'full-stratosphere': 1,
  destination: 1,
};

/** The side a stage's copy takes. Static per stage, so it can be rendered. */
export const copySideOf = (stage: StageId): CopySide => (COPY_OF[stage] === 1 ? 'right' : 'left');

/** The rail a stage's instrument takes. */
export const railOf = (stage: StageId): RailId =>
  RAIL_OF[stage] === 1 ? 'right' : RAIL_OF[stage] === -1 ? 'left' : 'centre';

/**
 * How long a handoff takes, in screens of scroll.
 *
 * Expressed in screens rather than in metres because the visitor experiences
 * scroll, and the altitude curve is deliberately not linear in it: 150 metres
 * of calibration get a whole screen and 6 000 metres of case studies get 4.4,
 * so a handoff authored in metres would be a lurch at one end of the journey
 * and imperceptible at the other. `progressAt` is the existing, pure,
 * monotonic map between the two, so keying the crossing to scroll costs
 * nothing in §7 terms — the rail is still a function of the altitude and of
 * nothing else.
 *
 * 0.9 screens is slow: the instrument covers 38% of the viewport width over
 * most of a screen of scrolling, which is roughly half the rate the page
 * itself is moving under the visitor's hand. It is also short enough to sit
 * inside the natural gap between two plates — every panel centres its column
 * in a box at least one screen tall, so at a stage boundary the outgoing
 * column has left the top of the frame and the incoming one has not yet
 * reached the bottom. That gap is §8's no-collision transition state, and it
 * is measured rather than assumed: see the handoff samples in
 * `validate-meridian`.
 */
const RAIL_HANDOFF_SCREENS = 0.9;

/**
 * Walk a knot track keyed on stage boundaries.
 *
 * Consecutive boundaries are at least one screen apart — the smallest share in
 * the stage map is 1.0 — so two half-windows of 0.45 screens can never overlap
 * and a single scan answers exactly.
 */
function knotTrack(metres: number, of: Record<StageId, number>): number {
  const p = progressAt(metres);
  const half = RAIL_HANDOFF_SCREENS / 2 / TRACK_VH;
  let value = of[STAGES[0].id];
  for (let i = 1; i < STAGES.length; i++) {
    const next = of[STAGES[i].id];
    if (next === value) continue;
    const at = STAGE_BOUNDS[i].start;
    if (p <= at - half) return value;
    if (p < at + half) return lerp(value, next, ease(span(p, at - half, at + half)));
    value = next;
  }
  return value;
}

/** −1..+1 — where the instrument is between the left and right rails. */
export const railTrack = (metres: number) => knotTrack(metres, RAIL_OF);
/** −1..+1 — which side the active copy is on. */
export const copyTrack = (metres: number) => knotTrack(metres, COPY_OF);

/**
 * The recede the composition assumes when it budgets. Kept in one place because
 * three different consumers below need the instrument's size at an altitude
 * they are not currently at, and none of them may read the live value.
 */
const budgetRecede = (fit: Fit, metres: number) =>
  recedeAt(metres, smoothRange(metres, ALTITUDE_STOPS.thirdRing, ALTITUDE_STOPS.meridian), fit.strength);

/**
 * The largest displacement this viewport can carry, as a fraction of usable
 * width — the search §1 asks for, run against the measurement rather than
 * against a table of device widths.
 *
 * The complete active composition has to stay inside the usable viewport at
 * every rail *and at every point of every interpolation*, so the budget is the
 * minimum over the whole journey of the room left after the ring composition
 * and the edge margin have taken theirs, divided by how much of the
 * displacement is actually in use at that altitude. Dividing by the track is
 * what lets a partly-displaced state spend room a fully-displaced one could
 * not: at 250 m the instrument is a third of the way to the right rail, and
 * requiring the full displacement to fit there would throw away room nothing
 * ever needs.
 *
 * One number per viewport rather than one per altitude, which is deliberate:
 * a per-altitude budget would leave the instrument creeping sideways as the
 * rings grow and shrink *within* a stage, and §8 asks the composition to settle
 * into stillness. Constant budget, knotted track, still frames.
 *
 * Portrait gets zero — see `measureComposition`. §10 is explicit that a
 * viewport which cannot support the travel must not be made to perform it, and
 * a 390×844 measures a budget of 0.088, which is a 34-pixel move that buys the
 * copy nothing and costs the instrument its centre.
 */
export function railBudget(fit: Fit): number {
  let limit = RAIL_OFFSET_TARGET;
  for (let m = 0; m <= CEILING_M; m += 250) {
    const track = Math.abs(railTrack(m));
    if (track < 1e-3) continue;
    const half = compositionWidthAt(fit, m, budgetRecede(fit, m)) / 2;
    const room = 0.5 - half - edgeMarginFraction(fit);
    limit = Math.min(limit, room / track);
  }
  return Math.max(0, limit);
}

/** The measured budget for the current viewport. Zero until measured, and in portrait. */
let railLimit = 0;

/**
 * The intended projected centre of the instrument, as a fraction of the usable
 * width. This is the value §13 measures the rendered composition against.
 */
export function railAt(metres: number): number {
  return 0.5 + railTrack(metres) * railLimit;
}

/** The measured lateral budget, for the harness and the debug panel. */
export const railBudgetNow = () => railLimit;

/**
 * The camera's own share of the move.
 *
 * §6 asks for the lateral motion to read as the camera recomposing around the
 * instrument rather than as a UI object sliding across the screen, and lists a
 * camera target shift first among the ways to get there. This is that shift,
 * and it is deliberately small: one degree of yaw pans the sky, the cloud deck
 * and the mountain range by about 2% of the viewport width, which is enough for
 * the frame to read as having been re-aimed and far too little to disturb an
 * art direction that was accepted at a head-on view. The instrument's own
 * translation is then solved *against* this yaw — see `railWorldX` — so the
 * projected rail is hit exactly whatever the camera is doing.
 *
 * Negative because three.js yaws counter-clockwise about +Y: a camera panning
 * toward an instrument on the right rail turns to −y.
 *
 * ## It is gated on the budget, and that gate is not cosmetic
 *
 * Where the rails are off the camera must not pan either. The instrument's own
 * translation is solved *against* this yaw and `railWorldX` returns zero at a
 * zero budget, so a pan that was not gated would turn the camera without moving
 * the object — which projects the object off the view axis by the whole of the
 * pan. Measured on the portrait matrix before this guard: 6.4–6.9% off the
 * viewport centre at 430×932, 390×844 and 360×800, against a ±3% tolerance,
 * with the instrument sitting at exactly x = 0 the entire time. One degree is a
 * small angle on a wide viewport and a large one on a narrow one — the shift is
 * `tan(1°) / tan(hFov/2)`, and a portrait half-field is a third of a landscape
 * one — which is why this only ever showed up in portrait.
 */
export const RAIL_CAMERA_YAW = (1 * Math.PI) / 180;
export const railCameraYaw = (metres: number) =>
  railLimit <= 0 ? 0 : -RAIL_CAMERA_YAW * railTrack(metres);

/**
 * Where the instrument has to stand, in world units, to project onto its rail.
 *
 * Closed form rather than an iteration. With the camera at the origin of its
 * own frame, yawed by θ about +Y, and the instrument a distance D in front of
 * it at a lateral offset X, the projected clip-space abscissa is
 *
 *     ndc = (X cos θ + D sin θ) / ((D cos θ − X sin θ) · tan(hFov/2))
 *
 * which inverts to
 *
 *     X = D · (t cos θ − sin θ) / (cos θ + t sin θ),   t = ndc · tan(hFov/2)
 *
 * and is exact for every θ the camera can take. Solving rather than nudging is
 * what keeps the rail deviation inside ±3% while the camera is also moving:
 * a translation authored against a stationary camera would be off by the whole
 * of the camera's pan, which at one degree is 2% of the viewport on its own.
 *
 * The abscissa is built from the *usable* box and then converted into the
 * canvas's normalised space, because the rails are specified against the former
 * and the projection happens through the latter.
 */
export function railWorldX(metres: number, distance: number, yaw: number, aspect: number, at: Fit = fit): number {
  if (railLimit <= 0) return 0;
  const targetPx = at.insetLeft + railAt(metres) * at.vw;
  const ndc = (2 * targetPx) / Math.max(at.canvasWidth, 1) - 1;
  const t = ndc * Math.tan(hFovHalf(aspect));
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const denominator = cos + t * sin;
  if (Math.abs(denominator) < 1e-6) return 0;
  return (distance * (t * cos - sin)) / denominator;
}

/**
 * How much of the off-axis angle the instrument turns back through, so that it
 * keeps presenting its face to the camera as it moves.
 *
 * At the full displacement the instrument sits about ten degrees off the view
 * axis, and left alone it would be seen increasingly from the side — which
 * reads as the object having been pushed, not as the frame having moved.
 * Turning it most of the way back is what sells §6's "the camera composition is
 * recalibrating around it". Not all the way back: the residual few degrees are
 * what stop the move from looking like a flat translation of a billboard, and
 * they are the same order as the pose yaw the instrument already carries.
 */
export const RAIL_FACE = 0.7;

/**
 * The bounded scale correction §6 asks for.
 *
 * Three per cent at the full displacement. It buys the ring composition a
 * little more edge margin exactly where the budget above is tightest, and it
 * reads as the instrument settling a touch further away as it moves aside —
 * which is the mass-bearing direction. It is applied through the same scale and
 * depth pair the recede uses, so it cannot introduce a second way for the
 * instrument to change size.
 */
export const RAIL_SCALE_TRIM = 0.03;
export const RAIL_DEPTH_TRIM = 0.09;

/**
 * How far the instrument turns back toward the camera as it leaves the axis.
 *
 * The world-space angle from the instrument to the camera, taken at the
 * instrument's own lateral offset and distance, scaled by `RAIL_FACE`. Solved in
 * world space rather than against the camera's current yaw on purpose: what the
 * visitor reads is the *dial* presenting its face, and which way the dial has to
 * turn to do that does not depend on where the camera happens to be pointing.
 * At the full displacement this is about eleven degrees, of which seven and a
 * half are turned back.
 */
export const railFaceYaw = (worldX: number, distance: number) =>
  -RAIL_FACE * Math.atan2(worldX, Math.max(distance, 1e-3));

/**
 * The room the active copy has on its own side of the instrument, in CSS pixels.
 *
 * ## Why this is budgeted against the essential silhouette
 *
 * §9 gives the two bodies different rules and always has: a ring may approach
 * the viewport edge as long as it stays whole, while the dial may not, and text
 * may pass a ring but not the dial. `validate-meridian` encodes exactly that —
 * its collision zone is the *essential* projected bounds expanded by the visual
 * safety margin, and the rings are not in it. Budgeting the column against the
 * ring composition instead would cost it 15–20% of its width to clear the
 * corners of a bounding box that are, in the frame, empty sky.
 *
 * ## Why it is one number per stage rather than one per frame
 *
 * §8 asks the composition to settle into stillness, and a column whose width
 * tracked the instrument's projected size would be visibly breathing at sixty
 * hertz — the ring composition grows by half its own width between 11 000 and
 * 12 000 m alone. So the budget is the *worst* room over the whole time the
 * stage is composed, and the column is that width for the whole stage. It is
 * written once per measurement, not once per frame, and costs no reflow.
 *
 * ## The range is the stage's *settled* altitudes, and the test is on the rail
 *
 * A stage boundary is one of two events, and what tells them apart is whether
 * the **rail** changes across it — not whether the copy does. The rail is what
 * moves the instrument, and the instrument is what takes the room away.
 *
 * Where the rail is unchanged (17 000 → 22 000 → 25 500, all left) the room is
 * the same on both sides of the boundary, so the range extends *through* it: a
 * knot window is centred on the boundary, and stopping at the boundary would
 * leave the outer half of a window during which nothing about the composition
 * is actually changing.
 *
 * Where the rail changes, the boundary is the *midpoint* of a crossing, and
 * both halves of that crossing are transitional. So the range stops a half
 * window short of it, at the altitude the instrument has finished arriving.
 * What happens inside the window is §8's transition, and it is composed rather
 * than budgeted — `copyPresence` below yields the column through it. The two
 * are one mechanism seen from opposite ends: the budget is the room the copy
 * has once the instrument has settled, and the presence is what the copy does
 * before it has.
 *
 * Both halves of that rule were arrived at by measurement, and each of the two
 * plausible alternatives is wrong in a different direction:
 *
 * * Stopping at `b.start` rather than a half-window past it charges the stage
 *   for the state at the crossing's midpoint, where the instrument is dead
 *   centre. `selected-work` measured 481px of a 1440×900 against the 746px it
 *   has for 94% of its own stage — 265px of column thrown away on the densest
 *   panel on the page to pay for a state lasting nine tenths of a screen.
 * * Extending a half-window *past* `b.start` charges it for the far end of the
 *   crossing, where the instrument is on the rail the *previous* stage was
 *   using. `lower-atmosphere` budgeted at 165px of a 1425px viewport, and four
 *   case studies then stacked 11 907 pixels tall inside a 137-pixel column.
 *
 * Keying the test to `COPY_OF` instead is a third variant and is wrong for a
 * third reason: the copy stays on the left across 150 m while the instrument
 * travels the whole way from centre to the right rail, so `initial-ascent`
 * inherited the centred hero's budget and measured 27.5vw against the 38 it has
 * throughout its own stage.
 */
export function copyRoom(fit: Fit, stage: StageId): number {
  const i0 = STAGE_BOUNDS.findIndex((x) => x.id === stage);
  const b = STAGE_BOUNDS[i0];
  if (!b || railLimit <= 0) return fit.vw;
  const side = COPY_OF[stage];

  const halfWindow = RAIL_HANDOFF_SCREENS / 2 / TRACK_VH;
  const prev = STAGE_BOUNDS[i0 - 1];
  const next = STAGE_BOUNDS[i0 + 1];
  // Outward through a boundary the rail does not cross, inward past one it
  // does. The test is on `RAIL_OF` rather than on `COPY_OF`, and that is the
  // whole of it: what changes the room is the instrument moving, not the copy
  // changing sides. Keying it to the copy side charged `initial-ascent` for the
  // centred hero composition it shares a boundary with — 27.5vw at 1440 against
  // the 38 it has for the whole of its own stage — because the copy stays left
  // across 150 m while the instrument travels the entire way to the right rail.
  const from = Math.max(0, prev ? b.start + (RAIL_OF[prev.id] === RAIL_OF[stage] ? -halfWindow : halfWindow) : b.start);
  const to = Math.min(1, next ? b.end + (RAIL_OF[next.id] === RAIL_OF[stage] ? halfWindow : -halfWindow) : b.end);

  let room = 1;
  for (let i = 0; i <= 48; i++) {
    const metres = altitudeAt(lerp(from, to, i / 48));
    const half = essentialWidthAt(fit, metres, budgetRecede(fit, metres)) / 2;
    const centre = railAt(metres);
    room = Math.min(room, side === 1 ? 1 - centre - half : centre - half);
  }

  roomOf.set(stage, room);

  // The same margin the validator expands the instrument by before it tests for
  // a collision, plus a pixel or two of slack. Budgeting to the bare silhouette
  // passes geometry and fails the check — the mistake §9.1 of the Phase 6 report
  // records the landscape copy budget making.
  const pad = Math.max(8, Math.min(fit.vw, fit.vh) * 0.015);
  return Math.max(0, room * fit.vw - pad - 8);
}

/** The budgeted room per stage, as a fraction of usable width. Fed by `copyRoom`. */
const roomOf = new Map<StageId, number>();

/**
 * The handoff, and the one number that makes it a composition rather than a
 * collision.
 *
 * ## What goes wrong without it
 *
 * A panel's column is centred in a panel that is up to 4.4 screens tall, so on
 * a dense stage the column's *top* is most of a screen below the panel's top —
 * which means the incoming column reaches the middle of the frame while the
 * scroll position is still inside the previous stage, and therefore while the
 * instrument is still on the rail it is about to leave. That rail is, by
 * construction, the side the incoming copy is on. Measured on a 1440×900 in
 * Hungarian: the case-study headline 211px across the dial at 10 440 m, and the
 * cloud-entry headline 41px across it at 5 870 m. Both are absent at either
 * endpoint of the move and present in the middle of it, which is exactly the
 * transitional collision §8 names.
 *
 * ## What this is
 *
 * §8 asks for a sequence, not a cut: the current narrative resolves, the copy
 * begins yielding, the Meridian moves through the central area, the next block
 * becomes active on the opposite side, the composition settles. This is the
 * yield, and it is measured rather than timed — it is the ratio between the
 * room the copy *has* at this altitude and the room it was *budgeted*, so it
 * reaches full presence exactly when the instrument has cleared the column's
 * own width and not a frame before.
 *
 * Both halves of the sequence fall out of the one ratio. The outgoing column's
 * room shrinks as the instrument arrives on its side, so it yields; the incoming
 * column's room grows as the instrument leaves, so it resolves. Neither needs to
 * know the other exists, and neither is keyed to a boundary, a direction or a
 * clock — which is why forward and reverse traversal are identical here for the
 * same reason everything else in this module is (§7).
 *
 * ## The band, and why it ends at one rather than short of it
 *
 * 0.90 to 1.00 of the budget. The upper end is not slack: the budget *is* the
 * room the column was laid out to occupy, so at a ratio below one the column is
 * wider than the room it has, and the only question is by how much. A band that
 * completed early — 0.95 was tried — reads as complete and measures as a
 * collision: at 10 860 m the case-study headline sat 34px across the dial at
 * 0.52 opacity, which the eye reads as text and the check counts as text.
 *
 * The lower end is where the fade may as well be finished: at 0.90 of the
 * budget the shortfall is a tenth of the column, the smoothstep has taken the
 * opacity under 0.01, and nothing below that is visible or countable.
 *
 * It is not possible for this to hide copy inside its own settled range: the
 * budget is the *worst* room over that range, so the ratio there is one by
 * construction, and every centre-rail stage is at one throughout.
 */
export function copyPresence(stage: StageId, metres: number, recede: number): number {
  const budget = roomOf.get(stage) ?? 0;
  if (budget <= 0 || railLimit <= 0) return 1;
  const half = essentialWidthAt(fit, metres, recede) / 2;
  const centre = railAt(metres);
  const live = COPY_OF[stage] === 1 ? 1 - centre - half : centre - half;
  return ease(clamp((live / budget - 0.9) / 0.1));
}

// =============================================================================
// The live recede, and the one place it is written.
// =============================================================================

let liveRecede: number | null = null;

/**
 * `AltimeterMeridian` publishes its damped recede here once per frame.
 *
 * The band has to be sized from the value the instrument is *actually* at, not
 * from the value it is heading for. `settle()` lands exactly (see
 * SETTLE_EPSILON), so at rest the two are the same number and §7's exact
 * forward/reverse equality is untouched; during a fast scroll the damped value
 * trails the target, and it trails it *large* — the instrument is still at the
 * size it is leaving. A band sized from the target would be the smaller of the
 * two, which is the one direction that produces a collision.
 *
 * `null` when the scene is not mounted — the reduced-motion and no-WebGL paths
 * never run a frame loop — and the analytic target is used instead.
 */
export function setLiveRecede(value: number | null) {
  liveRecede = value;
}

// =============================================================================
// Publication.
// =============================================================================

const shown = new Map<string, string>();

function put(el: HTMLElement, name: string, value: string) {
  const key = `${(el as HTMLElement).dataset?.stage ?? 'root'}:${name}`;
  if (shown.get(key) === value) return;
  shown.set(key, value);
  el.style.setProperty(name, value);
}

/** Quantised, so a value that changes by a fraction of a pixel costs no reflow. */
const q = (px: number, step: number) => Math.ceil(px / step) * step;

/**
 * Stage progress without the clamp.
 *
 * `stageProgress` saturates at 0 and 1, which is right for everything that asks
 * "how far through this stage are we". The portrait plate is stuck for a screen
 * either side of its own stage — that is the whole point of the overlap — so it
 * needs to know it is at −0.4 rather than at 0.
 */
function rawProgress(progress: number, id: StageId): number {
  const b = STAGE_BOUNDS.find((x) => x.id === id);
  if (!b) return 0;
  return (progress - b.start) / (b.end - b.start || 1);
}

/**
 * The plate's visible range, in units of stage progress.
 *
 * One screen of scroll is `1 / share` of a stage's progress, which is where
 * every number here comes from.
 *
 * ## The hand-off is sequential, not simultaneous
 *
 * The first version faded the outgoing plate out and the incoming one in across
 * the *same* screen of scroll. Both are then at half opacity at the midpoint,
 * and because both have copy in the same two bands, the result on screen is two
 * headlines and two paragraphs overlaid — a double exposure, at every one of the
 * ten stage boundaries. Photographed on a 390×844 at 29 840 m: the closing
 * headline legible over the ghost of the stratosphere panel's lead paragraph.
 *
 * So the handover window is split. Each boundary owns `h` screens of shared
 * sticky range; the outgoing plate fades out across the first half of it and the
 * incoming plate fades in across the second, meeting exactly at the midpoint. At
 * every scroll position at most one plate is painted above a trace, and the
 * transition reads as a hand-off rather than as a fault.
 *
 * `h` is capped at 40% of the outgoing stage, so a one-screen stage does not
 * spend its life fading, and it is measured against the *outgoing* stage on both
 * sides of the boundary — the two plates have different shares, and a window
 * that is half a screen for one and a third of a screen for the other does not
 * meet in the middle.
 *
 * ## The copy is walked only while the plate is legible
 *
 * `--stage-flow` runs from the instant the plate starts appearing to the instant
 * it starts leaving, rather than across the whole sticky range. The difference
 * is content, not polish: copy that is still arriving during the fade-out is
 * copy the visitor is shown only at declining opacity, which for the tail of a
 * dense panel means the last of it is never presented at full contrast.
 */
function windowOf(id: StageId) {
  const i = STAGES.findIndex((s) => s.id === id);
  if (i < 0) return null;
  const share = STAGES[i].share;
  const isFirst = i === 0;
  // The last stage never begins to leave, and the difference is not symmetry
  // for its own sake. Every other stage stops walking its copy one handover
  // before its end, because that is where the next plate takes over. Past the
  // end of the *last* stage there is no scroll — the track stops and the footer
  // begins — so a stage that reserved a handover there would finish its walk at
  // a scroll position the visitor cannot reach, and the closing panel's contact
  // line and stage index would be permanently unreachable. Which is the one
  // thing §5 rules out.
  const isLast = i === STAGES.length - 1;
  /** Handover window at the end of a stage of the given share, in screens. */
  const handover = (s: number) => Math.min(1, 0.4 * s);
  /** This stage's own outgoing window, and the previous stage's, as progress. */
  const out = handover(share) / share;
  const incoming = isFirst ? 0 : handover(STAGES[i - 1].share) / share;

  return {
    /** Progress at which the plate begins to appear. */
    from: isFirst ? 0 : -incoming / 2,
    /** Progress at which it begins to leave, and the copy stops walking. */
    to: isLast ? 1 : 1 - out,
    /** Progress at which the fade-out completes: the midpoint of the window. */
    gone: isLast ? Infinity : 1 - out / 2,
    /**
     * Progress at which the copy starts *travelling*, as opposed to appearing.
     *
     * Zero, and it is deliberately not `from`.
     *
     * The two used to be the same number, and that is the defect §9 reports as
     * "checkpoint 01 is not visible when the section begins". `--stage-flow` was
     * normalised across `from..to` — the range over which the plate is legible —
     * which starts half a handover *before* the stage does. So at the instant a
     * stage began, its own copy had already been walked out of the window by
     * `(from / (from - to))` of its travel: 8.6% for Our Work, 19.3% for the
     * process, 25.8% for the system. On a seven-item list 19% is the first
     * checkpoint; on a three-layer diagram 26% is the first layer. Measured on a
     * 390×844, the process stage opened on checkpoint `02` with a clipped empty
     * box where `01` had been, and the ascent stage opened on a sentence cut in
     * half at the band's top edge.
     *
     * Fading and travelling genuinely want different ranges. A plate *should*
     * start appearing before its stage — that is the cross-fade, and it is why
     * `from` is negative. Its copy should *not* have moved when the visitor
     * arrives, because the top of the copy is where reading starts. One
     * normalisation was doing both jobs and could only be right for one of them.
     *
     * So the travel is measured from the stage's own start and the fade is not.
     * Nothing about the hand-over changes: `from`, `to` and `gone` are the
     * values they were, the cross-fade is the same cross-fade, and the copy
     * still stops walking at `to` so that the tail of a dense panel is never
     * presented at declining opacity. The only difference is that the walk now
     * begins at zero, where the stage does.
     */
    walkFrom: 0,
  };
}

let panels: HTMLElement[] = [];

/** The smallest flow band worth compositing into. Below it, the panel flows. */
const MIN_FLOW_BAND = 120;

// =============================================================================
// Keyboard focus inside the flow window.
// =============================================================================

/**
 * Turn a band's own scroll into the document scroll that belongs to it.
 *
 * The flow band clips. When focus moves — by Tab — to a link that has been
 * walked out of it, the browser does what it does for any clipped region and
 * scrolls the region itself to bring the focused element into view. `overflow:
 * hidden` is not user-scrollable but it *is* programmatically scrollable, so
 * this succeeds, and it succeeds behind the composition's back: `--stage-flow`
 * still says the copy is where it was, the band is now offset from it by
 * however far the browser scrolled, and nothing ever puts it back. Measured by
 * tabbing through a 390×844: the stage index and the whole footer nav each left
 * the band 20–22px out of alignment, permanently.
 *
 * The fix is not to stop the browser — it is doing the right thing, and a link
 * you can focus but cannot see is worse than a misaligned band. It is to accept
 * the browser's decision about *how far* and apply it to the axis this
 * composition actually moves on: the document. Undo the band scroll, convert it
 * through the same chain `--stage-flow` is derived from, and scroll the page by
 * that instead. The copy then arrives in the band by the ordinary mechanism,
 * the altimeter, the instrument and the veil all follow it, and the state is
 * still a pure function of scroll position — a keyboard visitor and a scrolling
 * visitor end up in exactly the same place.
 *
 * Slight under- or over-shoot is self-correcting: the browser re-fires until
 * the element is in view, and each pass is smaller than the last.
 */
function adoptBandScroll(band: HTMLElement) {
  const delta = band.scrollTop;
  if (!delta) return;
  band.scrollTop = 0;

  const panel = band.closest('.panel') as HTMLElement | null;
  const stage = panel?.dataset.stage as StageId | undefined;
  if (!panel || !stage || panel.dataset.fit !== 'window') return;

  const w = windowOf(stage);
  const bounds = STAGE_BOUNDS.find((x) => x.id === stage);
  const inner = panel.querySelector<HTMLElement>('.panel__band-inner');
  if (!w || !bounds || !inner) return;

  // Pixels of copy the window has to walk, and the three factors between one
  // of those pixels and one pixel of document scroll.
  const travel = inner.scrollHeight - band.clientHeight;
  const track = document.querySelector<HTMLElement>('[data-testid="journey-track"]');
  const documentTravel = (track?.offsetHeight ?? document.documentElement.scrollHeight) - window.innerHeight;
  if (travel <= 0 || documentTravel <= 0) return;

  // `walkFrom`, not `from`, and it has to be whichever range `--stage-flow` is
  // actually normalised over — this converts a band scroll back into the
  // document scroll that produces it, so a different range here means a
  // keyboard visitor's copy lands somewhere the scroll position does not agree
  // with, permanently.
  const perPixel = ((w.to - w.walkFrom) * (bounds.end - bounds.start) * documentTravel) / travel;
  window.scrollBy({ top: delta * perPixel, behavior: 'instant' });
}

/**
 * Capture phase, on the document, because `scroll` does not bubble. One
 * listener for every band rather than one per panel.
 */
function onAnyScroll(event: Event) {
  const target = event.target;
  if (target instanceof HTMLElement && target.classList.contains('panel__band--flow')) {
    adoptBandScroll(target);
  }
}

/**
 * Focus that lands on a plate the composition has faded out.
 *
 * The hand-over between stages is an `opacity` cross-fade, chosen so that a
 * plate waiting its turn stays in the document, in the accessibility tree and
 * in the reading order. The cost of that choice is that its links stay
 * *focusable* while they are invisible, and the browser's own focus handling
 * makes it worse rather than better: focusing an off-screen link scrolls the
 * document to the link's box, and a sticky plate's box begins a screen before
 * its stage does — which is exactly where its veil is still zero. Measured by
 * tabbing through a 390×844: 29 of 70 tab stops landed on a link inside a plate
 * at opacity 0.00, on screen, with nothing to see and no focus ring to follow.
 *
 * A keyboard visitor arriving at a stage's content should arrive at the *stage*
 * — the same thing a scrolling visitor gets. So focus is treated as navigation:
 * the journey scrolls to where that plate has fully arrived, the altimeter, the
 * instrument and the copy all follow, and the composition is the one the stage
 * is supposed to have. Two frames later `scrollIntoView` asks for the element
 * itself, and the band scroll that produces is adopted by `adoptBandScroll`
 * above, which walks the copy to it through `--stage-flow`.
 *
 * Nothing here is a second source of state: it only chooses a scroll position,
 * and every layer still derives from that one number.
 */
function onFocusIn(event: FocusEvent) {
  const el = event.target;
  if (!(el instanceof HTMLElement)) return;
  const panel = el.closest<HTMLElement>('.panel');
  // Not gated on the portrait window any more. The landscape composition now
  // fades a column through a handoff too, so a link inside one is just as
  // invisible and just as focusable there — and the remedy is the same. The
  // veil check below is the real gate; at rest every panel is at 1 and this
  // returns on the next line.
  if (!panel) return;
  if (Number(panel.style.getPropertyValue('--panel-veil') || '1') > 0.5) return;

  const stage = panel.dataset.stage as StageId | undefined;
  const bounds = stage ? STAGE_BOUNDS.find((b) => b.id === stage) : undefined;
  if (!bounds) return;

  const track = document.querySelector<HTMLElement>('[data-testid="journey-track"]');
  const travel = (track?.offsetHeight ?? document.documentElement.scrollHeight) - window.innerHeight;
  if (travel <= 0) return;

  // The start of the stage: `windowOf` puts `from` at or below zero and the
  // fade-in completes at zero, so this is the first progress at which the plate
  // is fully opaque.
  window.scrollTo({ top: bounds.start * travel, behavior: 'instant' });
  requestAnimationFrame(() =>
    requestAnimationFrame(() => el.scrollIntoView({ block: 'nearest', behavior: 'instant' })),
  );
}

/**
 * The altitude readout's safe anchor zone (§11).
 *
 * ## What the rails did to it
 *
 * The HUD is a stack in the bottom-left corner and it was clear of a *centred*
 * instrument by construction: a dial in the middle of the frame never reaches
 * the corner. On the left rail it does. Measured on the standard matrix, the
 * bottom-left corner of the instrument's exclusion zone meets the top-right
 * corner of the altitude digits — 1px of vertical overlap at 1366×768, 5px at
 * 1024×768 and a genuine 24×39px at 844×390, and only ever on the five-digit
 * readouts, which are 74px wider than the four-digit ones.
 *
 * §11 allows the readout to stay visually stable *if it does not collide*. It
 * does, so it has to be given a zone rather than left where it was.
 *
 * ## The zone is measured, and there are two of them
 *
 * The clear band below the instrument is `(vh − worstBand) / 2`, where
 * `worstBand` is the largest exclusion band over the whole journey on this
 * viewport — not at one altitude, because the readout may not move and the band
 * does. Then:
 *
 * * If the stack fits in that band, it keeps its layout and is pushed down to
 *   sit inside it. Nothing about the design changes; the offset does. This is
 *   every desktop and tablet viewport in the matrix.
 * * If it does not, the stack is the wrong shape for this frame and the readout
 *   becomes a strip along the bottom edge — the same content, one line high,
 *   entirely below the instrument's reach. This is mobile landscape, where the
 *   clear band is 97px and the stack is 134.
 *
 * Both are decided by measurement rather than by a device width, and the strip
 * is not a degraded state: a wide, short frame is exactly the shape a horizontal
 * readout suits.
 *
 * The stack height is measured with the strip layout forced off, so the decision
 * cannot oscillate — reading the height of an element that is already a strip
 * would say the strip fits and flip it back on the next resize.
 */
function measureHud(root: HTMLElement) {
  const hud = document.querySelector<HTMLElement>('.hud');
  if (!hud) return;
  if (fit.portrait) {
    // Portrait has its own HUD composition — an instrument strip across the top,
    // out of the copy's way — and no lateral travel for it to clear.
    delete root.dataset.hud;
    root.style.removeProperty('--hud-max-bottom');
    root.style.removeProperty('--hud-travel');
    return;
  }

  let worstBand = 0;
  for (let m = 0; m <= CEILING_M; m += 250) {
    worstBand = Math.max(worstBand, exclusionBand(fit, m, budgetRecede(fit, m)));
  }
  const clear = (fit.vh - worstBand) / 2;

  // Measured with the strip forced off, so the decision cannot oscillate:
  // reading the height of an element that is *already* a strip would say the
  // strip fits and flip it back on the next resize.
  root.dataset.hud = 'stack';
  const stackHeight = hud.getBoundingClientRect().height;

  // 8px of slack, so a subpixel difference between the projected band and the
  // rendered one is not the difference between a pass and a failure.
  const strip = stackHeight + 8 > clear;
  root.dataset.hud = strip ? 'strip' : 'stack';

  const box = hud.getBoundingClientRect();
  // The highest the readout may sit and still clear the instrument. The
  // stylesheet takes the *smaller* of this and the design inset, so on a
  // viewport with room to spare this constraint is simply not binding.
  root.style.setProperty('--hud-max-bottom', `${Math.max(8, Math.floor(clear - box.height - 8))}px`);

  if (strip) {
    // How far the strip may travel from the centre before it meets the inset.
    // Measured from the rendered box rather than assumed, because the readout's
    // width is a fact about the locale — a German stage name is not a Hungarian
    // one — and a travel authored against one of them overshoots on the other.
    const inset = Math.max(20, Math.min(fit.vw * 0.04, 56));
    root.style.setProperty('--hud-travel', `${Math.max(0, Math.floor((fit.vw - box.width) / 2 - inset))}px`);
  } else {
    root.style.removeProperty('--hud-travel');
  }
}

/**
 * Decide, per panel, between the windowed portrait composition and natural
 * vertical flow — and measure which stages are dense while we are here.
 *
 * This is §6's fork, and both sides of it are correct behaviour rather than a
 * success and a failure. A 390×844 in Hungarian has room for the immersive
 * composition; the same panel in German at 200% zoom does not, and there the
 * only right answer is to let the copy run below the fold and keep the
 * instrument as a smaller visible anchor.
 *
 * Measured after `document.fonts.ready` and again on resize, locale change and
 * text-size change, because every one of those moves the numbers being
 * compared. Nothing here is keyed to a device width.
 */
export function measureComposition(root: HTMLElement = document.documentElement) {
  fit = readFit();
  panels = [...document.querySelectorAll<HTMLElement>('.panel')];
  dense.clear();

  // The lateral budget, measured for this viewport — and zero in portrait.
  //
  // §10 is explicit that a viewport which cannot support the travel must not be
  // made to perform it. A 390×844 measures a budget of 0.088, which is a
  // 34-pixel move: it buys the copy nothing it can use and costs the instrument
  // its centre, so portrait keeps the accepted upper/lower editorial
  // composition and the portrait recede, both of which are already here. This
  // one assignment is the whole of the portrait/landscape fork for the rails —
  // every rail function below reads `railLimit`, and at zero they all collapse
  // to the centred composition by arithmetic rather than by a second code path.
  railLimit = fit.portrait ? 0 : railBudget(fit);
  roomOf.clear();
  // Idempotent: the same function references, so repeated measurements do not
  // stack listeners.
  document.addEventListener('scroll', onAnyScroll, true);
  document.addEventListener('focusin', onFocusIn);

  // Sized at the recede the panel will actually be seen at, which for a dense
  // panel includes the dense term — otherwise the measurement decides "dense"
  // from a band the visitor never sees, and then the recede makes that band
  // bigger and the decision was taken against the wrong number. Two passes:
  // once without the dense term to find the dense set, once with it to lay the
  // bands out.
  const bandAt = (metres: number, portrait: number) => {
    // The same `finalCalibration` the instrument will be at, not zero: above
    // 24 000 m it winds the narrative recede back down, and a band sized
    // without it would be sized for an instrument smaller than the one the
    // closing panels actually show.
    const recede = recedeAt(metres, smoothRange(metres, ALTITUDE_STOPS.thirdRing, ALTITUDE_STOPS.meridian), portrait);
    return (fit.vh - exclusionBand(fit, metres, recede)) / 2;
  };

  // The two band wrappers are `display: contents` outside the portrait window,
  // which means they have no box and report a height of zero — so measuring
  // them as they stand would decide every panel was empty and put the whole
  // page into the fallback, permanently and silently. They are given a box for
  // the length of this function instead: all the writes first, then all the
  // reads, so the browser does one layout for the page rather than one per
  // panel.
  const bands = panels.flatMap((panel) => [
    panel.querySelector<HTMLElement>('.panel__band--lead'),
    panel.querySelector<HTMLElement>('.panel__band-inner'),
  ]);
  for (const band of bands) if (band) band.style.display = 'block';

  const measured = panels.map((panel) => ({
    panel,
    leadH: panel.querySelector<HTMLElement>('.panel__band--lead')?.getBoundingClientRect().height ?? 0,
    flowH: panel.querySelector<HTMLElement>('.panel__band-inner')?.getBoundingClientRect().height ?? 0,
  }));

  for (const band of bands) if (band) band.style.removeProperty('display');

  const midOf = (stage: StageId | undefined) => {
    const meta = stage ? STAGES.find((s) => s.id === stage) : undefined;
    return meta ? (meta.from + meta.to) / 2 : null;
  };

  // Pass one — which stages are dense. Every panel is asked before any answer
  // is used, because `denseAt` smoothsteps across a stage's edges and a panel's
  // band therefore depends on whether its *neighbours* are dense too. Deciding
  // and consuming in one loop would give the first panel a different answer
  // from the last for no reason but iteration order.
  //
  // The question is asked at the unreceded scale on purpose: a recede that
  // justified itself by the band it had already widened would be circular.
  for (const { panel, flowH } of measured) {
    const stage = panel.dataset.stage as StageId | undefined;
    const mid = midOf(stage);
    if (!stage || mid === null) continue;
    // The final Meridian state is excluded by name, which is §1's one explicit
    // carve-out. 30 000 m is the altitude the whole instrument has been
    // assembling towards, the recede has just been wound back down to show it,
    // and shrinking it again to make room for the closing plate would spend the
    // payoff to fit a call to action. Where the closing copy will not fit the
    // bands at full size the answer is the flow fallback below, not a smaller
    // instrument.
    if (stage === STAGES[STAGES.length - 1].id) continue;
    if (fit.portrait && flowH > bandAt(mid, 0)) dense.add(stage);
  }

  // Pass two — window or flow, per panel, against the band it will actually be
  // composed at.
  const decisions: Record<string, unknown> = {};
  for (const { panel, leadH, flowH } of measured) {
    const stage = panel.dataset.stage as StageId | undefined;
    const mid = midOf(stage);
    if (!stage || mid === null) continue;
    const band = bandAt(mid, fit.strength);
    // The windowed composition needs the headline band to hold the headline and
    // the flow band to be worth reading. Either failing is the fallback
    // condition, and the fallback is not a failure.
    const fits = fit.portrait && band >= MIN_FLOW_BAND && leadH > 0 && leadH <= band;
    panel.dataset.fit = fits ? 'window' : 'flow';
    panel.dataset.dense = dense.has(stage) ? '1' : '0';
    // The side this stage's copy takes, and the room it has there. Written as
    // data and as a length rather than as a class, because both are facts about
    // the measured composition: the side is authored in `COPY_OF` and the room
    // is solved against the instrument's projected silhouette on *this*
    // viewport. Neither is a breakpoint.
    //
    // Set here and not in `publishComposition` on purpose — see `copyRoom`: it
    // is a per-stage constant, so writing it once per measurement is one style
    // recalculation per resize instead of one per frame.
    const room = railLimit > 0 ? copyRoom(fit, stage) : 0;
    panel.dataset.copy = railLimit > 0 ? copySideOf(stage) : 'flow';
    if (room > 0) panel.style.setProperty('--copy-room', `${Math.floor(room)}px`);
    else panel.style.removeProperty('--copy-room');

    // The lead band's own measured height, for the entry cap in the portrait
    // window — see the note on `.panel__band--lead` in styles.css. Published
    // here rather than derived in CSS because CSS cannot read the height of a
    // box in order to position it, and published *per panel* because every
    // stage's headline is a different number of lines in every locale.
    //
    // Same lifecycle as `--copy-room` above: a per-stage constant, rewritten
    // only when this function runs, which is after the fonts settle and on
    // every resize. Rounded up so a subpixel measurement can never leave the
    // pair a fraction of a pixel lower than the budget it was capped to.
    if (fits && leadH > 0) panel.style.setProperty('--lead-h', `${Math.ceil(leadH)}px`);
    else panel.style.removeProperty('--lead-h');
    decisions[stage] = {
      band: Math.round(band),
      leadH: Math.round(leadH),
      flowH: Math.round(flowH),
      fit: panel.dataset.fit,
      dense: panel.dataset.dense,
      copy: panel.dataset.copy,
      room: Math.round(room),
      rail: railOf(stage),
    };
  }
  // Kept so a harness can ask *why* a panel composed the way it did instead of
  // reconstructing this arithmetic and comparing two implementations of it.
  lastMeasurement = {
    vw: Math.round(fit.vw),
    vh: Math.round(fit.vh),
    strength: fit.strength,
    railBudget: railLimit,
    decisions,
  };

  measureHud(root);

  root.dataset.composition = fit.portrait ? 'portrait' : 'landscape';
  // Present only while the rails are actually carrying the composition, so the
  // stylesheet has one hook for "the instrument is off the centre and the copy
  // owns a side" and cannot get it from a width breakpoint instead.
  if (railLimit > 0) root.dataset.rails = 'on';
  else delete root.dataset.rails;
  shown.clear();
  publishComposition(root);
}

/**
 * Publish the composition for the current altitude. Called once per frame from
 * `JourneyHUD`'s existing tick — no second requestAnimationFrame, no second
 * scroll listener, and no React rerender per frame.
 */
export function publishComposition(root: HTMLElement = document.documentElement) {
  const metres = journey.altitude;
  const recede =
    liveRecede ??
    recedeAt(metres, smoothRange(metres, ALTITUDE_STOPS.thirdRing, ALTITUDE_STOPS.meridian), fit.strength);

  if (railLimit > 0) {
    // Where the instrument is, as a percentage of the usable width, and how far
    // between its rails. Neither drives layout — the column's width and side are
    // measured constants, which is what makes the frames still — but the HUD
    // reads `--rail-x` to keep the altitude readout out of the instrument's path
    // (§11), and the debug panel and the harness read both.
    //
    // Quantised to a tenth of a per cent, which at 1440px is 1.4 CSS pixels: a
    // rail move takes most of a screen of scroll, so nothing that changes below
    // this step is a change anyone can see, and above it nothing lags.
    put(root, '--rail-x', `${(Math.round(railAt(metres) * 1000) / 10).toFixed(1)}%`);
    put(root, '--rail-track', (Math.round(railTrack(metres) * 100) / 100).toFixed(2));
    // The readout's side, when it is a strip: the negation of the copy's, so it
    // sits where the narrative is not. Nothing reads it in the stack layout,
    // and writing it there would be a property nobody consumes.
    if (root.dataset.hud === 'strip') {
      put(root, '--hud-track', (-Math.round(copyTrack(metres) * 100) / 100).toFixed(2));
    }
  }

  if (!fit.portrait) {
    // The handoff yield. One write per panel per frame, quantised to a
    // hundredth, and `put` drops it when it has not changed — which through the
    // 95% of the journey that is not a crossing is every frame.
    for (const panel of panels) {
      const stage = panel.dataset.stage as StageId | undefined;
      if (!stage) continue;
      const presence = railLimit > 0 ? copyPresence(stage, metres, recede) : 1;
      put(panel, '--panel-veil', presence.toFixed(2));
      // A column nobody can see must not be able to take a click from the frame
      // behind it. A threshold rather than a ramp, because `pointer-events` has
      // no in-between.
      put(panel, '--panel-events', presence > 0.5 ? 'auto' : 'none');
    }
    return;
  }

  // 4px steps: below a quarter of a line's leading nothing moves that anyone
  // can see, and each step that does change costs one reflow of a panel rather
  // than sixty a second.
  put(root, '--meridian-gap', `${q(exclusionBand(fit, metres, recede), 4)}px`);

  for (const panel of panels) {
    if (panel.dataset.fit !== 'window') continue;
    const stage = panel.dataset.stage as StageId | undefined;
    if (!stage) continue;
    const w = windowOf(stage);
    if (!w) continue;

    // Unclamped, because the plate is stuck for a screen either side of its own
    // stage and both of those are outside 0..1. `stageProgress` clamps, which
    // is right for everything else that reads it and wrong here.
    //
    // Two progress values, and the split is §4.1's.
    //
    //   `pRaw`  is the scroll position, undamped. It drives where the copy
    //           *is*, because the copy is document content and document content
    //           belongs to the finger.
    //   `pEased` is the damped journey clock. It drives the cross-fade, because
    //           a fade is a visual transition and wants to arrive rather than
    //           to snap.
    //
    // They were the same value — the damped one — and that is the defect §2.4
    // reports as scrolling that feels delayed and keeps going after the finger
    // stops. It is not a feeling: measured on a 390×844, a 600px flick left the
    // body copy travelling for a further 336px over 400ms *after* `scrollY` had
    // stopped changing. Text sliding under a stationary reader is the most
    // literal form of the "detached from the finger" complaint there is, and the
    // damper was the only thing producing it — this route hijacks no scroll,
    // intercepts no wheel, snaps to nothing and ships no smooth-scroll library.
    const pRaw = rawProgress(journey.target, stage);
    const pEased = rawProgress(journey.current, stage);

    // The flow window walks the copy through the band from the stage's own
    // start — see `walkFrom` — to the last frame before the plate starts
    // leaving, so the tail of a dense panel is never presented at declining
    // opacity.
    put(panel, '--stage-flow', clamp((pRaw - w.walkFrom) / (w.to - w.walkFrom || 1)).toFixed(3));

    // The hand-off. In over the second half of the previous boundary's window,
    // out over the first half of this one's, so the two plates meet at the
    // midpoint instead of overlapping across it.
    //
    // The last stage never fades out — there is no plate behind it to reveal,
    // and fading the closing call to action away as the visitor reaches it
    // would be the page withdrawing its own conclusion.
    const arrive = w.from < 0 ? ease(span(pEased, w.from, 0)) : 1;
    const leave = Number.isFinite(w.gone) ? 1 - ease(span(pEased, w.to, w.gone)) : 1;
    const veil = arrive * leave;
    put(panel, '--panel-veil', veil.toFixed(3));
    // A plate nobody can see must not be able to take a click from the one
    // behind it. Half opacity is the hand-over point, and it is a threshold
    // rather than a ramp because `pointer-events` has no in-between.
    put(panel, '--panel-events', veil > 0.5 ? 'auto' : 'none');
  }
}

/** Reset everything this module wrote. Used when the journey unmounts. */
export function clearComposition(root: HTMLElement = document.documentElement) {
  document.removeEventListener('scroll', onAnyScroll, true);
  document.removeEventListener('focusin', onFocusIn);
  root.style.removeProperty('--meridian-gap');
  root.style.removeProperty('--rail-x');
  root.style.removeProperty('--rail-track');
  root.style.removeProperty('--hud-max-bottom');
  root.style.removeProperty('--hud-travel');
  root.style.removeProperty('--hud-track');
  delete root.dataset.composition;
  delete root.dataset.rails;
  delete root.dataset.hud;
  for (const panel of panels) {
    panel.style.removeProperty('--stage-flow');
    panel.style.removeProperty('--panel-veil');
    panel.style.removeProperty('--panel-events');
    panel.style.removeProperty('--copy-room');
    panel.style.removeProperty('--lead-h');
    delete panel.dataset.fit;
    delete panel.dataset.dense;
    delete panel.dataset.copy;
  }
  panels = [];
  dense.clear();
  roomOf.clear();
  shown.clear();
  railLimit = 0;
  liveRecede = null;
}

/** The measured fit, for the debug panel and the validation harness. */
export const currentFit = () => fit;
/** The measured dense set, for the validation harness. */
export const denseStages = () => [...dense];

let lastMeasurement: unknown = null;
/** The last composition decision, per panel, with the numbers behind it. */
export const measurement = () => lastMeasurement;

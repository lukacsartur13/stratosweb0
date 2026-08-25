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
import { SCENE, SCENE_PRESENCE, SCENE_RECEDE } from './scene';
import { ACT_HOLD, FRAME_H, FRAME_W, INSTRUMENT, actOf, type Placement } from './acts';
import { KINETIC_ATTR, prefersReducedMotion } from './kineticDom';
import { widestSettings, type KineticAnchorId } from './kineticType';

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
 * THE SCENE RECEDE — the instrument's dramaturgy, as a function of altitude.
 *
 * §12 of the art direction: the Meridian is an instrument, not the hero of
 * every scene, and an object that is the same projected size in all eleven
 * chapters has no dramaturgy of its own. `scene.ts` assigns each chapter a role
 * and `SCENE_RECEDE` turns that role into a distance.
 *
 * ## Why it is a recede and not an opacity or a scale on the wrapper
 *
 * Because the copy's room is budgeted against the instrument's *projected*
 * silhouette, and this is the one lever that both halves of §2's hierarchy read
 * from. A chapter that pushes the instrument back is, by the same arithmetic
 * and with no second declaration anywhere, a chapter whose statement may be
 * wider and therefore larger — `copyRoom` and `statementRoom` both call
 * `budgetRecede`, which calls this. Fading the object instead would have made
 * it less visible while leaving the column exactly as narrow as before, which
 * is how a page ends up with a small headline next to a ghost.
 *
 * ## Why it is smoothstepped across the whole stage rather than knotted
 *
 * The rails knot: the instrument holds a rail through a stage and crosses to
 * the next over 0.9 screens, because a lateral move that never settles reads as
 * a slider. Depth is the opposite case — a dolly that arrives and stops is a
 * cut, and the visitor is *climbing*, so the object receding continuously as
 * they pass it is the motion the page is already about. Ramped over
 * `SCENE_RAMP` at each edge and interpolated between neighbours in between, so
 * there is no altitude at which the size steps.
 *
 * Same rule as everything else in this module: a pure function of the altitude,
 * so forward and reverse traversal are identical by construction.
 */
const SCENE_RAMP = 900;

export function sceneRecedeAt(metres: number): number {
  // The stage whose altitude range contains `metres`, and its neighbours, so
  // the value crosses smoothly at every boundary rather than at the ones that
  // happen to differ.
  let value = SCENE_RECEDE[SCENE[STAGES[0].id].instrument];
  for (let i = 1; i < STAGES.length; i++) {
    const next = SCENE_RECEDE[SCENE[STAGES[i].id].instrument];
    if (next === value) continue;
    const at = STAGES[i].from;
    if (metres <= at - SCENE_RAMP) return value;
    if (metres < at + SCENE_RAMP) return lerp(value, next, ease(span(metres, at - SCENE_RAMP, at + SCENE_RAMP)));
    value = next;
  }
  return value;
}

/**
 * The recede the instrument actually takes.
 *
 * Three terms, and they are three different arguments:
 *
 *   narrative  the round trip that has always been here — the instrument hands
 *              the frame over through the case studies and comes back for the
 *              Meridian state.
 *   scene      the authored role, §12. Applies on every viewport, because the
 *              hierarchy it serves is not a portrait problem.
 *   dense      the measured portrait-only correction for copy that does not fit
 *              the band pair. Unchanged, and still gated on `portrait`.
 *
 * Summed and clamped to 1, so the instrument can never go below the 0.62 scale
 * the accepted composition already takes it to through the case studies. There
 * is no altitude at which this makes it smaller than a state the page already
 * contained.
 */
export function recedeAt(metres: number, finalCalibration: number, portrait: number): number {
  return clamp(
    narrativeRecede(metres, finalCalibration) +
      sceneRecedeAt(metres) +
      DENSE_RECEDE_MAX * denseAt(metres) * portrait,
  );
}

/** Half the horizontal field of view, in radians. */
const hFovHalf = (aspect: number) => Math.atan(Math.tan((FOV * Math.PI) / 360) * Math.max(aspect, 1e-3));

// =============================================================================
// THE ACT FRAME — where the approved 1440 x 900 composition lands on this
// viewport, and where the instrument has to stand to be in it.
//
// The six master frames are absolute compositions in a fixed field, so the only
// honest way to reproduce them on an arbitrary viewport is to fit the whole
// field uniformly and keep every relationship inside it. `styles.css` computes
// the same scale with `min(100vw / 1440, 100svh / 900)`; this is the script-side
// copy of it, and the two are asserted equal by the regression suite rather
// than assumed — a disagreement between them would put the type on one grid and
// the instrument on another.
//
// Deliberately NOT a breakpoint ladder and NOT a re-solve. §18: the approved
// optical scale and the approved placement come first, and the solver is a
// guardrail. Scaling the frame is also what makes the composition free of
// runtime text measurement entirely, which is the direct answer to §19's font
// metric hazard: there is no measurement to be taken against the wrong face,
// because there is no measurement.
// =============================================================================

export type ActFrame = {
  /** Reference px -> CSS px. */
  scale: number;
  /** Where the reference frame's origin sits in the viewport, in CSS px. */
  x: number;
  y: number;
};

export function actFrame(at: Fit = fit): ActFrame {
  const scale = Math.min(at.vw / FRAME_W, at.vh / FRAME_H);
  return {
    scale,
    x: at.insetLeft + (at.vw - FRAME_W * scale) / 2,
    y: (at.vh - FRAME_H * scale) / 2,
  };
}

/**
 * How much of the ramp between two chapters the instrument's arrival or
 * departure takes, as a fraction of the whole track.
 *
 * 0.4 of a screen at the shipped stage shares. Long enough that the object
 * reads as withdrawing rather than being switched off, short enough that it is
 * unambiguously gone before the next act's frame settles.
 */
const PRESENCE_RAMP = 0.4 / TRACK_VH;

/**
 * Is the instrument in the picture, 0..1 — and if not, how far through leaving.
 *
 * Keyed on SCROLL PROGRESS rather than on altitude, which every other curve in
 * this module is keyed on, and the exception is load-bearing: the destination
 * stage holds at 30 000 m, so `from === to === 30 000` and an altitude-keyed
 * ramp cannot tell the arrival from the beat after it. Progress can, it is the
 * same deterministic number read a different way, and forward and reverse
 * traversal stay identical because `journey.current` settles exactly (see
 * SETTLE_EPSILON).
 */
export function instrumentPresenceAt(progress: number): number {
  const p = clamp(progress);
  let value = SCENE_PRESENCE[SCENE[STAGES[0].id].instrument];
  for (let i = 1; i < STAGE_BOUNDS.length; i++) {
    const next = SCENE_PRESENCE[SCENE[STAGE_BOUNDS[i].id].instrument];
    if (next === value) {
      // AN ACT THAT DECLARES WHEN IT LEAVES, LEAVES — EVEN IF THE NEXT ACT
      // CARRIES THE OBJECT TOO. §31.
      //
      // Two chapters in a row with the object was impossible before the depth
      // proof: the budget was Act I and Act VI, eight chapters apart. It is not
      // impossible now, and Act V hands straight over to Act VI. With the roles
      // equal on both sides this loop used to `continue`, which meant no ramp,
      // which meant the object crossed the boundary at FULL presence while its
      // placement was being interpolated from a 980px crop at the right edge to
      // a 160px dial in the middle. Photographed: the arrival's statement fades
      // up over an object that has already slid into the arrival's own position.
      // That is a zoom-out, and §31 asks the arrival to be a RETURN.
      //
      // `leaves` is a statement about an act's composition ENDING, so it is
      // honoured here on its own terms: the object withdraws where the act says
      // it does, and the next chapter's own entrance brings it back. The guard
      // is the PLACEMENT, not the act — two chapters that share a placement have
      // nothing to hand over and must not blink.
      const from = INSTRUMENT[actOf(STAGE_BOUNDS[i - 1].id)];
      const to = INSTRUMENT[actOf(STAGE_BOUNDS[i].id)];
      if (!from || !to || from === to || from.leaves === undefined || value === 0) continue;
      const out = STAGE_BOUNDS[i - 1].start + from.leaves / TRACK_VH;
      const back = STAGE_BOUNDS[i].start;
      if (p <= out - PRESENCE_RAMP) return value;
      if (p < out + PRESENCE_RAMP) return lerp(value, 0, ease(span(p, out - PRESENCE_RAMP, out + PRESENCE_RAMP)));
      if (p <= back - PRESENCE_RAMP) return 0;
      if (p < back + PRESENCE_RAMP) return lerp(0, next, ease(span(p, back - PRESENCE_RAMP, back + PRESENCE_RAMP)));
      value = next;
      continue;
    }
    let at = STAGE_BOUNDS[i].start;
    if (next < value) {
      // A WITHDRAWAL LEAVES WITH THE FRAME, NOT WITH THE CHAPTER — §15.
      //
      // An entrance is still centred on the chapter boundary: the object has to
      // be fully in the picture by the time the frame it belongs to is
      // composed, and the six-act contract asserts exactly that at 0.4 of a
      // screen into the hold.
      //
      // An exit is a different question. The chapter ends when its BODY ends,
      // and an act's body can run for two screens after its frame has let go —
      // which is what left the arrival's instrument sitting behind editorial
      // copy and the route list for 2.1 screens of the 3.5 it was present for.
      // Where the act says when its composition finishes, use that instead.
      //
      // `leaves` is in screens and the conversion here is `/ TRACK_VH`, the
      // same nominal-screens approximation `PRESENCE_RAMP` above already makes
      // and for the same reason: the real track is measured per viewport and
      // this curve is a pure function of progress. The error is the ratio
      // between the nominal and the measured track — under a tenth of a screen
      // on the shipped layout, against a ramp 0.8 of a screen wide.
      const leaving = STAGE_BOUNDS[i - 1];
      const leaves = INSTRUMENT[actOf(leaving.id)]?.leaves;
      if (leaves !== undefined) at = Math.min(at, leaving.start + leaves / TRACK_VH);
    }
    if (p <= at - PRESENCE_RAMP) return value;
    if (p < at + PRESENCE_RAMP) return lerp(value, next, ease(span(p, at - PRESENCE_RAMP, at + PRESENCE_RAMP)));
    value = next;
  }
  return value;
}

/**
 * THE HOUSING SILHOUETTE, AS A MULTIPLE OF THE AUTHORED DIAL. §8, §9, §10.
 *
 * The occlusion mask has to be the shape of the thing that does the occluding,
 * and the thing that does the occluding is the CASE, not the drawn circle the
 * art direction authors. `Placement.dial` is the circle a visitor reads a
 * number off; the case around it is larger, and this is how much larger.
 *
 * MEASURED, not derived — `experiments/probe-silhouette.mjs` rasterises the
 * shipped geometry's real projected silhouette out of the scene graph (every
 * triangle of the `meridianRoot` subtree minus the gimbal, scan-converted into
 * a coverage grid) and reports the radius at each of 360 angles. Two poses,
 * eight kilometres and two authored sizes apart:
 *
 *     Act I    dial 221   silhouette 268 x 256 px   half-width / (dial/2) = 1.213
 *     Act VI   dial 160   silhouette 194 x 190 px   half-width / (dial/2) = 1.213
 *
 * The same number to four figures at both, which is what makes it a property of
 * the model rather than a fit. See §C and §D of the depth report.
 */
export const HOUSING_OF_DIAL = 1.213;

/**
 * How small the object is at the moment it stops being drawn.
 *
 * The renderer's own number, moved here because the mask has to apply it too —
 * see the withdrawal note in `instrumentStateAt`. 0.18 at a presence of 0.05,
 * which is where `AltimeterMeridian` cuts the object off, and the two hundredths
 * of a screen between there and zero is what makes the cut invisible as a cut.
 */
export const WITHDRAW_FLOOR = 0.18;

/** Below this presence the object is not drawn at all, so nothing may be cut. */
export const INSTRUMENT_CUTOFF = 0.05;

/** §8. Which way the mask's residual error falls. See the publication note. */
export const MASK_EROSION = 0.02;

/**
 * THE SILHOUETTE'S ASPECT, AND WHY THE SIMPLE MASK SURVIVED §8.
 *
 * §8 says to try the simplest geometry first and then inspect it critically,
 * and §9 warns that a generic radial mask may fail once the housing rotates.
 * The measurement answers both, and the answer is unusually kind: across 360
 * rays from the silhouette's own centroid the radius varies by ±4% of its mean
 * at Act I's near-frontal pose and by ±3% at Act VI's, with the residual
 * showing up as a slight horizontal stretch rather than as lumps.
 *
 *     Act I    268 x 256   aspect 0.955
 *     Act VI   194 x 190   aspect 0.979
 *
 * That is not a coincidence and it is not the mask being flattered: the object
 * IS a round case, seen nearly face-on in every pose the art direction asks
 * for, and its silhouette is a circle squashed by the pose's own yaw. So the
 * mask is an ELLIPSE — one more authored number than a circle, and it takes the
 * worst-case radial error from 4.5% of the radius to about 1.5%, which on the
 * largest dial in the proof is under four pixels.
 *
 * Where the error goes matters more than how big it is, and §8's real question
 * — does it read as a hole cut in the text — turns on the SIGN. See the mask
 * rule in `styles.css`: the published radius is eroded rather than dilated, so
 * every pixel of residual error hides a glyph UNDER the dark case instead of
 * ending a glyph in mid-air beside it. An eroded error is invisible on this
 * object because the object is nearly black; a dilated one is the failure §8
 * describes.
 *
 * The rings are deliberately NOT in this number. They are thin, they are open
 * at exactly the altitudes where the housing is the composition, and cutting
 * type along a thin gimbal arc is the "eleven handcrafted CSS hacks" §10 rules
 * out. Type crossing a ring paints over a dark wire, which reads as the wire
 * being behind it — see §C of the report for the measured cost.
 */
export const HOUSING_ASPECT = 0.96;

/**
 * The instrument's whole state at a scroll position — the ONE solved object
 * that both the renderer and the occlusion mask consume. §11, §13.
 *
 * §11 is the reason this exists rather than the renderer keeping its own copy:
 * a mask authored beside the object drifts from it, and the only way to make
 * drift impossible rather than merely unlikely is for the two to be the same
 * arithmetic on the same input. `AltimeterMeridian` inverts this into a world
 * transform; `publishComposition` divides it by the frame scale and writes it
 * out as the mask. Neither measures anything, neither reads the other back, and
 * both are pure functions of `progress`.
 *
 * ## Why the projected geometry is exactly the authored geometry
 *
 * The renderer does not place the object and then discover where it landed. It
 * solves the world position and scale that make it project ONTO `x`, `y` at
 * diameter `dial` — `actWorldX`, `actWorldY` and `actInstrumentScale` are that
 * solve, and they already existed. So at presence 1 the projected dial IS the
 * authored dial, on every viewport, and the mask can be written straight off
 * the authored numbers with no read-back and no lag. §28's alignment test is a
 * check on that claim, not a calibration of it.
 *
 * ## Interpolation, and how little of it there is
 *
 * §12: enough to demonstrate one object moving continuously, changing pose and
 * changing scale — not the full eleven-scene engine. So the authored placements
 * are anchors on the scroll track, an anchor is HELD across its own act's peak
 * stage, and between two anchors the state eases from one to the other. A
 * placement that jumped at a stage boundary would move the object laterally in
 * a single frame, which is the failure `railWorldX` exists to prevent, and it
 * would tear the mask off the object for exactly as long as the jump lasted.
 *
 * The pose interpolates as two independent angles rather than as a quaternion,
 * and §14 is satisfied by the authoring rather than by the machinery: the
 * authored poses are within 16° of each other on one axis and 9° on the other,
 * so there is no large rotation for a slerp to take the short way round. §14's
 * hazard is real and this is simply not a case of it — see §J of the report.
 */
export type InstrumentState = {
  /** Dial centre and diameter, in reference-frame px. */
  x: number;
  y: number;
  dial: number;
  /** The housing silhouette's centre and radii, in reference-frame px. */
  maskX: number;
  maskY: number;
  rx: number;
  ry: number;
  /** Degrees off the object's base pose. */
  yaw: number;
  pitch: number;
  /** 0..1. The analytic presence — the same curve the renderer damps toward. */
  presence: number;
  /** §46. Whether this position is allowed to stand in front of the monument. */
  occlusion: 'none' | 'monument';
};

/** The authored placements, as anchors on the scroll track. Built once. */
const ANCHORS: { start: number; end: number; at: Placement }[] = [];
for (const bound of STAGE_BOUNDS) {
  const at = INSTRUMENT[actOf(bound.id)];
  // One anchor per authored PLACEMENT, spanning the stages that share it, so a
  // two-stage act does not read as two anchors with a ramp between them.
  if (!at) continue;
  const last = ANCHORS[ANCHORS.length - 1];
  if (last && last.at === at) last.end = bound.end;
  else ANCHORS.push({ start: bound.start, end: bound.end, at });
}

const POSE_OF = (at: Placement) => at.pose ?? { yaw: 0, pitch: 0 };

/** The model's nominal silhouette, for a placement that has not been measured. */
const NOMINAL_MASK = {
  dx: 0,
  dy: 0,
  rx: HOUSING_OF_DIAL / 2,
  ry: (HOUSING_OF_DIAL * HOUSING_ASPECT) / 2,
};
const MASK_OF = (at: Placement) => at.mask ?? NOMINAL_MASK;

export function instrumentStateAt(progress: number): InstrumentState | null {
  if (ANCHORS.length === 0) return null;
  const p = clamp(progress);
  const presence = instrumentPresenceAt(p);

  // The exploration override. Compiled out of nothing and read as one null
  // check; see `journey.debug.placement` for why it exists at all.
  const forced = journey.debug.placement;
  if (forced) {
    return {
      x: forced.x,
      y: forced.y,
      dial: forced.dial,
      maskX: forced.x + forced.dial * (forced.mask?.dx ?? NOMINAL_MASK.dx),
      maskY: forced.y + forced.dial * (forced.mask?.dy ?? NOMINAL_MASK.dy),
      rx: forced.dial * (forced.mask?.rx ?? NOMINAL_MASK.rx),
      ry: forced.dial * (forced.mask?.ry ?? NOMINAL_MASK.ry),
      yaw: forced.yaw ?? 0,
      pitch: forced.pitch ?? 0,
      presence: 1,
      occlusion: 'monument',
    };
  }

  // The anchor whose span contains `p`, or the last one before it.
  let idx = ANCHORS.length - 1;
  for (let i = 0; i < ANCHORS.length; i++) {
    if (p <= ANCHORS[i].end) {
      idx = i;
      break;
    }
  }
  const here = ANCHORS[idx];
  const prev = idx > 0 ? ANCHORS[idx - 1] : null;
  let a = here;
  let b = here;
  let t = 0;
  if (prev) {
    // THE TRANSITION WINDOW.
    //
    // Two anchors are crossed by EASING from one to the other, never by
    // selecting between them: a placement that changed at a stage boundary
    // would move the object laterally in a single frame, which is the failure
    // `railWorldX` exists to prevent, and it would tear the mask off the object
    // for exactly as long as the jump lasted.
    //
    // The window sits inside the gap the presence ramps leave, and its two ends
    // are chosen rather than symmetrical:
    //
    //   it CLOSES one ramp before the next anchor takes hold, so an anchor's own
    //   span is never inside a transition and the mask is live from the first
    //   frame of the act. An evenly straddled window would have put its edge at
    //   0.4 of a screen in, which is exactly where the composed frame sits.
    //
    //   it OPENS two ramps before the previous anchor releases, which is what
    //   gives the one pair of anchors that TOUCH somewhere to move. Act V ends
    //   where Act VI begins; without a window the placement would jump 880
    //   reference pixels and 820 of dial in one frame there. With it, the move
    //   happens across the 0.45 of a screen in which `leaves` has taken the
    //   object out of the picture and the arrival has not yet brought it back —
    //   so the slide is invisible, and what the visitor sees is the withdrawal
    //   and the return the accepted arrival is built on (§31), not a zoom-out.
    const windowFrom = Math.max(prev.start, prev.end - 2 * PRESENCE_RAMP);
    const windowTo = Math.max(windowFrom, here.start - PRESENCE_RAMP);
    if (p < windowTo) {
      a = prev;
      b = here;
      t = ease(span(p, windowFrom, windowTo));
    }
  }

  const at = a.at;
  const to = b.at;
  const pa = POSE_OF(at);
  const pb = POSE_OF(to);

  // THE WITHDRAWAL, AS A REFERENCE-FRAME SCALE ABOUT THE PRINCIPAL POINT.
  //
  // The renderer used to do this in two pieces — multiply the scale by
  // `0.18 + 0.82 x presence` and subtract 0.9 world units from z — which is
  // fine for an object nothing else has to agree with and is not fine now that
  // a mask has to sit exactly on it. The z term moves the object toward the
  // vanishing point by a factor the stylesheet has no way to know, so a mask
  // written off the authored placement would slide off the object for exactly
  // as long as the withdrawal lasted, which is §28's "mask leading the object".
  //
  // Receding along the view axis IS a uniform scale about the principal point,
  // so both pieces are one operation: shrink the dial and pull its centre
  // toward the frame's own centre by the same factor. The scale law is the
  // renderer's own, unchanged — 0.18 at the cut-off, 1 at full presence — so
  // the object withdraws exactly as far as it did, by a single arithmetic that
  // the mask can perform too.
  //
  // The principal point is the frame's centre and not merely near it: the field
  // is centred in the viewport by `.act`, and `actWorldY` measures its rows
  // against the viewport's own half-height, so the camera axis lands on row 450
  // of the reference frame at every viewport this composition is solved for.
  const k = presence >= 1 ? 1 : WITHDRAW_FLOOR + (1 - WITHDRAW_FLOOR) * presence;
  const x = FRAME_W / 2 + (lerp(at.x, to.x, t) - FRAME_W / 2) * k;
  const y = FRAME_H / 2 + (lerp(at.y, to.y, t) - FRAME_H / 2) * k;
  const dial = lerp(at.dial, to.dial, t) * k;

  // The measured silhouette for this pose, or the model's nominal one. Four
  // numbers, all fractions of the dial, so the mask scales with the object by
  // construction and the withdrawal above needs no second expression here.
  const ma = MASK_OF(at);
  const mb = MASK_OF(to);
  return {
    x,
    y,
    dial,
    // The housing's centre is not the dial's centre: the case is deeper than it
    // is wide, so any yaw at all slides its silhouette off the face it wraps.
    maskX: x + dial * lerp(ma.dx, mb.dx, t),
    maskY: y + dial * lerp(ma.dy, mb.dy, t),
    rx: dial * lerp(ma.rx, mb.rx, t),
    ry: dial * lerp(ma.ry, mb.ry, t),
    yaw: lerp(pa.yaw, pb.yaw, t),
    pitch: lerp(pa.pitch, pb.pitch, t),
    presence,
    // The intent belongs to the anchor being COMPOSED, and in the gap between
    // two anchors it belongs to neither: the object is on its way out of one
    // frame and into the next, the monument it was standing in front of is
    // leaving with its own frame, and an occlusion that outlived the frame it
    // was authored for would cut a hole in a statement nothing is behind.
    occlusion: t === 0 ? (at.occlusion ?? 'none') : t === 1 ? (to.occlusion ?? 'none') : 'none',
  };
}

/**
 * The scale the instrument group takes so that its dial measures `dial`
 * reference pixels on this viewport.
 *
 * The inverse of `projectedEssentialHeight`, solved for scale instead of
 * evaluated for height. `DIAL_OF_ESSENTIAL` converts between the two heights
 * the two systems measure: `ESSENTIAL_LOCAL_HEIGHT` is the essential
 * silhouette's world AABB, which is the box the copy has to clear, and the
 * study's `dial` is the drawn circle inside it. The ratio is a property of the
 * model and the pose, and it is MEASURED off the production render rather than
 * derived: at 0.9 the Act I dial came out 175px against the approved 221, and
 * 0.71 is what that measurement says. The essential AABB is conservative under
 * the pose rotation — it has to be, because it is also what the copy budget
 * clears — so it is meaningfully larger than the circle a visitor sees.
 */
export const DIAL_OF_ESSENTIAL = 0.71;

export function actInstrumentScale(dialRefPx: number, at: Fit, frame: ActFrame, metres: number): number {
  const targetPx = (dialRefPx / DIAL_OF_ESSENTIAL) * frame.scale;
  // Solved at the dolly distance the camera is actually at, with no recede: the
  // act placement replaces the recede for the two acts that have one, rather
  // than being applied on top of it.
  const distance = fitDistance(at.aspect) * dollyK(metres);
  const worldHeight = 2 * distance * Math.tan((FOV * Math.PI) / 360);
  return (targetPx / Math.max(at.vh, 1)) * (worldHeight / ESSENTIAL_LOCAL_HEIGHT);
}

/**
 * Where the instrument has to stand vertically to project onto a given row of
 * the frame.
 *
 * The mirror of `railWorldX`, and simpler because the camera never pitches for
 * the composition — only the pointer parallax does, and that is a fraction of a
 * degree either side of level. With the camera level, a point at distance D and
 * height H above the view axis projects to `ndc = H / (D tan(vFov/2))`, which
 * inverts directly.
 *
 * ## Why this exists at all, when the instrument used to be centred
 *
 * It used to ride at exactly the camera's height, so it was vertically centred
 * by construction, and that was correct while the composition was *copy beside
 * a centred object*. The approved art direction is not that: in Act I the dial
 * is in the upper right with the statement below and left of it, and in Act VI
 * it is low and under the statement. Neither is a centred object, and both are
 * the composition rather than a decoration of it.
 *
 * The old vertical-centre tolerance is therefore a contract about a design that
 * is no longer the design (§50). What replaces it is stricter, not looser: the
 * object has to land on its AUTHORED row, which is a specific number per act,
 * and the suite measures that instead of measuring ±3% of nothing in particular.
 */
export function actWorldY(rowPx: number, distance: number, at: Fit, frame: ActFrame): number {
  const targetPx = frame.y + rowPx * frame.scale;
  const ndc = 1 - (2 * targetPx) / Math.max(at.vh, 1);
  return distance * ndc * Math.tan((FOV * Math.PI) / 360);
}

/** The horizontal twin of `actWorldY`, for a column of the reference frame. */
export function actWorldX(colPx: number, distance: number, aspect: number, at: Fit, frame: ActFrame): number {
  const targetPx = frame.x + colPx * frame.scale;
  const ndc = (2 * targetPx) / Math.max(at.canvasWidth, 1) - 1;
  return distance * ndc * Math.tan(hFovHalf(aspect));
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
 * −1 is the left rail, +1 the right, 0 the centre. Five compositional acts over
 * eleven stages, which is four handoffs — few enough that none of them is a
 * reaction to a text change, and each one lands on a structural event the
 * instrument is already having:
 *
 *   0–6 000        right     the object is established, and the narrative owns
 *                            the left from the first frame
 *   6 000–11 000   left      Ring 1 unseats at 7 000 and the cloud deck arrives
 *   11 000–17 000  right     the aperture breaks through at 12 000
 *   17 000–28 000  left      Rings 2 and 3 lock, at 18 000 and 24 000
 *   28 000–30 000  centre    the final calibration takes the frame back
 *
 * ## Why the opening is no longer on the centre rail
 *
 * It was, and the argument for it was that the object should be established
 * before anything moves. What that costs is the whole of §A: on a centre rail
 * the copy's budget is half the frame less the dial's half-width — 456px at
 * 1440×900 — and the opening statement is the longest on the page, so it set as
 * five lines of 67px and the dial was the largest object in the frame the page
 * opens with. Measured against every other chapter, the opening carried the
 * SMALLEST display type on the page apart from the two authored troughs.
 *
 * Railed right it takes 830px of measure and 106px of type, and the object is
 * still whole, still lit, still the second thing in the frame. The direction is
 * explicit that the opening does not need to carry the most information but does
 * need to carry one of the strongest statements; this is the one decision on the
 * page that was standing between it and that.
 *
 * The handoff at 150 m goes with it — the instrument used to move there while
 * the copy stayed. What replaces it is a frame that is composed from the first
 * pixel rather than one that recomposes a screen in.
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
  calibration: 1,
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
 * The budgeted STATEMENT measure per stage, as a fraction of usable width.
 *
 * The same quantity `roomOf` holds for the prose column, for the box that is
 * now materially wider than it. Fed by `statementRoom`, read by `leadPresence`.
 */
const statementOf = new Map<StageId, number>();

/**
 * How much WIDER than the column the statement may run, in CSS pixels.
 *
 * ## The problem this exists to solve
 *
 * A headline confined to the body's column can never be more than medium-sized,
 * and that single fact is most of what made this page read as a stacked agency
 * site rather than as an art-directed one. At 1440 the column is 472px; a
 * genuinely monumental line needs more.
 *
 * ## Why there IS more, and why it is free
 *
 * `copyRoom` budgets against the instrument's projected **bounding box**, which
 * is the right measure for a column that runs the height of the frame — the
 * dial is at its widest across the middle, and that is where the body copy is.
 *
 * The statement is not there. It hangs in the sky band, above the dial's centre,
 * and the dial is a CIRCLE: at a height `k` radii above the centre its
 * half-width is only `sqrt(1 - k²)` of the radius. The room the bounding box
 * reserves at that height is room the object does not occupy — at 17 000 m the
 * band clears the dial's top altogether and the whole radius is free, while at
 * 0 m the statement's own depth reaches the centre line and none of it is.
 *
 * So this is not a licence taken against the clearance rule. It is the same
 * rule, evaluated against the shape the instrument actually has at the height
 * the statement actually sits at.
 *
 * ## The rhythm falls out of it
 *
 * The gain is a different number in every chapter, because the instrument's
 * size, its recede and the statement's own height all differ — 0px at the
 * ground, ~58 at 3 800 m, ~100 above 17 000. The stylesheet sizes the type from
 * the measure, so the chapters where the frame opens get a bigger statement
 * than the chapters where it does not, and the scale rhythm the direction asks
 * for is a consequence of the geometry rather than a table of exceptions.
 *
 * Sampled across the stage's settled range and reduced to the worst case, for
 * the same reason `copyRoom` is: a measure that tracked the instrument would be
 * visibly breathing.
 */
/**
 * Whether a chapter's statement is composed OVER the instrument rather than
 * beside it.
 *
 * The open frames — `field` and `arrival` — are the ones that can be, and the
 * centre rail is what makes them so: it is the one rail that leaves the copy no
 * side of the frame to take. Read by `statementRoom` for the measure and by
 * `measureComposition` for the vertical cap, which are the two halves of one
 * decision and must never disagree about it.
 */
export function overheadStatement(stage: StageId): boolean {
  const frame = SCENE[stage].frame;
  return (frame === 'field' || frame === 'arrival') && railOf(stage) === 'centre';
}

export function statementRoom(fit: Fit, stage: StageId): number {
  const room = copyRoom(fit, stage);
  if (room <= 0 || railLimit <= 0) return room;


  // THE CHAPTERS WHOSE STATEMENT STANDS ABOVE THE INSTRUMENT RATHER THAN
  // BESIDE IT — and the geometry decides which those are, not the frame name.
  //
  // `overhead` (below) is true for an open frame whose instrument is on the
  // CENTRE rail. That pairing is the whole condition, and both halves of it
  // matter:
  //
  //   * On a centre rail there is no side of the frame the copy can have, so a
  //     statement confined to a column is a 550px column in a 1 440px frame
  //     with the object it is about sitting in the other 890. The honest
  //     measure is the frame less its own margins, and the statement is held in
  //     the sky above the dial's top edge, which `--monument-cap` enforces.
  //
  //   * On a side rail the opposite is true. The dial is already out of the
  //     way laterally, the statement has 800px beside it, and taking the frame
  //     instead would buy fourteen pixels of width and cost the statement its
  //     whole height — measured on the system chapter at 1440×900, 89px capped
  //     against 173px uncapped, for a measure of 814px against 806.
  //
  // This is not a licence taken against §9's clearance rule. It is the same
  // rule, evaluated for the two ways a statement can be clear of a circle: over
  // the top of it, or beside it.
  if (overheadStatement(stage)) {
    const overhead = fit.vw * (1 - 2 * edgeMarginFraction(fit));
    statementOf.set(stage, overhead / Math.max(fit.vw, 1));
    return overhead;
  }

  // THE CURVATURE GAIN IS GONE, AND ITS ABSENCE IS THE POINT.
  //
  // This used to widen the measure by whatever the dial's curvature gave back
  // at the height the statement sat at: a circle's half-width at `k` radii above
  // its centre is only `sqrt(1 - k²)` of its radius, so a statement hanging high
  // in the sky band has more room beside it than the bounding box reserves.
  //
  // It is sound geometry and it was never once the binding term. Measured across
  // all eleven chapters at 1440×900, 1920×1080, 1280×800 and 1024×768, the reach
  // came out at or below `room` every time — because a statement at the monument
  // scale is tall enough that its lowest line reaches the dial's centre line,
  // where the curvature gives back exactly nothing.
  //
  // And it was a MEASUREMENT LOOP. The reach was solved from the statement's own
  // rendered height, which is solved from the measure, which is solved from the
  // reach: a taller statement got a narrower measure got a smaller size got a
  // shorter statement. Each pass converged a little — traced on WebKit, the
  // document settled through 21 041 → 18 861 → 18 837 → 18 813 → 18 794 over
  // successive frames — and a document whose height is still moving after the
  // first paint is a back navigation landing somewhere the visitor never was.
  // §33 rules out measurement feedback loops in as many words.
  //
  // So the measure is the room, less the guard below, and nothing here reads
  // anything the type it sizes can change. The two chapters whose statement
  // genuinely is clear of the dial take the whole frame instead, above, and
  // their vertical cap is solved from the eyebrow and the band's padding — both
  // of which are the same height whatever size the statement is set at.

  const width = Math.max(0, room - 24);
  statementOf.set(stage, width / Math.max(fit.vw, 1));
  return width;
}


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
/**
 * A yield to an object that is not in the picture is not a yield.
 *
 * Both presence rules below fade a band because the instrument is about to be
 * in the way of it. Nine chapters of eleven no longer have an instrument in
 * them (§32, and `SCENE_PRESENCE` in `scene.ts`), and the first production
 * capture of the six-act design showed exactly what that costs if nobody says
 * so: the two crossing chapters were composed, measured, laid out, and then
 * faded to zero opacity for a dial that had left eight thousand metres earlier.
 * Two entirely empty screens in the middle of the journey — §49's "no giant
 * dead stages", produced by the machinery that used to prevent them.
 *
 * Scaling the yield by the presence rather than switching it off keeps every
 * property the yield had: it is continuous, it is a pure function of the
 * altitude and the viewport, and forward and reverse traversal stay identical.
 * At presence 1 the rule is exactly what it was; at 0 the band holds.
 */
const yieldTo = (metres: number, value: number) =>
  1 - instrumentPresenceAt(progressAt(metres)) * (1 - value);

export function copyPresence(stage: StageId, metres: number, recede: number): number {
  const budget = roomOf.get(stage) ?? 0;
  if (budget <= 0 || railLimit <= 0) return 1;
  const half = essentialWidthAt(fit, metres, recede) / 2;
  const centre = railAt(metres);
  const live = COPY_OF[stage] === 1 ? 1 - centre - half : centre - half;
  return yieldTo(metres, ease(clamp((live / budget - 0.9) / 0.1)));
}

/**
 * The same yield, for a statement that hangs above the instrument.
 *
 * ## Why the horizontal rule is not the whole rule any more
 *
 * `copyPresence` is a measure of *lateral* room, and it was the whole story
 * while every chapter's copy was a block centred in a panel: the column crossed
 * the instrument's own centre line, so the only question was whether there was
 * width for it beside the dial.
 *
 * The reverse-gravity composition hangs a chapter's statement from the sky
 * band, which on every viewport in the matrix is *above* the instrument's
 * projected silhouette for most of the journey — measured at 1440×900 and
 * 17 000 m, the lead band spans 162–343px against a dial spanning 350–550. A
 * rule that yields a box which is nowhere near the object it is yielding to
 * costs the page the one thing this direction is for: at every boundary where
 * the instrument changes rail, the incoming statement was faded out for the
 * nine tenths of a screen during which it is supposed to be arriving overhead,
 * and the frame at 17 000 m contained no copy at all — which is precisely the
 * defect the composition was rebuilt to remove, reintroduced by the fix for a
 * different one.
 *
 * ## The rule
 *
 * Take the lateral yield, and release it in proportion to how far the band is
 * clear of the instrument vertically. Fully clear, the statement holds at full
 * presence through the crossing; overlapping, it yields exactly as it did
 * before. Both terms are pure functions of `(altitude, viewport)`, so this
 * inherits §7's forward/reverse equality rather than needing its own argument
 * for it.
 *
 * The 24px ramp is the same order as the visual safety margin the validator
 * expands the instrument's bounds by, so the release completes only once the
 * band is clear by more than the tolerance the check is written against.
 */
export function leadPresence(stage: StageId, metres: number, liveRecede: number): number {
  const lead = leadOf.get(stage) ?? 0;
  if (lead <= 0 || railLimit <= 0) return 1;

  // THE LARGER OF THE TWO INSTRUMENTS, ALWAYS.
  //
  // `setLiveRecede`'s note is exact about the asymmetry: during a scroll the
  // damped recede trails the analytic target, and it trails it LARGE — the
  // instrument is still at the size it is leaving. For SIZING a band that is
  // the conservative direction and the band uses it. For YIELDING a statement
  // it is the wrong one, because a recede that is momentarily too large makes
  // the dial look smaller than it is and holds the statement a frame longer
  // than it should be held.
  //
  // The symptom was a check that failed in a different place on every run:
  // 10–35px of display line on the dial at 280 m, or at 11 500, or at 6 312,
  // depending on where the damping happened to be when the sample was taken.
  // Taking the smaller recede — the larger dial — makes the yield a function of
  // the altitude again rather than of the scroll velocity, which is what §7
  // asks of everything in this module.
  // WITHOUT THE SCENE TERM, and that is the second half of the same argument.
  //
  // `sceneRecedeAt` is authored art direction: it pushes the instrument back
  // because the chapter wants the statement to be the subject. Letting the
  // yield see it means the statement is budgeted against a smaller dial than
  // the one the check measures whenever the two are a frame apart — at 11 560 m
  // the scene term is 0.27 of the way to the far recede, which is 46px of dial
  // radius, and 46px is the whole of the residual collision the check reports
  // there.
  //
  // So the yield is solved against the NARRATIVE recede alone — the round trip
  // that was always here — or against the live value, whichever describes the
  // larger object. Never against a dial smaller than the one that might be
  // drawn.
  const narrative = narrativeRecede(metres, smoothRange(metres, ALTITUDE_STOPS.thirdRing, ALTITUDE_STOPS.meridian));
  const recede = Math.min(liveRecede, narrative);

  // The same visual safety margin the validator expands the instrument by
  // before it tests for a collision, tripled so that the yield is complete
  // rather than beginning at the moment of contact.
  //
  // Three rather than two, and the third one is the damping. The budget this is
  // compared against is solved at the analytic recede; the instrument is drawn
  // at the damped one, which during a scroll trails it LARGE. Doubled, the fade
  // finished exactly as the two met and the lag put 21px of "emelkedtünk" on
  // the dial at 11 560 m. Tripled, it finishes a margin early — which on a
  // 40px band is a tenth of a screen of scroll, and is the direction the error
  // has to be in.
  const guard = Math.max(8, Math.min(fit.vw, fit.vh) * 0.015) * 3;

  // The dial's projected radius, and how far the statement's own lowest line
  // sits above its centre — the instrument rides the camera's height, so its
  // centre is the frame's.
  const height = projectedEssentialHeight(fit, metres, recede);
  const radius = height / 2;
  const band = skyBandOf(stage, fit.vh);
  const bottom = band + lead;
  const above = clamp((fit.vh / 2 - bottom) / Math.max(radius, 1));

  // AN OVERHEAD STATEMENT IS TESTED VERTICALLY, BECAUSE THAT IS WHERE IT IS.
  //
  // `field` and `arrival` chapters on the centre rail take the whole frame for
  // their statement and hold it above the dial's top edge; `--monument-cap`
  // sizes them so that is true at the altitudes they are read at. Asking the
  // lateral question there compares a full-frame measure against the room
  // beside a centred object, finds it under half, and yields the statement to
  // zero for the entire chapter — measured at 28 600 m, where the stratosphere
  // frame held one grey paragraph and no headline.
  //
  // What it does have to yield to is the APPROACH. A statement is already
  // hanging 0.18 screens before its own chapter, and there the instrument is
  // still on the previous chapter's rail at the previous chapter's size — at
  // 27 500 m, 232px of "Üdv a sztratoszférában." across a dial the cap was
  // never solved against. So the test is the clearance itself: full presence
  // once the band's bottom is a guard clear of the dial's top, nothing while it
  // is not.
  if (overheadStatement(stage)) {
    // THE STATEMENT'S OWN BOTTOM, not the band's.
    //
    // `--monument-cap` sizes an overhead statement so that the eyebrow plus the
    // headline clear the dial's top edge. The BAND also carries whatever the
    // chapter puts under its headline — on the stratosphere that is a line and
    // an annotation, 495px against the statement's own 283 — so a clearance test
    // against the band asks whether a box two hundred pixels taller than the one
    // that was sized clears the object it was sized against. It does not, at any
    // altitude, and the statement was hidden for the whole chapter: measured at
    // 28 600 m, the frame held the instrument, the earth's limb and no headline.
    // WHERE THE STATEMENT ACTUALLY IS, including the approach.
    //
    // A chapter's statement is pinned in the sky band only once the chapter's
    // own top has reached it. For the 0.18 screens before that it is NOT pinned:
    // it sits at its natural position inside a panel whose top is still below
    // the fold, which puts it `-pass × panelH` lower in the frame — a third of
    // the way down it, over the instrument, while its own chapter is still
    // approaching.
    //
    // Adding that term makes this a test of where the statement is rather than
    // of where it will be, which is what the opacity ramp was standing in for.
    // Measured at 1024×768 and 27 808 m, the last 3px of the stratosphere
    // statement on the dial with the ramp doing all the work; here it is
    // geometry.
    const bounds = STAGE_BOUNDS.find((x) => x.id === stage);
    const span = bounds ? bounds.end - bounds.start : 1;
    const pass = bounds && span > 0 ? (progressAt(metres) - bounds.start) / span : 0;
    const approach = pass < 0 ? -pass * (panelOf.get(stage) ?? fit.vh) : 0;
    const statementBottom =
      band + (hangOf.get(stage) ?? lead) + PASS_DRIFT_OVERHEAD * fit.vh + approach;
    // Full presence at zero clearance, gone one guard INSIDE the dial — the same
    // shape as the lateral test below, and the reason it has to be that shape
    // is that `--monument-cap` has already spent the safety margin.
    //
    // The cap sizes the statement so its lowest line clears the dial's top by
    // the validator's own margin at the chapter's settled altitudes. A presence
    // test that then demanded a further guard of clearance before showing
    // anything was asking for the margin twice, and the two budgets cancelled:
    // measured at 28 600 and 30 000 m, the two colossus statements were sized
    // correctly, positioned correctly and rendered at a tenth of their opacity.
    //
    // What is left for this to catch is the APPROACH — a statement hangs 0.18
    // screens before its own chapter, where the instrument is still on the
    // previous chapter's rail at the previous chapter's size, and the cap was
    // never solved against that.
    // AGAINST THE INSTRUMENT AS DRAWN, not against the conservative one.
    //
    // The narrative-only recede below is the right conservative choice for the
    // lateral yield: there the question is whether a statement standing beside
    // the dial has lost its room, and answering it against a dial that is never
    // smaller than the drawn one errs toward yielding. Here the question is
    // whether a statement standing ABOVE the dial clears its top edge, and the
    // same substitution errs the other way — it inflates the object by the whole
    // scene recede (0.55 at `trace`) and no overhead statement can ever clear a
    // dial half again as large as the one on screen. Measured at 28 600 m: a
    // statement sized, placed and positioned correctly, rendered at 3%.
    const drawn = projectedEssentialHeight(fit, metres, liveRecede) / 2;
    return ease(clamp((fit.vh / 2 - drawn - statementBottom + guard) / guard));
  }

  // ---------------------------------------------------------------- lateral
  //
  // Everywhere else the statement stands BESIDE the instrument, and the
  // question is the one `statementRoom` budgeted: how much room is there on the
  // copy's side of the dial, at the height the statement actually occupies.
  //
  // ## Why the half-width is taken at the statement's own height
  //
  // The dial is a circle. Its bounding box is widest across its centre line,
  // and the statement is not there — it hangs in the sky band above it, where
  // the circle has already curved away. `statementRoom` budgets against that
  // curvature, so a live test that used the bounding box instead would be
  // comparing two different measurements and would yield a statement that has
  // not lost any room at all.
  //
  // ## Why the fade completes over a fixed distance
  //
  // `copyPresence` fades the column over the last tenth of its budget, which is
  // the right shape for a column: a tenth of a 470px measure is 47px of prose,
  // and prose that is 47px narrower than it was laid out for reflows rather
  // than collides.
  //
  // A statement does not reflow. A tenth of an 785px display measure is 78px of
  // the instrument standing in the last word — "emelkedtünk" over the dial at
  // 11 600 m, at nine tenths opacity, which the check counts as a collision and
  // so does the eye. So this completes over the guard instead: full presence
  // while the measure is intact, gone by the time the instrument is one guard
  // into it, whatever the measure happens to be.
  const budget = statementOf.get(stage) ?? 0;
  if (budget <= 0) return copyPresence(stage, metres, recede);
  const halfHere = (essentialWidthAt(fit, metres, recede) / 2) * Math.sqrt(Math.max(0, 1 - above * above));
  const centre = railAt(metres);
  const live = COPY_OF[stage] === 1 ? 1 - centre - halfHere : centre - halfHere;
  return yieldTo(metres, ease(clamp(((live - budget) * fit.vw + guard) / guard)));
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


/**
 * THE WORD CAP — the largest size at which a statement's longest word still
 * fits its measure.
 *
 * ## The failure this removes
 *
 * `overflow-wrap: break-word` is inherited from the panel and is right for
 * prose: a long compound in a narrow column should break rather than overflow.
 * Applied to a display line it is a fault, and it looks like one. At 92px in a
 * 408px measure the opening set as "weboldalak / at építünk." and
 * "Magasság / ot építünk." — two valid break points, and at that size the line
 * is read as an image before it is read as words, so a word broken across two
 * of them reads as a rendering error.
 *
 * The old answer was a ceiling per tier, hand-tuned against Hungarian at 1440,
 * which is a number that is wrong in German, wrong at 1024 and wrong the day
 * the copy changes. This is the same question asked of the actual glyphs: how
 * wide is this chapter's longest word in this locale in this face, and what
 * size makes it fit.
 *
 * ## Why it is measured here rather than solved in CSS
 *
 * CSS has no way to ask how wide a word is. `min-content` comes close and is
 * the wrong shape — it sizes the BOX to the longest word, which is a narrower
 * box, not a smaller face.
 *
 * One hidden span, reused for every panel, measured inside the same
 * read-after-write batch the rest of the pass uses, on resize only.
 */
function wordCapOf(title: HTMLElement, probe: HTMLElement, whole: boolean): number {
  // Text nodes joined with spaces rather than `textContent`, because a
  // statement is authored as `a` + <br> + <em> + `b` and `textContent`
  // concatenates across the break: the opening's longest "word" measured as
  // "építünk.Magasságot", 8.3 em of something nobody will ever have to fit.
  const words: string[] = [];
  const walk = document.createTreeWalker(title, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    for (const w of (n.textContent ?? '').split(/\s+/)) if (w) words.push(w);
  }
  if (!words.length) return Infinity;

  const cs = getComputedStyle(title);
  probe.style.font = `${cs.fontStyle} ${cs.fontWeight} 100px/1 ${cs.fontFamily}`;
  // TRACKING IN `em`, NOT IN THE PIXELS IT CURRENTLY RESOLVES TO.
  //
  // `getComputedStyle().letterSpacing` is an absolute length: `-0.05em` on a
  // 148px display line comes back as `-7.4px`. Applied to a probe rendering at
  // 100px that is 7.4 pixels of negative tracking per character on a font that
  // should be getting 5 — the probe measures the line ~4% narrower than it will
  // be set, the cap is 4% generous, and a statement authored as one line comes
  // back as three.
  //
  // Converted to `em` it resolves against the probe's own size and the
  // measurement is scale-free, which is the whole premise of measuring at 100px
  // and dividing.
  const tracking = parseFloat(cs.letterSpacing);
  const size = parseFloat(cs.fontSize) || 1;
  probe.style.letterSpacing = Number.isFinite(tracking) ? `${tracking / size}em` : 'normal';

  let widest = 0;
  if (whole) {
    // A ONE-LINE CHAPTER IS CAPPED BY THE WHOLE LINE, NOT BY ITS LONGEST WORD.
    //
    // The two overhead statements are authored as a single full-frame line —
    // `lines: 1` in the scene table — and for those the question is not "does
    // the longest word fit", it is "does the sentence fit". A word cap lets the
    // size run to where the sentence wraps, and the second line then descends
    // into the instrument the vertical cap was solved to clear.
    //
    // ## Measured on the ELEMENT, not on the probe
    //
    // The probe is a bare span with the title's font on it, and for a run of
    // words that is exact. It is not exact for this page's statements, because
    // three of them carry `data-kinetic` and `kineticType` rewrites those into
    // per-character spans — real boxes, with their own rounding. Measured at
    // 1440, the probe said the stratosphere line fitted at 138px and the line
    // breaker made it three lines.
    //
    // `white-space: nowrap` and `scrollWidth` asks the actual element, with
    // whatever it actually contains, how wide it wants to be on one line. It is
    // one write and one read inside a batch that is already doing both, and it
    // is restored before anything else reads the box.
    // A CLONE, at a known size, off to the side.
    //
    // Two things this cannot be. It cannot be the probe span with the text in
    // it, because `kineticType` rewrites three of these statements into
    // per-character spans and the probe would measure a string the page does
    // not contain. And it cannot be `scrollWidth` on the element itself with
    // `nowrap`: the arrival statement is centred, a centred box overflows in
    // both directions, and `scrollWidth` reports only the right-hand overflow —
    // which measured 713px of a 1 272px line and drove the size down to 48px on
    // one pass and lower on the next, because every measurement fed the one
    // after it.
    //
    // The clone carries the real markup, at 100px, tracked in `em` so the
    // tracking scales with it, in a `max-content` box where nothing wraps and
    // nothing is centred.
    const clone = title.cloneNode(true) as HTMLElement;
    clone.style.cssText =
      `position:absolute;left:-9999px;top:0;white-space:nowrap;width:max-content;visibility:hidden;` +
      `font:${cs.fontStyle} ${cs.fontWeight} 100px/1 ${cs.fontFamily};` +
      `letter-spacing:${Number.isFinite(tracking) ? `${tracking / size}em` : 'normal'};max-width:none`;
    // AT THE WIDEST KINETIC STATE, because that is the state the line has to fit.
    //
    // Three of these statements carry a `data-kinetic` anchor whose variable
    // font axes move with altitude — `reserveKinetic` already measures the host
    // at its widest settings and reserves a `min-height` for it, for exactly the
    // same reason. A one-line cap solved against the CURRENT axes is a cap the
    // line clears now and breaks under later, and "later" is a scroll position
    // rather than an event, so it would look like a rendering fault that comes
    // and goes.
    const anchor = clone.querySelector<HTMLElement>(`[${KINETIC_ATTR}]`);
    const anchorId = anchor?.getAttribute(KINETIC_ATTR) as KineticAnchorId | null;
    if (anchor && anchorId && anchorId !== 'altitude-readout') {
      const at = widestSettings(anchorId);
      anchor.style.fontWeight = String(at.weight);
      anchor.style.fontStretch = `${at.width}%`;
      anchor.style.letterSpacing = `${at.tracking}em`;
    }
    document.body.appendChild(clone);
    widest = clone.getBoundingClientRect().width;
    clone.remove();
  } else {
    for (const w of words) {
      probe.textContent = w;
      widest = Math.max(widest, probe.getBoundingClientRect().width);
    }
  }
  if (widest <= 0) return Infinity;
  // The measure the word actually has to fit, read off the box rather than
  // taken from `--statement-w`.
  //
  // They are not the same number and the difference is not a rounding: the
  // title's box is `--statement-w` less the panel's own inline inset — 64px at
  // 1440 — because the band adds its own padding back and the title sits inside
  // that. Solving the cap against the intent rather than against the box made
  // it 8% generous, which is exactly the margin a word needs to break in.
  //
  // Reading it here is not circular: the box is `min(100%, --statement-w)` and
  // neither term depends on the font size this is about to bound.
  const measure = title.clientWidth;
  if (measure <= 0) return Infinity;
  // A four per cent margin, and it is the line breaker rather than arithmetic.
  //
  // The measurement is of a `max-content` box; the real line is laid out by the
  // breaker into a constrained one, with `text-wrap: pretty` allowed to move a
  // word rather than leave a bad rag, and with the kinetic per-character spans
  // rounding at every one of their own edges. A cap that lands exactly on the
  // computed wrap point wraps anyway about half the time — measured on the
  // stratosphere statement at 1440, 124px fitted on paper and set as two lines.
  //
  // Four per cent of a 124px display line is five pixels of size, and it is the
  // difference between a statement authored as one line being one line and
  // being two.
  return (measure * 96) / widest;
}

/**
 * The eyebrow's own height, in CSS pixels, as the monument cap budgets for it.
 *
 * A constant rather than a measurement, and deliberately: it is one line of the
 * data face at a fixed size with a fixed margin under it — the one box on this
 * page that genuinely does not vary with the locale, the chapter or the
 * viewport — and measuring it per panel would add a read to a function that is
 * already careful to do all its writes before all its reads.
 */
const EYEBROW_H = 44;

/**
 * The same descent, for a chapter whose statement hangs directly OVER the
 * instrument rather than beside it.
 *
 * 9svh is 81px, and for a statement standing next to the dial that is exactly
 * the slow, quiet downward motion the reverse-gravity grammar is for — it moves
 * through empty sky. For an overhead statement it is 81px walked straight into
 * the object: the clearance is solved once, at the top of the chapter, and then
 * spent. Measured on the two summit chapters, the last 20px of a 102px display
 * line ended on the dial's upper edge at the middle of the chapter.
 *
 * A third of the distance. The motion is still there and still downward — which
 * is what the direction asks the composition to keep — and the clearance holds
 * for the whole chapter rather than for its first frame. Mirrored in
 * `styles.css` on `[data-overhead='1']`; the two must agree.
 */
const PASS_DRIFT_OVERHEAD = 0.03;

/** The smallest flow band worth compositing into. Below it, the panel flows. */
const MIN_FLOW_BAND = 120;

/**
 * How far below the top of the plate a stage's first meaningful content begins.
 *
 * §6's budget is 8-14svh, with headroom to ~18svh where a transition visibly
 * earns it - the instrument line under the header is such an element, and it is
 * what the headroom is spent on. Bounded in pixels at both ends because 10svh is
 * 56px on a small phone, which is less than the header it has to clear, and 93px
 * on a tall one, which is wide enough to read as another void.
 *
 * Floored at `--deck-content`, published by `watchDeck` from the header's and
 * the strip's measured boxes. That floor is how §10's single top-layout
 * calculation reaches the panels: the narrative cannot begin inside the deck,
 * whatever the header state or the safe-area inset happens to be.
 *
 * ## Why this is computed here and not in CSS
 *
 * It was in CSS, as `max(clamp(64px, 10svh, 96px), var(--deck-content))`, which
 * is a perfectly good declaration the layout still uses. What it cannot do is
 * take part in the *decision* below. `measureComposition` has to know whether
 * the lead band still fits above the instrument once the entry budget is
 * subtracted, and a custom property does not resolve to a length script can read
 * - `getPropertyValue` hands back the token stream, not pixels. Two expressions
 * of one number is exactly the drift this file warns about elsewhere, so the
 * number is computed once here and published for the stylesheet to consume.
 *
 * ## Quantised, because it decides rather than describes
 *
 * `--deck-content` is already quantised to 8px at source (see DECK_STEP in
 * siteHeader.ts) and this rounds again for the same reason: the value feeds a
 * *decision*, and a decision that changes with a pixel of measurement noise
 * flips a panel between two compositions whose boxes differ by a screen. Both
 * guards are cheap and either alone would do; keeping both means neither file
 * has to know the other is careful.
 */
/**
 * The sky band: how far down the frame a chapter's statement hangs, in CSS
 * pixels.
 *
 * The reverse-gravity composition's one position, and it is computed here for
 * the same reason `entryBudget` is — the stylesheet needs it as a length and
 * `publishComposition` needs it as a number, and two expressions of one number
 * is the drift this file warns about in four other places. It is published as
 * `--sky-band` and the stylesheet reads it back.
 *
 * §2 of the direction asks for major copy between 20% and 45% of the viewport.
 * 18% is the top of that range and the headline occupies the rest of it —
 * measured at 1440×900 the hero's first line lands at 18% and its last at 39%.
 *
 * Bounded in pixels at both ends. 18svh is 152px on a 844-tall phone in
 * landscape, which is most of the frame, and 259px on a 1440-tall desktop,
 * which is a void. The floor clears the header's tallest state.
 *
 * Quantised to 4px, and for the same reason `entryBudget` quantises: it decides
 * where a sticky box sits, and a value that changed with a pixel of measurement
 * noise would step the whole chapter down the frame mid-scroll.
 */
export function skyBand(vh: number): number {
  return Math.round(Math.max(104, Math.min(0.18 * vh, 168)) / 4) * 4;
}

/**
 * THE LIFTED DECK — where a chapter's statement hangs, per frame.
 *
 * The band above is the general answer and it is right for the three frames
 * whose statement stands BESIDE the instrument: there the statement's height is
 * bounded by the column, not by the sky, and 18svh is the top of the 20–45% of
 * viewport §2 asks major copy to occupy.
 *
 * `field` and `arrival` are the two frames whose statement stands ABOVE the
 * instrument, and there the same 18svh is the difference between a monument and
 * a headline. The statement's size is capped by the sky between the deck and
 * the dial's top edge — see `--monument-cap` — and on a 1440×900 at 17 000 m
 * that sky is 144px with the standard band and 216px with this one. Divided by
 * two authored lines and the colossus leading, that is 83px against 124px:
 * the same chapter, the same instrument, the same copy, and the difference
 * between it reading as a large heading and reading as the scene.
 *
 * 0.58 rather than a second constant, so the two bands cannot drift apart: this
 * is always a fixed proportion of the band everything else on the page uses,
 * and the floor is the header's tallest state, which no composition may put
 * copy inside.
 *
 * Published per panel by `measureComposition`, so the stylesheet's `--sky-band`
 * and every calculation here read one number for a given chapter.
 */
export function skyBandOf(stage: StageId, vh: number): number {
  const frame = SCENE[stage]?.frame;
  if (frame !== 'field' && frame !== 'arrival') return skyBand(vh);
  return Math.round(Math.max(96, 0.58 * skyBand(vh)) / 4) * 4;
}

/**
 * The gap between a chapter's statement and its detail, in CSS pixels.
 *
 * One number, here, because three things have to agree about it: the stylesheet
 * that draws it, the `whole`/`lead` decision that has to know whether the column
 * fits in a frame, and `--col-h`, which the motion grammar measures the pinned
 * range against. It is the sum of the lead band's bottom padding, the flow
 * band's top margin and the flow band's top padding, at the middle of their
 * clamps — see `.panel__band--flow` in styles.css.
 */
const FLOW_GAP = 40;

/**
 * HOW FAR BELOW ITS STATEMENT A CHAPTER'S DETAIL BEGINS, IN CSS PIXELS.
 *
 * This was a `clamp()` in the stylesheet, and it had to move for the same
 * reason `entryBudget` and `skyBand` did: two things now have to agree about
 * it. The stylesheet lays the detail out with it, and `contactPass` below
 * solves the exact scroll position at which that detail reaches the statement —
 * which is the moment the statement has to have finished dissolving. Two
 * expressions of one number is the drift this file warns about in five other
 * places, so there is one, here.
 *
 * ## Why a held statement is given more of it
 *
 * A `monument` or a `colossus` on a chapter whose detail cannot be pinned is
 * HELD — see the hold in styles.css — because the chapter is about its
 * statement and a statement that leaves a third of a screen in leaves four
 * screens of sky behind it. The hold is authored in screens; the separation
 * decides when the detail arrives. Authored at 0.34 screens against a hold of
 * 1.3, the detail reached the statement roughly half a screen before the
 * statement began to go, and the two were printed through each other:
 * "Hat terület, egy rendszer." over its own lead paragraph at 3 600 m, and the
 * same fault at 6 700, 13 400 and 18 400.
 *
 * The fix is not to shorten the hold — that is §20's frame going back to being
 * empty — it is to put the detail where the hold says it should be. So a held
 * chapter asks for the larger separation, which is also the composition the
 * direction asks for in as many words: the statement owns the opening frame
 * outright and the detail enters LOW beneath it.
 *
 * Bounded by the room the chapter already has, exactly as the `clamp()` was:
 * the separation may never make a panel taller, because it is applied from a
 * measured height and therefore lands one frame after the first paint. A margin
 * that could extend a panel would make the document one height on the first
 * frame and another on the second, which on WebKit is a back navigation landing
 * hundreds of pixels short.
 */
/**
 * THE HOLD, IN SCREENS — the one number the separation is solved against.
 *
 * Restated from the stylesheet's `--leave-from`, which is where the gesture is
 * authored. A `monument` or a `colossus` whose detail cannot be pinned owns its
 * chapter's opening outright for this long, and the separation below exists to
 * make that literally true rather than nominally true.
 */
const HOLD_SCREENS = 1.3;

/** How far `--pass-drift` walks a statement down its own chapter, as a fraction
 *  of the frame. Two values because an overhead statement drifts less — see
 *  `--pass-drift` in styles.css, which is where both are authored. */
const driftOf = (stage: StageId) => (overheadStatement(stage) ? 0.03 : 0.09) * fit.vh;

export function flowSeparation(
  stage: StageId,
  held: boolean,
  bandTop: number,
  leadH: number,
  hangH: number,
  flowH: number,
  panelH: number,
): number {
  // `clamp(0.5rem, 1.2vh, 1rem)` — the floor, for a chapter with no room at all.
  const min = Math.max(8, Math.min(0.012 * fit.vh, 16));
  // What is left of the chapter once the deck, the statement and the detail
  // itself have taken their share. The 48 is the 3rem tail: a chapter that spent
  // its last pixel here would end flush against the next one.
  const room = panelH - skyBandOf(stage, fit.vh) - leadH - flowH - 48;
  // A chapter that is not held keeps the separation it always had: a third of a
  // screen, which is the distance over which its statement dissolves.
  const want = held
    ? // THE SEPARATION THAT MAKES THE HOLD TRUE.
      //
      // Invert `contactPass`. The detail must not reach the statement before the
      // hold is over, so put it exactly `HOLD_SCREENS` of scroll away — statement
      // height, deck and drift all included, because all three are between the
      // two boxes.
      HOLD_SCREENS * fit.vh - bandTop - leadH + skyBandOf(stage, fit.vh) + hangH + driftOf(stage)
    : 0.34 * fit.vh;
  return Math.round(Math.max(min, Math.min(want, Math.max(min, room))));
}

/**
 * The chapter progress at which the climbing detail reaches the held statement.
 *
 * The one number the hold was missing. Everything in it is already measured:
 *
 *   panelTop, in viewport pixels, is `-pass × panelH` — the lead band pins
 *   exactly when the panel's top would rise above the deck, which is what makes
 *   `--upcoming` 0.18 screens and is the same identity read backwards.
 *
 *   the detail's top is `bandTop + leadH + separation` below the panel's top,
 *   because it is ordinary flow content under a sticky box that still occupies
 *   its flow space.
 *
 *   the statement's bottom is `skyBand + hangH` down the frame while it is
 *   pinned, plus whatever `--pass-drift` has walked it down by the end of the
 *   chapter — taken at its worst, because the collision has to be impossible
 *   rather than unlikely.
 *
 * Setting the two equal and solving for `pass` gives the contact. The stylesheet
 * takes the statement off the frame by then.
 *
 * WHY IT IS PUBLISHED AS WELL AS SOLVED FOR. `flowSeparation` asks for the
 * separation that would put this at the authored hold, and a chapter whose
 * detail is taller than its own frame cannot be given it — the separation is
 * bounded by the room the chapter has, and on the Rapidkert feature and the
 * capability ladder the bound binds. So the hold is whatever the geometry
 * actually delivered, reported back rather than assumed: a shorter hold on a
 * dense chapter is a composition, and a statement printed through its own
 * detail is not.
 *
 * PUBLISHED, BUT IT DRIVES NOTHING THAT HAS A BOX. `--contact` reaches exactly
 * one declaration — `--leave-from`, an opacity and blur ramp — so a value that
 * is a frame stale or a few pixels out changes how quickly a statement
 * dissolves and can never change the height of the document. That is the
 * property that lets it be measured at all.
 */
export function contactPass(
  stage: StageId,
  bandTop: number,
  leadH: number,
  hangH: number,
  separation: number,
  panelH: number,
): number {
  if (panelH <= 0) return 1;
  const detailTop = bandTop + leadH + separation;
  const statementBottom = skyBandOf(stage, fit.vh) + hangH + driftOf(stage);
  return (detailTop - statementBottom) / panelH;
}

/**
 * Each panel's measured STATEMENT bottom, as an offset from the top of its lead
 * band — the eyebrow plus the headline, and nothing under them.
 *
 * A different number from the band's own height, and much smaller on the
 * chapters whose lead also carries a line, two calls to action and an
 * annotation. Both are needed and they answer different questions: the band's
 * height decides when the sticky range ends, and this decides where the
 * statement is in the frame.
 */
const hangOf = new Map<StageId, number>();

/**
 * Each panel's measured height, in CSS pixels — `--panel-h`, kept for the one
 * calculation that needs it outside the stylesheet.
 *
 * A chapter's statement is pinned in the sky band only once the chapter's own
 * top has reached it. Before that the band sits at its natural position inside
 * a panel whose top is still below the fold, and how far below is exactly
 * `-pass × panelH`.
 */
const panelOf = new Map<StageId, number>();

/**
 * Each panel's measured lead-band height, kept from the measurement pass.
 *
 * `publishComposition` needs it to decide whether a chapter's statement is
 * clear of the instrument *vertically* — see `leadPresence` — and it runs on a
 * frame, where it may not measure anything.
 */
const leadOf = new Map<StageId, number>();

function entryBudget(vh: number): number {
  const design = Math.max(64, Math.min(0.1 * vh, 96));
  const deck = parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue('--deck-content')
  );
  const raw = Math.max(design, Number.isFinite(deck) ? deck : 0);
  return Math.ceil(raw / 8) * 8;
}

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

  // How far the readout may travel from the centre before it meets the inset.
  //
  // Measured from the rendered box rather than assumed, because the readout's
  // width is a fact about the locale — a German stage name is not a Hungarian
  // one — and a travel authored against one of them overshoots on the other.
  //
  // Published for BOTH layouts now, and the reason is the sky band. The stack
  // used to sit in the bottom-left corner unconditionally, which was safe while
  // every chapter's copy was a block centred in the middle of the frame: at the
  // bottom-left there was nothing but sky. The reverse-gravity composition hangs
  // the copy from the top and lets its detail run down the column, so on the six
  // chapters whose copy is on the left the readout is now underneath a paragraph
  // — photographed at 13 317 m, the altitude printed through the Rapidkert
  // result. The strip already solved this by tracking to the side the copy is
  // not on; the stack now uses the same measurement and the same property.
  const inset = Math.max(20, Math.min(fit.vw * 0.04, 56));
  root.style.setProperty('--hud-travel', `${Math.max(0, Math.floor((fit.vw - box.width) / 2 - inset))}px`);
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

  // Written HERE, before anything is measured, and that ordering is
  // load-bearing.
  //
  // It used to be written at the end of this function, next to
  // `data-composition`, which was harmless while the attribute only selected
  // the copy column's width and side — neither of which the measurement below
  // reads. It stopped being harmless when the reverse-gravity composition put
  // the lead band's padding behind the same attribute: on the FIRST measurement
  // the attribute is not there yet, so the band is measured without its own
  // padding, and `--lead-h` — which decides where the statement has to have
  // faded out by — comes back ~67px short on every panel until something
  // triggers a second pass.
  //
  // The measurement is of the composition, so the composition has to be in
  // force before it is taken.
  if (railLimit > 0) root.dataset.rails = 'on';
  else delete root.dataset.rails;
  root.dataset.composition = fit.portrait ? 'portrait' : 'landscape';

  roomOf.clear();
  statementOf.clear();
  hangOf.clear();
  panelOf.clear();
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
    // How far down the lead band the STATEMENT ends — the eyebrow plus the
    // headline, and nothing under it.
    //
    // `statementRoom` budgets the display measure against the dial's half-width
    // *at the height the statement sits at*, and the dial is a circle: the
    // higher the statement's lowest line, the less of the frame the dial
    // occupies beside it. Passing the whole band's height instead answered that
    // question about the wrong box. On the opening the band also carries the
    // line, two calls to action and an annotation — 345px against the
    // statement's own 200 — so the measure was solved as though the headline
    // reached the dial's centre line, where the dial is at its widest and the
    // gain is exactly zero. Every chapter with anything under its headline was
    // budgeted the same way.
    hangH: (() => {
      const band = panel.querySelector<HTMLElement>('.panel__band--lead');
      const title = panel.querySelector<HTMLElement>('.panel__title');
      if (!band || !title) return 0;
      return title.getBoundingClientRect().bottom - band.getBoundingClientRect().top;
    })(),
    // Everything above the statement inside the band — the band's own top
    // padding and the eyebrow — measured rather than assumed.
    //
    // It was a 44px constant, on the argument that an eyebrow is one line of the
    // data face at a fixed size and does not vary. The line does not; the box
    // around it does. The band's top padding is a `1.9vh` clamp and the eyebrow
    // carries a margin, so the real offset is 61px at 900 and the cap was
    // solved 17px generous — which at the top of the colossus ramp is most of a
    // line's descender on the instrument.
    aboveH: (() => {
      const band = panel.querySelector<HTMLElement>('.panel__band--lead');
      const title = panel.querySelector<HTMLElement>('.panel__title');
      if (!band || !title) return EYEBROW_H;
      return Math.max(0, title.getBoundingClientRect().top - band.getBoundingClientRect().top);
    })(),
    // Where the lead band's FLOW POSITION is inside its own panel.
    //
    // Not `band.getBoundingClientRect().top`, and the difference is the whole
    // measurement. The lead band is `position: sticky`, and a sticky box's
    // client rect is where it is STUCK, not where it lays out — so that reading
    // is a function of the scroll position at the instant the pass happens to
    // run. Measured twice on the same viewport it answered 0.197 and 0.397 for
    // the same chapter, which for a value that decides when a statement
    // dissolves is not a measurement at all.
    //
    // The band is the first child of the inner column and the inner column is
    // static on every chapter this is consumed by (`data-hang='lead'` — the
    // `whole` branch is the one that makes the inner sticky, and it publishes no
    // contact). So its flow top is the inner's content top, which is two boxes
    // that do lay out: the inner's own offset in the panel, plus its top
    // padding.
    //
    // Bounded, because it is an origin rather than a magnitude: a quarter of the
    // frame of panel padding is already more than any composition here uses, and
    // a wrong large value would move the dissolve by a fifth of a chapter.
    bandTop: (() => {
      const inner = panel.querySelector<HTMLElement>('.panel__inner');
      if (!inner) return 0;
      const pad = parseFloat(getComputedStyle(inner).paddingBlockStart);
      const top =
        inner.getBoundingClientRect().top -
        panel.getBoundingClientRect().top +
        (Number.isFinite(pad) ? pad : 0);
      return Math.max(0, Math.min(top, 0.25 * fit.vh));
    })(),
    flowH: panel.querySelector<HTMLElement>('.panel__band-inner')?.getBoundingClientRect().height ?? 0,
    // The chapter's real height. Under the rails a panel is no longer
    // `--share` screens tall — see the air cap in styles.css — so a stylesheet
    // that derived "one screen, as a fraction of this chapter" from `--share`
    // would be describing a box that is not there.
    panelH: panel.getBoundingClientRect().height,
  }));

  for (const band of bands) if (band) band.style.removeProperty('display');

  // One probe for every panel's word cap. Created before the loop and removed
  // after it, so the pass adds one element to the document rather than eleven.
  const probe = document.createElement('span');
  probe.style.cssText =
    'position:absolute;left:-9999px;top:0;white-space:pre;visibility:hidden;pointer-events:none';
  document.body.appendChild(probe);

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

  // The entry budget, published for the stylesheet so the layout and the
  // decision below read one number rather than two expressions of it.
  put(root, '--stage-entry-px', `${entryBudget(fit.vh)}px`);

  // Pass two — window or flow, per panel, against the band it will actually be
  // composed at.
  const decisions: Record<string, unknown> = {};
  for (const { panel, leadH, hangH, aboveH, bandTop, flowH, panelH } of measured) {
    const stage = panel.dataset.stage as StageId | undefined;
    const mid = midOf(stage);
    if (!stage || mid === null) continue;
    const band = bandAt(mid, fit.strength);
    // The windowed composition needs the headline band to hold the headline
    // *below the deck* and the flow band to be worth reading. Either failing is
    // the fallback condition, and the fallback is not a failure.
    //
    // `entry + leadH`, not `leadH`, and the difference is a defect the mobile
    // fidelity suite caught. The lead pair is bottom-aligned against the
    // instrument and lifted out of row 1's surplus only when there *is* surplus
    // - so on a panel whose headline is nearly as tall as the band, the lift
    // came out zero and the pair sat at `band - leadH`, which can be *above* the
    // entry floor. Measured on a 390x664: the calibration headline runs to three
    // lines, the lift was zero, and the eyebrow landed at 114px under an
    // instrument strip ending at 130 - the collision this pass exists to remove,
    // reintroduced by the fix for it.
    //
    // Requiring the entry budget to fit makes the two consistent: a panel in the
    // window always has surplus for the lift, so its lead can never rise into
    // the deck, and a panel that has not goes to natural flow - where the copy
    // runs over the scene under a softened edge, which is §6's answer and is a
    // composition rather than a collision.
    const entry = entryBudget(fit.vh);
    const fits =
      fit.portrait && band >= MIN_FLOW_BAND && leadH > 0 && entry + leadH <= band;
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

    // The lead band's own measured height. Two consumers now, and it is
    // published for both rather than for whichever asked first.
    //
    //   portrait   the entry cap in the window composition — see the note on
    //              `.panel__band--lead` in styles.css.
    //   landscape  where the sticky band stops being sticky, which is the one
    //              moment the reverse-gravity grammar cannot author. A band
    //              runs out of column when its own bottom reaches the bottom of
    //              the panel, and past that it travels UP with the document
    //              like any other flow content. `--pinned` subtracts this from
    //              the chapter to know when that is, so the statement is faded
    //              out before it can be seen to rise.
    //
    // It used to be gated on `fits`, which is portrait-only, so on landscape
    // nothing was published and the grammar fell back to a 220px guess — one
    // number for a headline that is two lines in Hungarian and four in German.
    //
    // Published here rather than derived in CSS because CSS cannot read the
    // height of a box in order to position it, and *per panel* because every
    // stage's headline is a different number of lines in every locale.
    //
    // Same lifecycle as `--copy-room` above: a per-stage constant, rewritten
    // only when this function runs, which is after the fonts settle and on
    // every resize. Rounded up so a subpixel measurement can never leave the
    // pair a fraction of a pixel lower than the budget it was capped to.
    if (leadH > 0) panel.style.setProperty('--lead-h', `${Math.ceil(leadH)}px`);
    else panel.style.removeProperty('--lead-h');
    leadOf.set(stage, Math.ceil(leadH));
    hangOf.set(stage, Math.ceil(hangH > 0 ? hangH : leadH));
    panelOf.set(stage, Math.round(panelH));

    // ------------------------------------------- THE PANEL'S HEIGHT, IN SCREENS
    //
    // What `--act-in` and `--act-out` in `styles.css` multiply `--pass` by to
    // get "how many screens of scroll into this chapter are we". They used to
    // multiply by `--share`, which is the stage's share of the ALTITUDE CURVE
    // and only approximately its height: a panel is at least `--share` screens
    // tall and taller whenever its body says so. Measured on the production
    // build the two already disagreed by up to 10% on the acts — 1.8 against
    // 1.98 at the opening — so the departure never quite started at the moment
    // the frame unpinned, which is the one thing the ramp is written to do.
    //
    // The continuity pass made the approximation break outright rather than
    // merely drift. A passage that stages its structural layer under its frame
    // is genuinely three to five screens tall against a share of two, so
    // `pass × share` reported a third of the scroll that had actually
    // happened and the frame never left at all: the statement was still at
    // full strength with the reference detail already under it.
    //
    // It is the same number `panelOf` already holds, published, and it is a
    // per-stage constant like `--copy-room` and `--lead-h` beside it — written
    // when this function runs and not on a scroll frame. Quantised to a
    // thousandth of a screen, which at 900px is under a pixel of ramp.
    panel.style.setProperty('--screens', (panelH / fit.vh).toFixed(3));

    // How wide the statement may run — see `statementRoom`. A per-stage
    // constant like the others, and measured against the height the statement
    // actually has in this locale at this viewport, because how far above the
    // dial's centre it sits is the whole of what decides the gain.
    const statement = railLimit > 0 ? statementRoom(fit, stage) : 0;
    if (statement > 0) panel.style.setProperty('--statement-w', `${Math.floor(statement)}px`);
    else panel.style.removeProperty('--statement-w');

    // ------------------------------------------------------- the monument cap
    //
    // The vertical half of the frame-wide measure above, and the only thing
    // standing between a `field` chapter's statement and the dial it hangs over.
    //
    // `--hang-room` is the sky between the bottom of the deck and the TOP of the
    // instrument's essential silhouette, taken at its worst over the chapter's
    // own altitudes. The stylesheet divides it by the chapter's authored line
    // count and the tier's leading, which gives the largest size at which every
    // line of this statement is still clear of the object — solved from the
    // projection rather than tuned against a screenshot at one viewport.
    //
    // Published only for the two frames that need it. Everywhere else the
    // statement is beside the instrument rather than above it, `copyRoom`
    // already answers the clearance question, and a vertical cap would be a
    // second, weaker answer to a question that is already settled.
    const scene = SCENE[stage];
    put(panel, '--monument-scale', `${scene.scale}`);

    // The word cap — see `wordCapOf`. Published per panel because the longest
    // word is a fact about this chapter's copy in this locale, and per
    // measurement because the measure it has to fit is a fact about this
    // viewport.
    const title = panel.querySelector<HTMLElement>('.panel__title');
    const cap = title && statement > 0 ? wordCapOf(title, probe, scene.lines === 1) : Infinity;
    if (Number.isFinite(cap)) panel.style.setProperty('--word-cap', `${Math.floor(cap)}px`);
    else panel.style.removeProperty('--word-cap');
    put(panel, '--monument-lines', `${scene.lines}`);
    // The chapter's own deck. Equal to the page's for three of the five frames
    // and lifted for the two whose statement hangs above the instrument — see
    // `skyBandOf`. Written per panel so the sticky offset the stylesheet uses
    // and the clearance every calculation above solves against are one number.
    put(panel, '--sky-band', `${skyBandOf(stage, fit.vh)}px`);
    if (overheadStatement(stage)) {
      const meta = STAGES.find((x) => x.id === stage);
      let sky = Infinity;
      if (meta) {
        // The chapter's SETTLED altitudes, not its full range, and the same
        // convention `copyRoom` established for the same reason: a stage
        // boundary is the midpoint of a rail crossing, the statement is being
        // yielded by `leadPresence` for the whole of it, and charging the
        // chapter's display size for the frame at its own first metre spends
        // the entire chapter paying for a state that lasts nine tenths of a
        // screen and is half-transparent while it does.
        //
        // The upper bound stops where the statement does: `--leave-from` on a
        // field frame begins the fall at two thirds of the pinned range, so
        // beyond that the statement is going and the clearance stops being a
        // question. Measured on the system chapter at 1440×900, the two
        // together are the difference between an 89px cap and a 131px one, on
        // an instrument that is receding throughout either way.
        const settle = (meta.to - meta.from) * 0.12;
        const from = meta.from + settle;
        const to = meta.from + (meta.to - meta.from) * 0.7 || meta.to;
        for (let i = 0; i <= 8; i++) {
          const metres = lerp(from, Math.max(from, to), i / 8);
          const recede = budgetRecede(fit, metres);
          const top = fit.vh / 2 - projectedEssentialHeight(fit, metres, recede) / 2;
          // The same visual safety margin the validator expands the instrument
          // by before it tests for a collision.
          const pad = Math.max(8, Math.min(fit.vw, fit.vh) * 0.015);
          // THE DRIFT IS PART OF THE BUDGET.
          //
          // A pinned chapter does not hold still: `--pass-drift` walks it 9svh
          // — 81px at 900 — down the frame across its own scroll, which is the
          // slow descent the reverse-gravity grammar is built on. A cap solved
          // against the statement's position at `--pass: 0` is a cap the
          // statement clears when it arrives and fails in the middle of the
          // chapter, which is where it is read.
          //
          // Measured at 29 000 m before this term: the stratosphere statement
          // sat at y 314–403 against a cap solved for 140–229, and the last
          // 89px of it were on the dial.
          sky = Math.min(sky, top - pad - skyBandOf(stage, fit.vh) - aboveH - PASS_DRIFT_OVERHEAD * fit.vh);
        }
      }
      // Never below a readable display size, because a chapter whose sky has
      // closed up is a chapter whose statement should be re-authored rather
      // than one whose statement should become body text. The floor is the
      // tier's own `clamp()` minimum, which is what the cap then loses to.
      put(panel, '--hang-room', `${Math.max(120, Math.floor(Number.isFinite(sky) ? sky : 0))}px`);

      // THE ARRIVAL FLOOR — how far below the statement the closing action has
      // to start so that it lands under the instrument rather than across it.
      //
      // Solved rather than guessed. It was `44svh`, which is right at 1440×900
      // and wrong at 1920×1080: the dial's projected size depends on the aspect
      // through `fitDistance`, so its lower edge is at 66% of the frame on one
      // and 76% on the other, and a constant fraction of the viewport put the
      // closing line 31px into it on the wider one.
      //
      // Measured from the same projection everything else here uses, taken at
      // the worst case over the chapter, and expressed as the distance from the
      // bottom of the statement — which is where the flow band actually starts.
      if (scene.frame === 'arrival' && meta) {
        let floor = 0;
        for (let i = 0; i <= 4; i++) {
          const metres = lerp(meta.from, meta.to, i / 4);
          const recede = budgetRecede(fit, metres);
          const pad = Math.max(8, Math.min(fit.vw, fit.vh) * 0.015);
          floor = Math.max(floor, fit.vh / 2 + projectedEssentialHeight(fit, metres, recede) / 2 + pad);
        }
        const from = skyBandOf(stage, fit.vh) + (hangH > 0 ? hangH : leadH);
        put(panel, '--arrival-gap', `${Math.max(64, Math.ceil(floor - from))}px`);
      } else {
        panel.style.removeProperty('--arrival-gap');
      }
    } else {
      panel.style.removeProperty('--hang-room');
    }

    // The chapter's own height, for the motion grammar. A per-stage constant
    // like `--copy-room` and `--lead-h`, rewritten only when this function
    // runs, and quantised to 8px so a subpixel reflow does not rewrite it.
    if (panelH > 0) panel.style.setProperty('--panel-h', `${Math.round(panelH / 8) * 8}px`);
    else panel.style.removeProperty('--panel-h');

    // The detail's own height, so the stylesheet can work out how much room
    // there is above it — see `--flow-room` in styles.css. Published for the
    // same reason `--lead-h` is: CSS cannot read the height of a box in order
    // to position another one.
    if (flowH > 0) panel.style.setProperty('--flow-h', `${Math.ceil(flowH)}px`);
    else panel.style.removeProperty('--flow-h');

    // ------------------------------------------------------------------ hang
    //
    // WHAT DESCENDS: the whole chapter, or only its statement.
    //
    // The reverse-gravity composition pins a chapter in the sky band so it can
    // descend past the visitor instead of rising towards them. That works
    // perfectly for a chapter that fits in a frame, and it cannot work for one
    // that does not: a 1 350px case study on a 900px screen has to scroll,
    // because there is no arrangement of pinned boxes that shows 1 350px of
    // content in 900px of frame.
    //
    // So the fork is measured rather than declared, exactly as `data-fit` is in
    // portrait, and both sides of it are a composition rather than a success and
    // a failure:
    //
    //   whole  the statement AND its detail are pinned together and descend as
    //          one composed frame. Nothing inside the chapter moves relative to
    //          anything else, so nothing can collide. Seven of the eleven.
    //
    //   lead   only the statement is pinned. The detail — the capability
    //          ladder, the marks and the Rapidkert feature, the nine areas, the
    //          seven checkpoints — travels up through the frame beneath it, and
    //          the statement dissolves into haze as the detail climbs into the
    //          band it occupies. Four of the eleven, and they are exactly the
    //          four dense stages.
    //
    // The tail is the room left under the column so a chapter that only just
    // fits does not sit flush against the bottom edge of the frame. 48px is
    // half a line of body copy at this scale.
    //
    // The closing panel is measured against its own two numbers, and both are
    // the composition rather than a concession. It hangs 3% of the frame higher
    // than a chapter title does — it is the whole call to action, not a marker —
    // and it is allowed to reach the bottom edge, because there is no next
    // chapter for a tail to separate it from. On a 1440×900 that is the
    // difference between the arrival being one composed frame and being a
    // headline whose contact line scrolls up through its own buttons.
    const last = stage === STAGES[STAGES.length - 1].id;
    const hangBand = skyBand(fit.vh) - (last ? 0.05 * fit.vh : 0);
    // No tail on the closing panel: there is no next chapter for one to
    // separate it from, and the eight pixels it used to reserve were the
    // difference between the arrival being one composed frame and its contact
    // line scrolling up through its own buttons.
    const tail = last ? 0 : 32;
    const columnH = leadH + FLOW_GAP + flowH;
    panel.dataset.hang = hangBand + columnH + tail <= fit.vh ? 'whole' : 'lead';
    if (columnH > 0) panel.style.setProperty('--col-h', `${Math.ceil(columnH)}px`);
    else panel.style.removeProperty('--col-h');

    // ------------------------------------------------- separation and contact
    //
    // Only the `lead` branch has either. On a `whole` chapter the detail is
    // pinned WITH the statement and never climbs up to meet it, so there is
    // nothing for a separation to separate and nothing for a contact to be the
    // moment of — the stylesheet gives that branch the minimum gap and this
    // publishes nothing, which is what makes the two branches read as two
    // compositions rather than as one with an exception in it.
    //
    // `held` restates the stylesheet's hold selector — a `monument` or a
    // `colossus` whose detail is not pinned — because the separation and the
    // hold are two halves of one decision and neither is legible without the
    // other. See `flowSeparation`.
    if (panel.dataset.hang === 'lead') {
      const held = scene.tier === 'monument' || scene.tier === 'colossus';
      const sep = flowSeparation(stage, held, bandTop, leadH, hangH, flowH, panelH);
      panel.style.setProperty('--flow-sep', `${sep}px`);
      // Floored at a twentieth of a chapter so a panel whose detail is already
      // at the statement — one whose column overruns the frame outright — asks
      // for a dissolve that starts before its own chapter does. There the
      // statement is gone almost immediately, which is the honest answer for a
      // chapter that has no room for it, and it is bounded rather than negative.
      const contact = Math.max(0.05, contactPass(stage, bandTop, leadH, hangH, sep, panelH));
      put(panel, '--contact', contact.toFixed(3));
    } else {
      panel.style.removeProperty('--flow-sep');
      panel.style.removeProperty('--contact');
    }
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
  probe.remove();

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

  // `data-rails` and `data-composition` are set at the top of this function
  // rather than here — see the note there. `data-rails` is present only while
  // the rails are actually carrying the composition, so the stylesheet has one
  // hook for "the instrument is off the centre and the copy owns a side" and
  // cannot get it from a width breakpoint instead.
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

  // The altitude, as one number the stylesheet can bind to.
  //
  // The atmosphere the visitor climbs through is not all in the shader. Two DOM
  // layers sit in front of the canvas — the ground haze that has to fall away
  // and the cold opening that has to widen — and both are pure functions of
  // this. Publishing the altitude once here rather than giving either of them a
  // clock of its own is the same arrangement `--rail-x` already uses.
  //
  // Quantised to a five-hundredth of the journey: 60 metres, which is below
  // anything either gradient expresses, and it means the property is rewritten
  // a few hundred times over 30 000 m rather than sixty times a second.
  put(root, '--alt', (Math.round((metres / CEILING_M) * 500) / 500).toFixed(3));

  // WHETHER THE INSTRUMENT IS IN THE PICTURE, 0..1.
  //
  // Published for three consumers, and the third is the reason it is a
  // published value rather than a private one.
  //
  //   the stylesheet   nothing binds it today, and it is here so that anything
  //                    which has to compose around the object's presence can
  //                    read the same number the object does rather than
  //                    inferring it from the altitude.
  //   the audit        `scan-journey.mjs` and the report's captures.
  //   the suite        `six-acts.spec.ts` asserts the appearance budget, and it
  //                    runs against the PRODUCTION build, where the `__stratos`
  //                    handle is compiled out on purpose. Without this the only
  //                    way to ask "is the object in this frame" from outside
  //                    the renderer is to read pixels back off a WebGL canvas
  //                    that does not preserve its drawing buffer.
  //
  // Quantised to a hundredth, like every other published ramp here, so this is
  // a comparison on almost every frame and a style write on very few.
  put(root, '--instrument', instrumentPresenceAt(journey.current).toFixed(2));

  // THE OCCLUSION MASK. §7, §8, §11, §46.
  //
  // Four numbers in the study's own reference frame — the housing's projected
  // centre and its two radii — and one gate. The stylesheet multiplies them by
  // `--u`, subtracts the monument's own authored origin and cuts the hole; see
  // the mask rule in `styles.css`.
  //
  // Nothing is measured to produce these and nothing is read back off the
  // canvas (§29). They are the SAME solved state the renderer inverts into a
  // world transform one function call earlier in the same frame, which is the
  // whole of §11: the mask cannot drift from the object because there is only
  // one object to drift from.
  //
  // ## The erosion, and why the sign of the error is the design decision
  //
  // The measured silhouette is an ellipse to within about 1.5% of its radius
  // (see `HOUSING_ASPECT`), and the residual has to fall on one side or the
  // other. Eroding puts it inside the object: a glyph runs a couple of pixels
  // past the mask edge and is painted over the case's own dark rim, where it
  // is invisible on an object this dark. Dilating puts it outside: a glyph
  // stops short and leaves a sliver of sky between the letter and the thing
  // that is supposed to be covering it, which is §8's "a circle was cut out of
  // the text" in miniature and on every letter at once.
  //
  // 2%, which is under three reference pixels on the largest dial in the proof.
  //
  // ## The gate
  //
  // Zero unless this position is authored to stand in front of the statement
  // AND the object is actually being drawn. `AltimeterMeridian` stops drawing
  // below a presence of 0.05; a mask that outlived it would be a hole in the
  // words with nothing in front of them.
  //
  // OFF is a POSITION and not a zero radius. A radial gradient with no size is
  // a corner of the specification nothing should be standing on; a gradient
  // parked ten thousand reference pixels off the frame is an ordinary one whose
  // every visible pixel is its last colour stop, which is opaque, which is an
  // unmasked statement. `--occl` carries the intent for the suite and the
  // probes and drives nothing.
  const occl = instrumentStateAt(journey.current);
  const cutting = !!occl && occl.occlusion === 'monument' && occl.presence > INSTRUMENT_CUTOFF;
  put(root, '--occl', cutting ? '1' : '0');
  put(root, '--occl-x', cutting ? occl!.maskX.toFixed(1) : '-9999');
  put(root, '--occl-y', cutting ? occl!.maskY.toFixed(1) : '-9999');
  put(root, '--occl-rx', cutting ? (occl!.rx * (1 - MASK_EROSION)).toFixed(1) : '1');
  put(root, '--occl-ry', cutting ? (occl!.ry * (1 - MASK_EROSION)).toFixed(1) : '1');

  // Where a chapter's statement hangs. Published rather than declared in CSS
  // because `leadPresence` above has to reason about the same number, and two
  // expressions of one number is the drift this file warns about elsewhere.
  put(root, '--sky-band', `${skyBand(fit.vh)}px`);

  // LIFT-OFF: 0 to 1 over the first two hundred metres.
  //
  // `--alt` is the whole journey, and over the opening screen it barely moves —
  // deliberately, because the stage map gives the ground stage a full screen of
  // scroll for 150 vertical metres so that the headline and the first call to
  // action have room. The consequence is that anything keyed to `--alt` alone is
  // still at 99% of its ground value after a whole screen of scrolling, and the
  // direction is explicit that the first half-screen to screen of movement has
  // to establish that the environment is ascending.
  //
  // So the ground haze gets a second, much steeper term. It is still a pure
  // function of altitude — same rule, same forward/reverse equality — it simply
  // reads the part of the altitude the opening actually covers. Measured at
  // 1440×900: the lower air is at 57% of its ground density after one screen of
  // scroll, against 98% on `--alt` alone.
  put(root, '--lift', ease(span(metres, 0, 200)).toFixed(2));

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
    // The readout's side: the negation of the copy's, so it sits where the
    // narrative is not.
    //
    // Written for the stack as well as the strip. It used to be strip-only, on
    // the grounds that nothing consumed it in the stack layout — which was true
    // until the copy stopped being a block in the middle of the frame and
    // started hanging from the sky band with its detail running down the
    // column. Both layouts now track, through the same value and the same
    // measured travel.
    put(root, '--hud-track', (-Math.round(copyTrack(metres) * 100) / 100).toFixed(2));
  }

  if (!fit.portrait) {
    // The handoff yield. One write per panel per frame, quantised to a
    // hundredth, and `put` drops it when it has not changed — which through the
    // 95% of the journey that is not a crossing is every frame.
    for (const panel of panels) {
      const stage = panel.dataset.stage as StageId | undefined;
      if (!stage) continue;

      // How far the visitor is through this chapter, and the whole of the
      // reverse-gravity motion grammar.
      //
      // The lead band is sticky in the sky band, so it cannot travel upward with
      // the document the way ordinary flow content does. What it does instead is
      // a pure function of this number: it settles DOWN into legibility over the
      // first tenth, holds, and then drifts DOWN out of the frame as the visitor
      // climbs past it. Four states, one value, and the arithmetic is in
      // `styles.css` next to the boxes it moves — see `--pass`.
      //
      // Unclamped, deliberately. `stageProgress` saturates at 0 and 1, which is
      // right for everything that asks "how far through this stage are we" and
      // wrong here: a chapter's copy has to know it is at −0.2 — approaching,
      // not yet arrived, not yet painted — rather than at the same 0 it holds at
      // the instant it becomes legible. Bounded to ±1 so a panel eight screens
      // away is not writing a fresh value every frame.
      //
      // `journey.target`, not `journey.current`: this positions document content
      // and document content belongs to the finger. The damped clock drives the
      // fade below, for the reason §4.1 gives — a fade wants to arrive, a
      // position wants to be exact.
      const pass = Math.max(-1, Math.min(1.4, rawProgress(journey.target, stage)));
      // A two-hundredth of a chapter. The shortest chapter is one screen, so
      // this is 4.5 CSS pixels of travel at 900px — a third of the finest step
      // anything downstream of it expresses.
      put(panel, '--pass', (Math.round(pass * 200) / 200).toFixed(3));

      // Two yields, because the two bands are in different parts of the frame
      // and only one of them is beside the instrument. The statement hangs in
      // the sky band above it and holds through a crossing whenever it is
      // clear of it; the detail runs down the column past it and yields the way
      // it always did.
      const presence = railLimit > 0 ? copyPresence(stage, metres, recede) : 1;
      const lead = railLimit > 0 ? leadPresence(stage, metres, recede) : 1;
      put(panel, '--panel-veil', presence.toFixed(2));
      put(panel, '--lead-veil', lead.toFixed(2));
      // A column nobody can see must not be able to take a click from the frame
      // behind it. A threshold rather than a ramp, because `pointer-events` has
      // no in-between. Taken on the lead band, which is where the calls to
      // action are.
      put(panel, '--panel-events', Math.max(presence, lead) > 0.5 ? 'auto' : 'none');

      // THE SAME GATE FOR AN ACT'S FRAME, AND HERE IT IS ABOUT THE KEYBOARD.
      //
      // A frame that has faded out is still in the document, and its action is
      // still in the tab order — so a visitor tabbing through the page can land
      // on an invisible link between two acts, which is the defect §43's
      // "maintain keyboard behaviour" is written against. It is also a click
      // target sitting on top of the act that replaced it.
      //
      // The stylesheet's `--act-presence` is the authority on whether a frame
      // is in the picture, and this is the same arithmetic written once more,
      // in the one place `--pass` is already being computed. It cannot be done
      // in CSS: `visibility` and `pointer-events` have no in-between, so a
      // number cannot drive them, and the frame's presence is a number.
      if (panel.dataset.actRole === 'peak') {
        const share = STAGES.find((x) => x.id === stage)?.share ?? 1;
        const hold = panel.dataset.actDeparts === 'no' ? Math.max(ACT_HOLD, share) : ACT_HOLD;
        const inRamp = clamp((pass * share + 0.3) / 0.42);
        const outRamp = clamp((pass * share - (hold - 1)) / 0.32);
        // Reduced motion has no ramp, so nothing is ever out of the picture on
        // that path — §44, and the same decision the stylesheet makes for
        // `--act-presence`. It has to be made here as well because this is
        // written as an inline custom property and an inline property beats a
        // media query.
        const inPicture = prefersReducedMotion() || inRamp * (1 - outRamp) > 0.5;
        // Pointer only. Focus is deliberately left alone — see the note beside
        // `.act a` in `styles.css`: an action taken out of the tab order is an
        // action a keyboard-only visitor can never reach, because tabbing
        // cannot scroll a hidden element into view.
        put(panel, '--act-events', inPicture ? 'auto' : 'none');
      }
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
  root.style.removeProperty('--alt');
  root.style.removeProperty('--sky-band');
  root.style.removeProperty('--lift');
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
    panel.style.removeProperty('--pass');
    panel.style.removeProperty('--lead-veil');
    panel.style.removeProperty('--panel-veil');
    panel.style.removeProperty('--panel-events');
    panel.style.removeProperty('--copy-room');
    panel.style.removeProperty('--lead-h');
    panel.style.removeProperty('--screens');
    panel.style.removeProperty('--panel-h');
    panel.style.removeProperty('--col-h');
    panel.style.removeProperty('--flow-h');
    panel.style.removeProperty('--statement-w');
    delete panel.dataset.fit;
    delete panel.dataset.hang;
    delete panel.dataset.dense;
    delete panel.dataset.copy;
  }
  panels = [];
  dense.clear();
  leadOf.clear();
  roomOf.clear();
  shown.clear();
  railLimit = 0;
  liveRecede = null;
}

/** The budgeted statement measure per stage, 0..1 of usable width, for the harness. */
export const statementFraction = (stage: StageId) => statementOf.get(stage) ?? 0;

/** The measured fit, for the debug panel and the validation harness. */
export const currentFit = () => fit;
/** The measured dense set, for the validation harness. */
export const denseStages = () => [...dense];

let lastMeasurement: unknown = null;
/** The last composition decision, per panel, with the numbers behind it. */
export const measurement = () => lastMeasurement;

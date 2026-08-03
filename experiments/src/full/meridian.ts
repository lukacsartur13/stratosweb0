/**
 * Altimeter Meridian — the altitude timeline for the instrument itself.
 *
 * `journey.ts` maps scroll onto altitude and owns the narrative stages. This
 * module maps that one altitude onto every mechanical state of the instrument:
 * how far the aperture is open, how far each ring has unseated, tilted and
 * locked, how far the housing has separated, how much light is coming through.
 *
 * Three rules hold the whole thing together, and every awkward-looking decision
 * below follows from one of them:
 *
 *   1. **Everything is a pure function of altitude.** No accumulated animation
 *      state, no "has this event fired yet" flags. Reverse scrolling, a jump to
 *      the middle of the page, a resize that recalibrates the curve and a debug
 *      slider all produce the same frame for the same metres, because the frame
 *      is *derived* rather than integrated. This is the single reason the
 *      reverse-scroll requirement is cheap here instead of a source of bugs.
 *
 *   2. **Nothing here imports `three`.** This module is reachable from the eager
 *      entry chunk — the static fallback uses it to pick which of the six
 *      discrete states to draw — and the renderer must stay behind the dynamic
 *      import boundary. Same rule as `journey.ts`; the build test enforces it.
 *
 *   3. **One ring-lock gesture, three parameterisations.** The lock is the
 *      brand motif. Rings differ by scale, mass, distance, speed and final
 *      axis, never by having their own bespoke animation.
 */

import { clamp, journey, lerp } from './journey';
import { m } from './i18n';

// -----------------------------------------------------------------------------
// The altitude stops.
//
// These are the instrument's events, and they are deliberately *not* the same
// list as the narrative stages in `journey.ts`. The narrative is paced by how
// much reading a section carries; the instrument is paced by how much time a
// mechanism needs to be understood. They meet at 12 000 m, where the aperture
// snap is timed onto the cloud breakthrough — see APERTURE below.
// -----------------------------------------------------------------------------
export const ALTITUDE_STOPS = {
  baseline: 0,
  firstSignal: 3_000,
  firstRing: 7_000,
  breakthrough: 12_000,
  secondRing: 18_000,
  thirdRing: 24_000,
  meridian: 30_000,
} as const;

export type AltitudeStop = keyof typeof ALTITUDE_STOPS;

// -----------------------------------------------------------------------------
// Interpolation. Small, clamped, deterministic, and all of it total: every
// function below returns a finite number for every finite input, including
// degenerate ranges, because a NaN in a transform silently removes an object
// from the scene rather than throwing.
// -----------------------------------------------------------------------------

/** Linear 0..1 progress through an altitude range, clamped at both ends. */
export function rangeProgress(altitude: number, start: number, end: number): number {
  const d = end - start;
  if (d === 0) return altitude >= end ? 1 : 0;
  return clamp((altitude - start) / d);
}

/** The same range, smoothstepped: arrives and departs at zero velocity. */
export function smoothRange(altitude: number, start: number, end: number): number {
  const t = rangeProgress(altitude, start, end);
  return t * t * (3 - 2 * t);
}

/**
 * A discrete mechanical event: nothing, then a short decisive transition, then
 * nothing again. Used where the instrument should read as having *clicked* to a
 * new setting rather than drifted to one.
 */
export function steppedEvent(altitude: number, centre: number, width: number): number {
  return smoothRange(altitude, centre - width / 2, centre + width / 2);
}

/**
 * The mechanical arrival curve: controlled acceleration, long deceleration,
 * exact arrival, no rebound. Roughly the shape of `cubic-bezier(0.16, 1, 0.3, 1)`
 * with the tail length exposed as a parameter, because that is what mass is.
 *
 * A heavier ring gets a larger exponent: it commits to the move earlier and
 * spends longer bleeding off speed, which is what "greater inertia" looks like
 * when nothing is allowed to overshoot.
 */
export function arrive(t: number, mass = 0): number {
  const k = clamp(t);
  return 1 - Math.pow(1 - k, 2 + mass * 1.8);
}

/**
 * The aperture snap. Deliberately not `arrive`.
 *
 * The blades move smoothly and legibly for the first two thirds, then the
 * mechanism goes over centre and the last third is quick — followed by one
 * short, exact stop. Written as two segments precisely so the velocity step at
 * the join is visible: that step *is* the event. A single smooth curve here
 * produced something that opened correctly and felt like a fade.
 */
export function snapCurve(t: number): number {
  const k = clamp(t);
  if (k < 0.66) {
    const u = k / 0.66;
    return 0.58 * (u * u * (3 - 2 * u));
  }
  const u = (k - 0.66) / 0.34;
  return 0.58 + 0.42 * (1 - Math.pow(1 - u, 2.2));
}

/** A short symmetric bump. One frame-band of "this just happened". */
export function pulse(altitude: number, centre: number, width: number): number {
  const d = Math.abs(altitude - centre) / (width / 2);
  return d >= 1 ? 0 : Math.pow(1 - d * d, 2);
}

// -----------------------------------------------------------------------------
// The ring-lock system.
//
// One gesture, four phases, reused three times. The phase fractions are shared
// by all three rings on purpose: what makes the third lock recognisable as the
// same event as the first is the *rhythm*, not the geometry.
//
//   0.00 – 0.20   seam     a separation line appears in the face. Nothing moves.
//   0.20 – 0.46   lift     the ring rises out of its seat, straight forward.
//   0.46 – 0.54   hold     it stops. This pause is the most load-bearing eight
//                          percent in the file: without it the lift and the
//                          tilt read as one continuous swoop, and the visitor
//                          never sees where the ring came from.
//   0.54 – 1.00   travel   it tilts and settles into its final axis, arriving
//                          with zero velocity and locking exactly once.
// -----------------------------------------------------------------------------
const PHASE = { seam: 0.2, lift: 0.46, hold: 0.54 } as const;

export type RingLockConfig = {
  id: 'ring1' | 'ring2' | 'ring3';
  /** Where the separation seam starts becoming visible. */
  seamAltitude: number;
  /** Where the ring starts to move. */
  startAltitude: number;
  /** Where it locks. This is the headline altitude for the event. */
  endAltitude: number;
  /** How far it lifts out of the face before tilting, in model units. */
  liftDistance: number;
  /** Final orientation, radians, applied XYZ. */
  targetTiltX: number;
  targetTiltY: number;
  targetTiltZ: number;
  /** Final axial offset once locked. */
  finalZ: number;
  /** Final radial scale. 1 means the ring keeps the radius it had on the face. */
  finalScale: number;
  /** Radians per metre of altitude once locked — the scroll-coupled component. */
  rotationGain: number;
  /** Radians per second once locked — the governed idle component. */
  idleRate: number;
  /** 0 = light and quick, 1 = heavy and deliberate. */
  massFactor: number;
};

export type RingState = {
  /** 0..1 — how visible the separation seam is. */
  seam: number;
  /** 0..1 — how far out of its seat the ring has risen. */
  lift: number;
  /** 0..1 — how far through the tilt-and-settle it is. 1 = locked. */
  settle: number;
  /** True only once the ring has arrived. Gates rotation and sound. */
  locked: boolean;
  /** A short bump around the moment of locking, for the certification mark. */
  lockPulse: number;
  /**
   * 0..1 — how far the ring's section has unfolded out of the dial.
   *
   * At rest the ring is a machined line in the face with no readable thickness;
   * lifted, it is a band with bevels you can see the edges of. Driving the
   * section thickness from this is what lets the ring be genuinely flat at 0 m
   * without ever scaling in from nothing.
   */
  section: number;
};

/** Zero state, reused for the seated ring so the hot path allocates nothing. */
const seated = (): RingState => ({
  seam: 0,
  lift: 0,
  settle: 0,
  locked: false,
  lockPulse: 0,
  section: 0,
});

export function ringLock(altitude: number, cfg: RingLockConfig, out: RingState = seated()): RingState {
  out.seam = smoothRange(altitude, cfg.seamAltitude, cfg.startAltitude);

  const u = rangeProgress(altitude, cfg.startAltitude, cfg.endAltitude);

  if (u <= 0) {
    out.lift = 0;
    out.settle = 0;
  } else if (u < PHASE.lift) {
    out.lift = u < PHASE.seam ? 0 : arrive((u - PHASE.seam) / (PHASE.lift - PHASE.seam), cfg.massFactor);
    out.settle = 0;
  } else if (u < PHASE.hold) {
    out.lift = 1;
    out.settle = 0;
  } else {
    out.lift = 1;
    out.settle = arrive((u - PHASE.hold) / (1 - PHASE.hold), cfg.massFactor);
  }

  out.locked = u >= 0.995;
  // Centred just before the arrival rather than on it: the certification mark
  // is confirming the lock, and a mark that appears on the same frame the ring
  // stops reads as part of the stopping rather than as a response to it.
  out.lockPulse = pulse(altitude, lerp(cfg.startAltitude, cfg.endAltitude, 0.985), (cfg.endAltitude - cfg.startAltitude) * 0.16);
  out.section = clamp(Math.max(out.seam * 0.22, out.lift, out.settle));

  return out;
}

// -----------------------------------------------------------------------------
// The three rings.
//
// Every one of them is made from parts the instrument already had. Nothing is
// added to the model, and nothing arrives from off screen:
//
//   Ring 1  ALT_Chapter_Ring + ALT_Ticks_Major   the outer altitude scale
//   Ring 2  ALT_Ticks_Minor  + ALT_Ceiling_Arc   the inner calibration scale
//   Ring 3  ALT_Housing_Flange + ALT_Housing_Bolts  the rear structural frame
//
// Their final axes are chosen to read as an armillary instrument rather than as
// three copies of the same band: near-horizontal, near-vertical, and one
// oblique. Rings 1 and 2 have almost the same radius in the model, which is not
// a problem for an armillary — equal great circles at different axes is exactly
// what one is — but Ring 2 takes a 12% radial reduction anyway, because it
// unseats from *beneath* the dial and dropping inward onto its carrier is both
// the honest reading and the one that separates the two silhouettes.
//
// Ring 3 moves rearward, not forward. It is the rear frame; pulling it towards
// the viewer would be the first moment in the whole sequence where a part went
// somewhere its original mounting does not allow.
// -----------------------------------------------------------------------------
const DEG = Math.PI / 180;

export const RINGS: readonly RingLockConfig[] = [
  {
    id: 'ring1',
    seamAltitude: 3_400,
    startAltitude: 5_600,
    endAltitude: ALTITUDE_STOPS.firstRing,
    liftDistance: 0.3,
    // The horizontal ring of the three.
    //
    // The tilts across all three were chosen together and only make sense
    // together: one near-horizontal, one near-vertical, one oblique, which is
    // what an armillary is and what makes three bands of similar radius legible
    // as a system rather than as clutter. Earlier passes gave each ring a tilt
    // that looked right on its own; both of the first two then projected to
    // nearly the same flattened ellipse and crossed the dial as a pair of
    // indistinguishable bars.
    //
    // The other constraint is the instrument's own 22° yaw, which composes with
    // any Y component here. Ring 1 therefore carries almost none, and takes its
    // asymmetry from a small roll instead.
    targetTiltX: -52 * DEG,
    targetTiltY: 0,
    targetTiltZ: 9 * DEG,
    finalZ: 0.03,
    finalScale: 1,
    rotationGain: 9e-5,
    idleRate: 0.052,
    massFactor: 0.15,
  },
  {
    id: 'ring2',
    seamAltitude: 12_600,
    startAltitude: 16_400,
    endAltitude: ALTITUDE_STOPS.secondRing,
    liftDistance: 0.26,
    // The vertical ring: a tall narrow ellipse against Ring 1's wide flat one.
    // The 68° is generous because the instrument's own +22° yaw turns this ring
    // back towards the viewer, landing it near 46° — which is where a ring reads
    // as standing on edge and still shows its engraving.
    targetTiltX: 0,
    targetTiltY: 68 * DEG,
    targetTiltZ: -6 * DEG,
    finalZ: 0,
    finalScale: 0.88,
    rotationGain: 5.5e-5,
    idleRate: 0.031,
    massFactor: 0.45,
  },
  {
    id: 'ring3',
    seamAltitude: 20_000,
    startAltitude: 22_200,
    endAltitude: ALTITUDE_STOPS.thirdRing,
    // Rearward: this ring is the rear flange, and it disengages the way its
    // mounting actually allows.
    liftDistance: -0.34,
    // The oblique ring, and the only one that reads clearly as neither of the
    // other two.
    targetTiltX: -30 * DEG,
    targetTiltY: -32 * DEG,
    targetTiltZ: 14 * DEG,
    // Rearward while it unseats, then back to the case's own mid-depth as it
    // settles. Both halves are the mounting being honest: a flange comes off
    // the back of a barrel because that is the only direction its seat opens,
    // and a ring that then stayed parked behind the case would be a disc in the
    // instrument's shadow rather than the outermost member of an armillary. At
    // -0.055 the locked ring is concentric with the housing and passes in front
    // of it and behind it as it turns, which is the reading that makes it a
    // ring around the instrument rather than a lid on the back of it.
    finalZ: -0.055,
    // It becomes the largest ring by expanding off the case as it disengages,
    // which is also why it can be authored flush with the housing at 0 m rather
    // than standing proud of it before anything has happened.
    //
    // 1.5 rather than 1.2, and the difference is the whole point of the ring.
    // The flange is authored at r 0.517, inside the octagonal mount plate that
    // frames the instrument; at 1.2 it locked at 0.62 and still sat *within*
    // that frame, so the finished object's silhouette was a case with two bands
    // inside it and a third one nobody could find. At 1.5 it locks at 0.776,
    // level with the plate's corners, and it is the outermost thing in the
    // frame — which is what "the largest, slowest ring" has to mean visually,
    // not just in the parameter table.
    finalScale: 1.5,
    rotationGain: 3.6e-5,
    idleRate: 0.017,
    massFactor: 1,
  },
] as const;

// -----------------------------------------------------------------------------
// The aperture.
//
// Written as a sum of signed contributions rather than as a piecewise switch,
// so it is monotone within each stage, continuous everywhere, and impossible to
// get into a state the reverse direction cannot reproduce. The numbers add up
// to exactly 1.00 at 12 000 m and exactly 0.72 at 30 000 m; changing any of
// them means changing another, which is the point — a stop is a setting, not a
// tuning knob.
//
// The snap window opens at 10 400 m, which is where CloudDeck's `exiting` term
// has taken the deck's opacity most of the way down, and closes at 12 000 m,
// which is where its `tops` population finishes fading in. The instrument's
// biggest event therefore lands on the frame where the atmosphere has finished
// clearing, without either one being told about the other: both read the same
// altitude.
// -----------------------------------------------------------------------------
export const FINAL_CALIBRATED_OPEN = 0.72;

export function apertureOpen(altitude: number): number {
  const base = 0.055; // 0 m — a calibrated slit, not a missing asset
  const firstClick = steppedEvent(altitude, 2_200, 900) * 0.115;
  const buildUp = smoothRange(altitude, 3_600, 7_000) * 0.125;
  const ascent = smoothRange(altitude, 7_000, 10_400) * 0.155;
  const snap = snapCurve(rangeProgress(altitude, 10_400, ALTITUDE_STOPS.breakthrough)) * 0.55;
  const stopDown = smoothRange(altitude, ALTITUDE_STOPS.thirdRing, 26_800) * (1 - FINAL_CALIBRATED_OPEN);
  return clamp(base + firstClick + buildUp + ascent + snap - stopDown);
}

// -----------------------------------------------------------------------------
// The whole instrument state, in one object.
// -----------------------------------------------------------------------------
export type MeridianState = {
  altitude: number;
  progress: number;
  apertureOpen: number;
  /** 0..1 — how much light is coming through the open centre. */
  lightBreakthrough: number;
  /** 0..1 — fog leaving the crystal and contrast arriving in the metal. */
  clarity: number;
  /** 0..1 — the outer case opening a few millimetres to release Ring 3. */
  housingSeparation: number;
  /** 0..1 — how much the gimbal reacts to, and levels out, disturbance. */
  gimbalStrength: number;
  /** 0..1 — the final settle: less independent noise, more coordination. */
  finalCalibration: number;
  /** 0..1 — how far the central shaft has extended rearward. */
  axisExtension: number;
  rings: [RingState, RingState, RingState];
};

export function createMeridianState(): MeridianState {
  return {
    altitude: 0,
    progress: 0,
    apertureOpen: apertureOpen(0),
    lightBreakthrough: 0,
    clarity: 0,
    housingSeparation: 0,
    gimbalStrength: 0,
    finalCalibration: 0,
    axisExtension: 0,
    rings: [seated(), seated(), seated()],
  };
}

/**
 * Fill a state object from an altitude. Mutates and returns `out` so the render
 * loop can keep one object for the whole session — sixty allocations a second
 * of a sixteen-field object with three nested ones is the kind of garbage that
 * shows up as a sawtooth in a memory profile and as a stutter on a phone.
 */
export function meridianState(altitude: number, progress: number, out: MeridianState): MeridianState {
  const a = clamp(altitude, 0, ALTITUDE_STOPS.meridian);

  out.altitude = a;
  out.progress = progress;
  out.apertureOpen = apertureOpen(a);
  out.lightBreakthrough = smoothRange(a, 10_400, ALTITUDE_STOPS.breakthrough);
  // Two sources, and the second one dominates: a little fog leaves the crystal
  // as the instrument powers on, and the rest of it leaves on the way through
  // the cloud deck.
  out.clarity = clamp(0.25 * smoothRange(a, 0, 3_000) + 0.75 * smoothRange(a, 9_000, 12_500));
  out.housingSeparation = smoothRange(a, 20_000, ALTITUDE_STOPS.thirdRing);
  out.gimbalStrength = smoothRange(a, ALTITUDE_STOPS.secondRing, 20_500);
  out.finalCalibration = smoothRange(a, ALTITUDE_STOPS.thirdRing, ALTITUDE_STOPS.meridian);
  out.axisExtension = smoothRange(a, 3_000, ALTITUDE_STOPS.thirdRing);

  for (let i = 0; i < RINGS.length; i++) ringLock(a, RINGS[i], out.rings[i]);

  return out;
}

/**
 * The live instrument state, advanced once per frame by exactly one owner.
 *
 * Same discipline as `journey.advance`, and for the same reason: the canvas
 * frameloop is parked whenever the canvas is off screen or the tab is hidden,
 * so anything that must stay in step with the altitude cannot live in
 * `useFrame`. `JourneyHUD` owns the altitude clock, so it owns this too — the
 * two are recomputed on the same tick from the same number and cannot drift.
 *
 * It is a mutable singleton rather than React state on purpose. Sixty rerenders
 * a second of a subtree containing a WebGL scene is not a trade worth making,
 * and every consumer reads it inside a frame callback it was already running.
 */
export const meridian = createMeridianState();

export function advanceMeridian(altitude: number, progress: number): MeridianState {
  meridianState(altitude, progress, meridian);

  // Development overrides, applied after the derivation so that a slider always
  // wins over the altitude curve. Production never mounts the panel that writes
  // them, and every one is a null check on a field that is null.
  const d = journey.debug;
  if (d.aperture !== null) meridian.apertureOpen = clamp(d.aperture);
  if (d.finalCalibration !== null) meridian.finalCalibration = clamp(d.finalCalibration);
  for (let i = 0; i < RINGS.length; i++) {
    const forced = d.ringLock[i];
    if (forced === null || forced === undefined) continue;
    ringLock(lerp(RINGS[i].startAltitude, RINGS[i].endAltitude, clamp(forced)), RINGS[i], meridian.rings[i]);
    meridian.rings[i].seam = Math.max(meridian.rings[i].seam, clamp(forced) > 0 ? 1 : 0);
  }

  return meridian;
}

// -----------------------------------------------------------------------------
// The six discrete states.
//
// These are what the reduced-motion and no-WebGL paths draw, and what the
// accessible description announces. Six rather than eleven: these are the
// moments where the *object* is structurally different, which is a shorter list
// than the moments where the page is saying something different.
// -----------------------------------------------------------------------------
export type MeridianStageId =
  | 'baseline'
  | 'first-ring'
  | 'aperture-open'
  | 'second-ring'
  | 'third-ring'
  | 'meridian';

export type MeridianStage = {
  id: MeridianStageId;
  from: number;
  /** Names the state, in the active locale. */
  label: string;
  /** One sentence, for the live region and the static fallback's caption. */
  description: string;
};

export const MERIDIAN_STAGES: readonly MeridianStage[] = [
  { id: 'baseline', from: ALTITUDE_STOPS.baseline },
  { id: 'first-ring', from: ALTITUDE_STOPS.firstRing },
  { id: 'aperture-open', from: ALTITUDE_STOPS.breakthrough },
  { id: 'second-ring', from: ALTITUDE_STOPS.secondRing },
  { id: 'third-ring', from: ALTITUDE_STOPS.thirdRing },
  { id: 'meridian', from: ALTITUDE_STOPS.meridian },
].map(({ id, from }) => ({
  id: id as MeridianStageId,
  from,
  // The id is the key. The alternative — repeating each label and description
  // inline — is what made the six announcements drift out of step with the
  // copy in `JourneyHUD` in the first place.
  label: m(`meridian.${id as MeridianStageId}.label`),
  description: m(`meridian.${id as MeridianStageId}.description`),
}));

export function meridianStageAt(altitude: number): MeridianStage {
  let found = MERIDIAN_STAGES[0];
  for (const stage of MERIDIAN_STAGES) if (altitude >= stage.from) found = stage;
  return found;
}

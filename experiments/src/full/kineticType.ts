/**
 * Kinetic typography — the typographic half of the instrument.
 *
 * ## The one rule
 *
 * Everything here is a **pure function of altitude**. There is no second scroll
 * listener, no timeline, no per-component threshold and no direction-dependent
 * state, for the same reason the rest of the journey has none: two clocks drift,
 * and a typographic state that remembers how it was approached is a state that
 * reads differently going up and coming down. `kineticAt(a)` answers with the
 * same numbers for the same `a` forever, so forward and reverse traversal are
 * identical by construction rather than by testing.
 *
 * The altitude arrives from `journey.altitude`, which `advance` writes once per
 * frame from the canonical clock. Nothing in this module reads `scrollY`.
 *
 * ## What the type is allowed to do
 *
 * Only what the licensed binaries actually expose, verified by
 * `node scripts/font-metadata.mjs` rather than assumed from the family name:
 *
 *   Archivo         wght 100..900, wdth 62..125, upright and italic as
 *                   *separate files* — so there is no continuous slant axis and
 *                   none is faked. A roman/italic move could only ever be a
 *                   discrete swap, and none of the moments below needs one.
 *   JetBrains Mono  wght 100..800, no width axis. Being monospaced, its advance
 *                   width is identical at every weight — measured, not assumed —
 *                   which is why the altitude readout can change weight with no
 *                   possibility of reflow.
 *
 * The ranges below sit well inside those bounds. `clampToFont` is the backstop:
 * an axis value outside the design space is silently clamped by the browser and
 * would show up as a moment that simply stops moving, so it is clamped here
 * where it can be reasoned about.
 *
 * ## Why these four moments and not the brief's examples verbatim
 *
 * The brief offers a menu — ring lock, aperture breakthrough, upper-atmosphere
 * expansion, final calibration — and says to choose only the ones that
 * strengthen the approved copy rather than to force the example words. The
 * homepage copy is already written and already emphasises exactly one phrase per
 * panel, in `<em>`, in all three languages. Those are the anchors. Each one got
 * the behaviour its own sentence argues for:
 *
 *   3 000–6 000 m   "egy rendszer." / "one system." / "ein System."
 *                   Weight lock. The sentence is about structure arriving, so
 *                   the phrase gains mass and stops at an exact value. Timed to
 *                   finish as the panel finishes, and shaped by `arrive`, which
 *                   is the same curve the rings lock with — mechanical, and
 *                   incapable of overshoot.
 *
 *   8 500–11 000 m  "ugyanabba az irányba mozdul." / "moves in the same
 *                   direction." Width compression and release, through the same
 *                   `snapCurve` the aperture uses. The passage narrows and opens
 *                   again; the phrase does what the cloud layer does.
 *
 *   28 000–30 000 m "sztratoszférában." / "stratosphere."
 *                   Width expansion. The air thins and the word opens with it,
 *                   settling on an exact final width rather than easing forever.
 *
 *   30 000 m        The altitude readout locks: one weight step and a tracking
 *                   step, at the moment the final Meridian calibration
 *                   completes. This is the *secondary* effect, and it is the
 *                   only one that can share the screen with a primary — see
 *                   `activeAnchor`.
 *
 * Only one primary is ever live, because the four altitude bands do not overlap.
 * That is the §6.7 "one morphing word at a time" rule enforced by arithmetic
 * instead of by review.
 */

import { arrive, snapCurve } from './meridian';
import { clamp, lerp } from './journey';

/** Which emphasised phrase a moment belongs to. Keyed by the stage that owns it. */
export type KineticAnchorId =
  | 'lower-atmosphere'
  | 'cloud-breakthrough'
  | 'full-stratosphere'
  | 'altitude-readout';

/**
 * The axis limits, restated from assets/css/type.css so this module can clamp
 * without importing CSS. Both are inside every binary's real design space.
 */
export const AXIS_LIMITS = {
  weight: { min: 300, max: 800 },
  width: { min: 82, max: 118 },
  /** JetBrains Mono only. No width axis exists on it. */
  monoWeight: { min: 300, max: 750 },
} as const;

export type KineticState = {
  /** `font-weight`. */
  weight: number;
  /** `font-stretch`, as a percentage. 100 is the font's natural width. */
  width: number;
  /** `letter-spacing`, in em. */
  tracking: number;
  /**
   * 0 before the moment begins, 1 once it has completed. Exposed so the DOM can
   * carry `data-kinetic-locked`, which is what the tests assert against and what
   * the reduced-motion path jumps straight to.
   */
  progress: number;
};

const REST: KineticState = { weight: 400, width: 100, tracking: 0, progress: 0 };

/** The resting state, for anything not currently inside its band. */
export const kineticRest = (): KineticState => ({ ...REST });

type Moment = {
  id: KineticAnchorId;
  from: number;
  to: number;
  /** `arrive` for a lock, `snapCurve` for a passage. */
  curve: (t: number) => number;
  weight: readonly [number, number];
  width: readonly [number, number];
  tracking: readonly [number, number];
  /**
   * When set, the moment returns to its starting value in the second half
   * instead of holding the end value — a passage rather than a lock.
   */
  release?: boolean;
};

export const MOMENTS: readonly Moment[] = [
  {
    id: 'lower-atmosphere',
    from: 3_000,
    to: 6_000,
    curve: arrive,
    weight: [400, 780],
    width: [100, 100],
    tracking: [0, -0.014],
  },
  {
    id: 'cloud-breakthrough',
    from: 8_500,
    to: 11_000,
    curve: snapCurve,
    weight: [400, 520],
    width: [100, 89],
    tracking: [0, 0.01],
    release: true,
  },
  {
    id: 'full-stratosphere',
    from: 28_000,
    to: 30_000,
    curve: arrive,
    weight: [400, 380],
    width: [100, 116],
    tracking: [0, 0.03],
  },
  {
    id: 'altitude-readout',
    // A short band rather than a step, so the lock is a movement the eye can
    // follow rather than a value that was suddenly different. It still ends on
    // an exact number.
    //
    // The start values are the readout's *accepted* design — weight 300 and
    // -0.03em, as set on `.hud__digits` — not a fresh choice. This moment adds a
    // final calibration to an instrument that already looks right; it does not
    // restate what the instrument looks like. Getting that wrong would have
    // reweighted the altitude readout across the entire journey in order to
    // decorate its last 600 metres.
    from: 29_400,
    to: 30_000,
    curve: arrive,
    weight: [300, 440],
    width: [100, 100],
    tracking: [-0.03, -0.004],
  },
];

const clampAxis = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/**
 * A moment's state at a given altitude.
 *
 * Below `from` the moment is at its start values with `progress` 0; above `to`
 * it holds its end values with `progress` 1 — except for a `release`, which
 * comes back to where it started. Holding rather than resetting is what makes
 * the reverse journey reconstruct the forward one: scrolling back down through
 * 6 000 m unwinds the weight lock along the same curve it was made with.
 */
export function momentAt(moment: Moment, altitude: number, reduced = false): KineticState {
  const span = moment.to - moment.from || 1;
  const raw = clamp((altitude - moment.from) / span);

  // Reduced motion keeps the *meaning* — the phrase still ends up locked — but
  // gets there in one step at the midpoint instead of interpolating continuously.
  // §6.11: discrete state change, no continuous axis motion, no moving baseline.
  const t = reduced ? (raw >= 0.5 ? 1 : 0) : raw;

  const eased = reduced ? t : moment.curve(t);
  // A passage goes out and comes back: one curve, mirrored, so the return is
  // the exact inverse of the departure and the midpoint is the extreme.
  const shape = moment.release ? 1 - Math.abs(eased * 2 - 1) : eased;

  const mono = moment.id === 'altitude-readout';
  const wLimits = mono ? AXIS_LIMITS.monoWeight : AXIS_LIMITS.weight;

  return {
    weight: Math.round(clampAxis(lerp(moment.weight[0], moment.weight[1], shape), wLimits.min, wLimits.max)),
    width: clampAxis(lerp(moment.width[0], moment.width[1], shape), AXIS_LIMITS.width.min, AXIS_LIMITS.width.max),
    tracking: lerp(moment.tracking[0], moment.tracking[1], shape),
    progress: raw,
  };
}

/** Every moment's state at one altitude. */
export function kineticAt(altitude: number, reduced = false): Record<KineticAnchorId, KineticState> {
  const out = {} as Record<KineticAnchorId, KineticState>;
  for (const moment of MOMENTS) out[moment.id] = momentAt(moment, altitude, reduced);
  return out;
}

/**
 * The one primary moment that is live at this altitude, if any.
 *
 * `altitude-readout` is excluded because it is the permitted *secondary*: it may
 * run alongside a primary. Nothing else may, and nothing else can — the three
 * primary bands are disjoint, which this function relies on rather than
 * arbitrating between overlaps that cannot occur.
 */
export function activeAnchor(altitude: number): KineticAnchorId | null {
  for (const moment of MOMENTS) {
    if (moment.id === 'altitude-readout') continue;
    if (altitude >= moment.from && altitude <= moment.to) return moment.id;
  }
  return null;
}

/**
 * The widest each moment ever gets, as CSS values.
 *
 * Layout stability comes from reserving space rather than from hoping the
 * ranges are small: the DOM measures each anchor once at these settings, after
 * the fonts have loaded, and pins the heading's height to what it measured. A
 * phrase can then change weight and width freely without moving anything below
 * it. Recomputed on resize and on locale change, because both change how the
 * phrase wraps. See `useKineticType`.
 */
export function widestSettings(id: KineticAnchorId): { weight: number; width: number; tracking: number } {
  const moment = MOMENTS.find((m) => m.id === id);
  if (!moment) return { weight: REST.weight, width: REST.width, tracking: REST.tracking };
  // Both ends are candidates: `full-stratosphere` is widest at its end,
  // `cloud-breakthrough` at its start, and a release is widest at whichever end
  // is not its midpoint.
  const width = Math.max(moment.width[0], moment.width[1]);
  const weight = Math.max(moment.weight[0], moment.weight[1]);
  const tracking = Math.max(moment.tracking[0], moment.tracking[1]);
  return { weight, width, tracking };
}

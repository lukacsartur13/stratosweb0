/**
 * The full ascent: 0 to 30 000 metres, as one number.
 *
 * Same principle as the 0–8 000 m prototype (`src/lib/ascent.ts`) — every layer
 * is a function of a single altitude value, so nothing can fall out of step —
 * but this module is deliberately a *separate* singleton rather than an import
 * of that one. Two routes sharing one mutable module-scoped clock would mean
 * whichever mounted last won, and the short prototype has to keep working
 * unchanged. Nothing here imports `three`; keep it that way, because this file
 * is reachable from the eager entry chunk and the renderer must not be.
 */

import { INTL_TAG, getLocale, m } from './i18n';

export const FLOOR_M = 0;
export const CEILING_M = 30_000;

// -----------------------------------------------------------------------------
// The stage map.
//
// `share` is how much of the *scroll track* a stage gets; `from`/`to` are its
// altitude bounds. The two are deliberately not proportional. Calibration
// covers 150 vertical metres and gets a full screen of scroll because that is
// where the headline and the first CTA live; the run from 11 000 to 17 000 m
// carries five case studies and gets four screens. Mapping scroll to altitude
// linearly would give the case studies a third of a screen and spend six
// screens on empty stratosphere.
//
// This is the single source of truth for the journey. The HTML narrative, the
// HUD phase labels, the camera, the atmosphere and the tests all read it, so a
// stage boundary is changed here once rather than in nine places.
// -----------------------------------------------------------------------------
export type StageId =
  | 'calibration'
  | 'initial-ascent'
  | 'lower-atmosphere'
  | 'cloud-entry'
  | 'cloud-breakthrough'
  | 'selected-work'
  | 'system'
  | 'process'
  | 'stratosphere-transition'
  | 'full-stratosphere'
  | 'destination';

export type Stage = {
  id: StageId;
  /** Altitude at the start of the stage, in metres. */
  from: number;
  /** Altitude at the end of the stage, in metres. */
  to: number;
  /** Relative slice of the scroll track, in viewport heights. */
  share: number;
  /** Short label for the HUD, in the active locale. */
  label: string;
};

export const STAGES: readonly Stage[] = [
  { id: 'calibration',             from: 0,      to: 150,    share: 1.0, label: m('stage.calibration') },
  { id: 'initial-ascent',          from: 150,    to: 3_000,  share: 1.4, label: m('stage.initial-ascent') },
  { id: 'lower-atmosphere',        from: 3_000,  to: 6_000,  share: 2.2, label: m('stage.lower-atmosphere') },
  { id: 'cloud-entry',             from: 6_000,  to: 8_500,  share: 1.6, label: m('stage.cloud-entry') },
  { id: 'cloud-breakthrough',      from: 8_500,  to: 11_000, share: 1.6, label: m('stage.cloud-breakthrough') },
  { id: 'selected-work',           from: 11_000, to: 17_000, share: 4.4, label: m('stage.selected-work') },
  { id: 'system',                  from: 17_000, to: 22_000, share: 2.4, label: m('stage.system') },
  { id: 'process',                 from: 22_000, to: 25_500, share: 3.0, label: m('stage.process') },
  { id: 'stratosphere-transition', from: 25_500, to: 28_000, share: 1.4, label: m('stage.stratosphere-transition') },
  { id: 'full-stratosphere',       from: 28_000, to: 30_000, share: 1.4, label: m('stage.full-stratosphere') },
  // The destination holds at the ceiling. It is the CTA panel, and it is part
  // of the sticky container on purpose — see styles.css and FULL_ASCENT.md for
  // why the scene stays behind it rather than un-sticking into a footer.
  { id: 'destination',             from: 30_000, to: 30_000, share: 1.2, label: m('stage.destination') },
] as const;

/** Total track height in viewport units. */
export const TRACK_VH = STAGES.reduce((sum, s) => sum + s.share, 0);

/**
 * Scroll boundaries, 0..1, one entry per stage.
 *
 * Seeded from the nominal shares above, then *recalibrated from the measured
 * layout* once the panels have laid out — see `calibrate`.
 *
 * The seed is not good enough on its own, and finding out why was the most
 * useful thing the mobile tests did. `share` says how much scroll a stage
 * should get, and on a wide viewport the panel obligingly fits. At 390px the
 * four case studies stack into a single column 4 575px tall against a nominal
 * budget of 2 922, and the process grid collapses to one column and overruns by
 * another 1 229. The narrative ended up ~2 900px longer than the track it was
 * supposed to fill, so the closing CTA fell past the end of the sticky
 * container and landed below the footer — the exact "CTA appears after the
 * sticky scene" defect this route was meant to fix, reintroduced by a constant.
 *
 * Measuring instead of asserting means the altitude curve follows the content
 * wherever it actually lands: any viewport, any font size, any translation
 * length, images loaded or not.
 *
 * Precomputed rather than derived per frame: `stageAt` runs in the clock's hot
 * path, sixty times a second.
 */
type Bound = { id: StageId; start: number; end: number; from: number; to: number };

const BOUNDS: Bound[] = (() => {
  let acc = 0;
  return STAGES.map((s) => {
    const start = acc / TRACK_VH;
    acc += s.share;
    return { id: s.id, start, end: acc / TRACK_VH, from: s.from, to: s.to };
  });
})();

export const STAGE_BOUNDS = BOUNDS;

/**
 * Replace the seeded boundaries with ones measured off the real layout.
 *
 * `measured` maps a stage id to the scroll progress at which its panel reaches
 * the top of the viewport. Entries are applied in stage order and forced
 * monotonic, so a mis-measurement — a panel that has not laid out yet, an image
 * that has not arrived — degrades into a slightly wrong boundary rather than
 * into an altitude that runs backwards.
 *
 * **A stage ends where the next stage begins.** That is the whole of the second
 * pass, and it is not a simplification of an earlier, more careful rule — it is
 * the fix for one.
 *
 * The measurement used to supply an `end` of its own: the progress at which the
 * panel's *bottom* reached the bottom of the viewport. It reads as the more
 * precise definition and it is wrong in two ways that compound.
 *
 *   * A panel exactly one viewport tall — which the calibration panel is, by
 *     design — measures `end === start`. The stage collapses to zero scroll,
 *     `altitudeAt` skips it for every progress above zero, and the first
 *     150 metres of the journey become unreachable. In practice: scroll down
 *     and back to the top, and the readout settles at 150 m in the
 *     initial-ascent stage instead of returning to the 0 m baseline, because
 *     the eased progress approaches zero asymptotically and never lands on it.
 *     The instrument's whole baseline state was one floating-point epsilon away
 *     from being unreachable after any scroll at all.
 *
 *   * For every taller panel the measured `end` falls one viewport short of the
 *     next panel's `start`, so the bounds did not tile the track: there was a
 *     screen-height gap at each of the eleven boundaries, and `altitudeAt`
 *     answers a gap with the next stage's floor. Eleven plateaus where a screen
 *     of scrolling moved the altitude not at all.
 *
 * Ending each stage where the next one begins removes both. The bounds tile
 * [0, 1] exactly, every stage owns real scroll distance, and the altitude is
 * strictly monotonic in progress across the whole track.
 */
export function calibrate(measured: Map<StageId, { start: number }>) {
  const applied: Bound[] = [];

  let floor = 0;
  for (const bound of BOUNDS) {
    const m = measured.get(bound.id);
    if (!m || !Number.isFinite(m.start)) continue;
    bound.start = clamp(Math.max(m.start, floor));
    floor = bound.start;
    applied.push(bound);
  }

  for (let i = 0; i < applied.length; i++) {
    applied[i].end = i + 1 < applied.length ? applied[i + 1].start : 1;
  }

  // The last stage always closes the track, measured or not: the destination
  // panel is the end of the journey, and the altitude must reach exactly
  // 30 000 m there rather than stopping a few hundred metres short.
  BOUNDS[BOUNDS.length - 1].end = 1;
}

export const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** 0..1 progress through an arbitrary sub-range of the track. */
export const span = (v: number, from: number, to: number) => clamp((v - from) / (to - from || 1));

/** Smoothstep, for anything that should arrive rather than stop. */
export const ease = (t: number) => t * t * (3 - 2 * t);

/**
 * Frame-rate independent damping — ten percent of the way per fixed slice of
 * *time*, not per frame, so the motion is identical at 60 and 120 Hz.
 */
export function damp(current: number, target: number, smoothing: number, dt: number) {
  return lerp(current, target, 1 - Math.pow(smoothing, dt * 60));
}

/**
 * How close the eased progress has to get before it is simply *there*.
 *
 * An exponential damper is asymptotic: it halves the remaining distance
 * forever and arrives never. For an animation that is the right shape and the
 * residual is far below anything anyone can see — but it also means the settled
 * value at a given scroll position depends on which side the damper approached
 * from, because it stops one ulp short on whichever side that was.
 *
 * That is not a theoretical concern here, and it is the second half of the
 * 3 000 m defect. Resolving the stage from the altitude made the *rule*
 * direction-free; it did not make the *altitude* direction-free, and the two
 * are only the same thing if a scroll position produces one number. It does not
 * without this: at the `system` boundary the settled altitude came out
 * 16 999.999 97 m going up and 17 000.000 03 m coming down, both displayed as
 * "17 000 m" because the readout rounds to 10 m, and the stage label flipped
 * between them. The page-level regression test in the full-ascent suite catches
 * exactly this, and it caught it after the canonical stage rule was already in
 * place.
 *
 * Snapping makes the settled progress *equal* to the scroll-derived target, so
 * altitude, stage, camera and instrument all become exact functions of scroll
 * position again. The threshold is chosen against what the page can express
 * rather than against floating-point: the scale bar publishes progress to four
 * decimals and the readout rounds to 10 m, and 1e-6 of the track is 4.6 cm at
 * the steepest point of the altitude curve — two orders of magnitude below the
 * finest thing either of them shows.
 */
export const SETTLE_EPSILON = 1e-6;

/**
 * The camera's height above the world origin, as a function of journey
 * progress — and, because the instrument rides with it, the instrument's too.
 *
 * The camera climbs a little across the journey while the mountains, the cloud
 * deck and the sky stay where they are, which is what makes the ascent read as
 * movement through an environment rather than as an environment sliding past.
 *
 * The instrument must not take part in that. It sat near y = 0 while the camera
 * travelled from −0.1 to +0.16 around it, so it rendered above the viewport
 * centre at the bottom of the journey and below it at the top — measured at
 * about 8% of viewport height at 0 m, against a ±3% budget. Anchoring it to the
 * camera's own height puts it on the view axis at every altitude, so it is
 * vertically centred by construction rather than by tuning, and the camera is
 * still free to climb relative to everything else.
 *
 * Exported as one function because two copies of it would drift, and a drift
 * here is the instrument slowly wandering off centre — the exact defect this
 * exists to prevent.
 */
export const CAMERA_Y_GROUND = -0.1;
export const CAMERA_Y_CEILING = 0.16;

export function cameraHeightAt(progress: number): number {
  return lerp(CAMERA_Y_GROUND, CAMERA_Y_CEILING, ease(clamp(progress)));
}

/**
 * The journey clock's smoothing constant, and the largest frame delta it will
 * integrate.
 *
 * Both were inline in `advance` and are named here because the full-ascent
 * suite has to reason about them. A test that waits for the instrument to
 * settle cannot wait a fixed number of milliseconds — how long convergence
 * takes is a function of the frame rate, which on a software rasteriser is an
 * order of magnitude off a real GPU. It can only wait for the *decay* these two
 * numbers describe, so it needs the numbers themselves rather than a copy of
 * them that is free to drift.
 *
 * `MAX_FRAME_DT` deliberately breaks frame-rate independence below 20 Hz: a
 * damper handed a one-second delta jumps straight to its target, and after a
 * stall that reads as a teleport rather than as a catch-up. Capping trades
 * exactness at very low frame rates for motion that always looks damped.
 */
export const JOURNEY_SMOOTHING = 0.82;
export const MAX_FRAME_DT = 1 / 20;

/**
 * `damp`, with an end to it.
 *
 * Every exponentially damped value in this scene has the property described
 * above, not only the journey clock: the camera dolly in `JourneyCamera` eases
 * `z` towards a target that is a function of altitude, and it stops short on
 * whichever side it came from too. Because the mountain range is placed
 * *relative to the camera*, that residual is not academic — it moved the
 * measured root position by a visible amount at the same altitude depending on
 * direction, which is the second thing the Phase 5C determinism probe found.
 *
 * Nothing about the authored motion changes. The target values, the smoothing
 * constants and the four dolly legs are exactly what they were; this only
 * decides when the approach is over instead of letting it run forever.
 */
export function settle(current: number, target: number, smoothing: number, dt: number, epsilon = SETTLE_EPSILON) {
  const next = damp(current, target, smoothing, dt);
  return Math.abs(target - next) < epsilon ? target : next;
}

/** Scroll progress 0..1 → altitude in metres, through the piecewise stage map. */
export function altitudeAt(progress: number): number {
  const p = clamp(progress);
  for (const b of BOUNDS) {
    if (p <= b.end || b === BOUNDS[BOUNDS.length - 1]) {
      return lerp(b.from, b.to, span(p, b.start, b.end));
    }
  }
  return CEILING_M;
}

/**
 * Altitude in metres → the stage it lands in. **The canonical resolution.**
 *
 * ## The defect this replaces
 *
 * There was one stage rule and it was keyed on *scroll progress*:
 *
 *     for (const b of BOUNDS) if (p <= b.end) return b.id;
 *
 * `p <= b.end` is a closed interval on both sides, so a progress value sitting
 * exactly on a boundary belonged to the stage below it — and whether it sat
 * exactly on the boundary depended on how it got there. Scrolling up, the
 * damped `current` approaches the boundary from beneath and never quite reaches
 * it, so 3 000 m reported `initial-ascent`. Scrolling down, it arrives from
 * above and overshoots by an ulp, so the same 3 000 m reported
 * `lower-atmosphere`. Two directions, one altitude, two answers — and because
 * the readout rounds to 10 m, both answers are displayed next to the identical
 * number 3 000.
 *
 * That is not a rounding artefact to be papered over with an epsilon. It is two
 * discretisations of the same boundary: `altitudeAt` maps progress to metres and
 * `stageAt` mapped progress to a stage, independently, so the metres and the
 * stage were free to disagree about which side of the boundary they were on.
 *
 * ## The rule
 *
 * Half-open intervals on altitude, closed at the top of the range:
 *
 *     altitude <  150      calibration
 *     150  <= altitude <  3 000    initial-ascent
 *     3 000 <= altitude <  6 000   lower-atmosphere
 *     …
 *     30 000 <= altitude           destination
 *
 * Expressed as "the last stage whose `from` is at or below the altitude", which
 * is the same thing given that `from` is strictly increasing, and which cannot
 * be written with an off-by-one at a boundary because there is only one
 * comparison in it. At exactly 3 000 m the answer is `lower-atmosphere`,
 * arrived at from either direction, because the interval that *starts* there
 * owns the value.
 *
 * Every consumer goes through here — the visible label, the live region, the
 * debug readout and the tests all read `journey.stage`, which is written from
 * this function once per tick, and `stageAt(progress)` below is now a thin
 * composition rather than a second implementation of the same thresholds.
 */
export function stageAtAltitude(altitude: number): StageId {
  const m = Math.min(CEILING_M, Math.max(FLOOR_M, altitude));
  let found = STAGES[0].id;
  for (const s of STAGES) if (m >= s.from) found = s.id;
  return found;
}

/**
 * Scroll progress 0..1 → the stage it lands in.
 *
 * Composed rather than implemented: progress becomes metres through the one
 * piecewise map, and metres become a stage through the one canonical rule. A
 * second threshold table here is exactly the drift the note above describes.
 */
export function stageAt(progress: number): StageId {
  return stageAtAltitude(altitudeAt(progress));
}

/**
 * The inverse of `altitudeAt`: metres → the scroll progress that produces them.
 *
 * Only the debug panel needs this, and only so that overriding the altitude also
 * moves everything that reads `journey.current` — the camera dolly and the HUD
 * scale bar — instead of leaving them describing a different height from the
 * one the instrument is at. Piecewise-linear and monotonic, so inverting it is
 * a scan rather than a solve.
 */
export function progressAt(metres: number): number {
  const m = Math.min(CEILING_M, Math.max(FLOOR_M, metres));
  for (const b of BOUNDS) {
    if (m <= b.to || b === BOUNDS[BOUNDS.length - 1]) {
      return clamp(lerp(b.start, b.end, span(m, b.from, b.to)));
    }
  }
  return 1;
}

/** 0..1 progress *within* a named stage. 0 outside it. */
export function stageProgress(progress: number, id: StageId): number {
  const b = BOUNDS.find((x) => x.id === id);
  return b ? span(progress, b.start, b.end) : 0;
}

/** The scroll position, 0..1, at which a stage begins. Used by the tests. */
export function stageStart(id: StageId): number {
  return BOUNDS.find((x) => x.id === id)?.start ?? 0;
}

/**
 * What the mountain range is doing, independently of the altitude.
 *
 * `timeline` is production and is the only value anything ever writes on its
 * own. The two forced states exist because the A/B benchmark needs a baseline,
 * and the way it used to get one — clearing `visible` on the range's root from
 * outside — did not work: `MountainRange`'s `useFrame` re-asserts `visible`
 * from `mountainStateAt` on the very next frame, so both arms measured a scene
 * with mountains in it and reported identical triangle counts to the digit.
 *
 * The fix has to be a state the timeline itself honours, which is what this is.
 * `forced-off` suppresses drawing but keeps the asset resident, so an
 * interleaved A/B/A/B run toggles a boolean rather than re-fetching and
 * re-decoding a DRACO mesh between every sample.
 */
export type MountainMode = 'timeline' | 'forced-on' | 'forced-off';

/**
 * Development-only mountain art direction. `null` means "the preset decides",
 * which is what production always gets — see `mountainLook.ts`.
 */
export type MountainDebug = {
  /** `auto` follows the loaded GLB variant. */
  preset: 'auto' | 'desktop' | 'mobile';
  /** Key light direction, in degrees. See `Direction` in mountainLook.ts. */
  keyAzimuth: number | null;
  keyElevation: number | null;
  keyIntensity: number | null;
  fillIntensity: number | null;
  /** Per-anchor brightness on the depth ramp: foreground, midground, background. */
  levelNear: number | null;
  levelMid: number | null;
  levelFar: number | null;
  crestGain: number | null;
  valleyDarken: number | null;
  /** Multipliers on the two atmospheric densities. */
  depthFog: number | null;
  heightFog: number | null;
  /** sRGB hex for the atmosphere colour. */
  atmosphere: number | null;
  /**
   * Extra camera-station nudge, in model metres, on top of `STATION_OFFSET`.
   * Positive `forward` moves the station deeper into the valley; positive
   * `rise` lifts it. Development only — the shipped offsets live in
   * `mountainLook.ts` so `cameraStation` stays a pure function of altitude.
   */
  stationForward: number;
  stationRise: number;
};

// -----------------------------------------------------------------------------
// The mutable journey state. One object, read by everything, written by the
// clock in JourneyHUD and by the scroll driver.
// -----------------------------------------------------------------------------
export const journey = {
  /** Scroll progress, 0..1, written by ScrollTrigger. */
  target: 0,
  /** Eased progress, 0..1, advanced once per frame by exactly one owner. */
  current: 0,
  /** `current` expressed in metres, through the piecewise map. */
  altitude: FLOOR_M,
  /** 0..1 across the instrument's power-on ramp. */
  power: 0,
  /** The stage `current` lands in. */
  stage: 'calibration' as StageId,
  /** Pointer position in clip space, -1..1, for the parallax budget. */
  pointer: { x: 0, y: 0 },
  /** False while the tab is hidden, so nothing integrates against a stalled clock. */
  running: true,
  /**
   * Dev-only overrides, written by the debug panel. Production builds never
   * mount the panel, and every read below is a plain multiply, so leaving the
   * hooks in costs nothing measurable.
   */
  debug: {
    cloudDensity: 1,
    /**
     * Freeze every time-dependent term in the cloud system, without freezing
     * the altitude.
     *
     * §8 requires validation mode to be able to freeze all cloud motion, and
     * `freeze` above is not that: it stops `advance` entirely, so the sweep
     * could not move between altitudes. The cloud clock is the only integrated
     * quantity in the deck, so stopping it is sufficient — every other cloud
     * value is already a pure function of altitude.
     */
    cloudFreeze: false,
    /**
     * Hold the runtime quality ladder still.
     *
     * The ladder is a property of *this session's measured frame budget*, not of
     * the scene, and it is one-way: once `PerformanceMonitor` declines, the
     * scene stays stepped down. On a software rasteriser it declines almost
     * immediately, which made the first cloud sweep measure a forward pass at
     * full layer counts and a reverse pass at stepped ones and report six
     * direction-dependent results that were nothing of the kind.
     *
     * A validation run has to hold it still to measure the thing it is about.
     * Production never writes this, and pinning is *not* the same as disabling:
     * `stepDown` still runs and is still the only writer, it simply declines to
     * act while this is set.
     */
    cloudPinQuality: false,
    starDensity: 1,
    earthScale: 1,
    horizonGlow: 1,
    atmosphereDark: 1,
    cameraZ: 0,
    freeze: false,

    // --- Meridian overrides ------------------------------------------------
    // `null` and `'auto'` mean "the scene decides", which is what production
    // always gets: the panel that writes these is never built. Each is read as
    // a plain null-check or multiply on the hot path.
    /** Drive the altitude directly, ignoring the scroll position. */
    altitude: null as number | null,
    /** Override the aperture, 0..1. */
    aperture: null as number | null,
    /** Override each ring's lock progress, 0..1. */
    ringLock: [null, null, null] as (number | null)[],
    /** Multiplier on the rings' governed idle rotation. */
    ringRotation: 1,
    /** Extra yaw on the instrument, radians — the three-quarter reveal. */
    instrumentYaw: 0,
    /** Multiplier on the aperture's breakthrough light. */
    lightGain: 1,
    /** Override the final calibrated stop-down, 0..1. */
    finalCalibration: null as number | null,
    /** Force the simplified geometry and material path. */
    quality: 'auto' as 'auto' | 'full' | 'reduced',
    /**
     * Force a capability failure, to inspect a fallback without a device that
     * produces one. `prefers-reduced-motion` cannot be set from script, so this
     * is the only way to look at that path in a browser that is not configured
     * for it — and the Playwright suite still asserts the *real* media query,
     * never this.
     */
    forceFallback: 'none' as 'none' | 'reduced-motion' | 'no-webgl',

    // --- mountains ----------------------------------------------------------
    /**
     * Persistent override the mountain timeline honours. Read once per frame
     * by `mountainStateAt` and by the residency rule in `JourneyScene`, so a
     * benchmark can hold an arm for as long as it likes without the next frame
     * putting the range back.
     */
    mountains: 'timeline' as MountainMode,
    /** Art direction. Every field `null` in production; see `MountainDebug`. */
    mountainLook: {
      preset: 'auto',
      keyAzimuth: null,
      keyElevation: null,
      keyIntensity: null,
      fillIntensity: null,
      levelNear: null,
      levelMid: null,
      levelFar: null,
      crestGain: null,
      valleyDarken: null,
      depthFog: null,
      heightFog: null,
      atmosphere: null,
      stationForward: 0,
      stationRise: 0,
    } as MountainDebug,
  },
};

/**
 * Announce that a development override changed.
 *
 * The debug panel writes to a plain object, which nothing re-renders for. The
 * things that read `journey.debug` inside a frame callback pick the new value
 * up on the next frame for free; the two that are read during *render* — the
 * quality tier and the forced fallback — need to be told. Dev only: every
 * listener is registered inside an `import.meta.env.DEV` branch, so production
 * neither dispatches nor listens.
 */
export const DEBUG_EVENT = 'stratos-meridian-debug';
export const notifyDebugChange = () => dispatchEvent(new Event(DEBUG_EVENT));

/**
 * Advance the eased value. Called once per frame, by exactly one owner —
 * JourneyHUD — and never from `useFrame`.
 *
 * The reason is the same one the short prototype documents, and it matters more
 * here because the journey is eleven screens long: the canvas frameloop is
 * parked whenever the canvas leaves the viewport or the tab goes to the back,
 * and a clock living inside `useFrame` freezes with it. On a 1 100 vh track
 * that would strand the altitude somewhere in the lower atmosphere and never
 * reach 30 000 m. A plain rAF is a few multiplies and keeps the number honest
 * whatever the renderer is doing.
 */
export function advance(dt: number) {
  if (journey.debug.freeze) return journey;

  // The debug altitude override drives `current` rather than `altitude`, so
  // every consumer stays consistent: the camera dolly, the HUD scale bar and
  // the stage label all read `current`, and setting the metres without setting
  // the progress would put the instrument at 24 000 m with the camera framing
  // for the ground.
  const forced = journey.debug.altitude;
  // `settle` rather than `damp`: land on the target instead of approaching it
  // forever. See SETTLE_EPSILON — this is what makes a scroll position produce
  // one altitude instead of two that differ in the eighth decimal depending on
  // the direction it was approached from.
  journey.current =
    forced === null
      ? settle(journey.current, journey.target, JOURNEY_SMOOTHING, Math.min(dt, MAX_FRAME_DT))
      : progressAt(forced);

  journey.altitude = altitudeAt(journey.current);
  journey.power = ease(span(journey.current, 0.02, 0.09));
  // From the altitude, not from the progress. The two are the same number
  // expressed twice, and resolving the stage from the one the visitor is shown
  // is what makes the label and the readout incapable of disagreeing.
  journey.stage = stageAtAltitude(journey.altitude);
  return journey;
}

/**
 * Thousands separator for the altitude readout.
 *
 * Was hard-coded to `hu-HU`. The homepage now renders in three locales and a
 * Hungarian thin-space grouping inside an English page is the kind of detail
 * that reads as a bug rather than as a missing translation, so the tag follows
 * the document's language. The *copy* is still untranslated on /en/ and /de/ —
 * this only fixes the number.
 */
const fmt = new Intl.NumberFormat(INTL_TAG[getLocale()], { maximumFractionDigits: 0 });
export const formatAltitude = (m: number) => fmt.format(Math.round(m));

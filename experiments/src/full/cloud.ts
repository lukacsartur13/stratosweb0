/**
 * The cloud system's state, as one pure function of altitude.
 *
 * ## Why this file exists rather than a `useFrame` body
 *
 * The cloud deck this replaces derived its own numbers inside its own frame
 * callback, from constants that were private to it. Three things followed, and
 * all three are the reason §6 asks for a single canonical calculation:
 *
 *   * **It was timed to the wrong event.** Its four beats ran 6 000 → 10 600 m,
 *     so the deck was already behind the camera by 10 600 while the aperture
 *     breakthrough — `ALTITUDE_STOPS.breakthrough`, and the primary event of the
 *     whole journey — happens at 12 000. The clouds cleared 1 400 m before the
 *     thing they exist to make credible, and nothing could notice, because the
 *     two timelines had no term in common.
 *   * **Nothing else could read it.** The mountain fade, the aperture clearance
 *     and the instrument's contrast protection all need to know what the clouds
 *     are doing. Each would have had to re-derive it, which is the drift §6
 *     forbids by name.
 *   * **It could not be validated.** A sweep can compare two runs of a function.
 *     It cannot compare two runs of a frame callback without also reproducing
 *     the frame timing, which is exactly the thing that is not reproducible.
 *
 * ## The rules this file keeps
 *
 * **Pure.** No module state, no `Date.now`, no `Math.random`, nothing imported
 * from `three`. Every field of the result is a function of the four inputs and
 * nothing else, so forward and reverse traversal produce identical results by
 * construction rather than by tuning (§6). The one time-dependent quantity in
 * the system — drift — is deliberately *not* here; see `driftAt` below, which
 * takes the clock as an argument rather than reading one.
 *
 * **Total.** Every branch returns a finite number for every finite input. A NaN
 * in a transform removes an object from the scene silently rather than throwing,
 * which is the worst failure mode available.
 *
 * **Layered, not volumetric.** §5's implementation order starts at "layered
 * depth-aware cloud planes" and this never leaves step one. There is no second
 * canvas, no second render loop, no render target, no post-processing pass and
 * no new texture download — the deck is drawn with the runtime-rasterised
 * texture the previous implementation already used, which costs zero bytes of
 * transfer.
 */

import { ALTITUDE_STOPS } from './meridian';
import { MOUNTAIN_FADE_FROM } from './mountains';

// =============================================================================
// The timeline. §7's ranges, as named constants, because every one of them is
// referenced from at least two places and a literal in a frame callback is how
// the previous deck ended up 1 400 m out of step with the breakthrough.
// =============================================================================

/** 12 000 m. The aperture event, and the anchor for everything below. */
export const BREAKTHROUGH_M = ALTITUDE_STOPS.breakthrough;

export const CLOUD_STOPS = {
  /** Below this the sky is clear. §7: "no visible cloud wall" to 7 000 m. */
  firstPresence: 7_000,
  /** Distant forms are established; mountains still dominate. */
  established: 9_500,
  /** Density starts genuinely building; distant ridges begin to go. */
  building: 11_000,
  /** The camera enters the threshold. Mountains progressively yield. */
  threshold: 11_700,
  /** Closure peaks. The aperture is the destination. */
  closure: BREAKTHROUGH_M,
  /** The release. Deliberately shorter than the approach — see `coverageAt`. */
  released: 12_600,
  /** The upper-atmosphere composition has taken over. */
  settled: 13_000,
  /** The enclosure layers are gone by here; only the floor deck remains. */
  enclosureGone: 13_000,
  /** The floor deck has receded out of the frame. */
  floorGone: 18_000,
} as const;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (t: number) => t * t * (3 - 2 * t);
const range = (v: number, a: number, b: number) => clamp01((v - a) / (b - a || 1));
/** Smoothstepped progress through a range. The only easing used in this file. */
const s = (v: number, a: number, b: number) => smooth(range(v, a, b));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// =============================================================================
// Inputs.
// =============================================================================

/**
 * The part of the measured viewport the cloud composition depends on.
 *
 * Structurally a subset of `composition.ts`'s `Fit`, so the live `Fit` is
 * assignable without a conversion — but declared here rather than imported so
 * that this module stays a leaf. `composition.ts` is 1 500 lines that reach into
 * the DOM; the cloud sweep has to be able to call `getCloudState` in Node with a
 * literal.
 */
export type CloudViewport = {
  vw: number;
  vh: number;
  aspect: number;
  portrait: boolean;
};

/** The renderer's tier, as `FullAscent` already computes it. */
export type CloudQualityTier = 'full' | 'reduced';

export type CloudInput = {
  altitude: number;
  viewport: CloudViewport;
  qualityTier: CloudQualityTier;
  reducedMotion: boolean;
};

/**
 * §11's five art directions, resolved from the measured box.
 *
 * Ordered most-specific first. `mobile-landscape` has to be tested before
 * `tablet` because a phone held sideways is 844x390 — wider than a tablet in
 * portrait and a quarter of its height — and treating it as a small desktop is
 * how a horizontal cloud stripe across the middle of the frame happens, which
 * §11 forbids by name.
 */
export type CloudArtDirection =
  | 'desktop-wide'
  | 'desktop-standard'
  | 'tablet'
  | 'portrait-mobile'
  | 'mobile-landscape';

export function artDirectionFor(v: CloudViewport): CloudArtDirection {
  if (!v.portrait && v.vh <= 500) return 'mobile-landscape';
  if (v.portrait) return v.vw < 700 ? 'portrait-mobile' : 'tablet';
  if (v.vw >= 1280 && v.aspect >= 1.5) return 'desktop-wide';
  if (v.vw >= 1024) return 'desktop-standard';
  return 'tablet';
}

// =============================================================================
// Layer budgets. §12's degradation order starts at "cloud layer count", so this
// table is the first thing quality reduction touches and the Meridian's DPR
// floor is the last.
// =============================================================================

/**
 * How many planes each role gets, per art direction, at the full tier.
 *
 * `distant` is cheap — a handful of wide, low-contrast planes far away, drawn
 * once and barely overlapping. `enclosure` is the expensive one: these are the
 * planes the camera passes *through*, they cover most of the frame, and they are
 * pure overdraw. `floor` is cheap again for the same reason `distant` is.
 *
 * Portrait mobile gets the fewest enclosure planes and the most vertical
 * structure, per §11 — "a simpler vertical cloud structure", "avoid lateral
 * wedges", "avoid covering the entire viewport". Mobile landscape gets fewer
 * still, because the frame is 390 px tall and anything crossing it laterally is
 * the stripe §11 forbids.
 */
const BUDGET: Record<CloudArtDirection, { distant: number; enclosure: number; floor: number }> = {
  'desktop-wide': { distant: 9, enclosure: 22, floor: 14 },
  'desktop-standard': { distant: 8, enclosure: 18, floor: 12 },
  tablet: { distant: 6, enclosure: 13, floor: 9 },
  'portrait-mobile': { distant: 5, enclosure: 10, floor: 7 },
  'mobile-landscape': { distant: 5, enclosure: 8, floor: 6 },
};

/**
 * The reduced tier's multiplier, and the runtime step-down's.
 *
 * Two separate reductions because they answer different questions. The tier is
 * decided once, before the renderer exists, from `isHandheld()`. The step is
 * decided at runtime by `PerformanceMonitor`, after frames have actually been
 * missed — and §12 requires it to spend cloud layers *before* it spends
 * anything belonging to the instrument.
 */
const TIER_SCALE: Record<CloudQualityTier, number> = { full: 1, reduced: 0.62 };

/**
 * The one permitted runtime step, as a further multiplier on the layer count.
 *
 * Deliberately not a second DPR ladder. §12 is explicit that the renderer's
 * pixel ratio has exactly one canonical owner and that reducing quality means
 * reducing *cloud* work first; this is that first step, and it is the only
 * lever this module gives the performance monitor.
 */
export const CLOUD_STEP_DOWN_SCALE = 0.55;

// =============================================================================
// The curves.
// =============================================================================

/**
 * How much of the frame the cloud system occupies, 0..1. The master curve —
 * every other presence value is derived from it or gated by it.
 *
 * Five segments, each smoothstepped, each meeting its neighbour at the value the
 * neighbour starts from, so the composite is continuous and has continuous first
 * derivative at every knot. That is what §14's "abrupt opacity changes" and
 * "abrupt layer changes" checks are actually testing for, and it is a property
 * of the construction rather than something to be measured and tuned into place.
 *
 * The fall is faster than the rise on purpose, and it is the one asymmetry in
 * the file: 5 000 m of approach against 600 m of release. Emerging from a cloud
 * layer is a release, and a symmetric fade reads as the same event played
 * backwards — which is precisely the "flat opacity overlay" §4 rejects.
 */
export function coverageAt(altitude: number): number {
  const k = CLOUD_STOPS;
  if (altitude <= k.firstPresence) return 0;
  if (altitude <= k.established) return lerp(0, 0.18, s(altitude, k.firstPresence, k.established));
  if (altitude <= k.building) return lerp(0.18, 0.52, s(altitude, k.established, k.building));
  if (altitude <= k.threshold) return lerp(0.52, 0.86, s(altitude, k.building, k.threshold));
  if (altitude <= k.closure) return lerp(0.86, 1, s(altitude, k.threshold, k.closure));
  if (altitude <= k.released) return lerp(1, 0.3, s(altitude, k.closure, k.released));
  if (altitude <= k.settled) return lerp(0.3, 0.08, s(altitude, k.released, k.settled));
  // The tail, down to nothing.
  //
  // This segment was missing, and the sweep caught it: without it the final
  // branch returned `lerp(0.3, 0.08, 1)` — a flat 0.08 — for *every* altitude
  // above 13 000 m, so `visible` stayed true to 30 000 m. Nothing was drawn,
  // because all three roles' presences are zero up there, but the root group was
  // never culled and the state reported a cloud system that was not there. §7
  // asks for the scene to become cleaner above 13 000 m; a coverage that never
  // reaches zero is the opposite of that claim being checkable.
  return lerp(0.08, 0, s(altitude, k.settled, k.floorGone));
}

/**
 * The enclosure's own presence: the planes the camera passes through.
 *
 * Zero until the deck is genuinely close, and gone by 13 000 m — §7's "unnecessary
 * cloud layers stop updating or unmount". This is the term that makes the scene
 * get *cleaner* above the breakthrough rather than busier.
 */
export function enclosureAt(altitude: number): number {
  const k = CLOUD_STOPS;
  const rise = s(altitude, k.established, k.closure);
  const fall = 1 - s(altitude, k.closure, k.enclosureGone);
  return rise * fall;
}

/**
 * The deck seen from above — the thing that makes the breakthrough legible.
 *
 * Rises just *before* the breakthrough, not after it. A floor that only appears
 * once the camera is already above the deck reads as an object popping into
 * existence; one that is already establishing itself as the enclosure thins
 * reads as the deck the camera has been inside all along, now resolving into a
 * surface. That ordering is the whole of what makes 12 000 m feel like passing
 * through something rather than a cross-fade between two states.
 */
export function floorAt(altitude: number): number {
  const k = CLOUD_STOPS;
  return s(altitude, k.threshold, k.released) * (1 - s(altitude, k.settled, k.floorGone));
}

/**
 * The distant forms. §7's 7 000–9 500 m "clouds remain secondary".
 *
 * Outlives the enclosure slightly, because the horizon is the last place a cloud
 * layer is visible from above and cutting it at the same altitude as the
 * enclosure leaves a visibly empty horizon for the 600 m of the release.
 */
export function distantAt(altitude: number): number {
  const k = CLOUD_STOPS;
  return s(altitude, k.firstPresence, k.building) * (1 - s(altitude, k.closure, k.settled));
}

// -----------------------------------------------------------------------------
// Vertical placement.
//
// The world descends past a nearly stationary camera — see `JourneyCamera`, and
// the far plane of 60 that arrangement exists to permit. So "climbing into the
// cloud layer" is the layer coming *down* past the camera, and the breakthrough
// is the altitude at which it finishes doing so.
//
// ## Why there are three of these and not one
//
// There was one, and it was wrong in a way the first review still caught
// immediately: a single ramp from 0 to −22 over 7 000–13 000 m put the *whole*
// system at the camera's own height at 7 000 m and twenty units below it by
// 11 800 m. At 11 800 — the altitude §7 describes as peak closure — the deck was
// entirely out of frame below, so the state reported `coverage: 0.896` while the
// picture showed clear sky. The numbers were self-consistent and the composition
// was empty, which is exactly the failure mode §32 warns about: geometry checks
// pass, the still is visually weak.
//
// The three roles have genuinely different vertical jobs, so they get three
// functions:
//
//   * `distant` is the horizon. It does not descend at all — a horizon that
//     sinks is a horizon that stops being one.
//   * `enclosure` starts above the camera, arrives *at* it at the breakthrough,
//     and sinks below afterwards. This is the term that makes 12 000 m read as
//     passing through something.
//   * `floor` sits just under the enclosure as it thins, then recedes steadily.
//     It is the deck seen from above.
//
// All three are monotonic or piecewise-monotonic in altitude and none of them
// has state, so forward and reverse traversal produce identical positions.
// -----------------------------------------------------------------------------

/**
 * The enclosure's height relative to the camera.
 *
 * Positive is above. Zero at the breakthrough, by construction: that is what
 * "the camera is inside the deck at 12 000 m" means, and expressing it as a
 * value that *is* zero there rather than one that happens to be small there is
 * what keeps the beat pinned to the canonical altitude.
 */
export function enclosureYAt(altitude: number): number {
  const k = CLOUD_STOPS;
  return lerp(8.5, 0, s(altitude, k.established, k.closure)) - lerp(0, 11, s(altitude, k.closure, k.settled));
}

/** The floor deck's height. Always below the camera once it exists. */
export function floorYAt(altitude: number): number {
  const k = CLOUD_STOPS;
  return (
    lerp(-0.6, -2.2, s(altitude, k.threshold, k.closure)) -
    lerp(0, 9, s(altitude, k.settled, k.floorGone))
  );
}

/**
 * The horizon band's height. A constant, and deliberately so.
 *
 * Slightly below the view axis, which is where a horizon is. It is the one part
 * of the cloud system that is not a function of altitude, because the thing it
 * represents — the far edge of the world — does not move relative to the camera
 * as the camera climbs.
 */
export const DISTANT_Y = -0.9;

/**
 * The radius, in world units at the instrument's depth, that the cloud system
 * keeps clear around the view axis. §7: "the aperture itself remains clear".
 *
 * Widest exactly at closure, which is the altitude at which the enclosure is
 * densest and therefore the altitude at which the instrument is most at risk of
 * being swallowed. §9 forbids solving that by moving the instrument off its
 * Phase 6 rails, so the clouds are what move.
 */
export function apertureClearanceAt(altitude: number): number {
  const k = CLOUD_STOPS;
  const open = s(altitude, k.building, k.closure);
  const close = 1 - s(altitude, k.closure, k.settled);
  return CLEARANCE_BASE + CLEARANCE_PEAK * open * close;
}

/**
 * The clearance radius, in world units at the enclosure's depth.
 *
 * Sized against the instrument rather than chosen: the Meridian's essential
 * height is 1.045 local units at a camera distance of about 2.35, so it subtends
 * roughly 12.5°. The nearest enclosure planes sit at z ≈ −1.2, which is 3.55
 * from the camera, and 3.55·tan(12.5°) ≈ 0.79 world units. A peak of 1.05 clears
 * the instrument with about a third of its own radius as margin.
 *
 * The first attempt used 1.7, which is 25.6° at that depth against a half-field
 * of 16° — a "clearance" wider than the frame, which pushed every near plane
 * completely out of view and was the second half of why 11 800 m photographed as
 * clear sky. Sizing this against the object it protects rather than against a
 * number that looked generous is the difference.
 */
const CLEARANCE_BASE = 0.3;
const CLEARANCE_PEAK = 0.75;

/**
 * The mountains' disappearance, reported rather than owned.
 *
 * `mountains.ts` fades the range from `MOUNTAIN_FADE_FROM` to the breakthrough
 * and that is Phase 6 accepted behaviour this phase must not reopen. The value
 * is recomputed here from the *same imported constant* so that the cloud system
 * and the range cannot disagree about when the ridges go — §7 asks for "no
 * abrupt mountain visibility switch", and two independently-tuned fades either
 * side of the same altitude is how you get one.
 *
 * Nothing in `mountains.ts` reads this back. The direction of the dependency is
 * deliberate: the range is the accepted thing, the clouds are the new thing, and
 * the new thing is what adapts.
 */
export function mountainFadeAt(altitude: number): number {
  return s(altitude, MOUNTAIN_FADE_FROM, BREAKTHROUGH_M);
}

/**
 * The headroom the cloud system leaves the instrument, 0..1, where 1 is "the
 * Meridian is entirely unaffected".
 *
 * Not a request — a *cap*, applied to every near plane's opacity in the
 * renderer, and reported here so the sweep can assert it without reading pixels
 * first. It never falls below `MERIDIAN_CONTRAST_FLOOR`, at any altitude, on any
 * viewport, at any tier: §9 requires the silhouette, the outer ring, the active
 * rings, the aperture and the modelled tick marks to stay readable *at every
 * tested altitude*, and a floor is the only form of that promise which cannot be
 * tuned away by a later adjustment to the density curve.
 */
export const MERIDIAN_CONTRAST_FLOOR = 0.62;

export function meridianContrastAt(altitude: number): number {
  const swallow = enclosureAt(altitude);
  return Math.max(MERIDIAN_CONTRAST_FLOOR, 1 - 0.38 * swallow);
}

// =============================================================================
// The result.
// =============================================================================

export type CloudState = {
  /** Whether anything is drawn at all. False below 7 000 m and above 18 000 m. */
  visible: boolean;
  /** Whether the enclosure planes should be mounted. §7, above 13 000 m: no. */
  enclosureResident: boolean;
  /** 0..1 master presence. */
  coverage: number;
  /** 0..1 how thick the deck reads where it is present. */
  density: number;
  /** 0..1 peak material opacity, after the Meridian contrast cap. */
  opacity: number;
  /** World-unit depth range the planes are distributed through. */
  depth: number;
  /**
   * The system's principal vertical offset — the enclosure's, because that is
   * the layer the camera is inside. Zero at the breakthrough. Negative is below.
   */
  verticalPosition: number;
  /** Per-role vertical offsets. See the note above `enclosureYAt`. */
  y: { distant: number; enclosure: number; floor: number };
  /** World-unit half-width the planes spread across. */
  lateralSpread: number;
  /** World-unit radius kept clear around the view axis. */
  apertureClearance: number;
  /** 0..1, matching the range's own fade. */
  mountainFade: number;
  /** 0..1 headroom left for the instrument. Never below the floor. */
  meridianContrast: number;
  /** Planes actually drawn, per role, and in total. */
  layers: { distant: number; enclosure: number; floor: number };
  /** The same, unrounded. The fractional part fades the boundary plane. */
  layersExact: { distant: number; enclosure: number; floor: number };
  layerCount: number;
  /** Per-role presence, 0..1. */
  presence: { distant: number; enclosure: number; floor: number };
  /** Texture resolution the deck rasterises at. §12's "cloud sampling". */
  sampling: number;
  /** World units per second of lateral drift. Zero under reduced motion. */
  driftRate: number;
  qualityTier: CloudQualityTier;
  art: CloudArtDirection;
};

/**
 * The camera's vertical field of view, and the depth the layout is normalised
 * against.
 *
 * `FOV` is 32° and is shared with `composition.ts` and with the Blender scene —
 * it is not a number to pick here. `REFERENCE_DISTANCE` is the distance from the
 * camera to the *nearest* enclosure plane: the camera sits at z = 2.35 and the
 * nearest plane at z = −1.2.
 */
const FOV_RAD = (32 * Math.PI) / 180;
const REFERENCE_DISTANCE = 3.55;

/**
 * How much wider than the frame each art direction spreads its planes.
 *
 * ## Why this is a factor and not a width
 *
 * It was a width — a half-width in world units, per art direction, from a table.
 * That is wrong in a way that only shows up at depth, and the first cloud stills
 * showed it: the layout multiplied the table's half-width by a perspective term
 * of `|z| / 3`, so the planes at the back of a 9-unit-deep volume were scattered
 * across ±16 world units while the frustum is only ±5.7 wide there. Most of the
 * far enclosure was outside the frame, which is half of why 11 800 m
 * photographed as a thin haze while the state reported 90% coverage.
 *
 * Expressed as a multiple of the *frame's own half-width at that depth*, the
 * spread is correct at every depth by construction, and it follows the viewport
 * without a table: a 390×844 phone has a horizontal half-field of about 7.5°
 * against a 1440×900 desktop's 24.6°, so the same factor produces a composition
 * that fills each frame rather than one that fills the desktop and misses the
 * phone.
 *
 * The factors themselves are §11's art direction. Portrait gets the narrowest
 * overfill — "avoid lateral wedges", "avoid covering the entire viewport" —
 * and the two desktop directions the widest, for "full environmental depth".
 */
const OVERFILL: Record<CloudArtDirection, number> = {
  'desktop-wide': 1.6,
  'desktop-standard': 1.5,
  tablet: 1.4,
  'portrait-mobile': 1.25,
  'mobile-landscape': 1.5,
};

/** How far back the planes are distributed. Portrait gets a narrow, *deep*
 *  volume and landscape a wide, shallow one. */
const DEPTH: Record<CloudArtDirection, number> = {
  'desktop-wide': 9,
  'desktop-standard': 8,
  tablet: 7,
  'portrait-mobile': 8.5,
  'mobile-landscape': 5.5,
};

/**
 * The frame's half-width in world units at the reference depth.
 *
 * The horizontal field follows from the vertical one and the aspect ratio, which
 * is the same relation `composition.ts` uses to project the instrument — so the
 * clouds and the instrument are measured against one camera, not two.
 */
export function frameHalfWidth(viewport: CloudViewport): number {
  const hHalf = Math.atan(Math.tan(FOV_RAD / 2) * Math.max(viewport.aspect, 0.3));
  return REFERENCE_DISTANCE * Math.tan(hHalf);
}

/**
 * Peak opacity per art direction.
 *
 * Lower on the two mobile directions, and not for performance. §11 asks portrait
 * to "avoid covering the entire viewport" and landscape to "keep copy readable
 * in the reduced height" — on a 390 px-tall frame the copy column and the
 * instrument occupy nearly all of it, so there is no part of the frame a cloud
 * plane can be opaque in without being behind something that has to stay
 * legible. §10 is the binding constraint on a phone, not the frame budget.
 */
const PEAK_OPACITY: Record<CloudArtDirection, number> = {
  'desktop-wide': 0.82,
  'desktop-standard': 0.8,
  tablet: 0.74,
  'portrait-mobile': 0.66,
  'mobile-landscape': 0.6,
};

/**
 * The canonical cloud state. **The only place cloud presence is decided.**
 *
 * `stepped` is the runtime quality step described above. It is a separate
 * argument rather than a fifth field of `CloudInput` because §6 fixes the shape
 * of the input and because it is not a property of the *scene* — it is a
 * property of this session's measured frame budget, and a sweep that wants to
 * compare two altitudes must be able to hold it constant without constructing a
 * renderer.
 */
export function getCloudState(input: CloudInput, stepScale = 1): CloudState {
  const { altitude, viewport, qualityTier, reducedMotion } = input;
  const m = Number.isFinite(altitude) ? altitude : 0;
  const art = artDirectionFor(viewport);
  const step = Math.min(1, Math.max(CLOUD_STEP_DOWN_SCALE, Number.isFinite(stepScale) ? stepScale : 1));

  const coverage = coverageAt(m);
  const distant = distantAt(m);
  const enclosure = enclosureAt(m);
  const floor = floorAt(m);
  const meridianContrast = meridianContrastAt(m);

  // The layer budget, tier scale and runtime step, in that order.
  //
  // ## Why the count follows the presence
  //
  // It did not, and the sweep flagged 168 cases of it: the count was the full
  // budget the instant a role's presence rose above zero, so the enclosure
  // mounted all 22 planes in a single 10 m step at 9 500 m. That is invisible —
  // the role's opacity is zero at exactly that altitude, which is why it
  // photographed fine — but it is invisible *by luck*, and §14's "abrupt layer
  // changes" is a check on the count, not on whether the count happened to be
  // multiplied by zero.
  //
  // Scaling the count by the presence makes the planes arrive one at a time as
  // the role fades in, which is both the honest reading of the requirement and
  // strictly cheaper: at 20% presence the enclosure now draws four planes rather
  // than twenty-two.
  //
  // `layersExact` is the unrounded value, and it exists so the renderer can fade
  // the boundary plane by the fractional part. Without that the count is smooth
  // but each individual plane still appears at full opacity; with it, nothing in
  // the system ever changes discontinuously.
  const budget = BUDGET[art];
  const scale = TIER_SCALE[qualityTier] * step;
  const exact = (role: number, presence: number) => (presence <= 1e-4 ? 0 : role * scale * presence);

  const layersExact = {
    distant: exact(budget.distant, distant),
    enclosure: exact(budget.enclosure, enclosure),
    floor: exact(budget.floor, floor),
  };
  // Ceiling, so a role with any presence at all draws at least one plane and the
  // fractional remainder is carried by the boundary plane's alpha.
  const layers = {
    distant: Math.ceil(layersExact.distant),
    enclosure: Math.ceil(layersExact.enclosure),
    floor: Math.ceil(layersExact.floor),
  };

  const volume = { spread: frameHalfWidth(viewport) * OVERFILL[art], depth: DEPTH[art] };

  return {
    visible: coverage > 0.001 || floor > 0.001,
    // Mounted a little past where they stop being drawn, so the unmount is never
    // the thing anyone sees — the same split `mountains.ts` makes between
    // `HIDE_ABOVE` and `UNMOUNT_ABOVE`, and for the same reason.
    enclosureResident: m < CLOUD_STOPS.enclosureGone + 600,
    coverage,
    density: coverage * lerp(0.7, 1, enclosure),
    // The contrast cap is applied *here*, once, rather than at each material.
    // That is what makes `MERIDIAN_CONTRAST_FLOOR` a property of the system
    // instead of a convention every call site has to remember.
    opacity: PEAK_OPACITY[art] * coverage * meridianContrast,
    depth: volume.depth,
    verticalPosition: enclosureYAt(m),
    y: { distant: DISTANT_Y, enclosure: enclosureYAt(m), floor: floorYAt(m) },
    lateralSpread: volume.spread,
    apertureClearance: apertureClearanceAt(m),
    mountainFade: mountainFadeAt(m),
    meridianContrast,
    layers,
    layersExact,
    layerCount: layers.distant + layers.enclosure + layers.floor,
    presence: { distant, enclosure, floor },
    // §12's "cloud sampling", and the second thing quality reduction spends.
    // Not blended: the texture is rasterised once per mount, so this switches on
    // the *decision* rather than following the eased scale.
    sampling: qualityTier === 'reduced' || step < 1 ? 128 : 256,
    // §26: static deterministic atmospheric state, no continuous drift. Not a
    // slowed drift — zero. A slow drift is still "constant background activity",
    // which §8 lists among the things to avoid even at full motion.
    driftRate: reducedMotion ? 0 : DRIFT_RATE,
    qualityTier,
    art,
  };
}

// =============================================================================
// Motion. §8.
// =============================================================================

/**
 * World units per second, at the enclosure's depth. One direction, no
 * turbulence, no per-plane velocity.
 *
 * Slow enough that a plane crosses its own width in about three minutes, which
 * is well past the time anyone spends at one altitude and is the point: the
 * movement should be perceptible only as the scene not being a photograph.
 */
export const DRIFT_RATE = 0.011;

/**
 * The drift offset for a plane, at a clock reading.
 *
 * **The clock is an argument.** That is the whole design: `getCloudState` stays
 * pure and this stays separately testable, the validation harness can freeze all
 * time-dependent motion by passing a constant (§8), and the renderer can pass a
 * clock that only accumulates while `journey.running` — which is what makes a
 * tab return not produce a jump, because the clock did not advance while the tab
 * was hidden.
 *
 * Bounded by construction: a sine, not an integral. An accumulating offset with
 * a wrap is what produces the visible seam §8 calls "obvious repeated textures",
 * and an unbounded one eventually loses float precision and starts to stutter.
 * The two frequencies are irrational multiples so the pair does not visibly
 * repeat, and both are low-frequency in the sense §8 means: the faster of them
 * has a period of about four minutes.
 */
export function driftAt(clock: number, phase: number, rate: number): { x: number; y: number } {
  if (rate === 0) return ZERO_DRIFT;
  const t = clock * rate;
  return {
    x: Math.sin(t + phase) * 1.6 + Math.sin(t * 0.37 + phase * 1.7) * 0.55,
    // A quarter of the lateral amplitude. Clouds at this scale move sideways;
    // vertical movement at the same amplitude reads as bouncing, which §8 lists.
    y: Math.sin(t * 0.53 + phase * 2.3) * 0.4,
  };
}

const ZERO_DRIFT = { x: 0, y: 0 };

// =============================================================================
// Layout. Fixed seeds, §8.
// =============================================================================

export type CloudPlane = {
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  rotation: number;
  phase: number;
  /** 0..1 per-plane opacity weight, so the deck does not fade as one sheet. */
  weight: number;
};

/**
 * Deterministic per-role layouts, generated once at the maximum count.
 *
 * ## Why the maximum, and why the tail is the part that goes
 *
 * §8 requires that no cloud visibly jumps when the quality tier changes. If the
 * layout were regenerated at the new count, every plane would move, because a
 * linear congruential sequence consumed a different number of times produces
 * entirely different values — a tier change would reshuffle the whole sky.
 *
 * Generating at the maximum and rendering a prefix means a count change *removes
 * planes* and moves none. And the planes it removes are the least significant
 * ones, because the layout is sorted by weight before it is returned: the tail
 * is the smallest, furthest, dimmest planes in the set. A step down from 22
 * enclosure planes to 12 drops ten planes that were each contributing under a
 * fifth of the peak opacity at the back of the volume.
 *
 * The same property is what makes a viewport change safe. Art direction changes
 * the *budget*, not the seed, so rotating a phone re-slices one fixed layout
 * rather than authoring a new sky.
 */
const SEEDS = { distant: 1013, enclosure: 7717, floor: 3121 } as const;
export type CloudRole = keyof typeof SEEDS;

export function layoutFor(role: CloudRole, max: number, spread: number, depth: number): CloudPlane[] {
  let state = SEEDS[role];
  const rnd = () => ((state = (state * 1664525 + 1013904223) >>> 0) / 4294967296);

  const planes: CloudPlane[] = Array.from({ length: max }, () => {
    const t = rnd();
    // Distant planes sit at the back of the volume and are wide and flat; the
    // enclosure fills it; the floor is wide, flat and shallow.
    const z =
      role === 'distant'
        ? -depth - 4 - t * 5
        : role === 'floor'
          ? -1.4 - t * depth * 0.8
          : -1.2 - t * depth;

    // Perspective, normalised so that the *nearest enclosure plane* is 1. A
    // plane twice as far from the camera needs twice the width and twice the
    // lateral range to occupy the same part of the frame; normalising against
    // the reference depth rather than against `|z|` is what makes `spread` mean
    // "this fraction of the frame" at every depth instead of only at one.
    const perspective = (2.35 + Math.abs(z)) / REFERENCE_DISTANCE;

    // Angular size, as a fraction of the frame's half-width. Without the
    // perspective term the back of the volume is a field of small dots, which
    // is the "particles" look §4 rejects.
    const angular = role === 'distant' ? 0.85 : role === 'floor' ? 1.15 : 0.55 + rnd() * 0.7;
    const width = spread * angular * perspective * (0.8 + rnd() * 0.45);
    const height = width * (role === 'floor' ? 0.24 : role === 'distant' ? 0.32 : 0.55);

    return {
      x: (rnd() - 0.5) * 2 * spread * perspective,
      y:
        role === 'distant'
          ? -1.2 + rnd() * 1.4
          : role === 'floor'
            ? -0.5 + rnd() * 0.7
            : -3.4 + rnd() * 7.2,
      z,
      width,
      height,
      rotation: (rnd() - 0.5) * 0.5,
      phase: rnd() * Math.PI * 2,
      weight: 0.45 + rnd() * 0.55,
    };
  });

  // Significance order, so a reduced count drops the least visible planes. Ties
  // broken by index — `Array.prototype.sort` is stable in every engine this runs
  // in, but the comparator being total is what makes that irrelevant.
  return planes
    .map((p, i) => ({ p, i }))
    .sort((a, b) => b.p.weight * b.p.width - a.p.weight * a.p.width || a.i - b.i)
    .map(({ p }) => p);
}

/**
 * Push a plane out of the aperture's clear radius, along its own bearing.
 *
 * The alternative — hiding planes that fall inside the radius — makes them
 * blink out as the radius grows, which is §14's "abrupt layer changes". Moving
 * them is continuous in the radius, so the clearing *opens* as the camera
 * approaches the breakthrough. That is the aperture anticipation beat in §4's
 * narrative, and it costs one branch per plane per frame.
 *
 * Planes behind the instrument are left alone: the clearance exists to stop the
 * deck occluding the Meridian, and something further away than the Meridian
 * cannot occlude it.
 */
export function clearAperture(
  plane: { x: number; y: number; z: number; phase: number },
  clearance: number,
  /**
   * The view axis in the *enclosure group's* coordinates.
   *
   * The group is offset vertically by `enclosureYAt`, so the camera sits at
   * `-enclosureY` within it. Clearing around the group's own origin instead
   * would carve the hole in the right place only at the one altitude where the
   * offset happens to be zero — which is the breakthrough, so it would look
   * correct in precisely the still most likely to be checked and be wrong
   * everywhere else.
   */
  centreY = 0,
  instrumentZ = -0.4,
): { x: number; y: number } {
  // Something further from the camera than the instrument cannot occlude it.
  if (plane.z < instrumentZ - 6) return plane;
  const dx = plane.x;
  const dy = plane.y - centreY;
  const d = Math.hypot(dx, dy);
  // A plane sitting exactly on the axis has no bearing to be pushed along.
  // Pushing it along a fixed axis would put every such plane in the same place;
  // its own phase is a deterministic bearing that is already uncorrelated.
  if (d < 1e-4) {
    return { x: Math.cos(plane.phase) * clearance, y: centreY + Math.sin(plane.phase) * clearance };
  }
  if (d >= clearance) return plane;
  const k = clearance / d;
  return { x: dx * k, y: centreY + dy * k };
}

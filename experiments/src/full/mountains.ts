/**
 * Where the mountain range is, at a given altitude.
 *
 * ## One altitude, one function, no state
 *
 * Everything here is a pure function of `journey.altitude`. That is not a style
 * preference: the requirement is that scrolling back up reconstructs every
 * state exactly, and the cheapest way to guarantee that is to have no state to
 * reconstruct. There is no easing towards a target, no accumulated velocity and
 * no "last frame" anywhere in this module, so 7 000 m reached from below and
 * 7 000 m reached from above produce identical numbers, and the test can assert
 * that by comparing two sweeps rather than by scripting a scroll.
 *
 * The one exception is `residency`, and it is deliberately not part of the
 * picture — see the note on it below.
 *
 * ## How the composition is preserved
 *
 * The Blender scene was composed through its own camera, on a path, at a
 * vertical field of view of 32 degrees — the same 32 the web camera uses, which
 * was not a coincidence when it was chosen. `blender/mountains/stratos_terrain.py`
 * defines that path:
 *
 *     desktop:  (0, -150 + 2050·t,  200 + 980·t^1.6)
 *     mobile:   (0, -150 +  900·t,  200 + 780·t^1.5)
 *
 * in Blender's Z-up axes, where `t` is normalised journey progress. The
 * accepted preview stills are named for the altitudes they were rendered at —
 * `00000m-valley`, `07000m-passage`, `11000m-approach` — and those correspond
 * to t = 0, 0.233 and 0.367, which is exactly `altitude / 30000`. So `t` is the
 * altitude, and the previews are what the browser should be reproducing.
 *
 * `cameraStation` returns that path converted to glTF's Y-up axes. The renderer
 * then places the whole range *relative to the live camera*, at
 *
 *     group.position = camera.position − scale · cameraStation(t)
 *     group.scale    = scale
 *
 * which is a similarity transform about the camera. Every view ray is
 * preserved, so the projected framing is identical to Blender's at any scale,
 * and `scale` is free to be chosen for depth-buffer fit alone. That is the
 * whole reason the safe zone validated in Blender is expected to hold in the
 * browser — and it is still checked independently there, because "expected to"
 * is not "does".
 *
 * Anchoring to the camera also means the web camera's own dolly and rise do not
 * move the mountains. That is correct rather than a compromise: the range
 * already has its own authored camera move of 2 050 m, and letting the dolly
 * add a second one would double the motion and invalidate the composition the
 * safe zone was validated against.
 */

import { ALTITUDE_STOPS } from './meridian';
import type { MountainMode } from './journey';
import type { MountainVariant } from './mountainAsset';
import { stationOffset } from './mountainLook';

/** Journey progress the Blender camera path is parameterised on. */
const CEILING = 30_000;

/**
 * The altitude the range finishes its pass below the cloud layer.
 *
 * `ALTITUDE_STOPS.breakthrough` is 12 000 m and is the aperture event — the
 * primary thing happening at that altitude. The range is therefore *already
 * gone* by the time it arrives rather than leaving during it, so the two do not
 * compete for the same moment.
 */
const PASSED_BELOW = ALTITUDE_STOPS.breakthrough;

/**
 * Where the fade out begins. Complete by `PASSED_BELOW`.
 *
 * Exported for `cloud.ts`, which recomputes the range's disappearance from this
 * same constant rather than choosing its own. §7 asks for "no abrupt mountain
 * visibility switch", and two independently-tuned fades either side of the same
 * altitude is how you get one. The dependency points that way — the cloud system
 * adapts to the accepted range, never the reverse — and nothing in this module
 * imports from `cloud.ts`.
 */
export const MOUNTAIN_FADE_FROM = 10_800;
const FADE_FROM = MOUNTAIN_FADE_FROM;

/**
 * Altitudes at which the geometry stops being drawn and stops being resident.
 *
 * Two different numbers on purpose. `HIDE_ABOVE` is where `visible` goes false,
 * and by then opacity is already zero, so nothing about the picture changes as
 * it crosses. `UNMOUNT_ABOVE` is further up again and only governs whether the
 * objects are still in the scene graph.
 */
export const HIDE_ABOVE = PASSED_BELOW + 400;
export const UNMOUNT_ABOVE = PASSED_BELOW + 1_600;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (t: number) => t * t * (3 - 2 * t);
const range = (v: number, a: number, b: number) => clamp01((v - a) / (b - a || 1));

/**
 * The Blender camera station at this altitude, in glTF axes (Y up, −Z forward).
 *
 * Blender is Z-up with +Y into the screen; glTF is Y-up with −Z into the
 * screen, so (x, y, z)ᵦ becomes (x, z, −y)ᵍ. The Blender camera carries a 90°
 * X rotation and nothing else, which is level and looking down its own +Y — the
 * same direction the web camera looks by default. No rotation is therefore
 * needed on the group, and the ascent is pure translation in both.
 */
export function cameraStation(altitude: number, variant: MountainVariant): [number, number, number] {
  const t = clamp01(altitude / CEILING);
  const advance = variant === 'mobile' ? 900 : 2_050;
  const rise = variant === 'mobile' ? 780 : 980;
  const power = variant === 'mobile' ? 1.5 : 1.6;

  // The web renderer's own framing adjustment, on top of the authored path.
  //
  // Constant on desktop, and a curve on mobile — the art-directed portrait
  // trajectory §3 asks for. It stays a pure function of altitude, which is what
  // the reverse-traversal check depends on: the same altitude has to reconstruct
  // the same station whether it was reached from below or from above.
  const offset = stationOffset(variant, altitude);

  const depth = -150 + advance * t + offset.forward; // Blender +Y
  const height = 200 + rise * Math.pow(t, power) + offset.rise; // Blender +Z
  return [0, height, -depth];
}

export type MountainState = {
  /** Should the geometry be in the scene graph at all. Resource residency only. */
  resident: boolean;
  /** Should it be drawn. False implies nothing visible changed — opacity is already 0. */
  visible: boolean;
  /** Material opacity, 0..1. */
  opacity: number;
  /** The camera station this altitude corresponds to, in glTF axes. */
  station: [number, number, number];
  /**
   * How far the fog has closed in, 0..1. Rises as the cloud layer is approached
   * so the range dissolves into the deck rather than being switched off.
   */
  fog: number;
  /** The ascent route's presence, 0..1. Literal at the valley, gone by the cloud. */
  route: number;
};

/**
 * The state, from the altitude alone.
 *
 * The stages this produces, against the brief:
 *
 *   0 m            full valley composition, opacity 1, route fully drawn
 *   0 – 7 000 m    the authored camera advance and rise; the valley floor
 *                  recedes and the passage opens, entirely from `station`
 *   7 000 m        `t^1.6` has near-zero second derivative through here and the
 *                  fade has not started, so the environment is quiet while
 *                  Ring 1 locks
 *   7 000 – 12 000 the fog closes and the route stops being literal
 *   12 000 m       opacity 0 — the range has passed below the deck, and the
 *                  aperture breakthrough owns the moment
 *   above          not drawn, then not resident
 */
export function mountainStateAt(
  altitude: number,
  variant: MountainVariant,
  /**
   * The development override. Defaulted, so every existing caller and every
   * test that treats this as a function of altitude alone is unaffected, and
   * production — which never writes anything but `timeline` — takes the same
   * path it always did.
   */
  mode: MountainMode = 'timeline'
): MountainState {
  const fade = smooth(range(altitude, FADE_FROM, PASSED_BELOW));
  const opacity = 1 - fade;

  if (mode === 'forced-off') {
    // Not drawn, and still resident. Residency is what makes an interleaved
    // A/B/A/B run measure a toggle rather than a DRACO decode; `visible: false`
    // on the root is what makes the draw calls, the triangles and the material
    // contribution actually disappear, which the previous external poke could
    // not achieve because this function overwrote it every frame.
    return { resident: true, visible: false, opacity: 0, station: cameraStation(altitude, variant), fog: 0, route: 0 };
  }

  if (mode === 'forced-on') {
    return { resident: true, visible: true, opacity: 1, station: cameraStation(altitude, variant), fog: 0, route: 1 };
  }

  return {
    resident: altitude <= UNMOUNT_ABOVE,
    visible: altitude <= HIDE_ABOVE && opacity > 0.001,
    opacity,
    station: cameraStation(altitude, variant),
    // Begins with the cloud deck's own approach at 6 000 m so the two read as
    // one weather event rather than as a mountain effect and a cloud effect.
    fog: smooth(range(altitude, 6_000, PASSED_BELOW)),
    route: 1 - smooth(range(altitude, 7_000, 10_500)),
  };
}

/**
 * The root group's canonical transform, as a value rather than as a side effect.
 *
 * ## Why this is a separate function
 *
 * It used to be four lines inside `MountainRange`'s `useFrame`, *after* an early
 * return on `state.visible`. That ordering had a defect the picture never showed
 * and the instrumentation did: while the range is hidden the root keeps whatever
 * transform it last had, and there are two ways for that to be the wrong one.
 *
 *   * A freshly mounted root has never been written at all, so it sits at the
 *     world origin. Coming *down* through the band the component is mounted at
 *     13 600 m and stays hidden until about 11 988 m, so for 1 600 m of reverse
 *     travel the root's transform was the origin rather than the camera station.
 *   * Going *up*, the last write was the last visible frame, so the same
 *     altitude carried a completely different transform depending on which
 *     direction it was approached from.
 *
 * Nothing was drawn in either case, so no still shows it. What it broke is the
 * claim the reverse-traversal check is supposed to make — that an altitude
 * reconstructs one state — and it left a genuine one-frame hazard for anything
 * that turns the range back on without moving the altitude, which the A/B
 * override does by design.
 *
 * Returning the transform instead of applying it means the boundary behaviour is
 * a pure function of altitude and camera position, so the regression test is
 * arithmetic rather than a scripted scroll, and `visible` is something the
 * caller applies *after* the transform rather than something that can skip it.
 *
 * `nudge` is the development station override. It is added here rather than
 * inside `cameraStation` so that function stays a pure function of altitude
 * alone, which is what the reverse-traversal test asserts; production always
 * passes zeroes and the whole branch folds away.
 */
/** Production's nudge, shared so the common path allocates nothing per frame. */
export const ZERO_NUDGE = { rise: 0, forward: 0 } as const;

export type MountainRootTransform = {
  /** Uniform scale on the root. */
  scale: number;
  /** World position of the root, in scene units. */
  position: [number, number, number];
  /** Whether the root should be drawn. Applied last, never before the above. */
  visible: boolean;
  /** Material opacity the look pass will write. Part of the canonical state. */
  opacity: number;
};

export function mountainRootTransform(
  state: MountainState,
  cameraPosition: readonly [number, number, number],
  nudge: { rise: number; forward: number } = ZERO_NUDGE
): MountainRootTransform {
  const [sx, sy, sz] = state.station;
  return {
    scale: MOUNTAIN_SCALE,
    position: [
      cameraPosition[0] - sx * MOUNTAIN_SCALE,
      cameraPosition[1] - (sy + nudge.rise) * MOUNTAIN_SCALE,
      cameraPosition[2] - (sz - nudge.forward) * MOUNTAIN_SCALE,
    ],
    visible: state.visible,
    opacity: state.opacity,
  };
}

/**
 * Scale applied to the whole range.
 *
 * Framing is scale-invariant under the camera-anchored placement above, so this
 * is chosen purely so the geometry fits the existing depth buffer. The scene's
 * far plane is 60 and its near plane 0.1. At 0 m the furthest desktop mass is
 * 4 550 model metres from the camera station and the nearest ground under it is
 * about 350, which at 0.01 lands at 45.5 and 3.5 units — inside both planes
 * with margin, and without touching a camera the rest of the scene depends on.
 */
export const MOUNTAIN_SCALE = 0.01;

/**
 * Altitudes the visual regression stills and the projection checks are taken
 * at. Exported so the test, the screenshot script and this module cannot drift.
 */
export const MOUNTAIN_STOPS = [0, 3_000, 7_000, 12_000] as const;

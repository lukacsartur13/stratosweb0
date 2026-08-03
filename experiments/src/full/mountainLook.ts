/**
 * How the mountains are lit and coloured, as data.
 *
 * ## Why this is a separate module from `mountains.ts`
 *
 * `mountains.ts` answers *where the range is* — a pure function of altitude,
 * shared with the tests, and deliberately free of anything that has an opinion.
 * This module answers *what it looks like*, which is an opinion and nothing
 * else. Keeping them apart means the placement maths can stay provable while
 * the art direction stays adjustable, and it means the debug panel has exactly
 * one file to override.
 *
 * Nothing here imports `three`. Every colour is a plain sRGB hex and every
 * direction is a pair of degrees, so the presets read as art direction rather
 * than as vectors, and `mountainMaterial.ts` is the only place that has to know
 * about `THREE.Color` and linear working space.
 *
 * ## Why the instrument's lights are not used
 *
 * `MeridianLights` is calibrated for one machined metal object a couple of
 * scene units across: a 3.4-intensity key, a 0.55 ambient, an environment probe
 * built from three Lightformers, ACES tone mapping. Every one of those choices
 * is right for the Meridian and wrong for four kilometres of rock:
 *
 *   * the environment probe is the instrument's *reflection*, and feeding it to
 *     a 92%-rough surface just adds a flat lift that removes the shading;
 *   * a single key at a fixed angle models one small object well and a range of
 *     ridges not at all — every plane that faces roughly the same way gets
 *     roughly the same value, which is precisely the "flat slab" complaint;
 *   * ACES's toe is what crushed the shadow side to black. On a subject whose
 *     whole tonal range lives in the bottom fifth of the curve, a filmic toe is
 *     not a look, it is a loss.
 *
 * The alternative of turning those lights up is worse: it is the one thing the
 * brief rules out, because the same numbers light the Meridian.
 *
 * Three.js has no per-object light masking — `Light.layers` is tested against
 * the *camera*, not against the object being shaded, so it cannot express "this
 * light for these meshes". Two cameras or two scenes would be a second render
 * pass. So the separation is made in the material instead: the mountains use
 * their own shader with their own lights, and the scene's lights simply do not
 * reach them. That is one program, no extra pass, and no way for a future
 * change to the instrument's key to alter the terrain.
 *
 * ## The measurements the numbers below are chosen against
 *
 * At 0 m the sky is `0x04060a` at the zenith and `0x0a0f18` at the horizon, and
 * `Sky` writes those without an sRGB encode, so what actually reaches the frame
 * is `0x010102` — effectively black. Every value here is therefore chosen to be
 * read *against black*, which is the opposite of the Blender previews (rendered
 * against a light grey studio sky, where the masses read as dark silhouettes).
 * That difference is the whole reason the geometry could be right and the
 * picture still wrong.
 *
 * The pre-pass measured frame, desktop 0 m: mountains spanning `0x0a1528` to
 * `0x2d3544`, sky `0x010102`. Almost all of the range sat under sRGB 0x30 with
 * no plane separation. The targets these presets aim at, same viewpoint:
 *
 *   foreground lit   ~0x3c–0x48      foreground shadow  ~0x14–0x1c
 *   midground lit    ~0x40–0x4e      midground shadow   ~0x20–0x28
 *   background       ~0x2e–0x3a, low internal contrast, strongest fog
 *   valley floor     ~0x0e–0x18 near the camera, misting upward with distance
 */

import type { MountainVariant } from './mountainAsset';

/**
 * Directions are given as azimuth and elevation in degrees rather than as
 * vectors, because that is how a light is actually art-directed and because a
 * vector in a preset is unreadable six months later.
 *
 * Azimuth is measured about the world Y axis, from the direction the camera
 * looks *out of* the screen:
 *
 *     0°    directly behind the viewer — a flat frontal light
 *   ±90°    lateral, from the right (+) or the left (−)
 *   ±180°   from behind the range, towards the camera — a rim/back light
 *
 * Elevation is degrees above the horizon.
 */
export type Direction = { azimuth: number; elevation: number };

/**
 * Per-anchor values, ordered near → mid → far.
 *
 * The three anchors are not three groups of objects. They are three points on a
 * continuous camera-distance ramp that the shader interpolates per fragment —
 * see `mountainMaterial.ts`. That is deliberate: bucketing meshes into three
 * palettes is exactly how depth separation ends up looking like paper cut-outs,
 * and it also cannot grade a single mesh that spans the whole scene, which
 * `VALLEY_FLOOR` does (+900 to −4 400 in model metres).
 */
export type Depth3 = [near: number, mid: number, far: number];

export type MountainLook = {
  /** The broad key. */
  key: Direction;
  keyIntensity: number;
  keyColor: number;
  /**
   * How far past the terminator the key still reaches, 0..1.
   *
   * A hard Lambert terminator on a ridge produces the near-black wedge this
   * pass exists to remove. Wrapping the falloff keeps the shaded plane on the
   * curve instead of clipping it to the fill.
   */
  keyWrap: number;

  /** Sky/ground hemisphere fill — the ambient that is allowed to be directional. */
  skyColor: number;
  groundColor: number;
  fillIntensity: number;

  /** The weak counter-light standing in for bounce off the opposing wall. */
  bounce: Direction;
  bounceColor: number;
  bounceIntensity: number;

  /**
   * A signed tint by facing direction, independent of the key.
   *
   * This is what separates two ridge planes that happen to face the key
   * equally. Signed rather than clamped, so one flank is lifted and the
   * opposite flank is dropped by the same amount and the mean is unchanged.
   */
  azimuthTilt: number;
  azimuthAmount: number;

  /** Camera distance, in model metres, of the near and far palette anchors. */
  depthSpan: [near: number, far: number];

  /** Albedo at each anchor, sRGB hex. */
  base: [number, number, number];
  /** Per-anchor brightness multiplier. The three "material level" debug knobs. */
  level: Depth3;
  /** Strength of the mid-tone plane ramp. Highest in front, lowest behind. */
  contrast: Depth3;
  /** Minimum light a plane keeps however it faces. Stops the black wedges. */
  floor: Depth3;
  /** Per-anchor multiplier on the atmospheric density. */
  fogScale: Depth3;

  /** Crest lift, in model metres relative to the camera's own height. */
  crestFrom: number;
  crestTo: number;
  crestGain: number;
  /** Darkening of low, up-facing surfaces — the valley's own occlusion. */
  valleyDarken: number;

  /** Atmosphere. Densities are per model metre. */
  fogColor: number;
  /** The colour the range dissolves *into* as the cloud deck takes over. */
  fogColorHigh: number;
  fogDensity: number;
  /** Extra density in the valley, on top of `fogDensity`. */
  valleyDensity: number;
  /** Model metres above the camera at which the valley density has fallen off. */
  valleyFogTop: number;
  valleyFogFalloff: number;

  /** The ascent route. Its own albedo, since it is the one non-rock element. */
  routeColor: number;
  routeLevel: number;
};

/**
 * Desktop: a high three-quarter key from the left.
 *
 * Left rather than right, and the choice was made by rendering both — see
 * `_build/reports/mountain-key-direction.md`. The range is asymmetric by
 * construction (the right-hand masses are the taller ones: `MNT_BACKGROUND_R`
 * reaches 1 185 model metres against `MNT_BACKGROUND_L`'s 573), so a key from
 * the left lights the shorter left flank and rakes across the taller right one,
 * which is what opens the valley. From the right it does the reverse and the
 * two sides converge on the same value — the composition loses its asymmetry
 * exactly where the asymmetry is doing the work.
 *
 * The elevation is high enough to separate ridge tops from the valley and low
 * enough that it never reads as a sun. There is no sun in this sky.
 */
const DESKTOP: MountainLook = {
  // Responsibility: which flank of each ridge is lit, and therefore whether the
  // two sides of the valley read as two different surfaces or as one.
  //
  // −46 rather than −58. Left is still the answer — the reasoning in the block
  // above holds — but at −58 the measured split between the left-hand and
  // right-hand masses was 2.07x (left objects mean sRGB 23, right 48), which
  // stops being asymmetry and becomes a black wedge on one side and a pale
  // strip on the other. −46 brings it to 1.54x: the left flank still reads as
  // the shadow side, and it still has values in it.
  key: { azimuth: -46, elevation: 26 },
  keyIntensity: 0.55,
  keyColor: 0xd8e4f4,
  keyWrap: 0.22,

  skyColor: 0x4a5f7d,
  groundColor: 0x10161f,
  // Responsibility: the floor under the shadow side. It is what decides whether
  // an unlit plane is modelled or is a hole in the picture. Raised from 0.10
  // with the key rotation above — the two together are the fix for the wedge,
  // and neither alone was enough.
  fillIntensity: 0.13,

  bounce: { azimuth: 116, elevation: -6 },
  bounceColor: 0x35506f,
  bounceIntensity: 0.075,

  azimuthTilt: -104,
  azimuthAmount: 0.16,

  depthSpan: [520, 4200],

  base: [0x6d7784, 0x77808d, 0x7d8794],
  // The value ladder, and the most consequential set of numbers here.
  //
  // The measured failure was not that the range was too dark or too light. It
  // was that the whole of it — 62% of the frame — lived inside a 34-step
  // luminance band, sRGB 23 to 57, against a sky at 1. A picture with no darks
  // and no lights is a slab whatever value it sits at, and no amount of moving
  // the band up or down fixes that.
  //
  // So the ladder is built out of *range* rather than out of brightness:
  //
  //   foreground   the widest range in the picture — its shaded planes are the
  //                darkest thing in the frame and its lit crests among the
  //                brightest. That is what makes it read as near and as solid,
  //                and it is where `contrast` is 1.0 and `floor` is lowest.
  //   midground    narrower, centred a little lighter, softened by the fog it
  //                is starting to sit behind.
  //   background   narrowest, lifted mostly by atmosphere rather than by its
  //                own albedo — `level` is *lowest* here and the fog does the
  //                work, which is what makes it recede instead of advancing.
  //
  // Predicted from these constants, foreground shadow to lit crest: sRGB 7 to
  // 75. Background: 44 to 58. The Blender previews' own structure, inverted for
  // a black sky instead of their light studio one.
  // Responsibility of `level[0]`: how far forward the near masses come. Raised
  // to 1.05 now that there *are* near masses in the frame — see STATION_OFFSET.
  // At 0.95 it was tuned against `VALLEY_WALL_L/R`, which are mid-depth, so it
  // was lightening the middle of the picture rather than the front of it.
  level: [1.05, 0.75, 0.62],
  contrast: [1.0, 0.65, 0.2],
  floor: [0.014, 0.03, 0.07],
  // The near scale is small on purpose, and finding out why cost a pass.
  //
  // Fog is what was holding the shadows up. A near band at 0.35 put ~7% of the
  // atmosphere colour into every foreground fragment, which on a plane whose
  // own value is sRGB 9 is most of what reaches the frame: the measured
  // 5th-percentile luminance was 21 and would not move however far the albedo
  // or the shadow floor came down. Dropping the near band to 0.14 took it to 13
  // and widened the whole picture's range from 50 steps to 61. Aerial
  // perspective belongs in the distance; in the first 800 metres it is just a
  // veil over the darks.
  fogScale: [0.14, 0.85, 1.75],

  // In model metres relative to the camera's own height, which at 0 m sits 200
  // above the origin and 405 above the valley floor. The masses run from −620
  // (their skirts) to +985 (`MNT_BACKGROUND_R`'s peak), so a ramp has to start
  // at the floor to do anything at all — an earlier −140 put almost the whole
  // foreground below the ramp, where the crest lift was exactly zero and the
  // valley darkening was at full strength across the entire mass.
  crestFrom: -450,
  crestTo: 520,
  crestGain: 0.36,
  // Responsibility: whether the valley reads as a depth or as a lit stage.
  //
  // Strong, because the valley floor is the one surface a key light at any
  // usable elevation over-lights: it is the only large up-facing plane in the
  // scene, so it collects both the key and the whole sky half of the
  // hemisphere. Left at 0.34 it came out as the brightest large region in the
  // frame, which is the exact inverse of what makes a valley read as deep.
  //
  // 0.7 was still not enough, and the per-object measurement is why: at 7 000 m
  // `VALLEY_FLOOR` measured mean sRGB 43.4 across 31% of the frame while
  // `VALLEY_WALL_L` measured 33.0 — the floor was *lighter than the wall above
  // it*. 0.9 puts it back underneath.
  valleyDarken: 0.9,

  fogColor: 0x2b3546,
  fogColorHigh: 0x8e9aa8,
  fogDensity: 0.00013,
  valleyDensity: 0.00012,
  valleyFogTop: -250,
  valleyFogFalloff: 300,

  routeColor: 0x6f8299,
  routeLevel: 1.0,
};

/**
 * Mobile: the same language, spoken in a portrait frame.
 *
 * The mobile GLB is already a different composition, not a crop — but the
 * geometry alone does not fix the picture, because a portrait frame changes
 * what the *lighting* has to do. Three differences, each for a reason the
 * desktop frame does not have:
 *
 *   * **The key is more frontal** (−34° against −46°). A lateral key in a
 *     390 px-wide frame throws most of the visible rock onto its own shadow
 *     side, because the masses that survive the portrait crop are the ones
 *     nearest the frame edges and they are seen almost edge-on. Bringing the
 *     key round lights the inward-facing valley walls, which are the surfaces a
 *     phone actually shows.
 *
 *   * **The fill is stronger** (0.16 against 0.13) and the shadow floor is
 *     higher. This is the direct fix for "thin dark wedges": the wedges are
 *     thin because they are the edge-on flanks of the framing masses, and they
 *     are dark because nothing was reaching them.
 *
 *   * **The atmosphere is thinner in front and heavier behind.** A portrait
 *     frame has less horizontal room to establish depth, so the separation has
 *     to come from value rather than from overlap: the near masses stay clear
 *     and the far ones recede harder than they do on desktop.
 *
 * What is deliberately *not* different: the exposure, the palette hues and the
 * overall darkness. Mobile is not a brighter build of the same scene.
 */
const MOBILE: MountainLook = {
  // Responsibility: as desktop. More frontal again, because a portrait frame
  // shows the framing masses almost edge-on and a lateral key puts the only
  // surfaces on screen entirely into shadow.
  key: { azimuth: -34, elevation: 28 },
  // Deliberately identical to desktop. Mobile is not a brighter build of the
  // same scene — the portrait differences are all direction, fill and
  // atmosphere, never exposure.
  keyIntensity: 0.55,
  keyColor: 0xd8e4f4,
  keyWrap: 0.3,

  skyColor: 0x53688a,
  groundColor: 0x131a24,
  // Responsibility: as desktop, and higher here because the portrait frame has
  // proportionally more edge-on surface in it, so more of the picture depends
  // on what the fill does rather than on what the key does.
  fillIntensity: 0.16,

  bounce: { azimuth: 128, elevation: -4 },
  bounceColor: 0x3a5878,
  bounceIntensity: 0.095,

  azimuthTilt: -88,
  azimuthAmount: 0.085,

  depthSpan: [420, 4600],

  base: [0x737d8a, 0x7c8593, 0x818b98],
  // The same ladder as desktop, compressed. A portrait frame shows less of each
  // mass, so the near end cannot go as dark before the framing walls stop being
  // walls and become the edge wedges this pass exists to remove.
  //
  // 0.8, revised up from 0.5. The 0.5 was correct for the composition it was
  // measured in and wrong for this one: with the station where it was, the
  // "near" band was being applied to `VALLEY_WALL_L/R` — the two masses hugging
  // the frame edges — and pulling them down was the only way to stop them
  // shouting. With the station pulled back, `MNT_FOREGROUND_L/R` are in frame
  // (0.203 of it, against 0.054 before) and *they* are what the near band now
  // grades. Those are the masses that have to come forward, so holding them at
  // 0.5 would have re-created the flat picture from the other direction.
  //
  // Still below desktop's 1.05, because the portrait frame sees them closer and
  // more edge-on, and the last thing this frame needs is two bright edges.
  level: [0.8, 0.8, 0.9],
  contrast: [0.92, 0.6, 0.22],
  floor: [0.024, 0.042, 0.082],
  fogScale: [0.12, 0.78, 1.95],

  crestFrom: -450,
  crestTo: 470,
  crestGain: 0.4,
  // Responsibility: as desktop, and stronger, because a portrait frame gives
  // the floor an even larger share — `VALLEY_FLOOR` measured 43% of the mobile
  // frame against 37% of the desktop one, at mean sRGB 46.6 at 7 000 m, which
  // made it both the largest and the brightest region in the picture.
  valleyDarken: 0.92,

  fogColor: 0x2e3849,
  fogColorHigh: 0x8e9aa8,
  fogDensity: 0.000115,
  valleyDensity: 0.00011,
  valleyFogTop: -250,
  valleyFogFalloff: 280,

  routeColor: 0x6f8299,
  routeLevel: 1.1,
};

export const MOUNTAIN_LOOK: Record<MountainVariant, MountainLook> = {
  desktop: DESKTOP,
  mobile: MOBILE,
};

/**
 * Extra placement applied to the range on top of the Blender camera station.
 *
 * ## Visual responsibility
 *
 * `forward` decides *which masses are inside the frustum at all*, and `rise`
 * decides *how much of the frame the valley floor gets*. Neither is a tonal
 * control and neither can be substituted for one — which is the whole reason
 * this block had to change before any of the lighting numbers meant anything.
 *
 * ## Why these are no longer zero on desktop
 *
 * The previous values (desktop 0/0, mobile +120/−150) were chosen on the
 * assumption that the Blender station framed the authored composition in the
 * browser too. Measured per object against the live projection, it does not:
 *
 *     desktop @ 0 m    MNT_FOREGROUND_L  0.0000 of frame   (18 432 triangles)
 *                      MNT_FOREGROUND_R  0.0150 of frame   (18 432 triangles)
 *     desktop @ 3000+  both              0.0000 of frame
 *     mobile  @ 3000+  both              0.0000 of frame
 *
 * Both foreground masses sit at ±930–970 model metres laterally but only
 * 750–845 m ahead. At the 32° vertical field of view the frame is ±344 m wide
 * at that depth on desktop and ±120 m on mobile, so the near masses are two to
 * three frame-widths outside it. The composition had no foreground in it — 28%
 * of the desktop triangle budget was being decoded, skinned and drawn to
 * nothing, and the `level[0]`/`contrast[0]`/`floor[0]` "foreground" band below
 * was being tuned against geometry that never reached a pixel. That is why the
 * tonal numbers kept moving while the picture kept looking like a slab.
 *
 * Pulling the station back is the smallest lever that fixes it, because it is
 * a pure change of station on the *authored path* rather than a change to the
 * geometry or to a second lighting rig. Measured at 0 m:
 *
 *                    foreground in frame   valley floor   right/left value split
 *     desktop before        0.015              0.365              2.07
 *     desktop after         0.143              0.332              1.54
 *     mobile  before        0.054              0.435              1.44
 *     mobile  after         0.203              0.393              0.91
 *
 * `rise` is positive on both for a second, separate reason: `VALLEY_FLOOR` is
 * a single 4 800 × 5 300 m plane and was taking 37–48% of every frame as one
 * near-uniform value — the literal "flat grey slab". Lifting the station drops
 * the horizon in frame and hands that area back to the ridges.
 *
 * The safe zone survives the move: `shots-mountains.mjs` reports 0/29 occluded
 * Meridian samples at every viewport, altitude and offset in the sweep, so the
 * instrument is still in front of everything. That is checked rather than
 * assumed — the Blender-side validation was done under Blender's camera and
 * says nothing about this station.
 */
export type StationOffset = { forward: number; rise: number };

export const STATION_OFFSET: Record<MountainVariant, StationOffset> = {
  // Landscape has the horizontal room to hold both framing walls and a
  // passage between them, so it can afford the larger pull-back.
  desktop: { forward: -600, rise: 150 },
  // Portrait gets less, and takes no `rise` at all. The sweep's −600 row put
  // more foreground in frame (0.318 against 0.203) but also more valley floor
  // (0.436 against 0.393), and floor area is the thing a portrait frame has
  // least room for. −280 is the net of the old +120 and the −400 the sweep
  // chose; the old −150 `rise` cancels against the +150 it chose, which is why
  // this reads 0 rather than being untouched.
  //
  // Whether a larger pull-back eventually closes the central passage was not
  // measured — the sweep stopped at −600 and every row in it kept the Meridian
  // clear (0/29 occluded). Treat −600 as the edge of what has been checked, not
  // as a proven limit.
  mobile: { forward: -280, rise: 0 },
};

/** Degrees to a unit direction in world space. See `Direction`. */
export function toVector(d: Direction): [number, number, number] {
  const a = (d.azimuth * Math.PI) / 180;
  const e = (d.elevation * Math.PI) / 180;
  const c = Math.cos(e);
  return [Math.sin(a) * c, Math.sin(e), Math.cos(a) * c];
}

/** The horizontal-only direction the azimuthal ramp lifts. */
export function tiltVector(degrees: number): [number, number, number] {
  const a = (degrees * Math.PI) / 180;
  return [Math.sin(a), 0, Math.cos(a)];
}

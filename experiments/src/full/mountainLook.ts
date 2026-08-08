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
  /**
   * Ceiling on the *aerial* haze term, 0..1. The single most important number
   * in this file for §8 and §13.
   *
   * The haze is a lerp of the shaded colour toward one atmosphere colour, and
   * it is the last operation in the shader. Uncapped, it converged the whole
   * range on one blue-grey at exactly the distances the reframed composition
   * now puts the masses at — which is why the previous pass could measure a
   * real increase in material separation and still ship a picture that reads as
   * one substance. The measurement was taken upstream of the lerp.
   *
   * Capping it means the furthest rock keeps `1 - fogMax` of its own colour
   * however deep the scene is. The depth cue that the uncapped haze used to
   * carry alone now comes from `level` and `contrast` instead — value and local
   * contrast, which make a plane recede without destroying its hue.
   *
   * The cloud-deck dissolve is *not* subject to this and still reaches 1: that
   * is a deliberate disappearance rather than distance.
   */
  fogMax: number;

  /**
   * Procedural micro-relief. §11.
   *
   * `scale` is the wavelength in model metres and `amount` is how hard the
   * surface normal is bent. This is a normal perturbation and never a
   * displacement — the silhouette is the composition, and the composition is
   * what this pass has just spent its whole budget establishing.
   */
  relief: { scale: number; amount: number };

  /**
   * Environmental material zoning: what the rock is *made of* at each altitude.
   *
   * ## Why this is separate from `base`
   *
   * `base` is a *depth* palette — three albedos interpolated on distance from
   * the camera, which is aerial perspective. It answers "how far away is this",
   * and its three values are deliberately almost the same colour (0x6d7784,
   * 0x77808d, 0x7d8794 on desktop) because a hue shift with distance would read
   * as a filter rather than as air.
   *
   * Nothing in the material answered "what is this", and that is the whole of
   * the flat-monochrome-blockout complaint. A range whose only albedo variation
   * is a two-step drift with distance is one material at one colour, and no
   * amount of lighting rescues it: `crestGain` and `valleyDarken` modulate the
   * *light*, so a lit crest and a lit valley floor are the same substance at
   * two brightnesses. Real terrain changes substance with altitude — soil and
   * scrub in the valley, exposed rock on the flanks, colder mineral on the
   * ridges, snow only where it can hold.
   *
   * ## Height and slope, not textures
   *
   * Both masks are already free. `vHeight` is a varying the crest ramp needs
   * anyway, and the world normal is the one the key light needs anyway, so the
   * whole system is a handful of `smoothstep`s on values the fragment stage has
   * in hand. No texture is fetched, no second UV set is needed, and the mobile
   * GLB does not grow by a byte. §15's preferred strategy, taken literally.
   *
   * ## Restraint is a constant here, not a discipline
   *
   * `amount` caps how far the zoning may pull the albedo away from the accepted
   * depth palette, and `snowAmount` caps snow coverage below 1 by construction —
   * so "restrained" is enforced by the range of a number rather than by whoever
   * edits the colours next. Turning `amount` to 0 returns the accepted
   * monochrome look exactly, which is what makes this reviewable.
   */
  zone: {
    /** §14.1 — lower valley: dark earth-grey with a muted organic cast. */
    valley: number;
    /** §14.2 — the rocky middle band, and the dominant structural region. */
    rock: number;
    /** §14.3 — upper ridges and exposed peaks: lighter cold stone. */
    ridge: number;
    /** §14.4 — snow and frost. Cold off-white, never paper. */
    snow: number;

    /** Model metres, relative to the camera, of the valley→rock crossing. */
    valleyTo: number;
    /** …and of the rock→ridge crossing. */
    ridgeFrom: number;
    /** How wide each crossing is, so a band edge is never a contour line. */
    blend: number;

    /** Height at which snow may begin, and the distance over which it arrives. */
    snowFrom: number;
    snowFade: number;
    /**
     * How up-facing a surface has to be to hold snow, as `N.y`. A steep face
     * sheds it, which is what puts snow on ledges and shoulders rather than
     * painting it over the silhouette.
     */
    snowSlope: number;
    /** Peak snow coverage, 0..1. Well below 1: an accent, not a covering. */
    snowAmount: number;

    /** How far the zoning may pull the albedo off the depth palette, 0..1. */
    amount: number;
    /**
     * Per-face break-up of the two height crossings, in model metres.
     *
     * Kept, at a much smaller amplitude than it used to carry, and demoted to a
     * dither on top of `erosion*`. Because the geometry is flat-shaded this
     * `sin` of the normal is constant across a facet, so on its own it broke a
     * band edge into the *grid* rather than into geology — visibly the mesh.
     */
    jitter: number;

    /**
     * Erosion break-up of the same two crossings. §10.
     *
     * `erosionScale` is the noise wavelength in model metres and
     * `erosionAmount` is how many metres of height it adds or removes. Together
     * they are what stops the four substances reading as three horizontal
     * stripes: the boundary wanders up gullies and down spurs by a couple of
     * hundred metres, so no part of it is a contour line.
     *
     * The noise is evaluated in the *rock's own* coordinate frame rather than
     * in world or view space. The range is re-anchored to the camera every
     * frame, so any frame that moves with the camera would make the pattern
     * crawl across the terrain during the ascent.
     */
    erosionScale: number;
    erosionAmount: number;

    /**
     * How hard a steep face is pushed toward rock regardless of its height,
     * 0..1. §10's "slope", and the strongest single cue that the lower terrain
     * is a different *substance* rather than the same one at a lower value:
     * soil and scrub hold on shallow ground and shed off anything steep, so a
     * valley wall is stone and the ground between the walls is not.
     */
    slopeRock: number;
  };

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
  valleyDarken: 0.62,

  fogColor: 0x2b3546,
  fogColorHigh: 0x8e9aa8,
  fogDensity: 0.00013,
  valleyDensity: 0.00012,
  valleyFogTop: -250,
  valleyFogFalloff: 300,
  // Measured rather than chosen: at 4 200 model metres — the far palette anchor
  // and about where MNT_BACKGROUND_C sits — the uncapped haze reached 0.71,
  // which left the most distant rock with 29% of its own colour and the rest a
  // flat lerp toward one blue-grey. 0.62 keeps better than a third of the
  // albedo at every distance in the scene while still reading as deep air.
  fogMax: 0.62,

  // 34 m wavelength on a range whose masses are 900–1 500 m across: about forty
  // cycles over a mass, which at desktop viewing distance is surface rather
  // than shape. 0.10 is a gentle bend — enough that a facet stops being one
  // flat value across its width, not enough to compete with the ridge lines.
  relief: { scale: 34, amount: 0.1 },

  // The masses run from −620 (their skirts) to +985 (`MNT_BACKGROUND_R`'s
  // peak) in metres relative to the camera at 0 m, which is the same space
  // `crestFrom`/`crestTo` are authored in — so the crossings are placed against
  // known geometry rather than guessed. The valley band ends at −250, which is
  // where `valleyFogTop` already says the valley stops; the ridge band starts
  // at 300, roughly the shoulder height of the mid masses; snow begins at 600,
  // which only `MNT_BACKGROUND_R` and the taller foreground crests reach.
  zone: {
    // Muted green-grey rather than green: this is the *cast* of ground that has
    // soil and scrub on it, seen at a kilometre through haze, not grass. §9 is
    // explicit that the valley must not go green like a golf course, so the
    // saturation stays low — 14% here, up from 8% — and the whole separation is
    // carried by hue *direction* (warm-olive against cold-blue) rather than by
    // chroma. That is what lets it survive next to yellow typography.
    //
    // Its value also sits below the rock band, so the valley stays the darkest
    // part of the picture — which is what `valleyDarken` is also protecting,
    // and the two must not fight.
    valley: 0x4b5440,
    // The dominant region. Deliberately still close to the accepted `base` —
    // the middle band is most of the visible rock, so this is where the change
    // has to be smallest for the range to look like itself — but pulled a step
    // cooler and darker so the ridge above it has somewhere to go.
    rock: 0x5c6573,
    // Colder and lighter: exposed mineral, the band where the ridges have to
    // become readable. The gap from `rock` is now 0x21 of luminance rather than
    // 0x18, which is the difference between "a lighter version of the same
    // stone" and "a different stone".
    ridge: 0x93a0b4,
    // Cold off-white. Never 0xffffff: the brightest thing in this frame is the
    // yellow of the typography and the instrument's lit arc, and §14.4 is
    // explicit that snow must not compete with them.
    snow: 0xc8d4e4,

    valleyTo: -60,
    ridgeFrom: 340,
    blend: 200,

    // 380 m wavelength against a `blend` of 170 and crossings 530 m apart: long
    // enough that the boundary reads as terrain opening and closing rather than
    // as noise on a line, short enough that it moves several times across one
    // mass. 150 m of amplitude is most of one blend width, so no part of either
    // crossing is a horizontal line anywhere in the range.
    erosionScale: 380,
    erosionAmount: 150,
    // Enough that a valley wall is stone while the ground between the walls is
    // not, and not so much that every ridge flank flips to rock and the height
    // banding stops meaning anything.
    slopeRock: 0.55,

    snowFrom: 470,
    snowFade: 220,
    // 0.38 keeps snow off anything steeper than about 68°. Measured at 0.62 —
    // a 52° limit, which reads as the right restraint on paper — the accent
    // never appeared: the peaks that clear the snow line are the sharp ones,
    // almost none of their faces are that flat, and the p99 luminance of the
    // whole frame moved by 1.2. A limit has to be loose enough for the geometry
    // it is applied to before `snowAmount` can do the restraining.
    snowSlope: 0.18,
    snowAmount: 0.6,

    // Raised from 0.8. With the haze capped there is finally something for the
    // zoning to survive *into*, so the restraint budget can be spent: at 0.8 a
    // fifth of every fragment was still the depth palette, which on top of the
    // old uncapped fog left almost nothing of the substance.
    amount: 0.92,
    // Demoted to a dither. It used to carry the whole break-up at 130 m and, on
    // flat-shaded terrain, drew the mesh; `erosionScale`/`erosionAmount` do the
    // work now.
    jitter: 40,
  },

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

  // Moved out with the geometry, and this is the correction that mattered most
  // for the tone.
  //
  // The reframed portrait masses sit at 1 250–6 100 model metres where the old
  // ones sat at 430–3 300, so against the previous [420, 4600] span *every*
  // framing mass was past the far anchor. They were all being graded with
  // `level[2]`, `contrast[2]` (0.22 — almost no local contrast) and
  // `fogScale[2]` (1.95), which is the "recede into the air" band. The result
  // was the measured pale drapery: correct shapes, no depth ladder, no
  // modelling, everything lifted by haze into one wash.
  //
  // [1250, 6100] is the actual near and far extent of the composition, so the
  // three anchors grade across it as they were always meant to.
  depthSpan: [1250, 6100],

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
  //
  // Re-ordered as a *descending* ladder, which it was not before. The old
  // [0.8, 0.8, 0.9] made the furthest band the brightest, which is the inverse
  // of aerial perspective and only ever worked because the far band was
  // effectively unused: with the old geometry almost nothing was out there.
  // Now that the whole range is spread across the span, the far anchor has to
  // recede, and it has to do it by *value* since the haze is capped.
  level: [0.9, 0.74, 0.58],
  // The far anchor keeps real local contrast now rather than 0.22. That number
  // was right when "far" meant the background ridges alone; it is wrong when
  // "far" means the cloud-break peaks, which are the tallest and most
  // silhouette-carrying masses in the portrait picture.
  contrast: [0.92, 0.66, 0.4],
  floor: [0.024, 0.042, 0.07],
  fogScale: [0.12, 0.7, 1.35],

  crestFrom: -450,
  crestTo: 470,
  crestGain: 0.4,
  // Responsibility: as desktop, and stronger, because a portrait frame gives
  // the floor an even larger share — `VALLEY_FLOOR` measured 43% of the mobile
  // frame against 37% of the desktop one, at mean sRGB 46.6 at 7 000 m, which
  // made it both the largest and the brightest region in the picture.
  valleyDarken: 0.55,

  fogColor: 0x2e3849,
  fogColorHigh: 0x8e9aa8,
  // Halved, because the scene it is measured through is now twice as deep. At
  // the old 0.000115 with the old far scale of 1.95, a mass at 4 400 m — where
  // CLOUD_PEAK_L now sits, and it is the composition's principal silhouette —
  // reached a haze of 0.63 before the cap. Density and depth multiply, so
  // holding the density while doubling the distances is a different picture,
  // not the same one further away.
  fogDensity: 0.00006,
  valleyDensity: 0.00011,
  valleyFogTop: -250,
  valleyFogFalloff: 280,
  // Tighter than desktop's 0.62. A portrait frame puts body copy over the
  // terrain rather than beside it (§16), so the far rock has to stay quieter —
  // but 0.55 still leaves it 45% of its own colour, against the 15–20% the
  // uncapped haze left it at these distances.
  fogMax: 0.55,

  // Longer wavelength and a gentler bend than desktop, which is §15 exactly:
  // the same material language with the high-frequency term backed off for a
  // small screen. At 48 m the relief is about eight cycles across a phone frame
  // at the near masses rather than twenty, so it reads as surface rather than
  // as noise once the frame is 390 px wide.
  relief: { scale: 48, amount: 0.075 },

  // The same four substances as desktop — §14 asks the two variants to share
  // one environmental language — placed against the portrait geometry rather
  // than the landscape one. The mobile masses are shorter and the camera runs a
  // different path (900 m forward against 2 050), so the crossings move with
  // `crestTo`, which is 470 here against the desktop's 520.
  //
  // Two deliberate differences, both portrait consequences rather than taste:
  //
  //   * **`amount` is lower.** The portrait frame puts copy over the terrain
  //     rather than beside it, so every extra step of albedo separation is
  //     contrast competing with body text. §15's "no dense detail behind text".
  //   * **snow starts lower and covers less.** Portrait crops the peaks hard,
  //     so a snow line placed at the desktop's 600 would put the accent above
  //     the frame at most altitudes — visible in the Blender previews as snow
  //     that only appears at the bottom of the journey. 520 puts it on the
  //     crests that actually survive the crop, and 0.48 keeps it from becoming
  //     the brightest thing next to the instrument.
  zone: {
    valley: 0x4c5441,
    rock: 0x5e6672,
    ridge: 0x8f9db2,
    snow: 0xc9d6e6,

    valleyTo: 40,
    // Raised with the geometry. The reframed masses put their crests 0.22–0.70
    // of a half-height above the eye — roughly +160 to +900 model metres —
    // where the old ones ran from the frame bottom to past its top, so a rock →
    // ridge crossing at 265 now sits near the *base* of every mass instead of
    // at its shoulder and everything above the valley reads as ridge.
    ridgeFrom: 470,
    blend: 220,

    erosionScale: 420,
    erosionAmount: 160,
    slopeRock: 0.55,

    // Raised with `ridgeFrom` for the same reason: at 470 the snow line sat
    // below the shoulder of the mid masses. 700 puts it on the cloud-break
    // peaks and the upper third of the midground, which are the crests that
    // survive the portrait crop.
    snowFrom: 620,
    snowFade: 240,
    snowSlope: 0.12,
    // Still the lowest number in either preset. §16: snow must never sit at
    // high brightness directly behind white body copy, and portrait is the
    // frame where copy and terrain share the same pixels.
    snowAmount: 0.58,

    // Raised from 0.7, but deliberately left below desktop's 0.92. The portrait
    // frame puts copy over the terrain, so every extra step of albedo
    // separation is contrast competing with body text — §15's "no dense detail
    // behind text", spent as a budget rather than asserted.
    amount: 0.86,
    jitter: 40,
  },

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

/**
 * Desktop's offset, which is a constant and stays one.
 *
 * Landscape has the horizontal room to hold both framing walls and a passage
 * between them, so it can afford the pull-back, and its composition is accepted
 * — §15 is explicit that the desktop camera is not to be altered unless the
 * material system required it, and it did not.
 */
const DESKTOP_OFFSET: StationOffset = { forward: -600, rise: 150 };

/**
 * The portrait camera path. §3 and §6.
 *
 * ## Why this is a curve now and was a constant before
 *
 * Portrait used to carry a fixed `{ forward: -280, rise: 0 }` on top of the
 * authored linear advance, so the only thing that changed with altitude was
 * 900 m of forward travel and 780 m of rise over the whole 30 000 — which at
 * the altitudes the range is actually visible over (0–12 000 m) is 360 m and
 * 200 m. The camera essentially did not move. §3's objection is exactly that:
 * "the mobile camera should not simply rise vertically through the terrain".
 *
 * ## The three legs, and what each is for
 *
 * Each key below is a station *offset* in model metres on top of the authored
 * path, and consecutive keys are joined with a smoothstep so the camera always
 * arrives rather than stopping and no join has a velocity discontinuity — the
 * same construction `dollyK` uses for the instrument's own dolly, for the same
 * reason.
 *
 *   approach  §6's low altitude: "closer terrain presence, lower camera,
 *             visible valley floor, broad framing". Positive `forward` puts the
 *             station *into* the valley mouth so the framing masses subtend
 *             more of the frame, and a small negative `rise` keeps the eye down
 *             near the floor.
 *
 *   frame     §6's mid ascent: "dolly backward … preserve valley width". This
 *             is where the mountain stages sit and where the brief measures, so
 *             it is the leg tuned hardest against the projected result rather
 *             than against world numbers. Pulling back opens the space around
 *             the instrument without touching the shared field of view.
 *
 *   open      the valley opening as altitude rises, which §6 asks for
 *             explicitly. The pull-back relaxes while the rise takes over, so
 *             the masses splay outward and the centre clears.
 *
 *   depart    §6's upper stage: "terrain begins to fall away … transition
 *             toward atmosphere feels like leaving terrain behind". Forward and
 *             up together, so the range drops below the frame as the cloud deck
 *             takes it — which is the handoff `mountainStateAt` is already
 *             fading on.
 *
 * ## Why the field of view is not part of this
 *
 * §3 allows "possibly slight FOV evolution" and it is deliberately not taken.
 * `camera.fov` is shared with the instrument: `fitDistance` in composition.ts
 * solves the dolly against it, and the portrait copy bands are laid out against
 * that same solve. Animating it would move the dial's projected size and the
 * band geometry at every altitude — reopening the accepted mobile spacing that
 * §21 freezes. Every effect the brief wants from a FOV change is available from
 * the station instead, and the station touches nothing else.
 */
type StationKey = { at: number; forward: number; rise: number };

const PORTRAIT_PATH: StationKey[] = [
  { at: 0, forward: 220, rise: -50 },
  { at: 2_600, forward: -340, rise: 30 },
  { at: 7_000, forward: -140, rise: 240 },
  { at: 12_000, forward: 480, rise: 600 },
];

const smoothstep01 = (t: number) => {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
};

/**
 * The portrait station offset at an altitude. A pure function, so the reverse
 * traversal reconstructs it exactly — see the note on determinism in
 * `mountains.ts`.
 */
export function portraitStation(altitude: number): StationOffset {
  const keys = PORTRAIT_PATH;
  if (altitude <= keys[0].at) return { forward: keys[0].forward, rise: keys[0].rise };
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1];
    const b = keys[i];
    if (altitude > b.at) continue;
    const k = smoothstep01((altitude - a.at) / (b.at - a.at));
    return {
      forward: a.forward + (b.forward - a.forward) * k,
      rise: a.rise + (b.rise - a.rise) * k,
    };
  }
  const last = keys[keys.length - 1];
  return { forward: last.forward, rise: last.rise };
}

/** The station offset for a variant at an altitude. */
export function stationOffset(variant: MountainVariant, altitude: number): StationOffset {
  return variant === 'mobile' ? portraitStation(altitude) : DESKTOP_OFFSET;
}

/**
 * Kept for the tests and tools that ask "what is the offset for this variant"
 * without an altitude. Desktop is exact; mobile reports its 0 m station, which
 * is the one the Blender previews are rendered at.
 */
export const STATION_OFFSET: Record<MountainVariant, StationOffset> = {
  desktop: DESKTOP_OFFSET,
  mobile: portraitStation(0),
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

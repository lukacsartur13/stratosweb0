import * as THREE from 'three';
import {
  MOUNTAIN_LOOK,
  tiltVector,
  toVector,
  type MountainLook,
} from '../mountainLook';
import type { MountainVariant } from '../mountainAsset';
import type { MountainState } from '../mountains';
import type { MountainDebug } from '../journey';

/**
 * The mountains' own shading model.
 *
 * ## Why a shader rather than a tuned `MeshStandardMaterial`
 *
 * The requirement is that the terrain and the instrument stop sharing a light
 * response. `MeshStandardMaterial` cannot express that, because its inputs are
 * the scene's lights and the scene's environment probe and there is no per-
 * object mask for either — `Light.layers` is tested against the camera, not
 * against the mesh, so it can turn a light off for a whole *view* and not for a
 * subtree. The options were a second render pass, a second scene, or a material
 * that does its own lighting. The third is the only one that is not a second
 * renderer, and it is also the cheapest of the three by a wide margin: no IBL
 * sample, no punctual light loop, no shadow lookup, no BRDF.
 *
 * ## What it is not
 *
 * No texture fetch, no second UV set, no Fresnel term, no outline, no facet
 * exaggeration, no image-based lighting. §12 asks for procedural material logic
 * rather than photo textures, and this is that taken literally: the zoning, the
 * erosion break-up and the micro-relief are all functions of the world position
 * and the surface normal, so the GLB does not grow by a byte and there is no
 * tiling to hide.
 *
 * There *is* now noise, which there was not before, and the note that used to
 * stand here said there never would be. That was right for the composition it
 * was written against and wrong for this one: with the terrain reframed the
 * masses are two to five kilometres out rather than five hundred metres, and at
 * that distance the flat-shaded facets that used to supply all the surface
 * information subtend a few pixels each. What reached the phone was a smooth
 * blockout. Two octaves of value noise — one on desktop — is what puts the rock
 * back, and `DETAIL_OCTAVES` keeps the cost where §15 asks for it.
 *
 * ## Tone mapping
 *
 * `toneMapped: false`, unlike the instrument. ACES's toe is what crushed the
 * shadow planes into the black wedges this pass exists to remove: on a subject
 * whose entire tonal range lives below sRGB 0x50 the filmic toe is not a look,
 * it is the loss of the only contrast there is. The colour-space encode is
 * still done properly — `<colorspace_fragment>` — which is a deliberate
 * difference from `Sky`, whose colours go out unencoded and land about a stop
 * and a half darker than their hex suggests. That is why the sky reads as flat
 * black at ground level, and it is the background these values are chosen
 * against.
 *
 * ## Cost
 *
 * Two materials for the whole range — terrain and route — against sixteen
 * before (the previous code built one `MeshStandardMaterial` per mesh). One
 * program, because both share a source string. Per frame: about thirty uniform
 * writes, all scalars and small vectors.
 */

/** The depth ramp, the lights and the atmosphere. One object per material. */
type Uniforms = Record<string, THREE.IUniform>;

const VERTEX = /* glsl */ `
  precision highp float;

  uniform float uRangeScale;   // scene units per model metre

  varying vec3  vNormalW;
  varying float vDepth;        // model metres from the camera
  varying float vHeight;       // model metres above the camera
  varying vec3  vModel;        // model metres, terrain-local — the noise domain

  void main() {
    vec4 world = modelMatrix * vec4( position, 1.0 );

    // The range is placed with a uniform scale and a translation and never a
    // rotation — see the similarity transform in mountains.ts — so the model
    // matrix's upper 3x3 is a scalar multiple of the identity and normalising
    // is all the correction the normal needs.
    vNormalW = normalize( mat3( modelMatrix ) * normal );

    vec4 mv = viewMatrix * world;

    // Both varyings are in *model metres*, which is what makes every constant
    // in mountainLook.ts readable: 4 200 is a background ridge, 640 is a crest.
    vDepth  = length( mv.xyz ) / uRangeScale;
    vHeight = ( world.y - cameraPosition.y ) / uRangeScale;

    // The noise has to be evaluated in a frame that is nailed to the rock, not
    // to the camera. 'position' is exactly that — the untransformed vertex, in
    // Blender's own metres — so the erosion pattern is a property of the
    // mountain and does not swim across it as the range is re-anchored to the
    // camera every frame. Using vHeight or a view-space position here is the
    // one mistake that turns procedural rock into crawling static.
    vModel = position;

    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT = /* glsl */ `
  precision highp float;

  uniform vec3  uKeyDir;
  uniform vec3  uKeyColor;
  uniform float uKeyIntensity;
  uniform float uKeyWrap;

  uniform vec3  uSkyColor;
  uniform vec3  uGroundColor;
  uniform float uFillIntensity;

  uniform vec3  uBounceDir;
  uniform vec3  uBounceColor;
  uniform float uBounceIntensity;

  uniform vec3  uAzimuthDir;
  uniform float uAzimuthAmount;

  uniform vec3  uBaseNear;
  uniform vec3  uBaseMid;
  uniform vec3  uBaseFar;
  uniform vec3  uLevel;
  uniform vec3  uContrast;
  uniform vec3  uFloor;
  uniform vec3  uFogScale;
  uniform vec2  uDepthSpan;

  uniform float uCrestFrom;
  uniform float uCrestTo;
  uniform float uCrestGain;
  uniform float uValleyDarken;

  uniform vec3  uZoneValley;
  uniform vec3  uZoneRock;
  uniform vec3  uZoneRidge;
  uniform vec3  uZoneSnow;
  uniform vec2  uZoneCross;    // valley→rock, rock→ridge, in model metres
  uniform float uZoneBlend;
  uniform vec3  uSnow;         // from, fade, slope
  uniform float uSnowAmount;
  uniform float uZoneAmount;
  uniform float uZoneJitter;
  uniform vec2  uErosion;      // wavelength in model metres, amplitude in metres
  uniform vec3  uRelief;       // wavelength, normal amplitude, roughness amount
  uniform float uSlopeRock;    // how hard a steep face is pushed toward rock
  uniform float uZoneDebug;    // 0 production, 1 writes the zone weights out

  uniform vec3  uFogColor;
  uniform float uFogDensity;
  uniform float uValleyDensity;
  uniform float uValleyFogTop;
  uniform float uValleyFogFalloff;
  uniform float uFogMax;
  uniform float uDissolve;

  uniform float uOpacity;

  varying vec3  vNormalW;
  varying float vDepth;
  varying float vHeight;
  varying vec3  vModel;

  /*
   * Value noise, hashed rather than sampled.
   *
   * §12 rules out photo textures and prefers procedural logic, and this is the
   * cheapest thing that gives geological break-up: no fetch, no sampler, no
   * tiling, nothing added to the GLB. One octave costs eight hashes; the second
   * is compiled in only where DETAIL_OCTAVES says so, which is how §15's "less
   * high-frequency detail on the small screen" is honoured without a branch.
   */
  float hash31( vec3 p ) {
    p = fract( p * 0.3183099 + vec3( 0.1, 0.2, 0.3 ) );
    p *= 17.0;
    return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) );
  }

  float vnoise( vec3 x ) {
    vec3 i = floor( x );
    vec3 f = fract( x );
    f = f * f * ( 3.0 - 2.0 * f );
    return mix(
      mix( mix( hash31( i + vec3( 0.0, 0.0, 0.0 ) ), hash31( i + vec3( 1.0, 0.0, 0.0 ) ), f.x ),
           mix( hash31( i + vec3( 0.0, 1.0, 0.0 ) ), hash31( i + vec3( 1.0, 1.0, 0.0 ) ), f.x ), f.y ),
      mix( mix( hash31( i + vec3( 0.0, 0.0, 1.0 ) ), hash31( i + vec3( 1.0, 0.0, 1.0 ) ), f.x ),
           mix( hash31( i + vec3( 0.0, 1.0, 1.0 ) ), hash31( i + vec3( 1.0, 1.0, 1.0 ) ), f.x ), f.y ),
      f.z );
  }

  /** Signed fBm, -1..1, at DETAIL_OCTAVES octaves. */
  float fbm( vec3 p ) {
    float v = vnoise( p ) * 2.0 - 1.0;
    #if DETAIL_OCTAVES > 1
      v += ( vnoise( p * 2.17 + 31.4 ) * 2.0 - 1.0 ) * 0.5;
      v /= 1.5;
    #endif
    return v;
  }

  void main() {
    vec3 N = normalize( vNormalW );

    // --- micro-relief --------------------------------------------------------
    // §11's "the terrain reads too much like smooth low-poly blockout".
    //
    // Perturbing the normal rather than displacing the surface, because the
    // silhouette is the composition and the composition has just been signed
    // off — a displacement would move the ridge lines this pass exists to
    // establish. Three noise gradients built from one fBm evaluated at offset
    // positions is the standard trick and it costs three fBm rather than a
    // derivative chain.
    //
    // The amplitude is deliberately small. This is what turns a flat facet into
    // a surface that catches the key differently across its width; it is not
    // meant to read as rubble.
    vec3 np = vModel / max( uRelief.x, 1.0 );
    float n0 = fbm( np );
    float nx = fbm( np + vec3( 0.35, 0.0, 0.0 ) );
    float nz = fbm( np + vec3( 0.0, 0.0, 0.35 ) );
    N = normalize( N + vec3( nx - n0, 0.0, nz - n0 ) * uRelief.y );

    // --- where this fragment sits on the depth ramp -------------------------
    // Per fragment rather than per mesh. Bucketing meshes into a foreground, a
    // midground and a background palette is exactly how depth separation ends
    // up reading as paper cut-outs, and it cannot grade VALLEY_FLOOR, which is
    // a single mesh spanning the entire scene from +900 to -4400.
    float d    = clamp( ( vDepth - uDepthSpan.x ) / ( uDepthSpan.y - uDepthSpan.x ), 0.0, 1.0 );
    float wMid = clamp( d * 2.0, 0.0, 1.0 );
    float wFar = clamp( d * 2.0 - 1.0, 0.0, 1.0 );

    // Albedo and level are kept apart here, where they used to be
    // premultiplied. The depth ramp's *level* is aerial perspective and has to
    // survive the zoning below untouched — it is what makes the background
    // recede — while its *albedo* is the thing the zoning replaces.
    vec3  baseCol  = mix( mix( uBaseNear, uBaseMid, wMid ), uBaseFar, wFar );
    float level    = mix( mix( uLevel.x,  uLevel.y,  wMid ), uLevel.z,  wFar );
    float contrast = mix( mix( uContrast.x, uContrast.y, wMid ), uContrast.z, wFar );
    float floorLit = mix( mix( uFloor.x,    uFloor.y,    wMid ), uFloor.z,    wFar );
    float fogScale = mix( mix( uFogScale.x, uFogScale.y, wMid ), uFogScale.z, wFar );

    // --- what this rock is made of ------------------------------------------
    // Four substances on two free masks: height for the bands, slope for the
    // snow. vHeight is already here for the crest ramp and N is already here
    // for the key, so the whole of §14's zoning costs a few smoothsteps and no
    // texture fetch. See the zone block in mountainLook.ts.

    /*
     * §10: the crossings must not look like horizontal stripes.
     *
     * Three things move the boundary, and each answers a different way of
     * failing:
     *
     *   erosion   low-frequency noise in the rock's own frame. This is what
     *             makes a band edge wander up a gully and down a spur instead
     *             of ruling a contour across the range. It replaces a per-face
     *             'sin(normal)' jitter, which was constant across a flat-shaded
     *             facet and therefore broke the line into *facets* — visibly
     *             the geometry's grid rather than geology.
     *
     *   slope     a steep face sheds its soil, so it is rock however low it
     *             sits. This is the term that puts stone in the valley walls
     *             and keeps the organic band on the shallow ground, which is
     *             the single strongest cue that the lower terrain is a
     *             different substance rather than a darker one.
     *
     *   jitter    kept, at a much smaller amplitude, purely as a high-frequency
     *             dither on top of the other two.
     */
    float ero = fbm( vModel / max( uErosion.x, 1.0 ) ) * uErosion.y;
    float h   = vHeight + ero + uZoneJitter * sin( vNormalW.x * 11.3 + vNormalW.z * 7.7 );

    float toRock  = smoothstep( uZoneCross.x - uZoneBlend, uZoneCross.x + uZoneBlend, h );
    // Steepness pushes toward rock independently of height. 'N.y' near zero is
    // a vertical face; near one is a ledge.
    toRock = clamp( toRock + uSlopeRock * ( 1.0 - smoothstep( 0.15, 0.72, N.y ) ), 0.0, 1.0 );

    float toRidge = smoothstep( uZoneCross.y - uZoneBlend, uZoneCross.y + uZoneBlend, h );
    vec3  zone    = mix( mix( uZoneValley, uZoneRock, toRock ), uZoneRidge, toRidge );

    // Snow needs height *and* a surface that can hold it. Steep faces shed it,
    // which is what keeps the accent on shoulders and ledges instead of
    // painting it across the silhouette the composition depends on. The same
    // erosion field breaks its lower edge, so the snow line is a drift rather
    // than an altitude.
    float snowH = smoothstep( uSnow.x, uSnow.x + uSnow.y, h );
    float snowS = smoothstep( uSnow.z, 1.0, N.y );
    float snow  = uSnowAmount * snowH * snowS;
    zone = mix( zone, uZoneSnow, snow );

    // uZoneAmount is the whole restraint budget in one number: at 0 this
    // resolves to the accepted monochrome palette exactly, so the zoning can be
    // reviewed against the look it replaces rather than argued about.
    vec3 base = mix( baseCol, zone, uZoneAmount ) * level;

    /*
     * §19's material-debug view, and the reason it is a uniform rather than a
     * second material.
     *
     * The review has to answer "can the four zones be told apart in the final
     * frame", which means the *same* fragments have to be classified and then
     * measured after lighting and atmosphere. A separate debug material would
     * be a different program with its own interpolation and would classify
     * different pixels. Writing the weights out of this one, on demand,
     * guarantees the mask and the picture describe the same shader.
     *
     * uZoneDebug is 0 in every production frame and the branch is uniform, so
     * it costs one scalar compare per fragment and no divergence. The view is
     * never shipped: nothing in the application writes this uniform, only the
     * capture script does.
     */
    // Hard categories in RGB rather than weights plus an alpha flag. The
    // material is in the transparent pass, so anything written to alpha is
    // consumed by the blend and never reaches a readback — the first version of
    // this signalled snow in alpha and classified every pixel in the scene as
    // snow.
    //
    //   valley (1,0,0)   rock (0,1,0)   ridge (0,0,1)   snow (1,1,0)
    if ( uZoneDebug > 0.5 ) {
      vec3 tag = ( toRidge > 0.5 ) ? vec3( 0.0, 0.0, 1.0 )
               : ( toRock  > 0.5 ) ? vec3( 0.0, 1.0, 0.0 )
                                   : vec3( 1.0, 0.0, 0.0 );
      if ( snow > 0.28 ) tag = vec3( 1.0, 1.0, 0.0 );
      gl_FragColor = vec4( tag, 1.0 );
      return;
    }

    // --- the key ------------------------------------------------------------
    // Wrapped, so the terminator is a curve rather than a clip. A hard Lambert
    // edge on a ridge is the near-black wedge this pass exists to remove.
    float lit = clamp( ( dot( N, uKeyDir ) + uKeyWrap ) / ( 1.0 + uKeyWrap ), 0.0, 1.0 );

    // The ramp, and the single term that does the most for "readable large-
    // scale planes". Smoothstep widens the mid-tones, which is where two ridge
    // faces at slightly different angles live; it is applied hardest in front
    // and barely at all behind, so the foreground gains local contrast while
    // the background stays flat and recedes.
    lit = mix( lit, lit * lit * ( 3.0 - 2.0 * lit ), contrast );

    // --- fill ---------------------------------------------------------------
    vec3 hemi   = mix( uGroundColor, uSkyColor, N.y * 0.5 + 0.5 ) * uFillIntensity;
    vec3 bounce = uBounceColor * ( uBounceIntensity * max( dot( N, uBounceDir ), 0.0 ) );

    vec3 light = uKeyColor * ( uKeyIntensity * lit ) + hemi + bounce;

    // The floor is a minimum on the *light*, not on the output, so it lifts the
    // shaded planes without touching the lit ones and without flattening the
    // albedo differences between the depth anchors.
    light = max( light, vec3( floorLit ) );

    vec3 col = base * light;

    // --- large-scale form ---------------------------------------------------
    float hgt = clamp( ( vHeight - uCrestFrom ) / ( uCrestTo - uCrestFrom ), 0.0, 1.0 );

    // Crests catch the sky; low up-facing ground is occluded by the walls
    // around it. Two gradients, no ambient-occlusion pass.
    col *= 1.0 + uCrestGain * hgt;
    col *= 1.0 - uValleyDarken * max( N.y, 0.0 ) * ( 1.0 - hgt );

    // Signed, so one flank is lifted and the opposite flank dropped by the same
    // amount. This is what separates two planes that face the key equally.
    col *= 1.0 + uAzimuthAmount * dot( N, uAzimuthDir );

    // --- atmosphere ---------------------------------------------------------
    // Exponential rather than a near/far smoothstep: real aerial perspective is
    // an optical depth, and an exponential needs one density per band instead
    // of two distances that have to be re-tuned every time the camera moves
    // along its 820 m of authored advance.
    float density = uFogDensity
      + uValleyDensity * exp( -max( vHeight - uValleyFogTop, 0.0 ) / uValleyFogFalloff );
    float fog = 1.0 - exp( -vDepth * density * fogScale );

    // The cloud deck's own approach, from mountains.ts. Taking the fog all the
    // way to 1 before the opacity moves is what makes the range dissolve into
    // the deck instead of being switched off.
    fog = mix( clamp( fog, 0.0, 1.0 ), 1.0, uDissolve );
    col = mix( col, uFogColor, fog );

    gl_FragColor = vec4( col, uOpacity );

    #include <colorspace_fragment>
  }
`;

/** A `THREE.Color` in the linear working space, from an sRGB hex. */
const linear = (hex: number) => new THREE.Color(hex);

function build(look: MountainLook, rangeScale: number): Uniforms {
  const key = toVector(look.key);
  const bounce = toVector(look.bounce);
  const tilt = tiltVector(look.azimuthTilt);

  return {
    uRangeScale: { value: rangeScale },

    uKeyDir: { value: new THREE.Vector3(...key) },
    uKeyColor: { value: linear(look.keyColor) },
    uKeyIntensity: { value: look.keyIntensity },
    uKeyWrap: { value: look.keyWrap },

    uSkyColor: { value: linear(look.skyColor) },
    uGroundColor: { value: linear(look.groundColor) },
    uFillIntensity: { value: look.fillIntensity },

    uBounceDir: { value: new THREE.Vector3(...bounce) },
    uBounceColor: { value: linear(look.bounceColor) },
    uBounceIntensity: { value: look.bounceIntensity },

    uAzimuthDir: { value: new THREE.Vector3(...tilt) },
    uAzimuthAmount: { value: look.azimuthAmount },

    uBaseNear: { value: linear(look.base[0]) },
    uBaseMid: { value: linear(look.base[1]) },
    uBaseFar: { value: linear(look.base[2]) },
    uLevel: { value: new THREE.Vector3(...look.level) },
    uContrast: { value: new THREE.Vector3(...look.contrast) },
    uFloor: { value: new THREE.Vector3(...look.floor) },
    uFogScale: { value: new THREE.Vector3(...look.fogScale) },
    uDepthSpan: { value: new THREE.Vector2(...look.depthSpan) },

    uCrestFrom: { value: look.crestFrom },
    uCrestTo: { value: look.crestTo },
    uCrestGain: { value: look.crestGain },
    uValleyDarken: { value: look.valleyDarken },

    uZoneValley: { value: linear(look.zone.valley) },
    uZoneRock: { value: linear(look.zone.rock) },
    uZoneRidge: { value: linear(look.zone.ridge) },
    uZoneSnow: { value: linear(look.zone.snow) },
    uZoneCross: { value: new THREE.Vector2(look.zone.valleyTo, look.zone.ridgeFrom) },
    uZoneBlend: { value: look.zone.blend },
    uSnow: { value: new THREE.Vector3(look.zone.snowFrom, look.zone.snowFade, look.zone.snowSlope) },
    uSnowAmount: { value: look.zone.snowAmount },
    uZoneAmount: { value: look.zone.amount },
    uZoneJitter: { value: look.zone.jitter },
    uErosion: { value: new THREE.Vector2(look.zone.erosionScale, look.zone.erosionAmount) },
    uSlopeRock: { value: look.zone.slopeRock },
    uRelief: { value: new THREE.Vector3(look.relief.scale, look.relief.amount, 0) },
    uZoneDebug: { value: 0 },

    uFogColor: { value: linear(look.fogColor) },
    uFogDensity: { value: look.fogDensity },
    uValleyDensity: { value: look.valleyDensity },
    uValleyFogTop: { value: look.valleyFogTop },
    uValleyFogFalloff: { value: look.valleyFogFalloff },
    uFogMax: { value: look.fogMax },
    uDissolve: { value: 0 },

    uOpacity: { value: 1 },
  };
}

export type MountainMaterials = {
  /** Everything except the route. */
  terrain: THREE.ShaderMaterial;
  /** `ASCENT_ROUTE`, which fades on its own curve. */
  route: THREE.ShaderMaterial;
  all: THREE.ShaderMaterial[];
};

export function createMountainMaterials(
  variant: MountainVariant,
  rangeScale: number
): MountainMaterials {
  const look = MOUNTAIN_LOOK[variant];

  const make = (uniforms: Uniforms) =>
    new THREE.ShaderMaterial({
      uniforms,
      /*
       * §15: the same material language, less high-frequency detail on the
       * small screen.
       *
       * A `#define` rather than a uniform, so the second octave is not compiled
       * into the mobile program at all — a uniform-gated branch would still pay
       * for the texture-free-but-not-free eight hashes on a phone GPU. Only one
       * variant is ever loaded per page (see `variantFor`), so this is one
       * program either way and not a permutation explosion.
       */
      defines: { DETAIL_OCTAVES: variant === 'mobile' ? 1 : 2 },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      // Same as the material this replaces: the range fades out rather than
      // popping, so it lives in the transparent pass for the whole journey and
      // the pass it lives in never changes mid-fade.
      transparent: true,
      depthWrite: true,
      toneMapped: false,
      fog: false,
    });

  const terrain = make(build(look, rangeScale));

  // The route is the same shader and therefore the same program; `applyLook`
  // swaps the rock albedo for the one non-rock colour in the scene and holds it
  // flat across the depth ramp, because it is a drawn line on the ground and
  // grading it by distance would make it fade out in the middle and reappear.
  const route = make(build(look, rangeScale));

  return { terrain, route, all: [terrain, route] };
}

/**
 * Which preset the look comes from. `debug.preset` exists so the desktop and
 * mobile lighting can be compared in one browser at one viewport, rather than
 * by resizing and waiting for a variant switch to re-fetch a GLB.
 */
export function lookFor(variant: MountainVariant, debug: MountainDebug | null): MountainLook {
  const forced = debug?.preset;
  return MOUNTAIN_LOOK[forced && forced !== 'auto' ? forced : variant];
}

/**
 * Write the whole look into the uniforms. Called once per frame from
 * `MountainRange`'s `useFrame`.
 *
 * *Every* uniform, not just the ones the altitude moves. Writing the full set
 * makes the uniforms a pure function of (look, state, debug) — which is what
 * lets the panel swap the entire preset, or a single light angle, mid-frame
 * with no rebuild and no stale value surviving from whichever preset the
 * materials happened to be constructed with. It is about sixty scalar and
 * small-vector writes per frame across both materials, none of which allocate.
 *
 * `debug` is `journey.debug.mountainLook` in development and `null` in
 * production, where the branch is statically eliminated at the call site.
 */
export function applyLook(
  mats: MountainMaterials,
  look: MountainLook,
  state: MountainState,
  debug: MountainDebug | null,
  altitude: number
): void {
  // The valley's own density belongs to the valley. By 7 000 m the camera has
  // risen out of it, and a valley fog still at full strength would be a haze
  // sitting in mid-air; the aerial density stays put, and above 6 000 m the
  // dissolve takes over from both.
  const inValley = 1 - Math.min(1, Math.max(0, altitude / 7_000));

  const key = toVector({
    azimuth: debug?.keyAzimuth ?? look.key.azimuth,
    elevation: debug?.keyElevation ?? look.key.elevation,
  });
  const bounce = toVector(look.bounce);
  const tilt = tiltVector(look.azimuthTilt);

  for (const m of mats.all) {
    const u = m.uniforms;
    const isRoute = m === mats.route;

    // --- state --------------------------------------------------------------
    u.uOpacity.value = isRoute ? state.opacity * state.route : state.opacity;
    u.uDissolve.value = state.fog;

    // --- lights -------------------------------------------------------------
    (u.uKeyDir.value as THREE.Vector3).set(key[0], key[1], key[2]);
    (u.uKeyColor.value as THREE.Color).set(look.keyColor);
    u.uKeyIntensity.value = debug?.keyIntensity ?? look.keyIntensity;
    u.uKeyWrap.value = look.keyWrap;

    (u.uSkyColor.value as THREE.Color).set(look.skyColor);
    (u.uGroundColor.value as THREE.Color).set(look.groundColor);
    u.uFillIntensity.value = debug?.fillIntensity ?? look.fillIntensity;

    (u.uBounceDir.value as THREE.Vector3).set(bounce[0], bounce[1], bounce[2]);
    (u.uBounceColor.value as THREE.Color).set(look.bounceColor);
    u.uBounceIntensity.value = look.bounceIntensity;

    (u.uAzimuthDir.value as THREE.Vector3).set(tilt[0], tilt[1], tilt[2]);
    u.uAzimuthAmount.value = look.azimuthAmount;

    // --- palette ------------------------------------------------------------
    if (isRoute) {
      const level = look.routeLevel;
      for (const slot of ['uBaseNear', 'uBaseMid', 'uBaseFar']) {
        (u[slot].value as THREE.Color).set(look.routeColor);
      }
      (u.uLevel.value as THREE.Vector3).set(level, level, level);
    } else {
      (u.uBaseNear.value as THREE.Color).set(look.base[0]);
      (u.uBaseMid.value as THREE.Color).set(look.base[1]);
      (u.uBaseFar.value as THREE.Color).set(look.base[2]);
      (u.uLevel.value as THREE.Vector3).set(
        debug?.levelNear ?? look.level[0],
        debug?.levelMid ?? look.level[1],
        debug?.levelFar ?? look.level[2]
      );
    }
    (u.uContrast.value as THREE.Vector3).set(...look.contrast);
    (u.uFloor.value as THREE.Vector3).set(...look.floor);
    (u.uFogScale.value as THREE.Vector3).set(...look.fogScale);
    (u.uDepthSpan.value as THREE.Vector2).set(...look.depthSpan);

    // --- material zoning ----------------------------------------------------
    // The route is the one non-rock element in the scene — a drawn line on the
    // ground — so it opts out entirely rather than being zoned by the altitude
    // it happens to be crossing. Zoning it would fade it into the valley at the
    // bottom and frost it at the top, which is a line that disappears where it
    // matters most.
    (u.uZoneValley.value as THREE.Color).set(look.zone.valley);
    (u.uZoneRock.value as THREE.Color).set(look.zone.rock);
    (u.uZoneRidge.value as THREE.Color).set(look.zone.ridge);
    (u.uZoneSnow.value as THREE.Color).set(look.zone.snow);
    (u.uZoneCross.value as THREE.Vector2).set(look.zone.valleyTo, look.zone.ridgeFrom);
    u.uZoneBlend.value = look.zone.blend;
    (u.uSnow.value as THREE.Vector3).set(look.zone.snowFrom, look.zone.snowFade, look.zone.snowSlope);
    u.uSnowAmount.value = isRoute ? 0 : look.zone.snowAmount;
    u.uZoneAmount.value = isRoute ? 0 : look.zone.amount;
    u.uZoneJitter.value = look.zone.jitter;
    (u.uErosion.value as THREE.Vector2).set(look.zone.erosionScale, look.zone.erosionAmount);
    u.uSlopeRock.value = isRoute ? 0 : look.zone.slopeRock;
    // The route is a drawn line on the ground, so it keeps the flat surface a
    // line needs — perturbing its normal would make it glitter along its length.
    (u.uRelief.value as THREE.Vector3).set(look.relief.scale, isRoute ? 0 : look.relief.amount, 0);

    // --- form ---------------------------------------------------------------
    u.uCrestFrom.value = look.crestFrom;
    u.uCrestTo.value = look.crestTo;
    u.uCrestGain.value = debug?.crestGain ?? look.crestGain;
    u.uValleyDarken.value = debug?.valleyDarken ?? look.valleyDarken;

    // --- atmosphere ---------------------------------------------------------
    u.uFogDensity.value = look.fogDensity * (debug?.depthFog ?? 1);
    u.uValleyDensity.value = look.valleyDensity * inValley * (debug?.heightFog ?? 1);
    u.uValleyFogTop.value = look.valleyFogTop;
    u.uValleyFogFalloff.value = look.valleyFogFalloff;
    u.uFogMax.value = look.fogMax;

    // The range dissolves *into* the deck, so the colour it dissolves into has
    // to become the deck. One lerp, on the same number that drives the fog.
    (u.uFogColor.value as THREE.Color)
      .set(debug?.atmosphere ?? look.fogColor)
      .lerp(TMP_FOG.set(look.fogColorHigh), state.fog);
  }
}

const TMP_FOG = new THREE.Color();

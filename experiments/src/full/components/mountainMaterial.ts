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
 * No noise, no triplanar texture, no Fresnel term, no outline, no facet
 * exaggeration. Every term below is a low-frequency function of the surface
 * normal, the height or the camera distance, because the brief's line is that
 * the shading should reveal the geology rather than decorate it — and because
 * a per-fragment `sin()` chain over 50% of a 1170×2532 phone framebuffer is a
 * real cost for something the displaced geometry already provides.
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

  uniform vec3  uFogColor;
  uniform float uFogDensity;
  uniform float uValleyDensity;
  uniform float uValleyFogTop;
  uniform float uValleyFogFalloff;
  uniform float uDissolve;

  uniform float uOpacity;

  varying vec3  vNormalW;
  varying float vDepth;
  varying float vHeight;

  void main() {
    vec3 N = normalize( vNormalW );

    // --- where this fragment sits on the depth ramp -------------------------
    // Per fragment rather than per mesh. Bucketing meshes into a foreground, a
    // midground and a background palette is exactly how depth separation ends
    // up reading as paper cut-outs, and it cannot grade VALLEY_FLOOR, which is
    // a single mesh spanning the entire scene from +900 to -4400.
    float d    = clamp( ( vDepth - uDepthSpan.x ) / ( uDepthSpan.y - uDepthSpan.x ), 0.0, 1.0 );
    float wMid = clamp( d * 2.0, 0.0, 1.0 );
    float wFar = clamp( d * 2.0 - 1.0, 0.0, 1.0 );

    vec3  base     = mix( mix( uBaseNear * uLevel.x, uBaseMid * uLevel.y, wMid ), uBaseFar * uLevel.z, wFar );
    float contrast = mix( mix( uContrast.x, uContrast.y, wMid ), uContrast.z, wFar );
    float floorLit = mix( mix( uFloor.x,    uFloor.y,    wMid ), uFloor.z,    wFar );
    float fogScale = mix( mix( uFogScale.x, uFogScale.y, wMid ), uFogScale.z, wFar );

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

    uFogColor: { value: linear(look.fogColor) },
    uFogDensity: { value: look.fogDensity },
    uValleyDensity: { value: look.valleyDensity },
    uValleyFogTop: { value: look.valleyFogTop },
    uValleyFogFalloff: { value: look.valleyFogFalloff },
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

    // The range dissolves *into* the deck, so the colour it dissolves into has
    // to become the deck. One lerp, on the same number that drives the fog.
    (u.uFogColor.value as THREE.Color)
      .set(debug?.atmosphere ?? look.fogColor)
      .lerp(TMP_FOG.set(look.fogColorHigh), state.fog);
  }
}

const TMP_FOG = new THREE.Color();

import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { clamp, ease, journey, lerp, span } from '../journey';

/**
 * Earth, seen as curvature rather than as a planet.
 *
 * The brief was specific and it is the right call: what should be visible is a
 * curve, a dark surface, and a thin atmospheric glow — not an interactive
 * globe. So this is two spheres and no textures at all:
 *
 *   * the body, a large dark sphere with a shallow terminator so the lit limb
 *     is brighter than the mass behind it;
 *   * a slightly larger shell rendered back-face-only with an inverse-fresnel
 *     falloff, which is the cheapest honest approximation of an atmosphere seen
 *     edge-on and produces the thin bright rim along the horizon.
 *
 * What this deliberately is not: an 8K albedo texture (the surface is nearly
 * black at this exposure — the texture would be invisible and cost 4 MB), a
 * cloud layer sphere (there is a cloud deck already, and it is closer), or
 * volumetric scattering (a ray march per fragment for a rim that a one-line
 * fresnel gets close enough to at this scale).
 *
 * Nothing here is mounted until the journey is near it — see JourneyScene.
 */

const BODY_VERT = /* glsl */ `
  varying vec3 vNormal;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const BODY_FRAG = /* glsl */ `
  precision mediump float;
  varying vec3 vNormal;
  uniform vec3  uSurface;
  uniform vec3  uLit;
  uniform vec3  uSun;
  uniform float uOpacity;

  void main() {
    // A soft terminator. Real Earth from 30 km is mostly in shadow at the angle
    // this scene implies, and a hard day/night line at this scale looks like a
    // sphere with a texture on it rather than like a planet.
    float lambert = clamp(dot(normalize(vNormal), normalize(uSun)) * 0.5 + 0.5, 0.0, 1.0);
    lambert = pow(lambert, 1.7);
    vec3 col = mix(uSurface, uLit, lambert);
    gl_FragColor = vec4(col, uOpacity);
  }
`;

const RIM_VERT = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

const RIM_FRAG = /* glsl */ `
  precision mediump float;
  varying vec3 vNormal;
  varying vec3 vView;
  uniform vec3  uGlow;
  uniform float uStrength;
  uniform float uPower;

  void main() {
    // Back faces, so the normal points away: the rim is where the *inverse*
    // fresnel peaks, i.e. where the line of sight grazes the shell. That is
    // geometrically the same place the real atmosphere is thickest edge-on,
    // which is why this cheap trick looks right rather than merely glowy.
    float f = 1.0 - abs(dot(normalize(vNormal), normalize(vView)));
    float a = pow(clamp(f, 0.0, 1.0), uPower) * uStrength;
    gl_FragColor = vec4(uGlow, a);
  }
`;

/**
 * The globe's radius, in world units.
 *
 * Not to scale, deliberately, and this is the one place the scene tells a
 * useful lie. A radius large enough to be proportionally honest at 30 km makes
 * the limb's sagitta about 2% of the frame height — technically correct, and
 * indistinguishable from a straight line, which is the one thing this shot must
 * not be. At radius 9 the curve reads across the frame while the horizon stays
 * low and the composition stays calm.
 *
 * Found by measuring rather than by eye: the first pass used radius 30 centred
 * 35 units down, which put the entire globe below the bottom of the frame and
 * produced a final payoff of empty sky.
 */
const RADIUS = 9;

export function EarthLimb({ simplified }: { simplified: boolean }) {
  const group = useRef<THREE.Group>(null);
  const bodyMat = useRef<THREE.ShaderMaterial>(null);
  const rimMat = useRef<THREE.ShaderMaterial>(null);
  const camera = useThree((s) => s.camera);

  const bodyUniforms = useMemo(
    () => ({
      // Dark, and only just not black.
      //
      // The first tuning pass had the lit side at 0x2e557f, which filled the
      // lower third of the final frame with bright blue and turned the payoff
      // into a poster of a planet. What the brief asked for — and what the shot
      // actually needs, with a headline over it — is a dark mass whose *edge*
      // is the bright thing. The body is now barely above the sky's zenith
      // value, and all the light in the frame comes from the rim shell.
      uSurface: { value: new THREE.Color(0x03060c) },
      uLit: { value: new THREE.Color(0x11243a) },
      uSun: { value: new THREE.Vector3(-0.55, 0.45, 0.7) },
      uOpacity: { value: 0 },
    }),
    [],
  );

  const rimUniforms = useMemo(
    () => ({
      uGlow: { value: new THREE.Color(0x63a6e0) },
      uStrength: { value: 0 },
      // Steep. At 3.2 the falloff spread halfway up the disc and read as a
      // glowing planet; at 7 it stays a band along the limb, which is what the
      // atmosphere seen edge-on actually is.
      uPower: { value: 7 },
    }),
    [],
  );

  useFrame(() => {
    if (!journey.running) return;
    const m = journey.altitude;

    // Earth emerges over the transition stage and is fully present by the time
    // the journey tops out. Before 24 000 m there is nothing to see: at that
    // altitude the curve is genuinely not visible to the eye, and showing it
    // early is the single most common way this shot looks fake.
    const presence = ease(span(m, 24_000, 29_000));
    const scale = clamp(journey.debug.earthScale, 0.4, 2.2);

    bodyUniforms.uOpacity.value = presence;
    rimUniforms.uStrength.value = presence * 1.15 * journey.debug.horizonGlow;

    if (group.current) {
      group.current.visible = presence > 0.004;

      const radius = RADIUS * scale;
      // How far the limb sits below the camera's eye line. Positioned relative
      // to the camera rather than to the world origin, because the camera
      // dollies back through this stage and a world-fixed globe would drift
      // down the frame as it did so.
      //
      // Rises into frame as the altitude climbs — 1.5 units below at 24 000 m,
      // 0.45 at the top — so the curve is arrived at rather than switched on.
      const drop = lerp(1.5, 0.45, presence);
      group.current.position.y = camera.position.y - radius - drop;
      group.current.scale.setScalar(radius);
    }

    if (bodyMat.current) bodyMat.current.uniforms.uOpacity.value = presence;
    if (rimMat.current) rimMat.current.uniforms.uStrength.value = rimUniforms.uStrength.value;
  });

  const segments = simplified ? 32 : 64;

  return (
    <group ref={group} visible={false}>
      <mesh renderOrder={-500}>
        <sphereGeometry args={[1, segments, segments / 2]} />
        <shaderMaterial
          ref={bodyMat}
          args={[{ uniforms: bodyUniforms, vertexShader: BODY_VERT, fragmentShader: BODY_FRAG }]}
          transparent
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      {/* The shell is 2% larger. Thicker reads as a halo, thinner disappears
          under the body's own edge antialiasing. */}
      <mesh renderOrder={-499} scale={1.02}>
        <sphereGeometry args={[1, segments, segments / 2]} />
        <shaderMaterial
          ref={rimMat}
          args={[{ uniforms: rimUniforms, vertexShader: RIM_VERT, fragmentShader: RIM_FRAG }]}
          side={THREE.BackSide}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

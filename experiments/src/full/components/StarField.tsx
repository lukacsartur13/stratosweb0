import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { clamp, ease, journey, span } from '../journey';

/**
 * Stars, sparse and late.
 *
 * The brief drew a hard line here and it is the right one: no nebulae, no
 * galaxy, no field so dense it reads as science fiction. From 30 km the sky is
 * dark but you are still inside the atmosphere — what you actually see is a few
 * hundred of the brightest stars, not the Milky Way.
 *
 * So: 420 points on the desktop tier, brightness distributed so that most are
 * barely there and a handful carry the composition, and none of them visible at
 * all below 24 000 m. They also fade toward the horizon, because the airmass
 * you are looking through near the limb still washes them out.
 *
 * One draw call, no texture, no sprite sheet.
 */
export function StarField({ simplified }: { simplified: boolean }) {
  const points = useRef<THREE.Points>(null);
  const camera = useThree((s) => s.camera);

  const count = simplified ? 180 : 420;

  const geometry = useMemo(() => {
    // Fixed sequence: the constellation is identical on every load, so the
    // regression screenshots compare like with like.
    let s = 1337;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);

    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const alphas = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      // Distributed on the upper hemisphere only. Below the horizon there is
      // Earth, and stars showing through it is the classic tell.
      const theta = rnd() * Math.PI * 2;
      const y = 0.06 + rnd() * 0.94;
      const r = Math.sqrt(Math.max(0, 1 - y * y));

      positions[i * 3] = Math.cos(theta) * r;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = Math.sin(theta) * r;

      // A steep power distribution: most stars are faint, a few are not. A
      // uniform distribution is what makes a star field look like noise.
      const m = Math.pow(rnd(), 3.2);
      sizes[i] = 0.6 + m * 2.6;
      // Brightness fades toward the horizon — airmass, and it also keeps the
      // stars off the Earth's lit limb where they would look pasted on.
      alphas[i] = (0.25 + m * 0.75) * clamp(y * 1.6, 0, 1);
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
    return g;
  }, [count]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  const uniforms = useMemo(() => ({ uOpacity: { value: 0 }, uScale: { value: 1 } }), []);

  useFrame(() => {
    if (!journey.running) return;

    // Ride with the camera: these are at infinity conceptually, and a fixed
    // sphere would parallax against a moving camera, which stars do not.
    if (points.current) points.current.position.copy(camera.position);

    const appear = ease(span(journey.altitude, 24_000, 29_000));
    uniforms.uOpacity.value = appear * clamp(journey.debug.starDensity, 0, 2);
    if (points.current) points.current.visible = uniforms.uOpacity.value > 0.004;
  });

  return (
    <points ref={points} geometry={geometry} renderOrder={-800} frustumCulled={false} visible={false}>
      <shaderMaterial
        args={[
          {
            uniforms,
            vertexShader: /* glsl */ `
              attribute float aSize;
              attribute float aAlpha;
              varying float vAlpha;
              uniform float uScale;
              void main() {
                vAlpha = aAlpha;
                // Placed just inside the sky dome's radius so it draws over it.
                vec4 mv = modelViewMatrix * vec4(position * 0.9, 1.0);
                gl_Position = projectionMatrix * mv;
                gl_PointSize = aSize * uScale;
              }
            `,
            fragmentShader: /* glsl */ `
              precision mediump float;
              varying float vAlpha;
              uniform float uOpacity;
              void main() {
                // Round, with a soft edge. A square point is the other classic
                // tell, and it costs one length() to avoid.
                vec2 d = gl_PointCoord - vec2(0.5);
                float a = smoothstep(0.5, 0.12, length(d)) * vAlpha * uOpacity;
                if (a < 0.01) discard;
                gl_FragColor = vec4(vec3(0.86, 0.91, 1.0), a);
              }
            `,
          },
        ]}
        transparent
        depthWrite={false}
        depthTest={false}
        blending={THREE.AdditiveBlending}
        toneMapped={false}
      />
    </points>
  );
}

import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { clamp, ease, journey, lerp, span } from '../journey';

/**
 * The sky, and with it most of the journey's emotional arc.
 *
 * This is one inverted sphere with a twelve-line fragment shader, and it
 * replaces what would otherwise be a stack of separate effects: a background
 * colour, a gradient plane, a horizon glow sprite and a fog tint, each fading
 * against the others and each needing to agree about what altitude it is. One
 * shader reading one altitude cannot disagree with itself, which is the whole
 * reason the result reads as a single continuous climb rather than as cross-
 * fading layers.
 *
 * Cost: 1 draw call, no textures, no render targets. The alternative — real
 * atmospheric scattering — is beautiful, costs a ray march per fragment, and
 * would be the single most expensive thing on the page for a difference that a
 * dark scene behind text does not repay.
 */

/**
 * The palette, keyed by altitude in metres.
 *
 * `top` is the zenith, `horizon` the band at eye level. The pair is what
 * carries the story: at ground level they are nearly the same near-black; in
 * cloud they converge again on a bright diffuse grey; above 25 000 m the top
 * drains to almost black while the horizon keeps a thin lit edge, which is what
 * being above most of the atmosphere actually looks like.
 *
 * Sampled from the site's own palette at the dark end so the route never looks
 * like a different brand from the page it links back to.
 */
const BANDS: { at: number; top: number; horizon: number; glow: number }[] = [
  { at: 0,      top: 0x04060a, horizon: 0x0a0f18, glow: 0.10 },
  { at: 1_500,  top: 0x05080f, horizon: 0x121b28, glow: 0.16 },
  { at: 3_000,  top: 0x070d1a, horizon: 0x1d2a3d, glow: 0.24 },
  { at: 6_000,  top: 0x14243c, horizon: 0x3d5165, glow: 0.34 },
  // Inside the deck: bright, diffuse, and almost flat — the defining property
  // of cloud is that there is no horizon in it.
  { at: 8_500,  top: 0x6d7b8c, horizon: 0x8c98a6, glow: 0.30 },
  // Out the top. The sky opens and the blue is finally allowed to exist.
  { at: 11_000, top: 0x27568f, horizon: 0x7ea6cf, glow: 0.52 },
  { at: 14_000, top: 0x1d4880, horizon: 0x6f9ac6, glow: 0.50 },
  { at: 17_000, top: 0x173c72, horizon: 0x6291bf, glow: 0.48 },
  { at: 22_000, top: 0x0e2a58, horizon: 0x4b7cad, glow: 0.44 },
  // The drain toward indigo. Deliberately not toward violet: the brief asked
  // for near-Earth, and violet reads as science fiction.
  { at: 25_500, top: 0x07193a, horizon: 0x2f5c92, glow: 0.40 },
  { at: 28_000, top: 0x030c22, horizon: 0x1d4478, glow: 0.36 },
  { at: 30_000, top: 0x01060f, horizon: 0x16365f, glow: 0.34 },
];

function sample(metres: number, out: { top: THREE.Color; horizon: THREE.Color; glow: number }) {
  let a = BANDS[0];
  let b = BANDS[BANDS.length - 1];
  for (let i = 0; i < BANDS.length - 1; i++) {
    if (metres <= BANDS[i + 1].at) {
      a = BANDS[i];
      b = BANDS[i + 1];
      break;
    }
    a = BANDS[i];
    b = BANDS[i + 1];
  }
  const k = ease(span(metres, a.at, b.at));
  out.top.setHex(a.top).lerp(TMP.setHex(b.top), k);
  out.horizon.setHex(a.horizon).lerp(TMP.setHex(b.horizon), k);
  out.glow = lerp(a.glow, b.glow, k);
  return out;
}

const TMP = new THREE.Color();

const VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    // Direction from the centre of the sphere, which for a sky dome is the view
    // direction — no need for the camera position at all.
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  precision mediump float;
  varying vec3 vDir;

  uniform vec3  uTop;
  uniform vec3  uHorizon;
  uniform float uGlow;      // strength of the lit band at the horizon
  uniform float uHorizonY;  // where the band sits, in normalised height
  uniform float uDither;    // magnitude of the ordered dither, in 1/255 units

  void main() {
    float h = vDir.y;

    // Two-stop gradient, biased so most of the visible sky is the top colour
    // and the transition happens close to the horizon — which is how a real sky
    // is distributed, and why a linear gradient always looks like a backdrop.
    float t = clamp((h - uHorizonY) / (1.0 - uHorizonY), 0.0, 1.0);
    vec3 col = mix(uHorizon, uTop, pow(t, 0.62));

    // Below the horizon, fall away rather than mirroring: there is either cloud
    // or Earth down there, drawn by something else, and a mirrored sky reads as
    // a reflection nobody asked for.
    float below = clamp((uHorizonY - h) / max(uHorizonY + 1.0, 0.001), 0.0, 1.0);
    col = mix(col, uHorizon * 0.35, below * 0.9);

    // The thin lit edge. A narrow band, not a bloom — this is the one place the
    // scene is allowed to be bright, and widening it is what turns a horizon
    // into a lens flare.
    float band = exp(-pow((h - uHorizonY) * 9.0, 2.0));
    col += uHorizon * band * uGlow;

    // A large, smooth gradient across 8-bit channels bands visibly, especially
    // in the near-black stages. An ordered dither below the quantisation step
    // costs one fract and removes it entirely.
    float d = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
    col += (d - 0.5) * uDither;

    gl_FragColor = vec4(col, 1.0);
  }
`;

export function Sky({ simplified }: { simplified: boolean }) {
  const mat = useRef<THREE.ShaderMaterial>(null);
  const dome = useRef<THREE.Mesh>(null);
  const camera = useThree((s) => s.camera);
  const colours = useMemo(
    () => ({ top: new THREE.Color(), horizon: new THREE.Color(), glow: 0 }),
    [],
  );

  const uniforms = useMemo(
    () => ({
      uTop: { value: new THREE.Color(0x04060a) },
      uHorizon: { value: new THREE.Color(0x0a0f18) },
      uGlow: { value: 0.1 },
      uHorizonY: { value: -0.28 },
      uDither: { value: 1.6 / 255 },
    }),
    [],
  );

  useFrame(() => {
    if (!journey.running || !mat.current) return;
    const u = mat.current.uniforms;

    // The dome rides with the camera. It is a unit sphere drawn with depth
    // testing off, so its size is irrelevant — but the camera has to stay
    // *inside* it, or back-face culling leaves the frame empty. Following the
    // camera is one vector copy; the alternative, a sphere large enough to
    // contain the whole camera path, needs a far plane to match and pushes
    // every other object's depth precision down with it.
    if (dome.current) dome.current.position.copy(camera.position);

    sample(journey.altitude, colours);
    u.uTop.value.copy(colours.top);
    u.uHorizon.value.copy(colours.horizon);

    // The horizon drops as the journey climbs: at ground level it is below the
    // frame, and by 30 000 m it has fallen far enough that the Earth's curve
    // reads as a curve rather than as a straight edge.
    const drop = ease(span(journey.altitude, 8_000, 30_000));
    u.uHorizonY.value = lerp(-0.16, -0.52, drop);

    u.uGlow.value = colours.glow * journey.debug.horizonGlow;

    // The debug darkness knob multiplies the top colour only. Darkening the
    // horizon too just turns the scene off.
    const dark = clamp(journey.debug.atmosphereDark, 0.2, 1.6);
    if (dark !== 1) u.uTop.value.multiplyScalar(dark);
  });

  return (
    // Rendered first and never depth-tested, so it is always behind everything
    // without needing a far plane large enough to contain it.
    <mesh ref={dome} renderOrder={-1000} frustumCulled={false}>
      <sphereGeometry args={[1, simplified ? 24 : 40, simplified ? 16 : 24]} />
      <shaderMaterial
        ref={mat}
        args={[{ uniforms, vertexShader: VERT, fragmentShader: FRAG }]}
        side={THREE.BackSide}
        depthWrite={false}
        depthTest={false}
        toneMapped={false}
      />
    </mesh>
  );
}

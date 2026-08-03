import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import type { Group, Mesh, MeshStandardMaterial, Object3D } from 'three';
import { ascent, clamp, damp, lerp, span } from '@/lib/ascent';

export const MODEL_URL = `${import.meta.env.BASE_URL}models/stratos-altimeter.glb`;

// Blender authors the instrument facing -Y; the glTF exporter's Y-up conversion
// turns that into +Z, so the dial already faces the camera with no correction.
// The needles keep their origin on the spindle, which is why rotating them is a
// single assignment rather than a matrix dance.
const REV = Math.PI * 2;
const DEG = Math.PI / 180;

/**
 * Presentation pose — the one knob for how the instrument is angled.
 *
 * This lives here rather than in the .blend on purpose. Baking a tilt into the
 * model would put a non-identity rotation on every object, and on the needles
 * specifically it would take the spindle off the dial axis, at which point
 * `rotation.z` no longer sweeps the pointer around the face. Keeping the model
 * square and posing it in the scene costs one matrix and stays adjustable
 * without a re-export.
 *
 * The instrument squares up as it powers on: a slight three-quarter angle at
 * ground level, close to straight-on once the dial is lit and being read.
 */
const POSE = {
  ground: { pitch: -7 * DEG, yaw: 12 * DEG },
  lit: { pitch: -2 * DEG, yaw: 3 * DEG },
};

/** One turn of the long pointer is 1 000 m — the same convention as the real instrument. */
const primaryAngle = (metres: number) => -((metres % 1000) / 1000) * REV;
/** One turn of the short pointer is the whole 10 000 m dial. */
const secondaryAngle = (metres: number) => -(metres / 10000) * REV;

type Emissive = { mat: MeshStandardMaterial; base: number };

export function AltimeterModel() {
  const { scene, materials } = useGLTF(MODEL_URL);
  const root = useRef<Group>(null);
  const size = useThree((s) => s.size);

  /**
   * Where the instrument sits relative to the prose.
   *
   * Landscape: the copy owns the left third, so the instrument moves right of
   * centre. Portrait: there is no left third — the copy is full width and sits
   * at the bottom, so the instrument moves *up* instead. Centring it on a phone
   * puts the dial directly behind the paragraph, where neither is readable.
   */
  const offset = useMemo(() => {
    const landscape = size.width / size.height > 1.2;
    return landscape ? { x: 0.34, y: 0 } : { x: 0, y: 0.62 };
  }, [size]);

  // useGLTF caches by URL, so the same object graph would be shared if this
  // ever mounted twice. Clone defensively rather than mutating the cache.
  const model = useMemo(() => scene.clone(true), [scene]);

  const needles = useMemo(() => {
    const find = (name: string) => model.getObjectByName(name) ?? null;
    return {
      primary: find('ALT_Needle_Primary'),
      secondary: find('ALT_Needle_Secondary'),
    } as { primary: Object3D | null; secondary: Object3D | null };
  }, [model]);

  // The materials that participate in the power-on ramp. Their authored
  // emissive strength is the target; the scene starts at zero and comes up.
  const lit = useMemo<Emissive[]>(() => {
    const names = ['MAT_Marking_Chrome', 'MAT_Signal_Beacon', 'MAT_Needle_Paper'];
    return names
      .map((n) => materials[n] as MeshStandardMaterial | undefined)
      .filter((m): m is MeshStandardMaterial => !!m)
      .map((mat) => ({ mat, base: mat.emissiveIntensity ?? 1 }));
  }, [materials]);

  useEffect(() => {
    // Shadow casting on a single hero object buys almost nothing and costs a
    // whole depth pass, so the instrument lights itself and never casts.
    model.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = true;
    });
    return () => {
      for (const { mat, base } of lit) mat.emissiveIntensity = base;
    };
  }, [model, lit]);

  const smoothed = useRef({ primary: 0, secondary: 0, power: 0 });

  useFrame((_, delta) => {
    if (!ascent.running) return;
    const dt = Math.min(delta, 1 / 20);
    const s = smoothed.current;

    // The pointers lag the scroll slightly and settle — a real needle has mass.
    s.primary = damp(s.primary, primaryAngle(ascent.altitude), 0.72, dt);
    s.secondary = damp(s.secondary, secondaryAngle(ascent.altitude), 0.86, dt);
    if (needles.primary) needles.primary.rotation.z = s.primary;
    if (needles.secondary) needles.secondary.rotation.z = s.secondary;

    // Instrument activation: the markings come up out of the dark rather than
    // being lit from the first frame.
    s.power = damp(s.power, ascent.power, 0.88, dt);
    // A floor rather than zero: the dial has to be legible in the first frame —
    // it is the hero — so activation is a rise from dim to lit, not from black.
    for (const { mat, base } of lit) mat.emissiveIntensity = base * (0.24 + 0.76 * s.power);

    if (root.current) {
      // The whole instrument drifts a few millimetres as the scene climbs, so
      // it never sits perfectly static against the moving atmosphere.
      const drift = span(ascent.current, 0, 1);
      root.current.position.x = offset.x;
      root.current.position.y = offset.y - 0.02 + drift * 0.05;

      // Square up as the dial lights, then hold. No roll: an altimeter with its
      // zero off the vertical reads as broken, not as styled.
      const settle = clamp(s.power);
      root.current.rotation.x = lerp(POSE.ground.pitch, POSE.lit.pitch, settle);
      root.current.rotation.y = lerp(POSE.ground.yaw, POSE.lit.yaw, settle);
      root.current.rotation.z = 0;
    }
  });

  return (
    <group ref={root} dispose={null}>
      <primitive object={model} />
    </group>
  );
}

useGLTF.preload(MODEL_URL);

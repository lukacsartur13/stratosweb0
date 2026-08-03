import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { settle, journey } from '../journey';
import { FINAL_CALIBRATED_OPEN, meridian } from '../meridian';
import { IRIS, RETAINER_PROFILE, type MeridianParts } from './meridianParts';

/**
 * The mechanical iris at the centre of the dial.
 *
 * It sits on the dial as an inner plate — the kind a real instrument has over
 * its centre boss — rather than being cut into the face, because the face is a
 * baked mesh and cutting a hole in it at runtime would mean shipping a second
 * dial. The plate is 0.11 units across against a 0.41 dial: the free space
 * between the "×1000 m" legend above the centre and the "ALTITUDE" legend below
 * it, which is the only region of this dial an aperture can occupy without
 * covering something the instrument already says.
 *
 * Layering, from the dial outward, is the whole reason the numbers in
 * `meridianParts` are what they are:
 *
 *   z 0.0530   dial surface (GLB)
 *   z 0.0540   recess floor
 *   z 0.0545…0.0587  eleven blades, each on its own plane
 *   z 0.0538…0.0598  retaining ring, over the blades' outer halves
 *   z 0.0610   secondary needle — the hard ceiling
 *
 * The needles pass over the aperture and are never occluded by it. That is the
 * ordering the brief asks for and it falls out of geometry rather than out of
 * render order, so it cannot be broken by a sorting change.
 */
/**
 * Place the eleven blades for a given blade angle.
 *
 * Each blade sits on the pitch circle at its own angle and its own plane, and
 * is turned about its pivot by φ. That single rotation is the entire mechanism:
 * the hole radius follows from it exactly, as
 * `sqrt(Rp² + e² − 2·Rp·e·cos φ) − Rb`, with nothing else to keep in step.
 */
function writeBlades(mesh: THREE.InstancedMesh, dummy: THREE.Object3D, phi: number) {
  for (let i = 0; i < IRIS.blades; i++) {
    const theta = (i / IRIS.blades) * Math.PI * 2;
    dummy.position.set(
      Math.cos(theta) * IRIS.pivot,
      Math.sin(theta) * IRIS.pivot,
      IRIS.bladeZ + i * IRIS.bladeStep,
    );
    // The blade's own frame has +x along its pivot ray.
    dummy.rotation.set(0, 0, theta + phi);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
}

export function ApertureCore({ parts, simplified }: { parts: MeridianParts; simplified: boolean }) {
  const blades = useRef<THREE.InstancedMesh>(null);
  const light = useRef<THREE.PointLight>(null);
  const marker = useRef<THREE.Mesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const smoothed = useRef({ open: 0.055 });

  // Its own copy: the rings animate the same base material's opacity for their
  // own lock marks, and four writers on one instance is three flickers.
  const signal = useMemo(() => parts.own('signal'), [parts]);

  // Instance matrices are written every frame; telling three so avoids it
  // re-uploading the whole buffer through the static path. Keyed on `parts`
  // because a change there makes R3F rebuild the mesh, and a hint set on the
  // object that was thrown away is not a hint.
  useLayoutEffect(() => {
    if (!blades.current) return;
    blades.current.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Seed the matrices before the first paint. `useFrame` fills them in every
    // frame after this one, but the frameloop can be parked at mount — the
    // canvas may not be on screen yet — and an unseeded instance matrix is the
    // identity, which puts eleven full-size blades in a heap at the origin.
    writeBlades(blades.current, dummy, 0.055 * IRIS.sweep);
  }, [dummy, parts]);

  useFrame((_, delta) => {
    if (!journey.running) return;
    const dt = Math.min(delta, 1 / 20);

    // The blades damp toward the derived opening rather than tracking it
    // exactly. A trackpad flick delivers scroll in discrete jumps and an
    // undamped iris reproduces every one of them as a twitch — which is the one
    // thing a mechanism must never do. The smoothing is light enough that the
    // snap still lands on the altitude it is supposed to.
    const s = smoothed.current;
    s.open = settle(s.open, meridian.apertureOpen, 0.72, dt);
    const phi = s.open * IRIS.sweep;
    if (blades.current) writeBlades(blades.current, dummy, phi);

    // --- the light through the centre ---------------------------------------
    // Not a glow and not a portal: a short-range light that only reaches the
    // blade edges, the hub and the underside of the needles. `distance` is what
    // keeps it local — at 0.42 units it cannot touch the bezel, let alone the
    // sky.
    //
    // Both numbers are low, and they were both cut roughly in half after the
    // first pass rendered the open centre as a white blob — which is the
    // "glowing reactor" the brief rules out, and worse, it destroyed the
    // legibility of the blades it was supposed to reveal. The point is that the
    // blade edges and the needle underside become *readable*, not that the
    // middle of the instrument becomes a light source.
    const breakthrough = meridian.lightBreakthrough * journey.debug.lightGain;
    parts.materials.well.emissiveIntensity = breakthrough * 0.2;
    if (light.current) light.current.intensity = breakthrough * (simplified ? 0.16 : 0.24);

    // --- the calibration mark -----------------------------------------------
    // Yellow, and only here: it confirms that the aperture has been set to an
    // exact value rather than left wide open. It appears with the stop-down at
    // 24 000 m, which is the point the mark is about.
    const calibrated = meridian.finalCalibration;
    if (marker.current) {
      signal.opacity = calibrated * 0.9;
      signal.emissiveIntensity = calibrated * 1.6;
      marker.current.visible = calibrated > 0.01;
      // Sits at the blade angle the instrument settled on, so the mark is
      // pointing at the setting rather than decorating the ring.
      marker.current.rotation.z = FINAL_CALIBRATED_OPEN * IRIS.sweep;
    }
  });

  return (
    <group>
      {/* The recess floor. Dark, and the only surface in the instrument that
          takes emissive from the breakthrough. */}
      <mesh geometry={parts.wellGeometry} material={parts.materials.well} position={[0, 0, IRIS.wellZ]} />

      <instancedMesh
        ref={blades}
        args={[parts.bladeGeometry, parts.materials.blade, IRIS.blades]}
        frustumCulled={false}
      />

      {/* Over the blades' outer halves, so they retract *under* something the
          way real ones do rather than simply getting shorter. */}
      <mesh
        geometry={parts.retainerGeometry}
        material={parts.materials.retainer}
        position={[0, 0, (IRIS.wellZ + IRIS.retainerTopZ) / 2]}
      />

      <mesh
        ref={marker}
        geometry={parts.signalArc(RETAINER_PROFILE)}
        material={signal}
        position={[0, 0, IRIS.retainerTopZ + 0.0004]}
        visible={false}
      />

      {/* `distance` is what keeps this local. At 0.3 units it reaches the blade
          edges, the hub and the underside of the needles and nothing else —
          not the bezel, and certainly not the sky. */}
      <pointLight ref={light} position={[0, 0, 0.07]} color="#cfe0f5" intensity={0} distance={0.3} decay={2} />
    </group>
  );
}

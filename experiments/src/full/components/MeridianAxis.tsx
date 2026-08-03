import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { journey, lerp } from '../journey';
import { meridian } from '../meridian';
import type { MeridianParts } from './meridianParts';

/**
 * The fixed central axis.
 *
 * The one part of the instrument that never moves. Everything else in the
 * Meridian lifts, tilts, turns, opens or separates; the shaft the whole thing
 * is built around does not, and that is the point of having it. It is what
 * makes three rings turning at three rates read as a governed system rather
 * than as three things drifting.
 *
 * Physically it is the needles' pivot shaft, which is where a real instrument's
 * axis actually is: it runs back from just under the crystal, through the
 * needle hub, and out through the rear of the case into the mechanism. It gets
 * longer as the instrument opens up, extending *rearward only* — the front end
 * stops at z = 0.098, a thousandth short of the crystal's inner face, because
 * an axis that pierced the glass would be the first moment in the sequence
 * where a part went somewhere its own housing does not allow.
 *
 * The rear collar stays where the shaft leaves the case while the end collar
 * travels with the shaft, so the extension reads as sliding through a bearing
 * rather than as a rod getting longer.
 */
const FRONT_Z = 0.098;
const REAR_SEATED = -0.13;
/** Far enough back to clear the rear flange and read from a three-quarter view. */
const REAR_EXTENDED = -0.66;
/** Where the shaft passes through the back of the housing barrel. */
const BEARING_Z = -0.118;

export function MeridianAxis({ parts }: { parts: MeridianParts }) {
  const shaft = useRef<THREE.Mesh>(null);
  const endCollar = useRef<THREE.Mesh>(null);

  useFrame(() => {
    if (!journey.running) return;

    const rear = lerp(REAR_SEATED, REAR_EXTENDED, meridian.axisExtension);
    const length = FRONT_Z - rear;

    if (shaft.current) {
      // Authored as a unit cylinder along Z, so the scale *is* the length and
      // the position is the midpoint. No geometry is rebuilt.
      shaft.current.scale.z = length;
      shaft.current.position.z = rear + length / 2;
    }
    if (endCollar.current) endCollar.current.position.z = rear + 0.008;
  });

  return (
    <group>
      <mesh ref={shaft} geometry={parts.axisGeometry} material={parts.materials.axis} />
      {/* The bearing the shaft runs through: fixed to the case. */}
      <mesh geometry={parts.collarGeometry} material={parts.materials.retainer} position={[0, 0, BEARING_Z]} />
      {/* The end stop: travels with the shaft. */}
      <mesh ref={endCollar} geometry={parts.collarGeometry} material={parts.materials.axis} />
    </group>
  );
}

import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { clamp, settle, journey, lerp } from '../journey';
import { meridian, type RingLockConfig } from '../meridian';
import type { MeridianParts, RingProfile } from './meridianParts';

/**
 * One spatial ring, and the only ring implementation there is.
 *
 * All three rings are this component with different numbers. That is the point:
 * the lock is the instrument's signature gesture, and three bespoke animations
 * that each looked good on their own would read as three unrelated effects. The
 * differences the brief asks for — scale, mass, distance, speed, final axis —
 * are all parameters; the rhythm is not.
 *
 * ## The transform stack, outside in
 *
 * ```
 * outer      lift along the instrument's +Z, then the final tilt
 *   spinner  rotation about the ring's own axis, once locked
 *     centre slides the ring's material from where it sat in the face to the
 *            instrument's centre, so a tilted ring turns about the real axis
 *            rather than about a plane 0.055 units in front of it
 *       parts    the GLB nodes this ring is made of, at their original z
 *       section  the machined band and its engraving, unfolding out of the face
 * ```
 *
 * The order matters and it is not arbitrary. `outer.position` is applied after
 * `outer.rotation` in the local matrix, so the lift is along the *instrument's*
 * axis whatever the ring's own tilt is — the ring rises straight out of the
 * dial and then tilts, which is the mechanically legible order. Putting the
 * spin on `outer` instead of on its own child would make the tilt and the spin
 * fight over the same three Euler angles.
 *
 * ## What the band is doing at 0 m
 *
 * Nothing that would be visible as a band. Its section is compressed along the
 * axis to a sixth of its thickness and it sits exactly on the ring's parts, so
 * it reads as a machined line in the dial face — which is what an integrated
 * scale ring looks like. It thickens as the ring unseats. No opacity is
 * involved anywhere in the reveal, and nothing scales in from zero.
 */
export function MeridianRing({
  config,
  profile,
  parts,
  group,
  simplified,
}: {
  config: RingLockConfig;
  profile: RingProfile;
  parts: MeridianParts;
  /** The GLB nodes this ring is assembled from, already re-parented. */
  group: THREE.Group;
  simplified: boolean;
}) {
  const outer = useRef<THREE.Group>(null);
  const spinner = useRef<THREE.Group>(null);
  const centre = useRef<THREE.Group>(null);
  const section = useRef<THREE.Group>(null);
  const marks = useRef<THREE.InstancedMesh>(null);
  const seatMarks = useRef<THREE.InstancedMesh>(null);
  const seat = useRef<THREE.Mesh>(null);
  const lockMark = useRef<THREE.Mesh>(null);

  const dummy = useMemo(() => new THREE.Object3D(), []);
  const seamMaterial = useMemo(() => parts.own('seam'), [parts]);
  const signalMaterial = useMemo(() => parts.own('signal'), [parts]);

  const tickCount = Math.max(6, Math.round(profile.ticks * (simplified ? 0.5 : 1)));

  /**
   * Engraved index marks around the band.
   *
   * Written once, not per frame: they never move relative to the band — the
   * band moves and they go with it — and rewriting sixty matrices sixty times a
   * second for something rigid is the kind of cost that is invisible in a
   * profile until five other things are doing it too.
   *
   * `parts` is in the dependency list and this is a *layout* effect, and both
   * of those are load-bearing. Changing `parts` changes the `args` of the
   * `instancedMesh` below, which makes R3F throw the old object away and build
   * a new one — with an identity instance matrix. Without `parts` here the
   * write never re-runs against the new mesh, and sixty unit cubes appear at
   * the origin, each of them two instrument-widths across. Doing it in a layout
   * effect means that is never true for even one painted frame.
   */
  useLayoutEffect(() => {
    const mesh = marks.current;
    if (!mesh) return;
    const r = profile.radius + profile.halfWidth;
    for (let i = 0; i < tickCount; i++) {
      const theta = (i / tickCount) * Math.PI * 2;
      // Every fifth mark is a major one, the way a real scale is divided.
      const major = i % 5 === 0;
      dummy.position.set(Math.cos(theta) * (r - 0.0015), Math.sin(theta) * (r - 0.0015), 0);
      dummy.rotation.set(0, 0, theta);
      dummy.scale.set(0.005, major ? 0.0028 : 0.0016, profile.halfThickness * (major ? 1.25 : 0.75));
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }, [dummy, parts, profile, tickCount]);

  /**
   * The index marks left behind in the dial.
   *
   * Ring 1 takes the major ticks with it when it lifts, and the face must still
   * carry a readable scale afterwards — so the seat it lifts out of is engraved
   * with its own register. This is the honest version of "the ring came from
   * here": the mounting is still there, with the marks that located it.
   */
  useLayoutEffect(() => {
    const mesh = seatMarks.current;
    if (!mesh || profile.seatTicks === 0) return;
    for (let i = 0; i < profile.seatTicks; i++) {
      const theta = (i / profile.seatTicks) * Math.PI * 2;
      dummy.position.set(Math.cos(theta) * profile.radius, Math.sin(theta) * profile.radius, 0);
      dummy.rotation.set(0, 0, theta);
      dummy.scale.set(profile.halfWidth * 1.5, 0.0035, 0.0012);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }, [dummy, parts, profile]);

  // Rotation is the one quantity that is not a pure function of altitude, and
  // it is deliberately self-correcting: it accumulates only while the ring is
  // locked and damps back to its seated angle when it is not, so scrolling back
  // through a lock returns the ring to the orientation it was made in rather
  // than leaving it re-seated at a random angle.
  const spin = useRef(0);
  const lastAltitude = useRef(meridian.altitude);

  useFrame((_, delta) => {
    if (!journey.running) return;
    const dt = Math.min(delta, 1 / 20);
    const index = config.id === 'ring1' ? 0 : config.id === 'ring2' ? 1 : 2;
    const state = meridian.rings[index];

    const dAltitude = meridian.altitude - lastAltitude.current;
    lastAltitude.current = meridian.altitude;

    // --- lift, tilt, settle --------------------------------------------------
    if (outer.current) {
      // The lift is a *transient*. The ring rises out of its seat, holds, then
      // travels to its locked station — which is close to the instrument's own
      // plane, not out in front of it. Reading the lift as a permanent offset
      // was the first version's mistake: three rings parked at three different
      // distances in front of the dial looked like a stack of coasters.
      outer.current.position.z =
        config.liftDistance * state.lift * (1 - 0.88 * state.settle) + config.finalZ * state.settle;

      outer.current.rotation.set(
        config.targetTiltX * state.settle,
        config.targetTiltY * state.settle,
        config.targetTiltZ * state.settle,
      );

      const s = lerp(1, config.finalScale, state.settle);
      outer.current.scale.setScalar(s);
    }

    // --- governed rotation ---------------------------------------------------
    if (spinner.current) {
      if (state.settle > 0.995) {
        // Two components. The altitude-coupled one makes the instrument feel
        // driven by the visitor; the idle one keeps it alive when they stop
        // reading. Both are slow enough to inspect the engraving against — the
        // fastest ring takes about two minutes for a revolution.
        const damping = 1 - meridian.finalCalibration * 0.45; // calmer at the top
        // `ringRotation` gates *both* terms, not only the idle one.
        //
        // It used to gate the idle rate alone, which made it a slider for how
        // fast the instrument turns and not the freeze it is used as. `spin` is
        // an accumulator: the altitude-coupled term integrates `dAltitude`
        // against a `damping` factor that is itself a function of altitude, so
        // the total depends on how many frames the journey took to get here,
        // not only on where it ended up. Two capture runs that reach 7 000 m
        // over different frame counts leave the rings at different angles, and
        // every still of a locked ring differs between them.
        //
        // Gating the whole governed term means `ringRotation = 0` holds the
        // rings at the orientation they were made in, which is what the capture
        // scripts have always been asking for. Production writes 1 and the
        // expression is what it was.
        spin.current +=
          (dAltitude * config.rotationGain + dt * config.idleRate) * damping * journey.debug.ringRotation;
      } else {
        spin.current = settle(spin.current, 0, 0.86, dt);
      }
      spinner.current.rotation.z = spin.current;
    }

    // --- recentre ------------------------------------------------------------
    if (centre.current) centre.current.position.z = -profile.seatZ * state.settle;

    // --- the section unfolding out of the face -------------------------------
    if (section.current) section.current.scale.z = lerp(0.16, 1, state.section);

    // --- the seam and the seat ----------------------------------------------
    // Visible from the moment the separation line appears, and it stays: the
    // seat is where the ring came from, and a mounting that vanishes once the
    // part has left it is the one thing that would make the ring look like it
    // had been added rather than released.
    seamMaterial.opacity = clamp(Math.max(state.seam * 0.5, state.lift * 0.85));
    if (seat.current) seat.current.visible = seamMaterial.opacity > 0.01;
    if (seatMarks.current) seatMarks.current.visible = state.lift > 0.05;

    // --- the lock confirmation ----------------------------------------------
    // Ring 3's mark stays on — it is the certification line at the seam of the
    // last joint to close, and the instrument is finished once it is lit. The
    // first two flash and go out: they confirmed their locks and there is no
    // reason for the object to keep three yellow marks burning.
    const persistent = config.id === 'ring3' ? state.settle : 0;
    const glow = clamp(Math.max(state.lockPulse, persistent * 0.85));
    signalMaterial.opacity = glow * 0.95;
    signalMaterial.emissiveIntensity = glow * 2.2;
    if (lockMark.current) lockMark.current.visible = glow > 0.01;
  });

  return (
    <>
      <group ref={outer}>
        <group ref={spinner}>
          <group ref={centre}>
            {/* The parts this ring is made of, exactly as the model authored
                them. Nothing is re-positioned; the group around them moves. */}
            <primitive object={group} />

            <group ref={section} position={[0, 0, profile.seatZ]}>
              <mesh geometry={parts.band(profile)} material={parts.materials.band} />
              <instancedMesh
                ref={marks}
                args={[parts.markGeometry, parts.materials.engrave, tickCount]}
                frustumCulled={false}
              />
              <mesh
                ref={lockMark}
                geometry={parts.signalArc(profile)}
                material={signalMaterial}
                position={[0, 0, profile.halfThickness + 0.0006]}
                visible={false}
              />
            </group>
          </group>
        </group>
      </group>

      {/* The seat is a sibling of the whole moving assembly, not a child of it.
          It is part of the housing: the mounting the ring was located in, and it
          stays exactly where it was after the ring has gone. Parenting it under
          `outer` — which is where it started, and which looked right until the
          first lock — takes the mounting along for the ride and destroys the one
          piece of evidence that says where the ring came from. */}
      <group position={[0, 0, profile.seatZ]}>
        <mesh ref={seat} geometry={parts.seat(profile)} material={seamMaterial} visible={false} />
        {profile.seatTicks > 0 && (
          <instancedMesh
            ref={seatMarks}
            args={[parts.markGeometry, parts.materials.engrave, profile.seatTicks]}
            frustumCulled={false}
            visible={false}
          />
        )}
      </group>
    </>
  );
}

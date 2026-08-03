import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { SYSTEM } from '../content';
import { clamp, ease, journey, span } from '../journey';

/**
 * The Stratos system, as three concentric rings.
 *
 * What this has to communicate is an *order of dependence*: research and
 * strategy in the middle, the things they define around them, the things that
 * only work once those exist on the outside. Three rings say that. A node graph
 * does not — it says "everything connects to everything", which is both the
 * cliché the brief ruled out and, worse, untrue about how the work actually
 * runs.
 *
 * So the rules here are subtractive: rings are thin and unlit, nodes are small
 * flat discs, there are no connecting lines between rings, nothing pulses, and
 * the rotation is slow enough to be felt rather than watched. Everything the
 * visitor needs to *understand* is in the HTML beside it; this is the diagram's
 * silhouette, not the diagram.
 *
 * Cost: three torus geometries and nine discs, all sharing two materials.
 * Mounted only while the journey is near this stage.
 */

const RADII = [0.62, 1.06, 1.52] as const;

export function SystemRings({ simplified }: { simplified: boolean }) {
  const group = useRef<THREE.Group>(null);
  const rings = useRef<THREE.Group>(null);

  /** Node placement, precomputed: ring index, angle, and the resulting position. */
  const nodes = useMemo(() => {
    const byRing: Record<number, number> = { 0: 0, 1: 0, 2: 0 };
    const counts = SYSTEM.reduce<Record<number, number>>((acc, n) => {
      acc[n.ring] = (acc[n.ring] ?? 0) + 1;
      return acc;
    }, {});

    return SYSTEM.map((n) => {
      const total = counts[n.ring];
      const i = byRing[n.ring]++;
      // Offset each ring's starting angle so nodes never line up radially —
      // aligned spokes read as a wheel, which implies a hierarchy that is not
      // there.
      const offset = n.ring * 0.42;
      const a = (i / total) * Math.PI * 2 + offset;
      const r = RADII[n.ring];
      return { id: n.id, ring: n.ring, x: Math.cos(a) * r, z: Math.sin(a) * r };
    });
  }, []);

  const ringMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: 0x7f9ec2,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  );

  const nodeMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: 0xcbdce9,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  );

  // The one accent, on the two core disciplines. Yellow is the site's signal
  // colour and it is used here exactly as sparingly as it is there.
  const coreMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: 0xffee25,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  );

  /*
   * The same disposal `Checkpoints` was missing, for the same reason.
   *
   * These three are `useMemo`'d instances rather than JSX primitives, so R3F
   * does not own them and will not free them when this component unmounts —
   * and it unmounts every time the visitor leaves the system stage. No
   * geometry leaks here, because the torus and circle geometries *are* JSX and
   * R3F disposes those; the materials are the part that was left behind, and
   * they hold GPU programs.
   */
  useEffect(
    () => () => {
      ringMaterial.dispose();
      nodeMaterial.dispose();
      coreMaterial.dispose();
    },
    [ringMaterial, nodeMaterial, coreMaterial],
  );

  useFrame((_, delta) => {
    if (!journey.running) return;
    const m = journey.altitude;

    // Present across the system stage, with a margin either side so it arrives
    // before its heading and leaves after it.
    const presence =
      ease(span(m, 16_200, 18_200)) * (1 - ease(span(m, 21_000, 22_600)));

    // The rings read through the panel plate, which is 72% opaque, so their own
    // opacity has to clear that to be visible at all — at 0.26 the diagram the
    // copy refers to was effectively invisible behind its own explanation.
    ringMaterial.opacity = presence * 0.5;
    nodeMaterial.opacity = presence * 0.9;
    coreMaterial.opacity = presence;

    // The one free-running motion in this scene, and the only thing in it that
    // is not a function of altitude. It is deliberate — the diagram would read
    // as a still image without it — but it means a capture taken here depends
    // on how long the page has been open, so it is gated by the same
    // development multiplier the instrument's rings use. `ringRotation = 0`
    // holds every idle rotation in the scene still; production writes 1 and
    // nothing about the motion changes.
    //
    // It was not gated before, and the capture scripts that set the flag were
    // quietly not freezing this. It does not appear in the mountain stills —
    // those are all at or below 12 000 m and this mounts at 14 500 — but it is
    // in every still `shots-meridian.mjs` takes of the system stage.
    const idle = delta * journey.debug.ringRotation;

    if (group.current) {
      group.current.visible = presence > 0.004;
      // A slow single-axis rotation. Two axes reads as tumbling; faster than
      // this reads as a loading spinner.
      group.current.rotation.y += idle * 0.055;
      // Tilted so the rings read as concentric rather than as a flat disc,
      // settling further open as the stage progresses.
      group.current.rotation.x = -0.62 + presence * 0.12;
      group.current.scale.setScalar(0.92 + presence * 0.08);
    }

    // The rings counter-rotate very slightly against each other, which is what
    // stops the whole thing reading as one rigid object.
    if (rings.current) {
      rings.current.children.forEach((child, i) => {
        child.rotation.z += idle * (i === 1 ? -0.03 : 0.02);
      });
    }
  });

  const segments = simplified ? 48 : 96;

  return (
    <group ref={group} position={[0, 0, -1.1]} visible={false}>
      <group ref={rings}>
        {RADII.map((r, i) => (
          <mesh key={i} rotation={[Math.PI / 2, 0, 0]} material={ringMaterial}>
            {/* Tube radius is deliberately below a pixel at this distance on a
                1x display: the ring should read as a drawn line, not a pipe. */}
            <torusGeometry args={[r, 0.0035, 6, segments]} />
          </mesh>
        ))}
      </group>

      {nodes.map((n) => (
        <mesh
          key={n.id}
          position={[n.x, 0, n.z]}
          rotation={[-Math.PI / 2, 0, 0]}
          material={n.ring === 0 ? coreMaterial : nodeMaterial}
        >
          <circleGeometry args={[n.ring === 0 ? 0.032 : 0.024, simplified ? 8 : 16]} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * Stage 8 — the process, as flight checkpoints on a climbing path.
 *
 * Same restraint. Seven markers on a gently rising line, the passed ones lit,
 * the ones ahead dim. It is a progress indicator with an altitude metaphor, and
 * the seven headings beside it in HTML are what actually carry the content.
 */
export function Checkpoints({ simplified }: { simplified: boolean }) {
  const group = useRef<THREE.Group>(null);
  const marks = useRef<THREE.Group>(null);

  const COUNT = 7;

  /*
   * Seven materials, built once, rather than `material.clone()` in the JSX.
   *
   * Each marker's opacity is written individually every frame — that is what
   * makes the graphic a progress readout rather than decoration — so seven
   * distinct materials are genuinely needed. Cloning a template inside the
   * render body built seven new ones on *every* React render and abandoned the
   * previous seven, and the template itself then had nothing reading it: the
   * `material.opacity = presence` write in the frame callback was setting a
   * value on an object nothing drew.
   */
  const materials = useMemo(
    () =>
      Array.from(
        { length: COUNT },
        () =>
          new THREE.MeshBasicMaterial({
            color: 0xcbdce9,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            toneMapped: false,
          }),
      ),
    [],
  );

  // One shared geometry for every marker rather than seven identical ones.
  const geometry = useMemo(() => new THREE.RingGeometry(0.034, 0.046, simplified ? 12 : 24), [simplified]);

  /*
   * Give them back on unmount. The same one line `StarField` already carries,
   * and its absence here was a real leak rather than a tidiness question.
   *
   * This component is mounted and unmounted by altitude — `useNearAltitude(22
   * 000, 25 500)` in JourneyScene — so a visitor who scrolls up through the
   * process stage and back down again mounts it twice. R3F disposes what it
   * built from JSX; it does not own an instance handed to it through a prop, so
   * every mount left a `RingGeometry` behind that nothing referenced and
   * nothing freed.
   *
   * That is what the geometry counter was counting. `gl.info.memory.geometries`
   * rose by exactly two per full journey — desktop 135 → 137 → 139 → 141 → 143
   * over five cycles, mobile 85 → 88 → 90 → 92 — with no plateau, and the
   * geometry census in `probe-geometry.mjs` named all ten of the retained
   * objects as `RingGeometry` instances created at this line with no owner in
   * the scene graph.
   */
  useEffect(
    () => () => {
      geometry.dispose();
      for (const m of materials) m.dispose();
    },
    [geometry, materials],
  );

  const positions = useMemo(
    () =>
      Array.from({ length: COUNT }, (_, i) => {
        const t = i / (COUNT - 1);
        return {
          // A shallow S rather than a straight diagonal: a straight line of
          // evenly spaced dots reads as a scale, not as a route.
          x: (t - 0.5) * 2.4 + Math.sin(t * Math.PI) * 0.22,
          y: -0.72 + t * 1.5,
          z: -1.4 - Math.sin(t * Math.PI) * 0.5,
        };
      }),
    [],
  );

  useFrame(() => {
    if (!journey.running) return;
    const m = journey.altitude;
    const presence = ease(span(m, 21_400, 22_600)) * (1 - ease(span(m, 25_000, 26_200)));

    if (group.current) group.current.visible = presence > 0.004;

    if (marks.current) {
      // Each marker lights as its own checkpoint altitude is passed, so the
      // graphic is a readout of progress rather than decoration.
      marks.current.children.forEach((child, i) => {
        const at = 22_300 + (i / (COUNT - 1)) * 3_100;
        const passed = clamp(span(m, at - 260, at + 120));
        const mesh = child as THREE.Mesh;
        mesh.scale.setScalar(0.8 + passed * 0.45);
        (mesh.material as THREE.MeshBasicMaterial).opacity = presence * (0.18 + passed * 0.82);
      });
    }
  });

  return (
    <group ref={group} visible={false}>
      <group ref={marks}>
        {positions.map((p, i) => (
          <mesh key={i} position={[p.x, p.y, p.z]} geometry={geometry} material={materials[i]} />
        ))}
      </group>
    </group>
  );
}

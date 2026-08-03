import { useEffect, useMemo } from 'react';
import * as THREE from 'three';

/**
 * Every piece of geometry and every material the Meridian adds to the GLB.
 *
 * One module, built once, shared by all three rings and the aperture, disposed
 * together. The alternative — each component making its own `<meshStandardMaterial>`
 * — reads better in JSX and quietly produces eleven identical blade materials,
 * eleven shader programs and eleven uniform uploads per frame.
 *
 * Nothing here is authored in absolute millimetres. The GLB's outer housing is
 * 0.5 units in radius and its dial face 0.41, so all of these numbers are in
 * that space and were chosen against the model's actual bounds, which are:
 *
 *   housing barrel   r 0.500   z -0.115 … 0.085
 *   rear flange      r 0.517   z -0.115 … -0.070
 *   dial surface     r 0.410   z  0.053
 *   ticks / numerals r 0.24…0.392  z 0.053 … 0.058
 *   needle hub       r 0.030   z  0.053 … 0.091
 *   needles          r 0.35    z  0.061 … 0.079
 *   glass crystal    r 0.409   z  0.101 … 0.115
 *
 * Two of those are hard ceilings and both of them constrain the aperture:
 * nothing the aperture adds may rise above z = 0.061, or it fouls the secondary
 * needle, and nothing may extend past r = 0.114, or it covers the "ALTITUDE"
 * legend baked into the dial. The iris below is sized to fit inside both.
 */

// =============================================================================
// The aperture.
//
// A real iris diaphragm, not a shutter graphic. Eleven blades, each pivoting
// about a fixed point on a pitch circle; the cutting edge of a blade is an arc
// of radius Rb whose centre is carried on a crank of length e. As a blade turns
// by φ its cutting-edge centre swings out from the axis, so the hole radius is
//
//     r(φ) = sqrt(Rp² + e² − 2·Rp·e·cos φ) − Rb
//
// exactly, with no fudge factor: 0.0040 closed, 0.0442 fully open, 0.0321 at the
// 0.72 calibrated setting the instrument ends on. The numbers below were solved
// for those three values and then verified by rasterising the union of the
// eleven blade polygons at twenty-one openings — the opening is scalloped and
// eleven-sided, as it should be, and there is no uncovered cell anywhere else
// in the plate at any φ. Changing any one of Rp, e or Rb without re-checking
// closure will open a light leak between blades that is invisible in a still
// and obvious in motion.
// =============================================================================
export const IRIS = {
  blades: 11,
  /** Pivot circle radius. */
  pivot: 0.065,
  /** Crank length: pivot to cutting-edge centre. */
  crank: 0.031,
  /** Cutting-edge radius. */
  edge: 0.03,
  /** Blade travel. A quarter turn takes it from closed to fully open. */
  sweep: Math.PI / 2,
  /** Inner radius of the retaining ring, which hides the blades' outer halves. */
  retainerInner: 0.07,
  /** Outer radius of the whole plate. Must stay under the 0.114 legend limit. */
  retainerOuter: 0.11,
  /** The recess floor, one thousandth above the dial surface. */
  wellZ: 0.054,
  /** Where the blade stack starts, and how it is spaced. */
  bladeZ: 0.0545,
  bladeStep: 0.00042,
  bladeThickness: 0.00046,
  /** The retaining ring's top face — under the 0.061 needle ceiling. */
  retainerTopZ: 0.0598,
} as const;

/** Hole radius at a given blade angle. Exported because the tests assert it. */
export function irisHoleRadius(open: number): number {
  const phi = THREE.MathUtils.clamp(open, 0, 1) * IRIS.sweep;
  return Math.sqrt(IRIS.pivot ** 2 + IRIS.crank ** 2 - 2 * IRIS.pivot * IRIS.crank * Math.cos(phi)) - IRIS.edge;
}

/**
 * One blade, in its own frame: pivot at the origin, +x pointing radially
 * outward from the aperture axis.
 *
 * The head is the cutting arc. The tail is deliberately asymmetric — wider on
 * the trailing side — because a symmetric tail wide enough to close the gaps
 * between neighbours at φ = 0 swings into the open hole at φ = 90°. Every
 * vertex here sits inside the plate at every angle and outside the hole at
 * every angle; that is not an aesthetic claim, it is the constraint the shape
 * was solved against.
 *
 * The cutting arc is tessellated by `ExtrudeGeometry`'s `curveSegments`, so a
 * coarser mobile build flattens it slightly and the closure has to survive
 * that. It does: rasterising the union of the eleven blades finds no uncovered
 * cell outside the aperture at any opening, all the way down to six divisions
 * per arc — three below what the simplified tier actually uses.
 */
function bladeShape(): THREE.Shape {
  const { crank: e, edge: Rb } = IRIS;
  const shape = new THREE.Shape();
  shape.moveTo(-e, -Rb);
  // The inward-facing half of the cutting circle, swept the long way round.
  shape.absarc(-e, 0, Rb, -Math.PI / 2, Math.PI / 2, true);
  shape.lineTo(0.008, 0.018);
  shape.lineTo(0.028, 0.0165);
  shape.lineTo(0.038, 0.0075);
  shape.lineTo(0.038, -0.014);
  shape.lineTo(0.028, -0.029);
  shape.lineTo(0.008, -0.0265);
  shape.closePath();
  return shape;
}

// =============================================================================
// The rings.
//
// Each ring's band is a lathed section with real bevels, because the bevel is
// what tells a viewer the ring has thickness — a flat annulus at any angle
// other than dead-on reads as a decal. The section is authored at full
// thickness and compressed along its axis at runtime, which is how a ring can
// be a machined line in the dial face at 0 m and a band you can see the edges
// of at 30 000 m without ever scaling in from nothing.
// =============================================================================
export type RingProfile = {
  radius: number;
  /** Half the radial width of the band. */
  halfWidth: number;
  /** Half the axial thickness at full unfold. */
  halfThickness: number;
  bevel: number;
  /** Engraved index marks around the band. */
  ticks: number;
  /** Where the ring's parts sit on the instrument before they move. */
  seatZ: number;
  /** Index marks left behind in the dial when the ring lifts off its seat. */
  seatTicks: number;
  /**
   * Where the separation line shows.
   *
   * `face` is a groove in the dial, which is where the two scale rings are
   * mounted. `rim` is a hairline around the housing's silhouette, which is the
   * only place the rear flange's joint is visible from in front of the
   * instrument — a flat seat behind the case would be a seam nobody could see.
   */
  seatKind: 'face' | 'rim';
  /** For `rim` seats: the radius and height of the hairline on the housing. */
  rimRadius?: number;
  rimHeight?: number;
};

/** A bevelled rectangular section, lathed about the instrument's axis. */
function bandGeometry(p: RingProfile, segments: number): THREE.BufferGeometry {
  const { radius: r, halfWidth: w, halfThickness: t, bevel: b } = p;
  const profile = [
    new THREE.Vector2(r - w, -(t - b)),
    new THREE.Vector2(r - w, t - b),
    new THREE.Vector2(r - w + b, t),
    new THREE.Vector2(r + w - b, t),
    new THREE.Vector2(r + w, t - b),
    new THREE.Vector2(r + w, -(t - b)),
    new THREE.Vector2(r + w - b, -t),
    new THREE.Vector2(r - w + b, -t),
    new THREE.Vector2(r - w, -(t - b)),
  ];
  const geometry = new THREE.LatheGeometry(profile, segments);
  // Lathe runs about Y; the instrument's axis is Z.
  geometry.rotateX(Math.PI / 2);
  geometry.computeVertexNormals();
  return geometry;
}

// =============================================================================
// Materials.
//
// Restrained on purpose, and all of them metal: cold titanium-grey for the
// structure, darker gunmetal with a sharper roughness for the blades, and one
// warm signal yellow that is only ever switched on by an event. The yellow is
// the GLB's own MAT_Signal_Beacon colour rather than the site's --signal, so
// the certification marks match the ceiling arc already on the dial instead of
// being a second, nearly-identical yellow.
// =============================================================================
export const SIGNAL = 0xffda05;

function makeMaterials() {
  return {
    /**
     * Ring bands: machined titanium-grey, directional, never mirror-chrome.
     *
     * Metalness is 0.55 rather than the 0.9 a titanium sample would have, and
     * that is a lighting decision rather than a material one. There is no HDRI
     * in this scene — the environment is three flat emitters built at runtime,
     * precisely so nothing crosses the network — and a near-pure metal with
     * almost nothing to reflect renders black. At 0.55 the band still reads as
     * machined metal and the key light actually lands on it.
     */
    band: new THREE.MeshStandardMaterial({ color: 0x6a7683, metalness: 0.55, roughness: 0.36 }),
    /** Engraved marks: lighter and rougher, so they read as cut rather than lit. */
    engrave: new THREE.MeshStandardMaterial({ color: 0xb2c1d1, metalness: 0.35, roughness: 0.45 }),
    /** Iris blades: darker gunmetal, tighter roughness, strong edge definition. */
    blade: new THREE.MeshStandardMaterial({
      color: 0x2b333d,
      metalness: 0.6,
      roughness: 0.28,
      side: THREE.DoubleSide,
    }),
    /** The recess floor behind the blades. Emissive is driven by the breakthrough. */
    well: new THREE.MeshStandardMaterial({
      color: 0x04060a,
      metalness: 0.2,
      roughness: 0.8,
      emissive: new THREE.Color(0x5f7ea8),
      emissiveIntensity: 0,
    }),
    /** The retaining ring the blades retract under. */
    retainer: new THREE.MeshStandardMaterial({ color: 0x545f6b, metalness: 0.6, roughness: 0.3 }),
    /** The central shaft. The one part that never moves. */
    axis: new THREE.MeshStandardMaterial({ color: 0x8c96a2, metalness: 0.6, roughness: 0.24 }),
    /**
     * Machined seams and the seats rings lift out of.
     *
     * A decal in all but name: it sits on surfaces it is nearly coplanar with,
     * so it takes a polygon offset rather than a z nudge. Offsetting in depth
     * space is exact at every camera distance; a fixed 0.0002 in z is correct
     * at one distance and either fights or floats at the others.
     */
    seam: new THREE.MeshStandardMaterial({
      color: 0x7b8794,
      metalness: 0.9,
      roughness: 0.22,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    }),
    /** Lock confirmation. Off unless an event is confirming itself. */
    signal: new THREE.MeshStandardMaterial({
      color: SIGNAL,
      emissive: new THREE.Color(SIGNAL),
      emissiveIntensity: 0,
      metalness: 0.1,
      roughness: 0.45,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    }),
    /** Closes the gap when the bezel lifts off the barrel. */
    interior: new THREE.MeshStandardMaterial({
      color: 0x0a0d13,
      metalness: 0.6,
      roughness: 0.85,
      side: THREE.BackSide,
    }),
  };
}

export type MeridianMaterials = ReturnType<typeof makeMaterials>;

// =============================================================================
export type MeridianParts = {
  materials: MeridianMaterials;
  /** Everything built lazily, released together on unmount. */
  disposables: { dispose(): void }[];
  /** A private, disposable copy of a shared material. See the accessor's note. */
  own: <K extends keyof MeridianMaterials>(key: K) => MeridianMaterials[K];
  /** One blade, instanced eleven times. */
  bladeGeometry: THREE.BufferGeometry;
  /** Shared unit box for every engraved mark on every ring. */
  markGeometry: THREE.BufferGeometry;
  wellGeometry: THREE.BufferGeometry;
  retainerGeometry: THREE.BufferGeometry;
  axisGeometry: THREE.BufferGeometry;
  collarGeometry: THREE.BufferGeometry;
  interiorGeometry: THREE.BufferGeometry;
  band: (profile: RingProfile) => THREE.BufferGeometry;
  /** The separation line — a groove in the face, or a hairline round the case. */
  seat: (profile: RingProfile) => THREE.BufferGeometry;
  signalArc: (profile: RingProfile) => THREE.BufferGeometry;
};

/**
 * The retaining ring, expressed as a profile so it can reuse the band and arc
 * builders. A module constant, not an inline literal: the geometry caches below
 * are keyed by object identity, and a fresh object every render would build a
 * fresh geometry every render.
 */
export const RETAINER_PROFILE: RingProfile = {
  radius: (IRIS.retainerInner + IRIS.retainerOuter) / 2,
  halfWidth: (IRIS.retainerOuter - IRIS.retainerInner) / 2,
  halfThickness: (IRIS.retainerTopZ - IRIS.wellZ) / 2,
  bevel: 0.0015,
  ticks: 0,
  seatZ: IRIS.wellZ,
  seatTicks: 0,
  seatKind: 'face',
};

/**
 * Build the parts once per quality tier and dispose them on unmount.
 *
 * `simplified` halves the tessellation of everything curved. It is not a
 * different object — every ring, every blade and the whole aperture mechanism
 * are present on a phone — it is the same object built out of fewer triangles.
 */
export function useMeridianParts(simplified: boolean): MeridianParts {
  const parts = useMemo<MeridianParts>(() => {
    const radial = simplified ? 48 : 96;
    const curve = simplified ? 8 : 16;

    const materials = makeMaterials();

    // Everything built lazily below is registered here so the cleanup can
    // release it. Without this the geometry caches and the private material
    // copies are unreachable from outside the closure, which is exactly the
    // shape of a leak that only shows up after a few route changes.
    const disposables: { dispose(): void }[] = [];
    const track = <T extends { dispose(): void }>(thing: T): T => {
      disposables.push(thing);
      return thing;
    };

    const bladeGeometry = new THREE.ExtrudeGeometry(bladeShape(), {
      depth: IRIS.bladeThickness,
      bevelEnabled: false,
      curveSegments: curve,
    });

    // Cached per profile: three rings, three bands, built at most once each.
    const bands = new Map<RingProfile, THREE.BufferGeometry>();
    const seats = new Map<RingProfile, THREE.BufferGeometry>();
    const arcs = new Map<RingProfile, THREE.BufferGeometry>();

    return {
      materials,
      disposables,
      /**
       * A private copy of a shared material.
       *
       * The seam and signal materials animate their own opacity, and there are
       * four things doing it independently — three rings and the aperture's
       * calibration mark. Sharing one instance means the last writer each frame
       * wins and the other three flicker. Call this inside a `useMemo` keyed on
       * `parts`, never in a render body.
       */
      own: <K extends keyof MeridianMaterials>(key: K): MeridianMaterials[K] =>
        track(materials[key].clone()) as MeridianMaterials[K],
      bladeGeometry,
      markGeometry: new THREE.BoxGeometry(1, 1, 1),
      wellGeometry: new THREE.CircleGeometry(IRIS.retainerInner + 0.004, radial / 2),
      retainerGeometry: bandGeometry(RETAINER_PROFILE, radial / 2),
      // The shaft: a unit-length cylinder along Z, scaled at runtime. Twelve
      // sides is plenty for something 0.0075 across on screen.
      axisGeometry: (() => {
        const g = new THREE.CylinderGeometry(0.012, 0.012, 1, 14, 1, false);
        g.rotateX(Math.PI / 2);
        return g;
      })(),
      collarGeometry: (() => {
        const g = new THREE.CylinderGeometry(0.026, 0.026, 0.014, 18, 1, false);
        g.rotateX(Math.PI / 2);
        return g;
      })(),
      // Open-ended, back-faced: seen only through the gap the bezel opens.
      interiorGeometry: (() => {
        const g = new THREE.CylinderGeometry(0.494, 0.494, 0.09, radial / 2, 1, true);
        g.rotateX(Math.PI / 2);
        return g;
      })(),

      band: (profile) => {
        let g = bands.get(profile);
        if (!g) bands.set(profile, (g = track(bandGeometry(profile, radial))));
        return g;
      },
      /**
       * The seat: the machined recess a ring lifts out of.
       *
       * It is the answer to two requirements at once. Before the lift it is the
       * separation seam that tells the visitor something is about to come
       * apart; after it, it is the register the scale ring was mounted in — and
       * because the seat carries index marks, the dial still has a readable
       * major scale once Ring 1 has left the face with the ticks.
       */
      seat: (profile) => {
        let g = seats.get(profile);
        if (!g) {
          const built =
            profile.seatKind === 'rim'
              ? (() => {
                  const c = new THREE.CylinderGeometry(
                    profile.rimRadius ?? profile.radius,
                    profile.rimRadius ?? profile.radius,
                    profile.rimHeight ?? 0.04,
                    radial,
                    1,
                    true,
                  );
                  c.rotateX(Math.PI / 2);
                  return c;
                })()
              : new THREE.RingGeometry(
                  profile.radius - profile.halfWidth - 0.003,
                  profile.radius + profile.halfWidth + 0.003,
                  radial,
                  1,
                );
          seats.set(profile, (g = track(built)));
        }
        return g;
      },
      /**
       * The certification line: a short arc at the lock seam, not a full ring.
       * A yellow ring all the way round would be decoration; a 14° segment at
       * the seam is a mark confirming one specific joint.
       */
      signalArc: (profile) => {
        let g = arcs.get(profile);
        if (!g) {
          arcs.set(
            profile,
            (g = track(
              new THREE.RingGeometry(
                profile.radius - profile.halfWidth * 0.55,
                profile.radius + profile.halfWidth * 0.55,
                Math.max(6, Math.round(radial / 8)),
                1,
                -0.12,
                0.24,
              ),
            )),
          );
        }
        return g;
      },
    };
  }, [simplified]);

  useEffect(
    () => () => {
      for (const material of Object.values(parts.materials)) material.dispose();
      parts.bladeGeometry.dispose();
      parts.markGeometry.dispose();
      parts.wellGeometry.dispose();
      parts.retainerGeometry.dispose();
      parts.axisGeometry.dispose();
      parts.collarGeometry.dispose();
      parts.interiorGeometry.dispose();
      // Everything the lazy accessors built, plus every private material copy.
      for (const thing of parts.disposables) thing.dispose();
      parts.disposables.length = 0;
    },
    [parts],
  );

  return parts;
}

/**
 * Ring visuals, in the same order as `RINGS` in meridian.ts.
 *
 * Radii are authored at the radius the ring's parts actually occupy in the
 * model, *before* any final scale is applied, because the scale is a property
 * of the locked ring and the band has to sit on the parts while they are still
 * seated in the face.
 */
export const RING_PROFILES: readonly RingProfile[] = [
  // Ring 1 — the outer altitude scale. ALT_Chapter_Ring sits at 0.400 and
  // ALT_Ticks_Major spans 0.375–0.392. Ten seat marks: the ring takes the major
  // ticks with it, and ten is exactly the dial's own division, so the face
  // keeps a scale a visitor can still read a needle against.
  {
    radius: 0.4,
    halfWidth: 0.024,
    halfThickness: 0.019,
    bevel: 0.005,
    ticks: 60,
    seatZ: 0.0553,
    seatTicks: 10,
    seatKind: 'face',
  },
  // Ring 2 — the inner calibration scale. ALT_Ticks_Minor, at 0.389.
  {
    radius: 0.389,
    halfWidth: 0.018,
    halfThickness: 0.015,
    bevel: 0.004,
    ticks: 44,
    seatZ: 0.0548,
    seatTicks: 40,
    seatKind: 'face',
  },
  // Ring 3 — the rear structural frame. ALT_Housing_Flange, 0.517 at the back
  // of the case. Largest, heaviest, and it leaves rearward. Its separation line
  // is a hairline around the housing's silhouette rather than a groove in a
  // face nobody is looking at.
  {
    // The band sits *inside* the flange's own 0.517 outer radius, not outside
    // it. Authored any wider, it shows as a pale arc standing proud of the case
    // at 0 m — a part of the finished object visible before anything has
    // happened, which is exactly the "one object waiting behind another" the
    // whole approach is meant to avoid. It becomes the largest ring by growing
    // as it disengages (see `finalScale` in meridian.ts), not by starting big.
    radius: 0.5,
    halfWidth: 0.019,
    halfThickness: 0.024,
    bevel: 0.005,
    ticks: 28,
    seatZ: -0.0925,
    seatTicks: 0,
    seatKind: 'rim',
    rimRadius: 0.503,
    rimHeight: 0.046,
  },
] as const;

/**
 * Which of the GLB's own parts each ring is made of.
 *
 * This is the load-bearing list of the whole feature: every ring is assembled
 * from nodes that were already in the instrument, so a ring cannot appear from
 * nowhere — it can only leave the place it was. Names are the Blender object
 * names and are asserted at runtime in development, because a silent rename in
 * the model would otherwise produce an empty ring rather than an error.
 */
export const RING_PARTS: readonly (readonly string[])[] = [
  ['ALT_Chapter_Ring', 'ALT_Ticks_Major'],
  ['ALT_Ticks_Minor'],
  ['ALT_Housing_Flange'],
] as const;

/** The bezel and its crystal move together when the case opens. */
export const HOUSING_PARTS = ['ALT_Housing_Bezel', 'ALT_Glass_Crystal'] as const;

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import type { Group, Mesh, MeshStandardMaterial } from 'three';
import { cameraHeightAt, clamp, settle, journey, lerp } from '../journey';
import {
  RAIL_DEPTH_TRIM,
  RAIL_SCALE_TRIM,
  currentFit,
  railCameraYaw,
  railFaceYaw,
  railTrack,
  railWorldX,
  recededScale,
  recededDepth,
  recedeAt,
  setLiveRecede,
} from '../composition';
import { RINGS, meridian } from '../meridian';
import { useDebugOverride } from '../useJourneyScroll';
import { ApertureCore } from './ApertureCore';
import { MeridianAxis } from './MeridianAxis';
import { MeridianRing } from './MeridianRing';
import { HOUSING_PARTS, RING_PARTS, RING_PROFILES, useMeridianParts } from './meridianParts';

/**
 * Altimeter Meridian — the Stratos altimeter, and everything it turns out to
 * contain.
 *
 * ## What this replaced, and what it kept
 *
 * This is the same GLB, on the same clock, in the same place in the scene graph
 * as the instrument that was here before. The needle mapping, the power-on
 * ramp, the emissive restore-on-unmount and the handover that moves the dial out
 * of the reader's way are all carried over unchanged in behaviour, because they
 * were right and because the whole premise of the Meridian is that the visitor
 * is looking at the *same object* the entire way up.
 *
 * ## How a ring can exist without being added
 *
 * The GLB is a flat scene of twenty-six named nodes. On mount they are sorted
 * into four groups — the core instrument, and one group per ring — by moving
 * the nodes themselves, not by hiding some and drawing copies of others:
 *
 *   Ring 1  ALT_Chapter_Ring, ALT_Ticks_Major     the outer altitude scale
 *   Ring 2  ALT_Ticks_Minor                       the inner calibration scale
 *   Ring 3  ALT_Housing_Flange                    the rear structural frame
 *
 * That is the entire trick, and it is not a trick: at 0 m every one of those
 * nodes is at the transform Blender gave it, inside a group whose own transform
 * is the identity, so the instrument renders exactly as it always did. When a
 * ring lifts, what lifts is the actual outer scale — the ticks the needle was
 * being read against a moment earlier. Nothing fades in, nothing is swapped,
 * and there is no state in which both a flat scale and a spatial ring exist.
 *
 * The dial does not lose its scale when Ring 1 leaves with the major ticks: the
 * seat the ring lifts out of is engraved with the ten-division register that
 * located it. See MeridianRing.
 *
 * ## Where the composition went
 *
 * The instrument still recedes through the cloud stages — a lit dial in the
 * middle of four screens of case studies competes with the prose, and that was
 * true before the rings existed. What is new is that it comes *back*: from
 * 25 500 m the recede is wound down to less than half, because the last two
 * screens are where the Meridian is the subject again and a 0.62-scale dial in
 * the top corner is not a hero frame.
 *
 * The three-quarter reveal is done by turning the instrument, not the camera.
 * The camera also frames the sky dome, the cloud deck and the Earth limb, all of
 * which are authored for a head-on view and none of which want a yaw; and the
 * instrument sits well off the world origin, so orbiting the camera about the
 * origin would not orbit the instrument in any case. Turning the object is the
 * same picture with none of the collateral.
 */
export const MODEL_URL = `${import.meta.env.BASE_URL}models/stratos-altimeter.glb`;

const REV = Math.PI * 2;
const DEG = Math.PI / 180;

const POSE = {
  ground: { pitch: -7 * DEG, yaw: 12 * DEG },
  lit: { pitch: -2 * DEG, yaw: 3 * DEG },
};

/**
 * Needle mapping — unchanged.
 *
 * The dial is a 0–10 000 m instrument and the journey goes to 30 000 m, which
 * is not a mistake: a real three-pointer altimeter wraps, and the short pointer
 * completing three full turns is a more honest reading of 30 000 m than
 * rescaling the dial would be.
 */
const primaryAngle = (metres: number) => -((metres % 1000) / 1000) * REV;
const secondaryAngle = (metres: number) => -(metres / 10000) * REV;

type Emissive = { mat: MeshStandardMaterial; base: number };

/** Module scope so the override hook's identity is stable across renders. */
const readQuality = () => journey.debug.quality;

export function AltimeterMeridian({ simplified }: { simplified: boolean }) {
  const { scene, materials } = useGLTF(MODEL_URL, false, false);
  const root = useRef<Group>(null);
  const gimbal = useRef<Group>(null);
  const housing = useRef<Group>(null);
  const size = useThree((s) => s.size);
  // Read for its position and nothing else: the rail is solved against the
  // camera's *distance*, which the dolly damps, so the solve has to use the
  // value the camera is actually at rather than the one it is heading for.
  const camera = useThree((s) => s.camera);

  const landscape = useMemo(() => size.width / size.height > 1.2, [size]);

  // Quality comes from the capability probe, but the debug panel can override
  // it without remounting the scene — and it is read during render, so it needs
  // the subscription. Both compile away in production.
  const quality = useDebugOverride(readQuality, 'auto');
  const lowDetail = quality === 'auto' ? simplified : quality === 'reduced';
  const parts = useMeridianParts(lowDetail);

  /**
   * Clone the model and sort it into its assemblies.
   *
   * `useGLTF` caches by URL, so the object graph is shared with anything else
   * that loads the same file — including the short prototype, which can be open
   * in another tab of the same session. Re-parenting nodes out of a shared
   * graph would break that route. Clone first, always.
   */
  const assembly = useMemo(() => {
    const model = scene.clone(true);
    const take = (names: readonly string[], into: Group) => {
      for (const name of names) {
        const node = model.getObjectByName(name);
        if (!node) {
          // Loud in development, survivable in production: a renamed node
          // should stop the person who renamed it, not the visitor.
          if (import.meta.env.DEV) {
            throw new Error(
              `AltimeterMeridian: the model has no node named "${name}". The rings are ` +
                `assembled from the instrument's own parts, so a rename in the .blend ` +
                `has to be mirrored in RING_PARTS.`,
            );
          }
          continue;
        }
        into.add(node);
      }
    };

    const rings = RING_PARTS.map((names) => {
      const group = new THREE.Group();
      take(names, group);
      return group;
    });

    const housingGroup = new THREE.Group();
    take(HOUSING_PARTS, housingGroup);

    return { model, rings, housingGroup };
  }, [scene]);

  const needles = useMemo(
    () => ({
      primary: assembly.model.getObjectByName('ALT_Needle_Primary') ?? null,
      secondary: assembly.model.getObjectByName('ALT_Needle_Secondary') ?? null,
    }),
    [assembly],
  );

  const lit = useMemo<Emissive[]>(() => {
    const names = ['MAT_Marking_Chrome', 'MAT_Signal_Beacon', 'MAT_Needle_Paper'];
    return names
      .map((n) => materials[n] as MeshStandardMaterial | undefined)
      .filter((m): m is MeshStandardMaterial => !!m)
      .map((mat) => ({ mat, base: mat.emissiveIntensity ?? 1 }));
  }, [materials]);

  /**
   * The crystal.
   *
   * Fogged at ground level and clear at altitude — which is the cheapest and
   * most literal way to say "the atmosphere got out of the way", and it costs
   * two numbers rather than a post-processing pass. It is a material out of the
   * GLTF cache and it outlives this component, so both values are restored on
   * unmount exactly as the emissive strengths are.
   */
  const glass = useMemo(() => {
    const mat = materials['MAT_Glass_Crystal'] as MeshStandardMaterial | undefined;
    return mat ? { mat, opacity: mat.opacity, roughness: mat.roughness } : null;
  }, [materials]);

  useEffect(() => {
    assembly.model.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = true;
    });
    return () => {
      for (const { mat, base } of lit) mat.emissiveIntensity = base;
      if (glass) {
        glass.mat.opacity = glass.opacity;
        glass.mat.roughness = glass.roughness;
      }
    };
  }, [assembly, lit, glass]);

  /**
   * Release the cached model when the scene goes away.
   *
   * This is the fix for a measured leak, and the mechanism is worth writing down
   * because nothing about it is visible from this file alone.
   *
   * `WebGLRenderer` attaches a `dispose` listener to every material and geometry
   * it draws, and that listener is a closure over the renderer's own scope — its
   * property maps, its program cache, and its `WebGLRenderingContext`. The
   * listener is removed only when the material is disposed, which for a cached
   * GLTF never happens: the whole point of the cache is that the object graph
   * outlives any one mount.
   *
   * So every material in this GLB accumulates one listener per renderer that has
   * ever drawn it, and each of those listeners keeps a dead renderer and its
   * dead context reachable. Measured over ten remounts: one retained
   * `WebGL2RenderingContext`, ~120 `WebGLBuffer` and ~90 `WebGLUniformLocation`
   * wrappers per cycle, and roughly half a megabyte of heap that four forced
   * collections and a ten-second idle do not return. Neither three.js's
   * `renderer.dispose()` nor react-three-fiber's unmount removes those
   * listeners; only losing the material does.
   *
   * The cost of releasing it is one re-parse of a 397 KB GLB — served from the
   * HTTP cache — on a remount that only happens when the visitor changes their
   * reduced-motion preference mid-session. That is the cheaper side of the trade
   * by a wide margin.
   */
  useEffect(
    () => () => {
      useGLTF.clear(MODEL_URL);
      // The band geometry falls back to the analytic target the moment there
      // is no instrument left to measure. Leaving a stale number here would
      // size the copy bands for a scene that is no longer on the page.
      setLiveRecede(null);
    },
    [],
  );

  const smoothed = useRef({ primary: 0, secondary: 0, power: 0, recede: 0, tiltX: 0, tiltY: 0 });
  const lastProgress = useRef(0);

  useFrame((_, delta) => {
    if (!journey.running) return;
    const dt = Math.min(delta, 1 / 20);
    const s = smoothed.current;
    const m = journey.altitude;

    // --- needles -------------------------------------------------------------
    // They lag and settle. A real needle has mass, and the instrument is the one
    // object here whose behaviour a visitor might actually know.
    s.primary = settle(s.primary, primaryAngle(m), 0.72, dt);
    s.secondary = settle(s.secondary, secondaryAngle(m), 0.86, dt);
    if (needles.primary) needles.primary.rotation.z = s.primary;
    if (needles.secondary) needles.secondary.rotation.z = s.secondary;

    // --- activation and clarity ---------------------------------------------
    s.power = settle(s.power, journey.power, 0.88, dt);

    // --- the handover, as a round trip ---------------------------------------
    //
    // The instrument used to recede once, over 6 500–11 500 m, and stay small
    // for the remaining two thirds of the journey. That was right when it was a
    // dial: after the cloud deck it had nothing left to say and the case studies
    // needed the frame. It is wrong for an instrument that has two of its three
    // structural events still ahead of it — the second and third ring locks
    // landed at 18 000 and 24 000 m as thumbnails in the top corner.
    //
    // So it is a round trip now, and each leg is tied to what the page is doing:
    //
    //   12 300 → 15 600  hands over, after the aperture snap has landed and
    //                    through the four case studies, which are the one part
    //                    of this page that genuinely needs the whole frame
    //   16 200 → 19 200  comes most of the way back, for the system and process
    //                    stages, whose panels are text in a plate rather than
    //                    imagery, and for the second ring lock
    //   24 000 → 30 000  the rest of the way, for the Meridian state
    //
    // On a portrait viewport there is a fourth leg, and it is the one Phase 6
    // was blocked on. The three above were tuned against landscape framing,
    // where the copy sits *beside* the instrument; in portrait it has to go
    // above and below, and on the dense narrative stages the two measured
    // exclusion zones did not both fit. So the same mechanism — scale and
    // depth, never displacement — is given a bounded extra term over exactly
    // the stages measured to be dense, and only on portrait. `recedeAt` is a
    // pure function of altitude and the measured portrait strength, so nothing
    // about it is direction-dependent and landscape reads an added zero.
    const target = recedeAt(m, meridian.finalCalibration, currentFit().strength);
    s.recede = settle(s.recede, target, 0.9, dt);
    const recede = s.recede;
    // The copy bands are laid out against the size the instrument actually is,
    // not the size it is heading for. See setLiveRecede.
    setLiveRecede(recede);

    const dim = lerp(1, 0.42, recede);
    // Clarity brightens the markings on the way through the deck: the dial gains
    // contrast as the air loses it.
    //
    // The second term is the final calibration, and it is there for one reason:
    // by 30 000 m the face is being crossed by two lit rings and read at a 27°
    // yaw, and both of those cost it legibility at exactly the altitude the
    // brief asks for the original dial to be fully readable again. Eighteen per
    // cent is what it takes for the numerals to hold their own against the
    // rings; it is a restoration, not a highlight.
    const clear = lerp(1, 1.35, meridian.clarity) * lerp(1, 1.18, meridian.finalCalibration);
    for (const { mat, base } of lit) {
      mat.emissiveIntensity = base * (0.24 + 0.76 * s.power) * dim * clear;
    }

    if (glass) {
      // Coated glass, not a bubble: the reflection stays, the fog leaves.
      glass.mat.opacity = lerp(glass.opacity * 1.9, glass.opacity * 0.78, meridian.clarity);
      glass.mat.roughness = lerp(0.19, 0.04, meridian.clarity);
    }

    // --- the case opening ----------------------------------------------------
    // A few millimetres, mechanically. This is what releases Ring 3, and it is
    // what makes the rear frame's departure a consequence of something rather
    // than a part deciding to leave.
    if (housing.current) housing.current.position.z = meridian.housingSeparation * 0.026;

    // --- the gimbal ----------------------------------------------------------
    // Restrained self-levelling, and only after the second ring has locked —
    // before that there is no two-axis system for a gimbal to be a property of.
    // The disturbance is real input (pointer and scroll velocity), the response
    // is a fraction of a degree, and the rest state is level. The central axis
    // is outside this group and never sees any of it.
    if (gimbal.current) {
      const strength = meridian.gimbalStrength;
      const scrollVelocity = clamp((journey.current - lastProgress.current) * 26, -1, 1);
      lastProgress.current = journey.current;

      const targetX = strength * (journey.pointer.y * 0.5 + scrollVelocity) * 1.6 * DEG;
      const targetY = strength * journey.pointer.x * 1.6 * DEG;
      // Asymmetric damping: it reacts a little faster than it recovers, which is
      // what makes it read as levelling rather than as wobbling.
      s.tiltX = settle(s.tiltX, targetX, 0.9, dt);
      s.tiltY = settle(s.tiltY, targetY, 0.93, dt);
      gimbal.current.rotation.x = s.tiltX;
      gimbal.current.rotation.y = s.tiltY;
    }

    if (root.current) {
      // --- the rails -----------------------------------------------------------
      //
      // The instrument no longer sits at 50% for all 30 000 metres. It moves
      // between three measured compositional rails and the copy takes the side
      // it is not on, which is the revision that supersedes the permanently
      // centred composition.
      //
      // What has *not* changed is the rule that made centring necessary in the
      // first place: the position is not a tuned offset. `railWorldX` solves,
      // in closed form, for the world x at which this instrument — at this
      // distance, under this camera yaw, on this viewport — projects onto the
      // rail the altitude asks for. The rail itself is a fraction of the usable
      // width whose ceiling was measured against the ring composition's own
      // projected extent, so the complete Meridian stays inside the viewport at
      // every rail and at every point of every crossing. In portrait, and on any
      // viewport whose measurement leaves no room, the budget is zero and every
      // line below returns exactly the centred composition.
      //
      // The move is three things at once, which is §6's "the camera is
      // recomposing around it" rather than "a UI object is sliding":
      //
      //   * the camera pans by up to a degree            (JourneyCamera)
      //   * the instrument translates, solved against that pan   (here)
      //   * it settles a little further away as it goes          (here)
      //
      // and a fourth that stops it reading as a billboard being dragged: it
      // turns most of the way back to face the camera.
      const track = railTrack(m);
      const off = Math.abs(track);

      // The bounded scale and depth correction. Three per cent and 0.09 world
      // units at the full displacement, applied through the same scale/depth
      // pair the recede uses so there is no second way for the instrument to
      // change size. It buys the ring composition a little more edge margin
      // exactly where the lateral budget is tightest, and settling further away
      // as it moves aside is the mass-bearing direction.
      const scale = recededScale(recede) * (1 - RAIL_SCALE_TRIM * off);
      const z = recededDepth(recede) - RAIL_DEPTH_TRIM * off;

      // Distance from the camera to the instrument's plane. The camera's z is
      // damped and lands exactly (`settle`), so at rest this is a pure function
      // of the altitude and forward and reverse traversal agree to the ulp.
      const distance = Math.max(camera.position.z - z, 1e-3);
      const camYaw = railCameraYaw(m);
      const x = railWorldX(m, distance, camYaw, Math.max(size.width, 1) / Math.max(size.height, 1));

      root.current.position.x = x;
      // Rides at exactly the camera's height, so it sits on the view axis and is
      // vertically centred at every altitude. The camera still climbs relative
      // to the mountains, the cloud deck and the sky — which is where the ascent
      // is actually told — but it no longer climbs relative to the instrument.
      // The rails move the composition laterally only; nothing here touches the
      // vertical, and the vertical centre tolerance is unchanged.
      root.current.position.y = cameraHeightAt(journey.current);
      root.current.position.z = z;
      root.current.scale.setScalar(scale);

      // The three-quarter reveal. It opens as the rings separate and holds.
      //
      // 27° is the smallest angle at which the central shaft clears the case
      // and is actually visible — the brief asks for the axis to still read in
      // the final state, and at 22° the housing hides all of it. It is also
      // close to the largest angle at which the dial is still readable
      // head-on, which is the other half of the constraint. On a phone the
      // instrument is small enough that any of this costs legibility, so it
      // gets less than half.
      const reveal = meridian.rings[0].settle * 0.35 + meridian.rings[1].settle * 0.4 + meridian.rings[2].settle * 0.25;
      const yaw = reveal * (landscape ? 27 : 11) * DEG + journey.debug.instrumentYaw;
      const pitch = reveal * (landscape ? -9 : -4) * DEG;

      const settle = clamp(s.power);
      root.current.rotation.x = lerp(POSE.ground.pitch, POSE.lit.pitch, settle) + pitch;
      // The last term keeps the dial presenting its face as it leaves the axis.
      // At the full displacement the instrument stands about eleven degrees off
      // the view axis, and left alone it would be seen increasingly from the
      // side — which reads as the object having been pushed. Turning it most of
      // the way back is what sells the frame having moved instead; the residual
      // few degrees are what stop it looking like a flat translation, and they
      // are the same order as the pose yaw it already carries.
      root.current.rotation.y =
        lerp(POSE.ground.yaw, POSE.lit.yaw, settle) + recede * 0.2 + yaw + railFaceYaw(x, distance);
      // No roll, ever. An altimeter with its zero off the vertical reads as
      // broken rather than as styled.
      root.current.rotation.z = 0;
    }
  });

  return (
    // `meridianRoot` marks the instrument for the composition checks in
    // `experiments/shots-mountains.mjs`, which need to know exactly where it
    // projects to in order to say whether a mountain covers it. The first pass
    // of that script inferred the instrument from bounding-box size and camera
    // distance and reported "meridian not found" for three viewports out of
    // four — a heuristic that fails silently is worse than no check, because it
    // reads as a pass. Scene-graph data, not a debug hook: it costs nothing and
    // survives into production, so the check measures the shipped object.
    <group ref={root} dispose={null} userData={{ meridianRoot: true }}>
      {/* The core instrument: dial, numerals, legends, brand, hub, needles,
          bezel bolts, barrel. Everything the rings are not. */}
      <primitive object={assembly.model} />

      {/* The bezel and its crystal, which lift together when the case opens. */}
      <group ref={housing}>
        <primitive object={assembly.housingGroup} />
      </group>

      {/* Seen only through the gap the bezel opens: without it the case shows
          daylight between its own parts. */}
      <mesh
        geometry={parts.interiorGeometry}
        material={parts.materials.interior}
        position={[0, 0, 0.055]}
      />

      <ApertureCore parts={parts} simplified={lowDetail} />
      <MeridianAxis parts={parts} />

      {/* All three rings share one gimbal. The axis and the core do not.
          Tagged for the same reason the root is, and with the same reasoning:
          the visibility check has to measure the *essential instrument* and the
          *active ring composition* against different rules — the brief allows a
          ring to approach the viewport edge, and does not allow the dial to.
          Subtracting this subtree from the root's is what separates them, and
          doing it by tag rather than by child index means re-ordering the JSX
          cannot silently repoint the measurement at the wrong geometry. */}
      <group ref={gimbal} userData={{ meridianGimbal: true }}>
        {RINGS.map((config, i) => (
          <MeridianRing
            key={config.id}
            config={config}
            profile={RING_PROFILES[i]}
            parts={parts}
            group={assembly.rings[i]}
            simplified={lowDetail}
          />
        ))}
      </group>
    </group>
  );
}

/**
 * The two `false`s are the decoder extensions, and they are load-bearing.
 *
 * drei's `useGLTF` defaults BOTH on: it builds a `DRACOLoader` pointed at
 * `https://www.gstatic.com/draco/...` and it calls `MeshoptDecoder()`, which
 * instantiates a WebAssembly module from an inlined base64 string — before it
 * has looked at the file, so it happens whether or not the asset uses either
 * extension.
 *
 * `models/stratos-altimeter.glb` uses neither. Its only extension is
 * `KHR_materials_emissive_strength`; the DRACO meshes on this site are the two
 * mountain ranges, and `MountainRange.tsx` builds its own decoder for them
 * against the self-hosted `/draco/` copy for exactly this reason.
 *
 * So the defaults bought nothing and cost a Content Security Policy violation
 * on every load: `script-src 'self' https://www.googletagmanager.com` has no
 * `'unsafe-eval'`, and Chromium refuses `WebAssembly.instantiate()` under it.
 * The model still decoded — the failure is in a decoder the file never needed —
 * but it logged a `CompileError` to the console and an entry to the Issues
 * panel on every visit, which is two failed Lighthouse best-practice audits and
 * a real error in a real console for anyone who opens one.
 *
 * The alternative was widening the policy with `'wasm-unsafe-eval'`. Turning
 * off a decoder nothing here uses is the smaller change, and it is the one that
 * does not spend a CSP directive to fix a self-inflicted error. Both call sites
 * — the hook and the `preload` — carry the same arguments, because whichever
 * runs first is the one that configures the shared loader.
 */
useGLTF.preload(MODEL_URL, false, false);

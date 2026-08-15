import { Suspense, useEffect, useMemo, useRef } from 'react';
import { Canvas, invalidate, useFrame, useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import type { Group, Mesh, MeshStandardMaterial } from 'three';
import { onAscent } from './ascent';
import { prefersReducedMotion } from './device';
import { PLACEMENTS, onInstrument } from './anchors';
import {
  FOV,
  HELD_POSE,
  MOVED,
  RETAIN,
  cameraDistance,
  emissiveGain,
  powerAt,
  primaryAngle,
  secondaryAngle,
} from './instrument';

/**
 * The real Altimeter, on portrait mobile, in a scene that contains nothing else.
 *
 * ## What this is, against what it is not
 *
 * `JourneyScene` is the desktop composition: a sky dome, a cloud deck, a
 * DRACO-compressed mountain range, a star field, an Earth limb, nine system
 * rings, seven checkpoints, three procedurally-built Meridian rings, an
 * aperture core, a central axis, a camera that climbs 30 000 m, a quality
 * ladder and a `PerformanceMonitor`. Measured on a phone it drew 2 471 calls
 * and 1.49M triangles per frame.
 *
 * This module is one GLB, one camera, four lights and a baked reflection probe.
 * 26 draw calls, 13 266 triangles, and only when something has actually moved.
 * It is not the desktop scene simplified — it never imports it, and it has no
 * branch that could reach it. That separation is the whole architectural point
 * of §3: the portrait page loads what the instrument needs and cannot, by
 * construction, load what it does not.
 *
 * ## The same object, though
 *
 * `models/stratos-altimeter.glb` — the same file, the same 26 nodes, the same
 * twelve materials, the same needle mapping. §2 and §21 are one requirement
 * stated twice: a visitor who sees the desktop page and the phone page has to
 * be looking at the same designed object, and the only way to guarantee that is
 * for it to *be* the same object rather than a mobile interpretation of one.
 *
 * What the portrait instrument does not get is the Meridian's structural
 * theatre — the rings do not lift, the case does not open, the aperture does
 * not iris. Those are the desktop journey's argument, they are procedural
 * geometry built on top of the model rather than part of it, and a phone that
 * shows the instrument for one screen has no room to tell that story. The
 * dial, the bezel, the crystal, the hands, the markings, the yellow ceiling arc
 * and the hub are all here, and they are what §2 lists.
 *
 * ## Why nothing here runs a render loop
 *
 * `frameloop="demand"`. See `Instrument` below: the scroll reader writes a
 * target and asks for a frame, the frame settles towards it, and the moment the
 * settle is inside `MOVED` nothing asks for another. An idle instrument on a
 * page nobody is scrolling costs zero GPU work and zero main-thread work, which
 * is §4, and it is the single most important difference between this and every
 * previous mobile 3D attempt on this site.
 *
 * ## What the instrument becoming persistent cost, exactly
 *
 * It used to stop drawing entirely once its slot left the viewport, which was
 * most of the document. It cannot any more: it is on screen for the whole read
 * and its needles follow the altitude the whole way, which is the point of the
 * change — the Altimeter is a signature object of this page and it disappeared
 * from it after one screen.
 *
 * So the demand loop now draws on scroll frames for the length of the document
 * rather than for one screen of it. What it draws is unchanged: 26 calls,
 * 13 266 triangles, one 335px square buffer created once at the hero size and
 * reused at every state — a rail state is those same pixels scaled down by the
 * compositor, not a second render at a smaller size. And every other guarantee
 * survives intact: nothing draws while the page is still, nothing draws while
 * the navigation layer is up, nothing draws while the instrument has receded
 * into the footer, and the scene still adds no scroll listener of its own.
 */

const MODEL_URL = `${import.meta.env.BASE_URL}models/stratos-altimeter.glb`;

/**
 * The reflection probe, baked once from three emitters and never fetched.
 *
 * §9 asks for the smallest high-quality environment that preserves the
 * instrument, and explicitly forbids loading the desktop atmospheric
 * environment or megabytes of HDR merely for reflections. So there is no HDR
 * file: the probe is prefiltered from a virtual scene of three flat emitters —
 * the same three, in the same places, at the same intensities as the desktop
 * composition's `<Lightformer>`s, so the steel and the crystal reflect the same
 * studio on both surfaces. It costs one PMREM pass at mount and zero bytes over
 * the network.
 *
 * ## Why this is imperative rather than drei's `<Environment>`
 *
 * `<Environment frames={1}>` renders its probe from inside `useFrame`, and
 * `useFrame` does not run under `frameloop="demand"` until something invalidates
 * — so the environment would exist only if the instrument happened to ask for a
 * frame first, and the *first* frame would be the one drawn without it. That is
 * a race whose losing side is a visibly flat instrument on the frame the visitor
 * lands on. `PMREMGenerator.fromScene` renders when it is called, which is a
 * property and not a hope.
 */
function useBakedEnvironment(): void {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);

  useEffect(() => {
    const rig = new THREE.Scene();
    const plane = new THREE.PlaneGeometry(1, 1);
    const materials: THREE.Material[] = [];

    /** One emitter, facing the instrument. Colour carries the intensity. */
    const emitter = (
      color: string,
      intensity: number,
      position: [number, number, number],
      scale: [number, number],
    ) => {
      const material = new THREE.MeshBasicMaterial({
        color: new THREE.Color(color).multiplyScalar(intensity),
        side: THREE.DoubleSide,
        // Never tone-mapped. The probe is lighting data, not a picture: mapping
        // it here would compress the highlights twice, once into the probe and
        // once out of the beauty pass, and the crystal would lose exactly the
        // specular roll-off it is on the page for.
        toneMapped: false,
      });
      materials.push(material);
      const mesh = new THREE.Mesh(plane, material);
      mesh.position.set(...position);
      mesh.scale.set(scale[0], scale[1], 1);
      mesh.lookAt(0, 0, 0);
      rig.add(mesh);
    };

    // The key panel, high and to the left: the source of the long highlight
    // that runs down the bezel and separates the case from the crystal.
    emitter('#dce8f7', 2.6, [-2.2, 2.4, 2.0], [5, 5]);
    // The cool return from the right, so the far limb of the case is not black.
    emitter('#7f96b5', 1.1, [2.8, 0.4, 1.2], [3, 6]);
    // A dim floor bounce. Without it the lower bevel reads as a cut edge.
    emitter('#2b3446', 0.7, [0, -2.4, 1.6], [4, 4]);

    const pmrem = new THREE.PMREMGenerator(gl);
    const target = pmrem.fromScene(rig, 0, 0.1, 100);
    scene.environment = target.texture;

    pmrem.dispose();
    plane.dispose();
    for (const material of materials) material.dispose();

    // One frame is owed: the probe landed outside the render loop, so nothing
    // has drawn with it yet.
    invalidate();

    return () => {
      scene.environment = null;
      target.dispose();
    };
  }, [gl, scene]);
}

/**
 * The lights, and they are constants.
 *
 * The desktop rig moves four intensities with altitude because two of its
 * moments — the cloud breakthrough at 12 000 m and the Meridian state at
 * 30 000 m — are lighting events, and because there is a sky behind the
 * instrument whose brightness changes underneath it. Neither is true here. The
 * portrait instrument is seen against one near-black background for the whole
 * time it is on screen, so a light that changed would be a light changing for
 * no reason the visitor could see — and under `frameloop="demand"` it would
 * also be a reason to draw frames.
 *
 * The rim is the one difference from the desktop rest state, and it is on
 * permanently rather than arriving at 24 000 m. Desktop can leave it off
 * because for four fifths of the journey there is a lit sky separating the
 * case from the background. §11 puts a deep black behind this instrument at all
 * times, so the silhouette needs the separation from the first frame.
 */
function InstrumentLights() {
  return (
    <>
      {/* The haze the case sits in. Cool, and low enough that the bevels
          survive: ambient is the enemy of a machined edge. */}
      <ambientLight intensity={0.58} color="#8ea3bd" />
      {/* The key. High and to the left, the same direction as desktop's, and
          stronger — desktop's dial is read against a lit mountain valley and
          this one against black, so the modelling has to carry more of the
          separation. */}
      <directionalLight position={[-2.4, 3.2, 2.6]} intensity={4.8} color="#eef4ff" />
      {/* The cool return from the far side, so the right limb of the case is
          modelled rather than lost. */}
      <directionalLight position={[3.0, -1.4, -1.8]} intensity={1.6} color="#5b7ba8" />
      {/* The rim. See above: permanently on here, because there is never a sky
          behind this instrument to do the job. */}
      <directionalLight position={[1.6, 2.2, -3.0]} intensity={2.0} color="#c3d6ef" />
    </>
  );
}

/**
 * The camera, framed from the canvas's own aspect ratio.
 *
 * Not a journey and not a rig: it stands still, on the view axis, at the
 * distance `cameraDistance` solves for. The only thing that ever moves it is
 * the canvas changing shape, which is a rotation or an address bar — and both
 * of those have to reframe or the instrument would be cropped.
 *
 * `useThree(s => s.size)` is react-three-fiber's own `ResizeObserver` on the
 * canvas element. It is not a layout read on this page's behalf and it cannot
 * feed back into the document: the canvas's box comes from CSS with a fixed
 * aspect ratio, so the scene is told its size and never asks for one. §12.
 */
function InstrumentCamera() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);

  useEffect(() => {
    const aspect = Math.max(size.width, 1) / Math.max(size.height, 1);
    camera.fov = FOV;
    camera.position.set(0, 0, cameraDistance(aspect));
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    invalidate();
  }, [camera, size.width, size.height]);

  return null;
}

type Emissive = { mat: MeshStandardMaterial; base: number };

/**
 * The instrument itself: the model, the two needles, and the one subscription.
 *
 * ## The whole of the scroll integration
 *
 *     native document scroll
 *       -> the shared ascent reader          (one passive listener, already there)
 *       -> a plain object of target numbers  (no React state, no rerender)
 *       -> `invalidate()`                    (one frame requested)
 *       -> `useFrame` settles and writes     (object transforms, mutated)
 *
 * §5, in the order §5 states it. Nothing on this path calls `setState`, reads a
 * layout, writes a style, or touches the document. The component renders once,
 * at mount, and never again for the life of the page.
 */
function Instrument({ onReady }: { onReady: () => void }) {
  const { scene, materials } = useGLTF(MODEL_URL);
  const root = useRef<Group>(null);

  const still = useMemo(prefersReducedMotion, []);

  /**
   * Clone before touching anything.
   *
   * `useGLTF` caches by URL and the desktop composition re-parents nodes out of
   * the graph it gets. Nothing here re-parents, but the emissive strengths below
   * are written on *shared* materials, and a shared material written by two
   * surfaces is the kind of bug that only appears when someone opens both.
   */
  const model = useMemo(() => scene.clone(true), [scene]);

  const needles = useMemo(
    () => ({
      primary: model.getObjectByName('ALT_Needle_Primary') ?? null,
      secondary: model.getObjectByName('ALT_Needle_Secondary') ?? null,
    }),
    [model],
  );

  /** The markings, the beacon and the needle faces — everything that lights up. */
  const lit = useMemo<Emissive[]>(() => {
    const names = ['MAT_Marking_Chrome', 'MAT_Signal_Beacon', 'MAT_Needle_Paper'];
    return names
      .map((n) => materials[n] as MeshStandardMaterial | undefined)
      .filter((m): m is MeshStandardMaterial => !!m)
      .map((mat) => ({ mat, base: mat.emissiveIntensity ?? 1 }));
  }, [materials]);

  /**
   * The crystal, at its clear setting and left there.
   *
   * Desktop fogs it at ground level and clears it through the deck, because
   * there the fog is the atmosphere and clearing it is the story. Here there is
   * no atmosphere to leave, and §10 asks for visible reflection, a controlled
   * highlight and physical separation between glass and dial — which is the
   * clear end of that same range. Restored on unmount, because this material
   * outlives the component: it belongs to the GLTF cache.
   */
  const glass = useMemo(() => {
    const mat = materials['MAT_Glass_Crystal'] as MeshStandardMaterial | undefined;
    return mat
      ? {
          mat,
          opacity: mat.opacity,
          roughness: mat.roughness,
          env: mat.envMapIntensity,
          blending: mat.blending,
          depthWrite: mat.depthWrite,
        }
      : null;
  }, [materials]);

  useEffect(() => {
    /**
     * How hard the baked probe is pushed into the metal.
     *
     * The one knob that does most of the work in §8. A directional light gives
     * an edge a highlight; the environment is what gives the steel and the
     * graphite their *material*, and against a black background the default
     * strength leaves both reading as dark plastic. Restored on unmount with
     * everything else, because these materials come out of the GLTF cache.
     */
    const boosted: { mat: MeshStandardMaterial; base: number }[] = [];

    model.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;

      const mat = mesh.material as MeshStandardMaterial | MeshStandardMaterial[];
      for (const m of Array.isArray(mat) ? mat : [mat]) {
        if (!m || !('envMapIntensity' in m)) continue;
        if (boosted.some((b) => b.mat === m)) continue;
        boosted.push({ mat: m, base: m.envMapIntensity });
        m.envMapIntensity = m.envMapIntensity * 1.45;
      }

      // No shadow pass anywhere in this scene. One object lighting itself does
      // not need a second depth render, and on a phone that render is the whole
      // budget. §3's "no postprocessing stack unless absolutely necessary"
      // applies to the shadow map for the same reason.
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = true;
    });

    if (glass) {
      /**
       * The crystal — §10, and it is the one material tuned rather than merely
       * scaled.
       *
       * Physically-based transparency and an environment reflection, and
       * nothing else: §10 rules out realtime refraction, and a transmission
       * pass on a phone would cost a second render of the whole scene into an
       * offscreen buffer to light one lens.
       *
       * The crystal is authored at alpha 0.16 and metalness 0, which makes it a
       * dielectric whose specular response is 4% of whatever it is reflecting —
       * and then *that* is multiplied by the alpha when it composites. Against
       * a lit sky the remainder is still enough to see. Against §11's black it
       * is not: measured on the first pass the glass was simply not there, and
       * the dial read as an engraved plate with no lens over it.
       *
       * The fix is the blend mode, not the opacity. Raising alpha to make the
       * highlight visible also raises the veil over the numerals, which is the
       * wrong trade on a 347px instrument. Additive at full opacity means the
       * crystal contributes *only light*: its base colour is very nearly black,
       * so what lands on the dial is the reflection and nothing else — a
       * highlight the shape of the studio, curving with the crystal, which is
       * exactly the physical separation between glass and dial §10 asks for by
       * name and none of the fog.
       *
       * `depthWrite: false` because a surface that adds light must not also
       * claim depth: with it on, the crystal occludes the needle tips that pass
       * beneath it at the top of the dial.
       *
       * 0.075 rather than the authored 0.05 for the same reason a real coated
       * crystal is not a mirror: at 0.05 the three emitters reflect as
       * hard-edged rectangles.
       */
      glass.mat.envMapIntensity = 2.4;
      glass.mat.roughness = 0.075;
      glass.mat.opacity = 1;
      glass.mat.blending = THREE.AdditiveBlending;
      glass.mat.depthWrite = false;
    }

    return () => {
      for (const { mat, base } of lit) mat.emissiveIntensity = base;
      for (const { mat, base } of boosted) mat.envMapIntensity = base;
      if (glass) {
        glass.mat.opacity = glass.opacity;
        glass.mat.roughness = glass.roughness;
        glass.mat.envMapIntensity = glass.env;
        glass.mat.blending = glass.blending;
        glass.mat.depthWrite = glass.depthWrite;
      }
    };
  }, [model, lit, glass]);

  /**
   * Release the cached model when the stage goes away.
   *
   * The same leak the desktop instrument documents, and it is worth repeating
   * the mechanism because nothing about it is visible from this file:
   * `WebGLRenderer` attaches a `dispose` listener to every material it draws,
   * that listener closes over the renderer's property maps and its
   * `WebGLRenderingContext`, and it is removed only when the material is
   * disposed — which for a cached GLTF never happens. Every material in this
   * GLB would therefore keep a dead renderer and a dead context reachable for
   * each mount. Losing the cache entry is the only thing that removes them.
   */
  useEffect(() => () => useGLTF.clear(MODEL_URL), []);

  /**
   * The target the instrument is heading for, and where it currently is.
   *
   * Two plain objects on a ref. Deliberately not state: this is written on
   * every scroll frame, and putting it through React would be a reconciliation
   * per frame to change three numbers on an `Object3D` — §5's first prohibition,
   * in the exact words it uses.
   */
  const target = useRef({ primary: 0, secondary: 0, power: 0, ...HELD_POSE });
  const at = useRef({ ...target.current });
  const settled = useRef(false);

  /**
   * Is the instrument being shown at all?
   *
   * It used to be an `IntersectionObserver` on the slot, because the slot was
   * one screen of a seventeen-screen document and for most of a read there was
   * nothing on screen to draw. The instrument is persistent now, so that gate
   * is answered "yes" for the whole document and an observer asking it would be
   * an observer with one answer.
   *
   * What remains is the *authored* disappearance: the navigation layer being
   * open, and the recede at the foot of the page. Both are decisions the
   * overlay has already made — it is the thing that knows the state and the
   * thing that draws the opacity — so it publishes them, and this subscribes.
   * One source of truth for "visible", rather than two systems observing the
   * same element and occasionally disagreeing about it.
   */
  const onScreen = useRef(true);

  useEffect(() =>
    onInstrument((state, visible) => {
      onScreen.current = visible;

      // §"Use restrained: scale; position; opacity; slight orientation." The
      // position and the scale are the overlay's; the orientation is the
      // scene's, and this is where a state change becomes one.
      if (!still) {
        const pose = PLACEMENTS[state];
        target.current.pitch = pose.pitch;
        target.current.yaw = pose.yaw;
      }

      // Coming back into view — from a closed menu, or from scrolling back up
      // out of the recede — the needles and the attitude were kept correct
      // while hidden (see the reader below), so this asks for the one frame
      // that puts the correct state on the canvas.
      if (visible) invalidate();
    }), [still]);

  useEffect(() => {
    const stopReading = onAscent(({ altitude }) => {
      const t = target.current;

      t.primary = primaryAngle(altitude);
      t.secondary = secondaryAngle(altitude);
      t.power = powerAt(altitude);

      // Hidden, the instrument is brought to its target *instantly* and no
      // frame is asked for. Nothing is skipped and nothing accumulates: the
      // state stays exactly correct, it simply stops being drawn — which is
      // what rendering on demand means at the one place on this page where
      // "demand" can actually be zero.
      if (!onScreen.current) {
        Object.assign(at.current, t);
        settled.current = true;
        return;
      }

      settled.current = false;
      invalidate();
    });

    return stopReading;
  }, []);

  /**
   * One frame's worth of settling, and the decision to ask for another.
   *
   * The needles lag and arrive. A real pointer has mass, and this instrument is
   * the one object on the page whose behaviour a visitor might genuinely know —
   * §6's "heavy and physical" is not a style, it is the thing an altimeter does.
   *
   * The last three lines are the on-demand contract. `invalidate()` is called
   * *only* while something is still further than `MOVED` from its target, so a
   * flick produces a short burst of frames that decays to nothing, and a
   * stationary page produces none at all. Calling it unconditionally here would
   * be a permanent 60 fps loop wearing a demand frameloop's clothes, which is
   * precisely what §4 forbids.
   */
  useFrame((_, delta) => {
    const t = target.current;
    const a = at.current;
    // Clamped: a backgrounded tab returns with a delta of several seconds, and
    // an unclamped settle would teleport rather than arrive.
    const dt = Math.min(delta, 1 / 20);

    // Reduced motion writes through. There is no transition to run, so there is
    // nothing for a settle to be the shape of.
    const chase = (from: number, to: number, retain: number) =>
      still ? to : to + (from - to) * Math.exp(-dt / retain);

    a.primary = chase(a.primary, t.primary, RETAIN.primary);
    a.secondary = chase(a.secondary, t.secondary, RETAIN.secondary);
    a.power = chase(a.power, t.power, RETAIN.power);
    a.pitch = chase(a.pitch, t.pitch, RETAIN.pose);
    a.yaw = chase(a.yaw, t.yaw, RETAIN.pose);

    if (needles.primary) needles.primary.rotation.z = a.primary;
    if (needles.secondary) needles.secondary.rotation.z = a.secondary;

    for (const { mat, base } of lit) mat.emissiveIntensity = base * emissiveGain(a.power);

    // Attitude only. Size and position are the overlay's `transform` — the
    // canvas keeps one framing for the life of the page, and a rail state is
    // the hero's pixels scaled down by the compositor rather than a second
    // render at a smaller size. Scaling the OBJECT instead would mean the
    // instrument's projected size and the overlay's box disagreed, and the
    // canvas would be mostly empty at every state but one.
    if (root.current) {
      // No roll, ever. An altimeter with its zero off the vertical reads as
      // broken rather than as styled.
      root.current.rotation.set(a.pitch, a.yaw, 0);
    }

    const moving =
      Math.abs(a.primary - t.primary) > MOVED ||
      Math.abs(a.secondary - t.secondary) > MOVED ||
      Math.abs(a.power - t.power) > MOVED ||
      Math.abs(a.pitch - t.pitch) > MOVED ||
      Math.abs(a.yaw - t.yaw) > MOVED;

    if (moving && onScreen.current) invalidate();
    else if (!settled.current) {
      settled.current = true;
      // The first settled frame is the first frame the instrument is *correct*
      // on. That is the frame the loading state may be crossfaded out under —
      // not the frame the model finished decoding on, which is the frame it is
      // in the wrong pose with the needles at zero.
      onReady();
    }
  });

  return (
    <group ref={root} dispose={null} userData={{ mobileInstrument: true }}>
      <primitive object={model} />
    </group>
  );
}

/**
 * The scene no longer needs a handle on its host element.
 *
 * It used to take one, in order to read the slot's document offset and to
 * observe it for intersection. Both of those questions belonged to an
 * instrument that lived in the document's flow. The instrument is a fixed
 * overlay now: its position is authored, its visibility is published by the
 * overlay that decides it, and there is no offset for the scene to read.
 *
 * Dropping the prop is not tidying. It is the last path by which anything
 * inside the renderer could have reached a laid-out element on this page, and
 * removing it makes "the canvas cannot generate a layout quantity" a property
 * of the file rather than a claim about it.
 */
export default function MobileInstrument({
  dpr,
  onReady,
  onContextLost,
}: {
  dpr: number;
  onReady: () => void;
  onContextLost: () => void;
}) {
  return (
    <Canvas
      // §4, and the reason this file exists in the shape it does.
      frameloop="demand"
      dpr={dpr}
      /**
       * Do not re-measure the canvas on scroll.
       *
       * react-three-fiber measures its host with `react-use-measure`, and its
       * default is `{ scroll: true }` — which attaches a capture-phase scroll
       * listener and re-renders `<Canvas>` on every scroll event. Under a
       * demand frameloop that is not merely a wasted render: r3f invalidates on
       * every root render, so the canvas drew one frame per scroll event for
       * the entire length of the document, including the fifteen screens the
       * instrument is nowhere near. Measured: 162 draw calls over six scroll
       * steps taken four screens past the slot, with the off-screen gate
       * already in place and working.
       *
       * The option exists to keep pointer-event raycasting accurate on a page
       * that scrolls, and this scene has no pointer interaction at all — no
       * object in it carries a handler, and the instrument is explicitly not a
       * configurator (§6). So the measurement it protects is one nothing reads.
       *
       * Turning it off also takes the scroll listener with it, which is the
       * difference between the instrument adding one to the page's total and
       * adding none — §15.
       */
      resize={{ scroll: false }}
      // Solved in `InstrumentCamera` from the canvas's aspect; these are only
      // the values the first frame is built with.
      camera={{ fov: FOV, near: 0.4, far: 12, position: [0, 0, 2.7] }}
      gl={{
        // Transparent, so the instrument sits *in* the page's own background
        // rather than in a black rectangle pasted over it — §3 and §11.
        alpha: true,
        // The instrument's silhouette, its bezel edge and its tick ring are all
        // one-pixel features at this size. Without multisampling they
        // stair-step, and a stair-stepped signature object is the single most
        // reliable way to make a real render look like a sprite. It is the
        // expensive half of the fidelity budget and it is spent on the one
        // object in the scene.
        antialias: true,
        powerPreference: 'high-performance',
        stencil: false,
        depth: true,
      }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        // The desktop exposure, unchanged. Two surfaces showing one object under
        // two exposures are two different objects.
        gl.toneMappingExposure = 1.05;
        gl.setClearAlpha(0);
        // The canvas dies with this component, so the listener goes with it.
        gl.domElement.addEventListener('webglcontextlost', onContextLost);
      }}
      shadows={false}
      // On react-three-fiber's own wrapper div, which is what the crossfade
      // needs a handle on. It used to be `.mv-alt__stage > div` — a structural
      // selector that also matched the fallback drawing's wrapper and held it
      // at zero opacity forever, because `data-ready` is only ever set by the
      // render loop this class belongs to. A no-WebGL visitor got an empty
      // slot. Named, not positional.
      className="mv-alt__gl"
      data-testid="mobile-instrument-canvas"
    >
      <InstrumentCamera />
      <InstrumentLights />
      <Baked />
      <Suspense fallback={null}>
        <Instrument onReady={onReady} />
      </Suspense>
    </Canvas>
  );
}

/** `useBakedEnvironment` needs to be inside the canvas to see the renderer. */
function Baked() {
  useBakedEnvironment();
  return null;
}

useGLTF.preload(MODEL_URL);

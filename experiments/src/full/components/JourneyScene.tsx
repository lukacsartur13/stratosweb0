import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import type { Frameloop } from './QualityManager';
import { Environment, Lightformer } from '@react-three/drei';
import * as THREE from 'three';
import { prefersReducedMotion, renderScale } from '@/lib/capabilities';
import { journey, type MountainMode } from '../journey';
import { readFit } from '../composition';
import type { CloudViewport } from '../cloud';
import { CloudDeck } from './CloudDeck';
import { EarthLimb } from './EarthLimb';
import { AltimeterMeridian } from './AltimeterMeridian';
import { JourneyCamera } from './JourneyCamera';
import { MeridianLights } from './MeridianLights';
import { QualityManager } from './QualityManager';
import { Sky } from './Sky';
import { StarField } from './StarField';
import { MountainRange } from './MountainRange';

/**
 * The WebGL half of the full journey, in its own module so it can be code-split.
 *
 * Nothing above this file imports `three`. That single rule is what lets the
 * reduced-motion, no-WebGL and low-capability paths skip the renderer entirely
 * rather than download 600 KB of it and decline to use it — and it is asserted
 * by the test suite, because it is the kind of invariant that a stray
 * convenience import breaks silently.
 */

/**
 * Mount a stage's geometry only while the journey is near it.
 *
 * Everything in this scene is cheap to *have* and not free to *render*: nine
 * ring nodes and a 64-segment Earth cost nothing at 1 200 m except a matrix
 * update and a frustum test each, but they also gain nothing, and on a phone a
 * few dozen unnecessary objects per frame is real. The hysteresis band matters
 * more than the saving: without it a visitor parked exactly on a boundary
 * toggles a mount every frame, which is far worse than never unmounting at all.
 */
function useNearAltitude(from: number, to: number, margin = 2_500) {
  const [near, setNear] = useState(false);
  const state = useRef(false);

  useFrame(() => {
    const m = journey.altitude;
    // Asymmetric bounds: enter early, leave late.
    const inside = state.current
      ? m > from - margin * 1.6 && m < to + margin * 1.6
      : m > from - margin && m < to + margin;
    if (inside !== state.current) {
      state.current = inside;
      setNear(inside);
    }
  });

  return near;
}

/**
 * The mountain range's residency, including the benchmark override.
 *
 * `forced-on` has to reach the *mount* and not only the draw, because the range
 * is unmounted above 13 600 m and a benchmark arm that asks for mountains at
 * 20 000 m would otherwise get a component that is not there. `forced-off`
 * deliberately does not un-mount: keeping the asset resident is what makes an
 * interleaved A/B/A/B run measure a toggle rather than a DRACO decode.
 */
function useMountainMode(): MountainMode {
  const [mode, setMode] = useState<MountainMode>(journey.debug.mountains);
  useFrame(() => {
    if (journey.debug.mountains !== mode) setMode(journey.debug.mountains);
  });
  return mode;
}

/*
 * THE TWO CHAPTER DIAGRAMS ARE GONE — §6 and §45 of the continuity brief.
 *
 * `SystemRings` mounted three concentric rings and nine nodes between 17 000
 * and 22 000 m, and `Checkpoints` mounted seven progress markers between
 * 22 000 and 25 500 m. Both were built for the chapter they sat behind, and
 * both are on §6's list twice over: concentric circles, orbit diagrams,
 * HUD-like annotations, old chapter markers.
 *
 * §45 is the sharper reason. The background must not announce a chapter — no
 * "the picture changes because we have entered a new section" — and a diagram
 * that mounts because the visitor crossed an altitude is that announcement
 * made in geometry. It was also the loudest object in the two frames this
 * phase exists to quieten: the ring's ellipse ran across the whole width
 * behind `Kilenc terület, három rétegben.`, which is exactly the "decorative
 * geometry" §11 forbids around the recomposed structure.
 *
 * §35 asks what else the code served before it is deleted. These two served
 * nothing else: no progress state, no accessibility, no history, no marker,
 * no mobile path. Every word they illustrated is in the passage under them, in
 * the document, announced — see `PassageSystem` and `PassageProcess`.
 *
 * What replaces them is nothing. The sky, the wash and the typography carry
 * these two chapters, which is §17's ascent communicated through atmosphere and
 * statement arrival rather than through more objects.
 */
function StagedGeometry({ simplified }: { simplified: boolean }) {
  const nearSpace = useNearAltitude(24_000, 30_000, 3_000);

  // The range exists from the ground to just past the cloud pass and nowhere
  // else, so it is mounted on the same rule as everything else here rather than
  // being left resident and merely hidden for the upper two thirds of the
  // journey. The margin is asymmetric by construction — `useNearAltitude`
  // leaves late — and `mountainStateAt` has already faded the geometry to zero
  // opacity well below this boundary, so the unmount is never the thing a
  // visitor sees. That split is what keeps the *picture* a pure function of
  // altitude while the *residency* is allowed hysteresis.
  const mountainMode = useMountainMode();
  const nearMountains = useNearAltitude(0, 12_400, 1_200) || mountainMode === 'forced-on';

  return (
    <>
      {nearMountains && <MountainRange />}
      {nearSpace && (
        <>
          <StarField simplified={simplified} />
          <EarthLimb simplified={simplified} />
        </>
      )}
    </>
  );
}

/**
 * Publishes the renderer's own objects to the development handle.
 *
 * `main.tsx` puts the two singletons on `__stratos`; this adds the scene, the
 * camera and the WebGL renderer to the same place. That is what lets a script
 * ask where the Meridian actually lands on screen, and whether anything is
 * drawn in front of it, instead of inferring both from a screenshot.
 *
 * The Blender safe zone is a *source composition* guide — it constrains where
 * masses were authored, under Blender's camera. Whether the instrument is
 * clear in the browser depends on this camera, this viewport and this aspect
 * ratio, so it has to be measured here or not claimed at all.
 *
 * `import.meta.env.DEV` is statically replaced, so neither this component nor
 * its assignment survives a production build — the same rule the debug panel
 * and the `__stratos` handle already follow.
 */
function DevSceneHandle() {
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);

  useEffect(() => {
    // Create-or-merge, for the same reason main.tsx merges: this effect and the
    // dynamic import that publishes the singletons race, and either can be
    // first. Reassigning through the property rather than mutating in place
    // matters too — the screenshot scripts install an accessor on `__stratos`
    // to freeze idle ring rotation the moment the handle appears, and a
    // mutation would never trip it.
    const g = globalThis as { __stratos?: Record<string, unknown> };
    g.__stratos = { ...(g.__stratos ?? {}), scene, camera, gl, three: THREE };
    return () => {
      const h = g.__stratos;
      if (h) delete h.scene;
    };
  }, [scene, camera, gl]);

  return null;
}

export default function JourneyScene({
  simplified,
  parallax,
  onContextLost,
}: {
  simplified: boolean;
  parallax: boolean;
  onContextLost: () => void;
}) {
  // Owned here rather than inside QualityManager because `<Canvas>` re-asserts
  // this prop on every render — see the long note in QualityManager. Passing it
  // down as a prop is the only way the parked state survives a scroll.
  const [frameloop, setFrameloop] = useState<Frameloop>('always');

  // The effective device pixel ratio, owned here for exactly the same reason and
  // by exactly the same mechanism. `configure()` runs in a layout effect with no
  // dependency array and ends with
  //
  //     if (dpr && state.viewport.dpr !== calculateDpr(dpr)) state.setDpr(dpr)
  //
  // so an imperative `setDpr` is undone by the next `<Canvas>` render — and
  // `<Canvas>` measures itself with `useMeasure({ scroll: true })`, on a page
  // whose entire interaction is scrolling. The old code called `setDpr` from a
  // `PerformanceMonitor` inside the canvas and was silently reverted on the next
  // scroll, then called again on the next decline. That is the resolution
  // pumping §4 forbids, and it was invisible because both halves worked.
  //
  // Held as a number, not a `[min, max]` tuple: a tuple is re-derived from the
  // hardware ratio on every render, so it can only ever say "clamp the device",
  // never "this is the ratio we chose".
  const [dpr, setDpr] = useState(() => renderScale().start);

  // `devicePixelRatio` is not a constant. Browser zoom changes it, and the
  // policy clamps to it, so a ratio latched at mount is the wrong one after a
  // visitor zooms out — the canvas would keep a buffer denser than the screen it
  // is being shown on, which is the mirror image of the defect being fixed here.
  // §10 lists zoom, orientation and address-bar collapse together for this
  // reason; the renderer's own size comes from react-three-fiber's
  // `ResizeObserver`, but the *ratio* is ours and has to be re-derived.
  //
  // Only ever *raises* back to the policy's start, and only while the ladder has
  // not stepped down — `stepDown` below owns the downward direction, so a resize
  // can never undo a decision the frame budget made. §3: one writer per
  // direction.
  const stepped = useRef(false);

  // The measured viewport the cloud composition is art-directed against (§11).
  //
  // Read here rather than inside `CloudDeck` because this is where the resize,
  // orientation and pixel-ratio listeners already are, and a second set of them
  // watching the same three events is a second thing to keep in step. `readFit`
  // is called rather than `currentFit` because the fit `composition.ts` caches is
  // refreshed on its own schedule and a cloud composition one frame behind an
  // orientation change is a visible reflow of the sky.
  const [cloudViewport, setCloudViewport] = useState<CloudViewport>(() => readFit());

  // Reduced motion is latched at mount, not watched. The scene does not exist
  // under `prefers-reduced-motion: reduce` at all — `detect()` returns a
  // capability failure and `FullAscent` renders the static fallback instead of
  // this component — so this is only ever `false` in practice. It is plumbed
  // through regardless so that `getCloudState`'s contract holds for the sweep,
  // which calls it directly with `reducedMotion: true` and asserts a static
  // deterministic result (§26).
  const reducedMotion = useMemo(() => prefersReducedMotion(), []);

  useEffect(() => {
    let dppx: MediaQueryList | null = null;

    const sync = () => {
      if (!stepped.current) {
        const next = renderScale().start;
        setDpr((current) => (current === next ? current : next));
      }
      // Re-art-direct the clouds on the same signal. `layoutFor` is generated
      // once at the maximum count and re-sliced, so a viewport change re-frames
      // one fixed sky rather than authoring a new one — §8's "no cloud should
      // visibly jump when the viewport resizes or the orientation changes".
      setCloudViewport((current) => {
        const next = readFit();
        return current.vw === next.vw && current.vh === next.vh ? current : next;
      });
      watch();
    };

    // `resize` covers zoom in the browsers that reflow the CSS viewport when a
    // visitor zooms, which is most of them, and it is what fires when a device
    // metrics override is cleared — both measured. It does not cover a ratio
    // that moves while the CSS viewport stays put, so the ratio is also watched
    // directly. There is no `devicePixelRatio` change event; a `dppx` query
    // pinned to the current value, re-pinned each time it fires, is the way this
    // is done.
    const watch = () => {
      dppx?.removeEventListener('change', sync);
      if (typeof matchMedia !== 'function') return;
      dppx = matchMedia(`(resolution: ${devicePixelRatio}dppx)`);
      dppx.addEventListener('change', sync);
    };
    watch();

    addEventListener('resize', sync);
    addEventListener('orientationchange', sync);
    return () => {
      dppx?.removeEventListener('change', sync);
      removeEventListener('resize', sync);
      removeEventListener('orientationchange', sync);
    };
  }, []);

  // One way, never back up — and now a *ladder of two rungs* rather than one
  // step, because §12 fixes the order quality is spent in and the instrument is
  // last on that list, not first.
  //
  // The Phase 6.5 policy is unchanged: `renderScale()` still owns both numbers,
  // there is still exactly one canonical writer of the renderer's ratio, and the
  // floor is still the floor. What changes is *when* the second rung is reached.
  // Previously the first sustained decline went straight to the pixel ratio,
  // which meant the very first thing a struggling device gave up was the
  // Meridian's sharpness — the one thing §12 says to give up last. Now:
  //
  //   rung 1  cloud layer count and cloud sampling  (`CLOUD_STEP_DOWN_SCALE`,
  //           and 256 -> 128 on the texture; see `getCloudState`)
  //   rung 2  the pixel ratio, to the policy floor and no further
  //
  // A device that recovers after rung 1 never reaches rung 2, so the common
  // case is now that the instrument keeps its accepted quality floor and the
  // clouds pay for the frame instead. `PerformanceMonitor`'s own sustained
  // average and `flipflops` remain the hysteresis between the two, so neither
  // rung can be reached by a single slow frame — §12's "use hysteresis", and
  // the reason neither rung produces visible resolution pumping.
  const [cloudStepped, setCloudStepped] = useState(false);

  /**
   * Which rung the ladder is on. A ref, not state, and deliberately.
   *
   * The rung is written from a `PerformanceMonitor` callback, is never read
   * during render, and must advance exactly once per call. Deriving it from the
   * `cloudStepped` updater instead — which is what this was — meant performing
   * rung 2's side effects *inside* a state updater: `setDpr` and a ref
   * mutation, in a function React is entitled to replay and which StrictMode
   * (see `main.tsx`) does replay on every call. It happened to survive that only
   * because a second ref guard made the replay idempotent, which is a way of
   * saying the updater was impure and the impurity had been papered over.
   *
   * A ref advanced in an event callback is the same ladder with none of that:
   * the two `set*` calls are ordinary event-handler updates, and the guard is
   * the rung itself rather than a second variable that has to agree with it.
   */
  const rung = useRef(0);
  const stepDown = useCallback(() => {
    // A validation run pins the ladder so it measures the scene rather than the
    // rasteriser it happens to be running on. Production never sets this; see
    // `journey.debug.cloudPinQuality`.
    if (journey.debug.cloudPinQuality) return;
    if (rung.current >= 2) return;
    rung.current += 1;

    if (rung.current === 1) {
      // Rung 1 — cloud layer count and cloud sampling. §12's first two items.
      setCloudStepped(true);
      return;
    }
    // Rung 2 — the pixel ratio, to the policy floor and no further. Reached
    // only by a second decline, so a device that recovers after rung 1 keeps
    // the instrument's accepted quality floor.
    stepped.current = true;
    setDpr(renderScale().floor);
  }, []);

  return (
    <Canvas
      frameloop={frameloop}
      dpr={dpr}
      // The far plane is 60, not 30 000. See JourneyCamera: the world moves
      // past a nearly stationary camera precisely so this number can stay small
      // and every surface in the scene can keep its depth precision.
      camera={{ fov: 32, near: 0.1, far: 60, position: [0, -0.1, 2.35] }}
      gl={{
        // Intentional, and intentionally not conditional on the tier. It used to
        // be `!simplified`, which meant every handheld — the entire population
        // this scene is hardest on — created its context with multisampling
        // switched off, on top of a 1.5x buffer. The instrument's silhouette,
        // its tick ring and its aperture edge are all one-pixel features at that
        // size, and there was nothing left to resolve them with.
        //
        // The context reports MAX_SAMPLES 4 on every device measured, and
        // `gl.getParameter(gl.SAMPLES)` reads back 4 on the live context, so this
        // is real 4x MSAA and not a request the driver quietly ignored.
        //
        // It is not free, and it is the expensive half of this fix: measured on
        // the reference GPU, going 1.5x -> 2x cost 10% of the frame and adding
        // MSAA on top cost another 77%. Both were kept because the crops show
        // both were needed — the resolution is what makes the engraved face text
        // resolve, the multisampling is what makes the silhouette and the thin
        // orbital rings stop stair-stepping. §9's order was followed: the
        // drawing buffer was corrected first and this is the second half of the
        // same fix, not a post-processing pass hiding an undersized buffer.
        antialias: true,
        powerPreference: 'high-performance',
        alpha: false,
        stencil: false,
        depth: true,
      }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        // 1.05 -> 0.95. §O of the master study: the restrained presentation is
        // a slightly lower exposure with the separation handed to a rim, rather
        // than a brighter object. See MeridianLights.
        gl.toneMappingExposure = 1.0;
        gl.setClearColor('#04060a', 1);
      }}
      // No shadow map anywhere in the journey. One hero object that lights
      // itself does not need a second depth pass, and on a phone that pass is
      // the entire budget.
      shadows={false}
      data-testid="journey-canvas"
    >
      <JourneyCamera parallax={parallax} />
      <QualityManager onContextLost={onContextLost} onFrameloop={setFrameloop} onStepDown={stepDown} />
      {import.meta.env.DEV && <DevSceneHandle />}

      {/* The sky is the backdrop for all eleven stages and is never unmounted:
          it is one draw call and it is what the other layers are composited
          against. */}
      <Sky simplified={simplified} />

      {/* Lighting is authored here, not imported. The GLB carries no lights and
          no HDRI is fetched — the environment below is built from flat emitters
          inside the scene, so the instrument's metal has something to reflect
          without a byte crossing the network.

          The intensities are altitude-driven and live in MeridianLights: the
          breakthrough at 12 000 m and the Meridian state at 30 000 m are both
          lighting events, and a fixed key light gave neither of them anything
          to do. The environment probe below stays static — it is baked once and
          it is what the metal reflects, not what lights it. */}
      <MeridianLights simplified={simplified} />

      <Suspense fallback={null}>
        <Environment resolution={simplified ? 64 : 128} frames={1}>
          <Lightformer form="rect" intensity={2.6} position={[-2.2, 2.4, 2.0]} scale={[5, 5, 1]} color="#dce8f7" />
          <Lightformer form="rect" intensity={1.1} position={[2.8, 0.4, 1.2]} scale={[3, 6, 1]} color="#7f96b5" />
{/* The lower ring — investigated under §25's "environment reflection"
              and left exactly as it was. Raising it from 0.7 to 1.5 moved the
              arrival's measured ink share by 0.2 points, which is noise, and it
              is the only lever in that section's list that is shared with Act
              I's protected frame. See `MeridianLights`. */}
          
          <Lightformer form="ring" intensity={0.7} position={[0, -2.4, 1.6]} scale={[4, 4, 1]} color="#2b3446" />
        </Environment>

        <AltimeterMeridian simplified={simplified} />
      </Suspense>

      <CloudDeck
        simplified={simplified}
        viewport={cloudViewport}
        reducedMotion={reducedMotion}
        stepped={cloudStepped}
      />
      <StagedGeometry simplified={simplified} />
    </Canvas>
  );
}

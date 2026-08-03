import { useEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { Group, Mesh } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { journey } from '../journey';
import { MOUNTAIN_SCALE, ZERO_NUDGE, mountainRootTransform, mountainStateAt } from '../mountains';
import {
  applyLook,
  createMountainMaterials,
  lookFor,
  type MountainMaterials,
} from './mountainMaterial';
import {
  DRACO_PATH,
  MOUNTAIN_DECODER,
  MOUNTAIN_URL,
  readSignals,
  shouldSwitch,
  variantFor,
  type MountainVariant,
} from '../mountainAsset';

/**
 * The Blender mountain range, inside the Meridian's renderer.
 *
 * ## One renderer, one clock, one lifecycle
 *
 * This is a component in the existing `<Canvas>`, not a second WebGL context.
 * It has no render loop of its own — it reads `journey.altitude` inside the
 * scene's `useFrame`, the same number the instrument, the camera, the cloud
 * deck and the readout all derive from. It is unmounted by the same visibility
 * rules as everything else, and it disposes into the same renderer.
 *
 * ## Why the loader is built here rather than through `useGLTF`
 *
 * `AltimeterMeridian` uses drei's `useGLTF`, which is right for it: one asset,
 * loaded once, cached for the life of the page. These two are different. There
 * are two of them, only one is ever wanted, the choice is made at runtime, and
 * the losing one must never be fetched — so the cache that makes `useGLTF`
 * convenient is the thing that would keep a 345 KB desktop asset resident on a
 * phone that switched to portrait. Owning the loader means owning the dispose.
 *
 * ## DRACO
 *
 * Both GLBs declare `KHR_draco_mesh_compression` in `extensionsRequired`. The
 * decoder is served from this origin under `/draco/`, never from a CDN, and it
 * is the JavaScript build rather than the WebAssembly one — see
 * `MOUNTAIN_DECODER` and the CSP block in netlify.toml for the measurements
 * behind that. `worker-src 'self' blob:` is what makes either of them run at
 * all; without it `loadAsync` hangs rather than failing, which is why this
 * component treats a slow load as a real outcome and not an impossible one.
 */

/** One decoder for the page, disposed when the last range unmounts. */
let dracoRefCount = 0;
let dracoShared: DRACOLoader | null = null;

function acquireDraco(): DRACOLoader {
  if (!dracoShared) {
    dracoShared = new DRACOLoader();
    dracoShared.setDecoderPath(DRACO_PATH);
    dracoShared.setDecoderConfig({ type: MOUNTAIN_DECODER });
  }
  dracoRefCount++;
  return dracoShared;
}

function releaseDraco(): void {
  dracoRefCount = Math.max(0, dracoRefCount - 1);
  if (dracoRefCount === 0 && dracoShared) {
    // Terminates the worker and drops the decoder module. The next acquire
    // rebuilds both, which costs one decode's worth of startup and is the
    // correct trade for not leaving a worker alive on a page that has finished
    // with the mountains.
    dracoShared.dispose();
    dracoShared = null;
  }
}

/**
 * Everything a loaded range owns, so disposal is a list rather than a traversal
 * that has to be right.
 */
type Loaded = {
  variant: MountainVariant;
  scene: Group;
  geometries: THREE.BufferGeometry[];
  materials: MountainMaterials;
  /** Non-null only if the GLB ever gains a texture. Today it has none. */
  textures: THREE.Texture[];
  triangles: number;
};

/**
 * Which of the two materials a node gets.
 *
 * The only classification left in this file, and it is a two-way one: the
 * ascent route, and everything else. There used to be a four-entry palette
 * keyed on the GLB's material names, and it was the wrong key — `CLOUD_PEAK_L`
 * and `MNT_FOREGROUND_L` both carry `MAT_ROCK_GRAPHITE` while sitting three
 * kilometres apart in depth, so a name-keyed palette could not express the one
 * distinction the picture actually needed. Depth is now read per fragment from
 * the camera distance instead, which grades a single mesh across the whole
 * scene and cannot produce the paper cut-out banding a per-node bucket does.
 */
const isRoute = (materialName: string, nodeName: string) =>
  materialName === 'MAT_ROUTE_ACCENT' || nodeName === 'ASCENT_ROUTE';

/*
 * No `simplified` prop, unlike every other component in this scene.
 *
 * The quality tier already picked the asset: `reducedTier` is one of the inputs
 * to `mobileScore`, and the mobile GLB is the reduced build — 48 336 triangles
 * against 131 884, in a composition authored for the frame it will be seen in.
 * A second quality switch on top of that would be deciding the same thing
 * twice, and the two could disagree.
 */
export function MountainRange() {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);

  const [variant, setVariant] = useState<MountainVariant>(() => variantFor(readSignals()));
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const group = useRef<Group>(null);

  // --- asset selection, with hysteresis ------------------------------------
  useEffect(() => {
    let frame = 0;
    const reconsider = () => {
      cancelAnimationFrame(frame);
      // One frame of coalescing: an orientation change fires resize several
      // times, and a phone's address bar fires it on every scroll tick.
      frame = requestAnimationFrame(() => {
        setVariant((current) => shouldSwitch(current, readSignals()));
      });
    };
    addEventListener('resize', reconsider);
    addEventListener('orientationchange', reconsider);
    return () => {
      cancelAnimationFrame(frame);
      removeEventListener('resize', reconsider);
      removeEventListener('orientationchange', reconsider);
    };
  }, []);

  // --- load, and dispose the previous --------------------------------------
  useEffect(() => {
    let cancelled = false;
    const draco = acquireDraco();
    const loader = new GLTFLoader();
    loader.setDRACOLoader(draco);

    const started = performance.now();
    loader.load(
      MOUNTAIN_URL[variant],
      (gltf) => {
        if (cancelled) {
          disposeTree(gltf.scene);
          return;
        }
        const geometries: THREE.BufferGeometry[] = [];
        const textures: THREE.Texture[] = [];
        const materials = createMountainMaterials(variant, MOUNTAIN_SCALE);
        let triangles = 0;

        gltf.scene.traverse((o) => {
          const mesh = o as Mesh;
          if (!mesh.isMesh) return;

          geometries.push(mesh.geometry);
          const index = mesh.geometry.index;
          triangles += index ? index.count / 3 : mesh.geometry.attributes.position.count / 3;

          // The exported material is replaced rather than tweaked: it carries
          // Blender's preview shading, which was authored for a Cycles render
          // and has nothing to do with this scene's lighting.
          const source = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
          const name = source?.name ?? '';
          source?.dispose?.();

          // Two shared instances rather than one new material per mesh. The
          // previous code built sixteen, which three deduplicated down to one
          // program anyway — so the cost was never the shader, it was sixteen
          // copies of the same state to keep in step every frame.
          mesh.material = isRoute(name, mesh.name) ? materials.route : materials.terrain;

          // Static for the whole journey — the group moves, never the meshes.
          mesh.matrixAutoUpdate = false;
          mesh.updateMatrix();
          mesh.castShadow = false;
          mesh.receiveShadow = false;
        });

        setLoaded({ variant, scene: gltf.scene, geometries, materials, textures, triangles });

        if (import.meta.env.DEV) {
          // eslint-disable-next-line no-console
          console.info(
            `[mountains] ${variant}: ${triangles.toLocaleString('en-GB')} triangles, ` +
              `${materials.all.length} materials, ${Math.round(performance.now() - started)} ms to attach`
          );
        }
      },
      undefined,
      (err) => {
        // A DRACO failure under a policy without worker-src blob: does not
        // arrive here — it never arrives at all. This handler is for the
        // errors that do: a 404, a truncated file, a decode fault.
        if (import.meta.env.DEV) console.error('[mountains] load failed', err);
      }
    );

    return () => {
      cancelled = true;
      releaseDraco();
    };
  }, [variant]);

  // Dispose whatever is being replaced, including on unmount. Separate from the
  // loader effect so a variant switch cannot dispose the asset it just loaded.
  useEffect(
    () => () => {
      if (!loaded) return;
      for (const g of loaded.geometries) g.dispose();
      for (const m of loaded.materials.all) m.dispose();
      for (const t of loaded.textures) t.dispose();
      loaded.scene.clear();
      // Frees the GPU-side programs the disposed materials owned. Without it
      // the shader count climbs on every variant switch.
      gl.renderLists.dispose();
    },
    [loaded, gl]
  );

  /*
   * Transform first, visibility last, and no early return in between.
   *
   * The previous order was `g.visible = state.visible; if (!state.visible)
   * return;` before anything was written, which left a hidden root holding
   * either a stale transform or — on a freshly mounted one coming down from
   * above — the world origin. See `mountainRootTransform` for the two ways that
   * goes wrong and why neither of them ever showed up in a still.
   *
   * The cost of dropping the early return is the transform write and one look
   * pass, about thirty scalar uniform writes, on the frames where the range is
   * not drawn. That is bounded: the component is only mounted between 0 and
   * 13 600 m, and inside that band it is hidden for roughly 1 600 m of it.
   * Above the mount threshold this callback does not exist at all, so the fix
   * does not keep anything resident that was not resident before — the mount
   * rule in JourneyScene is untouched.
   */
  useFrame(() => {
    const g = group.current;
    if (!g || !loaded) return;

    const state = mountainStateAt(journey.altitude, loaded.variant, journey.debug.mountains);

    // The art direction, including the route's own fade — see mountainLook.ts.
    // `import.meta.env.DEV` is statically replaced, so a production build hands
    // `null` in and the whole override branch disappears with the panel.
    const debug = import.meta.env.DEV ? journey.debug.mountainLook : null;
    const nudge = debug ? { rise: debug.stationRise, forward: debug.stationForward } : ZERO_NUDGE;

    // The similarity transform about the camera that reproduces Blender's
    // framing exactly. See mountains.ts.
    const root = mountainRootTransform(state, [camera.position.x, camera.position.y, camera.position.z], nudge);
    g.scale.setScalar(root.scale);
    g.position.set(root.position[0], root.position[1], root.position[2]);
    // No rotation is controlled here: the Blender camera carries a 90° X
    // rotation and nothing else, which the axis conversion already accounts
    // for, so the ascent is pure translation. Asserted by the boundary test
    // rather than assumed, because "identical root transform" has to include
    // the quaternion to mean anything.
    g.quaternion.identity();

    applyLook(loaded.materials, lookFor(loaded.variant, debug), state, debug, journey.altitude);

    // Last. Everything above is the canonical state for this altitude; this is
    // the only line that is allowed to depend on whether it will be drawn.
    g.visible = root.visible;
  });

  if (!loaded) return null;
  return (
    // `mountainRoot` is how the validation script tells this subtree from the
    // instrument without matching on mesh names — the Blender node names are a
    // composition detail and renaming one should not silently turn a
    // safe-zone check into a check of nothing. It is plain scene-graph data, so
    // it costs nothing in production and is not a debug-only affordance.
    <group ref={group} userData={{ mountainRoot: true }}>
      <primitive object={loaded.scene} />
    </group>
  );
}

/** Free a subtree that was loaded and then abandoned before it was ever used. */
function disposeTree(root: THREE.Object3D) {
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) m?.dispose?.();
  });
  root.clear();
}

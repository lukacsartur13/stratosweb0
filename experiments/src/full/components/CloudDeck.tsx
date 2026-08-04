import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { journey } from '../journey';
import {
  CLOUD_STOPS,
  type CloudPlane,
  type CloudQualityTier,
  type CloudRole,
  type CloudState,
  type CloudViewport,
  CLOUD_STEP_DOWN_SCALE,
  clearAperture,
  driftAt,
  getCloudState,
  layoutFor,
} from '../cloud';

/**
 * The cloud system, drawn.
 *
 * Every number in here comes from `getCloudState`. This file decides *nothing*
 * about presence, timing, density or layer count — §6 puts all of that in one
 * pure function so that a sweep can compare two altitudes without constructing a
 * renderer, and so that the deck, the mountain fade and the aperture clearance
 * cannot drift apart. What remains here is geometry, materials and lifecycle.
 *
 * ## Three draw calls
 *
 * The deck this replaces built one `<mesh>` per puff: 70 meshes, 70 materials,
 * 70 draw calls, and 70 opacity writes per frame. Each role is now one
 * `InstancedMesh` over a single shared quad, so the whole system is **three draw
 * calls and three materials** whatever the layer count is, and reducing the
 * count is an integer write to `mesh.count` rather than a re-render.
 *
 * Per-plane opacity variation — without which the deck fades as one flat sheet,
 * which is §4's "flat opacity overlay" — comes from a static instanced float
 * attribute multiplied into the fragment alpha. The role's *animated* opacity is
 * the material's own uniform, so nothing is re-uploaded per frame.
 *
 * The shader injection is a string. §3 forbids weakening the CSP, and this does
 * not touch it: `script-src 'self'` governs script execution, and a GLSL source
 * string compiled by the driver is not script. The existing policy comment in
 * `netlify.toml` already records this for the scene's other shaders.
 *
 * ## What is not here
 *
 * No second canvas, no second render loop, no render target, no post-processing
 * pass, no Blender volumetrics, no GLB change and no downloaded texture — §5's
 * prohibitions, all of which the previous deck also respected and none of which
 * this needed to break to reach 12 000 m.
 */

// =============================================================================
// The texture. Rasterised at startup; zero bytes of transfer.
// =============================================================================

/**
 * A soft, irregular cloud form: four octaves of seeded value noise under a
 * radial falloff.
 *
 * The deck this replaces drew four overlapping radial gradients. Four gradients
 * make a shape with four lobes and a smooth, continuous edge — which reads as
 * bokeh, or as foam, both of which §4 names. Noise gives an edge that is
 * irregular at several scales at once, which is the only cheap thing that reads
 * as *cloud* rather than as a soft blob.
 *
 * Seeded, so the texture is byte-identical on every load and the regression
 * screenshots are comparable at all (§8: "Use fixed seeds where procedural
 * variation exists"). `Math.random` here would mean no still could ever be
 * compared with another.
 */
function makeCloudTexture(size: number): THREE.CanvasTexture | null {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  let seed = 0x9e3779b9;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

  // Value noise: a lattice of random values, bilinearly interpolated with a
  // smoothstep fade. Cheap, and its low-frequency character is exactly what §8
  // asks the motion language to be — the texture and the movement agree.
  const lattice = (n: number) => {
    const g = Array.from({ length: (n + 1) * (n + 1) }, rnd);
    return (u: number, v: number) => {
      const x = u * n;
      const y = v * n;
      const x0 = Math.floor(x);
      const y0 = Math.floor(y);
      const fx = x - x0;
      const fy = y - y0;
      const sx = fx * fx * (3 - 2 * fx);
      const sy = fy * fy * (3 - 2 * fy);
      const at = (i: number, j: number) => g[(j % (n + 1)) * (n + 1) + (i % (n + 1))];
      const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
      const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
      return a + (b - a) * sy;
    };
  };

  const octaves = [lattice(3), lattice(6), lattice(12), lattice(24)];
  const gain = [0.5, 0.26, 0.16, 0.08];

  const image = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;

      let n = 0;
      for (let o = 0; o < octaves.length; o++) n += octaves[o](u, v) * gain[o];

      // Radial falloff to zero at the quad's edge. Without it the planes have
      // visible square boundaries, which is the single most obvious way a
      // billboard deck announces itself as billboards.
      const dx = u - 0.5;
      const dy = v - 0.5;
      const r = Math.min(1, Math.hypot(dx, dy) * 2);
      const falloff = 1 - r * r * (3 - 2 * r) * (3 - 2 * r) * 0.25 - r * r * r * 0.75;

      // Carve the interior into distinct masses instead of leaving one even
      // haze — that is what stops the result reading as smoke — but keep enough
      // body that a plane is a cloud rather than a wisp.
      //
      // The threshold was 0.34 with a smoothstep on top, and it was measured
      // wrong: four octaves with gains summing to 1 put `n` at about 0.5 on
      // average, so `(0.5 − 0.34) / 0.66 = 0.24`, and a smoothstep of 0.24 is
      // 0.145. Mean alpha across the quad came out near 0.1, and a deck of
      // 12 such planes at material opacity 0.45 was a haze. Lowering the
      // threshold and taking a gentler shaping curve raises the mean to about
      // 0.4 while keeping the *edges* irregular, which is the part that has to
      // stay noisy.
      const shaped = clamp01((n - 0.18) / 0.55);
      const alpha = clamp01(shaped * (0.45 + 0.55 * shaped) * falloff * 1.5);

      const i = (y * size + x) * 4;
      image.data[i] = 255;
      image.data[i + 1] = 255;
      image.data[i + 2] = 255;
      image.data[i + 3] = Math.round(alpha * 255);
    }
  }
  ctx.putImageData(image, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  // The quads never repeat the texture, and clamping is what guarantees the
  // edge stays at zero alpha under bilinear filtering at grazing angles.
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.needsUpdate = true;
  return tex;
}

// =============================================================================
// The material.
// =============================================================================

/**
 * `MeshBasicMaterial` with per-instance alpha injected.
 *
 * Unlit on purpose. These planes are a *value* in the composition, not a lit
 * surface: the deck's brightness has to be a function of altitude alone, because
 * §7 bounds the brightness shift at the breakthrough ("no white flash", "no
 * full-screen wash", "brightness shift remains restrained") and a lit material
 * would put that under the control of `MeridianLights`, which is animating hard
 * across exactly that altitude for the aperture.
 */
function makeCloudMaterial(map: THREE.Texture | null): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    map: map ?? undefined,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    toneMapped: false,
    side: THREE.DoubleSide,
  });

  material.onBeforeCompile = (shader) => {
    shader.vertexShader =
      'attribute float aWeight;\nvarying float vWeight;\n' +
      shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvWeight = aWeight;');
    shader.fragmentShader =
      'varying float vWeight;\n' +
      shader.fragmentShader.replace(
        '#include <opaque_fragment>',
        '#include <opaque_fragment>\n\tgl_FragColor.a *= vWeight;',
      );
  };
  // Two materials whose `onBeforeCompile` produce the same source still compile
  // twice unless they agree on a cache key. Three roles, one program.
  material.customProgramCacheKey = () => 'stratos-cloud-weighted';

  return material;
}

// =============================================================================
// One role.
// =============================================================================

const UNIT = new THREE.PlaneGeometry(1, 1);
const M4 = new THREE.Matrix4();
const POS = new THREE.Vector3();
const QUAT = new THREE.Quaternion();
const SCALE = new THREE.Vector3();
const EULER = new THREE.Euler();

/** The maximum any role is ever asked for. See `layoutFor` — the layout is
 *  generated once at this size and a lower count renders a prefix of it, which
 *  is what makes a quality step remove planes instead of moving them. */
const MAX_PLANES = 24;

/** How long the one permitted runtime quality step takes to apply. Long enough
 *  to read as the sky thinning, short enough to recover the frame budget. */
const QUALITY_EASE_SECONDS = 0.75;

/** Narrowed so `mesh.material.opacity` is a number rather than `Material |
 *  Material[]`. Each role owns exactly one material. */
type CloudMesh = THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;

type RoleHandle = {
  mesh: CloudMesh;
  planes: CloudPlane[];
  group: THREE.Group;
  /** The live per-plane alpha buffer. Rewritten each frame by `setCount`. */
  weights: Float32Array;
  attribute: THREE.InstancedBufferAttribute;
};

function buildRole(
  role: CloudRole,
  material: THREE.MeshBasicMaterial,
  spread: number,
  depth: number,
  renderOrder: number,
): RoleHandle {
  const planes = layoutFor(role, MAX_PLANES, spread, depth);
  const mesh: CloudMesh = new THREE.InstancedMesh(UNIT, material, MAX_PLANES);
  mesh.frustumCulled = false;
  mesh.renderOrder = renderOrder;
  mesh.count = 0;

  const weights = new Float32Array(MAX_PLANES);
  for (let i = 0; i < MAX_PLANES; i++) weights[i] = planes[i].weight;
  mesh.geometry = UNIT.clone();
  const attribute = new THREE.InstancedBufferAttribute(weights, 1);
  mesh.geometry.setAttribute('aWeight', attribute);

  const group = new THREE.Group();
  group.add(mesh);
  return { mesh, planes, group, weights, attribute };
}

/**
 * Draw `exact` planes, where `exact` is fractional.
 *
 * The whole planes render at their authored weight and the boundary plane at
 * its weight times the remainder, so a role's layer count grows and shrinks
 * continuously instead of a plane snapping into existence at whatever opacity
 * the role currently has. §14's "abrupt layer changes", closed at the level of
 * the individual plane rather than only at the level of the count.
 *
 * Costs one `Float32Array` write per drawn plane per frame — at most 24 — and
 * one buffer re-upload of the same size.
 */
function setCount(handle: RoleHandle, exact: number): number {
  const count = Math.ceil(exact);
  handle.mesh.count = count;
  if (count === 0) return 0;
  for (let i = 0; i < count - 1; i++) handle.weights[i] = handle.planes[i].weight;
  handle.weights[count - 1] = handle.planes[count - 1].weight * (exact - (count - 1));
  handle.attribute.needsUpdate = true;
  return count;
}

/** Write one plane's transform into an instance slot. */
function place(mesh: CloudMesh, i: number, p: CloudPlane, x: number, y: number, flat: boolean) {
  POS.set(x, y, p.z);
  EULER.set(flat ? -Math.PI / 2.1 : 0, 0, p.rotation);
  QUAT.setFromEuler(EULER);
  SCALE.set(p.width, p.height, 1);
  mesh.setMatrixAt(i, M4.compose(POS, QUAT, SCALE));
}

// =============================================================================
// The component.
// =============================================================================

export function CloudDeck({
  simplified,
  viewport,
  reducedMotion,
  stepped,
}: {
  simplified: boolean;
  viewport: CloudViewport;
  reducedMotion: boolean;
  /** The one permitted runtime quality step. §12 spends cloud layers first. */
  stepped: boolean;
}) {
  const tier: CloudQualityTier = simplified ? 'reduced' : 'full';

  // Sampling comes from the canonical state, evaluated once at build time for
  // the texture's sake — it is a function of the tier and the step, neither of
  // which changes without remounting this subtree.
  const sampling = useMemo(
    () =>
      getCloudState(
        { altitude: 0, viewport, qualityTier: tier, reducedMotion },
        stepped ? CLOUD_STEP_DOWN_SCALE : 1,
      ).sampling,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tier, stepped],
  );

  const texture = useMemo(() => makeCloudTexture(sampling), [sampling]);

  const built = useMemo(() => {
    const state = getCloudState(
      { altitude: 0, viewport, qualityTier: tier, reducedMotion },
      stepped ? CLOUD_STEP_DOWN_SCALE : 1,
    );
    const material = makeCloudMaterial(texture);
    // Two more materials so the three roles can hold different tints and
    // opacities. They share one compiled program via `customProgramCacheKey`.
    const distantMat = material.clone();
    const floorMat = material.clone();
    distantMat.customProgramCacheKey = floorMat.customProgramCacheKey = () => 'stratos-cloud-weighted';

    return {
      distant: buildRole('distant', distantMat, state.lateralSpread, state.depth, 6),
      enclosure: buildRole('enclosure', material, state.lateralSpread, state.depth, 8),
      floor: buildRole('floor', floorMat, state.lateralSpread, state.depth, 7),
      materials: [material, distantMat, floorMat],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texture, viewport.vw, viewport.vh, tier, stepped]);

  const root = useRef<THREE.Group>(null);
  const clock = useRef(0);
  // Starts wherever the tier already is, so a remount does not replay the ramp.
  const stepScale = useRef(stepped ? CLOUD_STEP_DOWN_SCALE : 1);
  const tint = useMemo(() => new THREE.Color(), []);

  // §28. Everything constructed above is released here: three materials, three
  // cloned geometries with their instanced attribute, the instanced meshes, and
  // the canvas texture. The shared `UNIT` geometry is module-scoped and is not
  // disposed — it outlives every mount by design and is one geometry, not a leak.
  useEffect(() => {
    const { distant, enclosure, floor, materials } = built;
    return () => {
      for (const handle of [distant, enclosure, floor]) {
        handle.mesh.geometry.dispose();
        handle.mesh.dispose();
      }
      for (const m of materials) m.dispose();
    };
  }, [built]);

  useEffect(() => () => texture?.dispose(), [texture]);

  useFrame((_, dt) => {
    if (!journey.running) return;

    const debug = journey.debug;

    // §8: "No cloud should visibly jump when quality tier changes."
    //
    // The runtime step is a one-way, once-per-session decision, and applying it
    // as a boolean removes 45% of the planes on a single frame. The layout is
    // significance-ordered so the planes that go are the smallest, dimmest and
    // furthest — but "the least visible planes vanish instantly" is still an
    // instant change, and the sweep measured it as a 31 -> 17 step.
    //
    // Easing the *scale* over about three quarters of a second turns it into a
    // ramp, and because the count now carries a fractional part (see
    // `setCount`), every plane on the way out fades rather than disappears. The
    // canonical state stays pure: `stepScale` is an argument, not a mode.
    const target = stepped ? CLOUD_STEP_DOWN_SCALE : 1;
    stepScale.current +=
      (target - stepScale.current) * Math.min(1, Math.min(dt, 1 / 20) / QUALITY_EASE_SECONDS);
    if (Math.abs(target - stepScale.current) < 1e-4) stepScale.current = target;

    const state = getCloudState(
      { altitude: debug.altitude ?? journey.altitude, viewport, qualityTier: tier, reducedMotion },
      stepScale.current,
    );

    // The clock advances only while the loop is running, which is what makes a
    // tab return not produce a jump: the tab was hidden, `journey.running` was
    // false, and the clock did not move. §8.
    //
    // `cloudFreeze` stops time-dependent motion without stopping the altitude,
    // which `debug.freeze` would. §8 requires validation to be able to freeze
    // all motion while still sweeping altitudes; those are different things.
    if (!debug.cloudFreeze) clock.current += Math.min(dt, 1 / 20);

    const density = Math.max(0, Math.min(2, debug.cloudDensity));

    // Published *before* the early return, not after it. The sweep has to be
    // able to read the state at altitudes where the deck is deliberately absent
    // — "coverage is 0 at 7 000 m" is an assertion §14 makes, and it cannot be
    // made against a handle that is only populated when something is drawn.
    if (import.meta.env.DEV) publish(state);

    // The root holds still. Each role carries its own vertical offset, because
    // the horizon, the enclosure and the floor deck do three different things —
    // see the note above `enclosureYAt`.
    if (root.current) root.current.visible = state.visible;
    if (!state.visible) return;

    // Tint. Cold grey-blue while the deck is still distant, near-white and
    // self-lit inside it, and a cooler lit white once the camera is above and
    // the sun is the only light left. Three values on one continuous ramp, so
    // there is no altitude at which the colour steps.
    tint.setHex(0x9fb0c4).lerp(TMP.setHex(0xdfe7f0), state.presence.enclosure);

    // --- distant -------------------------------------------------------------
    const { distant, enclosure, floor } = built;
    const drift = driftAt(clock.current, 0, state.driftRate);

    setCount(distant, state.layersExact.distant);
    distant.mesh.material.opacity = state.opacity * state.presence.distant * density * 0.55;
    distant.mesh.material.color.setHex(0x8ea2ba);
    // The furthest planes get the smallest share of the drift: a shared world
    // offset already projects to less screen movement at depth, and damping it
    // further is what keeps the horizon from swimming.
    distant.group.position.set(drift.x * 0.25, state.y.distant + drift.y * 0.25, 0);

    // --- enclosure -----------------------------------------------------------
    // The only role whose matrices are rewritten per frame, because it is the
    // only one the aperture clearance acts on and the only one close enough for
    // per-plane drift to read as anything but noise. Twenty-two `compose` calls
    // is a few microseconds; it is not where this scene's frame goes.
    const enclosureCount = setCount(enclosure, state.layersExact.enclosure);
    enclosure.mesh.material.opacity = state.opacity * state.presence.enclosure * density;
    enclosure.mesh.material.color.copy(tint);
    enclosure.group.position.y = state.y.enclosure;
    // The camera's height inside this group. The clearance is carved around the
    // view axis, and the view axis is at −offset in group space.
    const axisY = -state.y.enclosure;
    for (let i = 0; i < enclosureCount; i++) {
      const p = enclosure.planes[i];
      const d = driftAt(clock.current, p.phase, state.driftRate);
      const cleared = clearAperture(
        { x: p.x + d.x, y: p.y + d.y, z: p.z, phase: p.phase },
        state.apertureClearance,
        axisY,
      );
      place(enclosure.mesh, i, p, cleared.x, cleared.y, false);
    }
    enclosure.mesh.instanceMatrix.needsUpdate = true;

    // --- floor ---------------------------------------------------------------
    setCount(floor, state.layersExact.floor);
    floor.mesh.material.opacity = state.opacity * state.presence.floor * density * 0.9;
    floor.mesh.material.color.setHex(0xd3dde9);
    // §7's "the cloud layer separates or drops beneath the viewpoint": the
    // descent is `floorYAt`, in the canonical state, not an adjustment applied
    // here. This file places what it is told to place.
    floor.group.position.set(drift.x * 0.4, state.y.floor + drift.y * 0.15, 0);
  });

  // Matrices for the two static roles are written once, after construction.
  useEffect(() => {
    for (const [handle, flat] of [
      [built.distant, false],
      [built.floor, true],
    ] as const) {
      for (let i = 0; i < MAX_PLANES; i++) {
        const p = handle.planes[i];
        place(handle.mesh, i, p, p.x, p.y, flat);
      }
      handle.mesh.instanceMatrix.needsUpdate = true;
    }
  }, [built]);

  return (
    <group ref={root} visible={false}>
      <primitive object={built.distant.group} />
      <primitive object={built.floor.group} />
      <primitive object={built.enclosure.group} />
    </group>
  );
}

const TMP = new THREE.Color();

/**
 * Publish the live state for the sweep and the debug panel. DEV only —
 * `import.meta.env.DEV` is statically replaced, so neither this function nor its
 * call survives a production build, the same rule `main.tsx` and the debug panel
 * already follow.
 */
function publish(state: CloudState) {
  const g = globalThis as { __stratos?: Record<string, unknown> };
  if (g.__stratos) g.__stratos.cloud = state;
}

export { CLOUD_STOPS };

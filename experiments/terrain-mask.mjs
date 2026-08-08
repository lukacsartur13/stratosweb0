// =============================================================================
// The page-side half of the framing measurement.
//
// Every function here is evaluated *inside the page* by Playwright, so each one
// is self-contained: no imports, no closure over module scope, nothing but
// `globalThis.__stratos`. They live in a module of their own so the probe
// (`experiments/.tmp-frame.mjs`, throwaway) and the regression test
// (`tests/full/mountain-framing.spec.ts`) drive the identical code — a mask
// produced two slightly different ways is two baselines.
//
// WHY A MASK AND NOT A SCREENSHOT
// -------------------------------
// The palette is graphite against a near-black sky by design, so no luminance
// threshold separates rock from sky reliably, and it gets worse exactly as the
// fog closes in. Hiding everything that is not the range and drawing what is
// left flat white gives an exact answer with no threshold to tune.
//
// The renderer is created without `preserveDrawingBuffer`, so a later task
// copying the canvas reads a cleared buffer — that is not a hypothetical, it is
// the bug that made the first version of `shots-mountains.mjs` report zeroes for
// four viewports at four altitudes. The render and the `readPixels` therefore
// happen inside one evaluate, before the frame is presented, and the scene is
// put back before returning.
// =============================================================================

/**
 * A `rows × cols` boolean grid of "is there terrain here", row-major, row 0 at
 * the top of the frame. Returned as a plain array so it survives the bridge.
 *
 * Point-sampled rather than area-averaged, deliberately: the metrics that
 * consume it ask where an *edge* is, and an averaged cell has no edge in it.
 */
export function terrainMask({ cols, rows }) {
  const s = globalThis.__stratos;
  const THREE = s.three;
  const { scene, camera, gl } = s;

  const isMountain = (o) => {
    let p = o;
    while (p) {
      if (p.userData?.mountainRoot) return true;
      p = p.parent;
    }
    return false;
  };

  const hidden = [];
  scene.traverse((o) => {
    if ((o.isMesh || o.isPoints || o.isSprite) && o.visible && !isMountain(o)) {
      o.visible = false;
      hidden.push(o);
    }
  });
  const prevOverride = scene.overrideMaterial;
  const prevClear = new THREE.Color();
  gl.getClearColor(prevClear);
  const prevAlpha = gl.getClearAlpha();

  scene.overrideMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
  gl.setClearColor(0x000000, 1);
  gl.render(scene, camera);

  const ctx = gl.getContext();
  const W = ctx.drawingBufferWidth;
  const H = ctx.drawingBufferHeight;
  const px = new Uint8Array(W * H * 4);
  ctx.readPixels(0, 0, W, H, ctx.RGBA, ctx.UNSIGNED_BYTE, px);

  scene.overrideMaterial?.dispose?.();
  scene.overrideMaterial = prevOverride;
  gl.setClearColor(prevClear, prevAlpha);
  for (const o of hidden) o.visible = true;
  gl.render(scene, camera);

  const mask = new Array(rows * cols);
  for (let r = 0; r < rows; r++) {
    // readPixels' origin is bottom-left; flip so row 0 is the top of the frame.
    const y = H - 1 - Math.min(H - 1, Math.round(((r + 0.5) / rows) * H));
    for (let c = 0; c < cols; c++) {
      const x = Math.min(W - 1, Math.round(((c + 0.5) / cols) * W));
      mask[r * cols + c] = px[(y * W + x) * 4] > 127 ? 1 : 0;
    }
  }
  return mask;
}

/**
 * Where the instrument lands, and where the camera and the range are.
 *
 * Read from the `meridianRoot` / `mountainRoot` markers rather than inferred
 * from bounding-box size, which is what an earlier version did and why it
 * reported "not found" on every portrait viewport.
 */
export function frameState() {
  const s = globalThis.__stratos;
  const THREE = s.three;
  const { scene, camera } = s;
  camera.updateMatrixWorld();

  let meridianRoot = null;
  let mountainRoot = null;
  scene.traverse((o) => {
    if (o.userData?.meridianRoot) meridianRoot = o;
    if (o.userData?.mountainRoot) mountainRoot = o;
  });

  const project = (v) => {
    const p = v.clone().project(camera);
    return { x: (p.x + 1) / 2, y: (1 - p.y) / 2, z: p.z };
  };

  let meridian = null;
  if (meridianRoot) {
    const box = new THREE.Box3().setFromObject(meridianRoot);
    if (!box.isEmpty()) {
      const centre = box.getCenter(new THREE.Vector3());
      const radius = box.getSize(new THREE.Vector3()).length() / 2;
      const c = project(centre);
      const ex = project(centre.clone().add(new THREE.Vector3(radius, 0, 0)));
      const ey = project(centre.clone().add(new THREE.Vector3(0, radius, 0)));
      meridian = {
        centreX: +c.x.toFixed(4),
        centreY: +c.y.toFixed(4),
        radiusX: +Math.abs(ex.x - c.x).toFixed(4),
        radiusY: +Math.abs(ey.y - c.y).toFixed(4),
        ndcZ: +c.z.toFixed(4),
      };
    }
  }

  // --- near-plane clipping and terrain edge gaps ----------------------------
  // §18 asks for both, and both are answered from the range's own world bounds
  // rather than from the picture: a mass that has crossed the near plane is a
  // geometric fact, and so is a range whose lateral extent no longer reaches the
  // frustum's side planes at the depth the horizon sits at.
  let nearest = null;
  let bounds = null;
  if (mountainRoot && mountainRoot.visible) {
    const box = new THREE.Box3().setFromObject(mountainRoot);
    if (!box.isEmpty()) {
      bounds = {
        min: [box.min.x, box.min.y, box.min.z].map((v) => +v.toFixed(3)),
        max: [box.max.x, box.max.y, box.max.z].map((v) => +v.toFixed(3)),
      };
      // Distance from the camera to the nearest point of the range's box, along
      // the view direction. Negative means geometry is behind the near plane.
      const fwd = new THREE.Vector3();
      camera.getWorldDirection(fwd);
      let min = Infinity;
      for (const x of [box.min.x, box.max.x]) {
        for (const y of [box.min.y, box.max.y]) {
          for (const z of [box.min.z, box.max.z]) {
            const d = new THREE.Vector3(x, y, z).sub(camera.position).dot(fwd);
            if (d < min) min = d;
          }
        }
      }
      nearest = +min.toFixed(4);
    }
  }

  return {
    altitude: Math.round(s.journey.altitude),
    camera: {
      fov: +camera.fov.toFixed(4),
      near: camera.near,
      far: camera.far,
      aspect: +camera.aspect.toFixed(4),
      position: [camera.position.x, camera.position.y, camera.position.z].map((v) => +v.toFixed(4)),
      rotation: [camera.rotation.x, camera.rotation.y, camera.rotation.z].map((v) => +v.toFixed(5)),
    },
    range: mountainRoot
      ? {
          visible: mountainRoot.visible,
          scale: +mountainRoot.scale.x.toFixed(6),
          position: [mountainRoot.position.x, mountainRoot.position.y, mountainRoot.position.z]
            .map((v) => +v.toFixed(4)),
          quaternion: [
            mountainRoot.quaternion.x, mountainRoot.quaternion.y,
            mountainRoot.quaternion.z, mountainRoot.quaternion.w,
          ].map((v) => +v.toFixed(5)),
          /** The station, recovered from the transform: (camera − position) / scale. */
          station: [
            (camera.position.x - mountainRoot.position.x) / mountainRoot.scale.x,
            (camera.position.y - mountainRoot.position.y) / mountainRoot.scale.x,
            (camera.position.z - mountainRoot.position.z) / mountainRoot.scale.x,
          ].map((v) => +v.toFixed(1)),
          nearestAlongView: nearest,
          bounds,
        }
      : null,
    meridian,
  };
}

/**
 * The terrain's own uniforms and the renderer's colour state.
 *
 * Recorded so the baseline document states what the material actually was
 * rather than what the source says it should be — the two diverged once already
 * (`Sky` writes its colours without an sRGB encode, which is why the sky reads
 * about a stop and a half darker than its hex).
 */
export function terrainLook() {
  const s = globalThis.__stratos;
  const { scene, gl } = s;
  let terrain = null;
  scene.traverse((o) => {
    if (!o.isMesh || terrain) return;
    let p = o;
    while (p && !p.userData?.mountainRoot) p = p.parent;
    if (p && o.material?.uniforms) terrain = o.material;
  });
  const u = terrain?.uniforms ?? {};
  const val = (k) => {
    const v = u[k]?.value;
    if (v === undefined || v === null) return null;
    if (typeof v === 'number') return +v.toFixed(6);
    if (v.isColor) return '#' + v.getHexString();
    if (v.isVector3) return [v.x, v.y, v.z].map((n) => +n.toFixed(4));
    if (v.isVector2) return [v.x, v.y].map((n) => +n.toFixed(4));
    return String(v);
  };
  return {
    renderer: {
      toneMapping: gl.toneMapping,
      toneMappingExposure: gl.toneMappingExposure,
      outputColorSpace: gl.outputColorSpace,
    },
    material: {
      toneMapped: terrain?.toneMapped ?? null,
      transparent: terrain?.transparent ?? null,
      uniforms: Object.fromEntries(Object.keys(u).sort().map((k) => [k, val(k)])),
    },
  };
}

/**
 * Per-zone tonal separation, measured on the frame the visitor actually sees.
 *
 * §8's complaint is that the zoning is measurable and not *visible*, so the
 * measurement has to be made where the visibility is lost: after the lighting,
 * the atmosphere and the colour encode, on final pixels.
 *
 * The zone of a pixel cannot be read back from a colour, so it is rendered:
 * the terrain material is switched to a debug mode that writes the zone weights
 * into the output, the frame is read, and the weights are used to bucket the
 * *real* frame's pixels. Two renders, one bucketing, no guessing.
 */
export function zoneSeparation() {
  const s = globalThis.__stratos;
  const { scene, camera, gl } = s;
  const ctx = gl.getContext();
  const W = ctx.drawingBufferWidth;
  const H = ctx.drawingBufferHeight;

  const mats = new Set();
  scene.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    let p = o;
    while (p && !p.userData?.mountainRoot) p = p.parent;
    if (p && o.material?.uniforms?.uZoneDebug) mats.add(o.material);
  });
  if (!mats.size) return null;

  gl.render(scene, camera);
  const real = new Uint8Array(W * H * 4);
  ctx.readPixels(0, 0, W, H, ctx.RGBA, ctx.UNSIGNED_BYTE, real);

  for (const m of mats) m.uniforms.uZoneDebug.value = 1;
  gl.render(scene, camera);
  const zones = new Uint8Array(W * H * 4);
  ctx.readPixels(0, 0, W, H, ctx.RGBA, ctx.UNSIGNED_BYTE, zones);
  for (const m of mats) m.uniforms.uZoneDebug.value = 0;
  gl.render(scene, camera);

  // The debug write is (valley, rock, ridge) in RGB and snow in alpha-as-blue
  // boost; a pixel is assigned to whichever weight is largest, and pixels with
  // no terrain in them write zero in all three.
  const buckets = { valley: [], rock: [], ridge: [], snow: [] };
  for (let i = 0; i < W * H; i++) {
    const r = zones[i * 4];
    const g = zones[i * 4 + 1];
    const b = zones[i * 4 + 2];
    if (r + g + b < 8) continue;
    const L = 0.2126 * real[i * 4] + 0.7152 * real[i * 4 + 1] + 0.0722 * real[i * 4 + 2];
    const snow = zones[i * 4 + 3];
    let key;
    if (snow > 128) key = 'snow';
    else key = r >= g && r >= b ? 'valley' : g >= b ? 'rock' : 'ridge';
    // Sampled: a 1170×2532 frame is 3 M entries and the medians do not move.
    if (i % 17 === 0) buckets[key].push({ L, r: real[i * 4], g: real[i * 4 + 1], b: real[i * 4 + 2] });
  }

  const stat = (arr) => {
    if (!arr.length) return null;
    const l = arr.map((v) => v.L).sort((a, b) => a - b);
    const mean = (k) => +(arr.reduce((a, v) => a + v[k], 0) / arr.length).toFixed(1);
    return {
      pixels: arr.length,
      lumMedian: +l[l.length >> 1].toFixed(1),
      lumP10: +l[Math.floor(l.length * 0.1)].toFixed(1),
      lumP90: +l[Math.floor(l.length * 0.9)].toFixed(1),
      rgb: [mean('r'), mean('g'), mean('b')],
    };
  };

  return {
    valley: stat(buckets.valley),
    rock: stat(buckets.rock),
    ridge: stat(buckets.ridge),
    snow: stat(buckets.snow),
  };
}

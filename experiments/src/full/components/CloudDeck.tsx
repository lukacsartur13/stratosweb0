import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { clamp, ease, journey, lerp, span } from '../journey';

/**
 * The cloud layer, and the breakthrough through the top of it.
 *
 * Structure: two populations of camera-facing quads sharing one runtime-drawn
 * texture.
 *
 *   * `volume` — puffs distributed through a slab between roughly 6 000 and
 *     10 500 m. These are what the camera passes *through*.
 *   * `tops` — a much flatter, wider population sitting at the top of the slab,
 *     which only becomes visible after the breakthrough and reads as the deck
 *     seen from above.
 *
 * Both are drawn from the same canvas texture, so the whole cloud system adds
 * zero bytes to the download. A cloud sprite sheet at a resolution that holds
 * up on a 2x display is a larger asset than the altimeter GLB, for something
 * the browser can rasterise in under a millisecond at startup.
 *
 * The four beats the brief asked for are one continuous function of altitude,
 * not four cross-faded states:
 *
 *   6 000–8 500  approach   density rises, the horizon starts to disappear
 *   8 500–9 700  entry      visibility collapses, everything goes diffuse
 *   9 700–10 600 exit       the camera clears the top, opacity falls fast
 *   10 600+      above      only `tops` remains, receding below
 */

/** A soft, irregular puff: four offset radial gradients. One reads as a bokeh
 *  dot, which is precisely the cartoon look to avoid. */
function makePuffTexture(size: number) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.clearRect(0, 0, size, size);
  const blobs = [
    [0.5, 0.52, 0.46, 0.55],
    [0.34, 0.46, 0.3, 0.4],
    [0.66, 0.48, 0.28, 0.36],
    [0.5, 0.38, 0.24, 0.3],
  ];
  ctx.globalCompositeOperation = 'lighter';
  for (const [cx, cy, r, alpha] of blobs) {
    const g = ctx.createRadialGradient(cx * size, cy * size, 0, cx * size, cy * size, r * size);
    g.addColorStop(0, `rgba(255,255,255,${alpha})`);
    g.addColorStop(0.45, `rgba(255,255,255,${alpha * 0.42})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

type Puff = { x: number; y: number; z: number; sx: number; sy: number; rot: number; phase: number };

/** Fixed pseudo-random layout: identical on every load, which is what makes the
 *  regression screenshots comparable at all. */
function layout(count: number, seed: number, flat: boolean): Puff[] {
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  return Array.from({ length: count }, () => {
    const z = -1.6 - rnd() * 7;
    const spread = 5 + Math.abs(z) * 1.7;
    const scale = flat ? 3.2 + rnd() * 4.5 : 1.4 + rnd() * 3.2;
    return {
      x: (rnd() - 0.5) * spread,
      y: flat ? -0.4 + rnd() * 0.9 : -3 + rnd() * 7.5,
      z,
      sx: scale,
      sy: scale * (flat ? 0.28 : 0.6),
      rot: rnd() * Math.PI,
      phase: rnd() * Math.PI * 2,
    };
  });
}

export function CloudDeck({ simplified }: { simplified: boolean }) {
  const texture = useMemo(() => makePuffTexture(simplified ? 128 : 256), [simplified]);

  // Counts are the main mobile lever here: these are transparent, overlapping
  // quads, so they are pure fill rate and a phone pays for every one of them.
  const volume = useMemo(() => layout(simplified ? 16 : 44, 7, false), [simplified]);
  const tops = useMemo(() => layout(simplified ? 10 : 26, 31, true), [simplified]);

  const volumeGroup = useRef<THREE.Group>(null);
  const topsGroup = useRef<THREE.Group>(null);
  const tint = useMemo(() => new THREE.Color(), []);

  useEffect(() => () => texture?.dispose(), [texture]);

  useFrame(() => {
    if (!journey.running) return;
    const m = journey.altitude;
    const density = clamp(journey.debug.cloudDensity, 0, 2);

    // --- the four beats, as one curve ---------------------------------------
    const approach = ease(span(m, 6_000, 8_500));
    const inside = ease(span(m, 8_500, 9_700));
    const exiting = ease(span(m, 9_700, 10_600));

    // Peak opacity is reached inside the deck and then falls away. The fall is
    // faster than the rise on purpose: emerging should feel like a release, and
    // a symmetric fade reads as the same event played backwards.
    const bodyOpacity = (0.22 * approach + 0.78 * inside) * (1 - exiting) * density;

    // Cloud tops only exist once there is an "above" to see them from.
    const topsOpacity = ease(span(m, 9_900, 12_500)) * (1 - ease(span(m, 22_000, 27_000))) * density;

    // Tint: cold grey-blue on approach, near-white and self-lit inside, then a
    // cooler lit white from above where the sun is the only light left.
    tint.setHex(0x9fb0c4).lerp(TMP.setHex(0xdde6ef), inside);

    if (volumeGroup.current) {
      // The world descends past the camera. The camera itself barely moves —
      // see JourneyCamera — because a camera that travels 30 000 units needs a
      // far plane to match and loses all its depth precision.
      volumeGroup.current.position.y = -lerp(0, 16, ease(span(m, 6_000, 11_000)));
      volumeGroup.current.visible = bodyOpacity > 0.002;

      volumeGroup.current.children.forEach((child, i) => {
        const mesh = child as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
        // Per-quad variation so the deck does not fade as one flat sheet.
        mesh.material.opacity = bodyOpacity * (0.55 + ((i * 37) % 100) / 220);
        mesh.material.color.copy(tint);
      });
    }

    if (topsGroup.current) {
      // Recedes below as the journey climbs, and keeps receding through the
      // stratosphere so the deck is a long way down by the time Earth curves.
      topsGroup.current.position.y = -1.2 - ease(span(m, 10_000, 30_000)) * 9;
      topsGroup.current.visible = topsOpacity > 0.002;
      topsGroup.current.children.forEach((child, i) => {
        const mesh = child as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
        mesh.material.opacity = topsOpacity * (0.4 + ((i * 53) % 100) / 240);
      });
    }
  });

  return (
    <>
      <group ref={volumeGroup} visible={false}>
        {volume.map((p, i) => (
          <mesh key={i} position={[p.x, p.y, p.z]} rotation={[0, 0, p.rot]} renderOrder={10}>
            <planeGeometry args={[p.sx, p.sy]} />
            <meshBasicMaterial
              map={texture ?? undefined}
              transparent
              opacity={0}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
        ))}
      </group>

      <group ref={topsGroup} visible={false}>
        {tops.map((p, i) => (
          <mesh
            key={i}
            position={[p.x, p.y, p.z]}
            // Laid nearly flat, so they read as a surface seen from above rather
            // than as more of the same vertical puffs.
            rotation={[-Math.PI / 2.4, 0, p.rot]}
            renderOrder={9}
          >
            <planeGeometry args={[p.sx, p.sy]} />
            <meshBasicMaterial
              map={texture ?? undefined}
              transparent
              opacity={0}
              depthWrite={false}
              color="#c9d6e4"
              toneMapped={false}
            />
          </mesh>
        ))}
      </group>
    </>
  );
}

const TMP = new THREE.Color();

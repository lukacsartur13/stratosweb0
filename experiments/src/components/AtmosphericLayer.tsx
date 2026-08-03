import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { ascent, clamp, ease, lerp, span } from '@/lib/ascent';

/**
 * Ground haze, then the first cloud layer.
 *
 * Every texture here is drawn into a canvas at runtime, so the atmosphere adds
 * exactly zero bytes to the download. That matters more than it sounds: a
 * conventional cloud sprite sheet at a usable resolution is a larger asset than
 * the instrument itself.
 */

/** The atmosphere's colour as a function of height, sampled from the palette
 *  the site already uses: void black at the floor, a graphite-navy through the
 *  haze, and a cold, lit grey where the cloud deck begins. */
const BAND = [
  { at: 0.0, colour: 0x04060a },
  { at: 0.35, colour: 0x090e17 },
  { at: 0.62, colour: 0x141d2b },
  { at: 0.84, colour: 0x27313f },
  { at: 1.0, colour: 0x3a4553 },
] as const;

function sampleBand(t: number, out: THREE.Color) {
  for (let i = 0; i < BAND.length - 1; i++) {
    const a = BAND[i];
    const b = BAND[i + 1];
    if (t <= b.at || i === BAND.length - 2) {
      const k = ease(span(t, a.at, b.at));
      return out.setHex(a.colour).lerp(new THREE.Color(b.colour), k);
    }
  }
  return out;
}

/** A soft, irregular puff. Four offset radial gradients read as vapour; one
 *  reads as a bokeh dot, which is exactly the cartoon look to avoid. */
function makePuffTexture(size = 256) {
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

type Puff = { x: number; y: number; z: number; scale: number; rot: number; drift: number };

function layout(count: number, seed = 7): Puff[] {
  // A fixed pseudo-random sequence: the layout is identical on every load and
  // in every screenshot, which is what makes visual comparison meaningful.
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  return Array.from({ length: count }, () => {
    const z = -1.4 - rnd() * 5.5;
    return {
      x: (rnd() - 0.5) * (4.5 + Math.abs(z) * 1.5),
      y: -2.2 + rnd() * 7.5,
      z,
      scale: 1.1 + rnd() * 2.9,
      rot: rnd() * Math.PI,
      drift: 0.4 + rnd() * 0.9,
    };
  });
}

export function AtmosphericLayer({ simplified }: { simplified: boolean }) {
  const scene = useThree((s) => s.scene);

  const texture = useMemo(() => makePuffTexture(simplified ? 128 : 256), [simplified]);
  const puffs = useMemo(() => layout(simplified ? 10 : 26), [simplified]);
  const motes = useMemo(() => (simplified ? 0 : 260), [simplified]);

  // Densities are small on purpose. FogExp2 is `1 - exp(-density² · depth²)`,
  // and the instrument sits about three units from the camera: at density 0.4
  // that is a 94% wash and the hero disappears into the background colour.
  // These numbers keep the haze on the cloud layer, where it belongs, and off
  // the subject.
  const fog = useMemo(() => new THREE.FogExp2(0x04060a, 0.09), []);
  const group = useRef<THREE.Group>(null);
  const moteRef = useRef<THREE.Points>(null);
  const colour = useMemo(() => new THREE.Color(), []);

  useEffect(() => {
    const previous = scene.fog;
    scene.fog = fog;
    return () => {
      scene.fog = previous;
      texture?.dispose();
    };
  }, [scene, fog, texture]);

  const moteGeometry = useMemo(() => {
    if (!motes) return null;
    const positions = new Float32Array(motes * 3);
    let s = 91;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < motes; i++) {
      positions[i * 3] = (rnd() - 0.5) * 7;
      positions[i * 3 + 1] = (rnd() - 0.5) * 9;
      positions[i * 3 + 2] = -0.6 - rnd() * 4.5;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return g;
  }, [motes]);

  useEffect(() => () => moteGeometry?.dispose(), [moteGeometry]);

  useFrame((_, delta) => {
    if (!ascent.running) return;
    const t = ascent.current;

    // Fog: colour and density both climb. Thick and black at ground level,
    // thinning through the haze, then thickening again inside the deck.
    sampleBand(t, colour);
    fog.color.copy(colour);
    fog.density = lerp(0.1, 0.035, ease(span(t, 0, 0.6))) + ease(span(t, 0.72, 1)) * 0.115;

    // Everything descends past the camera — the scene climbs, the world does not.
    if (group.current) {
      group.current.position.y = -t * 9.6;
      const visible = clamp(span(t, 0.42, 0.72)) * 0.55 + clamp(span(t, 0.72, 1)) * 0.45;
      group.current.children.forEach((child, i) => {
        const mesh = child as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
        const puff = puffs[i];
        if (!puff) return;
        mesh.material.opacity = visible * (0.1 + (i % 5) * 0.035);
        mesh.position.x += Math.sin(performance.now() * 0.00006 * puff.drift + i) * delta * 0.05;
      });
    }

    if (moteRef.current) {
      const mat = moteRef.current.material as THREE.PointsMaterial;
      // Motes belong to the lower atmosphere; they thin out as the air does.
      mat.opacity = 0.34 * (1 - ease(span(t, 0.3, 0.8)));
      moteRef.current.position.y = -t * 4.4;
    }
  });

  return (
    <>
      {/* The ground-level environment: a dark plane far below that the fog
          swallows almost entirely, but which stops the floor reading as void. */}
      <mesh position={[0, -3.2, -2.4]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[26, 26]} />
        <meshBasicMaterial color="#070b12" toneMapped={false} />
      </mesh>

      <group ref={group}>
        {puffs.map((p, i) => (
          <mesh key={i} position={[p.x, p.y, p.z]} rotation={[0, 0, p.rot]}>
            <planeGeometry args={[p.scale, p.scale * 0.62]} />
            <meshBasicMaterial
              map={texture ?? undefined}
              transparent
              opacity={0}
              depthWrite={false}
              color="#b9c6d4"
              blending={THREE.NormalBlending}
              toneMapped={false}
            />
          </mesh>
        ))}
      </group>

      {moteGeometry && (
        <points ref={moteRef} geometry={moteGeometry}>
          <pointsMaterial
            size={0.012}
            sizeAttenuation
            color="#8fa4bb"
            transparent
            opacity={0}
            depthWrite={false}
            toneMapped={false}
          />
        </points>
      )}
    </>
  );
}

import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import * as THREE from 'three';
import { cappedDpr } from '@/lib/capabilities';
import { AltimeterModel } from './AltimeterModel';
import { AtmosphericLayer } from './AtmosphericLayer';
import { CameraRig } from './CameraRig';
import { PrototypePerformanceManager } from './PrototypePerformanceManager';

/**
 * The WebGL half of the prototype, in its own module so it can be code-split.
 * Nothing above this file imports `three`, which is what lets the reduced-motion
 * and no-WebGL paths skip the renderer entirely rather than download it and
 * decline to use it.
 */
export default function AscentScene({
  simplified,
  parallax,
  onContextLost,
}: {
  simplified: boolean;
  parallax: boolean;
  onContextLost: () => void;
}) {
  return (
    <Canvas
      dpr={cappedDpr()}
      camera={{ fov: 30, near: 0.1, far: 40, position: [0, -0.12, 2.05] }}
      gl={{
        antialias: !simplified,
        powerPreference: 'high-performance',
        alpha: false,
        stencil: false,
        depth: true,
      }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.05;
        gl.setClearColor('#04060a', 1);
      }}
      // No shadow map at all: one hero object lighting itself does not need a
      // second depth pass, and on a phone that pass is the whole budget.
      shadows={false}
      data-testid="ascent-canvas"
    >
      <CameraRig parallax={parallax} />
      <PrototypePerformanceManager onContextLost={onContextLost} />

      {/* Lighting is authored here, not imported: the GLB carries no lights and
          no HDRI is fetched. The environment below is built from flat emitters
          inside the scene, so metal has something to reflect without a single
          byte crossing the network. */}
      <ambientLight intensity={0.55} color="#8ea3bd" />
      <directionalLight position={[-2.4, 3.2, 2.6]} intensity={3.4} color="#eef4ff" />
      <directionalLight position={[3.0, -1.4, -1.8]} intensity={1.4} color="#5b7ba8" />

      <Suspense fallback={null}>
        <Environment resolution={simplified ? 64 : 128} frames={1}>
          <Lightformer form="rect" intensity={2.6} position={[-2.2, 2.4, 2.0]} scale={[5, 5, 1]} color="#dce8f7" />
          <Lightformer form="rect" intensity={1.1} position={[2.8, 0.4, 1.2]} scale={[3, 6, 1]} color="#7f96b5" />
          <Lightformer form="ring" intensity={0.7} position={[0, -2.4, 1.6]} scale={[4, 4, 1]} color="#2b3446" />
        </Environment>

        <AltimeterModel />
      </Suspense>

      <AtmosphericLayer simplified={simplified} />
    </Canvas>
  );
}

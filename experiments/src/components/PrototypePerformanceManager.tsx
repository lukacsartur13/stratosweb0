import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { PerformanceMonitor } from '@react-three/drei';
import { cappedDpr } from '@/lib/capabilities';
import { ascent } from '@/lib/ascent';

/**
 * Keeps the prototype inside its frame budget without anybody having to watch
 * it. Four separate jobs, all of them boring and all of them necessary:
 *
 *   1. cap the device pixel ratio (done at the Canvas, enforced again here);
 *   2. step resolution down — and only cautiously back up — when frames slip;
 *   3. stop rendering entirely while the tab is hidden or the canvas is
 *      scrolled out of view, so a backgrounded page costs nothing;
 *   4. surrender the context cleanly and say so, rather than showing a frozen
 *      canvas, if the GPU process goes away.
 */
export function PrototypePerformanceManager({
  onContextLost,
}: {
  onContextLost: () => void;
}) {
  const { gl, setDpr, setFrameloop } = useThree();
  const ceiling = useRef(cappedDpr()[1]);

  useEffect(() => {
    const canvas = gl.domElement;

    // Parking the frameloop is what actually stops the work. Early-returning
    // out of every `useFrame` body only skips our own arithmetic — three.js
    // still runs a full render pass per frame for a canvas nobody can see.
    const park = (active: boolean) => {
      ascent.running = active;
      setFrameloop(active ? 'always' : 'never');
    };

    const lost = (event: Event) => {
      // Prevent the default so the browser will attempt a restore, but tell the
      // app immediately: a still frame that never updates again is worse than
      // an honest fallback.
      event.preventDefault();
      onContextLost();
    };
    canvas.addEventListener('webglcontextlost', lost);

    // Only render while the canvas is actually on screen and the tab is in
    // front. Scrolling past the sticky stage should not keep a GPU busy.
    let onScreen = true;
    const sync = () => park(onScreen && document.visibilityState === 'visible');

    const io = new IntersectionObserver(
      ([entry]) => {
        onScreen = entry.isIntersecting;
        sync();
      },
      { threshold: 0 },
    );
    io.observe(canvas);
    document.addEventListener('visibilitychange', sync);

    return () => {
      canvas.removeEventListener('webglcontextlost', lost);
      document.removeEventListener('visibilitychange', sync);
      io.disconnect();
      // Never leave the loop parked for whoever mounts next.
      setFrameloop('always');
    };
  }, [gl, onContextLost, setFrameloop]);

  return (
    <PerformanceMonitor
      // Step down quickly when frames slip; come back up reluctantly, so the
      // resolution does not oscillate around the threshold.
      onDecline={() => setDpr(Math.max(1, ceiling.current * 0.75))}
      onIncline={() => setDpr(ceiling.current)}
      flipflops={3}
      onFallback={() => setDpr(1)}
    />
  );
}

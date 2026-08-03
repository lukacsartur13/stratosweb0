import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { PerformanceMonitor } from '@react-three/drei';
import { cappedDpr } from '@/lib/capabilities';
import { journey } from '../journey';

/** What the render loop should be doing. Owned by JourneyScene — see below. */
export type Frameloop = 'always' | 'never';

/**
 * Keeps the journey inside its frame budget without anybody watching it.
 * Unchanged in principle from the prototype's manager, and unchanged on
 * purpose — it was measured and it works. Four jobs:
 *
 *   1. cap the device pixel ratio;
 *   2. step resolution down, and only cautiously back up, when frames slip;
 *   3. stop rendering entirely while the tab is hidden or the canvas is off
 *      screen — which on an eleven-screen track is most of the session;
 *   4. surrender a lost context cleanly and say so, rather than leaving a
 *      frozen canvas on screen.
 *
 * Point 3 is the one that matters more here than it did at 8 000 m. The canvas
 * is sticky for the whole journey, but the visitor still scrolls past its
 * container to the footer, and every frame rendered after that is pure waste.
 * Early-returning from `useFrame` bodies does not achieve this: three.js still
 * runs a full render pass. Only parking the loop actually stops the work.
 *
 * ## Why the parked state is reported upwards instead of set here
 *
 * This used to call `useThree().setFrameloop('never')` directly, and it was
 * measured not to work: the observer fired, the call was made, and the canvas
 * carried on drawing 258 draw calls per 100 ms indefinitely with the canvas
 * 3 788 px above the fold.
 *
 * react-three-fiber's `<Canvas>` re-runs `configure()` inside a layout effect
 * with *no dependency array*, so it runs on every render, and `configure` ends
 * with `if (state.frameloop !== frameloop) state.setFrameloop(frameloop)` —
 * where `frameloop` is the prop. `<Canvas>` also measures itself with
 * `useMeasure({ scroll: true })`, so it re-renders on scroll. The scroll that
 * takes the canvas off screen therefore re-renders `<Canvas>` and resets the
 * loop to the prop's value, undoing the park a few milliseconds after it
 * happened. An imperative `setFrameloop` cannot win against that, because the
 * component that owns the prop keeps asserting it.
 *
 * So the parked state is lifted to `JourneyScene`, which passes it *as* the
 * `frameloop` prop. `configure` then re-asserts the value we want rather than
 * fighting it. The observer and the visibility listener stay here, because this
 * is where the canvas is.
 */
export function QualityManager({
  onContextLost,
  onFrameloop,
}: {
  onContextLost: () => void;
  /** Must be referentially stable — a `useState` setter is. */
  onFrameloop: (mode: Frameloop) => void;
}) {
  const { gl, setDpr } = useThree();
  const ceiling = useRef(cappedDpr()[1]);

  useEffect(() => {
    const canvas = gl.domElement;

    const park = (active: boolean) => {
      journey.running = active;
      onFrameloop(active ? 'always' : 'never');
    };

    const lost = (event: Event) => {
      // Prevent the default so the browser will attempt a restore, but tell the
      // app immediately: a still frame that never updates again is worse than
      // an honest fallback.
      event.preventDefault();
      onContextLost();
    };
    canvas.addEventListener('webglcontextlost', lost);

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
      journey.running = true;
      onFrameloop('always');
    };
  }, [gl, onContextLost, onFrameloop]);

  return (
    <PerformanceMonitor
      onDecline={() => setDpr(Math.max(1, ceiling.current * 0.75))}
      onIncline={() => setDpr(ceiling.current)}
      flipflops={3}
      onFallback={() => setDpr(1)}
    />
  );
}

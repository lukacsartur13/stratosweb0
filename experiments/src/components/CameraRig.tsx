import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { PerspectiveCamera } from 'three';
import { ascent, damp, ease, lerp, span } from '@/lib/ascent';

/**
 * The camera is on rails. There are no orbit controls, nothing spins, and the
 * pointer may move the view by at most two degrees — the budget below is the
 * only place that number lives.
 *
 * This component reads the clock; it does not drive it. `advance()` belongs to
 * AltitudeHUD, because the frameloop this runs in is parked whenever the canvas
 * leaves the viewport and a clock that stops with it would strand the altitude
 * mid-transit.
 */
const PARALLAX_DEGREES = 2;
const PARALLAX_RAD = (PARALLAX_DEGREES * Math.PI) / 180;

/**
 * Dolly, expressed as multiples of the distance that just fits the instrument.
 * Fixed distances would frame correctly on one viewport and badly on every
 * other one — on a narrow portrait window a 1.12-unit instrument at a fixed
 * 2.05 units overflows the frame entirely.
 */
const DOLLY_START = 1.16;
const DOLLY_CLOSE = 0.9;
const DOLLY_END = 1.08;

/**
 * The instrument is 1.12 units across. These are the frame it has to fill —
 * tight, because a hero that occupies a third of the viewport reads as a
 * thumbnail rather than as the subject.
 */
const FRAME_WIDTH = 1.34;
const FRAME_HEIGHT = 1.30;

export function CameraRig({ parallax }: { parallax: boolean }) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const size = useThree((s) => s.size);
  const eased = useRef({ x: 0, y: 0 });

  /**
   * Distance at which the instrument exactly fills the frame, whichever axis
   * is tighter. Recomputed only when the viewport actually changes.
   */
  const fit = useMemo(() => {
    const vFovHalf = ((camera.fov ?? 30) * Math.PI) / 360;
    const aspect = Math.max(size.width, 1) / Math.max(size.height, 1);
    const hFovHalf = Math.atan(Math.tan(vFovHalf) * aspect);
    return Math.max(
      FRAME_WIDTH / 2 / Math.tan(hFovHalf),
      FRAME_HEIGHT / 2 / Math.tan(vFovHalf),
    );
  }, [camera.fov, size.width, size.height]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 1 / 20);
    const { current } = ascent;

    // --- dolly -------------------------------------------------------------
    // Two legs rather than one straight line, so the move reads as a camera
    // being flown rather than a slider being dragged.
    const approach = ease(span(current, 0, 0.42));
    const withdraw = ease(span(current, 0.62, 1));
    const z = fit * lerp(lerp(DOLLY_START, DOLLY_CLOSE, approach), DOLLY_END, withdraw);

    // --- vertical travel ---------------------------------------------------
    // The instrument stays put; the camera rises past it. Deliberately small:
    // the ascent is told by the atmosphere and the readout, not by the lens.
    const rise = ease(current);
    const y = lerp(-0.09, 0.1, rise);

    camera.position.set(0, y, z);

    // --- pointer parallax --------------------------------------------------
    const px = parallax ? ascent.pointer.x : 0;
    const py = parallax ? ascent.pointer.y : 0;
    eased.current.x = damp(eased.current.x, px, 0.9, dt);
    eased.current.y = damp(eased.current.y, py, 0.9, dt);

    // Clamped at the source, so no combination of inputs can exceed the budget.
    camera.rotation.y = Math.max(-PARALLAX_RAD, Math.min(PARALLAX_RAD, -eased.current.x * PARALLAX_RAD));
    camera.rotation.x = Math.max(-PARALLAX_RAD, Math.min(PARALLAX_RAD, -eased.current.y * PARALLAX_RAD));
    camera.rotation.z = 0;
  });

  return null;
}

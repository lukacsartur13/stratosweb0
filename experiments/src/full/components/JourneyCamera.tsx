import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { PerspectiveCamera } from 'three';
import { cameraHeightAt, clamp, journey, settle } from '../journey';
import { dollyK, fitDistance, railCameraYaw } from '../composition';

/**
 * The camera is on rails for all 30 000 metres. No orbit controls, nothing
 * spins, and the pointer may move the view by at most two degrees.
 *
 * The important decision here is that the camera barely travels. It moves
 * through a range of about three units over the whole journey while the world
 * descends past it, rather than climbing 30 000 units. Flying the camera the
 * "real" distance would need a far plane thirty thousand units out, which costs
 * every object in the scene most of its depth buffer precision and produces
 * z-fighting on exactly the large, near-coplanar surfaces this scene is made of
 * — the sky dome, the Earth shell, the cloud quads.
 *
 * This component reads the clock; it never drives it. `advance()` belongs to
 * JourneyHUD, because the frameloop this runs in is parked whenever the canvas
 * leaves the viewport.
 */
const PARALLAX_DEGREES = 2;
const PARALLAX_RAD = (PARALLAX_DEGREES * Math.PI) / 180;

/**
 * The frame the instrument has to fit inside, in world units.
 *
 * The constants and the `fitDistance`/`dollyK` functions themselves now live in
 * `composition.ts`, unchanged in value and in curve. They moved because the
 * portrait copy bands have to be laid out against the same numbers — the dial's
 * projected size *is* the band geometry — and a second copy of the frame maths
 * is a second thing that can fall out of step with the camera. The reasoning
 * for each value is kept here, next to the rig it describes.
 *
 * Measured off the render rather than assumed from the model: the instrument
 * including its housing occupies about 1.1 units. A bigger frame means the
 * instrument has to fit into more world units at the same field of view, so the
 * camera sits further back and the dial lands *smaller* on screen.
 *
 * ## Why the width is a function of aspect
 *
 * It used to be a single 2.2, which framed the dial to about half the width of
 * a 1440×900 viewport and left the left ~45% clear for the copy plate. That
 * worked only because the instrument was parked off to the right. Centred, the
 * same number puts a 610px dial in the middle of a 1440px screen and the copy
 * plate lands straight across its face — there is no longer a clear side, there
 * are two half-width margins, and 610 + 2 × 544 does not fit in 1440.
 *
 * The room has to come from somewhere, and of the levers the brief allows —
 * camera distance, field of view, ring scale, safe-zone sizing, typography
 * placement — camera distance is the one that costs nothing else. So on wide
 * viewports the frame opens up and the dial gets smaller, which is the price of
 * centring it.
 *
 * Narrow viewports must not pay that price. A phone stacks its copy above and
 * below the instrument rather than beside it, so it needs no side margins at
 * all, and shrinking the dial there would only make it unreadable — the
 * portrait viewports already measure inside ±3% with the 2.2 frame. Hence the
 * interpolation rather than a constant: unchanged at portrait aspects, opening
 * to 3.5 by the time the viewport is twice as wide as it is tall.
 *
 * The portrait dense-stage recede does not change any of this. It moves the
 * *instrument group* in scale and depth, exactly as the case-study recede
 * already does, and leaves the camera rig — and therefore the framing of the
 * sky dome, the cloud deck, the Earth limb and the mountain range — untouched.
 * That is why it can be applied on portrait without reopening the accepted
 * mountain art direction.
 */

/**
 * The vertical frame, and why it opens on mobile landscape.
 *
 * 1.24 frames the *essential* silhouette — dial, body, needle, aperture. The
 * active ring is a separate rule: §4 lets it approach the edge, but it must
 * stay whole, and the ring is much bigger than the silhouette it surrounds.
 * Measured off the gimbal subtree, it reaches **2.53 world units** at 30 000 m,
 * where the dolly is also at its widest.
 *
 * A very wide, very short viewport is the one shape where that does not fit.
 * `fit` takes whichever axis is tighter, and at 2.16:1 the width term wins —
 * 2.82 units against the height term's 2.16 — so the vertical view ends up
 * only 2.22 units tall and the ring is cut off top and bottom. Measured before
 * this change: −10px at 844×390, −15px at 800×360, −11px at 932×430, −10px at
 * 896×414, all on the top and bottom edges, with 199–275px of unused room to
 * the left and right. It is a vertical framing problem exclusively.
 *
 * So the vertical frame opens with aspect, exactly as the horizontal one does.
 * The value is derived rather than tuned: when the height term binds, the
 * visible world height is `k × FRAME_HEIGHT`, so containing the ring with the
 * 16px mobile edge margin needs
 *
 *     FRAME_HEIGHT ≥ ringHeight × h / (h − 32) / k
 *
 * which evaluates to 1.98–2.02 across the four landscape viewports, worst at
 * 800×360. 2.15 is that worst case with headroom.
 *
 * The ramp starts at 1.85 rather than at 1.0 on purpose. Every desktop
 * viewport in the matrix sits at or below it — 1440×900 is 1.60, 1366×768 and
 * 1920×1080 are 1.78 — so all three keep the 1.24 frame and the dial size they
 * already validate at, and none of them needs the help: their ring margins
 * measure +41px, +21px and +16px. This is a mobile-landscape composition mode,
 * and confining it to mobile landscape is the point.
 */

export function JourneyCamera({ parallax }: { parallax: boolean }) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const size = useThree((s) => s.size);
  const eased = useRef({ x: 0, y: 0, z: 0, y0: -0.1 });

  /**
   * Distance at which the instrument exactly fills the frame, whichever axis is
   * tighter.
   *
   * Fixed distances are the mistake that made the first pass of this component
   * unusable: a dolly authored in absolute units frames correctly on the one
   * viewport it was tuned on and badly on every other. At 1440×900 a 1.12-unit
   * instrument at a fixed 2.35 units filled the entire frame and pushed the
   * headline off it. Everything below is now expressed as a *multiple* of this
   * fit distance, so the composition survives a resize and a phone.
   */
  const fit = useMemo(
    () => fitDistance(Math.max(size.width, 1) / Math.max(size.height, 1), camera.fov ?? 32),
    [camera.fov, size.width, size.height],
  );

  useFrame((_, delta) => {
    const dt = Math.min(delta, 1 / 20);
    const m = journey.altitude;

    // --- dolly -------------------------------------------------------------
    // Four legs, one per act, each a smoothstep so the camera always arrives
    // rather than stopping, and the joins are invisible because every leg's
    // velocity is zero at both ends. Multiples of `fit`, never absolute units.
    // The legs themselves are `dollyK` in composition.ts, so the copy bands can
    // ask where the camera is without this component having to tell them.
    const z = fit * dollyK(m) + journey.debug.cameraZ;

    // --- vertical ----------------------------------------------------------
    // Small and monotonic. The ascent is told by the atmosphere, the readout
    // and the receding cloud deck; a camera that lurches upward as well is the
    // fourth thing saying the same word.
    const y = cameraHeightAt(journey.current);

    // Damped rather than assigned: ScrollTrigger delivers position changes in
    // discrete jumps on a trackpad flick, and an undamped camera reproduces
    // every one of them as a snap. Seeded on the first frame so a resize does
    // not make the camera fly in from wherever it was.
    //
    // `settle` rather than `damp`, and that is a determinism fix rather than a
    // change to the move. An exponential damper never lands, so the camera's
    // settled z at a given altitude differed depending on whether the visitor
    // arrived from below or above — and the mountain range is placed relative
    // to this camera, so that residual showed up as the range sitting in a
    // measurably different place at the same altitude. The dolly's four legs,
    // its targets and its smoothing are untouched; only the end of the
    // approach is defined. See SETTLE_EPSILON in journey.ts.
    if (eased.current.z === 0) eased.current.z = z;
    eased.current.z = settle(eased.current.z, z, 0.86, dt);
    eased.current.y0 = settle(eased.current.y0, y, 0.86, dt);
    camera.position.set(0, eased.current.y0, eased.current.z);

    // --- pointer parallax --------------------------------------------------
    const px = parallax ? journey.pointer.x : 0;
    const py = parallax ? journey.pointer.y : 0;
    eased.current.x = settle(eased.current.x, px, 0.9, dt);
    eased.current.y = settle(eased.current.y, py, 0.9, dt);

    // --- the rail pan --------------------------------------------------------
    //
    // The camera's own share of the lateral move, and §6's first-listed way of
    // getting it: one degree of yaw pans the sky, the cloud deck and the
    // mountain range by about 2% of the viewport width, which is enough for the
    // frame to read as having been re-aimed at the instrument rather than as
    // the instrument sliding across a stationary frame.
    //
    // Added to the parallax rather than folded into it, and *outside* the
    // parallax clamp, because they are two different budgets: the clamp exists
    // so no combination of pointer inputs can exceed two degrees, and the rail
    // pan is not a pointer input. Undamped, and that is the determinism
    // requirement rather than an omission — it is a pure function of the
    // altitude, so at equal altitude the camera is at equal yaw whichever
    // direction the visitor arrived from (§7). It needs no damping of its own:
    // the knot track already crosses over most of a screen of scrolling.
    //
    // `AltimeterMeridian` solves the instrument's world position against this
    // same function rather than against `camera.rotation.y`, so the rail is hit
    // exactly and neither component depends on which of the two ran first.
    // Clamped at the source, so no combination of inputs can exceed the budget.
    camera.rotation.y =
      clamp(-eased.current.x * PARALLAX_RAD, -PARALLAX_RAD, PARALLAX_RAD) + railCameraYaw(m);
    camera.rotation.x = clamp(-eased.current.y * PARALLAX_RAD, -PARALLAX_RAD, PARALLAX_RAD);
    camera.rotation.z = 0;
  });

  return null;
}

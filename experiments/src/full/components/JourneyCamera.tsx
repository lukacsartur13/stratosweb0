import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { PerspectiveCamera } from 'three';
import { cameraHeightAt, clamp, ease, journey, lerp, settle, span } from '../journey';

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
 * Measured off the render rather than assumed from the model: the instrument
 * including its housing occupies about 1.1 units. A bigger frame means the
 * instrument has to fit into more world units at the same field of view, so the
 * camera sits further back and the dial lands *smaller* on screen.
 *
 * ## Why the width is now a function of aspect
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
 */
const FRAME_WIDTH_PORTRAIT = 2.2;
const FRAME_WIDTH_WIDE = 3.5;

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
const FRAME_HEIGHT_BASE = 1.24;
const FRAME_HEIGHT_LANDSCAPE = 2.15;
const LANDSCAPE_ASPECT_FROM = 1.85;
const LANDSCAPE_ASPECT_TO = 2.2;

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
  const fit = useMemo(() => {
    const vFovHalf = ((camera.fov ?? 32) * Math.PI) / 360;
    const aspect = Math.max(size.width, 1) / Math.max(size.height, 1);
    const hFovHalf = Math.atan(Math.tan(vFovHalf) * aspect);
    // Square is the hinge, 2:1 the far end: below 1.0 nothing changes, so every
    // portrait phone and the 768×1024 tablet keep the framing they already
    // validate at.
    const frameWidth = lerp(FRAME_WIDTH_PORTRAIT, FRAME_WIDTH_WIDE, clamp((aspect - 1) / 1));
    const frameHeight = lerp(
      FRAME_HEIGHT_BASE,
      FRAME_HEIGHT_LANDSCAPE,
      clamp((aspect - LANDSCAPE_ASPECT_FROM) / (LANDSCAPE_ASPECT_TO - LANDSCAPE_ASPECT_FROM)),
    );
    return Math.max(frameWidth / 2 / Math.tan(hFovHalf), frameHeight / 2 / Math.tan(vFovHalf));
  }, [camera.fov, size.width, size.height]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 1 / 20);
    const m = journey.altitude;

    // --- dolly -------------------------------------------------------------
    // Four legs, one per act, each a smoothstep so the camera always arrives
    // rather than stopping, and the joins are invisible because every leg's
    // velocity is zero at both ends. Multiples of `fit`, never absolute units.
    const closeOnInstrument = ease(span(m, 0, 2_400)); // push in on the dial
    const pullBack = ease(span(m, 5_000, 9_500)); // back off as cloud arrives
    const openOut = ease(span(m, 9_500, 17_000)); // the breakthrough opens up
    // Named `wideHold` rather than `settle`, which is what it was called: that
    // name now belongs to the damping helper imported above, and the two mean
    // different things — this is the fourth dolly leg, that is how any damped
    // value stops.
    const wideHold = ease(span(m, 24_000, 30_000)); // hold, wide, for the Earth

    let k = lerp(1.06, 0.94, closeOnInstrument);
    k = lerp(k, 1.14, pullBack);
    k = lerp(k, 1.3, openOut);
    k = lerp(k, 1.38, wideHold);
    const z = fit * k + journey.debug.cameraZ;

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

    // Clamped at the source, so no combination of inputs can exceed the budget.
    camera.rotation.y = clamp(-eased.current.x * PARALLAX_RAD, -PARALLAX_RAD, PARALLAX_RAD);
    camera.rotation.x = clamp(-eased.current.y * PARALLAX_RAD, -PARALLAX_RAD, PARALLAX_RAD);
    camera.rotation.z = 0;
  });

  return null;
}

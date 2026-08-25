import { CEILING_M, onAscent } from './ascent';

/**
 * The portrait page's air, as one number.
 *
 * ## What this replaces
 *
 * `.mv-sky__depth` was a fixed gradient, and its own comment said so: *"the
 * altitude tint, driven by nothing — it is a fixed gradient, and the sense of
 * ascent comes from the copy and the instrument, not from a colour that has to
 * be recomputed"*.
 *
 * That was a defensible trade when the phone's brief was a performance reset,
 * and the audit is the bill for it: photographed at 27 950 m, the phone's
 * background is indistinguishable from the one at 0 m. The direction is
 * explicit that the background may not behave like a wallpaper behind changing
 * sections, and on the one surface where there is no sky shader to carry it,
 * the background is the only thing that can.
 *
 * ## Why it costs nothing
 *
 * It is not a recomputed colour. It is one custom property on `<html>`, and the
 * two gradients that read it are declared once in `mobile.css` — the compositor
 * re-blends two full-screen quads that are already in their own layer, and the
 * main thread does a single `setProperty` on the frames where the value
 * actually changed.
 *
 * Everything the mobile brief rules out is still ruled out: no filter on a
 * full-viewport element, no blurred blobs, no particles, nothing animated on
 * its own clock, and no second scroll listener — this rides `onAscent`, which
 * is the one the page already has.
 *
 * ## Quantised, deliberately
 *
 * A hundredth of the journey is 300 vertical metres, which is far below
 * anything either gradient expresses, and it means the property is written
 * about a hundred times over the whole document rather than on every scroll
 * frame. The dirty check is what makes a scroll frame cost nothing at all
 * through the long stretches where the air is not changing.
 */
const STEP = 100;

/**
 * Lift-off: 0 to 1 over the first two hundred metres.
 *
 * `--mv-alt` is the whole journey and the opening section covers 150 of its
 * 30 000 metres, so on its own the lower air is still at 99% of its ground
 * density after a whole screen of scrolling — and the direction is explicit
 * that the first half-screen to screen of movement is where the visitor has to
 * understand that the environment is ascending.
 *
 * Same rule, read over the part of the altitude the opening actually covers.
 * Smoothstepped so the ground does not begin to leave at full speed the instant
 * a finger touches the screen.
 */
const LIFT_M = 200;
const ease = (t: number) => t * t * (3 - 2 * t);

export function startAtmosphere(root: HTMLElement = document.documentElement): () => void {
  let shownAlt = '';
  let shownLift = '';

  const stop = onAscent((state) => {
    const alt = (Math.round((state.altitude / CEILING_M) * STEP) / STEP).toFixed(2);
    if (alt !== shownAlt) {
      shownAlt = alt;
      root.style.setProperty('--mv-alt', alt);
    }
    const lift = ease(Math.min(1, Math.max(0, state.altitude / LIFT_M))).toFixed(2);
    if (lift !== shownLift) {
      shownLift = lift;
      root.style.setProperty('--mv-lift', lift);
    }
  });

  return () => {
    stop();
    root.style.removeProperty('--mv-alt');
    root.style.removeProperty('--mv-lift');
  };
}

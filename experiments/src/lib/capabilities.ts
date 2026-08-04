/**
 * What this device is actually willing to do.
 *
 * Every answer here is read once, before anything heavy is imported, because
 * the point of asking is to avoid downloading three.js at all when the answer
 * is no. Nothing in this module imports from `three` — keep it that way.
 */

export type Capability =
  | { ok: true; tier: 'full' | 'reduced' }
  | { ok: false; reason: 'reduced-motion' | 'no-webgl' };

const media = (q: string) => typeof matchMedia === 'function' && matchMedia(q).matches;

export const prefersReducedMotion = () => media('(prefers-reduced-motion: reduce)');

/** Coarse pointer or a narrow viewport: the simplified scene, not the full one. */
export const isHandheld = () =>
  media('(pointer: coarse)') || (typeof innerWidth === 'number' && innerWidth < 820);

/** A fine pointer is the only thing that makes cursor parallax meaningful. */
export const hasFinePointer = () => media('(hover: hover) and (pointer: fine)');

/**
 * Probe for a real WebGL context rather than trusting `'WebGLRenderingContext'
 * in window` — the constructor exists on machines where context creation still
 * fails (blocklisted drivers, headless browsers without swiftshader, GPU
 * process crashes). The probe canvas is thrown away immediately.
 */
export function hasWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl =
      canvas.getContext('webgl2') ||
      canvas.getContext('webgl') ||
      canvas.getContext('experimental-webgl');
    if (!gl) return false;
    // Some environments hand back a context that is already lost.
    const lost = (gl as WebGLRenderingContext).isContextLost?.();
    (gl as WebGLRenderingContext).getExtension('WEBGL_lose_context')?.loseContext();
    return !lost;
  } catch {
    return false;
  }
}

/**
 * The effective device pixel ratio, and the one place it is decided.
 *
 * ## Why this replaced a `[1, 1.5]` tuple
 *
 * The old ceiling was 1.5 on handhelds, on the argument that "a 3x phone screen
 * costs 9x the fragments of a 1x one for a difference nobody can see on a dark,
 * largely out-of-focus scene". Measured on the production build at 430x932,
 * 390x844, 360x800 and 844x390, all at devicePixelRatio 3, that argument was
 * wrong about this scene. The Altimeter is not out of focus — it is the subject,
 * it is the only high-contrast object in the frame, and its bezel, tick ring and
 * aperture edge are exactly the sub-pixel detail a 1.5x buffer destroys. At
 * 585x1266 for a 390x844 CSS box on a 3x screen the instrument gets one buffer
 * sample per two device pixels in each axis, and the silhouette stair-steps.
 *
 * §4 of the fidelity gate asks for the *lowest* value in 1.5–2.0 that produces
 * an acceptably sharp instrument. 2.0 is what passed review; see
 * `_build/reports/phase6-5-mobile-fidelity.md` for the crops the three
 * candidates were chosen from.
 *
 * ## Why a start and a floor rather than a `[min, max]` tuple
 *
 * A tuple is a *clamp on the hardware value*, which react-three-fiber
 * re-evaluates on every `<Canvas>` render — and `<Canvas>` re-renders on scroll.
 * Anything that lowered the ratio imperatively was therefore reverted a few
 * milliseconds later by the next scroll, then lowered again by the next decline:
 * resolution pumping on the signature object, which §4 forbids outright. The
 * ratio is now a number owned by `JourneyScene` and passed *as* the prop, the
 * same fix the frameloop needed for the same reason — see `QualityManager`.
 *
 * `floor` is the one step the ladder is allowed to take, and it is the bottom.
 * Never below it: an instrument that is playable and blurry has failed at the
 * only thing it is on the page to do.
 *
 * Both are clamped to the hardware ratio, so a 1x device is never asked to
 * render more pixels than it can show.
 *
 * ## Why handheld and desktop now agree
 *
 * They did not before: 1.5 and 2. The split existed to protect phone GPUs from
 * "nine times the fragments of a 1x screen" — but nothing here ever asked for
 * 3x. It asks for 2x, which is 1.78 times the fragments of the old 1.5x, on a
 * scene with no shadow map, no post-processing pass, no render target and a
 * one-draw-call sky. Measured on the reference GPU that step cost 10% of the
 * frame; it is the multisampling enabled alongside it that costs, and the crops
 * say both are needed. See `_build/reports/phase6-5-mobile-fidelity.md`.
 *
 * One number for both is also the point of §3: a single canonical policy that
 * no second system is allowed to overwrite.
 */
export function renderScale(): { start: number; floor: number } {
  const hardware = typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return { start: Math.min(hardware, 2), floor: Math.min(hardware, 1.5) };
}

export function detect(): Capability {
  if (prefersReducedMotion()) return { ok: false, reason: 'reduced-motion' };
  if (!hasWebGL()) return { ok: false, reason: 'no-webgl' };
  return { ok: true, tier: isHandheld() ? 'reduced' : 'full' };
}

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
 * Device pixel ratio, capped.
 *
 * A 3x phone screen costs 9x the fragments of a 1x one for a difference nobody
 * can see on a dark, largely out-of-focus scene. 1.5 on handhelds and 2 on
 * desktop is the ceiling; below that we take whatever the device reports.
 */
export function cappedDpr(): [number, number] {
  const ceiling = isHandheld() ? 1.5 : 2;
  return [1, Math.min(typeof devicePixelRatio === 'number' ? devicePixelRatio : 1, ceiling)];
}

export function detect(): Capability {
  if (prefersReducedMotion()) return { ok: false, reason: 'reduced-motion' };
  if (!hasWebGL()) return { ok: false, reason: 'no-webgl' };
  return { ok: true, tier: isHandheld() ? 'reduced' : 'full' };
}

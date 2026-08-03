/**
 * Which mountain composition this device gets, and which decoder decodes it.
 *
 * WHY NOT VIEWPORT WIDTH
 * ----------------------
 * The two GLBs are not the same scene at two triangle budgets. The mobile file
 * is a *different composition*: the desktop safe-zone cone projects to the full
 * frame width in portrait, so every desktop mass sits outside it and a portrait
 * crop of the desktop scene is two dark corner wedges and empty sky. See the
 * long note in blender/mountains/stratos_terrain.py. Choosing between them is
 * therefore a question about the shape of the frame and the device behind it,
 * not about a pixel count — a 700 px-wide desktop window and a 430 px phone
 * want opposite answers, and both are "narrow".
 *
 * The signals, in the order they decide:
 *
 *   * **aspect ratio** — the composition is authored for portrait or for
 *     landscape, and that is the single fact that makes one of the two files
 *     wrong. It is weighted highest for that reason.
 *   * **touch environment** — `(pointer: coarse)` separates a phone from a
 *     narrow desktop window, which no dimension can.
 *   * **device pixel ratio** — a 3x screen at 390 CSS px is a phone; a 1x
 *     screen at 390 px is a resized browser.
 *   * **renderer capability** — `capabilities.detect()`'s `reduced` tier is the
 *     scene's own judgement about this device and is reused rather than
 *     re-derived.
 *   * **memory tier** — `navigator.deviceMemory` where the browser has it. It
 *     is absent on Safari and Firefox, so it can only ever break a tie.
 *
 * WHY HYSTERESIS
 * --------------
 * Switching asset means a fetch, a DRACO decode and a scene rebuild. A browser
 * window dragged across a threshold, or a mobile address bar collapsing and
 * changing the viewport height by 60 px, must not trigger that. `shouldSwitch`
 * therefore refuses to move until the new answer is clear of the boundary,
 * which is why the decision returns a *score* rather than a boolean.
 */

import { isHandheld } from '@/lib/capabilities';

export type MountainVariant = 'desktop' | 'mobile';

/**
 * Which DRACO decoder build to use.
 *
 * 'js' rather than 'wasm', and the reason is a policy measurement rather than a
 * preference — see the CSP block in netlify.toml and
 * `_build/reports/draco-csp-probe.txt`. The WASM decoder is ~4x faster but
 * needs `wasm-unsafe-eval` on script-src, which the measurements show is not
 * required to make the assets load. Both decoders are present under
 * /public/draco/, so this is the only line that has to change to switch.
 */
export const MOUNTAIN_DECODER: 'js' | 'wasm' = 'js';

/** Same-origin, and under BASE_URL so a sub-path deploy still resolves. */
export const DRACO_PATH = `${import.meta.env.BASE_URL}draco/`;

export const MOUNTAIN_URL: Record<MountainVariant, string> = {
  desktop: `${import.meta.env.BASE_URL}models/stratos-mountains-desktop.glb`,
  mobile: `${import.meta.env.BASE_URL}models/stratos-mountains-mobile.glb`,
};

export type DeviceSignals = {
  width: number;
  height: number;
  dpr: number;
  coarsePointer: boolean;
  /** The renderer's own tier. `reduced` is the scene's judgement of a weak device. */
  reducedTier: boolean;
  /** `navigator.deviceMemory` in GB, or null where the browser does not expose it. */
  memoryGb: number | null;
};

export function readSignals(): DeviceSignals {
  const nav = typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { deviceMemory?: number });
  return {
    width: typeof innerWidth === 'number' ? innerWidth : 1440,
    height: typeof innerHeight === 'number' ? innerHeight : 900,
    dpr: typeof devicePixelRatio === 'number' ? devicePixelRatio : 1,
    coarsePointer: typeof matchMedia === 'function' ? matchMedia('(pointer: coarse)').matches : false,
    reducedTier: isHandheld(),
    memoryGb: typeof nav?.deviceMemory === 'number' ? nav.deviceMemory : null,
  };
}

/**
 * How strongly this device wants the portrait composition, from -1 to +1.
 *
 * Positive is mobile. Zero is genuinely undecided rather than "desktop by
 * default", which is what makes the hysteresis band below meaningful.
 */
export function mobileScore(s: DeviceSignals): number {
  const aspect = s.width / Math.max(s.height, 1);

  // Aspect is the dominant term, because it is the one the compositions differ
  // on. Portrait (< 0.8) pushes hard to mobile; clearly landscape (> 1.2) pushes
  // hard to desktop; the band between is left near zero rather than forced.
  const aspectScore = aspect < 0.8 ? 1 : aspect > 1.2 ? -1 : (1.0 - aspect) / 0.2;

  // A coarse pointer is the single most reliable phone/tablet signal, and the
  // only one a resized desktop window cannot fake.
  const pointerScore = s.coarsePointer ? 1 : -1;

  // A high DPR at a small CSS width is a phone; the same width at 1x is a
  // narrow window. Only meaningful together, so it is scaled by narrowness.
  const narrow = s.width <= 520 ? 1 : s.width <= 820 ? 0.4 : 0;
  const dprScore = narrow * (s.dpr >= 2 ? 1 : s.dpr >= 1.5 ? 0.3 : -0.5);

  const tierScore = s.reducedTier ? 0.5 : -0.5;

  // Absent on Safari and Firefox, so it can only ever nudge.
  const memoryScore = s.memoryGb === null ? 0 : s.memoryGb <= 4 ? 0.4 : -0.2;

  const total =
    aspectScore * 3 + pointerScore * 2 + dprScore * 1.5 + tierScore * 1 + memoryScore * 0.5;
  const maxWeight = 3 + 2 + 1.5 + 1 + 0.5;
  return Math.max(-1, Math.min(1, total / maxWeight));
}

export function variantFor(s: DeviceSignals): MountainVariant {
  return mobileScore(s) > 0 ? 'mobile' : 'desktop';
}

/**
 * The band a score has to clear to change an already-chosen variant.
 *
 * Sized so an address bar collapsing on a phone — which changes height by
 * roughly 60 px and moves nothing else — cannot cross it, while a genuine
 * device-orientation change (which flips the aspect term from +1 to -1, three
 * of the eleven weight units) always does.
 */
const SWITCH_MARGIN = 0.18;

export function shouldSwitch(current: MountainVariant, s: DeviceSignals): MountainVariant {
  const score = mobileScore(s);
  if (current === 'mobile' && score < -SWITCH_MARGIN) return 'desktop';
  if (current === 'desktop' && score > SWITCH_MARGIN) return 'mobile';
  return current;
}

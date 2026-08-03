/**
 * Putting `kineticAt` on the page.
 *
 * Two jobs, deliberately separated:
 *
 *   `publishKinetic`  runs inside the HUD's existing per-frame tick and writes
 *                     custom properties. No second requestAnimationFrame, no
 *                     React rerender per frame, and no component that owns a
 *                     clock of its own — the same arrangement the altitude
 *                     readout and the scale bar already use.
 *
 *   `reserveKinetic`  runs once after the fonts have settled, and again on
 *                     resize, to stop the moments causing layout shift.
 *
 * ## Why custom properties rather than inline styles per element
 *
 * The anchors are `<em>` elements inside headings that React owns. Writing
 * `style.fontWeight` on them each frame means holding refs to nodes React may
 * re-render, and it puts three writes per frame on the main thread for text that
 * changes shape over thousands of metres. Publishing four numbers on
 * `<html>` and letting CSS bind them is one write, and the binding lives in the
 * stylesheet next to the rest of the typography.
 *
 * ## Why the values are quantised
 *
 * A weight of 512.4 and one of 512.6 are the same rendered glyph. Rounding
 * weight to 1, width to 0.5% and tracking to 0.0005em means the properties are
 * rewritten only when something visibly changed — typically a few dozen times
 * across the whole ascent rather than sixty times a second — while leaving the
 * underlying function continuous. It also makes the published values exactly
 * reproducible from an altitude, which is what the determinism test compares.
 */

import { journey } from './journey';
import { MOMENTS, kineticRest, momentAt, widestSettings, type KineticAnchorId } from './kineticType';

/** The attribute an element uses to opt into a moment. */
export const KINETIC_ATTR = 'data-kinetic';

const varName = (id: KineticAnchorId, axis: 'wght' | 'wdth' | 'track') => `--kin-${id}-${axis}`;

/**
 * The real media query, not a development override.
 *
 * Read live rather than cached, because a visitor can turn the preference on
 * while the page is open and the next frame should honour it. `matchMedia` is
 * cheap; the listener plumbing to cache it would not be.
 */
let reducedQuery: MediaQueryList | null = null;
export function prefersReducedMotion(): boolean {
  if (typeof matchMedia !== 'function') return false;
  reducedQuery ??= matchMedia('(prefers-reduced-motion: reduce)');
  return reducedQuery.matches;
}

const shown = new Map<string, string>();

function put(root: HTMLElement, name: string, value: string) {
  if (shown.get(name) === value) return;
  shown.set(name, value);
  root.style.setProperty(name, value);
}

/**
 * Publish every moment's state for the current altitude.
 *
 * Called once per frame from `JourneyHUD`, after `advance` has written
 * `journey.altitude`, so the type and the instrument are reading the same number
 * on the same frame and cannot disagree about where the visitor is.
 */
export function publishKinetic(root: HTMLElement = document.documentElement) {
  const reduced = prefersReducedMotion();
  const altitude = journey.altitude;

  for (const moment of MOMENTS) {
    const state = momentAt(moment, altitude, reduced);
    put(root, varName(moment.id, 'wght'), String(state.weight));
    put(root, varName(moment.id, 'wdth'), (Math.round(state.width * 2) / 2).toFixed(1));
    put(root, varName(moment.id, 'track'), (Math.round(state.tracking * 2000) / 2000).toFixed(4));
  }
}

/** Reset every published axis to rest. Used when the journey unmounts. */
export function clearKinetic(root: HTMLElement = document.documentElement) {
  const rest = kineticRest();
  for (const moment of MOMENTS) {
    root.style.setProperty(varName(moment.id, 'wght'), String(rest.weight));
    root.style.setProperty(varName(moment.id, 'wdth'), rest.width.toFixed(1));
    root.style.setProperty(varName(moment.id, 'track'), rest.tracking.toFixed(4));
  }
  shown.clear();
}

/**
 * Stop the moments moving anything.
 *
 * A weight or width change alters advance widths, so a phrase that gains 380
 * units of weight mid-ascent can rewrap its heading and push everything below it
 * down the panel. That is a layout shift, it is what §6.10 forbids, and it is
 * the one part of kinetic type that cannot be solved by choosing tasteful
 * numbers.
 *
 * The fix is to reserve the space rather than to hope. For each anchor: force
 * the widest settings the moment can ever reach, measure the *heading* that
 * contains it, and pin that height. The heading can then rewrap internally
 * without any of its siblings moving, which is what the CLS measurement in the
 * full-ascent suite checks.
 *
 * Measured after `document.fonts.ready` because the fallback and the webfont
 * have different metrics, and again on resize and locale change because both
 * change how the phrase wraps. `min-height` rather than `height`, so a longer
 * translation is never clipped — German runs a third longer than Hungarian and
 * is the case that decides this.
 */
export function reserveKinetic(scope: ParentNode = document): () => void {
  const anchors = [...scope.querySelectorAll<HTMLElement>(`[${KINETIC_ATTR}]`)];

  const measure = () => {
    for (const anchor of anchors) {
      const id = anchor.getAttribute(KINETIC_ATTR) as KineticAnchorId | null;
      if (!id) continue;
      // The readout is monospaced: its advance width does not depend on weight,
      // so there is nothing to reserve and forcing a height on the HUD would
      // fight the layout that positions it.
      if (id === 'altitude-readout') continue;

      const host = anchor.closest('h1, h2, h3') as HTMLElement | null;
      if (!host) continue;

      const widest = widestSettings(id);
      const previous = anchor.getAttribute('style') ?? '';
      host.style.minHeight = '';

      anchor.style.fontWeight = String(widest.weight);
      anchor.style.fontStretch = `${widest.width}%`;
      anchor.style.letterSpacing = `${widest.tracking}em`;
      // Force layout before reading, so the measurement is of the widest state
      // rather than of whatever the last frame published.
      const height = host.getBoundingClientRect().height;

      if (previous) anchor.setAttribute('style', previous);
      else anchor.removeAttribute('style');

      if (height > 0) host.style.minHeight = `${Math.ceil(height)}px`;
    }
  };

  let frame = 0;
  const schedule = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(measure);
  };

  // Fonts first: measuring against the fallback and then swapping is the shift
  // this function exists to prevent.
  if (typeof document !== 'undefined' && 'fonts' in document) {
    document.fonts.ready.then(schedule).catch(schedule);
  } else {
    schedule();
  }

  addEventListener('resize', schedule);
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
  // The track, not each heading: a heading whose own min-height we just set
  // would otherwise notify us about the change we made and loop.
  const track = document.querySelector('[data-testid="journey-track"]');
  if (observer && track) observer.observe(track);

  return () => {
    cancelAnimationFrame(frame);
    removeEventListener('resize', schedule);
    observer?.disconnect();
    for (const anchor of anchors) {
      const host = anchor.closest('h1, h2, h3') as HTMLElement | null;
      if (host) host.style.minHeight = '';
    }
  };
}

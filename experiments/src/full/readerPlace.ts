// =============================================================================
// Keeping the reader where they are while the journey replaces its static text.
//
// THE DEFECT
// ----------
// A link into the homepage's lower half — `/#ground-h`, or a search result's
// "Read more" text fragment into the FAQ — lands on the written statement under
// the journey. The journey then mounts above it, ten to nineteen thousand pixels
// of it, and the reader is carried away from what they came to read. Measured
// on the build before this file existed, Chromium at 1440×900:
//
//     /en/#ground-h            target 18 718 px below the viewport, CLS 1.000
//     /#:~:text=<FAQ question> target 19 160 px below the viewport, CLS 1.028
//
// Nothing scroll-anchored it, deliberately: `chrome.css` (and now `styles.css`)
// sets `overflow-anchor: none` on everything after the journey, because on a
// Back navigation the browser's own anchoring held the footer still while the
// journey grew and dropped the visitor at the bottom of the page. That defect
// is real and the rule stays for it. What was missing is the other half: on a
// *fresh* arrival below the journey, holding still is exactly right.
//
// WHAT THIS DOES
// --------------
// Runs once, immediately before the mount, and only on a fresh navigation. A
// Back, Forward or reload is the browser restoring a position measured against
// the *mounted* page, with `assets/js/home-history.js` reserving the height for
// it; holding still there would push the visitor by the growth a second time.
//
//   below the journey   As the journey grows above the reader, what they are
//                       reading holds still. Exactly one of two mechanisms
//                       does it, never both:
//
//                       * Chromium: the browser's own scroll anchoring,
//                         switched back on for what follows the mount host
//                         (`.journey-anchored` in styles.css). Not a script,
//                         because the two are not equivalent to the metric
//                         that measured the defect: a script that scrolls by
//                         the growth keeps the text still on screen, and
//                         Chromium still records the statement as having
//                         moved — measured, CLS 1.000 with the target pinned
//                         to the pixel. An anchoring adjustment is the
//                         correction layout instability discounts.
//
//                       * Everywhere else: by hand, from a ResizeObserver on
//                         the host. WebKit did not hold the statement still
//                         with anchoring switched on — although it reports
//                         `CSS.supports('overflow-anchor', 'auto')` — and an
//                         engine that does anchor (Firefox) must not get both,
//                         or the reader moves by the growth in the other
//                         direction. Which is why the deciding test is the
//                         one engine family that reports layout shifts, not
//                         `CSS.supports`.
//
//   inside the text     A reader already in the static narrative when the
//                       journey arrives — a `#stage-…` link, a text fragment
//                       into the journey's own words — is taken to the same
//                       stage in the composition, once, on the frame it is
//                       committed (`jtext-x` in the static text is `stage-x`
//                       in the composition — see `STATIC_ID`). Without this
//                       the reader would keep a scroll offset that means a
//                       different stage in the composition.
//                       The opening frame is excluded: it IS the composition's
//                       first screen, and re-anchoring there would fight the
//                       scroll that started the mount.
//
// The hand-made corrections run inside a ResizeObserver callback, which is
// after layout and before paint, so the reader never sees the frame in between.
// =============================================================================

/**
 * The prefix on every static stage id — `jtext-selected-work`, never the
 * composition's `stage-selected-work`. `staticJourney.ts` writes them; this
 * file reads them back.
 *
 * Sharing the composition's ids looked like the obvious way to make a
 * `/#stage-…` link work before the mount, and it broke the Back button.
 * Chromium restores a history entry's scroll position relative to an anchor
 * element it records by CSS selector — `#stage-selected-work > …` — and when
 * the static text carried that id the restore found it there, in a document
 * laid out completely differently, and landed the visitor hundreds of pixels
 * from where they had left (390×844: left at 4 194, came back to 3 964).
 * Distinct ids give that selector nothing to match until the composition
 * exists, so the restore falls back to the offset, which is the right number.
 * A `#stage-…` link is still honoured — `stageInView` below maps it onto the
 * composition's stage once it has mounted.
 */
export const STATIC_ID = 'jtext-';

/** `navigate`, `reload`, `back_forward` or `prerender`; `navigate` if unknown. */
function navigationType(): string {
  const entry = performance.getEntriesByType?.('navigation')[0] as
    | PerformanceNavigationTiming
    | undefined;
  return entry?.type ?? 'navigate';
}

/** The host's bottom edge in document coordinates: where everything after it starts. */
const endOf = (host: HTMLElement) => host.getBoundingClientRect().bottom + scrollY;

/**
 * The composition's id for the stage the reader is looking at, or null when
 * they are not inside the static narrative.
 *
 * A fragment that names a stage decides it outright — the composition's own
 * `#stage-…` form, which has no element until the mount, or the static
 * `#jtext-…` form the static text links to. Without one, it is the static
 * section across the middle of the viewport, which is where a text fragment
 * puts its match.
 */
function stageInView(host: HTMLElement): string | null {
  const stages = Array.from(host.querySelectorAll<HTMLElement>('[data-journey-static] > section[id]'));
  const composed = (id: string) => 'stage-' + id.slice(STATIC_ID.length);

  let hash = '';
  try {
    hash = decodeURIComponent(location.hash.slice(1));
  } catch {
    hash = '';
  }
  if (hash) {
    const staticId = hash.startsWith('stage-') ? STATIC_ID + hash.slice('stage-'.length) : hash;
    const named = document.getElementById(staticId);
    if (named) {
      const section = stages.find((s) => s.contains(named));
      return section ? composed(section.id) : null;
    }
  }

  const middle = innerHeight / 2;
  for (const section of stages) {
    const box = section.getBoundingClientRect();
    if (box.top <= middle && box.bottom > middle) return composed(section.id);
  }
  return null;
}

export function keepReaderPlace(host: HTMLElement): void {
  const type = navigationType();
  if (type === 'back_forward' || type === 'reload') return;

  let revisit = stageInView(host);
  const staticText = host.querySelector('[data-journey-static]');

  const native =
    typeof PerformanceObserver !== 'undefined' &&
    (PerformanceObserver.supportedEntryTypes ?? []).includes('layout-shift');
  if (native) {
    document.documentElement.classList.add('journey-anchored');
    // Let the engine pick its anchor under the new rule before the mount
    // changes anything above it.
    void host.offsetHeight;
  }

  if (typeof ResizeObserver !== 'function' || (native && !revisit)) return;

  let end = endOf(host);
  let lastY = scrollY;
  addEventListener('scroll', () => (lastY = scrollY), { passive: true });

  const observer = new ResizeObserver(() => {
    const now = endOf(host);
    const grew = now - end;
    end = now;

    if (revisit && staticText && !staticText.isConnected) {
      const target = document.getElementById(revisit);
      revisit = null;
      if (native) observer.disconnect();
      if (target && host.contains(target)) {
        // No `behavior`: the root's `scroll-behavior` is `auto`, so this is the
        // same instant jump a fragment link makes.
        target.scrollIntoView({ block: 'start' });
        lastY = scrollY;
        return;
      }
    }
    if (native) return;

    if (Math.abs(grew) < 1) return;
    // Below the journey, measured against where it ended BEFORE this change.
    if (scrollY < now - grew - 1) return;
    // Already absorbed since the last scroll event: the engine re-scrolled to
    // a fragment target while the document was still loading (WebKit does).
    if (Math.abs(scrollY - lastY - grew) < 2) return;
    scrollBy(0, grew);
    lastY = scrollY;
  });
  observer.observe(host);
}

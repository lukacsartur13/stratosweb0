import { CEILING_M, STAGES, type StageId } from '../journey';

/**
 * The portrait homepage's one source of scroll truth.
 *
 * ## What this replaces
 *
 * The accepted desktop homepage derives altitude through GSAP ScrollTrigger
 * into `journey.target`, damps it into `journey.current` with an exponential
 * settler, and then re-derives a composition from the damped value every frame
 * — measuring panels, computing exclusion bands and writing `--stage-flow` per
 * panel. Measured on the built site at 390x844, that is 28 scroll listeners,
 * ~253 rAF callbacks, ~1,280 `getBoundingClientRect` calls and ~1,366 style
 * writes over a twenty-step read of the document.
 *
 * The damping is the part the visitor actually feels. `journey.current` chases
 * `journey.target`, so when Safari's scroll stops, everything derived from it
 * keeps arriving for a few hundred milliseconds. That is the copy drift §3 of
 * the brief forbids outright.
 *
 * ## What this is instead
 *
 * No damping. `scrollY` is the value; there is nothing between the finger and
 * the page. When Safari stops, this stops in the same frame.
 *
 * The architecture is the one the Rapidkert audit recommends
 * (`_build/reports/rapidkert-mobile-motion-reference.md`), with one thing added:
 *
 *   * one `scroll` listener for the whole page, `{ passive: true }`
 *   * coalesced to at most one reader pass per animation frame
 *   * `try/finally` around the pass, so a throwing reader cannot wedge the flag
 *     and silently drop every later scroll event
 *   * readers run *synchronously* on `load` and `pageshow`, because rAF does
 *     not fire in a tab that is not rendering and a bfcache restore must not
 *     depend on a frame being produced
 *   * **section geometry is cached**, so a scroll frame performs no layout read
 *     at all. This is the addition: Rapidkert reads one rect per stage per
 *     frame, which is cheap but not free. Here the only thing a frame touches
 *     is `scrollY` and an array.
 *
 * Nothing in this module writes to the DOM. Subscribers do, and they are
 * expected to dirty-check before every write.
 */

export type Reader = (state: AscentState) => void;

export type AscentState = {
  /** 0..1 through the scrollable document. */
  progress: number;
  /** Metres, from the section the visitor is actually in. */
  altitude: number;
  /** Which narrative stage owns the current position. */
  stage: StageId;
};

/**
 * A section's altitude band, measured once.
 *
 * `top` is the document offset of the section's top edge, so locating the
 * visitor is `scrollY` against a sorted array and nothing else.
 */
type Band = {
  id: StageId;
  top: number;
  height: number;
  from: number;
  to: number;
};

const state: AscentState = { progress: 0, altitude: 0, stage: 'calibration' };

const readers = new Set<Reader>();

/**
 * Things that also want to remeasure whenever the sections do.
 *
 * The 3D instrument's slot has to know its own document offset in order to work
 * out where it is on screen, and that offset goes stale on exactly the same
 * occasions a section's does: fonts settling, the address bar collapsing, a
 * lazy image landing, a rotation, a bfcache restore. Every one of those already
 * has a listener here.
 *
 * So the instrument gets to ride them rather than installing a second set. §15
 * asks for *zero* new scroll listeners where the existing shared progress can
 * be reused, and this is the other half of that: zero new resize, orientation,
 * `visualViewport` and `pageshow` listeners either. A measurer is called after
 * the bands are rebuilt and before the readers run, so a reader that depends on
 * one is never a frame behind it.
 */
const measurers = new Set<() => void>();

let bands: Band[] = [];
let travel = 1;
let ticking = false;
let installed = false;

/**
 * The viewport height, cached at the same moments everything else is measured.
 *
 * `innerHeight` is not free. It is a property read that the browser is entitled
 * to satisfy by flushing pending layout, and a subscriber that reads it on
 * every scroll frame has quietly reintroduced the forced reflow this
 * architecture exists to remove. It changes only when the viewport does, and
 * every occasion on which it does already remeasures.
 */
let viewport = 0;

/** The viewport height, from the cache. Never reads layout. */
export const viewportHeight = () => viewport;

/**
 * How far down the viewport the "you are here" line sits.
 *
 * Not the top edge. A section's altitude should begin to count when the section
 * is being *read*, and at the top edge the visitor is still looking at the
 * previous one. A third of the way down is where a heading has settled into
 * reading position on a phone.
 */
const DATUM = 0.34;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Is the full-screen navigation layer open?
 *
 * While it is, `assets/js/header.js` holds the body at `position: fixed` with a
 * negative `top` — the only scroll lock iOS Safari actually honours. That
 * collapses the document to one viewport and pins `scrollY` at 0 for as long as
 * the layer is up, so every scroll-derived number on this page is wrong in the
 * same way for the duration.
 *
 * Left unguarded, opening the menu at 23 000 m walked the ascent back to the
 * valley floor behind the layer and back up again on close. This reader was
 * written without the guard the previous architecture had, and it reproduced
 * the same regression the moment a test looked: measured 23 000 m → 22 000 m
 * behind an open menu, non-deterministically, depending on whether the
 * `ResizeObserver` happened to fire against the collapsed document.
 *
 * So both the reader and the measurement stand down for the duration, and both
 * re-run on the close edge. `header.js` announces both edges on `stratos:menu`
 * and announces the close *after* the scroll position has been put back, which
 * is what makes catching up on the close edge correct rather than merely
 * hopeful.
 */
const menuOpen = () =>
  typeof document !== 'undefined' && document.documentElement.classList.contains('menu-open');

/**
 * Measure every declared section, once.
 *
 * Called on mount, on `load`, on resize, on `visualViewport` resize and from a
 * ResizeObserver on the document — every occasion on which a cached offset can
 * have gone stale, and none of them during a scroll.
 *
 * `getBoundingClientRect().top + scrollY` rather than `offsetTop`: `offsetTop`
 * is relative to the offset parent, and any sticky or transformed ancestor
 * makes it the wrong number in a way that is invisible until it is wrong.
 */
export function measureAscent() {
  // Every line below reads a layout that the scroll lock has collapsed to one
  // viewport. See `menuOpen`.
  if (menuOpen()) return;
  const sections = document.querySelectorAll<HTMLElement>('[data-alt-from]');
  const next: Band[] = [];
  const y = scrollY;

  for (const el of sections) {
    const from = Number(el.dataset.altFrom);
    const to = Number(el.dataset.altTo);
    const id = el.dataset.stage as StageId | undefined;
    if (!id || !Number.isFinite(from) || !Number.isFinite(to)) continue;
    const rect = el.getBoundingClientRect();
    next.push({ id, top: rect.top + y, height: rect.height, from, to });
  }

  next.sort((a, b) => a.top - b.top);
  bands = next;
  viewport = innerHeight;
  travel = Math.max(1, document.documentElement.scrollHeight - viewport);
  // Before `run`, so a reader that consumes a measurer's output never sees the
  // new bands against the old slot geometry.
  for (const measurer of measurers) measurer();
  run();
}

/**
 * Remeasure alongside the sections. Returns an unsubscribe.
 *
 * Called once, synchronously, at registration — the same contract `onAscent`
 * keeps, and for the same reason: a subscriber that only learns its geometry on
 * the next resize renders one frame against zero.
 */
export function onMeasure(measurer: () => void): () => void {
  measurers.add(measurer);
  if (!menuOpen()) {
    viewport = innerHeight;
    measurer();
  }
  return () => {
    measurers.delete(measurer);
  };
}

/**
 * Where the visitor is, from cached numbers only.
 *
 * ## The mapping, and why it is anchors rather than section boxes
 *
 * A section's altitude should start counting when the section reaches the
 * reading position, not when its top edge crosses the top of the screen — at
 * the top edge the visitor is still looking at the section before it. So each
 * section gets an *anchor*: the scroll position at which its top sits on the
 * datum line.
 *
 *   anchor = clamp(sectionTop - viewportHeight * DATUM, 0, travel)
 *
 * The altitude is then interpolated between consecutive anchors. Written the
 * obvious way instead — interpolating the datum line through the section's own
 * box — the first section reads part-way through at the top of the document,
 * because its top edge has already passed the datum line before any scrolling
 * has happened. The page opened at 50 m. The ascent begins on the ground and
 * the copy says so, so it has to read zero there.
 *
 * The clamp is what does it, and it is not a patch over the symptom: the first
 * anchor is genuinely at scroll zero, because there is no scroll position at
 * which the opening section is *not* the one being read. The same clamp puts
 * the last anchor at or before the end of the travel, so the ceiling is reached
 * exactly at the bottom of the document rather than a screen short of it.
 */
function locate(y: number): { altitude: number; stage: StageId } {
  if (bands.length === 0) return { altitude: 0, stage: 'calibration' };

  // The cached height, not `innerHeight`: this runs on a scroll frame, and it
  // is set by the same pass that filled `bands`, so it can never be stale here
  // without the bands being stale too.
  const lead = viewport * DATUM;
  const anchorOf = (i: number) => {
    const raw = bands[i].top - lead;
    return raw < 0 ? 0 : raw > travel ? travel : raw;
  };

  // Linear, backwards. Eleven bands is small enough that a binary search would
  // be more code than it saves, and the last band is the common case on the way
  // down.
  for (let i = bands.length - 1; i >= 0; i--) {
    const start = anchorOf(i);
    if (y >= start || i === 0) {
      const end = i + 1 < bands.length ? anchorOf(i + 1) : travel;
      const span = end - start;
      const through = span > 0 ? clamp01((y - start) / span) : 1;
      const band = bands[i];
      return { altitude: band.from + (band.to - band.from) * through, stage: band.id };
    }
  }
  return { altitude: 0, stage: bands[0].id };
}

/**
 * One pass over the readers.
 *
 * The `try/finally` is not defensive noise. Without it a reader that throws
 * leaves `ticking` true forever, every subsequent scroll event is dropped, and
 * the page freezes mid-state with no error anyone would connect to it. This is
 * the single most valuable line in the Rapidkert scroll loop.
 */
function run() {
  try {
    // `scrollY` is pinned at 0 behind the navigation layer. See `menuOpen`.
    if (menuOpen()) return;
    const y = scrollY;
    const here = locate(y);
    state.progress = clamp01(y / travel);
    state.altitude = here.altitude;
    state.stage = here.stage;
    for (const reader of readers) reader(state);
  } finally {
    ticking = false;
  }
}

function onScroll() {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(run);
}

/**
 * `load` and `pageshow` remeasure synchronously, and then once more.
 *
 * ## Why synchronously
 *
 * `requestAnimationFrame` does not fire in a tab that is not producing frames —
 * a background tab, or a bfcache entry being restored — and a page that arrives
 * already scrolled (a fragment link, a reload that restored position, a back
 * navigation) emits no scroll event at all. The instrument's resting state must
 * never depend on a frame happening.
 *
 * ## Why twice
 *
 * On a back navigation the `pageshow` handler runs before the browser has
 * finished restoring the document's height. `travel` is measured from
 * `scrollHeight`, so the synchronous pass computes it against a shorter
 * document than the one about to exist, every section anchor clamps to that
 * smaller travel, and the restored scroll position lands past all of them:
 * measured on a back navigation from 18 600 m, the readout came back at
 * 30 000 m — the ceiling — and stayed there until something else moved.
 *
 * The second pass is a frame later, by which time the height is real. It is
 * scheduled rather than synchronous precisely because it is the pass that wants
 * a laid-out document, and it is harmless if it never runs: the `ResizeObserver`
 * on the document covers the same ground a beat later, and the synchronous pass
 * has already put a defensible number on screen.
 */
function onRestore() {
  measureAscent();
  requestAnimationFrame(measureAscent);
}

/**
 * The navigation layer's close edge, announced by `assets/js/header.js` after
 * it has restored the scroll position. Catching up here is what turns the
 * stand-down above into a pause rather than a gap.
 */
function onMenu(event: Event) {
  if (!(event as CustomEvent<{ open: boolean }>).detail?.open) measureAscent();
}

function install() {
  if (installed) return;
  installed = true;
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('stratos:menu', onMenu);
  addEventListener('resize', measureAscent, { passive: true });
  addEventListener('orientationchange', measureAscent);
  addEventListener('load', onRestore);
  addEventListener('pageshow', onRestore);
  // The one that actually fires when iOS browser chrome collapses. A plain
  // `resize` does not, and the cached section offsets are wrong by the toolbar's
  // height until something else happens to remeasure.
  visualViewport?.addEventListener('resize', measureAscent);
}

function uninstall() {
  installed = false;
  removeEventListener('scroll', onScroll);
  removeEventListener('stratos:menu', onMenu);
  removeEventListener('resize', measureAscent);
  removeEventListener('orientationchange', measureAscent);
  removeEventListener('load', onRestore);
  removeEventListener('pageshow', onRestore);
  visualViewport?.removeEventListener('resize', measureAscent);
}

/**
 * Subscribe to the ascent. Returns an unsubscribe.
 *
 * The listeners are installed with the first reader and removed with the last,
 * so a page with nothing to drive has no scroll listener on it at all.
 *
 * The reader is called once, synchronously, at registration — the same contract
 * as Rapidkert's `onFrame`. A subscriber that only learns its value on the next
 * scroll renders one frame of whatever its markup happened to say.
 */
export function onAscent(reader: Reader): () => void {
  readers.add(reader);
  install();
  reader(state);
  return () => {
    readers.delete(reader);
    if (readers.size === 0) uninstall();
  };
}

/** The current value, for anything that needs it outside a reader. */
export const ascent = (): Readonly<AscentState> => state;

/**
 * Where a section begins, as a fraction of the document's scroll.
 *
 * The shared header changes state at two structural boundaries and needs them
 * expressed in the same units as the progress it is pushed. On the desktop
 * composition those come from the calibrated stage map; here they come from
 * where the sections actually are, which is the same question asked of a
 * simpler page.
 *
 * Zero before the first measurement, which is the correct answer at the top of
 * the document and a harmless one anywhere else — the header simply stays in
 * its opening state for the frame before `measureAscent` has run.
 */
export function progressOfSection(id: string): number {
  const band = bands.find((b) => b.id === id);
  return band ? clamp01(band.top / travel) : 0;
}

/**
 * The altitude band table the sections are annotated from.
 *
 * Derived from `STAGES` rather than written out again: the narrative's stage
 * boundaries are already stated there, the copy quotes them, and a second table
 * is a second thing to keep in step. This is the whole of the mobile page's
 * relationship to the desktop journey model — it borrows the altitudes and
 * nothing else. No shares, no track height, no calibration feedback.
 */
export const ALTITUDE_BANDS: Record<string, { from: number; to: number }> = Object.fromEntries(
  STAGES.map((s) => [s.id, { from: s.from, to: s.to }]),
);

export { CEILING_M };

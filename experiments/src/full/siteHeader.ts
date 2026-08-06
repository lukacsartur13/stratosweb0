import { STAGES, journey, stageStart } from './journey';

/**
 * The homepage's half of the shared flight deck.
 *
 * The header itself — markup, three states, hysteresis, the full-screen menu,
 * its focus trap and Return to 0 m — is `assets/js/header.js`, the same file the
 * other 66 routes load, rendered from the same `_build/build.py` template. This
 * module is the adapter: it hands that state machine the three things it cannot
 * work out for itself on this route.
 *
 *   progress   Document scroll is not the journey. The track is one sticky
 *              container whose scroll maps onto a damped, calibrated 0..1, and
 *              `journey.current` is that number.
 *
 *   altitude   The altitude curve is piecewise — eleven stages with unequal
 *              shares of the track — so `floor + p * (ceiling - floor)`, which
 *              is right on a static route, is wrong here by up to a stage. The
 *              header would print an altitude the instrument disagrees with,
 *              on the one page where both are on screen at once.
 *
 *   edges      The header's default boundaries are 0.06 and 0.88, chosen for a
 *              two-screen document. Here they are derived from the stage map:
 *              the journey state begins where the opening panel ends, and the
 *              destination state begins where the closing panels do. That makes
 *              the transitions land on structural events rather than near them,
 *              and it survives recalibration — `calibrate()` moves the stage
 *              boundaries when a 390px viewport stacks the case studies, and
 *              these move with it.
 *
 * A PUSH, NOT A POLL
 * ------------------
 * This is called from `JourneyHUD`'s tick, which is the journey's one clock. It
 * schedules nothing. The header's own hook used to take a getter and read it
 * from a `requestAnimationFrame` loop of its own, which on this page would be a
 * second permanent animation loop next to a WebGL renderer, a damped altitude
 * clock, a cloud system and a kinetic type driver. `header.push()` de-duplicates
 * internally, so a frame that moved the page by nothing costs two comparisons.
 */

type HeaderMeta = {
  alt?: number;
  key?: string;
  edges?: number[][];
};

type SiteHeader = {
  push(progress: number, meta?: HeaderMeta): void;
  release(): void;
  readonly state: string;
};

function header(): SiteHeader | undefined {
  const g = globalThis as { Stratos?: { header?: SiteHeader } };
  return g.Stratos?.header;
}

/**
 * How far below a boundary you have to come back before the header changes its
 * mind. 0.015 of the track is about a third of a screen at the shipped stage
 * shares — far enough that a trackpad's micro-reversals cannot toggle a state,
 * short enough that a deliberate scroll back up reverses it immediately.
 */
const HYSTERESIS = 0.015;

let edges: number[][] = [];
let seed = '';

function currentEdges(): number[][] {
  const toJourney = stageStart('initial-ascent');
  const toDestination = stageStart('full-stratosphere');
  const key = `${toJourney}|${toDestination}`;
  if (key !== seed) {
    seed = key;
    edges = [
      [toJourney, Math.max(0, toJourney - HYSTERESIS)],
      [toDestination, Math.max(toJourney, toDestination - HYSTERESIS)],
    ];
  }
  return edges;
}

let shownStage = '';
let label = '';

/** Publish one frame of journey state to the shared header. */
export function publishHeader(): void {
  const deck = header();
  if (!deck) return;

  // The stage changes about ten times over the whole journey, so this is a
  // string comparison on almost every frame and a table lookup on very few.
  if (journey.stage !== shownStage) {
    shownStage = journey.stage;
    label = STAGES.find((s) => s.id === journey.stage)?.label ?? '';
  }

  deck.push(journey.current, {
    alt: journey.altitude,
    key: label,
    edges: currentEdges(),
  });
}

// =============================================================================
// The one mobile top-layout calculation.
// =============================================================================

/**
 * Publish where homepage content may begin, as `--deck-top` on the root.
 *
 * §10 asks for a single authoritative value for this and the page had three
 * that did not know about each other. The header is `position: fixed` at the
 * top with its own padding; the instrument strip is `position: absolute` at
 * `top: 0` with an `env(safe-area-inset-top)` of its own; and neither consults
 * the other. Measured on a 390×844 they resolved into the same band — the
 * header occupying 0..77px and the strip 0..92px, with the altitude readout at
 * 7..31 drawn across the wordmark at 25..52 and the sound toggle at 52..84
 * poking out below the header's lower edge. In the opening state `.nav` has no
 * background at all, so the strip showed straight through it, which is the
 * "faint technical rail behind the navigation" the brief reports.
 *
 * The strip's own safe-area inset made it worse rather than better on a real
 * device, and that is worth stating because it looks like the fix: the strip
 * sat *above* the header, so insetting it by the notch moved the readout from
 * 7..31 down to 47..71 — onto the wordmark instead of above it.
 *
 * ## Why this is measured rather than composed from parts
 *
 * `safeAreaTop + headerHeight + gap` is the formula, and only the middle term
 * is hard. The header's height is not a constant: it carries three states with
 * different block padding, a wordmark that changes size with them, and a
 * transition between them — and on top of that it is the *shared* header, free
 * to change on 67 other routes without this file being told. Any number written
 * down here is a number that goes stale silently.
 *
 * So the header is asked. Its measured border box already includes its own
 * safe-area padding — see the note in chrome.css — which is what collapses the
 * three-term formula to two and removes the double-count that an addition here
 * would produce on a notched device.
 *
 * ## Why a ResizeObserver and not the tick
 *
 * `publishHeader` runs sixty times a second and reading `offsetHeight` there
 * would be a forced layout per frame next to a WebGL renderer. The header's box
 * changes on a state transition, a rotation and a font swap, and a
 * `ResizeObserver` fires on exactly those and on nothing else. The strip then
 * follows the header down and up through the 0.45s state transition rather than
 * jumping at the end of it, so the two read as one deck.
 */
/**
 * Breathing room between the deck's layers. Small on purpose: it is the
 * difference between "under the header" and "floating below it", and every
 * pixel spent here is a pixel of the stage-entry budget §6 sets.
 */
const DECK_GAP = 6;

/**
 * The step both boundaries are quantised to.
 *
 * Not cosmetic and not a performance tweak. `--deck-content` is the floor under
 * `entryBudget`, and `entryBudget` takes part in the window/flow *decision* — so
 * a boundary that moves by one pixel can flip a panel sitting on it, and a panel
 * flipping between the two compositions changes its own box by a whole screen.
 * That resizes the track, which refreshes ScrollTrigger, which nudges the scroll
 * position, which moves the altitude, which moves the instrument's exclusion
 * band, which flips the panel back.
 *
 * Measured before this existed: a steady 4px oscillation of `window.scrollY`,
 * reversing every ~250ms, indefinitely, with nobody touching the page. A page
 * that scrolls itself is the one thing §4 rules out, and it was arriving through
 * the layout rather than through any scroll handler — which is why it survived
 * a source audit that found no hijacking.
 *
 * 8px is far below anything anyone can see in a gap and far above the sub-pixel
 * chatter of a text box remeasuring as the stage name changes, so the loop
 * cannot start.
 */
const DECK_STEP = 8;

/** Round up to the step, so a boundary never lands under its own content. */
const quantise = (px: number) => Math.ceil(px / DECK_STEP) * DECK_STEP;

let deckObserver: ResizeObserver | undefined;
let publishedTop = -1;
let publishedContent = -1;

function publishDeck(nav: Element, hud: Element | null) {
  const top = quantise(nav.getBoundingClientRect().height + DECK_GAP);
  if (top !== publishedTop) {
    publishedTop = top;
    document.documentElement.style.setProperty('--deck-top', `${top}px`);
  }

  // Where the narrative may start: below the header *and* below the instrument
  // line under it. Published separately because the two boundaries answer
  // different questions — the strip is positioned from the first, the panels'
  // entry budget is floored at the second — and because the strip is not on
  // every composition, so the second is not always the first plus something.
  const strip = hud ? hud.getBoundingClientRect().height : 0;
  const content = quantise(top + (strip > 0 ? strip + DECK_GAP : 0));
  if (content !== publishedContent) {
    publishedContent = content;
    document.documentElement.style.setProperty('--deck-content', `${content}px`);
  }
}

/**
 * Start publishing `--deck-top` and `--deck-content`. Idempotent, and a no-op
 * where the shared header is not on the page — the stylesheet's fallbacks cover
 * that, and they are the values the header resolves to at the design inset.
 */
export function watchDeck(): () => void {
  const nav = document.querySelector('.nav');
  if (!nav || typeof ResizeObserver !== 'function') return () => {};
  const hud = document.querySelector('.hud');
  deckObserver?.disconnect();
  publishDeck(nav, hud);
  deckObserver = new ResizeObserver(() => publishDeck(nav, hud));
  // `border-box`, and it is not a detail.
  //
  // The header's three states differ mostly in *padding*, and padding is what
  // it transitions over 0.45s. A default `content-box` observation watches the
  // flex line instead, which finishes changing early — the wordmark reaches its
  // compact size well before the padding reaches its compact value — so the
  // last callback fires mid-transition and the final height is never seen.
  // Measured: the journey header settles at 48px and `--deck-top` was left
  // describing a 70px one, which put 22px of dead space under a header that had
  // already finished compressing.
  deckObserver.observe(nav, { box: 'border-box' });
  // The strip's height changes with the sound control's focus ring and with a
  // font swap, and it is the floor under every panel's entry budget, so it is
  // observed rather than assumed.
  if (hud) deckObserver.observe(hud, { box: 'border-box' });
  return () => {
    deckObserver?.disconnect();
    deckObserver = undefined;
    publishedTop = -1;
    publishedContent = -1;
    document.documentElement.style.removeProperty('--deck-top');
    document.documentElement.style.removeProperty('--deck-content');
  };
}

/**
 * Hand the header back to document scroll.
 *
 * Called when the clock stops: an unmount, or a live visitor turning on
 * reduced motion, which tears `JourneyHUD` down. Without this the header would
 * hold the last altitude it was pushed forever, on a page that has become an
 * ordinary scrolling document.
 */
export function releaseHeader(): void {
  header()?.release();
  shownStage = '';
  label = '';
  seed = '';
}

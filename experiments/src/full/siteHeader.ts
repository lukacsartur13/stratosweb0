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

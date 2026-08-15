import type { StageId } from '../journey';

/**
 * The instrument's authored positions, and the small state machine that picks
 * between them.
 *
 * ## The defect this exists to fix
 *
 * The portrait Altimeter used to be one element in the opening section's block
 * flow. That gave it a perfect hero frame and exactly one screen of life: the
 * moment the visitor scrolled past the first section the signature object of
 * the page left the experience entirely, and the remaining sixteen screens were
 * typography over a gradient. "Where did the Altimeter go?" was the correct
 * reaction, because it had gone.
 *
 * ## What replaces it, and what it deliberately is not
 *
 * The instrument is now a persistent overlay that the journey moves between a
 * handful of AUTHORED positions. It is not a second scene, not a second model,
 * and not a widget that appears when the hero one disappears — it is the same
 * `<Canvas>`, the same GLB and the same needles, moved.
 *
 * The table below is the whole composition. It is a table of constants read
 * against the overlay's own box, which is what makes it design logic rather
 * than measurement: nothing here asks a paragraph how tall it is, nothing here
 * solves a collision, and nothing computed here can reach the document. The
 * overlay is `position: fixed` and `pointer-events: none`, so there is no code
 * path by which a number in this file could move a word on the page.
 *
 * ## Why the rail is on the right at every left-aligned stage
 *
 * §"Layout" asks for the composition to be authored around a known instrument
 * anchor, alternating side where the composition wants it. On this page the
 * copy column is left-aligned and runs the full measure at all four portrait
 * viewports, and three of the stages (`lower-atmosphere`, `system`, `process`)
 * hang their content off a Meridian rule on the LEFT edge of that column. A
 * left dock would sit on that rule at every one of them.
 *
 * So the authored alternation on this page is not left/right. It is:
 *
 *   * a right rail, low, wherever the stage's copy is left-aligned and long;
 *   * the CENTRE, larger, at the two centred statement beats and at Arrival —
 *     the three stages whose copy is short, centred and has real air around it,
 *     which is exactly where the instrument can take the middle of the frame
 *     without displacing a line of anything.
 *
 * That is a composition decision about this page's typography, and it is stated
 * here rather than discovered at runtime.
 *
 * ## And why none of it covers a word
 *
 * It cannot. The overlay is painted UNDER the copy — see the note on
 * `.mv-flow`'s z-index in mobile.css. That is what makes a table of authored
 * positions sufficient: a position only has to be a good place for the
 * instrument to be, not a place no paragraph will ever reach, and the accepted
 * typography keeps its full measure on every screen because the instrument
 * arriving costs the flow nothing.
 *
 * The opacities below are the other half of that decision. They are not "how
 * visible is the instrument" — they are how much it competes with the line
 * crossing it.
 */

/* ============================================================ the states === */

export type InstrumentStateId =
  | 'hero'
  | 'ascent'
  | 'capabilities'
  | 'summit'
  | 'work'
  | 'process'
  | 'arrival'
  | 'recede';

/** Degrees, in the units the scene rotates in. */
const DEG = Math.PI / 180;

/**
 * The instrument's drawn box, before any state's scale.
 *
 * 86% of the width, which is the same solve the in-flow slot used and lands on
 * exactly the accepted hero frame: 335px at 390x844, 370 at 430x932, 322 at
 * 375x812, 310 at 360x800.
 *
 * ## Why there is a height term here and not in the CSS
 *
 * The slot's stylesheet argues at length that a layout height must never depend
 * on the viewport's height, because a cap that binds makes the box a function
 * of `innerHeight` and every rotation, keyboard and toolbar transition reflows
 * the document beneath it. That argument is about a box IN FLOW, and it still
 * holds — the hero's reserve is width-driven and keeps its landscape override.
 *
 * The overlay is not in flow. It is fixed and pointer-transparent, so its size
 * reflows nothing, and in landscape a width-driven square would be 726px on a
 * 390px-tall screen. `0.46 * h` is inert in portrait at every viewport in the
 * matrix — the aspect ratio would have to fall below 1.87 for it to bind, and
 * the tallest-per-width phone in portrait is 2.08 — and in landscape it lands
 * on the reserve's own 180px box.
 */
export const instrumentSize = (w: number, h: number) => Math.min(0.86 * w, 0.46 * h);

/** How far the rail keeps the case off the side of the frame. */
const GUTTER = 14;

/**
 * How far the rail keeps the case off the bottom.
 *
 * Solved against the telemetry strip rather than chosen: the strip's rule sits
 * `3.4rem` (54px) above its own padded base, so a lift of 74 puts the
 * instrument's lower edge ~30px clear of the rule at every viewport in the
 * matrix and leaves the readout completely unobstructed. The two are the only
 * fixed objects on the page and they must never touch.
 */
const RAIL_LIFT = 74;

export type Placement = {
  /** The centre of the drawn instrument, in the overlay's own coordinates. */
  x: (w: number, h: number, drawn: number) => number;
  y: (w: number, h: number, drawn: number) => number;
  /** A fraction of `instrumentSize`. The canvas never resizes; this is a transform. */
  scale: number;
  opacity: number;
  /** The attitude the case holds in this state. */
  pitch: number;
  yaw: number;
};

/**
 * A rail position: hard against the right gutter, low, above the telemetry.
 *
 * The instrument is the same object at the same attitude family in all four of
 * these — a mounted panel gauge seen slightly off-axis. What changes between
 * them is presence: how big it is and how much of the frame it is asking for.
 */
const rail = (scale: number, opacity: number, pitch: number, yaw: number): Placement => ({
  x: (w, _h, drawn) => w - drawn / 2 - GUTTER,
  y: (_w, h, drawn) => h - drawn / 2 - RAIL_LIFT,
  scale,
  opacity,
  pitch,
  yaw,
});

/** A centred position, for the stages whose copy is centred and short. */
const centre = (
  scale: number,
  opacity: number,
  at: number,
  pitch: number,
  yaw: number,
): Placement => ({
  x: (w) => w / 2,
  y: (_w, h) => h * at,
  scale,
  opacity,
  pitch,
  yaw,
});

/**
 * The seven states, and one of them is a departure.
 *
 * ## On the attitudes
 *
 * Every yaw below is under eleven degrees and every pitch under four. That is
 * not timidity, it is the same constraint the accepted hero pose was chosen
 * under: past about nine degrees of yaw the dial stops projecting as a circle
 * and starts projecting as an ellipse, which is the moment an instrument reads
 * as a render of one. The rail states sit at the top of that range because a
 * gauge mounted off to one side of a panel IS seen off-axis; the centred states
 * square up towards the viewer, because an object in the middle of the frame
 * that is turned away from you reads as misaligned rather than as posed.
 *
 * There is no roll anywhere. An altimeter with its zero off the vertical reads
 * as broken.
 */
export const PLACEMENTS: Record<InstrumentStateId, Placement> = {
  /**
   * The opening frame. Position is not from this table — it is the opening
   * section's own reserved band, so the hero composition the review accepted is
   * reproduced exactly at every viewport and in all three locales rather than
   * approximated by a viewport fraction. See `heroPlacement` below.
   */
  hero: { x: (w) => w / 2, y: (_w, h) => h * 0.58, scale: 1, opacity: 1, pitch: -3.6 * DEG, yaw: 6.8 * DEG },

  /**
   * Arrived on the rail. The state the hero transition lands in.
   *
   * ## On the opacities in this table
   *
   * The instrument sits behind the copy — see `.mv-flow`'s z-index — so these
   * are not "how visible is it", they are "how much does it compete with the
   * line that happens to be crossing it". At full strength a white numeral on
   * the dial and a white word on top of it are the same value and both become
   * hard to read; in the low seventies the case still reads as machined metal
   * and the text in front of it reads as text.
   */
  ascent: rail(0.3, 0.74, -1.6 * DEG, 9.5 * DEG),

  /** The capability ladder. Same rail, a shade quieter under a dense list. */
  capabilities: rail(0.3, 0.68, -1.2 * DEG, 8.0 * DEG),

  /**
   * The two centred statement beats. Short copy, chapter spacing either side,
   * and the one place mid-journey where the instrument can hold the middle of
   * the frame — so it does, at nearly twice the rail's size and behind the
   * type rather than beside it.
   */
  summit: centre(0.52, 0.5, 0.5, -2.4 * DEG, 4.0 * DEG),

  /**
   * Selected work. The smallest and quietest state on the page: this stage is
   * the only one carrying photography, and the instrument's job over a case
   * study is to stay present without competing with it.
   */
  work: rail(0.26, 0.58, -1.0 * DEG, 10.5 * DEG),

  /** Seven checkpoints. Back to full rail presence over a long timeline. */
  process: rail(0.3, 0.7, -1.4 * DEG, 7.2 * DEG),

  /**
   * The destination. The needles have wound to 30 000 m, the copy is the
   * closing statement and the instrument comes back to the centre at three
   * quarters of its hero size, square to the viewer. This is the closure the
   * journey was climbing towards.
   */
  arrival: centre(0.78, 0.86, 0.46, -2.8 * DEG, 2.2 * DEG),

  /**
   * And then it leaves — deliberately, and only here.
   *
   * The homepage ends and the site's own Arrival panel and ground-control
   * footer begin. Those are shared chrome with their own composition and the
   * instrument is not part of them, so rather than hanging over a footer it
   * grows very slightly and fades out, which reads as the object receding from
   * the frame rather than as an element being switched off.
   */
  recede: centre(0.9, 0, 0.42, -2.8 * DEG, 2.2 * DEG),
};

/* ================================================== which state, and when === */

/**
 * The stage-to-state map. Discrete, and this is the whole of it.
 *
 * §"Persistent states" asks for authored states switched on section changes
 * rather than a continuous measurement of nearby content, and this is that map
 * written out. Two stages share `ascent` and two share `summit` because the
 * composition genuinely does not change between them — inventing a state per
 * section would be seven positions where the page has four ideas.
 */
const BY_STAGE: Record<StageId, InstrumentStateId> = {
  calibration: 'hero',
  'initial-ascent': 'ascent',
  'lower-atmosphere': 'capabilities',
  'cloud-entry': 'ascent',
  'cloud-breakthrough': 'summit',
  'selected-work': 'work',
  system: 'capabilities',
  process: 'process',
  'stratosphere-transition': 'ascent',
  'full-stratosphere': 'summit',
  destination: 'arrival',
};

/**
 * Where inside the opening section the hero frame gives way.
 *
 * The opening section is taller than a screen: under the instrument it carries
 * the instrument's caption, the lead paragraph and the two calls to action. All
 * three scroll up through the frame the hero instrument is holding, so the hero
 * state cannot last until the section ends — it has to hand over while the
 * instrument's own reserved band is still the thing on screen.
 *
 * Expressed in the section's altitude band rather than in pixels: the opening
 * band is 0–150 m, and 26% of it is reached about a third of a screen into the
 * document at every viewport in the matrix. That is a narrative coordinate the
 * page already computes, so this costs nothing and cannot go stale.
 */
const HERO_HANDOVER = 0.26;

/**
 * How much of a screen the hero transition takes.
 *
 * The launch is scroll-linked rather than timed — see `heroLeg` — so this is
 * the distance over which the instrument leaves the document and arrives on the
 * rail. Six tenths of a screen is long enough that the scale change is a move
 * rather than a jump, and short enough that the instrument is docked before the
 * lead paragraph beneath it has finished crossing.
 */
export const HERO_TRAVEL = 0.6;

/**
 * The state the journey is in.
 *
 * `ended` is the one input that is not the ascent: it is an
 * `IntersectionObserver` on a marker at the foot of the homepage flow, because
 * "the homepage is over" is a structural fact about the document and not an
 * altitude — the shared Arrival panel and footer below it have no band.
 */
export function stateAt(stage: StageId, altitude: number, ended: boolean): InstrumentStateId {
  /**
   * The recede is scoped to the closing stage, and that is not belt-and-braces.
   *
   * `ended` comes from an `IntersectionObserver`, which is asynchronous, so
   * there is a window after any jump AWAY from the foot of the page in which it
   * is still true — a fragment link back to the top, a `scrollTo(0)`, a bfcache
   * restore, the reveal pass a test does. Left ungated, the instrument spends
   * that window at zero opacity in a state it has already left: measured on the
   * no-WebGL path, a jump from the footer to the top produced a completely
   * invisible instrument in the hero frame.
   *
   * Gating on the stage makes the marker what it actually is — the answer to
   * "has the closing stage finished", not to "where are we" — and the ascent
   * reader, which is synchronous, decides the rest.
   */
  if (ended && stage === 'destination') return 'recede';
  if (stage === 'calibration') {
    return altitude < 150 * HERO_HANDOVER ? 'hero' : 'ascent';
  }
  return BY_STAGE[stage] ?? 'ascent';
}

/** A symmetric ease. Nothing here overshoots, because mass does not. */
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * The hero leg: the one scroll-linked stretch on the page.
 *
 * Everything else about the instrument is discrete — a state is chosen, and a
 * settle carries the object to it. The hero is the exception, and deliberately:
 * §"Hero → persistent instrument" asks for the transition to feel like the hero
 * object *becoming* the flight instrument, and an object that is pinned to the
 * viewport while the page slides out from under it has already stopped being
 * part of the hero before it starts moving.
 *
 * So for the first `HERO_TRAVEL` of a screen the instrument is interpolated
 * between two frames of reference:
 *
 *   t = 0   exactly where the opening section reserved it, moving with the
 *           document, indistinguishable from the in-flow instrument it replaces
 *   t = 1   exactly the `ascent` placement, stationary, docked
 *
 * The ease is what makes it read as one gesture: the instrument releases the
 * page slowly, accelerates across, and settles onto the rail rather than
 * arriving at speed. Beyond t = 1 nothing here runs again for the rest of the
 * read — no scroll position is consulted by the instrument's composition after
 * the launch is over.
 */
export function heroLeg(scrollTop: number, viewport: number): number {
  const travel = Math.max(1, viewport * HERO_TRAVEL);
  return ease(clamp01(scrollTop / travel));
}

/**
 * The hero's position, from the band the opening section reserved for it.
 *
 * `anchorCentre` is the document offset of the middle of that band, cached on
 * the shared measurement bus (fonts, resize, orientation, `visualViewport`,
 * bfcache) exactly as the sections' own offsets are. It is read from a
 * placeholder whose box is a CSS constant, by an overlay that is fixed and
 * cannot be laid out against, so the direction is strictly one way: the page
 * tells the instrument where the hero frame is, and the instrument has no way
 * of answering.
 *
 * This is why the hero is not a viewport fraction like every other state. A
 * fraction would put the instrument *near* the reserved band on most viewports
 * and slightly wrong on the rest, in whichever of the three locales has the
 * taller headline. The opening frame is the one this page is judged on, and it
 * is worth one cached number to have it be exact.
 */
export function heroPlacement(anchorCentre: number, anchorX: number, scrollTop: number): {
  x: number;
  y: number;
} {
  return { x: anchorX, y: anchorCentre - scrollTop };
}

/* ================================================ the state, as a signal === */

/**
 * A three-line store, and the reason it is not React state.
 *
 * Two consumers need the current state: the overlay, which moves a `transform`,
 * and the scene, which changes an attitude and asks for a frame. Putting it
 * through `useState` would reconcile a React tree containing a `<Canvas>` on
 * every state change — and react-three-fiber invalidates on every root render,
 * so a state change would cost a render of the whole subtree in order to
 * communicate two numbers that are then written imperatively anyway.
 *
 * It also keeps `three` out of the overlay. The overlay never imports the
 * renderer — that is what lets a device with no WebGL avoid downloading it —
 * so the scene subscribes here rather than the overlay reaching into the scene.
 */
type Listener = (state: InstrumentStateId, visible: boolean) => void;

let current: InstrumentStateId = 'hero';
let visible = true;
const listeners = new Set<Listener>();

/** Publish. A no-op when nothing changed, so this is safe to call per frame. */
export function publishInstrument(state: InstrumentStateId, isVisible: boolean): void {
  if (state === current && isVisible === visible) return;
  current = state;
  visible = isVisible;
  for (const listener of listeners) listener(current, visible);
}

/**
 * Subscribe. Called once synchronously at registration, so a subscriber never
 * renders a frame against a state it has not been told about yet.
 */
export function onInstrument(listener: Listener): () => void {
  listeners.add(listener);
  listener(current, visible);
  return () => {
    listeners.delete(listener);
  };
}

/** For a fresh mount that needs the value without subscribing. */
export const instrumentNow = () => ({ state: current, visible });

/** Reset, for the unmount path — the store outlives the components. */
export function resetInstrument(): void {
  current = 'hero';
  visible = true;
}

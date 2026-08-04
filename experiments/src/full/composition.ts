/**
 * The composition: where the instrument lands on screen, and what room that
 * leaves the copy.
 *
 * ## Why this module exists at all
 *
 * Three files used to answer the question "how big is the instrument, right
 * now, on this viewport" and none of them could answer it for the other two.
 * `JourneyCamera` owned the frame and the dolly, `AltimeterMeridian` owned the
 * recede, and `styles.css` owned a hand-tuned guess at where the dial would be
 * (the `38%`/`62%` stops in the portrait plate gradient). That guess was
 * measured once, on one viewport, at one altitude — and §9.2 of the Phase 6
 * report is the bill for it: on a 768×1024 the essential silhouette is 37% of
 * the viewport height, not the 23% the stops were tuned against, so the copy
 * bands were laid out over the dial.
 *
 * Everything here is a pure function of `(altitude, viewport)`. Nothing reads
 * the scroll position, nothing holds a timeline, and nothing is
 * direction-dependent — which is what makes forward and reverse traversal
 * identical by construction rather than by test (§7).
 *
 * ## The projection is exact, not approximate
 *
 * The instrument is centred on the view axis and rides at exactly the camera's
 * height (see `cameraHeightAt`), so its projected height is a closed form:
 *
 *     px = localHeight × scale / (2 × distance × tan(vFov / 2)) × viewportHeight
 *
 * Checked against the live renderer through the dev handle at eleven altitudes
 * on a 390×844: predicted 174.8px against a measured 175px at 0 m, and 153.3px
 * against 153px at 12 000 m. The one-pixel residual is the model's AABB being
 * conservative under the pose rotation, which is the safe error direction — the
 * band it sizes is never smaller than the object it has to clear.
 */

import { STAGES, STAGE_BOUNDS, clamp, ease, journey, lerp, span, type StageId } from './journey';
import { ALTITUDE_STOPS, smoothRange } from './meridian';

// =============================================================================
// The camera frame.
//
// Moved here from JourneyCamera unchanged — same constants, same curves, same
// values at every aspect. It lives here now because the copy bands need the
// same numbers the camera uses, and a second copy of them is a second thing to
// keep in step. `JourneyCamera` imports them back.
// =============================================================================

/** The vertical field of view, in degrees. Set on the camera in JourneyScene. */
export const FOV = 32;

export const FRAME_WIDTH_PORTRAIT = 2.2;
export const FRAME_WIDTH_WIDE = 3.5;
export const FRAME_HEIGHT_BASE = 1.24;
export const FRAME_HEIGHT_LANDSCAPE = 2.15;
export const LANDSCAPE_ASPECT_FROM = 1.85;
export const LANDSCAPE_ASPECT_TO = 2.2;

/**
 * The distance at which the instrument exactly fills the frame, whichever axis
 * binds. Everything in the dolly is a multiple of this, so the composition
 * survives a resize and a phone.
 */
export function fitDistance(aspect: number, fov = FOV): number {
  const vFovHalf = (fov * Math.PI) / 360;
  const hFovHalf = Math.atan(Math.tan(vFovHalf) * Math.max(aspect, 1e-3));
  const frameWidth = lerp(FRAME_WIDTH_PORTRAIT, FRAME_WIDTH_WIDE, clamp((aspect - 1) / 1));
  const frameHeight = lerp(
    FRAME_HEIGHT_BASE,
    FRAME_HEIGHT_LANDSCAPE,
    clamp((aspect - LANDSCAPE_ASPECT_FROM) / (LANDSCAPE_ASPECT_TO - LANDSCAPE_ASPECT_FROM)),
  );
  return Math.max(frameWidth / 2 / Math.tan(hFovHalf), frameHeight / 2 / Math.tan(vFovHalf));
}

/** The dolly's four legs, as a multiple of `fitDistance`. */
export function dollyK(metres: number): number {
  let k = lerp(1.06, 0.94, ease(span(metres, 0, 2_400)));
  k = lerp(k, 1.14, ease(span(metres, 5_000, 9_500)));
  k = lerp(k, 1.3, ease(span(metres, 9_500, 17_000)));
  k = lerp(k, 1.38, ease(span(metres, 24_000, 30_000)));
  return k;
}

// =============================================================================
// The recede.
// =============================================================================

/**
 * Local height of the essential silhouette's world AABB at scale 1.
 *
 * Measured off the live scene graph at eleven altitudes: 1.010 at its smallest
 * (3 000 m, the instrument square to the camera) and 1.0454 at its largest
 * (0 m, where the ground pose's −7° pitch and 12° yaw swing the housing corners
 * widest). The maximum is the one that matters — the band this sizes has to
 * clear the object at its largest, not on average.
 */
export const ESSENTIAL_LOCAL_HEIGHT = 1.0454;

/** Scale the instrument group takes at a given recede. */
export const recededScale = (recede: number) => lerp(1, 0.62, recede);
/** How far back in depth the instrument group withdraws at a given recede. */
export const recededDepth = (recede: number) => -recede * 1.35;

/**
 * The narrative recede — the round trip that was already here.
 *
 *   12 300 → 15 600  hands over, through the four case studies
 *   16 200 → 19 200  comes most of the way back, for the system and process
 *   24 000 → 30 000  the rest of the way, for the Meridian state
 *
 * Unchanged in behaviour and unchanged on every landscape and desktop
 * viewport. `finalCalibration` is passed in rather than read off the meridian
 * singleton so this stays a pure function of altitude.
 */
export function narrativeRecede(metres: number, finalCalibration: number): number {
  const handover = ease(span(metres, 12_300, 15_600));
  const back = ease(span(metres, 16_200, 19_200)) * 0.66;
  return clamp(handover - back - finalCalibration * 0.26);
}

/**
 * How far the dense-stage recede may go, on top of the narrative one.
 *
 * 0.30 is not a taste value. Projected size goes as `scale / distance`, and
 * both terms move together here, so at the working distance on a 390×844
 * (9.78 world units at 12 000 m) a recede of 0.30 reads as
 *
 *     0.886 × 9.78 / (9.78 + 0.405) = 0.851
 *
 * — a 15% reduction in projected size, inside the 8–18% the decision asked to
 * search, and the smallest value that clears the measured collisions on the
 * standard portrait matrix (searched at 0.10/0.18/0.24/0.30/0.36; 0.24 still
 * left the ladder stage's lead band 11px short on a 360×800).
 *
 * It is added to the narrative recede and the sum is clamped to 1, so the
 * instrument never goes below the 0.62 scale the case studies already take it
 * to. There is no altitude at which this makes the instrument smaller than a
 * state the accepted composition already contains.
 */
export const DENSE_RECEDE_MAX = 0.3;

/** Metres of smoothstep at each end of a dense stage's altitude range. */
const DENSE_RAMP = 500;

/**
 * The stages whose copy does not fit the band pair, measured rather than
 * declared.
 *
 * Filled by `measureDensity()` from the live DOM after the fonts have settled,
 * because whether a panel is "dense" is a fact about the rendered copy at this
 * viewport in this locale, not about which class it carries. `.panel--centre`
 * is a layout choice; the cloud-breakthrough panel wears it and holds 181px of
 * copy, which fits any band this composition produces and must not trigger a
 * recede (§1: "Do not apply this recede to sparse portrait panels").
 */
const dense = new Set<StageId>();

/**
 * 0..1 — how strongly the dense-stage recede applies at this altitude.
 *
 * A pure function of the altitude and the measured dense set: same altitude,
 * same answer, whichever direction the visitor arrived from.
 */
export function denseAt(metres: number): number {
  let strongest = 0;
  for (const stage of STAGES) {
    if (!dense.has(stage.id)) continue;
    // Smoothstepped in over DENSE_RAMP at the bottom edge and out at the top,
    // so the instrument is never seen to step.
    const rise = ease(span(metres, stage.from - DENSE_RAMP, stage.from + DENSE_RAMP));
    const fall = 1 - ease(span(metres, stage.to - DENSE_RAMP, stage.to + DENSE_RAMP));
    strongest = Math.max(strongest, Math.min(rise, fall));
  }
  return strongest;
}

/**
 * The recede the instrument actually takes.
 *
 * `portrait` is the measured 0..1 portrait strength — 0 on every landscape and
 * desktop viewport, which is what confines this whole mechanism to portrait
 * without a second code path.
 */
export function recedeAt(metres: number, finalCalibration: number, portrait: number): number {
  return clamp(narrativeRecede(metres, finalCalibration) + DENSE_RECEDE_MAX * denseAt(metres) * portrait);
}

// =============================================================================
// The measured viewport.
// =============================================================================

export type Fit = {
  /** Usable width and height: `visualViewport` less the safe-area insets. */
  vw: number;
  vh: number;
  aspect: number;
  portrait: boolean;
  /**
   * 0..1 — how strongly the portrait composition applies. Zero at square and
   * above, so nothing landscape or desktop can ever see any of it.
   */
  strength: number;
};

/**
 * Read the usable viewport.
 *
 * `visualViewport` rather than `innerHeight`, because on a phone the two differ
 * by the browser chrome and §4 is explicit that the chrome-excluded box is the
 * one the centre tolerance and the bands are measured against. The safe-area
 * insets come off a probe element rather than from a guess, because `env()` is
 * only readable through layout.
 */
export function readFit(): Fit {
  if (typeof window === 'undefined') {
    return { vw: 1440, vh: 900, aspect: 1.6, portrait: false, strength: 0 };
  }
  const vv = window.visualViewport;
  const inset = (name: string) => {
    const probe = document.createElement('div');
    probe.style.cssText = `position:fixed;height:env(${name});width:0;visibility:hidden;pointer-events:none`;
    document.body.appendChild(probe);
    const v = probe.getBoundingClientRect().height;
    probe.remove();
    return Number.isFinite(v) ? v : 0;
  };
  // The *composition* box, not the visual viewport, when the two differ.
  //
  // `visualViewport` is the right box for §4's centre tolerance, and it is what
  // `validate-meridian` measures against. It is the wrong box for the bands,
  // and on a desktop or in a headless browser nothing reveals the difference
  // because there the two are the same number to the pixel.
  //
  // On a phone they are not. The sticky stage — which is the canvas, which is
  // what the instrument is centred in and projected onto — is `100svh`, the
  // *small* viewport height, deliberately: it does not resize while the browser
  // chrome slides away, so the scene does not reflow under the visitor's thumb.
  // `visualViewport.height` is the *current* height and grows by the height of
  // the chrome when it collapses. Sizing the bands from that while the plate,
  // the stage and the canvas are all sized from `svh` means two bands and a gap
  // that add up to more than the plate they are rows of, and the lower band
  // spills past the bottom of the frame. It also scales the projected height by
  // the wrong viewport, so the exclusion band is computed for an instrument
  // larger than the one on screen.
  //
  // So the box is read off the stage element when there is one, and falls back
  // to the visual viewport only where there is no scene to measure — the
  // reduced-motion and no-WebGL paths, which have no projected instrument to
  // clear either.
  const stage = document.querySelector('.journey__stage')?.getBoundingClientRect();
  const vw =
    (stage && stage.width > 0 ? stage.width : (vv?.width ?? window.innerWidth)) -
    inset('safe-area-inset-left') -
    inset('safe-area-inset-right');
  const vh =
    (stage && stage.height > 0 ? stage.height : (vv?.height ?? window.innerHeight)) -
    inset('safe-area-inset-top') -
    inset('safe-area-inset-bottom');
  const aspect = vw / Math.max(vh, 1);
  // Ramped rather than switched, so a viewport that is very nearly square does
  // not jump between two compositions on a one-pixel resize.
  const strength = clamp((1 - aspect) / 0.15);
  return { vw, vh, aspect, portrait: aspect < 1, strength };
}

/**
 * The instrument's projected height, in CSS pixels.
 *
 * The closed form checked against the renderer in the header comment. `recede`
 * is the live, damped value when the scene is mounted (see `setLiveRecede`) and
 * the analytic target otherwise, so the band never lags the object it clears.
 */
export function projectedEssentialHeight(fit: Fit, metres: number, recede: number): number {
  const distance = fitDistance(fit.aspect) * dollyK(metres) - recededDepth(recede);
  const worldHeight = 2 * distance * Math.tan((FOV * Math.PI) / 360);
  return (ESSENTIAL_LOCAL_HEIGHT * recededScale(recede)) / worldHeight * fit.vh;
}

/**
 * The exclusion band: the instrument's projected height, plus everything the
 * validator adds to it before it tests for a collision.
 *
 *   pad     the 1.5vmin visual safety margin `validate-meridian` expands the
 *           projected bounds by, on both edges. Budgeting to the bare
 *           silhouette passes geometry and fails the check — the same mistake
 *           the landscape copy budget made in §9.1.
 *   drift   the residual centre deviation. The instrument is centred by
 *           construction but the pointer parallax rotates the camera by up to
 *           two degrees and the measured `dy` runs to 0.6% of viewport height,
 *           so the band is grown symmetrically by twice that rather than
 *           assuming a perfectly centred projection.
 */
export function exclusionBand(fit: Fit, metres: number, recede: number): number {
  const pad = Math.max(8, Math.min(fit.vw, fit.vh) * 0.015);
  const drift = fit.vh * 0.012;
  return projectedEssentialHeight(fit, metres, recede) + 2 * pad + 2 * drift;
}

// =============================================================================
// The live recede, and the one place it is written.
// =============================================================================

let liveRecede: number | null = null;

/**
 * `AltimeterMeridian` publishes its damped recede here once per frame.
 *
 * The band has to be sized from the value the instrument is *actually* at, not
 * from the value it is heading for. `settle()` lands exactly (see
 * SETTLE_EPSILON), so at rest the two are the same number and §7's exact
 * forward/reverse equality is untouched; during a fast scroll the damped value
 * trails the target, and it trails it *large* — the instrument is still at the
 * size it is leaving. A band sized from the target would be the smaller of the
 * two, which is the one direction that produces a collision.
 *
 * `null` when the scene is not mounted — the reduced-motion and no-WebGL paths
 * never run a frame loop — and the analytic target is used instead.
 */
export function setLiveRecede(value: number | null) {
  liveRecede = value;
}

// =============================================================================
// Publication.
// =============================================================================

const shown = new Map<string, string>();

function put(el: HTMLElement, name: string, value: string) {
  const key = `${(el as HTMLElement).dataset?.stage ?? 'root'}:${name}`;
  if (shown.get(key) === value) return;
  shown.set(key, value);
  el.style.setProperty(name, value);
}

/** Quantised, so a value that changes by a fraction of a pixel costs no reflow. */
const q = (px: number, step: number) => Math.ceil(px / step) * step;

/**
 * Stage progress without the clamp.
 *
 * `stageProgress` saturates at 0 and 1, which is right for everything that asks
 * "how far through this stage are we". The portrait plate is stuck for a screen
 * either side of its own stage — that is the whole point of the overlap — so it
 * needs to know it is at −0.4 rather than at 0.
 */
function rawProgress(progress: number, id: StageId): number {
  const b = STAGE_BOUNDS.find((x) => x.id === id);
  if (!b) return 0;
  return (progress - b.start) / (b.end - b.start || 1);
}

/**
 * The plate's visible range, in units of stage progress.
 *
 * One screen of scroll is `1 / share` of a stage's progress, which is where
 * every number here comes from.
 *
 * ## The hand-off is sequential, not simultaneous
 *
 * The first version faded the outgoing plate out and the incoming one in across
 * the *same* screen of scroll. Both are then at half opacity at the midpoint,
 * and because both have copy in the same two bands, the result on screen is two
 * headlines and two paragraphs overlaid — a double exposure, at every one of the
 * ten stage boundaries. Photographed on a 390×844 at 29 840 m: the closing
 * headline legible over the ghost of the stratosphere panel's lead paragraph.
 *
 * So the handover window is split. Each boundary owns `h` screens of shared
 * sticky range; the outgoing plate fades out across the first half of it and the
 * incoming plate fades in across the second, meeting exactly at the midpoint. At
 * every scroll position at most one plate is painted above a trace, and the
 * transition reads as a hand-off rather than as a fault.
 *
 * `h` is capped at 40% of the outgoing stage, so a one-screen stage does not
 * spend its life fading, and it is measured against the *outgoing* stage on both
 * sides of the boundary — the two plates have different shares, and a window
 * that is half a screen for one and a third of a screen for the other does not
 * meet in the middle.
 *
 * ## The copy is walked only while the plate is legible
 *
 * `--stage-flow` runs from the instant the plate starts appearing to the instant
 * it starts leaving, rather than across the whole sticky range. The difference
 * is content, not polish: copy that is still arriving during the fade-out is
 * copy the visitor is shown only at declining opacity, which for the tail of a
 * dense panel means the last of it is never presented at full contrast.
 */
function windowOf(id: StageId) {
  const i = STAGES.findIndex((s) => s.id === id);
  if (i < 0) return null;
  const share = STAGES[i].share;
  const isFirst = i === 0;
  // The last stage never begins to leave, and the difference is not symmetry
  // for its own sake. Every other stage stops walking its copy one handover
  // before its end, because that is where the next plate takes over. Past the
  // end of the *last* stage there is no scroll — the track stops and the footer
  // begins — so a stage that reserved a handover there would finish its walk at
  // a scroll position the visitor cannot reach, and the closing panel's contact
  // line and stage index would be permanently unreachable. Which is the one
  // thing §5 rules out.
  const isLast = i === STAGES.length - 1;
  /** Handover window at the end of a stage of the given share, in screens. */
  const handover = (s: number) => Math.min(1, 0.4 * s);
  /** This stage's own outgoing window, and the previous stage's, as progress. */
  const out = handover(share) / share;
  const incoming = isFirst ? 0 : handover(STAGES[i - 1].share) / share;

  return {
    /** Progress at which the plate begins to appear. */
    from: isFirst ? 0 : -incoming / 2,
    /** Progress at which it begins to leave, and the copy stops walking. */
    to: isLast ? 1 : 1 - out,
    /** Progress at which the fade-out completes: the midpoint of the window. */
    gone: isLast ? Infinity : 1 - out / 2,
  };
}

let fit: Fit = readFit();
let panels: HTMLElement[] = [];

/** The smallest flow band worth compositing into. Below it, the panel flows. */
const MIN_FLOW_BAND = 120;

// =============================================================================
// Keyboard focus inside the flow window.
// =============================================================================

/**
 * Turn a band's own scroll into the document scroll that belongs to it.
 *
 * The flow band clips. When focus moves — by Tab — to a link that has been
 * walked out of it, the browser does what it does for any clipped region and
 * scrolls the region itself to bring the focused element into view. `overflow:
 * hidden` is not user-scrollable but it *is* programmatically scrollable, so
 * this succeeds, and it succeeds behind the composition's back: `--stage-flow`
 * still says the copy is where it was, the band is now offset from it by
 * however far the browser scrolled, and nothing ever puts it back. Measured by
 * tabbing through a 390×844: the stage index and the whole footer nav each left
 * the band 20–22px out of alignment, permanently.
 *
 * The fix is not to stop the browser — it is doing the right thing, and a link
 * you can focus but cannot see is worse than a misaligned band. It is to accept
 * the browser's decision about *how far* and apply it to the axis this
 * composition actually moves on: the document. Undo the band scroll, convert it
 * through the same chain `--stage-flow` is derived from, and scroll the page by
 * that instead. The copy then arrives in the band by the ordinary mechanism,
 * the altimeter, the instrument and the veil all follow it, and the state is
 * still a pure function of scroll position — a keyboard visitor and a scrolling
 * visitor end up in exactly the same place.
 *
 * Slight under- or over-shoot is self-correcting: the browser re-fires until
 * the element is in view, and each pass is smaller than the last.
 */
function adoptBandScroll(band: HTMLElement) {
  const delta = band.scrollTop;
  if (!delta) return;
  band.scrollTop = 0;

  const panel = band.closest('.panel') as HTMLElement | null;
  const stage = panel?.dataset.stage as StageId | undefined;
  if (!panel || !stage || panel.dataset.fit !== 'window') return;

  const w = windowOf(stage);
  const bounds = STAGE_BOUNDS.find((x) => x.id === stage);
  const inner = panel.querySelector<HTMLElement>('.panel__band-inner');
  if (!w || !bounds || !inner) return;

  // Pixels of copy the window has to walk, and the three factors between one
  // of those pixels and one pixel of document scroll.
  const travel = inner.scrollHeight - band.clientHeight;
  const track = document.querySelector<HTMLElement>('[data-testid="journey-track"]');
  const documentTravel = (track?.offsetHeight ?? document.documentElement.scrollHeight) - window.innerHeight;
  if (travel <= 0 || documentTravel <= 0) return;

  const perPixel = ((w.to - w.from) * (bounds.end - bounds.start) * documentTravel) / travel;
  window.scrollBy({ top: delta * perPixel, behavior: 'instant' });
}

/**
 * Capture phase, on the document, because `scroll` does not bubble. One
 * listener for every band rather than one per panel.
 */
function onAnyScroll(event: Event) {
  const target = event.target;
  if (target instanceof HTMLElement && target.classList.contains('panel__band--flow')) {
    adoptBandScroll(target);
  }
}

/**
 * Focus that lands on a plate the composition has faded out.
 *
 * The hand-over between stages is an `opacity` cross-fade, chosen so that a
 * plate waiting its turn stays in the document, in the accessibility tree and
 * in the reading order. The cost of that choice is that its links stay
 * *focusable* while they are invisible, and the browser's own focus handling
 * makes it worse rather than better: focusing an off-screen link scrolls the
 * document to the link's box, and a sticky plate's box begins a screen before
 * its stage does — which is exactly where its veil is still zero. Measured by
 * tabbing through a 390×844: 29 of 70 tab stops landed on a link inside a plate
 * at opacity 0.00, on screen, with nothing to see and no focus ring to follow.
 *
 * A keyboard visitor arriving at a stage's content should arrive at the *stage*
 * — the same thing a scrolling visitor gets. So focus is treated as navigation:
 * the journey scrolls to where that plate has fully arrived, the altimeter, the
 * instrument and the copy all follow, and the composition is the one the stage
 * is supposed to have. Two frames later `scrollIntoView` asks for the element
 * itself, and the band scroll that produces is adopted by `adoptBandScroll`
 * above, which walks the copy to it through `--stage-flow`.
 *
 * Nothing here is a second source of state: it only chooses a scroll position,
 * and every layer still derives from that one number.
 */
function onFocusIn(event: FocusEvent) {
  const el = event.target;
  if (!(el instanceof HTMLElement)) return;
  const panel = el.closest<HTMLElement>('.panel');
  if (!panel || panel.dataset.fit !== 'window') return;
  if (Number(panel.style.getPropertyValue('--panel-veil') || '1') > 0.5) return;

  const stage = panel.dataset.stage as StageId | undefined;
  const bounds = stage ? STAGE_BOUNDS.find((b) => b.id === stage) : undefined;
  if (!bounds) return;

  const track = document.querySelector<HTMLElement>('[data-testid="journey-track"]');
  const travel = (track?.offsetHeight ?? document.documentElement.scrollHeight) - window.innerHeight;
  if (travel <= 0) return;

  // The start of the stage: `windowOf` puts `from` at or below zero and the
  // fade-in completes at zero, so this is the first progress at which the plate
  // is fully opaque.
  window.scrollTo({ top: bounds.start * travel, behavior: 'instant' });
  requestAnimationFrame(() =>
    requestAnimationFrame(() => el.scrollIntoView({ block: 'nearest', behavior: 'instant' })),
  );
}

/**
 * Decide, per panel, between the windowed portrait composition and natural
 * vertical flow — and measure which stages are dense while we are here.
 *
 * This is §6's fork, and both sides of it are correct behaviour rather than a
 * success and a failure. A 390×844 in Hungarian has room for the immersive
 * composition; the same panel in German at 200% zoom does not, and there the
 * only right answer is to let the copy run below the fold and keep the
 * instrument as a smaller visible anchor.
 *
 * Measured after `document.fonts.ready` and again on resize, locale change and
 * text-size change, because every one of those moves the numbers being
 * compared. Nothing here is keyed to a device width.
 */
export function measureComposition(root: HTMLElement = document.documentElement) {
  fit = readFit();
  panels = [...document.querySelectorAll<HTMLElement>('.panel')];
  dense.clear();
  // Idempotent: the same function references, so repeated measurements do not
  // stack listeners.
  document.addEventListener('scroll', onAnyScroll, true);
  document.addEventListener('focusin', onFocusIn);

  // Sized at the recede the panel will actually be seen at, which for a dense
  // panel includes the dense term — otherwise the measurement decides "dense"
  // from a band the visitor never sees, and then the recede makes that band
  // bigger and the decision was taken against the wrong number. Two passes:
  // once without the dense term to find the dense set, once with it to lay the
  // bands out.
  const bandAt = (metres: number, portrait: number) => {
    // The same `finalCalibration` the instrument will be at, not zero: above
    // 24 000 m it winds the narrative recede back down, and a band sized
    // without it would be sized for an instrument smaller than the one the
    // closing panels actually show.
    const recede = recedeAt(metres, smoothRange(metres, ALTITUDE_STOPS.thirdRing, ALTITUDE_STOPS.meridian), portrait);
    return (fit.vh - exclusionBand(fit, metres, recede)) / 2;
  };

  // The two band wrappers are `display: contents` outside the portrait window,
  // which means they have no box and report a height of zero — so measuring
  // them as they stand would decide every panel was empty and put the whole
  // page into the fallback, permanently and silently. They are given a box for
  // the length of this function instead: all the writes first, then all the
  // reads, so the browser does one layout for the page rather than one per
  // panel.
  const bands = panels.flatMap((panel) => [
    panel.querySelector<HTMLElement>('.panel__band--lead'),
    panel.querySelector<HTMLElement>('.panel__band-inner'),
  ]);
  for (const band of bands) if (band) band.style.display = 'block';

  const measured = panels.map((panel) => ({
    panel,
    leadH: panel.querySelector<HTMLElement>('.panel__band--lead')?.getBoundingClientRect().height ?? 0,
    flowH: panel.querySelector<HTMLElement>('.panel__band-inner')?.getBoundingClientRect().height ?? 0,
  }));

  for (const band of bands) if (band) band.style.removeProperty('display');

  const midOf = (stage: StageId | undefined) => {
    const meta = stage ? STAGES.find((s) => s.id === stage) : undefined;
    return meta ? (meta.from + meta.to) / 2 : null;
  };

  // Pass one — which stages are dense. Every panel is asked before any answer
  // is used, because `denseAt` smoothsteps across a stage's edges and a panel's
  // band therefore depends on whether its *neighbours* are dense too. Deciding
  // and consuming in one loop would give the first panel a different answer
  // from the last for no reason but iteration order.
  //
  // The question is asked at the unreceded scale on purpose: a recede that
  // justified itself by the band it had already widened would be circular.
  for (const { panel, flowH } of measured) {
    const stage = panel.dataset.stage as StageId | undefined;
    const mid = midOf(stage);
    if (!stage || mid === null) continue;
    // The final Meridian state is excluded by name, which is §1's one explicit
    // carve-out. 30 000 m is the altitude the whole instrument has been
    // assembling towards, the recede has just been wound back down to show it,
    // and shrinking it again to make room for the closing plate would spend the
    // payoff to fit a call to action. Where the closing copy will not fit the
    // bands at full size the answer is the flow fallback below, not a smaller
    // instrument.
    if (stage === STAGES[STAGES.length - 1].id) continue;
    if (fit.portrait && flowH > bandAt(mid, 0)) dense.add(stage);
  }

  // Pass two — window or flow, per panel, against the band it will actually be
  // composed at.
  const decisions: Record<string, unknown> = {};
  for (const { panel, leadH, flowH } of measured) {
    const stage = panel.dataset.stage as StageId | undefined;
    const mid = midOf(stage);
    if (!stage || mid === null) continue;
    const band = bandAt(mid, fit.strength);
    // The windowed composition needs the headline band to hold the headline and
    // the flow band to be worth reading. Either failing is the fallback
    // condition, and the fallback is not a failure.
    const fits = fit.portrait && band >= MIN_FLOW_BAND && leadH > 0 && leadH <= band;
    panel.dataset.fit = fits ? 'window' : 'flow';
    panel.dataset.dense = dense.has(stage) ? '1' : '0';
    decisions[stage] = {
      band: Math.round(band),
      leadH: Math.round(leadH),
      flowH: Math.round(flowH),
      fit: panel.dataset.fit,
      dense: panel.dataset.dense,
    };
  }
  // Kept so a harness can ask *why* a panel composed the way it did instead of
  // reconstructing this arithmetic and comparing two implementations of it.
  lastMeasurement = { vw: Math.round(fit.vw), vh: Math.round(fit.vh), strength: fit.strength, decisions };

  root.dataset.composition = fit.portrait ? 'portrait' : 'landscape';
  shown.clear();
  publishComposition(root);
}

/**
 * Publish the composition for the current altitude. Called once per frame from
 * `JourneyHUD`'s existing tick — no second requestAnimationFrame, no second
 * scroll listener, and no React rerender per frame.
 */
export function publishComposition(root: HTMLElement = document.documentElement) {
  if (!fit.portrait) return;
  const metres = journey.altitude;
  const recede =
    liveRecede ??
    recedeAt(metres, smoothRange(metres, ALTITUDE_STOPS.thirdRing, ALTITUDE_STOPS.meridian), fit.strength);

  // 4px steps: below a quarter of a line's leading nothing moves that anyone
  // can see, and each step that does change costs one reflow of a panel rather
  // than sixty a second.
  put(root, '--meridian-gap', `${q(exclusionBand(fit, metres, recede), 4)}px`);

  for (const panel of panels) {
    if (panel.dataset.fit !== 'window') continue;
    const stage = panel.dataset.stage as StageId | undefined;
    if (!stage) continue;
    const w = windowOf(stage);
    if (!w) continue;

    // Unclamped, because the plate is stuck for a screen either side of its own
    // stage and both of those are outside 0..1. `stageProgress` clamps, which
    // is right for everything else that reads it and wrong here.
    const p = rawProgress(journey.current, stage);

    // The flow window walks the copy through the band over exactly the range in
    // which the plate is legible: from the first frame it starts appearing to
    // the last frame before it starts leaving.
    put(panel, '--stage-flow', clamp((p - w.from) / (w.to - w.from || 1)).toFixed(3));

    // The hand-off. In over the second half of the previous boundary's window,
    // out over the first half of this one's, so the two plates meet at the
    // midpoint instead of overlapping across it.
    //
    // The last stage never fades out — there is no plate behind it to reveal,
    // and fading the closing call to action away as the visitor reaches it
    // would be the page withdrawing its own conclusion.
    const arrive = w.from < 0 ? ease(span(p, w.from, 0)) : 1;
    const leave = Number.isFinite(w.gone) ? 1 - ease(span(p, w.to, w.gone)) : 1;
    const veil = arrive * leave;
    put(panel, '--panel-veil', veil.toFixed(3));
    // A plate nobody can see must not be able to take a click from the one
    // behind it. Half opacity is the hand-over point, and it is a threshold
    // rather than a ramp because `pointer-events` has no in-between.
    put(panel, '--panel-events', veil > 0.5 ? 'auto' : 'none');
  }
}

/** Reset everything this module wrote. Used when the journey unmounts. */
export function clearComposition(root: HTMLElement = document.documentElement) {
  document.removeEventListener('scroll', onAnyScroll, true);
  document.removeEventListener('focusin', onFocusIn);
  root.style.removeProperty('--meridian-gap');
  delete root.dataset.composition;
  for (const panel of panels) {
    panel.style.removeProperty('--stage-flow');
    panel.style.removeProperty('--panel-veil');
    panel.style.removeProperty('--panel-events');
    delete panel.dataset.fit;
    delete panel.dataset.dense;
  }
  panels = [];
  dense.clear();
  shown.clear();
  liveRecede = null;
}

/** The measured fit, for the debug panel and the validation harness. */
export const currentFit = () => fit;
/** The measured dense set, for the validation harness. */
export const denseStages = () => [...dense];

let lastMeasurement: unknown = null;
/** The last composition decision, per panel, with the numbers behind it. */
export const measurement = () => lastMeasurement;

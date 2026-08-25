import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { MeridianDrawing } from '../components/MeridianDrawing';
import { SceneBoundary } from '../components/SceneBoundary';
import { hasWebGL, renderScale } from '@/lib/capabilities';
import { meridianStageAt, type MeridianStageId } from '../meridian';
import { onAscent, onMeasure, viewportHeight } from './ascent';
import { prefersReducedMotion } from './device';
import type { StageId } from '../journey';
import { MOVED_PX, MOVED_UNIT, RETAIN } from './instrument';
import {
  HERO_DOCK,
  PLACEMENTS,
  heroLeg,
  heroPlacement,
  instrumentSize,
  publishInstrument,
  resetInstrument,
  stateAt,
  type InstrumentStateId,
} from './anchors';

/**
 * The Altimeter's persistent overlay, and the placeholder the hero reserves for
 * it.
 *
 * ## What changed
 *
 * This file used to be a slot: one element, in the opening section's block
 * flow, holding a canvas. The instrument was therefore alive for exactly as
 * long as that section was on screen — about a screen and a half of a
 * seventeen-screen document — and then it was gone, along with the page's
 * signature object, for the rest of the read.
 *
 * It is now two things:
 *
 *   `AltimeterReserve`      an empty, sized block in the hero's flow. It holds
 *                           the opening composition open and publishes where
 *                           the hero frame is. It paints nothing.
 *   `AltimeterInstrument`   a fixed, pointer-transparent overlay carrying the
 *                           real canvas for the whole document, moved between
 *                           the authored positions in `anchors.ts`.
 *
 * ## The guarantee that used to come from the slot's CSS box
 *
 * The old slot could not be resized by the instrument because its box was two
 * CSS constants. The overlay keeps that guarantee by a stronger route: it is
 * `position: fixed` and `pointer-events: none`, so it is out of flow entirely.
 * There is no layout quantity anywhere on the page that any number in this file
 * can reach — not a section offset, not a paragraph height, not a scroll
 * height. The single measurement taken here reads the *reserve* — a block whose
 * own size is a CSS constant — and it is taken on the shared measurement bus,
 * never on a scroll frame.
 *
 * ## The three modes, and the one that is not a mode
 *
 *   `probing`   one frame, before the WebGL question has been asked
 *   `live`      the real instrument, loading or loaded
 *   `fallback`  no WebGL, or the scene threw, or the context was lost
 *
 * "Loading" is deliberately not one of them: a state machine that swapped
 * subtrees would give the visitor a mount, a layout and a paint at exactly the
 * moment the instrument is supposed to be arriving. It is a class on the live
 * stage instead.
 */

/**
 * The only import path to `three`, `@react-three/fiber` and the GLB on this
 * page.
 *
 * Nothing else in `mobile/` imports any of them — `instrument.ts` and
 * `anchors.ts` are pure arithmetic precisely so the framing, the needle mapping
 * and the whole composition can be reasoned about, and tested, without pulling
 * a renderer in behind them. A visitor without WebGL never resolves this
 * import, and the test suite asserts that as a request that is never made.
 */
const MobileInstrument = lazy(() => import('./MobileInstrument'));

type Mode = 'probing' | 'live' | 'fallback';

/* ================================================== the hero's reservation === */

/**
 * The space the opening section keeps for the instrument, and nothing else.
 *
 * Same box as the slot it replaces, to the pixel, so the accepted hero
 * composition — headline above, caption and lead below — is unchanged. It has
 * no children that paint: the instrument that fills it is the overlay, drawn on
 * top, and at scroll zero the overlay is positioned from exactly this element.
 *
 * Keeping the reservation in flow rather than authoring the hero as a
 * viewport-fraction grid is a deliberate trade. A fraction would need the
 * headline's height to be a known fraction too, and it is not: it is two
 * authored lines in three locales at four viewports, and German is not
 * Hungarian. One cached read of a constant-sized block buys an opening frame
 * that is exactly right everywhere instead of nearly right in most places.
 */
export function AltimeterReserve({ label }: { label?: string }) {
  const reserve = useRef<HTMLDivElement>(null);

  /**
   * Publish where the hero frame is.
   *
   * On the shared bus, so this remeasures on precisely the occasions a section
   * offset goes stale — fonts settling, a rotation, the address bar collapsing,
   * a lazy image landing, a bfcache restore — and on no others. Never on a
   * scroll frame: `heroAnchor` below is read by the overlay's settle, and the
   * whole point of caching it is that the settle performs no layout read.
   */
  useEffect(() => onMeasure(() => {
    const box = reserve.current;
    if (!box) return;
    const rect = box.getBoundingClientRect();
    heroAnchor.y = rect.top + scrollY + rect.height / 2;
    heroAnchor.x = rect.left + rect.width / 2;
    heroAnchor.known = true;
  }), []);

  return (
    <div className="mv-alt" data-testid="mobile-altimeter-reserve">
      <div className="mv-alt__reserve" ref={reserve} aria-hidden="true" />
      {label && <p className="mv-alt__label mv-label">{label}</p>}
    </div>
  );
}

/**
 * Where the hero frame is, in document coordinates.
 *
 * Module scope rather than a ref, because the two components that need it are
 * siblings rather than relatives: the reserve is deep inside the opening
 * section and the overlay is a child of the page root. Threading a ref between
 * them would mean lifting it to `MobileHome`, which would make the page
 * component a participant in the instrument's geometry for no gain.
 *
 * `known` is what stops the overlay guessing. Until the reserve has measured
 * once, the hero placement falls back to the authored viewport fraction, which
 * is close enough for the single frame before `onMeasure` runs.
 */
const heroAnchor = { x: 0, y: 0, known: false };

/* ================================================================ fallback === */

/**
 * The SVG instrument, and it is the fallback.
 *
 * Unchanged in behaviour from when it was the portrait page's only instrument:
 * six structural states through React, one needle written straight onto the
 * node as a `transform` attribute and dirty-checked. It is kept exactly as it
 * was because a fallback that has quietly rotted is worse than no fallback —
 * the one path nobody looks at is the one that has to work unattended. It now
 * rides the overlay, so a visitor with no WebGL gets a persistent drawing
 * moving through the same authored positions rather than a hero-only one.
 *
 * ## Why the needle is an attribute and not a CSS transform
 *
 * `transform-box` and `transform-origin` on SVG children have a genuinely
 * uneven history in Safari, and the failure is silent — the needle rotates
 * about the wrong centre and looks like a drawing error rather than a CSS one.
 * `transform="rotate(a 200 200)"` is the SVG attribute, it has meant exactly
 * this since SVG 1.1, and there is no browser on the matrix that gets it wrong.
 *
 * The sign is flipped against the 3D mapping because the scene rotates about
 * `z` in a right-handed system where a positive angle is counter-clockwise,
 * and SVG's `rotate()` is clockwise-positive. Both turn the needle the way the
 * numerals are printed, which is the only thing that has to be true of both.
 */
function FallbackDial() {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<MeridianStageId>('baseline');

  useEffect(() => {
    const root = host.current;
    if (!root) return;

    // Found once. A `querySelector` per frame would be a DOM read per frame.
    const primary = root.querySelector<SVGGElement>('.dial__needle--primary');
    const secondary = root.querySelector<SVGGElement>('.dial__needle--secondary');

    let shownPrimary = Number.NaN;
    let shownSecondary = Number.NaN;
    let shownState: MeridianStageId | '' = '';
    const still = prefersReducedMotion();

    return onAscent(({ altitude }) => {
      const next = meridianStageAt(altitude).id;
      if (next !== shownState) {
        shownState = next;
        setState(next);
        root.dataset.state = next;
      }

      if (still) return;

      // Quantised to a tenth of a degree. The raw value changes every frame by
      // an amount no one can see, and writing it would be an attribute write
      // per frame for nothing.
      const a = Math.round((((altitude % 1000) / 1000) * 360) * 10) / 10;
      if (a !== shownPrimary) {
        shownPrimary = a;
        primary?.setAttribute('transform', `rotate(${a} 200 200)`);
      }

      const b = Math.round(((altitude / 10_000) * 360) * 10) / 10;
      if (b !== shownSecondary) {
        shownSecondary = b;
        secondary?.setAttribute('transform', `rotate(${b} 200 200)`);
      }
    });
  }, []);

  return (
    <div className="mv-alt__svg" ref={host} data-state="baseline" data-testid="mobile-altimeter-svg">
      <MeridianDrawing className="mv-alt__dial" state={state} idPrefix="mv" />
    </div>
  );
}

/* ================================================================= overlay === */

/** One channel of the overlay's travel. */
type Place = { x: number; y: number; scale: number; opacity: number };

/**
 * Is the full-screen navigation layer open?
 *
 * While it is, `assets/js/header.js` holds the body at `position: fixed` and
 * the layer covers the viewport. The instrument is a fixed overlay above the
 * document, so without this it would sit on top of the navigation — and it is
 * the one authored disappearance on the page: §"Visibility requirement" allows
 * exactly this, provided it is deliberate and temporary.
 *
 * It is also the one place `scrollY` is meaningless, which is why the ascent
 * reader stands down for the same duration.
 */
const menuOpen = () =>
  typeof document !== 'undefined' && document.documentElement.classList.contains('menu-open');

export function AltimeterInstrument() {
  const layer = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<Mode>('probing');
  const [wanted, setWanted] = useState(false);
  const [ready, setReady] = useState(false);

  /**
   * The capability question, asked after mount and exactly once.
   *
   * After mount because creating a probe canvas is a side effect and the first
   * paint must not depend on it; once because the answer cannot change while
   * the page is open. Reduced motion is deliberately *not* consulted — the
   * preference does not demote the visitor to the inferior drawing. It makes
   * the instrument hold still, and it does that inside the scene.
   */
  useEffect(() => {
    setMode(hasWebGL() ? 'live' : 'fallback');
  }, []);

  /**
   * Ask for the scene immediately, because it is on screen immediately.
   *
   * The overlay used to be observed for intersection before the import was
   * requested, which made sense when it was a block some way down a section.
   * It is now a fixed element covering the viewport from the first frame, so an
   * `IntersectionObserver` would fire on the first callback every time and the
   * only thing it would add is an observer. Deferred by one frame instead, so
   * the import cannot land inside the first paint.
   */
  useEffect(() => {
    if (mode !== 'live') return;
    const id = requestAnimationFrame(() => setWanted(true));
    return () => cancelAnimationFrame(id);
  }, [mode]);

  /* ------------------------------------------------------- the director --- */

  /**
   * The whole of the instrument's composition, on one settle.
   *
   * Two subscriptions and one animation frame loop, and every one of them is
   * bounded:
   *
   *   `onMeasure`   caches the overlay's own box. Fires on resize, rotation,
   *                 fonts and bfcache. Never on scroll.
   *   `onAscent`    decides the state and, during the hero leg only, the
   *                 target position. One dirty-checked write.
   *   the loop      runs only while something is further from its target than
   *                 `MOVED_PX` / `MOVED_UNIT`, and stops itself when it is not.
   *
   * There is no `getBoundingClientRect`, no `getComputedStyle` and no
   * `innerHeight` read anywhere on the per-frame path. What a scroll frame
   * touches is `scrollY`, an array of cached bands (inside `ascent.ts`) and a
   * handful of numbers on two plain objects.
   */
  useEffect(() => {
    const layerEl = layer.current;
    const boxEl = box.current;
    if (!layerEl || !boxEl) return;

    const still = prefersReducedMotion();

    /** The overlay's own box, cached. This is the fixed-positioning viewport. */
    let w = 0;
    let h = 0;
    let size = 0;

    const target: Place = { x: 0, y: 0, scale: 1, opacity: 0 };
    const at: Place = { x: 0, y: 0, scale: 1, opacity: 0 };
    let placed = false;
    let raf = 0;

    /** The last string written, so an unchanged frame is not a style write. */
    let shownTransform = '';
    let shownOpacity = '';

    /**
     * The homepage's own end, as a structural fact rather than an altitude.
     *
     * Set by an `IntersectionObserver` on a marker at the foot of the flow —
     * see `MobileHome`. Below that marker the site's shared Arrival panel and
     * ground-control footer begin, and those have no altitude band because they
     * are not part of the journey.
     */
    let ended = false;

    /**
     * Where the journey was the last time the ascent reader said.
     *
     * The navigation layer's edges arrive outside that reader and have to
     * recompute the composition without it. Re-deriving from `scrollY` would
     * mean re-locating the visitor against the section bands, which is
     * `ascent.ts`'s job and not a calculation to have a second copy of.
     */
    let stage: StageId = 'calibration';
    let altitude = 0;

    /** Solve the target for a state. Constants against the cached box. */
    const solve = (state: InstrumentStateId, scrollTop: number) => {
      const placement = PLACEMENTS[state];
      const drawn = size * placement.scale;

      if (state === 'hero') {
        // The hero rides the document for the length of the launch, then
        // arrives on the rail. `heroLeg` is the only scroll-linked quantity in
        // the instrument's composition and it is finished within six tenths of
        // a screen.
        const dock = PLACEMENTS[HERO_DOCK];
        const dockDrawn = size * dock.scale;
        const t = still ? 0 : heroLeg(scrollTop, h);
        const from = heroAnchor.known
          ? heroPlacement(heroAnchor.y, heroAnchor.x, scrollTop)
          : { x: placement.x(w, h, drawn), y: placement.y(w, h, drawn) };

        target.x = from.x + (dock.x(w, h, dockDrawn) - from.x) * t;
        target.y = from.y + (dock.y(w, h, dockDrawn) - from.y) * t;
        target.scale = placement.scale + (dock.scale - placement.scale) * t;
        target.opacity = placement.opacity + (dock.opacity - placement.opacity) * t;
        return;
      }

      target.x = placement.x(w, h, drawn);
      target.y = placement.y(w, h, drawn);
      target.scale = placement.scale;
      target.opacity = placement.opacity;
    };

    /** Write, if anything changed. Two properties, both compositor-only. */
    const paint = () => {
      const transform =
        `translate3d(${at.x.toFixed(2)}px, ${at.y.toFixed(2)}px, 0)` +
        ` translate(-50%, -50%) scale(${at.scale.toFixed(4)})`;
      if (transform !== shownTransform) {
        shownTransform = transform;
        boxEl.style.transform = transform;
      }
      const opacity = at.opacity.toFixed(3);
      if (opacity !== shownOpacity) {
        shownOpacity = opacity;
        boxEl.style.opacity = opacity;
      }
    };

    const moving = () =>
      Math.abs(at.x - target.x) > MOVED_PX ||
      Math.abs(at.y - target.y) > MOVED_PX ||
      Math.abs(at.scale - target.scale) > MOVED_UNIT ||
      Math.abs(at.opacity - target.opacity) > MOVED_UNIT;

    let last = 0;
    const step = (now: number) => {
      raf = 0;
      const dt = Math.min(last ? (now - last) / 1000 : 1 / 60, 1 / 20);
      last = now;

      const chase = (from: number, to: number) =>
        still ? to : to + (from - to) * Math.exp(-dt / RETAIN.place);

      at.x = chase(at.x, target.x);
      at.y = chase(at.y, target.y);
      at.scale = chase(at.scale, target.scale);
      at.opacity = chase(at.opacity, target.opacity);
      paint();

      if (moving()) raf = requestAnimationFrame(step);
      else {
        // Land exactly, rather than a hundredth of a pixel short of the target
        // forever. Without this the settle's residue is baked into the next
        // transition's starting point.
        at.x = target.x;
        at.y = target.y;
        at.scale = target.scale;
        at.opacity = target.opacity;
        paint();
        last = 0;
        arrive(true);
      }
    };

    /**
     * "The instrument is where it is supposed to be", as an attribute.
     *
     * The scene already publishes `data-ready`, which means the first frame the
     * RENDER is correct on. This is the other half — the first frame the
     * COMPOSITION is correct on — and the two are genuinely different events:
     * the render settles inside the canvas and the placement settles outside
     * it, on separate loops, and on the no-WebGL path the first one never
     * happens at all.
     *
     * It exists because a capture or an assertion that measures during a state
     * transition measures a number that was true for one frame on its way
     * somewhere. Without it the only way to ask "has it arrived" is to wait a
     * fixed time and hope, which is the shape of every flaky test ever written.
     */
    const arrive = (settled: boolean) => {
      if (settled) boxEl.dataset.settled = '';
      else delete boxEl.dataset.settled;
    };

    const wake = () => {
      if (!raf && moving()) {
        arrive(false);
        raf = requestAnimationFrame(step);
      }
    };

    /* -- the measurement bus ---------------------------------------------- */
    const stopMeasuring = onMeasure(() => {
      // The overlay's own rect, not `innerWidth`/`innerHeight`. On iOS a fixed
      // element is laid out against the LARGE viewport and does not move when
      // the toolbar collapses, while `innerHeight` reports the VISUAL viewport
      // and does. Using the latter would walk the rail up and down the frame on
      // every toolbar transition — a drift with no gesture behind it.
      const rect = layerEl.getBoundingClientRect();
      w = rect.width;
      h = rect.height;
      size = instrumentSize(w, h);
      boxEl.style.width = `${size}px`;
      boxEl.style.height = `${size}px`;
    });

    /**
     * Re-derive the composition from what is already known.
     *
     * The one path all three inputs go through, so the navigation layer and the
     * end marker cannot arrive at a different answer from the ascent reader.
     */
    const recompose = (hidden: boolean) => {
      const state = stateAt(stage, altitude, ended);
      publishInstrument(state, !hidden && PLACEMENTS[state].opacity > 0);
      // Named on the overlay so the authored state is legible from outside —
      // in a capture script, in an assertion, and in the inspector. It is a
      // label for a decision this file has already made, not an input to one.
      layerEl.dataset.instState = state;
      solve(state, scrollY);
      if (hidden) target.opacity = 0;
    };

    /* -- the end of the homepage ------------------------------------------- */
    /**
     * Where the homepage's flow stops, in document coordinates.
     *
     * Cached on the same measurement bus as everything else, and compared
     * against `scrollY` — which means the answer is arithmetic on two numbers
     * and is correct at any scroll position, however it was reached.
     *
     * ## Why this is not an IntersectionObserver, having been one
     *
     * It was, and it had a defect that only a jump could produce. An observer
     * delivers a callback when an element's intersection RATIO changes, and a
     * single `scrollTo(scrollHeight)` takes the marker from "below the frame,
     * ratio 0" to "far above the frame, ratio 0" without ever crossing it. No
     * ratio change, no callback, and the instrument stayed at its Arrival size
     * hanging over the footer — the exact thing the recede exists to prevent.
     * Measured: a fragment link or an end-key jump reproduced it every time,
     * and a normal scroll never did, which is the shape of bug that ships.
     *
     * A cached offset has no such window. It costs one `getBoundingClientRect`
     * per measurement event — the same pass that already measures the reserve
     * and the eleven sections — and nothing at all on a scroll frame.
     */
    let endsAt = Number.POSITIVE_INFINITY;

    const stopMeasuringEnd = onMeasure(() => {
      const marker = document.querySelector('[data-mv-end]');
      if (!marker) return;
      endsAt = marker.getBoundingClientRect().top + scrollY;
    });

    /* -- the ascent -------------------------------------------------------- */
    const stopReading = onAscent((state) => {
      if (w === 0 || h === 0) return;

      stage = state.stage;
      altitude = state.altitude;

      // The foot of the homepage has reached the lower part of the frame. A
      // little anticipation, so the instrument has begun receding by the time
      // the site's own Arrival panel is readable rather than after it arrives.
      ended = scrollY + viewportHeight() * 0.88 >= endsAt;

      recompose(menuOpen());

      if (!placed) {
        // The first pass lands the instrument in its opening frame rather than
        // flying it in from wherever the initial values were. A page restored
        // by a back navigation opens part-way down the document, and an
        // instrument that swept across the screen to catch up would be a
        // transition the visitor did not perform.
        placed = true;
        Object.assign(at, target);
        paint();
        arrive(true);
        return;
      }
      wake();
    });

    /* -- the navigation layer ---------------------------------------------- */
    // The ascent reader stands down while the menu is up, so it cannot be the
    // thing that hides the instrument on the OPEN edge. This can.
    const onMenu = (event: Event) => {
      const open = Boolean((event as CustomEvent<{ open: boolean }>).detail?.open);
      recompose(open);
      wake();
    };
    addEventListener('stratos:menu', onMenu);

    return () => {
      stopMeasuring();
      stopMeasuringEnd();
      stopReading();
      removeEventListener('stratos:menu', onMenu);
      if (raf) cancelAnimationFrame(raf);
      resetInstrument();
    };
  }, []);

  const fail = useCallback(() => setMode('fallback'), []);
  const onReady = useCallback(() => setReady(true), []);

  return (
    <div
      className="mv-inst"
      ref={layer}
      aria-hidden="true"
      data-testid="mobile-altimeter"
      data-mode={mode}
    >
      {/*
        The instrument's box.

        Square, sized in `onMeasure` from the overlay's own rect, and moved by a
        `transform` — never by `top`/`left` and never by a width. The canvas's
        drawing buffer is therefore created once at the hero size and reused at
        every state: a rail state is the same pixels scaled down by the
        compositor, which is both sharper than re-rendering into a small buffer
        and free.
      */}
      <div className="mv-alt__stage" ref={box} data-ready={ready ? '' : undefined}>
        {mode === 'live' && wanted && (
          // The boundary wraps only the canvas. A throw inside the renderer —
          // a lost context, a model that decodes wrong, an out-of-memory —
          // must cost the visitor the instrument and nothing else, and must
          // land them on the drawing rather than on an empty overlay.
          <SceneBoundary onError={fail}>
            <Suspense fallback={null}>
              <MobileInstrument
                dpr={renderScale().start}
                onReady={onReady}
                onContextLost={fail}
              />
            </Suspense>
          </SceneBoundary>
        )}

        {mode === 'fallback' && <FallbackDial />}

        {/*
          The bloom the instrument carries with it, and the loading silhouette.

          The overlay is painted UNDER the copy — see `.mv-flow`'s z-index in
          mobile.css — so this is not a veil protecting text from the render.
          It is the opposite: a soft radial lift that gives the case somewhere
          to sit, so a 100px instrument on the rail reads as an object in a
          space rather than as a decal against near-black. No filter, nothing
          animated, nothing opaque, and it scales with the instrument because it
          is inside its box.

          The hairline ring inside it is the loading state, and that half IS
          temporary: it is faded out by the stage's `data-ready` on the first
          frame the instrument is CORRECT on — not the frame the model finished
          decoding, which is the frame it is in the wrong pose with the needles
          at zero.
        */}
        <span className="mv-alt__wait" aria-hidden="true" />
      </div>
    </div>
  );
}

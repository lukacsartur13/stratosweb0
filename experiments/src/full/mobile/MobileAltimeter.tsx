import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { MeridianDrawing } from '../components/MeridianDrawing';
import { SceneBoundary } from '../components/SceneBoundary';
import { hasWebGL, renderScale } from '@/lib/capabilities';
import { meridianStageAt, type MeridianStageId } from '../meridian';
import { onAscent } from './ascent';
import { prefersReducedMotion } from './device';

/**
 * The Altimeter's slot on the portrait homepage.
 *
 * ## What changed, and what did not
 *
 * The previous portrait page drew the instrument as inline SVG. That was the
 * right call about the *architecture* — the old WebGL instrument was welded to
 * the layout through an exclusion band that decided panel heights, which in
 * turn decided the altitude that positioned the instrument — and the wrong call
 * about the *object*. The Altimeter is one of the defining Stratos signatures
 * and a drawing of it is a drawing of it.
 *
 * So the real GLB is back, and none of the architecture it used to come with
 * is. This file is the boundary where that is enforced:
 *
 *   * the slot's box comes from CSS and a fixed aspect ratio — nothing here
 *     measures content, and nothing downstream can size anything;
 *   * the scene is behind a dynamic import, so a device that cannot or should
 *     not run it never requests `three`, the renderer or the model;
 *   * the SVG is still here, and it is a *failure* path now rather than the
 *     normal experience — §18.
 *
 * ## The three states, and the one that is not a state
 *
 *   `probing`   one frame, before the WebGL question has been asked
 *   `live`      the real instrument, loading or loaded
 *   `fallback`  no WebGL, or the scene threw, or the context was lost
 *
 * "Loading" is deliberately not one of them. It is a class on the live stage,
 * because §17 asks for a clean transition into the real instrument and a state
 * machine that swapped subtrees would give the visitor a mount, a layout and a
 * paint at exactly the moment the instrument is supposed to be arriving.
 */

/**
 * The only import path to `three`, `@react-three/fiber` and the GLB on this
 * page.
 *
 * Nothing else in `mobile/` imports any of them — `instrument.ts` is pure
 * arithmetic precisely so the framing and the needle mapping can be reasoned
 * about, and tested, without pulling a renderer in behind them. A visitor
 * without WebGL never resolves this import, and the test suite asserts that as
 * a request that is never made.
 */
const MobileInstrument = lazy(() => import('./MobileInstrument'));

type Mode = 'probing' | 'live' | 'fallback';

/**
 * How early the scene is asked for.
 *
 * §16: ready before the visitor reaches its first hero state, without a visible
 * late-load pop and without blocking the first paint. The slot is in the
 * opening section, so in practice the observer fires on the first frame and
 * this margin never gets used — it is here so that moving the slot down the
 * page later is a CSS change rather than a performance regression nobody
 * connects to the move.
 */
const PRELOAD_MARGIN = '120% 0px 120% 0px';

/**
 * The SVG instrument, and it is the fallback now.
 *
 * Unchanged in behaviour from when it was the portrait page's only instrument:
 * six structural states through React, one needle written straight onto the
 * node as a `transform` attribute and dirty-checked. It is kept exactly as it
 * was because a fallback that has quietly rotted is worse than no fallback —
 * the one path nobody looks at is the one that has to work unattended.
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

export function MobileAltimeter({ label }: { label?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<Mode>('probing');
  const [wanted, setWanted] = useState(false);
  const [ready, setReady] = useState(false);

  /**
   * The capability question, asked after mount and exactly once.
   *
   * After mount because creating a probe canvas is a side effect and the first
   * paint must not depend on it; once because the answer cannot change while
   * the page is open. Reduced motion is deliberately *not* consulted — §20 is
   * explicit that the preference does not demote the visitor to the inferior
   * drawing. It makes the instrument hold still, and it does that inside the
   * scene.
   */
  useEffect(() => {
    setMode(hasWebGL() ? 'live' : 'fallback');
  }, []);

  /**
   * Ask for the scene shortly before it is needed, and never during the initial
   * module evaluation.
   *
   * `IntersectionObserver` rather than a timer: a timer is a guess about when
   * the visitor arrives, and on this page the honest answer is "immediately",
   * which the observer produces on the first frame without having to know that.
   */
  useEffect(() => {
    if (mode !== 'live') return;
    const box = host.current;
    if (!box) return;
    if (typeof IntersectionObserver !== 'function') {
      setWanted(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        setWanted(true);
        observer.disconnect();
      },
      { rootMargin: PRELOAD_MARGIN },
    );
    observer.observe(box);
    return () => observer.disconnect();
  }, [mode]);

  const fail = useCallback(() => setMode('fallback'), []);
  const onReady = useCallback(() => setReady(true), []);

  return (
    <div className="mv-alt" data-testid="mobile-altimeter" data-mode={mode}>
      {/*
        The stage.

        A fixed aspect ratio and a viewport-relative cap, both in CSS, both
        constants — §13. This element's height is never computed from anything
        the instrument does, and the instrument's framing is computed from this
        element. One direction, no loop, and the compiler of that guarantee is
        that there is no code path in either file that could close it.
      */}
      <div className="mv-alt__stage" ref={host} data-ready={ready ? '' : undefined}>
        {mode === 'live' && wanted && (
          // The boundary wraps only the canvas. A throw inside the renderer —
          // a lost context, a model that decodes wrong, an out-of-memory —
          // must cost the visitor the instrument and nothing else, and must
          // land them on the drawing rather than on an empty slot.
          <SceneBoundary onError={fail}>
            <Suspense fallback={null}>
              <MobileInstrument
                host={host}
                dpr={renderScale().start}
                onReady={onReady}
                onContextLost={fail}
              />
            </Suspense>
          </SceneBoundary>
        )}

        {mode === 'fallback' && <FallbackDial />}

        {/*
          The loading state — §17.

          A soft radial and one hairline ring where the bezel is about to be:
          an atmospheric slot with a dial silhouette, not the SVG instrument.
          Showing the drawing here and then replacing it is the visible
          fallback-to-real flash §17 rules out, and it is the reason the two are
          not the same element.

          It is painted *under* the canvas and faded by the stage's `data-ready`,
          so the transition is a crossfade over a stationary composition rather
          than a swap. Nothing about it moves.
        */}
        {/*
          A `<span>`, and that is not arbitrary. This was an `<i>` — the same
          element the Meridian rules on this page use — and it cost 100 KB:
          `archivo-italic-latin.woff2` was requested on the portrait homepage by
          build B and not by build A, found by diffing the two transfer
          breakdowns. An empty `<i>` still inherits the body family and still
          resolves the italic face for it. The rules elsewhere are 1px wide and
          never triggered it; this one is 300px square.
        */}
        {mode !== 'fallback' && <span className="mv-alt__wait" aria-hidden="true" />}
      </div>

      {label && <p className="mv-alt__label mv-label">{label}</p>}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { DEBUG_EVENT, STAGES, calibrate, clamp, journey, type StageId } from './journey';

/**
 * Re-run capability detection when the *browser's* reduced-motion preference
 * changes, not only on first mount.
 *
 * The capability probe reads `prefers-reduced-motion` once, during mount, which
 * is right for deciding whether to download a renderer — but it means a visitor
 * who turns the preference on while the page is open keeps the animated scene
 * until they reload. macOS and iOS both expose that switch in a place people
 * genuinely reach for mid-session.
 *
 * `addListener` is still here because Safari only gained `addEventListener` on
 * MediaQueryList in 14, and this route is expected to run on the iPhones the
 * test matrix names.
 */
export function useReducedMotionWatch(onChange: () => void) {
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const query = matchMedia('(prefers-reduced-motion: reduce)');
    const handler = () => onChange();

    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', handler);
      return () => query.removeEventListener('change', handler);
    }
    // eslint-disable-next-line deprecation/deprecation -- Safari < 14
    query.addListener(handler);
    // eslint-disable-next-line deprecation/deprecation -- Safari < 14
    return () => query.removeListener(handler);
  }, [onChange]);
}

/**
 * Read a development override, and re-read it whenever the debug panel writes.
 *
 * Only the overrides consumed during *render* need this — the quality tier and
 * the forced fallback. Everything else in `journey.debug` is read inside a frame
 * callback and picks up new values on the next frame for nothing.
 *
 * In production it returns `fallback` without subscribing to anything:
 * `import.meta.env.DEV` is statically replaced with `false`, so the `read` call,
 * the state and the listener are all dead code Rollup removes. `read` must be a
 * stable reference — define it at module scope, not in a render body.
 */
export function useDebugOverride<T>(read: () => T, fallback: T): T {
  const [value, setValue] = useState<T>(() => (import.meta.env.DEV ? read() : fallback));

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const sync = () => setValue(read());
    addEventListener(DEBUG_EVENT, sync);
    return () => removeEventListener(DEBUG_EVENT, sync);
  }, [read]);

  return import.meta.env.DEV ? value : fallback;
}

/**
 * Measure where the stage panels actually landed, and tell the altitude curve.
 *
 * Runs after layout, and again whenever the track resizes — which covers a
 * rotation, a font swap, a late case-study image, and the browser chrome
 * hiding on iOS. Without it the altitude is a function of the *nominal* stage
 * shares, which are only correct on viewports wide enough for every panel to
 * fit inside its budget. They are not correct at 390px, where the case studies
 * stack and run 50% over.
 *
 * The measurement is deliberately the same one ScrollTrigger reports: progress
 * is scroll distance past the top of the track, over the track's travel. A
 * panel's stage therefore starts when its top reaches the top of the viewport
 * and ends when its bottom reaches the bottom, which is what the fixed-share
 * version approximated.
 */
/**
 * Is the full-screen navigation layer open?
 *
 * While it is, `assets/js/header.js` holds the body at `position: fixed` with a
 * negative `top` — the only scroll lock iOS Safari actually honours. That
 * collapses the document to one viewport and pins `scrollY` at 0 for as long as
 * the layer is up, which makes every scroll-derived measurement on this page
 * wrong in the same way: the track appears to start at the top of the document
 * and ScrollTrigger reports a progress of 0.
 *
 * Left alone, opening the menu at 24 000 m walked the whole ascent back to the
 * valley floor behind the layer and eased it up again on close. Both readers of
 * scroll position stand down for the duration and re-read once it is restored;
 * `header.js` announces both edges on `stratos:menu`, and announces the close
 * *after* the scroll position has been put back.
 */
const menuOpen = () =>
  typeof document !== 'undefined' &&
  document.documentElement.classList.contains('menu-open');

/** Subscribe to the layer's open/close edges. Returns an unsubscribe. */
function onMenu(handler: (open: boolean) => void): () => void {
  const listener = (event: Event) => handler(!!(event as CustomEvent<{ open: boolean }>).detail?.open);
  addEventListener('stratos:menu', listener);
  return () => removeEventListener('stratos:menu', listener);
}

export function useStageCalibration(trackRef: React.RefObject<HTMLElement>, enabled: boolean) {
  useEffect(() => {
    if (!enabled || !trackRef.current) return;
    const track = trackRef.current;

    const measure = () => {
      // Every line below reads `scrollY`. See `menuOpen`.
      if (menuOpen()) return;
      const travel = track.offsetHeight - innerHeight;
      if (travel <= 0) return;
      const trackTop = track.getBoundingClientRect().top + scrollY;

      // Only where each panel *starts*. A stage's end is the next stage's
      // start, which `calibrate` derives — measuring an end here as "the
      // panel's bottom reaches the bottom of the viewport" left a screen-height
      // gap at every boundary and collapsed any panel exactly one viewport tall
      // to zero width. See the note on `calibrate`.
      const measured = new Map<StageId, { start: number }>();
      for (const stage of STAGES) {
        const el = document.getElementById(`stage-${stage.id}`);
        if (!el) continue;
        // The panel's *flow* position, not its border-box top, and the two are
        // no longer the same thing.
        //
        // The portrait window gives each panel a box two screens taller than
        // its stage and a negative margin at each end, so adjacent plates share
        // a screen of sticky range to hand over in (see styles.css). The border
        // box therefore begins one screen *before* the stage does, and reading
        // it here would calibrate every stage one screen early — which is not a
        // cosmetic error: `calibrate` writes the boundaries the altitude curve
        // is built from, so the readout, the instrument and the copy would all
        // disagree about where the visitor is by a full screen. Measured on a
        // 390×844, it put the lower-atmosphere plate 194px below the viewport
        // top at the altitude its own stage was supposed to begin at.
        //
        // Subtracting the margin recovers the flow position exactly, and costs
        // nothing where there is no margin to subtract: every landscape and
        // desktop viewport reads a zero here.
        const lead = parseFloat(getComputedStyle(el).marginTop) || 0;
        const top = el.getBoundingClientRect().top + scrollY - trackTop - lead;
        measured.set(stage.id, { start: clamp(top / travel) });
      }
      calibrate(measured);
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(track);
    addEventListener('resize', measure);
    // Fonts and images settling change panel heights after the first pass.
    addEventListener('load', measure);
    // The layer's close edge fires after the scroll position is restored, so
    // this catches up on whatever the lock suppressed — the scrollbar coming
    // and going resizes the track, and that is a real remeasure.
    const offMenu = onMenu((open) => { if (!open) measure(); });

    return () => {
      ro.disconnect();
      removeEventListener('resize', measure);
      removeEventListener('load', measure);
      offMenu();
    };
  }, [trackRef, enabled]);
}

/**
 * Scroll, pointer and visibility inputs for the full journey.
 *
 * A near-copy of the prototype's `useScrollDriver`, pointed at the journey
 * singleton instead of the prototype's. Kept as its own file rather than
 * generalised behind a parameter: the shared version would have to be imported
 * by both routes, which makes the short prototype's behaviour depend on a file
 * this route is free to change. The duplication is thirty lines and it is the
 * cheaper of the two risks.
 *
 * GSAP is imported dynamically for the same reason `three` is — a visitor on
 * the reduced-motion path has nothing to scrub and should not pay for
 * ScrollTrigger to be told so.
 *
 * Lenis is deliberately absent. The brief lists it as a system to retain, but
 * the prototype never adopted one: the production site ships no smooth-scroll
 * library, and adding one here would turn a comparison of two hero techniques
 * into a comparison of two scroll models — and on iOS it replaces native
 * momentum with a JS approximation of it, which is exactly the kind of change
 * that makes a mobile sticky handoff feel wrong. Noted in FULL_ASCENT_PROTOTYPE.md.
 */
export function useJourneyScroll(trackRef: React.RefObject<HTMLElement>, enabled: boolean) {
  useEffect(() => {
    if (!enabled || !trackRef.current) return;

    const track = trackRef.current;
    let cancelled = false;
    let dispose: (() => void) | undefined;

    void (async () => {
      const [{ default: gsap }, { ScrollTrigger }] = await Promise.all([
        import('gsap'),
        import('gsap/ScrollTrigger'),
      ]);
      if (cancelled) return; // StrictMode tears the effect down before this lands

      gsap.registerPlugin(ScrollTrigger);
      const set = (progress: number) => {
        journey.target = clamp(progress);
      };

      const trigger = ScrollTrigger.create({
        trigger: track,
        start: 'top top',
        end: 'bottom bottom',
        onUpdate: (self) => set(self.progress),
        onRefresh: (self) => set(self.progress),
      });

      // Images and fonts settling change the track height after first measure;
      // without this the mapping is a few hundred pixels out, and on an eleven
      // screen track that is a whole stage boundary.
      // Both of these read scroll position, and both must stand down while the
      // navigation layer holds the body fixed. See `menuOpen`.
      const refresh = () => { if (!menuOpen()) ScrollTrigger.refresh(); };

      const onLoad = () => refresh();
      addEventListener('load', onLoad);

      // Late-loading case-study images are the main source of reflow here, and
      // they are below the fold by definition, so a resize observer on the
      // track catches what the load event misses.
      const ro = new ResizeObserver(refresh);
      ro.observe(track);

      // `disable(false)` — do not revert. The trigger stops updating and keeps
      // everything exactly where it is; `enable()` re-reads the scroll position,
      // which by then is the restored one, so the journey resumes at the
      // altitude the visitor opened the menu at rather than easing back up to it.
      const offMenu = onMenu((open) => {
        if (open) trigger.disable(false);
        else { trigger.enable(); refresh(); }
      });

      dispose = () => {
        removeEventListener('load', onLoad);
        ro.disconnect();
        offMenu();
        trigger.kill();
      };
    })();

    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [trackRef, enabled]);
}

/**
 * The same mapping, without GSAP, for the paths that have no 3D scene.
 *
 * When WebGL is unavailable or the context is lost, the route still shows the
 * static instrument *and the altitude readout* — but the ScrollTrigger driver
 * above is torn down with the scene, which left the readout frozen at 0 m while
 * the visitor scrolled eleven screens past it. A readout that does not move is
 * worse than no readout: it reads as broken rather than as static.
 *
 * Loading GSAP purely to animate a number on a path that has already declined
 * the renderer would be the wrong trade, so this does the one thing
 * ScrollTrigger was being used for — map an element's travel onto 0..1 — in
 * about ten lines and no dependency. `getBoundingClientRect` on scroll is
 * cheap here because there is nothing else competing for the frame.
 *
 * Deliberately *not* used on the reduced-motion path: there is no journey to
 * track when the track is un-stuck and the page is an ordinary document.
 */
export function useNativeScrollDriver(trackRef: React.RefObject<HTMLElement>, enabled: boolean) {
  useEffect(() => {
    if (!enabled || !trackRef.current) return;
    const track = trackRef.current;

    let queued = false;
    const measure = () => {
      queued = false;
      // The navigation layer's scroll lock, again. See `menuOpen`.
      if (menuOpen()) return;
      const travel = track.offsetHeight - innerHeight;
      if (travel <= 0) return;
      // Distance scrolled past the top of the track, over the track's travel.
      const past = -track.getBoundingClientRect().top;
      journey.target = clamp(past / travel);
    };

    // Coalesced to one measurement per frame: a scroll handler that reads
    // layout synchronously on every event is the exact jank this route is
    // supposed to be an improvement on.
    const onScroll = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(measure);
    };

    measure();
    addEventListener('scroll', onScroll, { passive: true });
    addEventListener('resize', onScroll, { passive: true });
    return () => {
      removeEventListener('scroll', onScroll);
      removeEventListener('resize', onScroll);
    };
  }, [trackRef, enabled]);
}

/** Pointer parallax input. No-op on touch, where there is no hover to track. */
export function useJourneyPointer(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;

    const onMove = (e: PointerEvent) => {
      journey.pointer.x = (e.clientX / innerWidth) * 2 - 1;
      journey.pointer.y = (e.clientY / innerHeight) * 2 - 1;
    };
    const onLeave = () => {
      journey.pointer.x = 0;
      journey.pointer.y = 0;
    };

    addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerleave', onLeave);
    return () => {
      removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerleave', onLeave);
    };
  }, [enabled]);
}

/** Stop integrating while the tab is in the background. */
export function useJourneyVisibility() {
  useEffect(() => {
    const onVisibility = () => {
      journey.running = document.visibilityState === 'visible';
    };
    onVisibility();
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);
}

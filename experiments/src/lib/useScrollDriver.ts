import { useEffect } from 'react';
import { ascent, clamp } from './ascent';

/**
 * Wire the document scroll to `ascent.target`, plus the two other inputs the
 * scene reads: pointer position and tab visibility.
 *
 * ScrollTrigger is used for what it is genuinely good at — a correct, resize-
 * aware mapping from an element's travel onto 0..1 — and nothing else. The
 * easing happens in the render loop rather than in `scrub`, so the motion stays
 * smooth on a 120Hz display and does not fight the frame budget.
 *
 * GSAP is imported dynamically, inside the effect, for the same reason `three`
 * is: a visitor on the reduced-motion path has nothing to scrub and should not
 * pay 28 KB to be told so.
 *
 * Lenis is not used. The production site ships no smooth-scroll library, and
 * introducing one here would turn a comparison of two hero techniques into a
 * comparison of two scroll models.
 */
export function useScrollDriver(trackRef: React.RefObject<HTMLElement>, enabled: boolean) {
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
      // The effect can be torn down before the import lands — in StrictMode it
      // reliably is — so check before touching anything.
      if (cancelled) return;

      gsap.registerPlugin(ScrollTrigger);
      const set = (progress: number) => {
        ascent.target = clamp(progress);
      };

      const trigger = ScrollTrigger.create({
        trigger: track,
        start: 'top top',
        end: 'bottom bottom',
        onUpdate: (self) => set(self.progress),
        onRefresh: (self) => set(self.progress),
      });

      // Fonts and images settling can change the track's height after the first
      // measurement; without this the mapping is a few hundred pixels out.
      const onLoad = () => ScrollTrigger.refresh();
      addEventListener('load', onLoad);

      dispose = () => {
        removeEventListener('load', onLoad);
        trigger.kill();
      };
    })();

    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [trackRef, enabled]);
}

/** Pointer parallax input. No-op on touch, where there is no hover to track. */
export function usePointerDriver(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;

    const onMove = (e: PointerEvent) => {
      ascent.pointer.x = (e.clientX / innerWidth) * 2 - 1;
      ascent.pointer.y = (e.clientY / innerHeight) * 2 - 1;
    };
    const onLeave = () => {
      ascent.pointer.x = 0;
      ascent.pointer.y = 0;
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
export function useVisibilityDriver() {
  useEffect(() => {
    const onVisibility = () => {
      ascent.running = document.visibilityState === 'visible';
    };
    onVisibility();
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);
}

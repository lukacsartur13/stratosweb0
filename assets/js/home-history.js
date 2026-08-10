/* ==========================================================================
   STRATOS — keeping the homepage's place across a history navigation.

   THE DEFECT
   ----------
   Scroll to 6 400 px on the homepage, follow an internal link, press Back. The
   browser does not put you back. A generated static route at the same viewport
   does, every time, on both engines — so this was never the browser's scroll
   restoration failing. It was this one document taking it away.

   MEASURED, NOT GUESSED (experiments/probe-history-restoration.mjs)
   ----------------------------------------------------------------
   The probe instruments the restored document before any page script runs:
   `history.scrollRestoration` at script time and at `load`, every programmatic
   `scrollTo` / `scrollBy` / `scrollIntoView` / `scrollTop=` with the stack that
   made it, and `scrollY` + `scrollHeight` on every frame either one changed.

       history.scrollRestoration   'auto' at script time AND at load, every arm,
                                   both engines. Nothing sets it to 'manual'.
       programmatic scrolls        none at all on portrait. Three on desktop,
                                   all at 67 ms, all ScrollTrigger's refresh
                                   saving and putting back a position that was
                                   already wrong.
       first sampled frame         portrait  y=1528  h=2372
                                   desktop   y= 794  h=1694

   That last line is the whole defect, and it is arithmetic rather than
   interpretation: 2372 − 844 = 1528, and 1694 − 900 = 794. The browser applied
   its restore correctly and on time — against the *shell*. `<main>` is a React
   container and is empty in the parsed HTML, so at first layout the homepage is
   a header, an Arrival and a footer: two thousand pixels of a fourteen thousand
   pixel document. A 6 400 px offset clamps to the bottom of that, and the offset
   is gone before the application exists.

   What happens next is the two engines differing about a document that then
   grows underneath a scroll position:

       chromium  scroll anchoring holds the footer where it is, so the clamped
                 position is dragged down with the growing content and lands at
                 the very bottom — 13 352 of 13 353 on portrait.
       webkit    no scroll anchoring, so the clamped position simply stays:
                 794 of 20 567 on desktop, a screen from the top.

   Two different wrong answers, one cause. Neither is a mobile problem, which is
   why the fix is not in the mobile composition.

   THE FIX, AND WHY IT IS NOT A SCROLL RESTORATION FRAMEWORK
   ---------------------------------------------------------
   Nothing here reads or writes `scrollY`, ever. The browser still does all of
   the restoring; this file only stops the document from being too short to
   restore *into*.

   The homepage records how tall it settled — in `history.state`, which is the
   platform's own per-entry store, so the number belongs to the entry it was
   measured on and no key has to be invented for it. On the way back the entry
   comes back with its state, this file reads it in `<head>` before the body is
   parsed, and reserves that height with a `min-height` on `<body>`. First
   layout then finds a document the right size, the browser's restore lands
   where it was saved, and React mounts underneath a scroll position that is
   already correct.

   The reserve is released as soon as the real content is at least as tall,
   which on a back navigation is a few hundred milliseconds later. If the
   composition genuinely comes back shorter — a rotation, a font that failed —
   the reserve is not dropped but *trimmed* to exactly the height the restored
   position needs, so the visitor's place survives and no dead space outlives it.

   WHAT THIS COSTS
   ---------------
   One `ResizeObserver` on the root element, no scroll listener, no timer, no
   per-frame work and no polling of history state. The observer already had to
   exist to record the settled height; releasing the reserve rides on it. Once
   released, the callback is two integer comparisons and a `replaceState` on the
   frames where the document's height actually changed.
   ========================================================================== */
(() => {
  'use strict';

  const root = document.documentElement;

  /** The property `body { min-height: … }` reads. See assets/css/chrome.css. */
  const PROP = '--home-reserve';

  /** Where the settled height lives on the history entry. */
  const KEY = 'stratosHome';

  const reserved = () => parseInt(root.style.getPropertyValue(PROP), 10) || 0;

  /* ------------------------------------------------------------- the reserve

     Read straight away, in <head>, because the only window that matters closes
     at first layout. `history.state` is available synchronously from the first
     script on a restored document — that is what makes this possible without
     storage of our own and without a key that could collide across entries.

     The recorded width has to match. A phone that went away in portrait and
     came back in landscape has a genuinely different document, and reserving
     the old height there would be reserving the wrong number rather than none. */
  try {
    const saved = history.state && history.state[KEY];
    if (saved && saved.w === innerWidth && saved.h > 0) {
      root.style.setProperty(PROP, saved.h + 'px');
    }
  } catch (e) {
    /* An opaque or unreadable state is simply no reserve. */
  }

  /* ------------------------------------------------- release, then record

     Both jobs are the same observation — "the document's height changed" — so
     they are one callback rather than two observers.

     Order matters: the reserve is released first, because while it is up the
     document's height is the *reserved* one and recording that would write the
     reserve back into the entry and make it permanent. */
  function heightChanged() {
    /* Stand down while the full-screen navigation is open.

       `assets/js/header.js` holds the body at `position: fixed` for the
       duration — the only scroll lock iOS Safari honours — which collapses the
       document to a single viewport. That is a resize, so this callback fires,
       and without this line it would record 844px as the homepage's settled
       height into the history entry. The next Back would then reserve 844px and
       the defect this file exists to fix would be back, caused by the fix.

       The same reason `useJourneyScroll.ts` and `useStageCalibration` stand down
       on the same class, and the same class they read. */
    if (root.classList.contains('menu-open')) return;

    const held = reserved();

    if (held) {
      // Measure the composition's own height by taking the reserve away. One
      // forced layout, only on the frames where something resized, and only
      // until the reserve is gone for good — which is the first time the real
      // content reaches it.
      root.style.removeProperty(PROP);
      const natural = root.scrollHeight;
      // What the restored scroll position actually needs underneath it. Below
      // this the browser would clamp, and the visitor would lose their place
      // for the second time.
      const needed = Math.ceil(scrollY + innerHeight);
      if (natural < needed) {
        root.style.setProperty(PROP, needed + 'px');
        return;
      }
    }

    /* Record. `replaceState` creates no entry, fires no `popstate` and is not
       a navigation — it edits the state of the entry the visitor is already on,
       which is exactly the one they will come back to. */
    const h = root.scrollHeight;
    const w = innerWidth;
    try {
      const state = history.state && typeof history.state === 'object' ? history.state : {};
      const was = state[KEY];
      // Rewriting the same pair on every reflow would be a write per resize
      // frame for no change. 32px is below anything that could move the restore
      // by a perceptible amount and above the sub-pixel churn of a font swap.
      if (was && was.w === w && Math.abs(was.h - h) < 32) return;
      const next = {};
      for (const k in state) next[k] = state[k];
      next[KEY] = { h: h, w: w };
      history.replaceState(next, '');
    } catch (e) {
      /* A state that cannot be structured-cloned is a page that does not get
         this behaviour, not a page that throws on every resize. */
    }
  }

  function watch() {
    if (typeof ResizeObserver !== 'function') return;
    let queued = false;
    // Coalesced to one measurement per frame. The mount grows the document in
    // several steps and each one would otherwise be its own forced layout.
    const observer = new ResizeObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        heightChanged();
      });
    });
    observer.observe(root);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', watch, { once: true });
  } else {
    watch();
  }
})();

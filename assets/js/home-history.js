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

   The homepage records how tall it settled, in `sessionStorage`. On the way
   back this file reads it in `<head>` before the body is parsed and reserves
   that height with a `min-height` on `<body>`. First layout then finds a
   document the right size, the browser's restore lands where it was saved, and
   React mounts underneath a scroll position that is already correct.

   WHY NOT `history.state`, WHICH IS THE OBVIOUS PLACE
   ---------------------------------------------------
   It was the first implementation, and it is the better fit on paper: a
   per-entry store needs no key, and the height would belong to exactly the
   entry it was measured on.

   It also broke a back navigation, which is worse than the defect it fixed.
   Leaving the homepage with the navigation layer open — `header.js` closes the
   layer on the way out, closing it un-fixes the body, and un-fixing the body
   restores the document's full height — puts a resize, and therefore a
   `replaceState`, one frame after the click that started the navigation. A
   history entry rewritten while its own document is being replaced is not one
   the traversal back to it can rely on. Measured, `mobile-390`, the existing
   "navigating away and back leaves nothing behind" test run in isolation on an
   idle machine, six runs each:

       before this file exists                6 passed, 0 failed
       with `history.state`                   1 passed, 5 failed
       with `history.state`, guarded on
         `pagehide`                           2 passed, 4 failed
       with `sessionStorage` (shipped)        6 passed, 0 failed

   The `pagehide` guard is the tempting fix and the middle row is why it is not
   one: the write races the *click*, not the unload, and by `pagehide` it has
   already happened.

   `sessionStorage` mutates no navigation state, so the race has nowhere to
   land. What is lost by not being per-entry is nothing that matters here: the
   value is a layout measurement of one URL at one viewport width, and two
   history entries for the same homepage at the same width have the same one.
   It holds no identifier, it is a number, and it dies with the tab — see
   _build/reports/phase9-consent-inventory.md §3.

   The reserve is released as soon as the real content is at least as tall,
   which on a back navigation is a few hundred milliseconds later. If the
   composition genuinely comes back shorter — a rotation, a font that failed —
   the reserve is not dropped but *trimmed* to exactly the height the restored
   position needs, so the visitor's place survives and no dead space outlives it.

   WHAT THIS COSTS
   ---------------
   One `ResizeObserver` on the root element. No scroll listener, no timer, no
   per-frame work, and nothing polled. The observer already had to exist to
   record the settled height; releasing the reserve rides on it. Once released,
   the callback is two integer comparisons and one small `sessionStorage` write
   on the frames where the document's height actually changed.
   ========================================================================== */
(() => {
  'use strict';

  const root = document.documentElement;

  /** The property `body { min-height: … }` reads. See assets/css/chrome.css. */
  const PROP = '--home-reserve';

  /**
   * Where the settled height lives.
   *
   * One key, holding the last homepage measured: `{p, h, w}` — pathname, height
   * and viewport width. The pathname is stored rather than folded into the key
   * so the three locale homepages share one entry in the storage inventory;
   * a visitor who switches locale mid-session simply gets no reserve on the
   * first Back after the switch, which is the same as any first visit.
   */
  const KEY = 'stratos.home-height';

  const reserved = () => parseInt(root.style.getPropertyValue(PROP), 10) || 0;

  /* ------------------------------------------------------------- the reserve

     Read straight away, in <head>, because the only window that matters closes
     at first layout — the browser applies its scroll restoration there, and a
     reserve set any later is a reserve set after the position was already lost.

     Both the path and the width have to match. A phone that went away in
     portrait and came back in landscape has a genuinely different document, and
     reserving the old height there would be reserving the wrong number rather
     than none. */
  try {
    const raw = sessionStorage.getItem(KEY);
    const saved = raw ? JSON.parse(raw) : null;
    if (saved && saved.p === location.pathname && saved.w === innerWidth && saved.h > 0) {
      root.style.setProperty(PROP, saved.h + 'px');
    }
  } catch (e) {
    /* Storage disabled, full, or holding something this file did not write:
       no reserve, and the page behaves exactly as it did before this existed. */
  }

  /* ------------------------------------------------- release, then record

     Both jobs are the same observation — "the document's height changed" — so
     they are one callback rather than two observers.

     Order matters: the reserve is released first, because while it is up the
     document's height IS the reserved one, and recording that would write the
     reserve back into storage and make it permanent. */
  /**
   * True once the document is on its way out.
   *
   * A height measured during unload cannot be worth anything — the page is
   * leaving, and the number that matters is the one it settled at while the
   * visitor was reading it, recorded seconds ago. So the observer stops, and is
   * re-armed on a `persisted` `pageshow` because a BFCache restore hands the
   * same document back with a life ahead of it again.
   */
  let leaving = false;

  function heightChanged() {
    // Nothing is written once the document is on its way out. See `leaving`.
    if (leaving) return;

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
      // What the restored scroll position actually needs underneath it. Below
      // this the browser would clamp, and the visitor would lose their place
      // for the second time.
      const needed = Math.ceil(scrollY + innerHeight);

      /* The composition's own height, measured WITHOUT taking the reserve away.

         It used to be measured by removing the property and reading
         `scrollHeight`, which is the obvious way and is a trap: removing it
         shrinks the document *synchronously*, the browser clamps the scroll
         position to the new bottom during the very layout that
         `scrollHeight` forces, and by the next line `scrollY` is already the
         clamped value. The reserve is then put back at the wrong height, the
         document is tall again, and the visitor is somewhere they never were.

         That could not happen while the journey mounted during load, because by
         the first resize frame the real content was always taller than the
         reserve. It can now: `src/full/main.tsx` waits for the visitor's first
         move, so the frames in between have a document that is one opening
         frame, an Arrival and a footer — and this is a Back navigation, where
         the visitor's first move may be a while coming. It showed up as this
         file's own test failing under load: left at 4 965, came back at the
         bottom of a document 2 000 px tall.

         Summing the children's boxes reads the same number and changes no
         style, so nothing can clamp underneath it. `scrollHeight` is not the
         fallback it looks like either — the reserve is a `min-height` on
         `body`, and it does not move body's children. Elements with no box are
         skipped: the last child of `<body>` is a `<script>`. */
      let bottom = 0;
      for (const child of document.body.children) {
        const box = child.getBoundingClientRect();
        if (box.height > 0) bottom = Math.max(bottom, box.bottom);
      }
      const natural = Math.ceil(bottom + scrollY);

      if (natural < needed) {
        root.style.setProperty(PROP, needed + 'px');
        return;
      }
      // The real content has reached the restored position. The reserve has
      // done its job and goes, in the one place where letting it go cannot
      // move anybody.
      root.style.removeProperty(PROP);
    }

    /* Record. */
    const h = root.scrollHeight;
    const w = innerWidth;
    try {
      const raw = sessionStorage.getItem(KEY);
      const was = raw ? JSON.parse(raw) : null;
      // Rewriting the same pair on every reflow would be a write per resize
      // frame for no change. 32px is below anything that could move the restore
      // by a perceptible amount and above the sub-pixel churn of a font swap.
      if (was && was.p === location.pathname && was.w === w && Math.abs(was.h - h) < 32) return;
      sessionStorage.setItem(KEY, JSON.stringify({ p: location.pathname, h: h, w: w }));
    } catch (e) {
      /* Storage disabled or full: a page that does not get this behaviour, not
         a page that throws on every resize. */
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

    // See `leaving`. Both the disconnect and the `leaving` flag are needed: the
    // flag stops a callback already queued for the next frame, the disconnect
    // stops any after that.
    addEventListener('pagehide', () => {
      leaving = true;
      observer.disconnect();
    });
    addEventListener('pageshow', (event) => {
      if (!event.persisted) return;
      leaving = false;
      observer.observe(root);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', watch, { once: true });
  } else {
    watch();
  }
})();

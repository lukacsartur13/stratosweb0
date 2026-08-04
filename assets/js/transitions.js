/* ===========================================================================
   Page transitions — the scripted half.

   Phase 7, §15–§27. Companion to `assets/css/transitions.css`, which does the
   actual animating. This file has exactly three jobs:

     1. classify a navigation into one of §21's categories and hand that to the
        browser as a View Transition *type*;
     2. provide §22's fallback for browsers that do not implement cross-document
        View Transitions;
     3. manage focus, scroll and BFCache state around a navigation (§23–§25).

   ## What it deliberately is not

   It is **not a router**. There is no history manipulation, no fetch, no page
   snapshot, no DOM patching, and nothing here decides what a URL means. Anchors
   stay anchors: on the supported path nothing is intercepted at all, and on the
   fallback path an interception that cannot complete becomes a normal
   navigation rather than a broken one.

   **Navigation never depends on this file.** If it 404s, fails to parse, or
   throws on its first line, every link on the site still works, because the
   supported path is driven by a CSS at-rule and the fallback path only ever
   *adds* behaviour to a click it is about to let through anyway.

   ## CSP

   One first-party file under `script-src 'self'`. No inline handlers, no eval,
   no CDN, no third-party library, no new origin, and no relaxation of any
   header — §3. It is `defer`red rather than `async`, which orders it after
   parsing and before `DOMContentLoaded`.

   It does **not** order it before `pagereveal`, and nothing available here
   would: deferred scripts are not render-blocking, so a document can be
   revealed while this file is still in flight. Everything that has to happen
   on arrival is therefore written to work from either side — see the catch-up
   call at the end of the supported path.
   =========================================================================== */

(function () {
  'use strict';

  var doc = document;
  var root = doc.documentElement;

  /* §26. Read live rather than latched: a visitor can change the OS setting
     while the page is open, and the next navigation should honour the new
     answer. Every branch below consults this, and every one of them resolves to
     "navigate immediately" when it is true — reduced motion must never delay
     navigation. */
  function reducedMotion() {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /* Cross-document View Transitions need both the CSS at-rule and the Navigation
     API to classify the move. Feature-detected together because a browser with
     one and not the other would classify correctly and animate nothing, which is
     the fallback's job to cover. */
  var SUPPORTS_CROSS_DOCUMENT =
    typeof doc.startViewTransition === 'function' && 'onpagereveal' in window && 'navigation' in window;

  /* =========================================================================
     §21 — route categories.
     ========================================================================= */

  /* The locale a URL belongs to. The generated site puts English under `/en/`
     and German under `/de/`; everything else is Hungarian at the root. */
  function localeOf(url) {
    var m = /^\/(en|de)(\/|$)/.exec(url.pathname);
    return m ? m[1] : 'hu';
  }

  /* Whether a URL is one of the three homepages. `/`, `/en/`, `/de/` and their
     explicit `index.html` forms all are. */
  function isHome(url) {
    return /^\/(en\/|de\/)?(index\.html)?$/.test(url.pathname);
  }

  /* The document's own translations, read off the `hreflang` alternates the
     generator already emits on every page.
   *
   * This is why there is no slug table in this file. Working out that
   * `/kkv.html` and `/en/web-design-sme.html` are the same page otherwise means
   * embedding a copy of `SLUGS` from `_build/build.py` in JavaScript and keeping
   * the two in step forever. The markup already states the relationship; a
   * second copy of it could only ever be a way to be wrong. */
  var ALTERNATES = (function () {
    var set = Object.create(null);
    var links = doc.querySelectorAll('link[rel="alternate"][hreflang]');
    for (var i = 0; i < links.length; i++) {
      try {
        set[new URL(links[i].href, location.href).pathname] = true;
      } catch (e) {
        /* A malformed alternate is not worth failing a navigation over. */
      }
    }
    return set;
  })();

  /**
   * The transition category for a move, or null when it should not be typed.
   *
   * `el` is the activating anchor when there is one — the fallback path has it,
   * the `pagereveal` path does not, because by then the element is gone with the
   * document. Everything the classification needs beyond the two URLs is
   * therefore optional, and `data-transition` is the one thing only the anchor
   * can tell us.
   */
  function categorise(from, to, el) {
    /* §18 / §21. Opt-in, and nothing in the generated markup sets it today —
       the site has no work index and no case-study routes. Left wired so the
       markup Phase 8 introduces activates it without a change here. */
    var declared = el && el.getAttribute && el.getAttribute('data-transition');
    if (declared) return declared;

    /* §19. A locale switch is a move between two documents that are
       *translations of each other*, which is a stronger condition than "the
       locale changed".
     *
     * Both endpoints are required to be in the alternate set, and that is not
     * belt-and-braces. `ALTERNATES` is read from whichever document is running
     * this code, and every page's `hreflang` list includes a self-reference —
     * so on the incoming side (`pagereveal`, where the outgoing document is
     * already gone) `ALTERNATES[to.pathname]` is *always* true, and testing only
     * that would classify `/kkv.html` → `/en/about.html` as a locale switch. It
     * is not: it is a page-to-page move that happens to cross a locale, and it
     * should get the editorial transition, not the neutral one.
     *
     * Requiring `from` to be in the set as well makes the test mutual and
     * correct from either side, because the self-reference supplies whichever
     * of the two endpoints is the current document.
     *
     * Checked first: the Hungarian homepage linking to `/en/` is both a locale
     * switch and a home→home move, and it must read as the former. */
    if (ALTERNATES[to.pathname] && ALTERNATES[from.pathname] && localeOf(from) !== localeOf(to)) {
      return 'locale-switch';
    }

    var fromHome = isHome(from);
    var toHome = isHome(to);
    if (fromHome && !toHome) return 'home-to-page';
    if (!fromHome && toHome) return 'page-to-home';
    if (!fromHome && !toHome) return 'page-to-page';

    /* Home to home across the same locale is a reload, not a navigation. */
    return null;
  }

  /* =========================================================================
     §15 — the aperture origin.

     The homepage transition opens from where the Meridian actually is, which is
     a measured quantity and not a constant: the instrument sits on one of three
     alternating rails depending on the journey stage, and on portrait it is
     composed differently again. Published as two custom properties the
     stylesheet reads, with the viewport centre as the fallback — which is also
     the correct answer on a homepage with no instrument to measure, i.e. the
     reduced-motion and no-WebGL paths.
     ========================================================================= */
  function publishOrigin() {
    var x = '50%';
    var y = '50%';
    try {
      var stage = doc.querySelector('.journey__stage canvas, canvas[data-testid="journey-canvas"]');
      var handle = window.__stratos;
      if (stage && handle && handle.composition && typeof handle.composition.railAt === 'function') {
        var box = stage.getBoundingClientRect();
        /* `railAt` is the rail offset as a fraction of the usable width, signed
           from the centre — the same number the Phase 6 validator measures the
           instrument against, read from the page rather than recomputed. */
        var rail = handle.composition.railAt(handle.journey ? handle.journey.altitude : 0);
        if (isFinite(rail)) {
          x = (50 + rail * 100).toFixed(2) + '%';
          y = ((box.top + box.height / 2) / innerHeight * 100).toFixed(2) + '%';
        }
      }
    } catch (e) {
      /* Measurement is an enhancement of an enhancement. The centre is fine. */
    }
    root.style.setProperty('--stratos-origin-x', x);
    root.style.setProperty('--stratos-origin-y', y);
  }

  /* =========================================================================
     §25 — focus, and §24 — scroll.
     ========================================================================= */

  /* Has the visitor already started using this document?
   *
   * This is the guard that makes an *immediate* focus move safe. A focus change
   * is only ever an announcement of arrival; the moment someone has scrolled,
   * tapped, typed or pointed at the page, moving focus is no longer an
   * announcement but an interruption — it yanks a screen reader's cursor back
   * to the top of a document the visitor was already reading.
   *
   * Registered at parse time, in the capture phase, so a gesture that happens
   * between the document being revealed and the focus move still counts. Not
   * `scroll`: the browser fires that itself while restoring a position, and a
   * restoration is not an interaction.
   *
   * `once` per type keeps this from being a listener on the hot path of every
   * pointer and key event for the life of the page. */
  var engaged = false;
  (function () {
    var mark = function () {
      engaged = true;
    };
    var types = ['pointerdown', 'touchstart', 'keydown', 'wheel'];
    for (var i = 0; i < types.length; i++) {
      addEventListener(types[i], mark, { capture: true, passive: true, once: true });
    }
  })();

  /* Whether the browser is restoring a previous entry rather than delivering a
     new one. On the supported path `navigation.activation` says so directly; on
     the fallback path the navigation timing entry is the equivalent. Both mean
     the same thing: the browser's own focus and scroll restoration is
     authoritative, and §24 says to leave it alone. */
  function isRestoration(navigationType) {
    if (navigationType) return navigationType === 'traverse' || navigationType === 'reload';
    try {
      var nav = performance.getEntriesByType('navigation')[0];
      return !!nav && (nav.type === 'back_forward' || nav.type === 'reload');
    } catch (e) {
      return false;
    }
  }

  /* Decided once per document, by whichever caller gets there first — see the
     catch-up call at the end of the supported path for why there are two. */
  var decided = false;

  /* Record what was decided and when, for the harness. One property
     assignment, no node touched — see `focusMain` for why that distinction is
     load-bearing rather than stylistic. `at` is milliseconds from this
     document's navigation start, which is the only figure that says whether
     the move was immediate; a harness polling from outside can only bracket
     it between two round trips. */
  function publishOutcome(outcome) {
    try {
      window.__stratosFocus = {
        outcome: outcome,
        at: typeof performance === 'object' && performance.now ? Math.round(performance.now()) : null,
      };
    } catch (e) {
      /* A diagnostic that cannot be published is not worth a navigation. */
    }
  }

  /**
   * Move focus to the destination's main landmark, immediately.
   *
   * ## Immediately, and why that is now possible
   *
   * This used to run off `viewTransition.finished` — after the animation — and
   * on the three React homepages that was too late in a way no amount of
   * waiting fixes: the landmark did not exist yet. `#main` was rendered by
   * React inside a `<div id="root">`, a second or so and one 1 MB scene chunk
   * after the document was ready, so `getElementById` returned null and this
   * function returned having done nothing. Ten of the measured navigation rows
   * left focus on `BODY` for that reason.
   *
   * The fix is not to poll until the landmark appears — a focus change landing
   * a second after a navigation steals focus from someone who has started
   * reading, which is worse than not moving it. The fix is for the landmark to
   * exist before React does: the locale shells now carry
   * `<main class="journey" id="main" tabindex="-1">` as the React mount host,
   * and React never replaces a container it renders into. See
   * experiments/home/hu.html and experiments/src/full/main.tsx.
   *
   * With a target that is present in the parsed HTML, the right moment is the
   * earliest one: whichever comes first of this file executing and `pagereveal`
   * firing, both of which are before the first paint of the new document.
   * Focusing there is not "during the transition" in any sense that matters —
   * the view-transition pseudo-tree paints snapshots over the live DOM, and the
   * live DOM is this one. What it avoids is the window in which the visitor can
   * begin interacting before focus has settled. Measured across every
   * navigation row: 13–169 ms from navigation start.
   *
   * ## What it refuses to do
   *
   * `preventScroll` matters as much as the focus does: focusing an element
   * scrolls it into view by default, which on a page whose main landmark starts
   * below a full-height header would scroll past the top of the document the
   * instant it loaded. §24 asks for "the intended top position"; the browser has
   * already put us there, and this must not undo it.
   *
   * Nothing here touches focus *indication*. The move is programmatic onto an
   * element with `tabindex="-1"`, which does not match `:focus-visible`, so no
   * ring is drawn here and — the part that matters — none is suppressed
   * anywhere: every `:focus-visible` rule the site has still applies to every
   * link and control on the destination page.
   *
   * ## The outcome is published on `window`, and deliberately not in the DOM
   *
   * A deliberate refusal and a missing landmark are very different results, and
   * `document.activeElement` reads `BODY` for both — so the outcome is recorded
   * somewhere a harness can read it. That used to be a `data-stratos-focus`
   * attribute on `<html>`, and it was a real defect rather than a harmless
   * hook: writing to the root element during the destination's first
   * milliseconds invalidates root style, which advances the rendering pipeline
   * far enough that on a back navigation the document is sometimes *revealed
   * before Chromium has applied its scroll restoration*. The homepage's height
   * comes from React, so a reveal that early finds a 720 px document and the
   * restore never lands.
   *
   * Measured, twelve trials each, isolated by serving a build with this
   * function neutered and nothing else changed:
   *
   *     with the attribute write      7/12 restored
   *     focus code neutered          12/12
   *     transitions.js absent        12/12
   *
   * The two controls agreeing exactly is what identified the attribute rather
   * than the focus move — which never happens on a traverse, and did not
   * happen in any of the failing runs either. A plain property assignment has
   * no such effect: it touches no node, invalidates no style, and forces no
   * layout. Diagnostics must not be able to change the thing they measure.
   */
  function focusMain(navigationType) {
    if (decided) return window.__stratosFocus && window.__stratosFocus.outcome;
    decided = true;

    var outcome = (function () {
      /* The browser restores focus and scroll on a traverse; §24. */
      if (isRestoration(navigationType)) return 'skipped-restore';
      /* Already reading, already typing, already scrolling. Leave them be. */
      if (engaged) return 'skipped-engaged';
      /* Something else already holds focus — an autofocus, or a control the
         visitor reached first. Taking it is the same theft as above. */
      var active = doc.activeElement;
      if (active && active !== doc.body && active !== root) return 'skipped-focused';

      var main = doc.getElementById('main') || doc.querySelector('main, h1');
      if (!main) return 'absent';

      /* The three homepage shells carry `tabindex="-1"` in their markup,
         because there the attribute has to be true before React exists. The
         eleven generated static pages do not, and do not need to: their
         landmark is in the document from the first byte, so adding the
         attribute here and removing it on blur is enough — and it keeps the
         promise it always made, that the landmark never becomes a stop in the
         tab order. Both shapes are handled, neither is assumed. */
      var had = main.hasAttribute('tabindex');
      if (!had) main.setAttribute('tabindex', '-1');
      try {
        main.focus({ preventScroll: true });
      } catch (e) {
        main.focus();
      }
      if (!had) {
        main.addEventListener(
          'blur',
          function () {
            main.removeAttribute('tabindex');
          },
          { once: true },
        );
      }
      return doc.activeElement === main ? 'focused' : 'failed';
    })();

    publishOutcome(outcome);
    return outcome;
  }

  /* §24 — native scroll restoration is kept by NOT touching it.
   *
   * This used to be `history.scrollRestoration = 'auto'`, written as a
   * statement of intent: 'auto' is already the default, so the assignment
   * changed nothing and made a future edit argue with a line of code. It turned
   * out not to change nothing. On a back navigation to the homepage, assigning
   * this property during the destination's first milliseconds is part of what
   * makes Chromium reveal the document before it has applied the restore — and
   * the homepage's height comes from React, so a reveal that early finds a
   * 720 px document and the offset is lost.
   *
   * Twelve trials per arm, each patching one line out of the shipped file:
   *
   *     as shipped, both statements present    6/12 restored
   *     without this assignment               12/12
   *     without the startup publishOrigin()   12/12
   *     transitions.js absent entirely        12/12
   *
   * Either removal is sufficient, which says the mechanism is the amount of
   * work done before the reveal rather than any one call being uniquely
   * poisonous. Both are gone: this assignment because it was a no-op that
   * happened to poke the exact API the section is about, and the startup
   * `publishOrigin()` because on a traverse there is no transition for it to
   * describe (see the guard at the end of the supported path).
   *
   * The intent the assignment was documenting is preserved here, where it
   * belongs — in prose, which cannot perturb a page. */

  /* =========================================================================
     The supported path: cross-document View Transitions.

     No link interception whatsoever. Middle-click, ⌘-click, Shift-click,
     "open in new tab", the back button and keyboard activation all keep working
     because nothing here calls `preventDefault` — §20's "the anchor element
     remains the source of truth", achieved by not touching anchors at all.
     ========================================================================= */

  if (SUPPORTS_CROSS_DOCUMENT) {
    /**
     * Acknowledge a transition's promises, whatever becomes of it.
     *
     * A transition that is skipped, or interrupted by the next navigation
     * arriving before this one finishes, rejects `ready` and
     * `updateCallbackDone` with "Transition was skipped". Both are *documented
     * outcomes* — one of them is the direct result of calling
     * `skipTransition()` — but a rejected promise with no handler attached is
     * an unhandled rejection, and an unhandled rejection is a page error. So
     * reduced motion, an unclassifiable move, a same-locale home→home reload
     * and a visitor who clicks the next link before the last transition
     * finished all put an error in the console describing something the code
     * had just deliberately asked for.
     *
     * This file has no use for either promise — the focus move no longer waits
     * on `finished`, which is what had been silencing this as a side effect —
     * so every transition it is handed is acknowledged and nothing is awaited.
     */
    var quiet = function () {};
    var acknowledge = function (vt) {
      if (vt.ready && vt.ready.catch) vt.ready.catch(quiet);
      if (vt.finished && vt.finished.catch) vt.finished.catch(quiet);
      if (vt.updateCallbackDone && vt.updateCallbackDone.catch) vt.updateCallbackDone.catch(quiet);
    };
    var skipTransition = function (vt) {
      vt.skipTransition();
      acknowledge(vt);
    };

    /* Outgoing. `pageswap` fires with the transition already created, so the
       type has to be added synchronously here — this is not a place to await
       anything. */
    addEventListener('pageswap', function (event) {
      if (!event.viewTransition) return;
      acknowledge(event.viewTransition);
      if (reducedMotion()) {
        skipTransition(event.viewTransition);
        return;
      }
      /* No traverse guard on this side, deliberately.
       *
       * The obvious symmetry — skip here too, so both halves agree — was tried
       * and measured worse: 5/10 restored against 12/12 for the incoming guard
       * alone. `isRestoration` falls back to `performance.getEntriesByType`
       * when it is not handed a navigation type, and on the *outgoing*
       * document that entry describes how **this** document was loaded, not
       * where the visitor is going. Asked on this side it is simply the wrong
       * question, and answering it wrongly skipped transitions that should have
       * run.
       *
       * The incoming side is where a traverse can be identified correctly
       * (`navigation.activation` belongs to the navigation being activated) and
       * where the scroll restoration is actually at stake. One guard, on the
       * side that can answer, is both sufficient and the only one that is
       * right. */
      try {
        var entry = event.activation && event.activation.entry;
        if (!entry) return;
        var to = new URL(entry.url);
        var type = categorise(new URL(location.href), to, null);
        if (type) event.viewTransition.types.add(type);
        else skipTransition(event.viewTransition);
        publishOrigin();
      } catch (e) {
        /* A transition that cannot be classified is a transition that does not
           happen. The navigation itself is unaffected. */
        skipTransition(event.viewTransition);
      }
    });

    /* Incoming. The pseudo-element tree lives in this document, so this is the
       side whose types actually drive the CSS. */
    addEventListener('pagereveal', function (event) {
      /* §25 — focus first, and independently of whether anything animates.
         Focus management is not a decoration of the transition: a visitor on
         reduced motion, or on a navigation that was not typed at all, arrives
         at the same document and deserves the same announcement. It runs before
         the transition branch below so that no `return` in that branch can skip
         it, and inside its own `try` so that a throw here cannot take the
         transition down with it.
       *
       * `activation.from` is the gate on "in-site move". A typed URL, a
       * bookmark or an external referral is a fresh entry to the site, not an
       * arrival from somewhere: the browser has already put focus at the
       * document root, which is where it belongs. */
      try {
        var act = navigation.activation;
        if (act && act.from) focusMain(act.navigationType);
      } catch (e) {
        /* No activation to read is no navigation to announce. */
      }

      if (!event.viewTransition) return;
      acknowledge(event.viewTransition);
      if (reducedMotion()) {
        skipTransition(event.viewTransition);
        return;
      }

      /* §24 — a traverse is not animated, and this is the whole of the section
       * rather than a concession to it.
       *
       * "Back/forward keeps the browser's own behaviour" cannot survive a view
       * transition being run over the top of it. Creating one holds rendering
       * while both sides are snapshotted, and on the homepage that is the same
       * window Chromium applies its scroll restoration in — so the animation
       * was being paid for with the scroll position, which is the one thing a
       * visitor pressed Back to get.
       *
       * Twelve trials per arm, each patching the shipped file:
       *
       *     transition on traverse     7/12 restored
       *     transition skipped        12/12
       *     transitions.js absent     12/12
       *
       * Skipped matches absent exactly, which is the result to aim at: with
       * this in place the transition layer is not merely *tolerable* on
       * back/forward, it is undetectable, and §24 is satisfied by behaviour
       * rather than by intent.
       *
       * The visitor loses nothing they had. A back navigation restoring
       * instantly, at the position they left, is what a browser does and what
       * they expect; an animated one is a novelty that costs them their place.
       */
      try {
        var traversal = navigation.activation;
        if (traversal && isRestoration(traversal.navigationType)) {
          skipTransition(event.viewTransition);
          return;
        }
      } catch (e) {
        /* Unreadable activation: fall through and classify as usual. */
      }

      try {
        var activation = navigation.activation;
        if (!activation || !activation.from) {
          skipTransition(event.viewTransition);
          return;
        }
        var from = new URL(activation.from.url);
        var to = new URL(activation.entry.url);
        var type = categorise(from, to, null);
        if (type) event.viewTransition.types.add(type);
        else skipTransition(event.viewTransition);

        /* §24 again — not on a traverse, and it costs nothing to skip.
         *
         * `publishOrigin` forces a layout and writes two custom properties on
         * `<html>`, which on a back or forward navigation lands inside the
         * window Chromium restores scroll in. What it would have written there
         * is the 50%/50% fallback regardless: the origin is measured off the
         * Meridian's canvas, and on a document that has just been revealed
         * React has not mounted one, so the query finds nothing and the
         * fallback is the answer. Skipping is identical output for less work at
         * the worst possible moment. */
        if (!isRestoration(activation.navigationType)) publishOrigin();
      } catch (e) {
        skipTransition(event.viewTransition);
      }
    });

    /* §25 — the catch-up, and it is not belt-and-braces.
     *
     * `defer` guarantees this file executes before `DOMContentLoaded`. It does
     * **not** guarantee it executes before `pagereveal`, and the two facts are
     * unrelated: deferred scripts are not render-blocking, so a document whose
     * stylesheets are cached can be revealed while this file is still in
     * flight. The listener registered above then never sees an event that has
     * already happened, and the arrival is never announced.
     *
     * Measured, not theorised. In a cold profile the *first* navigation off the
     * homepage missed the reveal on every run — `pagereveal` fired at 143 ms
     * with a perfectly good `activation`, and this file had not run yet — while
     * the second and third, with the file in cache, fired both in the same
     * millisecond and worked. A defect that only appears on a visitor's first
     * click is the worst possible one to leave to a race.
     *
     * So: whichever of the two gets there first decides, and `focusMain`
     * latches so the other becomes a no-op. Running here is not "late" in any
     * sense that matters — deferred scripts run after parsing, so the landmark
     * is in the document, and this is still inside the same rendering
     * opportunity the reveal belongs to. The engagement guard covers the
     * pathological case where it is not.
     *
     * The `activation.from` gate is the same one the listener applies: only an
     * in-site move announces itself. */
    var startupType = null;
    try {
      var startup = navigation.activation;
      startupType = startup && startup.navigationType;
      if (startup && startup.from) focusMain(startupType);
    } catch (e) {
      /* No activation to read is no navigation to announce. */
    }

    /* §24 — nothing eager on a traverse.
     *
     * `publishOrigin` measures the instrument and writes two custom properties
     * on `<html>`: a `getBoundingClientRect`, so a forced layout, and a style
     * write on the root element, in the destination's first milliseconds. On a
     * back or forward navigation that is work done during the exact window
     * Chromium is applying its scroll restoration in, and it is work done for
     * nothing — a traverse has no aperture to open from, because the outgoing
     * document it would have opened from is the one being returned to.
     *
     * Removing it takes the homepage's back-navigation restore from 6/12 to
     * 12/12; see the note on scroll restoration above for the full arm-by-arm
     * measurement. Every path that actually needs an origin still publishes one
     * — `pageswap` before the outgoing snapshot, `pagereveal` on the way in,
     * and the fallback click handler — so nothing about the transition changes.
     */
    if (startupType !== 'traverse' && startupType !== 'reload') publishOrigin();
    return;
  }

  /* =========================================================================
     §22 — the fallback, for everything else.

     A fixed veil, faded in over the outgoing page and out of the incoming one.
     No snapshot is retained, no navigation is held open past a hard timeout,
     and every temporary node and class is removed on the way out.
     ========================================================================= */

  var VEIL_CLASS = 'stratos-veil';
  /* §15/§27. The bound on how long a navigation may be delayed. Chosen to be
     comfortably shorter than the CSS fade so the veil is never mid-animation
     when the document goes, and short enough that a visitor on a slow machine
     experiences a transition rather than a stall. */
  var HOLD_MS = 260;

  var navigating = false;

  function removeVeils() {
    var veils = doc.getElementsByClassName(VEIL_CLASS);
    /* Live HTMLCollection — iterate from the end, or removing shifts the index
       out from under the loop and leaves every second veil in the DOM. */
    for (var i = veils.length - 1; i >= 0; i--) {
      veils[i].parentNode && veils[i].parentNode.removeChild(veils[i]);
    }
  }

  function makeVeil(state) {
    /* §22: "no duplicate overlays". One at a time, always. */
    removeVeils();
    var veil = doc.createElement('div');
    veil.className = VEIL_CLASS;
    veil.setAttribute('aria-hidden', 'true');
    veil.dataset.state = state;
    doc.body.appendChild(veil);
    return veil;
  }

  /* -------------------------------------------------------------------------
     §20 — eligibility. Every exclusion here is a case where intercepting the
     click would take away behaviour the visitor asked for.
     ------------------------------------------------------------------------- */
  function eligible(event, a) {
    /* Modified clicks are requests for a *different* action — new tab, new
       window, download, save. `preventDefault` on any of them silently does
       the wrong thing, and this is the exact defect in the curtain this
       replaces: it called `preventDefault()` unconditionally, so ⌘-click on
       every internal link on the site opened in the current tab instead of a
       new one. */
    if (event.defaultPrevented) return false;
    if (event.button !== 0) return false;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;

    if (!a || !a.href) return false;
    if (a.target && a.target !== '_self') return false;
    if (a.hasAttribute('download')) return false;
    /* An explicit opt-out, for a link that must never be decorated. */
    if (a.hasAttribute('data-no-transition')) return false;
    if (a.getAttribute('rel') === 'external') return false;

    var url;
    try {
      url = new URL(a.href, location.href);
    } catch (e) {
      return false;
    }

    /* mailto:, tel:, and anything else that is not a web page. */
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    if (url.origin !== location.origin) return false;

    /* A same-document hash is not a navigation. */
    if (url.pathname === location.pathname && url.search === location.search && url.hash) return false;
    if (url.href === location.href) return false;

    /* §20 — the portal is a react-router SPA behind authentication, and the
       API and file routes are not documents. Animating into any of them
       animates across a boundary where the destination may be a redirect to a
       login screen, which makes an auth bounce look like a rendering fault. */
    if (/^\/(portal|api|assets|models)(\/|$)/.test(url.pathname)) return false;
    if (/\.(pdf|zip|json|xml|txt|csv|glb|png|jpe?g|webp|svg|woff2?)$/i.test(url.pathname)) return false;

    return true;
  }

  doc.addEventListener('click', function (event) {
    if (reducedMotion()) return;
    if (navigating) return;

    var a = event.target.closest && event.target.closest('a');
    if (!a || !eligible(event, a)) return;

    var to;
    try {
      to = new URL(a.href, location.href);
    } catch (e) {
      return;
    }
    if (!categorise(new URL(location.href), to, a)) return;

    /* Past this point the navigation is ours, and it *will* happen: the timeout
       below is unconditional and is set before anything that could throw. */
    event.preventDefault();
    navigating = true;

    var went = false;
    var go = function () {
      if (went) return;
      went = true;
      location.href = a.href;
    };

    /* §27. The hard timeout is the primary path, not the error path. Nothing
       waits on a transition event, an animation frame or a `transitionend` —
       all three can fail to fire on a backgrounded tab, and a navigation that
       depends on one never happens. */
    setTimeout(go, HOLD_MS);

    try {
      publishOrigin();
      var veil = makeVeil('out');
      /* Force layout so the transition from `opacity: 0` actually runs rather
         than being coalesced into the initial paint. */
      void veil.offsetWidth;
      veil.dataset.state = 'out';
    } catch (e) {
      go();
    }
  });

  /* -------------------------------------------------------------------------
     §23 — history and BFCache.
     ------------------------------------------------------------------------- */

  /* On the way out. A veil left in the DOM at `pagehide` is a veil that comes
     back with the page on a BFCache restore — the one case a naive
     implementation gets wrong, and the one that leaves a permanent grey sheet
     over a restored document. */
  addEventListener('pagehide', function () {
    removeVeils();
    navigating = false;
  });

  /* On the way in, including from BFCache. `persisted` distinguishes a restore
     from a fresh load; both must end in a clean settled state, so both clear. */
  addEventListener('pageshow', function (event) {
    navigating = false;
    if (event.persisted) {
      /* §23: "A page restored from BFCache must immediately appear in a clean
         settled state." No fade in, no replayed transition — and no focus move
         either. A BFCache restore hands back the document *and its focus and
         scroll position exactly as they were left*; that restoration is the
         authority here, and moving focus to the top would throw away the one
         thing the visitor pressed Back to get. */
      removeVeils();
      publishOutcome('skipped-restore');
      return;
    }

    /* Only an in-site arrival announces itself. A direct URL entry, a bookmark
       or an external referral is a fresh entry to the site, and the browser has
       already put focus where it belongs. */
    var internal = false;
    try {
      internal = !!doc.referrer && new URL(doc.referrer).origin === location.origin;
    } catch (e) {
      internal = false;
    }
    if (!internal) return;

    /* §25, before §22 and unconditionally on reduced motion. The veil below is
       motion and is correctly skipped when motion is not wanted; focus is not
       motion, and a reduced-motion visitor arriving from another page on the
       site gets the same landmark focus as everyone else.
     *
       No navigation type is passed — `isRestoration` reads the navigation
       timing entry instead, which is how this path recognises a back/forward
       that missed the BFCache and must keep native restoration. */
    focusMain();

    /* A fresh load fades the veil away, so the destination resolves out of the
       veil the source faded into. */
    if (reducedMotion()) return;

    var veil = makeVeil('in');
    void veil.offsetWidth;
    veil.dataset.state = 'clear';
    /* Removed on a timer rather than on `transitionend`, which does not fire on
       a backgrounded tab — §27's "hidden tabs". The timer is longer than the
       CSS duration so the node outlives its own animation. */
    setTimeout(removeVeils, 600);
  });

  /* A tab that goes to the background mid-navigation may never fire the events
     the veil would otherwise be cleared by. §23 lists `visibilitychange` for
     exactly this. */
  addEventListener('visibilitychange', function () {
    if (doc.visibilityState === 'visible' && !navigating) removeVeils();
  });

  publishOrigin();
})();

/* ==========================================================================
   STRATOS — flight deck header and the full-screen navigation layer.

   WHAT REPLACED WHAT
   ------------------
   The old header had one behaviour worth keeping (a solid background past
   40 px) and one worth deleting: `is-hidden` when `y > 400 && y > lastY`, a
   direction-based hide/show. That reads the sign of a delta, so a trackpad's
   natural micro-reversals toggle it, and the header flickers while you are
   simply reading. The brief calls that out by name.

   What is here instead is a state machine over ONE monotonic number — position
   in the document, 0 to 1 — with hysteresis at the boundaries. Same scroll
   position always means the same header, whichever way you arrived at it.

     opening      0.00 – 0.06   full wordmark, full navigation, transparent
     journey      0.06 – 0.88   compact mark, altitude, menu trigger
     destination  0.88 – 1.00   navigation returns, Start Project comes forward

   The altitude in the journey state is the same number the altimeter rail
   shows, derived from the same `data-ceiling`, because two instruments on one
   page disagreeing about the altitude would be worse than having one.

   THE HOMEPAGE
   ------------
   The homepage is a separate React/WebGL bundle with its own canonical journey
   progress, and document scroll position is not that progress. So this file
   does not guess: `Stratos.header.push()` lets the homepage supply the real
   number, and until something does, document position is used. One header, one
   state machine, two sources.

   It is a PUSH and not a poll, and that is the whole design. The first version
   of this hook took a getter and then read it from a `requestAnimationFrame`
   loop of its own — which is a second permanent animation loop on the one page
   that already runs a renderer, a damped altitude clock, a cloud system and a
   kinetic type driver at 60 Hz. The homepage already has a frame; the header
   rides it. `JourneyHUD`'s tick calls `publishHeader()`, which calls this, and
   this file schedules nothing at all while it is being driven.

   The homepage also supplies its own altitude, its own stage label and its own
   state boundaries, because all three are things it knows and this file would
   have to guess: the altitude curve is piecewise, not linear in scroll, and the
   destination state has to begin where the closing panels begin rather than at
   an 0.88 that happens to be near them. See experiments/src/full/siteHeader.ts.
   ========================================================================== */
(() => {
  'use strict';

  const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const nav = document.querySelector('.nav');
  if (!nav) return;

  /* -------------------------------------------------------------- states */

  const altV = nav.querySelector('.nav__alt-v');
  const altK = nav.querySelector('.nav__alt-k');
  const CEIL = Number(document.body.dataset.ceiling || 30000);
  const FLOOR = 420;

  // Hysteresis: a boundary you have crossed sits further away than the one you
  // have not, so a header cannot chatter between two states while you hover on
  // the line between them.
  //
  // Mutable because the homepage replaces both pairs with boundaries derived
  // from its own stage map — see `push` below. Nothing else writes them.
  let EDGES = [[0.06, 0.045], [0.88, 0.855]];
  let state = 'opening';

  /* Settle on a state, rather than step one towards it.

     One call used to move at most one state. While the visitor is scrolling
     that is invisible and even correct — you really do pass through `journey`
     on the way from `opening` to `destination`, one frame at a time. It is
     wrong for every *jump*, and the page is full of them: Return to 0 m under
     reduced motion, a bfcache entry restored deep in the document, a fragment
     link, a browser restoring the scroll position on reload. All of those
     arrive in a single paint, so the header would land one state short and stay
     there — `paint` is gated on the progress having moved, and after a jump it
     does not move again until the visitor scrolls far enough to cross the gate.
     A page opened at the bottom sat in `journey` over its own footer.

     Iterating to a fixed point crosses exactly the same boundaries in exactly
     the same order and honours the same hysteresis. It just does not need a
     second event to finish. Two transitions is the most the three states can
     need; the guard is there so that a future edge table that disagreed with
     itself would stop rather than spin. */
  function resolve(p) {
    let s = state;
    for (let guard = 0; guard < 3; guard++) {
      const i = s === 'opening' ? 0 : s === 'journey' ? 1 : 2;
      let next = s;
      if (i < 2 && p > EDGES[i][0]) next = i === 0 ? 'journey' : 'destination';
      else if (i > 0 && p < EDGES[i - 1][1]) next = i === 1 ? 'opening' : 'journey';
      if (next === s) return s;
      s = next;
    }
    return s;
  }

  const pad = (m) =>
    String(m).padStart(5, '0').replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

  let shownAlt = -1;
  let shownKey = null;

  /** `alt` in metres and `key` the readout's label, or null to derive/keep. */
  function paint(p, alt, key) {
    const next = resolve(p);
    if (next !== state) { state = next; nav.dataset.state = state; }
    nav.classList.toggle('is-solid', p > 0.012);

    if (altV) {
      // Linear in document position on the generated routes, where the ceiling
      // is the only altitude the page declares. The homepage passes the real
      // metres, because its altitude curve is piecewise and re-derived here it
      // would disagree with its own instrument.
      const m = Math.round(alt === null || alt === undefined
        ? FLOOR + p * (CEIL - FLOOR)
        : alt);
      if (m !== shownAlt) {
        shownAlt = m;
        // Zero-padded to five so the readout never changes width and the
        // header never reflows around a number ticking over.
        altV.textContent = pad(m);
      }
    }

    if (altK && key != null && key !== shownKey) {
      shownKey = key;
      altK.textContent = key;
    }
  }

  /* ------------------------------------------------------------- the loop */

  let external = false;     // true once the homepage has pushed once
  let frame = 0;
  let last = -1;

  function progress() {
    const h = document.documentElement.scrollHeight - innerHeight;
    return h > 0 ? Math.min(1, Math.max(0, scrollY / h)) : 0;
  }

  function tick() {
    frame = 0;
    // A page being driven from outside has an owner for its progress; this
    // listener is here for the other 66 routes and must not fight it.
    if (external) return;
    const p = progress();
    // Sub-pixel scroll noise must not cost a repaint.
    if (Math.abs(p - last) > 0.0004) { last = p; paint(p, null, null); }
  }

  function schedule() { if (!frame) frame = requestAnimationFrame(tick); }

  addEventListener('scroll', schedule, { passive: true });
  addEventListener('resize', schedule, { passive: true });
  paint(progress(), null, null);

  /* ------------------------------------------------------- the menu layer */

  const burger = document.querySelector('.burger');
  const menu = document.getElementById('menu');

  if (burger && menu) {
    const FOCUSABLE = 'a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])';
    let restoreTo = null;
    let scrollLock = 0;

    /* ------------------------------------------------- the background, inert

       WHY THE KEYDOWN TRAP BELOW WAS NOT ENOUGH
       -----------------------------------------
       It wraps focus when `document.activeElement` is the first or the last
       element of a list it builds itself. That is a correct description of
       Chromium's tab order and a wrong one of WebKit's: on WebKit, links are
       not in the sequential focus order unless the visitor has turned on "press
       Tab to highlight each item on a webpage", which is off by default and is
       the specified platform behaviour rather than a bug.

       The layer is seventeen links and nothing else. So on WebKit the trap's
       list is never the tab order at all — the *first* Tab out of the opening
       link went straight past every one of them to the next form control in the
       document, which is the newsletter field in the footer, and every
       subsequent Tab and Shift+Tab stayed out there. Measured, all three
       compositions, in experiments/probe-menu-modality.mjs:

           chromium   0 escapes forward, 0 backward
           webkit    15 escapes forward, 15 backward  (homepage)
                     27 / 27                          (generated routes)

       No list this file can build fixes that, because the defect is not in the
       list: the elements behind the layer are still in the document's focus
       order, and a trap can only ever react to focus having already left.

       So the background is taken out of the focus order instead. `inert` is the
       platform's own answer — it removes a subtree from sequential focus, from
       hit testing and from the accessibility tree in one attribute, which is
       three of §2's requirements and not three mechanisms.

       WHAT IS *NOT* MADE INERT, AND WHY EACH ONE
       ------------------------------------------
       `<body>` itself is not, because the layer is inside it and would go with
       it. Neither is the header, for the same reason: the trigger lives there
       and is the close control. What is left interactive is exactly what is
       still visible above the layer, measured rather than assumed —

           .burger   the trigger, which is the close control while open
           .brand    still at full opacity and still the topmost element at its
                     own centre point on both compositions; a visible link that
                     cannot be clicked would be a defect of its own
           #menu     the layer

       — and everything else in the header is `opacity: 0; pointer-events: none`
       under `.menu-open` already (chrome.css), so making it inert takes away
       nothing a visitor could reach.

       The keydown trap stays. It is what makes Chromium cycle *within* the
       layer rather than tab out to the browser's own chrome, and it is the only
       barrier left on an engine too old for `inert` — which is why this is a
       feature test and not an assumption. */
    const SUPPORTS_INERT = 'inert' in HTMLElement.prototype;

    /** Everything behind the layer, in one flat list. Rebuilt on each open:
     *  the homepage's `<main>` is a React container and the deck is shared with
     *  66 routes, so the body's children are not a constant. */
    function background() {
      const out = [];
      for (const el of document.body.children) {
        if (el === nav || el === menu) continue;
        if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'TEMPLATE') continue;
        out.push(el);
      }
      for (const el of nav.children) {
        if (el !== burger && !el.classList.contains('brand')) out.push(el);
      }
      return out;
    }

    /* Only the elements this file actually set are cleared again, so an `inert`
       that arrived from somewhere else survives a menu open/close cycle. */
    let inerted = [];

    function setBackgroundInert(on) {
      if (!SUPPORTS_INERT) return;
      if (on) {
        inerted = background().filter((el) => !el.inert);
        for (const el of inerted) el.inert = true;
      } else {
        for (const el of inerted) el.inert = false;
        inerted = [];
      }
    }

    /* The trigger is part of the trap, not outside it. It lives in the header
       rather than in the layer, but while the layer is open it IS the close
       control — leaving it out would trap a keyboard user in a navigation whose
       only exit is a key nobody told them about. It goes first because that is
       its position in the document. */
    const focusables = () => [burger, ...menu.querySelectorAll(FOCUSABLE)]
      .filter(el => el.offsetParent !== null || el === document.activeElement);

    /* The scroll lock below is position-fixed body, which collapses the
       document to one viewport and puts `scrollY` at 0 for as long as the layer
       is open. On the 66 generated routes nothing reads that. On the homepage
       ScrollTrigger does, and it would drive the whole ascent back down to 0 m
       behind the menu and ease it back up again on close — the visitor opens
       the navigation at 24 000 m and closes it somewhere over the mountains.
       So the lock announces itself, and the journey's scroll driver stands down
       for the duration. See useJourneyScroll.ts. */
    const announce = (open) =>
      dispatchEvent(new CustomEvent('stratos:menu', { detail: { open } }));

    /* The close transition's "now really hide it" timer, so that an open can
       take it back.

       `close()` cannot hide the layer immediately — it has a 420ms transition to
       play out — so it hides it on a timer. Without a handle, that timer
       survives a reopen: a visitor who closes the navigation and opens it again
       inside 420ms gets `hidden = true` applied to a layer that is now open, and
       the result is a menu that `aria-expanded`, `.is-open` and the focus
       position all describe as open while nothing is on screen. Reproduced on
       both engines at every gap below 420ms, and it is the failure
       homepage-modality.spec.ts caught on desktop-webkit. */
    let hideTimer = 0;

    function open() {
      clearTimeout(hideTimer);
      hideTimer = 0;
      restoreTo = document.activeElement;
      announce(true);
      scrollLock = scrollY;
      menu.hidden = false;
      // Force a frame so the transition has a "from" to animate out of. Under
      // reduced motion the CSS has no transition at all and this is a no-op.
      if (!RM) menu.getBoundingClientRect();
      requestAnimationFrame(() => menu.classList.add('is-open'));
      burger.setAttribute('aria-expanded', 'true');
      relabel();
      document.documentElement.classList.add('menu-open');
      // Position-fixed body rather than overflow:hidden — iOS Safari ignores
      // overflow on <body> and the page scrolls behind the layer regardless.
      document.body.style.cssText += `position:fixed;top:${-scrollLock}px;left:0;right:0;width:100%`;
      // Before focus moves, not after: making a subtree inert blurs whatever it
      // holds, and doing that *after* placing focus in the layer would be a
      // second focus move the visitor did not ask for. `restoreTo` is already
      // captured above, so a trigger that was itself in the background — a
      // fragment link into the menu, say — is still restorable on close.
      setBackgroundInert(true);
      // Focus opens on the first destination, not on the trigger the user just
      // pressed — landing back on the control you activated says nothing about
      // what opened.
      (focusables()[1] || focusables()[0] || menu).focus({ preventScroll: true });
    }

    function close() {
      // First, and before the focus restore at the bottom of this function: the
      // element focus is going back to is usually in the background, and
      // `.focus()` on an inert element does nothing at all.
      setBackgroundInert(false);
      menu.classList.remove('is-open');
      burger.setAttribute('aria-expanded', 'false');
      relabel();
      document.documentElement.classList.remove('menu-open');
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.left = '';
      document.body.style.right = '';
      document.body.style.width = '';
      scrollTo(0, scrollLock);
      // After the restore, never before it: the driver re-reads the scroll
      // position when it comes back, and it has to read the restored one.
      announce(false);
      const done = () => { hideTimer = 0; menu.hidden = true; };
      clearTimeout(hideTimer);
      if (RM) done();
      else hideTimer = setTimeout(done, 420);
      // Focus goes back where it came from. Losing it to <body> is the bug
      // that makes a keyboard user restart from the top of the document.
      //
      // `document.contains()` alone did not prevent it, because <body> passes
      // that test. WebKit does not focus a <button> when you click it — that is
      // the specified behaviour, not a quirk — so on iOS Safari `restoreTo` is
      // whatever held focus at the moment of the tap, and for a visitor who has
      // not been tabbing that is <body>. `body.focus()` then does nothing at
      // all: focus stays on the menu link, the layer is hidden 420ms later, and
      // the link taking focus with it is exactly the drop to <body> this line
      // exists to prevent. Chromium hid it completely, because there a click
      // focuses the button and `restoreTo` is the burger.
      //
      // So the question is not "does the element still exist" but "is it
      // somewhere focus can meaningfully go back to".
      const restorable =
        restoreTo &&
        restoreTo !== document.body &&
        restoreTo !== document.documentElement &&
        document.contains(restoreTo);
      (restorable ? restoreTo : burger).focus({ preventScroll: true });
    }

    const isOpen = () => burger.getAttribute('aria-expanded') === 'true';

    /* The trigger is also the close control, so its accessible name has to say
       which. Both words are already in the markup for the visual swap, and
       reading them from there keeps this file free of translated strings. */
    const LABEL_OPEN = burger.getAttribute('aria-label') || '';
    const LABEL_SHUT = burger.querySelector('.burger__shut')?.textContent.trim() || LABEL_OPEN;
    const relabel = () => burger.setAttribute('aria-label', isOpen() ? LABEL_SHUT : LABEL_OPEN);

    burger.addEventListener('click', () => (isOpen() ? close() : open()));
    menu.addEventListener('click', (e) => {
      if (e.target.closest('[data-menu-dismiss]') || e.target.closest('a')) close();
    });

    document.addEventListener('keydown', (e) => {
      if (!isOpen()) return;
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key !== 'Tab') return;
      // Focus trap. The layer covers the viewport; tabbing to something behind
      // it would be tabbing to something invisible.
      const f = focusables();
      if (!f.length) return;
      const first = f[0], lastEl = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); lastEl.focus(); }
      else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); first.focus(); }
    });

    // A cross-document transition or a bfcache restore must never leave the
    // layer open, the body fixed, or the scroll position stranded.
    addEventListener('pagehide', () => { if (isOpen()) close(); });
    addEventListener('pageshow', (e) => { if (e.persisted && isOpen()) close(); });
  }

  /* --------------------------------------------------------- return to 0 m */

  /* Smooth is a promise the browser can only keep over a reasonable distance.
     A generated route is two or three screens tall and native smooth scrolling
     is exactly right for it. The homepage's track is twenty-two screens — over
     40 000 px on a laptop — and `behavior: 'smooth'` across that is a slow
     unskippable animation that also has to drag a WebGL scene, an altitude
     clock and eleven pinned panels through every intermediate state on the way.
     Past six screens the honest answer is to arrive.

     No history entry either way: `scrollTo` does not create one, which is why
     this is a button and not an `<a href="#top">`. */
  const TOP_SMOOTH_LIMIT = 6;

  document.querySelector('[data-to-top]')?.addEventListener('click', () => {
    const far = scrollY > innerHeight * TOP_SMOOTH_LIMIT;
    scrollTo({ top: 0, behavior: RM || far ? 'auto' : 'smooth' });
    // Send focus to the top of the document as well, or a keyboard user is
    // returned visually and left where they were logically.
    document.querySelector('.skip, .brand')?.focus({ preventScroll: true });
  });

  /* ------------------------------------------------------------- the hook */

  window.Stratos = window.Stratos || {};
  window.Stratos.header = {
    /**
     * Drive the header from a canonical external progress source.
     *
     * Called from the driver's own frame — never from a loop of this file's —
     * so the homepage pays for one header update per frame it was already
     * having. See the note at the top of this file.
     *
     * @param {number} p     progress through the journey, 0..1
     * @param {object} [meta]
     * @param {number} [meta.alt]   real altitude in metres, if the caller has one
     * @param {string} [meta.key]   label for the readout, e.g. the stage name
     * @param {Array}  [meta.edges] [[toJourney, backToOpening],
     *                               [toDestination, backToJourney]]
     */
    push(p, meta) {
      external = true;
      if (meta && meta.edges) EDGES = meta.edges;
      const v = Math.min(1, Math.max(0, p));
      if (Math.abs(v - last) <= 0.0004) return;
      last = v;
      paint(v, meta ? meta.alt : null, meta ? meta.key : null);
    },
    /** Hand the header back to document scroll. Called when the journey's
     *  clock stops — an unmount, or a fall back to the reduced-motion path. */
    release() { external = false; last = -1; schedule(); },
    get state() { return state; },
  };
})();

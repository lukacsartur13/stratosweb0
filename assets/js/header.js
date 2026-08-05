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
   does not guess: `Stratos.header.drive(fn)` lets the homepage supply the real
   number, and until something does, document position is used. One header, one
   state machine, two sources.
   ========================================================================== */
(() => {
  'use strict';

  const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const nav = document.querySelector('.nav');
  if (!nav) return;

  /* -------------------------------------------------------------- states */

  const altV = nav.querySelector('.nav__alt-v');
  const CEIL = Number(document.body.dataset.ceiling || 30000);
  const FLOOR = 420;

  // Hysteresis: a boundary you have crossed sits further away than the one you
  // have not, so a header cannot chatter between two states while you hover on
  // the line between them.
  const EDGES = [[0.06, 0.045], [0.88, 0.855]];
  let state = 'opening';

  function resolve(p) {
    const i = state === 'opening' ? 0 : state === 'journey' ? 1 : 2;
    if (i < 2 && p > EDGES[i][0]) return i === 0 ? 'journey' : 'destination';
    if (i > 0 && p < EDGES[i - 1][1]) return i === 1 ? 'opening' : 'journey';
    return state;
  }

  let shownAlt = -1;
  function paint(p) {
    const next = resolve(p);
    if (next !== state) { state = next; nav.dataset.state = state; }
    nav.classList.toggle('is-solid', p > 0.012);

    if (altV) {
      const m = Math.round(FLOOR + p * (CEIL - FLOOR));
      if (m !== shownAlt) {
        shownAlt = m;
        // Zero-padded to five so the readout never changes width and the
        // header never reflows around a number ticking over.
        altV.textContent = String(m).padStart(5, '0').replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
      }
    }
  }

  /* ------------------------------------------------------------- the loop */

  let external = null;      // set by the homepage
  let frame = 0;
  let last = -1;

  function progress() {
    if (external) return Math.min(1, Math.max(0, external()));
    const h = document.documentElement.scrollHeight - innerHeight;
    return h > 0 ? Math.min(1, Math.max(0, scrollY / h)) : 0;
  }

  function tick() {
    frame = 0;
    const p = progress();
    // Sub-pixel scroll noise must not cost a repaint.
    if (Math.abs(p - last) > 0.0004) { last = p; paint(p); }
    if (external) frame = requestAnimationFrame(tick);
  }

  function schedule() { if (!frame) frame = requestAnimationFrame(tick); }

  addEventListener('scroll', schedule, { passive: true });
  addEventListener('resize', schedule, { passive: true });
  paint(progress());

  /* ------------------------------------------------------- the menu layer */

  const burger = document.querySelector('.burger');
  const menu = document.getElementById('menu');

  if (burger && menu) {
    const FOCUSABLE = 'a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])';
    let restoreTo = null;
    let scrollLock = 0;

    /* The trigger is part of the trap, not outside it. It lives in the header
       rather than in the layer, but while the layer is open it IS the close
       control — leaving it out would trap a keyboard user in a navigation whose
       only exit is a key nobody told them about. It goes first because that is
       its position in the document. */
    const focusables = () => [burger, ...menu.querySelectorAll(FOCUSABLE)]
      .filter(el => el.offsetParent !== null || el === document.activeElement);

    function open() {
      restoreTo = document.activeElement;
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
      // Focus opens on the first destination, not on the trigger the user just
      // pressed — landing back on the control you activated says nothing about
      // what opened.
      (focusables()[1] || focusables()[0] || menu).focus({ preventScroll: true });
    }

    function close() {
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
      const done = () => { menu.hidden = true; };
      if (RM) done();
      else setTimeout(done, 420);
      // Focus goes back where it came from. Losing it to <body> is the bug
      // that makes a keyboard user restart from the top of the document.
      (restoreTo && document.contains(restoreTo) ? restoreTo : burger)
        .focus({ preventScroll: true });
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

  document.querySelector('[data-to-top]')?.addEventListener('click', () => {
    scrollTo({ top: 0, behavior: RM ? 'auto' : 'smooth' });
    // Send focus to the top of the document as well, or a keyboard user is
    // returned visually and left where they were logically.
    document.querySelector('.skip, .brand')?.focus({ preventScroll: true });
  });

  /* ------------------------------------------------------------- the hook */

  window.Stratos = window.Stratos || {};
  window.Stratos.header = {
    /** Hand the header a canonical progress source. The homepage's journey
     *  scroll is not document scroll, so it calls this with its own. */
    drive(fn) { external = fn; schedule(); },
    get state() { return state; },
  };
})();

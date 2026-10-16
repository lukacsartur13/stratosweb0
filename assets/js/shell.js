/* ==========================================================================
   STRATOS — the shell's behaviour. Four small things, no dependencies, no
   animation loop, nothing the page needs in order to be read.

     1. The header: a hairline once the page has moved, and the sheet that
        holds the navigation under 961px.
     2. Light: `[data-light]` elements are dimmed only while they are still
        below the fold, and lit when they reach the middle of the screen.
     3. Arrival: `[data-reveal]` elements fade up once, the first time they
        are seen. Same contract — only what is not yet visible is ever hidden.
     4. Fit words: a heading whose longest word would break is narrowed until
        it does not.
     5. One active surface: `[data-modes]` switches which of a set of panels is
        shown, from a list of buttons.

   The static page is the design. Without this file — blocked, failed, or a
   reader who asked for reduced motion — every element is in its final, lit,
   visible state, the header links are all reachable through the sheet's
   `hidden` fallback below, and the first panel of every switcher is showing.
   ========================================================================== */
(function () {
  'use strict';

  var doc = document;
  var root = doc.documentElement;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ------------------------------------------------------------- header */
  var hdr = doc.querySelector('[data-hdr]');
  if (hdr) {
    var button = hdr.querySelector('.hdr__menu');
    var sheet = doc.getElementById('hdr-sheet');
    var nav = sheet && sheet.querySelector('nav');
    var text = button && button.querySelector('.hdr__menu-t');
    var label = text ? text.textContent : '';
    if (nav) nav.setAttribute('tabindex', '-1');
    var outside = [doc.getElementById('main'), doc.querySelector('.ftr'), doc.querySelector('.skip')];
    var ticking = false;

    var paint = function () {
      ticking = false;
      hdr.classList.toggle('is-scrolled', window.scrollY > 8);
    };
    window.addEventListener('scroll', function () {
      if (!ticking) { ticking = true; window.requestAnimationFrame(paint); }
    }, { passive: true });
    paint();

    var setInert = function (on) {
      for (var i = 0; i < outside.length; i++) {
        if (!outside[i]) continue;
        if (on) outside[i].setAttribute('inert', '');
        else outside[i].removeAttribute('inert');
      }
    };

    var isOpen = function () { return hdr.classList.contains('is-open'); };

    var open = function () {
      if (!sheet || isOpen()) return;
      sheet.hidden = false;
      hdr.classList.add('is-open');
      root.classList.add('is-locked');
      button.setAttribute('aria-expanded', 'true');
      button.setAttribute('aria-label', button.getAttribute('data-label-close'));
      if (text) text.textContent = button.getAttribute('data-label-close');
      setInert(true);
      // Focus goes to the navigation itself, not its first link: a screen
      // reader lands inside the menu, and a tap does not paint a focus ring on
      // a link nobody chose.
      if (nav) nav.focus({ preventScroll: true });
    };

    var close = function (returnFocus) {
      if (!sheet || !isOpen()) return;
      hdr.classList.remove('is-open');
      root.classList.remove('is-locked');
      sheet.hidden = true;
      button.setAttribute('aria-expanded', 'false');
      button.setAttribute('aria-label', button.getAttribute('data-label-open'));
      if (text) text.textContent = label;
      setInert(false);
      if (returnFocus) button.focus({ preventScroll: true });
    };

    if (button && sheet) {
      button.addEventListener('click', function () { isOpen() ? close(true) : open(); });
      sheet.addEventListener('click', function (e) { if (e.target.closest('a')) close(false); });
      doc.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && isOpen()) close(true);
      });
      doc.addEventListener('pointerdown', function (e) {
        // The veil behind the sheet belongs to the header element, so "outside"
        // means outside the box, not outside the header.
        if (isOpen() && !e.target.closest('.hdr__box')) close(false);
      });
      // The sheet only exists under 961px; growing past it closes it rather
      // than leaving a locked page behind an invisible menu.
      var wide = window.matchMedia('(min-width: 961px)');
      var onWide = function () { if (wide.matches) close(false); };
      if (wide.addEventListener) wide.addEventListener('change', onWide);
      // Coming back through the history cache must not restore an open sheet.
      window.addEventListener('pagehide', function () { close(false); });
    }
  }

  /* ------------------------------------------------------ light, arrival */
  if (!reduce && 'IntersectionObserver' in window) {
    var fold = window.innerHeight * 0.9;
    var below = function (el) { return el.getBoundingClientRect().top > fold; };

    var lights = doc.querySelectorAll('[data-light]');
    var lightIO = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        if (!entries[i].isIntersecting) continue;
        entries[i].target.classList.remove('is-dim');
        lightIO.unobserve(entries[i].target);
      }
    // Lit once its top has passed the lower ~third of the screen — when it is
    // the thing being read, not when its first pixel scrolls in. Only the
    // bottom edge is inset, so a jump that lands an element anywhere above
    // that line (an anchor, a fast fling) still lights it.
    }, { rootMargin: '0px 0px -38% 0px' });
    for (var l = 0; l < lights.length; l++) {
      if (!below(lights[l])) continue;
      lights[l].classList.add('is-dim');
      lightIO.observe(lights[l]);
    }

    var reveals = doc.querySelectorAll('[data-reveal]');
    var revealIO = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        if (!entries[i].isIntersecting) continue;
        entries[i].target.classList.remove('is-pre');
        revealIO.unobserve(entries[i].target);
      }
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.08 });
    for (var r = 0; r < reveals.length; r++) {
      if (!below(reveals[r])) continue;
      reveals[r].classList.add('is-pre');
      revealIO.observe(reveals[r]);
    }
  }

  /* ------------------------------------------------------------ fit words */
  /* Hungarian headings break between words only — browsers have no dependable
     Hungarian hyphenation — so a heading whose longest word is wider than its
     own box would be cut mid-word by the overflow-wrap safety net
     ("Keresőoptimalizál / ás"). Such a heading is narrowed on Archivo's width
     axis first, then scaled, until the word fits on one line. A heading whose
     words already fit is never touched. (Ported from the old main.js, where it
     was the one layout job worth keeping.) */
  var FIT = 'h1, h2, h3, .display';
  var splitWord = function (el) {
    var walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    var range = doc.createRange();
    var node;
    while ((node = walker.nextNode())) {
      var re = /[^\s-]{6,}/g;
      var m;
      while ((m = re.exec(node.data))) {
        range.setStart(node, m.index);
        range.setEnd(node, m.index + m[0].length);
        var rects = range.getClientRects();
        if (rects.length > 1 && Math.abs(rects[0].top - rects[rects.length - 1].top) > 2) return true;
      }
    }
    return false;
  };
  var fitWords = function () {
    var list = doc.querySelectorAll(FIT);
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (el.closest('.vh') || el.clientWidth < 60) continue;
      el.style.fontSize = '';
      el.style.fontStretch = '';
      if ('fitMw' in el.dataset) { el.style.maxWidth = el.dataset.fitMw; delete el.dataset.fitMw; }
      if (!splitWord(el)) continue;
      // A measure in `ch` shrinks with the type, so the box is frozen at its
      // current width before the face is scaled inside it.
      el.dataset.fitMw = el.style.maxWidth;
      el.style.maxWidth = el.getBoundingClientRect().width + 'px';
      var cs = getComputedStyle(el);
      var stretch = parseFloat(cs.fontStretch) || 100;
      var size = parseFloat(cs.fontSize);
      for (var n = 0; n < 24 && splitWord(el); n++) {
        if (stretch > 78) { stretch -= 4; el.style.fontStretch = stretch + '%'; }
        else { size *= 0.95; el.style.fontSize = size.toFixed(1) + 'px'; }
      }
    }
  };
  var fitTimer = 0;
  var refit = function () { window.clearTimeout(fitTimer); fitTimer = window.setTimeout(fitWords, 140); };
  if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(fitWords); else fitWords();
  window.addEventListener('resize', refit, { passive: true });

  /* ------------------------------------------------- one active surface */
  var groups = doc.querySelectorAll('[data-modes]');
  for (var g = 0; g < groups.length; g++) (function (group) {
    var buttons = group.querySelectorAll('[data-mode]');
    var panels = group.querySelectorAll('[data-mode-panel]');
    var hoverTimer = 0;

    var show = function (index) {
      for (var i = 0; i < buttons.length; i++) {
        var on = buttons[i].getAttribute('data-mode') === index;
        buttons[i].classList.toggle('is-active', on);
        buttons[i].setAttribute('aria-pressed', on ? 'true' : 'false');
      }
      for (var j = 0; j < panels.length; j++) {
        var visible = panels[j].getAttribute('data-mode-panel') === index;
        panels[j].classList.toggle('is-active', visible);
        // A panel that is not showing is not there for assistive technology
        // either; the one that is carries the description of what is shown.
        if (visible) panels[j].removeAttribute('aria-hidden');
        else panels[j].setAttribute('aria-hidden', 'true');
      }
    };

    for (var b = 0; b < buttons.length; b++) (function (btn) {
      btn.addEventListener('click', function () { show(btn.getAttribute('data-mode')); });
      btn.addEventListener('focus', function () { show(btn.getAttribute('data-mode')); });
      // A fine pointer may preview by resting on a mode. The short delay is
      // intent, so sweeping across the list does not strobe the screen.
      btn.addEventListener('pointerenter', function (e) {
        if (e.pointerType !== 'mouse') return;
        window.clearTimeout(hoverTimer);
        hoverTimer = window.setTimeout(function () { show(btn.getAttribute('data-mode')); }, 140);
      });
      btn.addEventListener('pointerleave', function () { window.clearTimeout(hoverTimer); });
    })(buttons[b]);

    show((group.querySelector('[data-mode].is-active') || buttons[0]).getAttribute('data-mode'));
  })(groups[g]);
})();

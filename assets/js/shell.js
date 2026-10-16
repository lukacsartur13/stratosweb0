/* ==========================================================================
   STRATOS — the shell's behaviour. Six small things, no dependencies, no
   standing animation loop, nothing the page needs in order to be read.

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
     6. The plane: for a mouse, the logo's paper plane follows the pointer
        and turns to fly the way it moves.

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
     axis first where it has one, then scaled, until the word fits on one line. A heading whose
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
      // Only Archivo has a width axis; Aboreto headlines go straight to scale.
      var axis = /archivo/i.test(cs.fontFamily.split(',')[0]);
      var size = parseFloat(cs.fontSize);
      for (var n = 0; n < 24 && splitWord(el); n++) {
        if (axis && stretch > 78) { stretch -= 4; el.style.fontStretch = stretch + '%'; }
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

  /* ------------------------------------------------------------ the plane */
  /* The cursor is the logo's paper plane, and it turns to fly the way the
     pointer moves (owner, 2026-10-16). system.css already draws it as a
     native cursor — what a touch screen, a reader who asked for reduced
     motion, or a page whose script never ran gets, and that is complete. For
     a mouse, the native cursor is hidden and one small element takes over:

       position   written in the event itself, so the nose is on the pointer;
       heading    eased toward the direction of travel and never upside down:
                  reversing rolls the plane over (its height through zero);
       clickable  the plane lifts, 1.16×, where the hand used to appear;
       fields     it steps aside for the text caret.

     The frame loop runs only while the turn is still settling, then stops.
     Nothing is enabled until the image has loaded, so a failed request leaves
     the native plane in charge rather than no cursor at all. */
  var fine = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  if (!reduce && fine && window.requestAnimationFrame) (function () {
    var NX = 30, NY = 2, ART = -35;   // the nose in the 32px image; the art flies 35° up-right
    var HOT = 'a[href], button, summary, label[for], select, [role="button"], input[type="checkbox"], input[type="radio"], input[type="submit"], input[type="button"]';
    var FIELD = 'input:not([type="checkbox"]):not([type="radio"]):not([type="submit"]):not([type="button"]):not([type="range"]), textarea, [contenteditable="true"]';
    var el = doc.createElement('div');
    el.className = 'cursor-plane';
    el.setAttribute('aria-hidden', 'true');
    var img = new Image(32, 32);
    img.alt = '';

    var x = 0, y = 0, vx = 0, vy = 0;
    var heading = ART, angle = ART;   // degrees, screen space (y down)
    var flip = 1, flipTo = 1, lift = 1, liftTo = 1;
    var frame = 0, live = false, ready = false, hot = false, pressed = false;
    var size = function () { liftTo = (hot ? 1.16 : 1) * (pressed ? 0.86 : 1); };

    var apply = function () {
      // Mirrored, the art's axis points 35° down instead of up, so the offset
      // that aligns it with the heading changes sign with the flip.
      el.style.transform = 'translate3d(' + (x - NX) + 'px,' + (y - NY) + 'px,0) rotate(' +
        (angle - ART * flip).toFixed(2) + 'deg) scale(' + lift.toFixed(3) + ',' + (lift * flip).toFixed(3) + ')';
    };
    var step = function () {
      frame = 0;
      var d = ((heading - angle + 540) % 360) - 180;
      angle += d * 0.24;
      flip += (flipTo - flip) * 0.2;
      lift += (liftTo - lift) * 0.3;
      apply();
      if (Math.abs(d) > 0.3 || Math.abs(flipTo - flip) > 0.01 || Math.abs(liftTo - lift) > 0.005) frame = window.requestAnimationFrame(step);
    };
    var kick = function () { if (!frame) frame = window.requestAnimationFrame(step); };
    var show = function () { if (ready && live) root.classList.add('has-plane'); };
    var hide = function () { live = false; root.classList.remove('has-plane'); };

    window.addEventListener('pointermove', function (e) {
      if (e.pointerType && e.pointerType !== 'mouse') { hide(); return; }
      var dx = e.clientX - x, dy = e.clientY - y;
      x = e.clientX; y = e.clientY;
      if (!live) { live = true; vx = vy = 0; show(); }
      else {
        vx = vx * 0.55 + dx * 0.45;
        vy = vy * 0.55 + dy * 0.45;
        if (vx * vx + vy * vy > 2.2) {
          heading = Math.atan2(vy, vx) * 180 / Math.PI;
          var c = Math.cos(heading * Math.PI / 180);
          if (c > 0.26) flipTo = 1; else if (c < -0.26) flipTo = -1;
        }
      }
      var t = e.target && e.target.closest ? e.target : null;
      el.classList.toggle('is-off', !!(t && t.closest(FIELD)));
      hot = !!(t && t.closest(HOT));
      size();
      apply();
      kick();
    }, { passive: true });
    window.addEventListener('pointerdown', function () { pressed = true; size(); kick(); }, { passive: true });
    window.addEventListener('pointerup', function () { pressed = false; size(); kick(); }, { passive: true });
    // Out of the window, into an iframe, or the window loses focus: the
    // native cursor comes back until the pointer moves here again.
    doc.addEventListener('mouseout', function (e) { if (!e.relatedTarget) hide(); });
    window.addEventListener('blur', hide);

    img.onload = function () { ready = true; el.appendChild(img); doc.body.appendChild(el); show(); };
    img.src = '/assets/img/cursor-plane@2x.png';
  })();
})();

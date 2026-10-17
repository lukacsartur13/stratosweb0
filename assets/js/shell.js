/* ==========================================================================
   STRATOS — the shell's behaviour. Seven small things, no dependencies, no
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
        and turns to fly the way it moves; on the homepage it leaves a strip
        through the clouds.
     7. The smooth wheel: a mouse wheel glides instead of stepping.

   The static page is the design. Without this file — blocked, failed, or a
   reader who asked for reduced motion — every element is in its final, lit,
   visible state, the header links are all reachable through the sheet's
   `hidden` fallback below, and every switcher shows its resting panel.
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
  /* A list of mode buttons and the panels they show. A group may have a
     resting panel (`data-mode-panel="rest"`): what it shows when nothing is
     chosen, and what it returns to. Resting the mouse on a mode previews it,
     anywhere inside the group the preview holds — so the eye can move from
     the list to the screen — and leaving the group goes back to what is
     chosen. A click or tap chooses (again: back to rest); focus previews, as
     hover does, for the keyboard. `aria-pressed` is the choice, the lit dot
     is what is showing. */
  var groups = doc.querySelectorAll('[data-modes]');
  for (var g = 0; g < groups.length; g++) (function (group) {
    var buttons = group.querySelectorAll('[data-mode]');
    var panels = group.querySelectorAll('[data-mode-panel]');
    var rest = group.querySelector('[data-mode-panel="rest"]') ? 'rest' : null;
    var hoverTimer = 0, backTimer = 0;
    var active = group.querySelector('[data-mode].is-active');
    var chosen = active ? active.getAttribute('data-mode') : (rest || buttons[0].getAttribute('data-mode'));

    var show = function (index) {
      for (var i = 0; i < buttons.length; i++) {
        var mode = buttons[i].getAttribute('data-mode');
        buttons[i].classList.toggle('is-active', mode === index);
        buttons[i].setAttribute('aria-pressed', mode === chosen ? 'true' : 'false');
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
    var back = function (delay) {
      window.clearTimeout(backTimer);
      backTimer = window.setTimeout(function () { show(chosen); }, delay);
    };

    for (var b = 0; b < buttons.length; b++) (function (btn) {
      var mode = btn.getAttribute('data-mode');
      btn.addEventListener('click', function () {
        window.clearTimeout(hoverTimer);
        chosen = rest && chosen === mode ? rest : mode;
        show(chosen);
      });
      btn.addEventListener('focus', function () { window.clearTimeout(backTimer); show(mode); });
      btn.addEventListener('blur', function () { back(160); });
      // The short delay is intent, so sweeping across the list does not
      // strobe the screen.
      btn.addEventListener('pointerenter', function (e) {
        if (e.pointerType !== 'mouse') return;
        window.clearTimeout(hoverTimer);
        window.clearTimeout(backTimer);
        hoverTimer = window.setTimeout(function () { show(mode); }, 140);
      });
      btn.addEventListener('pointerleave', function () { window.clearTimeout(hoverTimer); });
    })(buttons[b]);

    group.addEventListener('pointerenter', function () { window.clearTimeout(backTimer); });
    group.addEventListener('pointerleave', function (e) {
      if (e.pointerType !== 'mouse') return;
      window.clearTimeout(hoverTimer);
      back(220);
    });

    show(chosen);
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
    var frame = 0, live = false, ready = false, hot = false, pressed = false, trail = null;
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
        if (trail) trail.push(x, y);
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
    // Leaving the page, and coming back to it from the back/forward cache: a
    // frozen page can lose a frame it had asked for, and a loop that believes
    // a frame is pending never asks again. So both loops are cancelled on the
    // way out, and the page comes back with the native plane until the mouse
    // moves.
    var settle = function () {
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0;
      hide();
      if (trail) trail.reset();
    };
    window.addEventListener('pagehide', settle);
    window.addEventListener('pageshow', function (e) { if (e.persisted) settle(); });

    img.onload = function () { ready = true; el.appendChild(img); doc.body.appendChild(el); show(); };
    img.src = '/assets/img/cursor-plane@2x.png';

    /* The trail. Where the page names a `--cloud-trail` (the homepage), the
       plane flies through the clouds (owner, 2026-10-17): a thick strip
       behind it, in which the deck shows at full strength — sky-blue
       crevices — narrowing to nothing over a second and a half like a
       comet's tail. One canvas over the page, multiplied onto it (home.css),
       cut away from photographs and dark panels; the strip lives in page
       coordinates, so it stays on the clouds it crossed while the page
       scrolls; nothing runs once it has gone.

       The strip is one opaque shape (segments drawn at full alpha cannot
       stack into beads or steps where they overlap), drawn at a fifth of the
       resolution and scaled up, which is what softens its edge — a blur for
       nothing. The canvas is at 1×, as the cloud tile itself is; the strong
       deck is filled only inside the strip's bounds. */
    var trailVar = getComputedStyle(doc.body).getPropertyValue('--cloud-trail');
    var trailSrc = /url\(\s*["']?([^"')]+?)["']?\s*\)/.exec(trailVar);
    // Safari (26.6) hands a custom property's url() back CSS-escaped —
    // `\/assets\/img\/home-clouds-trail\.webp` — and an image asked for at
    // that address fails, so the strip never had a texture there. Undo the
    // escapes: hex ones (`\2f `) and single characters (`\/`) alike.
    if (trailSrc) trailSrc[1] = trailSrc[1].replace(/\\([0-9a-fA-F]{1,6})\s?|\\(.)/g, function (m, hex, ch) {
      return hex ? String.fromCodePoint(parseInt(hex, 16)) : ch;
    });
    if (trailSrc) (function () {
      var LIFE = 1500, HEAD = 78, LO = 5;
      var cv = doc.createElement('canvas'), off = doc.createElement('canvas');
      var ctx = cv.getContext('2d'), octx = off.getContext('2d');
      if (!ctx || !octx) return;
      cv.className = 'cloud-trail';
      cv.setAttribute('aria-hidden', 'true');
      var tex = new Image();
      var pattern = null, pts = [], raf = 0, masks = [];
      var fit = function () {
        cv.width = window.innerWidth; cv.height = window.innerHeight;
        off.width = Math.ceil(cv.width / LO); off.height = Math.ceil(cv.height / LO);
      };
      // A frame that throws stops the strip, never the page.
      var draw = function () {
        try { paint(); } catch (err) { raf = 0; }
      };
      var paint = function () {
        raf = 0;
        var now = window.performance.now();
        while (pts.length && now - pts[0].t > LIFE) pts.shift();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, cv.width, cv.height);
        if (pts.length < 2) return;
        var sx = window.scrollX, sy = window.scrollY;
        // 1. The shape, opaque, on the small offscreen canvas.
        octx.setTransform(1, 0, 0, 1, 0, 0);
        octx.clearRect(0, 0, off.width, off.height);
        octx.setTransform(1 / LO, 0, 0, 1 / LO, 0, 0);
        octx.lineCap = octx.lineJoin = 'round';
        octx.strokeStyle = '#000';
        // The bounds take in every point, the first included: a fast or
        // jumpy mouse leaves long segments, and a box that missed the first
        // would cut the strip off square.
        var x0 = pts[0].x, y0 = pts[0].y, x1 = pts[0].x, y1 = pts[0].y;
        for (var q = 1; q < pts.length; q++) {
          var life = 1 - (now - pts[q].t) / LIFE;
          octx.lineWidth = Math.max(1, HEAD * Math.pow(life, 0.7));
          octx.beginPath();
          octx.moveTo(pts[q - 1].x - sx, pts[q - 1].y - sy);
          octx.lineTo(pts[q].x - sx, pts[q].y - sy);
          octx.stroke();
          if (pts[q].x < x0) x0 = pts[q].x; if (pts[q].x > x1) x1 = pts[q].x;
          if (pts[q].y < y0) y0 = pts[q].y; if (pts[q].y > y1) y1 = pts[q].y;
        }
        // 2. Scaled up onto the visible canvas: the smoothing is the soft edge.
        var bx = Math.max(0, x0 - sx - HEAD), by = Math.max(0, y0 - sy - HEAD);
        var bw = Math.min(cv.width, x1 - sx + HEAD) - bx, bh = Math.min(cv.height, y1 - sy + HEAD) - by;
        if (bw <= 0 || bh <= 0) { raf = window.requestAnimationFrame(draw); return; }
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(off, bx / LO, by / LO, bw / LO, bh / LO, bx, by, bw, bh);
        // 3. The strong deck, filled into it, aligned with the page's own
        //    background: the tile's origin is the page's, so it moves with
        //    scroll exactly as the background does.
        ctx.globalCompositeOperation = 'source-in';
        // The tile is placed by moving the canvas, not the pattern: a
        // pattern's own transform is the less dependable path.
        var k = parseFloat(getComputedStyle(doc.body).backgroundSize) / tex.naturalWidth || 1;
        ctx.setTransform(k, 0, 0, k, -sx, -sy);
        ctx.fillStyle = pattern;
        ctx.fillRect((bx + sx) / k, (by + sy) / k, bw / k, bh / k);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        // 4. Never over a photograph, a project screen or a dark panel.
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = '#000';
        for (var m = 0; m < masks.length; m++) {
          var r = masks[m].getBoundingClientRect();
          if (r.right < bx || r.left > bx + bw || r.bottom < by || r.top > by + bh || !r.width) continue;
          var rad = parseFloat(getComputedStyle(masks[m]).borderTopLeftRadius) || 0;
          ctx.beginPath();
          if (ctx.roundRect) ctx.roundRect(r.left, r.top, r.width, r.height, rad); else ctx.rect(r.left, r.top, r.width, r.height);
          ctx.fill();
        }
        ctx.globalCompositeOperation = 'source-over';
        raf = window.requestAnimationFrame(draw);
      };
      // Nothing — not the canvas, not its 90 kB of texture — until the mouse
      // first moves: a reader who never uses one gets the page and no more.
      var started = false;
      trail = {
        reset: function () {
          if (raf) window.cancelAnimationFrame(raf);
          raf = 0;
          pts = [];
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.clearRect(0, 0, cv.width, cv.height);
        },
        push: function (px, py) {
          if (!started) { started = true; tex.src = trailSrc[1]; }
          if (!pattern) return;
          pts.push({ x: px + window.scrollX, y: py + window.scrollY, t: window.performance.now() });
          if (!raf) raf = window.requestAnimationFrame(draw);
        }
      };
      tex.onload = function () {
        var ready = function () {
          // Not the plane's own picture (the strip would be cut away right
          // under it) and not the header's (the header is above the strip).
          masks = [].filter.call(
            doc.querySelectorAll('img, picture, video, .take__surface, .gdf__surface, .close__surface, .pclose__surface, .btn'),
            function (el) { return !el.closest('.cursor-plane, .hdr'); });
          pattern = ctx.createPattern(tex, 'repeat');
          fit();
          doc.body.appendChild(cv);
          window.addEventListener('resize', fit, { passive: true });
          // Use the texture once, invisibly, while nothing is happening, so
          // its decode and upload are not paid by the first flight.
          ctx.fillStyle = pattern;
          ctx.fillRect(0, 0, 1, 1);
          ctx.clearRect(0, 0, 1, 1);
        };
        // A plain timer: `decode()` and the idle callback both waited on
        // things Safari need not deliver, and the strip never started there.
        window.setTimeout(function () {
          try { ready(); } catch (err) { /* no strip, and nothing else broken */ }
        }, 60);
      };
    })();
  })();

  /* ----------------------------------------------------- the smooth wheel */
  /* A wheel glides (owner, 2026-10-17, after immersive-g.com, which runs
     Lenis at a lerp of about 0.05): each notch moves where the page is going,
     not the page, and the page eases there — so an uneven finger on the
     wheel draws one smooth curve instead of a stutter. The page still
     scrolls natively: the scrollbar, the keyboard, find-in-page, anchors and
     assistive technology move it as they always did, and the glide adopts
     wherever they leave it. A wheel over anything that scrolls on its own
     (the open menu, a field) is left alone, and so are zoom (ctrl + wheel)
     and sideways scrolling. Mouse and trackpad only — touch scrolls
     natively — and nothing at all for a reader who asked for less motion. */
  if (!reduce && fine && window.requestAnimationFrame) (function () {
    var EASE = 3;   // per second; Lenis's lerp 0.05 at 60 fps
    var target = 0, current = 0, last = 0, frame = 0, then = 0;
    var bottom = function () { return Math.max(0, root.scrollHeight - window.innerHeight); };
    var ownScroll = function (el, dy) {
      for (; el && el !== doc.body && el !== root; el = el.parentElement) {
        if (el.matches && el.matches('textarea, select, [contenteditable="true"]')) return true;
        var oy = getComputedStyle(el).overflowY;
        if ((oy === 'auto' || oy === 'scroll' || oy === 'overlay') && el.scrollHeight > el.clientHeight + 1) {
          if (dy < 0 ? el.scrollTop > 0 : el.scrollTop + el.clientHeight < el.scrollHeight - 1) return true;
        }
      }
      return false;
    };
    var stop = function () {
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0; then = 0;
    };
    var step = function (t) {
      var dt = then ? Math.min(0.1, (t - then) / 1000) : 1 / 60;
      then = t;
      current += (target - current) * (1 - Math.exp(-EASE * dt));
      if (Math.abs(target - current) < 0.5) current = target;
      window.scrollTo(0, current);
      last = window.scrollY;
      if (current === target) { frame = 0; then = 0; } else frame = window.requestAnimationFrame(step);
    };
    window.addEventListener('wheel', function (e) {
      if (e.ctrlKey || e.defaultPrevented || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      if (doc.querySelector('.hdr.is-open')) return;
      var dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1);
      if (!dy || ownScroll(e.target, dy)) return;
      e.preventDefault();
      if (!frame) current = target = last = window.scrollY;   // start from where the page is
      target = Math.max(0, Math.min(bottom(), target + dy));
      if (!frame) frame = window.requestAnimationFrame(step);
    }, { passive: false });
    // Anything else that moves the page wins: the glide stops where it is.
    window.addEventListener('scroll', function () {
      if (frame && Math.abs(window.scrollY - last) > 2) { stop(); current = target = window.scrollY; }
    }, { passive: true });
    window.addEventListener('pagehide', stop);
  })();
})();

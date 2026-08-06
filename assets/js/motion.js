/* ==========================================================================
   STRATOS — Meridian Trace motion primitives.

   The homepage is a WebGL ascent. These 66 subpages are not, and must not
   become one: the homepage ships ~1.4 MB of JavaScript, a subpage ships ~74 KB,
   and that ratio is the budget. So there is no framework here and no GSAP —
   GSAP is a dependency of experiments/ and lives inside the homepage bundle
   only. Everything below is CSS transforms, SVG geometry, the Web Animations
   API and one IntersectionObserver, which is what the brief's performance
   section asks for.

   THE ONE IDEA
   ------------
   Every primitive is a pure function of one number: how far a given element has
   travelled through its own scroll range, 0 to 1. Nothing accumulates, nothing
   integrates velocity, nothing remembers which way you were going. That is what
   makes the whole system deterministic and exactly reversible — scroll back up
   and you get the same frames in the same order, which is the difference
   between a motion system and a pile of transitions.

   THE DRIVER
   ----------
   One rAF loop, shared. It runs only while at least one registered element is
   intersecting, and stops dead otherwise, so a page whose motion is all below
   the fold costs nothing until you reach it. Each registration is torn down on
   pagehide so the Phase 7 cross-document transitions never inherit a live loop
   or a stale observer.

   REDUCED MOTION
   --------------
   Not a lesser layout. Under `prefers-reduced-motion: reduce` every primitive
   is committed to its resolved end state once, at register time, and the driver
   never starts. Traces are drawn, stages show their last frame's text with all
   stages stacked, rails become vertical, masks are open. The content is all
   there and none of it moves.
   ========================================================================== */
(() => {
  'use strict';

  const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));

  /* ------------------------------------------------------------- driver */

  const tracked = new Map();   // element -> { update, range }
  let live = 0;                // how many are on screen right now
  let frame = 0;

  const io = 'IntersectionObserver' in window
    ? new IntersectionObserver((entries) => {
        for (const e of entries) {
          const rec = tracked.get(e.target);
          if (!rec) continue;
          if (e.isIntersecting) {
            if (!rec.live) { rec.live = true; live++; }
          } else {
            if (rec.live) { rec.live = false; live--; }
            // Commit the boundary state on the way out, so an element that
            // leaves fast cannot freeze mid-way.
            rec.update(e.boundingClientRect.top < 0 ? 1 : 0);
          }
        }
        if (live > 0) start(); else stop();
      }, { rootMargin: '20% 0px 20% 0px' })
    : null;

  function start() { if (!frame) frame = requestAnimationFrame(tick); }
  function stop() { if (frame) { cancelAnimationFrame(frame); frame = 0; } }

  function pass(all) {
    const vh = innerHeight;
    for (const [el, rec] of tracked) {
      if (!all && !rec.live) continue;
      const r = el.getBoundingClientRect();
      // `span` is the distance the element travels between "bottom edge just
      // entered" and "top edge just left". For a tall pinned section that is
      // its own height; for a short one it is one viewport.
      const span = Math.max(1, r.height + vh * rec.lead);
      rec.update(clamp((vh * rec.lead - r.top) / span, 0, 1));
    }
  }

  function tick() {
    frame = 0;
    pass(false);
    if (live > 0) frame = requestAnimationFrame(tick);
  }

  /* An IntersectionObserver reports threshold CROSSINGS, not positions. Scroll
     continuously and every element is crossed and therefore seen. Jump — an
     anchor link, a restored scroll position, a back navigation, `scrollTo` —
     and an element can go from "below the viewport, ratio 0" to "above the
     viewport, ratio 0" without the ratio ever changing, so no callback fires
     and that section keeps its start frame forever: an undrawn trace, a closed
     mask, a stage stuck on 1 of 7.

     The fix is one full sweep after a jump settles. `scrollend` is exactly that
     signal, and between two scrollends the observer is sufficient on its own,
     so this costs one rect read per tracked element per jump and nothing at
     all during ordinary scrolling. */
  let sweep = 0;
  function reconcile() {
    clearTimeout(sweep);
    sweep = setTimeout(() => pass(true), 60);
  }
  addEventListener('scrollend', reconcile, { passive: true });
  addEventListener('hashchange', reconcile);
  addEventListener('pageshow', reconcile);
  if (!('onscrollend' in window)) {
    // Safari < 18. Debounced scroll is the same signal, just less precise.
    addEventListener('scroll', reconcile, { passive: true });
  }

  /** Register an element. `update(p)` is called with 0..1 and nothing else.
   *  `lead` scales how much viewport is counted as approach — 1 means the
   *  range opens when the element's top hits the bottom of the screen. */
  function register(el, update, lead = 1) {
    if (RM) { update(1); return; }
    tracked.set(el, { update, live: false, lead });
    io ? io.observe(el) : update(1);
  }

  addEventListener('pagehide', () => {
    stop();
    clearTimeout(sweep);
    io?.disconnect();
    tracked.clear();
  });

  /* --------------------------------------------------- 5.1 TraceLine */
  /* A Meridian Trace is one SVG path that draws itself as you descend past it.
     The path is authored in the markup, not generated here, because the shape
     is the argument the page is making — a branching service system, an
     irrigation network, a reading trajectory — and that belongs to the page,
     not to a library. */

  function traceLine(el) {
    const paths = $$('path, line, polyline', el);
    if (!paths.length) return;

    const lens = paths.map(p => {
      const L = p.getTotalLength ? p.getTotalLength() : 0;
      p.style.strokeDasharray = L;
      p.style.strokeDashoffset = RM ? 0 : L;
      return L;
    });

    // Segments draw in sequence, each over its own slice of the range, so a
    // branching trace reaches its branches in the order the markup lists them.
    const stagger = Number(el.dataset.traceStagger || 0.35);
    register(el, (p) => {
      paths.forEach((path, i) => {
        const slot = i / Math.max(1, paths.length);
        const from = slot * stagger;
        const local = clamp((p - from) / (1 - stagger), 0, 1);
        path.style.strokeDashoffset = lens[i] * (1 - local);
      });
      el.classList.toggle('is-drawn', p > 0.92);
    }, Number(el.dataset.traceLead || 0.85));
  }

  /* -------------------------------------------------- 5.2 StickyStage */
  /* A pinned editorial sequence: one stable text column, one evolving visual,
     N discrete stages. The stage index is floor(progress * N), so it is a step
     function — the text does not crossfade continuously, it changes once, which
     is what makes it readable rather than a blur. */

  function stickyStage(el) {
    const stages = $$('[data-stage-item]', el);
    if (stages.length < 2) return;
    const fill = el.querySelector('[data-stage-fill]');
    let shown = -1;

    const show = (i) => {
      if (i === shown) return;
      shown = i;
      stages.forEach((s, n) => {
        s.classList.toggle('is-on', n === i);
        s.classList.toggle('is-past', n < i);
        // Only the live stage is in the accessibility tree; the others are
        // duplicated copy that a screen reader would otherwise read N times.
        s.setAttribute('aria-hidden', n === i ? 'false' : 'true');
      });
      el.dataset.stageAt = i;
    };

    if (RM) {
      // Static editorial section: every stage visible, in order, none hidden.
      el.classList.add('is-static');
      stages.forEach(s => { s.classList.add('is-on'); s.setAttribute('aria-hidden', 'false'); });
      if (fill) fill.style.transform = 'scaleX(1)';
      return;
    }

    show(0);
    register(el, (p) => {
      show(clamp(Math.floor(p * stages.length), 0, stages.length - 1));
      if (fill) fill.style.transform = `scaleX(${p})`;
      el.style.setProperty('--stage-p', p.toFixed(4));
    }, 0);
  }

  /* ------------------------------------------------ 5.3 HorizontalRail */
  /* Vertical scroll drives horizontal travel inside a pinned viewport. The
     wheel is never touched: the page scrolls exactly as the browser intends and
     the rail reads the result. That is the whole reason there is no scroll trap
     here and why Home/End, space, find-in-page and the scrollbar all still do
     what they always did.

     On portrait mobile the rail is not a rail. The markup is reflowed by CSS
     into a vertical list and this function returns before touching it, because
     a horizontal sequence squeezed into 390 px is not art direction, it is a
     desktop layout having a bad time. */

  function horizontalRail(el) {
    const track = el.querySelector('[data-rail-track]');
    if (!track) return;

    const portrait = () => matchMedia('(max-width: 860px) and (orientation: portrait)').matches;

    if (RM || portrait()) {
      el.classList.add('is-static');
      track.style.transform = '';
      return;
    }

    const panels = $$('[data-rail-panel]', track);
    let travel = 0;

    const measure = () => {
      travel = Math.max(0, track.scrollWidth - el.clientWidth);
      // The pinned section is as tall as the horizontal distance it has to
      // cover, plus one viewport to hold the end state — so the rail's speed
      // is roughly the page's natural scroll speed rather than a guess.
      el.style.setProperty('--rail-travel', travel + 'px');
    };
    measure();

    register(el, (p) => {
      track.style.transform = `translate3d(${-travel * p}px,0,0)`;
      const at = clamp(Math.round(p * (panels.length - 1)), 0, panels.length - 1);
      if (String(at) !== el.dataset.railAt) {
        el.dataset.railAt = at;
        panels.forEach((pl, i) => pl.classList.toggle('is-on', i === at));
      }
    }, 0);

    addEventListener('resize', measure, { passive: true });
  }

  /* -------------------------------------------------- 5.4 DepthGallery */

  function depthGallery(el) {
    const items = $$('[data-depth-item]', el);
    if (!items.length) return;
    if (RM) { el.classList.add('is-static'); return; }

    register(el, (p) => {
      items.forEach((it, i) => {
        // Each item owns a slot; distance from the slot centre drives its
        // recession. Z separation is small on purpose — the brief asks for
        // depth, not a perspective funhouse.
        const slot = (i + 0.5) / items.length;
        const d = clamp(Math.abs(p - slot) * items.length, 0, 1);
        it.style.setProperty('--depth', (1 - d).toFixed(3));
      });
    }, 0.6);
  }

  /* ---------------------------------------------------- 5.5 MaskReveal */

  function maskReveal(el) {
    const axis = el.dataset.mask === 'y' ? 'y' : 'x';
    if (RM) { el.style.setProperty('--mask', '100%'); el.classList.add('is-open'); return; }
    el.style.setProperty('--mask-axis', axis);
    register(el, (p) => {
      // Eased so the reveal decelerates into its open state rather than
      // stopping dead at the edge.
      const e = 1 - Math.pow(1 - p, 3);
      el.style.setProperty('--mask', (e * 100).toFixed(2) + '%');
      el.classList.toggle('is-open', p > 0.98);
    }, 0.75);
  }

  /* ---------------------------------------------------- 5.6 KineticType */
  /* Archivo is a variable font with a width axis as well as a weight axis
     (wdth 62–125, wght 100–900, both verified against the binaries by
     scripts/font-metadata.mjs). Kinetic type moves along those axes and along
     letter-spacing — it never distorts a glyph with a transform, so it stays
     legible at every frame and degrades to a static weight on a fallback font
     that has no axes. Body copy is never registered. */

  function kineticType(el) {
    const from = (el.dataset.kineticFrom || '112 680 0').split(/\s+/).map(Number);
    const to = (el.dataset.kineticTo || '92 760 -0.02').split(/\s+/).map(Number);
    const apply = (t) => {
      const wd = from[0] + (to[0] - from[0]) * t;
      const wt = from[1] + (to[1] - from[1]) * t;
      const tr = from[2] + (to[2] - from[2]) * t;
      el.style.fontVariationSettings = `"wdth" ${wd.toFixed(1)}, "wght" ${wt.toFixed(0)}`;
      el.style.letterSpacing = tr.toFixed(4) + 'em';
    };
    if (RM) { apply(1); return; }
    register(el, (p) => apply(1 - Math.pow(1 - p, 2)), 0.8);
  }

  /* --------------------------------------------------- 5.7 MetricTrace */
  /* Reveals numbers that are already in the markup. It counts up to the value
     the author wrote and never past it, and if the author wrote no value there
     is nothing to reveal — which is the mechanism by which this primitive
     cannot invent a metric. */

  function metricTrace(el) {
    const nums = $$('[data-metric-value]', el);
    const targets = nums.map(n => {
      const raw = n.dataset.metricValue;
      const v = parseFloat(String(raw).replace(/[^\d.,-]/g, '').replace(',', '.'));
      return Number.isFinite(v) ? v : null;
    });
    const write = (n, i, t) => {
      if (targets[i] === null) return;              // non-numeric: leave the text alone
      const dp = (String(nums[i].dataset.metricValue).split(/[.,]/)[1] || '').length;
      n.textContent = (targets[i] * t).toFixed(dp);
    };
    if (RM) { nums.forEach((n, i) => write(n, i, 1)); return; }
    register(el, (p) => {
      const e = 1 - Math.pow(1 - p, 3);
      nums.forEach((n, i) => write(n, i, e));
    }, 0.7);
  }

  /* ------------------------------------------------ 5.8 CTAConvergence */
  /* The page's own trace resolving into its call to action. It is the same
     TraceLine mechanism pointed at a different job, plus a class the CSS uses
     to bring the button up out of the convergence. */

  function ctaConvergence(el) {
    const svg = el.querySelector('[data-trace]');
    if (svg) traceLine(svg);
    if (RM) { el.classList.add('is-arrived'); return; }
    register(el, (p) => {
      el.style.setProperty('--converge', p.toFixed(4));
      el.classList.toggle('is-arrived', p > 0.7);
    }, 0.85);
  }

  /* ------------------------------------- 5.9–5.11 logo primitives */
  /* Rails, constellations and indexes are laid out entirely in CSS. The only
     behaviour is the brief's restrained one: the trace reaches a mark, the mark
     gains contrast, its scope label appears, and it settles. No marquee, no
     carousel, no rotation, no cursor chasing — and under reduced motion the
     marks are simply at full contrast from the start. */

  function logoGroup(el) {
    const marks = $$('[data-logo]', el);
    if (!marks.length) return;
    if (RM) { marks.forEach(m => m.classList.add('is-lit')); return; }
    register(el, (p) => {
      marks.forEach((m, i) => {
        const at = (i + 1) / (marks.length + 1);
        m.classList.toggle('is-lit', p >= at * 0.8);
      });
    }, 0.7);
  }

  /* --------------------------------------------------------- wire-up */

  const PRIMITIVES = [
    ['[data-trace]:not([data-converge] [data-trace])', traceLine],
    ['[data-stage]', stickyStage],
    ['[data-rail]', horizontalRail],
    ['[data-depth]', depthGallery],
    ['[data-mask]', maskReveal],
    ['[data-kinetic]', kineticType],
    ['[data-metric]', metricTrace],
    ['[data-converge]', ctaConvergence],
    ['[data-logo-group]', logoGroup],
  ];

  /* Subtrees this file must not touch.
     ----------------------------------
     The homepage runs its own motion system: an eleven-stage pinned narrative
     with a damped altitude clock, kinetic typography driven from that clock,
     and panels that carry `data-stage` and `data-kinetic` of their own. Those
     two attribute names are also two of the primitives below, so a wire-up that
     swept the whole document would find eleven journey panels, register them
     with a second driver and animate them against a second, unrelated
     progress — while the header and the Arrival footer, which genuinely are
     this file's, are in the same document.

     The homepage marks its React mount host `data-motion-external`: everything
     inside it belongs to the journey, everything outside it is the site chrome.
     On the 66 generated routes there is no such element and this costs one
     `closest()` per registered node, once, at boot. */
  const external = (el) => el.closest('[data-motion-external]') !== null;

  function boot() {
    document.documentElement.classList.add('motion-ready');
    for (const [sel, fn] of PRIMITIVES) {
      for (const el of $$(sel)) {
        if (external(el)) continue;
        try { fn(el); } catch (_) { /* one bad node must not take the page down */ }
      }
    }
  }

  // getTotalLength() needs layout, and web fonts change layout, so wait for
  // load rather than DOMContentLoaded — a trace measured against a fallback
  // font would draw to the wrong length.
  if (document.readyState === 'complete') boot();
  else addEventListener('load', boot, { once: true });

  window.Stratos = window.Stratos || {};
  window.Stratos.motion = { register, reducedMotion: RM };
})();

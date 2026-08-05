/* ==========================================================================
   STRATOS — interaction layer. No dependencies.
   Everything here serves one idea: the page is a climb, and the interface
   is the instrumentation for it.
   ========================================================================== */
(() => {
  'use strict';

  const RM = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const FINE = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));

  /* Strings the build writes into <script id="i18n">, so this file stays
     language-agnostic. The fallbacks are Hungarian — the source language. */
  const T = Object.assign({
    locale: 'hu-HU',
    unit: 'MÉTER',
    layers: ['TROPOSZFÉRA', 'SZTRATOSZFÉRA', 'MEZOSZFÉRA'],
    sending: 'Küldés…',
    sent: 'Elküldve',
    thanks: 'Köszönjük — hamarosan válaszolunk a megadott címre.',
    fail: 'A küldés nem sikerült. Írj közvetlenül: lukacs.artur@media-stratos.com',
    invalid: 'Kérjük, ellenőrizd a kiemelt mezőket.',
    need_name: 'Kérjük, add meg a nevedet.',
    need_email: 'Ez az e-mail cím nem tűnik helyesnek.',
    too_long: 'Az egyik mező túl hosszú — kérjük, rövidítsd le.',
    limited: 'Túl sok beküldés egymás után. Kérlek, várj egy percet.',
  }, (() => {
    try { return JSON.parse($('#i18n').textContent); } catch (_) { return {}; }
  })());

  /* ---------------------------------------------------------- altimeter */
  const Altimeter = (() => {
    // subpages carry the rail; the home page carries the full instrument panel
    const rail = $('.rail') || $('.hud');
    if (!rail) return { tick: () => {} };

    const ticksEl = $('.rail__ticks', rail);
    const altEl = $('.rail__alt', rail);
    const layerEl = $('.rail__layer', rail);

    const FLOOR = 420;                                        // ground level, m
    const CEIL = Number(document.body.dataset.ceiling || 30000);
    const PX_PER_100M = 14;

    // Build the tape once. One tick per 100 m, labelled every 1000 m.
    if (ticksEl) {
      const frag = document.createDocumentFragment();
      for (let m = 0; m <= CEIL + 4000; m += 100) {
        const t = document.createElement('i');
        const major = m % 1000 === 0;
        t.className = 'tick' + (major ? ' tick--major' : '');
        t.style.top = `${-(m / 100) * PX_PER_100M}px`;
        if (major && m > 0) {
          const n = document.createElement('em');
          n.className = 'tick__n';
          n.textContent = (m / 1000) + 'k';
          t.appendChild(n);
        }
        frag.appendChild(t);
      }
      ticksEl.appendChild(frag);
    }

    let shown = FLOOR;

    function layerOf(m) {
      if (m < 12000) return [T.layers[0], ''];
      if (m < 50000) return [T.layers[1], 'is-strato'];
      return [T.layers[2], 'is-meso'];
    }

    return {
      tick(progress) {
        const target = FLOOR + progress * (CEIL - FLOOR);
        shown = RM ? target : lerp(shown, target, 0.12);
        const m = Math.round(shown);

        if (altEl) altEl.textContent = m.toLocaleString(T.locale).replace(/[\s\u00a0\u202f]/g, '\u2009');
        if (ticksEl) ticksEl.style.transform = `translateY(${(shown / 100) * PX_PER_100M}px)`;

        if (layerEl) {
          const [name, cls] = layerOf(m);
          if (layerEl.dataset.name !== name) {
            layerEl.dataset.name = name;
            layerEl.textContent = name;
            layerEl.className = 'rail__layer ' + cls;
          }
        }
      }
    };
  })();

  /* ---------------------------------------------------------- nav
     Moved out. The header's three states, the full-screen navigation layer,
     its focus trap and the return-to-0 m control all live in
     assets/js/header.js now — including the `is-solid` toggle, so that class
     has exactly one owner. What used to be here also set `.is-hidden` from the
     sign of the scroll delta, which is the jitter the Phase 8.5 brief asks to
     be rid of, and it is gone rather than relocated. */

  /* ---------------------------------------------------------- reveal */
  const io = new IntersectionObserver((entries) => {
    entries.forEach(en => {
      if (!en.isIntersecting) return;
      en.target.classList.add('is-in');
      if (en.target.dataset.count !== undefined) countUp(en.target);
      io.unobserve(en.target);
    });
  }, { rootMargin: '0px 0px -12% 0px', threshold: 0.08 });

  $$('[data-reveal], .mask, [data-count]').forEach((el, i) => {
    if (!el.style.getPropertyValue('--d') && el.hasAttribute('data-reveal')) {
      const stagger = el.closest('[data-stagger]');
      if (stagger) {
        const sibs = $$('[data-reveal]', stagger);
        el.style.setProperty('--d', `${sibs.indexOf(el) * 90}ms`);
      }
    }
    io.observe(el);
  });

  function countUp(el) {
    const to = parseFloat(el.dataset.count);
    const suffix = el.dataset.suffix || '';
    const dur = 1400;
    if (RM) { el.textContent = to + suffix; return; }
    const t0 = performance.now();
    (function step(now) {
      const p = clamp((now - t0) / dur, 0, 1);
      const e = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(to * e) + suffix;
      if (p < 1) requestAnimationFrame(step);
    })(t0);
  }

  /* ---------------------------------------------------------- marquees */
  const marquees = $$('.marquee__track').map(track => {
    const inner = track.firstElementChild;
    if (!inner) return null;
    track.appendChild(inner.cloneNode(true));
    track.appendChild(inner.cloneNode(true));
    return { track, w: 0, x: 0, dir: track.dataset.dir === 'rtl' ? 1 : -1, speed: Number(track.dataset.speed || 0.5) };
  }).filter(Boolean);

  function sizeMarquees() {
    marquees.forEach(m => { m.w = m.track.firstElementChild.offsetWidth + parseFloat(getComputedStyle(m.track).gap || 0); });
  }

  /* ---------------------------------------------------------- flight path */
  const paths = $$('.path').map(sec => {
    const vp = $('.path__viewport', sec);
    const track = $('.path__track', sec);
    const bar = $('.path__bar i', sec);
    if (!vp || !track) return null;
    return { sec, vp, track, bar, dist: 0 };
  }).filter(Boolean);

  function sizePaths() {
    paths.forEach(p => {
      p.dist = Math.max(0, p.track.scrollWidth - p.vp.clientWidth);
      // the section is tall enough to scrub the full horizontal run
      p.sec.style.height = `${window.innerHeight + p.dist}px`;
    });
  }

  function scrubPaths() {
    paths.forEach(p => {
      const r = p.sec.getBoundingClientRect();
      const total = p.sec.offsetHeight - window.innerHeight;
      const prog = clamp(-r.top / (total || 1), 0, 1);
      p.track.style.transform = `translate3d(${-prog * p.dist}px,0,0)`;
      if (p.bar) p.bar.style.transform = `scaleX(${0.08 + prog * 0.92})`;
    });
  }

  /* ---------------------------------------------------------- parallax */
  const paras = $$('[data-para]');

  /* ---------------------------------------------------------- main loop */
  // Pages that aren't driven by scrolling (the questionnaire) can feed the
  // altimeter their own progress instead.
  let progressOverride = null;
  window.Stratos = {
    setProgress(p) { progressOverride = p === null ? null : clamp(Number(p) || 0, 0, 1); }
  };

  let rafScroll = 0;
  function frame() {
    const y = window.scrollY;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const progress = progressOverride !== null
      ? progressOverride
      : (max > 0 ? clamp(y / max, 0, 1) : 0);

    Altimeter.tick(progress);
    scrubPaths();

    paras.forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.bottom < -200 || r.top > window.innerHeight + 200) return;
      const amt = Number(el.dataset.para);
      const centre = (r.top + r.height / 2 - window.innerHeight / 2) / window.innerHeight;
      el.style.transform = `translate3d(0, ${(-centre * amt * 100).toFixed(2)}px, 0)`;
    });

    if (!RM) {
      marquees.forEach(m => {
        m.x += m.speed * m.dir;
        if (m.w) {
          if (m.x <= -m.w) m.x += m.w;
          if (m.x >= 0 && m.dir > 0) m.x -= m.w;
        }
        m.track.style.transform = `translate3d(${m.x}px,0,0)`;
      });
    }

    rafScroll = requestAnimationFrame(frame);
  }

  /* ---------------------------------------------------------- plane cursor */
  if (FINE && !RM) {
    const plane = $('.plane-cursor');
    const cv = $('.contrail');
    if (plane && cv) {
      const ctx = cv.getContext('2d');
      let dpr = Math.min(devicePixelRatio || 1, 2);
      const sizeCv = () => {
        cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      };
      sizeCv();
      window.addEventListener('resize', sizeCv);

      let mx = innerWidth / 2, my = innerHeight / 2;
      let px = mx, py = my, angle = 0;
      const trail = [];

      window.addEventListener('pointermove', e => {
        mx = e.clientX; my = e.clientY;
        plane.classList.add('is-on');
        const hot = e.target.closest('a, button, summary, input, textarea, select, [data-hot]');
        plane.classList.toggle('is-hot', !!hot);
      }, { passive: true });

      document.addEventListener('pointerleave', () => plane.classList.remove('is-on'));

      (function fly() {
        const nx = lerp(px, mx, 0.16);
        const ny = lerp(py, my, 0.16);
        const dx = nx - px, dy = ny - py;
        const speed = Math.hypot(dx, dy);

        if (speed > 0.35) {
          // the logo art points up-right, so offset the heading by 45°
          const target = Math.atan2(dy, dx) + Math.PI / 4;
          let diff = target - angle;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          angle += diff * 0.2;
        }

        px = nx; py = ny;
        plane.style.transform =
          `translate3d(${px}px, ${py}px, 0) translate(-50%,-50%) rotate(${angle}rad)`;

        trail.push({ x: px, y: py, a: 1 });
        if (trail.length > 26) trail.shift();

        ctx.clearRect(0, 0, innerWidth, innerHeight);
        ctx.lineCap = 'round';
        for (let i = 1; i < trail.length; i++) {
          const p0 = trail[i - 1], p1 = trail[i];
          const t = i / trail.length;
          ctx.strokeStyle = `rgba(255,238,37,${(t * 0.5).toFixed(3)})`;
          ctx.lineWidth = t * 2.4;
          ctx.beginPath();
          ctx.moveTo(p0.x, p0.y);
          ctx.lineTo(p1.x, p1.y);
          ctx.stroke();
        }
        requestAnimationFrame(fly);
      })();
    }
  }

  /* ---------------------------------------------------------- magnetic buttons */
  if (FINE && !RM) {
    $$('[data-magnet]').forEach(btn => {
      let raf = 0, tx = 0, ty = 0, cx = 0, cy = 0;
      const loop = () => {
        cx = lerp(cx, tx, 0.18); cy = lerp(cy, ty, 0.18);
        btn.style.transform = `translate(${cx.toFixed(2)}px, ${cy.toFixed(2)}px)`;
        if (Math.abs(cx - tx) > 0.1 || Math.abs(cy - ty) > 0.1) raf = requestAnimationFrame(loop);
        else raf = 0;
      };
      btn.addEventListener('pointermove', e => {
        const r = btn.getBoundingClientRect();
        tx = (e.clientX - (r.left + r.width / 2)) * 0.28;
        ty = (e.clientY - (r.top + r.height / 2)) * 0.4;
        if (!raf) raf = requestAnimationFrame(loop);
      });
      btn.addEventListener('pointerleave', () => {
        tx = 0; ty = 0;
        if (!raf) raf = requestAnimationFrame(loop);
      });
    });
  }

  /* ---------------------------------------------------------- hero contrails */
  const heroCv = $('.hero__streaks');
  if (heroCv && !RM) {
    const ctx = heroCv.getContext('2d');
    let w = 0, h = 0, streaks = [];
    const dpr = Math.min(devicePixelRatio || 1, 2);

    function build() {
      const r = heroCv.getBoundingClientRect();
      w = r.width; h = r.height;
      heroCv.width = w * dpr; heroCv.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      streaks = Array.from({ length: 22 }, () => spawn(true));
    }
    function spawn(seed) {
      return {
        x: Math.random() * w * 1.3 - w * 0.15,
        y: seed ? Math.random() * h : h + Math.random() * 120,
        len: 40 + Math.random() * 190,
        v: 0.25 + Math.random() * 1.1,
        a: 0.05 + Math.random() * 0.3,
        gold: Math.random() > 0.78
      };
    }
    build();
    window.addEventListener('resize', build);

    (function drift() {
      if (!heroCv.isConnected) return;
      ctx.clearRect(0, 0, w, h);
      streaks.forEach((s, i) => {
        s.y -= s.v;
        s.x += s.v * 0.34;                       // everything climbs to the right
        if (s.y + s.len < -40) streaks[i] = spawn(false);
        const g = ctx.createLinearGradient(s.x, s.y + s.len, s.x + s.len * 0.34, s.y);
        const c = s.gold ? '255,238,37' : '203,220,233';
        g.addColorStop(0, `rgba(${c},0)`);
        g.addColorStop(0.5, `rgba(${c},${s.a})`);
        g.addColorStop(1, `rgba(${c},0)`);
        ctx.strokeStyle = g;
        ctx.lineWidth = s.gold ? 1.2 : 0.8;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y + s.len);
        ctx.lineTo(s.x + s.len * 0.34, s.y);
        ctx.stroke();
      });
      requestAnimationFrame(drift);
    })();
  }

  /* ---------------------------------------------------------- page curtain
     Removed in Phase 7. `assets/js/transitions.js` owns page transitions now,
     and the curtain that used to live here could not be kept alongside it:

       * it called `e.preventDefault()` on *every* same-origin left-or-modified
         click, so ⌘-click, Ctrl-click, Shift-click and Alt-click on every
         internal link on the site were swallowed. "Open in new tab" opened in
         the current tab. §20 forbids intercepting all four by name, and this
         was the site's most visible violation of it;
       * it did not check `download`, so a download link was intercepted and
         then navigated to;
       * it did not exclude `/portal/`, `/api/` or asset paths, so it animated
         into an authenticated SPA and into non-documents;
       * `location.href = href` used the raw attribute after a 420 ms wait with
         no timeout and no failure path, so an interrupted navigation left the
         page under a red curtain with nothing scheduled to remove it;
       * nothing cleared `.is-up` on `pageshow`, so a BFCache restore came back
         with the class still applied.

     All six are fixed in `transitions.js`, which also handles the supported
     cross-document path that this could not. The `.curtain` element and its
     keyframes are gone from `_build/build.py` and `assets/css/main.css`. */

  /* ---------------------------------------------------------- forms
     Moved out. Every public form — the footer newsletter, the contact form, the
     Impact application and the questionnaire wizard — now goes through the one
     controller in assets/js/lead.js, which builds the canonical envelope, binds
     `form[data-lead]` itself and is loaded before this file.

     It lives in its own file rather than here because the questionnaire is a
     separately generated script that also has to reach it, and because a single
     submission path is only single if there is exactly one copy of it.

     See netlify/functions/lead-contract.mjs for the request contract. */


  /* ---------------------------------------------------------- boot */
  function boot() {
    sizeMarquees();
    sizePaths();
    document.body.classList.add('is-ready');
    $$('.hero .mask').forEach((m, i) => {
      m.style.setProperty('--d', `${140 + i * 110}ms`);
      requestAnimationFrame(() => m.classList.add('is-in'));
    });
  }

  window.addEventListener('load', boot);
  window.addEventListener('resize', () => { sizeMarquees(); sizePaths(); });
  document.addEventListener('DOMContentLoaded', () => { sizeMarquees(); sizePaths(); });
  frame();
})();

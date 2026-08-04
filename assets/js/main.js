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

  /* ---------------------------------------------------------- nav */
  const nav = $('.nav');
  let lastY = 0;

  function navState(y) {
    if (!nav) return;
    nav.classList.toggle('is-solid', y > 40);
    const menuOpen = document.body.classList.contains('menu-open');
    nav.classList.toggle('is-hidden', !menuOpen && y > 400 && y > lastY);
    lastY = y;
  }

  const burger = $('.burger');
  const menu = $('.menu');
  if (burger && menu) {
    burger.addEventListener('click', () => {
      const open = burger.getAttribute('aria-expanded') === 'true';
      burger.setAttribute('aria-expanded', String(!open));
      menu.classList.toggle('is-open', !open);
      document.body.classList.toggle('menu-open', !open);
      document.body.style.overflow = !open ? 'hidden' : '';
    });
    menu.addEventListener('click', e => {
      if (e.target.closest('a')) {
        burger.setAttribute('aria-expanded', 'false');
        menu.classList.remove('is-open');
        document.body.classList.remove('menu-open');
        document.body.style.overflow = '';
      }
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && menu.classList.contains('is-open')) burger.click();
    });
  }

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
    navState(y);
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
     Every public form posts JSON to POST /api/lead: one endpoint, one schema,
     one place where a submission is validated for real. Nothing in this file is
     trusted by the server — the checks below exist so the visitor gets an
     answer without a round trip, not to protect the table.

     `data-lead` names the shape of the form. It picks the mapper that turns
     these fields into lead columns, and it is stored as the lead's source. */

  const LEAD_ENDPOINT = '/api/lead';

  // Mirrors MAX in netlify/functions/submit-lead.mjs. The server caps again on
  // arrival; this copy only lets us say *which* field is too long.
  const LIMIT = {
    name: 120, company: 160, email: 254, phone: 40, website: 300,
    service_interest: 80, budget_range: 60, timeframe: 60, message: 8000,
  };
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

  // The server discards anything completed in under three seconds as automated.
  // A one-field newsletter can honestly beat that, so a real submission waits
  // out the remainder rather than being silently dropped.
  const MIN_FILL_MS = 3000;
  const LOADED_AT = Date.now();

  const cut = (v, n) =>
    String(v == null ? '' : v).replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, n);

  /** Labelled block for fields the leads table has no column of its own for. */
  const lines = pairs =>
    pairs.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join('\n');

  /* Field names stay as they are in the markup — Hungarian, and readable next
     to their labels. Every translation from those names to lead columns lives
     here, so there is one place to check when a form gains a field. */
  const MAPPERS = {
    // One field, and no name to give. The server accepts that for this source
    // alone; see the newsletter branch in submit-lead.mjs.
    newsletter: d => ({ email: d.email }),

    contact: d => ({
      name: [d.vezeteknev, d.keresztnev].filter(Boolean).join(' '),
      company: d.ceg,
      email: d.email,
      phone: d.telefon,
      message: lines([
        ['Üzenet', d.megjegyzes],
        ['Adatvédelmi nyilatkozat elfogadva', d.adatvedelem_elfogadva || 'Nem'],
        ['Hírlevelet kér', d.hirlevel || 'Nem'],
      ]),
    }),

    impact: d => ({
      name: d.kapcs,
      company: d.org,
      email: d.mail,
      phone: d.tel,
      website: d.web,
      service_interest: 'Impact Program',
      message: lines([
        ['Tevékenységi terület', d.terulet],
        ['Mivel foglalkozik a szervezet', d.mivel],
        ['Elért hatás', d.hatas],
        ['Miért fontos az új weboldal', d.miert],
        ['Mit tudjon az új weboldal', d.mit],
        ['Adatkezelés elfogadva', d.adatkezeles_elfogadva || 'Nem'],
      ]),
    }),
  };

  /** Cap every column, and attach the fields the endpoint expects on all forms. */
  function toLead(mapped, source, raw) {
    const lead = { source, locale: document.documentElement.lang || 'hu' };
    Object.keys(LIMIT).forEach(col => {
      const v = cut(mapped[col], LIMIT[col]);
      if (v) lead[col] = v;
    });
    // Hidden from humans by CSS. Passed through untouched so the server, not
    // this file, decides what a filled honeypot means.
    lead.company_website = cut(raw.company_website, 200);
    return lead;
  }

  /** Returns a message when the visitor still has something to fix, else ''. */
  function validate(lead, mapped, source) {
    const over = Object.keys(LIMIT).find(
      col => cut(mapped[col], LIMIT[col] + 1).length > LIMIT[col]);
    if (over) return T.too_long;
    if (source !== 'newsletter' && (lead.name || '').length < 2) return T.need_name;
    if (!EMAIL_RE.test(lead.email || '')) return T.need_email;
    return '';
  }

  /** The live region for this form: a dedicated status line, or the note. */
  function statusNode(f) {
    const sib = f.nextElementSibling;
    return $('.form__status', f) || $('.form__note', f) ||
      (sib && sib.matches && sib.matches('.form__status, .form__note') ? sib : null);
  }

  $$('form[data-lead]').forEach(f => {
    const source = f.dataset.lead || 'website';
    const note = statusNode(f);
    const btn = $('button[type="submit"], button', f);
    const label = btn && $('span', btn);
    const original = label ? label.textContent : (btn ? btn.textContent : '');

    const setLabel = t => { if (label) label.textContent = t; else if (btn) btn.textContent = t; };
    const setState = (state, text) => {
      f.dataset.state = state;
      if (!note) return;
      note.dataset.state = state;
      note.textContent = text;
    };

    f.addEventListener('submit', async e => {
      e.preventDefault();
      if (f.dataset.state === 'submitting') return;

      const raw = {};
      new FormData(f).forEach((v, k) => {
        raw[k] = raw[k] ? raw[k] + ', ' + v : v;
      });

      const mapped = (MAPPERS[source] || (d => d))(raw);
      const lead = toLead(mapped, source, raw);

      const problem = validate(lead, mapped, source);
      if (problem) {
        setState('invalid', problem);
        const first = $('input:invalid, textarea:invalid, input, textarea', f);
        if (first) first.focus();
        return;
      }

      if (btn) btn.disabled = true;
      setLabel(T.sending);
      setState('submitting', T.sending);

      const wait = MIN_FILL_MS - (Date.now() - LOADED_AT);
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      lead.elapsed_ms = Date.now() - LOADED_AT;

      let res = null, body = {};
      try {
        res = await fetch(LEAD_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(lead),
        });
        body = await res.json();
      } catch (_) { /* network, or a body that was not JSON */ }

      if (res && res.ok && body.ok) {
        setLabel(T.sent);
        setState('success', T.thanks);
        f.reset();
        return;                    // the button stays disabled: it went through
      }

      if (btn) btn.disabled = false;
      setLabel(original);

      if (res && res.status === 429) setState('limited', T.limited);
      else if (res && res.status === 422) {
        const first = body.errors && Object.values(body.errors)[0];
        setState('invalid', first || T.invalid);
      } else setState('error', T.fail);
    });
  });

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

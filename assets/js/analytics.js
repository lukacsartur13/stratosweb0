/* ==========================================================================
   STRATOS — the analytics adapter.

   Provider-neutral by construction. Nothing in this file names a vendor, knows
   a vendor's payload shape, or loads a vendor's SDK. It implements the three
   calls the Phase 9 brief specifies —

       Stratos.analytics.track(eventName, parameters)
       Stratos.analytics.page(pageData)
       Stratos.analytics.consent(consentState)

   — and posts them to a first-party endpoint named in the build configuration.
   The event vocabulary is _build/reports/phase9-event-taxonomy.md; that
   document is the contract, and this file is one implementation of it.

   THREE THINGS THAT ARE NOT NEGOTIABLE HERE

   1. It is inert unless configured. This file is not even fetched unless
      ANALYTICS_ENDPOINT was set at build time — _build/build.py emits neither
      the config block nor this script tag without it. If it somehow does load
      without valid config, readConfig() returns null and the module returns
      before binding a single listener. An unconfigured site pays nothing: no
      request, no observer, no bytes.

   2. It sends no personal data, ever. Every parameter key is checked against
      PROHIBITED before dispatch and an event carrying one is dropped whole.
      Field *names* are permitted, field *values* are not: knowing that
      validation failed on `email` is a usability signal, knowing what the email
      was is a data breach. tests/analytics.spec.ts fails if this weakens.

   3. It sets no cookie and writes no storage. The site currently sets zero
      cookies, which is why it needs no consent banner; measurement must not be
      what changes that. Everything here is scoped to one page view, which is
      also why there is no session identifier and no cross-page stitching.

   CSP: classic script, no inline code, no eval, no module graph, and the only
   network call is same-origin — so it runs under `script-src 'self'` and
   `connect-src 'self'` unchanged. That is the whole reason the sink is
   first-party rather than a vendor endpoint.

   No dependencies. Same house rules as lead.js.
   ========================================================================== */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ config

     Emitted by _build/build.py as a non-executable JSON block, the same
     mechanism the i18n dictionary already uses. Absent means off. */
  function readConfig() {
    var node = document.getElementById('analytics-config');
    if (!node) return null;
    var cfg;
    try { cfg = JSON.parse(node.textContent || '{}'); } catch (e) { return null; }
    if (!cfg || cfg.enabled !== true) return null;
    /* An endpoint is what makes the configuration *valid*. A truthy `enabled`
       with nowhere to send is a misconfiguration, not a reason to start
       collecting into the void. */
    if (typeof cfg.endpoint !== 'string' || !cfg.endpoint) return null;
    return cfg;
  }

  var cfg = readConfig();
  if (!cfg) return;

  /* --------------------------------------------------------------- the guard

     The prohibited list from the event taxonomy §4.3, as parameter keys and as
     the form field names they would arrive under. Checked by key only — a value
     is never inspected, because inspecting it would mean handling it. */
  var PROHIBITED = [
    /* identity */
    'name', 'first_name', 'last_name', 'full_name',
    'vezeteknev', 'keresztnev', 'kitolto', 'kapcs',
    /* contact */
    'email', 'mail', 'e_mail', 'phone', 'telefon', 'tel',
    /* organisation */
    'company', 'ceg', 'cegnev', 'org',
    /* free text and answers */
    'message', 'megjegyzes', 'mivel', 'hatas', 'miert', 'mit', 'funkciok',
    'koltsegkeret', 'koltsegkeret_nagy', 'havidij', 'hatarido', 'hatarido_nagy',
    'konstrukcio', 'konzultacio', 'szegmens',
    'web', 'weboldal', 'weboldal_nagy', 'url',
    'terulet', 'agazat',
    /* Consent flags. Not identifying on their own, but they are answers a
       visitor gave on a form, and the rule is simpler to keep than to reason
       about case by case: no field the lead schema declares is ever an
       analytics parameter key. tests/analytics.spec.ts enforces exactly that
       against FORMS in lead-contract.mjs, so a new form field fails the build
       until it is listed here. */
    'adatvedelem_elfogadva', 'adatkezeles_elfogadva', 'hirlevel',
    /* identifiers that would re-identify a submission */
    'ip', 'ip_address', 'submission_id', 'submissionid', 'row_id', 'lead_id',
    'user_id', 'uuid',
    /* whole payloads */
    'fields', 'payload', 'answers', 'body',
  ];

  var PROHIBITED_INDEX = {};
  for (var i = 0; i < PROHIBITED.length; i++) PROHIBITED_INDEX[PROHIBITED[i]] = true;

  /**
   * The offending key, or null. `field_name` is deliberately exempt as a *key*
   * — it is the one place a field name is legitimately carried, and its value
   * is a name rather than an answer.
   */
  function offendingKey(params) {
    if (!params) return null;
    for (var k in params) {
      if (!Object.prototype.hasOwnProperty.call(params, k)) continue;
      if (k === 'field_name') continue;
      if (PROHIBITED_INDEX[String(k).toLowerCase()]) return k;
    }
    return null;
  }

  /* -------------------------------------------------------- page context

     Read once from the document rather than parsed out of the URL: the slug is
     translated per locale, so `/de/webdesign-kmu.html` and `/en/web-design-sme.html`
     are the same page and only the generator knows that. It emits the canonical
     key on <body>. */
  var body = document.body;

  /* Mirrors ARCHETYPE_BY_KEY in scripts/route-matrix.mjs. Two copies exist
     because the reports are Node and the site is not; tests/analytics.spec.ts
     asserts they are identical, so drift fails the build rather than silently
     mislabelling every event. */
  var PAGE_TYPE = {
    index: 'home', about: 'about', services: 'service overview',
    sme: 'service detail', enterprise: 'service detail',
    branding: 'service detail', ads: 'service detail',
    impact: 'Impact Program', work: 'work index', blog: 'blog / editorial',
    contact: 'contact', quote: 'questionnaire',
    privacy: 'legal / utility', imprint: 'legal / utility',
  };

  function pageTypeOf(key) {
    if (PAGE_TYPE[key]) return PAGE_TYPE[key];
    if (key.indexOf('case-') === 0) return 'case study';
    if (key.indexOf('post-') === 0) return 'article';
    return 'uncategorised';
  }

  var pageKey = (body && body.getAttribute('data-page-key')) || '';
  var context = {
    locale: document.documentElement.lang || 'hu',
    route: location.pathname,
    page_key: pageKey,
    page_type: pageTypeOf(pageKey),
  };

  var SERVICE_KEYS = { sme: 1, enterprise: 1, branding: 1, ads: 1 };

  /* ------------------------------------------------------------- consent

     The site sets no cookies and this adapter stores nothing, so the default
     state is `not_required` and events flow. A build that sets requireConsent
     starts denied and holds events until consent() says otherwise — which is
     the state to use the day anything here starts needing storage. */
  var consentState = cfg.requireConsent ? 'denied' : 'not_required';
  var held = [];

  function allowed() {
    return consentState === 'granted' || consentState === 'not_required';
  }

  /* ------------------------------------------------------------ transport */

  function dispatch(payload) {
    var json = JSON.stringify(payload);
    /* sendBeacon survives the pagehide that a CTA click causes; a fetch does
       not reliably. Same-origin, so no preflight and no CSP widening. */
    if (navigator.sendBeacon) {
      try {
        if (navigator.sendBeacon(cfg.endpoint, new Blob([json], { type: 'application/json' }))) return;
      } catch (e) { /* fall through */ }
    }
    try {
      fetch(cfg.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: json,
        keepalive: true,
        credentials: 'omit',
      }).catch(function () {});
    } catch (e) { /* measurement must never break the page */ }
  }

  function emit(type, name, params) {
    var offender = offendingKey(params);
    if (offender) {
      /* Drop the whole event. A partially-scrubbed event is worse than none:
         it looks like it worked. */
      if (cfg.debug) {
        window.console && console.warn(
          '[analytics] event dropped — prohibited parameter "' + offender + '" in ' + name);
      }
      return;
    }

    var payload = {
      type: type,
      event: name,
      locale: context.locale,
      route: context.route,
      page_type: context.page_type,
      consent_state: consentState,
      ts: Date.now(),
    };
    if (params) {
      for (var k in params) {
        if (Object.prototype.hasOwnProperty.call(params, k)) payload[k] = params[k];
      }
    }
    if (cfg.site) payload.site = cfg.site;

    if (!allowed()) { held.push(payload); return; }
    dispatch(payload);
  }

  /* --------------------------------------------------------- the interface */

  function track(name, params) { if (name) emit('track', name, params); }

  function page(data) {
    emit('page', 'page_view', data || { page_key: context.page_key });
  }

  function consent(state) {
    if (state !== 'granted' && state !== 'denied' && state !== 'not_required') return;
    consentState = state;
    if (!allowed()) { held.length = 0; return; }
    var pending = held.slice();
    held.length = 0;
    for (var i = 0; i < pending.length; i++) {
      pending[i].consent_state = state;
      dispatch(pending[i]);
    }
  }

  /* ==================================================== instrumentation ==== */

  /* ------------------------------------------------------------ CTA identity

     cta_id is <zone>.<placement>.<destination-category>, per taxonomy §4.2.
     Placement is what makes the Workstream A mid-page CTAs measurable
     separately from the closing band — without it the whole F6 change is
     invisible in the data. */

  function zoneOf(el) {
    if (el.closest('header, footer, nav, .menu')) return 'chrome';
    if (el.closest('.arrival')) return 'arrival';
    return 'body';
  }

  function placementOf(el, zone) {
    if (zone !== 'body') return el.closest('.menu') ? 'menu' : 'bar';

    /* Declared, not inferred. The Phase 9 mid-page blocks carry
       data-cta-placement="mid" precisely because inferring them does not work:
       on an article the mid-page block is a `launch--quiet` and so is the
       closing band, while on a service page the mid-page block is the *only*
       quiet band and the closing band is a solid `launch`. Any rule based on
       "the last quiet band" mislabels one of those two shapes, and the F6
       measurement is exactly the thing that would be lost. */
    var declared = el.closest('[data-cta-placement]');
    if (declared) return declared.getAttribute('data-cta-placement');

    if (el.closest('.article__aside')) return 'mid';
    if (el.closest('.launch')) return 'closing';
    if (el.closest('.phead, .hero')) return 'hero';
    return 'body';
  }

  var DEST = [
    ['quote', /(arajanlat|quote|angebot)\.html/],
    ['contact', /(ugyfelszolgalat|contact|kontakt)\.html/],
    ['impact', /impact-program/],
    ['case', /(munka|work|projekt)-/],
    ['work', /(munkaink|work|projekte)\.html/],
    ['article', /blog-/],
    ['blog', /blog\.html/],
    ['service', /(kkv|nagyvallalat|branding|hirdeteskezeles|szolgaltatasok|web-design|ads-management|services|webdesign|werbeanzeigen|leistungen)/],
    ['legal', /(adatkezelesi|impresszum|privacy|imprint|datenschutz|impressum)/],
    ['home', /(^\/?$|index\.html)/],
  ];

  function destinationOf(href) {
    if (!href) return 'none';
    if (/^https?:/i.test(href)) return 'external';
    if (href.charAt(0) === '#') return 'anchor';
    for (var i = 0; i < DEST.length; i++) if (DEST[i][1].test(href)) return DEST[i][0];
    return 'other';
  }

  function ctaInfo(el) {
    var zone = zoneOf(el);
    var dest = destinationOf(el.getAttribute('href'));
    return {
      cta_id: zone + '.' + placementOf(el, zone) + '.' + dest,
      cta_zone: zone,
      cta_emphasis: /\bbtn--ghost\b/.test(el.className) ? 'secondary' : 'primary',
      cta_destination_category: dest,
    };
  }

  function isCta(el) {
    return el && el.tagName === 'A' && /\b(btn|cta|button)\b/.test(el.className || '');
  }

  /* ------------------------------------------------------------- CTA clicks

     One delegated listener rather than one per CTA: the site has up to 12 CTAs
     on a route and this binds once, and keeps working for anything rendered
     later (the wizard, the menu). */
  document.addEventListener('click', function (ev) {
    var el = ev.target && ev.target.closest && ev.target.closest('a');
    if (!el) return;

    if (isCta(el)) {
      var info = ctaInfo(el);
      track('cta_click', info);

      /* The named conversion events, fired *in addition* to cta_click. Only
         cta_click is ever the total, so this cannot double count. */
      var d = info.cta_destination_category;
      if (d === 'quote' || (d === 'contact' && info.cta_emphasis === 'primary')) {
        track('project_start_click', info);
      }
      if (d === 'work' || d === 'case') track('work_explore_click', info);
      if (d === 'contact' && SERVICE_KEYS[context.page_key]) {
        track('service_contact_click', { service_key: context.page_key, cta_id: info.cta_id });
      }
      if (d === 'impact' || (context.page_key === 'impact' && info.cta_destination_category === 'anchor')) {
        track('impact_apply_click', info);
      }
      if (info.cta_zone === 'chrome') {
        track('navigation_click', {
          nav_target: d,
          navigation_source: el.closest('.menu') ? 'menu' : (el.closest('footer') ? 'footer' : 'header'),
        });
      }
      return;
    }

    /* Related content — plain links, not buttons. Workstream A's withdrawn F2
       proved these are the site's real onward paths; not measuring them
       rebuilds exactly that blindness in the data. */
    var related = el.closest('nav.related');
    if (related) {
      track('related_content_click', { related_kind: destinationOf(el.getAttribute('href')) });
      return;
    }

    if (el.closest('.menu, header')) {
      var href = el.getAttribute('href') || '';
      if (/\/(en|de)\//.test(href) || /^(\.\.\/)?(index|about|rolunk|ueber-uns)/.test(href)) {
        var to = /\/en\//.test(href) ? 'en' : (/\/de\//.test(href) ? 'de' : null);
        if (to && to !== context.locale) {
          track('locale_change', { locale_from: context.locale, locale_to: to });
        }
      }
    }
  }, true);

  /* --------------------------------------------------------------- cta_view

     Once per CTA instance per page view — unobserve on first intersection, so
     a visitor oscillating around the Arrival block reports once rather than
     unboundedly. Body CTAs only: the chrome's CTAs are on every route and a
     view of them says nothing about this page. */
  if (window.IntersectionObserver) {
    var seen = new window.IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        if (!entries[i].isIntersecting) continue;
        var el = entries[i].target;
        seen.unobserve(el);
        track('cta_view', ctaInfo(el));
      }
    }, { threshold: 0.5 });

    var ctas = document.querySelectorAll('a.btn, a.cta');
    for (var c = 0; c < ctas.length; c++) {
      if (zoneOf(ctas[c]) === 'body') seen.observe(ctas[c]);
    }
  }

  /* ----------------------------------------------------------------- forms

     Bound to what lead.js already exposes. It sets form.dataset.state through
     submitting → success | limited | invalid | error, so observing that
     attribute measures the real lifecycle without editing the canonical lead
     controller at all. */
  var STATE_EVENT = {
    submitting: 'form_submit_attempt',
    success: 'form_submit_success',
    error: 'form_submit_error',
    limited: 'form_submit_error',
    invalid: 'form_validation_error',
  };

  function bindForm(form) {
    var formType = form.getAttribute('data-lead') || 'contact';
    var started = false;

    form.addEventListener('input', function () {
      if (started) return;
      started = true;
      track('form_start', { form_type: formType });
    }, { once: false });

    if (window.MutationObserver) {
      new window.MutationObserver(function (records) {
        for (var i = 0; i < records.length; i++) {
          var state = form.getAttribute('data-state');
          if (!state || !STATE_EVENT[state]) continue;
          var params = { form_type: formType };
          if (state === 'limited') params.error_kind = 'limited';
          else if (state === 'error') params.error_kind = 'server';
          else if (state === 'invalid') params.error_kind = 'invalid';
          track(STATE_EVENT[state], params);
        }
      }).observe(form, { attributes: true, attributeFilter: ['data-state'] });
    }

    if (window.IntersectionObserver) {
      var fo = new window.IntersectionObserver(function (entries) {
        if (!entries[0].isIntersecting) return;
        fo.disconnect();
        track('form_view', { form_type: formType });
      }, { threshold: 0.25 });
      fo.observe(form);
    }
  }

  /* ------------------------------------------------------- questionnaire

     The wizard has no <form> at any step and no route change, so none of the
     form bindings above can see it. It renders each step into #app, carrying
     data-step / data-steps / data-step-key, and its terminal screens carry
     data-state. Observing #app is the only way to measure the funnel. */
  function bindWizard(app) {
    if (!window.MutationObserver) return;
    var lastStep = null;
    var announced = {};

    new window.MutationObserver(function () {
      var intro = app.querySelector('.quiz__intro');
      if (intro) { lastStep = null; return; }

      var done = app.querySelector('.quiz__done');
      if (done) {
        var st = done.getAttribute('data-state');
        if (st === 'success' && !announced.success) {
          announced.success = true;
          track('questionnaire_submit_success', {});
        } else if ((st === 'error' || st === 'limited' || st === 'invalid') && !announced[st]) {
          announced[st] = true;
          track('questionnaire_submit_error', { error_kind: st === 'limited' ? 'limited' : 'server' });
        } else if (!st && !announced.review) {
          announced.review = true;
          track('questionnaire_review', {});
        }
        return;
      }

      var step = app.querySelector('.quiz__step[data-step]');
      if (!step) return;
      var index = parseInt(step.getAttribute('data-step'), 10);
      if (isNaN(index) || index === lastStep) return;

      if (lastStep === null) track('questionnaire_start', {});
      /* step_key is a field *name* — cegnev, szegmens — never an answer. */
      var params = {
        step_index: index,
        step_key: step.getAttribute('data-step-key') || '',
        step_total: parseInt(step.getAttribute('data-steps'), 10) || null,
      };
      if (lastStep !== null && index < lastStep) track('questionnaire_back', params);
      else if (lastStep !== null) track('questionnaire_step_complete', { step_index: lastStep });

      lastStep = index;
      track('questionnaire_step_view', params);
    }).observe(app, { childList: true, subtree: false });
  }

  /* ------------------------------------------------------- article progress

     At most four events per page view, monotonic, no scroll handler doing work
     on every frame. */
  function bindArticleProgress() {
    var thresholds = [25, 50, 75, 90];
    var next = 0;
    var ticking = false;

    function measure() {
      ticking = false;
      var doc = document.documentElement;
      var scrollable = doc.scrollHeight - window.innerHeight;
      if (scrollable <= 0) return;
      var pct = ((window.scrollY || doc.scrollTop) / scrollable) * 100;
      while (next < thresholds.length && pct >= thresholds[next]) {
        track('article_progress', {
          article_key: context.page_key,
          progress_pct: thresholds[next],
        });
        next++;
      }
      if (next >= thresholds.length) window.removeEventListener('scroll', onScroll);
    }

    function onScroll() {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(measure);
    }

    window.addEventListener('scroll', onScroll, { passive: true });
  }

  /* ------------------------------------------------------------------ menu

     The header owns the menu's open state as an attribute; observing it avoids
     reaching into header.js. */
  function bindMenu() {
    var burger = document.querySelector('[aria-controls][aria-expanded]');
    if (!burger || !window.MutationObserver) return;
    new window.MutationObserver(function () {
      track(burger.getAttribute('aria-expanded') === 'true'
        ? 'navigation_open' : 'navigation_close', {});
    }).observe(burger, { attributes: true, attributeFilter: ['aria-expanded'] });
  }

  /* ------------------------------------------------------------------ start */

  function start() {
    page({ page_key: context.page_key });

    if (context.page_type === 'service detail') {
      track('service_view', { service_key: context.page_key });
    } else if (context.page_type === 'case study') {
      track('work_summary_view', { case_status: body.getAttribute('data-case-status') || 'summary' });
    } else if (context.page_type === 'article') {
      track('article_view', { article_key: context.page_key });
      bindArticleProgress();
    }

    var forms = document.querySelectorAll('form[data-lead]');
    for (var i = 0; i < forms.length; i++) bindForm(forms[i]);

    var app = document.getElementById('app');
    if (app && context.page_type === 'questionnaire') bindWizard(app);

    bindMenu();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  window.Stratos = window.Stratos || {};
  window.Stratos.analytics = {
    track: track,
    page: page,
    consent: consent,
    context: context,
    /* Exposed for tests, which assert the guard rather than trusting it. */
    _prohibited: PROHIBITED,
    _offendingKey: offendingKey,
    _pageTypeOf: pageTypeOf,
  };
})();

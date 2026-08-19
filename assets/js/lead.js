/* ==========================================================================
   STRATOS — the canonical lead submission controller.

   One controller for every public form. The newsletter in the footer, the
   contact form, the Impact Program application and the questionnaire wizard all
   reach the server through `Stratos.lead.send()`, so there is one place where
   the envelope is built, one place where a duplicate click is refused and one
   place where a failure is reported.

   Loaded before main.js and before any per-page script, and it exports itself
   on `window.Stratos.lead` rather than relying on module order: the wizard is a
   separately generated file and must be able to find this without knowing how
   the page was assembled.

   The request contract is `netlify/functions/lead-contract.mjs`. Nothing here
   is trusted by the server — the checks below exist so a visitor gets an answer
   without a round trip, not to protect the table.

   No dependencies. Classic script, so it works under `script-src 'self'` with
   no inline code and no module graph.
   ========================================================================== */
(function () {
  'use strict';

  var ENDPOINT = '/api/lead';

  /* Mirrors COLUMN_MAX and the per-form schemas in lead-contract.mjs. The
     server caps again on arrival; this copy only lets us say *which* field is
     too long before spending a round trip on it. */
  var FIELD_MAX = {
    newsletter:    { email: 254 },
    contact:       { vezeteknev: 80, keresztnev: 80, email: 254, telefon: 40,
                     ceg: 160, megjegyzes: 4000 },
    impact:        { org: 160, kapcs: 120, mail: 254, tel: 40, web: 300,
                     terulet: 120, mivel: 2000, hatas: 2000, miert: 2000, mit: 2000 },
    questionnaire: { cegnev: 160, kitolto: 120, email: 254, telefon: 40,
                     weboldal: 300, weboldal_nagy: 300, szegmens: 120,
                     koltsegkeret: 60, koltsegkeret_nagy: 60, havidij: 60,
                     hatarido: 60, hatarido_nagy: 60, konstrukcio: 80,
                     konzultacio: 80, funkciok: 600 },
  };

  /* Which fields the server will refuse without, per form. Mirrors the
     `required: true` entries in FORMS.

     The browser's own constraint validation already covers these in normal use
     — every one of them carries `required` in the markup, and `submit` does not
     fire until they are satisfied. This list is what catches the cases
     constraint validation cannot: a field emptied by script, a form submitted
     programmatically, and a consent box in a browser that treats a required
     checkbox oddly. It costs a round trip to leave to the server, and the
     visitor is the one who would pay for it. */
  var REQUIRED = {
    newsletter:    ['email'],
    contact:       ['vezeteknev', 'keresztnev', 'email', 'telefon', 'ceg',
                    'megjegyzes', 'adatvedelem_elfogadva'],
    impact:        ['org', 'kapcs', 'mail', 'terulet', 'mivel', 'hatas',
                    'miert', 'adatkezeles_elfogadva'],
    questionnaire: ['cegnev', 'email'],
  };

  /* Which field carries the address, per form. Used only to give a precise
     client-side message; the server checks the real one. */
  var EMAIL_FIELD = { newsletter: 'email', contact: 'email', impact: 'mail', questionnaire: 'email' };

  /* Which required fields are the "who are you" answer. A form missing one of
     these gets the specific message rather than the generic one, because
     "please give us your name" is a more useful thing to read than "check the
     highlighted fields" when the name is the only thing missing. */
  var NAME_FIELDS = {
    contact: ['vezeteknev', 'keresztnev'],
    impact: ['kapcs'],
    questionnaire: ['cegnev'],
  };

  /* The honeypot input's name in the markup. It is lifted out of `fields` and
     sent as `meta.botField`, so no schema can ever declare it and it can never
     reach a database column. */
  var HONEYPOT = 'company_website';

  /* The server discards anything completed in under three seconds as automated.
     A one-field newsletter can honestly beat that, so a real submission waits
     out the remainder rather than being silently dropped. */
  var MIN_FILL_MS = 3000;

  /* How far PAST that threshold the wait aims.

     Not a tolerance for a slow server, and not a bigger version of MIN_FILL_MS:
     the threshold itself is the server's and is unchanged. This exists because
     a wait computed to finish at EXACTLY the rejection threshold has no room
     for the granularity of the timer that implements it — `setTimeout` takes a
     whole number of milliseconds, so a wait of 2989.4 ms is scheduled as 2989
     and lands short. Measured on the unfixed controller, the headroom over the
     threshold was 0-2 ms across four projects, and exactly 0 on one of them.

     What a shortfall costs is not a retry or an error. `submit-lead.mjs` drops
     the submission as automated and answers HTTP 200 with `ok: true` and an
     invented `leadId`, so the visitor is shown the success copy for an enquiry
     that was never stored. See _build/reports/lead-silent-drop/. */
  var MIN_FILL_MARGIN_MS = 250;

  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

  /* Strings the build writes into <script id="i18n">. Fallbacks are Hungarian,
     the source language. */
  var T = {
    sending: 'Küldés…',
    sent: 'Elküldve',
    thanks: 'Köszönjük — hamarosan válaszolunk a megadott címre.',
    /* The newsletter gets its own confirmation, because the general one
       promises a reply and a newsletter request does not produce one. There is
       no newsletter system: the address is stored and nothing is sent. Saying
       "we will reply shortly" to that is a promise the software cannot keep.
       See _build/reports/phase9-email-operations.md. */
    thanks_newsletter: 'Megjegyeztük a címed. Hírlevelet még nem küldünk — az első levél akkor érkezik, amikor a hírlevél elindul.',
    fail: 'A küldés nem sikerült. Írj közvetlenül: lukacs.artur@media-stratos.com',
    invalid: 'Kérjük, ellenőrizd a kiemelt mezőket.',
    need_name: 'Kérjük, add meg a nevedet.',
    need_email: 'Ez az e-mail cím nem tűnik helyesnek.',
    too_long: 'Az egyik mező túl hosszú — kérjük, rövidítsd le.',
    limited: 'Túl sok beküldés egymás után. Kérlek, várj egy percet.',
  };
  try {
    var block = document.getElementById('i18n');
    if (block) {
      var parsed = JSON.parse(block.textContent);
      for (var k in parsed) if (Object.prototype.hasOwnProperty.call(parsed, k)) T[k] = parsed[k];
    }
  } catch (e) { /* the fallbacks above are a complete set */ }

  /* ------------------------------------------------------------------ utils */

  function uuid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    /* crypto.randomUUID is unavailable on http:// origins in some browsers, and
       the local authoring server is one. getRandomValues is not, and the
       version/variant bits below are what make the result a valid v4 that the
       server's UUID pattern accepts. */
    var b = new Uint8Array(16);
    (window.crypto || window.msCrypto).getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    var hex = [];
    for (var i = 0; i < 16; i++) hex.push((b[i] + 0x100).toString(16).slice(1));
    return hex.slice(0, 4).join('') + '-' + hex.slice(4, 6).join('') + '-' +
           hex.slice(6, 8).join('') + '-' + hex.slice(8, 10).join('') + '-' +
           hex.slice(10, 16).join('');
  }

  /**
   * Milliseconds on a timebase the system clock cannot move.
   *
   * `Date.now()` is the adjustable wall clock; `setTimeout` fires on the
   * browser's monotonic timebase. Scheduling on one and measuring on the other
   * is what let a backward clock adjustment of 4 ms make a real submission
   * report less fill time than it had actually spent waiting — and be discarded
   * for it. The two readings below are now taken on the same clock as the wait.
   *
   * `performance.now()` is universally available in the browsers this site
   * supports; the fallback is for a document with no `performance` at all,
   * where the old behaviour is still better than none.
   */
  function monotonicNow() {
    return (window.performance && typeof window.performance.now === 'function')
      ? window.performance.now()
      : Date.now();
  }

  function cut(v, n) {
    return String(v == null ? '' : v)
      .replace(/[\u0000-\u001F\u007F]/g, '')
      .trim()
      .slice(0, n);
  }

  function locale() {
    var l = document.documentElement.lang || 'hu';
    return l === 'en' || l === 'de' ? l : 'hu';
  }

  /** Same-site path of the current page, which is what the envelope carries. */
  function route() {
    var p = location.pathname || '/';
    return p.indexOf('/') === 0 ? p : '/' + p;
  }

  function viewportClass() {
    if (window.matchMedia('(min-width: 900px)').matches) return 'desktop';
    return window.innerHeight >= window.innerWidth ? 'portrait' : 'landscape';
  }

  function referrerOrigin() {
    try {
      return document.referrer ? new URL(document.referrer).origin : '';
    } catch (e) { return ''; }
  }

  /* ============================================================ attribution

     Phase 9, Workstream D. Where an enquiry came from, recorded only when the
     visitor sends us one — and only as facts we named in advance.

     THREE RULES, ALL STRUCTURAL RATHER THAN INTENDED

     1. An ALLOW-LIST, not a filter. `PARAMS` below is the complete set of query
        parameters that can ever be read. Everything else in the URL is not
        sanitised, not truncated, not hashed — it is never looked at. That is
        what stops someone else's tracking parameters, a password reset token
        pasted into a shared link, or a stray `?email=` from arriving in our
        table because nobody thought to exclude it.

     2. SESSION-SCOPED, never cross-session. `sessionStorage`, so it dies with
        the tab. There is no visitor id, no fingerprint, and nothing that
        survives to recognise the same person on a later visit — which is the
        line between "which campaign produced this enquiry" and tracking.

     3. WRITTEN ONLY WHEN THERE IS SOMETHING TO WRITE. A visitor who arrives by
        typing the address, or from a search engine with no campaign tags on the
        link, causes exactly zero bytes of device storage. Most visitors are
        that visitor.

     No advertising click identifier is read. `gclid`, `fbclid`, `msclkid` and
     the rest are per-click identifiers that a vendor can join back to a person,
     and nothing here runs advertising — see _build/reports/phase9-attribution-
     design.md §4 for the decision and what would have to be true to revisit it.

     This is not consent-gated because it is not analytics: nothing is sent
     anywhere until the visitor fills in a form and presses send, and at that
     moment they are deliberately sending us their name, their address and their
     message. Which link brought them is the least of what that request carries.
     It is also not read by assets/js/analytics.js, in either direction. */

  var ATTR_KEY = 'stratos.attribution';

  /* The five UTM parameters, and nothing else. Mapped to the meta names the
     server declares in META — one rename, in one place. */
  var PARAMS = {
    utm_source: 'utmSource',
    utm_medium: 'utmMedium',
    utm_campaign: 'utmCampaign',
    utm_content: 'utmContent',
    utm_term: 'utmTerm',
  };

  var ATTR_MAX = 100;

  /**
   * A campaign value, or ''.
   *
   * Campaign tags are machine-authored labels: letters, digits, and the four
   * separators every campaign builder emits. Anything else is dropped rather
   * than escaped, because a UTM value that needs escaping is not a campaign
   * label — it is someone using the field for something else, and this is not
   * a free-text channel into the database.
   */
  function attrValue(raw) {
    return String(raw == null ? '' : raw)
      .replace(/[^A-Za-z0-9 ._+-]/g, '')
      .trim()
      .slice(0, ATTR_MAX);
  }

  /** The referring host, without scheme, port, path or query. */
  function referrerHost() {
    try {
      if (!document.referrer) return '';
      var h = new URL(document.referrer).hostname.toLowerCase();
      return h === location.hostname.toLowerCase() ? '' : h.slice(0, 120);
    } catch (e) { return ''; }
  }

  /**
   * What this page view says about where the visitor came from, or null.
   *
   * Reads `location.search` through the allow-list. An external referrer counts
   * on its own — arriving from a search engine with no campaign tags is still
   * an answer to "where did this come from", and it is the commonest one.
   */
  function readAttribution() {
    var found = {};
    var any = false;

    try {
      var q = new URLSearchParams(location.search);
      for (var name in PARAMS) {
        if (!Object.prototype.hasOwnProperty.call(PARAMS, name)) continue;
        if (!q.has(name)) continue;
        var v = attrValue(q.get(name));
        if (!v) continue;
        found[PARAMS[name]] = v;
        any = true;
      }
    } catch (e) { /* no URLSearchParams; attribution is optional by design */ }

    var host = referrerHost();
    if (host) { found.landingReferrerHost = host; any = true; }

    if (!any) return null;
    /* The path only. `location.href` would carry the whole query string back
       in through the door the allow-list above exists to close. */
    found.landingRoute = route();
    return found;
  }

  /**
   * The session's attribution, captured on the first page view that has any.
   *
   * First write wins: a visitor who lands on a campaign URL and then navigates
   * to the contact page keeps the campaign, rather than overwriting it with the
   * internal referrer of the last hop.
   */
  function attribution() {
    var stored = null;
    try {
      var raw = window.sessionStorage.getItem(ATTR_KEY);
      if (raw) stored = JSON.parse(raw);
    } catch (e) { /* private mode, or a value we did not write */ }

    if (stored && typeof stored === 'object' && !Array.isArray(stored)) return stored;

    var fresh = readAttribution();
    if (!fresh) return null;
    try {
      window.sessionStorage.setItem(ATTR_KEY, JSON.stringify(fresh));
    } catch (e) { /* the value still applies to this page view */ }
    return fresh;
  }

  /* Captured at load rather than at submit, because by the time a visitor
     reaches the form the campaign parameters are several navigations behind
     them. Storing nothing is the normal outcome. */
  try { attribution(); } catch (e) { /* never break the page over measurement */ }

  /* ---------------------------------------------------------------- sending */

  /**
   * Post one envelope. Exactly one request; no retry loop, because a retry that
   * the visitor did not ask for is a second lead they did not intend.
   *
   * Returns a plain object rather than throwing, so every caller handles the
   * same four outcomes in the same shape:
   *
   *   { state: 'success',  leadId, submissionId }
   *   { state: 'invalid',  message, errors }
   *   { state: 'limited',  message }
   *   { state: 'error',    message }
   */
  function send(options) {
    var meta = {
      elapsedMs: options.elapsedMs,
      referrerOrigin: referrerOrigin(),
      viewport: viewportClass(),
      attempt: options.attempt || 1,
      botField: options.botField || '',
      /* Which host served the page this was sent from. One fact rather than
         two: staging and production are decided from it in the report, so
         there is no second copy of the production-host list to drift out of
         step with the one in the analytics config. */
      host: String(location.hostname || '').toLowerCase().slice(0, 120),
    };

    /* Session attribution, if this session has any. Merged rather than
       assigned, so a key the server does not declare cannot displace one it
       does — and `normaliseMeta` drops anything undeclared regardless. */
    var attr = null;
    try { attr = attribution(); } catch (e) { /* optional by design */ }
    if (attr) {
      for (var a in attr) {
        if (Object.prototype.hasOwnProperty.call(attr, a) && !(a in meta)) meta[a] = attr[a];
      }
    }

    var envelope = {
      submissionId: options.submissionId || uuid(),
      formType: options.formType,
      locale: locale(),
      route: route(),
      fields: options.fields || {},
      meta: meta,
    };

    return fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(envelope),
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        return { res: res, body: body };
      });
    }).then(function (r) {
      var res = r.res;
      var body = r.body;

      if (res.ok && body.ok) {
        return { state: 'success', leadId: body.leadId, submissionId: envelope.submissionId };
      }
      if (res.status === 429) {
        return { state: 'limited', message: body.message || T.limited };
      }
      if (res.status === 422) {
        var first = body.errors && Object.keys(body.errors)[0];
        return {
          state: 'invalid',
          message: (first && body.errors[first]) || body.message || T.invalid,
          errors: body.errors || {},
          field: first || null,
        };
      }
      return { state: 'error', message: body.message || T.fail };
    }).catch(function () {
      /* Network failure, or a body that was not JSON. The visitor's data is
         still in the form; nothing here clears it. */
      return { state: 'error', message: T.fail };
    });
  }

  /* -------------------------------------------------------- form validation */

  /**
   * Returns `{ message, field }` when the visitor still has something to fix.
   *
   * The checks run in the order that produces the most useful single message:
   * something missing first, because that is the commonest fault and naming a
   * missing field is more actionable than naming a malformed one.
   */
  function check(formType, fields) {
    var required = REQUIRED[formType] || [];
    var names = NAME_FIELDS[formType] || [];
    for (var i = 0; i < required.length; i++) {
      var field = required[i];
      if (cut(fields[field], 4000).length === 0) {
        return {
          message: names.indexOf(field) === -1 ? T.invalid : T.need_name,
          field: field,
        };
      }
    }

    var caps = FIELD_MAX[formType] || {};
    for (var name in caps) {
      if (Object.prototype.hasOwnProperty.call(fields, name) &&
          cut(fields[name], caps[name] + 1).length > caps[name]) {
        return { message: T.too_long, field: name };
      }
    }

    var emailField = EMAIL_FIELD[formType];
    if (emailField && !EMAIL_RE.test(cut(fields[emailField], 254))) {
      return { message: T.need_email, field: emailField };
    }
    return null;
  }

  /** The message-only form of `check`, kept for callers that only need that. */
  function validate(formType, fields) {
    var problem = check(formType, fields);
    return problem ? problem.message : '';
  }

  /* ------------------------------------------------------------ form wiring */

  /** The live region for this form: a dedicated status line, or the note. */
  function statusNode(form) {
    var sib = form.nextElementSibling;
    return form.querySelector('.form__status') ||
           form.querySelector('.form__note') ||
           (sib && sib.matches && sib.matches('.form__status, .form__note') ? sib : null);
  }

  /**
   * Read a form into `fields`, lifting the honeypot out.
   *
   * Checkboxes are the interesting case: an unchecked box posts nothing, so a
   * required consent that was never ticked simply does not appear, and the
   * server's `required` check on a `consent` field is what catches it. A ticked
   * box posts its `value`, which the server reads as affirmative.
   */
  function readForm(form) {
    var fields = {};
    var botField = '';
    var data = new FormData(form);
    data.forEach(function (value, name) {
      if (name === HONEYPOT) { botField = value; return; }
      /* Repeated names (a checkbox group) collapse to a comma list, which is
         what the server's `clean` does with an array anyway. */
      fields[name] = Object.prototype.hasOwnProperty.call(fields, name)
        ? fields[name] + ', ' + value
        : value;
    });
    return { fields: fields, botField: botField };
  }

  /**
   * Bind one `<form data-lead="…">`.
   *
   * Native constraint validation is left in place: the handler runs on `submit`,
   * which the browser only fires once the form is constraint-valid, so
   * `required`, `type="email"` and the rest still produce the browser's own
   * messages and focus behaviour before any of this runs.
   */
  function bindForm(form) {
    if (form.dataset.leadBound === 'true') return;
    form.dataset.leadBound = 'true';

    var formType = form.dataset.lead || 'contact';
    var note = statusNode(form);
    var button = form.querySelector('button[type="submit"]') || form.querySelector('button');
    var label = button && button.querySelector('span');
    var original = label ? label.textContent : (button ? button.textContent : '');

    /* One id per submission *attempt sequence*. It survives a failed attempt so
       a retry is recognised as the same submission, and is replaced after a
       success so the next enquiry is a new lead. */
    var submissionId = uuid();
    var attempt = 0;
    var readyAt = monotonicNow();

    function setLabel(text) {
      if (label) label.textContent = text;
      else if (button) button.textContent = text;
    }

    function setState(state, text) {
      form.dataset.state = state;
      if (!note) return;
      note.dataset.state = state;
      note.textContent = text;
    }

    /** Leave the form usable again, with everything the visitor typed intact. */
    function release() {
      if (button) button.disabled = false;
      setLabel(original);
    }

    form.addEventListener('submit', function (event) {
      event.preventDefault();

      /* Duplicate clicks. The button is disabled below too, but a form can also
         be submitted by Enter in a text input while the pointer is elsewhere,
         and a disabled button does not stop that. This flag does. */
      if (form.dataset.state === 'submitting') return;

      var read = readForm(form);
      var problem = check(formType, read.fields);
      if (problem) {
        setState('invalid', problem.message);
        /* Focus the field the check named, so the message and the caret agree.
           The fallbacks are for a named field the markup does not have. */
        var target = form.querySelector('[name="' + problem.field + '"]') ||
                     form.querySelector('input:invalid, textarea:invalid') ||
                     form.querySelector('input, textarea');
        if (target && target.focus) target.focus();
        return;
      }

      attempt += 1;
      if (button) button.disabled = true;
      setLabel(T.sending);
      setState('submitting', T.sending);

      /* Wait out the server's minimum fill time rather than being silently
         dropped by it. Only ever a wait, never a second request.

         Past the threshold rather than up to it, and measured on the same clock
         the timer fires on — the two properties whose absence let a genuine
         enquiry be discarded while the visitor was shown the success copy. */
      var wait = Math.max(0, MIN_FILL_MS + MIN_FILL_MARGIN_MS - (monotonicNow() - readyAt));

      window.setTimeout(function () {
        send({
          submissionId: submissionId,
          formType: formType,
          fields: read.fields,
          botField: read.botField,
          elapsedMs: Math.round(monotonicNow() - readyAt),
          attempt: attempt,
        }).then(function (result) {
          if (result.state === 'success') {
            setLabel(T.sent);
            setState('success',
              (formType === 'newsletter' && T.thanks_newsletter) || T.thanks);
            form.reset();
            /* The button stays disabled: it went through, and the next enquiry
               is a new submission with a new id. */
            submissionId = uuid();
            attempt = 0;
            readyAt = monotonicNow();
            return;
          }

          release();

          if (result.state === 'limited') {
            setState('limited', result.message);
            return;
          }
          if (result.state === 'invalid') {
            setState('invalid', result.message);
            /* Move focus to the field the server named, when the markup has it. */
            var named = result.field && form.querySelector('[name="' + result.field + '"]');
            if (named && named.focus) named.focus();
            return;
          }
          setState('error', result.message);
        });
      }, wait);
    });

    /* A form restored from BFCache comes back exactly as it was left — which,
       if the visitor navigated away mid-send, means a disabled button and a
       "Küldés…" label with no request in flight behind them. `persisted` is the
       signal that this happened; anything still marked as submitting is stale
       by definition, because a real in-flight request did not survive the
       navigation. */
    window.addEventListener('pageshow', function (event) {
      if (!event.persisted) return;
      if (form.dataset.state !== 'submitting') return;
      release();
      setState('', '');
      readyAt = monotonicNow();
    });
  }

  function bindAll(root) {
    var forms = (root || document).querySelectorAll('form[data-lead]');
    for (var i = 0; i < forms.length; i++) bindForm(forms[i]);
  }

  /* The script is loaded in <head> with `defer`, so the document is parsed by
     the time this runs; the readyState branch is for the case where a page adds
     a form later, and for the wizard, which calls bindAll itself. */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { bindAll(); });
  } else {
    bindAll();
  }

  window.Stratos = window.Stratos || {};
  window.Stratos.lead = {
    send: send,
    check: check,
    validate: validate,
    bind: bindForm,
    bindAll: bindAll,
    uuid: uuid,
    endpoint: ENDPOINT,
    minFillMs: MIN_FILL_MS,
    minFillMarginMs: MIN_FILL_MARGIN_MS,
    strings: T,
    /* Exposed for tests, which assert the allow-list rather than trusting it. */
    attribution: attribution,
    _attrParams: PARAMS,
    _attrValue: attrValue,
    _attrKey: ATTR_KEY,
  };
})();

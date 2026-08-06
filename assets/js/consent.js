/* ==========================================================================
   STRATOS — the analytics consent interface.

   Loaded only when the build requires consent, which today means only when
   GA4 is configured. If measurement is off, this file is not emitted and there
   is no banner, because there is nothing to consent to: a site that sets no
   cookies asking permission to set cookies is theatre.

   WHAT MAKES THIS NOT A DARK PATTERN

   The Phase 9 brief forbids dark-pattern consent interfaces, so the rules are
   written down rather than left to taste:

     * Accept and refuse are the SAME element, the same size, the same
       treatment. Neither is styled to be the obvious one. There is no
       pre-ticked box, because there is no box.
     * Refusing takes exactly one click. It is not behind "manage preferences",
       and there is no second screen designed to be tiring.
     * There is no "X" that means yes. The banner cannot be dismissed into
       implied consent; it stays until answered, and until it is answered
       nothing is loaded and nothing is sent.
     * The choice is reversible from every page of the site, through the
       footer's own control, and reversing it deletes the cookies rather than
       only stopping new ones.

   It is a banner rather than a modal on purpose. A modal would trap focus and
   block the page over a question that does not need answering before reading
   anything — the site works identically either way. So the page stays usable,
   the banner is reachable in the tab order, and the answer can wait.

   No dependencies, classic script, no inline code. Same house rules as lead.js.
   ========================================================================== */
(function () {
  'use strict';

  /* Strings the build writes into <script id="i18n">. Fallbacks are Hungarian,
     the source language, and are a complete set on their own. */
  var T = {
    consent_title: 'Mérés és sütik',
    consent_body: 'A Google Analytics segítségével néznénk meg, hogyan használják az oldalt. Csak akkor tölt be és csak akkor helyez el sütit, ha ehhez hozzájárulsz. Nevet, e-mailt és űrlapokba írt szöveget soha nem küldünk el.',
    consent_accept: 'Elfogadom',
    consent_decline: 'Nem járulok hozzá',
    consent_more: 'Adatkezelési tájékoztató',
    consent_settings: 'Süti-beállítások',
    consent_state_granted: 'A mérés jelenleg engedélyezve van.',
    consent_state_denied: 'A mérés jelenleg le van tiltva.',
    consent_withdraw: 'Visszavonom',
    consent_privacy_href: 'adatkezelesi-tajekoztato.html',
  };
  try {
    var block = document.getElementById('i18n');
    if (block) {
      var parsed = JSON.parse(block.textContent);
      for (var k in parsed) if (Object.prototype.hasOwnProperty.call(parsed, k)) T[k] = parsed[k];
    }
  } catch (e) { /* the fallbacks above are a complete set */ }

  function api() {
    return window.Stratos && window.Stratos.analytics;
  }

  var banner = null;

  function build() {
    if (banner) return banner;

    banner = document.createElement('section');
    banner.className = 'consent';
    banner.setAttribute('role', 'region');
    banner.setAttribute('aria-label', T.consent_title);
    banner.hidden = true;

    var wrap = document.createElement('div');
    wrap.className = 'consent__wrap';

    var text = document.createElement('div');
    text.className = 'consent__text';

    var title = document.createElement('p');
    title.className = 'consent__title';
    title.textContent = T.consent_title;

    var body = document.createElement('p');
    body.className = 'consent__body';
    body.textContent = T.consent_body + ' ';

    var more = document.createElement('a');
    more.className = 'tlink';
    more.href = T.consent_privacy_href;
    more.textContent = T.consent_more;
    body.appendChild(more);

    text.appendChild(title);
    text.appendChild(body);

    /* Two buttons, same class, same order every time. The accept button is
       first only because it is the affirmative answer to the question as
       asked; it carries no visual advantage. */
    var actions = document.createElement('div');
    actions.className = 'consent__actions';

    var accept = document.createElement('button');
    accept.type = 'button';
    accept.className = 'btn btn--ghost consent__btn';
    accept.appendChild(document.createTextNode(T.consent_accept));

    var decline = document.createElement('button');
    decline.type = 'button';
    decline.className = 'btn btn--ghost consent__btn';
    decline.appendChild(document.createTextNode(T.consent_decline));

    accept.addEventListener('click', function () { answer('granted'); });
    decline.addEventListener('click', function () { answer('denied'); });

    actions.appendChild(accept);
    actions.appendChild(decline);

    wrap.appendChild(text);
    wrap.appendChild(actions);
    banner.appendChild(wrap);
    document.body.appendChild(banner);

    banner.__accept = accept;
    return banner;
  }

  function answer(state) {
    var a = api();
    if (a) a.consent(state);
    hide();
  }

  var returnFocus = null;

  function show(focusTrigger) {
    build();
    banner.hidden = false;
    returnFocus = focusTrigger || null;
    /* Move focus in, so a keyboard visitor is not left announcing a banner
       they then have to hunt for. Not a focus trap — the page stays usable. */
    window.setTimeout(function () {
      if (banner.__accept) banner.__accept.focus();
    }, 60);
  }

  function hide() {
    if (!banner) return;
    banner.hidden = true;
    if (returnFocus && returnFocus.focus) returnFocus.focus();
    returnFocus = null;
  }

  /* ------------------------------------------------------- the footer control

     The withdrawal path, on every page. It reports the current state as its
     accessible description so that "where do I turn this off" has an answer
     that does not require reading the privacy policy first. */
  function bindSettings() {
    var buttons = document.querySelectorAll('[data-consent-settings]');
    if (!buttons.length) return;

    function label() {
      var a = api();
      var state = a ? a.consentState() : 'denied';
      return state === 'granted' ? T.consent_state_granted : T.consent_state_denied;
    }

    for (var i = 0; i < buttons.length; i++) {
      (function (button) {
        button.hidden = false;
        button.setAttribute('title', label());
        button.addEventListener('click', function () {
          if (banner && !banner.hidden) { hide(); return; }
          show(button);
        });
        var a = api();
        if (a) a.onConsentChange(function () { button.setAttribute('title', label()); });
      })(buttons[i]);
    }
  }

  function init() {
    var a = api();
    /* No adapter, or a build that does not require consent: nothing to ask.
       This is also the path on a host that is not on the GA4 allowlist, where
       the adapter refuses to start at all. */
    if (!a || !a.consentRequired) return;

    bindSettings();
    if (!a.consentAnswered()) show(null);
  }

  /* analytics.js is `defer` and this file is emitted after it, so it has
     already defined window.Stratos.analytics by the time this runs. */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.Stratos = window.Stratos || {};
  window.Stratos.consentUI = { show: show, hide: hide };
})();

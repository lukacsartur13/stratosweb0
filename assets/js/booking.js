/* ==========================================================================
   STRATOS — the booking page (/idopontfoglalas, /en/book-a-call,
   /de/termin-buchen).

   Asks /api/booking for the free times, shows them a day at a time, books the
   one chosen, and — when the address carries the guest's private link
   (#m=<token>, from the Google invitation) — shows that booking with
   "cancel" and "move".

   Every word it shows comes from the page itself (ul[data-booking-copy]), so
   the build translates it with the rest of the page. Dates and times are
   formatted by the browser in the booking's own time zone, in the page's
   language. The server checks everything again: what is checked here is for
   an answer without a round trip.

   No dependencies. Classic script, so it works under `script-src 'self'`.
   ========================================================================== */
(function () {
  'use strict';

  var root = document.querySelector('[data-booking]');
  if (!root) return;

  var ENDPOINT = '/api/booking';
  var MIN_FILL_MS = 3250;
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  var PHONE_RE = /^[0-9+()./ -]{6,40}$/;
  var DAYS_SHOWN = 10;
  var LANG = (document.documentElement.lang || 'hu').slice(0, 2);
  var LOCALE = { hu: 'hu-HU', en: 'en-GB', de: 'de-DE' }[LANG] || 'hu-HU';
  var startedAt = Date.now();

  var $ = function (sel) { return root.querySelector(sel); };
  var T = {};
  document.querySelectorAll('[data-booking-copy] [data-k]').forEach(function (li) { T[li.getAttribute('data-k')] = li.textContent.trim(); });

  var el = {
    pick: $('[data-booking-pick]'), days: $('[data-booking-days]'), times: $('[data-booking-times]'), state: $('[data-booking-state]'),
    form: $('[data-booking-form]'), chosen: $('[data-booking-chosen]'), back: $('[data-booking-back]'), formState: $('[data-booking-form-state]'),
    done: $('[data-booking-done]'), doneWhen: $('[data-booking-done-when]'), doneEmail: $('[data-booking-done-email]'),
    doneMeet: $('[data-booking-done-meet]'), meetLink: $('[data-booking-meet-link]'), manageLink: $('[data-booking-manage-link]'),
    manage: $('[data-booking-manage]'), manageWhen: $('[data-booking-manage-when]'), manageNote: $('[data-booking-manage-note]'),
    actions: $('[data-booking-manage-actions]'), cancel: $('[data-booking-cancel]'), move: $('[data-booking-move]'),
    manageState: $('[data-booking-manage-state]'),
  };
  // The contact page, in this page's language: the way out when booking cannot help.
  var contactLink = document.querySelector('.phead .note a.tlink');

  var state = { zone: 'Europe/Budapest', slots: [], day: null, chosen: null, showAll: false, token: null, booking: null, moving: false, confirmCancel: false };

  /* ------------------------------------------------------------- helpers */

  function fmt(iso, opts) {
    try { return new Intl.DateTimeFormat(LOCALE, Object.assign({ timeZone: state.zone }, opts)).format(new Date(iso)); } catch (e) { return iso; }
  }
  var dayKey = function (iso) { return fmt(iso, { year: 'numeric', month: '2-digit', day: '2-digit' }); };
  var time = function (iso) { return fmt(iso, { hour: '2-digit', minute: '2-digit' }); };
  function when(start, end) {
    return fmt(start, { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }) + ', ' + time(start) + '–' + time(end);
  }

  function say(node, key, kind, withContact) {
    if (!node) return;
    node.textContent = T[key] || key;
    if (kind) node.setAttribute('data-state', kind); else node.removeAttribute('data-state');
    if (withContact && contactLink) {
      node.appendChild(document.createTextNode(' '));
      var a = document.createElement('a');
      a.className = 'tlink';
      a.href = contactLink.getAttribute('href');
      a.textContent = T.contact_link || contactLink.textContent.trim();
      node.appendChild(a);
    }
  }

  function show(which) {
    el.pick.hidden = which !== 'pick';
    el.form.hidden = which !== 'form';
    el.done.hidden = which !== 'done';
    el.manage.hidden = which !== 'manage' && which !== 'move';
    if (which === 'move') el.pick.hidden = false;
  }

  function call(method, body) {
    var init = { method: method, headers: { accept: 'application/json' }, credentials: 'same-origin' };
    if (body) { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(body); }
    return fetch(method === 'GET' ? ENDPOINT + '?minutes=30' : ENDPOINT, init).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (json) { return { status: res.status, body: json || {} }; });
    }, function () { return { status: 0, body: {} }; });
  }

  // Why booking cannot happen right now, as a sentence: off (not connected,
  // switched off, or no booking function on this server at all — a local
  // preview of the static site), or an error worth retrying later.
  function unavailableKey(r) {
    if (r.status === 503 || r.status === 404) return 'off';
    if (r.status === 429) return 'limited';
    return 'error';
  }

  /* --------------------------------------------------------- the picker */

  function renderDays() {
    var groups = [];
    var index = {};
    state.slots.forEach(function (s) {
      var k = dayKey(s.start);
      if (!(k in index)) { index[k] = groups.length; groups.push({ key: k, first: s.start, slots: [] }); }
      groups[index[k]].slots.push(s);
    });
    state.groups = groups;
    el.days.textContent = '';
    el.times.textContent = '';
    if (!groups.length) { say(el.state, 'none', null, true); return; }
    if (!state.day || !(state.day in index)) state.day = groups[0].key;
    var shown = state.showAll ? groups : groups.slice(0, DAYS_SHOWN);
    shown.forEach(function (g) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'booking__day';
      b.setAttribute('aria-pressed', String(g.key === state.day));
      b.setAttribute('data-day', g.key);
      var w = document.createElement('span');
      w.className = 'booking__day-w';
      w.textContent = fmt(g.first, { weekday: 'short' });
      var d = document.createElement('span');
      d.className = 'booking__day-d';
      d.textContent = fmt(g.first, { month: 'short', day: 'numeric' });
      b.appendChild(w);
      b.appendChild(d);
      b.addEventListener('click', function () { state.day = g.key; renderDays(); var t = el.times.querySelector('button'); if (t) t.focus(); });
      el.days.appendChild(b);
    });
    if (!state.showAll && groups.length > DAYS_SHOWN) {
      var more = document.createElement('button');
      more.type = 'button';
      more.className = 'booking__day booking__day--more';
      more.textContent = T.more;
      more.addEventListener('click', function () { state.showAll = true; renderDays(); });
      el.days.appendChild(more);
    }
    groups[index[state.day]].slots.forEach(function (s) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'booking__time';
      b.textContent = time(s.start);
      b.setAttribute('data-start', s.start);
      b.addEventListener('click', function () { choose(s); });
      el.times.appendChild(b);
    });
    say(el.state, '', null);
  }

  function loadSlots() {
    show('pick');
    say(el.state, 'loading');
    return call('GET').then(function (r) {
      if (r.status !== 200 || !r.body.ok) {
        el.days.textContent = '';
        el.times.textContent = '';
        // "Not available" is a fact, not a fault: said in the page's own colour.
        var key = unavailableKey(r);
        say(el.state, key, key === 'off' ? null : 'error', true);
        return;
      }
      state.zone = r.body.timeZone || state.zone;
      state.slots = r.body.slots || [];
      renderDays();
    });
  }

  /* ------------------------------------------------------------ booking */

  function choose(s) {
    if (state.moving) { moveTo(s); return; }
    state.chosen = s;
    el.chosen.textContent = when(s.start, s.end);
    say(el.formState, '', null);
    show('form');
    var first = el.form.querySelector('input[name="name"]');
    if (first) first.focus();
  }

  el.back.addEventListener('click', function () {
    show('pick');
    var b = el.times.querySelector('button');
    if (b) b.focus();
  });

  function field(name) { return el.form.elements[name]; }

  function check() {
    var bad = [];
    var v = {
      name: field('name').value.trim(), email: field('email').value.trim(), company: field('company').value.trim(),
      phone: field('phone').value.trim(), topic: field('topic').value.trim(), consent: field('consent').checked,
    };
    if (!v.name) bad.push(['name', 'need_name']);
    if (!EMAIL_RE.test(v.email)) bad.push(['email', 'need_email']);
    if (v.phone && !PHONE_RE.test(v.phone)) bad.push(['phone', 'bad_phone']);
    if (v.topic.length < 3) bad.push(['topic', 'need_topic']);
    if (!v.consent) bad.push(['consent', 'need_consent']);
    return { v: v, bad: bad };
  }

  function mark(names) {
    ['name', 'email', 'phone', 'topic', 'consent'].forEach(function (n) {
      if (names.indexOf(n) >= 0) field(n).setAttribute('aria-invalid', 'true'); else field(n).removeAttribute('aria-invalid');
    });
  }

  var SERVER_FIELD = { name: 'need_name', email: 'need_email', phone: 'bad_phone', topic: 'need_topic', consent: 'need_consent' };

  el.form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (el.form.getAttribute('data-state') === 'submitting' || !state.chosen) return;
    var c = check();
    mark(c.bad.map(function (b) { return b[0]; }));
    if (c.bad.length) {
      say(el.formState, c.bad.length === 1 ? c.bad[0][1] : 'invalid', 'invalid');
      field(c.bad[0][0]).focus();
      return;
    }
    el.form.setAttribute('data-state', 'submitting');
    say(el.formState, 'sending', 'submitting');
    var wait = Math.max(0, MIN_FILL_MS - (Date.now() - startedAt));
    setTimeout(function () {
      call('POST', {
        action: 'book', start: state.chosen.start, minutes: Math.round((Date.parse(state.chosen.end) - Date.parse(state.chosen.start)) / 60000),
        name: c.v.name, email: c.v.email, company: c.v.company, phone: c.v.phone, topic: c.v.topic, consent: c.v.consent, locale: LANG,
        company_website: field('company_website').value, elapsedMs: Date.now() - startedAt,
      }).then(function (r) {
        el.form.removeAttribute('data-state');
        if (r.status === 200 && r.body.ok) { booked(r.body.booking, c.v.email); return; }
        var code = r.body.code;
        if (code === 'TAKEN' || code === 'UNAVAILABLE') {
          loadSlots().then(function () { say(el.state, 'taken', 'error'); });
          return;
        }
        if (code === 'INVALID' && r.body.fields) {
          var names = Object.keys(r.body.fields);
          mark(names);
          say(el.formState, names.length === 1 && SERVER_FIELD[names[0]] ? SERVER_FIELD[names[0]] : 'invalid', 'invalid');
          return;
        }
        if (code === 'EMAIL_OPEN') { say(el.formState, 'email_open', 'error'); return; }
        if (r.status === 429) { say(el.formState, 'limited', 'limited'); return; }
        if (r.status === 503) { say(el.formState, 'off', 'error', true); return; }
        say(el.formState, 'failed', 'error');
      });
    }, wait);
  });

  function booked(b, email) {
    show('done');
    if (b) {
      el.doneWhen.textContent = when(b.start, b.end);
      el.doneEmail.textContent = b.email || email;
      if (b.meetUrl) { el.meetLink.href = b.meetUrl; el.doneMeet.hidden = false; }
      if (b.manageUrl) el.manageLink.href = b.manageUrl;
    } else {
      el.doneWhen.textContent = state.chosen ? when(state.chosen.start, state.chosen.end) : '';
      el.doneEmail.textContent = email;
    }
    el.done.focus();
  }

  /* -------------------------------------------------- the guest's link */

  function manageView() {
    var b = state.booking;
    el.manageWhen.textContent = when(b.start, b.end);
    var key = b.status === 'cancelled' ? 'cancelled' : (b.canChange ? 'active' : 'locked');
    say(el.manageNote, key, null, key === 'locked');
    el.actions.hidden = !b.canChange;
  }

  function loadBooking() {
    show('manage');
    el.actions.hidden = true;
    say(el.manageNote, 'manage_loading');
    return call('POST', { action: 'manage', token: state.token }).then(function (r) {
      if (r.status === 404 || r.status === 400) { say(el.manageNote, 'not_found', 'error', true); return; }
      if (r.status !== 200 || !r.body.ok) { var key = unavailableKey(r); say(el.manageNote, key, key === 'off' ? null : 'error', true); return; }
      state.zone = r.body.timeZone || r.body.booking.timeZone || state.zone;
      state.booking = r.body.booking;
      state.slots = r.body.slots || [];
      manageView();
      el.manage.focus();
    });
  }

  el.cancel.addEventListener('click', function () {
    if (!state.confirmCancel) { state.confirmCancel = true; say(el.manageState, 'confirm_cancel', 'invalid'); return; }
    state.confirmCancel = false;
    el.actions.hidden = true;
    call('POST', { action: 'cancel', token: state.token }).then(function (r) {
      if (r.status === 200 && r.body.ok) {
        state.booking.status = 'cancelled';
        state.booking.canChange = false;
        state.moving = false;
        show('manage');
        manageView();
        say(el.manageState, 'cancel_done', 'success');
        return;
      }
      el.actions.hidden = false;
      if (r.body.code === 'TOO_LATE') { state.booking.canChange = false; manageView(); say(el.manageState, 'too_late', 'error', true); return; }
      say(el.manageState, r.status === 429 ? 'limited' : 'failed', 'error');
    });
  });

  el.move.addEventListener('click', function () {
    state.confirmCancel = false;
    state.moving = true;
    show('move');
    renderDays();
    say(el.manageState, 'move_pick', null);
    var b = el.days.querySelector('button');
    if (b) b.focus();
  });

  function moveTo(s) {
    say(el.manageState, 'sending', 'submitting');
    call('POST', { action: 'move', token: state.token, start: s.start }).then(function (r) {
      if (r.status === 200 && r.body.ok) {
        state.moving = false;
        state.booking = r.body.booking;
        show('manage');
        manageView();
        say(el.manageState, 'move_done', 'success');
        el.manage.focus();
        return;
      }
      if (r.body.code === 'TAKEN' || r.body.code === 'UNAVAILABLE') {
        loadBooking().then(function () { state.moving = true; show('move'); renderDays(); say(el.manageState, 'taken', 'error'); });
        return;
      }
      if (r.body.code === 'TOO_LATE') { state.moving = false; show('manage'); state.booking.canChange = false; manageView(); say(el.manageState, 'too_late', 'error', true); return; }
      say(el.manageState, r.status === 429 ? 'limited' : 'failed', 'error');
    });
  }

  /* ---------------------------------------------------------------- go */

  function route() {
    var m = /^#m=([A-Za-z0-9_-]{32})$/.exec(location.hash);
    if (m) {
      state.token = m[1];
      state.moving = false;
      loadBooking();
      return true;
    }
    return false;
  }
  // The "manage my booking" link on the confirmation only changes the fragment.
  window.addEventListener('hashchange', route);
  if (!route()) loadSlots();
})();

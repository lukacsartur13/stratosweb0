# Phase 9 — Workstream B: conversion event taxonomy

A provider-neutral event model, written **before** any analytics implementation
so that the measurement design is a decision rather than a by-product of a
vendor's SDK.

The model was written before a provider was chosen, and deliberately names none
in its event vocabulary — every event and parameter here can be carried by any
provider, or by none.

**Google Analytics 4 was subsequently approved as the provider** (Measurement ID
`G-JZD43PHJ41`). It is implemented *through* the adapter rather than in place of
it, so nothing in §2–§8 changed when it was adopted. §1 and §9 record what the
decision did change: consent became mandatory, and the CSP was widened. Both are
marked where they supersede the original text rather than being rewritten over
it.

---

## 1. Three constraints this model is designed around

These are not preferences. They are facts about the system as it exists today,
recorded in `phase9-baseline.md` and re-verified during Workstream A.

**1. The site set zero cookies — and that changed, deliberately.**

When this taxonomy was written the site set no cookies at all, so no consent
banner was required. **Google Analytics 4 has since been approved as the
measurement provider**, which changes that answer: GA4 sets cookies, so consent
became mandatory rather than optional.

What was kept from the original position, rather than discarded:

- **Nothing loads before consent.** Basic Consent Mode, implemented strictly:
  gtag.js is not injected at all until the visitor agrees, so a visitor who
  refuses causes no contact with Google whatsoever. This is stronger than the
  advanced mode, where the tag loads immediately and sends cookieless pings.
- **A refusal is remembered and costs nothing else.** One `localStorage` key
  holds the answer. That is the only storage a refusing visitor ever gets.
- **The events below did not change.** They were designed page-view scoped and
  cookieless, and that is why adopting a cookie-setting provider needed no
  redesign of the model — only a gate in front of it.

> Superseded: the original text here recommended staying cookieless
> indefinitely. That recommendation was overtaken by an explicit decision, and
> is recorded rather than deleted so the reasoning is not lost if the question
> is reopened.

**2. The Content-Security-Policy is `script-src 'self'` with
`connect-src 'self' https://*.supabase.co`.**
No third-party analytics could load or transmit without widening it, and
adopting GA4 meant widening it — deliberately, and narrowly. `netlify.toml`
now permits `www.googletagmanager.com` on `script-src` and the Google Analytics
endpoints on `connect-src`, and **nothing from the advertising side**: no
doubleclick host, no ad services, and no `'unsafe-inline'`. A test asserts those
absences rather than trusting them.

The events below remain provider-neutral. The adapter still has a first-party
sink behind the same interface; it is the seam that keeps the model portable,
not the production solution.

**3. The questionnaire wizard contains no `<form>` element at any step.**
Verified in a browser during Workstream A. Each step is a `div` holding one
input and one button, rendered into `#app` by `quote.<locale>.js`. Any
instrumentation that binds to `form` submit events will silently measure
nothing on the three highest-intent routes on the site.

---

## 2. Naming convention

`object_action`, lower snake_case, past-tense-free.

- The **object** comes first so events sort into families: every form event
  begins `form_`, every questionnaire event `questionnaire_`.
- No locale, route or vendor in the name. Those are parameters. An event named
  `cta_click_hu_kkv` cannot be aggregated; `cta_click` with `locale` and
  `route` parameters can.
- Names are **stable identifiers**, not labels. They never change because copy
  changed. `project_start_click` stays that even though the Hungarian button
  now reads "Projekt indítása" and used to read "Beszéljünk a projektről".

---

## 3. The events

### 3.0 Page view

| Event | When | Notes |
|---|---|---|
| `page_view` | once per document load | `locale`, `route`, `page_type` |

Emitted through `analytics.page()` rather than `analytics.track()`, because
providers treat page views as a distinct primitive and a taxonomy that sends
them as ordinary events causes double counting when a provider also auto-tracks.
The site has **no SPA router on the public side** — every route is a real
document load — so exactly one `page_view` per navigation, with no history-API
bookkeeping needed.

The three archetype-specific view events (`service_view`, `work_summary_view`,
`article_view`) fire *in addition* to `page_view`, never instead of it. They
exist to carry `service_key` / `case_status` / `article_key` without inflating
`page_view` with parameters most routes cannot supply.

### 3.1 Navigation

| Event | When | Notes |
|---|---|---|
| `navigation_open` | full-screen menu opens | |
| `navigation_close` | full-screen menu closes | |
| `navigation_click` | a link inside the menu is followed | carries `nav_target` |
| `locale_change` | a language switch is followed | carries `locale_from`, `locale_to` |
| `return_to_top` | the return-to-top affordance is used | |

### 3.2 Conversion CTAs

| Event | When | Notes |
|---|---|---|
| `cta_view` | a body CTA becomes visible | **once per CTA instance per page view** — see §5 |
| `cta_click` | any CTA is followed | the generic case |
| `project_start_click` | a CTA whose destination category is `quote` or `contact` from a start-a-project action | |
| `work_explore_click` | a CTA into Work or a case study | |
| `service_contact_click` | a service page's contact/consultation CTA | carries `service_key` |
| `impact_apply_click` | the Impact Program apply action | |

`cta_click` fires for **every** CTA. The four specific events above are fired
*in addition* for the subset they describe, so a funnel can be built either from
the generic event plus parameters or from the named ones, without double
counting conversions — because only `cta_click` is ever counted as the total.

### 3.3 Forms

Bound to the lifecycle the canonical controller already exposes. `lead.js` sets
`form.dataset.state` on every `<form data-lead>`, transitioning through
`'' → invalid | submitting → success | limited | invalid | error`. That
attribute is the instrumentation surface: it is observable without modifying the
accepted lead controller at all.

| Event | Bound to | Notes |
|---|---|---|
| `form_view` | the form scrolls into view | once per page view |
| `form_start` | first input or focus on a field | once per page view |
| `form_submit_attempt` | `data-state` → `submitting` | |
| `form_submit_success` | `data-state` → `success` | **the conversion** |
| `form_submit_error` | `data-state` → `error` or `limited` | carries `error_kind` |
| `form_validation_error` | `data-state` → `invalid` | carries `field_name` — the *name*, never the value |
| `form_abandon` | see below | conditional |

**`form_abandon` is deliberately restricted.** Measured naively it needs either
a cross-page identifier or a `beforeunload` beacon on every page, and the brief
asks for it "only where it can be measured reliably without intrusive
tracking". The honest version needs no new tracking at all: a page view where
`form_start` fired and `form_submit_success` did not **is** an abandonment, and
it is derivable at query time from events already listed. **Recommendation: do
not implement `form_abandon` as an event.** Derive it.

### 3.4 Questionnaire

The wizard has no `<form>`, so these bind to the step lifecycle in
`quote.<locale>.js`, not to submit events.

| Event | When |
|---|---|
| `questionnaire_start` | the intro's start action is used |
| `questionnaire_step_view` | a step renders — carries `step_index`, `step_key` |
| `questionnaire_step_complete` | a step is advanced past |
| `questionnaire_back` | the visitor moves backwards |
| `questionnaire_review` | the review/summary screen renders |
| `questionnaire_submit_success` | the success screen renders |
| `questionnaire_submit_error` | the error or rate-limited screen renders |

`questionnaire_step_view` plus `step_index` is the whole funnel: the drop-off
between step *n* and step *n+1* is the only number that says whether the
questionnaire is too long, which is the single most valuable measurement on the
site.

### 3.5 Content

| Event | When | Notes |
|---|---|---|
| `service_view` | a service page loads | carries `service_key` |
| `work_summary_view` | a case study loads | carries `case_status` — always `summary` today |
| `article_view` | an article loads | carries `article_key` |
| `article_progress` | reading depth crosses a threshold | **25 / 50 / 75 / 90 only** |
| `related_content_click` | a `nav.related` link is followed | carries `related_kind` |

`article_progress` fires **at most four times per page view**, each threshold at
most once, and never on a scroll handler that samples continuously. Thresholds
are crossed monotonically: scrolling back up and down again does not re-fire.

`related_content_click` matters more than it looks. Workstream A's withdrawn F2
finding proved that the site's real onward paths are plain links in
`nav.related`, not buttons — an audit that counted only buttons declared dead
ends that did not exist. If those links are not measured, the same blindness is
rebuilt in the analytics.

---

## 4. Parameters

### 4.1 Permitted

Every one of these is non-identifying and low-cardinality.

| Parameter | Values |
|---|---|
| `locale` | `hu` \| `en` \| `de` |
| `route` | the path, e.g. `/en/web-design-sme.html` |
| `page_type` | the 12 archetypes: `homepage`, `service overview`, `service detail`, `work index`, `case study`, `about`, `Impact Program`, `blog / editorial`, `article`, `contact`, `questionnaire`, `legal / utility` |
| `cta_id` | stable CTA identifier — see §4.2 |
| `cta_zone` | `chrome` \| `arrival` \| `body` |
| `cta_emphasis` | `primary` \| `secondary` |
| `cta_destination_category` | `contact` \| `quote` \| `service` \| `work` \| `case` \| `impact` \| `article` \| `legal` \| `home` \| `external` |
| `service_key` | `sme` \| `enterprise` \| `branding` \| `ads` |
| `article_key` | `post-arak`, `post-seo`, `post-cegprofil`, `post-hirdetes`, `post-elavult`, `post-konverzio` |
| `case_status` | `summary` \| `full` |
| `form_type` | `newsletter` \| `contact` \| `impact` \| `questionnaire` |
| `field_name` | a field **name**, never its value |
| `error_kind` | `network` \| `server` \| `limited` \| `invalid` |
| `step_index` | integer |
| `step_key` | the wizard's own step identifier |
| `progress_pct` | `25` \| `50` \| `75` \| `90` |
| `navigation_source` | `header` \| `menu` \| `footer` \| `body` \| `arrival` |
| `related_kind` | `service` \| `case` \| `article` \| `index` |
| `consent_state` | `granted` \| `denied` \| `not_required` |

### 4.2 `cta_id` — and why the F6 work depends on it

`cta_id` is `<zone>.<placement>.<destination-category>`, for example
`body.hero.quote`, `body.mid.contact`, `body.closing.service`,
`chrome.header.quote`, `arrival.primary.quote`.

The `placement` segment is not decoration. Workstream A added a mid-page
conversion path to 36 routes precisely because the closing band was, on mobile,
several screens out of reach. If a mid-article CTA and a closing-band CTA both
report as `cta_click` with the same destination, **the entire F6 change becomes
unmeasurable** — there is no way to ask whether the mid-page path was worth
adding. `placement` is what makes that question answerable.

### 4.3 Prohibited — never sent, under any circumstance

Sending any of these would convert a cookieless, consent-free measurement system
into one processing personal data.

- name, first or last (`vezeteknev`, `keresztnev`, `kitolto`, `kapcs`)
- email (`email`, `mail`)
- phone (`telefon`, `tel`)
- company or organisation name (`ceg`, `cegnev`, `org`)
- message and free-text content (`megjegyzes`, `mivel`, `hatas`, `miert`, `mit`, `funkciok`)
- any questionnaire **answer** — including `koltsegkeret`, `havidij`,
  `hatarido`, `konstrukcio`, `szegmens`, `weboldal`
- website URLs supplied by the visitor (`web`, `weboldal`, `weboldal_nagy`)
- IP address, in any form
- the Supabase row id
- the submission UUID (`submissionId` from `lead.js`)
- anything from the Portal
- the form payload, whole or in part
- sensitive URL query values

Note the deliberate asymmetry: `field_name` is permitted and field *value* never
is. Knowing that validation failed on `email` is a usability signal; knowing
what the email was is a data breach.

**This list is enforced by a test, not by discipline.** See §6.

---

## 5. Volume discipline

The brief asks twice for restraint, and both cases have a concrete rule:

- **`cta_view` fires once per CTA instance per page view.** Implemented with
  `IntersectionObserver` and `unobserve()` on first intersection, so a CTA
  scrolled past three times reports once. Without this a single visitor
  oscillating around the Arrival block generates unbounded events.
- **`article_progress` fires at most four times per page view**, monotonically.

Neither uses a scroll handler. Both are page-view scoped, which is what keeps
the model cookieless: nothing needs to be remembered between page loads.

---

## 6. The test that makes §4.3 real

A prohibited-field list in a document is a hope. The rule is enforced two ways,
both of which fail the build rather than warn:

1. **A payload guard in the adapter itself.** Every parameter key is checked
   against the prohibited list before dispatch; a prohibited key drops the whole
   event and reports to the console in development. Values are never inspected —
   inspecting them would mean handling them.
2. **A test that fails if a prohibited field ever reaches a payload.** Its job
   is to fail the day someone adds `email` to a form event because it seemed
   harmless in a hurry.

Both are delivered in Workstream C alongside the adapter.

---

## 7. Route → event routing

Superseding the provisional table in `phase9-conversion-map.md` §6, which was
written before the taxonomy existed.

| Archetype | Routes | Events |
|---|---|---|
| homepage | 3 | `page_view`, `cta_view`, `cta_click`, `project_start_click`, `work_explore_click` |
| service overview | 3 | `page_view`, `cta_click`, `related_content_click` |
| service detail | 12 | `service_view`, `cta_view`, `cta_click`, `service_contact_click`, `project_start_click` |
| work index | 3 | `page_view`, `cta_click`, `project_start_click`, `work_explore_click` |
| case study | 9 | `work_summary_view`, `cta_click`, `related_content_click` |
| about | 3 | `page_view`, `cta_click`, `work_explore_click` |
| Impact Program | 3 | `page_view`, `impact_apply_click`, `form_*` |
| blog / editorial | 3 | `page_view`, `cta_click`, `related_content_click` |
| article | 18 | `article_view`, `article_progress`, `cta_click`, `service_contact_click`, `related_content_click` |
| contact | 3 | `page_view`, `form_view`, `form_start`, `form_*` |
| questionnaire | 3 | `page_view`, `questionnaire_*` |
| legal / utility | 6 | `page_view` only — no conversion event |

Every route additionally emits the navigation events for the shared chrome, and
the newsletter form in the footer emits `form_*` with `form_type=newsletter`.

---

## 8. The conversion funnel this buys

The point of the taxonomy is that these four questions become answerable:

1. **Does the mid-page path work?** `cta_click` by `cta_id` placement —
   `body.mid.*` against `body.closing.*`, split by viewport. Directly measures
   the F6 change.
2. **Is the questionnaire too long?** `questionnaire_step_view` by `step_index`.
3. **Which articles sell?** `article_view` → `service_contact_click` on the same
   route, by `article_key`. Directly measures the F5 change.
4. **Where do forms fail?** `form_validation_error` by `field_name`.

None of the four requires a cookie, a cross-session identifier, or a single
personal data field.

---

## 9. Decisions taken, and what remains open

**Provider: Google Analytics 4.** Approved, with Measurement ID `G-JZD43PHJ41`.
Implemented through the adapter rather than in place of it, so the taxonomy
above is what is emitted and the model would survive a change of provider.

Constraints applied with it:

| | |
|---|---|
| Consent | Required. Basic Consent Mode — the tag is not loaded before consent. |
| Advertising | `ad_storage`, `ad_user_data` and `ad_personalization` are permanently denied; Google Signals and ad personalisation are off. |
| Host allowlist | `stratosweb.hu`, `www.stratosweb.hu`, `stratosweb1.netlify.app`. Anywhere else — a local build, a deploy preview, a fork — gets no tag, no banner and no cookies. |
| Staging separation | Only the two real domains count as production. Everything else is marked `staging`, on every event and as GA4's own `traffic_type`, so pre-cutover integration traffic never mixes with real visitors. |
| Withdrawal | From the footer, on every page. Withdrawal deletes the `_ga` cookies, not only stops new ones. |
| Personal data | Unchanged and unchangeable: the payload guard refuses every field the lead schema declares. |

**The Portal's reporting is a separate integration.** Website measurement uses
the *Measurement ID*; Portal reporting uses the numeric **Property ID
`15392224433`** with server-side credentials through the Analytics Data API.
They are deliberately not connected, and the Property ID is deliberately absent
from `_build/build.py` and from anything that reaches a browser — conflating the
two is how a server-side credential ends up in a client bundle.

### Still open

1. **The Portal's Analytics Data API integration** is not built. Only the
   separation of identifiers is settled here.
2. **Retention** in the GA4 property is a console setting, not a code one. It
   should be set to the shortest period that supports the reporting actually
   wanted, and the privacy policy should then state it.
3. **Legal review.** The rewritten HU/EN/DE privacy wording is accurate against
   observed behaviour and has not been reviewed by a lawyer. Marked in the
   source and asserted by a test; it is a launch prerequisite.
4. **Cross-page-view sessions.** GA4 does this natively now that it has a
   cookie, so the original open question is closed by the provider decision.

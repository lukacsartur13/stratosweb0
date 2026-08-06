# Phase 9 — Workstream A: conversion map

What every public route asks the visitor to do, whether it lets them do it, and
what it would take to measure it.

Sources, all regenerable:

- `scripts/conversion-audit.mjs` → `_build/reports/phase9-conversion-audit.json`
  — every CTA on all 69 pages, with placement, destination and resolution.
- `_build/reports/phase8-route-matrix.json` — archetype and declared
  primary/secondary CTA per route.
- Live measurement in a real browser at 375 × 812 for the mobile findings.

---

## 1. Method, and one distinction that changes the answer

A CTA here is what `content-inventory.mjs` already calls one — an `<a>` whose
class carries `btn`, `cta` or `button` — so the two reports cannot disagree
about what is being counted.

What this audit adds is **placement**, because the site has three quite
different kinds of CTA and averaging them hides every real problem:

| Zone | What it is | Count |
|---|---|---|
| `chrome` | Header, full-screen menu, footer. Identical on every route. | 138 |
| `arrival` | The shared Arrival section. A `<section>`, not a `<footer>` — so content inventories count it as body copy — but still the same two CTAs on every subpage. | 132 |
| `body` | The page's own CTAs. | **165** |
| | **Total** | **435** |

Only the 165 body CTAs carry page intent. A route whose entire conversion story
is `chrome` + `arrival` has no opinion of its own about what should happen next.

(435 here vs 225 in `content-baseline.json` is not a contradiction: the
inventory skips `<header>`, `<footer>` and `<nav>` wholesale, which is correct
for measuring prose and wrong for measuring conversion.)

Body CTAs rose from 111 to 165 during this workstream. That is the F1/F3/F4/F5
rewording plus the F6 mid-page conversion paths, and it is the only number in
this report that the Phase 9 edits moved deliberately.

**A second axis the first version of this audit could not see: emphasis.** The
site carries hierarchy entirely in the class — a bare `btn` is the solid
primary, `btn--ghost` is the outlined secondary — so an audit that counts
anchors can report "every page has a CTA" while a page offers two competing
primaries. The audit now records `emphasis` and the `.btn-row` each CTA sits in,
which is what makes §2's conflicting-primary result a check rather than a claim.

| Emphasis | Count |
|---|---|
| primary (solid `btn`) | 273 |
| secondary (`btn--ghost`) | 162 |

---

## 2. CTA integrity — the §5.2 scorecard

Every required result is met, and all but two are now enforced by
`npm run audit:conversion:check`, which exits non-zero on any of them.

| Required to be zero | Actual | | Enforced |
|---|---|---|---|
| Broken CTA destinations | **0** | all 435 resolve to a real file, in-page anchor or external URL | ✅ check |
| Misleading CTA wording | **0** | see §5 | judgement |
| CTAs to draft case studies | **0** | no CTA points into the nine `summary` routes at all | ✅ check |
| Conflicting primary CTAs | **0** | was 3 routes (F1), now fixed | ✅ check |
| Links to unavailable forms | **0** | every form destination reached and verified in a browser | judgement |
| Wrong-locale CTA destinations | **0** | no route sends a visitor across a language boundary | ✅ check |
| Keyboard-inaccessible CTAs | **0** | every CTA is a real `<a href>` or `<button>` | ✅ by construction |

The conflicting-primary check was written against the defect it was meant to
catch, not merely observed to pass: reintroducing the shipped F1 markup into
`dist/` makes it fail with exit 1 and name the route —

```
FAIL: 1 CTA integrity failure(s).
  conflictingPrimary: /hirdeteskezeles.html -> /ugyfelszolgalat.html (Ingyenes konzultáció / Árajánlatot kérek)
```

It fires on two solid buttons **in the same `.btn-row`** sharing a destination.
Scoping it to the row matters: the same primary repeated in the hero and again
in the closing band is reinforcement and must not be flagged, while two solid
buttons offered side by side are a choice that is not a choice.

Two of those deserve their evidence stated rather than asserted.

**In-page anchors.** Six CTAs target `#uzenet` or `#jelentkezes`. All six
targets exist. Note that the anchor id stays `#jelentkezes` on the English and
German Impact pages even though the slug is translated — a stable, locale-
invariant id, which is the right call and not a defect.

**"Links to unavailable forms".** The three questionnaire routes contain **no
`<form>` element in their static HTML**, which looks alarming in a grep and is
not. The wizard is JS-rendered into `#app` by `quote.<locale>.js`. Verified in
a browser: the intro renders, "Kezdés" advances to step 1 ("Mi a vállalkozás
neve? *"), and Enter advances to step 2. It works, and it works from the
keyboard.

It is worth recording *how* it works, because Workstreams B and C have to bind
to it: the wizard uses **no `<form>` element at any step**. Each step is a div
holding one input and one button. Event instrumentation must bind to the wizard
container and its step lifecycle, not to `form` submit events.

---

## 3. Intended action per archetype

Measured against the recommended logic in the Phase 9 brief §5.1.

Primary/secondary below is the **closing band** — the page's own last word.

| Archetype | Routes | Intent | Primary after Phase 9 | Matches §5.1 |
|---|---|---|---|---|
| homepage | 3 | orient, then start | Start a project *(arrival + header)* | ✅ primary and secondary both correct |
| service overview | 3 | choose a service or discuss scope | Discuss it → contact | ✅ secondary now explores Work |
| service detail | 12 | commit to this service | quote **or** consultation, varying by service | ✅ ads fixed — F1 |
| work index | 3 | build confidence, then start | **Start a project** → contact | ✅ F3 applied |
| case study | 9 | build confidence | Talk about your project → contact | ✅ onward path was always there — F2 withdrawn |
| about | 3 | trust, then converse | Free consultation → contact | ✅ secondary now explores Work — F4 applied |
| Impact Program | 3 | apply | Apply → `#jelentkezes` | ✅ |
| blog index | 3 | find an article | Request a quote → questionnaire | ✅ |
| article | 18 | connect topic to service | **the service the article argues for** | ✅ F5 applied |
| contact | 3 | choose enquiry depth | Fill the questionnaire / write a message | ✅ exactly the §5.1 shape |
| questionnaire | 3 | complete the brief | *(the wizard is the action)* | ✅ |
| legal / utility | 6 | inform | none in body | ✅ correctly no commercial CTA |

The variation among service-detail pages is **deliberate and should stay**: SME
leads to the questionnaire, while enterprise, branding and — after F1 — ads lead
to a consultation. Bigger and more bespoke engagements start with a
conversation, and so does advertising, because the questionnaire is a website
brief and cannot ask an advertiser the questions that matter. That is a
considered position, not an inconsistency.

---

## 4. Findings

### F1 — `/hirdeteskezeles.html` has two primaries and no alternative *(defect)*

Its primary CTA is "Árajánlat" → `arajanlat.html` and its secondary is
"Árajánlatot kérek" → `arajanlat.html`. **Same destination, near-identical
wording.** The visitor is offered a choice that is not a choice, and the page is
the only service detail with no second path — §5.1 asks for "explore relevant
work or another service".

Affects `/hirdeteskezeles.html`, `/en/ads-management.html`, `/de/werbeanzeigen.html`.

This is the only genuine breach of "conflicting primary CTAs: 0".

**Fixed.** The hero primary is now "Ingyenes konzultáció" → contact, and the
closing secondary is "Megnézem a szolgáltatásokat" → services.

The wording change is the substantive half. `arajanlat.html` is the **website**
brief: it asks about menu structure, webshop integrations, domain and hosting.
It never asks what an advertiser has to be asked — which channels, what monthly
budget, what the campaign is for. A button labelled "Árajánlat" on the ads page
promised a quote and delivered a questionnaire about a website. The closing band
already led with a consultation; the top of the page now agrees with it.

### F2 — case studies dead-end — ~~defect~~ **WITHDRAWN, this was wrong**

The first version of this finding said the nine case studies offer no way
onward and that a visitor "has nowhere to go but the browser's back button".
That is false, and it was false because the check that produced it only counted
elements classed `btn`/`cta`/`button`.

Every case study — and every article — carries a `<nav class="related">` with
**exactly three onward links**. On `munka-rapidkert.html` those are the relevant
service, the next project, and "Összes munkánk" back to the Work index. Verified
on all nine case routes and all six article sources.

So the structure is sound and no fix is required. What is true is the much
weaker claim that these routes carry only one CTA-*weight* action — which is the
same emphasis question as F5, not a dead end.

Recorded rather than deleted, because the failure mode is worth keeping: an
audit that defines a CTA by its class will call every plain link invisible, and
will then confidently report dead ends that do not exist.

### F3 — Work index primary points at contact, not at starting a project

§5.1 recommends Work → primary "Start a project", secondary "inspect project
summaries". Today it is primary → contact, secondary → services. The project
summaries are on the page, so the secondary intent is served by content; the
primary is a defensible alternative reading rather than an error.

**Applied.** Primary is now "Projekt indítása", secondary "Megnézem a
projekteket" → `#projektek`.

Two deliberate choices inside that. The primary still lands on **contact, not
the questionnaire**: contact is the page that offers the choice between a short
enquiry and the detailed brief, and sending someone straight into an
eight-minute wizard makes that choice for them. And the anchor id `#projektek`
is **locale-invariant**, the same decision already taken for `#jelentkezes` on
Impact — the slug around it is translated, the anchor is not, so one closing CTA
serves all three languages without a per-locale table.

### F4 — About offers two conversions and no exploration

Primary → contact, secondary → questionnaire. §5.1 wants the secondary to be
"explore capabilities or Work". Both current CTAs are conversion actions, so a
visitor not yet ready has no lateral path.

Compounded by depth: About's first body CTA is at **0.851** — the deepest on
the site.

**Applied.** The secondary is now "Megnézem a munkáinkat" → Work. A visitor who
has just read the company's story was being asked to pick between two ways of
committing; the honest lateral path there is the work itself. The depth half of
this finding is fixed under F6.

### F5 — articles reach contact but not the service *(18 routes)*

§5.1 asks an article's primary to "connect the topic to a relevant Stratos
service". The single body CTA goes to contact instead.

The connection does exist — each article carries a related-content link to a
service (`blog-weboldal-arak.html` → `kkv.html`) and to another article — but as
a plain link, not a CTA. So the intent is implemented at the wrong prominence
rather than missing.

**Applied, as a promotion rather than an addition.** The closing primary is now
the service the article argues for — `blog-weboldal-arak.html` → "Weboldal
KKV-nak", `blog-google-cegprofil.html` → "Hirdetéskezelés" — and the previous
"Kérdésem van erről" → contact is kept as the ghost secondary. Nothing was
removed; the two paths now differ in emphasis instead of one being invisible.

An article that spends two thousand words explaining a problem and then offers
only "ask us about it" makes the reader do the translation from topic to offer
themselves.

### F6 — mobile: the header CTA is hidden, and body CTAs are very deep *(defect)*

Measured at 375 × 812.

The persistent header CTA (`.nav__cta`) is **not visible at mobile width** — it
collapses into the burger. So on mobile there is no always-available conversion
path, and everything depends on in-page CTAs.

On `/kkv.html` that is survivable: the first CTA sits at 545 px, inside the
first viewport. Then nothing until 7772 px — a **7,200 px gap with no way to
convert**.

On a blog article it is worse:

| | |
|---|---|
| Document height | 7,261 px — **8.9 screens** |
| First CTA | 5,019 px — **screen 7.2**, 69% down |

A mobile reader scrolls seven screens before being offered anything. This is
the clearest instance of the brief's "whether the CTA appears before excessive
scroll depth", and it is a real conversion defect rather than a stylistic one.

**Fixed, and re-measured in a browser rather than inferred.**

The premise was re-verified before acting on it, because the header *does* show
a visible "Árajánlat" button at 375 px. It is not sticky: scrolling to 15% of
any long page leaves nothing on screen at all. So the finding stands — once a
mobile visitor starts reading, the header CTA is gone.

The fix is one quiet mid-page block per long route, built from the **existing**
`band band--tight` + `launch launch--quiet` primitives on service and index
pages, and the existing `article__aside` primitive inside articles, with a
single ghost button. No new component, nothing sticky, no popup, no change to
Phase 8.5 motion.

Measured at 375 × 812 against the built `dist/`, before and after:

| Route | Screens | First CTA before | First CTA after | Worst CTA-only gap after |
|---|---|---|---|---|
| `/rolunk.html` | 14.2 | screen **10.9** | screen **4.6** | 6.6 |
| `/munkaink.html` | 9.2 | screen 5.9 | screen **3.8** | 3.8 |
| `/blog-weboldal-arak.html` | 9.3 | screen **7.2** | screen **3.4** | 3.4 |
| `/en/blog-website-cost.html` | 9.5 | screen 7.2 | screen **3.6** | 3.6 |
| `/kkv.html` | 12.8 | screen 0.7 | screen 0.7 | 5.4 |
| `/hirdeteskezeles.html` | 14.5 | screen 0.7 | screen 0.7 | 6.2 |

About and Work were the two routes the first pass missed, and About was the
worst on the whole site — nothing to act on for eleven screens.

### The residual gaps are smaller than that table makes them look

The "worst gap" column counts only `btn`-classed CTAs, which is the same
mistake that produced the withdrawn F2. Counting **every** onward link in the
body, the middle of each residual stretch is already served: the FAQ's "Írj
nekünk" → contact sits at screen 8.9 on About, 8.7 on ads and 7.0 on `/kkv.html`,
and the related-content links follow immediately after.

One genuine stretch remains: `/hirdeteskezeles.html` between screen 0.7 and 6.9
has no onward link of any kind. It is the longest page on the site at 14.5
screens, and it is left as it is deliberately — the alternative is a third CTA
inside a section that reads as one continuous argument, and the brief is
explicit that Phase 9 must not add intrusive conversion furniture to accepted
art direction. Recorded here as an accepted trade-off, not an oversight.

### F7 — questionnaire routes are thin and carry no breadcrumb *(SEO note)*

Because the wizard is JS-rendered, the three highest-intent routes serve 77–92
indexable words and are the only three routes without a breadcrumb. Fine for
users — the no-JS fallback gives an H1, an explanation and a link to contact —
but it means the pages most worth ranking have the least for a crawler to read.
Carried into Workstream D.

### F8 — focus is not moved on questionnaire step change *(accessibility, minor)*

After Enter advances the wizard, `document.activeElement` is `body`. `#app`
carries `aria-live="polite"`, so the new step is announced, but keyboard focus
is left behind and a keyboard user must tab back in.

Recorded as a candidate. It touches Phase 8.5 questionnaire motion, so I have
not changed it unilaterally.

---

## 5. Public pricing position — §5.3 upheld

**0 price-pattern hits** across all 69 pages: no `Ft`, `HUF`, `EUR`, `€`, `$`,
`USD` figure, no "ártól", no "from €", no "ab €" anywhere in body copy.

One thing that looks like pricing and is not: the menu and service panels show
figures like `9 400 M`, `17 000 M`, `30 000 M`. These are **altitudes in
metres** — the Altimeter/Meridian system — confirmed by the literal string
`MÉTER` in the same markup. No change needed, but worth writing down so a future
audit does not "fix" it.

The questionnaire does ask for a budget range (`koltsegkeret`, `havidij`). That
is a private form field, not a public price, and is consistent with "tailored
proposal after consultation".

---

## 6. Recommended measurement events per route

The taxonomy itself is Workstream B; this is the routing of it. No event carries
any field named in the brief's prohibited list.

| Archetype | Routes | Events to fire | Parameters |
|---|---|---|---|
| homepage | 3 | `cta_view`, `project_start_click`, `work_explore_click` | `locale`, `route`, `cta_id` |
| service overview | 3 | `service_view`, `cta_click`, `related_content_click` | `locale`, `route`, `cta_id` |
| service detail | 12 | `service_view`, `service_contact_click`, `project_start_click` | `locale`, `route`, `service_key`, `cta_id` |
| work index | 3 | `work_explore_click`, `project_start_click` | `locale`, `route`, `cta_id` |
| case study | 9 | `work_summary_view`, `related_content_click`, `cta_click` | `locale`, `route`, `case_status` (=`summary`) |
| about | 3 | `cta_click`, `project_start_click` | `locale`, `route`, `cta_id` |
| Impact Program | 3 | `impact_apply_click`, `form_view`, `form_submit_*` | `locale`, `form_type` (=`impact`) |
| blog / editorial | 3 | `article_view`, `related_content_click` | `locale`, `route` |
| article | 18 | `article_view`, `article_progress` (25/50/75/90), `related_content_click` | `locale`, `route`, `article_key`, `progress_pct` |
| contact | 3 | `form_view`, `form_start`, `form_validation_error`, `form_submit_*` | `locale`, `form_type` |
| questionnaire | 3 | `questionnaire_start`, `questionnaire_step_view`, `questionnaire_step_complete`, `questionnaire_back`, `questionnaire_review`, `questionnaire_submit_*` | `locale`, `step_index`, `agazat` |
| legal / utility | 6 | page view only — no conversion event | `locale`, `route` |

---

## 7. Full route table

Generated from `phase9-conversion-audit.json`, post-fix. "Primary/secondary
(closing)" is the last `.btn-row` the page's own body offers — its final word,
excluding the shared Arrival block. Depth is the markup-order proxy, not pixels;
the pixel measurements are in F6.

| Route | Loc | Archetype | Primary (closing) | Secondary (closing) | Body | 1st body depth |
|---|---|---|---|---|---|---|
| `/adatkezelesi-tajekoztato.html` | hu | legal / utility | — | — | 0 | — |
| `/arajanlat.html` | hu | questionnaire | — | — | 0 | — |
| `/blog-elavult-weboldal.html` | hu | article | Weboldal KKV-nak → `kkv.html` | Kérdésem van erről → `ugyfelszolgalat.html` | 3 | 0.569 |
| `/blog-google-cegprofil.html` | hu | article | Hirdetéskezelés → `hirdeteskezeles.html` | Kérdésem van erről → `ugyfelszolgalat.html` | 3 | 0.554 |
| `/blog-google-elso-oldal.html` | hu | article | Weboldal KKV-nak → `kkv.html` | Kérdésem van erről → `ugyfelszolgalat.html` | 3 | 0.571 |
| `/blog-google-vagy-facebook.html` | hu | article | Hirdetéskezelés → `hirdeteskezeles.html` | Kérdésem van erről → `ugyfelszolgalat.html` | 3 | 0.554 |
| `/blog-miert-nem-hoz-ugyfelet.html` | hu | article | Weboldal KKV-nak → `kkv.html` | Kérdésem van erről → `ugyfelszolgalat.html` | 3 | 0.559 |
| `/blog-weboldal-arak.html` | hu | article | Weboldal KKV-nak → `kkv.html` | Kérdésem van erről → `ugyfelszolgalat.html` | 3 | 0.557 |
| `/blog.html` | hu | blog / editorial | Árajánlatot kérek → `arajanlat.html` | Kérdésem van → `ugyfelszolgalat.html` | 2 | 0.732 |
| `/branding.html` | hu | service detail | Konzultációt kérek → `ugyfelszolgalat.html` | Árajánlatot kérek → `arajanlat.html` | 4 | 0.356 |
| `/de/angebot.html` | de | questionnaire | — | — | 0 | — |
| `/de/blog-google-erste-seite.html` | de | article | Website für KMU → `webdesign-kmu.html` | Ich habe dazu eine Frage → `kontakt.html` | 3 | 0.566 |
| `/de/blog-google-oder-facebook.html` | de | article | Werbebetreuung → `werbeanzeigen.html` | Ich habe dazu eine Frage → `kontakt.html` | 3 | 0.555 |
| `/de/blog-google-unternehmensprofil.html` | de | article | Werbebetreuung → `werbeanzeigen.html` | Ich habe dazu eine Frage → `kontakt.html` | 3 | 0.552 |
| `/de/blog-keine-anfragen.html` | de | article | Website für KMU → `webdesign-kmu.html` | Ich habe dazu eine Frage → `kontakt.html` | 3 | 0.562 |
| `/de/blog-veraltete-website.html` | de | article | Website für KMU → `webdesign-kmu.html` | Ich habe dazu eine Frage → `kontakt.html` | 3 | 0.564 |
| `/de/blog-website-kosten.html` | de | article | Website für KMU → `webdesign-kmu.html` | Ich habe dazu eine Frage → `kontakt.html` | 3 | 0.555 |
| `/de/blog.html` | de | blog / editorial | Angebot anfordern → `angebot.html` | Ich habe eine Frage → `kontakt.html` | 2 | 0.73 |
| `/de/branding.html` | de | service detail | Beratung anfragen → `kontakt.html` | Angebot anfordern → `angebot.html` | 4 | 0.348 |
| `/de/datenschutz.html` | de | legal / utility | — | — | 0 | — |
| `/de/impact-programm.html` | de | Impact Program | Jetzt bewerben → `#jelentkezes` | — | 1 | 0.275 |
| `/de/impressum.html` | de | legal / utility | — | — | 0 | — |
| `/de/index.html` | de | homepage | — | — | 0 | — |
| `/de/kontakt.html` | de | contact | Fragebogen ausfüllen → `angebot.html` | Nachricht schreiben → `#uzenet` | 2 | 0.46 |
| `/de/leistungen.html` | de | service overview | Sprechen wir darüber → `kontakt.html` | Erst eure Projekte ansehen → `projekte.html` | 7 | 0.461 |
| `/de/projekt-barbershop.html` | de | case study | Sprechen wir über dein Projekt → `kontakt.html` | — | 1 | 0.72 |
| `/de/projekt-mentaltrening.html` | de | case study | Sprechen wir über dein Projekt → `kontakt.html` | — | 1 | 0.718 |
| `/de/projekt-rapidkert.html` | de | case study | Sprechen wir über dein Projekt → `kontakt.html` | — | 1 | 0.726 |
| `/de/projekte.html` | de | work index | Projekt starten → `kontakt.html` | Die Projekte ansehen → `#projektek` | 3 | 0.596 |
| `/de/ueber-uns.html` | de | about | Kostenlose Beratung → `kontakt.html` | Unsere Arbeiten ansehen → `projekte.html` | 3 | 0.363 |
| `/de/webdesign-grossunternehmen.html` | de | service detail | Gespräch vereinbaren → `kontakt.html` | Angebot anfragen → `angebot.html` | 4 | 0.303 |
| `/de/webdesign-kmu.html` | de | service detail | Fragebogen ausfüllen → `angebot.html` | Erst eine Frage stellen → `kontakt.html` | 4 | 0.292 |
| `/de/werbeanzeigen.html` | de | service detail | Kostenlose Beratung → `kontakt.html` | Leistungen ansehen → `leistungen.html` | 4 | 0.309 |
| `/en/about.html` | en | about | Free consultation → `contact.html` | See our work → `work.html` | 3 | 0.361 |
| `/en/ads-management.html` | en | service detail | Free consultation → `contact.html` | See the services → `services.html` | 4 | 0.312 |
| `/en/blog-google-business-profile.html` | en | article | Ads management → `ads-management.html` | I have a question about this → `contact.html` | 3 | 0.552 |
| `/en/blog-google-first-page.html` | en | article | A website for SMEs → `web-design-sme.html` | I have a question about this → `contact.html` | 3 | 0.567 |
| `/en/blog-google-or-facebook.html` | en | article | Ads management → `ads-management.html` | I have a question about this → `contact.html` | 3 | 0.555 |
| `/en/blog-no-enquiries.html` | en | article | A website for SMEs → `web-design-sme.html` | I have a question about this → `contact.html` | 3 | 0.561 |
| `/en/blog-outdated-website.html` | en | article | A website for SMEs → `web-design-sme.html` | I have a question about this → `contact.html` | 3 | 0.565 |
| `/en/blog-website-cost.html` | en | article | A website for SMEs → `web-design-sme.html` | I have a question about this → `contact.html` | 3 | 0.558 |
| `/en/blog.html` | en | blog / editorial | Get a quote → `quote.html` | I have a question → `contact.html` | 2 | 0.73 |
| `/en/branding.html` | en | service detail | Book a consultation → `contact.html` | Get a quote → `quote.html` | 4 | 0.352 |
| `/en/contact.html` | en | contact | Fill in the questionnaire → `quote.html` | Write a message → `#uzenet` | 2 | 0.463 |
| `/en/impact-program.html` | en | Impact Program | Apply now → `#jelentkezes` | — | 1 | 0.277 |
| `/en/imprint.html` | en | legal / utility | — | — | 0 | — |
| `/en/index.html` | en | homepage | — | — | 0 | — |
| `/en/privacy-policy.html` | en | legal / utility | — | — | 0 | — |
| `/en/quote.html` | en | questionnaire | — | — | 0 | — |
| `/en/services.html` | en | service overview | Let's talk about it → `contact.html` | Show me your work first → `work.html` | 7 | 0.463 |
| `/en/web-design-enterprise.html` | en | service detail | Book a call → `contact.html` | Request a quote → `quote.html` | 4 | 0.304 |
| `/en/web-design-sme.html` | en | service detail | Fill in the questionnaire → `quote.html` | I'd rather ask first → `contact.html` | 4 | 0.295 |
| `/en/work-barbershop.html` | en | case study | Let's talk about your project → `contact.html` | — | 1 | 0.717 |
| `/en/work-mentaltrening.html` | en | case study | Let's talk about your project → `contact.html` | — | 1 | 0.717 |
| `/en/work-rapidkert.html` | en | case study | Let's talk about your project → `contact.html` | — | 1 | 0.725 |
| `/en/work.html` | en | work index | Start a project → `contact.html` | View the projects → `#projektek` | 3 | 0.594 |
| `/hirdeteskezeles.html` | hu | service detail | Ingyenes konzultáció → `ugyfelszolgalat.html` | Megnézem a szolgáltatásokat → `szolgaltatasok.html` | 4 | 0.311 |
| `/impact-program.html` | hu | Impact Program | Jelentkezem → `#jelentkezes` | — | 1 | 0.276 |
| `/impresszum.html` | hu | legal / utility | — | — | 0 | — |
| `/index.html` | hu | homepage | — | — | 0 | — |
| `/kkv.html` | hu | service detail | Kitöltöm a kérdőívet → `arajanlat.html` | Előbb kérdeznék → `ugyfelszolgalat.html` | 4 | 0.292 |
| `/munka-barbershop.html` | hu | case study | Beszéljünk a projektedről → `ugyfelszolgalat.html` | — | 1 | 0.723 |
| `/munka-mentaltrening.html` | hu | case study | Beszéljünk a projektedről → `ugyfelszolgalat.html` | — | 1 | 0.722 |
| `/munka-rapidkert.html` | hu | case study | Beszéljünk a projektedről → `ugyfelszolgalat.html` | — | 1 | 0.73 |
| `/munkaink.html` | hu | work index | Projekt indítása → `ugyfelszolgalat.html` | Megnézem a projekteket → `#projektek` | 3 | 0.595 |
| `/nagyvallalat.html` | hu | service detail | Egyeztetést kérek → `ugyfelszolgalat.html` | Árajánlat kérése → `arajanlat.html` | 4 | 0.305 |
| `/rolunk.html` | hu | about | Ingyenes konzultáció → `ugyfelszolgalat.html` | Megnézem a munkáinkat → `munkaink.html` | 3 | 0.364 |
| `/szolgaltatasok.html` | hu | service overview | Beszéljünk róla → `ugyfelszolgalat.html` | Előbb megnézem a munkáinkat → `munkaink.html` | 7 | 0.465 |
| `/ugyfelszolgalat.html` | hu | contact | Kitöltöm az igényfelmérőt → `arajanlat.html` | Írok egy üzenetet → `#uzenet` | 2 | 0.463 |

---

## 8. What Workstream A hands to the rest of Phase 9

**Applied in this workstream.** All five actionable findings are closed; each
edit is described in §4 with its reasoning, and the resulting state is in the
§7 table.

| | What changed | Routes |
|---|---|---|
| F1 | ads page: hero primary → consultation, closing secondary → services | 3 |
| F3 | Work index: primary → "Start a project", secondary → `#projektek` | 3 |
| F4 | About: secondary → Work instead of a second conversion | 3 |
| F5 | articles: closing primary → the service the article argues for; contact kept as ghost secondary | 18 |
| F6 | one quiet mid-page conversion path on long routes | 36 |

F6's 36 routes, counted in built `dist/` and excluding iCloud `" 2.html"`
duplicates: **18 articles** using the `article__aside` primitive, and **18
non-article routes** — the four service details, About and Work index, across
three locales — using `band band--tight` + `launch launch--quiet`. Every one of
them uses a primitive that already existed.

F2 was **withdrawn as wrong**, not fixed — see §4.

**Verified after the edits:**

- `npm run audit:conversion:check` — 435 CTAs, 0 integrity failures, and the
  new conflicting-primary check proven to fail on the defect it guards.
- `npx playwright test` — **545 passed, 40 skipped, 0 failed**.
- Mobile re-measured in a browser at 375 × 812, before and after (§4, F6).
- `python3 _build/build.py` is idempotent against the committed sources: the
  Hungarian sources, the two new `_common.json` strings and the generated
  `en/` and `de/` output are consistent.

**Still open, and deliberately not decided here:**

- `/hirdeteskezeles.html` keeps one 6.2-screen stretch with no onward link. The
  reasoning for leaving it is in §4, F6.

**Carried to other workstreams:**

- **F7** → Workstream D. Thin, breadcrumb-less questionnaire routes.
- **F8** → accessibility candidate; touches accepted Phase 8.5 motion, so it is
  still unmade.
- The wizard's **absence of any `<form>` element** → Workstreams B and C must
  bind to the step lifecycle, not to submit events.
- The new mid-page CTAs are a distinct measurement surface from the closing
  band: Workstream B should give them their own `cta_id` so a mid-article
  conversion is distinguishable from a closing-band one. Without that the whole
  F6 change becomes unmeasurable.

**Confirmed sound, no action:**

- All CTA destinations resolve, in every locale.
- No CTA promises a full case study.
- No public fixed pricing anywhere.
- Contact's two-path structure already matches §5.1 exactly.
- Legal pages carry no commercial CTA, as intended.
- The case studies' three-link `<nav class="related">` onward path.

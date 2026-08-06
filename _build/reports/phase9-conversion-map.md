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
| `chrome` | Sticky header, full-screen menu, footer. Identical on every route. | 138 |
| `arrival` | The shared Arrival section. A `<section>`, not a `<footer>` — so content inventories count it as body copy — but still the same two CTAs on every subpage. | 132 |
| `body` | The page's own CTAs. | **111** |
| | **Total** | **381** |

Only the 111 body CTAs carry page intent. A route whose entire conversion story
is `chrome` + `arrival` has no opinion of its own about what should happen next.

(381 here vs 225 in `content-baseline.json` is not a contradiction: the
inventory skips `<header>`, `<footer>` and `<nav>` wholesale, which is correct
for measuring prose and wrong for measuring conversion.)

---

## 2. CTA integrity — the §5.2 scorecard

Every required result is met.

| Required to be zero | Actual | |
|---|---|---|
| Broken CTA destinations | **0** | all 381 resolve to a real file, in-page anchor or external URL |
| Misleading CTA wording | **0** | see §5 |
| CTAs to draft case studies | **0** | no CTA points into the nine `summary` routes at all |
| Conflicting primary CTAs | **1** | `/hirdeteskezeles.html` and its two locale siblings — see finding F1 |
| Links to unavailable forms | **0** | every form destination reached and verified in a browser |
| Wrong-locale CTA destinations | **0** | no route sends a visitor across a language boundary |
| Keyboard-inaccessible CTAs | **0** | every CTA is a real `<a href>` or `<button>` |

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

| Archetype | Routes | Intent | Primary today | Matches §5.1 |
|---|---|---|---|---|
| homepage | 3 | orient, then start | Start a project *(arrival + header)* | ✅ primary and secondary both correct |
| service overview | 3 | choose a service or discuss scope | Discuss it → contact | ✅ four service-detail CTAs serve the secondary |
| service detail | 12 | commit to this service | quote **or** consultation, varying by service | ✅ except ads — F1 |
| work index | 3 | build confidence, then start | Talk about the project → contact | ⚠️ F3 |
| case study | 9 | build confidence | Talk about your project → contact | ⚠️ F2 — no onward path |
| about | 3 | trust, then converse | Free consultation → contact | ⚠️ F4 — secondary is a second conversion, not exploration |
| Impact Program | 3 | apply | Apply → `#jelentkezes` | ✅ |
| blog index | 3 | find an article | Request a quote → questionnaire | ✅ |
| article | 18 | connect topic to service | I have a question → contact | ⚠️ F5 |
| contact | 3 | choose enquiry depth | Fill the questionnaire / write a message | ✅ exactly the §5.1 shape |
| questionnaire | 3 | complete the brief | *(the wizard is the action)* | ✅ |
| legal / utility | 6 | inform | none in body | ✅ correctly no commercial CTA |

The variation among service-detail pages is **deliberate and should stay**:
SME and ads lead to the questionnaire, enterprise and branding lead to a
consultation. Bigger and more bespoke engagements start with a conversation.
That is a considered position, not an inconsistency.

---

## 4. Findings

### F1 — `/hirdeteskezeles.html` has two primaries and no alternative *(defect)*

Its primary CTA is "Árajánlat" → `arajanlat.html` and its secondary is
"Árajánlatot kérek" → `arajanlat.html`. **Same destination, near-identical
wording.** The visitor is offered a choice that is not a choice, and the page is
the only service detail with no second path — §5.1 asks for "explore relevant
work or another service".

Affects `/hirdeteskezeles.html`, `/en/ads-management.html`, `/de/werbung.html`.

This is the only genuine breach of "conflicting primary CTAs: 0".

### F2 — case studies dead-end *(defect, 9 routes)*

Each of the nine case-study routes has exactly one body CTA, to contact, at
~72% depth. There is no link onward to another project, back to the Work index,
or to the relevant service. A visitor who reads a project and is not ready to
contact has nowhere to go but the browser's back button.

This is the highest dead-end risk on the site, and it sits on the routes doing
the most persuasive work.

### F3 — Work index primary points at contact, not at starting a project

§5.1 recommends Work → primary "Start a project", secondary "inspect project
summaries". Today it is primary → contact, secondary → services. The project
summaries are on the page, so the secondary intent is served by content; the
primary is a defensible alternative reading rather than an error. **Flagging,
not fixing, without your call.**

### F4 — About offers two conversions and no exploration

Primary → contact, secondary → questionnaire. §5.1 wants the secondary to be
"explore capabilities or Work". Both current CTAs are conversion actions, so a
visitor not yet ready has no lateral path.

Compounded by depth: About's first body CTA is at **0.851** — the deepest on
the site.

### F5 — articles reach contact but not the service *(18 routes)*

§5.1 asks an article's primary to "connect the topic to a relevant Stratos
service". The single body CTA goes to contact instead.

The connection does exist — each article carries a related-content link to a
service (`blog-weboldal-arak.html` → `kkv.html`) and to another article — but as
a plain link, not a CTA. So the intent is implemented at the wrong prominence
rather than missing.

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

| Route | Loc | Archetype | Primary CTA → dest | Secondary CTA → dest | Body CTAs | 1st body CTA depth | Form |
|---|---|---|---|---|---|---|---|
| `/adatkezelesi-tajekoztato.html` | hu | legal / utility | — | — | 0 | — | — |
| `/arajanlat.html` | hu | questionnaire | — | — | 0 | — | wizard (JS) |
| `/blog-elavult-weboldal.html` | hu | article | Kérdésem van erről → `ugyfelszolgalat.html` | — | 1 | 0.707 | — |
| `/blog-google-cegprofil.html` | hu | article | Kérdésem van erről → `ugyfelszolgalat.html` | — | 1 | 0.711 | — |
| `/blog-google-elso-oldal.html` | hu | article | Kérdésem van erről → `ugyfelszolgalat.html` | — | 1 | 0.716 | — |
| `/blog-google-vagy-facebook.html` | hu | article | Kérdésem van erről → `ugyfelszolgalat.html` | — | 1 | 0.702 | — |
| `/blog-miert-nem-hoz-ugyfelet.html` | hu | article | Kérdésem van erről → `ugyfelszolgalat.html` | — | 1 | 0.704 | — |
| `/blog-weboldal-arak.html` | hu | article | Kérdésem van erről → `ugyfelszolgalat.html` | — | 1 | 0.713 | — |
| `/blog.html` | hu | blog / editorial | Árajánlatot kérek → `arajanlat.html` | Kérdésem van → `ugyfelszolgalat.html` | 2 | 0.732 | yes |
| `/branding.html` | hu | service detail | Konzultáció → `ugyfelszolgalat.html` | Árajánlatot kérek → `arajanlat.html` | 3 | 0.367 | — |
| `/de/angebot.html` | de | questionnaire | — | — | 0 | — | wizard (JS) |
| `/de/blog-google-erste-seite.html` | de | article | Ich habe dazu eine Frage → `kontakt.html` | — | 1 | 0.711 | — |
| `/de/blog-google-oder-facebook.html` | de | article | Ich habe dazu eine Frage → `kontakt.html` | — | 1 | 0.698 | — |
| `/de/blog-google-unternehmensprofil.html` | de | article | Ich habe dazu eine Frage → `kontakt.html` | — | 1 | 0.708 | — |
| `/de/blog-keine-anfragen.html` | de | article | Ich habe dazu eine Frage → `kontakt.html` | — | 1 | 0.701 | — |
| `/de/blog-veraltete-website.html` | de | article | Ich habe dazu eine Frage → `kontakt.html` | — | 1 | 0.702 | — |
| `/de/blog-website-kosten.html` | de | article | Ich habe dazu eine Frage → `kontakt.html` | — | 1 | 0.709 | — |
| `/de/blog.html` | de | blog / editorial | Angebot anfordern → `angebot.html` | Ich habe eine Frage → `kontakt.html` | 2 | 0.73 | yes |
| `/de/branding.html` | de | service detail | Beratung → `kontakt.html` | Angebot anfordern → `angebot.html` | 3 | 0.359 | — |
| `/de/datenschutz.html` | de | legal / utility | — | — | 0 | — | — |
| `/de/impact-programm.html` | de | Impact Program | Jetzt bewerben → `#jelentkezes` | — | 1 | 0.276 | yes |
| `/de/impressum.html` | de | legal / utility | — | — | 0 | — | — |
| `/de/index.html` | de | homepage | Projekt indítása → `quote` *(arrival)* | Kiemelt munkáink → `work` *(arrival)* | 0 | — | — |
| `/de/kontakt.html` | de | contact | Fragebogen ausfüllen → `angebot.html` | Nachricht schreiben → `#uzenet` | 2 | 0.461 | yes |
| `/de/leistungen.html` | de | service overview | Sprechen wir darüber → `kontakt.html` | Impact-Programm ansehen → `impact-programm.html` | 7 | 0.461 | — |
| `/de/projekt-barbershop.html` | de | case study | Sprechen wir über dein Projekt → `kontakt.html` | — | 1 | 0.719 | — |
| `/de/projekt-mentaltrening.html` | de | case study | Sprechen wir über dein Projekt → `kontakt.html` | — | 1 | 0.718 | — |
| `/de/projekt-rapidkert.html` | de | case study | Sprechen wir über dein Projekt → `kontakt.html` | — | 1 | 0.726 | — |
| `/de/projekte.html` | de | work index | Sprechen wir über das Projekt → `kontakt.html` | Leistungen ansehen → `leistungen.html` | 2 | 0.727 | — |
| `/de/ueber-uns.html` | de | about | Kostenlose Beratung → `kontakt.html` | Angebot anfordern → `angebot.html` | 2 | 0.848 | — |
| `/de/webdesign-grossunternehmen.html` | de | service detail | Gespräch vereinbaren → `kontakt.html` | Angebot anfragen → `angebot.html` | 3 | 0.311 | — |
| `/de/webdesign-kmu.html` | de | service detail | Angebot anfragen → `angebot.html` | Erst eine Frage stellen → `kontakt.html` | 3 | 0.3 | — |
| `/de/werbeanzeigen.html` | de | service detail | Angebot → `angebot.html` | Angebot anfordern → `angebot.html` | 3 | 0.305 | — |
| `/en/about.html` | en | about | Free consultation → `contact.html` | Get a quote → `quote.html` | 2 | 0.849 | — |
| `/en/ads-management.html` | en | service detail | Get a quote → `quote.html` | Get a quote → `quote.html` | 3 | 0.308 | — |
| `/en/blog-google-business-profile.html` | en | article | I have a question about this → `contact.html` | — | 1 | 0.704 | — |
| `/en/blog-google-first-page.html` | en | article | I have a question about this → `contact.html` | — | 1 | 0.707 | — |
| `/en/blog-google-or-facebook.html` | en | article | I have a question about this → `contact.html` | — | 1 | 0.697 | — |
| `/en/blog-no-enquiries.html` | en | article | I have a question about this → `contact.html` | — | 1 | 0.696 | — |
| `/en/blog-outdated-website.html` | en | article | I have a question about this → `contact.html` | — | 1 | 0.701 | — |
| `/en/blog-website-cost.html` | en | article | I have a question about this → `contact.html` | — | 1 | 0.708 | — |
| `/en/blog.html` | en | blog / editorial | Get a quote → `quote.html` | I have a question → `contact.html` | 2 | 0.73 | yes |
| `/en/branding.html` | en | service detail | Consultation → `contact.html` | Get a quote → `quote.html` | 3 | 0.363 | — |
| `/en/contact.html` | en | contact | Fill in the questionnaire → `quote.html` | Write a message → `#uzenet` | 2 | 0.463 | yes |
| `/en/impact-program.html` | en | Impact Program | Apply now → `#jelentkezes` | — | 1 | 0.278 | yes |
| `/en/imprint.html` | en | legal / utility | — | — | 0 | — | — |
| `/en/index.html` | en | homepage | Projekt indítása → `quote` *(arrival)* | Kiemelt munkáink → `work` *(arrival)* | 0 | — | — |
| `/en/privacy-policy.html` | en | legal / utility | — | — | 0 | — | — |
| `/en/quote.html` | en | questionnaire | — | — | 0 | — | wizard (JS) |
| `/en/services.html` | en | service overview | Let's talk about it → `contact.html` | See the Impact Program → `impact-program.html` | 7 | 0.463 | — |
| `/en/web-design-enterprise.html` | en | service detail | Book a call → `contact.html` | Request a quote → `quote.html` | 3 | 0.313 | — |
| `/en/web-design-sme.html` | en | service detail | Request a quote → `quote.html` | I'd rather ask first → `contact.html` | 3 | 0.303 | — |
| `/en/work-barbershop.html` | en | case study | Let's talk about your project → `contact.html` | — | 1 | 0.716 | — |
| `/en/work-mentaltrening.html` | en | case study | Let's talk about your project → `contact.html` | — | 1 | 0.716 | — |
| `/en/work-rapidkert.html` | en | case study | Let's talk about your project → `contact.html` | — | 1 | 0.725 | — |
| `/en/work.html` | en | work index | Let's talk about the project → `contact.html` | See the services → `services.html` | 2 | 0.725 | — |
| `/hirdeteskezeles.html` | hu | service detail | Árajánlat → `arajanlat.html` | Árajánlatot kérek → `arajanlat.html` | 3 | 0.307 | — |
| `/impact-program.html` | hu | Impact Program | Jelentkezem → `#jelentkezes` | — | 1 | 0.277 | yes |
| `/impresszum.html` | hu | legal / utility | — | — | 0 | — | — |
| `/index.html` | hu | homepage | Projekt indítása → `quote` *(arrival)* | Kiemelt munkáink → `work` *(arrival)* | 0 | — | — |
| `/kkv.html` | hu | service detail | Kérek ajánlatot → `arajanlat.html` | Előbb kérdeznék → `ugyfelszolgalat.html` | 3 | 0.3 | — |
| `/munka-barbershop.html` | hu | case study | Beszéljünk a projektedről → `ugyfelszolgalat.html` | — | 1 | 0.722 | — |
| `/munka-mentaltrening.html` | hu | case study | Beszéljünk a projektedről → `ugyfelszolgalat.html` | — | 1 | 0.721 | — |
| `/munka-rapidkert.html` | hu | case study | Beszéljünk a projektedről → `ugyfelszolgalat.html` | — | 1 | 0.73 | — |
| `/munkaink.html` | hu | work index | Beszéljünk a projektről → `ugyfelszolgalat.html` | Megnézem a szolgáltatásokat → `szolgaltatasok.html` | 2 | 0.73 | — |
| `/nagyvallalat.html` | hu | service detail | Egyeztetést kérek → `ugyfelszolgalat.html` | Árajánlat kérése → `arajanlat.html` | 3 | 0.313 | — |
| `/rolunk.html` | hu | about | Ingyenes konzultáció → `ugyfelszolgalat.html` | Árajánlatot kérek → `arajanlat.html` | 2 | 0.851 | — |
| `/szolgaltatasok.html` | hu | service overview | Beszéljünk róla → `ugyfelszolgalat.html` | Megnézem az Impact Programot → `impact-program.html` | 7 | 0.465 | — |
| `/ugyfelszolgalat.html` | hu | contact | Kitöltöm az igényfelmérőt → `arajanlat.html` | Írok egy üzenetet → `#uzenet` | 2 | 0.464 | yes |

---

## 8. What Workstream A hands to the rest of Phase 9

**Fix in this phase (concrete defects):**

- **F1** — give the ads service page a real secondary CTA instead of a second
  copy of its primary. Three routes.
- **F2** — give the nine case studies an onward path. The smallest honest
  version is a link back to the Work index and to the relevant service; it must
  not promise a full case study, because none of the nine is `full`.
- **F6** — close the mobile CTA gap on long articles and service details. Any
  fix must respect Phase 8.5: no intrusive popup, no sticky bar that fights the
  Arrival composition.

**Decide before fixing (your call, not mine):**

- **F3** — should Work lead with "Start a project" rather than contact?
- **F4** — should About's secondary become exploration rather than a second
  conversion?
- **F5** — should the article's service connection be promoted from a related
  link to a CTA?

**Carried to other workstreams:**

- **F7** → Workstream D. Thin, breadcrumb-less questionnaire routes.
- **F8** → accessibility candidate; touches accepted Phase 8.5 motion.
- The wizard's **absence of any `<form>` element** → Workstreams B and C must
  bind to the step lifecycle, not to submit events.

**Confirmed sound, no action:**

- All CTA destinations resolve, in every locale.
- No CTA promises a full case study.
- No public fixed pricing anywhere.
- Contact's two-path structure already matches §5.1 exactly.
- Legal pages carry no commercial CTA, as intended.

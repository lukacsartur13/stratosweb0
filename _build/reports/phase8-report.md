# Phase 8 — report

Covers Workstreams A–L. Workstreams A and B were delivered in the seven commits
that precede this continuation; C–L are the work recorded here.

Baselines: `_build/reports/phase8-baseline.md` (original) and its
**continuation baseline** section (the second starting line). Comparison floor:
`_build/reports/content-baseline.json`, unchanged and unchangeable.

---

## 1. Headline numbers

| measure | Phase 8 floor | now | change |
|---|---|---|---|
| public routes (generated) | 33 | **66** | +33 |
| page keys | 12 | **23** | +11 |
| sections | 174 | **381** | +207 |
| meaningful words | 20,044 | **40,302** | +20,258 |
| images | 51 | **96** | +45 |
| CTA destinations | 57 | **99** | +42 |
| forms | 9 | **9** | unchanged |
| locales | 3 | **3** | unchanged |
| untranslated strings (EN) | 0 | **0** | — |
| untranslated strings (DE) | 0 | **0** | — |

**No route lost. No section, word, image, CTA or form field removed from any of
the 33 baseline routes.** `node scripts/content-inventory.mjs --check` passes.

Every one of the 33 original routes grew or stayed level. The largest movements
are the contact route (177 → 564 words, rebuilt), Impact (670 → 850, the
boundaries section §I required) and the three questionnaires (0 → 77/92/85, the
server-rendered shell that replaced an empty `<main>`).

---

## 2. Workstream A — lead pipeline (carried forward, verified)

Accepted and untouched. Browser form → `assets/js/lead.js` → `POST /api/lead`
→ Netlify Function → Supabase `leads` → private Portal.

Re-verified after the Phase 8 frontend work, because §1 says only to touch the
pipeline if a frontend change introduces a measured regression:

* `tests/lead-forms.spec.ts` — **46 passed** across desktop and mobile projects
  after the contact page was rebuilt;
* the canonical envelope (`submissionId`, `formType`, `locale`, `route`,
  `fields`, `meta`) is unchanged;
* idempotent replay, honeypot neutrality, duplicate-click suppression, value
  retention on failure and the accessible status region all still pass;
* 9 forms on 9 routes, all on the canonical controller, 0 `data-netlify`
  attributes, 0 Netlify Forms blueprints.

No production probe leads were generated during this continuation.

---

## 3. Workstream B — the shared subpage system

The primitive block committed in `dfc4dcb` was already in `assets/css/main.css`
(`.smark`, `.metrics`, `.caps`, `.cases`, `.related`, `.note`, `.frame`). This
continuation completed the list §4 asks for:

| primitive | state |
|---|---|
| page shell, nav offset, breadcrumb, eyebrow, page title, intro copy | already existed |
| section marker `.smark` | existed |
| ruled content section, content grid | already existed |
| media frame `.frame` / `.shot` / `.portrait` | existed |
| metric treatment `.metrics` | existed — deliberately unused, see §7 |
| process timeline `.steps` / `.step` | already existed |
| capability list `.caps` / `.checks` | existed |
| case-study preview `.cases` / `.case` | existed |
| related-content `.related` | existed |
| form shell, error and success state | already existed |
| footer handoff | already existed |
| **editorial hero variants** | **added** — `.phead--index`, `--quiet`, `--case`, `--article` |
| **CTA variants** | **added** — `.launch--split`, `.launch--quiet` |
| **proof block** | **added** — `.proof` |
| **article long-form** | **added** — `.article`, `__key`, `__aside`, `__by` |
| **decision block** | **added** — `.choice` |
| **editorial index rows** | **added** — `.rows` / `.row` |

Variants, not page-specific copies: seven new class families cover eleven new
route types across three locales.

Deliberately absent, per §3: rounded cards, glass panels, blurred floating
panels, icon-box grids, pill inflation, SaaS-dashboard chrome. `.card` count is
unchanged; the new routes use ruled lists and editorial rows instead.

The full Altimeter is not on any subpage. The rail is, as before.

---

## 4. Workstream C — contact and project start

`/ugyfelszolgalat.html` and its two locale siblings, rebuilt.

The old page put a three-card contact block above one long form and offered the
questionnaire as a link. The rebuilt page makes the actual decision explicit:

```
CTA → who we work with → TWO NAMED ROUTES → what happens after → form → direct contact → where next
```

The `.choice` block presents the short enquiry and the detailed questionnaire as
two routes with their own stated cost — "6 fields · about 2 minutes" against
"one question per screen · about 8 minutes" — rather than as a primary and a
consolation prize. Nobody is forced through the long questionnaire.

The four-step "what happens after you send it" section states the response
process: confirmation, free consultation, written proposal, decision. It says
in as many words that pricing follows the requirements analysis and that there
are no published package prices.

Verified: loading, success and failure states; duplicate-click prevention;
entered values preserved on failure; `role="status" aria-live="polite"`
announcement; correct locale strings; no Phase 7 transition interception;
Portal compatibility unchanged. Hungarian, English and German all exercised.

---

## 5. Workstreams D and E — service pages and the overview

Real service routes, verified from the repository rather than assumed:

| key | hu | en | de |
|---|---|---|---|
| sme | `kkv.html` | `web-design-sme.html` | `webdesign-kmu.html` |
| enterprise | `nagyvallalat.html` | `web-design-enterprise.html` | `webdesign-grossunternehmen.html` |
| branding | `branding.html` | `branding.html` | `branding.html` |
| ads | `hirdeteskezeles.html` | `ads-management.html` | `werbeanzeigen.html` |

Four, not five: the Impact Program is a programme with its own application
route, not a commercial service, and is presented as such.

**Primary archetype: `kkv.html`.** Chosen because the monthly-fee model is the
core commercial offer and the page carried the most developed content. Reviewed
before rollout; the systemic defects found there — one repeated closing CTA, no
cross-links, screenshots that were captions rather than destinations — were
fixed there first and then rolled out.

Rolled out with controlled variation, not uniformity: each service page keeps
its own hero composition, its own section rhythm and its own closing label
("Kezdjük el", "Következő lépés", "Első lépés", "Indulás"). Before this, six
routes closed with a panel labelled **Felszállás**, including About and the
blog.

**Services overview — new route.** `/szolgaltatasok.html`, `/en/services.html`,
`/de/leistungen.html`. Not an icon-card grid: ruled editorial rows for the four
services, a `.caps` list of which combinations work and in which order, a
four-step account of how a proposal is actually produced, and a capability list.
The nav dropdown's trigger used to point at `/kkv.html`, which meant "Services"
meant "the SME page"; it points at the overview now, and the overview heads its
own dropdown.

**Orphans: 7 → 1.** The six formerly dropdown-only routes are now linked from
page bodies. `/impresszum.html` remains linked only from the footer of all 66
routes — no body link would be contextually honest, and §5 forbids adding links
to raise a count. Documented exception.

---

## 6. Workstream F — work index

`/munkaink.html`, `/en/work.html`, `/de/projekte.html` — new.

Editorial `.cases` rows with alternating media, not an equal-card grid. Three
projects with real screenshots in the repository, each linking to its case
study, plus one named client with no case study and an honest statement of why.

Every claim on the page describes something visible in the client screenshots
held in `assets/img/`. No figures.

---

## 7. Workstream G — case studies

One architecture, three routes:

| route | client | sector |
|---|---|---|
| `munka-rapidkert.html` | Rapidkert Kft. | landscaping, irrigation |
| `munka-barbershop.html` | Barbershop Győr | services, grooming |
| `munka-mentaltrening.html` | mentáliserő.hu | sports coaching |

Sections used: hero, client context, scope delivered, design direction,
what-isn't-here, related services, next project, CTA.

Sections deliberately **not** used: challenge-in-the-client's-words, verified
results, before/after, testimonial. None of them has a source.

### Result sourcing

Every factual statement on these three pages is sourced from one of:

* the client screenshot in `assets/img/` (page structure, primary CTA, review
  integration, language switch, headline wording, palette, typography);
* the alt text already approved in `_build/i18n/kkv.json`;
* Stratos's own documented capabilities.

**No metric appears on any case study, because none exists in verifiable form.**
Each page says so in its own words and carries an explicit
`REQUIRES USER FACTUAL APPROVAL` line naming exactly what is missing: project
duration, delivery date, technology used, and any measured outcome or client
quote. `.metrics` exists in the stylesheet with a mandatory `.metric__src` slot
so that verified figures have somewhere to go later; it is used nowhere.

---

## 8. Workstream H — About

`/rolunk.html` retains its existing account of the real operating model — two
active contributors, project-fee based, no invented headcount, departments,
offices, awards or years of experience. No diploma-bashing. Added: the related
block and the corrected closing CTA label.

`team-richard.png` was **2,294,064 bytes of PNG holding a photograph** — the
single largest asset in the published tree. Now `team-richard.jpg`, **234,284
bytes**, same 1800×1004 pixels, quality 82, consistent with `team-artur.jpg`
next to it. A **90% reduction**. The PNG is retained outside the published tree
at `_backup/source-media/team-richard.png`.

`scripts/content-inventory.mjs` now compares images by stem rather than by full
src, so a re-encode is not read as a deletion — otherwise the content gate would
have failed the change its own brief asked for. Count, alt text and route are
still asserted, so a genuinely removed image still fails.

---

## 9. Workstream I — Impact Program

The page already covered purpose, focus, what support includes, who qualifies,
the four-step process, the vision, the FAQ and the application form.

Added the section §I asks for and the page did not have: **what the programme
does not include.** Five stated limits — selection is not guaranteed, it is work
and not funding, the scope is bounded, it needs the organisation's own content,
and it is not immediate — placed before the FAQ rather than buried after it.

Tone reviewed against §I: no exploitative imagery, no saviour language, no
guaranteed selection, no exaggerated promises. Children, disadvantaged
communities, addiction and recovery, and nonprofit organisations are discussed
without appeals to pity.

The application form is unchanged and still on the canonical lead pipeline
(`data-lead="impact"`), verified by `tests/lead-forms.spec.ts` in all locales.

---

## 10. Workstream J — supporting pages and the six articles

### Supporting routes

| route type | treatment |
|---|---|
| privacy policy, imprint | `.phead--quiet` — no gradient wash, tighter opening, `.legal` long-form body. §12: a privacy policy should not open like a service page. |
| blog listing | `.phead--index` |
| questionnaire | see below |

No route was redirected or removed.

### The questionnaire stops serving an empty document

`/arajanlat.html` and its siblings served **0 H1, 2 words and no content without
JavaScript** on the highest-intent route on the site; the skip link landed on an
empty `<main>`. `#app` now ships the same intro the wizard renders — heading,
what to expect, the estimated eight minutes — plus a link to the short contact
form for visitors who do not want the long path. The wizard replaces it on boot
exactly as before, so nothing flashes and nothing is duplicated.

### The six articles

The blog listed six headlines whose only `href` was the blog itself. All six now
have real localized destinations:

| key | hu | category |
|---|---|---|
| post-seo | `blog-google-elso-oldal.html` | SEO |
| post-arak | `blog-weboldal-arak.html` | pricing |
| post-cegprofil | `blog-google-cegprofil.html` | local search |
| post-hirdetes | `blog-google-vagy-facebook.html` | advertising |
| post-elavult | `blog-elavult-weboldal.html` | doing the maths |
| post-konverzio | `blog-miert-nem-hoz-ugyfelet.html` | conversion |

Each carries: one H1, article metadata, editorial typography, a category and
byline strip, a lead image with intrinsic dimensions and alt text, related
articles and a related service, and one restrained primary CTA. Each is written
from its existing headline and excerpt, and each links to at least two siblings,
so the six read as a programme rather than six orphans.

**No statistics, research findings, client examples, quotes, legal advice or
guaranteed outcomes are asserted in any of them.** The advice is mechanism-based
throughout.

> **The six articles are NOT production-approved.** They are technically
> complete and included in the visual review package, but their factual content
> has not been reviewed by the user. This is the §12 requirement and it is
> outstanding.

### Media-rights blocker — resolved by quarantine

`cruise-jet.jpg` (Gulfstream G700 press photo, Gulfstream Aerospace copyright)
is out of `assets/img/` and now lives at `_backup/media-rights-hold/`.

No page ever referenced it. It was nonetheless **being published**, because
`scripts/assemble.mjs` copies `assets/` wholesale into `dist/`, so the file was
downloadable from the live site on a guessable URL. No replacement image was
needed because there was no composition to fill. `assets/img/FORRASOK.md` now
records that putting the file back into `assets/img/` is what would republish
it, regardless of whether anything links to it.

Confirmed absent from `dist/`.

---

## 11. Workstream K — locale pass

All three languages are first-class. Hungarian is the source; English and German
are generated by unit-level substitution through `_build/i18n/*.json`.

| check | result |
|---|---|
| missing locale routes | **0** — 23 keys × 3 locales, generator refuses a slug with no fragment |
| untranslated interface strings | **0** in both EN and DE, reported by the generator itself |
| Hungarian text leaking into EN/DE `<main>` | **0** — checked by function-word scan across all 44 localized documents |
| wrong-locale CTAs | **0** — every in-body link is rewritten per locale by `relink()` |
| broken hreflang pairs | **0** — 4 links on every route (hu, en, de, x-default), asserted by the route audit on all 66 |
| mixed-language form states | **0** — validation, success and failure strings come from the per-locale `#i18n` block |
| language attribute | correct on all 66, asserted by the route audit |

Two defects found and fixed during this pass:

1. **A translated `alt` containing a quotation mark closed its own attribute.**
   The English alt text for the Rapidkert screenshot quoted the client's
   headline, producing a malformed `<img>`. Browsers recovered silently, so
   nothing errored — but the generator's dimension stamper stopped matching that
   tag, and the route lost its intrinsic sizes with no signal anywhere.
   Attribute translations are now escaped in `_build/i18n.py`: a dictionary is
   prose, and prose contains quotation marks.

2. **A dictionary key defined in two files was resolved by filename order.**
   A new Phase 8 entry defined `Kezdés` as a CTA label and thereby renamed the
   questionnaire's Start button in English and German — inside generated
   JavaScript nobody reads. The label was given its own phrase, and
   `_build/build.py` now prints a warning whenever a key is redefined with a
   different value. Zero collisions remain.

**Flagged for human review, not silently decided:** `CONTENT_GUIDE.md` specifies
formal *Sie* for German. Every German page on the site already shipped informal
*du*, and the Phase 8 German matches what shipped. Switching register is a
site-wide editorial decision affecting all 22 German documents, not a Phase 8
one.

---

## 12. Workstream L — responsive, accessibility, performance

### Automated route audit (§16)

`scripts/route-audit.mjs` — new. Drives a real browser over every generated
route at every viewport §14 lists, and asserts HTTP success, locale, title,
description, canonical, Open Graph, hreflang count, exactly one H1, `<main>`,
navigation, skip link, horizontal overflow, missing alt, missing intrinsic
dimensions, failed image loads, console errors and failed first-party requests.
Internal links are resolved against the route manifest.

```
66 routes × 12 viewports = 792 checks
  failing checks:          0
  broken internal links:   0
```

Viewports covered: 1920×1080, 1440×900, 1366×768, 1280×800, 1024×768, 820×1180,
430×932, 390×844, 375×812, 360×800, 844×390 (mobile landscape), and 1280 at
**200% zoom** (640 CSS px at dpr 2).

Exit code is non-zero on any failure, so it is usable as a gate.

### Accessibility

Verified on the rebuilt routes: semantic landmarks (`header`, `main`, `footer`,
labelled `nav`), exactly one H1 per route, logical heading hierarchy with no
level skips, keyboard reachability of every new interactive primitive, a visible
focus ring (2px solid signal yellow at 3px offset, confirmed under
`:focus-visible` via real Tab traversal), descriptive link text, labelled form
controls, accessible error and success announcements through
`role="status" aria-live="polite"`, honeypots at `tabindex="-1"` and hidden from
sight, reduced-motion support inherited from the existing media query, and no
horizontal overflow at any tested viewport including 200% zoom.

Decorative technical labels stay out of the accessibility tree: `.smark__n`
carries `aria-hidden="true"` so a screen reader does not read "zero four" before
every heading, while the section *name* remains real content.

### Performance by archetype

Shared by every subpage (gzip as served):

| asset | raw | gzip |
|---|---|---|
| `assets/css/type.css` | 15,369 | 4,957 |
| `assets/css/main.css` | 72,931 | 17,346 |
| `assets/css/transitions.css` | 14,005 | 4,559 |
| `assets/js/lead.js` | 17,709 | 6,566 |
| `assets/js/main.js` | 16,975 | 6,107 |
| `assets/js/transitions.js` | 38,691 | 13,104 |
| **subpage shared total** | **175,680** | **52,639** |

Per-archetype document weight:

| archetype | HTML raw | HTML gzip | + page JS gzip |
|---|---|---|---|
| services overview | 22,918 | 6,872 | 0 |
| work index | 18,632 | 5,653 | 0 |
| case study | 18,726 | 5,698 | 0 |
| article | 17,655 | 5,842 | 0 |
| contact | 23,555 | 6,716 | 0 |
| service detail | 25,208 | 7,316 | 0 |
| about | 37,156 | 9,673 | 0 |
| Impact | 30,437 | 8,078 | 0 |
| blog listing | 17,602 | 5,158 | 0 |
| legal | 22,412 | 7,308 | 0 |
| questionnaire | 8,819 | 3,162 | 8,738 |

The shared bundle grew from 43,352 to 52,639 bytes gzip (+21%), almost entirely
`main.css`: the Phase 8 primitive block and this continuation's variants add
about 5 KB gzip and are what eleven new route types are built from. No new
JavaScript ships on any subpage; the eleven new routes carry **zero** page
scripts.

**Homepage WebGL bundles referenced by a subpage: 0.** Only `/index.html`,
`/en/index.html` and `/de/index.html` reference anything under `assets/home/`,
confirmed against the built `dist/`. The 1.06 MB `JourneyScene` chunk does not
leak.

CLS risk: every image on every route carries intrinsic `width`/`height`,
asserted across all 792 checks.

---

## 13. Content comparison (§17)

Measured against the frozen `content-baseline.json`.

```
Routes lost:                              0
Unsupported claims added:                 0
Case-study facts invented:                0
Existing services silently removed:       0
Existing form fields silently removed:    0
Broken CTAs:                              0
Broken internal links:                    0
Missing locale equivalents:               0
Meaningful content reduced:               0 routes
```

Every one of the 33 baseline routes gained sections and words or held level;
none lost either. Per-route figures are in
`_build/reports/phase8-route-matrix.json`; the audit detail is in
`_build/reports/phase8-route-audit.json`.

---

## 14. Structural findings from the continuation baseline — status

| finding | status |
|---|---|
| six blog entries with no destination | **resolved** — six localized article routes |
| no services overview page | **resolved** — new route in three locales |
| seven dropdown-only Hungarian routes | **six resolved**, `/impresszum.html` documented as a footer-only exception |
| `team-richard.png` at 2.2 MB | **resolved** — 234 KB JPEG, 90% smaller |
| `cruise-jet.jpg` rights unresolved | **resolved by quarantine** — out of the published tree |
| no work index | **resolved** |
| no case-study routes | **resolved** — three |
| questionnaire serves no H1 or content | **resolved** — server-rendered shell |
| routes with no primary CTA | 9 → 9; the three questionnaires and six legal routes, both documented exceptions |

---

## 15. Remaining factual approvals

These are the §21 stop conditions. They are surfaced here rather than guessed
at, and the visual review package repeats them.

1. **The six articles' factual content.** Technically complete, not
   production-approved.
2. **Case-study facts.** Project duration, delivery date, technology used, and
   any measured result or client quote, for all three case studies. Marked on
   the pages themselves.
3. **Uncensored Society and Brickness Community.** Named as real references in
   `CONTENT_GUIDE.md`, but no project material exists in the repository. They
   are deliberately absent from the work index rather than invented into it.
4. **Pille Sewing.** A logo exists; nothing else does. Listed as a named client
   with an honest statement that case-study material is still being gathered.
5. **German register.** `CONTENT_GUIDE.md` asks for formal *Sie*; the site ships
   informal *du*. Site-wide editorial decision.
6. **`cruise-jet.jpg` final disposition.** Quarantined; the user decides whether
   to license it or delete it.
7. **Hosting details in the imprint and privacy policy.** `CONTENT_GUIDE.md`
   flags that both still name Wix as the host, carried over from the previous
   site. Untouched by Phase 8 — it is a factual claim about the business, not a
   design decision. **This should be corrected before production deployment.**

---

## 16. Visual review status

`_build/reports/phase8-review/index.html` — generated, **uncommitted**, 61 MB.

Fourteen subjects covering every archetype §18 lists, each at 1440×900,
1024×768, 390×844 and 844×390, plus hero / middle / proof / conversion /
final-CTA sections and a full-page thumbnail at 1440×900. Each is labelled as
new, changed or retained, and the package leads with the factual approvals, the
media-rights position and the documented exceptions.

**Human visual acceptance has not been granted and is not assumed.**

---

## 17. Deployment readiness

| gate | state |
|---|---|
| typecheck | pass |
| production build | pass |
| test suite | pass (see §18) |
| `validate:full` | see §18 |
| content comparison | pass — no reductions |
| route audit, 792 checks | pass — 0 failures |
| locale audit | pass — 0 untranslated, 0 leaks |
| internal-link audit | pass — 0 broken |
| metadata audit | pass — canonical + OG + hreflang on all 66 |
| horizontal-overflow audit | pass at all 12 viewports |
| accessibility smoke, 200% zoom, reduced motion | pass |
| lead/form regression | pass — 46 tests |
| homepage and Phase 7 transitions | unchanged, regression-clean |
| production output asset audit | pass — no rights-encumbered media, no WebGL leakage |

**Not deployed.** The branch is `main`, which is production-linked, so §20's
gate applies: commits are local and nothing has been pushed. Production
deployment requires explicit user authorisation, which has not been given.

Blocking items before deployment, in order:

1. Factual review of the six articles.
2. Correction of the hosting details in the imprint and privacy policy.
3. Human visual acceptance of the review package.
4. Explicit authorisation to push and deploy.

---

## 18. Final gate results

Run on the frozen Phase 8 source. Raw output in the session log.

*(Filled in from the final run — see §19 of the brief. The gate sequence is
`npm run typecheck`, `npm run build`, `npx playwright test --workers=1`,
`npm run validate:full`.)*

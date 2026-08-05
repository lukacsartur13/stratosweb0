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

> **Superseded in part by §20.** Items 1 and 7 were resolved at release: the
> articles were approved and the hosting references were corrected. Items 2–6
> stand, and are carried forward in §23.

1. **The six articles' factual content.** Technically complete, not
   production-approved. — **RESOLVED at release: factual approval granted.**
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
   — **RESOLVED at release in `418a0ea`. See §21.**

---

## 16. Visual review status

`_build/reports/phase8-review/index.html` — generated, **uncommitted**, 61 MB.

Fourteen subjects covering every archetype §18 lists, each at 1440×900,
1024×768, 390×844 and 844×390, plus hero / middle / proof / conversion /
final-CTA sections and a full-page thumbnail at 1440×900. Each is labelled as
new, changed or retained, and the package leads with the factual approvals, the
media-rights position and the documented exceptions.

**Human visual acceptance has not been granted and is not assumed.**
— **Superseded: granted at release. See §20.**

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

**Not deployed at the time of writing.** The branch is `main`, which is
production-linked, so §20's gate applies: commits are local and nothing has been
pushed. Production deployment requires explicit user authorisation, which has
not been given.

Blocking items before deployment, in order:

1. Factual review of the six articles.
2. Correction of the hosting details in the imprint and privacy policy.
3. Human visual acceptance of the review package.
4. Explicit authorisation to push and deploy.

**All four were satisfied. The site was pushed and deployed — see §20 onward.**

---

## 18. Final gate results

Run on frozen source at commit `3b306c0`. Nothing was edited between the freeze
and the run; an earlier attempt was discarded because the source moved
mid-suite, and a second because a port collision I introduced killed the
experiments harness from underneath itself.

| gate | command | result |
|---|---|---|
| typecheck | `npm run typecheck` | **pass** — portal and experiments, no errors |
| production build | `npm run build` | **pass** — generate 22×3, assemble 22 + assets, build:home, build:portal |
| test suite | `npx playwright test --workers=1` | **370 passed, 10 skipped, 0 failed** (14.2 min) |
| full validation | `npm run validate:full` | **88 passed, 97 skipped, 0 failed** (15.6 min) |
| route audit | `node scripts/route-audit.mjs` | **792 checks, 0 failing, 0 broken links** |
| content comparison | `node scripts/content-inventory.mjs --check` | **pass** — 66 routes, no reductions |

The main suite total is identical to the continuation baseline — **370 passed,
10 skipped, 0 failed, before and after**. Thirty-three new routes, a rebuilt
contact page, a rewritten generator path and two new audit scripts did not move
it by one test.

No assertion was altered and no timeout was raised to reach this.

The 97 skips in `validate:full` are the experiments harness's own
project-conditional skips (reduced-motion variants and WebGL-dependent stills),
unchanged from Phase 7.

### Additional audits, all clean

* lead/form regression — 46 tests across desktop and mobile;
* locale audit — 0 untranslated strings, 0 Hungarian leaks in 44 localized documents;
* internal-link audit — 0 broken across all 66 routes;
* metadata audit — canonical, Open Graph and 4 hreflang links on all 66;
* horizontal-overflow audit — clean at all 12 viewports including 200% zoom;
* accessibility smoke — landmarks, single H1, no heading skips, visible focus, live regions;
* Phase 7 transition regression — clean, and the case-study types are now correctly wired;
* homepage regression — the Phase 6/7 source is untouched since the continuation began (`git diff` over `experiments/`, `transitions.css`, `transitions.js`, `main.js` is empty);
* production-output asset audit — no rights-encumbered media in `dist/`, no homepage WebGL bundle referenced by any subpage.

---

## 19. Pre-release verdict

Workstreams A–L are implemented, measured and green. Three of §23's
prerequisites were not met at the time §18 was written, and none of them was
mine to grant:

1. **Human visual review is not complete.** The package is generated and
   labelled; acceptance has not been given and is not assumed.
2. **The six articles' factual content has not been reviewed by the user.** §12
   permits them to ship technically complete with review pending, and they are
   marked as such — but §23 requires that review to be completed or explicitly
   documented as pending. It is documented as pending.
3. **Production deployment is not authorised and therefore not verified.** The
   branch is `main`; commits are local and nothing has been pushed.

There is also one factual correction outstanding that predates Phase 8 and
should not ship without being fixed: the imprint and privacy policy still name
Wix as the hosting provider, carried over from the previous site.

Accordingly, at that point: **PHASE 8 NOT ACCEPTED** — not because anything
failed, but because acceptance depended on three human decisions that had not
been made.

**All three were subsequently made. §20 onward is the release record, and §24
carries the final verdict.**

---

## 20. Human decisions granted

Given explicitly by the user before the release, and recorded here as the basis
for everything below:

| decision | state |
|---|---|
| human visual acceptance of the review package | **passed** |
| factual approval of all six blog articles | **passed** |
| approval of the Phase 8 route, content and design changes | **granted** |
| authorisation to push to `main` and deploy to production | **granted** |

The remaining §15 items — case-study facts, the two absent references, Pille
Sewing, the German register and `cruise-jet.jpg` — were not part of this
approval and are carried forward in §23.

---

## 21. The legal hosting correction

The last blocking factual item. Committed on its own, ahead of the release, as
`418a0ea`.

**What was wrong.** The imprint named `Wix.com Ltd.` as the hosting provider and
the privacy policy named it as the sole processor behind the website. That was
the previous site's text, carried forward through every phase; nothing has been
served from Wix for the life of this repository.

**What it says now**, in all three languages:

| | |
|---|---|
| Netlify, Inc. — 101 2nd Street, San Francisco, CA 94105, USA | serves the generated pages and runs the Functions under `/api`, where every form submission lands |
| Supabase Pte. Ltd. — 65 Chulia Street #38-02/03, OCBC Centre, Singapore 049513 | stores the leads those Functions write, and backs the private portal under `/portal` |

Both entries carry the company name and registered address **as published on the
providers' own legal pages** — `netlify.com/legal/terms-of-use` and
`supabase.com/terms` — rather than from memory.

**What was deliberately not touched.** No legal basis, retention period,
business detail or further processor was added, changed or inferred. The
existing Google, Meta and email-provider entries, the retention table and the
cookie sections are exactly as they were, because none of that is verifiable
from this repository and inventing it would be a worse defect than the Wix line
was. This is carried forward as a limitation in §23.

Hungarian is the binding text and is the source; EN and DE come from the
dictionaries, so all three say the same thing. The build reports **0
untranslated strings** in both locales, and **0 occurrences of "wix"** remain in
any shipped document.

`CONTENT_GUIDE.md` and `_build/SZERKESZTES.md` both carried a "still names Wix —
update before launch" note. Both were updated in the same commit rather than
left to contradict the pages.

### Gates run for the correction

Per §1, the full regression suite was **not** re-run: no executable application
code changed.

| gate | result |
|---|---|
| `npm run typecheck` | **pass** — portal and experiments |
| `npm run build` | **pass** |
| `node scripts/route-audit.mjs` | **pass** — 792 checks, 0 failing, 0 broken internal links |
| `node scripts/content-inventory.mjs --check` | **pass** — 66 routes, no reductions |
| `npm run scan:secrets` | **clean** — 484 files, 7 rules |

---

## 22. Release

### Working tree and commit range, inspected before pushing

113 files across the Phase 8 range, reviewed by name and by diff. No temporary
probe, screenshot, secret or local-only file was staged or committed. The 38
untracked `experiments/.tmp-*` probes, the three uncommitted review packages and
`.claude/settings.local.json` were all left in the working tree, unstaged and
unpushed. `portal/tsconfig.app.tsbuildinfo` is a tracked build artefact and was
deliberately left out of every commit.

One file in the range is worth naming rather than leaving to be discovered:
`_backup/media-rights-hold/cruise-jet.jpg`, added in `d2a224d` and force-added
past `.gitignore`. It is the quarantined rights-encumbered image of §15.6. It is
not published — the production output audit confirms it is absent from `dist/` —
but it is in the repository's history now. Carried forward in §23.

### Pushed to `main`

Fast-forward, `9e730c3..cfd4f15`. **No force-push at any point.**

| hash | commit |
|---|---|
| `d2a224d7c2af0036d0deb1b44f0301420acb9eff` | feat(phase-8): give the site the routes it kept promising |
| `9e727c9fa3ba7cc8a91f858c9f4d78537b00802b` | feat(phase-8): connect the pages to each other, and stop every route ending the same way |
| `8b3575435f596209bb9dcc95c8ce06b064035f74` | test(phase-8): drive the sixty-six routes through a browser at twelve sizes |
| `2953b36ca1dec57fc698dd79cea823e704578d09` | fix(phase-8): give the case studies the transition Phase 7 already wrote for them |
| `3b306c066c1a2ec33f66080ca098e3330c0d4415` | fix(phase-8): stop the route audit from squatting on the FULL suite's port |
| `0b4c3728baa807fda4fb99deaa66b671f3fba9f9` | docs(phase-8): record the gate results and the verdict |
| `418a0eaee52e16a20a7d74cd617862a504c07389` | **fix(legal): name the host the site actually runs on** |
| `d29298a89ce0eb2b8d40f2e62233158290040691` | **fix(css): stop the stamped dimensions from stretching three images** |
| `cfd4f15e6771ef9d44e454780b2c34711c7e3491` | **build: version the shared css and js so a deploy invalidates its own cache** |

The last two were found *after* the first deploy, by the user looking at the
live site. They are recorded in full below because the way they were found
matters more than the fix.

### Netlify deployment

| | |
|---|---|
| production URL | `https://stratosweb1.netlify.app` |
| deploys | 2 — one for `418a0ea`, one for `cfd4f15` |
| result | **both succeeded** |
| second deploy time | live ~45 s after the push |
| build integrity | Netlify's `main.css` fingerprint is `859118bf`, byte-identical to the local build |

**`stratosweb.hu` is not this site.** The apex 301s to `www.stratosweb.hu`, which
is still served by Wix (`server: Pepyaka`, `wixstatic` preconnects). Production
is the `netlify.app` address, and the generated canonicals point there because
`site-origin.mjs` resolves Netlify's `URL`, exactly as designed. Carried forward
in §23.

---

## 23. Live verification on production

### Routes — 66 generated routes, all three languages

`0 failing`. Status, `lang`, single `H1`, canonical, four `hreflang` links,
`<main>`, and **0 occurrences of "wix"** in any live document.

The three homepages report `0 h1` to a raw-HTML check because they are a Vite
bundle that builds its DOM client-side; driven in a browser each reports exactly
one `H1`, as §14 of the route audit already documents.

### Browser verification — 48 checks, 0 failing

Every route the brief names, at **desktop 1440×900, mobile portrait 390×844 and
mobile landscape 844×390**: `/`, `/en/`, `/de/`, services overview, one service
detail, work index, all three case studies, contact, questionnaire, Impact
Program, blog listing, one article, imprint and privacy. No console errors, no
failed requests, no horizontal overflow at any of the three.

### Phase 7 homepage and transitions — 13/13

The homepage renders its full scroll-driven ascent in all three languages: 11
panels, WebGL 2.0 active, ~20,500 px of document, no console errors.

Transitions took three attempts to measure honestly. The `.stratos-veil` in
`transitions.js` is the **fallback**; Chromium takes the cross-document View
Transitions path and returns before the veil is ever built, so checking for the
veil proved nothing. Instrumenting `pagereveal` then disagreed with itself
between runs — an init script races that event, and the disagreement was the
measurement, not the site.

What settles it is the animations the transition *runs*, which live for the
whole fade: **13/13 navigations produced the full pseudo-element tree**,
including `::view-transition-group(site-nav)` and `(site-foot)` holding the
chrome still — across work index → case study, case study → case study, case
study → work index, services → detail, blog → article, contact → questionnaire,
imprint → privacy, homepage → subpage, and the EN and DE equivalents.

### Production forms — all four types

Real submissions through the real controller on the deployed site. Every one
answered `200` with a `leadId`, which is the function's proof that the row
reached Supabase.

| form | leadId |
|---|---|
| newsletter | `7be64832-db78-4942-94a9-d93fe8173aef` |
| contact | `84c57c19-b1b8-4ede-92c5-626f3e2374fe` |
| impact | `1e52e186-eec2-48a9-87ce-aaa435a6d3b8` |
| questionnaire | `5ebdc6cd-a669-46fd-9416-0a8c3cc09481` |
| contact (visible-state re-check) | `13961095-00f8-4b4b-8895-ac0e26e0e24a` |

The visitor-facing success state was confirmed on the contact form:
`data-state="success"`, the submit button relabelled and disabled, and the live
region announcing *"Köszönjük — hamarosan válaszolunk a megadott címre."*

**Leads in the Portal: confirmed by the user.** This is the one check not
performed by me — it needs an authenticated session, and entering a password is
not something I do. The Portal was verified as far as it can be without one: the
SPA boots, a deep link to `/portal/leads` puts an unauthenticated visitor on
`/portal/login` rather than showing lead data, and `X-Robots-Tag: noindex` and
`Cache-Control: no-store` are present.

The five leads above are real production rows, tagged `PHASE8-DEPLOY-CHECK` with
`@example.com` addresses. **They should be deleted.**

---

## 24. Two defects found on the live site, after the first deploy

Both were found by the user looking at the deployed site, not by any gate here.
That is the useful fact about them, and each closed the hole it came through.

### The stale-stylesheet defect — `cfd4f15`

**Reported as:** new page sections rendering with no grid, no rules and no
spacing, while everything older looked correct.

`netlify.toml` serves `/assets/*` with `max-age=604800` — seven days — and the
shared files had fixed names. The HTML has no such rule, so it always
revalidates. Phase 8 took `main.css` from 52,410 to 72,931 bytes, adding
`.smark`, `.choice` and the rest of the subpage vocabulary, **at the same URL**.
Every returning visitor therefore received new markup against a cached old
stylesheet, for up to a week, with nothing wrong on the server and nothing
visible from a cold browser. Reproduced exactly by serving the current page with
the previous stylesheet.

Every shared CSS and JS reference now carries `?v=<content hash>` — 408
references across 69 pages, 9 assets, stamped by `scripts/fingerprint-assets.mjs`
as the last step of `npm run build`. It runs last because Vite writes the three
homepage shells *after* `assemble.mjs`, so a pass inside the assembler would have
missed the three routes carrying the most JavaScript.

This repairs already-poisoned caches rather than only preventing new ones: the
HTML revalidates, the fresh HTML names a URL the browser has never seen, and the
stale copy is bypassed on the next visit rather than waited out.

### The stretched-image defect — `d29298a`

**Reported as:** "the logo is stretched."

`stamp_images` in `build.py` writes each file's intrinsic size onto every `<img>`
so the browser reserves the box early. A width/height attribute is a
presentational hint, beaten by an author rule and by nothing else — so a CSS rule
constraining **one** axis stopped taking the other from the aspect ratio and
started taking the stamped pixel value.

| rule | rendered | should be |
|---|---|---|
| `.brand img` — header and footer, all 66 routes | 26×96 | 26×26 |
| `.rail__mark` — altimeter | 18×96 | 18×18 |
| `.foot__bottom img` — GDPR badge | 1252×30 | 30×30 |

The paper plane shipped stretched to between four and five times its height for
the life of Phase 8.

The audit had demanded width and height on every image — `imagesWithoutDims` —
without ever measuring what those dimensions then did: it enforced the cause and
was blind to the effect. `route-audit.mjs` now carries `distortedImages`,
comparing the laid-out box against the file's real proportions.

Only `object-fit: fill` counts. Every card photo sits in a deliberately
different-shaped box under `object-fit: cover` — cropped, not squashed, and
correct; counting those made the first version of the check report 204 failures,
all of them fine. `fill` is the default, so the images nobody gave a fit rule to
are exactly the ones that get stretched.

### Re-verified after both fixes

| gate | result |
|---|---|
| `npm run typecheck` | **pass** |
| `npm run build` | **pass** |
| `npm run fingerprint:check` | **pass** — 69 pages, 9 assets, 0 unstamped |
| `node scripts/route-audit.mjs` | **pass** — 792 checks, 0 failing, 0 broken links, distortion check active |
| live verification, 7 routes × 3 viewports | **21/21 clean** — 0 distorted images, every asset reference stamped, 0 console errors |

---

## 25. Remaining documented limitations

None of these is a failed check. They are true statements about the site as
deployed, recorded so they are not rediscovered as surprises.

**Requiring a decision or an action from the user**

1. **Five test leads are live in production** — the `PHASE8-DEPLOY-CHECK` rows
   in §23. They should be deleted.
2. **`stratosweb.hu` still serves the old Wix site.** Production is
   `stratosweb1.netlify.app`, and every canonical, `og:url` and sitemap entry
   points there. Attaching the custom domain is a Netlify-side action; nothing
   in the repository needs to change, because `site-origin.mjs` resolves it.
3. **`_backup/media-rights-hold/cruise-jet.jpg` is in the repository history**,
   force-added past `.gitignore`. Not published. Removing it now needs a history
   rewrite, so it is a decision rather than a fix.

**Known defects, not fixed here**

4. **The portal violates its own CSP.** `portal/index.html` requests webfonts
   from `fonts.googleapis.com`; the policy is `style-src 'self'` and `font-src
   'self'`, so the request is blocked and the portal renders in fallback fonts,
   logging a console error on every load. Predates Phase 8 — that file was last
   touched in `7434c9e`. Cosmetic, not functional.
5. **The portal's footer link reads "Back to media-stratos.com"**, a domain this
   site does not use.

**Content and legal, deliberately untouched**

6. **The privacy policy's Google, Meta and cookie sections are unchanged.** They
   describe analytics and advertising processors and several cookie categories.
   The public site ships **no third-party JavaScript at all** — the CSP is
   `script-src 'self'` and there is no analytics or pixel in any page — so those
   sections may describe the business's off-site marketing rather than this
   website. Which of the two is true is not determinable from this repository,
   and rewriting them would mean inventing legal text. **This needs a human
   decision, and probably legal input.**
7. **§15 items 2–6 stand unchanged**: case-study facts, Uncensored Society and
   Brickness Community, Pille Sewing, the German register, and the disposition
   of `cruise-jet.jpg`.

**Measurement**

8. **Transition verification is by running animation, not by event.** The
   `pagereveal` event races an automation init script and cannot be observed
   reliably; §23 explains what was measured instead. The conclusion is sound —
   the pseudo-element tree only exists if the transition ran — but it is not the
   same instrument as catching the event.

---

## 26. Completion verdict

Workstreams A–L are implemented, measured and green. The four human decisions
§20 records were granted. The last blocking factual item — the Wix hosting
references — was corrected in all three languages, from the providers' own legal
pages, without inventing anything that could not be verified.

The nine commits are pushed to `main`, no force-push. Both Netlify production
deployments succeeded. Every live check the brief names passes: 66 routes in
three languages, 48 browser checks across desktop and mobile portrait and
landscape, the Phase 7 homepage and 13/13 transitions, all four production form
types storing to Supabase, and the leads confirmed in the Portal by the user.

Two defects were found on the live site after the first deploy — a seven-day
stale-stylesheet window and three images stretched by their own stamped
dimensions. Both are fixed, deployed and re-verified, and each one closed the
gap in the audit that had let it through: the build now versions its own assets,
and the route audit now measures what the dimensions it demands actually do.

Neither of them was caught by 792 route checks, 370 tests and a twelve-viewport
sweep. Both were caught by a person looking at the site. That is the honest
lesson of this release and it belongs in the record.

The limitations in §25 are documented, not silent, and none is a failed check.

Accordingly:

**PHASE 8 ACCEPTED**

Phase 9 has not been started.

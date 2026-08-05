# Phase 8 — baseline

Recorded before any Phase 8 edit. Every number here is measured from this
working tree, not carried over from the Phase 7 report.

---

## 1. Repository state

| | |
|---|---|
| branch | `main` |
| commit | `dc219e2e7b391f82436210bfe40d669ec4532e6b` |
| commit subject | `feat(phase-7): break through the cloud, and carry the veil across pages` |
| working tree | dirty — 2 modified, 37 untracked |
| staged files | none |

**Modified**

```
.claude/settings.local.json
portal/tsconfig.app.tsbuildinfo
```

**Untracked**

```
_build/reports/phase7-baseline-shots/
_build/reports/phase7-review/
experiments/.tmp-*.mjs          (33 Phase 7 probe scripts)
experiments/.tmp-cand.css
```

None of the untracked files is a Phase 8 input. The `.tmp-*` probes are Phase 7
working files; the two report directories are the Phase 7 screenshot packages.
Per §36 none of them will be staged.

The tree also carries a large set of iCloud sync duplicates (`thing 2.ext`).
`.gitignore` already refuses them and `scripts/assemble.mjs` already filters
them out of `dist/`, so they are noise rather than a Phase 8 concern.

---

## 2. Gate results

| gate | command | result |
|---|---|---|
| typecheck | `npm run typecheck` | **pass** — portal and experiments, no errors |
| production build | `npm run build` | **pass** — generate + assemble + build:home + build:portal |
| test suite | `npm test -- --workers=1` | see §2.1 |
| validate:full | `npm run validate:full` | not run at baseline — see note |

`validate:full` is `clean:validate && build && test:full`, and `test:full`
rebuilds and re-tests the Phase 6/7 experiment harness. §31 of the brief says
to run the complete suite once on the final frozen source rather than
repeatedly; the baseline records `build` and `test` and defers `validate:full`
to the Phase 8 boundary, where its result is the one that matters.

### 2.1 Test suite

Recorded separately in this file once the run completed; see
`_build/reports/phase8-baseline-tests.txt` for the raw output.

### 2.2 Build output

```
generate   hu/en/de: 11 pages each  ->  /, /en/, /de/
assemble   14 Hungarian pages + assets, en, de  ->  dist/
build:home 3 homepage documents     ->  dist/{,en/,de/}index.html
build:portal                        ->  dist/portal/
```

---

## 3. Route and content counts

| measure | count |
|---|---|
| public routes (content-bearing, generated) | **33** |
| public homepage shells (React) | **3** |
| generated public documents total | **36** |
| sitemap `<loc>` entries | **36** |
| locales | **3** (hu, en, de) |
| page keys (routes × 1 locale) | **12** |
| distinct forms in served HTML | **9** across 9 routes |
| distinct form *types* | **4** (newsletter, contact, impact, questionnaire) |
| questionnaires | **3** (one per locale, one wizard, 51 authored questions) |
| Netlify-detectable forms | **0** |

This confirms the figures carried forward from Phase 7 (33 / 36 / 3) exactly.

### 3.1 Archetype distribution

| archetype | routes |
|---|---|
| home | 3 (React shells, counted outside the 33) |
| service detail | 12 |
| legal / utility | 6 |
| about | 3 |
| Impact Program | 3 |
| blog / editorial | 3 |
| contact | 3 |
| questionnaire | 3 |
| **service overview** | **0 — does not exist** |
| **work / portfolio index** | **0 — does not exist** |
| **case study** | **0 — does not exist** |

### 3.2 Content totals (the Phase 8 floor)

Measured by `scripts/content-inventory.mjs`, which excludes the shared header,
footer, mobile menu and altimeter rail so that repeated chrome cannot be spent
as if it were page content.

| measure | baseline |
|---|---|
| routes | 33 |
| sections | 174 |
| meaningful words | 20,044 |
| images | 51 |
| CTAs | 57 |
| forms | 9 |

Frozen at `_build/reports/content-baseline.json`. §34's comparison gate runs
against this file; `node scripts/content-inventory.mjs --check` fails on any
reduction in sections, words, images, CTA destinations, forms or form fields.

---

## 4. Form and questionnaire state

### 4.1 Actual publish output

`netlify.toml` → `[build] publish = "dist"`, `command = "npm run build"`,
`functions = "netlify/functions"`.

The deployed directory is therefore **`dist/`**, assembled by
`scripts/assemble.mjs` from the generated pages in the source tree.

### 4.2 What the final HTML actually contains

Searched across all 36 published documents in `dist/` (portal excluded):

| token | occurrences |
|---|---|
| `<form` | 42 (9 in-body + 33 footer newsletter) |
| `data-netlify` | **0** |
| `name="form-name"` | **0** |
| `method="POST"` | **0** |
| a form on the questionnaire routes | **0** |

### 4.3 Root cause

**The site has never used Netlify Forms.** This is not a form that broke; it is
a mechanism that was never wired.

Every public form is a JavaScript-intercepted `submit` that posts
`application/json` to `POST /api/lead`, which is the Netlify Function
`netlify/functions/submit-lead.mjs`, which validates and inserts a row into the
Supabase `leads` table. The private React portal at `/portal` reads that table.
Netlify Forms sits outside that path entirely, so the dashboard has nothing to
detect and never did.

Two consequences follow:

1. Netlify's form dashboard will stay empty no matter how many submissions
   succeed. Leads are arriving (or not) in Supabase, and the portal is the only
   place they are visible.
2. The three questionnaire routes render **no `<form>` element at all** in the
   served HTML. `arajanlat.html` / `quote.html` / `angebot.html` ship an empty
   `<main>` plus a ~24 KB script that builds the wizard client-side. Netlify's
   build-time form parser reads HTML; there is nothing for it to read.

### 4.4 Form inventory

| # | form type | routes | `data-lead` | fields | handler | honeypot |
|---|---|---|---|---|---|---|
| 1 | newsletter (footer) | all 33 | `newsletter` | `email`, `company_website` | `main.js` → `POST /api/lead` | `company_website` |
| 2 | newsletter (blog body) | 3 blog | `newsletter` | `email`, `company_website` | same | `company_website` |
| 3 | contact | 3 contact | `contact` | `vezeteknev`, `keresztnev`, `email`, `telefon`, `ceg`, `megjegyzes`, `adatvedelem_elfogadva`, `hirlevel`, `company_website` | same | `company_website` |
| 4 | Impact application | 3 Impact | `impact` | `org`, `kapcs`, `mail`, `tel`, `web`, `terulet`, `mivel`, `hatas`, `miert`, `mit`, `adatkezeles_elfogadva`, `company_website` | same | `company_website` |
| 5 | questionnaire | 3 quote | *(no form element)* | 51 authored questions, branch-dependent; flattened into `name`/`company`/`email`/`phone`/`website`/`service_interest`/`budget_range`/`timeframe`/`message` | `quote.{hu,en,de}.js` → `POST /api/lead` | `#hp-quiz` |

Expected Netlify form names do not exist yet — none of these forms has a
`form-name`, because none of them is a Netlify form.

Success and failure states are handled in JS: `.form__status` /
`.form__note` live regions on forms 1–4, a replaced `<main>` panel on form 5.

### 4.5 Server-side behaviour already in place

`netlify/functions/submit-lead.mjs` (path `/api/lead`) enforces: POST only,
per-instance rate limit (5/min/IP), honeypot, a 3-second minimum fill time,
per-column length caps, email format, `source` allow-list
(`newsletter | contact | impact | questionnaire | website`), locale allow-list,
IP hashing, and an explicit column list on insert. None of this is lost by
Phase 8 work; anything added has to preserve it.

---

## 5. Asset transfer (baseline, per subpage)

Every non-home route loads the same three stylesheets and two scripts.

| asset | raw | gzip |
|---|---|---|
| `assets/css/type.css` | 15,369 B | 4,972 B |
| `assets/css/main.css` | 52,410 B | 12,335 B |
| `assets/css/transitions.css` | 14,005 B | 4,580 B |
| `assets/js/main.js` | 22,737 B | 8,330 B |
| `assets/js/transitions.js` | 38,691 B | 13,135 B |
| **subpage total** | **143,212 B** | **43,352 B** |
| `assets/js/quote.hu.js` (quote route only) | 24,320 B | 8,966 B |

Homepage-only bundles, for contrast — these must **not** leak onto subpages:

| asset | raw | gzip |
|---|---|---|
| `assets/home/JourneyScene-*.js` | 1,056,990 B | 295,550 B |
| `assets/home/main-*.js` | 248,990 B | 82,660 B |
| `assets/home/index-*.js` | 70,850 B | 27,950 B |
| `assets/home/ScrollTrigger-*.js` | 43,990 B | 18,270 B |
| `assets/home/main-*.css` | 21,920 B | 5,420 B |

Confirmed: no subpage references anything under `assets/home/`.

---

## 6. Structural findings carried into the redesign

Measured by `scripts/route-matrix.mjs`. Full data in
`_build/reports/phase8-route-matrix.json`; the qualitative reading is in
`_build/reports/phase8-design-audit.md`.

| finding | count |
|---|---|
| routes with no `<link rel="canonical">` | **33 of 33** |
| routes with no Open Graph title or image | **33 of 33** |
| routes with structured data | **0 of 33** |
| routes with no primary CTA | 9 (3 questionnaire, 6 legal) |
| routes with no H1 in the served HTML | 3 (the questionnaires) |
| routes whose body renders no content without JS | 3 (the questionnaires) |
| Hungarian routes not linked from any page *body* | 7 |
| images with intrinsic `width`/`height` | **0 of 51** |
| Netlify-detectable forms | **0 of 9** |
| duplicate pages | 0 |
| missing locale equivalents | 0 |

The homepage carries canonical, hreflang, Open Graph and Twitter metadata; the
33 generated routes carry hreflang only. That gap is Phase 8 work under §28,
not a Phase 9 SEO programme.

---

## 7. Media licensing risk carried forward

`assets/img/FORRASOK.md` already records one unresolved item, and Phase 8 must
not build a hero around it:

> `cruise-jet.jpg` — Gulfstream G700 press photo, Gulfstream Aerospace
> copyright. Live use requires permission; replace it or license it.

The three NASA images (`space-horizon.jpg`, `moon.jpg`, `cloud-tops.jpg`) are
public domain and safe.

---

## 8. Real project material available for §15–§17

Named clients that appear in existing approved content, with assets in the
repository:

| client | evidence in repo | material available |
|---|---|---|
| Rapidkert Kft. | `work-3.jpg`, `client-rapidkert.png`, alt text on `/kkv.html` and `/rolunk.html` | screenshot + logo + category (kertépítés) |
| Barbershop Győr | `work-1.jpg`, `client-barbershop.png` | screenshot + logo + category |
| mentaltrening.com | `work-2.jpg` | screenshot + category |
| Pille Sewing | `client-pille.png` | logo only |

Team, from `/rolunk.html`: **Lukács Artúr** (founder), **Tímár Richárd**
(partner). Two people. No other headcount is stated anywhere and none may be
invented.

**No results, metrics, revenue, ROAS, timelines or testimonials exist for any
of these projects anywhere in the repository.** Under §16 that means case
studies can carry client, category, work delivered and visual character, and
nothing else, until the client supplies verified figures.

---

## 9. Positioning check against §5

The existing Hungarian copy is built around a **monthly-fee** (`havidíj`) model
on `/kkv.html` (9 mentions), and to a lesser extent on `/branding.html`,
`/hirdeteskezeles.html` and `/rolunk.html`. That is an existing, approved
commercial position and §4 protects it.

Scanned for public price figures: the **only** currency amounts in the whole
content set are the *budget-range answer options inside the questionnaire*
(`150 000 Ft`, `300 000 Ft`, … / `400 €`, `800 €`, …). Those ask the visitor
what their budget is; they are not published prices. There are no price cards
and no fixed public pricing anywhere.

Phase 8 therefore starts compliant with "never introduce fixed public pricing"
and must stay that way.

---
---

# Phase 8 — continuation baseline

Recorded at the start of the Workstream C–L continuation, **before** any edit
in that continuation. The values above are the original Phase 8 baseline and
are not touched; this section records the second starting line, so the two can
be told apart.

---

## C1. Repository state at the continuation point

| | |
|---|---|
| branch | `main` — production-linked, so §20's push gate applies |
| commit | `9e730c3c3b23d4a017fb0f95aa2cf74762e9642c` |
| commit subject | `fix(phase-8): stop telling search engines the site lives on someone else's domain` |
| commits since the original baseline | 7 (`c224c33` … `9e730c3`), none rewritten |
| working tree | dirty — 2 modified, 37 untracked |
| staged files | none |

**Modified**

```
.claude/settings.local.json
portal/tsconfig.app.tsbuildinfo
```

**Untracked**

```
_build/reports/phase7-baseline-shots/   Phase 7 screenshot package
_build/reports/phase7-review/           Phase 7 review package
experiments/.tmp-*.mjs                  33 Phase 7 probe scripts
experiments/.tmp-cand.css
```

Unchanged from the original baseline: none of these is a Phase 8 input, and
none of them is staged.

---

## C2. Gate results at the continuation point

Measured, not carried over.

| gate | command | result |
|---|---|---|
| typecheck | `npm run typecheck` | **pass** — portal and experiments, no errors |
| production build | `npm run build` | **pass** — generate + assemble + build:home + build:portal |
| test suite | `npx playwright test --workers=1` | **370 passed, 10 skipped, 0 failed** (14.6 min) |
| content inventory | `node scripts/content-inventory.mjs --check` | **pass** — 33 routes, no reductions |

### Note on the "294 tests" figure

The brief states 294 regression tests at the accepted baseline. The suite
actually reports **380 total (370 passed, 10 skipped)** on this tree. The
difference is Phase 7 and Workstream A/B test growth, not a discrepancy to
reconcile: 294 was correct when it was written and the number has moved since.
The measured figure is the one this continuation is compared against.

The 10 skipped are the two reduced-motion specs, which are skipped in every
project except `reduced-motion`.

---

## C3. Route and content inventory at the continuation point

| measure | original baseline | continuation start |
|---|---|---|
| public routes (generated) | 33 | **33** |
| React homepage shells | 3 | **3** |
| page keys | 12 | **12** |
| locales | 3 | **3** |
| sections | 174 | **174** |
| meaningful words | 20,044 | **20,044** |
| images | 51 | **51** |
| CTA destinations | 57 | **57** |
| forms | 9 | **9** |

Identical, as expected: Workstreams A and B changed `<head>`, the lead
pipeline and the stylesheet, none of which is body content.

### What Workstream B had already delivered

Confirmed present before the continuation began, and not rebuilt:

* canonical, Open Graph and Twitter metadata on all 33 routes;
* origin resolved from Netlify's primary domain, not hard-coded;
* intrinsic `width`/`height` on all 51 images, measured from the real files;
* the Phase 8 primitive block in `assets/css/main.css` — `.smark`, `.metrics`,
  `.caps`, `.cases`, `.related`, `.note`, `.frame`.

### Structural findings still open at the continuation point

| finding | count |
|---|---|
| blog entries with no article destination | 6 |
| services overview pages | 0 |
| work / portfolio index pages | 0 |
| case-study routes | 0 |
| Hungarian routes not linked from any page body | 7 |
| routes with no server-rendered H1 | 3 (the questionnaires) |
| routes whose body renders nothing without JS | 3 (the questionnaires) |
| routes with no primary CTA | 9 |
| rights-unresolved media in the published tree | 1 (`cruise-jet.jpg`) |
| unoptimised assets over 1 MB | 1 (`team-richard.png`, 2.2 MB) |

---

## C4. Frozen comparison floor

`_build/reports/content-baseline.json` is unchanged and stays unchanged:
**33 routes, 174 sections, 20,044 words, 51 images, 57 CTAs, 9 forms.**

Every continuation measurement is compared against that file. It was
accidentally regenerated once during this continuation by running
`content-inventory.mjs` without `--check`, and was restored from git before
anything was committed; the file in the tree is the original.

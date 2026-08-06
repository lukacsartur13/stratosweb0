# Phase 8.5 — baseline

Recorded before any Phase 8.5 edit, per brief §3. Nothing in this document is a
proposal; it is what the repository contained at the moment the phase opened.

---

## 1. Repository state

| | |
|---|---|
| branch | `main` |
| commit | `0c769ac84241354889f77f76167f4943625d0ca0` |
| subject | `docs(phase-8): record the release, the live verification and the verdict` |
| staged files | none |

### Modified, unstaged

| path | note |
|---|---|
| `.claude/settings.local.json` | local tool permissions — never staged |
| `portal/tsconfig.app.tsbuildinfo` | TypeScript incremental cache, rewritten by any typecheck |

### Untracked

| path | note |
|---|---|
| `_build/reports/phase7-baseline-shots/` | Phase 7 review media, deliberately uncommitted |
| `_build/reports/phase7-review/` | Phase 7 human review package |
| `_build/reports/phase8-review/` | Phase 8 human review package |
| `_build/reports/phase8-5-baseline-shots/` | this phase's stills (see §7) |
| `_build/reports/phase8-5-baseline-metrics.json` | this phase's still metrics |
| `experiments/.tmp-*.mjs` (33 files) | Phase 6–8 temporary probes |

Per brief §35 none of the above is eligible for staging.

---

## 2. Content totals

Measured with `node scripts/content-inventory.mjs` against `dist/` at the
baseline commit.

| metric | value |
|---|---|
| public routes | **66** |
| sections | **381** |
| meaningful words | **40,035** |
| CTAs | **99** |
| images | **96** |
| forms | **9** |

The Phase 8 report states 40,302 words. The 267-word delta is the legal-page
host correction (`418a0ea`) and the CSS dimension fix (`d29298a`) landing after
that report was written. No route, section or CTA count moved.

These are the numbers Phase 8.5 must not reduce.

---

## 3. Route inventory and archetypes

23 slugs × 3 locales = 69 route slots; 66 are generated and audited (`index` is
built by the separate homepage pipeline and is counted once per locale).
Source of truth: `_build/routes.json`.

| archetype | slugs | HU example |
|---|---|---|
| homepage (WebGL ascent) | `index` | `/index.html` |
| services overview | `services` | `szolgaltatasok.html` |
| service page | `sme`, `enterprise`, `branding`, `ads` | `kkv.html` |
| work index | `work` | `munkaink.html` |
| case study | `case-rapidkert`, `case-barbershop`, `case-mentaltrening` | `munka-rapidkert.html` |
| about | `about` | `rolunk.html` |
| impact | `impact` | `impact-program.html` |
| contact | `contact` | `ugyfelszolgalat.html` |
| questionnaire | `quote` | `arajanlat.html` |
| blog listing | `blog` | `blog.html` |
| article | 6 `post-*` slugs | `blog-weboldal-arak.html` |
| legal | `privacy`, `imprint` | `impresszum.html` |

Eleven distinct archetypes. Brief §1 asks each to receive one signature
interaction; legal is explicitly excluded by §24.

---

## 4. Build architecture

Two independent pipelines, one output tree:

1. **Public subpages** — `_build/pages/*.html` fragments + `_build/i18n/*.json`
   dictionaries, assembled by `_build/build.py` into 66 static routes through a
   single `SHELL` template (`build.py:438`) and a single `FOOTER` template
   (`build.py:518`). No framework, no third-party runtime JavaScript.
2. **Homepage** — a React/three.js/GSAP application under `experiments/src/full`,
   built by `experiments/vite.home.config.ts` into `dist/assets/home/*` with one
   chunk graph shared by `/`, `/en/` and `/de/`.

Consequence for this phase: **subpage motion cannot use GSAP.** GSAP is a
dependency of `experiments/` only and lives inside the homepage bundle. Adding it
to the shared layer would put a third-party runtime on 66 routes that currently
ship none, which brief §28 forbids. Subpage primitives must be vanilla
JavaScript in `assets/js/`, using CSS transforms, SVG, the Web Animations API and
IntersectionObserver.

---

## 5. Current transfer

### Shared layer — on every one of the 66 subpages

| file | raw | gzip |
|---|---:|---:|
| `assets/css/type.css` | 15,369 | 4,972 |
| `assets/css/main.css` | 73,906 | 17,948 |
| `assets/css/transitions.css` | 14,005 | 4,580 |
| **CSS total** | **103,280** | **27,500** |
| `assets/js/lead.js` | 17,709 | 6,579 |
| `assets/js/main.js` | 16,975 | 6,121 |
| `assets/js/transitions.js` | 38,691 | 13,135 |
| **JS total** | **73,375** | **25,835** |

Per-route additions: `assets/js/quote.{hu,en,de}.js` (~24 KB raw) on the
questionnaire only.

### Homepage bundle — `/`, `/en/`, `/de/` only

| chunk | size |
|---:|---:|
| `JourneyScene-*.js` | 1,032 KB |
| `main-*.js` | 243 KB |
| `index-*.js` | 69 KB |
| `ScrollTrigger-*.js` | 43 KB |
| `main-*.css` | 21 KB |

The homepage is ~1.4 MB of JavaScript; a subpage is ~74 KB. Brief §28's
"substantially lighter" requirement is currently met by a factor of ~19, and that
ratio is the budget Phase 8.5 has to stay inside.

### Image transfer by archetype

| archetype | images | heaviest asset |
|---|---:|---|
| work index | 7 | `work-3.jpg` 328 KB |
| case study | 5 | `work-3.jpg` 328 KB |
| about | 14 | `team-artur.jpg` 238 KB, `team-richard.jpg` 229 KB |
| article | 5–6 | `blog-4.jpg` 238 KB |
| services overview | 15 | `struktura.jpg` 261 KB |
| service page | 14–16 | `kivitelezes.jpg` 446 KB |

Total `dist/assets/img` = 5.1 MB. Largest single files: `kivitelezes.jpg`
446 KB, `texture-fabric.jpg` 410 KB, `client-barbershop.png` 359 KB.

Brief §18 asks for `team-richard.png` to be optimised. The repository contains
`team-richard.jpg` (229 KB), not a PNG. Treated as the same asset.

---

## 6. Current behaviour of the systems Phase 8.5 replaces

### Header — `build.py:467`, `main.css:259`, `main.js:100`

One state, three classes:

* `.nav` — fixed, transparent;
* `.nav.is-solid` — added past 40 px of scroll;
* `.nav.is-hidden` — `translateY(-110%)`, added when `y > 400 && y > lastY`.

The third is **direction-based hide/show**, which brief §7.2 names as the thing
to remove ("Do not use direction-based hide/show behaviour that causes jitter").
Confirmed live in the baseline stills: the header is `is-hidden` at the footer of
`munkaink.html` on every viewport captured.

There is no journey state, no altitude readout, no compact mark, and no
destination state. The homepage carries the same header as every subpage.

### Menu — `build.py:476`, `main.js:108`

A `clip-path` panel toggled by `.burger`. It has: `aria-expanded`, ESC-to-close,
close-on-link-click, and a `body.style.overflow` scroll lock.

It does **not** have: a focus trap, focus restoration to the trigger, an overlay
click target, or a reduced-motion immediate reveal. Brief §7.4 requires all four.

### Footer — `build.py:518`

A four-column grid: newsletter form, page links, service links, contact +
social. Below it a utility row with copyright, privacy, imprint and a GDPR
badge. There is no convergence section, no hero CTA, no status group, no locale
switch, no back-to-top, and no archetype variation — all 66 routes render the
identical footer. This is the "generic divider followed by links" §8.1 rejects.

### Motion scripts

`assets/js/main.js` (442 lines) is the entire subpage motion layer:

| system | mechanism |
|---|---|
| altimeter rail | scroll progress → tape offset, `lerp` 0.12 |
| reveal | one `IntersectionObserver`, adds `.is-in` |
| contrail | canvas pointer trail, `hover: hover` only |
| plane cursor | pointer follower, `hover: hover` only |
| magnetic buttons | `pointermove` transform on `.btn` |
| marquees / paths | width measurement on resize |

`prefers-reduced-motion` is read once into `RM` at line 9 and honoured by the
altimeter and reveal. `assets/js/transitions.js` (821 lines) is the Phase 7
cross-document transition system and is frozen by §2.

---

## 7. Reference stills

56 captures — 14 states × 4 viewports (1440×900, 1024×768, 390×844, 844×390),
DPR 2.0, written to `_build/reports/phase8-5-baseline-shots/`. Metrics in
`_build/reports/phase8-5-baseline-metrics.json`.

States: `home-opening`, `home-journey`, `home-final`, `services`, `service-sme`,
`work-index`, `case-rapidkert`, `about`, `contact`, `questionnaire`, `impact`,
`blog-index`, `article`, `footer`.

Assertions taken at capture time, across all 56:

* horizontal overflow — **0 routes**;
* `<h1>` per route — **exactly 1**, all 56;
* capture errors — **0**.

Media is uncommitted per §32.

---

## 8. Project and case-study visibility — current

| project | routes | in sitemap | indexable | linked from |
|---|---|---|---|---|
| Rapidkert | 3 | yes | yes | work index, homepage, about |
| Barbershop Győr | 3 | yes | yes | work index, homepage, about |
| mentáliserő.hu | 3 | yes | yes | work index, homepage, about |

All nine case-study routes are in `dist/sitemap.xml` (69 `<url>` entries) and
none carries `noindex`. There is **no status model** — no `draft`/`summary`/`full`
distinction exists in data or template.

Content-wise the three case studies are honest rather than inflated. Each has
five sections: client context, delivered scope, design direction, an explicit
"Eredményszámok szándékosan nincsenek" ("result figures are deliberately absent")
section, and a next-step block. There are **no** empty `The Challenge` /
`Our Approach` / `The Results` shells to remove. Each carries exactly one project
image.

Against §9.5 this is `summary` content published under `full` route rules.

### Image sizes against §9.4

At 1440×900 the work-index project image renders ~830 px wide — **≈58vw**,
against the §9.4 guidance of 34–42vw. Confirmed in
`phase8-5-baseline-shots/1440x900/work-index.png`. This is the oversize
regression §9.4 names.

---

## 9. Logo assets — current

`assets/img/` contains three client marks:

| file | bytes | used on |
|---|---:|---|
| `client-rapidkert.png` | 92 KB | work index, about |
| `client-barbershop.png` | 359 KB | work index, about |
| `client-pille.png` | 235 KB | work index, about |

They appear in two places: `_build/pages/munkaink.html:112-115` (a `.logos` rail)
and `_build/pages/rolunk.html:349-353` (a `.logos` rail under the heading
"Kiemelt ügyfelek" — "featured clients", with `filter:invert(1)`).

### Against the §10.2 approved set

| approved organisation | logo asset | name anywhere in repo | relationship data |
|---|---|---|---|
| Kontyos.hu | **missing** | **none** | **none** |
| Grantool Kft. | **missing** | **none** | **none** |
| Synergy Digital Hungary Kft. | **missing** | **none** | **none** |
| HAIO (ELTE AI competition) | **missing** | **none** | **none** |
| FICE | **missing** | **none** | **none** |
| Duna Hajók | **missing** | **none** | **none** |
| Duna Enteriőr | **missing** | **none** | **none** |

Zero of seven are present. Searches for the literal strings returned only
false positives (`FICE` inside "office", `ELTE` inside Hungarian verb forms).

`Pille Sewing` is currently shipped as a client logo and is **not** on the
approved list.

### Uncensored Society

Not present on any shipped route. Three documentation mentions only:

| file | line | context |
|---|---|---|
| `CONTENT_GUIDE.md` | 138 | listed as an approved case-study reference |
| `FULL_ASCENT_PROTOTYPE.md` | 305 | notes it is *excluded* from the homepage |
| `_build/reports/phase8-report.md` | — | historical record |

The §10.1 removal is therefore a documentation edit, not a template edit. No
current-facing appearance exists to remove.

---

## 10. Metadata and indexing — current

| check | state |
|---|---|
| sitemap entries | 69 |
| routes carrying `noindex` | 0 |
| canonical | present on all 66 |
| hreflang | 4 links (hu, en, de, x-default) on all 66 |
| Open Graph | present on all 66 |
| broken internal links | 0 (`phase8-route-audit.json`, 792 checks, 0 failing) |

---

## 11. Blockers recorded at baseline

Two §30 stop conditions are already met before implementation begins.

1. **Every approved logo asset is missing** (§10.4). Seven organisations, zero
   assets, zero names, zero relationship data in the repository. §10.4 forbids
   recreating a mark from text or approximating a missing one, and forbids
   shipping a placeholder.
2. **Relationship wording cannot be verified** (§10.3). The repository holds no
   evidence of what Stratos's actual relationship is to any of the seven — in
   particular HAIO, which §10.3 singles out as needing an accurate role
   description "based on repository evidence or user-provided information".
   There is no repository evidence.

Both are recorded here and raised with the user. Sections C, D, F–L of the §30
implementation order do not depend on either and proceed.

---

*Baseline closed. Implementation may begin.*

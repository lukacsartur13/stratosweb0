# Phase 8 — design audit

The qualitative reading of `_build/reports/phase8-route-matrix.json`. Nothing
here has been changed yet; §3 forbids deleting routes or content during the
inventory stage.

---

## 1. What the current subpage system actually is

All 33 generated routes share one template: the `SHELL` string in
`_build/build.py`, filled with a fragment from `_build/pages/`. The fragment
vocabulary is small and, on its own terms, good:

| primitive | class | role |
|---|---|---|
| page head | `.phead` | breadcrumb + H1 + lede, above the first band |
| band | `.band`, `.band--tight`, `.band--pale` | vertical rhythm and the light/dark alternation |
| wrap | `.wrap` | max-width + gutter |
| split grid | `.grid.g-split` | asymmetric label/content pairing |
| column grids | `.g-2 .g-3 .g-4` | equal columns |
| sticky grid | `.g-sticky` | sticky label column beside long content |
| eyebrow | `.eyebrow` | technical micro-label with a leading rule |
| display type | `.display` + `.h-xl/.h-lg/.h-md/.h-sm` | the four heading sizes |
| lede / prose | `.lede`, `.prose` | two body measures |
| card | `.card`, `.card__k` | keyed unit block |
| button | `.btn`, `.btn--ghost`, `.btn-row` | primary / secondary CTA |
| text link | `.tlink` | underline-on-hover inline CTA |
| altimeter rail | `.rail` | the shared homepage signal, `aria-hidden` |

This is already close to what §7 asks for. **Phase 8 does not need to invent a
new visual language — it needs to finish this one.** The missing primitives are
named in §3 of this document.

### Card usage — §9 is not currently violated

17 `.card` elements across the whole site: 4 on `/kkv.html`, 6 on
`/nagyvallalat.html`, 4 on `/impact-program.html`, 3 on
`/ugyfelszolgalat.html`. Four pages have none at all. There is no
glassmorphism, no icon-box row, no pill inflation and no dashboard aesthetic.

The "card soup" risk in Phase 8 is therefore **prospective, not present**: it
would be introduced by solving the work index and the new service sections with
card grids. It is a constraint on new work, not a cleanup task.

---

## 2. The real problems

### 2.1 Release blocker — forms are invisible to Netlify

Covered in full in `phase8-baseline.md` §4. Summary: the site has never used
Netlify Forms; everything posts JSON to `/api/lead` → Supabase. Zero
`data-netlify` attributes exist in the published output, and the three
questionnaire routes contain no `<form>` element at all.

### 2.2 The questionnaire routes are empty documents

`/arajanlat.html`, `/en/quote.html`, `/de/angebot.html` serve:

* **0 H1**
* **2 meaningful words**
* **1 empty section**
* no form, no CTA, no content

Everything is built by `assets/js/quote.{hu,en,de}.js` after load. The
consequences reach past Netlify:

* no title-matching content for search, on the highest-intent route on the site;
* nothing at all without JavaScript;
* the skip link lands on an empty `<main>`;
* the route cannot be audited, screenshotted or content-compared meaningfully.

### 2.3 51 questions, one per screen

The wizard authors 51 questions with conditional branching between an SME and
an enterprise track. Even after branching, a visitor answers roughly thirty
single-question screens before reaching any contact alternative. §20 explicitly
forbids forcing users through an excessively long questionnaire before offering
one, and §21 requires a visible completion-time estimate and a meaningful
progress indicator.

The design questions (`Formavilág:` — rounded versus squared; `Színek:`;
`Milyen stílus tetszik leginkább?`) are presented as **text-only radio
options**. §21 requires these to be visual.

### 2.4 Every route is missing canonical, Open Graph and structured data

| | homepage | the other 33 |
|---|---|---|
| `rel="canonical"` | yes | **no** |
| `hreflang` set | yes | yes |
| `og:title` / `og:image` | yes | **no** |
| `twitter:card` | yes | **no** |
| JSON-LD | no | **no** |

A shared link to any subpage currently previews with no title, no description
and no image. This is a §28 item, cheap to fix in `SHELL`, and it applies to
all three locales at once.

### 2.5 The blog lists six articles that do not exist

`/blog.html` renders six article teasers. The only `href` values anywhere on
the page are `index.html`, `blog.html`, `arajanlat.html` and
`ugyfelszolgalat.html`. **No article has a destination.** Six headlines, six
images, six excerpts, and nothing to click.

This is the clearest instance of §3's "routes that lack a clear next action",
and it is also a trust problem: the page promises an editorial programme that
does not exist behind it.

### 2.6 Seven Hungarian routes are body-orphans

Reachable only through the shared nav dropdown and the footer, never linked
from the body of another page:

```
/rolunk.html  /kkv.html  /nagyvallalat.html  /branding.html
/hirdeteskezeles.html  /impact-program.html  /impresszum.html
```

There is **no services overview page**. A visitor who does not open the nav
dropdown has no path from any page into any service page. Related-service and
cross-service links do not exist.

### 2.7 The section rhythm is identical on every service page

All four service pages run the same six beats in the same order:

```
phead  →  thesis band  →  what we deliver  →  process  →  FAQ  →  "Felszállás" CTA
```

with the same `.eyebrow` → `.display h-md` → content structure inside each. The
closing CTA band is titled "Felszállás" on every page including About, Blog and
Impact. §12 asks for controlled variation between hero types and §22 for a CTA
hierarchy that differs by page intent; today there is one hero composition and
one closing CTA for the entire site.

### 2.8 CTA destinations are inconsistent across locales

The primary CTA of the same page points at different archetypes depending on
locale and page:

| page key | hu | en | de |
|---|---|---|---|
| sme | `arajanlat` | `quote` | `angebot` |
| enterprise | `ugyfelszolgalat` | `contact` | `kontakt` |
| branding | `ugyfelszolgalat` | `contact` | `kontakt` |
| ads | `arajanlat` | `quote` | `angebot` |
| impact | `#jelentkezes` | `#jelentkezes` | `#jelentkezes` |

The locale mapping is internally consistent, but two service pages send the
visitor to the questionnaire and two to the contact page, with no stated reason
— and the Impact anchor is the **Hungarian** id `#jelentkezes` on all three
locales, which works but reads as untranslated markup.

### 2.9 No image carries intrinsic dimensions

0 of 51 images have `width`/`height` attributes. Every one is a CLS risk, and
none has a `srcset`. All are single-format JPEG/PNG; there is no AVIF or WebP
anywhere. §24 covers this.

### 2.10 One image cannot legally ship

`cruise-jet.jpg` — Gulfstream press photo, already flagged in
`assets/img/FORRASOK.md` as requiring permission. It must be replaced or
licensed before launch, and no Phase 8 hero may be built on it.

---

## 3. Primitives §7 asks for that do not exist yet

| primitive | status |
|---|---|
| page shell | exists (`SHELL` + `.shell`) |
| navigation offset | exists |
| editorial hero | exists as one composition — needs the §12 variants |
| eyebrow / technical label | exists |
| display heading | exists |
| intro paragraph | exists (`.lede`) |
| section marker | **missing** — no numbered or coordinate section index |
| content grid | exists |
| media frame | partial — `.shot` / `figcaption` on one page only |
| metric block | **missing** |
| process timeline | **missing** — process sections are prose + grids |
| capability list | **missing** — capabilities are cards or prose |
| testimonial block | **missing** (and no verified testimonial exists to fill it) |
| case-study preview | **missing** |
| related-content block | **missing** |
| CTA block | exists as one fixed composition |
| form shell | exists (`.form`, `.field`, `.check`, `.form__status`) |
| footer handoff | exists |
| breadcrumb | exists (`.crumbs`) — absent on questionnaire and legal routes |

---

## 4. Archetypes that do not exist

| archetype | current state |
|---|---|
| service overview | none — services live only in the nav dropdown |
| work / portfolio index | none |
| case study | none |

Real material for the work archetype, from §8 of the baseline: Rapidkert Kft.,
Barbershop Győr, mentaltrening.com (screenshots + categories), Pille Sewing
(logo only). **No results, figures or testimonials exist for any of them.**
Under §16/§17 that supports a work index with honest project entries, and at
most concise case studies covering client, context, work delivered and visual
character — with results left out rather than invented.

---

## 5. What is working and must not be disturbed

* The homepage (`/`, `/en/`, `/de/`) — Phase 6/6.5/7, accepted, out of scope.
* The Meridian rails, cloud timeline, DPR and MSAA policy, transition
  architecture.
* `assets/css/transitions.css` + `assets/js/transitions.js` — the Phase 7
  cross-document transition language, already shared by every route.
* The altimeter rail on subpages: a restrained carry of the homepage identity
  that costs nothing and is correctly `aria-hidden`.
* The `/api/lead` server-side validation stack (rate limit, honeypot, minimum
  fill time, column caps, source allow-list, IP hashing, explicit insert
  columns).
* The three-locale generator and its `hreflang` contract.
* Self-hosted fonts, the tight CSP, and the measured font-preload policy.
* Subpage weight: 43 KB gzip of shared CSS+JS, with no homepage WebGL leakage.

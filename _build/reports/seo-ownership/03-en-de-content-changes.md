# English and German content changes

Eight retargeted pages. Every change below was made by editing a value in
`_build/i18n/*.json` or the slug table in `_build/build.py`. **No Hungarian
string, heading, title, description, canonical or body sentence was modified.**

The five Hungarian *files* that show in `git diff` changed only in their
`hreflang` alternates and language-switcher hrefs, which now name the renamed
EN/DE URLs. Phase D requires that. Verified: nothing else in them differs.

---

## A note on the H1s, because the treatment is deliberately not uniform

The brief permits a brand-led H1 to stay visually authored, and forbids turning
premium copy into SEO sludge. Both were applied, and the line between them was
drawn on whether the existing English or German H1 said anything about the
page's subject:

- **Replaced** where the H1 was *generic* — "Four services, one system" and
  "Every build, one partner" describe no topic and would suit any agency. Both
  replacements keep the exact editorial cadence, line break and `<span class="sig">`
  structure of the original; only the noun changed.
- **Kept** where the H1 was *specific and vivid* — "The demand is already there.
  It isn't finding you.", "The basket is not the finish line. It is the start.",
  "A website without the big upfront cost." These are the strongest lines on the
  site. Each sits under a retargeted `<title>`, breadcrumb, lede and section
  structure that carry the term unambiguously.

The SEO page is the clearest case: it owns the highest-value cluster in the
research (3,600 / KD 19) and its H1 still contains no keyword at all. That is the
brief's own instruction being followed, not an oversight.

---

## EN — `/en/bespoke-web-design` (was `/en/services`)

| | |
| --- | --- |
| **Primary** | `bespoke web design` — 2,400 / KD 22 — commercial |
| **Secondary** | bespoke website design · bespoke web design agency · creative web design · custom web design · custom website design · bespoke websites · custom website agency |
| **Old title** | `Web design, branding, SEO and advertising \| Stratos` |
| **New title** | `Bespoke Web Design Agency \| Custom Websites \| Stratos` (53 chars) |
| **Old H1** | `Four services,<br>one system.` |
| **New H1** | `Bespoke web design,<br>and the system around it.` |
| **Meta** | Rewritten. Leads with the primary, names the differentiator (built from code, not templates), and frames the other three services as one system. |
| **Sections changed** | Breadcrumb `Services` → `Bespoke web design`. Two service-card headings retargeted as descriptive internal anchors. Lede closes on "bespoke web design sits at the centre of four services". |
| **Internal links** | Cards to SME and enterprise re-anchored `Web design for small businesses` / `Web development for enterprises` — descriptive, and deliberately *not* exact-match repeats of this page's own primary. |
| **Not targeted** | `b2b web design agency` (owned by the development page) · `web design services for small business` (owned by the SME page) · `ecommerce web design agency` (owned by the ecommerce page) |

## EN — `/en/bespoke-web-development` (was `/en/web-design-enterprise`)

| | |
| --- | --- |
| **Primary** | `bespoke web development` — 1,000 / KD 25 — commercial |
| **Secondary** | bespoke website development (880 / KD 16) · website development agency (2,900 / KD 38) · web design and development services (1,300 / KD 22) · website design and development services (880 / KD 26) · **b2b web design agency (880 / KD 28)** · b2b website design agency (720 / KD 25) |
| **Old title** | `Web design for enterprises \| Stratos` |
| **New title** | `Bespoke Web Development Agency \| Custom Platforms \| Stratos` (59 chars) |
| **Old H1** | `Every build,<br>one partner.` |
| **New H1** | `Bespoke web development,<br>one partner.` |
| **Meta** | Rewritten around outgrowing templates, custom platforms and web apps, integrations, operations under SLA. |
| **Sections changed** | Breadcrumb added — it was **untranslated** and had been rendering the Hungarian string on the English and German pages. Now `Services / Bespoke web development` and `Leistungen / Webentwicklung`. Lede opens "Bespoke web development for custom platforms…". |
| **Internal links** | Unchanged; already correct. |
| **Not targeted** | `bespoke web design` (owned by the hub). The design/development split is real and matches the page: design, UX, visual system and conversion on the hub; custom engineering, APIs, integrations, automation and advanced functionality here. |
| **Merged intent — flagged** | The B2B cluster has no separate page and sits here as secondary. See note 2 in `01`. |

## EN — `/en/seo-consultancy` (was `/en/seo`)

| | |
| --- | --- |
| **Primary** | `seo consultancy` — 3,600 / KD 19 — commercial |
| **Secondary** | seo consultant (8,100 / KD 26) · b2b seo services (1,600 / KD 14) · small business seo services (1,900 / KD 18) · professional seo services (4,400 / KD 37) · search engine optimisation agency (2,900 / KD 33) · seo services · seo consulting · technical seo · on-page seo · local seo |
| **Old title** | `Search engine optimisation (SEO) \| Stratos` |
| **New title** | `SEO Consultancy \| Technical, Content & Local SEO \| Stratos` (58 chars) |
| **Old H1** | `The demand is already there.<br>It isn't finding you.` |
| **New H1** | **Unchanged** — see the note above. |
| **Meta** | Rewritten: leads with the primary, promises *enquiries reported, not rankings*, names technical SEO, content architecture, keyword research and local search, and monthly measurement. Promises no ranking or revenue outcome. |
| **Sections changed** | Breadcrumb `SEO` → `SEO consultancy`. Lede now reads "SEO consultancy is the work of making sure your page is what comes back." |
| **Existing depth left alone** | The page already answers the commercial questions the brief lists — what Stratos does, who it is for, technical SEO, content architecture, keyword research, local SEO, ecommerce SEO, measurement, monthly reporting, ongoing optimisation, and how SEO relates to conversion. It also already states what Stratos will not do (no bought links, no keyword-stuffed copy, no first-place guarantee, and no engagement at all where ads or a better site would return more). That is real methodology, so it was left as written rather than replaced with generic SEO copy. |
| **Not targeted** | `how much does seo cost` and `what is seo` — informational, and owned by the blog. |

## EN — `/en/ecommerce-web-design` (was `/en/online-store`)

| | |
| --- | --- |
| **Primary** | `ecommerce web design agency` — 1,900 / KD 30 — commercial |
| **Secondary** | ecommerce website design agency (1,300 / KD 31) · ecommerce web design · ecommerce website development · online store design · ecommerce website agency |
| **Old title** | `Online store development \| Stratos` |
| **New title** | `Ecommerce Web Design Agency \| Custom Online Stores \| Stratos` (60 chars) |
| **Old H1** | `The basket is not the finish line.<br>It is the start.` |
| **New H1** | **Unchanged** — vivid and specific. |
| **Meta** | Rewritten to lead on ecommerce web design and development, from code not a template, naming product data, payments, delivery and stock integration. |
| **Sections changed** | Breadcrumb → `Ecommerce web design`. Lede shifted from "In an online store the design is the least of it" to "In ecommerce, design is the least of it" — introduces the vocabulary without the page appearing to disown the thing it now ranks for. |
| **Not targeted** | Platform-name queries (Shopify/WooCommerce maintenance and similar). Stratos builds from code; those queries want a platform specialist. |

## EN — `/en/web-design-small-business` (was `/en/web-design-sme`)

| | |
| --- | --- |
| **Primary** | `web design services for small business` — 720 / KD 17 — commercial |
| **Secondary** | small business web design · website maintenance plans (590 / KD 9) and website support and maintenance (1,000 / KD 21), **as plan-descriptive terms only** |
| **Old title** | `Web design for SMEs — a website on a monthly fee \| Stratos` |
| **New title** | `Web Design Services for Small Business \| Stratos` (48 chars) |
| **Old H1** | `A website<br>without the big<br>upfront cost.` |
| **New H1** | **Unchanged** — it is the page's entire commercial argument. |
| **Meta** | Rewritten to lead with the primary and keep the fixed-monthly-fee differentiator. |
| **Sections changed** | Breadcrumb → `Web design for small business`. |
| **Cannibalization control** | This page is an **audience** page; `/en/bespoke-web-design` is the **category** page. The distinction the brief asks for holds: the hub sells bespoke web design as a product, this page sells it to a named buyer on a specific commercial model. The hub does not target `for small business`; this page does not target the bare `bespoke web design` cluster. Overlap: **LOW**. |
| **Not targeted** | `website maintenance services` · `website maintenance uk` · `website maintenance company` · `website support services` — all standalone-provider intent, which Stratos does not sell. See note 3 in `01`. |

---

## DE — `/de/website-erstellen-lassen` (was `/de/leistungen`)

| | |
| --- | --- |
| **Primary** | `Website erstellen lassen`, with agency intent — commercial |
| **Secondary** | website erstellen lassen agentur (880 / KD 24) · agentur website erstellen (880 / KD 22) · responsive webdesign agentur (880 / KD 10) · professionelles webdesign · individuelles webdesign · webdesign agentur · individuelle website |
| **Old title** | `Webdesign, Branding, SEO und Werbung \| Stratos` |
| **New title** | `Website erstellen lassen \| Webdesign Agentur \| Stratos` (54 chars) |
| **Old H1** | `Vier Leistungen,<br>ein System.` |
| **New H1** | `Website erstellen lassen,<br>mit System.` |
| **Meta** | Rewritten: names the intent and the agency framing, then *individuelles Webdesign aus Code statt Baukasten*, with Branding, SEO and Werbung as one system. |
| **Sections changed** | Breadcrumb `Leistungen` → `Website erstellen lassen`. Card headings → `Website für kleine Unternehmen`, `Webentwicklung für Großunternehmen`. Lede recast so the primary appears as the natural verb phrase German buyers use: *"Wer eine Website erstellen lassen möchte, bekommt bei uns deshalb vier Leistungen."* |
| **Deliberately not forced** | `responsive webdesign agentur` has the lowest difficulty (KD 10) but the weakest commercial positioning — it describes a technique, not a purchase. It sits in the secondary cluster and did not become the primary, exactly as the brief allows. |

## DE — `/de/webentwicklung-agentur` (was `/de/webdesign-grossunternehmen`)

| | |
| --- | --- |
| **Primary** | `webentwicklung agentur` — 1,900 / KD 34 — commercial |
| **Secondary** | agentur für webentwicklung (1,300 / KD 35) · agentur webentwicklung (720 / KD 35) · individuelle webentwicklung · webentwicklung unternehmen |
| **Old title** | `Webdesign für Großunternehmen \| Stratos` |
| **New title** | `Webentwicklung Agentur \| Individuelle Plattformen \| Stratos` (59 chars) |
| **Old H1** | `Jede Entwicklung,<br>ein Partner.` |
| **New H1** | `Individuelle Webentwicklung,<br>ein Partner.` |
| **Meta** | Rewritten around organisations beyond Baukästen: individuelle Plattformen und Web-Apps, Systemintegrationen, Betrieb mit SLA. |
| **Sections changed** | Breadcrumb added (was rendering untranslated Hungarian) → `Leistungen / Webentwicklung`. Lede opens `Webentwicklung für individuelle Plattformen…`. |
| **Not targeted** | `webdesign agentur` — owned by `/de/website-erstellen-lassen`. Technical development and design intent stay separate, which the existing service architecture supports. |

## DE — `/de/seo-betreuung` (was `/de/suchmaschinenoptimierung`)

| | |
| --- | --- |
| **Primary** | `SEO Betreuung` — 3,600 / KD 20 — commercial |
| **Secondary** | seo dienstleistungen (1,600 / KD 14) · professionelle suchmaschinenoptimierung (1,900 / KD 20) · agentur für suchmaschinenoptimierung (1,900 / KD 23) · professionelle seo beratung (1,300 / KD 17) · seo dienstleistung (1,300 / KD 20) · suchmaschinenoptimierung agentur (3,600 / KD 36) |
| **Old title** | `Suchmaschinenoptimierung (SEO) \| Stratos` |
| **New title** | `SEO Betreuung \| Technik, Inhalte und lokale Suche \| Stratos` (59 chars) |
| **Old H1** | `Die Nachfrage ist längst da.<br>Sie findet Sie nicht.` |
| **New H1** | **Unchanged.** |
| **Meta** | Rewritten: *SEO Betreuung, die Anfragen ausweist statt Platzierungen* — technisches SEO, Inhaltsarchitektur, Keyword-Recherche, lokale Suche, monatlich gemessen. |
| **Sections changed** | Breadcrumb `SEO` → `SEO Betreuung`. Lede now `SEO Betreuung sorgt dafür, dass dann Ihre Seite erscheint.` The page's formal *Sie* register was preserved. |
| **Explicitly not used** | `gute SEO Agentur` (1,900 / KD 22). There is no way to place it in German prose without the page calling itself good. The brief's instruction not to stuff it was followed literally. |

---

## The internal link graph — Phase M

Service-page anchors are not written per page. Three surfaces — the header
dropdown, the full-screen menu panel, and the footer of all 87 generated routes —
all render from one table, `UI[lang]["svc"]`. So the anchor pointing at a service
page is the same string in every one of those places, and it is the anchor the
whole site uses.

After the retargeting those anchors were stale in a way that mattered: the
English menu still offered **"Web design for enterprises"** and the German one
**"Webdesign für Großunternehmen"** for a page that is now a *web development*
page, and both locales still said the bare **"SEO"** for pages now selling SEO
consultancy and SEO Betreuung. A site-wide anchor describing a page as something
it no longer is, is the single highest-leverage internal-link defect available,
because it repeats on every route.

| Route | Old anchor (EN) | New anchor (EN) | Old anchor (DE) | New anchor (DE) |
| --- | --- | --- | --- | --- |
| sme | Web design for SMEs | Web design for small business | Webdesign für KMU | *unchanged* |
| enterprise | Web design for enterprises | Web development | Webdesign für Großunternehmen | Webentwicklung |
| seo | SEO | SEO consultancy | SEO | SEO Betreuung |
| shop | Online stores | Ecommerce | Onlineshop | *unchanged* |
| branding · ads · impact | — | *unchanged* | — | *unchanged* |

The homepage's ground-control service list links the same routes and had the same
problem; its enterprise line now reads `Bespoke web development for enterprises`
in English and `Webentwicklung für Großunternehmen` in German.

**Anchor diversity was kept deliberately.** These anchors are shortened forms
(`Web development`, `SEO consultancy`), not repetitions of each page's full
primary keyword. The hub's own service cards use a third phrasing again
(`Web design for small businesses`, `Web development for enterprises`). No page
is linked from everywhere by an identical exact-match string.

**Verified after the change:** 0 broken internal links across 6,965 internal
links on 115 built pages, and the menu, dropdown and footer were checked visually
in both English and German at desktop width — no overflow, no clipping. The one
label long enough to wrap in the narrow header dropdown, `Web design for small
business`, wraps cleanly onto two lines with the row growing to fit.

### One label change that was reverted

`UI[lang]["menu"]` was edited first, on the assumption that it fed the menu.
It does not: `build_menu()` renders that table only for `MENU_PRIMARY`
(`index`, `about`, `services`, `work`, `blog`, `contact`), so its `sme`,
`enterprise`, `shop`, `seo` entries render nowhere. Confirmed by grepping the
built output for the new strings — zero occurrences. Those edits were reverted
rather than left in place, because dead data that reads like an updated
navigation is worse than no edit at all.

---

## Pages deliberately not touched

`/en/branding` · `/en/ads-management` · `/en/impact-program` · `/de/branding` ·
`/de/werbeanzeigen` · `/de/impact-programm` · `/de/webdesign-kmu` ·
`/de/onlineshop-erstellung`, plus all case studies, blog posts and utility pages
in both locales.

No keyword figures were supplied for these and the brief forbids inventing
targets. Their URLs, titles, descriptions and copy are byte-identical to before.

## Performance guardrail

No library, script, client-side metadata, hidden text or keyword DOM block was
added. All changes are static text inside HTML the generator already emitted.
The page shell, CSS and JS are untouched; `assemble.mjs` reports the same 26
shared assets and the same 254.9 KB minified as before. All semantic content is
in the static HTML.

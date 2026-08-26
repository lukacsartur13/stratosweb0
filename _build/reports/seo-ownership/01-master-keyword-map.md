# Keyword ownership master map

Stratos, `https://stratosweb.hu` — Hungarian at the root, English under `/en/`,
German under `/de/`. One search intent, one dominant page, one primary keyword.

Generated as part of the EN/DE keyword ownership pass. English and German are
**implemented**; Hungarian is **audit only** and nothing Hungarian was changed —
see `04-hu-cannibalization.md`.

---

## How this site is actually built, and why it constrains the answer

Three facts about the repository decided most of the choices below, so they are
worth stating before the table rather than defending afterwards.

**1. There is one slug table, and everything is derived from it.**
`_build/build.py` holds `SLUGS`; `_build/routes.json` is its export. Canonical
URLs, the hreflang set, the sitemap, the nav, the footer, breadcrumbs, JSON-LD
`@id`/`url`, and every in-body internal link are all generated from it. Renaming
`SLUGS["seo"]["en"]` moved all of them in one edit. No hand-updating was needed
and none was done.

**2. English and German are not separate documents — they are translations.**
Each `_build/i18n/*.json` maps a Hungarian string to `["<english>", "<german>"]`.
`build.py` renders the Hungarian fragment, then substitutes. This is why the
Hungarian freeze was cheap to honour: **every English and German title,
description, heading and sentence in this pass was retargeted by editing a
dictionary value, and not one Hungarian byte was touched.**

It also imposes a real limit, and it is the one thing in this brief that could
not be delivered as written. **New EN/DE-only content sections are not
expressible.** A dictionary value can be rewritten to be richer, longer or
differently angled, but a paragraph that exists in English and not in Hungarian
has no Hungarian key to hang on. So "rewritten SEO copy" was delivered;
"expanded with new sections" was not, and could not be without either editing
the Hungarian source (forbidden this phase) or adding a locale-override
mechanism to the generator (a build change well outside an SEO pass). Flagged
here rather than quietly skipped.

**3. URLs are extensionless.** `absolute()` strips `.html`; the canonical for
`kkv.html` is `/kkv`. So the brief's "or, if this repository consistently uses
`.html` service URLs" branch does not apply — the new slugs are extensionless,
matching the 78 routes already live. This also decided the redirect targets; see
`02-url-migration.md`.

---

## English — implemented

UK search behaviour, natural British commercial English, not translated Hungarian.

| Locale | Current URL | Final URL | Page | Primary | Secondary cluster | Search intent | Overlap risk | Action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| en | `/en/services` | `/en/bespoke-web-design` | Service hub — web design | `bespoke web design` (2,400 / KD 22) | bespoke website design · bespoke web design agency · creative web design · custom web design · custom website design · bespoke websites | commercial | LOW — hub owns the head term, spokes own qualified terms | RENAME URL · RETARGET · REWRITE |
| en | `/en/web-design-enterprise` | `/en/bespoke-web-development` | Custom platforms, integrations, SLA | `bespoke web development` (1,000 / KD 25) | bespoke website development · website development agency · web design and development services · b2b web design agency · b2b website design agency | commercial | MEDIUM — absorbs the B2B cluster, see note 2 | RENAME URL · RETARGET · REWRITE · MERGE INTENT |
| en | `/en/seo` | `/en/seo-consultancy` | SEO service | `seo consultancy` (3,600 / KD 19) | seo consultant · b2b seo services · small business seo services · professional seo services · search engine optimisation agency · technical seo · on-page seo · local seo | commercial | NONE | RENAME URL · RETARGET · REWRITE |
| en | `/en/online-store` | `/en/ecommerce-web-design` | Webshop build | `ecommerce web design agency` (1,900 / KD 30) | ecommerce website design agency · ecommerce web design · ecommerce website development · online store design | commercial | NONE | RENAME URL · RETARGET · REWRITE |
| en | `/en/web-design-sme` | `/en/web-design-small-business` | SME website on a monthly fee | `web design services for small business` (720 / KD 17) | small business web design · website maintenance plans *(secondary only — note 3)* | commercial | LOW — audience page, not category | RENAME URL · RETARGET |
| en | `/en/branding` | *(unchanged)* | Branding and identity | — | — | commercial | NONE | KEEP — unresearched, note 4 |
| en | `/en/ads-management` | *(unchanged)* | Google/Meta ads | — | — | commercial | NONE | KEEP — unresearched, note 4 |
| en | `/en/impact-program` | *(unchanged)* | Free nonprofit websites | — | — | commercial | NONE | KEEP |
| en | `/en/work` + 3 cases | *(unchanged)* | Proof | — | — | commercial investigation | NONE | KEEP — link sources, see `03` |
| en | `/en/blog` + 10 posts | *(unchanged)* | Guides | — | — | informational | LOW | KEEP — note 5 |
| en | `/en/about` `/en/contact` `/en/quote` `/en/privacy-policy` `/en/imprint` | *(unchanged)* | Non-commercial | — | — | navigational / transactional | NONE | KEEP |

### Resulting English ownership

```text
Bespoke Web Design         /en/bespoke-web-design          bespoke web design cluster
Web Development            /en/bespoke-web-development     bespoke web development cluster + B2B
SEO                        /en/seo-consultancy             SEO consultancy cluster
Ecommerce                  /en/ecommerce-web-design        ecommerce web design agency cluster
Small Business             /en/web-design-small-business   web design services for small business
Maintenance                — no owner                      note 3
```

---

## German — implemented

German commercial vocabulary, not translated English primaries.

| Locale | Current URL | Final URL | Page | Primary | Secondary cluster | Search intent | Overlap risk | Action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| de | `/de/leistungen` | `/de/website-erstellen-lassen` | Service hub — Website | `Website erstellen lassen` + agency intent | website erstellen lassen agentur (880 / KD 24) · agentur website erstellen (880 / KD 22) · responsive webdesign agentur (880 / KD 10) · professionelles webdesign · individuelles webdesign · webdesign agentur · individuelle website | commercial | LOW | RENAME URL · RETARGET · REWRITE |
| de | `/de/webdesign-grossunternehmen` | `/de/webentwicklung-agentur` | Plattformen, Integrationen, SLA | `webentwicklung agentur` (1,900 / KD 34) | agentur für webentwicklung (1,300 / KD 35) · agentur webentwicklung (720 / KD 35) · individuelle webentwicklung · webentwicklung unternehmen | commercial | NONE | RENAME URL · RETARGET · REWRITE |
| de | `/de/suchmaschinenoptimierung` | `/de/seo-betreuung` | SEO service | `SEO Betreuung` (3,600 / KD 20) | seo dienstleistungen (1,600 / KD 14) · professionelle suchmaschinenoptimierung (1,900 / KD 20) · agentur für suchmaschinenoptimierung (1,900 / KD 23) · professionelle seo beratung (1,300 / KD 17) · seo dienstleistung (1,300 / KD 20) · suchmaschinenoptimierung agentur (3,600 / KD 36) | commercial | NONE | RENAME URL · RETARGET · REWRITE |
| de | `/de/webdesign-kmu` | *(unchanged)* | KMU-Website zur Monatsgebühr | — | — | commercial | LOW | KEEP — unresearched, note 4 |
| de | `/de/onlineshop-erstellung` | *(unchanged)* | Onlineshop | — | — | commercial | NONE | KEEP — unresearched, note 4 |
| de | `/de/branding` `/de/werbeanzeigen` `/de/impact-programm` | *(unchanged)* | — | — | — | commercial | NONE | KEEP — unresearched, note 4 |
| de | `/de/projekte` + 3 · `/de/blog` + 10 · `/de/ueber-uns` `/de/kontakt` `/de/angebot` `/de/datenschutz` `/de/impressum` | *(unchanged)* | — | — | — | mixed | LOW | KEEP |

### Resulting German ownership

```text
Main Website Page   /de/website-erstellen-lassen   Website erstellen lassen / Webdesign Agentur
Web Development     /de/webentwicklung-agentur     Webentwicklung Agentur
SEO                 /de/seo-betreuung              SEO Betreuung
Maintenance         — no owner                      note 3
```

`gute SEO Agentur` (1,900 / KD 22) was deliberately **not** used. There is no way
to place it in German prose without it reading as self-congratulation. The rest
of the cluster is covered by natural phrasing.

---

## Hungarian — audit only, nothing changed

Full analysis and ranked findings in `04-hu-cannibalization.md`.

| Locale | Current URL | Page | Apparent target | Overlap risk | Action |
| --- | --- | --- | --- | --- | --- |
| hu | `/szolgaltatasok` | Service hub | `weboldal készítés` | **HIGH OVERLAP** | REVIEW |
| hu | `/kkv` | KKV website | `weboldal készítés` + `keresőoptimalizált weboldal készítés` | **HIGH OVERLAP** | REVIEW |
| hu | `/nagyvallalat` | Enterprise | `weboldal készítés` + `weboldal fejlesztés` + `céges weboldal készítés` | **HIGH OVERLAP** | REVIEW |
| hu | `/keresooptimalizalas` | SEO | `keresőoptimalizálás` | **OVERLAP** (with the blog post) | REVIEW |
| hu | `/blog-keresooptimalizalas` | SEO guide | `keresőoptimalizálás` | **OVERLAP** | REVIEW |
| hu | `/branding` | Branding | `logó tervezés` | OVERLAP | REVIEW |
| hu | `/blog-logo-keszites` | Logo guide | `logó készítés` | OVERLAP | REVIEW |
| hu | `/webshop-keszites` | Webshop | `webshop készítés` | OK | OK |
| hu | `/hirdeteskezeles` | Ads | `hirdetéskezelés` | OK | OK |
| hu | `/blog-weboldal-arak` | Pricing guide | `weboldal árak` | OVERLAP (with `/kkv`) | REVIEW |
| hu | `/blog` + 8 other posts | Guides | informational | OK | OK |
| hu | `/munkaink` + 3 cases · `/rolunk` `/ugyfelszolgalat` `/arajanlat` `/impact-program` `/adatkezelesi-tajekoztato` `/impresszum` | — | — | OK | OK |

---

## Notes

**Note 1 — "the existing main English web design page" did not exist.**
The brief assumes one. The site has a four-service hub (`/en/services`) and two
*audience* pages (SME, enterprise); none was a web-design product page. The hub
was made the owner, because a hub taking the head term while its spokes take
audience-qualified terms is the arrangement with the least internal competition.
Giving `bespoke web design` to the SME page instead would have put two clusters
on one page and left the hub owning nothing — strictly worse.

**Note 2 — B2B was merged into web development, not given its own page.**
The brief wants `bespoke web development` and `b2b web design agency` separately
owned. Only one page exists for both (`/en/web-design-enterprise`), and it is
genuinely a development page: custom platforms, web apps, system integration,
design systems, security and compliance, dedicated team, operations under SLA.
Its primary is therefore `bespoke web development`, and the B2B terms sit under
it as secondary. **This is an unavoidable overlap and is reported as instructed.**
No new page was created, per the no-proliferation rule.

**Note 3 — the maintenance cluster has no honest owner, and was not forced.**
`website maintenance services` (1,600 / KD 12) plus `website support` (1,600 /
KD 9) is the strongest low-difficulty cluster in the research, and the German
equivalent `Website Betreuung` (1,000 / KD 9) is stronger still. There is no
maintenance page in any locale. The nearest thing is the SME page, and its own
copy settles the question:

> "A weboldal karbantartás a havidíj része: biztonsági frissítés, mentés,
> tárhely, tartalommódosítás és hibajavítás. **Nem kell külön megrendelned**, és
> nem érkezik róla külön számla."
> — *maintenance is part of the monthly fee; you do not order it separately.*

Someone searching `website maintenance services` already has a website and wants
it looked after. Stratos does not sell that. Ranking a "build me a new site on a
monthly plan" page for that query buys clicks it converts badly and misrepresents
the offer. The brief's own rule — *Stratos service truth overrides keyword
volume* — decides it.

What was done instead: the SME page keeps `hosting and ongoing maintenance` in
its description, which truthfully reaches `website maintenance plans` (590 /
KD 9) and `website support and maintenance` (1,000 / KD 21) as **secondary**
terms describing the plan. Deliberately **not** targeted: `website maintenance
services`, `website maintenance uk`, `website maintenance company`, `website
support services` — all standalone-provider intent.

*Recommendation for a later phase, not implemented:* if Stratos will sell
standalone maintenance, this is the highest-return page the site does not have,
in both EN and DE. That is a service decision, not an SEO one.

**Note 4 — unresearched pages were left alone.**
Branding, ads, impact in EN and DE; and SME, ecommerce, branding, ads in DE. The
brief supplies no German figures for them and forbids speculative targets, so
their URLs, titles and descriptions are untouched. They are listed so the gap is
visible, not so it looks covered.

**Note 5 — blog cannibalization in EN/DE is currently low and was left alone.**
The English and German posts are translations of the Hungarian ones. Their titles
are question-shaped (`How much does a website cost?`, `What is SEO?`) against
service pages that are now noun-shaped (`SEO Consultancy`, `Bespoke Web Design`),
so intent separation is already clean. The Hungarian originals are *not* clean —
that is finding 2 in `04-hu-cannibalization.md`, and fixing it there would
propagate to all three locales at once.

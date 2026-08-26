# Hungarian ownership repair — implemented

The four approved fixes from `04-hu-cannibalization.md`, implemented. No
Hungarian URL changed, no page was created or removed, and the English and
German ownership architecture from the previous phase is intact and verified.

---

## A. Before

Three confirmed collisions, ranked in `04`:

**CRITICAL — three pages title-targeted `weboldal készítés`.**

| URL | Title | Signal |
| --- | --- | --- |
| `/szolgaltatasok` | **Weboldal készítés**, branding, SEO, hirdetés \| Stratos | T |
| `/kkv` | **Weboldal készítés** KKV-nak havidíjban \| Stratos | T + H |
| `/nagyvallalat` | **Weboldal készítés** nagyvállalatoknak \| Stratos | T + H |

Three titles opening on the same three words, all indexable, all in the sitemap.

**HIGH — service page and blog post both title-targeted `keresőoptimalizálás`.**
`/keresooptimalizalas` (*Keresőoptimalizálás (SEO)*) and
`/blog-keresooptimalizalas` (*Keresőoptimalizálás: mi ez és mennyibe kerül?*)
both led with the bare commercial noun.

**MEDIUM — `logó tervezés` vs `logó készítés`.** `/branding` owned
`logó tervezés` in an H2 only; `/blog-logo-keszites` owned `logó készítés` in
both title and H1 — so the article outranked the page that sells the service.

### One correction to the earlier audit

`04` reported that `helyi keresőoptimalizálás`, `webáruház
keresőoptimalizálás`, `keresőoptimalizálás ügynökség` and `keresőoptimalizálás
szakértő` appeared "only in body copy — never in a heading". **That was wrong.**
It came from a scan that looked at `<h1>`/`<h2>` and not `<h3>`. All four already
had their own `<h3>` on `/keresooptimalizalas`, each with a substantial,
specific paragraph beneath it.

This changed what item 4 needed to be. The sub-intents did not need headings
invented for them; they needed the **H2 above them to stop describing only half
the section**. That is what was done, and no filler was written.

---

## B. Final ownership map

| URL | Final primary ownership | Secondary cluster | Intent |
| --- | --- | --- | --- |
| `/szolgaltatasok` | `weboldal készítés` | egyedi weboldal készítés · professzionális weboldal készítés · céges weboldal készítés | commercial |
| `/kkv` | `KKV weboldal készítés` — monthly-fee model | havidíjas weboldal készítés · weboldal kisvállalkozásoknak · keresőoptimalizált weboldal készítés · weboldal karbantartás | commercial |
| `/nagyvallalat` | `weboldal fejlesztés` | céges weboldal fejlesztés · egyedi webfejlesztés · vállalati weboldal · egyedi platformok · webes rendszerfejlesztés · integrációk · SLA | commercial |
| `/keresooptimalizalas` | `keresőoptimalizálás` (commercial) | keresőoptimalizálás ügynökség · keresőoptimalizálás szakértő · SEO ügynökség · SEO szakértő · helyi keresőoptimalizálás · webáruház keresőoptimalizálás | commercial |
| `/blog-keresooptimalizalas` | `mi az a keresőoptimalizálás` | mennyibe kerül a SEO · google keresőoptimalizálás ingyen · mennyi idő, mire látszik | informational |
| `/branding` | `logó tervezés` + `logó készítés` | arculattervezés · márkaépítés · vizuális arculat | commercial |
| `/blog-logo-keszites` | `mire figyelj logó készítésnél` | mit kérj a logótervezőtől · gyakori logótervezési hibák · mit kell megkapnod | informational |
| `/webshop-keszites` | `webshop készítés` (unchanged) | webáruház készítés | commercial |

Build intent and SEO intent stay distinct: `/webshop-keszites` keeps
`webshop készítés`, while `webáruház keresőoptimalizálás` sits on the SEO page
as a sub-intent. No ecommerce-SEO page and no local-SEO page was created.

---

## C. Exact changes

### `/szolgaltatasok` — dominant owner of `weboldal készítés`

| | |
| --- | --- |
| Old title | `Weboldal készítés, branding, SEO, hirdetés \| Stratos` |
| New title | `Weboldal készítés — négy szolgáltatás, egy rendszer \| Stratos` |
| Old H1 | `Négy szolgáltatás,<br>egy rendszer.` |
| New H1 | `Weboldal készítés,<br>és a rendszer körülötte.` |
| Breadcrumb | `Szolgáltatások` → `Weboldal készítés` |
| Copy | The lede now closes *"Ezért áll a weboldal készítés a négy szolgáltatásunk közepén"*. The capabilities list item became *"Egyedi weboldal készítés HTML, CSS és JavaScript alapon…"*; its note now reads *"…a céges weboldal készítéstől a kampányokig"*; the scope paragraph now reads *"A professzionális weboldal készítés terjedelmét és árát…"*. |

The old title was a four-item keyword list. The new one leads with the primary
and then states the page's actual proposition, which is also its H1.

### `/kkv` — stops competing as a generic head-term page

| | |
| --- | --- |
| Old title | `Weboldal készítés KKV-nak havidíjban \| Stratos` |
| New title | `Havidíjas weboldal készítés KKV-knak \| Stratos` |
| Old H1 | `Weboldal,<br>nagy egyszeri költség nélkül.` |
| New H1 | **unchanged** — it is the page's whole commercial argument, and it never claimed the head term |
| Breadcrumb | `Weboldal készítés KKV-nak` → `Havidíjas weboldal KKV-knak` |
| Meta | now opens `Havidíjas weboldal kisvállalkozásoknak:` instead of `Weboldal készítés kisvállalkozásoknak:` |
| Lede | now opens `Weboldal kisvállalkozásoknak:` before the monthly-fee list |

The word order carries the whole fix. The title still contains `weboldal
készítés` — the brief allows that — but it no longer *opens* on it, so the page
reads as the monthly-fee variant rather than a second general owner.

### `/nagyvallalat` — owner of `weboldal fejlesztés`

| | |
| --- | --- |
| Old title | `Weboldal készítés nagyvállalatoknak \| Stratos` |
| New title | `Weboldal fejlesztés nagyvállalatoknak \| Stratos` |
| Old H1 | `Minden fejlesztés,<br>egy partnerrel.` |
| New H1 | `Minden webfejlesztés,<br>egy partnerrel.` |
| Breadcrumb | `Weboldal nagyvállalatoknak` → `Weboldal fejlesztés` |
| Meta | now opens `Weboldal fejlesztés nagyvállalatoknak:` |
| H2 changed | `Céges weboldal készítés és weboldal fejlesztés.` → `Céges weboldal fejlesztés és egyedi platformok.` |
| H3 changed | `Céges weboldal készítés` → `Vállalati weboldal` |
| Copy | the card paragraph now opens *"A vállalati weboldal a bemutatkozó felület…"*; the SLA card now closes *"A céges weboldal fejlesztés akkor kész…"* |

`weboldal készítés` is now absent from every heading on this page. The section
still draws its genuine distinction between the presentation site and the
system behind it — only the vocabulary moved to `fejlesztés`.

### `/keresooptimalizalas` — commercial SEO owner

| | |
| --- | --- |
| Old title | `Keresőoptimalizálás (SEO) \| Stratos` |
| New title | `Keresőoptimalizálás \| SEO ügynökség és szakértő \| Stratos` |
| H1 | **unchanged** — `A kereslet már megvan. Téged nem talál.` is the strongest line on the site, and the brief permits a brand-led H1 where the title and headings carry the intent |
| H2 changed | `Ügynökség vagy szakértő? Mindkettő.` → `Ügynökség, szakértő, helyi vagy webáruház?` |
| Eyebrow | `Kinek szól` → `Melyikre van szükséged` |
| H3s | **unchanged** — `Keresőoptimalizálás ügynökség`, `Keresőoptimalizálás szakértő`, `Helyi keresőoptimalizálás`, `Webáruház keresőoptimalizálás` already existed with real supporting copy |

The old H2 named two of the four things beneath it and the eyebrow said "who
it's for", which was true of two cards and not the other two. The section now
asks the question its four cards answer. **Nothing was added to host a keyword.**

### `/blog-keresooptimalizalas` — clearly informational

| | |
| --- | --- |
| Old title | `Keresőoptimalizálás: mi ez és mennyibe kerül? \| Stratos` |
| New title | `Mi az a keresőoptimalizálás, és mennyibe kerül? \| Stratos` |
| Old H1 | `Keresőoptimalizálás: mi ez és mennyibe kerül?` |
| New H1 | `Mi az a keresőoptimalizálás, és mennyibe kerül?` |
| Internal link | the outbound anchor to the service page changed from the bare `Keresőoptimalizálás` to **`SEO ügynökség és szakértő`** |

The phrase is retained, as instructed — it now sits inside a question instead of
opening the title as a commercial noun.

**The H1 was also the anchor text for this article on four other pages** (the
blog index and three sibling posts). All five moved together, so every internal
link still names the article by its real title.

### `/branding` — commercial owner of the logo cluster

| | |
| --- | --- |
| Old title | `Branding és arculattervezés \| Stratos` |
| New title | `Logó tervezés és arculattervezés \| Stratos` |
| H1 | **unchanged** — `Egy szín. Egy szlogen. És te jutsz eszükbe.` |
| H2 | **unchanged** — `Logó tervezés, ami bélyegméretben is működik.` |
| H3 changed | `Változatok minden méretre` → `Logó készítés minden méretre` |
| Meta | now opens `Logó tervezés és teljes arculat:` |
| Copy | the logo section's lede now opens *"A logó készítés nem rajzolással kezdődik…"* while the card copy keeps `logó tervezés` |

The page now owns both Hungarian phrasings of one intent: `logó tervezés` in the
title and H2, `logó készítés` in an H3 and the section lede. The H3 it took over
already described producing the logo in every size and format, so it hosts the
phrase without a word of filler. The title keeps `arculattervezés` so the page
is not reduced to a logo-only service — branding here is broader than the mark.

### `/blog-logo-keszites` — advisory

| | |
| --- | --- |
| Old title | `Logó készítés: mit kérj, és mit ne fogadj el? \| Stratos` |
| New title | `Mire figyelj logó készítésnél: mit kérj, mit ne? \| Stratos` |
| Old H1 | `Logó készítés: mit kérj, és mit ne fogadj el?` |
| New H1 | `Mire figyelj logó készítésnél: mit kérj, mit ne?` |
| Internal link | the related card's anchor changed from `Branding és arculattervezés` to **`Logó tervezés és arculat`**; the CTA button below it deliberately **keeps** `Branding és arculattervezés` |

Two different anchors now point at `/branding` from this one article, so the
commercial page is not linked by a single repeated string. As with the SEO
article, the H1 doubled as the anchor label on two other pages; all three moved
together.

### Internal link ownership, summarised

| From | To | Anchor |
| --- | --- | --- |
| `/blog-keresooptimalizalas` | `/keresooptimalizalas` | `SEO ügynökség és szakértő` *(was `Keresőoptimalizálás`)* |
| `/blog-logo-keszites` | `/branding` | `Logó tervezés és arculat` *(was `Branding és arculattervezés`)* |
| `/blog-logo-keszites` (CTA) | `/branding` | `Branding és arculattervezés` *(unchanged — kept for anchor variation)* |
| `/blog`, `/blog-google-cegprofil`, `/blog-online-marketing`, `/blog-weboldal-arak` | `/blog-keresooptimalizalas` | `Mi az a keresőoptimalizálás, és mennyibe kerül?` |
| `/blog`, `/blog-webdesign` | `/blog-logo-keszites` | `Mire figyelj logó készítésnél: mit kérj, mit ne?` |

---

## D. EN/DE regression verification

Hungarian is the **source** locale: `_build/i18n/*.json` is keyed *by* the
Hungarian string. Editing Hungarian without renaming its key orphans the
translation, and `build.py` then falls back to the Hungarian text — so the
English and German pages would silently start showing Hungarian. That is the one
failure mode this phase could have caused, so every Hungarian edit was made
through a helper that renames the key and carries the approved English and
German values across in the same operation.

Two guards were used continuously rather than at the end:

1. **`_build/missing-en.json` / `missing-de.json`.** `build.py` writes these when
   a string has no translation. They were absent before this phase and absent
   after every single edit. An orphaned key would have created them immediately.
2. **A full-text scan** of all 60 built English and German pages for Hungarian
   vocabulary (`weboldal`, `készítés`, `fejlesztés`, `keresőoptimalizálás`,
   `logó`, `arculattervezés`, `ügynökség`, `szakértő`, …), excluding the `hu`
   hreflang tag and the i18n JSON data block. **0 pages leaked.**

The eight previously-implemented routes, re-verified from `dist`:

| Route | URL | Title | H1 intent | Canonical | hreflang self |
| --- | --- | --- | --- | --- | --- |
| `/en/bespoke-web-design` | unchanged | `Bespoke Web Design Agency \| Custom Websites \| Stratos` | unchanged | self | ok |
| `/en/bespoke-web-development` | unchanged | `Bespoke Web Development Agency \| Custom Platforms \| Stratos` | unchanged | self | ok |
| `/en/seo-consultancy` | unchanged | `SEO Consultancy \| Technical, Content & Local SEO \| Stratos` | unchanged | self | ok |
| `/en/ecommerce-web-design` | unchanged | `Ecommerce Web Design Agency \| Custom Online Stores \| Stratos` | unchanged | self | ok |
| `/en/web-design-small-business` | unchanged | `Web Design Services for Small Business \| Stratos` | unchanged | self | ok |
| `/de/website-erstellen-lassen` | unchanged | `Website erstellen lassen \| Webdesign Agentur \| Stratos` | unchanged | self | ok |
| `/de/webentwicklung-agentur` | unchanged | `Webentwicklung Agentur \| Individuelle Plattformen \| Stratos` | unchanged | self | ok |
| `/de/seo-betreuung` | unchanged | `SEO Betreuung \| Technik, Inhalte und lokale Suche \| Stratos` | unchanged | self | ok |

Spot-checked beyond the eight: `/en/branding` still titles *Branding and
identity design* and its H3 still reads *A version for every size* — both
survived the Hungarian rename of the key they hang on. The English and German
blog titles were already question-led (*What is SEO, and what does it cost?*,
*Was ist SEO, und was kostet es?*), so the intent separation this phase created
in Hungarian already existed in those locales and needed no change.

**Result: no English or German regression.**

---

## E. Remaining known overlaps — intentionally untouched

| Overlap | Status | Why |
| --- | --- | --- |
| `/kkv` ↔ `/blog-weboldal-arak` — pricing | **untouched, as instructed** | Classified MEDIUM in `04`. The blog keeps `mennyibe kerül egy weboldal` / `weboldal árak`; `/kkv` keeps its `Weboldal készítés árak, kiszámíthatóan` section and its monthly model. Not rewritten for theoretical purity. |
| `/blog` index vs its own posts | untouched | LOW. Normal index/leaf overlap that Google resolves without help. |
| City keywords — `weboldal készítés Győr` / `Budapest` | **no page created, no routing changed** | The Győr route was deliberately withdrawn and 301s to `/szolgaltatasok`; the reasoning is recorded in `netlify.toml`. The positioning decision stands. |
| `keresőoptimalizált weboldal készítés` — heading owner is `/kkv`, not `/szolgaltatasok` | deliberate deviation, see below | |
| `/impact-program` has an `<h3>Weboldal készítés</h3>` | left alone | It is a process-step label on a page titled *Ingyenes weboldal nonprofitoknak*. Different intent, H3-level, and outside the four approved items. Recorded so it is visible, not fixed. |
| The homepage titles itself *Weboldal készítés és fejlesztés* | left alone | It claims both head terms alongside `/szolgaltatasok` and `/nagyvallalat`. A homepage and a category hub co-ranking for the category term is the normal arrangement rather than a collision, the homepage is Vite-built and outside the routes this phase governs, and homepage changes were not among the four approved items. **The guard prints this exemption on every run** rather than filtering the homepage out silently. |

### The one deliberate deviation from the brief

The brief lists `keresőoptimalizált weboldal készítés` as a **strong secondary
for `/szolgaltatasok`**. It was not given to that page's headings, and it stays
where it already was: an `<h2>`/`<h3>` pair on `/kkv`, describing the SEO work
baked into the monthly fee.

The reason is the phase's own primary goal. `/kkv` is currently the *sole*
heading-level claimant of that phrase — which is not a collision. Adding it to
`/szolgaltatasok` at heading level would have created a second claimant and
manufactured exactly the kind of two-page competition this phase exists to
remove. `/szolgaltatasok` instead carries the other three secondaries
(`egyedi`, `professzionális`, `céges weboldal készítés`) in body copy, which is
what a secondary term should be.

Flagged for review rather than resolved silently. If you would rather the hub
own it, the fix is to reword `/kkv`'s H2 away from the phrase in the same edit —
not to add it in two places.

---

## F. Validation results

| Check | Result |
| --- | --- |
| Ownership guard (`npm run audit:ownership:check`) | **pass** — 4/4 head terms single-owner, 2/2 intent pairs separated |
| Guard fails on a reintroduced collision | **verified** — restoring the old `/kkv` and blog titles in `dist` produced 3 collisions and exit code 1; restoring the correct titles returned exit 0 |
| Technical SEO audit (`npm run audit:seo`) | **0 failing**, 18 warnings — all 18 the pre-existing `hreflang-noindex` on the two deliberately-`summary` case studies |
| Broken internal links | **0** across 6,157 internal links |
| Untranslated Hungarian leaked into EN/DE | **0** across all 60 EN/DE pages; `missing-en.json` / `missing-de.json` never created |
| Canonical | all HU canonicals unchanged; all EN/DE canonicals self-referential and unchanged |
| hreflang | reciprocal and self-inclusive on every checked route |
| Sitemap | 81 entries; all 7 changed HU URLs present; **no old EN/DE URL reappeared** |
| HU URL changes | **none** — slug table and canonical table byte-identical to `HEAD` for every Hungarian route |
| HU pages added or removed | **none** |
| Conversion audit | unchanged from baseline (0 wrong-locale, 0 unlabelled CTA) |
| Test suite (`--project=node`) | **210 passed, 1 skipped, 1 failed** of 212 |

The one test failure is `gate-independence.spec.ts`, caused by the repository
secret scan matching a JWT-shaped literal in minified React vendor code inside
`dist/portal/assets/index-BIu_eqY2.js`. That bundle predates this session and
nothing in `portal/` was touched. Pre-existing and unrelated — the same failure
was recorded in `02-url-migration.md` for the previous phase.

### The guard

`scripts/seo-ownership.mjs`, wired as `npm run audit:ownership[:check]` and
enforced by `tests/seo-ownership.spec.ts` in the `node` project.

It reads `dist` and answers one question no other check in this repository asks:
for each commercial head term, **how many Hungarian pages claim it, and is the
claimant the page that should own it?** The collision it protects against was
invisible to everything else — all three pages had unique titles, self-
referential canonicals and reciprocal hreflang sets, and every existing rule
passed, because a rule that looks at one page at a time cannot see three pages
competing for one query.

It understands qualifiers, which is the part that matters: `Havidíjas weboldal
készítés` is not a claim on `weboldal készítés`. Without that, the guard would
forbid the very arrangement it exists to protect. It also asserts that each
service/article pair stays separated — the article's title must be a question,
the service page's must not.

It matches literal strings in `<title>`, `<h1>` and `<h2>`. No scoring, no
keyword counting, no NLP.

---

## Pass criteria

```text
[x] /szolgaltatasok is the clear owner of weboldal készítés
[x] /kkv no longer competes as a generic head-term page
[x] /nagyvallalat clearly owns weboldal fejlesztés
[x] /keresooptimalizalas owns commercial SEO intent
[x] SEO blog is clearly informational
[x] local SEO sub-intent is represented naturally where supported
[x] ecommerce SEO sub-intent is represented naturally where supported
[x] branding owns commercial logó tervezés/logó készítés intent
[x] logo blog remains informational
[x] no HU URLs changed
[x] pricing overlap untouched
[x] city pages not created
[x] EN ownership not regressed
[x] DE ownership not regressed
[x] no broken links
[x] no untranslated HU source strings leaked into EN/DE
[x] ownership regression guard passes
```

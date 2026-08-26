# Hungarian cannibalization report — analysis only

**Nothing Hungarian was changed.** No URL, title, H1, meta, body copy, internal
link, canonical or blog target. The five Hungarian files that appear in
`git diff` differ only in their `hreflang` alternates and language-switcher
hrefs, which now name the renamed English and German URLs — required by Phase D
and not a Hungarian SEO change.

The recommendations at the end are **not implemented** and await review.

---

## Method, and why "appears in the body" was thrown away

The first pass counted every occurrence in page source and produced nonsense:
`keresőoptimalizálás`, `weboldal készítés` and `webshop készítés` each appeared
on all 28 Hungarian routes. That is the global menu and footer, which link every
service from every page.

Cannibalization is about what a page *claims to be*, so the analysis below counts
a page as targeting a term only when it appears in the **`<title>`** or in an
**`<h1>`/`<h2>`**. Body mentions are noted as supporting evidence, never as
ownership.

---

## Findings, ranked by expected impact

### 1. CRITICAL — three indexable pages title-target `weboldal készítés`

| URL | Title | Signal |
| --- | --- | --- |
| `/szolgaltatasok` | **Weboldal készítés**, branding, SEO, hirdetés \| Stratos | T |
| `/kkv` | **Weboldal készítés** KKV-nak havidíjban \| Stratos | T + H |
| `/nagyvallalat` | **Weboldal készítés** nagyvállalatoknak \| Stratos | T + H |

Three titles, all beginning with the same head term, all indexable, all in the
sitemap, all linked from the global menu with similar anchors. This is the most
dangerous pattern on the Hungarian site: Google has to choose between three
Stratos pages for the site's single most valuable commercial query, and the
qualifiers (`KKV-nak`, `nagyvállalatoknak`) are weak differentiators inside a
title that opens identically.

**Are the intents genuinely distinct?** Partly, and that is what makes this
fixable rather than fatal. `/szolgaltatasok` is a category hub. `/kkv` is an
audience page with a distinct commercial model (fixed monthly fee, no large
upfront cost). `/nagyvallalat` is genuinely a *development* page — egyedi
platformok, rendszerintegráció, design system, biztonság és megfelelőség,
dedikált fejlesztőcsapat, üzemeltetés és SLA. Three real intents wearing one
name.

**Best owner:** `/szolgaltatasok` for the bare `weboldal készítés` head term.

**What would need changing:** the two audience pages stop opening on the head
term and lead with what actually separates them — the monthly model for `/kkv`,
`weboldal fejlesztés` / `céges weboldal készítés` for `/nagyvallalat`, which
their own H2s already own cleanly.

> This is exactly the problem the English and German pass just solved, and the
> shape of the fix is already proven in this repository: hub takes the category
> term, audience pages take audience-qualified terms, the technical page takes
> the development cluster. See `01-master-keyword-map.md`.

---

### 2. HIGH — service page and blog post both title-target `keresőoptimalizálás`

| URL | Title | Type |
| --- | --- | --- |
| `/keresooptimalizalas` | **Keresőoptimalizálás** (SEO) \| Stratos | service, commercial |
| `/blog-keresooptimalizalas` | **Keresőoptimalizálás**: mi ez és mennyibe kerül? \| Stratos | blog, informational |

Both carry the term in the title *and* in an H1/H2. This is the Phase L scenario
verbatim: an informational article competing with the service page for the core
service keyword.

**Are the intents genuinely distinct?** Yes — "what is it and what does it cost"
is informational, the service page is commercial. The problem is the *signals*,
not the content. The post's title leads with the bare noun rather than the
question, so it reads to a crawler as a second landing page for the same term.

**Best owner:** `/keresooptimalizalas` for commercial `keresőoptimalizálás`;
the post keeps `mi az a keresőoptimalizálás`, `keresőoptimalizálás ára`,
`google keresőoptimalizálás ingyen` — which it already covers and which the
service page should not chase.

**What would need changing:** lead the post's title with its question rather than
the bare term, and make its in-body link to the service page the primary
conversion path.

---

### 3. MEDIUM — `/kkv` and `/blog-weboldal-arak` both answer the pricing question

| URL | Signal |
| --- | --- |
| `/kkv` | H2 `Weboldal készítés árak, kiszámíthatóan` |
| `/blog-weboldal-arak` | Title + H1 `Mennyibe kerül egy weboldal 2026-ban?` |

Different wording, same SERP intent — commercial investigation, someone pricing a
website. Not currently severe, because the phrasings differ enough that Google
can tell them apart, and the service page's section is short. Worth watching
rather than fixing first.

**Best owner:** the blog post for `weboldal árak` / `mennyibe kerül egy weboldal`;
`/kkv` for `weboldal készítés árak` in the specific sense of *its* pricing model.

---

### 4. MEDIUM — `logó tervezés` vs `logó készítés`

| URL | Signal |
| --- | --- |
| `/branding` | H2 `Logó tervezés` |
| `/blog-logo-keszites` | Title + H1 `Logó készítés: mit kérj, és mit ne fogadj el?` |

Different exact phrases, and in Hungarian **the same SERP intent** — this is
precisely the case the brief says not to judge on wording alone. Someone typing
`logó tervezés` and someone typing `logó készítés` want the same thing.

**Are the intents genuinely distinct?** Only partly. The post is advisory ("what
to ask for, what not to accept"), which is a real informational angle. But it is
the stronger page on the phrase today, and `/branding` — the page that sells the
service — owns the term only in an H2.

**Best owner:** `/branding` for both commercial phrasings; the post for the
advisory long tail.

---

### 5. LOW — blog index vs its own posts

`/blog` titles `webdesign és online marketing tippek`; `/blog-webdesign` and
`/blog-online-marketing` title those terms directly. Normal index/leaf overlap,
resolved by Google without help. **No action.**

---

## Terms with no owner at all

These appear **only in body copy** — never in a title, never in a heading — so
nothing on the Hungarian site currently claims them:

| Term | Where it appears now | Note |
| --- | --- | --- |
| `weboldal karbantartás` | `/kkv` body | Same service-truth constraint as EN/DE: maintenance is bundled into the monthly fee and cannot be ordered separately. See note 3 in `01`. |
| `helyi keresőoptimalizálás` | `/keresooptimalizalas` body + tag chip | Local intent, no heading owns it |
| `webáruház keresőoptimalizálás` | `/keresooptimalizalas` body + tag chip | Could sit with `/webshop-keszites` or the SEO page — needs a decision, not a guess |
| `keresőoptimalizálás ügynökség` | `/keresooptimalizalas` body | Commercial, unclaimed |
| `keresőoptimalizálás szakértő` | `/keresooptimalizalas` body | Same SERP intent as the above in practice |
| `weboldal készítés győr` · `weboldal készítés budapest` | `/kkv` body only | The Győr route was **deliberately withdrawn** and 301s to `/szolgaltatasok`; `netlify.toml` records the reasoning — a one-city route contradicted the three-language positioning. Any city strategy is a positioning decision, not an SEO one. |

On the semantic-overlap question the brief raises: `keresőoptimalizálás
szakértő`, `SEO szakértő` and `keresőoptimalizálás ügynökség` are one intent in
Hungarian, not three. They want one owner — `/keresooptimalizalas` — and would be
actively harmful as three pages.

---

## Overlap classification summary

| Overlap | URLs | Queries | Intents distinct? | Best owner | Class |
| --- | --- | --- | --- | --- | --- |
| Head web-design term | `/szolgaltatasok` · `/kkv` · `/nagyvallalat` | `weboldal készítés` | partly — hub / audience / development | `/szolgaltatasok` | **CRITICAL** |
| SEO head term | `/keresooptimalizalas` · `/blog-keresooptimalizalas` | `keresőoptimalizálás` | yes — commercial vs informational | `/keresooptimalizalas` | **HIGH** |
| Pricing | `/kkv` · `/blog-weboldal-arak` | `weboldal árak`, `weboldal készítés árak` | mostly | blog for the general query | **MEDIUM** |
| Logo | `/branding` · `/blog-logo-keszites` | `logó tervezés`, `logó készítés` | partly — same SERP intent | `/branding` | **MEDIUM** |
| Blog index vs posts | `/blog` · 2 posts | `webdesign`, `online marketing` | yes | posts | **LOW** |
| Webshop | `/webshop-keszites` | `webshop készítés` | — single owner | itself | **NONE** |
| Ads | `/hirdeteskezeles` | `hirdetéskezelés` | — single owner | itself | **NONE** |
| Case studies, utility pages | 9 routes | — | — | — | **NONE** |

---

## Recommended Hungarian changes

**Not implemented. Listed in the order they would pay off.**

1. **Break the three-way `weboldal készítés` collision.** Let `/szolgaltatasok`
   own the head term. Retitle `/kkv` around its monthly-fee model and
   `/nagyvallalat` around `weboldal fejlesztés` / `céges weboldal készítés`,
   both of which those pages' own H2s already own. Highest-impact change
   available on the Hungarian site. **No URL change needed** — titles, H1
   emphasis and internal anchors are enough.

2. **Separate the SEO post from the SEO service page.** Lead
   `/blog-keresooptimalizalas` with its question rather than the bare noun, and
   make its link to `/keresooptimalizalas` the primary path out.

3. **Give `/keresooptimalizalas` explicit headings for the sub-intents it
   already serves** — helyi keresőoptimalizálás, webáruház keresőoptimalizálás,
   keresőoptimalizálás ügynökség/szakértő. All are in the body already; none is
   claimed by a heading. This is heading structure, not new content, and it
   needs no new pages.

4. **Decide the logo owner.** `/branding` is the commercial page and should own
   both `logó tervezés` and `logó készítés`; the post keeps the advisory angle.

5. **Watch the pricing overlap.** No change recommended yet.

6. **Do not create city pages** without a positioning decision first. The
   repository already withdrew one for a documented reason.

### One thing worth knowing before deciding

Hungarian is the **source language** of this site. English and German are
generated from it through `_build/i18n/*.json`. So a Hungarian heading or title
change does not stay Hungarian: unless the corresponding dictionary values are
updated in the same edit, it will either propagate to English and German or
leave them showing untranslated Hungarian.

That is a reason to sequence the Hungarian phase deliberately — but it is also
the reason recommendation 1 is cheaper than it looks. The English and German
sides of that exact collision are **already fixed**, so the Hungarian fix
converges the three locales rather than splitting them.

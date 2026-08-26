# Hungarian ownership micro-fix — `keresőoptimalizált weboldal készítés`

One keyword moved between two pages. Nothing else about the Hungarian
architecture changed: no URL, no new page, no redirect, no sitemap entry, no
homepage signal, and no English or German page — all 60 EN/DE pages are
byte-identical to their pre-fix build.

This closes the one deliberate deviation recorded in `05-hu-implemented.md`
section E. That phase left the phrase on `/kkv` because moving it there would
have created a second claimant; the brief for this phase resolves that by
removing the `/kkv` claim in the same edit, which is exactly what was done.

---

## Before / after

```text
Before:
keresőoptimalizált weboldal készítés
→ /kkv        (h2 + h3)

After:
keresőoptimalizált weboldal készítés
→ /szolgaltatasok   (h2)
```

Final Hungarian commercial map — the part this phase governs:

```text
/szolgaltatasok
  weboldal készítés                       title + h1   (unchanged)
  keresőoptimalizált weboldal készítés    h2           (new owner)

/kkv
  havidíjas weboldal készítés             title + h2   (strengthened)
  weboldal készítés KKV-knak              title        (unchanged)

/nagyvallalat
  weboldal fejlesztés                     title + h1   (untouched)
```

---

## Exact changes

Five Hungarian strings, in two files. Every one went through the key-rename
mechanism from the previous phase, so the approved English and German values
travelled with it.

### `/szolgaltatasok` — one heading

The phrase was given the section-05 heading (`Amit be tudunk vállalni`), whose
old text was a label that said nothing a reader needed. The list beneath it
already opens with *Egyedi weboldal készítés HTML, CSS és JavaScript alapon* and
already contains *Keresőoptimalizálás: szerkezet, sebesség, metaadatok és
szövegezés* — so the heading now names what the list is, and **not one word of
copy was added**.

| | |
| --- | --- |
| Old h2 | `A négy szolgáltatás mögötti képességek` |
| New h2 | `Keresőoptimalizált weboldal készítés` |
| EN/DE kept | `The capabilities behind the four services` · `Die Fähigkeiten hinter den vier Leistungen` |

Nothing else on the page moved. Title, h1, meta description, breadcrumb, lede,
the `Kombinációk` section and the capability list are byte-identical:

```diff
248c248
-  <h2 class="display h-sm" style="max-width:18ch">A négy szolgáltatás mögötti képességek</h2>
+  <h2 class="display h-sm" style="max-width:18ch">Keresőoptimalizált weboldal készítés</h2>
```

The page's supporting signals for the phrase were already present and were left
alone rather than multiplied: the `Weboldal és SEO együtt` definition item
(*"a keresőoptimalizálás nagy része szerkezet, sebesség és szöveg — ezek az oldal
építése közben ingyen vannak, utólag átépítés"*) and the capability list line.
One exact heading plus existing body copy is a strong secondary. Repeating the
phrase in the title, the meta description and a `<dt>` as well would have been
keyword-stuffing, which the brief forbids.

**A first attempt was rejected on layout.** The heading was initially written as
`A keresőoptimalizált weboldal készítéstől a kampányokig`, to span the list from
its first item to its last. Measured in the browser it set 5 lines on desktop
and 5 on mobile, against 2–4 for every other `h2` on the page — the longest
heading there. The bare nominative phrase sets **3 lines at both breakpoints**,
one fewer than the heading it replaced on desktop, and needs no change to the
`max-width:18ch` it inherited. It is also the stronger match: nominative, not
inflected. The range it dropped is still stated by the note directly beneath,
which is unchanged.

### `/kkv` — heading claim removed, monthly-fee claim strengthened

| | Old | New |
| --- | --- | --- |
| Eyebrow | `A havidíjon belül` | `Ami benne van` |
| h2 | `Keresőoptimalizált`<br>`weboldal készítés,`<br>`karbantartással.` | `Havidíjas`<br>`weboldal készítés,`<br>`karbantartással.` |
| h3 | `Keresőoptimalizált weboldal készítés` | `SEO már az első verzióban` |

EN/DE kept, unchanged: `Inside the monthly fee` · `In der Monatsgebühr`;
`Search-optimised<br>web design,<br>maintenance included.` ·
`Suchmaschinen-<br>optimiertes Webdesign,<br>inklusive Wartung.`;
`Search-optimised web design` · `Suchmaschinenoptimiertes Webdesign`.

The h2 swaps one qualifier for another, which puts the page's approved **primary**
term into a heading for the first time — `havidíjas weboldal készítés` is now in
both the title and the h2. The eyebrow moved because `A havidíjon belül` sitting
directly above `Havidíjas weboldal készítés` reads as an echo; `Ami benne van`
is the section's own name in the source (`<!-- ami benne van -->`).

The h3 now says what its paragraph already said — *"a szerkezet, a címsorok, a
sebesség és a strukturált adat már az első verzióban rendben van"*. SEO stays a
feature of the offer, which is what it is.

**The phrase remains once in `/kkv` body copy**, opening that card's paragraph,
as the brief permits: it describes a real benefit of the monthly fee. Heading
occurrences on `/kkv`: **0**. Body occurrences: **1**.

### `/nagyvallalat`, homepage — untouched

No shared-key update was required, so neither was edited. `/nagyvallalat` keeps
`weboldal fejlesztés` in its title and h1. The homepage keeps
`Weboldal készítés és fejlesztés | Stratos`; the guard prints that exemption on
every run rather than filtering it out.

---

## Internal links — reviewed, none changed

Every internal anchor pointing at `/kkv` and `/szolgaltatasok` was inventoried
across all 29 Hungarian source pages:

| Destination | Anchors found |
| --- | --- |
| `kkv.html` | `Weboldal KKV-nak` ×15, `Weboldal készítés KKV-nak` ×2 |
| `szolgaltatasok.html` | `Minden szolgáltatás` ×7, `Szolgáltatások` ×1, `Megnézem a szolgáltatásokat` ×1 |

**No anchor anywhere on the site used `keresőoptimalizált weboldal készítés`**,
so nothing was reinforcing the phrase toward `/kkv` and nothing needed
repointing. The existing `/kkv` anchors are already KKV-specific rather than
broad-service, which is the arrangement item 7 asks for. Zero links changed —
this is a reviewed no-op, not a skipped step.

---

## The ownership guard

`scripts/seo-ownership.mjs` gained the transferred term and, for that term only,
a scan one level deeper:

```js
{ term: 'keresőoptimalizált weboldal készítés', owner: 'szolgaltatasok.html',
  qualifiers: [], h3: true },
```

`h3: true` widens the scan from `<title>`/h1/h2 down to h3. Only this term sets
it, and the reason is specific: `/kkv` held the phrase in **an h2 *and* an h3**,
so a guard that stopped at h2 would have reported the transfer complete while
half of it was still in place. The other four terms deliberately stay at h2 —
several pages legitimately carry them in an h3 (`Weboldal készítés árak` on
`/kkv`, `Keresőoptimalizálás` on `/szolgaltatasok`), and those are section labels
inside a page about something else, not claims on the query. Widening the scan
for all terms would have manufactured three false collisions.

The implementation stays what it was: literal string matching with qualifier
awareness, no scoring, no keyword counting.

### Guard result

```text
  ok    weboldal készítés                    -> /szolgaltatasok
  ok    keresőoptimalizált weboldal készítés -> /szolgaltatasok
  ok    weboldal fejlesztés                  -> /nagyvallalat
  ok    keresőoptimalizálás                  -> /keresooptimalizalas
  ok    logó tervezés                        -> /branding

  ok    /blog-keresooptimalizalas reads as informational
  ok    /blog-logo-keszites reads as informational

seo-ownership: no collisions          exit 0
```

### The guard was proven to fail

A guard that cannot fail is decoration. Three reintroductions were injected into
`dist` and each was caught:

| Injected into `dist` | Result |
| --- | --- |
| `/kkv` h3 restored to the phrase | **exit 1** — `claimed by 2 pages: /szolgaltatasok, /kkv` |
| `/kkv` h2 restored to the phrase | **exit 1** — same collision |
| `/szolgaltatasok` h2 reverted, nobody claims it | **exit 1** — `no page claims it; expected /szolgaltatasok` |
| correct state restored | exit 0 |

The third case matters as much as the first two: it stops the phrase from being
quietly dropped by a future edit rather than re-collided.

---

## Validation

| Check | Result |
| --- | --- |
| Ownership guard (`npm run audit:ownership:check`) | **pass** — 5/5 terms single-owner, 2/2 intent pairs separated |
| Guard fails on reintroduced collision | **verified**, three ways (above) |
| EN/DE regression | **0 of 60 pages changed** — full-tree `shasum` diff, byte-identical, including `en/index.html` and `de/index.html` |
| Untranslated Hungarian in EN/DE | **0** across 60 pages, comments and `hreflang="hu"` excluded |
| `missing-en.json` / `missing-de.json` | **never created** — no key was orphaned by any rename |
| Broken internal links | **0** across 7,852 links in 91 documents |
| Technical SEO audit (`npm run audit:seo:check`) | **0 failing**, 18 warnings — unchanged from baseline (all 18 the pre-existing `hreflang-noindex` on the two `summary` case studies) |
| HU URLs | **identical to HEAD** — 29 routes, slug table unchanged |
| HU pages added or removed | **none** |
| Sitemap | 81 entries, unchanged |
| Canonicals | `/szolgaltatasok` and `/kkv` self-referential and unchanged |
| hreflang | `hu, en, de, x-default` on both touched routes, reciprocal |
| Homepage | unchanged — `Weboldal készítés és fejlesztés \| Stratos` |
| Heading layout | no overflow, no horizontal page scroll, at 375 px and 1440 px |
| Test suite (`--project=node`) | **210 passed, 1 skipped, 1 failed** of 212 |

### Query → page, verified against `dist`

```text
weboldal készítés                      -> /szolgaltatasok
keresőoptimalizált weboldal készítés   -> /szolgaltatasok
havidíjas weboldal készítés            -> /kkv
weboldal készítés KKV-knak             -> /kkv
weboldal fejlesztés                    -> /nagyvallalat
```

### EN/DE routes named in the brief — all byte-identical

| Route | Title | Canonical | hreflang |
| --- | --- | --- | --- |
| `/en/bespoke-web-design` | `Bespoke Web Design Agency \| Custom Websites \| Stratos` | self | hu en de x-default |
| `/en/bespoke-web-development` | `Bespoke Web Development Agency \| Custom Platforms \| Stratos` | self | hu en de x-default |
| `/en/seo-consultancy` | `SEO Consultancy \| Technical, Content & Local SEO \| Stratos` | self | hu en de x-default |
| `/en/ecommerce-web-design` | `Ecommerce Web Design Agency \| Custom Online Stores \| Stratos` | self | hu en de x-default |
| `/en/web-design-small-business` | `Web Design Services for Small Business \| Stratos` | self | hu en de x-default |
| `/de/website-erstellen-lassen` | `Website erstellen lassen \| Webdesign Agentur \| Stratos` | self | hu en de x-default |
| `/de/webentwicklung-agentur` | `Webentwicklung Agentur \| Individuelle Plattformen \| Stratos` | self | hu en de x-default |
| `/de/seo-betreuung` | `SEO Betreuung \| Technik, Inhalte und lokale Suche \| Stratos` | self | hu en de x-default |

URL, title, h1 and canonical were verified for each; the byte-diff covers
everything else on those pages as well.

---

## Pre-existing failures — found, not caused, not fixed

Three things in the repository are red or wrong independently of this change.
They are recorded rather than quietly absorbed.

1. **`gate-independence.spec.ts` fails.** The repository secret scan matches a
   JWT-shaped literal in minified React vendor code inside
   `dist/portal/assets/index-BIu_eqY2.js`. Same bundle and same finding recorded
   in `05-hu-implemented.md`; nothing in `portal/` was touched.

2. **The conversion audit fails with 2 CTA integrity errors.** A CTA promising
   the full case study points at a `summary` case study, on
   `/de/seo-betreuung` → `/de/projekt-rapidkert` and `/en/seo-consultancy` →
   `/en/work-rapidkert`. All four pages involved are among the 60 proven
   byte-identical, so the failure exists identically in the pre-fix build. It
   predates this phase and is outside its scope. It was **not** clean at the
   start of this session and should be looked at separately.

3. **`dist/` contains 79 stale iCloud conflict copies** (`szolgaltatasok 3.html`
   and similar). They are not in `_build/pages/`, not in `routes.json` and not in
   the sitemap, so they ship nothing, but they inflate any raw scan of `dist`.
   Excluded from the link and leak scans above. Deleting them is a one-line
   cleanup that was not in this brief.

## Deviations from the brief, stated

- **Two `/kkv` secondaries from the brief's list are absent from the page**:
  `céges weboldal havidíjban` and `weboldal készítés havidíjban`. They were not
  added. The brief says `/kkv`'s ownership *should remain* that cluster, not that
  it should be extended, and inventing copy to host two more phrasings of a term
  the page already owns in its title and h2 is the keyword-stuffing the brief
  rules out. Flagged so the omission is visible.
- **Hungarian and English/German now say different things in four places.** The
  `/szolgaltatasok` h2 renders as *The capabilities behind the four services*,
  and the three `/kkv` strings still render their original English and German.
  That is the direct consequence of instruction 5 and 6 — preserve the approved
  EN/DE values while the Hungarian source string changes — and it is the correct
  trade in a site where the three locales own different keywords. Noted because
  it is invisible from the Hungarian side.

---

## Pass criteria

```text
[x] /szolgaltatasok clearly owns weboldal készítés
[x] /szolgaltatasok clearly owns keresőoptimalizált weboldal készítés
[x] /kkv no longer heading-targets keresőoptimalizált weboldal készítés
[x] /kkv remains the owner of havidíjas / KKV intent
[x] /nagyvallalat remains the owner of weboldal fejlesztés
[x] homepage unchanged
[x] no HU URL changed
[x] no new page created
[x] EN keyword ownership unchanged
[x] DE keyword ownership unchanged
[x] no Hungarian leaks into EN/DE
[x] ownership guard passes
[x] no broken links
```

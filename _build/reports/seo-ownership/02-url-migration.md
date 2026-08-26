# URL migration report

Eight renamed routes: five English, three German. Hungarian URLs unchanged.

Every rename is a **single hop** to the final canonical URL. No intermediate
redirects, no chains, no loops.

---

## Why the redirect targets are extensionless

This is the one detail in the migration that is easy to get wrong and invisible
when you do.

`absolute()` in `_build/build.py` strips `.html`, so the canonical, the hreflang
entries and the sitemap all name `/en/bespoke-web-design`. Netlify's **Pretty
URLs** setting 301s `/en/bespoke-web-design.html` → `/en/bespoke-web-design`.

So a redirect written as `to = "/en/bespoke-web-design.html"` would resolve:

```text
/en/services  ->  /en/bespoke-web-design.html  ->  /en/bespoke-web-design
```

Two hops, with the second one nowhere in `netlify.toml` and therefore invisible
to review. Pointing straight at the extensionless form makes each rule one hop
onto a 200 whether or not that dashboard setting is on.

The three pre-existing Győr rules had exactly this shape. Two of them also
pointed at routes this pass renamed, which would have made them
old → old → new — so `/en/web-design-gyor*` and `/de/webdesign-gyor*` were
repointed at the new URLs. The Hungarian one, `/weboldal-keszites-gyor*` →
`/szolgaltatasok.html`, was **left as it is**: fixing it means editing a
Hungarian route target, and Hungarian is frozen this phase. It is a pre-existing
one-extra-hop defect, not one this pass introduced. Listed here so the decision
is on the record.

---

## English

| Old URL | New URL | Redirect | Canonical | hreflang set | Internal links | Sitemap | Schema |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `/en/services` | `/en/bespoke-web-design` | 301, one hop | self | hu `/szolgaltatasok` · en `/en/bespoke-web-design` · de `/de/website-erstellen-lassen` · x-default hu | auto | old absent, new present | `@id`, `url`, breadcrumb |
| `/en/web-design-enterprise` | `/en/bespoke-web-development` | 301, one hop | self | hu `/nagyvallalat` · en new · de `/de/webentwicklung-agentur` · x-default hu | auto | old absent, new present | `@id`, `url`, breadcrumb, Service |
| `/en/seo` | `/en/seo-consultancy` | 301, one hop | self | hu `/keresooptimalizalas` · en new · de `/de/seo-betreuung` · x-default hu | auto | old absent, new present | `@id`, `url`, breadcrumb, Service |
| `/en/online-store` | `/en/ecommerce-web-design` | 301, one hop | self | hu `/webshop-keszites` · en new · de `/de/onlineshop-erstellung` · x-default hu | auto | old absent, new present | `@id`, `url`, breadcrumb, Service |
| `/en/web-design-sme` | `/en/web-design-small-business` | 301, one hop | self | hu `/kkv` · en new · de `/de/webdesign-kmu` · x-default hu | auto | old absent, new present | `@id`, `url`, breadcrumb, Service |

## German

| Old URL | New URL | Redirect | Canonical | hreflang set | Internal links | Sitemap | Schema |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `/de/leistungen` | `/de/website-erstellen-lassen` | 301, one hop | self | hu `/szolgaltatasok` · en `/en/bespoke-web-design` · de new · x-default hu | auto | old absent, new present | `@id`, `url`, breadcrumb |
| `/de/webdesign-grossunternehmen` | `/de/webentwicklung-agentur` | 301, one hop | self | hu `/nagyvallalat` · en `/en/bespoke-web-development` · de new · x-default hu | auto | old absent, new present | `@id`, `url`, breadcrumb, Service |
| `/de/suchmaschinenoptimierung` | `/de/seo-betreuung` | 301, one hop | self | hu `/keresooptimalizalas` · en `/en/seo-consultancy` · de new · x-default hu | auto | old absent, new present | `@id`, `url`, breadcrumb, Service |

"auto" is literal: `relink()` rewrites every in-body link from the slug table at
build time, and the nav, footer, menu, breadcrumb and language switcher are
generated from the same table. Nothing was updated by hand, so nothing could be
missed by hand.

---

## `/en/seo` is not a splat, and the rest are

Every other rule uses a splat to catch both the `.html` form the old sitemap
listed and the extensionless form the old internal links used. `/en/seo*` cannot,
because it matches `/en/seo-consultancy` — its own target. The only thing that
would have stopped that being a redirect loop is Netlify's static-file-wins
precedence, which is too subtle a thing to rest a rule on. The two forms are
declared explicitly instead. No other new slug shares a prefix with the old slug
it replaces; this was checked, not assumed.

---

## Two defects found during the migration

Both were pre-existing, both were invisible until a rename exposed them, and
both are now guarded so the class cannot return.

### 1. The generator left the old page on disk

Renaming a slug wrote the new file and left the old one in place. All eight old
files were still there, still tracked, and — the part that matters — still
carrying `<link rel="canonical" href="https://stratosweb.hu/en/services">`.

On Netlify a static file beats a redirect. So `/en/services` would have gone on
answering **200** from the stale copy, the 301 declared for it would never have
fired, and the old URL would have gone on nominating itself as canonical while
the new one nominated itself too. The rename would have created the exact
duplicate it existed to remove, and the sitemap would have looked correct
throughout.

`prune_renamed()` in `_build/build.py` now deletes them. It keys on the page's
own `data-page-key` rather than on the filename, so it only ever removes a file
this generator wrote for a route now served elsewhere — a hand-written page, an
asset, or an iCloud `<name> 2.html` copy carries no such attribute and is never a
candidate. All eight were pruned on the next build, by name, in the build log.

### 2. Eight internal links were hardcoded inside translations

`relink()` localises in-body links by resolving them through the Hungarian slug
table. That assumes the filenames in a page body are Hungarian. Eight of them
were not: a dictionary **value** may contain markup, and several contain a whole
`<a>`, where the translator had written the href in the language being
translated *into* — `href="web-design-sme.html"` in an English value,
`href="suchmaschinenoptimierung.html"` in a German one.

`relink()` runs after translation, saw those hrefs, found them absent from the
Hungarian table, and passed them through untouched. They had always worked
because they happened to be correct. This pass renamed five of the routes they
named, and all eight became 404s — on pages nobody edited, in links no Hungarian
page and no test could show as broken, because the Hungarian source they are
translations *of* was still right.

Fixed at source: all eight now carry the Hungarian filename, like the fragments
do, and `relink()` localises them per language. Two guards were added:

- `BY_ANY` — `relink()` now resolves a filename in **any** language back to its
  route, so a translation carrying a currently-valid foreign filename is
  normalised to the right one instead of shipping a cross-language link.
  Asserted unambiguous: no filename serves two routes.
- `check_dict_links()` — the build now **fails** if any dictionary value contains
  an `href` to a page filename that names no known route, naming the string.
  Verified by deliberately breaking one: the build stopped and named it.

---

## Post-migration verification

| Check | Result |
| --- | --- |
| 200 on every new canonical URL | 8/8 files generated and present in `dist` |
| 301 on every renamed old URL | 8/8 declared in `netlify.toml` |
| No redirect chains | targets are extensionless canonical form |
| No redirect loops | `/en/seo` made explicit; no other prefix collision |
| Self-canonical correct | 8/8 |
| hreflang reciprocal, self-included | 8/8, verified in built HTML |
| Language switcher correct | generated from slug table; HU pages' switchers updated |
| Sitemap correct | 81 entries, all 8 new URLs present, 0 old URLs |
| Robots correct | unchanged; production crawlable; no preview-host behaviour |
| Structured data valid | `@id`, `url`, breadcrumb items all on new URLs |
| No broken internal links | **0** across 6,965 internal links in 115 built pages |
| No duplicate title from migration | verified |
| No duplicate canonical URL | stale pages pruned |
| No orphaned service pages | all reachable from nav/footer |
| No accidental noindex | 78 indexable, 6 noindex — all 6 pre-existing and deliberate |
| No preview-host canonical | origin resolves to `https://stratosweb.hu` |
| SEO audit | **0 failing**, 18 warnings — all 18 pre-existing `hreflang-noindex` on the two deliberately-`summary` case studies |
| Test suite (`--project=node`, 211 tests) | **209 passed, 1 skipped, 1 failed** |

The one failure is `gate-independence.spec.ts`, from the repository secret scan
finding a JWT-shaped literal in `dist/portal/assets/index-BIu_eqY2.js` — minified
React vendor code in a portal bundle built before this session. Nothing in
`portal/` was touched. Pre-existing and unrelated; reported rather than papered
over.

### Old-URL sweep

Searching the whole tree for the eight old slugs returns only:

- the `from =` sides of the redirect rules in `netlify.toml` — intentional;
- a documentation comment in `build.py`'s page shell that used
  `/en/web-design-sme.html` as its example of a translated slug. It ships in the
  HTML and the rename made it false, so the example was corrected to
  `/en/web-design-small-business.html`. Nothing else in the comment changed.

No old URL survives in any crawlable link, canonical, hreflang, sitemap entry or
schema node.

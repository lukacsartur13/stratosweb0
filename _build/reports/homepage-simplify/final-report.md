# Homepage portfolio simplification — final report

```
HOMEPAGE PORTFOLIO ARCHITECTURE: SIMPLIFIED
COLLABORATIONS: LOGO-LED
RAPIDKERT: SOLE FEATURED HOMEPAGE CASE
RAPIDKERT ASSET: SHIPPED + VERIFIED
WORK PAGE: PRIMARY PORTFOLIO DESTINATION
MISSING-ASSET REGRESSION: VERIFIED
FINAL HERMETIC GATE: GREEN
REPOSITORY-WIDE MERGE GATE: GREEN
```

## What was wrong

The homepage — `experiments/src/full`, built to `dist/{index,en/index,de/index}.html`
— rendered every entry in `WORK` as a full case card at 11 000–17 000 m:
photograph, five-term description list (three on the phone), metric,
testimonial and client mark, three times over, in both compositions.
`/munkaink.html` carries the same three projects with the same three
photographs and links to each full case page, so the homepage was printing the
portfolio twice inside a brand narrative.

Separately, `content.ts` named `/assets/img/work-rapidkert.jpg` and that file
had never been staged. The frozen build did not contain it, so the production
homepage requested a URL that 404d — nine failures across
`homepage-chrome.spec.ts` and `public-site.spec.ts`, none of which mention
Rapidkert.

## What it is now

| | |
|---|---|
| Collaborations | six plated marks — Kontyos, Grantool, Synergy, Duna Hajók, Duna Enterior, Barbershop Győr |
| Featured case | one — Rapidkert, with its sourced `~15M Ft` |
| Ways out | the Rapidkert case study, and `/work`, both per-locale via `pageHref` |
| Other cases | reached through `/work`; absent from the homepage, not hidden |

`logo-fice.png` and `logo-haio.png` are deliberately excluded: the site's own
copy disqualifies them. The Impact Program build is described as *"nem is
együttműködés"* and HAIO as a sponsorship where *"itt csak nem ügyfél a másik
oldal"*. A collaboration rail cannot contain things the site says are not
collaborations.

`client-rapidkert.png` is excluded for a different reason — the featured case
sits immediately below it, and the mark would say the same name twice in one
stage at two different weights. mentaltrening has no mark in `assets/img/` and
none was invented.

## The image, and why it is not cropped

`work-rapidkert.jpg` is 1454×869 — a landscape hero capture. The old cards cut
every figure to 4:5 with `object-fit: cover`, which suited the portrait mockups
they were built for. Measured rather than assumed: a 4:5 window keeps **47.8%**
of this frame's width, and every horizontal position of it either bisects the
headline mid-word or amputates the 3D cross-section — which is the thing the
case study is about. Four positions were rendered and compared before the
decision.

So the figure adopts the frame's own ratio, carried in the content model as
`image.frame` and applied inline. Nothing is stretched, distorted or warped;
the source is untouched and no second asset was created.

The same field fixes a real correctness bug on the way: the renderer hard-coded
`width={1200} height={1500}` for every case image, which reserved a 4:5 box for
a 5:3 file — the exact CLS the attribute exists to prevent.

## Asset packaging — verified end to end

| Check | Result |
|---|---|
| tracked by Git | yes — `assets/img/work-rapidkert.jpg` |
| filename casing | byte-for-byte identical to the `content.ts` reference |
| source → build | `assemble.mjs` `COPY_DIRS=['assets',…]`, copied wholesale |
| in frozen `dist` | yes — `dist` file count 186 → **187** |
| HTTP response | **200**, `content-type: image/jpeg`, 232 421 bytes |
| body | byte-identical to the source file |
| redirect / HTML masquerade | neither |

No console-error whitelist, no ignore rule, no network mock was added. The
resource exists.

## Contracts

Replaced, not deleted. The old shape — three cases, five/three `dt` each,
`[data-testid^="case-"]` count === 3 in four places — described a catalogue the
homepage no longer is.

| Contract | Where |
|---|---|
| collaboration rail exists, one mark per approved collaboration, each with its organisation's name as alt | `full-ascent.spec.ts`, `portrait-journey.spec.ts` |
| exactly one homepage case study, and it is the featured one | both |
| the other cases are absent, not merely hidden | both |
| the feature's name, result and sourced metric, in order, metric between result and actions | both |
| both CTAs are anchors, hrefs equal `pageHref(...)`, destinations return 200 | `full-ascent.spec.ts` |
| the same architecture on the reduced-motion path and the no-WebGL path | both |
| the same architecture on hu/en/de with each locale's own routes **and labels** | `full-ascent.spec.ts` |
| every referenced case image, logo and mark resolves in the production build | `full-ascent.spec.ts` |

The metric contract is unchanged in kind: still source-driven, still not
`.case__metric count === 0`, still not a weak `> 0`.

## Mutation validation

`MISSING CASE ASSET MUTATION: DETECTED`

| # | Mutation | Detected by |
|---|---|---|
| 1 | Rapidkert metric removed | *the featured case is the one with a sourced figure* |
| 2 | image path pointed at a nonexistent file | asset contract — 404 on the named URL |
| 3 | `/work` CTA removed | navigation contract — locator count 0 |
| 4 | a second full homepage case study reintroduced | *the homepage features exactly one case study* — count 2 |

All four reverted; `content.ts` and `FullAscent.tsx` restored to their
pre-mutation hashes byte for byte.

Two earlier mutations against the asset contract, from the preceding
correction, are recorded in `../rapidkert-metric/mutation-validation.md`. A
third planned there — deleting the built copy while leaving the source on disk —
was interrupted before it ran and is **not** claimed as validated.

## The one final gate

| | |
|---|---|
| Run | `homepage-simplify-01` |
| Commit | `96fc959d5bbe921ef00e3d050faeadacbdb87d79` |
| Worktree | `/Users/arturlukacs/stratos-hermetic/subject` (hermetic, outside iCloud) |
| Preflight | **PASS on attempt 1** — `load1 3.06` (cap 6), iCloud 0%, ports free, no build watcher |
| Duration | 1 109.7 s |
| Valid | **yes** — `invalidReasons: []` |
| Green | **yes** — every gate passed |
| Subject mutation | **none** — before == after, all five hashes |
| `dist` canary events | **0** |
| Orphaned processes | **0** |
| Ports still held | **0** — 4322 and 4327 released |
| Build | run as a gate, not skipped |

```
before == after (IDENTICAL):
  combined 9e207d1a6f2430c67094a15561db6eb0baddfcef8c9add5a1bb57a114edb15c7
  product  443d25a1f4c550518397ad85e9dba3ea6de3c4f68ac7f664fce6f11126efe864   305 files
  test     0b74bbd5aa71eb79c390389ab7cf295cd024cc9484d8f5602a383cb82f1c598a    76 files
  config   94c5bf52ccac846c9bb8149f8cda1d55cb78d51c32db5fcc798411cd611b326b    14 files
  dist     ef1532d5ffed24f41dc8fda56b7e225d147b332238a7770aafe05e54429fdc78   187 files
```

The file counts are the checkable part. `product` 304 → **305** and `dist`
186 → **187** are the one shipped image. `test` stays at **76** while two files
change, which says the contracts were rewritten rather than dropped to make the
suite pass. `config` is byte-identical to the hash the previous three gates ran
against, so no `testDir` and no discovery rule moved and the manifest coverage
of `experiments/tests/` is intact.

### Gates

| Gate | Result | Exit |
|---|---|--:|
| `typecheck` | PASS | 0 |
| `fingerprint-check` | PASS | 0 |
| `draco-check` | PASS | 0 |
| `secret-scan` | PASS | 0 |
| `seo-audit` | PASS | 0 |
| `conversion-audit` | PASS | 0 |
| `route-audit` | PASS | 0 |
| `playwright-main` | PASS | 0 |
| `playwright-full` | PASS | 0 |

```
playwright-main   collected 1290   passed 1168   failed 0   flaky 0   skipped 122
                  1168 + 0 + 122 = 1290   reconciles

playwright-full   collected  171   passed  137   failed 0   flaky 0   skipped  34
                   137 + 0 +  34 =  171   reconciles
```

`playwright-main` is back to **1168/1290 with 0 failures** — the nine 404
failures are gone, and the collected and skipped counts are identical to the
last green run, so nothing was disabled to get there.

`playwright-full` collects **171 against the 165 baseline**. The +6 is three new
contracts collected by two projects each: the asset contract, the navigation
contract and the three-locale contract. Passed rose by the same 6, the skip set
is unchanged at 34, and no test was removed, renamed or disabled.

## Portal dev server

Still stopped. It was terminated with the operator's approval before the
previous run's preflight (it held the `no-build-watcher` check) and, per the
brief, was **not** restarted for this gate. It has not been restarted since.

## Not done, deliberately

Nothing was pushed, merged or deployed. No P2 migration was applied and Portal
P3 was not begun. `_build/build.py`'s `CASE_STATUS` maturity architecture is
untouched, all case-study routes still exist, and no unrelated homepage section
— hero, Altimeter, journey, menu, footer, consent, lead forms — was altered.

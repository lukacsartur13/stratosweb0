# Pre-Phase-6 baseline

Recorded 2026-08-03 from the working tree (Phase 6 typography work present,
uncommitted). Commit at HEAD: 96af5df.

## Gates

| Gate | Result |
|---|---|
| `npm run typecheck` | pass (portal + experiments) |
| `npm run build` | pass |
| `npm test` (main suite) | **289 passed · 10 skipped · 0 failed** |
| `npm run validate:full` | exit 0 — **88 passed · 97 skipped · 0 failed** (16.3m) |
| `node scripts/content-inventory.mjs --check` | OK — 33 routes, no reductions |

## Main suite matches the brief exactly

Brief expected 289 / 10 / 0. Measured 289 / 10 / 0.

## Full-ascent suite does NOT match the brief, and cannot

Brief expected 76 passed / 64 skipped = **140 test instances**.
Measured 88 passed / 97 skipped = **185 test instances**.

Reason — the inventory difference predates this phase:

* `experiments/tests/full-ascent.spec.ts` contains **37 `test()` blocks**, at
  HEAD and in the working tree alike (`git show HEAD:… | grep -c` = 37).
* `playwright.full.config.ts` declares **5 projects** (desktop, mobile-390,
  mobile-430, mobile-375, reduced-motion), unmodified from HEAD.
* 37 x 5 = **185**, which is what ran.

140 = 28 x 5, i.e. an inventory of 28 tests. No such inventory exists at HEAD.
**The brief's 76/64 figure is stale.** No test was added, removed, weakened or
skipped to reach 185 — the uncommitted Phase 6 diff adds zero `test()` blocks
(`git diff … | grep -E '^\+\s*test\('` returns nothing).

## One test changed state, from failing to passing

`full-ascent.spec.ts:1213` — "the stage announced at a scroll position does not
depend on the direction". The Phase 6 diff replaced a fixed `waitForTimeout(1700)`
with a frame-rate-independent settle predicate derived from `JOURNEY_SMOOTHING`
and `MAX_FRAME_DT`, and raised that test's timeout to 300s.

Per the diff's own annotation the flat wait was a statement about hardware, not
about the journey: the desktop project renders four times the pixels through a
software rasteriser at ~7.9fps versus ~39fps on mobile, so desktop had not
converged at 1.7s and the test read "still moving" as "disagrees by direction".
The three mobile projects converged inside 1.7s and passed.

So the honest reading of HEAD is **87 passed / 97 skipped / 1 failed**, and the
working tree is **88 / 97 / 0**. The entry condition "0 failed" is satisfied by
the working tree, not by HEAD. This was a test-harness defect, not a product
defect, and the fix strengthened the assertion rather than relaxing it.

## Post-change re-run, and a second inventory change that is not ours

After the Phase 6 typography fix and the centring work:

| Gate | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run validate:full` | exit 0 — **88 passed · 97 skipped · 0 failed** (15.6m) |
| `npm test` (main suite) | **294 passed · 10 skipped · 0 failed** |
| `node scripts/content-inventory.mjs --check` | OK — 33 routes, no reductions |

The full-ascent suite is unchanged at 88/97/0, so the composition change broke
nothing.

The main suite moved **289 → 294**, and the reason is external to this work. A
concurrent session edited this repository during the run and added one test to
`tests/public-site.spec.ts` — "no built page carries an executable inline
script", guarding `script-src 'self'` against the silent CSP refusal that had
shipped the quote wizard as an empty page. `playwright.config.ts` declares six
projects and `public-site.spec.ts` is excluded from `endpoint`, so it runs in
five: 1 × 5 = **+5**, which is exactly the delta.

Nothing was weakened or removed to reach it, and none of it is ours. The same
session also added `scripts/recovery-link.mjs` and regenerated all 33 static
HTML pages while this work was in progress.

## Content baseline

`_build/reports/content-baseline.json` — 33 routes, 174 sections, 20,044
meaningful words, 51 images, 57 CTAs, 9 forms. This is the Phase 8 floor.

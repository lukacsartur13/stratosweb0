# The six-run authoritative gate — method

*Results are appended to this file when the sequence completes; the method is
recorded first so it cannot be adjusted to fit the outcome.*

## What each run does

`scripts/hermetic/six-run.mjs` freezes once, then invokes
`scripts/hermetic/gate-run.mjs` per run. Each run, in order:

1. **Build** — `npm run build` then `npm run build:full`, inside a declared
   mutation window. The resulting `dist` must hash identically to the frozen
   reference passed as `--expect-dist`; a run that builds different bytes is
   INVALID.
2. **Freeze** — capture the BEFORE manifest, then arm the `fs.watch` canaries on
   `dist`, `tests`, `assets`, `portal/src`, `experiments/src`, `scripts`.
3. **Servers** — start both owned servers (`:4322` main, `:4327` experiments),
   record PID / port / ready time, wait for the socket to answer rather than
   for a sleep.
4. **Gates** — the nine below.
5. **Shutdown** — SIGTERM, then SIGKILL if needed; disarm canaries; stop the
   load sampler.
6. **AFTER manifest** and automatic comparison.
7. **Cleanup verification** — every started PID confirmed dead, both ports
   confirmed released.

## The nine gates (§51)

| Gate | Command | Needs a server |
| --- | --- | --- |
| production build | `npm run build` + `npm run build:full` | no |
| typecheck | `npm run typecheck` (portal + experiments) | no |
| fingerprint | `npm run fingerprint:check` | no |
| draco sync | `npm run draco:check` | no |
| secret scan | `npm run scan:secrets` | no |
| SEO | `npm run audit:seo:check` | no |
| conversion | `npm run audit:conversion:check` | no |
| route audit | `node scripts/route-audit.mjs` | no |
| **complete Playwright suite** | `npx playwright test` — 1271 tests, 8 projects | yes |
| **visual / WebGL suite** | `npx playwright test --config playwright.full.config.ts` — 165 tests, 7 projects | yes |

**1 436 tests per run.** The main suite carries the public homepage, desktop and
portrait homepage, menu, history restoration, lead forms, consent, GA4 /
attribution contracts, Portal P1, Portal P2, Portal Analytics, portal health and
auth/security, the redirect and structured-data checks, and the renderer canary
in `tests/harness.spec.ts`.

### On `validate:full`

§51 names `validate:full`. The gate runs its whole surface — `build`,
`build:full`, `playwright.full.config.ts` — but **not** its leading
`clean:validate` (`rm -rf dist/experiments test-results`). Deleting part of the
served tree at the start of every run is incompatible with §7, and the
frozen-hash check replaces what that deletion was there to guarantee: the
artefact is proven to be the frozen one rather than merely proven to be fresh.

## What is compared across the six

Per §34 and §35, and in this order of importance:

1. **Validity** — all six must be VALID, or they are not six runs.
2. **Identical failure set** — the same tests failing in every run. This is the
   acceptance question. Six runs failing the same test at the same contract is a
   *better* result than five green and one failing somewhere new.
3. **Identical collected** and **identical skipped**.
4. **Identical dist hash** across all six.
5. Green rate, duration, mean and peak load — recorded, not decisive.

A test that failed in at least one run but not all is a **wandering failure**,
and §37 makes any wandering failure disqualifying regardless of green rate.

## Conditions

- Commit frozen; captured once at the start and checked per run (§36 —
  commit drift discards the run rather than being averaged in).
- Subject: `/Users/arturlukacs/stratos-hermetic/subject`, outside the
  iCloud-synchronised directory, no other session pointed at it.
- Host: idle baseline recorded in `environment.md`. Load sampled every 5 s and
  reported per run. Load never invalidates a run (§12).
- INVALID runs are discarded and replaced, up to `--max-attempts`; the number of
  discards is published so the cost is visible.

---

## Results

**Frozen commit `6fda3ff`. Six attempts, six VALID runs, zero discarded.**

| Run | Valid | Collected | Passed | Failed | Skipped | Duration | Mean Load | Peak Load | Subject Identical |
| --- | ----: | --------: | -----: | -----: | ------: | -------: | --------: | --------: | ----------------: |
| 1 | VALID | 1436 | 1281 | 0 | 155 | 1227 s | 8.03 | 15.94 | yes |
| 2 | VALID | 1436 | 1281 | 0 | 155 | 1441 s | 13.50 | 32.09 | yes |
| 3 | VALID | 1436 | 1281 | 0 | 155 | 1429 s | 13.77 | 22.90 | yes |
| **4** | VALID | 1436 | **1279** | **2** | 155 | 1420 s | 16.85 | 32.05 | yes |
| 5 | VALID | 1436 | 1281 | 0 | 155 | 1181 s | 10.42 | 26.01 | yes |
| 6 | VALID | 1436 | 1281 | 0 | 155 | 1451 s | 16.05 | 24.64 | yes |

Runtime range **1181–1451 s** (19.7–24.2 min). Mean load **8.03–16.85**, peak
**15.94–32.09**. Canary write events: **0 in every run**. Orphaned processes and
held ports: **0 in every run**.

### Subject integrity — all four groups, every run

| Group | Hash | Identical across all six, before AND after |
| --- | --- | --- |
| `product` | `69106294…` | yes |
| `test` | `d5e98d86…` | yes |
| `config` | `39f6a938…` | yes |
| `dist` | `2cce7616…` | yes |

Every run rebuilt the artefact from frozen source and produced the same bytes;
`dist` still hashed `2cce7616…` after the sequence finished. Subject mutation
count: **0**.

## Main suite

| Run | Collected | Passed | Failed | Skipped | Reconciles |
| --- | --: | --: | --: | --: | --- |
| 1 | 1271 | 1150 | 0 | 121 | yes |
| 2 | 1271 | 1150 | 0 | 121 | yes |
| 3 | 1271 | 1150 | 0 | 121 | yes |
| **4** | 1271 | **1148** | **2** | 121 | yes |
| 5 | 1271 | 1150 | 0 | 121 | yes |
| 6 | 1271 | 1150 | 0 | 121 | yes |

## WebGL suite

| Run | Collected | Passed | Failed | Skipped | Reconciles |
| --- | --: | --: | --: | --: | --- |
| 1–6 | 165 | 131 | 0 | 34 | yes |

**Identical in all six runs.** This is the suite that had no machine-readable
report at all until `6fda3ff`; its arithmetic has now been closed six times.

## Skip-set identity — §16

Not just the count. The **exact set of skipped test identities** was hashed per
run:

```
g2-01 n=155 sha=9e33218a6d5b8115
g2-02 n=155 sha=9e33218a6d5b8115
g2-03 n=155 sha=9e33218a6d5b8115
g2-04 n=155 sha=9e33218a6d5b8115
g2-05 n=155 sha=9e33218a6d5b8115
g2-06 n=155 sha=9e33218a6d5b8115
```

**One distinct hash. The same 155 tests were skipped in every run** — the
stronger claim, not merely the same number. The `mounted()` runtime-skip defect
recorded in `root-cause.md` did **not** fire anywhere in this load range
(mean 8–17); the 146-vs-121 divergence that exposed it was observed at mean
load ~96, well outside anything the authoritative sequence reached.

## Failure-set identity — §17

**NOT identical.** Five runs had an empty failure set; run 4 had two entries.

| Test | Failed in |
| --- | --- |
| `[desktop-1440] homepage-chrome.spec.ts:1005` — a subpage reached from the homepage carries the same working header | **run 4 only** (1 of 6) |
| `[portrait-chromium] homepage-modality.spec.ts:96` — while it is open the page behind it cannot be reached, and afterwards it can | **run 4 only** (1 of 6) |

Both are **wandering** by the definition in `gate-policy.md` §10: present in at
least one valid run and absent from the rest.

### Boundaries, named from artefacts (§21 of the stabilization brief)

```
[desktop-1440] homepage-chrome:1005      7.0 s
  expect(locator('#menu')).toBeVisible() failed
  Expected: visible   Received: hidden   Timeout: 5000 ms
  last confirmed event: UNCLASSIFIED — assertion reached and evaluated,
                        the element was HIDDEN rather than absent

[portrait-chromium] homepage-modality:96  2.3 s
  page.evaluate: Execution context was destroyed, most likely because of a navigation
  at homepage-modality.spec.ts:248, immediately after page.mouse.click
  last confirmed event: navigation occurred — context destroyed mid-evaluate
```

Neither is a `page.goto` stall and neither is reported as one. The second is a
navigation **race**, not a stall. The first — `#menu` present but `hidden` — has
the shape of the invisible-open-menu defect class the previous pass fixed in
`header.js`, but **one occurrence in six is not a classification**, and no
root-cause claim is made from it here.

Run 4 carried the highest mean load of the sequence (16.85) — but run 6 was
green at mean 16.05 and run 2 was green at peak 32.09, so load does not by
itself separate the runs.

## Arithmetic — §18

Verified programmatically for **both suites in all six runs**:
`passed + failed + flaky + skipped === collected`, twelve reconciliations,
twelve successes. No total was repaired in prose.

## Constituent gates — §20

All nine gates plus `build` + `build:full` ran in **every** run; none missing:

`typecheck`, `fingerprint-check`, `draco-check`, `secret-scan`, `seo-audit`,
`conversion-audit`, `route-audit`, `playwright-main` (1271), `playwright-full` (165).

No run was reduced, and none is described as repository-wide without having been.

## Chromium renderer canary — §21

`tests/harness.spec.ts`: **12 of 12 passed in every run, 72 assertions total, 0
failures.** Renderer identities observed:

```
desktop-1440   ANGLE (Apple, ANGLE Metal Renderer: Apple M4, Unspecified Version)
desktop-1920   ANGLE (Apple, ANGLE Metal Renderer: Apple M4, Unspecified Version)
mobile-390     Apple GPU
mobile-430     Apple GPU
```

**No SwiftShader regression.** The renderer fix holds.

## Portal P1/P2 — §22

`portal*.spec.ts` (control room, revenue, analytics, health, portal):
**411 collected, 411 passed, 0 failed, 0 skipped — in every one of the six runs.
2 466 executions, zero failures.**

The Portal baseline is deterministic and untouched.

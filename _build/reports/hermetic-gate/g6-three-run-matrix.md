# G6 — three-run matrix

**The quiet-host closure measurement.** Pre-registered as three consecutive
authoritative runs over the frozen G5 subject, each started only after a passing
prospective host-health preflight.

| | |
| --- | --- |
| Commit | `48811e991089dd8cb73f23ec1c6ae880446cff6f` |
| Root | `/Users/arturlukacs/stratos-hermetic/subject` |
| Frozen `dist` | `2538acb4918470f2d172c66df16737819bb41668936f7301fec65cfc396783c3` (186 files) |
| Policy | [`host-health-policy.md`](host-health-policy.md) |
| Pre-registration | [`g6/pre-registration.md`](g6/pre-registration.md) |
| Ran | 2026-08-20, 03:25Z – 03:44Z |

## Result

# G6 QUIET-HOST CLOSURE GATE: NOT GREEN
# 1 run started · 1 / 1 VALID · 0 / 1 GREEN

`g6-01` was valid and red. The pre-registered stop rule (§35) forbids rerunning
for a better result, so `g6-02` and `g6-03` were **not started**. The sequence
fails as defined, and it fails on the first run rather than on a tiebreak.

## The matrix

| Run | Preflight | Valid | Green | Collected | Passed | Failed | Skipped | Skip Hash | Mean Load | Peak Load | Subject Identical |
| --- | --------- | ----- | ----- | --------: | -----: | -----: | ------: | --------- | --------: | --------: | ----------------- |
| g6-01 | ✅ PASS | ✅ | ❌ | 1450 | 1294 | 1 | 155 | `bb65b684…` | 5.50 | 11.28 | ✅ |
| g6-02 | — not reached | — | — | — | — | — | — | — | — | — | — |
| g6-03 | — not reached | — | — | — | — | — | — | — | — | — | — |

Skip hash in full:
`bb65b6846f9975fa5b2cb3a73439adc1ae56ab8e09933c6dbaf43fb05a837cee`

— byte-identical to the G5 sequence's skip set, and to G3's before it. The skip
set has now been stable by **identity** across three independent sequences.

## Subject integrity (§30)

| | Before | After |
| --- | --- | --- |
| combined | `660f76198c30f6f9a843908ef2cf822b6b5701bfdacc93e6d630311b6b5db269` | identical |
| product | `088c02849aad0e870111fab16585dac6a1caf4fcd1b99893e1e5511682547c84` | identical |
| test | `2d561c3320f5c51b2432ae96d81782fc337ee30d864cc41daa5f2093e8165a8e` | identical |
| config | `94c5bf52ccac846c9bb8149f8cda1d55cb78d51c32db5fcc798411cd611b326b` | identical |
| dist | `2538acb4918470f2d172c66df16737819bb41668936f7301fec65cfc396783c3` (186) | identical (186) |

| | |
| --- | --- |
| Canary writes | **0** |
| Orphaned processes | **0** |
| Ports still held | **0** |
| Build run during the gate | **no** — `--skip-build`, per §21 |

All four hashes are identical to the subject that completed G5. Nothing was
rebuilt, edited or reconfigured between G5 and G6.

## §31 — validity versus greenness

`g6-01` is the textbook case the distinction exists for:

> **VALID** — the subject was trustworthy from beginning to end. Hashes identical
> before and after, zero canary writes, owned servers, no orphans, arithmetic
> reconciled in both suites.
>
> **RED** — one required test did not pass.

The two are reported separately and are not collapsed. A trustworthy measurement
of a failure is still a failure.

---

# Component sections

## Main suite (§23)

| Run | Collected | Passed | Failed | Skipped | passed+failed+skipped | Reconciles |
| --- | --------: | -----: | -----: | ------: | --------------------: | ---------- |
| g6-01 | 1285 | 1163 | 1 | 121 | 1285 | ✅ |

Failure identity, in full:

```
[mobile-390] public-site.spec.ts:264 /nagyvallalat.html responds and has a title and description
```

## WebGL suite (§24)

| Run | Collected | Passed | Failed | Skipped | Sum | Reconciles |
| --- | --------: | -----: | -----: | ------: | --: | ---------- |
| g6-01 | 165 | 131 | 0 | 34 | 165 | ✅ |

**The WebGL suite was green.** This is the notable contrast with G5: the G5 load
outlier (`g5-02`, mean 88.15) manifested as two `full-ascent.spec.ts` failures in
this suite, and under G6's controlled start the suite passed without incident.
No WebGL failure boundary needed to be recorded, because there was none.

## Portal (§28)

| Run | Executions | Passed | Failed | Skipped |
| --- | ---------: | -----: | -----: | ------: |
| g6-01 | 411 | **411** | 0 | 0 |

`portal.spec.ts`, `portal-control-room.spec.ts`, `portal-revenue.spec.ts`,
`portal-analytics.spec.ts`, `portal-health.spec.ts` — green, as in every run of
every sequence to date. Portal was not changed and Portal P3 was not begun.

## Lead regression (§27)

The corrected silent-drop contract set, counted as executions across the four
projects that carry `lead-forms.spec.ts`:

| Contract | Executions | Passed | Failed |
| --- | ---: | ---: | ---: |
| `the minimum fill wait` › a backward wall-clock step cannot under-report the fill time | 4 | **4** | 0 |
| `the minimum fill wait` › the wait clears the drop threshold with headroom | 4 | **4** | 0 |
| `the deployed bundle` › the shipped controller measures on a clock that cannot move | 4 | **4** | 0 |
| a double click produces exactly one request | 4 | **4** | 0 |
| Enter cannot slip a second request past the disabled button | 4 | **4** | 0 |
| a network failure keeps everything typed | 4 | **4** | 0 |
| a retry re-sends the same submission id | 4 | **4** | 0 |
| a fresh enquiry gets a new submission id | 4 | **4** | 0 |
| **silent-drop total** | **32** | **32** | **0** |
| whole `lead-forms.spec.ts` file | 128 | **128** | 0 |

The silent-drop regression is green. So is every other contract in the lead
file — including `Impact Program application › maps the application into the
lead schema`, which was G5's single `g5-06` failure and did not recur.

## Renderer canary (§26)

| Run | Executions | Passed | Failed | SwiftShader regression |
| --- | ---------: | -----: | -----: | ---------------------- |
| g6-01 | 4 | **4** | 0 | none |

`tests/harness.spec.ts` › 'the rasteriser is either hardware, or declared'
passed on every Chromium project. ANGLE Metal remained active. No renderer flags
were changed during G6.

## Non-Playwright gates

`typecheck`, `fingerprint-check`, `draco-check`, `secret-scan`, `seo-audit`,
`conversion-audit`, `route-audit` — **7 / 7 pass**. None has failed in any run
of any sequence.

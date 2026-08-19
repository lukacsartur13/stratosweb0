# G5 — six-run matrix

**The authoritative current merge sequence.** Six repository-wide gate runs over
one frozen subject, in the hermetic worktree outside iCloud.

| | |
| --- | --- |
| Commit | `48811e991089dd8cb73f23ec1c6ae880446cff6f` |
| Root | `/Users/arturlukacs/stratos-hermetic/subject` |
| Frozen `dist` | `2538acb4918470f2d172c66df16737819bb41668936f7301fec65cfc396783c3` |
| Ran | 2026-08-19, 18:07Z – 21:15Z |

## Result

# 6 / 6 VALID  ·  4 / 6 GREEN
# DETERMINISTIC: **false**

Every hermetic property required by §51 holds. The one criterion that fails is
greenness, and the failure set is **not identical across runs** — the definition
of a wandering failure, which §52 forbids being waved through.

## The matrix

| Run | Valid | Green | Collected | Passed | Failed | Skipped | Skip Hash | Duration | Mean Load | Peak Load | Subject Identical |
| --- | ----: | ----: | --------: | -----: | -----: | ------: | --------- | -------: | --------: | --------: | ----------------: |
| g5-01 | ✅ | ✅ | 1450 | 1295 | 0 | 155 | `bb65b684…` | 1 149 s | 6.59 | 14.39 | ✅ |
| g5-02 | ✅ | ❌ | 1450 | 1291 | 4 | 155 | `bb65b684…` | 2 702 s | **88.15** | **186.37** | ✅ |
| g5-03 | ✅ | ✅ | 1450 | 1295 | 0 | 155 | `bb65b684…` | 1 774 s | 26.74 | 110.27 | ✅ |
| g5-04 | ✅ | ✅ | 1450 | 1295 | 0 | 155 | `bb65b684…` | 1 132 s | 6.20 | 11.50 | ✅ |
| g5-05 | ✅ | ✅ | 1450 | 1295 | 0 | 155 | `bb65b684…` | 1 155 s | 6.20 | 13.23 | ✅ |
| g5-06 | ✅ | ❌ | 1450 | 1294 | 1 | 155 | `bb65b684…` | 1 428 s | 13.19 | 44.20 | ✅ |

Skip hash in full:
`bb65b6846f9975fa5b2cb3a73439adc1ae56ab8e09933c6dbaf43fb05a837cee`

### §54 — the skip set by identity, not by count

One hash across all six runs. It is also **byte-identical to the `g3`
sequence's** `skipSetSha`, which is a second, independent statement: the three
tests added to `lead-forms.spec.ts` and the two in `gate-independence.spec.ts`
changed *which* tests skip not at all.

### §38 — the subject was the same in all six

| | Distinct values across the six runs |
| --- | --- |
| commit | 1 — `48811e99…` |
| product hash | 1 — `088c0284…` |
| test hash | 1 — `2d561c33…` |
| config hash | 1 — `94c5bf52…` |
| dist hash | 1 — `2538acb4…` |
| skip-set hash | 1 — `bb65b684…` |
| collected | 1 — 1450 |
| skipped | 1 — 155 |

### §40 — hermetic guarantees

| Run | Before/after hashes | Canary writes | Orphan processes | Held ports |
| --- | --- | ---: | ---: | ---: |
| g5-01 … g5-06 | identical, all six | **0** | **0** | **0** |

## §42 — main suite

| Run | Collected | Passed | Failed | Skipped | passed+failed+skipped | Reconciles |
| --- | --------: | -----: | -----: | ------: | --------------------: | ---------- |
| g5-01 | 1285 | 1164 | 0 | 121 | 1285 | ✅ |
| g5-02 | 1285 | 1162 | 2 | 121 | 1285 | ✅ |
| g5-03 | 1285 | 1164 | 0 | 121 | 1285 | ✅ |
| g5-04 | 1285 | 1164 | 0 | 121 | 1285 | ✅ |
| g5-05 | 1285 | 1164 | 0 | 121 | 1285 | ✅ |
| g5-06 | 1285 | 1163 | 1 | 121 | 1285 | ✅ |

## §43 — WebGL suite

| Run | Collected | Passed | Failed | Skipped | Sum | Reconciles |
| --- | --------: | -----: | -----: | ------: | --: | ---------- |
| g5-01 | 165 | 131 | 0 | 34 | 165 | ✅ |
| g5-02 | 165 | 129 | 2 | 34 | 165 | ✅ |
| g5-03 | 165 | 131 | 0 | 34 | 165 | ✅ |
| g5-04 | 165 | 131 | 0 | 34 | 165 | ✅ |
| g5-05 | 165 | 131 | 0 | 34 | 165 | ✅ |
| g5-06 | 165 | 131 | 0 | 34 | 165 | ✅ |

§55 arithmetic holds in every run of both suites, with nothing unaccounted.

## Non-Playwright gates

`typecheck`, `fingerprint-check`, `draco-check`, `secret-scan`, `seo-audit`,
`conversion-audit`, `route-audit` — **7 / 7 pass in all six runs**. No gate in
this group failed once.

## Portal

`portal.spec.ts`, `portal-control-room.spec.ts`, `portal-revenue.spec.ts`,
`portal-analytics.spec.ts`, `portal-health.spec.ts` — **green in all six runs**,
zero failures. The P1/P2 baseline remains the most deterministic part of the
suite. No Portal P3 work was begun.

## Renderer (§45)

`tests/harness.spec.ts` — 'the rasteriser is either hardware, or declared' —
passed in all six runs on every Chromium project. ANGLE Metal remained active;
no SwiftShader regression, and `STRATOS_SOFTWARE_RASTER` was never set.

## Lead regression (§46)

Counted as executions — each contract runs on the four projects that carry
`lead-forms.spec.ts`, in each of the six runs.

| Contract | Executions | Passed | Failed |
| --- | ---: | ---: | ---: |
| `the minimum fill wait` › a backward wall-clock step cannot under-report the fill time | 24 | **24** | 0 |
| `the minimum fill wait` › the wait clears the drop threshold with headroom | 24 | **24** | 0 |
| `the deployed bundle` › the shipped controller measures on a clock that cannot move | 24 | **24** | 0 |
| idempotency set (5 contracts) | 120 | **120** | 0 |
| **total** | **192** | **192** | **0** |

The silent-drop regression did not fail once, in any run, on any project —
including the two runs that were not green overall.

## Secret-scan independence (§47)

| Contract | Executions | Passed | Failed |
| --- | ---: | ---: | ---: |
| `gate-independence` › a previous run's artefact cannot make the next run red | 6 | **6** | 0 |
| `gate-independence` › the exclusion is not a directory amnesty | 6 | **6** | 0 |
| `secret-scan` gate | 6 | **6** | 0 |

The g4-03 cascade did not recur. Six runs wrote six artefact trees and none of
them changed a later run's verdict.

## §48 — the failures, classified

Five distinct failures across two runs. **None appears in more than one run**,
which is what `failure set: false` means and why the sequence is not accepted.

| Test | Project | Run | Load at the time |
| --- | --- | --- | ---: |
| `mobile-homepage-simple.spec.ts:1089` the instrument is still there… | mobile-390 | g5-02 | 88.15 / 186.37 |
| `mobile-homepage-simple.spec.ts:1089` the instrument is still there… | mobile-430 | g5-02 | 88.15 / 186.37 |
| `full-ascent.spec.ts:1342` the stage announced at a scroll position… | desktop | g5-02 | 88.15 / 186.37 |
| `full-ascent.spec.ts:1500` captures every stage of the journey | desktop | g5-02 | 88.15 / 186.37 |
| `lead-forms.spec.ts:472` maps the application into the lead schema | desktop-1920 | g5-06 | 13.19 / 44.20 |

**Classification: WANDERING, load-correlated. Not a deterministic defect, and
not a new unrelated defect in the subject.**

The four g5-02 failures all occurred in the single run whose mean load was
**88.15 against a baseline of 6.2–6.6** — a thirteenfold excursion, with a peak
of 186. Every one is an actionability or frame-rate timeout: an element that
never became stable, or a scene that never reached the frame budget. g5-03 ran
at mean 26.74 with a peak of 110 and was still green, which places the threshold
somewhere above that and well below 88.

The host load came from two processes, neither of them the subject:
`fileproviderd` (iCloud digesting the development checkout, which had just had
`dist/` deleted and rebuilt twice) and the editor application's own renderer.
Both had drained by g5-04, which ran at mean 6.20.

### The g5-06 lead failure is not the silent drop (§49)

It is the only failure that touches a lead contract, so it is answered in full
rather than summarised:

```
Error: page.check: Clicking the checkbox did not change its state
  - locator resolved to <input required value="Igen" type="checkbox" name="adatkezeles_elfogadva"/>
  - 3 × waiting for element to be visible, enabled and stable → "element is not stable"
  - "element is outside of the viewport"
  - eventually clicked; state unchanged
  at tests/lead-forms.spec.ts:485
```

| §49 question | Answer |
| --- | --- |
| listener bound? | Yes — never invoked |
| validation completed? | **No — never started** |
| envelope created? | **No** |
| fetch started? | **No** |
| server received? | **No** |
| response returned? | n/a |
| handler completed? | n/a |
| UI terminal state? | none — the form was never submitted |

Line 485 is `page.check(...)`; the submit is line 486. **The test aborted one
line before the form was submitted**, so no lead code ran at all: no
`elapsedMs`, no envelope, no request. It cannot be the silent drop, and it is
not a lead defect of any kind — it is the same layout-stability family as the
four g5-02 failures, in a form that happens to live in the lead spec.

### §50 — navigation

No `page.goto` failure occurred in any of the six runs. The navigation-boundary
instrumentation recorded nothing and no investigation was reopened.

## Verdict

| §51 criterion | Required | Actual | |
| --- | --- | --- | --- |
| Valid runs | 6 / 6 | 6 / 6 | ✅ |
| Green runs | 6 / 6 | **4 / 6** | ❌ |
| Identical collected | yes | yes (1450) | ✅ |
| Identical skip set (by hash) | yes | yes (`bb65b684…`) | ✅ |
| Failures | 0 | 5 across 2 runs | ❌ |
| Product hash identical | yes | yes | ✅ |
| Test hash identical | yes | yes | ✅ |
| Config hash identical | yes | yes | ✅ |
| Dist hash identical | yes | yes | ✅ |
| Subject mutations | 0 | 0 | ✅ |
| Canary writes | 0 | 0 | ✅ |
| Orphan processes | 0 | 0 | ✅ |
| Held ports | 0 | 0 | ✅ |
| Renderer stable | yes | yes (ANGLE Metal ×6) | ✅ |
| Portal stable | yes | yes | ✅ |
| WebGL stable | yes | 5 / 6 | ❌ |
| Lead regression stable | yes | **192 / 192** | ✅ |
| Secret-scan independence stable | yes | **12 / 12** | ✅ |

**Fifteen of eighteen criteria met. The three that are not are the same fact
counted three ways: two runs were not green.**

§52 is explicit that this is not an acceptance, and it is not being recorded as
one. There is no "accepted with limitations" here.

## What a re-run would need

Not a code change — §48 forbids editing on a wandering failure, and nothing in
the subject is implicated. What is missing is a quiet host:

* the development checkout's iCloud sync fully drained **before** the freeze,
  not during the sequence;
* no interactive application competing for the GPU and the window server;
* mean load held near the 6.2 the four green runs recorded.

A g6 sequence under those conditions is the next step. The subject would be
unchanged, so `48811e99…` and every hash above would carry over — a re-run of
the measurement, not of the work.

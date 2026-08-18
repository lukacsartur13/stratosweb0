# The final two nondeterministic contracts — final report

Both contracts that broke the previous six-run hermetic sequence have been
diagnosed, corrected and stress-tested. **Neither was a product defect.** The
exact identities, assertions and DOM state are in `failure-inventory.md`.

---

## Contract A — `tests/homepage-chrome.spec.ts:1005` `[desktop-1440]`

*"a subpage reached from the homepage carries the same working header"*

### Original failure

```
expect(locator('#menu')).toBeVisible() failed
Expected: visible   Received: hidden   Timeout: 5000ms
```

Failed in run 4 of six; absent from runs 1, 2, 3, 5, 6.

### The DOM audit answers the obvious hypothesis first — and refutes it

```
candidateCount : 1
idMenuCount    : 1
path           : HTML>BODY>DIV#menu
hidden         : true      display: none      box: 0 × 0
aria-hidden    : null      inert:   false
```

**One candidate.** No inactive composition, no transition copy, no
mobile/desktop duplicate, no accessibility-only duplicate, no stale node.

§3–§7 of the brief are written for a selector matching several elements, and the
remedies they discuss — `.first()`, `.last()`, nth, `:visible`, an
active-instance discriminator — all presuppose a choice to be made. There is no
choice here. The assertion selected the only `#menu` in the document and
reported its true state. **The layer never opened.**

### Root cause

`header.nav` and `.burger` are both in the server-rendered shell. They are
visible, stable, enabled and hit-testable the instant the document parses — and
visible, stable, enabled and receives-events is precisely what Playwright's
actionability check waits for. **None of it means "has a JavaScript listener".**

A click delivered before `assets/js/header.js` has run is a real click on a real
button that nothing is listening to. The layer then correctly stays `hidden`,
and the following assertion correctly reports `hidden` for its full 5 000 ms.

Measured over 100 instrumented executions (`scripts/hermetic/diagnostics/contract-a.spec.ts`):

| Observation | Count |
| --- | --- |
| `readyState` at click time `complete` | 85 |
| `readyState` at click time `interactive` | 14 |
| `readyState` at click time `loading` | 1 |
| `window.Stratos.header` absent at click time | **1** |

`defer` closes most of the window — deferred scripts run before
`DOMContentLoaded` — but not all of it.

**Also ruled out, by measurement rather than by argument:** `transitions.js`
appends a full-screen `.stratos-veil` on arrival and removes it on a 600 ms
timer. It is `pointer-events: none` and cannot intercept the click.

### Classification — §17

**REAL TEST RACE.** The product is correct. The test drove a control before the
control was installed. **No product change.**

### Correction

`window.Stratos.header` is published at `header.js:419`, after every listener in
that file is bound — including `burger.addEventListener('click', …)` at `:371`.
It is therefore an exact readiness marker, not an approximate one, and is waited
for before each `burger.click()`.

A state wait, not a duration. No timeout raised, no retry, no sleep, no force
click, no assertion weakened.

### Mutation check — §8

| Mutation | Result |
| --- | --- |
| `menu.hidden = false` in `header.js` replaced by a no-op | **5 of 5 projects FAIL** |
| Break only the hidden/inactive duplicate | **Not applicable — there is no duplicate.** Recorded rather than silently skipped. |

Reverted immediately. Product source clean; `dist` hash returned to `2cce7616…`.

### Stress — §9

| Arm | Executions | Failures |
| --- | --: | --: |
| Isolated, `desktop-1440` (the failing project) | 200 | **0** |
| All five carrying projects | 225 | **0** |

---

## Contract B — `tests/homepage-modality.spec.ts:96` `[portrait-chromium]`

*"while it is open the page behind it cannot be reached, and afterwards it can"*

### Original failure

```
page.evaluate: Execution context was destroyed, most likely because of a navigation
at homepage-modality.spec.ts:248, immediately after page.mouse.click
```

### This was already the second attempt

The spec carried a comment describing an earlier fix: the original clicked and
then called `waitForLoadState`, which resolves immediately against the
already-loaded document and settled nothing. It was replaced by a *prediction* —
sample `elementFromPoint`, branch on whether it resolves to a link — whose
comment stated "Neither branch races." That is the claim that failed.

### Timeline and first divergence — §11, §12

Sampling the click coordinate every 20 ms from the moment `openMenu()` returns:

```
i=0   DIV.menu__veil   href null    layerAnimations 2
i=1   DIV.menu__veil   href null    layerAnimations 2
i=2   DIV.menu__veil   href null    layerAnimations 2
i=3   DIV.menu__veil   href null    layerAnimations 2
i=4   DIV.menu__veil   href null    layerAnimations 2
i=5   A                /nagyvallalat.html
i=6…  A                /nagyvallalat.html
```

**First divergence: the identity under a FIXED viewport coordinate changes about
100 ms after `openMenu()` returns.**

`openMenu()` waits for `aria-expanded="true"` and `toBeVisible()`, and
`toBeVisible()` requires only a non-empty bounding box. Neither waits for the
layer to finish opening. A sample that caught the veil, followed by a click that
caught the link, takes the "cannot navigate" branch — the navigation commits and
the `evaluate` dies exactly as reported.

The click was observed race-free via `page.exposeFunction`, called synchronously
from a capture-phase listener so the value reaches Node before any navigation
can commit:

```json
{"tag":"A","inLayer":true,"href":"/nagyvallalat.html","isNl":false,
 "path":["A","LI","UL","DIV","NAV"],"defaultPrevented":false}
```

### Classification — §17

**REAL TEST RACE.** Across 120 instrumented executions the newsletter field
**never once** took the click — the contract this test exists to protect held
every time. The product is correct; the test observed at the wrong moment.
**No product change.**

### Correction, and the round it took to get right

The first correction waited for the hit-test target to be stable across five
consecutive animation frames. **It was not sufficient: 4 failures in 200.**

The veil holds still for many frames before giving way to the links beneath it,
so a five-frame stability window is perfectly satisfied *by the veil* and
settles on an answer that is about to stop being true. Two conditions are now
required, in order:

1. the layer's own animations are quiesced — scoped to `#menu`, because
   document-wide never settles while the homepage journey runs behind it;
2. and the answer under that particular point has stopped changing.

Both are states. No timeout raised, no retry, no sleep, no force click.

This is worth recording as a process point: the first version passed its first
green run. Only the 200× stress exposed it.

### Mutation check — §18

| Mutation | Result |
| --- | --- |
| `.menu { pointer-events: none !important }` | **4 of 4 projects FAIL** |

Re-verified against the final two-condition version, not only the first.
Reverted; product source clean, `dist` hash unchanged.

### Stress — §19

| Arm | Executions | Failures |
| --- | --: | --: |
| Isolated, `portrait-chromium`, round 1 | 200 | **0** |
| Isolated, `portrait-chromium`, round 2 | 200 | **0** |
| All four carrying projects | 240 | **0** |

### Combined — §20

| Arm | Executions | Failures |
| --- | --: | --: |
| Both contracts, all projects, 30 cycles | 270 | **0** |

**Total across both contracts: 1 335 executions, 0 failures.**

---

## New frozen subject — §27

| | |
| --- | --- |
| Commit | `1ec8dad` |
| `product` | `69106294dc4c1cbd…` — **unchanged** |
| `test` | `293a3b5c99c21be7…` — changed (the two corrections) |
| `config` | `39f6a93856f5b7fb…` — **unchanged** |
| `dist` | `2cce7616f7f96a0d…` — **unchanged** |
| Combined | `947e5403dff34462…` |

Both fixes are test-only, so §28's second case applies: production output is
identical and the unchanged `dist` hash is verified and recorded rather than
assumed. `dist` was nonetheless rebuilt from frozen source and confirmed
byte-identical.

The previous six-run sequence over `6fda3ff` is **historical only** — its test
hash no longer matches — and the counter resets to RUN 1 (§29).

---

## New six-run matrix

**Frozen commit `1ec8dad`. Six attempts, six VALID runs, zero discarded, zero
subject mutations, zero canary events, zero orphaned processes, zero held ports.**

| Run | Valid | Collected | Passed | Failed | Skipped | Duration | Mean load | Peak load | Subject identical |
| --- | ----: | --------: | -----: | -----: | ------: | -------: | --------: | --------: | ----------------: |
| 1 | VALID | 1436 | 1281 | 0 | 155 | 1203 s | 9.09 | 18.47 | yes |
| **2** | VALID | 1436 | **1280** | **1** | 155 | 1124 s | 8.04 | 19.33 | yes |
| 3 | VALID | 1436 | 1281 | 0 | 155 | 1219 s | 8.62 | 19.41 | yes |
| 4 | VALID | 1436 | 1281 | 0 | 155 | 1132 s | 6.88 | 14.50 | yes |
| 5 | VALID | 1436 | 1281 | 0 | 155 | 1120 s | 6.44 | 12.60 | yes |
| 6 | VALID | 1436 | 1281 | 0 | 155 | 1205 s | 7.59 | 14.59 | yes |

Runtime **1120–1219 s**; mean load **6.44–9.09**; peak load **12.60–19.41**.

### Skip-set identity

`bb65b6846f9975fa` in all six runs — one distinct hash, **the same 155 tests
skipped every time**, by identity and not merely by count.

### Failure-set identity — NOT identical

| Run | Failure set |
| --- | --- |
| 1, 3, 4, 5, 6 | *(empty)* |
| **2** | `[mobile-390] public-site.spec.ts:264` `/kkv.html responds and has a title and description` |

### Arithmetic

`passed + failed + flaky + skipped === collected` verified for both suites in
all six runs — **12 of 12 reconciliations, 12 successes.**

### Both corrected contracts

**Neither `homepage-chrome:1005` nor `homepage-modality:96` failed in any of the
six runs.** The two contracts this workstream existed to fix are fixed.

---

## The new wandering failure

```
[mobile-390] public-site.spec.ts:264
  /kkv.html responds and has a title and description          30.0 s

  Test timeout of 30000ms exceeded.
  Error: page.goto: Test timeout of 30000ms exceeded.
  Call log:
    - navigating to "http://127.0.0.1:4322/kkv.html", waiting until "load"
```

**Last confirmed event: `page.goto did not resolve — boundary NOT proven`.**

This is recorded exactly as §21 requires and no further. The call log proves the
navigation was *requested* and that `load` never fired. It does **not**
distinguish "request never sent" from "response received, load never fired", so
it is not called a navigation stall here.

### Why this one matters more than its single occurrence suggests

This is the **`mobile-390` `page.goto` on `/kkv.html`** — the same project and
the same route the previous investigation pursued through **24 010 targeted
navigations and six unmodified suite runs without a single reproduction**, and
which the current brief explicitly told this workstream not to reopen.

It has now appeared inside a run whose subject integrity is proven: identical
hashes before and after, zero canary writes, an owned server with a recorded
lifecycle, and reconciled arithmetic. That is the first time this failure has
ever been observed under those conditions, and it is the opposite of the
previous conclusion that it "was not reproduced".

It also did **not** occur under high load — run 2 had the second-*lowest* mean
load of the sequence (8.04) and runs 4, 5 and 6 were greener at lower load
still. Load does not separate it.

**One occurrence in six is not a classification** (§33), and none is offered.
It is carried as a new, separate contract to investigate — not as evidence
about the two that were fixed.

## Portal P1/P2

**411 collected, 411 passed, 0 failed, 0 skipped, in every one of the six runs
— 2 466 executions, zero failures.** Deterministic and untouched.

## WebGL suite

**165 collected, 131 passed, 0 failed, 34 skipped, identical in all six runs.**
Deterministic.

## Renderer

`tests/harness.spec.ts`: **12/12 passed in every run, 72 assertions, 0 failures.**

```
desktop-1440   ANGLE (Apple, ANGLE Metal Renderer: Apple M4)
desktop-1920   ANGLE (Apple, ANGLE Metal Renderer: Apple M4)
mobile-390     Apple GPU
mobile-430     Apple GPU
```

**No SwiftShader regression.**

## Cleanup

After the sequence: no gate process alive, no gate port held, no headless
browser surviving, worktree clean, and the subject re-hashed to `947e5403…` —
identical to the frozen reference.

## Merge decision

```
FINAL TWO NONDETERMINISTIC CONTRACTS RESOLVED

HERMETIC REGRESSION GATE NOT ACCEPTED
REPOSITORY-WIDE MERGE GATE: NOT GREEN
```

The two contracts named by this workstream **are** resolved: diagnosed to root
cause, corrected with deterministic state waits, mutation-checked, stressed over
1 335 executions with zero failures, and absent from all six authoritative runs.

The gate is nonetheless **NOT ACCEPTED**, because a different wandering failure
took their place. §33 requires exactly that outcome for a new wandering failure,
and §25 forbids `ACCEPTED WITH LIMITATIONS` as a way to describe nondeterminism.

Every other acceptance condition is met: 6/6 valid, identical commit and all
four subject hashes, identical collected, identical skip **set**, twelve of
twelve arithmetic reconciliations, all required constituent gates in every run,
renderer and Portal clean throughout, no leak, and no timeout, retry, skip or
force workaround introduced anywhere.

**1 435 of 1 436 contracts are deterministic across six hermetic runs.** The
remaining one is named, its boundary is recorded to the limit the artefact
supports, and it is the next piece of work — not a reason to weaken this gate.

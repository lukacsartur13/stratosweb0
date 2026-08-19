# The new authoritative six-run sequence

§43-§45, §49. Method recorded before the runs, so it cannot be adjusted to fit
the outcome.

## Why a new sequence at all

§43: any test, harness or product modification invalidates the previous merge
sequence. This workstream changed the test group — the recorder, the correlated
server diagnostics, the gate wiring, and two harness fixes — so **no run from
the `g2` or `g3` sequences counts toward acceptance** (§44). The sequence below
carries the prefix `g4` and starts from zero.

## The frozen subject

| | |
| --- | --- |
| commit | `32d08c4f412a82643a2451a2021f2b41193ac3cb` |
| product | `69106294dc4c1cbd140414c8376cfb0cdee7ece836a366304cb7dcb92136f7b6` |
| test | `ed25678015cf1e14804e37fc…` |
| config | `39f6a93856f5b7fb2cb602dfca57ce3018e93c4e2bf32c238329a7255a657b50` |
| **dist** | `2cce7616f7f96a0d6ba51fe386f8431cc9ed712d7231b49807f3b404cfa371d4` |
| subject root | `/Users/arturlukacs/stratos-hermetic/subject` (outside iCloud) |

The subject is **pinned to `32d08c4`, not moved to the branch head.** One later
commit exists on the branch — `62f2c9a`, `curate-final-gate.mjs` — which is
post-processing tooling that no gate loads. Putting it in the subject would
change the `test` hash for no functional reason and would split the stress
evidence and the gate evidence across two different subjects. They run against
one.

**`product`, `config` and `dist` are byte-identical to the sequence in which the
failure occurred.** Only `test` moved. That is the whole §4 claim, and it is a
hash comparison rather than an assurance: the browser in the new sequence is
served the same 186 files, byte for byte, as the browser that stalled.

## What each run does

Unchanged from the accepted architecture (§5) — build, freeze, arm canaries,
start owned servers, nine gates, shutdown, AFTER manifest, cleanup verification.
Two things are new:

1. **The recorder is armed inside the gate** (`b304a39`). The gate passes
   `STRATOS_NAV_DIAG_*` to both Playwright gates and to both servers, so the
   correlation log lands under the run's own directory. Verified before the
   sequence: a gate run on alternate ports produced `nav-diag/server-4522.jsonl`
   and `nav-diag/server-4527.jsonl`. §46 is a property of the gate, not of
   whoever remembers to export three variables.
2. **`route-audit` proves the server it audits is this checkout's** (`63712b5`),
   after it was caught auditing another project's website through a port
   collision.

## Acceptance — §45, and one addition

All of:

* 6 / 6 **VALID**
* 6 / 6 **GREEN**
* identical collected count (1 436 = 1 271 main + 165 WebGL)
* identical skip set, by identity
* zero subject mutation — `dist` hash before == after, every run
* zero canary write events
* zero orphaned processes, zero held ports
* renderer canary stable (ANGLE Metal on Chromium, Apple GPU on WebKit)
* Portal P1/P2 411/411 every run
* arithmetic reconciled per suite

and, added by this workstream:

* **§46 — no navigation-shaped failure without a `lastConfirmedState`.** A
  sequence that is otherwise green but produced an unclassifiable `page.goto`
  timeout has NOT met the bar, because that outcome would mean the
  instrumentation workstream itself failed. `scripts/hermetic/curate-final-gate.mjs`
  enforces this rather than leaving it to be remembered.

A wandering failure — a test failing in some runs and not others — is
disqualifying regardless of green rate (§37). Six runs failing the *same* test
identically is a better result than five green and one failing somewhere new.

## Results

*(Appended when the sequence completes.)*

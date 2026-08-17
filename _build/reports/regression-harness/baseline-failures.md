# Baseline failures — the frozen suite at `39b41cd`, classified

Every failure produced by five consecutive full-suite runs of the unmodified
commit, with the class each one ended in. Captured from Playwright's JSON
reporter, never from terminal output: `tail` on a Playwright run shows the
summary and hides the failure list, which is the reporting error that produced
the false P2 result.

Complete per-run data: `repeated-baseline.csv`. Per-test matrix:
`failure-matrix.md`.

---

## 1. The five runs

| Run | Collected | Passed | Failed | Skipped | Accounted | Duration |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 1305 | 1176 | **7** | 122 | 1305 ✅ | 9.7 min |
| 2 | 1305 | 1178 | **5** | 122 | 1305 ✅ | 9.0 min |
| 3 | 1305 | 1177 | **6** | 122 | 1305 ✅ | 9.3 min |
| 4 | 1305 | 1178 | **5** | 122 | 1305 ✅ | 9.0 min |
| 5 | 1305 | 1176 | **7** | 122 | 1305 ✅ | 9.1 min |

Collected and skipped are identical across all five. The arithmetic reconciles
in every run — so the *reporting* was sound; it was the *result* that was not
reproducible.

**Failure count: 7, 5, 6, 5, 7. Distinct tests involved: 12. Failing in every
run: 1.**

---

## 2. The failure set

Statuses: `PASS` · `FAIL` (assertion) · `TIMEOUT` (ran out of its own budget).

Transcribed from `failure-matrix.md`, which `scripts/gate-matrix.mjs` generates
from the five JSON artefacts. Where this table and that one ever disagree, that
one is right — it is derived, this one is written.

| # | Project | Test | R1 | R2 | R3 | R4 | R5 | Fails | Stability | Class |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `desktop-1920` | `homepage-chrome:422` opens from every header state | TIMEOUT | TIMEOUT | FAIL | FAIL | FAIL | 5/5 | **STABLE** | **C** |
| 2 | `desktop-1920` | `homepage-chrome:470` focus is trapped inside the layer | TIMEOUT | TIMEOUT | TIMEOUT | PASS | TIMEOUT | 4/5 | WANDERING | **C** |
| 3 | `desktop-1440` | `homepage-chrome:422` opens from every header state | PASS | FAIL | TIMEOUT | PASS | FAIL | 3/5 | WANDERING | **C** |
| 4 | `reduced-motion` | `homepage-chrome:470` focus is trapped inside the layer | TIMEOUT | TIMEOUT | TIMEOUT | PASS | PASS | 3/5 | WANDERING | **C** |
| 5 | `desktop-1920` | `homepage-modality:220` keyboard focus stays in the layer | TIMEOUT | TIMEOUT | PASS | PASS | TIMEOUT | 3/5 | WANDERING | **C** |
| 6 | `desktop-1440` | `homepage-chrome:470` focus is trapped inside the layer | PASS | PASS | TIMEOUT | PASS | TIMEOUT | 2/5 | WANDERING | **C** |
| 7 | `desktop-1920` | `homepage-chrome:558` opening the menu does not walk the journey back down | PASS | PASS | TIMEOUT | PASS | FAIL | 2/5 | WANDERING | **C** |
| 8 | `desktop-1920` | `homepage-history:223` back and forward restore the position | FAIL | PASS | PASS | FAIL | PASS | 2/5 | WANDERING | **C** |
| 9 | `mobile-390` | `mobile-homepage-simple:170` the renderer is not requested when there is no WebGL | FAIL | PASS | PASS | FAIL | PASS | 2/5 | WANDERING | **B** |
| 10 | `mobile-430` | `mobile-homepage-simple:170` the renderer is not requested when there is no WebGL | FAIL | PASS | PASS | FAIL | PASS | 2/5 | WANDERING | **B** |
| 11 | `desktop-1440` | `homepage-chrome:259` the journey state compacts the wordmark | PASS | PASS | PASS | PASS | FAIL | 1/5 | WANDERING | **C** |
| 12 | `desktop-webkit` | `homepage-modality:220` keyboard focus stays in the layer | PASS | PASS | PASS | **FAIL** | PASS | 1/5 | WANDERING | **A** |

**1 stable · 11 wandering · 0 unresolved.**

Row 1 is worth reading carefully: it fails in all five runs, but **not in the
same way** — twice by running out of its budget and three times by a failed
assertion. Even the one stable failure is not stable in its mechanism, which is
the clearest single statement of what a shifting baseline costs.

Classes, from `gate-policy.md` §4: **A** real product defect · **B** real test
defect · **C** load/resource contention · **D** environment-specific limitation ·
**E** non-deterministic application behaviour · **F** unresolved.

---

## 3. Class C — nine failures, one cause

Rows 1–9. All on **Chromium** projects (`desktop-1440`, `desktop-1920`,
`reduced-motion`), all on the WebGL homepage, all with the same mechanism:
Chromium rasterises the scene through SwiftShader at 4–7 fps, Playwright derives
element stability and input dispatch from animation frames, and a single click
costs 2 086 ms idle and up to 20 781 ms under the suite's own load — against a
30 000 ms budget. Full measurement in `root-cause-report.md` §3–4.

Representative durations: 31.9 s, 40.0 s, 46.8 s, 70.1 s. The budget is 30 s;
the excess is teardown and screenshot capture.

**The product is not implicated in any of them.** Where an actionability failure
was instrumented, the hit-test was correct every time: `elementFromPoint`
resolved to the target or its child, `pointer-events: auto`, `visibility:
visible`, `opacity: 1`, correct box. Playwright's own log says the same — the
element resolved, and the click was never dispatched:

```
Error: locator.click: Test timeout of 30000ms exceeded.
  - waiting for locator('.burger')
    - locator resolved to <button class="burger" aria-expanded="false">…</button>
  - attempting click action
    - waiting for element to be visible, enabled and stable
```

Rows 3, 5, 9 fail inside loops of `keyboard.press('Tab')` — each press a protocol
round trip into a starved renderer. Row 8 fails on a 20 s `waitForFunction`
waiting for ten consecutive animation frames to report the same altitude, which
at 4 fps is 2.5 s of frames before the damped value has even begun to converge.

### Why row 1 is "stable" and the rest are not

`desktop-1920` is the largest software-rastered viewport in the general matrix
(2.07 M pixels per frame, all CPU) and it carries both the general suite *and*
the hardening suites — the most loaded project in the run. `homepage-chrome:422`
performs three full scroll-settle-assert cycles in one test. It is not stable
because it is a different kind of failure; it is stable because it is the
furthest over the line — and, as the matrix shows, it still alternates between
timing out and failing an assertion. It is class C exactly as the other eight
are.

Rows 2–8 and 11 are the same failure at different distances from the line, which
is why the *set* moves while the *population* does not.

---

## 4. Class B — rows 10 and 11, one real test defect

`revealed()` swept the document in fixed 70 ms hops, returned to the top, and
only then required every reveal element to carry `.is-in`. `IntersectionObserver`
samples rather than tracks, so an element scrolled past between two hops may
never be reported — and from the top it can never intersect again, so a miss is
unrecoverable and must run to the 20 s timeout.

Failed in runs 1 and 4 on **both** WebKit projects at once — the two projects
that pay none of the SwiftShader cost, which is why this one did not fit the
class-C pattern and was worth pulling on.

Verified as a test defect and not a product defect:

| Level | Result |
| --- | --- |
| Isolated, 1 worker, ×3 | 1 passed, 1 passed, 1 passed |
| File serial, 1 worker | 26 passed (1.2 min) |
| File parallel, both WebKit projects | 52 passed (45.6 s) |
| Full suite | fails in 2 of 5 |

---

## 5. Class A — row 12, one real product defect

`homepage-modality:220` on `desktop-webkit`, run 4, at **8.0 s** — the only
failure in the entire baseline that is not a timeout:

```
expect(locator).toBeVisible() failed
Locator: locator('#menu')
Expected: visible
Received: hidden
```

`assets/js/header.js` `close()` armed `setTimeout(() => menu.hidden = true, 420)`
and stored no handle, so a reopen inside 420 ms was overtaken by the previous
close's timer. Reproduced deterministically on both engines at every gap below
420 ms. Full analysis in `root-cause-report.md` §6.

**It appeared on the fastest project in the matrix because it requires speed.**
On a starved run the driven reopen took longer than the 420 ms it was racing, and
the defect hid. This is the finding that most justifies the workstream: the
noisier the suite got, the better it concealed a real accessibility defect.

---

## 6. What the baseline proves

* **Same commit + same environment ≠ same result.** Eleven of twelve failures
  wander. The failure *set* is not a property of the source.
* **A red suite did not mean a regression**, and — worse — **a green test did not
  mean a working product**: rows 10–12 were present the whole time.
* **The reporting was never the problem.** All five runs reconcile. The P2
  miscount came from reading the terminal, not from the numbers.
* **Nothing here was "flaky".** Every one of the twelve ended in a measured
  class, and none in **F**.

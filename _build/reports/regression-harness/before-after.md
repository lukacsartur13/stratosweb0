# Before and after

Baseline is five full-suite runs of `39b41cd`, unmodified. Stabilized is five
full-suite runs of the frozen commit at the end of this workstream. Same
machine, same night, same 10-core host under the same background load.

---

## 1. The headline

| | Baseline `39b41cd` | Stabilized |
| --- | --- | --- |
| Runs | 5 | 5 |
| Failures per run | **7, 5, 6, 5, 7** | see §6 |
| Distinct tests ever failing | **12** | see §6 |
| Stable failures | 1 | — |
| **Wandering failures** | **11** | — |
| Wall clock per run | 9.7 / 9.0 / 9.3 / 9.0 / 9.1 min | 4.4 / 4.7 / 4.7 / 4.6 / 4.6 min *(first gate)* |
| Mean wall clock | **552.3 s** | **~277 s** |
| Collected | 1305 | 1271 |
| Skipped | 122 | 122 |
| Arithmetic reconciled | 5/5 | 5/5 |

**The suite got roughly twice as fast while getting more deterministic**, which
is worth stating plainly because §42 of the brief anticipated the opposite trade.
Nothing was removed to achieve it except 50 proven duplicates; the time came from
the renderer.

---

## 2. Rendering

| | Baseline | Stabilized |
| --- | --- | --- |
| Chromium renderer | `SwiftShader driver` (CPU) | `ANGLE Metal Renderer: Apple M4` |
| WebKit renderer | `Apple GPU` | `Apple GPU` (unchanged) |
| Homepage frame rate, 1 page | **4 fps** | **58 fps** |
| Homepage frame rate, 5 pages | **3–7 fps** | **41–50 fps** |
| `locator.click()`, 1 page | **2 086 ms** | **89 ms** |
| `locator.click()`, 5 pages | **4 850 – 20 781 ms** | **40 – 47 ms** |
| Renderer asserted by a test | no | **yes** (`tests/harness.spec.ts`) |

---

## 3. Load characteristics

| | Baseline | Stabilized |
| --- | --- | --- |
| Load average at rest | 1.38 | 1.38 |
| Peak load average during a run | **75.5** | not re-measured; wall clock halved at the same worker count |
| Seconds per run with 5 software-rastered pages live | **177 s of 579 s (31 %)** | **0** — there is no software rasterisation left to be concurrent |
| Workers | 5 (inherited from "50 % of cores") | 5 (stated explicitly) |
| Retries | 0 local / **2 on CI** | **0 everywhere** |

The worker count did not change. That is deliberate: the brief forbids reaching
green by reducing parallelism, and the measurement showed parallelism was never
the cause.

---

## 4. Reporting

| | Baseline | Stabilized |
| --- | --- | --- |
| Machine-readable artefact locally | **none** — `[['list']]` only | JSON on every run |
| Totals reconciled by a program | no | **yes**, `scripts/gate-report.mjs`, exit 2 on mismatch |
| A `--list` artefact can pass as a gate | **yes** — it reconciles perfectly | **no**, rejected by name |
| Repeated runs keep their artefacts | n/a | **yes** (fixed after the first gate overwrote its own) |
| Stable vs wandering computed | by hand, from memory | `scripts/gate-matrix.mjs`, exit 1 on wandering |
| Gate names its commit | no | **yes**, and discloses a dirty tree |

---

## 5. Suite composition

| | Baseline | Stabilized | Δ |
| --- | --- | --- | --- |
| Collected | 1305 | 1271 | −34 |
| `reduced-motion` project | 147 | 97 | **−50** duplicates |
| `tests/harness.spec.ts` | — | 12 | **+12** |
| Menu reopen regression test | — | 6 | **+6** |
| Spec files | 18 | 19 | +1 |

−50 + 12 + 6 = −32. The remaining −2 is `homepage-modality`'s new test not being
carried by the two projects that ignore `HARDENING`. Every number above is
derived from `playwright test --list`, per project, and reconciles against the
collected total in both directions.

---

## 6. The failure sets

### Baseline — 12 tests, 11 of them wandering

Full matrix in `failure-matrix.md`. Classes in `baseline-failures.md`:
**9 × C** (contention), **2 × B** (one test defect, on two projects),
**1 × A** (one real product defect). **0 unresolved.**

### First stabilized gate — 2 wandering failures, both newly exposed

The first five-run gate at `2dda7f8` was **not** clean, and the two failures were
ones the baseline had never produced:

| Test | R1 | R2 | R3 | R4 | R5 |
| --- | --- | --- | --- | --- | --- |
| `homepage-chrome:531` body scroll is locked while open | PASS | PASS | **FAIL** | PASS | PASS |
| `homepage-chrome:259` the journey state compacts the wordmark | PASS | PASS | PASS | PASS | **FAIL** |

Both failed *fast* — 4.0 s and 0.7 s — as assertions rather than timeouts, and
both were the same defect: **an assertion taken immediately after a proxy
signal, on a quantity that is still easing.** The header compacts from ~58.8 px
to 52.48 px over ~300 ms after a scroll; `:259` caught it at 55.39 px against a
54 px bound, and `:531` read a scroll position 25 px from where it settled.

They had never failed before because **the old environment was too slow to catch
the page mid-transition.** Fixing the renderer did not create these; it revealed
them. That is the workstream working as intended, and it is why the gate was
repeated rather than declared.

Fixed by `atRest()` — three consecutive agreeing samples, and an explicit throw
naming the quantity instead of the silent give-up the three previous loops had.

### Second gate at `4f2ace3` — 3 wandering failures, two distinct new causes

Also not clean, and again the failures were ones the baseline had never
produced:

| Test | R1 | R2 | R3 | R4 | R5 | Cause |
| --- | --- | --- | --- | --- | --- | --- |
| `homepage-modality:96` click through the layer *(portrait-chromium)* | PASS | **FAIL** | PASS | PASS | PASS | navigation race, class B |
| `public-site:264` `/arajanlat.html` responds *(mobile-390)* | PASS | PASS | PASS | **TIMEOUT** | PASS | **the web server**, class D |
| `public-site:264` `/nagyvallalat.html` responds *(mobile-390)* | PASS | PASS | PASS | PASS | **TIMEOUT** | **the web server**, class D |

**The navigation race** was a known defect with an incomplete mitigation. The
test clicked, then called `waitForLoadState('domcontentloaded')` — which
resolves immediately against the document that is *already* loaded, so when the
click had started a navigation the following `evaluate` raced its commit. A
comment describing this exact symptom was already sitting above the mitigation
that did not close it. Fixed by deciding the outcome *before* the click: read
whether the pointer is over one of the layer's links, then either await the
navigation as the expected event or read the focused element on a document that
cannot navigate.

**The two `page.goto` timeouts are the more important finding.** They are 30 s
timeouts on plain 15 KB static HTML pages that the same run served correctly
hundreds of times. Python 3.9's `http.server` answers HTTP/1.0 with
`Connection: close` and has no keep-alive — the `--protocol` flag arrived in
3.11 — so every asset was a new TCP connection, and five workers pulling a
1.4 MB bundle plus a `.glb` each churned hundreds of sockets a second against
one GIL-bound process reading from an iCloud-backed volume. Occasionally a
connection sat behind the accept queue longer than a test's entire budget.

This one is worth naming plainly: **the root-cause report's §8 had recorded the
web server as "not implicated", on the evidence available at the time.** It was
wrong. Page-load timings scaled cleanly with concurrency in the probes, so the
server looked healthy — but a rare dropped connection does not show up in a
median. It took a suite that was otherwise deterministic for the failure to
become visible at all, which is the whole argument for this workstream in one
example: the noise was hiding it.

Replaced by `scripts/test-server.mjs`, zero-dependency `node:http`, which speaks
HTTP/1.1 with keep-alive by default. Same directory, same index resolution, same
404s, no caching, no compression.

### Third gate at `27044dd`

Results in `final-gate.json` and §7 of `final-report.md`.

---

## 7. What did not change

* No timeout was raised. The pre-existing `test.slow()` on `lead-forms.spec.ts`
  and `attribution.spec.ts` is untouched — and is now slack rather than
  load-bearing.
* No test was skipped, quarantined, deleted, or weakened.
* No assertion was loosened. `atRest()` makes the *measurement* honest; the
  bounds it feeds are the same bounds.
* No product code changed except the one-line timer-handle fix in
  `assets/js/header.js`, which repaired a real defect.
* The public homepage, the mobile Altimeter, the Portal, the typography, the
  mountains and the stage composition were not touched.

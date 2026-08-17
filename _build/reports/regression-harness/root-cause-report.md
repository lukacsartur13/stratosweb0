# Root-cause report

What made the suite nondeterministic. Measured causes, with the contribution of
each quantified, and the hypotheses that were tested and found wrong recorded
alongside the ones that held.

---

## 1. The answer, in one paragraph

**Headless Chromium was rendering the homepage through SwiftShader — ANGLE's
software rasteriser — at four to seven frames a second, while the WebKit
projects in the same suite used the Apple GPU at sixty.** Playwright derives
element *stability*, input dispatch and every `waitForFunction` poll from
animation frames, so at that frame rate a single `locator.click()` on the
homepage cost **2 086 ms with the machine idle and up to 20 781 ms with the
suite's five workers running**, against a 30 000 ms per-test budget. Which test
crossed its budget first depended on which other tests happened to be scheduled
beside it, and that is the entire mechanism of the wandering. It was not a
scheduling problem, not a leak, and not application nondeterminism. It was the
renderer, and the configuration never mentioned it.

---

## 2. Contribution of each candidate cause

| Candidate | Verdict | Contribution | Evidence |
| --- | --- | --- | --- |
| **Software rasterisation** | **CONFIRMED — dominant** | **~10–250× on the metric that fails tests** | §3 |
| **Worker oversubscription** | CONFIRMED — amplifier, not cause | ~6× on top of the above | §4 |
| CPU saturation | Real, but a *consequence* of the above | load 1.38 → 75.5 | §4 |
| **Bad timeout architecture** | CONFIRMED — 1 test | 2 of 5 runs | §5 |
| **Application nondeterminism** | **CONFIRMED — 1 real defect** | 1 of 5 runs | §6 |
| Resource leakage / progressive degradation | **REFUTED** | none | §7 |
| Test-order contamination | **REFUTED** | none | §7 |
| Overlay / hit-test interception | **REFUTED** | none | §8 |
| **The Python web server** | **CONFIRMED — found late** | 2 timeouts in 5 runs | §8 |
| iCloud Drive file eviction | Not implicated *in these runs* | — | §8 |

Three further causes were found only *after* the dominant one was fixed, because
a suite with 5–7 shifting failures cannot show you a defect that occurs once in
five runs. They are listed here rather than buried: two eased-value measurement
faults (`before-after.md` §6), one navigation race, and the web server. Each is
a class **B** or **D** that the noise had been hiding.

---

## 3. The dominant cause, measured

Probed by launching each engine against the built homepage and reading
`WEBGL_debug_renderer_info` from the page itself:

| Project shape | Renderer reported | Path |
| --- | --- | --- |
| Chromium, any viewport | `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0)), SwiftShader driver)` | **CPU** |
| WebKit, any viewport | `Apple GPU` (vendor `Apple Inc.`) | hardware |

Four of the eight projects are Chromium. Nothing in `playwright.config.ts`
distinguished them from the WebKit ones, and the worker pool treated all eight
as interchangeable.

### What that costs, on the metric that decides pass or fail

Measured on the built homepage, same machine, same minute:

| | 1 page | 5 pages (the suite's real shape) |
| --- | --- | --- |
| **SwiftShader** — frame rate | 4 fps | 3–7 fps |
| **SwiftShader** — `locator.click()` | **2 086 ms** | **4 850 / 10 485 / 10 897 / 11 011 / 20 781 ms** |
| **ANGLE Metal** — frame rate | 58 fps | 41–50 fps |
| **ANGLE Metal** — `locator.click()` | **89 ms** | **40 / 41 / 43 / 43 / 47 ms** |

A **250–500× difference in click actionability at the suite's real
concurrency.** The per-test budget is 30 000 ms.

### Why this produces *timeouts* rather than *slowness*

Playwright will not dispatch a click until the target is visible, enabled,
receiving events and **stable** — where stable means the bounding box is
unchanged across two consecutive animation frames. At 4 fps one such check costs
at least 500 ms, and any residual motion on the page restarts it. The homepage is
a scroll-driven journey whose header is a state machine, so residual motion is
the normal condition.

Baseline run 1's first failure says exactly this and nothing else:

```
Error: locator.click: Test timeout of 30000ms exceeded.
  - waiting for locator('.burger')
    - locator resolved to <button class="burger" aria-expanded="false">…</button>
  - attempting click action
    - waiting for element to be visible, enabled and stable
```

The element was found. The click was never dispatched. Per §10 of the brief, the
timeout is **before** input delivery.

### Corroboration already in the repository

`tests/homepage-modality.spec.ts:262` carries this note, written before this
workstream:

> A key press on this page at 1920x1080 costs 0.7–1.3 s, measured with the
> machine entirely to itself — that is what moving focus costs on a document
> compositing a ~1 MB WebGL scene through a software rasteriser.

The cost had been measured, attributed correctly, and then **worked around** by
shortening the sweep from 30 presses to 8. That is the shape of a suite being
tuned to fit a broken environment rather than the environment being fixed, and it
is why the failure kept moving instead of going away.

---

## 4. The amplifier

`workers` was unset locally, so Playwright used 50 % of logical cores = **5**.
With `fullyParallel: true` and the three heaviest files running on five projects
each, five workers all running software-rastered homepages was the *normal* case.

From baseline run 1, bucketing every software-rastered Chromium WebGL test by how
many other such tests overlapped it in time:

| Concurrent heavy peers | Tests | Median duration | Failures |
| --- | --- | --- | --- |
| 0 | 1 | 6.2 s | 0 |
| 1 | 1 | 0.6 s | 0 |
| 2 | 6 | 0.4 s | 0 |
| 3 | 21 | 0.7 s | 0 |
| **4 +** | **167** | **4.1 s** | **5** |

Run 2 reproduces it: 0.6 s / 0.7 s at 2–3 peers, **4.0 s** and all 5 failures at
4+. A **~6× slowdown**, and **every failure in both runs is inside that band**.

Sampling run 1 second by second for how many software-rastered pages were live:

| Live software-rastered pages | Seconds of the run |
| --- | --- |
| 0 | 239 s |
| 1 | 65 s |
| 2 | 53 s |
| 3 | 17 s |
| 4 | 28 s |
| **5** | **177 s** |

**177 of 579 seconds — 31 % of the wall clock — with all five workers
rasterising WebGL on the CPU.** Load average, sampled every 15 s, went from
**1.38 at rest to a peak of 75.5** on a 10-core machine.

The amplifier is real, and it is *not* the cause: at concurrency 1 a click still
cost 2 086 ms. Capping workers would have moved the suite from "fails
unpredictably" to "passes slowly and fails at the next provocation", which is
what §3 of the brief calls optimising the score.

---

## 5. Bad timeout architecture — one test, class B

`revealed()` in `tests/mobile-homepage-simple.spec.ts` scrolled the document in
fixed 70 ms hops, returned to the top, and only then waited for every reveal
element to carry `.is-in`. Three faults:

* `IntersectionObserver` **samples rather than tracks**, so whether an element
  scrolled past between two hops was reported at all depended on when the
  observer next ran — which depends on how much of the machine the tab is
  getting.
* A miss was **unrecoverable**: back at the top, an element halfway down the
  document is not intersecting and never will be again, so anything skipped could
  only be waited out to the 20 s timeout.
* The sweep's bound was a `scrollHeight` read **once, before any reveal fired**.

Failed in **2 of 5** baseline runs, on **both** WebKit projects simultaneously,
and passed in isolation (×3), file-serial (26 tests) and file-parallel (52 tests)
every time — the signature of something that only loses the race when the machine
is oversubscribed.

Rewritten to advance one screen at a time and wait for the observer to have
caught up on everything fully above the reveal line before advancing again. A
slow observer now makes a step take longer; it can no longer make an element
disappear. Same 52 tests, same runtime (46.7 s vs 45.6 s).

---

## 6. Application nondeterminism — one real defect, class A

`assets/js/header.js` `close()`:

```js
const done = () => { menu.hidden = true; };
if (RM) done();
else setTimeout(done, 420);          // no handle stored
```

`close()` cannot hide the layer immediately — it has a 420 ms transition — so it
hid it on a timer and kept no handle. `open()` sets `hidden = false`. **A reopen
inside 420 ms is therefore overtaken by the previous close's timer**, and the
layer ends up `hidden = true` while `aria-expanded` reports `"true"`, `.is-open`
is on the element, and focus has already been moved inside it.

A visitor who closes the navigation and reopens it quickly gets an invisible
navigation that the DOM and assistive technology both describe as open.

Reproduced deterministically on both engines, driving the cycle from inside the
page so the gap is the quantity under test:

| Reopen gap | Chromium | WebKit |
| --- | --- | --- |
| 50 ms | **hidden while open** | **hidden while open** |
| 100 ms | **hidden while open** | — |
| 200 ms | **hidden while open** | **hidden while open** |
| 400 ms | **hidden while open** | — |
| 500 ms | ok | ok |

**This defect gets more likely as the harness gets faster.** It requires the
reopen to land inside 420 ms, so on a starved run a driven reopen took longer
than the timer it was racing and the bug hid. It surfaced on `desktop-webkit` —
the quickest project in the matrix, 3 tests, GPU-rendered — at **8.0 s**, which
is why it was the one failure in the whole baseline that was not a timeout:

```
expect(locator).toBeVisible() failed
Locator: locator('#menu')
Expected: visible
Received: hidden
```

Fixed by storing the handle and clearing it on open. Covered by a new test that
drives the cycle from inside the page, because two driven clicks measure the
machine rather than the contract.

---

## 7. Refuted: leakage, degradation, and test order

**Progressive degradation.** Mean duration of `homepage-chrome` tests by quarter
of the run:

| | Q1 | Q2 | Q3 | Q4 |
| --- | --- | --- | --- | --- |
| Run 1 | 8.1 s | 9.9 s | **2.1 s** | 6.6 s |
| Run 2 | 8.6 s | 11.1 s | **1.6 s** | 4.7 s |

Not monotonic — the *third* quarter is the fastest in both runs, because that is
when the cheap `node` and filesystem projects are running and few WebGL pages are
live. An accumulating leak in WebGL contexts, rAF loops, listeners or renderer
processes would climb through the run. **It does not.** Duration tracks
*concurrency*, not elapsed time.

**Test-order contamination.** No failure follows a specific predecessor. The same
tests fail at different positions in different runs, and the correlation that
does hold is with concurrent heavy peers (§4), not with position.

Both were live hypotheses, and both are refuted by the data rather than by
argument. §34 of the brief called the leak investigation "possibly the
highest-value" one; here it was not, and saying so is the finding.

---

## 8. Refuted: the product, the server, and the volume

**Nothing intercepts the clicks.** At every captured failure moment the
actionability picture was clean: `elementFromPoint` resolved to the target or its
child, `pointer-events: auto`, `visibility: visible`, `opacity: 1`, correct
bounding box, `zIndex: 890`. §11's overlay check exonerates the product on every
click-related failure.

**The Python web server — this conclusion was WRONG, and is corrected below.**

What was measured: `python3 -m http.server` uses `ThreadingHTTPServer` on 3.9,
and page load stayed at 131–354 ms across 1→5 concurrent pages (469→1 238 ms on
WebKit). The serving cost scaled; it did not collapse. On that evidence the
server was recorded as not implicated.

**It was implicated.** Two of the five runs in the second stabilization gate
failed on `page.goto` for a plain 15 KB static page — `/arajanlat.html` and
`/nagyvallalat.html` — each timing out after 30 s waiting for `load`, on files
the same run served correctly hundreds of times. Python 3.9's `http.server`
answers HTTP/1.0 with `Connection: close` and has no keep-alive (`--protocol`
arrived in 3.11), so every asset is a new TCP connection; five workers pulling a
1.4 MB bundle and a `.glb` each churn hundreds of sockets a second against one
GIL-bound process reading from an iCloud-backed volume, and occasionally a
connection waits behind the accept queue longer than a test's whole budget.

The error in the original reasoning is worth keeping on the record, because it
is the same error this report exists to argue against: **a rare dropped
connection does not appear in a median.** Latency scaling cleanly under load
says nothing about the tail, and the tail is what fails tests. It only became
visible once the suite was otherwise deterministic — which is precisely the
argument for the workstream, demonstrated on the workstream's own analysis.

Replaced by `scripts/test-server.mjs` (zero-dependency `node:http`, HTTP/1.1
keep-alive). Classified **D** — an environment-specific limitation of the
harness, now removed rather than documented.

**iCloud Drive was not implicated in these runs.** The repository does live on a
file-provider volume and eviction is demonstrably active — `ls -lO dist/models/`
shows `compressed,dataless` on the sync-conflict twins. But every file the suite
actually serves was materialised throughout, and no failure had the shape of a
blocking materialisation. Recorded as a live hazard, not as a cause.

---

## 9. Why the noise mattered — the specific harm

Two genuine defects were sitting inside a failure set everybody had learned to
discount, and both are of a kind the noise was actively hiding:

* The `header.js` race (§6) surfaces **only on fast runs**, so the slower and
  noisier the suite became, the better it was concealed.
* The `revealed()` fault (§5) surfaces **only on slow runs**, and appeared
  identical to the six timeouts around it.

A baseline with 5–7 shifting failures cannot distinguish either from the weather.
That is the concrete cost of the noise, and it is the reason "make the suite
trustworthy" and "make the suite green" are different objectives — pursuing only
the second would have left both defects in place.

---

## 10. What was NOT done, and why

* **Timeouts were not raised.** The suite's existing `test.slow()` on
  `lead-forms.spec.ts` and `attribution.spec.ts` — a 3× budget — is left in place
  as pre-existing, and is now unnecessary rather than load-bearing.
* **Retries were not added.** They were removed: `retries` is now `0` on CI too.
  A test that passes on the second attempt is a wandering failure with its
  evidence discarded.
* **No test was skipped, quarantined, deleted or weakened.** The only tests that
  left the suite are 50 provable duplicates (`resource-map.md` §6), and they took
  no assertion with them.
* **Workers were not reduced to reach green.** The number is now *stated* (5
  rather than an inherited "50 % of cores"), and the one-worker cap exists only
  behind `STRATOS_SOFTWARE_RASTER`, for hosts that have no renderer to fix.
* **No execution-model split was adopted.** §14 of the brief offers separate
  projects, dedicated pools and separate CI jobs as legitimate answers to heavy
  workloads starving light ones. The measurement did not justify any of them: the
  starvation was caused by the renderer, and restructuring the scheduler would
  have treated the symptom. This is recorded as a measured decision not to act,
  not as an oversight.

# Regression harness stabilization — final report

**Frozen commit: `27044dde1ee79d48438f155d8ee0ef5cd45707a7`**
Branch `portal-p1-control-room`. Nothing pushed, deployed, merged, or migrated.

---

## 1. The verdict, first

```
REGRESSION HARNESS STABILIZATION NOT ACCEPTED

REPOSITORY-WIDE MERGE GATE: NOT GREEN
```

Five runs of the frozen commit produced **1, 0, 0, 2, 3** failures across **5
distinct tests, all of them wandering and none of them stable.** §54 of the
brief is explicit — `ACCEPTED` may not be used while unexplained wandering
failures remain — and five remain. The mechanism behind the largest group of
them is characterised but not proven, and none is isolated into a declared
separate gate.

This is a real and large improvement over the baseline, and it is not the
property that was asked for. Both halves of that sentence are in §2.

---

## 2. What changed, in numbers

| | Baseline `39b41cd` | Final `27044dd` |
| --- | --- | --- |
| Failures per run | **7, 5, 6, 5, 7** | **1, 0, 0, 2, 3** |
| Distinct tests ever failing | **12** | **5** |
| Stable failures | 1 | **0** |
| Wandering failures | **11** | **5** |
| Clean runs out of 5 | **0** | **2** |
| Mean wall clock | **552.3 s** | **262.4 s** |
| Collected / skipped, every run | 1305 / 122 | 1271 / 122 |
| Arithmetic reconciled | 5/5 | 5/5 |
| Chromium homepage frame rate | 4 fps (1 page), 3–7 (5 pages) | **58 / 41–50** |
| Chromium `locator.click()` | 2 086 ms (1 page), up to 20 781 (5) | **89 ms / 40–47 ms** |

**Roughly twice as fast, less than half as many failing tests, no stable
failure left — and still not deterministic.**

---

## 3. The root cause, and what it cost to find

Headless Chromium was rasterising the homepage through **SwiftShader**, on the
CPU, at 4–7 fps, while the WebKit projects in the same suite used the Apple GPU
at 60. Playwright derives element **stability** — two consecutive animation
frames with an unchanged box — and every `waitForFunction` poll from frames, so
at that frame rate a single click cost **2 086 ms idle and up to 20 781 ms under
the suite's own load**, against a 30 000 ms budget. Which test crossed the line
first depended on what else was scheduled beside it.

31 % of a baseline run's wall clock had all five workers rasterising WebGL on
the CPU; load average went from 1.38 at rest to **75.5**. Every baseline failure
fell inside that band, and **none** outside it.

Full measurement, and the four hypotheses that were tested and refuted
(resource leakage, progressive degradation, test-order contamination, overlay
interception), are in `root-cause-report.md`.

---

## 4. Real defects the noise was hiding

The point of the workstream, demonstrated four times.

| # | Defect | Class | How it hid |
| --- | --- | --- | --- |
| 1 | **`header.js` armed an uncancellable 420 ms hide timer.** Reopen the navigation inside 420 ms and the previous close hides a layer that is open — `aria-expanded="true"`, `.is-open` set, focus inside it, nothing on screen. | **A** | It needs *speed*. On a starved run the reopen took longer than the timer it raced. It surfaced on `desktop-webkit`, the fastest project. |
| 2 | **`revealed()` could lose an element permanently.** Fixed 70 ms hops past a sampling `IntersectionObserver`, then a return to the top where a missed element can never intersect again. | **B** | Only lost the race when oversubscribed; passed isolated, file-serial and file-parallel every time. |
| 3 | **Two eased values measured mid-transition.** The header eases 58.8 px → 52.48 px over ~300 ms; `:259` read 55.39 px against a 54 px bound, `:531` read a scroll position 25 px from rest. | **B** | The old environment was too slow to catch the page mid-transition. Fixing the renderer *created* these failures by making the suite fast enough to see them. |
| 4 | **A navigation race with a mitigation that did not work.** `waitForLoadState` resolves against the already-loaded document, so it never settled the navigation it was there to settle. A comment describing the exact symptom sat above it. | **B** | Rare, and indistinguishable from the six timeouts around it. |

Defect 1 is user-facing: a visitor who closes and quickly reopens the navigation
gets an invisible menu that the DOM and assistive technology both call open.

---

## 5. An error in this workstream's own analysis

`root-cause-report.md` §8 originally recorded the Python web server as **not
implicated**, because page-load latency scaled cleanly from 1 to 5 concurrent
pages. That was wrong, and the correction is in the file.

Two of five runs in the second gate failed on `page.goto` for a plain 15 KB
static page, timing out after 30 s. Python 3.9's `http.server` answers HTTP/1.0
with no keep-alive (`--protocol` arrived in 3.11), so every asset was a new TCP
connection.

**A rare dropped connection does not appear in a median.** Latency scaling
cleanly says nothing about the tail, and the tail is what fails tests. It became
visible only once the suite was otherwise quiet — the workstream's own thesis,
demonstrated against the workstream's own reasoning. Replaced by
`scripts/test-server.mjs` (zero-dependency `node:http`, HTTP/1.1 keep-alive).

---

## 6. What remains — the five wandering failures

From `final-gate.json` and `final-failure-matrix.md`, at `27044dd`:

| Test | R1 | R2 | R3 | R4 | R5 | Class |
| --- | --- | --- | --- | --- | --- | --- |
| `[mobile-390] public-site:264` `/kkv.html` responds | TIMEOUT | PASS | PASS | PASS | TIMEOUT | **F** |
| `[mobile-390] public-site:240` en homepage entry point | PASS | PASS | PASS | TIMEOUT | PASS | **F** |
| `[mobile-390] public-site:281` hreflang cross-links | PASS | PASS | PASS | PASS | TIMEOUT | **F** |
| `[desktop-webkit] homepage-history:223` back/forward restore | PASS | PASS | PASS | FAIL | PASS | **F** |
| `[desktop-1440] homepage-chrome:966` navigating away leaves nothing behind | PASS | PASS | PASS | PASS | FAIL | **F** |

**Four of the five are WebKit — the engine that was not changed.** That is a
coherent picture rather than a coincidence: removing the dominant Chromium noise
uncovered a smaller, second population that it had been masking. It is also
precisely why the verdict is NOT ACCEPTED: a second population has been exposed
and not yet explained.

**What is known about the three `mobile-390` timeouts.** All are `page.goto`
hanging for the full 30 s on a plain static page, in a worker that served the
same kind of page in 0.4 s immediately before and after. They persist across
*both* web servers, so the server is not the cause. Frequency is roughly **1 in
1 500 navigations**. The mechanism is not established, which is what makes them
class **F** rather than **D**.

**A confound that must be stated.** Runs 4 and 5 — the two worst — are also the
two during which this session was running its own analysis commands against the
same machine. Durations rose with them (4.6–4.7 min against 4.1–4.3 min for the
clean runs). The gate has never been measured on an idle host; `baseline-
environment.md` §4 records that the agent session was the largest single CPU
consumer before any of this started. **This is a reason to re-measure, not a
reason to discount the result.**

---

## 7. What was verified by deliberately breaking it

§22 and §44. Mutations applied, observed, and reverted; none committed.

| Mutation | Result |
| --- | --- |
| Undeclared software rasteriser (`--use-angle=metal` removed) | **CAUGHT** — 4 failures naming the renderer |
| `STRATOS_SOFTWARE_RASTER=1` (declared fallback) | **PASSES**, 12/12, as designed |
| `header.js` stale-timer fix reverted | **CAUGHT** — the new test fails on both engines with the intended message |
| Two extra `tone="live"` in the Dashboard | **CAUGHT** — yellow-scarcity budget fails |
| `href={safeUrl(link.url)!}` → `href={link.url}` | **CAUGHT** — the XSS contract fails |
| A `playwright test --list` artefact fed to the gate | **REJECTED** — "1271 collected and none of them ran" |

The yellow-scarcity check also confirmed, incidentally, that the Dashboard's
code-level `tone="live"` count is **0** — the P2 report's claim that the
executive strip gave up its yellow figure is true.

---

## 8. Gate results at the frozen commit

Auxiliary gates, all run at `27044dd` or later and all passing:

| Gate | Result |
| --- | --- |
| `npm run typecheck` | clean |
| `npm run build` (from clean) | succeeds |
| `npm run scan:secrets` | clean, 729 files, 12 rules |
| `npm run fingerprint:check` | 72 pages, 25 assets, 0 unstamped |
| `npm run audit:seo:check` | 0 failing, 43 warnings |
| `npm run audit:conversion:check` | no CTA integrity failures |
| `npm run draco:check` | matches three 0.171.0 |
| `node scripts/portal-shots.mjs` | all rendered contracts hold |
| **Repository-wide suite ×5** | **NOT GREEN** — §6 |

**Tree state.** Three tracked files are modified and are not this workstream's:
`.claude/settings.local.json`, `assets/blender/stratos-altimeter.blend`,
`blender/mountains/__pycache__/stratos_terrain.cpython-313.pyc`. Verified that
no test and no build step reads any of them — `assemble.mjs` excludes `.blend`
by name. `gate-report.mjs` discloses them on every run.

---

## 9. Forbidden shortcuts — none used

* **No timeout raised.** The pre-existing `test.slow()` on `lead-forms` and
  `attribution` is untouched, and is now slack rather than load-bearing.
* **Retries removed, not added** — `retries: 0` now on CI too.
* **No `force: true`, no arbitrary `waitForTimeout` added**; 67 wall-clock waits
  were replaced or made conditional, none introduced.
* **No test skipped, quarantined, deleted or weakened.** The only tests to leave
  the suite are 50 provable duplicates, and they took no assertion with them.
* **Workers not reduced to reach green.** The count is unchanged at 5 and is now
  stated rather than inherited; the one-worker cap exists only behind
  `STRATOS_SOFTWARE_RASTER`, for hosts with no renderer to fix.
* **GPU flag is measured, not assumed** — §3, plus a canary that fails if the
  suite ever runs software-rastered without declaring it.
* **No failure output suppressed.** JSON on every run; `tail`-based reading is
  banned by `gate-policy.md` and the arithmetic is checked by a program.

---

## 10. Acceptance conditions, honestly scored

| # | Condition | Met? |
| --- | --- | --- |
| 1 | All current shifting failures have a measured classification | **No** — the 12 baseline failures do; the 5 new ones are class **F** |
| 2 | Real product defects found are fixed | Yes — 1 found, fixed, covered, mutation-verified |
| 3 | Real test defects found are fixed | Yes — 4 found and fixed |
| 4 | Wall-clock-dependent tests replaced where appropriate | Yes |
| 5 | Heavy workload contention architecturally controlled | Yes — by fixing the renderer, which the measurement showed was the cause, plus a declared fallback |
| 6 | Reporting cannot hide failures | Yes |
| 7 | Totals reconcile automatically | Yes — and a listing artefact is rejected |
| 8 | Repeated frozen-source runs produce the same outcome | **No** — 1, 0, 0, 2, 3 |
| 9 | No timeout/retry/skip cheating | Yes |
| 10 | Portal P1/P2 coverage intact | Yes — Portal specs and 57/57 render contracts hold in every run |

**Two of ten unmet, and they are the two that decide the verdict.**

---

## 11. What the next pass should do

1. **Run the gate on an idle machine.** It has never been measured on one, and
   the two worst runs coincided with this session's own load. This is the
   cheapest experiment and it may reclassify some of §6.
2. **Instrument the WebKit `goto` stall.** Capture `framenavigated`, request and
   response events around a hanging navigation to establish whether the request
   is issued, answered, or lost. Until that is known it stays class **F**.
3. **Consider moving `public-site:264` to the `node` project.** Ten tests
   asserting a title and a description on a static file do not need a browser
   (§40); that removes 40 browser navigations per run and the exposure with
   them. Deliberately *not* done here — it changes coverage shape and should not
   be decided while the stall is still unexplained.
4. **Then re-run five times and re-issue this verdict.**

---

## 12. Deliverables

`_build/reports/regression-harness/`

| File | What it is |
| --- | --- |
| `baseline-environment.md` | The frozen host, toolchain, config and rasterisation state |
| `baseline-failures.md` | Every baseline failure, classified A–F |
| `repeated-baseline.csv` | Five baseline runs, per-run and per-test |
| `failure-matrix.md` | Baseline stability matrix (generated) |
| `final-failure-matrix.md` | Final stability matrix (generated) |
| `resource-map.md` | What the suite costs, and where |
| `root-cause-report.md` | Measured causes, quantified, including one corrected conclusion |
| `before-after.md` | Baseline vs each gate iteration |
| `gate-policy.md` | The three gates, and the language not allowed in a phase report |
| `final-gate.json` | The authoritative machine-readable result |

New tooling: `scripts/gate-report.mjs`, `scripts/gate-matrix.mjs`,
`scripts/test-server.mjs`, `tests/harness.spec.ts`.

Eight commits, `39b41cd..27044dd`. Nothing pushed.

---

## 13. Portal P2 status is unchanged by this workstream

```
P2 CHANGE-SURFACE GATE:          PASS
REPOSITORY-WIDE REGRESSION GATE: NOT GREEN
MERGE / DEPLOY:                  NOT APPROVED
PORTAL P2 REVENUE & OPERATIONS READY FOR REVIEW
```

The repository-wide gate is NOT GREEN for a materially better reason than it was
before — 5 wandering failures in one engine rather than 12 across the suite with
two real defects buried in them — but it is still NOT GREEN, and P2 is still not
mergeable.

---

```
REGRESSION HARNESS STABILIZATION NOT ACCEPTED

REPOSITORY-WIDE MERGE GATE: NOT GREEN
```

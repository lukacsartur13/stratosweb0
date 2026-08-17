# Repeated repository-wide gate — idle host, frozen commit

Six complete runs of the unmodified suite on a host that started at load 1.29.
§40 asks for a minimum of five; six were run.

## The commit these runs were taken at

The gate artefacts record HEAD as **`2e8eb9c`**, not `c37587c`, because the
instrumentation was committed before the runs started. That is stated here
rather than glossed, and the claim it supports is checkable:

```
$ git diff --name-only c37587c HEAD
scripts/webkit-nav/correlate.mjs
scripts/webkit-nav/fleet.mjs
scripts/webkit-nav/nav-server.mjs
scripts/webkit-nav/stress.mjs
```

`2e8eb9c` is `c37587c` plus four new diagnostic files and nothing else. **No
product source, test, or configuration file differs between them**, so the
suite these six runs exercised is byte-identical to the frozen baseline, and the
runs are comparable to the previous pass's gate at `27044dd` on the same terms.

## Protocol

* Product source frozen. No file under `assets/`, `_build/` templates,
  `portal/src/`, `scripts/assemble.mjs` or the generator was modified before or
  during these runs — verified by the diff above, not asserted.
* Suite completely unmodified — same projects, same `workers: 5`,
  `fullyParallel: true`, `retries: 0`, same timeouts, no `grep`, no skips.
* The only additions: `scripts/webkit-nav/nav-server.mjs` adopted on the
  suite's own port 4322 through `reuseExistingServer`, and
  `--trace retain-on-failure` so a failure keeps its evidence (§30).
* Each run's Playwright JSON preserved separately via
  `PLAYWRIGHT_JSON_OUTPUT_NAME` — the trap the previous pass documented, where a
  hard-coded `outputFile` makes five repeated runs overwrite one artefact.
* Totals read from those JSON artefacts, never from terminal output (§45).

## Results

| Run | expected | unexpected | flaky | skipped | **sum** | collected | reconciles | duration | load₁ at start |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 1149 | 0 | 0 | 122 | **1271** | 1271 | ✅ | 5.8 min | 1.29 |
| 2 | 1149 | 0 | 0 | 122 | **1271** | 1271 | ✅ | 14.9 min | 37.65 |
| 3 | 1149 | 0 | 0 | 122 | **1271** | 1271 | ✅ | 6.9 min | 67.15 |
| 4 | 1148 | **1** | 0 | 122 | **1271** | 1271 | ✅ | 8.3 min | 25.97 |
| 5 | 1148 | **1** | 0 | 122 | **1271** | 1271 | ✅ | 7.0 min | 35.51 |
| 6 | 1149 | 0 | 0 | 122 | **1271** | 1271 | ✅ | 8.3 min | 32.12 |

`expected + unexpected + flaky + skipped = collected` in every run. Collected
(1 271) and skipped (122) are identical across all six **and identical to the
previous pass's gate**, so these runs are directly comparable to it and the
suite's composition has not drifted.

### Independently reconciled, not read off the terminal

Each run's JSON was passed through `scripts/gate-report.mjs`, which refuses to
emit a verdict whose arithmetic does not close and exits `2` when it cannot.

| Run | `arithmeticReconciles` | `accounted` | `unclassified` | exit | failing test |
| --- | --- | --- | --- | --- | --- |
| 1 | true | 1271 | 0 | 0 | — |
| 2 | true | 1271 | 0 | 0 | — |
| 3 | true | 1271 | 0 | 0 | — |
| 4 | true | 1271 | 0 | 1 | `desktop-1440 lead-forms.spec.ts:177` |
| 5 | true | 1271 | 0 | 1 | `mobile-390 homepage-history.spec.ts:223` |
| 6 | true | 1271 | 0 | 0 | — |

**No run exited 2.** Every collected test is accounted for in every run, and no
test finished in a state the reporter could not classify. Artefacts:
`_build/reports/webkit-navigation/suite/gate-{1..6}.json`.

| | |
| --- | --- |
| Runs green | **4 / 6** |
| Stable failures (failed in every run) | **0** |
| Wandering failures (distinct identities) | **2** |

## The two failures

### Run 4 — `[desktop-1440] lead-forms.spec.ts:177` "surfaces the server's own validation message on 422"

`expect(.form__status).toHaveAttribute('data-state', 'invalid')` timed out at
15 s having polled 31 times, every time against
`<p role="status" aria-live="polite" class="form__status"></p>` with **no
`data-state` at all**.

Traced, not inferred:

| Evidence | Finding |
| --- | --- |
| Action timeline | `click` at 3.68 s completed without error; `expect` started at 3.68 s |
| Network | **no POST to `/api/lead`** anywhere in the trace |
| Navigation | none — the page did not submit natively either |
| Console / page errors | none |
| Failure snapshot | **`leadBound` present** — `lead.js` had already bound the form |
| Button label at failure | still "Küldés" — the form never left its initial state |

`lead.js` sets `data-state="submitting"` synchronously on the first line of its
submit handler. The absence of *any* `data-state` therefore means the handler
never ran, and `leadBound` proves it existed. **The click did not activate the
button.** Playwright reported success because it dispatches at coordinates after
its stability check; a `click` event requires `mousedown` and `mouseup` on the
same element, and this page animates (`motion.js` reveals, `transitions.css`).

This is the actionability class the previous pass identified on Chromium under
SwiftShader — where a single click cost up to 20 781 ms — reappearing on the GPU
path because the load now comes from five concurrent browsers rather than from
software rasterisation. It is **not** a navigation stall.

### Run 5 — `[mobile-390] homepage-history.spec.ts:223` "back and forward restore the position, the chapter and the chrome"

```
returned to the bottom of the document instead of 4983
expect(after.travel - after.y).toBeGreaterThan(200)   Received: 0
```

`after.travel - after.y === 0` — the restored position is at the **exact bottom**
of the document, where it should have been 4 983.

From the trace, the whole test took 3.7 s, so this is a *wrong restore*, not a
stall. It is also not the test failing to wait: the test explicitly polls
`() => !document.documentElement.style.getPropertyValue('--home-reserve')`
before reading, so `home-history.js` had already released its reservation.

`assets/js/home-history.js` exists precisely to prevent this. It records the
homepage's settled height in `sessionStorage` and reserves it as a `min-height`
on `<body>` in `<head>`, so the browser's own restore lands in a document that is
already tall enough. Its own header documents the two engine signatures: on
Chromium scroll anchoring drags a clamped position to the very bottom; on WebKit
the clamped position simply stays put. **This failure is on WebKit and lands at
the bottom**, which is the Chromium signature, so the simple "the reservation
was missing" reading does not fit.

The mechanism consistent with the numbers is that the position was clamped *down*
to the document's real bottom when the reservation was released — which happens
if the reserved height exceeded the height the document actually settled at.
**That is a hypothesis with an arithmetic motivation, not a measured cause**, and
it is recorded as such. The measurement that would decide it is stated in
`root-cause.md`.

This is the same test that failed on `desktop-webkit` in the previous pass's
run 4, so the identity recurs across passes and across two WebKit projects.

## Chromium — the previous pass's improvement, rechecked (§42)

`tests/harness.spec.ts` asserts the renderer of every Chromium project and fails
if the suite is running software-rastered without `STRATOS_SOFTWARE_RASTER`
having declared it. It **passed in all six runs**, in all four Chromium
projects, so `--use-angle=metal` is still being honoured and the SwiftShader
pathology has not returned.

| | Previous pass, before its fix | These six runs |
| --- | --- | --- |
| Chromium renderer | SwiftShader (undeclared) | ANGLE Metal, asserted every run |
| Homepage frame rate | 3–7 fps | not re-measured; renderer assertion holds |
| Chromium failures | the dominant population | **1 in 6 runs**, and it is an actionability race, not a renderer stall |

## §43 — previously found defects, revalidated

Counted across all six runs, from the JSON artefacts:

| Contract | Executions | Failed |
| --- | --- | --- |
| Menu reopen inside its close transition / stale hide timer | 36 | **0** |
| Modal inert behaviour | 96 | **0** |
| WebKit focus restoration | 114 | **0** |
| Persistent Altimeter / 3D instrument | 126 | **0** |
| Empty-chapter regressions | 36 | **0** |
| **Portal P1 control room** | **2 502** | **0** |
| **Portal P2 revenue** | **864** | **0** |
| History restoration | 24 | **1** (run 5, above) |

> A note on the arithmetic, because the first tabulation of it was wrong: an
> earlier pass of this table reported a failure under *both* "history
> restoration" and "empty chapter". It is one failure. The run-5 test is titled
> "back and forward restore the position, **the chapter** and the chrome", and a
> keyword match on "chapter" caught it twice. There is no empty-chapter
> regression.

The navigation hide-timer fix (`2104421`) and its regression test (`d026424`)
both hold. Portal P1 and P2 contracts are fully preserved: **3 366 portal test
executions across six runs, zero failures.** Nothing in this workstream extended
P2 or began P3.

## Verdict on this gate

`REPOSITORY-WIDE REGRESSION GATE: NOT GREEN`

4 of 6 runs green is not 5 of 5. Two wandering failure identities remain, and
§41 requires zero unexplained failures and no wandering identities. One of the
two is characterised to root cause (the click never activated the button); the
other has a hypothesis and not a proof.

**What did change against the previous gate**: its four `mobile-390` 30-second
`page.goto` timeouts did not occur once in six runs. That is reported in
`root-cause.md` together with what it does and does not license.

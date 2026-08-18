# `lead-forms.spec.ts:177` — the 422 contract, event by event

**Verdict: NOT REPRODUCED. The chain is intact at every link, and the measured
margin is 2.3× at twice the load an authoritative gate produces.**

The test is `contact form › surfaces the server's own validation message on 422`.

## 1. What was run

| Arm | Shape | Navigations of the contract | Failures |
| --- | --- | --- | --- |
| File-level, ×3 | `tests/lead-forms.spec.ts`, all 4 carrying projects, `--repeat-each=3` | 12 of `:177` (348 tests total) | **0** |
| Diagnostic, isolated | `lead-chain.spec.ts`, 6 projects, 1 worker | 6 | **0** |
| Diagnostic, under load | 6 projects, 5 workers, `--repeat-each=8`, concurrent with the full suite | 48 | **0** |

**66 executions of the contract, zero reproductions.** The file-level arm alone
was 348 tests in 419 s with `expected: 348, unexpected: 0, flaky: 0`.

## 2. The chain, measured

`scripts/hermetic/diagnostics/lead-chain.spec.ts` records both phases of every
pointer event, both phases of `submit` with `defaultPrevented`, the `fetch`
boundary in four parts, and every `data-state` transition read from the DOM
rather than from the controller. A quiet run on `mobile-390`:

```
    0  init-script
   49  DOMContentLoaded   form found, data-lead-bound="true"
   63  load
   74  pageshow           persisted=false
  209  pointerdown/…/click on the consent checkbox   (fillContact)
  254  pointerdown  SPAN          isTrusted=true
  255  click → submit-capture → state:form=submitting → submit-bubble
                                          defaultPrevented=true
 3046  fetch:request   POST /api/lead   elapsedMs≈3000
 3060  fetch:response  422
 3061  state:form=invalid
 3061  state:note=invalid  "That email address does not look right."
```

Every link fires. The 2 791 ms between `submit` and `fetch` is not a stall — it
is `MIN_FILL_MS`, the controller deliberately waiting out the server's minimum
fill time (`assets/js/lead.js`, `wait = Math.max(0, 3000 - (Date.now() - readyAt))`)
rather than being silently dropped by it.

## 3. Where the time goes under load

48 instrumented runs concurrent with the full suite, at **load average 96** —
roughly twice what an authoritative gate reaches. Segment timings in ms:

| Segment | p50 | p95 | max |
| --- | --- | --- | --- |
| `locator.click()` itself | 1 390 | 4 701 | 5 184 |
| **post-click → `data-state=invalid`** | **617** | **1 532** | **6 502** |
| submit → fetch requested | 6 | 17 | 195 |
| fetch requested → answered | 200 | 1 216 | 1 673 |
| answered → DOM state changed | 2 | 9 | 12 |

The middle row is the one that matters, because the test's `{ timeout: 15_000 }`
starts **after** `click()` returns:

```js
await page.getByRole('button', { name: 'Küldés' }).click();
await expect(status(page)).toHaveAttribute('data-state', 'invalid', { timeout: 15_000 });
```

**Worst observed: 6 502 ms against a 15 000 ms budget — 2.3× headroom, at double
the gate's load.** The controller, the network boundary and the render are each
under 1.7 s at their worst; the expensive step is Playwright's own actionability
wait inside `click()`, and that is outside the budget.

## 4. The fork that was ruled out

`data-state="invalid"` has **two** producers in `assets/js/lead.js`, and the test
asserts the attribute before the message:

1. the synchronous client-side `check()`, which sets the generic
   `Kérjük, ellenőrizd a kiemelt mezőket.`;
2. the server's 422, which sets `That email address does not look right.`

A run where one of the seven `fill`/`check` calls did not take would satisfy
`toHaveAttribute` from producer 1 and then fail `toHaveText` — a completely
different defect wearing the same line number, and one that would report as a
5 s expect failure rather than a 30 s timeout.

**All 48 loaded runs reached the state via the server 422. Zero via the client
check.** The hit-test at the instant before every click was also clean in all
of them: `hitsButton: true`, `disabled: false`, `formValid: true`,
`invalidFields: []`, `pointer-events: auto`, no overlay intercepting the centre
point. No `force: true` was used anywhere — a forced click would only have
proved the diagnostic can be made to pass.

## 5. What this does and does not establish

**Establishes.** Every link in the §14 chain fires, in order, on both engines
and all six project shapes. The network boundary is not implicated. The hit-test
is not implicated. The wrong-producer fork is not implicated. There is no
missing event to name.

**Does not establish.** That the failure cannot happen. 66 executions is not
enough to exclude a rare event, and the previous pass reported this test as
wandering, which means it did fail at least once under conditions not captured
here. Per §21, no navigation-shaped or timeout-shaped claim is made about it in
either direction.

**What was NOT done, deliberately.** No timeout was raised, no retry added, no
`waitForTimeout` padding, no `force: true`, no skip. §24. The margin is 2.3× and
the correct response to that is to leave it alone.

## 6. Status

```
lead-forms:177 — NOT REPRODUCED IN 66 EXECUTIONS
classification: F — UNRESOLVED (cannot be closed on absence of evidence)
```

It is carried into the six-run authoritative gate, where every failure produces
a machine-readable record with its last confirmed event rather than a bare
timeout.

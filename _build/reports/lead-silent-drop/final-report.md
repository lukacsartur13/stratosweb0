# `lead.js` silent drop — final report

*§56. The defect, the correction, and what was measured. The evidence as it
stood before the edit is in
[`root-cause-before-fix.md`](root-cause-before-fix.md); the frozen subject is in
[`new-frozen-subject.md`](new-frozen-subject.md).*

---

## Original defect

A genuine enquiry could be discarded and the visitor shown the success message.

Run `g4-02` of the hermetic sequence failed three tests on `mobile-390`, on
three separate workers, within a 202 ms window:

```
lead-forms.spec.ts:346  newsletter    — subscribes with only an address
lead-forms.spec.ts:369  newsletter    — the blog signup posts to the same endpoint
lead-forms.spec.ts:384  impact        — maps the application into the lead schema

  expect(envelope.meta.elapsedMs).toBeGreaterThanOrEqual(3000)
  Expected: >= 3000
  Received:    2996
```

The same value in all three, four milliseconds short, with fifteen lead
submissions passing in the fifteen seconds before them.

`3000` is not a test's preference. It is `MIN_FILL_MS` in
`netlify/functions/lead-contract.mjs:75` — the threshold below which
`submit-lead.mjs` discards a submission as automated.

## Exact root cause

The controller reported a **measurement** where it owed a **guarantee**, and it
measured on a different clock from the one it waited on.

```js
var readyAt = Date.now();                                     // (1) WALL CLOCK
var wait = Math.max(0, MIN_FILL_MS - (Date.now() - readyAt));  // (2) WALL CLOCK
window.setTimeout(function () {                               // (3) MONOTONIC
  send({ …, elapsedMs: Date.now() - readyAt, … });             // (4) WALL CLOCK
}, wait);
```

**Fault A — the report is taken on a clock that can move.** (3) schedules on the
browser's monotonic timebase; (1), (2) and (4) read `Date.now()`, the adjustable
wall clock. A backward adjustment of δ between (2) and (4) makes the reported
value `(true elapsed) − δ`. Three independent contexts reporting the same 2 996
within 202 ms is what a system-wide clock step looks like; fifteen passing
neighbours is what rules out load.

**Fault B — the wait aims at the threshold with zero tolerance.** `wait` is
computed to finish at *exactly* `MIN_FILL_MS`, so any shortfall of any size
crosses it — and `setTimeout` truncates its delay to whole milliseconds, which
is a shortfall before any clock is involved. Reproducing this needed no trick at
all: measured headroom on the unfixed controller was **0–2 ms** across four
projects, and **exactly 0 ms** on `mobile-430`.

### Where processing stops, and why it is silent

`netlify/functions/submit-lead.mjs:331`:

```js
if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < MIN_FILL_MS) {
  audit('drop.tooFast', null, { submissionId, format, elapsedMs: Math.round(elapsed) });
  return dropSilently(submissionId);                                  // :333
}
```

and `:217`:

```js
const dropSilently = (submissionId) =>
  json(200, { ok: true, submissionId, leadId: crypto.randomUUID() });
```

Line 333 is the exact point processing stops. Validation, the Supabase insert
and the notification never run. The `leadId` is invented on the spot and
corresponds to no row.

The reply is HTTP 200 with `ok: true`, so the client's `if (res.ok && body.ok)`
holds: `data-state="success"`, *"Köszönjük — hamarosan válaszolunk"*, the form
resets, the submission id rotates. Nothing surfaces. The only trace is a
`drop.tooFast` line in a function log.

**The client-side control flow is intact end to end.** Nothing hit an early
return, nothing was aborted, nothing was deduplicated, no promise was
un-awaited, no state went stale. The submission reached `fetch`, the response
was parsed, and it was classified `success` — because the server said so.

## Why it is a product defect

1. The assertion is the product's own contract: `3000` is the server's
   discard threshold, not a test's tolerance.
2. The source comment states the intent the code misses — *"Wait out the
   server's minimum fill time rather than being silently dropped by it."*
3. The consequence exists with no test present: a real enquiry, a success
   message, and no lead.
4. It is not viewport- or engine-specific — reproduced on WebKit and Chromium at
   four viewports, across `contact`, `newsletter`, `impact` and every form
   routed through `bindForm`.
5. Measured headroom was **zero** on `mobile-430` with no clock adjustment at
   all. Correctness that depends on winning a race by nought milliseconds is
   defective whether or not anyone is watching.
6. It ships: `dist/assets/js/lead.js` was byte-identical to the source.

## Minimal correction

```diff
+  var MIN_FILL_MARGIN_MS = 250;
+
+  function monotonicNow() {
+    return (window.performance && typeof window.performance.now === 'function')
+      ? window.performance.now()
+      : Date.now();
+  }

-    var readyAt = Date.now();
+    var readyAt = monotonicNow();

-      var wait = Math.max(0, MIN_FILL_MS - (Date.now() - readyAt));
+      var wait = Math.max(0, MIN_FILL_MS + MIN_FILL_MARGIN_MS - (monotonicNow() - readyAt));

-          elapsedMs: Date.now() - readyAt,
+          elapsedMs: Math.round(monotonicNow() - readyAt),
```

> When the wall clock moved backward during the fill wait — or when the timer's
> whole-millisecond delay landed the wait a fraction short — the controller
> could report a fill time below the server's discard threshold and be dropped
> behind a synthetic success. Measuring the window on the same monotonic clock
> the wait is scheduled on, and finishing past the threshold rather than on it,
> makes the reported value one the controller can prove.

### §15 — this is not "the timeout was too short"

No request timeout is touched, and `MIN_FILL_MS` is unchanged on both sides. The
250 ms is not tolerance for a slow server: it is the difference between a wait
*computed to end at* a rejection threshold and one *computed to clear* it. The
mechanism was diagnosed and fixed — a clock mismatch and a zero-margin
boundary — rather than padded around.

### §7 — what was deliberately not done

* `dropSilently` still answers a discard with `ok: true` and an invented
  `leadId`. That is what makes a threshold miss *silent*, and it is also what
  stops a bot learning it was caught. A design question, not this defect.
* `elapsedMs` is still submitter-supplied. It stops no determined bot and its
  only demonstrated effect has been to discard real submissions. Recorded, not
  acted on.
* The questionnaire wizard (`assets/js/quote.{hu,en,de}.js`) still measures with
  `Date.now()` and is **not** vulnerable: its window opens at page load and
  closes after a multi-step form, so it has minutes of margin, no min-fill wait,
  and therefore no wall-clock/monotonic pairing to disagree.

## Product diff scope

One file, one function's worth of change.

```
 assets/js/lead.js | 46 ++++++++++++++++++++++++++++++++++++++--------
```

Unchanged: the envelope shape (`submissionId`, `formType`, `locale`, `route`,
`fields`, `meta`), the per-form schemas, `REQUIRED`, `FIELD_MAX`, the honeypot
and its `meta.botField` routing, the attribution allow-list, the submission-id
idempotency and its rotation on success, the retry semantics, the four result
states, the error copy, the BFCache release, the backend contract, the
compatibility adapter, and every server file.

## Mutation result

Each mutation was applied to the **built bundle only**, so the deliberate defect
was never in a commit.

| # | Mutation | Detected by | Result |
| --- | --- | --- | --- |
| A | `monotonicNow()` → `Date.now()` | the clock-step test | **DETECTED** — `elapsedMs 2851`, expected ≥ 3000 |
| B | `MIN_FILL_MARGIN_MS` 250 → 0 | the headroom test | **DETECTED** — `elapsedMs 3001`, expected ≥ 3200 |
| AB | both — the controller exactly as `g4-02` found it | both tests | **DETECTED** — 2600 and 3001 |
| C (§18) | a second `send()` on the corrected path | 8 tests | **DETECTED** |
| A | on the dist canary | the §46 merge-gate assertion | **DETECTED** — "reading the fill window off the wall clock again" |
| B | on the dist canary | the §46 merge-gate assertion | **DETECTED** — "aims the fill wait at the drop threshold again" |

A and B are caught by different tests, so neither masks the other.

Mutation C is the §18 duplicate-submission check, and the eight detections are
worth naming — they are what says solving the drop did not weaken idempotency:

```
contact form › a valid submission reaches /api/lead with every field mapped
contact form › a double click produces exactly one request
contact form › Enter in a text field cannot slip a second request past the disabled button
contact form › a retry after a failure re-sends the same submission id
contact form › a fresh enquiry after a success gets a new submission id
the minimum fill wait › a backward wall-clock step … cannot under-report the fill time
the minimum fill wait › the wait clears the drop threshold with headroom …
newsletter › subscribes with only an address, as its own source
```

All mutations reverted; source and `dist` verified byte-identical afterwards
(`41d424a5…`).

## Stress result

**§19 — targeted.** The exact failing contract, on `mobile-390`, the project
`g4-02` failed on: the three tests it failed plus the two new regressions,
`--repeat-each=100`.

```
500 passed (8.4m)     0 failed, 0 drops, 0 duplicates, 0 unexplained timeouts
```

**§20 — parallel.** The whole lead surface under normal repository parallelism,
five workers, no serialisation: `lead-forms`, `lead-endpoint`, `lead-notify`,
`attribution`, `--repeat-each=4`, all projects.

```
968 passed (8.6m)     0 failed
```

## Idempotency result

One logical submission → at most one stored lead, on every path tested:

| Path | Assertion | Result |
| --- | --- | --- |
| Normal submission | exactly one request, `attempt: 1` | pass |
| Delayed response (1.5–2.5 s held open) | in-flight state, still one request | pass |
| Repeated click | `'a second click must not create a second lead'` | pass |
| Enter key while the button is disabled | one request | pass |
| Retry after failure | **same** `submissionId`, `attempt: 1` then `2` | pass |
| Fresh enquiry after success | **different** `submissionId` | pass |
| Mutation C (forced duplicate) | detected by 8 tests | correctly red |

## Forms / locale regression

**§21 — all form types.** Every category routed through the shared controller:

| Form | Route | Result |
| --- | --- | --- |
| contact | `/ugyfelszolgalat.html` | pass |
| newsletter | `/rolunk.html`, `/blog.html` | pass |
| Impact Program | `/impact-program.html` | pass |
| questionnaire (wizard) | `/arajanlat.html` | pass |

**§22 — locales.** The fix depends on no Hungarian-only DOM or state assumption;
`hu`, `en` and `de` routes all covered by the existing architecture:
`/rolunk.html`, `/en/about.html`, `/de/ueber-uns.html`, `/blog.html`,
`/en/blog.html`, `/de/blog.html`. Translation scope unchanged.

**§23 — schema.** `tests/lead-endpoint.spec.ts` re-run in full: invalid required
data rejected, valid envelope accepted, honeypot handled, undeclared meta keys
dropped (`expect(row.meta).toEqual({ elapsedMs: 300_000 })`), `submissionId`
semantics unchanged.

**§24 / §25 — PII and analytics.** No logging was added. No name, address,
phone, questionnaire answer, lead id or submission id is written anywhere new;
the regression tests use synthetic fixtures. Analytics architecture untouched
and `tests/analytics.spec.ts` passes with the consent contracts.

Combined for the whole lead surface: **238 passed** on the first full run, then
968 under the parallel sweep.

## New product and dist hashes

Old hashes are void as an active subject (§32).

| | |
| --- | --- |
| Commit | `48811e991089dd8cb73f23ec1c6ae880446cff6f` |
| `assets/js/lead.js` | `41d424a50e5ba13274b1b9f1861b949931b59435190a5286bd9ffe8556195f63` |
| `dist/assets/js/lead.js` | `41d424a50e5ba13274b1b9f1861b949931b59435190a5286bd9ffe8556195f63` |
| Served URL | `assets/js/lead.js?v=41d424a5` (was `?v=38e4c1d7`) |
| product | `088c02849aad0e870111fab16585dac6a1caf4fcd1b99893e1e5511682547c84` |
| test | `2d561c3320f5c51b2432ae96d81782fc337ee30d864cc41daa5f2093e8165a8e` |
| config | `94c5bf52ccac846c9bb8149f8cda1d55cb78d51c32db5fcc798411cd611b326b` |
| **dist** | `2538acb4918470f2d172c66df16737819bb41668936f7301fec65cfc396783c3` |

§34 is satisfied by construction: `dist/` was deleted and rebuilt from clean
source, the served fingerprint changed, and the §46 canary asserts the corrected
shape against the built file — so "source changed, served bundle did not" cannot
pass.

## G5 — how the fix behaved in the merge gate

Full matrix: [`../hermetic-gate/g5-six-run-matrix.md`](../hermetic-gate/g5-six-run-matrix.md).

Six repository-wide runs over the frozen subject: **6 / 6 VALID, 4 / 6 GREEN.**

The lead contracts, counted as executions across the four projects that carry
`lead-forms.spec.ts` in each of the six runs:

| Contract | Executions | Passed | Failed |
| --- | ---: | ---: | ---: |
| backward wall-clock step cannot under-report the fill time | 24 | **24** | 0 |
| the wait clears the drop threshold with headroom | 24 | **24** | 0 |
| the shipped bundle measures on a clock that cannot move | 24 | **24** | 0 |
| idempotency set (5 contracts) | 120 | **120** | 0 |
| **total** | **192** | **192** | **0** |

**192 / 192.** Including in the two runs that were not green overall.

### The one lead test that did fail, and why it is not this defect

`g5-06`, `[desktop-1920] lead-forms.spec.ts:472 maps the application into the
lead schema`:

```
Error: page.check: Clicking the checkbox did not change its state
  - 3 × "element is not stable" → "element is outside of the viewport"
  at tests/lead-forms.spec.ts:485
```

Line 485 is `page.check(...)`. Line 486 is the submit. **The test aborted one
line before the form was submitted**, so no lead code ran: no validation, no
envelope, no `elapsedMs`, no request, no response, no terminal UI state. It is a
Playwright actionability failure at one viewport — the same layout-stability
family as the four WebGL timeouts in `g5-02`, in a form that happens to live in
the lead spec.

Answered against §49 line by line in the matrix. It is **not** the silent drop,
and it is not a lead defect of any kind.

### Why the sequence is not accepted

Five failures across two runs, **none reproducing in a second run**. The four in
`g5-02` all landed in the single run whose mean host load was **88.15 against a
baseline of 6.2–6.6**, peaking at 186 — a thirteenfold excursion caused by
`fileproviderd` and an interactive application, neither of them the subject.
Both had drained by `g5-04`, which ran at 6.20 and was green.

That is a wandering, load-correlated failure. §52 forbids calling it close
enough, and it is not being called that.

**What it does not touch is this fix.** Every hermetic property held in all six
runs — identical commit, product, test, config and `dist` hashes; identical
collected (1450) and skipped (155); an identical skip-set hash that is also
byte-identical to `g3`'s; zero subject mutations, zero canary writes, zero
orphan processes, zero held ports; arithmetic reconciling in both suites in
every run.

## Verdict

# LEAD.JS SILENT-DROP PRODUCT DEFECT RESOLVED

Reproduced deterministically on four projects and both engines before the fix,
corrected in one file, mutation-checked four ways, sustained through 500
targeted and 968 parallel executions, and green in 192 of 192 gate executions
across six runs on a frozen subject.

# HERMETIC REGRESSION GATE NOT ACCEPTED
# REPOSITORY-WIDE MERGE GATE: NOT GREEN

For a reason unrelated to the lead controller: a wandering, load-correlated
timeout in the WebGL and layout-stability suites. §63 is explicit that these two
results must not be conflated, and they are not.

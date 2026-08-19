# `lead.js` silent drop — the defect, recorded before the fix

**Class: PRODUCT DEFECT.** Recorded per §3 of the current brief, before any edit
to `assets/js/lead.js`, so the evidence survives the change that removes it.

Two sources are combined here and kept distinct throughout:

* **Gate evidence** — what run `g4-02` observed. Transcribed from
  [`_build/reports/lead-min-fill-defect.md`](../lead-min-fill-defect.md), which
  is the surviving record; the `runs/g4-*` artefact tree itself was not retained,
  and no claim below depends on re-reading it.
* **Reproduction evidence** — gathered in this workstream, on the current
  checkout, against the unmodified controller. This is first-hand and is what
  the root cause rests on.

---

## 1. Exact failing contract

### As the gate saw it (g4-02)

| | |
| --- | --- |
| Spec | `tests/lead-forms.spec.ts` |
| Assertion | `expect(envelope.meta.elapsedMs).toBeGreaterThanOrEqual(3000)` — `expectWellFormed`, line 77 |
| Project / browser | `mobile-390` — WebKit, `devices['iPhone 13']` |
| Viewport | 390 × 844, `deviceScaleFactor` 3, `isMobile`, `hasTouch` |
| Expected | `>= 3000` |
| Received | `2996` — **identically, in all three failures** |

| Test | Line | Form type | Route |
| --- | ---: | --- | --- |
| `newsletter › subscribes with only an address, as its own source` | 346 | `newsletter` | `/rolunk.html` |
| `newsletter › the blog signup posts to the same endpoint` | 369 | `newsletter` | `/blog.html` |
| `Impact Program application › maps the application into the lead schema` | 384 | `impact` | `/impact-program.html` |

**Timestamps.** 13:22:03.808, 13:22:03.847, 13:22:04.010 — a 202 ms window.
**Workers.** 19, 18 and 16 — three separate browser contexts, three separate
processes. In the fifteen seconds before them, fifteen other lead submissions
passed. So: not slow tests, not a loaded worker, not one context.

### As reproduced here, deliberately

Two regression tests were added to `tests/lead-forms.spec.ts` **before** the
product edit, and run against the unmodified controller:

```
tests/lead-forms.spec.ts:365  a backward wall-clock step during the wait
                              cannot under-report the fill time
tests/lead-forms.spec.ts:412  the wait clears the drop threshold with headroom
                              rather than landing on it
```

| Project | Engine | Test 365 `elapsedMs` | Test 412 `elapsedMs` |
| --- | --- | ---: | ---: |
| `mobile-390` | WebKit | **2601** (needs ≥ 3000) | 3001 |
| `mobile-430` | WebKit | **2600** | **3000** |
| `desktop-1440` | Chromium | **2602** | 3002 |
| `desktop-1920` | Chromium | **2602** | 3002 |

6 failed, 0 passed. Both engines, all four projects that carry this file.

The second column is the finding that matters most. With no clock adjustment at
all, the controller clears the server's rejection threshold by **0 to 2
milliseconds**, and on `mobile-430` by **exactly zero**.

---

## 2. What "silent drop" means here — the actual path

§4 requires the mechanism to be named rather than picked from a list. Answering
the list explicitly, from the reproduction:

| Candidate mechanism | Verdict |
| --- | --- |
| Never reached `fetch` | **No.** The request is made. |
| Reached `fetch`, response ignored | **No.** The response is read and parsed. |
| Threw / rejected without surfacing | **No.** No rejection occurs. |
| Hit an early return | **No.** Every branch in `bindForm` runs to completion. |
| Stuck behind a pending state | **No.** The form reaches a terminal state. |
| Discarded by stale state | **No.** |
| Aborted | **No.** There is no `AbortController` on this path. |
| Incorrectly deduplicated | **No.** One submission, one request, one id. |
| Exited through an unhandled branch | **No.** |

**None of them.** The client-side control flow is intact from end to end. The
drop happens on the server, and the client is told it succeeded.

### The mechanism, named

The controller reports a **measurement** where it owes a **guarantee**, and it
measures on a different clock from the one it waited on.

```js
// assets/js/lead.js — bindForm(), as it stands before the fix
var readyAt = Date.now();                                    // (1) WALL CLOCK

var wait = Math.max(0, MIN_FILL_MS - (Date.now() - readyAt)); // (2) WALL CLOCK

window.setTimeout(function () {                               // (3) MONOTONIC
  send({ …, elapsedMs: Date.now() - readyAt, … });            // (4) WALL CLOCK
}, wait);
```

Line 3 schedules on the browser's **monotonic** timebase. Lines 1, 2 and 4
measure on `Date.now()`, the **adjustable wall clock**. The two are not the same
clock, and nothing reconciles them.

Two faults compound, and each is independently sufficient:

**Fault A — the report is taken on a clock that can move.**
If the wall clock steps backward by δ between (2) and (4), then
`Date.now() - readyAt` at fire time is `(true elapsed) − δ`. Three independent
browser contexts reporting *the same* 2996 within 202 ms is the signature of a
single system-wide event; fifteen passing neighbours rules out load. A 4 ms
backward adjustment is exactly what that looks like.

**Fault B — the wait aims at the threshold, with zero tolerance.**
`wait` is computed to finish at *exactly* `MIN_FILL_MS`. Any shortfall of any
size crosses it. `setTimeout` truncates its delay to whole milliseconds, which
is a sub-millisecond shortfall before any clock adjustment is involved. The
reproduction measured the resulting headroom at 0–2 ms, and at **0 ms** on
`mobile-430`.

### Where processing actually stops

`netlify/functions/submit-lead.mjs`:

```js
const elapsed = Number(legacy ? body?.elapsed_ms : body?.meta?.elapsedMs);
if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < MIN_FILL_MS) {   // :331
  audit('drop.tooFast', null, { submissionId, format, elapsedMs: Math.round(elapsed) });
  return dropSilently(submissionId);                                       // :333
}
```

and

```js
const dropSilently = (submissionId) =>                                     // :217
  json(200, { ok: true, submissionId, leadId: crypto.randomUUID() });
```

**Line 333 is the exact point where processing stops.** The request never
reaches validation, never reaches the Supabase `leads` insert, and never reaches
the notification. The `leadId` in the reply is invented on the spot by
`crypto.randomUUID()` and corresponds to no row.

### Why the visitor sees success

`assets/js/lead.js`, in `send()`:

```js
if (res.ok && body.ok) {
  return { state: 'success', leadId: body.leadId, submissionId: envelope.submissionId };
}
```

`dropSilently` returns HTTP 200 with `ok: true`. The condition holds. The
controller sets `data-state="success"`, writes *"Köszönjük — hamarosan
válaszolunk a megadott címre."*, resets the form and rotates the submission id.

### The full pipeline, with the failure located

```
user submit          ✓ fires
form listener        ✓ runs, preventDefault, duplicate guard passes
validation           ✓ check() returns null
                     ✗ wait computed on the WALL clock, aimed at the threshold
                     ✗ setTimeout fires on the MONOTONIC clock
envelope             ✓ built — but meta.elapsedMs is measured on the wall clock
submission ID        ✓ one v4 uuid, unchanged
controller state     ✓ submitting
request initiation   ✓ exactly one fetch
/api/lead            ✓ reached
                     ✗ ── elapsedMs < 3000 → audit('drop.tooFast') → dropSilently
                     ✗ ── never stored. HTTP 200 { ok: true, leadId: <invented> }
request outcome      ✓ 200
response parsing     ✓ ok
classification       ✗ classified 'success', because the reply says so
UI terminal state    ✗ SUCCESS shown for a lead that does not exist
```

---

## 3. Why this is a PRODUCT defect and not a TEST defect

1. **The assertion states the product's own contract, not the test's
   convenience.** `>= 3000` is `MIN_FILL_MS` from
   `netlify/functions/lead-contract.mjs:75` — the exact value at which the
   server discards the submission. A value below it is not "a test being fussy";
   it is the number that causes the loss.

2. **The controller's stated intent is the thing that fails.** The comment in
   the source reads *"Wait out the server's minimum fill time rather than being
   silently dropped by it."* The code misses that intent by 4 ms.

3. **The consequence exists with no test present.** A real visitor fills in the
   contact form, sees *"we will reply shortly"*, and the enquiry is never
   stored. Nothing surfaces. The only trace is a `drop.tooFast` line in a
   function log.

4. **It is not viewport-, engine- or test-specific.** Reproduced on WebKit and
   Chromium, at four viewports, and it affects `contact`, `newsletter`, `impact`
   and every other form routed through `bindForm`.

5. **The measured headroom is zero on a real project.** `mobile-430` cleared the
   threshold by exactly 0 ms with no adjustment applied. A product whose
   correctness depends on winning a race by nought milliseconds is defective
   whether or not a test is watching.

6. **It ships today.** `dist/assets/js/lead.js` is byte-identical to
   `assets/js/lead.js`, so this is the behaviour in the current build, and it
   is not introduced by any change in this workstream.

---

## 4. Recorded, not fixed here

Two facts are noted for the record and deliberately **not** acted on, because
§6 and §7 forbid turning this into a lead-system refactor:

* **`dropSilently` returns a synthetic success.** That a bot filter answers with
  `ok: true` and an invented `leadId` is what converts a threshold miss into
  *silent* loss rather than a visible failure. Changing it would tell an actual
  bot it was caught, which is the reason it is shaped that way; it is a design
  question, not this defect.
* **`elapsedMs` is submitter-supplied.** A value the client chooses cannot stop
  a determined bot, and its only demonstrated effect so far has been to discard
  genuine submissions.

The questionnaire wizard (`assets/js/quote.{hu,en,de}.js`) also measures with
`Date.now()`, and is **not** vulnerable to this mechanism: its `STARTED` is set
at page load and the visitor must complete a multi-step wizard before submitting,
so its elapsed value is minutes rather than milliseconds and has no boundary to
lose. It performs no min-fill wait, so there is no wall-clock/monotonic pairing
to disagree. It is therefore left alone, per §7.

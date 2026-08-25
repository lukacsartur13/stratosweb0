# Product defect: a genuine enquiry can be silently discarded

**Class A — PRODUCT DEFECT.** Found by the `g4` hermetic sequence, run 2. It is
**not** the mobile-390 navigation failure and is unrelated to it; it is recorded
separately per §40, which forbids folding a product fix into harness work.

**Not fixed in this workstream, deliberately** — see "Why this is reported
rather than fixed" below. This file is the handover.

## What the gate saw

Run `g4-02`, three tests, three different workers:

```
[mobile-390] lead-forms.spec.ts:346  subscribes with only an address, as its own source
[mobile-390] lead-forms.spec.ts:369  the blog signup posts to the same endpoint
[mobile-390] lead-forms.spec.ts:384  maps the application into the lead schema

  expect(envelope.meta.elapsedMs).toBeGreaterThanOrEqual(3000)
  Expected: >= 3000
  Received:    2996
```

**2996 in all three.** Not a spread — the same value, four milliseconds short.

They started within **202 ms** of one another (13:22:03.808, .847, 04.010) on
workers 19, 18 and 16. In the fifteen seconds before them, **fifteen other
lead-form submissions passed**. The failures are not slow tests or loaded
workers; they are every submission whose three-second window happened to
straddle one instant.

## The mechanism

`assets/js/lead.js`:

```js
/* Wait out the server's minimum fill time rather than being silently
   dropped by it. Only ever a wait, never a second request. */
var wait = Math.max(0, MIN_FILL_MS - (Date.now() - readyAt));

window.setTimeout(function () {
  send({ …, elapsedMs: Date.now() - readyAt, … });
}, wait);
```

`netlify/functions/submit-lead.mjs`:

```js
const elapsed = Number(body?.meta?.elapsedMs);
if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < MIN_FILL_MS) {
  audit('drop.tooFast', …);
  return dropSilently(submissionId);
}
```

and

```js
const dropSilently = (submissionId) =>
  json(200, { ok: true, submissionId, leadId: crypto.randomUUID() });
```

Two faults compound:

1. **Zero margin.** The client aims for *exactly* `MIN_FILL_MS`. Any shortfall
   at all, of any size, crosses the threshold.
2. **A non-monotonic clock.** `Date.now()` is the adjustable wall clock;
   `setTimeout` fires on the browser's monotonic timebase. A backward
   adjustment of a few milliseconds between scheduling and firing makes
   `elapsedMs` land below the value the wait was computed to guarantee. Three
   independent submissions reporting *the same* 2996 within 202 ms is what a
   clock step looks like; fifteen neighbours passing is what rules out load.

The client comment states the exact intent — *"rather than being silently
dropped by it"* — and the code misses it by 4 ms.

## Why this matters more than the test failure

`dropSilently` returns **HTTP 200, `ok: true`, and a freshly invented
`leadId`**. So when this fires against a real visitor:

* the visitor fills in the enquiry form and sees the success message;
* the page shows the "we will reply" copy;
* the lead is **never stored**;
* the only trace is a `drop.tooFast` line in a function log.

Nobody finds out. This is silent loss of an inbound business enquiry, on the
contact, newsletter, Impact Program and questionnaire forms alike.

## The recommended fix

Product source, not the test. Two independent changes, each sufficient to stop
the observed failure, and both worth making:

1. **Measure with a monotonic clock.** Use `performance.now()` for `readyAt` and
   for `elapsedMs`. It is not adjustable, which removes the cause rather than
   the symptom.
2. **Add a margin.** Wait `MIN_FILL_MS + 250` rather than `MIN_FILL_MS`, and
   report `Math.max(elapsed, MIN_FILL_MS)` — the client already knows it waited;
   reporting a value it knows to be below its own threshold is what triggers the
   drop.

Consider separately whether a *client-reported* duration should be able to cause
a silent drop at all. The value is supplied by the submitter, so it stops no
determined bot, and its only demonstrated effect here has been to discard real
submissions.

A regression test should assert the envelope's `elapsedMs` is at or above the
threshold **with the clock stepped backward mid-wait**, which is the case the
current suite does not cover and the reason this reached a gate rather than a
unit test.

## Why this is reported rather than fixed

Not an oversight, and not deference — a scope judgement:

* **§47** — "If another different failure appears: do not widen the whole
  workstream automatically… classify from evidence."
* **§40** — a product defect is fixed "separately", with its own regression,
  build and freeze. "Do not combine it invisibly into harness work."
* **§4/§34** — the entire navigation investigation rests on `product` and `dist`
  being byte-identical to the sequence in which the navigation failure occurred
  (`dist 2cce7616…a371d4`). Editing `assets/js/lead.js` changes both and
  destroys that property, forcing the navigation evidence to be regathered.
* The merge gate is **NOT GREEN either way**, so fixing this now would not
  rescue acceptance in this cycle.

**It ships today.** `dist` here is byte-identical to what the previous sequences
tested, so this behaviour is in the current build and is not introduced by any
change in this workstream.

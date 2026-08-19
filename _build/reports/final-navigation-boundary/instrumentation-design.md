# The navigation-boundary recorder — design

§7-§14, §36, §37. What was built, what it can and cannot say, and what it costs.

## The problem it is built against

The failing artefact said `page.goto` had not resolved. That sentence is
compatible with nine distinct failures and distinguishes none of them.

It could not do better. `tests/public-site.spec.ts:265` passes no navigation
timeout, so `page.goto` has no deadline of its own and dies with the test's. The
test body is abandoned mid-statement; every line after 265 — including anything
that could have recorded state — never runs. **Nothing written inside a test
body can survive the failure of that test.**

That single fact determines the whole design.

## Three pieces

| Piece | File | Role |
| --- | --- | --- |
| Recorder + state machine + bundle writer | `tests/helpers/navigation-boundary.ts` | Playwright-side lifecycle, written in fixture *teardown* |
| Correlated request lifecycle | `scripts/test-server.mjs` (§9) | the three states the test process cannot observe |
| Self-test + verifier | `scripts/hermetic/diagnostics/` | §37 — proof the recorder discriminates |

### 1. It is a fixture, and the bundle is written in teardown

Playwright runs fixture teardown after a test times out, in reverse setup order.
The recorder overrides the `page` fixture, so when its teardown runs the page
that failed to navigate is **still open** and can still be interrogated.

`page` is *overridden*, not accompanied by an `auto` fixture. An auto fixture
that depends on `page` forces a browser context for every test in the file,
including the two in `public-site.spec.ts` that only read `dist` off the
filesystem. Overriding preserves Playwright's lazy instantiation.

### 2. It wraps `page.goto`, so no contract changes

`tests/public-site.spec.ts` changes by **one import line**. Lines 256-271 are
byte-identical — same statements, same line numbers, same absent options,
therefore the same `waitUntil: 'load'` and the same inherited timeout. §17 and
§20 are satisfied by construction rather than by assertion.

**The wrapper hands the real method back before calling it.** This is not
stylistic. Playwright derives the `page.<name>:` prefix of its own error
messages from the name of the last library frame on the V8 stack:

| Wrapper form | Resulting error prefix |
| --- | --- |
| `page.goto.bind(page)` | `page.origGoto:` |
| `origGoto.call(page, …)` | `page.call:` |
| **restore onto `page`, then call** | **`page.goto:`** |

`scripts/hermetic/failure-records.mjs` decides whether a failure is
navigation-shaped by matching `page.goto`. Either of the first two forms would
have silently blinded the classifier this instrumentation exists to feed — every
navigation timeout in the suite would have become `UNCLASSIFIED`. The self-test
asserts the prefix rather than trusting it.

The cost of the chosen form is stated rather than hidden: a *second, concurrent*
navigation on the same page during the window would go unrecorded. No contract
in this suite performs one.

### 3. Correlation is a header, never a URL — §10

`x-stratos-nav`, set once per test via `setExtraHTTPHeaders`. The server reads
it, records it, and branches on nothing. Verified rather than asserted:

```
body sha256, with and without the header ....... 1 unique value
response headers, excluding Date ............... identical
```

A `?navId=` parameter would have changed the cache key, the canonical question
and the browser's navigation path. This changes none of them.

## The state machine — §11

```
GOTO_CALLED → REQUEST_STARTED → SERVER_RECEIVED → RESPONSE_STARTED →
RESPONSE_COMPLETE → RESPONSE_EVENT → NAV_COMMITTED → DOMCONTENTLOADED →
LOAD → DESTINATION_READY → ASSERTION_COMPLETE
```

`lastConfirmedState` is the highest state with an artefact behind it. **A state
is never inferred from the state after it, and never from the absence of an
error.** Three states are owned by the server and merged from its log at bundle
time; a missing server line means *not confirmed*, never *did not happen*.

**`ASSERTION_COMPLETE` is reachable only by an explicit
`boundaryFor(page).mark(...)`, and no contract in this suite calls it today.**
That is a deliberate limitation, not an oversight: marking it from
`public-site.spec.ts:269` would have edited the contract under investigation.
The consequence is bounded and is exactly what §29 asks for — a test that times
out *after* a resolved navigation reports `DESTINATION_READY`, which already
says "the navigation is not the failure".

## The bundle — §12

Written only when a test does **not** pass, to
`_build/reports/final-navigation-boundary/failures/<run-id>/<project>--<title>/`:

| File | Contents |
| --- | --- |
| `timeline.json` | every event with a relative timestamp; `preceding` (§19) |
| `server.json` | the server's own lines for this navId, and which states they confirm |
| `network.json` | totals, **failed with error text** (§13), **pending** (§27), main-document signature (§14) |
| `page-state.json` | driver URL, title, `readyState`, `visibilityState`, body/main existence, page errors, console errors |
| `meta.json` | **`lastConfirmedState`**, states reached, test identity, worker index, timeout, frozen subject hashes, system load |
| `screenshot.png` | best-effort |

Every interrogation of the page runs behind a deadline. A page that will not
answer is the case this exists for, and it must not become the reason nothing
is written.

`meta.json.error` is **partial on a timeout** and says so via `errorIsPartial`:
Playwright appends the `page.goto: Test timeout …` error *after* teardown. The
full text lives in the run's JSON report. The field is a convenience, never the
evidence.

## What it deliberately does not do — §36

No per-frame polling. No trace on success (`trace: 'on-first-retry'` with
`retries: 0` means never). No continuous screenshots. No response bodies — the
main-document record is a signature (status, length, type), not content. Events
are capped at 400 per test with the truncation count retained. **A passing test
writes no file at all.**

## Proof that it discriminates — §37

`scripts/hermetic/diagnostics/selftest.sh` injects six faults and
`verify-selftest.mjs` issues the verdict. Each arm must reach *exactly* the
state its own title names, and the six must produce six *different* answers — a
recorder that always says the same thing would pass any single arm.

| Arm | Injected fault | Required | Result |
| --- | --- | --- | --- |
| A | request aborted before it leaves the browser | `REQUEST_STARTED` | ok |
| B | request received, never answered | `SERVER_RECEIVED` | ok |
| C | response completed, navigation never commits | `RESPONSE_COMPLETE` | ok |
| D | parser-blocking script held | `NAV_COMMITTED` | ok |
| D2 | eager image held | `DOMCONTENTLOADED` | ok |
| E | goto resolves, test times out later | `DESTINATION_READY` | ok |

`distinct states: 6 / 6 — SELF-TEST PASSED`

Two findings from building it, both kept in the arms because they are easy to
get wrong again:

* **A held *deferred* script lands at `NAV_COMMITTED`, not `DOMCONTENTLOADED`.**
  Deferred scripts run *before* `DOMContentLoaded`, so holding one holds the
  parser exactly as a blocking script does. Arm D2 holds an image instead.
* **`work-3.jpg` is off-screen at 390 px and never requested.** The first
  version of arm D2 held it, held nothing, and *passed* — a diagnostic can be
  inert without saying so.

### The mutation that was reverted

Arm B first lived as an environment-gated stall inside `scripts/test-server.mjs`.
It worked and was **removed**: §37 ends "revert all diagnostic mutations", and a
permanently-present stall hook in the gate's own server is precisely that. The
capability moved to `scripts/hermetic/diagnostics/stall-server.mjs`, a separate
process on its own port.

```
diff <pre-self-test test-server.mjs> scripts/test-server.mjs  →  IDENTICAL
```

What the separate process proves is the *merge*: a `received` line with no
`finish` line yields `SERVER_RECEIVED` and stops. That the real server emits
those lines correctly is proven by the other five arms, every one of which
reaches `SERVER_RECEIVED` through `scripts/test-server.mjs` itself.

## Measured cost — §36

**Answer: a few percent, and this host cannot resolve it more finely than
that.** The honest part of that sentence is the second half, and it took three
attempts to earn.

`public-site.spec.ts`, `mobile-390`, 5 workers, 27 passing tests per run. Three
arms: **P** pristine (the fixture is not imported, so it does not exist), **F**
fixture attached, **FD** fixture plus server correlation — the configuration the
gate actually ships.

### Attempt 1 — block design, discarded

F 15 798 ms, FD 15 895 ms, P 13 641 ms → "+16%". **Wrong.** Leftover browser
processes from an earlier killed run were still on the host for part of it. It
is recorded here because a plausible, quotable, wrong number is exactly what
this workstream exists to stop producing.

### Attempt 2 — block design, clean host, still unusable

P 5 862 ms, F 5 423 ms, FD 5 749 ms → the instrumented arms came out *faster*
than pristine. They did not get faster; the host got slower. Across 15
consecutive identical-shaped runs, **the pristine arm's own in-run test time
climbed from 23.7 s to 33.8 s (+43%)**. Any block design on this machine
measures the block's position in time, not the block.

### Attempt 3 — adjacent pairs, order alternated

Each P is run immediately beside an FD, and the order is swapped every pair so
residual within-pair drift cancels across the set instead of accumulating into
one arm. Twelve pairs, first two discarded as warm-up (19.1 s and 16.9 s against
a ~11 s steady state):

| | median | mean | stdev |
| --- | --- | --- | --- |
| FD vs P, per pair | **+2.6 %** | +9.1 % | 20.9 % |

| Order within the pair | median delta |
| --- | --- |
| P first | +6.4 % |
| FD first | +2.1 % |

**The measurement's own order effect (4.3 points) is the same size as the effect
being measured (2.6 points).** So the defensible statement is an upper bound:
the instrumentation costs on the order of a few percent of one spec file, on one
of nineteen files, and nothing this method can do will tighten that on this host.

### What it costs that is not time

The correlation log is **~30 KB per instrumented test**, so under ~1 MB per gate
run for `public-site.spec.ts`. It is written outside the served tree and outside
every canaried directory, so it cannot invalidate a run. Successful tests
produce no bundle and no screenshot; only failures do.

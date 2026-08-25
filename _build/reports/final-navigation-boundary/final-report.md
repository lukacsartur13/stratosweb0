# Final mobile-390 navigation boundary — report

*Verdict section is completed from the six-run matrix; everything above it is
settled evidence.*

## The question

One failure survived the previous hermetic sequence:

```
public-site.spec.ts:264  [mobile-390]  /kkv.html responds and has a title and description
Test timeout of 30000ms exceeded.
page.goto: navigating to "http://127.0.0.1:4322/kkv.html", waiting until "load"
```

It was **not** to be called a `page.goto` stall, because the artefact could not
support that or any other classification. §3 asked for the failure boundary to
be located among nine possibilities; §21 forbade guessing it; §46 required that
the next occurrence be diagnostically complete.

## Why the old artefact was empty, and why that was not fixable in the test

`tests/public-site.spec.ts:265` passes **no navigation timeout**. `page.goto`
therefore has no deadline of its own and dies with the test's 30 000 ms budget.
Playwright abandons the test body mid-statement, and every line after 265 —
including anything that could have recorded state — is never reached.

**Nothing written inside a test body can survive the failure of that test.** That
single fact determined the design: the recorder is a fixture, and it writes its
bundle in *teardown*, which Playwright still runs after a timeout and while the
failed page is still open.

## What was built

| | |
| --- | --- |
| `tests/helpers/navigation-boundary.ts` | overrides the `page` fixture, wraps `page.goto`, records the lifecycle, writes the bundle in teardown |
| `scripts/test-server.mjs` (§9) | per-request receive / resolve / head-sent / first-write / finish / close / abort / socket-error, correlated by header |
| `scripts/hermetic/diagnostics/` | the §37 self-test, its verifier, a stall server, and the §18 control arm |
| `scripts/hermetic/nav-stress.mjs` | targeted reproduction under the hermetic rules |
| `scripts/hermetic/curate-final-gate.mjs` | the §49 canonical verdict |

**`tests/public-site.spec.ts` changed by one import line.** Lines 256-271 are
byte-identical — same statements, same line numbers, same absent options, so the
same `waitUntil: 'load'` and the same inherited timeout. The contract under
investigation is still the contract under investigation (§17, §20).

### The eleven states, and the six that were proven separable

`GOTO_CALLED → REQUEST_STARTED → SERVER_RECEIVED → RESPONSE_STARTED →
RESPONSE_COMPLETE → RESPONSE_EVENT → NAV_COMMITTED → DOMCONTENTLOADED → LOAD →
DESTINATION_READY → ASSERTION_COMPLETE`

§37 required proof that the recorder discriminates rather than merely reports.
Six faults were injected and each had to produce *exactly* its own boundary, and
the six had to differ from one another:

| arm | injected | required | got |
| --- | --- | --- | --- |
| A | request aborted in the browser | `REQUEST_STARTED` | ok |
| B | received, never answered | `SERVER_RECEIVED` | ok |
| C | response complete, no commit | `RESPONSE_COMPLETE` | ok |
| D | parser-blocking script held | `NAV_COMMITTED` | ok |
| D2 | eager image held | `DOMCONTENTLOADED` | ok |
| E | goto resolves, later timeout | `DESTINATION_READY` | ok |

`distinct states: 6 / 6 — SELF-TEST PASSED`.

**`ASSERTION_COMPLETE` is unreachable today** and this is stated rather than
hidden: marking it would have required editing the contract under
investigation. §29's requirement is met without it — a timeout after a resolved
navigation reports `DESTINATION_READY`, which already says the navigation is not
the failure.

## What the product did NOT do

The frozen subject for this workstream has **`product`, `config` and `dist`
hashes byte-identical** to the sequence in which the failure occurred:

```
dist  2cce7616f7f96a0d6ba51fe386f8431cc9ed712d7231b49807f3b404cfa371d4
```

Only the `test` group moved. §4 was kept: no product source was touched, and the
browser in the new sequence is served the same 186 files, byte for byte, as the
browser that stalled. §34's rule holds — *a route name is not a root cause*.

## Targeted reproduction — §16-§19

| arm | executions | failures | mean load |
| --- | --- | --- | --- |
| `routes` — the exact contract | 500 | **0** | 38.72 |
| `control` — bare `page.goto` (§18) | 500 | **0** | 46.79 |
| `real` — the whole file (§17) | 50 | **0** | 137.41 |

```
NOT REPRODUCED WITH COMPLETE INSTRUMENTATION
```

All three VALID: subject byte-identical, canary silent, servers confirmed dead,
ports released.

**The load figures are the finding.** The original failure occurred at mean load
**8.04**, among the *lower*-load runs of its sequence. These arms ran the same
contract at means of 38, 47 and 137, peaking at **204**, and produced nothing.
Class C is not reachable from a load average, and this evidence moves away from
it rather than toward it.

§18's control does not discriminate, because neither arm fails. What the pair
establishes is a bound: **this failure is not reachable by repeating the
navigation**, with or without the contract around it. The previous
investigation's 24 010 navigations said the same; this says it with a recorder
attached, so the null is measured rather than absent.

## Defects found on the way — harness only (§41)

Neither is the navigation failure. Both are real and both are recorded
separately so they cannot be mistaken for it.

**`route-audit` audited another project's website.** It bound a fixed port with
`stdio: 'ignore'` and slept 900 ms. An unrelated session on this host held that
port; python could not bind, wrote its error to a discarded stderr and exited;
the audit then drove a browser through 66 routes at 12 viewports against a
different site and reported **792 of 792 checks failing** as failures of this
project, with nothing in the output to say so. It now picks a free port, polls
for readiness, and requires whatever answers to **prove** it serves this `dist`
before auditing a single route.

**The stress runner blocked its own instruments.** `spawnSync` held the event
loop for a whole arm, so the load sampler never ticked and 509 `fs.watch` events
fired inside one millisecond carrying that millisecond as their timestamp.

## What this investigation broke, and what that proved

Three self-inflicted contaminations, all caught by the machinery rather than by
the person who caused them:

| | what | detected by |
| --- | --- | --- |
| 1 | a `pkill` killed a running arm's own server | 34 failures, all `REQUEST_STARTED` |
| 2 | a gate run rebuilt `dist` mid-arm | **509 canary events** — the hashes said IDENTICAL, because the rebuild was byte-identical |
| 3 | a trim watcher orphaned an arm's process tree | 23 failures, all `REQUEST_STARTED` |

The second is the one worth keeping. §15 requires both a hash comparison and a
write canary and insists neither is redundant; this is exactly the case that
proves it. A rebuild of unchanged sources leaves the hash untouched and the
subject nonetheless mutated mid-run. **The hash said IDENTICAL and the run was
invalid.**

The first and third are the recorder's own validation on faults nobody designed:
57 failures that, before this instrumentation, would have been 57
indistinguishable `page.goto` timeouts — in the same file, on the same project,
on several of the same routes as the failure under investigation.

## Verdict

*(Completed from `six-run-matrix.md` when the sequence finishes.)*

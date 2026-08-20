# Root cause — §38, §39, §40, §41, §42, §43

> §38 forbids the words *Playwright bug* and *browser bug* unless five
> conditions are met. §41 forbids *"the Mac was weird"*. §42 permits
> **TARGET FAILURE NOT REPRODUCED** as an honest outcome and forbids inventing a
> mechanism instead. This file keeps to those rules, and it separates what was
> proven from what was merely narrowed.

## 1. The navigation dispatch failure — verdict

> ### `MOBILE-390 NAVIGATION DISPATCH ISSUE: NOT RESOLVED`
> ### Classification: **NONE OF A/B/C/D — the evidence does not reach any of them.**

Not classified as **D — ENGINE / TOOLING LIMITATION**, because §38's standard is
not met. Four of its five conditions now hold:

| §38 condition | Status |
|---|---|
| product not involved | **holds** — no request is ever emitted, and two different routes fail identically |
| server not involved | **holds** — `SERVER_RECEIVED` never occurs; the same document is served normally to two desktop projects in the same run |
| command/lifecycle boundary | **holds** — the divergence is inside `GOTO_CALLED → REQUEST_EVENT` |
| exact version/revision | **holds** — WebKit 26.5 rev 2336, Playwright 1.62.1, Node 24.18.1, darwin 25.6.0 arm64 |
| **reproducible engine/tool behaviour** | **DOES NOT HOLD** |

The fifth is the one that matters and it fails outright: **zero reproductions in
~27 100 targeted navigations.** Calling this an engine limitation would be
choosing the most convenient available label for something not reproduced, which
is exactly what §38 exists to prevent — and its practical consequence would be to
silently skip mobile WebKit, which the previous workstream already ruled out.

Not classified as **B — TEST DEFECT** (§39): the test does not misuse the API. It
calls `page.goto` as its first statement, on a fresh page, with no operation
pending — the state immediately before the call is recorded in full in
`exact-contract.md` and contains nothing outstanding.

Not classified as **B/HARNESS DEFECT** (§40): no fixture leaves a page, context
or browser in an invalid state. `contextPages: 1`, page open, context open,
browser connected, no prior route handlers, no prior failed requests.

Not classified as **environment** (§41): there is a real environmental
*correlation* — see §3 below — and a correlation measured on **two** events is
not a repeatable OS/browser-process failure. §41 requires evidence, and two
points with a plausible story is not it.

## 2. What IS proven

These are not hypotheses. Each is carried by an artefact.

1. **The failure boundary lies strictly inside `GOTO_CALLED → REQUEST_EVENT`.**
   In a healthy navigation on this build that interval is **under 6 ms**
   (measured, three samples, 2 ms spread). In the failure it did not complete in
   **30 000 ms** — a factor of more than 5 000. See `first-divergence.md`.

2. **The product is not involved.** No request is emitted, so no byte of any
   document is fetched. Two *different* routes — `/kkv.html` in g3-02,
   `/nagyvallalat.html` in g6-01 — produced the identical failure at the identical
   source line. §26 holds with positive evidence, not merely with caution.

3. **The server is not involved.** Zero server log lines carry the failing navId.
   Sibling navigations completed in hundreds of milliseconds throughout the
   30-second window. §27 holds.

4. **The browser process, the page and the target session were all alive.** After
   the stall, `page.evaluate`, `page.title` and `page.screenshot` all succeeded;
   `crashed: false`, `closed: false`.

5. **On WebKit, that last fact proves less than it appears to.**
   `page.goto` is `Playwright.navigate`, a **browser-level** command addressed by
   `pageProxyId`. `evaluate`, `title` and `screenshot` are tunnelled to the page's
   **target session** inside `Target.sendMessageToTarget`. Two different paths. So
   the teardown evidence establishes that the target session was healthy and says
   **nothing** about the path the navigation took. Any inference to the contrary
   imports a Chromium single-session model into an engine that does not have one.

6. **Route identity is not the variable** (§21, settled by history).

7. **Lifetime model does not change navigation latency.** Reused page, fresh page,
   fresh context and fresh browser agree within 25 ms at p50 across 1 200
   attempts. §20's four readings are all conditional on a failure appearing, none
   appeared, and **none is claimed**.

## 3. The environmental correlation — stated as a hypothesis, not a cause

Both known occurrences are inside a full repository gate. From `g6-01`'s own
samples during the failure window:

* `load1` **5.77 falling to 4.16** — low, and *falling*. This is not a CPU-load
  failure, and the previous workstream had already refused that reading.
* free memory **927 MB**, swap **3 462 MB** in use.
* `browserProcs` **static at 42 for 115 s** spanning the failure. The run's own
  maximum is 46, so **42 is not a hard ceiling and must not be reported as one.**
* `route-audit` ran a second, independent browser workload concurrently with
  `playwright-main` — 252 778 ms against 252 773 ms, near-total overlap.

The targeted arms ran at load **31-130** with **1 877-4 548 MB** free and no second
browser workload: a harder CPU test and a much softer memory test than the only
conditions the failure has ever appeared in.

The hypothesis this suggests — that a WebKit navigation requiring a process
transition can stall under memory pressure, while the existing page's target
session stays responsive — is **consistent with every observation and proven by
none of them.** It is written down so it can be tested, not because it has been.

### Evidence that points AWAY from it, recorded because it does

Stage B's throughput collapsed by a factor of twenty over its run, and the cause
was measured: **swap reached 3 388 MB of 4 096 MB**, leaving 708 MB, and the host
began thrashing. That means its last several hundred attempts ran under genuine
memory pressure — the closest any targeted arm came to the condition this
hypothesis rests on.

**They produced zero stalls.**

It is a small sample under pressure of a different shape (swap exhaustion rather
than 927 MB free with a second browser workload), so it does not refute the
hypothesis. But it is the one piece of new evidence that bears on it directly and
it points the wrong way, and a report that listed only the supporting correlation
would be selecting its evidence.

## 4. Defects found and fixed — harness only

Real, found by this workstream, and none of them is the navigation failure.

### 4a. The frozen-subject claim was broader than the hashing — §3, §46

Three of four Playwright configs use `testDir: './experiments/tests'`, and none of
that tree was hashed. The full/WebGL suite's **165 tests in 2 files** could have
been edited mid-gate with every manifest comparison still printing
`SUBJECT IDENTICAL`. Two loose test-only modules were uncovered for a related
reason. Coverage 74 → 82 files. Mutation-checked in **both** directions: the
fixed detector reports `RUN INVALID`, the pre-fix detector reports
`SUBJECT IDENTICAL` on the identical edit. See `manifest-gap.md`.

### 4b. Every failure bundle recorded `tests: null`

`navigation-boundary.ts` read `m.groups.tests`; the group is `test`. The G6
bundle's own `meta.json` carries `"tests": null` next to a valid `dist` hash. A
bundle that names the artefact but not the test code that judged it is missing
half of what §35 asks it to carry. Fixed, and widened to `test`, `config` and
`combined`.

### 4c. The gate could pin only one of the four groups

`gate-run.mjs` accepted `--expect-dist` and nothing else. The before/after
comparison catches the subject changing **during** a run, never a run that
**began** from the wrong subject. Added `--expect-test` and `--expect-config`.

### 4d. The new instrument could not observe a state §17 requires

The protocol tap's filter omitted the acknowledgement frame
(`{"result":{"loaderId":…}}`), so `PROTOCOL_COMMAND_ACKNOWLEDGED` was
unobservable — and that state is precisely what separates *Playwright never got
an answer* from *Playwright got an answer and the navigation died afterwards*.
Found by reading a captured healthy trace back through the filter and finding a
frame absent from a log that plainly contained it upstream. Fixed before any
reproduction volume was run against it.

## 5. Defects in this investigation's own conduct

Recorded because a tidy narrative would be a false one.

* **A fidelity defect that invalidated 500 executions.** The first Stage A drove
  the preceding sibling routes on the page under test rather than in their own
  contexts. **Zero** of its 500 attempts started from `about:blank` — the arm had
  silently become the §22 warm-up control. Found by inspecting `urlBefore` in the
  records rather than trusting the arm's name. Worker corrected, precondition
  verified, 500 discarded and re-run.
* **A self-inflicted invalid stage.** A summary tool written into `scripts/` while
  Stage B was in flight changed the `test` group hash and the run was correctly
  marked `SUBJECT_CHANGED_DURING_RUN`. Its numbers are not reported. The added
  file was inert; the machinery is not entitled to know that, and did not assume
  it.

## 6. What may NOT be concluded

* **Not that the boundary is page-, context- or process-level.** §20's four
  readings each require a failure to have appeared in some arm. None did.
* **Not that a warm-up navigation fixes it** (§22). No mechanism, no fix.
* **Not that 42 browser processes is a limit.** The same run reached 46.
* **Not that memory pressure is the cause.** It is the strongest correlate
  available and it rests on two events.
* **Not `page.goto` misuse, a harness lifecycle fault, a product defect, or a
  server defect.** Each is excluded by an artefact above.
* **Not a fixed cause at all.** §42's `TARGET FAILURE NOT REPRODUCED` is the
  honest outcome and it is the one recorded.

## 7. §43, §44, §45 — what a fix would have required

§43 says fix only the proven layer. **No layer is proven**, so no fix to test,
harness, browser setup or environment is applied for the navigation failure, and
no product code is touched.

§44 requires any fix to carry a mutation check proving the regression catches the
old mechanism. There is no mechanism, so there is nothing a mutation could
falsify — and §44 explicitly forbids inventing a meaningless one. The mutation
checks that **were** performed are the ones with real mechanisms behind them:
the manifest gap, in both directions.

§45's post-fix stress (500-1 000 repetitions with zero unexplained failures) is
satisfied in volume — 1 604 subject-verified clean executions of the exact
contract, above its 1 000 preferred threshold — but it is recorded as what it is:
a **baseline**, not the confirmation of a fix, because there is no fix.

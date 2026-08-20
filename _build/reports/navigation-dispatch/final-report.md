# Final report — the mobile navigation dispatch investigation

Subject `b9a87da` · WebKit 26.5 rev 2336 · Playwright 1.62.1 · Node 24.18.1 ·
darwin 25.6.0 arm64

## Verdict

```
LEAD.JS SILENT-DROP PRODUCT DEFECT:            RESOLVED (unchanged, prior workstream)
MOBILE-390 NAVIGATION DISPATCH ISSUE:          NOT RESOLVED
HERMETIC TEST SUBJECT:                         FULLY HASH-COVERED
FINAL HERMETIC CLOSURE GATE:                   VALID + RED
HERMETIC REGRESSION GATE:                      NOT ACCEPTED
REPOSITORY-WIDE MERGE GATE:                    NOT GREEN
REGRESSION-HARNESS WORKSTREAM:                 NOT CLOSED
```

Two of the three things this workstream was asked to do are done. The third —
explaining the dispatch stall — is not, and the honest form of that answer is
`TARGET FAILURE NOT REPRODUCED` rather than a mechanism invented to fit two
observations.

## 1. The manifest gap — CLOSED (§3, §4, §5, §46)

**This was a real harness defect and it was larger than reported.**

The `test` group read `['tests', 'scripts']`. Three of the four Playwright
configs declare `testDir: './experiments/tests'` — including
`playwright.full.config.ts`, which collects **165 tests** for the WebGL gate — and
none of that tree was hashed. Two test-only modules at `experiments/` root,
imported by one spec and nothing else, were in no group at all.

For the whole of G3, G5 and G6, the specs deciding whether the WebGL gate passed
could have been edited mid-gate and every comparison would still have printed
`SUBJECT IDENTICAL`.

Coverage **74 → 82 files**. Mutation-checked **in both directions** — the fixed
detector reports `RUN INVALID`, the pre-fix detector reports `SUBJECT IDENTICAL`
on the identical edit. The negative control is what makes the positive one mean
something. **`EXPERIMENT TEST MUTATION DETECTED`.** The mutation was reverted and
not committed.

Two further defects in the same area, both found while fixing the first:

* every failure bundle ever written recorded `tests: null`, because
  `navigation-boundary.ts` read a group name (`tests`) that does not exist (`test`).
  Visible in the G6 red run's own `meta.json`.
* `gate-run.mjs` could pin only `dist` to a frozen reference. The before/after
  comparison catches the subject changing *during* a run, never a run that *began*
  from the wrong subject. `--expect-test` and `--expect-config` added, and both
  exercised by the closure gate.

Details and evidence: `manifest-gap.md`.

## 2. The navigation dispatch failure — NOT RESOLVED

### What is now proven

* **The boundary is strictly inside `GOTO_CALLED → REQUEST_EVENT`.** Healthy, on
  this build, that interval is **under 6 ms** across three captured samples with a
  2 ms spread. In the failure it did not complete in **30 000 ms** — a factor of
  more than 5 000. It is a discrete boundary, not the tail of a distribution.
* **The product is not involved.** No request is emitted, so no byte is fetched.
  Two *different* routes — `/kkv.html` (g3-02) and `/nagyvallalat.html` (g6-01) —
  failed identically at the identical source line. §26 holds on evidence.
* **The server is not involved.** Zero server lines carry the failing navId, and
  siblings completed in hundreds of milliseconds throughout the window. §27 holds.
* **The engine is WebKit**, not Chromium — established before any engine-level
  claim, as §12 requires. §13 does not apply; §14 does.
* **`page.goto` on WebKit is `Playwright.navigate`, a browser-level command on the
  pageProxy channel** — a *different* channel from the target session that carries
  `evaluate`, `title` and `screenshot`. So the G6 teardown evidence proves the
  target session was alive and proves **nothing** about the path the navigation
  took. A Chromium single-session intuition gets this exactly backwards.
* **Route identity is not the variable**, settled by history rather than by new
  executions.

### What is not proven, and is not claimed

No classification is asserted. Not **D — ENGINE / TOOLING LIMITATION**: four of
§38's five conditions hold, and the fifth — *reproducible engine/tool behaviour* —
fails outright at **zero reproductions in ~27 100 targeted navigations**. Not
**B — TEST DEFECT**: the test does not misuse the API. Not **B/HARNESS DEFECT**:
no fixture leaves a page, context or browser in an invalid state. Not
**environment**: there is a correlation, on two events, which §41 does not accept.

The strongest correlate is memory pressure alongside a second concurrent browser
workload. It is written down as a hypothesis in `root-cause.md`, together with the
one piece of new evidence that points **away** from it: Stage B's final hundreds of
attempts ran with swap at 3 388/4 096 MB and still produced zero stalls.

### The reproduction attempt, and what it cost

1 604 subject-verified executions of the exact contract plus 1 500 across the
lifetime, route and warm-up controls: **zero dispatch stalls.**

§18's ladder (500 → 2 000 → ~5 000) is met at Stage A and **not** at Stage B or C.
Stage B was stopped at 1 104 of 1 500 on §18's own *"if runtime practical"*
condition, with the reason measured rather than asserted: throughput fell from
~82/min to ~4/min as swap reached 3 388 MB of 4 096 MB. Completing the ladder
would have taken several more hours on a machine also carrying the user's
interactive session. **No claim of 5 000 executions is made.**

### The instrument was calibrated before its silence was believed

A detector that cannot fire reports zero exactly like a working one. So the stall
path was made to run:

* a synthetic pre-request fault produced `statesReached: ["TEST_READY","GOTO_CALLED"]`,
  `readyState: "complete"`, `href: "about:blank"` — the G6 signature — with the
  heartbeat, all three probes, the extended observation and the bundle all working;
* a blackhole address (RFC 5737 TEST-NET-1) dispatched in **12.5 ms**, reached
  `REQUEST_EVENT`, and was classified **`failed`, not a dispatch stall**.

Without the second arm, "0 stalls" would have been compatible with a blind
detector. Details: `instrumentation.md`.

## 3. The final closure gate — VALID + RED

One run, quiet-host preflight PASS on attempt 1, all four subject groups pinned
and byte-identical before and after, zero canary events, zero orphaned processes,
zero ports held. `dist` identical to G6's.

**Four failing tests, and none of them is a navigation.** All four are the
scroll-driven journey instrument failing to track the document — altitude reading
0 where 30 000 is expected, altitude drifting 14 970 across a menu cycle where ≤ 60
is required, header and stage readout disagreeing, and stage announcement depending
on scroll direction. `full-ascent.spec.ts:1342` had already failed in `g5-02`.

The host was in a poor state — mean `load1` 27, peak 112, swap within 700 MB of
exhaustion, the suite 2.4× slower than G6 — and **this investigation caused it**:
the reproduction arms immediately preceding the gate drove swap to near-exhaustion.
That is disclosed, and it is explicitly **not** used to discount the result. The
preflight passed, and its design is deliberate that a run counts once it starts.

Per §51, no G8 sequence was started, no run was repeated, and no retry was issued.
Details: `final-closure-gate.md`.

## 4. What was NOT done, as instructed

* **No product code touched.** Not `/nagyvallalat.html`, not site JS or CSS, not
  the Altimeter, not route content, not the backend (§26).
* **No server change.** Zero server involvement was ever demonstrated (§27).
* **No Rapidkert resolution.** `experiments/src/full/content.ts` vs
  `full-ascent.spec.ts:388` is untouched and remains a separate future subject
  (§6, §48). The in-flight edit is not in the frozen subject.
* **Nothing pushed, merged or deployed. No P2 migration applied. No DNS change.
  Portal P3 not begun** (§56).
* **No G7 sequence** (§7). One closure gate, as §49 specifies.
* **No retry-on-stall recovery path** anywhere in the instrumentation (§33).
* **No Playwright internals modified.** No CDP-equivalent invented for WebKit.
* **No context-option bisection**, which §25 conditions on reproduction.
* **§23 and §24 comparisons not run** — both are separations that need a failure
  rate to compare, and `page.goto` produced 0 stalls in 1 604.

## 5. Mistakes made in this investigation

Recorded because a tidy account would be a false one.

* **500 executions measured the wrong contract.** The first Stage A drove the
  preceding sibling routes on the page under test rather than in their own
  contexts; **zero** of its 500 attempts started from `about:blank`, silently
  converting the arm into the §22 warm-up control. Found by inspecting `urlBefore`
  in the records instead of trusting the arm's name. Discarded and re-run.
* **A stage invalidated by my own edit.** A summary tool written into `scripts/`
  mid-flight changed the `test` group hash; the run was correctly marked
  `SUBJECT_CHANGED_DURING_RUN` and its numbers are not reported.
* **The new instrument could not observe a state §17 requires.** The protocol
  filter omitted the acknowledgement frame, making
  `PROTOCOL_COMMAND_ACKNOWLEDGED` — the state separating *no answer* from
  *answer then death* — unobservable. Fixed before any volume ran against it.
* **The closure gate ran on a host this investigation had degraded.** See above.

## 6. Recommendations

Not actions taken — the workstream stops here (§56).

1. **The four failing contracts from `final-closure-01` are the next subject**, per
   §51. They are one cluster, and `full-ascent.spec.ts:1342` has failed before.
2. **The preflight should measure swap headroom.** It checks `load1`, iCloud
   activity and ports; swap exhaustion is what actually degraded this run, and it
   was invisible to the check.
3. **The navigation-boundary fixture covers only `public-site.spec.ts`.** Every
   other spec imports `@playwright/test` directly, so three of the four closure-gate
   failures produced no bundle. Adequate for §46, which is about the mobile-390
   navigation contract, and a real limit on everything else.
4. **Keep the dispatch instrumentation.** §42 asks for it to be retained if
   lightweight, and it is: a passing attempt costs one buffer reset, and the debug
   stream is off unless a targeted run turns it on. It is what would collapse the
   `GOTO_CALLED → REQUEST_EVENT` interval to a single edge the next time the
   failure occurs.

## 7. Report index

| File | Contents |
|---|---|
| `exact-contract.md` | §8 — every parameter of the failing contract, measured |
| `manifest-gap.md` | §3-§5 — the gap, the fix, both mutation checks |
| `instrumentation.md` | §10-§17 — the WebKit protocol boundary, the state machine, calibration |
| `recurrence.md` | the 19-run population, the two occurrences, the invalid stage |
| `targeted-reproduction.md` | §18, §22, §34 — stages, volumes, and where the ladder stopped |
| `lifetime-controls.md` | §19, §20 — four lifetime models |
| `route-controls.md` | §21 — route identity, settled by history |
| `first-divergence.md` | §37 — the divergence, and the resolution at which it is known |
| `root-cause.md` | §38-§45 — what is proven, what is refused, what is still open |
| `final-closure-gate.md` | §49, §51, §55 — the one gate and its verdict |

Historical results are preserved and unrewritten: G3, G5, the invalid iCloud
attempt and the G6 red run are all where they were (§53).

# Targeted reproduction — §18, §22, §34, §42

## The prior this runs against

Two things were known before a single new navigation was executed, and both are
in `recurrence.md`:

1. The previous workstream executed **24 010 targeted navigations** across 33
   diagnostic arms and reproduced nothing.
2. The signature has occurred **twice in nineteen valid gate runs**, both times
   inside a full repository gate, never inside a targeted arm.

§18 requires the exact contract to be run at volume anyway, and it is. But the
volume is not expected to be what produces the answer, and reporting it as
though a bigger number would have settled things would misrepresent what is
being measured.

## The contract, unsimplified — §18

Every arm runs the real thing before anything is varied: WebKit,
`devices['iPhone 13']` verbatim, `page.goto(target)` with no options beyond the
30 000 ms the test runner's budget would have imposed, same default
`waitUntil: 'load'`, same URL, owned server on `dist/`.

### One fidelity defect, found and fixed before it became a conclusion

The first Stage A ran 500 attempts in which the two preceding sibling routes
were navigated **on the page under test**. That is not what the suite does:
Playwright Test gives every test a fresh context and a fresh page, so in the real
contract the neighbours run in *their own* contexts and leave the target's page at
`about:blank`.

The consequence was total. Of those 500 attempts, **zero** started from
`about:blank` — the arm had silently become the §22 warm-up control and could not
have exercised the one precondition §22 exists to isolate.

The worker was corrected so neighbours run in their own contexts, `about:blank`
was verified as the precondition, and **the 500 were discarded and re-run**. They
are not counted anywhere in this report.

## Stage results

Every arm: subject hashed before and after, `dist` canary armed, port ownership
checked. An arm whose subject moved is INVALID and its numbers are not evidence.

| Stage | Attempts | **Stalls** | p50 | p99 | max | Subject verified | Counted |
|---|---|---|---|---|---|---|---|
| A | 500 | **0** | 245 ms | 585 ms | 2 443 ms | identical | **yes** |
| B (1st attempt) | 1 500 | 0 | 284 ms | 1 375 ms | 1 994 ms | **CHANGED** | **no** |
| B (re-run, curtailed) | **1 104** | **0** | — | — | — | identical | **yes** |
| C | **not run** | — | — | — | — | — | — |

**Exact-contract total counted: 1 604, subject-verified, zero stalls.**
Plus 1 500 attempts across the lifetime, route and warm-up controls, also
subject-verified and also zero.

### §18's ladder: where this stopped, and on which of its own conditions

§18 sets 500 → 2 000 → ~5 000, with Stage C conditioned explicitly on
*"if no failure and **runtime practical**"*. Stage A's 500 completed. Stage B
reached 1 104 of 1 500 and was then **stopped on that condition**, measured
rather than asserted:

| Elapsed | Cumulative attempts | Rate |
|---|---|---|
| 110 s | 150 | ~82 / min |
| 13 min | 650 | ~50 / min |
| 25 min | 850 | ~34 / min |
| 35 min | 950 | ~10 / min |
| 50 min | 1 050 | ~4 / min |

Throughput fell by a factor of twenty over the run. The cause was measured, not
guessed: **swap had reached 3 388 MB of 4 096 MB**, leaving 708 MB, and the host
was thrashing. Completing Stage B would have taken a further ~110 minutes and
Stage C several hours, on a machine also carrying the user's interactive session.

So Stage B was stopped and Stage C not started. **§18's ladder is met at Stage A
and not at Stage B or C, and no claim of 5 000 exact-contract executions is
made.**

Stopping a run mid-flight normally forfeits its validity, because the
orchestrator writes the after-manifest at the end. Here the after-manifest was
captured manually the moment the workers were confirmed dead, and compared:

```
SUBJECT IDENTICAL  8cac14bc6f6cef67764fdc3f6a4173c6fbd3801d1432c960100adb1c4f4c0ebe
```

The subject was provably stable across the executed portion, so the 1 104
attempts are evidence; what is missing is the remaining 396, not their integrity.

### One thing the thrashing arm did establish

The collapse means the last several hundred attempts ran at **swap 3 388/4 096
MB** — genuine memory pressure, and the closest any targeted arm came to the
condition that distinguishes the G6 environment. **They still produced zero
stalls.** That is a weak result on a small sample and it is recorded as one, but
it points the wrong way for the memory-pressure hypothesis in §3 of
`root-cause.md`, and is noted there rather than omitted.

### The invalid stage, recorded rather than quietly replaced

Stage B's first attempt was invalidated **by this investigation**: a summary tool
was written into `scripts/` while the stage was in flight, and `scripts/` is in
the hashed `test` group.

```
group test: HASH_CHANGED
  added:   scripts/hermetic/diagnostics/dispatch-summary.mjs
```

The added file was a read-only reporting helper that no arm executes, so its real
effect on the run was nil. The machinery does not know that and must not — *the
subject moved* is the only claim it is entitled to make. Its 1 500 executions
report zero stalls and that number is **not** offered as evidence.

## §22 — the about:blank control

The G6 failure was a page's **first** navigation. §22 asks whether only an
initial navigation can stall.

| Arm | Page state before the call | Attempts | Stalls |
|---|---|---|---|
| default | `about:blank` — first navigation, as the contract | 500 + 1 500 + 3 000 | **0** |
| `W-warm` | navigated to `/index.html` first, then the target | 300 | **0** |
| `L-A` (`reused-page`) | previous attempt's URL | 300 | **0** |

Neither arm stalled, so §22 is **not answered**. It is explicitly not concluded
that a warm-up prevents the failure, and — per §22's own instruction — no warm-up
navigation has been adopted anywhere, because there is no mechanism to adopt it
on.

## §34 — timeout policy

Normal timeouts are unchanged. No config value was raised. Each attempt is bounded
at the 30 000 ms the test budget imposes, and the contract's own verdict is
produced under the contract's own ceiling.

The extended observation §34 asks for is implemented and armed: on a stall, after
the contract's result is recorded, the pending navigation is watched for a further
120 s to establish whether it resolves by 60 s, by 120 s, or never before cleanup.
**It has never fired, because no stall has been reproduced.** The field exists and
is empty, which is the honest state.

## §23, §24 — the two comparison controls not run, and why

§23 (`window.location.href` versus `page.goto`) and §24 (a real link click versus
`page.goto`) are **diagnostic comparisons whose interpretation depends on a
failure rate to compare.** Both are phrased in the brief as separations —
"if click navigation always starts network while `page.goto` occasionally does
not" — and with `page.goto` at **0 stalls in 1 604**, there is no rate to
separate. Running them would produce two more columns of zeros and invite exactly
the inference §20 forbids: reading a difference into arms that all measured
nothing.

They are specified, they are cheap, and they are the first thing to run against a
reproduction if one is ever obtained.

## §25 — context option bisection

Not performed, as §25 directs: *"Only after reproduction."* The `mobile-390`
context options are recorded in full in `exact-contract.md` so that a bisection
has a documented starting point, and not one of them has been disabled on a
hunch.

## Verdict

> **TARGET FAILURE NOT REPRODUCED.**

1 604 subject-verified executions of the exact contract, plus 1 500 across the
lifetime, route and warm-up controls, produced **zero** dispatch stalls. Adding
the previous workstream's 24 010, the signature has now survived roughly
**27 100** targeted navigations without recurring, while occurring twice in
nineteen repository-wide gate runs.

The shortfall against §18's 5 000 is stated rather than smoothed over. It does
not change the verdict — 27 100 clean navigations and 1 604 more would not have
been the difference between reproducing and not — but the number reported is the
number executed.

§42 forbids inventing a mechanism on that basis, and none is invented. What the
result supports is narrower and worth stating: **the trigger is not present in a
targeted arrangement**, and the difference between the two arrangements is
measurable rather than mysterious.

## The measured difference between the two arrangements

| | G6 gate, at the failure | These targeted arms |
|---|---|---|
| `load1` | **5.77 → 4.16, falling** | **31-130** |
| free memory | **927 MB** | 1 877-4 548 MB |
| swap in use | 3 462 MB | not sampled |
| browser processes | 42, static for 115 s | not sampled |
| concurrent second browser workload | **yes** — `route-audit` overlapped `playwright-main` almost exactly (252 778 ms vs 252 773 ms) | none |
| test population | 1 285 tests, 5 projects, 2 servers | one contract |

The targeted arms are a **harder CPU test and a much softer memory test** than the
only conditions this failure has ever been observed in. On the variable that most
distinguishes those conditions — memory pressure alongside a second concurrent
browser workload — they measure the wrong direction.

This is why §42's remedy is a controlled repository-wide verification run rather
than a larger targeted number, and it is what `final-closure-gate.md` records.

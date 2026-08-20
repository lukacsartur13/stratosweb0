# The population the failure comes from — 19 valid gate runs

§18 says not to blindly repeat 24 000 navigations, and §53 says the historical
results stay historical. Both point at the same cheap step, which had not been
taken: **read the nineteen valid gate runs already on disk as one population**
before spending anything on new executions.

## Every failing test in every valid gate run

| Run | Green | Failing test | Project |
|---|---|---|---|
| g2-01 | yes | — | |
| g2-02 | yes | — | |
| g2-03 | yes | — | |
| g2-04 | **no** | `a subpage reached from the homepage carries the sa…` | desktop-1440 |
| | | `while it is open the page behind it cannot be reac…` | portrait-chromium |
| g2-05 | yes | — | |
| g2-06 | yes | — | |
| g3-01 | yes | — | |
| g3-02 | **no** | **`/kkv.html responds and has a title and description`** | **mobile-390** |
| g3-03 … g3-06 | yes | — | |
| g5-01 | yes | — | |
| g5-02 | **no** | `the instrument is still there, still reading, and …` | mobile-390 |
| | | `the instrument is still there, still reading, and …` | mobile-430 |
| | | `the stage announced at a scroll position does not …` | desktop |
| | | `captures every stage of the journey` | desktop |
| g5-03 … g5-05 | yes | — | |
| g5-06 | **no** | `maps the application into the lead schema` | desktop-1920 |
| g5-icloud | INVALID | — | (not a measurement) |
| g6-01 | **no** | **`/nagyvallalat.html responds and has a title and description`** | **mobile-390** |

## The recurrence

Two of the nineteen runs failed at **the same source line, in the same project,
in the same way, on a different route**:

| | g3-02 | g6-01 |
|---|---|---|
| File | `public-site.spec.ts` | `public-site.spec.ts` |
| Line | **264** | **264** |
| Project | **mobile-390** (WebKit) | **mobile-390** (WebKit) |
| Route | `/kkv.html` | `/nagyvallalat.html` |
| Duration | 30 038 ms | 30 065 ms |
| Error | `page.goto: Test timeout of 30000ms exceeded` | same |
| Call log | `navigating to "http://127.0.0.1:4322/kkv.html", waiting until "load"` — and nothing after | `…/nagyvallalat.html…` — and nothing after |
| Retries | 0 | 0 |
| `lastConfirmedState` | not recorded (predates the fixture) | `GOTO_CALLED` |

g3-02 ran before `navigation-boundary.ts` existed, so it has no bundle. What it
does have is a call log that stops at the same place: the navigation is announced
and no further line is ever written.

## What this settles, and what it does not

**Route identity is not the variable — §21, answered by history rather than by
new executions.** Two different routes, `/kkv.html` and `/nagyvallalat.html`,
produced the identical failure. §34 of the previous workstream had already
refused to treat a route name as a root cause; this is the positive evidence for
that refusal. `/nagyvallalat.html` is not special, and neither is `/kkv.html`.
The route-control arm in `route-controls.md` is run anyway, because a control
that agrees with history is worth more than one skipped on the strength of it.

**The project is constant.** Both are `mobile-390`, the WebKit portrait project.
No Chromium project has ever produced this signature in nineteen runs.

**The test family is constant, and this is where honesty is required.** Both
failures are in the ten-test `structure and content` loop, whose members each do
one thing: create a fresh context, then `page.goto` a route as the test's first
statement. `mobile-390` carries 335 tests, so if the risk were spread evenly
across them, both failures landing in the same ten-test family would be roughly a
3 % coincidence.

That number is interesting and it is **not** evidence, for two reasons that have
to be stated rather than buried: there are only **two** events, and the family
was picked out *after* looking at them. A 3 % coincidence observed post hoc in a
sample of two is a hypothesis worth testing, not a finding. It is treated here as
the former.

## Base rate

`playwright-main` in g6-01: **1 163 passed, 121 skipped, 1 unexpected** across
1 285 tests, in 252 s. Nineteen valid runs, two occurrences of this signature.
On the order of **one per several thousand navigations**, and only ever inside a
full repository gate.

That last clause is the one that matters for §18. The previous workstream
executed **24 010 targeted navigations** and reproduced nothing. That is not a
weak result to be overturned by executing more; it is a measurement, and what it
measures is that the targeted arrangement is missing something the gate has.

## What the gate has that a targeted run does not

From `g6-01`'s own load samples, in the 30 s window of the failure
(`03:32:57.304Z` → `03:33:27.369Z`):

| | |
|---|---|
| `load1` | 5.77 → 4.16, **falling** |
| `swapUsedMB` | 3 462.81, **constant all run** |
| `nodeProcs` | 14, constant |
| `browserProcs` | **42, constant for 115 s spanning the failure** |
| free memory (from the bundle) | **927 MB** |

Concurrently running gates, from `gate.json` durations: `playwright-main`
(252 773 ms) and **`route-audit` (252 778 ms) overlap almost exactly** —
route-audit drives its own browser across 66 routes at 12 viewports while the
main suite runs. `playwright-full` started as `playwright-main` ended and did not
overlap.

So at the moment of failure the host was running five Playwright workers, a
second independent browser workload, 42 browser processes and 3.4 GB of swap,
with under a gigabyte of memory free. Load was *low and falling* — consistent
with the previous workstream's refusal to call this a load failure — while
**memory** was tight.

The 115-second plateau at exactly 42 browser processes is the observation that
most deserves a follow-up: the sampler counts `com.apple.WebKit*` among others,
and WebKit runs a separate `WebContent` process per page. A completely static
count through a period when the suite is creating and destroying contexts is
either coincidental balance at a 5-second sampling interval, or something not
being created. The run's own maximum is 46, so 42 is **not** a hard ceiling, and
that must not be reported as one.

## What this changes about the plan

The targeted reproduction in `targeted-reproduction.md` runs as §18 requires, at
the volumes §18 requires. But the prior it runs against is now explicit: a
one-in-several-thousand event that 24 010 previous targeted navigations failed to
produce, whose only known occurrences are inside a gate whose distinguishing
feature is memory pressure and a second concurrent browser workload — not CPU
load, which was falling at the time.

---

## A self-inflicted invalid stage, recorded rather than quietly re-run

Stage B's first attempt (1 500 executions) came back **INVALID —
`SUBJECT_CHANGED_DURING_RUN`**. The cause was this investigation:

```
group test: HASH_CHANGED
  added:   scripts/hermetic/diagnostics/dispatch-summary.mjs
```

A summary tool was written into `scripts/` while the stage was in flight, and
`scripts/` is in the `test` group. The stage reported zero stalls, and that
number is **not offered as evidence** — an arm whose subject moved is not a
measurement, whatever it happened to report.

It is worth noting what caught it. The file added was a read-only reporting
helper that no arm executes, so its effect on the run was nil. The machinery does
not know that and must not: "the subject moved" is the only claim it is entitled
to make, and it made it. This is the same class as the two self-inflicted
contaminations the previous workstream recorded, caught the same way.

Stage B was re-run afterwards with no edits in flight.

# Targeted reproduction — method and results

§16-§19. Everything below runs against the frozen subject at
`50f70d85b7deb6affdf7fff711297e71b777da56`, whose **product, config and dist
hashes are byte-identical to the sequence the failure occurred in**. Only the
test group differs, and it differs by the instrumentation.

| group | hash | vs the failing sequence |
| --- | --- | --- |
| product | `69106294dc4c1cbd140414c8376cfb0c…` | unchanged |
| test | `e2d38b57b92fc10e2a171d87e05805a0…` | **changed — the recorder** |
| config | `39f6a93856f5b7fb2cb602dfca57ce30…` | unchanged |
| dist | `2cce7616f7f96a0d6ba51fe386f8431c…` | unchanged |

## Why this is not another 24 000-navigation search

§2. The previous WebKit investigation executed 24 010 targeted navigations
across 33 diagnostic arms and reproduced nothing, so volume with the same
instrumentation is known not to work. The new fact is not that more navigations
are available; it is that **a failure has now occurred once inside a proven
hermetic run**, and the deliverable is one failure with a complete bundle.

`scripts/hermetic/nav-stress.mjs` therefore **stops on the first reproduction**
rather than completing a quota, and every stage keeps the hermetic rules: owned
server, dist hashed before and after, `fs.watch` canaries with zero tolerance,
every PID confirmed dead, every port confirmed released. A stage whose subject
moved is INVALID and its numbers are not evidence.

## The arms

| arm | what runs | §17 fidelity |
| --- | --- | --- |
| `real` | `public-site.spec.ts`, whole file, `mobile-390`, 5 workers | complete: the failing contract is reproduced by running the file that contains it, so the two sibling navigations that preceded it in worker 15 precede it here |
| `routes` | the ten parametrised route tests only | same neighbours and same fixture, an order of magnitude cheaper per execution of the target |
| `control` | bare `page.goto('/kkv.html')`, no assertions | §18 — if the raw navigation never fails while the complete contract does, the preceding state is the subject rather than the transport |

The target is matched by title, so a rename is loud rather than silent.

## A discarded run, and what it accidentally proved

The first attempt at the `routes` arm was **destroyed by this investigation**.
A `pkill -f "test-server.mjs 4322"` issued to clear the way for an unrelated
self-test killed the stress run's own server, on the same port, mid-flight.

The run is discarded — its log is kept at
`discarded/stage-A-routes-DISCARDED-server-killed.log` — and it is recorded here
for two reasons.

First, honesty: 34 navigation failures appeared in that window and **none of
them is a reproduction of anything**.

Second, it is an unplanned validation of the recorder against a real fault
nobody designed. All 34 failures, spread across all ten routes, reported:

```
lastConfirmedState = REQUEST_STARTED
```

That is precisely §23's signature — the browser issued the request and the
server never received it — and it is what a dead server must look like. Before
this instrumentation existed, those 34 failures would have been 34 identical
`page.goto timed out` lines, indistinguishable from the failure actually under
investigation. The recorder separated a whole population of self-inflicted
transport failures from the real question, at scale, on the first unplanned
opportunity to do so.

## Results

### Stage A, arm `routes` — VALID

| | |
| --- | --- |
| run | `stress-A-routes-20260819114426` |
| commit | `32d08c4` |
| **executions of the contract** | **500** (5 000 tests: the ten route contracts × 500) |
| **failures of the contract** | **0** |
| failures of any sibling route | 0 |
| duration | 35.3 min |
| subject | **IDENTICAL** — dist `2cce7616…a371d4` before and after |
| canary write events | **0** |
| server | pid 32456 on :4322, confirmed dead, port released |
| **VALID** | **yes** |

**Load: mean 38.72, peak 120.66, min 15.34, over 423 samples.**

That last row is the most informative thing in the table, and it points away
from the obvious hypothesis rather than toward it. §31 already declined to treat
load as the cause, because the original failure occurred at mean load **8.04** —
among the *lower*-load runs of its sequence. This arm ran the identical contract
500 times at a mean load **4.8× higher**, with a peak of 120, and did not
reproduce it once.

Load is therefore not merely unproven as a cause; the one large clean sample
available actively fails to support it. That does not exonerate resource
contention — a specific contention (a socket, a process, a port) is not the same
thing as a high load average — but class C cannot be reached from load figures
alone, and these figures make it less likely rather than more.

### Stage A, arm `control` — VALID (§18)

| | |
| --- | --- |
| run | `stress-A-control-20260819121949` |
| **bare `page.goto('/kkv.html')` executions** | **500** |
| **failures** | **0** |
| duration | 6.2 min |
| subject | IDENTICAL | 
| canary write events | 0 |
| load | mean 46.79, peak 97.27, 74 samples |
| **VALID** | **yes** |

§18 set this arm up to answer one question: *if the raw navigation never fails
while the complete contract does, the preceding state becomes important.*

**The answer is that neither fails.** 500 complete contracts and 500 bare
navigations both came back clean, so the comparison does not discriminate
between transport and preceding state — it discriminates between the targeted
loop and the full suite.

That is a null result, and it is worth stating as one rather than dressed up.
What it does establish is a bound: whatever this failure is, it is **not
reachable by repeating the navigation**, with or without the contract around it,
at a thousand executions and at five times the load of the run that produced it.
The previous investigation's 24 010 navigations said the same thing; this says
it with a recorder attached, so the null is now a measured null rather than an
absent one.

### Stage A, arm `real` — VALID, with a confound this investigation caused

| | |
| --- | --- |
| run | `stress-A-real-20260819122618` |
| **executions of the contract** | **50** (1 450 tests: the whole file × 50) |
| **failures** | **0** |
| duration | 24.7 min |
| subject | IDENTICAL | 
| canary write events | 0 |
| load | **mean 137.41, peak 204.15**, 296 samples |
| **VALID** | **yes** |

**The confound, stated first.** The arm was trimmed from 150 executions to 50
mid-flight by a watcher that killed `nav-stress.mjs`. It killed the runner and
**not the `npm exec playwright` grandchildren**, which survived as orphans with
PPID 1 and kept running for 25 minutes against a server that had already been
shut down. They are what produced the load of 137-204, and they ran alongside
the replacement arm for its entire duration.

The replacement arm is still VALID on its own terms — its subject was
unchanged, its canary silent, its own server confirmed dead and its port
released — and the orphan could not touch any of those. But the environment it
ran in was abnormal, and abnormal because of this investigation rather than
because of anything about the product.

**What it produced, and why it is kept.** 23 failures, all from the orphaned
arm, all reported by the recorder as:

```
lastConfirmedState = REQUEST_STARTED
page.goto: Could not connect to the server.
```

They are quarantined under `discarded/orphaned-150-arm/` and are **not
evidence of anything**. The recorder separated them from real findings on sight
— for the third time in this workstream, and the third distinct self-inflicted
fault (a killed server, a concurrent rebuild, and now an orphaned process tree).
Before this instrumentation existed, every one of those 23 would have been an
indistinguishable `page.goto` timeout in the same file, on the same project, on
several of the same routes.

**Read on its own terms**, the arm says: 50 executions of the *complete file* —
including the WebGL homepage suite in the same workers — at a mean load of 137
and a peak of 204, produced zero failures of the contract.

## Stage A verdict — §35

| arm | executions | failures | mean load | valid |
| --- | --- | --- | --- | --- |
| `routes` — the exact contract | **500** | **0** | 38.72 | yes |
| `control` — bare `page.goto` (§18) | **500** | **0** | 46.79 | yes |
| `real` — the whole file (§17) | **50** | **0** | 137.41 | yes |
| **total executions of the contract** | **550** | **0** | | |

```
NOT REPRODUCED WITH COMPLETE INSTRUMENTATION
```

§35 is explicit about what follows and what does not. It does **not** license
inventing a root cause. It directs the workstream to carry the instrumentation
into the repeated hermetic gate, so that the next naturally occurring failure
yields a boundary.

## Stage B and Stage C — not run, and why

§16 offers Stage B (2 000 more) and Stage C (~5 000 total). Neither was run, and
this is a judgement rather than an omission:

* §16 itself states the goal is "capturing one diagnostically complete failure.
  Not achieving an arbitrary number."
* §2 forbids repeating the previous 24 010-navigation search with the same
  instrumentation, and the instrumentation is what changed — not the navigation
  count available.
* The evidence now says the targeted loop is the **wrong instrument**. 550
  executions of the contract and 500 bare controls, at loads from 38 to 204,
  produced nothing. The prior investigation's 24 010 navigations produced
  nothing. The failure's one observed occurrence was inside a complete
  1 436-test hermetic run.
* The six-run gate executes the exact contract six more times **under precisely
  the conditions that produced the only known occurrence**, and it is required
  by §44 regardless. It is both the higher-yield reproduction arm and the
  mandatory one.

Stage B remains available and would cost roughly two hours; it is recorded here
as a deliberate choice, not a silent drop.

# Gate policy

How this repository decides that work is reviewable, mergeable, or deployable —
and what each of those words is allowed to mean.

This document exists because P2 produced a sentence that was true and a sentence
that was misleading at the same time: "the change surface is green" and "the
suite is green" are different claims, and only the first one was earned. The
policy below makes the two impossible to conflate, by naming them separately and
by refusing to let either be stated from anything but a machine-checked artefact.

---

## 1. The three gates

### CHANGE-SURFACE GATE

**Question.** Do the tests that directly cover the functionality this branch
changed all pass?

**Scope.** The spec files exercising the changed code, named explicitly in the
phase report. Nothing else.

**Passes when.** Every test in that set passes, with zero retries, on every
project the set runs on.

**Does not mean.** That the branch is safe to merge. This gate cannot see a
regression outside its own scope, which is the entire class of defect it is not
looking for.

### REPOSITORY-WIDE REGRESSION GATE

**Question.** Does the whole repository still behave as its tests say it should?

**Scope.** Every collected test, on every project, in one authoritative
aggregate — see §3.

**Passes ("GREEN") when all four hold.**

1. **Arithmetic reconciles.** `passed + failed + flaky + skipped = collected`,
   checked by `scripts/gate-report.mjs`, which exits `2` if it does not. A run
   whose totals do not add up is **INVALID**, not "mostly fine".
2. **Zero failures.**
3. **Zero flaky.** A test that passed on retry is a test whose result depends on
   something other than the source, and this gate exists to exclude exactly that.
4. **Repeatable.** ≥3 consecutive runs of the frozen commit produce the same
   collected count, the same skip count, and the same failure set — checked by
   `scripts/gate-matrix.mjs`, which exits `1` if any failure wanders.

**Fails ("NOT GREEN") when any of those is untrue** — including when every
failure is understood. An explained failure is still a failure. Characterising a
failure establishes *where it lives*; it never converts this gate to GREEN.

### MERGE / DEPLOY GATE

**READY FOR HUMAN REVIEW** — the change-surface gate passes. The work can be
read, argued with, and approved in principle. Nothing about the rest of the
repository is claimed.

**READY FOR MERGE** — the change-surface gate passes **and** the repository-wide
regression gate is GREEN. Both. Neither substitutes for the other, in either
direction: a green repository with a red change surface is not mergeable either.

**READY FOR DEPLOY** — merge-ready, **plus** deployment-specific validation:
`npm run build` from clean, `fingerprint:check`, `scan:secrets`, `audit:seo
--check`, `audit:conversion --check`, and any migration applied and verified in
its own step. Portal database migrations are never applied as part of a test
gate.

---

## 2. Language that is not allowed in a phase report

| Forbidden | Why | Say instead |
| --- | --- | --- |
| "tests mostly green" | Not a state. Hides the count. | The four numbers, and the gate verdict. |
| "only pre-existing failures" | Describes provenance, not status. | "REPOSITORY-WIDE GATE: NOT GREEN. N failures, all pre-existing, listed below." |
| "unrelated flakes" | `flake` is not a classification. | The class from §4, with the evidence that put it there. |
| "the suite passes locally" | Unfalsifiable, and untrue of a run that was never repeated. | "N consecutive runs of `<sha>` produced an identical failure set." |
| "N passed" alone | This is the exact shape of the P2 error. | Always all four numbers plus `collected`. |

A verdict written from terminal scrollback is not a verdict. Every number in a
phase report must be traceable to `final-gate.json`.

---

## 3. The authoritative result

One file: `_build/reports/regression-harness/final-gate.json`, produced by
`scripts/gate-report.mjs` from Playwright's JSON reporter.

It carries the commit it came from, the environment, all five counts, the
reconciliation flag, and every failing test with its project, file, line,
duration and error.

**Rules.**

* **Human reports derive from it.** They never restate numbers from memory or
  from a terminal.
* **One commit per gate result.** A gate file names its commit. Combining runs
  from different commits into one apparent result is forbidden; the commit field
  is what makes an attempt visible.
* **A dirty tree is disclosed.** `gate-report.mjs` records modified tracked files
  (report artefacts excluded) and prints a warning. A gate from a dirty tree may
  be used for investigation and never for a merge decision.
* **Truncated output is not evidence.** `tail`, `head`, and `| grep -c` on a
  Playwright run are banned as the basis for any claim about results. Playwright
  prints its summary *after* its failure list, which is precisely how P2 reported
  a green suite over five broken contracts.

---

## 4. Failure classification

Every failure in a gate report ends in exactly one class. `UNCLASSIFIED` is the
initial state written by the tooling and is not an acceptable final state.

| Class | Meaning |
| --- | --- |
| **A — real product defect** | The application violates an intended contract. |
| **B — real test defect** | The assertion or its mechanism is wrong or stale. |
| **C — load / resource contention** | The product is correct; shared-resource starvation made the harness miss a timing or actionability window. |
| **D — environment-specific limitation** | A property of this machine or this browser build, not of the product. |
| **E — non-deterministic application behaviour** | The product itself produces inconsistent state. |
| **F — unresolved** | Evidence insufficient. **Blocks the gate.** |

"Flaky" is not a class. It is a description of a symptom whose cause has not yet
been found, and it is what this policy exists to stop accepting.

Classes A and B are fixed. C and D are fixed architecturally where possible; when
they cannot be, §5 applies. E blocks the gate. F blocks the gate.

---

## 5. Quarantine — narrow, visible, and rare

A test may be moved out of the repository-wide gate into a separate declared gate
**only** when all four hold:

1. the root cause is **measured**, not assumed;
2. the user-facing contract remains covered — by that test in its new gate, or by
   another test in this one;
3. the environment it needs is genuinely different from the primary suite's;
4. its failures stay **visible** — the separate gate is reported in the phase
   report with its own status, every time.

**Never permitted:** `test.skip` to silence an unexplained failure, retries to
average one away, raised timeouts to outlast one, or a quarantine list that is
not printed in the report. A failure that becomes invisible has not been
quarantined; it has been lost.

---

## 6. Reporting a phase

Every phase report states, separately and in this order:

```
CHANGE-SURFACE GATE:            PASS | FAIL
REPOSITORY-WIDE REGRESSION GATE: GREEN | NOT GREEN
MERGE / DEPLOY:                 APPROVED | NOT APPROVED
```

followed by the five counts, the commit, and — if the repository-wide gate is not
GREEN — every failure with its class from §4.

A phase may be **READY FOR HUMAN REVIEW** while the repository-wide gate is NOT
GREEN. It may never be **READY FOR MERGE** in that state.

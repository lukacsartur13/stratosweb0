# Root cause

§48 permits more than one cause and forbids forcing a single one. There are two
populations here, plus one hypothesis that is formally withdrawn.

---

## Withdrawn: the server

**`page.goto` timeouts are no longer attributed to the test server, and this is
a withdrawal rather than a downgrade.**

The standing account was that Python 3.9's `http.server` (HTTP/1.0, no
keep-alive) dropped connections under five-worker churn. The concurrent arm that
would have tested it had never been run — the serial harness could name Python
but not create the condition, and the concurrent harness could create the
condition but not name Python.

It has now been run. **1 600 concurrent WebKit navigations, five simultaneous
drivers, both the plain 15 KB page and the 1.4 MB WebGL homepage, against both
servers: 1 600 / 1 600 successes.** Python was roughly twice as fast at p50 on
both routes. Full numbers and caveats in `concurrent-python.md`.

Note that this does **not** make `scripts/test-server.mjs` wrong to have shipped.
It fixed a real, measured HTTP/1.0 defect. What is withdrawn is the claim that
that defect explains the remaining tail.

---

## Population A — load-dependent browser-side timing

**Cause: contention for CPU and GPU between five parallel workers, which
inflates Playwright's own actionability and stability waits far more than it
inflates anything the application does.**

The evidence is a segment breakdown of one contract at two load levels
(`lead-forms-investigation.md` §3). At load 96, across 48 instrumented runs:

| Segment | p50 | max |
| --- | --- | --- |
| `locator.click()` — Playwright's actionability wait | 1 390 ms | **5 184 ms** |
| controller: submit → fetch requested | 6 ms | 195 ms |
| network: requested → answered | 200 ms | 1 673 ms |
| render: answered → DOM state changed | 2 ms | 12 ms |

Idle, the same click costs 89 ms. **The application-side segments stay under
1.7 s at their worst while the browser-side wait grows fifty-fold.** This is the
same shape as the SwiftShader finding the previous pass fixed — Playwright
derives element stability from animation frames, so anything that starves frame
production is arithmetic against a fixed budget, not a defect.

Corroboration from the two loaded suite runs of the same commit:

| Run | Peak load | Failures | Concentration |
| --- | --- | --- | --- |
| Loaded run 1 | 96 | **17** | 11 of 17 on `mobile-430` (WebKit) |
| Loaded run 2 | lower | **2** | — |

Same commit, same artefact, an eight-fold difference in failure count driven by
load alone. The concentration on one WebKit project matches the previous pass's
observation that removing the dominant Chromium noise exposed a second,
WebKit-side population.

**Members:** most of the wandering `public-site`, `mobile-homepage-simple` and
`homepage-modality` timeouts. `homepage-modality:96` failed with
`Execution context was destroyed, most likely because of a navigation`, which is
a *navigation race*, not a stall — §21's distinction.

**`lead-forms:177` is NOT a confirmed member.** It did not reproduce in 66
executions and retains 2.3× margin at twice the gate's load. It is carried as
`F — UNRESOLVED` on absence of evidence, not closed.

---

## Population B — `homepage-history:223`, a real and distinct mechanism

**This one is not load arithmetic, and it is not the mechanism currently
documented in the product file.**

The captured failure (`homepage-history-investigation.md` §2):

```
t=  0   reserve read from sessionStorage {"p":"/index.html","h":14072,"w":390}
t= 62   y=  4983   h=14072   reserve=14072px     RESTORE CORRECT
t= 85   DOMContentLoaded / load    y=4983        still correct
t= 87   pageshow  persisted=false  y=4983        still correct
t=208   y= 13408   h=14072   reserve=-           AT THE BOTTOM
```

`13408 = 14072 − 664`, the bottom of a **full-height** document that never
shrank. The restore succeeded and survived every lifecycle event; the position
was lost afterwards, at the frame the reserve was released.

That excludes all four candidates the diagnostic was built to separate: not
"no restore", not "a late reserve", not "clamped into a short parsed shell"
(the documented mechanism — the document was never short), and not "released
before the content grew".

Two further facts:

- **It is the SECOND traversal that fails** — forward, then back again
  (spec `:293`), not the first (`:275`). A diagnostic covering only the first
  Back passed 48/48 and proved nothing.
- The scroll log was **empty**, which turned out to be an instrumentation gap
  rather than a finding: `scrollTop = n` is an assignment and was not wrapped.
  It now is. GSAP `ScrollTrigger` is visible performing a `scrollTo(0,0)` /
  `scrollTo(0,y)` save-restore round trip in the *passing* traces and is the
  leading suspect, but the mutation was not caught in the act after a further
  36 executions, so this is named as a **hypothesis, not a finding**.

**Classification: `F — UNRESOLVED`.** The mechanism is narrowed from four
candidates to one moment — the reserve release on the second traversal — and the
agent that moves the page is not yet named from evidence.

**A separate, contract-satisfying observation:** WebKit shows a systematic
−68 to −83 px restore error where Chromium shows 0, appearing at the same
release frame. Well inside the 200 px tolerance, recorded because it is exactly
the kind of bias a tightened tolerance would convert into a wandering failure.

---

## Population D — a test defect that hides load failures as skips

**`tests/mobile-homepage-simple.spec.ts` silently drops up to 26 tests under
load, and reports green while doing it.**

Twenty-six tests in that file are gated on:

```ts
if (!(await mounted(page))) test.skip(true, 'desktop composition — see the desktop suite below');
```

where

```ts
const mounted = (page: Page) =>
  page.locator('[data-testid="mobile-home"]').count().then((n) => n > 0);
```

`locator.count()` **does not wait**. It is an instantaneous read, unlike almost
every other locator method. So the gate does not ask "is this the desktop
composition?" — it asks "has the React mobile composition mounted *by this
instant*?", and under load the honest answer is often "not yet".

The consequence is that a load-induced failure is converted into a **skip
labelled as an intentional composition difference**. Measured directly: two runs
of the same commit against the same artefact reported

| Run | passed | failed | skipped | collected |
| --- | --- | --- | --- | --- |
| Loaded run 1 (peak load 96) | 1108 | 17 | **146** | 1271 |
| Loaded run 2 (lower load) | 1148 | 2 | **121** | 1271 |

**Twenty-five tests present in one run and absent from the other, on identical
inputs.** The arithmetic reconciles in both — that is the point. This is not a
counting error; it is coverage disappearing correctly-counted.

This is worse than a failing test, because a failure is visible and a skip is
reassuring. It also directly threatens §35, which requires an identical skipped
count across the six authoritative runs.

**Not fixed in this pass, deliberately.** §36 requires the six-run sequence to
restart from RUN 1 on any change to the subject, and the sequence was already
running against a frozen commit when this was found. The correct fix is a
deterministic state wait — resolve *which composition mounted* before deciding,
rather than sampling a race — which §24 explicitly permits and encourages. It
needs its own mutation check per §40 and its own frozen six-run sequence after.

**Classification: real test defect, identified, reproduced, not repaired.**

## Population C — the harness itself, now closed

Not a product cause, but it accounted for a large share of the previous pass's
uninterpretable results and it is the one thing here that is fully resolved.

| Defect | Status |
| --- | --- |
| `dist/` rebuilt by another process mid-run, silently | **Closed** — four-group content hashes + `fs.watch` canaries; proven against a write-and-revert that hashes clean |
| Verdicts derived from truncated terminal output | **Closed** — full logs per gate, arithmetic enforced by `gate-report.mjs` |
| Suites attaching to stale servers from other sessions | **Closed** — the gate owns the server; both configs drop `webServer` under `STRATOS_GATE_SERVER` |
| Orphaned processes surviving runs | **Closed** — PID tracking, liveness and port checks before any verdict; one 17-hour-old orphan found and cleared |
| Contamination detector watched CPU, not the subject | **Closed** — load is recorded and never invalidates; subject mutation invalidates and never merely warns |
| **The 165-test WebGL suite had no machine-readable report at all** | **Closed** — `playwright.full.config.ts` declared `reporter: [['list']]`, so the heaviest suite in the repository could only ever be judged from terminal text. Found by the gate's first authoritative run: `RUN hg-01 INVALID — NO_PLAYWRIGHT_JSON_playwright-full`, with all 165 tests passing. |

The last row is worth dwelling on, because it is the clearest demonstration in
this workstream of what the gate is for.

Every previous "green" verdict on the WebGL suite was read off a terminal. That
is the same arrangement that produced the P2 miscount — the one that started
this entire line of work — still in place, unnoticed, in the suite with the
longest runtime and the most expensive failures.

Nothing failed. 165 tests passed. The gate still refused to issue a verdict,
because results it cannot count are results it cannot vouch for, and a run whose
arithmetic cannot be closed is neither a pass nor a failure. Had it warned
instead of refusing, the sequence would have produced six confident green runs
whose WebGL half was never reconciled — which is exactly the failure mode the
brief was written to end.

---

## What the tail follows

Not the server. Not connection handling. It follows **load, and the browser
under load** — with the single exception of `homepage-history:223`, which is a
real product-side mechanism that happens to surface more often when the machine
is busy.

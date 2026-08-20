# Host-health preflight policy

**Status: prospective.** Written and fixed *before* the first G6 run begins. It
governs when an authoritative repository-wide gate run is allowed to **start**.
It has no authority over a run that has already started.

This file exists because of a specific hazard, not a general wish for tidiness.
G5 produced six valid runs, four green. The two non-green runs correlated
strongly with abnormal host contention — one of them ran at a mean 1-minute load
of 88.15 and a peak of 186.37, against a normal green-run mean of about 6.2,
while `fileproviderd`, iCloud materialisation and interactive application
helpers were consuming the machine. The tempting move after seeing that is to
look at a red run, notice the load, and decide retroactively that it did not
count. That is result-shopping, and it would make every future gate verdict
worthless. The defence is to fix the entry condition *in advance* and then live
with whatever the runs produce.

---

## 1. The rule, in one line

# Host health is a precondition to STARTING an authoritative run.

Once preflight returns `PASS` and the gate begins, **the run counts** — whatever
the host does afterwards.

---

## 2. What is checked, and when

Preflight runs immediately before each authoritative run, and before **any** of:

* starting the gate's test server;
* launching Playwright;
* starting the test suite.

It samples the host three times at five-second intervals, so that a momentary
blip does not fail the check and a sustained storm does. Every check below is
evaluated against those samples.

### A. Repository conditions (§9)

| Check | Requirement |
| --- | --- |
| Worktree root | the hermetic checkout, **not** the iCloud development directory |
| HEAD | exactly the frozen commit |
| product / test / config / dist hashes | exactly the frozen values |
| Worktree mutations | no unexpected change under any hashed path |
| Build watcher | none running |
| Foreign writers | no other process writing to subject paths |

Any failure here means **`PREFLIGHT FAILED — RUN NOT STARTED`**. This is not a
red run; the authoritative run never began.

### B. Port ownership (§10)

Both gate ports (`4322` main, `4327` full) must be free, checked across
**every address family** — `127.0.0.1`, `0.0.0.0`, `::1`, `::` — not merely
`127.0.0.1`. A listener bound to `*` or `::` is invisible to a loopback-only
probe and will happily serve a *different* checkout's tree to this gate's tests.
That is the exact failure mode the dual-address-family probe was added for.

If a required port is held by a process this gate does not own, preflight fails
and the holding PID and command are recorded.

### C. Competing test / build processes (§11)

The gate must own its test workload. Preflight fails if any unrelated instance
of the following is actively executing: Playwright, a browser-automation driver,
a repository build, a bundler, a test watcher, a WebGL benchmark, or a video /
render job.

The detector matches the process names those workloads actually present —
including `chrome-headless-shell` and the other browsers Playwright launches
from its own cache, not merely the word "playwright". A driver process is
frequently idle while the browsers it started are the ones consuming the
machine, so matching only the driver would miss the contention entirely.

**"Actively executing" is defined by CPU, not by presence.** Rivals are grouped
and the group's sustained CPU decides: at or above **5%** the workload is
running and the gate must not start beside it; below that it is recorded as
`idle` and the run may proceed. An automation server holding no work, or a
Finder thumbnail extension parked at zero, contends for nothing, and failing on
its mere existence would make the gate unstartable for no benefit. Idle rivals
are still listed in every report, so the classification hides nothing.

### D. iCloud activity (§12)

`bird` and `fileproviderd` are checked. The requirement is **not** that they be
absent — they are always present on this machine and that is normal. The
requirement is that the authoritative measurement not begin *during an active
heavy synchronisation or materialisation burst*.

Threshold: combined sustained CPU below 50%. Above that, **WAIT**.

System processes are never killed.

### E. Interactive application load (§13)

The machine is not required to have zero applications open — that is not a
realistic operating condition and demanding it would simply push the gate into
never running. What is disqualifying is beginning a performance-sensitive WebGL
regression gate while another application is saturating multiple cores.

Threshold: no single non-gate process at sustained ≥ 150% CPU.

### F. CPU and load (§14)

Recorded every time: 1/5/15-minute load averages, aggregate and idle CPU, and
the major consumers.

The threshold is derived from this host's own clean baseline rather than
invented. Across every green G3 and G5 run, the within-run **quiet floor**
(minimum 1-minute load) fell between 1.62 and 5.06. The start gate is therefore:

> **`load1 ≤ 6.0`** — just above the highest quiet floor ever observed during a
> clean green run on this 10-core machine.

Load alone does not decide. The decision combines three things:

* **current load** — the value above;
* **trend** — a load that is elevated but *falling* (`load1 ≤ load5`) is treated
  differently from one that is climbing. A sharply rising load
  (`load1 > 1.5 × load5`) fails even when under the absolute cap, because it
  means the cause is still spinning up;
* **active cause** — moderately elevated load with no sustained external heavy
  process may be acceptable; a sustained file-provider or interactive-app storm
  is not, regardless of the instantaneous number.

Every PASS or WAIT decision records its reason.

### G. Memory (§15)

Recorded: system-wide free-memory percentage, swap used, and the major memory
consumers. No arbitrary RAM requirement is imposed. The gate does not start
under obvious severe memory pressure likely to distort browser execution.

Threshold: free memory ≥ 20%, i.e. `memory_pressure` not in a warn or critical
state.

---

## 3. PASS / WAIT

Preflight returns one of two things.

**`PASS`** — all checks satisfied. The run may begin, and from that instant the
run counts.

**`WAIT`** — the host is temporarily unsuitable. No run begins. The attempt is
recorded as a preflight attempt, the checker waits for conditions to settle, and
preflight is run again. A `WAIT` is **not** a G6 run, is not red, and is not
counted in the three-run sequence. Both the failed attempt and the later passing
attempt are recorded (§17).

A repository-condition failure is reported as
`PREFLIGHT FAILED — RUN NOT STARTED` rather than `WAIT`, because waiting will
not fix a wrong commit or a mutated subject.

---

## 4. What does NOT invalidate an already-started run

This is the half of the policy that stops it becoming result-shopping.

Once a run has begun after a passing preflight, **none of the following
invalidates it**:

* CPU spiking;
* load rising, to any value, including beyond the G5 outlier;
* a background process waking up;
* iCloud beginning to synchronise;
* an interactive application saturating cores;
* the run taking substantially longer than its predecessors.

A run that becomes red under those conditions is **VALID and RED**. It stands,
it is reported, and it fails the sequence.

There is no "extreme load" retroactive exemption (§37). The entire purpose of a
prospective preflight is to remove the subjective post-hoc judgement that such
an exemption would require.

## 5. What DOES invalidate an already-started run

Only the pre-existing hermetic validity conditions, none of which are about host
load:

* the test subject mutating mid-run;
* a canary write;
* server-ownership failure — the gate serving a tree it does not own;
* a hash mismatch before versus after;
* harness corruption, or arithmetic that does not reconcile.

An `INVALID` run is neither a pass nor a failure. It does not consume a slot in
the sequence. The environmental integrity problem is fixed *before* a
replacement attempt begins.

---

## 6. Preflight failure versus run failure

The distinction this policy turns on:

| | Preflight failure | Run failure |
| --- | --- | --- |
| When | before the gate starts | after the gate started |
| Meaning | the host was unfit to begin measuring | the subject did not pass |
| Counts as a G6 run | **no** | **yes** |
| Recorded | as a `WAIT` / `NOT STARTED` attempt | as `VALID + RED` |
| Remedy | wait, re-check, then start | classify the failing contract |

---

## 7. An honest limitation

This policy would probably not have prevented g5-02.

The load data show that run's *within-run minimum* was 5.27 — under the 6.0 cap.
Its mean of 88.15 was reached during the run, not before it. A load-only start
gate would very likely have passed it, and then §4 would have required the red
result to stand.

What might have caught it is check **D** or **E** — the sustained external
process composition — if the storm had already been underway at start time. That
is why the policy is not a single load number, and why the composition checks
are not decoration.

It follows that G6 passing three times is evidence that the frozen subject is
repeatable **within this documented operating envelope**. It is not a proof that
the site cannot fail under arbitrary contention, and this policy does not claim
to be one.

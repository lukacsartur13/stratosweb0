# G6 — host-health preflight summary

Every preflight attempt made during G6, in order. Policy:
[`host-health-policy.md`](../host-health-policy.md), written and fixed before
the first attempt.

Only **one** authoritative run was ever started, because `g6-01` came back RED
and the pre-registered stop rule forbids continuing to hunt for green (§35).
`g6-02` and `g6-03` therefore have no preflight rows: they were never reached.

## Attempts

| # | Attempt | Time | Verdict | load1 / 5 / 15 | Free mem | Swap | `bird`+`fileproviderd` | Ports 4322 / 4327 | Worktree | Subject hashes | Blocking check |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | tool validation | 03:1xZ | `WAIT` | 1.62 / 1.96 / 1.93 | 55% | 3462.81 MB | 0.0% | free / free | hermetic ✅ | intact ✅ | competing automation workload |
| 1 | `g6-01` preflight | 03:2xZ | `WAIT` | 1.37 / 1.77 / 1.85 | 50% | 3462.81 MB | 0.0% | free / free | hermetic ✅ | intact ✅ | `chrome-headless-shell` 34.6% sustained |
| 2 | `g6-01` preflight | 03:25:45Z | **`PASS`** | 1.22 / 1.60 / 1.77 | 55% | 3462.81 MB | 0.0% | free / free | hermetic ✅ | intact ✅ | — (18/18 checks) |

Attempt 0 ran the checker against a scratch output directory to validate the
tool itself; it is included because it is a real observation of the host and
because omitting an inconvenient reading is exactly the habit this policy exists
to prevent.

## The WAIT decisions, and why

Both WAITs were the same cause: **`chrome-headless-shell` processes left over
from an unrelated Playwright automation server**, sustaining 34.6% CPU across
three samples (16.6% + 18.0%). Nothing was killed. The workload was allowed to
settle, observed falling to 0.0% sustained over three consecutive samples, and
preflight was then re-run.

Two things are worth recording about this, because both were nearly missed:

* The first version of the detector matched only the string `playwright`. The
  **driver** processes were idle at 0.0%; the **browsers they had started** were
  the ones consuming the machine. Matching only the driver would have returned
  `PASS` and started an authoritative WebGL regression gate alongside a live
  browser workload. The detector was widened to the browser binaries before any
  run began.
* Presence alone is not disqualifying. The definition used is sustained group
  CPU ≥ 5%, so idle automation servers and a parked Finder thumbnail extension
  do not make the gate unstartable. Idle rivals are still listed in every
  report.

## The PASS decision, and why

Attempt 2 satisfied all 18 checks:

| Section | Check | Reading |
| --- | --- | --- |
| A | worktree is the hermetic checkout, not iCloud | `/Users/arturlukacs/stratos-hermetic/subject` ✅ |
| A | HEAD | `48811e991089dd8cb73f23ec1c6ae880446cff6f` ✅ |
| A | product / test / config / dist hashes | all four match the frozen subject ✅ |
| A | no mutation under any hashed path | none ✅ |
| A | no build watcher, no foreign writer | none ✅ |
| B | ports 4322 and 4327, all address families | free on `127.0.0.1`, `0.0.0.0`, `::1`, `::` ✅ |
| C | competing test / build / render workload | none actively executing ✅ |
| D | `bird` + `fileproviderd` | 0.0% sustained ✅ |
| E | any single process saturating cores | none ≥ 150% sustained ✅ |
| F | load absolute | load1 max 1.24, cap 6.0 ✅ |
| F | load trend | 1.22 against load5 1.60 — falling, not rising ✅ |
| G | memory | 55% free, no severe pressure ✅ |

The run started at **03:25:45Z**. From that instant it counted.

## What happened after the run started

Load during `g6-01` rose to a mean of 5.50 and a peak of 11.28 — entirely normal
for this host, and comparable to the quietest G5 runs (6.20 / 11.50). At the
moment of the single failure the boundary recorder logged a load average of
4.17 / 3.63 / 2.65 and 927 MB free.

**This run was not quiet-host-marginal.** It failed on a well-behaved host, and
that is the substantive finding of G6.

## Known bookkeeping defect

Attempt 1's JSON was **overwritten**. It was run manually with the attempt id
`g6-01-preflight-1`; the sequence driver then reused that same id for its own
first attempt, which passed, and the PASS record replaced the WAIT record on
disk. §17 requires both to be recorded, so the WAIT has been reconstructed from
the checker's console output into
[`g6-01-preflight-wait-reconstructed.json`](preflight/g6-01-preflight-wait-reconstructed.json),
explicitly flagged as reconstructed rather than presented as an original
artefact.

The driver should namespace preflight attempt ids per invocation. It has not
been changed here, because changing the harness after a sequence has produced a
result is how evidence gets contaminated; it is recorded as a defect to fix
before the next sequence.

## Files

| | |
| --- | --- |
| Tool-validation WAIT | [`preflight/g6-00-tool-validation-wait.json`](preflight/g6-00-tool-validation-wait.json) |
| `g6-01` WAIT (reconstructed) | [`preflight/g6-01-preflight-wait-reconstructed.json`](preflight/g6-01-preflight-wait-reconstructed.json) |
| `g6-01` PASS | [`preflight/g6-01-preflight-1.json`](preflight/g6-01-preflight-1.json) |
| `g6-01` PASS manifest | [`preflight/g6-01-preflight-1-manifest.json`](preflight/g6-01-preflight-1-manifest.json) |

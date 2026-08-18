# Hermetic gate policy

The rules a repository-wide gate result must satisfy before it may be believed.
Every one of them is enforced by a program; none depends on someone remembering.

## 1. A run is VALID, INVALID, or nothing

`INVALID` is **not a failure and not a pass** (§38). It contributes nothing to a
green rate, a failure frequency, or a root-cause conclusion. It is discarded and
replaced, and the replacement count is published so the cost of the invalid runs
is visible.

`scripts/hermetic/gate-run.mjs` marks a run INVALID for any of:

| Reason | Detected by |
| --- | --- |
| `SUBJECT_MUTATED_DURING_RUN` | before/after content hashes differ |
| `CANARY_WRITES_DURING_RUN=n` | `fs.watch` saw a write while armed |
| `DIST_NOT_FROZEN_REFERENCE` | built artefact ≠ `--expect-dist` |
| `BUILD_FAILED` | build exited non-zero |
| `SERVER_START_FAILED` / `SERVER_DIED_BEFORE_<gate>` | owned server lifecycle |
| `ARITHMETIC_MISMATCH_<gate>` | `gate-report.mjs` could not reconcile |
| `NO_PLAYWRIGHT_JSON_<gate>` / `NO_GATE_REPORT_<gate>` | results were lost |
| `ORPHANED_PROCESSES=n` | a process the gate started is still alive |
| `PORTS_STILL_HELD=…` | a gate port is still listening at the end |
| `COMMIT_DRIFT` | the run's commit ≠ the sequence's commit (§36) |

**High load never invalidates a run** (§12). It is recorded on every run —
mean, peak, swap, browser-process count, sampled every 5 s — because a failure
that only occurs above load 40 is a different finding from one that occurs at
rest, and that distinction is unrecoverable after the fact.

## 2. Hashes AND canaries, and neither is redundant

The hashes say **whether** the subject differs. The watchers say **whether it
was ever touched**. A file written and written back hashes identically at both
ends and was still a mutation of the served tree during the run (§43).

Proven, not assumed: appending to `dist/index.html` 20 s into a run and
reverting it 2 s later produced `subject IDENTICAL` on both hashes and
`RUN canary-proof2  INVALID … CANARY_WRITES_DURING_RUN=2`. A final hash alone
would have called that run clean.

## 3. Four hash groups, not one

`product`, `test`, `config`, `dist`. One aggregate would say a run was invalid;
four say **what** touched it, which is the difference between "discard this run"
and "stop the process writing to `dist`".

**Excluded, and why:** `_build/reports/**` and `test-results/**` (the gate writes
there while it runs, so hashing them would make every run invalidate itself);
`node_modules/**` (~50 000 files — frozen by the lockfiles, which *are* hashed).
That last exclusion is a **stated limitation**: a dependency mutated in place
without touching a lockfile would not be caught.

## 4. The build is a declared window, not an exception

§51 requires the production build as a gate; §7 requires the artefact to be
immutable. Both are honoured: the build runs in a declared window at the start
of each run, and the artefact it produces **must hash identically to the frozen
reference**. Canaries arm when the window closes.

This is strictly stronger than skipping the build. Skipping proves the artefact
did not change because nothing touched it; building proves it is *reproducible
from the frozen source* and is the same artefact. Verified: two independent
builds from frozen source produce byte-identical `dist` trees, and a build after
reverting a deliberate source mutation returned the hash to `2cce7616` exactly.

## 5. One owner of the server

The gate starts the servers, records PID / port / start / ready / shutdown /
exit code, and confirms both the process and the port are released before a
verdict may be produced.

Both Playwright configs therefore **drop** their `webServer` block under
`STRATOS_GATE_SERVER` rather than setting `reuseExistingServer: false`. With the
option merely false, Playwright still owns a server, still races the port, and
still has to decide what to do about one that is already listening — and
"already listening" is exactly how the previous investigation ended up attached
to a seventeen-hour-old server serving a different checkout.

## 6. Arithmetic, by a program

`passed + failed + flaky + skipped === collected`, checked by
`scripts/gate-report.mjs`, which exits 2 if it does not reconcile. A verdict
cannot be written from a file that does not add up, and no human-written report
may override it (§30).

`gate-report.mjs` additionally refuses the artefact of `playwright test --list`,
which reports every test as skipped with no results — a file that reconciles
perfectly and represents a suite that never ran.

## 7. No output is truncated

Every gate's complete stdout and stderr is written to
`_build/reports/hermetic-gate/runs/<run-id>/logs/<gate>.log`. Nothing is piped
through `tail`; no verdict is derived from terminal scrollback. The P2 miscount
that started all of this was a `tail -6` of output that printed the failures
before the reassuring summary.

## 8. What may never be used to make a gate green

Forbidden outright (§24, §25, §23):

- raising a timeout;
- adding retries (`retries: 0` is stated in the config, with the reason);
- `waitForTimeout` padding;
- `force: true`;
- global serial mode purely to obtain green;
- broad `test.skip`;
- weakening an assertion or a tolerance;
- reducing workers as the fix;
- deleting WebKit, `mobile-390`, lead, history or public-homepage coverage.

Replacing a wall-clock assumption with a **deterministic state wait** is allowed
and encouraged, and must be documented where it is done.

## 9. Failure records

No surviving failure may be reported as `Timeout 30000ms exceeded`. Each carries
test, run id, project, viewport, duration, **last confirmed event**, subject hash
status, server state and environment load (§21, §22). The boundary is named from
surviving artefacts, never inferred from the test's name.

## 10. Acceptance

Six runs, one frozen commit, identical `product` / `test` / `config` / `dist`
hashes, all six VALID.

The question is **identity**, not the green rate. Six runs that all fail the same
test at the same contract is a better result than five green and one failing
somewhere new: the first can be fixed, the second cannot be trusted. "Mostly
green" is not an outcome (§37).

A changed commit resets the sequence to RUN 1 (§36). Earlier runs are never
carried across.

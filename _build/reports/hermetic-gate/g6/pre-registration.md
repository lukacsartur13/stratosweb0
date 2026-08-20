# G6 — pre-registration

**Written before `g6-01` begins.** Recorded so that the closure criterion cannot
be adjusted after seeing results.

## The subject

| | |
| --- | --- |
| Worktree | `/Users/arturlukacs/stratos-hermetic/subject` |
| Commit | `48811e991089dd8cb73f23ec1c6ae880446cff6f` |
| product | `088c02849aad0e870111fab16585dac6a1caf4fcd1b99893e1e5511682547c84` |
| test | `2d561c3320f5c51b2432ae96d81782fc337ee30d864cc41daa5f2093e8165a8e` |
| config | `94c5bf52ccac846c9bb8149f8cda1d55cb78d51c32db5fcc798411cd611b326b` |
| dist | `2538acb4918470f2d172c66df16737819bb41668936f7301fec65cfc396783c3` (186 files) |
| combined | `660f76198c30f6f9a843908ef2cf822b6b5701bfdacc93e6d630311b6b5db269` |

Identical to the subject that completed G5. Nothing is rebuilt, edited or
reconfigured for G6.

## The criterion — fixed in advance

# THREE consecutive authoritative runs: `g6-01`, `g6-02`, `g6-03`.

Success requires **all** of:

* three runs started after a **passing prospective host-health preflight**;
* all three `VALID`;
* all three `GREEN`;
* identical commit / product / test / config / dist hash across all three;
* identical collected count;
* identical skip set **by identity hash**, not by count;
* arithmetic reconciled in both suites;
* zero unexplained failures;
* zero subject mutations;
* zero canary writes;
* zero orphaned processes and zero ports still held.

Expected invariants, carried from G5:

| | Expected |
| --- | --- |
| collected (main) | 1285 |
| collected (WebGL/full) | 165 |
| collected (total) | 1450 |
| skipped (total) | 155 |
| skip-set hash | `bb65b6846f9975fa5b2cb3a73439adc1ae56ab8e09933c6dbaf43fb05a837cee` |

## Why three, and not six

G6 is not re-proving the harness from zero. Already established by earlier
sequences and not re-litigated here: immutable-subject enforcement, run-output
independence, renderer correctness, exact skip-set tracking, arithmetic closure,
Portal determinism, machine-readable WebGL reporting, lead-defect regression
coverage, and the mutation protections.

G6 tests one narrower unresolved question:

> Does the existing frozen subject produce repeatable green repository-wide
> results when the authoritative run **begins** on a controlled host?

Three consecutive runs are the predefined closure criterion for that question.

## Stop conditions — also fixed in advance

* If all three are valid and green → **G6 complete**. Stop. No G7, no further
  sequence, no additional stress work.
* If any valid run is **red** → the predefined sequence **fails**. Record
  `G6 CLOSURE GATE: NOT GREEN`. Do **not** rerun for a better result. The red
  run is not silently replaced.
* If a run is **INVALID** → it does not consume a slot. Fix the environmental
  integrity problem, then begin a replacement attempt.

## Out of scope

The in-flight `experiments/src/full/content.ts` Rapidkert metric edit and the
`full-ascent.spec.ts` assertion in the iCloud development checkout are **not**
part of this subject and are not touched. See the final report.

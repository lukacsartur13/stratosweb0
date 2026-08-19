# Run-output independence

*A repeated-run gate measures nothing if run N can change the result of run N+1.
This is the defect that broke that property, the fix, and the proof that the fix
is now guarded.*

---

## 1. The cascade, as it happened

`g4` was stopped after three runs. The third was discarded, and not because of
anything in the product:

| Run | Result | Reason |
| --- | --- | --- |
| `g4-01` | VALID + GREEN | — |
| `g4-02` | VALID + RED | a real `lead.js` product defect (see [`../lead-silent-drop/`](../lead-silent-drop/final-report.md)) |
| `g4-03` | NOT ACCEPTABLE AS INDEPENDENT EVIDENCE | its `secret-scan` gate was red **because of run 2's output** |

The mechanism, in four steps:

1. Run 2 failed a test in `tests/lead-forms.spec.ts`.
2. Playwright's JSON reporter writes the failing test's **source line** and error
   text into the run's report. The line it quoted is the `not.toMatch` in
   `expectWellFormed` that names the Web3Forms endpoint and the form access-key
   field — an assertion that the deployed bundle carries neither.

   *(Written out that way on purpose. Quoting the regex verbatim here would put
   the literal into an authored report, and authored reports are still scanned —
   §5. The first draft of this file did quote it, and the scanner caught it,
   which is the boundary working exactly as intended. The remedy was to
   paraphrase, not to add an exemption.)*
3. That report was written to
   `_build/reports/hermetic-gate/runs/g4-02/playwright-main.json`.
4. Run 3's `secret-scan` gate walked the whole repository, read that file, and
   reported six findings — for the words in an assertion whose entire purpose is
   to forbid those words.

`tests/lead-forms.spec.ts` was **already** exempt: it is in the scanner's
`DESCRIBES_THE_RULE` set precisely because it names the rule in order to forbid
it. But the exemption is keyed on the **authored path**, and quoting the same
text into a generated artefact brought the finding back from the dead.

## 2. Why this violated repeated-run independence

The artefact **persists**. It is not deleted between runs, and every run walks
the whole tree. So:

* run 3 was red because of run 2;
* run 4, 5 and 6 would have been red for the same reason;
* and the redness had nothing to do with the frozen subject under test.

A sequence of six runs is evidence about one subject only if the six are
independent trials. Once run N's output is run N+1's input, they are one trial
with five echoes. §26 states the requirement directly:

> **A previous run's output cannot change the result of the next run.**

Worse than a false positive: the failure is *self-sustaining*. The one thing
that would have cleared it — a green run — could not happen, because the
artefact that caused it was already on disk.

## 3. The fix — `b7d67a2`

`scripts/secret-scan.mjs` skips a set of machine-written trees during the walk,
excluded **by path prefix**:

```js
const isGenerated = (rel) => GENERATED_TREES.some((p) => rel === p || rel.startsWith(`${p}/`));
…
if (isGenerated(relative(ROOT, path))) continue;
```

That commit is preserved unchanged. This workstream extends the list after the
§27 audit below; it does not alter the mechanism.

## 4. §27 audit — every gate artefact, not only the secret scan

The question asked of each gate: *can this consume an artefact that a previous
run wrote, and can what it consumes depend on that run's result?*

| Gate | Reads | Can run N's output reach it? | Verdict |
| --- | --- | --- | --- |
| `typecheck` | `portal/src`, `experiments/src`, tsconfigs | no — no run writes there | clean |
| `fingerprint-check` | `dist` | no — `dist` is rebuilt from frozen source and hash-checked | clean |
| `draco-check` | `dist`, `assets` | no | clean |
| `secret-scan` | **every text file in the repository** | **yes** — this was the defect | fixed, excluded by prefix |
| `seo-audit --check` | `dist` | writes `phase9-seo-audit.json`, never reads it back; verdict is recomputed from `dist` each time | write-only, clean |
| `conversion-audit --check` | `dist` | writes `phase9-conversion-audit.json`, never reads it back | write-only, clean |
| `route-audit` | `_build/routes.json`, `dist` | writes `phase8-route-audit.json`, never reads it back | write-only, clean |
| `playwright-main` / `playwright-full` | `testDir: ./tests`, `dist` | test discovery globs `tests/` only; no run writes there | clean |
| `gate-report.mjs` | the run's **own** JSON, by explicit path | own run only | clean |
| `manifest.mjs` | `product`, `test`, `config`, `dist` groups | `_build/reports` is in **none** of them, so no generated report can move a subject hash | clean |

Two properties do the work:

* **Nothing reads its own previous output.** The three `--check` audits are
  write-only with respect to their reports; each verdict is recomputed from
  `dist`.
* **The only artefacts whose *content depends on a run's result* are the
  Playwright JSON reports and the gate's own `gate.json` and logs.** Those are
  the files that can quote arbitrary source back at a scanner, and they are the
  entire contents of the excluded list.

### Gaps found by this audit, and closed

The original fix listed four paths. Two more were live and missing:

| Path | Why it was missing, and why it matters |
| --- | --- |
| `_build/reports/regression-harness/last-full-run.json` | The **WebGL suite's** default JSON report — the exact sibling of `last-run.json`, which was already excluded. `playwright.full.config.ts` writes here whenever the gate does not override the path. Same cascade, one config file over. |
| `_build/reports/lead-silent-drop/stress` | This workstream's targeted stress reports — Playwright JSON, from the lead suite, which is the suite whose source names the rules. |

Two frozen trees from earlier workstreams were added for consistency rather than
because they currently match anything:
`_build/reports/mobile-test-reconciliation` and
`_build/reports/webkit-navigation/suite`. Both are Playwright JSON in full.

## 5. §28 — the boundary, and why it is not `_build/reports/**`

**The rule: a path is excluded when every byte in it is written by a test runner
or by the gate, and none of it is ever typed by a person.**

That is deliberately not "anything under `_build/reports`". Most of that
directory is hand-written analysis, and a credential pasted into one of those
reports has to stay a finding. The distinction is already load-bearing in the
scanner: `_build/reports/phase9-dependency-audit.md` is an authored report that
quotes this scanner's own rules in a table, and it is exempt **by name**, not by
living in the same tree.

| Category | Example | Scanned? |
| --- | --- | --- |
| Repository source and config | `assets/js/**`, `netlify/**`, `supabase/**`, `package.json` | **yes** |
| Built output | `dist/**` | **yes** — it is what ships |
| Authored reports and prose | `_build/reports/*.md`, `_build/reports/hermetic-gate/*.md` | **yes** |
| Authored report that names the rules | `_build/reports/phase9-dependency-audit.md` | exempt **by name** |
| Runner-written JSON artefacts | the eight paths in `GENERATED_TREES` | **no** |

955 of 1 020 files are still walked.

## 6. §29 / §30 — the regression, and the proof that it bites

`tests/gate-independence.spec.ts`, in the `node` project, so it runs once per
gate rather than once per viewport. It uses **no real secret**: the fixture is
assembled from fragments at runtime — the field name that caused the g4-03
cascade, and a syntactically shaped but invented AWS key id. Assembling it means
the spec file itself contains no literal the scanner would match, so it needs no
exemption of its own; an exemption is a hole, and a test about not going blind
should not open one.

Three assertions, in two tests:

1. **Independence.** A synthetic failure artefact written into
   `_build/reports/hermetic-gate/runs/…` must not make the source scan red.
2. **Not a switched-off scanner.** The same bytes, written one directory
   *outside* the excluded prefix — a sibling of `runs/` under the same reports
   directory — must still be a finding, named in the output.
3. **Shape.** `GENERATED_TREES` must contain no entry that also holds authored
   files (`_build`, `_build/reports`, `_build/reports/hermetic-gate`, `tests`,
   `scripts`, `dist`, `.`).

Assertions 1 and 2 are **one test**, not two, and that is deliberate: assertion 2
makes the repository-wide scan red for as long as its fixture exists, while
assertion 1 asserts the scan is green. Run in parallel in the same worker pool,
each is the other's false result — which is how the first draft of this file
failed. Splitting them would need `mode: 'serial'`, and a serial failure turns
the second test into a SKIP; a skip set that changes when a test fails is
precisely what §54 forbids the gate to have.

### Mutation check (§30)

| # | Mutation | Expected | Actual | Detected |
| --- | --- | --- | --- | --- |
| D | Remove `if (isGenerated(…)) continue;` from `walk()` — the exact pre-`b7d67a2` state | independence test red | `run N's generated artefact made run N+1's source scan red` | **YES** |
| E | Widen `GENERATED_TREES[0]` to `'_build/reports'` | both tests red | `a credential in an authored report was not caught` **and** `GENERATED_TREES exempts '_build/reports', which holds authored files` | **YES** |

Mutation D proves `b7d67a2` is guarded. Mutation E proves the guard cannot be
satisfied by turning the scanner off, which is the §28 failure mode.

Both reverted. `scripts/secret-scan.mjs` restored to
`3b8d6aa6f536092022242ee7db9fa8404851ecaad12c5d2ec48926dd075107a4`, and the
diff against `b7d67a2` is the `GENERATED_TREES` extension and its comment only.

## 7. §41 — run output isolation in `g5`

Unchanged from the existing design and re-confirmed here:

* every run writes to its own `_build/reports/hermetic-gate/runs/g5-NN/`;
* that whole tree is excluded from the scanner's walk;
* it is in no `manifest.mjs` group, so nothing written there can move the
  product, test, config or `dist` hash;
* it is not a canary target, so writing there is not a subject mutation;
* and nothing in the gate list reads it except `gate-report.mjs`, which is
  given its own run's path explicitly.

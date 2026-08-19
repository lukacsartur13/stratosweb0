# The g5 frozen subject

*§32 and §35. `assets/js/lead.js` changed, so every hash from the `g2`, `g3` and
`g4` sequences is historical. Nothing below may be compared against them as an
active subject.*

## Commit

| | |
| --- | --- |
| Branch | `portal-p1-control-room` |
| HEAD | `48811e991089dd8cb73f23ec1c6ae880446cff6f` |

```
48811e9  docs: record the lead defect and the run-independence boundary
c24939c  fix: refuse a port a stranger is already holding
54bfdc1  test: verify hermetic run-output independence
99e3a92  test: lock the lead fill-time contract against a moving clock
e299ac3  fix: prevent lead submission silent drop
b7d67a2  fix: stop the secret scan reading the gate's own run artefacts   (preserved)
```

## Where the sequence runs, and why not in the development checkout

| | |
| --- | --- |
| Hermetic subject | `/Users/arturlukacs/stratos-hermetic/subject` — `git worktree`, detached at `48811e9` |
| Development checkout | `~/Library/Mobile Documents/com~apple~CloudDocs/Downloads/StratosWeb` |

This is the arrangement `_build/reports/hermetic-gate/environment.md` established
and it is **load-bearing**, which this workstream re-proved the expensive way.

A first `g5-01` was run in the development checkout, in place. Every one of its
nine gates passed — `playwright-main 1164/1285, 0 failed, 121 skipped`;
`playwright-full 131/165, 0 failed, 34 skipped` — and the run was still
**INVALID**:

```
INVALID: SUBJECT_MUTATED_DURING_RUN
INVALID: CANARY_WRITES_DURING_RUN=699
```

`dist` went from **188 files to 310** during the run, and 438 of the canary
events were writes to 212 genuine `dist` files whose content never changed. The
cause is `bird`, the iCloud sync daemon: the development checkout lives under
`~/Library/Mobile Documents`, the run had just deleted and rebuilt `dist`
wholesale, and iCloud responded by rewriting every file and re-materialising 93
`thing 2.ext` conflict copies — for minutes, asynchronously, in the middle of the
gate.

The gate was **right**. That is a subject mutation by any definition it can
apply, and it is exactly the class of foreign interference §27 exists to refuse.
The fix is not to loosen the canary but to run where the interference does not
happen. That attempt is kept as
`_build/reports/hermetic-gate/runs/g5-icloud-invalid-attempt/` and is **not**
part of the sequence.

In the hermetic subject the same run produces **0 canary write events** and
**0 iCloud duplicates in `dist`**.

## Hashes — `frozen-reference.json`, hermetic subject

| Group | SHA-256 | Files |
| --- | --- | ---: |
| **combined** | `660f76198c30f6f9a843908ef2cf822b6b5701bfdacc93e6d630311b6b5db269` | — |
| product | `088c02849aad0e870111fab16585dac6a1caf4fcd1b99893e1e5511682547c84` | 304 |
| test | `2d561c3320f5c51b2432ae96d81782fc337ee30d864cc41daa5f2093e8165a8e` | 66 |
| config | `94c5bf52ccac846c9bb8149f8cda1d55cb78d51c32db5fcc798411cd611b326b` | 14 |
| **dist** | `2538acb4918470f2d172c66df16737819bb41668936f7301fec65cfc396783c3` | 186 |

Every `g5` run must reproduce the `dist` hash exactly
(`gate-run.mjs --expect-dist`); a run that builds different bytes is INVALID and
does not count.

The `product` and `test` file counts are lower than the development checkout's
346 and 74. That is the point of a worktree at a commit: the checkout carries
uncommitted in-flight work and iCloud conflict duplicates (`lead-forms.spec 2.ts`
and friends), and neither is part of the subject. `config` is identical in both,
which is the cross-check that nothing structural differs.

## §34 — the fix is in the shipped artefact

`dist/` was deleted and rebuilt from clean source in the subject, not carried
over from before the product change.

| | |
| --- | --- |
| `assets/js/lead.js` | `41d424a50e5ba13274b1b9f1861b949931b59435190a5286bd9ffe8556195f63` |
| `dist/assets/js/lead.js` | `41d424a50e5ba13274b1b9f1861b949931b59435190a5286bd9ffe8556195f63` |
| Fingerprint stamp in every page | `assets/js/lead.js?v=41d424a5` (was `?v=38e4c1d7`) |
| `monotonicNow` occurrences in the shipped file | 6 |

Source and built artefact are byte-identical, the served URL changed, and the
§46 canary in `tests/lead-forms.spec.ts` asserts the corrected shape against
`dist/` directly — so "source changed but the served bundle did not" cannot pass.

## Build

| | |
| --- | --- |
| Sequence | `rm -rf dist test-results` → `npm run build` → `npm run build:full` → hash → freeze |
| Freeze timestamp | 2026-08-19T18:07Z |
| Node | v24.18.1 |
| Python | 3.9.6 |
| Playwright | 1.62.1 |
| `package-lock.json` | `a9c752390419aff3ce9c91a0d234479ebae5084c9645e82ea49746946a937a50` |
| Platform | darwin-arm64, macOS 25.6.0, `/dev/disk3s5` |

The build is byte-for-byte deterministic, which is why `six-run.mjs` rebuilds on
every run and requires the same `dist` hash rather than skipping the build. A
build that stopped being reproducible is caught immediately instead of quietly
serving six subtly different artefacts.

## §53 — why the collected count is not g3's

| Suite | g3 | g5 | Δ |
| --- | ---: | ---: | ---: |
| `playwright-main` collected | 1271 | 1285 | **+14** |
| `playwright-main` skipped | 121 | 121 | 0 |
| `playwright-full` collected | 165 | 165 | 0 |
| `playwright-full` skipped | 34 | 34 | 0 |

The +14 reconciles exactly, with nothing left over:

* `tests/lead-forms.spec.ts` — three new tests (two behavioural, one dist
  canary) across the four projects that carry the file: **12**
* `tests/gate-independence.spec.ts` — two tests, registered in `NODE_ONLY` so it
  runs once rather than once per viewport: **2**

Historical totals are not required (§53); what is required is that all six g5
runs agree, and they do.

## One thing that is deliberately NOT in this subject

`experiments/src/full/content.ts` and its `en`/`de` locale files carry
uncommitted in-flight work adding a sourced Rapidkert metric, while
`experiments/tests/full-ascent.spec.ts:388` still asserts `.case__metric` has
count 0 — two deterministic WebGL failures on `desktop` and `reduced-motion`,
unrelated to the lead defect and to every commit above.

It is excluded **by construction**, not by intervention: the subject is a
worktree at `48811e9`, and uncommitted work in another working tree is not part
of a commit. The development checkout is untouched and still carries it.

**That disagreement is a real open item.** It is simply not this one, and
resolving it means deciding whether the metric or the assertion is right —
somebody's editorial call, not a gate's.

## What is NOT in this subject

* No push, no merge, no deploy, no migration.
* No Portal P3.
* No change to the lead envelope, the per-form schemas, the honeypot, the
  submission-id idempotency, the backend contract, or the compatibility adapter.
* No change to the server's `MIN_FILL_MS`, to `dropSilently`, or to any request
  timeout.
* No change to analytics, consent, or the GA4 PII guard.
* No change to renderer settings: ANGLE Metal stays selected for the Chromium
  projects, asserted by `tests/harness.spec.ts`.

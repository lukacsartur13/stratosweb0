# The manifest gap — §3, §4, §5, §46

Status: **CLOSED, and mutation-checked in both directions.**

## What the claim was, and what the guarantee actually was

The previous workstream closed on the sentence **"test subject fully frozen"**.
That sentence was broader than the hashing behind it.

`scripts/hermetic/manifest.mjs` divides the subject into four groups. The `test`
group read, in full:

```js
test: ['tests', 'scripts'],
```

`tests/` is the `testDir` of `playwright.config.ts` — one config of four. The
other three all point somewhere that was not hashed at all:

| Config | `testDir` | Hashed before this fix |
|---|---|---|
| `playwright.config.ts` | `./tests` | yes |
| `playwright.full.config.ts` | `./experiments/tests` | **no** |
| `playwright.experiments.config.ts` | `./experiments/tests` | **no** |
| `playwright.mountains.config.ts` | `./experiments/tests` | **no** |

`playwright.full.config.ts` is the WebGL/full suite and collects **165 tests in
2 files**, every one of them from the unhashed tree. The full suite is a gate in
the repository-wide sequence. So for the whole of G3, G5 and G6, the specs that
decided whether the WebGL gate passed could have been edited at any point and
every manifest comparison would still have printed `SUBJECT IDENTICAL`.

## Two further files, uncovered for a different reason

`experiments/tests/mountain-framing.spec.ts` imports:

```ts
import { GRID, valleyMetrics, valleyVerdict, VALLEY } from '../valley-metrics.mjs';
import { terrainMask, frameState } from '../terrain-mask.mjs';
```

Both modules sit at `experiments/` root rather than under `experiments/src`.
A repository-wide search finds that spec as their **only** importer — they are
test code filed one directory too high. They were in no group: `product` hashes
`experiments/src`, which does not contain them, and `test` did not reach into
`experiments/` at all.

## The rule the group now follows

> A file is a test input if the harness **executes it or imports it while
> deciding pass or fail.** Membership is decided by that question, never by
> which directory a config's `testDir` happens to name.

Applied, the group becomes:

```js
test: [
  'tests',
  'experiments/tests',
  'experiments/terrain-mask.mjs',
  'experiments/valley-metrics.mjs',
  'scripts',
],
```

Measured effect on coverage: **74 files → 82 files.**

## Audit of every executable test input — §4

| Input | Group | Covered | Note |
|---|---|---|---|
| `tests/**` (23 specs) | test | yes | main config `testDir` |
| `tests/helpers/**` | test | yes | `navigation-boundary`, `homepage`, `reduced-motion` |
| `experiments/tests/**` (6 specs) | test | **now** | three configs' `testDir` |
| `experiments/terrain-mask.mjs` | test | **now** | imported by `mountain-framing.spec.ts` only |
| `experiments/valley-metrics.mjs` | test | **now** | imported by `mountain-framing.spec.ts` only |
| `scripts/**` | test | yes | gate helpers, reporters, `test-server.mjs`, diagnostics configs+specs |
| `scripts/hermetic/diagnostics/playwright.diagnostics.config.ts` | test | yes | under `scripts/` |
| 4 Playwright configs | config | yes | discovery, projects, workers, timeouts |
| `package.json`, `package-lock.json` | config | yes | |
| `portal/`, `experiments/` package+lock+tsconfig | config | yes | |
| `netlify.toml` | config | yes | |
| `netlify/functions/*.mjs` | product | yes | imported by `tests/lead-*.spec.ts`; product-owned, correctly filed |
| `portal/src/lib/{money,pipeline}` | product | yes | imported by `portal-revenue.spec.ts`; product-owned |
| `experiments/src/**` | product | yes | imported by experiments specs; product-owned |

Deliberately **not** hashed, and why (unchanged policy, now written down):
`_build/reports/**` (the gate writes there while it runs), `test-results/**`
(Playwright's own output), `node_modules/**` (cost; frozen by the lockfiles,
which are hashed — the limitation is stated in the source), `.git/**`, and
`.env*` (secrets, and a gate whose result depended on them would be a gate that
cannot be reproduced from the repository).

Generated output stays separate from semantic input: `dist` remains its own
group and no report directory entered any group.

## Second defect, found while fixing the first

`tests/helpers/navigation-boundary.ts` wrote the frozen-subject block of every
failure bundle by reading:

```ts
tests: m?.groups?.tests?.hash ?? null
```

The group is `test`, singular. That read has evaluated to `null` in **every
bundle ever written**, and it is visible in the G6 red run's own `meta.json`:

```json
"frozenSubject": { "dist": "2538acb4…", "tests": null, "commit": "48811e99…" }
```

A bundle that names the artefact but cannot name the test code that judged it is
missing half of what §35 asks a bundle to carry. Corrected, and widened to record
`test`, `config` and `combined` alongside `dist`.

## Third defect, same area

`gate-run.mjs` could pin only ONE group to a frozen reference: `--expect-dist`.
It captured `test` and `config` hashes into the result and never asserted them.
The before/after comparison does not cover this — that comparison catches the
subject changing **during** a run, never a run that **began** from a different
subject. Added `--expect-test` and `--expect-config`, symmetrical with
`--expect-dist` and reporting through the same `invalidReasons` channel
(`TEST_NOT_FROZEN_REFERENCE`, `CONFIG_NOT_FROZEN_REFERENCE`).

## §5 — the mutation check

A harmless comment was appended to `experiments/tests/portrait-journey.spec.ts`,
manifests captured either side, and the same mutation put to the fixed detector
and to the pre-fix detector recovered from `git show HEAD:`.

**Fixed detector — mutation detected:**

```
manifest 9ddd3f3b3695  product=337c281c(346) test=d886514b(82) config=94c5bf52(14) dist=28af7fe4(281)
manifest 3fea41b1f994  product=337c281c(346) test=7f08c515(82) config=94c5bf52(14) dist=28af7fe4(281)
RUN INVALID — TEST SUBJECT CHANGED DURING EXECUTION
  group test: HASH_CHANGED
    changed: experiments/tests/portrait-journey.spec.ts
EXIT=3
```

**EXPERIMENT TEST MUTATION DETECTED.**

**Pre-fix detector, identical mutation on disk — negative control:**

```
manifest 6d29be820bd5  product=337c281c(346) test=3feaf036(74) config=94c5bf52(14) dist=28af7fe4(281)
manifest 6d29be820bd5  product=337c281c(346) test=3feaf036(74) config=94c5bf52(14) dist=28af7fe4(281)
SUBJECT IDENTICAL  6d29be820bd5d6200561c06a4cd4eed85ca745ef6c85d9d1710d32786ee16e59
EXIT=0
```

The negative control is what makes the positive one mean something: the same
edit, the same two capture points, `SUBJECT IDENTICAL` before the fix and
`RUN INVALID` after. The gap was real and the fix is what closes it — not a
detector that was going to fire either way.

The mutation was reverted; `git status` reports `experiments/tests/` clean and
the stash holding the deliberate edit was inspected (it contained that edit and
nothing else) and dropped. **Not committed.**

## What this does NOT do

It does not hash `node_modules`, and a dependency mutated in place without
touching a lockfile still would not be caught. That limitation predates this fix
and is stated in the source rather than papered over.

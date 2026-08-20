# The final hermetic closure gate — §43, §44

**ONE run.** Pre-registered, with the stop rules fixed in the driver before it
started and no rerun-for-green path in it. It was not repeated, not retried, and
not run again to confirm.

## Result

> ## `FINAL HERMETIC CLOSURE GATE: VALID + GREEN`

| | |
|---|---|
| Run | `scroll-altimeter-four-01` |
| Commit | `2215ef96b3614ca6698608fd18a30c6db27cbb26` |
| Started | 2026-08-20T15:43:52Z |
| Duration | **1 392.9 s** (23 min) |
| Preflight | **PASS on attempt 1** |
| Valid | **yes** — `invalidReasons: []` |
| Green | **yes** — `failedGates: []`, `allFailingTests: 0` |
| Subject mutation | **none** — before == after, all five hashes |
| `dist` canary events | **0** |
| Orphaned processes | **0** |
| Ports still held | **0** |
| Arithmetic reconciled | **yes**, both Playwright gates |

## The one aborted start, disclosed

The driver was invoked once before this and **the run never started**. The
preflight refused it with `PREFLIGHT FAILED — RUN NOT STARTED: repository
conditions` (exit 20), because `host-preflight.mjs` still pinned the previous
workstream's frozen subject:

```
✗ [A] head:          HEAD is 2215ef96…, expected b9a87da4…
✗ [A] hash-product:  6b93a303…, expected 088c0284…
✗ [A] hash-test:     6fdd6f60…, expected 5203f7ba…
✗ [A] hash-dist:     af279952…, expected 2538acb4…
```

That is the checker working, not failing. Its own comment states the rule — *"a
checker that derives its expectations from the thing it is checking verifies
nothing, and that principle does not weaken because the subject was updated on
purpose"* — and the sanctioned procedure is to repin `EXPECT` and keep the
previous subject in `previous` so the change is legible. That was done, from a
manifest captured **before** the gate rather than during it, and the file lives
outside the subject so repinning it changes no hashed byte.

**No gate was consumed.** `gate-run.mjs` was never invoked; nothing was measured,
started, served or counted. The single authoritative run is the one below.

## §43's conditions, one by one

| Condition | Status |
|---|---|
| quiet-host preflight PASS | **yes** — attempt 1: `load1 1.07` (max 1.09, cap 6), `iCloud 0%`, free mem 70%, ports 4322/4327 free |
| hermetic worktree | **yes** — `/Users/arturlukacs/stratos-hermetic/subject`, outside iCloud |
| complete manifest | **yes** — 76 test files including `experiments/tests/` and both loose modules |
| frozen subject | **yes** — all four groups pinned with `--expect-dist`, `--expect-test`, `--expect-config` |
| owned server | **yes** — both servers started and stopped by the runner, `node scripts/test-server.mjs` |
| zero canary writes | **yes** — `canaryEventCount: 0` across 6 armed trees |
| no stale ports | **yes** — 4322 and 4327 free before, released after |
| all standard gates | **yes — all 9, and the BUILD was one of them** |

### The build was run, not skipped

`final-closure-01` passed `--skip-build`. This run did not.

Skipping proves the artefact did not change because nothing touched it; running
it proves the artefact is **reproducible from the frozen source** *and* is the
same artefact. Verified beforehand: a full `npm run build && npm run build:full`
over the frozen tree reproduced `dist af279952…` byte-identically, so including
the build could be a gate rather than a coin toss.

```
build site         exit 0    8 381 ms
build experiments  exit 0    3 625 ms
dist after build   af279952d1def82b6ae7858d946f95981416aa3aff53bb677934d3d774b94626 (186 files)
```

## The subject — §42

```
before == after (IDENTICAL):
  combined 1c8dc0d7f22088eb71c77d58afb8a8e2ab003ff820d8fdae88f804c5d43725d4
  product  6b93a3034d3d81cd4c4448873c354e28c7356edfd06405edb2c5457666cf1600   304 files
  test     6fdd6f60f96774cb4246da7fa58a130873c5c926974ce3f9d2839d1d0112f520    76 files
  config   94c5bf52ccac846c9bb8149f8cda1d55cb78d51c32db5fcc798411cd611b326b    14 files
  dist     af279952d1def82b6ae7858d946f95981416aa3aff53bb677934d3d774b94626   186 files
```

### What moved since `final-closure-01`, and what did not

| Group | `final-closure-01` | this run | |
|---|---|---|---|
| `product` | `088c0284…` | **`6b93a303…`** | moved — the one product fix, `assets/js/header.js` |
| `test` | `5203f7ba…` | **`6fdd6f60…`** | moved — the three test corrections |
| `config` | `94c5bf52…` | **`94c5bf52…`** | **byte-identical** |
| `dist` | `2538acb4…` | **`af279952…`** | moved — it must, the product moved |
| `dist` file count | 186 | **186** | unchanged |

**`config` being byte-identical is the checkable claim.** No configuration, no
`testDir`, no discovery rule and no threshold was touched, so the manifest
coverage the previous workstream won is intact and this gate judged the same
population by the same rules.

A `product` hash that had *not* changed would have meant the fix was not in the
subject.

## §44 — the counts, in full, with no summary truncation

| Gate | Result | Exit | Duration |
|---|---|--:|--:|
| `typecheck` | **PASS** | 0 | 3.6 s |
| `fingerprint-check` | **PASS** | 0 | 0.1 s |
| `draco-check` | **PASS** | 0 | 0.1 s |
| `secret-scan` | **PASS** | 0 | 0.5 s |
| `seo-audit` | **PASS** | 0 | 0.1 s |
| `conversion-audit` | **PASS** | 0 | 0.1 s |
| `route-audit` | **PASS** | 0 | 266.9 s |
| `playwright-main` | **PASS** | 0 | 393.4 s |
| `playwright-full` | **PASS** | 0 | 714.8 s |

### `playwright-main` — the main suite, Portal, lead, renderer, static validators

```
collected 1290    passed 1168    failed 0    flaky 0    skipped 122
arithmetic reconciles: 1168 + 0 + 122 = 1290   ✔
```

Skip set, exact:

| by file | | by project | |
|---|--:|---|--:|
| `homepage-chrome.spec.ts` | 31 | `desktop-1440` | 28 |
| `mobile-homepage-simple.spec.ts` | 81 | `desktop-1920` | 33 |
| `public-site.spec.ts` | 10 | `mobile-390` | 10 |
| | | `mobile-430` | 10 |
| | | `reduced-motion` | 41 |
| **total** | **122** | **total** | **122** |

Every skip is a composition or engine guard: the portrait contracts skipping on
desktop projects, the desktop contracts skipping on portrait, and the
clock-dependent contracts skipping under `reduced-motion` where there is no
clock to read.

**Collected 1 290 against `final-closure-01`'s 1 285.** The five are the new
contract `homepage-chrome.spec.ts:533` across five projects — four that carry it
and `reduced-motion`, which skips it. No test was removed, renamed or disabled.

### `playwright-full` — the WebGL suite

```
collected 165    passed 131    failed 0    flaky 0    skipped 34
arithmetic reconciles: 131 + 0 + 34 = 165   ✔
```

**Exactly the recorded baseline: `131/165 passed · 0 failed · 34 skipped`.** The
test count did not change, so §36 has nothing to explain.

Skip set, exact: all 34 in `full-ascent.spec.ts` — 32 `reduced-motion` (no
scroll-driven scene on that path) and 2 `desktop` (`device-independent; running
it once is the point`).

### The four contracts, inside this run

| Contract | Project | Result |
|---|---|---|
| A `homepage-chrome.spec.ts:482` | `desktop-1920` | **passed** |
| A′ `homepage-chrome.spec.ts:533` (new) | 4 projects | **passed** |
| B `mobile-homepage-simple.spec.ts:591` | `mobile-390` | **passed** |
| C `mobile-homepage-simple.spec.ts:638` | `mobile-390` | **passed** |
| D `full-ascent.spec.ts:1342` | `desktop` | **passed — 212.2 s** |

Contract D's self-measured budget in this run:

```
one settle 16 802 ms  ->  budget 732 080 ms   actual 212.2 s   headroom 3.45x
```

**Stated plainly: 212.2 s would have fitted inside the old 300 s constant too**,
at a 1.41× margin. This run did not need the correction. What the correction
removes is the class — the same test took 467–514 s under contention, and the
budget tracked it there.

## Host conditions

| | `final-closure-01` (red) | `scroll-altimeter-four-01` (green) |
|---|---|---|
| preflight `load1` | 2.96 | **1.07** |
| `load1` mean / peak during run | 26.99 / 112.00 | **11.5 / 35.55** |
| `swapUsedMB` peak | 3 388 | 3 323.62 |
| peak browser processes | 18–44 | 38 |
| `playwright-main` | 607 s | **393 s** |
| `playwright-full` | 929 s | **715 s** |
| total elapsed | 1 803 s | **1 393 s** |

The host was materially quieter than it was for the red run, and that is stated
rather than left to be discovered. It does not make this result conditional: the
preflight passed, the run was declared, the subject did not move, the canaries
did not fire, and the arithmetic reconciles. It is recorded because the previous
run's disclosure was that its own host state was caused by the investigation
preceding it — the same was true here, and the fix was to let the machine settle
to `load1 1.07` **before** starting, which is what the preflight exists to
enforce.

**Swap remained at 3 323 MB of 4 096 throughout.** The preflight still does not
gate on swap headroom, and the finding recorded against `final-closure-01` —
that on the evidence it should — stands unchanged. It is not addressed here
because redesigning the checker is out of this workstream's scope.

## §45

```
SCROLL / ALTIMETER FOUR-CONTRACT REVIEW: RESOLVED
FINAL HERMETIC CLOSURE GATE: GREEN
REPOSITORY-WIDE MERGE GATE: GREEN
REGRESSION-HARNESS WORKSTREAM: CLOSED
```

Not run again.

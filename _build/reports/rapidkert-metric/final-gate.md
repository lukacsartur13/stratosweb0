# Rapidkert case-study metric — the one final hermetic gate

```
RAPIDKERT CASE STUDY METRIC: RECONCILED
RAPIDKERT STALE ASSERTION: RESOLVED
WEBGL / FULL SUITE: GREEN
FINAL HERMETIC GATE: VALID + RED
REPOSITORY-WIDE MERGE GATE: NOT GREEN
```

One run. It was not repeated, not retried, and not run again for a better
number. The regression-harness programme was not reopened and no G-series
campaign was started.

## The run

| | |
|---|---|
| Run | `rapidkert-metric-01` |
| Commit | `02d0399bf7baf26c0b50d8959504c87d957aa2dd` |
| Worktree | `/Users/arturlukacs/stratos-hermetic/subject` (hermetic, outside iCloud) |
| Started | 2026-08-20T18:21:49Z |
| Duration | 1 143.1 s (19 min) |
| Preflight | **PASS on attempt 1** — `load1 1.82` (max 2.06, cap 6), iCloud 0%, free mem 78%, ports 4322/4327 free |
| Valid | **yes** — `invalidReasons: []` |
| Green | **no** — `playwright-main` failed |
| Subject mutation | **none** — before == after, all five hashes |
| `dist` canary events | **0** |
| Ports still held | **0** |
| Arithmetic reconciled | **yes**, both Playwright gates |

### One aborted start, disclosed

The driver was invoked once before this and **the run never started**. The
preflight held it at `no-build-watcher`: a portal Vite dev server (`npm run dev`,
PID 64974, listening on :5174, started 18:49 the previous evening) was running in
the iCloud checkout. `gate-run.mjs` was never invoked, nothing was measured,
served or counted, and **no gate was consumed**. The dev server was stopped with
the operator's approval and the preflight then passed on its first attempt.

The checker was not weakened to let the run start. That distinction is the whole
value of a prospectively fixed preflight.

## The frozen subject

```
before == after (IDENTICAL):
  combined 5dbe66581a212d423980f8e5b440c721d47eaff5eb0e5d96f50766362f314bb2
  product  386b9d8ab9a66dcad059fb61a3f49594e4d2ac06a76ab834cfe3b273d44f9341   304 files
  test     aed85526b8bd94f03250293c5e9f1e7d9c990c797c0670b8c1e97476c64c7594    76 files
  config   94c5bf52ccac846c9bb8149f8cda1d55cb78d51c32db5fcc798411cd611b326b    14 files
  dist     d0d7c9c132dbdd392bb4b101329b1ff813948dc655e49a249d00551dec72a7e3   186 files
```

### What moved, and what did not

| Group | `scroll-altimeter-four-01` | this run | |
|---|---|---|---|
| `product` | `6b93a303…` | **`386b9d8a…`** | moved — the Rapidkert metric, result copy, image and both locale tables |
| `test` | `6fdd6f60…` | **`aed85526…`** | moved — `full-ascent.spec.ts` only |
| `config` | `94c5bf52…` | **`94c5bf52…`** | **byte-identical** |
| `dist` | `af279952…` | **`d0d7c9c1…`** | moved — it must, the product moved |
| file counts | 304 / 76 / 14 / 186 | 304 / 76 / 14 / 186 | unchanged |

`config` byte-identical is the checkable claim: no configuration, no `testDir`
and no discovery rule was touched, so the manifest coverage for
`experiments/tests/` won by the earlier workstream is intact and this gate
judged the same population by the same rules. The `test` group still carries 76
files including `experiments/tests/` and both loose modules.

**The build was run, not skipped.** Idempotency was verified beforehand on the
frozen tree: `npm run build && npm run build:full` reproduced `dist d0d7c9c1…`
byte-identically at 186 files, twice.

## The counts, in full

| Gate | Result | Exit | Duration |
|---|---|--:|--:|
| `typecheck` | **PASS** | 0 | 3.7 s |
| `fingerprint-check` | **PASS** | 0 | 0.1 s |
| `draco-check` | **PASS** | 0 | 0.1 s |
| `secret-scan` | **PASS** | 0 | 0.5 s |
| `seo-audit` | **PASS** | 0 | 0.1 s |
| `conversion-audit` | **PASS** | 0 | 0.2 s |
| `route-audit` | **PASS** | 0 | 257.9 s |
| `playwright-main` | **FAIL** | 1 | 263.1 s |
| `playwright-full` | **PASS** | 0 | 605.4 s |

### `playwright-full` — the WebGL suite, which is where this task lives

```
collected 165    passed 131    failed 0    flaky 0    skipped 34
arithmetic reconciles: 131 + 0 + 34 = 165   ✔
```

**Exactly the recorded baseline: `131/165 passed · 0 failed · 34 skipped`.** The
collected count did not move, so no test was added, removed, renamed or
disabled — the stale assertion was replaced in place. No new WebGL failure.

### `playwright-main`

```
collected 1290   passed 1159   failed 9   flaky 0   skipped 122
arithmetic reconciles: 1159 + 9 + 122 = 1290   ✔
```

Collected 1 290 and skipped 122 — both identical to the previous green run. The
nine failures are new, and they are **one defect counted nine times**.

## The exact new failure

| file:line | projects |
|---|---|
| `homepage-chrome.spec.ts:295` the opening state is the full wordmark over a transparent header | `mobile-390`, `mobile-430` |
| `homepage-chrome.spec.ts:1070` navigating away and back leaves nothing behind | `desktop-1440`, `desktop-1920`, `mobile-390`, `mobile-430`, `reduced-motion` |
| `public-site.spec.ts:79` loads with the hero, the altimeter and no console errors | `mobile-390`, `mobile-430` |

Every one of the nine fails on the same assertion — the console-error list is
not empty — with the same message:

```
Failed to load resource: the server responded with a status of 404 (Not Found)
```

The artefact does not name the resource, so it was identified directly, by
serving the frozen `dist` and scrolling the homepage until the lazy images
below the fold are requested:

```
404  /assets/img/work-rapidkert.jpg
```

### Root cause

`experiments/src/full/content.ts` repoints the Rapidkert case-study image:

```
-    image: { src: '/assets/img/work-3.jpg', alt: 'A Rapidkert kertépítés weboldala' },
+    image: {
+      src: '/assets/img/work-rapidkert.jpg',
+      …
```

`assets/img/work-rapidkert.jpg` exists in the working tree — 232 KB, 1454×869,
dated 2026-08-17 — and **is not tracked by git**. It is not ignored; it was
simply never staged. The frozen subject is built from the commit, so the file is
absent from it, and the homepage requests a URL that 404s.

This is not an experiment-only path. `experiments/home/hu.html` loads
`/src/full/main.tsx`, so the **production homepage is built from the same
`content.ts`** — `dist/assets/home/main-*.js` contains the string. The nine
failures are the production homepage, not the prototype route.

Nothing in the metric contract, the metric itself, or the WebGL suite is
implicated. `playwright-full` is green and `case-rapidkert`'s metric row is
asserted and passing.

### A second observation, not a gate failure

The three existing case images are portrait and `FullAscent.tsx` reserves a
`1200×1500` box for them:

```
work-1.jpg          1346×1800
work-2.jpg          1500×1800
work-3.jpg          1493×1800
work-rapidkert.jpg  1454× 869   ← landscape
```

Committing the file as it stands would clear the 404 and still put a 5:3
landscape photograph into a 4:5 reserved box. Recorded here rather than fixed,
because the aspect ratio is a content and design decision.

## Stop

Per the task's stop rule the failure is reported and the work stops here. The
regression-harness programme was not reopened, no second gate was run, no
migration was applied, nothing was deployed and nothing was merged.

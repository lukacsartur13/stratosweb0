# Idle-host baseline — WebKit navigation tail investigation

Captured before any stress or benchmark run, per §2. Nothing in this file is a
measurement of the defect; it is the record of the machine the measurements were
taken on, so that a later run can be classified **controlled** or **contaminated**
rather than merely "run".

## Source under investigation

| | |
| --- | --- |
| HEAD | `c37587c82226cb45750dd86fd871559db7410534` |
| Subject | `docs: report the regression-harness stabilization pass` |
| Branch | `portal-p1-control-room` |
| Captured (UTC) | 2026-08-17T09:36:22Z |

### Working tree at capture

Tracked files modified — **none of them executable product source**:

```
 M .claude/settings.local.json
 M _build/reports/mobile-altimeter-portal-analytics-report.md
 M _build/reports/phase8-route-audit.json
 M _build/reports/phase9-conversion-audit.json
 M _build/reports/phase9-seo-audit.json
 M _build/reports/portal-p1/review/README.md
 M _build/reports/portal-p2-revenue-operations.md
 M _build/reports/portal-p2/performance-measurements.json
 M assets/blender/stratos-altimeter.blend
 M blender/mountains/__pycache__/stratos_terrain.cpython-313.pyc
```

Untracked: 118 paths, all under `_build/reports/`, `experiments/.tmp-*`,
`design-system/` and `test-results/`.

**Source freeze (§3).** No file under `assets/js/`, `assets/css/`, `_build/`
templates, `portal/src/`, `scripts/assemble.mjs`, `netlify.toml` or the site
generator is modified, and none will be modified during the measurement phase.
The frozen product commit for every measurement in this workstream is
`c37587c`. Instrumentation added later lives only under `scripts/webkit-nav/`
and is committed separately.

## Host

| | |
| --- | --- |
| Machine | Apple M4, 10 cores |
| RAM | 24 GiB (25 769 803 776 B) |
| OS | Darwin 25.6.0 (macOS), arm64 |
| Node | v24.18.1 |
| Playwright | 1.62.1 |
| WebKit builds present | `webkit-2336`, `webkit-2342` (1.62.1 resolves `webkit-2342`) |

### Load and memory at capture

```
load averages: 1.58 1.67 1.81      (1m / 5m / 15m)
CPU usage:     11.18% user, 5.45% sys, 83.36% idle
PhysMem:       23G used (2684M wired, 6126M compressor), 69M unused
swap:          total 3072.00M   used 2213.94M   free 858.06M
free pct:      63% (memory_pressure)
Disk:          /System/Volumes/Data  460Gi total, 276Gi avail, 37% used
```

Load average ~1.6 on a 10-core machine is ~16% of capacity. This is accepted as
**reasonably idle** for the purpose of §2. The compressor figure (6 GiB) and
2.2 GiB of swap in use are noted but not treated as disqualifying: free memory
is 63% and there is no page-out pressure during the capture window.

### Processes present, and how each is treated

Resident, unavoidable, and not excluded:

| Process | CPU | Note |
| --- | --- | --- |
| `Claude Helper (Renderer)` (9002) | 46% | The desktop app hosting this session. Cannot be stopped. |
| `Claude Helper` (8993) | 45% | Same. |
| `WindowServer` (585) | 44% | macOS compositor. |
| `Music.app` (44442) | 4.7% | User application. |
| Safari + `com.apple.WebKit.*` XPC services | <2.5% each | The user's own browser, system WebKit — unrelated to Playwright's WebKit. |

Leftovers from earlier test work on this machine, all at 0.0% CPU:

| Process | Age | Note |
| --- | --- | --- |
| `node scripts/test-server.mjs 4399 dist` (42821) | 7 h 13 m | Stale static server on port **4399**. Does not collide with 4322 (suite) or the ports this workstream uses. |
| Playwright `firefox-1539` Nightly + 6 helpers | 21 h 37 m | Orphaned from an unrelated earlier run. Idle. |
| `next dev` (47986) | 55 m | A **different** project (`Duna Boats`). Idle. |

Concurrent development sessions:

| Process | Age |
| --- | --- |
| `claude` (48444) — this session | 12 m |
| `claude` (48602) | 4 m |
| `claude` (48766) | 1 m |

> Two other Claude Code sessions are alive on this host. They are idle at
> capture time but they are the exact contamination source §2 names: the
> previous pass's full-gate numbers were taken while this machine was also
> doing analysis. **Every run in this workstream records `load average` at
> start and end**, and any run whose 1-minute load exceeds 4.0 at either end is
> filed as CONTAMINATED and its totals are never combined with controlled runs.

## The environment fact that changes how the measurements must be read

The repository is checked out **inside iCloud Drive**:

```
/Users/arturlukacs/Library/Mobile Documents/com~apple~CloudDocs/Downloads/StratosWeb
```

`dist/` — the directory the test server serves every byte of the suite from —
is therefore backed by the iCloud file provider, not by a plain local
filesystem. At capture time:

```
files in dist/:            322
dataless (evicted) files:  149
repo-wide dataless:        152 (excluding node_modules)
```

All 149 currently-evicted files in `dist/` are iCloud *conflict duplicates*
(`kkv 2.html`, `404 2.html`, `rolunk 3.html`, …) which no test requests. **No
currently-served path is evicted at capture time.** That is the state now; it is
not a guarantee about the state during a four-minute suite run, and the file
provider is free to change it. `stat()` on a dataless file returns immediately
with the real size; the *read* is what blocks, for as long as the provider needs.

This is recorded here as a measured property of the host, not yet as a
hypothesis about the defect. The stress harness instruments the server's file
reads specifically so that this can be confirmed or excluded rather than
assumed.

Active iCloud daemons at capture: `bird`, `fileproviderd`,
`com.apple.CloudDocs.iCloudDriveFileProvider`, `cloudd` — all 0.0% CPU.

## The failure this workstream exists to explain

From `_build/reports/regression-harness/final-gate.json` (5 runs of frozen
commit `27044dd`, gate verdict NOT GREEN):

| Run | Project | Spec | Title | Duration |
| --- | --- | --- | --- | --- |
| 1 | `mobile-390` | `public-site.spec.ts:264` | `/kkv.html` responds and has a title and description | 30 036 ms |
| 4 | `mobile-390` | `public-site.spec.ts:240` | the en homepage is its own entry point with its own links | 30 035 ms |
| 5 | `mobile-390` | `public-site.spec.ts:264` | `/kkv.html` responds and has a title and description | 30 034 ms |
| 5 | `mobile-390` | `public-site.spec.ts:281` | the three languages are cross-linked with hreflang | 30 062 ms |
| 4 | `desktop-webkit` | `homepage-history.spec.ts:223` | back and forward restore … | 7 753 ms |
| 5 | `desktop-1440` | `homepage-chrome.spec.ts:966` | navigating away and back leaves nothing behind | 2 462 ms |

The four 30-second entries are the subject. Facts that constrain the search
before any new measurement is taken:

1. **All four are `page.goto`, and all four consumed the whole 30 s test
   budget.** `playwright.config.ts` sets no `navigationTimeout`, so `goto` has
   no limit of its own; the number is the test timeout, which means the
   navigation had not resolved when the test was killed. Nothing in the
   existing artefacts says whether it would ever have resolved.
2. **The default `waitUntil` is `load`.** Not `commit`, not
   `domcontentloaded`. Any single subresource that never completes is
   sufficient to produce exactly this signature.
3. **`/kkv.html` is not the 3D homepage.** It is a 39 KB static document whose
   subresources are six stylesheets, seven scripts, three images and three
   `woff2` fonts. It contains no canvas, no WebGL, no GLB and no Altimeter.
   Two of the four failures are on this page. The persistent-3D-instrument
   hypothesis (§19–§20) therefore cannot be the whole story, and may be none of
   it.
4. **There is no service worker anywhere in `dist/`**, so navigation
   interception by a worker is excluded at the outset.
5. `assets/js/transitions.js` intercepts *clicks*, never `goto`, and its own
   header states navigation must not depend on it. It is in scope for the
   link-navigation control (§23) and not for the `goto` reproduction.

3 is the observation that most changes the plan: the reproduction harness must
target `/kkv.html` at least as hard as it targets the homepage.

## Run classification rules used by everything downstream

| Class | Condition |
| --- | --- |
| CONTROLLED | 1-minute load average < 4.0 at both start and end; no build, no other suite, no benchmark running; recorded in the run's own header. |
| CONTAMINATED | Anything else. Reported separately, never summed with controlled runs. |

Every stress run writes its own start/end load into `stress-summary.csv`, so
this classification is a property of the data rather than of the narrative.

Classification uses the load a run **started** under, not the load it ended
under. §2's contamination is *unrelated* work sharing the machine; the load a
five-browser experiment generates is the experiment. Judging a concurrency run
contaminated for succeeding in loading the host would disqualify every
measurement this workstream needs. End load is recorded either way.

## Contaminated runs, recorded rather than discarded

### C-2 — every diagnostic arm after ~13:50Z

**CONTAMINATED, by a form of interference this file did not anticipate.**

The contamination rule written at the top of this document watches *load
average*. It does not watch whether another process is **editing the subject**,
and that is what happened:

| Time | Event |
| --- | --- |
| 13:58–14:18 | `_build/build.py`, `_build/pages/kkv.html`, `_build/pages/munkaink.html`, `_build/pages/munka-rapidkert.html`, `_build/i18n/{kkv,munkaink,esettanulmanyok}.json` modified; `_build/i18n/rapidkert.json` created |
| 14:15–14:35 | **82 files rewritten inside `dist/`** — during the repeat-each arm |
| 14:39:53 | full `dist/` rebuild completes |

None of it by this workstream, which touched only `scripts/webkit-nav/` and
`_build/reports/webkit-navigation/`. Four other agent sessions were live on this
host throughout.

**Consequences, stated precisely:**

* The **six repository-wide gate runs (10:48–11:40) are unaffected** —
  `find dist -newermt 10:48 ! -newermt 11:40` returns **0 files**. Nothing
  changed under them. They remain the authoritative measurement.
* The **repeat-each arm is void as evidence.** Its five `ESTALE` failures and
  five blank-document failures both have a sufficient explanation in "the files
  were being replaced while the tests read and served them".
* The matrix arms overlapping 13:50–14:35 have latency figures that cannot be
  compared across arms. Their failure counts (all zero) are unaffected —
  a mutating tree can only add failures, not remove them.

**The lesson for the rule itself**: a contamination check that measures only CPU
will pass a run whose subject is being rewritten mid-measurement. The
classification in `stress-summary.csv` says `CONTROLLED` for arms that were not,
because it was asking the wrong question. A future pass should hash the served
tree at the start and end of every run and void the run if the two differ.

### C-1 — first instrumented suite attempt, 2026-08-17 09:58Z

**CONTAMINATED. Its totals are not combined with anything.** Two independent
faults, both mine:

1. **Started at load 4.44.** It was launched immediately after the B1 fleet run,
   while the one-minute load average was still decaying from 18.25. That is over
   the threshold this file set before any measurement was taken.
2. **The harness had left a file in the served tree.** `stress.mjs` wrote its
   §22 static control page to `dist/__navctl/control.html` and did not remove
   it. `dist/` is build output, but the suite *reads it as a subject*:
   `structured-data.spec.ts` walks every `.html` under `dist/` asserting each
   public page carries exactly one parseable JSON-LD block, and
   `public-site.spec.ts` walks the same tree for inline scripts. A bare control
   document is a new public page to both. Six `[node]` tests failed, all of them
   caused by the instrument rather than by the subject.

Run 1 of that attempt was otherwise clean — 1 143 passed, 6 failed, 122 skipped,
1 271 collected, and every one of the six failures is accounted for above. No
`mobile-390` navigation failed in it.

The fix is in `scripts/webkit-nav/stress.mjs`: the control page is created only
when a run's `--path` list actually names it, and removed when the run ends,
including on the failure path. The lesson is worth stating plainly because it is
the same one the workstream is about — **an instrument that changes its subject
produces failures that look exactly like the defect being hunted**, and the only
thing that separated them here was that they landed in the one project that
never opens a browser.

The server log from that attempt is retained separately (`suite-contaminated/`)
because the server's own behaviour under a real suite run is valid evidence
regardless of why the tests failed; it is used in `server-comparison.md` and is
never counted toward any gate total.

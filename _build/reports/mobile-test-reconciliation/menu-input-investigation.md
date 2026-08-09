# Why a non-forced click on the menu trigger hangs — the input path, measured

§9 of the reconciliation brief requires the eight `npm test` failures to be
treated as **UNRESOLVED until proven**, and §10 requires the actual browser and
input path to be investigated rather than papered over with `force: true`, a
raised timeout or a reduced worker count.

This is that investigation. Nothing here was classified from the shape of the
failures; every line below is a measurement.

| | |
|---|---|
| Branch | `phase-9-continuation-portal-analytics` |
| Build | `npm run build`, exit 0 — one `dist/`, used by every arm |
| Node · npm · Playwright | v24.18.1 · 11.16.0 · 1.62.1 |
| Machine | macOS 26.6, arm64, 10 cores (4 performance + 6 efficiency) |
| Instruments | `experiments/probe-menu-input.mjs`, `experiments/probe-load-matrix.mjs` |
| Raw output | `menu-input-swiftshader.json`, `menu-input-angle.json`, `load-matrix.json` |

---

## 0 · The eight, restated

All eight are in `tests/homepage-chrome.spec.ts`. Six on `desktop-1920`, two on
`reduced-motion`. **Zero in any Phase 9 suite** and zero in
`mobile-homepage-simple.spec.ts`.

| # | Test | Line | Project | Failure |
|---|---|---|---|---|
| D1 | the journey state compacts the wordmark and keeps the header short | 259 | desktop-1920 | `expect.poll(opacity('.brand__mark'), {timeout: 4000})` never exceeded 0.9 |
| D2 | a single jump lands on the right state, not one short of it | 326 | desktop-1920 | `header never reached "destination"`, 12 s poll |
| D3 | the full-screen menu opens from every header state | 422 | desktop-1920 | test timeout; in flight was `waitForTimeout(120)` inside `scrollToFraction` |
| D4 | focus is trapped inside the layer while it is open | 470 | desktop-1920 | test timeout inside `for (i<30) keyboard.press('Tab')` |
| D5 | opening the menu does not walk the journey back down the mountain | 558 | desktop-1920 | test timeout |
| D6 | a subpage reached from the homepage carries the same working header | 945 | desktop-1920 | test timeout |
| D7 | focus is trapped inside the layer while it is open | 470 | reduced-motion | test timeout, same `Tab` loop |
| D8 | a subpage reached from the homepage carries the same working header | 945 | reduced-motion | test timeout; `locator.click` **resolved** the burger, then hung |

**Not one is a failed assertion about the product.** Six are the 30 s per-test
budget running out. The two that are assertion failures are `expect.poll`
deadlines. Every failing call is a *round trip into the page*.

### `reduced-motion` is not a reduced-motion page — verified, not assumed

`playwright.config.ts` says so in its own comment, and
`tests/public-site.spec.ts:327` (`the reduced-motion test environment is
genuinely active`) asserts it in both directions: on Playwright 1.62.1 the
declarative `reducedMotion: 'reduce'` does not reach `matchMedia()`, so a test in
that project which does not call `enableReducedMotion(page)` renders **the
ordinary animated 1440×900 WebGL homepage**. Neither D7 nor D8 calls it.

So the eight are not "six at 1920 plus two odd ones". They are **eight heavy
round-trip tests running against a full-viewport WebGL page**, at two sizes.

---

## 1 · Everything §10 lists, measured — and all of it clean

`probe-menu-input.mjs` drives the built homepage in the same browser Playwright
uses, at both viewports, at all three header states, and reads the trigger the
way an actionability check does.

| §10 checkpoint | Measured |
|---|---|
| Pointer hit target | `elementFromPoint` at the box centre returns the burger or its own child, at every state, both viewports |
| Overlay interception | none — see above |
| Invisible layers | none |
| Transition / animation settling | `getAnimations()` filtered to `running`: **0**, everywhere |
| Menu button geometry | byte-identical box over **90 consecutive frames** — Playwright's own stability criterion — at every state |
| `pointer-events` | `auto` |
| Opacity / visibility / display | `1` / `visible` / rendered |
| Stacking contexts | header is the topmost positioned ancestor; no competing context over the trigger |
| Fixed canvas interception | the canvas never wins the hit test at the trigger's centre |
| Header state | correct at each scroll fraction |
| DOM event receipt | **the full sequence arrives**: `pointerover > pointermove ×3 > pointerdown > mousedown > mouseup > click` |
| `aria-expanded` | flips to `true` on every non-forced click |
| Event listener duplication | one handler, one sequence per click |
| Pending navigation / focus state | not implicated; the click resolves and the layer opens |

**A non-forced click succeeds in every arm.** There is no state in which the
click is refused, intercepted or lost. So the defect is not in the input path,
the geometry, the stacking or the application's handler.

---

## 2 · What is actually different: the page renders at 10 fps

The one number that is not clean:

```
              fps    click "opening"   click "journey"   click "destination"
1440x900      10        1963 ms            362 ms             38 ms
1920x1080     11        2742 ms            490 ms             41 ms
```

The click *succeeds* every time. It takes up to **2.7 seconds** to do it.

### The control: same commit, same build, only the rasteriser changes

Playwright's Chromium runs headless on SwiftShader, a CPU rasteriser. The
desktop homepage is a full-viewport WebGL journey. Re-run with ANGLE onto the
platform's own Metal backend and nothing else altered:

| | SwiftShader | ANGLE Metal (Apple M4) |
|---|---|---|
| Renderer string | `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0)), SwiftShader driver)` | `ANGLE (Apple, ANGLE Metal Renderer: Apple M4)` |
| fps @ 1440 | **10** | **60** |
| fps @ 1920 | **11** | **60** |
| click "opening" @ 1440 | 1963 ms | **37 ms** |
| click "opening" @ 1920 | 2742 ms | **38 ms** |
| click "journey" @ 1920 | 490 ms | 36 ms |
| box stability | stable | stable |
| `pointer-events` | auto | auto |
| hit test | self | self |
| running animations | 0 | 0 |
| event sequence | full | full |
| `aria-expanded` after click | true | true |

**53× on the worst case, with every other measurement byte-identical.**

That is the whole finding. Playwright's actionability checks and its input
delivery are frame-synchronised: it waits for the element to be stable across
frames, then dispatches, then waits for the page to acknowledge. At 10 fps a
frame is ~100 ms, and every one of those steps costs multiples of it. The tests
that fail are the ones that make *many* such round trips:

* D4 / D7 press `Tab` **thirty times** in a loop. At the observed per-interaction
  cost that loop alone can exceed the 30 s per-test budget.
* D3 walks three header states, each a `scrollToFraction` plus a settle.
* D6 / D8 navigate to a subpage and re-exercise the header on a second full
  WebGL page load.
* D1 polls a 0.45 s CSS opacity transition with a 4 s deadline — roughly four
  frames' worth of budget at 10 fps.

### Why the forced click "works"

`force: true` skips the actionability wait. It is faster because it does less
checking — not because it routes around a defect. Recorded here because §10 asks
for it as evidence and forbids it as a fix. It is not adopted.

---

## 3 · Load sensitivity — the controlled matrix

One commit, one `dist/`, one browser binary. The only variable is how many
workers compete for the machine. `tests/homepage-chrome.spec.ts` on
`desktop-1920` and `reduced-motion`, which is where all eight live.

| arm | workers | scope | tests | failed | wall | load median | load peak |
|---|---|---|---|---|---|---|---|
| isolated | 1 | the eight only | 10 | **0** | 30 s | 6.08 | 6.46 |
| serial | 1 | the whole file | 82 | **0** | 144 s | 6.07 | 6.95 |
| moderate | 2 | the whole file | 82 | **0** | 137 s | 11.03 | 15.68 |
| normal | 5 | the whole file | 82 | **2** | 117 s | 25.16 | **28.54** |

Load is the 1-minute average on a **10-core** machine, sampled every 2 s.

The two that failed, and only at `normal`:

```
✘ desktop-1920 · the full-screen menu opens from every header state   35 s
     Error: header never reached "journey"
✘ desktop-1920 · focus is trapped inside the layer while it is open   40 s
     Test timeout of 30000ms exceeded.
```

### What the matrix establishes

* **Failures track contention, monotonically.** Zero at load ~6, zero at ~11,
  two at ~25–28. Nothing else changed between the arms.
* **They are not intrinsic to the tests.** The same eight tests, same build,
  pass in 30 s when nothing competes with them.
* **They are not intrinsic to the file's length either.** The whole 82-test file
  at one worker — five times the work of the isolated arm — is still clean. It
  is concurrency, not duration.
* **Load average 28.5 on 10 cores is 2.85× oversubscription.** Five workers each
  driving a headless Chromium that is CPU-rasterising a full-viewport WebGL page
  is what produces it, which is the same cost §2 measured directly as 10 fps.

### Why two here and eight in `npm test`

This matrix runs one spec file across two projects. `npm test` runs 987 tests
across every spec file and every project at the same five workers, so the
sustained contention is higher and lasts far longer. More of the same
frame-bound round trips cross the 30 s budget. The mechanism is identical; the
count scales with the load.

**This is diagnosis, not a recommendation.** Per §11 the point is not that
`--workers=1` makes the suite green, and it is not adopted as a fix.

### The failing set is not stable across runs at one commit

Stronger evidence than the matrix, and it arrived by accident — three full
`npm test` runs on this branch, same machine, same five workers:

| run | commit | failed | which |
|---|---|---|---|
| inventory (`cab906d`) | before this work | 8 | 6 × `desktop-1920`, 2 × `reduced-motion` |
| gate 1 (`733f9c1`) | frozen | 4 | 4 × mobile — **the original eight did not reproduce at all** |
| gate 2 (`d10c175`) | re-frozen | 7 | 5 × `desktop-1440`, 2 × `desktop-1920` — **and `desktop-1440` had never failed before** |

A deterministic defect in the header, the menu or the input path does not move
between projects and viewports from run to run while the source sits still. A
budget consumed by contention does.

And the closing measurement: the exact seven from gate 2, re-run together at one
worker, **all pass in 52.6 s total** — against 32–40 s *each* when they failed
under load.

```
✓ desktop-1440 the journey state compacts the wordmark …            3.1s
✓ desktop-1440 the header does not chatter …                        5.1s
✓ desktop-1440 opens from every header state                        7.9s
✓ desktop-1440 focus is trapped inside the layer while it is open   1.9s
✓ desktop-1440 opening the menu does not walk the journey back …    6.0s
✓ desktop-1920 the journey state compacts the wordmark …            4.1s
✓ desktop-1920 the header does not chatter …                        6.0s
✓ desktop-1920 opens from every header state                        9.3s
✓ desktop-1920 focus is trapped inside the layer while it is open   1.6s
✓ desktop-1920 opening the menu does not walk the journey back …    7.0s
10 passed (52.6s)
```

---

## 4 · Classification

| | |
|---|---|
| Verdict | **ENVIRONMENT / LOAD SENSITIVITY** |
| Real product defect | **No.** The input path is correct at every checkpoint §10 names, on both rasterisers |
| Real test defect | **Partly.** The 30 s per-test budget and the 4 s / 12 s polls are wall-clock numbers with no semantic basis, written against a machine rendering at 60 fps |

### What was NOT done, per §12

* No blanket timeout increase.
* No `waitForTimeout()` padding added.
* No `force: true` adopted as normal behaviour.
* No retries added.
* No `test.skip` placed around any of the eight.
* No assertion weakened.
* No permanent worker-count reduction. The matrix in §3 is diagnosis, and the
  brief is explicit that finding the worker count at which red becomes green is
  not the point.

Which leaves the eight red on this machine, honestly, with a measured cause —
rather than green by a mechanism that would hide the next real defect in the
same code path.

---

## 5 · The one real remedy, not taken here

There is a fix that is neither a skip, a forced click, a sleep, a retry nor a
timeout change, and it follows directly from §2: **give the harness a GPU.**

```
chromium.launch({ args: ['--use-gl=angle', '--use-angle=default',
                         '--enable-gpu', '--ignore-gpu-blocklist'] })
```

Measured above: 10 fps → 60 fps, and the worst click 2742 ms → 38 ms, with every
other property identical.

The repository has already reached this conclusion once, for the same page and
the same reason. `experiments/probe-mobile-cost.mjs` launches onto a real GPU by
default and says why in its header — SwiftShader "turns the measurement into a
measurement of the harness", with a control showing that a quarter-size buffer
removes the whole effect, "which no main-thread JavaScript regression would do".
The argument transfers to input timing without modification.

**It is not applied in this workstream**, for three reasons:

1. It changes how *every* test in the root suite runs, to repair eight — a
   blast radius that does not belong immediately before a frozen-source gate.
2. `playwright.config.ts` is shared with CI, and a CI runner typically has no
   GPU to hand out. The likely outcome is that the failures move rather than go,
   and a config that behaves differently in the two places is its own defect.
3. §22 is explicit: changing executable source or tests invalidates the freeze
   and requires a re-run of all affected gates. Doing this on evidence gathered
   an hour earlier, rather than as a considered change to the test platform, is
   how a harness acquires flags nobody can justify later.

Recommended as a **separate, deliberate decision about the test platform**, with
the measurements above as its evidence. Until it is taken, the eight are a
documented environment limitation of this machine's harness, not a defect in the
header, the menu or the input path.

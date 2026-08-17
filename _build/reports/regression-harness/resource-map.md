# Resource map — what the suite actually costs, and where

Which tests are expensive, in what currency, and which of them are competing for
the same scarce thing. Measured from the frozen baseline at `39b41cd`, not
estimated from reading the specs.

---

## 1. The scarce resource is CPU, and the reason is SwiftShader

`baseline-environment.md` §8 records the measurement in full. The short version:

| Engine | Renderer | Rasterization |
| --- | --- | --- |
| **Chromium** (4 of 8 projects) | `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0)), SwiftShader driver)` | **CPU** |
| **WebKit** (3 of 8 projects) | `Apple GPU` | **hardware** |

Every WebGL frame drawn by a Chromium project is drawn by a CPU thread pool on
the same ten cores that run the test runner, the Python web server, and the
editor session. Every WebGL frame drawn by a WebKit project costs almost nothing.

Nothing in `playwright.config.ts` distinguishes the two. All eight projects are
scheduled into one undifferentiated worker pool of five.

---

## 2. Rasterization cost per project

| Project | Engine | Logical viewport | DPR | Pixels per frame | Raster path |
| --- | --- | --- | --- | --- | --- |
| `portrait-chromium` | Chromium | 390×844 | **3** | **2.96 M** | **CPU** |
| `desktop-1920` | Chromium | 1920×1080 | 1 | 2.07 M | **CPU** |
| `desktop-1440` | Chromium | 1440×900 | 1 | 1.30 M | **CPU** |
| `reduced-motion` | Chromium | 1440×900 | 1 | 1.30 M | **CPU** |
| `mobile-430` | WebKit | 430×932 | ~1.2 | 0.57 M | GPU |
| `mobile-390` | WebKit | 390×844 | ~1.19 | 0.47 M | GPU |
| `desktop-webkit` | WebKit | 1440×900 | 1 | 1.30 M | GPU |
| `node` | — | — | — | 0 | — |

`portrait-chromium` — added as "the phone viewport on Chromium" — is the most
expensive rasterization target in the suite, 43 % more pixels per frame than the
1920×1080 desktop project, all of them software.

---

## 3. WebGL instantiations per full-suite run

A "homepage load" means the Three.js scene is constructed and a `.glb` decoded.

| Spec | Loads per run of the file | Projects | Loads per full suite |
| --- | --- | --- | --- |
| `homepage-chrome.spec.ts` | 35 | 5 | **175** |
| `mobile-homepage-simple.spec.ts` | 27 | 5 | **135** |
| `public-site.spec.ts` | 12 | 5 | **60** |
| `homepage-modality.spec.ts` | ~2 | 4 | 8 |
| `homepage-history.spec.ts` | ~1 | 4 | 4 |
| everything else | 0 | — | **0** |

≈ **380 scene instantiations per run**, from **five of eighteen** spec files.
Served payload each time: 1.4 MB of `dist/assets/home` plus one model
(`stratos-altimeter.glb` 388 KB, `stratos-mountains-desktop.glb` 340 KB, or
`stratos-mountains-mobile.glb` 176 KB).

---

## 4. Measured cost, from baseline run 1

Sum of test durations per spec file. Total test-time **2 792 s** against a wall
clock of **579 s** — an achieved parallelism of **4.82×** on five workers, i.e.
the pool is ~96 % saturated for the whole run.

| Spec file | Test-seconds | Share | Class |
| --- | --- | --- | --- |
| `homepage-chrome.spec.ts` | **1 007 s** | 36.1 % | **RENDERING / WebGL** |
| `lead-forms.spec.ts` | **778 s** | 27.9 % | **INTERACTION** (no WebGL) |
| `public-site.spec.ts` | 230 s | 8.2 % | RENDERING / WebGL |
| `mobile-homepage-simple.spec.ts` | 228 s | 8.2 % | RENDERING / WebGL |
| `analytics.spec.ts` | 130 s | 4.7 % | INTERACTION |
| `homepage-modality.spec.ts` | 109 s | 3.9 % | RENDERING / WebGL |
| `homepage-history.spec.ts` | 94 s | 3.4 % | RENDERING / WebGL |
| `portal.spec.ts` | 30 s | 1.1 % | LIGHT DOM |
| `not-found.spec.ts` | 30 s | 1.1 % | LIGHT DOM |
| `attribution.spec.ts` | 20 s | 0.7 % | INTERACTION |
| `portal-control-room.spec.ts` | 4 s | 0.1 % | LIGHT / filesystem |
| `structured-data.spec.ts` | 3 s | 0.1 % | filesystem |
| `lead-notify.spec.ts` | 2 s | <0.1 % | in-process |
| `portal-analytics.spec.ts` | 2 s | <0.1 % | in-process |
| `portal-revenue.spec.ts` | **0 s** | 0 % | **pure functions + filesystem** |
| `lead-endpoint.spec.ts` | 0 s | 0 % | in-process |
| `portal-health.spec.ts` | 0 s | 0 % | in-process |
| `redirects.spec.ts` | 0 s | 0 % | in-process |

**Two files are 64 % of the suite's cost.** The entire P2 change surface —
`portal-revenue`, `portal-control-room`, `portal` — is 34 s, 1.2 %.

### By project

| Project | Test-seconds | Note |
| --- | --- | --- |
| `desktop-1920` | 778 s | carries the hardening suites *and* the general suite |
| `desktop-1440` | 550 s | |
| `mobile-390` | 461 s | GPU-rastered, and still third |
| `mobile-430` | 402 s | |
| `reduced-motion` | **402 s** | **see §6 — mostly duplicated work** |
| `portrait-chromium` | 46 s | 3 tests |
| `desktop-webkit` | 22 s | 3 tests |
| `node` | 7 s | 202 tests |

`node` runs 202 tests in 7 seconds. `desktop-1920` runs 150 in 778.

---

## 5. The ten most expensive individual tests (run 1)

| Duration | Project | Test |
| --- | --- | --- |
| 70.1 s | `desktop-1920` | `homepage-modality` — keyboard focus stays in the layer ✘ |
| 46.8 s | `desktop-1920` | `homepage-history` — back and forward restore the position ✘ |
| 40.0 s | `reduced-motion` | `homepage-chrome` — focus is trapped inside the layer ✘ |
| 40.0 s | `desktop-1920` | `homepage-chrome` — focus is trapped inside the layer ✘ |
| 36.0 s | `mobile-430` | `lead-forms` — rate-limited screen on 429 |
| 35.7 s | `mobile-430` | `lead-forms` — the wizard submits and shows success |
| 34.9 s | `desktop-1920` | `lead-forms` — the wizard submits and shows success |
| 34.7 s | `desktop-1920` | `lead-forms` — rate-limited screen on 429 |
| 34.7 s | `desktop-1440` | `lead-forms` — the wizard submits and shows success |
| 34.6 s | `reduced-motion` | `lead-forms` — the wizard submits and shows success |

Every failure in run 1 is in the top four. The `lead-forms` block that follows it
holds `test.slow()` for the whole file (a 90 s budget), which is why those tests
are slow rather than failing: **they were already given three times the timeout,
which is the mitigation this workstream is forbidden from repeating.**

---

## 6. Duplicated work: the `reduced-motion` project

`reduced-motion` is `Desktop Chrome` at 1440×900 with `reducedMotion: 'reduce'`
declared in its `use` block. It carries **147 tests**:

| File | Tests in `reduced-motion` | Tests that call `enableReducedMotion` |
| --- | --- | --- |
| `homepage-chrome.spec.ts` | 41 | 13 |
| `public-site.spec.ts` | 29 | 5 |
| `lead-forms.spec.ts` | 29 | **0** |
| `mobile-homepage-simple.spec.ts` | 27 | 2 |
| `portal.spec.ts` | 21 | **0** |
| **Total** | **147** | **20** |

The suite's own canary — `public-site.spec.ts:327`, "the reduced-motion test
environment is genuinely active" — asserts that a page in this project reports
`matchMedia('(prefers-reduced-motion: reduce)').matches === false` until the test
calls the helper. **That canary passes in the baseline.** So for the 127 tests
that never call the helper, this project is `desktop-1440` again: same engine,
same viewport, same media state, same page — a second full software-rastered run
of the same assertions.

`lead-forms.spec.ts` (29 tests) and `portal.spec.ts` (21 tests) contain no
reduced-motion opt-in at all and are duplicated in their entirety.

### One correction to the repository's own note

`tests/helpers/reduced-motion.ts` states that the declarative option "does not
reliably reach `matchMedia()` … on Playwright 1.62.1". Probed directly, a context
created with `browser.newContext({ ...devices['Desktop Chrome'], viewport: …,
reducedMotion: 'reduce' })` **does** report `matches === true`. The behaviour
therefore differs between the raw API and the way the test fixture composes
context options; the helper's operational conclusion is correct — and is
independently confirmed by the passing canary — but the stated cause is not the
whole story. Recorded so a future reader does not rediscover it as a
contradiction.

---

## 7. Resource classes, as they should have been declared

| Class | What it needs | Files | Test-seconds | Current scheduling |
| --- | --- | --- | --- | --- |
| **IN-PROCESS / FILESYSTEM** | nothing | `lead-endpoint`, `structured-data`, `portal-analytics`, `portal-health`, `lead-notify`, `redirects`, `portal-revenue`, most of `portal-control-room` | ~9 s | already isolated in `node` — correct |
| **LIGHT DOM** | a browser page, no scene | `portal`, `not-found`, `attribution` | ~54 s | mixed into the general pool |
| **INTERACTION** | a browser page, forms, real timing | `lead-forms`, `analytics` | ~908 s | mixed into the general pool |
| **RENDERING / WebGL** | a scene, a raster budget, and **exclusivity** | `homepage-chrome`, `public-site`, `mobile-homepage-simple`, `homepage-modality`, `homepage-history` | ~1 668 s | **mixed into the general pool** |

The last row is the defect. 60 % of the suite's cost is work that competes for a
resource — CPU raster throughput — that the configuration does not model at all,
and it is scheduled interchangeably with work that needs none of it.

---

## 8. What starves what

The mechanism, stated as a chain:

1. `workers` is unset locally → Playwright uses 50 % of logical cores → **5**.
2. `fullyParallel: true` → those five workers pull tests from all eight projects.
3. Four of eight projects are Chromium, and the three heaviest files run on five
   projects each — so five workers running homepage tests simultaneously is the
   *normal* case, not the edge case.
4. Each Chromium WebGL page rasterises through SwiftShader, whose thread pool is
   sized against the machine's core count.
5. Five such pages therefore ask for roughly five times the machine's cores in
   raster threads alone.
6. Load average during baseline run 1 rose from 1.38 at rest to a peak of
   **75.5** on a 10-core machine — measured, sampled every 15 s.
7. At that oversubscription the per-page frame rate collapses. Everything that
   Playwright derives from frames — element **stability** (two consecutive
   animation frames with an unchanged box), input dispatch, `waitForFunction`
   polling — stretches with it.
8. Which test crosses its 30 s budget first depends on what else happened to be
   scheduled beside it. **That is the wandering.**

The failure evidence from run 1 matches this chain exactly:

* `homepage-chrome:422` — `locator.click` timed out **"waiting for element to be
  visible, enabled and stable"**. The element was found and resolved; the click
  was never dispatched. The failure is *before* input delivery (§10 of the
  brief), and the specific condition is **stability**, which is measured in
  frames.
* `homepage-chrome:470` and `homepage-modality:220` — timed out inside a loop of
  30 `keyboard.press('Tab')` calls, each a protocol round-trip into a starved
  renderer.
* `homepage-history:223` — a 20 s `waitForFunction` on a scroll-derived state.

None of these is an assertion that found the product wrong. All of them are the
harness failing to get a frame.

---

## 9. The one failure that does not fit the chain

`mobile-homepage-simple.spec.ts:170` — *"the renderer is not requested at all when
there is no WebGL"* — failed on **both** WebKit projects, `mobile-390` and
`mobile-430`, at 22.9 s and 23.6 s.

It does not fit because WebKit is GPU-rastered and pays none of the SwiftShader
cost, and because it failed on both WebKit projects in the same run rather than
on whichever one lost the scheduling lottery. It fails inside the `revealed()`
helper, waiting for every `.mv-text` / `.mv-copy` / `.mv-lines` element to have
gained `.is-in`.

That is the shape of a real defect on the no-WebGL fallback path, and it is
carried forward to the failure classification and root-cause work as the leading
candidate for class **A** or **B**. It is exactly the kind of finding a noisy
baseline hides: a stable, reproducible, engine-specific failure sitting in a list
of six timeouts that everybody had learned to discount.

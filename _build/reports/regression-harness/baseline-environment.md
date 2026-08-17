# Baseline environment — frozen state before any harness change

Recorded before one source or test file was touched. Everything measured below
describes the machine and the configuration that produced the wandering failure
set described in `portal-p2-revenue-operations.md` §9.

---

## 1. Commit and working tree

| | |
| --- | --- |
| HEAD | `39b41cd4658f80007e5741a025f44fe8b149170c` |
| Branch | `portal-p1-control-room` |
| Subject | `docs: correct the test claims, which were wrong` |
| Working tree | 126 entries reported by `git status --short` |
| Tracked modifications | `_build/reports/portal-p2-revenue-operations.md` (report text only, from the preceding verdict-clarification pass), plus six binary/report artefacts |
| Untracked | `design-system/`, `_build/reports/*` artefacts, and ~80 `experiments/.tmp-*.mjs` probe scripts |

**No tracked executable source or test file is modified at the baseline.** The
suite measured below is the suite as committed at `39b41cd`.

## 2. Toolchain

| | |
| --- | --- |
| Node | v24.18.1 |
| npm | 11.16.0 |
| Playwright (declared) | `@playwright/test` `^1.49.1` |
| Playwright (installed) | **1.62.1** |
| Python (test web server) | 3.9.6 |

The declared range `^1.49.1` resolved to 1.62.1 — thirteen minor versions of
drift between what `package.json` asks for and what runs. Noted here because a
harness whose browser and runner version is not pinned cannot claim
"same environment"; see §7 of this document and the root-cause report.

## 3. Browser builds present

```
chromium-1234            chromium-1237
chromium_headless_shell-1234   chromium_headless_shell-1237
webkit-2336              webkit-2342
firefox-1539             ffmpeg-1011
```

Two Chromium builds and two WebKit builds are installed side by side. Playwright
1.62.1 uses `chromium-1237` / `webkit-2342`; the 1234/2336 pair is left over from
the previously declared version. Nothing in the suite selects a build explicitly,
so which one runs is decided entirely by the installed runner version.

## 4. Host

| | |
| --- | --- |
| OS | macOS 26.6.1 (build 25G76) |
| Architecture | arm64 (Apple silicon) |
| CPU cores | 10 physical / 10 logical |
| RAM | 24 GiB (25 769 803 776 bytes) |
| Load average at inventory time | **1.38 / 2.57 / 9.99** (1 / 5 / 15 min) |

The 15-minute load average of **9.99 on a 10-core machine** was recorded *before*
any test run started. The machine was already at one runnable thread per core
from the preceding session's work.

### Processes competing for the same cores

| Process | %CPU at inventory |
| --- | --- |
| Claude Helper (Renderer) | 43.0 |
| Claude Helper | 39.9 |
| WindowServer | 36.2 |
| `cloudd` (CloudKit) | 9.6 |
| `nsurlsessiond` | 7.3 |
| `bird` (iCloud Drive) | 2.3 |
| `fileproviderd` | 0.5 |

**The test suite does not have the machine to itself, and never has.** The agent
session driving the suite is itself the largest single CPU consumer. Any baseline
taken here is a baseline of *this* arrangement, which is stated rather than
corrected because it is also the arrangement in which every previous phase's
gate was run.

## 5. The repository lives in iCloud Drive

Working directory:

```
/Users/arturlukacs/Library/Mobile Documents/com~apple~CloudDocs/Downloads/StratosWeb
```

This is a **file-provider-backed volume**, not a local one. Two consequences are
measurable right now:

**Sync-conflict duplicates.** 170 files matching `* <n>.<ext>` exist in the tree
— `playwright.config 2.ts`, `package 2.json`, `tests/portal.spec 2.ts`,
`dist/models/stratos-altimeter 3.glb`, and so on. `.gitignore:37` already ignores
the pattern `* [0-9].*`, and Playwright's default `testMatch` requires a literal
`.spec.ts` suffix, so **none of them are collected as tests** — verified against
the collected total in §6. They are inert, but they are evidence that iCloud has
been resolving write conflicts inside the working tree.

**Evicted (dataless) file content.** `ls -lO dist/models/` reports:

```
compressed,dataless  396912  stratos-altimeter 3.glb
-                    396912  stratos-altimeter.glb
compressed,dataless  345744  stratos-mountains-desktop 3.glb
-                    345744  stratos-mountains-desktop.glb
compressed,dataless  177816  stratos-mountains-mobile 3.glb
-                    177816  stratos-mountains-mobile.glb
```

The files the suite actually serves are materialised (`-`). Their conflict twins
are `dataless` — the content has been evicted to iCloud and a read would block on
a network download. The served set is fine *at this instant*; the point on record
is that eviction is active in this tree, and a dataless read of a served asset is
a multi-second stall that no test timeout would attribute correctly.

## 6. Test inventory

`npx playwright test --list`:

```
Total: 1305 tests in 18 files
```

Reconciliation against the P2 report, which is the arithmetic §24 of the
stabilization brief requires:

| | |
| --- | --- |
| Declared at P1 acceptance | 1 161 |
| Added by P2 (`portal-revenue.spec.ts`, 72 × 2 projects) | 144 |
| **Expected** | **1 305** |
| **Collected** | **1 305** ✅ |

The 18 files are the 18 `*.spec.ts` in `tests/`. The four iCloud twins
(`lead-endpoint.spec 2.ts`, `lead-forms.spec 2.ts`, `portal.spec 2.ts`,
`public-site.spec 2.ts`) are **not** among them.

## 7. Playwright configuration as committed

From `playwright.config.ts` at `39b41cd`:

| Setting | Local value | CI value |
| --- | --- | --- |
| `fullyParallel` | `true` | `true` |
| `workers` | **`undefined`** → Playwright default = 50 % of cores = **5** | `2` |
| `retries` | **`0`** | `2` |
| `reporter` | **`[['list']]`** — human-readable only, **no machine-readable output** | `[['github'], ['html']]` |
| `trace` | `on-first-retry` (so: never, locally, since retries = 0) | on first retry |
| `screenshot` | `only-on-failure` | same |
| Per-test timeout | Playwright default **30 000 ms** (not overridden) | same |
| `webServer` | `python3 -m http.server 4322 --directory dist` | same |
| `webServer.reuseExistingServer` | `true` | `false` |

### The seven projects

| Project | Engine | Viewport | DPR | Carries |
| --- | --- | --- | --- | --- |
| `node` | none | — | — | 6 filesystem/in-process specs |
| `desktop-1440` | Chromium | 1440×900 | 1 | everything except node + hardening |
| `desktop-1920` | Chromium | 1920×1080 | 1 | everything except node + engine-only |
| `mobile-390` | WebKit (iPhone 13) | 390×844 | ~1.19 | everything except node |
| `mobile-430` | WebKit (iPhone 14 Pro Max) | 430×932 | — | everything except node/engine-only/hardening |
| `desktop-webkit` | WebKit | 1440×900 | 1 | hardening only |
| `portrait-chromium` | Chromium | 390×844 | **3** | hardening only |
| `reduced-motion` | Chromium | 1440×900 | 1 | everything except node/engine-only/hardening |

**Four of the eight projects are Chromium.** That matters because of §8.

## 8. Rasterization state — measured, not assumed

Probed directly by launching each engine and reading
`WEBGL_debug_renderer_info` from a real page:

| Project shape | Engine | `UNMASKED_RENDERER_WEBGL` | Rasterization |
| --- | --- | --- | --- |
| chromium desktop | Chromium | `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0) (0x0000C0DE)), SwiftShader driver)` | **software (CPU)** |
| chromium 390×844 @ DPR 3 | Chromium | same SwiftShader string | **software (CPU)** |
| webkit desktop | WebKit | `Apple GPU` (vendor `Apple Inc.`) | **hardware** |
| webkit iPhone 13 | WebKit | `Apple GPU` | **hardware** |

This is the single most consequential environmental fact in this document.

* **Every Chromium project rasterises the homepage's WebGL scene on the CPU**,
  through SwiftShader, on the same 10 cores that run the Node test runner, the
  Python web server, the agent session and WindowServer.
* **Every WebKit project uses the real GPU** and pays almost none of that cost.
* The asymmetry is invisible in the configuration. Nothing in
  `playwright.config.ts` says "these four projects are 10× more expensive than
  those two", and the worker pool treats all eight as interchangeable units.

Pixel cost per rendered frame, for scale:

| Project | Logical | DPR | Rastered pixels/frame | Path |
| --- | --- | --- | --- | --- |
| `desktop-1920` | 1920×1080 | 1 | 2.07 M | CPU |
| `desktop-1440` | 1440×900 | 1 | 1.30 M | CPU |
| `reduced-motion` | 1440×900 | 1 | 1.30 M | CPU |
| `portrait-chromium` | 390×844 | **3** | **2.96 M** | CPU |
| `mobile-390` | 390×844 | 1.19 | 0.47 M | GPU |

`portrait-chromium` — nominally "the phone project" — is the **most expensive
rasterization target in the entire suite**, 43 % more pixels per frame than the
1920×1080 desktop project, all of them drawn by SwiftShader on the CPU.

## 9. WebGL load distribution across the suite

Homepage navigations per spec file (each one instantiates the Three.js scene and
loads a `.glb`):

| Spec | Homepage loads | Tests in file | Projects it runs on | Homepage loads per full suite |
| --- | --- | --- | --- | --- |
| `homepage-chrome.spec.ts` | 35 | 46 | 5 | **175** |
| `mobile-homepage-simple.spec.ts` | 27 | 28 | 5 | **135** |
| `public-site.spec.ts` | 12 | 22 | 5 | **60** |
| `homepage-modality.spec.ts` | ~1 per test | 2 | 4 | 8 |
| `homepage-history.spec.ts` | ~1 per test | 1 | 4 | 4 |
| every other spec | 0 | — | — | 0 |

Roughly **380+ full WebGL homepage instantiations per full-suite run**, the large
majority of them software-rastered, scheduled into the same undifferentiated
5-worker pool as the 700-odd filesystem and DOM assertions that cost nothing.

Served payload per instantiation: `dist/assets/home` is 1.4 MB of JavaScript,
plus one of `stratos-altimeter.glb` (388 KB), `stratos-mountains-desktop.glb`
(340 KB) or `stratos-mountains-mobile.glb` (176 KB).

## 10. The web server under test

```
python3 -m http.server 4322 --directory dist
```

Python 3.9.6's `http.server` main entry point uses `ThreadingHTTPServer`, so
requests are not strictly serialised — but they are served by a GIL-bound
interpreter doing blocking file reads **from an iCloud-backed volume** (§5),
against up to five browser workers each pulling 1.4 MB of bundle plus a model
per page load.

`reuseExistingServer: true` locally means the server may be one a previous run
left behind, of unknown age and unknown warmth.

## 11. Timing-sensitive constructs already in the tests

Counted at the baseline, across `tests/`:

| Construct | Count |
| --- | --- |
| `page.waitForTimeout(...)` | **67** |
| explicit `timeout: <n>` overrides | 57 |
| `test.setTimeout` / `test.slow` | 5 |
| `networkidle` waits | 1 |
| `force: true` | 1 |

Distribution of `waitForTimeout` by file:

| File | Count |
| --- | --- |
| `mobile-homepage-simple.spec.ts` | 23 |
| `analytics.spec.ts` | 19 |
| `homepage-chrome.spec.ts` | 11 |
| `public-site.spec.ts` | 3 |
| `lead-forms.spec.ts` | 3 |
| `homepage-history.spec.ts` | 1 |
| `not-found.spec.ts` | 1 |

Not all 67 are blind sleeps — a substantial number are **poll intervals** inside
bounded settle loops (`settle`, `restingScrollY`, `restingAltitude` in
`homepage-chrome.spec.ts`). Those loops are analysed as a failure mechanism in
their own right in the root-cause report: they are bounded by *iteration count*
and **return a non-settled value silently when the bound is exhausted**, which is
how CPU starvation converts into an assertion failure somewhere else entirely.

## 12. Environment variables relevant to the run

| Variable | Value at baseline |
| --- | --- |
| `CI` | unset — so: 5 workers, 0 retries, list reporter, `reuseExistingServer` |
| `PLAYWRIGHT_JSON_OUTPUT_NAME` | unset in the committed configuration |
| `PWDEBUG`, `PLAYWRIGHT_HTML_REPORT` | unset |

Baseline runs for this workstream add `--reporter=list,json` and
`PLAYWRIGHT_JSON_OUTPUT_NAME` **on the command line only**. No file is modified
to capture them, so the measured suite is still the committed suite.

## 13. What this environment cannot answer

Stated up front so the root-cause report is not read as more than it is:

* **Whether CI behaves the same.** No CI configuration was found in the tree at
  this commit; the `process.env.CI` branches in `playwright.config.ts` are
  written but nothing in the repository exercises them.
* **Whether hardware-accelerated Chromium changes the failure set.** Probed in
  the investigation; not the baseline.
* **What the suite does on an idle machine.** The machine is not idle and was not
  idle at any previous phase's gate either.

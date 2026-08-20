# The four failures of `final-closure-01` — inventory

Source of record: `_build/reports/hermetic-gate/runs/final-closure-01/gate.json`
(in the hermetic subject worktree), reconciled against `gate.log` lines 56–61.

Nothing in this document is inferred from a prior prompt. Every identity,
assertion and value below is read either from that artefact or from a
measurement taken against the same frozen `dist` (`2538acb4…`).

> **One evidence loss, stated.** The run's three `test-failed-1.png` screenshots
> and their `error-context.md` files were written to
> `<subject>/test-results/…`, and that directory was overwritten by the first
> reproduction run of this workstream before it was copied. The failing states
> have been **re-created and re-photographed** instead — see
> `evidence/contract-a-defect-13176.png` — so §14 is satisfied by a reproduction
> rather than by the original capture. The JSON record of all four failures is
> intact and is what the identities below are read from.
>
> The re-created screenshots live at
> `_build/reports/scroll-altimeter-four/evidence/` **on disk but not in git**:
> `.gitignore:51` excludes `_build/reports/**/*.png`, which is this repository's
> existing convention for every report's imagery. It was not overridden here.

---

## CONTRACT A

| | |
|---|---|
| Spec file | `tests/homepage-chrome.spec.ts` |
| Test name | *the readout names the stage the journey reports* |
| Line | 482 (assertion at 496) |
| Project / engine | `desktop-1920` — Chromium, SwiftShader |
| Viewport | 1920 × 1080, DPR 1 |
| Route | `/index.html` — the desktop cinematic composition |
| Duration | 15 450 ms |
| Assertion | `expect(key.toLowerCase()).toBe(stage.toLowerCase())` |
| Expected | `"rendszer"` — the HUD's live stage region (`[data-testid="altitude-stage"]`) |
| Actual | `"munkáink"` — the header's stage label (`.nav__alt-k`) |
| Scroll position | `scrollToFraction(page, 0.6)` → `scrollY = 0.6 × (scrollHeight − innerHeight)`; measured 14 453 px of 24 089 px travel on the reference host |
| Stage / chapter | HUD in `system` (17 000–22 000 m); header still printing `selected-work` (11 000–17 000 m) |
| Altimeter state | Unaffected. The Meridian instrument's own state is a function of altitude and was correct; this contract is about the two **text** surfaces |
| Screenshot | `evidence/contract-a-defect-13176.png` (defect) · `evidence/contract-a-good-13183.png` (same page, 7 px further down) |
| Last confirmed behavioural boundary | The header's last **painted** progress. `Stratos.header.push()` updates `last` only when it paints, so everything after that paint — including a stage change — is invisible to the header until progress moves 0.0004 of the track from it |

## CONTRACT B

| | |
|---|---|
| Spec file | `tests/mobile-homepage-simple.spec.ts` |
| Test name | *the altitude advances with the document and settles at the ceiling* |
| Line | 591 (assertion at 604) |
| Project / engine | `mobile-390` — WebKit, `devices['iPhone 13']` |
| Viewport | 390 × 664 visible, DPR 3 |
| Route | `/` — the portrait composition (`[data-testid="mobile-home"]`) |
| Duration | 5 878 ms |
| Assertion | `expect(bottom).toBe(30000)` |
| Expected | `30000` |
| Actual | `0` |
| Scroll position | `scrollTo({ top: document.documentElement.scrollHeight })` → clamped to 13 408 px of 14 072 px document, 664 px viewport |
| Stage / chapter | Document at `destination`; readout still printing the value from **the top of the page** |
| Altimeter state | Correct. The instrument had receded to its Arrival state; only the telemetry digits were stale |
| Screenshot | none needed — nothing is mis-rendered; see the root cause |
| Last confirmed behavioural boundary | `scrollY` is already 13 408 and the readout still says `0`. The divergence is exactly: **scroll landed, ascent reader has not yet run its one coalesced pass** |

## CONTRACT C

| | |
|---|---|
| Spec file | `tests/mobile-homepage-simple.spec.ts` |
| Test name | *the menu opens, locks only while it is open, and leaves the ascent where it was* |
| Line | 638 (assertion at 745) |
| Project / engine | `mobile-390` — WebKit, `devices['iPhone 13']` |
| Viewport | 390 × 664 visible, DPR 3 |
| Route | `/` |
| Duration | 9 013 ms |
| Assertion | `expect(Math.abs(altitude − altitudeBefore)).toBeLessThanOrEqual(60)` |
| Expected | `<= 60` |
| Actual | `14970` |
| Scroll position | `scrollTo({ top: 5200 })`, held across a menu open/close |
| Stage / chapter | `selected-work`. **Measured settled altitude at `scrollY = 5200` on this project: exactly 14 970 m** — so `altitudeBefore` was `0` and the post-menu reading was correct |
| Altimeter state | Correct throughout: hidden behind the open layer by `recompose(menuOpen())`, restored on the close edge |
| Screenshot | none needed — nothing is mis-rendered |
| Last confirmed behavioural boundary | Identical to Contract B: `scrollY` is 5 200 and the readout still holds the pre-scroll `0` |

## CONTRACT D

| | |
|---|---|
| Spec file | `experiments/tests/full-ascent.spec.ts` |
| Test name | *the stage announced at a scroll position does not depend on the direction* |
| Line | 1342 (the wait that expired is at 1439) |
| Project / engine | `desktop` — Chromium, SwiftShader, `playwright.full.config.ts` |
| Viewport | 1440 × 900, DPR 1 |
| Route | `/experiments/stratos-ascent-full/` |
| Duration | 303 456 ms against `test.setTimeout(300_000)` |
| Assertion | **None ran.** `Test timeout of 300000ms exceeded` inside `settleAt`'s `page.evaluate` |
| Expected | — |
| Actual | — |
| Scroll position | Inside the forward/backward sweep over five sampled stage boundaries |
| Stage / chapter | Not reached |
| Altimeter state | Not reached |
| Screenshot | none — the test never asserted |
| Last confirmed behavioural boundary | The 20 damper-settle waits. Measured on a quiet reference host: one wait costs **6 766 ms over 42 frames**, twenty cost **135 s**, and the whole test costs **129 s** — a 2.3× margin under a 300 s constant. `final-closure-01` ran `playwright-full` 1.55× slower than G6 at five parallel workers, which consumes that margin |

### The same test failed the same way in `g5-02`

```
duration 306 645 ms · "Test timeout of 300000ms exceeded" · page.evaluate at :1439
```

Same line, same mechanism, same 1–2 % overrun. It is a known member of this
group and not a regression introduced by the manifest fix.

---

## §3 — grouping

Not one root cause, and not four independent issues. **Three populations.**

| Population | Contracts | Shared cause |
|---|---|---|
| **P1 — a shared-header product defect** | A | `Stratos.header.push()` discards the pushed `alt` and `key` on any frame whose progress moved less than the paint gate. On the two homepage compositions those two values are *not* functions of progress, so they can change while progress does not — and the header then keeps a stale stage label and a stale altitude **permanently**, because the page has stopped moving |
| **P2 — a fixed sleep standing in for the ascent reader** | B, C | Both read the portrait telemetry `200 ms` after a programmatic scroll. `ascent.ts` coalesces to **one reader pass per animation frame**; when no frame lands inside that window the readout still holds its previous value, which at the top of the document is `0`. That is the literal source of both `0` and `14970` |
| **P3 — a constant budget over a frame-rate-dependent wait** | D | 20 damper-settle waits whose wall-clock cost is inversely proportional to the frame rate the harness grants, under a fixed 300 s test timeout |

They are grouped by measured mechanism, not by the words "scroll" and
"Altimeter" appearing in all four titles. Contract A is a desktop text-surface
defect; B and C are portrait test races; D never reached an assertion at all.

## §20 — viewport dependence

| Contract | mobile-390 | mobile-430 | desktop-1440 | desktop-1920 |
|---|---|---|---|---|
| A | n/a — the portrait page has no `.nav__alt-k` beside a HUD, but **it pushes through the same `push()`**, so the defect is reachable there too | n/a | carries the test | **failed here** |
| B, C | **failed here** | carries the tests, did not fail this run | n/a | n/a |
| D | passes — the mobile projects converge inside the budget | passes | **failed here** | n/a |

Contract D's viewport dependence is not a layout difference: `desktop` renders
four times the pixels of a phone project through the same software rasteriser,
so it gets the fewest frames and is the only project that runs out of budget.

## §21 — DPR

Nothing in these four contracts compares a CSS pixel with a drawing-buffer
pixel. No DPR change is proposed and none is warranted.

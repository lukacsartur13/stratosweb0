# Homepage header and Arrival footer integration

A focused Phase 8.5 follow-up. Not a redesign, not Phase 9.

---

## 1 · Baseline

| | |
|---|---|
| Branch | `main` |
| Commit at start | `f682820` — *feat(brand): the wordmark in Aboreto, an honest project count, two equal portraits* |
| Working tree | clean of source changes; five tracked files modified (`.claude/settings.local.json`, three `_build/reports/*.json`, `portal/tsconfig.app.tsbuildinfo`), all of them generated or local |
| Staged | nothing |
| Untracked | review screenshots under `_build/reports/`, `experiments/.tmp-*.mjs` probes, `test-results/` — none of it source |

### What the homepage is, before this change

| | |
|---|---|
| Entry documents | `experiments/home/{hu,en,de}.html` — three hand-written shells |
| Build | `experiments/vite.home.config.ts` → `dist/index.html`, `dist/en/index.html`, `dist/de/index.html` |
| Application | `experiments/src/full/main.tsx` mounts `FullAscent` into the shell's `<main class="journey" id="main">` |
| Progress source | `journey.current` (eased 0–1) and `journey.altitude` (metres) in `experiments/src/full/journey.ts`, advanced once per frame by the single clock in `JourneyHUD` |
| Final section | `Destination()` in `FullAscent.tsx` — the last panel *inside* the sticky track |
| Header | **none** |
| Menu | **none** |
| Footer | `<footer class="journey__footer">` — a homepage-only line of links + a locale switch |
| Phase 7 lifecycle | `assets/js/transitions.js`, linked by the shell; focus is handed to `#main` on reveal |
| Reduced motion | `capabilities.detect()` returns `reduced-motion`; the scene chunk is never requested, the track un-sticks, `JourneyHUD` is not mounted, so **no clock runs** |

### What the subpages already have (Phase 8.5, accepted)

| Concern | Owner |
|---|---|
| Header markup + menu markup | `SHELL` in `_build/build.py` |
| Footer + Arrival markup | `FOOTER` in `_build/build.py`, `build_footer()` |
| Header states, menu, focus trap, scroll lock, Return to 0 m | `assets/js/header.js` |
| Meridian Trace / CTAConvergence primitives | `assets/js/motion.js`, `assets/css/motion.css` |
| Form submission | `assets/js/lead.js` |
| Chrome styling | `assets/css/main.css` (before this change) |

`assets/js/header.js` already carried a hook for exactly this task:

> The homepage is a separate React/WebGL bundle with its own canonical journey
> progress, and document scroll position is not that progress. So this file
> does not guess: `Stratos.header.drive(fn)` lets the homepage supply the real
> number.

That hook is what this change uses — with one correction, described below.

---

## 2 · What changed

### New files

| File | What it is |
|---|---|
| `assets/css/chrome.css` | The chrome's stylesheet — tokens, flight deck, full-screen menu, Arrival, footer. **Cut** from `main.css` and `motion.css`, not copied: there is still exactly one `.nav`, one `.menu`, one `.arrival` and one `.foot` in the codebase. Both surfaces link this file. |
| `experiments/src/full/siteHeader.ts` | The homepage's adapter onto the shared header. Supplies progress, real altitude, stage label and stage-derived state boundaries. Called from the journey's existing frame; starts no loop. |
| `_build/home-chrome.json` | Generated. Four chrome strings × three locales, written by `build.py`, substituted into the shells by Vite. |
| `tests/homepage-chrome.spec.ts` | The coverage this work needed and the codebase did not have — see §9. |

### Modified

| File | Change |
|---|---|
| `_build/build.py` | `DECK` extracted from `SHELL` so two surfaces can render it; `build_deck()`; `root_links()` context manager and `root_href()` for the homepage's root-absolute links; `build_home_chrome()` / `write_home_chrome()`; `converge_state_home` in all three locales; homepage arrow-glyph suppression. |
| `assets/js/header.js` | `drive(fn)` → `push(p, meta)` + `release()`; mutable `EDGES`; altitude and stage label accepted from the caller; `stratos:menu` announcement on both layer edges; distance-aware Return to 0 m; **`resolve()` fixed-point bug** (§8). |
| `assets/css/main.css`, `assets/css/motion.css` | 610 lines of chrome removed, now in `chrome.css`. |
| `assets/js/motion.js` | Honours `data-motion-external` so it registers no primitive inside the journey subtree. |
| `experiments/home/{hu,en,de}.html` | Four `<!--stratos:*-->` slots, `journey-home` body class, `data-ceiling`, Aboreto preload, `data-motion-external` on `<main>`. |
| `experiments/src/full/FullAscent.tsx` | The homepage-only footer deleted. |
| `experiments/src/full/components/JourneyHUD.tsx` | Calls `publishHeader()` in the existing tick; `releaseHeader()` on unmount. |
| `experiments/src/full/useJourneyScroll.ts` | Both scroll readers stand down while the layer's scroll lock is up. |
| `experiments/vite.home.config.ts` | `injectChrome()` — substitutes the four slots, and **throws** if a shell has lost one. |
| 67 generated `.html` | Regenerated output. |

## 3 · Shared components reused, and what is homepage-specific

Reused **unchanged**, from one source: header markup, menu markup, Arrival markup, footer markup (`build.py`); all chrome styling (`chrome.css`); the state machine, focus trap, scroll lock and Return to 0 m (`header.js`); TraceLine and CTAConvergence (`motion.js`); the newsletter controller (`lead.js`).

Homepage-specific, and only this:

* `siteHeader.ts` — 118 lines, the adapter.
* `root_href()` — the homepage is one application at three URLs (`/`, `/en/`, `/de/`) and the dev server serves it from a fourth (`/home/hu.html`), so its chrome links root-absolutely. Everything else keeps relative links.
* `converge_state_home` — the homepage has actually flown the 30 000 m, so its convergence says `EMELKEDÉS BEFEJEZVE` / `ASCENT COMPLETE` / `AUFSTIEG ABGESCHLOSSEN` where the other routes say *calibration complete*.
* No arrow glyph on homepage buttons: `.btn svg` is sized in `main.css`, which the homepage deliberately does not link, and an inline SVG with a viewBox and no dimensions collapses to 0×0 there.

There is no second navigation system, no React header component, no homepage-only menu overlay and no second footer.

## 4 · Header states and thresholds

Three states on `data-state`, derived from `journey.current` — the same eased 0–1 the altimeter, the clouds and the mountains use. Not from scroll direction.

Boundaries come from the stage map rather than from constants, so they land on structural events and survive recalibration:

| Transition | Source | Nominal |
|---|---|---|
| opening → journey | `stageStart('initial-ascent')` | 0.046 |
| journey → destination | `stageStart('full-stratosphere')` | 0.880 |
| hysteresis, both | `HYSTERESIS` in `siteHeader.ts` | 0.015 |

`calibrate()` moves the stage boundaries when a 390 px viewport stacks the case studies; the header's edges move with them. **Measured** on the built page at 1440×900, sweeping in 0.004 steps — these include the damped clock's lag, which is why they sit above the nominal values:

```
up   opening→journey     at track f=0.0560      down  journey→opening      at f=0.0280
up   journey→destination at track f=0.9280      down  destination→journey  at f=0.9020
```

Reversible in both directions, with a stable band between the two edges. A 6 px trackpad jitter across a boundary produced **0 state flips** in 14 samples.

The generated routes keep their own defaults (`0.06` / `0.88` from document position) and are untouched by this.

**Altitude and stage label are the real ones.** The header prints `journey.altitude` and the stage's own label, pushed from the journey's clock — not a number re-derived from progress. The altitude curve is piecewise (eleven stages with unequal track shares), so a header computing `floor + p × (ceiling − floor)` would disagree with the instrument beside it by up to a whole stage. Asserted at ≤ 60 m of the HUD's own reading.

## 5 · Menu, mobile, and the scroll-lock problem

The menu is the subpages' menu, opened from every header state. The one homepage-specific problem it created is worth recording because it was invisible and severe:

`header.js` locks scrolling with `position: fixed` on `<body>` — the only lock iOS Safari honours. That collapses the document to one viewport and pins `scrollY` at 0 for as long as the layer is open. Nothing on the 66 generated routes reads that. On the homepage, **three** things do. Left alone, opening the navigation at 24 000 m walked the entire ascent back down to the valley behind the layer and eased it up again on close.

So the lock announces itself on `stratos:menu`, and both scroll readers stand down for the duration; `ScrollTrigger` is disabled with `disable(false)` — stop updating, revert nothing — and re-enabled after the scroll position has been restored, never before. Measured: altitude held at **19 540 m** across the whole open/close cycle, and the scroll position restored to the exact pixel it was locked at.

**Mobile** uses the existing responsive header: `STRATOS  MENÜ` at the opening, `S/  10 075 M  MENÜ` during the journey. The desktop link row is never squeezed in; the stage word is dropped below 640 px because 390 px has no room for two strings. The project-start CTA is `display: none` below 640 px by design — the Arrival's own primary action is the phone's project-start route. Verified at 430×932, 390×844, 375×812, 360×800 and 844×390.

## 6 · Arrival and the footer

Between the journey's closing panel and the shared footer, using the Phase 8.5 CTAConvergence and Meridian Trace:

```
30 000 M   ASCENT COMPLETE
Where should we take your business next?
YOUR NEXT ALTITUDE STARTS HERE.
[ Start a project ]  [ Explore selected work ]
```

`30 000 M` is the ceiling the homepage actually declares (`data-ceiling`), asserted against it rather than written in. The Trace converges from both edges to a node and drops a lit line into the CTA, then settles. No second WebGL scene, no particles, no loop, nothing pinned, and nothing delaying the CTA.

The footer beneath it is the shared one. Asserted as identical **destination sets** to `/rolunk.html` for the footer, the menu and the header row — normalising only the locale switch (whose targets are supposed to differ per route) and the home link's two spellings. No collaboration logo system, no Uncensored Society.

Return to 0 m is the existing control, relabelled per locale (`VISSZA 0 MÉTERRE` / `RETURN TO 0 M` / `ZURÜCK AUF 0 M`). It is a `<button>`, not an `<a href="#top">`, so it creates no history entry; focus is sent to the top of the document; and it arrives instantly rather than smooth-scrolling when the distance is over six screens, because the homepage's track is twenty-two.

## 7 · Reduced motion, accessibility, performance

**Reduced motion.** `JourneyHUD` is never mounted, so no clock runs and nothing is pushed; the header falls back to document scroll through `release()`. Arrival is a static section, the Trace does not animate, the footer is immediately reachable, the menu opens with no delay and Return to 0 m jumps. Nothing is hidden behind an animation state and no pinned space is left blank.

**Accessibility.** Header landmark, labelled nav, named menu trigger with `aria-expanded` and `aria-controls`, focus trap, focus restoration, footer landmark, headed footer groups, accessible locale switch, `<button>` semantics for Return to 0 m. The altitude readout is `aria-hidden` — the HUD already announces the same number in a live region, and a second copy would double every announcement. The Trace is `aria-hidden` and `focusable="false"`.

Focus containment measured directly: 45 tabs at 1920, 1440 and 1024 px cycled `menu ×17 → burger` indefinitely and never reached any of the **45 tabbable elements sitting behind the layer**.

Header contrast measured from the pixels actually painted — the header is a partly transparent band over a WebGL canvas, so computed styles would not answer this — comparing the header's text colour against the median and 90th-percentile luminance of the strip behind it:

| Stage | Worst ratio | |
|---|---|---|
| opening / valley | 18.67:1 | PASS AA |
| mountain sequence | 19.00:1 | PASS AA |
| cloud entry | 18.44:1 | PASS AA |
| cloud breakthrough (bright) | 17.08:1 | PASS AA |
| selected work (dark) | 17.56:1 | PASS AA |
| full stratosphere (dark) | 18.88:1 | PASS AA |
| final CTA / Arrival | 13.94:1 | PASS AA |

Also passing: 200 % zoom, WCAG 1.4.12 text spacing, no horizontal scroll at any tested viewport, no duplicate ids, every internal chrome link resolving.

**Performance.** No second animation loop. The header rides `JourneyHUD`'s existing tick — this is why `drive(fn)` became `push(p, meta)`: a getter would have needed a `requestAnimationFrame` loop of the header's own, on the one page already running a renderer, a damped altitude clock, a cloud system and a kinetic type driver at 60 Hz. State changes only when a threshold is crossed; the readouts de-duplicate on their own values; the file's scroll listener stands down entirely while it is being driven.

**Lifecycle.** Six full navigation loops (open menu → close → subpage → back), then: one `header.nav`, one `#menu`, one overlay node, no `menu-open` class, no inline body position, trigger `aria-expanded="false"`. A bfcache restore with the layer open comes back closed and unlocked.

## 8 · A shared defect found and fixed

`resolve()` in `assets/js/header.js` advanced **at most one state per call**, and `paint()` only runs when progress has moved. While scrolling this is invisible — you really do pass through `journey` a frame at a time. For any *jump* it is wrong, and the header lands one state short and stays there, because after a jump the progress never moves again to trigger another paint.

Reproduced on the built homepage: reduced motion, one `scrollTo` to the bottom, progress exactly `1.0`, header stuck on `journey` **over its own footer**, and a subsequent nudge did not recover it. It also broke Return to 0 m under reduced motion, which the brief requires to restore the opening state.

This affects all 67 routes, not just the homepage — every instant jump: a restored bfcache position, a fragment link, a browser restoring scroll on reload. §13 permits fixing a shared defect, so `resolve()` now iterates to a fixed point. It crosses the same boundaries in the same order and honours the same hysteresis; it just no longer needs a second event to finish. Pinned by a test.

## 9 · Tests

Phase 8.5 shipped the header, the menu, the Arrival and the footer with **no test coverage at all** — `tests/public-site.spec.ts` contained zero references to any of them. Rather than add homepage-only assertions, `tests/homepage-chrome.spec.ts` covers the chrome as a system, against `dist/` (the built page is the only artefact where "the homepage has a header" is a fact rather than an intention).

35 tests × 5 projects — `desktop-1920`, `desktop-1440`, `mobile-430`, `mobile-390`, `reduced-motion` — plus in-test resizes for 1024×768, 375×812, 360×800, 844×390, 200 % zoom and text spacing.

| Suite | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run build` (generate → site → home → portal → fingerprint) | pass, 69 pages fingerprinted |
| `python3 _build/build.py` re-run | byte-identical output — generator is deterministic |
| Site suite (`playwright.config.ts`), incl. new spec | 545 passed, 40 skipped |
| Full-ascent suite (`playwright.full.config.ts`) | 88 passed, 97 skipped |

Three notes on how the assertions were arrived at, because each began as a *false* failure and fixing the test rather than the product was the right call:

* **`innerText` vs `textContent`.** `.menu-open .hud { visibility: hidden }`, so `innerText` returns `''` behind the open menu and `Number('')` is 0 — a test reporting the journey had fallen to sea level while the altitude was being held perfectly.
* **Fixed sleeps.** The altitude damps *per frame*, not per millisecond. A 1 800 ms wait is comfortable at 60 fps and far too short at the 10 fps five concurrent WebGL homepages produce. Every such wait now polls for the value to stop moving.
* **Measuring before the page settles.** The homepage grows for about a second after load. A scroll target or a scroll position captured during that is stale, which looked like a 15 px scroll-restore bug when the lock was in fact restoring its captured pixel exactly.

The suite is green at 2 workers (what CI uses). Above that, this machine starves five parallel WebGL homepages and tests time out on contention rather than on logic — no assertion was weakened and no timeout was raised to accommodate it.

## 10 · Review package

`_build/reports/homepage-header-footer-review/` — **uncommitted**, as required.

* `header/` — 9 stills: opening, journey, destination, menu open, mobile opening, mobile journey, mobile menu, bright-cloud contrast, dark-void contrast.
* `footer/` — 8 stills: closing panel into Arrival, Arrival opening, Arrival CTA, footer grid, mobile Arrival, mobile footer, reduced-motion Arrival, reduced-motion footer.
* `recordings/` — 5 `.webm`: opening→journey, journey→destination, menu open/close without reset, closing panel→Arrival→footer, Return to 0 m.

Every still was captured with the header's live `data-state`, altitude and stage label logged beside it, so the screenshots can be checked against what the machine believed at the time.

## 11 · Results, limitations, readiness

### Test totals — frozen source, run once at the end

| Suite | Result |
|---|---|
| `npm run typecheck` (portal + experiments) | pass |
| `npm run build` | pass — 69 pages, 22 assets fingerprinted |
| `python3 _build/build.py` determinism re-run | byte-identical |
| Site suite, `playwright.config.ts`, 5 projects | **545 passed, 40 skipped, 0 failed** (11.3 min) |
| Full-ascent suite, `playwright.full.config.ts`, 5 projects | **88 passed, 97 skipped, 0 failed** (15.0 min) |
| Header contrast audit, 7 stages | worst 13.94:1 — all PASS AA |
| Lifecycle audit, 6 navigation loops + bfcache | clean |

The site total includes the 175 new chrome results (35 tests × 5 projects); it was 370 before this work.

### Footer content — raised under §12, then corrected by the client

Two things in the shared footer were unverifiable placeholders inherited from
accepted Phase 8.5, and §12 names both explicitly. They were surfaced rather
than guessed at, because whether they were true is a fact about the business.
The client supplied the real values and they are now in `build.py`, on all 67
routes and in all three locales:

| | was | now |
|---|---|---|
| Response time | *"Válasz jellemzően egy munkanapon belül"* (one working day) | *"Válasz jellemzően pár órán belül"* (a few hours) |
| | *"A reply usually within one working day"* | *"A reply usually within a few hours"* |
| | *"Antwort in der Regel innerhalb eines Werktags"* | *"Antwort in der Regel innerhalb weniger Stunden"* |
| LinkedIn | `https://www.linkedin.com` | `https://www.linkedin.com/company/stratos-media-agency` |
| Instagram | `https://www.instagram.com` | `https://www.instagram.com/stratosweb/` |
| Facebook | `https://www.facebook.com` | `https://www.facebook.com/profile.php?id=61590329356257` |

The old social links were the platforms' own front pages standing in for
accounts — a placeholder indistinguishable from a finished link in a screenshot,
on 67 routes. A regression guard in `homepage-chrome.spec.ts` now fails any
footer social link that is a bare origin with no path, so the placeholder cannot
come back unnoticed.

*"Győr és Budapest"* is left as it stands: two Hungarian cities, not the "global
office locations" §12 warns about.

### Remaining limitations

**1 · Heading level skip in the shared footer.** The footer's group labels are `<h4>` and the nearest preceding heading is an `<h2>`, so the outline skips `h3`. Identical on the homepage and on every subpage — pre-existing, not introduced here, and deliberately not "fixed" on the homepage alone, which would have made the two surfaces disagree. Worth a separate pass across the shared footer.

**2 · The altitude readout can freeze a few metres short.** `push()` skips a repaint when progress has not moved by more than 0.0004, and the altitude damps on its own clock — so a frame where the scroll has settled but the altitude has not can leave the header's number slightly behind the instrument's. Measured difference in practice is inside the 60 m the tests assert, and closing it means repainting on every frame instead of on every movement. Left as is, recorded here rather than silently.

**3 · Local test parallelism.** The suite is green at 2 workers, which is what CI uses. Above that, this machine cannot feed five concurrent WebGL homepages and tests fail on contention — timeouts and starved rAF clocks, not logic. No assertion was weakened and no timeout raised to hide it; the fixed sleeps that made it worse were replaced with polls that ask the real question.

**4 · Not attempted.** Real-device testing, and any judgement about whether the header's visual weight is right. Both belong to the visual approval this package exists for.

### Push readiness

One local commit. **Not pushed, not deployed.** `main` is production-linked and the brief stops here.

The review package at `_build/reports/homepage-header-footer-review/` is uncommitted, as are the probe scripts under `experiments/.tmp-*`. The commit stages explicit paths only — no `git add .`.

---

## 12 · Verdict

Baseline commit `f682820`. One local commit on top of it — *feat: integrate homepage navigation and arrival footer* — 87 files, staged explicitly, no `git add .`. The hash is not written here: this report is inside that commit, so naming it would change it. `git log -1` has it.

Review package uncommitted at
`_build/reports/homepage-header-footer-review/`. Not pushed, not deployed.

HOMEPAGE HEADER AND FOOTER READY FOR VISUAL APPROVAL

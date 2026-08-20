# The four contracts — root cause, classification, correction

One section per failure, in the order the gate reported them. Every number below
is measured on the frozen `dist` (`2538acb4…`) unless it is quoted from
`final-closure-01`.

---

# CONTRACT A

`tests/homepage-chrome.spec.ts:482` · `[desktop-1920]`
*the readout names the stage the journey reports*

## Identity

```
expect(key.toLowerCase()).toBe(stage.toLowerCase())
Expected: "rendszer"      the instrument's live stage region
Received: "munkáink"      the flight deck's stage label
```

## The user-facing contract, in plain language

> On the one page where the flight deck and the instrument are both on screen,
> they name the same stage. There is one journey and two surfaces printing it,
> and a visitor must never be able to read two different answers to "where am I".

Not: *`.nav__alt-k` equals `[data-testid="altitude-stage"]` at scroll fraction
0.6.* That is where the question happened to be asked.

## Evidence

**The failure is real, permanent, and visible.** Reproduced at rest, on the
frozen artefact, at 1920 × 1080:

```
scrollY   deck              instrument        deck m   instrument m
13 170    "Munkáink"        "Munkáink"        16 990   16 990    ok
13 175    "Munkáink"        "Munkáink"        16 985   16 980    ok
13 176    "Munkáink"        "Rendszer"        16 998   17 000    *** disagree
13 177    "Munkáink"        "Rendszer"        16 999   17 000    *** disagree
13 178    "Rendszer"        "Rendszer"        17 000   17 000    ok
13 179    "Munkáink"        "Rendszer"        16 997   17 010    *** disagree
13 180 …  "Rendszer"        "Rendszer"        17 004+  17 010+   ok
```

Three of twenty-one settled positions across the `selected-work → system`
boundary. Each was still disagreeing 2.5 s after the page had stopped moving —
the page had come to rest and stayed wrong. `evidence/contract-a-defect-13176.png`
is the state as the visitor sees it: **`Munkáink 16 993 m` in the deck, `17 000 m
/ RENDSZER` in the instrument, one screen.** `evidence/contract-a-good-13183.png`
is the same page 7 px further down.

## Root cause

`assets/js/header.js`, `Stratos.header.push()`:

```js
if (Math.abs(v - last) <= 0.0004) return;   // ← drops meta.alt and meta.key
```

The gate is a **scroll-noise** filter and it is correct on the other 66 routes,
where `paint()` *derives* the altitude and the label from `p`: there, "progress
did not move" and "nothing on screen changed" are the same statement.

The homepage does not derive them — it **pushes** them, and it pushes them
precisely because it must (`siteHeader.ts` states the reason: the altitude curve
is piecewise, so a header re-deriving it "would print an altitude the instrument
disagrees with, on the one page where both are on screen at once"). Those two
values are functions of the journey's own state, and the journey's state can
change while `p` does not:

* **the clock's final approach.** `advance()` snaps to its target once within
  `SETTLE_EPSILON`, and the last frames of that approach move `p` by less than
  the gate. `last` only advances when a paint happens, so a stage boundary
  crossed in that window is never painted — and the page has by then *stopped*,
  so nothing ever corrects it. At 1920 × 1080 the gate is 0.0004 × 22 248 px of
  track = **8.9 px**, which is the width of the band measured above.
* **a recalibration.** `useJourneyScroll`'s `measure()` runs from a
  `ResizeObserver` on the track, on `resize`, on `load` and on the menu's close
  edge. Any of them can move a stage boundary under a stationary page, so the
  same `journey.current` resolves to a different stage with no scroll at all.

Both are the same line. The portrait page reaches it too:
`MobileTelemetry.tsx` calls `publishHeaderState()` → the same `push()`.

## Classification — §15

**PRODUCT DEFECT.** The rendered, user-facing state is wrong: two readouts on
one screen, permanently disagreeing about the stage and about the altitude, at
rest, with no way for the visitor to clear it but to scroll.

## Correction

`assets/js/header.js` only. The gate now asks the question it was always meant
to ask — *has anything the deck prints changed?* — instead of using progress as
a proxy for it:

```js
const alt = meta && meta.alt != null ? Math.round(meta.alt) : null;
const key = meta && meta.key != null ? meta.key : null;
const still = Math.abs(v - last) <= 0.0004;
if (still && (alt === null || alt === shownAlt) && (key === null || key === shownKey)) return;
```

`p` still gates the state machine and the `is-solid` toggle. A frame that moved
the page by nothing still costs comparisons and performs no writes, which is the
property this file's header note claims. The 66 generated routes are untouched:
they never call `push()`.

**Result:** the same sweep, on the fixed build — **0 of 21 disagree**, and the
boundary is now crisp at 13 176: `Munkáink` below it, `Rendszer` at it and
above it, approached from either side.

## §22 — stacking, and §21 — DPR

Neither is implicated and neither was changed. This is two text nodes.

---

# CONTRACTS B AND C — one cause

`tests/mobile-homepage-simple.spec.ts:591` and `:638` · `[mobile-390]`

## The user-facing contracts

> **B** — As the visitor scrolls the portrait page, the telemetry altitude rises
> with the document, and at the foot of the page it reads the ceiling, 30 000 m.
>
> **C** — Opening and closing the navigation layer leaves the ascent exactly
> where it was. The visitor comes back to the page they left, and the readout
> agrees with it.

## Evidence

Instrumented on `mobile-390`, against the same frozen artefact, capturing the
whole pipeline in one page evaluation (§7):

```
CONTRACT B
at top                     scrollY      0   readout "0"        stage Kalibráció
immediately after scrollTo scrollY 13 408   readout "0"        stage Kalibráció   ← divergence
after 200 ms               scrollY 13 408   readout "30 000"   stage Célmagasság
after 1 700 ms             scrollY 13 408   readout "30 000"   stage Célmagasság

CONTRACT C
immediately after scrollTo scrollY  5 200   readout "0"        stage Kalibráció   ← divergence
after 200 ms               scrollY  5 200   readout "14 970"   stage Munkáink
settled                    scrollY  5 200   readout "14 970"   stage Munkáink
```

**The two numbers in the gate's report are in that table.** `0` is the reading at
the top of the document, and **`scrollY = 5200` settles at exactly 14 970 m** —
which is `Received: 14970`, i.e. `|14970 − 0|`. Neither is a drift, a fall to sea
level, or a departed instrument. Both are the reading for the position the page
was at *before* the scroll.

The divergence point is exact and identical in both: **the scroll instruction has
landed, `scrollY` is correct, and the ascent reader has not yet run.**

## Root cause

Both tests read the readout `200 ms` after a programmatic scroll:

```ts
await page.evaluate(() => scrollTo({ top: …, behavior: 'instant' }));
await page.waitForTimeout(200);          // ← this
```

`ascent.ts` is deliberately arranged so that a scroll costs **one reader pass per
animation frame** and nothing else — one passive listener, coalesced through
`requestAnimationFrame`, no damping, nothing that runs after the finger lifts.
That is the whole portrait performance architecture and §26 forbids adding to it.

So the readout is written **on a frame**. 200 ms is four frames on a quiet host
and none at all on a host running five WebGL pages at once, which is exactly what
the gate does to itself: `playwright-main` took 607 s against G6's 252 s.

This is §8 in as many words — *do not assume `scrollTo` completion* — and §16's
"test observes before semantic state completion".

## Classification — §16

**TEST DEFECT, both.** The product is correct. A visitor never sees a stale
readout for longer than one frame, and one frame is the architecture, not a bug.

## Correction

`tests/mobile-homepage-simple.spec.ts` only. A named readiness condition
replaces the sleep at the two sites:

```ts
const ascentRead = (page: Page) =>
  page.evaluate(() => new Promise<void>((done) =>
    requestAnimationFrame(() => requestAnimationFrame(() => done()))));
```

Two frames rather than one, for ordering rather than for caution: the scroll
event is dispatched in the "update the rendering" step, *before* that frame's
animation callbacks, so the reader's own frame request is queued no later than
the first one taken here and is therefore always serviced before the second.

Not a duration. On a page getting 3 fps it waits 660 ms; on one getting 120 fps
it waits 17 ms; it is the same statement either way. **No timeout was raised, no
assertion weakened, no sleep added, and nothing in the product changed.**

## What was ruled out, by measurement rather than by argument

* **`innerText` returning `''` behind a hidden element.** The obvious candidate,
  given this repository's own history with it. Measured: `.mv-telemetry` is
  `visibility: visible` and `innerText === textContent` at every position sampled,
  including the foot of the page. Not this.
* **The instrument departing early and taking the readout with it.** The strip is
  a separate fixed element at the opposite end of the viewport and is never
  stood down. Not this.
* **`bands` empty, so `locate()` returns 0.** Measured 11 sections present at
  every sample.
* **The menu's scroll lock leaving the reader behind.** `close()` restores the
  position and *then* announces, and `ascent.ts` remeasures synchronously on that
  edge. The post-menu reading in Contract C was the correct one.

---

# CONTRACT D

`experiments/tests/full-ascent.spec.ts:1342` · `[desktop]`
*the stage announced at a scroll position does not depend on the direction*

## Identity

```
Test timeout of 300000ms exceeded.
Error: page.evaluate: Test timeout of 300000ms exceeded.
  > 1439 |       await page.evaluate(
duration 303 456 ms
```

**No assertion ran.** The same test failed the same way in `g5-02` at 306 645 ms.
Both overran by one to two per cent.

## The user-facing contract

> The stage the instrument announces at a scroll position is a property of the
> position, not of how the visitor arrived at it. Scrolling down to 17 000 m and
> scrolling back up to it must announce the same stage and the same altitude.

Unchanged. Nothing about it was touched.

## Evidence

Measured on a quiet reference host, alone:

| | |
|---|---|
| One `settleClock` wait | **6 766 ms over 42 frames** |
| Twenty of them | **135 s** |
| The whole test | **129 s** |
| Budget | 300 s constant |
| Margin | **2.3×** |

The waits are ~95 % of the runtime. The wait is frame-rate independent in the
*number of frames* it takes and emphatically not in the *time* those frames take,
because `MAX_FRAME_DT` caps the per-frame decay: the slower the page, the more
wall-clock each settle costs. `final-closure-01` ran `playwright-full` 1.55×
slower than G6 at five parallel workers. That is the margin, spent.

## Classification — §4

**BRITTLE TEST.** A constant budget over a wait whose cost is inversely
proportional to the frame rate the harness grants — which is the same criticism
the test's own comment makes of the flat 1.7 s it replaced, one level up.

Not a product defect: nothing in the journey is slow, and when the test completes
it passes. Not a stale contract: the behaviour it protects is current.

## Correction

`experiments/tests/full-ascent.spec.ts` only. The 300 s becomes a **floor**, and
the budget is measured against the very wait it is a budget for:

```ts
const startedSettle = Date.now();
await settleClock();
const oneSettle = Date.now() - startedSettle;
const budget = Math.max(300_000, oneSettle * 20 * 2 + 60_000);
test.setTimeout(budget);
```

Taken after the scene is loaded and the track is warm, so the sample is under the
same conditions the twenty will run under. The `2×` is for a host that gets
*slower* during the run, which is what five parallel WebGL suites do to each
other. **No assertion changed.** A clock that genuinely never settles still fails,
and fails where it should — `settleClock` rejects at 900 frames.

---

# §17 — stale contracts

**None found.** Every one of the four protects current behaviour:

* A protects the shared flight deck, which is current architecture and is on
  every route.
* B and C protect the *portrait* ascent — native document scroll, no terrain, no
  damping, one reader — which is the accepted mobile architecture, not the one it
  replaced. Neither test mentions terrain, a camera journey, continuous scroll
  interpolation or the old stage flow.
* D protects the canonical altitude-keyed stage rule.

Nothing was deleted and no assertion was weakened. §18 did not need to be
invoked, because there was no obsolete behaviour being preserved.

# §25, §26, §27 — what was NOT added

No `IntersectionObserver`. No new scroll listener. No new `resize`,
`orientationchange` or `visualViewport` listener. No `getBoundingClientRect`,
`offsetHeight` or `getComputedStyle` on any per-frame path. No new global state.
The one product change is two comparisons inside an existing early return.

# §4 — the mobile architecture is intact

Native document scroll, no portrait terrain, one persistent Canvas/GLB, the fixed
pointer-transparent overlay, authored finite Altimeter states, copy above the
instrument, no layout-measurement feedback loop: **none of these was touched.**
The portrait fix is four words in a test file.

# §5 — desktop

Desktop cinematic behaviour is unchanged except where Contract A proved a desktop
product defect, which §5 permits in as many words. The change is to the shared
deck's repaint condition and to nothing else: no camera, no composition, no
stage map, no timing.

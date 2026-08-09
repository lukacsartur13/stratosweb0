# The reconciled suite — what was deleted, what replaced it, what it now costs

Companion to [`failure-inventory.md`](failure-inventory.md), which classified
every failure *before* anything was edited. This file is the other half: the
old-to-new coverage map, so that "the suite is green now" can be checked against
"and it still asks the same questions".

| | |
|---|---|
| Branch | `phase-9-continuation-portal-analytics` |
| Suite | `npm run test:full` — `playwright.full.config.ts` |
| Files | `experiments/tests/full-ascent.spec.ts`, `experiments/tests/portrait-journey.spec.ts` |

---

## 1 · The structural change: one file gated by project, two files by composition

`src/full/main.tsx` forks once, in a `useState` initialiser, on `(pointer: coarse)`
and a `screen` short edge ≤ 540 px. The two branches are **separate
compositions**, not one component with breakpoints:

| | desktop / cinematic | portrait / `MobileHome` |
|---|---|---|
| Scroll | sticky `journey__track`, GSAP ScrollTrigger | the document, natively |
| Scene | full-viewport WebGL journey + terrain GLB + DRACO | one Altimeter GLB in a fixed CSS box |
| Altitude | damped clock in `JourneyHUD` (`altitude-value`) | undamped `scrollY` reader (`mobile-altitude`) |
| Chapters | eleven `.journey__stage` panels in a track | eleven `<section>`s in block flow |
| Announcements | `data-meridian`, six mechanical instrument states | `mobile-stage`, eleven narrative chapters |
| Fallback | page-level `journey-fallback` | slot-level `mobile-altimeter[data-mode]` |

The old arrangement was one spec file collected by every project, with a
`test.skip` inside it choosing what to assert. That is what produced 30 of the 31
failures: the phone projects were asserting the desktop composition's DOM.

The repair is `testMatch`, not a wider skip:

```
full-ascent.spec.ts       → desktop, reduced-motion          (37 tests each)
portrait-journey.spec.ts  → mobile-390, mobile-landscape     (26 tests each)
                          → mobile-430, mobile-375, mobile-360 (13 @smoke each)
```

Neither file needs a composition skip, because neither file is collected by a
project that renders the other composition.

---

## 2 · Old test → new test, one row per deleted assertion

`J1`–`J11` are the identifiers from `failure-inventory.md`.

| | Old assertion (portrait) | Status | What replaced it |
|---|---|---|---|
| J1 | `altitude-value` climbs to exactly 30 000 | mechanism deleted, requirement kept | `portrait — the ascent › starts on the ground, never runs backwards, and arrives at the ceiling` — nine sampled fractions, monotonic, exact ceiling, read from `mobile-altitude` |
| J2 | the clock keeps time while the tab is hidden | **deleted outright** | Nothing. There is no second clock on portrait to park — `ascent.ts` reads `scrollY` and the instrument is a subscriber. The general requirement ("the readout does not die with the renderer") is J3's replacement, which is strictly stronger |
| J3 | reaches the ceiling after `loseContext()` | mechanism deleted, requirement kept | `portrait — the ascent › the readout is not owned by the renderer` — same `loseContext()`, same 30 000 m, **plus** the slot landing on the SVG rather than going blank, and the document surviving |
| J4 | skip link `href === "#journey-content"` | string match deleted, requirement kept | `portrait — the content › the skip link lands on the content` — the target must exist, be in the document, have a non-zero box and contain the first chapter. The eleven-chapter body of the old test is carried over to `every chapter is real HTML, present before any scrolling` and **now actually runs**: on `cab906d` the string match failed first, so no content assertion in it had ever been evaluated on portrait |
| J5 | page-level `journey-fallback` visible with no WebGL | page-level mechanism deleted, requirement kept | `portrait — the instrument › no WebGL falls back to the drawing, and downloads no renderer` — the mode attribute, the drawing visible, no `.glb` and no renderer chunk in the request log, **plus** the drawing tracking the ascent rather than being a placeholder |
| J6 | the CTA arrives over the sticky scene | sticky half **retargeted**, visitor half kept | Sticky half → `desktop` project, where a sticky container exists and where it had never run. Visitor half → `portrait — the content › the closing action is reachable, tappable and last` |
| J7 | `journey-track.offsetHeight`, end not trapped | mechanism deleted, requirement kept | `portrait — the document does its own scrolling › the document ends, and nothing takes the scroll back` — bottom reachable to 2 px, **still there 1.2 s later**, and one jump to the top lands at exactly 0 |
| J8 | `data-meridian === 'baseline'` after a round trip | mechanism deleted, requirement kept | Folded into J1's replacement, whose last two assertions are that round trip — and which asserts `toBe(0)` rather than "settles near 0", because there is no damper |
| J9 | `altitude-value` monotonic over 21 samples | mechanism deleted, requirement kept | J1's replacement |
| J10 | six mechanical states announced in order | six-state mechanism deleted, requirement kept | `portrait — the content › the chapters are announced in reading order, and unwound in reverse` — same in-page `MutationObserver`, asserted against all eleven `STAGES` labels forwards and reversed, stepped **in pixels** (< half a viewport) so no chapter can be stepped over on the tallest viewport |
| J11 | the `JourneyScene*` chunk contains `WebGLRenderer` | filename deleted, property kept | Same test, restated: **some** emitted chunk that is not the eager entry contains it. Verified independently on this branch — three.js is in `Gltf-Bekp0SrD.js` (896.91 kB), hoisted there because the desktop scene and the portrait instrument now share it. Duplicating 876 kB to keep a filename true would be the wrong repair |

### Two tests that were passing while asserting nothing

Both were green on portrait and both are recorded because a green test that
measures nothing is worse than a red one.

| Old test | Why it was vacuous | Replaced by |
|---|---|---|
| `no canvas/text overlap and no viewport overflow at any stage` | queried `.panel__inner` and `.hud`; neither exists on portrait, so both `querySelectorAll`s returned empty and the loop ran zero times — at a cost of ~20 s per project | `portrait — the layout holds › the page never scrolls sideways, at any chapter` and `› every action is hit-testable where it comes to rest`, which hit-tests rather than intersection-tests |
| `the rendered scene changes between every act` | passed because `MobileHome` does have a canvas — the instrument — and its needles move. "The journey is driving the scene" was not what passed | `portrait — the instrument › the real Altimeter loads, and nothing from the desktop scene does` |

---

## 3 · New coverage with no ancestor

Required by §6 of the brief and absent from the old suite in any form.

| Contract | Test |
|---|---|
| The document is the scroll container, untransformed, unsnapped | `the document is the scroller, untransformed and unsnapped @smoke` |
| No nested full-page scroller stands in for it | `no element stands in for the document as a full-page scroller @smoke` |
| No scroll hijacking | `nothing moves the scroll position on the page's behalf` — wraps `scrollTo`/`scrollBy`/`scroll`/`scrollIntoView` and requires the log to be empty |
| No synthetic continuation after the scroll stops | `the composition stops when the scroll stops` — drift must be exactly 0 over 420 ms |
| No chapter waits for a renderer | `no chapter waits for a renderer to exist @smoke` |
| First meaningful line near its own chapter top | `the first meaningful line of every chapter is near its own top` |
| No large accidental spacer | `no chapter contains a tall run of nothing` |
| Every in-page anchor resolves | `the chapters are in reading order, and every in-page anchor resolves @smoke` |
| Reveals complete; nothing left hidden | `every reveal completes, and nothing is left hidden @smoke` |
| Reverse scrolling does not destroy state | `scrolling back up does not un-reveal anything` |
| Reduced motion exposes content reliably | `reduced motion shows everything immediately and moves nothing @smoke` |
| The instrument cannot control document layout | `the instrument cannot change the layout it sits in` |
| No horizontal overflow at any chapter | `the page never scrolls sideways, at any chapter @smoke` |
| Safari-style viewport-height change moves nothing | `a viewport-height change moves no chapter` |
| Rotation keeps the composition and one context | `a rotation keeps the portrait composition and one context` |

---

## 4 · The header and menu contract, and why it is not in this file

§6 asks for menu open/close, a scroll lock that is active only while the menu is
open, a close that restores scrolling, a menu that does not corrupt the ascent
state, focus handling and Escape.

**None of that can be tested on this route.** `experiments/full.html` is a bare
mount host — `<main id="main">`, one module script, no site header, no
`header.js`. The navigation exists only on the three production locale shells,
which are what `npm test` drives.

So the contract is asserted where the header actually is, in
`tests/mobile-homepage-simple.spec.ts`, and it was strengthened rather than
added: the file already had `the menu opens, closes and leaves the ascent where
it was`, which covered the open, Escape and the ascent's survival, and nothing
else.

| §6 requirement | Before | Now |
|---|---|---|
| Menu opens and closes | open + Escape only | open, Escape, **and the burger itself** (`the menu closes on the burger too…`) |
| Scroll lock only while open | not asserted | asserted **off** before the open, **on** while open, **off** after the close |
| Closing restores normal scroll | position restored (± 2 px) | that, **plus** a scroll after the close that must actually move the page |
| Ascent state not corrupted | scroll position only | that, **plus** the readout agreeing with the restored position — the reachable state where `ascent.ts` suspends its reader and fails to catch up on the close edge |
| Focus handling | not asserted | focus inside `#menu` after opening; after Escape it must not be `<body>` and must be the recorded restore point or the burger; the trap's two boundary wraps exercised directly |
| Escape | asserted | asserted |

### The focus assertions were written twice, and the first version found a bug

Worth recording, because it is the one place in this workstream where a test
change and a product change met.

The first version asserted `expect(burger).toBeFocused()` after Escape, and ten
`Tab` presses staying inside the layer. Both passed on Chromium and **both failed
on the phone projects**. Investigating them separated into two different things:

* **My test was wrong twice.** `header.js` restores focus to *where it came
  from*, falling back to the burger — naming the burger only works where
  clicking a button focuses it, which is Chromium and not WebKit. And the Tab
  loop was an engine test: WebKit's default tab model visits form controls only,
  and all seventeen of the layer's focusables are `<a>`. Both are restated above
  in engine-neutral terms, the trap by exercising the two boundary wraps
  `header.js` actually implements.

* **One of them was hiding a real defect.** Chasing why focus did not return
  produced the trace in §F1 of `final-report.md`: `restoreTo` is `<body>` on
  WebKit, `document.contains(<body>)` is true, so the burger fallback never
  fired and focus was lost to the top of the document. Fixed in `80338e8`.

The order matters for reading the commits: the test correction (`d10c175`) does
not make a failing assertion pass — the product fix (`80338e8`) does, and the
test correction is about the two assertions that were wrong *on their own terms*.

The old test also carried `if ((await toggle.count()) === 0) test.skip(true, 'no
menu control on this build')`, over a three-way selector of which only one
alternative has ever matched. That branch turned "the phone has no menu button"
into a green run with a skip note. It is gone: the control is `.burger`, and its
absence is now a failure.

---

## 4a · Two assertions the first full run put red, and what was done about them

The reconciled suite's first complete run was **129 passed, 2 failed, 34
skipped**. Both failures were on `mobile-landscape` (844×390) and both were the
same single observation, reported by two tests that measure overlapping things:

```
the first meaningful line of every chapter is near its own top
  Error: calibration opens 43.1 svh in     Expected <= 34

no chapter contains a tall run of nothing
  + Object { "gapSvh": 43.07692307692308, "stage": "calibration" }
```

Identical numbers, so this was one fact, not two.

### What it actually is

Measured across the whole matrix — the gap from the `calibration` section's top
to its first `.mv-eyebrow`:

| viewport | gap | as svh | section `padding-block-start` |
|---|---|---|---|
| 360×800 | 134 px | 16.8 | 134.4 px |
| 375×812 | 139 px | 17.1 | 138.75 px |
| 390×844 | 144 px | 17.1 | 144.3 px |
| 430×932 | 159 px | 17.1 | 159.1 px |
| **844×390** | **168 px** | **43.1** | **168.0 px** |

The gap *is* the section's declared padding, exactly, at every size. The rule is
`mobile.css`:

```css
.mv-sec--lead { padding-block-start: calc(clamp(72px, 24vw, 104px) + var(--mv-gap-small)); }
```

which reproduces all five measurements to the decimal. It is **width**-driven,
and at 844 px wide both clamps sit on their **ceiling** — 104 + 64 = 168. That
is not a runaway value; it is the maximum the design specifies.

And the CSS says what it is for:

> The header is `position: fixed` and overlays the page, so this padding does not
> have to track it — it only has to clear its tallest state, and 104px clears the
> opening header with the navigation wrapped to two lines in German at 360px.

It is header clearance. `experiments/full.html` — the route this suite runs
against — is a bare mount host with **no header at all**. So the test was
counting the clearance for a header the route omits as a blank band, and denominating
it in `svh` on the one viewport where the design's width-driven ceiling and a
short viewport meet.

| | |
|---|---|
| Classification | **VALID REQUIREMENT, WRONG TEST MECHANISM** |
| Product changed? | **No.** The padding is at its designed ceiling, and altering it for short landscape viewports would be a change to the accepted mobile art direction, which §25 forbids |

### The repairs, and why they are not weakenings

**`the first meaningful line…`** now asserts three things where it asserted one:

1. For all eleven chapters — the space above the first line equals the section's
   own computed `padding-block-start` to within 2 px. Nothing unexplained has
   been inserted. *This is stricter than any svh budget and replaces the need
   for one.*
2. For the opening chapter — the first line is **on the first screen, without
   scrolling**, at every viewport. That is §6's "first meaningful content
   appears", stated as a property rather than as a number.
3. For the other ten — the 16 svh budget, unchanged.

**`no chapter contains a tall run of nothing`** starts its walk at the first
content box rather than at the section's top, so leading padding is no longer
counted as an interior gap; interior and trailing gaps are both still caught.

### The mutation check, which is why the repairs are auditable

`experiments/probe-gap-mutation.mjs` injects a defect and re-runs the specs'
exact measurement logic and thresholds. Run at 390×844 and 844×390:

| arm | verdict |
|---|---|
| control (untouched) | green, both viewports |
| a 300 px empty spacer between two content blocks | **RED** |
| extra margin pushed above a chapter's first line | **RED** |
| the opening line pushed below the fold | **RED** |
| a tall trailing blank at the end of a chapter | **RED** |

**The first run of this check failed to catch the spacer** — the one defect the
second test is named after — at both viewports, and had not been catching it
before the repair either. Every element's box was being counted as content, and
an empty `<div>` has a box, so it filled its own gap; only space made by margins
and padding was ever visible to it. Restricting the walk to boxes that draw
something (a replaced element, or an element with a direct non-whitespace text
node) is what makes it red. **The test is now stricter than the one this work
inherited**, not looser.

### The landscape observation, recorded rather than fixed

On 844×390 the opening chapter's first line sits 168 px down a 390 px screen —
43% of the viewport — and on this route that band is empty because the route has
no header. On production a fixed header occupies it. Recorded here so the number
is not lost, and carried into `final-report.md` under deferred observations; it
is a property of the accepted design at its clamped maximum, not a regression.

---

## 5 · Cost

| | Before | After |
|---|---|---|
| Collected | 185 | 165 |
| Skipped | 97 | *(see the run record in `final-report.md`)* |
| Portrait viewports | 3 (375×667, 390×664, 430×740 — device content boxes) | 5 (360×800, 375×812, 390×844, 430×932, 844×390 landscape) |
| Portrait engines | WebKit only | WebKit ×4, Chromium ×1 (Pixel 5 at 360×800) |

More viewports and fewer tests, because the deep behavioural walks run on the
representative portrait size and on landscape, and the five-way coverage is the
`@smoke` subset — the cheap structural checks a narrower or shorter screen can
actually break: overflow, chapter order, the skip link, the reveals resolving,
the closing action, and the no-WebGL fallback.

Heights are stated explicitly rather than taken from the device descriptors,
because a descriptor's viewport is the content box left after browser chrome
(390×664 for an iPhone 13) and the brief names the panel sizes. Testing the panel
is the stricter reading: the composition is written against `svh`, and the taller
box is the one a collapsed toolbar produces.

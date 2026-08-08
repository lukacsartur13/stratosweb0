# Simplified mobile homepage — report

Branch: `mobile-homepage-simple` (not merged, not deployed)
Measured: 2026-08-08, against the built `dist/`, Hungarian locale unless stated.
Baseline: a pristine `git worktree` of `main` at `cd75083`, built and served
alongside — every "before" number in this document was taken from that build on
the same machine in the same session, not quoted from an earlier report.

---

## 1. What the old mobile architecture was

One `<div class="journey__track">` containing one sticky `<div class="journey__stage">`
and eleven `<section class="panel">`, with the whole narrative — including the
closing call to action — inside the sticky container so there was no un-stick to
hide.

Driving it, per frame:

| System | What it did |
|---|---|
| GSAP `ScrollTrigger` | mapped the track's travel onto `journey.target` |
| `journey.advance(dt)` | damped `target` into `current` with an exponential settler (`JOURNEY_SMOOTHING = 0.82`) |
| `advanceMeridian` | derived the instrument's six-state machine from the damped value |
| `publishComposition` | re-derived the portrait composition — rails, recede, exclusion band, per-panel `--stage-flow` |
| `publishKinetic` | kinetic typography anchors |
| `meridianSound.update` | threshold arming |
| `publishHeader` | pushed altitude and stage to the shared header |
| `JourneyScene` | WebGL: terrain, cloud deck, sky, star field, Earth limb, the Altimeter GLB |

Around it, three separate measurement systems that fed back into layout:

* `useStageCalibration` measured each panel's flow position and rewrote the
  altitude curve's stage boundaries;
* `measureComposition` measured each panel's lead band and decided, per panel,
  between a windowed composition and natural flow;
* `watchDeck` measured the shared header and published `--deck-content`, which
  was the floor under the entry budget, which took part in the window/flow
  decision.

Each of those decides something that changes the layout it just measured. The
`DECK_STEP = 8` quantisation in `siteHeader.ts` exists solely to stop one of the
loops oscillating; its comment records a steady 4px scroll oscillation reversing
every ~250 ms, indefinitely, with nobody touching the page.

### The thing the visitor actually felt

`journey.current` chases `journey.target`. Everything downstream — the camera,
the instrument, the copy window, the altitude — is a function of `current`. So
when Safari's scroll stopped, the page kept arriving for a few hundred
milliseconds. That is the copy drift.

---

## 2. Systems removed from the portrait path

Not deleted from the repository — the desktop composition still uses all of
them. Removed from what a phone loads and runs:

* the WebGL scene entirely: terrain, terrain material zoning, terrain fog,
  cloud deck, sky dome, star field, Earth limb, the Altimeter GLB, the camera
  path, `QualityManager`, the render loop;
* GSAP and `ScrollTrigger`;
* the damped journey clock (`journey.target` → `advance` → `journey.current`);
* `--stage-flow` and the windowed copy band;
* `measureComposition` / `publishComposition` — rails, recede, dense-stage
  detection, exclusion bands, the window/flow decision;
* `useStageCalibration` — measured stage boundaries feeding the altitude curve;
* the sticky stage, the track, and every viewport-height-derived panel height;
* the panel plates (`--plate`, `--plate-strong`) and their gradients;
* kinetic typography and the Meridian sound system;
* `--deck-content` as a layout input (see §9).

The GLBs, the shaders and the composition module are all still in the tree and
still shipped to desktop, exactly as §1 of the brief asks.

---

## 3. What the new mobile architecture is

`experiments/src/full/mobile/`, seven files, ~1,050 lines including comments:

| File | What it is |
|---|---|
| `device.ts` | the one fork decision — `pointer: coarse` and a `screen` short edge ≤ 540 |
| `ascent.ts` | one passive scroll listener, one rAF, cached section geometry |
| `reveal.ts` | one `IntersectionObserver`, fire-once, `unobserve` |
| `MobileHome.tsx` | eleven ordinary block-flow sections |
| `MobileAltimeter.tsx` | the inline-SVG Meridian |
| `MobileTelemetry.tsx` | one readout, and the shared header's feed |
| `mobile.css` | the composition, scoped under `.mv` / `.mv-on` |

The fork is four lines in `main.tsx`:

```tsx
function Homepage() {
  const [mobile] = useState(isMobileHomepage);
  return mobile ? <MobileHome /> : <FullAscent />;
}
```

Decided once, from `screen`'s short edge and the pointer type — neither of which
can change while the page is open. A rotation therefore keeps the mobile
composition, which is what §23 asks for, and there is no Safari-toolbar resize
that can swap a mounted React tree for the other one.

### What a scroll frame costs now

1. one `scrollY` read;
2. an interpolation between two cached anchors;
3. two dirty-checked writes — the needle's `transform` attribute, the telemetry
   digits — plus a de-duplicated push to the shared header.

No `getBoundingClientRect`, no `getComputedStyle`, no React render, no WebGL, no
damping, and nothing that continues after the finger lifts.

---

## 4. Scroll implementation

Native, and only observed. Verified by the test
`nothing moves the scroll position on the page's behalf`, which wraps
`scrollTo`, `scrollBy`, `scroll` and `Element.prototype.scrollIntoView` and
asserts the page calls none of them, and separately asserts `scrollY` is
unchanged after 1.5 s of being left alone.

The loop is the one the Rapidkert audit recommends
(`_build/reports/rapidkert-mobile-motion-reference.md`), with one addition:

* one `scroll` listener, `{ passive: true }`;
* coalesced to at most one reader pass per animation frame via a `ticking` flag;
* `try/finally` around the pass, so a throwing reader cannot wedge the flag and
  silently drop every later scroll event;
* readers run **synchronously** on `load` and `pageshow`, because rAF does not
  fire in a tab that is not rendering;
* **section geometry is cached** — the addition. Rapidkert reads one rect per
  stage per frame, which is cheap but not free. Here a scroll frame performs no
  layout read at all.

Measured scroll listeners on the document at rest: **2** — this page's one, and
the shared site header's one. The old page had 6 at rest and registered **26
more during a single scroll**.

---

## 5. Text animation system

Five roles, five CSS rules, and no JavaScript after the class lands.
`reveal.ts` runs one `IntersectionObserver` (`rootMargin: 0px 0px -12% 0px`,
`threshold: 0.08`), adds `.is-in`, and `unobserve`s — so the observer's working
set shrinks to nothing as the visitor descends and nothing replays on the way
back up.

| Role | Class | Transform | Duration |
|---|---|---|---|
| LineReveal | `.mv-lines` | masked line box, `translateY(105%) → 0` | 1.05 s |
| TextReveal | `.mv-text` | `translateY(18px) → 0` + opacity | 0.80 s |
| CopyReveal | `.mv-copy` | `translateY(12px) → 0` + opacity | 0.52 s |
| LabelReveal | `.mv-label` | `translateX(-8px) → 0` + opacity | 0.42 s |
| RuleDraw | `.mv-rule` | `scaleY(0 → 1)` | 0.90 s |

Easing is `cubic-bezier(.16, 1, .3, 1)` throughout. Stagger is 0.09 s per
sibling capped at 0.55 s, written once as `--mv-delay` at registration.

Those are Rapidkert's measured numbers, not the brief's suggested ones. §6
proposed 600–850 ms with `cubic-bezier(0.22, 1, 0.36, 1)` and an 18–32 px
travel; the audit found the proven implementation uses 800 ms for body copy at
exactly 18 px, and a **full masked line box** at 1.05 s for headlines. Both are
adopted as measured. The brief's own instruction was to prefer Rapidkert's
proven timing where it exists, and it does.

Only `opacity` and `transform` are animated. Nothing transitions a property that
costs layout.

---

## 6. Altimeter implementation

Inline SVG. No canvas, no `three`, no GLB, no render loop.

It is the same drawing the reduced-motion fallback has always used — the same
ten-division scale, the same three rings made from the same parts of the same
dial, the same eleven-bladed iris. It was extracted from `JourneyFallback.tsx`
into `components/MeridianDrawing.tsx` so the fallback and the mobile instrument
are one drawing rather than two that would diverge on first contact. This is the
only shared-code move made into the accepted desktop tree.

Two mechanisms, deliberately only two:

1. **Six structural states.** React re-renders on those six transitions and no
   others — six renders over a whole page.
2. **Two needles, continuous.** Written as `transform` attributes on the SVG
   nodes, dirty-checked, quantised to a tenth of a degree.

The needle mapping is the accepted one lifted from `AltimeterMeridian`: the long
needle covers 1 000 m per revolution, the short one 10 000 m, so 30 000 m is
three full turns of the short needle on a 0–10 000 m dial. That number is not
free — `initialAscent.meta` states it to the visitor in all three locales, and
the mobile page shows that sentence.

Per §9 the instrument determines nothing about the layout: no exclusion zone, no
section height, no stage window, no measured feedback. Per §10 it is never
half-covered, and that is enforced structurally rather than by a rule —
**no element on this page has an opaque background**. There is one painted
surface and it is the fixed background behind everything. The test
`nothing paints an opaque plate across the altimeter` walks every element in the
flow and fails on any background with alpha ≥ 0.02 that overlaps the dial.

---

## 7. Terrain removed from portrait

Confirmed by request log over a full scroll of the document, not by inspection:

```
before  /models/stratos-altimeter.glb, /models/stratos-mountains-mobile.glb
after   (none)
```

The test `no terrain, no renderer and no model is ever requested` asserts zero
requests matching `.glb`, `mountains`, `JourneyScene`, `ScrollTrigger` or
`draco` across the whole page, and the companion test asserts a desktop viewport
still requests the mountains GLB — so the removal cannot silently spread.

---

## 8. Measurements

All at 390×844, deviceScaleFactor 3, over an identical scripted 20-step read of
the whole document. Harness: `experiments/probe-mobile-cost.mjs`.

| | before | after |
|---|---:|---:|
| document height | 20 797 px | 14 000 px |
| screens of scroll | 24.6 | 16.6 |
| canvases | 1 | **0** |
| WebGL draw calls | 2 471 | **0** |
| triangles | 1 486 902 | **0** |
| shader programs linked | 15 | **0** |
| rAF callbacks during scroll | 242 | 51 |
| scroll listeners at rest | 6 | **2** |
| scroll listeners added *during* scroll | 26 | **0** |
| `getBoundingClientRect` calls | 1 197 | 97 |
| `getComputedStyle` calls | 637 | **0** |
| style writes | 1 270 | 47 |
| long tasks | 20 | **0** |
| long-task time | 2 424 ms | **0 ms** |
| cumulative layout shift | 0.030 | **0.000** |
| JS chunks requested | 11 | 7 |

The 97 remaining `getBoundingClientRect` calls are `measureAscent` re-running
(11 sections per call, ~8 calls) as lazy case-study images land and change the
document height. They happen on `ResizeObserver` callbacks, never on a scroll
frame, and a stale value there costs a slightly wrong altitude readout and
nothing else — no layout depends on it.

### Transfer, for a full read of the portrait homepage

| | before | after |
|---|---:|---:|
| total | 6 289 KB | **2 087 KB** |
| JavaScript | 2 031 KB | **390 KB** |
| models (`.glb`) | 561 KB | **0 KB** |
| images | 1 343 KB | 1 343 KB |

### Endurance — §26's 60-second test

`experiments/probe-mobile-endurance.mjs`, 60 s of synthesised touch scrolling
with fling, frame intervals compared first third against last third.

| | before | after |
|---|---|---|
| first third, median frame | 18.7 ms | 16.7 ms |
| last third, median frame | **416.0 ms** | **16.7 ms** |
| first third, p95 | 516.8 ms | 18.6 ms |
| last third, p95 | 1 116.7 ms | 18.6 ms |
| median drift over the minute | **+397.3 ms** | **0.0 ms** |
| frames over 32 ms (last third) | 35 | 1 |

The old page degrades by a factor of 22 over one minute of scrolling. The new
one is flat. This is the "progressively worsening frame rate" §26 asks about,
and it reproduced on the first attempt.

> Headless Chromium on a desktop CPU is not an iPhone, and these absolute
> numbers should not be read as phone frame times. The comparison is
> like-for-like on one machine in one session, and it is the *trend* that
> transfers.

---

## 9. Two real defects found and fixed during the work

Both were found by the tests, not by looking.

**The header's deck value was reflowing the page.** `.mv-sec--lead` originally
took its top padding from `--deck-content`, which is what the desktop
composition does. The shared header compacts as you scroll and `--deck-content`
is quantised to 8 px, so crossing a header state boundary changed the padding on
the *first* section in the document and moved every section below it — 8 px of
movement arriving 420 ms after the scroll had stopped. That is exactly the drift
§3 forbids, arriving through the layout rather than through any scroll handler.
It is now a constant that clears the tallest header state.
`--deck-content` is still used for `scroll-padding-top`, where it changes only
where an anchor lands and has no layout effect at all.

**Back-navigation measured against a document that had not finished restoring.**
`pageshow` ran the measurement synchronously — correct, because rAF does not
fire in a restoring tab — but at that moment `scrollHeight` was still the short
pre-restore value, so every section anchor clamped to a too-small travel and the
readout came back pinned at the 30 000 m ceiling. It now measures synchronously
*and* once more a frame later.

---

## 10. Desktop preservation

`experiments/probe-desktop-unchanged.mjs` screenshots the desktop composition
from the pristine `main` build and from this one, at seven points through the
track, at two viewports, and diffs per pixel with a per-channel tolerance of
8/255.

| viewport | worst frame |
|---|---|
| 1440×900 | 0.242 % of pixels |
| 1280×800 | 0.308 % of pixels |

Both static states — the top of the track and the destination panel — differ by
**exactly 0 pixels** at both viewports. The non-zero frames are all mid-journey,
where the cloud system is time-based and two processes do not produce identical
frames. Nothing structural moved.

> The probe originally waited a fixed 1 600 ms after each scroll and reported a
> 7.9 % difference at one stop. Inspecting the pair showed the same composition
> photographed at 3 242 m and 2 677 m: the damper is asymptotic and 1 600 ms is
> sometimes enough and sometimes not, so the probe was measuring the damper's
> convergence rate and calling it a regression. It now polls the readout until
> it has stopped changing, which `SETTLE_EPSILON` guarantees terminates. The
> numbers above are from the corrected probe.

The only file in the accepted desktop tree that changed behaviourally is
`siteHeader.ts`, which gained `publishHeaderState` — a parameterised form of the
existing `publishHeader`, which now delegates to it with identical values.

---

## 11. Tests

`tests/mobile-homepage-simple.spec.ts` — 19 tests, run across `mobile-390`,
`mobile-430`, `desktop-1440` and `reduced-motion`. They assert architecture, not
pixels:

* the phone gets the simple composition and no canvas;
* no terrain, renderer or model is ever requested; a desktop viewport still
  requests the mountains;
* the document scrolls itself — no transform on `html`/`body`, no snapping, the
  document is the scrolling element;
* nothing calls a scroll API on the page's behalf, and `scrollY` does not move
  when left alone;
* the page stops when the scroll stops — drift asserted at **exactly 0 px**,
  not "small";
* every section's first content appears within 14 svh of its top (26 svh for the
  opening, which clears the header);
* no section contains a vertical gap larger than 34 svh;
* nothing paints an opaque plate across the altimeter;
* one altitude readout, not two;
* the telemetry is fixed, outranks everything in the flow, and stays in the
  viewport at every scroll position;
* the altitude reads 0 at the top and exactly 30 000 at the bottom;
* every reveal completes;
* the closing action is reachable and ≥ 44 px;
* the menu opens, closes and restores the scroll position to within 2 px;
* a back navigation comes back with a live, agreeing readout;
* a viewport-height change moves no section's document position (the `svh`
  contract, §26's Safari-chrome test);
* a rotation keeps the mobile composition;
* reduced motion: everything visible, nothing translated, nothing transitioning.

### Changed and removed

* `tests/mobile-homepage-fidelity.spec.ts` — **deleted**. Every test in it
  asserted the removed portrait architecture: stage entry budgets, the windowed
  copy band, `--stage-flow`, the instrument strip, terrain composition. Four of
  its tests were *already failing on `main`* at desktop viewports, which is
  recorded here rather than quietly inherited: the file only ever passed on
  portrait projects.
* `tests/helpers/homepage.ts` — **new**. Resolves "the homepage is running" and
  "the live altitude readout" to whichever composition mounted, detected from
  the DOM rather than re-derived from the viewport.
* `tests/public-site.spec.ts`, `tests/homepage-chrome.spec.ts` — updated to use
  it. Their assertions are unchanged in substance; they previously reached for
  `data-testid="altitude-hud"` as a proxy for "the page booted", which no longer
  exists on a phone.

No timeouts were raised. No test waits on desktop-only state from a portrait
project or the reverse.

### Totals

`npm test`, full production suite, against the final build:

```
788 passed
 98 skipped
  5 failed   (9.2m)
```

**All five failures are the same two tests, and both fail identically on
pristine `main`.**

```
homepage-chrome.spec.ts:422  the full-screen menu › opens from every header state
homepage-chrome.spec.ts:470  the full-screen menu › focus is trapped inside the layer
```

Both are on the desktop composition, both time out at 30 s+, and both pass in
isolation in under 9 s. Run like-for-like — `homepage-chrome.spec.ts` alone,
all projects, same machine, same session:

| build | result |
|---|---|
| this branch | 2 failed (desktop-1920), 173 passed |
| pristine `main` | 2 failed (desktop-1920), 173 passed |

Same tests, same project, same failure. They are pre-existing flakiness in the
desktop menu suite under parallel load with a 1 MB WebGL scene in the same
worker pool, and they are not this brief's to fix — flagged rather than
silenced, and deliberately not "fixed" by raising a timeout, which §28 forbids.

The count rose from 2 to 5 in the full run because the full suite puts more
projects under load at once, so more instances of the same flake tip over.

---

## 12. Review package

`_build/reports/mobile-homepage-simple-review/`

* full-page captures and per-section stills at 430×932, 390×844, 375×812,
  360×800 and 844×390 — opening, early ascent, Nine Areas, Seven Checkpoints,
  Our Work, and the closing CTA;
* `recordings/` — three **1x, unedited** WebM captures at 390×844, driven by
  `Input.synthesizeScrollGesture` with `preventFling: false` so the fling curve
  is the compositor's real one and not a scripted approximation:
  * `slow-scroll.webm` — 8 gestures at 900 px/s
  * `fast-flick.webm` — 6 gestures at 6 000 px/s
  * `reverse-scroll.webm` — 8 gestures at 2 400 px/s upward from 85 %

Each recording ends with a 1.6 s still tail. Anything that is still arriving
after the last gesture is visible there and nowhere else.

Document heights: 15.4 screens at 430×932, 16.6 at 390×844, 17.0 at 375×812,
17.2 at 360×800, 38.3 at 844×390.

---

## 13. What was deliberately not done

* **The portrait composition machinery in `composition.ts` was not deleted.**
  §27 asks for dead portrait-only code to be removed. It is not dead:
  `FullAscent` still serves tablets and narrow desktop windows, and
  `fit.portrait` is true there. Deleting it would break a live path. What has
  gone is the *phone's* use of it.
* **Desktop's identical client-logo bug was left alone.** The two client logos
  are black artwork on transparency — measured at 95 % / 85 % transparent, 0 %
  light pixels — so on the near-black page they are a faint smudge. Fixed for
  the mobile composition with `filter: brightness(0) invert(1)`; not touched on
  desktop, because §22 forbids changing the accepted composition without visual
  verification. Flagged as a separate task.
* **Mobile back-navigation scroll restoration was not changed.** It lands at the
  bottom of the document on phone-sized viewports — and does so identically on
  pristine `main`, so it predates this work. Flagged as a separate task with a
  reproduction; it needs a real device to tell a Chromium emulation artefact
  from a genuine defect.

---

## 14. Commits

§30 suggested six. There are five, and the difference is one deliberate
decision: the mobile composition does not build in pieces. Splitting
`experiments/src/full/mobile/` across five commits — flow, motion, altimeter,
background, terrain removal — would leave four intermediate commits that do not
type-check, because each file imports the next. A history of broken commits is
worse than a history of coarser ones.

What the six items describe is all in commit 2, and its message says so at
length. `git add .` was not used; every commit stages an explicit file list.

```
refactor: extract the Meridian drawing so two surfaces can share it
refactor: simplify the portrait homepage to native document flow
perf: add the probes the mobile reset is measured with
test: replace the portrait fidelity suite with architecture regressions
docs: the simplified mobile homepage, measured and reviewed
```

---

## 15. Status

Branch: `mobile-homepage-simple`. **Not merged. Not deployed. Not pushed** —
§25 asks for a preview URL from a pushed feature branch, and pushing is an
outward-facing action that has not been authorised yet. Say the word and it goes
up as a branch only, with the deploy-preview URL back here.

### What to do with it on the phone — §26

Open the preview on the same iPhone and check the six things the brief names:

* **slow drag** — the content should track the finger with nothing lagging
  behind it;
* **fast flick** — Safari's own inertia, unmodified. Text reveals may still be
  completing; nothing should be *travelling*;
* **stop** — the moment the page stops, everything stops. This is the one that
  failed before, and the one worth being most suspicious of;
* **reverse scroll** — no jumps, no stage resets, no reveals replaying;
* **Safari chrome** — collapse and expand the toolbars. Nothing should move.
  The whole layout is composed against `svh`, so there is nothing to reflow;
* **60 seconds** — scroll continuously for a minute and see whether it degrades.
  In the harness the old page went from a 19 ms median frame to 416 ms over that
  minute and this one does not move at all, but a phone is the only place that
  claim counts.

The subjective bar is the one §25 sets: *at least as smooth and direct as the
Rapidkert mobile experience.* Technical green is not sufficient, and none of the
numbers in this document should be read as if it were.

SIMPLIFIED MOBILE HOMEPAGE READY FOR REAL-DEVICE REVIEW

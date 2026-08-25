# Reverse gravity — final review

Stills: `experiments/screenshots/reverse-gravity/{before,after}/` — seven moments
× four viewports (1440×900, 1920×1080, 390×844, 430×932), each at the chapter's
top and at its reading position.

---

## BEFORE — how the homepage communicated vertical progression

Through a number and a colour, and nothing else.

The altitude readout counted up, the sky shader interpolated twelve altitude
bands, and the instrument moved between three compositional rails. All three are
good and all three are still here. What none of them could do is change the
direction the page itself moved, and the page moved the only way a document
moves: every word travelled bottom → top.

That was not a stylistic choice to be adjusted. It was the mechanism.

* **Desktop** — `.panel { align-items: center }` put each chapter's copy in the
  vertical middle of a panel up to 4.4 screens tall, in ordinary flow inside a
  sticky 3D stage. A one-screen block centred in a 4.4-screen panel leaves 1.7
  screens of nothing above it and 1.7 below: at 17 000 m the viewport contained
  **no copy at all**, and the same hole existed at eight of the ten boundaries.
  At the reading position of a chapter, its own headline had already left the
  frame.
* **Phone** — three of the five motion roles were literal bottom-up reveals:
  `translate3d(0, +18px)`, `+12px`, and a masked headline at `+105%`. The
  background was a fixed gradient whose own comment said it was *"driven by
  nothing"*; at 27 950 m it was indistinguishable from 0 m.

## AFTER — how ascent works now

**One rule.** A chapter's copy is suspended in the sky band — the top 18% of the
frame — settles **downward** into legibility, holds, and drifts **downward** out
of frame as the visitor climbs past it.

**One number.** `--pass`, a chapter's own unclamped progress, published once per
panel per frame by the publisher that was already running. Four ramps are cut
out of it and every value below is a linear interpolation on it: no keyframes,
no timeline, no state machine, and forward and reverse traversal identical by
construction rather than by test.

**One mechanism.** `position: sticky`. A pinned element cannot travel upward
with the document, so the only vertical motion left to a statement is the one
the transform authors — and that motion points down. Everything else is detail.

Scroll direction, wheel, touch, history, scroll restoration, anchors and
document order are untouched. The inversion is entirely compositional.

## Section by section

| Chapter | What changed |
|---|---|
| `calibration` 0–150 m | Hero moved out of the vertical centre into the sky band: first line at 18% of the frame, last at 39%. A ground-haze layer now carries the lower atmosphere, and it falls to 57% of its density over the first screen of scroll — the lift-off signal §9 asks for. Both calls to action stay on the first screen. |
| `initial-ascent` 150–3 000 m | Whole chapter pinned and descending. Its statement is visible, unresolved and overhead while the visitor is still in the opening — the first time on this page that a statement exists before it is reached. |
| `lower-atmosphere` 3 000–6 000 m | Statement held overhead; the six capability checkpoints climb past beneath it, reading as altitudes rather than as a card grid. |
| `cloud-entry` / `cloud-breakthrough` | Pinned whole. The deck closes and opens around a held statement. |
| `selected-work` 11 000–17 000 m | The chapter that was the worst offender is now the clearest: statement overhead at 11 000 m where the frame used to be empty, marks and the Rapidkert feature passing beneath. The marks are quieter — a step down in plate luminance and 0.86 opacity on the rail — without a mark being stretched, cropped or recoloured. Rapidkert keeps its landscape frame, its `~15M Ft` and its two exits. |
| `system` 17 000–22 000 m | "Kilenc terület, három rétegben" arrives overhead at exactly 17 000 m — the boundary that used to be an empty viewport. The three layers enter from below the statement rather than after a spacer. |
| `process` 22 000–25 500 m | Statement overhead, seven checkpoints climbing past. |
| `stratosphere-transition` / `full-stratosphere` | Pinned whole; the cleanest frames on the page. |
| `destination` 30 000 m | Pinned whole, three per cent higher than a chapter title hangs, and the one place where the grammar is switched off: it neither drifts nor leaves. Earth limb below, statement and both actions in the upper right, the stage index as a quiet altitude ledger. |

The document is **18 916px** at 1440×900, down from 21 134, and the largest run
of frame with no copy in it is **0.7 screens**, down from 2.5 — and that 0.7 is
the chapter's own statement held overhead with open sky under it while the
altitude climbs.

## Motion system

**Enters from above** — every chapter statement, on both surfaces. Desktop: the
lead band settles 3.5svh down into the sky band while resolving from 0.2 opacity
and 2.6px of blur. Phone: the masked headline descends a full line box from
above, and the marker is not painted at all until it has reached the upper half
of the frame.

**Is passed** — a statement drifts 9svh down across its chapter and then falls
22–34svh out of frame. On the four dense chapters it dissolves in place instead:
there is no open sky under those, there is the chapter's own detail climbing, and
a statement that fell would fall into the thing it is making way for.

**Remains fixed** — the instrument, its rails, the altitude readout. The readout
now tracks to the side the narrative is not on, in both its layouts, through the
same measured travel the strip already used.

**Never enters from below** — no chapter statement, on either surface. Detail
(lists, marks, the Rapidkert figure, checkpoints) does travel up through the
frame, which is what "the visitor climbs past it" means and is the only thing an
ordinary scroll can do with more content than fits.

## Two compositions, measured rather than declared

`data-hang`, written by `measureComposition` exactly as `data-fit` is in
portrait:

* **`whole`** — statement and detail pinned together, descending as one composed
  frame. Seven of the eleven.
* **`lead`** — only the statement is pinned; the detail travels beneath it. Four
  of the eleven, and they are exactly the four dense stages. There is no
  arrangement of pinned boxes that shows 1 350px of case study in 900px of
  frame, and pretending otherwise is how a composition acquires a special case
  per chapter.

## The Altimeter

Unchanged in every state it holds, and given one thing it did not have: a
statement that hangs above it rather than beside it. `leadPresence` is new — the
rails' lateral yield, released in proportion to how far the statement is clear
of the dial *vertically*. Without it, every rail change faded the incoming
statement out for the nine tenths of a screen during which it is supposed to be
arriving overhead, which is how 17 000 m stayed an empty frame through the first
three attempts at this.

On the phone the authored states are untouched but for one: `arrival` drops from
0.86 to 0.60. It is the only state that holds the middle of the frame at three
quarters size under four things of copy, and at 0.86 the dial's numerals and the
closing contact line were the same value.

## Mobile

The concept is carried by typography, timing and air. Nothing was rendered to
get it.

* **Every reveal direction reversed.** `-14px`, `-10px`, `-105%`. Durations,
  easing, stagger and cap are the measured Rapidkert values, unchanged.
* **A second reveal line, at 54%.** A chapter marker is not painted while it is
  in the lower half of the frame, so it is never seen to climb into place; it
  resolves in the upper half and settles down. Body copy keeps the shared 88%
  line — §2 asks this of chapter titles and statements, not of every paragraph.
* **The background became a journey.** Two altitude layers on one published
  property: a pale ground haze that goes by 9 000 m, and a cold opening that
  widens with the climb.
* **Nothing was restored.** No sticky, no windowed band, no measured feedback,
  no second scroll listener, no per-frame layout read. Sections are still
  ordinary block flow and the document is still as tall as its content — to the
  pixel: see PERFORMANCE.

## Performance

Measured with `experiments/probe-mobile-cost.mjs` against the built site on
ANGLE Metal, five viewports. The comparison is against a **worktree build of
HEAD**, not against `mobile-cost-head.json` — that file predates the homepage
portfolio simplification and is no longer this page.

| 390×844 | HEAD | reverse gravity | Δ |
|---|---|---|---|
| document height | 12 640 | 12 640 | **0** |
| screens of scroll | 14.98 | 14.98 | 0 |
| rAF during scroll | 192 | 188 | −4 |
| draw calls | 1 620 | 1 566 | −54 |
| triangles | 899 640 | 869 652 | −29 988 |
| scroll-handler ms | 55.2 | 47.9 | −7.3 |
| style writes | 69 | 83 | **+14** |
| `getBoundingClientRect` | 143 | 138 | −5 |
| long tasks | 0 | 0 | 0 |
| CLS | 0.0033 | 0.0033 | 0 |
| drift after stop | 0px | 0px | 0 |
| transfer | 2 150 KB | 2 159 KB | +9 KB |

Every row but two is run-to-run noise. The two that are not:

* **+14 style writes** over a twenty-step read of the whole document — the two
  new custom properties, dirty-checked and quantised. Fourteen writes across
  fifteen screens of scroll.
* **+9 KB transfer**, of which +6 KB is CSS and +2 KB is the atmosphere module.

The document height is **identical on all five viewports**, which is the number
that matters: the phone's whole architecture rests on the layout being a
function of content and nothing else, and the reverse-gravity work adds no
layout of its own.

Desktop was not benchmarked against a numeric baseline — there is no accepted
one — but the composition adds one custom property per panel per frame to a
publisher that already ran, and removes a `backdrop-filter` from nothing (there
was none left). No new listener, no new rAF, no layout read on a scroll frame.

## Accessibility

`prefers-reduced-motion: reduce` gets the composition's **absence**, not a
disabled version of it, and that falls out of how it is gated rather than from a
rule written for it: every part of the motion hangs off `:root[data-rails='on']`,
which is written by a measurement inside `JourneyHUD`, which is not mounted on
that path. The reduced-motion visitor gets eleven panels in order, each as tall
as its content, copy in ordinary flow, every heading, figure and call to action
present and static. The air layers are hidden there too — `--alt` is published by
the same tick that never runs, and a frozen atmosphere is not an atmosphere.

On the phone, `reveal.ts` resolves everything at registration under the
preference and creates no observer at all; `mobile.css` §10 resolves the same
classes independently, so a visitor sees the composed page even if the module
never runs.

Document order is unchanged on both surfaces. Nothing is reachable only through
motion. The two band wrappers are `display: block` boxes rather than a reordering
— the DOM is hero → chapter → chapter → CTA, exactly as before.

## Validation

| Suite | Result |
|---|---|
| `tests/mobile-homepage-simple.spec.ts`, `homepage-chrome`, `homepage-history`, `homepage-modality` | **249 passed, 0 failed** (112 skipped) |
| `playwright.full.config.ts` — `full-ascent`, `portrait-journey`, `ascent` | **137 passed, 0 failed** (34 skipped) |
| `tsc -b --noEmit` | clean |

Two real defects were found by the suites and fixed rather than accommodated:

1. **The document changed height one frame after paint.** The min-height cap,
   the sky-band padding and the copy column's width were all gated on
   `data-rails`, which arrives a frame late — 19 864 → 18 916 under the visitor.
   Chromium hides that with scroll anchoring; WebKit does not, and a back
   navigation came back 547px short of where the visitor left. Structure is now
   keyed to the aspect, which is known before the first paint; only motion is
   keyed to the attribute.
2. **A fast scroll could strand a chapter marker permanently.** An
   `IntersectionObserver` reports a crossing, not a position, and a root shrunk
   to the top 54% of the frame is small enough for a flick to clear between two
   frames. Two markers of eleven were never revealed on WebKit at 430×932. A
   second observer over the whole viewport now resolves a marker that has left it
   upward.

One test contract changed with the design and was updated: `revealed()` in
`mobile-homepage-simple.spec.ts` now knows there are two reveal lines, and checks
a chapter marker on the observer's own terms — its box, its threshold.

## Remaining limitations

1. **Detail still enters from below.** Under an ordinary downward scroll, content
   taller than the frame has to travel up through it; the marks rail, the
   Rapidkert figure, the nine areas and the seven checkpoints do. Only the
   statements are inverted. Inverting the detail as well would mean either
   scroll-jacking or windowing it, and both were ruled out.
2. **The phone has no pinned statement.** A pinned pair is a third of a phone
   screen held for the length of a chapter on top of the header's eighth, and
   the copy passing behind it would need a painted surface — the one thing §01
   of `mobile.css` does not allow this page to have. Portrait carries the concept
   through the reveal line and the reveal direction instead. It is a weaker
   version of the same idea, and it is deliberate.
3. **The mobile atmosphere is subtle.** Deliberately: the restraint the direction
   asks for and near-black at both ends of a journey that starts and finishes in
   the dark leave a narrow band to work in. The progression is measurable and
   visible side by side; it is not dramatic.
4. **`--share` no longer means what `journey.ts` says it means** on landscape.
   The air cap takes a chapter to at most 2.4 screens, so the shares still order
   and weight the stages but the layout no longer spends them as blank screen.
   `calibrate()` already derives every boundary from measured positions, so the
   altitude is unaffected — but the comment in `journey.ts` is now half true and
   should be revised when someone next touches that file.
5. **The desktop has no numeric performance baseline.** Nothing regressed that
   can be pointed at, but there is no `mobile-cost`-equivalent for the cinematic
   path to compare against.

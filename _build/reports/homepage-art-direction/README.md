# Homepage art-direction polish

The final visual pass over the 0–30 000 m ascent, against the direction dated
2026-08-21. Nothing is pushed, merged or deployed. Branch
`portal-p1-control-room`, working tree only.

The recomposition that preceded this is `_build/reports/homepage-recomposition/`.
That pass built the scene system; this one pushes the art direction through it.

Contact sheets: `shots/before/`, `shots/after/`, both 1440×900 Hungarian at the
same altitudes.

---

## 1 · What was actually wrong, measured

Four of the eleven chapters were printing their own supporting paragraph
**through** their display line. Not a near miss — 318–663px wide by 24–85px
tall, both objects at full contrast:

| Altitude | Chapter | Collision |
| --- | --- | --- |
| 3 600 m | Hat terület, egy rendszer. | title × lead, 368 × 57px |
| 6 700 m | Idelent minden zajos. | title × lead, 368 × 70px |
| 13 400 m | Akikkel együtt emelkedtünk. | title × "Rapidkert Kft.", 663 × 45px |
| 18 400 m | Kilenc terület, három rétegben. | title × lead, 368 × 85px |

The cause was two independent numbers that had never been asked to agree. The
stylesheet HELD a monument's statement for 1.3 screens while its detail climbed
behind it; the same stylesheet started that detail 0.34 screens below the
statement. On every one of those four chapters the detail therefore arrived
about six tenths of a screen before the statement had begun to go.

Five further stretches carried nothing at all — the longest 9 500 → 11 500 m.
Measured, those turned out not to be chapter *tails* but **crossings**: at a
stage boundary the incoming statement is held back until the instrument has
cleared the column, which is correct, and nothing stood in for it while it
waited.

And the sequence's biggest single lever was unused. Seven of eleven chapters
took the same instrument role, so for two thirds of the ascent the dial was the
same object at the same size — the direction's §3 in one line.

---

## 2 · The four systemic changes

Everything below is a parameter in the existing tables. No stage-name selectors
were added; the scene table still reads as eleven decisions.

### `--flow-sep` and `--contact` — the collision, solved rather than tuned

`flowSeparation` in `composition.ts` now *inverts* the hold: it returns the
separation that would put the detail exactly `HOLD_SCREENS` of scroll below the
statement, bounded by the room the chapter actually has. `contactPass` then
reports the pass at which the two meet — statement height, deck and drift all
included — and the stylesheet's `--leave-from` takes the smaller of the authored
hold and that contact, less a lead-in.

The hold is no longer an assumption. Where the geometry allows a screen and a
third it still resolves to a screen and a third; where a chapter's detail is
taller than its own frame the statement goes when the detail arrives, which is a
composition rather than a fault.

`--contact` drives exactly one declaration — an opacity ramp — so it can never
change the height of the document. That is what makes it safe to measure.

### Six instrument roles instead of three

`hero · monument · companion · edge · distant · recessed`, spaced 0.12–0.18 apart
in the recede, which at 1440×900 is 40–60px of dial per step. No more than two
chapters now share a projected size.

| Chapter | was | now |
| --- | --- | --- |
| Calibration | primary | **hero** |
| Initial ascent | secondary | **companion** |
| Lower atmosphere | trace | **edge** |
| Cloud entry | trace | **distant** |
| Breakthrough | primary | **hero** |
| Selected work | secondary | **companion** |
| The system | trace | **recessed** |
| The process | trace | **distant** |
| Transition | trace | **edge** |
| Stratosphere | trace | **recessed** |
| Arrival | secondary | **monument** |

`recessed` pays for itself twice: an overhead statement is capped by the sky
between the deck and the dial's top edge, so the two chapters that push the
instrument furthest back are automatically the two that can carry the largest
type — which is exactly where the direction asks for it.

### The horizon — the crossings, authored

One fragment per chapter: its own claim distilled to a word, under a hairline
and its Roman numeral, set large and very dark, low in the frame on the copy's
side.

Its presence is `1 − (the presence of its own statement)`, read from the two
values already published per panel every frame. It is at full strength exactly
where the statement is absent and gone the instant the statement resolves, so
the two can never be read together — they are one quantity and its complement.
No observer, no listener, no second scroll subscription.

All ten crossings now carry one. Seven are rail changes, where `leadPresence`
yields; the other three — 8 100, 21 600 and 25 100 m — are handovers where the
outgoing statement has simply left, and the `--arrive` term covers those.

### The support layers, compressed

§1, §2 and §5 of the direction, and also the arithmetic: a list's height and a
monument's hold are the same number spent twice, because the separation a held
statement gets is bounded by what is left of the chapter once its detail has
taken its share.

| | was | now |
| --- | --- | --- |
| Layer B, the line | 18.9px / 34ch | **16.3px / 32ch** |
| Ladder rung name | 25.6px | **18px** |
| Ladder rung line | 13.8px body | **11.8px data face** |
| Six rungs, total | ~672px | **~380px** |
| System layer name | 29.6px | **20.8px** |
| Nine areas | 13.8px body | **11.8px data face** |
| Annotations, 4-up | one column | **two columns** |

Against statements of 96–146px that is a contrast of 6× to 12×, from about 4×.

### The scale, measured

Every chapter at 1440×900 in Hungarian, after the pass. `A` is the statement,
`B` the line, `C` the annotations.

| # | Chapter | tier | frame | instrument | hang | A | B | A : B |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I | Calibration | hero | corner | hero | whole | **99** | 17.9 | 5.5× |
| II | Initial ascent | plain | corner | companion | whole | 73 | 16.3 | 4.5× |
| III | Lower atmosphere | monument | edge | edge | lead | **137** | 16.3 | 8.4× |
| IV | Cloud entry | monument | corner | distant | **whole** | **120** | 16.3 | 7.4× |
| V | Breakthrough | long | corner | hero | whole | 71 | 16.3 | 4.4× |
| VI | Selected work | monument | plate | companion | lead | **123** | 16.3 | 7.5× |
| VII | The system | colossus | field | recessed | lead | **132** | 16.3 | 8.1× |
| VIII | The process | plain | plate | distant | lead | 75 | 16.3 | 4.6× |
| IX | Transition | monument | edge | edge | whole | **146** | 16.3 | 9.0× |
| X | Stratosphere | colossus | field | recessed | whole | **102** | 16.3 | 6.3× |
| XI | Arrival | colossus | arrival | monument | whole | **117** | 16.3 | 7.2× |

Read down the `A` column: 99, 73, 137, 120, 71, 123, 132, 75, 146, 102, 117.
Two authored troughs and one sentence-length chapter against eight monuments,
and no two neighbours at the same size. Before the pass the opening was 67 and
the ratio across the page ran about 4×.

---

## 3 · Chapter by chapter

**A · The opening.** The one decision standing between it and §A was the rail.
On the centre rail the copy's budget is half the frame less the dial's
half-width — 456px — so the page's longest statement set as five lines of 67px
and the dial was the largest object in the frame the site opens with. Railed
right it takes 830px of measure and **96px** of type, closed to a 0.88 leading so
the five lines read as one block.

The premise moved out of the column and onto the frame: `calibration.note.a/b`
now sit with the instrument caption in the upper opposite corner, as a row of
three tracked annotations. Nothing was deleted. What is left in the column is
the statement, the promise and the two calls to action — and the whole chapter
still stands in one frame, which is what `hero` is for.

Trade-off, stated plainly: the page loses the "object established on the centre
rail before anything moves" beat, and with it the 150 m handoff. Five
compositional acts instead of six. The direction asks for the opening to carry
one of the strongest statements on the page rather than the most information,
and this is what that costs.

**B · 3 600 / 5 200 / 6 700.** The ladder's compression turned 5 200 m from an
empty blue field into the whole six-rung index in one frame, as a compact
editorial register. 3 600 m is now a poster: 137px across the left of the frame,
held for 0.78 screens instead of 0.34, the instrument framing the right at
`edge`.

**C · "Hat terület, egy rendszer."** The cornerstone. Statement at full contrast
for the whole opening of its chapter, no collision, the lower half of the frame
open — negative space that reads as authored because the statement dominates it.

**D · "Idelent minden zajos."** The chapter that changed most. Its `scale` came
down from 1.16 to 0.95 — 26px given up — and what that bought is the
composition: at 120px the column fits one frame, the measured `whole`/`lead`
fork resolves to `whole`, and the statement, the line and the four parallel
clauses are **pinned and descend together** as one compressed frame with the
clauses in a 2 × 2 field. Its neighbours either side are held monuments with
detail climbing through them. Nothing else on the page does this.

**E · The collaboration zone.** Six 72 × 42 plates butted together in a 665px
column read as a strip of favicons. The register now takes the whole plate: six
equal cells divided by hairlines, in a band with a hairline over and under, each
mark in about 120 × 92 of its own. Three across below 34rem of plate. The marks
themselves are still untouched — not stretched, cropped, recoloured or
greyscaled.

**F · Rapidkert.** `~15M Ft` takes a row of its own in the feature grid rather
than a 330px half-column, and is set at 17cqw — **123px on a 721px plate**, the
same size as the chapter's own statement, which is the only scale at which a
number reads as the subject of its frame. A two-ended scrim holds the capture's
own English display headline back at the top and gives the figure a field at the
bottom; the 3D cross-section in the middle — the thing the picture is for — is
untouched. The value and its meaning are unchanged: contracted project value
from search, with the label directly under it at exactly the size it always had.

**G · "Kilenc terület, három rétegben."** `colossus / field / recessed` against
the process's `plain / plate / distant`. 131px of type over a deep blue field
with the instrument as a small marker on the rings, versus a seven-row ledger
with the instrument recessed behind it. Two chapters that cannot be mistaken for
variants of each other.

**H · The tails.** See the horizon above. 11 500, 21 600 and 25 100 m were blank
frames and are now composed: a fragment low on the copy side, the outgoing
detail leaving at the top, the incoming statement resolving out of the air.

**I · "Innen már látni a görbületet."** Preserved: `edge`, 146px, cropped by the
right edge, which is what the line is about. It now shares its crossing with the
"A görbület." fragment layered over it.

**J · The closing pair.** `full-stratosphere` at `recessed` gives its statement
more sky, and "Üdv a sztratoszférában." now sets as **one line across the whole
frame** over the earth's limb, with nothing else in it. The arrival is the
question, the finished Meridian at `monument`, and the action under it. The two
frames are no longer the same picture with different words.

---

## 4 · Validation

Everything below was run against the homepage route itself
(`/home/hu.html`, `/en/`, `/de/`) rather than the prototype, except the
Playwright suite, which builds and serves `dist/`.

| Check | Result |
| --- | --- |
| `tsc -b --noEmit` (experiments) | clean |
| `npm run build:full` | clean |
| `playwright test --config playwright.full.config.ts` | **137 passed, 0 failed, 34 skipped** (10.3m) — desktop, five phone shapes, landscape, reduced-motion |
| Statement × detail collision sweep, hu 1440×900, 26 altitudes | **0** |
| Same sweep at 1920×1080, 1280×800, 1024×768 | **0** |
| Same sweep in `en` and `de` | **0** |
| Mid-word breaks in any phone statement (`MobileHome`, iPhone 13) | **none** |
| `validate-typography`, 3 locales × 3 viewports × 5 conditions | 12 problem conditions, all pre-existing — see below |

Two failures surfaced during the pass and were fixed inside it:

* **88px of horizontal overflow at 0 m.** The new two-ended wash for the two
  open-sky frames bled a flat −14%, which on a 470px band is 66px against a
  64px panel padding. Bounded by the padding, exactly as the base wash already
  was. Caught by the cinematic suite's own overflow check.
* **Ten zero-height paragraphs on the reduced-motion path.** The horizon
  fragment was marked up as a `<p>`, and `.panel p` is the selector the
  reduced-motion contract uses for "prose that must stay legible where there is
  no composition". It is a `<div>` now, which is what it is.

### What `validate-typography` still reports, and why none of it is this pass

Twelve conditions, all of them `h-overflow` at **200% zoom or 150% text size on
320–390px viewports**. Bisected element by element at 160×284 (320 at 200%
zoom): the site header/footer chrome accounts for 70 of the 118px and the panel
box for the remaining 48. Every element this pass added or changed — the horizon,
the frame caption, the register, the two-column annotations, the metric, the
open-sky wash — bisects to **zero**.

The same report shows CLS 1.05 from movement. The recorded shift is a single
entry at 221ms naming `SECTION.arrival` — the footer convergence in the HTML
shell being pushed down as the React track mounts. `clsFromArrival`, the
validator's own measure of the narrative mounting, is **0.0000**. Both are
page-shell behaviour, present independently of this work and outside its scope;
they are worth their own task.

Three sizes this pass introduced *were* under the project's own 11px floor —
the frame caption, the ladder's altitudes and the system's layer notes — and all
three are now at 0.7rem. The pre-existing `.notes--technical` at 0.68rem was
raised with them: a third of a pixel was never the hierarchy, the case and the
tracking are.

---

## 5 · Trade-offs, stated

1. **The opening's centre rail is gone.** Five compositional acts instead of six,
   and the 150 m handoff with them. Bought: 456px of measure becoming 830, and
   67px of type becoming 96. The direction asks for the opening to carry one of
   the strongest statements rather than the most information; this is the price
   and it is the strongest defensible reading.
2. **The cloud chapter's statement is 26px smaller.** 146 → 120px, and what it
   buys is the `whole` composition §D asks for. A larger statement there was a
   chapter that could not be composed.
3. **The support layers are genuinely small.** The line is 16.3px and the
   annotations 11.2–11.8px. That is the direction's §5 taken at its word, and it
   is the thing most likely to be argued with. It is above the project's own
   accessibility floor everywhere, and the browser's own text-size setting still
   scales all of it.
4. **The Rapidkert capture is scrimmed.** Darkened at the top, where the client's
   own English display headline is, and at the bottom, where the proof point
   sits. The middle — the 3D cross-section, which is the project — is untouched.
5. **`:has()`.** The two-column annotation rule is keyed to a list having a
   fourth item. Where `:has()` is unsupported the annotations stay in one column,
   the cloud chapter's measured fork falls back to `lead`, and the composition is
   the one it had before this pass. A safe degradation rather than a broken one.

## 6 · Limitations that remain

* **Three quiet stretches are still quiet by construction.** 7 200–8 000 m,
  and the two half-screens either side of the arrival. They are chapter
  approaches rather than crossings — the outgoing chapter has passed and the
  incoming one's statement has not begun to resolve — and the sky is doing real
  work in all three (the cloud deck, the earth's limb). The horizon covers the
  crossings; it deliberately does not cover every gap, because a page with a
  fragment in every gap has no gaps.
* **At 21 600 and 25 100 m the fragment and the arriving statement share
  pixels.** Both are ghosts — 0.22 alpha ink and a 5% floor — and the effect
  reads as layered air rather than as two headlines. It is the one place the
  "one quantity and its complement" rule is approximate rather than exact,
  because the `whole` branch floors its statement at 20% opacity.
* **The altitude readout can meet the incoming copy mid-crossing.** Seen at
  22 200 m, where the process column arrives on the left while the readout is
  still tracking there. Pre-existing, in `copyTrack`/`--hud-track`, and not
  touched here.
* **The phone is a separate composition and this pass did not change it.**
  `MobileHome` has its own markup and its own stylesheet; the scene table
  reaches it through `data-monument` and `mobileScale`, neither of which moved.
  Re-shot and re-checked (no mid-word breaks, register and feature intact), but
  the direction's §A–§J were written from desktop frames and that is where the
  work went.

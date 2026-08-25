# Homepage cinematic recomposition

Scene-by-scene art direction of the 0–30 000 m homepage, against the direction
dated 2026-08-21. Nothing is pushed, merged or deployed; this is for human
visual review.

Branch `portal-p1-control-room`, working tree only.

---

## 1 · Audit of the composition that was there

Captured at 1440×900 and 390×844 in Hungarian, at thirteen altitudes, before any
change. What the frames showed:

| Frame | What was in it | Why it was weak |
| --- | --- | --- |
| 0 m opening | 54px headline in a 396px column, dial 505px at the centre | The instrument was the largest object; the statement read as a caption to it |
| 2 000 m | Quiet chapter, headline off-frame | Nothing wrong, nothing composed |
| 4 500 m ladder | Six list rows left, dial 500px right, **no headline at all** | The chapter's statement had dissolved 0.34 screens in |
| 7 200 m cloud entry | Headline mid-fade at 0.13 opacity across the dial | Yield and collision at once |
| 9 800 m breakthrough | Four lines of grey type over a dark dial | Neither object was the subject |
| 12 000 m Rapidkert | Bordered card, image in a 470px box, `~15M Ft` at 3.4rem | The page's only proof point, in the page's weakest container |
| 14 500 m | Empty blue field, next chapter's headline ghosted in | Nothing in the frame |
| **17 400 m** | **Large blue rectangle, small list top-right, small dial left** | **The direction's §20 in one screenshot** |
| 19 800 m | Incoming statement printed illegibly across its own lead paragraph | Two things in the same pixels |
| 23 500 m process | Seven-checkpoint grid, dial | Dense, uncomposed |
| 26 500 m | Empty | — |
| 29 000 m | Black frame, one faint line | — |
| 30 000 m arrival | Column right of the dial, ten-row index table, `?` on its own line | Not an arrival |

Measured rather than judged: **every chapter's headline resolved to exactly
73.6px** at 1440. `--statement-w` was being measured, published and then thrown
away by a `clamp()` ceiling, so the "scale rhythm the geometry produces" was a
constant. That single fact is most of what made eleven chapters read as one
template.

Mobile: statements at 37px against 16–17px body — a 2.2× hierarchy — the
collaboration marks as a 3×2 plate grid, the Rapidkert paragraph the largest
object under its own picture, and the instrument crossing copy at 18 020 m.

Contact sheets: `shots/before/`.

---

## 2 · The new scene map

Authored in `experiments/src/full/scene.ts`, one record per chapter, five
decisions each. Nothing downstream re-decides any of them.

| # | Chapter | Alt (m) | Tier | Frame | Instrument | Sky | Statement @1440 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| I | Calibration | 0–150 | hero | corner | primary | ground | 67px |
| II | Initial ascent | 150–3 000 | **plain** | corner | secondary | ground | 74px |
| III | Lower atmosphere | 3 000–6 000 | monument | **edge** | trace | climb | 137px |
| IV | Cloud entry | 6 000–8 500 | monument | corner | trace | climb | 146px |
| V | Breakthrough | 8 500–11 000 | long | corner | **primary** | clear | 71px |
| VI | Selected work | 11 000–17 000 | monument | **plate** | secondary | clear | 123px |
| VII | **The system** | 17 000–22 000 | **colossus** | **field** | trace | deep | **132px** |
| VIII | The process | 22 000–25 500 | **plain** | plate | trace | deep | 76px |
| IX | Transition | 25 500–28 000 | monument | **edge** | trace | deep | 148px |
| X | Stratosphere | 28 000–30 000 | **colossus** | field | trace | summit | 102px |
| XI | Arrival | 30 000 | **colossus** | **arrival** | secondary | summit | 117px |

Read down the tier column and the rhythm §18 asks for is data rather than
taste: hero, plain, monument, monument, long, monument, colossus, plain,
monument, colossus, colossus.

---

## 3 · Composition changes, scene by scene

**I · Calibration** — statement up from 54 to 67px, no mid-word breaks (see the
word cap, §4). Instrument stays `primary`: this is the one frame where the
object is established and the composition was already strong. Corner frame,
scene annotation in the opposite corner.

**II · Initial ascent** — deliberately the trough. Same size it had; every
chapter around it is now twice that.

**III · Lower atmosphere** — `edge`. The statement's band escapes the panel's
inline padding and is cropped by the left edge of the frame at 137px; the six
capability checkpoints climb beneath it. The statement now holds for a screen
and a third instead of a third of a screen, so the frame at 3 600 m is a poster
and the frame at 5 200 m is the ladder.

**IV · Cloud entry** — corner, 146px, instrument at `trace`. "Idelent / minden
zajos." at the bottom-left of the frame with the four field notes beside it.

**V · Breakthrough** — the one chapter whose drama is the instrument's. A
sixty-character sentence cannot be a monument; it is set as a run of long lines
beside a dial that comes forward.

**VI · Selected work** — `plate`. See §7 below.

**VII · The system — §20's chapter.** Lifted deck (96px against 164), 132px
colossus across the full width the geometry allows, held for the whole opening
third of the chapter instead of 0.34 screens, over a `deep` sky with a defined
ceiling and corners. The frame the direction rejected now carries the largest
type on the page short of the arrival.

**VIII · The process** — the precision beat, immediately after the emptiest
scene. Statement steps back; the seven-checkpoint ledger takes the plate width.

**IX · Transition** — `edge`, right-hand crop, 148px. "látni a görbületet" runs
off the frame, which is what the line is about.

**X · Stratosphere** — full-frame single line at 102px over the earth's limb,
instrument at `trace`. The seventeen-character Hungarian word sets whole.

**XI · Arrival** — recomposed top to bottom: **monument, instrument, action**.
The closing statement is one 117px line across the frame; the finished Meridian
is under it; the two calls to action are under that; the contact note and the
stage index are at the foot. `Destination` now splits at the statement rather
than after the actions.

---

## 4 · The typography system

Five tiers on `[data-monument]`, each a fraction of the measured
`--statement-w`, each bounded by three caps:

```
font-size: min(
  clamp(min, --statement-w × fraction × --monument-scale, max),
  --monument-cap,    /* the sky above the dial ÷ authored lines ÷ leading */
  --word-cap         /* the size at which the longest word still fits */
)
```

| Tier | Fraction | Leading | Tracking | Chapters |
| --- | --- | --- | --- | --- |
| colossus | 0.215 | 0.87 | −0.05em | system, stratosphere, arrival |
| monument | 0.172 | 0.90 | −0.042em | lower atmosphere, cloud entry, work, transition |
| hero | 0.168 | 0.92 | −0.038em | calibration |
| plain | 0.105 | 1.00 | −0.03em | initial ascent, process |
| long | 0.098 | 1.04 | −0.028em | breakthrough |

Two of the three caps are new and both are measured, not tuned:

* **`--word-cap`** — the longest word in this chapter, in this locale, in this
  face, measured against the measure it has to fit. It replaces per-tier
  ceilings hand-tuned against Hungarian at 1440, which are numbers that are
  wrong in German and wrong at 1024. It is what stopped the opening setting as
  "weboldalak / at építünk."
* **`--monument-cap`** — for the two chapters whose statement hangs *above* the
  instrument, the sky between the deck and the dial's top edge divided by the
  chapter's authored line count and the tier's leading. Solved from the same
  projection everything else here is solved from, so it is a different number on
  every viewport because the projection is.

Result at 1440: statements from 67 to 148px, against a flat 73.6 before.

---

## 5 · Instrument role changes

`SCENE_RECEDE` folds the authored role into the existing recede, so it is a real
change in projected size, not an opacity trick — and because the copy's room is
budgeted against that same projected size, a chapter that pushes the instrument
back is automatically a chapter whose statement can be larger. One number, both
halves of §2's hierarchy.

| Role | Recede added | Projected size | Chapters |
| --- | --- | --- | --- |
| primary | 0 | 100% | calibration, breakthrough |
| secondary | +0.30 | ~86% | initial ascent, selected work, arrival |
| trace | +0.55 | ~73% | six chapters |

0.34 was tried first and is recorded in the source: a 13% reduction is a number,
not a change of role, and the frame still read as an instrument with a list
beside it. At 0.55 the capability chapter's dial goes from 380px to 277 and
every mark on it is still legible.

Mobile keeps its own placement table; the two centred states came down in size
and opacity to make room for the portrait monument scale, and stopped at 0.44
because `mobile-homepage-simple.spec.ts` asserts a 0.4 floor — which is the
review's "at no point is the reaction *where did the Altimeter go?*".

---

## 6 · Background art direction

Two layers become four, all pure functions of `--alt`, all in front of the
canvas and behind the copy. No new WebGL, no stars, no HUD furniture, no
particles.

| State | Altitude | What carries the frame |
| --- | --- | --- |
| ground | 0–3 000 | `air__ground` at full strength, `air__horizon` low and heavy |
| climb | 3 000–8 500 | the ground falls away while the horizon band **rises and thins** |
| clear | 8 500–17 000 | horizon gone, `air__field` in low and wide |
| deep | 17 000–25 500 | `air__field` at full strength: a defined ceiling and corners |
| summit | 25 500–30 000 | everything withdraws; limb and instrument only |

`air__field` is the answer to a flat rectangle of blue having no quiet zone for a
statement to be placed in. Its clear centre sits just below the middle of the
frame, which is where the instrument is and where a `field` chapter's statement
hangs above.

---

## 7 · Rapidkert

The card is gone: no border, no fill, no radius. What replaces it:

* the picture **breaks the band's inline padding** and runs the full width of
  the plate (736px at 1440, edge-to-edge on the phone), at its own ratio, no
  crop;
* `~15M Ft` is set at display scale — 95px at 1440, 59px at 390 — and lifted so
  it overlaps the picture's lower edge, with a shadow rather than a plate;
* the plate itself escapes the 38vw readability cap and takes the whole of the
  room the instrument leaves, while the prose inside it keeps its own measure;
* on mobile the visual order is reordered with `order` so the figure sits under
  the picture rather than under the paragraph — the DOM order, and so the
  reading order, is unchanged.

**The figure and its meaning are untouched.** Contracted project value from
search, exactly as `content.ts` states it, with the label at exactly the size it
always had directly beneath it.

Collaborations: the 3-across plate grid becomes a single register between two
hairlines, marks a size smaller, label above it raised to the technical face at
0.2em — the typography around the marks is now louder than the marks. On mobile
it is one snap-scrolling rail that runs off both edges of the frame. **No mark is
stretched, cropped, recoloured or greyscaled**; the plate stays because three of
the six are dark artwork on a near-black page.

---

## 8 · Mobile

Not a miniature desktop: the art direction crosses over (which chapter is a
monument), every number is authored separately in `mobile.css`.

| | before | after |
| --- | --- | --- |
| Statement, 390px | 37px | 53–61px |
| Supporting line | 16.8px | 15px |
| Annotations | 11.8px | 11.8px |
| A → C contrast | 2.2× | 4.5–5× |

`max-width: 16ch` came off the monument tiers: a `ch` measure shrinks exactly as
fast as the type grows, so it was a hard bound that no size increase could pass.
`mobileScale` in the scene table carries the two chapters whose longest
Hungarian word will not fit 342px at their tier.

---

## 9 · Accessibility and reduced motion

* No DOM meaning changed. Every heading level, landmark, `alt`, `aria-label` and
  anchor is the one that was there; the arrival's stage index keeps its label,
  its ten links and its 48px touch targets on mobile.
* Reduced motion, no-WebGL and low-capability paths render the same copy with
  the same hierarchy — the tier scale reads a fallback measure and never depends
  on the renderer.
* The frame rules that change a BOX are keyed to the aspect and to attributes
  React renders; only motion is keyed to `data-rails`. Reduced motion therefore
  gets the composition, not the old bordered card.
* `data-overhead` moved from the measurement pass to the render for the same
  reason.
* Full suites green: `full-ascent` (desktop + reduced-motion), `portrait-journey`
  (390/430/375/360/landscape), and the production homepage specs.

---

## 10 · Performance

Production builds of both revisions, same browser, 2× CPU throttle, 120-step
scripted scroll of the whole page, three runs each. Medians:

| | before | after |
| --- | --- | --- |
| Frame time p50 | 66.6 ms | 65.1 ms |
| Frame time p95 | 199.4 ms | 202.0 ms |
| Long-task total | 24 962 ms | 24 900 ms |
| Worst long task | 462 ms | 478 ms |
| JS heap | 16.3 MB | 17.4 MB |

**No measurable regression**; the run-to-run spread is larger than any
difference between the two builds. Cost is +1.1 MB of heap and, on the wire,
+3.1 KB gzipped CSS and +2.9 KB gzipped JS on a 97 KB entry.

No new WebGL, no new geometry, no new textures, no new dependency. The two extra
`.air` layers are full-screen gradients on an existing composited element.

Two things got **faster or safer** along the way, both found by this work:

* `statementRoom` contained a measurement feedback loop — the measure was solved
  from the statement's own rendered height, which is solved from the measure.
  Traced on WebKit, the document settled through five heights across successive
  frames. The term it came from was never once the binding one, so it is gone.
* The composition is now measured **synchronously before the first paint** and
  iterated to a fixed point inside one frame. First painted height is within
  35px of settled, against 480px before this change and 2 247px mid-way through
  it. That is what fixed the WebKit history restoration below.

---

## 11 · Checks run

| Check | Result |
| --- | --- |
| `validate-meridian` 1440×900 hu, 76 samples | PASS, 0 collisions |
| `validate-meridian` 1920×1080 hu, 62 samples | PASS |
| `validate-meridian` 1280×800 de, 62 samples | PASS |
| `validate-meridian` 1024×768 hu + de | PASS |
| `full-ascent.spec` desktop + reduced-motion | 137 passed |
| `portrait-journey.spec` 390/430/375/360/landscape | passed |
| production homepage specs | 402 passed |
| horizontal overflow, all altitudes | 0 |

Two real defects were found by these checks and fixed rather than silenced:

* **`mobile-homepage-simple`** — the mobile instrument's opacity had gone to
  0.38 against a 0.4 floor. The floor is the contract; the statement got bigger
  instead.
* **`homepage-history`** — WebKit restored a back navigation 563px short of
  where the visitor left, against a 200px tolerance, because the layout changed
  after the first paint. Fixed at the cause (see §10); now passes.

No assertion was weakened.

---

## 12 · Remaining limitations

1. **The opening is the smallest monument on the page** (67px). Its frame holds
   a full-size instrument, a four-line statement, a line, two calls to action
   and two annotations; there is no room in it for 130px of type without one of
   those leaving. If the direction wants the opening monumental, the trade is
   the annotations or the instrument's size, and that is a decision rather than
   a fix.

2. **Chapter tails are still sparse.** A `whole`-hang chapter's statement is
   pinned only while its column has sticky range left, and after that the
   chapter's last third carries sky, the instrument and the readout. The hold is
   as long as the pinned range allows and the background now gives those frames
   structure, but 10 500 m, 16 800 m, 21 200 m and 27 300 m are transitions
   rather than compositions. Closing them properly means either shorter columns
   or more copy, and both are content decisions.

3. **`--monument-cap` is not binding on the two overhead chapters at 1440** —
   the word cap is. On a shorter viewport the vertical cap takes over and those
   statements get smaller. Correct, but it means the summit's scale varies more
   with viewport height than the side-railed chapters' does.

4. **The mobile stage index is still ten 48px rows.** §17 asks for the fewest
   elements; the touch-target contract asks for 48px. The contract wins, and the
   index is below the fold.

5. **Notes are not reduced to "one or two" on mobile.** The four clauses in
   `initialAscent.note.*` and `cloudEntry.note.*` are approved copy carrying each
   chapter's argument; cutting two would delete meaning, which §27 forbids. They
   are ranked much further down instead.

6. **Not reviewed**: 375 and 360 portrait, tablet portrait, and Safari on real
   hardware. The automated matrix covers them; a human has not looked at them.

---

## Frames for review

* `shots/final/contact-desktop.jpg` — sixteen frames at 1440×900, in sequence
* `shots/final/contact-mobile.jpg` — thirteen frames at 390×844, in sequence
* `shots/final/` and `shots/before/` — the six frames §32 names, at both
  viewports, before and after: opening, first ascent, ~17 000 m, Rapidkert,
  stratosphere, arrival

The full thirteen-altitude sets at both viewports, before and after, are in the
session scratchpad rather than the repository — the contact sheets carry the
sequence and the six pairs carry the detail.

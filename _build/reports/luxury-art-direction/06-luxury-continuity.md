# The crossings, redesigned

**Phase 3. Luxury continuity. The homepage now has two visual levels and no third.**

The previous pass solved the highlights. This one solves the spaces between them.

No master act was redesigned. No typography phase was opened, no serif was
added, no third dimension object was added, no second scene engine was written,
no Portal work was touched. Nothing has been pushed, merged or deployed.

| | |
| --- | --- |
| `06-luxury-continuity.md` | this document. §A inventory · §B classification · §C removals · §D the system · §E content · §F each crossing · §F6 motion · §G header · §H Altimeter · §I yellow · §J mobile · §K reduced motion · §L performance · §M tests · §M6 master protection · §N deviations · §O limitations |
| `continuity/reduced-motion/` | §30 — every act and every passage on the path with no clock |
| **`continuity/after/journey/sheet-hu.png`** | **§47 — the whole journey, twenty states in order, 1440 × 900** |
| **`continuity/after/journey/thumbnails-hu.png`** | **§48 — the same twenty at 132px, where the only question is the silhouette** |
| `continuity/after/journey-mobile/sheet-hu.png` · `thumbnails-hu.png` | the same two sheets at 390 × 844 |
| `continuity/scroll/desktop-1440-hu.webm` · `mobile-390-hu.webm` | §49 — the full scroll at a reading pace |
| `continuity/before/inventory-hu.json` · `after/inventory-hu.json` | §36 — what a visitor met in one frame, before and after, measured |
| `continuity/after/mobile/` | the same walk at 390 × 844. There is no `before/mobile/` — see §A |
| **`continuity/master-frames/accepted-vs-after-hu.png`** | **§46 — the seven master frames beside the accepted implementation's own stills** |
| `continuity/master-frames/after-hu.json` · `photo-after-hu.json` | the same comparison as geometry in reference pixels, and as a pixel difference |
| `continuity/yellow-desktop-1440.json` · `yellow-mobile-390.json` | §22 — every element that paints the signal colour, on both surfaces |
| `continuity/instrument/` | §25, §53 — the arrival instrument before and after, and the lighting sweep |
| `continuity/act-cost.json` | §54 — draws, triangles, frame time, style and layout at all ELEVEN chapters |
| `continuity/journey-scan-hu-1440x900.json` | 121 samples down the whole track — silences, collisions, monotonicity, overflow |
| `continuity/playwright-full.json` | the gate's machine-readable result |

New source of truth: **`PASSAGE` in `experiments/src/full/acts.ts`**, beside the
seven acts it already held. Four settings, three numbers each, read by the page,
the stylesheet and the regression suite.

---

## A · The crossing inventory — §36

Taken before anything was styled, off the running page rather than off the
source, because the question is what a visitor encounters and the source is what
was intended. `experiments/probe-crossings.mjs` walks each non-master chapter in
screen steps and records every legible object, its type size, and which of §6's
rejected patterns are present.

**Desktop, 1440 × 900, Hungarian.**

| at | chapter | altitude | objects in one frame | largest type | old visual language present |
| --- | --- | --- | ---: | ---: | --- |
| x1 | `cloud-entry` | 6 447 m | 6 | 72px | chapter marker · altitude range · annotation cluster |
| x1b | `cloud-entry` | 7 340 m | 2 | 69px | chapter marker · altitude range |
| x2 | `cloud-breakthrough` | 9 022 m | 3 | 69px | chapter marker · altitude range |
| x3 | `system` | 17 499 m | **21** | 70px | 3 × orbit geometry · 3 × yellow index · technical grid · chapter marker · altitude range · 3 × card |
| x3b | `system` | 18 499 m | **21** | 70px | as above |
| x3c | `system` | 19 749 m | 0 | — | — |
| x4 | `process` | 22 291 m | **23** | 70px | 2 × yellow index · 2 × technical grid · chapter marker · 3 × altitude stamp · 2 × card |
| x4b | `process` | 23 021 m | **45** | 27px | 4 × yellow index · 4 × technical grid · 4 × altitude stamp · 4 × card |
| x4c | `process` | 23 896 m | **49** | 27px | 4 × yellow index · 5 × technical grid · 4 × altitude stamp · 5 × card |

§12 says twelve visible elements in a crossing is a warning. The process
crossing showed **forty-nine**.

**And it was not only the crossings.** §48's thumbnail sheet is what found the
last two objects on the homepage still built the old way — the
capability ladder under Act III (a rule across the top, a rule under each of six
rows, and a fixed 5rem altitude column in the data face in the signal colour)
and the annotation layer under Acts I and II (each sentence on its own hairline,
in the data face, in a third measure). §48's thumbnail sheet is what made them
undeniable: at 132px wide they were the two states that looked like a different
website. Both are in this pass. See §C.

**Two of the states are in the 3D scene rather than in the document.**
`SystemRings` mounted three concentric rings and nine nodes between 17 000 and
22 000 m; `Checkpoints` mounted seven progress markers between 22 000 and
25 500 m. Neither has a selector, so neither appears in the table above — the
ellipse running the full width behind `Kilenc terület, három rétegben.` in
`continuity/before/x3-hu.png` is the first of them.

**Portrait, 390 × 844 — and this half of the inventory is from the source, not
from a walk.** The portrait probe was written after `system.lead` had already
been split, and the phone reads that key: the before-state's page threw on it
and rendered nothing, so there is no `before/mobile/` capture and the table
below is read off the markup and the stylesheet it replaced, plus
`yellow-mobile-390.json`, which was taken before the portrait recomposition and
does measure the running page. It is a weaker artefact than the desktop half and
it is stated as one.

The phone ran the same design at a narrower measure:
a Meridian rail with a yellow top stop down three chapters, a yellow station dot
per entry, a display-size index numeral in the signal colour on every layer and
every checkpoint, an altitude stamp on each, a two-column description list for
the process, bordered list items for the nine areas, and an eyebrow carrying a
roman numeral and an altitude range on all four crossings.

It also carried a content defect the suite had been recording as a requirement:
the portrait process rendered three of the checkpoints' four terms and silently
dropped `Amit tőled kérünk`, and the contract asserted `toHaveCount(3)`. See §M.

---

## B · Classification — §2

Two levels. There is no third and the page now says which one every chapter is:
`data-level` is published from `levelOf()` in `acts.ts`, on both surfaces, from
the same function, and a regression test asserts every one of the eleven
resolves to `master` or `passage`.

| # | chapter | altitude | level | kind | axis | what it became |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `calibration` | 0 – 150 m | **master** | Act I · Ground | — | unchanged |
| 2 | `initial-ascent` | 150 – 3 000 m | **master** | Act II · Noise | — | unchanged; its body recomposed |
| 3 | `lower-atmosphere` | 3 000 – 6 000 m | **master** | Act III · System | — | unchanged; its ladder recomposed |
| 4 | `cloud-entry` | 6 000 – 8 500 m | **passage** | structure | spine | Editorial Passage + one structural layer |
| 5 | `cloud-breakthrough` | 8 500 – 11 000 m | **passage** | statement | edge | Editorial Passage, no body — the quietest state on the page |
| 6 | `selected-work` | 11 000 – 17 000 m | **master** | Act IV · Proof | — | unchanged |
| 7 | `system` | 17 000 – 22 000 m | **passage** | structure | spine | Editorial Passage + the three layers, staged |
| 8 | `process` | 22 000 – 25 500 m | **passage** | structure | edge | Editorial Passage + the seven checkpoints, staged |
| 9 | `stratosphere-transition` | 25 500 – 28 000 m | **master** | Act V · High altitude | — | unchanged, and deliberately so — §24 |
| 10 | `full-stratosphere` | 28 000 – 30 000 m | **master** | Act VI · Arrival | — | composition unchanged; one optical pass on the instrument — §H |
| 11 | `destination` | 30 000 m | **master** | the action beat | — | unchanged |

**Silence is not a fourth level.** §13 asks the visitor to scroll through frames
that contain almost nothing, and §14 draws the line between silence and dead
space: a silence must be composed. It is produced here by the arrival and
departure ramps the acts already had rather than by an empty chapter — the
outgoing frame's last opacity and the incoming one's first, over a background
that is a continuous function of altitude. Two of the twenty states on the review
sheet are silences (`02` at 110 m and `10` at 10 218 m) and neither is an
element; both are the space between two composed things. §L has the measured
lengths.

---

## C · The old visual language, removed

§6 asks for this to be exact, and for semantic information to survive while its
presentation does not. Every row below is a removal, not a restyle, unless the
right-hand column says otherwise.

### C1 · Removed from the document

| §6 item | what it was | where its meaning went |
| --- | --- | --- |
| **old chapter markers** | `.panel__eyebrow` — a rail, a roman numeral and the chapter's name, in the data face, tracked out, on all four crossings and on both surfaces | an `sr-only` line, first in each passage's reading order. Announced, never painted. The six acts have never had one |
| **altitude decoration** | `.panel__altitude` beside every eyebrow; `.check__at` on all seven checkpoints; `.ladder__at` on all six capabilities; `.mv-eyebrow__at`, `.mv-check__at` and `.mv-spine__at` in portrait | the eyebrow's range is in the `sr-only` line above. The per-checkpoint and per-capability stamps are **gone** — §19 says a passage needs no large altitude number and these are the journey metaphor annotating itself rather than facts about the work. The live altitude is unaffected: the desktop's live region and the phone's telemetry strip both still read it continuously |
| **yellow indexes** | `.system__ring-index` (1, 2, 3), `.check__index` (01–07), `.mv-layer__index`, `.mv-check__index`, and the station dot drawn on `.mv-check`/`.mv-layer` | removed. The order is the message and the order is the document order; a numeral in front of it says the same thing twice, in the one colour the page spends twice |
| **concentric circles · orbit diagrams** | `SystemRings` — three torus rings and nine node discs in the 3D scene, mounted 17 000–22 000 m | removed from the scene. §45: the background must not announce a chapter, and a diagram that mounts at an altitude is that announcement in geometry |
| **HUD-like annotations** | `Checkpoints` — seven progress markers in the 3D scene, mounted 22 000–25 500 m | removed from the scene |
| **multi-column technical grids** | `.check__grid` — a two-by-two description list, seven times; `.system` — a three-column ring grid; `.mv-check__grid` | one column of `term — sentence`. Every term and every sentence survives, and the phone gained the fourth term it had been missing |
| **three-column explanatory blocks** | `.system__ring` × 3, each a bordered block with a name, a note and three areas | a single restrained vertical sequence — §11's own first suggestion |
| **old card-like information structures** | `.check` × 7 and `.mv-check` × 7, `.system__ring` × 3 and `.mv-layer` × 3 | staged editorial items. No border, no box, no plate |
| **horizontal rule systems** | `.ladder` and `.ladder__step` — a rule across the top and one under each of six rows; `.mv-spine__rule` — a vertical Meridian rail with a yellow stop at its head | removed. The capability names and lines are staged editorial items in the same idiom as everything else |
| **dense microcopy** | `Notes` / `.mv-notes` — the third type layer: each sentence on its own hairline, in the data face, in a third measure, folding into two columns at four items, with an uppercase tracked-out `technical` tone | removed on both surfaces. Every sentence it carried is in `.passage__terms` / `.mv-terms`, in the same order, in the editorial voice — seven on the desktop, eleven on the phone |
| **medium typography stacks** | `.panel__title` at the five-tier `clamp()` ladder — 69–72px, a generic `<h2>` at the top of a column | the Passage Statement — §D |
| **rails** | the whole `Panel` composition: the measured lead band, the windowed flow band, the copy side chosen against the instrument's rail, the reverse-gravity pass | removed. Passages are absolutely composed fields on the acts' own grid |
| **decorative fragments** | the horizon fragment | already retired in the previous pass; its last call site went with `Panel` |

### C2 · Removed because the thing it described was removed

`system.lead`'s first sentence — *"A háttérben ugyanez látható: koncentrikus
rétegek, nem hálózat."* — is a caption on `SystemRings`. With the rings gone it
is not preserved content but a false statement about the page.

The string is split at its own full stop, the way `lowerAtmosphere.lead` already
was, into `system.lead.a` and `system.lead.b`. `.b` — *"A sorrend a lényeg, nem
az, hogy kilenc van belőle."* — is the passage's supporting line, unchanged to
the character in all three locales, and it is the half that carries the
argument. `.a` is left in `messages.ts`, in all three locales, with the reason,
and is not rendered: the decision is auditable and reversible in one line.

**That is the only copy this pass removed from either surface**, and it is a
caption rather than business information.

### C3 · Left in place, deliberately

* **The `.panel__*` rules in `styles.css`** and the portrait composition's
  `.mv-spine`, `.mv-layer` and `.mv-check` rules. They are unreachable — no
  element on the page carries any of those classes, and a regression test
  asserts it by counting them in the document rather than by checking their
  visibility. §55 removes dead CSS *after* the design is visually approved, and
  this is the change that has to be reviewed on its own merits first. §O.
* **`SystemRings.tsx`**, with both components. Nothing mounts them; the
  regression suite asserts that against the scene's source, because a three.js
  object leaves no trace in the document for a page test to find.
* **The eleven horizon words in `messages.ts`.** Retired in the previous pass.

---

## D · The Editorial Passage system — §37

The smallest system that covers all four crossings without a stage-specific
hack, and the vocabulary is deliberately tiny: **three attributes, two kinds,
two axes, three numbers per passage.**

### D1 · What a passage shares with an act, and why

Everything except its rank. Same field — the study's 1440 × 900 frame, fitted
uniformly by the same `--u`. Same grid: the spine at x = 120, the right margin
line at x = 1320, the four-column measure. Same face, same weight, same width
axis, same neutral tracking discipline. Same arrival and departure ramps,
authored once and shared by selector rather than copied.

That is the whole of §3's *continuity*. A passage is not a smaller act; it is
the same composition system at a different rank, which is why the journey reads
as one brand rather than as a strong design with a weaker one between its
frames.

### D2 · What differs, as data

`PASSAGE` in `acts.ts`, and three numbers is all of it.

| | master act | editorial passage |
| --- | --- | --- |
| statement | 122 – 179u | **58 – 72u** |
| hold | 1.8 screens — pinned for 0.8 | **1.25 screens — pinned for 0.25** |
| departure travel | −34u | **−22u** |
| objects in the frame | 2 – 5 | **2 – 3** |
| structural layer | under the frame | under the frame, staged |

**The hold is §18 expressed as the one number that produces it.** An act stands
still for four fifths of a screen and a passage for a quarter, so a destination
and a movement differ in the way a visitor actually feels the difference: how
long the composition is at rest. Clamped to the chapter's own share, because
`cloud-breakthrough` is 1.2 screens long and a hold longer than its panel is a
frame that never releases.

**The scale is §5 enforced by arithmetic.** The largest passage is 72u against
the smallest monument's 122u — a ratio of 0.59 — and the smallest is 58u against
the editorial line's 17u, a ratio of 3.4. The tier is unmistakable in both
directions, which is what §48's thumbnail sheet is a test of. A regression
contract holds it below 0.68 and above 2.4 rather than at an exact size: §51
warns against a test that forbids all future change, and the decision here is
*clearly smaller than a monument and clearly larger than a line*, not 72 pixels.

### D3 · The tokens

| role | setting | where |
| --- | --- | --- |
| **Passage Statement** | Archivo 400, `font-stretch: 100%`, tracking −0.024em, sentence case, authored lines, `nowrap` per line, anchored by its last baseline | `.passage__statement` |
| **Overline** | the editorial token — 17u / 1.62, −0.002em, 46% — carrying the quiet half of a sentence whose other half is the statement | `.passage__overline` |
| **Support** | the same editorial token. One per passage, never two | `.passage__support` |
| **Structure** | the act body's own `<h3>` and editorial sizes, one column, `term — sentence` | `.passage__body`, `.passage__terms` |
| *Micro* | **not declared.** §4 says micro is rare and in this design it means one thing — an altitude, in Act V, once in the seven frames. No passage carries one, and a role with no call site is a role a later chapter reaches for because it exists rather than because the composition needs it | — |

Tracking is −0.024em against the monument's −0.028em. Negative tracking is a
correction for optical size, so a statement at 40% of a monument's size takes
less of it — the same rule applied honestly rather than the same number applied
twice.

### D4 · The variants

Two, and they are the two §37 asks for: alignment and structure presence.

* **`data-axis`** — `spine` or `edge`. Never the centre: the symmetrical frame
  is Act VI's signature and the argument for it is that no other frame in the
  design is symmetrical. They alternate down the journey — spine, edge, spine,
  edge — which is what turns four crossings into a rhythm rather than into four
  instances of one layout.
* **`data-passage-kind`** — `statement` or `structure`. Whether the passage
  carries a layer of reference detail under its frame.

`data-passage` carries the chapter's own id and is what the four solved
settings are keyed on, exactly as `data-act` carries the seven acts'. There is
no other per-stage selector in the passage stylesheet.

### D5 · The solved settings

Transcribed from `PASSAGE`, in the study's own coordinates. `top` is whatever
puts the last baseline on the foot line, solved against the same Archivo ascent
the acts' settings use.

| passage | axis | size | leading | lines | foot | statement | support |
| --- | --- | ---: | ---: | ---: | ---: | --- | --- |
| `cloud-entry` | spine | 72u | 1.00 | 2 | 596 | spine, low | counter-axis, y 704 |
| `cloud-breakthrough` | edge | 58u | 1.04 | 1 | 430 | right margin line, upper | spine, y 648 · overline above the statement |
| `system` | spine | 66u | 1.00 | 2 | 560 | spine, middle | counter-axis, y 200 |
| `process` | edge | 58u | 1.00 | 2 | 400 | right margin line, upper | spine, y 560 |

**One size per passage, across three locales**, and it is a contract rather than
an assumption. The field is fitted uniformly, so a line that clears at
1440 × 900 clears everywhere — but which line is longest changes with the
language, and German sets it in three of the four passages. `the passage
statements hold their measure in {hu,en,de}` counts one line box per authored
line, checks the count and the size against `PASSAGE`, and checks every line
against the 1200u type field. All three are green.

`nowrap` is on every line for the reason the monuments give: an over-long line
otherwise re-breaks silently, stays inside the margins and passes every
automated check while the browser quietly rewrites the art direction. With it,
an overrun is a visible fault — and the contract above turns it into a reported
one.

### D6 · The authored breaks are the copy's own

Not one word was rewritten and not one break was invented. Every crossing title
in `messages.ts` is already authored in two halves, `.a` and `.em`, at the
sentence's own hinge — a break a writer chose. The passages set on it.

| passage | line 1 | line 2 |
| --- | --- | --- |
| `cloud-entry` | `Egy weboldal önmagában` | `nem visz sehova.` |
| `system` | `Kilenc terület,` | `három rétegben.` |
| `process` | `Hét ellenőrzőpont,` | `találgatás nélkül.` |

`cloud-breakthrough` is the exception §8 is written for, and it is handled in
§F2.

---

## E · Content preservation — §10, §12, §31

**Nothing was deleted from the site.** One caption was retired with the graphic
it captioned (§C2) and one surface *gained* a sentence it had been missing (§M).
Everything else is the same words, in the same order, in all three locales, on
both surfaces.

What changed is **simultaneous visibility**, which is the thing §12 actually
asks to be reduced.

### E1 · The separation §10 asks for

| | message | reference detail |
| --- | --- | --- |
| `cloud-entry` | `Egy weboldal önmagában nem visz sehova.` + one supporting thought | the three symptoms |
| `cloud-breakthrough` | the sentence, in two registers | — |
| `system` | `Kilenc terület, három rétegben.` + one supporting thought | three layer names, three layer notes, nine areas, nine blurbs |
| `process` | `Hét ellenőrzőpont, találgatás nélkül.` + one supporting thought | seven checkpoint names, twenty-eight terms and sentences |

The message is in the frame. The reference detail is under it, staged.

### E2 · How staging works, and why it is not a gap

The first version put 38–62svh of margin between one structural item and the
next. That stages them and produces exactly the failure §14 names: the void ends
up *between* two items rather than around one, so a frame catches the tail of
one block against its top edge and the head of the next against its bottom, with
nothing composed in the middle. That is dead space — it contains nothing
intentional — and it is what a margin can only ever produce, because a margin is
the absence of something rather than the shape of it.

Each item is a **box of its own** instead, `min-height: 58svh`, with the item
centred inside it. The air becomes part of the beat: one block, held in the
middle of a frame, with its silence above and below. It is the relationship an
act's frame has to its own field, one level quieter.

**No observer, no reveal, no clock, no `aria-hidden` and no `display: none`.**
Every word is in the document, in reading order, at full contrast, reachable by
keyboard and announced in full. §31 is satisfied by there being nothing to
satisfy it against: nothing is hidden, and what changed is how many things are
in one frame.

### E3 · The measured result — §36, §12

`probe-crossings.mjs`, the same walk, after.

| at | chapter | altitude | objects | largest type | old visual language |
| --- | --- | --- | ---: | ---: | --- |
| x1 | `cloud-entry` | 6 224 m | **2** | 72px | — |
| x1b | `cloud-entry` | 7 119 m | 3 | 17px | — |
| x2 | `cloud-breakthrough` | 8 863 m | **3** | 58px | — |
| x2b | `cloud-breakthrough` | 10 129 m | **0** | — | — |
| x3 | `system` | 17 294 m | **2** | 66px | — |
| x3b | `system` | 18 915 m | 6 | 30px | — |
| x3c | `system` | 19 946 m | 11 | 30px | — |
| x3d | `system` | 20 977 m | 6 | 30px | — |
| x4 | `process` | 22 122 m | **2** | 58px | — |
| x4b–d | `process` | 22 857 – 24 327 m | 10 | 30px | — |
| x4e | `process` | 25 001 m | 5 | 30px | — |

**49 → 11 at the worst frame on the page**, and zero instances of anything on
§6's list at any of the thirteen samples. A passage's statement frame carries
two or three objects; its structural beats carry six to eleven, under §12's
warning line of twelve.

### E4 · Two states that are content decisions rather than layout ones

* **The three symptoms at `cloud-entry` are one list, not three staged items.**
  `messages.ts` records what they are: three parallel observations of one
  failure, printed as one paragraph in the copy they came from. Three separate
  beats would say they are three subjects.
* **The four terms of a checkpoint are terms, not labels.** `Mi történik`,
  `Amit átadunk`, `Amit tőled kérünk` and `Várható eredmény` were tracked-out
  mono labels above their sentences in a two-by-two grid. They are now the term
  of a `term — sentence` line, in the ink of the running text, which is how a
  printed specification has always set one. Nothing is lost about which sentence
  answers which question, and there is no grid left.

**`term — sentence` is the page's only structural idiom now**, and it carries
the nine areas, the seven checkpoints, the six capabilities and the four
diagnosis clauses on both surfaces. Before this pass those four were four
different treatments.

---

## F · Crossing by crossing — §38

### F1 · `cloud-entry` · 6 000 – 8 500 m · §7

`Egy weboldal önmagában / nem visz sehova.`

**Was:** a rail, a roman numeral and an altitude range across the top; the
statement as a 72px `<h2>` at the top of a measured column; a copy block pinned
to the lower right; three annotations on hairlines in the data face under it.
Six objects and two type systems.

**Is:** the largest passage on the page — 72u, on the spine, low, with 344
reference pixels of air above it — one supporting thought at the counter-axis
diagonally below, and the three symptoms staged under the frame. Two objects in
the statement frame.

§7's list, item by item: large but not monument-scale (72u against 122–179u), a
strong authored break (the copy's own, at `önmagában` / `nem visz`), large
negative space (two objects in a 1440 × 900 field), one supporting thought at
most (one), and no technical diagram around it (none).

### F2 · `cloud-breakthrough` · 8 500 – 11 000 m · §8

`A tisztaság ott kezdődik, ahol minden digitális rendszered` /
**`ugyanabba az irányba mozdul.`**

**Was:** the worst instance on the page of the defect this phase exists for.
Fifty-seven characters of prose set at 69px across five lines, filling the
frame — body copy enlarged until it looked like a heading, which is the opposite
of a monument.

**Is:** §8's instruction followed exactly. *"Select the strongest phrase from the
EXISTING approved copy hierarchy and let it control the passage."* The hierarchy
is already in the file — the sentence is authored in two halves — so the
condition is set at the editorial size, right-aligned, and the consequence is
set at 58u under it on the same margin line. One supporting line sits
diagonally opposite at the foot of the spine. Three objects, no body.

The sentence is unchanged, complete, and still reads top to bottom in its own
order: the overline is a `<p>` before the `<h2>` in the document, so a screen
reader meets the condition and then the consequence, which is the order the eye
takes.

**It is the quietest state on the homepage, and it has to be**, because the next
thing is the Proof act and Proof is the loudest. The longest genuine silence in
the journey follows it — §L.

### F3 · `system` · 17 000 – 22 000 m · §9, §10, §11

`Kilenc terület, / három rétegben.`

**Was:** §9's own list, and all of it was there. A 70px heading. A three-column
grid. Three bordered blocks, each with a yellow index numeral, a name and a
note. Nine `name — blurb` items in bordered columns. A concentric ring diagram
turning in the 3D scene behind all of it. **Twenty-one objects in one frame.**

**Is:** 66u on the spine at the middle of the field, on the break the copy
already has at its own comma; one supporting line crossing to the counter-axis
at the top right — the same device Act III and Act V use, which is what makes
the two levels rhyme; and the three layers staged beneath, one per beat, each a
layer name, its note and its three areas in the one structural idiom.

§9 says explicitly not to polish this but to recompose it, and to keep it a
bridge rather than making it a new master act. It sets at 66u against Act IV's
179u on one side and Act V's 174u on the other.

§11's suggestions were investigated and the answer is two of them at once: **a
single restrained vertical sequence** and **one strong category with subdued
supporting items**. Not cards. Not three columns. No decorative geometry — the
ring diagram is out of the scene, which is also §45.

### F4 · `process` · 22 000 – 25 500 m · §11, §12

`Hét ellenőrzőpont, / találgatás nélkül.`

**Was:** the densest state the homepage had. Forty-nine visible objects in one
frame, in a four-column description grid repeated seven times under index
numerals and altitude stamps, on a system of horizontal rules. §11 names what it
read as — admin UI, dashboard, system documentation, slide deck — and all four
are fair.

**Is:** 58u right-aligned to the margin line, high; one supporting line on the
spine below it; and the seven checkpoints staged one per beat down the passage's
own scroll, each a name and its four `term — sentence` lines in one column.

**Nothing was deleted and the phone gained a term.** Twenty-eight sentences and
seven names are all still here, in order, at full contrast, in the tab order and
announced. The four terms are named on both surfaces now, which the portrait
composition had not been doing.

**What it cost.** This passage is 5.6 screens where it was 2.4, and it is the
longest chapter on the page. That is the arithmetic of the requirement rather
than a design choice: thirty-five sentences at the editorial size is about two
screens of type in any arrangement, and staging them so that a visitor meets one
checkpoint at a time adds the air between. §12's rule is about what is visible
at one scroll moment, and at any moment this passage shows ten objects instead
of forty-nine. §N records the length as a deviation.

### F5 · The two act bodies, brought into the same voice — §2, §39, §48

Not crossings, and included because §48's thumbnail sheet made them impossible
to leave.

* **Act III's capability ladder** was a table: a rule across the top, a rule
  under each of six rows, and a fixed 5rem altitude column in the data face in
  the signal colour beside the name and the line. It is now six staged editorial
  items in the passage's structural idiom, with the altitude stamp removed for
  the same reason the checkpoints' was.
* **Acts I and II's annotations** were Layer C — each sentence on its own
  hairline, in the data face, in a third measure, with an uppercase tracked-out
  variant for the instrument caption. Every sentence is now `.passage__terms`
  in the editorial voice: seven on the desktop, eleven on the phone, which
  carries the opening premise in flow where the desktop announces it.

An act's structural layer and a passage's are now the same object, with the same
class and the same rules — not a resemblance but one place to change.

---

## F6 · Transition rhythm — §40–§43

Phase E, and the shortest section in this report, because the correct answer was
to add nothing.

**There is one motion language and it is authored once.** The two ramps a frame
arrives and departs on — `--act-in`, `--act-out` and the presence they multiply
into — are declared on `.panel--act, .panel--passage`, one selector, one
expression, cut out of the `--pass` that `composition.ts` already publishes per
panel once a frame. A passage cannot drift away from an act because there is
nothing separate for it to drift in.

**§41 asked for the crossings' easing to be audited and replaced if it
contributed to the playful feel.** It did, and it is gone with the composition
it belonged to: the reverse-gravity grammar — a lead band settling *down* into
legibility over the first tenth of a chapter, holding, then drifting down out of
frame as the visitor climbed past it, with a windowed flow band walked by
`--stage-flow` underneath — was `Panel`'s, and `Panel` has no call sites. What
replaces it is the acts' ramp, which the previous pass tuned against the
whole-journey scan and which §24 freezes.

**§42 — no large scale-in reveals.** Nothing on either level scales on arrival.
The arrival is opacity, over the last 0.12 of a screen of the approach and the
first 0.18 after it. A monument and a passage statement both already exist in
the environment and the visitor reaches them.

**§43 — the departure is quieter for a passage than for an act.** Opacity, plus
a short rise in the direction the visitor is already travelling: 34 reference
pixels for an act, **22 for a passage**. The subordinate object moves less,
which is the rule the type scale follows one line up. No fly-away, no pop, no
scale collapse, no morph.

**What was NOT added:** no keyframe, no timeline, no transition on a statement,
no scroll-driven animation, no observer, no second clock. §33's whole point, and
§54's numbers are what it buys.

The one motion change this pass did make is a bug fix rather than a design
change, and it is in §L3: both levels' ramps now key on the panel's measured
height instead of on its share of the altitude curve, so a frame's departure
starts at the moment it actually unpins.

---

## G · The header's call to action — §21, §52

### G1 · The defect

The homepage opens on Act I — the smallest fill in the design, five objects and
a great deal of air — with the shared flight deck across the top of it in its
`opening` state. That state carried **two filled yellow blocks**: the quote
button at `rgb(255 238 37)` and the active locale chip on the same fill. So a
journey whose entire yellow budget is two events, the last of them the closing
invitation, began with two yellow blocks that were neither of them.

`§L1` of the production report had already recorded it as the one yellow outside
the budget, with a one-rule fix. §21 asks for the fix.

### G2 · The treatment

§21 offers white, a restrained outline, or a quiet neutral text treatment — and
the answer that adds nothing to the page is already in the shared stylesheet.
`.nav__cta`, the button the deck shows once it has collapsed into its `journey`
state, is a restrained outline in the paper ink that turns yellow on hover. The
opening state's button is set the same way, so the two forms of the same call to
action are one treatment for the length of this route instead of two.

| | before | after |
| --- | --- | --- |
| background | `rgb(255 238 37)` | `transparent` |
| label | `rgb(0 0 0)` | `rgb(244 244 244)` |
| border | the signal | `rgb(244 244 244 / 0.14)` |
| hover / focus | — | the signal fill on `--void` |

The active locale chip loses its fill and is marked by an underline instead —
it is a current-state marker rather than a call to action, and marking the
current item by contrast is the decision `.fallback__states` and the closing
action already make on this page. `aria-current` is untouched.

### G3 · Scope, and the validation §52 asks for

Every rule is in the homepage's own stylesheet, which no other route links.
`chrome.css` is not touched. The other 66 routes keep the filled button exactly
as it is. The link, its `href`, its label and its position are unchanged, the
menu's own quote route is unchanged, the footer's convergence buttons are
unchanged, and Act I's own invitation is unchanged.

* **Homepage ascent state uses a neutral CTA** — asserted: the resting
  `background-color`, `color` and `border-color` are all checked against the
  signal colour and the background is checked to be transparent.
* **Hover / focus remains obvious** — asserted as a *change* from the resting
  background rather than as a specific colour, so the treatment can be revised
  without the contract lying.
* **Keyboard focus contrast passes** — the focus state is the signal fill with
  `--void` text, which is the highest-contrast pairing either button has and the
  one every filled control on the site already uses.
* **Other pages retain their commercial treatment** — by construction: the
  selectors are inside the route's own stylesheet.

---

## H · The Altimeter — §20, §25, §26, §53

### H1 · The crossing budget

Unchanged, and now asserted rather than assumed. Nine chapters of eleven declare
`instrument: 'absent'` in `scene.ts`; the two that do not are Act I and Act VI.
A new contract walks every passage, settles on it, and reads the presence the
page publishes: **below 0.02 at all four**, and each passage's declared budget
is checked against the same table.

`--instrument` measured at the four passages: `0.000` at every one.

No instrument was added to a crossing. §20 holds.

### H2 · The arrival's optical pass — §25

§M3 of the production report asked for production evidence before this pass was
made. `experiments/probe-arrival-instrument.mjs` is that evidence: it captures
the crop the dial occupies and reports the luminance distribution, because
"black object with legible form" is a measurable claim and "it looks like a black
patch" is not.

**Before:** p05 3.7, p50 5.7, p95 39.4, p99 42.7, spread 39.1, ink 25.7% — three
quarters of the object's own box indistinguishable from the field behind it.

§25 permits four levers and forbids the fifth. The pass moves the `final` terms
only — the ones that are zero below the stratosphere — and it moves the ambient
**down**:

| | was | is | why |
| --- | --- | --- | --- |
| ambient `final` | 0.45 | **0.16** | The term that was flattening it. Ambient on a dark object raises the floor everywhere at once and leaves the form nothing to be read from; the way to a legible form is not more light on the shadow side |
| fill `final` | 0.75 | **0.40** | The same argument on the far side |
| rim `final` | 5.0 | **20.0** | Where the legibility comes from instead |
| key `final` | 5.0 | **7.5** | The compensation for the ambient, on the lit side only |

**The rim's number is large because its contribution is confined by geometry.**
It sits behind the object, so it reaches the silhouette edge, the bezel's inner
facets and the upper limbs of the concentric rings, and nothing that faces the
viewer. A sweep of 0, 5, 12 and 20 at the arrival measured **p99 identical at
47.4 across all four** while the ink share rose 25.3 → 26.1%. That is exactly the
property §25 asks for: more form, no more brightness.

**After:** p05 3.7, p50 5.7, p95 43.4, p99 47.4, spread 43.7, ink 26.1%, and
**zero pixels above 235** before or after. An object whose brightest percentile
is 19% of white is a black object. What changed is that its form can be read.

**No geometry changed, no material was replaced, no GLB was touched and no
object was added.** §26.

### H3 · What was investigated and not shipped

The environment probe's lower ring. §25 names environment reflection and it was
the first thing tried, on the theory that the underside of the housing had
nothing to reflect. Raising `Lightformer` three from 0.7 to 1.5 moved the
arrival's ink share by 0.2 points — inside the noise — and it is the only lever
in §25's list that is **shared with Act I's protected frame**. A change that
does nothing measurable and can only put a master frame at risk is not a change.
The emitter is untouched and the probe is in the report.

### H4 · Act I is arithmetically unaffected

`finalCalibration` is zero through the first nine chapters, so none of the four
terms above is in force at the opening. Measured in the same run rather than
assumed: **p05 3.8, p50 8.7, p95 20.8, p99 38.0, spread 34.2, ink 60.5% — before
and after, to the tenth.**

### H5 · §53's captures

`continuity/instrument/` carries the arrival crop and the whole arrival frame,
before and after, plus the four-arm rim sweep and the five-arm recipe sweep.
The reduced-motion arrival is in the review sheet rather than here: that path
mounts no renderer, so there is no instrument to photograph — the statement is
the whole frame, which is §53's "the statement remains the first visual read"
answered by there being nothing else in it.

---

## I · Yellow — §22

The budget is two events and §22's word for the rest of the journey is **zero**.
That is a claim about pixels rather than about a stylesheet — `--signal` is
inherited, overridden per subtree, and reached through gradients, borders and
fills as well as colour — so `experiments/probe-yellow.mjs` walks the page and
asks every element what it actually resolved to, in every property that paints.

### I1 · Desktop, 1440 × 900

Before and after, inside `<main>`:

| chapter | element | verdict |
| --- | --- | --- |
| `selected-work` | `~15M Ft` — the figure | **budgeted** |
| `destination` | the closing action | **budgeted** |

Two, and nothing else. The desktop had already been holding this since the
previous pass; the probe was written to check it rather than to fix it, and it
found the header (§G) and the phone.

### I2 · Portrait, 390 × 844 — twelve elements, all inside the journey

| chapter | what was yellow | why it is not any more |
| --- | --- | --- |
| `lower-atmosphere` | **six** altitude stamps down the capability ladder | §6's altitude decoration. Removed with the ladder's table. The station dot on each step and the yellow stop at the head of the rail are on the same object and go with it — they are a `::before` and a gradient stop, so the probe's element walk does not see them and they are read off the stylesheet rather than off the page |
| `selected-work` | **two** — both routes out of the Proof act | the desktop act deliberately does not colour them, for exactly this reason: the act has one yellow event and it is the figure |
| `destination` | **two** — both links inside the closing contact line | the desktop's are `--chrome` |
| `calibration` | **one** — the opening action | the yellow map in `acts.ts` gives Act I `none` and the action beat `action`. The desktop opening is a line of type on a hairline in the editorial ink; the phone's was the signal colour, so the page spent its scarcest asset in the first frame |
| the telemetry strip | **one** — the live altitude, **in every frame of the entire journey**, plus its progress fill on the same argument | §H2 of the previous report put the desktop's readout into a live region for the same reason |

**Nothing was removed and nothing lost a role.** Every one of those elements is
where it was, at the same size, with the same target, the same `href` and the
same text. What changed is that they are in the page's own ink instead of the
one colour it has decided to spend twice.

The mechanism is the variable rather than nineteen overrides: `--signal` is
reset for the whole flow and re-granted to the two budgeted events by name, so a
rule that reaches for it later inherits the budget instead of inheriting the
colour. It is the same arrangement, and the same argument, as
`:root .panel:not(.panel--act) { --signal: var(--act-34) }` on the desktop.

### I3 · After

Both surfaces, inside `<main>` plus the fixed strip: **`~15M Ft` at the proof
and the closing action. Nothing else, anywhere.** Asserted on both surfaces by
walking the painted result rather than by counting rules — which is what found
the six ladder stamps and the strip in the first place.

Outside `<main>`, and outside the ascent: the skip link's focus state, the
shared footer's convergence buttons and its `30 000 M` state line, and the
closed menu's locale chip. §21 scopes the design decision to the homepage
ascent; the site's footer is not the ascent, and neutralising it is a conversion
decision this phase has no mandate for.

---

## J · Mobile — §27, §28, §29

### J1 · The same hierarchy, from the same function

`data-level` is published on every portrait section from `levelOf()` — the
function the desktop panel uses. A regression contract asserts all eleven agree
across the two surfaces. A page whose two surfaces disagreed about which
chapters are destinations would be two designs rather than one design on two
devices, which is what §27 is written against.

The passage tier is the `plain` monument tier the crossings already had —
1.9–2.6rem against the acts' 2.9–4.8rem — because that ratio is the desktop's
ratio. What it gained is the measure and the air of a composition rather than of
a heading.

### J2 · What was removed, and it is §6's list again

The eyebrow with its roman numeral and altitude range on all four crossings; the
Meridian rail with its yellow top stop; the station dot per entry; the index
numeral on every layer and every checkpoint; the altitude stamp on each; the
two-column description list; the bordered list items for the nine areas; the
word-level colour inside two statements; and the annotation layer. All of them
authored out **against the level rather than against four stage ids** — a
crossing added later inherits the rule instead of inheriting the old design.

### J3 · `A tisztaság…` is set the same way on both surfaces

The condition quietly above, the consequence as the statement. §8's decision is
an editorial one rather than a desktop one, and the phone reverting to a
five-line wall of display type would have been the two surfaces disagreeing
about the copy.

### J4 · §28 — the architecture is untouched

Native document scroll. No sticky master system. No new measured-scroll engine.
No layout feedback loop. No new WebGL. **No new observer, no new scroll
listener, and nothing added to a frame** — the reveal system is the one that was
already there and the elements it observes are the ones it already observed
(`.mv-head` is still the box the high line watches). The whole change is markup,
CSS, typography and content presentation, which is what §28 asks for in as many
words.

The `zero new scroll listeners during a scroll` contract in
`mobile-homepage-simple.spec.ts` is unchanged and still passes.

### J5 · §29 — the passages resolve in a beat, and one of them did not

§29 asks for the measurement rather than the assumption, and the measurement
found a defect the recomposition had introduced.

| passage | was | is |
| --- | ---: | ---: |
| `cloud-entry` | 0.38 screens | **0.60** |
| `cloud-breakthrough` | 0.24 screens | **0.48** |
| `system` | 1.42 screens | **1.64** |
| `process` | 3.21 screens | **3.43** |

**`cloud-breakthrough` was a quarter of a screen.** Three objects — the
condition, the consequence and one supporting line — is 203px on a 390, and the
recomposition made the chapter *shorter* than the design it replaced, because
the old version set the whole sentence as a four-line display headline with an
eyebrow over it.

Two things were wrong with that, and the second found the first.

§5 asks for MONUMENT → WHISPER → MONUMENT, and this is the whisper directly
before the Proof act. With a chapter gap and nothing else, the phone ran the
quietest state straight into the loudest with no air between them. §29 puts a
number on the same thing from the other side: a passage should resolve within
about one screen-scale beat, and a quarter of one is a paragraph.

**And the accessibility walk stepped over it.** `portrait-journey.spec.ts` walks
the document in steps of 0.45 of a viewport, and a chapter shorter than the step
can be passed without ever being entered — so the stage readout never announced
it. That is the same defect §G4 of the production report recorded against this
exact chapter once already, and it came back the moment the chapter got shorter.

The fix is `padding-block-end` on every passage, and each word of that is a
decision:

* **not a margin.** The stage bands are measured from each section's own box —
  `measureAscent` reads `getBoundingClientRect()` — so space *between* two
  sections belongs to neither and the walk can still step from one into the next.
* **not top padding.** It is capped at about 16svh by `the first meaningful line
  of every chapter is near its own top`, and rightly: air above a chapter's
  first line is a chapter the visitor scrolls into rather than arrives at.
* **bottom padding moves nothing.** The statement stays exactly where it was
  against its own boundary, and what grows is the silence *after* it — which is
  what §13 asks for in as many words.

`vw`, like every other length in this composition, so a collapsing toolbar moves
no chapter.

**And the number took four attempts, because it is bounded from both sides and
the two suites measure the same phone at two heights.** The full-ascent config
states its viewports — 390 × 844, the device's panel size — while the site
config takes the device descriptor's content box, 390 × 664. Same width, same
padding in pixels, and 226px is 27 svh on one and 34 on the other.

| bound | contract | at width 390 |
| --- | --- | ---: |
| floor | the accessibility walk steps by 0.45 of a viewport, and a chapter shorter than the step is never entered | padding ≥ 153px |
| ceiling | a trailing band over 34 svh is a spacer — asserted independently by `no chapter contains a tall run of nothing` and by `no section is a tall empty spacer` | padding ≤ 200px |

45vw is 175px, the middle of that window. The near-misses are worth recording
because each is the same mistake in a different disguise — a length that is
correct on the viewport you happened to measure. 66vw was 92 svh in landscape;
58vw was **34.06 svh against a 34 ceiling** on the site suite's shorter 390;
48vw was 32.1; 37vw put the floor under the walk on the one viewport the walk
runs at. Forty of the pixels came out of the padding and went into the air
around the statement instead, where it is composition rather than a run of
nothing — and §4 asks for it anyway.

Measured across all seven viewport shapes the two suites use: the trailing band
is **23.5–30.3 svh** against the 34 ceiling, and the shortest passage is
**386–424px** against a step of 176–419px.

Objects in one frame after the change: **7 to 12**, against §12's warning line
of twelve and against the twenty-plus the portrait dashboards showed. Zero
horizontal overflow at every step of every passage.

### J6 · The telemetry strip, and the one place §27 was not followed literally

§27 asks for no persistent technical UI. The strip is the closest thing on this
surface to it, and it is **kept**.

The reason is one the previous pass established the hard way. This is the
phone's only altimeter: the desktop reads the altitude through a live region
because it has an instrument in the picture twice, and the phone has a fixed
overlay at zero presence for nine chapters of eleven. Removing the strip would
leave a page whose entire premise is an altitude with no altitude on it — which
is the defect §10.2 of the mobile brief was written against and which has been
reversed once already.

What was removed is its **loudness**: the digits and the progress fill were the
signal colour, in every frame, for the length of the journey. Both are the
page's own ink now. It is stated here as a deviation rather than smuggled in.

---

## K · Reduced motion and accessibility — §30, §31

### K1 · Reduced motion

§30 lists five requirements and each one is asserted rather than argued from the
fact that the stylesheet pins the ramps.

| §30 | how it is satisfied | how it is checked |
| --- | --- | --- |
| no content withholding | every passage's statement is in the box tree with ink | the statement's text length, per passage |
| no zero-height passages | a passage's panel and its frame both have height | `offsetHeight` of both, per passage |
| no invisible transitions | `--act-presence` falls back to 1 when nothing publishes `--pass`, so a visitor with no clock sees every passage settled and still | the frame's computed opacity is above 0.9 on that path |
| semantic sequence remains obvious | document order is altitude order | the eleven `data-stage` values against `journey.ts` |
| Master vs Passage hierarchy intact | the largest passage still sets under 0.68 of the smallest monument | measured on the page, on that path |

**The test runs on both projects on purpose.** A contract that only ran under
`prefers-reduced-motion` could not tell *correct on that path* from *the media
query never matched*.

`--act-presence` is pinned in two places for the reason the previous pass
records: the stylesheet pins the ramps under the media query, and
`composition.ts` stops publishing `--act-visible` and `--act-events`, because an
inline custom property beats a media query. The passages inherit that gate
because they share the declaration — see §D1.

**The passages do not fall back to the previous visual system.** They cannot:
the elements it was made of are not in the document on any path. §30's last
line is satisfied structurally rather than by a media query.

### K1a · What the contract caught, in the page

The reduced-motion pin was written for `.panel--act` and the passages were not
in it.

The ramps are shared — one selector, one expression, §F6 — so the passages
inherited the *choreography* and did not inherit the *pin*, which is the exact
failure mode a shared declaration invites and the reason it is worth a contract
rather than a comment. Measured on that path before the fix: `cloud-entry` sat
at opacity 0, below the fold, on a path whose whole contract is that the
document reads in full. That is §30's first line — no content withholding —
broken by a one-selector oversight.

`.panel--act, .panel--passage` now, and `.act, .passage` for the transform.

### K1b · Photographed — `continuity/reduced-motion/`

`experiments/shots-reduced-motion.mjs` captures the path and states what it
found before the pictures, so the pictures are not the only evidence:

```
reduced: true          the media query actually flipped
canvases: 0            no renderer is mounted
masters: 7             every act is in the document
passages: 4            so is every passage
presence: 1 × 11       every frame is composed and still, none withheld
rejected: 0 × 6        .panel__eyebrow .notes .system .check .ladder .horizon
height: 31.8 screens   one long static document
```

Eight stills — Act I, all four passages, the Proof act, the Arrival and the
action beat — at `r-*.png`. §53's reduced-motion arrival is among them, and
what it shows is the statement alone: that path mounts no renderer, so there is
no instrument in the frame and the statement is the first visual read by
construction rather than by composition.

### K2 · Accessibility

* **Heading structure is unchanged in shape.** One `<h1>` (Act I). Every act and
  every passage opens with an `<h2>`; act bodies and passage bodies use `<h3>`.
  A passage's statement is its `<h2>`, and where the statement is the second
  half of a sentence — `cloud-breakthrough` — the first half is a `<p>` directly
  before it, so the sentence is announced in its own order.
* **Every chapter still announces itself.** The eyebrow's roman numeral, name
  and altitude range are an `sr-only` line, first in each passage's reading
  order. This is also what keeps the accessibility walk finding eleven chapters
  rather than seven.
* **Nothing is staged out of the accessibility tree.** On the desktop the
  structural layers use spacing and nothing else: no `aria-hidden`, no
  `display: none`, no `visibility`, no reveal of any kind. On the phone they
  carry the reveal classes every chapter has always carried — an
  `IntersectionObserver` that transitions opacity and a small translate — which
  is pre-existing behaviour rather than something this pass introduced, and
  which does not remove anything from the accessibility tree. Every word of the
  nine areas, the seven checkpoints, the six capabilities and the four diagnosis
  clauses is in the document, in reading order, at full contrast once revealed,
  and reachable by keyboard. Under `prefers-reduced-motion` the portrait reveals
  are pinned to their resting state, which `mobile.css` has done since the
  mobile reset.
* **The phone gained a sentence.** All four checkpoint terms are named on both
  surfaces now; the portrait composition had been rendering three.
* **Routes are unchanged.** Every destination the old crossings offered is still
  reachable, and no passage carries a link that the composition it replaced did
  not.
* **The neutralised header CTA keeps a visible focus state**, and it is the
  highest-contrast state the control has — §G3.
* **Tap targets** are unchanged: the passages carry no interactive element, so
  the 44px minimum applies where it did before.

---

## L · Performance — §54

§54 asks for enough measurement to confirm that a pass which reduces visual
complexity does not accidentally increase runtime work. It does not.

### L1 · What was removed from the frame budget

* **Two 3D components stopped mounting.** `SystemRings` — three torus
  geometries and nine node discs, with nine per-frame opacity writes — and
  `Checkpoints` — seven markers with seven individually-written materials, also
  per frame. Between 17 000 and 25 500 m, which is two of the eleven chapters,
  the scene now draws neither.
* **The crossings' solves stopped running.** `Panel` carried a measured lead
  band, a measured hang height, a measured above-height, a measured flow
  position, a solved statement width and a solved monument cap — six per
  crossing, on every resize and after every font settle. A passage has no lead
  band, so all six short-circuit and none of `--copy-room`, `--lead-h` or
  `--statement-w` is written for it. The pass still walks every panel; what it
  does inside four of them is now one division.
* **Four per-panel custom properties stopped being written on a scroll frame**
  for the four passages: `--panel-veil`, `--lead-veil` and `--panel-events` have
  no consumer on a passage.

### L2 · What was added

**One number, once per measurement pass.** `--screens` — the panel's own height
in screens — is published beside `--copy-room` and `--lead-h`, from a value the
same pass already had. It is not on a scroll frame.

Nothing else. No observer, no scroll listener, no rAF loop, no timeline, no
keyframe, no filter, no new element type on a scroll frame.

### L3 · The defect it fixed

The ramps used to multiply `--pass` by `--share`, which is the stage's share of
the **altitude curve** and only its minimum height. Measured on the production
build, the two already disagreed by up to 10% on the acts — 1.8 against 1.98 at
the opening — so the departure never quite started at the moment the frame
unpinned, which is the one thing the ramp is written to do.

The continuity pass made the approximation break outright rather than merely
drift: a passage that stages its structural layer under its frame is genuinely
three to five screens tall against a share of two, so `pass × share` reported a
third of the scroll that had actually happened and the frame never left at all —
the statement was still at full strength with the reference detail already under
it. It is visible in the first `after` capture of the process passage.

`--screens` is the measured height, so both levels' ramps now key on the
quantity they were always written against.

### L4 · Measured, per chapter — `continuity/act-cost.json`

The probe used to stop at the seven acts, which meant it could not answer "what
does a crossing cost" — and the two chapters where geometry was removed are
exactly where the evidence is. It stops at all eleven now.

| chapter | instrument | WebGL draws | triangles | style recalcs | layouts |
| --- | ---: | ---: | ---: | ---: | ---: |
| I · Ground | 1 | 57 | 157 694 | 12 | 0 |
| II · Noise | 0 | 17 | 133 724 | 19 | 0 |
| III · System | 0 | 17 | 133 724 | 23 | 0 |
| passage · cloud entry | 0 | 17 | 133 724 | 24 | 0 |
| passage · breakthrough | 0 | 19 | 133 740 | 34 | 0 |
| IV · Proof | 0 | 7 | 1 920 | 69 | 1 |
| **passage · nine areas** | 0 | **1** | **1 840** | 151 | 1 |
| **passage · process** | 0 | **1** | **1 840** | 75 | 0 |
| V · High altitude | 0 | 4 | 9 776 | 110 | 0 |
| VI · Arrival | 1 | 54 | 35 546 | 56 | 0 |
| action | 0 | 4 | 9 776 | 79 | 0 |

**The two structural passages are now the cheapest states on the homepage** — a
single draw call and 1 840 triangles each, against a page whose opening frame
costs 57 and 157 694. That is `SystemRings` and `Checkpoints` measured, and it
is the direction §54 asks for.

The seven acts are unchanged, to the draw call, from the accepted
implementation's own table.

### L5 · The track

The homepage is longer, and this is the honest number: **24.4 screens → 29.9**,
+22%. Most of it is the process passage, which is 5.6 screens where it was 2.4
(§F4), and the rest is the system passage's staging.

It is scroll rather than work: the content per screen fell by a factor of four
at the worst frame on the page (§E3), and the two chapters that grew are the two
that now draw one call each.

### L6 · The whole-track scan — `continuity/journey-scan-hu-1440x900.json`

121 samples down the built route:

```
track 29.85 screens · altitude monotonic: true
longest silence: 0.64 screens
  0.21   8 100 m            cloud layer
  0.64   9 360 – 10 200 m   breakthrough      <- before the Proof act
  0.21  17 820 m            the nine areas
  0.21  21 420 m            the nine areas
  0.21  25 320 m            the process
  0.21  29 880 m            the stratosphere
statement collisions: 0
horizontal overflow samples: 0
```

**The longest silence is where the design put it**: 0.64 of a screen between
`ugyanabba az irányba mozdul.` and `~15M Ft` — the quietest state on the page
running into the loudest, with composed air between them. §13's rhythm, as a
measurement.

---

## M · Tests — §50, §51

### M1 · The line §51 draws, and how it was held

*"Do not build a visual test that forbids all future change. Test semantics and
intentional contracts. Avoid brittle screenshot-coordinate tests unless they
guard a known regression."*

Nothing added below hardcodes a coordinate, a colour or a pixel size. What each
one asserts is a **decision**: the page has two visual levels; a rejected element
does not render; the instrument stays out of the crossings; the yellow stays
spent where it was budgeted. Where a number was unavoidable — the passage
tier — it is a **ratio with a bound** rather than a size, because the decision is
*clearly smaller than a monument and clearly larger than a line*, not 72 pixels.

### M2 · The stale contracts, replaced rather than weakened

| contract | verdict | what replaced it |
| --- | --- | --- |
| `checkpoint-N` has four `<dt>` elements (desktop) | **stale selector, sound contract** | the four terms and their four sentences, asked out of `content.ts` and `messages.ts`. Strictly stronger: counting `<dt>`s could not tell four terms from four empty ones, or notice a term dropped and another duplicated |
| `checkpoint-N` has three `<dt>` elements (portrait) | **stale, and it was recording a defect as a requirement** | the same four-term contract. The phone had been rendering three of the four and silently dropping `Amit tőled kérünk`; a count of three cannot report a missing fourth. Both surfaces now answer the same question and the phone carries all four |
| `the first meaningful line of every chapter is near its own top` selected `.mv-eyebrow, .mv-title` | **stale selector, unchanged rule** | `.mv-passage__overline` added. A passage's first line *is* the overline — §8 sets one authored sentence in two registers, condition above consequence, and the condition is first in the document as well as on the screen. Without it the check reported 60px "inserted above the first line" where the 60px is the first half of the chapter's own statement |
| `a crossing never sets larger than the act it runs under` selected `.act__monument, .panel__title` | **stale selector, unchanged rule** | `.passage__statement` added |

**No assertion was weakened to make a run green.** Two were made stricter, and
one of those found a real content gap on the phone.

### M2a · A defect in the gate itself

`the monuments resolve to their authored geometry in {hu,en,de}` navigates to
`/index.html`, `/en/index.html` and `/de/index.html` — the three built homepage
routes. `npm run test:full` built `/experiments/stratos-ascent-full/` and
nothing else, so those three contracts were running against whatever homepage
happened to be in `dist/`, which on a working tree is the last one anybody
built. Measured while writing the passage's own per-locale contract:
`dist/index.html` was **two days stale** while the suite reported all three
green.

Two output trees with two chunk graphs is the correct arrangement and is argued
for at length in `vite.home.config.ts`; what was missing is that a suite
asserting against both has to build both. `test:full` now runs `build:home` as
well, unconditionally and before Playwright decides anything about servers —
which is the same remedy, and the same argument, as the note in
`playwright.full.config.ts` about why `build:full` is in the npm script rather
than in the `webServer` command. The guard in that command gained a matching
check for the other entry point.

### M2b · And a second one, in the reduced-motion project

`tests/helpers/reduced-motion.ts` exists because Playwright's declarative
`reducedMotion: 'reduce'` does not reliably reach `matchMedia()` in this
project, and its own header says why that matters: *"A green reduced-motion test
that never enabled reduced motion is worse than no test, because it is cited as
evidence."* Every reduced-motion test in `full-ascent.spec.ts` calls
`enableReducedMotion` for that reason.

**No test in `six-acts.spec.ts` ever has.** The `reduced-motion` project
collects that file, so fifteen contracts about the six-act art direction have
been running against the ordinary animated page a second time — and the two
`test.skip(project === 'reduced-motion')` guards inside it have been skipping
tests on a path that was not reduced motion.

Found by the new §30 contract, which failed on that project reporting
`cloud-entry is faded out on the reduced-motion path` when what was actually
faded out was a passage below the fold on the animated page. It now enables
reduced motion for itself, before navigating — the application reads the
preference once, in its capability probe, on first mount — and proves from
inside the page that the query flipped before asserting anything that depends on
it. **It is the only contract in that file for which the project currently means
what it says.**

Fixing it for the whole file means auditing fifteen tests on a path they have
never run — several of them wait on `--instrument`, which that path does not
publish because it mounts no renderer — and that is its own change rather than a
line in this one. §O carries it.

### M3 · New contracts

`experiments/tests/six-acts.spec.ts`, nine added, and all of them run on
`desktop` and `reduced-motion`:

1. **passage classification** — every chapter declares `master` or `passage`,
   from the same `levelOf()` the page renders from; seven and four; and every
   passage carries `data-passage`, `data-passage-kind` and `data-axis` out of
   `PASSAGE`. A fifth passage cannot be added without being classified.
2. **no old visual system** — nine selector groups from §6's list, asserted
   absent from the **document** rather than invisible, because §34 forbids
   leaving a second working visual system behind a selector. Each names the §6
   item it guards, so a failure says which decision was reversed. Plus the two
   scene diagrams, asserted against `JourneyScene.tsx`'s source — a three.js
   object leaves no trace in the DOM for a page test to find, and re-mounting
   one is precisely the regression §6 and §45 are written against.
3. **master protection** — the seven acts in order, each above the last, each
   still carrying its own authored statement out of `messages.ts` at the size
   `MONUMENT` names.
4. **the passage tier** — the ratio bounds above, plus the hold: a passage is
   pinned for less scroll than an act.
5. **the Altimeter's crossing budget** — the published presence at every
   passage, below 0.02, and each passage's declared budget.
6. **reduced motion** — §30's five requirements, on both paths.
7. **the passage statements hold their measure**, in Hungarian, English and
   German — one line box per authored line, the line count `PASSAGE` declares,
   the size it declares, and no line wider than the 1200u type field. Three
   tests, one per locale, and they are what makes "one size across the three
   locales" a measurement rather than an assumption.

`experiments/tests/portrait-journey.spec.ts`, three added:

7. **the two surfaces agree** — all eleven chapters resolve to the same level as
   the desktop's, from the same function.
8. **no old visual system, in portrait** — five selector groups in the portrait
   composition's own class names.
9. **the phone spends yellow exactly twice** — asked of what actually painted
   rather than of what the stylesheet declares, which is what found the six
   ladder stamps and the telemetry strip.

**The header CTA contract is in `tests/homepage-chrome.spec.ts`**, not in the
full-ascent suite, and the reason is worth stating: that suite runs against
`/experiments/stratos-ascent-full/`, which is a bare mount host with no site
chrome on it at all. The first version of the contract was written there and
waited two minutes for a button that route correctly does not have. The chrome
is substituted into the three homepage shells at build time, so the built
homepage is the only artefact where "the header has a call to action" is a fact
rather than an intention.

It asserts the resting state is neither filled nor the signal colour, that the
locale chip is not filled either, that focus produces a visible change, and —
on `/szolgaltatasok.html`, in the same test — that a service route still has its
filled button. That last one is §21's "do not globally destroy a useful
conversion element", turned into a check that the scoping worked.

### M4 · What the existing gate still covers, unchanged

Monotonic altitude, horizontal overflow at 51 samples, statement collisions,
dead stages, the monuments' authored geometry in three locales, the featured
case, the figure and its label, the Altimeter's act budget, history restoration,
the menu's focus trap and modality, Return to 0 m, and the zero-new-scroll-
listeners contract.

### M4a · Results

**`npm run test:full` — the whole gate, on the production build: 196 passed,
0 failed, 36 skipped.** Seven projects: `desktop`, `reduced-motion`, and the
five phone shapes `mobile-390`, `mobile-430`, `mobile-375`, `mobile-360`,
`mobile-landscape`. Machine-readable at `continuity/playwright-full.json`.

**The site's own homepage specs — the other gate this change is in scope for —
`homepage-chrome`, `homepage-history`, `homepage-modality`,
`mobile-homepage-simple` and `public-site`, at `desktop-1440`, `mobile-390` and
`mobile-430`: 251 passed, 0 failed, 50 skipped.**
`continuity/playwright-site-homepage.json`. History restoration, the menu's
focus trap and modality, Return to 0 m, the deck's readouts, the mobile
instrument's appearance budget, the zero-new-scroll-listeners contract and the
three-locale route checks are all in that number, along with the new header CTA
contract.

**What the gate caught that nothing else did**, in the order it caught it —
every one is a defect that shipped in an intermediate state of this pass and was
fixed rather than accommodated:

1. **The passages were never pinned on the reduced-motion path.** §K1a. The
   ramps are shared and the pin was not, so `cloud-entry` sat at opacity 0
   below the fold on a path whose whole contract is that the document reads in
   full.
2. **A `vw` length on a wide, short viewport.** The passage foot silence was
   `clamp(260px, 66vw, 360px)`, which is 27 svh in portrait and **92 svh at
   844 × 390** — four landscape passages each trailing most of a screen of
   nothing. `no chapter contains a tall run of nothing` failed all four at its
   34 svh threshold. §J5 has the bounded replacement.
3. **A `vw` length that is only correct on the viewport you measured.** The
   passage foot silence passed the full gate at 27 svh and failed the site
   suite at **34.06 against a 34 ceiling** — because the two configs measure
   the same phone at two heights: the full config states the device's panel
   size, 390 × 844, and the site config takes its content box, 390 × 664. Same
   width, same pixels, seven points of svh apart. §J5 has the bounded solve.
4. **The stale homepage build**, §M2a, and **the reduced-motion project that
   was not reduced motion**, §M2b — both found while writing the contracts
   rather than by running them.

### M5 · Tooling added

| | |
| --- | --- |
| `experiments/probe-crossings.mjs` | §36's inventory: every legible object, its size, and §6's patterns, per state |
| `experiments/probe-passages-mobile.mjs` | the same walk at 390 × 844 |
| `experiments/probe-yellow.mjs` | every element that paints the signal colour, on either surface |
| `experiments/probe-master-frames.mjs` | §46: the seven frames' object geometry in reference pixels, and the drift against a baseline |
| `experiments/probe-arrival-instrument.mjs` | §25, §53: the arrival crop's luminance distribution |
| `experiments/png-luma.mjs` | a minimal PNG reader, because the WebGL canvas cannot be read back and the measurement has to come off the capture |
| `experiments/shots-journey-sheet.mjs` | §47 and §48: the twenty-state sheet and its thumbnail version |
| `experiments/shots-journey-sheet-mobile.mjs` | the same at 390 × 844 |
| `experiments/record-journey-scroll.mjs` | §49: the full scroll at a reading pace, both surfaces |
| `experiments/shots-reduced-motion.mjs` | §30, §53: the path with no clock, stated and photographed |

---

## M6 · Master frame protection — §46

"A crossing change must not accidentally alter master vertical positioning,
monument scale, master Altimeter size, Rapidkert framing, High Altitude
composition, Arrival placement, Action composition."

The seven frames were photographed again, at the same viewport and the same
settled positions, and compared to **the accepted implementation's own published
stills** — `luxury-art-direction/production/after/`. The comparison is reported
as a share of pixels rather than as a pass, because these frames sit on a live
3D scene: a decode order or a damped light one frame early moves pixels that no
design decision moved. What the number is for is size.

| act | mean Δ | pixels beyond 8 levels | **beyond 32 levels** |
| --- | ---: | ---: | ---: |
| I · Ground | 0.94 | 0.43% | **0.42%** |
| II · Noise | 0.02 | 0.02% | 0% |
| III · System | 0.02 | 0.01% | 0% |
| IV · Proof | 0.10 | 0% | 0% |
| V · High altitude | 0.02 | 0.14% | 0% |
| VI · Arrival | 0.16 | 0.49% | **0.13%** |
| action | 0.00 | 0% | 0% |

**Two frames differ and both differences are the two changes this phase
intended.** Act I's 0.42% is the header's yellow block and locale chip becoming
a restrained outline and an underline — §G, and the side-by-side shows the
composition underneath them is identical. Act VI's 0.13% is the instrument's
optical pass — §H2. Five of the seven are zero.

`accepted-vs-after-hu.png` is the side-by-side a human judges. The geometry half
is `after-hu.json`: every object's rectangle in the study's own reference
coordinates, and every monument at the size `MONUMENT` names — 148, 167, 162,
179, 174, 143, 136.

### M6a · What it caught

A ghost of the Altimeter in the action beat.

The withdrawal shrinks and recedes rather than fading, deliberately, so a
departing instrument is not a dial at 8% opacity pretending to be atmosphere.
But a shrunk object is still fully lit, and §H2 roughly doubled the key and
quadrupled the rim above 25 000 m — so the same 2% presence that used to be
invisible in the closing frame came back as a legible little ring beside the
invitation, in the frame the whole design intends to be the emptiest on the
page. It is not visible in a stylesheet, it is not visible in the DOM, and no
existing contract could see it.

The draw cut-off moved from 0.012 to 0.05 presence, where the object is at 22%
of its scale and 0.86 units further back and the ramp spends two hundredths of a
screen between there and zero. The action frame is now identical to the accepted
still to the pixel.

---

## N · Visual deviations

Things that differ from the intended luxury language, each a decision rather
than a slip.

### N1 · The process passage is the longest chapter on the page

5.6 screens against Act IV's 2.5. §18 asks the master acts to remain the
destinations, and by duration this passage is now longer than any of them.

It is not longer by *weight*: at thumbnail scale it is a sequence of quiet
editorial blocks with a great deal of air, and the master acts are still the
only monumental frames on the sheet. But the arithmetic is what it is — thirty-
five sentences at the editorial size is about two screens of type in any
arrangement, and §12's requirement that a visitor meet them one at a time adds
the air between. The alternative is to move the four-term detail off the
homepage, which §12 does allow — *"move non-essential detail into service
routes, Work, deeper pages where appropriate"* — but there is no route on the
site that carries this process today (the service pages carry a different,
three-step one), so it would mean authoring a new page, which is outside this
phase.

### N2 · Every silence is produced by the ramps, not by an authored frame

§14 permits a silence to contain an atmospheric shift, one distant word, one
fading previous thought or one emerging next thought. The six the whole-track
scan measures — two of which are on the review sheet as states in their own
right — carry the last two of those and the background wash, and nothing that
was placed there on purpose.

That is a defensible reading of §14 rather than an evasion: a departing
statement and an arriving one, over a background that is a continuous function
of altitude, is composed. But it is worth stating plainly that no silence on
this page contains an element authored FOR it, and if the review wants one, §15
names the candidate.

§15 floats a preview fragment — *"before System, a distant `Rendszer.` may
work"* — and it was considered and not taken. The fragment was retired in the
previous pass with a measured argument (it overlapped its own chapter's headline
at the `system` crossing), §15 asks for fragments to be *reduced* and they are
already at zero, and adding one back is a new element in a phase about removal.
The eleven authored words and `.horizon`'s rules are still in the repository, so
reinstating one is a one-line change if the review wants it.

### N3 · The shared site header is still in Act I's frame

Unchanged from §L1 of the previous report: the deck is a nav bar across the top
of the opening frame, which the study's frames do not have. Its yellow is gone
now (§G), which was the part §21 asked about.

### N4 · The sound control is still a ninth object

Unchanged from §L2 of the previous report. A control is not decoration and a
feature cannot be deleted to make a screenshot match. It is at micro scale, at
34% opacity, at the frame's bottom right, in every frame.

### N5 · The telemetry strip is persistent technical UI on the phone

§27 asks for none. §J6 has the argument and the mitigation.

### N6 · Two structural beats can share a frame

At the pitch that keeps the process passage to 5.6 screens, a frame occasionally
catches the foot of one checkpoint and the head of the next rather than one
whole beat centred in it. Ten objects rather than six, still under §12's warning
line, and it is the trade §N1 describes from the other side: a taller beat gives
one at a time and a longer page.

---

## O · Remaining limitations

1. **The old crossing composition's CSS is still in the stylesheets.**
   `.panel__*`, `.notes*`, `.system*`, `.check*`, `.ladder*`, `.horizon*` and
   their portrait counterparts — a crude selector scan puts it at about 1 500
   lines across the two files, which is an upper bound rather than a
   measurement, because some of those selectors also name rules the acts still
   use.

   What is not in doubt is that none of it renders: **no element on either
   surface carries any of those classes**, and two regression contracts assert
   exactly that by counting them in the document rather than by checking their
   visibility. §55 is explicit that dead CSS comes out *after* the design is
   visually approved, and this is the change that has to be reviewed on its own
   merits first. The removal is mechanical and those two contracts are what make
   it safe — they are also the list of what to remove.

2. **`SystemRings.tsx` is still in the tree.** Nothing mounts it; the suite
   asserts that against the scene's source. It goes out with the CSS.

3. **`six-acts.spec.ts` does not enable reduced motion, except in one test.**
   §M2b. Fifteen contracts about the six-act art direction are collected by the
   `reduced-motion` project and run against the animated page; two are skipped
   by name on a path that is not the path they think it is. It is a pre-existing
   defect that this pass found rather than caused, and repairing it means
   auditing all fifteen on a path they have never run — several wait on
   `--instrument`, which that path never publishes. The §30 contract added here
   enables and verifies the path for itself, so the requirement §50 asks for is
   met; the rest of the file is worth its own change.

4. **The process passage's length.** §N1.

5. **The Proof plate is still a screenshot.** Unchanged from §M1 of the previous
   report. Out of scope here — §23 freezes the Rapidkert solution.

6. **The arrival instrument is legible rather than beautiful.** §H2 moved it
   from a black patch to a black object with a readable bezel and a readable
   ring structure, inside §25's constraint that it must not become bright. The
   remaining limit is the scene rather than the lighting: at 28 000 m the sky is
   black and the environment probe has almost nothing for the metal to reflect,
   so the object is read from its rim and its key rather than from its
   surroundings. Going further means an environment contribution at the ceiling
   or a material pass, both of which §25 and §26 exclude.

7. **The full-scroll review is a recording rather than a real finger.** §49 asks
   for a natural human scroll pace and the recorder steps at one viewport per
   1.4 seconds on a 25 fps cadence, which is a reading pace and is not momentum
   scrolling. Rhythm, continuity, dead space and overlap are all visible in it;
   the feel of inertia on a trackpad is not, and no capture can carry that.

8. **Three locales are contracted but only Hungarian is photographed here.**
   The passage settings are one size each across the three, and that is now a
   test rather than a claim — `the passage statements hold their measure in
   {hu,en,de}` counts line boxes per authored line and checks each line against
   the 1200u field, which is the same question the monuments' per-locale
   contract asks one tier up. The review sheets are Hungarian; a German sheet
   would be the strongest single addition to the next review, because German
   sets the longest line in three of the four passages.

# Stratos — luxury art direction reset

**Phase 1. Direction only. Nothing in this pass touches production.**

`styles.css`, `scene.ts`, `composition.ts`, `journey.ts`, the scroll mechanics
and the mobile route are all unchanged. Nothing is pushed, merged or deployed.
The working tree carries one new directory — this one — plus a scratch render
page under the gitignored `dist/`.

What is here:

| | |
| --- | --- |
| `01-direction.md` | this document, §A–§J |
| `frames/01…06-*.png` | six static composition studies, 1440 × 900 |
| `review-sheet.html` / `.png` | the six in journey order, for human review |
| `frames.html` | the studies' source — no production CSS is involved |
| `assets/instrument-*.png` | three renders of the shipped Altimeter GLB |
| `studio.html`, `stage-studio.sh`, `render-instrument.mjs`, `shoot*.mjs` | the pipeline that produced them |

**Nothing in the studies is invented.** The type is the two licensed families
already in `assets/fonts/`. The palette is five values already in
`styles.css` and `components/Sky.tsx`. The instrument is
`public/models/stratos-altimeter.glb` photographed under the same four lights
`components/MeridianLights.tsx` sets. The Rapidkert capture and the six
collaboration marks are the files already in `assets/img/`. Every word comes
from `locales/messages.ts` or `content.ts` — statements are shortened, split or
re-ranked, and no claim was written. The Rapidkert figure keeps its exact
meaning: *contracted project value from search*, not revenue and not profit.

---

## A · Why the current design feels playful

Not opinion. Each of these is a countable property of the frames in
`_build/reports/homepage-art-direction/shots/after/`, which is the current
homepage at this exact viewport.

### A1 · Nine devices are active at once, all at similar contrast

The 0 m frame (`desktop-00000.jpg`) carries, simultaneously:

1. a site header with seven nav items, a three-state language pill, a filled
   yellow `Árajánlat` button and a hamburger;
2. an eyebrow — `— I · KALIBRÁCIÓ 0 M` — with a rule, a roman numeral, a
   chapter name **and** an altitude, in mono;
3. a four-line headline with one word in yellow;
4. a three-column mono annotation block in the upper right, 34 words of it;
5. a support paragraph, with one more word in yellow;
6. two calls to action, side by side, of equal size;
7. a large HUD altitude readout with its own progress rule;
8. a HUD phase label;
9. a circular instrument-glyph button below it.

That is nine competing objects before the visitor has read one word. The
composition is not "busy" as a matter of taste — it has nine centres.

### A2 · The instrument is in almost every frame at almost the same size

`scene.ts` already fought this: `SCENE_RECEDE` exists precisely because seven of
eleven chapters used to take the same role. The fix worked, and it was the right
fix for the problem it was aimed at — but it solved *size*, not *presence*. The
dial still appears in **eleven of eleven** chapters. A visitor scrolling for
ninety seconds sees the same circular object without interruption, and after the
third repetition the page stops reading as a journey and starts reading as a
themed interface. Repetition, not scale, is what makes it feel like a game HUD.

### A3 · Yellow is a default text treatment

Counted on the shipped frames: **0 m carries five** yellow objects — the
`Árajánlat` nav button, the `HU` language pill, the eyebrow's `0 M`, the
headline word `Magasságot`, and the CTA fill. **3 600 m carries four.**
**18 400 m sets half its headline** — `három rétegben.` — in yellow, plus the
header altitude and the eyebrow altitude. **24 400 m** puts a yellow index
number on every one of seven checkpoint rows.

When the accent appears on every screen, it stops being an accent. It is
currently doing the work of a highlighter, and a highlighter is the single most
"eager" mark a page can make.

### A4 · Microcopy is used as decoration, and it reads as a cockpit

Per frame, the shipped page carries: a roman numeral, a chapter name, an
altitude *range* in the eyebrow, an altitude *readout* in the HUD, a phase label
under the readout, a duplicated altitude in the sticky header, a per-item
altitude on every process row, and mono annotation columns. That is the same
number said up to four times in four places.

Mono, uppercase, `.2em` tracking, small, grey — repeated eight times per screen
— is aerospace *interface*, which §14 explicitly rules out. The aerospace idea
should arrive through proportion and precision, not through instrument labels.

### A5 · The densest frame is a spreadsheet

`desktop-24400.jpg` is the process ledger: seven checkpoints × four labelled
terms = **28 label/value pairs**, in a two-column grid, with rules between rows,
a yellow index and an altitude on each. It is a table. There is no
art-directable version of a table on a luxury homepage; the only correct move is
to remove it from this surface.

### A6 · The same claim is made twice, 15 000 m apart

`Hat terület, egy rendszer.` at 3 600 m and `Kilenc terület, három rétegben.` at
18 400 m are the same statement with different arithmetic. The visitor cannot
tell whether they are being counted six things or nine, and the repetition makes
the second one read as filler. Fragmentation of this kind is what makes eleven
chapters feel like eleven slides.

### A7 · Every chapter is a hero

Eleven chapters, eleven headlines, eleven eyebrows, eleven backgrounds. Even
with `scene.ts`'s five tiers, the *cadence* is uniform: new screen → new
statement → same dial. The visitor learns the pattern by chapter three and
spends the rest of the page predicting it. Predictability reads as a demo.

---

## B · The new luxury principles

These replace §A one for one.

**B1 · Subtraction is the default.** For every element in a frame: *does this
increase authority?* If not, it goes. Nothing was added to the studies except
space; see the object count at the foot of §C.

**B2 · One centre of gravity per frame.** Every act nominates exactly one
dominant element — instrument, typography, image, or negative space — and
everything else in the frame is demonstrably subordinate to it. Two acts never
nominate the same one in sequence.

**B3 · Monument and whisper. Nothing in between.** One statement at extreme
scale, one supporting line at small scale, and no third tier competing with
either. The gap between them should be dramatic enough to be a decision rather
than a step in a scale.

**B4 · Yellow is an event.** At most one primary yellow focal element per major
frame, and three of the six acts carry none at all. Yellow never sets a word
inside a sentence.

**B5 · Silence is a material.** A micro label has to earn its place by giving
orientation or meaning. "It looks designed" is not a reason. Three micro marks
survive across six frames.

**B6 · The instrument is rare enough to be valuable.** Three appearances in the
whole ascent, each a different object in the frame — presented, consulted,
returned.

**B7 · Weight, not size, makes type expensive.** A monument is Archivo at 380
across 150px. The same size at 620 is a banner. Restraint at scale is the whole
effect.

**B8 · Every empty region is intentional.** Emptiness that sits opposite a
strong element is luxury; emptiness that surrounds a small element in the middle
of a frame is an unsolved composition. §H records the check that was actually
applied.

---

## C · Removal audit

Aggressive, as asked. "Once" means *once on the whole page*, not once per
chapter.

| Element | Verdict | Why |
| --- | --- | --- |
| Chapter eyebrows (`I · Kalibráció`) | **REMOVE** | Roman numeral + chapter name + altitude range, eleven times. Pure ornament; it labels a structure the visitor is already inside. |
| Altitude range in the eyebrow | **REMOVE** | The third place the same number appears in one frame. |
| Persistent HUD altitude readout | **REDUCE → once per act, small** | It is the page's one genuinely orienting mark, and it is currently the size of a headline. It becomes a micro mark; in the studies it survives in two frames of six. |
| HUD phase label + instrument glyph button | **REMOVE** | The label repeats the eyebrow; the button is interface ornament. |
| Sticky header altitude echo | **REMOVE** | Fourth instance of the same number. |
| Mono annotation columns (0 m, right) | **REMOVE** | 34 words explaining that the model is custom. If the frame is good, it does not need a caption arguing that it is. |
| Per-scene atmospheric fragments / horizon words | **REMOVE** | `horizon.*` is eleven one-word captions of the chapter you are already reading. |
| Capability ladder (six areas) | **KEEP, once** | Real content, and the only list that survives. Set as one quiet horizontal row under a hairline, in Act III. |
| Nine-discipline / three-ring system diagram | **REMOVE** | Duplicates the six-area ladder with different arithmetic (§A6). The rings belong on `/szolgaltatasok`. |
| Seven-checkpoint process ledger | **REMOVE from the homepage** | 28 label/value pairs (§A5). It is genuinely good content and it belongs on a process page, where a table is allowed to be a table. |
| Panel rules, borders, plates, `--plate` backdrops | **REDUCE** | One hairline survives, in Act III. Copy no longer needs a contrast floor once it stops being laid over a bright scene. |
| Yellow inside headlines and lists | **REMOVE** | Headline words, `Kiemelt eset`, checkpoint indices, eyebrow altitudes. Yellow is not an emphasis tool. |
| Yellow in the header (nav button + language pill) | **REDUCE** | Two yellow objects in the chrome mean no frame can ever have "one" yellow object. The header's own treatment is out of this phase's scope, but the count is a direction-level constraint. |
| Second CTA in the hero (`Munkáink`) | **REMOVE** | Two equal buttons is a choice, and a choice is not confidence. The work is in the nav. |
| Case cards / three-project grid | **ALREADY GONE — hold** | `content.ts` already features one case. Keep it that way. |
| Collaboration marks | **KEEP, once, muted** | One row, optically equalised, ~36% opacity, no boxes, no motion. |
| Rapidkert capture | **KEEP — promote** | It becomes the dominant element of an entire act. |
| `~15M Ft` | **KEEP — promote** | Becomes one of the two largest typographic objects on the page, and the act's single yellow event. |
| The Altimeter | **REDUCE to three appearances** | §G. |
| Scene-boundary effects, aperture flare, ring assembly | **REDUCE** | Not visible in a still, so out of Phase 1's scope — but the direction is: the ascent should be felt, not announced. |

### The count

Counted the same way in both directions — **one object = one thing the eye has
to attend to separately** (a nav row counts once; a checkpoint row counts once
even though it carries nine sub-elements; a hairline counts).

| Shipped frame | Objects | | Study | Objects |
| --- | --- | --- | --- | --- |
| 0 m | 19 | | Act I | 6 |
| 3 600 m | 11 | | Act II | 2 |
| 13 000 m | 18 | | Act III | 5 |
| 18 400 m | 12 | | Act IV | 7 |
| 24 400 m | 13 | | Act V | 3 |
| 27 300 m | 11 | | Act VI | 5 |
| 30 000 m | 19 | | | |
| **Total (7 frames)** | **103** | | **Total (6 frames)** | **28** |
| **Mean** | **14.7** | | **Mean** | **4.7** |

The shipped figures are counted off `shots/after/desktop-{00000,03600,13000,18400,24400,27300,30000}.jpg`.
Roughly four of every fourteen objects in a shipped frame are chrome that says
the altitude — header echo, eyebrow altitude, HUD readout, HUD rule, HUD phase
label, HUD glyph button.

---

## D · Typographic system

Four roles. Not ten. Both families are already licensed and self-hosted.

| Role | Family | Size | Weight | Tracking | Leading | Colour | Frequency |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **MONUMENT** | Archivo | 104–196px | **380** | −0.034 … −0.046em | 0.94–0.98 | `#F4F4F4` | once per act |
| **DISPLAY** | Archivo | 52–56px | 400 | −0.022em | 1.04 | `rgba(paper,.44)` | at most once per act |
| **BODY** | Archivo | 17–19px | 400 | ~0 | 1.62 | `rgba(paper,.52)` | at most once per act |
| **MICRO** | JetBrains Mono | 10.5–11px | 450 | 0.26em, upper | 1.9 | `rgba(paper,.28)` | 3 × in 6 frames |

Three rules carry most of the effect:

1. **Weight 380 at display size.** This is the single biggest change. The shipped
   headlines run 620–700 and read as loud; the same words at 380 read as
   composed. Archivo's variable `wght` axis already covers it, so this costs
   nothing.
2. **Leading 0.94–0.98, never below.** Hungarian stacks `Ő Ű Á Í` on the
   ascender and drops `g j y` below the baseline. At 0.90 the studies collided
   on the first pass — `Magasságot / építünk.` was the proof.
3. **Authored line breaks, never `balance`.** `Idelent / minden zajos.` is a
   two-line block that runs to the right edge; `Innen már / látni a /
   görbületet.` is a three-line stack that does not. Those two silhouettes are
   what stop the two acts reading as the same frame — and a browser choosing
   the breaks would have made them identical.

Deleted from the vocabulary: eyebrow, chapter label, altitude readout, phase
label, annotation, note, caption, term label, index number.

---

## E · Colour, and the yellow rule

Five values. All five already exist in the repository.

| Token | Value | Source | Role |
| --- | --- | --- | --- |
| PRIMARY DARK | `#04060A` | `styles.css --ink` | the ground field; `#01060F` at the ceiling |
| ATMOSPHERIC BLUE | `#0E2A58` | `Sky.tsx` 22 000 m top | the mid-journey field |
| PRIMARY TYPE | `#F4F4F4` | `styles.css --paper` | monuments only |
| SECONDARY TYPE | `#8A929B` | `styles.css --haze` | display and body, via `rgba(paper, .44–.52)` |
| STRATOS YELLOW | `#FFEE25` | `styles.css --signal` | the event |

Two things changed about *how* the blues are used, and both matter more than the
values:

* **The field is the top colour, not the horizon colour.** The shipped frames
  read as a bright blue gradient because the horizon value (`#4B7CAD` and up)
  occupies half the frame. In the studies the horizon band is confined to the
  bottom ~15% and the top value carries everything else.
* **One wash per frame, not four.** Each act has at most one radial and one
  linear. Layered atmosphere is what makes a background look worked-on rather
  than deep.

### The yellow rule

> **≤ 1 primary yellow focal element per major frame, and at least half of the
> major frames carry none.**

An art-direction principle, not a CSS assertion. As delivered:

| Act | Yellow objects | What |
| --- | --- | --- |
| I | 1 | the CTA fill |
| II | 0 | — |
| III | 0 | — |
| IV | 1 | `~15M Ft` |
| V | 0 | — |
| VI | 1 | the CTA fill |

Yellow never sets a word inside a sentence, never marks a list index, and never
appears twice in one frame.

---

## F · The six-act homepage map

Eleven chapters become six acts. The DOM does not have to be deleted — this is
an art-direction grouping — but two content moves are genuine proposals and are
flagged as such.

| Act | Altitude | Content it absorbs | Dominant element | Statement | Yellow |
| --- | --- | --- | --- | --- | --- |
| **I — Ground / Premise** | 0 – 3 000 m | `calibration`, `initial-ascent` | **the instrument** | `Magasságot építünk.` | 1 |
| **II — Noise / Ascent** | 3 000 – 11 000 m | `cloud-entry`, `cloud-breakthrough` | **typography** | `Idelent minden zajos.` | 0 |
| **III — System** | 11 000 – 17 000 m | `lower-atmosphere`, `system` | **the statement**, instrument at the edge | `Hat terület.` / `Egy rendszer.` | 0 |
| **IV — Proof / Work** | 17 000 – 24 000 m | `selected-work`, collaborations | **the Rapidkert frame** | `~15M Ft` | 1 |
| **V — High altitude** | 24 000 – 29 000 m | `stratosphere-transition`, `full-stratosphere` | **negative space** | `Innen már látni a görbületet.` | 0 |
| **VI — Arrival** | 30 000 m | `destination` | **the instrument returns** | `Készen állsz felemelkedni?` | 1 |

### The two real content moves

**F1 — The system act moves below the work act.** Currently work runs
11 000–17 000 m and system runs 17 000–22 000 m. The named six-act order puts
system first, and it is the better order anyway: proof lands harder after the
visitor knows what is being proved. This is a reordering of existing sections,
not new content — but it is a production change and it is the largest single
risk in this document (§I).

**F2 — `Hat terület, egy rendszer.` moves up from 3 600 m into the system act,
and the nine-discipline ring diagram is dropped.** This resolves §A6. The six
capability names survive as one quiet row; the nine disciplines and the process
ledger move to `/szolgaltatasok`.

### Act by act

**ACT I — GROUND.** A luxury campaign frame. Wordmark, one whisper, one
monument, one action, one micro altitude stamp. The instrument is *presented*:
face-on, keyed hard, cropped by the right edge, large enough to be the subject.
No annotation. No second button. `Nem weboldalakat építünk.` becomes the small
line so that `Magasságot építünk.` can be the large one — the antithesis is
stronger when the negation is quiet.

**ACT II — NOISE.** The hard contrast to Act I. The instrument is not in this
act at all. Two lines at 196px run to the right edge; the one support line is
thrown to the opposite corner so the open field between them is a diagonal the
eye crosses rather than a region nobody solved. Densest atmosphere on the page,
zero interface.

**ACT III — SYSTEM.** Precision made visible without a dashboard. `Hat terület.`
monumental, `Egy rendszer.` at display weight beneath it, and the six areas as a
single mono row under one hairline at the foot of the frame. The instrument
returns *consulted*: a three-quarter view, two thirds cropped by the right edge,
holding the composition rather than occupying it.

**ACT IV — PROOF.** The act that deliberately breaks the atmospheric language.
The collaboration marks open it as a quiet credibility band — optically
equalised, ~36% opacity, no boxes. Then the Rapidkert capture takes the right
half of the frame full-bleed to the bottom edge, masked into the field rather
than pasted onto it, and `~15M Ft` sits opposite it as the largest yellow object
on the page, with its caption in micro beneath: `Szerződött projektérték
keresésből`. No card, no border, no metric grid.

**ACT V — HIGH ALTITUDE.** The signature still. Near-black field, the earth's
limb as the only reference, `Innen már / látni a / görbületet.` at 152px in
three authored lines that the curve passes through. One micro mark, bottom
right. Nothing else. This should be the frame that ends up in the awards
submission.

**ACT VI — ARRIVAL.** Austere and centred. The finished instrument returns
symmetrically, rim-lit against the ceiling sky, under a colossal question. One
short line, one yellow action, and roughly 60% of the frame is sky.

`Üdv a sztratoszférában.` is not merged into this frame. It is the closing beat
of Act V — same field, same type, zero yellow — so that arrival and conversion
stay two emotional beats and not one busy composition.

---

## G · Altimeter appearance plan

Three appearances. Eleven now.

| Act | Role | Treatment | Projected size |
| --- | --- | --- | --- |
| I | **Presented** | face-on, 5° tilt, key 5.4 / ambient 0.50, cropped right | ~800px — the subject |
| II | **Absent** | — | — |
| III | **Consulted** | three-quarter, −24° yaw, cooler and darker (key 4.4 / ambient 0.34), ⅔ cropped by the right edge | ~780px, ~40% visible |
| IV | **Absent** | — | — |
| V | **Absent** | — | — |
| VI | **Returned** | face-on, symmetrical, rim 3.4 so the silhouette separates from a black sky | ~430px — second to the question |

Three rules make this a dramaturgy rather than a hiding:

1. **Three consecutive acts contain no instrument at all.** That absence is what
   makes the return in Act VI an event. It is also the thing the current page
   cannot do, because the dial never leaves.
2. **No two appearances are the same object.** Different pose, different lighting
   ratio, different relationship to the frame: presented, cropped, returned. A
   viewer should not be able to describe them as "the dial, three sizes".
3. **Where the instrument is absent, no trace stands in for it.** No ghost dial,
   no altitude ring, no rail. The altitude survives as at most one micro mark.

The existing `SCENE_RECEDE` machinery expresses all of this already — this is a
different assignment of the same six roles across six acts instead of eleven
chapters, plus `absent` becoming a permitted value, which `scene.ts` currently
forbids in as many words. That comment is now out of date and would need
changing with the direction.

---

## H · Whitespace analysis

Estimated occupied area — the union of the bounding boxes of everything that
carries ink, excluding the background field.

| Act | Occupied | Empty | Is the emptiness solved? |
| --- | --- | --- | --- |
| I | ~38% | ~62% | Yes. The empty band is between the monument and the action, opposite an 800px instrument. |
| II | ~36% | ~64% | Yes. The empty region is the diagonal between the two-line block (upper left) and the support line (lower right). |
| III | ~44% | ~56% | Yes. The centre is deliberately open; the statement holds the top left, the ladder the bottom edge, the instrument the right. |
| IV | ~62% | ~38% | Yes — and this is the one frame that should be dense. It is the evidence act, and a sequence of six needs one. |
| V | ~26% | ~74% | Yes. The emptiest frame on the page and the strongest. |
| VI | ~40% | ~60% | Yes. Centred, symmetrical, the sky doing the work. |

The check that was actually applied, per empty region: *is there a strong
element on the opposite side of it?* Where the answer was no, the composition
changed. Act II's support line moved from bottom-left to bottom-right for
exactly this reason — with both objects on the left, the right 55% of the frame
was dead, not quiet.

---

## I · Mobile translation notes

Mobile is not designed in this phase. Every act below is checked against the
three constraints that matter: **no sticky complexity, no new WebGL work, no
broken hierarchy.**

| Act | Translates? | Notes |
| --- | --- | --- |
| I | **Yes** | Monument reflows to 3–4 lines; the instrument becomes a top-of-viewport plate above the type instead of beside it. The existing mobile route already does this. `Magasságot` is 11 characters and fits 342px at the mobile monument size. |
| II | **Yes** | Pure type. The diagonal is a desktop composition; on mobile it collapses to statement-then-line, which is correct — the support line simply follows the block. |
| III | **Yes, with one change** | The six-area row must become a two-column list or a stack. It must **not** become a horizontal scroller — that is the "sticky complexity" the constraint rules out. The instrument's edge crop does not survive a 390px viewport; it drops out and the act carries no instrument on mobile. Acceptable: the mobile ascent then has two appearances instead of three. |
| IV | **Yes** | The strongest mobile act. `~15M Ft` at monument scale, caption beneath, capture full-bleed below it. The marks row becomes two rows of three. |
| V | **Yes** | The curvature is a CSS ellipse, not geometry — it costs nothing on a phone. `görbületet.` is 11 characters and fits. |
| VI | **Yes** | Centred stack already. The instrument shrinks; the CTA becomes full-width with the same generous margin above it. |

Two things this direction *removes* are mobile wins outright: the process ledger
(which currently overruns its scroll budget by ~1 229px at 390px, per
`journey.ts`'s own comment) and the nine-node ring diagram.

The one thing to watch: **weight 380 at 44–56px on a 390px screen.** Light
display weights thin out on low-DPI Android panels. The mobile monument should
be authored at 420–450, not 380, and that is a mobile-specific token rather than
a scale of the desktop one — the same reason `scene.ts` already carries a
separate `mobileScale`.

---

## J · Risks and trade-offs

**J1 — Reordering system before work (F1) is a real production change.**
It moves two stages in `journey.ts`, which moves altitude bounds, scroll shares,
`SCENE` entries, `SCENE_RECEDE` assignments and every test that asserts stage
order. It is the single largest cost in this document. *Mitigation:* the acts
can be adopted without the reorder — Act III and Act IV simply swap in the map
— at the cost of the named order. Worth deciding explicitly before any
implementation starts.

**J2 — Removing the process ledger removes real selling content.** Seven
checkpoints with four terms each is genuinely persuasive to a buyer who is far
enough down the funnel to read it. It is being removed from the *homepage*, not
deleted. If `/szolgaltatasok` does not receive it, this is a net loss.

**J3 — Three altimeter appearances is a large reduction of the thing the site is
known for.** If the instrument is the brand asset, three appearances may read as
under-using it. The counter-argument is the whole of §A2, and the studies are
the evidence: judge it on the review sheet, not on the count.

**J4 — Weight 380 will look thin on some displays.** It is the change most
likely to be reversed after a look on a real monitor. 400–420 is the fallback
and it costs little of the effect; 500+ costs all of it.

**J5 — 26% occupied (Act V) will read as unfinished to some reviewers.** It is
supposed to. This is the frame most likely to be argued about, and the one least
worth compromising.

**J6 — The header is out of scope and currently carries two yellow objects.**
Until the nav button and the language pill are addressed, no frame on this site
can actually contain exactly one yellow element. §E's rule is stated for the
page body; the chrome needs its own decision.

**J7 — These are stills.** They say nothing about how the acts join. Six frames
that each work perfectly can still produce a sequence that does not, and the
transitions are where the "expensive" feeling is either confirmed or lost. That
is Phase 2, and it should not be started until these six are accepted.

---

## Stop point

Direction report, six static keyframes and the comparison sheet are complete and
are for human visual review. No production file was modified. Implementation
does not start until this direction is accepted.

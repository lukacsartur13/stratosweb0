# 09 · SYSTEM CHAPTER COMPRESSION

*Phase 5.1 · human review after the temporal pass. The timing was not the
problem any more; the middle needed to need less time.*

Phase 5's eleven durations are untouched. `PASSAGE_HOLD`, `GROUND_HOLD`, the
passage-specific ramps, the instrument's withdrawal, the portrait chase
correction and `RETAIN.place` are all exactly what that phase left them, and
§21's master:passage ratio is unchanged to two decimal places. What changed is
**content architecture**: the system chapter argued the nine disciplines twice
and the second argument was three screens long.

Five things were done.

1. The system chapter's twenty-eight units were inventoried and classified
   before anything was edited (§3). Four of them were found to be restating a
   line Act III already says on the same page (§4).
2. Nine sentences moved to the services route and the chapter's three staged
   explanatory states became **one composed state** (§5, §6, §7, §9). The
   chapter is **3.49 → 2.34 screens**, measured; the page is **24.96 → 23.80**.
3. `.air__restraint`'s clearing ramp was corrected, because the measurement
   found the haze clearing at almost exactly the rate the sky darkens — the two
   cancelled, and that is why the middle read as one flat near-black field
   (§14).
4. The ambiguous process clause was replaced (§11).
5. One defect this phase introduced was caught by its own instrument and fixed
   before the recordings: the new line of discipline names could not break, and
   overflowed its column by 67–82 px on every portrait shape (§F).

The opening and the finale are arithmetically untouched, and that is measured
rather than asserted (§19, §20).

---

## A · WHAT WAS IN THE SYSTEM CHAPTER, AND WHAT EACH UNIT WAS FOR

§3 asks for the inventory before the edit, so it is a snapshot rather than a
recollection: `compression/inventory-source.json` holds the twenty-eight units
in all three locales, taken off the shipped page before a character was
changed, and `scripts/system-inventory.mjs` checks each one against its
declared destination afterwards. The generated table is
`compression/content-audit.md`. Summary:

| what | count | classification |
|---|---|---|
| the statement, in its two authored halves | 2 | **kept** — the layer relationship is the one thing only this chapter says |
| the support line | 1 | **kept** |
| `system.lead.a` | 1 | **retired before this phase** — a caption on the ring diagram the continuity pass removed; still not rendered, still in `messages.ts` with its note |
| three layer names | 3 | **kept** |
| three layer notes | 3 | **kept** — they are the dependency argument |
| nine discipline names | 9 | **kept** — `Kilenc` has to stay a true sentence about the page |
| nine discipline sentences | 9 | **moved** to `06 · Amit be tudunk vállalni` on the services route, verbatim, in all three locales |

Eighteen kept, one already retired, nine moved. Nothing dropped.

### §4 · The semantic duplication, named

This is the finding the phase turns on. Act III — `Hat terület, egy rendszer.`,
a **master act, in the locked opening** — already sets its six disciplines as
`name / sentence` in the passage body's own structural idiom, eight screens
earlier. Four of the system chapter's nine sentences say the same thing again:

| discipline | the system chapter said | Act III already says |
|---|---|---|
| Hirdetés | `Fizetett forgalom oda, ahol már van mit fogadnia.` | `Forgalmat oda küldünk, ahol már van mit fogadnia.` |
| Automatizálás | `Ami ismétlődik, azt nem embernek kell csinálnia.` | `Ami ismétlődik, az fusson magától.` |
| Fejlesztés | `Egyedi funkciók, integrációk, sebesség. Nem sablon, nem plugin-halmaz.` | `Egyedi kód, mérhető sebesség. Nem sablon, amit hetente frissíteni kell.` |
| Stratégia | `Mit mondunk, kinek, és milyen sorrendben. Ez dönti el a többit.` | `Előbb eldöntjük, mit érdemes megépíteni. A többi ebből következik.` — and `Ez dönti el a többit.` is *also*, word for word, the opening of the core layer's own note four lines below it |

Two of the remaining five overlap by synonym rather than by sentence — `Arculat`
against Act III's `Dizájn`, and `Optimalizálás` against its `Konverzió`.

The page also states two different counts of the same thing: **six** areas at
3 000 m and **nine** at 17 000 m. That is not resolved here — `system.title` is
approved display copy and §19 locks the act that carries the other number — and
it is recorded in §P as the one content question this phase leaves open.

### §27 · Where the nine sentences are now

`06 · Amit be tudunk vállalni` on the services route, under their own three
layer headings, as a `dl.caps` term/gloss list — the idiom §03 of the same page
already uses. Hungarian, English and German, verbatim: every translation is the
one that already existed for it in `experiments/src/full/locales/{en,de}.ts`,
moved into `_build/i18n/szolgaltatasok.json`. Nothing was retranslated.

`scripts/system-inventory.mjs` fails if any of the nine is not at that
destination, and — this is the half that matters — it *also* fails if a sentence
classified as moved is still in the homepage source. It is comment-aware, so a
note quoting a sentence in order to explain that it moved does not read as the
sentence still shipping.

---

## B · THE RECOMPOSITION

### The three staged layers are one composed state

Before: `.passage__body` held three `.passage__item`s at 58 svh, each a layer
name, a layer note and two to four `name — sentence` lines. Measured with
`compression/geom.mjs` at 1440 × 900: a 1.36-screen held frame, a 1.96-screen
body (three beats of 0.58 plus a 0.22 foot), and the panel's own tail —
**3.50 screens** of panel, **3.49** of measured chapter extent.

After: one `.passage__item`, holding all three layers, each a name, its note,
and its disciplines as **one middot-separated line**. The same 1.36-screen
frame, a 0.80-screen body, the same tail: **2.34 screens** — which is, to the
number, the panel geometry of the process passage below it and the cloud-entry
passage above it. A frame, then one composed structural beat, three times on the
page.

Two composed states where there were four (§6): the statement frame, and the
structure. Nine objects in the beat, against §12's warning line of twelve.

### Why one frame rather than two (§6, §7)

§6 asked for the three to be tested against two composed states. Two 58 svh
beats measures 2.92 screens, which is outside the target band, and — more to the
point — two states is still a sequence. Three layers *in one frame*, each with
its own line of names, widening 2 → 3 → 4 down the column, is the layering
itself: simultaneity is what makes a relationship visible and staging is what
hides one. That is §7's "one frame can carry more than one relationship", and it
carries three of them — which disciplines exist, which layer each is on, and
that each layer depends on the one above it.

### And the staging was not buying what it claimed

58 svh on a 900 px viewport is 522 px, so two items fit in one frame. The phase
5 filmstrip shows `Mag` and `Szerkezet` together at 13.9 screens, one against
each edge, with the dead middle between them that `styles.css`'s own note says a
box rather than a margin was chosen to avoid. The visitor was not meeting one
layer at a time; they were meeting one and a half, twice.

### §10 · No cards, and no new idiom

The names are set as one running line per layer, separated by middots. That is
`.act__index` — the colophon Act III already uses for exactly this job, with
exactly this argument recorded against it: *"one running line reads as evidence
that a system exists, cannot compete with a 162 px statement, and takes one
line."* `.passage__layer` joins `.passage__principle` on the declaration that
already existed rather than getting one of its own. No card, no tile, no icon,
no numeral, no orbiting label, no diagram, no new type role and no new colour.

---

## C · §11 · THE PROCESS CLAUSE

Not approved, and replaced.

| | |
|---|---|
| was | `Minden szakasznak két oldala van, és menet közben látod, nem a végén.` |
| is | `Minden szakaszt két oldalról vizsgálunk, és menet közben látod, nem a végén.` |

None of §K's three alternatives communicates that a stage is *examined from two
sides* — all three answer the heading by naming the client's role instead — so
this is §11's rewrite branch, in §11's own preferred direction.

`Minden szakaszt két oldalról vizsgálunk` cannot take the idiom that made the
old sentence ambiguous: *"valaminek két oldala van"* needs `van` and a
possessor, and this is a transitive verb with an adverbial. The literal reading
is the only reading.

- EN `We look at every stage from two sides, and you see it as it goes, not at the end.`
- DE `Wir betrachten jede Phase von zwei Seiten, und Sie sehen es währenddessen, nicht erst am Ende.`

**Cost, measured** in the element itself at 1440 × 900, 390 × 844 and
360 × 800 (`compression/clause.mjs`): one extra line on the **German desktop**,
1 → 2. Hungarian and English are unchanged at 1 line desktop and 2 portrait;
German portrait is unchanged at 3. Every §K alternative carries the same German
cost; it is German's length, not this phrasing.

**What it still does not do, recorded rather than hidden.** The heading above it
is `Amit tőled kérünk.` — *what we ask of you* — and a sentence about how *we*
examine a stage answers that only by implicature. The variant that says it
outright — `…két oldalról nézünk — a miénkről és a tiédről —…` — costs a line on
every surface and every locale, so it is not shipped. It is measured as
candidate **B** in `clause.mjs`, for human selection.

---

## D · §14 · WHY THE MIDDLE WAS ONE FLAT FIELD, AND WHAT WAS DONE ABOUT IT

Phase 5's §J answered *does the sky step?* off a moving recording and the answer
was a clean no. §14 asks the opposite question — does it **evolve enough to be
seen** between two frames a visitor stops on — and that one needed a different
instrument: `compression/field.mjs` takes settled shots across the track and
`field.py` reduces each to three band medians plus the middle band's blue
contribution `B − R`.

### The finding

Across the whole system chapter — 17 000 to 22 000 m, the deepest blue the
palette reaches — the painted middle band moved by **three units of 255**, and
`B − R` sat at 27–28 for **four consecutive screens**. The zenith band was
`5, 8, 15` for the entire chapter, to within one unit.

### The cause, which is not the palette

`Sky.tsx`'s top colour falls from `0x173c72` to `0x0e2a58` across that band —
a real change. `.air__restraint`'s wash was clearing over it at the same time,
from opacity 0.82 to 0.69, so transmission rose from 0.18 to 0.31. **The two
are anti-correlated and their product is flat.** The stylesheet's own note says
*"easing back through the middle, where the air clearing IS the progression"*;
the arithmetic says it was not.

### The correction

Nothing about the palette changed — §14 forbids it and `Sky.tsx`'s `BANDS` are
untouched. What changed is *when* the 0.28 of clearing is spent: the third
term's ramp is **13 800 → 17 000 m** where it was 13 800 → 24 600. Transmission
is then constant from 17 000 to 24 600 m, so what the middle paints is the sky's
own arc at full strength — a crest at the top of the Proof act, then a
continuous ten-thousand-metre descent into the near-black the arrival needs.

Mid band at each chapter's own centre, in three builds — because the middle
column is the one that shows compression alone was not enough:

| chapter | phase 5 | compressed, old haze | **shipped** |
|---|---|---|---|
| selected-work | `10, 18, 31` · B−R 21 | `8, 17, 31` · 23 | `8, 17, 31` · 23 |
| **system** | `8, 17, 36` · **28** | `8, 17, 35` · **27** | **`9, 22, 45` · 36** |
| process | `5, 14, 31` · 26 | `5, 14, 31` · 26 | `5, 14, 32` · 27 |
| stratosphere-transition | `3, 9, 22` · 19 | `3, 9, 22` · 19 | `3, 9, 22` · 19 |

Read the system row across: compressing the chapter moved its field by **−1** of
B−R. The chapter was shorter, faster and better composed, and the picture behind
it was the same picture. That is the measurement that made §14 a separate piece
of work rather than a side effect.

Chapter to chapter, the blue contribution now goes

| | selected-work → system | system → process | → transition | → full-strat. | → destination |
|---|---|---|---|---|---|
| phase 5 | +7 | −2 | −7 | −6 | −4 |
| compressed, old haze | +4 | −1 | −7 | −6 | −4 |
| **shipped** | **+13** | **−9** | **−8** | −6 | −4 |

— a plateau at the top of the arc becomes a crest and a descent.

### The opening and the finale are untouched, and it is a measurement

The term is clamped to 0 below 13 800 m and to 1 above 17 000 m; the old ramp
was clamped to 0 below 13 800 m and to 1 above 24 600 m. The two expressions
therefore agree exactly outside 13 800–24 600 m. A pixel diff of sixty-one
settled frames confirms it: mean absolute difference **0.00–0.15 of 255**
everywhere below 14 100 m and above 24 400 m — which is the residue of the
instrument and the terrain rendering, not of this rule, and is the same figure
two runs of an unchanged build produce — rising to 6.6 only across
14 100–24 400 m.

### What could NOT be done, and why it is worth recording

The wash is a single scalar over a fixed palette, and it must be 0.90 at
13 800 m and 0.62 by 24 600 m. That budget has to be spent somewhere inside
that span, so the placement is zero-sum: any ramp that overlaps the system
chapter flattens it, and any ramp that brackets it moves the crest to one edge.
Three placements were built and measured — the shipped one, one confined to
17 000–22 000 m (`field-p51-hazeV3`), and the null case (`field-p51-mid`, the
compression with the old ramp). A monotone *descent* through the middle is not
reachable without either making the whole middle darker than it already is, or
moving the wash's floor, which is the finale's own value.

**Terrain, instrument and curvature were not touched, and that is deliberate.**
The scene between 12 400 m and 24 000 m contains exactly one object — the sky
dome. `MountainRange` unmounts at 12 400 m; `StarField` and `EarthLimb` both
ramp from 24 000 m; the instrument is out of the picture from 1.8 to 19.8
screens by phase 5's own decision. Bringing any of them forward would change
what 24 000–30 000 m looks like, which is the locked finale, and §15 rules out
novelty for its own sake. So the field is the only dimension this phase moved,
and §14's other five are recorded as available rather than spent.

---

## E · WHAT THE COMPRESSION ITSELF BUYS THE FIELD

The chapter's altitude band is unchanged at 17 000–22 000 m and the chapter is
1.16 screens shorter, so the climb rate through it rises from **1 430 to
2 140 metres per screen** — from the slowest stretch in the middle to within
comparison of the Proof act's own 2 360. Everything that is a function of altitude — the
sky, the wash, the horizon's drop — now moves half again as fast per screen of
scroll through the chapter that was flattest.

---

## F · THE DEFECT THIS PHASE INTRODUCED, AND HOW IT WAS CAUGHT

The layer's line of names is the only new object phase 5.1 puts on the page, so
it got its own instrument: `compression/areas.mjs` measures it in eight
viewport and locale shapes and exits non-zero if any of them overflows.

It did. `.act__index` writes the separator `<i>·</i>` and spaces it with
padding, which is correct there because that line is `white-space: nowrap` in a
frame wide enough for it. Copied into a 680 u column that has to wrap, padding
is **not a break opportunity** — so the operation layer's four names were a
single unbreakable word, overflowing its column by **67 px on a 390 and 82 px on
the German 360**, and clipped rather than scrolled because `body` carries
`overflow-x: clip`. The first portrait recording — taken before the fix, and
kept out of the review set — shows `Automatizálá` cut mid-word.

The fix is a real space either side of the middot and the padding reduced to
match, so the pair comes to the same 1.24 em the colophon sets. After: no line
overflows in any of the eight shapes, the operation layer wraps to two lines on
portrait and stays on one on every desktop locale. Every recording and every
sheet in `compression/` is from the build that carries the fix.

---

## G · MEASUREMENTS

### §22 · The temporal measurement, re-run

Desktop 1440 × 900, Hungarian, 601 samples across the track — phase 5's own
`temporal/scan.mjs` and `temporal/analyse.py`, unchanged. The before column is a
fresh run of that rig on the shipped phase 5 page and reproduces
`temporal/scan-desktop-after.json` to 0.01 screens, which is what makes it a
valid baseline rather than a quotation.

| | phase 5 | phase 5.1 |
|---|---|---|
| **total screens** | 24.96 | **23.80** |
| **system chapter** | **3.49** | **2.34** |
| system as a share of the page | 14.0% | **9.8%** |
| master window range (composed ≥ 0.90) | 0.71 – 1.00 | 0.71 – 1.03 |
| passage window range | 0.33 – 0.37 | **0.36 – 0.36** |
| **master : passage**, mean of each tier | 0.774 : 0.360 = **2.15 : 1** | 0.774 : 0.360 = **2.15 : 1** |
| master share of the journey | 61.5% | 64.5% |
| longest silence | 0.71 screens | 0.71 screens |
| whole journey at 950 px/s | 23.6 s | 22.5 s |

**§21 is not worsened.** Every passage's composed window is 0.36 and every
departing act's is 0.71, exactly as phase 5 solved them. The ratio is identical
to two decimal places, because nothing about duration was touched: what was
removed is two beats of content, not time from a frame.

### Chapter extents, before → after

| chapter | level | phase 5 | phase 5.1 |
|---|---|---|---|
| calibration | master | 1.41 | 1.43 |
| initial-ascent | master | 2.20 | 2.18 |
| lower-atmosphere | master | 2.75 | 2.74 |
| cloud-entry | passage | 2.33 | 2.34 |
| cloud-breakthrough | passage | 1.50 | 1.51 |
| selected-work | master | 2.54 | 2.54 |
| **system** | passage | **3.49** | **2.34** |
| process | passage | 2.33 | 2.30 |
| stratosphere-transition | master | 2.37 | 2.42 |
| full-stratosphere | master | 2.99 | 2.97 |
| destination | master | 1.08 | 1.07 |

Every chapter but one is within ±0.05 screens of where phase 5 left it, which
is the sampling step. The three structural passages — cloud-entry, system,
process — are now 2.34, 2.34 and 2.30: one architecture, three times.

### Dead holds

Runs in which the frame, the type and the instrument are all static, ≥ 0.12
screens:

| phase 5 | phase 5.1 |
|---|---|
| 0.25 calibration · 0.33 initial-ascent · 0.58 lower-atmosphere · 0.17 cloud-entry · **0.12 cloud-breakthrough** · 0.58 selected-work · 0.12 system · 0.12 process · 0.62 stratosphere-transition · 0.33 full-stratosphere · 0.79 destination | 0.28 calibration · 0.36 initial-ascent · 0.56 lower-atmosphere · 0.16 cloud-entry · 0.60 selected-work · 0.16 system · 0.16 process · 0.63 stratosphere-transition · 0.32 full-stratosphere · 0.79 destination |
| 11 runs | 10 runs |

These are the composed frames standing still, which is what a frame is for; none
is a new one and none grew. The remaining long holds are the two phase 5
deliberately left — the designed silence before the Proof, and the destination.

### §17 · Small copy states in the middle

A "state" here is a beat the visitor has to stop and read at editorial size —
an act body or a passage body item — as distinct from a display statement,
which is read at a glance.

| chapter | phase 5 | phase 5.1 |
|---|---|---|
| cloud-entry | 1 | 1 |
| cloud-breakthrough | 0 | 0 |
| selected-work | 1 | 1 |
| **system** | **3** | **1** |
| process | 1 | 1 |
| **the middle, total** | **6** | **4** |

The master-statement language is untouched: all eleven display statements are
the same words at the same size on the same axes.

### §18 · Low-ink clusters

Stretches under 0.4% of the viewport in legible type, ≥ 0.10 screens:

| | phase 5 | phase 5.1 |
|---|---|---|
| runs | 7 | **5** |
| **in the middle (system / process)** | **2** — 0.17 at 13.56 and 0.17 at 16.10 | **0** |
| longest | 0.71 (the designed silence before the Proof) | 0.71 (the same one) |

Both low-ink stretches inside the compressed chapters are gone, and no new one
appeared. The longest silence on the page is unchanged and is the one §8 of the
temporal brief argues for.

### Portrait, 390 × 844

| | phase 5 | phase 5.1 |
|---|---|---|
| total | 14.95 screens | 14.35 |
| **system** | **1.64** — the longest passage on the phone | **1.13** |
| process | 1.17 | 1.17 |
| low-ink stretches over 0.10 screens | none | none |

---

## H · §23 · THE RECORDINGS, AND WHAT WATCHING THEM SAYS

Five were recorded, all on the GPU path (ANGLE/Metal), all with the CDP
screencast running alongside the video so the frames can be placed on the
scroll track by a shared clock:

| tag | profile | rate | length | frames |
|---|---|---|---|---|
| `p51-desktop-normal` | natural (a reader's stops) | 950 px/s | 40.2 s | 1 248 |
| `p51-desktop-cont-slow` | continuous | 520 px/s | 41.2 s | 1 278 |
| `p51-desktop-cont-normal` | continuous | 950 px/s | 22.6 s | 719 |
| `p51-desktop-cont-fast` | continuous | 1 800 px/s | 11.9 s | 399 |
| `p51-mobile-normal` | natural | 950 px/s | 27.6 s | 702 |

**How the normal-rate recording was watched, stated plainly.** There is no
`ffmpeg` on this machine, so the `.webm` could not be decoded here. What was
examined instead is the screencast the same run produced — every second
composited frame of that real-time scroll, with its own timestamp — read in
order end to end, at 24 samples across the whole journey (`normal-24.png`) and
at 24 dense samples across the middle (`middle-dense.png`), plus the same middle
stretch at 520 and 1 800 px/s. That is the recording's own content rather than a
set of settled captures, and the distinction phase 5 drew — that a `scrollTo`
and a wait shows a state the moving visitor never sees — is respected: these
frames are the moving journey. The `.webm` is in `compression/film/` for a
person to watch as the review asset it is.

### §24 · The four questions

**DOES THE MIDDLE FEEL LONGER THAN ITS INFORMATION JUSTIFIES — NO.**
On the 24-frame whole-page
strip the system chapter now occupies **two** frames where it occupied **four**,
and the two it occupies are the statement and the structure rather than the
statement and three restatements of it. In the dense middle sequence it is four
of twenty-four samples: the statement, its departure, the structure, and the
structure leaving. Its share of the page is 9.8% against the Proof act's 10.7%
and the arrival's 12.5%, where it was 14.0% — larger than either.

**DOES THE SYSTEM FEEL LIKE ONE SYSTEM RATHER THAN A LIST OF SERVICES — YES.**
This is the change §26's sheet is for. The three layers arrive together, ranked,
widening 2 → 3 → 4, under one statement about order — which is a shape. Before,
the same nine disciplines arrived as three separate `name — sentence` tables
spread over two and a half screens, which is a list read three times.

**DOES THE PAGE CONTINUE TO ASCEND DURING THE SYSTEM CHAPTER — YES, and it is
the answer that needed the §14 work.** Compression alone did not deliver it:
`field-p51-mid` is the measurement of the compressed chapter with the old haze
curve, and its middle band still moves by three units across the chapter. With
the clearing corrected the field crests inside the chapter at `9, 22, 45` and
descends from there, and the metres-per-screen through the chapter is up 49% — 1 430 to 2 140, against
the Proof act's own 2 360.

**DOES THE ~15M MOMENT FEEL INTEGRATED RATHER THAN INSERTED — YES, and more so
than before.** It is unchanged — same act, same figure, same plate, same two
frames of the strip — but it is no longer the only visual event between the
cloud deck and the curvature. It now reads as the crest of a sequence: the
quiet, near-black cloud chapters below it, the yellow, then the field opening
into blue and descending through the system and the process to the curvature.
Before, the yellow was a single interruption in nine screens of the same
near-black field.

### §16 · If all copy were blurred, would the viewer feel progression?

**Before: no.** Frames 13 to 17 of the phase 5 strip are five consecutive
near-black fields carrying small type in the same column at the same weight.
Blurred, they are the same picture five times.

**After: yes.** The same stretch is: a yellow figure with an image plate and a
mark row · a body block on a field that has begun to open · a large statement on
a clearly blue field · one composed structural block · a second, smaller one on
a field that is now falling · a large statement with the Earth's limb arriving
under it. Ink, field and object count all change from frame to frame, and the
field's arc is monotone either side of its crest.

### The slow and fast rates

At 1 800 px/s the whole journey is 11.9 s and the middle still resolves: the
system statement is composed at 13.3 screens, the structure at 14.6, the process
statement at 15.3, the curvature at 17.9. Nothing in the compressed chapter
flashes — which is expected rather than lucky, because every composed window on
this page is a function of scroll and none of them changed. At 520 px/s nothing
stalls: the chapter that used to hold 3.5 screens for three restatements now
holds 2.3 for one, and the longest still run inside it is 0.16 screens.

---

## I · §25 AND §26 · THE REVIEW ASSETS

`compression/filmstrip-p5-vs-p51.png` — the whole homepage, 24 pairs at equal
journey progress, phase 5 above and phase 5.1 below in each cell.

`compression/system-p5-vs-p51.png` — **the primary human-review artefact.** The
system chapter only, 16 pairs at equal *chapter* progress, so column n is the
same fraction of a 3.50-screen chapter and of a 2.34-screen one.

Both are built from settled captures rather than from a recording, and that is a
deliberate departure from phase 5's contact sheet. Phase 5 was measuring
duration, where a settled capture is the wrong instrument. This phase is
comparing composition and field across two builds, and there the settled capture
is the right one: reproducible to the pixel, and the only sampling under which
two builds of different lengths can be put beside each other honestly. The
motion question is answered separately by the recordings above.

**The before half is a reconstruction, and it is verified rather than trusted.**
`git` cannot supply it — the working tree carried unrelated uncommitted work
before this phase started, so `HEAD` is not phase 5. `compression/before.py`
inverts this phase's three desktop-affecting edits, and
`before.py check` compares a fresh field measurement of the reconstruction
against `field-p51-before-bands.json`, which was taken on the real page before
any edit. Worst band difference: **1 of 255**. Nothing recorded from a
reconstruction that failed that check would have been kept.

---

## J · §29 · PERFORMANCE

| artefact | phase 5 | phase 5.1 | Δ |
|---|---|---|---|
| `assets/home/main.js` | 276.85 kB / 90.90 gz | 273.74 / 89.90 | **−3.11 kB / −1.00 gz** |
| `assets/home/main.css` | 75.72 kB / 15.27 gz | 76.06 / 15.32 | +0.34 kB / +0.05 gz |
| `index.html` hu / en / de | 20.38 / 19.25 / 19.62 kB | identical | 0 |
| `Gltf.js`, `JourneyScene.js`, `ScrollTrigger.js`, `index.js`, `MobileInstrument.js` | | byte-identical | 0 |
| **homepage route, net** | | | **−2.77 kB raw, −0.95 kB gzip** |

The homepage route costs less. Twenty-seven strings left the bundle — the nine
sentences in three locales — and the CSS grew by two short declarations.

The services route grows by the block that received them: **+3.0 kB raw,
+1.26 kB gzip** in Hungarian and within 0.1 kB of that in English and German. No
new request, no new asset, no new script, no new font.

**Work added to a frame: none.** No new element type on the scroll path, no new
observer, no new subscription, no new measurement pass. The system panel's DOM
is a different shape but the same order of size, and the track is 1 044 px
shorter, which is 1 044 px less scroll for the compositor to travel.

---

## K · TESTS

`npm run build:full && npm run build:home && playwright test --config
playwright.full.config.ts` — **196 passed, 36 skipped, 0 failed**, 16.5 minutes,
across the desktop project, five phone shapes and `reduced-motion`.

Nothing in the suite needed changing, and that is worth a line rather than being
taken for granted: the contracts the six-act suite holds over this chapter are
structural — every chapter resolves to master or passage, a crossing never sets
larger than the act it runs under, no two display statements are legible at
once, no passage shows the instrument or paints the signal colour, every passage
is composed and legible with no clock, and no stretch of the journey is empty
for more than a screen. All six are properties of the design rather than of the
old markup, so a chapter that keeps its statement, its tier and its content
passes them by construction. The one that could have broken —
*no stretch is empty for more than a screen* — is at 0.71 screens, unchanged,
and it is a stretch this phase did not touch.

`npm run typecheck` is clean. `node scripts/system-inventory.mjs` reports all
twenty-eight units accounted for. `node compression/areas.mjs` reports no
overflow in eight shapes.

### The main site suite, and five failures that are not this phase's

`playwright test` (the public-site config, eight projects, 21 spec files) —
**1 168 passed, 124 skipped, 5 failed**. The five are all the same shape, all in
one project:

    [reduced-motion] tests/homepage-chrome.spec.ts
      473  the header stays out of the way at the foot…
      492  the states are reversible and the top of the page is always the opening state
      516  a single jump lands on the right state, not one short of it
      691  the full-screen menu on the homepage · opens from every header state
      888  return to 0 m · is a real control with an accessible name, and it returns the page

All five fail the same way: `header never reached "journey" … Received:
"destination"`. The homepage's header adapter publishes its destination edge at
progress 1.01 — deliberately beyond the end of the track, so the state cannot be
reached — and under `reduced-motion` the journey does not mount its clock, so
nothing publishes those edges and the shared header falls back to its own
three-state defaults.

**They are not this phase's, and that is a measurement rather than a claim.**
The same five, on the same rig, against the reconstructed phase 5 build:

| build | homepage-chrome, reduced-motion |
|---|---|
| phase 5 (reconstructed by `before.py revert`) | **5 failed**, 26 passed, 12 skipped |
| phase 5.1 | **5 failed**, 26 passed, 12 skipped |

Identical. A shorter track was the obvious suspect — every one of these tests
scrolls by a fraction of the document — so it was tested rather than reasoned
about. This is a pre-existing defect in the reduced-motion path's header
adapter, it is out of this phase's scope, and it is recorded here so the next
phase does not have to rediscover it.

---

## L · WHAT WAS DELIBERATELY NOT DONE

- **The opening.** Not one character, not one number. Act III's `Hat terület,
  egy rendszer.`, its lead and its capability ladder are exactly as phase 5 left
  them, and the four duplicated sentences were resolved by moving the *later*
  copy rather than the earlier — because the earlier one is in the locked act
  and is the one human review called strong (§9, §19).
- **The finale.** `Innen már látni a görbületet.`, `Üdv a sztratoszférában.`,
  the instrument's return, the arrival table and the CTA architecture are
  untouched, and the haze correction is clamped so that the field above
  24 600 m is arithmetically identical (§20).
- **The ~15M Ft moment.** Unchanged in every respect (§12).
- **Any duration.** No hold, ramp, share or easing was altered (§0, §21, §32).
- **The palette.** `Sky.tsx`'s `BANDS` are byte-identical (§14, §28).
- **New anything.** No route, no 3D object, no library, no interaction, no type
  role, no colour (§28). `.passage__layer` joins an existing declaration;
  `.passage__areas` is `.act__index`'s idiom in flow.

---

## M · REMAINING LIMITATIONS, AND THE ONE OPEN CONTENT QUESTION

**Six areas at 3 000 m, nine at 17 000 m.** The page states two counts of what
is arguably the same set, and this phase did not resolve it: `system.title` is
approved display copy, and the act carrying the other number is inside the
locked opening. It is now more visible than it was, because the two lists are
no longer separated by three screens of restatement. Resolving it means either
re-authoring one statement or accepting that the six are the *services* and the
nine are the *disciplines behind them* — which is what the services route now
says in as many words. **This is a copy decision and it is left for human
review.**

**The chapter still opens on a silence.** Between the statement's departure and
the structural beat's arrival there is roughly 0.6 of a screen with little in
frame — visible as pairs 05 to 07 on the system sheet. It is the passage
architecture's own geometry rather than anything this phase introduced (the
same gap is in the phase 5 column, at the same place), and it is below the
low-ink threshold because the statement is still fading through it. Closing it
would mean changing the ramp, which is phase 5's work.

**Five of §14's six dimensions are unspent.** Depth, terrain, instrument and
curvature were all available and all rejected for the reasons in §D: the scene
between 12 400 and 24 000 m holds one object, and every way of putting a second
one there either changes the locked finale or adds an event for its own sake.
If a later phase wants more from the middle than a field arc, that is where the
room is — and it is a scene decision, not a timing or a copy one.

**The `.webm` files were not decoded on this machine.** See §H for exactly what
was watched instead and why it is the recording's own content.

---

## §30 · FINAL GATE

| | |
|---|---|
| TEMPORAL ART DIRECTION STILL PASSES | **YES** — every phase 5 duration is unchanged; the master:passage ratio is 2.15 : 1 before and after; no composed window moved |
| SYSTEM CHAPTER NO LONGER DOMINATES PAGE LENGTH | **YES** — 3.49 → 2.34 screens, 14.0% → 9.8%; it is now the same length as the other two structural passages and shorter than every master act but the destination |
| MIDDLE VISUAL PROGRESSION IS CLEAR | **YES** — the field's blue contribution goes from a four-screen plateau to a crest of +13 and a descent of −9 / −8 / −6 / −4; both low-ink stretches in the middle are gone; the climb rate through the chapter is up 49% |
| NO DECK-LIKE TEXT SEQUENCE REMAINS | **YES** — three informational states became one; the three structural passages each hold exactly one beat |
| PROCESS COPY IS UNAMBIGUOUS IN HUNGARIAN | **YES** — the idiom that produced the pros-and-cons reading cannot attach to the new construction. One caveat recorded in §C: the sentence answers its heading by implicature |
| OPENING REMAINS INTACT | **YES**, on both counts that could have broken it. No file the opening renders from was edited, and its four chapters measure 1.43 / 2.18 / 2.74 / 2.34 screens against phase 5's 1.41 / 2.20 / 2.75 / 2.33 — inside the 0.04-screen sampling step. The haze correction is arithmetically zero below 13 800 m, and a pixel diff of the settled frames puts the residual at 0.00–0.15 of 255 below 14 100 m, which is what two runs of an unchanged build produce |
| FINALE REMAINS INTACT | **YES** — same two counts. `stratosphere-transition`, `full-stratosphere` and `destination` measure 2.42 / 2.97 / 1.07 against 2.37 / 2.99 / 1.08, and the haze term is at its floor above 24 600 m in both builds, with the pixel residual 0.00–0.15 above 24 400 m |

## §31 · STATUS

**Not final. The next decision is visual human review.**

The assets for it, in the order they answer the brief:

1. `compression/system-p5-vs-p51.png` — §26, the primary artefact
2. `compression/filmstrip-p5-vs-p51.png` — §25
3. `compression/film/p51-desktop-normal.webm` — §23, the normal-rate recording
   (`-cont-slow`, `-cont-normal`, `-cont-fast` and `-mobile-normal` beside it)
4. `compression/middle-dense.png`, `middle-slow.png`, `middle-fast.png` — §16
5. `compression/analyse-after.txt`, `field-after.txt`, `content-audit.md` — §22, §27

Two things need a person rather than a measurement: the six/nine count in §M,
and whether the process clause should say whose the two sides are at the cost of
one line in every locale (§C, candidate B).

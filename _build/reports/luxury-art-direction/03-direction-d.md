# Direction D — controlled Swiss editorial

**Phase 1.6. Study only. Nothing in this pass touches production.**

`experiments/src/full/styles.css`, `scene.ts`, `composition.ts`, `journey.ts`,
the scroll mechanics, the Altimeter choreography, the production fonts, the
homepage content structure and the mobile route are all unchanged. Nothing was
pushed, merged or deployed. No serif was provisioned and no font was
downloaded. The working tree carries this document, thirteen frames, five
sheets and the scripts that produced them.

| | |
| --- | --- |
| `03-direction-d.md` | this document, §A–§L |
| `direction-d/d1…d3-{hu,en,de}.png` | **the nine frames**, 1440 × 900, three scenes × three locales |
| `direction-d/direction-d-main.png` | D1 · D2 · D3 in Hungarian, full size |
| `direction-d/direction-d-vs-ac.png` | **A · C · D, nine frames — the sheet that decides the phase** |
| `direction-d/direction-d-locales.png` | the same three scenes in HU / EN / DE |
| `direction-d/direction-d-distance.png` | the thumbnail test, §32 |
| `direction-d/direction-d-breaks.png` | four rejected line breaks, photographed beside the chosen ones |
| `direction-d/x1…x4.png` | those rejected settings as full frames |
| `direction-d.html` · `direction-d.css` | the source. No production CSS is loaded |
| `direction-d-scale.css` | **generated.** Every solved size, leading and position |
| `solve-d.mjs` · `direction-d/scale.json` | the solve, and every measurement behind it |
| `shoot-d.mjs` · `direction-d/measurements.json` | the audit — it refuses to photograph a frame that fails |
| `whitespace.mjs` · `direction-d/whitespace.txt` | §26, measured against A and C |
| `fonts-ready.mjs` | the guard described in §J3 |

**Every word in all thirteen frames is verbatim** from
`experiments/src/full/locales/messages.ts` and `content.ts`, in all three
languages. No copy was written or re-translated for this study. What changes
is the setting, the composition and — in three places recorded in §I5 — where
a line breaks.

**There is no colour.** No yellow, no blue, no glow, no gradient grading, no
particles, no 3D, no animation, no rails, no coordinates, no borders, no
arrows. `--signal` does not exist in `direction-d.css`. The tonal step in the
high-altitude frames is grey and is inherited unchanged from the previous
study, so that D3 and C3 can be compared on typography alone.

---

## A · Design hypothesis

The first study ended with three honest fifth adjectives — A was **safe**, B
was **conditional**, C was **brittle** — and those three words, not the
compositions, were the actual result. Direction D exists because two of those
three faults have the same cause and can be removed together.

**A is safe because it never commits to scale.** Its monuments run 108–124px
in a 1440px frame. That is a headline, set well. It is not a statement, and no
amount of margin discipline turns one into the other.

**C is brittle because it commits to scale as a NUMBER.** `font-size: 168px`
is a promise about Hungarian that German cannot keep, and the study proved it:
C's high-altitude monument overflowed the measure by 112px in German and had
to give back 14px, which is exactly the kind of concession that starts a
system unravelling.

The hypothesis of Direction D is that these are not opposite ends of a
trade-off but the same mistake seen from two sides. **A and C both treat the
monument's size as a constant — A picks a small one and C picks a large one.**
If size stops being a constant and becomes the OUTPUT of a rule, C's courage
becomes available without C's brittleness, because the rule is what is
constant and the pixels are free to move.

So D declares, per scene, how much of the type field the statement should
occupy, and solves the size from the sentence in front of it. That single
change is what lets D set larger than C in Hungarian and still hold German at
its own geometry without a special case, a clamp or an apology.

The second hypothesis is smaller and turned out to matter as much. **The hero
comparison in the first study was not a fair test**, because the instrument
was projected at 700px and cropped by the right edge in all three directions
and therefore dominated all three heroes equally. D reduces it to a 221px
drawn circle held inside the right margin, and the hero becomes a typography
comparison for the first time.

---

## B · What was taken from Direction A

1. **The width axis stays at 100%.** This is the single most consequential
   inheritance. C bought its compactness at `wdth 88%`, and the first study
   already named that lever the least timeless thing it used — at 88% Archivo
   reads as contemporary-condensed, which is a 2020s fashion rather than a
   Swiss one. D needs the compactness C was buying, and gets it from the
   scale solve instead, which is a property of the system rather than of the
   letterform.

2. **One grid, obeyed.** A's discipline was real and it is the thing that
   made A portable. D keeps it and tightens it: a 120px margin on all four
   sides — a real rectangle with four sides, not A's hard left spine with a
   loose right edge — and a 1200 × 660 field divided into twelve 100px
   columns. Two axes are used and no others: the **spine** at column 1, which
   every monument begins on, and the **counter-axis** at column 9, which every
   quiet block begins on.

3. **The mono micro role, and the case distinction under it.** C abolished
   uppercase and mono entirely and lost less than expected, but it also lost
   the distinction the brief actually wants in §17 — editorial brand voice
   against technical instrumentation. D keeps a mono micro for altitudes only,
   which is the one thing on the page that is genuinely an instrument reading.
   It appears at most once per frame and never on anything that speaks.

4. **Portability as a requirement rather than a hope.** A's real advantage was
   that it survives being handed to someone else. D is describable in a
   paragraph — one family, one weight, one width, three roles, two axes, one
   margin, sizes solved — which is the property that makes a type system hold
   over time.

---

## C · What was taken from Direction C

1. **The nerve.** C3 was the best frame in the first study and it earned that
   by being willing to set one sentence enormously and let the rest of the
   frame be empty. D3 takes that posture and goes past it: 174px at wdth 100%
   sets `Innen már látni` at **1 057px**, against C3's 918px at 168px/wdth 88%
   — 15% wider on the page in the same width as the rest of the system.

2. **Bottom-anchoring, generalised into a rule.** C anchored its monuments
   near the foot of the frame. D anchors every monument by its **last
   baseline** rather than by its top edge, so a 174px Hungarian statement and
   a 144px German one on three lines share the same architectural line and the
   composition does not move when the language does. C's instinct, turned into
   the mechanism that makes locale-aware scale possible.

3. **A very small vocabulary.** C proved two type styles could carry three
   frames. D uses three — monument, editorial, micro — and, like C, uses **one
   weight**: 400, everywhere, including the action and the metadata. §16 asks
   whether even Medium is required for monuments. It is not, and it is not
   required for anything else either.

4. **The refusal to decorate.** No rule between the six disciplines, no
   horizon hairline, no eyebrow, no index numbers, no chapter marks.

---

## D · What was rejected

**From C, the 88% width axis.** §B1 above. It is the most visible thing C did
and the least durable.

**From C, the cropped instrument.** C1's dial is the same 700px projection as
A1's and is cropped by the right edge. D's is 221px, fully inside the right
margin, at full strength rather than faded. Fading an object is how you make
it recede when it is too big; it is not how you make it precious.

**From A, the four-role ladder.** A had monument, body, micro and the action.
D has monument, editorial, micro. §15 permits a Display level "only if
testing proves it genuinely necessary" — it was tried in all three frames and
deleted from all three, because everywhere it wanted to go the honest answer
was that the sentence belonged in EDITORIAL or did not belong in the frame.

**From A, two weights.** A used 500 for the metadata and the action. D uses
400 for everything. The action's authority comes from its position and the
hairline under it.

**From A and B, the six-across metadata row.** A2 set the six disciplines
evenly across the foot under a rule. On an even grid that is a navigation bar
wearing a different hat. D2 sets them as one running line separated by
middots — the shape of a colophon.

**From the previous study, the uppercase micro — and this one is a correction
rather than a preference.** The micro role's only content is an altitude, so
the only letter uppercase could reach was the unit: **every metadata line in
the previous study reads `27 000 M`, and `M` is not the symbol for a metre.**
The technical register was making a technical error. D sets it lowercase; the
mono, the tracking and the size carry the instrumentation reading, and the
case does not.

**The premise line in the hero.** `Nem weboldalakat építünk.` is good copy and
it is one supporting layer too many for the frame §9 describes. D1 carries the
lead and drops the premise.

**The `0 m` stamp in the hero.** §29's test — if it disappears, is the
composition less understandable? With an altimeter in the frame reading zero,
no. D1 has no micro at all.

**A three-line variant of the Hungarian high-altitude statement**, and the
one-line variants of all three system statements — see §I6.

**Serif.** Per §3, none was provisioned, none downloaded, none used.

---

## E · The Direction D typographic system

### E1 · The whole vocabulary

| role | setting | used |
| --- | --- | --- |
| **01 Monument** | Archivo 400, wdth 100%, tracking −0.028em, sentence case. Size and leading **solved** | once per frame |
| **02 Editorial** | Archivo 400, 17px / 1.62, tracking −0.002em, 400px measure, 46% opacity | once per frame |
| **03 Micro** | JetBrains Mono 400, 10px, tracking 0.20em, lowercase, 34% opacity | 0–1 per frame |
| *the action* | Editorial size and weight, one hairline under it | hero only |
| *the wordmark* | Aboreto 400, 16px, tracking 0.42em — the standing brand rule, unchanged | **hero only** |

One family. One weight. One width. Three roles and no fourth. The
monument-to-editorial ratio runs **8.1 : 1** to **10.2 : 1** depending on
locale, against roughly 3 : 1 in production today.

### E2 · The scale rule — the part that is actually new

Two rules produce every size in `direction-d-scale.css`. Neither of them is a
pixel value.

> **Rule 1 · The Hungarian size is set by column fill.**
> Each scene declares what fraction of the 1 200px field its longest Hungarian
> line should occupy. Hero **0.64**, system **0.74**, high altitude **0.88**.
> That number is the art direction. The pixel value is arithmetic.
>
> **Rule 2 · Every other locale matches on ink area, not on size.**
> A statement's presence is approximately its total line advance times its
> size, and both terms move when the language changes. Matching only one of
> them fails visibly: match the size and German overflows, match the width and
> English goes small on a wide block. So D holds the product constant —
> `K = (Σ line advances at 1px) × size²` — per scene.

Two clamps, both hard: no line may exceed 98% of the field, and no monument
may exceed 210px. **Neither clamp fires in any of the nine frames**, which is
the result that matters: the rule produces legal frames on its own rather than
being rescued by its own guard rails.

Consequences worth stating plainly:

- **The hero is the smallest fill in the direction and the high-altitude frame
  the largest.** §23 asks for presence rather than size, and this is where
  that is enforced — D1's authority comes from the field around it, not from
  competing with D3.
- **Monuments are placed by their last baseline**, on a foot line declared per
  scene (D1 y=548, D2 y=662, D3 y=748). This is what makes Rule 2 usable: a
  144px German block and a 174px Hungarian one land on the same line.
- **No size in any of the nine frames matches any other.** That is the system
  working, not failing.

### E3 · The grid

120px margin, four sides. Field 1200 × 660, twelve 100px columns. Spine at
x = 120 for every monument; counter-axis at x = 920 for every quiet block;
right margin line at x = 1320 for right-aligned metadata and for the dial's
right edge. Consistency comes from the grid, the roles and the scale
relationships — **not** from the headline being in the same place three times.
Each frame uses the grid differently on purpose (§14).

---

## F · Hero decisions

**The break: `Magasságot` / `építünk.`** The alternative — one line at 135px —
was measured and rejected: it fills 98% of the field and holds 85% of the
presence. Smaller and more cramped, for the sake of one line.

**The size: 148px, from fill 0.64.** Deliberately the smallest fill in the
direction. This is §23 taken literally.

**The instrument, as a measurement rather than an adjective.** The source
render is 2 400 × 2 400 and the drawn circle occupies 52.7% of it — so a
420px box places a **221px dial**, against roughly 370px visible in A1 and C1.
It sits fully inside the right margin, with its right edge on x = 1320, at
0.94 opacity rather than the previous study's 0.62.

| | air between the end of the statement and the start of the dial |
| --- | --- |
| Hungarian | **210px** |
| English | **178px** |
| German | **271px** |

That English figure is why D1 does not use the break `messages.ts` already
carries — see §I5 and the first pair on `direction-d-breaks.png`.

**Information reduction.** Five objects: wordmark, monument, one supporting
line, one action, the instrument. A1 had seven. The premise line and the `0 m`
stamp are gone.

**The action.** Neutral, editorial size, weight 400, one hairline. It sits on
the **counter-axis at x = 920, sharing the supporting line's first baseline**
rather than stacking under it — two quiet objects on one architectural line
read as one band, and a band the eye crosses in a single movement costs one
object's worth of attention rather than two. Judged before colour: it is the
fourth thing read, which is where §9 wants it.

---

## G · System decisions

**`Hat terület, egy rendszer.` at 162px is unambiguously the first read.** The
one-line alternative solves to 115px and 51% of the presence — the clearest
break rejection in the study.

**The informational field around it was emptied.** Four objects: the altitude,
one explanatory line, the monument, the six areas. No service list, no
categories, no chapter note, no rule, no blurbs.

**The six disciplines are one running line at the foot**, in the editorial
size at 40% opacity, separated by middots: `Stratégia · Dizájn · Fejlesztés ·
Hirdetés · Konverzió · Automatizálás`. The business structure stays fully
readable (§34) and it cannot compete with a 162px monument. A colophon, not a
dashboard.

**The composition is a diagonal, not a stack.** The altitude holds the
top-left corner, the explanatory line crosses to the counter-axis at the top
right, the monument sits on the spine below the middle, the six areas run
along the foot. That is a different use of the same grid from D1's, which is
what §14 asks for.

---

## H · High-altitude decisions

**This frame was set twice and the larger version was rejected**, which is the
most useful thing in this section.

At fill 0.96 the Hungarian monument solves to 190px and its longest line runs
to 1 154px — **46px short of the right margin**. It is bigger than the
version that shipped in this study and it is worse. A statement that stops
46px from the margin reads as *constrained by the frame*; one that stops 143px
short reads as *placed in it*. At fill 0.88 the monument is 174px, the longest
line is 1 057px, and the frame gains five percentage points of empty area.
§23's sentence — luxury typography is not a competition for the largest pixel
value — turned out to have a specific threshold in this frame, and it is
between those two settings.

**It is still comfortably past C3.** 1 057px against C3's 918px, at wdth 100%
rather than 88%, on the same statement. C3 is the floor, and D3 clears it.

**Two bands and a void.** The quiet line is pinned to the top of the field and
the monument's last baseline to the bottom of it, which makes the empty middle
the largest single area in the direction — 1 440 × 268. It is also what gives
German room for a third line without the frame becoming crowded.

**No instrument**, per §13. **No horizon hairline**: it was set and cut,
because at every height it was tried it crossed one of the three monuments,
and a rule that has to dodge the type is decoration pretending to be
structure. The tonal lift carries the distance on its own.

**The quiet line moved to the counter-axis**, where D2's also is. This is the
one deliberate visual separation from C3, which put it on the spine, and it is
the cue that distinguishes the two frames at thumbnail scale (§K).

---

## I · Scale and line breaks, HU / EN / DE

### I1 · What actually shipped

Every number below is generated, not typed: `direction-d-scale.css`, written
by `solve-d.mjs`, verified independently against the rendered frames by
`shoot-d.mjs`.

| scene | locale | lines | size | leading | longest line | fill of field | **presence** |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **D1** hero | hu | `Magasságot` / `építünk.` | **148px** | 1.03 | 769px | 64.1% | 100% |
| | en | `Altitude is` / `what we build.` | **137px** | 0.94 | 801px | 66.7% | 99.3% |
| | de | `Höhe` / `bauen wir.` | **170px** | 0.94 | 708px | 59.0% | 100.1% |
| **D2** system | hu | `Hat terület,` / `egy rendszer.` | **162px** | 0.94 | 889px | 74.1% | 100% |
| | en | `Six areas,` / `one system.` | **169px** | 0.94 | 860px | 71.6% | 99.6% |
| | de | `Sechs Bereiche,` / `ein System.` | **150px** | 0.94 | 1 027px | 85.6% | 100.5% |
| **D3** altitude | hu | `Innen már látni` / `a görbületet.` | **174px** | 0.94 | 1 057px | 88.1% | 100% |
| | en | `From here` / `you can see` / `the curvature.` | **151px** | 0.98 | 858px | 71.5% | 100.2% |
| | de | `Von hier aus ist` / `die Krümmung` / `zu sehen.` | **144px** | 0.94 | 894px | 74.5% | 100% |

*Presence* is the ink-area index of Rule 2, normalised to the Hungarian frame.
**All nine sit within 0.7% of parity.** That is the §20 claim — same
authority, different geometry — as a number rather than as a hope.

### I2 · German is no longer the binding locale

The previous study's central locale finding was that German at high altitude
sets 47% wider than Hungarian and forces every direction to give up size. That
is still true of the sentence and no longer true of the system. German's
high-altitude monument sets at **144px against Hungarian's 174px** and holds
**100%** of its presence, because it is allowed a third line and its own
geometry. Nothing in the system was reduced to accommodate it.

The reverse case is also handled without a special rule. German's hero,
`Höhe bauen wir.`, is the **shortest** statement in the study — and it sets
**largest, at 170px**. The previous study flagged that German's hero would be
"thinner than it should be"; Rule 2 fixes it by arithmetic rather than by an
exception.

### I3 · The size spread is the point

No two of the nine share a size. The spread within a single scene is 137–170px
in the hero and 144–174px at high altitude. A system that tried to hold one
number across three languages would have to pick the German worst case — which
§20 explicitly forbids — and would set Hungarian at roughly 82% of the size
its own frame can carry.

### I4 · Where the clamps stand

Neither clamp fires. The closest approach to the 98%-of-field limit among the
nine is Hungarian's high-altitude frame at 88.1%, and it is there by choice
rather than by pressure — §H set that fill deliberately; the closest to the 210px ceiling is
German's hero at 170px. The system has real headroom in both directions, which
is what C did not have.

### I5 · Three authored breaks the content layer does not carry yet

Six of the nine monuments break exactly where `messages.ts` already splits
them (`title.a` / `title.em` / `title.b`). Three do not, and this is Direction
D's only consequence for the content layer:

| frame | needs | instead of the `messages.ts` split |
| --- | --- | --- |
| D1 · en | `Altitude is` / `what we build.` | `Altitude` / `is what we build.` |
| D3 · hu | `Innen már látni` / `a görbületet.` | `Innen már` / `látni a görbületet.` |
| D3 · en | `From here` / `you can see` / `the curvature.` | `From here you can` / `see the curvature.` |
| D3 · de | `Von hier aus ist` / `die Krümmung` / `zu sehen.` | `Von hier aus ist` / `die Krümmung zu sehen.` |

These belong in `messages.ts` as authored per-locale breaks, not in CSS and
not left to the browser. **No word changes** — only where the line ends.

### I6 · The break studies

All rejected settings were solved by the same two rules, so the comparison is
like with like. Four of them are photographed on `direction-d-breaks.png`.

| scene · locale | break | size | fill | presence | verdict |
| --- | --- | --- | --- | --- | --- |
| D1 hu | `Magasságot` / `építünk.` | 148px | 64% | 100% | **chosen** |
| D1 hu | one line | 135px | 98% | 85% | smaller and cramped |
| D1 en | `Altitude is` / `what we build.` | 137px | 67% | 99.3% | **chosen** |
| D1 en | `Altitude` / `is what we build.` | 137px | 77% | 99.3% | *identical typography* — rejected on the frame, `x1` |
| D1 en | one line | 117px | 98% | 73.8% | rejected |
| D1 de | `Höhe` / `bauen wir.` | 170px | 59% | 100.1% | **chosen** |
| D1 de | one line | 168px | 93% | 100.5% | rejected — see below |
| D2 hu | `Hat terület,` / `egy rendszer.` | 162px | 74% | 100% | **chosen** |
| D2 hu · en · de | one line | 115 / 126 / 99px | 98% | 51 / 56 / 44% | rejected outright |
| D3 hu | `Innen már látni` / `a görbületet.` | 174px | 88% | 100% | **chosen** |
| D3 hu | `Innen már` / `látni a görbületet.` | 166px | 98% | 91% | smaller *and* cramped, `x2` |
| D3 en | `From here` / `you can see` / `the curvature.` | 151px | 72% | 100.2% | **chosen** |
| D3 en | `From here you can` / `see the curvature.` | 150px | 97% | 100.1% | rejected on the right edge, `x4` |
| D3 en | `From here you` / `can see the` / `curvature.` | 151px | 76% | 100.2% | rejected on the grammar |
| D3 en | `From here` / `you can see the curvature.` | 109px | 98% | 52.8% | rejected outright |
| D3 de | `Von hier aus ist` / `die Krümmung` / `zu sehen.` | 144px | 75% | 100% | **chosen** |
| D3 de | `Von hier aus ist die` / `Krümmung zu sehen.` | 132px | 98% | 85% | smaller *and* cramped, `x3` |
| D3 de | `Von hier aus` / `ist die Krümmung zu sehen.` | 102px | 98% | 51% | rejected outright |

Four of these are decisions rather than arithmetic, and each is on the
breaks sheet:

- **D1 English (`x1`).** Both breaks solve to 137px and to identical presence.
  The type is indifferent; the frame is not. The `messages.ts` split runs its
  second line to 918px and the air around the instrument collapses from 178px
  to **81px**. A break chosen on the composition rather than on the sentence.
- **D3 English (`x4`).** Presence does not decide this one either — 100.2%
  against 100.1%. The two-line break runs to **96.9%** of the field, which is
  the same cramped right edge D3 rejected in Hungarian when the scene's fill
  came down from 0.96 to 0.88. Accepting it here and rejecting it there would
  make that principle a preference.
- **D3 German (`x3`).** The frame the whole locale rule exists for. German's
  best two-line break is column-bound at 132px, holds 85%, and runs to 98.3%
  of the field. The third line is not a concession — it is the locale's own
  geometry, and it buys back both the size and the right-hand air.

**The one-line German hero deserves its own note**, because on the numbers it
is a legitimate alternative — 168px and 100.5% presence — and it was still
rejected. A one-line hero in one locale and a two-line hero in the other two
is not "different geometry" in the sense §18 licenses; it is a different
composition, and the frame's balance of mass against the instrument depends
on the two-line block. This is the one place where the rule was overruled by
the art direction, and it is recorded here rather than buried.

### I7 · The decision rule, stated once

> Take the break with the most presence. Where two are within a point of each
> other, take the one that does not run to the edge of the field.

That rule alone selects every high-altitude break in all three languages.

---

## J · Leading and accent clearance

### J1 · Leading is a property of the statement, and the solve proves it

The gap between two lines, measured in ems, is `leading + D`, where **D is a
constant of the two strings and does not move with size**. So D is measured
once per statement per locale — as painted ink, column by column, at the
actual tracking and width axis — and the leading that buys 0.12em of real
clearance falls out of it.

| statement | D (em) | minimum leading | used | clearance |
| --- | --- | --- | --- | --- |
| `Magasságot` / `építünk.` | **−0.905** | **1.03** | 1.03 | 0.125em |
| `you can see` / `the curvature.` | −0.860 | **0.98** | 0.98 | 0.120em |
| `Innen már látni` / `a görbületet.` | −0.735 | 0.86 | 0.94 | 0.205em |
| `Altitude is` / `what we build.` | −0.735 | 0.86 | 0.94 | 0.205em |
| `Von hier aus ist` / `die Krümmung` | −0.730 | 0.85 | 0.94 | 0.210em |
| `Höhe` / `bauen wir.` | −0.725 | 0.85 | 0.94 | 0.215em |
| `Sechs Bereiche,` / `ein System.` | −0.700 | 0.82 | 0.94 | 0.240em |
| `Six areas,` / `one system.` | −0.685 | 0.81 | 0.94 | 0.255em |
| `Hat terület,` / `egy rendszer.` | −0.675 | 0.80 | 0.94 | 0.265em |
| `die Krümmung` / `zu sehen.` | −0.545 | 0.67 | 0.94 | 0.395em |
| `From here` / `you can see` | −0.540 | 0.66 | 0.94 | 0.440em |

Three distinct leadings across eleven line pairs — **0.94, 0.98, 1.03** — and
a floor of 0.94 that catches the seven statements which would otherwise be
allowed to set tighter than is tasteful. This is the "statement-aware optical
leading" §21 asks for, and it is three constants in a generated file rather
than a measurement feedback loop.

### J2 · The Hungarian hero pair is confirmed as the binding case

`Magasságot` / `építünk.` needs **1.03**, which is 0.05em more than any other
statement in the study and 0.17em more than the Hungarian high-altitude pair.
It puts the two descenders of *Magasságot* over the accents of *építünk.*, and
the ink columns coincide at x = 333 across 515 shared columns. The previous
study found the same defect from the other direction; D's solve derives it
rather than remembering it, which means it would find the equivalent collision
in a sentence nobody has written yet.

**A single `--lead` token would ship this defect.** Direction D does not have
one.

Note the correction to the earlier finding: the first study reported this pair
as touching at 0.034em under `wdth 88%` and −0.026em tracking. At wdth 100%
and −0.028em the same pair clears at 0.125em on 1.03 leading. The collision is
a property of the *setting*, not only of the words — which is another reason
the width axis is not a free parameter.

### J3 · One measurement failure worth recording

The first complete solve of this direction was wrong, and the way it was
caught is the part worth keeping.

`await document.fonts.ready` is not sufficient to guarantee a font is loaded.
The three families are declared `font-display: block`, and a probe page that
has not laid out any text in them never requests them — so `fonts.ready`
resolved against a document where Archivo was still `unloaded`, and **every
advance and every clearance in the solve was measured against the macOS system
fallback.** It under-measured `Innen már látni` by 7%, which put the Hungarian
high-altitude monument 33px outside the frame. Nothing reported an error.

It was caught because `shoot-d.mjs` re-measures the rendered frames instead of
trusting the numbers it is handed. That check is now permanent: every monument
line is compared against the width `solve-d.mjs` predicted for it, and a
disagreement of more than 3px fails the run with the message that the scale
file was computed against a different setting. `fonts-ready.mjs` additionally
requests the faces for the actual codepoints in use — the Hungarian double
acutes live in `latin-ext`, which is a separate face that loads separately —
and asserts they arrived.

**If Direction D is implemented, this applies to production too.** Any
build-time or runtime measurement of text — a fitting routine, a balanced-text
polyfill, a canvas measurement — must assert the face before believing the
number.

### J4 · Hungarian, at these sizes

Coverage is complete and nothing falls back; that was established in the
previous study and is unchanged. What is new: at 148–174px the accents are not
a clearance problem in any statement except the hero pair, and the double
acute costs horizontal room rather than vertical — which the fill rule already
accounts for, because it measures the real advance of the real string.

---

## K · The distance test

`direction-d-distance.png`, at 240px — the width of a thumbnail. Reported
honestly, including where it does not pass.

**Hero — passes, but not for the reason expected.** A, C and D are instantly
separable at 240px, and the cue that separates them is the *instrument*: A and
C both carry a ~370px dial cropped by the right edge, D carries a small circle
in the corner. The typographic difference (148px against 116px, five objects
against seven) is visible and secondary. This is worth stating plainly: **at
thumbnail scale D1's distinction from A1 is carried as much by the reduction
of the altimeter as by the type.** It is still the frame the brief asked for —
but the credit belongs partly to §8, not entirely to §7.

**System — passes.** Three clearly different silhouettes: A's rule and
six-across row, C's right-hand column of six over a bottom-anchored monument,
D's single quiet foot line under a monument that sits higher and larger than
either.

**High altitude — partial pass, and this is the honest result.** D3 and C3 are
recognisably siblings at 240px: both are a quiet line at the top and one
enormous statement at the foot. The cues that separate them are the size
(1 057px against 918px) and the side the quiet line sits on (D's counter-axis,
C's spine). Against A3 the separation is instant. **D3 does not have a
silhouette that is independent of C3's** — but §13 instructed it to evolve
from C's composition and not to weaken it for the sake of system consistency,
so this is the brief's own trade being paid rather than a failure to explore.

**§32's two failure conditions.** *"If D looks like A with bigger text"* — no;
the object count, the instrument treatment and the compositional axes all
differ. *"If D looks like C with reduced font size"* — no, and specifically
the inverse: D sets larger than C everywhere, in a different width axis.

**The locale row passes cleanly.** Three sizes, two line counts, one
silhouette, at 240px.

### K2 · Whitespace, measured — where D does NOT beat A

§26 asks D to be more spacious than A. **On the numbers it is not**, and the
brief deserves the number rather than the adjective. `whitespace.mjs`, with
the instrument included as its drawn circle for all three directions:

| scene | direction | objects | frame empty | largest single void |
| --- | --- | --- | --- | --- |
| hero | A | 7 | 75.8% | 26.9% (388 × 900) |
| | C | 6 | 71.2% | 27.1% (676 × 520) |
| | **D** | **5** | **75.4%** | 21.8% (1440 × 196) |
| system | A | 5 | 85.8% | 38.1% (748 × 660) |
| | C | 4 | 79.7% | 26.2% (412 × 824) |
| | **D** | **4** | **76.0%** | 21.4% (428 × 648) |
| high altitude | A | 3 | 84.6% | 40.8% (588 × 900) |
| | C | 3 | 75.8% | 35.4% (1024 × 448) |
| | **D** | **3** | **71.0%** | 29.8% (1440 × 268) |

**D has the fewest objects in every scene and the least empty area in two of
three.** The cause is not clutter — it is scale. A sets its statements at
108–124px and has room left over; D sets at 148–174px and uses it.

What the table also shows is that D's emptiness has a different *shape*. A's
largest void is a tall empty column — A leaves half the frame unused and puts
everything on a left spine. D's is a wide band across the full 1 440. Both are
whitespace; only one of them is whitespace that the composition is using. A
frame with an unused right half is not more spacious than one with a
full-width silence in it, it is less resolved — but that is an argument, and
the number above is a fact, and the human review should have both.

**If the review's judgement is that D3 in particular is too full, the lever is
already identified and calibrated**: the scene's fill. Dropping D3 from 0.88
to 0.80 would return roughly four more points of empty area and cost about
16px of monument. §H records what happened when it was moved the other way.

---

## L · Recommendation

### Direction D is stronger than A and stronger than C, and it should be the basis of the system.

Not because the brief asked for a fourth direction. Because three specific
things that were wrong are now right, and each is checkable rather than
asserted.

**1. The brittleness that disqualified C is gone, and it was removed by a
rule rather than by a concession.** C's verdict was *brittle* because its
signature frame could not survive German without giving back 14px. D's
equivalent frame holds **100% of its presence in all three languages**, the
clamps never fire, and German — the locale that bound every previous direction
— is neither the binding case nor a special case. This is the single most
important result in the study, and it generalises: a fourth language would be
solved by the same two rules without anyone opening the CSS.

**2. The safety that disqualified A is gone.** D sets 148–174px against A's
108–124px, carries five objects in the hero against A's seven, and lets a
statement occupy 88% of the field. A's fifth adjective was *safe*; D's frames
are not safe, and D3 in particular is a frame that a cautious studio would not
sign off.

**3. The hero is finally a typographic composition.** This was a real defect
in the first study — the instrument dominated all three heroes equally, so the
hero row proved nothing. Reducing the dial to 221px inside the margin, with
178–271px of measured air around it, produces the reading order §33 asks for.
The instrument also looks *better* at 0.94 opacity and small than it did at
0.62 and large.

### What D does not do, stated plainly

**D does not add a second voice.** The first study's complaint about A was not
that it was undisciplined but that it had no character — that it could belong
to any competent modern studio. D answers *safe* with *authoritative*. It does
not answer it with *tonal range*. There is exactly one voice in these nine
frames, and at three frames that is a strength; across eleven chapters — a
process ledger, a case study, a contact section, an FAQ — it is an untested
claim, and it is the same untested claim that made C's minimalism suspect.

My honest read after building it: **D has enough authority that a serif is no
longer needed to make Stratos feel expensive.** It would still be needed to
make Stratos sound like more than one thing. §3 said an editorial accent may
be reconsidered later if the chosen system still lacks tonal depth. It does
lack tonal depth. That is now a deliberate, isolated question rather than a
confound, which is the most useful thing this phase could have done to it.

**D is more machinery than A or C.** The scale solve is a build step that
writes a CSS file. That is a real cost: it needs to run when copy changes,
`solve-d.mjs` and `shoot-d.mjs` need to stay in CI, and if nobody maintains
them the system silently decays into the fixed pixel values it was built to
avoid. §J3 is the warning — the machinery was wrong for a whole pass and only
a second, independent measurement caught it.

**D is not more spacious than A on the numbers** (§K2). It has fewer objects
and bigger type, and its whitespace is fewer, larger silences rather than one
unused half-frame. I believe that is better. It is not what §26 literally asks
for, and the human review should decide that on the sheets rather than on my
adjective.

**Three frames is where every minimalism looks easy.** The same caution the
previous study raised against C applies to D, undiminished.

### What must be decided before anything is implemented

1. **Accept or reject the solved-scale approach itself.** Everything else
   follows from it. The alternative is per-locale sizes hand-written into
   `messages.ts`-adjacent config — workable, less principled, no build step.
2. **Move four authored line breaks into the content layer** (§I5). No copy
   changes; only where lines end.
3. **Confirm the three type roles survive contact with the other eight
   chapters** before committing. Sketch the process ledger and one case study
   in D before it ships, because that is where a fourth role will be demanded.
4. **Decide the editorial face question separately and later**, now that it is
   no longer entangled with whether the grotesk can carry the brand. It can.
5. **Carry §J3's lesson into production**: any code that measures text must
   assert the font loaded before believing the measurement.
6. **Re-judge D3's fill (0.88) on the sheets.** It is the one number in the
   direction that was set by eye after being set by rule, and §K2 gives the
   trade if the review wants more air.

### Verdicts against the brief's own tests

- **§33 hero.** Typography dominates before the altimeter ✓ · calmer than the
  previous hero ✓ · less information (5 objects against 7) ✓ · the altimeter
  is isolated, 178–271px measured ✓ · works without yellow ✓.
- **§34 system.** `Hat terület, egy rendszer.` is the first read ✓ · the six
  areas remain legible as business structure ✓ · no interface clutter ✓ ·
  editorial rather than presentation-like ✓.
- **§35 high altitude.** Stronger than C3 on scale, width axis and right-hand
  air ✓ · not made safer for the system's convenience ✓ · still a signature
  frame ✓ — with §K's honest note that it reads as C3's descendant at
  thumbnail scale, which §13 instructed.
- **§32 distance.** Passes on hero and system, partially on high altitude,
  cleanly on locales — §K.
- **§26 whitespace.** Not met as literally written — §K2.
- **§16 weight.** One weight, 400, everywhere. Medium is not required for
  monuments and turned out not to be required for anything.
- **§24 colour.** Monochrome throughout. `--signal` does not exist in the file.

---

## Stop here

Nothing in this study has been implemented. No production CSS was modified, no
font was replaced or provisioned, `scene.ts`, `composition.ts`, the scroll
behaviour, the Altimeter choreography, the homepage content structure and the
mobile route are untouched, and nothing has been pushed, merged or deployed.

**Awaiting human review.**

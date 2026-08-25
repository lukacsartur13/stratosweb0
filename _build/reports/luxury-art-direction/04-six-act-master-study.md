# The six-act master study — Direction D across the whole homepage

**Phase 2. Static art direction only. Nothing in this pass touches production.**

`experiments/src/full/styles.css`, `mobile/mobile.css`, `scene.ts`,
`composition.ts`, `journey.ts`, the scroll mechanics, the Altimeter
choreography, `locales/messages.ts`, `content.ts`, the production fonts, the
GLB, `components/MeridianLights.tsx` and the deployment configuration are all
unchanged. Nothing was pushed, merged or deployed. No serif was provisioned,
no font was downloaded, no 3D object was added and no A/B/C/D typography
exploration was reopened. The working tree carries this document, forty-one
frames, eight sheets and the scripts that produced them.

| | |
| --- | --- |
| `04-six-act-master-study.md` | this document, §A–§Q |
| **`six-act/six-act-monochrome.png`** | **the six master frames, and the seventh beat** |
| **`six-act/six-act-color.png`** | the same six with the restrained palette |
| **`six-act/six-act-distance.png`** | §45 — all six at 240px, in monochrome, colour and German |
| **`six-act/six-act-storyboard.png`** | §43 — sixteen frames of journey rhythm |
| **`six-act/direction-d-width-study.png`** | §48 — the Archivo width axis, three acts × three states |
| **`six-act/altimeter-luxury-study.png`** | §49 — current presentation against a restrained one |
| `six-act/six-act-locales.png` | eighteen monuments, HU / EN / DE |
| `six-act/six-act-decisions.png` | the two rejections that are worth seeing as frames |
| `six-act/a1…a6-hu.png` | **the six masters individually**, 1440 × 900 at 2× |
| `six-act/a6b-hu.png` | Act VI's second beat — the action frame |
| `six-act/a{1..6}-{en,de}.png` · `a*-hu-c.png` | the locale set and the colour set |
| `six-act/a3-hu-inst.png` · `y1…y3.png` | the four rejected settings, photographed |
| `six-act.html` · `six-act.css` · `six-act-color.css` | the source. No production CSS is loaded |
| **`six-act-scale.css`** | **generated.** Every solved size, leading, width and position |
| `solve-six.mjs` · `six-act/scale.json` | the solve, and every measurement behind it |
| `shoot-six.mjs` · `six-act/measurements.json` | the audit — it refuses to photograph a frame that fails |
| `storyboard.html` · `variants-six.html` · `sheets-six.html` | the storyboard, the variants, the sheets |
| `render-lux.mjs` · `studio-lux.html` · `assets/lux-*.png` | §49's studio and its seven plates |

**Every word in every frame is verbatim** from `locales/messages.ts` and
`content.ts`, in all three languages. Nothing was written, re-translated or
paraphrased. Three editorial decisions would have to reach the content layer
and all three are recorded in §M4; none of them changes a word.

---

## A · The six-act design logic

### A1 · What the grouping is actually for

The old homepage had eleven chapters and tried to make each one visually
interesting. The failure that produces is not that any single frame is bad —
it is that **eleven similarly-weighted moments have no shape**. A visitor
cannot remember eleven things about a page, so they remember none of them, and
a page nobody remembers the shape of cannot feel like a brand.

Six acts is not a smaller number of the same thing. It is a different unit:
each act is one dominant thought with one primary anchor, and the internal
scroll stages inside it are allowed to exist without being *events*.

The test that was applied to every frame is the one §2 sets — *is this at
least as controlled and visually authoritative as D3?* — and the direction of
the correction was always upward. **D3 was not weakened to make the others
easier to match.** Act V is Direction D's high-altitude frame with nothing
changed: same fill (0.88), same foot line (748), same 174px, same 1 057px
longest line, same three objects.

### A2 · One dominant idea per act, stated as one sentence each

| | the act's one thought | its one anchor |
| --- | --- | --- |
| **I · Ground** | *We build altitude.* | the statement, with the instrument isolated beside it |
| **II · Noise** | *Down here everything is noisy — and it is equally dense for everyone.* | one statement, stacked into a column |
| **III · System** | *Six areas, one system — the order is the point.* | the statement, with the structure subordinate under it |
| **IV · Proof** | *Fifteen million forints of contracted work, from search.* | the figure, against the work |
| **V · High altitude** | *From here you can see the curvature.* | the statement, and the space around it |
| **VI · Arrival** | *Welcome to the stratosphere.* | the statement, and the instrument's return |

### A3 · Object counts, measured rather than intended

Every number below is from `six-act/measurements.json`, produced by re-measuring
the rendered frames. *Objects* counts everything in the picture — every type
block, the collaboration plate as one object, the capture, and the instrument
as its drawn circle rather than as its transparent box.

| act | objects | covered | largest single void | instrument | yellow |
| --- | --- | --- | --- | --- | --- |
| I · Ground | **5** | 25.3% | 21.8% — 1440 × 196 | 229px dial, 202px of air | — |
| II · Noise | **2** | 21.2% | **43.0% — 792 × 704** | — | — |
| III · System | **3** | 24.3% | 26.1% — 920 × 368 | — | — |
| IV · Proof | **4** | 35.6% | 25.1% — 696 × 468 | — | the figure |
| V · High altitude | **3** | 30.9% | 28.4% — 1440 × 256 | — | — |
| VI · Arrival | **2** | 26.3% | 23.5% — 620 × 492 | 200px dial, 151px of air | — |
| *VI · Action* | *2* | *17.5%* | *33.3% — 1440 × 300* | *—* | *the action* |

The densest frame in the study has **four** things in it, and it is the one
whose job is evidence. Direction D's densest had five.

---

## B · What was removed from the old visual language

### B1 · Removed in this pass

- **Eight of the eleven chapter identities as visual events.** They survive as
  content and as scroll stages; they stop being frames that ask to be looked at.
- **The second Altimeter appearance in the system act.** Built, lit, placed,
  measured and cut — §E, §I3 and `six-act/a3-hu-inst.png`.
- **The altitude label in four of the six acts.** One survives, in the one act
  whose sentence is itself a measurement about the atmosphere.
- **`Együttműködések` as a heading over the collaboration marks.** §23 says
  their existence is enough; a label on top of it is a second voice saying what
  the eye has already understood.
- **`selectedWork.title` from the Proof keyframe** — *"Akikkel együtt
  emelkedtünk."* It is good copy and it is a sentence in the one act whose
  dominant thought is a number.
- **The first sentence of `lowerAtmosphere.lead`** from the System keyframe. It
  restates what the 162px monument above it already says.
- **The grayscale filter and the 94% opacity on the instrument** — two
  corrections that were being applied to a lighting problem instead of to its
  cause. §O.
- **Six loud backgrounds.** There are two tonal moves in six frames.

### B2 · Still absent, inherited from Direction D

No serif, no second family, no second weight, no uppercase outside the one
mono altitude, no eyebrows, no roman numerals, no chapter markers, no rules
between sections, no horizon hairline, no rings, no coordinates, no fake data,
no targeting UI, no glow, no particles, no extra 3D, no WebGL decoration, no
word-level colour emphasis inside a statement, no cards, no boxes, no CTA
panel, no animation. `--signal` does not exist in `six-act.css`; it is
declared once in `six-act-color.css` and used twice in the whole study.

### B3 · The microcopy reduction, counted

§6 asks for another 30–50% off the non-essential microcopy. Counting *words
outside the monument*, per frame, in Hungarian — the method is stated so the
number can be checked:

| | Direction D, 3 frames | the six acts, 6 frames |
| --- | --- | --- |
| the wordmark | 1 | 1 |
| supporting lines | 11 + 12 + 9 = 32 | 11 + 6 + 5 + 9 = 31 |
| the six disciplines | 6 | 6 |
| the client name and the metric label | — | 2 + 3 = 5 |
| the action | 3 | 3 |
| **total supporting words** | **42** | **46** |
| **per frame** | **14.0** | **7.7** |
| altitude readings | 2 in 3 frames | **1 in 6 frames** |
| non-monument objects per frame | 2.67 | **1.67** |

**45% fewer supporting words per frame, 37% fewer supporting objects per
frame, and the altitude reading appears one third as often.** Inside §6's
target on both measures, and the reduction is real rather than achieved by
counting differently: the six acts carry *more* total supporting copy than
Direction D's three did, spread across twice as many frames.

---

## C · Direction D application rules

Everything in §E of `03-direction-d.md` holds unchanged. What follows is only
what Phase 2 added, and each addition is here because six acts demanded it and
three did not.

### C1 · The vocabulary, unchanged

| role | setting | used |
| --- | --- | --- |
| **01 Monument** | Archivo 400, wdth 100%, tracking −0.028em, sentence case. Size, leading and position **solved** | once per act |
| **02 Editorial** | Archivo 400, 17px / 1.62, tracking −0.002em, 400px measure, 46% | once per act, never twice |
| **03 Micro** | JetBrains Mono 400, 10px, tracking 0.20em, lowercase, 34% | **once in six acts** |
| *the action* | editorial size and weight, one hairline | twice — Act I and Act VI's second beat |
| *the wordmark* | Aboreto 400, 16px, tracking 0.42em — the standing brand rule | **once**, in Act I |

**Three roles survived contact with six acts, and that was the open question.**
§L of the previous study named it: "across eleven chapters — a process ledger,
a case study, a contact section — it is an untested claim". The Proof act is
where a fourth role was expected to be demanded, and it was not: the client
name and the metric label are the editorial role, stacked, at two opacities.

### C2 · The two grid uses Direction D did not need

D put every monument on the spine. Six acts cannot: §44 requires six
silhouettes and a spine produces one. Two acts therefore use the same grid
differently, and both use lines the grid already declares.

- **Act II right-aligns its monument to the right margin line at x = 1320.**
  The right margin line already exists in Direction D — it is where
  right-aligned metadata ends and where the hero's dial lands.
- **Act VI centres its monument in the 1 200px field.** The argument is the
  journey rather than the frame: five acts of deliberate asymmetry make a
  centred sixth read as *arrival*, and no amount of space on a spine does that.

Both are recorded as deliberate departures rather than absorbed silently. If
the review rejects either, the act loses its silhouette and §45 has to be
re-judged; that trade is real and it is the reviewer's to make.

### C3 · The monument is allowed to be a figure

Act IV's largest type is `~15M Ft`. This is the one act where the monument is
not a sentence, and it is the reason the act reads differently from the other
five before a single word is read.

### C4 · The scale rule, applied to seven acts and three locales

Unchanged. `fill` per act, ink-area parity per locale, `K = (Σ line advances at
1px) × size²`, two hard clamps at 98% of the field and 210px.

**Neither clamp fires in any of the twenty-one settings.** The system produces
legal frames on its own rather than being rescued by its own guard rails, at
seven acts instead of three.

The fills are not a ramp, and the two extremes are the point:

| act | fill | HU size | why |
| --- | --- | --- | --- |
| I · Ground | **0.64** | 148px | the smallest in the study — §23 taken literally |
| II · Noise | 0.44 | 167px | see below |
| III · System | 0.74 | 162px | unchanged from D2 |
| IV · Proof | 0.52 | 179px | a seven-glyph figure |
| V · High altitude | **0.88** | 174px | unchanged from D3 — the largest, deliberately |
| VI · Arrival | 0.86 | 143px | one 17-character Hungarian word spends the whole fill |
| *VI · Action* | *0.66* | *136px* | *quiet by design* |

**Act II's fill is the one number in the study that had to be set twice, and
the reason is worth recording.** At 0.52 — the same fill as Act IV — it solves
to **198px**, which is larger than the high-altitude frame. That is not a
judgement error, it is the fill rule behaving correctly on a different kind of
sentence: the fill is a promise about the *longest line*, and Act II's longest
line is a six-character word. A short-line stacked composition therefore buys
an enormous point size out of a modest fill. 0.44 puts it at 167px — the
second-largest statement in the study, in a column less than half the width of
any other. **This is exactly the failure mode §12 warns about**: the solver
was about to decide the ranking of the acts, and the art direction had to
overrule it. The rule was not changed; its input was.

---

## D · Width-axis findings

**`six-act/direction-d-width-study.png`. The verdict is: do not use it.**

### D1 · What was tested and how

Three acts — Ground, System, High altitude — at **wdth 96%, 100% and 104%**,
in each act's real composition rather than as a specimen on a card, because
the question is not whether the states differ side by side (they do) but
whether the difference does anything for a frame at the size a visitor meets
it. 92% and 110% are deliberately not in the study: §10 asks for a variation a
designer feels before a visitor identifies it, and those two are obviously
condensed and obviously extended.

The fill, the foot line, the leading, the tracking and every other object are
held. **The only variable in a row is the axis.**

### D2 · The mechanism, which is not the obvious one

Under Rule 1 a narrower face does not set smaller. It sets **larger**, because
the fill is a promise about the line's width and a narrower face reaches that
width at a bigger size. Width buys *height at constant footprint* — which is
precisely the effect §9 hypothesises for the high-altitude frame.

| act | wdth | size | longest line | presence vs 100% | at a fixed size it would set |
| --- | --- | --- | --- | --- | --- |
| **I** | 96% | **153px** | 767px | **103.1%** | 742px at 148px |
| | 100% | 148px | 769px | 100% | 769px |
| | 104% | 141px | 767px | 94.7% | 805px |
| **III** | 96% | **168px** | 889px | **103.7%** | 857px at 162px |
| | 100% | 162px | 889px | 100% | 889px |
| | 104% | 155px | 888px | 95.7% | 928px |
| **V** | 96% | **180px** | 1 055px | **103.3%** | 1 020px at 174px |
| | 100% | 174px | 1 057px | 100% | 1 057px |
| | 104% | 166px | 1 054px | 95.2% | 1 105px |

Every line in every state lands within 3px of the same width — that is the
fill rule working, and it is what makes the rows a fair comparison.

### D3 · The verdict

**Neutral width is stronger. The study ships wdth 100% in all seven acts.**

The hypothesis is directionally correct: at 96% the high-altitude frame is
marginally more monumental, and the mechanism that produces it is real and
measured. It is rejected anyway, on three grounds:

1. **The gain is 3.4% of size.** On the sheet, side by side, at 400% zoom, a
   designer sees it. In a frame, alone, at 1440px, nobody does — including
   designers. §10 asks for a variation felt before it is identified; this one
   is not felt either.
2. **Direction D removed the width axis for a reason that has not changed.**
   §B1 of the previous study: C bought its compactness at wdth 88% and that
   lever was named the least timeless thing in the study. D bought the same
   compactness from the scale solve instead, because it is a property of the
   system rather than of the letterform. Reintroducing the axis at 96% partly
   reverses that, for 3.4%.
3. **It costs a per-act variable in a system whose portability is its main
   asset.** Direction D is describable in a paragraph. "One family, one
   weight, one width" becomes "one family, one weight, and a width that
   depends which act you are in", which is the kind of rule that decays first
   when nobody is maintaining it.

### D4 · What is worth keeping from it anyway

**96% is now a calibrated lever rather than an unknown.** It is the only
control that increases monument height without increasing footprint. If a
future locale or a longer statement ever needs 3–4% more presence at a fixed
line width, the value is measured and recorded here, and it does not require
another study to find it.

### D5 · A tooling limit that will bite production, and how it was handled

`CanvasRenderingContext2D` accepts only the CSS width **keywords**. Setting
`ctx.fontStretch = '96%'` is **silently discarded** and the context stays at
`normal` — the exact class of failure §J3 of the previous study was written
about. The DOM honours the percentage; the canvas does not.

So the solve measures **advances at the real axis in the DOM**, and measures
the painted-ink clearance constant at `normal`, and the width study holds
leading constant across its three states — which is the correct experiment
regardless, since a row in which both the axis and the leading moved would not
say which one did the work. The clearance constant was additionally measured
at the two flanking keywords the platform *will* honour, to bound the
assumption rather than make it:

| statement | semi-condensed (87.5%) | normal (100%) | semi-expanded (112.5%) |
| --- | --- | --- | --- |
| `Magasságot` / `építünk.` | −0.905 | −0.905 | −0.910 |
| `Hat terület,` / `egy rendszer.` | −0.725 | −0.675 | −0.725 |
| `Innen már látni` / `a görbületet.` | −0.735 | −0.735 | −0.730 |

**Across ±12.5% of width the constant moves by at most 0.05em**, so across the
±4% the study tested it moves by under 0.016em — well inside the 0.12em
clearance target. The assumption is safe, and it is now bounded rather than
assumed. `shoot-six.mjs` asserts the rendered `font-stretch` against the value
the solve measured at, and fails the run on a disagreement.

---

## E · Altimeter appearance map

**Two meaningful appearances in six acts**, against §34's ceiling of three or
four.

| act | appearance | treatment |
| --- | --- | --- |
| **I · Ground** | **strong** | 229px dial, face-on, presented. Right edge on the right margin line, fully inside the frame. **202px of measured air** between the end of the statement and the start of the dial (170px in English, 263px in German). Five objects, and the statement is the first read. |
| II · Noise | **absent** | §17. The act is typography and atmosphere. |
| III · System | **absent** | Built and cut — §I3. |
| IV · Proof | **absent** | The material in this act is real work. |
| V · High altitude | **absent** | §29. No trace, no dial, no reference. |
| **VI · Arrival** | **the return** | 200px dial — recognisably the same object, not the same appearance. Square-on, the lowest key of the three plates, centred, **below** the statement and low in the frame, with 151px of air between them and the largest void in the act above it. |
| *VI · Action* | *absent* | |

**Why two rather than §34's suggested three.** §21 permits a restrained System
appearance and also says to remove it if the scene is stronger without it. It
was built properly — a different pose, a 155px dial, its right edge on the
right margin line and its centre on the monument's own last baseline — and it
is still the wrong object in the right place: it terminates a composition that
was already finished, and it pulls the eye off a statement whose entire job is
to be the first read.

**German decided it, and that is the part worth keeping.** `Sechs Bereiche,
ein System.` sets the widest line in the whole study at 1 027px, which leaves
**17px** between the end of the statement and the start of the dial — against
155px in Hungarian. An object that has room in one language and none in
another is not restrained; it is lucky. `six-act/six-act-decisions.png` shows
both frames.

**Altitude information (§35).** The concept survives; its visual insistence
does not. One `27 000 m` in six master frames, in the one act whose sentence
is itself a measurement about the atmosphere. Act VI has no altitude label at
all — by the arrival the instrument states it better than a label can.

---

## F · Yellow appearance map

**One yellow event in the six master frames. Two in the whole study.**

| act | yellow | |
| --- | --- | --- |
| I · Ground | **none** | The hero does not need it to prove itself (§16). The action is neutral, at editorial size, with one hairline. |
| II · Noise | **none** | |
| III · System | **none** | Not even a small signal. |
| **IV · Proof** | **`~15M Ft`** | The only yellow in the master sheet, on the only object in the study that is a fact rather than a sentence. The client name, the metric label, the six marks and the capture all stay in the monochrome palette. |
| V · High altitude | **none** | §30. |
| VI · Arrival | **none** | Arrival is a state, not an offer. |
| *VI · Action* | *the action* | *A line of type with a rule under it, at editorial size, at weight 400. No panel, no card, no fill.* |

**Four consecutive master frames with no yellow before the figure, and one
more after it.** In the sixteen-frame storyboard the gap is nine frames before
the first yellow and five between the two.

One implementation note that is not cosmetic: the yellow is scoped to
`.monument.figure`, not to `.a4 .monument`. The broad selector was written
first, and it turned the Proof act's *crossing fragment* yellow in the
storyboard — a second yellow event appeared in a study whose whole argument is
that there is one. The yellow belongs to the figure, so it is addressed to the
figure.

---

## G · Act I — Ground

**`six-act/a1-hu.png`.** `Magasságot` / `építünk.` · 148px / 1.03 · fill 0.64 ·
foot baseline 548 · five objects · 202px of isolation · largest void 1440 × 196.

Direction D's hero, with one thing changed and one thing not.

**Not changed: the composition, and deliberately.** D1 was already the frame
§13 describes — restrained identity, one monumental statement, one short
support line, one restrained action, the instrument as a precision object. It
is also the study's smallest fill, which is §23 enforced by arithmetic: the
hero's authority comes from the field around it rather than from competing
with Act V.

**Changed: how the instrument is photographed.** §O. The dial is 229px, its
right edge on the right margin line, and it is no longer desaturated to grey
or dimmed to 94% — it is lit so that it does not need to be. That is the whole
of §15's presentation study landing in a frame: the difference between the two
plates on `six-act/altimeter-luxury-study.png` is what separates *a dashboard
widget* from *an isolated precision artefact*, and it was a lighting problem
rather than a modelling problem.

**Why the frame is a luxury campaign rather than a premium landing page**, in
the terms §13 asks for: four of the five objects are on architectural lines
the eye can name, the fifth has 202px of nothing around it in every direction,
there is no navigation, no eyebrow, no altitude, no second CTA, no annotation
column and no premise line above the statement. The reading order is
statement → space → instrument → the quiet band at the foot, and it is
measured rather than hoped for.

---

## H · Act II — Noise

**`six-act/a2-hu.png`.** `Idelent` / `minden` / `zajos.` · 167px / 0.94 ·
fill 0.44 · foot baseline 600 · **two objects** · **largest void 43.0%,
792 × 704** — the biggest single silence in the study.

This act had to be substantially different from the hero (§17) and must not
achieve *noise* by adding noise (§17 again). One decision does both.

**The statement is right-aligned to the right margin line and set on three
lines.** The result is a tall narrow column hung from the top of the frame,
against the hero's wide block sitting on its foot. Compression becomes a
property of the setting rather than an effect added to the picture, and the
act gets the vertical tension and the edge relationship §18 asks for without a
single new object.

**No instrument, no altitude, no second line of support.** The supporting line
is `cloudEntry.note.d` — *"Ez a réteg mindenkinek ugyanolyan sűrű."*, six
words — rather than `cloudEntry.body.b`, which is two sentences and a
conclusion. It sits at the bottom left, as far from the statement as the frame
allows, and the diagonal between them is the composition.

**The atmosphere is one tonal move.** Act II is the only frame in the study
whose light is at the *foot*: a density gathering under the statement.
Everything else either sits on flat near-black or lifts at the horizon.
Reading the six in order, this is the only frame that gets heavier.

**The rejected setting is worth looking at.** `six-act/y1.png` — the same
statement on two lines, 165px, **99.7% of the presence**. Presence does not
decide this one; it is inside the noise. The frame decides it: on two lines
the act is a wide block on the right and reads as the hero mirrored; on three
it is the only silhouette in the six that no other act comes near. German is
`six-act/y2.png` and behaves the same way.

---

## I · Act III — System

**`six-act/a3-hu.png`.** `Hat terület,` / `egy rendszer.` · 162px / 0.94 ·
fill 0.74 · foot baseline 662 · **three objects**.

### I1 · Simplified further, as §19 asks

Direction D's system frame had four objects: an altitude, a two-sentence
explanatory line, the monument and the six disciplines. This one has three.

- **The altitude is gone.** §29's test — if it disappears, is the composition
  less understandable? No.
- **The explanatory line is the second sentence only**: *"Egy sorrend, amiben
  egymásra épülnek."* The first sentence — *"Nem hat különálló szolgáltatás,
  amiből választani lehet."* — restates in twelve words what the 162px monument
  above it says in four. Split at its own sentence boundary, which is the
  operation `messages.ts` already performs on five other paragraphs.

The first read is `HAT TERÜLET, EGY RENDSZER.` and only afterwards the
structure — which is what §19 asks for and what the object count now enforces.

### I2 · The six areas, and why they are a colophon

They are real business information and the frame is not allowed to pretend
they do not exist (§20). They are set as **one running line at the foot,
separated by middots, in the editorial size at 40% opacity**. Not cards, not
six equal boxes, not dashboard rows, not glowing labels, not a rule with a row
under it — a six-across row on an even grid is a navigation bar wearing a
different hat. A colophon reads as evidence of a system; it cannot compete
with a 162px monument; and it takes one line.

### I3 · The Altimeter decision

Recorded in §E and photographed on `six-act/six-act-decisions.png`. Act III
ships without it, on the composition in Hungarian and on 17px of clearance in
German.

### I4 · The honest weakness

**Act III has the least silhouette of its own.** At 240px it is the closest
frame to Act V — both are a left-aligned statement on the spine with one quiet
line. They separate on height and mass (III sits across the middle with a
colophon under it; V lies along the foot at 174px with its quiet line thrown to
the opposite corner and 256px of nothing between them), and they do separate —
but this is the pair a reviewer should look at twice, and removing the
instrument made the margin thinner rather than thicker. It is still the right
trade: an object that only works in one language is not a silhouette, it is a
coincidence.

---

## J · Act IV — Proof

**`six-act/a4-hu.png`.** `~15M Ft` · 179px / fill 0.52 · foot baseline 440 ·
**four objects** · covered 35.6% — the densest act in the study, deliberately,
because it is the one whose job is evidence rather than atmosphere.

### J1 · The monument is the figure

There is no headline sentence in this act. `selectedWork.title` — *"Akikkel
együtt emelkedtünk."* — is good copy and it would be a second voice in a frame
whose dominant thought is a number. It survives in the act's scroll stages; it
is not in the act's strongest still. **This is the one act in six where the
largest type is not a sentence, and it is what makes the act read differently
before a word of it is read.**

### J2 · The metric, and what it is allowed to mean

`~15M Ft`, with `Szerződött projektérték keresésből` under it. **The meaning is
`content.ts`'s, word for word.** It is not called revenue, not profit, not
ROAS-generated revenue, and not attributed to advertising alone — the source
sentence says paid and organic search together produced roughly fifteen
million forints of *contracted project value*, and the label says exactly that
in all three languages.

It is also the one figure in the study that **does not translate**: seven
glyphs, identical in HU, EN and DE, so all three locales solve to the same
179px and Rule 2 has nothing to do. That is a property of the content rather
than a failure of the rule, and it is the only place in twenty-one settings
where three locales share a size.

### J3 · The composition

Three registers and one silence. The six marks run quietly across the top; the
figure holds the upper left; two quiet lines sit under it; the capture rises
from the lower right and is cut by two edges of the frame. **The bottom left is
empty on purpose** — 696 × 468 of nothing, in the densest act.

§27 rejects image-above-text and image-beside-text. This is neither: the type
and the image occupy opposite diagonals and meet at one corner, and the
reading order is marks → figure → definition → evidence.

### J4 · The collaboration marks

A proof plate, not a client wall. One line, six marks, 30% opacity, masked to
a single flat value so that six files with six backgrounds read as one
material, and **optically sized rather than mechanically sized** — three
heights (17 / 25 / 29px) chosen so that a 4:1 wordmark and a 1:1 emblem read
as one weight rather than as two sizes. No heading above them, no carousel, no
`OUR CLIENTS`. They occupy very little attention, which is the whole
instruction.

### J5 · The capture, and the one thing that had to be solved

At its own ratio, cropped by the **frame** rather than by a box: it runs off
the right edge and off the foot, so it reads as a fragment of something larger
rather than as a card in a portfolio grid. Nothing is scaled non-uniformly and
nothing is windowed to a fashionable ratio — `content.ts` records that this
image cannot be cropped to 4:5 without losing the cross-section, which is the
project.

**The problem the mask solves is not softness, it is a second headline.** The
capture is a screenshot of a website, so it carries its own display type
across its own upper left — a second voice, in the act whose dominant thought
is a figure. The inner-edge mask is therefore *deep* (a ramp to 64% of the
plate's width) rather than a narrow feather: it sinks that half of the picture
into the field and leaves the thing the project actually is — the interactive
cross-section of the garden and the ground under it. This is a real limitation
of using a product screenshot as proof material and it is recorded in §P4.

---

## K · Act V — High altitude

**`six-act/a5-hu.png`.** `Innen már látni` / `a görbületet.` · 174px / 0.94 ·
fill 0.88 · foot baseline 748 · **three objects** · largest void 1440 × 256.

**Unchanged from D3.** Same statement, same authored break, same fill, same
foot line, same size, same 1 057px longest line, same three objects, same
counter-axis for the quiet line, same single altitude reading, same grey tonal
step in the monochrome sheet. §55 makes weakening this frame a failure
condition and it was not touched.

**No instrument, and no trace of one.** §29 asks the high-altitude scene to
prove the identity is stronger than the 3D object, and the way to prove that is
for the object not to be there.

**It survives near-monochrome, which §30 requires.** The monochrome sheet is
the primary version; the colour sheet adds a limb glow low in the frame — wide,
very faint, with **no edge anywhere in it** — and no horizon rule. A drawn
horizon is a rule, and a rule that has to dodge a 174px statement in three
locales is decoration pretending to be structure. It was set and cut in the
previous study for the same reason and it stays cut.

**German is why the frame holds.** `Von hier aus ist` / `die Krümmung` / `zu
sehen.` sets at 144px on three lines and holds 100.0% of Hungarian's presence.
The empty middle is what gives it room for the third line without the frame
becoming crowded.

---

## L · Act VI — Arrival

Two beats, not one block. §31 is explicit that the previous homepage's mistake
was turning the final scenes back into a landing-page CTA, and the fix is that
arrival and conversion are **separate frames**.

### L1 · The arrival — `six-act/a6-hu.png`

`Üdv a` / `sztratoszférában.` · 143px / 0.94 · fill 0.86 · foot baseline 386 ·
**two objects** · 151px of isolation.

The sparsest frame among the six and the only symmetrical one. The statement
sits in the upper half; the instrument returns square-on, centred, low, with
the act's largest void between them; the field is the darkest and coldest in
the study, with the thinnest limb under it. Nothing else is in the picture —
no altitude, no supporting line, no action.

**Why centred.** Five acts of deliberate asymmetry are what make a centred
sixth read as the composition coming to rest. It is also the cue that
separates Act VI from Act I at 240px, and a second left-spine composition with
an instrument in it would have failed §45 outright.

**Why the instrument is 200px rather than 229px.** Recognisably the same
object, and not the same appearance: different position, different axis,
different key, and 29px smaller. §34's "completion, not repetition".

**One number in this act was set by a glyph.** At foot line 376 the Hungarian
block's *box* clears the top margin and its **Ü does not** — the umlaut is the
tallest ink in the study and it reached y = 116 in a frame with a 120px margin.
The audit measures ink rather than boxes, so this was a failed run rather than
a frame that shipped 4px outside its own frame. The foot line is 386.

### L2 · The action — `six-act/a6b-hu.png`

`Készen állsz` / `felemelkedni?` · 136px / fill 0.66 · **two objects** ·
largest void 1440 × 300 — **the emptiest frame in the entire study**.

One direct question and one action, and nothing else. No giant yellow panel,
no card, no modal, no busy footer, no second CTA, no list of altitudes
covered, no contact paragraph. The action is a line of type with a hairline
under it, at the editorial size, at weight 400; in the colour pass it is the
study's second and last yellow.

It sits on the **same architectural band Act I used for the same invitation**,
at the counter-axis, y = 648. The rhyme is deliberate — the ascent opens and
closes with the same sentence in the same place — and it is available
precisely because this frame is not one of the six competing in §44's
silhouette test.

**The CTA is important here because nothing competes with it.** That is §33's
own sentence, and it is the only mechanism this frame uses.

---

## M · Locale implications

### M1 · Equivalent authority, different geometry — as a number

`six-act/six-act-locales.png`. Eighteen monuments across the six master acts,
in three languages. **No two share a font-size except the three that are the
same seven glyphs.** All eighteen sit **within 0.8% of ink-area parity**
(99.3% – 100.8%). Neither clamp fires anywhere.

| act | HU | EN | DE |
| --- | --- | --- | --- |
| I | 148px · 2 lines | 137px · 2 | **170px** · 2 — the shortest statement sets largest |
| II | 167px · 3 | 139px · 3 | 161px · 3 |
| III | 162px · 2 | 169px · 2 | 150px · 2 — **1 027px, the widest line in the study** |
| IV | 179px | 179px | 179px — the figure is not translated |
| V | 174px · 2 | 151px · 3 | 144px · 3 |
| VI | 143px · 2 | 128px · 2 | 122px · 2 |

### M2 · German is the stress locale and is no longer the binding one

It is the widest in Act III, the longest in Act V, and it holds full presence
in both — at its own size, on its own line count, on the same foot lines.
Nothing in the system was reduced to accommodate it, and the one place it
*did* decide something, it decided a removal rather than a compromise: the
System act's instrument (§E).

### M3 · The locale finding that is new in Phase 2

**Hungarian is now the binding locale in one act, for the first time.**
`sztratoszférában.` is a single seventeen-character word, and a fill is a
promise about a line — so Act VI's fill has to run at 0.86 to produce a 143px
statement, where Act I produces 148px at 0.64. The rule handles it without a
special case; the *art direction* has to know that a long compound word costs
fill rather than size, and Act VI is the frame where that is visible. German,
whose compounds are the usual suspects, is the smallest in this act at 122px.

### M4 · What the content layer would have to carry

Three things, none of which changes a word:

1. **Authored per-locale line breaks.** Direction D's four (§I5 of
   `03-direction-d.md`) still apply, plus **three new ones in Act II** — the
   three-line stack in HU, EN and DE. These belong in `messages.ts` as
   authored breaks, not in CSS and not left to the browser.
2. **`lowerAtmosphere.lead` used as its second sentence only** in the System
   keyframe. A key split, exactly like `calibration.note.a` / `.b` and the
   four other paragraphs `messages.ts` already splits at sentence boundaries.
3. **`selectedWork.title` not rendered in the Proof act's peak frame.** It
   remains in the act.

### M5 · One thing the acts break that the narrative does not

§4's six acts are art-direction groupings, and they are **not** the altitude
ladder. Act II is `cloudEntry` at 6 000–8 500 m and Act III is
`lowerAtmosphere` at 3 000–6 000 m, so as the six acts run the altitude goes
*down* by 2 500 m between them. The background therefore progresses by
**density** — dense, clearing, deep, distance, ceiling — rather than by
altitude, and neither act states an altitude, so nothing in any frame
contradicts anything. At implementation time this becomes a real decision and
it is recorded in §P1.

---

## N · Mobile translation notes

**No mobile screens were designed** (§50). What follows is what each master
frame asserts about its own portability, stated per §50's five questions.
Mobile stays native document scroll, lightweight, no new heavy rendering, no
layout feedback loops.

**The one system-level finding first.** The desktop study puts the Altimeter
in two of six acts. The mobile route currently mounts `AltimeterInstrument` as
a **persistent overlay** at the foot of `MobileHome`. Those two facts are
incompatible as art direction: an object that is present in 100% of mobile
frames and 33% of desktop ones is not the same object in the two designs. This
is the largest mobile consequence of the study and it is a decision, not a
detail — §P2.

| act | survives | disappears | Altimeter | line count | needs sticky choreography? |
| --- | --- | --- | --- | --- | --- |
| **I · Ground** | statement, wordmark, one support line, one action | nothing | **yes** — it is the one appearance mobile should keep, in flow under the statement rather than beside it | 2 → **3** in HU and EN at a phone measure; German stays 2 | **no.** Four objects in a column is a static composition |
| **II · Noise** | statement, one support line | nothing | no | 3 lines is already the phone shape — it may go to 4 in EN | **no.** The right-alignment is the one thing that does not survive: at a 5.5vw margin a right-aligned monument reads as an accident. It should return to the spine, and the act then loses its silhouette to Act I on mobile, where six-across silhouettes are not being judged |
| **III · System** | statement, one support line, the six disciplines | nothing | no (already absent) | 2 → 3 | **no.** The colophon becomes a stacked list, and that is the one place mobile is allowed a shape desktop refused: a vertical list at a phone measure is not a dashboard row |
| **IV · Proof** | figure, client name, metric label, capture, marks | nothing, but the **order changes**: marks move below the figure rather than above it | no | 1 line, unchanged — the figure is the same seven glyphs at every width | **no.** The diagonal becomes a stack, which is the one act where a stack is correct: figure → definition → evidence is already the reading order |
| **V · High altitude** | statement, one support line, the altitude | nothing | no | 2 → **3 or 4** in HU; 3 → 4 in DE | **no**, and this is the frame that proves it. Two bands and a void is a scroll shape before it is a viewport shape |
| **VI · Arrival** | statement, instrument | nothing | **yes** — the return | 2 → 3 in HU | **no.** Centred survives a phone better than any other composition in the study |
| *VI · Action* | *question, action* | *nothing* | *no* | *2 → 3* | ***no*** |

**What this says overall.** Not one of the seven frames requires sticky
choreography, a pinned scene or a scroll-driven layout to work as a still.
Every one is a column of two to five objects with authored line breaks and a
solved size. The two things that genuinely do not translate are Act II's
right-alignment and Act IV's diagonal, and both degrade into the correct
mobile shape rather than into a broken one.

**One thing to watch.** The mobile route already scales monuments through
`--mv-monument` on top of a `clamp()` ladder. If the solved-scale approach
ships, mobile needs the same rule applied at its own field width rather than a
second, unrelated sizing system — otherwise the two surfaces will disagree
about which locale is largest, which is exactly the defect Rule 2 exists to
prevent.

---

## O · Altimeter material findings

**`six-act/altimeter-luxury-study.png`. Presentation study only. Production is
untouched:** the GLB, its materials, `components/MeridianLights.tsx` and
`scene.ts` were read and never written. Both plates are renders of the shipped
`public/models/stratos-altimeter.glb` in the same pose at the same dial size on
the same field. What varies is what a photographer varies.

### O1 · The finding

**The instrument's gaming / tech-object character is mostly a property of how
it is lit, not of the model.** Four changes, applied one at a time so the sheet
shows which did the work:

| | change | what it does |
| --- | --- | --- |
| **B** | ambient 0.50 → **0.14**, fill 1.7 → **0.70** | **The largest single step.** At 0.50 there is no true black anywhere on the object: the ambient fills the housing's interior and its shadow side with an even blue, so the form is read from tone rather than from light — which is the render signature of a game asset rather than of a photograph |
| **C** | 28° → **17°** lens at a matched distance, exposure 1.06 → **0.95** | 28° over an object this small is a wide lens; it bows the bezel and spreads the dial's perspective. The machined highlights stop blooming |
| **D** | key 5.4 → **4.2** and neutralised (`0xeef4ff` → `0xf2f5f9`), rim 2.4 → **3.2** | A cold-blue key on a dark object is a large part of what reads as *futuristic interface*. Handing the separation to a neutral rim draws the housing's edge against a near-black field **without raising exposure to do it** |

### O2 · The second half of the finding, which is about the frame rather than the render

Direction D applied `grayscale(1) brightness(1.04) contrast(1.02)` at
**opacity 0.94** to stop the instrument competing. Both are corrections
applied to a lighting problem instead of to its cause. Lit as above the plate
needs **neither**: it is carried at full opacity, with a small contrast lift
and a partial desaturation that holds it inside the monochrome palette, and it
looks more expensive at full strength than it did faded. *Fading an object is
how you make it recede when it is too big; it is not how you make it precious.*

### O3 · Does the instrument itself need a dedicated material pass?

**Not urgently, and that is the useful answer.** §15 asks for this to be
reported explicitly if the object becomes the limiting factor. It did not: the
same asset, re-lit, moves from *dashboard widget* to *machined object* without
a single change to its materials. Three smaller things are worth banking for a
future pass, none of which blocks implementation:

1. **The needle reads zero in every still.** Correct for Act I at 0 m and
   semantically wrong for Act VI at 30 000 m. In production the live scene
   drives the needle, so this is a limitation of a static study rather than a
   design decision — but any future *static* use of the instrument (an OG
   image, a press plate, the reduced-motion fallback) needs a posed needle.
2. **A bright indicator arc on the upper bezel catches the rim light** at
   turned-away angles. It is why Act III's rejected plate was re-posed from
   ry −0.40 to −0.28. A material pass could reduce its specularity.
3. **The dial face itself contributes almost nothing at 200–229px.** The
   numerals and the `ALTITUDE` / `STRATOS` legends are below legibility at the
   sizes this art direction uses. If the Altimeter is only ever going to appear
   twice and small, the model is carrying detail nobody sees — which is a
   performance argument as much as an aesthetic one.

---

## P · Risks and limitations

### P1 · The act order and the altitude order disagree

§M5. Act II is 2 500 m *above* Act III in the narrative and *before* it in the
six acts. The frames hide it — neither states an altitude — but implementation
cannot: either the homepage's stage order changes to match the acts, or the
acts are re-mapped onto the existing order, or the altitude readout stops being
monotonic somewhere a visitor can see it. **This is the first thing to decide
and it is a content decision, not a design one.**

### P2 · The mobile Altimeter is currently in every frame

§N. Two appearances in six acts on desktop against a persistent overlay on
mobile is not one design. Resolving it is a real piece of work on the mobile
route and it is not a detail of this study.

### P3 · Act III has the thinnest silhouette

§I4. It is the closest frame to Act V at 240px, and removing its instrument
made the margin thinner. If the review disagrees with the removal, the
instrument is available and `six-act/a3-hu-inst.png` is what it looks like —
but the German clearance figure (17px) does not improve with an opinion.

### P4 · The proof image is a screenshot with its own headline on it

§J5. The mask sinks it and it is still legible at 1440px. **The real fix is a
dedicated art-directed capture of the cross-section**, which does not exist
today and is not this phase's to make. Until then, Act IV contains two pieces
of display typography and only one of them is Stratos's.

### P5 · The solver nearly designed the study once

§C4. Act II at a fill consistent with the other acts produced a 198px monument
— larger than the high-altitude frame — and the ranking of the acts would have
been decided by arithmetic. It was caught by looking at the number, not by an
automated check. **There is no test that would have caught it**, and the same
class of error is available in every future act whose statement has an unusual
line-length distribution.

### P6 · The machinery is now larger

Direction D's cost was a build step that writes a CSS file. This study adds a
width-axis parameter that the canvas cannot measure (§D5), a second stylesheet
for the colour pass, and an audit that measures ink rects rather than boxes.
All of it is study-only code today. If the approach ships, `solve-*.mjs` and
`shoot-*.mjs` have to run when copy changes and stay in CI, or the system
decays into the fixed pixel values it exists to avoid.

### P7 · Six frames is still where minimalism looks easy

The same caution the last two studies raised applies undiminished. Six acts is
twice three, and it is not eleven chapters, a process ledger, an FAQ, a
case-study route or a contact form. **The three type roles held across six
acts and one figure. They have not been tested against a table.**

### P8 · Two departures from Direction D's grid

§C2. Act II's right alignment and Act VI's centring are the two places the
study spends Direction D's consistency to buy §44's silhouettes. Both are
defensible and both are reversible; reversing either costs that act its
distinctness at thumbnail scale.

---

## Q · Recommendation

### The six-act system is strong enough to implement, and the honest form of that sentence has a condition attached.

**What the study set out to prove, and did.**

1. **Direction D carries the whole homepage, not just three test scenes.**
   Three type roles, one family, one weight, one width, one margin, two axes
   and a solve — across six acts, one figure, two non-type materials and three
   languages, with **twenty-one settings, no clamp firing anywhere, and every
   locale within 0.8% of parity.** The fourth role that was expected to be
   demanded by the Proof act was not demanded.
2. **The six frames have six silhouettes.** `six-act/six-act-distance.png` at
   240px, in monochrome, in colour and in German. Four separate instantly; III
   and V are siblings and separate on mass; I and VI separate on the centred
   axis. Nobody would call this sheet a template.
3. **The compositions do not need colour.** They were built and judged in
   monochrome and the colour sheet is the same markup with one class added.
   Colour improves them; it is not carrying them, which is what §47 asked.
4. **The reductions are real and counted.** 45% fewer supporting words per
   frame, 37% fewer supporting objects, the altitude reading one third as
   often, the Altimeter in two acts of six, and yellow once in the six master
   frames after four consecutive frames without it.
5. **D3 was not weakened.** Act V is D3, unchanged, and it is still the best
   frame on the sheet.
6. **The instrument's tech-object character was a lighting problem.** §O. That
   removes what would otherwise have been the biggest open risk in the phase,
   and it removes it without touching production.

**Against §55's failure conditions**, one at a time: the Altimeter dominates
one frame of six · yellow appears once in six · one frame of six carries a
micro label · no two acts share a silhouette · the emptiest frame in the study
is the one with the CTA in it · Rapidkert is cut by two edges of the frame and
carries no card, no border and no button · the System act is a colophon and a
statement · Arrival is a state with the offer held back to its own frame ·
the monochrome sheet is the primary sheet · Act V is untouched. **None of the
ten fires.**

**The condition.** §P1 is not a design risk, it is a blocking content
question: *the six acts do not run in altitude order.* It costs nothing to
answer now and it is expensive to answer after the scroll choreography has been
rebuilt around six acts. Nothing else in this document should start until it
has an answer.

**What I would decide next, in order.**

1. **Answer §P1.** Re-order the stages, re-map the acts, or accept a
   non-monotonic altitude and say where.
2. **Accept or reject the two grid departures** (§C2). They are the only
   places the study spends Direction D's consistency, and both are cheap to
   reverse now and expensive later.
3. **Accept the width-axis verdict** (§D3): neutral, everywhere, and 96%
   banked as a calibrated lever rather than used.
4. **Accept the Altimeter budget of two** (§E), or reinstate the System
   appearance knowing what German costs it.
5. **Decide the mobile Altimeter** (§P2) before anything is implemented on
   either surface, because the two designs currently disagree.
6. **Commission a dedicated Rapidkert capture** (§P4). It is the only asset
   this art direction wants and does not have.
7. **Sketch one non-act surface in this system before committing** — the
   process ledger or the case-study route. §P7 is the same untested claim the
   last two studies ended on, and six frames has not retired it.

**What I would not do.** Reopen the serif question — §L of the previous study
already found that Direction D has enough authority without one, and six acts
did not change that. Add a fourth type role. Add a third Altimeter appearance
because the budget allows it. Or fill the bottom left of Act IV, which is the
single most valuable empty rectangle in the study.

---

## Stop here

Nothing in this study has been implemented. No production HTML, `styles.css`,
`mobile.css`, `scene.ts`, `composition.ts`, scroll logic, Altimeter code,
production font, message or deployment configuration was modified. The GLB and
`MeridianLights.tsx` were read and never written. Nothing has been pushed,
merged or deployed.

**Awaiting human visual review.**

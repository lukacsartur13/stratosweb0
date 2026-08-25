# The six-act art direction, implemented

**Phase 3. Production. The approved static art direction is now the homepage.**

No new direction was created, no typography study was reopened, no second
Altimeter concept was drawn and no alternative six-act structure was proposed.
`03-direction-d.md` and `04-six-act-master-study.md` were treated as supplied
art direction and reproduced. Nothing has been pushed, merged or deployed.

| | |
| --- | --- |
| `05-production-implementation.md` | this document, §A–§M |
| **`production/after/sheet.png`** | **the seven frames and the four crossings, as the page renders them, 1440 × 900** |
| `production/before/sheet.png` | the same eleven positions on the homepage this replaces |
| `production/after/viewports.png` | Acts I, III, IV, V, VI at 1920 × 1080, 1280 × 800 and 1024 × 768 |
| `production/after/locales.png` | Acts I, II, III, V, VI in German and English — the authored breaks and the locale-solved sizes, on the page |
| `production/after/mobile-sheet.png` | the acts at 390 × 844 |
| `production/after/bodies.png` | what three acts carry beneath their frames |
| `production/after/reduced-motion-*.png` | the reduced-motion path |
| **`production/after/master-vs-production.png`** | **the seven approved frames beside the seven the page renders** |
| `production/journey-scan-hu-1440x900.json` | 121 samples down the whole track — §49 |
| `production/act-cost.json` | draws, triangles, frame time and style/layout counts per act |
| `production/playwright-full.json` · `playwright-site-homepage.json` | the two gates' machine-readable results |
| `production/frames-hu-*.json` | the altitude and stage each captured frame settled at |

New source of truth: **`experiments/src/full/acts.ts`**. The six acts, the
grid, the solved monument settings per act per locale, the Altimeter appearance
budget and the yellow budget, transcribed from the study and read by the page,
the stylesheet and the regression suite.

---

## A · Current → six-act mapping

An act is a **grouping over the existing stages**. None of the eleven chapters
was deleted, renamed or moved, and no altitude band changed.

| act | peak stage | altitude | crossings under it |
| --- | --- | --- | --- |
| **I · Ground** — `Magasságot építünk.` | `calibration` | 0 – 150 m | — |
| **II · Noise** — `Idelent minden zajos.` | `initial-ascent` | 150 – 3 000 m | — |
| **III · System** — `Hat terület, egy rendszer.` | `lower-atmosphere` | 3 000 – 6 000 m | `cloud-entry` · `cloud-breakthrough` |
| **IV · Proof** — `~15M Ft` | `selected-work` | 11 000 – 17 000 m | `system` · `process` |
| **V · High altitude** — `Innen már látni a görbületet.` | `stratosphere-transition` | 25 500 – 28 000 m | — |
| **VI · Arrival** — `Üdv a sztratoszférában.` | `full-stratosphere` | 28 000 – 30 000 m | — |
| *· Action* — `Készen állsz felemelkedni?` | `destination` | 30 000 m | — |

**What a peak frame is, structurally.** One sticky screen holding an absolutely
composed field, inside a hold box `ACT_HOLD` screens tall, so the frame is
pinned and still for 0.8 of a screen before it releases. Anything the act
carries beyond its frame flows underneath it in `.act__body`.

**What a crossing is.** The `Panel` this page has always used — the rails, the
measured copy budget, the reverse-gravity pass — with its monument tier stepped
down in `scene.ts`. Every word it had, it still has.

### A1 · What moved out of the frames, and where it went

| | was | is |
| --- | --- | --- |
| `calibration.title.a`, `note.a`, `note.b`, `meta` | four objects in the opening column | one `sr-only` paragraph in Act I. Premise and an instrument caption — prose about the page, not business information |
| `initialAscent.title` | Act II's statement | the `cloud-entry` crossing's statement |
| `cloudEntry.title` | the cloud-entry chapter's statement | **Act II's monument** — see §B |
| `lowerAtmosphere.lead` | one two-sentence paragraph | split at its own sentence boundary. `.b` is Act III's quiet line; `.a` is in the act's body |
| `selectedWork.title` | the Proof chapter's headline | the `<h3>` that opens the Proof act's body — §J1 of the study |
| the six capabilities | a ladder of six blocks in the frame | a colophon in the frame, the ladder in the body |
| `destination.lead`, the contact line, the altitude index | under the closing question | **Act VI's body** — see §E7 |
| the second CTA in Act I (`common.cta.work`) | a ghost button beside the primary | removed from the frame; the route is the header's `Munkáink` and Act IV's own |
| `system` (nine areas), `process` (seven checkpoints) | two of the page's largest statements | crossings, in full, at a crossing's scale |

Nothing was rewritten. Every string above is the same string it was, in all
three locales.

---

## B · The altitude chronology fix

### B1 · What was wrong

§P1 of the master study, in its own words: *the six acts do not run in altitude
order.* The Noise act was `cloud-entry` at 6 000 – 8 500 m and the System act
was `lower-atmosphere` at 3 000 – 6 000 m, so a visitor reading the acts in
order descended 2 500 m between the second and the third. §4 of the production
brief forbids that outright and §5 asks for it to be fixed structurally rather
than by hiding the labels.

### B2 · How it was made monotonic

**Two chapters exchanged their statements.** `initial-ascent` (150 – 3 000 m)
took `Idelent / minden / zajos.` and `cloud-entry` (6 000 – 8 500 m) took `Egy
weboldal önmagában nem visz sehova.` Their horizon fragments — `Zaj.` and `Egy
alkatrész.` — exchanged with them, because a fragment is lifted from its own
chapter's title.

That is the whole of it. **No altitude band moved. No stage was reordered,
renamed or removed. No word of any string in any locale changed.** The acts now
run in stage order, so the readout is monotonic by construction rather than by
tuning, and `six-acts.spec.ts` asserts it twice — once against the map and once
against the running page.

**It also reads better than what it replaces.** `Idelent minden zajos.` — *down
here everything is noisy* — is a sentence about being on the ground, and it was
set at eight and a half kilometres. `Egy weboldal önmagában nem visz sehova.` is
a diagnosis, and a crossing through the dense layer is where a diagnosis belongs.

### B3 · What was considered and rejected

* **Swapping the two stages' altitude bands.** Puts the cloud deck at
  3 000 – 6 000 m and the "lower atmosphere" above it. It moves a validated
  atmospheric model to solve a copy problem, and it makes two stage names lie.
* **Accepting a non-monotonic readout and removing the altitude labels.**
  Explicitly ruled out by §4.
* **Reordering the stage array.** Changes the scroll–altitude mapping, the
  header's edges, the cloud/mountain/camera choreography and every calibrated
  bound, to move two sentences.

### B4 · The shares moved; the altitudes did not

An act's frame is a settled state, and a settled state needs scroll to be
settled in. At a share of 1.0 the opening frame arrived and left in the same
movement and was never composed — the first production capture of this design
shows exactly that. The seven acts are now 1.8 screens or more and the four
crossings are shorter than they were.

Track: **24.0 screens nominal against 21.6**, +11%, and 24.4 as the content
actually measures — for a page the study counts at 37% fewer objects and 45%
fewer supporting words per frame. Every `from` and `to` in `journey.ts` is
unchanged.

---

## C · The Rapidkert asset decision

### C1 · The audit

`assets/img/` contains exactly two Rapidkert files: `work-rapidkert.jpg`
(1454 × 869, the hero capture the case-study route publishes) and
`client-rapidkert.png` (the mark). There is no clean cross-section render, no
uncropped terrain capture, no source frame and no second screenshot anywhere in
the repository, the backups or the build tree. `assets/img/FORRASOK.md` was read
and adds nothing for this project.

### C2 · What was found inside the asset that already exists

The capture carries the Rapidkert site's own display headline — `A GREAT GARDEN
STARTS BELOW THE SURFACE.` — across its upper left, which is the second voice
§7 names and the reason the study needed a mask running to 64% of the plate's
width. It also contains, in its right half, the thing the project actually is:
the interactive 3D cross-section of the garden and the ground under it, **with
no typography on it at all** apart from two of the Rapidkert site's own micro
labels near the right edge.

### C3 · The decision

**`assets/img/work-rapidkert-section.jpg` — a window on the existing frame, not
a new image.** 640 × 458 of the same pixels at the same aspect:

```
x  690 … 1330   left of 690 is `…OW` / `…CE.`, the tail of the headline;
                1330 stops short of `0.00 M`
y  300 …  758   above 300 is the headline's second line; below 758 is
                `SCROLL BELOW THE SURFACE`
```

`scripts/rapidkert-section.mjs` is the derivation, and it is reproducible.
Nothing is painted, retouched, blurred, resampled non-uniformly, downloaded or
generated. The whole capture stays on the case-study route, where it belongs.

**What this buys.** The deep mask is gone. What is left on the plate is an
ordinary edge feather — a 22% ramp on the left and 18% at the top — whose only
job is to stop the picture ending in a straight line against the field. The
block is cut by the right edge and the foot of the frame, which is the reading
§J5 of the study asked for: a fragment of something larger rather than a card in
a portfolio grid.

**The limitation that remains** is in §M.

---

## D · Typography

### D1 · The tokens

Three roles and no fourth, as approved.

| role | setting |
| --- | --- |
| **01 Monument** | Archivo 400, `font-stretch: 100%`, tracking −0.028em, sentence case. Size, leading and vertical position transcribed from `six-act-scale.css` per act per locale |
| **02 Editorial** | Archivo 400, 17u / 1.62, tracking −0.002em, 400u measure, 46% |
| **03 Micro** | JetBrains Mono 400, 10u, tracking 0.20em, lowercase, 34% — **once in the whole page**, in Act V |
| *the action* | editorial size and weight, one hairline. Twice: Act I and the action beat |
| *the wordmark* | the shared header's Aboreto mark. The standing brand rule holds; no second wordmark was added |

### D2 · The one mechanism

```css
--u: min(calc(100vw / 1440), calc(100svh / 900));
```

One reference pixel of the study's frame on this viewport. Every placement in
the design is written in the study's own coordinates and multiplied by it, so
the whole 1440 × 900 field is fitted uniformly and every relationship inside it
is preserved exactly. Deliberately not a breakpoint ladder and not a re-solve:
§18 puts the approved optical scale and the approved placement first and makes
the solver a guardrail.

`composition.ts` computes the same scale in script for the instrument's
placement, and `six-acts.spec.ts` asserts the two agree at three viewports — a
disagreement would put the statement on one grid and the dial on another, and it
is invisible at 1440 × 900 because there both are exactly 1.

### D3 · Font-loading safety — §19

**There is no runtime text measurement on the act path at all.** No
`document.fonts.ready`, no canvas advance measurement, no ink-area solve, no
reflow feedback loop, no retry and no late layout shift. The sizes were solved
once, against real Archivo glyphs, in Phase 2, and are transcribed. The
composition is fully determined before first paint from three numbers and a
`lang` attribute, which is the deterministic pre-paint configuration §19 asks to
be preferred.

The hazard the study exposed cannot occur here, because there is nothing to
measure against the wrong face.

### D4 · Authored line breaks, and where they live

`act.<id>.monument` in `locales/messages.ts`, one key per act per locale, with
the breaks written into the string as `|`. Every one is the break `solve-six.mjs`
solved and photographed.

| act | HU | EN | DE |
| --- | --- | --- | --- |
| I | `Magasságot` / `építünk.` · 148px | `Altitude is` / `what we build.` · 137px | `Höhe` / `bauen wir.` · 170px |
| II | `Idelent` / `minden` / `zajos.` · 167px | `Down here` / `everything` / `is noisy.` · 139px | `Hier unten` / `ist alles` / `laut.` · 161px |
| III | `Hat terület,` / `egy rendszer.` · 162px | `Six areas,` / `one system.` · 169px | `Sechs Bereiche,` / `ein System.` · 150px |
| IV | `~15M Ft` · 179px | `~15M Ft` · 179px | `~15M Ft` · 179px |
| V | `Innen már látni` / `a görbületet.` · 174px | `From here` / `you can see` / `the curvature.` · 151px | `Von hier aus ist` / `die Krümmung` / `zu sehen.` · 144px |
| VI | `Üdv a` / `sztratoszférában.` · 143px | `Welcome to the` / `stratosphere.` · 128px | `Willkommen in der` / `Stratosphäre.` · 122px |
| *action* | `Készen állsz` / `felemelkedni?` · 136px | `Are you ready to` / `ascend?` · 140px | `Sind Sie bereit` / `aufzusteigen?` · 131px |

Every line is `white-space: nowrap`. Without it a line that overruns re-breaks
silently, stays inside the margins and passes every automated check while the
browser quietly rewrites the art direction. `six-acts.spec.ts` counts line boxes
with a `Range` in all three locales — one client rect per authored line, or the
test fails.

### D5 · The width axis

**Neutral everywhere.** `font-stretch: 100%` on every monument in every act in
every locale. There is no per-scene width choreography and nothing animates the
axis. 96% stays a documented emergency lever and is not used.

### D6 · What was retired

* **The kinetic axis choreography.** Three `<em>` anchors animating weight and
  width across the monuments — §16 and §17 close it. `publishKinetic` still
  runs on the tick, quantised, and now writes properties nothing binds.
* **Word-level colour emphasis inside a statement**, on the acts and on the
  crossings alike.
* **The five-tier `clamp()` monument ladder** on the act path. The crossings
  still use it, which is what a crossing is for.

---

## E · The desktop acts, scene by scene

### E1 · Act I · Ground

`Magasságot` / `építünk.` · five objects. The statement on the spine, the
instrument alone in the upper right with its right edge on the right margin
line, one quiet line and one restrained action on a single band across the foot,
and the shared header's mark.

Fill 0.64, the smallest in the design — §21 enforced by arithmetic rather than
by taste. The second call to action, the two premise annotations and the
instrument caption are all out of the frame; three of the four are in the
document, announced.

### E2 · Act II · Noise

`Idelent` / `minden` / `zajos.` · two objects. Right-aligned to the right
margin line at x = 1320, three lines, hung from the top of the frame. No
instrument, no altitude, one quiet line at the opposite corner.

The act's own diagnosis — the Stratos answer and its four parallel clauses —
is in the body under the frame.

### E3 · Act III · System

`Hat terület,` / `egy rendszer.` · three objects. The quiet line crosses to the
counter-axis at the top right, the statement holds the spine below the middle,
the six disciplines run along the foot as a colophon.

**The six areas are one running line separated by middots, not six cards.** §25
rejects the dashboard, the six equal modules and the row on an even grid; the
ladder with its altitudes and its sentences is under the frame, in full. The
colophon is `aria-hidden`, because every word of it is an `<h3>` in the ladder
forty pixels further down the document.

**No instrument.** German's `Sechs Bereiche, ein System.` is the widest line in
the design at 1 027px.

### E4 · Act IV · Proof

`~15M Ft` · five objects. The six marks quietly across the top, the figure
holding the upper left, two quiet lines under it, the two routes out under
those, and the cross-section rising from the lower right cut by two edges of the
frame.

**The figure is the heading**, semantically as well as visually: a screen reader
meets *heading level 2, ~15M Ft* and then, immediately, the client and the
definition. `selectedWork.title` leads the act's body instead.

**Five objects and not four**, which is the study's count. §9 requires the Proof
act to carry a restrained route to the case and a route to all the work, and a
still has nowhere to go. They are at the editorial size, in the editorial
colour, directly under the definition, so the left column reads as one object in
three registers. The bottom left is still 696 × 356 of nothing.

### E5 · Act V · High altitude

`Innen már látni` / `a görbületet.` · three objects. Unchanged from D3: same
statement, same authored break, same fill of 0.88 — the largest in the design —
same foot line at 748, and the largest single void between the quiet line pinned
to the top of the field and the statement lying along the foot.

Carries the one micro altitude reading in the six frames. No instrument, no
trace of one, no horizon rule.

### E6 · Act VI · Arrival, refined

`Üdv a` / `sztratoszférában.` · two objects and the sky. The only symmetrical
frame in the design.

**§12–13's refinement, applied.** The approved arrival was conceptually right
and still read a little like a conventional centred landing page: a statement in
the upper half, an object centred under it, and the pair's centre of mass on the
frame's own mathematical centre line. Three changes, all inside the approved
language:

| | study | shipped |
| --- | --- | --- |
| dial | 200px | **160px** — §13's "slightly smaller instrument" |
| air between statement and instrument | 177px | **200px** — §13's "more vertical separation" |
| the pair's ink centre | y = 450, the frame's mathematical centre | **y = 442**, above it — the optical rather than the mathematical centring |
| silence under the dial | 137px | **154px**, the act's largest void, below the pair rather than around it |

**Nothing was added.** No copy, no label, no yellow, no card, no orbit line, no
technical UI.

One further presentation change, and it is a presentation change rather than a
model one: the instrument's reveal yaw at the arrival is **12° instead of 27°**.
27 was the smallest angle at which the central shaft clears the case, chosen for
a composition where the object was one of several and the visitor had watched it
turn for eleven chapters. §13 asks for equilibrium; 12° keeps the shaft visible
and returns most of the dial to the viewer.

### E7 · The action beat

`Készen állsz` / `felemelkedni?` · two objects, and the emptiest frame on the
page. One direct question, one line of type with a hairline under it, and
1440 × 300 of nothing. The yellow is the page's second and last event.

**The closing matter moved up into Act VI's body**, and the reason is sharper
than tidiness. Whatever is last in the document is what is on screen at the foot
of the page, and the action beat originally had a lead, a contact line and an
index of eleven altitudes under its frame — so the visitor reached the bottom of
the homepage and the last thing there was a list. The suite caught it: the
closing call to action was not in the viewport at the end of the track. The
action beat now has no body at all, its frame is pinned for its whole panel, and
its bottom edge is the track's bottom edge.

### E7a · The rhythm between the frames

`--act-presence`, one number cut out of `--pass` — which `composition.ts`
already publishes per panel once a frame. No observer, no second scroll
subscription, no keyframe, no clock.

    in    the last 0.30 of a screen of the approach and the first 0.12 after it
    out   from the moment the frame unpins — exactly `(hold − 1) / share` of
          the panel — over 0.32 of a screen

The two are set together, and the whole-journey scan is what set them. At a
half-screen arrival and a 0.45-screen departure, an incoming statement resolved
to 21% while the outgoing one was still at full strength — a ghost of the next
act behind the current one. Tightening the arrival alone bought a 0.81-screen
silence between every pair of frames. Moving the departure first — 0.45 → 0.32
— lets the arrival start at 0.83 of the outgoing act's panel instead of 0.93,
and the result is zero collisions with a longest silence of 0.61 of a screen.

**The last frame does not leave.** The action beat's `--act-out` is pinned at
zero: its frame is pinned for its whole panel and the panel is the foot of the
track, so a departure ramp would fade the closing invitation out over the last
two thirds of a screen.

**And a frame that is not in the picture is not in the tab order.**
`--act-events` and `--act-visible` are published from the same arithmetic, in
the one place `--pass` is already computed, because `visibility` and
`pointer-events` have no in-between and a frame's presence is a number. Without
it a visitor tabbing through the page lands on an invisible invitation between
two acts, which is what §43's "maintain keyboard behaviour" is written against.

### E7b · The horizon fragment is gone

§41. The fragment was a chapter's own word, set large and very dark low in the
frame, present exactly where its own statement was not — and it existed to
stand in for a statement the rails were holding back while the instrument
crossed. Nine chapters of eleven no longer have an instrument in them, so
nothing holds a statement back in them, and there is nothing left for it to
stand in for.

What it did instead was overlap. Measured on the production build at the
`system` crossing: the chapter's own headline at partial opacity with its own
word behind it at partial opacity, in one frame — the one thing a preview
fragment may not become. §41 rules out preserving the behaviour mechanically
where it conflicts with the new rhythm and says the design permits genuine
silence, and the whole-journey scan measures the longest stretch without
legible content at **0.61 of a screen** with the fragment contributing nothing
to that number.

The eleven authored words and their translations stay in `messages.ts`, and so
do `.horizon`'s rules and its `--horizon` ramp. What is removed is the
component and its one call site.

### E8 · The crossings

`cloud-entry`, `cloud-breakthrough`, `system` and `process` keep every word and
lose their rank. §26 and §43 both forbid deleting the nine areas and the seven
checkpoints for the sake of a silhouette; §3 forbids letting them compete.
`six-acts.spec.ts` asserts both halves — a crossing sets smaller than the
smallest act, and it still carries its content.

---

## F · The Altimeter

### F1 · The appearance map

| act | budget | shipped |
| --- | --- | --- |
| I · Ground | strong | **221px dial**, centre (1206, 296), right edge on the right margin line |
| II · Noise | absent | absent |
| III · System | absent | absent |
| IV · Proof | absent | absent |
| V · High altitude | absent / trace | **absent**, no trace |
| VI · Arrival | the return | **160px dial**, centre (720, 666) |
| *action* | absent | absent |

Nine chapters of eleven declare `instrument: 'absent'` in `scene.ts`. The
`InstrumentRole` union gained `absent`, which replaces the rule that used to
forbid it — *"nothing is ever absent"* was right for a design in which the
object was the page's continuous subject, and §32 overturns it.

### F2 · How absence is produced

Not an opacity trick. `SCENE_PRESENCE` is a second quantity beside
`SCENE_RECEDE` — the recede bottoms out at 0.62 scale by construction and cannot
remove anything — and `instrumentPresenceAt(progress)` ramps it over 0.4 of a
screen at each edge. Below 0.012 the object stops being drawn.

Keyed on progress rather than on altitude, and that exception is load-bearing:
the destination stage holds at 30 000 m, so an altitude-keyed ramp cannot tell
the arrival from the beat after it.

**The presence is published as `--instrument`** on the root, once a frame,
quantised. It is what `six-acts.spec.ts` reads: the suite runs against the
production build, where the `__stratos` handle is correctly compiled out.

### F3 · Placement

The two acts that have the object place it by solving, in closed form, for the
world transform that lands it exactly where the master frame puts it — the same
mathematics `railWorldX` already used, extended to the second axis, plus the
inverse of `projectedEssentialHeight` for the size.

`actWorldY` is new. The instrument used to ride at exactly the camera's height
and was vertically centred by construction, which was correct while the
composition was *copy beside a centred object*. It is not that: in Act I the
dial is in the upper right with the statement below and left of it, and in Act VI
it is low and under the statement.

`DIAL_OF_ESSENTIAL = 0.71` converts between the essential AABB the copy budget
clears and the drawn circle the study measures. **It was measured, not derived**:
at 0.9 the Act I dial came out 175px against the approved 221.

### F4 · Lighting — §22, §O

| | was | is | why |
| --- | --- | --- | --- |
| ambient | 0.55 | **0.30** | The largest single step. At 0.55 there is no true black anywhere on the object and the form is read from tone rather than from light — the render signature of a game asset rather than of a photograph |
| fill | 1.40 | **0.80** | Less diffuse fill, same argument |
| key | 3.40, `#eef4ff` | **4.20, `#f2f5f9`** | Neutralised. A cold-blue key on a dark object is a large part of what reads as *futuristic interface* |
| rim | 0, arriving only above 24 000 m | **2.00, always** | Rim-led separation against a near-black field, without raising the exposure to get it |
| exposure | 1.05 | **1.00** | |

**Not translated: the study's 17° lens.** That was a property of an isolated
object render; the production camera frames the mountains, the cloud deck and
the earth limb through the same field of view, and narrowing it to flatter the
bezel would re-frame the whole journey. §23 asks for the visual intent rather
than the numbers, and this is the number whose intent does not survive the
transplant.

**The `final` terms are larger than the study's**, and that is the original
code's own argument read at the other end: above 25 000 m the sky is black and
the environment probe has nothing to give the metal. The first capture under the
study's numbers verbatim was a black ring on a black field.

**The model, its materials and the GLB are untouched.**

---

## G · Mobile

### G1 · The contradiction that was resolved

The route mounted `AltimeterInstrument` as a persistent overlay for the whole
document: the object was in 100% of mobile frames and, under the approved
desktop design, 29% of desktop ones. §33 names that as one brand pulling in two
directions.

### G2 · What changed

`PLACEMENTS` gained one state — `absent`, at scale 0.42 and opacity 0 — and
`BY_STAGE` now resolves nine chapters of eleven to it. The hero hands over to
`HERO_DOCK = 'absent'` instead of to the rail, so the launch leg carries the
object from the reserved hero band to the withdrawal over the same six tenths of
a screen and through the same ease. `HERO_HANDOVER` moved from 0.26 to 0.62 of
the opening band so the state flips after the leg has finished rather than
during it.

Measured at 390 × 844, per section:

| | instrument opacity |
| --- | --- |
| calibration | **1.00** |
| initial-ascent | 0.02 (leaving) |
| lower-atmosphere → stratosphere-transition, seven sections | **0.00** |
| full-stratosphere | **0.43** |
| destination | 0.01 |

### G3 · What did NOT change

Native document scroll. No sticky scene. No terrain or camera journey. No new
measurement loop. **No second scroll listener** — the state comes from the
existing `onAscent` publisher, and `mobile-homepage-simple.spec.ts` still
asserts zero new scroll listeners during a scroll. No new rendering. No layout
feedback loop.

### G4 · Spacing, and two corrections the suite made

The acts get chapter spacing as **`margin-block-start: var(--mv-gap-chapter)`**,
and both halves of that are contracts this route has held for a long time:

* **Margin, not padding.** Padding is inside the section box and counts as the
  space above a chapter's first line. The first draft used 22svh of it and put
  every act's opening line a fifth of a screen below its own boundary — a
  chapter the visitor scrolls into rather than arrives at, which is exactly what
  §35 forbids and what `the first meaningful line of every chapter is near its
  own top` measures.
* **`vw`, not `svh`.** The whole mobile composition is measured in `vw` so that
  a collapsing toolbar moves nothing. A height-driven layout shifts every
  chapter under a reader mid-gesture, and `a viewport-height change moves no
  chapter` caught it.

It also fixed something neither of those is about. The chapter *before* an act
gains that act's spacing, and that is what makes a short crossing long enough to
be observed: `cloud-breakthrough` is a statement and one line, and the
accessibility walk — which steps by less than half a viewport, deliberately —
stepped straight over it and never announced it.

**The arrival's air is a spacer, not a second `AltimeterReserve`.** The reserve
publishes `heroAnchor` on the measurement bus so the opening instrument can be
positioned from the band the opening composition keeps for it; a second one
would be a second writer of that anchor, and the last measured wins.

### G5 · Typography

Translated, not shrunk. The same `act.<id>.monument` strings with the same
authored breaks; every size solved against a phone's own field. The act frames
get air no crossing gets — `clamp(7rem, 22svh, 12rem)` above — which on a phone
is the only device left that says *this one is a frame*.

The opening carries one action in the action's language — a line of type with a
hairline under it rather than a filled button — and one quiet route beside it,
which is the same pair the desktop opening and the closing beat carry.

The act sections lose their eyebrow and their altitude range (§35: much less
microcopy; the desktop frames carry one micro label between them). The telemetry
strip still reads the altitude continuously, which is where a number that
changes with the finger belongs. The crossings keep theirs.

The closing action is a line of type with a hairline under it rather than a
filled button, at a 44px minimum tap height. **No act monument re-breaks at
390px or 430px** — asserted with a `Range` line-box count in
`shots-acts-mobile.mjs`, which is also what caught `felemelkedni ?` wrapping its
question mark onto its own line.

The Proof act's marks move below the figure, which is §N of the study's own
finding about the portrait reading order, and the act uses the same
cross-section plate the desktop does.

The closing structure mirrors the desktop: the arrival section carries the
closing prose, the alternative and the index of altitudes, and the action beat
is a question and an invitation.

---

## H · Background and yellow

### H1 · Background

§37 asks for progression by density and §36 warns that the visitor must not feel
six gradient presets switching. The page sits on a live 3D scene that already
carries the altitude, and §1 says to preserve it — what it needed was authority
taken off it.

**One more wash in `.air`, continuous in `--alt`, keyed to no chapter at all:**

```
0.90  at the ground, where the terrain was the loudest object on the page
0.96  through the cloud deck — the only place the wash goes UP, and the term
      that stops the deck reading as a white band behind the Proof figure
0.62  across the curvature, where the horizon is the only reference the high
      frames have
0.74  at the ceiling
```

No new element type, no particles, no procedural noise, no glow, no filter, and
nothing on a scroll frame that was not already there.

### H2 · Yellow

**Two events on the page**, and the crossings are not exempt from the count:
`:root .panel:not(.panel--act) { --signal: var(--act-34); }` takes the signal
colour out of the four longest chapters, where it had been scattered across the
ring numerals, the checkpoint indices, the ladder's altitudes and every
eyebrow's range.

| act | yellow |
| --- | --- |
| I · Ground | none |
| II · Noise | none |
| III · System | none |
| **IV · Proof** | **`~15M Ft`** — the figure, and nothing else in the act |
| V · High altitude | none |
| VI · Arrival | none — arrival is a state, not an offer |
| *action* | *the action* |

Scoped to `.act__monument--figure` and not to `[data-act='iv']`, for the reason
§F of the study records: the broad selector turned a crossing fragment yellow.

**The header's own altitude readout is suppressed on this route.** `.nav__alt`
is the shared deck's decorative altimeter, `aria-hidden`, present on all 67
routes; here it was a second altitude in every frame in the signal colour, which
is exactly what §21 names. The rule is scoped to the homepage's stylesheet.

**The header stays collapsed for the whole journey.** Its `destination` edge is
put beyond the end of the track, so the deck does not re-expand into a nav bar
and a yellow button across the arrival. Every link the expanded header carries
is in the menu; the quote route is the action beat's own.

**One yellow remains outside the budget** — see §L.

---

## I · Accessibility and reduced motion

* **Heading structure.** One `<h1>` (Act I). Every other act and crossing opens
  with an `<h2>`; act bodies use `<h3>`. Thirteen headings on the reduced-motion
  page.
* **The figure as a heading.** `~15M Ft` is Act IV's `<h2>`, followed
  immediately by the client and the definition — the same reading order the eye
  takes.
* **Routes.** Every destination the old composition offered is still reachable:
  the case, `/work`, the quote form, the contact page, the questionnaire, and
  the eleven stage anchors. The two the frames dropped — the hero's second CTA
  and the closing panel's secondary action — are the header's `Munkáink` and an
  `sr-only` anchor in the action beat's reading order.
* **Tap targets.** `.act__action` and `.act__routes a` are anchored by their
  hairline and grow upward to a 44px minimum, in real pixels rather than frame
  units, so the target does not shrink with the composition at 1024 wide.
* **The colophon** is `aria-hidden`: every word of it is an `<h3>` in the same
  act's ladder.
* **The live regions survive.** `JourneyHUD` keeps its clock, its two live
  regions and the Meridian description; only its picture was retired. An
  altitude that changes sixty times a second belongs in the accessibility tree.
* **The sound control survives**, visibly — a control is not decoration. See §L.

### I1 · Reduced motion — §44

The acts compose themselves on this path. The frames are absolutely placed and
`--act-presence` falls back to 1 when nothing publishes `--pass`, so a visitor
with no clock sees all seven settled and still. All seven monuments render; no
canvas is created; no heavy payload is fetched; no horizontal overflow.

**The frames do not ramp on this path**, and that is a decision rather than an
omission. `--act-presence` is a scroll choreography, and a visitor who has asked
for reduced motion has asked for it not to happen. Left running it does
something worse than move: every act below the fold sits at presence 0 with its
invitation `visibility: hidden`, so the closing action and both of the Proof
act's routes are not in the document a screen reader or a keyboard reaches.
Under `prefers-reduced-motion` all seven frames are composed, still, visible and
in the tab order — §44's own words.

The gate is made in two places, and it has to be: the stylesheet pins the ramps
under the media query, and `composition.ts` stops publishing `--act-visible` and
`--act-events`, because an inline custom property beats a media query and a
published `hidden` would win against the stylesheet's `visible`.

What did not follow was the instrument's own fallback panel: a filled yellow
state selector, at the top of the page, in front of the hero. §44 is explicit
that this path must not fall back to the old visual language, so the selector is
set in the action's language instead — type on a hairline, no fill, no yellow,
one weight, the current state marked by contrast rather than by a block. **No
control was removed and no sentence was hidden**: it is still six buttons, still
keyboard-reachable, still `aria-pressed`.

---

## J · Performance

The redesign mostly removes work. `production/act-cost.json` has the full table;
these are the numbers that matter.

| act | instrument | WebGL draws | triangles |
| --- | --- | --- | --- |
| I · Ground | present | 57 | 157 694 |
| II · Noise | **absent** | **17** | 133 724 |
| III · System | absent | 17 | 133 724 |
| IV · Proof | absent | **7** | **1 920** |
| V · High altitude | absent | **4** | 9 776 |
| VI · Arrival | present | 54 | 35 546 |
| *action* | absent | **4** | 9 776 |

**Draw calls fall by 70% the moment the instrument leaves the frame** — 57 → 17
between Act I and Act II, on the same page, in the same session. Five of the
eleven chapters now render under twelve draw calls. That is the appearance
budget's cost, measured, and it is the direction §45 asks for.

**Style recalculations and layouts** over four seconds of scripted scrolling:
0–1 layouts per act, 9–76 style recalculations. The act frames contribute no
forced layout at all — there is no measurement on that path — and the
recalculations are the published custom properties the crossings and the air
already used.

**What is NOT claimed.** The frame times in `act-cost.json` (31–218 ms) are from
a headless software rasteriser and are not a statement about a real GPU. Only
the *relative* figures above are meaningful. A matched before/after benchmark on
the previous homepage was not run: it would mean reverting the working tree, and
§54 stops this phase at a reviewable state.

**Structural reductions**, which are not viewport-dependent:

* no runtime text measurement on the act path — the whole ink-area solve is
  compile-time
* no kinetic axis choreography binding
* the HUD readout, the scale bar and the stage label are no longer written
* the persistent mobile overlay is at zero presence for nine chapters, so the
  mobile renderer parks — `publishInstrument` reads the placement's opacity and
  tells the scene it is not visible
* the horizon fragment and its per-panel ramp no longer render on any chapter

**No new dependency was added.** No horizontal overflow at any of 121 samples
down the track.

---

## K · Tests

### K1 · Stale contracts audited and replaced — §50

| contract | verdict | what replaced it |
| --- | --- | --- |
| six marks under `.collab__item img` | **selector stale, contract sound** | `[data-testid="collaborations"] img`. The rule — six marks, each carrying its organisation's name — is asserted exactly as it was |
| `collaborations.title` renders as an `<h3>` over the rail | **stale** | §28 cuts the heading, so the contract is INVERTED: a heading coming back is the regression now |
| `.case__metric` with `<strong>`/`<span>`, positioned after the result and before the actions | **half stale** | The value, the label and the uniqueness are §11's requirement and are unchanged. The POSITION contract described the layout the design replaced; what replaces it is stricter — *the figure is the largest type in its own act* |
| mobile: "the instrument is on screen, above 0.4 opacity, at every one of eleven stops" | **stale** | §33 overturns it. Replaced by a stricter contract: present in exactly two chapters, **below 0.05 in the other nine**. Eleven bits of information instead of one |
| the closing CTA is in the viewport at the end of the track | **sound, and it was failing** | Not weakened. The page was changed so it is true — §E7 |

No assertion was weakened to make a run green.

### K2 · New contracts — §51

`experiments/tests/six-acts.spec.ts`, eleven tests, every expectation derived
from `acts.ts`, `journey.ts`, `scene.ts`, `content.ts` and `messages.ts` rather
than transcribed.

1. the acts run in strictly increasing altitude — asserted against the map *and*
   against the running page
2. the instrument is absent from every act that does not budget one
3. it returns at the arrival, and the type grid and the instrument grid agree at
   three viewports
4. one featured case, and it is Rapidkert; six marks; no heading over them
5. the figure and its label are `content.ts`, word for word
6. yellow appears where the budget says and nowhere else
7. no horizontal overflow at 51 samples down the track
8. the monuments resolve to their authored geometry in HU, EN and DE — the
   authored lines, the line count, one line box per line, the solved size
9. two statements are never legible in the same frame
10. no stretch of the journey is empty for more than a screen
11. a crossing never sets larger than the act it runs under, and keeps its
    content

### K3 · Results

**`npm run test:full` — the whole gate, on the production build: 161 passed, 0
failed.** Seven projects: `desktop`, `reduced-motion`, and the five phone
shapes `mobile-390`, `mobile-430`, `mobile-375`, `mobile-360`,
`mobile-landscape`. Machine-readable at
`production/playwright-full.json`.

Two tests in `six-acts.spec.ts` skip on `reduced-motion` by name, and the skip
says why: the frames do not ramp on that path, so *two statements are never
legible in the same frame* and *no stretch of the journey is empty for more
than a screen* are questions about a choreography that path deliberately does
not have. §44's requirement for it is asserted directly, in the full-ascent
suite, by *hides no essential content and keeps every CTA usable*.

**`experiments/scan-journey.mjs` on the built route, 121 samples:**

```
track 24.43 screens · altitude monotonic: true
longest silence: 0.61 screens
  0.20  6 900 m           cloud entry
  0.61  9 540 – 10 320 m  breakthrough
  0.20  13 140 m          selected work
  0.61  19 800 – 20 820 m the nine areas
statement collisions: 0
horizontal overflow samples: 0
```

**`experiments/shots-acts-mobile.mjs` at 390 × 844 and 430 × 932:** no act
monument re-breaks in any locale, no horizontal overflow at any section, and the
instrument presence per section is §G2's table.

**The production site's own homepage specs**, which are the other gate this
change is in scope for — `mobile-homepage-simple`, `homepage-chrome`,
`homepage-history`, `homepage-modality` and `public-site`, at `desktop-1440`
and `mobile-390`: **630 passed, 0 failed.** History restoration, the menu's
focus trap and modality, Return to 0 m, the deck's altitude and stage readouts,
the mobile instrument's appearance budget, the zero-new-scroll-listeners
contract and the three-locale route checks are all in that number.

### K3a · Stale contracts in the site suite

Four more, all the same shape and all replaced rather than weakened:

| contract | what replaced it |
| --- | --- |
| the deck reaches its `destination` state at the foot of the homepage and reveals the project-start button | the deck stays out of the way **and** the route it used to carry is still there, in the page, at the end — §H2 |
| `the states are reversible`, `a single jump lands on the right state`, `opens from every header state`, `return to 0 m` all asserted `destination` at the foot | the same properties, asserted against the two states this route has. Reversibility, the one-jump landing, the menu opening at the bottom of the page and Return to 0 m are all unchanged |
| `altitude climbs as the visitor scrolls` asserted a **visible** persistent readout | the clock is live, starts at 0, climbs with the scroll and never reads outside 0–30 000 m — asked of the element's text rather than of its picture. Plus the inverse, which is new: **no persistent altitude readout is painted anywhere on the homepage**, which is §21 stated as a check |
| mobile: the instrument is on screen above 0.4 opacity at every one of eleven stops | present in exactly two chapters, below 0.05 in the other nine — §G2 |

**What the suite caught that a screenshot could not**, in the order it caught
it — every one of these is a defect that shipped in an intermediate state of
this implementation and was fixed rather than accommodated:

1. two statements legible in one frame, twice over the journey — §E7a
2. the closing call to action not in the viewport at the foot of the page — §E7
3. the act frames' actions below the 44px tap target — §I
4. the readout travelling on a rail that no longer exists, and landing under the
   high-altitude statement — §H2
5. a 1.63-screen dead stage that was really a silence check whose definition of
   ink had gone stale against the markup — §K4
6. every act opening a fifth of a screen below its own boundary on the phone,
   and a height-driven layout that moved every chapter when the browser chrome
   changed — §G4
7. a short crossing the accessibility walk stepped straight over and never
   announced — §G4
8. the reduced-motion path withholding the closing action and both of the Proof
   act's routes — §I1
9. **the restored homepage coming back 125px below where the visitor left it**,
   on the phone, every time. The act spacing was given to the OPENING section
   as well, and a top margin on the first flow child collapses out through
   `.mv-flow` and moves the whole document down by its own height. It is not
   visible as a gap and it is not visible in a screenshot; it is visible as a
   history defect, and `homepage-history.spec.ts` reported it as exactly 250px
   against a 200px tolerance. Attributed by building `HEAD` in a git worktree
   and running the same probe against both — the baseline restores to the pixel,
   and so does the fix.

### K4 · Tooling added

| | |
| --- | --- |
| `experiments/shots-acts.mjs` | the seven frames and four crossings at four viewports, at their settled positions |
| `experiments/shots-acts-mobile.mjs` | the same at 390 and 430, with a `Range`-based monument wrap check |
| `experiments/scan-journey.mjs` | 121 samples down the track: silences, statement collisions, monotonicity, overflow — §49 |
| `experiments/probe-act-cost.mjs` | draws, triangles, frame time, style/layout per act |
| `experiments/shot-instrument.mjs` | the two instrument frames alone, for the lighting pass |
| `scripts/rapidkert-section.mjs` | the Proof plate's derivation |

---

## L · Differences from the approved master frames

Honest, and each one is a decision rather than a slip.

### L1 · The shared site header is in the frames

The study's frames carry a wordmark and nothing else. The production page
carries the site's flight deck, which is shared with 66 other routes and is how
this page is navigated. It is collapsed to the mark and the menu for the whole
journey (§H2), and its altitude readout is suppressed here — but at the very top
of the page it is in its full state, so **Act I's frame contains a nav bar and a
yellow quote button.**

That is the one yellow event outside the budget, and it is left in place
deliberately: the header's call to action is a commercial element of the whole
site, not part of the homepage composition the study modelled, and neutralising
it is a conversion decision rather than an art-direction one. **It is a one-rule
change if the review wants it.**

### L2 · The sound control is a ninth object

The study has no such control. `meridianSound` is a real feature with a real
toggle, and a feature cannot be deleted to make a screenshot match. It is at the
frame's bottom right, at micro scale, at 34% opacity, rising to full on hover
and focus. It is in every frame.

### L3 · Act IV has five objects, not four

§9 requires the Proof act to carry a route to the case and a route to all the
work. See §E4.

### L4 · The background is a live scene, not a flat field

The study's frames sit on near-black with two tonal moves. The page sits on
mountains, a cloud deck, a sky dome and an earth limb, restrained by one
continuous wash. Acts I and II therefore have faint terrain in them and Act IV
has a faint deck. §1 preserves the 3D and §36 asks the background to progress;
this is the trade, and it is visible in `production/after/sheet.png`.

### L5 · The arrival's instrument is darker than the study's plate

The study's plate is a studio render with its own environment. The production
object at 28 000 m is dark metal on a black sky, and metal reflects the
environment rather than the lights — so it reads as a rim-lit machined
silhouette rather than as a legible dial. The lights were raised twice and the
limit is the scene, not the exposure. §O3 of the study reaches the same place
from the other side: at 160–221px the dial face contributes almost nothing.

Also in the frame at the arrival: the Meridian's central axis line, which runs
diagonally out of the bottom-left corner. It is part of the instrument's own
narrative rather than decoration added to the frame, and removing it would be a
model change §22 rules out — but it is the one line in that frame the study does
not have.

### L6 · Act I's premise is announced rather than shown, on the desktop

`calibration.title.a`, `note.a`, `note.b` and `meta` are an `sr-only` paragraph
in the desktop Act I. Four sentences that were visible are no longer visible
there. They are prose about the page and a caption on an object rather than
business information, and §43's line is about content being available.

**On the phone they are shown**, because there is room in flow for them and
where there is room the answer is to have them there. That is the one place the
two surfaces deliberately differ in what they carry rather than in how they
carry it.

### L7 · The returning instrument passes behind copy on the phone

The mobile instrument is a fixed overlay at the viewport's centre, and the
arrival's copy scrolls through it — which is what `anchors.ts` has always tuned
its opacities for ("not *how visible is it*, but *how much does it compete with
the line crossing it*"). At the arrival it is 0.43, and the closing prose
crosses it as the visitor leaves the act. It is the pre-existing behaviour of
the overlay rather than something this pass introduced, and the alternative —
a sticky scene on the phone — is ruled out by §34.

### L8 · Act II's silhouette on mobile

The right-alignment does not survive a phone measure and returns to the spine —
§N of the study predicted this and called it the correct degradation.

---

## M · Remaining limitations

1. **The Proof plate is still a screenshot.** It is now a screenshot of the part
   that is the work, with no foreign typography on it, and it needs no mask to
   be quiet. It is still not a commissioned photograph or an art-directed render
   of the cross-section, and that asset does not exist. §P4 of the study stands,
   reduced.

2. **The header's yellow in Act I.** §L1. Decision-ready, one rule.

3. **The arrival instrument's legibility.** §L5. It would take an environment
   contribution at the ceiling or a material pass, both of which are changes to
   the asset or the scene that §22 asks not to make without production evidence.
   This report is that evidence, if the review wants the pass.

4. **The crossings still use the old composition.** The rails, the measured copy
   budget and the reverse-gravity ramp are unchanged under `cloud-entry`,
   `cloud-breakthrough`, `system` and `process`. That is deliberate — §1 says
   preserve the working foundations — but it means the page runs two composition
   systems, and the crossings' typography is Direction D only in colour and
   weight, not in placement.

5. **The nine areas and the seven checkpoints are 4.4 screens of crossing.**
   §26 and §43 keep them and §3 demotes them, and the result is the longest
   stretch of the journey without an act in it. The whole-journey scan measures
   its longest silence at 0.61 of a screen, inside the tolerance, but it is the
   part of the rhythm furthest from the storyboard — and the nine areas restate
   Act III's argument at a higher altitude, which is a content question this
   phase was not asked to answer.

6. **`--u` scales the whole composition by `min(vw/1440, vh/900)`.** On a very
   tall narrow desktop window the field is letterboxed top and bottom; on a very
   wide one, left and right. It is correct at all four required viewports and it
   is a real property of fitting a fixed frame.

7. **No before/after performance benchmark.** §J explains why and gives the
   measurements that are honest.

8. **The mobile arrival's copy passes behind the returning instrument.** §L7.

9. **The instrument's placement is verified as a grid contract, not as a pixel
   position.** The suite runs against the production build, where the scene
   handle is compiled out; the projected placement was measured by hand during
   implementation (Act I: 175px → 221px after calibration) and is judged
   optically in the frames.

---

## Stop here

Nothing has been pushed, merged or deployed. No Portal work was touched. The
closed navigation-dispatch investigation was not reopened and no new harness
campaign was started — the existing full-ascent suite and the existing mobile
suite are the gates that ran.

**Awaiting human visual review.** The comparison to make is
`production/after/sheet.png` against `six-act/six-act-monochrome.png` and
`six-act/six-act-color.png`, frame by frame, at 1440 × 900.

# 08 · TEMPORAL ART DIRECTION

*Phase 5 · the full homepage reviewed as a continuous experience, and the timing
corrected where the measurement said it was wrong.*

The static system is unchanged. No act was redesigned, no typography moved, no
element was added or removed, no copy was rewritten, and the six master frames,
the Editorial Passage system, Rapidkert, the yellow budget and the Altimeter's
appearance budget are all exactly what they were. What changed is **eleven
numbers**, every one of them a duration, and one contract that was measuring the
wrong quantity. One further change was written, measured, rejected by an
existing contract and reverted — and that reversal is one of the more useful
findings here, so it is reported rather than quietly dropped (§C-1).

---

## HOW THIS REVIEW WAS CONDUCTED, AND WHAT THAT MEANS FOR ITS CLAIMS

Two things need stating before any finding, because they decide how much weight
each finding carries.

**The unit is scroll, not seconds — and that is not a dodge.** Every state on
the desktop homepage is a pure function of scroll position. There is no authored
timeline: the altitude, the atmosphere, the instrument's recede and every
statement's opacity are read off `journey.current`, the damped scroll progress.
So "how long does this state last" has one honest answer in screens of scroll
and three in seconds, depending on how fast the visitor moves. Every number
below is given in screens, and §28's question — does the defect survive a range
of realistic paces? — is answered by converting at three of them (520, 950 and
1 800 px/s on a 900px viewport). A defect that is a defect at all three is a
design defect. One that only appears at the slowest is a pace.

The portrait journey is the opposite and is measured differently. It is ordinary
block flow with one `IntersectionObserver`, and its motion is CSS transitions
with real durations — 1.05 s for a masked headline line, 0.8 s for a general
rise, 0.52 s for body copy, plus up to 0.55 s of stagger. Those are wall-clock
seconds and they do **not** compress when the visitor scrolls faster. That single
difference is why §23 is right that mobile is not a secondary check, and it is
the source of two of the findings below.

**What was actually watched.** §3 asks for four recordings and §4 asks for two
viewing passes before any code is opened. The recordings exist and are listed in
§REQUIRED REVIEW ASSETS below — they are Playwright context recordings of a
real-time scroll on a real GPU (ANGLE/Metal, 60 fps sustained), not a stepped
capture. Alongside each one a Chrome DevTools **screencast** was taken, which
hands back every composited frame as a timestamped image, and each frame was
then placed on the scroll track by a clock the page publishes at the moment the
scroll starts. That is what the review pass was conducted on: dense frame
sequences of the moving page, read twice — once for what the journey feels like
and once mapped back to chapters — plus contact sheets sampled at equal journey
progress.

This is an adaptation of "watch the recording twice", and the difference is
worth being explicit about rather than glossing: the .webm files are the review
asset for a person, and the analysis in this document is drawn from the frame
sequences and from measurement. Where a finding is a judgement about how a
stretch reads, it is stated as one and the frames that produced it are named.
Where a finding is a number, it is a number.

---

## THE ANSWER TO §1

> Does the entire homepage feel calm, expensive and intentional while moving?

Before this pass: **mostly, with two exceptions that were not small.** The
master acts were composed and calm. The four editorial passages were not
passages — they were flashes. And the first thing the visitor did on the page
was scroll three quarters of a screen and get nothing back.

Both were invisible in every static review that came before, and both are
invisible in a screenshot by construction: one is a duration and the other is an
absence of change. Neither was a composition problem. That is the whole case for
this phase having existed.

After this pass the two extremes are gone. Nothing on the page is composed for
1.5 screens and nothing is composed for 0.13. The measured spread of composed
windows went from **0.13 – 1.52 screens** to **0.33 – 1.00**, and the
master-to-passage ratio from **6.2 : 1** to **2.1 : 1** — a hierarchy the eye can
read as a hierarchy rather than as one tier and one glitch.

---

## A · CURRENT TEMPORAL MAP

Desktop, 1440 × 900, Hungarian, measured at 601 scroll positions across the
track. `composed` is the scroll over which the chapter's statement holds at 90%
opacity or better — the quantity a visitor actually experiences, as opposed to
the hold, which is only an input to it.

### After

| chapter | level | chapter extent | altitude | panel | composed | statement arrives → gone |
|---|---|---|---|---|---|---|
| calibration | master | 0.00 → 1.37 | 0 → 150 m | 1.48 | **1.00** | 0.00 → 1.08 |
| initial-ascent | master | 1.41 → 3.58 | 150 → 3 000 m | 2.43 | 0.71 | 1.25 → 2.58 |
| lower-atmosphere | master | 3.62 → 6.32 | 3 000 → 6 000 m | 2.69 | 0.71 | 3.66 → 4.99 |
| cloud-entry | passage | 6.36 → 8.65 | 6 000 → 8 500 m | 2.34 | 0.33 | 6.36 → 7.20 |
| cloud-breakthrough | passage | 8.69 → 10.15 | 8 500 → 11 000 m | 1.54 | 0.37 | 8.69 → 9.53 |
| selected-work | master | 10.19 → 12.69 | 11 000 → 17 000 m | 2.48 | 0.71 | 10.23 → 11.56 |
| system | passage | 12.73 → 16.18 | 17 000 → 22 000 m | **3.50** | 0.37 | 12.73 → 13.56 |
| process | passage | 16.22 → 18.51 | 22 000 → 25 500 m | 2.34 | 0.37 | 16.22 → 17.05 |
| stratosphere-transition | master | 18.55 → 20.88 | 25 500 → 28 000 m | 2.40 | 0.71 | 18.55 → 19.92 |
| full-stratosphere | master | 20.92 → 23.88 | 28 000 → 30 000 m | 2.83 | 0.75 | 20.96 → 22.30 |
| destination | master | 23.92 → 24.96 | 30 000 m | 1.91 | 0.83 | 23.92 → 24.96 |

Total track **24.96 screens** (was 25.37). At the three paces: **43.2 s / 23.6 s
/ 12.5 s**.

Instrument in the picture: **0.00 → 1.83** and **20.92 → 22.84**. Two
appearances, 3.74 screens of 24.96 — 15% of the journey.

Portrait, 390 × 844: **14.95 screens, unchanged** — eleven chapters plus 2.98
screens of the site's own Arrival panel and footer. Nothing this pass did to the
phone changed a single pixel of layout; both portrait corrections are durations,
which is why the before and after portrait recordings are the same document
length to the pixel (11 772 px) and are a clean like-for-like.

| chapter | level | screens | | chapter | level | screens |
|---|---|---|---|---|---|---|
| calibration | master | 1.27 | | system | passage | **1.64** |
| initial-ascent | master | 0.75 | | process | passage | 1.17 |
| lower-atmosphere | master | 1.55 | | stratosphere-transition | master | 0.43 |
| cloud-entry | passage | 0.60 | | full-stratosphere | master | 0.40 |
| cloud-breakthrough | passage | 0.48 | | destination | master | 1.14 |
| selected-work | master | 1.24 | | | | |

The two summit acts at 0.43 and 0.40 screens are the shortest chapters on the
page and remain so — see §C-1 for why that could not be corrected here.

---

## B · DESKTOP HUMAN-SCROLL FINDINGS

The first pass was conducted on the frame sequence alone, at equal journey
progress, without opening a file. These are the moments it flagged, in the order
they arrive, with the timestamp of the frame that produced the note. The second
pass mapped each to a chapter and a number.

| at | felt | mapped to | verdict |
|---|---|---|---|
| 0.5 → 1.0 s | *visually stuck* — two frames half a second apart are pixel-identical | `calibration`, 0.76 screens with no measurable change in frame, type, instrument **or** sky | **P0** |
| 6.6 sc | *too technical* — a four-item list, small, top-left, nothing else in frame | `cloud-entry` body | accepted (§34: solve duration, not content) |
| 7.8 → 9.0 sc | *too empty, repetitive* — three small lines that only move up the screen | `cloud-entry` after its statement has gone | **P1** |
| 9.9 → 10.7 sc | *too empty* | the designed silence before the Proof | accepted (§8) |
| 10.8 sc | *unexpectedly abrupt* — the Proof arrives and is gone within one sample | it is not: 0.71 composed, the same as every act. Mis-read on my part | no defect |
| 13.5, 14.7, 15.5 sc | *too technical, repetitive* — three dense list frames | `system` body, three staged layers | **P1, flagged not fixed** |
| 16.7 sc | *right* | `process` | leave (§10) |
| 21.2 sc | *too busy* — statement arriving and a small dial arriving at the same time in different corners | the instrument's return co-arriving with Act VI | **P1** |
| 23.0 → 23.5 sc | *too technical* — a paragraph block and an eleven-row altitude table, over the instrument | `full-stratosphere` body, in the Arrival → Action beat | **P1** |
| 24.0 → 25.4 sc | *repetitive* — three near-identical closing frames | `destination`, 0.85 screens with nothing changing anywhere | **P2** |

Two things the first pass explicitly did **not** flag, which is worth recording
because both were suspected going in: no transition anywhere read as elastic,
bouncy or demonstrative, and at no point were two display statements legible in
the same frame. Both are confirmed by measurement in §J and §A.

### The two P0s, in full

**P0-1 · The passage statements were flashes, not a quieter tier.**

The four editorial passages carry four of the eleven authored thoughts on this
homepage, including the two §7 and §9 name by hand. Measured before this pass:

| | composed (≥0.90) | at 520 px/s | at 950 px/s | at 1 800 px/s |
|---|---|---|---|---|
| master frames | 0.68 – 1.52 screens | 1.17 – 2.63 s | 0.64 – 1.44 s | 0.34 – 0.76 s |
| passage frames | **0.13 – 0.17 screens** | **0.22 – 0.29 s** | **0.12 – 0.16 s** | **0.06 – 0.08 s** |

A ratio of 6.2 : 1, and it survives every pace in the range, which is §28's test
for a design defect rather than a pace. At the middle pace a passage statement
is at full strength for an eighth of a second.

The cause was not the hold. It was that **the hold is an input and the composed
window is the output**, and nothing in the code or the contracts distinguished
them. `PASSAGE_HOLD` was 1.25 against the act's 1.8 — a deliberate, well-argued
0.55 of a screen less. But the arrival and departure ramps in `styles.css` were
solved against the act's 1.8 and the passage inherited them unchanged, so those
0.55 screens came almost entirely out of the middle. The frame spent 0.74 of a
screen moving and 0.13 standing still.

**P0-2 · The hero held three quarters of a screen of nothing.**

Act I has no body. An act with no body carries `data-act-departs="no"` and its
frame therefore never releases — which is correct and must stay: a bodyless act
that departs opens a 0.56-screen void before the next one arrives, and that
geometry is fixed by the ramps regardless of the hold. But it means that for Act
I alone, **the hold and the composed window are the same number**. Every other
act's statement was composed for 0.68 – 0.80 screens; Act I's for 1.52.

And Act I is the worst chapter on the page to spend a surplus in. Its altitude
band is 150 m of 30 000, so across its whole panel the sky, the range and the
instrument's recede move by amounts below anything the eye resolves. The
stillness test — frame, type and instrument all static between two samples —
reported **0.76 screens starting 0.21 of a screen into the page**. §14: *"Luxury
confidence does not require keeping the visitor captive."*

---

## C · MOBILE HUMAN-SCROLL FINDINGS

Reviewed independently, as §23 asks, and it found two things the desktop review
could not have.

**C-1 · The summit is the shortest thing on the page. (P1, flagged — and the
attempt to fix it was correctly rejected by the codebase.)** Chapter length on a
phone is content height, and Acts V and VI have almost none — Act V is a
statement and three short paragraphs, Act VI is a statement, the instrument's
air and one lead. Measured at 390 × 844 they are **365 px and 340 px: 0.43 and
0.40 of a screen, the two shortest chapters on the page.** Shorter than three of
the four passages, and a quarter of the `system` passage above them. The desktop
gives the same two acts 2.37 and 2.99 screens. §18 asks for High Altitude to
have room to breathe; on the phone it has less room than any editorial passage,
and §40 asks for mobile to feel like the same brand.

**This was attempted and reverted, and the reversal is the more useful finding.**
A `min-height: 74svh` floor on the two chapters was written, built and tested,
and it broke two existing contracts at once:

- *`no chapter contains a tall run of nothing`* — Act VI reported a 35.7 svh
  trailing band against a 34 svh ceiling. The design already forbids what I was
  doing: **a chapter may not buy scroll with emptiness.** That contract is §8's
  dead-hold rule, already encoded, and it was right.
- *`a viewport-height change moves no chapter`* — every vertical size that
  affects a chapter's document position on this surface is driven by viewport
  WIDTH (`clamp(80px, 22vw, 112px)` and its siblings), precisely so a Safari
  toolbar collapsing mid-gesture cannot move the page under a reader. An `svh`
  floor moved two chapters by 68 and 136 px.

So on the portrait surface a chapter's length *is* its content, by design and by
contract, and the inversion cannot be corrected by timing. It is the same class
of finding as `system` on the desktop and it is recorded in §P with the same
recommendation: it belongs to a content phase.

**C-2 · The Altimeter's return never landed. (P1, fixed — by the chase, not by
the chapter.)** The portrait instrument is a fixed overlay whose position, scale
and opacity are chased with a 0.34 s time constant (`RETAIN.place`). Act VI's
chapter is 340 px, which is 0.38 s of scroll at an ordinary phone pace — barely
one time constant. The return is authored at 0.44 opacity and measured, in a
*stepped walk with settling time at every position*, at **0.36**. Under real
scroll it was worse: 0.34 at 900 px/s, 0.22 at 1 800, 0.16 at 3 200. An arrival
that never reaches its own authored value at any speed is not the intentional
return §15 asks for; it is a near-miss that reads as the object being
half-there.

With the chapter's length out of reach (C-1), the lever is the chase itself.
`RETAIN.place` is now **0.22 s**: the same 0.38 s of scroll is 1.7 time
constants instead of 1.1, so the state lands, and three time constants is still
0.66 s — a movement, not a switch. Every other state change on the phone gets
crisper by the same amount, which is §22's pace contrast rather than a
regression: these were the slowest transitions on a surface whose reveals are
all under a second.

**C-3 · A flick outruns the passages, not the acts. (P2, partly fixed.)** §24
asks whether any state relies on a tiny scroll interval. One does, and it is the
opposite of what one would guess. The two reveal lines are 33% of a screen
apart: a master act's statement is painted at 88% of the frame and has **52% of
a screen** to travel before it reaches the reading position; a chapter marker is
painted at 54% — the reverse-gravity line — and has **19%**. Both then take the
same 1.05 s to arrive. Measured, as travel still remaining when the statement
passes the reading line:

| | 900 px/s | 1 800 px/s | 3 200 px/s |
|---|---|---|---|
| master acts | 0.04 (all land) | 0.17 – 0.24 | 0.38 – 0.53 |
| passages, before | 0.31 – 0.35 (all land) | 0.61 – 0.72 | 0.68 – 0.93 |
| passages, after | 0.24 – 0.30 (all land) | 0.45 – 0.57 | 0.55 – 0.84 |

At 900 px/s — the pace of someone who is reading — everything lands, before and
after. Above that nothing on a time-driven reveal lands, which is a property of
the mechanism and not of any number in it. The passage line's duration is now
0.62 s rather than 1.05, which closes about half the gap; closing the rest means
moving the reverse-gravity reveal line, which is an accepted decision from an
earlier phase and out of this phase's budget.

**C-4 · No dead space, and the process passage is right.** Portrait has no
low-ink stretch over 0.10 of a screen anywhere in the flow. The `process`
chapter is 1.17 screens — proportionate, and §10's answer on the phone is the
same as on the desktop: leave it.

**C-5 · Toolbar variance.** No layout value was added on this surface, so
nothing new depends on viewport height and the existing passage-bounds contracts
are untouched — verified by the contract that broke when they nearly were
(C-1). Both portrait changes are durations, which are the same at every phone
shape by construction. Checked at 390 × 844, 430 × 932, 375 × 667 and 360 × 800
through the suite's five portrait projects.

---

## D · MASTER ACT TIMING

§13's seven questions, each answered with the number that answers it.

| act | §13 asks | measured (after) | verdict |
|---|---|---|---|
| **I · Ground** | Does the Hero establish confidence quickly enough? | composed 1.00 screens (was 1.52); first perceptible change at 0.46 screens (was 0.97); stillness 0.25 (was 0.76) | **corrected.** Still the longest-composed act on the page by 40%, and the ascent now begins in the first half-screen. |
| **II · Noise** | Tense without becoming slow? | composed 0.71, chapter 2.17, statement gone at 2.58 with 1.0 screen of body after it | yes. Tension comes from the copy's density under a short frame; nothing to change. |
| **III · System** | Understood before leaving? | composed 0.71 plus 0.71 of body, then 3.6 screens of crossing before the Proof | yes — and the two crossings under it (`cloud-entry`, `cloud-breakthrough`) are where the act's argument is actually completed. |
| **IV · Proof** | Enough attention without becoming a portfolio chapter? | 2.48 screens, composed 0.71 — exactly the act median. Metric, photograph and both routes arrive and depart as one event (§H) | yes. It is one frame, not a chapter. |
| **V · High Altitude** | Silence powerful rather than prolonged? | 2.37 screens, composed 0.71, 0.62 of stillness — the second-longest still run on the page, but over an altitude band of 2 500 m, so the atmosphere is moving throughout | **calm, not waiting.** Deliberately untouched (§18). |
| **VI · Arrival** | Does arrival feel earned? | composed 0.75, and the instrument now withdraws with it rather than 2.1 screens later | yes on the desktop, and better than before. On the phone it is the shortest chapter on the page — §C-1. |
| **Action** | Does the CTA appear after a real beat? | BEAT 1 gone at 22.30, BEAT 2 arrives at 23.92 — **1.62 screens of separation**, filled with Act VI's body | yes, but see §I: the separator is the problem, not the separation. |

---

## E · PASSAGE TIMING

| passage | panel, before → after | composed, before → after | authored share |
|---|---|---|---|
| cloud-entry | 2.23 → 2.34 | 0.17 → **0.33** | 1.4 |
| cloud-breakthrough | 1.38 → 1.54 | 0.13 → **0.37** | 1.2 → 1.4 |
| system | 3.39 → **3.50** | 0.13 → **0.37** | 2.0 |
| process | 2.23 → 2.34 | 0.17 → **0.37** | 2.0 |

Two observations, and the second is the most important unfixed thing in this
report.

**The composed window is now a tier.** Master mean 0.77 screens, passage mean
0.36 — 2.1 : 1, against 6.2 : 1 before. A passage is unmistakably lighter and is
also unmistakably readable. The passages' arrival and departure are now *faster*
than an act's (0.30 and 0.26 of a screen against 0.42 and 0.32), which is §22's
pace contrast: a passage moves decisively and then stands still, where an act
arrives the way something large arrives.

**`system` is as long as an act and this phase did not fix it.** At 3.50 screens
it is the longest chapter on the homepage — longer than the Proof (2.48), longer
than Arrival (2.83), 14% of the whole track. On the phone it is 1.64 screens and
also the longest chapter there. §7 says to flag exactly this, and says not to
solve it by shrinking the font.

It is flagged, and it is not fixed, because the cause is not a duration. Its
frame holds for the same 1.36 screens as every other passage; the length is
entirely its body — three staged layers at 58 svh each, 1.96 screens. And the
58 svh beat is not padding: for one item to be alone in the frame with its
content centred, the beat has to be at least `50 svh + content/2`, which for
these three items is 56, 60 and 62 svh. **58 is already at the floor.** The
chapter is long because it stages three layers one at a time, and the only ways
to shorten it are to stop staging them or to have fewer of them — both content
architecture, which §33 puts out of this phase's budget and §7 warns against
solving by presentation. Recommendation in §P.

---

## F · SILENCE / DEAD-HOLD AUDIT

§8 asks for the two to be told apart. The test used here is deliberately narrow:
a stretch is **perceptually still** when, between two adjacent samples, the
frame has not moved, no statement's opacity has moved, the ink in the viewport
has not moved and the instrument has not moved. The atmosphere is excluded on
purpose — a stretch where the sky is the only thing changing is precisely §8's
good silence, and it is measured separately in §J.

### Still runs, before → after (desktop, screens)

| chapter | before | after | is the sky moving under it? |
|---|---|---|---|
| calibration | **0.76** | **0.25** | no — 150 m of altitude. This was the one true dead hold on the page. |
| initial-ascent | 0.34 | 0.33 | yes, 2 850 m |
| lower-atmosphere | 0.59 | 0.58 | yes, 3 000 m |
| cloud-entry | — | 0.17 | yes |
| cloud-breakthrough | — | 0.12 | yes |
| selected-work | 0.59 | 0.58 | yes, 6 000 m |
| system | — | 0.12 | yes |
| process | — | 0.12 | yes |
| stratosphere-transition | 0.63 | 0.62 | yes, 2 500 m |
| full-stratosphere | 0.34 | 0.33 | yes, 2 000 m |
| destination | 0.85 | **0.79** | **no** — the altitude is 30 000 m at both ends |

The passages now appear in this table where before they did not, and that is the
correction working rather than a regression: a frame that stands still for a
tenth of a screen is a frame that stands still, where before it never did.

**One dead hold remains and it is accepted.** `destination` holds 0.79 screens
in which nothing on the page changes at all — the frame, the type, the
instrument and the sky are all fixed, because the chapter's altitude band is
30 000 m at both ends and the instrument has already withdrawn. It was 0.85 and
its share came down from 2.2 to 1.8; it cannot come further, because a bodyless
act's hold floors at `ACT_HOLD` by construction. It is left because this is the
one frame on the homepage where a still picture *is* the message: the offer, and
nothing competing with it. Recorded here as a number rather than defended as a
feeling.

### Low-ink stretches

Frames carrying under 0.4% of their area in legible type, after:

| screens | length | chapters |
|---|---|---|
| 7.20 → 7.40 | 0.21 | cloud-entry |
| 8.53 → 8.74 | 0.21 | cloud-entry → cloud-breakthrough |
| 9.57 → 10.27 | **0.71** | cloud-breakthrough → selected-work |
| 13.56 → 13.73 | 0.17 | system |
| 16.10 → 16.26 | 0.17 | system → process |
| 20.88 → 21.01 | 0.12 | stratosphere-transition → full-stratosphere |
| 23.75 → 23.96 | 0.21 | full-stratosphere → destination |
| | **1.79 total** | 7.2% of the journey, in seven runs — the same seven as before, totalling 1.56 |

The 0.71 run before the Proof act is the longest silence in the journey and is
the one §8 describes as designed — `cloud-breakthrough` is authored as the
quietest state on the page and the Proof is the loudest. It is under the
existing contract's one-screen ceiling. Everything else is a fifth of a screen,
which is a breath between two thoughts.

**The stretch that was a dead hold and is now shorter:** `cloud-entry`'s
aftermath. Before, its statement was gone at 7.65 while the chapter ran to 9.01
— 1.36 screens, 61% of the chapter, of which the only content was three small
lines moving up the screen. It is now 7.20 → 8.65, and the statement is composed
for twice as long before it goes. The stretch is shorter and better used, but
the chapter is still 2.34 screens for one statement and one 111 px block of
copy, which is the same shape of problem as `system` at a smaller scale. Also
flagged in §P.

---

## G · ALTIMETER TIMING

§15 lists four failure modes. Measured against each.

**Does it disappear abruptly?** No. Both transitions are an 0.8-screen
smoothstep on the desktop and a 0.34 s exponential chase on the phone. Nothing
switches.

**Does it hang around after its purpose?** It did, on the desktop, and this was
the clearest of the §15 findings. The presence curve ramped at *chapter*
boundaries, and Act VI's chapter runs for two screens after its frame has let
go. Measured before: the instrument was in the picture from 20.93 to 24.40 —
**3.51 screens, of which only the first 1.4 were the arrival composition.** The
other 2.1 were a dark dial behind a paragraph block and an eleven-row altitude
table (the frames at 23.05 and 23.54 screens are the evidence).

Corrected by making an exit leave with the **frame** rather than with the
chapter: `INSTRUMENT.vi` now carries `leaves: 1.15`, the centre of a withdrawal
ramp solved so the ramp *begins* where the frame does — `ACT_HOLD − 1` plus half
a presence ramp, scaled by the ratio between the nominal and the rendered track
that `instrumentPresenceAt` converts through. An entrance is unchanged and still
centred on the chapter boundary, because the object has to be fully present by
the time the frame is composed and the six-act contract asserts exactly that.
Act I carries no `leaves` and is unchanged, correctly: a bodyless act's frame and
chapter end together.

After: **20.92 → 22.84, 1.91 screens**, ending 0.54 of a screen after Act VI's
statement. Measured through the chapter: presence 1.00 from 0.45 to 0.86 screens
into the panel, first movement at the unpin, zero by 1.70 — 1.1 screens before
the chapter's editorial block and route list end.

0.95 was tried first and is the reason this number is solved rather than
chosen: at 0.95 the withdrawal began 0.2 of a screen *before* the frame unpinned,
which put the six-act contract's settle point on the shoulder of the ramp and
made it pass or fail depending on where the previous test had left the page. A
flaky contract is a wrong constant, not a flaky contract.

**Does it re-enter too early, or compete with an arriving statement?** It
re-enters at 20.92 and Act VI's statement begins arriving at 20.96 — they arrive
together, and the frame at 21.21 screens shows both mid-movement in different
corners of the frame. This was flagged in the first pass and is **deliberately
not corrected.** Delaying the entrance would put the instrument below full
presence at the act's own settle point, which the shipped contract *"the
instrument returns at the arrival, on the acts' own grid"* asserts at 0.4 of a
screen into the hold — i.e. the design's stated intent is that the object is
already there when the frame composes. Changing that is an art-direction
decision about the arrival, not a timing defect, and §45 puts reopening the
master frames out of scope. Recorded in §P.

**Is the return intentional?** On the desktop, yes and now more so. On the phone
it was not — it never reached its authored value (§C-2). After giving Act VI's
chapter a floor:

| | authored | before | after |
|---|---|---|---|
| stepped walk | 0.44 | 0.36 | **0.41** |
| 900 px/s | 0.44 | 0.34 | **0.39** |
| 1 800 px/s | 0.44 | 0.22 | **0.31** |
| 3 200 px/s | 0.44 | 0.16 | 0.18 |

It still does not reach 0.44, and cannot: the state is only active for 0.40 of a
screen and no chase can finish inside less than two of its own time constants.
What changed is that at the pace a reader actually uses it is now within 11% of
its authored value rather than 23% short, and the scale lands at 0.61 against an
authored 0.62. At a hard fling it remains a ghost, which is true of every
time-driven state on that surface (§C-3).

Portrait presence overall: 2.79 of 14.95 screens, 19% of the journey, in two
appearances — the budget is unchanged, and the object is present for *less*
scroll than before because the faster chase also shortens its fade-out tail.

**§16 · the arrival instrument's visibility.** No material study was opened and
no lighting was changed. The object's silhouette reads against the sky in every
sampled frame of the arrival at 1440 × 900; the frames at 21.68 and 22.16
screens are the composed state. It is dark, which is the accepted presentation.
No correction was required, so none was made.

---

## H · RAPIDKERT TIMING

The clean crop concept is frozen and the asset audit was not reopened. Only
temporal behaviour was measured, at 301 positions across the track.

| object | on screen | composed |
|---|---|---|
| the figure (`~15M Ft`) | 10.23 → 11.56 | 10.65 → 11.31 (0.67 screens) |
| the photograph | 10.23 → 11.56 | 10.65 → 11.31 (0.67 screens) |
| the two routes | 10.32 → 11.56 | 10.65 → 11.31 (0.67 screens) |

**Image arrival, metric arrival and departure are one event.** All three are
inside Act IV's frame and gated by the same `--act-presence`, so there is no
stagger to get wrong, nothing arrives after the eye has left, and the metric is
never on screen without its photograph or vice versa. The image is decoded and
painted before the frame composes at every sampled position. The composed window
is 0.67 screens — the act median to two decimal places, which is the answer to
§13's *"enough attention without becoming a portfolio chapter"*: the Proof gets
exactly what every other master act gets.

No change made.

---

## I · ARRIVAL → ACTION

§19 asks for two distinct beats and gives three failure modes.

| | measured (after) |
|---|---|
| BEAT 1 `Üdv a sztratoszférában.` | composed 20.96 → 22.30 |
| BEAT 2 `Készen állsz felemelkedni?` | composed 23.92 → 24.96 |
| separation | **1.62 screens** |
| overlap | **none** — at no sampled position are both above 0.35 opacity |

- *Both legible simultaneously for too long?* No, and never at all.
- *Action arrives too late?* 1.62 screens is 1.5 s at the middle pace and 2.8 s
  unhurried. That is a beat, not a wait.
- *Arrives instantly?* No.

So the separation is right and the compositions are not merged. **What is wrong
is what fills the gap.** Act VI's body is 0.93 of a screen of editorial
paragraphs plus an eleven-row list of every chapter and its altitude, and that
list is the last thing the visitor reads before the closing offer. In the frames
at 23.05 and 23.54 screens it reads as a technical appendix laid over the
instrument — the densest small-type state in the last third of the page, sitting
in the one silence the design most needs.

The instrument half of that collision is fixed (§G): it now withdraws before the
list arrives. The list itself is content architecture in an accepted
composition, so §33 and §45 leave it alone. Flagged in §P as the highest-value
remaining item in this stretch.

---

## J · BACKGROUND / EASING

### The atmosphere evolves; it does not step (§20)

Measured off the recorded frames rather than off the shader, because §20 is a
question about what the eye sees. Three bands per frame — the top eighth, the
middle, the bottom eighth — sampled as the **median** of each band, so a
headline crossing a band moves the mean and leaves this measure alone.

Across 752 frames of a real-time continuous scroll of the shipped build:

| frame-to-frame change in the painted sky (0–255, worst channel) | |
|---|---|
| median | **1** |
| 95th percentile | **3** |
| maximum | 13.5 |

Every step above 4 reverses on the very next frame — 3.83 → 3.86 → 3.90 screens
goes 8 → 21 → 9, 18.75 → 18.78 → 18.82 goes 5 → 14 → 5 — which is a spike and an
immediate return: the sampler catching a moving element crossing a band, not the
background changing. **There is no snap anywhere in the journey.** No gradient
state change announces a chapter, no lighting shift arrives discontinuously, and
the horizon rises rather than appearing.

The trajectory reads correctly too: near-black at the ground, the top band
lifting from `3,4,9` to `11,12,17` through the cloud region at 8.5 – 10.3
screens, the mid band's blue rising to `8,17,36` at high altitude around 14
screens, then falling back to `2,5,12` toward space by 23. Continuous, and in
the right direction, throughout. **No correction made, and none was needed.**

### There is no playful easing on this page (§21)

Audited exhaustively rather than sampled. The entire homepage — desktop and
portrait, source and built bundle — contains **two** cubic-bezier curves:

| curve | used by | overshoot? |
|---|---|---|
| `cubic-bezier(0.22, 1, 0.36, 1)` | desktop `--ease`: header, buttons, focus states | no — both control points inside 0–1 |
| `cubic-bezier(0.16, 1, 0.3, 1)` | portrait `--mv-ease`: every reveal | no |

Everything else that moves is exponential damping — `damp`/`settle` in
`journey.ts`, the `chase` in `MobileAltimeter` — which cannot overshoot by
construction, or the smoothstep `t²(3−2t)`, which is monotone. There is no
`steps()`, no keyframe animation, no spring, and GSAP is present only as a
scroll-position reader (`ScrollTrigger.create` with `onUpdate`) with no tween
and no ease anywhere in its configuration.

Nothing was elastic, bouncy, overshooting or demonstrative, so nothing was
removed. **§21 verified, no change.**

### Pace contrast (§22)

This pass deliberately made the page *less* uniform, not slower. The passages'
arrival and departure are now **faster** than the acts' (0.30 / 0.26 of a screen
against 0.42 / 0.32) while their composed window is longer, and the portrait
passage statement moves in 0.62 s against the acts' 1.05. The rhythm is now
decisive movement between longer stillnesses, rather than one duration
everywhere.

---

## K · PROCESS CLAUSE REVIEW

### The passage's timing: leave it (§10)

Desktop 2.34 screens, portrait 1.17. §10 says the target is not automatically
under 2.0 and that if it feels right it should be left. It does, and the
frame sequence says why: 0.37 screens of composed statement with the seven
checkpoint names under it, then the three principles and the route as one beat,
then a handover. The chapter is not the page's length problem — `system`, above
it, is 50% longer — and none of `PASSAGE_HOLD`, statement timing, principle
staging or exit silence reads as the cause of anything. **Unchanged, except for
the passage-wide composed-window correction it shares with the other three.**

### The clause: it does remain ambiguous

Current, under the heading `Amit tőled kérünk.`:

> `Minden szakasznak két oldala van, és menet közben látod, nem a végén.`

The intended meaning — collaboration is two-sided, the client has a role,
progress is visible during rather than only at the end — is available in context
and is not the first reading. In Hungarian *"valaminek két oldala van"* is a
settled idiom for *"there are two sides to it"* in the sense of **pros and
cons**, and that reading arrives first. Under a heading about what is asked of
the client the intended sense is recoverable, but the sentence's two clauses
then carry two unrelated claims — one about sides, one about visibility — and
neither disambiguates the other.

Three alternatives, all derived from the approved source meaning, all keeping
the second clause verbatim (it is checkpoint 5's own copy and is not ambiguous).
**None is implemented. This is for human selection.**

| # | Hungarian | chars |
|---|---|---|
| current | `Minden szakasznak két oldala van, és menet közben látod, nem a végén.` | 69 |
| **1** | `Minden szakaszban van dolgod, és menet közben látod, nem a végén.` | 65 |
| **2** | `Minden szakasznak van egy oldala, ami rád tartozik — és menet közben látod, nem a végén.` | 88 |
| **3** | `Minden szakaszt együtt csinálunk végig, és menet közben látod, nem a végén.` | 75 |

**1 · names the client's role and drops the idiom entirely.** The plainest, the
shortest, and the closest match to the heading above it. Loses the "two sides"
image the approved copy chose.
- EN `You have a part in every stage, and you see it as it goes, not at the end.`
- DE `In jeder Phase brauchen wir auch etwas von Ihnen, und Sie sehen es währenddessen, nicht erst am Ende.`

**2 · keeps the image and says whose the second side is.** The minimal
intervention: it changes only the thing that was ambiguous. Longest of the
three, and the em dash matches the passage's existing idiom.
- EN `Every stage has a side that is yours — and you see it as it goes, not at the end.`
- DE `Jede Phase hat eine Seite, die Ihnen gehört — und Sie sehen es währenddessen, nicht erst am Ende.`

**3 · states the collaboration plainly and drops the metaphor.** The quietest.
Says "together" rather than "we ask of you", which softens the heading rather
than answering it.
- EN `We go through every stage together, and you see it as it goes, not at the end.`
- DE `Wir gehen jede Phase gemeinsam durch, und Sie sehen es währenddessen, nicht erst am Ende.`

### How they set

Nothing here can overflow — it is body copy in a flowing column — so the only
cost is line count, and a principle that grows by a line grows the beat it sits
in. Measured in the element itself, at 1440 × 900 and at 390 × 844 and
360 × 800 (the two portrait shapes set identically):

| | desktop hu / en / de | portrait hu / en / de |
|---|---|---|
| current | 1 / 1 / 1 | 3 / 2 / 3 |
| **1** | 1 / 1 / **2** | **2** / 2 / **4** |
| **2** | 1 / 1 / **2** | 3 / **3** / **4** |
| **3** | 1 / 1 / **2** | 3 / **3** / **4** |

**Option 1 is the only one that never costs a line**, and on Hungarian portrait
it saves one. All three add a line in German — on the desktop from one to two,
on portrait from three to four — which is a consequence of German's length
rather than of any of these three phrasings, and is the same cost whichever is
chosen.

### `Indulás → Élesítés`

Accepted and not reopened. The real journey exposed no language problem with it:
at every pace sampled, the term appears only inside the process passage's route
line and never in a frame where it has to carry meaning alone.

---

## L · REVIEW-SCRATCH / TEST HOUSEKEEPING

### The defect

`_build/reports/luxury-art-direction/stage-studio.sh` staged the instrument
study pages into `dist/_studio/` and `dist/_studio-lux/`. `dist/` is two things
at once: the artefact Netlify publishes, and the tree the route, SEO and
conversion audits crawl to decide what the public site contains. A review page
inside it is therefore indistinguishable, to all three gates, from a page we
shipped — `/_studio-lux/index.html` was reported as a public route with no
canonical, no description, no `h1` and no skip link, and the only way to a green
`npm test` was to delete the scratch by hand first.

That is worse than a false failure. A gate that needs manual housekeeping before
it tells the truth has stopped being a gate, and the habit of parking files to
get green is exactly how a real public-route failure gets parked with them.

### The fix

§30 offers two solutions and asks for one to be chosen clearly. **The scratch
now lives outside `dist` entirely** — the first of the two, and the one that
cannot decay, because it removes the possibility rather than adding an
exception. Excluding a namespace would have meant three crawlers each carrying a
rule about a directory that only exists on a reviewer's machine, and a fourth
crawler added later carrying none.

- `stage-studio.sh` builds `_studio/` at the repository root: `index.html`,
  `lux/index.html`, the three `three.js` modules, and the model copied from
  `public/models/` — the **source** it is authored in, rather than a build
  output, so the scratch no longer depends on `dist` existing at all.
- The two pages' import maps are rewritten during staging (`/_studio/three/` →
  `/three/`), so the sources stay readable as documents and the scratch is its
  own document root.
- Serve it with `python3 -m http.server 4327 --directory _studio`.
  `render-instrument.mjs` and `render-lux.mjs` point there.
- `/_studio/` is gitignored, with the reason written next to it.
- The stale `dist/_studio/` and `dist/_studio-lux/` were removed.

**No crawler was changed and no exception was added**, so a genuine public-route
failure is still a failure — which was §30's other requirement. `npm test` is
clean with nothing parked by hand; see §O.

---

## M · BEFORE / AFTER MEASUREMENTS

### The eleven numbers

| # | file | value | before | after | why |
|---|---|---|---|---|---|
| 1 | `acts.ts` | `PASSAGE_HOLD` | 1.25 | **1.36** | passage composed window 0.13 → 0.37 screens |
| 2 | `styles.css` | passage `--ramp-in` | 0.42 | **0.30** | a passage arrives decisively (§22) |
| 3 | `styles.css` | passage `--ramp-in-lead` | 0.3 | **0.28** | the arrival completes 0.02 into the panel, not 0.12 |
| 4 | `styles.css` | passage `--ramp-out` | 0.32 | **0.26** | and departs decisively |
| 5 | `acts.ts` | `GROUND_HOLD` (new) | — | **1.3** | Act I's composed window 1.52 → 1.00; its stillness 0.76 → 0.25 |
| 6 | `journey.ts` | `calibration` share | 1.8 | **1.3** | follows 5 — the share is the panel's floor |
| 7 | `journey.ts` | `cloud-breakthrough` share | 1.2 | **1.4** | it was clamping that chapter's hold below `PASSAGE_HOLD` |
| 8 | `journey.ts` | `destination` share | 2.2 | **1.8** | the closing dead hold 0.85 → 0.79 |
| 9 | `acts.ts` | `INSTRUMENT.vi.leaves` (new) | — | **1.15** | the instrument leaves with the frame, not the chapter: 3.51 → 1.91 screens |
| 10 | `instrument.ts` | `RETAIN.place` | 0.34 s | **0.22 s** | the portrait arrival's return lands: 0.36 → 0.41 of an authored 0.44 |
| 11 | `mobile.css` | `.mv-head --mv-dur-line` | 1.05 s | **0.62 s** | the passage reveal has 19% of a screen of runway, not 52% |

Plus one contract rewritten — `a passage statement is its own tier` in
`six-acts.spec.ts` — because this phase changed the behaviour it covers and the
old assertion could not see it. It compared `--act-hold` on the first master
panel against the first passage panel, and an act publishes that property on
`.act__hold` rather than on the panel, so the master half was an empty string
and the comparison ran against a hard-coded `|| 1.8`. It now computes the
**composed window** for every chapter from the values each panel publishes, and
asserts that the loudest passage is composed for less than the quietest act and
for no more than two thirds of it. That is the property §7 is about, it is
stronger than what was there, and it covers Act I — whose hold is now
deliberately *below* the passage hold while its composed window is nearly three
times the largest passage's, which is exactly the case the old assertion would
have called a regression.

Nothing else changed. No DOM, no content, no copy, no typography, no colour, no
scene grouping, no new element. One change was written, measured, rejected by an
existing contract and reverted — a `min-height` floor on the two portrait summit
chapters; see §C-1, which is the more useful half of that story.

### Composed windows, before → after (desktop 1440 × 900)

| statement | before | after | Δ |
|---|---|---|---|
| calibration | 1.52 | **1.00** | −0.52 |
| initial-ascent | 0.72 | 0.71 | — |
| lower-atmosphere | 0.68 | 0.71 | +0.03 |
| **cloud-entry** | **0.17** | **0.33** | **+0.16** |
| **cloud-breakthrough** | **0.13** | **0.37** | **+0.24** |
| selected-work | 0.80 | 0.71 | −0.09 * |
| **system** | **0.13** | **0.37** | **+0.24** |
| **process** | **0.17** | **0.37** | **+0.20** |
| stratosphere-transition | 0.72 | 0.71 | — |
| full-stratosphere | 0.72 | 0.75 | +0.03 |
| destination | 1.23 | 0.83 | −0.40 |
| **master mean** | 0.91 | 0.77 | |
| **passage mean** | 0.15 | **0.36** | |
| **ratio** | **6.2 : 1** | **2.1 : 1** | |

The five acts that depart are untouched to within a hundredth of a screen. The
whole change is at the two extremes.

\* `selected-work` is the one row that is not exactly reproducible. Two
independent scans of the reconstructed `before` build both report 0.72 where the
original scan reported 0.80 — a difference of two samples on a 601-sample walk,
on the one panel that carries a photograph, whose decode timing moves the
measured panel height and with it the departure ramp. Ten of the eleven windows
and the track length reproduce to the sample. Recorded rather than smoothed
over, and it is why the `before` reconstruction verifies with a tolerance of
three samples on at most one statement rather than with an equality.

### Journey share

| | before | after |
|---|---|---|
| track length | 25.37 screens | **24.96** |
| master chapters | 63.7% | 61.5% |
| editorial passages | 36.5% | 38.7% |
| process passage alone | 8.8% | 9.3% |
| instrument in the picture | 5.80 screens (23%) | **3.74 screens (15%)** |

The track is 0.41 of a screen **shorter**, not longer: Act I and the action beat
gave back more than the four passages took. No supporting section has become
dominant *by share* — but one has by absolute length, and that is `system` at
3.50 screens, addressed in §E and §P.

---

## N · PERFORMANCE

No renderer or harness investigation was opened (§29). Only what the temporal
work itself measured:

- **Frame rate during the recordings.** 60.2 fps sustained, measured by a
  `requestAnimationFrame` counter across two seconds of driven scroll at
  1440 × 900 on ANGLE/Metal. The screencast independently returned 752
  composited frames over the 23.7 s continuous pass at `everyNthFrame: 2`,
  which is the compositor keeping up with the same figure.
- **Renderer.** `ANGLE (Apple, ANGLE Metal Renderer: Apple M4)`. Worth
  recording because the Playwright suite runs on **swiftshader** by design, for
  determinism — so the suite's timings are not evidence about pace and were not
  used as such anywhere in this document. Every temporal measurement here was
  taken on the GPU path.
- **Work removed.** The instrument's presence now ends 1.8 screens earlier on
  the desktop, and `publishInstrument`/`SCENE_PRESENCE` park the renderer when
  presence reaches zero — so the change buys back render time at the end of the
  journey rather than costing any.
- **Work added.** None. No new element, no new observer, no new scroll
  subscription, no new measurement pass. Nine constants and two CSS custom
  properties; the ramp expressions are the same expressions with their literals
  named.

No visible regression, so nothing further was investigated.

---
## §37 · TEMPORAL CONTACT SHEET

`temporal-contact-sheet.png` — 24 samples of the after journey at **equal
journey progress**, not equal time, taken from the natural-pace recording. Equal
time over-samples the places a reader stopped, and those are the places that
already work.

What the sheet contains, counted from the scan at the same 24 equal-progress
positions rather than read off the picture — so the comparison is reproducible
and does not depend on which frame the screencast happened to return:

| of 24 equal-progress samples | before | after |
|---|---|---|
| a passage statement at full strength | 0 | **1** |
| a master statement at full strength | 5 | **7** |
| the closing offer | 2 | **1** |
| the hero | 1 | 1 |
| no display type at all (nothing over 40 px) | 12 | 13 |
| under 0.4% of the frame in legible type | 3 | 3 |
| worst run of consecutive near-empty samples | 1 | 2 |

At a laxer threshold — anything over half opacity, which is closer to what the
eye picks out of a thumbnail — a passage statement appears in 2 samples before
and 2 after, and a master statement in 8 and 8. Both readings say the same
thing in different words: the change is not that statements appear more often,
it is that **when one appears it is at full strength rather than mid-fade.**

Counted per statement rather than per sample, which is the sharper form of the
same question — *how many of the eleven can a 24-sample sheet catch composed at
all?*

| | before | after |
|---|---|---|
| statements caught at full strength | **4 of 11** | **8 of 11** |
| which ones, before | calibration, initial-ascent, selected-work, destination | |
| gained | | lower-atmosphere, **system**, stratosphere-transition, full-stratosphere |

Seven of the eleven were invisible to a sheet at this sampling rate — including
Act III and Act V, two master frames. That is what a composed window of 0.68
screens looks like against a 1.04-screen sample spacing, and it is the clearest
single demonstration that the old spread was too narrow at one end and too wide
at the other.

Two numbers in that table went the wrong way and are worth naming rather than
burying. The count of samples with no display type rose by one, and the worst
run of near-empty consecutive samples went from one to two — both because the
track is 0.41 of a screen shorter while the silences are where they were, so
each sample now covers slightly more ground. Neither is a new silence; §F's
low-ink table is the direct measurement and shows the same seven runs before and
after, with the longest unchanged in kind.

## §38 · MASTER / PASSAGE TIMING TABLE

`timing-map.png` — the desktop journey as four lanes (chapter, composed
statement, instrument, low ink), before over after, on one scroll axis. Desktop
only, deliberately: the portrait document is the same length to the pixel before
and after, so a portrait band would be two identical rows. The portrait changes
are durations and are in §C and §G as numbers.

`scroll share` is the chapter's own slice of the track, measured from where its
frame owns the composition — those tile the 24.96 screens exactly. `panel
height` is the chapter's box, which is a different number and sums to more than
the track, because the sticky stage occupies a screen that the first panel
overlaps.

| chapter | level | scroll share | panel height | statement hold | in ramp | out ramp |
|---|---|---|---|---|---|---|
| calibration | master | 5.7% | 1.98 → **1.48** | 1.52 → **1.00** | 0.42 | none |
| initial-ascent | master | 8.8% | 2.43 | 0.72 → 0.71 | 0.42 | 0.32 |
| lower-atmosphere | master | 11.0% | 2.69 | 0.68 → 0.71 | 0.42 | 0.32 |
| cloud-entry | passage | 9.3% | 2.23 → **2.34** | 0.17 → **0.33** | 0.42 → **0.30** | 0.32 → **0.26** |
| cloud-breakthrough | passage | 6.0% | 1.38 → **1.54** | 0.13 → **0.37** | 0.42 → **0.30** | 0.32 → **0.26** |
| selected-work | master | 10.2% | 2.48 | 0.80 → 0.71 * | 0.42 | 0.32 |
| system | passage | **14.0%** | 3.39 → **3.50** | 0.13 → **0.37** | 0.42 → **0.30** | 0.32 → **0.26** |
| process | passage | 9.3% | 2.23 → **2.34** | 0.17 → **0.37** | 0.42 → **0.30** | 0.32 → **0.26** |
| stratosphere-transition | master | 9.5% | 2.40 | 0.72 → 0.71 | 0.42 | 0.32 |
| full-stratosphere | master | 12.0% | 2.83 | 0.72 → **0.75** | 0.42 | 0.32 |
| destination | master | 4.3% | 2.31 → **1.91** | 1.23 → **0.83** | 0.42 | none |

\* the one row that is measurement noise rather than a change — see the note in §M.

The lengths are deliberately unequal and the differences are intentional: the
Proof and the two summit acts are the longest master frames, the crossings are
shorter than the acts they run under, and the two frames that never depart are
the two that open and close the page. What was *not* intentional was a 6 : 1
spread in how long a statement stands still, and that is what closed.

## §39 · JOURNEY SHARE

| | before | after | note |
|---|---|---|---|
| Master Acts | 63.7% | **61.5%** | 15.35 of 24.96 screens |
| Editorial Passages | 36.5% | **38.7%** | 9.65 screens |
| of which `system` alone | 13.4% | **14.0%** | the one supporting section that is dominant |
| of which `process` | 8.8% | 9.3% | proportionate |
| silence (low-ink runs over 0.10) | 1.56 screens (6.2%) | 1.79 screens (7.2%) | seven runs in both |
| instrument in the picture | 23% | **15%** | |

The passages' share rose two points, and that is the honest cost of making four
statements readable — the acts gave back more scroll than the passages took, so
the *track* is shorter, but the passages' slice of it is larger. §39 asks
whether a supporting section has become dominant: `process`, the one the last
phase compressed, has not. `system` has, and it did so before this phase began.

---

## O · TEST RESULTS

Both primary commands complete clean, and **nothing was parked by hand for
either of them** — which was §30's requirement and the reason the housekeeping
in §L came first.

| gate | result |
|---|---|
| `npm run test:full` | **196 passed, 36 skipped, 0 failed** (15.8 min) — seven projects: desktop, five phone shapes, reduced motion |
| `npm test` | **1172 passed, 125 skipped, 0 failed** (7.9 min) |
| `npm run typecheck` | clean, portal and experiments |
| `npm run audit:seo:check` | 72 documents, **0 failing**, 37 warnings — previously 8 failures, all of them the review scratch |
| `npm run audit:conversion:check` | **no CTA integrity failures** |
| `node scripts/route-audit.mjs` | 66 routes × 12 viewports = **792 checks, 0 failing, 0 broken internal links** |
| `node scripts/process-inventory.mjs` | 40 units accounted for; the process content architecture is untouched |
| `npm run i18n:meridian` | 63 source strings, **0 untranslated** in either en or de |
| `ls dist \| grep studio` | nothing — the scratch is outside `dist` by construction now |

Named specifically by §42:

- **process audit** — `process-inventory.mjs`, above. Unchanged: this phase
  altered no process copy and no process structure.
- **i18n / Meridian validation** — above, and the three candidate clauses in §K
  are *not* implemented, so no locale gained or lost a string.
- **homepage regression suite** — `six-acts.spec.ts` (63 tests across three
  projects) and `full-ascent.spec.ts`, both inside `test:full`. One contract in
  the first was rewritten; see §M for what and why.
- **reduced-motion focused contracts** — the `reduced-motion` project runs the
  full cinematic set, including *every passage is composed, present and legible
  with no clock*, and `public-site.spec.ts`'s *the ascent degrades to a readable
  document* and *the reduced-motion test environment is genuinely active*.
- **history restoration** — `homepage-history.spec.ts`, inside `npm test`.
- **overflow / collision contracts** — *the journey never overflows
  horizontally* and *two statements are never legible in the same frame* in
  `six-acts.spec.ts`; the scan independently reports zero horizontal overflow at
  all 601 positions and zero simultaneous display statements, before and after.

### The three failures this phase caused, and what they were

Recorded because two of them changed the outcome of the work rather than merely
being fixed.

1. **`no chapter contains a tall run of nothing`** — Act VI reported a 35.7 svh
   trailing band against a 34 svh ceiling, from a `min-height` floor I had put
   on the two portrait summit chapters. The contract is right and the change was
   wrong: the design forbids buying scroll with emptiness. Reverted, and the
   finding is now §C-1 and §P item 5 instead of a correction.
2. **`a viewport-height change moves no chapter`** — the same floor, in `svh`,
   moved two chapters by 68 and 136 px when the viewport grew. Also right: every
   vertical size that affects a chapter's position on that surface is
   width-driven so a collapsing Safari toolbar cannot move the page under a
   reader. Reverted with the same rule.
3. **`the instrument returns at the arrival, on the acts' own grid`** — failed
   in one project and passed in another on the same build, which is the
   signature of a constant on a boundary rather than of a flaky test. The
   instrument's withdrawal was starting 0.2 of a screen before Act VI's frame
   unpinned, putting the contract's settle point on the shoulder of the ramp.
   `leaves` was re-solved from 0.95 to 1.15 so the withdrawal begins where the
   frame does; the settle point now has 0.42 of a screen of margin.

## P · REMAINING TEMPORAL LIMITATIONS

Ranked, with what each would cost. None is implemented; §32 limits this phase to
P0, P1 and clear low-risk P2, and each of these falls outside that for a reason
given.

**1 · `system` is the longest chapter on the homepage (3.50 screens desktop,
1.64 portrait), longer than every master act.** §7 and §39's inversion, and this
phase flagged it rather than fixing it because there is no timing lever. Its
frame holds for the same 1.36 screens as every other passage; the length is
three staged layers at 58 svh, and 58 svh is already the arithmetic floor for
one item at a time with its content centred (`50 svh + content/2` gives 56, 60
and 62 for these three). Shortening it means staging fewer layers or staging
them together — content architecture, which §33 excludes and §7 warns against
solving by presentation. **Recommendation:** the `process` passage's own
compression is the precedent — seven items became one beat holding three
principles. The same question should be asked of `system`'s three layers in a
content phase, not a timing one.

**2 · `cloud-entry` is 2.34 screens for one statement and one 111 px block of
copy.** The same shape at a smaller scale: its single `.passage__item` is a
522 px beat holding 111 px of content, and unlike `system`'s three it has no
neighbour to be kept out of the frame, so the 58 svh floor buys nothing there.
Reducing it for that chapter alone is a two-line change and would take about
0.35 of a screen out of the page's emptiest stretch. It is left out because it
needs a per-stage selector in the passage stylesheet on evidence that is a
judgement rather than a threshold, and this phase was asked not to polish
endlessly.

**3 · The Arrival → Action beat is filled with an eleven-row altitude table.**
§I. The instrument no longer sits under it, which was the fixable half. The
list is the last thing before the closing offer and reads as a technical
appendix in the design's quietest moment. Moving or shortening it is an
accepted composition (§45), not a duration.

**4 · The instrument's return co-arrives with Act VI's statement.** §G. Fixing
it means the object is below full presence at the act's own settle point, which
the shipped contract asserts as intended behaviour. It is an art-direction
question about the arrival rather than a timing defect, and reopening a master
frame is out of scope.

**5 · Portrait: Acts V and VI are the shortest chapters on the page** (0.43 and
0.40 screens, against 1.14–1.55 for the other master acts and 1.64 for the
`system` passage). §C-1. Not fixable by timing on this surface: a chapter's
length is its content, and the codebase's own contracts forbid buying scroll
with a blank band or with any viewport-height-derived value. The two contracts
that rejected the attempt are right and were left as they are. Same
recommendation as item 1 — it belongs to a content phase.

**6 · Portrait: nothing on a time-driven reveal lands above ~1 200 px/s.** §C-3.
Halved for the passages by the line-duration change; the rest needs the
reverse-gravity reveal line to move, which is an accepted decision from an
earlier phase.

**7 · The reduced-motion path opens on the instrument fallback, not on the
brand statement.** Measured at 1440 × 900: `.fallback` is a 540 px block in
normal flow at the top of the track (the stage is `position: relative` on that
path rather than sticky), and `Magasságot építünk.` has its top at **915 px** —
fifteen pixels below a 900 px fold. So the reduced-motion homepage's first
screen is the static dial and its explanatory note. This is pre-existing and
structural rather than a timing defect, and it is a DOM/layout change to fix, so
it is recorded rather than corrected. It is the most consequential thing the
§26 inspection found.

**8 · The closing frame holds 0.79 screens in which nothing changes at all.**
§F. Reduced from 0.85 and cannot go further without a second named act hold,
which is not worth a second exception for 0.06 of a screen. Accepted: it is the
offer, and stillness is the message there.

---

## §32 · THE RANKED ISSUE LIST, AND WHAT HAPPENED TO EACH

| | issue | § | action |
|---|---|---|---|
| **P0** | passage statements composed for 0.13–0.17 screens — a flash at every realistic pace | §7, §40 | **fixed** — hold + passage ramp tempo |
| **P0** | the hero holds 0.76 screens in which nothing changes at all | §14, §8 | **fixed** — `GROUND_HOLD` |
| **P1** | the instrument outstays Act VI's frame by 2.1 screens, behind body copy and a table | §15 | **fixed** — `leaves` |
| **P1** | portrait: the arrival's return never reaches its authored value at any pace | §15, §23 | **fixed** — `RETAIN.place` |
| **P1** | `system` is the longest chapter on the page, longer than every act | §7, §39 | **flagged** — no timing lever exists; §P item 1 |
| **P1** | portrait: Acts V and VI are the shortest chapters on the page | §18, §23 | **flagged** — attempted, rejected by two contracts; §C-1, §P item 5 |
| **P1** | the Arrival → Action beat is filled with an eleven-row altitude table | §19 | **half fixed** — the instrument no longer sits under it; the list is composition |
| **P2** | the closing frame holds 0.85 screens of absolute stillness | §8, §19 | **fixed** — 0.85 → 0.79, floored by `ACT_HOLD` |
| **P2** | portrait: a flick outruns the passage reveals | §24 | **half fixed** — `--mv-dur-line`; the rest needs the reveal line |
| **P2** | `cloud-entry` spends 0.46 of a screen holding 111 px of copy in a 522 px beat | §7 | **not fixed** — §P item 2 |
| **P2** | reduced motion opens on the fallback, not on the statement | §26 | **not fixed** — structural; §P item 6 |
| — | playful easing | §21 | **nothing to fix** — audited exhaustively, none exists |
| — | background snaps | §20 | **nothing to fix** — median step 1/255, no discontinuity |
| — | two statements legible at once | §49 | **nothing to fix** — never occurs, before or after |
| — | Rapidkert's timing | §17 | **nothing to fix** — one event, at the act median |
| — | the header CTA through the ascent | §27 | **nothing to fix** — one state for 24.96 screens |
| — | the process passage's length | §10 | **left alone**, as §10 anticipated |

## §40 · AGAINST THE SUCCESS STANDARD

| the standard asks | measured |
|---|---|
| no section feels stuck | the longest run with no change in frame, type or instrument is 0.79 screens, at the closing offer, where stillness is the message. Every other run is under 0.63, and every one of those has the atmosphere moving under it. The one true dead hold — the hero's 0.76 screens over a 150 m altitude band — is 0.25. |
| no important statement flashes by | the shortest composed window on the page is 0.33 screens, up from 0.13. At the briskest pace in the range that is 0.17 s rather than 0.06. |
| master acts land clearly | five departing acts composed 0.71–0.75 screens; two non-departing 0.83 and 1.00. |
| passages feel lighter | composed for 0.36 screens on average against the acts' 0.77 — 1 : 2.1 — and they arrive and depart faster than an act, which is where "lighter" now lives. |
| silence feels intentional | seven low-ink runs, six of them a fifth of a screen, one of 0.71 before the Proof act which §8 authors deliberately. Nothing over the existing one-screen contract. |
| movement feels calm | two easing curves on the whole page, both monotone easeOut; everything else exponential damping or smoothstep. Nothing overshoots. |
| no animation calls attention to itself | the background's median frame-to-frame change is 1/255 and its 95th percentile is 3/255; no snap anywhere. |
| Arrival → Action has a deliberate beat | 1.62 screens between the two, no overlap at any sampled position, and the instrument now leaves before the beat rather than sitting in it. |
| mobile feels like the same brand | the hierarchy, the appearance budget and the reveal grammar hold; the arrival's return now lands. **Two chapters do not** — Acts V and VI are the shortest on the page and cannot be lengthened without breaking the surface's own contracts. This is the standard's weakest point and it is recorded rather than claimed. |
| the journey feels shorter psychologically | the track is 0.41 of a screen shorter in fact, the hero is half a screen quicker to move, the closing offer no longer holds twice as long as any act, and four statements that could not be read now can. |

**Against the failure standard (§41):** no content was added, no effect was
added, no scene was created, no typography was redesigned, the Altimeter's
activity went *down* (23% → 15% of the journey), and the page as a whole got
shorter rather than slower. The one place duration was added — 0.11 of a screen
per passage — was paid for twice over by taking it out of the two frames that
were holding longest.

---

## §44 · REQUIRED REVIEW ASSETS

All under `_build/reports/luxury-art-direction/temporal/`.

| asset | what it is |
|---|---|
| `desktop-natural-before.webm` | 41.7 s, 1440 × 900, reader's pace with dwell at each statement |
| `desktop-natural-after.webm` | 41.3 s, same pacing, same stops |
| `desktop-continuous-after.webm` | 23.7 s, one velocity, no pauses — the choreography test |
| `mobile-natural-before.webm` | 28.1 s, 390 × 844 |
| `mobile-natural-after.webm` | 28.2 s, same document length to the pixel |
| `mobile-continuous-after.webm` | 12.4 s |
| `reduced-motion-journey.webm` | 41.7 s, 1440 × 900, reduced motion active |
| `temporal-contact-sheet.png` | 24 samples at equal journey progress |
| `timing-map.png` | the whole journey as four lanes, before over after |

The pauses in the natural recordings are not invented: they are placed at the
scroll position where each chapter's statement sits a third of the way down the
frame, with a dwell of 240 ms per word, floored at 0.7 s and capped at 2.6 s.
The same stops are used before and after, which is what makes the pair
comparable.

Alongside them: `scan-desktop-{before,after}.json`,
`scan-mobile-{before,after}.json`, `scan-desktop-after-reduced.json` and
`proof-desktop.json` are the raw measurements every number in this document
comes from, and the harness that produced them is in the same directory —
`scan.mjs`, `scan-mobile.mjs`, `film.mjs`, `panels.mjs`, `proof-and-chrome.mjs`,
`clause.mjs`, `msec.mjs`, with `analyse.py`, `analyse-mobile.py`, `ramps.py`,
`background.py`, `sheets.py`, `strip.py`, `sheetcount.py` and `timingmap.py`
reading them. `before.py` and `record-all.sh` are how the matched pair was made.

The per-frame JPEG sequences the analysis was read from are **not** kept: they
are 250 MB of regenerable intermediate, and `film.mjs --frames` reproduces them.

---


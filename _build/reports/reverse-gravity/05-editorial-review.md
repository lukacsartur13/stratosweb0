# Editorial redesign — what changed

Stills: `experiments/screenshots/reverse-gravity/editorial/` — seven moments ×
four viewports (1440×900, 1920×1080, 390×844, 430×932), top and reading
position. The previous state is in `.../after/`.

Preserved exactly, and checked: the ascent / reverse-gravity concept, ordinary
browser scrolling, the Altimeter on both surfaces, logo-led collaborations,
Rapidkert as the sole featured case, `/work` as the portfolio destination, no
second case study, no photo-heavy gallery, no invented figures. Nothing pushed,
merged or deployed.

---

## 1 · Scene by scene

| Scene | Before | After |
|---|---|---|
| **I · Ground** `calibration` | 50px headline, a three-sentence paragraph beneath it, an instrument caption at the foot of the column | 54px statement over five lines; ONE line — the promise — under it; the premise demoted to two hairline annotations at the foot of the column; the instrument caption moved out of the column entirely and pinned against the frame on the far side. The whole scene now stands in one frame, so nothing in it scrolls past anything else |
| **II · Lift-off** `initial-ascent` | 50px headline, two body paragraphs, a technical note | 74px statement in a 639px measure; one supporting line; the four-sentence diagnosis set as **four annotations**, which is the parallel list it was always written as; caption on the frame |
| **III · Ascent** `lower-atmosphere` | six ladder rows at 1.05rem with 0.94rem lines | an altitude index: signal-coloured altitude marks, capability names at display weight (up to 1.6rem), lines dropped to annotation weight |
| **IV · Layer** `cloud-entry` | two body paragraphs | 74px statement; one line; the three symptoms and the verdict as four annotations |
| **V · Breakthrough** `cloud-breakthrough` | the page's one long statement at the same tier as short ones — nine lines, 748px of a 900px frame | held at its own tier (58px), two lines of line-height 1.02, the widest measure. A long line rather than a tall block |
| **VI · Proof** `selected-work` | rail with a heading and a body-size subtitle; feature name 2.1rem; `~15M Ft` at 1.6rem with its label running on beside it at body size | rail on one hairline with the caveat as an annotation; feature name at 2.8rem display; **`~15M Ft` as a 3.4rem display figure** with its meaning ranked under it in small caps; the result as a supporting line; the implementation as an annotation |
| **VII · System** `system` | `1 Mag` at 1.05rem, index 0.75rem, note 0.85rem, nine areas 0.9rem — four sizes inside a tenth of an em | layer number as a 1.5rem figure, layer name at 1.85rem display, note and areas at annotation weight. The chapter's claim is that the three are not peers, and the type now says so |
| **VIII · Method** `process` | seven identical four-column definition lists | checkpoint number as a 1.6rem figure, name at 1.7rem display, the four terms at annotation weight |
| **IX · Thin air** `stratosphere-transition` | two body paragraphs | statement; one line; the altitude fact and its consequence as two annotations |
| **X · Stratosphere** `full-stratosphere` | 43px headline | 51px on two lines — held below the statement tier because "sztratoszférában." is a seventeen-character word and the display ramp broke it mid-word. The emptiest frame on the page: type, Earth limb, nothing else |
| **XI · Arrival** `destination` | ten destinations at body size under the CTA — the largest block in the closing frame | 77px statement; one line; the actions tightened into one block; the stage index compressed into a **two-column altitude ledger** at annotation weight. The whole arrival now stands in one frame |

**Composition, chapter to chapter.** Seven of the eleven are now pinned *whole*
— statement and detail travelling together as one composed frame — and four are
pinned by their statement alone because their detail is taller than a frame and
must scroll. The fork is measured, not authored (`data-hang`), so it follows the
locale and the viewport rather than a table. The copy alternates sides on the
rails it already had, the statement's measure differs in every chapter, and the
two exceptions (`--long`) are authored per scene.

## 2 · How the typographic hierarchy works

**Three layers, three measures, three faces.**

| | what | size at 1440 | measure | face |
|---|---|---|---|---|
| **A · Statement** | the chapter headline | 51–77px | 321–673px, measured per chapter | display, weight 300, leading 0.96, tracking −0.032em |
| **B · Line** | one short sentence | 18px | 34ch | text, `--paper` at 0.86 |
| **C · Note** | captions, asides, instrument labels | 11.5px | 30ch | data, tracked, on hairlines, `--haze` |

Statement-to-note contrast is now **6.4×**, against 3.8× before.

**The statement is sized from its own measure, not from the viewport.**
`font-size: calc(var(--statement-w) * 0.115)`. `--statement-w` is measured per
chapter by `statementRoom()`: the room the instrument leaves on the copy's side,
plus what the dial's *curvature* gives back at the height the statement sits at
— a circle is narrower above its centre than across it, and the copy budget
reserves that room against a bounding box. Chapters whose frame opens therefore
get a bigger statement than chapters whose frame does not, automatically, and
the scale rhythm is a consequence of the geometry rather than a list of
exceptions.

**The statement escapes the body column.** `.panel__inner` is capped at 38vw for
readability — a rule that protects a paragraph and was keeping the headline
medium-sized. The lead band takes `--statement-w` instead and overflows the
column to do it, growing away from the viewport edge and never past the
instrument.

**Two authored exceptions**, both documented in place: the breakthrough (a
sentence, not a phrase) and the stratosphere (a seventeen-character word) are
held at a proportion their own content can carry.

## 3 · How the background supports the type

* **The wash became a stage light rather than a plate.** It is on the two bands
  now, not on the column: a horizontal gradient dense where the words are,
  falling to zero toward the canvas, masked soft at both ends. Constant on the
  block axis, so it works behind a 130px statement and behind a 2 000px column of
  detail without either being tuned for.
* **Density is a property of the scene.** `data-hang='lead'` — the four dense
  chapters, where a case-study photograph and a definition list pass behind the
  statement — get `--wash: 0.96`; the open scenes get 0.84 and read as air.
* **Altitude still drives the air.** Ground haze out by 9 000 m, the cold opening
  widening with the climb, both from the previous pass and both untouched.
* **The frame has a second anchor now.** The instrument caption is pinned
  against the frame on the side the copy is not — below the middle, clear of both
  the dial and the altitude readout. The statement holds one corner and a
  caption holds the other, which is the composition the direction asks for and
  the only element on the page positioned against the frame rather than against
  the text.

## 4 · What was reduced, compressed and restructured

**No word was written, deleted or rewritten.** Four paragraphs were split at
their own sentence boundaries into a supporting line and a set of annotations,
in all three locales, from the strings that were already there:

| key | was | is |
|---|---|---|
| `calibration.lead` | three sentences | `calibration.note.a` + `.note.b` + a one-sentence lead |
| `initialAscent.body.a` | four sentences | `initialAscent.note.a…d` |
| `cloudEntry.body.a` | four sentences | `cloudEntry.note.a…d` |
| `stratosphereTransition.body.a` | two sentences | `stratosphereTransition.note.a` + `.note.b` |

Compressed rather than cut: the closing stage index (254px → ~120px, still ten
real anchors in the same order), the two instrument captions (out of the column
and onto the frame), and the collaboration caveat (body size → annotation).

Preserved and re-ranked rather than reduced: every capability line, every ring
note, all nine areas, all seven checkpoints with their four terms, the Rapidkert
result, its implementation line and its sourced figure.

## 5 · Validation

| | |
|---|---|
| `mobile-homepage-simple`, `homepage-chrome`, `homepage-history`, `homepage-modality` | **249 passed, 0 failed** |
| `playwright.full.config.ts` (`full-ascent`, `portrait-journey`, `ascent`) | **137 passed, 0 failed** |
| `tsc -b --noEmit` | clean |
| mobile-430 (WebKit), three consecutive full-file runs | 26/26 each |

**Mobile cost, against a worktree build of HEAD** (390×844):

| | HEAD | editorial | Δ |
|---|---|---|---|
| document height | 12 640 | 12 843 | +203 (+1.6%) |
| rAF during scroll | 192 | 186 | −6 |
| draw calls | 1 620 | 1 539 | −81 |
| scroll-handler ms | 55.2 | 35.2 | −20.0 |
| style writes | 69 | 83 | +14 |
| `getBoundingClientRect` | 143 | 168 | +25 |
| long tasks | 0 | 0 | 0 |
| CLS | 0.0033 | 0.0033 | 0 |
| drift after stop | 0px | 0px | 0 |
| transfer | 2 150 KB | 2 164 KB | +14 KB |

The +25 rect reads are the reveal net described below. They are on an
`IntersectionObserver` callback, never on a scroll frame, over a set of at most
eleven elements that empties as the visitor descends.

**Two real defects found and fixed rather than accommodated:**

1. **A chapter marker could be stranded invisible on the phone.** An
   `IntersectionObserver` reports crossings, and delivery is coalesced, so two
   scroll steps inside one delivery window can carry a marker past the reveal
   line without either observer seeing it — measured on WebKit at roughly one
   run in three, a different marker each time, left at `opacity: 0` for the rest
   of the session. A position sweep on the exit observer now resolves anything
   already above the frame.
2. **A display line broke a word.** `overflow-wrap: break-word` is inherited
   from the panel and is right for prose; at 77px it set "sztratoszférában."
   across two lines. Fixed by sizing that statement so it never reaches for it,
   and `hyphens: manual` now applies to display lines on both surfaces.

## 6 · Risks and areas that may still need review

1. **German is unverified at the new scale.** Every tier is a `clamp()` with a
   measured term and the statement is capped in `ch` as well as in pixels, but
   the stills are Hungarian. `/de/` should be walked at 1440 and 390 before this
   is called done — "Aufmerksamkeitskrümel" is twenty-one characters and the two
   long-word exceptions were found in Hungarian.
2. **The supporting line is still five lines on the phone** in three chapters.
   The sentences are long and rewriting them was out of scope; the hierarchy
   carries it, but a copy pass could make Layer B genuinely one or two lines.
3. **Four annotations is more than the direction's "one or two".** Kept
   deliberately — they are the content that used to be a paragraph, and §4 asks
   for compression rather than deletion — but it is a judgement call worth
   confirming.
4. **`--statement-w` is measured against the dial, not the rings.** That is the
   existing rule (text may pass a ring, not the dial) and the statement now uses
   more of the room it allows. Worth a look at 1280×800, where the rails are
   tightest.
5. **The scene caption's position is authored, not solved.** It sits at 58svh on
   the far side because that clears the dial and the readout at every viewport in
   the matrix; a viewport far outside it could put the three in the same corner.
6. **The desktop still has no numeric performance baseline.** Nothing regressed
   that can be pointed at, but there is no `mobile-cost` equivalent for the
   cinematic path.

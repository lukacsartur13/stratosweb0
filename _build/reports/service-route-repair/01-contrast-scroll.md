# 01 · Service routes — contrast and scroll timing

**A side pass.** The homepage's Phase 5.2A three-scene depth proof had reached
its stop point — all three gates PASS, nothing pushed, merged or deployed — so
this began after it and touched none of it. §2.

*Scope.* The public secondary and service routes, all three locales. Two colour
defects and one timing defect, all repaired at their cause. Not a redesign: the
cards are the same black, the chips are the same outlined chips, the FAQ is the
same accordion, the altitude rail is untouched.

*Assets.* `contrast-before-after.png` is §40's first sheet,
`scroll-timing-before-after.png` its second, and `recordings-before/` and
`recordings-after/` hold one natural-scroll capture per affected route. The
probes that produced every number below are beside them and are re-runnable.

---

## A · Evidence audit

### The supplied evidence was not in the repository

The brief names an Impact Program screenshot, a Hirdetéskezelés FAQ screenshot,
a Google Ads / Meta Ads comparison screenshot and three service-route screen
recordings. **None of them arrived with the task and none is in the working
tree** — the only loose image at the repository root is a `Screenshot 2026-08-17`
from a week earlier, and every `.webm` under `_build/reports/` belongs to a
previous homepage review.

So PASS 0 was run against the live routes instead of against the pictures of
them. That is the weaker option in one respect and the stronger one in two: it
cannot show which frame of a recording the reviewer was reacting to, but §9 asks
for measured contrast rather than screenshot appearance and §12 asks for actual
scroll progress and document geometry rather than CSS numbers dragged until they
look less wrong. Both are what a probe produces and neither is what a screenshot
contains.

**Every defect the brief describes was located and reproduced**, which is the
check that the substitution worked:

| what the brief reported | what was measured |
| --- | --- |
| Impact cards: large titles reading as black-on-black | `.panel h3` at **1.10 : 1** |
| Impact cards: tags / chips disappearing | `.tags span` at **1.07 : 1**, all twelve |
| Google Ads card: checklist lines disappearing | `.checks li` at **1.08 : 1**, all four |
| Google / Meta asymmetry "not intentional enough" | the Meta card is a different code path — §F |
| FAQ: active question yellow on near-white | **1.09 : 1**, and hover **1.16 : 1** |
| sections entering, holding and releasing at the wrong moment | third build stage gets **5.6%** of its pinned window — §D |

One defect the brief does not mention was found by the same sweep and is
included because it is the same cause: `.field select option` on the Impact
application form, **1.10 : 1**, on a control.

### How it was measured

`probe-contrast.mjs` walks every text-bearing element on a route, composites the
foreground over its real background — these surfaces stack translucent colours,
so `rgba(244,244,244,.78)` on `var(--ink)` inside a `.band--pale` is three layers
before it is a colour — and reports the WCAG ratio at the size the text actually
renders. 1 820 elements across ten routes. `probe-islands.mjs` then ran the same
measurement over all 67 routes restricted to text inside a dark surface that sits
within a light section, which is the §10 consumer list and is exhaustive rather
than sampled.

`probe-timing.mjs` and `probe-rail.mjs` walk each pinned section through its own
scroll range at 40 px resolution and record, per sample, the section's box, its
pin's box, the published progress, the live stage index and whether the pin is
actually stuck. Every timing figure below is a share of the **pinned** window,
which is scale-free and therefore comparable across viewports.

---

## B · Defect matrix

| Route(s) | Section | Element | Static contrast defect | Timing defect | Root cause | Fix |
| --- | --- | --- | --- | --- | --- | --- |
| impact-program × hu/en/de | cause cards | `.panel h3` | **1.10** | — | dark surface states no foreground, inherits `.band--pale`'s `--void` | `.panel { color: var(--paper) }` |
| impact-program × hu/en/de | cause cards | `.tags span` | **1.07** | — | `.band--pale .tags span` outranks `.tags span` and crosses into the dark card | island rule re-asserts inside `.panel`/`.card` |
| impact-program × hu/en/de | application form | `select option` | **1.10** | — | same: paints `--ink`, states no colour | `color: var(--paper)` |
| hirdeteskezeles × hu/en/de | Google Ads card | `.panel h3` | **1.10** | — | as above | as above |
| hirdeteskezeles × hu/en/de | Google Ads card | `.checks li` | **1.08** | — | `.band--pale .checks li` outranks `.checks li` | island rule |
| hirdeteskezeles × hu/en/de | Google Ads card | `.panel p`, `.card__k` | none (9.19, 15.86) | — | already stated explicitly | untouched |
| hirdeteskezeles × hu/en/de | Meta Ads card | all roles | none | — | `.panel--lit` is a light surface; every role stated | **excluded from the fix** |
| every route with an accordion | FAQ | `details[open] summary` | **1.09** | — | `--signal` carrying words on `--paper` | active state redesigned — §G |
| every route with an accordion | FAQ | `summary:hover` | **1.16** | — | same | same |
| kkv, nagyvallalat | build sequence | `.build__k` | **1.09** | — | same | `--signal-ink` on pale |
| szolgaltatasok, ugyfelszolgalat, munkaink | section marks | `.smark__n` | **1.09** | — | same; its sibling `.smark__t` already had a pale variant | `--signal-ink` on pale |
| munkaink, hirdeteskezeles, branding | headline accents | `.sig` | **1.09** | — | the accent-token pair was completed for `.chr` and left half-done for `.sig` | `--signal-ink` on pale |
| every pale band | any control | `:focus-visible` ring | **1.09** | — | same | `--signal-ink` on pale |
| kkv, nagyvallalat | build sequence | 3rd stage | — | **5.6% of the pinned window; 880 px of dead scroll after** | progress normalised over section height, not pin travel | measure the pin |
| szolgaltatasok | services rail | last 2 panels | — | **34–45% of travel happens unpinned** | same | same |
| kkv, nagyvallalat (< 860 px) | build sequence | stages 2 and 3 | — | visible but `aria-hidden="true"` | the pinned code path ran on a layout that is not pinned | `aria-hidden` only while genuinely sequenced |

Deliberately **not** changed, classified and explained in §C: the altimeter tape
labels and the quiz keyboard hint.

---

## C · Contrast findings

### The two root causes, stated as rules

**A component that paints its own background must state its own foreground.**
`.panel` and `.card` set `background: var(--ink)` and said nothing about colour.
On a dark section that is invisible — they inherit `--paper` and are correct by
accident. Inside `.band--pale`, which sets `color: var(--void)` on the section
and then re-states each text role beneath it as a descendant rule, they inherited
black. The descendant rules then crossed the boundary too, because CSS has no way
to say "stop at a dark surface" and nothing had asked it to.

**`--signal` is 1.09 : 1 against `--paper`.** Fine for a 2 px rule, unreadable
for a word. The system had already solved this once for the other accent — `.chr`
is `#9CC6E4` on dark and `#2F6E96` on pale, same hue, same saturation, dropped in
lightness until it clears — and simply never completed the pair for the signal.

### The measured roles, by classification

**Essential — information the business is trying to convey. Repaired.**

| role | before | after |
| --- | --- | --- |
| `.panel h3` | 1.10 | **17.30** |
| `.panel .checks li` | 1.08 | **10.66** |
| `.panel .tags span` | 1.07 | **8.73** |
| `.field select option` | 1.10 | **17.30** |
| `.faq details[open] summary` | 1.09 | **19.09** |
| `.faq summary:hover` | 1.16 | **19.09** |
| `.build__k` | 1.09 | **5.60** |
| `.smark__n` | 1.09 | **5.60** |
| `.sig` | 1.09 | **4.56 – 5.60** |

**Controls. Repaired.** `:focus-visible` on a pale band was a yellow ring at
1.09 : 1 — present, and very nearly not there. Now `--signal-ink`, 5.60 : 1.
`select option` is in the table above.

**Decorative — §6 applies, left quiet on purpose.**

*The altimeter tape*, `.tick__n`: 235 instances across all ten routes, 9 px,
`--haze` over a translucent gradient. It is generated decoration — one label per
1 000 m of a scrolling altitude tape — its container is `aria-hidden="true"` and
`pointer-events: none`, and the live altitude readout is a separate element with
its own signal-bordered panel. This is exactly §6's "decorative indexing" and
§30's "removal of the altitude rail", and it is untouched.

A measurement caveat worth stating rather than burying: the first sweep reported
these at 1.33 : 1, and that figure is **not reliable**. `.rail` is painted with a
`linear-gradient` and a `backdrop-filter`, so it has no `background-color` for a
composite walk to find; the true value varies along the rail's own width and with
whichever section is behind it. The classification does not depend on the number.

**Left alone, and flagged rather than fixed.**

*`.quiz__enter`* on arajanlat, the "ENTER ↵" hint beside the quiz's start
button: `#4d4d4d` on black, **2.48 : 1**, 10 px. It is a supplementary keyboard
hint with the actual button next to it, so nothing is unreachable — but it is
neither clearly decorative nor clearly essential, and it is a hardcoded grey
rather than a token. It is outside all three reported defect families and
changing it would be the bundling §38 forbids. **Recommended, not applied:**
lift to `#6f6f6f` (4.6 : 1) — one line, no design consequence.

*The deliberately muted small roles* — `.eyebrow` (3.90 on paper, 4.13 on ink),
`.muted`, `.stat__l`, `.field label`, `.note`, `.form__note`, `.tlink`,
`.proc dt` — sit at **3.90 to 4.26**, just under AA for their size. These are the
site's editorial voice, they are readable, and `--haze` is consumed by all 67
routes and by chrome.css which the homepage links. Lifting them is a global
typographic decision, not a repair of accidental invisibility, and §30 and §38
both point away from making it here. Recorded as a finding in §N.

---

## D · Scroll timing findings

### One cause, and the primitive that documents the intent it was breaking

`motion.js` drives every primitive from one number: how far an element has
travelled through its own range. For a pinned section that range was
`r.height + vh * lead` with `lead = 0` — the section's full height. But **a
pinned section is only readable while its pin is stuck**, and that window is
`height − pinHeight`.

The consequence is arithmetic. The pin releases at
`p = (height − pinHeight) / height`; progress does not reach 1 until `p = 1`. So
the last `pinHeight / height` of every pinned sequence ran *after* the pin had
let go and the section was leaving the screen. On the build pages that is 29.4%
of the sequence. The third of three stages begins at `p = 0.667` and the pin
releases at `p = 0.706` — **120 px, 5.6% of its own window** — and is then
followed by 880 px in which the progress bar keeps filling over a section the
reader has already left.

`horizontalRail` states the intent this violates in its own comment: the section
is one viewport taller than its travel *"so the rail's speed is roughly the
page's natural scroll speed"* and the extra viewport holds the end state. It was
spending that viewport still animating.

This maps onto the brief's §11 symptom list precisely — "cards remain pinned
after the reader has finished with them" (stages 1 and 2 taking ~47% each),
"content appears too late relative to the section boundary" and "sticky content
releases too late" (stage 3 arriving as the pin lets go), and "scroll continues
while perceptually nothing useful changes" (the 880 px tail).

### Measured, three viewports

**Build sequence — share of the pinned window per stage**

| viewport | before | after |
| --- | --- | --- |
| 1280 × 800 | 46.9 / 46.9 / **6.1%** | 34.7 / 32.7 / 32.7% |
| 1440 × 900 | 48.1 / 46.3 / **5.6%** | 33.3 / 33.3 / 33.3% |
| 1920 × 1080 | 47.7 / 47.7 / **4.6%** | 33.8 / 33.8 / 32.3% |

**Progress still advancing after the pin released**

| viewport | before | after |
| --- | --- | --- |
| 1280 × 800 | 800 px | **0** |
| 1440 × 900 | 880 px | **0** |
| 1920 × 1080 | 1080 px | **0** |

**Services rail — travel completed while still pinned**

| viewport | before | after |
| --- | --- | --- |
| 1280 × 800 | 66.3%, panel 2 of 4 | **99.1%, panel 4 of 4** |
| 1440 × 900 | 65.8%, panel 2 of 4 | **98.6%, panel 4 of 4** |
| 1920 × 1080 | 55.2%, panel 2 of 4 | **98.3%, panel 4 of 4** |

The residual 1–2% is the 40 px sampling step. The defect was **worst at
1920 × 1080**, which is why §17 asks for more than one viewport: the section
heights are authored in `vh`, so a taller viewport makes the pin a larger
fraction of the section and the unpinned tail longer.

### What was *not* a timing defect

§26 asks each low-contrast case to be sorted into "the active state never
activates", "the active state is itself too dark", or both. **Every contrast
defect here is Case B.** `data-reveal` is a one-shot opacity reveal that
unobserves after firing, not a scroll-driven emphasis system; the dark cards were
fully revealed and still unreadable. The one role that *is* scroll-driven,
`.build__k`, was measured in its `.is-on` active state and was 1.09 : 1 there —
so the sequence reached its intended state and the intended state was wrong. The
stage progression and the card contrast are two independent defects on the same
two pages, and neither was compensating for the other.

---

## E · Impact Program

The two cause cards, `FÜGGŐSÉG ÉS MENTÁLIS EGÉSZSÉG` and `GYERMEKEK`, are
`.panel` elements inside a `.band--pale`.

| element | before | after | note |
| --- | --- | --- | --- |
| card heading | **1.10** | 17.30 | inherited the pale section's `--void` |
| paragraph | 9.19 | 9.19 | `.panel p` was already stated — untouched |
| tags | **1.07** | 8.73 | pale-band chip rule reached across the boundary |
| tag borders | invisible | `var(--hair)` | same rule, same crossing |
| yellow case index | 15.86 | 15.86 | `.card__k` — untouched |
| card background | `--ink` | `--ink` | unchanged |

The cards are still black, still quiet, still bordered by a hairline; the chips
are still outlined rather than filled. §20's "legible without making the cards
visually loud" is met by giving the surface the foreground it already implied,
not by adding weight to anything.

---

## F · Hirdetéskezelés — the Google / Meta comparison

The asymmetry the review noticed is real, and it had a single cause that also
explains why only one of the two cards was affected.

`.panel--lit` — the Meta card — sets `background: var(--signal)` **and**
`color: var(--void)`, and then states every role beneath it explicitly:
`.panel--lit p`, `.panel--lit .checks li`, `.panel--lit .card__k`. It is a light
surface that wants the pale band's ink, and it got it. Nothing inherited.

The Google card sets `background: var(--ink)` and stopped. Everything that merely
inherited went black, and every role the pale band re-states as a descendant rule
was overridden across the card boundary.

| element | Google before | Google after | Meta (unchanged) |
| --- | --- | --- | --- |
| title | **1.10** | 17.30 | 11.22 |
| body | 9.19 | 9.19 | 8.59 |
| checklist | **1.08** | 10.66 | 12.63 |
| eyebrow / `card__k` | 15.86 | 15.86 | 5.44 |

`.panel--lit` is explicitly excluded from every island rule, so the black/yellow
comparison concept is preserved exactly. §21's "must not make both cards visually
identical" is contracted in the test suite, not just asserted here: the Meta
card's background is checked to still be signal yellow.

No hover or scroll reveal is involved in either card — both are static once
`data-reveal` has fired.

---

## G · Hirdetéskezelés — the FAQ

### What it was

`.faq details[open] summary { color: var(--signal) }` and
`.faq summary:hover { color: var(--signal) }` — the open question and the hovered
question set in yellow on a `.band--pale`. Measured **1.09 : 1** open and
**1.16 : 1** hovered, against **19.09 : 1** for every closed question.

Two things were wrong beyond the number. The open question is the one line on the
page a reader is certainly reading, and it was the hardest line on the page to
read. And hovering made a question *less* legible — §5 inverted: not "hover is
required for legibility" but "hover destroys it".

### What it is now

The question keeps full authority in every state — it is the content — and the
signal moved to the two things that are genuinely state and carry no words:

* **the mark at the end of the row.** `+` becomes `×` by rotation, as before, and
  now also takes the accent. It was drawn in `currentColor`; it now reads a
  `--faq-mark` custom property so it can be coloured independently of the text.
* **the rule under an open entry.** `details[open]`'s bottom border takes the
  accent, so an open entry is bracketed rather than repainted. No layout change,
  because the border already existed.

Both are structural elements large enough for the accent to read at the contrast
it actually has, which is what §6 permits and §5 requires. §7's preferred
hierarchy — question dark, yellow as a small state signal — implemented as
written.

| state | question | mark | rule under entry |
| --- | --- | --- | --- |
| closed | `--void`, 19.09 | quiet, `currentColor` | hairline |
| hover | `--void`, **19.09** | **accent** | hairline |
| open | `--void`, **19.09** | **accent**, rotated 45° | **accent** |
| answer | `rgba(0,0,0,.72)`, 8.81 | — | — |

### A consequence on routes that had no defect — stated plainly

The accordion appears on a **dark** band on rolunk and impact-program, and on a
**pale** band on kkv, nagyvallalat and hirdeteskezeles. On dark, `--signal` is
15.86 : 1 and the open question in yellow was perfectly readable — there was no
contrast defect there at all.

The redesign applies to both, so **on those two routes the open question changes
from yellow to off-white** and the yellow moves to the mark and the rule, exactly
as on pale. That is a visual change on routes the review did not flag, and it is
deliberate: §8 asks that the state hierarchy not require the active title to be
yellow, and one accordion that behaves two different ways depending on the band
behind it is a worse component than one that behaves the same way everywhere. The
accent itself is untouched on dark — `--faq-accent` resolves to full `--signal`
there, contracted in the suite.

If the yellow title is wanted on dark bands specifically, that is one rule
(`.band:not(.band--pale) .faq details[open] summary { color: var(--signal) }`)
and it is the user's call, not this pass's.

### The rest of §22's audit

* **accordion height animation** — none exists; `<details>` opens natively. There
  is nothing to clip and nothing to mistime.
* **no scroll jump on expanding** — native `<details>`, no height animation, no
  scroll manipulation anywhere in the accordion. Nothing can jump.
* **no clipped answer** — `.faq__a` has no height constraint.
* **closing timing** — the mark's rotation is the only transition, `.4s`, and it
  is symmetric.
* **plus / × alignment** — unchanged; the mark is absolutely positioned against
  the summary's own box and the repair did not move it.
* **keyboard** — `Tab` reaches the summary, `:focus-visible` matches, the ring is
  drawn at 2 px in `--signal-ink` (it was yellow at 1.09 : 1 on paper), and
  `Enter` opens the entry with the question and answer both readable. Contracted.

---

## H · Other affected service sections

**The build sequence** on kkv and nagyvallalat: a timing defect (§D) and a colour
defect (`.build__k` at 1.09 on the pale band) that are independent of each other.
The yellow that signals *which* step is live stays yellow — that is
`.build__fill`, the rule that fills across the top, which is a rule and can
afford the contrast it has. The step's *name* takes the pale-band ink.

**The services rail** on szolgaltatasok: the timing defect only. Its four panels
are readable throughout.

**Section marks** on szolgaltatasok, ugyfelszolgalat and munkaink: `.smark__n`,
the numeral beside each section name, at 1.09 on pale. Its sibling `.smark__t`
had been given a pale variant long ago; the numeral had not. It stays the quieter
half of the pair — it is just present now.

**Headline accents** on munkaink, hirdeteskezeles and branding: `.sig` at 1.09 on
pale, including one instance at 64 px. These are sentences — "Ügyfelet.", "hat
állomás van." — not ornaments beside them.

**Dark card grids** (§24): audited and found sound. `.card` and `.panel` on dark
bands measure 8.73 to 17.30 across every role; no card is subdued to the point of
being unreadable, and no card's contrast is scroll-driven. `.card:hover` changes
only the border and a 2 px top rule, never text legibility, so nothing depends on
hover. The only unreadable cards were the ones sitting in pale bands, which is
§E and §F.

**The mobile accessibility defect.** Under 860 px the build pages drop the
container to `height: auto` and the pin to `position: static`, and the three
stages become an ordinary stacked list — all of them on screen, all read in
order. The pinned code path still ran there and marked two of the three
`aria-hidden="true"`, so **two thirds of the sequence was visible to the eye and
absent from the accessibility tree on every phone**, on six routes. Found by the
responsive pass rather than reported, fixed with the sequence state, contracted.

---

## I · Root causes — shared or route-specific

**Shared, fixed once.**

1. *Dark surface states no foreground.* `.panel` and `.card` now declare
   `color: var(--paper)` beside the background they already declared, and two
   island rules re-assert the roles `.band--pale` overrides explicitly. Six
   routes across three locales; the rule prevents recurrence on any future page
   that drops a dark card into a light section.
2. *The accent-token pair was half-finished.* `--signal-ink` completes for the
   signal what `#2F6E96` already did for the chrome accent. §28 — the root cause
   really is a token, and its consumers were verified before it was introduced.
3. *Pinned progress measured the section, not the pin.* One expression in
   `pass()`, opt-in per primitive.

**Route- or component-specific, fixed in place.** §29.

4. *The FAQ's active state.* Not "yellow is wrong" — yellow is right, and it is
   still there. The component was using it on the one element that carries the
   words. Redesigned within the FAQ, and `--signal` itself is unchanged, so the
   other ~40 rules that use it on dark surfaces are untouched.
5. *`.field select option`.* One rule, same rule as the panels.

**Explicitly not changed.** `--signal` (#FFEE25), `--haze`, `--paper`, `--ink`,
`--void`, and every existing token. `--signal-ink` is additive.

---

## J · Fixes

Three files. 144 insertions, 13 deletions.

**`assets/css/main.css`**

* `.panel`, `.card` — `color: var(--paper)`, beside the background they set.
* `.band--pale { --signal-ink: #6E6200 }` — hue 53.5 and full saturation, both
  `--signal`'s own, at 5.60 : 1 on paper. Defined here rather than in chrome.css's
  token block *on purpose*: the homepage links chrome.css and does not link this
  file, so a token only pale bands can use has no business being visible to it.
* two island rules for `.checks li` and `.tags span`, both excluding
  `.panel--lit`.
* `.band--pale .sig`, `.band--pale .smark__n`, `.band--pale :focus-visible`.
* `.field select option` — `color: var(--paper)`.
* the FAQ active state — §G.

**`assets/css/page-build.css`** — `.band--pale .build__k`.

**`assets/js/motion.js`**

* `pass()` measures the pin when one is registered:
  `travel = r.height − pin.height`, falling back to the original expression when
  `travel <= 4`. Both boxes are read live rather than derived from `vh`, which is
  what makes it correct across `svh`/`dvh` and a moving mobile toolbar — the
  pin's height is whatever the pin actually got, not what a unit promised. §17.
* `register()` takes an optional pin selector. **Opt-in, not inferred**, because
  the header and the Arrival footer are registered by this file on the homepage
  as well as on the 66 generated routes and their ranges are correct as they
  stand. Only `stickyStage` and `horizontalRail` pass one.
* `stickyStage` manages `aria-hidden` only while the sequence is genuinely
  sequenced — §H.

### The homepage is untouched, structurally

Not by care but by construction, which is the only version of this claim worth
making. §2.

* **CSS.** The homepage links `chrome.css`, `type.css`, `transitions.css` and its
  own bundle. It does not link `main.css`, `motion.css` or any `page-*.css`.
  Every rule above is in a file it does not load.
* **JS.** It does load `motion.js` — but there is no `.stage__pin` or
  `.rail__pin` anywhere in the homepage document or its bundle, so
  `querySelector` returns `null`, `travel` is 0, and `pass()` takes the original
  branch. The journey's own eleven panels are inside `data-motion-external` and
  were already excluded at boot.
* **Verified empirically.** With every change reverted and the site rebuilt, the
  homepage's settled `scrollHeight` (24 106 px) and its header's end state after
  a full-document jump are byte-identical to the repaired build.

---

## K · Responsive

Five viewports — 1920 × 1080, 1440 × 900, 1280 × 800, 430 × 932, 390 × 844 — with
every repaired role measured and the document checked for sideways overflow.

**No role below 4.5 : 1 at any viewport. No horizontal overflow at any viewport.**

The timing repair behaves correctly at each width because it measures rather than
assumes: at 1920 the pin is a larger share of the section and the defect was
worse (4.6% for stage 3 against 5.6% at 1440), and the fix lands on even thirds
at all three. Below 860 px both pinned sections are authored as flowed layouts
instead — the build sequence becomes a stacked list, the rail becomes a vertical
list — so `travel` is 0 there and the original range applies unchanged.

That fallback is not decoration. An earlier draft of the fix used the pin
measurement unconditionally, which on mobile made `span` collapse to 1 px and
would have made the whole sequence flash past in a single pixel of scroll. It was
caught by measuring mobile rather than assuming the desktop result generalised —
§17's actual point.

---

## L · Reduced motion and accessibility

**Reduced motion.** `register()` commits `update(1)` and returns before anything
else, so the timing change cannot reach this path at all. `stickyStage` marks the
section `is-static`, shows every stage and clears every `aria-hidden`. Contracted:
each stage visible, `opacity: 1`, not `aria-hidden`, and its label measured
readable — plus the dark cards and an opened FAQ entry readable with no scrolling
whatsoever. §35 is satisfied by construction rather than by tuning: none of the
repaired contrast is scroll-driven, so there is no dim pre-reveal state to be
stuck in.

**Focus.** `:focus-visible` is drawn on every route; on pale bands it was a yellow
ring at 1.09 : 1 and is now `--signal-ink` at 5.60 : 1. FAQ summaries are
reachable by `Tab`, match `:focus-visible`, and open on `Enter`.

**Nothing depends on hover.** The FAQ's hover state no longer changes the
question's colour at all; `.card:hover` never did affect text.

**Semantics.** Section order contracted on the most-changed route. The mobile
`aria-hidden` defect in §H is repaired.

**Small text (§31).** The roles at 3.90–4.26 are 10–12.8 px. Where size is the
problem rather than colour, this pass does not pretend otherwise — see §N.

---

## M · Test results

**New:** `tests/service-route-legibility.spec.ts`, 26 tests × 4 viewport
projects. It asserts measured contrast ratios and shares of the pinned window —
never colour values, never pixel offsets — so it survives the accent being tuned
and the section heights being re-authored, and still fails the bug by a wide
margin.

| run | result |
| --- | --- |
| new spec, all projects, repaired | **98 passed, 6 skipped, 0 failed** — stable across repeated runs |
| new spec, all projects, **changes reverted** | **16 failed** — every repaired defect is caught |
| `public-site`, `structured-data`, `not-found`, `asset-packaging`, `mobile-homepage-simple`, `homepage-modality` | **254 passed, 92 skipped, 0 failed** |

The six skips are by design: both pinned contracts skip where the layout is
flowed rather than pinned.

### Two failures in this file's own first drafts, recorded because they are the interesting part

*It passed against the broken stylesheet.* The first version read the FAQ's
colour immediately after clicking, and `summary` carries `transition: color .3s`
— so it caught the open question at almost-black on its way to yellow and called
it legible. Reads now wait for the colour to stop moving. A settled state is the
only one worth asserting about.

*It reported that a section never pins.* The sampling loop scrolled and then
waited two frames, but `main.css` sets `scroll-behavior: smooth` on the root, so
each `scrollTo` started an animation the loop never let finish: 97 samples, none
of them pinned. It scrolls with `behavior: 'instant'` now, and the probes were
corrected the same way before any number in §D was taken.

A third would have been worse. The reduced-motion block was written with
`test.use({ reducedMotion: 'reduce' })`, which `tests/helpers/reduced-motion.ts`
documents as not reliably reaching `matchMedia()` on Playwright 1.62.1 in this
project — it measured a stage mid-transition at 0.599 opacity and read it as a
reduced-motion defect. It uses `enableReducedMotion(page)`, which proves the
emulation took, as that file insists.

### A pre-existing failure, not from this work

`tests/homepage-chrome.spec.ts` fails four to six reduced-motion assertions about
the flight deck's state machine. The test expects the header to reach `journey`
after a full-document jump and it reaches `destination` — a third state the
in-progress Phase 5.2 homepage work introduced and this expectation predates.

It **fails 6 out of 6 runs with every change in this pass reverted**, on a fully
rebuilt tree. An earlier reading of mine that the baseline was clean was taken
against a stale homepage bundle — `dist/index.html` had not been regenerated —
and was wrong. It is recorded here so it is not attributed to this pass, and it
is the homepage work's to close.

---

## N · Remaining limitations

1. **The supplied evidence was never seen.** §A. Every named defect was
   reproduced and measured, but if a recording shows a timing problem that is not
   the pin-measurement defect, this pass did not look at it. The four
   natural-scroll recordings in `recordings-after/` are the offer to compare
   against.

2. **The muted small roles remain at 3.90–4.26 : 1.** `.eyebrow`, `.muted`,
   `.field label`, `.note`, `.form__note`, `.tlink`, `.stat__l`, `.proc dt` —
   readable, deliberate, and just under AA for their size. Repairing them means
   moving `--haze` or the size ramp, which reaches all 67 routes and chrome.css,
   which the homepage links. That is a typographic decision for a pass that has
   the homepage in scope, not a correction of accidental invisibility. §31's
   "where size itself is the problem, do not solve only through colour" applies
   to several of them and neither lever was pulled here.

3. **`.quiz__enter` at 2.48 : 1** is left as-is with a one-line recommendation.
   §C.

3a. **The FAQ redesign changes two routes that had no defect.** rolunk and
   impact-program carry the accordion on a dark band, where the yellow open
   question was readable; their open question is now off-white with the accent on
   the mark and the rule. Deliberate and reversible in one rule — §G.

4. **The altimeter tape's true contrast is unmeasured.** Its container is
   translucent over a gradient with a backdrop filter, which a composited-colour
   walk cannot resolve; a real answer needs pixel sampling per section. The
   classification as decorative does not depend on it, but the 1.33 figure the
   first sweep produced should not be quoted.

5. **WebKit is not covered for the new spec.** The suite's `desktop-webkit`
   project ignores it by the same `testIgnore` list that governs the other
   engine-specific specs. Sticky behaviour and `svh` resolution differ enough on
   WebKit that the timing contracts would want their own thresholds; the contrast
   contracts would port unchanged.

6. **`_build/reports/**/*.webm` is now ignored.** No recording under
   `_build/reports/` had ever been tracked, but nothing said so, and this pass's
   captures are 35 MB. Same reasoning as the existing rule for stills.

---

### Acceptance, against §42

| | |
| --- | --- |
| no essential dark-card text disappears into the card | 1.07–1.10 → 8.73–17.30, six routes, three locales |
| no active FAQ title disappears into the white surface | 1.09 → 19.09, in every state including hover |
| subdued states still feel premium | the cards are the same black; only inherited colour changed |
| scroll-controlled text reaches its readable state | `.build__k` measured in `.is-on`; §26 Case B, fixed as colour |
| sections enter and release at sensible moments | even thirds at three viewports, was 47/47/6 |
| no long accidental half-entered states | 0 px of unpinned progress, was 800–1080 px |
| no unnecessary empty scroll bands | the rail's last viewport now holds a finished frame |
| dark → light transitions feel intentional | untouched; the transitions were never the defect — §D |
| mobile receives the same correction | contrast at 390 and 430; the sequence is flowed there, plus the `aria-hidden` repair |
| reduced motion is fully readable | contracted per stage, plus cards and FAQ with no scrolling |
| no homepage Phase 5.2 work changes | structurally impossible, and verified empirically — §J |

# Stratos — the typographic voice

**Phase 1.5. Study only. Nothing in this pass touches production.**

`experiments/src/full/styles.css`, `scene.ts`, `composition.ts`, `journey.ts`,
the scroll mechanics, the Altimeter choreography and the mobile route are all
unchanged. Nothing is pushed, merged or deployed. The working tree carries
this document, nine frames, five sheets and the scripts that produced them.

| | |
| --- | --- |
| `02-typography-study.md` | this document, §A–§J |
| `typography/a1…c3.png` | nine studies, 1440 × 900, three directions × three scenes |
| `typography/sheet-1…3-*.png` | one sheet per direction |
| `typography/sheet-4-comparison.png` | **all nine together — the deliverable that decides the phase** |
| `typography/sheet-5-locale-stress.png` | the same system in English and German |
| `typography/l1…l4.png` | the locale frames |
| `typography.html` · `typography.css` | the studies' source. No production CSS is loaded |
| `fonts.css` | the three provisioned families, ranges verbatim from `assets/fonts/MANIFEST.json` |
| `font-audit.*` · `italic-probe.*` | §B, measured rather than asserted |
| `locale-probe.mjs` · `locale-fit.json` | §I, 42 settings measured against the 1 232 px column |
| `shoot-typography.mjs` | measures the nine frames, then photographs them — and refuses to photograph a frame that fails |
| `typography/measurements.json` | the numbers behind §F–§H |

**Every word in the nine frames is verbatim** from
`experiments/src/full/locales/messages.ts` and `content.ts`. No copy was
written for this study. What changes between the three directions is the
setting — face, size, width, weight, tracking, leading, case, line break and
position — and nothing else. Same words, same margin, same instrument, same
monochrome palette in all nine, so the comparison has exactly one variable.

**There is no colour in this study.** No yellow, no blue, no glow, no
gradient grading, no particles, no 3D, no animation. `--signal` does not exist
in `typography.css`. The question this phase asks is whether the typography is
expensive *on its own*, and the only way to ask it honestly is to take
everything else away.

---

## A · Why the current typography still reads as agency, not as luxury

Not opinion. Each of these is a countable property of
`experiments/src/full/styles.css` as it stands.

### A1 · There are 32 font-size declarations, and the middle is where they live

Twenty-eight distinct values. The ceiling is `clamp(3rem, 17cqw, 9rem)` and
the floor is `0.6rem`, and between them sit **six** declarations whose maximum
lands in the 1.7 rem – 4.6 rem band:

```
clamp(2rem,   calc(var(--statement-w) * 0.115), 4.6rem)
clamp(2.1rem, 1rem + 4.4vw,                     4rem)
clamp(2.2rem, 5vw,                              3.4rem)
clamp(2rem,   6cqw,                             3.4rem)
clamp(1.9rem, 4vw,                              2.8rem)
clamp(1.3rem, 2.2vw,                            1.7rem)
```

This is precisely the ladder §7 of the direction asks to delete: a headline, a
subtitle, an intro, a lead, a body, a label. Six graded steps between the
monument and the whisper is what a design *system* looks like. It is not what
a brand voice looks like. A luxury page has two sizes that matter and a third
that is almost invisible; a SaaS page has seven, because seven is what you need
when every element must be able to justify its own importance.

### A2 · Four weights are carrying hierarchy, and one of them is Light

Counted across `font-weight` and the `font:` shorthand:

| weight | declarations |
| --- | --- |
| 300 Light | 10 |
| 400 Regular | 18 |
| 500 Medium | 10 |
| 600 Semibold | 2 |

§9 rules out exactly this. Light at ten uses is the tell: 300 is what a
grotesk reaches for when it wants to *look* refined without changing anything
about the composition, and at display size it reads as thin rather than as
considered. The direction asks the homepage to be solved in Regular and
Medium. It currently is not.

### A3 · Tracking is a design device 45 times over

Forty-five `letter-spacing` declarations. Wide tracking is the single most
common shorthand for "premium" and it is the one §11 explicitly forbids at
display size, because at 130 px letterspacing does not read as luxury — it
reads as a title card. Ten `text-transform: uppercase` rules compound it:
uppercase plus wide tracking plus mono plus grey is aerospace *interface*, and
§14 rules the interface reading out.

### A4 · Every statement is set the same way

This is the actual complaint, and it is not about any single value. `Magasságot
építünk.`, `Hat terület.`, `Idelent minden zajos.` and `Innen már látni a
görbületet.` are a premise, a structure, a diagnosis and a revelation. They
currently arrive in one voice at four sizes. A statement that is four times as
important is set 1.6× larger — which is a proportional system doing its job,
and a brand voice failing to. Scale is not tone.

### A5 · Archivo's own proportions push toward the screen-UI reading

Measured at 100 px (`font-audit.json`): cap height 69.8, **x-height 52.6**,
descender 18.2. An x-height at **75.4% of cap height** is a large one — it is
what makes Archivo excellent at 14 px in a dense interface, and it is also
what makes it read as contemporary-screen rather than as timeless at 130 px.
This is not a reason to abandon the face. It is a reason to stop setting it the
way an interface sets it: the corrective is larger scale, tighter tracking,
sentence case, lower weight and far more space — which is what all three
directions below do.

---

## B · What can legally and technically be used

Audited empirically, not from the manifest: every axis, glyph and metric below
was read out of a real Chromium layout of the actual `.woff2` files in
`assets/fonts/`. See `font-audit.mjs` / `font-audit.json` and
`italic-probe.mjs` / `italic-probe.json`.

### B1 · The three provisioned families

| family | role in repo | licence | axes — **verified live** | Hungarian | German |
| --- | --- | --- | --- | --- | --- |
| **Archivo** | display + body | SIL OFL 1.1 (`archivo/OFL.txt`) | weight **100–900**, width **62–125%**, upright **and true italic** | complete | complete |
| **Aboreto** | logo wordmark | SIL OFL 1.1 (`aboreto/OFL.txt`) | 400 only, no axes | complete | complete |
| **JetBrains Mono** | technical + numeric | SIL OFL 1.1 (`jetbrains-mono/OFL.txt`) | weight 100–800 | complete | complete |

All three are OFL 1.1 with the licence file committed beside the fonts. There
is no licensing uncertainty anywhere in this study, and nothing was downloaded.

### B2 · Both Archivo axes are real and usable

Set-width of `Magasságot` at 100 px:

| width | 62% | 75% | 87.5% | 100% | 112.5% | 125% |
| --- | --- | --- | --- | --- | --- | --- |
| px | 373 | 433 | 490 | 548 | 624 | 699 |

An 87% range. This matters: it means a genuinely different *silhouette* is
available without a second typeface, which is what Direction C uses.

Weight 100 → 900 moves the same string 523 → 664 px. Available, and
deliberately almost unused below.

### B3 · Archivo Italic is a real cut, not a synthesised slant

Worth confirming, because Direction B depends on it entirely.
`document.fonts.load("italic 400 …")` resolves to `Archivo | italic`; set-widths
differ from the upright (`agya` 427.95 → 436.58, `Magasságot` 1095.8 → 1105.86
at 200 px); and 12 392 pixels differ when the two are rasterised. It is a
drawn italic, already in the repository, already licensed.

### B4 · Aboreto is unicase, and cannot set text

At 100 px, `M` and `m` are **identical**: same 91.9 px set-width, same 71.4 px
ascent. `g` has a 1.4 px descender. Aboreto has no lowercase — the lowercase
codepoints map to capitals. Combined with the standing brand rule that the mark
is always Aboreto and is set from `--mark`, never from `--display`, this settles
it: **Aboreto is the wordmark and nothing else.** It cannot carry a sentence-case
monument, so it cannot be the answer to §4B's editorial contrast.

### B5 · What is NOT available, stated plainly

**The repository contains no serif, and no editorial text face of any kind.**

Direction B as the brief imagines it — a grotesk with a restrained *serif* or
*editorial italic* contrast — cannot be fully produced from current assets.
What Direction B shows below is the closest legal option: Archivo's own italic,
which is a **sloped grotesk**. It reads as a change of *voice* — enough to
prove the idea works compositionally — but not as a change of *typographic
species*. The difference between those two is most of the character the
direction is reaching for.

This is a decision for a human, not for this study. If Direction B is chosen,
it needs one editorial face provisioned. Candidates that appear to be OFL on
Google Fonts, each with a genuine drawn italic, in rough order of restraint —
**Source Serif 4**, **Newsreader**, **Literata**, **Instrument Serif**,
**Fraunces**. Licences must be verified at acquisition; none of them are in the
repo today and none were downloaded for this study.

---

## C · Direction A — refined neo-grotesk

> *Sheet 1 · `typography/a1.png` `a2.png` `a3.png`*

### Character

Swiss, architectural, disciplined. Quiet authority. The argument it makes is
that Stratos does not need decorative typography at all — only better
proportion, better space and better breaks.

### The system

- **One family, one width.** Archivo, `wdth 100%`.
- **Two weights.** 400 for everything that speaks; 450–500 only for the mono
  metadata and the single action.
- **Four roles and no fifth.** Monument 108–124 px · body 17 px · micro 10 px
  mono · the action. There is no "display" or "subtitle" role in Direction A at
  all — the tier §6-02 permits was tried and deleted, because in three frames it
  never earned its place.
- **Sentence case for the brand voice. Uppercase only in the instrumentation.**
  That distinction is the whole point: brand voice is editorial, instruments are
  technical, and the reader learns which is which.
- **One spine.** Every element in every frame starts at x = 104 px. The mass
  sits in the upper third; the lower right stays empty.
- Tracking −0.032 em on the monument. Leading 0.96 em, except the hero pair
  (see §G).

### Advantages

- The most portable of the three. It has the largest locale headroom (§I) and
  the least to go wrong across eleven chapters rather than three frames.
- It is the direction that survives being handed to someone else. One spine,
  one width, four roles — it is describable in a paragraph, which is what makes
  a type system hold over time.
- Lowest risk to the existing build: it is a discipline applied to the face
  already shipping.

### Risks

- **This is the direction most likely to still be judged "premium agency".**
  It removes the faults in §A without adding character. It is Archivo, set
  properly. If the brief's real complaint is that Archivo *itself* sounds like
  a modern tech brand, Direction A does not answer it.
- Its restraint is invisible at thumbnail scale — see §28's test in §J.

### Five adjectives

Restrained · precise · architectural · assured · **safe**.

The fifth is not in the desired list and is not in the forbidden list. It is
the honest one.

---

## D · Direction B — grotesk with a restrained editorial contrast

> *Sheet 2 · `typography/b1.png` `b2.png` `b3.png`*

### Character

Cultured, editorial, composed. A brand that is confident enough to have an
aside. The printed programme of a cultural institution rather than the website
of a studio.

### The system

- **~92% Archivo upright**, carrying every statement.
- **~8% Archivo Italic**, at 22 px, appearing **exactly once per frame** and
  always as a complete thought — never as a styled word inside a sentence.
  §13's rule is enforced structurally: the italic is a `<p>`, not a `<span>`.
- **The italic is placed in counterpoint**, not beneath. In the system and
  high-altitude frames it goes to the opposite corner and sets right-aligned,
  so the frame reads as a diagonal the eye crosses rather than a stack it
  descends. In the hero, where the instrument holds the right edge, it is
  indented 184 px from the spine instead.
- **The mass drops to the middle band** (y ≈ 300–620), which is what separates
  B from A at a glance.
- Monument 128–140 px, tracking −0.036 em, leading 0.94 em (hero 1.02, §G).
- Body drops to 16 px at 34% opacity — quieter than A's, because the italic is
  already doing the supporting work and two supporting voices would be one too
  many.

### Advantages

- **It is the only direction that adds character rather than only removing
  faults.** That is the brief's actual complaint, and B is the only one of the
  three that answers it directly.
- The contrast solves "remove the middle" elegantly: monument → italic aside →
  nothing. There is no place for a subtitle to creep back in, because the
  second voice already occupies that slot and is visibly not a heading.
- The italic gives translated copy somewhere to go. German and English asides
  can run longer without disturbing the monument, which is not true of A's
  body block.

### Risks

- **The contrast is currently milder than the concept requires** (§B5). Archivo
  Italic is a sloped grotesk; at 22 px against a 140 px upright of the same
  family it reads as emphasis, not as another species of letter. Judge sheet 2
  as a *composition* proof, not as the finished voice.
- It is the direction with a dependency. Realising it properly means
  provisioning one editorial face, which is a licensing and performance
  decision (one more family, two more subsets).
- One italic per frame is a rule that decays. It survives three frames easily;
  across eleven it needs to be written down and enforced, or it becomes the
  yellow highlighter of §A3 in a different costume.

### Five adjectives

Editorial · sophisticated · composed · contemporary · **conditional**.

---

## E · Direction C — ultra-minimal Swiss

> *Sheet 3 · `typography/c1.png` `c2.png` `c3.png`*

### Character

Severe, monumental, certain. A brand confident enough not to decorate itself.

### The system

- **One family. One weight — 400, and nothing else anywhere in the direction.**
- **No mono. No italic. No all-caps at any size, including the metadata**, which
  is set in the same 16 px Archivo as everything else that is not a monument.
  `27 000 m`, lowercase, is the only instrumentation the direction has.
- **Two type styles exist in total**: monument and whisper. Not four. Two.
- **Width axis at 88%** — a coordinate of the variable font already
  provisioned, not another typeface, and the one liberty the direction takes.
  It buys architectural compactness at 150 px+ and lets the Hungarian
  statements set on fewer lines.
- **Bottom-anchored.** The monument's last baseline sits near the foot of the
  frame; the whole upper field is empty but for one 16 px line and, in the
  system frame, a second column of six discipline names on the 9th of twelve
  columns.
- Monument 148–168 px, tracking −0.026 em, leading 0.94 em (hero 1.02, §G).

### Advantages

- **The high-altitude frame in this direction is the single best frame in the
  study.** `c3.png` is what the brief is asking for: no colour, no instrument,
  no interface, no trick, and it is unmistakably expensive.
- It passes the distance test outright. At 240 px it is instantly separable
  from A and B; the other two are separable from each other only on inspection.
- It cannot rot. There is no weight ladder to creep, no accent colour to
  spread, no second face to misuse. A system with two styles has almost no
  surface area for future compromise.

### Risks

- **It fails the German portability test at its own scale** (§I). Its
  high-altitude monument has to come down from 168 px to 154 px, or German gets
  a third line and the two-line bottom band — the composition the direction is
  built on — breaks.
- **It gives the hero the least to work with.** `c1.png` is the weakest of C's
  three: a bottom-anchored monument and an instrument in the upper right is a
  composition with a hole in the middle, and the conversion action ends up
  parked in the top-right corner because there is nowhere else for it to go.
- Extending it to eleven chapters is unproven and looks hard. Two styles is
  generous for three frames; the process ledger and the case study will fight
  it, and the honest expectation is that C acquires a third style under
  pressure and stops being C.
- Some of its distinction comes from the width axis, which is the least
  timeless of the levers used here. At 88% Archivo begins to read as
  contemporary-condensed rather than as classical.

### Five adjectives

Severe · monumental · exclusive · timeless · **brittle**.

---

## F · The scale system

Four voices, and the middle is genuinely gone. Measured from
`typography/measurements.json`.

| role | A | B | C | rule |
| --- | --- | --- | --- | --- |
| **01 Monument** | 108–124 px | 128–140 px | 148–168 px | 1–2 lines. Weight 400. Its power is scale, break and space — never weight |
| **02 Display** | *not used* | *not used* | *not used* | The tier exists in the direction and was deliberately never instantiated. Three frames never needed one |
| **03 Editorial body** | 17 px | 16 px + 22 px italic | 16 px | ≤ 34 ch measure. 34–44% opacity. Never competes |
| **04 Micro** | 10 px mono | 10 px mono | *none — 16 px Archivo* | Information only. Deleted from C entirely, and C lost nothing |

**The jump.** A monument-to-body ratio of **6.8 : 1** (A) to **10.5 : 1** (C),
against a current production ratio of roughly 3 : 1 between the 9 rem ceiling
and the 2.8 rem tier below it. That gap is the change. There is nothing at 48
px, nothing at 30 px, nothing at 20 px in any of the nine frames.

**Ink coverage**, as the squint test in numbers — share of frame area occupied
by the bounding boxes of type:

| | hero | system | high altitude |
| --- | --- | --- | --- |
| A | 13.9% | 13.4% | 15.1% |
| B | 16.1% | 18.6% | 22.0% |
| C | 18.6% | 20.0% | 23.7% |

Three to six composed objects per frame, against the nine counted on the
shipped 0 m frame in `01-direction.md` §A1.

---

## G · Case, tracking and leading

### Case

**Sentence case for the brand voice, in all three directions, without
exception.** `Innen már látni a görbületet.` set sentence case is
demonstrably more editorial than the same line in caps, and Hungarian gives an
additional reason: uppercase accents sit 0.17 em above the cap line and force
looser leading (§H), so all-caps costs both tone *and* compactness.

Uppercase survives in A and B only in the mono metadata — which is the
distinction worth keeping: **brand voice is editorial, instrumentation is
technical.** Direction C abolishes even that, and the loss is smaller than
expected: `27 000 m` in lowercase Archivo reads as information perfectly well.

### Tracking

Negative at display size, in every direction:

| | monument tracking | at size |
| --- | --- | --- |
| A | −0.032 em | −3.7 to −4.0 px |
| B | −0.036 em | −4.6 to −5.0 px |
| C | −0.026 em | −3.8 to −4.4 px |

C's is the loosest in em because it is already narrowed 12% on the width axis;
tightening tracking *and* width compounds into something cramped. **No wide
tracking anywhere except the wordmark**, which is a mark and keeps its
0.42 em.

### Leading — and the finding that changes the rule

The brief proposes 0.85–1.0 em for monumental type. **0.85 em is below the
physical floor for Hungarian in this face.** Measured as painted ink at
200 px: Archivo sentence case cannot go below **0.905 em** before a lowercase
`ő` on one line touches a `gy` descender on the line above.

More importantly, **leading is a property of the statement, not of the
system.** The true per-column ink gap between the two monument lines, at
0.94 em:

| statement | clearance at 0.94 em |
| --- | --- |
| `Innen már látni` / `a görbületet.` | 0.208 em — comfortable |
| `Hat terület,` / `egy rendszer.` | 0.216 em — comfortable |
| `Magasságot` / `építünk.` | **0.034 em — touching** |

The hero pair puts a descender-dense line (the two `g`s of *Magasságot*) over
an accent-dense line (the `é` and `í` of *építünk.*), and the ink columns do
coincide — the collision sits at x = 208 in the 128 px setting. All three
directions therefore set the hero pair at **1.02 em** and everything else at
0.94–0.96 em, giving 0.106–0.115 em of clearance.

A single `--lead` token would have shipped this defect in all three
directions. `shoot-typography.mjs` now refuses to photograph a frame whose
accents come closer than 0.04 em.

### Line breaks

Every break in all nine frames is authored, and `white-space: nowrap` makes
browser re-breaking impossible rather than merely unlikely — without it an
over-long line wraps silently, stays inside the margins, and passes every
automated check while the browser quietly re-writes the art direction.

The high-altitude statement was set both ways and both are in the study, so
the alternatives can be compared directly rather than described:

- **A3 and C3** — `Innen már látni` / `a görbületet.` Line 2 is shorter. The
  rag falls away, the statement settles.
- **B3** — `Innen már` / `látni a görbületet.` Line 2 is 40% longer. It reads
  as a held breath and then a release, which suits the scene, and it is the
  break that gives the italic counterpoint room in the lower right.

Both work. The three-line variant was set and rejected: at these sizes it
turns a revelation into a list.

---

## H · Hungarian

Hungarian was the design language throughout, not a localisation applied
afterward. Findings:

1. **Coverage is complete.** Á É Í Ó Ö Ő Ú Ü Ű and the lowercase set are drawn
   in all three families — verified by measuring each codepoint against a
   deliberately mismatched fallback, with `A` as the control. Nothing tofus and
   nothing falls back. The `latin-ext` subsets are already committed for all
   three families, so the double acutes cost no new asset.
2. **The double acute is not the problem the accent is.** `Ő` and `Ó` reach the
   same height in Archivo — 86.8 at 100 px, 0.17 em above the 69.8 cap. The
   double acute is *wider*, not taller, so it costs horizontal room in a
   tightly tracked line, not vertical clearance.
3. **The binding vertical pair is lowercase, not uppercase.** All-caps
   Hungarian clears at 0.88 em because capitals have no descenders; sentence
   case needs 0.905 em because `gy` and `ő` meet. Since all three directions
   are sentence case, 0.905 em is the real floor — and per §G the *statement*
   raises it further.
4. **Word length is the real Hungarian constraint.** `Automatizálás`,
   `Magasságot`, `görbületet` are long, and agglutination means there are no
   short alternatives. This is why every monument here breaks at 1–2 words per
   line and why C needs the 88% width coordinate to fit two lines at 168 px.
5. **The accents read as native at every size in the study.** At 168 px the
   `ő` in `görbületet` and the `ü` are unambiguous and correctly weighted, and
   at 16 px in the whisper `levegő` is clean. Nothing looked adapted.

---

## I · Locale risks

42 settings measured against the 1 232 px column — `locale-fit.json`, printed
in `sheet-5-locale-stress.png`.

### The binding sentence is German, at high altitude

`Von hier aus ist die Krümmung zu sehen.` sets **47% wider** than the Hungarian
it translates. On the Hungarian break it overflows in **every** direction:

| direction | HU break | German, HU break | German, own break |
| --- | --- | --- | --- |
| A · 124 px | 746 px | 1 276 px — **over by 44** | 1 100 px — fits |
| B · 140 px | 833 px | 1 428 px — **over by 196** | 1 231 px — **1 px of room** |
| C · 168 px | 918 px | 1 562 px — **over by 330** | 1 344 px — **over by 112** |

### What follows

1. **German needs its own line break at high altitude in all three
   directions.** `Von hier aus ist die` / `Krümmung zu sehen.` This is a
   content decision, not a CSS one, and it belongs in `messages.ts` as
   authored breaks — not left to the browser.
2. **Direction B's 140 px is not a real fit.** One pixel of room is a defect
   waiting for a font-rendering difference. B's locale-safe ceiling at high
   altitude is about **134 px**, not 140.
3. **Direction C cannot set German at 168 px at all**, on any two-line break.
   Its ceiling is **154 px** — `l4.png` — or German takes three lines and C's
   bottom-band composition breaks. `l3.png` prints the failure rather than
   describing it.
4. **Locale-safe monument ceilings**, if the system is to be one system:
   A ≈ 139 px · B ≈ 134 px · C ≈ 154 px.
5. **English is not a risk.** It sits between the two everywhere and needs no
   special break. The hero is its widest case (`Altitude is what we build.` at
   1 001 px per 100 px of size) and it clears comfortably in all three.
6. **German's hero is the opposite problem.** `Höhe bauen wir.` is 24% *narrower*
   than the Hungarian and fits on one line in every direction — so the hero
   composition, built on a two-line monument, is thinner in German than it
   should be. Worth an authored one-line German hero rather than a forced break.

---

## J · Recommendation

### Direction B — grotesk with a restrained editorial contrast

Conditional on one decision, stated in §B5 and repeated here because it is the
whole of the recommendation's risk: **B needs one editorial face provisioned to
become what it is arguing for.** What sheet 2 shows is the composition proved
with the closest legal substitute already in the repository.

**Why B and not A.** A is better than what ships today and it is the safest
thing in this document — but it answers the wrong complaint. The brief does not
say the current typography is undisciplined; it says it has no character, that
it could belong to any competent modern studio. A removes faults. It adds
nothing. Its own five adjectives ended in *safe*, and after three frames I do
not believe A clears the bar in §32: it is clean, modern, professional and
premium, which the brief names as explicitly not enough.

**Why B and not C.** C is the better *typography* and `c3.png` is the best
single frame in the study — I would not want that frame lost. But three things
count against it as the system. It fails the German test at its own scale and
has to give back 14 px, which is exactly the kind of concession that starts a
system unravelling. Its hero is the weakest of the nine, and the hero is the
frame that has to carry the instrument and the one conversion action. And two
type styles across eleven chapters is a claim this study did not test — three
frames is where minimalism is easiest, and the process ledger and case study
are where it will be asked for a third style. C's honest fifth adjective was
*brittle*.

**What B gives that neither other direction does.** A second voice. The
italic aside is the only device in the study that changes *tone* rather than
volume, and tone is the missing thing. It also structurally forecloses the
failure in §A1: with an aside already occupying the space under the monument,
there is no slot left for a 48 px subtitle to reappear in, and the middle
stays deleted. And it is the direction that best absorbs translation, because
an aside can run long where a monument cannot.

**Carry C's high-altitude frame into B.** B's own `b3.png` is strong, but
`c3.png` proves the scene tolerates more emptiness than B currently gives it.
When B is implemented, the high-altitude chapter should take C's proportions —
larger monument, lower anchor, more silence — with B's italic in the corner.
That is a composition instruction, not a system change.

**What must be decided before anything is implemented**

1. Provision one editorial face, or accept Archivo Italic and accept that B
   lands much closer to A. This is a licensing, performance and brand decision.
2. Confirm the locale-safe ceiling of ~134 px, or accept per-locale monument
   sizes.
3. Confirm that authored line breaks move into `messages.ts` per locale.
4. Decide whether the mono micro role survives at all. C shows it does not have
   to, and dropping it would remove the last of the cockpit reading in §A3.

### Verdicts against the direction's own tests

- **§25 brand character.** No direction produced a forbidden adjective. A, B
  and C each produced one honest adjective outside the desired list — *safe*,
  *conditional*, *brittle* — and those three words are the actual decision.
- **§26 static luxury.** All nine hold without animation. `c3`, `b3` and `a3`
  hold most; `c1` holds least.
- **§27 squint.** Three to six composed objects per frame; the primary
  statement is unambiguous in all nine.
- **§28 distance.** Partially passed, and this is worth stating plainly. At
  240 px, C is instantly distinct — empty top, heavy bottom band. **A and B are
  distinguishable but not instantly**, and in the *hero* row they are close,
  because the instrument holds the same position in all three and dominates the
  thumbnail. The high-altitude row separates all three cleanly. If the human
  review finds A and B too close, that is a real result and not a rendering of
  the sheet — it would mean the editorial contrast has to be a genuine serif
  before B is a genuinely different direction, which is the same conclusion
  §B5 reaches from the other end.

---

## Stop here

Nothing in this study has been implemented. No production CSS was modified, no
font was replaced globally, `scene.ts`, `composition.ts`, the scroll behaviour,
the Altimeter choreography and the mobile route are untouched, and nothing has
been pushed, merged or deployed.

**Awaiting human typography review.**

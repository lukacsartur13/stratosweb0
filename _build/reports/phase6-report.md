# Phase 6 report — the alternating Meridian rails, typography and kinetic type

This report has two parts. **Part A** is the composition revision that
supersedes the permanently centred Meridian. **Part B** is the typography record
from the previous revision, which is unchanged in substance and still current —
the fonts, the scale, the kinetic moments and the transfer sizes are all as they
were. Where Part B's §9 recorded open composition defects, Part A replaces it:
those defects are the ones this revision was asked to solve, and §A.13 is their
final measurement.

---

# Part A — the alternating rail composition

## A.1 The rails, and where they landed

Three canonical projected positions, expressed as a fraction of the *usable*
viewport width — the visual viewport less the safe-area insets, which is the box
the validator measures and the box §1 names.

The side rails are not a constant. `RAIL_OFFSET_TARGET` is a **ceiling** of 0.19,
which would put them at 31% and 69%; `railBudget()` takes that down on any
viewport where the measured ring composition needs the room, by solving, over
the whole journey,

```
limit = min over altitudes of  (0.5 − compositionHalfWidth(m) − edgeMargin) / |railTrack(m)|
```

Dividing by the track is what lets a partly displaced state spend room a fully
displaced one could not — at 250 m the instrument is a third of the way to the
right rail, and requiring the full displacement to fit there would throw away
room nothing ever needs.

| Viewport | Rails measured | Bound by |
|---|---|---|
| 1920×1080 | 31.0 / 69.0% | the 0.19 ceiling |
| 1440×900 | 31.0 / 69.0% | the 0.19 ceiling |
| 1366×768 | 31.0 / 69.0% | the 0.19 ceiling |
| 1024×768 | 32.0 / 68.0% | the ring composition |
| 844×390 landscape | 31.0 / 69.0% | the 0.19 ceiling |
| every portrait viewport | **off** | §10 — see A.10 |

`compositionWidthAt` reads a measured table, not a formula. The essential
silhouette is one rigid body and a closed form is exact for it, but the ring
composition unseats, tilts, translates and locks on its own timeline, so its
extent has no closed form short of a second implementation of `meridian.ts` in
a module that may not import `three`. `probe-meridian-extent.mjs` samples both
extents off the live scene graph every 500 m, in the instrument's own local
frame so the result is viewport-free, and checks that claim rather than
asserting it: the spread across three aspect ratios is **2.58%**.

The two tables are kept apart because §9 gives the two bodies different rules
and always has. A ring may approach the viewport edge as long as it stays whole;
the dial may not; and text may pass a ring but not the dial. So the **rails** are
budgeted against the composition width and the **copy column** against the
essential width. Budgeting the column against the rings would cost it 15–20% of
its width to clear the corners of a bounding box that are, in the frame, empty
sky.

## A.2 The altitude composition

Six compositional acts over eleven stages — five rail changes, and the copy
changes three times against them.

| Altitude | Rail | Copy | What the instrument is doing |
|---|---|---|---|
| 0–150 m | centre | left | the object is established before anything moves |
| 150–6 000 | right | left | the lower ascent |
| 6 000–11 000 | left | right | Ring 1 unseats at 7 000; the cloud deck arrives |
| 11 000–17 000 | right | left | the aperture breaks through at 12 000 |
| 17 000–28 000 | left | right | Rings 2 and 3 lock, at 18 000 and 24 000 |
| 28 000–30 000 | centre | right | the final calibration takes the frame back |

The copy side is deliberately *not* the mirror of the rail. It changes three
times against the instrument's five, because a rail change and a column change
are different events and running them together at every boundary is what would
make the page read as a slider. At 150 m and at 28 000 m the instrument moves
and the copy stays exactly where it is, which is what makes those two handoffs
read as the camera recomposing rather than as the layout dealing itself a new
hand.

Every handoff lands on a structural event the instrument is already having, so
none of them is a reaction to a text change.

## A.3 One primary narrative block at a time

At every altitude exactly one column is at full presence and the instrument
holds the opposite side. There is no second column, and the only other content
in the frame is the altitude readout and stage label — §3's permitted
"altitude label or short micro-copy cluster".

During a crossing both the outgoing and the incoming column are yielding (A.8),
so the state §3 rules out — two equally dense blocks either side of the Meridian
— does not exist at any altitude rather than being avoided by timing.

## A.4 What the copy actually gained

`--copy-room` is written per panel by `composition.ts`: the distance in CSS
pixels from the viewport edge on the copy's side to the nearest the instrument's
essential silhouette comes to it over that stage's *settled* altitudes, expanded
by the same visual safety margin the validator tests against. One number per
stage, not one per frame — the ring composition grows by half its own width
between 11 000 and 12 000 m, and a column that tracked it would be visibly
breathing.

Measured column widths, Hungarian:

| Stage | 1920×1080 | 1440×900 | 1366×768 | 1024×768 | 844×390 |
|---|---|---|---|---|---|
| calibration | 30.1vw | 27.5vw | 28.5vw | 24.3vw | 32.0vw |
| initial-ascent | 38.0 | 38.0 | 38.0 | 38.0 | 38.0 |
| lower-atmosphere | 38.0 | 38.0 | 38.0 | 38.0 | 38.0 |
| cloud-entry | 38.0 | 38.0 | 38.0 | 38.0 | 38.0 |
| cloud-breakthrough | 38.0 | 38.0 | 38.0 | 38.0 | 38.0 |
| selected-work | 38.0 | 38.0 | 38.0 | 38.0 | 38.0 |
| system | 38.0 | 38.0 | 38.0 | 38.0 | 38.0 |
| process | 38.0 | 38.0 | 38.0 | 38.0 | 38.0 |
| stratosphere-transition | 38.0 | 38.0 | 38.0 | 38.0 | 35.3 |
| full-stratosphere | 34.5 | 32.4 | 33.0 | 29.9 | 35.2 |
| destination | 34.5 | 32.4 | 33.0 | 29.9 | 35.2 |

Against the previous centred composition the dense narrative column at 1440×900
was **332px**; it is now **547px** — 65% wider, and 38vw against 23vw.

Ten of eleven stages are at or above §4's 30–38vw target on every landscape
viewport. **`calibration` is the exception and it is a consequence of the brief
rather than of the implementation:** §2 requires the Meridian centred at 0 m, and
a centred instrument on a 1024×768 leaves 24.3vw beside it. The opening panel is
a hero — one headline, one lead, two buttons and a caption — not the long
narrative §4 is protecting, and §2 explicitly permits the opening to compose
differently. No content was reduced to fit it.

Three caps hold the column: `--copy-room` (the instrument), 38vw (the
decision's upper target — room alone would allow 50vw+ where the instrument is
fully railed) and 60rem (ultrawide, where 38vw is 1307px). Readable line length
is held separately at 68ch on the prose itself, and 24ch on headlines, so the
case grid and the process grid keep the full column while the paragraphs keep
their measure. `min-width: 0` and `overflow-wrap` are on every prose element and
grid child; the dense grids are container queries against the plate, not the
viewport.

## A.5 The surface

The bordered rectangle, the flat `--plate` fill and the 14px backdrop blur are
gone. What replaces them, on every landscape composition including the
reduced-motion path:

* **No surface, border, radius, outline or blur.** The blur was doing the one
  thing this page must not — an instrument behind a 14px blur is a shape where
  the instrument is, and the ring composition now passes behind the column's
  outer edge.
* **A local atmospheric gradient behind the text only.** An ellipse centred on
  the copy, reaching *exactly zero* on every side before its own box ends, so
  it reads as haze gathering rather than as a panel with soft edges. Its box is
  inset negatively so the falloff happens in air rather than inside the padding
  where it would read as a vignette on a card.
* **One fine technical rule**, two rem wide, leading into the mono stage label.
  It is the only drawn line in the treatment.
* **Generous negative space** — the column's padding was increased, because the
  falloff needs somewhere to happen.

The nested cards went with it. `.case`, `.system__ring` and `.check` were
rectangles inside the rectangle, and the case grid repeats four times in a row;
they are now a single hairline above each block, with the sky behind. The ring
hierarchy survives unchanged, because the weight that said which layer mattered
was always the border *colour*, and that now colours the rule.

The horizontal bleed of the wash is bounded by the document rather than by
taste: at −30% it put 100px of horizontal document overflow at *every* altitude
on a 1440×900, with no culprit reported, because the overflow scan walks
elements and a pseudo-element is not one. It is −10%, the largest bleed that
cannot overflow at any viewport in the matrix.

## A.6 The movement

Four things at once, none of them a translation of the rendered canvas:

* the **camera pans** by up to one degree toward the instrument, which moves the
  sky, the cloud deck and the mountain range by about 2% of the viewport width;
* the **instrument translates**, solved in closed form *against* that pan, so the
  projected rail is hit exactly whatever the camera is doing. A translation
  authored against a stationary camera would be off by the whole of the pan;
* it takes a **bounded scale and depth trim** — 3% and 0.09 world units at full
  displacement, through the same scale/depth pair the recede already uses, so
  there is no second way for the instrument to change size;
* it **turns most of the way back to face the camera** (70% of an eleven-degree
  off-axis angle), which is what stops it reading as a billboard being dragged.

Each crossing takes 0.9 screens of scroll — the instrument covers 38% of the
viewport width over most of a screen, roughly half the rate the page is moving
under the visitor's hand. Expressed in screens rather than metres because the
altitude curve is deliberately not linear in scroll: 150 metres of calibration
get a whole screen and 6 000 metres of case studies get 4.4.

No overshoot, no elastic easing, no bounce: the track is a smoothstep between
knots and the endpoints have zero velocity.

## A.7 Canonical state

Everything above is a pure function of `(altitude, viewport)`. No second scroll
listener, no composition timeline, no direction-dependent state, no
component-level easing. The two damped quantities in the chain — the camera's
dolly and the instrument's recede — use `settle()`, which lands exactly rather
than approaching forever, so a stationary page has one state and not a band of
states.

`validate-traversal.mjs` now compares the rail as well: `meridian.position.x`,
`meridian.rotation.y`, `camera.rotation.y`, `--rail-x`, `data-copy` and
`--panel-veil` were all added to the state it walks forward and backward. A
reversibility check that compared everything *but* the new lateral composition
would pass a composition that is not reversible.

## A.8 The handoff

§8 asks for a sequence rather than a cut, and it is one mechanism seen from two
ends. `copyRoom` is the room the copy has once the instrument has **settled**;
`copyPresence` is what the copy does before it has — the ratio of the room it
has *now* to the room it was budgeted, banded from 0.90 to 1.00.

Both halves fall out of that one ratio. The outgoing column's room shrinks as
the instrument arrives on its side, so it yields; the incoming column's room
grows as the instrument leaves, so it resolves. Neither knows the other exists,
and neither is keyed to a boundary, a direction or a clock.

This was not a refinement — it is what closed the last transitional collisions.
Measured before it, on a 1440×900 in Hungarian: the case-study headline **211px
across the dial at 10 440 m** and the cloud-entry headline **41px across it at
5 870 m**, both absent at either endpoint of the move and present in the middle
of it, which is precisely the temporary collision §8 names. The upper end of the
band is at 1.00 and not short of it because a band that completed early reads as
complete and measures as a collision: at 0.95 the same headline sat 34px across
the dial at 0.52 opacity.

The five crossings are sampled explicitly by the validator — midpoint plus three
points either side, spaced by the altitude each window actually spans — because
an evenly spaced 101-sample grid steps over the narrowest of them and lands on
the middle of none of them by construction.

## A.9 Ring and aperture protection

The rail budget reserves the edge margin *before* the instrument is allowed to
move, at every rail and at every point of every interpolation, against the
measured composition width including all three rings. The validator then checks
the rendered result independently.

Worst measured essential margin, Hungarian, 53 samples per viewport:

| Viewport | required | measured worst |
|---|---|---|
| 1440×900 | 4% (57.6px) | **182px** |
| 1366×768 | 4% (54.6px) | **152px** |
| 1024×768 | 3% (30.7px) | **117px** |
| 844×390 | 16px | **92px** |
| 390×844 | 16px | **102px** |

No essential clip and no ring clip at any sample. Nothing is concealed by a
global overflow rule — the horizontal overflow check is independent and reports
its own culprits.

## A.10 Responsive

**Desktop and wide landscape** take the full alternating composition.
**Tablet landscape** takes it with a narrower displacement where the measurement
demands it — 1024×768 lands at 32/68% rather than 31/69%.

**Portrait gets no lateral travel at all**, and that is §10's instruction rather
than a limitation: a 390×844 measures a budget of 0.088, which is a 34-pixel
move that buys the copy nothing it can use and costs the instrument its centre.
Portrait keeps the accepted upper/lower editorial composition — copy in bands
above and below the instrument, with the band edges published from the
instrument's own projected height — plus the portrait recede on the dense
stages, and the natural-flow fallback at extreme text size or zoom. `railLimit`
is zero there and every rail function collapses to the centred composition by
arithmetic rather than by a second code path.

That gate is not decorative. Without it the camera panned while the instrument
did not, which projected the instrument off the view axis by the whole of the
pan: **6.4–6.9% off centre on 430×932, 390×844 and 360×800**, against a ±3%
tolerance, with the instrument sitting at exactly x = 0 the entire time. One
degree is a small angle on a wide viewport and a large one on a narrow one —
the shift is `tan(1°) / tan(hFov/2)`, and a portrait half-field is a third of a
landscape one.

**Mobile landscape** takes dedicated measured rails and its own HUD framing
(A.11), not desktop percentages.

## A.11 Navigation and UI placement

The altitude readout was clear of a *centred* instrument by construction: a dial
in the middle of the frame never reaches the bottom-left corner. On the left rail
it does. Measured: the bottom-left corner of the exclusion zone meets the
top-right corner of the digits — 1px at 1366×768, 5px at 1024×768 and a genuine
24×39px at 844×390, and only ever on the five-digit readouts, which are 74px
wider than the four-digit ones.

§11 allows the readout to stay visually stable *if it does not collide*. It did,
so it is given a measured zone instead:

* the clear band below the instrument is `(vh − worstBand) / 2`, where
  `worstBand` is the largest exclusion band over the **whole journey** on this
  viewport — not at one altitude, because the readout may not move and the band
  does;
* if the corner stack fits in that band it keeps its layout and is pushed down
  to sit inside it. Nothing about the design changes; the offset does. This is
  every desktop and tablet viewport;
* if it does not, the stack is the wrong shape for the frame and the readout
  becomes a **strip along the bottom edge** — same content, same order, same
  elements, one line high, entirely below the instrument's reach. This is mobile
  landscape, where the clear band is 97px and the stack is 134.

Decided by measurement, never by a device width, and the stack height is
measured with the strip forced off so the decision cannot oscillate on resize.

## A.12 Accessibility and reduced motion

Under reduced motion the scene is not mounted, so there is no lateral travel to
replace: the composition is the static safe one §12 asks for, with all copy
present and the new editorial surface (which is keyed to the aspect, not to the
rails, precisely so this path does not keep the old card).

**DOM order is unchanged and independent of visual placement.** The side a
column takes is `justify-content` on the panel's flex container; nothing uses
`order` or `row-reverse`, and no panel is moved in the document. A screen reader
receives the eleven stages in narrative order at every altitude, which the
reduced-motion validator now checks explicitly against the stage map rather than
against a transcribed list.

Focus handling was extended to landscape. The handoff fades a column, and a link
inside a faded column is invisible but still focusable; focus landing there now
scrolls the journey to that stage — the same thing a scrolling visitor gets —
instead of leaving a keyboard visitor with a focus ring on nothing. It was
previously gated on the portrait window, which is where the only fade used to
be.

## A.13 Validation

`validate-meridian.mjs` was rewritten against §13. The global centre tolerance is
gone and must not come back: on this composition it is not merely stricter, it
is wrong — the instrument is *supposed* to be 19% off the viewport centre for
most of the journey, and a check that failed it for doing so would fail the
accepted design.

What replaces it is stricter where it matters. The horizontal deviation is
measured against the rail the composition **intended** at that altitude, read off
the page's own `railAt` rather than reconstructed in the harness — a harness that
reimplements the thing under test proves only that the same mistake was made
twice. The vertical is still measured against the viewport centre, because the
rails move the composition laterally only.

Also added: the intended rail and measured centre per sample, the text-exclusion
**overlap area** in px² (a four-pixel clip of a descender and a headline across
the dial are the same boolean and very different defects), vertical
essential-content clipping at rest, the five handoff windows as named samples,
and run modes for 200% zoom, reduced motion and the fallback-font state.

## A.14 The evaluation stills

`experiments/shots-rails.mjs` captures the §14 set: the seven compositional acts
across the four viewport classes §10 distinguishes, with an `index.json`
recording the rail, the measured projected centre, the copy side, the column
width in pixels and in vw, and the handoff presence for every frame — so a
reviewer can check what they are looking at rather than inferring it.

It is a second script rather than more stops in `shots-meridian.mjs` because the
two photograph different things. That one is the *instrument's* record — seven
canonical altitudes on two viewports, with a digest file that is a regression
baseline for the geometry, and adding rail states to it would change every
digest and lose the comparison it exists for. This one is the *composition's*
record and has its own digests and its own determinism check.

The acts are sampled well inside each stage rather than on its edge. A still
taken mid-crossing photographs the transition — the instrument part-way to its
rail and the copy part-way through its yield — and the transitions are
validated at seven points each rather than photographed.

## A.15 Content protection

Nothing was removed to make the composition fit. No text was cut, no section
dropped, no stage deleted, no German string shortened, and nothing is hidden on
mobile. The eleven panels, their word counts and their markup are byte-identical
to the previous revision — `git diff` touches no file under
`experiments/src/full/locales/` and no panel body in `FullAscent.tsx`.

Two things that *look* like exceptions and are not:

* **The handoff fade.** A yielding column is at reduced opacity for part of a
  crossing and at full opacity for the rest of its stage. It is in the document,
  in the accessibility tree and in the reading order throughout, which is why
  the hand-over is an `opacity` cross-fade rather than a `display` switch, and
  why focus landing inside a faded column now navigates to that stage.
* **The strip readout's stage name.** It wraps rather than truncating. An
  ellipsis was written and then removed: a stage name that has lost its ending
  is content removed to solve a layout problem, and `measureHud` sizes the
  offset from the strip's *measured* height, so a second line is accounted for
  rather than forbidden.

The space came from layout and object positioning, as §15 requires: the
instrument moved, and the column took the room it left.

---

# Part B — typography and kinetic type

Unchanged in substance from the previous revision and still current. §B.9's
open items are the composition defects Part A was asked to solve; see §A.13 for
their final measurement.

## B.1 Fonts found

Full-repository search (`*.woff2 *.woff *.otf *.ttf`, excluding `node_modules`)
returned six files, all under `assets/fonts/`:

| Family | Files | Bytes | Licence |
|---|---|---|---|
| Archivo | 4 (normal/italic × latin/latin-ext) | 371,092 | SIL OFL 1.1 |
| JetBrains Mono | 2 (normal × latin/latin-ext) | 55,684 | SIL OFL 1.1 |
| **Total** | **6** | **426,776 (416.8 kB)** | |

The only other font binary in the tree is `kenpixel.ttf`, shipped inside
`three`'s examples and unused by this site.

## B.2. Licence status

The brief specified **ABC Arizona Variable**, **ABC Diatype** and **ABC Diatype
Mono/Semi-Mono**. None is present, none is licensed, and all three are
commercial ABC Dinamo retail releases. None was acquired.

**Decision (2026-08-03): Archivo + JetBrains Mono accepted as the final
typography.** The Dinamo families will not be purchased. The purchase spec and
the eight-step drop-in procedure are retained in [FONTS.md](../../FONTS.md) as a
reversal path, not as outstanding work.

Consequently two kinetic moments from §6.8 are **cancelled, not deferred**:

* the serif↔sans personality morph at the aperture breakthrough — Archivo has no
  personality axis, and no crossfade was faked in its place;
* the continuous forward slant — Archivo has no `slnt`/`ital` axis; italic is a
  separate file, and a `skew()` would be synthetic distortion, which §6.7 forbids.

## B.3. Variable axes — read from the binaries

`node scripts/font-metadata.mjs` parses `fvar`, `name`, `OS/2`, `head` and
`cmap` directly. Nothing here is inferred from a family name.

```
Archivo         wght 100..900 (default 600)   wdth 62..125 (default 100)
                italic = separate file, no ital/slnt axis
                version 2.001

JetBrains Mono  wght 100..800 (default 400)   no width axis, no italic
                version 2.211
```

Glyph coverage, latin + latin-ext combined: Archivo **478** codepoints,
JetBrains Mono **405**. Hungarian, German and English all report **complete** —
including ő (U+0151) and ű (U+0171), which are the coverage risk.

The kinetic engine clamps to `weight 300..800`, `width 82..118`,
`monoWeight 300..750` — all strictly inside the real design spaces.

## B.4. Fallback behaviour

Two metric-matched shim faces, `Archivo Fallback` and `JetBrains Mono Fallback`,
declared with `local()` sources only so they never cost a request. If none of
the named local faces exists the rule contributes nothing and the next family in
the stack takes over — it can only improve the fallback, never break it.

Overrides derived from metrics read out of the binaries (upem 1000 vs Arial's
2048): Archivo `size-adjust: 101.4%`, ascent 86.6%, descent 20.7%; JetBrains
Mono `size-adjust: 106.1%`, ascent 96.2%, descent 28.3%. Full derivation in
FONTS.md §4.

The explicit no-webfont stacks the brief asked to have written down are present
as `--font-display-fallback`, `--font-body-fallback`, `--font-mono-fallback`.

## B.5. Typography tokens

One file, `assets/css/type.css`, consumed by both the eleven generated static
pages (via `main.css`) and the homepage (via `styles.css`). No component names a
family, weight or pixel value of its own.

* **Families:** `--font-display`, `--font-body`, `--font-mono` + three fallback
  stacks. Display and body resolve to the same family today and remain two
  tokens because they are two roles.
* **Scale:** eleven fluid `clamp()` sizes, `--type-signature-size` through
  `--type-meta-size`, fluid between 360px and 1440px.
* **Semantic composites:** signature, section, project, body-primary,
  body-secondary, label-technical, number-altitude, metadata, navigation, cta,
  form — each naming family, weight, width, leading, tracking.
* **Locale adjustments:** `:root:lang(de)` and `:root:lang(hu)` give display
  roles a little width back and allow hyphenation, rather than shrinking type.
* **Forms:** `max(1rem, var(--type-body-size))`, so mobile Safari never zooms on
  focus.

Width values are real `font-stretch` percentages inside Archivo's 62–125 range,
so they drive the `wdth` axis rather than triggering synthetic scaling.

## B.6. Kinetic moments

Four, all pure functions of `journey.altitude` — no second scroll listener, no
timeline, no direction-dependent state, so forward and reverse traversal are
identical by construction.

| Altitude | Anchor | Behaviour | Curve |
|---|---|---|---|
| 3,000–6,000 m | `lower-atmosphere` | weight lock 400→780, tracking →−0.014em | `arrive` |
| 8,500–11,000 m | `cloud-breakthrough` | width compress 100→89 and release | `snapCurve` |
| 28,000–30,000 m | `full-stratosphere` | width expand 100→116 | `arrive` |
| 29,400–30,000 m | `altitude-readout` | mono weight 300→440, tracking −0.03→−0.004em | `arrive` |

The three primary bands are disjoint, which is §6.7's "one morphing word at a
time" enforced by arithmetic rather than by review. `altitude-readout` is the
permitted secondary.

Reduced motion collapses each moment to a single discrete step at its midpoint
(`momentAt(..., reduced = true)`), keeping the meaning and dropping the
continuous axis interpolation. The CSS half (`--kinetic-duration: 0ms` under
`prefers-reduced-motion: reduce`) holds even if the script never runs.

## B.7. Transfer size

Self-hosted, no third-party origin. Two subsets per face, enforced with
`unicode-range`, so an English or German page never downloads `latin-ext`.

| Route | Preloaded | Critical transfer |
|---|---|---|
| Hungarian | Archivo normal latin + latin-ext | **171.8 kB** |
| English | Archivo normal latin | **88.0 kB** |
| German | Archivo normal latin | **88.0 kB** |

Deferred to the normal stylesheet path: JetBrains Mono (54.4 kB, never the LCP
element) and Archivo italic (190.8 kB, below the fold). `crossorigin` is set on
every preload — font fetches are always CORS, and a preload without it is a
wasted second request.

**CSP was tightened, not merely preserved:**

```diff
- style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
- font-src  'self' https://fonts.gstatic.com;
+ style-src 'self' 'unsafe-inline';
+ font-src  'self';
```

## B.8. Defects found and fixed

### 8.1 The validation route rendered in Times (blocking, fixed)

`experiments/full.html` — the route the entire full-ascent suite and all
evaluation stills are built from — never linked `type.css`. `--font-display` was
undefined and every heading fell back to the browser's default serif, while
production rendered Archivo correctly on `/`, `/en/`, `/de/` and all eleven
static pages.

Every collision, overflow and still was therefore being measured against Times
metrics the live site never uses, and the kinetic typography could not function
at all there — it drives `wght` and `wdth`, and Times has no variation axes.

Fixed in three places:

* the stylesheet link and font preloads added to `experiments/full.html`;
* `experiments/vite-site-assets.ts` made base-aware — the dev server rewrites
  root-relative URLs by prepending `base`, so the request never reached a
  middleware mounted at `/assets` and fell through to the SPA fallback, which
  returned the index document as `text/css`. A stylesheet served as HTML is
  dropped silently: no 404, no console error;
* `playwright.full.config.ts` now fails loudly if `dist/assets/css/type.css` is
  missing, rather than silently reverting to a fallback serif.

Verified end-to-end: the built route reports `Archivo`, no 4xx.

### 8.2 Instrument off-centre and clipped (blocking, fixed)

The new browser-space harness (`experiments/validate-meridian.mjs`) measured the
accepted composition at **16–30% off the usable viewport centre on all nine
tested viewports**, against a ±3% requirement, and clipping the essential
silhouette outright on short ones: −49px at 1366×768, −26px at 844×390, −5px at
1440×900.

Resolved by centring the instrument and making the room the two ways the brief
allows rather than by moving it:

* `AltimeterMeridian` — `baseX`/`baseY` offsets removed; the instrument is at
  x = 0 and rides at exactly the camera's height (`cameraHeightAt`), so it is
  vertically centred by construction. `recede` still frees screen area, but
  through scale and depth instead of sideways displacement.
* `JourneyCamera` — `FRAME_WIDTH` is now a function of aspect (2.2 portrait →
  3.5 at 2:1), so wide viewports pull back and the dial gets smaller. Portrait
  framing is unchanged, because portrait already measured inside ±3%.
* `styles.css` — landscape copy budget `min(34rem, calc(32vw - 4rem))`; portrait
  splits the copy into bands above and below the instrument via a viewport-tall
  flex column and `margin-top: auto`, with the plate background opening to fully
  transparent between 38% and 62% of viewport height.

Result: **centre 0.22–1.63% on every viewport, no clipping anywhere**
(worst margin +59px, was −49px).

### 8.3 Harness defect (fixed)

The harness forced the altitude via the debug override but never scrolled the
document, so every altitude was measured against whatever copy sat at scroll 0.
The instrument half of each measurement was correct; the typography half was
measuring a page nobody sees. It now scrolls to the matching position.

### 8.4 Hero hyphenation (fixed)

`hyphens: auto` broke "weboldalakat" as "webolda-lakat" in the signature
headline. Withdrawn for signature-size type only (`hyphens: manual`); overflow
protection retained.

## B.9. Open

### B.9.0 The 34/3 figures were measured at 12 altitudes, and are not the floor

The "34 collisions + 3 ring clips = 37" headline came from a 12-altitude,
hu-only, 9-viewport run — 108 samples. Re-run at 17 altitudes (`SAMPLES=12`
unions the 7 named stops, giving 153 samples) the same tree measures **56**.
Nothing regressed between the two; the denser grid simply finds more, which is
the whole reason §9 of the brief asks for 101 samples. Every count below is at
17 altitudes so it can be compared with the one before it.

### B.9.1 Fixed since, with before/after

`node experiments/validate-meridian.mjs` (hu, 17 altitudes, 9 viewports):
**56 problem samples → 30.**

| Viewport | Before | After |
|---|---|---|
| 1440×900 | 6 | **0** |
| 1366×768 | 6 | **0** |
| 844×390 landscape | 9 | **0** |
| 1024×768 | 7 | 1 |
| 768×1024 | 6 | 6 |
| 430×932 | 4 | 4 |
| 390×844 | 5 | 5 |
| 360×800 | 6 | 6 |
| 320×568 | 8 | 8 |

Four causes, all systemic rather than per-panel:

* **The landscape copy budget never applied to the dense panels.** Declared in
  the aspect media query, overridden by two later same-specificity rules, so
  `.panel--wide` rendered at 1088px inside a 1440px viewport with a 522px dial
  centred in it. This is why the failures were concentrated in exactly
  `.panel--wide` and `.panel--centre`: the plain panels read the budget from
  their own winning declaration and were never overridden.
* **The budget was a boundary value.** `32vw - 4rem` landed the plate's right
  edge 1.8px *inside* the dial at 1440×900 and ignored the safety margin the
  validator expands the instrument by. Now measured, banded by aspect (the gap
  is 29.3% of width at 1024×768 and 34.1% at 844×390, because FRAME_WIDTH opens
  with aspect), and reduced by the panel padding, that margin and slack.
* **The dense grids keyed to the viewport, not to the plate.** `.case`,
  `.system` and `.check__grid` are container queries now. With `min-width: 0`
  and `overflow-wrap`, because a grid child will not shrink below its longest
  word and Hungarian supplied enough 20-character words to hold a case study at
  a 244px floor inside a 189px plate — 36px of horizontal document overflow at
  every altitude on an 844×390.
* **The ring was clipped on every mobile-landscape viewport, not just one.**
  −10px at 844×390, −15px at 800×360, −11px at 932×430, −10px at 896×414, all
  top and bottom, with 199–275px unused left and right. `fit` takes the tighter
  axis; at 2.16:1 the width term wins and leaves a 2.22-unit vertical view for a
  ring measuring 2.53 units. FRAME_HEIGHT now opens with aspect from 1.85,
  derived from that measurement. Now +33/+36/+38/+36px; desktop untouched.

### B.9.2 Still open: portrait text collisions (30 samples)

All 30 remaining failures are portrait: 768×1024, 430×932, 390×844, 360×800,
320×568, plus one at 1024×768. **The cause is now identified rather than
guessed, and it is not the one §9 previously assumed.**

A panel is as tall as its stage's share of the track — up to 4.4 screens — and
the copy plate is centred inside it. So the band split, which puts the eyebrow
and headline above the instrument and everything else below it, lines up with
the two clear bands at *exactly one scroll offset*: the one where plate and
viewport coincide. Through the rest of the stage the plate is simply travelling
— it enters from the bottom of the screen, crosses the instrument, and leaves at
the top. Measured on a 390×844 at 5 454 m, the eyebrow sits at y=486 and the
headline at y=518, both mid-screen, across a dial spanning 325–516.

**Pinning the plate was tried and is recorded as rejected.** `position: sticky;
top: 0; height: 100svh` in portrait makes the bands hold at every scroll
position by construction, and it made the measured count *worse* — 30 → 40 —
because it keeps the copy on screen for the whole stage instead of roughly one
screen of it, exposing the second half of the problem everywhere rather than
occasionally: **the dense panels' content does not fit the bottom band.** On a
390×844 the band below the instrument is ~328px and the ladder stage's copy is
~500px. It does not fit, and no amount of anchoring makes it fit.

The reverted state is therefore not "passing"; it is failing less often because
the copy is off-screen for most of each stage.

### B.9.3 What closing 9.2 requires — a decision, not a patch

Within the corrections the brief permits, and with readable font size, section
count, word volume, all three locales and a central instrument all preserved,
the arithmetic on a 320×568 does not close. The remaining levers are:

1. **A portrait-only bounded instrument scale during dense stages.** The
   `recede` mechanism already does exactly this for the case studies
   (12 300–15 600 m) — scale and depth, never displacement, so the instrument
   stays central and complete. The ladder (3 000–8 000 m) and system/process
   (17 000–24 000 m) stages have comparable copy density and no recede, because
   recede was wound back so the second and third ring locks would not land as
   thumbnails. That trade was tuned against desktop framing.
2. **Accepting that dense portrait copy extends below the fold**, which the
   brief sanctions for 200% zoom and which is arguably the same situation.

Both change accepted composition, so both are escalated rather than chosen here.

### B.9.4 Not yet measured

Unchanged from the previous revision, and still required before sign-off:

* CLS before/after font integration;
* font load timing, fallback duration, slow load and load failure;
* the 101-sample sweep across all three locales (runs so far are hu, 17-sample);
* 200% browser zoom and increased text size;
* the 16 evaluation stills, which need regenerating at the production font and
  re-accepting as a Phase 6 set;
* the full regression and the deploy preview.

Not yet measured, and required before Phase 6 can be signed off:

* CLS before/after font integration;
* font load timing and fallback duration;
* the 101-sample sweep across all three locales (runs so far are 12-sample, hu);
* 200% browser zoom and increased text size;
* slow font load and font-load failure;
* the 16 evaluation stills need **re-acceptance** — the composition changed, and
  the previous stills were captured with the wrong typeface.

# 09a · The three-scene depth proof

**Phase 5.2A.** Can the Altimeter become the constant foreground object without
making the homepage cheaper? Three frames answer that, and nothing has been
generalised past them.

*Scope.* Desktop, 1440 × 900, Hungarian. Acts I, III and V. The remaining acts,
the passages, the arrival, the action beat and mobile are untouched — §37, §43
and §53. Nothing is pushed, merged or deployed.

*Assets.* `depth/three-scene-before-after.png` is the decision sheet.
`depth/hero-depth-proof.png`, `depth/system-depth-proof.png`,
`depth/high-altitude-depth-proof.png` are the scenes on their own.
`depth/illumination-5-states.png` is §26. `depth/occlusion-debug.png` is §27.
`depth/three-scene-motion.webm` is §33.

---

## A · Reference measurements used

Carried unchanged from the PASS 0 audit, which is accepted. They are transcribed
in `styles.css` beside the values they produced, so the audit and the
implementation cannot drift apart.

| what was measured | quiet | active | ratio |
| --- | --- | --- | --- |
| display slot, `ELEGANT CONTOURS` | 0.500 | 1.000 | 0.50 |
| display slot, `MODEL` over `146GR` | 0.297 | 1.000 | 0.30 |
| support copy | 0.274 | 0.603 | 0.45 |

Two further findings from the audit are load-bearing here rather than in the
reading light, and both are §23's:

* the premium object is **never visually tiny** and never in a reserved
  rectangle of its own;
* the fall-off of a light front spans **most of a block**, not a line of it —
  the film's one frame showing a front inside a single block runs 0.401 / 0.292
  / 0.127 down 0.20 of the frame.

### PASS — accepted from PASS 0 and used unchanged

---

## B · Reading-light final parameters

Unchanged from PASS 1, which is accepted in principle. One publisher, no
listener, no per-letter DOM, no second clock. Every value below is a number the
panel already publishes or a constant beside it.

```
--ink-quiet     var(--act-34)    0.34   the monument's quiet state
--ink-passage   var(--act-46)    0.46   the passage's quiet state
--ink-active    var(--act-100)   1.00
--read-soft     62%                     the ramp, as a fraction of the block
--ramp-read     0.66 screens            the front's own tempo
--ramp-read-lead 0.30 screens           so the sweep starts with the arrival
```

The front is a vertical `linear-gradient` from `--ink-active` to `--ink-quiet`,
clipped to the glyphs, with its two stops arithmetic on `--read`. Line-by-line
activation falls out of it for free because the authored lines are already
blocks — nothing in the code knows how many there are (§5).

**Measured, at Act V, five positions of the front** (`depth/illumination-5-states.png`;
contrast is the ink's 98th percentile against the field's 5th, inside each
line's own rect):

| `--read` | `Innen már látni` | `a görbületet.` |
| --- | --- | --- |
| 0 | 0.319 | 0.340 |
| 0.25 | 0.563 | 0.340 |
| 0.5 | 0.923 | 0.490 |
| 0.75 | 0.923 | 0.890 |
| 1 | 0.923 | 0.945 |

The statement exists at every state — 0.32 at `--read: 0` is quiet ink in the
atmosphere, not an element at zero opacity (§3, §10). The front reaches line 1
before it reaches line 2 and the two never move together, which is what
distinguishes this from a fade of the block (§5, §10). Reduced motion pins
`--read: 1` and the mask is removed outright, so that path renders the authored
active composition with every word at full contrast (§6).

**PASS** — unchanged from the accepted prototype, now measured on the frames the
proof is judged on.

---

## C · Occlusion technique

**A hole cut in one element, not a change of stacking order.**

The obvious implementation — put the canvas in front of the copy — is wrong for
one fatal reason: the canvas is the whole viewport. In front of the statement it
is also in front of the support line, the action, the index and the micro
labels, and §25 keeps every one of those in clear air. There is no z-index that
means *in front of this element and behind that one* for a single full-screen
sibling.

So the layering is expressed from the other side. Exactly one element is allowed
to go behind the object, and it gets a hole cut in it:

```css
[data-occlusion='monument'] .act__monument:not(.act__monument--figure) {
  --occl-cx: calc(var(--occl-x, -9999) * var(--u) - var(--act-m));
  --occl-cy: calc((var(--occl-y, -9999) - var(--mono-y, 0)) * var(--u));
  mask-image: radial-gradient(
    calc(var(--occl-rx) * var(--u)) calc(var(--occl-ry) * var(--u))
      at var(--occl-cx) var(--occl-cy),
    transparent 99.4%, #000 100%);
}
```

Four numbers, published once a frame by `publishComposition` in the study's own
reference frame, and two subtractions to bring them into the statement's box.
Nothing is measured, nothing is read back off the canvas, and no bitmap is
generated from a screenshot (§29).

The edge is **hard**. §13's warning about hard edges is about the reading light —
a luminance front crossing the words, which must not read as a loading bar. This
is the opposite kind of object: a physical case in front of them, and real cases
have hard edges. The two gradient stops are 0.6% apart, which on the largest
dial in the proof is a single pixel of antialiasing.

Three paths lose the effect rather than the words: forced colours, print, and
reduced motion all set `mask-image: none`.

### PASS

---

## D · Why the simple mask was accepted

§8 says to try the simplest geometry first and then inspect it critically, and
§9 warns that a generic radial mask may fail once the housing rotates. Both were
answered by measurement rather than by looking at a dark object on a dark field.

`experiments/probe-silhouette.mjs` rasterises the shipped geometry's real
projected silhouette out of the scene graph — every triangle of the
`meridianRoot` subtree minus the gimbal, scan-converted into a coverage grid at
2px — and reports the radius at each of 360 angles from the silhouette's own
centroid.

**The shape is a circle, and not by coincidence.** Across 360 rays the radius
varies by ±4% of its mean at Act I's near-frontal pose and ±3% at Act VI's, and
the residual shows as a slight horizontal stretch rather than as lumps. It is a
round case seen nearly face-on in every pose the art direction asks for. Making
the mask an **ellipse** rather than a circle — one extra authored number — takes
the worst-case radial error from about 4.5% of the radius to about 1.5%, which
on the largest dial in the proof is under four pixels.

**The scale is not a constant, and that is the half of §9 that is real.**

| pose | authored dial | silhouette | ratio |
| --- | --- | --- | --- |
| Act I, ground, 221 px (the old placement) | 221 | 268 × 256 | 1.213 |
| Act VI, arrival, 160 px | 160 | 194 × 190 | 1.213 |
| Act I, ground, 470 px (this proof) | 470 | 556 × 546 | 1.183 |
| Act III, 4 500 m, 800 px | 799 | 1124 × 1042 | 1.407 |
| Act V, 27 000 m, 980 px | 979 | 1302 × 1278 | 1.330 |

Three things move it and all three are real: the bezel **lifts toward the
camera** as the case opens with altitude, so it magnifies; **yaw** narrows the
silhouette and slides its centre; and `railFaceYaw` turns the object back toward
the camera by an amount that depends on where in the frame it stands. A single
constant would be wrong by up to 19%, which on the Act III dial is 170 px.

**The sign of the error is the design decision, not its size.** The residual has
to fall on one side or the other, and the two sides are not symmetrical:

* **eroded** — the mask stops short, a glyph runs a few pixels past it and is
  painted over the case's own dark rim. On an object this dark that is
  invisible.
* **dilated** — the mask reaches past the object, a glyph stops short, and a
  sliver of sky is left between the letter and the thing that is supposed to be
  covering it. That is §8's *a circle was cut out of the text*, in miniature and
  on every letter at once.

So the published radius is eroded by 2%, and the calibration is measured against
the object's **visible** footprint rather than its geometric one — a case edge
below the display's own quantisation is not an edge a reader can see.

**ACCEPTED, with a per-pose calibration.** The simple mask is not merely
mathematically convenient; the shape is measured to be correct to within about
1.5% of the radius. What it needed was four measured numbers per pose instead of
one model-wide constant.

### PASS — the simple mask was accepted, not defended

---

## E · Silhouette vocabulary

§10 asks for a small authored vocabulary rather than a new renderer, and the
measurement collapsed the shape family to one — an ellipse — so the vocabulary
is four numbers per authored pose, all fractions of the authored dial, all
measured off the shipped geometry at that exact placement and transcribed into
`acts.ts`:

| act | dx | dy | rx | ry |
| --- | --- | --- | --- | --- |
| I · ground | −0.0532 | −0.0085 | 0.5915 | 0.5809 |
| III · system | 0.0407 | 0.0317 | 0.7031 | 0.6518 |
| V · high altitude | 0.0916 | 0.0462 | 0.6648 | 0.6526 |
| VI · arrival | 0.0125 | 0.0125 | 0.6500 | 0.6375 |

`dx`/`dy` exist because **the housing's centre is not the dial's centre**: the
case is deeper than it is wide, so any yaw slides its silhouette off the face it
wraps. At Act I that is 25 reference pixels to the left, and left is the side the
statement arrives from.

Interpolation between two adjacent poses is a lerp of the four numbers, which is
correct because they are fractions of the dial and the dial itself interpolates.

**Not in the vocabulary: the rings.** See §I — they are the one place this
system has a real limit.

### PASS — four numbers per pose, four poses, no new renderer

---

## F · Shared placement state

`composition.ts` gained one exported function, `instrumentStateAt(progress)`,
and it is the only thing either consumer reads:

```
progress ──▶ instrumentStateAt ──┬──▶ AltimeterMeridian   world transform
                                 └──▶ publishComposition  --occl-x/y/rx/ry
```

It returns the dial's centre and diameter in reference pixels, the mask's centre
and radii, the pose in degrees off the base pose, the presence, and the
occlusion intent. `AltimeterMeridian` inverts it into a world transform through
`actWorldX`, `actWorldY` and `actInstrumentScale`, which already existed;
`publishComposition` divides it by the frame scale and writes it out.

**Why the projected geometry is exactly the authored geometry.** The renderer
does not place the object and then discover where it landed — it solves the
world position and scale that make it project *onto* `x, y` at diameter `dial`.
So at full presence the projected dial **is** the authored dial on every
viewport, and the mask can be written straight off the authored numbers with no
read-back and no lag. §28's alignment test is a check on that claim, not a
calibration of it.

**One change was needed to make it true, and it is a simplification.** The
withdrawal used to be two operations in the renderer: multiply the scale by
`0.18 + 0.82 × presence`, and subtract 0.9 world units from z. The z term moves
the object toward the vanishing point by a factor the stylesheet has no way to
know, so a mask written off the authored placement would slide off the object for
exactly as long as the withdrawal lasted — §28's *mask leading the object*.
Receding along the view axis **is** a uniform scale about the principal point,
so both pieces are now one operation inside the solved state: shrink the dial and
pull its centre toward the frame's centre by the same factor. Same law, same 0.18
floor, same cut-off; the difference is that the mask can perform the identical
arithmetic.

### PASS — one solved state, two consumers, no read-back

---

## G · Hero proof

`Magasságot építünk.` — `depth/hero-depth-proof.png`

|  | before | proof |
| --- | --- | --- |
| dial | 221 px | **470 px** (52% of the frame's height) |
| centre | 1206, 296 | **1085, 363** |
| relationship | object beside the statement, 202 px of air between them | statement runs behind the housing |
| statement | `Magasságot` / `építünk.` | **`Magasság··`** / `építünk.` |
| other objects covered | — | **none** |

The composition this replaces is *polite*: two objects, side by side, in separate
rectangles, with the object small enough to read as a mark rather than as a
thing. §24 replaces that logic outright — the typography and the object may share
space — and the reference audit's finding is that the premium object is never
tiny and never in its own reserved box.

**The Hero shows the object whole.** Cropping is Act III's and Act V's
vocabulary; this is the frame where the object is *established* as a precision
artefact (§16), so it is seen entire, with air above and below it. It is still
more than twice the size it was.

**Where the occlusion edge falls is an art-direction decision, not a consequence
of the size.** The candidate at a 420 px dial put the housing's edge cleanly
after `Magasság` — and *magasság* is a Hungarian word. The frame then read as the
sentence *Magasság építünk*, which is not a sentence, and it read that way
whether or not the viewer noticed the object: nothing was covered, a word had
simply become shorter. This produced the rule the whole proof now follows:

> **The edge must cross a glyph, never fall between two.**

A partly covered letter says *something is in front of this*. A cleanly ended
word says *this is the word*. At 470 the edge falls through the bowl of the `o`.

Line 2 is untouched — §17's *both critical portions* — so the phrase is
reconstructable at a glance rather than by inference. The support line and the
action are in clear air with 5 px between the housing's lower edge and the
action's band.

**Gate 1 — typography first read: yes** (the statement is larger, brighter and
holds the spine). **Object premium: yes.** **Occlusion invisible as a technique:
yes** — see §K for the numbers. **Reading light improves the hierarchy: yes**
(§B). **Better than Phase 5.1: yes.**

### PASS

---

## H · System proof

`Hat terület, egy rendszer.` — `depth/system-depth-proof.png`

|  | before | proof |
| --- | --- | --- |
| instrument | absent | **800 px dial, about half of it in the picture** |
| centre | — | **1330, 790**, cropped by the right and bottom edges |
| pose | — | **−10° yaw, +3° pitch** off the base pose |
| statement | `Hat terület,` / `egy rendszer.` | `Hat terület,` / **`egy rendsz···`** |
| other objects covered | — | **none** |

§18's warning is what this frame is written against: the study built a second,
small dial beside this statement and cut it, and a smaller instrument beside a
headline is exactly the *UI* reading the whole phase exists to escape. Nothing
here is beside anything. A large instrument enters the frame from the lower
right, cropped by two edges, and the statement runs behind it.

The edge falls through the `e` of `rendszer.`, leaving `egy rendsz` — not a word
in any of the three locales, so §G's rule is satisfied by construction rather
than by luck. `Hat terület,` is untouched.

§19's protected matter is measured clear: the lead line at the counter-axis
(y 196) sits 138 px above the housing's top edge, and the six capability names
along the foot (x 120–690) end 165 px left of it. **The compressed System content
from Phase 5.1 was not touched** — no copy moved, no element was added or
removed, and the only change to this act is one row in the placement table.

**Gate 2 — no return to a small dial beside the title: yes.** **Integrated: yes**
— the object is the frame's mass, not an ornament in it. **Details clear: yes.**
**Structurally understandable: yes.** **Luxury level: raised**, on the strength of
scale and crop.

### PASS

---

## I · High altitude proof

`Innen már látni a görbületet.` — `depth/high-altitude-depth-proof.png`

This is the decisive gate and the one place the system met a real limit.

|  | before | proof |
| --- | --- | --- |
| instrument | absent | **980 px dial, about a quarter of it in the picture** |
| centre | — | **1600, 780**, cropped by the right and bottom edges |
| pose | — | **−16° yaw, +6° pitch** |
| statement | `Innen már látni` / `a görbületet.` | **`Innen már látn·`** / `a görbületet.` |
| other objects covered | — | **none** |
| horizon | clean | **clean** — the earth's limb runs across the lower left, the object enters on the right |

What is visible is a dark limb: the housing's upper-left arc, one bezel and the
outer chapter ring catching the rim light — §21's *rim/specular information
defines the object*, almost literally. The dial's `8` and `7` are legible at the
right edge and nothing else of the face is.

`a görbületet.` is untouched **including its full stop**, which is why the centre
is at 1600 and not at the 1560 an earlier pass preferred as a mass: at 1560 the
housing swallowed the period. A statement that loses its own punctuation has been
damaged rather than occluded — see the rule in §M.

### The limit: the ring assembly cannot be masked

Above 25 000 m the three meridian rings are deployed. Measured at this placement,
their envelope is about **1.2 dial diameters** across against the housing's
**0.7**, so there is no position in this frame where the statement can reach the
housing without first crossing a ring.

The rings are deliberately not in the mask, and they cannot be:

* the union of a solid housing and three annuli around it is **not
  star-shaped** — a ray from the centre crosses case, then sky, then a ring arm,
  then sky — so no radial signature can describe it. A mask taken at the outer
  extent cuts type where there is only sky, which is §8's failure in its purest
  form;
* an accurate mask would need multiple sub-paths regenerated per frame, which is
  the *new GPU depth-compositing architecture* §9 rules out unless it is free;
* the rings **idle-rotate** (0.052, 0.031 and 0.017 rad/s), so nothing about
  their position is a static condition that a shape could be authored against.

The consequence is that the statement paints **over** dark ring arms where it
should pass behind them. That is a genuine layering error and it is visible when
the arm is lit: an early candidate at (1520, 480) put a specular ring arm
directly under the `n` of `látni`, and the letter lost contrast against it.

**What makes this placement work is lighting, which §22 names as a lever.** The
key and the rim are concentrated on the housing, so the ring arms nearest the
statement are the far side of the gimbal and are unlit. Photographed at four
points of the rings' own idle rotation, 26 seconds apart — 0 s, 26 s, 52 s,
78 s — the arms that cross the statement stayed under the sky's own luminance
every time.

### Is it stronger than the frame it replaces?

The accepted D3 frame is huge type, a clean horizon and almost nothing else, and
§30 makes weakening it a failure condition. The proof frame keeps all three: the
type is the same size, on the same foot line, minus one glyph; the horizon is
untouched; the interface is still one micro label and one support line. What it
adds is mass and depth in the third of the frame that was empty, and a sense of
scale the frame could not previously state.

**Gate 3 — D3-level quality preserved: yes.** **Instrument does not become UI:
yes** — it is the largest state on the page, not a corner dial. **The crop feels
intentional: yes.** **Headline readable: yes** (14 of 15 glyphs on line 1, all 13
on line 2). **Horizon calm: yes.** **Depth rather than clutter: yes.**

### PASS — conditional on the ring finding above being carried into rollout

The frame passes. The ring-layering error is real, is bounded here by the
lighting, and is the first thing a rollout to the other high-altitude scenes has
to solve. It should not be discovered again.

---

## J · Object continuity

**One object, one solver, one continuous path.** `instrumentStateAt` holds an
authored placement across its own act's peak stage and eases between adjacent
placements over the gap, so nothing about the object's position or size is ever
a step. A placement that jumped at a stage boundary would move the object
laterally in one frame, which is the failure `railWorldX` exists to prevent, and
it would tear the mask off the object for exactly as long as the jump lasted.

**Scale.** 470 → 800 → 980 reference pixels across the three scenes, and the
change is continuous because the interpolation is over `dial` rather than over
one of six discrete roles.

**Pose.** Authored as degrees off the object's base pose, and deliberately small:

```
Act I     yaw   0°   pitch  0°     established, presented
Act III   yaw −10°   pitch +3°
Act V     yaw −16°   pitch +6°
```

§15 asks for the minimum physical motion and no rotation that exists only
because it could. These are additions to the pose the object already has — the
power-on ramp and the three-quarter reveal, which are altitude-driven and were
already changing the object across these three altitudes. The authored deltas
say *this act sees the object slightly more from the side*, and nothing more.

**§14, quaternions.** The pose interpolates as two independent angles. The
authored poses are within 16° of each other on one axis and 6° on the other, so
there is no large rotation for a slerp to take the short way round, no axis flip
to avoid and no gimbal degeneracy in range. §14's hazard is real and this is
simply not a case of it; a rollout that authors larger pose changes should
revisit it, and the note is in `instrumentStateAt`.

**Withdrawal.** All three proof acts gained a `leaves` value, and Act I's is the
one the frames caught rather than the arithmetic.

At 221 px in the upper right the Hero's object could sit through the hand-over to
Act II without meeting anything. At 470 px in the middle right it sits exactly
where `Idelent minden zajos.` arrives from — and the withdrawal makes it worse
rather than better, because receding along the view axis pulls the object toward
the frame's centre, which is *into* that statement. Photographed at 1.3 screens
into the panel: the Hero's own statement has scrolled away, the object is still
at 82% of its presence, and Act II's statement is fading up across it.
`validate-meridian.mjs` reports 89 320 px² of text collision at 150 m, against an
act that declares no occlusion — a §45 violation as well as a bad frame.

`leaves: 0.85` is where it stops: presence 1 at the composed frame, 0.16 at 1.15
screens against a statement itself at a tenth of its arrival, and below the
cut-off by 1.3. **This is the clearest evidence in the proof that the object's
size and its temporal budget are one decision and not two** — the placement
table could not be changed without the withdrawal table changing with it.

Acts III and V take Act VI's 1.15, for Act VI's reason. Both have a body, so both
frames release 0.8 of a screen into a panel that runs on for two more, and
without it the object outstayed its own composition — measured, it was still
being drawn at 8% of its presence a third of a screen into the cloud-entry
passage, which is a passage that budgets no instrument at all.

**The one boundary where two placements touch.** Act V's chapter is immediately
followed by Act VI's, so the two anchors share an edge and a selecting solver
would have jumped 880 reference pixels and 820 of dial in a single frame there.
`instrumentStateAt` therefore eases across a window that opens
`PRESENCE_RAMP` before the anchor being left releases and closes at the moment
the next takes hold. Two consequences, and both are why the window has that
shape rather than straddling the boundary evenly:

* an anchor's own span is never inside a transition, so the mask is live from
  the first frame of an act rather than switching on 0.4 of a screen in — which
  is exactly where the composed frame sits;
* at the V→VI boundary the window sits inside the gap `leaves` opens, so the
  whole 880 px move happens with nothing on screen to see it move.

**And that gap had to be made to exist.** Two chapters in a row carrying the
object was impossible before this proof — the budget was Act I and Act VI, eight
chapters apart — so `instrumentPresenceAt` simply skipped a boundary whose two
sides agreed. With Act V handing straight over to Act VI, that meant no ramp at
all: photographed at 27 840 m, the arrival's statement fades up over an object
that has already slid into the arrival's own position, at **full presence**,
covering 12 032 px² of a statement whose act declares no occlusion. A zoom-out,
and §31 asks the arrival to be a return.

So `leaves` is now honoured on its own terms — *an act that declares when it
leaves, leaves, even if the next act carries the object too* — and the next
chapter's own entrance brings it back. The guard is the PLACEMENT and not the
act: two chapters that share a placement have nothing to hand over and must not
blink. Measured after: presence 0 through the hand-over, and the residual
overlap with the arrival's statement is 4 320 px² at 0.22 presence.

**Presence.** The proof extends the appearance budget from two acts to four, and
no further. Between them the object still *withdraws* in §32's sense — the
composed frames at Acts II and IV contain no instrument at all — so what the
motion capture shows between the proof scenes is a withdrawal and a return with
a changed pose and a changed size, not a permanently visible object.

**This is the one part of §50's question the proof does not answer.** A *constant*
foreground object, present in every frame, would require the remaining seven
chapters to be authored, which §37 defers until these three gates are judged. What
is proven is that the object can be a foreground object in three very different
compositional problems without any of them getting cheaper.

`depth/three-scene-motion.webm` — 19.5 screens at a reading pace, dwelling 2.2 s
on each composed frame.

### PASS

---

## K · Mask alignment

Measured by `experiments/probe-mask-align.mjs`, which photographs each frame
twice — once as composed, once with the instrument taken out of it and nothing
else changed — and subtracts. What is left is the object's **visible** footprint,
which is not its geometry: a triangle that renders at one part in a thousand
above the sky is in the bounding box and is not in the picture.

The ellipse is then walked at 720 points. At each point inside the frame, the
distance inward to the first visible object pixel is the **gap** — the mask
reaching past the object, which is §8's hole — and the distance outward is the
**overhang** — the object continuing past the mask, which is a glyph over a dark
rim and is the error this system is biased toward.

### At the composed frames

| scene | mask | edge points | gap median | gap p90 | gap worst | overhang |
| --- | --- | --- | --- | --- | --- | --- |
| Hero | 272 × 268 at 1060, 359 | 720 / 720 | **0 px** | 67 px | 75 px | 40 px |
| System | 551 × 510 at 1362, 815 | 214 / 720 | **0 px** | 5 px | 34 px | 65 px |
| High altitude | 638 × 626 at 1689, 825 | 147 / 720 | **0 px** | 0 px | 9 px | 128 px |

The remaining edge points are cropped by the frame and say nothing about the
mask. **On the arc the statement actually arrives from** (120°–240°, which is the
left of the object):

| scene | points | gap median | gap p90 | gap max |
| --- | --- | --- | --- | --- |
| Hero | 241 | 15 px | 25 px | 69 px |
| System | 139 | **0 px** | 4 px | 34 px |
| High altitude | 134 | **0 px** | 0 px | 9 px |

Hero's 15 px median is the case's own edge falling below 1.5 levels out of 255
against the sky — the object is geometrically there and photometrically not. On a
148 px statement it is a tenth of a stroke width, and the frames in
`depth/occlusion-debug.png` show it as invisible.

### Through the presence ramps — §28's intermediate samples

The object arrives and leaves through a ramp, and the withdrawal law is where a
mask that is authored beside the object rather than solved with it comes off it.

| sample | presence | mask | gap median | gap p90 |
| --- | --- | --- | --- | --- |
| Act III, 0.02 screens in | 0.53 | 341 × 316 at 1117, 676 | 23 px | 83 px |
| Act III, 0.06 | 0.61 | 374 × 346 at 1156, 698 | 19 px | 58 px |
| Act III, 0.12 | 0.71 | 420 × 390 at 1210, 729 | 14 px | 27 px |
| Act III, 0.20 | 0.83 | 476 × 441 at 1274, 765 | 3 px | 16 px |
| Act V, 0.02 | 0.54 | 396 × 389 at 1321, 683 | 0 px | 49 px |
| Act V, 0.08 | 0.64 | 452 × 444 at 1406, 716 | 0 px | 47 px |
| Act V, 0.16 | 0.78 | 521 × 511 at 1511, 756 | 0 px | 34 px |

The mask tracks the object through the whole withdrawal. **No lag, no one-frame
drift, and no case where the mask leads the object** — it never sits ahead of it
in the direction of travel, because both are the same arithmetic on the same
number read on the same frame. The residual widens as presence falls because the
per-pose calibration was measured at the settled altitude and the case's opening
is altitude-driven; at presence 0.53 that is 23 px on a 341 px radius, or 6.7%,
and the statement at that point is itself at a third of its arrival ramp.

In the gap **between** two authored placements the state interpolates and the
occlusion intent is deliberately `none`: the object is on its way out of one
frame and into the next, the statement it was standing in front of is leaving
with its own frame, and an occlusion that outlived the frame it was authored for
would cut a hole in a statement with nothing behind it.

### PASS

---

## L · Performance

Measured by `experiments/probe-act-cost.mjs`, twice against the same build — once
as it ships and once with the one rule the proof added switched off.

| act | draws | triangles | style recalcs | **layouts** |
| --- | --- | --- | --- | --- |
| I · ground | 57 / 57 | 157 694 / 157 694 | 12 / 10 | **0 / 0** |
| III · system | 50 / 50 | 155 804 / 155 804 | 23 / 19 | **0 / 0** |
| V · high altitude | 37 / 37 | 31 140 / 31 140 | 41 / 27 | **0 / 0** |

*(with mask / without mask, over the same scripted scroll)*

**Zero layouts at all three proof acts, on both runs.** That is the number that
matters: a composition that measured text would show up here and this one does
not measure anything. Draw calls and triangle counts are identical to the digit,
because the mask is a compositor operation and not geometry. The style-recalc
counts differ by 2–14 over a four-second scroll — a handful of custom-property
writes, which is what the quantisation is for — and are of the same order as acts
with no instrument at all, which recorded 22–36 in the same sweep.

Frame times are not reported: headless Chromium is on SwiftShader here and the
medians swung by a factor of three for the *same* act between two runs of the
same build.

Structurally, against §30's list:

* **no new continuous layout reads** — the mask is four custom properties, all
  arithmetic on `journey.current`, quantised to a tenth of a reference pixel;
* **no per-letter DOM** — the element is the whole statement, as it was;
* **no second rAF loop** — the values are published from `JourneyHUD`'s existing
  tick, beside `--alt` and `--instrument`;
* **no blur and no filter** — the mask is a two-stop gradient;
* **one Three.js canvas** — unchanged.

While a frame is pinned the object is still, so the four properties do not change
and the composed state — where a visitor spends almost all of an act — costs
nothing at all.

### PASS

---

## M · Collision-contract changes

§45 forbids disabling the overlap checks and asks for an intentional-depth
contract instead. Three changes, and two of them make the suite *stricter*.

**1 · The intent is declared, never inferred.** `Placement` gained
`occlusion: 'none' | 'monument'`, `FullAscent` writes it onto the act's panel as
`data-occlusion`, and the stylesheet's mask rule is gated on that attribute. An
act cannot acquire the exemption by drifting into an overlap — someone has to
have written the intent down (§46).

**2 · `validate-meridian.mjs` exempts exactly one pair.** The check used to say
*the instrument may not overlap type, full stop*. It now skips a
`.act__monument` inside a panel that declares `data-occlusion="monument"`, and
nothing else. The support line, the lead, the action, the routes, the index, the
readout and any monument in an act that did not declare one are unchanged and
still forbidden at every altitude.

**3 · Two new contracts in `six-acts.spec.ts`.**

*The object stands in front of the statement and in front of nothing else.* For
every act, the published ellipse is tested against every object in that act's
frame. Where occlusion is declared, the monument may be covered and nothing else
may be touched; where it is not, no mask may be published at all. Measured at the
proof frames: monument 10% / 11% / 7% of its box, **and no other object at any
act**.

*An occluded statement keeps enough of itself to be read.* §47 asks for this not
to collapse to one arbitrary percentage, so the unit is the **glyph** — one
`Range` per character, its own rect against the published ellipse. Four things
are asserted, and the fourth is the only rule in the proof that is not a
percentage:

> **A statement may lose its full stop, but only in the company of the word it
> belongs to.**

The candidate frames are what corrected this from the obvious version. A
statement whose final *word* is visibly cut does not read as a sentence missing
its punctuation — it reads as a sentence continuing behind an object, and the
reader supplies the letters and the stop together without noticing they did.
`egy rendsz···` is that, and it is right. What is wrong is `a görbületet` with
the period alone taken: there the word is whole, the sentence looks finished, and
the absent stop reads as a typographic mistake rather than as depth. One earlier
High Altitude candidate did exactly that, at a centre 40 px left of the authored
one, which is how narrow the difference is.

| rule | Hero | System | High altitude |
| --- | --- | --- | --- |
| a whole line survives | `építünk.` | `Hat terület,` | `a görbületet.` |
| no line loses 40% of itself | 2/10 = 20% | 3/13 = 23% | 1/15 = 7% |
| the statement keeps 75% of its glyphs | 89% | 88% | 96% |
| **the full stop is never taken alone** | ✓ | ✓ | ✓ |

The optical question — does the edge fall *through* a letter rather than between
two words — is not assertable and is the more important half. It is judged on the
frames in §G, §H and §I.

**4 · A new probe, and one retired for this question.**
`experiments/probe-depth-contract.mjs` asks the same question *everywhere else*:
121 samples across the whole track, the housing's solved ellipse against every
piece of type on screen, and any overlap that is not the permitted pair is a
breach. It replaces `validate-meridian.mjs` for this and only this: that harness
measures deviation from the **phase-6 rails**, and the six-act art direction
replaced the rails with authored placements, so it now reports 136 failures of a
contract the design no longer has. (Its collision check is what caught the Act I
regression above, and its crash on a null centre — an object legitimately not in
the picture — was fixed rather than worked around.)

**Swept result: 17 permitted monument overlaps, 5 breaches, all in transit.**

| where | presence | what | area |
| --- | --- | --- | --- |
| Act I, frame releasing | 0.97 / 0.71 | the Hero's action line | 7 568 px² |
| Act III arriving | 0.32 | Act III's lead line | 6 576 px² |
| Act V arriving | 0.27 | Act V's lead line | 4 160 px² |
| Act V → VI hand-over | 0.22 | the arrival's statement | 4 320 px² |

Four of the five are the same phenomenon at a tenth of the object's size: **an
act's frame is sticky inside its own panel and the object is not.** The frame
slides into place, or releases and travels up, while the object holds the
position its progress gives it — so during a hand-over the two cross. The object
is at 0.22–0.32 of its presence in three of them, which is 0.36–0.44 of its
scale and a long way behind, and the copy is in front of it and fully legible.

**The Hero's action line is the one that is not small.** At 0.97 presence the
object is at full size, the frame has released, and `Kezdjük az emelkedést`
travels up through the housing's lower-left arc. It is structural rather than a
matter of a few pixels: the action band sits at x 920–1090 and a 470 px object
that reaches `Magasságot` at x 788 necessarily spans that column. It cannot be
solved by moving the object — moving it right far enough to clear the action's
column also moves it off the statement.

It is **not** an occlusion: the action is in front of the object, at full
contrast, on a dark ground, for the length of one frame release. But it is an
overlap the contract forbids, it is a direct consequence of the object being
2.1× larger, and it is listed as rollout work rather than waved through. The two
ways out are to move the Hero's action band, or to give the object the frame's
own rise during the release.

### The locale finding, which is rollout work

The placements are authored once and the statements' authored line breaks differ
per locale, so the occlusion differs per locale. Measured at 1440 × 900:

| | Hungarian | English | German |
| --- | --- | --- | --- |
| Hero | `Magasság··` / `építünk.` | `Altitude is` / `what we buil··` | `Höhe` / `bauen wir.` — untouched |
| System | `Hat terület,` / `egy rendsz···` | `Six areas,` / `one syste··` | `Sechs Bereic···` / `ein System.` |
| High altitude | `Innen már látn·` / `a görbületet.` | untouched | untouched |
| glyphs hidden | 2 / 3 / 1 | 2 / 2 / 0 | 0 / 3 / 0 |

**All three locales satisfy the contract**, including the full-stop rule: where a
period is covered it is covered together with at least the letter before it.

What differs is how much the system *does*. Hungarian is occluded at all three
acts, which is what the proof is judged on. German is occluded at one of the
three and its other two statements simply do not reach the object — its authored
breaks are shorter. English is occluded at two.

The reason is structural rather than a matter of a few pixels, and it is worth
recording because it decides how the rollout has to be authored: **whether a
statement can be occluded at all depends on where its longest line falls.** In
Hungarian the longest line of the Hero and High Altitude statements is the
**first** one, so an object entering from the right reaches the middle of the
phrase; in English it is the **last** one, so the same object reaches the end of
the sentence and the cut has to be deep enough to take the final word with it.
At the English Hero it is — `what we buil··` — but the margin is one letter
wide, and a shorter English line would have failed.

A rollout that wants the three languages to compose alike needs either a
per-locale `x` in the placement table, for which the table's per-locale monument
settings are the precedent, or re-authored breaks. Neither is in this proof's
scope. **The proof is Hungarian, at 1440 × 900, as §31 asks.**

**The suite is green: 25 of 25 contracts pass** against the production build,
including the two written for this phase, and the swept contract above runs
against the dev route as a separate probe.

### PASS

---

## N · Visual gate result

| gate | result |
| --- | --- |
| **1 · Hero** — typography first, object premium, occlusion invisible, reading light improves hierarchy, better than 5.1 | **PASS** |
| **2 · System** — no small dial beside the title, integrated, details clear, structurally understandable, luxury sustained | **PASS** |
| **3 · High altitude** — D3 preserved, instrument not UI, crop intentional, headline readable, horizon calm, depth not clutter | **PASS**, conditional |

**All three scenes are stronger than the frames they replace.** The system may be
generalised — §37 — subject to the four conditions below being carried into
rollout rather than rediscovered.

The conditional on Gate 3 is the ring finding, not the frame: the High Altitude
picture is better than the one it replaces on every criterion §36 lists, and the
condition is about what the *next* high-altitude composition has to be checked
for.

### Conditions carried forward

1. **The rings cannot be masked** (§I). Above 25 000 m any placement whose
   housing reaches the statement puts ring geometry between them. It is bounded
   here by the lighting and by one measured placement; every further
   high-altitude scene has to be checked the same way, and the check is
   `probe-depth-studio.mjs` at four ring phases.
2. **The three languages do not compose alike** (§M). Hungarian is occluded at
   all three acts, English at two and German at one, because the authored line
   breaks put the longest line in different places. Per-locale placement or
   re-authored breaks, decided before rollout rather than during it.
3. **The Hero's action line crosses the object while the frame releases** (§M).
   7 568 px² at full presence, for the length of one frame release; the action
   is in front and legible throughout, and the composed frame is clean. Either
   move the Hero's action band or give the object the frame's own rise. It is
   the only breach in the swept contract that is not at a tenth of the object's
   size.
4. **The object still withdraws between the proof scenes** (§J). The *constant*
   foreground object of §50 is not proven and cannot be until the remaining
   chapters are authored.

### What was deliberately not done

Per §53: the remaining acts, the four passages, the proof act, the arrival, the
action beat and mobile are untouched. `actPlacementAt` was replaced by
`instrumentStateAt` but the full eleven-scene interpolation was not built. The
debug view is a probe and is not shipped. Nothing was pushed, merged or deployed.

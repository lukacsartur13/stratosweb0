# The real 3D Altimeter on portrait mobile — measured

The SVG instrument was not visually accepted. The Altimeter is a Stratos
signature and a drawing of it is a drawing of it. This work restores the real
GLB to portrait mobile **without** restoring any of the architecture it used to
arrive with.

Branch `mobile-3d-altimeter`. Not merged, not deployed.

---

## 1 · What changed

| | before (`main`) | after |
| --- | --- | --- |
| the instrument | inline SVG | `models/stratos-altimeter.glb` — the desktop file, unmodified |
| the scene | none | one GLB, one camera, four lights, one baked probe |
| the render loop | none | `frameloop="demand"`, and demand is genuinely zero when idle |
| the scroll integration | `onAscent` → SVG attribute | `onAscent` → object transforms → `invalidate()` |
| the slot | an SVG sized in `vw` | a CSS box with a fixed aspect ratio and no height input |
| the SVG | the portrait experience | the failure path only |

Three files carry it:

* `mobile/instrument.ts` — the arithmetic, importing nothing. Camera solve,
  needle mapping, the entry/hold/exit pose, the motion threshold. This is why
  the stage can decide *whether* to load a renderer without loading one to ask.
* `mobile/MobileInstrument.tsx` — the scene. The only import path to `three`,
  `@react-three/*` and the GLB on this page.
* `mobile/MobileAltimeter.tsx` — the slot: capability probe, lazy boundary,
  loading state, error boundary, fallback.

Plus `mobile/ascent.ts` gains `onMeasure()` and a cached `viewportHeight()`, so
the instrument rides the measurement pass the sections already have rather than
installing a second set of listeners.

---

## 2 · A / B / C

Three builds, one harness, one script, at 390×844, over an identical twenty-step
read of the whole document.

* **A** — `8d71150`, the simplified SVG mobile homepage
* **B** — this branch
* **C** — `cd75083`, the terrain mobile baseline

| | A · SVG | B · real GLB | C · terrain |
| --- | ---: | ---: | ---: |
| WebGL canvases | 0 | **1** | 1 |
| draw calls, whole read | 0 | **216** | 4 177 |
| triangles, whole read | 0 | **119 952** | 3 136 590 |
| rAF callbacks during scroll | 51 | **59** | 348 |
| scroll listeners at rest | 2 | **2** | 6 |
| scroll listeners registered *during* scroll | 0 | **0** | 34 |
| forced layout reads (`getBoundingClientRect`) | 152 | **154** | 1 558 |
| style writes | 64 | **63** | 1 702 |
| main-thread ms inside rAF during scroll | 39 | **28** | 249 |
| **draw calls over 4 s idle** | 0 | **0** | 13 200 |
| **rAF over 4 s idle** | 0 | **0** | 736 |
| movement 420 ms after the scroll stops | 0 px | **0 px** | 2 px |
| long tasks | 0 | **0** | 0 |
| transfer, uncompressed | 848 KB | **2 120 KB** | 3 040 KB |
| document length | 17 screens | 17 screens | 25 screens |

Sixty seconds of synthesised touch scrolling with fling, first third against
last third:

| | A · SVG | B · real GLB | C · terrain |
| --- | ---: | ---: | ---: |
| median frame, first third → last | 16.7 → 16.7 ms | 16.7 → 16.7 ms | 16.7 → 16.7 ms |
| p95, last third | 17.7 ms | 18.6 ms | 18.6 ms |
| heap over the minute | +533 KB | **−1 438 KB** | +1 278 KB |

**B preserves A and massively outperforms C**, which was the objective. The two
numbers that carry it are the idle window — 0 against 13 200 draw calls — and
the listener churn, 0 against 34 registered mid-scroll.

The frame-pacing rows discriminate nothing: an M4 holds 16.7 ms for all three.
That is a property of the machine, not of the builds. §22.

### Transfer, honestly

B costs 1 272 KB more than A uncompressed: 883 KB of `three` /
`@react-three/*` / `drei` and 388 KB of GLB. Compressed as the site actually
serves it, the renderer chunk is 242 KB gzip. Nothing else was added — no HDR,
no environment file, no texture, no second model. The environment is prefiltered
in the page from three flat emitters and costs zero bytes.

That is the price of a real instrument and it is the decision this brief takes.
It is still 920 KB *below* the terrain baseline.

---

## 3 · The on-demand claim, and how it was made true

It was false twice before it was true, and both times only a counter could tell.

**First: the settle never terminated.** An exponential chase approaches its
target and never arrives, so with a 1e-4 rad threshold and a 0.26 s retain the
renderer kept drawing for 3.2 seconds after a jump the length of the document.
Invisible on screen, 1 377 draw calls in the idle window. Fixed by raising the
threshold to 5e-4 rad — 0.05 device pixels of needle-tip travel — and shortening
the retains.

**Second: the instrument kept drawing after it left the screen.** It occupies
one slot near the top of a seventeen-screen document. Fixed with an
`IntersectionObserver`: off screen, the scroll reader brings the instrument to
its target instantly and asks for no frame at all.

**Third: react-three-fiber re-rendered `<Canvas>` on every scroll event.** Its
`useMeasure` defaults to `{ scroll: true }`, which attaches a capture-phase
scroll listener and re-renders the root — and r3f invalidates on every root
render. 162 draw calls over six scroll steps taken four screens past the slot,
with the off-screen gate already working. Fixed with `resize={{ scroll: false }}`;
this scene has no pointer interaction, so nothing reads the measurement it
protects. That also took the extra scroll listener with it — 3 → 2, the same as
build A.

Two regression tests now hold all three: *nothing renders while the page is
idle* and *nothing renders while the instrument is off screen*, both asserting
exactly zero.

---

## 4 · Two defects the measurements found

**A 100 KB font.** The loading silhouette was an `<i>` — the element the
Meridian rules on this page already use. An empty `<i>` still resolves the
italic face of its inherited family, and build B was requesting
`archivo-italic-latin.woff2` where build A was not. Found by diffing the two
transfer breakdowns by kind. It is a `<span>` now.

**An invisible fallback.** The canvas crossfade was written as
`.mv-alt__stage > div`, a structural selector that also matched the fallback
drawing's wrapper — and `data-ready` is set only by the render loop that does
not exist on that path. A visitor with no WebGL got an empty slot containing a
correctly laid-out, completely invisible 315px instrument. Playwright's
`toBeVisible` does not consider opacity, so the fallback test passed; the review
screenshot is what showed it. The selector is a class on `<Canvas>` now, and the
test asserts effective opacity through every ancestor.

---

## 5 · The harness had to be fixed before it could be trusted

Playwright's Chromium defaults to SwiftShader, a CPU rasteriser. On a page with
a live canvas that turns a performance measurement into a measurement of
SwiftShader. At 390×844 with the instrument on screen:

| rasteriser | long tasks | total |
| --- | ---: | ---: |
| SwiftShader (default) | 44 | 2 704 ms |
| ANGLE Metal, Apple M4 | **0** | **0 ms** |
| SwiftShader, quarter-size buffer | 0 | 0 ms |

Same page, same build, same script. Every one of those long tasks was the
software rasteriser filling a 694×694 buffer with 4× multisampling on the main
thread. The third row is the control: a quarter of the pixels removes the whole
effect, which no main-thread JavaScript regression would do.

`probe-mobile-cost.mjs`, `probe-mobile-endurance.mjs` and
`record-mobile-scroll.mjs` now launch onto the platform backend and record which
one served the page. `--software` restores the old behaviour.

---

## 6 · §25's checklist, verified

Portrait mobile, over a full read of the document:

| | |
| --- | --- |
| terrain GLB requests | **0** |
| cloud renderer | **0** |
| terrain shader | **0** |
| camera journey | **0** |
| layout feedback loops | **0** |
| scroll hijacking | **0** |
| dynamic exclusion zones | **0** |
| real Altimeter GLB | **1** |

Each is a test in `tests/mobile-homepage-simple.spec.ts` rather than an
assertion here: exactly one canvas and exactly one `.glb`, which is the
altimeter; no `mountains`, `JourneyScene`, `ScrollTrigger` or `draco` request;
no `.hdr`/`.exr`/`.env`; the document is the scrolling element and nothing calls
a scroll API on the page's behalf; the slot's box, the next section's document
position and the document height are all identical before and after the
instrument arrives.

**The desktop composition is unchanged.** `probe-desktop-unchanged.mjs` diffs
seven points through the track at 1440×900 and 1280×800 against `main`: worst
frame differs by 0.071% of pixels, which is the live scene's own cloud and star
jitter.

---

## 7 · Where the instrument is, and why there is only one

One slot, in the opening section, in ordinary document flow: headline →
instrument → supporting copy. That is the first of the two compositions §12
sanctions.

Sticky was considered and rejected on §14 grounds. A pinned instrument with copy
scrolling over it is half-covered by construction, and there is no z-order that
fixes it without putting an opaque plate on a page whose whole §14 guarantee is
that it has none.

The consequence is that the instrument is a **hero object rather than a
persistent HUD**: it is composed for about a screen and a half, then leaves
upward in its exit pose, and the fixed telemetry strip carries the altitude for
the remaining fifteen screens. The review package's "mid" and "late" stills are
that travel. There is no frame in which the instrument is at 30 000 m, because
there is no frame in which it is both on screen and at 30 000 m.

**This is the one part of the brief that was interpreted rather than followed
literally**, and it is worth a decision at review: §24 asks for a
"late-journey state", and what the package contains is the instrument's late
state rather than the page's. If the intent was for the Altimeter to be present
through the upper stages as well, that is a second slot and a second decision —
it would mean either a second WebGL context or moving one canvas between hosts,
and neither should be added silently.

---

## 8 · The slot, at every viewport

The box is `width: min(100%, 86vw)` with `aspect-ratio: 1 / 1`, and in landscape
`min(100%, 38vw)` with `16 / 9`. **There is no viewport-height unit in it.**

§13 states the range in `svh` and the first version said so literally —
`max-block-size: 46svh`. The suite caught it: on the reference device the small
viewport is 664px, 46svh is 305px, the square height of 335px was clipped by it,
and growing the viewport moved ten of eleven sections by 42px. `svh` is
genuinely stable across a toolbar collapse, but a height cap that *binds* makes
the slot a function of the viewport's height, and then a rotation, a keyboard or
a differing `svh` implementation reflows the whole document below it. A
width-driven box cannot.

| viewport | slot (CSS px) | share of viewport height | drawing buffer |
| --- | --- | ---: | --- |
| 430×932 | 370 × 370 | 39.7% | 739 × 739 |
| 390×844 | 335 × 335 | 39.7% | 670 × 670 |
| 375×812 | 323 × 323 | 39.7% | 645 × 645 |
| 360×800 | 310 × 310 | 38.7% | 619 × 619 |
| 844×390 | 321 × 180 | 46.3% | 641 × 360 |

Against the *small* viewport the shares are 39–50%. §13's range is 38–52.

The camera is solved from the canvas's aspect ratio rather than tuned per
device — one closed-form solve keeps the instrument at 83% of the frame's short
axis on all five, and in landscape, and at whatever the box clamps to in
between. Four tuned constants would be right for four viewports and silently
wrong for the fifth.

---

## 9 · Lighting, materials, glass

Four static lights and one probe. Nothing here is altitude-driven, because the
portrait instrument is seen against one near-black background for the whole time
it is on screen — a light that changed would be a light changing for no reason
the visitor could see, and under a demand frameloop it would also be a reason to
draw frames.

* **Key** — high and to the left, the desktop direction, stronger: desktop's
  dial is read against a lit mountain valley and this one against black.
* **Rim** — permanently on rather than arriving at 24 000 m, for the same
  reason: there is never a sky behind this instrument to separate the case from
  the background.
* **Probe** — prefiltered with `PMREMGenerator.fromScene` from the same three
  emitters, in the same places, at the same intensities as the desktop
  composition's `<Lightformer>`s. Zero bytes on the wire.
  Imperative rather than drei's `<Environment frames={1}>`, which renders its
  probe from inside `useFrame` and therefore would not exist until something
  invalidated — a race whose losing side is a visibly flat instrument on the
  frame the visitor lands on.
* **`envMapIntensity` ×1.45** on every standard material. The single knob that
  does most of §8's work: a directional light gives an edge a highlight, the
  environment is what gives steel and graphite their *material*.
* **Glass** — the crystal is authored at alpha 0.16 and metalness 0, so its
  specular response is 4% of what it reflects and then multiplied by the alpha
  when it composites. Against black it was simply not there. Fixed with the
  blend mode, not the opacity: additive at full opacity means the crystal
  contributes only light, so what lands on the dial is the reflection and none
  of the fog. `depthWrite: false`, or it occludes the needle tips beneath it.
  No transmission, no refraction — §10.

Every material change is restored on unmount, because these materials come out
of the GLTF cache and outlive the component.

---

## 10 · Reduced motion, and the fallback

§20 is followed as written and it is a deliberate reversal of the obvious
behaviour: **reduced motion keeps the real instrument.** The capability probe
does not consult the preference at all. The scene reads it, holds the composed
pose, drives nothing from scroll position, and writes the needles through
without a settle. A short crossfade on arrival is the only motion left.

The SVG is reachable only when there is no WebGL, when the renderer cannot be
created, or when the scene throws — `SceneBoundary` wraps the canvas and only
the canvas, so a lost context costs the visitor the instrument and nothing else.
The loading state is deliberately *not* the SVG: a radial and one hairline ring
at 8.5% inset, which is exactly where the bezel lands, so the crossfade has
nothing to travel and cannot be mistaken for an instrument.

---

## 11 · What has not been established

* **Anything about a real phone.** Frame pacing, heat, touch latency, Safari's
  toolbar in motion, GLB decode on an A-series CPU, and whether the instrument
  reads at arm's length rather than on a desk. §22.
* **Whether one slot is the right answer.** See §7 above.
* **WebKit's environment probe.** The suite runs `mobile-390` on WebKit and it
  passes, but `PMREMGenerator` output has been eyeballed only in Chromium.
  Worth a look on the device.

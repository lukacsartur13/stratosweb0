# Mobile homepage fidelity — baseline and root-cause audit

Scope: the portrait-mobile homepage (`/`, `/en/`, `/de/`), built from
`experiments/src/full` by `npm run build:home`. This is a correction pass on
accepted Phase 8.5 / Phase 9 work, not a redesign and not a new phase.

---

## 0. A note on the evidence

§1 of the brief refers to four supplied iPhone screenshots. **No images arrived
with the brief** — the message contained text only. Every defect in §2 is
described in enough detail to work from, so this audit reproduces each one by
measurement against the real built page instead, and says so wherever a finding
rests on emulation rather than on a device.

All numbers below are measured on the production build served from `dist/`,
Chromium, `deviceScaleFactor` 2–3, `isMobile`, `hasTouch`, at the portrait sizes
in §22. Emulation is sufficient for layout geometry and for the timing of the
scroll clock; it is **not** evidence about scroll *feel* on iOS, and §22's
distinction between emulated and real-device verification is preserved
throughout.

---

## 1. Baseline

| | |
|---|---|
| Branch | `phase-9-conversion-seo-production-finalisation` |
| Commit | `1b3828f8561c3f518345ebf8b6c4d7bc7600ff2a` |
| Subject | `docs(phase-9): the reconciliation, the readiness manifest, and the verdict` |
| Working tree | 1 modified (`.claude/settings.local.json`), 77 untracked (`experiments/.tmp-*` probes) |
| Staged | none |

No Phase 8.5 or Phase 9 commit is reset, rebased, squashed or discarded by this
pass.

### Homepage architecture inventory

| Concern | File |
|---|---|
| Route entry | `experiments/src/full/main.tsx`, `FullAscent.tsx` (699 ln) |
| Stage map, altitude curve, journey clock | `journey.ts` (622 ln) |
| Scroll drivers | `useJourneyScroll.ts` (344 ln) |
| Portrait/landscape composition, bands, veil | `composition.ts` (1508 ln) |
| Layout | `styles.css` (2175 ln) |
| Scene | `components/JourneyScene.tsx`, `JourneyCamera.tsx`, `MountainRange.tsx` |
| Terrain shader | `components/mountainMaterial.ts` (411 ln) |
| Terrain art direction presets | `mountainLook.ts` (475 ln) |
| Terrain variant selection | `mountainAsset.ts` (139 ln) |
| Shared site header | `assets/js/header.js` + `assets/css/chrome.css` (66 other routes) |
| Terrain source | `blender/mountains/stratos_terrain.py` (70 577 b), `generate_stratos_mountains.py` |

### Assets

| Asset | Size |
|---|---|
| `public/models/stratos-mountains-desktop.glb` | 345 744 B |
| `public/models/stratos-mountains-mobile.glb` | 164 148 B |
| `public/models/stratos-altimeter.glb` | 396 912 B |

Blender CLI **is** available: `/Applications/Blender.app/Contents/MacOS/Blender`,
version 5.2.0 LTS. §13.1 applies rather than §13.2.

### Viewport-unit and sticky inventory

`styles.css` uses `svh` throughout for track and stage geometry and never bare
`100vh` for pinned geometry; the one `100vh` is a `min()` ceiling on the HUD's
bottom inset. `dvh` and `lvh` are unused. Sticky elements: `.journey__stage`
(z 0), `.panel[data-fit='window'] .panel__inner`. Stacking contexts on the path
to the instrument: `.journey__stage` (z 0), `.journey__content` (z 2), `.hud`
(z 3), `.nav` (`position: fixed`, z 890), `.skip` (z 900 on this route).

### Measured track geometry (before)

| Viewport | vh | document | track | screens |
|---|---|---|---|---|
| 430×932 | 932 | 22 568 | 20 131 | 24.2 |
| 393×852 | 852 | 20 782 | 18 403 | 24.4 |
| 390×844 | 844 | 20 603 | 18 230 | 24.4 |
| 375×812 | 812 | 19 885 | 17 539 | 24.5 |
| 360×800 | 800 | 19 613 | 17 280 | 24.5 |

All eleven panels resolve to `data-fit="window"` at all five sizes.

---

## 2. Root causes

The brief asks for the actual cause of each defect, and specifically for the
*shared* cause behind the three named sections rather than three local patches.
There are four, and three of them are shared.

### RC-1 — The blank prelude is the lead band's bottom alignment (§2.1)

**Defect.** `Those who climbed with us.`, `Nine areas in three layers.` and
`Seven checkpoints. No guesswork.` each open with a large empty plate before any
content.

**Measured.** Scrolling to the exact document position at which each stage's
flow begins, and reading where the first meaningful element sits inside that
first viewport:

| Stage | eyebrow (390×844) | title | 430×932 | 360×800 | `--meridian-gap` |
|---|---|---|---|---|---|
| calibration | 21svh | 24svh | 26 / 29 | 21 / 24 | 25svh |
| initial-ascent | 26svh | 29svh | 27 / 30 | 26 / 30 | 25svh |
| lower-atmosphere | 29svh | 32svh | 30 / 33 | 29 / 32 | 26svh |
| cloud-entry | 29svh | 32svh | 30 / 33 | 29 / 32 | 26svh |
| cloud-breakthrough | 20svh | 23svh | 24 / 27 | 15 / 19 | 24svh |
| **selected-work** | **31svh** | **34svh** | 32 / 35 | 31 / 34 | 22svh |
| **system** | **35svh** | **38svh** | 36 / 39 | 29 / 35 | **14svh** |
| **process** | **30svh** | **33svh** | 34 / 37 | 27 / 33 | 18svh |
| stratosphere-transition | 33svh | 36svh | 34 / 37 | 33 / 36 | 18svh |
| full-stratosphere | 32svh | 35svh | 33 / 36 | 26 / 32 | 19svh |
| destination | 7svh | 11svh | 10 / 13 | 3 / 6 | 20svh |

§6 asks for first meaningful content within ~8–14svh, ~18svh where a transition
earns it, and forbids unexplained 30–70svh introductions. Nine of eleven stages
are outside that, and the three named ones are the three worst in the middle of
the journey. On 390×844 the `system` stage opens with **256 px — 30svh — of
unbroken opaque plate** between the bottom of the header and the eyebrow.

**Cause.** In the portrait window composition (`styles.css`, the
`@media (max-aspect-ratio: 1/1)` block) the plate is a three-row grid:

```
grid-template-rows: var(--band) auto var(--band);
--band: max(0px, calc((100svh - var(--meridian-gap, 34svh)) / 2));
```

and the lead band is bottom-aligned inside row 1:

```
.panel[data-fit='window'] .panel__band--lead { grid-row: 1; align-self: end; }
```

So the headline is pinned to the *bottom* of the top band, and everything above
it — `--band` minus the headline's own height — is void by construction. The
void is therefore `(100svh − gap)/2 − leadHeight`, which **grows as the
instrument's exclusion band shrinks**.

That is the whole of it, and it explains why the three named stages are the
worst three. `selected-work`, `system` and `process` are the dense content
stages, and they are exactly the stages at which the instrument recedes to make
room for copy (`DENSE_RECEDE_MAX` in `composition.ts`). Receding shrinks
`--meridian-gap` from ~25svh to 14svh, which grows `--band` from 37svh to 43svh,
which drops the bottom-aligned headline to 35–39svh. **The mechanism that gets
the instrument out of the copy's way is what pushes the copy down the screen.**

Bottom-aligning the lead was right when the band was sized to the dial and the
headline sat just above it. It stops being right the moment the band is allowed
to grow beyond the headline, because the alignment then spends the surplus above
the text instead of below it.

### RC-2 — Copy has already been walked out of the window before its stage begins (§2.1, §9)

**Defect.** At the entry to `Seven checkpoints. No guesswork.`, checkpoint `01`
is not on screen — the first visible checkpoint is `02`, with a clipped empty box
above it. At the entry to `Nine areas in three layers.`, the first layer's
heading is missing and the panel opens mid-list.

**Measured.** `--stage-flow` at the exact scroll position where each stage
begins, against the arithmetic in `windowOf()`:

| Stage | share | previous share | `w.from` | `--stage-flow` at stage start |
|---|---|---|---|---|
| selected-work | 4.4 | 1.6 | −0.073 | 0.086 — 8.6% pre-walked |
| system | 2.4 | 4.4 | −0.208 | 0.258 — 25.8% pre-walked |
| process | 3.0 | 2.4 | −0.160 | **0.193 — 19.3% pre-walked** (probe reads 0.193) |

**Cause.** `--stage-flow` is normalised across the *legibility* window, which
starts half a handover **before** the stage does:

```js
from: isFirst ? 0 : -incoming / 2,
put(panel, '--stage-flow', clamp((p - w.from) / (w.to - w.from || 1)));
```

At `p = 0` — the stage's own start — the numerator is already `+incoming/2`, so
the walk is 9–26% complete before the visitor arrives. On a seven-item list 19%
is the first checkpoint; on a three-layer diagram 26% is the first layer.

The legibility window is correct for *fading* — a plate genuinely does start
appearing before its stage. It is wrong for *position*, because the reading
order of the copy has to start at the top when the stage starts. Fade and
travel were sharing one normalisation and needed two.

### RC-3 — Content position is animated by the damped clock (§2.4)

**Defect.** Mobile scrolling feels over-pinned, delayed relative to the finger,
and continues after the finger stops.

**Measured.** Parked inside the `process` stage, then a 600 px jump, sampling
the flow band's transform every 50 ms while `scrollY` stays constant at 12 922:

```
t=+0ms    copyY = -910 px
t=+100ms  copyY = -1163 px
t=+200ms  copyY = -1228 px
t=+400ms  copyY = -1246 px   (settled)
```

**After the scroll has completely finished, the body copy keeps travelling for a
further 336 px over 400 ms.** That is not a visual flourish on a decorative
layer — it is document text moving under the reader.

**Cause.** `publishComposition()` derives `--stage-flow` from
`rawProgress(journey.current, stage)`, and `journey.current` is the *damped*
value (`settle(current, target, JOURNEY_SMOOTHING = 0.82, dt)`), not the scroll
position. §4.1 asks for exactly this separation and the code has it backwards for
one consumer: the needle, the camera and the atmosphere should be damped, and
they are; the position of copy in the document should be raw, and it is not.

There is no scroll hijacking to remove. There is no smooth-scroll library — Lenis
is deliberately absent and documented as such. There is no wheel interception, no
snapping, no programmatic document scroll, and no second scroll listener. The
"artificial" feel is this one damped consumer.

### RC-4 — The HUD strip and the site header occupy the same band, with no real safe area (§2.2)

**Defect.** In the opening/calibration state the safe area, header, calibration
rail and hero content overlap ambiguously, and a faint technical rail appears
behind or too close to the navigation.

**Measured** at 390×844, elements in the top 160 px:

```
0..77   fixed  z=890  header.nav
25..52         z=auto   a.brand            (wordmark)
18..60         z=890    button.burger      ("MENÜ")
0..92   abs    z=3    div.hud              ← the strip
7..31          z=auto   div.hud__readout   ("0 m")
11..27         z=auto   p.hud__stage       ("Kalibráció")
52..84         z=auto   button.hud__sound
```

The HUD strip spans **0..92 px inside the header's 0..77 px band**. The readout
and the stage label sit at 7..31, above and across the wordmark at 25..52. The
sound button at 52..84 pokes out below the header's lower edge. In the header's
`opening` state `.nav` has no background at all, so the strip shows through it —
which is precisely the "faint technical rail behind the navigation" described.

Two further facts:

* **`.nav` has no safe-area padding.** `assets/css/chrome.css` declares
  `padding: 1.1rem var(--gut)` and nothing else, on all 67 routes.
* The single `env(safe-area-inset-top)` in the homepage CSS is on `.hud`
  (`styles.css:1955`). Because the strip is *above* the header rather than below
  it, that inset makes the collision **worse** on a real iPhone, not better: it
  moves the readout from 7..31 down to 47..71, which is the wordmark's row.
* The header's `journey` state publishes its own altitude (`.nav__alt`, "ASCENT
  — 08 420 M") while the strip publishes the same altitude 20 px away. That is
  the "two overlapping representations" §10.2 forbids.

There is no single authoritative top-layout calculation. Header height, safe
area and the strip's origin are decided in three places that do not know about
each other.

### RC-5 — Landscape phones load the portrait terrain (§12.3, §23)

**Not in §2, found while auditing it, and in §23's required test list.**

| Device | viewport | pointer | dpr | composition | GLB loaded |
|---|---|---|---|---|---|
| iPhone 13 | 390×664 | coarse | 3 | portrait | `stratos-mountains-mobile.glb` ✅ |
| iPhone 14 Pro Max | 430×740 | coarse | 3 | portrait | `stratos-mountains-mobile.glb` ✅ |
| Pixel 7 | 412×839 | coarse | 2.6 | portrait | `stratos-mountains-mobile.glb` ✅ |
| **iPhone 13 landscape** | **750×342** | coarse | 3 | **landscape** | **`stratos-mountains-mobile.glb`** ❌ |
| Desktop | 1440×900 | fine | 1 | landscape | `stratos-mountains-desktop.glb` ✅ |

`mobileScore()` at 844×390: aspect 2.19 gives `−1 × 3 = −3`, but coarse pointer
`+2`, a narrow-ish 750 px at dpr 3 `+0.6` and the reduced tier `+0.5` sum to
`+3.1`. Net `+0.1 / 8 = +0.0125 > 0` → mobile. A landscape phone gets a
composition authored for a 9:19.5 frame, in a frame that is 2.19:1.

The file's own documentation says aspect "is weighted highest for that reason".
It is weighted highest and it is still outvoted, because the other four terms
all agree with each other on a phone.

### RC-6 — The terrain has a depth ramp but no material zoning (§2.6)

**Confirmed by reading the shader.** `components/mountainMaterial.ts` grades
albedo by **distance from camera** — `uBaseNear / uBaseMid / uBaseFar`
interpolated on `vDepth` — and modulates lighting by height (`uCrestGain`) and
by up-facing-ness (`uValleyDarken`). Both are depth and lighting terms.

There is no height-banded albedo, no slope mask, no snow, and no vertex-colour
or procedural zoning of any kind. The module's own header states the intent:
"No noise, no triplanar texture, no Fresnel term, no outline, no facet
exaggeration." So §14's four zones — lower valley, rocky middle band, upper
ridges, snow accents — are genuinely absent on both desktop and mobile, exactly
as §2.6 describes.

The remedy is small and belongs in this shader rather than beside it: `vHeight`
(model metres above the camera) and the world normal `N` are already varyings in
the fragment stage, which is everything height-band and slope masking need.

### RC-7 — §2.5 is right about the frame and wrong about the cause

§2.5 attributes the stretched portrait silhouette to the desktop scene being
used on portrait mobile, and §12 asks for a dedicated portrait terrain to be
created.

**The asset selection is not the cause. A dedicated portrait terrain already
exists and portrait mobile already loads it** —
`stratos-mountains-mobile.glb` (164 148 B against the desktop's 345 744 B) is a
separate composition, not a decimated desktop scene, generated by
`blender/mountains/stratos_terrain.py` from `mobile_masses` with its own frame
model, its own `mobile_camera_at()` path (900 m forward / 980 m up against the
desktop's 2050 / 980), its own valley extents and its own composition census in
`blender/mountains/reports/stratos-mountains-mobile-composition.json`. The source
`.blend` is under `blender/mountains/source/`.

**The reported symptom is nonetheless real.** Supplied device screenshot 2
(iPhone, portrait, 2 453 m) shows the portrait terrain rendering as two
near-vertical grey walls running the full height of the frame on both sides,
with a dark corridor between them and no peak silhouette inside the frame at
all. That is §12.1's "two stretched curtains" and §12.1's "peaks leaning outward
rather than becoming vertical walls", against the composition that was supposed
to deliver them.

So the defect is in the **camera station and the mass framing at altitude**, not
in which file is fetched. At 0 m (screenshot 3) the composition reads correctly:
outward-leaning shoulders, a visible valley floor, peaks inside the frame. By
2 453 m the camera has risen 980 m along `mobile_camera_at()` and the masses
that were shoulders are now full-height walls, because the vertical travel
outruns the point at which the authored peaks leave the top of the frame.

Three consequences for this pass, in priority order:

* **RC-6 dominates.** Flat monochrome shading is what makes any silhouette read
  as blockout geometry, and it is absent on both variants. Zoning the material
  changes the character of every frame above, including screenshot 2's.
* **RC-5** is a genuine instance of the wrong composition in the wrong frame,
  and it is in §23's test list.
* The **portrait camera rise** wants re-tuning against the authored peak heights
  so the crests stay in frame through the mid-altitudes. That is a change to
  `mobile_camera_at()` / the camera station, not a new GLB.

Regenerating the portrait terrain from scratch is not indicated: the geometry is
composed correctly at the altitude it was authored against, and the failure is
in how it is framed as the camera climbs. That is cheaper to fix and does not
discard accepted, validated work.

### On §2.3 — not reproduced at the portrait sizes tested

A 121-sample sweep of the full track at 390×844 found no scroll position at
which an opaque `window`-plate band covers the instrument's exclusion zone. The
window composition's transparent middle is doing its job at every stage.

Supplied device screenshot 4 (ascent, 906 m) is consistent with this: the
instrument's silhouette is visible through the plate's clear middle band, so the
band composition is working. What that frame *does* show is the visible
signature of RC-2 — the body copy sliced mid-sentence at the flow band's top
edge ("A website is a single component. With no…"), which reads as broken text
rather than as scrolled text.

The residual risk is real but lives elsewhere: a panel that falls back to
`data-fit="flow"` gets a *solid* card with no transparent middle, and the CSS
only special-cases the destination panel for this. Flow fallback occurs at 200%
zoom, at increased text spacing, and in German at the smaller widths — none of
which are in the five sizes above, all of which are in §21 and §22. That is
where §11's rule needs enforcing, and it is where the regression test belongs.

---

## 3. What this pass will change

| # | Root cause | Change |
|---|---|---|
| RC-1 | lead band bottom-aligned in a growing band | cap the void above the lead; anchor stage entry to a measured budget |
| RC-2 | `--stage-flow` normalised from the fade window | separate travel from fade; travel starts at the stage |
| RC-3 | content position damped | content position from raw scroll; visual layers stay damped |
| RC-4 | header/strip share a band; no authoritative top | one published top-layout value; strip below the header; one altitude representation |
| RC-5 | aspect outvoted on landscape phones | aspect becomes decisive for the portrait composition |
| RC-6 | no material zoning | height-band albedo + slope-masked snow in the existing terrain shader |

Not changed: desktop geometry and framing, the stage map, the altitude curve,
Phase 7 transitions, the Phase 8.5 header state machine and footer, consent and
GA4, the lead pipeline, and the portrait terrain composition itself.

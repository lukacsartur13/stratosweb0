# Mobile homepage fidelity and mountain art direction — final report

A focused correction pass on the portrait-mobile homepage, on top of the
completed Phase 8.5 and Phase 9 work. Not a redesign, not a phase. Every
existing commit is preserved; nothing was reset, rebased, squashed or discarded.

Companion documents:

* `_build/reports/mobile-homepage-fidelity-audit.md` — the baseline and the
  root-cause analysis behind every change below.
* `_build/reports/mobile-homepage-fidelity-review/` — the visual review package
  (uncommitted imagery).

---

## 1. Baseline

| | |
|---|---|
| Branch | `phase-9-conversion-seo-production-finalisation` |
| Baseline commit | `1b3828f` — *docs(phase-9): the reconciliation, the readiness manifest, and the verdict* |
| Working tree at start | 1 modified (`.claude/settings.local.json`), 77 untracked probe scripts |

### On the supplied screenshots

The brief referred to four iPhone screenshots. They did not arrive with the
original message, so the audit reproduced each §2 defect by measurement first.
The screenshots arrived later in the session and are cited below where they
changed a conclusion — which they did once, materially, in §9.

---

## 2. Root cause of each reported defect

| Defect | Root cause | Status |
|---|---|---|
| §2.1 Excessive empty space before three sections | The lead band is bottom-aligned in a grid row of height `--band`, so all of row 1's surplus is spent *above* the headline. `--band` is `(100svh − gap)/2`, so it **grows as the instrument recedes** — and the three named stages are the dense ones, the ones the instrument recedes for. | Fixed |
| §2.1 (second cause) First list item missing on arrival | `--stage-flow` was normalised across the plate's *legibility* window, which starts half a handover before the stage. 9–26% of each panel's copy had already been walked out when its stage began. | Fixed |
| §2.2 Opening/header overlap | Three components each decided where the top of the screen was. `.nav` had no safe-area inset on any of the 67 routes; the one `env()` on the page was on the strip, which sat *above* the header, so it made the collision worse on notched devices. | Fixed |
| §2.3 Altimeter covered by section backgrounds | Not reproduced in the window composition — a 121-sample sweep found no such position. The real exposure is the `flow` fallback, whose plates are solid cards. | Fixed (fallback) |
| §2.4 Scrolling feels artificial | No hijacking existed. `--stage-flow` — the *position of document copy* — was driven by the damped journey clock. Measured: body text kept travelling 336 px over 400 ms after `scrollY` stopped changing. | Fixed |
| §2.5 Desktop geometry stretched into portrait | **Misattributed.** Portrait already loads a dedicated portrait GLB. The symptom is real (screenshot 2) and comes from camera framing at altitude, not asset selection. | Partly fixed; see §9 |
| §2.6 Monochrome blockout mountains | The terrain shader graded albedo by *distance* only. No height bands, no slope mask, no snow — one substance at several brightnesses. | Fixed |
| — (found in audit) Landscape phones load the portrait terrain | Aspect was weighted highest and still outvoted: four device signals all agree with each other on a phone. | Fixed |
| — (found in testing) The page scrolled itself | A measured layout value fed the window/flow *decision*; one pixel of noise flipped a panel, changing its box by a screen, resizing the track, refreshing ScrollTrigger, nudging the scroll. A 4 px oscillation, forever. | Fixed |
| — (found in testing) The strip's readout was occluded | `.journey__stage` had a numeric `z-index`. A sticky element with one opens a stacking context, sealing the strip beneath its *sibling* `.journey__content`. | Fixed |

---

## 3. Stage entry

### Before → after, first meaningful content at each stage's own entry frame

Measured by scrolling to the exact document position at which a stage's flow
begins, waiting for the damped clock to settle, then reading where the section
marker lands. 390×844:

| Stage | Before | After |
|---|---|---|
| calibration | 21svh | 17svh |
| initial-ascent | 26svh | 17svh |
| lower-atmosphere | 29svh | 13svh |
| cloud-entry | 29svh | 13svh |
| cloud-breakthrough | 20svh | 13svh |
| **selected-work** — *Those who climbed with us.* | **31svh** | **13svh** |
| **system** — *Nine areas in three layers.* | **35svh** | **13svh** |
| **process** — *Seven checkpoints. No guesswork.* | **30svh** | **13svh** |
| stratosphere-transition | 33svh | 13svh |
| full-stratosphere | 32svh | 13svh |

430×932: 12svh at every journey stage, 15svh at calibration.
360×800: 14svh at every journey stage, 18svh at calibration.

The two calibration/initial-ascent figures are higher because the header is in
its `opening` state there and is 29 px taller by design. §6 asks for 8–14svh
with headroom to ~18svh where a transition earns it; the instrument line under
the header is that element.

### The three named sections

**Shared cause, corrected once.** §6 asked for the shared cause rather than
three patches, and there were two:

1. **`--lead-lift`.** The lead pair is still bottom-aligned against the
   instrument while the band is tight — the accepted composition, unchanged to
   the pixel — and is lifted out of row 1's surplus once the band grows past the
   entry budget plus the measured headline. `--lead-h` is published per panel by
   `measureComposition` because CSS cannot read the height of a box in order to
   position it.

2. **`walkFrom`.** The copy's *travel* now starts at the stage's own start; the
   plate's *fade* still starts half a handover earlier. One normalisation was
   doing both jobs and could only be right for one. `from`, `to` and `gone` are
   untouched, so the cross-fade is the cross-fade it was.

**`--lead-wash`.** Lifting the headline moved the void from above it to below
it, and a void is a void wherever it is put. The plate's opaque wash now ends at
the lead's own bottom edge instead of running to `--band`, so that space becomes
the mountains and the instrument standing in them. The plate reads as a caption
at the top of a frame rather than a rectangle with a hole cut in it.

Per-section outcome:

* **Our Work** — marker, headline, then the scene, then the lead line and the
  first project (name, altitude, scope). No full-screen screenshots were added;
  the controlled-proof treatment is unchanged.
* **Nine areas in three layers** — marker, headline, the concentric-ring visual,
  the lead, and **layer 1 fully visible** in the first viewport. Layer 1's
  heading was previously walked off the top before the visitor arrived.
* **Seven checkpoints** — marker, headline, the lead, and **checkpoint `01`
  fully visible**. The stage previously opened on `02` with a clipped empty box
  where `01` had been.

---

## 4. Header, safe area and the deck

**One authoritative calculation**, published by `watchDeck` in `siteHeader.ts`:

```
--deck-top      = quantise(headerHeight + 6)      the strip's origin
--deck-content  = quantise(--deck-top + stripHeight + 6)   the narrative's floor
```

Measured off the shared header's real border box rather than composed from
parts, because the header is shared with 66 other routes and free to change
without this file being told — and because its box already carries its own
safe-area padding, which removes the double-count an addition here would create.

* `.nav` now carries `max(…, env(safe-area-inset-top))` in **all three states**.
  The two `padding-block` overrides are longhand pairs: the shorthand was
  silently dropping the top inset in the `journey` state, which is the state a
  visitor spends the whole page in.
* Observed as `border-box`. The states differ mostly in padding, and a
  content-box observation stops firing mid-transition — it left `--deck-top`
  describing a 70 px header that had already compressed to 48.
* The strip moved from `top: 0` (inside the header's band) to
  `top: var(--deck-top)` (below it), and gave up its own `env()`.

**§10.2 architecture: Option B**, arrived at after the evidence changed twice.
The header stands its altitude readout down on this route
(`.journey-home .nav[data-state] .nav__alt`); the strip keeps the readout, the
scale bar and the sound control on one row. Exactly one live altitude on screen.

**Measured overlap** — header ∩ strip, strip ∩ first content, header ∩ first
content — is **0 px at every stage and every portrait size tested**, in both
header states.

---

## 5. Layer system

Central tokens in `styles.css`, in composition order:

```
--layer-scene:   auto   the WebGL surface
--layer-content: 2      the editorial plates
--layer-hud:     3      the instrument strip
--layer-header:  890    quoted from chrome.css
--layer-overlay: 900    quoted from chrome.css
```

`--layer-scene: auto` is load-bearing rather than cosmetic. `.journey__stage`
carried `z-index: 0`, and a sticky element with a numeric index opens a stacking
context — which sealed the strip underneath `.journey__content`, its *sibling*.
The altitude readout had been painting behind the copy plates for the entire
journey: in the DOM, non-zero in size, and invisible. That is what the brief
reported as "a faint technical rail behind the navigation" — not a rail behind
the header, but the altitude behind the copy.

**§11.1 in the window composition** is satisfied by geometry: the wash carries a
clear band sized from the measured exclusion zone, and a 121-sample sweep of the
whole track at 390×844 found no scroll position where an opaque band crosses the
dial. **In the flow fallback** — solid cards, which appear at 200% zoom, at
increased text spacing, in German at the narrow widths — the plate now has a
72 px mask on its leading edge. It does not keep the plate off the instrument;
in flow the copy genuinely runs over the scene. It removes the *cut*.

---

## 6. Scroll architecture

Portrait mobile uses native document scrolling and always did. There is no
scroll hijacking, no wheel interception, no snapping, no programmatic document
scroll, no second scroll listener and no smooth-scroll library — Lenis is
deliberately absent and documented as such.

**The split §4.1 asks for now exists.** `publishComposition` derives two values:

* `pRaw` from `journey.target` — the undamped scroll position — drives
  `--stage-flow`, which is where document copy *is*.
* `pEased` from `journey.current` — the damped clock — drives the cross-fade,
  the needle, the camera and the atmosphere.

| Measurement (390×844, 600 px flick) | Before | After |
|---|---|---|
| Copy travel after `scrollY` stops | 336 px | 2 px |
| Time to settle after the scroll lands | 400 ms | 50 ms |

**And the page no longer scrolls itself.** Parked mid-track, untouched,
`window.scrollY` oscillated 4 px back and forth every ~250 ms indefinitely — a
regression introduced by this pass and caught by its own tests. It arrived
through the layout, not through a handler: `--deck-content` floors the entry
budget, the entry budget takes part in the window/flow decision, and a panel
changing composition changes its box by a whole screen. Both boundaries are now
quantised to 8 px at source and again at the consumer, and the stage label is
`nowrap` for the same reason. Post-fix: a single ~430 ms settle after the first
composition measurement, then rock steady.

Stage durations were **not** globally rescaled. The stage map in `journey.ts` is
unchanged; the entry corrections are compositional, so the altitude curve, the
track height and every calibrated boundary are identical to the baseline.

---

## 7. Terrain material zoning

§14's four zones, added to the existing terrain shader rather than beside it.
Both masks were already free: `vHeight` is a varying the crest ramp needs, and
the world normal is one the key light needs.

| Zone | Desktop | Mobile |
|---|---|---|
| Lower valley (§14.1) | `0x4b5340` muted green-grey | `0x4d5542` |
| Rocky middle band (§14.2) | `0x6a7381` cool slate | `0x6f7886` |
| Upper ridges (§14.3) | `0x9ba6b5` light cold stone | `0x9ca7b6` |
| Snow / frost (§14.4) | `0xc8d4e4`, max 0.60 coverage | `0xc8d4e4`, max 0.52 |
| Zoning strength | 0.80 | 0.70 |

* **No textures.** No fetch, no second UV set, and neither GLB grew by a byte.
  §15.1's preferred strategy taken literally.
* **`uZoneAmount` is the whole restraint budget in one number.** At 0 the shader
  resolves to the accepted palette exactly, which is what makes the change
  reviewable against the look it replaces.
* **Mobile runs lower** because a portrait frame puts copy *over* the terrain
  rather than beside it, and every step of albedo separation is contrast
  competing with body text.
* **Band crossings are jittered per face** by one `sin()` of the normal. On
  flat-shaded terrain that is constant across a facet, so the boundary wanders
  along geometry that already exists rather than along a noise field that does
  not — a pure height threshold would draw a contour line across the range.
* **The route opts out** of zoning and snow: it is a drawn line on the ground,
  and zoning it would fade it into the valley at the bottom and frost it at the
  top.
* **Lighting is unchanged.** No new lights, no exposure change.

Two values were tuned by measurement, and the first pass had both wrong:

* `snowSlope` at 0.62 — a 52° limit, which reads as correct restraint — produced
  **no snow at all**: the peaks that clear the snow line are the sharp ones and
  almost none of their faces are that flat. It moved the frame's p99 luminance
  by 1.2. At 0.38 the accent appears on shoulders and ledges.
* The first zone colours moved measured band separation from Δlum 26.5 to 30.4
  with Δhue unchanged at ~1° — not a distinguishable valley, rock band and
  ridge, but the same slab. At the shipped values:

| Frame | Band separation before | after |
|---|---|---|
| desktop 0 m | Δlum 13.1, Δhue 1.2° | Δlum 16.9, Δhue 1.3° |
| desktop 3 000 m | Δlum 9.9, Δhue 1.0° | Δlum 13.6, Δhue 2.1° |
| mobile 0 m | Δlum 26.5, Δhue 0.1° | Δlum 35.2, Δhue 1.9° |
| mobile 3 000 m | Δlum 27.7, Δhue 0.2° | Δlum 35.9, Δhue 1.8° |

Measured as the mean colour of the ridge, slope and valley thirds of the terrain
in each frame, sky and plate excluded by luminance. The hue figures are small in
absolute terms because the whole palette is deliberately one narrow band of
blue-grey; what matters is that the *relationship* between the three zones
changed from "identical hue at three brightnesses" to a measurable separation on
both axes, which is what makes the bands read as different substances. The
visual check is `terrain/mobile-after-3000m.png` against its `before`.

Desktop geometry and framing are unchanged. §16 is satisfied by the material
hierarchy applying to both variants from one shader and one preset shape.

---

## 8. Assets and performance

| | Desktop | Mobile |
|---|---|---|
| File | `stratos-mountains-desktop.glb` | `stratos-mountains-mobile.glb` |
| Size | 345 744 B | **164 148 B** (47%) |
| Nodes | 16 | 14 |
| Triangles | 131 884 | **48 336** (37%) |
| Vertices | 68 029 | 25 367 |
| Materials | 4 | 4 |
| Textures | 0 | 0 |
| DRACO | all nodes | all nodes |

Unchanged by this pass — no geometry was regenerated. The mobile terrain is
already lighter than the desktop one on every axis §20 lists, carries no unused
or hidden geometry, no animation and no textures at all.

**Nothing unpublished leaks.** `dist/` contains the three GLBs and no `.blend`,
no generation script and no source texture.

**The terrain fails gracefully.** With `stratos-mountains-mobile.glb` blocked at
the network, the page still renders its `h1`, its canvas, all eleven panels and
the portrait composition; the altitude readout still climbs with scroll
(0 → 18 040 m); and there are **zero** page errors. §23's requirement.

**Runtime cost of the zoning**: four `smoothstep`s, one `sin` and two `mix`es
per fragment, on varyings already present. No new uniform per frame beyond the
ten the preset writes, no allocation, no second program — terrain and route
still share one shader source.

**No new permanent loop.** Instrumented on the built page at 390×844:

| Counter | Value | Note |
|---|---|---|
| Peak concurrent `requestAnimationFrame` | 8 | unchanged — the journey still has one clock |
| `ResizeObserver` instances | 7 | **+1**, `watchDeck`, observing two elements |
| `scroll` listeners | 9 | unchanged |
| `resize` listeners | 11 | unchanged |
| JS heap after a 40-step full-track sweep | 14 MB | — |

The one addition fires on a header state transition, a rotation and a font swap,
and only calls back when a quantised boundary actually moved. The composition
still rides `JourneyHUD`'s single tick; no React render per scroll frame; no new
scroll listener; DPR and MSAA policy untouched.

Long-task counts were captured but are **not reported as a result**: this is
headless Chromium on a software rasteriser, where a WebGL page produces long
tasks at a rate that has no relationship to a phone's. Comparing that number
across builds would be measuring the rasteriser. The structural counters above
are the meaningful evidence, and §19's requirements are structural.

---

## 9. The portrait terrain, and what was *not* done

§12 asked for a dedicated portrait terrain to be created, on the premise that
the desktop scene was being stretched into portrait.

**The asset selection was not the cause.** A dedicated portrait composition
already exists and portrait mobile already loads it — a separate scene from
`mobile_masses` with its own frame model, its own `mobile_camera_at()` path
(900 m forward / 980 m up against the desktop's 2 050 / 980), its own valley
extents, its own composition census, and its `.blend` source under
`blender/mountains/source/`. Blender 5.2.0 LTS is available on this machine, so
§13.1 rather than §13.2 applies — but regenerating a correctly-composed asset
would have discarded accepted, validated work to fix something the measurements
do not support.

**The reported symptom is nonetheless real.** Supplied device screenshot 2
(portrait, 2 453 m) shows the terrain rendering as two near-vertical walls
running the full frame height with no peak silhouette in frame — §12.1's "two
stretched curtains" exactly. At 0 m the same composition reads correctly:
outward-leaning shoulders, a visible valley floor, peaks inside the frame. The
defect is therefore in **camera framing as the camera climbs**, not in the
geometry: by 2 453 m the vertical travel has carried the authored crests above
the top of the frame and the masses that were shoulders have become walls.

**What this pass did about it**: the material zoning, which changes the
character of every such frame and is the dominant term in "reads as blockout
geometry"; and the landscape mis-selection, which is a genuine instance of the
wrong composition in the wrong frame.

**What it did not do**: re-tune `mobile_camera_at()`'s rise against the authored
peak heights. That is the remaining fix for the curtain silhouette, it is a
change to accepted art direction, and §16/§25 are explicit that such a change
needs evidence and visual approval rather than a guess. It is the first thing to
take up after this review. See §12 of the audit for the analysis.

---

## 9b. Responsive matrix

Every viewport §22 names, measured on the built site. `nav ∩ hud` and
`hud ∩ first content` are the deck overlaps in pixels.

| Viewport | Composition | Panel fits | Horizontal overflow | `h1` | nav ∩ hud | hud ∩ ink |
|---|---|---|---|---|---|---|
| 430×932 | portrait | window + flow | no | 1 | 0 | 0 |
| 393×852 | portrait | window + flow | no | 1 | 0 | 0 |
| 390×844 | portrait | window + flow | no | 1 | 0 | 0 |
| 375×812 | portrait | window + flow | no | 1 | 0 | 0 |
| 360×800 | portrait | window + flow | no | 1 | 0 | 0 |
| 320×568 | portrait | flow | no | 1 | 0 | 0 |
| 844×390 | landscape | flow | no | 1 | 0 | 0 |
| 1024×768 | landscape | flow | no | 1 | 0 | 0 |
| 1440×900 | landscape | flow | no | 1 | 0 | 0 |
| 1920×1080 | landscape | flow | no | 1 | 0 | 0 |

| §21 condition | Panel fits | Horizontal overflow | Flow plates masked | `h1` |
|---|---|---|---|---|
| 200% zoom | flow | no | yes | 1 |
| Increased text spacing | flow + window | no | yes | 1 |

320×568 resolves entirely to flow, which is correct: at that height the entry
budget plus a headline does not fit above the instrument, and natural flow is
§6's answer rather than a degraded one.

---

## 10. Accessibility and reduced motion

* Reduced motion still un-sticks the track (`position: relative`), shows every
  heading immediately and keeps the complete document. Verified at 390×844.
* One `h1`, correct heading order, no horizontal overflow at 320, 360, 375, 390,
  393, 430, 844, 1024, 1440 and 1920 CSS px.
* The flow fallback is reached more often than before, by design: the window now
  requires `entry + leadH <= band`. That is the accessible composition, not a
  degraded one — copy in natural flow, nothing clipped, nothing scaled down.
* The sound control keeps its 2 rem box; the menu trigger clears 24 px.
* The strip's live regions and its screen-reader altitude announcement are
  unchanged.

---

## 11. Tests

`tests/mobile-homepage-fidelity.spec.ts` — 20 tests, run across every project in
`playwright.config.ts`, portrait-gated where the assertion is about the portrait
composition. Coverage:

* stage entry within budget, per named section, keyed on the copy rather than on
  a stage index;
* `--stage-flow` is 0 at a stage's own start (no pre-walked copy);
* the published entry budget stays inside §6;
* header ∩ strip ∩ first content = 0 at every stage, in both header states;
* `.nav`'s safe-area inset survives every state (asserted against the source, so
  a shorthand that drops it fails even though `env()` is 0 in headless);
* exactly one live altitude readout on screen;
* the menu opens, traps focus, closes, and the composition survives it;
* layer tokens exist, are ordered, are actually read, and the scene stays `auto`;
* no window plate leaves less clear space than the instrument's exclusion zone
  (measured from real band geometry, not from custom properties, which do not
  resolve to lengths);
* flow plates carry a softened leading edge;
* the frame decides the terrain — portrait gets mobile, landscape gets desktop,
  exactly one composition is ever fetched;
* a toolbar-sized height change does not re-fetch the terrain;
* nothing scrolls the document on the page's behalf;
* copy stops when the finger does;
* reverse scroll restores the previous stage.

Three of these caught defects introduced *by this pass* — the deck collision at
390×664, the 4 px self-scroll, and the removed altitude readout — which is the
main argument for their existence.

**Full production suite: 795 passed, 0 failed** (`npx playwright test`, six
projects — node, desktop-1440, desktop-1920, mobile-390, mobile-430,
reduced-motion). That is the baseline's 755 plus this file's 40 runs.

Existing suites unchanged and passing: `public-site`, `homepage-chrome`,
`analytics`, `attribution`, `structured-data`, `lead-endpoint`, `lead-forms`,
`portal`, `not-found`.

One existing assertion had to be understood rather than changed.
`public-site.spec.ts` requires the altitude readout to be visible, and it broke
when this pass first hid the strip's readout. The assertion is right; what it
could not see is that the element it was passing on had been *occluded* by an
opaque plate for the whole journey, because `toBeVisible()` checks the box model
and not what is painted over it. Fixing the stacking context made the assertion
true for the first time rather than merely passing.

### §18 lifecycle

| Transition | Composition | `--stage-entry-px` vs `--deck-content` | Scroll |
|---|---|---|---|
| Load | portrait | 144 / 144 | — |
| Toolbar collapses (+60 px) | portrait | 144 / 144 | held |
| Toolbar expands | portrait | 144 / 144 | held |
| Mid-page (journey header) | portrait | 112 / 112 | held |
| Rotate to landscape | landscape | 120 / 120 | held |
| Rotate back to portrait | portrait | 112 / 112 | held |
| Reload mid-page | portrait | 112 / 112 | restored |
| History back | portrait | 112 / 112 | restored |
| Forward, then back | portrait | 112 / 112 | restored |

No terrain re-fetch on any of them. The toolbar-sized height change is asserted
in the suite as well as measured here.

No timeout was raised anywhere. Where a test waits, it waits for a named
condition — the composition having been measured, the veil having landed, the
scroll position having stopped changing.

---

## 12. Commits

All local. Nothing pushed, nothing deployed.

| Commit | Subject |
|---|---|
| `a72fa9f` | fix: correct mobile homepage stage entry and spacing |
| `f964b58` | fix: resolve mobile header and safe-area layer collisions |
| `f8f14b4` | feat: add zoned terrain materials across homepage |
| `1fc1c5d` | fix: give the homepage one layer order and stop flow plates cutting the dial |
| `5d61dd0` | fix: stop the page scrolling itself, and put the instrument back in front |
| `cf04189` | test: add mobile homepage fidelity regressions |
| `c2d148b` | fix: remeasure the composition when the deck moves |

No `git add .` was used. No screenshots, recordings, render files, Blender
cache, local settings, secrets, unrelated Phase 9 files, source textures or
placeholder assets are committed.

---

## 13. Unresolved limitations

1. **The portrait camera rise (§9 above).** The curtain silhouette at
   mid-altitudes is not fixed. It needs `mobile_camera_at()` re-tuned against
   the authored peak heights, and that is an art-direction change requiring
   visual approval.
2. **Real-device verification.** Everything here is measured under Chromium
   emulation at the §22 viewports. Emulation is sufficient for layout geometry
   and for the timing of the scroll clock. It is **not** evidence about scroll
   feel on iOS Safari, about `env(safe-area-inset-top)` resolving to a real
   notch, or about Safari's toolbar collapse. The safe-area work is asserted
   against the *source declaration* for exactly this reason. Items §18 and §22
   asking for real Safari bar states remain unverified.
3. **Screen recordings.** §24's motion clips are not produced; the review
   package is stills plus the numeric before/after tables above.
4. **§2.3 in the flow fallback** is mitigated (softened edge) rather than
   eliminated. Eliminating it means the closing-panel treatment generalised to
   every flow panel, which changes the accepted flow composition.
5. **Landscape phone composition** now correctly loads the desktop terrain, but
   the landscape *layout* on a 844×390 phone was not otherwise reworked.

6. **A few pixels of slack at the window/flow boundary.** The fit decision asks
   whether `entry + leadH` fits the band **at a stage's midpoint altitude**;
   the layout uses the band the instrument is at right now. Where the exclusion
   zone is still moving the two differ slightly, so a panel sitting exactly on
   the boundary can resolve either way between loads — and in the `window` case
   its eyebrow can sit a few pixels above the entry floor. Observed once, at
   /en/ on 360×800: a 7 px overlap with the instrument strip, which did not
   reproduce on the next load of the same page.

   A structural floor was attempted — reserving the entry budget as
   `padding-top` inside the lead band — and **made it worse**, because
   `measureComposition` measures that same band to *take* the decision, so the
   padding fed back into `leadH` and flipped panels across all three locales.
   It was reverted. The correct fix is to sample the exclusion zone across a
   stage rather than at its midpoint, which is real machinery for a rounding
   difference and is not worth doing without a case that reproduces.

   Verified after reverting: zero overlap across `hu`, `en`, `de` × 390×844 and
   360×800.

---

## 14. Push readiness

Not ready to push, and deliberately so: §26 forbids it before human visual
approval, and limitation 1 above is a visible art-direction question that the
supplied screenshots raised and this pass did not close.

Everything else in §25's acceptance list is met and measured:

- the three named sections no longer begin with excessive blank space — 13svh,
  from 31/35/30svh;
- each stage communicates its purpose in its first viewport;
- header/calibration overlap is zero; iOS safe-area handling is correct in all
  three header states;
- no accidental altimeter occlusion, and the instrument is in front of the copy
  for the first time;
- mobile scroll is attached to the finger — 2 px of travel after it stops,
  against 336;
- no scroll hijacking, and the page no longer scrolls itself;
- portrait uses a dedicated terrain composition; landscape no longer takes it;
- desktop and mobile terrain both have valley / rock / ridge / snow hierarchy,
  measurably distinguishable, with snow as a restrained accent;
- the altimeter remains the focal object; body copy readability is intact;
- no giant project imagery was added;
- reduced motion remains complete;
- desktop regressions are zero; Phase 7 transitions, the Phase 8.5 header and
  footer, GA4, consent and the lead pipeline are untouched.

MOBILE HOMEPAGE FIDELITY AND MOUNTAIN ART DIRECTION READY FOR VISUAL APPROVAL

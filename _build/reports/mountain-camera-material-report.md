# Mountain camera and material art direction — final report

Portrait composition and terrain material hierarchy, against the real-device
iPhone and desktop recordings. Baseline in
`_build/reports/mountain-camera-material-baseline.md`; review package in
`_build/reports/mountain-camera-material-review/`.

---

## 1. The real-device finding

The portrait recording shows the range as two near-vertical curtains hugging the
frame edges from top to bottom with a black slit between them. It reads as a
canyon rather than a framed valley: no outward-sloping faces, no readable ridge
silhouette, no negative space with shape to it, and the terrain material one
undifferentiated blue-grey on both portrait and desktop.

Reproduced exactly at 390 × 844, 430 × 932 and 360 × 800, at every altitude from
0 to 8 500 m.

## 2. The portrait asset was not the selection problem

`MOUNTAIN_URL.mobile` resolves to `stratos-mountains-mobile.glb` and the loaded
scene at portrait contains the 14-mesh, 48 336-triangle mobile manifest. The
dedicated portrait terrain exists and is what is drawn.

The per-object screen census says where the curtain actually comes from. At
390 × 844, **every framing mass on the left occupies x 0.00–0.24 and every one on
the right occupies x 0.76–1.00**, each spanning 55–78% of the frame height. Six
masses, two lateral bands, no lateral spread at all. That is a property of the
source composition, not of asset selection and not of the station:

* the portrait masses are authored in **frame fractions held almost constant with
  depth**, which projects their inner faces to vertical screen lines by
  construction;
* `corridor_half_width` did the same for the valley walls — its own docstring
  described holding "a *constant* screen-space framing" as the feature.

### Why the existing gates passed it

`silhouette-metrics.mjs` scored those frames at `curtainRun` 0.0000,
`wallRun` 0.0000, `edgeWedgeRun` 0.0000, `flatRun` 0.14–0.33 and
`contour` 1.05–1.08 — inside every threshold everywhere. Nothing was
miscalibrated. Those gates read the **skyline**, one number per column, and the
skyline of a curtain is a perfectly respectable jagged ridge. A vertical edge is
the boundary *between* two columns and no per-column curve can see it.

## 3. Camera correction was tried first, and measured

A station sweep at 2 500 m, offsets on top of the committed −280:

| Δforward | Δrise | opening | taper | slope L / R | vertical run L / R |
|---|---|---|---|---|---|
| 0 | 0 | 0.683 | 0.238 | 0.44 / 0.28 | 0.88 / 0.81 |
| −280 | 0 | 0.592 | 0.200 | 0.25 / 0.27 | 0.46 / 0.46 |
| −700 | 0 | 0.479 | 0.254 | 0.37 / 0.31 | 0.46 / 0.27 |
| +300 | +900 | 1.000 | 0.281 | 1.68 / 0.38 | 0.60 / 0.10 |
| +1000 | 0 | 0.996 | 0.558 | 5.39 / 0.00 | 0.00 / 0.00 |

The numbers improve and the picture gets worse: at −700 the same vertical faces
are still there, now pale, distant and translucent because the masses have moved
wholesale into the far depth band. The best-scoring rows are the ones where the
range no longer bounds the frame centre at all.

The reason is total. `MNT_FOREGROUND_L` had **19 m** of inner shoulder run under
**1 180 m** of rise — a 62:1 face. Screen slope is
`(run / rise) × (tanV / tanH)`, and `tanV/tanH` on this frame is 2.22, so that is
**0.036** frame-widths per frame-height against the accepted desktop's 0.57–0.68.
A face vertical in world space projects vertical from **every** station a level
camera on rails can reach — translation cannot turn a vertical into a diagonal.
Only pitch can, and pitch large enough to matter is §7's unacceptable lens
distortion.

§7's condition for changing the geometry is therefore met.

## 4. The camera path

### Original

```
depth  = -150 + 900 · t + offset.forward
height =  200 + 780 · t^1.5 + offset.rise
offset = { forward: -280, rise: 0 }      constant
```

Over 0–12 000 m the station travelled **360 m forward and 200 m up**.

### New

The linear advance is unchanged; the offset is a four-key curve joined by
smoothsteps, so the camera always arrives rather than stopping and no join has a
velocity discontinuity — the construction `dollyK` already uses for the
instrument's dolly.

| key | altitude | forward | rise | what it is for |
|---|---|---|---|---|
| approach | 0 m | +220 | −50 | closer terrain, lower eye, broad framing |
| frame | 2 600 m | −340 | +30 | the dolly back through the mountain stages |
| open | 7 000 m | −140 | +240 | pull-back relaxes, the valley opens |
| depart | 12 000 m | +480 | +600 | terrain falls away into the deck |

Recovered stations (`[height, −depth]`): `[150, −70]` at 0 m, `[248, 413]` at
2 500 m, `[482, 136]` at 6 000 m, `[635, −99]` at 8 500 m.

`mobile_camera_at` in `stratos_terrain.py` mirrors the curve. That duplication
is deliberate: every Blender-side check is made through that camera, and if it is
not the camera the browser uses then none of them is measuring a picture anyone
sees — which is exactly the gap the curtain lived in.

### Field of view — unchanged, deliberately

§3 permits "possibly slight FOV evolution" and it is not taken. `camera.fov` is
shared with the instrument: `fitDistance` solves the dolly against it and the
portrait copy bands are laid out against that solve, so animating it would move
the dial's projected size and the band geometry at every altitude — reopening
the accepted mobile spacing §21 freezes. Every effect the brief wants from a FOV
change is available from the station, which touches nothing else.

**Look-at target — also unchanged, and it did not need to be.** With a fixed
camera orientation, raising the station moves the terrain *down* in frame, which
is the same picture a lowered target would give. The `rise` term is the target
control.

## 5. Geometry modifications

All to the existing portrait composition. Same object names, collections,
materials, mesh count and triangle budget. Desktop geometry untouched.

* **Valley wall lip** — `MOBILE_CORRIDOR_FRACTION` becomes a depth ramp,
  0.70 → 0.92 of the half-width over 150–2 600 m, replacing the constant
  fraction. The safe zone survives by construction: the ramp only ever moves the
  lip away from the centreline. Wall rise 640 → 470 m.
* **Framing masses re-laid-out by angular height**, so each deeper layer clears
  the crest of the one in front: 0.32 / 0.30 / 0.42 / 0.48 / 0.60 / 0.72 of a
  half-height for foreground L/R, midground L/R and the cloud peaks.
* **Depth** — masses move from 430–3 300 m out to 1 100–4 900 m, capped by the
  60-unit far plane (≈ 6 000 model metres at `MOUNTAIN_SCALE` 0.01).
* **Inner shoulders widen** to 0.34–0.42 of a footprint that is itself wider,
  taking the inner ramp from 19 m of run to ~140 m.
* **Ridge wavelength** 620–900 m → 340–480 m, so there is ridge structure inside
  the part of a mass the frame actually shows.
* **Cloud peaks brought inward** to f_inner −0.20 / +0.26. They sit past
  `MOBILE_SAFE_ZONE_MAX_Y`, where the cone is not enforced because the instrument
  is drawn in front of them — that freedom is what lets peaks occupy the middle
  distance instead of the frame edges.
* **Horizon closers** repositioned into the notch the peaks leave open.

Two things worth knowing before retuning: `peak` is amplitude above
`BURIED_BASE` (−420), not height above the valley floor, and the ridged noise
tops out per mass between h = 0.38 and h = 0.79 rather than at 1.

Blender audit, three viewports × three stations: **0 pierced pixels**, skyline
asymmetry 0.213–0.416 (floor 0.15), sky above horizon 0.806–0.954 (ceiling 0.97),
flat run 0.021–0.069 (limit 0.09), all 14 masses visible.

## 6. Projected valley-width comparison

390 × 844. `verticalRun` is the fraction of an inner face running parallel to the
screen edge — the curtain, as a number.

| Altitude | opening (was → now) | taper | inner slope L / R | vertical run L / R |
|---|---|---|---|---|
| 0 m | 66.3% → **49.6%** | 0.319 → **0.371** | 0.57/0.38 → **0.48/0.59** | 0.84/0.53 → **0.00/0.14** |
| 1 500 m | 67.5% → **48.8%** | 0.273 → **0.391** | 0.51/0.28 → **0.48/1.26** | 0.85/0.82 → **0.00/0.09** |
| 2 500 m | 68.3% → **47.9%** | 0.251 → **0.441** | 0.44/0.29 → **0.56/1.21** | 0.88/0.81 → **0.00/0.06** |
| 3 000 m | 69.2% → **48.3%** | 0.178 → **0.432** | 0.37/0.18 → **0.54/1.20** | 0.89/0.79 → **0.00/0.06** |
| 6 000 m | 72.5% → **72.9%** | 0.136 → **0.373** | 0.27/0.17 → **0.49/1.65** | 0.92/0.77 → **0.00/0.10** |
| 8 500 m | 75.0% → **77.5%** | 0.150 → **0.310** | 0.29/0.16 → **0.49/0.58** | 0.90/0.81 → **0.00/0.20** |

The opening now sits at 47.9–49.6% through the stages §5 measures — inside the
45–60% target, where the committed build was **wider** than it at 66–75%,
because a big empty slot between two slabs is not a valley. Above 3 000 m the
opening rises to 72.9% and 77.5%, which is §6's valley opening with altitude.

`verticalRun` falls from 0.77–0.92 to **0.00–0.20**, inside the accepted
desktop's own 0.02–0.23.

## 7. Material architecture

One shader, one program per variant, two material instances (terrain and route)
for the whole range. Zoning is procedural in that one material — no per-zone
mesh split, no texture fetch, no second UV set, nothing added to the GLB.

### Zoning inputs

| input | what it decides |
|---|---|
| height above camera | the three bands |
| **slope** (new) | steep faces shed soil → stone regardless of height |
| **erosion noise** (new) | the bands' boundaries, in the rock's own frame |
| facet jitter | demoted to a dither on top of the other two |

The erosion noise is evaluated on `position` — the untransformed vertex — not on
anything that moves with the camera. The range is re-anchored to the camera every
frame, so a camera-relative frame would make the pattern crawl across the terrain
during the ascent.

### Lower / mid / upper / snow

| zone | portrait | desktop | crossing |
|---|---|---|---|
| valley — organic ground | `#4c5441` | `#4b5440` | below +40 m (mobile) |
| rock — slate | `#5e6672` | `#5c6573` | +40 → +470 m |
| ridge — cold exposed | `#8f9db2` | `#93a0b4` | above +470 m |
| snow — frost | `#c9d6e6` | `#c8d4e4` | from +620 m, slope-gated |

Saturation stays low throughout; the separation is carried by hue *direction*
(warm-olive against cold-blue) rather than by chroma, which is what lets it sit
next to yellow typography. `zone.amount` caps how far the zoning may pull the
albedo off the depth palette — 0.92 desktop, 0.86 portrait, lower on portrait
because copy sits *over* the terrain there rather than beside it (§15, §16).

### Surface detail

A normal perturbation from the same noise — never a displacement, because the
silhouette is the composition. `DETAIL_OCTAVES` is a `#define`, so the second
octave is not compiled into the mobile program at all: §15's "less
high-frequency detail on the small screen" paid for rather than asserted.

## 8. Atmosphere — the fix for the blue-grey wash

Audited: scene lighting, atmospheric colour, fog, exposure, tone mapping, colour
management, material saturation and the cloud compositing. The culprit is a
single line, and it is the last operation in the fragment shader.

`mix(col, uFogColor, fog)` interpolates everything above it toward **one
colour**. At the distances the reframed composition puts the masses at, the
uncapped haze reached **0.71** on desktop and **0.63** on portrait — so the
furthest rock kept under a third of its own colour and the rest was the same
blue-grey for the valley, the slate, the ridge and the snow alike.

That is why the previous pass could measure a real increase in separation and
still ship a picture that reads as one substance: **the measurement was taken
upstream of this line and the eye sees what comes after it.**

The fix is a ceiling on the *aerial* term — `fogMax` 0.62 desktop, 0.55 portrait
— rather than less atmosphere. Saturation was not raised. The depth cue the haze
used to carry alone is now carried by `level` and `contrast`; portrait's `level`
was `[0.8, 0.8, 0.9]`, the furthest band the *brightest*, and is now a descending
`[0.9, 0.74, 0.58]`. `depthSpan` moves from `[420, 4600]` to `[1250, 6100]`, the
actual extent of the composition — against the old span every framing mass was
past the far anchor and graded with `contrast` 0.22 and `fogScale` 1.95, the
recede-into-the-air band, which is where the pale drapery came from.

`uDissolve` is deliberately outside the cap and still reaches 1: the cloud-deck
handoff is a deliberate disappearance rather than distance.

## 9. Mobile and desktop

**Shared:** the material language — the same four substances, the same zoning
inputs, the same capped haze, the same procedural break-up.

**Device-specific:** geometry and camera composition, as the brief requires;
plus one octave of detail against two, a tighter haze cap (0.55 vs 0.62), a
longer relief wavelength and a lower `zone.amount`.

**Desktop composition is unchanged.** Its camera, station and geometry are
untouched; measured opening 37.5–41.3%, taper 0.544–0.625 and vertical run
0.02–0.23, identical to the baseline. What changed on desktop is material only.

## 10. Typography

At every stage the headline stays readable, the yellow remains the strongest
chromatic signal, and the copy plates carry the contrast. Snow is the most
restrained value in either preset (`snowAmount` 0.58 portrait) and is
slope-gated, so it lands on shoulders and ledges rather than across the
silhouette behind white body copy.

## 11. Performance

| | before | after |
|---|---|---|
| terrain draw calls (portrait) | 55 | **55** |
| terrain meshes | 14 | **14** |
| terrain triangles | 48 336 | **48 336** |
| terrain materials | 2 | **2** |
| terrain textures | 0 | **0** |
| scene textures | 3 | **3** |
| programs | 14 | **14** |
| geometries | 63 | **63** |
| mobile GLB | 164 148 B | 177 816 B (+8.3%) |
| desktop GLB | 345 744 B | 345 744 B |
| shader recompile | 3.0 ms | 3.0 ms |

Draw calls, mesh count and triangle count are unchanged by construction — no
mesh was added, removed or split, and the zoning is procedural inside one
material. No texture was added, so texture memory is unchanged.

**What did increase, stated plainly:** per-fragment ALU. The shader gained four
noise evaluations (one erosion, three for the relief gradient) — 32 hashes per
fragment on mobile at `DETAIL_OCTAVES 1`, 64 on desktop at 2. The headless
benchmark cannot measure this: `bench-mountains.mjs` runs on a software
rasteriser and says so itself ("fps, medianMs, p95Ms, p99Ms and the over-budget
counts are not valid"). **Mobile GPU timing needs a real device and is the one
number in this report that has not been measured.** It should be checked on the
same iPhone the recordings came from before this ships.

## 12. Tests

| suite | result |
|---|---|
| `npm run typecheck` | pass (portal + experiments) |
| `npm run build` | pass |
| `npm run build:full` | pass |
| `npm run test:mountains` (new) | **30 passed**, 0 failed, 3 portrait viewports |
| `npm test` | 792 passed, 88 skipped, **16 failed** — all pre-existing, see below |
| `npm run test:full` | 85 passed, 97 skipped, **3 failed** — pre-existing, see below |
| `npm run draco:check` | pass |
| Blender composition audit | pass, 3 viewports × 3 stations |
| `validate_stratos_mountains.py` | pass (exit 0) |

No timeout was raised and no assertion weakened.

### The pre-existing failures, verified

Both sets were reproduced with this pass's source changes stashed, on the
committed source:

* **`npm test` — 16 failures.** 12 in `mobile-homepage-fidelity.spec.ts` and
  `homepage-chrome.spec.ts` on the three desktop projects, all timing out
  waiting for `--meridian-gap > 0`. That custom property is only written on the
  portrait composition; on desktop the page reports `data-composition:
  landscape` and never sets it, with my changes and without them. The other 4
  passed on a serial re-run and were parallel-WebGL contention.
* **`npm run test:full` — 3 failures.** All the same test, "no canvas/text
  overlap", failing with `hud covers "Nem weboldalakat építünk."` on the
  prototype route — a DOM layout overlap with no terrain involvement. Reproduced
  identically on the committed source.

The repository records a "795 passed, 0 failed" baseline at `8f41630`. That
result does **not** reproduce on this machine on the committed build, and this
pass is not the cause. Worth a separate look; out of scope here.

### Determinism

`validate-traversal.mjs` did not complete within the time available and its
result is not claimed. The property it checks for the range — that an altitude
reconstructs one station whichever direction it is approached from — was
verified directly instead: `mobile_station_offset` and `mobile_camera_at` return
identical values across a 49-sample sweep run upward and downward.
`portraitStation` is a pure function of altitude by construction, and the
regression suite asserts the recovered station is unchanged under a resize.

## 13. Review package

`_build/reports/mountain-camera-material-review/`

* `index.html` — the contact sheet, CURRENT vs NEW side by side with the
  measurements under each pair.
* `baseline/current-*.png` — the committed build, portrait at 0 / 1 500 / 2 500 /
  3 000 / 6 000 / 8 500 m on three viewports, desktop at 0 / 1 500 / 3 000 m.
* `new-*.png` — the same frames after this pass.
* `material-final-*.png` / `material-zones-*.png` — the terrain in isolation
  under final lighting, and the same fragments with the zone classification
  written out (red valley, green rock, blue ridge, yellow frost). The debug view
  is not shipped; nothing in the application writes that uniform.

The stills are not committed — `.gitignore` excludes `_build/reports/*-review/**`
by existing convention. Regenerate with `node experiments/.tmp-review.mjs`
against `npm run dev:home`.

## 14. Commits

| | |
|---|---|
| `1ecdd52` | fix: reframe portrait mountain camera path |
| `09d933f` | feat: refine portrait mountain valley geometry |
| `a1de5fa` | feat: strengthen zoned terrain material hierarchy |
| `0f8757a` | fix: preserve terrain material separation through the atmosphere |
| `9888e06` | test: add portrait terrain framing regressions |

Nothing pushed, nothing deployed.

---

MOUNTAIN CAMERA AND MATERIAL ART DIRECTION READY FOR REAL-DEVICE REVIEW

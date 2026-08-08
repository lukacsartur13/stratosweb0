# Mountain camera and material — baseline

The state of the committed build **before** this pass, recorded so the changes
that follow are measured against something rather than argued about.

Captured from `8f41630` (`phase-9-conversion-seo-production-finalisation`) with
`experiments/.tmp-frame.mjs`, which drives the same two measurement modules the
regression suite uses — `experiments/valley-metrics.mjs` and
`experiments/terrain-mask.mjs`. Stills are in
`_build/reports/mountain-camera-material-review/baseline/`, and the raw numbers
in `baseline/current.json`.

---

## 1. Stills

Portrait, 390 × 844 @3x, at the altitudes §2 names. Also captured at 430 × 932
and 360 × 800; the three agree to within two points on every metric below.

| Altitude | Still |
|---|---|
| 0 m | `baseline/current-p390x844-00000.png` |
| 1 500 m | `baseline/current-p390x844-01500.png` |
| 2 500 m | `baseline/current-p390x844-02500.png` |
| 3 000 m | `baseline/current-p390x844-03000.png` |
| 6 000 m | `baseline/current-p390x844-06000.png` |
| 8 500 m | `baseline/current-p390x844-08500.png` |

Desktop, 1440 × 900, at 0 / 1 500 / 3 000 m:
`baseline/current-desktop-{00000,01500,03000}.png`.

---

## 2. Camera

Shared for both variants, from `JourneyScene.tsx`:

| | |
|---|---|
| Vertical field of view | 32° |
| Near plane | 0.1 |
| Far plane | 60 |
| Position | `(0, cameraHeightAt(t), fit · dollyK(m))` — see `JourneyCamera.tsx` |
| Rotation | yaw = pointer parallax (≤ 2°) + `railCameraYaw(m)`; pitch = parallax only; roll 0 |

Measured at 390 × 844: `position [0, -0.1, 8.7999]`, `rotation [0, 0, 0]`,
`aspect 0.4621`.

The camera **does not fly the journey**. It moves through about three scene
units over 30 000 m while the world descends past it — the depth-precision
decision recorded in `JourneyCamera.tsx`. The range is therefore placed
*relative to the camera* by a similarity transform, and what plays the part of a
camera path for the terrain is `cameraStation()` in `mountains.ts`.

### The terrain's camera path, as committed

```
depth  = -150 + advance · t + offset.forward        (Blender +Y)
height =  200 + rise · t^power + offset.rise        (Blender +Z)
t      = altitude / 30 000
```

| | advance | rise | power | offset.forward | offset.rise |
|---|---|---|---|---|---|
| desktop | 2 050 | 980 | 1.6 | −600 | +150 |
| mobile | 900 | 780 | 1.5 | **−280** | **0** |

`offset` was a **constant** on both variants. Over the band where the range is
visible at all (0–12 000 m) the portrait station therefore travels 360 m forward
and 200 m up — which is why §3's objection ("the mobile camera should not simply
rise vertically through the terrain") is a fair description of it: it barely
moves at all, in any direction.

Recovered stations, portrait (`[x, height, −depth]` in glTF axes):

| Altitude | Station |
|---|---|
| 0 m | `[0, 200.0, 430.0]` |
| 1 500 m | `[0, 208.7, 385.0]` |
| 2 500 m | `[0, 218.8, 355.0]` |
| 3 000 m | `[0, 224.7, 340.0]` |
| 6 000 m | `[0, 269.8, 250.0]` |
| 8 500 m | `[0, 317.6, 175.0]` |

Range root transform: uniform `scale 0.01`, `quaternion [0,0,0,1]` (no rotation
at any altitude), `position = camera − scale · station`.

---

## 3. Terrain bounds

From the loaded GLBs, in model metres.

| | mobile | desktop |
|---|---|---|
| GLB size | 164 148 B | 345 744 B |
| Triangles | 48 336 | 131 884 |
| Meshes | 14 | 16 |
| Bounds min | `[-1500, -420, -9000]` | `[-2400, -420, -4400]` |
| Bounds max | `[1500, 1015, 900]` | `[2400, 1185, 900]` |

Measured world bounds of the range root at 390 × 844, 0 m (scene units):
`min [-15, -6.3, -85.5]`, `max [15.6, 6.778, 13.5]`, with the camera at
`z 8.7999`. The far extent is therefore **94.3 units** from the camera against a
**60-unit far plane** — the tail of the range is already clipped in the
committed build, and is also at fog ≈ 0.88 by then. Recorded because it is a
hard cap on how far back any reframing may push geometry.

---

## 4. Material, lighting, fog, tone mapping

Renderer state at capture: `toneMapping 4` (ACES), `toneMappingExposure 1`,
`outputColorSpace srgb`. The terrain material sets `toneMapped: false` and
`transparent: true` — it opts out of ACES deliberately (see the note in
`mountainMaterial.ts`) and does its own sRGB encode.

Portrait preset as committed (`MOBILE` in `mountainLook.ts`):

| | |
|---|---|
| key | azimuth −34°, elevation 28°, intensity 0.55, colour `#d8e4f4`, wrap 0.30 |
| fill | sky `#53688a`, ground `#131a24`, intensity 0.16 |
| bounce | azimuth 128°, elevation −4°, colour `#3a5878`, intensity 0.095 |
| azimuth tilt | −88°, amount 0.085 |
| depthSpan | **[420, 4600]** |
| base | `#737d8a` / `#7c8593` / `#818b98` |
| level | **[0.8, 0.8, 0.9]** |
| contrast | [0.92, 0.6, 0.22] |
| floor | [0.024, 0.042, 0.082] |
| fogScale | **[0.12, 0.78, 1.95]** |
| crest | from −450, to 470, gain 0.4 |
| valleyDarken | 0.92 |
| fog | colour `#2e3849`, high `#8e9aa8`, density 0.000115, valley density 0.00011, top −250, falloff 280 |
| zone | valley `#4d5542`, rock `#6f7886`, ridge `#9ca7b6`, snow `#c8d4e4` |
| zone bands | valleyTo −230, ridgeFrom 265, blend 160 |
| snow | from 470, fade 200, slope 0.38, amount 0.52 |
| zone amount | 0.7, jitter 115 |

There was **no cap on the aerial fog term**, no procedural noise of any kind, and
no slope input to the zoning. Those three absences are §13, §11 and §10
respectively, and §4 of the final report explains how each one showed up.

---

## 5. The two populations the thresholds are calibrated between

Everything the regression suite gates on is measured here, on the committed
build, for the defect (portrait) and for the picture the brief asks portrait to
become (the accepted desktop composition). Both were scored through the same
`valleyMetrics()`.

### Portrait — the defect

| Altitude | opening | taper | inner slope L / R | vertical run L / R | floor |
|---|---|---|---|---|---|
| 0 m | 0.663 | 0.319 | 0.57 / 0.38 | **0.84 / 0.53** | 0.339 |
| 1 500 m | 0.675 | 0.273 | 0.51 / 0.28 | **0.85 / 0.82** | 0.344 |
| 2 500 m | 0.683 | 0.251 | 0.44 / 0.29 | **0.88 / 0.81** | 0.339 |
| 3 000 m | 0.692 | 0.178 | 0.37 / 0.18 | **0.89 / 0.79** | 0.350 |
| 6 000 m | 0.725 | 0.136 | 0.27 / 0.17 | **0.92 / 0.77** | 0.344 |
| 8 500 m | 0.750 | 0.150 | 0.29 / 0.16 | **0.90 / 0.81** | 0.339 |

### Desktop — accepted

| Altitude | opening | taper | inner slope L / R | vertical run L / R | floor |
|---|---|---|---|---|---|
| 0 m | 0.375 | 0.544 | 0.57 / 0.63 | 0.23 / 0.05 | 0.094 |
| 1 500 m | 0.396 | 0.585 | 0.59 / 0.65 | 0.18 / 0.02 | 0.111 |
| 3 000 m | 0.413 | 0.625 | 0.61 / 0.68 | 0.17 / 0.02 | 0.094 |

`verticalRun` separates the two populations completely: 0.77–0.92 against
0.02–0.23, with no overlap. `taper` separates them almost as cleanly: 0.14–0.32
against 0.54–0.63.

The opening runs the *other* way — portrait's is 0.66–0.75 where desktop's is
0.38–0.41 — and that is not a contradiction. §5 asks for 45–60%; the committed
portrait is **wider than the brief's target**, because its rock is shoved
against the two frame edges as vertical slabs with nothing in between. A big
empty slot is not a valley.

### Why the existing gates did not fire

`silhouette-metrics.mjs` scores the same portrait frames at `curtainRun 0.0000`,
`wallRun 0.0000`, `edgeWedgeRun 0.0000`, `flatRun 0.14–0.33` and
`contour 1.05–1.08` — inside every threshold, at every altitude and every
viewport. Nothing was miscalibrated. Those gates read the **skyline**, one number
per column, and the skyline of a curtain is a perfectly respectable jagged ridge.
A vertical edge is the boundary *between* two columns and no per-column curve can
see it. That is why §18 needed a new measurement rather than a tighter one.

---

## 6. Per-object screen census — where the curtain comes from

Fraction of the 390 × 844 frame each object wins, and the box it occupies.
Row 0 is the top of the frame.

**0 m**

| object | frame % | x span | y span |
|---|---|---|---|
| VALLEY_FLOOR | 39.24 | 0.00–1.00 | 0.60–1.00 |
| CLOUD_PASS | 15.94 | 0.00–1.00 | 0.64–0.86 |
| CLOUD_PEAK_L | 13.63 | **0.00–0.23** | **0.15–0.90** |
| MNT_FOREGROUND_L | 12.03 | **0.00–0.21** | 0.32–1.00 |
| MNT_BACKGROUND_C | 11.38 | 0.00–1.00 | 0.51–0.69 |
| CLOUD_PEAK_R | 10.61 | **0.78–1.00** | **0.15–0.94** |
| MNT_MID_L_01 | 10.20 | **0.00–0.20** | 0.30–1.00 |
| MNT_MID_R_01 | 9.76 | **0.80–1.00** | 0.25–1.00 |
| VALLEY_WALL_R | 9.76 | 0.76–1.00 | 0.44–1.00 |
| VALLEY_WALL_L | 9.36 | 0.00–0.24 | 0.45–1.00 |
| MNT_FOREGROUND_R | 8.31 | 0.81–1.00 | 0.48–1.00 |
| MNT_BACKGROUND_L | 5.75 | 0.00–0.43 | 0.60–0.76 |
| MNT_BACKGROUND_R | 4.80 | 0.58–1.00 | 0.60–0.75 |
| ASCENT_ROUTE | 0.43 | 0.43–0.68 | 0.87–1.00 |

**Every framing mass on the left occupies x 0.00–0.24. Every one on the right
occupies x 0.76–1.00.** Six masses, two lateral bands, no lateral spread at all,
each spanning 55–78% of the frame height. At 2 500 m the census is the same to
within two points.

That is the curtain, and it is a property of the source composition rather than
of the station: the portrait masses are authored in *frame fractions* held
almost constant with depth, which projects their inner faces to vertical screen
lines by construction, and `corridor_half_width` does the same for the valley
walls — its own docstring described holding "a *constant* screen-space framing"
as the feature.

---

## 7. Was the wrong asset being loaded?

No. `MOUNTAIN_URL.mobile` resolves to `stratos-mountains-mobile.glb`, and the
loaded scene at 390 × 844 contains the 14-mesh, 48 336-triangle mobile manifest
(`MNT_MID_L_02` / `MNT_MID_R_02` absent, which is the documented mobile layout).
The dedicated portrait terrain exists and is what is drawn. §1 of the brief is
confirmed: this is not an asset-selection defect.

---

## 8. Was camera correction alone enough?

Measured, not assumed. A station sweep at 2 500 m on 390 × 844, with the offset
applied on top of the committed `−280`:

| Δforward | Δrise | opening | taper | slope L / R | vertical run L / R |
|---|---|---|---|---|---|
| 0 | 0 | 0.683 | 0.238 | 0.44 / 0.28 | 0.88 / 0.81 |
| −180 | 0 | 0.629 | 0.217 | 0.46 / 0.18 | 0.44 / 0.56 |
| −280 | 0 | 0.592 | 0.200 | 0.25 / 0.27 | 0.46 / 0.46 |
| −400 | 0 | 0.558 | 0.213 | 0.27 / 0.28 | 0.46 / 0.32 |
| −550 | 0 | 0.517 | 0.232 | 0.30 / 0.30 | 0.45 / 0.29 |
| −700 | 0 | 0.479 | 0.254 | 0.37 / 0.31 | 0.46 / 0.27 |
| +300 | +900 | 1.000 | 0.281 | 1.68 / 0.38 | 0.60 / 0.10 |
| +1000 | 0 | 0.996 | 0.558 | 5.39 / 0.00 | 0.00 / 0.00 |

The numbers improve with pull-back and the picture does not:
`baseline/../sweep` at Δforward −700 shows the same vertical faces, now pale,
distant and translucent, because the masses have moved wholesale into the far
depth band. The rows that score best (`opening 1.000`) are the ones where the
range no longer bounds the frame centre at all.

The reason is geometric and total. A mass whose inner face is vertical **in
world space** projects to a vertical screen line from every station a level
camera on rails can reach — translation cannot turn a vertical into a diagonal;
only pitch can, and pitch large enough to matter is §7's "unacceptable lens
distortion". The committed portrait `MNT_FOREGROUND_L` had **19 m** of inner
shoulder run under **1 180 m** of rise: a 62:1 face. Screen slope is
`(run / rise) × (tanV / tanH)`, and `tanV/tanH` on this frame is 2.22, so
19/1180 gives **0.036** frame-widths per frame-height against desktop's 0.57–0.68.

§7's condition is therefore met, and the geometry pass is justified rather than
opportunistic.

---

## 9. Frozen for this pass

Confirmed untouched at capture and to be left untouched: mobile stage entry for
all three named stages, native mobile scrolling, header/calibration separation,
safe-area handling, altimeter/content-panel layering, the Work composition,
Phase 8.5 header and footer, Phase 7 transitions, GA4 and consent, and the lead
pipeline. The desktop camera composition is also accepted and is not altered by
this pass.

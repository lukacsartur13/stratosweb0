# Stratos mountain environment — Blender pipeline

The mountain valley the homepage ascent starts in. Authored in Blender, exported
as two GLB variants, validated against a manifest.

Blender is the authority on **form**: silhouettes, valley composition, the pass,
foreground/background separation, negative space around the Meridian, the route,
and the desktop/mobile geometry split. The web renderer is the authority on
**light**: atmosphere, fog, altitude tinting, clouds, capability tiers.

## Environment used

| | |
|---|---|
| Blender | 5.2.0 LTS (build date 2026-07-14) |
| Bundled Python | 3.13.13 |
| Headless | works — every step below runs `--background` |
| glTF/GLB export | available (`io_scene_gltf2`) |
| Draco encoder | **available**, `libbf_intern_draco_bridge.dylib` |

Blender is not on `PATH` on this machine. The binary is at
`/Applications/Blender.app/Contents/MacOS/Blender`.

## Run the whole pipeline

```bash
BLENDER=/Applications/Blender.app/Contents/MacOS/Blender
for v in desktop mobile; do
  "$BLENDER" --background --factory-startup --python blender/mountains/generate_stratos_mountains.py -- --variant "$v"
  "$BLENDER" --background --factory-startup --python blender/mountains/export_stratos_mountains.py   -- --variant "$v" --draco
done
python3 blender/mountains/validate_stratos_mountains.py
"$BLENDER" --background --factory-startup --python blender/mountains/render_previews_stratos_mountains.py
```

`--factory-startup` is not optional. It drops user add-ons and preferences so the
output does not depend on whose machine ran it.

## Files

| Path | Role |
|---|---|
| `stratos_terrain.py` | Shared library: seeded noise, the safe-zone model, the object manifest, every mass definition. No `bpy` at import time. |
| `generate_stratos_mountains.py` | Builds the scene and saves the `.blend`. Audits itself and exits non-zero on a composition failure. |
| `export_stratos_mountains.py` | Opens the `.blend`, selects the manifest, writes the GLB. |
| `validate_stratos_mountains.py` | Plain CPython. Parses the shipped GLB and checks it against the manifest and the budgets. |
| `render_previews_stratos_mountains.py` | Deterministic QC renders, including the flat silhouette diagnostic. |
| `source/*.blend` | Source assets. Not published — `scripts/assemble.mjs` already skips `assets/blender`, and this folder is outside `dist/` entirely. |
| `previews/*.png` | Internal QC only. Nothing on the site loads these. |
| `reports/` | `stratos-mountains-report.json` (machine-readable) and `REGRESSION_BASELINE.md`. |

## Determinism

`SEED = 20260802` in `stratos_terrain.py` drives everything. The noise is a
hand-rolled seeded integer-hash value noise rather than Blender's own texture
nodes, because Blender's noise is not a stable contract across versions and every
downstream number — triangle counts, the safe-zone report, the previews — is only
meaningful if the mesh is identical on every run. Same seed, same floats, any
machine, any Blender build.

Manual sculpting on top of the generated base is allowed. The deterministic base
generation must stay in the script.

## Output

| | Desktop | Mobile |
|---|---|---|
| File | `public/models/stratos-mountains-desktop.glb` | `public/models/stratos-mountains-mobile.glb` |
| Bytes | 345 744 | 164 148 |
| Triangles | 131 884 (budget 80 k–180 k) | 48 336 (budget 25 k–65 k) |
| Meshes | 16 | 14 |
| Materials | 4 | 4 |
| Bounds (Y-up, m) | 6900 × 1605 × 5300 | 3060 × 1308 × 9900 |
| Compression | Draco | Draco |

For scale, `stratos-altimeter.glb` is 396 912 bytes — both mountain variants ship
for less than the instrument already costs.

The bounds are the quickest proof that these are two compositions rather than one
at two densities: mobile is 44% of desktop's width and 187% of its depth. A
portrait frame has no lateral room and abundant vertical room, so the mobile
layout trades width for depth everywhere it can.

Mobile is not a uniform decimation. `MNT_MID_L_02` and `MNT_MID_R_02` are dropped
entirely, because with every mass confined to the same narrow lateral band a
second midground layer sits directly behind the first and is fully occluded. The
names stay in the manifest so the web scene needs no per-device branch; they
simply resolve to nothing.

### Draco — what the web side must carry

The GLBs declare `KHR_draco_mesh_compression` in `extensionsRequired`, so
**they will not load without a `DRACOLoader`**.

| | Desktop | Mobile |
|---|---|---|
| Uncompressed | 2 877 276 | 1 138 064 |
| Uncompressed, gzipped | 1 389 117 | 578 476 |
| Draco | **345 744** | **164 148** |

Draco is 4.0× better than HTTP compression alone on desktop and 3.5× on mobile.
These are measured file sizes, not estimates — decode time in a browser has not
been measured and is not claimed.

Two consequences that are not yet done, and must be handled when the range is
wired into the renderer:

1. The decoder must be **self-hosted**. `netlify.toml` sets `script-src 'self'`,
   so a CDN decoder is blocked. Copy `three/examples/jsm/libs/draco/` into
   `public/draco/` and point `DRACOLoader.setDecoderPath` at it.
2. The WASM decoder needs **`'wasm-unsafe-eval'`** added to `script-src` in
   `netlify.toml`. That directive permits WebAssembly compilation only — it does
   not re-enable `eval()` for JavaScript. The alternative is
   `setDecoderConfig({ type: 'js' })`, which needs no CSP change and decodes
   roughly 2–3× slower.

To export uncompressed instead, drop `--draco`.

## Scene structure

Collections under `STRATOS_MOUNTAIN_ENVIRONMENT`:

```
VALLEY        VALLEY_FLOOR, VALLEY_WALL_L, VALLEY_WALL_R
FOREGROUND    MNT_FOREGROUND_L, MNT_FOREGROUND_R
MIDGROUND     MNT_MID_L_01, MNT_MID_R_01, MNT_MID_L_02, MNT_MID_R_02
BACKGROUND    MNT_BACKGROUND_L, MNT_BACKGROUND_C, MNT_BACKGROUND_R
ROUTE         ASCENT_ROUTE
CLOUD_BREAK   CLOUD_PEAK_L, CLOUD_PEAK_R, CLOUD_PASS
GUIDES        MERIDIAN_SAFE_ZONE, CAMERA_PATH_GUIDE, CLOUD_LAYER_GUIDE
              MERIDIAN_SAFE_ZONE_MOBILE, CAMERA_MOBILE_GUIDE,
              CLOUD_LAYER_GUIDE_MOBILE                            (never exported)
```

Guides are excluded by selecting the manifest explicitly rather than by hiding
them, so the export depends on `PRODUCTION_OBJECTS` and not on viewport state
saved in the `.blend`. The validator asserts none of the six reached the GLB.
Each variant builds only its own three, in its own dimensions — desktop numbers
in the mobile file would be worse than no guide.

Materials: `MAT_ROCK_GRAPHITE`, `MAT_ROCK_TITANIUM`, `MAT_VALLEY_DARK`,
`MAT_ROUTE_ACCENT`. Principled BSDF with constant inputs, no textures, no
Blender-only nodes. Vertex colours ship as `COLOR_0` but are **not** wired into
the materials — Three.js only applies them when a material opts in, so the tint
is available to the web renderer rather than imposed on it.

## Coordinates

Blender Z-up, exported Y-up:

```
+X right   +Y down the valley (away)   +Z up
camera at (0, -150, 200) looking down +Y
```

After export that is the Three.js convention with no rotation fix-up. One unit is
one metre. Desktop spans ~5.3 km of depth and rises to ~1.6 km; mobile spans
~9.9 km of depth, is 44% as wide, and rises to ~1.3 km.

## The Meridian safe zone

The Meridian is screen-anchored and centred, so the volume it must not compete
with is a **cone**, not a box — a disc of fixed angular size sweeps out a cone as
it recedes.

`SAFE_ZONE_SLOPE = 0.13` is a 7.4° half-angle, which reserves ~45% of frame
height for the instrument. It is sized from the Meridian's screen footprint,
which is the only thing that makes it meaningful; a cone chosen by feel at 0.34
declared three quarters of the frame off-limits and pushed the entire range
outside the lens.

The cone is truncated at `SAFE_ZONE_MAX_Y = 1200 m`. This is a design decision,
not an oversight: an untruncated cone requires the central solid angle to be
empty at every depth, so the background could never close behind the instrument.
Inside 1200 m — where a ridgeline would actually tangle with the dial — nothing
but sky is permitted.

`VALLEY_FLOOR` and `ASCENT_ROUTE` are exempt. They are the ground, they sit below
the cone axis through the near field, and a ground plane receding to the horizon
is not a silhouette conflict. Every mountain mass is enforced, and
`generate_stratos_mountains.py` exits non-zero if one breaches.

`MNT_BACKGROUND_C` and `CLOUD_PASS` are the two masses on the centreline. Both
are capped below `EYE_Z` so they read as distant ridges closing the valley floor,
below the horizon, rather than as masses crossing the instrument.

## The mobile composition

Mobile is a separate layout, not the desktop one at a lower density. The reason
is one number: the web camera's dolly fits a fixed frame *width*, so the Meridian
occupies **0.530 of the frame half-width on every viewport**, phone or desktop —
it is not smaller on a phone. Portrait aspect meanwhile multiplies the horizontal
field of view down to a tan of 0.129 at 360×800, against 0.459 at 1440×900. The
same instrument sits in a frame showing three and a half times less world.

So the protected disc is 60.5% of the screen width on a phone, and the only place
a framing mass can live is the outer ~28% of each side.

### What was actually wrong

The first mobile pass cleared every world-space check and still rendered as two
full-height slabs at the frame edges. `Mass.height` normalises across the
footprint, so a mass authored from 0.70 to 3.30 half-widths puts its crest a full
frame width outside the picture; what reached the screen was the inner 12% of the
mass — its vertical inner face, clipped top and bottom. Four masses
(`MNT_FOREGROUND_R`, `MNT_BACKGROUND_L`, `MNT_BACKGROUND_R`, and `MNT_MID_L_01`
at all but one station) contributed **zero pixels at zero stations**. The valley
walls were worse: their height ramp ran to an absolute 760 m, which is 5.1
half-widths at 1 km of depth, so a phone only ever saw the first 6% of the ramp.

None of that is visible in a triangle count, a bounding box or a safe-zone test.

### What it is now

Footprints are 0.8–1.0 half-widths wide, placed to put the crest between 0.72 and
0.98 where the frame can hold it. The walls are anchored to the frame
(`MOBILE_WALL_OUTER_FRACTION`) and their rise is ramped with depth, so the valley
mouth is open and the wall grows as the valley cuts into the range — otherwise a
constant-height wall on a constant screen fraction fills the outer band from top
to bottom at every station, which is the tunnel the brief rules out.

The two sides are built from different logic rather than mirrored numbers. On the
left the foreground is the innermost mass and the midground steps out behind it;
on the right that order is reversed. Depth onset, crest height and width all
differ, so no horizontal flip maps one side onto the other.

`MNT_BACKGROUND_L` and `MNT_BACKGROUND_R` were **repositioned, not resized**. As
flanking masses they were unbuildable on a phone — a fourth depth layer in a band
already holding three is occluded by all of them, and making them tall enough to
clear would have put the most distant masses highest in frame. They are now the
two ridges that close the valley floor either side of `CLOUD_PASS`.

The mobile camera rises 980 m rather than the 1250 m of the first pass. At 1250 m
it finished above everything in the scene and the cloud-approach station rendered
at 97.4% sky — the range had left the frame at the beat it exists to carry.

### How it is checked

`analyse_frame` rasterises the evaluated scene at all three target aspect ratios
and every camera station, in pure Python, and turns each of the brief's
silhouette requirements into a number. Two of its checks are new and both exist
because the first pass passed everything else while being wrong:

* **`min_visible_px_per_mass`** — every mass must be in shot somewhere. This is
  what caught the four masses that never appeared, and it is also what caught
  `ASCENT_ROUTE` being buried (see below).
* **`max_sky_above_horizon`** — the range must not have left the frame.

`skyline_asymmetry` replaces the old `silhouette_asymmetry` as the thresholded
number. The old one averaged the mirrored difference over the whole half-width,
so it fell both when the sides were *alike* and when there was simply less
skyline to differ — at the approach station a frame with a mountain on one side
and open sky on the other scored near zero. The new one averages only over column
pairs where at least one side has skyline. Both are reported.

## A shared defect the mobile pass found

`ASCENT_ROUTE` was **underneath the valley floor for the last third of its
length**, by up to 10.5 m, in the accepted desktop GLB as well as in mobile.

It re-derived the floor's height independently, and the two derivations had
drifted: a different channel depth (−34 against −38), a different drift field
(three octaves at 640 m and 16 m amplitude, against two at 900 m and 9 m), and a
`fall` term taking 46 m off the far end that the floor had already had removed —
the floor's own comment records dropping it. Nominally 0.7 m proud, actually
buried from about 1 km outward.

Both now call `st.valley_floor_z`, and `ROUTE_PROUD` is 3 m rather than 0.7 m
because the floor's rendered surface is the linear interpolation between grid
rows — 190 m apart on mobile — which can sit ~2 m above the true surface.

This is the one change to the accepted desktop GLB, and it is the case the brief
allows: a shared source defect revealed by the mobile work. Desktop triangle
count, mesh count, material count and node names are unchanged; the file is 104
bytes smaller.

## Composition notes worth keeping

Four things were wrong in the first pass and are worth not reintroducing:

* **Bases at floor level** produced a flat apron around every mass that rendered
  as hard horizontal steps across the silhouette. Bases are now buried at
  `BURIED_BASE = -420` and the floor draws over them.
* **A floor that stopped at 1500 m** left a hole in the middle of the frame. It
  now runs the full depth, with no distance falloff — an earlier falloff pulled
  it below the sightline and reopened the hole it was there to close.
* **Symmetric footprint shoulders** made every mass a tent and wasted the frame
  on long shallow ramps. The valley-facing shoulder is now ~0.7× the outer one.
* **Un-warped footprints** meant a mass's edge was its rectangle's edge, which
  rendered as a ruled cliff. Two octaves of low-frequency domain warp on `u`
  and `v` fix it for one noise lookup.

## Not verified

* The previews are Blender EEVEE renders with neutral QC lighting. They are
  **not** what the web renderer will produce — no fog, no atmosphere, no
  altitude tinting, no clouds, no Meridian in frame.
* The safe zone is validated against the *Blender* camera model at the canonical
  states. It has not been checked against the live web composition, because the
  range is not integrated into the web scene yet.
* No GLB load time, parse time, draw-call count or frame-time impact has been
  measured. The range has not been loaded in a browser. Neither has Draco
  decode cost, and no claim is made about CSP compatibility — `'wasm-unsafe-eval'`
  is documented as a *likely* requirement above and has not been tested against
  the deployed policy.
* The mobile composition is validated against the *Blender* camera model and
  against a pure-Python rasteriser using the same evaluated triangles. Neither
  is the web renderer. The Meridian is not in any preview, so "clears the safe
  zone" means it clears the modelled cone, not that it looks right behind the
  real instrument.
* The mobile previews are rendered at 430×932, 390×844 and 360×800 CSS pixels
  with no device-pixel-ratio scaling. Aliasing on a real 3× phone display has
  not been checked.
* The safe-zone overlay is drawn only in the valley preview. At the other two
  stations the camera is inside the cone, where a translucent solid renders as
  a full-frame wash; the clearance there is a number in the composition report,
  not something visible in a picture.

## Documented properties, not defects

The mobile flanks are steep — close to vertical in the outer band — and that is
forced by the brief's own constraints rather than by the layout. A framing mass
must sit outside 0.605 of the half-width, so it has 0.4 of a half-width to
descend from its crest to the horizon. On a 360 px frame that is 72 px of
horizontal run against roughly 400 px of vertical fall: a 79° flank. The desktop
frame gives the same descent 518 px of run for 450 px of fall, which is 41°.

The ratio is scale-invariant — a mass's on-screen aspect is 1.11 × its world
width/height ratio regardless of how far away it is — so this cannot be fixed by
moving masses back or scaling the scene. What *was* fixed is that the flanks now
resolve into summits with sky above them (`frame_top_touch_fraction` is 0.000 at
every station and viewport) instead of running off the top of the frame as
untextured panels.

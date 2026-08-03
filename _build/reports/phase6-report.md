# Phase 6 report — premium typography and kinetic type

Status: **not yet accepted.** Two blocking defects were found and fixed; a third
class of defect (typography colliding with the now-centred instrument) is
measured, reduced, and still open on dense panels. Details in §9.

---

## 1. Fonts found

Full-repository search (`*.woff2 *.woff *.otf *.ttf`, excluding `node_modules`)
returned six files, all under `assets/fonts/`:

| Family | Files | Bytes | Licence |
|---|---|---|---|
| Archivo | 4 (normal/italic × latin/latin-ext) | 371,092 | SIL OFL 1.1 |
| JetBrains Mono | 2 (normal × latin/latin-ext) | 55,684 | SIL OFL 1.1 |
| **Total** | **6** | **426,776 (416.8 kB)** | |

The only other font binary in the tree is `kenpixel.ttf`, shipped inside
`three`'s examples and unused by this site.

## 2. Licence status

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

## 3. Variable axes — read from the binaries

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

## 4. Fallback behaviour

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

## 5. Typography tokens

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

## 6. Kinetic moments

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

## 7. Transfer size

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

## 8. Defects found and fixed

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

## 9. Open

### 9.0 The 34/3 figures were measured at 12 altitudes, and are not the floor

The "34 collisions + 3 ring clips = 37" headline came from a 12-altitude,
hu-only, 9-viewport run — 108 samples. Re-run at 17 altitudes (`SAMPLES=12`
unions the 7 named stops, giving 153 samples) the same tree measures **56**.
Nothing regressed between the two; the denser grid simply finds more, which is
the whole reason §9 of the brief asks for 101 samples. Every count below is at
17 altitudes so it can be compared with the one before it.

### 9.1 Fixed since, with before/after

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

### 9.2 Still open: portrait text collisions (30 samples)

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

### 9.3 What closing 9.2 requires — a decision, not a patch

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

### 9.4 Not yet measured

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

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

Measured by `node experiments/validate-meridian.mjs` (hu, 12 altitudes,
9 viewports). Down from 108 problem samples to **37**.

| Class | Count | Where |
|---|---|---|
| Text collision with instrument safe zone | 34 | dense/wide panels at 6k, 7k, 9k, 12k, 15k, 21k m |
| Ring clipped | 3 | 844×390 mobile landscape at 7k, 27k, 30k m |

1440×900 and 1366×768 are **clean**. The remaining collisions are concentrated
in `.panel--wide` and `.panel--centre` panels — case studies, the system grid,
the process list — whose content is wider and taller than the simple panels and
which the band-split composition does not yet fully handle.

Not yet measured, and required before Phase 6 can be signed off:

* CLS before/after font integration;
* font load timing and fallback duration;
* the 101-sample sweep across all three locales (runs so far are 12-sample, hu);
* 200% browser zoom and increased text size;
* slow font load and font-load failure;
* the 16 evaluation stills need **re-acceptance** — the composition changed, and
  the previous stills were captured with the wrong typeface.

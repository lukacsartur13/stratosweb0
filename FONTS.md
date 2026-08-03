# Typography — licence audit, asset inventory and delivery

Phase 6 deliverable. This is the document `assets/css/type.css` and
`experiments/src/full/kineticType.ts` both point at.

Everything below was read out of the actual binaries by
`node scripts/font-metadata.mjs`, which parses `name`, `fvar`, `OS/2`, `head`
and `cmap` directly. Nothing here is inferred from a family name or from a
foundry's marketing page, because §6.3 specifically forbids that and because the
kinetic typography in §6.7–6.8 is built out of variation axes that a font either
has or does not have.

Regenerate at any time:

```bash
node scripts/font-metadata.mjs
```

---

## 1. The brief asked for fonts this repository does not have

The brief names three families:

| Requested | Role | Present in repo? | Licence held? |
|---|---|---|---|
| ABC Arizona Variable | display / signature | **no** | **no** |
| ABC Diatype | body / interface | **no** | **no** |
| ABC Diatype Mono (or Semi-Mono) | technical / numeric | **no** | **no** |

The audit that establishes this:

```bash
find . -path ./node_modules -prune -o \
  \( -name '*.woff2' -o -name '*.woff' -o -name '*.otf' -o -name '*.ttf' \) -print
```

The only font binaries in the working tree are the six under `assets/fonts/`
listed in §3, plus `kenpixel.ttf`, which ships inside `three`'s examples and is
not used by this site.

All three requested families are commercial retail releases from **ABC Dinamo**
(dinamodarkroom.com). They are not obtainable without a purchased licence, and
§6.3 is explicit: do not download commercial fonts without a licence, do not
scrape them, do not commit unlicensed files. **None was acquired.** No attempt
was made to source them from a third-party mirror.

**Consequence for acceptance:** the typography currently shipping is *not* the
typography the brief specified. It is a licensed, self-hosted operating tier
chosen to make every other Phase 6 requirement satisfiable today, and to be
replaceable in one file when the Dinamo licence exists. Phase 6 is therefore
reported as passing **with this documented limitation**, not as delivering the
named families.

> **Decision, 2026-08-03 — Archivo + JetBrains Mono accepted as the final
> typography.** The Dinamo families will not be purchased. §1's purchase spec
> and §2's drop-in procedure are retained as a reversal path, not as outstanding
> work. The two moments that depend on axes Archivo does not have — the
> serif↔sans personality morph and the continuous slant — are **cancelled, not
> deferred**; see §7. Nothing in the system is waiting on a font delivery.

### What to buy, exactly

To fulfil the brief as literally written, the licence must cover **webfont
(@font-face) embedding** at the site's pageview tier, for:

- **ABC Arizona Variable** — the variable build, not the static cuts. Arizona
  ships in several "personalities" (Flare, Mix, Plus, Serif, Sans, Text,
  Practice). §6.8 contemplates a serif↔sans morph at the aperture breakthrough;
  that is only possible if the purchased build exposes those personalities as an
  **interpolable axis within one file**. Buying two separate personality files
  does *not* enable a morph — it enables a crossfade. Confirm the axis before
  relying on that moment.
- **ABC Diatype** — variable if available, otherwise at minimum Regular (400),
  Medium (500) and Semibold (600), plus matching italics if italic body copy is
  wanted.
- **ABC Diatype Mono** *or* **Semi-Mono** — pick one; the tokens treat them
  as the same role. Regular and Medium at minimum.

Glyph coverage must include Hungarian **ő U+0151 / ű U+0171** and German
**ä ö ü ß**. Hungarian's double-acute accents are the coverage risk — many Latin
subsets stop before them.

### The drop-in procedure once licensed

The system was built so this is a contained change:

1. Put the WOFF2 files in `assets/fonts/arizona/`, `assets/fonts/diatype/`,
   `assets/fonts/diatype-mono/`.
2. Run `node scripts/font-metadata.mjs` and **read the axis report**. Do not
   copy the ranges below on faith.
3. Add `@font-face` blocks in `assets/css/type.css`, matching the real
   `font-weight` / `font-stretch` / `font-style` ranges from step 2.
4. Repoint three tokens — `--font-display`, `--font-body`, `--font-mono` — in
   the `:root` block of `assets/css/type.css`. Nothing else in the codebase
   names a family.
5. Update `AXIS_LIMITS` in `experiments/src/full/kineticType.ts` to the new
   design space, and re-check the four moments in `MOMENTS` still sit inside it.
6. Recompute the two metric-matched fallback faces (§4) from the new binaries'
   `xHeight`, `ascent`, `descent` and `unitsPerEm`.
7. Update the preload list in `build_font_preload()` in `_build/build.py` and
   the `<link rel="preload">` tags in `experiments/home/{hu,en,de}.html`.
8. `npm run build && npm test && npm run validate:full`.

---

## 2. What ships instead, and why it is not a system-font stack

**Archivo** (display + body) and **JetBrains Mono** (technical + numeric), both
under the **SIL Open Font License 1.1**, self-hosted.

§6.3 suggests a temporary fallback of system faces — Iowan/Baskerville/Times,
Helvetica/Inter/Arial, SF Mono/Roboto Mono. That was deliberately **not** used
as the operating tier, for one load-bearing reason: **a system font stack
exposes no variation axes at all.** The kinetic typography required by §6.7 and
§6.8 — weight lock, width compression, width expansion, calibrated tracking — is
built entirely out of `wght` and `wdth`. On a system stack those moments cannot
exist, and Phase 6 could not be validated even in principle.

Archivo also has continuity on its side: the site was *already* setting Archivo
and JetBrains Mono, loaded from the Google Fonts CDN. The families are not new
here. What changed is that they are now self-hosted, subsetted, metric-matched
and token-driven — see §5 and §6.

The suggested system stacks are still present in `type.css` as
`--font-display-fallback`, `--font-body-fallback` and `--font-mono-fallback`,
which is what everything degrades to if no webfont loads at all.

**This is an operating tier, not the final typography.** It is not being claimed
as the brief's intended design.

---

## 3. Asset inventory — read from the binaries

### Archivo — `assets/fonts/archivo/`

Licence: SIL OFL 1.1 (`assets/fonts/archivo/OFL.txt`). Version 2.001.

| File | Subset | Style | Bytes |
|---|---|---|---|
| `archivo-normal-latin.woff2` | latin | normal | 90,096 |
| `archivo-normal-latin-ext.woff2` | latin-ext | normal | 85,856 |
| `archivo-italic-latin.woff2` | latin | italic | 101,888 |
| `archivo-italic-latin-ext.woff2` | latin-ext | italic | 93,252 |
| | | **total** | **371,092** (362.4 kB) |

Axes, from `fvar`:

```
wght   100 .. 900   default 600
wdth    62 .. 125   default 100
```

Two findings that constrain the implementation:

- **Italic is a separate file, not an axis.** There is no `ital` and no `slnt`
  in `fvar`. A roman→italic move can therefore only ever be a discrete swap,
  never an interpolation. This suits the brief's "discrete snap without
  overshoot" and its ban on liquid morphs — but §6.8's "controlled forward
  slant as altitude rises" is **not continuously available**, and no slant is
  faked with a `transform: skew()`. That moment was not implemented.
- The `name` table reports the family as `Archivo SemiBold` with default weight
  600. That is the variable font's *default instance*, not a restriction; the
  full 100–900 range is present. Every `@font-face` declares `font-weight:
  100 900` so the browser uses the axis rather than the default.

Glyph coverage, latin + latin-ext combined: **478 codepoints.**
Hungarian complete · German complete · English complete.

### JetBrains Mono — `assets/fonts/jetbrains-mono/`

Licence: SIL OFL 1.1 (`assets/fonts/jetbrains-mono/OFL.txt`). Version 2.211.

| File | Subset | Style | Bytes |
|---|---|---|---|
| `jetbrains-mono-normal-latin.woff2` | latin | normal | 40,480 |
| `jetbrains-mono-normal-latin-ext.woff2` | latin-ext | normal | 15,204 |
| | | **total** | **55,684** (54.4 kB) |

Axes, from `fvar`:

```
wght   100 .. 800   default 400
```

- **No width axis.** No mono token in `type.css` asks for `font-stretch`, and
  `AXIS_LIMITS.monoWeight` in `kineticType.ts` carries no width range.
- **No italic file.** Not needed by any mono role.
- Being monospaced, advance width is identical at every weight. This is what
  makes the altitude readout's final weight lock (§6.8, 29,400→30,000 m)
  incapable of reflowing the digits.

Glyph coverage, latin + latin-ext combined: **405 codepoints.**
Hungarian complete · German complete · English complete.

**Total font payload in the repository: 426,776 bytes (416.8 kB).**

`assets/fonts/MANIFEST.json` records per-file bytes, SHA-256, subset, declared
axis ranges and upstream source URL. `scripts/sync-fonts.mjs` regenerates the
files from those sources.

---

## 4. Metric-matched fallbacks — the anti-CLS mechanism

`font-display: swap` paints in a fallback immediately and swaps when the webfont
arrives. Left alone that is a guaranteed reflow, which §6.10 forbids and the CLS
measurement would catch.

`type.css` declares two shim faces, `Archivo Fallback` and
`JetBrains Mono Fallback`, which are real local fonts re-scaled so their line box
matches the webfont they stand in for. They use `local()` sources **only**, so
they never cost a network request; if none of the named local faces exists the
rule contributes nothing and the next family in the stack takes over.

Derivation, from metrics read out of the binaries (both webfonts `unitsPerEm`
1000; Arial `unitsPerEm` 2048):

```
Archivo         ascent  878  descent 210  lineGap 0  xHeight  526
JetBrains Mono  ascent 1020  descent 300  lineGap 0  xHeight  550
Arial           ascent 1854  descent 434  lineGap 67 xHeight 1062
```

`size-adjust` is the x-height ratio, so fallback and webfont have the same
apparent size; the ascent/descent overrides are then divided by that same ratio
so the line box matches too:

```
Archivo:         526/1000 ÷ 1062/2048 = 1.0143  ->  size-adjust 101.4%
                 ascent  0.878 / 1.0143 = 86.6%
                 descent 0.210 / 1.0143 = 20.7%

JetBrains Mono:  550/1000 ÷ 1062/2048 = 1.0606  ->  size-adjust 106.1%
                 ascent  1.020 / 1.0606 = 96.2%
                 descent 0.300 / 1.0606 = 28.3%
```

---

## 5. Delivery

**Self-hosted, no third-party origin.** The Google Fonts CDN links and their two
`preconnect` hints were removed from the generator shell (`_build/build.py`) and
from all three homepage shells (`experiments/home/{hu,en,de}.html`).

This tightened the Content Security Policy in `netlify.toml` rather than
preserving it unchanged:

```diff
- style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
- font-src  'self' https://fonts.gstatic.com;
+ style-src 'self' 'unsafe-inline';
+ font-src  'self';
```

`'unsafe-inline'` remains on `style-src` because the site writes per-frame custom
properties to element style attributes; the *other* historical reason for it —
Google Fonts' injected inline `<style>` — is gone.

### Subsetting

Two subsets per face. `latin` carries English and German in full — ä ö ü ß are
all below U+0100 — and `latin-ext` exists for Hungarian's ő (U+0151) and ű
(U+0171). Enforced with `unicode-range`, so **a German or English page never
downloads `latin-ext` at all.**

### Preload policy

§6.4 says preload only genuinely critical above-the-fold files, not every weight
and family. A preload competes with the stylesheet and the LCP image for the same
connection, so a non-first-screen file is worse than useless.

Preloaded:

| Route | Files | Critical transfer |
|---|---|---|
| Hungarian (`/`, 11 static HU pages) | Archivo normal latin + latin-ext | **171.8 kB** |
| English (`/en/`) | Archivo normal latin | **88.0 kB** |
| German (`/de/`) | Archivo normal latin | **88.0 kB** |

Not preloaded, fetched through the normal stylesheet path:

- **JetBrains Mono** (54.4 kB) — sets the altimeter rail and small technical
  labels. Never the LCP element.
- **Archivo italic** (190.8 kB) — emphasis inside body copy, below the fold.

`crossorigin` is set on every preload even though the files are same-origin:
font fetches are always made in CORS mode, and a preload without it produces a
second, wasted request rather than a warm cache entry.

---

## 6. Token system

One file, `assets/css/type.css`, consumed by both the eleven generated static
pages (via `assets/css/main.css`) and the Altimeter Meridian homepage (via
`experiments/src/full/styles.css`). No component names a family, a weight or a
pixel value of its own.

`main.css` keeps `--display`, `--body`, `--data` as local aliases that now
resolve to `var(--font-display)` etc., so the switch happened in one place
rather than across two hundred declarations.

**Families:** `--font-display`, `--font-body`, `--font-mono`, plus the three
`-fallback` stacks.

`--font-display` and `--font-body` resolve to the same family today and are
still two tokens, because they are two *roles*. When Arizona and Diatype arrive
they diverge here and nowhere else.

**Fluid scale**, `clamp()` between 360px and 1440px — eleven size tokens from
`--type-signature-size` to `--type-meta-size`. The signature step is the only one
that keeps climbing on very wide viewports; a paragraph that grows with the
window stops being a paragraph.

**Semantic composites**, each naming family, weight, width, leading and tracking:

```
--type-display-signature   --type-body-primary      --type-navigation
--type-display-section     --type-body-secondary    --type-cta
--type-display-project     --type-label-technical   --type-metadata
                           --type-number-altitude   --type-form-*
```

Width values are real `font-stretch` percentages inside Archivo's 62–125 range,
so they map onto the `wdth` axis rather than triggering synthetic scaling.

**Locale adjustments.** German compounds are long and Hungarian is
agglutinative. Rather than shrinking type — which §6.10 forbids — the display
roles give back a little width and allow hyphenation, which is the first two
corrections in the brief's preferred order:

```css
:root:lang(de) { --type-display-signature-width: 90%; --type-display-section-width: 96%; }
:root:lang(hu) { --type-display-signature-width: 92%; }
```

`lang` is set on `<html>` by the generator and by each homepage shell, so this
needs no JavaScript and is correct before first paint.

**Form fields** use `max(1rem, var(--type-body-size))`. An input smaller than the
prose around it is the single most common reason a mobile browser zooms on focus.

---

## 7. Kinetic type — axis budget

`experiments/src/full/kineticType.ts`. Every value is a pure function of
`journey.altitude`; there is no second scroll listener and no direction-dependent
state, so forward and reverse traversal are identical by construction rather than
by testing.

Clamped to:

```
weight       300 .. 800   (inside Archivo's 100..900)
width         82 .. 118   (inside Archivo's  62..125)
monoWeight   300 .. 750   (inside JetBrains Mono's 100..800)
```

Four moments, chosen from §6.8's menu to match the phrase already emphasised in
each panel of the existing copy in all three languages — not forced to the
brief's example words:

| Altitude | Anchor | Behaviour | Curve |
|---|---|---|---|
| 3,000–6,000 m | `lower-atmosphere` | weight lock 400→780, tracking to −0.014em | `arrive` |
| 8,500–11,000 m | `cloud-breakthrough` | width compress 100→89 and release | `snapCurve` |
| 28,000–30,000 m | `full-stratosphere` | width expand 100→116 | `arrive` |
| 29,400–30,000 m | `altitude-readout` | mono weight 300→440, tracking −0.03→−0.004em | `arrive` |

The three primary bands are **disjoint**, which is §6.7's "one morphing word at a
time" enforced by arithmetic rather than by review. `altitude-readout` is the
permitted secondary and may run alongside a primary.

Not implemented, and why:

- **Serif↔sans personality morph** (§6.8, aperture breakthrough) — requires
  Arizona. Not licensed. No substitute crossfade was faked in its place.
- **Continuous forward slant** (§6.8, final ascent) — Archivo has no `slnt` or
  `ital` axis; italic is a separate file. A skew transform would be synthetic
  distortion, which §6.7 forbids.

---

## 8. Outstanding

**Nothing is outstanding.** Per the decision recorded in §1, Archivo and
JetBrains Mono are the final typography and no font acquisition is pending.

For the record, the items this closes rather than defers:

| Item | Status |
|---|---|
| ABC Arizona Variable licence + files | **not being acquired** — decision, §1 |
| ABC Diatype licence + files | **not being acquired** — decision, §1 |
| ABC Diatype Mono/Semi-Mono licence + files | **not being acquired** — decision, §1 |
| Serif↔sans morph at 12,000 m | **cancelled** — no personality axis exists in Archivo |
| Continuous slant moment | **cancelled** — no `slnt`/`ital` axis in Archivo |

Should that decision ever be revisited, §1's purchase spec and eight-step
drop-in procedure are still accurate.

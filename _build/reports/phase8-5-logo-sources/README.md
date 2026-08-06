# Supplied logo masters — source, not deployment

These are the files the shipped marks in `assets/img/logo-*.png` were derived
from. They are kept here, outside `assets/`, because `scripts/assemble.mjs`
copies `assets/` wholesale into `dist/` — an earlier batch sat in `assets/img/`
and was being published at predictable URLs while referenced by no page.

## What shipped, and how

Each master was trimmed to its ink bounds and resampled to 600px on the long
edge. Trimming removes empty transparent margin and does not touch the mark;
60–85% of each supplied canvas was padding, which at a fixed box height had
Duna Hajók's wordmark rendering about a sixth the size of Kontyos.

| master | shipped as | intrinsic |
|---|---|---|
| `synergy-digital--v2-transparent.png` | `assets/img/logo-synergy.png` | 382×600 |
| `duna-hajok--v2-transparent.png` | `assets/img/logo-duna-hajok.png` | 600×195 |
| `duna-enterior--v2-transparent.png` | `assets/img/logo-duna-enterior.png` | 600×196 |

## Why they sit on a plate

All three are dark artwork and this site's background is near-black. Measured
composited on the void, Synergy's wordmark bands read luminance 0 and 1 — pure
black — Duna Hajók had 36% of its ink below the visible threshold, and Duna
Enterior 87.5% at a mean of 13.8.

Rather than ask for reversed variants, every mark now sits on one identical
plate (`assets/css/motion.css`). Nothing is recoloured, stretched or cropped.
If light/knockout variants ever arrive, the plate can be dropped and the marks
placed directly on the void — that is a change in one rule.

## Superseded

A first batch was supplied with baked white backgrounds and no alpha (and, for
Synergy, a vector whose wordmark was live `<text>` in a font stack, so the
letterforms changed by machine). Those files are not kept: they have no further
use and the masters above replace them.

## Still missing

**HAIO** and **FICE** have no artwork at all. Both relationships are confirmed —
Stratos is an official sponsor of HAIO and runs its advertising; Stratos is
building FICE's website through the Impact Program — but a relationship with no
mark has nothing to render, and neither ships a placeholder.

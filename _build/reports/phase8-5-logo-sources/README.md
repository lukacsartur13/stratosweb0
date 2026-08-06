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
| `haio--knockout-transparent.png` | `assets/img/logo-haio.png` | 600×146 |
| `fice--knockout-transparent.png` | `assets/img/logo-fice.png` | 600×211 |

The two support masters arrived on a 2000×2000 canvas that was 97.4% and 91%
empty, which is why the trim matters more for them than for anything above.

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

## The two support marks are the other polarity

HAIO and FICE arrived after the five above and are the opposite case in every
way that matters here.

They are **knockout artwork**. Every opaque pixel in the FICE master reads
luminance 255 — it is pure white — and HAIO's `HAIO` wordmark and
`HUNGARIAN AI OLYMPIAD` subline are white beside a navy boat. On the `#DCE4EA`
plate FICE disappears completely and HAIO's subline is unreadable; on the void
with no plate, both are crisp. So they carry `ink: "light"` in `ORGS`, which
renders `data-ink="light"` and switches the plate off.

The consequence is a placement rule, not a preference: a light mark cannot sit
on a `band--pale` section, because white on `#F4F4F4` is invisible with or
without a plate — and invisible is exactly what an assertion that only counts
`<img>` elements cannot catch. `expand_logosets()` refuses to build one there.

They are also **support relationships, not collaborations**: Stratos sponsors
HAIO and runs its advertising, and builds FICE's website for nothing through
the Impact Program. Neither may appear under "Selected collaborations", so
`logoset()` defaults to collaborations only and these two must be asked for by
name — `{{logoset:rail:haio}}` on the ads page, `{{logoset:rail:fice}}` on the
Impact page, which are the pages where each is the subject.

Each is alone in its rail, and a rail of one has nothing to normalise against,
so `[data-logo]:only-child` gets a wider box. Without it HAIO — a 4.1:1 lockup —
drew 34px high beside a 96px headline.

# Mobile homepage fidelity — visual review package

Uncommitted imagery. `.gitignore` keeps `_build/reports/*-review/**` out of the
repo except for markdown, so this file is tracked and the 62 stills beside it
are not. Regenerate them with the probes named below.

The written findings live in:

* `../mobile-homepage-fidelity-audit.md` — baseline and root causes
* `../mobile-homepage-fidelity-report.md` — what changed and what did not

---

## What to look at, and what to look for

### `before/` — the defects, at 390×844

One still per stage, taken at the exact scroll position where that stage's flow
begins. The three the brief names are the ones to open first.

| File | What it shows |
|---|---|
| `390x844-selected-work.png` | §2.1. 26svh of unbroken black plate between the header and `Akikkel együtt emelkedtünk.` This is the frame the supplied device screenshot circled. |
| `390x844-system.png` | §2.1, worst case. 30svh — 256 px — of plate above `Kilenc terület, három rétegben.` The layer-1 heading has already been walked off the top. |
| `390x844-process.png` | §2.1 and §9. The stage opens on checkpoint `02`, with a clipped empty box where `01` should be. |
| `390x844-calibration.png` | §2.2. The `0 m ····· KALIBRÁCIÓ` rail drawn across the wordmark row, and the sound toggle clipped by the header's lower edge. |
| `390x844-destination-occlusion.png` | The closing panel at the worst sample of the occlusion sweep. Included because it is the frame that *disproved* §2.3 in the window composition — the instrument is clear. |

### `after/` — the same frames, corrected

33 stills: every stage at 390×844, 430×932 and 360×800.

Look for, in each:

1. the deck reading top-down as **safe area → header → gap → instrument strip →
   section marker → headline** with nothing overlapping;
2. the section marker landing at roughly an eighth of the way down the screen
   rather than a third;
3. the space below the headline being **the scene** — mountains, sky, the
   altimeter — rather than an opaque rectangle;
4. the first list item present: `01 Felderítés` in `process`, `1 Mag` in
   `system`, the first project in `selected-work`.

Pair them directly with `before/` by filename.

### `terrain/` — material zoning, before and after

Four altitudes × two variants × before/after. The copy plates are hidden in
these so the terrain is what is photographed.

| File pattern | What to check |
|---|---|
| `mobile-after-3000m.png` | The clearest read of §14: frosted ridge caps, slate mid-slopes, a darker and warmer valley floor. Compare against `mobile-before-3000m.png`, which is one grey. |
| `desktop-*-1200m.png` | §16 — the same four substances on the accepted desktop geometry, which is otherwise unchanged. |
| `*-0m.png` | The valley band at full strength, and the check that it stays *under* the rock band rather than becoming the brightest region. |
| `*-5500m.png` | Snow as an accent at altitude, and the check that it never competes with the yellow typography or the instrument's lit arc. |

`mobile-after-3000m.png` is also the frame that shows the **unresolved**
limitation: the near-vertical walls running the full frame height, with no peak
silhouette in frame. That is the camera-rise issue in §9 of the report, and it
is the thing this pass did not fix.

---

## Regenerating

The dev server must be serving `dist/` on port 4322:

```bash
npm run build && python3 -m http.server 4322 --directory dist
```

| Directory | Command |
|---|---|
| `after/` | `SHOT=1 SIZES=390x844,430x932,360x800 OUT=_build/reports/mobile-homepage-fidelity-review/after node experiments/.tmp-mhf-entry.mjs` |
| `terrain/` | `MODE=mobile TAG=after node experiments/.tmp-mhf-terrain.mjs` and again with `MODE=desktop` |
| `before/` | the same two, with the working tree at `1b3828f` |

The numeric probes behind the report's tables:

| Measurement | Probe |
|---|---|
| Stage entry, per stage, per size | `experiments/.tmp-mhf-entry.mjs` |
| Header / strip / content overlap | `experiments/.tmp-mhf-deck.mjs` |
| Copy lag after the finger stops | `experiments/.tmp-mhf-lag.mjs` |
| Self-scroll drift over time | `experiments/.tmp-mhf-drift.mjs` |
| Terrain band separation | `experiments/.tmp-mhf-zones.mjs` |
| Which GLB each frame loads | `experiments/.tmp-mhf-variant.mjs` |
| Responsive matrix, zoom, text spacing | `experiments/.tmp-mhf-matrix.mjs` |

---

## Not included

* **Screen recordings.** §24 asks for motion clips — slow scroll, flick,
  reverse, the stage entries, the altimeter handoff, the toolbar height change.
  They are not produced. The scroll-feel claims in the report rest on the
  numeric traces from `.tmp-mhf-lag.mjs` and `.tmp-mhf-drift.mjs` instead, which
  measure the thing a recording would only illustrate.
* **Real-device stills.** Everything here is Chromium emulation at the §22
  viewports. It is sufficient for layout geometry and for the timing of the
  scroll clock; it is not evidence about iOS Safari's scroll feel, about
  `env(safe-area-inset-top)` resolving to a real notch, or about the Safari
  toolbar collapsing. The supplied device screenshots remain the only real-phone
  evidence in this pass, and they are all *before* frames.

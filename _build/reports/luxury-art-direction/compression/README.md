# compression — phase 5.1 · the system chapter

Everything this phase measured, and the instruments that measured it. The
findings are in `../09-system-chapter-compression.md`; this file says what each
artefact is and how to reproduce it.

Phase 5 asked how long the page's states last and answered it in
`../temporal/`. Phase 5.1 asks a different question — does the middle carry the
information it spends the page on, and does it look like it is going anywhere —
so it reuses phase 5's scan and film rigs unchanged and adds four instruments of
its own.

## Reproducing

    npm run build:home
    python3 -m http.server 4322 --directory dist        # in another shell

    # the temporal measurement, phase 5's own rig
    node ../temporal/scan.mjs --width 1440 --height 900 --steps 600 \
         --tag p51-after --out .
    python3 ../temporal/analyse.py scan-p51-after.json
    node ../temporal/scan-mobile.mjs --width 390 --height 844 \
         --tag p51-mobile-after --out .
    python3 ../temporal/analyse-mobile.py scan-p51-mobile-after.json

    # the field, and the chapter geometry
    node field.mjs --tag p51-after --steps 60 && python3 field.py field-p51-after.json
    node geom.mjs 1440 900 hu
    node areas.mjs                       # exits non-zero if a layer line overflows

    # the recordings — three rates, plus the phone
    node ../temporal/film.mjs --tag p51-desktop-normal    --profile natural    --velocity 950  --frames --out ./film
    node ../temporal/film.mjs --tag p51-desktop-cont-slow --profile continuous --velocity 520  --frames --out ./film
    node ../temporal/film.mjs --tag p51-desktop-cont-normal --profile continuous --velocity 950  --frames --out ./film
    node ../temporal/film.mjs --tag p51-desktop-cont-fast --profile continuous --velocity 1800 --frames --out ./film
    node ../temporal/film.mjs --tag p51-mobile-normal --profile natural --velocity 950 \
         --width 390 --height 844 --frames --out ./film

    # the before half, and the sheets
    python3 before.py revert && npm run build:home
    node field.mjs --tag p51-verify --steps 60 && python3 field.py field-p51-verify.json
    python3 before.py check field-p51-verify-bands.json      # must pass before anything is kept
    node chapter.mjs --stage system --steps 15 --tag system-p5
    node field.mjs --tag p5-sheet --steps 71
    python3 before.py restore && npm run build:home
    node chapter.mjs --stage system --steps 15 --tag system-p51
    node field.mjs --tag p51-sheet --steps 71
    python3 sheet.py journey && python3 sheet.py system

    # the content audit
    node ../../../../scripts/system-inventory.mjs

## The instruments

| file | what it answers |
|---|---|
| `field.mjs` / `field.py` | §14 — does the painted field evolve enough to be SEEN between two frames a visitor stops on? Three band medians per settled shot, plus the blue contribution `B − R` of the middle band. `../temporal/background.py` answers the neighbouring question — does the sky STEP? — off a moving recording, and both are needed. |
| `chapter.mjs` | §26 — a dense settled sequence of ONE chapter, sampled across the chapter's own extent, which is the only sampling under which two builds of different lengths compare honestly. |
| `geom.mjs` | Where the screens are: every panel's height, hold and body in screens, so a compression target is arithmetic rather than a guess. |
| `areas.mjs` | The one new object this phase puts on the page — the layer's line of discipline names — measured in eight viewport/locale shapes. Exits non-zero if any of them overflows its column. It caught one that did. |
| `clause.mjs` | §11 — how each candidate replacement for the ambiguous process clause sets, in the element it would live in, on three shapes and in three locales. |
| `sheet.py` | §25 and §26 — the before/after sheets. |
| `before.py` | Reconstructs the phase 5 desktop page so the before half of those sheets is a measurement rather than a memory, and refuses to be trusted until a fresh measurement of the reconstruction reproduces `field-p51-before-bands.json`. |
| `../../../../scripts/system-inventory.mjs` | §3, §4 and §27 — the twenty-eight units of the chapter, snapshotted before the edit, each checked against its declared destination afterwards. Fails if a sentence classified as moved is still in the homepage source. |

## The measurements

| file | what it is |
|---|---|
| `inventory-source.json` | PASS 0. The twenty-eight units in all three locales, taken before any edit. Not regenerable — `system-inventory.mjs --snapshot` refuses now. |
| `content-audit.md` / `.json` | The generated destination table, and the four semantic duplicates §4 asked for. |
| `scan-p51-before.json` | The phase 5 desktop temporal scan, 601 samples. Reproduces `../temporal/scan-desktop-after.json` to 0.01 screens, which is what makes it a valid baseline. |
| `scan-p51-after.json` | The same scan after. `analyse-after.txt` is `analyse.py`'s reading of it. |
| `scan-p51-mobile-after.json` | The portrait scan after. |
| `field-p51-before.json` + `-bands.json` | The phase 5 field, 61 settled shots. The `-bands` file is ground truth for `before.py check`. |
| `field-p51-mid*` | The field after the compression but before the haze correction — the measurement that shows compression alone does not fix §14. |
| `field-p51-hazeV3`, `field-p51-hazeV6` | Two trialled placements of `.air__restraint`'s clearing ramp. V6 shipped. |
| `field-p51-after*` | The field as shipped. |
| `field-p5-sheet`, `field-p51-sheet` | 72 settled shots either side, for the whole-page sheet. |
| `chapter-system-p5`, `chapter-system-p51` | 16 settled shots of the system chapter either side, for the §26 sheet. |
| `film/` | The recordings. `.webm` is what a person watches; the `.json` beside it places every screencast frame on the scroll track by the two clocks' shared epoch. |

## What was pruned, and how to get it back

The settled-shot PNG directories and the screencast JPEG frames are **not
kept** — they came to 356 MB, and every measurement taken from them is in the
`-bands.json` and `film/*.json` files that are. Phase 5 pruned its frames the
same way and for the same reason.

Everything is regenerable from the commands above: `field.mjs` rewrites a shot
directory, `film.mjs --frames` rewrites a frame directory, and `sheet.py` needs
the two shot directories it names. The one file that is NOT regenerable is
`inventory-source.json`, which is the pre-edit measurement —
`system-inventory.mjs --snapshot` refuses to retake it, deliberately.

## The review assets

| file | for |
|---|---|
| `filmstrip-p5-vs-p51.png` | §25. The whole homepage, 24 pairs at equal journey progress. |
| `system-p5-vs-p51.png` | §26. The system chapter, 16 pairs at equal chapter progress. **The primary human-review artefact.** |
| `normal-24.png` | §23. The normal-rate recording, 24 samples at equal journey progress. |
| `middle-dense.png` | §16. Frames 7–18 as one film, 24 dense samples of the normal-rate recording. |
| `middle-slow.png`, `middle-fast.png` | §23. The same stretch at 520 and 1 800 px/s. |
| `mobile-18.png` | The portrait journey at the normal rate. |

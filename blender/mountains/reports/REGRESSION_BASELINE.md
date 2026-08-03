# Stratos — pre-integration regression baseline

Captured **2026-08-02**, before any homepage migration or mountain integration.
This is the state every later measurement is compared against. Nothing in here
may be weakened or re-thresholded to make a later result look better; if a
number moves, the number moves and it gets reported.

## Environment

| | |
|---|---|
| Host | macOS (Darwin 25.6.0), Apple silicon |
| Node | see `node -v` at time of run |
| Blender | 5.2.0 LTS, bundled Python 3.13.13 |
| Playwright | ^1.49.1 |
| Viewport (desktop project) | 1440 × 900 |

## Commands — reproduce exactly these

```bash
npm run test:full
```

```bash
npm run build:full
```

```bash
npm run bench:meridian
```

```bash
npm run bench:lifecycle
```

## Result — full ascent suite

```
76 passed, 64 skipped  (10.2m)
exit code 0
```

Projects covered: `desktop` (1440×900), `mobile-390`, `mobile-430`,
`mobile-375`, `reduced-motion`. WebKit is exercised through the mobile projects'
device descriptors.

The 64 skips are the suite's own conditional paths (evaluation stills and
transfer-cost recording are desktop-only), not failures.

## Carried-forward measurements

These come from `MERIDIAN_PERFORMANCE_AUDIT.md` and were taken before this
session. They are reproduced here so the comparison target is in one file, and
they are **not** re-verified by this session:

* cold desktop traversal at 1440×900: zero frames above 33.3 ms
* worst measured frame: 9.4 ms
* progressive shader compilation: no measurable frame-time stall
* the suspected compile hitch near 21 000 m was disproved by measurement
* production build succeeds; `build:full` succeeds after the standard build
  clears `dist/`

## Known measurement limitations — carried into every later report

Stated in the brief and still true. None of these were resolved by this session:

* GPU-driver VRAM reclamation was not independently verified.
* A residual ~30 KB per lifecycle cycle was not traced to individual objects.
* Lifecycle testing was performed only in desktop Chromium at 1440 × 900.
* Mobile, WebKit and physical-device lifecycle behaviour were not measured.
* Hidden-tab behaviour was tested through a controlled `visibilityState`
  override and a dispatched event, not through native browser background
  throttling.
* GLB re-parsing cost during remount has not been measured.

## Asset baseline (before mountains)

| Asset | Bytes |
|---|---|
| `public/models/stratos-altimeter.glb` | 396 912 |

There is no mountain asset in the baseline. The desktop and mobile mountain
GLBs are new payload and their cost is additive — it may not be presented as
neutral. See `stratos-mountains-report.json` for what was actually added.

## Amendment — 2026-08-03, mobile composition pass

The mobile variant was rebuilt as a dedicated portrait composition. Recording
the movement rather than quietly restating the table above:

| | Before | After |
|---|---|---|
| Mobile GLB | 120 360 B | 164 148 B |
| Mobile triangles | 31 888 | 48 336 |
| Desktop GLB | 345 848 B | 345 744 B |
| Desktop triangles | 131 884 | 131 884 |

The mobile file is **43 788 bytes larger**. That is a real cost and it is not
offset by anything measured: the previous mobile asset was the desktop
composition at reduced density, and four of its masses rendered zero pixels at
every station, so the smaller number was smaller partly because it was paying
for geometry that never appeared. Both remain inside the 25 k–65 k triangle and
600 kB budgets.

The desktop GLB changed by **−104 bytes**. Cause: `ASCENT_ROUTE` was below the
valley floor for the last third of its length in the accepted asset (see the
README's shared-defect note). Triangle count, mesh count, material count and
every node name are unchanged.

Still not measured, and still not claimed: load time, parse time, Draco decode
cost, draw calls, frame-time impact, CSP behaviour. Nothing in this amendment
has been in a browser.

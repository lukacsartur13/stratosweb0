# Phase 7 — baseline

Recorded **before any Phase 7 source edit**, per §1. Everything below is a
measurement of the accepted Phase 6 / Phase 6.5 state, not a restatement of the
brief.

The integrity of this baseline was checked rather than assumed: `validate:full`
rebuilds the route it tests, and that rebuild finished at 19:57 — before the
first Phase 7 edit landed. `grep -rl "stratos-cloud-weighted" dist/` returns
nothing, confirming no Phase 7 code reached the bundle the suite ran against.
The screenshots and the resource probe were taken with the Phase 7 edits stashed
(`git stash push -- experiments/src _build/build.py assets/js/main.js
assets/css/main.css experiments/home`), against the same tree the suite measured.

---

## 1. Identity

| | |
|---|---|
| Branch | `phase-6-typography` |
| Commit | `7201586728e81e5c622ebed6668effe456dcc0b8` |
| Subject | `fix(phase-6.5): give the mobile canvas the pixels the instrument needs` |
| Working tree | Dirty, but only in files that are not inputs to the build: `.claude/settings.local.json`, `_build/reports/meridian-visibility.json`, `portal/tsconfig.app.tsbuildinfo`, and 33 untracked `experiments/.tmp-*.mjs` scratch probes. **No tracked source file was modified at baseline time.** |

## 2. Gates

| Gate | Result |
|---|---|
| `npm run typecheck` | **pass** — `portal` and `experiments`, both `tsc -b --noEmit`, no output |
| `npm run build` | **pass** — generate + assemble + home + portal |
| `npm run validate:full` | **pass** — exit 0, **88 passed, 97 skipped, 0 failed** in 15.0 m |
| `npm test` (production suite) | **1 failed**, 293 passed, 10 skipped in 2.8 m |

### The one baseline failure

```
[reduced-motion] › tests/portal.spec.ts:107:3 › password reset
                 › does not reveal whether an address has an account
```

Re-run in isolation at `--workers=1`: **fails identically**. Classified under
§35 as **reproduced on baseline** — a deterministic pre-existing failure, not
parallel contention and not an isolated flake. It is a portal test, on a surface
Phase 7 does not touch. It must still be failing, in the same way, at the end of
Phase 7; any change in its behaviour is a Phase 7 regression.

Note that `validate:full` does **not** run the production suite — it is
`clean:validate && build && test:full`. The two were therefore run separately,
and the "five-way parallel contention" §35 refers to belongs to `npm test`
(`fullyParallel: true`, six projects, `workers: undefined`), not to
`test:full` (`fullyParallel: false`, `workers: 1`).

## 3. Surface counts

| | Count | Notes |
|---|---|---|
| Route keys | 12 | `index`, `about`, `sme`, `enterprise`, `branding`, `ads`, `impact`, `blog`, `contact`, `quote`, `privacy`, `imprint` |
| Locales | 3 | `hu` (root), `en` (`/en/`), `de` (`/de/`) |
| Generated static documents | 33 | 11 non-index keys × 3 locales, from `_build/pages` via `_build/build.py` |
| React homepages | 3 | `experiments/home/{hu,en,de}.html` → `/`, `/en/`, `/de/` |
| Public documents total | 36 | |
| Portal | 1 SPA | `dist/portal/`, react-router, behind auth |

### Routes that do not exist

**There is no work index and there are no case-study routes.** §18, and the
`work-to-case` / `case-to-work` categories in §21, and the "work index → case
study" rows of §30's matrix, have no route pair on this site to act on. The case
studies live inside the homepage's own scroll as the `selected-work` journey
stage, not as documents. `blog.html` links only to itself, `arajanlat.html`,
`ugyfelszolgalat.html` and `index.html` — there are no individual post routes
either.

Likewise there is no services *index*: the five service pages are siblings
reachable from the menu.

This is recorded here as a baseline fact so the Phase 7 report is not read as
having quietly dropped the requirement. Adding routes is forbidden by §34 and
belongs to Phase 8.

## 4. Navigation architecture (as found)

No shared SPA router. 36 independently generated documents plus one routed
portal.

Page transitions **were already partly implemented**, in `assets/js/main.js`
(the `.curtain` element and its click handler) and `assets/css/main.css`. The
implementation is present on the 33 generated pages and absent from the three
homepages. Measured against §20 it is incorrect in six ways:

1. `e.preventDefault()` is called on every same-origin click regardless of
   modifiers, so **⌘-click, Ctrl-click, Shift-click and Alt-click on every
   internal link open in the current tab** instead of doing what was asked;
2. `download` links are intercepted and then navigated to;
3. `/portal/`, `/api/` and asset paths are not excluded, so it animates into an
   authenticated SPA and into non-documents;
4. navigation is delayed a fixed 420 ms with no timeout and no failure path;
5. nothing clears `.is-up` on `pageshow`, so a BFCache restore returns with the
   class still applied;
6. a second click cannot re-trigger the animation, because the class is already
   present.

Phase 7 replaces it. This is behaviour, not content, so §34 is not engaged.

## 5. Renderer policy at baseline

| | |
|---|---|
| Effective DPR policy | `renderScale()` in `experiments/src/lib/capabilities.ts` — `start = min(devicePixelRatio, 2)`, `floor = min(devicePixelRatio, 1.5)`. One canonical owner: the number is held by `JourneyScene` and passed **as** the `<Canvas dpr>` prop. |
| DPR ladder | One step, downward, once per session. `PerformanceMonitor.onDecline`/`onFallback` → `stepDown()` → `setDpr(floor)`. No `onIncline`. |
| WebGL antialias | `antialias: true`, unconditional on tier. Measured `gl.getParameter(gl.SAMPLES) === 4` on the live context — real 4× MSAA, not a request the driver ignored. |
| Shadows | None anywhere in the journey. |
| Post-processing | None. No render target, no effect composer. |

### Measured resources (`_build/reports/phase7-resources-before.json`)

Desktop 1440×900, `deviceScaleFactor: 1`:

| Altitude | Draw calls | Triangles | Scene children |
|---|---|---|---|
| 0 m | 57 | 157 694 | 170 |
| 7 000 m | 97 | 158 294 | 170 |
| 9 500 m | 60 | 158 198 | 170 |
| 11 000 m | 85 | 158 248 | 170 |
| 11 800 m | 86 | 158 250 | 170 |
| 12 000 m | 70 | 26 366 | 170 |
| 12 500 m | 70 | 26 366 | 170 |
| 18 000 m | 82 | 30 846 | 166 |
| 30 000 m | 54 | 35 546 | 156 |

Geometries 122, textures 4, programs 15, effective DPR 1.0, MSAA 4×.

Mobile 390×844, `deviceScaleFactor: 3`: geometries 73, textures 4, programs 15,
MSAA 4×, draw calls 49–68, triangles 20 756–69 112, **effective DPR 1.5**.

That 1.5 is the *floor*, not the *start*. The policy's start at
`devicePixelRatio: 3` is 2.0; the run measured 1.5, which means
`PerformanceMonitor` declined and `stepDown()` fired. This is headless Chromium
on a software rasteriser, where declines are expected and meaningless as a
statement about hardware — §13. It is recorded because it is the number the
same probe will produce after Phase 7, and because §12's reordered ladder
predicts it should change: the first decline should now spend cloud layers and
leave the instrument at 2.0.

### Transfer

The transfer columns in the probe read zero because the Vite dev server serves
chunked responses with no `content-length`. Transfer is therefore measured off
the built artefact instead, which is the honest surface for a static site.
Baseline, from `npm run build`:

| Chunk | Raw | gzip |
|---|---|---|
| `assets/home/JourneyScene-*.js` | 1 049.99 kB | 292.81 kB |
| `assets/home/main-*.js` | 249.02 kB | 82.65 kB |
| `assets/home/index-*.js` | 70.85 kB | 27.95 kB |
| `assets/home/ScrollTrigger-*.js` | 43.99 kB | 18.27 kB |
| `assets/home/main-*.css` | 21.92 kB | 5.42 kB |

Cloud assets transferred at baseline: **0 bytes.** The deck rasterises its
texture at runtime.

## 6. CSP at baseline

From `netlify.toml`, unchanged by Phase 7:

```
default-src 'self';
script-src 'self';
worker-src 'self' blob:;
style-src 'self' 'unsafe-inline';
font-src 'self';
img-src 'self' data: blob: https://*.supabase.co;
connect-src 'self' https://*.supabase.co wss://*.supabase.co;
form-action 'self';
frame-ancestors 'none';
base-uri 'self';
object-src 'none';
upgrade-insecure-requests
```

Plus `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`,
`Permissions-Policy`, `Cross-Origin-Opener-Policy`, `Strict-Transport-Security`.

`script-src 'self'` with no `'unsafe-inline'` and no `'unsafe-eval'` is the
binding constraint on §15–§22: every transition script must be a first-party
file. `blob:` on `worker-src` exists only for DRACO and is documented in place.

## 7. Baseline stills

`_build/reports/phase7-baseline-shots/` — **42 PNGs**, plus `digests.json`
(SHA-256, 16 hex chars each) and `state.json` (altitude, stage, aperture,
horizontal-overflow flag per capture).

Altitudes: 0, 7 000, 12 000, 18 000, 24 000, 30 000 m.
Viewports: 1440×900, 1366×768, 1024×768, 430×932, 390×844, 360×800, 844×390.

Captured with idle ring rotation frozen via the `__stratos` accessor installed
before the application assigns the handle, so they are reproducible. No page
errors and no horizontal overflow at any of the 42.

These are the regression baseline. The cloud work must be judged against them.

## 8. Cloud system at baseline

Recorded because Phase 7 replaces it and the replacement has to be justified
against what was there.

`experiments/src/full/components/CloudDeck.tsx`, 192 lines. Two populations of
camera-facing quads (44 + 26 at full tier, 16 + 10 reduced), one runtime-drawn
four-gradient texture, one `<mesh>` and one material each — **70 meshes, 70
materials, 70 draw calls** at full tier.

Its timeline:

```
6 000 – 8 500   approach
8 500 – 9 700   entry
9 700 – 10 600  exit
10 600 +        above
```

**The deck is fully behind the camera by 10 600 m.** The aperture breakthrough
— `ALTITUDE_STOPS.breakthrough`, and the primary event of the journey — is at
**12 000 m**. The clouds cleared 1 400 m before the event they exist to make
credible, and nothing could detect the mismatch because the two timelines shared
no term. This is the defect Phase 7's §7 timeline exists to correct, and it is
visible in the baseline stills at 7 000 m and 12 000 m.

All cloud state was derived inside the component's own `useFrame` body from
constants private to it, so nothing else could read it and no sweep could
compare two runs of it — §6's two named prohibitions, both live at baseline.

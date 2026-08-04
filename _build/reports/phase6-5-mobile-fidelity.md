# Phase 6.5 — mobile visual fidelity gate

Measured against the **production build** (`npm run build:home` → `dist/`), served
statically, with no development handle present. Every number below was read off
the running page, not inferred from a screenshot.

Reference machine: Apple M4, Chromium via ANGLE/Metal
(`ANGLE (Apple, ANGLE Metal Renderer: Apple M4, Unspecified Version)`).
**Not SwiftShader** — the GPU string was checked before any timing was recorded.
It is also not a phone; see *Remaining physical-device limitations*.

---

## 1 · The two defects were one cause

They were diagnosed separately and turned out to share a root cause, which is
why the same change fixes both.

| | Altimeter Meridian | Background (mountains, sky) |
|---|---|---|
| First loading frame | not affected — nothing is drawn (§5) | not affected |
| Loading → live crossfade | no crossfade exists | no crossfade exists |
| Settled scene | **defective** | **defective** |
| Movement | defective (same frames) | defective (same frames) |
| Orientation change | defective in both orientations | defective in both |
| Viewport resize | defective at every size | defective at every size |
| High-DPR devices | **defective at DPR 2 and 3 alike** | same |
| Quality tiers | handheld tier only; desktop unaffected | handheld tier only |

The defect was **static**: present in the settled frame at every viewport, at
every altitude, in both orientations. It was never a loading artefact, never a
transient, and never tier-adaptive — which is what pointed at a fixed
configuration rather than at anything dynamic.

---

## 2 · Real canvas resolution, before

Production build, four viewports, `deviceScaleFactor` 3 and 2. Identical results
at both, because the ratio was capped below either.

| Viewport | dPR | visualViewport | canvas client | canvas buffer | effDprX | effDprY | tier | antialias | MAX_SAMPLES |
|---|---|---|---|---|---|---|---|---|---|
| 430×932 | 3 | 430×932 | 430×932 | 645×1398 | 1.500 | 1.500 | reduced | **false** | 4 |
| 390×844 | 3 | 390×844 | 390×844 | 585×1266 | 1.500 | 1.500 | reduced | **false** | 4 |
| 360×800 | 3 | 360×800 | 360×800 | 540×1200 | 1.500 | 1.500 | reduced | **false** | 4 |
| 844×390 | 3 | 844×390 | 844×390 | 1266×585 | 1.500 | 1.500 | reduced | **false** | 4 |

`renderer.getPixelRatio()` is not separately reported because it is not a
separate fact: react-three-fiber is the only caller of `setPixelRatio`, and the
buffer/client ratio above *is* what it set.

Checks the gate asks for by name:

- **CSS never enlarges the canvas beyond its buffer.** Computed style width and
  height equal `clientWidth`/`clientHeight` at every sample; effective DPR is
  exactly the ratio above, never below 1.
- **No mobile state is left at 300×150.** The element does pass through the
  HTML default for ~77 ms before react-three-fiber measures it — but it is
  never rendered to. Instrumenting `drawArrays`/`drawElements` on the live
  context recorded **10 066 draw calls, 10 066 of them at the final
  585×1266 buffer**, first draw at 465 ms, canvas already attached and already
  final. The 300×150 state is a layout instant, not a visible frame.
- **No stale earlier viewport size.** Across an eight-step scroll sweep,
  address-bar collapse, both orientation changes, zoom and a tab
  background/restore, every settled sample matched the viewport exactly.

### Root cause

Two lines, both in the handheld branch:

1. `capabilities.ts` capped the ratio at **1.5** on any coarse-pointer or
   sub-820px device — `cappedDpr()` returned `[1, 1.5]`.
2. `JourneyScene` created the context with `antialias: !simplified`, and
   `simplified` is true for exactly the handheld tier. **Every phone got a
   1.5× buffer with multisampling switched off**, on hardware reporting
   `MAX_SAMPLES` 4.

Why that lands hardest on this scene: the altimeter GLB carries **0 textures and
0 images** across 26 primitives and 12 materials. Its tick ring, numerals,
engraved face text and bezel chamfers are *modelled geometry*. There is no
texture filtering to soften the loss and no mip level to fall back to — every bit
of the instrument's detail is resolution-bound, and at 1.5× with no MSAA there
was nothing left to resolve one-pixel features with.

The background is the same story: the mountain GLBs also carry **0 textures**
(48 336 triangles mobile, 131 884 desktop). Their look is a shaded silhouette,
so "background pixelation" was literally the ridge line stair-stepping.

---

## 3 · The DPR pipeline audit — and a second bug found in it

Every system that can change the effective ratio, after the audit:

| System | Before | After |
|---|---|---|
| `Canvas dpr` prop | `cappedDpr()` → `[1, 1.5]` tuple | `dpr={dpr}`, a **number** owned by `JourneyScene` |
| `renderer.setPixelRatio` | r3f only, from `viewport.dpr` | unchanged — r3f only |
| `renderer.setSize` | r3f only, from its `ResizeObserver` | unchanged — r3f only |
| Quality tier | set `antialias`, capped DPR | sets scene detail only; no DPR authority |
| Dynamic render scale | `PerformanceMonitor` → `setDpr` | reports upward; scene applies |
| Loading quality | none | none |
| Resize / orientation | none | re-derives the ratio (raise-only) |
| Background-tab restore | none | none — the loop parks, geometry is untouched |

**The second bug.** `PerformanceMonitor` called `useThree().setDpr` imperatively.
react-three-fiber's `configure()` runs in a layout effect with *no dependency
array* and ends with

```js
if (dpr && state.viewport.dpr !== calculateDpr(dpr)) state.setDpr(dpr)
```

and `<Canvas>` measures itself with `useMeasure({ scroll: true })`. So every
imperative `setDpr` was reverted by the next `<Canvas>` render — which on this
page means **the next scroll**. The decline lowered the ratio, the scroll put it
back, the next decline lowered it again: the signature object's resolution
oscillating with the visitor's thumb. This is the identical failure mode the
codebase had already documented and fixed for `frameloop`; the ratio had it too
and nobody had noticed, because both halves were individually correct.

Answering the gate's four questions directly:

- *Does the renderer start low and never recover?* No. It started at the cap and
  stayed there; the cap was simply too low.
- *Does QualityManager lower DPR during loading?* No. `PerformanceMonitor` needs
  a sustained frame average before it declines.
- *Does a resize reset DPR?* Before: yes, a scroll or resize re-asserted the
  tuple, which is what made the pumping possible. After: a resize re-derives the
  ratio deliberately, and can only raise it.
- *Is the live canvas CSS-scaled?* No, at any sample.
- *Do validation and production routes use different DPR rules?* No. `src/full`
  is shared by `/` and `/experiments/stratos-ascent-full/`, and the Phase 1
  prototype was pointed at the same `renderScale()` so there is no second
  opinion anywhere in the tree.

---

## 4 · The quality floor, and how 2.0 was chosen

Three candidates were built and photographed at 100 % physical pixels, ground
level and 18 000 m, portrait and landscape:

| Candidate | Buffer @390×844 | Verdict |
|---|---|---|
| 1.5 + 4× MSAA | 585×1266 | Silhouette and ring acceptable. **Engraved face text (`×1000 m`, `ALTITUDE`) is illegible mush.** Rejected. |
| 1.75 + 4× MSAA | 682×1477 | Marginally better; face text still not resolved. Rejected. |
| **2.0 + 4× MSAA** | **780×1688** | Face text legible, tick ring clean, bezel and aperture edges smooth. **Accepted.** |

2.0 is the top of the band the gate permits, and it is where the lowest
acceptable result landed — not a default.

**The degradation ladder.** §4 asks that cloud complexity, mountain secondary
detail, atmosphere sampling, shadow quality, secondary effects and
post-processing resolution all be reduced before the instrument's. On the
handheld tier they already are, and there is nothing left above DPR on that
list: no shadow map anywhere in the journey, no post-processing pass, no render
target, no atmosphere buffer, a one-draw-call sky, the reflection probe already
at 64, and the clouds, stars, rings and Earth limb already on their simplified
geometry. So the honest ladder on mobile is one rung, and it is bounded:

- start at 2.0;
- on a *sustained* decline (`PerformanceMonitor`, `flipflops: 3`), step **once**
  to the 1.5 floor;
- never below it, and **never back up**.

No `onIncline`. A climb back is what a pump is made of, and the gate asks for an
instrument that does not visibly change sharpness — not for one that recovers
quickly. At most one transition per session, in the direction that keeps frames.

---

## 5 · Loading state

Solution: **sharp initial canvas** — the lowest-cost of the three options, and it
turned out to be the existing architecture rather than something to build.

Measured: the first visible canvas frame is *already* at the final buffer size.
All 10 066 draw calls in a three-second session were at 585×1266 (before) and
780×1688 (after); the first came at 439–478 ms. There is no low-resolution frame
to hide, so no poster and no delayed reveal were built — both would have been
machinery to conceal a state that does not exist.

Before the canvas arrives, the surface is `.stage__loading`: a flat `var(--ink)`
plate, no image, no spinner.

---

## 6 · Background source audit

| Path | Background source |
|---|---|
| Initial page paint | document background colour |
| Loading | `.stage__loading`, flat `var(--ink)` |
| Live scene | WebGL canvas — `Sky` shader dome, mountain GLB, cloud deck, star field, Earth limb |
| Reduced motion | one inline SVG instrument (`JourneyFallback`); no canvas |
| WebGL fallback | one inline SVG instrument; no canvas |

Audited on all three paths at 390×844 / DPR 3: **zero `<img>` elements in the
stage, zero `background-image` other than the CSS gradients used as text plates,
`background-size` never involved.** There is no poster, no fallback raster, no
`srcset`, and no desktop image being cropped or stretched.

Ruled out as causes, with the evidence:

- *Low-resolution fallback image / stretched poster / CSS `background-size`
  upscaling* — no raster image exists on any path.
- *Compressed textures, low-resolution procedural noise* — **all three GLBs
  contain 0 textures and 0 images.** Structurally impossible.
- *Mobile mountain GLB* — not the cause, and not rebuilt. The same 48 336-triangle
  asset produces a clean ridge line once the buffer is correct (crop below).
- *Fog / colour banding* — measured, §8.

---

## 7 · Background fallback assets

**None generated, and none needed.** The gate's §7 is conditional on an
undersized poster or fallback existing; §6 established that no raster background
asset exists on any path. Producing AVIF/WebP `srcset` variants here would mean
inventing an asset the page does not use.

---

## 8 · Fog and colour banding

Geometry edges are sharp after the fix, so the gradient was measured directly:
luminance run lengths down one 690-pixel column, clear of the instrument.

| Build | Altitude | Distinct levels | Luminance range | Median run | p95 run | Max run |
|---|---|---|---|---|---|---|
| before | 12 000 m | 59 | 10–77 | 1 px | 7 px | 30 px |
| before | 24 000 m | 7 | 7–13 | 1 px | 7 px | 18 px |
| before | 30 000 m | 57 | 4–69 | 1 px | 5 px | 14 px |
| after | 12 000 m | 62 | 11–87 | 1 px | 6 px | 33 px |
| after | 24 000 m | 15 | 8–22 | 1 px | 6 px | 24 px |
| after | 30 000 m | 58 | 4–69 | 2 px | 6 px | 14 px |

A visibly banded 8-bit gradient over 690 px shows a handful of levels with runs
of tens of pixels each. This shows 57–62 levels with median runs of 1–2 px: the
ordered dither already in `Sky`'s fragment shader (1.6/255, below the
quantisation step) is doing its job. The 24 000 m column is near-black by design
— few levels because there is little range there, not because it is banded; its
run lengths are as short as everywhere else.

**No dithering was added.** The gate permits it only where it measurably helps,
and it does not.

---

## 9 · Antialiasing

The context is now created with `antialias: true`, unconditionally, and the
result was verified on the live context rather than assumed:
`getContextAttributes().antialias === true` and `gl.getParameter(gl.SAMPLES) === 4`
at every viewport. It is real 4× MSAA, not a request the driver ignored.

The gate's ordering was followed: canvas resolution was corrected first, material
and geometry sources were verified second (0 textures — nothing to fix there),
and **no FXAA or SMAA pass was added**. Native multisampling was available the
whole time and had simply been switched off for the tier that needed it most.

---

## 10 · Resize and orientation

Canvas geometry was sampled every frame for a whole session. Five geometry
changes, all of them caused by a real viewport change, none spontaneous:

| Event | Buffer | CSS | Effective DPR |
|---|---|---|---|
| settled | 780×1688 | 390×844 | 2.000 |
| 8-step scroll sweep of the whole track | *(no change)* | | 2.000 |
| address-bar collapse (390×900) | 780×1800 | 390×900 | 2.000 |
| portrait → landscape | 1688×780 | 844×390 | 2.000 |
| landscape → portrait | 780×1688 | 390×844 | 2.000 |
| tab hidden → restored | *(no change)* | | 2.000 |

Browser zoom, driven by `devicePixelRatio` and confirmed to track it:

| devicePixelRatio | Buffer | Effective DPR |
|---|---|---|
| 3 | 780×1688 | 2.0 |
| 1.5 | 585×1266 | 1.5 |
| 1 | 390×844 | 1.0 |
| back to 3 | 780×1688 | 2.0 |

The policy clamps to the hardware ratio, so a zoomed-out page never renders more
pixels than the screen can show, and it recovers on the way back.

**One context, one render loop.** WebGL context creations stayed at 2 for the
whole session — the capability probe's throwaway context plus the renderer's —
across five viewport changes and both orientation changes. Nothing is recreated
on an ordinary resize.

*Caveat, stated because it changes what was proven:* Chrome DevTools Protocol's
`Emulation.setDeviceMetricsOverride` mutates `devicePixelRatio` **without
dispatching `resize` or the `dppx` media-query `change`** that a real browser
zoom fires — verified directly (`matchMedia` state flipped, no event). The zoom
table above was therefore produced by delivering the event a real browser
delivers. The handler listens for both `resize` and a re-pinned
`(resolution: Xdppx)` query, and one unassisted data point exists: clearing the
override *does* fire `resize`, and the buffer followed to 390×844 on its own.

---

## 11 · Mobile visual acceptance

Captured on the production build at 430×932, 390×844, 360×800 and 844×390, DPR 3,
at 0 / 7 000 / 12 000 / 18 000 / 24 000 / 30 000 m — full viewport, instrument crop
at 100 % physical pixels, background crop, first visible frame and settled frame.
Altitudes were reached by scrolling and read back off the HUD (within 70 m of
target), not by a debug override, so the captures are of the real route.

```
Altimeter silhouette visibly sharp: yes
Ring edges visibly sharp: yes
Aperture edge visibly sharp: yes
Background not visibly pixelated: yes
No stretched fallback image: yes
No stale low-resolution canvas: yes
No visible DPR pumping: yes
Orientation remains sharp: yes
```

The clearest single piece of evidence is the ground-level ridge line at 3×
magnification: before, a staircase of ~4-pixel steps down the diagonal; after,
a continuous edge. Same GLB, same triangle count, same material.

---

## 12 · Performance and quality balance

Whole-track scripted scroll, warm, frame intervals from `requestAnimationFrame`.
Reported **with vsync disabled**, because with it on both configurations sit at
60 fps and the comparison measures the display, not the renderer.

| | 390×844 | 430×932 | 844×390 |
|---|---|---|---|
| Effective DPR, before → after | 1.5 → **2.0** | 1.5 → **2.0** | 1.5 → **2.0** |
| Drawing buffer, before → after | 585×1266 → **780×1688** | 645×1398 → **860×1864** | 1266×585 → **1688×780** |
| Buffer pixels, before → after | 0.74 → **1.32** Mpx | 0.90 → **1.60** Mpx | 0.74 → **1.32** Mpx |
| Antialiasing | none → **4× MSAA** | none → **4× MSAA** | none → **4× MSAA** |
| Frame p50, before → after | 2.0 → **3.9 ms** | 2.0 → **4.0 ms** | 1.6 → **2.5 ms** |
| Frame p95, before → after | 6.5 → 12.1 ms | 7.9 → 13.0 ms | 6.6 → 11.7 ms |
| Headroom, before → after | 388 → 227 fps | 359 → 225 fps | 421 → 291 fps |
| Draw calls / frame | 58.9 → 58.9 | 58.9 → 58.4 | 60.5 → 59.5 |
| First draw | 473 → 458 ms | 380 → 452 ms | 471 → 478 ms |
| JS heap | 21 → 20 MB | 23 → 20 MB | 19 → 24 MB |
| Quality tier | reduced (unchanged) | reduced | reduced |

**Which half costs what** — a third build isolated it, at DPR 2 with MSAA off:

| Configuration @390×844 | Buffer pixels | Frame p50 |
|---|---|---|
| 1.5×, no MSAA (before) | 0.74 Mpx | 2.0 ms |
| 2.0×, no MSAA | 1.32 Mpx | 2.2 ms (**+10 %**) |
| 2.0×, 4× MSAA (after) | 1.32 Mpx | 3.9 ms (**+77 %**) |

Raising the resolution — the thing that actually fixed the engraved detail — is
nearly free at this scene's complexity. The multisampling is what costs. Both
were kept because the crops show both were needed: resolution restores the face
text, MSAA restores the silhouette and the thin orbital ring lines.

Transfer is **unchanged** by this work: `stratos-altimeter.glb` 388 KB,
`stratos-mountains-mobile.glb` 160 KB, `JourneyScene` chunk 1 025 KB
(293 KB gzip). No asset was rebuilt, added or removed.

Draw calls, heap and first-draw timing are all flat, as expected — the change
alters how many samples each fragment costs, not how much work is submitted.

*Noted in passing, not changed:* a phone in landscape (844×390) scores into
`stratos-mountains-desktop.glb` — 338 KB and 131 884 triangles instead of the
mobile asset's 160 KB and 48 336. That is `mountainAsset.ts`'s existing
aspect-ratio weighting, it predates this work, and it is out of scope here.

---

## 13 · Regression

- `npm run typecheck` — pass (portal and experiments).
- `npm run build:home` / `npm run build:full` — pass.
- `npm run validate:full` — clean build plus the full Playwright suite across
  `desktop`, `mobile-390`, `mobile-430`, `mobile-375` and `reduced-motion`:
  **86 passed, 2 failed** in each of two runs — but not the same two, and none of
  them attributable to this change. Exit code 1. Details below, because "86
  passed" on its own would be hiding something.

### The three failures seen, and what each one is

Two full runs on this tree, plus a bisect run on the unmodified baseline:

| Test | Project | Run A | Run B | Isolation, this tree | Baseline |
|---|---|---|---|---|---|
| `:1265` stage does not depend on direction | desktop | ✘ 300 s timeout | ✘ 300 s timeout | ✘ | **✘ fails here too** |
| `:201` reaches exactly 30 000 m | desktop | ✘ 29 970 | ✓ | ✓ 3/3 | ✓ |
| `:637` no overlap / no overflow | mobile-390 | ✓ | ✘ 120 s timeout | ✓ 2/2, **20 s of a 120 s budget** | — |

1. **`:1265` is pre-existing.** Verified by stashing all five changed files,
   rebuilding `dist/experiments` from that tree and re-running: it fails there
   with the same 300 s timeout at the same line, inside `settleAt`'s
   `requestAnimationFrame` wait. It is a property of this machine — the suite
   runs headless Chromium *without* the GPU flags used for the measurements
   above, so `desktop` renders through a software rasteriser at roughly the 8 fps
   the test's own comment documents, and the frame-count budget does not survive
   it. Not this change, and not a mobile test.
2. **`:201` and `:637` are contention flakes**, and each passed in the other
   full run. Both were re-run in isolation on this tree and passed every time;
   `:637` in particular finishes in **20 s against a 120 s budget**, a six-fold
   margin that no plausible per-frame cost accounts for. Both timed out only
   inside a five-project parallel run on a machine that was also running the
   measurement browsers.

**The MSAA-cost hypothesis was tested, not assumed.** Adding multisampling does
roughly double per-frame GPU cost (§12), so "the fix made the suite too slow" was
the obvious suspicion. The isolation timings refute it: a test with a 6× margin
does not fail because frames got ~2× more expensive, and `:637` and `:201` each
passed a full run *on this same code*. What remains is parallel-run contention on
this machine, which is a property of the environment.

So: one pre-existing failure, no regression, and a suite that is flaky under
five-way parallelism here. This is reported as a limitation rather than a pass.

### Specific regressions checked for, none found

Text collisions, instrument clipping, active-ring clipping, horizontal overflow,
mobile rail/portrait composition and lifecycle growth are all covered by the
suite above and all passed. Horizontal overflow was additionally checked
independently during the DPR measurement:
`document.documentElement.scrollWidth` equals the viewport width exactly at 430,
390, 360 and 844 px.

Nothing in this change touches layout, composition, typography or the rail
system — the diff is the pixel ratio, one context attribute, and where the ratio
is owned.

*One cross-cutting note:* `src/full` is shared by the homepage and the
`/experiments/stratos-ascent-full/` benchmark baseline, so the numbers in
`MERIDIAN_PERFORMANCE_AUDIT.md` and `PERFORMANCE_COMPARISON.md` were taken at
1.5× with no MSAA and are no longer the configuration that route runs. They are
historical from here, and §12 above is the current reading.

---

## 14 · Remaining physical-device limitations

Stated plainly, because they bound what the numbers above can be claimed to
prove.

1. **No physical phone was measured.** Everything here ran in Chromium on an
   Apple M4 at emulated viewports and device pixel ratios. The GPU string was
   checked (`ANGLE Metal Renderer: Apple M4`) so no SwiftShader timing is being
   passed off as device performance — but an M4 is not an iPhone or a mid-range
   Android, and the ×2 frame-time increase measured here is a ratio on this GPU,
   not a prediction for that one. Apple Silicon is at least the same
   tile-based-deferred family as phone GPUs, so the MSAA cost is architecturally
   representative in kind; its magnitude is not.
2. **The headroom claim is therefore directional.** After the fix the reference
   GPU spends 3.9 ms of a 16.7 ms budget. A phone GPU several times slower would
   still fit; one much slower than that would not, and that is exactly the case
   the one-way step to the 1.5 floor exists for.
3. **The value of that step is unmeasured on phone hardware.** On the reference
   GPU dropping 2.0 → 1.5 recovers only ~10 % of the frame, because this scene is
   not fragment-bound there. Phones are more bandwidth- and fill-limited, so the
   step should be worth more on the devices that will actually take it — but that
   is reasoning, not a measurement, and it is the one number in this report that
   a physical device would most usefully replace.
4. **Real iOS/Safari viewport behaviour is only partly reproduced.** Address-bar
   collapse was emulated as a viewport-height change, which is what it is; iOS
   pinch-zoom, which moves `visualViewport.scale` without moving
   `devicePixelRatio`, was not exercised. It does not change the drawing buffer,
   so it should be inert, but it was not proven.
5. **Browser zoom was verified with an assisted event.** See §10 — CDP changes
   `devicePixelRatio` without dispatching the `resize`/`dppx` events a real
   browser dispatches. The handler was shown to respond correctly to those
   events and to one unassisted `resize`; it was not shown end-to-end through a
   genuine zoom gesture.
6. **The regression suite does not come back green on this machine.** One
   pre-existing desktop failure that reproduces on the unmodified baseline, plus
   flakiness under five-way parallelism — §13. Nothing here indicates a defect in
   this change, but the suite was not observed clean, and that is the reason this
   report is *accepted with documented limitations* rather than simply accepted.

## Verdict

`renderScale()` in `src/lib/capabilities.ts` is now the only place the effective
device pixel ratio is decided, `JourneyScene` is the only place it is applied,
and `QualityManager` can ask for exactly one bounded step down and nothing else.

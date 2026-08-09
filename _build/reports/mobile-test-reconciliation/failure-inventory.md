# Failure inventory — every failing test on CURRENT HEAD, before anything was changed

Captured **before** a single test or source file was edited, which is the whole
point of it: a classification written after the repair is a description of the
repair.

| | |
|---|---|
| Commit | `cab906d` — `docs: the continuation, measured on a tree that had moved underneath it` |
| Branch | `phase-9-continuation-portal-analytics` |
| Working tree | clean apart from `.claude/settings.local.json`, untracked reports and untracked `experiments/.tmp-*` probes |
| Build | `npm run clean:validate && npm run build && npm run build:full`, exit 0 |
| Node | v24.18.1 · npm 11.16.0 · Playwright 1.62.1 |
| Machine | macOS 26.6, arm64, 10 cores (4 performance + 6 efficiency) |
| Workers | `npm test` — Playwright default (5 locally). `test:full` — 1, from the config |
| Locale | `hu` throughout. `/index.html` for `npm test`; `/experiments/stratos-ascent-full/` for `test:full` — that route has one shell and it is Hungarian |

## The two totals, measured

```
npm test              987 collected · 115 skipped · 864 passed ·  8 failed  (10.4m)
npm run test:full     185 collected ·  97 skipped ·  57 passed · 31 failed  (44.5m)
```

Both reproduce the continuation report's numbers exactly.

---

## 0 · What CURRENT HEAD actually renders on portrait mobile

Established from the source before any test was read, because the brief is
explicit that the report's explanation is not evidence.

`experiments/src/full/main.tsx` forks **once**, in a `useState` initialiser:

```tsx
function Homepage() {
  const [mobile] = useState(isMobileHomepage);
  return mobile ? <MobileHome /> : <FullAscent />;
}
```

`isMobileHomepage()` (`mobile/device.ts`) requires `(pointer: coarse)` **and** a
`screen` short edge ≤ 540 CSS px. Neither can change while the page is open, so
a rotation, a toolbar collapse or a resize cannot retake the decision.

Both the production homepage (`/`, `/en/`, `/de/`) and the benchmark route
`/experiments/stratos-ascent-full/` mount that same `main.tsx`. **A phone gets
`MobileHome` on both.**

What `MobileHome` is, item by item against the brief's checklist:

| Question | Answer on CURRENT HEAD |
|---|---|
| SVG Altimeter? | Only as the **failure path**. `MobileAltimeter` renders `MeridianDrawing` when `hasWebGL()` is false or the scene throws |
| Real GLB Altimeter? | **Yes** — `mobile/MobileInstrument.tsx`, `models/stratos-altimeter.glb`, the same file the desktop scene loads |
| WebGL instrument-only scene? | **Yes** — one GLB, one camera, four lights, a baked PMREM probe, `frameloop="demand"` |
| No WebGL at all? | No. WebGL is present, and it is one canvas |
| Native document flow? | **Yes** — eleven ordinary `<section>` elements inside `.mv-flow`. No sticky, no track, no spacer |
| Short sticky regions? | **None.** `grep` finds no `position: sticky` in the portrait composition's path |
| Typography IntersectionObserver reveals? | **Yes** — `mobile/reveal.ts`, one observer, `unobserve` on intersect, CSS transitions |
| Shared altitude/progress state? | **Yes** — `mobile/ascent.ts`: one passive `scroll` listener, rAF-coalesced, cached band geometry, **no damping**. The telemetry strip, the instrument and the shared site header are all subscribers |

What is **gone** from the portrait path: the WebGL journey scene, the terrain
GLB and its DRACO decoder, GSAP ScrollTrigger, the sticky `journey__track`, the
`.journey__stage`, the `altitude-hud` strip with its `data-meridian` attribute,
the damped `journey.advance` clock, the exclusion band, and the calibration pass
that fed measured panel positions back into the altitude curve.

The desktop composition keeps every one of them, untouched.

---

# Part 1 — the journey suite: 31 failures

30 are the same **ten** tests repeated across `mobile-390`, `mobile-430` and
`mobile-375`. The 31st is one desktop test. Every portrait failure is the same
shape: **an element the old portrait architecture had, which the current one
does not**.

Viewport column: the projects as they were configured on `cab906d` —
`mobile-390` = iPhone 13 (390×664, WebKit), `mobile-430` = iPhone 14 Pro Max
(430×740, WebKit), `mobile-375` = iPhone SE at 375×667 (WebKit).

---

### J1 · `the journey renders › the altitude climbs the whole way and reaches exactly 30 000 m`

| | |
|---|---|
| File | `experiments/tests/full-ascent.spec.ts:201` |
| Viewport | mobile-390, mobile-430, mobile-375 |
| Exact assertion | `page.getByTestId('altitude-value').textContent()` inside `readAltitude`, then `expect(...).toBe(30_000)` |
| Observed | `Test timeout of 120000ms exceeded. locator.textContent: waiting for getByTestId('altitude-value')` — the element does not exist |
| Expected | A HUD readout printing metres, climbing monotonically to exactly 30 000 |
| Architectural assumption | The portrait page mounts `JourneyHUD`, whose `altitude-value` is driven by a damped, ScrollTrigger-fed clock |
| Assumption still exists? | **No.** `JourneyHUD` is desktop-only. Portrait publishes one readout, `data-testid="mobile-altitude"`, written from undamped `scrollY` |
| User requirement still exists? | **Yes.** The ascent must start on the ground, climb with the document and arrive at 30 000 m |
| Classification | **STALE IMPLEMENTATION ASSUMPTION** (mechanism) wrapping a **VALID REQUIREMENT** |
| Remediation | Requirement restated against the portrait readout in `portrait-journey.spec.ts` → `portrait — the ascent › starts on the ground, never runs backwards, and arrives at the ceiling`. The `altitude-value` assertion is removed from the portrait projects and kept on desktop |

---

### J2 · `the altitude clock is independent of the render loop › keeps time while the tab is hidden and the canvas is parked`

| | |
|---|---|
| File | `experiments/tests/full-ascent.spec.ts:279` |
| Viewport | all three portrait |
| Exact assertion | `expect(after).toBeGreaterThan(before)` on `altitude-value`, having forced `document.visibilityState = 'hidden'` and back |
| Observed | 120 s timeout waiting for `altitude-value` |
| Expected | The readout keeps advancing while the R3F frameloop is parked |
| Architectural assumption | Two clocks exist and one can be parked: a scene frameloop, and a separate rAF clock inside `JourneyHUD` |
| Assumption still exists? | **No.** There is no second clock on portrait. `ascent.ts` reads `scrollY`; the instrument is one of its subscribers and owns nothing |
| User requirement still exists? | **In its general form, yes** — the readout must not die with the renderer. The specific hidden-tab variant does not: it existed to prove the HUD's own rAF was not the scene's, and on portrait there is no rAF to park |
| Classification | **STALE IMPLEMENTATION ASSUMPTION** |
| Remediation | The general requirement is asserted, harder, by `portrait — the ascent › the readout is not owned by the renderer`, which destroys the WebGL context outright and then requires the readout to still reach 30 000 m. The hidden-tab variant is not restated, and this is why |

---

### J3 · `the altitude clock is independent of the render loop › reaches the ceiling even if the canvas never renders again`

| | |
|---|---|
| File | `experiments/tests/full-ascent.spec.ts:305` |
| Viewport | all three portrait |
| Exact assertion | `expect(await readAltitude(page)).toBe(30_000)` after `WEBGL_lose_context.loseContext()` |
| Observed | 120 s timeout waiting for `altitude-value` |
| Expected | Losing the context does not stop the clock |
| Architectural assumption | `altitude-value`; and that the page keeps a canvas after a context loss |
| Assumption still exists? | The **element** does not. The requirement does |
| User requirement still exists? | **Yes** |
| Classification | **VALID REQUIREMENT, WRONG TEST MECHANISM** |
| Remediation | Restated verbatim in intent against the portrait readout — same `loseContext()`, same 30 000 m assertion — plus two assertions the old test could not make: the slot must land on the SVG drawing rather than go blank, and the document must be intact |

---

### J4 · `the content survives without the canvas › every stage, case study and process step is real HTML`

| | |
|---|---|
| File | `experiments/tests/full-ascent.spec.ts:324` |
| Viewport | all three portrait |
| Exact assertion | `expect(page.locator('a.skip')).toHaveAttribute('href', '#journey-content')` |
| Observed | `Received: "#mv-content"` — the element resolves, the value differs |
| Expected | The skip link points at `#journey-content` |
| Architectural assumption | The portrait page's content wrapper is `#journey-content` |
| Assumption still exists? | **No.** `MobileHome` names its content wrapper `#mv-content` and its skip link points there |
| User requirement still exists? | **Yes, and it is one of the four the previous audit refused to skip** |
| Classification | **VALID REQUIREMENT, WRONG TEST MECHANISM** |
| Remediation | The skip link becomes a behavioural check rather than a string match: it must exist, be a fragment, resolve to an element that is **in the document**, have a non-zero box, and **contain the first chapter**. That is the property; `#journey-content` was one implementation of it. The rest of the test — eleven chapters, three case studies, seven checkpoints — is carried over and, importantly, now actually runs: on `cab906d` it never reached line 331, because the skip-link assertion failed first. **None of the content assertions in this test had ever been evaluated on portrait.** |

---

### J5 · `capability fallbacks › falls back to the static instrument when WebGL cannot be created`

| | |
|---|---|
| File | `experiments/tests/full-ascent.spec.ts:466` |
| Viewport | all three portrait |
| Exact assertion | `expect(page.getByTestId('journey-fallback')).toBeVisible()` with `getContext('webgl*')` returning `null` |
| Observed | `element(s) not found` |
| Expected | `JourneyFallback` with `data-reason="no-webgl"`, plus a visible `altitude-hud` |
| Architectural assumption | The whole page has one capability fallback, `JourneyFallback`, replacing the scene |
| Assumption still exists? | **No.** Portrait scopes the fallback to the *instrument slot*: `MobileAltimeter` flips `data-mode` to `fallback` and renders `mobile-altimeter-svg`. There is no page-level fallback because there is no page-level scene to fall back from |
| User requirement still exists? | **Yes** — no WebGL must still give a working instrument, and must not download a renderer |
| Classification | **VALID REQUIREMENT, WRONG TEST MECHANISM** |
| Remediation | `portrait — the instrument › no WebGL falls back to the drawing, and downloads no renderer`, which asserts the mode attribute, the drawing being visible, **no `.glb` and no `MobileInstrument` chunk in the request log**, and — beyond what the old test asked — that the drawing actually tracks the ascent rather than being a static placeholder |

---

### J6 · `the sticky handoff into the final CTA › the CTA arrives over the scene, with no gap and no footer collision`

| | |
|---|---|
| File | `experiments/tests/full-ascent.spec.ts:574` |
| Viewport | all three portrait |
| Exact assertion | `expect(geometry.stageBottom).toBeGreaterThan(0)` where `stageBottom` comes from `.journey__stage` |
| Observed | `Matcher error: received value must be a number... Received has value: null` — `.journey__stage` does not exist |
| Expected | A sticky stage still behind the CTA at the end of the track |
| Architectural assumption | A sticky container holding eleven panels including the closing CTA |
| Assumption still exists? | **No.** There is no sticky container on portrait; the closing chapter is the last block in ordinary flow |
| User requirement still exists? | **Partly.** "The scene is still behind the CTA" is a statement about a composition that a phone does not get. "The closing action is at the end, on screen, and big enough to press, with no blank band before it" is the part that was ever about the visitor |
| Classification | **STALE IMPLEMENTATION ASSUMPTION**, with a **VALID REQUIREMENT** inside it |
| Remediation | The visitor-facing half becomes `portrait — the content › the closing action is reachable, tappable and last`. The sticky half is not deleted — it is **retargeted to the composition that has a sticky container**, the `desktop` project, where it had never run |

---

### J7 · `the sticky handoff into the final CTA › scrolling to the very end is not trapped and does not jump`

| | |
|---|---|
| File | `experiments/tests/full-ascent.spec.ts:626` |
| Viewport | all three portrait |
| Exact assertion | `page.evaluate(...)` reading `track.offsetHeight` from `[data-testid="journey-track"]` |
| Observed | `TypeError: null is not an object (evaluating 'track.offsetHeight')` |
| Expected | The sticky stage does not jump mid-handoff, and the document ends |
| Architectural assumption | A `journey-track` element with a measurable travel |
| Assumption still exists? | **No** |
| User requirement still exists? | **Yes, and it is the third of the four the previous audit refused to skip** |
| Classification | **VALID REQUIREMENT, WRONG TEST MECHANISM** |
| Remediation | `portrait — the document does its own scrolling › the document ends, and nothing takes the scroll back`, which is a stronger statement of the same thing: the bottom is reachable to within 2 px, the position is **still there 1.2 s later**, and one jump back to the top lands at exactly 0 |

---

### J8 · `Altimeter Meridian — as the visitor gets it › scrolling down and back up returns the instrument to its 0 m baseline`

| | |
|---|---|
| File | `experiments/tests/full-ascent.spec.ts:1163` |
| Viewport | all three portrait |
| Exact assertion | `page.getByTestId('altitude-hud').evaluate(el => el.dataset.meridian)` |
| Observed | 120 s timeout waiting for `altitude-hud` |
| Expected | `data-meridian === 'baseline'` and `altitude-value === '0'` after a round trip |
| Architectural assumption | A HUD publishing the instrument's structural state as `data-meridian`, and a damped clock that has to be given 2.6 s to settle |
| Assumption still exists? | **No.** Portrait has no `altitude-hud`, and nothing to settle — there is no damping, so the readout is exact in the frame the scroll lands |
| User requirement still exists? | **Yes** — the ground state must be reachable after any amount of scrolling |
| Classification | **VALID REQUIREMENT, WRONG TEST MECHANISM** |
| Remediation | Folded into `portrait — the ascent › starts on the ground, never runs backwards, and arrives at the ceiling`, whose last two assertions are exactly this round trip — and which can assert `toBe(0)` rather than "settles near 0", because there is no damper to wait for |

---

### J9 · `Altimeter Meridian — as the visitor gets it › the altitude climbs continuously, with no stage boundary that stalls it`

| | |
|---|---|
| File | `experiments/tests/full-ascent.spec.ts:1196` |
| Viewport | all three portrait |
| Exact assertion | `expect(metres).toBeGreaterThan(previous)` on `altitude-value` over 21 samples |
| Observed | 120 s timeout waiting for `altitude-value` |
| Expected | No stage boundary at which a screen of scrolling moves the altitude by nothing |
| Architectural assumption | `altitude-value`; and stage bounds derived from a calibration pass that could fail to tile the track |
| Assumption still exists? | The element does not. The failure mode does not either: portrait interpolates between *anchors* derived from measured section tops, which tile by construction |
| User requirement still exists? | **Yes** |
| Classification | **VALID REQUIREMENT, WRONG TEST MECHANISM** |
| Remediation | Same replacement as J1 — the monotonic walk is nine sampled fractions with a `toBeGreaterThanOrEqual` on each, plus the exact ceiling |

---

### J10 · `Altimeter Meridian — as the visitor gets it › the structural stages are announced in order, and unwound in reverse`

| | |
|---|---|
| File | `experiments/tests/full-ascent.spec.ts:1224` |
| Viewport | all three portrait |
| Exact assertion | `expect(page.getByTestId('altitude-hud')).toHaveAttribute('data-meridian', 'baseline')` |
| Observed | `element(s) not found` |
| Expected | Six instrument states announced in order and in reverse |
| Architectural assumption | The Meridian's six **mechanical** states — baseline, calibration, aperture, ring locks, meridian — published by the HUD |
| Assumption still exists? | **No.** The portrait instrument performs none of the Meridian's structural theatre: the rings do not lift, the case does not open, the aperture does not iris. There are no six states to announce |
| User requirement still exists? | **Yes, and it is the fourth of the four the previous audit refused to skip** — but as *content chapters*, not instrument states. Portrait announces the eleven narrative chapters through `mobile-stage`, an `aria-live="polite"` region |
| Classification | **STALE IMPLEMENTATION ASSUMPTION** (six mechanical states) wrapping a **VALID REQUIREMENT** (chapters announced in order) |
| Remediation | `portrait — the content › the chapters are announced in reading order, and unwound in reverse`, recorded by a `MutationObserver` in the page exactly as the old test did, asserted against all eleven `STAGES` labels forwards and reversed. The sweep steps in **pixels** — less than half a viewport — rather than in fractions of the document, so no chapter can be stepped over on the tallest viewport in the matrix |

---

### J11 · `the build keeps the renderer lazy › three.js is absent from the eager entry and never preloaded` — the one desktop failure

| | |
|---|---|
| File | `experiments/tests/full-ascent.spec.ts:505` |
| Viewport | desktop 1440×900 |
| Exact assertion | `const scene = files.find(f => f.startsWith('JourneyScene')); expect(sceneCode.includes('WebGLRenderer')).toBe(true)` |
| Observed | `Expected: true, Received: false`, in 85 ms. Assertions 1, 2, 3 and 5 in the same test all pass |
| Expected | The chunk whose filename starts `JourneyScene` contains `WebGLRenderer` |
| Architectural assumption | three.js lives in the `JourneyScene` chunk |
| Assumption still exists? | **No.** Measured in `dist/experiments/stratos-ascent-full/assets`: `full-*.js` (eager) 0 hits, `JourneyScene-*.js` 0 hits, **`Gltf-*.js` 5 hits**, `MobileInstrument-*.js` 0. The desktop scene and the portrait instrument both need three.js, so Rollup hoisted it into their common ancestor. That is the correct outcome and better than duplicating 876 KB |
| User requirement still exists? | **Yes** — three.js must exist, must be lazy, and must not be in the eager entry. All three are still true |
| Classification | **VALID REQUIREMENT, WRONG TEST MECHANISM** — the assertion names a filename where it means a property |
| Remediation | Assert the property: **some** emitted chunk that is not the eager entry contains `WebGLRenderer`. Assertions 1–3 already prove it is not eager and not preloaded; this one exists only so those cannot pass by three.js being nowhere at all, and it does that job without naming a chunk |

---

## Two tests that were passing on portrait without asserting anything

Found while reading the suite, and recorded because a green test that asserts
nothing is worse than a red one.

* **`the sticky handoff into the final CTA › no canvas/text overlap and no viewport overflow at any stage`** (`:664`) walks all eleven stages, then queries `.panel__inner` and `.hud`. Neither exists on portrait, so both `querySelectorAll` calls return empty, `bad` is `[]`, and the test passes having measured nothing. It cost ~20 s per portrait project to do it.
* **`the journey renders › the rendered scene changes between every act`** (`:228`) passes on portrait because `MobileHome` does have a canvas — the instrument — and its needles move. The assertion "the journey is driving the scene" is not what is being confirmed.

Both are resolved by the split: `full-ascent.spec.ts` is no longer collected by
the phone projects at all, and the portrait file asserts overflow and the
instrument directly.

---

# Part 2 — the deterministic suite: 8 failures

All eight are in `tests/homepage-chrome.spec.ts`. **Zero are in any Phase 9
suite** — analytics, attribution, consent, structured data, 404, forms, the lead
endpoint, the portal, portal-analytics and lead-notify are all green. Zero are
in `tests/mobile-homepage-simple.spec.ts`, which passes 24/24 on both phone
projects.

Six are on `desktop-1920`; two on `reduced-motion`.

**`reduced-motion` is not a reduced-motion page.** `playwright.config.ts` says
so in its own comment and `tests/public-site.spec.ts:327` asserts it: on
Playwright 1.62.1 the declarative `reducedMotion: 'reduce'` does not reach
`matchMedia()`, so a test in that project which does not call
`enableReducedMotion(page)` renders **the ordinary animated 1440×900 WebGL
homepage**. Neither of the two failing tests in that project calls it. So the
project is, for these two tests, a second desktop-1440 running a full WebGL
journey — which matters for what follows.

| # | Test | Line | Project | Duration | Failure |
|---|---|---|---|---|---|
| D1 | the journey state compacts the wordmark and keeps the header short | 259 | desktop-1920 | 18.8 s | `expect.poll(opacity('.brand__mark'), {timeout: 4000})` never exceeded 0.9 |
| D2 | a single jump lands on the right state, not one short of it | 326 | desktop-1920 | 12.8 s | `header never reached "destination"` — `expect.poll(headerState, {timeout: 12000})` |
| D3 | the full-screen menu opens from every header state | 422 | desktop-1920 | 36.4 s | test timeout; the call in flight was `page.waitForTimeout(120)` inside `scrollToFraction` |
| D4 | focus is trapped inside the layer while it is open | 470 | desktop-1920 | 40.0 s | test timeout inside `for (i<30) page.keyboard.press('Tab')` |
| D5 | opening the menu does not walk the journey back down the mountain | 558 | desktop-1920 | 33.3 s | test timeout |
| D6 | a subpage reached from the homepage carries the same working header | 945 | desktop-1920 | 37.9 s | test timeout |
| D7 | focus is trapped inside the layer while it is open | 470 | reduced-motion | 40.1 s | test timeout inside the same `Tab` loop |
| D8 | a subpage reached from the homepage carries the same working header | 945 | reduced-motion | 40.2 s | test timeout; call log shows `locator.click` **resolved** `<button class="burger" …>` and then hung |

### What they have in common, and it is not an assertion

**Not one of the eight is a failed assertion about the product.** Six are the
30 s per-test budget running out. The two that are assertion failures are
`expect.poll` deadlines — 4 s for a 0.45 s CSS opacity transition (D1), and 12 s
for a header state change (D2).

Every failing call is a **round trip into the page**: a CSS transition
completing, a state class landing, a `waitForTimeout` being serviced, a key
press being delivered, a click being delivered. Nothing in the list is a
computation this process performs.

`aria-expanded`, `pointer-events`, geometry and stacking are **not** implicated:
the D8 call log shows Playwright resolving the burger and then waiting, and the
previous audit's measurements — a byte-identical bounding box over 90
consecutive frames, `getAnimations()` empty, `elementFromPoint` returning the
burger's own child, `click({trial: true})` passing — were reproduced and are
consistent with a page that is *correct but slow to answer*.

| | |
|---|---|
| Provisional classification | **ENVIRONMENT / LOAD SENSITIVITY**, pending proof |
| Why only provisional here | A shared shape is a hypothesis. §10 asks for the input path to be instrumented and §11 for a controlled load matrix, and neither had been run when this inventory was taken |

The investigation, its instrumentation and its verdict are in
[`menu-input-investigation.md`](menu-input-investigation.md). Nothing in the
eight was reclassified on the strength of the table above.

---

## Summary

| Classification | Journey suite | Deterministic suite |
|---|---|---|
| REAL PRODUCT DEFECT | 0 | 0 |
| STALE IMPLEMENTATION ASSUMPTION | J2, and the sticky/six-state halves of J6 and J10 | — |
| VALID REQUIREMENT, WRONG TEST MECHANISM | J3, J4, J5, J7, J8, J9, J11, and the visitor-facing halves of J1, J6, J10 | — |
| ENVIRONMENT / LOAD SENSITIVITY | 0 | D1–D8, pending the investigation |
| UNRESOLVED | 0 | — |

No failure in either suite was classified without the exact assertion, the exact
observed value, and a statement of whether the architecture it names still
exists.

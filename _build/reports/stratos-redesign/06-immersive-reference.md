# Stratos redesign — 06 · Immersive Garden as a reference, and the atmosphere

Date: 2026-10-16 · Branch `redesign/quiet-authority` · follows `05-whole-site.md`.

The owner's brief: study immersive-g.com, the studio they consider the best since 2018;
give our site a similar feeling; carry the stratosphere language — pleasantly in the
background, but felt — inside the clean base. And: use Aboreto for headlines. After review:
"Aboreto is good; take the horizons off; make the paper plane in our logo the cursor." §4
records the state after that review.

Nothing pushed, merged or deployed.

---

## 1. What immersive-g.com does (walked through 2026-10-16, desktop 1440 and phone 375)

| | Observed |
|---|---|
| **Material** | The whole page is one surface: pale grey plaster (#E8E8E8) with a faint marble grain. White relief sculptures — leaves, branches, a hummingbird — grow out of that surface as you scroll. Nothing sits *on* the page; everything is *of* it. |
| **Colour** | None in the interface. Colour exists only inside the work: each project is a window cut into the wall. |
| **Type** | Two faces at very few sizes: a light serif (PS Times, 36–44 px, regular weight, sentence-length lines) and Helvetica Neue at 14 px for UI. No bold, no uppercase interface, no headline stack. |
| **Composition** | One thing per screen. Media and text alternate left/right, small text beside large images, very wide empty margins. |
| **UI** | Only in the corners: "Menu" top right, "See all projects" bottom left, a dot bottom right. The middle of the screen is never interface. |
| **Motion** | Inertial smooth scroll (Lenis) on a virtual page (the document is 900 px tall; the scene is WebGL). Media arrive through a pixel-mosaic dissolve. A loader counts to 100 on every full load. |
| **The dark moment** | The menu: black relief filling the screen, five serif items centred, a crack of white light breaking through one corner. |
| **Archive** | A plain two-column list — category in small grey sans, name in serif. Hover: a hairline under the row, every other row fades, a small preview appears at the side. |
| **Cost** | Homepage ≈ 25 MB (11 MB of 3D models, 3.7 MB of GPU textures, 3.2 MB of JS, WASM, 1 MB of sound, colour-grading LUTs). The phone view was still a blank grey screen after 10 s with 17 MB loaded; every full page load replays the 6 s+ intro. |

## 2. Where the feeling actually comes from

Not from the WebGL. From seven decisions the WebGL serves:

1. **One material that is the page** — a world, not a layout.
2. **A light, literary voice** — regular-weight serif, sentences instead of slogans.
3. **Colour only in the work** — the interface is monochrome so the projects glow.
4. **Emptiness** — one idea per screen; the margins are the luxury.
5. **Slowness** — things arrive, they do not appear.
6. **Light with a source** — relief lit from one side; in the menu, light breaking through.
7. **Corners for UI, the centre for content.**

Our base already does 3, 4 and 7, and part of 5 and 6 (the light system). It lacked 1 and 2:
a world of its own, and a voice that is not a 520-weight grotesque.

## 3. What we take, what we leave

| Take | Leave | Why |
|---|---|---|
| One material that is the page → **the atmosphere** | Plaster, relief, gardens | Theirs. Ours is altitude: air, light, the curve of the Earth. |
| A light, inscriptional voice → **Aboreto headlines** | A serif we do not own | Aboreto is already the brand's face (the wordmark). |
| Arrivals as events → **haze lifting off a screen** | Pixel-mosaic dissolve | Same idea, our weather. |
| The quiet archive list with hover preview | — | Proposed for `/munkaink`'s archive (§6), not built yet. |
| A signature you meet everywhere → **the logo's paper plane as the cursor, turning the way it flies** | A contrail, lag, a loop that never stops | On the pointer, eased only in its turn, idle when the mouse is. |
| — | WebGL scene, smooth-scroll hijack, virtual page, loader, sound | 17–25 MB, a blank phone for 10 s+, and the one channel that brings us clients — search — needs real, fast HTML. The brief's "no mandatory WebGL" stands. |

## 4. What was built

### Site-wide: Aboreto is the headline face

`--font-display` is now Aboreto — exactly the place `type.css` always said the display and
body roles would diverge. Every headline (homepage scenes, subpage `.display` H1/H2, card,
row, case, article and quiz headings) is Aboreto 400 in its unicase capitals, on a smaller
scale with open tracking (monument 36 → 81 px, statement 28 → 58 px, title 22 → 38 px).
Archivo keeps body, UI, labels, every figure (110M Ft, prices, ledgers), FAQ questions and
pull quotes. No layout shift on the swap: headlines carry `text-transform: uppercase` and a
metric-matched `Aboreto Fallback` (Arial at 97.4 %), so the fallback breaks lines where the
webfont will. Details in `02-design-system.md` §2.

### Site-wide: the paper plane is the cursor, and it turns the way it flies

The owner asked twice: the logo's plane as the cursor, then "turn the plane the way I move
the cursor". Two layers:

- **Native** (`system.css`): the chrome plane as a CSS cursor, 32 px with a 2× version,
  hotspot on the nose; over anything clickable it climbs 16° nose-up; fields keep the text
  caret. This is what touch screens (none), reduced motion and a page without script get —
  complete on its own.
- **Turning** (`shell.js`, mouse only): the native cursor is hidden and one 32 px element
  takes its place. Position is written in the event, so the nose is on the pointer; the
  heading eases toward the direction of travel; reversing rolls the plane over so it never
  flies upside down; over clickable things it lifts 1.16×, on press it dips; over a field it
  fades and the caret shows; leaving the window hands back to the native plane. No standing
  loop — frames run only while the turn settles. Nothing is enabled until its image has
  loaded.

Cost: +0.9 kB gzip of script (shell.js 1.75 → 2.62 kB) and one 4.6 kB image. Main thread
≈ 0.9 ms per pointer move on a 4×-throttled CPU (160-move sweep: 146 ms vs 19 ms without
the plane), no long tasks. Checked in Chromium, WebKit and Firefox; a test
(`homepage-shell.spec.ts`, "the cursor") flies it east and west and over a field on every
project, and asserts no element on touch and on reduced motion. The old site's version ran
a frame loop forever, trailed the pointer and painted a canvas contrail; none of that is back.

### Homepage only: what is left of the atmosphere

The horizon under the hero and the Earth's limb in the close were built, reviewed and
**taken off** by the owner. The close is back to its graphite field with the yellow beacon.
Two quiet moves remain, both CSS:

1. **Ascent** — the paper cools by a few levels from the hero's warm ground (#F3F2EE) to the
   thin air above the last scene (#EAEDEC). It is never seen changing; the bottom of the page
   simply feels higher than the top.
2. **Haze** — the GoDataFusion screen arrives out of a veil of the page's own air that lifts
   upward as it is revealed.

Reduced motion: the haze is off; without script the screen is simply there.

## 5. Measured

| Homepage, cold, local | Homepage commit | With horizons | Final |
|---|---|---|---|
| Desktop requests / bytes (raw · gzip) | 14 · 373 KB · 313 KB | 15 · 384 · 317 KB | 17 · 384 · 319 KB |
| Phone (390, 4× CPU, slow 4G) requests | 14 | 15 | 15 |
| Phone LCP | 464 ms | 592 ms | 540 ms |
| Phone main-thread task time | 187 ms | 295 ms | 192 ms |
| CLS, desktop / phone | 0 / 0 | 0 / 0 | 0 / 0 |
| Long tasks · WebGL · canvases | 0 · 0 · 0 | 0 · 0 · 0 | 0 · 0 · 0 |

Desktop's two extra requests are the cursor images (~3–5 kB); phones never load them. (Measured before the turning plane; it adds 0.9 kB of script and no request on top of the 2× image.)
The third is Aboreto's 1 kB ő/ű file, Hungarian only. The horizon was the paint cost — with it
gone, the phone's main thread is back to the homepage commit's figure. The remaining +76 ms of
LCP is Aboreto replacing the fallback in the headline, which is the LCP element; far inside
"good" (< 2.5 s). For comparison, immersive-g.com's phone view had not painted anything after
10 s.

Checks: `fonts:check` (every character covered — Aboreto's subsets carry á é í ó ö ú ü ő ű,
ä ö ü ß), `audit:seo:check` / `ownership` / `conversion` unchanged; no URL, title, heading
text or structured data changed. No sideways scroll at 390, 1440 or 1728 on the homepage or
the seven subpages sampled. Tests: the specs touching the homepage, typography, legibility,
assets and analytics — 455 passed; one FAQ open-state test failed once under load and then
passed 20 of 20 on its own (a timing flake in its "settled" poll, not a regression). Full
suite on that build: 2,207 passed, 12 skipped, 0 failed.

Full suite with the turning plane: 2,211 passed, 12 skipped, 1 failed. The failure was the
lit-card contrast test on mobile-430, which passed 24 of 24 alone: it read contrast while the
card was still fading in. The test now waits for the card to finish arriving, and
`service-route-legibility` + `homepage-shell` pass in full (224). Before the turning plane:
2,208 passed, 0 failed.

Stills (git-ignored): `shots/aboreto/` — `t1-*` Aboreto alone (the final look: the horizons
are gone), `t2-*`/`t3-*` the reviewed horizon versions, kept for the record.

## 6. Next

1. **The menu sheet** — their strongest single moment, translated without a horizon: the
   sheet opens graphite, the five destinations in Aboreto, centred, the beacon as its one light.
2. **The Work archive as their list** — category small and grey, name in Aboreto; on hover a
   hairline, the others fade, a small still appears.
3. **Case-study media** take the haze arrival.

## 7. Open question for the owner

- Aboreto on the long SEO headlines (e.g. Budapest, four lines on desktop): keep, or set the
  local pages' H1 one size down?

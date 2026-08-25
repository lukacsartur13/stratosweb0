# The homepage's Lighthouse scores, and what each number was actually made of

The starting point is a Lighthouse 13.4.1 run against `https://stratosweb1.netlify.app/en/`,
emulated Moto G Power, slow-4G throttling.

| Category | Before | After |
|---|---|---|
| Performance | **46** | **97** |
| Accessibility | **96** | **100** |
| Best Practices | **92** | **100** |
| SEO | **69** | **100** on the production origin — see §5 |
| Agentic Browsing | **1 / 2** | **2 / 2** |

| Metric | Before | After | Budget for 100 |
|---|---|---|---|
| First Contentful Paint | 1.5 s | 1.50 s | < 0.93 s |
| Largest Contentful Paint | 2.3 s | 2.40 s | < 1.2 s |
| Total Blocking Time | 1 470 ms | **9 ms** | < 150 ms |
| Cumulative Layout Shift | 1.013 | **0** | < 0.1 |
| Speed Index | 3.4 s | 1.50 s | < 1.31 s |

## How the "after" column was measured, and why it is not directly comparable

The before column is the deployed site. The after column is the same Lighthouse
version and the same emulation against `dist/` on a local HTTP/1.1 server with
brotli and the `netlify.toml` headers — the harness in the scratchpad, three
runs, median. Two things follow from that, and both matter when reading the
numbers:

* **The local harness reads slower than the deployed host on the paint
  metrics.** Same build, same day, the unchanged site measured 2.41 s FCP
  locally against the deployed 1.5 s, and 4.1 s LCP against 2.3 s — no HTTP/2,
  so five render-blocking resources cost five round trips instead of one
  multiplexed set. Whatever the deployed numbers turn out to be, they should be
  better than these, not worse. The scores were tuned at
  `--throttling.cpuSlowdownMultiplier=20`, which is what reproduces the deployed
  46 on this machine; the default 4× reads far too fast to tell anything apart.
* **The blocking metrics are directly comparable, because they are not the
  network.** TBT and CLS are main-thread and layout facts, and 1 470 ms → 9 ms
  and 1.013 → 0 are the same measurement on both.

## The three points that are left, exactly

`--blocked-url-patterns="*/assets/fonts/*"`, same build, same harness:
**performance 100**, FCP 1.33 s, LCP 1.52 s. So the whole of the remaining gap
is one file — `archivo-normal-latin.woff2`, 88 KB, which is Archivo carrying
both a weight axis (100–900) and a width axis (62–125%). The largest contentful
element on a phone is the opening frame's lead sentence, and it is set in it.

Two things were measured before writing this down rather than guessed at:

* **Dropping the two font preloads makes it worse, not better.** 96, not 97:
  first paint goes from 1.50 s to 2.10 s and the largest paint only improves
  from 2.40 s to 2.33 s. The preloads are earning their priority.
* **A weight-only Archivo would close most of it.** Swapping the same file for
  `Archivo:wght@100..900` — 34,940 bytes against 90,096 — scores **99**, with
  LCP at 1.95 s. That is not a change that can be made by swapping a file,
  though: the width axis is real and used, by the kinetic typography on this
  route and by the `wdth 96` headings on the other 66. Doing it properly means
  two faces — weight-only for body and UI, weight-and-width for display and
  kinetic — and then the display face still has to load, so the measured 99 is
  an upper bound rather than a promise. It is a typography decision, so it is
  written down here rather than taken.

Every change below is in the source tree with its own note; this file is the
argument that connects them, and the record of what was measured rather than
assumed.

---

## 1 · Cumulative Layout Shift: 1.013 → 0

**One shift, worth 1.000 of it**, and it was not a rendering bug. `<main
class="journey">` is React's mount host and is empty in the parsed HTML, so
until the application arrived the document was a header, an Arrival and a
footer — about two thousand pixels standing in for fourteen thousand. The
Arrival therefore *opened inside the first viewport*, painted there, and was
pushed thirteen screens down the moment the journey mounted.

That is also why the largest contentful paint was the Arrival's headline: for
the first two and a half seconds it was the biggest thing the page had.

Fixed by giving the document something to say in that space — see §3 — and, for
the case where it has nothing (the dev server, and the prototype at
`/experiments/stratos-ascent-full/`), by `main.journey:empty { min-height:
100svh }` in `experiments/src/full/styles.css`. A shift that happens off screen
is not a shift.

The remaining 0.013 was three unsized images. `_build/build.py` has stamped
intrinsic dimensions onto every `<img>` for a long time, but the homepage takes
its header and footer through `home-chrome.json` rather than through the page
loop, so it was the one route the pass never ran on. It runs on it now.

## 2 · Total Blocking Time: 1 470 ms → under 100 ms

The longest single task on the deployed page was 839 ms, inside the homepage's
own entry chunk, and three more of 797, 385 and 76 ms inside the GLTF chunk
behind it. That is React, both compositions and three.js, all executing while
the visitor was still waiting for the first screen.

None of it is the journey being slow. It is the journey being *early*: a
scroll-driven ascent through 30 000 m begins when the visitor begins it, and
there is no reading of this page on which a WebGL renderer has to exist before
they have touched it.

So `experiments/src/full/main.tsx` is now an entry that decides *when*, and
`experiments/src/full/boot.tsx` is the journey it imports. The mount happens on
the first `pointermove`, `pointerdown`, `touchstart`, `wheel`, `keydown`,
`focusin` or `scroll` — the first two of which land, on a laptop and a phone
respectively, before the visitor could notice anything missing — and
immediately, with no interaction, when the visitor is already past the opening:
a restored scroll position, a fragment aimed inside the journey, a BFCache
restore.

Two things make that a deferral rather than a delay:

* **The chunks are prefetched at idle.** `journeyChunks()` in
  `vite.home.config.ts` publishes the hashed file names as JSON; the entry turns
  them into `rel="prefetch"` links two seconds after `load`, at the browser's
  lowest priority, so the bytes are usually local before the first move. It
  prefetches the renderer for the composition this device will choose and never
  both, and it opts out entirely on `saveData` and 2G.
* **The entry is 3 KB.** Splitting the mount out took it from 273 KB to 3.13 KB
  (1.53 KB compressed), and moved `mobile.css` out of the render-blocking
  stylesheet with it.

The deferral belongs to the homepage's entry and to nothing else. The prototype
at `/experiments/stratos-ascent-full/` is the fixed baseline the benchmarks
compare against and has no opening frame to wait in front of, so it got its own
four-line entry, `src/full/prototype.tsx`, which imports the same journey
statically and mounts it immediately. A build-time flag was tried first and is
the wrong shape: whichever way it falls, `main.tsx` still contains
`import('./boot')`, and a dynamic import is a chunk boundary in both builds — so
the prototype went on paying a round trip before its mount, and four of its
tests began failing on `.journey__stage` not existing yet. Two entries over one
journey is what actually restores it, and the prototype's bundle is a single
chunk again.

## 3 · The opening frame, and the paint metrics

With nothing in `<main>`, the first screen was blank until React arrived, and
the largest contentful paint was whatever the footer managed in the meantime.

`openingFrame()` in `experiments/vite.home.config.ts` now generates the
document's opening statement into the shell at build time: the headline, the
lead sentence and the primary action, read from the same `MESSAGES` entries and
the same `pageHref` both compositions use, so there is no second copy of the
words to keep in step.

It is deliberately not a prerender of either composition. `main.tsx` chooses
between the portrait and the cinematic page from `screen`'s short edge and the
pointer type, neither of which is knowable at build time — so prerendering one
would be prerendering the wrong one for half the visitors. It is a third thing:
the page's opening statement, set plainly, before it becomes either composition.
`createRoot`'s first commit removes it.

For a visitor with no JavaScript, it is also the first thing this route has ever
had to say.

## 4 · Bytes on the critical path

| | Before | After |
|---|---|---|
| Shared CSS + JS, unminified | 246 KB of source | minified in `dist` only |
| `assets/css/chrome.css` | 36,638 B (9,948 br) | 16,085 B (3,610 br) |
| `assets/js/transitions.js` | 38,516 B (11,077 br) | 5,360 B (1,925 br) |
| Archivo latin-ext | 85,856 B | 5,240 B |
| `assets/img/gdpr.png` | 100,240 B at 1800×1800, drawn at 30 px | 3,343 B at 90×90 |
| Render-blocking stylesheets | 4 requests | 0 — inlined into the shell |

Three of those are worth a sentence each.

**Minification** happens in `scripts/assemble.mjs`, into `dist` only, because
these files are unusually comment-dense on purpose and the source tree is where
that has to stay readable. Roughly a third of the compressed weight of the
render-blocking files was prose addressed to whoever next opens them.

**The fonts.** A scan of every built page in all three languages finds exactly
three characters above U+00FF anywhere in the site's prose: ő, ű and Ű.
Everything usually assumed to be "extended" — the em dash, the thin space, the
Hungarian quotation marks, the ellipsis, the euro sign — is inside the plain
`latin` range. So `latin-ext` was being downloaded, on the English homepage too
(the word "Győr" is in its title), to draw three letters. The files are now
`&text=` subsets and the declared `unicode-range` was narrowed to match.
`scripts/font-coverage.mjs` runs at the end of every build and fails it if any
page contains a character the subset no longer covers — which is how a fourth
character was found: Google's published `latin` range covers U+2191 and U+2193
but not U+2192, so every "→" in nine pages of prose had always been drawn in
Arial beside Archivo. It is in the subset now.

**Inlining** applies to the three homepage shells and to nothing else, because
`chrome.css` and `type.css` are one cache entry across the other 66 routes and
this route's own stylesheet is shared with nobody. `style-src` in `netlify.toml`
already allows inline styles; `script-src` is untouched and still `'self'`.

## 5 · Accessibility, Best Practices, SEO

**Accessibility 96 → 100.** Two failures, both real:

* *Contrast.* `[data-converge] .converge__cta` parked the Arrival's call to
  action at `opacity: .25` until the visitor reached it, which composites to
  #000 on #403c09 — a measured 1.86:1 against the 4.5:1 its 13.6 px label needs.
  The resting opacity is now .52, which clears the threshold on both buttons
  with room for a rounding error (4.87:1 solid, 5.24:1 ghost).
* *Heading order.* The footer's five group headings were `<h4>` under the
  Arrival's `<h2>`. They are `<h3>`; checked against all 72 built pages, none of
  which gains a skip from the change.

**Best Practices 92 → 100.** One console error, on every load, on every route
that draws the Altimeter: drei's `useGLTF` builds a DRACO loader *and* calls
`MeshoptDecoder()` by default, and the latter instantiates WebAssembly from an
inlined base64 string — which `script-src 'self' https://www.googletagmanager.com`
correctly refuses. `models/stratos-altimeter.glb` uses neither extension; its
only extension is `KHR_materials_emissive_strength`, and the DRACO meshes on
this site are the two mountain ranges, which build their own decoder against the
self-hosted `/draco/` copy. Both call sites now pass `false, false`. The
alternative was widening the policy with `'wasm-unsafe-eval'` to fix a
self-inflicted error in a decoder nothing here uses.

**SEO 69.** Not a defect, and deliberately not changed: `scripts/assemble.mjs`
serves `Disallow: /` on any `*.netlify.app` host, so that a staging copy does
not compete with the real site for the same queries. On the production origin
the same build emits the normal `Allow: /` and the category scores 100 —
verified by building with `SITE_URL=https://stratosweb.hu`. Attaching the custom
domain in Netlify fixes the reported number with no code change.

## 6 · What this cost

A visitor who arrives and never moves a pointer, touches the screen or presses a
key sees the opening frame, the Arrival and the footer, and never the journey.
That is the correct outcome for someone who read two sentences and left, but it
is a real difference from before and it is the reason the chunks are prefetched.

The test suite was given the same first move: `bootJourneyOnLoad()` in
`tests/helpers/homepage.ts` arms an init script that dispatches a `scroll` on
`load` — through the production trigger, not around it, because a hook that
bypassed it would prove that a code path nobody ships still works. Nine spec
files arm it; `tests/homepage-opening.spec.ts` deliberately does not, because it
is the one that tests both states either side of the move.

One real defect was found on the way, in `assets/js/home-history.js`, and it was
this file's own: it measured the composition's natural height by *removing* the
reserve and reading `scrollHeight`, which shrinks the document synchronously —
so the browser clamped the restored scroll position during the layout that the
measurement forced, and the next line read the clamped value. That could not
bite while the journey mounted during load, because the real content was always
taller than the reserve by the first resize frame. With the mount deferred it
could, and it did: left at 4 965, came back at the bottom of a 2 000 px
document. It now sums the children's boxes instead, which reads the same number
and changes no style.

Green: 1 268 passed in the default suite, 200 in the prototype suite, 0 failed.

# Rapidkert — mobile motion reference

Audited: 2026-08-08.
Source: `~/Library/Mobile Documents/com~apple~CloudDocs/Downloads/Rapidkert Awwwards`
(the current build, last touched 2026-08-08; the older `Rapidkert web` folder is
the pre-Phase-1 site and was not used as the reference).

This records the *principles* that make that site feel direct on a real phone.
It records no branding and no page design. Everything below was read out of the
files; nothing here is inferred from how the site looks.

---

## 1. What the site actually is

| File | Lines | Role |
|---|---|---|
| `index.html` | 1,256 | One document, hand-written, no framework |
| `rk.css` | 4,440 | The single stylesheet, numbered §01–§33 |
| `rk.js` | 3,404 | Scroll readers, stage controllers, nav, forms |
| `rk-ground.js` | 3,242 | The one WebGL scene (three.js, "Living Ground") |

**No build step. No React. No animation library.** The file header of `rk.js`
states the constraint explicitly: *"No animation libraries. Everything is
IntersectionObserver + one shared rAF scroll loop."*

That is the single most load-bearing fact in this audit, and it is the one that
does not transfer to Stratos for free: Stratos' homepage is React, and every
architectural advantage below follows from the DOM being written directly.

---

## 2. Scroll implementation — native, and only observed

Verified by grep across all four files:

- `scroll-behavior:smooth` on `html` (`rk.css:110`) — CSS only, for fragment
  links; forced to `auto` under reduced motion (`rk.css:877`).
- **Zero** occurrences of `scrollTo`, `scrollTop =`, `wheel`, `touchmove`,
  `overscroll-behavior`, `scroll-snap`, Lenis, or any smooth-scroll shim.
- **One** `addEventListener('scroll', …)` in the entire site — `rk.js:53` —
  and it is `{ passive: true }`.
- `rk-ground.js` registers **no** scroll listener at all. It reads scroll
  position inside its own rAF.

The document scrolls. Nothing interpolates it, continues it, or replaces it.
Every motion on the page is a *function of* the scroll position the browser
already produced.

### The shared loop (`rk.js:32–65`)

```js
var readers = [], ticking = false;
function runReaders() {
  try { for (var i = 0; i < readers.length; i++) readers[i](); }
  finally { ticking = false; }          // a throwing reader must not wedge the page
}
function onScroll() {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(runReaders);     // coalesce to one frame
}
function onFrame(fn) { readers.push(fn); fn(); }   // run once at registration
window.addEventListener('scroll',  onScroll, { passive: true });
window.addEventListener('resize',  onScroll, { passive: true });
window.addEventListener('load',    runReaders);    // synchronous — see below
window.addEventListener('pageshow', runReaders);   // bfcache restore
```

Four details worth copying verbatim:

1. **One listener, N readers.** Every stage, the header, and the WebGL handover
   all register on this. There is no per-component scroll listener anywhere.
2. **`ticking` coalescing.** Multiple scroll events inside one frame collapse to
   a single reader pass.
3. **`try/finally`.** The comment is explicit: without it, one throwing reader
   leaves `ticking` true forever and *every subsequent scroll event is dropped* —
   the page freezes mid-state. This is a real failure mode, not defensive noise.
4. **`load` and `pageshow` call `runReaders()` synchronously, not `onScroll()`.**
   The stated reason: `requestAnimationFrame` does not fire in a tab that is not
   rendering — a background tab, or a bfcache restore — so a resting state must
   never depend on a frame being produced. This is directly relevant to the
   Stratos bfcache requirement.

---

## 3. Text reveals — IntersectionObserver, fire once, then unobserve

`rk.js:110–135`, the whole system:

```js
var revealTargets = document.querySelectorAll('.rise, .mask, [data-reveal]');

if (reduced || !('IntersectionObserver' in window)) {
  revealTargets.forEach(function (el) { el.classList.add('is-in'); });   // instant, visible
} else {
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      e.target.classList.add('is-in');
      io.unobserve(e.target);            // fires once, never re-armed
    });
  }, { rootMargin: '0px 0px -12% 0px', threshold: 0.08 });

  revealTargets.forEach(function (el, i) {
    if (!el.style.getPropertyValue('--d')) {
      var idx = +(el.dataset.stagger || 0);
      if (idx) el.style.setProperty('--d', Math.min(idx * 0.09, 0.55) + 's');
    }
    io.observe(el);
  });
}
```

Points that matter:

- **One observer for the whole page**, not one per component.
- **`unobserve` on fire.** No reverse animation on scroll-back, ever. The
  observer's working set shrinks to zero as the visitor descends.
- **Threshold `0.08`, `rootMargin` bottom `-12%`.** The element must be 8%
  visible *and* 12% above the bottom edge — so a reveal starts when the element
  is genuinely entering the reading area, not the instant its first pixel
  crosses the fold.
- **Stagger is a CSS variable (`--d`), capped at 0.55s.** `Math.min(idx * 0.09,
  0.55)` — 90 ms per sibling, and the cap is annotated *"so nothing feels
  slow"*. After the class lands, JS is finished; CSS owns the animation.
- **Reduced motion and no-IO both resolve to visible immediately.** Not hidden,
  not degraded — `is-in` is simply applied to everything up front.

### The reveal CSS (`rk.css:344–363`)

```css
:root{
  --ease:     cubic-bezier(.22,.61,.36,1);
  --ease-out: cubic-bezier(.16,1,.3,1);
}

/* body-level rise */
.rise{
  opacity:0; transform:translateY(18px);
  transition:opacity   .8s var(--ease-out) var(--d,0s),
             transform .8s var(--ease-out) var(--d,0s);
}
.rise.is-in{ opacity:1; transform:none }

/* line-by-line headline */
.revline{ overflow:hidden; display:block }
.revline > span{
  display:block; transform:translateY(102%);
  transition:transform 1.05s var(--ease-out) var(--d,0s);
}
.is-in .revline > span{ transform:none }

/* image mask */
.mask{ clip-path:inset(100% 0 0 0); transition:clip-path 1.15s var(--ease-out) }
.mask > img{ transform:scale(1.09); transition:transform 1.5s var(--ease-out) }
```

**Measured timings — these are the proven numbers the brief asked for:**

| Role | Transform | Duration | Easing |
|---|---|---|---|
| Body / generic rise | `translateY(18px) → 0` + opacity | **0.8 s** | `cubic-bezier(.16,1,.3,1)` |
| Headline line reveal | `translateY(102%) → 0`, masked | **1.05 s** | `cubic-bezier(.16,1,.3,1)` |
| Image mask | `clip-path:inset(100% 0 0 0) → 0` | **1.15 s** | `cubic-bezier(.16,1,.3,1)` |
| Image inner scale | `scale(1.09) → 1` | **1.5 s** | `cubic-bezier(.16,1,.3,1)` |
| UI / hover / nav | various | `--dur-fast` | `cubic-bezier(.22,.61,.36,1)` |
| Stagger step | — | **0.09 s**, capped 0.55 s | — |

Only **three** `cubic-bezier` curves exist in 4,440 lines of CSS, and only two
of them do reveal work. `--ease-out: cubic-bezier(.16,1,.3,1)` is the site's
signature curve — it is very close to the brief's suggested
`cubic-bezier(0.22,1,0.36,1)` but lands harder and settles flatter.

> **Note on the brief's numbers.** §6 proposes 600–850 ms with
> `cubic-bezier(0.22,1,0.36,1)`. Rapidkert's proven equivalent is **800 ms with
> `cubic-bezier(.16,1,.3,1)`** and a **larger** headline travel (102% of the
> line box, masked) than the proposed 18–32 px. The 18 px figure in the brief
> matches Rapidkert's *body* rise exactly. Recommend adopting Rapidkert's split:
> 18 px / 0.8 s for copy, full-line-box masked travel / 1.05 s for headlines.

Reduced motion (`rk.css:885–892`) resolves every reveal to its final state with
`!important`, and disables the decorative pseudo-elements outright.

---

## 4. Continuous stages — one progress number, CSS does the rest

`rk.js:1707–1722` is the design statement for the whole lower page:

> *ONE READER. Every stage here registers on the shared rAF loop at the top of
> this file — the same one the header uses. There is no second scroll listener,
> no rAF of its own, no animation library and no continuous loop: when the
> visitor stops scrolling, this costs nothing.*

Mechanically:

```js
function travel(pin, stage, key) {          // one rect read per stage per frame
  var r = pin.getBoundingClientRect();
  var span = r.height - stage.offsetHeight;
  if (span <= 0) return r.top <= 0 ? 1 : 0;
  return clamp(-r.top / span, 0, 1);
}

function write(el, prop, v) {               // dirty-check before every write
  if (el.__w !== v) { el.__w = v; el.style.setProperty(prop, v); }
}
function toggle(el, cls, on) {
  if (el.classList.contains(cls) !== on) el.classList.toggle(cls, on);
}

function idle(pin) {                        // off-screen stages cost nothing
  var r = pin.getBoundingClientRect();
  return r.bottom < -200 || r.top > window.innerHeight + 200;
}
```

Every stage reader begins `if (idle(pin) && !forced) return;`.

The four techniques, in order of how much they matter:

1. **Publish one number, compose in CSS.** A stage writes `--q` and *nothing
   else*; the entire composition is authored as `calc()` off that variable. One
   custom-property write per frame drives dozens of elements.
2. **Dirty-check every write** (`write`, `toggle`). A style write that sets the
   same value still costs style recalc. `el.__w` caches the last value on the
   node.
3. **Early-out when off screen** (`idle`), with a ±200 px margin.
4. **Read rects, never write-then-read.** All reads happen at the top of a
   reader; all writes after. No forced reflow inside the loop.

### The honest finding about sticky pinning

Rapidkert **does** use long sticky runs, including on mobile:

```
.brg__run{height:230svh}   →  210svh below 1024
.fld__run{height:340svh}   →  300svh
.lyr__run{height:330svh}   →  280svh
.asm__run{height:300svh}   →  260svh
.prf__run{height:300svh}   →  260svh
.gd__scroll{height:760svh} →  640svh @1024, 600svh @860
```

Only **three** `position:sticky` declarations exist in the file — the stages are
pinned, not duplicated.

This matters for the Stratos brief. §3–§5 attribute the mobile problem to
sticky pinning and long stages, and Rapidkert is evidence that those are *not*
by themselves what makes a page feel heavy: this site pins a 340 svh stage on a
phone and still feels direct. What Rapidkert never does is:

- run scroll work through React state,
- measure layout and feed the measurement back into layout,
- keep more than one progress source,
- write styles it has not first checked are different,
- keep an animation loop alive when nothing is on screen.

The Stratos reset can still go native-flow — that is the user's decision, it is
simpler, and simpler is defensible on its own. But the *cause* to fix is the
per-frame React/measurement loop, not the existence of sticky. Removing sticky
while keeping a measurement feedback loop would not buy the smoothness.

---

## 5. WebGL — kept, but budgeted

Rapidkert renders three.js **on phones**, which is worth stating plainly since
the Stratos brief removes terrain from portrait entirely.

`rk-ground.js:79–80`:
```js
if (coarse || w < 760 || cores <= 4 || mem <= 2) return 'low';
```

Quality tiers off `pointer:coarse`, viewport width, `hardwareConcurrency` and
`deviceMemory` — a phone is always `low`.

`rk-ground.js:3156`:
```js
if (!reduced || resized || p !== lastDrawn) { /* draw */ }
```
The renderer skips the draw entirely when scroll progress has not changed. Under
reduced motion this makes the scene *genuinely idle*, not merely slow.

The loop is also stopped by an IntersectionObserver once the canvas leaves the
viewport (`rk.js:1716` refers to this).

Two further deliberate choices:

- **`will-change` is used 12 times, and its absence is documented once.**
  `rk.css:2910` explains that `will-change:transform` pins a composited layer's
  raster scale, so a plate rasterised small and scaled up 3.6× became the
  softest image on the page. It was removed there on purpose. `will-change` is
  not a free win and Rapidkert treats it as a per-case decision.
- **The DOM field explicitly is not a second canvas** (`rk.js:1868–1873`): seven
  perspective plates move with *one* transform on *one* element, "at this
  fidelity a canvas would buy nothing and cost a permanent render loop."

---

## 6. Viewport units

`svh` is used 57 times and `vh` 83 times. Every pinned stage height, every
sticky frame and every translate in svh uses **`svh`, not `vh` or `dvh`**:

```css
.gd__frame{ position:sticky; top:0; height:100svh; overflow:hidden }
```

`svh` is the *small* viewport height — the size with Safari's toolbars
**expanded**. Choosing it means the layout is computed against the smaller of
the two states, so when the toolbar collapses the stage does not resize and
nothing reflows. `dvh` would resize continuously during the toolbar transition;
`vh` would be too tall while the toolbar is showing. This is the whole answer to
the brief's §26 "Safari chrome — no layout jump" test.

---

## 7. Reduced motion

`var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;`
read **once**, at module top, and threaded through every module. Under reduced
motion:

- reveals resolve to `is-in` immediately (JS) and to final state with
  `!important` (CSS §20);
- scroll readers **do not register at all** — `if (still) return;` before
  `onFrame(...)`. The comment: writing inline transforms onto a page that is
  deliberately not moving would only fight the stylesheet;
- but each stage is still **mounted once at an authored point of its own run** —
  *"a drawing that is never constructed is not a stilled composition: it is a
  hole"*;
- the WebGL clock is frozen at a fixed `t = 3.2` rather than slowed;
- pointer parallax is skipped entirely (`if (!coarse && !reduced)`).

The principle: reduced motion is **stilled, not absent**. Nothing disappears.

---

## 8. Deterministic state addressing

Both `rk.js` and `rk-ground.js` accept a URL parameter that freezes a stage:

```
?stage=fld:.92
?stage=lyr:.5,asm:.8
RK_STAGE.set('prf', .9)   /  RK_STAGE.free()
```

`RK_STAGE.set` runs the readers **synchronously**, which the README notes is the
only way to drive them in a tab that is not producing animation frames. It is
dead code without the parameter (the map is empty; the lookup is one property
read per stage per frame).

Stratos already has an equivalent in `__stratos`, and it should be kept for the
new mobile path — capture scripts that infer state instead of setting it
photograph whatever they guessed.

---

## 9. Principles to carry into the Stratos mobile reset

Ranked by expected impact on how the page feels in the hand:

1. **Never route scroll through React state.** Rapidkert's smoothness is
   inseparable from the fact that a scroll frame touches zero framework code.
   Whatever survives in the Stratos mobile path must write DOM directly (refs +
   `style.setProperty`), never `setState`.
2. **One passive scroll listener, one rAF, `ticking` coalescing, `try/finally`.**
3. **IntersectionObserver + `unobserve` for every discrete text reveal.** One
   observer for the page. CSS transitions do the animating.
4. **Dirty-check every style write.** `if (el.__w !== v)`.
5. **Early-out off-screen stages** with a ±200 px margin.
6. **Publish one progress number per stage; compose in CSS `calc()`.**
7. **`svh` everywhere** for stage and sticky heights — this is the Safari
   toolbar fix.
8. **Reduced motion: read once, don't register readers, resolve to composed
   state, keep everything visible.**
9. **Run readers synchronously on `load` and `pageshow`**, not through rAF.
10. **`will-change` is a per-case decision, not a default.**
11. **Cap stagger** (90 ms/step, 0.55 s total).
12. **No reverse animation on scroll-back.**

### Timings to adopt

```css
--ease-reveal: cubic-bezier(.16,1,.3,1);

heading line   translateY(102%) masked   1.05s
copy rise      translateY(18px)          0.80s
label          opacity + small offset    ~0.45s  (site's --dur-fast band)
stagger        0.09s/step, max 0.55s
```

### What is not transferable

- Rapidkert has no framework; Stratos' homepage is React. The equivalent
  discipline is: React renders the tree **once**, and all motion after that is
  refs + CSS variables.
- Rapidkert keeps its WebGL scene on mobile at a `low` tier with a
  skip-if-unchanged draw. Stratos is removing terrain from portrait by explicit
  instruction — that is a stronger version of the same budget, not a conflict.
- Rapidkert's long sticky runs work because nothing else in the frame is
  expensive. Do not read this audit as licence to keep the Stratos stage-flow
  system; it is only evidence that sticky was never the root cause.

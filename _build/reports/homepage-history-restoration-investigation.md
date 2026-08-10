# Why the homepage did not come back where you left it

Instrumentation first, implementation second. §8 of the final hardening brief
forbids guessing the cause, so nothing was changed until the lifecycle had been
recorded — and the recording turned out to contradict two of the three
hypotheses the brief lists as likely.

Probe: `experiments/probe-history-restoration.mjs`
Raw data: `_build/reports/homepage-history-restoration-before.json`,
`_build/reports/homepage-history-restoration-after.json`

---

## 1. What was instrumented, and how

The instrumentation is installed with Playwright's `addInitScript`, so it is in
place **before any page script on the restored document runs**. That window is
the only one in which anything interesting happens: every reading below is from
the first 150 ms of the restored page.

| Recorded | How | Why it had to be this and not a sample |
|---|---|---|
| `history.scrollRestoration` | read at document-script time and again at `load` | a single reading cannot distinguish "never set to manual" from "set to manual and set back" |
| every programmatic scroll | `scrollTo`, `scroll`, `scrollBy`, `Element.prototype.scrollIntoView` and the `scrollTop` setter all wrapped, each call recorded with its stack | this is the only way to tell "the application scrolled the page" from "the browser did". No amount of position sampling can separate them |
| `scrollY` and `scrollHeight` | one sample per animation frame, kept only when either changed | a restore that lands and is then undone looks nothing like one that never lands, and both were live candidates |
| lifecycle | `DOMContentLoaded`, `load`, `pageshow` (+`persisted`), `pagehide`, `popstate`, composition mount | dated on the same clock as the samples so the sequence is readable rather than inferred |

Arms: the portrait homepage (390×844), the desktop homepage (1440×900), and
`/rolunk.html` at 390×844 as the control — a generated static route with its
full height in the parsed HTML. Three trials each, Chromium and WebKit.

---

## 2. The recorded sequence

The brief asks for a timestamped sequence covering initial load → scroll to a
known Y → internal navigation → Back → `pageshow` → first restored scrollY →
initialization → final scrollY. Steps 1–4 are the probe's own driving and are
identical in every arm: load, wait 2 500 ms for the document to reach full
height, `scrollTo(6400)`, confirm, navigate to `/impresszum.html`, `goBack()`.
Everything below is from step 5 onward.

### 2.1 Chromium, portrait 390×844 — BEFORE

```
  22 ms  DOMContentLoaded, load, pageshow      persisted: false
  22 ms  scrollY = 1528   scrollHeight = 2372   ← first restored position
  43 ms  scrollY = 13352  scrollHeight = 14197  ← final
         history.scrollRestoration = "auto" at script time AND at load
         programmatic scrolls: NONE
         left at 6468, landed at 13352, error 6884
```

### 2.2 WebKit, portrait 390×844 — BEFORE

```
  34 ms  scrollY = 1528   scrollHeight = 2372   ← first restored position
  41 ms  DOMContentLoaded, load
  42 ms  pageshow                               persisted: false
  72 ms  scrollY = 13349  scrollHeight = 14193  ← final
         programmatic scrolls: NONE
         left at 6400, landed at 13349, error 6949
```

### 2.3 Chromium, desktop 1440×900 — BEFORE

```
  20 ms  DOMContentLoaded, load, pageshow
  21 ms  scrollY = 794    scrollHeight = 1694   ← first restored position
  41 ms  scrollY = 20895  scrollHeight = 21795
  58 ms  scrollY = 20569  scrollHeight = 21469  ← final
  67 ms  scrollTo([0,0])    from 20569  ┐
  67 ms  scrollTo([0,0])    from 0      ├ ScrollTrigger.refresh()
  67 ms  scrollTo([0,20569]) from 0     ┘
         left at 6400, landed at 20569, error 14169
```

### 2.4 WebKit, desktop 1440×900 — BEFORE

```
  22 ms  scrollY = 794    scrollHeight = 1694   ← first restored position
  29 ms  DOMContentLoaded, load
  31 ms  pageshow
  66 ms  scrollY = 794    scrollHeight = 21793  ← height grew, position did not
 111 ms  scrollY = 794    scrollHeight = 21467  ← final
 124 ms  ScrollTrigger.refresh() saves and restores 794
         left at 6400, landed at 794, error 5606
```

### 2.5 The control — `/rolunk.html`, either engine

```
  28 ms  scrollY = 6400   scrollHeight = 11611
  33 ms  scrollY = 6400   scrollHeight = 11574
         restored, error 0, on 9 of 9 runs
```

---

## 3. What the sequence rules out

The brief lists fifteen things to determine. Each is answered from the recording
rather than from a reading of the source.

| Question | Answer | Evidence |
|---|---|---|
| current `history.scrollRestoration` | `auto` | read at script time in every arm |
| does anything set it to `manual`? | **no** | still `auto` at `load`, every arm, both engines |
| does View Transition logic change scroll? | **no** | zero programmatic scrolls on portrait, where the defect is identical |
| does homepage initialization scroll programmatically? | **no** | as above |
| does altitude/journey initialization write scroll? | **no** | the only calls are ScrollTrigger's refresh, at 67–160 ms |
| does resize/orientation setup write scroll? | **no** | no `scrollTo` from any resize path in any arm |
| does `pageshow` run after Back? | **yes**, at 20–46 ms | recorded in every arm |
| is `event.persisted` true? | **no**, never | see §6 |
| is BFCache used? | **no** in this environment | see §6 |
| does mount change document height before restoration? | **no — the reverse** | the height arrives 20–90 ms *after* the restore |
| do fonts/assets alter layout before/after restore? | after, and immaterially | 21795 → 21469 is the last 1.5% |
| is there a `scrollTo()` after native restoration? | yes, but downstream | ScrollTrigger saves and puts back a position that was already wrong |
| does header/state init change document geometry? | not measurably | `--deck-top` moves tens of pixels, not thousands |
| does restoration work after the DOM reaches final height? | **yes** | the control restores perfectly, and so does the homepage once it has height (§5) |

**Three of the brief's likely categories are eliminated by measurement:** manual
scroll restoration configuration, View Transition scroll interference, and the
application resetting scroll after a native restore. What is left is
document-height instability, and the numbers identify it exactly rather than by
elimination.

---

## 4. The cause

`2372 − 844 = 1528`. `1694 − 900 = 794`.

The first restored position in every failing arm is **exactly
`scrollHeight − innerHeight` at that instant** — the browser clamping a correct
restore into a document that has no room for it.

`<main class="journey" id="main">` is a React mount host and is empty in the
parsed HTML. At first layout the homepage is a header, an Arrival section and a
footer: about 2 400 px on a phone, 1 700 px on a laptop. The browser restores at
that moment, correctly and on time, and 6 400 px clamps to the bottom of what
exists. **The offset is destroyed before the application that would have
justified it has loaded.**

What happens next is the two engines differing about a document that grows
underneath a scroll position, which is why the same defect was reported as two
different ones:

* **Chromium** implements scroll anchoring. The footer — the only content on
  screen — is held in place as fourteen thousand pixels are inserted above it,
  so the clamped position is dragged down with it and ends at the very bottom
  (13 352 of 13 353).
* **WebKit** has no scroll anchoring. The clamped position simply stays where it
  was while the document grows around it (794 of 20 567), a screen from the top.

Both are correct behaviour for their engine. Neither is a mobile problem — the
portrait and desktop compositions fail identically, and the control page with
none of the application in it restores perfectly — which is why the fix is not
in the mobile composition and not in the journey.

The three ScrollTrigger calls are downstream and are not the cause: they save
the current position, refresh, and put back exactly what they saved. They are
recorded here because they are the kind of thing that looks like a cause, and
the timeline shows the position was already wrong 46 ms before the first one.

---

## 5. The fix, and why native restoration is still doing the restoring

§10 asks for the interference to be removed rather than for a custom
restoration framework, and this is the interference: the document is too short
to restore into. **Nothing in the fix reads or writes `scrollY`.**

`assets/js/home-history.js`:

1. The homepage records its settled height in `sessionStorage`, alongside the
   viewport width and the pathname it was measured at, so a rotation or a locale
   switch does not reserve a height from a different layout.
2. On the way back, a **synchronous `<head>` script** reads it before the body
   is parsed and sets `--home-reserve`, which
   `body.journey-home { min-height: var(--home-reserve, auto) }` turns into
   document height. First layout therefore finds a document the right size, and
   the browser's own restore lands where it was saved.
3. The reserve is released as soon as the real content reaches it. If the
   composition comes back genuinely shorter, it is *trimmed* to
   `scrollY + innerHeight` rather than dropped, so the restored position always
   has document under it.

It stands down while `.menu-open` is on the root: the navigation layer holds the
body at `position: fixed`, which collapses the document to one viewport, and
without that guard the observer would record 844 px as the homepage's settled
height and cause the exact defect it exists to fix.

### 5.1 Why not `history.state`, which is the obvious place

The first implementation used it, and on paper it is the better fit: a per-entry
store needs no key, and the height belongs to exactly the entry it was measured
on. **It broke a back navigation**, which is worse than the defect it fixed.

Leaving the homepage with the navigation layer open puts a `replaceState` one
frame after the click that starts the navigation — `header.js` closes the layer,
closing it un-fixes the body, un-fixing the body restores the document's full
height, and that resize reaches the observer while the browser is committing the
next document. A history entry rewritten during its own replacement is not one
the traversal back to it can rely on.

Measured on `mobile-390` with the existing
`homepage-chrome.spec.ts` › `lifecycle` › `navigating away and back leaves
nothing behind` test, run in isolation on an idle machine, six runs per arm:

| | passed | failed |
|---|---|---|
| `d10c175` — before this file existed | 6 | 0 |
| with `history.state` | 1 | 5 |
| with `history.state`, guarded on `pagehide` | 2 | 4 |
| with the file removed from the page | 6 | 0 |
| **with `sessionStorage` (shipped)** | **6** | **0** |

The `pagehide` guard is the tempting fix, and the third row is why it is not
one: the write races the *click*, not the unload, and by `pagehide` it has
already happened.

`sessionStorage` mutates no navigation state, so the race has nowhere to land.
What is given up by not being per-entry is nothing that matters: the value is a
layout measurement of one URL at one viewport width, and two history entries for
the same homepage at the same width have the same one. Recorded in
`phase9-consent-inventory.md` §3 as strictly necessary — it is three numbers, it
identifies nobody, nothing is transmitted, and it dies with the tab.

**This is the one place where the first implementation shipped a regression, and
it was caught by an existing test rather than by a new one.**

### 5.1 The same instrumentation, after

```
chromium portrait   38–53 ms  scrollY = 6468  scrollHeight = 14197   restored, error 0
webkit   portrait   38 ms     scrollY = 6400  scrollHeight = 14193   restored, error 0
chromium desktop   112 ms     scrollY = 6400  scrollHeight = 21795   restored, error 69
webkit   desktop     24 ms    scrollY = 6400  scrollHeight = 21467   restored, error 9
```

The restore now lands on the **first sampled frame** with the full height
already present, which is the shape the control page had all along.

| | before | after |
|---|---|---|
| chromium portrait | 2/3 landed at the bottom (6 884 px) | 3/3 restored |
| chromium desktop | 1/3 landed at the bottom (14 169 px) | 3/3 restored |
| webkit portrait | 3/3 landed at the bottom (6 949 px) | 3/3 restored |
| webkit desktop | 3/3 landed elsewhere (5 606 px) | 3/3 restored |
| static control | 6/6 restored | 6/6 restored |

**18 of 18 restored. Maximum error 69 px on a 20 569 px track — 0.3%.**

---

## 6. BFCache: three claims, kept apart

§11 and §17 require these not to be collapsed into one PASS.

1. **Lifecycle handlers exist and run.** Verified. `pageshow` fires at 20–46 ms
   on every restored document in every arm, and `assets/js/header.js` and
   `assets/js/transitions.js` both act on it.
2. **Observable back-navigation behaviour.** Verified, and it is what §5 above
   measures.
3. **A genuine BFCache hit.** **NOT VERIFIED.** `event.persisted` was `false` on
   every `pageshow` in every arm of every run, before and after. The document is
   re-parsed and re-executed on each traverse — which is precisely why the
   height problem exists at all, and precisely why the fix works.

`tests/homepage-history.spec.ts` records `persisted` and annotates the result
rather than asserting it, because asserting it under Playwright would either be
flaky or be a claim of coverage that does not exist. Whether a real Safari or
Chrome would take the BFCache path here — in which case the position comes back
with the page and this file's reserve is never needed — is untested and is
stated as untested.

---

## 7. Scope

The fix is loaded by the three homepage shells only. The 66 generated routes
parse their full height and restore correctly without it; adding it there would
be adding a mechanism to pages that have no use for one.

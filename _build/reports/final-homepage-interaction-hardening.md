# Final homepage interaction hardening

Two product defects, both fixed, both measured before and after. Frozen source:
**`c2bd0bc`**, seven commits on top of the reconciliation freeze `d10c175`.

---

## 1. Menu

### 1.1 Previous defect

With the full-screen navigation open, the page behind it was still in the
document's sequential focus order. On WebKit the **first** Tab out of the
opening menu link landed on the newsletter field in the footer, and every press
after it — forward and backward — stayed out there.

### 1.2 Root cause

Not the focus trap being absent. It was there, and on Chromium it worked.

`assets/js/header.js` wrapped focus when `document.activeElement` was the first
or the last element of a list it built itself. That is an accurate description
of Chromium's tab order and an inaccurate one of WebKit's: **WebKit does not
place links in sequential focus navigation** unless the visitor turns on "press
Tab to highlight each item on a webpage", which is off by default and is
specified behaviour rather than a quirk.

The layer is seventeen links and nothing else. So on WebKit the trap's list was
never the tab order at all — the ends were never reached, the wrap never fired,
and Tab went to the next thing that engine *does* consider tabbable: a form
control, three thousand pixels down the document.

No list this file could build would have fixed it. The elements behind the layer
were still focusable, and a keydown trap can only react to focus having already
moved.

Measured on the built artefact, `experiments/probe-menu-modality.mjs`, 30 Tab
and 30 Shift+Tab presses per arm:

| | forward escapes | backward escapes |
|---|---|---|
| chromium — homepage desktop | 0 | 0 |
| chromium — homepage portrait | 0 | 0 |
| chromium — generated route | 0 | 0 |
| **webkit — homepage desktop** | **15** | **15** |
| **webkit — homepage portrait** | **15** | **15** |
| **webkit — generated route** | **27** | **27** |

The generated-route row matters: this was never a homepage defect. The deck is
byte-identical on all 67 routes and all 67 had it.

### 1.3 The new inert architecture

The background is taken out of the focus order rather than fenced off inside it.
`inert` removes a subtree from sequential focus, from hit testing and from the
accessibility tree in one attribute — three of §2's requirements, one mechanism.

**What becomes inert while the layer is open:**

* every direct child of `<body>` except the header and the layer — on the
  homepage that is `a.skip`, `main#main`, `section.arrival`, `footer.foot`; on
  the 66 generated routes also `.grain`, `.contrail`, `.plane-cursor`,
  `aside.rail` and `div.shell`
* inside the header, every child except the trigger and the wordmark —
  `.nav__alt`, `.nav__links`, `.nav__cta`

**What stays interactive, and why each:**

| | why |
|---|---|
| `#menu` | it is the layer |
| `.burger` | it is the close control while open |
| `.brand` | measured at full opacity and topmost at its own centre point on both compositions; a visible link that cannot be clicked would be a defect of its own |

Neither `<body>` nor `<header class="nav">` is made inert, because the layer and
the trigger live inside them — §4's requirement, met without a structural
wrapper. The list of body children is rebuilt on each open rather than cached:
`<main>` is a React container and the deck is shared with 66 routes, so the
body's children are not a constant.

No `aria-hidden` is applied to any ancestor of the layer, and the suite asserts
directly that no ancestor of the focused element is `aria-hidden="true"`.

The keydown trap is kept. It is what makes Chromium cycle *within* the layer
instead of tabbing out to browser chrome, and it is the only barrier left on an
engine too old for `inert` — hence `'inert' in HTMLElement.prototype` as a
feature test rather than an assumption.

### 1.4 Focus behaviour

* opens on the first destination, not on the trigger just pressed — unchanged
* Escape closes — unchanged
* focus returns to the trigger on close — unchanged, **including the WebKit
  `restoreTo === <body>` fix from the previous reconciliation, which is
  untouched and still asserted** (`homepage-chrome.spec.ts` › `ESC closes it and
  focus goes back to the trigger`, plus the new suite's own restoration
  assertion)
* the background is given back on close — new, and asserted over two open/close
  cycles because the release path only clears the elements it set

`setBackgroundInert(true)` runs *before* focus is placed, because making a
subtree inert blurs whatever it holds and doing it afterwards would be a second
focus move. `setBackgroundInert(false)` runs *before* the focus restore, because
`.focus()` on an inert element does nothing.

### 1.5 Results

`experiments/probe-menu-modality.mjs`, after:

| | forward escapes | backward escapes | newsletter can take focus |
|---|---|---|---|
| chromium — homepage desktop | 0 | 0 | no |
| chromium — homepage portrait | 0 | 0 | no |
| chromium — generated route | 0 | 0 | no |
| webkit — homepage desktop | 0 | 0 | no |
| webkit — homepage portrait | 0 | 0 | no |
| webkit — generated route | 0 | 0 | no |

**Chromium: PASS. WebKit: PASS.** Both engines, desktop and portrait, homepage
and generated routes.

### 1.6 One honest note on what WebKit does now

With the background inert, WebKit's tab order on this document is *empty* —
links are not in it by default and nothing else is left — so focus correctly
does not move at all when Tab is pressed. That satisfies the contract (nothing
behind the layer is ever reached) and matches how Safari treats every other page
on this site, but it is not the same behaviour as Chromium's cycling.

This is why the suite does not assert "focus moved N times": that would require
one engine to behave like the other. It asserts the invariant (focus never
leaves) *and* the state that makes it true (the background carries `inert`, the
newsletter refuses focus when asked by name, the layer owns the hit test at the
newsletter's own coordinates). A visitor who has turned Safari's full keyboard
access on gets the cycling behaviour, and **that configuration is not
exercised** — Playwright's WebKit offers no way to set it. Stated as untested.

---

## 2. History restoration

### 2.1 Measured root cause

Full instrumentation and timelines:
`_build/reports/homepage-history-restoration-investigation.md`.
Probe: `experiments/probe-history-restoration.mjs`.

Nothing was changed until the lifecycle had been recorded, and the recording
eliminated three of the brief's own candidate causes:

* `history.scrollRestoration` was `'auto'` at document-script time **and** at
  `load`, in every arm on both engines. Nothing sets it to `manual`.
* the portrait arm made **zero** programmatic scroll calls of any kind. View
  Transitions, homepage initialization, altitude initialization and resize setup
  are all eliminated by that one reading.
* the three `scrollTo` calls on the desktop arm are ScrollTrigger's `refresh()`
  saving and restoring a position that was already wrong, 46 ms after it went
  wrong.

The first sampled frame of the restored document:

```
portrait   y = 1528   scrollHeight = 2372      2372 − 844 = 1528
desktop    y =  794   scrollHeight = 1694      1694 − 900 =  794
```

Exactly `scrollHeight − innerHeight`. **The browser restored correctly and on
time, into the parsed shell.** `<main>` is a React mount host and is empty in
the HTML, so at first layout the homepage is a header, an Arrival and a footer —
about 2 400 px on a phone, 1 700 px on a laptop. A 6 400 px offset clamps to the
bottom of that, and the visitor's position is destroyed before the application
that justified it exists.

The two engines then differ about a document growing under a scroll position,
which is why one report said "bottom" and another said "top":

* **Chromium** has scroll anchoring: the footer is held in place while fourteen
  thousand pixels are inserted above it, dragging the clamped position to the
  very bottom.
* **WebKit** has none: the clamped position stays where it was, a screen from
  the top.

A generated static route at the same viewport restored perfectly, 9 of 9. This
was never a mobile problem and never a journey problem.

### 2.2 Lifecycle timeline

| | chromium portrait | webkit portrait | chromium desktop | webkit desktop |
|---|---|---|---|---|
| `DOMContentLoaded` / `load` | 22 ms | 41 ms | 20 ms | 29 ms |
| `pageshow` (`persisted`) | 22 ms (false) | 42 ms (false) | 20 ms (false) | 31 ms (false) |
| first restored `scrollY` | **1528** (h 2372) | **1528** (h 2372) | **794** (h 1694) | **794** (h 1694) |
| height arrives | 43 ms → 14197 | 72 ms → 14193 | 41 ms → 21795 | 66 ms → 21793 |
| final `scrollY` | 13352 | 13349 | 20569 | 794 |
| left at | 6468 | 6400 | 6400 | 6400 |

### 2.3 The fix

`assets/js/home-history.js`, plus one CSS declaration in `chrome.css` and one
`<script>` in the three homepage shells.

**Nothing reads or writes `scrollY`.** The browser still does all of the
restoring; the fix only stops the document being too short to restore into —
§10's "fix the interference", not a custom restoration framework.

1. The homepage records the height it settled at, with the viewport width and
   pathname it was measured at, in `sessionStorage`.
2. A **synchronous `<head>` script** reads it before the body is parsed and sets
   `--home-reserve`; `body.journey-home { min-height: var(--home-reserve, auto) }`
   turns that into document height. First layout finds a document the right
   size and the browser's own restore lands where it was saved.
3. The reserve is released the moment the real content reaches it, and *trimmed*
   to `scrollY + innerHeight` rather than dropped if the composition comes back
   genuinely shorter — so the restored position always has document under it.

It stands down while `.menu-open` is on the root, because the navigation layer
holds the body `position: fixed` and the document collapses to one viewport;
without that guard the observer would record 844 px as the settled height and
recreate the defect.

**`history.state` was the first implementation and it shipped a regression.** It
is the better fit on paper — per-entry, no key — but leaving the homepage with
the layer open puts a `replaceState` one frame after the click that starts the
navigation, and a history entry rewritten during its own replacement is not one
the traversal back to it can rely on. Caught by an *existing* test. Full
evidence in §5.1 of the investigation; the summary is that `sessionStorage`
mutates no navigation state, so the race has nowhere to land.

Recorded in `phase9-consent-inventory.md` §3 as strictly necessary: three
numbers, no identifier, nothing transmitted, dies with the tab.

### 2.4 Results

`experiments/probe-history-restoration.mjs`, 3 trials per arm, scroll to
6 400 px, follow an internal link, Back:

| arm | before | after |
|---|---|---|
| **chromium desktop** 1440×900 | 1/3 landed at the bottom, error 14 169 px | **3/3 restored**, error 0–69 px |
| **webkit desktop** 1440×900 | 3/3 landed elsewhere, error 5 606 px | **3/3 restored**, error 0–9 px |
| **chromium portrait** 390×844 | 2/3 landed at the bottom, error 6 884 px | **3/3 restored**, error 0 px |
| **webkit portrait** 390×844 | 3/3 landed at the bottom, error 6 949 px | **3/3 restored**, error 0 px |
| static control 390×844 | 6/6 restored | 6/6 restored |

**18 of 18 restored. Maximum error 69 px on a 20 569 px track — 0.3 %.**

Behavioural coverage (`tests/homepage-history.spec.ts`) runs on all four arms
and asserts the three outcomes §9 names — not the top, not the bottom, not a
different chapter — plus the header state, plus that the page does not move
again after it has settled, plus a forward traverse and a second Back.

### 2.5 View Transitions and header state

* Forward navigation, Back and Forward all exercised; the test leaves the page
  by a script-initiated click on a real link, so the `pageswap` / View
  Transition path is the one under test rather than bypassed by `page.goto`.
* No transition resets scroll: the probe records zero programmatic scrolls on
  the portrait arm, which has the identical defect and the identical fix.
* §14 — after Back the header's `data-state`, the chapter label and the altitude
  all derive from the restored position and match what they were before leaving,
  and `scrollY` is unchanged over a 500 ms stability window afterwards.
* §12 — nothing was added to the portrait scroll architecture. No scroll engine,
  no interpolation, no hijacking, no spacers, no terrain, no camera journey. The
  fix is a `min-height` that exists for a few hundred milliseconds.

---

## 3. BFCache

Three claims, deliberately not collapsed:

| claim | status |
|---|---|
| lifecycle **handlers** exist and run | **VERIFIED.** `pageshow` fires at 20–46 ms on every restored document in every arm; `header.js` and `transitions.js` both act on it, and `home-history.js` re-arms on a `persisted` restore |
| observable **back-navigation behaviour** | **VERIFIED.** §2.4, plus `tests/homepage-history.spec.ts` on four arms |
| a genuine **BFCache hit** | **NOT VERIFIED.** `event.persisted` was `false` on every `pageshow`, in every arm, before and after |

The document is re-parsed and re-executed on every traverse in this environment
— which is precisely why the height defect existed and precisely why the fix
works. Whether a real Safari or Chrome would take the BFCache path here, in
which case the position comes back with the page and the reserve is never
needed, is **untested and stated as untested**.

The test records `pageshow.persisted` and annotates the result rather than
asserting it. Asserting `persisted === true` under Playwright would either be
flaky or be a claim of coverage that does not exist.

---

## 4. Redirect

**`/book-online` → `/ugyfelszolgalat.html`, 301 — CONFIGURATION VALIDATED;
NETLIFY RUNTIME VALIDATION PENDING DEPLOYMENT.**

`tests/redirects.spec.ts` parses the canonical `netlify.toml` and asserts the
source, the destination and the 301, and that the destination is a page the
build actually emits. It also covers both spellings of the
`/service-page/ingyenes-konzultáció` slug and checks every declared redirect for
a dangling destination.

Two things worth stating plainly:

1. **The destination is `/ugyfelszolgalat.html`, not `/contact`.** That is the
   Hungarian slug of the page whose canonical key in `_build/build.py` is
   `contact`, so the brief's "`/book-online` → `/contact`" and the shipped rule
   are the same statement in different vocabularies. The rule is unchanged.
2. The static test server knows nothing about `netlify.toml`, so no local test
   can exercise the redirect's runtime behaviour. None is claimed. The suite
   name says so.

---

## 5. Performance

`experiments/probe-hardening-cost.mjs` measures both arms against the **same
build**, switching each fix off from the page: `delete
HTMLElement.prototype.inert` makes `header.js` take its pre-fix path, and a
`Storage.prototype.getItem` that answers "nothing recorded" makes
`home-history.js` reserve nothing.

| | menu open | scroll listeners | resize listeners | median scroll frame |
|---|---|---|---|---|
| chromium 1440×900 — as shipped | 8.7 ms | 13 | 12 | 166.2 ms |
| chromium 1440×900 — menu fix off | 5.2 ms | 13 | 12 | 167.5 ms |
| chromium 1440×900 — history fix off | 7.2 ms | 13 | 12 | 175.5 ms |
| chromium 390×844 — as shipped | 9.9 ms | 3 | 5 | 16.7 ms |
| chromium 390×844 — menu fix off | 5.8 ms | 3 | 5 | 16.7 ms |
| chromium 390×844 — history fix off | 10.0 ms | 3 | 5 | 16.7 ms |
| webkit 1440×900 — as shipped | 18 ms | 11 | 12 | 17 ms |
| webkit 1440×900 — menu fix off | 11 ms | 11 | 12 | 17 ms |
| webkit 390×844 — as shipped | 21 ms | 3 | 5 | 17 ms |
| webkit 390×844 — menu fix off | 13 ms | 3 | 5 | 17 ms |

**Scroll and resize listener counts are identical in every arm** — by
construction: the menu fix adds none, and the history fix uses one
`ResizeObserver` and no listener, no timer, no per-frame work and nothing
polled. §20's "no global per-frame listener" and "no polling of history state"
are met by there being none to remove.

**Frame timing is unchanged** — differences are within run-to-run noise and the
shipped build is the faster of the three on both Chromium viewports.

**The one measurable cost is the menu open path: +3.5 ms to +8 ms**, which is
`inert` invalidating style and the accessibility tree over the background
subtree once. It happens on a control press that is followed by a 0.45 s
transition. Nothing else moved.

The portrait composition's ~16.7 ms median frame — one frame at 60 Hz — is
unchanged in every arm.

---

## 6. Full frozen-source gate

Source frozen at **`c2bd0bc`**. Working tree clean across `assets/`, `tests/`,
`playwright.config.ts`, `experiments/`, `_build/build.py`, `netlify.toml` and
`scripts/`. One `npm run build` before the run. **All totals below are from that
one freeze; nothing is mixed across commits.**

| gate | result |
|---|---|
| `npm run typecheck` | **PASS** |
| `npm run build` | **PASS** |
| `npm test` | **1007 collected — 879 passed, 9 failed, 119 skipped** (12.6 min) |
| `npm run validate:full` | **165 collected — 131 passed, 0 failed, 34 skipped** (13.3 min) |
| route audit | **792 checks — 0 failing, 0 broken internal links** |
| menu accessibility | **PASS** — 4/4 arms, per-project |
| history restoration | **PASS** — 4/4 arms, per-project; 18/18 probe runs |
| lifecycle / BFCache coverage | **PASS** with the three claims separated (§3) |
| mobile journey contract | **PASS** — `mobile-homepage-simple.spec.ts`, 1 load-dependent timeout |
| desktop homepage regression | **PASS** — `homepage-chrome.spec.ts`, 6 load-dependent timeouts |
| consent | **PASS** — inventory updated for the one new key |
| GA4 / analytics | **PASS** |
| lead forms | **PASS** |
| Portal | **PASS** |
| security headers | **PASS** |
| redirects | **PASS** (configuration; runtime pending deployment) |
| secrets | **PASS** — 663 files, 12 rules, clean |
| SEO | **PASS** — 72 documents, 0 failing, 43 warnings |
| conversion | **PASS** — no CTA integrity failures |
| fingerprint | **PASS** — 72 pages, 25 assets, 0 unstamped |
| draco | **PASS** — matches three 0.171.0 |

---

## 7. The nine `npm test` failures

The reconciliation's seven were classified as CPU / software-rasterizer
saturation. **That classification was re-derived rather than inherited**, and
this run has nine, so the difference has to be accounted for.

### 7.1 The controlled comparison

Three full-suite runs, same machine, same night:

| | collected | passed | failed | skipped | wall clock |
|---|---|---|---|---|---|
| `d10c175` — the reconciliation freeze | 992 | 869 | **4** | 119 | 8.8 min |
| `c2bd0bc` without the two new spec files | 992 | 871 | **5** | 119 | 9.1 min |
| **`c2bd0bc` — the frozen gate** | 1007 | 879 | **9** | 119 | 12.6 min |

The middle row is the load-bearing one: **the product fixes cost nothing.** Same
machine, same evening, both fixes shipped, and the failure count and runtime are
indistinguishable from the baseline.

The baseline's four failures are, by name, four of this run's nine.

### 7.2 What the nine are

Every one is a timeout or an expired wait predicate. **No assertion about
product behaviour was violated in any of them.**

| project | test | failure |
|---|---|---|
| desktop-1920 | flight deck › journey state compacts the wordmark | 4 s predicate expiry |
| desktop-1920 | menu › opens from every header state | 30 s test timeout |
| desktop-1920 | menu › focus is trapped inside the layer | 30 s, in `keyboard.press` |
| desktop-1920 | menu › does not walk the journey back down | 30 s |
| desktop-1920 | history › back and forward restore | 20 s, in the altitude settle |
| desktop-1920 | modality › keyboard focus stays in the layer | 60 s, in `keyboard.press` |
| mobile-430 | mobile › the page stops when the scroll stops | 20 s, in the reveal wait |
| reduced-motion | menu › focus is trapped inside the layer | 30 s, in `keyboard.press` |
| reduced-motion | lifecycle › subpage carries the same working header | 30 s |

### 7.3 The evidence for the classification

* **Run alone, they pass.** `homepage-chrome.spec.ts` on `desktop-1440`,
  `--workers=1`: **41 of 41 passed**. All four hardening arms per-project,
  `--workers=1`: **12 of 12 passed** (desktop-1920 54.2 s, desktop-webkit 10.5 s,
  portrait-chromium 11.1 s, mobile-390 6.5 s).
* **The cost is the page, and it is measured.** The desktop homepage renders at
  a **166 ms median frame** under Chromium's software rasteriser here, with 62–66
  long tasks totalling 9.5–14.6 s per page life. The same page under WebKit is
  17 ms. A `keyboard.press` costs 0.7–1.3 s on that document *with the machine to
  itself*.
* **The machine itself is loaded.** Ambient load average 16–53 on 10 cores
  during these runs, with a user WebKit content process at 98 % CPU for eight
  hours and WindowServer at 34–66 %. Not something the suite can or should fix,
  and not something I altered.

### 7.4 The two failures that are mine

`desktop-1920` › history and `desktop-1920` › modality are new tests, and they
land in the same class on the same project. Both pass per-project. I am not
claiming they are immune — they are the two most expensive tests in the suite on
the most expensive project — and the honest statement is that on this machine
under full parallel load, the `desktop-1920` arm of both suites is
load-dependent in exactly the documented way.

### 7.5 The one place the pattern DID materially change, and what was done

The first version of the two new suites was written as one assertion per test:
36 added tests, **19.9 minutes and 64 failures**. The added failures were almost
entirely timeouts in *other* suites, starved by long-running tests holding
workers while a 1 MB WebGL page rendered at 10 fps.

That was not accepted as "the documented class". It was a real cost imposed by
the shape of the new suites, and it was fixed by cutting them to one journey per
contract — 12 tests, no assertion dropped and no tolerance widened. `dc4120c`
records the measurement.

Two scoped timeout increases remain, on the new files only (`60_000` for
modality, `120_000` for history), and they are sized against measured serial
cost: four homepage loads and sixteen key presses do not fit a budget chosen for
tests that do neither. **No existing test's budget was changed, no retry was
added, no `force: true`, no sleep, no worker-count change, no GPU flag.**

---

## 8. Verdict

**FINAL HOMEPAGE INTERACTION HARDENING ACCEPTED WITH DOCUMENTED LIMITATIONS**

Both product objectives are met and independently measured:

* the navigation is genuinely modal on both engines, at both compositions, on
  the homepage and on all 66 generated routes — 0 escapes where there were up to
  27;
* the homepage keeps the visitor's place across history navigation — 18/18
  restored where 9/12 homepage runs previously landed at the bottom or near the
  top.

The limitations, each stated where it applies:

1. **No genuine BFCache hit is verified.** `persisted` was false on every
   traverse. Handler coverage and observable behaviour are verified; the third
   claim is not, and is not made.
2. **The Netlify redirect's runtime behaviour is not exercised.** Configuration
   is validated; runtime validation is pending deployment.
3. **Safari's "tab to links" configuration is untested.** Playwright's WebKit
   offers no way to enable it, so the cycling behaviour a full-keyboard-access
   visitor would get is asserted only on Chromium.
4. **Nine `npm test` failures remain, all timeouts, none a product assertion.**
   Four are the baseline's own, measured on the same machine the same night; the
   product fixes account for none of the change; two are new tests on the single
   most expensive project and pass per-project.

Not pushed. Not deployed. Not merged. Phase 10 not begun.

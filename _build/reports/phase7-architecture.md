# Phase 7 — multi-page transition architecture

**Status: design only. Nothing in this document is implemented, and none of it
should be until Phase 6 is accepted.**

The decision this document exists to record is a negative one: *no client-side
router is introduced to implement page transitions.* Everything below follows
from that.

---

## 1. What the site actually is

Verified against `dist/` from a clean `npm run build`, not from memory:

| Surface | Count | Built by | Router |
|---|---|---|---|
| Generated static pages | 33 | `_build/build.py` | none |
| Public homepages (hu/en/de) | 3 | `experiments` → `build:home` | none |
| Portal | 1 SPA | `portal` → Vite | **react-router** |

`dist/` holds 36 public HTML documents plus `dist/portal/index.html`. The three
homepages are React applications that each render one document; they are not a
shared SPA and they do not route. The portal is the only routed surface in the
repository.

There is therefore no existing router to extend, and adding one would mean
converting 36 independently generated documents into a single application shell
— a rewrite of the build, the CSP posture and the deploy topology, in exchange
for an animation. That trade is refused.

## 2. Architecture

Cross-document View Transitions, opted into from CSS, with a scripted
enhancement layer that is never required.

### 2.1 The opt-in

Same-origin cross-document transitions need both documents to opt in:

```css
@view-transition { navigation: auto; }
```

One declaration, in one new stylesheet, `assets/css/transitions.css`. It reaches
all 33 generated pages through a single line in the `SHELL` template at
`_build/build.py:352`, beside the existing `type.css` and `main.css` links, and
the three homepages through the `experiments` head. Because both the outgoing
and the incoming document must carry it, partial rollout degrades to no
transition rather than to a broken one — which is the property that makes a
staged rollout safe.

**This costs no JavaScript and no CSP change.** `@view-transition` is a CSS
at-rule; the site is served under `script-src 'self'` with no `'unsafe-inline'`,
and nothing here needs a script tag at all.

### 2.2 Route- and direction-aware types

Transition *types* let one stylesheet describe several moves without branching
in script. Types are declared per-document, again from CSS:

```css
/* on every subpage */
@view-transition { navigation: auto; types: subpage; }
/* on the three homepages */
@view-transition { navigation: auto; types: home; }
```

and matched with `:active-view-transition-type()`. Direction — whether the visit
is a descent into detail or a return to the index — is read from the pair of
types active during the transition, not from history state, so it stays correct
under back/forward without anything having to track it.

### 2.3 What must not be assumed

* **No dependency on transition completion.** Navigation is a normal document
  navigation; the transition decorates it. If the animation never starts, never
  finishes, or is interrupted by a second click, the destination document still
  loads and renders. Nothing waits on `finished`.
* **No interception of clicks.** Anchors stay anchors. Middle-click, ⌘-click,
  "open in new tab", and the browser's own back button keep working because
  nothing is preventing their default.
* **No transition on cross-origin or cross-document-type boundaries.** See §4.

## 3. The eight cases

| Case | Treatment |
|---|---|
| Homepage → subpage | `home` → `subpage`. Shared element on the nav/logo; content cross-fade with a short forward push. The homepage's WebGL canvas is deliberately **not** a transition participant — see §5. |
| Subpage → homepage | `subpage` → `home`, the reverse direction of the above, driven by the type pair rather than by stored state. |
| Subpage → subpage | `subpage` → `subpage`. Nav and footer are stable across the pair, so they get `view-transition-name`s and hold still while only the main column changes. This is the most common navigation on the site and the cheapest to animate well. |
| Case-study index → case study | Morph on the case's figure: the thumbnail on the index and the hero image on the detail page share one `view-transition-name`, assigned per-case by the generator so each pair is unique within a document. |
| Locale switching | **No transition.** The `hreflang` alternates swap the whole document's language; a morph across a language change animates one text into another that means the same thing in a different tongue, which reads as a glitch rather than as continuity. Locale links opt out explicitly. |
| Back and forward | Handled by the browser. Because types are per-document rather than per-click, a back navigation gets the correct reverse pairing with no history bookkeeping. |
| Unsupported browser | The at-rule is ignored, the navigation is an ordinary one, and the site behaves exactly as it does today. This is the baseline, not a degraded mode. |
| Portal | **Excluded.** See §4. |

## 4. Exclusions, and why they are hard boundaries

**The portal.** `dist/portal/` is a react-router SPA behind authentication. Its
internal navigation is same-document, so cross-document transitions do not apply
to it; and a public page transitioning *into* it would animate across an auth
boundary, which is both meaningless and a way to make a redirect to a login
screen look like a rendering fault. `transitions.css` is not linked from the
portal's head, and public → portal links opt out.

**Cross-origin.** Same-origin is a hard requirement of the feature; nothing to do.

**Reduced motion.** Immediate navigation, no animation:

```css
@media (prefers-reduced-motion: reduce) {
  @view-transition { navigation: none; }
}
```

This is a real opt-out rather than a shortened duration. The site already
promises a readable document without animation and asserts it in the
`reduced-motion` Playwright project; that promise extends here unchanged.

## 5. The fallback layer, and its limits

Where cross-document transitions are unavailable, the fallback is a **CSS/DOM
overlay**: a fixed, `aria-hidden`, pointer-events-none element that fades on
`pagehide` and out on `pageshow`. It is worth stating what it is not:

* it does not delay navigation;
* it does not run on reduced motion;
* it does not participate in the back/forward cache decision — `pageshow` clears
  it on restore, which is the one case a naive implementation gets wrong and
  leaves a permanent grey veil over a restored page;
* it is one external script file, because `script-src 'self'` forbids inline.

If the fallback script fails to load, the site is exactly the site it is today.

**The homepage canvas is not a participant.** The three homepages render a
30 000 m WebGL journey; capturing it into a transition snapshot means
rasterising a live canvas at navigation time, on the frame the user is least
able to spare it. The canvas is given `view-transition-name: none` and the
transition is limited to the DOM chrome around it.

## 6. Verification plan (to be executed in Phase 7, not now)

1. All 33 generated pages carry the stylesheet link — assert in the built output,
   the same way `tests/public-site.spec.ts` already walks `dist/` for inline
   scripts.
2. Portal head does **not** carry it.
3. Reduced-motion project: `navigation: none` resolves, and no overlay appears.
4. Back/forward across each of the eight cases leaves no residual overlay.
5. CSP unchanged — no new origin, no `'unsafe-inline'`, verified against the
   production header.
6. No regression in the Phase 6 acceptance surface: the transition work touches
   `<head>` and a new stylesheet, and must not move a single measured bound.

## 7. Open questions for the Phase 7 brief

* Whether the case-study morph is worth per-case generated
  `view-transition-name`s in `build.py`, or whether the index→detail move should
  use the same generic treatment as any other subpage→subpage navigation.
* Whether the three homepages opt in at all in the first increment, given §5 —
  subpage↔subpage is the majority of navigation and carries none of the canvas
  risk.

# Simplified mobile homepage — review package

Everything here was produced from the built `dist/`, Hungarian locale, by two
scripts in `experiments/`. Regenerate with a static server on `:4322`:

```bash
node experiments/shots-mobile-simple.mjs
```

```bash
node experiments/record-mobile-scroll.mjs
```

## Stills

`<viewport>-full.png` is the whole document in one image.
`<viewport>-<section>.png` frames each beat as a visitor arrives at it — scrolled
so the section's top sits just below the shared header, which is the same offset
`scroll-padding-top` gives an anchor link. The first version of this set framed
at the top of the viewport instead, which put every section's eyebrow behind the
header and made the labels look lost.

Every still is taken after a full walk of the document, so the reveals have all
fired and their transitions have finished. A screenshot caught mid-transition is
a picture of the transition, not of the composition.

| viewport | document | screens |
|---|---:|---:|
| 430×932 | 14 440 px | 15.5 |
| 390×844 | 14 035 px | 16.6 |
| 375×812 | 13 904 px | 17.1 |
| 360×800 | 13 788 px | 17.2 |
| 844×390 (landscape) | 14 912 px | 38.2 |

Sections captured: `calibration`, `initial-ascent`, `lower-atmosphere`,
`cloud-breakthrough`, `selected-work`, `system`, `process`, `destination`.

## Recordings

`recordings/*.webm`, 390×844, **1x and unedited**. Nothing is slowed down, sped
up, trimmed or re-timed — §29 asks for that in as many words, and a recording
that has been slowed to look smooth is a recording of the editing.

The gestures are injected through Chrome DevTools'
`Input.synthesizeScrollGesture` with `gestureSourceType: 'touch'` and
`preventFling: false`, so they go through the same pipeline a finger uses and
the coast after a flick is the compositor's real fling curve rather than a
scripted approximation. `window.scrollTo` was not used: it teleports, and a
recording of it shows the page arriving at positions instead of travelling
between them.

| file | gesture |
|---|---|
| `slow-scroll.webm` | 8 × 700 px at 900 px/s, 250 ms apart — an unhurried read |
| `fast-flick.webm` | 6 × 2 400 px at 6 000 px/s, 900 ms apart — hard enough to fling |
| `reverse-scroll.webm` | 8 × 1 400 px upward at 2 400 px/s from 85 % of the document |

Each ends with a 1.6 s still tail. **That tail is the thing to watch.** Anything
still arriving after the last gesture is visible there and nowhere else, and it
is what §3 rules out.

## What these are and are not

They are what makes a regression visible without a phone in your hand. They are
**not** the acceptance gate — §25 is explicit that the gate is the real iPhone,
and that green tests and clean captures are insufficient if the device still
feels worse.

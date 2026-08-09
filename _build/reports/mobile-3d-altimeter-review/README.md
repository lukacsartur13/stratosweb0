# Review package — the real 3D Altimeter on portrait mobile

Everything here was produced by two scripts against the built site, on the
platform GPU, with no manual capture and no editing:

```bash
node experiments/shots-mobile-instrument.mjs --origin http://localhost:4400
node experiments/record-mobile-scroll.mjs --origin http://localhost:4400 --into mobile-3d-altimeter-review
```

## Stills

Five viewports: `430x932`, `390x844`, `375x812`, `360x800` and the landscape
case `844x390`, all at `deviceScaleFactor: 3` with an iPhone user agent.

| prefix | what it is |
| --- | --- |
| `opening-*` | the frame the visitor lands on, unscrolled |
| `mid-*` | the instrument composed, at 0.48 of its travel across the viewport |
| `late-*` | the intentional exit — squared up to the viewer, leaving upward |
| `detail-*` | a crop of the slot: hands, numerals, ticks, hub, ceiling arc |
| `glass-*` | the upper 42% of the same crop: the crystal's limb and the bezel highlight |
| `fallback-390x844` | the whole page with WebGL denied the way a blocklisted driver denies it |
| `svg-390x844` | that fallback's drawing, cropped |
| `glb-390x844` | the same crop with the renderer allowed — the A/B §24 closes on |

The three journey states are chosen from **the slot's own crossing of the
viewport**, not from a fraction of the document. A fixed scroll fraction picks a
different moment of the instrument's travel on every viewport and in every
locale; three of the five would be frames the instrument is not in.

## Recordings

`recordings/` — three unedited 1x captures at 390×844, driven through
`Input.synthesizeScrollGesture` with `preventFling: false`, so the coast after a
flick is the compositor's real curve rather than a scripted tween.

| file | gesture |
| --- | --- |
| `slow-scroll.webm` | 8 × 700px at 900 px/s — an unhurried read |
| `fast-flick.webm` | 6 × 2400px at 6000 px/s — hard enough to fling |
| `reverse-scroll.webm` | 8 × 1400px at 2400 px/s, upward from 0.85 of the document |

Each pass ends with a long, still tail. Anything that is still arriving after
the last gesture is visible there and nowhere else.

## Measured

`stills.json` records the slot's CSS box, its share of the viewport height and
the drawing buffer at each viewport. The performance comparison is in
`_build/reports/mobile-3d-altimeter-report.md`, from
`_build/reports/mobile-cost-{A-svg,B-glb,C-terrain}.json` and
`mobile-endurance-*.json`.

## What this package cannot tell you

Frame pacing, thermal behaviour and touch latency on a real phone. Everything
here ran on an Apple M4 pretending to be an iPhone, which is fast enough that
all three architectures hold 16.7 ms. §22's real-device gate is the gate.

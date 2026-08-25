# The new journey — specification

The altitude map is **unchanged**. `STAGES` in `journey.ts` keeps its eleven
entries, its bounds and its shares. What changes is where a chapter's copy
lives in the frame, which direction it moves, and how the air around it reads.

## The one rule

> A chapter's copy is **suspended in the sky band** (the top 16–20 % of the
> viewport). It settles **downward** into legibility, holds, then **drifts
> downward** out of the frame as the visitor climbs past it.

Nothing enters from below. Normal document scroll, normal wheel, normal touch,
normal history — the inversion is entirely in the composition.

## The motion grammar — four states, one number

Every chapter publishes one value, `--pass`, its own 0…1 progress. Four states
fall out of it:

```
--pass          state       y (relative to the sky band)   opacity   focus
0.00 → 0.12     UPCOMING    −4 svh  →   0                  0.28 → 1  blur 3px → 0
0.12 → 0.70     ARRIVED       0     → +11 svh              1         sharp
0.70 → 0.90     PASSING     +11 svh → +24 svh              1 → 0.35  blur 0 → 2px
0.90 → 1.00     BEHIND      +24 svh → +34 svh              0.35 → 0  blur → 4px
```

UPCOMING is the part that carries the concept: the statement is *already there*,
high in the frame, unresolved, before the visitor has arrived at it. It resolves
by settling **down** — the opposite of the reveal it replaces.

Implemented as: `position: sticky` in the sky band, plus a translate driven by
`--pass`. One dirty-checked custom-property write per active chapter per frame,
on the publisher that already runs. No new listener, no new rAF, no layout read.

## Stage-by-stage

```
STAGE 0 — GROUND                                    calibration · 0–150 m
  visual      densest lower atmosphere on the page; the ground haze layer at
              full strength across the bottom third; ridges lit, sky black
  copy        hero statement in the sky band, ~18–40 svh, nothing below it but
              air and the instrument
  altimeter   centre rail, full size, ground pose, needles at zero
  signal      the frame is bottom-heavy and the top is empty: there is
              somewhere above to go

STAGE 1 — LIFT-OFF                          initial-ascent · 150–3 000 m
  visual      ground haze falls away over the first screen — the single
              clearest statement that the visitor has left the ground
  copy        settles down into the sky band as the hero drifts below it
  altimeter   crosses to the right rail; first signal at 3 000 m

STAGE 2 — ASCENT                          lower-atmosphere · 3 000–6 000 m
  visual      atmosphere opening, ridges thinning
  copy        headline overhead; the capability ladder reads as six altitude
              checkpoints climbing under it rather than six cards arriving
  altimeter   right rail, quiet under a dense list

STAGE 3 — LAYER                        cloud-entry · 6 000–8 500 m
  visual      the deck closes in; contrast collapses
  copy        overhead, low contrast — the one place the copy is allowed to be
              hard to read, because the air is
  altimeter   left rail; ring 1 unseats at 7 000 m

STAGE 4 — BREAKTHROUGH            cloud-breakthrough · 8 500–11 000 m
  visual      out the top: the sky opens, the haze layer reaches zero
  copy        centred statement, held high, resolving as the deck clears
  altimeter   left rail

STAGE 5 — PROOF                        selected-work · 11 000–17 000 m
  visual      full daylight, the clearest air so far
  copy        chapter title overhead and HELD for the whole stage — the marks
              and the Rapidkert feature pass beneath it
  marks       plated quietly, resolving as they are reached; no card treatment
  Rapidkert   an altitude checkpoint at 11 800 m: label, name, ~15M Ft,
              the landscape frame at its own ratio, two ways out
  altimeter   right rail, smallest state; aperture breakthrough at 12 000 m

STAGE 6 — SYSTEM                              system · 17 000–22 000 m
  visual      blue draining, density dropping
  copy        "nine areas in three layers" overhead; the three layers begin
              entering the frame from above rather than after a spacer
  altimeter   left rail; ring 2 locks at 18 000 m

STAGE 7 — SYSTEM (cont.)                     process · 22 000–25 500 m
  visual      thinner, colder, sharper
  copy        headline overhead, seven checkpoints climbing past
  altimeter   left rail; ring 3 locks at 24 000 m

STAGE 8 — THIN AIR             stratosphere-transition · 25 500–28 000 m
  visual      indigo drain; the upper opening at its widest
  copy        overhead, sparse
  altimeter   final calibration begins

STAGE 9 — STRATOSPHERE              full-stratosphere · 28 000–30 000 m
  visual      the cleanest frame on the page: near-black zenith, one thin lit
              limb, no surfaces at all
  copy        one centred statement, high, alone
  altimeter   returns to the centre

FINAL — ARRIVAL                            destination · 30 000 m
  visual      maximum openness; Earth limb across the lower frame
  copy        "Készen állsz felemelkedni?" in the sky band, two actions, the
              stage index as a quiet altitude ledger below
  altimeter   meridian state, centre, full presence — then it recedes as the
              site's Arrival and ground-control footer take over
```

## The background, as a journey

Two DOM layers over (desktop) or instead of (phone) the shader, both driven by
one published `--alt` (0…1 over 0–30 000 m):

* **ground haze** — a dense dark band anchored to the bottom of the viewport.
  Full strength at 0 m, zero by ~9 000 m. This is what makes the opening feel
  low and the breakthrough feel like leaving something behind.
* **the opening** — a cold, wide, low-density glow from above the top edge.
  Absent at 0 m, widest at 26 000 m, restrained again at the ceiling.

On the phone these two layers replace the static gradient entirely, which is
what gives that surface an atmospheric progression it has never had.

## Passes

* **A** composition + section positioning (sky band, sticky chapters)
* **B** motion grammar (`--pass`, arrive / hold / pass / behind, reveal
  directions inverted on the phone)
* **C** background altitude progression (`--alt`, ground haze, the opening)
* **D** Altimeter integration (copy budget re-solved against the sky band)
* **E** mobile adaptation
* **F** reduced motion, focus, polish

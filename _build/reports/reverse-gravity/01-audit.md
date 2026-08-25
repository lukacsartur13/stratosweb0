# Reverse gravity — audit of the homepage as it stands

Read against the current build (`experiments/src/full/**`), captured at
1440×900, 1920×1080, 390×844 and 430×932. Stills in
`experiments/screenshots/reverse-gravity/before/`.

Two compositions ship, chosen once at mount by `mobile/device.ts`:

| | desktop / tablet | phone (short edge ≤ 540 + coarse pointer) |
|---|---|---|
| component | `FullAscent.tsx` | `mobile/MobileHome.tsx` |
| structure | 11 panels inside one sticky 3D stage, `TRACK_VH` ≈ 22.6 screens | 11 ordinary block-flow sections |
| clock | ScrollTrigger → damped `journey.current` | one passive `scroll` listener, no damping |
| background | WebGL sky shader, 12 altitude bands | one **fixed, static** CSS gradient |

Both read the same content tables, the same locale messages and the same
altitude map (`journey.ts`). Nothing below proposes changing that map's numbers.

---

## 1 · Current homepage map — desktop (1440×900)

Measured document height 21 239 px. `--share` per panel comes straight from
`STAGES`, so a panel is up to 4.4 screens tall while its copy is a single
~700 px block **vertically centred inside it** (`.panel { align-items: center }`).

| # | Section | Altitude | Viewport treatment | Copy entrance | Background | Altimeter | Ascent? |
|---|---|---|---|---|---|---|---|
| 1 | `calibration` | 0–150 m | 1.0 screen, copy centred left, instrument centred | rises from below with the document | near-black, ridge silhouettes, mountains lit | centre rail, full size, ground pose | **partly** — the frame is good, the copy is not overhead |
| 2 | `initial-ascent` | 150–3 000 m | 1.4 screens, copy centred left, instrument right rail | rises from below | dark blue-grey, ridges still present | right rail, first signal at 3 000 | **contradicts** — copy occupies 27–70 % of the viewport and drifts up past the reader |
| 3 | `lower-atmosphere` | 3 000–6 000 m | 2.2 screens, copy centred left, capability ladder | rises from below | opening blue, ridges thinning | right rail | **contradicts** — a 6-item ladder scrolls up past a static frame |
| 4 | `cloud-entry` | 6 000–8 500 m | 1.6 screens, copy centred right | rises from below | approaching cloud deck | left rail, ring 1 unseats at 7 000 | neutral |
| 5 | `cloud-breakthrough` | 8 500–11 000 m | 1.6 screens, centred statement | rises from below | inside the deck: bright, flat, no horizon | left rail | **supports** — the only stage that reads as crossing a layer |
| 6 | `selected-work` | 11 000–17 000 m | 4.4 screens, copy centred left | rises from below | full daylight blue, brightest point of the journey | right rail, aperture breakthrough at 12 000 | **contradicts** — see §3 |
| 7 | `system` | 17 000–22 000 m | 2.4 screens, copy centred right, nine areas in three layers | rises from below | blue draining | left rail, ring 2 locks at 18 000 | **contradicts** — the chapter title is clipped by the header at the reading position |
| 8 | `process` | 22 000–25 500 m | 3.0 screens, seven checkpoints, copy right | rises from below | deep blue | left rail, ring 3 locks at 24 000 | **contradicts** — a long timeline running upward |
| 9 | `stratosphere-transition` | 25 500–28 000 m | 1.4 screens, copy right | rises from below | indigo drain | left rail, final calibration begins | neutral |
| 10 | `full-stratosphere` | 28 000–30 000 m | 1.4 screens, centred statement | rises from below | near-black zenith, thin lit limb | centre rail | **supports** |
| 11 | `destination` | 30 000 m | 1.2 screens, centred column, right side | already near the top of the viewport | darkest, Earth limb across the lower frame | centre, meridian state | **supports** — the strongest frame on the page |

## 2 · Current homepage map — phone (390×844)

Sections are as tall as their content. There is no sticky anything.

| # | Section | Viewport treatment | Copy entrance | Background | Altimeter | Ascent? |
|---|---|---|---|---|---|---|
| 1 | `calibration` | header clearance, label, hero title, instrument reserve, lead, actions | `.mv-lines__in` masked **from below** | static | `hero`, centred, full size | **supports** — the one top-anchored composition on the phone |
| 2–4 | `initial-ascent`, `lower-atmosphere`, `cloud-entry` | label + title + copy, then a Meridian spine | `.mv-text` **+18 px from below**, `.mv-copy` **+12 px from below** | static | `ascent` / `capabilities` — right rail, low, 30 % scale | **contradicts** |
| 5 | `cloud-breakthrough` | centred statement, chapter gap | from below | static | `summit`, centred, 52 % | partly |
| 6 | `selected-work` | marks, then one case | from below | static | `work`, right rail, 26 % — the quietest state | **contradicts** |
| 7–8 | `system`, `process` | three layers / seven checkpoints down a spine | from below, staggered | static | `capabilities` / `process` | **contradicts** |
| 9–10 | `stratosphere-transition`, `full-stratosphere` | copy, then a centred statement | from below | static | `ascent` / `summit` | **contradicts** |
| 11 | `destination` | centred statement, two actions, contact, stage index | from below | static | `arrival`, centred 78 %, then `recede` | **supports** the ending, not the climb |

---

## 3 · What specifically contradicts the ascent idea

**Everything enters from below.** Not as a stylistic accident — it is the
literal mechanism on both surfaces:

* desktop panels are ordinary flow inside a sticky 3D stage, so every word on
  the page travels bottom → top with the scroll;
* the phone's five motion roles are `translate3d(0, +18px)`, `+12px` and
  `+105%` (`mobile.css` §04) — three of the five are explicit bottom-up
  reveals, and the masked headline is the loudest element on the page.

**The copy is centred, not overhead.** `.panel { align-items: center }` puts
every desktop chapter in the vertical middle of its own panel. Measured at
1440×900 the `initial-ascent` block runs 27 %–70 % of the viewport; §2 of the
brief asks for 20 %–45 %.

**Large blank spacers, and they are structural.** A panel is `--share` screens
tall with a one-screen block centred in it, so `selected-work` (4.4 screens)
has ~1.7 screens of nothing above its copy and ~1.7 below. Captured at
`d1440-system-top.png`: a **completely empty viewport at 17 000 m**, the
boundary between Our Work and The System. The same hole exists at eight of the
ten boundaries.

**The background is a journey on desktop and a wallpaper on the phone.**
`Sky.tsx` interpolates twelve altitude bands and is genuinely good. The phone's
`.mv-sky__depth` is a fixed gradient and its own comment says so: *"driven by
nothing"*. Captured at 27 950 m the phone's background is indistinguishable
from 0 m.

**Panels that could be atmosphere.** The six collaboration marks are plated on
`#dce4ea` — six bright rectangles in the brightest frame of the journey. The
`.feature`, `.system__ring` and `.check` blocks already had their card
treatment removed on landscape (the wash system) but keep it in portrait.

**Chapter titles are gone by the time the chapter is read.** At the `system`
reading position the `h2` is clipped behind the header; at `selected-work` it
has left the viewport entirely. The one thing that should be overhead is the
one thing that has already been passed.

**The HUD collides with the copy.** At `selected-work` the 13 317 m readout
paints through the featured case's result paragraph.

## 4 · What already supports it, and must be preserved

* `journey.ts` — one altitude, everything a pure function of it, forward and
  reverse identical by construction. The story map is sound; **no altitude
  number needs to change.**
* `Sky.tsx` — twelve-band atmospheric progression, one draw call.
* The rails in `composition.ts` — five instrument handoffs, three copy
  handoffs, each landing on a structural event the instrument is already having.
* `kineticType.ts` — weight / width / tracking already driven by altitude on
  three anchors. This is the "letter-spacing compression" the brief asks for,
  already built.
* The phone's architecture — one scroll listener, cached geometry, two
  dirty-checked writes per frame, no damping. **Nothing here may regress.**
* The Meridian instrument states, on both surfaces.
* The simplified portfolio IA: logo-led marks, Rapidkert as the sole feature,
  `/work` as the destination.

## 5 · Mobile-specific constraints on any change

* `svh` only. `dvh` and `vh` reflow under Safari's toolbar.
* No `getBoundingClientRect` on a scroll frame; section geometry is cached in
  `ascent.ts` and re-measured only on fonts / resize / rotation / `pageshow`.
* No new scroll, resize or `visualViewport` listeners — `ascent.ts` publishes
  measurers for anything that needs to ride the existing ones.
* `contain: paint style` on `.mv-sec`.
* Two live contracts in `tests/mobile-homepage-simple.spec.ts`: every section's
  first meaningful content within 14 svh of its top (26 for the opening), and
  no run of nothing taller than 34 svh inside a section.
* `--deck-content` must not be read into anything that affects layout; the
  header quantises it to 8 px and it moves mid-scroll.

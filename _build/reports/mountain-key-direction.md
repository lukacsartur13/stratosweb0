# Mountain key light: left or right

The brief asked for the mountain key to be tried from both sides before one was
chosen, and for the direction that produces the clearest valley depth while
preserving the range's asymmetry to win. This is that comparison.

## Method

`experiments/.tmp-look.mjs`-style measurement against the live dev server at
1440×900, altitude driven to a fixed stop through `journey.debug.altitude`, idle
ring rotation frozen. The mountain pixels are isolated by rendering the frame
twice — once as it is, once with the range's roots hidden — and taking the
pixels that differ. That is an exact "a mountain is the nearest surface here"
mask; a white silhouette of the range is not, because it also marks every pixel
the Meridian is drawn in front of and drags the instrument's own values into the
mountains' histogram.

Only `keyAzimuth` was changed between arms. Azimuth is measured about world Y
from the direction the camera looks out of the screen: negative is from the
left, positive from the right.

Luminance is Rec. 709, 0–255, over the masked pixels. `L`, `C` and `R` are the
means of the left, centre and right thirds of the frame.

## Result

| azimuth | altitude | median | p05 | p95 | range | L | C | R |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| −58° (left) | 0 m | 35 | 16 | 74 | 58 | 22.8 | 39.4 | **65.2** |
| −58° (left) | 7 000 m | 41 | 27 | 74 | 47 | 33.1 | 48.6 | **68.2** |
| +58° (right) | 0 m | 52 | 17 | 73 | 56 | **63.2** | 40.8 | 23.3 |
| +58° (right) | 7 000 m | 56 | 26 | 76 | 50 | **67.2** | 49.7 | 28.9 |

−104° and +104° were also measured. They are within two luminance steps of −58°
and +58° on every column, so the choice is a side and not an angle; the elevation
does more than the last 45 degrees of azimuth.

## Decision: from the left, −58° at 26° elevation

The two arms have almost the same dynamic range (58 against 56) and almost the
same extremes. They differ in *where the light lands*, and two things in this
page decide that.

**The narrative panel is on the left.** At 1440×900 the calibration panel is an
opaque plate over roughly x = 0.045…0.42. A key from the right puts its largest
lit field — the left mass, mean luminance 63 — directly behind it. Most of the
modelling that arm produces is not visible to anyone.

**The Meridian is on the right.** Its case is near-black by design. A key from
the right leaves the right third at mean 23, so the instrument's dark silhouette
sits against dark rock and loses its edge. From the left the right third is at
65 and the instrument reads as a dark, precise object against a lit wall — which
is the separation the brief asks for, obtained without touching the instrument's
own lighting.

The median difference (35 against 52) is a consequence of the same fact rather
than a separate finding: the right-hand arm lights the bigger mass, so more of
the frame is bright. Brighter is not the goal — the goal is a dark valley with
the light where the composition needs it.

**Asymmetry is preserved either way**, because it is in the geometry:
`MNT_BACKGROUND_R` reaches 1 185 model metres against `MNT_BACKGROUND_L`'s 573,
and `MNT_FOREGROUND_R` 833 against 197. A left key rakes across the taller right
flank and leaves the shorter left one in shadow, which reads as one valley wall
turned to the light and one turned away. A right key does the reverse and
flattens the taller side into an even field, which is the one outcome that loses
the asymmetry.

## Mobile

The mobile preset keeps the left-hand side but brings the key round to −40° and
raises the wrap from 0.22 to 0.30. A 390 px portrait frame is about 15 degrees
wide, so the masses that survive the crop are seen almost edge-on; a fully
lateral key throws them onto their own shadow side. The more frontal angle
lights the inward-facing valley walls, which are the surfaces a phone actually
shows. It is the same decision, taken for a frame with different geometry in it.

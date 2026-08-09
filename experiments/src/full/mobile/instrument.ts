/**
 * The portrait instrument's arithmetic, with no `three` in it.
 *
 * Everything here is a pure function of numbers the page already has: the
 * altitude the shared ascent reader publishes, how far the instrument's slot
 * has travelled through the viewport, and the canvas's aspect ratio. Keeping it
 * in its own module — importing nothing — is what lets the stage component
 * decide *whether* to load a renderer without loading one to ask.
 *
 * ## What is deliberately not here
 *
 * No camera path, no altitude-driven travel, no exclusion band, no measured
 * feedback into layout. §7 of the brief allows exactly one art-directed camera
 * and small bounded adjustments; §12 forbids the instrument generating any
 * layout quantity at all. So the only thing this module knows about the page is
 * a number between 0 and 1 that says where the slot is on screen, and it is
 * read-only in that direction: nothing computed here can ever move the slot.
 */

export const DEG = Math.PI / 180;
const REV = Math.PI * 2;

/**
 * The instrument's outside diameter, in the GLB's own units.
 *
 * Measured from the model rather than guessed: `ALT_Housing_Flange` is the
 * widest node at ±0.5174, so the object is 1.0348 across. The camera solve
 * below is only correct because this number is the real one — a framing
 * constant that is 10% wrong produces an instrument that is 10% too big on
 * every phone, and nothing about the picture says which way.
 */
export const INSTRUMENT_DIAMETER = 1.0348;

/**
 * The vertical field of view, and it is narrow on purpose.
 *
 * A long lens is what makes a small object read as a photographed piece of
 * hardware rather than as a game asset: at 30° the bezel's near and far edges
 * are almost the same size, so the case reads as machined rather than as
 * splayed. It is also the desktop composition's neighbourhood (32°), which
 * matters more than either number — §21 asks for the same designed object on
 * both surfaces, and perspective is the first thing that gives away that two
 * renders are of two different objects.
 */
export const FOV = 30;

/**
 * How much of the frame's short axis the instrument occupies.
 *
 * §7: strong presence, not the whole viewport. 0.83 leaves a twelfth of the
 * frame as margin on each side — enough for the case to sit *in* a space rather
 * than against its edges, and enough that the pose yaw below can never push a
 * flange out of frame, since a yaw only ever shortens the projected width.
 *
 * Read against the viewport rather than the slot, this is 69% of the screen's
 * width at 390×844. Larger reads as a product shot pasted onto a page; the
 * frame the review approved is the one where the copy above it still leads.
 */
const FILL = 0.83;

/**
 * Where the camera has to stand for that fill, solved rather than tuned.
 *
 * §7 asks for the framing to be tuned independently at 430×932, 390×844,
 * 375×812 and 360×800. A four-row table of distances is the obvious way to do
 * that and it is the wrong one: it is four numbers that are right for four
 * viewports and silently wrong for the fifth, it does not survive a change to
 * the slot's height, and it says nothing about what any of the numbers mean.
 *
 * This is the same solve for all of them. `aspect` is the canvas's own ratio,
 * so the instrument keeps exactly the same fraction of the *short* axis on
 * every viewport in the matrix, in landscape, and at whatever the slot's height
 * clamps to in between. The four viewports are still checked — see the review
 * package — but they are checked as a consequence rather than tuned as a cause.
 */
export function cameraDistance(aspect: number): number {
  const perUnitHeight = 2 * Math.tan((FOV * DEG) / 2);
  const perUnitWidth = perUnitHeight * aspect;
  const short = Math.min(perUnitHeight, perUnitWidth);
  return INSTRUMENT_DIAMETER / (FILL * short);
}

/**
 * The needle mapping, and it is the accepted one on both surfaces.
 *
 * Identical to `AltimeterMeridian`'s, sign included, because this is the same
 * GLB with the same needles rotating about the same axis in the same
 * right-handed system. The SVG fallback flips the sign; that is a property of
 * SVG's clockwise-positive `rotate()` and not a second opinion about the dial.
 *
 * The dial is a 0–10 000 m instrument and the journey goes to 30 000 m, which
 * is not a mistake: a real three-pointer altimeter wraps, and the short pointer
 * completing three full turns is a more honest reading of 30 000 m than
 * rescaling the dial would be. The long needle covers 1 000 m per revolution,
 * and that number is not free to change — `initialAscent.meta` states it to the
 * visitor in all three locales and the portrait page shows that sentence.
 */
export const primaryAngle = (metres: number) => -((metres % 1000) / 1000) * REV;
export const secondaryAngle = (metres: number) => -(metres / 10_000) * REV;

/** The instrument's rest attitude — a three-quarter view that shows the case. */
const POSE = {
  /** Arriving from below: turned further away, tipped further back, held small. */
  entry: { pitch: -8 * DEG, yaw: 12.5 * DEG, scale: 0.93, z: -0.11 },
  /**
   * Composed. The frame the page is designed around, and the frame the visitor
   * lands on — at every viewport in the matrix the slot's crossing at scroll
   * zero is already inside the hold band, so the opening frame *is* this pose
   * rather than a moment on the way to it.
   *
   * Under seven degrees of yaw and under four of pitch. Enough that the bezel
   * has two visible faces and the crystal has somewhere to catch a highlight;
   * little enough that the numerals at 1 and 2 are not read through a
   * compression. Past about nine degrees the dial stops being a circle and
   * starts being an ellipse, which is the point at which an instrument reads as
   * a render of one.
   */
  held: { pitch: -3.6 * DEG, yaw: 6.8 * DEG, scale: 1, z: 0 },
  /** Leaving upward: squaring up to the viewer and settling back a little. */
  exit: { pitch: -0.8 * DEG, yaw: 2.4 * DEG, scale: 0.965, z: -0.055 },
};

export type Pose = { pitch: number; yaw: number; scale: number; z: number };

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Ease the two halves separately so the *held* pose is a plateau, not a
 * crossing.
 *
 * A single interpolation from entry to exit passes through the composed frame
 * at one instant and is never in it. The instrument would be turning
 * continuously for the whole time it is on screen, which is the "product
 * configurator" §6 rules out. Two eased legs with a flat middle means the
 * object arrives, *settles*, holds while the visitor is actually looking at it,
 * and then leaves — which is the difference between motion that is a property
 * of the object and motion that is a property of the scrollbar.
 */
const HOLD_FROM = 0.34;
const HOLD_TO = 0.62;

/** A symmetric ease. Restrained: nothing here overshoots, because mass does not. */
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

/**
 * The instrument's attitude, from how far its slot has crossed the viewport.
 *
 * `t` is 0 when the slot's top edge is at the bottom of the viewport and 1 when
 * its bottom edge has passed the top — a quantity the *stage* computes from one
 * cached measurement and `scrollY`, never from a live layout read. §12: the
 * canvas must not generate measured content offsets, and this is the direction
 * that guarantee runs in. The instrument is told where it is; it never says.
 */
export function poseAt(t: number): Pose {
  const p = clamp01(t);
  if (p <= HOLD_FROM) {
    const k = ease(p / HOLD_FROM);
    return {
      pitch: lerp(POSE.entry.pitch, POSE.held.pitch, k),
      yaw: lerp(POSE.entry.yaw, POSE.held.yaw, k),
      scale: lerp(POSE.entry.scale, POSE.held.scale, k),
      z: lerp(POSE.entry.z, POSE.held.z, k),
    };
  }
  if (p >= HOLD_TO) {
    const k = ease((p - HOLD_TO) / (1 - HOLD_TO));
    return {
      pitch: lerp(POSE.held.pitch, POSE.exit.pitch, k),
      yaw: lerp(POSE.held.yaw, POSE.exit.yaw, k),
      scale: lerp(POSE.held.scale, POSE.exit.scale, k),
      z: lerp(POSE.held.z, POSE.exit.z, k),
    };
  }
  return { ...POSE.held };
}

/** The composed pose, for reduced motion and for the loading silhouette. */
export const HELD_POSE: Pose = { ...POSE.held };

/**
 * Power-on, as one number.
 *
 * The instrument's markings and its beacon gain strength over the first stretch
 * of the ascent. It is the one piece of altitude-driven behaviour the portrait
 * instrument keeps beyond the needles, it costs a multiply per emissive
 * material, and it is what makes the dial read as an instrument that was
 * switched on rather than a render that was placed.
 *
 * ## Why it starts high and finishes early
 *
 * The desktop instrument ramps its emissives from a quarter of their authored
 * strength, over the first ninth of a thirty-screen track. Both halves of that
 * are wrong here and for the same reason: the portrait instrument is on screen
 * for about a screen and a half of a *document*, and the altitude across that
 * stretch is 0–200 m. Copying the desktop ramp would mean the visitor only ever
 * sees the bottom of it — the instrument would be at a quarter strength in the
 * frame the page opens on and would never visibly finish arriving.
 *
 * The other half is the background. Desktop's dial is lit at ground level
 * against a bright mountain valley; §11 puts a deep black behind this one, and
 * a marking that reads against a valley disappears against black. So the floor
 * is the accepted look's *end* state pulled most of the way down rather than a
 * quarter of it, and 160 m — the end of the opening section's altitude band —
 * is where it completes.
 */
export const powerAt = (metres: number) => clamp01(metres / 160);

/** The emissive multiplier at a given power. Floor first, ramp second. */
export const emissiveGain = (power: number) => 0.56 + 0.44 * power;

/**
 * Has anything moved enough to be worth a frame?
 *
 * The threshold is the whole of the on-demand contract, and it is not a
 * tolerance — it is what makes the settle *terminate*. An exponential chase
 * approaches its target and never arrives, so the value below is what decides
 * how long a flick keeps costing frames after the finger has left the glass.
 *
 * 5e-4 radians is 0.029°. The long needle's tip is 0.352 world units from the
 * hub, the instrument is drawn at roughly 135 device pixels per world unit at
 * 390×844 and 2x, so that is 0.05 device pixels of tip travel: a twentieth of a
 * pixel, on the fastest-moving point of the whole object.
 *
 * ## Why it was 1e-4 and why that was wrong
 *
 * Measured with the idle window in `probe-mobile-cost.mjs`, 1e-4 left the
 * renderer drawing for 3.2 seconds after a jump the length of the document —
 * 0.26 s of retain against fourteen natural logarithms of error. Invisible on
 * screen and perfectly visible in the counter, which is the whole reason that
 * probe exists.
 */
export const MOVED = 5e-4;

/**
 * How long each channel takes to give up 63% of its error, in seconds.
 *
 * Two groups, and the split is the point. The needles are the instrument's
 * mechanism and they are allowed to lag — §6's "heavy and physical" is not a
 * style, it is what a pointer with mass does. The pose is the *composition*,
 * and a composition that lags reads as the object sliding around inside the
 * frame rather than as the frame having been designed; it gets the shorter
 * constant so it tracks the scroll closely enough to feel attached to it.
 */
export const RETAIN = {
  primary: 0.15,
  secondary: 0.2,
  power: 0.18,
  pose: 0.12,
};

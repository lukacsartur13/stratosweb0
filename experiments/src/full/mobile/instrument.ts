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

/**
 * The instrument's attitude, and where it now comes from.
 *
 * ## What was here, and why it is gone
 *
 * A three-key pose table (entry / held / exit) interpolated from how far the
 * instrument's slot had crossed the viewport. That was the correct shape for an
 * object that lived in one section's block flow and was on screen for about a
 * screen and a half: it arrived from below, settled into a composed frame, held
 * while it was being looked at, and left upward.
 *
 * The instrument does not do that any more. It persists for the whole document
 * and is moved between authored positions, so "how far has the slot crossed the
 * viewport" is a question with no answer — the overlay is fixed and never
 * crosses anything. Attitude is now a property of the STATE, and the table
 * lives with the rest of the composition in `anchors.ts`, because a state's
 * position and a state's attitude are one design decision and splitting them
 * across two files is how they drift.
 *
 * `HELD_POSE` stays, and it is still the accepted hero attitude: it is what the
 * scene mounts at, what the loading silhouette is drawn behind, and what
 * reduced motion holds.
 */
export type Pose = { pitch: number; yaw: number };

/** The composed hero attitude. The frame the page opens on. */
export const HELD_POSE: Pose = { pitch: -3.6 * DEG, yaw: 6.8 * DEG };

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

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
 * The same idea for the overlay's travel, in the units the overlay moves in.
 *
 * `MOVED` is radians and cannot be reused here. A position settling towards a
 * target 600px away would need fourteen time constants — over four seconds — to
 * come within 5e-4 of a *pixel*, and every one of those frames is a `transform`
 * write. A quarter of a CSS pixel is under a device pixel at every scale factor
 * in the matrix, and it bounds the tail of a full-width move to about two
 * seconds, which is the point at which further arithmetic is not visible to
 * anyone.
 *
 * `MOVED_UNIT` covers scale and opacity, which are dimensionless: two
 * thousandths of either is well under a pixel on a 335px object and a change in
 * luminance nobody could name.
 */
export const MOVED_PX = 0.25;
export const MOVED_UNIT = 2e-3;

/**
 * How long each channel takes to give up 63% of its error, in seconds.
 *
 * Two groups, and the split is the point. The needles are the instrument's
 * mechanism and they are allowed to lag — §6's "heavy and physical" is not a
 * style, it is what a pointer with mass does.
 *
 * ## Why `pose` and `place` are now different numbers
 *
 * They used to be one, at 0.12s, because the pose tracked the scroll
 * continuously and a composition that lags a finger reads as the object sliding
 * around inside the frame. Neither half of that is true now: the pose changes
 * only at a state boundary, and the move between two authored positions is a
 * transition rather than a tracking.
 *
 * So `place` — the overlay's travel between positions — gets a long constant,
 * because that move IS the "hero object becomes flight instrument" gesture and
 * a fast one would read as a jump. `pose` is a shade quicker than the travel so
 * the case has finished turning by the time it lands, which is what makes the
 * arrival read as settling rather than as still adjusting.
 *
 * The hero leg is the exception and does not use either: it is scroll-linked,
 * so its target moves with the finger and the settle rides on top of it.
 */
export const RETAIN = {
  primary: 0.15,
  secondary: 0.2,
  power: 0.18,
  /** The attitude, at a state change. */
  pose: 0.26,
  /**
   * The overlay's position, scale and opacity, at a state change.
   *
   * 0.34 -> 0.22, and the reason is §15 of the temporal review rather than a
   * preference about how motion should feel.
   *
   * This is the one constant that decides whether the arrival's return LANDS.
   * The `arrival` state is active only while the visitor is in Act VI, and Act
   * VI's chapter on a phone is its content — a statement, the instrument's air
   * and one lead, 340px at 390x844. That is 0.38 s of scroll at an ordinary
   * phone pace: barely one time constant, so an exponential chase reached about
   * two thirds of the target and then began fading again. Measured against an
   * authored 0.44 opacity: 0.36 in a stepped walk with settling time at every
   * position, 0.34 at 900 px/s, 0.22 at 1 800, 0.16 at 3 200. The return never
   * reached its own value at any speed.
   *
   * The obvious fix — give the chapter more scroll — is the one this codebase
   * forbids: `portrait-journey.spec.ts` holds that no chapter may carry more
   * than a third of a screen of blank band, and on this surface a chapter's
   * length is its content. Buying duration with emptiness is exactly what that
   * contract exists to stop, and it was tried and correctly rejected by it.
   *
   * So the chase gets shorter instead. At 0.22 s the same 0.38 s of scroll is
   * 1.7 time constants and the state lands; three time constants is 0.66 s,
   * which is still a movement rather than a switch, and the withdrawal still
   * reads as the object receding. Every other state change on the page gets
   * crisper by the same amount, which is §22's pace contrast rather than a
   * regression: the phone's transitions were the slowest thing on a surface
   * whose reveals are all under a second.
   */
  place: 0.22,
};

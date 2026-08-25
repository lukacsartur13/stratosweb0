/**
 * The six acts — the approved luxury art direction, as data.
 *
 * ## What this is
 *
 * `_build/reports/luxury-art-direction/04-six-act-master-study.md` and the six
 * frames beside it are the design specification for this page. Everything in
 * this file is transcribed from them: the grid, the placements, the solved
 * monument sizes per act per locale, the authored line breaks, the Altimeter
 * appearance budget and the yellow budget. Nothing here was designed; the
 * design was done, approved, and is being implemented.
 *
 * ## What it is NOT
 *
 * It is not a second stage map. `journey.ts` still owns the eleven stages, the
 * altitude curve and the scroll shares, and none of them moved — see §B of the
 * production report. An act is a GROUPING over stages, and the six acts are the
 * six frames a visitor is meant to remember. The stages underneath them
 * survive as scroll stages that support the acts rather than compete with them
 * (§3 of the brief).
 *
 * ## The altitude chronology, which was the first blocker
 *
 * The study's §P1 recorded a real defect in the grouping: the Noise act was the
 * `cloud-entry` chapter at 6 000–8 500 m and the System act was
 * `lower-atmosphere` at 3 000–6 000 m, so a visitor running the six acts in
 * order would descend 2 500 m between the second and the third. §4 of the
 * production brief forbids that outright.
 *
 * It is fixed by REASSIGNING OWNERSHIP rather than by bending the altitude
 * curve or rewriting the copy, which is the order §5 asks for: the Noise
 * statement moves down to `initial-ascent` (150–3 000 m) and `cloud-entry`
 * takes the statement `initial-ascent` was carrying. Two chapters exchange
 * their titles; not one word of any string changed, no stage moved, no
 * altitude band moved, and the readout is monotonic through all six acts by
 * construction because the acts now run in stage order.
 *
 * The exchange also reads better than what it replaces. `Idelent minden zajos.`
 * — *down here everything is noisy* — is a sentence about being on the ground,
 * and it was set at eight and a half kilometres.
 *
 * ## The reference frame
 *
 * Every number below is in the study's own coordinates: a 1440 × 900 frame,
 * 120px margins, a 1200px type field, the spine at x = 120, the counter-axis at
 * x = 920 and the right margin line at x = 1320. `styles.css` scales the whole
 * frame by `min(100vw / 1440, 100svh / 900)`, so the composition is reproduced
 * exactly at every viewport instead of being re-solved per breakpoint.
 *
 * That scaling choice is also the answer to §19's font-loading hazard. Nothing
 * in this composition is measured at runtime: the sizes were solved once,
 * against real Archivo glyphs, and are transcribed. There is no
 * `document.fonts.ready`, no text measurement, no feedback loop and no late
 * layout shift, because there is nothing to measure.
 */

import type { Locale } from './i18n';
import type { StageId } from './journey';

export type ActId = 'i' | 'ii' | 'iii' | 'iv' | 'v' | 'vi' | 'action';

/** The act a stage belongs to, and whether it is that act's peak frame. */
export type ActRole = 'peak' | 'crossing';

// =============================================================================
// THE GRID. §C of the study, inherited unchanged from Direction D.
// =============================================================================

export const FRAME_W = 1440;
export const FRAME_H = 900;
/** The outer margin, all four sides. */
export const MARGIN = 120;
/** The right margin line — where right-aligned matter ends. */
export const EDGE = 1320;
/** Column 9. The axis every quiet block that is not on the spine sits on. */
export const COUNTER = 920;
/** The type field's width. */
export const FIELD = 1200;
/** Four columns. Every editorial block, in every act, in every locale. */
export const MEASURE = 400;

// =============================================================================
// THE SIX ACTS, MAPPED ONTO THE ELEVEN STAGES.
//
// Read the `peak` column downwards and the altitudes only ever increase. That
// is the whole of §B of the report and it is asserted by the regression suite
// rather than left as a claim — see `tests/full-ascent.spec.ts`.
// =============================================================================

export type Act = {
  id: ActId;
  /** The stage whose frame IS the act. */
  peak: StageId;
  /** Stages that run underneath the act without being frames of their own. */
  crossings: readonly StageId[];
  /** Roman numeral for the report and the tests. Not rendered. */
  numeral: string;
};

export const ACTS: readonly Act[] = [
  // I · GROUND — `Magasságot építünk.` 0–150 m. The instrument is established
  // here and this is the only act that carries it at full presence.
  { id: 'i', peak: 'calibration', crossings: [], numeral: 'I' },

  // II · NOISE — `Idelent minden zajos.` 150–3 000 m. The statement that used
  // to sit at 6 000–8 500 m. See the chronology note above.
  { id: 'ii', peak: 'initial-ascent', crossings: [], numeral: 'II' },

  // III · SYSTEM — `Hat terület, egy rendszer.` 3 000–6 000 m, unchanged. The
  // two chapters above it are the atmospheric crossing between this act and the
  // proof: they keep their content and lose their monuments.
  { id: 'iii', peak: 'lower-atmosphere', crossings: ['cloud-entry', 'cloud-breakthrough'], numeral: 'III' },

  // IV · PROOF — `~15M Ft`. 11 000–17 000 m. `system` and `process` carry real
  // business structure and are kept, subordinate, in the crossing after it —
  // §26 and §43 both forbid deleting them for the sake of the silhouette.
  { id: 'iv', peak: 'selected-work', crossings: ['system', 'process'], numeral: 'IV' },

  // V · HIGH ALTITUDE — `Innen már látni a görbületet.` 25 500–28 000 m. D3
  // unchanged; §30 makes weakening this frame a failure condition.
  { id: 'v', peak: 'stratosphere-transition', crossings: [], numeral: 'V' },

  // VI · ARRIVAL — `Üdv a sztratoszférában.` 28 000–30 000 m. The instrument's
  // return, and the last frame with no offer in it.
  { id: 'vi', peak: 'full-stratosphere', crossings: [], numeral: 'VI' },

  // The action beat. §14 and §31: a separate emotional beat, not the arrival
  // with a button added to it.
  { id: 'action', peak: 'destination', crossings: [], numeral: 'VI·b' },
] as const;

const ACT_OF = new Map<StageId, { act: ActId; role: ActRole }>();
for (const act of ACTS) {
  ACT_OF.set(act.peak, { act: act.id, role: 'peak' });
  for (const stage of act.crossings) ACT_OF.set(stage, { act: act.id, role: 'crossing' });
}

export const actOf = (stage: StageId): ActId => ACT_OF.get(stage)?.act ?? 'i';
export const actRoleOf = (stage: StageId): ActRole => ACT_OF.get(stage)?.role ?? 'crossing';
export const isPeak = (stage: StageId): boolean => actRoleOf(stage) === 'peak';
export const peakOf = (act: ActId): StageId => ACTS.find((a) => a.id === act)!.peak;

/**
 * How many screens a peak act's frame is pinned for, counted as the height of
 * the box the sticky frame lives in.
 *
 * The frame is one screen tall, so a hold of 1.8 keeps it composed and still
 * for 0.8 of a screen of scroll before it releases and the act's body flows up
 * behind it. 1.8 everywhere, deliberately: the acts differ in what is in them,
 * not in how long they are looked at, and a per-act hold would be a rhythm
 * nobody authored.
 *
 * Below 1.0 there is no hold at all — the frame arrives and leaves in the same
 * movement, which is what the first production capture of this design showed
 * and why the shares in `journey.ts` moved.
 */
export const ACT_HOLD = 1.8;

/**
 * THE GROUND ACT'S HOLD, AND THE ONE PLACE THE JOURNEY DOES NOT USE `ACT_HOLD`.
 *
 * The paragraph above says 1.8 everywhere and gives the reason: the acts differ
 * in what is in them, not in how long they are looked at. That reasoning is
 * still right for the six acts that have a body. It is not right for Act I, and
 * the temporal review is where the difference finally showed up, because it is
 * a difference you cannot see in a frame — only in scroll.
 *
 * Act I has no body. An act with no body carries `data-act-departs="no"` and
 * its frame therefore never releases (see `styles.css`), so it is composed for
 * its WHOLE panel rather than for the hold minus two ramps. Measured on the
 * shipped page at 1440x900: every other act's statement is at full strength for
 * 0.68–0.80 screens of scroll; Act I's is at full strength for 1.52. It is not
 * held twice as long because anyone chose that — it is held twice as long
 * because `hold` and `composed window` are the same number for a bodyless act
 * and different numbers for every other one.
 *
 * And Act I is the worst possible chapter to spend that surplus in. Its
 * altitude band is 0–150 m of a 30 000 m journey, so over its whole panel the
 * sky, the range and the instrument's recede move by amounts that are below
 * anything the eye can resolve. The scan's stillness test — frame, type and
 * instrument all static between two samples — reports 0.76 screens of it,
 * starting 0.21 of a screen into the page. That is the first thing a visitor
 * does on this site: scroll, and get nothing back.
 *
 * §14 of the temporal brief: *"The Hero should not force a long intro. Luxury
 * confidence does not require keeping the visitor captive."*
 *
 * 1.3 is where that stops. It leaves the ground frame composed for 1.06
 * screens — still the longest-composed act on the page by a third, still
 * unhurried, still a destination — and takes the stillness under 0.3, which is
 * the ordinary settle every other act already has. It is a number for ONE act
 * and it is named rather than inlined so that the exception is visible at the
 * top of the file next to the rule it breaks.
 *
 * `journey.ts` carries the matching share. The two have to move together: the
 * share is the panel's minimum height, so a hold below the share would be a
 * frame that unpins into empty panel rather than into the next chapter.
 */
export const GROUND_HOLD = 1.3;

// =============================================================================
// THE MONUMENT SETTINGS.
//
// Transcribed from `six-act/scale.json` by way of `six-act-scale.css`. Every
// number was solved from a measurement of real Archivo glyphs at wdth 100% —
// equal ink area across the three locales, clamped at 98% of the field and at
// 210px, neither clamp firing anywhere in the twenty-one settings.
//
// `foot` is the LAST BASELINE's y in the reference frame, which is how the
// study anchors a monument: a foot line holds across three locales at three
// different sizes, and a top edge does not.
//
// `lines` is the authored break, one entry per line, and it is authored in
// `locales/messages.ts` rather than here — this table only records how many
// there are, because the vertical solve needs the count and the audit needs to
// know when a translation has silently gained one.
//
// §17: the width axis is neutral everywhere. 96% is a calibrated lever that is
// banked and not used. There is no `stretch` column, deliberately.
// =============================================================================

export type Setting = {
  /** Type size in reference px. */
  size: number;
  /** Unitless line height. */
  leading: number;
  /** The last baseline's y, in reference px. */
  foot: number;
  /** How many authored lines the statement takes in this locale. */
  lines: number;
};

type ActScale = Record<Locale, Setting>;

export const MONUMENT: Record<ActId, ActScale> = {
  // A1 · ground — the smallest fill in the study (0.64), which is §23 enforced
  // by arithmetic: the hero's authority comes from the field around it.
  i: {
    hu: { size: 148, leading: 1.03, foot: 548, lines: 2 },
    en: { size: 137, leading: 0.94, foot: 548, lines: 2 },
    de: { size: 170, leading: 0.94, foot: 548, lines: 2 },
  },
  // A2 · noise — three lines, right-aligned, hung from the top. Fill 0.44, and
  // it is the one number in the study that had to be set twice: at a fill
  // consistent with the other acts a six-character longest line buys 198px,
  // which would have made the noise act larger than the high-altitude one.
  ii: {
    hu: { size: 167, leading: 0.94, foot: 600, lines: 3 },
    en: { size: 139, leading: 1.01, foot: 600, lines: 3 },
    de: { size: 161, leading: 0.94, foot: 600, lines: 3 },
  },
  // A3 · system — fill 0.74. German sets the widest line in the whole study at
  // 1 027px, which is what decided against the second instrument here.
  iii: {
    hu: { size: 162, leading: 0.94, foot: 662, lines: 2 },
    en: { size: 169, leading: 0.94, foot: 662, lines: 2 },
    de: { size: 150, leading: 0.94, foot: 662, lines: 2 },
  },
  // A4 · proof — the monument is a figure, not a sentence, and it is the only
  // setting in the study where three locales share a size: `~15M Ft` is seven
  // glyphs in all three.
  iv: {
    hu: { size: 179, leading: 0.94, foot: 440, lines: 1 },
    en: { size: 179, leading: 0.94, foot: 440, lines: 1 },
    de: { size: 179, leading: 0.94, foot: 440, lines: 1 },
  },
  // A5 · high altitude — fill 0.88, the largest in the study, unchanged from
  // Direction D's D3. §30 forbids weakening it.
  v: {
    hu: { size: 174, leading: 0.94, foot: 748, lines: 2 },
    en: { size: 151, leading: 0.98, foot: 748, lines: 3 },
    de: { size: 144, leading: 0.94, foot: 748, lines: 3 },
  },
  // A6 · arrival — centred, fill 0.86. Hungarian is the binding locale for the
  // first time: `sztratoszférában.` is one seventeen-character word, so the
  // fill has to run high to produce a modest size. The foot line is 386 and not
  // 376 because the Ü's umlaut is the tallest ink in the study and reached the
  // top margin at 376.
  vi: {
    hu: { size: 143, leading: 0.94, foot: 386, lines: 2 },
    en: { size: 128, leading: 0.94, foot: 386, lines: 2 },
    de: { size: 122, leading: 0.94, foot: 386, lines: 2 },
  },
  // The action beat — fill 0.66, quiet by design, on the same architectural
  // band Act I used for the same invitation.
  action: {
    hu: { size: 136, leading: 0.94, foot: 548, lines: 2 },
    en: { size: 140, leading: 0.94, foot: 548, lines: 2 },
    de: { size: 131, leading: 0.94, foot: 548, lines: 2 },
  },
};

// =============================================================================
// THE ALTIMETER APPEARANCE BUDGET. §E of the study, §32 of the brief.
//
// Two meaningful appearances in six acts. Everything else is ABSENT, and absent
// means the object is not in the picture — not faded, not greyed, not shrunk to
// a marker. §32 is explicit that an appearance must not be forced because the
// old scene system expects one.
//
// The placements are the study's, in reference-frame coordinates, expressed as
// the dial's centre and its diameter. `composition.ts` solves the world
// position and the scale that put the object exactly there, which is the same
// closed form the lateral rail already used, extended to the second axis.
// =============================================================================

export type Placement = {
  /** Dial centre, in reference px. */
  x: number;
  y: number;
  /** Dial diameter, in reference px. */
  dial: number;
  /**
   * WHETHER THIS ACT'S MONUMENT MAY BE OCCLUDED BY THE OBJECT. §45, §46.
   *
   * Declared, never inferred. The collision contract used to forbid every
   * overlap between the instrument and every piece of type, which was right
   * while the object stood beside the composition and is wrong now that it
   * stands in front of part of it. What replaces it is not a relaxation — it is
   * a second, narrower contract: `monument` allows exactly one pair, the act's
   * own Monument-scale statement against the instrument's housing, and nothing
   * else. Support copy, micro labels, the index, the routes, the action and any
   * type belonging to another element stay forbidden at every act, including
   * these (§25, §45).
   *
   * `none` is the default and it is what every act that carries the object
   * without standing in front of the words gets. Inferring the intent from
   * geometry — "they overlap, so the overlap must have been meant" — would
   * make the test tautological, which is §46's whole point.
   */
  occlusion?: 'none' | 'monument';
  /**
   * The authored pose, in degrees off the object's own base pose.
   *
   * §15: the object must not rotate merely because it can. These are the only
   * places the pose is authored at all, and the interpolation between them is
   * the minimum physical motion that gets from one to the next — see
   * `instrumentStateAt`.
   */
  pose?: { yaw: number; pitch: number };
  /**
   * THE HOUSING'S PROJECTED SILHOUETTE AT THIS POSE — §9, §10.
   *
   * The occlusion mask's centre offset and its two radii, all four as fractions
   * of `dial`, MEASURED off the shipped geometry at this exact placement by
   * `experiments/probe-silhouette.mjs` and transcribed here.
   *
   * §9 warns that a generic radial mask may fail once the housing rotates, and
   * the measurement says it half-fails: the SHAPE is a circle to within a few
   * per cent at every pose the art direction asks for — it is a round case seen
   * nearly face-on — but its SIZE and its CENTRE relative to the authored dial
   * are not constants. Three things move them, and all three are real:
   *
   *   the case opens   the bezel lifts toward the camera with altitude, so it
   *                    magnifies. 1.18 dials wide at the ground, 1.33 at 4 500 m
   *   the pose         yaw narrows the silhouette and shifts its centre
   *   the position     `railFaceYaw` turns the object back toward the camera by
   *                    an amount that depends on where in the frame it stands
   *
   * §10 asks for a small authored silhouette vocabulary rather than a new
   * renderer, and this is that vocabulary with the shape family collapsed to the
   * one the measurement found: four numbers per authored pose, four poses, and a
   * lerp between adjacent ones. Nothing is measured at runtime and nothing is
   * fitted — each row is a photograph of the object standing exactly where this
   * row puts it.
   *
   * Absent means the model's own nominal — see `HOUSING_OF_DIAL`.
   */
  mask?: { dx: number; dy: number; rx: number; ry: number };
  /**
   * How many screens into its own chapter the object begins to withdraw.
   *
   * Absent means "at the chapter's end", which is what every appearance did
   * before the temporal review and is still right for Act I: a bodyless act
   * never releases its frame, so its chapter and its composition end together.
   *
   * It is not right for an act that HAS a body, and Act VI is the one that
   * does. Its frame lets go 0.8 of a screen into a 2.83-screen panel and the
   * chapter runs on for two more screens of editorial copy and the route list.
   * The object was therefore in the picture for 3.5 screens of which only 1.4
   * were the arrival composition — measured — and the other 2.1 were a dark
   * dial sitting behind a paragraph and an eleven-row altitude table, which is
   * §15's "hang around after its purpose" almost word for word.
   *
   * In screens rather than as a fraction of the chapter, because the chapter's
   * length is content-driven and the frame's release is not: the release is
   * `ACT_HOLD − 1` by construction, wherever the body happens to end.
   */
  leaves?: number;
};

export const INSTRUMENT: Partial<Record<ActId, Placement>> = {
  // ACT I. 221px dial, its right edge on the right margin line at 1320, and
  // 202px of measured air between the end of the statement and the start of the
  // dial. Face-on and presented: this is the act where the object is
  // established as a precision artefact.
  //
  // REVISED BY THE DEPTH PROOF — §16, §17, §23, §24.
  //
  // 221px in the upper right with 202px of measured air beside the statement is
  // the composition §24 replaces. It is *polite*: two objects, side by side, in
  // separate rectangles, with the object small enough to read as a mark rather
  // than as a thing. The reference audit's finding is that the premium object is
  // never visually tiny and never in its own reserved box — the type and the
  // product occupy the same space, and the product is in front.
  //
  //   470px rather than 221      the dial is 52% of the frame's height. §23.
  //   centre (1085, 363)         the housing's left edge lands at 806, which is
  //                              65px into `Magasságot` — see below
  //   whole, not cropped         the crop is Act III's and Act V's vocabulary.
  //                              This is the frame where the object is
  //                              ESTABLISHED (§16), so it is seen entire, with
  //                              air above and below it.
  //
  // ## Where the occlusion edge falls is an art-direction decision, not a
  //    consequence of the size
  //
  // §17 asks for the phrase to stay instantly reconstructable and warns against
  // hiding so much of `Magasságot` that the apparent word changes. There is a
  // sharper version of that rule which the candidates made visible:
  //
  //     THE EDGE MUST CROSS A GLYPH, NEVER FALL BETWEEN TWO.
  //
  // At a 420px dial the housing's edge landed cleanly after `Magasság` — and
  // `magasság` is a Hungarian word. The frame then read as the sentence
  // *Magasság építünk*, which is not a sentence, and it read that way whether or
  // not the reader noticed the object. Nothing was covered; a word had simply
  // become shorter. At 470 the edge falls through the bowl of the `o`, the
  // fragment is visibly a fragment, and the eye completes the word before it has
  // finished asking the question. A partly covered letter says *something is in
  // front of this*; a cleanly ended word says *this is the word*.
  //
  // Line 2, `építünk.`, is untouched: §17's "both critical portions" is what
  // makes the phrase reconstructable at a glance rather than by inference.
  //
  // Measured against the frame's other objects at 1440x900: the support line and
  // the action are entirely in clear air, with 5px between the housing's lower
  // edge and the action's band. §25.
  //
  // `leaves` IS NEW HERE, AND THE LARGER OBJECT IS WHY.
  //
  // Act I is the one act with no body, so its frame never releases and its
  // chapter and its composition end together — which is the reason this entry
  // never needed a withdrawal number before. What changed is the size. At 221px
  // in the upper right the object could sit through the hand-over to Act II
  // without meeting anything; at 470px in the middle right it sits exactly where
  // `Idelent minden zajos.` arrives from, and the withdrawal — which pulls
  // toward the frame's centre, because that is what receding along the view axis
  // does — pulls it further into that statement rather than out of it.
  //
  // Photographed at 1.3 screens into the panel: the Hero's own statement has
  // scrolled away, the object is still at 82% of its presence, and Act II's
  // statement is fading up ACROSS it. Act II declares no occlusion, so that is a
  // §45 violation as well as a bad frame — the type paints over a dial that is
  // supposed to have left. `validate-meridian.mjs` reports it as 89 320px² of
  // text collision at 150 m.
  //
  // 0.85 is where it stops. The withdrawal is centred 0.93 measured screens in
  // and spans 0.44 either side, so:
  //
  //     at 0.4 screens   presence 1     — the composed frame, untouched, and
  //                                       the six-act contract reads it here
  //     at 1.15          presence 0.16  — 0.31 of its scale, against a statement
  //                                       that is itself at 10% of its arrival
  //     at 1.3           presence 0.02  — below the cut-off; not drawn
  //
  // The conversion is Act VI's: the value is in NOMINAL screens and the rendered
  // track is about 9% longer, so 0.93 measured is 0.85 written.
  i: {
    x: 1085,
    y: 363,
    dial: 470,
    occlusion: 'monument',
    leaves: 0.85,
    mask: { dx: -0.0532, dy: -0.0085, rx: 0.5915, ry: 0.5809 },
  },

  // ACT III · SYSTEM — `Hat terület, egy rendszer.`
  //
  // NEW. §18 is explicit about what this must not be: the study built a second,
  // small dial beside this statement and cut it, and a smaller instrument beside
  // a headline is exactly the "UI" reading the whole phase exists to escape.
  //
  // So the object is not beside the statement — it is a large instrument
  // entering the frame from the lower right, cropped by two edges, with the
  // statement running behind it.
  //
  //   800px dial                 89% of the frame's height, of which about half
  //                              is in the picture
  //   centre (1330, 790)         below and right of the frame's corner, so the
  //                              visible part is the housing's upper-left
  //                              quadrant and its bezel — the part that reads as
  //                              a precision object rather than as a circle
  //   cropped right and bottom   §18's "partial crop, off-axis placement"
  //
  // The edge falls through the `e` of `rendszer.`, which leaves `egy rendsz` —
  // not a word in any of the three locales, so the same rule Act I's note
  // states is satisfied here by construction rather than by luck. `Hat terület,`
  // is untouched.
  //
  // §19's protected matter is measured clear: the lead line at the counter-axis
  // (y 196) sits 138px above the housing's top edge, and the six capability
  // names along the foot (x 120–690) end 165px left of it. The compressed System
  // content from Phase 5.1 is not touched by this entry — no copy moved.
  iii: {
    x: 1330,
    y: 790,
    dial: 800,
    occlusion: 'monument',
    // Withdraws with its own frame rather than with its chapter — the reasoning
    // and the arithmetic are Act VI's, a few rules down, and this act has the
    // same shape: a body that runs on for two more screens after the frame lets
    // go at `ACT_HOLD - 1`. Without it the object was still being drawn at 8% of
    // its presence a third of a screen into the cloud-entry passage, which is a
    // passage that budgets no instrument at all.
    leaves: 1.15,
    pose: { yaw: -10, pitch: 3 },
    mask: { dx: 0.0407, dy: 0.0317, rx: 0.7031, ry: 0.6518 },
  },

  // ACT V · HIGH ALTITUDE — `Innen már látni a görbületet.`
  //
  // NEW, and the frame §30 forbids weakening. D3's picture is huge type, a clean
  // horizon and almost nothing else; the risk §21 names is that an instrument
  // added to it becomes a corner dial and turns the best frame on the page into
  // an interface.
  //
  //   980px dial                 the largest state on the page, and about a
  //                              quarter of it is in the picture
  //   centre (1600, 780)         off the frame on two sides. What is visible is
  //                              a dark limb: the housing's upper-left arc, one
  //                              bezel, and the outer chapter ring catching the
  //                              rim light — §21's "rim/specular information
  //                              defines the object" almost literally
  //   cropped right and bottom   §21's one-edge crop, taken on two
  //
  // The edge falls through the `n` of `látni`. `a görbületet.` is untouched
  // INCLUDING ITS FULL STOP, which is why the centre is at 1600 and not at the
  // 1560 the first pass liked better as a mass: at 1560 the housing swallowed the
  // period, and a statement that loses its own punctuation has been damaged
  // rather than occluded.
  //
  // The horizon is not touched. The earth's limb runs across the lower left and
  // the object enters on the right, so the two never meet — §36.
  //
  // ## The ring assembly is the reason this placement is as far out as it is
  //
  // Above 25 000 m the three meridian rings are deployed and their envelope is
  // about 1.2 dial diameters across against the housing's 0.7, so there is no
  // position in this frame where the statement can reach the HOUSING without
  // first crossing a RING — and the rings are not in the mask (see
  // `HOUSING_ASPECT` in `composition.ts` for why they cannot be). Type crossing
  // a lit ring arm is the one artefact this whole system produces, and it is
  // visible: the arm is brighter than the letters it passes under.
  //
  // What makes this placement work is that the key and the rim are concentrated
  // ON the housing, so the ring arms nearest the statement are the far side of
  // the gimbal and are unlit. Photographed at four points of the rings' own idle
  // rotation, 26 seconds apart, the arms that cross the statement stayed under
  // the sky's own luminance every time. §K of the depth report has the frames.
  v: {
    x: 1600,
    y: 780,
    dial: 980,
    occlusion: 'monument',
    // Same as Act III, and here it does a second job. Act V is the only act in
    // the table whose chapter is IMMEDIATELY followed by another that carries
    // the object, so this is where a continuous placement would read as the
    // high-altitude crop zooming out into the arrival instead of as the object
    // leaving and coming back. §31 asks the arrival to be a return. Withdrawing
    // at 1.15 empties the picture 0.45 of a screen before the arrival's own
    // entrance ramp opens, and `instrumentStateAt` spends that window moving the
    // placement while there is nothing on screen to see it move.
    leaves: 1.15,
    pose: { yaw: -16, pitch: 6 },
    mask: { dx: 0.0916, dy: 0.0462, rx: 0.6648, ry: 0.6526 },
  },

  // ACT VI. The return — recognisably the same object, and not the same
  // appearance.
  //
  // REFINED FROM THE STUDY, per §12–13 of the production brief. The approved
  // arrival was conceptually right and still read a little like a conventional
  // centred landing page: a statement in the upper half and an object centred
  // under it, with the pair's centre of mass on the frame's own mathematical
  // centre line. Three changes, all inside the approved language and none of
  // them adding an element:
  //
  //   the dial is 160px rather than 200      — §13's "slightly smaller"
  //   the air between them is 200px, not 177 — §13's "more vertical separation"
  //   the pair's ink centre lands at y = 442 — above the frame's 450, which is
  //                                            the optical rather than the
  //                                            mathematical centring §13 asks
  //                                            for, and it leaves 154px of
  //                                            silence under the dial: the
  //                                            act's largest void, below the
  //                                            pair rather than around it
  //
  // Nothing was added: no copy, no label, no yellow, no orbit line, no card.
  //
  // `leaves` is the temporal review's one change to this table and it changes
  // no coordinate. The object now withdraws WITH the arrival rather than
  // outstaying it by two screens.
  //
  // The number is the CENTRE of the withdrawal ramp, and it is solved so that
  // the ramp BEGINS where the frame does. The frame unpins at `ACT_HOLD − 1` =
  // 0.8 of a screen into the panel; the ramp is `PRESENCE_RAMP` either side of
  // its centre, which is 0.44 of a screen; and `instrumentPresenceAt` converts
  // this value with the NOMINAL `TRACK_VH` while the rendered track is about 9%
  // longer, so the value written here is scaled down by that ratio:
  //
  //     (0.8 + 0.44) × 22.9 / 24.96 ≈ 1.14
  //
  // At 1.15 the object holds full presence through the settled arrival — the
  // six-act contract reads it 0.4 of a screen into the hold and needs it above
  // 0.9 there, with 0.42 of a screen to spare — begins leaving as the frame
  // lets go, and is out of the picture 1.1 screens before the chapter ends,
  // which is the editorial block and the route list it used to sit behind.
  //
  // 0.95 was tried first and is 0.2 of a screen too early: the withdrawal
  // started before the frame had unpinned, which put the contract's settle
  // point on the shoulder of the ramp and made it pass or fail depending on
  // where the previous test had left the page.
  vi: { x: 720, y: 666, dial: 160, leaves: 1.15, mask: { dx: 0.0125, dy: 0.0125, rx: 0.65, ry: 0.6375 } },
};

/** Whether an act shows the instrument at all. */
export const hasInstrument = (act: ActId): boolean => INSTRUMENT[act] !== undefined;

// =============================================================================
// THE YELLOW BUDGET. §F of the study, §38 of the brief.
//
// Two events in the whole page, and four consecutive acts with none before the
// first. Declared as data so a test can assert it rather than a reviewer having
// to count it in screenshots.
// =============================================================================

export const YELLOW: Record<ActId, 'none' | 'figure' | 'action'> = {
  i: 'none',
  ii: 'none',
  iii: 'none',
  // `~15M Ft`, and nothing else in the act: not the client name, not the metric
  // label, not the marks, not the routes out.
  iv: 'figure',
  v: 'none',
  // Arrival is a state, not an offer.
  vi: 'none',
  action: 'action',
};

// =============================================================================
// =========================== T H E   P A S S A G E S =========================
// =============================================================================
//
// §2 of the continuity brief: from here the homepage has exactly TWO visual
// levels and no third.
//
//   LEVEL A · MASTER ACT      the seven approved frames above. Monumental,
//                             highly art-directed, sparse. Destinations.
//   LEVEL B · EDITORIAL PASSAGE  everything that connects them. Movement.
//
// The four crossings used to be the third language — the old website's rails,
// eyebrows, roman numerals, ring diagrams, three-column technical grids, mono
// microcopy on hairlines and yellow indices. §6 removes that presentation
// outright; §36 asks for the inventory first and `probe-crossings.mjs` is it.
//
// A PASSAGE IS NOT A SMALLER ACT. It shares the act's field, its grid, its
// units and its motion grammar — that is what makes the journey one brand —
// and it differs from an act in three things, all of them declared here as
// data rather than discovered in a stylesheet:
//
//   SCALE     58–72 reference px against the acts' 122–179. Under half a
//             monument, and roughly four times the editorial voice, so the
//             tier is unmistakable at thumbnail scale (§48).
//   HOLD      1.25 screens against the acts' 1.8, so a passage is pinned for a
//             quarter of a screen where an act is pinned for four fifths. §18:
//             an act is a destination and a passage is movement, and the
//             difference is how long the composition stands still.
//   DENSITY   one primary thought, one supporting statement, and at most one
//             structural layer — and the structural layer is STAGED BELOW the
//             frame rather than shown beside it (§10, §12). What the visitor
//             meets at any one scroll moment is the statement and its air.
//
// §32 asks for a small semantic vocabulary. This is the whole of it:
// `data-level`, `data-passage`, `data-axis`. There is no per-stage selector in
// the passage stylesheet.
// =============================================================================

/** The four chapters that are not frames. */
export type PassageId = 'cloud-entry' | 'cloud-breakthrough' | 'system' | 'process';

/**
 * What kind of passage this is.
 *
 *   statement  a quiet transitional thought and nothing under it
 *   structure  the same, with one layer of reference detail staged beneath it
 *
 * Two kinds and no third. §37: the smallest system that covers the crossings
 * without stage-specific hacks.
 */
export type PassageKind = 'statement' | 'structure';

/**
 * Which of the grid's two vertical axes the passage hangs on.
 *
 * The acts already use three placements — the spine at x = 120, the right
 * margin line at x = 1320 and, once, the centre. A passage takes one of the
 * two edges and never the centre: the symmetrical frame is Act VI's signature
 * and the argument for it is that no other frame in the design is symmetrical.
 *
 * They alternate down the journey — spine, edge, spine, edge — which is what
 * turns four crossings into a rhythm rather than four instances of the same
 * layout.
 */
export type PassageAxis = 'spine' | 'edge';

export type PassageSetting = {
  kind: PassageKind;
  axis: PassageAxis;
  /** Statement size in reference px. */
  size: number;
  /** Unitless line height. */
  leading: number;
  /** The last baseline's y, in reference px — the same anchor the acts use. */
  foot: number;
  /** How many authored lines the statement takes. */
  lines: number;
  /**
   * The quiet clause that runs ABOVE the statement, where the chapter's own
   * copy is a sentence too long to set whole.
   *
   * §8: select the strongest phrase from the EXISTING approved copy hierarchy
   * and let it control the passage. The hierarchy already exists — every
   * crossing title in `messages.ts` is authored in two halves, `.a` and `.em`
   * — so where the whole sentence cannot be a statement, `.a` becomes the
   * overline and `.em` becomes the statement. Not one word is rewritten and
   * the sentence still reads top to bottom in its own order.
   */
  overline: boolean;
};

/**
 * How many screens a passage's frame is pinned for.
 *
 * ## 1.25 was the right idea measured against the wrong quantity
 *
 * The number this file used to carry was 1.25, and the reasoning was that the
 * frame is one screen tall, so a passage holds still for a quarter of a screen
 * where an act holds still for four fifths — §18 expressed as one number.
 *
 * The reasoning is sound and the number was not, because the hold is not what
 * the visitor gets. What they get is the hold MINUS BOTH RAMPS: the frame
 * arrives over `--ramp-in` and starts leaving the moment it unpins, so the
 * window in which it is actually composed is `hold − 1 − (ramp-in − lead)` at
 * one end and nothing at the other. The ramps in `styles.css` were solved
 * against the act's 1.8 and the passage inherited them, and 0.55 screens of
 * shorter hold came almost entirely out of the composed window rather than out
 * of the movement either side of it.
 *
 * Measured on the shipped page at 1440x900, before this change:
 *
 *     master frames    composed 0.68 – 1.52 screens   (mean 0.91)
 *     passage frames   composed 0.13 – 0.17 screens   (mean 0.15)
 *
 * A ratio of 6.2 : 1. At an ordinary reading pace a passage statement was at
 * full strength for 0.12 – 0.16 SECONDS, and at a brisk one for 0.06 — which is
 * not a quieter tier, it is a flash, and §40 of the temporal brief names it as
 * a failure condition: *"no important statement flashes by"*. Four of the
 * eleven authored thoughts on this homepage are passage statements, including
 * the two §7 and §9 name by hand.
 *
 * ## 1.36, and where it comes from
 *
 * A passage is still movement and must still read as less than an act. The
 * target is therefore not parity but a legible fraction: HALF the act's
 * composed window, which measures 0.68–0.80 for the five acts that depart.
 *
 * With the passage's own ramp tempo — `styles.css` gives the passage a shorter,
 * more decisive arrival and departure than the act, which is §22's pace
 * contrast rather than a second motion language — the arrival completes 0.02 of
 * a screen into the panel, so
 *
 *     composed = (hold − 1) − 0.02 = 0.34 screens   at hold = 1.36
 *
 * against the act's 0.68. Exactly half, and it costs 0.11 of a screen per
 * passage — 0.44 in total, which is less than Act I gives back in the same
 * pass.
 *
 * Still clamped to the chapter's own share, because a hold longer than the
 * panel is a frame that never releases. `cloud-breakthrough` was the chapter
 * that clamp was written for and its share moves with this number — see
 * `journey.ts` — because a passage clamped below the passage hold is a passage
 * whose statement still flashes.
 */
export const PASSAGE_HOLD = 1.36;

export const PASSAGE: Record<PassageId, PassageSetting> = {
  // ---------------------------------------------------------------------------
  // `Egy weboldal önmagában / nem visz sehova.` — §7 names this frame directly.
  //
  // The statement survives; the composition around it does not. It used to be
  // a 70px `<h2>` under a rail, a roman numeral and an altitude range, with a
  // measured copy column to its lower right and three mono annotations on
  // hairlines under that — six objects and two type systems.
  //
  // It is now the largest passage on the page at 72u, on the spine, low, with
  // one supporting thought at the counter-axis and 300 reference pixels of air
  // above it. The three symptoms are staged below the frame, which is §10's
  // separation of MESSAGE from REFERENCE DETAIL.
  // ---------------------------------------------------------------------------
  'cloud-entry': { kind: 'structure', axis: 'spine', size: 72, leading: 1.0, foot: 620, lines: 2, overline: false },

  // ---------------------------------------------------------------------------
  // `…ugyanabba az irányba mozdul.` — §8.
  //
  // The quietest state on the homepage, and the one that has to be quietest:
  // it is the last thing before the Proof act, which is the loudest. The whole
  // sentence set as a headline was five lines of 69px type — a wall, and the
  // clearest surviving instance of body copy blown up to look like a heading.
  //
  // So the sentence is set in two registers at its own authored break: the
  // condition small, the consequence at 58u right-aligned to the margin line,
  // and one supporting line diagonally opposite it. Three objects, no body,
  // and the longest genuine silence in the journey after it.
  // ---------------------------------------------------------------------------
  'cloud-breakthrough': { kind: 'statement', axis: 'edge', size: 58, leading: 1.04, foot: 430, lines: 1, overline: true },

  // ---------------------------------------------------------------------------
  // `Kilenc terület, / három rétegben.` — §9, and the strongest surviving
  // example of the old language on the page.
  //
  // What it was: a 70px heading, a three-column grid, three bordered ring
  // blocks with yellow index numerals, nine `name — blurb` items and a 3D
  // concentric-ring diagram turning behind all of it. Twenty-one visible
  // objects in one frame, measured.
  //
  // §9 is explicit that this is not to be polished but recomposed, and that it
  // is a bridge rather than a new master act. The authored break is the one
  // the copy already has, at its own comma.
  // ---------------------------------------------------------------------------
  system: { kind: 'structure', axis: 'spine', size: 66, leading: 1.0, foot: 560, lines: 2, overline: false },

  // ---------------------------------------------------------------------------
  // `Hét ellenőrzőpont, / találgatás nélkül.` — §11.
  //
  // The densest state on the old homepage by a distance: forty-nine visible
  // objects, measured, in a four-column description grid repeated seven times
  // under index numerals and altitude stamps. §11 names what it read as —
  // admin UI, dashboard, system documentation, slide deck — and all four are
  // fair.
  //
  // The seven checkpoints are real business information and §12 forbids
  // deleting them. What is removed is their SIMULTANEITY: they are staged one
  // at a time down the passage's own scroll, in one quiet column, in the same
  // editorial voice an act's body uses.
  // ---------------------------------------------------------------------------
  process: { kind: 'structure', axis: 'edge', size: 58, leading: 1.0, foot: 680, lines: 2, overline: false },
};

/** Every chapter that is a passage, in journey order. */
export const PASSAGES = Object.keys(PASSAGE) as readonly PassageId[];

export const isPassage = (stage: StageId): stage is PassageId =>
  Object.prototype.hasOwnProperty.call(PASSAGE, stage);

/**
 * The level a chapter belongs to. Two values, and the page has no third.
 *
 * This is what the regression suite asserts against: every authored chapter
 * resolves to `master` or `passage`, and a chapter that resolves to neither is
 * a chapter that has been added without being designed.
 */
export type Level = 'master' | 'passage';
export const levelOf = (stage: StageId): Level => (isPeak(stage) ? 'master' : 'passage');

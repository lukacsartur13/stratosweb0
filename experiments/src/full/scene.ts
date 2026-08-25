/**
 * The art direction, one record per chapter.
 *
 * ## Why this module exists
 *
 * The page had one composition and eleven chapters in it. Every chapter opened
 * with an eyebrow, a headline sized from the same fraction of the same measured
 * column, a line, some annotations, and an instrument in the middle of the
 * frame at very nearly the same projected size — so the eleven read as eleven
 * instances of a template that happened to be scrolling upward. The parts were
 * each defensible; the sequence had no rhythm, because nothing in it varied
 * except the words.
 *
 * What varies now is declared here, and only here. Four decisions per chapter:
 *
 *   tier        how large the statement is allowed to become. Five tiers, and
 *               they are not five sizes — they are five *relationships* between
 *               a statement and the frame it is in.
 *   frame       where the chapter's mass sits, and which edge it engages.
 *   instrument  how prominent the Meridian is. §12: the dial is an instrument,
 *               and an instrument that is the same size in every scene has no
 *               dramaturgy.
 *   sky         which atmospheric condition the background stages.
 *
 * Everything downstream reads this table and nothing re-decides any of it:
 * `FullAscent` writes the four as data attributes, `styles.css` composes against
 * them, `composition.ts` folds the instrument role into the recede, and
 * `mobile.css` reads the tier through the same attribute on the mobile section.
 *
 * ## The rule that keeps it honest
 *
 * A record here may not vary with the viewport, the locale, the scroll position
 * or the direction of travel. It is authored art direction — a constant per
 * chapter — and everything that has to respond to a measurement responds to it
 * *underneath* this table rather than by editing it. That is what makes the
 * page's rhythm reproducible: the same eleven decisions on every device, with
 * the geometry solving them differently.
 */

import type { StageId } from './journey';

/**
 * How large the statement is relative to its frame.
 *
 * The fractions live in `styles.css` against `[data-monument]`; what is fixed
 * here is which chapter gets which relationship, and why.
 *
 *   colossus  The statement IS the scene. Three or four words, set as large as
 *             the frame will carry, with almost nothing else in the frame. Used
 *             where the chapter has one thing to say and the ascent has earned
 *             the room to say it: the stratosphere and the arrival.
 *   monument  The statement dominates but shares the frame with detail that
 *             passes beneath it. The default for a chapter that has an argument
 *             as well as a claim.
 *   hero      The opening. Four lines rather than two, and it shares its frame
 *             with the instrument at full size and with two calls to action, so
 *             it takes a slightly smaller fraction than `monument` in exchange
 *             for standing whole in one screen.
 *   plain     Deliberately NOT monumental. A chapter whose job in the sequence
 *             is to be quieter than the two around it — §18's rhythm needs
 *             troughs or the peaks are not peaks.
 *   long      A statement that is a sentence rather than a phrase. Sixty
 *             characters cannot be set at the monument fraction without
 *             becoming nine lines of nothing; these are held at a proportion
 *             their own content can carry and given the widest measure the
 *             geometry allows, so they read as long lines rather than as tall
 *             blocks.
 */
export type MonumentTier = 'colossus' | 'monument' | 'hero' | 'plain' | 'long';

/**
 * The Meridian's role in the scene.
 *
 * Folded into the recede by `composition.ts`, so this is a real change in the
 * object's projected size rather than an opacity trick — and because the copy's
 * room is budgeted against that same projected size, a chapter that pushes the
 * instrument back is automatically a chapter whose statement can be larger. The
 * two halves of §2's hierarchy are one number.
 *
 * ## Why there are six of these and not three
 *
 * There were three — `primary`, `secondary`, `trace` — and three was not enough
 * to be a dramaturgy. Seven of the eleven chapters took `trace`, so for two
 * thirds of the ascent the dial was the same object at the same size in the same
 * part of the frame, which is the note the direction sends back in as many
 * words: it must not feel like the same dial pasted into every frame.
 *
 * Six roles across eleven chapters means no more than two chapters ever share a
 * projected size, and the six are spaced far enough apart to be seen as
 * different objects rather than as one object measured differently. They are
 * relationships between the instrument and the frame, not six numbers:
 *
 *   hero       the instrument IS a subject of the frame. Two chapters: the
 *              opening, where the object is established, and the breakthrough,
 *              where the aperture opens and the chapter's drama is the
 *              instrument's rather than the statement's.
 *   monument   large, and second. The arrival — the finished Meridian is what
 *              the whole ascent was assembling, and it stands under a colossal
 *              question rather than beside a headline.
 *   companion  present, legible, clearly not the subject. It travels with the
 *              chapter rather than being looked at.
 *   edge       pushed back and railed hard to the side of the frame, where it
 *              frames the composition rather than occupying it. The two
 *              chapters whose statement is cropped by the opposite edge.
 *   distant    a marker at the edge of attention. What the visitor reads is the
 *              statement and the sky; the dial is a reference.
 *   recessed   atmospheric. An object in the air rather than in the frame, at
 *              the two altitudes where the sky is the picture — and the role
 *              that buys those two chapters the largest type on the page, since
 *              the statement's cap is the sky the instrument leaves.
 *
 *   absent     the object is not in the picture. Not faded, not desaturated,
 *              not shrunk to a marker — gone, and the frame composed as though
 *              it had never been there.
 *
 * ## `absent` is new, and it replaces the rule that used to forbid it
 *
 * This table used to end: *nothing is ever `absent` — do not delete it, do not
 * hide it arbitrarily, give it dramaturgy.* That was right for a design in
 * which the instrument was the page's continuous subject, and the six-act art
 * direction is not that design. §E of the master study budgets TWO meaningful
 * appearances across the whole homepage, and §32 of the production brief says
 * in as many words not to force one because the old scene system expects it.
 *
 * Six roles spaced 0.12–0.18 apart were a dramaturgy of size. The dramaturgy
 * now is presence: the object is established at the ground, it leaves, the page
 * carries itself on typography for eight chapters, and it returns once at the
 * arrival — which is what makes the return read as completion rather than as
 * the same dial pasted into another frame.
 *
 * Absence is not a recede. `SCENE_RECEDE` cannot express it — its whole range
 * bottoms out at 0.62 scale by construction — so it is a second quantity,
 * `SCENE_PRESENCE`, and `instrumentPresenceAt` in `composition.ts` ramps it.
 */
export type InstrumentRole =
  | 'hero'
  | 'monument'
  | 'foreground'
  | 'companion'
  | 'edge'
  | 'distant'
  | 'recessed'
  | 'absent';

/**
 * Where the chapter's mass sits, and which edge it engages.
 *
 * The frame is not the same thing as the copy side. `copySideOf` in
 * `composition.ts` answers which half of the viewport the column takes, which
 * is a consequence of where the instrument is railed; this answers what the
 * composition *does* with that half.
 *
 *   corner    mass gathered into one corner, the opposite corner given to a
 *             single small annotation. The most classical of the five.
 *   edge      the statement runs to the frame's outer edge and is allowed to be
 *             cropped by it. §11 — used twice, deliberately, because a page on
 *             which everything is cropped has no edge left to engage.
 *   field     the statement floats in an open field with the detail entering
 *             low. The high-altitude answer, and the fix for §20.
 *   plate     an editorial block that breaks the readability column and takes
 *             the whole of the room the instrument leaves. The Rapidkert
 *             feature and the process ledger.
 *   arrival   centred, minimal, the fewest elements on the page.
 */
export type FrameId = 'corner' | 'edge' | 'field' | 'plate' | 'arrival';

/**
 * The atmospheric condition the background stages, per §7.
 *
 * These are the five production-design states, not five gradients: each one
 * changes which of the wash layers in `.air` is carrying the frame, how heavy
 * the bottom of the picture is, and where the visual quiet zone the statement
 * sits in actually is. `styles.css` resolves them; the altitude ramps that
 * cross-fade between them stay in the stylesheet because they are continuous
 * and this table is not.
 *
 *   ground    heavy, dark, dense, terrain-weighted. The picture is bottom-heavy
 *             and the horizon is close.
 *   climb     the ground falling away. The vertical field opens and the weight
 *             moves off the bottom edge.
 *   clear     cleaner air, controlled haze, the largest gain in negative space.
 *             Typography starts to dominate here.
 *   deep      deep blue to near-black, high control, very sparse.
 *   summit    the most expansive and cleanest state, with the earth's curvature
 *             as the only reference.
 */
export type SkyId = 'ground' | 'climb' | 'clear' | 'deep' | 'summit';

export type Scene = {
  tier: MonumentTier;
  instrument: InstrumentRole;
  frame: FrameId;
  sky: SkyId;
  /**
   * How many lines the statement is authored to take at monumental scale.
   *
   * Authored rather than measured, and that is the point: the line breaks in
   * these statements are chosen by whoever wrote them, in three languages —
   * `text-wrap: balance` is switched off on this page for exactly that reason —
   * so the number of lines is a fact about the copy, not about the box.
   *
   * It is read by the vertical cap on the two frames whose statement has to
   * stand ABOVE the instrument rather than beside it (`field` and `arrival`).
   * There the statement's height is bounded by the sky between the deck and the
   * dial's top edge, and a size that fits the measure horizontally can still
   * descend into the instrument. `--monument-cap` divides that sky by this
   * number, so the largest size the chapter takes is the largest one that keeps
   * every line of it clear of the object — solved, rather than tuned until a
   * screenshot looked right at 1440.
   *
   * Where a chapter's translation runs to one more line than the Hungarian, the
   * cap is one line generous rather than one line short: the statement is
   * sized for the count here and the extra line is what the sky between the
   * dial's top and its widest point absorbs, which is the part of the frame the
   * circle is already giving back.
   */
  lines: number;
  /**
   * A per-chapter trim on the tier's fraction.
   *
   * The tiers say how a statement stands to its frame; this says what THIS
   * statement can carry. Two chapters take the same tier and cannot take the
   * same fraction of the same measure, because Hungarian gave one of them a
   * seventeen-character word — "sztratoszférában." is 6.5 em wide, so at the
   * colossus fraction it is 300px wider than the measure and breaks mid-word,
   * which at display size reads as a fault rather than as a wrap.
   *
   * 1 means the tier's own fraction, and most chapters take it. Anything else
   * is an authored exception with the reason written next to it — which is what
   * art direction is, and what a table of eleven silent magic numbers is not.
   */
  scale: number;
  /**
   * The same trim, for the phone.
   *
   * A second number rather than a share of the first, because the two are
   * bounded by different things. On desktop the statement's measure is solved
   * against the instrument and runs 470–1 320px; on a 390px phone it is the
   * viewport less its padding, 342px, for every chapter — so which statements
   * can take the top of their tier is a completely different question there.
   *
   * Nine of the eleven take their tier whole. The two that do not are the two
   * whose longest Hungarian word will not fit 342px at it:
   * "sztratoszférában." is 6.65 em, so the colossus tier overshoots by 10px and
   * the display line breaks mid-word — the fault §3 of the direction names, and
   * the one thing a headline at this size must never do.
   */
  mobileScale: number;
};

/**
 * The eleven chapters, as eleven different pictures.
 *
 * Read down the `tier` column and the rhythm §18 asks for is visible as data:
 * hero, plain, monument, monument, long, monument, colossus, plain, monument,
 * colossus, colossus. Two adjacent chapters never take the same tier *and* the
 * same frame *and* the same instrument role, which is the smallest formal
 * statement of "do not use one repeated template" that can actually be checked
 * — and `scene.spec` checks it.
 */
export const SCENE: Record<StageId, Scene> = {
  // ACT I · GROUND. 0–150 m. `Magasságot építünk.`
  //
  // The one act that carries the instrument, and the only chapter on the page
  // where it is a subject rather than absent. 221px dial, isolated in the upper
  // right on the right margin line, with 202px of air between it and the end of
  // the statement — see `acts.ts`.
  calibration: { tier: 'hero', instrument: 'hero', frame: 'corner', sky: 'ground', lines: 2, scale: 1, mobileScale: 1 },

  // ACT II · NOISE. 150–3 000 m. `Idelent / minden / zajos.`
  //
  // The statement moved down here from `cloud-entry` to make the six acts run
  // in altitude order — the chronology fix, recorded in `acts.ts` and in §B of
  // the production report. Right-aligned to the right margin line, three lines,
  // hung from the top, and nothing else in the frame but one quiet line at the
  // opposite corner. The instrument leaves during this act and does not come
  // back for eight chapters.
  'initial-ascent': { tier: 'monument', instrument: 'absent', frame: 'edge', sky: 'ground', lines: 3, scale: 1, mobileScale: 1 },

  // ACT III · SYSTEM. 3 000–6 000 m. `Hat terület, / egy rendszer.`
  //
  // Unchanged in ownership. The six areas are a colophon at the foot rather
  // than six cards: §25 rejects the dashboard and §26 keeps the content. The
  // second instrument was built for this act in the study and cut — German
  // leaves 17px of clearance beside it, and an object that has room in one
  // language and none in another is lucky rather than restrained.
  'lower-atmosphere': { tier: 'monument', instrument: 'foreground', frame: 'corner', sky: 'climb', lines: 2, scale: 1, mobileScale: 1 },

  // CROSSING. 6 000–8 500 m. The dense layer, with the statement
  // `initial-ascent` used to carry. A crossing is not a frame: it keeps its
  // content, loses its monument, and its job in the sequence is atmosphere and
  // anticipation — §39, §40.
  'cloud-entry': { tier: 'plain', instrument: 'absent', frame: 'corner', sky: 'climb', lines: 2, scale: 0.82, mobileScale: 0.9 },

  // CROSSING. 8 500–11 000 m. The air clearing before the proof.
  'cloud-breakthrough': { tier: 'plain', instrument: 'absent', frame: 'corner', sky: 'clear', lines: 4, scale: 0.78, mobileScale: 0.88 },

  // ACT IV · PROOF. 11 000–17 000 m. `~15M Ft`.
  //
  // The densest act in the study, deliberately, because it is the one whose job
  // is evidence rather than atmosphere. Four objects: the collaboration marks
  // across the top, the figure, two quiet lines, and the Rapidkert
  // cross-section rising from the lower right and cut by two edges of the
  // frame. The bottom left is empty on purpose.
  'selected-work': { tier: 'monument', instrument: 'absent', frame: 'plate', sky: 'clear', lines: 1, scale: 1, mobileScale: 1 },

  // CROSSING. 17 000–22 000 m. The nine areas in three rings.
  //
  // Real business structure, and §26 and §43 both forbid deleting it for the
  // sake of a silhouette — so it is kept and made subordinate. It was the
  // largest type on the page short of the arrival; it is now a quiet chapter
  // under the act it belongs to.
  system: { tier: 'plain', instrument: 'absent', frame: 'plate', sky: 'deep', lines: 2, scale: 0.78, mobileScale: 0.88 },

  // CROSSING. 22 000–25 500 m. The seven checkpoints. Same argument as above:
  // the densest information on the page, kept, and no longer a peak.
  process: { tier: 'plain', instrument: 'absent', frame: 'plate', sky: 'deep', lines: 2, scale: 0.78, mobileScale: 0.88 },

  // ACT V · HIGH ALTITUDE. 25 500–28 000 m. `Innen már látni / a görbületet.`
  //
  // Direction D's D3, unchanged: same statement, same authored break, same
  // fill, same foot line, same three objects, and the largest single void in
  // the study between the quiet line at the top and the monument at the foot.
  // No instrument, and no trace of one — §30 asks this scene to prove the
  // identity is stronger than the 3D object, and the way to prove that is for
  // the object not to be there.
  'stratosphere-transition': { tier: 'monument', instrument: 'foreground', frame: 'field', sky: 'deep', lines: 2, scale: 1, mobileScale: 1 },

  // ACT VI · ARRIVAL. 28 000–30 000 m. `Üdv a / sztratoszférában.`
  //
  // The instrument's return, and the only symmetrical frame in the design. Two
  // objects and the sky. The dial is 160px against the hero's 221 — the same
  // object, not the same appearance — and it sits low with the act's largest
  // void beneath it. See the refinement note in `acts.ts`.
  'full-stratosphere': { tier: 'colossus', instrument: 'monument', frame: 'arrival', sky: 'summit', lines: 2, scale: 1, mobileScale: 1 },

  // THE ACTION BEAT. 30 000 m. `Készen állsz / felemelkedni?`
  //
  // The emptiest frame on the page, and no instrument in it. §14 and §31 keep
  // arrival and conversion as two beats: the visitor has arrived, and then —
  // separately — is invited to act. The action is a line of type with a
  // hairline under it, at the editorial size, at weight 400. It is important
  // here because nothing competes with it.
  destination: { tier: 'colossus', instrument: 'absent', frame: 'arrival', sky: 'summit', lines: 2, scale: 1, mobileScale: 1 },
};

/**
 * How far back a role pushes the instrument, as an addition to the recede.
 *
 * `recededScale` runs 1 → 0.62 across the full recede and `recededDepth` pulls
 * back with it, so these six are six real projected sizes rather than six
 * opacities. Summed with the narrative recede and clamped to 1 by `recedeAt`,
 * which means no role can take the instrument below the 0.62 scale the accepted
 * composition already reached through the case studies: there is no altitude at
 * which this table makes the object smaller than a state the page contained
 * before it existed.
 *
 * The spacing is what makes them roles. Adjacent values are 0.12–0.18 apart,
 * which on a 1440×900 is 40–60px of dial — a step the eye reads as a different
 * object rather than as the same object slightly nearer. Three values spaced
 * 0.3 apart across eleven chapters gave the page seven identical frames; six
 * values spaced half that gives it eleven different ones.
 *
 * §12 asks for dramaturgy, not for the object to be hidden.
 */
export const SCENE_RECEDE: Record<InstrumentRole, number> = {
  // Exactly zero, and it stays exactly zero: the instrument's full-size states
  // are the ones the whole model was built for, and a scene role must never be
  // able to make it LARGER than the composition it was accepted at.
  hero: 0,
  // Large and second. On a 1440×900 the difference between this and `hero` is
  // about 30px of dial — enough that the arrival does not read as the opening
  // frame with different words, and far too little to make the finished
  // Meridian anything other than the object the page has been assembling.
  monument: 0.18,
  // Exactly zero, like `hero`, and for a different reason: an act that stands
  // the object in FRONT of its statement is authoring the object's projected
  // size directly, in reference pixels, through the placement table. A recede
  // would be a second, quieter opinion about the same number — and since the
  // scale solve and the occlusion mask both read the authored diameter, a
  // recede that disagreed with it would put the mask off the object by exactly
  // the amount it disagreed by.
  foreground: 0,
  companion: 0.3,
  // Between `companion` and `distant`, and it earns the step because it is
  // paired with the crop: these are the two chapters whose statement runs off
  // the frame's outer edge, so the instrument is what holds the opposite one.
  // An object that frames a composition has to be smaller than the composition
  // and larger than a reference mark.
  edge: 0.42,
  // What `trace` was. 0.34 was tried before it and is recorded here because the
  // reason it failed is the point: a 13% reduction is a number, not a change of
  // role — the frame still read as an instrument with a list beside it.
  distant: 0.55,
  // The furthest back the instrument ever goes, and the two chapters that take
  // it are the two whose picture is the sky. At 0.66 the projected silhouette is
  // about 70% of its `hero` size on a 1440×900 — smaller than any state the page
  // had, and still large enough that every mark, numeral and engraving on it is
  // legible, which is the bound this scale is written against.
  //
  // It pays for itself twice. The statement's vertical cap is the sky between
  // the deck and the dial's top edge, so the chapter that pushes the instrument
  // furthest back is automatically the chapter that can carry the largest type —
  // which is exactly the pair of chapters where the direction asks for it.
  recessed: 0.66,
  // Absence is not a distance, and this number is not what produces it —
  // `SCENE_PRESENCE` is. It is 1 so that everything sized against the
  // instrument's projected silhouette (the copy budget, the exclusion band, the
  // portrait bands) is sized against the smallest one, which is the correct
  // answer for a frame the object is not in. A band that reserved room for an
  // absent object would be the six-act design paying rent on the old one.
  absent: 1,
};

/**
 * Whether the instrument is IN the picture at all, per chapter.
 *
 * The second half of the appearance budget, and the half `SCENE_RECEDE` cannot
 * express: the recede bottoms out at 0.62 scale by construction, so no value in
 * that table can remove the object. This one can.
 *
 * Two chapters at 1 and nine at 0 — §E's "two meaningful appearances in six
 * acts", stated as data so `instrumentPresenceAt` can ramp it and the
 * regression suite can assert it. Ramped rather than switched: an object that
 * vanishes between two frames is a cut, and the visitor is climbing past it.
 */
export const SCENE_PRESENCE: Record<InstrumentRole, number> = {
  hero: 1,
  monument: 1,
  foreground: 1,
  companion: 1,
  edge: 1,
  distant: 1,
  recessed: 1,
  absent: 0,
};

export const sceneOf = (stage: StageId): Scene => SCENE[stage];

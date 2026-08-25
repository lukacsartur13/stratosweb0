import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { DirectionalLight, AmbientLight } from 'three';
import { settle, journey } from '../journey';
import { meridian } from '../meridian';

/**
 * The instrument's lighting, as a function of altitude.
 *
 * The scene's lights used to be four constants in `JourneyScene`, and they were
 * defensible for as long as the instrument was a dial: one object, one pose, one
 * good key angle. They stopped being defensible once the object grew three rings
 * and the sky above 25 000 m went black, because both of the moments the brief
 * cares most about are lighting moments and neither of them was getting any
 * light:
 *
 *   * **12 000 m.** The breakthrough is meant to come from the air clearing —
 *     less fog, more directional contrast, cleaner highlights on the machined
 *     edges. With a fixed key and a fixed ambient the only thing that actually
 *     changed at the breakthrough was the backdrop behind the instrument.
 *
 *   * **30 000 m.** The Meridian state has to work as a still image. It was the
 *     murkiest frame of the whole journey: the stratosphere is nearly black, so
 *     the environment probe has almost nothing to give the metal, and the rings
 *     — the parts that are supposed to make the silhouette — were reading as
 *     dark bands against a dark case against a dark sky.
 *
 * So the four numbers move, and they move for reasons that are the same reasons
 * the rest of the scene moves: `clarity` is the atmosphere getting out of the
 * way, `finalCalibration` is the instrument settling into its finished state.
 *
 * Three rules kept this from turning into a light show:
 *
 *   1. **Nothing here is a new effect.** No bloom, no volumetrics, no second
 *      pass, no post-processing. Four scalar intensities and one light that was
 *      not there before. The cost is four multiplies a frame.
 *   2. **Contrast, not brightness.** Through the deck the ambient comes *down*
 *      while the key goes up. The instrument does not get more lit, it gets more
 *      modelled — which is what "the fog left" looks like on metal.
 *   3. **The rim leads.** It used to be off for the first four fifths of the
 *      journey, on the argument that below 24 000 m there is a sky behind the
 *      instrument doing the separation for free. That argument belonged to a
 *      design in which the instrument was in every frame and the sky was
 *      bright. It is in two frames now, both of them on a near-black field, and
 *      §22 of the production brief asks for exactly the opposite arrangement:
 *      rim-led separation, a stronger black housing, much less ambient.
 *
 * ## THE RESTRAINED PRESENTATION — §O of the master study, §22–23 of the brief
 *
 * The study's finding is that the instrument's gaming / tech-object character
 * is mostly a property of how it is LIT rather than of the model, and it
 * isolated which change did the work. Applied here, translated to this scene's
 * own numbers rather than transplanted:
 *
 *   ambient  0.55 -> 0.15   The largest single step. At 0.55 there is no true
 *                           black anywhere on the object: the ambient fills the
 *                           housing's interior and its shadow side with an even
 *                           blue, so the form is read from tone rather than
 *                           from light — which is the render signature of a
 *                           game asset rather than of a photograph.
 *   fill     1.40 -> 0.60   Less diffuse fill, for the same reason.
 *   key      3.40 -> 2.90   and neutralised, #eef4ff -> #f2f5f9. A cold-blue
 *                           key on a dark object is a large part of what reads
 *                           as *futuristic interface*.
 *   rim      0 -> 1.50      The separation is handed to a neutral rim, which
 *                           draws the housing's edge against a near-black field
 *                           WITHOUT raising the exposure to do it.
 *
 * The `final` terms are LARGER than they were, and that is not a partial
 * reversal of the ambient cut — it is the same argument the original code makes
 * one paragraph up. Above 25 000 m the sky is black and the environment probe
 * has nothing to give the metal, so an object cut to a photographic ambient at
 * 30 000 m is an object nobody can see. The first capture of the arrival under
 * the restrained recipe was a black ring on a black field. Restraint at the
 * ground and a lit object at the ceiling are the same decision read at two
 * altitudes: the light comes from the scene where there is one, and from the
 * instrument's own key and rim where there is not.
 *
 * What is deliberately NOT translated is the study's 17-degree lens. That was a
 * property of an isolated object render; the production camera frames the
 * mountains, the cloud deck and the earth limb through the same field of view,
 * and narrowing it to flatter the bezel would re-frame the whole journey. §23
 * asks for the visual intent rather than the numbers, and this is the number
 * whose intent does not survive the transplant. It is recorded in the report.
 *
 * The model, its materials and the GLB are untouched. §22: do not remodel the
 * asset.
 *
 * ## THE ARRIVAL'S OPTICAL PASS — §25 of the continuity brief
 *
 * The production report's §L5 and §M3 recorded the defect and asked for
 * production evidence before a pass was made. `probe-arrival-instrument.mjs`
 * is that evidence, taken off the built page: the crop the arrival dial
 * occupies measured p05 3.7, p50 5.9, and 24.8% ink — three quarters of the
 * object's own box was indistinguishable from the field behind it. It was
 * reading as a black patch rather than as a black object, which is exactly the
 * risk §25 names.
 *
 * §25 permits four levers and forbids the fifth. Rim separation, environment
 * reflection, bezel readability, roughness and specular response, and a subtle
 * key/fill balance are in scope; making the object bright, glowing, silver or
 * high-contrast is not. So the pass moves the FINAL terms only — the ones that
 * reach zero below the stratosphere — and it moves the ambient DOWN:
 *
 *   ambient final  0.45 -> 0.16   The housing stays deep black. This is the
 *                                 term that was flattening it: ambient light on
 *                                 a dark object raises the floor everywhere at
 *                                 once and gives the form nothing to be read
 *                                 from. §25's goal is a black object with
 *                                 legible form, and the way to a legible form
 *                                 is not more light on the shadow side.
 *   fill    final  0.75 -> 0.40   The same argument on the far side.
 *   rim     final  5.0  -> 20.0   Where the legibility comes from instead, and
 *                                 the number is large because the rim's
 *                                 contribution is confined by geometry: it sits
 *                                 behind the object, so it reaches the
 *                                 silhouette edge, the bezel's inner facets and
 *                                 the upper limbs of the concentric rings, and
 *                                 nothing that faces the viewer. A sweep of
 *                                 0, 5, 12 and 20 measured p99 IDENTICAL at
 *                                 47.4 across all four while the ink share rose
 *                                 25.3 -> 26.1%, which is exactly the property
 *                                 §25 asks for: more form, no more brightness.
 *   key     final  5.0  -> 7.5    The compensation for the ambient, on the lit
 *                                 side only.
 *
 * Measured at the arrival, on the built page, against the same crop: the
 * highlight range p95/p99 goes 39.4/42.7 -> 43.4/47.4 out of 255 and the
 * spread 39.1 -> 43.8, with zero pixels above 235 before or after. An object
 * whose brightest percentile is 19% of white is a black object; what changed is
 * that its form can be read.
 *
 * WHAT WAS INVESTIGATED AND NOT SHIPPED: the environment probe's lower ring.
 * §25 names environment reflection and it was the first thing tried, on the
 * theory that the underside of the housing had nothing to reflect. Raising
 * `Lightformer` three from 0.7 to 1.5 moved the arrival's ink share by 0.2
 * points — inside the noise — and it is the one lever in this list that is
 * shared with Act I. A change that does nothing measurable and can only put a
 * protected master frame at risk is not a change; the probe is in the report
 * and the emitter is untouched.
 *
 * Not one of these terms is in force at Act I: `finalCalibration` is zero
 * through the first nine chapters, so the opening instrument's light is
 * arithmetically identical to what it was. That is checked rather than assumed
 * — the probe measures Act I in the same run.
 *
 * NO GEOMETRY CHANGED, no material was replaced, no GLB was touched and no
 * object was added. §26.
 *
 * Damped rather than applied directly, like everything else that reads the
 * altitude: the altitude itself is damped, but a debug slider is not, and a jump
 * from 0 to 30 000 m should still light up rather than cut.
 */
export function MeridianLights({ simplified }: { simplified: boolean }) {
  const ambient = useRef<AmbientLight>(null);
  const key = useRef<DirectionalLight>(null);
  const fill = useRef<DirectionalLight>(null);
  const rim = useRef<DirectionalLight>(null);

  // One smoothed pair rather than four: the two drivers are what is being
  // eased, and every intensity below is an affine function of them, so easing
  // the drivers eases the lights and keeps their relationship exact.
  const s = useRef({ clarity: 0, final: 0 });

  useFrame((_, delta) => {
    if (!journey.running) return;
    const dt = Math.min(delta, 1 / 20);

    s.current.clarity = settle(s.current.clarity, meridian.clarity, 0.88, dt);
    s.current.final = settle(s.current.final, meridian.finalCalibration, 0.9, dt);

    const { clarity, final } = s.current;
    const gain = journey.debug.lightGain;

    // Ambient falls through the deck and comes part of the way back at the top.
    //
    // The fall is the contrast: haze is ambient light, and losing it is what
    // makes the bevels appear. The return is not a reversal of that — it is
    // the black sky. Above 25 000 m the environment probe has nothing to give
    // the metal, and an instrument lit only by a key light in front of an empty
    // background reads as a cut-out rather than as an object in space.
    if (ambient.current) ambient.current.intensity = (0.30 - 0.07 * clarity + 0.16 * final) * gain;

    // The key. It carries the breakthrough and it carries the final reveal.
    if (key.current) key.current.intensity = (4.2 + 1.3 * clarity + 7.5 * final) * gain;

    // The cool fill from the far side. It follows the key at the top so the
    // rings' far limbs do not fall into the background, but it deliberately
    // does *not* follow it through the deck — that is where the contrast comes
    // from.
    if (fill.current) fill.current.intensity = (0.80 - 0.20 * clarity + 0.40 * final) * gain;

    // The rim, and the only light that is ever switched on rather than adjusted.
    // Behind and above, so it catches the top edge of every ring band and the
    // upper bevel of the case: the one cheap way to make three concentric metal
    // circles legible against a black sky without touching the exposure.
    if (rim.current) rim.current.intensity = (2.0 + 20.0 * final) * (simplified ? 0.7 : 1) * gain;
  });

  return (
    <>
      <ambientLight ref={ambient} intensity={0.3} color="#8ea3bd" />
      <directionalLight ref={key} position={[-2.4, 3.2, 2.6]} intensity={4.2} color="#f2f5f9" />
      <directionalLight ref={fill} position={[3.0, -1.4, -1.8]} intensity={0.8} color="#5b7ba8" />
      <directionalLight ref={rim} position={[1.6, 2.2, -3.0]} intensity={2} color="#d8e3f2" />
    </>
  );
}

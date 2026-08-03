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
 *   3. **The rim is the only addition, and it only exists at the top.** It is
 *      off for the first four fifths of the journey and arrives with the third
 *      ring, because that is the first frame where there is a silhouette worth
 *      separating from the background. Below 24 000 m there is a sky behind the
 *      instrument doing that job for free.
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
    if (ambient.current) ambient.current.intensity = (0.55 - 0.16 * clarity + 0.13 * final) * gain;

    // The key. It carries the breakthrough and it carries the final reveal.
    if (key.current) key.current.intensity = (3.4 + 1.5 * clarity + 0.9 * final) * gain;

    // The cool fill from the far side. It follows the key at the top so the
    // rings' far limbs do not fall into the background, but it deliberately
    // does *not* follow it through the deck — that is where the contrast comes
    // from.
    if (fill.current) fill.current.intensity = (1.4 - 0.35 * clarity + 0.6 * final) * gain;

    // The rim, and the only light that is ever switched on rather than adjusted.
    // Behind and above, so it catches the top edge of every ring band and the
    // upper bevel of the case: the one cheap way to make three concentric metal
    // circles legible against a black sky without touching the exposure.
    if (rim.current) rim.current.intensity = final * (simplified ? 1.5 : 2.2) * gain;
  });

  return (
    <>
      <ambientLight ref={ambient} intensity={0.55} color="#8ea3bd" />
      <directionalLight ref={key} position={[-2.4, 3.2, 2.6]} intensity={3.4} color="#eef4ff" />
      <directionalLight ref={fill} position={[3.0, -1.4, -1.8]} intensity={1.4} color="#5b7ba8" />
      <directionalLight ref={rim} position={[1.6, 2.2, -3.0]} intensity={0} color="#c3d6ef" />
    </>
  );
}

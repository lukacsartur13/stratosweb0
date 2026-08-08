import { useEffect, useState } from 'react';
import { CEILING_M, formatAltitude, journey } from '../journey';
import { m } from '../i18n';
import { MERIDIAN_STAGES, meridianStageAt, type MeridianStageId } from '../meridian';
import { MeridianDrawing } from './MeridianDrawing';

/**
 * What the Meridian looks like when the 3D scene must not, or cannot, run.
 *
 * Not a placeholder box, and not a still of the ground state either: the same
 * instrument, drawn as inline SVG, at whichever of its six structural states
 * applies. No network request, no WebGL, no motion of any kind. `three` is
 * never imported on this path, which is the whole point — a visitor who has
 * asked for reduced motion should not pay ~600 KB of renderer plus a 397 KB
 * model to be told the page will hold still for them.
 *
 * ## Why six states rather than one picture
 *
 * The Meridian's argument is that the instrument *becomes* something. A single
 * static dial makes that argument disappear for anyone on this path, and a
 * single static Meridian makes the opposite claim — that it was always like
 * that. Six states is the smallest set that carries the progression, and it is
 * the same set the accessible description announces.
 *
 * How the state is chosen depends on why we are here:
 *
 *   * **reduced motion** — the visitor picks. There is no scroll-driven scene
 *     to follow, so the states are a small set of controls. Selecting one
 *     replaces the drawing instantly; nothing transitions, nothing eases, and
 *     nothing moves under anyone who did not ask it to.
 *   * **no WebGL / lost context** — the altitude readout is still live on this
 *     path (see `useNativeScrollDriver`), so the drawing follows it, switching
 *     between the six states at their thresholds. Discrete switches rather than
 *     interpolation: this path has no animation budget and a static instrument
 *     that steps is honest, where one that tweens is a worse version of the
 *     scene it is standing in for.
 */
export function JourneyFallback({
  reason,
}: {
  reason: 'reduced-motion' | 'no-webgl' | 'context-lost' | 'low-capability';
}) {
  // The prop is the key. A new reason is then a type error here and in
  // `messages.ts` at once, rather than a chain that silently falls through to
  // the context-lost sentence.
  const note = m(`fallback.note.${reason}`);

  const manual = reason === 'reduced-motion';
  const [picked, setPicked] = useState<MeridianStageId>('baseline');
  const [tracked, setTracked] = useState<MeridianStageId>('baseline');

  // Follow the altitude on the paths that still have one. Polled rather than
  // subscribed, at four times a second: the state changes six times over eleven
  // screens, and a rAF loop to notice that is a loop this path should not be
  // running at all.
  useEffect(() => {
    if (manual) return;
    const id = setInterval(() => setTracked(meridianStageAt(journey.altitude).id), 250);
    return () => clearInterval(id);
  }, [manual]);

  const active = manual ? picked : tracked;
  const stage = MERIDIAN_STAGES.find((s) => s.id === active) ?? MERIDIAN_STAGES[0];

  return (
    <div className="fallback" data-testid="journey-fallback" data-reason={reason} data-state={active}>
      {/* The drawing moved to `MeridianDrawing` when the portrait-mobile
          homepage needed the same instrument. Same markup, same ids, same
          construction — see the note there. */}
      <MeridianDrawing className="fallback__dial" state={active} />

      {manual && (
        <div className="fallback__states" role="group" aria-label={m('fallback.states.label')}>
          {MERIDIAN_STAGES.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setPicked(s.id)}
              aria-pressed={s.id === active}
              data-testid={`fallback-state-${s.id}`}
            >
              <span>{s.label}</span>
              <i>{formatAltitude(s.from)} m</i>
            </button>
          ))}
        </div>
      )}

      <p className="fallback__state-note" data-testid="fallback-state-note">
        {stage.description}
      </p>

      <p className="fallback__note" data-testid="fallback-note">
        {note}
      </p>
      <p className="fallback__range">0 – {formatAltitude(CEILING_M)} m</p>
    </div>
  );
}

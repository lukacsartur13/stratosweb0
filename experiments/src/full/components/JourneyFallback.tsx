import { useEffect, useState } from 'react';
import { CEILING_M, formatAltitude, journey } from '../journey';
import { m } from '../i18n';
import { MERIDIAN_STAGES, meridianStageAt, type MeridianStageId } from '../meridian';

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
      <StaticMeridian state={active} />

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

// =============================================================================
// The drawing.
//
// Deliberately the same construction as the 3D instrument rather than a
// separate illustration: the same ten-division scale, the same three rings made
// out of the same parts of the same dial, the same eleven-bladed iris. A
// fallback that is a *different* object teaches the visitor the wrong thing
// about the one they cannot see.
//
// The rings are drawn as ellipses, which is what a tilted circle is in
// projection: cos of the tilt angle gives the minor axis, and the same angles
// as the WebGL configuration produce the same silhouette.
// =============================================================================

const MAJOR = Array.from({ length: 10 }, (_, i) => i);
const MINOR = Array.from({ length: 50 }, (_, i) => i).filter((i) => i % 5 !== 0);

/** How far each state has got through each mechanism. 0..1, no interpolation. */
const CONFIG: Record<MeridianStageId, { aperture: number; rings: [number, number, number] }> = {
  baseline: { aperture: 0.055, rings: [0, 0, 0] },
  'first-ring': { aperture: 0.45, rings: [1, 0, 0] },
  'aperture-open': { aperture: 1, rings: [1, 0, 0] },
  'second-ring': { aperture: 1, rings: [1, 1, 0] },
  'third-ring': { aperture: 0.72, rings: [1, 1, 1] },
  meridian: { aperture: 0.72, rings: [1, 1, 1] },
};

/** The same mechanism as the 3D iris, at SVG scale. */
const IRIS_PIVOT = 30;
const IRIS_CRANK = 14.3;
const IRIS_EDGE = 13.8;
const BLADES = 11;

function polar(deg: number, r: number) {
  const a = ((deg - 90) * Math.PI) / 180;
  return [200 + Math.cos(a) * r, 200 + Math.sin(a) * r] as const;
}

function StaticMeridian({ state }: { state: MeridianStageId }) {
  const { aperture, rings } = CONFIG[state];
  const holeR =
    Math.sqrt(
      IRIS_PIVOT ** 2 + IRIS_CRANK ** 2 - 2 * IRIS_PIVOT * IRIS_CRANK * Math.cos((aperture * Math.PI) / 2),
    ) - IRIS_EDGE;

  return (
    <svg
      className="fallback__dial"
      viewBox="0 0 400 400"
      role="img"
      aria-label={[
        m('fallback.dial.pre'),
        MERIDIAN_STAGES.find((s) => s.id === state)?.label ?? '',
        m('fallback.dial.post'),
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <defs>
        <radialGradient id="f-face" cx="50%" cy="38%" r="72%">
          <stop offset="0%" stopColor="#1a2333" />
          <stop offset="100%" stopColor="#070b13" />
        </radialGradient>
        <linearGradient id="f-bezel" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#4a5057" />
          <stop offset="55%" stopColor="#23262b" />
          <stop offset="100%" stopColor="#3a3f45" />
        </linearGradient>
        <linearGradient id="f-ring" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#7c8794" />
          <stop offset="52%" stopColor="#39424c" />
          <stop offset="100%" stopColor="#6a7480" />
        </linearGradient>
      </defs>

      {/* Ring 3 first: it is behind the instrument once it has separated. */}
      {rings[2] > 0 && <SpatialRing rx={196} tilt={-38} spin={40} width={9} ticks={28} certified />}

      <circle cx="200" cy="200" r="196" fill="url(#f-bezel)" />
      <circle cx="200" cy="200" r="176" fill="url(#f-face)" />
      <circle cx="200" cy="200" r="176" fill="none" stroke="#000" strokeOpacity="0.6" strokeWidth="2" />

      {/* The full-scale arc: the ceiling marker, and the dial's one yellow. */}
      <path
        d={`M ${polar(288, 128).join(' ')} A 128 128 0 0 1 ${polar(360, 128).join(' ')}`}
        fill="none"
        stroke="#FFEE25"
        strokeOpacity="0.65"
        strokeWidth="6"
      />

      {/* The minor scale, unless Ring 2 has taken it off the face. */}
      {rings[1] === 0 &&
        MINOR.map((i) => {
          const [x1, y1] = polar(i * 7.2, 152);
          const [x2, y2] = polar(i * 7.2, 168);
          return <line key={`m${i}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#8A929B" strokeWidth="2" />;
        })}

      {/* The major scale. When Ring 1 has lifted it, the seat it was mounted in
          is left behind with its ten-division register — the face keeps a scale
          the needle can still be read against. */}
      {rings[0] === 0
        ? MAJOR.map((i) => {
            const [x1, y1] = polar(i * 36, 136);
            const [x2, y2] = polar(i * 36, 168);
            return (
              <line
                key={`M${i}`}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke="#CBDCE9"
                strokeWidth="5"
                strokeLinecap="round"
              />
            );
          })
        : (
            <g data-testid="fallback-seat">
              <circle cx="200" cy="200" r="168" fill="none" stroke="#5c6773" strokeWidth="3" />
              {MAJOR.map((i) => {
                const [x1, y1] = polar(i * 36, 160);
                const [x2, y2] = polar(i * 36, 176);
                return (
                  <line key={`S${i}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#93a1b0" strokeWidth="4" />
                );
              })}
            </g>
          )}

      {/* The numerals never leave the dial. They are what keeps it an altimeter. */}
      {MAJOR.map((i) => {
        const [tx, ty] = polar(i * 36, 116);
        return (
          <text
            key={`N${i}`}
            x={tx}
            y={ty}
            fill="#CBDCE9"
            fontSize="30"
            textAnchor="middle"
            dominantBaseline="central"
          >
            {i}
          </text>
        );
      })}

      <text x="200" y="140" fill="#8A929B" fontSize="14" textAnchor="middle" letterSpacing="1">
        ×1000 m
      </text>
      <text x="200" y="258" fill="#8A929B" fontSize="12" textAnchor="middle" letterSpacing="3">
        ALTITUDE
      </text>
      <text x="200" y="286" fill="#CBDCE9" fontSize="15" textAnchor="middle" letterSpacing="2.5">
        STRATOS
      </text>

      <Iris hole={holeR} calibrated={state === 'third-ring' || state === 'meridian'} />

      {/* The needles, over the aperture, exactly as in the scene. */}
      <path d="M 196 214 L 204 214 L 202 68 L 198 68 Z" fill="#F4F4F4" />
      <path d="M 193 210 L 207 210 L 204 108 L 196 108 Z" fill="#6E767F" />

      {/* The fixed central axis: it extends rearward as the instrument opens,
          which in a head-on projection is the boss at the centre growing a
          collar. It never moves off centre, in any state. */}
      <circle cx="200" cy="200" r="13" fill="#4A4E55" />
      <circle cx="200" cy="200" r="5" fill="#15181c" />

      {/* Rings 1 and 2 in front: they lock forward of the dial. */}
      {rings[0] > 0 && <SpatialRing rx={172} tilt={-72} spin={14} width={7} ticks={60} />}
      {rings[1] > 0 && <SpatialRing rx={150} tilt={78} spin={-18} width={5} ticks={44} vertical />}
    </svg>
  );
}

/**
 * A locked ring, in projection.
 *
 * A circle tilted by θ about an axis in the picture plane projects to an
 * ellipse with the same major axis and a minor axis of `cos θ` — so the same
 * tilt angles the WebGL rings use produce the same silhouette here, without
 * either drawing having to know about the other.
 */
function SpatialRing({
  rx,
  tilt,
  spin,
  width,
  ticks,
  vertical = false,
  certified = false,
}: {
  rx: number;
  tilt: number;
  spin: number;
  width: number;
  ticks: number;
  vertical?: boolean;
  certified?: boolean;
}) {
  const ry = Math.max(6, Math.abs(Math.cos((tilt * Math.PI) / 180)) * rx);
  const a = vertical ? ry : rx;
  const b = vertical ? rx : ry;
  const marks = Array.from({ length: ticks }, (_, i) => (i / ticks) * Math.PI * 2);

  return (
    <g transform={`rotate(${spin} 200 200)`}>
      <ellipse cx="200" cy="200" rx={a} ry={b} fill="none" stroke="url(#f-ring)" strokeWidth={width} />
      <ellipse
        cx="200"
        cy="200"
        rx={a}
        ry={b}
        fill="none"
        stroke="#0b1018"
        strokeOpacity="0.55"
        strokeWidth={Math.max(1, width - 4)}
      />
      {marks.map((t, i) => {
        const x = 200 + Math.cos(t) * a;
        const y = 200 + Math.sin(t) * b;
        const major = i % 5 === 0;
        return (
          <circle key={i} cx={x} cy={y} r={major ? 1.9 : 1.1} fill="#9FB0C4" fillOpacity={major ? 0.9 : 0.55} />
        );
      })}
      {/* The certification line, on the last joint to close. One short segment
          at the seam, not a ring of decoration. */}
      {certified && (
        <path
          d={`M ${200 + a * Math.cos(-0.14)} ${200 + b * Math.sin(-0.14)} A ${a} ${b} 0 0 1 ${200 + a * Math.cos(0.14)} ${200 + b * Math.sin(0.14)}`}
          fill="none"
          stroke="#FFEE25"
          strokeWidth={width}
          strokeLinecap="butt"
        />
      )}
    </g>
  );
}

/** Eleven blades, the same mechanism, drawn as the polygon they actually form. */
function Iris({ hole, calibrated }: { hole: number; calibrated: boolean }) {
  const blades = Array.from({ length: BLADES }, (_, i) => (i / BLADES) * 360);

  return (
    <g data-testid="fallback-iris">
      <circle cx="200" cy="200" r="46" fill="#04060a" />
      {blades.map((deg) => {
        // Each blade is the sector it covers, cut back to the hole radius —
        // which is exactly what the overlapping blades leave visible.
        const step = 360 / BLADES;
        const [x1, y1] = polar(deg, hole);
        const [x2, y2] = polar(deg + step, hole);
        const [x3, y3] = polar(deg + step, 46);
        const [x4, y4] = polar(deg, 46);
        return (
          <path
            key={deg}
            d={`M ${x1} ${y1} L ${x2} ${y2} L ${x3} ${y3} L ${x4} ${y4} Z`}
            fill="#1b2028"
            stroke="#39424c"
            strokeWidth="0.8"
          />
        );
      })}
      <circle cx="200" cy="200" r="46" fill="none" stroke="#3b444e" strokeWidth="6" />
      {calibrated && (
        <path
          d={`M ${polar(-8, 46).join(' ')} A 46 46 0 0 1 ${polar(8, 46).join(' ')}`}
          fill="none"
          stroke="#FFEE25"
          strokeWidth="6"
        />
      )}
    </g>
  );
}

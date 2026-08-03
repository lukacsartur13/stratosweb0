import { CEILING_M, formatAltitude } from '@/lib/ascent';

/**
 * What the prototype looks like when the 3D scene must not, or cannot, run.
 *
 * This is not a placeholder box. It is a static instrument drawn as inline SVG:
 * no network request, no WebGL, no animation, no motion of any kind — and it
 * still shows the visitor what the page is about. `three` is never imported on
 * this path, so a visitor who has asked for reduced motion does not pay ~600 KB
 * to be told the page will hold still for them.
 */
export function PrototypeFallback({ reason }: { reason: 'reduced-motion' | 'no-webgl' | 'context-lost' }) {
  const note =
    reason === 'reduced-motion'
      ? 'Csökkentett mozgás bekapcsolva — a jelenet mozdulatlan változatát látod.'
      : reason === 'no-webgl'
        ? 'Ez a böngésző nem tud 3D-t megjeleníteni — a jelenet állóképes változatát látod.'
        : 'A 3D megjelenítés megszakadt — a jelenet állóképes változatát látod.';

  return (
    <div className="fallback" data-testid="prototype-fallback" data-reason={reason}>
      <StaticAltimeter />
      <p className="fallback__note" data-testid="fallback-note">
        {note}
      </p>
      <p className="fallback__range">
        0 – {formatAltitude(CEILING_M)} m
      </p>
    </div>
  );
}

const MAJOR = Array.from({ length: 10 }, (_, i) => i);
const MINOR = Array.from({ length: 50 }, (_, i) => i).filter((i) => i % 5 !== 0);

function StaticAltimeter() {
  const polar = (deg: number, r: number) => {
    const a = ((deg - 90) * Math.PI) / 180;
    return [200 + Math.cos(a) * r, 200 + Math.sin(a) * r] as const;
  };

  return (
    <svg
      className="fallback__dial"
      viewBox="0 0 400 400"
      role="img"
      aria-label="Stratos magasságmérő, 0 méteren álló mutatóval"
    >
      <defs>
        <radialGradient id="face" cx="50%" cy="38%" r="72%">
          <stop offset="0%" stopColor="#1a2333" />
          <stop offset="100%" stopColor="#070b13" />
        </radialGradient>
        <linearGradient id="bezel" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#4a5057" />
          <stop offset="55%" stopColor="#23262b" />
          <stop offset="100%" stopColor="#3a3f45" />
        </linearGradient>
      </defs>

      <circle cx="200" cy="200" r="196" fill="url(#bezel)" />
      <circle cx="200" cy="200" r="176" fill="url(#face)" />
      <circle cx="200" cy="200" r="176" fill="none" stroke="#000" strokeOpacity="0.6" strokeWidth="2" />

      {/* the 8 000 m ceiling arc — the one accent, exactly as in the model */}
      <path
        d={`M ${polar(288, 128).join(' ')} A 128 128 0 0 1 ${polar(360, 128).join(' ')}`}
        fill="none"
        stroke="#FFEE25"
        strokeOpacity="0.65"
        strokeWidth="6"
      />

      {MINOR.map((i) => {
        const [x1, y1] = polar(i * 7.2, 152);
        const [x2, y2] = polar(i * 7.2, 168);
        return <line key={`m${i}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#8A929B" strokeWidth="2" />;
      })}

      {MAJOR.map((i) => {
        const [x1, y1] = polar(i * 36, 136);
        const [x2, y2] = polar(i * 36, 168);
        const [tx, ty] = polar(i * 36, 116);
        return (
          <g key={`M${i}`}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#CBDCE9" strokeWidth="5" strokeLinecap="round" />
            <text x={tx} y={ty} fill="#CBDCE9" fontSize="30" textAnchor="middle" dominantBaseline="central">
              {i}
            </text>
          </g>
        );
      })}

      {/* The branding has to clear the numerals, which sit at r=116 — 6 lands at
          roughly (132, 294) and 4 at (268, 294). Tracked out at 20px the
          wordmark ran straight through both, so it is set to fit between them
          rather than over them. */}
      <text x="200" y="140" fill="#8A929B" fontSize="14" textAnchor="middle" letterSpacing="1">
        ×1000 m
      </text>
      <text x="200" y="258" fill="#8A929B" fontSize="12" textAnchor="middle" letterSpacing="3">
        ALTITUDE
      </text>
      <text x="200" y="286" fill="#CBDCE9" fontSize="15" textAnchor="middle" letterSpacing="2.5">
        STRATOS
      </text>

      {/* both pointers at rest on zero */}
      <path d="M 196 214 L 204 214 L 202 68 L 198 68 Z" fill="#F4F4F4" />
      <path d="M 193 210 L 207 210 L 204 108 L 196 108 Z" fill="#6E767F" />
      <circle cx="200" cy="200" r="13" fill="#4A4E55" />
      <circle cx="200" cy="200" r="5" fill="#15181c" />
    </svg>
  );
}

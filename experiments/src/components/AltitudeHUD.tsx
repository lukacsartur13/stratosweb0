import { useEffect, useRef } from 'react';
import { CEILING_M, advance, ascent, clamp, formatAltitude } from '@/lib/ascent';

/**
 * The persistent readout, and the owner of the clock.
 *
 * It is HTML, not canvas: real text, selectable, in the accessibility tree, and
 * legible before the model has finished loading. The digits are written straight
 * into a text node once per frame rather than through React — sixty rerenders a
 * second to change four characters is not a trade worth making.
 *
 * `advance()` lives here rather than in the render loop because the renderer is
 * allowed to stop. When the canvas scrolls out of view the frameloop is parked,
 * and a clock inside `useFrame` would freeze with it — leaving the altitude
 * stranded at whatever value it had reached mid-transit. A plain rAF costs a
 * handful of arithmetic and keeps the number honest whatever the canvas is
 * doing. Exactly one owner: nothing else may call `advance()`.
 *
 * The number changes far too quickly to announce, so the live region is the
 * static description underneath it, not the digits.
 */
export function AltitudeHUD() {
  const digits = useRef<HTMLSpanElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const phase = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let shown = -1;

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min((now - last) / 1000, 1 / 20);
      last = now;

      advance(dt);

      const metres = Math.round(ascent.altitude / 10) * 10;
      if (metres !== shown) {
        shown = metres;
        if (digits.current) digits.current.textContent = formatAltitude(metres);
        if (bar.current) {
          bar.current.style.setProperty('--fill', clamp(ascent.current).toFixed(4));
        }
        if (phase.current) {
          phase.current.textContent =
            metres < 400 ? 'Földi szint'
            : metres < 2200 ? 'Emelkedés'
            : metres < 5200 ? 'Páraréteg'
            : 'Első felhőréteg';
        }
      }
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="hud" data-testid="altitude-hud">
      <div className="hud__readout">
        <span className="hud__digits" ref={digits} data-testid="altitude-value" aria-hidden="true">
          0
        </span>
        <span className="hud__unit" aria-hidden="true">
          m
        </span>
      </div>

      <div className="hud__scale" ref={bar} aria-hidden="true">
        <i />
      </div>

      <p className="hud__phase">
        <span ref={phase} data-testid="altitude-phase">
          Földi szint
        </span>
      </p>

      {/* What a screen reader gets: the shape of the journey, stated once,
          instead of a number that changes sixty times a second. */}
      <p className="sr-only">
        Görgetéssel vezérelt emelkedés a földi szinttől {formatAltitude(CEILING_M)} méterig. A
        magasságmérő értéke a görgetés helyzetét követi; az oldal minden tartalma görgetés nélkül is
        olvasható.
      </p>
    </div>
  );
}

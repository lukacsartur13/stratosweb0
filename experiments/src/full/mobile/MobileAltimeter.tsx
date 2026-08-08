import { useEffect, useRef, useState } from 'react';
import { MeridianDrawing } from '../components/MeridianDrawing';
import { meridianStageAt, type MeridianStageId } from '../meridian';
import { onAscent } from './ascent';
import { prefersReducedMotion } from './device';

/**
 * The Altimeter, on the portrait homepage.
 *
 * ## What it is not, any more
 *
 * On the desktop composition the instrument is a GLB in a WebGL scene whose
 * position, scale and depth are solved every frame against a measured
 * exclusion band, which in turn decides how tall each panel's copy window is —
 * so the instrument and the layout are one feedback loop. §9 of the brief ends
 * that: on portrait the Altimeter *"must become an independent visual
 * element"*, and specifically must not determine section heights, create
 * exclusion zones, force stage windows or sit beneath content panels.
 *
 * It is now inline SVG. No canvas, no `three`, no GLB, no render loop — the
 * portrait page requests none of the ~1 MB the scene chunk and model cost.
 * It is the same drawing the reduced-motion fallback has always used, which is
 * the whole reason it was already good enough to be the real thing here.
 *
 * ## How it moves
 *
 * Two mechanisms, and deliberately only two.
 *
 *   1. **Six structural states.** The rings and the iris are the Meridian's
 *      argument — the instrument *becomes* something — and they change at six
 *      altitudes. React re-renders on those six transitions and no others.
 *      Six renders over a whole page is not a scroll cost.
 *   2. **One needle, continuous.** Written straight onto the SVG node as a
 *      `transform` attribute, dirty-checked, quantised to a tenth of a degree.
 *      No React, no CSS variable plumbing, no layout read. On most frames this
 *      is a float comparison and nothing else.
 *
 * There is no third mechanism, and that is the point. §13: *"Do not compensate
 * for removed mountains with more effects."*
 *
 * ## Why the needle is an attribute and not a CSS transform
 *
 * `transform-box` and `transform-origin` on SVG children have a genuinely
 * uneven history in Safari, and the failure is silent — the needle rotates
 * about the wrong centre and looks like a drawing error rather than a CSS one.
 * `transform="rotate(a 200 200)"` is the SVG attribute, it has meant exactly
 * this since SVG 1.1, and there is no browser on the matrix that gets it wrong.
 */

/**
 * The needle mapping, and it is the accepted one — not a new one.
 *
 * These are `primaryAngle` and `secondaryAngle` from `AltimeterMeridian`, the
 * WebGL instrument, with the sign flipped. The dial is a 0–10 000 m instrument
 * and the journey goes to 30 000 m, which is not a mistake: a real three-pointer
 * altimeter wraps, and the short pointer completing three full turns is a more
 * honest reading of 30 000 m than rescaling the dial would be.
 *
 * The long needle covers 1 000 m per revolution. That number is not free to
 * change here — `initialAscent.meta` states it to the visitor in all three
 * locales, and the mobile page shows that sentence.
 *
 * ## Why the sign is flipped
 *
 * The scene rotates about `z` in a right-handed system, where a positive angle
 * is counter-clockwise, so it negates. SVG's `rotate()` is clockwise-positive.
 * Both end up turning the needle the way the numerals are printed — 0 at the
 * top, 1 a tenth of a turn clockwise — which is the only thing that has to be
 * true on both surfaces.
 */
const REV = 360;
const primaryAngle = (metres: number) => ((metres % 1000) / 1000) * REV;
const secondaryAngle = (metres: number) => (metres / 10_000) * REV;

export function MobileAltimeter({ label }: { label?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const primary = useRef<SVGGElement | null>(null);
  const secondary = useRef<SVGGElement | null>(null);

  // The structural state is the only thing that goes through React, and it
  // changes six times in a full read of the page.
  const [state, setState] = useState<MeridianStageId>('baseline');

  useEffect(() => {
    const root = host.current;
    if (!root) return;

    // Found once. A `querySelector` per frame would be a DOM read per frame,
    // which is the class of cost this whole rewrite exists to remove.
    primary.current = root.querySelector<SVGGElement>('.dial__needle--primary');
    secondary.current = root.querySelector<SVGGElement>('.dial__needle--secondary');

    let shownPrimary = Number.NaN;
    let shownSecondary = Number.NaN;
    let shownState: MeridianStageId | '' = '';

    const still = prefersReducedMotion();

    return onAscent(({ altitude }) => {
      const next = meridianStageAt(altitude).id;
      if (next !== shownState) {
        shownState = next;
        setState(next);
        root.dataset.state = next;
      }

      // §24: reduced motion gets the six discrete states and a needle that is
      // correct, but nothing that sweeps continuously.
      if (still) return;

      // Quantised to a tenth of a degree. The raw value changes every frame by
      // an amount no one can see, and writing it would be an attribute write per
      // frame for nothing. The two are compared separately because the long
      // needle turns ten times faster and settles at a different moment.
      const a = Math.round(primaryAngle(altitude) * 10) / 10;
      if (a !== shownPrimary) {
        shownPrimary = a;
        primary.current?.setAttribute('transform', `rotate(${a} 200 200)`);
      }

      const b = Math.round(secondaryAngle(altitude) * 10) / 10;
      if (b !== shownSecondary) {
        shownSecondary = b;
        secondary.current?.setAttribute('transform', `rotate(${b} 200 200)`);
      }
    });
  }, []);

  return (
    <div className="mv-alt" ref={host} data-state="baseline" data-testid="mobile-altimeter">
      <MeridianDrawing className="mv-alt__dial" state={state} idPrefix="mv" />
      {label && <p className="mv-alt__label mv-label">{label}</p>}
    </div>
  );
}

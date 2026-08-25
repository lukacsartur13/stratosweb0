import { useEffect, useRef } from 'react';
import { STAGES, formatAltitude } from '../journey';
import { m } from '../i18n';
import { onAscent, progressOfSection } from './ascent';
import { publishHeaderState, releaseHeader, watchDeck } from '../siteHeader';

/**
 * One telemetry strip, and only one.
 *
 * §11 asks for a single compact component, above the background, not sharing a
 * stacking context with section content, with no duplicated altitude readout
 * and never showing Calibration and Ascent at the same time. What it replaces
 * had the altitude in the HUD, again in every panel eyebrow, and a stage label
 * that could disagree with the eyebrow above it because they were derived from
 * two different numbers.
 *
 * Here there is one number, from `onAscent`, and everything on screen is
 * written from it on the same frame. Two readouts cannot disagree when there is
 * one source and one writer.
 *
 * ## Why it writes text nodes instead of rendering
 *
 * Sixty React renders a second to change four characters is not a trade worth
 * making — the same reasoning the desktop HUD already documents. The difference
 * is that this component has no clock of its own to run: it is a subscriber to
 * the one scroll reader, so on a still page it costs nothing at all.
 *
 * ## Position
 *
 * Fixed to the bottom, clear of the shared header at the top and clear of the
 * Altimeter, which lives in the upper half of the composition. §10 forbids
 * half-covering the instrument; keeping the two at opposite ends of the
 * viewport is the version of that rule that cannot be got wrong by a layout
 * change later.
 *
 * `env(safe-area-inset-bottom)` is in the stylesheet rather than here: Safari's
 * bottom toolbar and the home indicator both live in that space.
 */
export function MobileTelemetry() {
  const digits = useRef<HTMLSpanElement>(null);
  const stage = useRef<HTMLSpanElement>(null);
  const fill = useRef<HTMLDivElement>(null);

  /**
   * The shared header rides this subscription too.
   *
   * Same reasoning as the desktop HUD's tick: the header is one of the two
   * places an altitude appears on this page, and the only way two readouts
   * cannot disagree is for there to be one number and one writer. Left
   * un-pushed the header derives its own altitude from raw document scroll,
   * which on a page with unequal stage lengths is wrong by up to a stage.
   *
   * `watchDeck` publishes `--deck-content`, which the opening section's top
   * padding is composed against — so the headline clears the flight deck on the
   * locale whose navigation wraps, rather than on the one it was measured in.
   */
  useEffect(() => watchDeck(), []);
  useEffect(() => releaseHeader, []);

  useEffect(() => {
    let shownMetres = -1;
    let shownStage = '';
    let shownFill = -1;
    let label = STAGES[0].label;

    // The header's two state boundaries, in document-progress units. Recomputed
    // only when the stage changes — they move when the document is remeasured,
    // and a stage change is the coarsest event that reliably follows one.
    let bounds: number[][] = [];
    const readBounds = () => {
      const toJourney = progressOfSection('initial-ascent');
      const toDestination = progressOfSection('full-stratosphere');
      bounds = [
        [toJourney, Math.max(0, toJourney - 0.015)],
        [toDestination, Math.max(toJourney, toDestination - 0.015)],
      ];
    };
    readBounds();

    return onAscent(({ altitude, stage: id, progress }) => {
      // Rounded to 10 m. At 30 000 m over twenty-odd screens the raw value
      // changes every frame, and rewriting the DOM for a digit nobody can read
      // is exactly the cost this component is arranged to avoid.
      const metres = Math.round(altitude / 10) * 10;
      if (metres !== shownMetres) {
        shownMetres = metres;
        if (digits.current) digits.current.textContent = formatAltitude(metres);
      }

      if (id !== shownStage) {
        shownStage = id;
        label = STAGES.find((s) => s.id === id)?.label ?? '';
        if (stage.current) stage.current.textContent = label;
        readBounds();
      }

      // Quantised to a thousandth — about one pixel of a full-width rule on the
      // widest phone in the matrix.
      const bar = Math.round(progress * 1000) / 1000;
      if (bar !== shownFill) {
        shownFill = bar;
        fill.current?.style.setProperty('--mv-fill', String(bar));
      }

      // De-duplicated inside `header.push`, so a frame that moved the page by
      // nothing costs two comparisons.
      publishHeaderState(progress, altitude, label, bounds);
    });
  }, []);

  return (
    <div className="mv-telemetry" data-testid="mobile-telemetry">
      <div className="mv-telemetry__rule" ref={fill} aria-hidden="true">
        <i />
      </div>
      <p className="mv-telemetry__read">
        <span className="mv-telemetry__digits" ref={digits} data-testid="mobile-altitude">
          0
        </span>
        <span className="mv-telemetry__unit">{m('hud.metres')}</span>
        {/* The one stage label on the page. `aria-live` is polite and the value
            changes eleven times over the whole document, which is the only
            reason it can be announced at all. */}
        <span className="mv-telemetry__stage" ref={stage} aria-live="polite" data-testid="mobile-stage">
          {STAGES[0].label}
        </span>
      </p>
    </div>
  );
}

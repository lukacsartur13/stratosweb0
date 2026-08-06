import { useEffect, useRef, useState } from 'react';
import { CEILING_M, STAGES, advance, clamp, formatAltitude, journey } from '../journey';
import { m } from '../i18n';
import { publishKinetic, reserveKinetic } from '../kineticDom';
import { clearComposition, measureComposition, publishComposition } from '../composition';
import { advanceMeridian, meridianStageAt, type MeridianStageId } from '../meridian';
import { meridianSound } from '../meridianSound';
import { publishHeader, releaseHeader, watchDeck } from '../siteHeader';

/**
 * The persistent readout, and the owner of both clocks.
 *
 * HTML, not canvas: real text, selectable, in the accessibility tree, and
 * legible before the scene chunk has even been requested. The digits are
 * written into a text node once per frame rather than through React — sixty
 * rerenders a second to change four characters is not a trade worth making.
 *
 * `advance()` lives here, and nowhere else, and now so does `advanceMeridian()`.
 * The renderer is allowed to stop: the frameloop parks whenever the canvas
 * leaves the viewport or the tab goes to the back, and a clock inside
 * `useFrame` would freeze with it, stranding the altitude mid-journey and never
 * reaching 30 000 m. Deriving the instrument's state on the same tick as the
 * altitude, from the same number, is what makes it impossible for the two to
 * disagree — and it is why the static fallback can read the instrument state at
 * all, on a path where no `useFrame` exists.
 *
 * Two live regions, and they say different things. The stage name is where the
 * *page* is; the Meridian description is what the *instrument* has done. Both
 * change a handful of times over eleven screens, which is the only reason
 * either can be announced at all — the altitude itself changes far too fast.
 */
export function JourneyHUD() {
  const digits = useRef<HTMLSpanElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLSpanElement>(null);
  const instrument = useRef<HTMLParagraphElement>(null);
  const root = useRef<HTMLDivElement>(null);

  const [soundOn, setSoundOn] = useState(false);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let shownMetres = -1;
    let shownStage = '';
    let shownMeridian: MeridianStageId | '' = '';

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min((now - last) / 1000, 1 / 20);
      last = now;

      advance(dt);
      advanceMeridian(journey.altitude, journey.current);
      // Kinetic typography rides the same tick and the same altitude. A second
      // rAF here would be a second clock, which is the one thing the journey
      // does not have. Writes are quantised inside, so this is a comparison per
      // axis on most frames and a style write on very few.
      publishKinetic();
      // The portrait composition rides the same tick for the same reason: the
      // copy bands are sized from the instrument's projected height, so they
      // have to be derived from the altitude on the frame that altitude is set,
      // not one frame later. Writes are quantised to 4px inside, so this is a
      // comparison on almost every frame and a style write on very few.
      publishComposition();
      // Fed unconditionally: the threshold arming has to track the altitude
      // even while muted, or switching sound on halfway up replays every event
      // below the visitor at once.
      meridianSound.update(journey.altitude);
      // The shared flight deck rides this tick too, and for the same reason
      // everything else does: it is the one place the altitude is known to be
      // current. It de-duplicates internally — see siteHeader.ts.
      publishHeader();

      // Rounded to 10 m: at 30 000 m over eleven screens the raw value changes
      // every frame, and rewriting the DOM sixty times a second for a digit
      // nobody can read is the exact cost this component exists to avoid.
      const metres = Math.round(journey.altitude / 10) * 10;
      if (metres !== shownMetres) {
        shownMetres = metres;
        if (digits.current) digits.current.textContent = formatAltitude(metres);
        if (bar.current) bar.current.style.setProperty('--fill', clamp(journey.current).toFixed(4));
      }

      if (journey.stage !== shownStage) {
        shownStage = journey.stage;
        const label = STAGES.find((s) => s.id === journey.stage)?.label ?? '';
        if (stage.current) stage.current.textContent = label;
        // The stage is published to CSS so the layout can react to it without
        // React rerendering. It is used to stand the readout down over the
        // destination panel on narrow viewports, where the HUD sits at the top
        // of the screen and would otherwise print itself across the closing
        // headline. See styles.css.
        if (root.current) root.current.dataset.stage = shownStage;
      }

      // Six announcements over the whole journey, one per structural change to
      // the instrument. Anything finer-grained would be a live region reading
      // out an animation, which is noise rather than information.
      const meridianStage = meridianStageAt(journey.altitude);
      if (meridianStage.id !== shownMeridian) {
        shownMeridian = meridianStage.id;
        if (instrument.current) {
          instrument.current.textContent = `${formatAltitude(journey.altitude)} ${m('hud.metres')}. ${meridianStage.description}`;
        }
        if (root.current) root.current.dataset.meridian = meridianStage.id;
      }
    };

    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      // The clock is the header's source. When it stops, the header goes back
      // to document scroll rather than holding the last altitude it was given.
      releaseHeader();
    };
  }, []);

  // Space reservation for the kinetic anchors. Separate effect because it is
  // measurement rather than animation, and it runs on font load and resize
  // rather than per frame.
  useEffect(() => reserveKinetic(), []);

  /**
   * The portrait composition decision — window or natural flow, per panel.
   *
   * Measurement, not animation, so it runs on the same triggers `reserveKinetic`
   * does and for the same reasons. Fonts first: the headline band is decided by
   * whether the headline fits it, and the fallback and the webfont wrap
   * differently. Then on resize, on `visualViewport` resize — which is what
   * fires when mobile browser chrome collapses and when the visitor zooms, and
   * neither of those raises a plain `resize` — and on the track's own resize,
   * which is what catches a locale change and an increased system text size.
   */
  useEffect(() => {
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => measureComposition());
    };

    if ('fonts' in document) document.fonts.ready.then(schedule).catch(schedule);
    else schedule();

    // Where homepage content may begin, measured off the shared header — and
    // remeasured *here* rather than on the tick, because the deck's boundaries
    // and the composition are one decision taken in two places.
    //
    // `entryBudget` reads `--deck-content`, so a deck that moves without the
    // composition being told leaves the entry budget describing the previous
    // header state. Observed on a history restore: `--deck-content` republished
    // at 144px while `--stage-entry-px` still said 128, which is a budget
    // *smaller* than the deck it is supposed to clear. It self-corrected on the
    // next resize, and "self-corrects eventually" is not the same as "is never
    // wrong" when what it is wrong about is whether copy sits under the
    // instrument strip.
    const unwatchDeck = watchDeck(schedule);

    addEventListener('resize', schedule);
    addEventListener('orientationchange', schedule);
    visualViewport?.addEventListener('resize', schedule);
    const track = document.querySelector('[data-testid="journey-track"]');
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
    if (observer && track) observer.observe(track);

    return () => {
      cancelAnimationFrame(frame);
      removeEventListener('resize', schedule);
      removeEventListener('orientationchange', schedule);
      visualViewport?.removeEventListener('resize', schedule);
      observer?.disconnect();
      unwatchDeck();
      clearComposition();
    };
  }, []);

  // Nothing is created until this is clicked, so there is no suspended audio
  // context sitting around on a page that never asked for one.
  useEffect(() => () => meridianSound.dispose(), []);

  return (
    <div className="hud" ref={root} data-stage="calibration" data-testid="altitude-hud">
      <div className="hud__readout">
        <span
          className="hud__digits"
          ref={digits}
          data-testid="altitude-value"
          data-kinetic="altitude-readout"
          aria-hidden="true"
        >
          0
        </span>
        <span className="hud__unit" aria-hidden="true">
          m
        </span>
      </div>

      <div className="hud__scale" ref={bar} aria-hidden="true">
        <i />
      </div>

      <p className="hud__stage" aria-live="polite">
        <span ref={stage} data-testid="altitude-stage">
          {m('stage.calibration')}
        </span>
      </p>

      <button
        type="button"
        className="hud__sound"
        data-testid="sound-toggle"
        aria-pressed={soundOn}
        onClick={() => {
          const next = !soundOn;
          meridianSound.setEnabled(next);
          // `setEnabled` refuses if the browser has no AudioContext at all, so
          // the button reports what actually happened rather than what was asked.
          setSoundOn(meridianSound.isEnabled);
          if (next && meridianSound.isEnabled) meridianSound.play('aperture-step');
        }}
      >
        {/* One glyph, two states. The off state is drawn with a strike in CSS
            rather than swapped for a second character, so the button does not
            change width when it is pressed. */}
        <span className="hud__sound-glyph" aria-hidden="true">
          ♪
        </span>
        <span className="sr-only">{soundOn ? m('hud.sound.off') : m('hud.sound.on')}</span>
      </button>

      {/* The ground state, built from the same two sources the tick above uses
          rather than transcribed. It was a copy of `MERIDIAN_STAGES[0]`'s
          description, which meant editing that sentence silently left this one
          behind — and this is the one a screen reader announces first. */}
      <p className="sr-only" aria-live="polite" ref={instrument} data-testid="meridian-description">
        {`${formatAltitude(0)} ${m('hud.metres')}. ${meridianStageAt(0).description}`}
      </p>

      <p className="sr-only">
        {m('hud.description.a')} {formatAltitude(CEILING_M)} {m('hud.description.b')}
      </p>
    </div>
  );
}

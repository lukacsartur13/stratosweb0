import { useEffect, type ReactNode } from 'react';
import { m, pageHref } from '../i18n';
import { CAPABILITIES, PROCESS, SYSTEM, WORK } from '../content';
import { STAGES, formatAltitude } from '../journey';
import { ALTITUDE_BANDS, measureAscent } from './ascent';
import { startReveals } from './reveal';
import { prefersReducedMotion } from './device';
import { AltimeterInstrument, AltimeterReserve } from './MobileAltimeter';
import { MobileTelemetry } from './MobileTelemetry';
import './mobile.css';

/**
 * The portrait homepage.
 *
 * A genuinely separate composition, not the desktop one with breakpoints. §1 of
 * the mobile brief asks for that in those words, and the reason is visible in
 * what it replaces: eleven panels inside one sticky container, each with a
 * measured lead band, a windowed flow band walked by `--stage-flow`, a recede
 * curve, an exclusion band solved against a projected instrument height, and a
 * calibration pass feeding measured panel positions back into the altitude
 * curve that decides where the panels are. Every one of those systems was
 * introduced to fix a symptom of the one before it.
 *
 * Here every section is an ordinary block-flow `<section>`. There is no sticky
 * stage, no spacer, no track, no measured feedback of any kind. The page is as
 * tall as its content and the browser scrolls it.
 *
 * ## What is on a scroll frame
 *
 *   * one `scrollY` read, in `ascent.ts`
 *   * an interpolation inside a cached band
 *   * two dirty-checked writes: the needle's `transform`, the telemetry digits
 *
 * That is the whole of it. No `getBoundingClientRect`, no `getComputedStyle`,
 * no React render, no WebGL, no damping and nothing that continues after the
 * finger lifts.
 *
 * ## What carries the character instead
 *
 * Typography. §6: the premium feel comes from text motion, and the text motion
 * is `IntersectionObserver` + CSS transitions — see `reveal.ts` and the five
 * `.mv-*` roles in `mobile.css`.
 */

const band = (id: string) => ALTITUDE_BANDS[id] ?? { from: 0, to: 0 };

/**
 * One section of the page.
 *
 * The altitude band is an attribute rather than a computed layout property.
 * That inversion is the whole architectural change: the altitude is a *label*
 * the section carries, so it can never push the section around. Under the old
 * composition the altitude decided the exclusion band, which decided the copy
 * window, which decided the panel height, which was then measured to decide the
 * altitude.
 */
function Section({
  id,
  children,
  lead = false,
  className = '',
}: {
  id: string;
  children: ReactNode;
  /** The opening section, which clears the shared header instead of a chapter gap. */
  lead?: boolean;
  className?: string;
}) {
  const { from, to } = band(id);
  return (
    <section
      // A real anchor target, not only a test hook: the closing panel links back
      // to every stage and those links must work with no JavaScript at all.
      id={`stage-${id}`}
      className={`mv-sec${lead ? ' mv-sec--lead' : ''}${className ? ` ${className}` : ''}`}
      data-stage={id}
      data-alt-from={from}
      data-alt-to={to}
      data-testid={`stage-${id}`}
    >
      {children}
    </section>
  );
}

/** Section number, altitude, technical eyebrow. §6's LabelReveal. */
function Label({ children, at }: { children: ReactNode; at?: string }) {
  return (
    <p className="mv-eyebrow mv-label">
      {children}
      {at && <span className="mv-eyebrow__at">{at}</span>}
    </p>
  );
}

/**
 * A headline that arrives line by line.
 *
 * Each line is its own overflow-hidden box with the text translated a full line
 * box below its resting position, so the reveal is a mask rather than a fade —
 * which is what makes it read as typography arriving rather than as an element
 * appearing. The stagger is a group index; `reveal.ts` turns it into a capped
 * delay.
 *
 * The caller supplies the lines. Deliberately not an automatic word-wrap
 * splitter: §20 asks for mobile line breaks tuned independently of desktop, and
 * a splitter would reintroduce a measurement pass to decide something an author
 * can simply state.
 */
function Lines({
  lines,
  as: Tag = 'h2',
  className = '',
}: {
  lines: ReactNode[];
  as?: 'h1' | 'h2';
  className?: string;
}) {
  return (
    <Tag className={`mv-title ${className}`.trim()}>
      {lines.map((line, i) => (
        <span className="mv-lines" data-stagger={i} key={i}>
          <span className="mv-lines__in">{line}</span>
        </span>
      ))}
    </Tag>
  );
}

/** Body copy. Much subtler than a headline — §6's CopyReveal. */
function Copy({ children, className = '', stagger }: { children: ReactNode; className?: string; stagger?: number }) {
  return (
    <p className={`mv-copy ${className}`.trim()} data-stagger={stagger}>
      {children}
    </p>
  );
}

export function MobileHome() {
  useEffect(() => {
    const stopReveals = startReveals(document);

    // Measured after the reveals are registered and after the browser has had
    // a frame to lay the document out. Fonts settle later and move every
    // section down; `document.fonts.ready` is the event that says they have.
    measureAscent();
    if ('fonts' in document) void document.fonts.ready.then(measureAscent).catch(() => {});

    // The one ResizeObserver on the page. Case-study images are lazy and below
    // the fold by definition, so they land after `load` and change every offset
    // beneath them — and unlike the old architecture, a stale offset here costs
    // a slightly wrong altitude readout and nothing else. Nothing about the
    // layout depends on it.
    const observer =
      typeof ResizeObserver === 'function' ? new ResizeObserver(() => measureAscent()) : null;
    observer?.observe(document.documentElement);

    document.documentElement.classList.add('mv-on');
    if (prefersReducedMotion()) document.documentElement.classList.add('mv-still');

    return () => {
      stopReveals();
      observer?.disconnect();
      document.documentElement.classList.remove('mv-on', 'mv-still');
    };
  }, []);

  return (
    <div className="mv" data-testid="mobile-home">
      <a className="skip" href="#mv-content">
        {m('common.skipToContent')}
      </a>

      {/* One continuous background for the whole document. §18: sections blend
          rather than collide, because there is nothing for them to collide
          with — no section has an opaque backdrop of its own. */}
      <div className="mv-sky" aria-hidden="true">
        <div className="mv-sky__depth" />
        <div className="mv-sky__grain" />
      </div>

      <div className="mv-flow" id="mv-content">
        {/* ── 1 · 0–150 m — the opening ──────────────────────────────────
            §12: header, a small calibration line, the headline, the
            instrument, then the supporting copy. Nothing overlaps, nothing
            competes, and the first meaningful line is on the first screen. */}
        <Section id="calibration" lead>
          <Label at={m('calibration.altitude')}>{m('calibration.eyebrow')}</Label>
          <Lines
            as="h1"
            className="mv-title--hero"
            lines={[
              m('calibration.title.a'),
              <>
                <em>{m('calibration.title.em')}</em> {m('calibration.title.b')}
              </>,
            ]}
          />

          {/*
            The hero's reservation, and NOT the instrument.

            The real Altimeter is a persistent overlay mounted at the foot of
            this component — see `AltimeterInstrument`. What sits here is the
            space the opening composition keeps for it: the headline reads
            above, the caption and the lead read below, and at scroll zero the
            overlay is positioned from exactly this block, so the accepted hero
            frame is unchanged.

            `.mobile`, not `calibration.meta`: that string says "the instrument
            on the left", which is the desktop composition.
          */}
          <AltimeterReserve label={m('calibration.meta.mobile')} />

          <Copy className="mv-copy--lead">{m('calibration.lead')}</Copy>
          <p className="mv-actions mv-text">
            <a className="mv-btn" href={pageHref('quote')} data-testid="cta-primary-hero">
              {m('common.cta.ascend')}
            </a>
            <a className="mv-btn mv-btn--ghost" href="#stage-selected-work">
              {m('common.cta.work')}
            </a>
          </p>
        </Section>

        {/* ── 2 · 150–3 000 m ─────────────────────────────────────────── */}
        <Section id="initial-ascent">
          <Label at={m('initialAscent.altitude')}>{m('initialAscent.eyebrow')}</Label>
          <Lines
            lines={[
              m('initialAscent.title.a'),
              <em key="em">{m('initialAscent.title.em')}</em>,
            ]}
          />
          <Copy stagger={1}>{m('initialAscent.body.a')}</Copy>
          <Copy stagger={2}>{m('initialAscent.body.b')}</Copy>
          <p className="mv-meta mv-label">{m('initialAscent.meta')}</p>
        </Section>

        {/* ── 3 · 3 000–6 000 m — the capability ladder ─────────────────
            One vertical Meridian rule with the capabilities along it, which
            is the same device the Nine Areas use further down. Two sections
            sharing one graphic language rather than each inventing one. */}
        <Section id="lower-atmosphere">
          <Label at={m('lowerAtmosphere.altitude')}>{m('lowerAtmosphere.eyebrow')}</Label>
          <Lines
            lines={[
              m('lowerAtmosphere.title.a'),
              <em key="em">{m('lowerAtmosphere.title.em')}</em>,
            ]}
          />
          <Copy className="mv-copy--lead">{m('lowerAtmosphere.lead')}</Copy>

          <ol className="mv-spine">
            <i className="mv-spine__rule mv-rule" aria-hidden="true" />
            {CAPABILITIES.map((c, i) => (
              <li className="mv-spine__item mv-text" data-stagger={i} key={c.name}>
                <span className="mv-spine__at">{formatAltitude(c.at)} m</span>
                <h3 className="mv-spine__name">{c.name}</h3>
                <p className="mv-spine__line">{c.line}</p>
              </li>
            ))}
          </ol>
        </Section>

        {/* ── 4 · 6 000–8 500 m ───────────────────────────────────────── */}
        <Section id="cloud-entry">
          <Label at={m('cloudEntry.altitude')}>{m('cloudEntry.eyebrow')}</Label>
          <Lines lines={[m('cloudEntry.title.a'), <em key="em">{m('cloudEntry.title.em')}</em>]} />
          <Copy stagger={1}>{m('cloudEntry.body.a')}</Copy>
          <Copy stagger={2}>{m('cloudEntry.body.b')}</Copy>
        </Section>

        {/* ── 5 · 8 500–11 000 m — a statement beat ────────────────────
            Centred, short, and the one place on the page with real air around
            it. §19's "major chapter" spacing exists for this. */}
        <Section id="cloud-breakthrough" className="mv-sec--centre">
          <Label at={m('cloudBreakthrough.altitude')}>{m('cloudBreakthrough.eyebrow')}</Label>
          <Lines
            className="mv-title--statement"
            lines={[
              m('cloudBreakthrough.title.a'),
              <em key="em">{m('cloudBreakthrough.title.em')}</em>,
            ]}
          />
          <Copy className="mv-copy--lead">{m('cloudBreakthrough.lead')}</Copy>
        </Section>

        {/* ── 6 · 11 000–17 000 m — “those who climbed with us” ─────────
            §16: starts immediately, no lead-in. Name, then logo, then scope,
            then a small image crop — a project index rather than a gallery.
            No horizontal scroller and no full-bleed imagery. */}
        <Section id="selected-work">
          <Label at={m('selectedWork.altitude')}>{m('selectedWork.eyebrow')}</Label>
          <Lines
            lines={[m('selectedWork.title.a'), <em key="em">{m('selectedWork.title.em')}</em>]}
          />
          <Copy className="mv-copy--lead">{m('selectedWork.lead')}</Copy>

          <div className="mv-work">
            {WORK.map((w, i) => (
              <article className="mv-case mv-text" data-stagger={i} key={w.id} data-testid={`case-${w.id}`}>
                <header className="mv-case__head">
                  <span className="mv-case__at">{formatAltitude(w.altitude)} m</span>
                  <h3 className="mv-case__name">{w.name}</h3>
                  <p className="mv-case__sector">{w.sector}</p>
                </header>

                {w.logo && (
                  <img
                    className="mv-case__logo"
                    src={w.logo.src}
                    alt={w.logo.alt}
                    loading="lazy"
                    decoding="async"
                  />
                )}

                {w.image && (
                  <figure className="mv-case__figure">
                    {/* Dimension-bearing and lazy. The box is reserved before
                        the bytes arrive, so a late image cannot shift the copy
                        under a reader — the only reflow risk left on the page. */}
                    <img
                      src={w.image.src}
                      alt={w.image.alt}
                      loading="lazy"
                      decoding="async"
                      width={1200}
                      height={1500}
                    />
                  </figure>
                )}

                <dl className="mv-case__body">
                  <dt>{m('case.term.challenge')}</dt>
                  <dd>{w.challenge}</dd>
                  <dt>{m('case.term.intervention')}</dt>
                  <dd>{w.intervention}</dd>
                  <dt>{m('case.term.result')}</dt>
                  <dd>{w.result}</dd>
                </dl>

                {w.metric && (
                  <p className="mv-case__metric">
                    <strong>{w.metric.value}</strong> <span>{w.metric.label}</span>
                  </p>
                )}

                {w.quote && (
                  <blockquote className="mv-case__quote">
                    <p>{w.quote.text}</p>
                    <footer>
                      <b>{w.quote.by}</b> · {w.quote.role}
                    </footer>
                  </blockquote>
                )}
              </article>
            ))}
          </div>
        </Section>

        {/* ── 7 · 17 000–22 000 m — “nine areas in three layers” ────────
            §14: label, headline, then the three layers down one Meridian
            line. No sticky container, no cards in flight, and no blank
            introduction before the first layer. */}
        <Section id="system">
          <Label at={m('system.altitude')}>{m('system.eyebrow')}</Label>
          <Lines lines={[m('system.title.a'), <em key="em">{m('system.title.em')}</em>]} />
          <Copy className="mv-copy--lead">{m('system.lead')}</Copy>

          <div className="mv-spine mv-layers">
            <i className="mv-spine__rule mv-rule" aria-hidden="true" />
            {([0, 1, 2] as const).map((ring) => (
              <section className="mv-layer" key={ring} data-ring={ring}>
                <h3 className="mv-layer__name mv-text">
                  <span className="mv-layer__index">{ring + 1}</span>
                  {m(`system.ring.${ring}.name`)}
                </h3>
                <p className="mv-layer__note mv-copy">{m(`system.ring.${ring}.note`)}</p>
                <ul className="mv-layer__list">
                  {SYSTEM.filter((n) => n.ring === ring).map((n, i) => (
                    <li className="mv-text" data-stagger={i} key={n.id}>
                      <b>{n.name}</b>
                      <span>{n.blurb}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </Section>

        {/* ── 8 · 22 000–25 500 m — “seven checkpoints” ─────────────────
            §15: a vertical timeline. Label, headline and the first checkpoint
            are all visible together; each subsequent one reveals as it is
            reached. Nothing here is driven by a continuous progress value. */}
        <Section id="process">
          <Label at={m('process.altitude')}>{m('process.eyebrow')}</Label>
          <Lines lines={[m('process.title.a'), <em key="em">{m('process.title.em')}</em>]} />
          <Copy className="mv-copy--lead">{m('process.lead')}</Copy>

          <ol className="mv-spine mv-checks">
            <i className="mv-spine__rule mv-rule" aria-hidden="true" />
            {PROCESS.map((p) => (
              <li className="mv-check mv-text" key={p.index} data-testid={`checkpoint-${p.index}`}>
                <div className="mv-check__head">
                  <span className="mv-check__index">{String(p.index).padStart(2, '0')}</span>
                  <h3 className="mv-check__name">{p.name}</h3>
                  <span className="mv-check__at">{formatAltitude(p.altitude)} m</span>
                </div>
                <dl className="mv-check__grid">
                  <dt>{m('checkpoint.term.happens')}</dt>
                  <dd>{p.happens}</dd>
                  <dt>{m('checkpoint.term.weProduce')}</dt>
                  <dd>{p.weProduce}</dd>
                  <dt>{m('checkpoint.term.outcome')}</dt>
                  <dd>{p.outcome}</dd>
                </dl>
              </li>
            ))}
          </ol>
        </Section>

        {/* ── 9 · 25 500–28 000 m ─────────────────────────────────────── */}
        <Section id="stratosphere-transition">
          <Label at={m('stratosphereTransition.altitude')}>{m('stratosphereTransition.eyebrow')}</Label>
          <Lines
            lines={[
              m('stratosphereTransition.title.a'),
              <em key="em">{m('stratosphereTransition.title.em')}</em>,
            ]}
          />
          <Copy stagger={1}>{m('stratosphereTransition.body.a')}</Copy>
          <Copy stagger={2}>{m('stratosphereTransition.body.b')}</Copy>
        </Section>

        {/* ── 10 · 28 000–30 000 m ────────────────────────────────────── */}
        <Section id="full-stratosphere" className="mv-sec--centre">
          <Label at={m('fullStratosphere.altitude')}>{m('fullStratosphere.eyebrow')}</Label>
          <Lines
            className="mv-title--statement"
            lines={[
              m('fullStratosphere.title.a'),
              <em key="em">{m('fullStratosphere.title.em')}</em>,
            ]}
          />
          <Copy className="mv-copy--lead">{m('fullStratosphere.lead')}</Copy>
        </Section>

        {/* ── 11 · 30 000 m — the destination ──────────────────────────
            The closing action is in ordinary flow above the site's own
            Arrival and footer. There is no sticky container to release and
            no handover to time, because there was never one to begin with. */}
        <Section id="destination" className="mv-sec--centre">
          <Label at={m('destination.altitude')}>{m('destination.eyebrow')}</Label>
          <Lines
            className="mv-title--statement"
            lines={[m('destination.title.a'), <em key="em">{m('destination.title.em')}</em>]}
          />
          <Copy className="mv-copy--lead">{m('destination.lead')}</Copy>

          <p className="mv-actions mv-text">
            <a className="mv-btn mv-btn--lg" href={pageHref('quote')} data-testid="cta-primary">
              {m('common.cta.ascend')}
            </a>
            <a
              className="mv-btn mv-btn--ghost mv-btn--lg"
              href="#stage-selected-work"
              data-testid="cta-secondary"
            >
              {m('destination.cta.work')}
            </a>
          </p>

          <p className="mv-contact mv-copy">
            {m('destination.contact.a')}{' '}
            <a href={pageHref('contact')} data-testid="cta-contact">
              {m('destination.contact.link.contact')}
            </a>{' '}
            {m('destination.contact.b')}{' '}
            <a href={pageHref('quote')} data-testid="cta-qualify">
              {m('destination.contact.link.quote')}
            </a>
            {m('destination.contact.c')}
          </p>

          <ul className="mv-index" aria-label={m('destination.stages.label')}>
            {STAGES.filter((s) => s.id !== 'destination').map((s, i) => (
              <li className="mv-text" data-stagger={i} key={s.id}>
                <a href={`#stage-${s.id}`}>
                  <span>{s.label}</span>
                  <i>{formatAltitude(s.to)} m</i>
                </a>
              </li>
            ))}
          </ul>
        </Section>

        {/*
          The foot of the homepage, as a structural fact.

          Everything below this point belongs to the site's shared chrome — the
          Arrival panel and the ground-control footer — which have their own
          composition and no altitude band. The instrument watches this marker
          and recedes when it arrives, so the journey ends deliberately rather
          than with a 3D object hanging over a footer it is not part of.

          A marker rather than a scroll fraction: the footer's height is
          different in three locales and at four viewports, and a fraction of a
          document is not a place.
        */}
        <i className="mv-end" data-mv-end aria-hidden="true" />
      </div>

      {/*
        The instrument, for the whole document.

        A sibling of the flow rather than a descendant, for the same reason the
        telemetry is: it is fixed, it must not join the flow's stacking context,
        and nothing in the document should be able to paint over it.
      */}
      <AltimeterInstrument />

      <MobileTelemetry />
    </div>
  );
}

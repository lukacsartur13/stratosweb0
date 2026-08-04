import { Children, Suspense, isValidElement, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { JourneyHUD } from './components/JourneyHUD';
import { LanguageSwitch } from './components/LanguageSwitch';
import { m, pageHref } from './i18n';
import { JourneyFallback } from './components/JourneyFallback';
import { SceneBoundary } from './components/SceneBoundary';
import { detect, hasFinePointer, type Capability } from '@/lib/capabilities';
import { CAPABILITIES, PROCESS, SYSTEM, WORK } from './content';
import { STAGES, formatAltitude, journey } from './journey';
import {
  useDebugOverride,
  useJourneyPointer,
  useJourneyScroll,
  useJourneyVisibility,
  useNativeScrollDriver,
  useReducedMotionWatch,
  useStageCalibration,
} from './useJourneyScroll';

// The only import path to `three`, `@react-three/*` and the GLB. A visitor on
// the reduced-motion, no-WebGL or low-capability path never requests any of it.
const JourneyScene = lazy(() => import('./components/JourneyScene'));

// Dev-only, and lazily imported so it cannot end up in a production chunk even
// by accident. `import.meta.env.DEV` is statically replaced, so Rollup drops
// the whole branch — and with it the import — from a production build.
const DebugPanel = import.meta.env.DEV
  ? lazy(() => import('./components/DebugPanel'))
  : null;

type Failure = 'reduced-motion' | 'no-webgl' | 'context-lost' | 'low-capability';

/** Module scope so the override hook's identity is stable across renders. */
const readForcedFallback = () => journey.debug.forceFallback;

export function FullAscent() {
  const track = useRef<HTMLDivElement>(null);

  // Capabilities are read after mount, never during render: `matchMedia` and a
  // WebGL probe are both side effects, and reading them in the render body
  // would make the first paint depend on them.
  const [capability, setCapability] = useState<Capability | null>(null);
  const [crashed, setCrashed] = useState(false);

  const redetect = useCallback(() => setCapability(detect()), []);
  useEffect(redetect, [redetect]);

  // Reduced motion is a preference a visitor can change while the page is open,
  // and honouring it only at mount means honouring it only after a reload.
  useReducedMotionWatch(redetect);

  const onContextLost = useCallback(() => setCrashed(true), []);

  // Development only, and compiled out otherwise: it is the only way to look at
  // the reduced-motion path in a browser that is not configured for it, because
  // `prefers-reduced-motion` cannot be set from script.
  const forced = useDebugOverride(readForcedFallback, 'none');

  const failure: Failure | null =
    forced !== 'none'
      ? forced
      : crashed
        ? 'context-lost'
        : capability && !capability.ok
          ? capability.reason
          : null;

  const live = failure === null && capability?.ok === true;

  // Two drivers, one at a time. The 3D path gets ScrollTrigger; the static
  // fallbacks get the dependency-free one, so the altitude readout keeps
  // tracking the scroll even with no renderer. Reduced motion gets neither —
  // there is no journey to track and no reason to download anything for it.
  useJourneyScroll(track, live);
  useNativeScrollDriver(track, !live && failure !== null && failure !== 'reduced-motion');
  useJourneyPointer(live && capability?.tier === 'full' && hasFinePointer());
  useJourneyVisibility();

  // Both scrolling paths need the altitude curve pinned to the real layout, so
  // this runs for either. Not on the reduced-motion path: the track is
  // un-stuck there and there is no altitude to map.
  useStageCalibration(track, failure !== 'reduced-motion' && capability !== null);

  return (
    <main className="journey" id="main">
      <a className="skip" href="#journey-content">
        {m('common.skipToContent')}
      </a>

      {/*
        One sticky container for the whole journey *including* the closing CTA.

        This is the fix for the prototype's mobile end-of-track problem. There,
        the sticky stage released at the end of the narrative and the CTA
        arrived underneath it as ordinary flow — which technically worked and
        read as an accident: the 3D scene vanished, then a call to action
        appeared above the footer with no relationship to anything before it.

        Making the destination panel the last stage *inside* the sticky
        container removes the handoff entirely rather than smoothing it. There
        is no un-stick to hide, no cross-fade to time, and no viewport-height
        arithmetic to get wrong on a browser whose address bar is moving: the
        scene is simply still there, behind the CTA, until the container ends
        at the footer. See styles.css and FULL_ASCENT_PROTOTYPE.md.
      */}
      {/* No inline height: the narrative inside defines it. See styles.css. */}
      <div className="journey__track" ref={track} data-testid="journey-track">
        <div className="journey__stage">
          {/* The rendered scene carries no information the prose does not, so it
              is hidden from assistive technology rather than described. The
              fallback is not: it is the only instrument that path gets. */}
          <div className="stage__surface" aria-hidden={failure ? undefined : 'true'}>
            {failure ? (
              <JourneyFallback reason={failure} />
            ) : capability?.ok ? (
              // The boundary is *inside* the stage, wrapping only the canvas.
              // A throw in the WebGL subtree must cost the visitor the canvas
              // and nothing else — not the headline, not the case studies, not
              // the call to action.
              <SceneBoundary onError={onContextLost}>
                <Suspense fallback={<div className="stage__loading" data-testid="scene-loading" />}>
                  <JourneyScene
                    simplified={capability.tier === 'reduced'}
                    parallax={capability.tier === 'full'}
                    onContextLost={onContextLost}
                  />
                </Suspense>
              </SceneBoundary>
            ) : (
              // Pre-detection. Deliberately empty and dark rather than a
              // spinner: the check takes a single frame.
              <div className="stage__loading" />
            )}
          </div>

          {/* The readout owns the clock, so it is mounted on every path that has
              an ascent to show. Reduced motion is the exception: there is
              nothing to advance when nothing moves. */}
          {failure !== 'reduced-motion' && <JourneyHUD />}

          {DebugPanel && failure !== 'reduced-motion' && (
            <Suspense fallback={null}>
              <DebugPanel />
            </Suspense>
          )}
        </div>

        <div className="journey__content" id="journey-content">
          <Calibration />
          <InitialAscent />
          <LowerAtmosphere />
          <CloudEntry />
          <CloudBreakthrough />
          <SelectedWork />
          <SystemStage />
          <ProcessStage />
          <StratosphereTransition />
          <FullStratosphere />
          <Destination />
        </div>
      </div>

      {/*
        This was a prototype footer — "nem publikus oldal, nem indexelt, és nem
        része az éles buildnek". All three clauses stopped being true when this
        route became the homepage, so it is a real footer now: the site's own
        links, in the visitor's own language, and the same HU/EN/DE switcher the
        other eleven pages carry.
      */}
      <footer className="journey__footer">
        <nav className="journey__nav" aria-label={m('footer.nav.label')}>
          <a href={pageHref('sme')}>{m('footer.sme')}</a>
          <span aria-hidden="true"> · </span>
          <a href={pageHref('enterprise')}>{m('footer.enterprise')}</a>
          <span aria-hidden="true"> · </span>
          <a href={pageHref('branding')}>{m('footer.branding')}</a>
          <span aria-hidden="true"> · </span>
          <a href={pageHref('ads')}>{m('footer.ads')}</a>
          <span aria-hidden="true"> · </span>
          <a href={pageHref('about')}>{m('footer.about')}</a>
          <span aria-hidden="true"> · </span>
          <a href={pageHref('quote')}>{m('footer.quote')}</a>
          <span aria-hidden="true"> · </span>
          <a href={pageHref('contact')}>{m('footer.contact')}</a>
        </nav>

        <LanguageSwitch />

        <p>
          <a href={pageHref('imprint')}>{m('footer.imprint')}</a>
          <span aria-hidden="true"> · </span>
          <a href={pageHref('privacy')}>{m('footer.privacy')}</a>
        </p>
      </footer>
    </main>
  );
}

// =============================================================================
// The narrative.
//
// Every heading, paragraph, figure and call to action below is ordinary HTML in
// the document. Nothing that carries meaning lives only inside the canvas —
// which is what lets the page be read with the renderer switched off, by a
// screen reader, or by a search engine, and is also why the reduced-motion path
// can simply not load the scene rather than needing a second content strategy.
// =============================================================================

/**
 * Each panel is exactly as tall as its stage's share of the scroll track.
 *
 * The share comes from the same STAGES array the altitude curve is built from,
 * which is what keeps the two in agreement. Hard-coding one screen per panel
 * here would put the narrative and the altimeter ten screens out of step by the
 * end of the journey — the case studies would arrive in the lower atmosphere
 * and the CTA somewhere around 19 000 m.
 */
const shareOf = (id: string) => STAGES.find((s) => s.id === id)?.share ?? 1;

/**
 * Split a panel's children into the headline band and the flow band.
 *
 * The portrait composition needs two boxes, not two rows: the flow band is a
 * window onto copy that is taller than it, so it has to be an element with an
 * overflow of its own. Grid rows cannot do that, and giving the eyebrow and the
 * headline a row each would put the headline in the row the instrument
 * occupies.
 *
 * The split point is the headline — everything up to and including the first
 * `.panel__title` leads, everything after it flows. That is a property of every
 * panel on this page rather than a convention being hoped for: each one opens
 * with an eyebrow and exactly one h1 or h2, and the assertion below makes a
 * panel that stops doing so a development-time error rather than a silent
 * composition failure.
 *
 * Nothing about the *content* changes. Same nodes, same order, same one copy of
 * every string — the two wrappers are `display: contents` everywhere except the
 * portrait window, so on desktop and landscape the box tree is the one that was
 * already accepted.
 */
function splitBands(
  children: React.ReactNode,
  /**
   * Where to cut, as a class name. The headline everywhere except the closing
   * panel, whose lead band has to hold the call to action — see `Destination`.
   */
  boundary = 'panel__title',
): [React.ReactNode[], React.ReactNode[]] {
  const all = Children.toArray(children);
  const isTitle = (node: React.ReactNode) =>
    isValidElement<{ className?: string }>(node) &&
    typeof node.props.className === 'string' &&
    node.props.className.includes(boundary);
  const at = all.findIndex(isTitle);
  if (at < 0) {
    if (import.meta.env.DEV) {
      throw new Error(
        'Panel: no .panel__title among the children. The portrait composition splits the ' +
          'copy at the headline, so a panel without one has no band boundary to split at.',
      );
    }
    return [all, []];
  }
  return [all.slice(0, at + 1), all.slice(at + 1)];
}

function Panel({
  id,
  eyebrow,
  altitude,
  children,
  align = 'left',
  wide = false,
}: {
  id: string;
  eyebrow: string;
  altitude: string;
  children: React.ReactNode;
  align?: 'left' | 'centre';
  wide?: boolean;
}) {
  const [lead, flow] = splitBands(children);
  return (
    <section
      // The id is a real anchor target, not only a test hook: the destination
      // panel links back to the stages, and those links have to work with
      // JavaScript disabled entirely.
      id={`stage-${id}`}
      className={`panel panel--${align}${wide ? ' panel--wide' : ''}`}
      style={{ '--share': shareOf(id) } as React.CSSProperties}
      data-stage={id}
      data-testid={`stage-${id}`}
    >
      <div className="panel__inner">
        <div className="panel__band panel__band--lead">
          <p className="panel__eyebrow">
            {eyebrow}
            <span className="panel__altitude">{altitude}</span>
          </p>
          {lead}
        </div>
        <div className="panel__band panel__band--flow">
          <div className="panel__band-inner">{flow}</div>
        </div>
      </div>
    </section>
  );
}

// --- 1 · 0–150 m -------------------------------------------------------------
function Calibration() {
  return (
    <Panel id="calibration" eyebrow={m('calibration.eyebrow')} altitude={m('calibration.altitude')}>
      <h1 className="panel__title panel__title--hero">
        {m('calibration.title.a')}
        <br />
        <em>{m('calibration.title.em')}</em> {m('calibration.title.b')}
      </h1>
      <p className="panel__lead">{m('calibration.lead')}</p>
      <p className="panel__actions">
        {/* `pageHref`, not `/arajanlat.html`. The hard-coded path was correct
            only on the Hungarian homepage: it sent an English or German visitor
            to the Hungarian quote form, which is the one link on this page a
            visitor is most likely to follow. */}
        <a className="btn" href={pageHref('quote')} data-testid="cta-primary-hero">
          {m('common.cta.ascend')}
        </a>
        <a className="btn btn--ghost" href="#stage-selected-work">
          {m('common.cta.work')}
        </a>
      </p>
      <p className="panel__meta">{m('calibration.meta')}</p>
    </Panel>
  );
}

// --- 2 · 150–3 000 m ---------------------------------------------------------
function InitialAscent() {
  return (
    <Panel
      id="initial-ascent"
      eyebrow={m('initialAscent.eyebrow')}
      altitude={m('initialAscent.altitude')}
    >
      <h2 className="panel__title">
        {m('initialAscent.title.a')} <em>{m('initialAscent.title.em')}</em>
      </h2>
      <p>{m('initialAscent.body.a')}</p>
      <p>{m('initialAscent.body.b')}</p>
      <p className="panel__meta">{m('initialAscent.meta')}</p>
    </Panel>
  );
}

// --- 3 · 3 000–6 000 m -------------------------------------------------------
function LowerAtmosphere() {
  return (
    <Panel
      id="lower-atmosphere"
      eyebrow={m('lowerAtmosphere.eyebrow')}
      altitude={m('lowerAtmosphere.altitude')}
      wide
    >
      <h2 className="panel__title">
        {m('lowerAtmosphere.title.a')} <em data-kinetic="lower-atmosphere">{m('lowerAtmosphere.title.em')}</em>
      </h2>
      <p className="panel__lead">{m('lowerAtmosphere.lead')}</p>

      {/* Sequential altitude checkpoints rather than six identical service
          cards: the order is the message, and a card grid says the opposite —
          that these are interchangeable options on a menu. */}
      <ol className="ladder">
        {CAPABILITIES.map((c) => (
          <li key={c.name} className="ladder__step">
            <span className="ladder__at">{formatAltitude(c.at)} m</span>
            <h3 className="ladder__name">{c.name}</h3>
            <p className="ladder__line">{c.line}</p>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

// --- 4 · 6 000–8 500 m -------------------------------------------------------
function CloudEntry() {
  return (
    <Panel id="cloud-entry" eyebrow={m('cloudEntry.eyebrow')} altitude={m('cloudEntry.altitude')}>
      <h2 className="panel__title">
        {m('cloudEntry.title.a')} <em>{m('cloudEntry.title.em')}</em>
      </h2>
      <p>{m('cloudEntry.body.a')}</p>
      <p>{m('cloudEntry.body.b')}</p>
    </Panel>
  );
}

// --- 5 · 8 500–11 000 m ------------------------------------------------------
function CloudBreakthrough() {
  return (
    <Panel
      id="cloud-breakthrough"
      eyebrow={m('cloudBreakthrough.eyebrow')}
      altitude={m('cloudBreakthrough.altitude')}
      align="centre"
    >
      <h2 className="panel__title panel__title--statement">
        {m('cloudBreakthrough.title.a')}
        <br />
        <em data-kinetic="cloud-breakthrough">{m('cloudBreakthrough.title.em')}</em>
      </h2>
      <p className="panel__lead">{m('cloudBreakthrough.lead')}</p>
    </Panel>
  );
}

// --- 6 · 11 000–17 000 m -----------------------------------------------------
function SelectedWork() {
  return (
    <Panel
      id="selected-work"
      eyebrow={m('selectedWork.eyebrow')}
      altitude={m('selectedWork.altitude')}
      wide
    >
      <h2 className="panel__title">
        {m('selectedWork.title.a')} <em>{m('selectedWork.title.em')}</em>
      </h2>
      <p className="panel__lead">{m('selectedWork.lead')}</p>

      <div className="work">
        {WORK.map((w) => (
          <article className="case" key={w.id} data-testid={`case-${w.id}`}>
            <header className="case__head">
              <p className="case__at">{formatAltitude(w.altitude)} m</p>
              <h3 className="case__name">{w.name}</h3>
              <p className="case__sector">{w.sector}</p>
            </header>

            {w.image && (
              <figure className="case__figure">
                {/* Lazy and dimension-bearing: these are below the fold by
                    definition, and an image that arrives without a reserved box
                    reflows the track under ScrollTrigger's feet. */}
                <img src={w.image.src} alt={w.image.alt} loading="lazy" decoding="async" width={1200} height={1500} />
              </figure>
            )}

            <dl className="case__body">
              <dt>{m('case.term.challenge')}</dt>
              <dd>{w.challenge}</dd>
              <dt>{m('case.term.intervention')}</dt>
              <dd>{w.intervention}</dd>
              <dt>{m('case.term.implementation')}</dt>
              <dd>{w.implementation}</dd>
              <dt>{m('case.term.result')}</dt>
              <dd>{w.result}</dd>
              <dt>{m('case.term.ongoing')}</dt>
              <dd>{w.ongoing}</dd>
            </dl>

            {/* Rendered only when a verified figure exists. None do yet, and the
                honest thing is an absent row rather than an invented number. */}
            {w.metric && (
              <p className="case__metric">
                <strong>{w.metric.value}</strong> <span>{w.metric.label}</span>
              </p>
            )}

            {w.quote && (
              <blockquote className="case__quote">
                <p>{w.quote.text}</p>
                <footer>
                  <b>{w.quote.by}</b> · {w.quote.role}
                </footer>
              </blockquote>
            )}

            {w.logo && (
              <img className="case__logo" src={w.logo.src} alt={w.logo.alt} loading="lazy" decoding="async" />
            )}
          </article>
        ))}
      </div>
    </Panel>
  );
}

// --- 7 · 17 000–22 000 m -----------------------------------------------------
function SystemStage() {
  const rings = [0, 1, 2] as const;
  const ringName = [m('system.ring.0.name'), m('system.ring.1.name'), m('system.ring.2.name')];
  const ringNote = [m('system.ring.0.note'), m('system.ring.1.note'), m('system.ring.2.note')];

  return (
    <Panel id="system" eyebrow={m('system.eyebrow')} altitude={m('system.altitude')} wide>
      <h2 className="panel__title">
        {m('system.title.a')} <em>{m('system.title.em')}</em>
      </h2>
      {/* Deliberately not "the diagram on the right": the rings sit behind this
          panel, and on a phone there is no right-hand side at all. Copy that
          points at a screen position is copy that is wrong on half the devices
          that read it — and wrong for anyone who cannot see it. */}
      <p className="panel__lead">{m('system.lead')}</p>

      <div className="system">
        {rings.map((r) => (
          <section className="system__ring" key={r} data-ring={r}>
            <h3 className="system__ring-name">
              <span className="system__ring-index">{r + 1}</span> {ringName[r]}
            </h3>
            <p className="system__ring-note">{ringNote[r]}</p>
            <ul className="system__list">
              {SYSTEM.filter((n) => n.ring === r).map((n) => (
                <li key={n.id}>
                  <b>{n.name}</b> — {n.blurb}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Panel>
  );
}

// --- 8 · 22 000–25 500 m -----------------------------------------------------
function ProcessStage() {
  return (
    <Panel id="process" eyebrow={m('process.eyebrow')} altitude={m('process.altitude')} wide>
      <h2 className="panel__title">
        {m('process.title.a')} <em>{m('process.title.em')}</em>
      </h2>
      <p className="panel__lead">{m('process.lead')}</p>

      <ol className="process">
        {PROCESS.map((p) => (
          <li className="check" key={p.index} data-testid={`checkpoint-${p.index}`}>
            <div className="check__head">
              <span className="check__index">{String(p.index).padStart(2, '0')}</span>
              <h3 className="check__name">{p.name}</h3>
              <span className="check__at">{formatAltitude(p.altitude)} m</span>
            </div>
            <dl className="check__grid">
              <div>
                <dt>{m('checkpoint.term.happens')}</dt>
                <dd>{p.happens}</dd>
              </div>
              <div>
                <dt>{m('checkpoint.term.weProduce')}</dt>
                <dd>{p.weProduce}</dd>
              </div>
              <div>
                <dt>{m('checkpoint.term.youProvide')}</dt>
                <dd>{p.youProvide}</dd>
              </div>
              <div>
                <dt>{m('checkpoint.term.outcome')}</dt>
                <dd>{p.outcome}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

// --- 9 · 25 500–28 000 m -----------------------------------------------------
function StratosphereTransition() {
  return (
    <Panel
      id="stratosphere-transition"
      eyebrow={m('stratosphereTransition.eyebrow')}
      altitude={m('stratosphereTransition.altitude')}
    >
      <h2 className="panel__title">
        {m('stratosphereTransition.title.a')} <em>{m('stratosphereTransition.title.em')}</em>
      </h2>
      <p>{m('stratosphereTransition.body.a')}</p>
      <p>{m('stratosphereTransition.body.b')}</p>
    </Panel>
  );
}

// --- 10 · 28 000–30 000 m ----------------------------------------------------
function FullStratosphere() {
  return (
    <Panel
      id="full-stratosphere"
      eyebrow={m('fullStratosphere.eyebrow')}
      altitude={m('fullStratosphere.altitude')}
      align="centre"
    >
      <h2 className="panel__title panel__title--statement">
        {m('fullStratosphere.title.a')} <em data-kinetic="full-stratosphere">{m('fullStratosphere.title.em')}</em>
      </h2>
      <p className="panel__lead">{m('fullStratosphere.lead')}</p>
    </Panel>
  );
}

// --- 11 · 30 000 m -----------------------------------------------------------
/**
 * The closing CTA — and the one panel that was not composed against the
 * instrument at all.
 *
 * It is hand-built rather than a `<Panel>` because it carries three things no
 * other panel has: two calls to action, a contact line, and the stage index. It
 * therefore also missed the two band wrappers, and the effect of that was not
 * cosmetic. `measureComposition` decides a panel's composition by measuring its
 * lead band; a panel with no lead band measures zero, falls to `data-fit="flow"`
 * by the rule that a band which cannot hold a headline must not be used, and
 * flows straight across the centred instrument. Measured at 30 000 m the plate
 * covered the essential silhouette completely on *every* viewport — desktop,
 * landscape and portrait alike — which is the state the finished instrument was
 * supposed to be the subject of.
 *
 * It was invisible until the validation harness was fixed. The harness read
 * `journey.current` in the same tick it wrote the altitude override, so every
 * sample was scrolled to the previous sample's position and the final state was
 * never actually measured under the final panel. See validate-meridian.mjs.
 *
 * The bands are the same ones `Panel` uses, split at the same boundary, so this
 * panel now composes exactly as the other ten do and needs no rule of its own.
 */
function Destination() {
  // Split after the actions, not after the headline.
  //
  // Everywhere else the lead band holds the eyebrow and the headline and the
  // flow band walks the prose through the lower band as the stage advances.
  // Applied here that puts the two calls to action *in the walk*, and at the
  // end of the track — where `--stage-flow` is 1 and the window shows the tail
  // of the copy — the primary action has travelled out of the band. The closing
  // action being on screen and tappable when the visitor reaches the bottom of
  // the page is an accepted requirement with a test of its own; walking it past
  // them would break it.
  //
  // So the closing panel's *lead* is its argument and its actions, held still
  // above the instrument for the whole stage, and only the contact line and the
  // stage index — which are an afterword and a site index — go in the window.
  // Measured across three locales, the lead band holds that on 430×932,
  // 390×844, 360×800 and 768×1024; where it does not,
  // `measureComposition` falls the panel back to natural flow, which is §6's
  // answer and not a failure.
  const [lead, flow] = splitBands(
    [
    <h2 className="panel__title panel__title--statement" key="title">
      {m('destination.title.a')} <em>{m('destination.title.em')}</em>
    </h2>,
    <p className="panel__lead" key="lead">
      {m('destination.lead')}
    </p>,
    <p className="panel__actions panel__actions--final" key="actions">
      <a className="btn btn--lg" href={pageHref('quote')} data-testid="cta-primary">
        {m('common.cta.ascend')}
      </a>
      <a className="btn btn--ghost btn--lg" href="#stage-selected-work" data-testid="cta-secondary">
        {m('destination.cta.work')}
      </a>
    </p>,
    <p className="panel__contact" key="contact">
      {m('destination.contact.a')}{' '}
      <a href={pageHref('contact')} data-testid="cta-contact">
        {m('destination.contact.link.contact')}
      </a>{' '}
      {m('destination.contact.b')}{' '}
      <a href={pageHref('quote')} data-testid="cta-qualify">
        {m('destination.contact.link.quote')}
      </a>
      {m('destination.contact.c')}
    </p>,
    <ul className="panel__stages" aria-label={m('destination.stages.label')} key="stages">
      {STAGES.filter((s) => s.id !== 'destination').map((s) => (
        <li key={s.id}>
          <a href={`#stage-${s.id}`}>
            <span>{s.label}</span>
            <i>{formatAltitude(s.to)} m</i>
          </a>
        </li>
      ))}
    </ul>,
    ],
    'panel__actions',
  );

  return (
    <section
      id="stage-destination"
      className="panel panel--destination"
      style={{ '--share': shareOf('destination') } as React.CSSProperties}
      data-stage="destination"
      data-testid="stage-destination"
    >
      <div className="panel__inner">
        <div className="panel__band panel__band--lead">
          <p className="panel__eyebrow">
            {m('destination.eyebrow')}
            <span className="panel__altitude">{m('destination.altitude')}</span>
          </p>
          {lead}
        </div>
        <div className="panel__band panel__band--flow">
          <div className="panel__band-inner">{flow}</div>
        </div>
      </div>
    </section>
  );
}

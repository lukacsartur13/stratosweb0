import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { JourneyHUD } from './components/JourneyHUD';
import { m, pageHref } from './i18n';
import { JourneyFallback } from './components/JourneyFallback';
import { SceneBoundary } from './components/SceneBoundary';
import { detect, hasFinePointer, type Capability } from '@/lib/capabilities';
import { CAPABILITIES, COLLABORATIONS, FEATURED_CASE_ID, PROCESS, PROOF_IMAGE, SYSTEM, WORK } from './content';
import { STAGES, formatAltitude, journey, type StageId } from './journey';
import { SCENE } from './scene';
import { ACT_HOLD, GROUND_HOLD, INSTRUMENT, PASSAGE, PASSAGE_HOLD, actOf, type ActId, type PassageId } from './acts';
import { overheadStatement } from './composition';
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

  // No <main> wrapper. The landmark is `<main class="journey" id="main">` in the
  // locale shell, and this component renders into it — see main.tsx. Rendering
  // one here as well would nest two main landmarks and, more to the point,
  // would mean the landmark only exists once this component has mounted.
  return (
    <>
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

          {/*
            The air between the visitor and the scene.

            Two gradients, both pure functions of `--alt`, both in front of the
            canvas and behind the copy:

              ground   the dense lower atmosphere. Full strength at 0 m and
                       gone by ~9 000 m, so the opening frame is bottom-heavy
                       and the first screens of scroll are visibly the ground
                       falling away — which is the signal §9 asks the first
                       viewport of movement to give.
              opening  the cold light above. Absent at 0 m, widest through the
                       upper stages, restrained again at the ceiling.

            Deliberately DOM and not more shader. `Sky.tsx` renders the sky the
            visitor is inside; this is the haze between them and it, and it is
            the layer that has to keep working on the two paths that never
            mount a renderer. One element, two gradients, no filter, no
            animation, and nothing on a scroll frame but the custom property
            the publisher was already writing.
          */}
          <div className="air" aria-hidden="true">
            <i className="air__ground" />
            <i className="air__horizon" />
            <i className="air__field" />
            <i className="air__opening" />
            {/* The restraint wash — §36 and §37. One continuous function of the
                altitude that takes authority off the scene so the typography can
                have it, densest at the ground where the terrain was the loudest
                object on the page and lightest across the curvature, which is
                the only reference the arrival has. See styles.css. */}
            <i className="air__restraint" />
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
          {/* Six acts and an action beat, with four crossings under them. The
              order is the stage order and the stage order is the altitude
              order — see `acts.ts`. */}
          <ActGround />
          <ActNoise />
          <ActSystem />
          <PassageCloudEntry />
          <PassageBreakthrough />
          <ActProof />
          <PassageSystem />
          <PassageProcess />
          <ActHighAltitude />
          <ActArrival />
          <ActAction />
        </div>
      </div>

      {/*
        No footer here any more.

        There was one — a line of links and a locale switch, invented for this
        route because at the time this route was a prototype with nothing else
        to reach for. It has been replaced by the site's own: the Arrival
        convergence and the ground-control footer that the other 66 routes
        carry, rendered by `_build/build.py` into the locale shell around this
        component, outside `<main>` and after it.

        That is the whole point of the change. This page had a footer with seven
        links and no contact details, no service architecture, no legal group
        and no back-to-top, sitting under a page that had no header at all — so
        the homepage was the one route on the site you could not navigate from.
        The answer was not a better homepage-only footer.

        See experiments/home/hu.html for the four chrome slots, and
        experiments/vite.home.config.ts for how they are filled.
      */}
    </>
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
 * The chapter's art direction, as data attributes.
 *
 * Four decisions — `scene.ts` — reaching the stylesheet as four attributes on
 * the panel rather than as four class names. They are facts about the chapter,
 * exactly as `data-stage` is; a class would invite a second, contradictory one
 * to be added at a call site, and there is nowhere for that to happen here.
 *
 * The stylesheet composes against these and against nothing else: there is no
 * per-stage selector anywhere in the type scale or the frame rules, which is
 * what makes "every scene has its own composition" a table that can be read
 * rather than eleven exceptions that have to be found.
 */
function sceneAttrs(id: StageId) {
  const scene = SCENE[id];
  return {
    'data-monument': scene.tier,
    'data-frame': scene.frame,
    'data-instrument': scene.instrument,
    'data-sky': scene.sky,
    // Whether this chapter's statement is composed OVER the instrument rather
    // than beside it. It is `frame` and the chapter's authored rail — two
    // constants — so it is rendered here rather than published by the
    // measurement pass, and that is not a tidy-up: it selects box widths, and a
    // box tree that changes one frame after the first paint changes the
    // document's height with it. On WebKit, which has no scroll anchoring, that
    // is a back navigation landing 563px short of where the visitor left.
    ...(overheadStatement(id) ? { 'data-overhead': '1' } : null),
  };
}

/* `splitBands` IS GONE — §34.
 *
 * It cut a panel's children at its `.panel__title` so the portrait window could
 * give the lead band and the flow band separate boxes. `Panel` was its only
 * caller and `Panel` has no call sites left: the four crossings it composed are
 * editorial passages now, and a passage is an absolutely composed field with no
 * lead band, no flow band and no window. The dev-time assertion that went with
 * it — "no .panel__title among the children" — described a contract only that
 * composition had.
 *
 * §35 asks what else it served before it is deleted, and the answer is nothing:
 * it took children and returned two arrays. The portrait composition it existed
 * for is `mobile/MobileHome.tsx`, which has never used it. */

/* `Notes` IS GONE — LAYER C WITH IT. §2, §6, §34.
 *
 * It was the third type layer: a caption, an editorial aside or a technical
 * remark, each item on its own hairline, in the data face, in a measure
 * narrower than the line above it, with a two-column field when a list had four
 * items and an uppercase tracked-out variant for the technical tone.
 *
 * It was the right answer to the problem it was built for — eleven chapters
 * that read as eleven identical modules of body copy — and it is the wrong
 * answer to this one. §2 gives the homepage two visual levels and no third, and
 * a dedicated annotation layer with its own face, its own case, its own
 * tracking and its own rules is a third. §6 names dense microcopy, HUD-like
 * annotations and horizontal rule systems in the same list.
 *
 * By the time it was removed it had four call sites and all four were inside
 * ACT BODIES — the crossings that used it are passages now. Every one of those
 * four is the same sentences in the same order in `.passage__terms`, which is
 * the one structural idiom the page has left.
 *
 * §35's audit: it carried `data-notes`, which nothing read; no state, no
 * observer, no live region and no measurement. `.notes` and its rules are still
 * in `styles.css` and are what §55 removes once the design is approved. */

/* `Panel` IS GONE, AND WITH IT THE OLD CROSSING COMPOSITION — §6, §34.
 *
 * It was the component every chapter on this page used before the six acts, and
 * after them it was what the four crossings still ran: a rail, an eyebrow
 * carrying a roman numeral and an altitude range, a measured lead band that
 * hung in the sky band and dissolved on `--pass`, a windowed flow band, a copy
 * side chosen against the instrument's rail, and the reverse-gravity pass over
 * all of it. `probe-crossings.mjs` measured what a visitor met inside it: 21
 * simultaneous objects at the nine areas and 49 at the process.
 *
 * §6 does not ask for that to be quietened. It asks for it to be gone, and it
 * says in as many words not to keep it merely because it works. The four
 * chapters it composed are `PassagePanel`s now.
 *
 * §35's audit, before deleting it, of what else it carried:
 *
 *   the anchor `id`        every act and passage still renders `stage-<id>`,
 *                          and the closing index still links to all eleven
 *   `--share`              `PassagePanel` sets it, from the same `shareOf`
 *   `sceneAttrs`           split: the two scene facts a passage still carries
 *                          are on it, the three that described the old
 *                          composition are not
 *   `data-testid`          unchanged, so every existing selector still resolves
 *   the horizon fragment   already retired in the previous pass; the call site
 *                          it left behind went with this
 *
 * The `.panel__*` rules it used are still in `styles.css` above the Direction D
 * section. They are unreachable from this page and they are what §55 says to
 * remove once the new design is visually approved — not before, and not in the
 * same change that has to be reviewed on its own merits.
 */

// =============================================================================
// THE SIX ACTS.
//
// Seven peak frames — six acts and the action beat — plus four crossings that
// run underneath them. `acts.ts` is the map and the reason it looks the way it
// does; this file renders it.
//
// ## What a peak frame is, structurally
//
// One sticky screen holding an absolutely-composed field, and nothing else in
// the box. The field is the master study's own 1440 × 900 frame, scaled
// uniformly to this viewport, so every placement below is written in the
// study's coordinates and lands where the approved still puts it. There is no
// breakpoint ladder, no measured column, no solved word cap and no text
// measurement of any kind on this path — which is §19's font-metric hazard
// answered by removing the measurement rather than by hardening it.
//
// ## What a crossing is
//
// An ordinary `Panel`, exactly as before, with its monument tier stepped down.
// §3: the internal scroll stages may remain underneath, and they must support
// the acts rather than compete with them. They keep every word they had.
// =============================================================================

/**
 * A peak act frame.
 *
 * The panel is still `--share` screens tall, because that is what keeps the
 * narrative and the altitude curve in step, and the frame inside it is one
 * sticky screen. Anything the act carries beyond its frame flows underneath in
 * `body`, which is where the chapters' real content went: the capability
 * ladder, the case, the nine areas, the closing contact line. The frame is the
 * thing a visitor remembers; the body is the thing they read if they want it.
 */
function ActPanel({
  id,
  children,
  body,
}: {
  id: StageId;
  children: React.ReactNode;
  body?: React.ReactNode;
}) {
  const act = actOf(id);
  /**
   * An act with nothing under its frame holds the frame for its whole panel.
   *
   * For the six acts that carry a body the hold is `ACT_HOLD` and the body
   * flows up behind the frame as it releases. The action beat has no body, and
   * it is the last panel in the track — so its frame is pinned all the way to
   * the foot of the homepage, which is what makes the closing invitation the
   * last thing on screen rather than the last thing before a gap.
   */
  // Act I is the one act with its own hold. See `GROUND_HOLD` in `acts.ts` for
  // why: a bodyless act never releases its frame, so for Act I the hold IS the
  // composed window, and at 1.8 that made the hero the only chapter on the page
  // with three quarters of a screen in which nothing at all changes.
  const base = id === 'calibration' ? GROUND_HOLD : ACT_HOLD;
  const hold = body ? base : Math.max(base, shareOf(id));
  return (
    <section
      id={`stage-${id}`}
      className="panel panel--act"
      style={{ '--share': shareOf(id) } as React.CSSProperties}
      data-stage={id}
      data-act={act}
      data-act-role="peak"
      data-level="master"
      /* An act whose frame owns its whole panel does not depart: there is
         nothing after it for it to make room for. The action beat is the only
         one, and it is the reason this is an attribute rather than a rule
         keyed on the act's id — the property is structural. */
      data-act-departs={body ? undefined : 'no'}
      /* §46. THE OCCLUSION PERMISSION, DECLARED. An act whose placement says the
         object may stand in front of its statement carries this and the mask
         rule applies; an act that does not carries nothing and cannot be
         occluded by an object that merely overlaps it. Read straight off the
         placement table rather than restated here, so the contract the tests
         assert and the attribute the stylesheet keys on are the same fact. */
      data-occlusion={INSTRUMENT[act]?.occlusion}
      {...sceneAttrs(id)}
      data-testid={`stage-${id}`}
    >
      {/* The hold. The frame is one screen tall and this box is `ACT_HOLD`
          screens tall, so the sticky frame is pinned for the difference and
          then releases — which is what turns the composition from a moment the
          visitor passes through into a state they arrive at. Without it the
          frame scrolls at exactly the speed of the page and is never settled. */}
      <div className="act__hold" style={{ '--act-hold': hold } as React.CSSProperties}>
        <div className="act">
          <div className="act__field">{children}</div>
        </div>
      </div>
      {body ? (
        <div className="act__body">
          <div className="act__body-inner">{body}</div>
        </div>
      ) : null}
    </section>
  );
}

/**
 * The statement, on its authored lines.
 *
 * `white-space: nowrap` on every line is in the stylesheet rather than here,
 * and it is not belt-and-braces: without it a line that overruns re-breaks
 * silently, stays inside the margins, and passes every automated check while
 * the browser quietly rewrites the art direction. With it, an overrun is
 * visible — which is the failure mode a designer can see and act on.
 */
function Monument({
  act,
  as: Tag = 'h2',
}: {
  act: ActId;
  as?: 'h1' | 'h2';
}) {
  const key = `act.${act}.monument` as Parameters<typeof m>[0];
  return (
    <Tag className="act__monument">
      {m(key)
        .split('|')
        .map((line, i) => (
          <span key={i}>{line}</span>
        ))}
    </Tag>
  );
}

// --- ACT I · GROUND · 0–150 m ------------------------------------------------
//
// `Magasságot / építünk.` Five objects: the statement on the spine, the
// instrument alone in the upper right with its right edge on the right margin
// line and 202px of air beside it, one quiet line and one restrained action on
// a single band across the foot, and the wordmark — which on the production
// page is the site header's own, not a second one.
//
// It is the smallest fill in the design, at 0.64. That is §21 enforced by
// arithmetic rather than by taste: the hero's authority comes from the field
// around the statement, not from competing with the high-altitude frame.
//
// WHAT LEFT THIS FRAME, AND WHERE IT WENT. The opening used to carry a
// four-line headline with the negation in it, two calls to action, two premise
// annotations and a caption on the instrument — six objects more than the
// approved composition has. The premise (`calibration.title.a`, `note.a`,
// `note.b`) and the instrument caption (`meta`) are still in the document and
// still announced; they are not in the picture. They are prose about the page
// rather than business information, which is the line §43 draws.
function ActGround() {
  return (
    <ActPanel id="calibration">
      <Monument act="i" as="h1" />
      <p className="act__editorial">
        <span>{m('calibration.lead')}</span>
      </p>
      {/* One action, not two. The second — a jump to the work — is the header's
          `Munkáink` and Act IV's own route out; a frame with two invitations in
          it has neither. */}
      <a className="act__action" href={pageHref('quote')} data-testid="cta-primary-hero">
        {m('common.cta.ascend')}
      </a>
      <p className="sr-only">
        {m('calibration.title.a')} {m('calibration.note.a')} {m('calibration.note.b')}{' '}
        {m('calibration.meta')}
      </p>
    </ActPanel>
  );
}

// --- ACT II · NOISE · 150–3 000 m --------------------------------------------
//
// `Idelent / minden / zajos.` Two objects and the largest single silence in the
// design — 43% of the frame, 792 × 704.
//
// The statement is right-aligned to the right margin line and set on three
// lines, which is the one decision that does everything §24 asks: a tall narrow
// column hung from the top of the frame is a silhouette no other act comes
// near, and compression becomes a property of the setting instead of an effect
// added to the picture. There is no instrument, no altitude, and no second line
// of support.
//
// THE STATEMENT USED TO BE AT 6 000–8 500 m. Moving it here is the altitude
// chronology fix — see `acts.ts` — and it costs nothing: not one word changed,
// no stage moved, and `initial-ascent`'s own statement went to the crossing
// this one came from.
function ActNoise() {
  return (
    <ActPanel
      id="initial-ascent"
      body={
        <>
          <p className="act__lead">{m('initialAscent.body.b')}</p>
          {/* One quiet list in the editorial voice, not four annotations on
              hairlines in the data face. `Notes` is what the old crossings
              used for their microcopy and it was still running inside two act
              bodies; §2 allows no third visual language and §6 puts dense
              microcopy and HUD-like annotations on the list. Same four
              sentences, same order. */}
          <ul className="passage__terms">
            <li>{m('initialAscent.note.a')}</li>
            <li>{m('initialAscent.note.b')}</li>
            <li>{m('initialAscent.note.c')}</li>
            <li>{m('initialAscent.note.d')}</li>
          </ul>
        </>
      }
    >
      <Monument act="ii" />
      <p className="act__editorial">
        <span>{m('cloudEntry.note.d')}</span>
      </p>
    </ActPanel>
  );
}

// --- ACT III · SYSTEM · 3 000–6 000 m ----------------------------------------
//
// `Hat terület, / egy rendszer.` Three objects: the quiet line crossing to the
// counter-axis at the top right, the statement holding the spine below the
// middle, and the six disciplines as a colophon along the foot.
//
// THE SIX AREAS ARE A COLOPHON AND NOT SIX CARDS. §25 rejects the dashboard,
// the six equal modules and the row on an even grid — a six-across row is a
// navigation bar wearing a different hat. One running line separated by
// middots reads as evidence that a system exists, cannot compete with a 162px
// statement, and takes one line. The ladder with its altitudes is still here;
// it is under the frame rather than in it.
//
// AND THERE IS NO INSTRUMENT. It was built for this act in the study, posed,
// lit, placed on the right margin line with its centre on the statement's last
// baseline, and cut: German's `Sechs Bereiche, ein System.` is the widest line
// in the design at 1 027px and leaves 17px beside it. An object that has room
// in one language and none in another is lucky, not restrained.
function ActSystem() {
  return (
    <ActPanel
      id="lower-atmosphere"
      body={
        <>
          <p className="act__lead">{m('lowerAtmosphere.lead.a')}</p>
          {/* Sequential altitude checkpoints rather than six identical service
              cards: the order is the message, and a card grid says the opposite
              — that these are interchangeable options on a menu. */}
          {/* THE CAPABILITY LADDER, IN THE PASSAGE'S OWN STRUCTURAL VOICE.
              
              §39 names capability lists as structural content to be solved as
              quiet editorial information rather than as a dashboard, and §2
              allows the page no third visual language. What was here was a
              table: a rule across the top, a rule under every one of six rows,
              a fixed 5rem altitude column in the data face in the signal
              colour, and the name and line in the second column. At thumbnail
              scale it was the one intermediate state on the sheet that looked
              like a different website, which is §48's own failure condition.
              
              Same markup shape as `PassageSystem`'s and `PassageProcess`'s
              bodies, so an act's structural layer and a passage's are one
              treatment. Every capability name and every line is here, in order.
              
              THE ALTITUDE STAMP IS GONE, with the seven checkpoints' — §6's
              "altitude decoration". A rung altitude is not a fact about the
              capability; it is the journey metaphor annotating itself, six
              times, in the colour §22 spends twice on the whole page. */}
          <ol className="passage__terms act__ladder">
            {CAPABILITIES.map((c) => (
              <li key={c.name}>
                <h3>{c.name}</h3>
                <p>{c.line}</p>
              </li>
            ))}
          </ol>
        </>
      }
    >
      <p className="act__editorial act__editorial--counter">
        <span>{m('lowerAtmosphere.lead.b')}</span>
      </p>
      <Monument act="iii" />
      {/* `aria-hidden`, because every word of it is the `<h3>` of a ladder step
          in the same act, forty pixels further down the document. Announced, it
          would read the six disciplines twice, once stripped of their
          altitudes and their sentences. */}
      <p className="act__index" aria-hidden="true">
        {CAPABILITIES.map((c, i) => (
          <span key={c.name}>
            {i > 0 && <i>·</i>}
            {c.name}
          </span>
        ))}
      </p>
    </ActPanel>
  );
}

// --- ACT IV · PROOF · 11 000–17 000 m ----------------------------------------
//
// `~15M Ft`. The densest act in the design — four objects, 35.6% covered —
// deliberately, because it is the one whose job is evidence rather than
// atmosphere, and the only one where the largest type is not a sentence.
//
// Three registers and one silence: the six marks quietly across the top, the
// figure holding the upper left, two quiet lines under it, and the Rapidkert
// cross-section rising from the lower right and cut by two edges of the frame.
// The bottom left is empty on purpose — 696 × 468 of nothing, in the densest
// act — and it is the single most valuable empty rectangle in the design.
//
// THE FIGURE IS THE HEADING, and that is a semantic decision as much as a
// visual one. `selectedWork.title` — *"Akikkel együtt emelkedtünk."* — is good
// copy and it would be a second voice in a frame whose dominant thought is a
// number, so it leads the act's body instead. A screen reader meets "heading
// level 2, ~15M Ft" and then, immediately, the two lines that say whose it is
// and what it means, which is the same reading order the eye takes.
//
// THE METRIC IS `content.ts`'s, WORD FOR WORD. Not revenue, not profit, not
// ROAS, not attributed to advertising alone: paid and organic search together
// produced roughly fifteen million forints of contracted project value, and
// the label says exactly that in all three languages.
function ActProof() {
  const featured = WORK.find((w) => w.id === FEATURED_CASE_ID);
  if (!featured) return null;

  return (
    <ActPanel
      id="selected-work"
      body={
        <article className="case" data-testid={`case-${featured.id}`} data-featured="true">
          <h3 className="case__title">
            {m('selectedWork.title.a')} {m('selectedWork.title.em')}
          </h3>
          <p className="act__lead">{m('selectedWork.lead')}</p>
          <p className="case__sector">
            {featured.sector} · {formatAltitude(featured.altitude)} m
          </p>
          <p className="case__result">{featured.result}</p>
          <p className="case__work">{featured.implementation}</p>
        </article>
      }
    >
      {/* A PROOF PLATE, NOT A CLIENT WALL. §28: no heading over them, no
          carousel, no `OUR CLIENTS`. Their existence is the content, and a
          label on top of it is a second voice saying what the eye has already
          understood. Each mark still carries the organisation's name as its alt
          text — these are informative, not decorative. */}
      <ul className="act__marks" data-testid="collaborations">
        {COLLABORATIONS.map((c) => (
          <li key={c.src}>
            <img
              src={c.src}
              alt={c.name}
              loading="lazy"
              decoding="async"
              width={c.width}
              height={c.height}
            />
          </li>
        ))}
      </ul>

      <h2 className="act__monument act__monument--figure">
        <span>{featured.metric?.value}</span>
      </h2>

      <p className="act__editorial">
        <span>{featured.name}</span>
        <span>{featured.metric?.label}</span>
      </p>

      {/* THE CROSS-SECTION, AT ITS OWN RATIO, CROPPED BY THE FRAME.
          `work-rapidkert-section.jpg` is a window on the capture the site
          already publishes — the same pixels, framed to the thing the project
          actually is. See `scripts/rapidkert-section.mjs` for the rectangle and
          why it is that rectangle. It runs off the right edge and off the foot,
          so it reads as a fragment of something larger rather than as a card in
          a portfolio grid; nothing is scaled non-uniformly, nothing is blurred,
          and there is no longer a headline on it to mask. */}
      <figure className="act__shot">
        <img
          src={PROOF_IMAGE.src}
          alt={featured.image?.alt ?? featured.name}
          loading="lazy"
          decoding="async"
          width={PROOF_IMAGE.width}
          height={PROOF_IMAGE.height}
        />
      </figure>

      {/* Two routes out, quietly, on the foot band — §9 asks for a restrained
          route to the case and a route to all the work, and this is the one
          place on the page they belong. Neither is yellow: the act has one
          yellow event and it is the figure. */}
      <p className="act__routes">
        <a href={pageHref('caseRapidkert')} data-testid="cta-featured-case">
          {m('featured.cta.case')}
        </a>
        <a href={pageHref('work')} data-testid="cta-work">
          {m('featured.cta.work')}
        </a>
      </p>
    </ActPanel>
  );
}

// --- ACT V · HIGH ALTITUDE · 25 500–28 000 m ---------------------------------
//
// `Innen már látni / a görbületet.` Direction D's D3, unchanged: same
// statement, same authored break, same fill of 0.88 — the largest in the design
// — same foot line at 748, same three objects, and 1 440 × 256 of nothing
// between the quiet line pinned to the top of the field and the statement lying
// along the foot.
//
// This is the quality benchmark and weakening it is a failure condition, so
// nothing in it was touched. No instrument and no trace of one: §30 asks this
// scene to prove the identity is stronger than the 3D object, and the way to
// prove that is for the object not to be there. No horizon rule either — a rule
// that has to dodge a 174px statement in three locales is decoration pretending
// to be structure.
//
// It carries the one micro label in the six frames, because it is the one act
// whose sentence is itself a measurement about the atmosphere.
function ActHighAltitude() {
  return (
    <ActPanel
      id="stratosphere-transition"
      body={
        <>
          <p className="act__lead">{m('stratosphereTransition.note.b')}</p>
          <p className="act__lead">{m('stratosphereTransition.body.b')}</p>
        </>
      }
    >
      <p className="act__micro">{m('act.v.altitude')}</p>
      <p className="act__editorial act__editorial--counter">
        <span>{m('stratosphereTransition.note.a')}</span>
      </p>
      <Monument act="v" />
    </ActPanel>
  );
}

// --- ACT VI · ARRIVAL · 28 000–30 000 m --------------------------------------
//
// `Üdv a / sztratoszférában.` Two objects and the sky, and the only
// symmetrical frame in the design. Five acts of deliberate asymmetry are what
// make a centred sixth read as the composition coming to rest.
//
// The instrument returns here and nowhere else — square-on, low, and 160px
// against the opening's 221: recognisably the same object, and deliberately not
// the same appearance. See the refinement note in `acts.ts` for what §12–13 of
// the production brief changed about the approved still, and what it did not:
// nothing was added, no copy, no label, no yellow, no orbit line.
//
// No altitude label. By the arrival the instrument states it better than a
// label can.
function ActArrival() {
  return (
    <ActPanel
      id="full-stratosphere"
      /* THE CLOSING MATTER LIVES HERE, AND NOT UNDER THE ACTION.
       *
       * §15 asks the action beat to be one of the emptiest frames on the
       * homepage, and the production capture found the sharper reason for it:
       * whatever is last in the document is what is on screen at the foot of
       * the page, and the action beat had a lead, a contact line and an index
       * of eleven altitudes under its frame. The visitor reached the bottom of
       * the homepage and the last thing there was a list.
       *
       * So the arrival act carries the closing prose — its own line, the
       * conversation the offer opens with, the alternative to taking it, and
       * the index — and the action beat carries a question and an invitation
       * and nothing else. The two beats stay two beats: none of this is an
       * offer, and the offer is still a frame of its own after it. */
      body={
        <>
          <p className="act__lead">{m('fullStratosphere.lead')}</p>
          <p className="act__lead">{m('destination.lead')}</p>
          <p className="act__contact">
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
          <ul className="act__stages" aria-label={m('destination.stages.label')}>
            {STAGES.filter((s) => s.id !== 'destination').map((s) => (
              <li key={s.id}>
                <a href={`#stage-${s.id}`}>
                  <span>{s.label}</span>
                  <i>{formatAltitude(s.to)} m</i>
                </a>
              </li>
            ))}
          </ul>
        </>
      }
    >
      <Monument act="vi" />
    </ActPanel>
  );
}

// --- THE ACTION BEAT · 30 000 m ----------------------------------------------
//
// `Készen állsz / felemelkedni?` The emptiest frame on the page: one direct
// question, one action, and 1 440 × 300 of nothing. No panel, no card, no
// modal, no busy footer, no second call to action, no list of altitudes in the
// frame.
//
// §14 keeps this separate from the arrival, and §15 keeps it small. The action
// is a line of type with a hairline under it, at the editorial size, at weight
// 400 — and it is the last of the page's two yellow events. It is important
// here because nothing competes with it, which is the only mechanism this
// frame uses.
//
// It sits on the same architectural band Act I used for the same invitation.
// The rhyme is deliberate: the ascent opens and closes with the same sentence
// in the same place.
function ActAction() {
  return (
    <ActPanel id="destination">
      <Monument act="action" />
      <a
        className="act__action act__action--signal"
        href={pageHref('quote')}
        data-testid="cta-primary"
      >
        {m('common.cta.ascend')}
      </a>
      {/* The route back to the work. It is not in the picture — §15 gives this
          frame one action and the lack of competition is what gives it
          importance — and it is not gone either: it is the last thing in the
          document's reading order and the first thing after the action for
          anyone arriving by keyboard. */}
      <a className="sr-only" href="#stage-selected-work" data-testid="cta-secondary">
        {m('destination.cta.work')}
      </a>
    </ActPanel>
  );
}

// =============================================================================
// ======================= T H E   E D I T O R I A L   P A S S A G E S =========
// =============================================================================
//
// LEVEL B. The four chapters that are not frames — §2 of the continuity brief,
// which gives the homepage exactly two visual levels and forbids a third.
//
// WHAT THESE REPLACE. Until this pass the four crossings ran the composition
// the rest of this file's `Panel` still describes: a rail, an eyebrow carrying
// a roman numeral and an altitude range, a `<h2>` at a medium tier, a measured
// copy column, mono annotations on hairlines, and — at the two structural
// chapters — a three-column ring grid with yellow index numerals and a
// seven-times-repeated four-term description table. `probe-crossings.mjs`
// counted what a visitor actually met in one frame: 21 objects at the nine
// areas, 49 at the process. That is the old agency website, and it was running
// between the master acts.
//
// WHAT A PASSAGE IS. The same field, grid, reference pixel and motion grammar
// as an act — that is what makes the journey one brand — differing in three
// declared things: it sets at 58–72u against the acts' 122–179u, it is pinned
// for a quarter of a screen against their four fifths, and it shows one
// primary thought, one supporting statement and at most one structural layer,
// with the structural layer STAGED BELOW the frame rather than beside it.
//
// NOT ONE WORD OF COPY WAS REWRITTEN. Every string below is the string the
// crossing already carried, in all three locales, in its own order. Where a
// sentence was too long to be a statement, §8's instruction is followed
// exactly: the strongest phrase is selected from the copy hierarchy that
// already exists — every crossing title in `messages.ts` is authored in two
// halves — and the other half is set quietly above it.
// =============================================================================

/**
 * A passage frame.
 *
 * Structurally an `ActPanel` with a shorter hold and a different type tier,
 * and deliberately so: §3 asks for continuity, and two components that compose
 * the same field the same way is what continuity is made of.
 *
 * The hold is clamped to the chapter's own share because `cloud-breakthrough`
 * is 1.2 screens long, and a frame pinned for longer than its panel is a frame
 * that never releases.
 */
function PassagePanel({
  id,
  label,
  altitude,
  children,
  body,
}: {
  id: PassageId;
  /** The chapter's own eyebrow. Announced, never painted — see below. */
  label: string;
  altitude: string;
  children: React.ReactNode;
  body?: React.ReactNode;
}) {
  const setting = PASSAGE[id];
  const share = shareOf(id);
  const hold = Math.min(PASSAGE_HOLD, share);
  const scene = SCENE[id];
  return (
    <section
      id={`stage-${id}`}
      className="panel panel--passage"
      style={{ '--share': share, '--act-hold': hold } as React.CSSProperties}
      data-stage={id}
      data-act={actOf(id)}
      data-act-role="crossing"
      /* §32's whole placement vocabulary, and the two attributes the passage
         stylesheet composes against. There is no per-stage selector in it. */
      data-level="passage"
      data-passage={id}
      data-passage-kind={setting.kind}
      data-axis={setting.axis}
      /* The two scene facts a passage still carries. `data-monument`,
         `data-frame` and `data-overhead` are NOT here: all three select the old
         crossing composition — the tier ladder, the rail geometry and the
         overhead box widths — and none of it renders on this page any more.
         §34 asks for the visual logic that exists only for the rejected design
         to go, and leaving three attributes behind that nothing reads is how a
         second visual system stays alive behind a selector. */
      data-instrument={scene.instrument}
      data-sky={scene.sky}
      data-testid={`stage-${id}`}
    >
      {/* THE CHAPTER MARKER, ANNOUNCED RATHER THAN PAINTED — §6 and §31.
          
          `VII · A rendszer · 17 000 – 22 000 m` was a rail, a roman numeral and
          an altitude range across the top of every crossing, in the data face,
          tracked out: the single most recognisable piece of the old language
          and the one thing present in all four of them. §6 removes the
          presentation and §19 says altitude may stay semantically active while
          becoming visually quieter.
          
          So it is still here, still first in the chapter's reading order, and
          still what a screen reader meets on entering the section — which is
          also what keeps the accessibility walk announcing eleven chapters
          rather than seven. It is simply not in the picture. The master acts
          have never had one. */}
      <p className="sr-only">
        {label} · {altitude}
      </p>
      <div className="passage__hold">
        <div className="passage">
          <div className="passage__field">{children}</div>
        </div>
      </div>
      {body ? (
        <div className="passage__body">
          <div className="passage__body-inner">{body}</div>
        </div>
      ) : null}
    </section>
  );
}

/**
 * The passage statement, on its authored lines.
 *
 * The lines are the ones the copy already has. Every crossing title in
 * `messages.ts` is authored as `.a` and `.em` — a break a writer chose, at the
 * sentence's own hinge — and it is used here as the break the composition sets
 * on. Nothing is re-broken, re-worded or re-ordered.
 *
 * `white-space: nowrap` is on the span in the stylesheet for the reason the
 * monuments give: without it an over-long line re-breaks silently, stays inside
 * the margins and passes every automated check while the browser quietly
 * rewrites the art direction.
 */
function Statement({ lines }: { lines: string[] }) {
  return (
    <h2 className="passage__statement">
      {lines.map((line, i) => (
        <span key={i}>{line}</span>
      ))}
    </h2>
  );
}

// --- PASSAGE · cloud entry · 6 000–8 500 m -----------------------------------
//
// `Egy weboldal önmagában / nem visz sehova.` — the frame §7 names.
//
// The statement stays. What went is everything that was arranged around it: the
// rail and its roman numeral, the altitude range, the copy column pinned to the
// lower right, and three mono annotations on hairlines under that. Six objects
// and two type systems, at 72px, in the middle of a luxury ascent.
//
// It is now the largest passage on the page — 72u on the spine, low, with 344
// reference pixels of air above it — one supporting thought at the counter-axis
// diagonally below, and the three symptoms staged under the frame. §7 asks for
// large but not monument-scale, a strong authored break, large negative space,
// one supporting thought at most and no technical diagram around it, and that
// is the list.
function PassageCloudEntry() {
  return (
    <PassagePanel
      id="cloud-entry"
      label={m('cloudEntry.eyebrow')}
      altitude={m('cloudEntry.altitude')}
      /* THE THREE SYMPTOMS, AS ONE STRUCTURAL LAYER AND NOT THREE.
         
         `messages.ts` records what they are: three parallel observations of one
         failure, printed as one paragraph in the copy they came from. Three
         separate staged items would say they are three subjects; one quiet list
         says what they are. No hairlines, no mono face, no tracking, no
         `notes--technical` — the old annotation layer is not reachable from a
         passage at all. */
      body={
        <div className="passage__item">
          <ul className="passage__terms">
            <li>{m('cloudEntry.note.a')}</li>
            <li>{m('cloudEntry.note.b')}</li>
            <li>{m('cloudEntry.note.c')}</li>
          </ul>
        </div>
      }
    >
      <Statement lines={[m('initialAscent.title.a'), m('initialAscent.title.em')]} />
      <p className="passage__support">{m('cloudEntry.body.b')}</p>
    </PassagePanel>
  );
}

// --- PASSAGE · breakthrough · 8 500–11 000 m ---------------------------------
//
// `…ugyanabba az irányba mozdul.` — §8, and the quietest state on the homepage.
//
// It has to be the quietest, because it is the last thing before the Proof act
// and Proof is the loudest. What was there instead was the worst instance of
// the defect this phase exists for: fifty-seven characters of prose set at 69px
// across five lines, filling the frame — body copy enlarged until it looked
// like a heading, which is the opposite of a monument.
//
// §8 asks for the strongest phrase from the EXISTING approved copy hierarchy to
// control the passage, and the hierarchy is already in the file: the sentence
// is authored in two halves. The condition is set small and right-aligned, the
// consequence is set at 58u under it on the same margin line, and one
// supporting line sits diagonally opposite at the foot of the spine. Three
// objects, no body, and the longest genuine silence on the page after it.
//
// The sentence is unchanged, complete, and still reads top to bottom in its
// own order — as one `<h2>` with a paragraph above it in the document, so a
// screen reader meets the condition and then the consequence, which is the
// order the eye takes.
function PassageBreakthrough() {
  return (
    <PassagePanel
      id="cloud-breakthrough"
      label={m('cloudBreakthrough.eyebrow')}
      altitude={m('cloudBreakthrough.altitude')}
    >
      <p className="passage__overline">{m('cloudBreakthrough.title.a')}</p>
      <Statement lines={[m('cloudBreakthrough.title.em')]} />
      <p className="passage__support">{m('cloudBreakthrough.lead')}</p>
    </PassagePanel>
  );
}

// --- PASSAGE · the nine areas · 17 000–22 000 m ------------------------------
//
// `Kilenc terület, / három rétegben.` — §9, recomposed twice: once by the
// six-act pass, which took twenty-one objects down to three staged blocks, and
// again by phase 5.1, which took the three blocks down to one.
//
// WHY IT WAS STILL THE LONGEST CHAPTER ON THE PAGE. Three `.passage__item`s at
// 58svh, each a name, a note and two to four `name — sentence` lines, is 3.50
// screens — 14% of the whole journey, and half a screen longer than the Proof
// act. Human review read the middle as a slide deck, and the filmstrip agrees:
// the chapter resolves three times as headline, small paragraph, list, dark
// field, with nothing else changing in the frame between them.
//
// AND THE STAGING WAS NOT EVEN BUYING WHAT IT CLAIMED. 58svh on a 900px
// viewport is 522px, so two items fit in one frame: the measured filmstrip
// shows `Mag` and `Szerkezet` together at 13.9 screens, one against each edge,
// with the dead middle between them that `styles.css`'s own note says a box
// rather than a margin was chosen to avoid.
//
// SO THE THREE LAYERS ARE ONE BEAT NOW, and the chapter is 2.33 screens — the
// same architecture, to the number, as the process passage below it and the
// cloud-entry passage above it: a frame, then one composed structural beat.
//
// WHAT LEFT, AND WHERE IT WENT. The nine `name — sentence` pairs became nine
// names. The sentences are on the services route, verbatim, in three locales —
// see `content.ts` for the four of them that were restating Act III's own
// capability ladder eight screens earlier, and `scripts/system-inventory.mjs`
// for the check that every one of the twenty-eight original units is where its
// classification says it is.
//
// WHAT THAT BUYS, WHICH IS THE POINT AND NOT THE SAVING. §9 of the phase brief:
// after the statement the visitor should SEE the six disciplines behaving as
// one system rather than read three explanations about it. Three layers in one
// frame, each with its own line of names, widening 2 → 3 → 4 down the column,
// IS the layering — simultaneity is what makes a relationship visible, and
// staging is what hides one. One frame, three relationships: which disciplines
// exist, which layer each is on, and that each layer depends on the one above.
//
// NO CARDS, NO TILES, NO NUMERALS, NO DIAGRAM. §10. The names are set as one
// running line per layer, separated by middots — the `act__index` idiom Act III
// already uses for exactly this job, which is the page's existing language for
// "these are one system" and takes one line rather than a grid.
function PassageSystem() {
  const rings = [0, 1, 2] as const;

  return (
    <PassagePanel
      id="system"
      label={m('system.eyebrow')}
      altitude={m('system.altitude')}
      body={
        /* ONE BEAT, NOT THREE — the same `.passage__item` decision the process
           passage records below, arriving at the same answer from the other
           direction. Three blocks of three short lines do not have to be met
           one at a time; nine `name — sentence` pairs did, and that is exactly
           why they are not here any more. */
        <section className="passage__item">
          {rings.map((r) => (
            /* `.passage__layer` is `.passage__principle`'s rule, shared rather
               than copied: a name, a line under it, and nothing else. Two
               classes on one declaration is what stops the page growing a
               second treatment for the same object. */
            <div className="passage__layer" key={r}>
              <h3>{m(`system.ring.${r}.name`)}</h3>
              <p>{m(`system.ring.${r}.note`)}</p>
              <p className="passage__areas">
                {SYSTEM.filter((n) => n.ring === r).map((n, i) => (
                  /* THE SPACES INSIDE THE MIDDOT ARE LOAD-BEARING. `.act__index`
                     writes it `<i>·</i>` and spaces it with padding, which is
                     right there because that line is `white-space: nowrap` in a
                     frame wide enough for it. Here the line is in a 680u column
                     that has to wrap, and padding is not a break opportunity:
                     without a real space the operation layer's four names are
                     one unbreakable word. Measured overflowing its box by 67px
                     on a 390 and 82px on the German 360 before this. */
                  <span key={n.id}>
                    {i > 0 && <i> · </i>}
                    {n.name}
                  </span>
                ))}
              </p>
            </div>
          ))}
        </section>
      }
    >
      <Statement lines={[m('system.title.a'), m('system.title.em')]} />
      {/* The second sentence of `system.lead`, not the whole of it. The first
          was a caption on the ring diagram in the scene behind this chapter,
          and the diagram is gone — see `messages.ts` and `JourneyScene.tsx`.
          What is left is the sentence that carries the argument. */}
      <p className="passage__support">{m('system.lead.b')}</p>
    </PassagePanel>
  );
}

// --- PASSAGE · the process · 22 000–25 500 m ---------------------------------
//
// `Hét ellenőrzőpont, / találgatás nélkül.` — §11, and unchanged.
//
// THE HOMEPAGE IS NOT THE MANUAL. Phase 4's whole argument, and the reason this
// function is a fifth of the size it was.
//
// What it carried: seven checkpoints, each a name and four `term — sentence`
// lines, staged one beat per checkpoint down the passage's own scroll. Nothing
// was wrong with it as a composition — it holds ten objects in a frame against
// the forty-nine of the dashboard it replaced — and it was still the wrong
// thing to be doing. Thirty-five sentences at the editorial size is 5.6 screens
// however they are arranged, which made the process a longer chapter than any
// of the six master acts, and the master acts are the destinations.
//
// So the problem was the DEPTH rather than the length, and it is solved by
// content architecture rather than by shrinking anything: the twenty-eight term
// sentences went to `05 · A folyamat` on the services route, whole and
// unedited, and what stands here is
//
//   the statement, unchanged;
//   the seven names in one line of running text, so `Hét` is still true;
//   three principles derived from the same sentences — see `messages.ts` for
//   which sentence each one comes from and why these three;
//   one route to the rest.
//
// ONE BEAT, NOT THREE — §18. `.passage__item` is 58svh because seven items each
// carrying five lines had to be met one at a time; three items each carrying two
// lines do not, and staging them would spend 1.7 screens saying what fits in
// half of one. §18 says in as many words that the elements may coexist in a
// restrained editorial composition, so they are one item and the item is one
// beat. Nothing about the idiom changed: same `<h3>`, same paragraph, same ink,
// same column, no card, no numeral, no rule, no stepper.
function PassageProcess() {
  const principles = [1, 2, 3] as const;

  return (
    <PassagePanel
      id="process"
      label={m('process.eyebrow')}
      altitude={m('process.altitude')}
      body={
        <section className="passage__item">
          {principles.map((n) => (
            <div className="passage__principle" key={n}>
              <h3>{m(`process.principle.${n}.name`)}</h3>
              <p>{m(`process.principle.${n}.line`)}</p>
            </div>
          ))}
          {/* THE ONE ROUTE DEEPER — §3D, §20, §21. The Proof act's `act__routes`
              link treatment, at the foot of the same beat rather than in a beat
              of its own: a screen holding a single link is the tall empty
              spacer two suites already forbid. Not yellow; the homepage's
              yellow moments are closed and the process was never one of them. */}
          <p className="passage__route">
            <a href={`${pageHref('services')}#folyamat`} data-testid="cta-process-detail">
              {m('process.cta.detail')}
            </a>
          </p>
        </section>
      }
    >
      <Statement lines={[m('process.title.a'), m('process.title.em')]} />
      {/* The seven, named, as the passage's one supporting thought — composed
          from `PROCESS` rather than re-keyed, so the line and the table cannot
          disagree about what the seven are. */}
      <p className="passage__support">
        {PROCESS.map((p) => p.name).join(m('process.stages.separator'))}
        {m('process.stages.end')}
      </p>
    </PassagePanel>
  );
}

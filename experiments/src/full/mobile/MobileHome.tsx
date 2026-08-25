import { useEffect, type CSSProperties, type ReactNode } from 'react';
import { m, pageHref } from '../i18n';
import { actOf, isPeak, levelOf, type ActId } from '../acts';
import { CAPABILITIES, COLLABORATIONS, FEATURED_CASE_ID, PROCESS, PROOF_IMAGE, SYSTEM, WORK } from '../content';
import { STAGES, formatAltitude, type StageId } from '../journey';
import { SCENE } from '../scene';
import { ALTITUDE_BANDS, measureAscent } from './ascent';
import { startReveals } from './reveal';
import { startAtmosphere } from './atmosphere';
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
  const scene = SCENE[id as StageId];
  return (
    <section
      // A real anchor target, not only a test hook: the closing panel links back
      // to every stage and those links must work with no JavaScript at all.
      id={`stage-${id}`}
      className={`mv-sec${lead ? ' mv-sec--lead' : ''}${className ? ` ${className}` : ''}`}
      data-stage={id}
      data-alt-from={from}
      data-alt-to={to}
      // The chapter's art direction, from the same table the desktop
      // composition reads — see `scene.ts`. Two of the four decisions are
      // meaningful here: the tier, which is the whole of §23's "the headline is
      // the hero", and the sky condition. The frame and the instrument role are
      // desktop geometry and are not published.
      //
      // §22 asks for mobile not to be a miniature desktop, and this does not
      // make it one: what crosses over is the ART DIRECTION — which chapter is a
      // monument and which is a trough — while every number that expresses it is
      // authored separately in `mobile.css`. A page whose two surfaces disagreed
      // about which chapters matter would be two designs, not one design on two
      // devices.
      data-monument={scene.tier}
      data-sky={scene.sky}
      // The act this section belongs to, and whether it is that act's frame.
      // Published for the same reason the desktop panel publishes it: the
      // stylesheet composes against the art direction rather than against a
      // list of stage ids, and the two surfaces read the same table.
      data-act={actOf(id as StageId)}
      data-act-role={isPeak(id as StageId) ? 'peak' : 'crossing'}
      /* THE TWO VISUAL LEVELS, ON THIS SURFACE TOO — §2, §27.
         
         The same attribute the desktop panel carries, from the same function,
         because §27 asks mobile to use the same hierarchy and a page whose two
         surfaces disagreed about which chapters are destinations and which are
         movement would be two designs rather than one design on two devices.
         The stylesheet composes against it: what a passage may not have — an
         eyebrow, a rail, an index numeral, an altitude stamp, a description
         grid — is authored once, against `[data-level='passage']`, rather than
         four times against four stage ids. */
      data-level={levelOf(id as StageId)}
      style={{ '--mv-monument': scene.mobileScale } as CSSProperties}
      data-testid={`stage-${id}`}
    >
      {children}
    </section>
  );
}

/* `Head` AND `Label` ARE GONE — §6, §27, §34.
 *
 * `Label` was the eyebrow: a roman numeral, the chapter's name and its altitude
 * range in the data face, tracked out, with the range in the signal colour.
 * `Head` was that eyebrow wrapped with the statement so the two crossed the
 * reveal line together.
 *
 * The six master acts stopped using them in the previous pass. The four
 * crossings were their last call sites, and §6 puts chapter markers, altitude
 * decoration and yellow indices on the list of things to remove rather than
 * quieten. `PassageHead` below is what replaces them: the same `.mv-head` box,
 * so the reveal observes the element it always has, with the marker announced
 * instead of painted.
 *
 * §35's audit: `Head` carried no state, no observer registration and no
 * accessibility affordance that is not still there. The eyebrow's text is the
 * `sr-only` line in `PassageHead`, first in the chapter's reading order.
 */

/**
 * A PASSAGE'S HEAD — §27, and the mobile half of §6.
 *
 * `Head` above is what a chapter had until this pass: an eyebrow carrying a
 * roman numeral and an altitude range, and the statement under it. On the six
 * master acts the eyebrow was already gone; on the four crossings it was the
 * single most recognisable piece of the old website, and it was in all four.
 *
 * So a passage gets the statement and nothing above it, and the marker is
 * announced instead of painted — first in the chapter's reading order, still
 * what a screen reader meets on entering the section, and still what keeps the
 * accessibility walk finding eleven chapters rather than seven. §19: the
 * altitude may stay semantically active while becoming visually quieter. §31:
 * nothing essential is hidden, because nothing is hidden — it is not drawn.
 *
 * It is still one `.mv-head` box, so the reveal line observes the same element
 * it always has and the accepted portrait motion is untouched.
 */
function PassageHead({ at, label, lines }: { at: string; label: string; lines: ReactNode[] }) {
  return (
    <div className="mv-head">
      <p className="sr-only">
        {label} · {at}
      </p>
      <Lines lines={lines} />
    </div>
  );
}

/**
 * A PASSAGE'S STRUCTURAL LAYER — §11, §12, §39, and the portrait half of them.
 *
 * One item, one beat. The `term — sentence` line is the page's only structural
 * idiom now and it is the same one the desktop passage body uses: the term in
 * the ink of the running text, an em dash, the sentence after it, in one
 * column. No spine rule, no station dot, no index numeral, no altitude stamp,
 * no description grid and no bordered list item — every one of which was here,
 * and every one of which is on §6's list.
 *
 * §28 holds: this is markup and CSS. No observer was added, no measurement, no
 * sticky container and nothing new on a scroll frame.
 */
function PassageItem({ name, note, areas, ...rest }: {
  name: string;
  /** The item's own line, where it has one. The three layers have one; so does
      each of the three process principles, where it IS the item. */
  note?: string;
  /**
   * The layer's disciplines, as one middot-separated line.
   *
   * IT USED TO BE `terms` — a `term — sentence` list, nine of them across the
   * three layers. Phase 5.1 sent those nine sentences to the services route
   * and kept the names, for the reasons `content.ts` records; a line of names
   * is what is left, and it is the same object the desktop body carries.
   */
  areas?: string[];
  'data-testid'?: string;
}) {
  return (
    <section className="mv-passage__item" {...rest}>
      <h3 className="mv-passage__name mv-text">{name}</h3>
      {note ? <p className="mv-passage__note mv-copy">{note}</p> : null}
      {areas ? (
        <p className="mv-passage__areas mv-text">
          {areas.map((a, i) => (
            /* A real space either side of the middot, not padding: padding is
               not a break opportunity, and without one the operation layer's
               four names are a single unbreakable word 67px wider than the
               column on a 390 and 82px wider on the German 360. */
            <span key={a}>
              {i > 0 && <i> · </i>}
              {a}
            </span>
          ))}
        </p>
      ) : null}
    </section>
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

/* `Notes` IS GONE — LAYER C, ON THIS SURFACE TOO. §2, §6, §34.
 *
 * Each item on its own hairline, in the data face, in the narrowest measure on
 * the page, with an uppercase tracked-out `technical` tone for instrument
 * captions. The crossings that used it are passages now, and its three
 * remaining call sites were all inside act bodies.
 *
 * §2 gives the page two visual levels and no third, and an annotation layer
 * with its own face, case, tracking and rules is a third. Every sentence it
 * carried is in `.mv-terms`, in the same order, in the editorial voice — which
 * is the same object the desktop act bodies now use, so the two surfaces have
 * one structural idiom between them rather than three each.
 *
 * §35's audit: no state, no observer, no live region. `data-notes` was read by
 * nothing. The reveal class is still on every item.
 */

/**
 * An act's statement, on its authored lines.
 *
 * The same string, the same breaks and the same act ids the desktop
 * composition uses — `act.<id>.monument` in `locales/messages.ts`. §33 of the
 * production brief asks for one art direction across both surfaces, and a
 * statement that is broken one way on a laptop and another way on a phone is
 * two art directions with the same words in them.
 *
 * What is NOT shared is the size. `mobile.css` solves the monuments against a
 * phone's own field, which is §20's rule stated for the second surface:
 * equivalent authority, different geometry.
 */
const actLines = (act: ActId): string[] => m(`act.${act}.monument` as Parameters<typeof m>[0]).split('|');

/** Body copy. Much subtler than a headline — §6's CopyReveal. */
function Copy({ children, className = '', stagger }: { children: ReactNode; className?: string; stagger?: number }) {
  return (
    <p className={`mv-copy ${className}`.trim()} data-stagger={stagger}>
      {children}
    </p>
  );
}

export function MobileHome() {
  // The one case this composition features. Same rule and same id as the
  // desktop composition — the two share the content table and nothing else.
  const featured = WORK.find((w) => w.id === FEATURED_CASE_ID);

  useEffect(() => {
    const stopReveals = startReveals(document);
    // The air. One custom property, published off the scroll reader the page
    // already runs — see `atmosphere.ts`.
    const stopAtmosphere = startAtmosphere();

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
      stopAtmosphere();
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
        {/* The two altitude layers. Everything about them is a `calc()` on
            `--mv-alt`: the dense lower air the opening sits in, which falls
            away over the first chapters, and the cold opening above, which
            widens with the climb. See §01 of mobile.css. */}
        <div className="mv-sky__ground" />
        <div className="mv-sky__opening" />
        <div className="mv-sky__grain" />
      </div>

      <div className="mv-flow" id="mv-content">
        {/* ── 1 · 0–150 m — the opening ──────────────────────────────────
            §12: header, a small calibration line, the headline, the
            instrument, then the supporting copy. Nothing overlaps, nothing
            competes, and the first meaningful line is on the first screen. */}
        <Section id="calibration" lead>
          {/* No eyebrow and no altitude range on an act's frame. §35 asks for
              much less microcopy than the desktop had, and the desktop has none
              here either: the six approved frames carry one micro label between
              them and it is in Act V. The telemetry strip still reads the
              altitude continuously, which is where a number that changes with
              the finger belongs. */}
          <Lines as="h1" className="mv-title--hero" lines={actLines('i')} />

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
          {/* The premise, which the desktop frame announces rather than shows.
              The phone has room for it in flow, so it is shown — §43's line is
              about content being available, and where there is room the answer
              is to have it there. */}
          <ul className="mv-terms mv-terms--plain">
            <li className="mv-text">{m('calibration.title.a')}</li>
            <li className="mv-text">{m('calibration.note.a')}</li>
            <li className="mv-text">{m('calibration.note.b')}</li>
          </ul>
          {/* ONE ACTION, in the action's language rather than as a filled
              button, and one quiet route beside it — the same pair the desktop
              opening carries and the same pair the closing beat carries. §15
              and §33. */}
          <p className="mv-actions mv-text">
            <a className="mv-act" href={pageHref('quote')} data-testid="cta-primary-hero">
              {m('common.cta.ascend')}
            </a>
            <a className="mv-quiet" href="#stage-selected-work">
              {m('common.cta.work')}
            </a>
          </p>
        </Section>

        {/* ── 2 · 150–3 000 m ─────────────────────────────────────────── */}
        <Section id="initial-ascent">
          {/* ACT II. The statement that used to be at 6 000–8 500 m — the
              altitude chronology fix, and the same exchange the desktop makes.
              See `acts.ts`. */}
          <Lines lines={actLines('ii')} />
          <Copy className="mv-copy--lead">{m('cloudEntry.note.d')}</Copy>
          <Copy>{m('initialAscent.body.b')}</Copy>
          <ul className="mv-terms mv-terms--plain">
            <li className="mv-text">{m('initialAscent.note.a')}</li>
            <li className="mv-text">{m('initialAscent.note.b')}</li>
            <li className="mv-text">{m('initialAscent.note.c')}</li>
            <li className="mv-text">{m('initialAscent.note.d')}</li>
          </ul>
          {/* The instrument's caption. It was the `technical` tone — uppercase,
              tracked out, in the data face — which is §6's "HUD-like
              annotation" and the last of Layer C on this surface. */}
          <p className="mv-passage__note mv-copy">{m('initialAscent.meta')}</p>
        </Section>

        {/* ── 3 · 3 000–6 000 m — the capability ladder ─────────────────
            One vertical Meridian rule with the capabilities along it, which
            is the same device the Nine Areas use further down. Two sections
            sharing one graphic language rather than each inventing one. */}
        <Section id="lower-atmosphere">
          <Lines lines={actLines('iii')} />
          <Copy className="mv-copy--lead">{m('lowerAtmosphere.lead.b')}</Copy>
          <Copy>{m('lowerAtmosphere.lead.a')}</Copy>

          {/* THE CAPABILITY LADDER, IN THE PASSAGE'S STRUCTURAL VOICE — §39.
              
              It was a vertical Meridian rule with a yellow top stop, a yellow
              station dot per rung, an altitude in the data face in the signal
              colour, and the name and line beside it. The desktop ladder was
              the same object as a table; §48's thumbnail sheet found both, and
              they were the last two states on the homepage still built the old
              way. Same six names, same six lines, same order, and the altitude
              stamp is gone with the seven checkpoints' — §6's altitude
              decoration. */}
          {CAPABILITIES.map((c) => (
            <PassageItem key={c.name} name={c.name} note={c.line} />
          ))}
        </Section>

        {/* ── 4 · 6 000–8 500 m ───────────────────────────────────────── */}
        {/* PASSAGE. §7. The eyebrow is announced rather than painted — a
            crossing used to be the one place a quiet altitude label "earned its
            place", and §6 withdraws that: the marker, the roman numeral and the
            range are the old website's, and the six acts have never had one.
            The three symptoms lose the data face and the hairlines with it. */}
        <Section id="cloud-entry">
          <PassageHead
            at={m('cloudEntry.altitude')}
            label={m('cloudEntry.eyebrow')}
            lines={[m('initialAscent.title.a'), m('initialAscent.title.em')]}
          />
          <Copy className="mv-copy--lead">{m('cloudEntry.body.b')}</Copy>
          {/* One list, not three staged items: `messages.ts` records that these
              are three parallel observations of one failure, printed as one
              paragraph in the copy they came from. */}
          <ul className="mv-terms mv-terms--plain">
            <li className="mv-text">{m('cloudEntry.note.a')}</li>
            <li className="mv-text">{m('cloudEntry.note.b')}</li>
            <li className="mv-text">{m('cloudEntry.note.c')}</li>
          </ul>
        </Section>

        {/* ── 5 · 8 500–11 000 m — a statement beat ────────────────────
            Centred, short, and the one place on the page with real air around
            it. §19's "major chapter" spacing exists for this. */}
        <Section id="cloud-breakthrough">
          {/* §8, in portrait. The sentence is set in its two authored halves
              exactly as the desktop passage sets it — the condition quietly
              above, the consequence as the statement — so the two surfaces make
              the same editorial decision rather than the phone reverting to a
              five-line wall of display type. Both halves are present, in order,
              and the `<h2>` is the consequence. */}
          <p className="mv-passage__overline mv-copy">{m('cloudBreakthrough.title.a')}</p>
          <PassageHead
            at={m('cloudBreakthrough.altitude')}
            label={m('cloudBreakthrough.eyebrow')}
            lines={[m('cloudBreakthrough.title.em')]}
          />
          <Copy className="mv-copy--lead">{m('cloudBreakthrough.lead')}</Copy>
        </Section>

        {/* ── 6 · 11 000–17 000 m — “those who climbed with us” ─────────
            Marks, then one case. The portrait counterpart of the desktop
            composition's stage 6, and the same reasoning: this used to be three
            full cards — image, description list, metric, testimonial, mark —
            stacked down a phone, which is `/work` reprinted inside a brand
            narrative. Six plated marks and one sourced case say the same thing
            in a fraction of the scroll. */}
        <Section id="selected-work">
          {/* ACT IV. THE FIGURE IS THE STATEMENT, exactly as it is on the
              desktop, and for the same reason: the act's dominant thought is a
              number and a headline over it would be a second voice. The
              reading order on a phone is the one §N of the master study calls
              correct for this act — figure, definition, evidence — with the
              marks moved BELOW the figure rather than above it, which is the
              one ordering change the portrait translation makes. */}
          <Lines className="mv-title--figure" lines={[featured?.metric?.value ?? '']} />
          <p className="mv-feature__define mv-copy">
            <span>{featured?.name}</span>
            <span>{featured?.metric?.label}</span>
          </p>

          <section className="mv-collab" data-testid="collaborations">
            <ul className="mv-collab__set">
              {COLLABORATIONS.map((c) => (
                <li className="mv-collab__item" key={c.src}>
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
          </section>

          {featured && (
            <article
              className="mv-feature"
              data-testid={`case-${featured.id}`}
              data-featured="true"
            >
              <figure
                className="mv-feature__figure"
                style={{ aspectRatio: `${PROOF_IMAGE.width} / ${PROOF_IMAGE.height}` }}
              >
                {/* The same window on the same real capture the desktop uses,
                    and for the same reason: the whole screenshot carries the
                    Rapidkert site's own headline, and this one carries the
                    thing the project is. See `scripts/rapidkert-section.mjs`. */}
                <img
                  src={PROOF_IMAGE.src}
                  alt={featured.image?.alt ?? featured.name}
                  loading="lazy"
                  decoding="async"
                  width={PROOF_IMAGE.width}
                  height={PROOF_IMAGE.height}
                />
              </figure>

              <h3 className="mv-feature__name">
                {m('selectedWork.title.a')} {m('selectedWork.title.em')}
              </h3>
              <p className="mv-feature__sector">
                {featured.sector} · {formatAltitude(featured.altitude)} m
              </p>
              <p className="mv-feature__result">{featured.result}</p>
              <p className="mv-copy">{m('selectedWork.lead')}</p>

              <div className="mv-feature__cta">
                <a href={pageHref('caseRapidkert')} data-testid="cta-featured-case">
                  {m('featured.cta.case')}
                </a>
                <a href={pageHref('work')} data-testid="cta-work">
                  {m('featured.cta.work')}
                </a>
              </div>
            </article>
          )}
        </Section>

        {/* ── 7 · 17 000–22 000 m — “nine areas in three layers” ────────
            §14: label, headline, then the three layers down one Meridian
            line. No sticky container, no cards in flight, and no blank
            introduction before the first layer. */}
        <Section id="system">
          <PassageHead
            at={m('system.altitude')}
            label={m('system.eyebrow')}
            /* NO WORD-LEVEL EMPHASIS. The second half used to be an `<em>` in a
               second colour — §16 rules that out everywhere on the page, and
               the desktop statements lost it in the previous pass. */
            lines={[m('system.title.a'), m('system.title.em')]}
          />
          {/* The second sentence of `system.lead` only. The first described the
              concentric ring diagram in the scene behind this chapter, and the
              diagram is gone — see `messages.ts`. */}
          <Copy className="mv-copy--lead">{m('system.lead.b')}</Copy>

          {/* THREE LAYERS, AND ON THIS SURFACE THEY ARE STILL THREE BLOCKS —
              but each is three short lines now rather than a name, a note and
              up to four `name — sentence` items.

              The phone gets the same phase 5.1 edit the desktop gets, and it
              needed it for the same reason: at 390 × 844 the system chapter was
              1.64 screens, the longest passage in the portrait journey, and
              nine sentences down a 390px column is the wall the desktop was
              staging around. The nine sentences are on the services route; the
              nine names are here, one line per layer, in order, at full
              contrast. No spine rule, no station dots, no index numerals —
              §6 and §11. */}
          {([0, 1, 2] as const).map((ring) => (
            <PassageItem
              key={ring}
              name={m(`system.ring.${ring}.name`)}
              note={m(`system.ring.${ring}.note`)}
              areas={SYSTEM.filter((n) => n.ring === ring).map((n) => n.name)}
            />
          ))}
        </Section>

        {/* ── 8 · 22 000–25 500 m — the process, compressed ─────────────

            THE PHONE GETS THE SAME EDIT THE DESKTOP GETS, and it needed it
            more: at 390 × 844 the seven checkpoints were 3.4 screens and 26% of
            the whole portrait journey — over a quarter of the homepage spent on
            one chapter of documentation.

            §17: the three principles stack naturally, there is no accordion
            hiding anything, and the whole sequence is a passage rather than a
            chapter of a manual. The twenty-eight term sentences are on the
            services route, one tap away, in ordinary crawlable HTML — see
            `content.ts` for the audit that says so. */}
        <Section id="process">
          <PassageHead
            at={m('process.altitude')}
            label={m('process.eyebrow')}
            lines={[m('process.title.a'), m('process.title.em')]}
          />
          {/* The seven, named, so `Hét ellenőrzőpont` is still a true sentence
              about this page. Composed from `PROCESS` on both surfaces, so the
              line cannot drift from the table. */}
          <Copy className="mv-copy--lead">
            {PROCESS.map((p) => p.name).join(m('process.stages.separator'))}
            {m('process.stages.end')}
          </Copy>

          {/* THREE PRINCIPLES — the label is the item's name and the sentence is
              its note, which is the `PassageItem` shape the nine areas above
              already use with no terms under it. No numerals, no dots, no rule
              down the left: all three were here, all three are on §6's list,
              and none of them came back with the compression. */}
          {([1, 2, 3] as const).map((n) => (
            <PassageItem
              key={n}
              name={m(`process.principle.${n}.name`)}
              note={m(`process.principle.${n}.line`)}
              data-testid={`process-principle-${n}`}
            />
          ))}

          {/* The one route deeper, in the surface's own quiet-link idiom — the
              same `.mv-quiet` the closing panel uses for its route back to the
              work. Not yellow: the phone's budget is the desktop's, two events,
              and neither of them is here. */}
          <p className="mv-text mv-passage__route">
            <a
              className="mv-quiet"
              href={`${pageHref('services')}#folyamat`}
              data-testid="cta-process-detail"
            >
              {m('process.cta.detail')}
            </a>
          </p>
        </Section>

        {/* ── 9 · 25 500–28 000 m ─────────────────────────────────────── */}
        <Section id="stratosphere-transition">
          {/* ACT V carries the one micro altitude in the design, and it is a
              reading rather than the stage's range — the same string the
              desktop frame uses. */}
          <p className="mv-eyebrow mv-label">{m('act.v.altitude')}</p>
          <Lines lines={actLines('v')} />
          <Copy className="mv-copy--lead">{m('stratosphereTransition.note.a')}</Copy>
          <Copy>{m('stratosphereTransition.note.b')}</Copy>
          <Copy>{m('stratosphereTransition.body.b')}</Copy>
        </Section>

        {/* ── 10 · 28 000–30 000 m ────────────────────────────────────── */}
        <Section id="full-stratosphere" className="mv-sec--centre">
          {/* ACT VI. Two objects and the sky, on the phone as on the desktop:
              the statement, and the instrument returning under it. Centred
              survives a phone better than any other composition in the design,
              which is §N of the master study's own finding. */}
          <Lines className="mv-title--statement" lines={actLines('vi')} />
          {/* THE AIR THE RETURNING INSTRUMENT SITS IN — a spacer, not a second
              `AltimeterReserve`.
              
              The reserve is the HERO's anchor: it publishes `heroAnchor` on the
              measurement bus so the opening instrument can be positioned from
              the band the opening composition keeps for it. A second one would
              be a second writer of that anchor, and the last one measured wins
              — which would put the hero's instrument at the arrival's reserve.
              The arrival's instrument is placed from `PLACEMENTS.arrival`, a
              viewport fraction, and needs nothing published; what it needs is
              room in the column so the copy is not underneath it. */}
          <div className="mv-arrival-air" aria-hidden="true" />
          <Copy className="mv-copy--lead">{m('fullStratosphere.lead')}</Copy>

        </Section>

        {/* ── 11 · 30 000 m — the destination ──────────────────────────
            The closing action is in ordinary flow above the site's own
            Arrival and footer. There is no sticky container to release and
            no handover to time, because there was never one to begin with. */}
        <Section id="destination" className="mv-sec--centre">
          <Lines className="mv-title--statement" lines={actLines('action')} />

          {/* ONE ACTION, and it is a line of type with a rule under it. §15
              forbids the large yellow panel on the desktop and the phone is not
              an exception to it — the CTA is important here because nothing
              competes with it. It keeps a 44px tap target through its padding
              rather than through a fill, so the touch ergonomics the button had
              are unchanged. */}
          <p className="mv-actions mv-text">
            {/* THE PAGE'S SECOND AND LAST YELLOW — §22, and the same modifier
                the desktop's closing action carries. The opening invitation, in
                the same words at the same size, is in the editorial ink: the
                yellow map in `acts.ts` gives Act I `none` and the action beat
                `action`, and this is that table on the phone. */}
            <a className="mv-act mv-act--signal" href={pageHref('quote')} data-testid="cta-primary">
              {m('common.cta.ascend')}
            </a>
          </p>
          {/* The route back to the work is in the reading order and not in the
              picture, exactly as it is on the desktop. */}
          <p className="mv-text">
            <a className="mv-quiet" href="#stage-selected-work" data-testid="cta-secondary">
              {m('destination.cta.work')}
            </a>
          </p>

          {/* THE CLOSING MATTER STAYS HERE ON THE PHONE, and the difference from
              the desktop is structural rather than a lapse.
              
              On the desktop the action beat's frame is PINNED to the foot of
              the track, so whatever is last in the document is what is on
              screen at the bottom of the page — which is why the lead, the
              alternative and the index moved up into the arrival there. The
              portrait composition has no pinned frame and no track: the site's
              own Arrival panel and footer follow this section, so nothing here
              is the last thing anyone sees.
              
              What it does have is a FIXED instrument holding the middle of the
              frame through the arrival, and four blocks of copy in that section
              pass under it. Moving them here keeps the arrival two objects — a
              statement and the returning instrument — which is what §31 asks
              for and what the desktop frame shows. */}
          <Copy className="mv-copy--lead">{m('destination.lead')}</Copy>
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

// =============================================================================
// The journey's words, as static HTML in the shell. Build time only.
//
// `vite.home.config.ts` calls `staticJourney(lang)` once per locale and writes
// the result into the mount host, after the opening frame. Nothing in the
// browser bundle imports this file.
//
// WHY IT EXISTS
// -------------
// `main.tsx` mounts the journey on the visitor's first move, which is what keeps
// React and three.js off the load (TBT 1 470 ms -> under 100). A crawler never
// moves. Measured with Googlebot's smartphone agent and no input, the Hungarian
// homepage rendered 881 words and no "Hat terület" section, no client marks,
// and no link to the Rapidkert case study — the only link to it on the
// homepage. Everything the journey says was, to a search engine, not on the
// page.
//
// So the words are in the document from the first byte: every heading, every
// paragraph, the six marks as images with their names as alt text, the featured
// case with its links, the checkpoints and the stage index. Visible, in the same
// order the journey tells them, set plainly — the same move the opening frame
// already makes for the first screen, carried down the page.
//
// WHAT IT IS NOT
// --------------
// Not a rendered copy of either composition. There are two, chosen at runtime
// from the device (see `mobile/device.ts`), so a prerender of one would be the
// wrong one for half the visitors; and both depend on measurement and a WebGL
// stage that a static document has no business imitating. This is the third
// rendering of the same tables — the plain one — and `createRoot`'s first
// commit replaces it with whichever composition the device gets, exactly as it
// already replaced the opening frame.
//
// Not hidden. Nothing here is `display: none`, clipped or visually hidden; a
// visitor without JavaScript reads exactly this, and anyone who scrolls before
// the journey has arrived sees it. Crawler and visitor get the same document.
//
// WHERE THE WORDS COME FROM
// -------------------------
// The same `MESSAGES` entries and the same `content.ts` tables both
// compositions render, localised here per locale rather than once at module
// load: `content.ts` localises for the document it runs in, and at build time
// there is no document, so the tables are re-walked under each locale with the
// same `localise` the browser uses. No string in this file is copy.
//
// The text follows the desktop composition, which is the fuller of the two —
// it is the one that carries "what you provide" on each checkpoint and the
// featured case's line about the work. It leaves out the one sentence that
// points at a screen position (`calibration.meta`, "the instrument on the
// left"), because there is no instrument here for it to point at.
// =============================================================================

import { MESSAGES, type MessageKey } from './locales/messages';
import { INTL_TAG, getLocale, localise, pageHref, setLocale, type Locale } from './i18n';
import { FEATURED_CASE_ID, SOURCE_TABLES } from './content';
import { STAGES } from './journey';
import { STATIC_ID } from './readerPlace';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The content tables as `lang` reads them. */
function tablesFor(lang: Locale) {
  const was = getLocale();
  setLocale(lang);
  try {
    return {
      work: localise(SOURCE_TABLES.WORK_HU),
      marks: localise(SOURCE_TABLES.COLLABORATIONS_HU),
      system: localise(SOURCE_TABLES.SYSTEM_HU),
      process: localise(SOURCE_TABLES.PROCESS_HU),
      capabilities: localise(SOURCE_TABLES.CAPABILITIES_HU),
    };
  } finally {
    setLocale(was);
  }
}

export function staticJourney(lang: Locale): string {
  const t = (key: MessageKey) => esc(MESSAGES[key][lang]);
  const fmt = new Intl.NumberFormat(INTL_TAG[lang], { maximumFractionDigits: 0 });
  const metres = (n: number) => `${fmt.format(Math.round(n))} m`;
  const href = (id: Parameters<typeof pageHref>[0]) => esc(pageHref(id, lang));
  const { work, marks, system, process, capabilities } = tablesFor(lang);

  /** One stage: its eyebrow and altitude, its headline, then whatever it carries. */
  const stage = (id: string, prefix: string, body: string[]) =>
    [
      `<section class="jtext__stage" id="${STATIC_ID}${id}">`,
      `<p class="jtext__eyebrow">${t(`${prefix}.eyebrow` as MessageKey)} <span>${t(`${prefix}.altitude` as MessageKey)}</span></p>`,
      `<h2 class="jtext__h">${t(`${prefix}.title.a` as MessageKey)} <em>${t(`${prefix}.title.em` as MessageKey)}</em></h2>`,
      ...body,
      '</section>',
    ].join('\n');

  const featured = work.find((w) => w.id === FEATURED_CASE_ID);

  const sections = [
    stage('initial-ascent', 'initialAscent', [
      `<p>${t('initialAscent.body.a')}</p>`,
      `<p>${t('initialAscent.body.b')}</p>`,
      `<p class="jtext__meta">${t('initialAscent.meta')}</p>`,
    ]),

    stage('lower-atmosphere', 'lowerAtmosphere', [
      `<p class="jtext__lead">${t('lowerAtmosphere.lead')}</p>`,
      '<ol class="jtext__steps">',
      ...capabilities.map(
        (c) =>
          `<li><span class="jtext__at">${metres(c.at)}</span><h3>${esc(c.name)}</h3><p>${esc(c.line)}</p></li>`,
      ),
      '</ol>',
    ]),

    stage('cloud-entry', 'cloudEntry', [
      `<p>${t('cloudEntry.body.a')}</p>`,
      `<p>${t('cloudEntry.body.b')}</p>`,
    ]),

    stage('cloud-breakthrough', 'cloudBreakthrough', [
      `<p class="jtext__lead">${t('cloudBreakthrough.lead')}</p>`,
    ]),

    stage('selected-work', 'selectedWork', [
      `<p class="jtext__lead">${t('selectedWork.lead')}</p>`,
      '<div class="jtext__collab">',
      `<h3 class="jtext__label">${t('collaborations.title')}</h3>`,
      `<p>${t('collaborations.note')}</p>`,
      // Informative marks, so each carries the organisation's name — the same
      // rule both compositions follow.
      '<ul class="jtext__marks">',
      ...marks.map(
        (c) =>
          `<li><img src="${esc(c.src)}" alt="${esc(c.name)}" width="${c.width}" height="${c.height}" loading="lazy" decoding="async" /></li>`,
      ),
      '</ul>',
      '</div>',
      ...(featured
        ? [
            '<article class="jtext__case">',
            `<p class="jtext__label">${t('featured.label')}</p>`,
            `<h3>${esc(featured.name)}</h3>`,
            `<p class="jtext__at">${esc(featured.sector)} · ${metres(featured.altitude)}</p>`,
            ...(featured.image
              ? [
                  '<figure>',
                  `<img src="${esc(featured.image.src)}" alt="${esc(featured.image.alt)}" width="${featured.image.frame?.width ?? 1200}" height="${featured.image.frame?.height ?? 1500}" loading="lazy" decoding="async" />`,
                  '</figure>',
                ]
              : []),
            `<p>${esc(featured.result)}</p>`,
            ...(featured.metric
              ? [`<p class="jtext__metric"><strong>${esc(featured.metric.value)}</strong> <span>${esc(featured.metric.label)}</span></p>`]
              : []),
            `<p>${esc(featured.implementation)}</p>`,
            '<p class="jtext__links">',
            `<a href="${href('caseRapidkert')}">${t('featured.cta.case')}</a>`,
            `<a href="${href('work')}">${t('featured.cta.work')}</a>`,
            '</p>',
            '</article>',
          ]
        : []),
    ]),

    stage('system', 'system', [
      `<p class="jtext__lead">${t('system.lead')}</p>`,
      ...([0, 1, 2] as const).flatMap((ring) => [
        '<div class="jtext__ring">',
        `<h3><span class="jtext__at">${ring + 1}</span> ${t(`system.ring.${ring}.name`)}</h3>`,
        `<p>${t(`system.ring.${ring}.note`)}</p>`,
        '<ul>',
        ...system
          .filter((n) => n.ring === ring)
          .map((n) => `<li><b>${esc(n.name)}</b> — ${esc(n.blurb)}</li>`),
        '</ul>',
        '</div>',
      ]),
    ]),

    stage('process', 'process', [
      `<p class="jtext__lead">${t('process.lead')}</p>`,
      '<ol class="jtext__checks">',
      ...process.map((p) =>
        [
          '<li>',
          `<h3><span class="jtext__at">${String(p.index).padStart(2, '0')}</span> ${esc(p.name)} <span class="jtext__at">${metres(p.altitude)}</span></h3>`,
          '<dl>',
          `<dt>${t('checkpoint.term.happens')}</dt><dd>${esc(p.happens)}</dd>`,
          `<dt>${t('checkpoint.term.weProduce')}</dt><dd>${esc(p.weProduce)}</dd>`,
          `<dt>${t('checkpoint.term.youProvide')}</dt><dd>${esc(p.youProvide)}</dd>`,
          `<dt>${t('checkpoint.term.outcome')}</dt><dd>${esc(p.outcome)}</dd>`,
          '</dl>',
          '</li>',
        ].join(''),
      ),
      '</ol>',
    ]),

    stage('stratosphere-transition', 'stratosphereTransition', [
      `<p>${t('stratosphereTransition.body.a')}</p>`,
      `<p>${t('stratosphereTransition.body.b')}</p>`,
    ]),

    stage('full-stratosphere', 'fullStratosphere', [
      `<p class="jtext__lead">${t('fullStratosphere.lead')}</p>`,
    ]),

    stage('destination', 'destination', [
      `<p class="jtext__lead">${t('destination.lead')}</p>`,
      '<p class="jtext__links">',
      `<a href="${href('quote')}">${t('common.cta.ascend')}</a>`,
      `<a href="#${STATIC_ID}selected-work">${t('destination.cta.work')}</a>`,
      '</p>',
      `<p>${t('destination.contact.a')} <a href="${href('contact')}">${t('destination.contact.link.contact')}</a> ${t('destination.contact.b')} <a href="${href('quote')}">${t('destination.contact.link.quote')}</a>${t('destination.contact.c')}</p>`,
      `<ul class="jtext__index" aria-label="${t('destination.stages.label')}">`,
      ...STAGES.filter((s) => s.id !== 'destination').map(
        (s) =>
          `<li><a href="#${STATIC_ID}${s.id}"><span>${t(`stage.${s.id}`)}</span> <i>${metres(s.to)}</i></a></li>`,
      ),
      '</ul>',
    ]),
  ];

  return ['<div class="jtext" data-journey-static>', ...sections, '</div>'].join('\n');
}

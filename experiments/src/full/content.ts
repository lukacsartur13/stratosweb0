/**
 * Every word the full ascent says, in one place.
 *
 * Content is data rather than JSX so that the tests can assert against the same
 * source the page renders from, and so a copy change never means editing a
 * component. The voice follows the live site: Hungarian, second person
 * singular, short sentences, no adjective stacking.
 *
 * ON THE CASE STUDIES — read before editing
 * -----------------------------------------
 * Nothing in `WORK` is invented. Each entry is traceable to something that
 * already exists in this repository:
 *
 *   * the Rapidkert quotation is the testimonial already published on the
 *     homepage (_build/pages/index.html, "A gerinc — 7 200 méter");
 *   * the client logos and screenshots are the ones already shipped in
 *     assets/img/ and already used on index.html and kkv.html;
 *   * the ongoing-role text restates the monthly model described on kkv.html.
 *
 * `metric` is set ONLY where a figure has a named source. Rapidkert now carries
 * one: its Google Ads account for 2025-12-01—2026-04-30 plus the contracted
 * project value confirmed by the client, which is the same pair of sources the
 * case-study route cites section by section. The other two entries stay `null`,
 * and that remains a finding rather than an oversight — no verified numeric
 * outcome exists for either. The layout renders the field when it is present and
 * omits the row entirely when it is null, so filling one in is a one-line change
 * with no design work. See FULL_ASCENT_PROTOTYPE.md.
 *
 * The figure is contracted project value. It is not revenue and it is not
 * profit, and it must not be relabelled as either here or on the case study.
 *
 * The brief also named "Uncensored Society" and "Brickness Community" as likely
 * candidates. Neither appears anywhere in this repository — no copy, no logo, no
 * screenshot — so neither is included. Adding them needs source material, not code.
 */

import { localise, NON_COPY_KEYS } from './i18n';

/*
 * Re-exported so `scripts/meridian-i18n.mjs` applies the same rule.
 *
 * That script bundles *this* module to collect the source strings, and walks
 * the result with its own copy of the traversal. Two walks that have to agree
 * about what counts as copy, with the rule written down twice, is a worklist
 * that drifts from the page; re-exporting the set means the script imports the
 * one definition out of the same bundle it already builds.
 */
export { NON_COPY_KEYS };

export type Stat = { value: string; label: string };

export type CaseStudy = {
  id: string;
  name: string;
  sector: string;
  /** Altitude milestone this project is passed at, in metres. */
  altitude: number;
  challenge: string;
  intervention: string;
  implementation: string;
  /** Qualitative outcome. Only ever a claim this repository can already support. */
  result: string;
  /** A verified, quantified outcome. Null until someone can source one. */
  metric: Stat | null;
  /** What Stratos still does for them. */
  ongoing: string;
  /** Attributed quotation, where one has actually been given. */
  quote?: { text: string; by: string; role: string };
  image?: {
    src: string;
    alt: string;
    /**
     * Intrinsic pixel size, and the opt-out from the 4:5 slot.
     *
     * `styles.css` cuts the case figure at 4:5 and fills it with
     * `object-fit: cover`, which is right for the portrait mockups the slot was
     * made for: they are 0.75-0.83 already, so the crop takes a few pixels off
     * an edge and nothing is lost. Where this is set, the figure adopts the
     * frame's own ratio instead and the crop does not happen.
     *
     * It is set only where the crop would take something the picture is FOR —
     * see Rapidkert, whose frame is a landscape hero the 4:5 window cuts
     * through mid-word. Setting it because a photograph would look nicer wide
     * is how three case studies stop sharing a rhythm.
     */
    frame?: { width: number; height: number };
  };
  logo?: { src: string; alt: string };
};

const WORK_HU: CaseStudy[] = [
  {
    id: 'rapidkert',
    name: 'Rapidkert Kft.',
    sector: 'Kertépítés',
    altitude: 11_800,
    challenge:
      'A kertépítés keresései szezonálisak és erősen helyhez kötöttek. Az érdeklődés megvolt, de nem a megfelelő emberektől: sok megkeresés érkezett olyanoktól, akiknek egészen más kellett volna.',
    intervention:
      'Nem több forgalmat céloztunk meg, hanem pontosabbat. A pozicionálás, az oldal szerkezete és a hirdetések ugyanarra a szűkebb keresési szándékra épültek.',
    implementation:
      'Google Ads és SEO egy rendszerként, majd egy teljesen újragondolt weboldal, amelynek közepén a kert és az alatta lévő talaj interaktív 3D keresztmetszete áll.',
    result:
      'A fizetett és az organikus keresés együtt nagyjából 15 millió Ft értékű szerződött projektet hozott: mintegy 9 millió Ft a Google Adsből, további 6 millió Ft az organikus keresésből.',
    metric: {
      value: '~15M Ft',
      label: 'Szerződött projektérték keresésből',
    },
    ongoing:
      'Az oldal karbantartása és a hirdetések folyamatos kezelése havidíjas konstrukcióban.',
    quote: {
      text: 'Az eredmények gyorsan láthatóak lettek: több megkeresés érkezett, és sokkal célzottabban találtak ránk azok az ügyfelek, akik valóban a szolgáltatásainkat keresték.',
      by: 'Győrffy Márton',
      role: 'CEO, Rapidkert Kft.',
    },
    image: {
      src: '/assets/img/work-rapidkert.jpg',
      alt: 'A Rapidkert interaktív 3D kertépítő weboldala a Stratos Mediától',
      // The one frame in this table that cannot be cropped to 4:5. It is a
      // full-width hero capture, and the 4:5 window keeps 48% of its width:
      // every horizontal position cuts the headline mid-word and takes either
      // the left column or the side of the 3D cross-section with it. The
      // cross-section is the project. Shown whole, at its own ratio, which is
      // also how the case-study route publishes it.
      frame: { width: 1454, height: 869 },
    },
    logo: { src: '/assets/img/client-rapidkert.png', alt: 'Rapidkert Kft.' },
  },
  {
    id: 'barbershop',
    name: 'Barbershop Győr',
    sector: 'Helyi szolgáltatás',
    altitude: 13_200,
    challenge:
      'Egy helyi szolgáltatásnál a döntés a telefon képernyőjén, percek alatt születik meg. Egy lassú vagy nehezen olvasható oldal itt nem kényelmetlenség, hanem elvesztett vendég.',
    intervention:
      'Mobilra tervezett oldal, amelyen az időpontfoglalás és az elérhetőség sosincs egy görgetésnél messzebb.',
    implementation:
      'Egyedi arculatú, gyorsan betöltő weboldal, a helyi keresésre optimalizált tartalommal.',
    result: 'Élő oldal, amely a saját nevére és a helyi keresésekre is megtalálható.',
    metric: null,
    ongoing: 'Havidíjas üzemeltetés: tárhely, frissítések, tartalmi módosítások.',
    image: { src: '/assets/img/work-1.jpg', alt: 'A Barbershop Győr weboldala' },
    logo: { src: '/assets/img/client-barbershop.png', alt: 'Barbershop Győr' },
  },
  {
    id: 'mentaltrening',
    name: 'mentaltrening.com',
    sector: 'Mentális tréning',
    altitude: 14_600,
    challenge:
      'Bizalmi szolgáltatásnál a weboldal nem katalógus, hanem az első beszélgetés. A hangvétel többet dönt, mint a funkciólista.',
    intervention:
      'A tartalmi szerkezetet a kérdésekre építettük, amelyekkel az érdeklődők valóban érkeznek — nem a szolgáltatás belső logikájára.',
    implementation: 'Egyedi weboldal, tiszta tipográfiával és egyetlen, egyértelmű kapcsolatfelvételi úttal.',
    result: 'Élő oldal, amely a szolgáltatás hangját viszi tovább, nem csak a tényeit.',
    metric: null,
    ongoing: 'Folyamatos tartalmi gondozás és technikai karbantartás.',
    image: { src: '/assets/img/work-2.jpg', alt: 'A mentaltrening.com weboldala' },
  },
];

/**
 * The one case study the homepage features, by id.
 *
 * WHY ONE, WHEN THE TABLE HOLDS THREE
 * -----------------------------------
 * The homepage stopped being a portfolio catalogue. It sells the brand, the
 * capability and the journey; the portfolio lives on `/work`, which carries all
 * three projects with their own images and links to each full case page. A
 * homepage that reproduced the same three cards, the same three photographs and
 * the same metrics was printing `/work` twice and reading as a database.
 *
 * Rapidkert is the exception because it is the only project that can carry a
 * feature: `_build/build.py`'s CASE_STATUS marks it `full` and the other two
 * `summary`, and it is the only entry in this table with a sourced metric. A
 * featured case whose proof point is "we also did this one" is not a feature.
 *
 * The other two entries stay in `WORK` rather than being deleted. They are real
 * sourced content, `/work` renders the same projects, and the asset contract in
 * full-ascent.spec.ts checks every image this table names — so the table is the
 * inventory even where the homepage is no longer the surface.
 */
export const FEATURED_CASE_ID = 'rapidkert';

/**
 * The Proof act's plate.
 *
 * A SECOND FRAMING OF THE SAME REAL CAPTURE, not a second image. The homepage
 * capture `work-rapidkert.jpg` is a screenshot of the Rapidkert site, so it
 * carries that site's own display headline across its upper left — a second
 * voice in the one frame whose dominant thought is a figure, and the reason the
 * six-act study needed a mask running to 64% of the plate's width.
 *
 * The asset audit (§8 of the production brief) found no other Rapidkert
 * material in the repository: one hero capture, one client mark, nothing else.
 * It also found that the thing the project actually is — the interactive 3D
 * cross-section of the garden and the ground under it — occupies the right half
 * of that same capture with no typography on it at all.
 *
 * So this is a window on it. `scripts/rapidkert-section.mjs` records the exact
 * rectangle and why it is that rectangle; nothing is painted, retouched,
 * blurred, resampled non-uniformly, downloaded or generated. The case-study
 * route keeps the whole capture, which is where the whole capture belongs.
 *
 * The remaining limitation, stated plainly: this is still a screenshot rather
 * than a commissioned photograph of the work. It is now a screenshot of the
 * part that is the work.
 */
export const PROOF_IMAGE = {
  src: '/assets/img/work-rapidkert-section.jpg',
  width: 640,
  height: 458,
} as const;

/**
 * Marks shown in the homepage's collaboration rail.
 *
 * The same six the site already shows, and no more. Five come from `/work`'s
 * "Akikkel dolgoztunk, de nincs róluk esettanulmány" group; Barbershop joins
 * them from the case table. Nothing here is new, and nothing here is a claim:
 * a mark says a collaboration existed, not that a case study exists for it, and
 * that is exactly why the rail is marks and not cards.
 *
 * DELIBERATELY ABSENT, and not an oversight in either case:
 *
 *   * `logo-fice.png` — the Impact Program build, which impact-program.html
 *     describes in its own words as "nem is együttműködés": the site says it is
 *     not a collaboration, so it cannot be in a collaboration rail.
 *   * `logo-haio.png` — a sponsorship, where hirdeteskezeles.html says "itt
 *     csak nem ügyfél a másik oldal".
 *   * `client-rapidkert.png` — Rapidkert has the featured case immediately
 *     below. Its mark in the rail as well would say the same name twice in one
 *     stage, at two different weights.
 *   * mentaltrening — there is no mark for it in `assets/img/`, and one is not
 *     invented here. It is reached through `/work` like everything else.
 *
 * `width`/`height` are the files' real intrinsic sizes. The rail plates every
 * mark into an identical box with `object-fit: contain`, so these reserve the
 * right space without any mark being stretched, cropped or recoloured.
 */
export type Mark = { name: string; src: string; width: number; height: number };

const COLLABORATIONS_HU: Mark[] = [
  { name: 'Kontyos.hu',                  src: '/assets/img/logo-kontyos.webp',       width: 436, height: 107 },
  { name: 'Grantool Kft.',               src: '/assets/img/logo-grantool.png',       width: 600, height: 401 },
  { name: 'Synergy Digital Hungary Kft.', src: '/assets/img/logo-synergy.png',       width: 382, height: 600 },
  { name: 'Duna Hajók',                  src: '/assets/img/logo-duna-hajok.png',     width: 600, height: 195 },
  { name: 'Duna Enterior',               src: '/assets/img/logo-duna-enterior.png',  width: 600, height: 196 },
  { name: 'Barbershop Győr',             src: '/assets/img/client-barbershop.png',   width: 1800, height: 1800 },
];

// -----------------------------------------------------------------------------
export type SystemNode = {
  id: string;
  name: string;
  /** Which concentric layer it sits on: 0 = core, 2 = outermost. */
  ring: 0 | 1 | 2;
};

/**
 * The nine disciplines, arranged as three functional layers rather than a flat
 * list. The layers are the point: what a visitor should take away is that these
 * depend on each other in a particular order, not that there are nine of them.
 *
 * IT USED TO CARRY A `blurb` PER DISCIPLINE — read this before adding one back.
 *
 * Nine `name — sentence` pairs, staged three layers at a time down the
 * passage's own scroll, is what made the system the longest chapter on the
 * homepage at 3.5 screens. Phase 5.1's inventory found that four of the nine
 * sentences restate a line Act III already says on the same page, eight screens
 * earlier and in the same `name / sentence` idiom:
 *
 *   Hirdetés        `Fizetett forgalom oda, ahol már van mit fogadnia.`
 *                vs `Forgalmat oda küldünk, ahol már van mit fogadnia.`
 *   Automatizálás   `Ami ismétlődik, azt nem embernek kell csinálnia.`
 *                vs `Ami ismétlődik, az fusson magától.`
 *   Fejlesztés      `Egyedi funkciók, integrációk, sebesség. Nem sablon…`
 *                vs `Egyedi kód, mérhető sebesség. Nem sablon…`
 *   Stratégia       `…Ez dönti el a többit.` — which is also, verbatim, the
 *                   first clause of the core layer's own note.
 *
 * The homepage was arguing the same nine capabilities twice, and the second
 * time was three times as long. So the nine sentences moved, whole and
 * unedited, to `06 · Amit be tudunk vállalni` on the services route — the
 * section that already documents what is behind the four services — and the
 * homepage keeps what only this chapter says: the three layers, their three
 * notes, and which discipline is on which layer.
 *
 * Nothing was deleted without being classified.
 * `_build/reports/luxury-art-direction/compression/inventory-source.json` is
 * the twenty-eight original units in all three locales, snapshotted before the
 * change; `content-audit.md` beside it is the generated table of where each one
 * went, and `scripts/system-inventory.mjs` fails if any of them is not at its
 * declared destination — including if a sentence classified as moved is still
 * in the homepage source.
 */
const SYSTEM_HU: SystemNode[] = [
  { id: 'research',    name: 'Kutatás',      ring: 0 },
  { id: 'strategy',    name: 'Stratégia',    ring: 0 },
  { id: 'branding',    name: 'Arculat',      ring: 1 },
  { id: 'website',     name: 'Weboldal',     ring: 1 },
  { id: 'development', name: 'Fejlesztés',   ring: 1 },
  { id: 'ads',         name: 'Hirdetés',     ring: 2 },
  { id: 'analytics',   name: 'Analitika',    ring: 2 },
  { id: 'optimisation',name: 'Optimalizálás',ring: 2 },
  { id: 'automation',  name: 'Automatizálás',ring: 2 },
];

// -----------------------------------------------------------------------------
/**
 * A stage of the operating process, as the homepage now carries it: a name.
 *
 * IT USED TO CARRY FIVE FIELDS AND IT CARRIES ONE — read this before adding one
 * back.
 *
 * Each checkpoint had `happens`, `weProduce`, `youProvide` and `outcome`: four
 * sentences answering four questions, seven times, which is twenty-eight
 * sentences plus seven names. Rendered one beat at a time down the passage's own
 * scroll — the only arrangement that keeps a visitor from meeting a
 * forty-nine-object grid — that came to 5.6 screens, and it made the process the
 * longest chapter on a homepage whose six master acts are the destinations.
 *
 * The length was never the defect. The defect was the information DEPTH: the
 * homepage was documenting the operating model where it only has to introduce
 * it. So the twenty-eight sentences moved, whole and unedited, to
 * `05 · A folyamat` on the services route, which is the page that already
 * carries how a proposal is produced and what the four services can do — and
 * the homepage kept the seven names, three principles derived from the same
 * sentences, and one route to the rest.
 *
 * Nothing was deleted without being classified.
 * `_build/reports/luxury-art-direction/process/inventory-source.json` is the
 * thirty-five original units in all three locales, snapshotted before the
 * change; `content-audit.md` beside it is the generated table of where each one
 * went, and `scripts/process-inventory.mjs` fails if any of them is not at its
 * declared destination.
 *
 * `altitude` went with them, and it is a removal rather than an oversight. It
 * was read by two things and both are gone: the per-checkpoint altitude stamp,
 * removed by the continuity pass as §6 "altitude decoration", and the seven 3D
 * progress markers in `components/SystemRings.tsx`, which nothing has mounted
 * since the same pass. The chapter's own band — 22 000 to 25 500 m — is in
 * `journey.ts`, where every other chapter's is.
 */
export type Checkpoint = {
  index: number;
  name: string;
};

const PROCESS_HU: Checkpoint[] = [
  { index: 1, name: 'Felderítés' },
  { index: 2, name: 'Kutatás' },
  { index: 3, name: 'Stratégia' },
  { index: 4, name: 'Tervezés' },
  { index: 5, name: 'Fejlesztés' },
  /* `Indulás` UNTIL PHASE 4, AND THE ONE SOURCE STRING THIS PHASE CHANGED.
     
     The stage is go-live, and `Élesítés` is the word the checkpoint's own
     sentence already uses for it — `Élesítés, átirányítások, mérés
     ellenőrzése, hirdetések indítása.` The rename is not a style preference:
     `Indulás` is also the closing CTA's eyebrow on the ads route, where it
     means "getting started with us" and the site dictionary translates it
     `Starting out`. One Hungarian word, two senses, and a sentence-keyed
     dictionary that can only hold one translation of it — so the detailed
     process arriving on the services route would have renamed a CTA on an
     unrelated page, or been given the wrong English itself.
     
     The Hungarian, English and German are all taken from the sentence above
     rather than invented: `Élesítés` / `Go-live` / `Livegang`. */
  { index: 6, name: 'Élesítés' },
  { index: 7, name: 'Optimalizálás' },
];

// -----------------------------------------------------------------------------
/** Stage 3 — the six disciplines, as sequential altitude checkpoints. */
const CAPABILITIES_HU = [
  { at: 3_200,  name: 'Stratégia',      line: 'Előbb eldöntjük, mit érdemes megépíteni. A többi ebből következik.' },
  { at: 3_800,  name: 'Dizájn',         line: 'A megjelenés nem díszítés. Azt dönti el, hisznek-e neked az első öt másodpercben.' },
  { at: 4_400,  name: 'Fejlesztés',     line: 'Egyedi kód, mérhető sebesség. Nem sablon, amit hetente frissíteni kell.' },
  { at: 5_000,  name: 'Hirdetés',       line: 'Forgalmat oda küldünk, ahol már van mit fogadnia.' },
  { at: 5_500,  name: 'Konverzió',      line: 'A látogatóból érdeklődő. Ezt mérjük, és ezen javítunk.' },
  { at: 5_900,  name: 'Automatizálás',  line: 'Ami ismétlődik, az fusson magától.' },
];

// -----------------------------------------------------------------------------
// Localised views of the four tables above.
//
// `localise` walks each structure once at module load and swaps in whatever the
// active locale's table has for a given Hungarian string. On `hu` it is the
// identity function; on `en` and `de` every string currently misses and falls
// back to the Hungarian, which is recorded — see i18n.ts.
//
// The `_HU` tables stay in the module (unexported) so the source copy is never
// the thing that got translated, and so a test can import both and compare.
// -----------------------------------------------------------------------------

export const WORK: CaseStudy[] = localise(WORK_HU);
/**
 * Localised like every other table, even though five of the six names are
 * proper nouns that come back identical. `name` is alt text — a screen reader
 * reads it aloud — so it goes through the same walk the rest of the copy does,
 * and the identity entries in `locales/{en,de}.ts` record that a person looked
 * at each one and decided it stays as it is. That is the rule `NON_COPY_KEYS`
 * already states for `name`, `alt`, `by` and `role`.
 */
export const COLLABORATIONS: Mark[] = localise(COLLABORATIONS_HU);
export const SYSTEM: SystemNode[] = localise(SYSTEM_HU);
export const PROCESS: Checkpoint[] = localise(PROCESS_HU);
export const CAPABILITIES = localise(CAPABILITIES_HU);

/** The untranslated source, for the i18n worklist generator and its test. */
export const SOURCE_TABLES = { WORK_HU, SYSTEM_HU, PROCESS_HU, CAPABILITIES_HU, COLLABORATIONS_HU };

/**
 * English homepage strings, keyed on the Hungarian source sentence.
 *
 * A .ts module rather than a .json file on purpose: the Playwright config and
 * the i18n reporting script both import this tree through plain Node, where a
 * JSON import needs an `import ... with { type: 'json' }` attribute that Vite,
 * tsc and Node do not all agree on yet. A typed object costs nothing and works
 * in every one of them.
 *
 * WHAT IS IN HERE
 * ---------------
 * The `content.ts` model — the six capabilities, the nine system nodes, the
 * seven process checkpoints and the four case studies. The *narrative* is not
 * here: it is keyed in `messages.ts`, because it is JSX rather than data. See
 * ../i18n.ts for the split.
 *
 * `id` and `src` values never reach this table — see `NON_COPY_KEYS` in
 * ../i18n.ts, and run `npm run i18n:meridian` for the outstanding worklist.
 *
 * TRANSLATION RULES FOLLOWED HERE
 * -------------------------------
 * The Hungarian is the approved source copy. These are translations of it: same
 * claim, same hierarchy, comparable length. Nothing is claimed in English that
 * the Hungarian does not already claim — which matters because `content.ts`
 * records that nothing on this page is invented, and a case study is the last
 * place to start.
 *
 * The Hungarian addresses the reader in the informal second person singular.
 * English has no such distinction, so it is carried as plain "you".
 *
 * IDENTITY ENTRIES ARE DELIBERATE
 * -------------------------------
 * Proper nouns — a company name, a person's name — appear here with the
 * Hungarian repeated as the value. That is not a stub. An absent key and a key
 * whose value is identical render the same on the page, but only the second one
 * records that a person looked at the string and decided it does not change.
 * The worklist counts the first as outstanding work and the second as done.
 */
export const EN: Record<string, string> = {
  // --- III · the six capabilities ------------------------------------------
  // Four of these names are shared with the system nodes below, which is the
  // sentence-key design working as intended: the same Hungarian word naming the
  // same discipline gets one translation in one place.
  'Stratégia': 'Strategy',
  'Előbb eldöntjük, mit érdemes megépíteni. A többi ebből következik.':
    'First we decide what is worth building. Everything else follows from that.',
  'Dizájn': 'Design',
  'A megjelenés nem díszítés. Azt dönti el, hisznek-e neked az első öt másodpercben.':
    'Appearance is not decoration. It decides whether you are believed in the first five seconds.',
  'Fejlesztés': 'Development',
  'Egyedi kód, mérhető sebesség. Nem sablon, amit hetente frissíteni kell.':
    'Custom code, measurable speed. Not a template that has to be updated every week.',
  'Hirdetés': 'Advertising',
  'Forgalmat oda küldünk, ahol már van mit fogadnia.':
    'We send traffic where there is already something to receive it.',
  'Konverzió': 'Conversion',
  'A látogatóból érdeklődő. Ezt mérjük, és ezen javítunk.':
    'From visitor to enquiry. That is what we measure, and what we improve.',
  'Automatizálás': 'Automation',
  'Ami ismétlődik, az fusson magától.': 'What repeats should run by itself.',

  // --- VII · the nine system nodes -----------------------------------------
  //
  // NAMES ONLY, AND THE NINE SENTENCES ARE NOT MISSING — they are on the
  // services route. Phase 5.1 compressed the system chapter from three staged
  // layers to one composed beat, and the nine `name — sentence` pairs went to
  // `06 · Amit be tudunk vállalni` on `szolgaltatasok.html`, whole and
  // unedited, in all three locales. Four of them restated a line Act III
  // already says on this page. See `content.ts` and
  // `scripts/system-inventory.mjs`, which fails if any of the twenty-eight
  // original units is not at its declared destination.
  //
  // Stratégia, Fejlesztés, Hirdetés and Automatizálás are already keyed above
  // as capabilities; only the five that are not appear here.
  'Kutatás': 'Research',
  'Arculat': 'Branding',
  'Weboldal': 'Website',
  'Analitika': 'Analytics',
  'Optimalizálás': 'Optimisation',

  // --- VIII · the seven checkpoints ----------------------------------------
  // Four of the seven names — Kutatás, Stratégia, Fejlesztés, Optimalizálás —
  // are already keyed above as capabilities or system nodes. Only three are new.
  //
  // THE TWENTY-EIGHT SENTENCES THAT USED TO FOLLOW ARE NOT HERE ANY MORE, and
  // they were not retranslated or dropped: phase 4 moved them, with these exact
  // English strings, into `_build/i18n/szolgaltatasok.json`, where the services
  // route's `05 · A folyamat` section renders them. The homepage carries the
  // seven names and three principles derived from the same sentences; the four
  // terms and their answers are one route deeper. See `../content.ts`.
  'Felderítés': 'Discovery',
  'Tervezés': 'Design',
  'Élesítés': 'Go-live',

  /*
   * --- VI · the four case studies ----------------------------------------
   *
   * The company names, the sector wording and the screenshot alt text follow
   * the decisions the rest of the site has already made rather than being
   * translated again: `_build/i18n/_common.json` keeps "Rapidkert Kft.",
   * "Barbershop Győr" and "mentaltrening.com" unchanged in all
   * three languages, and `kkv.json` already renders the screenshots as
   * "Rapidkert landscaping website" and "Barbershop Győr website". A visitor
   * who moves between this page and kkv.html should not meet two names for one
   * company.
   *
   * `Győrffy Márton` is a real person's name in Hungarian order — family name
   * first. It is carried unchanged rather than reordered to "Márton Győrffy":
   * how a named client is credited in a published testimonial is his decision
   * and the client's, not a translation choice to make silently.
   */

  // 1 · Rapidkert Kft. — 11 800 m
  'Rapidkert Kft.': 'Rapidkert Kft.',
  'Kertépítés': 'Landscaping',
  'A kertépítés keresései szezonálisak és erősen helyhez kötöttek. Az érdeklődés megvolt, de nem a megfelelő emberektől: sok megkeresés érkezett olyanoktól, akiknek egészen más kellett volna.':
    'Searches for landscaping are seasonal and strongly tied to a place. The interest was there, but not from the right people: many enquiries came from those who needed something else entirely.',
  'Nem több forgalmat céloztunk meg, hanem pontosabbat. A pozicionálás, az oldal szerkezete és a hirdetések ugyanarra a szűkebb keresési szándékra épültek.':
    'We did not aim for more traffic, but for more precise traffic. The positioning, the structure of the site and the advertising were all built on the same, narrower search intent.',
  'Google Ads és SEO egy rendszerként, majd egy teljesen újragondolt weboldal, amelynek közepén a kert és az alatta lévő talaj interaktív 3D keresztmetszete áll.':
    'Google Ads and SEO as one system, then a completely rethought website built around an interactive 3D cross-section of a garden and the ground beneath it.',
  'A fizetett és az organikus keresés együtt nagyjából 15 millió Ft értékű szerződött projektet hozott: mintegy 9 millió Ft a Google Adsből, további 6 millió Ft az organikus keresésből.':
    'Paid and organic search together generated approximately 15 million HUF in contracted project value: around 9 million HUF from Google Ads and a further 6 million HUF from organic search.',
  '~15M Ft': '~15M HUF',
  'Szerződött projektérték keresésből': 'Contracted project value from search',
  'Az oldal karbantartása és a hirdetések folyamatos kezelése havidíjas konstrukcióban.':
    'Maintenance of the site and continuous management of the advertising, on a monthly retainer.',
  'Az eredmények gyorsan láthatóak lettek: több megkeresés érkezett, és sokkal célzottabban találtak ránk azok az ügyfelek, akik valóban a szolgáltatásainkat keresték.':
    'The results became visible quickly: more enquiries came in, and the customers who were genuinely looking for our services found us far more precisely.',
  'Győrffy Márton': 'Győrffy Márton',
  'CEO, Rapidkert Kft.': 'CEO, Rapidkert Kft.',
  'A Rapidkert interaktív 3D kertépítő weboldala a Stratos Mediától':
    'The Rapidkert interactive 3D landscaping website by Stratos Media',

  // 2 · Barbershop Győr — 13 200 m
  'Barbershop Győr': 'Barbershop Győr',
  'Helyi szolgáltatás': 'Local service',
  'Egy helyi szolgáltatásnál a döntés a telefon képernyőjén, percek alatt születik meg. Egy lassú vagy nehezen olvasható oldal itt nem kényelmetlenség, hanem elvesztett vendég.':
    'For a local service the decision is made on a phone screen, in minutes. A slow or hard-to-read site is not an inconvenience here — it is a lost customer.',
  'Mobilra tervezett oldal, amelyen az időpontfoglalás és az elérhetőség sosincs egy görgetésnél messzebb.':
    'A site designed for mobile, where booking and contact details are never more than one scroll away.',
  'Egyedi arculatú, gyorsan betöltő weboldal, a helyi keresésre optimalizált tartalommal.':
    'A fast-loading website with its own visual identity, and content optimised for local search.',
  'Élő oldal, amely a saját nevére és a helyi keresésekre is megtalálható.':
    'A live site that can be found both by its own name and through local searches.',
  'Havidíjas üzemeltetés: tárhely, frissítések, tartalmi módosítások.':
    'Operation on a monthly retainer: hosting, updates, content changes.',
  'A Barbershop Győr weboldala': 'The Barbershop Győr website',

  // 3 · mentaltrening.com — 14 600 m
  'mentaltrening.com': 'mentaltrening.com',
  'Mentális tréning': 'Mental training',
  'Bizalmi szolgáltatásnál a weboldal nem katalógus, hanem az első beszélgetés. A hangvétel többet dönt, mint a funkciólista.':
    'For a service built on trust the website is not a catalogue, it is the first conversation. The tone of voice decides more than the list of features.',
  'A tartalmi szerkezetet a kérdésekre építettük, amelyekkel az érdeklődők valóban érkeznek — nem a szolgáltatás belső logikájára.':
    'We built the content structure around the questions people actually arrive with — not around the internal logic of the service.',
  'Egyedi weboldal, tiszta tipográfiával és egyetlen, egyértelmű kapcsolatfelvételi úttal.':
    'A custom website, with clean typography and a single, unambiguous route to getting in touch.',
  'Élő oldal, amely a szolgáltatás hangját viszi tovább, nem csak a tényeit.':
    'A live site that carries the voice of the service, not only its facts.',
  'Folyamatos tartalmi gondozás és technikai karbantartás.':
    'Continuous editorial care and technical maintenance.',
  'A mentaltrening.com weboldala': 'The mentaltrening.com website',
  'Kézműves gyártás': 'Handmade production',
  'Kézzel készülő termékeknél a minőség fényképen múlik. Egy gyenge vizuális megjelenés azt sugallja, hogy a termék is az.':
    'With handmade products, quality comes down to the photograph. A weak visual presence suggests the product is weak too.',
  'A megjelenést a termék köré építettük: kevesebb elem, több hely, a képek kapják a hangsúlyt.':
    'We built the presentation around the product: fewer elements, more space, the images carrying the emphasis.',
  'Arculati elemek és a hozzájuk illeszkedő online megjelenés.':
    'Brand identity elements, and an online presence built to match them.',
  'Egységes, felismerhető megjelenés a márka minden felületén.':
    'A consistent, recognisable appearance across every surface of the brand.',
  'Arculati konzultáció és a megjelenés karbantartása.':
    'Brand consultation, and maintenance of the visual presence.',

  // Collaboration marks. Proper nouns: identity, recorded rather than assumed.
  'Kontyos.hu': 'Kontyos.hu',
  'Grantool Kft.': 'Grantool Kft.',
  'Synergy Digital Hungary Kft.': 'Synergy Digital Hungary Kft.',
  'Duna Hajók': 'Duna Hajók',
  'Duna Enterior': 'Duna Enterior',
};

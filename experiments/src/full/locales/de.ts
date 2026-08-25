/**
 * German homepage strings, keyed on the Hungarian source sentence.
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
 * claim, same hierarchy, comparable length. Nothing is claimed in German that
 * the Hungarian does not already claim — which matters because `content.ts`
 * records that nothing on this page is invented, and a case study is the last
 * place to start.
 *
 * The Hungarian addresses the reader in the informal second person singular.
 * German is set in `Sie` throughout, matching `messages.ts` and the site's
 * other eleven pages — a homepage that says `du` and a contact page that says
 * `Sie` is one company with two voices.
 *
 * IDENTITY ENTRIES ARE DELIBERATE
 * -------------------------------
 * Proper nouns — a company name, a person's name — appear here with the
 * Hungarian repeated as the value. That is not a stub. An absent key and a key
 * whose value is identical render the same on the page, but only the second one
 * records that a person looked at the string and decided it does not change.
 * The worklist counts the first as outstanding work and the second as done.
 */
export const DE: Record<string, string> = {
  // --- III · die sechs Leistungsbereiche ------------------------------------
  // Vier dieser Namen teilen sich mit den Systemknoten weiter unten denselben
  // Schlüssel: dasselbe ungarische Wort für dieselbe Disziplin bekommt eine
  // Übersetzung an einer Stelle.
  'Stratégia': 'Strategie',
  'Előbb eldöntjük, mit érdemes megépíteni. A többi ebből következik.':
    'Zuerst entscheiden wir, was zu bauen sich lohnt. Alles Weitere folgt daraus.',
  'Dizájn': 'Design',
  'A megjelenés nem díszítés. Azt dönti el, hisznek-e neked az első öt másodpercben.':
    'Gestaltung ist keine Dekoration. Sie entscheidet, ob man Ihnen in den ersten fünf Sekunden glaubt.',
  'Fejlesztés': 'Entwicklung',
  'Egyedi kód, mérhető sebesség. Nem sablon, amit hetente frissíteni kell.':
    'Eigener Code, messbare Geschwindigkeit. Keine Vorlage, die wöchentlich aktualisiert werden muss.',
  'Hirdetés': 'Werbung',
  'Forgalmat oda küldünk, ahol már van mit fogadnia.':
    'Wir schicken Traffic dorthin, wo ihn bereits etwas empfängt.',
  'Konverzió': 'Konversion',
  'A látogatóból érdeklődő. Ezt mérjük, és ezen javítunk.':
    'Vom Besucher zur Anfrage. Das messen wir, und das verbessern wir.',
  'Automatizálás': 'Automatisierung',
  'Ami ismétlődik, az fusson magától.': 'Was sich wiederholt, soll von selbst laufen.',

  // --- VII · die neun Systemknoten ------------------------------------------
  //
  // NUR DIE NAMEN — die neun Sätze fehlen nicht, sie stehen auf der
  // Leistungsseite. Phase 5.1 hat das Systemkapitel von drei gestaffelten
  // Ebenen auf einen komponierten Takt verdichtet; die neun `Name — Satz`-Paare
  // sind unverändert nach `06 · Amit be tudunk vállalni` in
  // `szolgaltatasok.html` umgezogen, in allen drei Sprachen. Vier davon haben
  // wiederholt, was Akt III auf derselben Seite bereits sagt. Siehe
  // `content.ts` und `scripts/system-inventory.mjs`.
  //
  // Stratégia, Fejlesztés, Hirdetés und Automatizálás sind oben bereits als
  // Leistungsbereiche hinterlegt; hier stehen nur die fünf übrigen.
  'Kutatás': 'Recherche',
  'Arculat': 'Branding',
  'Weboldal': 'Website',
  'Analitika': 'Analytics',
  'Optimalizálás': 'Optimierung',

  // --- VIII · die sieben Kontrollpunkte -------------------------------------
  // Vier der sieben Namen — Kutatás, Stratégia, Fejlesztés, Optimalizálás —
  // sind oben bereits als Leistungsbereich oder Systemknoten hinterlegt. Nur
  // drei sind neu. `Tervezés` ist die Entwurfsphase, `Dizájn` die Disziplin;
  // im Deutschen bleiben die beiden deshalb getrennt — `Konzeption` gegen
  // `Design`, und `Konzeption` ist auch das Wort, das `_build/i18n/_common.json`
  // für dieselbe Phase auf den übrigen Seiten setzt. Vorher stand hier
  // `Gestaltung`: dieselbe Unterscheidung, ein anderes Wort, und damit zwei
  // Namen für einen Schritt, sobald die Startseite auf die Leistungsseite
  // verlinkt.
  //
  // DIE ACHTUNDZWANZIG SÄTZE, DIE HIER STANDEN, SIND UMGEZOGEN — nicht neu
  // übersetzt und nicht gestrichen: Phase 4 hat sie mit genau diesen deutschen
  // Strings nach `_build/i18n/szolgaltatasok.json` verschoben, wo der Abschnitt
  // `05 · A folyamat` der Leistungsseite sie ausgibt. Die Startseite trägt die
  // sieben Namen und drei daraus abgeleitete Prinzipien; die vier Begriffe und
  // ihre Antworten liegen eine Route tiefer. Siehe `../content.ts`.
  'Felderítés': 'Erkundung',
  'Tervezés': 'Konzeption',
  'Élesítés': 'Livegang',

  /*
   * --- VI · die vier Fallstudien ------------------------------------------
   *
   * Firmennamen, Branchenbezeichnung und Alt-Text der Screenshots folgen den
   * Entscheidungen, die der Rest der Website bereits getroffen hat, statt neu
   * übersetzt zu werden: `_build/i18n/_common.json` lässt "Rapidkert Kft.",
   * "Barbershop Győr" und "mentaltrening.com" in allen drei
   * Sprachen unverändert, und `kkv.json` schreibt die Screenshots bereits als
   * "Website von Rapidkert Gartenbau" und "Website von Barbershop Győr".
   *
   * `Győrffy Márton` ist ein realer Personenname in ungarischer Reihenfolge —
   * Familienname zuerst. Er wird unverändert übernommen und nicht zu "Márton
   * Győrffy" umgestellt: wie ein namentlich genannter Kunde in einem
   * veröffentlichten Testimonial geführt wird, ist keine stillschweigend zu
   * treffende Übersetzungsentscheidung.
   */

  // 1 · Rapidkert Kft. — 11 800 m
  'Rapidkert Kft.': 'Rapidkert Kft.',
  'Kertépítés': 'Gartenbau',
  'A kertépítés keresései szezonálisak és erősen helyhez kötöttek. Az érdeklődés megvolt, de nem a megfelelő emberektől: sok megkeresés érkezett olyanoktól, akiknek egészen más kellett volna.':
    'Suchanfragen im Gartenbau sind saisonal und stark ortsgebunden. Das Interesse war da, aber nicht von den richtigen Leuten: Viele Anfragen kamen von Menschen, die etwas ganz anderes brauchten.',
  'Nem több forgalmat céloztunk meg, hanem pontosabbat. A pozicionálás, az oldal szerkezete és a hirdetések ugyanarra a szűkebb keresési szándékra épültek.':
    'Wir haben nicht auf mehr Traffic gezielt, sondern auf genaueren. Positionierung, Seitenstruktur und Werbung bauten auf derselben, enger gefassten Suchintention auf.',
  'Google Ads és SEO egy rendszerként, majd egy teljesen újragondolt weboldal, amelynek közepén a kert és az alatta lévő talaj interaktív 3D keresztmetszete áll.':
    'Google Ads und SEO als ein System, danach eine vollständig neu gedachte Website, in deren Zentrum ein interaktiver 3D-Querschnitt durch einen Garten und den Boden darunter steht.',
  'A fizetett és az organikus keresés együtt nagyjából 15 millió Ft értékű szerződött projektet hozott: mintegy 9 millió Ft a Google Adsből, további 6 millió Ft az organikus keresésből.':
    'Bezahlte und organische Suche brachten zusammen einen beauftragten Projektwert von rund 15 Millionen HUF: etwa 9 Millionen HUF aus Google Ads und weitere 6 Millionen HUF aus der organischen Suche.',
  '~15M Ft': '~15 Mio. HUF',
  'Szerződött projektérték keresésből': 'Beauftragter Projektwert aus der Suche',
  'Az oldal karbantartása és a hirdetések folyamatos kezelése havidíjas konstrukcióban.':
    'Wartung der Website und laufende Betreuung der Werbung im Monatsmodell.',
  'Az eredmények gyorsan láthatóak lettek: több megkeresés érkezett, és sokkal célzottabban találtak ránk azok az ügyfelek, akik valóban a szolgáltatásainkat keresték.':
    'Die Ergebnisse waren schnell sichtbar: Es kamen mehr Anfragen, und die Kunden, die wirklich unsere Leistungen suchten, fanden uns deutlich gezielter.',
  'Győrffy Márton': 'Győrffy Márton',
  'CEO, Rapidkert Kft.': 'CEO, Rapidkert Kft.',
  'A Rapidkert interaktív 3D kertépítő weboldala a Stratos Mediától':
    'Die interaktive 3D-Website von Rapidkert Gartenbau, umgesetzt von Stratos Media',

  // 2 · Barbershop Győr — 13 200 m
  'Barbershop Győr': 'Barbershop Győr',
  'Helyi szolgáltatás': 'Lokale Dienstleistung',
  'Egy helyi szolgáltatásnál a döntés a telefon képernyőjén, percek alatt születik meg. Egy lassú vagy nehezen olvasható oldal itt nem kényelmetlenség, hanem elvesztett vendég.':
    'Bei einer lokalen Dienstleistung fällt die Entscheidung auf dem Handybildschirm, in wenigen Minuten. Eine langsame oder schwer lesbare Seite ist hier keine Unbequemlichkeit, sondern ein verlorener Gast.',
  'Mobilra tervezett oldal, amelyen az időpontfoglalás és az elérhetőség sosincs egy görgetésnél messzebb.':
    'Eine für das Handy entworfene Seite, auf der Terminbuchung und Kontakt nie mehr als eine Scrollbewegung entfernt sind.',
  'Egyedi arculatú, gyorsan betöltő weboldal, a helyi keresésre optimalizált tartalommal.':
    'Eine schnell ladende Website mit eigenem Erscheinungsbild und für die lokale Suche optimierten Inhalten.',
  'Élő oldal, amely a saját nevére és a helyi keresésekre is megtalálható.':
    'Eine laufende Seite, die sowohl über den eigenen Namen als auch über lokale Suchanfragen zu finden ist.',
  'Havidíjas üzemeltetés: tárhely, frissítések, tartalmi módosítások.':
    'Betrieb im Monatsmodell: Hosting, Aktualisierungen, inhaltliche Änderungen.',
  'A Barbershop Győr weboldala': 'Die Website von Barbershop Győr',

  // 3 · mentaltrening.com — 14 600 m
  'mentaltrening.com': 'mentaltrening.com',
  'Mentális tréning': 'Mentaltraining',
  'Bizalmi szolgáltatásnál a weboldal nem katalógus, hanem az első beszélgetés. A hangvétel többet dönt, mint a funkciólista.':
    'Bei einer Vertrauensdienstleistung ist die Website kein Katalog, sondern das erste Gespräch. Der Ton entscheidet mehr als die Funktionsliste.',
  'A tartalmi szerkezetet a kérdésekre építettük, amelyekkel az érdeklődők valóban érkeznek — nem a szolgáltatás belső logikájára.':
    'Wir haben die Inhaltsstruktur um die Fragen herum gebaut, mit denen Interessierte tatsächlich ankommen — nicht um die interne Logik der Leistung.',
  'Egyedi weboldal, tiszta tipográfiával és egyetlen, egyértelmű kapcsolatfelvételi úttal.':
    'Eine eigene Website mit klarer Typografie und einem einzigen, eindeutigen Weg zur Kontaktaufnahme.',
  'Élő oldal, amely a szolgáltatás hangját viszi tovább, nem csak a tényeit.':
    'Eine laufende Seite, die den Ton der Leistung weiterträgt, nicht nur ihre Fakten.',
  'Folyamatos tartalmi gondozás és technikai karbantartás.':
    'Laufende inhaltliche Pflege und technische Wartung.',
  'A mentaltrening.com weboldala': 'Die Website von mentaltrening.com',
  'Kézműves gyártás': 'Handwerkliche Fertigung',
  'Kézzel készülő termékeknél a minőség fényképen múlik. Egy gyenge vizuális megjelenés azt sugallja, hogy a termék is az.':
    'Bei handgefertigten Produkten hängt die Qualität am Foto. Ein schwacher visueller Auftritt legt nahe, dass auch das Produkt schwach ist.',
  'A megjelenést a termék köré építettük: kevesebb elem, több hely, a képek kapják a hangsúlyt.':
    'Wir haben den Auftritt um das Produkt herum gebaut: weniger Elemente, mehr Raum, die Bilder tragen den Schwerpunkt.',
  'Arculati elemek és a hozzájuk illeszkedő online megjelenés.':
    'Elemente des Erscheinungsbilds und ein dazu passender Online-Auftritt.',
  'Egységes, felismerhető megjelenés a márka minden felületén.':
    'Ein einheitlicher, wiedererkennbarer Auftritt auf allen Flächen der Marke.',
  'Arculati konzultáció és a megjelenés karbantartása.':
    'Beratung zum Erscheinungsbild und Pflege des Auftritts.',

  // Collaboration marks. Proper nouns: identity, recorded rather than assumed.
  'Kontyos.hu': 'Kontyos.hu',
  'Grantool Kft.': 'Grantool Kft.',
  'Synergy Digital Hungary Kft.': 'Synergy Digital Hungary Kft.',
  'Duna Hajók': 'Duna Hajók',
  'Duna Enterior': 'Duna Enterior',
};

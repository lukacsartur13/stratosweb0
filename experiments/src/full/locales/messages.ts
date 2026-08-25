/**
 * The homepage narrative, as keyed messages.
 *
 * WHY THIS EXISTS ALONGSIDE THE SENTENCE-KEYED TABLES
 * ---------------------------------------------------
 * `../i18n.ts` translates the *content model* — `content.ts`'s case studies,
 * capabilities and process checkpoints — by walking the structure and looking
 * each Hungarian sentence up in `en.ts` / `de.ts`. That works because those are
 * data: whole strings, no markup, no interpolation.
 *
 * The narrative is not data. It is JSX with `<em>` inside headings, `<br />`
 * between title lines and links mid-sentence, so a sentence key would have to
 * be either the whole marked-up fragment (which a translator cannot edit safely)
 * or a fragment so short it is ambiguous — "építünk." appears twice in the page
 * with two different translations. Stable keys solve both: the key carries the
 * position, and the three values sit next to each other where a translator can
 * see them together.
 *
 * KEY NAMING
 * ----------
 * `<section>.<role>` and, where a heading is split across markup,
 * `<section>.title.a` / `.em` / `.b` in render order. `common.*` is anything
 * that appears in more than one section.
 *
 * TRANSLATION RULES FOLLOWED HERE
 * -------------------------------
 * The Hungarian is the approved source copy and is reproduced verbatim — no
 * rewrites, no "improvements". English and German are translations of it: same
 * meaning, same hierarchy, comparable length. Nothing new is claimed in either
 * language that the Hungarian does not already claim, which matters because
 * `content.ts` records that nothing on this page is invented.
 *
 * Altitude labels are here rather than computed because the digit grouping is
 * locale-specific, and because these are *ranges* — "3 000 – 6 000 m" — which
 * `formatAltitude` does not produce.
 *
 * The grouping in each language is the one `formatAltitude` produces for that
 * language, so an eyebrow and the numbers in the panel under it agree:
 * `Intl.NumberFormat` gives `3,000` on `en-GB` and `3.000` on `de-DE`. It gives
 * `3000` on `hu-HU` — Hungarian only groups from five digits — where the
 * approved Hungarian copy writes `3 000`. That mismatch is pre-existing and in
 * the approved source copy, so it is reproduced verbatim rather than corrected
 * here.
 */

export type Message = { hu: string; en: string; de: string };

export const MESSAGES = {
  // --- shared -------------------------------------------------------------
  'common.skipToContent': {
    hu: 'Ugrás a tartalomra',
    en: 'Skip to content',
    de: 'Zum Inhalt springen',
  },
  'common.cta.ascend': {
    hu: 'Kezdjük az emelkedést',
    en: 'Start the ascent',
    de: 'Den Aufstieg beginnen',
  },
  'common.cta.work': {
    hu: 'Munkáink',
    en: 'Our work',
    de: 'Unsere Arbeiten',
  },
  /*
   * The language switcher's group label.
   *
   * These three are the labels the site's other eleven pages already ship —
   * `aria-label="Nyelvválasztás"` on the Hungarian tree, `"Choose language"` on
   * `/en/`, `"Sprache wählen"` on `/de/` — lifted rather than translated again.
   *
   * The homepage previously hard-coded the single trilingual string
   * "Nyelvválasztás / Language / Sprache", on the reasoning that a switcher is
   * language-neutral. That is defensible in isolation and wrong in context: it
   * is the one control on the page that announced itself in Hungarian first to
   * an English screen-reader user, and it disagreed with the identical control
   * on every subpage. `LanguageSwitch` mirrors the generated markup everywhere
   * else; this is the last attribute where it did not.
   */
  'common.languageSwitch': {
    hu: 'Nyelvválasztás',
    en: 'Choose language',
    de: 'Sprache wählen',
  },

  /* ======================================================= THE SIX ACTS ===

     THE MONUMENTS, WITH THEIR AUTHORED LINE BREAKS.

     One key per act, per locale, with the breaks written into the string as
     `|`. Everything about that is deliberate.

     ## Why the breaks are in the copy

     §20 of the production brief: equivalent authority, different geometry. The
     three languages legitimately take different sizes, different line counts
     and different measures, and §18 forbids letting the browser decide any of
     it — a monument that re-breaks on a resize is not a composition, it is a
     paragraph. The breaks are therefore authored, they are part of the
     statement, and they belong where the statement is, next to the two
     translations a translator has to keep in step with it.

     Every one of them is the break the six-act master study solved and
     photographed. `_build/reports/luxury-art-direction/solve-six.mjs` holds the
     same table with the rejected alternatives beside each choice, and
     `acts.ts` holds the size, leading and foot line each one was solved to.

     ## Why `|` and not `.a` / `.em` / `.b`

     Those keys carry an emphasis as well as a break — the `<em>` the old
     composition set a second colour and a kinetic axis on. Direction D has one
     weight, one width and no word-level emphasis inside a statement (§16, §17),
     so there is no `<em>` left to name and a three-line statement would need a
     `.c` nobody would think to add. A delimiter says exactly one thing, which
     is where the line ends, and it makes the line count visible in the string
     rather than implied by which keys happen to exist.

     ## Act IV has no key here

     Its monument is `~15M Ft`, which is not copy — it is `content.ts`'s
     figure, verbatim, and it is the same seven glyphs in all three languages.
     Rendering it from a message would be a second place for it to be wrong.  */

  /* I · GROUND. `calibration.title.em` + `.b`, and the English is broken after
     "is" rather than before it: `Altitude is / what we build.` solves to 137px
     against 118px for the other break, because the fill is a promise about the
     longest LINE and `is what we build.` is a long one. */
  'act.i.monument': {
    hu: 'Magasságot|építünk.',
    en: 'Altitude is|what we build.',
    de: 'Höhe|bauen wir.',
  },
  /* II · NOISE. Three lines in all three locales, and the three-line stack IS
     the act: §24 asks for a silhouette that is not the hero's and forbids
     achieving "noise" by adding noise, and a three-word sentence stacked into a
     narrow right-hand column is the typographic form of the compression the act
     is about. The two-line break was solved and photographed beside it
     (`six-act/y1.png`, `y2.png`) and holds 99.7% of the presence — presence
     does not decide this one, the silhouette does.

     This statement was `cloudEntry.title` at 6 000–8 500 m. It is Act II's at
     150–3 000 m, which is what makes the six acts run in altitude order — see
     `acts.ts`. Not one word of it changed, and "down here" is truer of the
     first three thousand metres than it was of eight and a half. */
  'act.ii.monument': {
    hu: 'Idelent|minden|zajos.',
    en: 'Down here|everything|is noisy.',
    de: 'Hier unten|ist alles|laut.',
  },
  /* III · SYSTEM. `lowerAtmosphere.title`, unchanged. German sets the widest
     line in the whole design here — 1 027px — which is what decided against
     putting a second instrument in this act. */
  'act.iii.monument': {
    hu: 'Hat terület,|egy rendszer.',
    en: 'Six areas,|one system.',
    de: 'Sechs Bereiche,|ein System.',
  },
  /* V · HIGH ALTITUDE. The benchmark frame, unchanged from Direction D's D3.
     Hungarian breaks after "látni" rather than after "már": the held-breath
     break was solved beside it and gives the act a shorter first line and a
     longer second, which is the opposite of the shape the frame wants. English
     and German both take three lines, and the empty middle of the frame is what
     gives them room for the third without the composition becoming crowded. */
  'act.v.monument': {
    hu: 'Innen már látni|a görbületet.',
    en: 'From here|you can see|the curvature.',
    de: 'Von hier aus ist|die Krümmung|zu sehen.',
  },
  /* VI · ARRIVAL. Hungarian is the binding locale here, for the only time in
     the design: `sztratoszférában.` is one seventeen-character word, and a fill
     is a promise about a line, so one long word spends the whole of it. */
  'act.vi.monument': {
    hu: 'Üdv a|sztratoszférában.',
    en: 'Welcome to the|stratosphere.',
    de: 'Willkommen in der|Stratosphäre.',
  },
  /* THE ACTION BEAT. A separate frame from the arrival — §14 keeps them as two
     emotional beats — and the emptiest one on the page. */
  'act.action.monument': {
    hu: 'Készen állsz|felemelkedni?',
    en: 'Are you ready to|ascend?',
    de: 'Sind Sie bereit|aufzusteigen?',
  },

  /* The one altitude reading in the six frames.

     §35 asks for the altitude concept to survive and its visual insistence to
     go, and the master study lands on one micro label in six acts — in the one
     act whose sentence is itself a measurement about the atmosphere. It is a
     reading rather than the stage's range, so it is not
     `stratosphereTransition.altitude`, which is `25 500 – 28 000 m` and is a
     specification rather than an instrument. */
  'act.v.altitude': {
    hu: '27 000 m',
    en: '27,000 m',
    de: '27.000 m',
  },

  // --- I · 0 m — calibration ----------------------------------------------
  'calibration.eyebrow': {
    hu: 'I · Kalibráció',
    en: 'I · Calibration',
    de: 'I · Kalibrierung',
  },
  'calibration.altitude': { hu: '0 m', en: '0 m', de: '0 m' },
  'calibration.title.a': {
    hu: 'Nem weboldalakat építünk.',
    en: 'We do not build websites.',
    de: 'Wir bauen keine Websites.',
  },
  'calibration.title.em': {
    hu: 'Magasságot',
    en: 'Altitude',
    de: 'Höhe',
  },
  'calibration.title.b': {
    hu: 'építünk.',
    en: 'is what we build.',
    de: 'bauen wir.',
  },
  /**
   * THE OPENING PARAGRAPH, SPLIT AT ITS OWN SENTENCE BOUNDARIES.
   *
   * This was one three-sentence block set at body size directly under the
   * headline, which is the shape that made the page read as a stacked agency
   * site: a medium title with a paragraph beneath it, eleven times over.
   *
   * The three sentences are not one thought — they are a premise, a pivot and a
   * promise — so the editorial composition gives each the weight it actually
   * has. The premise and the pivot become an annotation set beside the
   * statement; the promise becomes the one supporting line under it.
   *
   * NOT ONE WORD IS DIFFERENT. Every sentence below is verbatim from the string
   * this replaces, in all three locales. The split is a change of typography,
   * not of copy — which is what the direction asks for and what makes it safe
   * to do to translated content nobody is re-translating.
   */
  'calibration.note.a': {
    hu: 'A legtöbb vállalkozás a földön versenyzik: ugyanazokkal az eszközökkel, ugyanazokért a figyelemmorzsákért.',
    en: 'Most businesses compete on the ground: the same tools, the same crumbs of attention.',
    de: 'Die meisten Unternehmen konkurrieren am Boden: mit denselben Werkzeugen, um dieselben Aufmerksamkeitskrümel.',
  },
  'calibration.note.b': {
    hu: 'Mi máshol dolgozunk.',
    en: 'We work somewhere else.',
    de: 'Wir arbeiten woanders.',
  },
  'calibration.lead': {
    hu: 'Előbb megnézzük, hol tartasz — aztán megépítjük a rendszert, amivel feljebb kerülsz.',
    en: 'First we look at where you stand — then we build the system that takes you higher.',
    de: 'Zuerst sehen wir uns an, wo Sie stehen — dann bauen wir das System, mit dem Sie höher kommen.',
  },
  'calibration.meta': {
    hu: 'A műszer bal oldalt egyedi modell — nem katalógusból vett pilótafülke-óra. Görgess: a magasságmérő a görgetést követi.',
    en: 'The instrument on the left is a custom model — not a cockpit clock taken from a catalogue. Scroll: the altimeter follows your scrolling.',
    de: 'Das Instrument links ist ein eigenes Modell — keine Cockpit-Uhr aus dem Katalog. Scrollen Sie: Der Höhenmesser folgt dem Scrollen.',
  },
  /**
   * The same sentence without the position.
   *
   * `calibration.meta` says "the instrument **on the left**", which is true of
   * the desktop composition and false on a phone, where the dial sits under the
   * headline in ordinary flow. Copy that points at a screen position is copy
   * that is wrong on half the devices that read it — the panel above the system
   * rings already carries that note, and this is the same mistake caught in the
   * other direction.
   *
   * A separate key rather than a conditional inside one string: the two
   * compositions genuinely say different things, and a translator editing the
   * German should be able to see which surface they are editing.
   */
  'calibration.meta.mobile': {
    hu: 'A műszer egyedi modell — nem katalógusból vett pilótafülke-óra. Görgess: a magasságmérő a görgetést követi.',
    en: 'The instrument is a custom model — not a cockpit clock taken from a catalogue. Scroll: the altimeter follows your scrolling.',
    de: 'Das Instrument ist ein eigenes Modell — keine Cockpit-Uhr aus dem Katalog. Scrollen Sie: Der Höhenmesser folgt dem Scrollen.',
  },

  // --- II · 150–3 000 m — initial ascent -----------------------------------
  'initialAscent.eyebrow': {
    hu: 'II · Emelkedés',
    en: 'II · Ascent',
    de: 'II · Aufstieg',
  },
  'initialAscent.altitude': {
    hu: '150 – 3 000 m',
    en: '150 – 3,000 m',
    de: '150 – 3.000 m',
  },
  'initialAscent.title.a': {
    hu: 'Egy weboldal önmagában',
    en: 'A website on its own',
    de: 'Eine Website allein',
  },
  'initialAscent.title.em': {
    hu: 'nem visz sehova.',
    en: 'takes you nowhere.',
    de: 'bringt Sie nirgendwohin.',
  },
  /**
   * Four sentences that were already a list, printed as prose.
   *
   * One premise and three failure conditions, in identical grammatical form —
   * "with no X, Y". Set as a paragraph they read as one undifferentiated block;
   * set as four annotations they read as what they are, which is the diagram
   * the scene is about. Verbatim, in all three locales.
   */
  'initialAscent.note.a': {
    hu: 'A weboldal egyetlen alkatrész.',
    en: 'A website is a single component.',
    de: 'Eine Website ist ein einzelnes Bauteil.',
  },
  'initialAscent.note.b': {
    hu: 'Ha nincs mögötte stratégia, nem tudja, kinek beszél.',
    en: 'With no strategy behind it, it does not know who it is speaking to.',
    de: 'Ohne Strategie dahinter weiß sie nicht, zu wem sie spricht.',
  },
  'initialAscent.note.c': {
    hu: 'Ha nincs mellette hirdetés, nem találja meg senki.',
    en: 'With no advertising beside it, nobody finds it.',
    de: 'Ohne Werbung daneben findet sie niemand.',
  },
  'initialAscent.note.d': {
    hu: 'Ha nincs utána mérés, sosem derül ki, mi működik.',
    en: 'With no measurement after it, you never learn what works.',
    de: 'Ohne Messung danach erfahren Sie nie, was funktioniert.',
  },
  'initialAscent.body.b': {
    hu: 'A Stratos integrált növekedési rendszereket épít: a stratégiától a mérésig egyetlen szerkezet, amelynek minden eleme ugyanabba az irányba mozdul.',
    en: 'Stratos builds integrated growth systems: one structure from strategy to measurement, with every part of it moving in the same direction.',
    de: 'Stratos baut integrierte Wachstumssysteme: eine einzige Struktur von der Strategie bis zur Messung, deren Teile sich alle in dieselbe Richtung bewegen.',
  },
  'initialAscent.meta': {
    hu: 'A hosszú mutató körönként 1 000 métert tesz meg — ugyanaz a leképezés, mint egy valódi magasságmérőn.',
    en: 'The long hand covers 1,000 metres per revolution — the same mapping as on a real altimeter.',
    de: 'Der lange Zeiger legt pro Umdrehung 1.000 Meter zurück — dieselbe Zuordnung wie auf einem echten Höhenmesser.',
  },

  // --- III · 3 000–6 000 m — lower atmosphere ------------------------------
  'lowerAtmosphere.eyebrow': {
    hu: 'III · Alsó légkör',
    en: 'III · Lower atmosphere',
    de: 'III · Untere Atmosphäre',
  },
  'lowerAtmosphere.altitude': {
    hu: '3 000 – 6 000 m',
    en: '3,000 – 6,000 m',
    de: '3.000 – 6.000 m',
  },
  'lowerAtmosphere.title.a': {
    hu: 'Hat terület,',
    en: 'Six areas,',
    de: 'Sechs Bereiche,',
  },
  'lowerAtmosphere.title.em': {
    hu: 'egy rendszer.',
    en: 'one system.',
    de: 'ein System.',
  },
  /*
   * SPLIT AT ITS OWN SENTENCE BOUNDARY, exactly as five other paragraphs in
   * this file already are, and for the reason §I1 of the master study gives:
   * the first sentence restates in twelve words what the 162px monument above
   * it says in four. The Act III frame carries `.b` alone; `.a` stays in the
   * act, under it, where a restatement is useful rather than redundant.
   *
   * Not one word is different from the string this replaces, in any locale.
   */
  'lowerAtmosphere.lead.a': {
    hu: 'Nem hat különálló szolgáltatás, amiből választani lehet.',
    en: 'Not six separate services to choose from.',
    de: 'Keine sechs einzelnen Leistungen zur Auswahl.',
  },
  'lowerAtmosphere.lead.b': {
    hu: 'Egy sorrend, amiben egymásra épülnek.',
    en: 'One sequence, in which each builds on the one before it.',
    de: 'Eine Reihenfolge, in der eines auf dem anderen aufbaut.',
  },

  // --- IV · 6 000–8 500 m — cloud entry ------------------------------------
  'cloudEntry.eyebrow': {
    hu: 'IV · Felhőréteg',
    en: 'IV · Cloud layer',
    de: 'IV · Wolkenschicht',
  },
  'cloudEntry.altitude': {
    hu: '6 000 – 8 500 m',
    en: '6,000 – 8,500 m',
    de: '6.000 – 8.500 m',
  },
  'cloudEntry.title.a': {
    hu: 'Idelent',
    en: 'Down here',
    de: 'Hier unten',
  },
  'cloudEntry.title.em': {
    hu: 'minden zajos.',
    en: 'everything is noisy.',
    de: 'ist alles laut.',
  },
  /**
   * Three symptoms and a verdict, printed as one paragraph.
   *
   * The three are parallel observations of the same failure and the fourth is
   * the conclusion drawn from them, so the three become annotations and the
   * conclusion joins the supporting line. Verbatim, in all three locales.
   */
  'cloudEntry.note.a': {
    hu: 'Öt ügynökség öt különböző dolgot mond.',
    en: 'Five agencies say five different things.',
    de: 'Fünf Agenturen sagen fünf verschiedene Dinge.',
  },
  'cloudEntry.note.b': {
    hu: 'A hirdetés más üzenetet visz, mint az oldal.',
    en: 'The advertising carries a different message from the website.',
    de: 'Die Werbung transportiert eine andere Botschaft als die Website.',
  },
  'cloudEntry.note.c': {
    hu: 'Az analitika mást mér, mint amit a vezetőség lát.',
    en: 'The analytics measure something other than what the management sees.',
    de: 'Die Analytics messen etwas anderes, als die Geschäftsführung sieht.',
  },
  'cloudEntry.note.d': {
    hu: 'Ez a réteg mindenkinek ugyanolyan sűrű.',
    en: 'This layer is equally dense for everyone.',
    de: 'Diese Schicht ist für alle gleich dicht.',
  },
  'cloudEntry.body.b': {
    hu: 'Nem a zaj a probléma, hanem hogy a legtöbb rendszer benne is marad. Aki fel akar jutni, annak előbb el kell döntenie, mit hagy el.',
    en: 'The noise is not the problem — the problem is that most systems stay inside it. Anyone who wants to get above it has to decide first what to leave behind.',
    de: 'Nicht der Lärm ist das Problem, sondern dass die meisten Systeme darin verharren. Wer nach oben will, muss zuerst entscheiden, was er zurücklässt.',
  },

  // --- V · 8 500–11 000 m — breakthrough -----------------------------------
  'cloudBreakthrough.eyebrow': {
    hu: 'V · Áttörés',
    en: 'V · Breakthrough',
    de: 'V · Durchbruch',
  },
  'cloudBreakthrough.altitude': {
    hu: '8 500 – 11 000 m',
    en: '8,500 – 11,000 m',
    de: '8.500 – 11.000 m',
  },
  'cloudBreakthrough.title.a': {
    hu: 'A tisztaság ott kezdődik, ahol minden digitális rendszered',
    en: 'Clarity begins where every one of your digital systems',
    de: 'Klarheit beginnt dort, wo sich alle Ihre digitalen Systeme',
  },
  'cloudBreakthrough.title.em': {
    hu: 'ugyanabba az irányba mozdul.',
    en: 'moves in the same direction.',
    de: 'in dieselbe Richtung bewegen.',
  },
  'cloudBreakthrough.lead': {
    hu: 'Nem több eszköz kell. Kevesebb, de egy irányba állítva.',
    en: 'You do not need more tools. Fewer, aligned in one direction.',
    de: 'Sie brauchen nicht mehr Werkzeuge. Weniger, aber in eine Richtung ausgerichtet.',
  },

  // --- VI · 11 000–17 000 m — selected work --------------------------------
  'selectedWork.eyebrow': {
    hu: 'VI · Munkáink',
    en: 'VI · Our work',
    de: 'VI · Unsere Arbeiten',
  },
  'selectedWork.altitude': {
    hu: '11 000 – 17 000 m',
    en: '11,000 – 17,000 m',
    de: '11.000 – 17.000 m',
  },
  'selectedWork.title.a': {
    hu: 'Akikkel',
    en: 'Those who',
    de: 'Mit ihnen sind wir',
  },
  'selectedWork.title.em': {
    hu: 'együtt emelkedtünk.',
    en: 'climbed with us.',
    de: 'gemeinsam aufgestiegen.',
  },
  'selectedWork.lead': {
    hu: 'Valódi ügyfelek, valódi élő rendszerekkel. Egy projektet emelünk ki itt; a többi a Munkáink oldalon van.',
    en: 'Real clients, with real systems in production. One project is featured here; the rest are on the work page.',
    de: 'Echte Kunden mit echten, laufenden Systemen. Ein Projekt steht hier im Mittelpunkt; die übrigen finden sich auf der Projektseite.',
  },
  // --- the collaboration rail -------------------------------------------------
  'collaborations.title': {
    hu: 'Együttműködések',
    en: 'Selected collaborations',
    de: 'Ausgewählte Kooperationen',
  },
  'collaborations.note': {
    hu: 'Nem mindegyikről van esettanulmány.',
    en: 'Not every one of them has a case study.',
    de: 'Nicht zu jeder davon gibt es eine Fallstudie.',
  },
  // --- the one featured case --------------------------------------------------
  'featured.label': {
    hu: 'Kiemelt eset',
    en: 'Featured case',
    de: 'Ausgewählter Fall',
  },
  'featured.cta.case': {
    hu: 'A Rapidkert esettanulmány',
    en: 'View the Rapidkert case study',
    de: 'Die Rapidkert-Fallstudie',
  },
  'featured.cta.work': {
    hu: 'Összes munkánk',
    en: 'Explore all work',
    de: 'Alle Projekte',
  },
  // The five terms of every case study's description list, in render order.
  'case.term.challenge': {
    hu: 'A helyzet',
    en: 'The situation',
    de: 'Die Ausgangslage',
  },
  'case.term.intervention': {
    hu: 'Amit tettünk',
    en: 'What we did',
    de: 'Was wir getan haben',
  },
  'case.term.implementation': {
    hu: 'Megvalósítás',
    en: 'Implementation',
    de: 'Umsetzung',
  },
  'case.term.result': {
    hu: 'Eredmény',
    en: 'Result',
    de: 'Ergebnis',
  },
  'case.term.ongoing': {
    hu: 'Azóta is',
    en: 'Ever since',
    de: 'Seitdem',
  },

  // --- VII · 17 000–22 000 m — the system ----------------------------------
  'system.eyebrow': {
    hu: 'VII · A rendszer',
    en: 'VII · The system',
    de: 'VII · Das System',
  },
  'system.altitude': {
    hu: '17 000 – 22 000 m',
    en: '17,000 – 22,000 m',
    de: '17.000 – 22.000 m',
  },
  'system.title.a': {
    hu: 'Kilenc terület,',
    en: 'Nine areas,',
    de: 'Neun Bereiche,',
  },
  'system.title.em': {
    hu: 'három rétegben.',
    en: 'in three layers.',
    de: 'in drei Schichten.',
  },
  /**
   * SPLIT AT ITS OWN SENTENCE BOUNDARY, and one half is retired with the object
   * it was a caption on.
   *
   * `.a` is `system.lead`'s first sentence and it points at a picture: "the
   * same thing is visible in the background — concentric layers, not a
   * network". The picture was `SystemRings`, three concentric rings and nine
   * nodes mounted in the 3D scene between 17 000 and 22 000 m, and the
   * continuity pass removes it — §6 names concentric circles and orbit
   * diagrams, and §45 forbids the background announcing a chapter, which is
   * exactly what a diagram that mounts at an altitude does.
   *
   * A sentence that describes a graphic which is no longer drawn is not
   * preserved content, it is a false statement about the page. It is left here
   * rather than deleted so the decision is auditable and reversible in one
   * line, and it is not rendered.
   *
   * `.b` is the second sentence, unchanged to the character, and it is the one
   * that carries the actual argument: the order is the point. It is the
   * passage's supporting line.
   *
   * Not one word of either sentence was rewritten, and this is the same
   * operation `lowerAtmosphere.lead` already had applied to it — a paragraph
   * split at a full stop so its two halves can be ranked differently.
   */
  'system.lead.a': {
    hu: 'A háttérben ugyanez látható: koncentrikus rétegek, nem hálózat.',
    en: 'The same thing is visible in the background: concentric layers, not a network.',
    de: 'Im Hintergrund ist dasselbe zu sehen: konzentrische Schichten, kein Netzwerk.',
  },
  'system.lead.b': {
    hu: 'A sorrend a lényeg, nem az, hogy kilenc van belőle.',
    en: 'The order is the point, not the fact that there are nine of them.',
    de: 'Es kommt auf die Reihenfolge an, nicht darauf, dass es neun sind.',
  },
  'system.ring.0.name': { hu: 'Mag', en: 'Core', de: 'Kern' },
  'system.ring.1.name': { hu: 'Szerkezet', en: 'Structure', de: 'Struktur' },
  'system.ring.2.name': { hu: 'Működés', en: 'Operation', de: 'Betrieb' },
  'system.ring.0.note': {
    hu: 'Ez dönti el a többit. Enélkül minden alatta lévő döntés találgatás.',
    en: 'This decides the rest. Without it, every decision below it is guesswork.',
    de: 'Er entscheidet über alles Weitere. Ohne ihn ist jede Entscheidung darunter Raterei.',
  },
  'system.ring.1.note': {
    hu: 'Amit a stratégia meghatároz, itt épül fel és itt kap formát.',
    en: 'What the strategy defines is built here, and takes its shape here.',
    de: 'Was die Strategie festlegt, wird hier aufgebaut und erhält hier seine Form.',
  },
  'system.ring.2.note': {
    hu: 'Ami csak akkor működik, ha a két belső réteg már a helyén van.',
    en: 'What only works once the two inner layers are already in place.',
    de: 'Was nur funktioniert, wenn die beiden inneren Schichten bereits stehen.',
  },

  // --- VIII · 22 000–25 500 m — the process --------------------------------
  'process.eyebrow': {
    hu: 'VIII · A folyamat',
    en: 'VIII · The process',
    de: 'VIII · Der Prozess',
  },
  'process.altitude': {
    hu: '22 000 – 25 500 m',
    en: '22,000 – 25,500 m',
    de: '22.000 – 25.500 m',
  },
  'process.title.a': {
    hu: 'Hét ellenőrzőpont,',
    en: 'Seven checkpoints,',
    de: 'Sieben Kontrollpunkte,',
  },
  'process.title.em': {
    hu: 'találgatás nélkül.',
    en: 'no guesswork.',
    de: 'ohne Raterei.',
  },
  /**
   * `process.lead` IS GONE FROM THE HOMEPAGE, AND IT WENT WHERE ITS SUBJECT WENT.
   *
   * It read `Minden ponton tudod, mi történik, mit kapsz tőlünk, mit várunk
   * tőled, és mi lesz az eredménye.` — a summary of the four terms, and the four
   * terms are exactly what phase 4 moved off this page. A sentence that
   * enumerates four things the page no longer shows is not a supporting thought,
   * it is a promise about somewhere else.
   *
   * It is now the lead of `05 · A folyamat` on the services route, verbatim in
   * all three locales, immediately above the seven checkpoints it describes.
   * `checkpoint.term.happens` / `.weProduce` / `.youProvide` / `.outcome` went
   * with it and are the four `<dt>`s of that section. Nothing was rewritten;
   * five strings changed address.
   *
   * `scripts/process-inventory.mjs` checks that they arrived.
   */

  /* --- the compressed passage — phase 4 -------------------------------------
   *
   * Three principles where there were thirty-five sentences, and every one of
   * them is selected or recombined from copy that was already approved rather
   * than authored fresh. §29 asks for exactly that, and §30 asks for the
   * derivation to be visible; each entry below names the checkpoint sentence it
   * comes from, and `_build/reports/luxury-art-direction/process/content-audit.md`
   * is the generated table of all thirty-five.
   *
   * WHY THESE THREE AND NOT THREE OTHERS — §10, §11.
   *
   * They are the three things the seven checkpoints argue that nothing else on
   * the homepage argues:
   *
   *   1. the first deliverable is written, and the answer may be no;
   *   2. every stage names what it asks of the client, and the work is visible
   *      while it happens rather than at the end;
   *   3. going live is the start of operation, not the end of a project.
   *
   * None of them is "we understand / we plan / we build", which §11 rejects by
   * name, and none of them repeats the System act. System argues that the nine
   * disciplines depend on each other in an order; that is capability
   * integration, and §23 keeps it separate from how a project runs. The one
   * checkpoint sentence that DID repeat it — `Egy irány, amelyhez minden
   * későbbi döntés mérhető.` against `A sorrend a lényeg` — is classified
   * redundant in the audit rather than compressed into a principle.
   */
  'process.principle.1.name': {
    // `— vagy egy korrekt nem.`, the tail of checkpoint 1's outcome, promoted
    // to the label. It is the most distinctive claim in the whole passage and
    // the only one no other page on the site makes.
    hu: 'Előbb a korrekt nem.',
    en: 'First, the honest no.',
    de: 'Zuerst das ehrliche Nein.',
  },
  'process.principle.1.line': {
    // Checkpoint 1's `weProduce`, verbatim in all three locales.
    hu: 'Írásos helyzetkép, és egy őszinte válasz arra, hogy tudunk-e segíteni.',
    en: 'A written assessment, and an honest answer on whether we can help.',
    de: 'Eine schriftliche Bestandsaufnahme und eine ehrliche Antwort darauf, ob wir helfen können.',
  },
  'process.principle.2.name': {
    // `checkpoint.term.youProvide`, verbatim. The term that was a column
    // heading is the principle now: the fourth column was the only part of the
    // grid that said something about the client rather than about us.
    hu: 'Amit tőled kérünk.',
    en: 'What we ask of you.',
    de: 'Was wir von Ihnen brauchen.',
  },
  'process.principle.2.line': {
    /*
     * THE FIRST CLAUSE WAS REPLACED IN PHASE 5.1, AND THE IDIOM IS WHY.
     *
     * It read `Minden szakasznak két oldala van` — "every stage has two sides"
     * — and the intended sense was the four-term grid's: every stage has a
     * column for us and a column for you. In Hungarian *"valaminek két oldala
     * van"* is a settled idiom for *"there are two sides to it"* in the sense
     * of PROS AND CONS, and that reading arrives first. §K of the temporal
     * report measured the ambiguity and offered three alternatives, all of
     * which answer the heading by naming the client's role and none of which
     * says that a stage is LOOKED AT from two sides; human review asked for the
     * second meaning explicitly and rejected the sentence as it stood.
     *
     * `Minden szakaszt két oldalról vizsgálunk` cannot take the idiom: the
     * idiom needs `van` and a possessor, and this is a transitive verb with an
     * adverbial. The literal reading is the only reading.
     *
     * The second clause is untouched — checkpoint 5's `happens`, verbatim minus
     * its opening `Megépítjük.`, in all three locales.
     *
     * COST, MEASURED, and it is the same cost every §K alternative carries:
     * one extra line on the GERMAN desktop, 1 → 2. Hungarian and English are
     * unchanged at one line on the desktop and two on both portrait shapes, and
     * German portrait is unchanged at three. That is German's length rather
     * than this phrasing — see
     * `_build/reports/luxury-art-direction/compression/clause.mjs`.
     *
     * WHAT THIS STILL DOES NOT DO, recorded rather than hidden: the heading
     * above it is `Amit tőled kérünk.` — "what we ask of you" — and a sentence
     * about how WE examine a stage answers it only by implicature (one of the
     * two sides is yours). The variant that says so outright —
     * `…két oldalról nézünk — a miénkről és a tiédről —…` — costs a line on
     * every surface and locale, which is why it is not here. It is measured in
     * the same file as candidate B, for human review.
     */
    hu: 'Minden szakaszt két oldalról vizsgálunk, és menet közben látod, nem a végén.',
    en: 'We look at every stage from two sides, and you see it as it goes, not at the end.',
    de: 'Wir betrachten jede Phase von zwei Seiten, und Sie sehen es währenddessen, nicht erst am Ende.',
  },
  'process.principle.3.name': {
    hu: 'Az indulás nem befejezés.',
    en: 'Launch is not the end.',
    de: 'Der Start ist kein Ende.',
  },
  'process.principle.3.line': {
    // Checkpoint 7's `happens` tail and its `outcome`, both verbatim, joined at
    // the em dash the passage's own idiom already uses.
    hu: 'Nem projektzárás, hanem üzemeltetés — a rendszer idővel jobb lesz, nem avul el.',
    en: 'Not project closure but operation — the system gets better over time rather than going out of date.',
    de: 'Kein Projektabschluss, sondern Betrieb — das System wird mit der Zeit besser, statt zu veralten.',
  },

  /**
   * THE SEVEN, NAMED, IN ONE LINE — and this is what keeps the statement true.
   *
   * `Hét ellenőrzőpont, / találgatás nélkül.` is unchanged, and a page that
   * says seven and then shows three principles has to say which seven. The
   * names are the seven `name` values from `content.ts`, joined; they are not
   * repeated here, because a second copy of them is a second copy to drift.
   * `FullAscent.tsx` and `MobileHome.tsx` compose the line from `PROCESS`, and
   * this key is only the punctuation around it.
   *
   * It is set as the passage's one support line, in running text, with commas
   * and a full stop. Not a rail of numerals, not a stepper, not seven boxes —
   * §15 and §19 both rule that out, and a sentence naming seven things is a
   * sentence.
   */
  'process.stages.separator': { hu: ', ', en: ', ', de: ', ' },
  'process.stages.end': { hu: '.', en: '.', de: '.' },

  /**
   * THE ONE ROUTE DEEPER — §3D, §20.
   *
   * Not a button, not yellow, and not `READ MORE`. It is the `act__routes`
   * treatment the Proof act already uses for its two ways out — editorial size,
   * editorial ink, a hairline under it — because §20 asks for existing Stratos
   * navigation conventions and this page has exactly one.
   *
   * The label names the destination rather than the action, which is how every
   * other route on this page is written (`A Rapidkert esettanulmány`, `Összes
   * munkánk`).
   */
  'process.cta.detail': {
    hu: 'A hét ellenőrzőpont részletesen',
    en: 'The seven checkpoints in detail',
    de: 'Die sieben Kontrollpunkte im Detail',
  },

  // --- IX · 25 500–28 000 m — transition -----------------------------------
  'stratosphereTransition.eyebrow': {
    hu: 'IX · Átmenet',
    en: 'IX · Transition',
    de: 'IX · Übergang',
  },
  'stratosphereTransition.altitude': {
    hu: '25 500 – 28 000 m',
    en: '25,500 – 28,000 m',
    de: '25.500 – 28.000 m',
  },
  'stratosphereTransition.title.a': {
    hu: 'Innen már',
    en: 'From here you can',
    de: 'Von hier aus ist',
  },
  'stratosphereTransition.title.em': {
    hu: 'látni a görbületet.',
    en: 'see the curvature.',
    de: 'die Krümmung zu sehen.',
  },
  /**
   * A physical fact and what follows from it. The fact is an altitude
   * annotation — it is the only sentence on the page that states a measurement
   * about the atmosphere — and the consequence reads with it rather than under
   * it. Verbatim, in all three locales.
   */
  'stratosphereTransition.note.a': {
    hu: 'Ebben a magasságban a levegő nyolcvan százaléka alattad van.',
    en: 'At this altitude eighty per cent of the air is below you.',
    de: 'In dieser Höhe liegen achtzig Prozent der Luft unter Ihnen.',
  },
  'stratosphereTransition.note.b': {
    hu: 'Kevesebb a zaj, messzebb ellátni, és ami eddig hatalmasnak tűnt, arányba kerül.',
    en: 'There is less noise, you can see further, and what looked enormous until now falls into proportion.',
    de: 'Es ist weniger laut, die Sicht reicht weiter, und was bisher gewaltig wirkte, kommt ins Verhältnis.',
  },
  'stratosphereTransition.body.b': {
    hu: 'Üzletileg ugyanez történik: amikor a rendszer működik, a napi tűzoltás helyét átveszi a döntés arról, merre tovább.',
    en: 'The same thing happens commercially: once the system works, daily firefighting gives way to deciding where to go next.',
    de: 'Geschäftlich geschieht dasselbe: Sobald das System funktioniert, tritt an die Stelle des täglichen Feuerlöschens die Entscheidung, wohin es weitergeht.',
  },

  // --- X · 28 000–30 000 m — full stratosphere -----------------------------
  'fullStratosphere.eyebrow': {
    hu: 'X · Sztratoszféra',
    en: 'X · Stratosphere',
    de: 'X · Stratosphäre',
  },
  'fullStratosphere.altitude': {
    hu: '28 000 – 30 000 m',
    en: '28,000 – 30,000 m',
    de: '28.000 – 30.000 m',
  },
  'fullStratosphere.title.a': {
    hu: 'Üdv a',
    en: 'Welcome to the',
    de: 'Willkommen in der',
  },
  'fullStratosphere.title.em': {
    hu: 'sztratoszférában.',
    en: 'stratosphere.',
    de: 'Stratosphäre.',
  },
  'fullStratosphere.lead': {
    hu: 'Itt az ambiciózus vállalkozások már nem a figyelemért versenyeznek. Meghatározzák a kategóriát, amelyben mindenki más versenyezni fog.',
    en: 'Up here, ambitious businesses no longer compete for attention. They define the category everyone else will compete in.',
    de: 'Hier oben konkurrieren ambitionierte Unternehmen nicht mehr um Aufmerksamkeit. Sie definieren die Kategorie, in der alle anderen konkurrieren werden.',
  },

  /* =========================================================== THE HORIZON

     One authored fragment per chapter — the chapter's own claim, distilled to a
     word, shown in the frames where its statement cannot yet be.

     ## What it fills, and why the obvious fill was the wrong one

     §4 and §H of the direction name the same fault: stretches of the ascent that
     carried nothing. Measured across the track at 1440×900 there were five,
     the longest running 9 500 → 11 500 m.

     They are not chapter tails, which is what the first attempt assumed. They
     are CROSSINGS. At a stage boundary the instrument changes rail, and the
     incoming statement is held back until the dial has cleared the column's own
     width — `leadPresence`, and it is right to hold it, because §8 rules out two
     statements legible in the same frame. What was missing is that nothing stood
     in for it while it waited.

     So the fragment is not a preview printed by the outgoing chapter. It is the
     incoming chapter's own word, and its presence is exactly `1 − the presence
     of its own statement`: it resolves as the statement yields and it is gone
     the instant the statement arrives. Two things can never be legible at once
     because they are one quantity read twice.

     ## Why they are one or two words

     Because a fragment that grew into a sentence would be the second statement
     §8 forbids. One word is an anticipation; a sentence is a chapter.

     ## Not translated freely

     Each is lifted from its own chapter's title, eyebrow or first annotation in
     the same locale, so the word seen in the dark and the statement read a
     moment later are the same word.

     The opening chapter has none. There is no crossing before it — the visitor
     arrives at 0 m with the statement already resolved — so there is nothing for
     one to stand in for. */
  /*
   * `initial-ascent` and `cloud-entry` exchanged their statements when the six
   * acts were mapped onto the altitude ladder (see `acts.ts`), so their
   * fragments exchanged with them: a fragment is lifted from its own chapter's
   * title, and following the title is what keeps that true.
   */
  'horizon.initial-ascent': {
    hu: 'Zaj.',
    en: 'Noise.',
    de: 'Lärm.',
  },
  'horizon.lower-atmosphere': {
    hu: 'Hat terület.',
    en: 'Six areas.',
    de: 'Sechs Bereiche.',
  },
  'horizon.cloud-entry': {
    hu: 'Egy alkatrész.',
    en: 'One component.',
    de: 'Ein Bauteil.',
  },
  'horizon.cloud-breakthrough': {
    hu: 'Tisztaság.',
    en: 'Clarity.',
    de: 'Klarheit.',
  },
  'horizon.selected-work': {
    hu: 'Bizonyíték.',
    en: 'Proof.',
    de: 'Belege.',
  },
  'horizon.system': {
    hu: 'Kilenc terület.',
    en: 'Nine areas.',
    de: 'Neun Bereiche.',
  },
  'horizon.process': {
    hu: 'Hét pont.',
    en: 'Seven points.',
    de: 'Sieben Punkte.',
  },
  'horizon.stratosphere-transition': {
    hu: 'A görbület.',
    en: 'The curvature.',
    de: 'Die Krümmung.',
  },
  'horizon.full-stratosphere': {
    hu: 'Sztratoszféra.',
    en: 'Stratosphere.',
    de: 'Stratosphäre.',
  },
  'horizon.destination': {
    hu: 'Célmagasság.',
    en: 'Target altitude.',
    de: 'Zielhöhe.',
  },

  // --- XI · 30 000 m — destination -----------------------------------------
  'destination.eyebrow': {
    hu: 'XI · Célmagasság',
    en: 'XI · Target altitude',
    de: 'XI · Zielhöhe',
  },
  'destination.altitude': {
    hu: '30 000 m',
    en: '30,000 m',
    de: '30.000 m',
  },
  'destination.title.a': {
    hu: 'Készen állsz',
    en: 'Are you ready to',
    de: 'Sind Sie bereit',
  },
  'destination.title.em': {
    hu: 'felemelkedni?',
    en: 'ascend?',
    de: 'aufzusteigen?',
  },
  'destination.lead': {
    hu: 'Egy beszélgetéssel kezdődik. Megnézzük, hol tartasz, és őszintén megmondjuk, tudunk-e segíteni — akkor is, ha a válasz nem.',
    en: 'It starts with a conversation. We look at where you stand and tell you honestly whether we can help — including when the answer is no.',
    de: 'Es beginnt mit einem Gespräch. Wir sehen uns an, wo Sie stehen, und sagen Ihnen ehrlich, ob wir helfen können — auch dann, wenn die Antwort Nein lautet.',
  },
  'destination.cta.work': {
    hu: 'Munkáink megtekintése',
    en: 'View our work',
    de: 'Unsere Arbeiten ansehen',
  },

  /*
   * The closing sentence, in the five fragments its two inline links split it
   * into: `a` + <a>{link.contact}</a> + `b` + <a>{link.quote}</a> + `c`.
   *
   * Split this way rather than as one string with placeholders because the
   * whole sentence has to stay one readable sentence in each language while the
   * anchors keep their own text. The German avoids `ausfüllen` deliberately:
   * a separable verb would strand `aus` at the start of fragment `c`, after the
   * link, where a translator editing `c` could not see why it was there.
   */
  'destination.contact.a': {
    hu: 'Inkább kérdeznél előbb?',
    en: 'Would you rather ask first?',
    de: 'Möchten Sie lieber zuerst fragen?',
  },
  'destination.contact.link.contact': {
    hu: 'Írj nekünk',
    en: 'Write to us',
    de: 'Schreiben Sie uns',
  },
  'destination.contact.b': {
    hu: '— vagy töltsd ki a',
    en: '— or answer the',
    de: '— oder beantworten Sie den',
  },
  'destination.contact.link.quote': {
    hu: 'rövid kérdőívet',
    en: 'short questionnaire',
    de: 'kurzen Fragebogen',
  },
  'destination.contact.c': {
    hu: ', és konkrét javaslattal jelentkezünk.',
    en: ', and we will come back with a concrete proposal.',
    de: ', und wir melden uns mit einem konkreten Vorschlag.',
  },
  'destination.stages.label': {
    hu: 'A bejárt magasságok',
    en: 'The altitudes covered',
    de: 'Die zurückgelegten Höhen',
  },

  /*
   * --- footer -------------------------------------------------------------
   *
   * Gone, with the footer it named.
   *
   * The homepage used to end in a line of seven links and a locale switch,
   * built in this bundle because this route began life as a prototype with no
   * site around it. It now renders the site's own Arrival and ground-control
   * footer — the same markup, from the same `_build/build.py`, in the same
   * three locales as the other 66 routes — so those ten strings are the
   * generator's again, in `_build/i18n/`, and there is one copy of each
   * instead of two that had to be kept saying the same thing.
   *
   * `common.languageSwitch` above stays. It is the accessible name of the
   * locale switcher and it is the generator's `lang_aria`, word for word.
   */

  /*
   * --- the eleven journey stages ------------------------------------------
   *
   * The HUD's stage readout, and the link text in the destination panel's list
   * of altitudes already passed. Same wording as the matching panel eyebrow
   * without its roman numeral, because they name the same stage and reading
   * two different names for it is how a visitor concludes they are two things.
   */
  'stage.calibration': { hu: 'Kalibráció', en: 'Calibration', de: 'Kalibrierung' },
  'stage.initial-ascent': { hu: 'Emelkedés', en: 'Ascent', de: 'Aufstieg' },
  'stage.lower-atmosphere': { hu: 'Alsó légkör', en: 'Lower atmosphere', de: 'Untere Atmosphäre' },
  'stage.cloud-entry': { hu: 'Felhőréteg', en: 'Cloud layer', de: 'Wolkenschicht' },
  'stage.cloud-breakthrough': { hu: 'Áttörés', en: 'Breakthrough', de: 'Durchbruch' },
  'stage.selected-work': { hu: 'Munkáink', en: 'Our work', de: 'Unsere Arbeiten' },
  'stage.system': { hu: 'Rendszer', en: 'System', de: 'System' },
  'stage.process': { hu: 'Folyamat', en: 'Process', de: 'Prozess' },
  'stage.stratosphere-transition': { hu: 'Átmenet', en: 'Transition', de: 'Übergang' },
  'stage.full-stratosphere': { hu: 'Sztratoszféra', en: 'Stratosphere', de: 'Stratosphäre' },
  'stage.destination': { hu: 'Célmagasság', en: 'Target altitude', de: 'Zielhöhe' },

  /*
   * --- the readout ---------------------------------------------------------
   *
   * `hud.metres` is the spelled-out unit used in the two live regions, not the
   * `m` symbol next to the digits — that one is an SI symbol, identical in all
   * three languages, and `aria-hidden` besides.
   */
  'hud.metres': { hu: 'méter', en: 'metres', de: 'Meter' },
  'hud.sound.on': {
    hu: 'Műszerhangok bekapcsolása',
    en: 'Turn instrument sounds on',
    de: 'Instrumententöne einschalten',
  },
  'hud.sound.off': {
    hu: 'Műszerhangok kikapcsolása',
    en: 'Turn instrument sounds off',
    de: 'Instrumententöne ausschalten',
  },
  // Split around the ceiling figure, which `formatAltitude` groups per locale.
  'hud.description.a': {
    hu: 'Görgetéssel vezérelt emelkedés a földi szinttől',
    en: 'Scroll-driven ascent from ground level to',
    de: 'Scrollgesteuerter Aufstieg von der Bodenhöhe bis',
  },
  'hud.description.b': {
    hu: 'méterig. A magasságmérő értéke a görgetés helyzetét követi. Az oldal minden tartalma — a bemutatott munkák, a folyamat lépései és a kapcsolatfelvétel — görgetéstől és a 3D jelenettől függetlenül olvasható.',
    en: 'metres. The altimeter reading follows the scroll position. Everything on the page — the work shown, the steps of the process and the contact details — can be read independently of scrolling and of the 3D scene.',
    de: 'Meter. Der Wert des Höhenmessers folgt der Scrollposition. Alle Inhalte der Seite — die gezeigten Arbeiten, die Schritte des Prozesses und die Kontaktaufnahme — sind unabhängig vom Scrollen und von der 3D-Szene lesbar.',
  },

  // --- the static instrument ----------------------------------------------
  // One note per reason the 3D scene is not running. Keyed on the reason, which
  // is the same union `JourneyFallback` takes as a prop.
  'fallback.note.reduced-motion': {
    hu: 'Csökkentett mozgás bekapcsolva — a műszer állóképes változatát látod. Az alábbi gombokkal végigléptethetők a szerkezeti állapotok; semmi nem mozog magától.',
    en: 'Reduced motion is on — you are seeing the still version of the instrument. The buttons below step through its structural states; nothing moves on its own.',
    de: 'Reduzierte Bewegung ist aktiv — Sie sehen die unbewegte Fassung des Instruments. Mit den Schaltflächen unten lassen sich die strukturellen Zustände durchschalten; nichts bewegt sich von selbst.',
  },
  'fallback.note.no-webgl': {
    hu: 'Ez a böngésző nem tud 3D-t megjeleníteni — a műszer állóképes változatát látod, a magasságot követve.',
    en: 'This browser cannot display 3D — you are seeing the still version of the instrument, following the altitude.',
    de: 'Dieser Browser kann kein 3D darstellen — Sie sehen die unbewegte Fassung des Instruments, der Höhe folgend.',
  },
  'fallback.note.low-capability': {
    hu: 'Az eszköz teljesítménye alapján az állóképes változatot mutatjuk.',
    en: 'Based on the performance of this device we are showing the still version.',
    de: 'Aufgrund der Leistung dieses Geräts zeigen wir die unbewegte Fassung.',
  },
  'fallback.note.context-lost': {
    hu: 'A 3D megjelenítés megszakadt — a műszer állóképes változatát látod.',
    en: 'The 3D rendering was interrupted — you are seeing the still version of the instrument.',
    de: 'Die 3D-Darstellung wurde unterbrochen — Sie sehen die unbewegte Fassung des Instruments.',
  },
  'fallback.states.label': {
    hu: 'A műszer szerkezeti állapotai',
    en: 'The structural states of the instrument',
    de: 'Die strukturellen Zustände des Instruments',
  },

  /*
   * The drawing's accessible name, as the two fragments that surround the state
   * label: "Stratos Altimeter Meridian, <state> állapotban".
   *
   * Two fragments rather than one string with the label appended, because the
   * qualifier sits on the other side of the label in German — "Zustand
   * Grundstellung", not "Grundstellung Zustand". An empty `post` is expected
   * there and the caller drops it; the product name itself is not translated.
   */
  'fallback.dial.pre': {
    hu: 'Stratos Altimeter Meridian,',
    en: 'Stratos Altimeter Meridian,',
    de: 'Stratos Altimeter Meridian, Zustand',
  },
  'fallback.dial.post': { hu: 'állapotban', en: 'state', de: '' },

  /*
   * --- the six Meridian states ---------------------------------------------
   *
   * The label names the state; the description is the sentence the live region
   * announces when the instrument reaches it, and the caption the static
   * fallback prints under the drawing. Six announcements over the whole
   * journey, so these are read in full rather than skimmed — they are written
   * as complete sentences in all three languages, not as labels.
   */
  'meridian.baseline.label': { hu: 'Alapállapot', en: 'Baseline', de: 'Grundstellung' },
  'meridian.baseline.description': {
    hu: 'A műszer zárt alapállapotban. A rekesz kalibrált résre húzva, mindhárom gyűrű még a számlap síkjában.',
    en: 'The instrument in its closed baseline state. The aperture is drawn to a calibrated slit, all three rings still in the plane of the dial.',
    de: 'Das Instrument in geschlossener Grundstellung. Die Blende ist auf einen kalibrierten Spalt gezogen, alle drei Ringe noch in der Ebene des Zifferblatts.',
  },
  'meridian.first-ring.label': { hu: 'Első gyűrű', en: 'First ring', de: 'Erster Ring' },
  'meridian.first-ring.description': {
    hu: 'A külső magassági skála kiemelkedett a számlapból, megdőlt és a helyére záródott. A számlap és a mutató változatlanul olvasható.',
    en: 'The outer altitude scale has risen out of the dial, tilted, and locked into place. The dial and the needle remain just as readable.',
    de: 'Die äußere Höhenskala hat sich aus dem Zifferblatt gehoben, geneigt und ist eingerastet. Zifferblatt und Zeiger bleiben unverändert ablesbar.',
  },
  'meridian.aperture-open.label': {
    hu: 'Rekesznyitás',
    en: 'Aperture opening',
    de: 'Blendenöffnung',
  },
  'meridian.aperture-open.description': {
    hu: 'A rekesz lamellái teljesen kinyíltak, a középpont kitisztult, a burkolat éleit határozott fény rajzolja ki.',
    en: 'The aperture blades have opened fully, the centre has cleared, and a hard light picks out the edges of the housing.',
    de: 'Die Blendenlamellen sind vollständig geöffnet, das Zentrum ist frei, und ein hartes Licht zeichnet die Kanten des Gehäuses nach.',
  },
  'meridian.second-ring.label': { hu: 'Második gyűrű', en: 'Second ring', de: 'Zweiter Ring' },
  'meridian.second-ring.description': {
    hu: 'A belső kalibrációs skála is kiemelkedett, és az elsőtől eltérő tengelyre záródott. A műszer két tengely mentén stabilizál.',
    en: 'The inner calibration scale has risen as well, and locked onto a different axis from the first. The instrument now stabilises along two axes.',
    de: 'Auch die innere Kalibrierskala hat sich gehoben und ist auf einer anderen Achse als die erste eingerastet. Das Instrument stabilisiert nun entlang zweier Achsen.',
  },
  'meridian.third-ring.label': { hu: 'Harmadik gyűrű', en: 'Third ring', de: 'Dritter Ring' },
  'meridian.third-ring.description': {
    hu: 'A hátsó szerkezeti keret levált a burkolatról és a legnagyobb, leglassabb gyűrűként állt a helyére. A rekesz a pontos, kalibrált értékre záródott vissza.',
    en: 'The rear structural frame has separated from the housing and settled into place as the largest, slowest ring. The aperture has closed back to its precise, calibrated value.',
    de: 'Der hintere Strukturrahmen hat sich vom Gehäuse gelöst und ist als größter, langsamster Ring eingerastet. Die Blende hat sich wieder auf ihren genauen, kalibrierten Wert geschlossen.',
  },
  'meridian.meridian.label': { hu: 'Meridián', en: 'Meridian', de: 'Meridian' },
  'meridian.meridian.description': {
    hu: 'A teljes műszer: eredeti magasságmérő ház, olvasható skála, mutató, rögzített központi tengely, kalibrált rekesz és három térbeli gyűrű, összehangolt lassú mozgásban.',
    en: 'The complete instrument: the original altimeter housing, a readable scale, the needle, a fixed central axis, a calibrated aperture and three spatial rings, in slow coordinated motion.',
    de: 'Das vollständige Instrument: ursprüngliches Höhenmessergehäuse, ablesbare Skala, Zeiger, feste Mittelachse, kalibrierte Blende und drei räumliche Ringe in langsam abgestimmter Bewegung.',
  },
} as const satisfies Record<string, Message>;

export type MessageKey = keyof typeof MESSAGES;

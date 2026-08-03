# Stratos — szerkesztési útmutató (magyar)

> Ez az eredeti README, változatlanul. A publikus oldal generálásáról és a
> designrendszerről szól — ez maradt az érvényes leírás a tartalom
> szerkesztéséhez. A projekt egészéről (portál, Supabase, deploy) a gyökérben
> lévő angol `README.md` szól.


Statikus, függőség nélküli oldal. Nincs build lépés a kiszolgáláshoz: a gyökérben lévő
`.html` fájlokat bármelyik tárhelyre fel lehet tölteni.

## Futtatás helyben

```bash
python3 -m http.server 4321
```

Aztán: `http://localhost:4321`

## Szerkezet

```
index.html … impresszum.html   ← a magyar oldalak (generált, ne itt szerkeszd)
en/*.html, de/*.html           ← az angol és német oldalak (szintén generált)
assets/css/main.css            ← minden stílus
assets/js/main.js              ← minden interakció (nincs külső library)
assets/img/                    ← képek a régi oldalról
_build/build.py                ← oldalgenerátor
_build/i18n.py                 ← a fordítómotor
_build/pages/*.html            ← ITT szerkeszd a tartalmat (magyarul)
_build/i18n/*.json             ← ITT szerkeszd a fordításokat
```

A fejléc, a menü, a lábléc és a `<head>` egy helyen él: `_build/build.py`.
A 12 oldal tartalma a `_build/pages/` alatt van, mindegyik fájl elején egy rövid fejléccel:

```
title: …
desc: …
ceiling: 30000     ← meddig másszon a magasságmérő ezen az oldalon
footer: no         ← opcionális; elhagyja a láblécet (a kérdőív használja)
---
<a törzs HTML-je>
```

Szerkesztés után:

```bash
python3 _build/build.py
```

## Három nyelv

A magyar a forrásnyelv: a HTML **egyetlen** példányban létezik, a
`_build/pages/` alatt. Az angol és a német ugyanabból a markupból készül, csak a
szövegeket cseréljük ki — így az SVG-animációk, a kérdőív logikája és a layout
nem triplázódik.

| | magyar | angol | német |
|---|---|---|---|
| hely | `/` | `/en/` | `/de/` |
| pl. Rólunk | `rolunk.html` | `en/about.html` | `de/ueber-uns.html` |

- **URL-ek**: a fordított slugokat a `_build/build.py` `SLUGS` táblája tartja.
  A fragmentekben elég a magyar fájlnévre linkelni (`href="kkv.html"`), a
  generátor átírja a célnyelvre.
- **Fordítások**: `_build/i18n/*.json`, oldalanként egy fájl. Formátum:
  `"magyar szöveg": ["english", "deutsch"]`. Ha egy kulcs hiányzik, az adott
  szöveg magyarul marad, és a build ír egy `_build/missing-en.json`-t —
  törött oldal soha nem keletkezik.
- **Fejléc, lábléc, gombok, magasságmérő**: nem fordítófájlban, hanem a
  `build.py` `UI` szótárában (ott van a nyelvváltó, a légköri rétegek neve és a
  számformátum is).
- **A JS**: az `assets/js/main.js` nyelvfüggetlen; a szövegeket a `<script
  id="i18n">` JSON-blokkból olvassa, amit a generátor ír bele.
- **SEO**: minden oldal kap `hreflang` alternatívákat és `x-default`-ot
  a magyarra.
- **Jogi oldalak**: az `en`/`de` verzió tetején figyelmeztetés áll, hogy a
  magyar szöveg a kötelező érvényű (`<!--legal-note-->` a fragmentben).

Új nyelv hozzáadása: egy oszlop a `SLUGS`-ban, egy blokk a `UI`-ban, és egy
harmadik elem a JSON-tömbökben.

## Designrendszer

| Token | Érték | Honnan |
|---|---|---|
| `--void` | `#000000` | régi oldal háttere |
| `--signal` | `#FFEE25` | a márka sárgája |
| `--chrome` | `#CBDCE9` | a logó króm papírrepülőjének csúcsfénye |
| `--paper` | `#F4F4F4` | régi oldal világos sávja |
| `--haze` | `#757575` | régi oldal szürkéje |

Betűk: **Aboreto** (display, a régi oldalról), **Instrument Sans** (kenyérszöveg),
**JetBrains Mono** (adat, címkék, gombok).

### A vezérgondolat

A Stratos név a sztratoszférából ered, és a régi oldal saját mondata szerint
„a versenytársak még a földön járnak". Ezt az oldal szó szerint méri:

- **Magasságmérő sáv** a bal szélen (mobilon alul) — valódi repülőgép-magasságmérő
  szalag, ami görgetésre méterben számol, és jelzi a légköri réteget
  (troposzféra → sztratoszféra → mezoszféra). Nem dísz: ez a haladásjelző.
- **A kurzor maga a logó** — a króm papírrepülő a mozgás irányába fordul, sárga
  kondenzcsíkot húz. Érintőképernyőn és `prefers-reduced-motion` esetén kikapcsol.
- A szolgáltatások vízszintesen görgő „emelkedési szakaszok", mindegyik saját
  magassággal — ugyanaz a skála, mint a menü legördülőjében.

## Kérdőív (`arajanlat.html`)

A megadott wizard beépítve: kérdésenként egy képernyő, a 2. kérdésnél szegmentálás
(KKV ág 33 kérdés, nagyvállalati ág 23), `Enter`-rel léptethető, beküldés a saját
**`POST /api/lead`** végpontra. A kérdéssor és az elágazások változatlanok.

Két dolgot igazítottam a többi oldalhoz:

- a stílus a site tokenjeit használja (éles sarkok a lekerekítettek helyett,
  olvasható kenyérbetű a válaszlehetőségeken) — ha a lekerekített változat kell,
  a `.quiz` blokk a `main.css`-ben egy helyen átírható;
- a magasságmérő itt **a kérdőív haladását** mutatja, nem a görgetést, így a
  kitöltés végére ér fel a sztratoszférába.

### Az összes űrlap éles

A kapcsolati űrlap, az Impact Program jelentkezés, a hírlevél-mezők és a kérdőív
mind **ugyanarra a `POST /api/lead` végpontra** küldenek, ami a Supabase `leads`
táblájába ír. Nincs többé harmadik fél és nincs a böngészőben kulcs.

Az űrlapot a `data-lead` attribútum kapcsolja be — az értéke egyben a lead
`source` oszlopa is:

| `data-lead` | Hol |
|---|---|
| `newsletter` | hírlevél-mezők (lábléc, nyitóoldal, blog) |
| `contact` | ügyfélszolgálati űrlap |
| `impact` | Impact Program jelentkezés |
| `questionnaire` | kérdőív (a saját scriptjéből küld) |

Új mező felvételekor a leképezést egy helyen kell bővíteni: `MAPPERS` az
`assets/js/main.js`-ben. Aminek nincs saját oszlopa a `leads` táblában, az
címkézve a `message` mezőbe kerül, tehát semmi nem vész el.

Minden űrlapban van egy rejtett `company_website` mező (`.hp`) — ez a
mézesbödön, ember soha nem látja. Ne töröld, és ne tedd láthatóvá.

## Élesítés előtt nézd át

1. **Impresszum / adatkezelési tájékoztató** — a tárhelyszolgáltatónál most még a
   Wix szerepel (a régi oldal szövege). Ha máshová kerül az oldal, ezt a két helyen
   írd át: `_build/pages/impresszum.html` és `_build/pages/adatkezelesi-tajekoztato.html`.
2. **Közösségi linkek** — a lábléc `linkedin.com` / `instagram.com` / `facebook.com`
   gyökérre mutat, mert a régi oldalon nem volt kiolvasható a konkrét profil URL.
   Ezt a `_build/build.py` láblécében cseréld.
3. **Blogcikkek** — a 6 cikk címe, leírása és borítóképe a régi oldal RSS-éből jött,
   de a cikkek törzse még nincs átemelve; a kártyák egyelőre a bloglistára mutatnak.
4. **Cookie-banner** — a régiben Usercentrics futott, ide nem került be. Ha marad a
   Google/Meta követés, kell egy consent megoldás.
5. **Képek** — minden kép a régi oldalról származik és le van kicsinyítve 1800px-re.
   A csapatfotók telefonos képek; ha van jobb, cseréld (`assets/img/team-*`).

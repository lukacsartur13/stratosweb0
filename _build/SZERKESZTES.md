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
css: build         ← opcionális; betölti az assets/css/page-build.css-t
footer: no         ← opcionális; elhagyja a láblécet és a záró jelenetet (a kérdőív használja)
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
- **Fejléc, lábléc, gombok, záró jelenet**: nem fordítófájlban, hanem a
  `build.py` `UI` és `V2_UI` szótárában (ott van a nyelvváltó is).
- **A JS**: az `assets/js/lead.js` nyelvfüggetlen; a szövegeket a `<script
  id="i18n">` JSON-blokkból olvassa, amit a generátor ír bele.
- **SEO**: minden oldal kap `hreflang` alternatívákat és `x-default`-ot
  a magyarra.
- **Jogi oldalak**: az `en`/`de` verzió tetején figyelmeztetés áll, hogy a
  magyar szöveg a kötelező érvényű (`<!--legal-note-->` a fragmentben).

Új nyelv hozzáadása: egy oszlop a `SLUGS`-ban, egy blokk a `UI`-ban, és egy
harmadik elem a JSON-tömbökben.

## Designrendszer

2026 októberétől az oldal világos, tipográfiára épülő rendszert használ
(„Soft Machinery"). A teljes leírás: `_build/reports/stratos-redesign/02-design-system.md`.

| Token | Érték | Mire |
|---|---|---|
| `--c-bg` | `#F3F2EE` | meleg papír — az alapfelület |
| `--c-surface` | `#FAFAF8` | kiemelt felület (kártyák, mezők) |
| `--c-ink` | `#141413` | szöveg, elsődleges gomb |
| `--c-ink-2` | `#5A5954` | másodlagos szöveg |
| `--c-ink-3` | `#8A8983` | csak nagy címek „sötétített" része |
| `--c-dark` | `#1B1B1A` | grafit — egy oldal egyetlen sötét pillanata (záró jelenet) |
| `--c-signal` | `#FFEE25` | a márka sárgája — csak kijelölés, fókusz sötéten, egy „jelzőfény" |

Betűk: **Archivo** (címek és szöveg, mondatkezdő írásmóddal), **Aboreto** (csak a logó).

Fájlok: `assets/css/system.css` (rendszer), `site.css` (az aloldalak közös
szókincse: `.phead`, `.band`, `.card`, `.faq`, `.launch`…), `home.css` (főoldal),
`page-*.css` (oldalspecifikus). Viselkedés: `assets/js/shell.js`.

Szabályok röviden:

- **A kiemelés fény, nem szín.** Egy címben a `<span class="sig">` rész a „megvilágított":
  a cím többi része halványabb, a kiemelt rész teljes fekete.
- **Egy oldal egyetlen sötét pillanata a záró jelenet.** A `.launch` csak akkor sötét,
  ha az oldal utolsó szekciójában van; máskor világos felület. Ha az oldal nem
  ilyen launch-csal zárul, a generátor hozzáad egy közös záró jelenetet (`CLOSE_V2`).
- **Nincs görgetésre mozgó elem.** A korábbi rögzített szakaszok (`data-stage`,
  `data-rail`) statikusan, egymás alatt jelennek meg; a magasságmérő, a kurzor és a
  kondenzcsík megszűnt.

## Kérdőív (`arajanlat.html`)

A megadott wizard beépítve: kérdésenként egy képernyő, a 2. kérdésnél szegmentálás
(KKV ág 33 kérdés, nagyvállalati ág 23), `Enter`-rel léptethető, beküldés a saját
**`POST /api/lead`** végpontra. A kérdéssor és az elágazások változatlanok.

Két dolgot igazítottam a többi oldalhoz:

- a stílus a rendszer tokenjeit használja (lekerekített válaszlehetőségek,
  olvasható kenyérbetű) — a `.quiz` blokk a `site.css`-ben egy helyen átírható;
- a haladást a lap tetején egy vékony sáv és kérdésenként egy pont mutatja.

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

1. **Impresszum / adatkezelési tájékoztató** — a tárhelyszolgáltatónál korábban a
   Wix szerepelt (a régi oldal szövege). Most a tényleges felállás áll bennük:
   a **Netlify** szolgálja ki az oldalt és a kiszolgálói funkciókat, a **Supabase**
   tárolja az űrlapokon beérkező adatokat és szolgálja ki a zárt Portált. Ha
   máshová kerül az oldal, ezt a két helyen írd át:
   `_build/pages/impresszum.html` és `_build/pages/adatkezelesi-tajekoztato.html`.
2. **Közösségi linkek** — a lábléc `linkedin.com` / `instagram.com` / `facebook.com`
   gyökérre mutat, mert a régi oldalon nem volt kiolvasható a konkrét profil URL.
   Ezt a `_build/build.py` láblécében cseréld.
3. **Blogcikkek** — a 6 cikk címe, leírása és borítóképe a régi oldal RSS-éből jött,
   de a cikkek törzse még nincs átemelve; a kártyák egyelőre a bloglistára mutatnak.
4. **Cookie-banner** — a régiben Usercentrics futott, ide nem került be. Ha marad a
   Google/Meta követés, kell egy consent megoldás.
5. **Képek** — minden kép a régi oldalról származik és le van kicsinyítve 1800px-re.
   A csapatfotók telefonos képek; ha van jobb, cseréld (`assets/img/team-*`).

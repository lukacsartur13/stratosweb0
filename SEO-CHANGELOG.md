# SEO-változások — 2026-09-21

A Google Search Console 2026-06-19 → 09-18 közötti adatai alapján. Öt commit,
mindegyik külön visszavonható.

| commit | mit csinál |
|---|---|
| `24444fe` | három redirect szabály, ami sosem tüzelt |
| `07e7bb1` | /keresooptimalizalas és /hirdeteskezeles on-page szerkezete |
| `fdf4aa5` | /webshop-keszites és /branding H1-je |
| `922be05` | helyi jelzés: `areaServed` + NAP a footerben |
| `9891e24` | a „google első oldal” cikk EN/DE változatának noindexe — **ez a visszavonható döntés** |

---

## Amit a diagnózisból meg kellett fordítani

**A www/non-www átirányítás nem hiányzik.** Él, egy ugrás, path és query
megőrizve:

```
https://www.stratosweb.hu/rolunk   301 ->  https://stratosweb.hu/rolunk
http://stratosweb.hu/              301 ->  https://stratosweb.hu/
```

A GSC-ben azért szerepel külön a két hoszt, mert a jelentés ablaka **átnyúlik a
Wix-migráción**. A site 2026-08-09 körül került a Netlify-ra; a június–augusztusi
www-sorok a Wix-korszakból valók, és nem fognak újratermelődni. Nincs mit javítani.

**Ami tényleg el volt romolva:** a `netlify.toml`-ban három `/index.html → /`
301-szabály van, és egyik sem tüzelt soha. A Netlify a létező fájlra mutató
redirect szabályt figyelmen kívül hagyja, hacsak nincs rajta `force = true`, és
a `dist/index.html` létezik. Kontroll, ami bizonyítékká teszi:

```
/index.html      200   szabály megvan, nem tüzel
/en/index.html   200   szabály megvan, nem tüzel
/de/index.html   200   szabály megvan, nem tüzel
/en/seo          301   nincs ott fájl — tüzel
```

A duplikátum azért nem látszott hibaként, mert a három főoldal-shell canonicalja
már eleve `/`, `/en/`, `/de/` — a Google elintézte helyettünk, és „Alternate page
with proper canonical tag” alá sorolta. Ez a Google, ahogy fedezi egy
át nem irányított átirányítás hiányát.

---

## 1. Kanonizálás

- `force = true` a három `/index.html` szabályra.
- Kijavítottam egy **téves indoklást** a `netlify.toml`-ban. Azt állította, hogy a
  `.html → extension nélküli` szabályok végtelen ciklust okoznának a Netlify
  „Pretty URLs” beállításával. A Pretty URLs **ki van kapcsolva** — mérve, mindkét
  alak 200-at ad —, tehát ciklus soha nem is fenyegetett. A szabályok továbbra sem
  kerülnek be, de már a valódi okból: a canonical rendben feloldja a duplikátumot.

## 2. Szolgáltatásoldalak

Mind a hét szolgáltatásoldal H1-je tartalmazza a saját fej-kulcsszavát. A korábbi
H1-ek nem tűntek el, lead-ként a fejcím alá kerültek.

| oldal | volt | lett |
|---|---|---|
| /keresooptimalizalas | A kereslet már megvan. Téged nem talál. | **Keresőoptimalizálás**, ami ügyfelet hoz. |
| /hirdeteskezeles | Nem elérést veszel. Ügyfelet. | Google és Meta **hirdetéskezelés**, ami ügyfelet hoz. |
| /webshop-keszites | A kosár nem a végállomás. A kezdet. | **Webshop készítés**, ami el is ad. |
| /branding | Egy szín. Egy szlogen. És te jutsz eszükbe. | **Logó tervezés** és arculat, amire emlékeznek. |

Új szekciók, mindkettő olyan lekérdezésre válaszol, amire az oldal már megjelent,
de nem felelt:

- /keresooptimalizalas: „Mennyibe kerül a keresőoptimalizálás?”, „Mennyi idő,
  amíg a keresőoptimalizálás eredményt hoz?”, „Keresőoptimalizálás Győrben és
  Budapesten”. Törzs 1168 → 1656 szó.
- /hirdeteskezeles: „Hogyan zajlik a hirdetéskezelés?”, „Mennyibe kerül a
  hirdetéskezelés?”. Törzs 1454 → 1758 szó.

**Egy láthatatlan hiba:** a `hirdetés­kezelés` szóban egy lágy elválasztójel
(U+00AD) ült, pont az oldal saját fej-kulcsszavának közepén. Azonosan jelenik meg
és szerkesztőben láthatatlan — ezért maradt meg —, de kettévágja a szót annak,
ami nem normalizálja. Kivéve.

**Árak: egyetlen kitalált szám sincs.** A /hirdeteskezeles ár-szekciója a saját
GYIK-jének 80–150 ezer Ft-os keretét és 2–4 hetes tanulási szakaszát idézi. A
/keresooptimalizalas a havidíjas modellt magyarázza, mert a site sehol nem
publikál árat erre.

> Egy állítást, amit először megírtam — „az első kampány ingyen” — töröltem: a
> „kampány, amit nem számlázunk ki” szekció a HAIO-szponzoráció, nem ügyfélajánlat.

## 3. Helyi réteg (a döntésed szerint: additív)

- `areaServed` most **Győr + Budapest + Győr-Moson-Sopron vármegye + a három
  ország**. Az országok maradtak — ez bővítés, nem szűkítés, és nem vonja vissza
  azt, amit a korábbi döntés védett.
- A `/weboldal-keszites-gyor` **továbbra is 301**, és nem is jön vissza. Az a
  döntés a *route*-ról szólt és helyes volt; csak a listára nem állt.
- A footerben megjelent a székhely szövegként: `9151 Abda, Arany János utca 13.`
  Eddig csak a JSON-LD-ben és az impresszumban volt meg, a NAP-hoz mind a három
  kell, láthatóan.

## 4. Többnyelvű blog — **ez a visszavonható döntés**

A `/blog-google-elso-oldal` EN és DE változata együtt az összes impresszió
nagyjából negyedét hozza, 40–70 közötti pozíciókról, **három hónap alatt nulla
kattintással**. A magyar cikk változatlan; a két fordítás `noindex, follow`, és
ugyanúgy elérhető, linkelt és lefordított marad.

**Visszavonás:** `git revert 9891e24`, vagy üresítsd ki a `LOCALE_NOINDEX` dictet
a `_build/build.py`-ban. Minden más ebből származik.

## 5. Indexelési higiénia

Itt kevés volt a tennivaló, és ezt érdemes kimondani ahelyett, hogy munkát
gyártanék:

- Sitemap: 79 URL, mind 200-as, mindegyik canonicalja önmagára mutat, egy sem
  noindex, és nincs indexelhető oldal, ami kimaradna. Ellenőrizve.
- `robots.txt`: nem tilt CSS-t, JS-t, képet, és hivatkozik a sitemapre. Rendben.
- A **47 „Alternate page with proper canonical”** forrása megvan: a site
  **8 093 belső linkje `.html` alakra mutat**, miközben minden canonical
  extension nélküli. A robot a navigációt követve a `/kkv.html`-re ér, elolvassa a
  canonicalt, és a twint „alternate”-ként iktatja.

  **Ez nem hiba, és ezen a méreten nem is éri meg megjavítani.** A Google maga
  mondja, hogy nincs teendő; 90 oldalnál a crawl budget nem szűk keresztmetszet.
  A valódi javítás a linkek átírása lenne extension nélkülire — 8 093 link, a
  `npm run dev` (ami `python3 -m http.server`, és nem old fel extension nélküli
  utat) és a teljes teszt-felület. Ha a site sokszorosára nő, akkor érdemes
  elővenni; **a „Pretty URLs” bekapcsolása önmagában rosszabb** lenne, mert akkor
  minden belső kattintás egy 301-en menne keresztül.
- A 4 db 404 nem belső linkből jön: az összes belső hivatkozást végigjártam, egy
  sem mutat nemlétező célra.

---

## Amit neked kell megtenned

1. **Deploy.** A `force = true` javítás csak élesen ellenőrizhető. Utána:
   ```bash
   curl -sI https://stratosweb.hu/index.html | head -3
   ```
   `301` és `location: https://stratosweb.hu/` a várt válasz. (Most `200`.)

2. **GSC → Indexelés → Oldalak:** a „Page with redirect” és a „Duplicate, Google
   chose different canonical” csoportokon **Validate fix**.

3. **GSC → URL Inspection → Request indexing** az átírt oldalakra:
   `/keresooptimalizalas`, `/hirdeteskezeles`, `/webshop-keszites`, `/branding`
   (és ha a 4. prioritást megtartod, a `/blog-google-elso-oldal`-ra is, hogy az új,
   szűkített hreflang-készletet hamarabb lássa).

4. **Google Cégprofil.** A footer NAP-ja és a `areaServed` most már alátámasztja a
   helyi találatot, de a Cégprofil összekötése nélkül a fele hiányzik. A profilon
   ugyanez a cím szerepeljen, karakterre: `9151 Abda, Arany János utca 13.`
   A footerbe szánt Cégprofil-link a repóban nincs meg — küldd át, és berakom.

5. **Netlify „Pretty URLs”** — **ne kapcsold be.** Lásd az 5. pontot: a mostani
   állapot canonicallel rendben van, a bekapcsolás viszont minden belső linket
   egy 301-re küldene.

## Amit rád hagytam

- **Városi landing oldalak** (`/keresooptimalizalas-gyor`, `/weboldal-keszites-gyor`):
  nem készültek el, és a javaslatom, hogy ne is készüljenek. A korábbi döntés
  indoklása a route-okra nézve érvényes maradt, és thin contentet gyártani egy
  83. pozícióért rossz csere. Az additív réteg (3. pont) a jelzés nagy részét
  megszerzi, oldal nélkül.
- **A hirdetéskezelés díjmodellje.** Az ár-szekcióban `<!-- TODO -->` jelöli: a
  site sehol nem mondja ki, fix havidíj-e vagy a költés százaléka. Ha fix, érdemes
  kimondani — ez tényleges megkülönböztető, és pont az „árak” kereséseknél dönt.
- **A 4. prioritás iránya.** Az (a) opció van élesítve (noindex). A (b) — valódi
  DE/EN piaci célzás — továbbra is nyitva áll; az egy tartalmi és üzleti döntés,
  nem technikai.

## Ami kívül esett ezen a munkán

Két dolog, amit útközben találtam, és **egyik sem ebből a munkából származik** —
mindkettő megvan a `8392683` commitban is. Külön feladatként felvettem őket,
hogy ezek a commitok SEO-commitok maradjanak.

1. `npm run audit:conversion:check` két hibát jelez az EN/DE SEO-oldalon
   (`fullCasePromise`). A guard még azt hiszi, minden esettanulmány `summary`,
   miközben a `case-rapidkert` időközben `full` lett — tehát a CTA igaz, és a
   guard elavult.

2. Öt oldalforrásban magyar idézőjel nyílik, de egyenes `"` zárja:
   `adatkezelesi-tajekoztato`, `arajanlat`, `branding` (2×), `ugyfelszolgalat`;
   a `rolunk` pedig három nyitó jelet tartalmaz párosítatlanul. Az általam
   szerkesztett fájlban (`hirdeteskezeles`) ezt javítottam, a többihez nem
   nyúltam. Figyelem: néhány ilyen sztring egyben fordítási kulcs is, tehát az
   oldallal együtt a `_build/i18n/*.json`-t is át kell nevezni, különben az
   EN/DE oldal magyarul marad.

---

## Ellenőrzés

```
seo-audit        90 dokumentum — 79 indexelhető, 8 noindex, 3 not-found, 79 sitemap
                 0 hiba, 18 figyelmeztetés (ugyanaz a 18, mind a két `summary` esettanulmány)
seo-ownership    nincs ütközés — mind az öt fej-kulcsszónak egy gazdája van
JSON-LD          87 blokk, 0 hiba; minden @id hivatkozás feloldható, nincs entity-szivárgás
H1               90 oldal, oldalanként pontosan egy; nincs kihagyott fejcímszint
elrendezés       320–3840 px, három nyelv: nincs törött szó, nincs vízszintes túlcsordulás
                 (valódi böngészőben is újramérve, 15 px-es görgetősávval — a headless
                 Chrome overlay görgetősávja 15 px-szel bőkezűbb, és az első beállítás
                 pont ebbe a hibahatárba esett bele 1024 px-en)
```

`seo-audit-before.md` és `seo-audit-after.md` a két pillanatkép; a `before` a
`8392683` commitból készült, azonos módszerrel, hogy a diff valódi legyen.

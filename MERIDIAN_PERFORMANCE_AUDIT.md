# Altimeter Meridian — teljesítmény-ellenőrzés és vizuális audit

Mért adatok. Ahol nincs mérés, ott az szerepel, hogy nincs.

> **Státusz:** a teljesítmény- és életciklus-mérés lezárult (5–10. pont). A
> vizuális audit, a sziluett-teszt és a döntés még nincs meg.

---

## 0. Mit mér ez a dokumentum, és mit nem

Ez a fázis egyetlen kérdéssel indult: okozott-e mérhető visszaesést a legutóbbi
világítás-változtatás (`MeridianLights.tsx` — négy magasságvezérelt intenzitás és
egy új rim fény). A válasz nem adható meg a meglévő `bench.mjs` alapján, két
okból, és mindkettő a módszerről szól:

1. **A `bench.mjs` egyetlen mediánba átlagolja az egész utat.** Nem tudja
   megmondani, hogy melyik magasság kerül mennyibe, és a világítás
   magasságfüggő — a rim fény a teljes út négyötödében ki van kapcsolva.
2. **A képkockaidő ezen a gépen vsync-hez van szögezve.** A mérőgép kijelzője
   120 Hz-es, a jelenet pedig bőven a kereten belül fut, tehát *minden* egészséges
   képkocka 8,3 ms-ot mér, akármit csinál a shader. A `bench.mjs` medián- és
   p95-oszlopa ezért nem alkalmas két build összehasonlítására — nem azért, mert
   pontatlan, hanem mert nem azt méri.

Amit ehelyett mérünk: **képkockánkénti GPU-idő** az
`EXT_disjoint_timer_query_webgl2` kiterjesztéssel. Ez nanoszekundumban adja meg,
hogy a GPU mennyi időt töltött pontosan egy képkocka rajzolóhívásaival, és nem
érinti sem a vsync, sem a kompozitor, sem az ablakkezelő.

### Amit nem mértünk, és nem is állítunk

- **Fizikai mobil hardvert nem mértünk.** A „mobile" sorok asztali Chromium
  viewport- és érintés-emulációval készültek, egy Apple M4 GPU-n. Ez helyesen
  választja ki a `reduced` minőségi szintet és helyesen méri a *fragmentszámot*,
  de egy iPhone GPU-járól, hőleadásáról vagy frame-pacingjéről semmit nem mond.
  Ahol „mobil" szerepel, az emulált mobil viewport, nem telefon.
- **Termikus terhelést nem mértünk.** Egy 24 GB-os MacBook Air rövid mintái nem
  modellezik egy telefon hosszú távú throttlingját.
- **A `MODE=unlocked` (vsync nélküli) mérés nem használható összehasonlításra.**
  Kipróbáltuk: ~780 fps-t ad, de ott már a rAF- és kompozitor-overhead dominál,
  és ugyanaz a változatlan build egyszer 780, másszor 120 fps-t jelentett attól
  függően, hogy takarta-e valami az ablakot. Ez az ablakkezelőről szól, nem a
  jelenetről.

---

## 1. Mérési környezet

| paraméter | érték |
|---|---|
| gép | MacBook Air, Apple M4, 10 mag (4P + 6E), 24 GB |
| operációs rendszer | macOS 26.6 (build 25G72) |
| böngésző | Chromium 151.0.0.0 (Playwright 1.62.1), **fejjel futtatva** |
| GPU (WebGL-jelentés) | `ANGLE (Apple, ANGLE Metal Renderer: Apple M4, Unspecified Version)` |
| kijelző | 120 Hz — ezért a 8,3 ms-os képkocka-plafon |
| `EXT_disjoint_timer_query_webgl2` | **elérhető** — a GPU-idő közvetlenül mért, nem becsült |
| kiszolgálás | `python3 -m http.server 4324 --directory dist`, produkciós build |
| CPU-fojtás | **nincs** (a `bench.mjs` 4×-es fojtása külön, lásd 2. pont) |

A fejjel futtatás nem stílus kérdése: a headless Chromium SwiftShaderre esik
vissza, azaz CPU-n rendereli a WebGL-t, és egy szoftveresen rajzolt képkockaidő
nem a valódi lassabb változata, hanem másik rendszer mérése.

---

## 2. Lefuttatott parancsok

```bash
npm run build:full
python3 -m http.server 4324 --directory dist
```

A meglévő, **módosítatlan** benchmark, három futással:

```bash
RUNS=3 node experiments/bench.mjs
```

Az új, magasságfelbontású benchmark, az öt kiírt célponton:

```bash
LABEL=current MODE=vsync RUNS=3 WARMUP=1 SAMPLE_MS=2000 SETTLE_MS=1400 \
  node experiments/bench-meridian.mjs
```

Az összefésült A/B a jelenlegi és a rekonstruált korábbi világítás között:

```bash
LABEL=lighting-ab MODE=vsync RUNS=3 WARMUP=1 SAMPLE_MS=3000 SETTLE_MS=1200 \
  TARGETS=desktop,mobile-a,stress \
  BUILDS="current=/experiments/stratos-ascent-full/,baseline=/experiments/stratos-ascent-full-baseline/" \
  node experiments/bench-meridian.mjs
```

Memória- és életciklus-audit, tíz be/kilépési ciklus:

```bash
node experiments/bench-lifecycle.mjs
```

Determinisztikus képek (a `dev:full` szerver ellen, lásd 6. pont):

```bash
npm run dev:full
node experiments/shots-meridian.mjs
VERIFY=1 SUFFIX=-verify node experiments/shots-meridian.mjs
```

---

## 3. A magasságvezérlés módszere

A produkciós buildben nincs `__stratos` fogantyú — az `import.meta.env.DEV`
ággal együtt kifordul a bundle-ból, és ez szándékos. A benchmark ezért **görgetéssel
áll rá** a hét megállópontra, és zárt hurokban ellenőrzi a HUD kiírt magasságát:

1. viewportonként egyszer felvesz egy 33 pontos görgetés → magasság táblát (a
   magassággörbe futásidőben kalibrálódik a *mért* panelelrendezésre, tehát
   1440 px-en és 360 px-en nem ugyanaz, és forrásból nem számolható ki);
2. a táblából interpolált tippre görget, elolvassa a HUD-ot, és szekáns
   lépésekkel finomít, amíg ±30 méteren belülre nem ér;
3. a megtalált görgetéspozíciót elteszi, így a további futások egy próbából
   találnak oda.

**Az elért magasság minden sorban a kért mellett szerepel**, tehát egy elhibázott
ráállás látszik, nem eltűnik.

### Miért a produkciós build, és miért nem az a képekhez

A két célnak ellentétes igénye van. A benchmarknak azt kell mérnie, ami ki fog
menni, tehát a produkciós buildet hajtja görgetéssel. Egy képernyőképnek viszont
**reprodukálhatónak** kell lennie, és a gyűrűk tétlen forgása az egyetlen mennyiség
az egész műszerben, amit nem a magasságból származtatunk, hanem integrálunk
(`MeridianRing`: `spin.current += …`). Ezt csak a `debug.ringRotation` tudja
megállítani, ami fejlesztői fogantyú. A képek ezért a dev szerver ellen készülnek
— a Vite azon a modulok kiszolgálásán változtat, nem egyetlen vertexen,
anyagon vagy shaderen.

---

## 4. Mit mér az új benchmark, és hogyan

A mérés a **WebGL-határon** történik, nem a three.js könyvelésén: a
`drawElements` / `drawArrays` és társaik, valamint a `create*`/`delete*` párok
prototípus-szinten becsomagolva. Ennek két oka van — a `renderer.info` csak
fejlesztői buildből érhető el, és a becsomagolt hívás azt számolja, amit a
meghajtó ténylegesen kapott.

| oszlop | mit jelent |
|---|---|
| `fps`, `med`, `p95`, `p99` | falióra szerinti képkockaidő — **amit a látogató kap**, de 120 Hz-en plafonos |
| `GPUmed`, `GPUp95` | képkockánkénti GPU-idő timer query-ből — **ez tud változást kimutatni** |
| `GPU±` | a három futás mediánjának szórása — a zajküszöb |
| `draws`, `tris` | rajzolóhívás és háromszög képkockánként |
| `prog`, `tex`, `ctx` | élő shader-programok, textúrák, WebGL-kontextusok |

---

---

## 5. A meglévő benchmark, módosítatlanul

`RUNS=3 node experiments/bench.mjs`, a jelenlegi implementáció ellen, a
világítás-változtatás után. A benchmarkot **nem** módosítottuk az első eredmény
előtt; nem is volt hibás.

| metrika | jelenlegi hero | 0–8 000 m prototípus | **0–30 000 m teljes út** | teljes út, csökkentett mozgás |
|---|---|---|---|---|
| átvitt bájt (tömörítetlen) | 1 057 KB | 1 601 KB | 3 137 KB | 1 677 KB |
| LCP | 4 068 ms | 200 ms | 4 344 ms | 248 ms |
| hosszú feladatok (>50 ms) | 1 (92 ms) | 2 (123 ms) | 4 (309 ms) | 1 (82 ms) |
| medián képkockaidő | 8,4 ms | 8,3 ms | **8,3 ms** | 8,3 ms |
| p95 képkockaidő | 25,2 ms | 9,2 ms | **9,2 ms** | 9,2 ms |
| 30 fps alatti kockák | 3 / 559 | 0 / 720 | **0 / 720** | 0 / 720 |
| JS heap betöltés / görgetés után | 1 / 1 MB | 8 / 9 MB | 10 / 11 MB | 2 / 2 MB |

Az eredmény a 2026-08-01-es alapmérés szórásán belül van (lásd
[PERFORMANCE_COMPARISON.md](PERFORMANCE_COMPARISON.md)). **De ez a táblázat nem
alkalmas a világítás megítélésére**: a medián és a p95 mindhárom oldalon
gyakorlatilag azonos, mert mindhárom a 120 Hz-es vsync-hez ér hozzá, nem a
kerethez. Ezért készült a következő szakasz mérése.

---

## 6. Magasságonkénti teljesítmény — jelenlegi implementáció

3 mért futás + 1 bemelegítés célpontonként, 2 000 ms minta megállópontonként,
metrikánként medián. `GPU±` = a három futás mediánjának terjedelme, azaz a
zajküszöb. Minden célpont 5 000+ timer query mintát adott, **0 disjoint
eseménnyel** — a GPU-idők érvényesek.

### Desktop — 1440 × 900, DSF 1, teljes minőség, teljes mozgás

renderer kész: **143 ms** · heap 10 579 → 11 728 KB · WebGL-kontextus: 2 (ebből 1
az eldobott képességvizsgálat)

| magasság | fps | medián | p95 | p99 | >16,7 ms | >33,3 ms | legrosszabb | GPU med | GPU± | draw | háromszög | program | textúra |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 m | 120 | 8,30 | 8,90 | 9,20 | 0% | 0% | 9,3 | 2,318 | 0,232 | 41,2 | 25 918 | 11 | 7 |
| 3 000 m | 120 | 8,30 | 9,10 | 9,20 | 0% | 0% | 9,3 | 2,076 | 0,351 | 41,2 | 25 918 | 11 | 7 |
| 7 000 m | 120 | 8,30 | 9,10 | 9,20 | 0% | 0% | 9,3 | **2,494** | 0,502 | 77,3 | 26 512 | 12 | 8 |
| 12 000 m | 120 | 8,30 | 9,00 | 9,30 | 0% | 0% | 9,3 | 1,478 | 0,198 | 69,3 | 26 474 | 12 | 8 |
| 18 000 m | 120 | 8,30 | 9,00 | 9,30 | 0% | 0% | 9,4 | 1,548 | 0,935 | **80,3** | 30 971 | 13 | 8 |
| 24 000 m | 120 | 8,30 | 8,90 | 9,20 | 0% | 0% | 9,4 | **1,335** | 0,763 | 57,2 | 28 038 | 13 | 8 |
| 30 000 m | 120 | 8,30 | 8,80 | 9,10 | 0% | 0% | 9,3 | 1,551 | 0,202 | 54,2 | **35 694** | 16 | 8 |
| teljes bejárás | 120 | 8,30 | 9,00 | 9,30 | 0% | 0% | 9,4 | 1,366 | — | 59,0 | — | — | — |

### Laptop — 1280 × 800, DSF 2, teljes minőség, teljes mozgás

renderer kész: **151 ms** · heap 10 576 → 11 749 KB · backing store 2560 × 1600

| magasság | medián | p95 | p99 | >16,7 | >33,3 | GPU med | GPU± | draw | háromszög |
|---|---|---|---|---|---|---|---|---|---|
| 0 m | 8,30 | 8,90 | 9,20 | 0% | 0% | 2,632 | 0,133 | 41,2 | 25 918 |
| 3 000 m | 8,30 | 9,00 | 9,20 | 0% | 0% | **3,008** | 0,078 | 41,2 | 25 918 |
| 7 000 m | 8,30 | 8,80 | 9,20 | 0% | 0% | 2,258 | 0,012 | 77,3 | 26 512 |
| 12 000 m | 8,30 | 8,80 | 9,20 | 0% | 0% | 1,960 | 0,404 | 69,3 | 26 474 |
| 18 000 m | 8,30 | 9,20 | 9,40 | 0% | 0% | **1,837** | 0,116 | 80,3 | 30 971 |
| 24 000 m | 8,30 | 9,00 | 9,20 | 0% | 0% | 2,104 | 0,807 | 57,2 | 28 039 |
| 30 000 m | 8,30 | 9,20 | 9,30 | 0% | 0% | 2,460 | 0,153 | 54,2 | 35 694 |
| teljes bejárás | 8,30 | 8,90 | 9,30 | 0% | 0% | 2,290 | — | 59,0 | — |

### Mobile A — 390 × 844, DSF 3, mobil minőségi szint, teljes mozgás

renderer kész: **142 ms** · heap 10 203 → 11 229 KB

| magasság | medián | p95 | p99 | >16,7 | >33,3 | GPU med | GPU± | draw | háromszög |
|---|---|---|---|---|---|---|---|---|---|
| 0 m | 8,30 | 9,20 | 9,30 | 0% | 0% | 0,593 | 0,017 | 41,2 | 20 519 |
| 3 000 m | 8,30 | 8,80 | 9,30 | 0% | 0% | **0,672** | 0,036 | 41,2 | 20 519 |
| 7 000 m | 8,30 | 8,90 | 9,20 | 0% | 0% | 0,474 | 0,003 | 54,2 | 20 863 |
| 12 000 m | 8,30 | 9,00 | 9,30 | 0% | 0% | 0,458 | 0,005 | 49,2 | 20 842 |
| 18 000 m | 8,30 | 8,90 | 9,30 | 0% | 0% | **0,431** | 0,003 | 65,3 | 23 337 |
| 24 000 m | 8,30 | 8,90 | 9,20 | 0% | 0% | 0,486 | 0,007 | 58,2 | 21 883 |
| 30 000 m | 8,30 | 8,60 | 9,20 | 0% | 0% | 0,616 | 0,011 | 54,2 | 23 653 |
| teljes bejárás | 8,30 | 9,00 | 9,30 | 0% | 0% | 0,563 | — | 53,0 | — |

### Mobile B — 360 × 800, DSF 3, mobil minőségi szint, teljes mozgás

renderer kész: **140 ms** · heap 10 238 → 11 240 KB

| magasság | medián | p95 | p99 | >16,7 | >33,3 | GPU med | GPU± | draw | háromszög |
|---|---|---|---|---|---|---|---|---|---|
| 0 m | 8,30 | 8,90 | 9,20 | 0% | 0% | 0,574 | 0,004 | 41,2 | 20 519 |
| 3 000 m | 8,30 | 8,90 | 9,20 | 0% | 0% | 0,640 | 0,014 | 41,2 | 20 519 |
| 7 000 m | 8,30 | 9,00 | 9,30 | 0% | 0% | 0,516 | 0,004 | 54,2 | 20 863 |
| 12 000 m | 8,30 | 9,20 | 9,30 | 0% | 0% | 0,440 | 0,005 | 49,2 | 20 843 |
| 18 000 m | 8,30 | 9,00 | 9,40 | 0% | 0% | 0,392 | 0,002 | 65,3 | 23 337 |
| 24 000 m | 8,30 | 8,70 | 9,10 | 0% | 0% | 0,424 | 0,002 | 58,2 | 21 883 |
| 30 000 m | 8,30 | 9,30 | 9,30 | 0% | 0% | 0,603 | 0,011 | 54,2 | 23 653 |
| teljes bejárás | 8,30 | 9,00 | 9,30 | 0% | 0% | 0,554 | — | 53,2 | — |

### Csökkentett mozgás — 390 × 844, DSF 3, valódi böngésző-médialekérdezés

A médialekérdezést futásidőben emuláljuk és **az oldalon belülről ellenőrizzük**,
ugyanazzal a fegyelemmel, amit a `tests/helpers/reduced-motion.ts` ír le; ha nem
lépne életbe, a mérés hibával áll le.

| mit mértünk | érték |
|---|---|
| canvas elemek | **0** |
| WebGL-kontextus | **0** |
| rajzolóhívás bármelyik magasságon | **0** |
| shader-program | **0** |
| GPU-idő | nincs — nincs GPU-munka, amit mérni lehetne |
| JS heap | **2 269 → 2 394 KB** (a WebGL-út 10 579 → 11 728 KB-jával szemben) |

Ez a Part 10 „csökkentett mozgás" követelményeit közvetlen méréssel teljesíti:
nem *kevesebb* a folyamatos renderelés költsége, hanem **nincs**. Nincs tétlen
gyűrűforgás, nincs kamera-mozgás és nincs mutatóra adott válasz, mert nincs
renderer — a képességvizsgálat a `three` letöltése *előtt* dönt.

### Mit mondanak ezek a számok

**Egyetlen magasság sem drágább szignifikánsan a többinél, és a brief által
gyanúsítottak a legolcsóbbak közé tartoznak.** Asztali gépen a legdrágább
megállópont a **7 000 m** (2,494 ms GPU), a legolcsóbb a **24 000 m** (1,335 ms).
A 12 000 m-es rekesznyitás (1,478 ms), a 18 000 m-es második gyűrű (1,548 ms) és
a 30 000 m-es teljes állapot (1,551 ms) mind az olcsóbb fele. A költség ott van,
ahol a **felhőréteg** — nem ott, ahol a műszer.

Két számláló ettől függetlenül a magasban tetőzik, és mindkettő magyarázható:

- **rajzolóhívás — csúcs 80,3 @ 18 000 m.** Itt van a képen egyszerre a
  `SystemRings` és a két lezárt gyűrű. 30 000 m-re 54,2-re esik vissza, mert a
  `StagedGeometry` addigra leszereli a rendszer-gyűrűket.
- **háromszög — csúcs 35 694 @ 30 000 m.** A `StarField` és az `EarthLimb`.

A képkockaidő mind a négy WebGL-célponton **8,30 ms medián, 0% a 16,7 ms
felett és 0% a 33,3 ms felett**, a legrosszabb kocka 9,4 ms. Nincs többkockás
akadás egyetlen megállóponton sem.

---

## 7. A világítás A/B mérése

### Mihez hasonlítunk, és mi ennek a korlátja

**Ez a working copy nem git-repó, és a `MeridianLights.tsx` korábbi változata
nincs meg a lemezen.** Nincs commit, amit ki lehetne nézni. A „korábbi
világítás" build ezért **rekonstrukció**, a jelenlegi fájl saját leírása alapján
arról, amit lecserélt: három rögzített fény, rim nélkül, képkockánkénti munka
nélkül — az intenzitások pedig azok, amiket a jelenlegi fájl ma is a JSX
alapértékeként használ.

A rekonstrukció abban pontos, ami a költség szempontjából számít: **eggyel
kevesebb irányfény a jelenetgráfban**, ami a `NUM_DIR_LIGHTS` define-on keresztül
minden megvilágított anyag fragmentköltségét érinti. Abban nem feltétlenül
pontos, hogy a régi fájl belső szerkezete pontosan így nézett-e ki. Ez
kifejezetten következtetés, nem mérés.

Build-méret, mérve: `JourneyScene` chunk **982,04 kB → 982,68 kB**, azaz a
változtatás **+0,64 kB** tömörítetlenül.

### Módszer

Egyetlen böngészőfolyamatban, **váltogatva**: 1. futás jelenlegi, 1. futás
alap, 2. futás jelenlegi, … Ez teszi a hőmérsékleti sodródást és a háttérterhelést
közös módusúvá. Célpontonként 3+3 mért futás, 3 000 ms minta megállópontonként.

### Eredmény — Mobile A (390 × 844, DSF 3, mobil szint)

Ez az egyetlen célpont, amelyen a jel a zaj fölé emelkedik: a builden belüli
futásszórás 0,002–0,015 ms, a keresett különbség ennek többszöröse.

| magasság | alap (3 futás mediánja) | jelenlegi (3 futás) | eltérés | % | jelenlegi lassabb? |
|---|---|---|---|---|---|
| 0 m | 0,545 / 0,559 / 0,560 | 0,584 / 0,591 / 0,593 | +0,032 | +5,7% | 3/3 |
| 3 000 m | 0,471 / 0,569 / 0,552 | 0,497 / 0,604 / 0,605 | +0,052 | +9,4% | 3/3 |
| 7 000 m | 0,451 / 0,451 / 0,450 | 0,469 / 0,474 / 0,474 | +0,023 | +5,1% | 3/3 |
| 12 000 m | 0,435 / 0,436 / 0,434 | 0,449 / 0,460 / 0,458 | +0,023 | +5,3% | 3/3 |
| 18 000 m | 0,410 / 0,410 / 0,410 | 0,418 / 0,429 / 0,430 | +0,019 | +4,6% | 3/3 |
| 24 000 m | 0,465 / 0,464 / 0,464 | 0,482 / 0,487 / 0,488 | +0,023 | +5,0% | 3/3 |
| 30 000 m | 0,574 / 0,580 / 0,565 | 0,592 / 0,606 / 0,603 | +0,029 | +5,1% | 3/3 |
| **összesen** | **3,445 ms** | **3,646 ms** | **+0,201** | **+5,8%** | **21/21** |

**A jelenlegi build a 21 párosított összehasonlításból 21-ben lassabb.** Ha a
változtatás ingyen lenne, ez körülbelül a felében fordulna elő; előjelpróbával
p ≈ 5 × 10⁻⁷.

| célpont | eltérés | párosított futások | értékelés |
|---|---|---|---|
| **Mobile A** 390 × 844 @3 | **+5,8%** | **21/21** | valós, reprodukálható |
| Desktop 1440 × 900 @1 | +2,5% | 13/21 | nem elkülöníthető a zajtól |
| Stress 2560 × 1440 @2 | −1,5% | 10/21 | **a mérés érvénytelen**, lásd lent |

### A stress célpont miért nem használható

Ez volt a fragment-felerősítő ötlet: 5120 × 2880-on renderelni, hogy egy
per-pixel költségnek legyen hol látszania. Nem működött, és a *miért* önmagában
is eredmény: ezen a felbontáson **belép az alkalmazás saját minőségszabályozója**.
A `QualityManager` `PerformanceMonitor`-a lelépteti a DPR-t, tehát a mérés közben
változik a renderelt felbontás. Ugyanazon build három futásának mediánja
22,2 / 35,4 / 34,5 ms — a szórás nagyobb, mint a keresett hatás.

Ez rossz mérőműszer és **jó hír a termékről**: a Part 10 „a minőségcsökkentés
lépjen életbe, mielőtt az élmény instabillá válik" követelménye itt közvetlenül
megfigyelhető.

### Mi a költség valójában — és mi *nem*

A `MeridianLights.tsx` fejléce szerint „a költség képkockánként négy szorzás".
**A mérés szerint nem ez a költség.** Négy skalár szorzás képkockánként nem
mérhető. Amit mértünk, az a **harmadik irányfény a jelenetgráfban**: ott van a
mount pillanatától, tehát minden megvilágított anyag minden fragmentje kiértékel
egy fénnyel többet.

Ezt a mérés meg is erősíti: a többletköltség **0 méteren is megvan** (+5,7%),
ahol a rim fény intenzitása pontosan nulla, és nagyságrendileg ugyanakkora, mint
30 000 méteren (+5,1%), ahol viszont dolgozik. Ha a költség a magasságvezérelt
számításból jönne, 0 méteren nem lenne mérhető.

Amit **nem** változtatott meg, mérve: rajzolóhívás (41,1 → 41,1), shader-program
(11 → 11 és 16 → 16), textúra, geometria, WebGL-kontextus — mind bájtra azonos.
Nincs új draw call, nincs új program, nincs overdraw-változás.

### Abszolút nagyságrend

+0,02–0,03 ms képkockánként. Egy 120 Hz-es keret 8,33 ms; ez a keret **0,3%-a**.
A falióra szerinti képkockaidő minden célponton változatlan: 8,30 ms medián,
**0% a 16,7 ms felett, 0% a 33,3 ms felett**, a legrosszabb kocka 9,4 ms.

### Független megerősítés, javított mérőműszerrel

Az első A/B után kiderült, hogy a timer-query harness egy hibát tartalmazott: a
mintaablak végén nyitva maradt egy lekérdezés, amit a *következő* ablak első
tickje zárt le, így ablakonként egyetlen, körülbelül másfél másodpercnyi GPU-időt
tartalmazó minta keletkezett. Ez **a mediánokat nem érintette** (egy rossz minta
ezerből), de megháromszorozta az átlagokat — 2,3 ms medián mellett 7,0 ms átlag,
2,9 ms p95-tel, ami aritmetikailag lehetetlen, és ez buktatta le.

A hiba javítva (`bench-instrument.mjs`, `end()`), és a mérés megismételve
Mobile A-n:

| magasság | alap | jelenlegi | eltérés | % | párok |
|---|---|---|---|---|---|
| 0 m | 0,568 | 0,603 | +0,035 | +6,2% | 3/3 |
| 3 000 m | 0,585 | 0,507 | −0,078 | −13,3% | 1/3 |
| 7 000 m | 0,450 | 0,475 | +0,025 | +5,6% | 3/3 |
| 12 000 m | 0,434 | 0,457 | +0,023 | +5,3% | 3/3 |
| 18 000 m | 0,409 | 0,426 | +0,017 | +4,2% | 3/3 |
| 24 000 m | 0,464 | 0,484 | +0,020 | +4,3% | 3/3 |
| 30 000 m | 0,587 | 0,620 | +0,033 | +5,6% | 3/3 |
| | | | | | **19/21** |

A 3 000 m-es sor kilóg, és ott a legnagyobb a zaj is (±0,142 az összes többi
±0,001–0,012-jével szemben). A másik hat megállópont mindegyike 3/3, +4,2% és
+6,2% között.

**Két független mérési sorozat, összesen 42 párosított összehasonlításból 40-ben
lassabb a jelenlegi build.** Ezt tekintjük a megállapított tényállásnak.

---

## 8. A minőségi szint kiválasztása — mérve, nem feltételezve

A minőségi szint a bundle-ön belül dől el, és produkciós buildben nincs kiolvasva.
Ezért a két megfigyelhető következményéből mértük vissza: a `cappedDpr()` a
backing store-t kézi eszközön 1,5-re, máshol 2-re plafonozza.

| célpont | backing store | canvas DPR | `devicePixelRatio` | `pointer: coarse` | szint |
|---|---|---|---|---|---|
| desktop 1440 × 900 @1 | 1425 × 900 | 1,0 | 1 | false | full |
| laptop 1280 × 800 @2 | 2530 × 1600 | 2,0 | 2 | false | full |
| **mobile A** 390 × 844 @3 | **585 × 1266** | **1,5** | **3** | **true** | **reduced** |
| **mobile B** 360 × 800 @3 | **540 × 1200** | **1,5** | **3** | **true** | **reduced** |
| csökkentett mozgás | nincs canvas | — | — | true | nincs renderer |

A két mobil célponton a `devicePixelRatio` 3, a ténylegesen renderelt backing
store viszont 1,5× — a plafon **működik, és mérhető**: egy 3× kijelzőn a
fragmentszám negyede annak, amit a plafon nélkül renderelne. A `pointer: coarse`
mindkét mobil célponton igaz, tehát a `reduced` szint valóban kiválasztódik, és a
„mobile" sorok nem egy telefonméretű ablakban futó asztali szintet írnak le.

**A fallback nem aktiválódik feleslegesen**: mindkét mobil célpont canvasszal
fut, nem statikus tartalékkal.

---

## 9. Memória- és életciklus-audit — tíz be/kilépési ciklus

### Mi számít itt „kilépésnek"

Az út egyetlen oldal egyetlen ragadós canvasával, tehát nincs útvonal, amiről el
lehetne navigálni. A valódi mount/unmount határ a `FullAscent` képességváltása:
ha a `prefers-reduced-motion` bekapcsol, a `detect()` hibát ad vissza, a
`<JourneyScene>` helyére `<JourneyFallback>` kerül, és a teljes WebGL-részfa —
canvas, renderer, geometriák, anyagok, textúrák — leszerelődik. Kikapcsolva
visszaépül. Egy ciklus tehát: bejárás 0 → 30 000 → 0, kilépés, visszatérés.

```bash
node experiments/bench-lifecycle.mjs
```

### 9.1 A kiindulási mérés, és miért nem az, aminek látszott

Az első tíz ciklus tökéletesen lineáris növekedést mutatott minden WebGL-számlálón:

| ciklus | heap (KB) | kontextus | program | textúra | puffer | framebuffer | VAO |
|---|---|---|---|---|---|---|---|
| alap | 11 119 | 2 | 11 | 7 | 180 | 10 | 51 |
| 1 | 12 082 | 4 | 17 | 13 | 311 | 14 | 89 |
| 2 | 12 684 | 6 | 23 | 19 | 442 | 18 | 127 |
| 3 | 13 214 | 8 | 29 | 25 | 573 | 22 | 165 |
| 4 | 13 754 | 10 | 35 | 31 | 704 | 26 | 203 |
| 5 | 14 105 | 12 | 41 | 37 | 835 | 30 | 241 |
| 6 | 14 472 | 14 | 47 | 43 | 966 | 34 | 279 |
| 7 | 14 892 | 16 | 53 | 49 | 1 097 | 38 | 317 |
| 8 | 15 590 | 18 | 59 | 55 | 1 228 | 42 | 355 |
| 9 | 16 041 | 20 | 65 | 61 | 1 359 | 46 | 393 |
| 10 | 16 411 | 22 | 71 | 67 | 1 490 | 50 | 431 |

Ciklusonként pontosan +6 program, +6 textúra, +131 puffer, +4 framebuffer,
+38 VAO, +2 kontextus és +481 KB heap.

**A WebGL-oszlopok mérési műtermékek.** A `bench-instrument.mjs` a
*létrehozott mínusz kifejezetten törölt* értéket számolja, minden valaha létezett
kontextusra összevonva. A react-three-fiber a canvas leszerelésekor
`forceContextLoss()`-t hív (`unmountComponentAtNode`, `events-*.esm.js:2095`); a
meghajtó ilyenkor mindent visszavesz, ami a kontextusé volt, de egyetlen
`deleteProgram`/`deleteTexture`/`deleteBuffer` sem hangzik el. Egy összevont
számláló ezért **nem tud csökkenni** egy újramountnál, és ciklusonként pontosan
egy jelenetnyivel nő, akár szivárog valami, akár nem.

Ezt közvetlen méréssel különítettük el: minden GL-objektumot megcímkéztünk a
létrehozó kontextus azonosítójával, és minden kontextust `isContextLost()`
szerint soroltunk be.

| | ciklus 1 | 5 | 10 |
|---|---|---|---|
| **élő kontextuson** | 11 / 7 / 180 / 10 / 51 | 11 / 7 / 180 / 10 / 51 | 11 / 7 / 180 / 10 / 51 |
| halott kontextuson | 6 / 6 / 131 / 4 / 38 | 30 / 30 / 655 / 20 / 190 | 60 / 60 / 1 310 / 40 / 380 |

*(program / textúra / puffer / framebuffer / VAO)*

**Az élő kontextuson lévő erőforrások száma tíz cikluson át bájtra állandó, és
azonos az alapmérésével.** Mindig pontosan egy kontextus él. A növekedés teljes
egészében elveszített kontextusokhoz tartozik.

Ugyanez a többi számlálóra:

- **Kontextus: nem szivárog.** 22 létrejött, 21 elveszített — a képességvizsgálat
  (`capabilities.ts:40`) minden `detect()`-nél szándékosan eldob egyet, az R3F
  pedig minden leszereléskor egyet. Mindig pontosan egy él.
- **Figyelők: nem szivárognak.** A `window.__listeners` wrapper ciklusonként +1
  `resize`-t mutat, a böngésző saját nyilvántartása (`DOMDebugger.getEventListeners`)
  viszont **végig 3-at**, ahogy `scroll` 1, `load` 3, `wheel` 3, `visibilitychange`
  3 is állandó. A wrapper hívásokat számol, a böngésző figyelőket: a ScrollTrigger
  minden `enable()`-nél újra beadja ugyanazt a modulszintű `_onResize`
  függvényreferenciát, és azonos (típus, függvény, capture) hármas ismételt
  hozzáadása a DOM-szabvány szerint no-op. **A böngésző számlálása az irányadó.**
- **Nincs duplikált renderer, jelenet vagy hurok.** rAF-hívás képkockánként
  minden ciklusban 3,12; rajzolóhívás képkockánként 41,7; canvasok száma
  kilépéskor 0, visszatéréskor 1. Egy duplikált render-hurok nagyjából
  megkétszerezné az elsőt.

### 9.2 Ami viszont valóban szivárgott

A heap +481 KB/ciklus növekedése **valós**, és négy kényszerített gyűjtés meg tíz
másodperc tétlenség után sem jön vissza. Egy heap-pillanatfelvétel
konstruktoronkénti népszámlálása megnevezi (hat ciklus, ciklusonkénti növekmény):

| osztály | javítás előtt | javítás után |
|---|---|---|
| `WebGL2RenderingContext` | **+1** | **0** |
| `WebGLBuffer` | +123 | 0 |
| `WebGLUniformLocation` | +91 | 0 |
| `WebGLVertexArrayObject` | +39 | 0 |
| `WebGLShader` | +12 | 0 |
| `WebGLProgram` | +6 | 0 |
| `WebGLTexture` | +6 | 0 |
| `WebGLFramebuffer` | +4 | 0 |
| `ExtensionTracker` (Blink) | +40 | 0 |
| `Object` | +2 041 | +178 |

Tehát **ciklusonként egy teljes, halott renderer maradt elérhető a JS-ből.**

A visszatartási utat a pillanatfelvétel gráfjában visszafelé bejárva olvastuk ki,
nem következtetéssel:

```
(GC root) → … → response:Object → materials:Object → MAT_Glass_Crystal:Object
          → WeakMap-pár → currentProgram → WebGLProgram → WebGL2RenderingContext
```

A `response` a drei `useGLTF` gyorsítótárának bejegyzése. A mechanizmus a
three.js-ben van, `WebGLRenderer.js:16311`:

```js
material.addEventListener( 'dispose', onMaterialDispose );
```

Az `onMaterialDispose` a renderer konstruktorának hatókörében definiált closure
(`:15348`), tehát fogja a `properties`-t, a `programCache`-t és a `_gl`-t — az
egész renderert a WebGL-kontextusával együtt. A figyelő csak akkor kerül le,
amikor az anyagot eldobják, ami egy gyorsítótárazott GLTF-nél soha nem történik
meg: a gyorsítótár értelme épp az, hogy túléli az egyes mountokat. A GLB anyagai
így renderelőnként egy figyelőt gyűjtenek, és mindegyik életben tart egy halott
renderert. Ugyanez igaz a geometriákra (`:3814`). **Sem a `renderer.dispose()`,
sem az R3F leszerelése nem szedi le ezeket a figyelőket** — a `dispose()`
felsorolása (`:15282`) nem tartalmazza őket.

Az `AltimeterMeridian` a `scene.clone(true)`-t használja, ami az anyagokat és a
geometriákat **megosztja**, nem másolja — tehát a rajzolt anyagok pontosan a
gyorsítótárazottak.

**A javítás** (`AltimeterMeridian.tsx`): a jelenet leszerelésekor elengedjük a
gyorsítótárazott modellt.

```ts
useEffect(() => () => useGLTF.clear(MODEL_URL), []);
```

Ára egy 397 KB-os GLB újraértelmezése — HTTP-gyorsítótárból — egy olyan
újramountnál, ami csak akkor következik be, ha a látogató menet közben átállítja
a mozgáscsökkentési beállítását.

### 9.3 A második hiba: a képkockahurok nem állt le

A kiindulási audit „9 720 rajzolóhívás kigörgetett canvas mellett" sorát
kudarcként olvastuk. **Nem az volt** — a mérés volt rossz: 1440 × 900-on a
ragadós szakasz a sávja aljához van tűzve, alatta a lábléc mindössze 188 px, így
teljes kigörgetésnél a canvas **még mindig 712 px-nyit látszik**. Rajzolni ott
helyes. (Ebből következik, hogy a canvas *semmilyen* lábléc-magasságnál nem tud
görgetéssel kimenni a képből, amíg a lábléc alacsonyabb a nézetablaknál.)

Ha viszont egy beszúrt távtartóval ténylegesen kiléptetjük — canvas teteje
−3 788 px, `isIntersecting: false` a megfigyelőtől — akkor kiderült a valódi hiba:

```
  t(ms)  100 ms-onkénti rajzolóhívás
    602    246   ← itt fut le a görgetés, a megfigyelő t=611-nél jelez
    702     59
    802    258   ← és így megy tovább, korlátlanul
   2602    258
```

A megfigyelő jelez, a `park(false)` lefut, a `setFrameloop('never')` megtörténik
— és a rajzolás nem áll le.

**Ok:** az R3F `<Canvas>` a `configure()`-t **függőségi lista nélküli**
layout-effektben futtatja (`react-three-fiber.esm.js:61`), tehát minden
rendereléskor, és a `configure` a végén ezt teszi (`events-*.esm.js:2015`):

```js
if (state.frameloop !== frameloop) state.setFrameloop(frameloop);
```

ahol `frameloop` a *prop*. A `<Canvas>` ráadásul `useMeasure({ scroll: true })`-val
méri magát, tehát görgetésre újrarenderel. **Az a görgetés, amelyik kiviszi a
canvast a képből, egyben újra is rendereli a `<Canvas>`-t, és visszaállítja a
hurkot** néhány ezredmásodperccel a leparkolás után. Imperatív `setFrameloop`
ezt nem tudja megnyerni, mert a prop tulajdonosa folyamatosan érvényesíti a
sajátját.

**A javítás:** a parkolt állapot felkerül a `JourneyScene`-be és *propként* megy
le, így a `configure` a kívánt értéket erősíti meg ahelyett, hogy küzdene ellene.
A megfigyelő és a láthatóságfigyelő marad a `QualityManager`-ben.

### 9.4 A javítások után — tíz ciklus újramérve

| ciklus | heap kilépve | heap vissza | kontextus (élő / elveszített / **begyűjtött**) | erőforrás élő kontextuson | rAF/kép | rajz/kép |
|---|---|---|---|---|---|---|
| alap | — | 10 783 | 2 (1 / 1 / 0) | 11 · 7 · 180 · 10 · 6 · 51 | — | — |
| 1 | 9 874 | 12 126 | 4 (1 / 2 / **1**) | 11 · 7 · 180 · 10 · 6 · 51 | 3,12 | 41,7 |
| 2 | 10 802 | 12 520 | 6 (1 / 3 / **2**) | 11 · 7 · 180 · 10 · 6 · 51 | 3,12 | 41,7 |
| 3 | 11 179 | 12 729 | 8 (1 / 2 / **5**) | 11 · 7 · 180 · 10 · 6 · 51 | 3,12 | 41,7 |
| 4 | 11 336 | 13 064 | 10 (1 / 2 / **7**) | 11 · 7 · 180 · 10 · 6 · 51 | 3,12 | 41,7 |
| 5 | 11 571 | 13 097 | 12 (1 / 2 / **9**) | 11 · 7 · 180 · 10 · 6 · 51 | 3,12 | 41,7 |
| 6 | 11 623 | 13 169 | 14 (1 / 2 / **11**) | 11 · 7 · 180 · 10 · 6 · 51 | 3,12 | 41,7 |
| 7 | 11 681 | 13 221 | 16 (1 / 2 / **13**) | 11 · 7 · 180 · 10 · 6 · 51 | 3,12 | 41,7 |
| 8 | 11 741 | 13 670 | 18 (1 / 2 / **15**) | 11 · 7 · 180 · 10 · 6 · 51 | 3,12 | 41,7 |
| 9 | 12 296 | 13 857 | 20 (1 / 2 / **17**) | 11 · 7 · 180 · 10 · 6 · 51 | 3,12 | 41,7 |
| 10 | 12 362 | 13 893 | 22 (1 / 2 / **19**) | 11 · 7 · 180 · 10 · 6 · 51 | 3,12 | 41,7 |

*(erőforrás = program · textúra · puffer · framebuffer · renderbuffer · VAO)*

A **begyűjtött** oszlop a javítás közvetlen bizonyítéka: a `WeakRef`-fel figyelt
kontextusok javítás előtt egyetlen ciklusban sem tűntek el, most 22-ből 20-at a
gyűjtő elvitt. Az élő kontextus erőforrásai tíz cikluson át változatlanok, hiba
és konzolüzenet nélkül.

**Heap-meredekség: 481,0 → 196,3 KB/ciklus.** A maradék nem lineáris — húsz
cikluson mérve kifut:

| ciklustartomány | 1–5 | 6–10 | 11–15 | 16–20 |
|---|---|---|---|---|
| javítás előtt | 505,8 | 484,8 | — | — |
| javítás után | 245,8 | 172,5 | **22,8** | **40,0** |

Javítás előtt a meredekség lapos maradt, ami valódi ciklusonkénti visszatartás.
Javítás után a huszadik ciklusra ~30 KB/ciklusra esik, ami gyorsítótár-bemelegedés
(V8 kódgyorsítótár, GSAP belső állapot, Blink elrendezési és
`PerformanceObserver`-bejegyzések), nem visszatartás. **Ezt nem vezettük vissza
egyedi objektumokig** — a maradék nem tartalmaz WebGL-osztályt, és a
konstruktor-népszámlálásban `system / WeakArrayList`, `Object`,
`FunctionTemplateInfo`, `LayoutShift`, `DOMRectReadOnly` és `blink::ComputedStyle`
szerepel, azaz motor- és elrendezésbelső.

### 9.5 A képkockahurok parkolása — mindhárom állapot külön mérve

Minden minta rögzíti a canvas téglalapját, ami előállította, hogy egy soha be nem
következő állapotot ne lehessen elbukott állapotként jelenteni.

| állapot | canvas a képen | rajzolóhívás 1,5 s alatt | értékelés |
|---|---|---|---|
| teljes kigörgetés, 1440 × 900 | **igen**, −188…712 px | 4 860 | helyes — a canvas látszik |
| ténylegesen kigörgetve (távtartóval) | nem, −3 788…−2 888 px | **0** | parkol |
| lap elrejtve | igen | **0** | parkol |
| visszakapcsolás után | igen | 3 690 | visszaindul |

Javítás előtt a második sor **3 870–5 160** rajzolóhívást adott, korlátlanul.

### 9.6 A fényszám újramérése érvényes módszerrel

A `NUM_DIR_LIGHTS` regex nem volt „elromolva" — **nem tudott találni**. A three.js
soha nem bocsát ki ilyen `#define`-ot: a `replaceLightNums` (`three.module.js:5753`)
szövegesen behelyettesíti a tokent mindenhol, tehát a `#if NUM_DIR_LIGHTS > 0`
`#if 3 > 0`-ként ér a meghajtóhoz, és a név sehol nem marad meg.

A szám abban a deklarációban marad meg, amit méretezett. Erre mérve, a
meghajtónak átadott forrásból:

| build | shader | ebből megvilágított | fényszám |
|---|---|---|---|
| jelenlegi | 22 | 7 | **`dir=3 point=1`** |
| alap | 22 | 7 | **`dir=2 point=1`** |

Mind a hét megvilágított shader ugyanazt mondja, mindkét oldalon. Ez a 7. pont
következtetését — hogy a különbség a jelenetgráf harmadik irányfénye — **mérésre
váltja**: pontosan egy irányfénnyel több, minden megvilágított anyagban.

---

## 10. Amit ez a szakasz nem állít

- **A halott kontextusok GPU-oldali felszabadulását nem mértük közvetlenül.** Azt
  mértük, hogy `isContextLost()` igaz, és hogy a kontextusobjektumot a JS-gyűjtő
  elviszi. Hogy a meghajtó pontosan mikor adja vissza a videómemóriát, az a
  meghajtón múlik, és ebből a folyamatból nem látszik.
- **A maradék ~30 KB/ciklust nem vezettük vissza konkrét objektumokig.** Csak azt
  állítjuk, hogy nem WebGL-erőforrás, és hogy húsz cikluson kifut.
- **Csak asztali Chromiumon, egyetlen nézetablakban (1440 × 900) mértük.** Az
  életciklus-audit nem futott mobil viewporton, WebKiten és valódi telefonon.
- **A parkolás „lap elrejtve" ága felülírt `visibilityState`-tel és kézzel
  küldött `visibilitychange` eseménnyel készült**, mert a Playwright második lapja
  külön ablak, és az elsőt nem teszi rejtetté. Ez a `QualityManager` kezelőjét
  méri — ami a mi kódunk —, nem a böngésző saját háttér-rAF-fojtását.
- **A GLTF-gyorsítótár elengedésének költségét nem mértük.** Az újramount most
  újraértelmezi a GLB-t; hogy ez hány ezredmásodperc, arról nincs mérésünk.

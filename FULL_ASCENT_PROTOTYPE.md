# Stratos Ascent — a teljes 0–30 000 méteres útvonal

Produkciós jelölt. **Nem éles**, nem indexelt, és a gyökér `npm run build` nem
építi. A rövid, 0–8 000 méteres prototípus változatlanul megmarad mellette,
összehasonlítási alapnak.

| | |
|---|---|
| útvonal | `/experiments/stratos-ascent-full/` |
| rövid prototípus | `/experiments/stratos-ascent/` — érintetlen |
| build | `npm run build:full` |
| fejlesztés | `npm run dev:full` → `http://localhost:5176/full.html` |
| teszt | `npm run test:full` |
| mérés | `RUNS=3 node experiments/bench.mjs` (a `dist/`-et a 4324-es porton kiszolgálva) |
| a műszer | [ALTIMETER_MERIDIAN.md](ALTIMETER_MERIDIAN.md) |

Ez a jegyzet az **oldalról** szól: a tizenegy narratív szakaszról, a
légkörről, a betöltésről, a mobil sticky-átmenetről. Magáról a műszerről — a
rekeszről, a három gyűrűről, a zárási gesztusról, a világításról — az
[ALTIMETER_MERIDIAN.md](ALTIMETER_MERIDIAN.md) szól.

---

## 1. Kreatív koncepció

Egy emelkedés, nem effektek egymásra rakva. A teljes oldal egyetlen szám —
a magasság — függvénye: az ég színe, a felhősűrűség, a műszer fényereje, a
kamera, a Föld görbülete és a HUD mind ugyanabból az értékből olvas, ezért nem
tudnak egymással ellentmondásba kerülni. Ez a különbség egy „scroll-animált
oldal" és egy jelenet között.

A narratíva íve üzleti, nem díszítő: a földi kalibrációtól (ki vagy) a
felhőrétegen át (piaci zaj), az áttörésen keresztül (tisztaság) a bizonyításig
(munkák), a rendszerig, a folyamatig, végül a célmagasságig, ahol a konverzió
történik. A felhőáttörés a jelenet egyetlen erős érzelmi pillanata, és
szándékosan visszafogott: nincs lens flare, nincs kiégetett fehér kocka, nincs
hirtelen expozícióváltás.

---

## 2. Magassági szakasztérkép

A szakaszok egyetlen forrásból származnak: `experiments/src/full/journey.ts`
`STAGES`. A HTML, a HUD, a kamera, a légkör és a tesztek mind innen olvasnak.

| # | szakasz | magasság (m) | görgetési arány | mit csinál |
|---|---|---|---|---|
| 1 | `calibration` | 0 – 150 | 1.0 | sötét, precíz; főcím, első CTA, műszer bekapcsolás |
| 2 | `initial-ascent` | 150 – 3 000 | 1.4 | mutató mozdul, pára jelenik meg, pozicionálás |
| 3 | `lower-atmosphere` | 3 000 – 6 000 | 2.2 | hat terület sorrendben, magassági létraként |
| 4 | `cloud-entry` | 6 000 – 8 500 | 1.6 | felhősűrűség nő, látótávolság szűkül, világosabb |
| 5 | `cloud-breakthrough` | 8 500 – 11 000 | 1.6 | kilépés a rétegből, tág negatív tér, felhőtetők alul |
| 6 | `selected-work` | 11 000 – 17 000 | 4.4 | négy valódi ügyfél, ötrészes szerkezettel |
| 7 | `system` | 17 000 – 22 000 | 2.4 | kilenc terület három koncentrikus rétegben |
| 8 | `process` | 22 000 – 25 500 | 3.0 | hét ellenőrzőpont, négy kérdésre válaszolva |
| 9 | `stratosphere-transition` | 25 500 – 28 000 | 1.4 | kék indigóba fordul, csillagok, görbület sejlik |
| 10 | `full-stratosphere` | 28 000 – 30 000 | 1.4 | Föld-görbület, vékony horizontfény, zárócím |
| 11 | `destination` | 30 000 | 1.2 | konverziós CTA a kész jelenet előtt |

A `share` **nem** arányos a magassággal, és ez szándékos: a kalibráció 150
függőleges métert fed le, de egy teljes képernyőnyi görgetést kap, mert ott van
a főcím és az első CTA. A 11 000–17 000 méteres szakasz öt esettanulmányt visz,
ezért négy és felet.

### A magasságkurva kalibrálása

A `share` értékek **kiindulópontok**, nem igazságok. Betöltés után a
`useStageCalibration` megméri, hova kerültek ténylegesen a panelek, és a mért
határokkal felülírja a szakaszhatárokat (`journey.ts` → `calibrate`).

Ez nem elmélet. 390 px-en a négy esettanulmány egy oszlopba rendeződik és
4 575 px magas lesz a 2 922 px-es névleges kereténél, a folyamat rácsa pedig
további 1 229 px-szel fut túl. Kalibráció nélkül a narratíva ~2 900 px-szel
hosszabb lett volna a saját sávjánál, és a záró CTA a lábléc alá esett volna —
pontosan az a hiba, amit ez az útvonal javítani hivatott.

**Egy szakasz ott ér véget, ahol a következő kezdődik.** A mérés csak azt adja
meg, hol ér a panel teteje a nézet tetejére; a végét a `calibrate` a következő
panel kezdetéből vezeti le. Ez javítás, nem egyszerűsítés: a korábbi mérés a
panel *aljának* a nézet aljára érkezését adta végként, ami két, egymást erősítő
hibát okozott.

* Egy pontosan egy nézetnyi magas panel — és a kalibrációs panel szándékosan az
  — `end === start`-ot mért. A szakasz nulla görgetési szélességűvé esett össze,
  a magasságtérkép minden nullánál nagyobb haladásnál átugrotta, és mivel a
  csillapított haladás aszimptotikusan közelíti a nullát, de sosem éri el, a
  lefelé és vissza görgető látogató **150 méteren, a második szakaszban**
  állapodott meg, nem a 0 méteres alapállapotban. A műszer alapállapota egyetlen
  lebegőpontos epszilonra volt attól, hogy bármilyen görgetés után elérhetetlen
  legyen.
* Minden magasabb panelnél a mért vég egy nézetnyivel a következő panel kezdete
  előtt maradt, tehát a határok nem fedték le hézagmentesen a sávot: mind a
  tizenegy határon volt egy képernyőnyi görgetés, amire a magasságtérkép a
  következő szakasz alsó értékét adta. Tizenegy fennsík, ahol egy képernyőnyi
  görgetés egyáltalán nem mozdította a magasságot.

Mindkettőt ugyanaz a változtatás szünteti meg, és mindkettőnek van tesztje
(`full-ascent.spec.ts`, „Altimeter Meridian — as the visitor gets it").

---

## 3. Architektúra

```
experiments/
  full.html                      belépési pont (buildkor index.html-re nevezve)
  vite.full.config.ts            saját Vite-konfiguráció, saját chunk-gráf
  src/full/
    main.tsx                     gyökér + végső hibahatár
    FullAscent.tsx               képességvizsgálat, lusta betöltés, teljes HTML narratíva
    journey.ts                   szakasztérkép, magasságkurva, óra, kalibráció
    content.ts                   minden szöveg adatként (esettanulmányok, rendszer, folyamat)
    useJourneyScroll.ts          GSAP-driver, natív fallback-driver, kalibráció, pointer, láthatóság
    styles.css
    components/
      JourneyScene.tsx           Canvas + kódhasítási határ — csak innen érhető el a `three`
      JourneyCamera.tsx          síneken futó kamera, nézetarányhoz illesztett dolly
      Sky.tsx                    a teljes 0–30 000 m légkör egyetlen shaderben
      CloudDeck.tsx              közelítés → belépés → áttörés → felhőtetők
      EarthLimb.tsx              Föld-test + fresnel légkörhéj
      StarField.tsx              ritka csillagmező, 24 000 m felett
      SystemRings.tsx            koncentrikus rendszer + folyamat-ellenőrzőpontok
      JourneyAltimeter.tsx       a megosztott Blender-műszer, a teljes út óráján
      JourneyHUD.tsx             HTML magasságkijelző — és az óra tulajdonosa
      JourneyFallback.tsx        statikus SVG műszer
      SceneBoundary.tsx          hibahatár *csak* a WebGL részfa körül
      QualityManager.tsx         DPR-plafon, frameloop-parkolás, kontextusvesztés
      DebugPanel.tsx             kizárólag fejlesztői buildben
```

### Miért külön Vite-konfiguráció

Egy többoldalas build közös `base`-t, közös chunk-gráfot és közös
`emptyOutDir`-t jelentene. Következmény: egy itteni változtatás átnevezné és
érvénytelenítené a rövid prototípus chunkjait — miközben annak épp az a
feladata, hogy rögzített összehasonlítási alap maradjon. Két konfiguráció, két
kimeneti mappa, két független chunk-gráf. A forrásfa közös: ez az útvonal a
prototípus `@/lib/capabilities` moduljából olvas (állapotmentes, nincs benne
`three`), és **ugyanazt a GLB-t** tölti be ugyanarról az útvonalról.

### A magasságóra

Az órát pontosan egy komponens lépteti, és **nem a render-hurok**: az `advance()`
hívás a `JourneyHUD` saját `requestAnimationFrame`-jében van.

A frameloop parkol, amikor a canvas kigörgetődik vagy a fül háttérbe kerül. Egy
`useFrame`-ben élő óra vele együtt fagyna meg — egy 11 képernyős sávon ez azt
jelentené, hogy a magasság megreked az alsó légkörben és soha nem éri el a
30 000 métert. Ha az `advance()`-t máshol is meghívod, a magasság kétszeres
sebességgel fut.

**Két scroll-driver van, egyszerre mindig csak egy aktív:**

| útvonal | driver | miért |
|---|---|---|
| 3D fut | GSAP ScrollTrigger | resize-tudatos, megbízható leképezés |
| statikus fallback (nincs WebGL / kontextusvesztés) | natív `scroll` figyelő | a GSAP letöltése értelmetlen egy olyan úton, amely már visszautasította a renderert — de a kijelző így sem hazudik |
| csökkentett mozgás | egyik sem | a sáv fel van oldva, nincs mit követni |

---

## 4. Betöltési stratégia és chunkolás

`vite.full.config.ts`-ben **nincs `manualChunks`**, és ez nem elfelejtett
alapértelmezés. A `three` és a `@react-three/*` kézi chunk-ként megnevezése
*statikus* importtá teszi őket a belépési chunkban — a Rollup a megnevezett
chunkot a dinamikus import határa fölé emeli —, a Vite pedig `modulepreload`
linket ír rájuk az HTML-be. A csökkentett mozgású út így ~1,1 MB renderert
töltene le, amit már eldöntött, hogy nem használ; közben minden futásidejű
lusta-betöltési teszt tovább zöld maradna, mert az import formálisan továbbra
is dinamikus.

Ezért a `full-ascent.spec.ts` a **kimeneti fájlokat** vizsgálja, nem a hálózati
naplót:

- a dokumentum pontosan egy scriptet hivatkozik, és az nem a jelenet-chunk;
- nincs `modulepreload` a 3D kódra;
- a belépési chunk nem tartalmazza a `WebGLRenderer`, `BufferGeometry`,
  `PerspectiveCamera` azonosítókat;
- a jelenet-chunk viszont **igen** — különben a fenti állítás azt is jelenthetné,
  hogy a `three` sehol sincs;
- a `DebugPanel` chunk nem jön létre.

Szakaszhoz kötött betöltés: a `StagedGeometry` csak akkor csatolja a
rendszergyűrűket, az ellenőrzőpontokat, a csillagmezőt és a Földet, ha a
magasság a saját szakaszuk közelében van (hiszterézissel, hogy egy határon
parkoló látogató ne kapcsolgassa keretenként).

---

## 5. Blender-eszközök

**Nem készült új Blender-eszköz, és ez mérésen alapuló döntés.**

| eszköz | forrás | GLB | gzip | státusz |
|---|---|---|---|---|
| Stratos altiméter | `assets/blender/stratos-altimeter.blend` (298 KB) | `public/models/stratos-altimeter.glb` — 388 KB | 136 KB | **változatlan**, megosztva a rövid prototípussal |

A brief négy lehetséges új eszközt vetett fel. Mindegyik olcsóbban és jobban
megoldható geometriával vagy shaderrel, és a brief maga is ezt kéri („ne készíts
nagy eszközöket olyan effektekre, amiket shader vagy CSS hatékonyabban elvégez"):

| felvetett eszköz | amit helyette használunk | miért |
|---|---|---|
| légköri navigációs gyűrűk | `torusGeometry` × 3 + `circleGeometry` × 9 | néhány száz háromszög, futásidőben; egy GLB ugyanezért hálózati kört fizetne |
| Stratos rendszer-geometria | ugyanaz a gyűrűrendszer | a jelentést a mellette lévő HTML hordozza, nem a mesh |
| horizont / Föld-perem | procedurális gömb + fresnel héj | egy textúrázott Föld 4–16 MB; ezen az expozíción a felszín amúgy is majdnem fekete |
| minimális ellenőrzőpont-elemek | `ringGeometry`, egy megosztott geometriával | hét jelölő, egy geometria, egy anyag |

A `.blend` forrás nem kerül a deploy-artefaktumba: az `assemble.mjs` kihagyja az
`assets/blender`-t.

---

## 6. Föld és légkör

A legkönnyebb hitelt érdemlő megoldás, textúra nélkül.

**Ég** (`Sky.tsx`) — egy befelé néző gömb, tizenkét soros fragment shaderrel.
Ez váltja ki azt, ami különben négy külön réteg lenne (háttérszín, gradiens,
horizontfény, ködszín), amelyek mind külön hihetnék, hogy más magasságon
vannak. Egy shader, egy magasság, nem tud önmagával vitatkozni. Költség: 1 draw
call, nulla textúra, nulla render target. Tartalmaz rendezett ditheringet is,
mert egy nagy, sima gradiens 8 bites csatornákon láthatóan sávosodik.

**Föld** (`EarthLimb.tsx`) — két gömb:
- a test, sekély terminátorral, hogy a megvilágított perem elváljon a mögötte
  lévő tömegtől;
- egy 2%-kal nagyobb héj, hátlapokkal renderelve, inverz fresnel eloszlással —
  ez adja a vékony fénylő ívet a horizonton.

A sugár 9 egység, **nem méretarányos**, és ez az egyetlen tudatos hazugság a
jelenetben. Egy 30 km-ről arányosan helyes görbület szagittája a képmagasság
~2%-a: technikailag pontos, és megkülönböztethetetlen az egyenestől — ami az
egyetlen dolog, amit ennek a képnek nem szabad. Az első verzió 30-as sugárral,
35 egységgel lejjebb ült, és a teljes gömb a képkocka alá esett: a záró jutalom
üres égbolt volt.

**Csillagok** — 420 pont asztali szinten (mobilon 180), meredek fényesség-
eloszlással, a horizont felé halványodva. Nincs köd, nincs galaxis: 30 km-ről
még a légkörben vagy.

---

## 7. Reszponzív szintek és hibrid kiszolgálás

| szint | feltétel | mit kap |
|---|---|---|
| **teljes 3D** | WebGL van, nincs csökkentett mozgás, finom mutató, ≥820 px | antialiasing, 44 felhő-quad, 420 csillag, 128-as env map, kurzor-parallax (max 2°) |
| **csökkentett 3D** | WebGL van, de érintés vagy keskeny nézet | nincs antialiasing, 16 felhő-quad, 180 csillag, 64-es env map, nincs parallax, DPR-plafon 1.5 |
| **könnyű fallback** | csökkentett mozgás, nincs WebGL, kontextusvesztés, vagy inicializálási hiba | statikus SVG műszer, **semmilyen 3D kód nem töltődik le**, teljes HTML tartalom |

A képességvizsgálat mountolás után fut, sosem renderelés közben, és semmi nem
importál `three`-t a `JourneyScene` fölött.

### Mobil sticky-átmenet

A rövid prototípus ismert hibája: a sáv végén a sticky szakasz kigörgetődött, a
CTA pedig alatta, sima folyamban érkezett — technikailag működött, véletlennek
látszott.

A javítás nem az átmenet elsimítása, hanem **az átmenet megszüntetése**. A záró
CTA az utolsó panel *a sticky konténeren belül*, így a jelenet — Föld-görbület,
vékony horizont, csillagok — egyszerűen ott marad mögötte, egészen a lábléc
kezdetéig. Nincs mit elrejteni, nincs időzítendő átúsztatás, és nincs
nézetmagasság-aritmetika, amit egy mozgó címsáv elronthatna.

Mértékegység: `svh`, nem `vh` és nem `dvh`. A `vh` iOS-en a *nagy* nézetmagasság,
tehát látszó címsáv mellett a sticky szakasz magasabb a látható területnél; a
`dvh` követi a címsáv mozgását, vagyis a sáv magassága görgetés közben változik,
a leképezés elcsúszik és a magasság ugrik. Az `svh` a kicsi nézet, munkamenetre
rögzítve.

A HUD mobilon műszercsík a képernyő tetején, saját fedő háttérrel. Sarokban lévő
kijelzőként kétszer is elbukott: lent a teljes szélességű panellapra ült, fent
pedig átírt minden épp elhaladó címsort — egy három nézetmagasságnyi panel
elkerülhetetlenül átgörgeti a saját címét egy fix elem alatt. A célmagasság
paneljén teljesen elhalványodik: addigra a panel saját szemöldökszövege
kiírja a 30 000 métert. Az elem mountolva marad, mert ő birtokolja az órát.

---

## 8. Tartalom és 3D viszonya

Minden, ami jelentést hordoz, HTML: címsorok, bekezdések, gombok,
esettanulmányok, folyamatlépések, CTA. A jelenet a vizuális narratíva rétege,
nem a tartalomé. Ez az, ami lehetővé teszi, hogy a csökkentett mozgású út
egyszerűen **ne töltse le** a jelenetet, ahelyett hogy külön tartalmi
stratégiára lenne szüksége.

### Az esettanulmányokról — fontos

Semmi nincs kitalálva. Minden állítás visszavezethető valamire, ami már a
repóban van: a Rapidkert-idézet a főoldalon publikált referencia, a logók és
képernyőképek a már szállított `assets/img/` tartalmak.

**A `metric` mező csak ott van kitöltve, ahol a számnak megnevezett forrása
van.** A Rapidkertnek van: `~15M Ft` szerződött projektérték keresésből — ugyanaz
az érték és ugyanaz a felirat, amit a `munka-rapidkert.html` esettanulmány közöl.
A másik két bejegyzésen `null`, és ez ott továbbra is megállapítás, nem mulasztás:
igazolt számszerű eredmény nincs hozzájuk. A brief pontos metrikát kért *ahol
igazolt metrika létezik*, és megtiltotta a kitalálásukat. A layout rendereli a
sort, ha van érték, és teljesen elhagyja, ha nincs.

A szám **szerződött projektérték** — nem árbevétel és nem nyereség. Egy teszt
őrzi, és a `WORK` táblából vezeti le a szerződést, nem egy megjegyzett
darabszámból: minden esethez pontosan akkor és csak akkor tartozik metrikasor, ha
a tartalmi táblában van hozzá forrásolt szám, és a sor pontosan azt írja, amit a
tábla. Így a Rapidkert metrikájának elvesztése és egy kitalált szám megjelenése
ugyanúgy bukik.

**Az „Uncensored Society" és a „Brickness Community" nem szerepel**, mert a
repóban sehol nincs hozzájuk anyag — se szöveg, se logó, se képernyőkép.
A hozzáadásukhoz forrásanyag kell, nem kód.

---

## 9. Csökkentett mozgás — tesztarchitektúra

A Playwright 1.62.1 deklaratív `reducedMotion` beállítása ebben a projektben
**nem ér el a `matchMedia`-ig**. Ez most már nem feltételezés: a
`reduced-motion test environment` teszt kísérletileg bizonyítja, hogy csak a
projektbeállítással a lap `matchMedia('(prefers-reduced-motion: reduce)').matches
=== false` értéket ad, **és canvast renderel**.

Minden csökkentett mozgást állító teszt a `tests/helpers/reduced-motion.ts`
segédjét használja, amely kettőt csinál, és a másodikat nem hagyja el:

1. `page.emulateMedia({ reducedMotion: 'reduce' })` — navigáció *előtt*, mert az
   alkalmazás egyszer olvassa a média-lekérdezést, a képességvizsgálatnál;
2. navigáció *után* a lapon belülről ellenőrzi, hogy a lekérdezés tényleg
   átbillent, és hangosan elbukik, ha nem.

A deklaratív opció a konfigurációkban marad — kanárimadárként. Ha egyszer
elkezd működni, a regressziós teszt elbukik, és a segéd újragondolható.

---

## 10. Mérési eredmények

Részletek: [PERFORMANCE_COMPARISON.md](PERFORMANCE_COMPARISON.md).

Valódi GPU, 4× CPU-fojtás, 1440×900, azonos szkriptelt görgetés, három futás
mediánja:

| | jelenlegi hero | 0–8 000 m prototípus | **0–30 000 m** | full (csökk. mozgás) |
|---|---|---|---|---|
| LCP | 3 032 ms | 164 ms | **4 348 ms** | 212 ms |
| medián képkocka | 8,4 ms | 8,3 ms | **8,3 ms** | 8,3 ms |
| p95 képkocka | 25,1 ms | 9,2 ms | **9,2 ms** | 9,2 ms |
| 30 fps alatti kockák | 2 / 563 | 0 / 720 | **0 / 720** | 0 / 720 |
| hosszú feladatok | 1 (107 ms) | 3 (184 ms) | **3 (177 ms)** | 0 |
| JS heap betöltés/görgetés után | 1 / 1 MB | 8 / 9 MB | **9 / 10 MB** | 2 / 2 MB |
| átvitt adat (tömörítetlen) | 1 057 KB | 1 601 KB | **3 112 KB** | 1 664 KB |

Gzippelt, lemezről: eager **60 KB** (3 fájl), lusta **306 KB** (3 fájl),
GLB **136 KB**.

---

## 11. Ismert korlátok

1. **Az esettanulmány-képek a legnagyobb tétel, nem a 3D.** A hat megosztott
   kép 1 474 KB tömörítetlenül — közel négyszerese a GLB-nek —, és a
   csökkentett mozgású út 1 664 KB-jának is szinte az egésze. A
   `client-barbershop.png` 359 KB, a `client-pille.png` 235 KB: ezek kis logók.
   **Nem nyúltam hozzájuk**, mert az éles oldal is ezeket használja, és a brief
   védettnek jelölte a megosztott tartalmat. Újrakódolásuk (WebP/AVIF, méretre
   vágott logók) a legnagyobb egyszeri nyereség ezen az útvonalon.
2. **A 4 348 ms-os LCP ennek a következménye**, és részben a mérési mód
   műterméke: a szkriptelt görgetés minden képet a nézetbe hoz, az LCP-megfigyelő
   pedig az utolsó nagy festést jegyzi. Valódi látogatónál a kép a hajtás alatt
   van, `loading="lazy"` attribútummal. Attól még ez a szám az, amit optimalizálni
   kell.
3. **A `dev:full` a `/full.html` címen szolgál ki**, nem a gyökéren, mert a
   projekt gyökerében az `index.html` már a rövid prototípusé. Csak fejlesztésre
   vonatkozik; a build `index.html`-t ír.
4. **Nincs Lenis.** A brief megtartandó rendszerként sorolja, de a prototípus
   sosem vezette be: az éles oldal nem szállít smooth-scroll könyvtárat, és egy
   bevezetése két hero-technika összehasonlítását két görgetésmodell
   összehasonlításává tenné — iOS-en ráadásul a natív lendületet cseréli le egy
   JS-közelítésre, ami épp a mobil sticky-átmenetet rontaná el.
5. **A magasságkurva a mért elrendezésből kalibrálódik**, ezért egy nagyon
   hosszú fordítás vagy jelentősen nagyobb betűméret arányaiban átrendezi a
   szakaszokat. Ez szándékos — a helyes viselkedés —, de azt jelenti, hogy a
   `share` értékek nem garantálják a pontos görgetési arányokat minden
   eszközön.
6. **A mobil `simplified` szint a `pointer: coarse` vagy `<820 px` alapján dől
   el**, nem valódi teljesítménymérésből. Egy nagy teljesítményű táblagép a
   csökkentett szintet kapja. A `PerformanceMonitor` ezt futásidőben korrigálja
   lefelé, felfelé nem.

---

## 12. Produkciós integrációs javaslat

Lásd [PERFORMANCE_COMPARISON.md](PERFORMANCE_COMPARISON.md) 5. pontját a
mérésekre alapozott, részletes ajánlásért.

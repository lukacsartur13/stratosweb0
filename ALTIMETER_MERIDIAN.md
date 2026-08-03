# Altimeter Meridian

A Stratos altiméter kibontása háromtengelyű térbeli műszerré, 0-tól 30 000
méterig. **Nem egy másik objektum**, amit a magasságmérő mögé rejtettünk: a
gyűrűk a modell saját alkatrészei, és a rekesz a számlap saját középlapja alá
került. A látogató végig ugyanazt a tárgyat nézi.

| | |
|---|---|
| útvonal | `/experiments/stratos-ascent-full/` |
| fejlesztés | `npm run dev:full` → `http://localhost:5176/full.html` |
| build | `npm run build:full` |
| teszt | `npm run test:full` |
| hibakereső panel | `?meridianDebug=1`, vagy a bal alsó sarok ikonja fejlesztésben |

A körülötte lévő oldal — a tizenegy narratív szakasz, a felhőréteg, a Föld
görbülete, a HUD, a mobil sticky-átmenet — a
[FULL_ASCENT_PROTOTYPE.md](FULL_ASCENT_PROTOTYPE.md)-ban van dokumentálva. Ez a
jegyzet csak a műszerről szól.

---

## 1. A vezérlő elv

**Minden képkocka a magasság tiszta függvénye.** Nincs felhalmozott
animációs állapot, nincs „ez az esemény már lefutott" jelző. A visszafelé
görgetés, az oldal közepére ugrás, egy átméretezés utáni újrakalibrálás és a
hibakereső csúszkája mind ugyanazt a képkockát adja ugyanarra a méterértékre,
mert a képkockát **levezetjük**, nem integráljuk.

Egyetlen kivétel van, és az szándékos: a gyűrűk saját tengely körüli forgása
felhalmozódik — de csak zárt állapotban, és nem zárt állapotban visszacsillapodik
a kiindulási szögre. Egy visszafelé görgetéssel visszaültetett gyűrű tehát abban
az orientációban ül vissza, amelyben készült, nem egy véletlen szögben.

Ezt a `full-ascent.spec.ts` méri: két független állapotobjektum bejárja
ugyanazt a 301 magasságot ellentétes irányban, és a két sorozatnak
bájtra egyeznie kell.

---

## 2. Fájlok

```
experiments/src/full/
  meridian.ts                     a műszer teljes idővonala — magasság → mechanikai állapot
  journey.ts                      görgetés → magasság, narratív szakaszok (korábbról)
  meridianSound.ts                opcionális, alapból néma mechanikus hangok
  components/
    AltimeterMeridian.tsx         a GLB szétosztása négy szerelvényre, mutatók, póz, gimbal
    meridianParts.ts              minden geometria és anyag, amit a Meridián a GLB-hez ad
    ApertureCore.tsx              a tizenegy lamellás írisz
    MeridianRing.tsx              egyetlen gyűrűimplementáció — mindhárom ez, más számokkal
    MeridianAxis.tsx              a rögzített központi tengely
    MeridianLights.tsx            magasságvezérelt világítás
    JourneyScene.tsx              a Canvas és a kódhasítási határ
    JourneyHUD.tsx                a magasságóra, az élő régió és a hangkapcsoló
    JourneyFallback.tsx           a hat diszkrét állapot SVG-ben
    DebugPanel.tsx                fejlesztői vezérlés (production build nem tartalmazza)
```

A `meridian.ts` **nem importál `three`-t**, és ez nem véletlen: a statikus
tartalék útvonal is ebből olvassa ki, melyik állapotot rajzolja, tehát elérhető
kell legyen a renderer nélkül. A build-teszt ezt ellenőrzi.

---

## 3. Magassági idővonal

```ts
const ALTITUDE_STOPS = {
  baseline: 0, firstSignal: 3_000, firstRing: 7_000, breakthrough: 12_000,
  secondRing: 18_000, thirdRing: 24_000, meridian: 30_000,
};
```

| magasság | esemény | mit lát a látogató |
|---|---|---|
| 0 | alapállapot | teljes, felismerhető számlap; a rekesz kalibrált résre húzva (0,055); mindhárom gyűrű a számlap síkjában |
| 0–3 000 | első jel | a mutató a görgetést követi; a rekesz egy kattanásnyit nyílik (0,17); a pára fogyni kezd |
| 3 000–7 000 | kalibráció | a külső skála elválasztó vonala láthatóvá válik; a rekesz fokozatosan 0,30-ig |
| **7 000** | **1. gyűrűzár** | a külső magassági skála kiemelkedik, megáll, megdől, és egyszer bereteszel |
| 7 000–12 000 | emelkedés | az 1. gyűrű lassan forog; a rekesz 0,45-ig; a kristály kitisztul |
| **12 000** | **rekesznyitás** | a lamellák teljes nyitásig futnak, az utolsó harmadban gyorsulva, egy pontos megállással |
| 12 000–18 000 | rendszerbővítés | nyugalom; a belső skála varrata megjelenik |
| **18 000** | **2. gyűrűzár** | a belső kalibrációs skála más tengelyre zár; a giroszkopikus önszintezés bekapcsol |
| 18 000–24 000 | vezérelt mozgás | eltérő forgási sebességek; a burkolat néhány milliméterrel nyílik |
| **24 000** | **3. gyűrűzár** | a hátsó szerkezeti keret leválik, kifelé tágul, és a legnagyobb, leglassabb gyűrűként zár; sárga tanúsító vonal a varraton; a rekesz visszazáródni kezd |
| 24 000–30 000 | végkalibráció | a mozgás összehangolódik és lecsendesedik; a számlap újra teljesen olvasható |
| 30 000 | Meridián | a kész műszer; a rekesz pontosan 0,72-n áll |

A rekesz három értéke — 0,055 / 1,00 / 0,72 — **beállítás, nem hangolási
paraméter**. A `apertureOpen()` előjeles hozzájárulások összege, nem szakaszos
elágazás, ezért szakaszonként monoton, mindenütt folytonos, és nem tud olyan
állapotba kerülni, amit a visszafelé irány ne tudna reprodukálni.

A 12 000 méteres pillanat **nem** kap külön értesítést a felhőrétegtől: a
`CloudDeck` és a rekesz ugyanazt a magasságot olvassa, ezért nem tudnak
kicsúszni egymásból.

---

## 4. Honnan jön minden alkatrész

Ez a jegyzet legfontosabb táblázata. Egyik gyűrű sem érkezik a képen kívülről,
és egyik sem jelenik meg átlátszóságból.

| | a GLB csomópontjai | mi volt korábban |
|---|---|---|
| 1. gyűrű | `ALT_Chapter_Ring`, `ALT_Ticks_Major` | a külső magassági skála |
| 2. gyűrű | `ALT_Ticks_Minor` | a belső kalibrációs skála |
| 3. gyűrű | `ALT_Housing_Flange` | a hátsó szerkezeti keret |
| nyíló burkolat | `ALT_Housing_Bezel`, `ALT_Glass_Crystal` | az előlap és a kristály |
| mag | minden más | számlap, számok, feliratok, márkajel, agy, mutatók |

Felcsatoláskor a csomópontok **átkerülnek** a megfelelő csoportba — nem
elrejtjük és lemásoljuk őket. 0 méteren minden csomópont azon a transzformáción
áll, amit a Blenderben kapott, egy identitás-transzformációjú csoporton belül,
tehát a műszer pontosan úgy renderelődik, ahogy mindig is. Amikor egy gyűrű
kiemelkedik, a **valódi** külső skála emelkedik ki — az a beosztás, amihez a
látogató egy pillanattal korábban a mutatót olvasta.

Ha az 1. gyűrű elviszi a fő osztásokat, a számlap nem marad skála nélkül: az
ülék, amiből a gyűrű kiemelkedik, be van vésve azzal a tízes beosztással, ami
odaültette.

Egy átnevezés a `.blend`-ben fejlesztésben **hibát dob**, nem üres gyűrűt ad.

---

## 5. A gyűrűzár

Egy gesztus, négy fázis, háromszor felhasználva. A fázisarányok mindhárom
gyűrűn azonosak: amitől a harmadik zár felismerhető ugyanannak az eseménynek,
mint az első, az a **ritmus**, nem a geometria.

```
0,00 – 0,20   varrat    elválasztó vonal jelenik meg. Semmi nem mozdul.
0,20 – 0,46   emelés    a gyűrű egyenesen kiemelkedik az ülékéből.
0,46 – 0,54   tartás    megáll. A fájl legfontosabb nyolc százaléka: enélkül az
                        emelés és a döntés egyetlen suhanásnak látszik, és a
                        látogató sosem látja, honnan jött a gyűrű.
0,54 – 1,00   utazás    megdől és a végleges tengelyére áll, nulla sebességgel
                        érkezve, pontosan egyszer bereteszelve.
```

A különbségek kizárólag paraméterek:

| | sugár (zárás után) | tömeg | alapjárati fordulat | végtengely |
|---|---|---|---|---|
| 1. gyűrű | 0,40 | 0,15 | 0,052 rad/s | közel vízszintes |
| 2. gyűrű | 0,34 | 0,45 | 0,031 rad/s | közel függőleges |
| 3. gyűrű | 0,75 | 1,00 | 0,017 rad/s | ferde |

Az `arrive(t, mass)` görbe: vezérelt gyorsulás, hosszú lassulás, pontos
érkezés, **visszalendülés nélkül**. A nagyobb tömeg nagyobb kitevőt kap —
korábban elkötelezi magát, és tovább vezeti le a sebességet. Ez az, ahogy a
tehetetlenség kinéz, ha semminek nem szabad túllőnie.

A teszt mindhárom gyűrűre monotonitást és `[0, 1]` korlátot állít mindkét
csatornán, tehát a „nincs visszapattanás" nem stílusnyilatkozat.

---

## 6. A rekesz

Valódi íriszdiafragma, nem zárgrafika. Tizenegy lamella, mindegyik egy
osztókörön rögzített pont körül fordul; a vágóél egy `Rb` sugarú ív, melynek
középpontját egy `e` hosszúságú forgattyú viszi. A lyuk sugara pontosan:

```
r(φ) = sqrt(Rp² + e² − 2·Rp·e·cos φ) − Rb
```

Fudge-faktor nélkül: 0,0040 zárva, 0,0442 teljesen nyitva, 0,0321 a 0,72-es
kalibrált beállításon. A számokat erre a három értékre oldottuk meg, majd a
tizenegy lamella poligonuniójának raszterezésével ellenőriztük huszonegy
nyitáson — a nyílás csipkés és tizenegyszögű, ahogy kell, és sehol nincs
fedetlen cella a lemezen, semmilyen φ-nél.

Rétegzés a számlaptól kifelé, és ez az egész ok, amiért a számok azok, amik:

```
z 0,0530   számlap felszíne (GLB)
z 0,0540   süllyesztés alja
z 0,0545…0,0587  tizenegy lamella, mind saját síkon
z 0,0538…0,0598  tartógyűrű, a lamellák külső fele fölött
z 0,0610   másodlagos mutató — a kemény plafon
```

**A mutatók a rekesz fölött haladnak el, és soha nem takarja őket.** Ez
geometriából következik, nem rajzolási sorrendből, tehát egy rendezési változás
nem tudja elrontani.

A lemez 0,11 egység átmérőjű a 0,41-es számlapon: pontosan a „×1000 m" és az
„ALTITUDE" felirat közti szabad sáv. Ennél nagyobb rekesz letakarna valamit,
amit a műszer már mond.

---

## 7. Világítás

A jelenet fényei **a magasság függvényei** (`MeridianLights.tsx`). Korábban
négy állandó voltak, és ez addig volt védhető, amíg a tárgy egy számlap volt.

| | 0 m | 12 000 m | 30 000 m |
|---|---|---|---|
| ambiens | 0,55 | 0,40 | 0,52 |
| fő fény | 3,4 | 4,8 | 5,8 |
| kitöltő | 1,4 | 1,07 | 1,65 |
| kontúr | 0 | 0 | 2,2 |

(A 12 000 méteres oszlop a `clarity ≈ 0,96` értékből adódik — a tisztulás
12 500 méterig fut ki, nem 12 000-ig.)

A rétegen át **az ambiens csökken**, miközben a fő fény nő: a műszer nem
világosabb lesz, hanem plasztikusabb — így néz ki fémen az, hogy „elment a
pára". A tetején az ambiens részben visszatér, mert a sztratoszféra majdnem
fekete, és egy csak elölről megvilágított műszer üres háttér előtt kivágott
papírfigurának látszik, nem térben álló tárgynak.

A kontúrfény az egyetlen, amit egyáltalán **bekapcsolunk**, és csak a harmadik
gyűrűvel érkezik — az az első képkocka, ahol van elválasztandó sziluett.

Nincs bloom, nincs utófeldolgozás, nincs második renderelési menet. Négy skalár
szorzás képkockánként.

A 30 000 méteres állapotban a számlap jelzéseinek emissziója 18%-kal
visszaemelkedik. Ez helyreállítás, nem kiemelés: a lapot addigra két megvilágított
gyűrű keresztezi 27°-os elfordulásban, és mindkettő olvashatóságot vesz el.

---

## 8. Anyagok

Egyetlen modul építi, egyszer, megosztva mindhárom gyűrű és a rekesz között
(`meridianParts.ts`). A JSX-ben szebben olvasó alternatíva — komponensenként egy
`<meshStandardMaterial>` — tizenegy azonos lamella-anyagot, tizenegy
shader-programot és képkockánként tizenegy uniform-feltöltést jelentene.

| | szín | fémesség | érdesség |
|---|---|---|---|
| gyűrűszalag | `#6a7683` hideg titánszürke | 0,55 | 0,36 |
| vésett jelzés | `#b2c1d1` | 0,35 | 0,45 |
| rekeszlamella | `#2b333d` sötét fegyverfém | 0,60 | 0,28 |
| tartógyűrű | `#545f6b` | 0,60 | 0,30 |
| központi tengely | `#8c96a2` | 0,60 | 0,24 |

A fémesség 0,55, nem 0,9, és ez **világítási, nem anyagi döntés**: a jelenetben
nincs HDRI — a környezet három futásidőben épített lapos emitter, épp azért,
hogy semmi ne menjen át a hálózaton —, és egy majdnem tiszta fém, amiben nincs
mit tükrözni, feketén renderelődik.

Egyetlen sárga: `#ffda05`, a GLB saját `MAT_Signal_Beacon` színe, nem az oldal
`--signal` értéke — így a tanúsító jelek a számlapon már ott lévő plafonívvel
egyeznek, nem egy második, majdnem azonos sárgával. Csak esemény kapcsolja be:
zárás visszaigazolása és a rekesz kalibrációs jele. Az első két gyűrű jele
felvillan és elalszik; a harmadiké égve marad — az az utolsó záródó illesztés
tanúsító vonala, és a műszer akkor van kész, amikor világít.

---

## 9. A rögzített tengely és a gimbal

A központi tengely a `gimbal` csoporton **kívül** van, és a mag is. Csak a három
gyűrű ül a gimbalban. A tengely 0-tól 30 000 méterig nem billen, nem hajlik, nem
mozdul el a középpontból.

A giroszkopikus önszintezés csak a **második** gyűrűzár után kapcsol be — előtte
nincs kéttengelyű rendszer, aminek ez tulajdonsága lehetne. A zavarás valódi
bemenet (kurzor és görgetési sebesség), a válasz a fok töredéke, a nyugalmi
állapot vízszintes. A csillapítás aszimmetrikus: gyorsabban reagál, mint amilyen
gyorsan visszaáll — ettől olvasódik szintezésként, nem imbolygásként.

---

## 10. Reszponzív viselkedés

| | asztali | tábla | mobil |
|---|---|---|---|
| háromnegyedes elfordulás | 27° | 27° | 11° |
| kurzor-parallax | ≤2° | csökkentett | nincs |
| lamella-ívfelbontás | teljes | teljes | durvább |
| gyűrűjelzések száma | 100% | 100% | 50% |
| DPR | ≤2 | ≤1,5 | ≤1,5 |

**Mind a hat szerkezeti állapot minden méreten megmarad.** Mobilon a kivitel
egyszerűsödik, a történet nem: a rekesz működik, mindhárom gyűrűzár lefut, csak
a mozgás amplitúdója és a geometria felbontása kisebb. A telefonon a műszer nem
középre, hanem **feljebb** kerül — középre téve a számlap a bekezdés mögé
kerülne.

---

## 11. Csökkentett mozgás és tartalék

Három képességi szint:

1. **Teljes** — teljes geometria, dinamikus világítás, minden állapot.
2. **Csökkentett** — egyszerűsített geometria, alacsonyabb DPR, kevesebb
   tükröződés, ugyanazok a szerkezeti állapotok.
3. **Statikus** — a `JourneyFallback` SVG műszere a **hat diszkrét
   állapottal**: alapállapot, első gyűrű, rekesznyitás, második gyűrű, harmadik
   gyűrű, Meridián. Ugyanabból a `MERIDIAN_STAGES` listából olvas, mint az élő
   régió, tehát nem tud kicsúszni belőle.

Ezen az úton a jelenet **folyamban** van, nem ragadva: a statikus műszer egy
ábra, a narratíva pedig alatta következik. Ehhez a `.journey__content`
egy nézetnyi felhúzását (`margin-top: -100svh`) is vissza kell vonni, nem csak a
`position: sticky`-t — az animált elrendezésben a felhúzás azért van, hogy a
szöveg a ragadó 100svh-s jelenetre kerüljön rá. Ha csak a ragadás szűnik meg, a
szöveg továbbra is egy teljes nézettel feljebb kerül, miközben a jelenet már csak
60svh magas: a narratíva 40svh-val a dokumentum teteje **fölött** kezdődik, ahová
semmilyen görgetési pozíció nem ér el. 1440×900-on ez a teljes főcímet levágta.

A csökkentett mozgást a **valódi** böngészőlekérdezés dönti el
(`matchMedia('(prefers-reduced-motion: reduce)')`), futásidőben is figyelve, és a
teszt ezt bizonyítja is a lapon belülről — lásd
`tests/helpers/reduced-motion.ts`, ami elutasítja, hogy csak beállítsa a
médiaállapotot anélkül, hogy ellenőrizné, tényleg átbillent-e. Egy zöld
csökkentett-mozgás teszt, ami sosem kapcsolta be a csökkentett mozgást, rosszabb,
mint a teszt hiánya, mert bizonyítékként hivatkoznak rá.

Ezen az úton a renderert **le sem töltjük** (~1,1 MB), nem pedig letöltjük és nem
használjuk.

---

## 12. Hozzáférhetőség

* minden szöveg HTML-ben van, a canvason kívül, kijelölhetően és indexelhetően;
* a magasságnak van szöveges megfelelője;
* két élő régió: az egyik azt mondja, hol tart az **oldal**, a másik azt, mit
  tett a **műszer** — utóbbi az egész út alatt hatszor szólal meg, ami az
  egyetlen ok, amiért egyáltalán bejelenthető;
* a hang alapból ki van kapcsolva, van kapcsolója, és csak küszöbátlépéskor
  szólal meg, visszapergéskori ismétlés elleni késleltetéssel;
* nincs görgetéselvonás, nincs kényszerített szekvencia, a fókuszállapotok
  láthatók.

---

## 13. Hibakereső panel

Fejlesztői buildben a bal alsó sarok ikonjával nyílik, `?meridianDebug=1`-gyel
pedig már betöltéskor nyitva van. **Production buildben egyáltalán nem létezik**
— a modult `import.meta.env.DEV` mögé importáljuk, tehát a chunk nem is
keletkezik, és a query paraméter ott nem csinál semmit. A teszt a lefordított
fájllistát ellenőrzi rá.

Vezérelhető: magasság (0–30 000, gyorsgombokkal a hét megállóra), rekesznyitás,
gyűrűnkénti zárási haladás, gyűrűforgás, kameratávolság, műszer-elfordulás,
fényerő, végkalibráció, minőségi szint, kényszerített tartalék útvonal.

---

## 14. Tesztek

`npm run test:full`. A műszerre vonatkozó rész két félből áll:

**Tiszta függvények, Node-ban, böngésző nélkül** — a rekesz három pontos
beállítása és a köztük lévő monotonitás; az írisz réstelen záródása és szigorúan
növekvő nyílása; a gyűrűk sorrendben, egyesével záródnak, és egyik sem indul,
amíg az előző be nem zárt; mindhárom gyűrű ugyanazt a négyfázisú gesztust futja,
monoton és korlátos csatornákkal (nincs túllövés); az egész állapot mindkét
irányból bitre azonos; a hat bejelentett állapot lefedi a tartományt és nem
futhat visszafelé.

**A lapon, a lefordított oldal ellen** — a lefelé és vissza görgetés visszahozza
a műszert a 0 méteres alapállapotba; a magasság szakaszhatáron sem áll meg; a hat
szerkezeti állapot sorrendben hangzik el, és visszafelé pontosan fordítva.

---

## 15. Ismert korlátok

1. **A háromnegyedes elfordulást a tárgy csinálja, nem a kamera.** A kamera a
   égboltot, a felhőréteget és a Föld-peremet is keretezi, amik mind szemből
   vannak megkomponálva; ráadásul a műszer jócskán a világ origóján kívül ül,
   tehát az origó körüli kameraorbit nem is a műszert kerülné meg. Ez ugyanaz a
   kép a mellékhatások nélkül — de azt jelenti, hogy a kompozíció nem tud
   „körbejárni" a tárgyon.
2. **A 3. gyűrű a nyolcszögű tartókeretet is magával viszi**, mert a keret
   ugyanannak a `ALT_Housing_Flange` csomópontnak a része. Szemből ez inkább nagy
   sötét keretnek olvas, mint gyűrűnek; térben — bármilyen elfordulásnál —
   egyértelműen a legkülső gyűrű. Egy tisztább leválasztás a `.blend`
   szétbontását igényelné, amit ez a menet nem tett meg.
3. **Nincs árnyékvetés sehol.** Egy önmagát világító hero-tárgynak nincs
   szüksége második mélységmenetre, és telefonon az a menet a teljes keret. Ennek
   ára, hogy a gyűrűk nem vetnek árnyékot a számlapra, ami a mélységérzet egy
   olcsó forrása lett volna.
4. **A rekesz kicsi.** 0,11 egység a 0,41-es számlapon, mert a „×1000 m" és az
   „ALTITUDE" felirat közé kell férnie. A 12 000 méteres esemény ezért mechanikai
   és fényolvasat, nem méretbeli — a lamellák mozgása és a középpont kitisztulása
   viszi, nem a nyílás nagysága.
5. **A hang nincs mérve valódi eszközön.** Implementálva és alapból némítva van,
   küszöbkezeléssel; hangzásbeli finomhangolás nem történt.

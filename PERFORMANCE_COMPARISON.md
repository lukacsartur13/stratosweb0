# Teljesítmény-összehasonlítás — három implementáció

Mért adatok. Ahol nincs mérés, ott az szerepel, hogy nincs.

## 0. Mérési módszer

```bash
npm run build && npm run build:experiments && npm run build:full
python3 -m http.server 4324 --directory dist
RUNS=3 node experiments/bench.mjs
```

| paraméter | érték |
|---|---|
| renderer | **valódi GPU** (fejjel futó Chromium) |
| CPU-fojtás | 4× (CDP `Emulation.setCPUThrottlingRate`) |
| nézet | 1440 × 900 |
| görgetés | azonos szkriptelt görgetés, 6 000 ms, le 75%-ig majd vissza |
| futások | 3, metrikánként medián |
| dátum | 2026-08-01, független ismétléssel 2026-08-02 (lásd 1. pont) |

**A headless futtatás nem reprezentatív, és nem is „pesszimista" — téves.**
A headless Chromium SwiftShaderre esik vissza, azaz CPU-n rendereli a WebGL-t.
Mind a három mért oldal használ WebGL-t, tehát a szoftveres összehasonlítás nem
egyszerűen szigorúbb, hanem más rendszereket mér. A `HEADLESS=1` mód ezért csak
funkcionális ellenőrzésre való.

Elkülönítve:

- **hardveres GPU-mérések** — az alábbi 1–3. táblázatok;
- **headless funkcionális eredmények** — a Playwright-suite-ok (`npm test`,
  `npm run test:experiments`, `npm run test:full`), amelyek helyességet
  ellenőriznek, nem sebességet.

---

## 1. Futásidejű mérések

| metrika | jelenlegi hero (SVG + WebGL ég) | 0–8 000 m prototípus | **0–30 000 m teljes út** | teljes út, csökkentett mozgás |
|---|---|---|---|---|
| LCP | 3 032 ms | **164 ms** | 4 348 ms | 212 ms |
| hosszú feladatok (>50 ms) | 1 | 3 | 3 | **0** |
| hosszú feladatok összesen | 107 ms | 184 ms | 177 ms | **0 ms** |
| leghosszabb feladat | 107 ms | 66 ms | **65 ms** | 0 ms |
| medián képkockaidő | 8,4 ms | 8,3 ms | **8,3 ms** | 8,3 ms |
| p95 képkockaidő | 25,1 ms | **9,2 ms** | **9,2 ms** | 9,2 ms |
| 30 fps alatti kockák | 2 / 563 (0,36%) | **0 / 720** | **0 / 720** | 0 / 720 |
| JS heap betöltés után | **1 MB** | 8 MB | 9 MB | 2 MB |
| JS heap teljes görgetés után | **1 MB** | 9 MB | 10 MB | 2 MB |
| heap-növekmény | 0 MB | +1 MB | **+1 MB** | 0 MB |

### Ismételt mérés (2026-08-02) — szórás

A fenti táblázat egyetlen mérési sorozat mediánja. Egy független ismétlés,
azonos módszerrel (4× fojtás, 1440 × 900, 3 futás, valódi GPU), a payload-számokat
**bájtra pontosan** reprodukálta, a futásidejű számokat nem:

| metrika | hero (08-01) | hero (08-02) | teljes út (08-01) | teljes út (08-02) |
|---|---|---|---|---|
| LCP | 3 032 ms | 4 612 ms | 4 348 ms | 4 340 ms |
| hosszú feladatok | 1 | **5** | 3 | 4 |
| hosszú feladatok összesen | 107 ms | **595 ms** | 177 ms | 251 ms |
| leghosszabb feladat | 107 ms | **201 ms** | 65 ms | 77 ms |
| p95 képkockaidő | 25,1 ms | 26 ms | 9,2 ms | 9,3 ms |
| 30 fps alatti kockák | 2 / 563 | **13 / 530** | 0 / 720 | 0 / 720 |

Amit ez megváltoztat: **a hero hosszúfeladat-számai futásonként ötszörös
szórást mutatnak**, tehát önálló számként nem idézhetők. A teljes út ugyanezen
metrikái stabilak (177 → 251 ms, 3 → 4 feladat).

Amit *nem* változtat meg: a két oldal közötti különbség irányát és
nagyságrendjét. A p95 (25–26 ms vs 9,2–9,3 ms) és a 30 fps alatti kockák
(2–13 vs **0**) mindkét sorozatban ugyanazt mondják, a második mérésben
erősebben. A payload-sorok (1 057 / 1 601 / 3 112 / 1 664 KB, illetve
35 / 60 / 136 / 306 KB) determinisztikusak, és mindkét futásban azonosak.

A csökkentett mozgású út „0 hosszú feladat" sora sem abszolút: a második
sorozatban 1 db, 84 ms. A payloadja (1 664 KB) viszont változatlan.

### Amit ez mond

**A képkocka-ütemezés a teljes úton jobb, mint a jelenlegi heroé.** A p95
25,1 ms-ról 9,2 ms-ra javul, és a 30 fps alatti kockák száma nullára. Ez nem
apró különbség: a jelenlegi hero mérhetően akadozik görgetés közben, a 3D
jelenet nem. A magyarázat a `CURRENT_HERO_NOTE.md`-ben van — a hero
képkockánként ír CSS egyéni tulajdonságokat, ami stílus-újraszámolást kényszerít.

**A memória nem szivárog.** Egy teljes fel-le görgetés után a heap +1 MB-tal nő,
majd nem nő tovább. Egy 11 képernyős, szakaszonként ki- és becsatoló jeleneten
ez a legfontosabb szám.

**A 4 348 ms-os LCP a teljes út egyetlen rossz mérőszáma**, és a forrása nem a
3D. Lásd a 2. pontot.

---

## 2. Payload

### Átvitt adat, tömörítetlenül (a bench hálózati naplója)

| | jelenlegi hero | prototípus | teljes út | teljes út, csökk. mozgás |
|---|---|---|---|---|
| összesen | 1 057 KB | 1 601 KB | 3 112 KB | 1 664 KB |

### A teljes útvonal lebontása, gzippelve, lemezről

| tétel | méret | mikor tölt |
|---|---|---|
| **eager** (dokumentum + belépési chunk + CSS, 3 fájl) | **60 KB** | mindig |
| lusta 3D chunkok (jelenet + ScrollTrigger + megosztott, 3 fájl) | 306 KB | csak a 3D úton |
| altiméter GLB | 136 KB | csak a 3D úton |
| **esettanulmány-képek (6 fájl, megosztott)** | **~1 474 KB tömörítetlen** | görgetéskor, `loading="lazy"` |

Összehasonlításul a jelenlegi hero CSS+JS gzippelve: **35 KB**.

### A tényleges megállapítás

**A legnagyobb költség nem a 3D, hanem a képek.**

| fájl | méret |
|---|---|
| `client-barbershop.png` | 359 KB |
| `work-3.jpg` | 328 KB |
| `work-2.jpg` | 301 KB |
| `client-pille.png` | 235 KB |
| `work-1.jpg` | 168 KB |
| `client-rapidkert.png` | 83 KB |
| **összesen** | **1 474 KB** |

Ez négyszerese a GLB-nek, és ez teszi ki a csökkentett mozgású út 1 664 KB-jának
csaknem az egészét — vagyis az az út, amelyik büszkén *nem* tölt le renderert,
ennél többet költ képekre. Két logó PNG-ben 594 KB.

**Nem módosítottam őket.** Az éles oldal (`index.html`, `kkv.html`) ugyanezeket
használja, és a brief a megosztott éles tartalmat védettnek jelölte. De ez a
legnagyobb egyszeri nyereség, amit ezen az útvonalon el lehet érni, és az
elvégzéséig a „3D drága" következtetés nem a mérésből következik.

A 4 348 ms-os LCP innen ered, és részben mérési műtermék: a szkriptelt görgetés
minden képet a nézetbe hoz, az LCP-megfigyelő pedig az utolsó nagy festést
jegyzi. Egy valódi látogató a hajtás alatt találkozik velük. A szám attól még
valós optimalizálási cél.

### Lusta betöltés — bizonyítva, nem állítva

A `full-ascent.spec.ts` a **kimeneti fájlokat** vizsgálja:

- a dokumentum egy scriptet hivatkozik, és az nem a jelenet-chunk ✓
- nincs `modulepreload` 3D kódra ✓
- a belépési chunkban nincs `WebGLRenderer` / `BufferGeometry` / `PerspectiveCamera` ✓
- a jelenet-chunkban **van** — tehát az előző állítás nem üres ✓
- a `DebugPanel` chunk nem jön létre ✓
- csökkentett mozgásnál egyetlen `JourneyScene` / `gsap` / `ScrollTrigger` /
  `.glb` kérés sem indul ✓ (futásidejű emulációval, ellenőrizve)

---

## 3. Minőségi összehasonlítás

| szempont | jelenlegi hero | 0–8 000 m prototípus | 0–30 000 m teljes út |
|---|---|---|---|
| vizuális hatás | közepes | erős, de rövid | **erős és teljes** |
| márkaegyediség | közepes (SVG ég) | **magas** (egyedi Blender-műszer) | **magas** (műszer + saját légkör-shader) |
| narratív teljesség | teljes (0–9 600 m metafora) | negyed | **teljes (0–30 000 m)** |
| Awwwards-potenciál | alacsony | közepes | **közepes–magas** |
| eager payload | **35 KB** | ~55 KB | 60 KB |
| teljes payload | 1 057 KB | 1 601 KB | 3 112 KB |
| LCP | 3 032 ms | **164 ms** | 4 348 ms (képek miatt) |
| képkocka-ütemezés | p95 25,1 ms | **p95 9,2 ms** | **p95 9,2 ms** |
| mobil élmény | jó | jó | **jó, mért sticky-átmenettel** (390/430/375) |
| csökkentett mozgás | olvasható dokumentum | statikus műszer, nincs 3D letöltés | **statikus műszer, nincs 3D letöltés, teljes tartalom** |
| akadálymentesség | jó | jó | **jó** (skip link, egy `h1`, élő régió, semantikus lista) |
| fallback minősége | n/a | statikus SVG | **statikus SVG + működő magasságkijelző** |
| karbantartási költség | **alacsony** | közepes | **magas** (13 komponens, 2 shader, 3 teszt-suite) |
| bevezetési kockázat | **nincs** | alacsony | közepes |

---

## 4. Amit a mérés *nem* mond meg

- **Nincs valós eszközmérés.** Minden szám egy macOS fejlesztői gépről,
  4× CPU-fojtással származik. Egy középkategóriás Android telefon GPU-ja és
  memórianyomása más; a fojtás közelít, nem helyettesít.
- **Nincs mobil GPU frame-pacing mérés.** A mobil Playwright-projektek
  funkcionálisak (elrendezés, átmenet, túlcsordulás), nem sebességmérők.
- **Nincs hálózati profil.** Minden localhostról, tehát a payload-számok
  bájtok, nem betöltési idők 3G-n.
- **Nincs konverziós adat.** Semmi nem mondja meg, hogy a hosszabb narratíva
  több ajánlatkérést hoz-e. Ez A/B-teszt kérdése, nem benchmarké.

---

## 5. Ajánlás

**Teljes hibrid produkciós architektúra bevezetése — de nem ebben a sorrendben,
és nem azonnal.**

A mérés egyértelmű abban, ami a legtöbb kockázatnak látszott: **a 3D jelenet
képkocka-ütemezése jobb, mint a jelenlegi heroé** (p95 9,2 ms vs 25,1 ms, nulla
akadó kocka vs kettő), a memóriája stabil, az eager payloadja 60 KB, és a
csökkentett mozgású út bizonyítottan nem tölt le renderert. A „3D túl drága"
hipotézist a mérés nem támasztja alá.

Amit viszont alátámaszt: **a jelenlegi legnagyobb költség a képanyag, nem a
technológia.**

Ezért a javasolt sorrend:

1. **Előbb a képek.** A hat megosztott esettanulmány-kép újrakódolása
   (WebP/AVIF, a logók méretre vágva) ~1,4 MB-ról nagyságrendileg 200–300 KB-ra
   viszi a legnagyobb tételt, és **az éles oldalnak is használ**, bármi lesz a
   hero sorsa. Ez a legjobb megtérülésű munka a listán, és független minden
   mástól.
2. **Utána a hero-döntés.** A `CURRENT_HERO_NOTE.md`-ben leírt, képkockánkénti
   CSS-egyéniváltozó-írás önmagában is javítható a hero lecserélése nélkül; ha a
   cél csak a görgetési akadás megszüntetése, az a kisebb beavatkozás.
3. **Ezután a teljes 3D élmény bevezetése**, hibrid módon:
   - **nagy teljesítményű asztali gépen**: teljes 3D útvonal;
   - **mobilon**: a csökkentett 3D szint (már implementálva és mérve);
   - **csökkentett mozgás / nincs WebGL / gyenge eszköz**: a jelenlegi
     könnyűsúlyú hero vagy a statikus műszer fallbackként — a képességvizsgálat
     már most így dönt.

**Amit most nem javaslok:** az éles főoldal cseréje a jelen állapotban. Két ok,
mindkettő megnevezhető és megoldható:

- az esettanulmányok **egyetlen igazolt számszerű eredményt sem** tartalmaznak,
  mert a repóban nincs ilyen. Egy „Munkáink" szakasz mérhető eredmény nélkül
  gyengébb bizonyíték, mint a jelenlegi egy darab, valódi referencia. Ez
  tartalmi feladat, nem fejlesztési;
- a karbantartási költség valósan magasabb (13 komponens, két egyedi shader,
  egy harmadik teszt-suite). Ezt vállalni érdemes, de tudatosan.

Az útvonal produkciós jelöltként kész: a teljes 0–30 000 méteres út létezik, a
tesztek zöldek (58 új + 266 éles + 19 prototípus), a build átmegy, a mérések
megvannak, és a főoldal érintetlen.

# A jelenlegi főoldali hero — görgetési akadás, technikai jegyzet

**Ez a jegyzet vizsgálat, nem változtatás.** Az éles hero
(`assets/js/flight.js`, `assets/css/flight.css`, `assets/css/main.css`) ebben a
feladatban **nem módosult**. A cél az volt, hogy a produkciós döntéshez legyen
mért oka annak, amit eddig „a hero akadozik" néven ismertünk.

## A mérés

Valódi GPU, 4× CPU-fojtás, 1440×900, azonos szkriptelt görgetés, három futás
mediánja (`RUNS=3 node experiments/bench.mjs`):

| | jelenlegi hero | 0–30 000 m 3D út |
|---|---|---|
| medián képkockaidő | 8,4 ms | 8,3 ms |
| **p95 képkockaidő** | **25,1 ms** | **9,2 ms** |
| 30 fps alatti kockák | 2 / 563 | 0 / 720 |
| leghosszabb feladat | 107 ms | 65 ms |

A medián rendben van; a p95 nem. Ez a klasszikus mintázata annak, amikor a
képkockák többsége olcsó, de rendszeresen közbejön egy drága — vagyis nem
folyamatos terhelésről van szó, hanem ismétlődő, kényszerített munkáról.

---

## Mit ír a hero képkockánként

`assets/js/flight.js`, a `frame()` függvény (≈554–596. sor). Minden képkockán,
feltétel nélkül, a **gyökérelemre**:

| tulajdonság | érték | hol fogyasztódik |
|---|---|---|
| `--alt` | 0…1 | `opacity`, `clamp()` több tucat szabályban |
| `--climb` | 0…1 | `transform: translateY(calc(...))` a hegyrétegeken |
| `--fly` | 0…1 | `transform: translate3d/rotate/scale` a repülési rétegeken |
| `--wd` | 72…125 | `font-variation-settings: 'wdth' var(--wd)` |
| `--wt` | 820…260 | `font-variation-settings: 'wght' var(--wt)` |

Ezen felül szakaszonként egy `--p` az adott szakasz elemére — de az **már most
is őrzött**: csak akkor ír, ha az érték változott (`if (p !== s.p)`). Ez a rész
rendben van.

## Melyik írás okoz stílus- vagy elrendezési munkát

Három csoportba esnek, és nem egyformán drágák.

### 1. `--wd` és `--wt` — ez a drága, és ez okoz elrendezést

Ezek `font-variation-settings`-be mennek (`main.css:386`). A változó betűtalp
tengelyeinek módosítása **megváltoztatja a szöveg metrikáját**: a glifák
szélessége más lesz, tehát a böngészőnek újra kell tördelnie és újra kell
mérnie a szöveget. Ez nem stílus-újraszámolás, hanem **layout**, képkockánként,
a főcímen.

Ez a legvalószínűbb forrása a 25,1 ms-os p95-nek.

### 2. `--alt`, `--climb`, `--fly` — stílus-újraszámolás, széles hatókörrel

Ezek a `:root`-on élnek, és öröklődnek. Egy egyéni tulajdonság írása a gyökéren
**minden leszármazottnál érvényteleníti a stílust, amely olvassa** — és itt sok
olvassa: a `flight.css`-ben legalább húsz szabály hivatkozik rájuk
`transform`-ban, `opacity`-ben és `clamp()`-ben.

A `transform` és az `opacity` önmagában kompozitor-barát tulajdonság, de
`calc()`-on és nem regisztrált egyéni tulajdonságon keresztül **nem az**: a
böngésző nem tudja, hogy a `--climb` szám, ezért nem tudja interpolálni vagy a
kompozitor szálra tenni. Minden képkockán újra ki kell számolnia a `calc()`-ot
a fő szálon, minden érintett elemre.

### 3. `transform` közvetlen írása — ez rendben van

`bar.style.transform = 'scaleX(...)'` és a `fill` hasonlóan: közvetlen
transzformáció egyetlen elemen, kompozitorra tehető. Ezekkel nincs baj.

---

## Mi javíthatna rajta, a hero lecserélése nélkül

Csökkenő megtérülés szerint:

1. **A `--wd`/`--wt` ritkítása vagy elhagyása.** Ha a betűtengely-animáció
   képkockánként helyett kvantálva frissül (pl. csak egész `wght` lépésenként,
   vagy 5–10 lépésre kerekítve), a legtöbb képkockán egyáltalán nem történik
   írás — és a vizuális különbség egy lassan változó tengelyen nem észlelhető.
   Ugyanaz az őrzés, ami a `--p`-nél már megvan:
   ```js
   const wd = Math.round(lerp(72, 125, ease(norm)) / 2) * 2;
   if (wd !== lastWd) { lastWd = wd; st.setProperty('--wd', wd); }
   ```
   Ez a legkisebb beavatkozás a legnagyobb várható haszonnal.

2. **`@property` regisztráció a három arányszámra.** A `flight.css`-ben jelenleg
   **nincs egyetlen `@property` szabály sem**. Regisztrálva:
   ```css
   @property --climb { syntax: '<number>'; inherits: true; initial-value: 0; }
   ```
   a böngésző tudja, hogy szám, tudja tipizálva tárolni, és a `calc()`-okat
   olcsóbban kezeli. Nem varázslat, de mérhető, és egyetlen sor szabályonként.

3. **Írásőrzés a három arányszámra is.** Négy tizedesre kerekítve (`toFixed(4)`)
   a `--alt` görgetés nélkül is változhat a lerp miatt. Egy `if (v !== last)`
   őrzés ugyanaz a minta, ami a `--p`-nél már bevált.

4. **A rétegtranszformációk kiemelése a `calc()`-ból.** Ahol egy réteg
   kizárólag `translateY(calc(var(--climb) * Npx))`-et csinál, ott a JS
   közvetlenül is írhatná a `transform`-ot arra az egy elemre — kompozitorra
   tehető, és nem érvénytelenít semmi mást. Ez a legnagyobb átalakítás, és csak
   akkor éri meg, ha az 1–3. pont nem elég.

**Amit nem javaslok:** a hero átírását azért, hogy gyorsabb legyen. A mért
probléma szűk és megnevezhető; egy őrzés és néhány `@property` sokkal kisebb
kockázat, mint egy újraírás.

---

## Következtetés a produkciós döntéshez

A hero akadása **nem a WebGL égbolt miatt van**, és nem is elkerülhetetlen
következménye a könnyűsúlyú megközelítésnek. Képkockánkénti,
elrendezés-kényszerítő betűtengely-írásból ered, plusz széles hatókörű
stílus-érvénytelenítésből nem regisztrált egyéni tulajdonságokon.

Ez azt jelenti, hogy a „cseréljük le 3D-re, mert akadozik" érvelés hibás
premisszán állna: a jelenlegi hero **javítható a helyén**, valószínűleg egy
délután alatt. A 3D út bevezetése mellett szólhat a narratíva teljessége és a
márkaegyediség — de a görgetési simaság önmagában nem indok, mert az olcsóbban
is megvehető.

A méréseket lásd: [PERFORMANCE_COMPARISON.md](PERFORMANCE_COMPARISON.md).

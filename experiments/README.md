# experiments/ — fejlesztői prototípusok

Ez a mappa **nem része az éles oldalnak**. Külön Vite-projekt, saját
`node_modules`-szal, saját teszt-konfigurációval.

## Miért külön projekt?

A publikus oldal Python-generált statikus HTML — nincs benne bundler, tehát
nincs hová tenni a React Three Fibert anélkül, hogy build-lépést találnánk ki az
éles oldalnak. A `portal/` viszont privát, autentikált, `no-store` cache-elésű
admin felület; a bundle-költségvetésének semmi köze egy marketing heróhoz.

Következmény: a gyökérben a `npm run build` **bájtra ugyanaz**, mint ez a mappa
előtt volt, és innen semmi nem juthat véletlenül a Netlify-ra.

## Parancsok

A repó gyökeréből:

```bash
npm run dev:experiments
```

```bash
npm run build:experiments
```

```bash
npm run test:experiments
```

A build a `dist/experiments/stratos-ascent/` alá kerül, hogy egyetlen statikus
szerver ki tudja szolgálni az éles oldalt és a prototípust egymás mellett,
összehasonlítás céljából. Az éles `npm run build` **nem** hívja meg, és az
`assemble.mjs` törli a `dist/` nem saját tartalmát — tehát egy éles build után a
prototípus eltűnik a `dist/`-ből. Ez szándékos.

## Útvonal

```
/experiments/stratos-ascent/
```

## A másik útvonal

A teljes 0–30 000 méteres produkciós jelölt külön Vite-konfiguráción fut
(`npm run dev:full`, `/experiments/stratos-ascent-full/`), és két jegyzet írja
le: az oldalt a [FULL_ASCENT_PROTOTYPE.md](../FULL_ASCENT_PROTOTYPE.md), a
műszert az [ALTIMETER_MERIDIAN.md](../ALTIMETER_MERIDIAN.md).

## Stratos Ascent — mit vizsgál

Az első emelkedési szakasz 0–8 000 méterig, valódi 3D-ben, hogy össze lehessen
mérni a jelenlegi könnyűsúlyú főoldali heróval.

| komponens | felelősség |
|---|---|
| `AscentPrototype` | képességvizsgálat, lusta betöltés, a szemantikus HTML narratíva |
| `AscentScene` | a `Canvas`, a világítás és a kód-hasítási határ (`three` csak innen) |
| `AltimeterModel` | GLB betöltés, mutatók, bekapcsolási rámpa, bemutatási szög |
| `CameraRig` | dolly, függőleges mozgás, ≤2° kurzor-parallax |
| `AtmosphericLayer` | köd, felhőréteg, légköri szemcsék — futásidőben rajzolt textúrákkal |
| `AltitudeHUD` | a folyamatos magasságkijelzés HTML-ben, **és** az óra léptetése |
| `PrototypeFallback` | statikus SVG műszer WebGL vagy mozgás nélkül |
| `PrototypePerformanceManager` | DPR-plafon, felbontás-visszalépés, kontextusvesztés, láthatóság |

### Két szabály, amit érdemes betartani módosításkor

1. **Az órát pontosan egy komponens lépteti, és az nem a render-hurok.** Az
   `advance()` hívás az `AltitudeHUD` saját `requestAnimationFrame`-jében van.
   Azért nem a `useFrame`-ben, mert a frameloop parkol, amikor a canvas
   kigörgetődik a képernyőről — egy ott lévő óra a magasságot félúton hagyná.
   Ha máshol is meghívod, a magasság kétszeres sebességgel fut.
2. **A `three` csak az `AscentScene` alól érhető el.** A fallback útvonal ereje
   pontosan az, hogy a renderert le sem tölti. Egy felső szintű `import ... from
   'three'` ezt csendben elrontja — a teszt viszont elkapja.

### Mért adatok

`node experiments/bench.mjs` (a `dist/`-et a 4324-es porton kell kiszolgálni).
Alapból **fejjel**, valódi GPU-val fut: a headless Chromium SwiftShaderre esik
vissza, és a szoftveres WebGL nem pesszimista mérés, hanem téves.

## Mérőeszközök a Meridiánhoz

Három script, három külön kérdésre. Mind a `dist/`-et méri a 4324-es porton,
tehát előbb `npm run build:full`, majd `npm run serve:dist -- --port 4324` vagy
`python3 -m http.server 4324 --directory dist`.

| parancs | mit válaszol meg |
|---|---|
| `npm run bench` | a régi, oldalszintű összehasonlítás — hero vs. prototípus vs. teljes út |
| `npm run bench:meridian` | **melyik magasság** kerül mennyibe: hét megállópont, képkockaidő, GPU-idő, draw call, háromszög, program, textúra |
| `npm run bench:lifecycle` | tíz be/kilépési ciklus — szivárog-e heap, kontextus, textúra, listener, render-hurok |
| `npm run shots:meridian` | determinisztikus képek a hét kanonikus állapotról (ez a `dev:full` szervert használja) |

### Két dolog, amit fontos érteni a számokról

1. **A képkockaidő 120 Hz-es kijelzőn vsync-hez van szögezve.** Egy 2 ms-os és
   egy 6 ms-os jelenet is 8,3 ms-ot mér. Ez az a szám, amit a látogató kap, de
   *nem* alkalmas két build összehasonlítására. Amelyik oszlop igen: a `GPUmed`
   — képkockánkénti GPU-idő az `EXT_disjoint_timer_query_webgl2` kiterjesztésből,
   amit a vsync nem érint.
2. **A/B mérésnél a két buildet váltogatni kell, nem egymás után futtatni.** A
   `BUILDS="a=…,b=…"` alak ezt csinálja: 1. futás A, 1. futás B, 2. futás A, …
   egyetlen böngészőfolyamatban. Ugyanannak a változatlan buildnek két, fél
   órával eltolt mérése 1,44 ms és 1,27 ms mediánt adott — nagyobb különbséget,
   mint amekkorát egy világítás-változtatás okoz. A váltogatás teszi a hőmérsékleti
   sodródást közös módusúvá.

## A Blender forrás

- forrás: `assets/blender/stratos-altimeter.blend`
- export: `public/models/stratos-altimeter.glb` (397 KB nyers / 136 KB gzip)

Az `assemble.mjs` kihagyja az `assets/blender`-t a deploy-artefaktumból, mert az
`assets/` egyben másolódik — enélkül a `.blend` forrás publikusan kiszolgálódna.

A modell tengelyre állított, alkalmazott transzformációkkal, tiszta
objektumnevekkel. **A bemutatási szög a jelenetben van** (`POSE` az
`AltimeterModel`-ben), nem a `.blend`-be sütve: egy megdöntött modellen a
mutatók orsója lekerül a számlap tengelyéről, és a `rotation.z` többé nem
söpri körbe a mutatót.

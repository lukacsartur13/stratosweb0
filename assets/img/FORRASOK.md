# Képek forrása és jogállása

## NASA — közkincs (public domain)

A NASA által készített képek szerzői jogi védelem alatt nem állnak
(NASA Media Usage Guidelines). Szabadon használhatók, a forrás megjelölése
udvariassági kérdés, nem jogi kötelezettség.

| Fájl | NASA azonosító | Mi látszik | Eredeti |
|---|---|---|---|
| `space-horizon.jpg` | `iss064e002941` | A Föld horizontja az ISS-ről, légkörperemmel. Levágva, hogy az állomás szerkezete kimaradjon. | images-assets.nasa.gov/image/iss064e002941 |
| `moon.jpg` | `GSFC_20171208_Archive_e000868` | Telihold fekete háttéren (NASA/GSFC). Fekete alapon van, ezért `mix-blend-mode: screen`-nel maszk nélkül komponálható. | images-assets.nasa.gov/image/GSFC_20171208_Archive_e000868 |
| `cloud-tops.jpg` | `iss023e057948` | Naplemente az Indiai-óceán fölött, felhőtető-réteg az ISS-ről (Expedition 23). | images-assets.nasa.gov/image/iss023e057948 |

## Figyelem: nem tisztázott jogállás

| Fájl | Probléma | Állapot |
|---|---|---|
| `cruise-jet.jpg` | Gulfstream G700 (N702GD) sajtófotó. A Gulfstream Aerospace szerzői joga alá tartozik — éles oldalon való használatához engedély kell. | **Karanténban.** A Phase 8 során átkerült ide: `_backup/media-rights-hold/cruise-jet.jpg`. |

### Miért karantén, és nem csere

A fájlra a Phase 8 kezdetén **egyetlen oldal sem hivatkozott** — sem fragment,
sem CSS, sem JS. Csak azért került volna ki élesbe, mert a
`scripts/assemble.mjs` az egész `assets/` könyvtárat átmásolja a `dist/`-be,
így a kép egy kitalálható URL-en letölthető lett volna a publikált oldalról.

Ezért nincs szükség helyettesítő képre: nem volt kompozíció, amiből hiányozna.
A fájl kikerült a publikált fába, és `_backup/media-rights-hold/` alatt marad,
amíg vagy megvan a felhasználási engedély, vagy véglegesen törlik.

**Amíg a jogállás nem tisztázott, ezt a fájlt nem szabad visszatenni az
`assets/img/` könyvtárba** — a publikálás nem a hivatkozáson múlik, hanem azon,
hogy a fájl a másolt könyvtárban van-e.

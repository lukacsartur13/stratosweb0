# Stratos app (iOS + Android)

Egy app két közönségnek, ugyanazokkal a fiókokkal, mint a portál:

- **Tulajdonos:** a portál Ma oldala röviden — mennyi esedékes ma vagy késik
  (teendők, utánkövetések, mérföldkövek, mai megbeszélések, figyelmeztetések),
  az első nyolc sor, a következő megbeszélés vagy foglalt időpont, az új leadek száma.
- **Ügyfél:** a projektjei, amire a Stratos vár tőle („Rád várunk”: kérések és
  jóváhagyásra váró demók), és a következő megbeszélése.

Más fiók (nem tulajdonos munkatárs) egyelőre nem használhatja.

Expo (SDK 58) + Expo Router, TypeScript. Az adatot egyetlen végpont adja:
`GET /api/widget` (`netlify/functions/portal-widget.mjs`, tesztek:
`tests/portal-widget.spec.ts`). Ugyanezt fogják olvasni a widgetek is.

## Beállítás

```bash
cd mobile
npm install
cp .env.example .env   # a Supabase URL és anon kulcs: ugyanaz, mint a portál VITE_ értékei
```

## Futtatás

- **Böngészőben:** `npm run web` (vagy a `.claude/launch.json` `mobile-web` konfigurációja, 8099-es port).
  A `/api/widget` a `stratosweb.hu`-n van, ezért a valódi adatokhoz előbb élesíteni kell.
- **Telefonon:** az Expo Go appal (`npm start`, majd a QR-kód), amíg nincs benne
  saját natív modul. A widgetektől kezdve fejlesztői build kell (lent).

## Build és áruházak (EAS)

Az iOS- és Android-buildet az Expo felhője készíti, ehhez nem kell Xcode:

```bash
npx eas-cli@latest login
npx eas-cli@latest init                       # összeköti a projektet az Expo-fiókkal
npx eas-cli@latest env:create                 # a három EXPO_PUBLIC_ változó, környezetenként
npx eas-cli@latest build --profile preview    # telepíthető tesztbuild
npx eas-cli@latest build --profile production
npx eas-cli@latest submit --platform ios      # App Store Connect / TestFlight
npx eas-cli@latest submit --platform android  # Google Play
```

Ehhez kell: Apple Developer Program (évi 99 $) és Google Play Console (egyszeri 25 $),
lehetőleg céges fiókkal (D-U-N-S-szám).

Az azonosító mindkét platformon `hu.stratosweb.app`. Az első feltöltés után már nem
változtatható meg, ezért ha más kell, még előtte kell átírni az `app.json`-ban.

## Ami még hátra van

1. **Widgetek:** iOS-en SwiftUI WidgetKit-bővítmény (`@bacons/apple-targets`),
   Androidon `react-native-android-widget`. A bejelentkezést egy közös App Group
   tárolóba kell tenni, hogy a widget maga kérhesse le a `/api/widget`-et.
2. **Push értesítések:** új lead, új foglalás, a Stratos új kérése az ügyfélnek.
3. **Áruházi követelmények:** fióktörlés kérése az appból, adatvédelmi kérdőívek,
   demófiók az ellenőrzéshez, 1024 px-es ikon (most a portál 512 px-es ikonja van felnagyítva).
4. **Betűk:** a Stratos-betűtípusok (Aboreto, Archivo) TTF-ben az `expo-font`-hoz.

# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: homepage-history.spec.ts >> the homepage keeps the visitor’s place across history navigation >> back and forward restore the position, the chapter and the chrome
- Location: tests/homepage-history.spec.ts:223:3

# Error details

```
Error: returned to the bottom of the document instead of 4983

expect(received).toBeGreaterThan(expected)

Expected: > 200
Received:   0
```

# Page snapshot

```yaml
- generic [active] [ref=f2e1]:
  - link "Ugrás a tartalomra" [ref=f2e2]:
    - /url: "#main"
  - banner [ref=f2e3]:
    - link "Stratos — főoldal" [ref=f2e4]:
      - /url: /
      - generic [ref=f2e5]:
        - generic [ref=f2e6]: Stratos
        - generic [ref=f2e7]: S/
    - button "Menü" [ref=f2e8] [cursor=pointer]:
      - generic [ref=f2e9]:
        - generic [ref=f2e10]: MENÜ
        - generic [ref=f2e11]: Bezárás
  - main [ref=f2e15]:
    - generic [ref=f2e16]:
      - link "Ugrás a tartalomra" [ref=f2e17]:
        - /url: "#mv-content"
      - generic [ref=f2e18]:
        - generic [ref=f2e19]:
          - paragraph [ref=f2e20]:
            - text: I · Kalibráció
            - generic [ref=f2e21]: 0 m
          - heading "Nem weboldalakat építünk. Magasságot építünk." [level=1] [ref=f2e22]:
            - generic [ref=f2e23]: Nem weboldalakat építünk.
            - generic [ref=f2e26]:
              - emphasis [ref=f2e27]: Magasságot
              - text: építünk.
          - paragraph [ref=f2e30]: "A műszer egyedi modell — nem katalógusból vett pilótafülke-óra. Görgess: a magasságmérő a görgetést követi."
          - paragraph [ref=f2e31]: "A legtöbb vállalkozás a földön versenyzik: ugyanazokkal az eszközökkel, ugyanazokért a figyelemmorzsákért. Mi máshol dolgozunk. Előbb megnézzük, hol tartasz — aztán megépítjük a rendszert, amivel feljebb kerülsz."
          - paragraph [ref=f2e32]:
            - link "Kezdjük az emelkedést" [ref=f2e33]:
              - /url: /arajanlat.html
            - link "Munkáink" [ref=f2e34]:
              - /url: "#stage-selected-work"
        - generic [ref=f2e35]:
          - paragraph [ref=f2e36]:
            - text: II · Emelkedés
            - generic [ref=f2e37]: 150 – 3 000 m
          - heading "Egy weboldal önmagában nem visz sehova." [level=2] [ref=f2e38]:
            - generic [ref=f2e39]: Egy weboldal önmagában
            - emphasis [ref=f2e43]: nem visz sehova.
          - paragraph [ref=f2e44]: A weboldal egyetlen alkatrész. Ha nincs mögötte stratégia, nem tudja, kinek beszél. Ha nincs mellette hirdetés, nem találja meg senki. Ha nincs utána mérés, sosem derül ki, mi működik.
          - paragraph [ref=f2e45]: "A Stratos integrált növekedési rendszereket épít: a stratégiától a mérésig egyetlen szerkezet, amelynek minden eleme ugyanabba az irányba mozdul."
          - paragraph [ref=f2e46]: A hosszú mutató körönként 1 000 métert tesz meg — ugyanaz a leképezés, mint egy valódi magasságmérőn.
        - generic [ref=f2e47]:
          - paragraph [ref=f2e48]:
            - text: III · Alsó légkör
            - generic [ref=f2e49]: 3 000 – 6 000 m
          - heading "Hat terület, egy rendszer." [level=2] [ref=f2e50]:
            - generic [ref=f2e51]: Hat terület,
            - emphasis [ref=f2e55]: egy rendszer.
          - paragraph [ref=f2e56]: Nem hat különálló szolgáltatás, amiből választani lehet. Egy sorrend, amiben egymásra épülnek.
          - list [ref=f2e57]:
            - listitem [ref=f2e58]:
              - generic [ref=f2e59]: 3200 m
              - heading "Stratégia" [level=3] [ref=f2e60]
              - paragraph [ref=f2e61]: Előbb eldöntjük, mit érdemes megépíteni. A többi ebből következik.
            - listitem [ref=f2e62]:
              - generic [ref=f2e63]: 3800 m
              - heading "Dizájn" [level=3] [ref=f2e64]
              - paragraph [ref=f2e65]: A megjelenés nem díszítés. Azt dönti el, hisznek-e neked az első öt másodpercben.
            - listitem [ref=f2e66]:
              - generic [ref=f2e67]: 4400 m
              - heading "Fejlesztés" [level=3] [ref=f2e68]
              - paragraph [ref=f2e69]: Egyedi kód, mérhető sebesség. Nem sablon, amit hetente frissíteni kell.
            - listitem [ref=f2e70]:
              - generic [ref=f2e71]: 5000 m
              - heading "Hirdetés" [level=3] [ref=f2e72]
              - paragraph [ref=f2e73]: Forgalmat oda küldünk, ahol már van mit fogadnia.
            - listitem [ref=f2e74]:
              - generic [ref=f2e75]: 5500 m
              - heading "Konverzió" [level=3] [ref=f2e76]
              - paragraph [ref=f2e77]: A látogatóból érdeklődő. Ezt mérjük, és ezen javítunk.
            - listitem [ref=f2e78]:
              - generic [ref=f2e79]: 5900 m
              - heading "Automatizálás" [level=3] [ref=f2e80]
              - paragraph [ref=f2e81]: Ami ismétlődik, az fusson magától.
        - generic [ref=f2e82]:
          - paragraph [ref=f2e83]:
            - text: IV · Felhőréteg
            - generic [ref=f2e84]: 6 000 – 8 500 m
          - heading "Idelent minden zajos." [level=2] [ref=f2e85]:
            - generic [ref=f2e86]: Idelent
            - emphasis [ref=f2e90]: minden zajos.
          - paragraph [ref=f2e91]: Öt ügynökség öt különböző dolgot mond. A hirdetés más üzenetet visz, mint az oldal. Az analitika mást mér, mint amit a vezetőség lát. Ez a réteg mindenkinek ugyanolyan sűrű.
          - paragraph [ref=f2e92]: Nem a zaj a probléma, hanem hogy a legtöbb rendszer benne is marad. Aki fel akar jutni, annak előbb el kell döntenie, mit hagy el.
        - generic [ref=f2e93]:
          - paragraph [ref=f2e94]:
            - text: V · Áttörés
            - generic [ref=f2e95]: 8 500 – 11 000 m
          - heading "A tisztaság ott kezdődik, ahol minden digitális rendszered ugyanabba az irányba mozdul." [level=2] [ref=f2e96]:
            - generic [ref=f2e97]: A tisztaság ott kezdődik, ahol minden digitális rendszered
            - emphasis [ref=f2e101]: ugyanabba az irányba mozdul.
          - paragraph [ref=f2e102]: Nem több eszköz kell. Kevesebb, de egy irányba állítva.
        - generic [ref=f2e103]:
          - paragraph [ref=f2e104]:
            - text: VI · Munkáink
            - generic [ref=f2e105]: 11 000 – 17 000 m
          - heading "Akikkel együtt emelkedtünk." [level=2] [ref=f2e106]:
            - generic [ref=f2e107]: Akikkel
            - emphasis [ref=f2e111]: együtt emelkedtünk.
          - paragraph [ref=f2e112]: Négy magassági pont. Mindegyik valódi ügyfél, valódi élő rendszerrel.
          - generic [ref=f2e113]:
            - article [ref=f2e114]:
              - generic [ref=f2e115]:
                - generic [ref=f2e116]: 11 800 m
                - heading "Rapidkert Kft." [level=3] [ref=f2e117]
                - paragraph [ref=f2e118]: Kertépítés
              - img "Rapidkert Kft." [ref=f2e119]
              - figure [ref=f2e120]:
                - img "A Rapidkert kertépítés weboldala" [ref=f2e121]
              - generic [ref=f2e122]:
                - term [ref=f2e123]: A helyzet
                - definition [ref=f2e124]: "A kertépítés keresései szezonálisak és erősen helyhez kötöttek. Az érdeklődés megvolt, de nem a megfelelő emberektől: sok megkeresés érkezett olyanoktól, akiknek egészen más kellett volna."
                - term [ref=f2e125]: Amit tettünk
                - definition [ref=f2e126]: Nem több forgalmat céloztunk meg, hanem pontosabbat. A pozicionálás, az oldal szerkezete és a hirdetések ugyanarra a szűkebb keresési szándékra épültek.
                - term [ref=f2e127]: Eredmény
                - definition [ref=f2e128]: Több megkeresés érkezett, és célzottabban találtak rájuk azok, akik valóban kertépítést kerestek. Ezt az ügyfél mondta el, nem mi mértük.
              - blockquote [ref=f2e129]:
                - paragraph [ref=f2e130]: "Az eredmények gyorsan láthatóak lettek: több megkeresés érkezett, és sokkal célzottabban találtak ránk azok az ügyfelek, akik valóban a szolgáltatásainkat keresték."
                - generic [ref=f2e131]: Győrffy Márton · CEO, Rapidkert Kft.
            - article [ref=f2e132]:
              - generic [ref=f2e133]:
                - generic [ref=f2e134]: 13 200 m
                - heading "Barbershop Győr" [level=3] [ref=f2e135]
                - paragraph [ref=f2e136]: Helyi szolgáltatás
              - img "Barbershop Győr" [ref=f2e137]
              - figure [ref=f2e138]:
                - img "A Barbershop Győr weboldala" [ref=f2e139]
              - generic [ref=f2e140]:
                - term [ref=f2e141]: A helyzet
                - definition [ref=f2e142]: Egy helyi szolgáltatásnál a döntés a telefon képernyőjén, percek alatt születik meg. Egy lassú vagy nehezen olvasható oldal itt nem kényelmetlenség, hanem elvesztett vendég.
                - term [ref=f2e143]: Amit tettünk
                - definition [ref=f2e144]: Mobilra tervezett oldal, amelyen az időpontfoglalás és az elérhetőség sosincs egy görgetésnél messzebb.
                - term [ref=f2e145]: Eredmény
                - definition [ref=f2e146]: Élő oldal, amely a saját nevére és a helyi keresésekre is megtalálható.
            - article [ref=f2e147]:
              - generic [ref=f2e148]:
                - generic [ref=f2e149]: 14 600 m
                - heading "mentaltrening.com" [level=3] [ref=f2e150]
                - paragraph [ref=f2e151]: Mentális tréning
              - figure [ref=f2e152]:
                - img "A mentaltrening.com weboldala" [ref=f2e153]
              - generic [ref=f2e154]:
                - term [ref=f2e155]: A helyzet
                - definition [ref=f2e156]: Bizalmi szolgáltatásnál a weboldal nem katalógus, hanem az első beszélgetés. A hangvétel többet dönt, mint a funkciólista.
                - term [ref=f2e157]: Amit tettünk
                - definition [ref=f2e158]: A tartalmi szerkezetet a kérdésekre építettük, amelyekkel az érdeklődők valóban érkeznek — nem a szolgáltatás belső logikájára.
                - term [ref=f2e159]: Eredmény
                - definition [ref=f2e160]: Élő oldal, amely a szolgáltatás hangját viszi tovább, nem csak a tényeit.
        - generic [ref=f2e161]:
          - paragraph [ref=f2e162]:
            - text: VII · A rendszer
            - generic [ref=f2e163]: 17 000 – 22 000 m
          - heading "Kilenc terület, három rétegben." [level=2] [ref=f2e164]:
            - generic [ref=f2e165]: Kilenc terület,
            - emphasis [ref=f2e169]: három rétegben.
          - paragraph [ref=f2e170]: "A háttérben ugyanez látható: koncentrikus rétegek, nem hálózat. A sorrend a lényeg, nem az, hogy kilenc van belőle."
          - generic [ref=f2e171]:
            - generic [ref=f2e172]:
              - heading "1 Mag" [level=3] [ref=f2e173]:
                - generic [ref=f2e174]: "1"
                - text: Mag
              - paragraph [ref=f2e175]: Ez dönti el a többit. Enélkül minden alatta lévő döntés találgatás.
              - list [ref=f2e176]:
                - listitem [ref=f2e177]:
                  - generic [ref=f2e178]: Kutatás
                  - generic [ref=f2e179]: Piac, versenytársak, keresési szándék. Mielőtt bármit építenénk.
                - listitem [ref=f2e180]:
                  - generic [ref=f2e181]: Stratégia
                  - generic [ref=f2e182]: Mit mondunk, kinek, és milyen sorrendben. Ez dönti el a többit.
            - generic [ref=f2e183]:
              - heading "2 Szerkezet" [level=3] [ref=f2e184]:
                - generic [ref=f2e185]: "2"
                - text: Szerkezet
              - paragraph [ref=f2e186]: Amit a stratégia meghatároz, itt épül fel és itt kap formát.
              - list [ref=f2e187]:
                - listitem [ref=f2e188]:
                  - generic [ref=f2e189]: Arculat
                  - generic [ref=f2e190]: A vizuális nyelv, amely minden felületen ugyanaz marad.
                - listitem [ref=f2e191]:
                  - generic [ref=f2e192]: Weboldal
                  - generic [ref=f2e193]: A központ, ahová minden csatorna vezet, és ahol a döntés megszületik.
                - listitem [ref=f2e194]:
                  - generic [ref=f2e195]: Fejlesztés
                  - generic [ref=f2e196]: Egyedi funkciók, integrációk, sebesség. Nem sablon, nem plugin-halmaz.
            - generic [ref=f2e197]:
              - heading "3 Működés" [level=3] [ref=f2e198]:
                - generic [ref=f2e199]: "3"
                - text: Működés
              - paragraph [ref=f2e200]: Ami csak akkor működik, ha a két belső réteg már a helyén van.
              - list [ref=f2e201]:
                - listitem [ref=f2e202]:
                  - generic [ref=f2e203]: Hirdetés
                  - generic [ref=f2e204]: Fizetett forgalom oda, ahol már van mit fogadnia.
                - listitem [ref=f2e205]:
                  - generic [ref=f2e206]: Analitika
                  - generic [ref=f2e207]: Mérés, amely nem riportot termel, hanem döntést.
                - listitem [ref=f2e208]:
                  - generic [ref=f2e209]: Optimalizálás
                  - generic [ref=f2e210]: Havi finomhangolás a mért adatok alapján, nem megérzésből.
                - listitem [ref=f2e211]:
                  - generic [ref=f2e212]: Automatizálás
                  - generic [ref=f2e213]: Ami ismétlődik, azt nem embernek kell csinálnia.
        - generic [ref=f2e214]:
          - paragraph [ref=f2e215]:
            - text: VIII · A folyamat
            - generic [ref=f2e216]: 22 000 – 25 500 m
          - heading "Hét ellenőrzőpont, találgatás nélkül." [level=2] [ref=f2e217]:
            - generic [ref=f2e218]: Hét ellenőrzőpont,
            - emphasis [ref=f2e222]: találgatás nélkül.
          - paragraph [ref=f2e223]: Minden ponton tudod, mi történik, mit kapsz tőlünk, mit várunk tőled, és mi lesz az eredménye.
          - list [ref=f2e224]:
            - listitem [ref=f2e225]:
              - generic [ref=f2e226]:
                - generic [ref=f2e227]: "01"
                - heading "Felderítés" [level=3] [ref=f2e228]
                - generic [ref=f2e229]: 22 300 m
              - generic [ref=f2e230]:
                - term [ref=f2e231]: Mi történik
                - definition [ref=f2e232]: Egy beszélgetés arról, hol tart a vállalkozás, és mi az, ami valóban akadályozza.
                - term [ref=f2e233]: Amit átadunk
                - definition [ref=f2e234]: Írásos helyzetkép és egy őszinte válasz arra, hogy tudunk-e segíteni.
                - term [ref=f2e235]: Várható eredmény
                - definition [ref=f2e236]: Közös kép a kiindulási pontról — vagy egy korrekt nem.
            - listitem [ref=f2e237]:
              - generic [ref=f2e238]:
                - generic [ref=f2e239]: "02"
                - heading "Kutatás" [level=3] [ref=f2e240]
                - generic [ref=f2e241]: 22 900 m
              - generic [ref=f2e242]:
                - term [ref=f2e243]: Mi történik
                - definition [ref=f2e244]: Versenytárs- és keresési elemzés, a jelenlegi felületek technikai átvizsgálása.
                - term [ref=f2e245]: Amit átadunk
                - definition [ref=f2e246]: "Kutatási összefoglaló: kereslet, versenyhelyzet, technikai hiányosságok."
                - term [ref=f2e247]: Várható eredmény
                - definition [ref=f2e248]: Tényeken alapuló alap a stratégiához.
            - listitem [ref=f2e249]:
              - generic [ref=f2e250]:
                - generic [ref=f2e251]: "03"
                - heading "Stratégia" [level=3] [ref=f2e252]
                - generic [ref=f2e253]: 23 500 m
              - generic [ref=f2e254]:
                - term [ref=f2e255]: Mi történik
                - definition [ref=f2e256]: Eldöntjük a pozicionálást, az üzeneteket és a csatornák sorrendjét.
                - term [ref=f2e257]: Amit átadunk
                - definition [ref=f2e258]: Stratégiai dokumentum mérhető célokkal és ütemezéssel.
                - term [ref=f2e259]: Várható eredmény
                - definition [ref=f2e260]: Egy irány, amelyhez minden későbbi döntés mérhető.
            - listitem [ref=f2e261]:
              - generic [ref=f2e262]:
                - generic [ref=f2e263]: "04"
                - heading "Tervezés" [level=3] [ref=f2e264]
                - generic [ref=f2e265]: 24 100 m
              - generic [ref=f2e266]:
                - term [ref=f2e267]: Mi történik
                - definition [ref=f2e268]: Arculat és felületi tervek készülnek, valós tartalommal, nem kitöltő szöveggel.
                - term [ref=f2e269]: Amit átadunk
                - definition [ref=f2e270]: Jóváhagyható dizájnterv minden fontos nézetre.
                - term [ref=f2e271]: Várható eredmény
                - definition [ref=f2e272]: Jóváhagyott terv, amiből egyértelmű, mi épül.
            - listitem [ref=f2e273]:
              - generic [ref=f2e274]:
                - generic [ref=f2e275]: "05"
                - heading "Fejlesztés" [level=3] [ref=f2e276]
                - generic [ref=f2e277]: 24 700 m
              - generic [ref=f2e278]:
                - term [ref=f2e279]: Mi történik
                - definition [ref=f2e280]: Megépítjük. Menet közben látod, nem a végén.
                - term [ref=f2e281]: Amit átadunk
                - definition [ref=f2e282]: Működő oldal tesztkörnyezetben, mérésekkel felszerelve.
                - term [ref=f2e283]: Várható eredmény
                - definition [ref=f2e284]: Élesíthető rendszer, nem bemutató.
            - listitem [ref=f2e285]:
              - generic [ref=f2e286]:
                - generic [ref=f2e287]: "06"
                - heading "Indulás" [level=3] [ref=f2e288]
                - generic [ref=f2e289]: 25 100 m
              - generic [ref=f2e290]:
                - term [ref=f2e291]: Mi történik
                - definition [ref=f2e292]: Élesítés, átirányítások, mérés ellenőrzése, hirdetések indítása.
                - term [ref=f2e293]: Amit átadunk
                - definition [ref=f2e294]: Élő rendszer és átadási dokumentáció.
                - term [ref=f2e295]: Várható eredmény
                - definition [ref=f2e296]: A rendszer működik és mér.
            - listitem [ref=f2e297]:
              - generic [ref=f2e298]:
                - generic [ref=f2e299]: "07"
                - heading "Optimalizálás" [level=3] [ref=f2e300]
                - generic [ref=f2e301]: 25 400 m
              - generic [ref=f2e302]:
                - term [ref=f2e303]: Mi történik
                - definition [ref=f2e304]: "Havonta: mérés, elemzés, módosítás. Ez nem projektzárás, hanem üzemeltetés."
                - term [ref=f2e305]: Amit átadunk
                - definition [ref=f2e306]: Havi riport és a végrehajtott módosítások listája.
                - term [ref=f2e307]: Várható eredmény
                - definition [ref=f2e308]: Rendszer, amely idővel jobb lesz, nem elavul.
        - generic [ref=f2e309]:
          - paragraph [ref=f2e310]:
            - text: IX · Átmenet
            - generic [ref=f2e311]: 25 500 – 28 000 m
          - heading "Innen már látni a görbületet." [level=2] [ref=f2e312]:
            - generic [ref=f2e313]: Innen már
            - emphasis [ref=f2e317]: látni a görbületet.
          - paragraph [ref=f2e318]: Ebben a magasságban a levegő nyolcvan százaléka alattad van. Kevesebb a zaj, messzebb ellátni, és ami eddig hatalmasnak tűnt, arányba kerül.
          - paragraph [ref=f2e319]: "Üzletileg ugyanez történik: amikor a rendszer működik, a napi tűzoltás helyét átveszi a döntés arról, merre tovább."
        - generic [ref=f2e320]:
          - paragraph [ref=f2e321]:
            - text: X · Sztratoszféra
            - generic [ref=f2e322]: 28 000 – 30 000 m
          - heading "Üdv a sztratoszférában." [level=2] [ref=f2e323]:
            - generic [ref=f2e324]: Üdv a
            - emphasis [ref=f2e328]: sztratoszférában.
          - paragraph [ref=f2e329]: Itt az ambiciózus vállalkozások már nem a figyelemért versenyeznek. Meghatározzák a kategóriát, amelyben mindenki más versenyezni fog.
        - generic [ref=f2e330]:
          - paragraph [ref=f2e331]:
            - text: XI · Célmagasság
            - generic [ref=f2e332]: 30 000 m
          - heading "Készen állsz felemelkedni?" [level=2] [ref=f2e333]:
            - generic [ref=f2e334]: Készen állsz
            - emphasis [ref=f2e338]: felemelkedni?
          - paragraph [ref=f2e339]: Egy beszélgetéssel kezdődik. Megnézzük, hol tartasz, és őszintén megmondjuk, tudunk-e segíteni — akkor is, ha a válasz nem.
          - paragraph [ref=f2e340]:
            - link "Kezdjük az emelkedést" [ref=f2e341]:
              - /url: /arajanlat.html
            - link "Munkáink megtekintése" [ref=f2e342]:
              - /url: "#stage-selected-work"
          - paragraph [ref=f2e343]:
            - text: Inkább kérdeznél előbb?
            - link "Írj nekünk" [ref=f2e344]:
              - /url: /ugyfelszolgalat.html
            - text: — vagy töltsd ki a
            - link "rövid kérdőívet" [ref=f2e345]:
              - /url: /arajanlat.html
            - text: ", és konkrét javaslattal jelentkezünk."
          - list "A bejárt magasságok" [ref=f2e346]:
            - listitem [ref=f2e347]:
              - link "Kalibráció 150 m" [ref=f2e348]:
                - /url: "#stage-calibration"
                - generic [ref=f2e349]: Kalibráció
                - generic [ref=f2e350]: 150 m
            - listitem [ref=f2e351]:
              - link "Emelkedés 3000 m" [ref=f2e352]:
                - /url: "#stage-initial-ascent"
                - generic [ref=f2e353]: Emelkedés
                - generic [ref=f2e354]: 3000 m
            - listitem [ref=f2e355]:
              - link "Alsó légkör 6000 m" [ref=f2e356]:
                - /url: "#stage-lower-atmosphere"
                - generic [ref=f2e357]: Alsó légkör
                - generic [ref=f2e358]: 6000 m
            - listitem [ref=f2e359]:
              - link "Felhőréteg 8500 m" [ref=f2e360]:
                - /url: "#stage-cloud-entry"
                - generic [ref=f2e361]: Felhőréteg
                - generic [ref=f2e362]: 8500 m
            - listitem [ref=f2e363]:
              - link "Áttörés 11 000 m" [ref=f2e364]:
                - /url: "#stage-cloud-breakthrough"
                - generic [ref=f2e365]: Áttörés
                - generic [ref=f2e366]: 11 000 m
            - listitem [ref=f2e367]:
              - link "Munkáink 17 000 m" [ref=f2e368]:
                - /url: "#stage-selected-work"
                - generic [ref=f2e369]: Munkáink
                - generic [ref=f2e370]: 17 000 m
            - listitem [ref=f2e371]:
              - link "Rendszer 22 000 m" [ref=f2e372]:
                - /url: "#stage-system"
                - generic [ref=f2e373]: Rendszer
                - generic [ref=f2e374]: 22 000 m
            - listitem [ref=f2e375]:
              - link "Folyamat 25 500 m" [ref=f2e376]:
                - /url: "#stage-process"
                - generic [ref=f2e377]: Folyamat
                - generic [ref=f2e378]: 25 500 m
            - listitem [ref=f2e379]:
              - link "Átmenet 28 000 m" [ref=f2e380]:
                - /url: "#stage-stratosphere-transition"
                - generic [ref=f2e381]: Átmenet
                - generic [ref=f2e382]: 28 000 m
            - listitem [ref=f2e383]:
              - link "Sztratoszféra 30 000 m" [ref=f2e384]:
                - /url: "#stage-full-stratosphere"
                - generic [ref=f2e385]: Sztratoszféra
                - generic [ref=f2e386]: 30 000 m
      - generic:
        - paragraph:
          - generic: 30 000
          - generic: méter
          - generic: Célmagasság
  - generic [ref=f2e392]:
    - paragraph [ref=f2e393]:
      - generic [ref=f2e394]: 30 000 M
      - generic [ref=f2e395]: EMELKEDÉS BEFEJEZVE
    - paragraph [ref=f2e396]: Hova vigyük innen a vállalkozásodat?
    - heading "A következő szint innen indul." [level=2] [ref=f2e397]
    - paragraph [ref=f2e398]:
      - link "Projekt indítása" [ref=f2e399]:
        - /url: /arajanlat.html
      - link "Kiemelt munkáink" [ref=f2e401]:
        - /url: /munkaink.html
  - contentinfo [ref=f2e403]:
    - generic [ref=f2e404]:
      - generic [ref=f2e405]:
        - generic [ref=f2e406]:
          - link "Stratos" [ref=f2e407]:
            - /url: /
          - paragraph [ref=f2e409]: A hírlevelünk még készül. Add meg a címed, és szólunk, amint elindul.
          - generic [ref=f2e410]:
            - generic [ref=f2e411]: E-mail cím
            - textbox "E-mail cím" [ref=f2e412]:
              - /placeholder: e-mail cím
            - generic [ref=f2e413]:
              - text: Company website
              - textbox [ref=f2e414]
            - button "Szóljatok" [ref=f2e415] [cursor=pointer]
          - status
        - generic [ref=f2e416]:
          - heading "Linkek" [level=4] [ref=f2e417]
          - list [ref=f2e418]:
            - listitem [ref=f2e419]:
              - link "Rólunk" [ref=f2e420]:
                - /url: /rolunk.html
            - listitem [ref=f2e421]:
              - link "Munkáink" [ref=f2e422]:
                - /url: /munkaink.html
            - listitem [ref=f2e423]:
              - link "Kapcsolat" [ref=f2e424]:
                - /url: /ugyfelszolgalat.html
            - listitem [ref=f2e425]:
              - link "Blog" [ref=f2e426]:
                - /url: /blog.html
            - listitem [ref=f2e427]:
              - link "Árajánlat" [ref=f2e428]:
                - /url: /arajanlat.html
        - generic [ref=f2e429]:
          - heading "Szolgáltatások" [level=4] [ref=f2e430]
          - list [ref=f2e431]:
            - listitem [ref=f2e432]:
              - link "Minden szolgáltatás" [ref=f2e433]:
                - /url: /szolgaltatasok.html
            - listitem [ref=f2e434]:
              - link "Webdesign KKV-nak" [ref=f2e435]:
                - /url: /kkv.html
            - listitem [ref=f2e436]:
              - link "Webdesign nagyvállalatoknak" [ref=f2e437]:
                - /url: /nagyvallalat.html
            - listitem [ref=f2e438]:
              - link "Branding" [ref=f2e439]:
                - /url: /branding.html
            - listitem [ref=f2e440]:
              - link "Hirdetéskezelés" [ref=f2e441]:
                - /url: /hirdeteskezeles.html
            - listitem [ref=f2e442]:
              - link "Impact Program" [ref=f2e443]:
                - /url: /impact-program.html
        - generic [ref=f2e444]:
          - heading "Kapcsolat" [level=4] [ref=f2e445]
          - list [ref=f2e446]:
            - listitem [ref=f2e447]:
              - link "lukacs.artur@media-stratos.com" [ref=f2e448]:
                - /url: mailto:lukacs.artur@media-stratos.com
            - listitem [ref=f2e449]:
              - link "+36 30 584 8024" [ref=f2e450]:
                - /url: tel:+36305848024
          - heading "Közösség" [level=4] [ref=f2e451]
          - list [ref=f2e452]:
            - listitem [ref=f2e453]:
              - link "LinkedIn" [ref=f2e454]:
                - /url: https://www.linkedin.com/company/stratos-media-agency
            - listitem [ref=f2e455]:
              - link "Instagram" [ref=f2e456]:
                - /url: https://www.instagram.com/stratosweb/
            - listitem [ref=f2e457]:
              - link "Facebook" [ref=f2e458]:
                - /url: https://www.facebook.com/profile.php?id=61590329356257
        - generic [ref=f2e459]:
          - heading "Állapot" [level=4] [ref=f2e460]
          - list [ref=f2e461]:
            - listitem [ref=f2e462]: Válasz jellemzően pár órán belül
            - listitem [ref=f2e463]: Győr és Budapest
            - listitem [ref=f2e464]: Magyarul, angolul és németül dolgozunk
      - generic [ref=f2e465]:
        - generic [ref=f2e466]: © 2026 Stratos Media Agency — Minden jog fenntartva.
        - generic [ref=f2e467]:
          - link "Adatkezelési tájékoztató" [ref=f2e468]:
            - /url: /adatkezelesi-tajekoztato.html
          - link "Impresszum" [ref=f2e469]:
            - /url: /impresszum.html
          - group "Nyelvválasztás" [ref=f2e470]:
            - link "HU" [ref=f2e471]:
              - /url: /
            - link "EN" [ref=f2e472]:
              - /url: /en/
            - link "DE" [ref=f2e473]:
              - /url: /de/
          - button "VISSZA 0 MÉTERRE" [ref=f2e474] [cursor=pointer]
          - img "GDPR Ready" [ref=f2e475]
```

# Test source

```ts
  63  |  * browser's restore has been released — which is precisely the moment the real
  64  |  * content has grown past it and nothing further will resize underneath us.
  65  |  */
  66  | async function settled(page: Page) {
  67  |   await page.waitForLoadState('load');
  68  |   await homepageReady(page);
  69  |   await page.waitForFunction(
  70  |     () => !document.documentElement.style.getPropertyValue('--home-reserve'),
  71  |     null,
  72  |     { timeout: 20_000 },
  73  |   );
  74  |   await settleReadout(page);
  75  | }
  76  | 
  77  | /**
  78  |  * Wait for the altitude clock to stop moving.
  79  |  *
  80  |  * The desktop journey's altitude is a *damped* value easing toward the one the
  81  |  * scroll position implies, so the readout and the stage label it drives are
  82  |  * both live for a few hundred milliseconds after any position change — a fresh
  83  |  * load, a restore, or a `scrollTo` in this file. Reading them before they
  84  |  * converge does not measure the page; it measures how fast the machine is.
  85  |  *
  86  |  * That is not a hypothetical. Sampling immediately produced a "chapter" that
  87  |  * disagreed with itself between two runs at the *same* scroll position — the
  88  |  * before-reading in one run and the after-reading in another, both mid-ease,
  89  |  * in both directions.
  90  |  *
  91  |  * So the settle is on the number itself: ten consecutive animation frames
  92  |  * reporting the same metres. Ten frames is a sixth of a second of a clock that
  93  |  * moves on every frame while it is easing, and the assertion that follows is
  94  |  * about a value that has stopped changing rather than one caught in flight.
  95  |  */
  96  | async function settleReadout(page: Page) {
  97  |   await page.evaluate(() => {
  98  |     (window as unknown as { __settle: { last: string | null; n: number } }).__settle = {
  99  |       last: null,
  100 |       n: 0,
  101 |     };
  102 |   });
  103 |   await page.waitForFunction(
  104 |     () => {
  105 |       const el = document.querySelector('[data-testid="altitude-value"],[data-testid="mobile-altitude"]');
  106 |       if (!el) return false;
  107 |       const now = (el.textContent ?? '').replace(/\D/g, '');
  108 |       const s = (window as unknown as { __settle: { last: string | null; n: number } }).__settle;
  109 |       if (now && now === s.last) s.n += 1;
  110 |       else {
  111 |         s.last = now;
  112 |         s.n = 0;
  113 |       }
  114 |       return s.n >= 10;
  115 |     },
  116 |     null,
  117 |     { timeout: 20_000 },
  118 |   );
  119 | }
  120 | 
  121 | /** Everything that has to come back, read in one round trip. */
  122 | async function place(page: Page) {
  123 |   const stage = await stageReadout(page);
  124 |   return {
  125 |     ...(await page.evaluate(() => ({
  126 |       y: Math.round(scrollY),
  127 |       travel: document.documentElement.scrollHeight - innerHeight,
  128 |       headerState: document.querySelector('.nav')?.getAttribute('data-state') ?? null,
  129 |     }))),
  130 |     chapter: ((await stage.textContent()) ?? '').trim(),
  131 |   };
  132 | }
  133 | 
  134 | /** Leave for another route the way a visitor does — by activating a link. */
  135 | async function followInternalLink(page: Page): Promise<string> {
  136 |   const href = await page.evaluate(() => {
  137 |     const a = document.querySelector<HTMLAnchorElement>('.foot a[href$=".html"]');
  138 |     return a ? a.getAttribute('href') : null;
  139 |   });
  140 |   expect(href, 'the homepage footer has no internal link to leave by').not.toBeNull();
  141 | 
  142 |   /* Clicked from inside the page rather than with `page.click()`, and that is
  143 |      not a shortcut. Playwright scrolls an element into view before clicking it,
  144 |      which would move the very scroll position this test is about — and a
  145 |      script-initiated activation is still a page-initiated navigation, so it
  146 |      goes down the same `pageswap` / View Transition path a real click does
  147 |      (assets/js/transitions.js), which `page.goto()` would bypass entirely. */
  148 |   await Promise.all([
  149 |     page.waitForURL((url) => url.pathname.endsWith(href!.split('/').pop()!)),
  150 |     page.evaluate(() => document.querySelector<HTMLAnchorElement>('.foot a[href$=".html"]')!.click()),
  151 |   ]);
  152 |   return href!;
  153 | }
  154 | 
  155 | /** A quarter of a phone screen. See the note at the top of this file. */
  156 | const TOLERANCE = 200;
  157 | 
  158 | function expectRestored(after: Awaited<ReturnType<typeof place>>, before: Awaited<ReturnType<typeof place>>) {
  159 |   expect(after.y, `returned to the top of the document instead of ${before.y}`).toBeGreaterThan(TOLERANCE);
  160 |   expect(
  161 |     after.travel - after.y,
  162 |     `returned to the bottom of the document instead of ${before.y}`,
> 163 |   ).toBeGreaterThan(TOLERANCE);
      |     ^ Error: returned to the bottom of the document instead of 4983
  164 |   expect(
  165 |     Math.abs(after.y - before.y),
  166 |     `left at ${before.y}, came back to ${after.y}`,
  167 |   ).toBeLessThanOrEqual(TOLERANCE);
  168 |   expect(after.chapter, 'came back to a different chapter').toBe(before.chapter);
  169 | }
  170 | 
  171 | /**
  172 |  * Scroll to the anchor section and wait for the page to describe itself again.
  173 |  *
  174 |  * The scroll position is polled rather than assumed because `scrollTo` on the
  175 |  * desktop composition lands inside a sticky track, and the readout is settled
  176 |  * because everything downstream of the position — the header state, the stage
  177 |  * label, the metres — is driven by a damped clock. Both are events, not sleeps.
  178 |  */
  179 | async function scrollToAnchor(page: Page) {
  180 |   const target = await page.evaluate((ids) => {
  181 |     const tops = ids.map((id) => {
  182 |       const el = document.getElementById(id);
  183 |       return el ? el.getBoundingClientRect().top + scrollY : null;
  184 |     });
  185 |     if (tops.some((t) => t === null)) return null;
  186 |     const travel = document.documentElement.scrollHeight - innerHeight;
  187 |     return Math.min(Math.round(((tops[0] as number) + (tops[1] as number)) / 2), travel);
  188 |   }, ANCHORS as unknown as string[]);
  189 |   expect(target, `#${ANCHORS.join(' / #')} are not both in this composition`).not.toBeNull();
  190 |   expect(target!, 'the document is too short to have somewhere to fail to').toBeGreaterThan(1000);
  191 | 
  192 |   await page.evaluate((y) => scrollTo({ top: y, behavior: 'instant' }), target!);
  193 |   await expect
  194 |     .poll(() => page.evaluate(() => Math.round(scrollY)), { timeout: 10_000 })
  195 |     .toBeGreaterThan(target! - 50);
  196 |   await settleReadout(page);
  197 |   return place(page);
  198 | }
  199 | 
  200 | /* ONE test per journey, and the reason is measured rather than stylistic.
  201 |  *
  202 |  * Written as an assertion per test, this file and homepage-modality.spec.ts
  203 |  * together added 36 tests to `npm test` and took the run from 8.8 minutes and
  204 |  * 4 failures to 19.9 minutes and 64 failures. The extra failures were almost
  205 |  * all timeouts in OTHER suites: every test here loads a ~1 MB WebGL homepage
  206 |  * two to four times, that page renders at roughly 10 fps under a software
  207 |  * rasteriser, and a worker held for half a minute is a worker the rest of the
  208 |  * suite does not have. The product fixes cost nothing — the same suite without
  209 |  * these two files ran in 9.1 minutes with 5 failures.
  210 |  *
  211 |  * So a back navigation is exercised once, and everything that has to be true
  212 |  * about it is asserted on that one journey. The trade is that an early failure
  213 |  * hides the assertions after it; the messages are written to be specific enough
  214 |  * that the first one identifies itself.
  215 |  *
  216 |  * The budget is raised to match what four homepage loads actually cost — 19 s
  217 |  * to 27 s on the 1920x1080 project with the machine to itself. Scoped to this
  218 |  * file, and not a remedy for the load-dependent failures documented in
  219 |  * _build/reports/mobile-test-reconciliation/. */
  220 | test.describe.configure({ timeout: 120_000 });
  221 | 
  222 | test.describe('the homepage keeps the visitor’s place across history navigation', () => {
  223 |   test('back and forward restore the position, the chapter and the chrome', async ({
  224 |     page,
  225 |   }, testInfo) => {
  226 |     /* §11 and §17 — three claims kept apart, and recorded from the first byte
  227 |      * of every document so the last one can be reported honestly:
  228 |      *
  229 |      *   1. the lifecycle HANDLERS exist and run          asserted below
  230 |      *   2. observable back-navigation behaviour          asserted below
  231 |      *   3. a genuine BFCache HIT                         recorded, not asserted
  232 |      *
  233 |      * `event.persisted` is the only honest way to tell (3) from (2), and under
  234 |      * Playwright it is routinely false: a fresh context, a `python -m
  235 |      * http.server` origin and an automation-driven traverse are between them
  236 |      * enough to keep the page out of the cache. Asserting it would either be
  237 |      * flaky or be a claim of coverage that does not exist. */
  238 |     await page.addInitScript(() => {
  239 |       const w = window as unknown as { __life: { name: string; persisted?: boolean }[] };
  240 |       w.__life = [];
  241 |       addEventListener('pageshow', (e) => w.__life.push({ name: 'pageshow', persisted: e.persisted }));
  242 |       addEventListener('pagehide', (e) => w.__life.push({ name: 'pagehide', persisted: e.persisted }));
  243 |     });
  244 | 
  245 |     await page.goto('/index.html');
  246 |     await settled(page);
  247 | 
  248 |     /* A first visit reserves nothing. The reserve is read from the history
  249 |        entry, so an entry that has never been measured must produce none at all
  250 |        — otherwise a first visitor pays for a mechanism that exists for a
  251 |        returning one. */
  252 |     const fresh = await page.evaluate(() => ({
  253 |       y: Math.round(scrollY),
  254 |       reserve: document.documentElement.style.getPropertyValue('--home-reserve'),
  255 |     }));
  256 |     expect(fresh.y, 'a fresh load did not start at the top').toBeLessThanOrEqual(4);
  257 |     expect(fresh.reserve, 'a fresh load left a height reservation up').toBe('');
  258 | 
  259 |     const before = await scrollToAnchor(page);
  260 |     // §14: restoring the scroll position and leaving the chrome describing a
  261 |     // different altitude would be the same defect wearing a different coat.
  262 |     expect(before.headerState, 'the header never left its opening state to begin with').not.toBe(
  263 |       'opening',
```
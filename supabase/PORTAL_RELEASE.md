# Stratos portál — élesítési útmutató (1–5. szakasz egyben)

Ez az egyetlen végigkövethető útmutató a portálbővítés élesítéséhez: tulajdonosi
hozzáférés és projektkövető (1.), Impact program (2.), dokumentumtár (3.), ügyfélfiókok
és megosztás (4.), fizetési ütemezés (5.). A részletes indoklás a szakaszok saját
leírásaiban van (`OWNER_TRACKER.md`, `DOCUMENTS.md`, `CLIENT_PORTAL.md`); ahol ez a
fájl eltér tőlük, **ez a fájl az érvényes**.

> **Állapot (2026-09-28):** az **1–6. szakasz élesben van** (napló: §12), a **7–8. szakasz**
> (demólinkek, megbeszélések, ügyfélsúgó, demó-észrevételek, új időpont javaslása) és a
> **Megjelenés-kapcsoló** (§14) is (napló: §15).
> Titkos értéket (jelszót, kulcsot, kapcsolati sztringet) **soha ne másolj be a
> beszélgetésbe**: a parancsok a te gépeden, interaktívan kérik el őket.

---

## 0. Ami tőled hiányzik

| # | Mi kell | Hol / hogyan | Melyik lépés |
|---|---|---|---|
| D1 | **A tulajdonos belépési e-mail-címe**; a fiók lépjen be egyszer a portálba, és legyen `super_admin` | a 7. lépés SQL-jébe írod be | 7 |
| D2 | **Hozzáférés a mentéshez** a saját gépeden: `supabase login` (böngészős belépés, a token a macOS kulcstartóba kerül) és az adatbázis-jelszó, amit a CLI interaktívan kér | §3 | 1 |
| D3 | A projekt **csomagja** (Free/Pro): van-e napi mentés vagy PITR a dashboardon | Settings → Database → Backups | 1 |
| D4 | Döntés a **kétes régi adatokról** — de **csak ha** a `legacy-data-review.sql` ténylegesen talál ilyet (§8) | a projektek paneljén, élesítés után | 2, 33 |
| D5 | **Netlify környezeti változók** beállítása (§5) — az értékeket te írod be a Netlify felületén | Netlify UI | 28 |
| D6 | **Auth-beállítások** a dashboardon (§6) | Supabase dashboard | 3 |
| D7 | **Egy általad kezelt teszt e-mail-cím** a meghívás élesítés utáni próbájához (valódi ügyfélnek előtte ne küldj) | §10 | 32 |

S3-kulcs **nem kell**: a fájlmentés a Supabase CLI saját belépésével megy
(`supabase storage cp`, §3). Ha már van meglévő S3-mentésed, az is jó; új kulcsot
emiatt ne hozz létre.

---

## 1. Mi van ma élesben — és mi nem biztos

A nyilvános anon kulccsal végzett csak-olvasó próbák szerint az éles adatbázis a
`20260816000100_revenue_operations.sql`-ig van migrálva. Hogy milyen régi adat
okoz majd kétes esetet, **csak a 2. lépés lekérdezése mondja meg** — ebben az
útmutatóban egyetlen éles konfliktus sincs „létezőként” állítva.

**Valószínű, de a hosztolt projekten nem ellenőrzött hiba a mostani portálban:** a
projekt-lekérdezés (`responsible:profiles(...)`) valódi PostgREST alatt kétértelmű
beágyazás miatt **PGRST201** hibát ad (a `project_members` tábla egy második
`projects`–`profiles` utat nyit). Helyben, valódi PostgREST-tel ez minden
projektképernyőt eltört; javítva (`portal/src/lib/operations.ts`). Ha élesben a
projektképernyők ma „Unavailable”-t mutatnak, ez az oka — a deploy javítja.

---

## 2. A karbantartási ablak — írásvédelem, nem fegyelem

**Miért kell ablak:** a 8. lépés (lockdown) után a régi portál más staff-fiókoknak
üres projektképernyőt mutat, a 24. lépés (fizetés) után a régi portál fizetési
mezős mentését az adatbázis elutasítja, az új portál pedig a migrációk előtt nem
működik. A régi és az új portál tehát nem futhat biztonságosan egymás mellett a
lépések között.

**Hogyan áll meg ténylegesen minden írás:** `checks/maintenance-on.sql` egy PostgREST
„pre-request” függvényt kapcsol be: **minden bejelentkezett API-kérés csak olvasható
tranzakcióban fut**. Helyi Supabase-en mérve:

| Kapu bekapcsolva | Eredmény |
|---|---|
| portál-írás bármely fiókkal (tábla vagy RPC) | elutasítva, `25006` |
| portál-olvasás | működik |
| nyilvános lead-űrlap (szerverkulcs) | működik, a lead eltárolódik |
| SQL-szerkesztő (migrációk) | nem érinti |
| Auth (belépés) és Storage | nem érinti — az ablakban egyiket sem írja portálkód (a bucket csak a 17. lépésben jön létre, a régi portálnak nincs dokumentumtára, a meghívó-függvény csak a deployjal érkezik) |

**Időtartam:** a teljes SQL-rész helyben ~1 s gépidő (kis adattal). Élesben a
lépéseket kézzel illeszted be; a verify-kimenetek átnézésével együtt reálisan
**15–25 perc**, plusz a Netlify build és deploy **3–5 perc**. Mivel az írás közben
technikailag tiltott, a hossz kényelmi és nem biztonsági kérdés: ha valami megakad,
a kapu nyitva hagyható, amíg végiggondolod.

**Ha a 3a. lépés hibát ad** (pl. a hosztolt projekt nem engedi az `authenticator`
szerep beállítását, vagy már van saját pre-request függvény): **állj meg**, ne
folytasd kapu nélkül. Tartalék: egy karbantartási deploy, amely a `/portal/*`
útvonalat egy statikus „karbantartás” oldalra irányítja; utána folytatható.

---

## 3. Mentés — az adatbázis és a fájlok külön, kulcsok a beszélgetésen kívül

A saját gépeden, egyszer (D2):

```bash
supabase login
```

```bash
supabase link --project-ref <a-projekt-ref-je>
```

A `link` az adatbázis-jelszót **interaktívan** kéri; ne add meg parancssori
argumentumként és ne írd fájlba a repóban. A mentés a repón kívüli mappába menjen:

```bash
supabase db dump --linked --role-only -f ~/stratos-backup/roles.sql
```

```bash
supabase db dump --linked -f ~/stratos-backup/schema.sql
```

```bash
supabase db dump --linked --data-only -f ~/stratos-backup/data.sql
```

Fájlok (a bucket az élesítés előtt még nem létezik; élesítés után ütemezetten):

```bash
supabase storage cp -r ss:///project-documents ~/stratos-backup/project-documents --linked --experimental
```

Mindhárom `db dump` és a `storage cp` helyi Supabase-en kipróbálva működik
(`--local` kapcsolóval). A hosztolt projekten nem futott. Ha a csomagod ad napi
mentést/PITR-t (D3), az a mentés kiegészítése, nem helyettesíti a fenti kézi
pillanatképet.

**Az adatbázismentés a fájlokat nem tartalmazza**, csak a `storage.objects`
katalógust; visszaállításhoz mindkettő kell, közeli időpontból. **Teljes
visszaállítás mentésből nem adatmegőrző** — a közben keletkezett fiókokat,
projekteket, befizetéseket, dokumentumokat is visszaforgatja; csak katasztrófára.
A normál visszaút a §9.

---

## 4. Élesítési lépéssor — a mentéstől a végső ellenőrzésig

Minden SQL-lépés **külön futtatás** a Supabase SQL-szerkesztőjében (egy futtatás =
egy tranzakció), a fájlnevek a `supabase/` mappához képest. **Megállás** = bármely
preflightban `false`, bármely verify-ban `ok = false`, vagy bármely migráció hibát ad.

### A. Előkészítés (írások még engedélyezve)

1. **Mentés** (§3), és jegyezd fel az időpontot.
2. `checks/legacy-data-review.sql` — **csak olvas**. Az első tábla kategóriánként
   megszámolja a kétes régi pénzügyi és Impact-eseteket; a második és harmadik
   felsorolja őket. **0 sor = nincs ilyen eset.** Ha van: nem kell előre
   javítani (a migráció nem veszít adatot és nem talál ki dátumot), de mentsd el a
   kimenetet a 33. lépéshez.
3. **Auth-beállítások** (§6).
4. Szerep-ellenőrzés:

   ```sql
   select current_user, rolsuper, rolbypassrls from pg_roles where rolname = current_user;
   ```

   Várt: `postgres`, `rolbypassrls = true` (helyi Supabase-en így van). Ha nem:
   **megállás**.

### B. Az ablak — portál-írások tiltva

5. `checks/maintenance-on.sql` — utolsó sora: `pgrst.db_pre_request=public.portal_maintenance_gate`.
   Ellenőrzés: a régi portálon egy mentés „refused”-t ad, a lista betölt.
6. `checks/owner-tracker-preflight.sql` — első tábla minden sora `true`.
7. `migrations/20260928000100_owner_tracker_enums.sql` — **egyedül** (enum-bővítés).
8. `migrations/20260928000200_owner_tracker.sql`
9. **Tulajdonos kijelölése** (D1):

   ```sql
   select portal_set_owner('<a tulajdonos belépési e-mail-címe>');
   ```

   ```sql
   select p.email, p.role from portal_owner o join profiles p on p.id = o.user_id;
   ```

   Pontosan egy sor, `super_admin`.
10. `migrations/20260928000300_owner_lockdown.sql` — tulajdonos nélkül megtagadja a futást.
11. `checks/owner-tracker-verify.sql` — minden sor `ok`.
12. `checks/impact-preflight.sql` — első tábla `true`.
13. `migrations/20260929000100_project_links_url_check.sql`
14. `migrations/20260929000200_impact_enums.sql` — **egyedül** (enum-bővítés).
15. `migrations/20260929000300_impact_program.sql` — kiírja `(captured, conflicts)`; a
    `conflicts` egyezzen a 2. lépés „impact CONFLICT” számával.
16. `checks/impact-verify.sql` — minden sor `ok`.
17. Settings → Storage: a projekt feltöltési korlátja ≥ 50 MB; majd
    `checks/documents-preflight.sql` — első tábla `true`.
18. `migrations/20260930000100_document_library.sql` — privát bucket (§7) és a
    felülírás-tiltó trigger.
19. `checks/documents-verify.sql` — minden sor `ok` (benne: `no-overwrite trigger on storage.objects`).
20. `migrations/20261001000100_client_portal.sql`
21. `checks/client-portal-verify.sql` — minden sor `ok`.
22. `checks/legacy-data-review.sql` újra (csak olvas) — ugyanazt kell mutatnia, mint a 2. lépés.
23. `migrations/20261002000100_payment_schedule.sql` — kiírja `(carried, review)`; a
    `review` egyezzen a 2. lépés „finance DOUBTFUL” sorainak projektjeivel.
24. `checks/payment-schedule-verify.sql` — minden sor `ok`; a második eredmény a
    kétes átvezetések listája.
25. **Netlify változók** (§5) ellenőrzése.
26. **Frontend és függvények deployja** (a szokásos build a `main`-ről vagy a
    kiadási ágról). Várd meg, amíg a deploy „Published”.
27. Olvasó füstpróba az új portálon (a kapu még zárva): belépés, Projects, egy
    projekt adatlapja, Impact, Documents betölt — hiba nélkül.
28. `checks/maintenance-off.sql` — az utolsó lekérdezés **0 sort** ad. Innentől az
    írások engedélyezettek; az ablak vége.

### C. Élesítés utáni ellenőrzés (írásokkal)

29. §10 ellenőrzőlista, tulajdonosként.
30. `checks/payment-schedule-verify.sql` és `checks/client-portal-verify.sql` újra —
    minden `ok`.
31. Első fájlmentés a bucketről (§3), és ütemezd (pl. naponta).
32. Meghívás próbája a saját teszt-címedre (D7), majd a tesztfiók visszavonása.
33. Csak ha a 2. lépés talált ilyet: a kétes pénzügyi tételek rendezése a projektek
    „Payment schedule” paneljén (befizetés dátummal, vagy „Mark as reviewed”), és
    az Impact-konfliktusok eldöntése.

Egy későbbi, nem sürgős takarítás: `drop function if exists public.portal_maintenance_gate();`

---

## 5. Környezeti változók (Netlify → Site settings → Environment variables)

| Változó | Hatókör | Szerep | Titkos? |
|---|---|---|---|
| `VITE_SUPABASE_URL` | Build | A projekt URL-je, a portál csomagjába kerül | nem |
| `VITE_SUPABASE_ANON_KEY` | Build | A **nyilvános** anon/publishable kulcs; a build megtagadja, ha titkos kulcs kerül ide | nem |
| `VITE_SITE_URL` | Build | `https://stratosweb.hu` | nem |
| `SUPABASE_URL` | Functions | Projekt URL a függvényeknek | nem |
| `SUPABASE_SECRET_KEY` (vagy régi: `SUPABASE_SERVICE_ROLE_KEY`) | **csak Functions** | Szerverkulcs: lead-beküldés, meghívó auth-felhasználója. Soha `VITE_` előtaggal | **igen** |
| `SUPABASE_ANON_KEY` | Functions | Nyilvános kulcs a meghívó-függvénynek; elhagyható, ha a `VITE_…` is látszik a függvényeknek | nem |
| `PORTAL_ORIGIN` | Functions | `https://stratosweb.hu` — ide mutatnak a meghívólinkek | nem |
| `IP_HASH_SALT`, analitika-, lead-értesítés-változók | Functions | változatlan | ahogy eddig |

---

## 6. Auth: beállítások és átirányítási címek

| Beállítás | Érték | Helyben ellenőrizve |
|---|---|---|
| Allow new users to sign up | **Ki** | igen (config) |
| Confirm email | Be | igen |
| Email link expiry | 3600 s, legfeljebb 86 400 | igen (alapértelmezett) |
| Minimum password length | **12** | igen |
| Site URL | `https://stratosweb.hu` | helyi megfelelője igen |
| Redirect URLs | `https://stratosweb.hu/portal/reset-password` | helyi megfelelője igen: a jelszó-visszaállító levél (helyi levélfogóban) pontosan ide irányított |
| JWT expiry | maradjon 3600 s | lásd lent |

**Meghívás:** a link `https://stratosweb.hu/portal/accept-invite#token_hash=…&type=…`;
a token a fragmentben van, a oldal eltávolítja a címsorból, majd `verifyOtp`-vel
váltja be — külön redirect-bejegyzés nem kell. Helyben valódi GoTrue-val végigpróbálva.

**Kijelentkezés:** a munkamenet és a frissítő token azonnal megszűnik (helyben
ellenőrizve), de a már kiadott **access token a lejáratáig (JWT expiry) érvényes
marad** — ez a Supabase tervezett működése. Ezért ne növeld a JWT-lejáratot.

---

## 7. A privát bucket és a feltöltési korlátok

A 18. lépés hozza létre: `project-documents`, **privát**, `52428800` bájt,
`application/octet-stream` egyedüli MIME-típus. Ügyfélkorlátok: 10 folyamatban,
200/nap, 2 GB/nap; meghívás 30/óra — egyidejű kéréseknél is tartják magukat.

**Felülírás-tiltás (új, valódi Storage-on talált hiba javítása):** a Storage egy
függő útvonalra **upsert-es feltöltési linket is kiad**, és a tokenes feltöltésnél
nem ellenőriz RLS-t — így egy korábban kiadott link a véglegesítés után felülírta a
kész dokumentumot. Most egy trigger a `storage.objects`-en tilt minden módosítást
ebben a bucketben; a felülírási kísérlet 400-at kap és az eredeti bájtok megmaradnak
(helyben ellenőrizve tulajdonosi és ügyfél-linkkel is).

---

## 8. Meglévő adatok — csak lekérdezésből

Hogy van-e kétes eset, azt a `checks/legacy-data-review.sql` (2. és 22. lépés)
dönti el. Kategóriák (mindegyik 0 is lehet):

- *finance DOUBTFUL*: „fizetve” összeg nélkül; „fizetve” kevesebb befizetéssel;
  „részben fizetve” összeg nélkül; állapot és összeg ellentmond; befizetés vagy
  számlázás több a szerződöttnél; állapot összeg nélkül.
- *impact CONFLICT*: Impact-lead, amelyhez már van üzlet — fizetős marad, nem
  sorolódik át.
- *impact AMBIGUOUS*: csak szövegben említi az Impactot — érintetlen marad.

A migrációk ezeket nem „javítják”: az eredeti értékek a `project_finance_legacy`
táblába kerülnek, a befizetés dátum nélkül jön át, az eset a projekt paneljén
jelölve marad, amíg te nem rendezed (33. lépés).

---

## 9. Adatmegőrző visszaállítás

Sorrend: **kapu be** (`maintenance-on.sql`) → **frontend vissza** (Netlify → Deploys →
az előző sikeres deploy → „Publish deploy”) → SQL fordított sorrendben, ameddig kell →
**kapu ki**:

1. `checks/payment-schedule-rollback.sql`
2. `checks/client-portal-rollback.sql`
3. `checks/documents-rollback.sql`
4. `checks/impact-rollback.sql`
5. `checks/owner-lockdown-rollback.sql`
6. `checks/owner-tracker-rollback.sql`

Nem töröl: ügyfélfiókot, hozzárendelést, megosztást, auth-felhasználót, projektet,
Impact-jelentkezést, piaci értéket, részletet, befizetést, átvezetési pillanatképet,
dokumentumsort, tárolt fájlt. A felülírás-tiltó trigger marad (csak a megmaradó
fájlokat védi). Korlátok: enum-érték nem vonható vissza; új oszlopok/táblák
maradnak; a fizetési rollback után a három egyösszegű mező újra kézzel írható, és
ha a migrációt később újra alkalmazod, az ütemezés felülírja a közbeni kézi
értékeket (előbb rögzítsd a befizetést); kiadott letöltési link (60 s) a lejáratáig
él.

---

## 10. Élesítés utáni ellenőrzőlista (29. lépés)

- [ ] Belépés tulajdonosként; Projects, Impact, Documents a menüben.
- [ ] Fizetős projekt: checkpoint kész → Close project → egyszeri konfetti; újratöltésre nincs újra; Reopen működik.
- [ ] Payment schedule: részlet esedékességgel, részbefizetés dátummal; Paid/Remaining/Overdue frissül; Receivables pénznemenként.
- [ ] Sales → Follow-ups: Done → eltűnik, egy „Done: …” jegyzet. A táblanézet a hónapra nyílik; „Clear filters” mindent mutat.
- [ ] Impact: számlálók, egy jelentkezés.
- [ ] Documents: PDF, PNG, `.txt` feltöltése; átnevezett `.exe` elutasítva; letöltés **ékezetes névvel** (pl. „Ajánlat.pdf”), képelőnézet, lomtár/visszaállítás.
- [ ] Meghívás a teszt-címre, link privát ablakban, jelszó, magyar felület, csak a hozzárendelt projekt; megosztott fájl letöltése; Nyersanyag leadása; kijelentkezés; hozzárendelés visszavonása → minden eltűnik; tesztfiók visszavonása.
- [ ] Másik staff-fiókkal: nincs Projects/Impact/Documents menü.
- [ ] A böngésző konzolján nincs CSP-hiba.

---

## 11. Mi lett ellenőrizve, és hol — helyi vs. hosztolt

### Helyi, valódi Supabase-szolgáltatásokkal (Colima + Supabase CLI 2.118, 2026-09-27)

Postgres 17.6, PostgREST, GoTrue 2.197, Storage 1.77, Mailpit levélfogó; csak
tesztadatok, `@example.invalid` címek. Minden szkript megtagadja a nem helyi címet.

| Ellenőrzés | Parancs | Eredmény |
|---|---|---|
| Kiadási próba: mai éles séma + régi adatok → minden lépés a fenti sorrendben, `postgres` (nem superuser, BYPASSRLS) szerepként, valódi GoTrue teszttulajdonossal, kapu be/ki | `node scripts/local-supabase-release.mjs` | 28/28 |
| Dokumentumtár valódi Storage-dzsal: bucket-beállítás, feltöltési link élettartama (7200 s), régi link újrahasználata, upsert-felülírás tiltása, MIME-szabály, 50 MB + 1 bájt, hibás méret, letöltési link lejárata, szerepek | `npm run check:documents:live` | 13/13 |
| Ügyfélportál: meghívás a valódi függvénnyel, ismételt és 5 egyidejű meghívás, staff/idegen cég védelme, belépés/kijelentkezés, jelszó-visszaállító levél, megosztás, mappából örökölt hozzáférés, áthelyezés, lomtár, visszavonás, idegen azonosítók, méret-/típuskorlát, megszakadt feltöltés, upsert-felülírás, belső adatok hiánya, fiók visszavonása | `npm run check:client-portal:live` | 19/19 |
| Böngésző (Chromium) a valódi szolgáltatásokkal, az éles CSP-vel: 20 tulajdonosi képernyő hibamentes API-olvasása, meghívás a felületről, fizetés rögzítése, feltöltés és megosztás, link → jelszó → magyar ügyfélportál, letöltés ékezetes névvel, nyersanyag leadása, tiltott típus, mobil nézet, kijelentkezés | `node scripts/portal-live-browser-check.mjs` | 15/15 |
| Mentés: `db dump` (roles/schema/data) és `storage cp` | §3, `--local` | működik |

### A hosztolt projekten még ellenőrizetlen

- Hogy a hosztolt `postgres` szerep pontosan úgy viselkedik, mint helyben (BYPASSRLS, trigger a `storage.objects`-en, `alter role authenticator` a kapuhoz) — a 4., 5. és 19. lépés kimenete dönti el.
- A hosztolt Storage verziója és a helyivel azonos viselkedése (upsert-link, tokenes feltöltés); a trigger ettől függetlenül véd.
- CORS a `https://stratosweb.hu` → `*.supabase.co` közvetlen feltöltésnél (helyben kereszt-origin feltöltés működött).
- A Netlify-n futó függvény és a valódi CSP-fejléc a `*.supabase.co`-val.
- Az Auth-beállítások tényleges értékei a dashboardon, a JWT-lejárat.
- A régi adatok tényleges kétes esetei (2. lépés).
- A `supabase db dump --linked` és `storage cp --linked` a hosztolt projekten.

Egyéb rétegek (változatlanul zöldek): PGlite adatbázis-tesztek, valódi Postgres
17.10 párhuzamossági szkript (`npm run check:pg:integration`, 46/46), mockolt
felületi ellenőrzések (32 + 18 + 11), típusellenőrzés, production build, titokkeresés.


---

## 12. Élesítési napló — 2026-09-27/28 (1–6. szakasz)

| Mi | Érték |
|---|---|
| Supabase-projekt | `onyynfpowjwsoivkefcz` (Postgres 17.6) |
| Netlify-webhely | `stratosweb1` → https://stratosweb.hu, a GitHub `main`-ről buildel |
| Visszaállítási pont (frontend) | deploy `6ab927f6fcf30a0008123034` (commit `a788bdc`) |
| Új éles deploy | `6ab9a442bd664c0008d7b86e` (commit `20201cd`) |
| Mentés | `~/stratos-backup/2026-09-28-pre-portal-release/` (roles/schema/data + SHA256SUMS + README); helyi visszaállítással ellenőrizve, 25 tábla sorszáma egyezett; élesben 0 tárolt fájl volt |
| Régi adatok | `legacy-data-review.sql`: 0 pénzügyi tétel, 0 konfliktus, 3 Impact-lead → jelentkezés |
| Auth (dashboardon, a tulajdonos által) | Site URL `https://stratosweb.hu`; + redirect `https://stratosweb.hu/portal/reset-password`; regisztráció ki; minimum jelszó 12 |
| Írásvédelem | be 2026-09-27 23:11:07 UTC → ki 23:44:16 UTC; élesben igazolva: tulajdonosi írás 25006-tal elutasítva, fejléc `X-Stratos-Maintenance: on` |
| Migrációk | a §4 sorrendje szerint mind a 12 (`20260928000100` … `20261003000100`), minden verify `ok` |
| Tulajdonos / megbízott | lukacs.artur@stratosweb.hu (super_admin) / timar.richard@stratosweb.hu (admin, `portal_add_delegate`) |
| Éles próbák (TESZT ügyfél, „Teszt” projekt) | fizetési ütemezés és összesítő; jövőbeli dátum és kézi átírás elutasítva; feltöltés, véglegesítés, **upsert-felülírás 400, tartalom változatlan** a hosztolt Storage-on; letöltés; CORS és CSP a stratosweb.hu-ról; meghívás, jelszóbeállítás, ügyfélnézet, megosztott fájl letöltése, nyersanyag-leadás; hozzáférés-visszavonás → 0 projekt/dokumentum/objektum |
| Tesztadat | a tulajdonos kérésére **bent maradt** (TESZT ügyfél, „Teszt” projekt, 2 részlet, 1 befizetés, 2 fájl); a tesztfiók (lukacsartur13@icloud.com) projekt-hozzárendelése visszavonva |
| Eltérés | `PORTAL_ORIGIN` nem lett beállítva (Netlify: Forbidden) — a meghívó-függvény a Netlify `URL`-jét (https://stratosweb.hu) használja; `documents-verify.sql` a 4. szakasz megosztásaival hamis hibát adott → javítva (csak a szkript) |
| Takarítás később | `drop function if exists public.portal_maintenance_gate();` |

---

## 13. 7–8. szakasz — demólinkek, megbeszélések, ügyfélsúgó, észrevételek, új időpont

**Élesben (napló: §15).** Additív: új táblák és függvények, meglévő adatot és írást
nem érint, ezért **írásvédelem nem kell**. A régi (mostani) portál nem használja az
új objektumokat; az új portál a migrációk nélkül ezeknél a részeknél
„nem tölthető be” üzenetet mutat. **Sorrend: migrációk → ellenőrzés → deploy.**

1. Mentés (§3).
2. `migrations/20261004000100_client_demos_meetings_help.sql`
3. `migrations/20261004000200_help_seed.sql` — 74 cikk, mind publikált (a tulajdonos 2026-09-28-i döntéseivel); újrafuttatva nem írja felül a szerkesztéseket.
4. `migrations/20261005000100_client_feedback_reschedule.sql` — demó-észrevételek és időpont-javaslatok.
5. `checks/client-extras-verify.sql` — minden sor `ok`.
6. `checks/client-portal-verify.sql` — minden sor `ok` (a definer-lista már a 7. szakaszt is ismeri).
7. Deploy (commit + push a `main`-re).
8. Próba a TESZT projekten: demó + megbeszélés; a tesztfiókkal a demókártya, „Észrevételek”, „Új időpont javaslása”, „Google Naptárba helyezés”, Segítség fül; tulajdonosként a „Client inbox” és a projektoldali elfogadás/elutasítás.

Visszaállítás: a frontend előző deployja; a táblák maradhatnak (semmi nem olvassa őket).
Ha el kell zárni:
`revoke execute on function client_portal_demos(), client_portal_meetings(), client_help_articles() from authenticated;`
`revoke execute on function client_send_demo_feedback(uuid,text), client_request_meeting_change(uuid,timestamptz,timestamptz,text,text), client_withdraw_meeting_request(uuid) from authenticated;`

### Tulajdonosi tudnivalók

- **A demóoldal a portálon kívül publikus.** A portál csak a LINKET mutatja a
  hozzárendelt ügyfélnek; aki ismeri a címet, megnyithatja. Ha titkos, a demó
  tárhelyén kell védeni (pl. jelszóval). A portál a linket nem tölti le és nem ágyazza be.
- Csak `https://` cím fogadható el (nincs `http:`, `javascript:`, `data:`, szóköz,
  `felhasználó:jelszó@`) — adatbázis-szinten is.
- A megbeszélés **nem küld e-mailt vagy naptármeghívót**. Az ügyfél a
  „Google Naptárba helyezés” gombbal menti; a portálon módosított időpont a már
  elmentett naptárbejegyzést nem frissíti (a felület ezt kiírja).
- A nyári időszámítás miatt nem létező órát a felület elutasítja; a kétszer
  előforduló órát csak második mentéssel fogadja el (az első, nyári időt használja).
- A súgó csak **publikált** cikkekből válaszol, a böngészőben (külső AI nincs), a
  beszélgetést nem tárolja és nem továbbítja. Szerkesztés: Help centre menü.
- **Észrevételek (8. szakasz).** Az ügyfél a demó alatt írhat (max. 2000 karakter,
  naponta 30). **Értesítés nem megy** — a Projektek oldal „Client inbox” panelje és a
  projekt „Client portal view” része mutatja; „Mark read” után az ügyfél „A Stratos
  látta” jelzést lát. Az üzenet nem szerkeszthető és nem törölhető.
- **Új időpont (8. szakasz).** Az ügyfél megbeszélésenként egy függő javaslatot
  küldhet (múltbeli nem, max. 24 óra), és visszavonhatja. Döntés csak a
  „Accept — move the meeting” / „Decline” gombbal (az `owner_decide_meeting_request`
  függvény): elfogadáskor a megbeszélés átkerül az új időpontra, a többi függő
  javaslat „Másik javaslat lett elfogadva.” megjegyzéssel elutasítva. E-mail itt sem
  megy; ha sürgős, szólj az ügyfélnek külön.

### A súgócikkek állapota

Vázlat nincs. A négy korábbi vázlat a tulajdonos 2026-09-28-i szövegével publikált
(elkészülési idő: „az egyeztetés során rögzítjük”; demó-visszajelzés és új időpont a
portálon; további módosítás: szerződés szerinti körök, díj a mértéktől függ,
karbantartás havidíjas, válasz 1 munkanapon belül).

A nyilvános webhely (kkv.html, rolunk.html és EN/DE megfelelőik: GYIK, a Rólunk
„Gyors átfutás” kártyája, a KKV oldal zárómondata) már ugyanezt mondja; napos-hetes
ígéret nem maradt rajta.

A GYIK-források listája: `supabase/help/faq-inventory.json` (8 publikált oldal,
oldalanként HU/EN/DE 68-68 bejegyzés, 60 egyedi téma).

### Ami a 7–8. szakaszból ellenőrizve lett (helyben)

| Réteg | Eredmény |
|---|---|
| PGlite: jogosultság, idegen projekt, közzététel/visszavonás/hozzáférés-megszüntetés, URL-ek, megbeszélés-szabályok, észrevételek, időpont-javaslat és döntés, verify, párosító | 25/25 |
| Egységtesztek: DST, Google Naptár-kódolás, „következő” kiválasztás, URL-szabály, párosító, szerződések | 18/18 |
| Renderelt, mockolt: ügyfél és tulajdonos | 17/17 + 37/37 |
| Valódi helyi Supabase: kiadási próba, dokumentumok, élő ügyfélportál, böngésző | 36/36, 13/13, 22/22, 18/18 |
| Valódi Postgres 17.10 | 52/52 |
| Teljes portál-tesztcsomag (Playwright, minden nézet) | 1161/1161 |

## 14. Megjelenés: Rendszer / Világos / Sötét (csak frontend)

**Élesben (napló: §15).** Migráció és adatbázis-változás nincs, élesítése egy deploy.
A kapcsoló három helyen van: a tulajdonosi oldalsáv alján, az ügyfélportál fejlécében
és a bejelentkezési oldalon. Az alapérték a „Rendszer”, ami élőben követi az eszköz
beállítását. A választást az adott böngésző tárolja (`localStorage`: `stratos.portal.theme`),
a fiókhoz nem kötődik, és nem megy el sehová. Az első megjelenítés előtt a
`/portal/theme-boot.js` állítja be (külön fájlban, mert a CSP nem enged inline scriptet),
ezért nem villan fel a másik téma.

Ellenőrizve: a renderelt tesztek minden ügyfél- és tulajdonosi képernyőt mindkét témában
végigmérnek, és minden látható szövegnél legalább 4.5:1 kontrasztot követelnek meg
(19/19, 38/38). A csak node-on futó teszt (`tests/portal-theme.spec.ts`) 5/5.
A korábban 70–80%-ra halványított szürke feliratok sötét módban sem érték el a 4.5:1-et,
ezért most teljes erősségűek.

## 15. Élesítési napló — 2026-09-28 (7–8. szakasz, Megjelenés, webhely-GYIK)

| Mi | Érték |
|---|---|
| Visszaállítási pont (frontend) | deploy `6ab9a442bd664c0008d7b86e` (commit `20201cd`) |
| Mentés | `~/stratos-backup/2026-09-28-pre-phase7-8/` (roles/schema/data + SHA256SUMS + a bucket 2 fájlja) |
| Migrációk (11:23–11:24 UTC) | `20261004000100`, `20261004000200`, `20261005000100` — mind hiba nélkül |
| Verify élesben | client-extras 10/10, client-portal 13/13, documents 17/17, payment-schedule 15/15, owner-delegates 6/6 |
| Adatok | 74 súgócikk, mind publikált; a meglévő adatok változatlanok: 1 projekt, 1 ügyfélfiók, 2 fájl |
| Webhely | az elkészülési idő szövege a súgóéval egyezik (kkv, rólunk; HU/EN/DE); a napos-hetes ígéret törölve |

## 16. Havi szerződések (9. szakasz)

**Élesítve 2026-10-02:** a migráció lefutott az SQL-szerkesztőben, az ellenőrző lekérdezés
minden sora az elvárt értéket adta (a tulajdonos jelzése szerint); a frontend a `main`-re
pusholt commitból deployol. Eredetileg: egy migráció, utána egy deploy — **ebben a sorrendben**: az új
portál már olvassa a `billing` és `monthly_fee` oszlopot, a migráció előtt a
projektképernyők „Unavailable”-t mutatnának.

1. SQL-szerkesztő: `supabase/migrations/20261006000100_monthly_contracts.sql` (hiba nélkül fut; ismételt futtatás is biztonságos).
2. Deploy.

Mit csinál:

- A projekt **egyszeri** (`one_off`, minden meglévő projekt ilyen marad) vagy **havi
  szerződés** (`monthly`). Létrehozáskor választod, utána nem változtatható
  (`stratos:project_billing_fixed`).
- Havi szerződésnek **havi díja** van (kötelező, a projekt pénznemében), egyszeri
  projektértéke nincs; Impact projekt nem lehet havi. Ezt az adatbázis is kikényszeríti
  (`projects_monthly_shape_check`). A díj minden változása naplózódik (Activity).
- **Külön kezelés:** Projects → **Monthly contracts** fül: a futó szerződések havi díjai
  pénznemenként összesítve, a lista a díjjal, kezdettel, eltelt hónapokkal, lejárattal.
  Az Active/Closed lista és a Dashboard „Active projects” blokkja csak egyszeri projekteket mutat.
- A szerződés **megszüntetése** = lezárás („End contract”), checkpoint nélkül is; újranyitható.
- **Fizetés:** ugyanaz a fizetési ütemező, havonta egy részlettel; a „+ Month” gomb kitölti
  a következő hónapot a mostani díjjal. Havi szerződésnél nincs „schedule ≠ contract” jelzés.

Ellenőrizve (helyben): PGlite `tests/portal-monthly-db.spec.ts` 9/9; renderelt, mockolt
`scripts/portal-tracker-check.mjs` 42/42 (benne 4 új havi eset és a kontrasztmérés a két új
képernyőn); a meglévő portál-tesztek (node + desktop-1440) zöldek.

## 17. Kuka: projektek, ügyfelek és leadek törlése a portálon (10. szakasz)

**Élesítve 2026-10-02:** a migráció hiba nélkül lefutott az SQL-szerkesztőben, utána push a `main`-re.

**Sorrend: migráció → ellenőrzés → deploy.** Az új portál olvassa a `leads.trashed_at`
oszlopot; a migráció előtt a Leads lista hibát adna. A mostani élő portál a migráció
után változatlanul működik, karbantartási ablak nem kell.

1. SQL Editor: `supabase/migrations/20261007000100_trash.sql` (ismételten is futtatható).
2. Ellenőrzés: a lenti lekérdezés minden sora `true`.
3. Deploy (push a `main`-re).

```sql
select 'leads.trashed_at' as mi, exists (select 1 from information_schema.columns
  where table_name = 'leads' and column_name = 'trashed_at') as ok
union all select 'purge függvények', count(*) = 6 from pg_proc
  where proname in ('purge_project', 'purge_client', 'purge_lead',
                    'project_purge_blockers', 'client_purge_blockers', 'lead_purge_blockers')
union all select 'törlés-triggerek', count(*) = 3 from pg_trigger
  where tgname in ('projects_deleted', 'organizations_deleted', 'leads_deleted')
union all select 'anon nem törölhet', not has_function_privilege('anon', 'purge_project(uuid)', 'execute')
union all select 'bejelentkezett hívhatja', has_function_privilege('authenticated', 'purge_project(uuid)', 'execute');
```

Mit csinál:

- **Move to trash** a projekt, az ügyfél és a lead oldalán: eltűnik minden listából és
  összesítőből (az Impact-számlálókból és a forrás→lead→won kimutatásból is), a
  Kukába tett projekt az ügyfélportálon sem látszik. Visszaállítható.
  Projektnél és ügyfélnél ez a meglévő `archived_at`, tehát a korábban archivált
  projektek is a Kukában jelennek meg.
- **Trash** menüpont: Restore, illetve **Delete permanently**. A végleges törlést az adatbázis
  megtagadja, és megnevezi az okát, ha a projekthez fizetési részlet, dokumentum,
  ügyfélportál-hozzáférés, demó, megbeszélés vagy Impact-jelentkezés tartozik; ügyfélnél ha
  van projektje (a Kukában lévő is), ügyfélportál-fiókja vagy sales-lehetősége; leadnél ha
  Impact-jelentkezés tartozik hozzá. Ami csak az adott rekordhoz tartozik (checkpointok,
  költségek, linkek, jegyzetek, kapcsolattartók) vele együtt törlődik. Minden törlés naplózódik
  (lead esetén személyes adat nélkül).
- Jogok: projekt — csak a tulajdonos; ügyfél — Kukába bárki, aki ügyfelet kezel, véglegesen
  csak a tulajdonos; lead — aki leadet kezel.

Ellenőrizve (helyben): PGlite `tests/portal-trash-db.spec.ts` 10/10; renderelt, mockolt
`scripts/portal-tracker-check.mjs` 46/46 (4 új Kuka-eset, kontrasztmérés a Kuka oldalon);
a meglévő portál-tesztek (node + desktop-1440) zöldek, köztük a dokumentumtár és az
ügyfélportál definer-függvény szabályai.

## 18. All fül, Impact-projekt jelentkezés nélkül, Impact-leadek törlése (11. szakasz)

**Élesítve 2026-10-05:** a migráció hiba nélkül lefutott, utána push a `main`-re.

**Sorrend: migráció → deploy.** A frontend a migráció előtt sem törik el, de az „New Impact
project” és az Impact-lead végleges törlése csak a migráció után működik.

1. SQL Editor: `supabase/migrations/20261008000100_impact_direct.sql` (ismételten is futtatható).
2. Ellenőrzés — mindkét sor `true`:

```sql
select 'impact_direct oszlop' as mi, exists (select 1 from information_schema.columns
  where table_name = 'projects' and column_name = 'impact_direct') as ok
union all select 'lead-törlés trigger', exists (select 1 from pg_trigger
  where tgname = 'leads_delete_impact_application');
```

3. Deploy (push a `main`-re).

Mit csinál:

- **Projects → All:** minden projekt egy listában (egyszeri, havi, Impact; nyitott és lezárt,
  a Kuka nélkül), típus-szűrővel és kereséssel. Felül négy szám: folyamatban lévő egyszeri
  projektek (és a megállapodott értékük pénznemenként), futó havi szerződések (havidíjak),
  folyamatban lévő Impact-projektek (piaci érték, ingyenes), és ami figyelmet kér (késik,
  ügyfélre vár, elakadt). A különböző fajta összegeket sosem adja össze.
- **Impact → New Impact project:** Impact-projekt jelentkezés nélkül (`impact_direct`), meglévő
  vagy új ügyféllel. Ugyanúgy ingyenes, HUF, és csak piaci értékkel zárható le.
- **Impact-lead törlése:** a jelentkezés oldalán „Move to trash” (a lead kerül a Kukába, és
  kikerül az Impact-folyamatból), majd a Kukából véglegesen törölhető — csak a tulajdonos
  törölheti. A jelentkezés vele együtt törlődik; ha indult belőle projekt, az megmarad
  (jelentkezés nélküli Impact-projektként).

Ellenőrizve (helyben): `tests/portal-trash-db.spec.ts` 12/12; `scripts/portal-tracker-check.mjs`
49/49; a node- és desktop-tesztcsomag zöld (244 + 266).

## 19. Nyelvválasztás: magyar, angol, német (12. szakasz)

**Élesítve 2026-10-05:** a migráció hiba nélkül lefutott, utána push a `main`-re.

**Sorrend: migráció → deploy.** A frontend a migráció nélkül sem törik el (a nyelv akkor
csak az adott eszközön marad meg), de a fiókhoz mentéshez a migráció kell.

1. SQL Editor: `supabase/migrations/20261009000100_profile_locale.sql` (ismételten is futtatható).
2. Deploy (push a `main`-re).

Mit csinál:

- **Mindenki maga választ** (Magyar · English · Deutsch): a tulajdonosi oldalsáv alján, a
  **Settings → Language** blokkban, az ügyfélportál fejlécében és a belépési oldalon. A választás a
  saját profilra mentődik (`profiles.locale`), így minden eszközön ugyanaz; más nevében senki nem választ.
- **Amíg valaki nem választ, minden úgy marad, mint eddig:** a tulajdonosi felület angol, az
  ügyfélportál magyar.
- **Mi fordul:** a tulajdonosi felület és az ügyfélportál minden felirata, üzenete, hibaüzenete,
  státusza; a dátumok és számok formátuma a választott nyelvé.
- **Mi nem:** amit ti írtok be (projekt- és ügyfélnevek, jegyzetek, megbeszélések címe), a súgócikkek
  tartalma (magyar; angolul/németül egy rövid megjegyzés jelzi), a meghívó e-mail, a Google
  Naptár-esemény szövege, és az adatbázisba írt alapértékek (pl. „Előleg” részletnév).

Hogyan működik: a fordítás kulcsa maga a forrásszöveg (`portal/src/lib/i18n.ts`, `t('…')`); a
fordítások `portal/src/i18n/parts/*.json`-ban vannak (≈1780 kulcs). `node scripts/i18n-check.mjs`
megmutatja a hiányzó fordítást, az ütközést (ugyanaz a kulcs két fordítással — hibának számít) és a
valószínűleg be nem csomagolt szöveget. Új felirat írásakor: `t('…')`, és a kulcs a részfájlba.

Ellenőrizve (helyben): `tests/portal-locale-db.spec.ts` 4/4 (saját nyelv, csak hu/en/de, másét nem
írhatja; `t()`; minden fordítás megtartja a helyőrzőit); `scripts/portal-tracker-check.mjs` 51/51
(magyarra váltás és mentés, a fiók nyelve új eszközön, német oldalak kontrasztja és 390 px-es
szélessége); `scripts/portal-client-check.mjs` 20/20 (angol és német ügyfélportál); a node- és
desktop-tesztcsomag zöld (253 + 287).

## 20. A súgócikkek angolul és németül (13. szakasz)

**Élesítve 2026-10-05:** a migráció hiba nélkül lefutott, utána push a `main`-re.

**Sorrend: migráció → deploy.** A tulajdonosi Súgóközpont az új `translations` oszlopot is
olvassa, ezért a migráció előtt nem töltene be.

1. SQL Editor: `supabase/migrations/20261010000100_help_translations.sql` (≈90 KB, ismételten is
   futtatható; meglévő fordítást nem ír felül).
2. Ellenőrzés: `select count(*) filter (where translations ? 'en' and translations ? 'de') as forditott, count(*) as osszes from help_articles;`
   — a két szám akkor egyezik, ha egyik cikket sem szerkesztetted a portálon az első feltöltés óta.
3. Deploy (push a `main`-re).

Mit csinál:

- Minden súgócikk mellé angol és német kérdés, válasz, téma és alternatív kérdések kerülnek
  (`help_articles.translations`). A magyar marad maga a cikk.
- **60 cikk** a weboldal saját, publikált angol és német GYIK-szövegét kapja (`_build/i18n`), a
  weboldal tegező német hangján; **14 portálos cikk** fordítása itt készült, a gombokat pontosan úgy
  nevezve, ahogy a lefordított portál mutatja.
- Egy cikk csak akkor kap fordítást, ha a magyar kérdése és válasza még pontosan a feltöltött
  szöveg — amit közben a portálon átírtál, azt a Súgóközpontban fordítsd le (a lista jelöli: az áthúzott
  `en`/`de` hiányzó fordítás).
- Az ügyfél súgója a választott nyelven keres és válaszol; fordítás nélküli cikk magyarul jelenik meg,
  és ezt egy megjegyzés jelzi. A Súgóközpont cikkablakában angol és német mező is van.

Ellenőrizve (helyben): `tests/portal-help-i18n.spec.ts` 5/5 (74 cikk fordítva, a szerkesztett kimarad, a
forma ki van kényszerítve, a weboldal szövege kerül át, a kereső angolul és németül is a jó cikket adja);
`scripts/portal-client-check.mjs` 20/20 és `scripts/portal-tracker-check.mjs` 52/52.

## 21. Alapok: fájlmegnyitás, jegyzetek, Ma, tevékenységnapló (14. szakasz, „1. Alapok”)

**Élesítve 2026-10-05:** a migráció hiba nélkül lefutott, utána push a `main`-re.

**Sorrend: a 20. szakasz migrációja (súgófordítás), majd ez, majd deploy.** Az új Jegyzetek és Ma
képernyő a migráció előtt „not installed” hibát mutatna.

1. SQL Editor: `supabase/migrations/20261011000100_notes_tasks_activity.sql` (ismételten is futtatható).
2. Deploy (push a `main`-re).

Mit csinál:

- **Fájlmegnyitás letöltés nélkül** — a tulajdonosi dokumentumtárban (Preview) és az ügyfélportál
  „Megosztott dokumentumok” oldalán (Megnyitás): **PDF** (PDF.js, oldalanként, nagyítással), **Word .docx**
  (szövegként: címsorok, listák, táblázatok, képek; az elrendezés egyszerűsítve) és **Excel .xlsx**
  (munkalaponként, táblázatként), a képek és szövegek mellett. Biztonság: a fájl semmit nem futtathat — a
  PDF-szkriptek és az `eval` ki vannak kapcsolva, a Word-tartalom engedélylistás elemekből épül újra (link
  nem kattintható, csak beágyazott raszterkép marad), HTML/SVG/régi .doc/.xls továbbra is csak letölthető.
  A három olvasó (pdfjs-dist 4.10, mammoth, read-excel-file) csak megnyitáskor töltődik be. A PDF-olvasó
  `.mjs` munkafájlja JavaScript-típussal megy ki (`netlify.toml`).
- **Jegyzetek** (új menüpont): sima jegyzet vagy lista, ügyfélhez köthető, kitűzhető, kereshető,
  archiválható. Megbeszélés közbeni gyors rögzítésre: Enter = a pont elmentve, a kurzor marad. Dátumos pont
  = feladat; egy pont egy kattintással az ügyfél egyik projektjének mérföldkövévé alakítható (csak a
  tulajdonos). Az ügyfél oldalán „Jegyzetek és listák” panel.
- **Ma** (új menüpont): ami ma esedékes vagy késik — feladatok, sales-utánkövetések, projekt-mérföldkövek, a
  mai megbeszélések; gyors feladatfelvétel (a „Teendők” listába).
- **Tevékenységnapló** az ügyfél, a lead és a lehetőség oldalán: hívás / e-mail / megbeszélés / üzenet,
  időponttal. Egy lead végleges törlése a naplóját is viszi.
- Az ügyfélportál német szövege tegező; a fordítások csak akkor töltődnek le, ha valaki nyelvet választott
  (az induló fájl ~258 KB maradt).
- `supabase/checks/client-extras-verify.sql`: a súgó új `translations` oszlopát is elfogadja.

Ellenőrizve (helyben): `tests/portal-notes-db.spec.ts` 5/5; dokumentum-ellenőrző 18/18 (valódi PDF,
.docx és .xlsx mintákkal, `scripts/fixtures/`); ügyfélportál 21/21; tulajdonosi ellenőrző 55/55; minden
portál-teszt (263 + 288) — kihagyott teszt nélkül.

## 22. Munkaidő: ki, melyik nap, hány órát, mire (15. szakasz)

**Élesítve 2026-10-05:** a migráció hiba nélkül lefutott, utána push a `main`-re.

**Sorrend: 20. → 21. → ez a migráció, majd deploy.**

1. SQL Editor: `supabase/migrations/20261012000100_time_entries.sql` (ismételten is futtatható).
2. Deploy (push a `main`-re).

Mit csinál:

- **Munkaidő** (új menüpont): naponta egy vagy több sor — óra (negyedórára), mire ment (bármelyik projekt,
  vagy „Egyéb” szabad szöveggel), megjegyzés. Heti táblázat: sorban az emberek, oszlopban a napok, a cellára
  kattintva az aznapi sorok; hétváltás.
- **Mindenki látja a többiekét, mindenki a sajátját írja**; a tulajdonos bárkiét javíthatja. Egy napra
  legfeljebb 24 óra.
- **Bármelyik admin bármelyik projektre írhat órát** (a tulajdonos döntése, 2026-10-05). Ehhez a `time_projects()`
  függvény a projekteknek csak a nevét, az ügyfél nevét és a lezártságát adja ki; érték, fizetés, mérföldkő és
  dokumentum továbbra is csak a tulajdonosé. A két ellenőrző szkript (`client-portal-verify.sql`) ismeri ezt a
  függvényt.
- **A projekt munkaórái:** a projekt „Actual hours” értéke = kézzel beírt + a projektre naplózott órák (mindig
  a naplóból összegezve, sosem tárolva — javítás vagy törlés után sem csúszik el).

Ellenőrizve (helyben): `tests/portal-hours-db.spec.ts` 4/4; tulajdonosi ellenőrző 56/56 (rögzítés projektre
és „Egyéb”-re, heti táblázat, kolléga sora, érvénytelen óra, a projekt naplózott órái); minden portál-teszt
(267 + 288), kihagyás nélkül.

## 23. Értesítések: e-mail az ügyfeleknek, push + e-mail a tulajdonosnak (16. szakasz, „2. Értesítések”)

**Élesítve 2026-10-05:** a migráció hiba nélkül lefutott, a `VAPID_PRIVATE_KEY` a Netlifyban, utána push a `main`-re.

**Sorrend: 22. → ez a migráció → Netlify-kulcs → deploy.**

1. SQL Editor: `supabase/migrations/20261013000100_notifications.sql` (ismételten is futtatható).
2. Netlify → Site configuration → Environment variables, **Functions** hatókörrel, „Contains secret values”
   bepipálva:
   - `RESEND_API_KEY` — a Resend kulcsa (a `stratosweb.hu` domain a Resendben hitelesítve).
   - `VAPID_PRIVATE_KEY` — a push privát kulcsa (a nyilvános párja a kódban van:
     `portal/src/lib/push.ts` és `netlify/functions/notify-dispatch.mjs`; egy teszt őrzi, hogy egyezzen).
   - Nem kötelező: `NOTIFY_FROM` (alap: `Stratos <portal@stratosweb.hu>`), `NOTIFY_REPLY_TO`
     (alap: `hello@stratosweb.hu`).
3. Deploy (push a `main`-re). A `notify-dispatch` ütemezett függvény percenként fut (csak az éles deployon).

Mit csinál:

- **A tulajdonos kap** (push a regisztrált eszközeire + e-mail): ügyfél fájlt töltött fel; észrevételt írt egy
  demóhoz; új időpontot javasolt vagy visszavonta. Ezeket adatbázis-triggerek teszik a `notification_outbox`
  sorba — egy hibás értesítés soha nem akaszt meg egy feltöltést (a trigger csak figyelmeztet).
- **Az ügyfél kap e-mailt** (magyarul / angolul / németül tegezve, a választott nyelvén): megosztott dokumentum
  vagy mappa, közzétett demó, új / módosult / elmaradt megbeszélés, döntés az időpont-javaslatáról, válasz az
  észrevételére. A projekt oldalán az „E-mail the client” pipa (alapból bekapcsolva) dönti el, megy-e e-mail; a
  megosztás ablakában ugyanígy.
- **Válasz az ügyfél észrevételére:** a projekt oldalán „Answer”; az ügyfél a portálon az észrevétele alatt látja
  („A Stratos válasza”).
- **Címzett a küldés pillanatában dől el:** csak aktív ügyfélfiók, amelynek még él a hozzáférése a projekthez.
  Egy futásban egy embernek egy e-mail és egy push megy, akárhány esemény gyűlt össze. Hibánál öt próbálkozás.
- **Push a telefonra:** Beállítások → Notifications. iPhone-on előbb Safari → Megosztás → „Főképernyőhöz adás”,
  onnan megnyitva a portált lehet bekapcsolni; „Send a test” próbaértesítést küld.
- A naplóba semmi személyes nem kerül (csak darabszám, típus, HTTP-státusz).
- `scripts/secret-scan.mjs`: a migráció a szerver-szerepkört név szerint kapja meg a GRANT-ben — kivételként
  felvéve, kulcs nincs benne.

Ellenőrizve (helyben): `tests/notify.spec.ts` 6/6 (szövegek minden nyelven, egy futás hamis Resenddel, VAPID-
kulcspár); `tests/portal-client-extras-db.spec.ts` értesítési része 6/6; tulajdonosi ellenőrző 58/58; ügyfélportál
22/22; dokumentum 18/18; minden teszt (2190), kihagyott vagy le nem futott nélkül.

## 24. Értesítések az adminoknak is (16b. szakasz)

**Élesítve 2026-10-05:** push a `main`-re, utána a migráció hiba nélkül lefutott. Ugyanekkor a tulajdonos
döntése: az admin (`timar.richard@stratosweb.hu`) **helyettes** lett (`portal_add_delegate`, 20261003000100) —
teljes tulajdonosi jog, így az értesítések linkje nála is a projektoldalra visz.

**Sorrend: 23. → ez a migráció, majd deploy.**

1. SQL Editor: `supabase/migrations/20261013000200_notify_staff.sql` (ismételten is futtatható).
2. Deploy (push a `main`-re).

Mit csinál (a tulajdonos döntése, 2026-10-05):

- **Az admin is megkapja ugyanazokat az értesítéseket**, mint a tulajdonos (push + e-mail): ügyfél-feltöltés,
  észrevétel, időpont-javaslat. A tulajdonosi „owner” üzenet címzettje: a tulajdonos és minden super_admin / admin.
- **Az admin is látja a Beállításokat:** saját fiók, nyelv, értesítések — push bekapcsolása az eszközén,
  „Send a test” (csak magának), és **„E-mailben is”** kapcsoló (`notification_prefs`, alapból bekapcsolva).
- Az értesítés linkje a projektoldalra mutat, amit a tulajdonos és a helyettesei nyithatnak meg; egy nem
  helyettes admin a kezdőlapra kerül.

Ellenőrizve (helyben): `tests/notify.spec.ts` 7/7; `portal-client-extras-db` értesítési része (címzettek,
e-mail-kapcsoló, saját próba) zöld; tulajdonosi ellenőrző 59/59 (admin: Beállítások, értesítési panel,
e-mail-kapcsoló). Teljes futás: 2194 zöld, 2 hiba a `homepage-chrome` „navigating away and back” tesztben
mobilon — ismétlésre 3/4-ben átmegy, a portált nem érinti.

## 25. Ügyfélélmény: jóváhagyás, „Rád várunk”, üzenőfal, elégedettség (17. szakasz, „3. Ügyfélélmény”)

**Élesítve 2026-10-05:** a migráció hiba nélkül lefutott, utána push a `main`-re.

**Sorrend: 24. → ez a migráció → deploy.**

1. SQL Editor: `supabase/migrations/20261014000100_client_experience.sql` (ismételten is futtatható).
2. Deploy (push a `main`-re).
3. Beállítások → **Google review link**: a Google Cégprofilból („Értékelések kérése”) másolt link. Amíg
   üres, az ügyfél köszönetet kap, de értékelést nem kérünk.

Mit csinál (a tulajdonos döntései, 2026-10-05):

- **Jóváhagyás (csak demó):** a projektoldalon egy közzétett demónál „Ask for approval”. Az ügyfél
  „Jóváhagyom” vagy „Módosítást kérek” (ilyenkor kötelező leírni, mit). Egy kérésre egy válasz; a következő
  körhöz „Ask again”. A választ csak az ügyfél írhatja.
- **„Rád várunk”** az ügyfélportál tetején: a nyitott jóváhagyások, a kérdőív és a te kéréseid („Waiting on the
  client” a projektoldalon: cím, részletek, határidő). Az ügyfél „Kész”-t nyom (megjegyzéssel); te
  visszanyithatod vagy visszavonhatod.
- **Üzenőfal:** projektenként egy szál, csatolmány nélkül; a projekt minden ügyfele látja. A válaszod olvasottnak
  jelöli az ügyfél üzeneteit. Ügyfélenként legfeljebb 60 üzenet naponta.
- **Elégedettség:** „Mennyire ajánlanál minket?” 1–10 + megjegyzés. Automatikusan megy a projekt lezárásakor
  (egyszer, ha van aktív ügyfélfiókja), havi szerződésnél negyedévente (a negyedév utolsó hónapjában, ha a
  szerződés az egész negyedévben futott — a percenkénti küldő indítja), vagy kézzel („Ask now”). Az ügyfél
  mindig e-mailt kap. 7-től felajánljuk a Google-értékelést; látod, ha megnyitotta.
- **Értesítések:** az ügyfél üzenete, jóváhagyása / módosítási kérése, „Kész” jelzése és értékelése push +
  e-mail a tulajdonosnak és az adminoknak; a kérés, az üzenet és a jóváhagyási kérés e-mail az ügyfélnek, ha
  be van pipálva az „E-mail the client”.
- **Ügyfél-beérkező** (Projects): az olvasatlan üzenetek, a jóváhagyási válaszok, a kész kérések és az
  értékelések is, amíg „Mark read” / „Mark seen” nincs rajtuk.
- Az új ügyfélfüggvények egyetlen projekt- vagy dokumentumtáblát sem neveznek meg (mint a 4. szakaszban): a
  `client_has_project()` és a `client_account_id()` dönt.

Ellenőrizve (helyben): `tests/portal-client-experience-db.spec.ts` 18/18 (jogok, egyszeri válasz, határidő,
üzenetkorlát, lezáráskori és negyedéves kérdőív, Google-link 7-től); `tests/notify.spec.ts`; tulajdonosi
ellenőrző 61/61; ügyfélportál 24/24; dokumentum 18/18; teljes futás 2269 zöld, 1 hiba az ingadozó
`homepage-chrome` mobil tesztben (külön feladat).

## 26. Automatizálások (18. szakasz, „5. CRM” első része)

**Élesítve 2026-10-05:** a migráció hiba nélkül lefutott, utána push a `main`-re.

**Sorrend: 25. → ez a migráció → deploy.**

1. SQL Editor: `supabase/migrations/20261015000100_automations.sql` (ismételten is futtatható).
2. Deploy (push a `main`-re). A percenkénti küldő (`notify-dispatch`) futtatja a szabályokat.

Mit csinál (a tulajdonos döntései, 2026-10-05):

- Négy szabály, mindegyik **figyelmeztetést** hoz létre a **Ma** nézet tetején („Needs attention”, linkkel),
  és push + e-mail megy róla a tulajdonosnak és az adminoknak:
  1. **Új lead válasz nélkül:** `new` állapotú, N órája jött (alap: 24), nincs rögzített kapcsolatfelvétel
     (`interactions`). Csak az utolsó 14 nap leadjei.
  2. **Elakadt ajánlat:** nyitott lehetőség, N napja nem mozdult (alap: 14; a mozgás = módosítás vagy rögzített
     kapcsolatfelvétel), és nincs előttünk következő lépés.
  3. **Megnyert üzlet projekt nélkül:** az elmúlt 30 nap nyert lehetőségei, amíg nem készül belőlük projekt.
  4. **Lejárt fizetés** (a fizetési ütemterv saját számításából) és **közelgő projekt-határidő** (N napon
     belül, alap: 3).
- **Esetenként egyszer** szól (mindegyik figyelmeztetésnek kulcsa van); **magától lezárul**, ha az ok megszűnt
  (válaszoltál, mozdult az ajánlat, kifizették, lezártad a projektet); kézzel is „Done”.
- Ki látja: a lead- és ajánlat-figyelmeztetéseket az adminok; a projektre vonatkozókat a tulajdonos és a
  helyettesei.
- Beállítások → **Automations**: szabályonként ki/be és a határértékek (tulajdonos).

Ellenőrizve (helyben): `tests/portal-automations-db.spec.ts` 6/6 (egyszeri riasztás, önlezárás, küszöb, újbóli
elakadás, láthatóság, jogok); `tests/notify.spec.ts` 10/10; tulajdonosi ellenőrző 62/62; teljes futás 2295 zöld,
1 hiba a már ismert ingadozó `homepage-chrome` mobil tesztben.

## 27. Bevételi riport (19. szakasz, „5. CRM” második része)

**Élesítve 2026-10-05:** a migráció hiba nélkül lefutott, utána push a `main`-re.

**Sorrend: 26. → ez a migráció → deploy.**

1. SQL Editor: `supabase/migrations/20261016000100_revenue_report.sql` (ismételten is futtatható).
2. Deploy (push a `main`-re).

Mit csinál (a tulajdonos döntése, 2026-10-05) — új menüpont: **Revenue** (Bevétel), csak a tulajdonosnak és a
helyetteseinek, mert a befizetésekből készül:

- **Fő számok:** idén eddig (tavaly ugyanekkorához képest), utolsó 12 hónap, ez a hónap, havi díjak most.
- **Befolyt bevétel havonta** és **havi díjak (MRR)** az utolsó 12 hónapra. A „befolyt” a fizetési ütemtervben
  rögzített befizetés — nem a kiállított számla.
- **Honnan jött:** ügyfelenként vagy szolgáltatásonként, idén / 12 hónap / 3 év.
- **Előrejelzés** a következő 6 hónapra: ki nem fizetett részletek esedékesség szerint (a lejártak ebben a
  hónapban), + az ütemtervben még nem szereplő havi díjak = **várható**; mellette külön a nyitott ajánlatok
  értéke × valószínűsége a várható lezárás hónapjában (dátum nélküli ajánlat nem szerepel).
- Minden összeg pénznemenként; a különböző pénznemeket sosem adjuk össze (váltó, ha több van).
- `portal_revenue_report()` SECURITY INVOKER: a hívó saját jogai döntenek; nem tulajdonosnak a pénzügyi részek
  üresek.

Ellenőrizve (helyben): `tests/portal-revenue-report-db.spec.ts` 4/4 (kézzel kiszámolt számokkal, rögzített
napon); tulajdonosi ellenőrző 63/63 (menü, fő számok, bontás, előrejelzés, EUR külön, nem tulajdonosnak nincs
menüpont); teljes futás 2307 zöld, 2 hiba a már ismert ingadozó `homepage-chrome` mobil tesztben.

## 28. Import és export (20. szakasz, „5. CRM” harmadik része)

**Élesítve 2026-10-05:** nincs migráció; push a `main`-re.

Új menüpont a Records csoportban: **Import & export** (admin és tulajdonos).

- **Export (CSV):** leadek, ügyfelek a fő kapcsolattartóval, ajánlatok, munkaórák; a tulajdonosnak projektek és
  befizetések is. A letöltött fájl pontosvesszős, UTF-8 BOM-mal: magyar Excelben dupla kattintással, ékezetekkel
  nyílik. Mindenki csak azt exportálhatja, amit a portálon is lát (RLS). A `=`, `+`, `-`, `@` kezdetű szöveges
  cellák elé aposztróf kerül, hogy egy űrlapba írt érték ne fusson képletként.
- **Import (CSV, Excelből „CSV UTF-8”):** ügyfelek (név kötelező; weboldal, szolgáltatás, kapcsolattartó,
  beosztás, e-mail, telefon) vagy leadek (e-mail kötelező; név, telefon, cég, weboldal, szolgáltatás, üzenet,
  dátum, állapot). A fejlécet magyarul és angolul is felismeri; mintafájl letölthető.
  - Előbb **terv**: hány sor kerül be, melyik marad ki és miért (már létező ügyfélnév / lead e-mail, hiányzó
    kötelező mező, hibás e-mail vagy dátum), mely oszlopokat ismerte fel és melyeket hagy figyelmen kívül —
    írás csak a megerősítés után. Semmit nem ír felül.
  - Állapot oszlop nélkül a leadek „contacted” állapotba kerülnek, így régi leadekre nem jön válasz-emlékeztető.
  - Legfeljebb 5000 sor és 5 MB egyszerre.

Ellenőrizve (helyben): `tests/csv.spec.ts` 3/3 (írás, visszaolvasás, vesszős/tabos fájl, fejlécek, képletvédelem);
tulajdonosi ellenőrző 64/64 (CSV letöltés BOM-mal és fejléccel, import terve, kihagyások, írás csak megerősítés
után, kapcsolattartó); teljes futás 2309 zöld.

## 29. Google: Gmail-előzmények és naptár-szinkron (21. szakasz, „5. CRM” + „6. Google”)

**Élesítve 2026-10-06:** Google Cloud kliens (Internal) és a három Netlify-kulcs beállítva, a migráció hiba
nélkül lefutott, utána push a `main`-re.

**Sorrend: 28. → Google Cloud beállítás → Netlify-kulcsok → ez a migráció → deploy → összekötés.**

1. Google Cloud (a `lukacs.artur@stratosweb.hu` Workspace-fiókkal), projekt „Stratos Portál”:
   - Gmail API és Google Calendar API bekapcsolva;
   - Google Auth Platform: Branding „Stratos Portál”, **Audience: Internal** (nem kell Google-jóváhagyás);
   - Client: Web application, Authorized redirect URI: `https://stratosweb.hu/api/google-oauth`.
2. Netlify (Functions, secret): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_TOKEN_KEY` (32 bájt
   base64; a tokenek titkosítókulcsa — elvesztése = mindenkinek újra össze kell kötnie).
3. SQL Editor: `supabase/migrations/20261017000100_google.sql` (ismételten is futtatható).
4. Deploy, majd mindenki: Beállítások → **Google → Connect Google**.

Mit csinál (a tulajdonos döntései, 2026-10-05):

- **Mindenki a saját fiókját köti be** (`/api/google-oauth`): a hozzáférés (refresh token) AES-256-GCM-mel
  titkosítva kerül az adatbázisba, és az API-n keresztül senki — a saját gazdája sem — olvashatja; a `state`
  aláírt és 10 percig érvényes. Leválasztáskor a Google-nál is visszavonjuk.
- **Gmail** (`google-sync`, 10 percenként fiókonként; először 90 napra visszamenőleg): csak azok a levelek
  kerülnek be, amelyek feladója/címzettje egy lead, ügyfél-kapcsolattartó vagy ajánlat-kapcsolattartó címe —
  tárgy, címek, dátum, a Gmail rövid kivonata (`format=metadata`, a levél törzse és a mellékletek nem).
  Megjelennek a lead, az ügyfél és az ajánlat oldalán („E-mails”); a Gmail-link csak a postafiók gazdájának.
  Egy `new` leadnek küldött levél bekerül a lead tevékenységnaplójába is (ezzel a „nincs válasz”
  automatizálás is lezárul).
- **Naptár** (`google-sync`, 2 percenként): a portálban felvett / módosított / lemondott megbeszélés a
  létrehozója Google Naptárába kerül (ha ő nincs összekötve: a tulajdonoséba). A megbeszélés ablakában:
  „Put it in my Google Calendar” (alap: be), „Make a Google Meet link” (ha nincs link; a link visszaíródik a
  megbeszélésbe, az ügyfél is látja), „Invite the project's clients” (a Google küld meghívót). Hiba esetén a
  megbeszélésnél „Calendar sync failed” jelzés.

Ellenőrizve (helyben): `tests/portal-google-db.spec.ts` 5/5 (token olvashatatlan, címlista, egyszeri tárolás,
naplózás és automatizálás-lezárás, láthatóság, naptár-jelölés és visszaírás); `tests/google.spec.ts` 7/7
(titkosítás, aláírt state, címek, esemény, naptár- és Gmail-szinkron hamis Google-lel, OAuth-végpont);
tulajdonosi ellenőrző 65/65; teljes futás 2341 zöld + 1 ingadozó weboldal-teszt (újrafuttatva zöld).

## 30. Időpontfoglalás: Google Meet a tulajdonos naptárából (22. szakasz)

**Sorrend: 29. (Google) élesítve → ez a migráció → deploy → a tulajdonos még egyszer összeköti a Google-t.**

1. Ha a 29. pont még nincs élesítve: annak 1–3. lépése (Google Cloud, Netlify-kulcsok, migráció). A foglaláshoz
   **új kulcs nem kell**: ugyanaz a `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_TOKEN_KEY`.
2. SQL Editor: `supabase/migrations/20261018000100_booking.sql` (ismételten is futtatható).
3. Deploy — csak a tulajdonos engedélyével.
4. A portál tulajdonosa: Beállítások → **Google → Connect Google** még egyszer. A Google ekkor egy új engedélyt is
   kér (*a naptárak foglaltságának megtekintése* — csak az, hogy mikor foglalt, az események tartalma nem). Amíg ez
   nincs meg, a portál Foglalások oldala „Not taking bookings” jelzést mutat, a nyilvános oldal pedig azt, hogy az
   online foglalás most nem elérhető, a kapcsolati oldal linkjével. A Beállítások Google-paneljén piros sor jelzi.
   Ha a Google az összekötéskor hibát ír a jogosultságra: Google Cloud → Google Auth Platform → **Data access** →
   add hozzá a `https://www.googleapis.com/auth/calendar.freebusy` jogosultságot, majd kösd össze újra. A Google
   engedélyképernyőjén ne vedd ki a pipát a foglaltság megtekintése elől — enélkül a foglalás nem indul el.
5. Próba: Foglalások → „Live — Taking bookings: N free times”; a nyilvános oldalon (`/idopontfoglalas`) foglalás
   egy másik saját e-mail-címmel → a meghívó Meet-linkkel megérkezik, az esemény a naptárban van, a lead a
   Leadek között; a meghívóban lévő linkkel lemondás → a Google erről is levelet küld.

Mit csinál (a tulajdonos döntései, 2026-10-18 — a Foglalások → Rules panelen bármikor módosíthatók):

- **Ki foglalhat:** a nyilvános oldalon bárki (díjmentes konzultáció, 30 perc; leadként kerül be, ha az e-mail-címhez
  már van élő lead, ahhoz kapcsolódik), a portálban a bejelentkezett ügyfelek az **Időpont** fülön (30 vagy 60 perc,
  a saját projektjükhöz; a nevük és címük a fiókjukból jön).
- **Mikor:** hétfő–péntek 9:00–17:00 budapesti idő szerint, félóránként; két foglalás között 15 perc szünet;
  legalább 24 órával előre, legfeljebb 30 napra előre; naponta legfeljebb 4 foglalás. Egy e-mail-címnek egyszerre
  egy nyitott nyilvános foglalása lehet, egy ügyfélnek legfeljebb három.
- **Foglalt idő:** csak a tulajdonos fő Google-naptára számít (`calendar_ids = {primary}`). A szabad időpontokat
  a `/api/booking` minden megnyitáskor élőben kérdezi a Google-tól (freeBusy), foglalás előtt pedig még egyszer.
  Ha a Google nem érhető el, nincs szabad időpont és nincs foglalás — sosem „szabad” a bizonytalan.
- **Dupla foglalás nincs:** az adatbázis egy kizárási szabállyal (`bookings_no_overlap`) eleve nem enged két
  átfedő megerősített foglalást (a 15 perces szünettel együtt), akkor sem, ha ketten egyszerre kattintanak.
- **A foglalás:** azonnal esemény a tulajdonos naptárában, Google Meet-linkkel, a vendég meghívva,
  `sendUpdates=all` — a meghívót a **Google** küldi a vendégnek, a portál nem küld levelet. Ha a Google elutasítja,
  a foglalás nem jön létre (`failed`), az időpont azonnal újra szabad.
- **Lemondás, áthelyezés:** legkésőbb 12 órával előtte. A nyilvános vendég a meghívóban és a visszaigazoló képernyőn
  lévő privát linkkel (`/idopontfoglalas#m=…` — a token a címsor `#` utáni részében van, így szerverre, naplóba nem
  kerül; az adatbázisban csak a lenyomata), az ügyfél a portálban. A tulajdonos és az adminok a Foglalások oldalon
  bármikor lemondhatják. A Google minden változásról értesíti a vendéget.
- **Értesítés:** új foglalás, áthelyezés és a vendég/ügyfél lemondása a meglévő értesítési rendszeren megy a
  tulajdonosnak és az adminoknak (push + e-mail, „Új időpontfoglalás: …”), a Foglalások oldalra mutató linkkel.

Tudnivalók a tulajdonosnak:

- **Egész napos esemény** a Google Naptárban alapból „Szabad” — nem foglal. Ha egy egész napot le akarsz zárni,
  állítsd „Elfoglalt”-ra, vagy használj „Házon kívül” eseményt.
- **A foglalást a portálban módosítsd**, ne a Google Naptárban húzd át: a portál és a szabad időpontok a portálbeli
  foglalást követik. (Ha a Google-ben törlöd, az időpont a portálban foglalt marad, amíg ott le nem mondod.)
- A Google-összekötéskor most minden admin consent-képernyője kéri a foglaltsági engedélyt is (a jogosultságlista
  közös); a foglalóoldal csak a portál tulajdonosáét használja.
- A régi Wix-címek (`/book-online`, `/service-page/ingyenes-konzultáció`) mostantól a foglalóoldalra visznek
  (`netlify.toml`). Vissza a kapcsolati oldalra: a három szabály `to` sora legyen `"/ugyfelszolgalat"`.
- Kikapcsolás: Foglalások → Rules → „Online booking is on” ki. Teljes elzárás:
  `revoke execute on function client_booking_identity(), client_portal_bookings() from authenticated;`
  és a `booking` Netlify-függvény törlése a következő deployból.

### Adatkezelési tájékoztató — kiegészítés (a tulajdonos jóváhagyta 2026-10-18; a webhelyen HU/EN/DE)

A jogi szöveg a tulajdonosé; az alábbi tervezetet jóváhagyta, és így került a tájékoztatóba (`_build/pages/adatkezelesi-tajekoztato.html`, fordítás: `_build/i18n/adatkezelesi-tajekoztato.json`). A célok közé bekerült az „online konzultáció időpontjának foglalása (Google Meet)” sor is; a Google Workspace külön adatfeldolgozó-sor, így a Google Analytics sorának „hozzájárulás nélkül semmi nem kerül a Google-höz” mondata továbbra is csak a mérésre vonatkozik.

- *Kezelt személyes adatok köre* alá új alcím, **„Időpontfoglalás esetén”**: név; e-mail cím; cégnév és telefonszám
  (ha megadásra kerül); a beszélgetés témája; a foglalt időpont; a foglalás kezelésére szolgáló, csak a foglalónál
  lévő link visszafejthetetlen lenyomata. Ügyfélportálon foglalt időpontnál: a fiók neve és e-mail címe, a projekt.
- *Adatfeldolgozók*, a Google Ireland Ltd. bejegyzés kiegészítése: „Google Workspace (Google Naptár, Google Meet):
  a lefoglalt időpont a Stratos naptárában jön létre, a meghívót és a Google Meet-linket a Google küldi a foglaló
  által megadott e-mail-címre. A szabad időpontok megállapításához a Stratos naptárának csak a foglaltsága kerül
  lekérdezésre.”
- *Az adatkezelés időtartama*: „időpontfoglalási adatok: legfeljebb 5 év” (a kapcsolatfelvételi adatokkal azonos) —
  vagy amit a tulajdonos dönt.
- Időtartam: 5 év (jóváhagyva). Jogalapot a tájékoztató egyik célnál sem nevez meg — ez a meglévő, jogászra váró
  hiány (a fájlban `REQUIRES LEGAL REVIEW`), a foglalás nem változtatott rajta.

Ellenőrizve (helyben, 2026-10-18, valódi Google-fiók nélkül): `tests/portal-booking-db.spec.ts` 11/11 (szabályok,
átfedés-tiltás az adatbázisban, lead és értesítés, áthelyezés, lemondás, ügyfél, jogosultságok, ismételt futtatás);
`tests/booking.spec.ts` 18/18 (időzóna és óraátállítás, rács, szabad idő, űrlap, esemény, freeBusy, PostgREST-hívások,
és a `/api/booking` végig PGlite-on hamis Google-lel: foglalás Meet-kéréssel és `sendUpdates=all`, ütközés, Google
elutasítás, robotszűrés, privát link, áthelyezés, lemondás, ügyfél, kikapcsolás); `tests/booking-page.spec.ts` 8×4
nézetméret (nyilvános oldal HU/EN/DE); ügyfélportál-ellenőrző 26/26 (+2: Időpont fül), tulajdonosi ellenőrző 66/66
(+1: Foglalások, szabályok, Google-újraösszekötés); teljes futás 2150 zöld — a közben talált szerkezeti tesztek
(menüsorrend, definer-függvények listája, tárolt értékből épített link) javítva, újrafuttatva 212/212; a két
`asset-packaging` teszt csak addig piros, amíg az új fájlok nincsenek commitolva. A
`scripts/pg-integration-check.mjs` (valódi Postgres 17) nem futott: ezen a gépen nincs helyi Postgres.

**Élesítve 2026-10-18:** a `redesign/quiet-authority` ág (az új dizájnnal együtt) beolvadt a `main`-be (`26f9148`),
push után a Netlify kitette; a tulajdonos lefuttatta a migrációt és újra összekötötte a Google-t. Utána az élő
`/api/booking` 316 szabad időpontot adott (első: hétfő 9:00 budapesti idő szerint). Az adatkezelési tájékoztató
kiegészítése a jóváhagyás után került be.

## 31. E-mail-címek: media-stratos.com → stratosweb.hu

A céges levelezés (Google Workspace) átállt a `stratosweb.hu`-ra; a régi címek aliasként élnek, tehát a
régi címre küldött levél megérkezik. Az új címrend (a tulajdonos döntése, 2026-10-18):

| Cím | Hol |
|---|---|
| `hello@stratosweb.hu` | a cég elérhetősége mindenhol: lábléc, JSON-LD, Kapcsolat, CTA-k, Impresszum, Adatkezelési tájékoztató, űrlap-hibaüzenetek, súgó, a portál leveleinek Reply-To címe, és ide jön az új lead „csengője”. Csak fogadó cím: innen nem megy levél. |
| `lukacs.artur@stratosweb.hu` | a weboldalon csak a Rólunk oldalon, a fotó alatt; a portálban a tulajdonos belépése (volt: `lukacs.artur@media-stratos.com`) |
| `timar.richard@stratosweb.hu` | Rólunk, a fotó alatt; az admin/helyettes portál-belépése (volt: `info@media-stratos.com`) |
| `portal@stratosweb.hu` | a portál leveleinek feladója (Resend, hitelesített domain); Workspace-alias a hello@ mellé |

A munkatársi értesítések (foglalás, ügyfél-feltöltés, automatikus figyelmeztetések) továbbra is személyenként,
a belépési címre mennek: a tulajdonoséi a `lukacs.artur@`-ra, Richárdéi a `timar.richard@`-ra. A Google-összekötés a
saját Google-fiókkal történik; annak címét a Google adja, a portál csak eltárolja.

**Sorrend: deploy → mentés → előellenőrzés → migráció → átállítás → ellenőrzés → Google → Netlify → Supabase SMTP.**

1. Deploy (push a `main`-re) — csak a tulajdonos engedélyével.
2. Mentés, mint a 12. pontban.
3. SQL Editor: `supabase/checks/email-domain-preflight.sql` (csak olvas). Az első négy sor `ok`; az `ok`
   nélküli sorok azt mutatják, hol van még „media-stratos” az adatokban.
4. SQL Editor: `supabase/migrations/20261018000200_contact_email.sql` (ismételten is futtatható) — a
   súgócikkek szövegében és fordításaiban a régi címet a `hello@`-ra cseréli.
5. SQL Editor: `supabase/checks/email-domain-switch.sql` — **egyszer**. A két munkatársi fiók címe az
   `auth.users`-ben, az `auth.identities`-ben és a `profiles`-ben egyszerre változik (a `profiles.email`-t
   semmi nem tartja szinkronban, ezért kell külön). Jelszó, szerepkör, tulajdonosi kijelölés és helyettesség
   (mind user id szerint) változatlan; a nyitott munkamenetek élnek.
6. SQL Editor: `supabase/checks/email-domain-verify.sql` — minden sor `ok`. Visszaállítás:
   `supabase/checks/email-domain-rollback.sql`.
7. Portál → Beállítások → **Google → Connect Google** (a tulajdonos, és Richárd, ha össze van kötve). A
   Gmail-szinkron a tárolt `google_email` alapján dönti el, melyik levél kimenő.
8. Netlify → Environment variables (Functions): `LEAD_NOTIFY_TRANSPORT=email` és
   `LEAD_NOTIFY_EMAIL_TO=hello@stratosweb.hu` (a csengő; a `RESEND_API_KEY` már megvan). Ha van
   `NOTIFY_REPLY_TO` vagy `NOTIFY_FROM` régi címmel: az új értékre.
9. Supabase → Authentication → Emails → SMTP Settings: egyéni SMTP a Resenden át, feladó `portal@stratosweb.hu`
   (a domain ott már hitelesítve, új DNS-rekord nem kell). A beépített SMTP csak a projekt csapatának címeire
   kézbesít, az új címekre küldött jelszó-visszaállító levél enélkül elveszhet.

**Az új lead csengője** (`netlify/functions/lead-notify.mjs`, `email` szállítás): minden mentett beküldés után
egy levél a `LEAD_NOTIFY_EMAIL_TO` címre — űrlaptípus, nyelv, oldal, időpont, azonosító és link a Portálba.
Személyes adat nincs benne (se név, se e-mail, se üzenet), ugyanúgy, mint a webhook-változatban; a leadet a
Portálban kell megnyitni. Hiba esetén a látogató válasza nem akad meg (2 mp-es plafon), és csak a hiba ténye
naplózódik.

Mit nem csinál: az ügyfelek, kapcsolattartók, jegyzetek szövegében lévő régi címet nem írja át (a 3. lépés
listázza, kézi döntés); a szinkronizált levelek és a naplók története marad.

Ellenőrizve (helyben, 2026-10-18): SQL-ek PGlite-on minden migrációval (előellenőrzés `ok`; a migráció a seedelt
és egy saját cikkben is cserél, másodszorra semmit; átállítás után az ellenőrzés 7/7 `ok`, tulajdonos és helyettes
megmaradt; ismételt futtatás változtatás nélkül megáll; visszaállítás, majd újbóli átállítás `ok`);
`tests/lead-notify.spec.ts` 22/22 (az `email` szállítás is); node-projekt 530 zöld; böngészős űrlap-, nyilvános
oldal- és nyitóoldal-tesztek 60/60 (desktop) és 28/28 (mobil) a saját `dist`-en; a generált oldalak a cím és a Rólunk
blokk kivételével változatlanok.

## 32. Hírlevél: dupla megerősítés, üdvözlő levél, kampányok a portálból (23. szakasz)

**Sorrend: a tájékoztató jóváhagyása → migráció → deploy → Resend-webhook → próba.** (A 31. szakasz a `main`-en van.)

1. Nézd át és hagyd jóvá az adatkezelési tájékoztató módosítását (lent). A webhelyen már benne van HU/EN/DE.
2. SQL Editor: `supabase/migrations/20261019000100_newsletter.sql`. Ismételten is futtatható. A régi
   hírlevél-leadeket csak az első futáskor veszi át, **függőben lévő** címként: senki nem kap tőle levelet.
3. Netlify → Environment variables (Functions): a `RESEND_API_KEY` már megvan, a portál értesítései is ezt
   használják. Nem kötelező: `NEWSLETTER_FROM` (alapból `Stratos <hirlevel@stratosweb.hu>`; a stratosweb.hu a
   Resendben hitelesítve van, új DNS nem kell) és `NEWSLETTER_REPLY_TO` (alapból `hello@stratosweb.hu`).
4. Deploy — csak a tulajdonos engedélyével. Két új függvény indul: `newsletter` (`/api/newsletter/*`) és
   `newsletter-dispatch` (percenként).
5. Resend → Webhooks → Add endpoint: `https://stratosweb.hu/api/newsletter/webhook`, események: `email.bounced`
   és `email.complained`. A kapott „Signing secret”-et (`whsec_…`) tedd be Netlify-ba `RESEND_WEBHOOK_SECRET`
   néven, majd deployolj újra. Enélkül a visszapattanó címek a listán maradnak (a végpont 503-at ad).
6. Próba: a láblécben iratkozz fel egy saját címmel → megerősítő levél → „Igen, feliratkozom” → üdvözlő levél →
   Portál → **Newsletter**: a cím „Confirmed”. Ezután: új levél → Preview → Send a test to me → küldés.
7. A régi kérések: Portál → Newsletter → **Ask them to confirm**. Mindenki egy megerősítő levelet kap. Aki 30 napon
   belül nem erősít meg, automatikusan törlődik. Amíg nem nyomod meg, nekik semmi nem megy ki.

Mit csinál (a tulajdonos döntése, 2026-10-18: dupla megerősítés + üdvözlő, saját rendszer a portálon):

- **Feliratkozás:** a lábléc vagy a blog űrlapja, illetve a kapcsolati űrlap pipája (most már: „Feliratkozom a
  Stratos hírlevelére is…”). Ebből függőben lévő cím lesz és megerősítő levél. A levélben lévő link egy **gombos
  oldalt** nyit, és csak a gomb erősít meg, mert a levélszkennerek megnyitják a linkeket, de gombot nem nyomnak.
  Egy címre 2 percen belül nem megy újabb megerősítő, naponta legfeljebb 3. A link 30 napig érvényes. A meg nem
  erősített cím az utolsó megerősítő után 30 nappal törlődik. Az űrlap válasza minden esetben ugyanaz, így nem árulja
  el, ki van már a listán.
- **Üdvözlő levél** a megerősítés után: három blogcikk a feliratkozó nyelvén, és leiratkozás.
- **Minden levél** (üdvözlő és hírlevél) lábléce megnevezi a feladót (Lukács Artúr e.v., 9151 Abda, Arany János
  utca 13.), és tartalmaz leiratkozó linket. A levélben `List-Unsubscribe` és `List-Unsubscribe-Post` fejléc is van,
  így a Gmail és a Yahoo saját „Leiratkozás” gombja egy kattintással működik. A leiratkozó oldalon van „Mégis
  maradok” gomb.
- **Kampány:** Portál → Newsletter. Megadod a tárgyat, az előnézeti sort, a közönséget (mind / magyar / angol /
  német) és a szöveget egyszerű jelöléssel (`## cím`, `- lista`, `**félkövér**`, `[szöveg](https://…)`). Van
  előnézet, próbalevél magadnak, és küldés. A küldést a `newsletter-dispatch` végzi percenként, 100-as kötegekben,
  legfeljebb 500 levelet percenként. A „Stop sending” megállítja.
- **Visszapattanás vagy spamjelzés:** a webhook leveszi a címet a listáról.
- **Jogosultság:** a lista és a kampányok az adminoké (`is_admin()`). A tokeneket és az IP-lenyomatot a portál sem
  olvashatja.

Tudnivalók a tulajdonosnak:

- **Resend-csomag:** az ingyenes csomag napi 100 és havi 3000 levelet enged. Nagyobb kampány a napi keretnél
  megáll (429). A dispatcher percenként újrapróbálja, a kiküldés másnap folytatódik. Gyorsabb kiküldéshez Pro
  csomag kell.
- A hírlevél-feliratkozások **továbbra is leadként is** bekerülnek („Newsletter subscriber”). Ha ez zavaró, külön
  döntés.
- A hírlevél most a fő domainről megy. A Resend azt javasolja, hogy a marketing külön aldomainről menjen (pl.
  `news.stratosweb.hu`), hogy egy rossz kampány ne rontsa a portál leveleinek kézbesíthetőségét. Nagyobb listánál
  érdemes átállni (ehhez új DNS kell).
- Leállítás: a migráció ACCESS blokkjában a szerverkulcs szerepének adott `newsletter_subscribe` végrehajtási jogot
  vond vissza (`revoke execute on function newsletter_subscribe(text, text, text, text, text) from …`) — ezután a
  feliratkozás csak leadként tárolódik, levél nem megy ki.

### Adatkezelési tájékoztató — TERVEZET (a tulajdonos jóváhagyására vár; a webhelyen HU/EN/DE)

- *Célok:* „hírlevél-kérések fogadása és nyilvántartása” → „hírlevél küldése azoknak, akik feliratkoztak és ezt
  e-mailben megerősítették”.
- *Hírlevél-feliratkozás esetén:* e-mail cím és nyelv; a feliratkozás módja, oldala és időpontja; a megerősítés,
  illetve a leiratkozás időpontja és módja; az IP-cím sózott lenyomata; melyik hírlevél ment ki és mikor. Mellette
  a kétlépcsős folyamat, a 30 napos törlés, a 2026-10-18 előtti kérések kezelése (legfeljebb egy megerősítő levél),
  és a leiratkozás.
- *Időtartam:* „a leiratkozásig; utána a címet csak azért őrizzük meg, hogy ne küldjünk rá újra hírlevelet —
  kérésre ezt is töröljük. Meg nem erősített feliratkozás: legfeljebb 30 nap.”
- *Adatfeldolgozók:* a Resend sora (Plus Five Five, Inc., a 31. pontban került be) kiegészül: a weboldal leveleit
  is kézbesíti (hírlevél, a feliratkozás megerősítése), és az adattovábbítás az EU általános szerződési feltételei
  (SCC) és az EU–USA adatvédelmi keretrendszer alapján történik, a Resend DPA-ja szerint (resend.com/legal/dpa,
  2026-10-18).
- A jogalap továbbra sincs megnevezve. Ez a meglévő, jogászra váró hiány (`REQUIRES LEGAL REVIEW`). A hírlevélnél ez
  a hozzájárulás lenne (GDPR 6. cikk (1) a), Grt. 6. §).

Ellenőrizve (helyben, 2026-10-18, valódi Supabase és Resend nélkül):
- `tests/newsletter-db.spec.ts` 20/20, PGlite-on: régi kérések átvétele, dupla megerősítés és korlátai, újrapróbálás,
  lejárat, 30 napos törlés, leiratkozás és visszairatkozás, visszapattanás, kampánysor, 429, leállítás,
  jogosultságok.
- `tests/newsletter.spec.ts` 18/18: sablonok mindhárom nyelven, jelölés és HTML-escape, oldalak, webhook-aláírás.
  Végig PGlite-on hamis Resenddel: `/api/lead` → megerősítő → gomb → üdvözlő → leiratkozás → vissza → egykattintásos
  leiratkozás → visszapattanás → kampány a dispatcherrel → 429 → újrapróbált megerősítő → portál előnézet és teszt.
- `tests/lead-forms.spec.ts` (új hírlevélszöveg HU/EN/DE).
- A node-os tesztek: 560 zöld. A `gate-independence` a titokkereső kivétellistájának bővítése után zöld.
- `tests/portal-control-room.spec.ts` + `tests/portal-revenue.spec.ts` 113/113.
- Portál: típusellenőrzés, build és i18n-ellenőrzés hibátlan (0 hiányzó fordítás).
- Az oldalak és a levelek böngészőben, asztali és telefonos méretben ellenőrizve.

## 33. Automatikus levelek: visszaigazolás, hívás előtti emlékeztető, üdvözlő sorozat, új cikkek (24. szakasz)

**Sorrend: 32. (hírlevél) → ez a migráció → deploy → az üdvözlő sorozat átnézése és bekapcsolása.** Új kulcs nem kell.

1. SQL Editor: `supabase/migrations/20261019000200_email_automations.sql` (a hírlevél-migráció után; ismételten is
   futtatható).
2. Deploy. Új függvényfájl nincs: a visszaigazolást a `/api/lead` küldi, a többit a percenkénti `newsletter-dispatch`.
   Mostantól a build minden futáskor elkészíti az `assets/data/newsletter-feed.json` fájlt (a cikkek és az
   esettanulmányok listája).
3. Portál → Newsletter → **Welcome series**: a 3 előre megírt levél (HU/EN/DE) **ki van kapcsolva**. Olvasd át,
   javítsd, ahol kell, és lépésenként kapcsold be.
4. Próba: küldd el a kapcsolati űrlapot egy saját címmel. Pár másodpercen belül meg kell érkeznie a „Megkaptuk az
   üzeneted” levélnek.

Mit csinál (a tulajdonos döntése, 2026-10-19):

- **Visszaigazolás beküldés után:** a kapcsolati űrlap, az árajánlat-kérdőív és az Impact-jelentkezés után megy ki, a
  beküldés nyelvén. A levél azt mondja, amit a webhely is: kapcsolat → „jellemzően egy munkanapon belül válaszolunk”,
  kérdőív → „pár órán belül keresünk… árajánlattal”, Impact → „átnézzük, e-mailben jelentkezünk, a kiválasztás nem
  garantált”. Mellette van időpontfoglalás link (Impactnál az Impact-oldal linkje). **Csak rögzített szöveg megy ki,
  a beküldött tartalomból semmi** (név, üzenet, válaszok sem), így az űrlappal nem lehet idegen címre idegen szöveget
  küldetni. Egy címre 24 órán belül legfeljebb egy ilyen levél megy. A feladó a portál feladója
  (`NOTIFY_FROM`, alapból `portal@stratosweb.hu`), a válaszcím `hello@`. Ha a küldés nem sikerül, a beküldés attól
  még rendben van.
- **Hívás előtti emlékeztető:** kb. 24 órával a hívás előtt megy ki, benne az időpont budapesti idő szerint, a Meet-link
  gombként, a nyilvános foglalóknak egy rövid „mit érdemes előkészíteni” lista, és hogy hogyan lehet lemondani vagy
  áthelyezni (a Google-meghívóból, illetve ügyfélként a portálon). Nem megy, ha az időpontot 25 órán belül foglalták
  vagy helyezték át, mert a Google meghívója épp akkor ment ki. Áthelyezéskor az emlékeztető újraindul, lemondott
  hívásra nem megy.
- **Üdvözlő sorozat:** a megerősítés után a bekapcsolt lépések mennek ki, a feliratkozó nyelvén, sorrendben,
  mindegyik a maga napján (a megerősítéstől számolva: 3, 7, 14 nap). A 3 napnál többet késő lépést kihagyja, nem
  küldi el későn. Aki a sorozat előtt iratkozott fel, nem kapja meg. Leiratkozó link minden levélben van.
- **Új cikk vagy esettanulmány:** a küldő 10 percenként megnézi a webhely listáját. Ami új, arról nyelvenként egy
  kampány készül („Új cikk: …”, „Új esettanulmány: …”, a leírással és a linkkel), és kimegy annak a nyelvnek a
  megerősített feliratkozóinak. Ami az első olvasáskor már a listán volt, azt csak megjegyzi, nem küldi ki. A
  Portálon (Newsletter → Automatic announcements) átállítható: azonnal küldi / csak tervezetet készít / ki. Az
  automatikus kampányok a kampánylistában „Automatic” jelölést kapnak, és ott meg is állíthatók.

Adatkezelési tájékoztató — TERVEZET (jóváhagyásra vár; a webhelyen HU/EN/DE):
- A hírlevél célja kiegészül: „…ennek része néhány bemutatkozó levél a feliratkozás után, és értesítés új cikkekről,
  esettanulmányokról”.
- A Resend sorában a kézbesített levelek közé bekerül: „az űrlapok beküldésének visszaigazolása, a foglalt időpont
  előtti emlékeztető”.
- Más nem változik: a visszaigazolás a kapcsolatfelvétel, az emlékeztető az időpontfoglalás része, új adat nem
  keletkezik.

Ellenőrizve (helyben, 2026-10-19, valódi Supabase és Resend nélkül):
- `tests/email-automations.spec.ts` 14/14, PGlite-on hamis Resenddel:
  - visszaigazolás mindhárom űrlapra a beküldött szöveg nélkül, naponta egy, a hírlevél-űrlapra nem;
  - emlékeztető: mikor megy, a későn foglalt, az áthelyezett és a lemondott hívás;
  - a sorozat: kikapcsolva semmi, bekapcsolva lépésenként, a kihagyott lépések, a régi feliratkozó, a leiratkozott;
  - bejelentések: az első lista csak megjegyzés, utána kampány és kiküldés, a „draft” és az „off” mód, a hibás lista;
  - jogosultságok;
  - a webhely listájának minden tétele létező oldalra mutat.
- Az összes node-os teszt: 574 zöld.
- A levelek böngészőben is ellenőrizve.

## 34. Jarvis: az asszisztens adatbázisa (`supabase/JARVIS.md`, 2. fázis)

**Teendő most nincs:** a migráció 2026-10-19-én a Supabase MCP-n keresztül lefutott (`apply_migration`, név:
`jarvis`; a Supabase migrációs naplójának első bejegyzése). Újrafuttatható, ha valaha kézzel kell:
`supabase/migrations/20261019000300_jarvis.sql`.

- 7 új tábla (`jarvis_threads`, `jarvis_messages`, `jarvis_runs`, `jarvis_actions`, `jarvis_memory`,
  `jarvis_settings`, `jarvis_usage`). A Portál még nem használja őket: a chat a 3. fázisban jön.
- Ki éri el: owner és admin, mindenki a saját beszélgetéseit; az akciókat és a futásokat az owner mind látja. A
  team member, a kliens és az anon semmit.
- Visszaállítás (az API elől elzár, adatot nem töröl): `supabase/checks/jarvis-rollback.sql`.
- Új kulcs most nem kell. Az `ANTHROPIC_API_KEY` a 3. fázishoz kell majd (Netlify → Environment variables,
  Functions scope).

## 35. Jarvis: a chat-függvény (`/api/jarvis`, `supabase/JARVIS.md` 3. fázis)

**Sorrend: 34. (az adatbázis, már élesben) → kulcs → deploy.** A Portálban még semmi nem
látszik belőle: a panel a 4. fázisban jön.

1. Netlify → Site configuration → Environment variables: `ANTHROPIC_API_KEY` (a
   console.anthropic.com API-kulcsa), **Functions** scope. Titok: sehova máshova ne kerüljön.
2. Deploy. Új függvény: `netlify/functions/jarvis.mjs` (`POST /api/jarvis`). Új függőség:
   `@anthropic-ai/sdk`.
3. Kulcs nélkül a függvény `503 ANTHROPIC_NOT_CONFIGURED`-ot ad, és semmi más nem változik.

Mit tud (2026-10-20): kérdésekre válaszol a CRM-ből (leadek, dealek, ügyfelek, projektek,
pipeline, bevétel, kintlévőségek, figyelmeztetések, e-mail-előzmények, meetingek,
munkaidő), a bejelentkezett ember jogaival. Írni, e-mailt vagy meghívót küldeni még nem
tud. Modell: Claude Sonnet 5.5; a napi keret felett Claude Haiku 5.5.

Adatkezelés: a kérdés és a válaszhoz lekérdezett CRM-adat az Anthropichoz kerül
(adatfeldolgozó). Az adatkezelési tájékoztató kiegészítése a JARVIS.md 26. pontja szerint
még jóváhagyásra vár, és élesítés előtt kell.

## 36. Jarvis: a panel a Portálban (`supabase/JARVIS.md` 4. fázis)

**Sorrend: 34. → 35. (a kulcs) → deploy.** Új kulcs nem kell.

1. Deploy. A Portálban az owner és az adminok a parancssávban egy **Jarvis** gombot
   látnak, a Cmd/Ctrl+J pedig bárhonnan megnyitja.
2. Próba: nyiss meg egy leadet, Cmd/Ctrl+J, és kérdezd meg: „Erről mit tudunk?”. A
   válasznak magyarul, a lead valódi adataiból kell jönnie; a tool-sorok (pl. „Rekord
   megnyitva · …”) lenyithatók. Egy listaképernyőn kérdezd meg: „Hol tart a pipeline?”.
3. Ha „Jarvis is not set up on this deployment” jön, az `ANTHROPIC_API_KEY` hiányzik az
   adott deploy kontextusából (Netlify → Environment variables → a kulcs scope-ja és
   kontextusai).

Ellenőrizve helyben: `npm run check:jarvis:ui` 9/9, mockolt szolgáltatásokkal.

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
| Tulajdonos / megbízott | lukacs.artur@media-stratos.com (super_admin) / info@media-stratos.com (admin, `portal_add_delegate`) |
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
     (alap: `lukacs.artur@media-stratos.com`).
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
döntése: az admin (`info@media-stratos.com`) **helyettes** lett (`portal_add_delegate`, 20261003000100) —
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

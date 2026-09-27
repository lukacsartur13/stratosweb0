# Stratos portál — élesítési útmutató (1–5. szakasz egyben)

Ez az egyetlen végigkövethető útmutató a portálbővítés élesítéséhez: tulajdonosi
hozzáférés és projektkövető (1.), Impact program (2.), dokumentumtár (3.), ügyfélfiókok
és megosztás (4.), fizetési ütemezés (5.). A részletes indoklás a szakaszok saját
leírásaiban van (`OWNER_TRACKER.md`, `DOCUMENTS.md`, `CLIENT_PORTAL.md`); ahol ez a
fájl eltér tőlük, **ez a fájl az érvényes**.

> **Semmi nincs élesítve.** Egyetlen migráció sem futott az éles adatbázison, nincs
> deploy, nem készült bucket, nem ment ki meghívó. Minden alábbi lépést te hajtasz
> végre. Titkos értéket (jelszót, kulcsot, kapcsolati sztringet) **soha ne másolj
> be a beszélgetésbe**: a lenti parancsok a te gépeden, interaktívan kérik el őket.

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

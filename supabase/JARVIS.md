# Jarvis — 1. fázis: felderítés

A `JARVIS_SPEC.md` összevetése a repóval és az élő Supabase-projekttel
(`onyynfpowjwsoivkefcz`), 2026-10-19-én, a `main` 8e745d5 állapotán. Ahol a spec
és a valóság eltér, a repó a mérvadó; itt minden eltérés mellett ott a javaslat
is. A **Döntések** részben lévő kérdésekre a 2. fázis előtt kell válasz.

---

## 1. A stack, ahogy valójában van

| | Spec | Valóság |
|---|---|---|
| Szerveroldal | Supabase Edge Functions (Deno) | **Netlify Functions** (Node 22, `netlify/functions/*.mjs`, `/api/*` útvonalak). A Supabase-on **egy edge function sincs**, nincs `supabase/config.toml`, nincs Deno-kód. |
| Ütemezés | `pg_cron` → edge function | **Netlify Scheduled Functions** (`notify-dispatch` percenként, `google-sync` 2 percenként stb.). A `pg_cron` és a `pg_net` **nincs telepítve**. |
| Migrációk | `apply_migration` MCP-vel | A tulajdonos az **SQL-editorban** futtatja őket; minden fájl elején guard (`Run this migration from the SQL editor, not as an API role`). A Supabase migrációs naplója **üres**. Minden migráció újrafuttatható (`if not exists`, `drop policy if exists`), kifejezett `revoke`/`grant`, `force row level security`, hosszkorlátos `check`-ek. |
| Frontend | „meglévő Portal frontend” | React 18 + Vite + Tailwind, `portal/src`. Márka-sárga `#FFEE25` (`--c-signal`), világos témában a szöveg/vonal `#7A6000` (`--c-signal-ink`); mono, tabuláris számok (`.t-page`, `.t-metric`…). A spec dizájnleírása stimmel. Billentyűparancs még nincs a Portálban, a Cmd/Ctrl+J szabad. |
| Tesztek | — | Playwright (`--project=node` a függvényekre, `desktop-1440` a UI-ra), az adatbázis-teszteket **PGlite** futtatja a valódi migrációkon (`tests/*-db.spec.ts`). CI nincs: a „zöld” helyben értendő (`npm run build` + Playwright). |
| Deploy | — | Push a `main`-re, a Netlify abból épít (CLI nincs). |
| Claude | — | Már él egy Claude connector (`/api/mcp`, `portal-mcp.mjs`): a tulajdonos JWT-jével, RLS alatt, generikus PostgREST-toolokkal. Jarvis ennek a mintáját (token-ellenőrzés, `is_owner()` a kérésnél, PostgREST a hívó tokenjével) követheti. |

### A futási idő a döntő korlát

| Futtatókörnyezet | Korlát |
|---|---|
| Netlify streaming függvény (`Response` `ReadableStream`-mel) | 60 mp futás, 20 MB válasz |
| Netlify ütemezett függvény | 30 mp |
| Netlify background függvény | 15 perc, de nincs válasz a kliensnek (202) |
| Supabase Edge Function | 150 mp fal-idő (free), 2 mp CPU |

Egy Sonnet-kör néhány tool-hívással bőven belefér 60 mp-be; egy Opus-ajánlat vagy
egy többlépcsős webkutatás nem biztos.

---

## 2. Eltérések és javaslatok

### Architektúra

1. **`jarvis-chat` Netlify Functionként (`/api/jarvis`), nem Supabase Edge-en.**
   Minden, amire építeni kell, Node-ban van: a Google-token feloldása
   (`google-lib.mjs`), a szabad időpontok számítása (`booking-lib.mjs`), a
   push/e-mail kiküldés (`notify-dispatch.mjs`), a connector mintája. A
   `GOOGLE_TOKEN_KEY` csak a Netlify-ban van; Edge-en duplikálni kellene a kulcsot
   és újraírni a helpereket Deno-ra, a meglévő tesztek pedig nem fednék le.
   A 60 mp-es korlát kezelése: az agentic loop minden lépést azonnal a
   `jarvis_messages`-be ír, és ha ~45 mp-nél tart, `continue` eseménnyel zárja a
   streamet; a kliens magától küldi a folytatást (a szál állapota a DB-ben van).
   A hosszú munkák (`generate_offer`, mély kutatás) background függvényben futnak,
   `jarvis_runs`-ba írnak, a panel a futás állapotát mutatja.
2. **Ütemezés Netlify Scheduled Functionnel, `pg_cron` nélkül.** A brief:
   hétköznap 15 percenként fut, Europe/Budapest szerint ellenőrzi a
   `jarvis_settings.brief_time`-ot és azt, hogy ma volt-e már brief. Így
   DST-biztos, idempotens, és a beállított időpontot is követi. A 30 mp-nél
   hosszabb munka (pl. `lead_hunt`) a háttérfüggvénynek adódik át. Ugyanígy a
   `jarvis-agent` és a 180 napos megőrzés törlése.
3. **`ANTHROPIC_API_KEY` a Netlify környezeti változói közé** (Functions scope),
   nem Supabase secretnek. Továbbra is Artúr állítja be.
4. **Anthropic SDK:** egyik `package.json`-ban sincs. A Netlify a gyökér
   `package.json` alapján csomagolja a függvényeket (lásd a `comments` mezőt), oda
   kell tenni az `@anthropic-ai/sdk`-t (3. fázis).
5. **Rate limit:** a Netlify `config.rateLimit` IP/domain szerint számol, nem
   felhasználónként. A felhasználónkénti percenkénti korlát a DB-ből jön (a hívó
   utolsó 60 mp-es üzenetei a `jarvis_messages`-ben).

### Jogosultság

6. **`is_staff()` helyett `is_admin()`.** A repóban `is_staff()` =
   `super_admin`/`admin`/`team_member`, de a CRM szinte minden táblája
   `is_admin()` (interactions, notes, note_items, time_entries, email_messages,
   automation_alerts, lead_notes/opportunities írása), a projektek, a
   dokumentumtár és a kliensüzenetek pedig `is_owner()`. Egy `team_member`
   Jarvisban üres eredményeket kapna. Élesben ma: 1 `super_admin` (a tulajdonos),
   1 `admin`, 0 `team_member`, 3 `client`.
7. **`jarvis_actions` policy: nem „minden staff mindent”.** A payloadban lehet
   tulajdonosi (projekt-) adat, amit az admin a forrástáblában nem lát; a spec
   `ja_staff` policyja ezt kiszivárogtatná. Javaslat: a saját sorok
   (`user_id = auth.uid()`) és a tulajdonos (`is_owner()`).
8. **`auth.users(id)` helyett `profiles(id)`,** ahogy a repó minden más tábla
   kapcsolódik a felhasználóhoz.
9. **`activity_logs`-ba a hívó JWT-jével nem lehet írni** (FORCE RLS, nincs insert
   policy; eddig is csak `SECURITY DEFINER` függvények és triggerek írják). Kell
   egy szűk `jarvis_log(...)` definer-függvény, vagy egy trigger a
   `jarvis_actions`-ön.
10. **A szerverkulcs egy helyen a chatben is kell:** a `google_accounts`
    `refresh_token_enc` oszlopa szándékosan senkinek nincs kiadva az API-n, a
    saját gazdájának sem; a `google-sync.mjs` is szerverkulccsal olvassa. A spec
    „service role csak cronban” szabálya alól ez az egy olvasás (a hívó saját
    sora, `user_id = <ellenőrzött hívó>`) kivétel.
11. **Policy-stílus:** `(select auth.uid())` és `(select is_admin())` a policykban,
    különben új `auth_rls_initplan` advisor-figyelmeztetések jönnek.

### Adatbázis

12. **SQL-stílus a repó szerint:** fejléc-guard, újrafuttatható DDL, nevesített
    indexek, `force row level security`, `revoke … from public, anon`, kifejezett
    `grant` az `authenticated`-nek, hosszkorlátok a szövegoszlopokon, PGlite-teszt
    (`tests/portal-jarvis-db.spec.ts`).
13. **Entitástípusok:** a `record_notes.entity_type` értékei `opportunity`,
    `client`, `project`; a leadek jegyzete külön tábla (`lead_notes`). A spec
    `organization` szava a repóban `client` (útvonal: `/clients/:id`). Javaslat a
    `jarvis_threads.context_entity_type`-ra: `lead` | `opportunity` | `client` |
    `project`.
14. **Lead „ellenőrizendő” státusz nincs.** `lead_status`: `new`, `contacted`,
    `qualified`, `proposal`, `won`, `lost`, `spam`. A `source` szabad szöveg, a
    `form_type` lehet null. Javaslat: `status='new'`, `source='jarvis'`,
    `meta.jarvis_review = true` — enum-bővítés nélkül, ami a pipeline-nézeteket nem
    érinti.
15. **`automation_alerts`:** van `dedupe` oszlop, de a `kind` check 5 értékre
    korlátoz (`lead_unanswered`, `deal_stale`, `deal_won`, `instalment_overdue`,
    `deadline_soon`), és ezeket az `automation_run()` **már most percenként**
    előállítja. A `pipeline_watch` nagyrészt ezt duplikálná: csak az legyen benne,
    amit az `automation_run()` nem tud, `jarvis_*` kindokkal (check-bővítés).
16. **`notification_outbox`:** a `kind` check 29 értékes lista, a brief-hez kell
    egy `jarvis_brief` érték, plusz a sablon három nyelven
    (`notify-templates.mjs`). Az `owner` közönség **minden adminnak** is megy
    (20261013000200), és push mellett e-mail is, hacsak a címzett ki nem kapcsolta.
17. **Eltérő RPC-aláírások:** `project_payment_overview(p_project uuid)` kötelező
    paraméterrel (a „`project_id?`” nélküli összesítéshez a
    `portal_revenue_report(p_today date)` vagy egy ciklus kell);
    `portal_revenue_attribution(dimension text)`;
    `booking_check_time(p_kind, p_starts, p_ends, p_ignore, p_now)` **egy**
    időpontot ellenőriz, a szabad sávok listája a `booking-lib.mjs`-ben és a Google
    freebusy-ban van.
18. **Mérföldkövek:** a tábla `project_milestones`, az állapot `milestone_state`
    (`pending`, `in_progress`, `waiting_client`, `done`, `blocked`).
19. **Feladat = checklist-tétel:** `notes` (`kind` `note`|`checklist`,
    `organization_id`) + `note_items` (`text`, `due_on`, `milestone_id`). Lead- vagy
    deal-kapcsolat nincs. A `create_task` egy „Jarvis” checklist-jegyzetbe vagy a
    megadott jegyzetbe tesz tételt.
20. **Kliensüzenet:** a tábla `project_messages` (tulajdonosi policy). A kliens
    értesítését nem trigger küldi: a Portál
    (`ClientExperience.tsx`) az üzenet után maga tesz egy `message_posted` sort a
    `notification_outbox`-ba. A `client_portal_message` ugyanezt a két lépést
    végzi.
21. **Törlés:** a `purge_project`, `purge_client`, `purge_lead` létezik, Jarvis
    tool-regiszterébe nem kerülnek, és a connector generikus `delete`-je sem.

### Google

22. **A piszkozathoz új Gmail-jog kell.** A kért scope-ok:
    `gmail.readonly`, `calendar.events`, `calendar.freebusy` (élesben is ez van
    elmentve az egy csatlakoztatott fióknál). Piszkozatot csak `gmail.compose`
    (vagy szélesebb) joggal lehet létrehozni. A `SCOPES` bővítése után a
    tulajdonosnak egyszer újra kell csatlakoztatnia a Google-t a Beállításokban.
    A piszkozat a hívó admin saját Gmailjébe kerül.
23. **Naptár:** a `project_meetings.project_id` kötelező, a sync 2 percenként
    viszi át a Google-naptárba, a `google_invite_clients` a projekt aktív
    kliensfiókjait hívja meg. Projekt nélküli (pl. leaddel tartott) eseményre
    nincs meglévő út: vagy közvetlen Calendar API-hívás (a `calendar.events` jog
    megvan), vagy a 6. fázisban kimarad.

### Push és mobil

24. **Push-út:** Web Push (VAPID), `notification_outbox` → `notify-dispatch`
    (percenként) → `push_subscriptions` (élesben 4 eszköz). A kattintási URL-t a
    `notify-templates.mjs` `target()` adja; a brief-hez egy `/portal/…?jarvis=brief`
    cél kell, amit a panel megnyit.
25. **A mobilapp** (`feat/mobile-app`, még nincs mergelve) push-t még nem kap; a
    brief egyelőre csak a webes Portálban és PWA-ként jelenik meg.

### Adatvédelem

26. **Az Anthropic új adatfeldolgozó.** A CRM-adatok (leadek, ügyfélkapcsolatok,
    e-mail-tárgyak és -kivonatok) a Claude API-hoz kerülnek. Ezt az adatkezelési
    tájékoztatóban fel kell tüntetni, és ahogy a korábbi szövegeknél, a tulajdonos
    jóváhagyásával élesíthető. A `lead_hunt` nyilvános céges adatot gyűjt, de
    személyes adat (pl. egyéni vállalkozó neve) is lehet benne; ez is a
    tájékoztatóba kerül.

---

## 3. Advisor-alapállapot (2026-10-19, Jarvis előtt)

Ehhez mérjük a „nincs új advisor-figyelmeztetés” kritériumot.

| Típus | Szint | Szabály | Darab |
|---|---|---|---|
| security | INFO | rls_enabled_no_policy | 1 |
| security | WARN | function_search_path_mutable | 17 |
| security | WARN | anon_security_definer_function_executable | 42 |
| security | WARN | authenticated_security_definer_function_executable | 71 |
| security | WARN | auth_leaked_password_protection | 1 |
| performance | INFO | unindexed_foreign_keys | 58 |
| performance | WARN | auth_rls_initplan | 16 |
| performance | INFO | unused_index | 19 |
| performance | WARN | multiple_permissive_policies | 60 |

Megjegyzés: minden `authenticated`-nek kiadott definer-függvény +1
`authenticated_security_definer_function_executable` figyelmeztetés. A
`jarvis_log()` ilyen lenne; ha nem lehet nélküle, jelzem, vagy trigger lesz belőle.

---

## 4. Döntések a 2. fázis előtt

1. **Futtatókörnyezet:** Netlify Functions (javasolt) vagy a spec szerinti
   Supabase Edge Functions?
2. **Migráció futtatása:** én futtatom a Supabase MCP `apply_migration`-nel (a
   guard átengedi, mert `postgres`-ként fut; a migrációs napló ezzel indul), vagy
   ahogy eddig, Artúr az SQL-editorban?
3. **Jogosultság:** `is_admin()` (owner + admin), vagy az 1. körben csak
   `is_owner()`?
4. **Branch-ek:** fázisonként egy `feat/jarvis-N-…` branch, egymásra építve,
   mindegyikből PR a `main`-re. Mehet így?

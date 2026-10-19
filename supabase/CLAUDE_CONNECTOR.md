# A Portál a Claude-ban — Claude connector

A Claude (claude.ai, a Claude asztali és mobil app, a Claude Code) **custom
connectorként** csatlakozik a Portálhoz, és a tulajdonos nevében olvashat és
írhat benne: leadek, ügyfelek, projektek, befizetések, jegyzetek, munkaidő,
foglalások, Impact Program, hírlevél, a projektek dokumentumtára — minden, amit
a tulajdonosi fiók a Portálban elér. Ügyfelet is meghívhat, és hírlevelet is
kiküldhet (ez utóbbit csak kifejezett megerősítéssel).

```
Claude ──POST /api/mcp──▶ netlify/functions/portal-mcp.mjs ──PostgREST + Storage, a TULAJDONOS tokenjével──▶ Supabase (RLS, bucket-policyk)
   │                                      ├─ invite_client ──▶ portal-invite.mjs (ugyanaz, mint a Portál Meghívás gombja)
   │ 401 + WWW-Authenticate               └─ /.well-known/oauth-protected-resource/api/mcp
   ▼                                                  "a bejelentkezés a Supabase Auth-nál van"
Supabase Auth OAuth 2.1 szerver ──▶ /portal/oauth/consent  (bejelentkezés + Engedélyezés)
```

- **Bejelentkezés:** a Supabase Auth saját OAuth 2.1 szervere (béta). A Claude
  egy kézzel regisztrált OAuth appal (Client ID + Secret) jelentkezik, a
  tulajdonos a Portálban belép és jóváhagy, a Claude kap egy tokent, és maga
  frissíti.
- **A token egy normál Supabase felhasználói JWT.** Minden lekérdezés és minden
  fájlművelet a tulajdonosként fut, az RLS és a `project-documents` bucket
  policyjai döntenek mindenről, pontosan úgy, mint a Portálban. Szerverkulcs
  adathoz soha nem kerül (csak a séma leírásához, ha a tulajdonos tokenjével az
  nem olvasható). Kivétel nélkül ugyanez a meghívóra: az `invite_client` a
  tulajdonos tokenjével a `portal-invite.mjs`-t hívja — azt, amit a Portál
  Meghívás gombja —, és az a saját, ott leírt két szűk esetben használja a
  szerverkulcsot (a bejelentkezési fiók megkeresése és létrehozása).
- **Csak a tulajdonos:** minden kérésnél a GoTrue ellenőrzi a tokent (egy
  visszavont munkamenet azonnal kizár), és a szerver megkérdezi az
  `is_owner()`-t. Más fiók 403-at kap.

## 1. Beállítás — egyszer, a Supabase dashboardon

1. **Authentication → OAuth Server**
   - kapcsold be az OAuth 2.1 szervert;
   - **Authorization Path:** `/portal/oauth/consent`
     (a Site URL `https://stratosweb.hu`, a kettő együtt adja a jóváhagyó oldal
     címét: `https://stratosweb.hu/portal/oauth/consent`);
   - **Allow Dynamic OAuth Apps** (dynamic client registration): **ki**. Így
     bárki nem regisztrálhat appot; a Claude-ot kézzel vesszük fel (1.2).
2. **Authentication → OAuth Apps → új app** — a Claude-é, egyszer:
   - Name: `Claude`
   - Redirect URIs: `https://claude.ai/api/mcp/auth_callback` és
     `https://claude.com/api/mcp/auth_callback`
   - Public Client: **ki** (így kap secretet; utólag nem módosítható)
   - Token Endpoint Auth Method: **Request body (`client_secret_post`)** — a
     claude.ai így küldi a secretet. `client_secret_basic`-kel a token kiadása
     elbukik: *invalid authentication method* (2026-10-19, a Supabase Auth
     naplójában).
   - Mentés után másold ki a **Client ID**-t és a **Client Secret**-et (a
     secret általában csak egyszer látszik; ha elveszett: *regenerate*, és írd
     át a connectorban is).
3. **Project Settings → JWT Keys:** ha a projekt még a régi, HS256 JWT secrettel
   ír alá, válts aszimmetrikus kulcsra (RS256/ES256). A connector csak `email`
   scope-ot kér, így HS256 mellett is működnie kell — de ha egy kliens `openid`-t
   kér, HS256-tal az ID token kiadása elbukik, és a Supabase is az aszimmetrikus
   kulcsot ajánlja az OAuth szerverhez. (2026-10-19: ES256, rendben.)
4. **Netlify:** új környezeti változó nem kell. A függvény a meglévőket olvassa:
   `SUPABASE_URL` és `SUPABASE_ANON_KEY` (vagy a `VITE_` megfelelőik).
   A `SUPABASE_SECRET_KEY` az adateszközökhöz nem kötelező: csak akkor kell, ha
   a Supabase a séma leírását (PostgREST OpenAPI) a nyilvános kulccsal nem adja
   ki. Az `invite_client` ugyanazokkal a változókkal működik, mint a Portál
   meghívója (`SUPABASE_SECRET_KEY`, `PORTAL_ORIGIN` vagy `URL` —
   `CLIENT_PORTAL.md`); a kiküldött hírlevelet a meglévő ütemezett
   `newsletter-dispatch` viszi ki (Resend).
5. **Deploy** (a szokásos módon, a `main` ágról). Élesítve: 2026-10-19, `edf7cac`.

## 2. Csatlakoztatás

**claude.ai, Claude Desktop, mobil:** Settings → Connectors → *Add custom
connector*

- Name: `Stratos Portal`
- URL: `https://stratosweb.hu/api/mcp`
- **Advanced settings:** OAuth Client ID és OAuth Client Secret — az 1.2-ben
  kimásolt két érték

→ *Add* → *Connect* → megnyílik a Portál → belépsz a tulajdonosi fiókkal →
**Engedélyezés**. A Claude-ban ezután a beszélgetésnél bekapcsolhatod a
connectort (a `+` / eszközök menüben).

Egy app elég a claude.ai-hoz, az asztali és a mobil apphoz: mindhárom a
claude.ai címén tér vissza. Egy jóváhagyás után a Supabase megjegyzi, így egy
újracsatlakozásnál (*Reconnect*) már nem kérdez újra.

**Claude Code:** a böngészős bejelentkezése egy helyi (`localhost`) címre tér
vissza, ezért ehhez **külön OAuth app kell** ezzel a visszatérési címmel, és a
Claude Code-ban a Client ID / Secret megadása. Ezt még nem próbáltuk ki; ha
kell, a pontos lépéseket akkor érdemes a Claude Code aktuális dokumentációjából
venni.

## 3. Ellenőrzés

```bash
curl -s https://stratosweb.hu/.well-known/oauth-protected-resource/api/mcp
```

200 és egy JSON, benne `"authorization_servers": ["https://<ref>.supabase.co/auth/v1"]`.

```bash
curl -si -X POST https://stratosweb.hu/api/mcp
```

`401`, és a `www-authenticate` fejléc a fenti címre mutat.

```bash
curl -s https://<ref>.supabase.co/.well-known/oauth-authorization-server/auth/v1
```

200 — ha 404, az OAuth szerver nincs bekapcsolva (1.1).

Végül a Claude-ban: *„Hány új lead jött ezen a héten, és honnan?”*

## 4. Mit tud

Tizenegy eszköz (`netlify/functions/portal-mcp.mjs`):

| Eszköz | Mit csinál |
|---|---|
| `describe` | minden tábla és nézet oszlopokkal, és minden hívható adatbázis-függvény; egy tábláról részletesen: típus, kulcsok, alapérték, megengedett értékek |
| `query` | olvasás PostgREST szűrőkkel, kapcsolódó táblák beágyazásával, rendezéssel, lapozással, darabszámmal |
| `insert` | 1–200 sor felvétele (upserttel is) |
| `update` | módosítás — csak szűrővel, és visszavonódik, ha több sort érintene, mint `max_rows` (alap: 25) |
| `delete` | végleges törlés — csak szűrővel, `max_rows` (alap: 10) |
| `call_function` | a Portál adatbázis-függvényei (purge, riportok, kampány leállítása …) — azokat kivéve, amelyek egy lenti eszköz lépései (pl. `newsletter_campaign_send`, `client_invite_prepare`): ezekre az eszközt kell használni |
| `list_documents` | egy projekt dokumentumtára: fájlok mappaúttal, mérettel, típussal, állapottal, és a projekt mappái; a Kuka csak `include_trash`-sel |
| `read_document` | egy fájl: `.txt`, `.md`, `.csv` esetén a szövege (hosszúnál lapozva, `offset`); minden másnál (PDF, kép, Office, ZIP) csak az adatai és egy **5 percig érvényes letöltőlink** — a tartalmát nem olvassa |
| `upload_document` | új `.txt` / `.md` / `.csv` fájl (max. 512 KB szöveg) egy projektbe vagy mappájába, a Portál saját négy lépésével (függő sor → aláírt feltöltő link → PUT → ellenőrzés); semmit nem ír felül, foglalt névnél számoz (`jegyzet (2).md`) |
| `invite_client` | ügyfélfiók meghívása vagy újrameghívása a megadott projektekkel — ugyanaz, mint a Portál Meghívás gombja; **egyszer használható belépési linket ad vissza**, e-mailt nem küld; minden hívás új linket ad, a korábbi érvénytelen lesz |
| `send_newsletter_campaign` | egy piszkozat kampány kiküldése a közönsége minden megerősített feliratkozójának. **`confirm: true` nélkül nem küld semmit**, csak megmutatja a tárgyat, a közönséget és a címzettek számát; a Claude ezt megmutatja, rákérdez, és csak igen után hívja újra `confirm: true`-val. Utána percek alatt kimegy, visszavonni nem lehet (a még ki nem ment részt a `newsletter_campaign_cancel` állítja le) |

A `describe`, `query`, `list_documents` és `read_document` csak olvas; az
`invite_client` és a `send_newsletter_campaign` *destructive*-ként van jelölve,
így a Claude ezekre mindig rákérdez, ha a beállításod ezt kéri.

A Claude az indulásnál útmutatót is kap: a projekt/ügyfél törlése a Kukába
helyezés (`archived_at`), a leadé `trashed_at`; végleges törlés csak a `purge_*`
függvényekkel, és csak ha kéred; sok sort vagy visszafordíthatatlanul érintő
változás előtt kérdezzen; a hírlevelet csak a te igened után erősítse meg.

**Amit nem tud (még):**

- PDF, Word/Excel, kép és más nem szöveges fájl *tartalmát* kiolvasni — ezekre
  csak letöltőlinket ad; és ilyen fájlt feltölteni (azt a Portálban);
- `.json` fájl: a dokumentumtár nem fogad el ilyet (`DOCUMENTS.md` §3), így
  olvasni sincs mit;
- fájl átnevezése, mozgatása, Kukába tétele külön eszközzel — ez az `update`-tel
  (`project_documents.name`, `trashed_at`) és a `call_function`-nel
  (`document_move`, `document_restore`) megy, ugyanazokkal a szabályokkal;
- a meghívó linket e-mailben elküldeni — a Portál sem teszi, a linket neked
  kell továbbítanod;
- hírlevél-előnézet és tesztküldés magadnak — ezek a Portál Hírlevél oldalán
  vannak;
- Google szinkron, foglalási naptár, számlázás — ezek Netlify-függvényei nincsenek
  a connectorban.

## 5. Biztonság

- **Ki fér hozzá:** csak a tulajdonos, csak a kézzel felvett Claude appon át.
  A dynamic client registration szándékosan ki van kapcsolva: így nem létezhet
  idegen app, amely a tokent máshová vinné, és nincs mit „Claude”-nak álcázni.
  (Ha egyszer mégis bekapcsolnád: tokent akkor is csak a tulajdonos jóváhagyása
  ad, és a jóváhagyó oldal figyelmeztet, ha a visszatérési cím nem `claude.ai` /
  `claude.com` — de onnantól ez a figyelmeztetés az egyetlen védelem.)
- **A Client Secret** jelszó: csak a connector beállításaiba kerül. Ha kiszivárog,
  a Supabase-ben *regenerate*, és írd át a connectorban.
- **Lecsatlakoztatás:** töröld a connectort a Claude-ban, **és** a Supabase-ben
  Authentication → OAuth Apps alatt töröld a Claude klienst — ez a kiadott
  tokeneket is visszavonja.
- **Prompt injection:** a sorokban és a fájlokban mások által írt szöveg van (a
  weboldal űrlapjai, ügyfélüzenetek, e-mailek, az ügyfelek által leadott
  nyersanyag). A szerver ezt adatnak jelöli a Claude felé, de a módosító
  eszközökre (`update`, `delete`, `call_function`, `upload_document`,
  `invite_client`, `send_newsletter_campaign`) a claude.ai-ban maradjon a
  „kérdezzen rá” beállítás, ne „Always allow”.
- **A hírlevél kiküldése** két lépés: a `confirm` nélküli hívás semmit nem
  küld, a `confirm: true` csak logikai `true` lehet (nem „yes”, nem `1`). A
  `call_function` nem futtatja a `newsletter_campaign_send`-et, így a
  megerősítés nem kerülhető meg.
- **A meghívó link** belépési jog egy ügyfélfiókhoz: a Claude-beszélgetésben
  megjelenik, és ott meg is marad. Küldd tovább, és ha rossz helyre került, egy
  új `invite_client` hívás (vagy a Portál Meghívás gombja) érvényteleníti.
- **Letöltőlinkek:** 5 percig élnek, a tulajdonos tokenjével kért aláírt
  Storage-linkek; a fájlt mellékletként adják.
- **Naplózás:** a Claude módosításai a tulajdonos nevében történnek. Ahol az
  adatbázis triggerrel naplóz (`activity_logs`, pl. egy lead státuszváltása),
  ott ugyanúgy bekerülnek; általános írásnapló nincs. A tokenben a `client_id`
  claim jelzi, hogy OAuth kliens volt — ha egyszer külön meg kell jelölni a
  Claude-tól jövő írásokat, egy trigger ebből (`auth.jwt() ->> 'client_id'`)
  tudja.

## 6. Ha nem működik

| Tünet | Ok |
|---|---|
| A Claude „couldn't connect”-et mond, a Portál meg sem nyílik | az OAuth szerver nincs bekapcsolva (1.1), vagy a connectorban nincs megadva a Client ID / Secret (2.) — dynamic registration nélkül a Claude magától nem tud regisztrálni |
| Jóváhagyás után *Connection issue* / „stopped working, reconnect” | a token kiadása elbukott. A Supabase Auth naplójában (`/oauth/token`): *invalid authentication method* → az app nem `client_secret_post` (1.2); *invalid client* → rossz vagy újragenerált secret |
| A Portál 404-et vagy a nyitóoldalt mutatja jóváhagyás helyett | rossz az Authorization Path (1.1) |
| A Supabase visszautasítja a visszairányítást | az app Redirect URIs listájából hiányzik a Claude címe (1.2) |
| „A kérés nem érvényes” | a kérés 10 perc után lejár, vagy már válaszoltál rá — indítsd újra a Claude-ból |
| Jóváhagyás után 403 | nem a tulajdonosi fiókkal léptél be |
| A token kiadása elbukik jóváhagyás után, és a módszer rendben van | HS256 kulcs és `openid` scope (1.3) |

Tesztek: `tests/portal-mcp.spec.ts` (mockolt Supabase és Storage,
`--project=node`).

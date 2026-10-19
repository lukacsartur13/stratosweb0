# A Portál a Claude-ban — Claude connector

A Claude (claude.ai, a Claude asztali és mobil app, a Claude Code) **custom
connectorként** csatlakozik a Portálhoz, és a tulajdonos nevében olvashat és
írhat benne: leadek, ügyfelek, projektek, befizetések, jegyzetek, munkaidő,
foglalások, Impact Program, hírlevél — minden, amit a tulajdonosi fiók a
Portálban elér.

```
Claude ──POST /api/mcp──▶ netlify/functions/portal-mcp.mjs ──PostgREST, a TULAJDONOS tokenjével──▶ Supabase (RLS)
   │                                      │
   │ 401 + WWW-Authenticate               └─ /.well-known/oauth-protected-resource/api/mcp
   ▼                                                  "a bejelentkezés a Supabase Auth-nál van"
Supabase Auth OAuth 2.1 szerver ──▶ /portal/oauth/consent  (bejelentkezés + Engedélyezés)
```

- **Bejelentkezés:** a Supabase Auth saját OAuth 2.1 szervere (béta). A Claude
  regisztrálja magát (dynamic client registration), a tulajdonos a Portálban
  belép és jóváhagy, a Claude kap egy tokent, és maga frissíti.
- **A token egy normál Supabase felhasználói JWT.** Minden lekérdezés a
  tulajdonosként fut, az RLS dönt mindenről, pontosan úgy, mint a Portálban.
  Szerverkulcs adathoz soha nem kerül (csak a séma leírásához, ha a tulajdonos
  tokenjével az nem olvasható).
- **Csak a tulajdonos:** minden kérésnél a GoTrue ellenőrzi a tokent (egy
  visszavont munkamenet azonnal kizár), és a szerver megkérdezi az
  `is_owner()`-t. Más fiók 403-at kap.

## 1. Beállítás — egyszer, a Supabase dashboardon

1. **Authentication → OAuth Server**
   - kapcsold be az OAuth 2.1 szervert;
   - **Authorization Path:** `/portal/oauth/consent`
     (a Site URL `https://stratosweb.hu`, a kettő együtt adja a jóváhagyó oldal
     címét: `https://stratosweb.hu/portal/oauth/consent`);
   - **Allow Dynamic OAuth Apps** (dynamic client registration): be. Enélkül a
     Claude nem tudja magát regisztrálni.
2. **Project Settings → JWT Keys:** ha a projekt még a régi, HS256 JWT secrettel
   ír alá, válts aszimmetrikus kulcsra (RS256/ES256). A connector csak `email`
   scope-ot kér, így HS256 mellett is működnie kell — de ha egy kliens `openid`-t
   kér, HS256-tal az ID token kiadása elbukik, és a Supabase is az aszimmetrikus
   kulcsot ajánlja az OAuth szerverhez.
3. **Netlify:** új környezeti változó nem kell. A függvény a meglévőket olvassa:
   `SUPABASE_URL` és `SUPABASE_ANON_KEY` (vagy a `VITE_` megfelelőik).
   A `SUPABASE_SECRET_KEY` nem kötelező: csak akkor kell, ha a Supabase a séma
   leírását (PostgREST OpenAPI) a nyilvános kulccsal nem adja ki.
4. **Deploy** (a szokásos módon, a `main` ágról).

## 2. Csatlakoztatás

**claude.ai, Claude Desktop, mobil:** Settings → Connectors → *Add custom
connector*

- Name: `Stratos Portal`
- URL: `https://stratosweb.hu/api/mcp`

→ *Connect* → megnyílik a Portál → belépsz a tulajdonosi fiókkal →
**Engedélyezés**. A Claude-ban ezután a beszélgetésnél bekapcsolhatod a
connectort (a `+` / eszközök menüben).

**Claude Code:**

```bash
claude mcp add --transport http stratos-portal https://stratosweb.hu/api/mcp
```

Utána a Claude Code-ban a `/mcp` paranccsal válaszd ki, és *Authenticate*.

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

Hat eszköz (`netlify/functions/portal-mcp.mjs`):

| Eszköz | Mit csinál |
|---|---|
| `describe` | minden tábla és nézet oszlopokkal, és minden hívható adatbázis-függvény; egy tábláról részletesen: típus, kulcsok, alapérték, megengedett értékek |
| `query` | olvasás PostgREST szűrőkkel, kapcsolódó táblák beágyazásával, rendezéssel, lapozással, darabszámmal |
| `insert` | 1–200 sor felvétele (upserttel is) |
| `update` | módosítás — csak szűrővel, és visszavonódik, ha több sort érintene, mint `max_rows` (alap: 25) |
| `delete` | végleges törlés — csak szűrővel, `max_rows` (alap: 10) |
| `call_function` | a Portál adatbázis-függvényei (purge, riportok, meghívó előkészítése …) |

A Claude az indulásnál útmutatót is kap: a projekt/ügyfél törlése a Kukába
helyezés (`archived_at`), a leadé `trashed_at`; végleges törlés csak a `purge_*`
függvényekkel, és csak ha kéred; sok sort vagy visszafordíthatatlanul érintő
változás előtt kérdezzen.

**Amit nem tud (még):** a dokumentumtár fájljainak *tartalmát* (csak a
rekordjaikat), és a Netlify-függvények műveleteit — meghívó link generálása,
hírlevél kiküldése, Google szinkron. Ezek külön eszközként hozzáadhatók.

## 5. Biztonság

- **Ki fér hozzá:** csak a tulajdonos, csak az általa jóváhagyott kliens. A
  dynamic client registration miatt bárki regisztrálhat klienst, de tokent csak
  a tulajdonos jóváhagyása ad; a jóváhagyó oldal megmutatja, hová megy vissza a
  token, és figyelmeztet, ha az nem a Claude címe (`claude.ai` / `claude.com`).
- **Lecsatlakoztatás:** töröld a connectort a Claude-ban, **és** a Supabase-ben
  Authentication → OAuth Apps alatt töröld a Claude klienst — ez a kiadott
  tokeneket is visszavonja.
- **Prompt injection:** a sorokban mások által írt szöveg van (a weboldal
  űrlapjai, ügyfélüzenetek, e-mailek). A szerver ezt adatnak jelöli a Claude
  felé, de a módosító eszközökre (`update`, `delete`, `call_function`) a
  claude.ai-ban maradjon a „kérdezzen rá” beállítás, ne „Always allow”.
- **Naplózás:** a Claude módosításai a tulajdonos nevében történnek. Ahol az
  adatbázis triggerrel naplóz (`activity_logs`, pl. egy lead státuszváltása),
  ott ugyanúgy bekerülnek; általános írásnapló nincs. A tokenben a `client_id`
  claim jelzi, hogy OAuth kliens volt — ha egyszer külön meg kell jelölni a
  Claude-tól jövő írásokat, egy trigger ebből (`auth.jwt() ->> 'client_id'`)
  tudja.

## 6. Ha nem működik

| Tünet | Ok |
|---|---|
| A Claude „couldn't connect”-et mond, a Portál meg sem nyílik | az OAuth szerver nincs bekapcsolva, vagy a dynamic registration ki van kapcsolva (1.1) |
| A Portál 404-et vagy a nyitóoldalt mutatja jóváhagyás helyett | rossz az Authorization Path (1.1) |
| A Supabase visszautasítja a visszairányítást | Authentication → URL Configuration → Redirect URLs: add hozzá a `https://claude.ai/api/mcp/auth_callback` és `https://claude.com/api/mcp/auth_callback` címet |
| „A kérés nem érvényes” | a kérés 10 perc után lejár, vagy már válaszoltál rá — indítsd újra a Claude-ból |
| Jóváhagyás után 403 | nem a tulajdonosi fiókkal léptél be |
| A token kiadása elbukik jóváhagyás után | HS256 kulcs és `openid` scope (1.2) |

Tesztek: `tests/portal-mcp.spec.ts` (mockolt Supabase, `--project=node`).

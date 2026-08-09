# Phase 9 — Workstream M: Portal Analytics

Status: **Implemented, tested against mocked Google responses, and shipping in a
controlled unconfigured state.** No service account exists yet, so no figure on
this screen has ever come from the real property. That is the expected state and
the screen says so rather than looking broken.

Previously reported as *not applicable — the screen does not exist*. It exists.

---

## 1. The architecture

```
  the public site                    the Portal
        │                                 │
   gtag.js, after consent          GET /api/portal-analytics
        │                            Authorization: Bearer <supabase jwt>
        ▼                                 ▼
   GA4 property  ◄──── Data API ──── netlify/functions/portal-analytics.mjs
   G-JZD43PHJ41                       property 15392224433
   (Measurement ID,                   + service-account key
    public, in the page)              (server-side, never in a bundle)
```

**Measurement and reporting are separate systems and share no credential.** The
site is measured with the Measurement ID, which is public by design and ships in
every page. The Portal reports with the numeric Property ID and a Google service
account. Neither substitutes for the other, and the site would keep measuring
perfectly with the whole of this workstream deleted.

### Why the browser cannot do this itself

Reading a GA4 property requires a service account, and a service account is a
private RSA key. There is no browser-safe way to hold one: any key the portal
could sign with is a key anyone who opens the bundle can sign with, against the
same property, forever, until someone notices and rotates it.

So the split is not a preference. The key lives in the function environment; the
browser sends the signed-in user's own Supabase token and receives numbers.

Three properties are asserted rather than described
(`tests/portal-analytics.spec.ts`):

- no response body contains the private key, the service-account address, the
  Property ID, the Supabase secret or a Google access token;
- the **built** `dist/portal` bundle contains none of those either, and does not
  contain `analyticsdata.googleapis.com` — so nothing in the portal reaches the
  Data API directly;
- with the seams mocked, `globalThis.fetch` is replaced by a function that fails
  the test if it is called. **The suite never contacts Google.**

### No new dependency

The whole Google server-to-server flow — build a JWT, sign it RS256, exchange it
for a bearer token — is about thirty lines of `node:crypto`. The Data API is
`fetch` and JSON. So `googleapis` is not installed, and neither is
`@supabase/supabase-js`: the auth check is two `fetch` calls against GoTrue and
PostgREST.

That second one is deliberate. `createClient()` builds a realtime client that
needs a global `WebSocket`, which is what pinned `NODE_VERSION` to 22 and took
every lead submission down for the length of an outage. The note on `__store` in
`submit-lead.mjs` says dropping to `fetch` would remove that floor entirely;
this function is that note taken.

---

## 2. The gates, in order

| # | Gate | Failure | Notes |
|---|---|---|---|
| 1 | method | **405** | GET only |
| 2 | authentication | **401** | `Authorization: Bearer <supabase access token>`, verified against GoTrue |
| 3 | authorization | **403** | role must be `super_admin` or `admin` |
| 4 | range | **400** | allow-list: `7d`, `28d`, `90d` |
| 5 | configured | **200** `{configured:false}` | not an error — see §4 |
| 6 | cache | 200, no Google call | 5-minute TTL |
| 7 | Google | **502** | generic message; detail to the log only |

### Authentication comes before the configured check, deliberately

Which third-party integrations a private admin has wired up is not something the
open internet is owed. An anonymous `GET` gets `401` and learns nothing —
asserted by *authentication is still required to learn it*, which checks the 401
body does not even contain the word `configured`.

### The role is read from `profiles`, never from the JWT

Supabase user metadata is user-writable. A function that trusted
`user_metadata.role` would let any account with a valid session promote itself
and read the whole property. The role comes from the `profiles` table, which is
the same care `AuthProvider` takes in the portal, for the same reason.

`team_member` and `client` both hold valid sessions and both get **403** — this
is a business-level view of the whole site, not the work someone is assigned to.
An unrecognised role is refused rather than allowed by default.

### Every authentication failure gives the same message

No header, malformed header, expired token, forged token, Supabase unreachable —
one message. A caller who can tell them apart learns how to get closer; one
assertion holds all five to a single string.

---

## 3. What the screen shows, in GA4's own words

| Card | GA4 metric | Window |
|---|---|---|
| Active users, today | `activeUsers` | today |
| Active users, 7 days | `activeUsers` | `6daysAgo`–today |
| Active users, *range* | `activeUsers` | selected |
| Active users, last 30 min | `activeUsers` | `runRealtimeReport` |
| Sessions | `sessions` | selected |
| Views | `screenPageViews` | selected |
| New users | `newUsers` | selected |
| Lead events | `eventCount`, filtered | selected |
| Top pages | `pagePath` × `screenPageViews` | selected, top 10 |
| Traffic source / medium | `sessionSourceMedium` × `sessions` | selected, top 10 |

**Nothing here is called "visitors".** A session is a visit, not a person, and
one person browsing twice is two sessions. The screen would read more smoothly
with the looser word and would be quietly wrong on every card.

### Lead events are counted by name, not by GA4's `keyEvents`

`form_submit_success` and `questionnaire_submit_success`, both from the Phase 9
event taxonomy (§6). GA4's `keyEvents` metric counts whatever someone ticked
"mark as key event" in the interface — a console setting this repository cannot
see, cannot test and cannot keep in step. Counting by name gives the same answer
without depending on a checkbox.

The ratio is reported as **lead events per session** rather than "conversion
rate", because GA4 has its own *session key event rate* built on that same
checkbox, and two numbers with the same name that disagree are worse than one
number with a longer name. With zero sessions it is `null`, not `0` and not
`NaN` — a dashboard that renders `NaN%` is asserted against.

### The consent caveat is on the screen, not only in this document

Basic Consent Mode is read strictly: a visitor who declines is never contacted
by Google at all. **Every figure is therefore a floor, not a count**, and real
traffic is higher by an amount the property cannot know. Someone reading a
dashboard makes decisions from it, so the qualification is rendered with the
numbers, and `basis: 'consented'` travels on every payload so a later refactor
cannot separate the two.

---

## 4. The unconfigured state

With any of `GA4_PROPERTY_ID`, `GOOGLE_SERVICE_ACCOUNT_EMAIL` or
`GOOGLE_PRIVATE_KEY` unset, the endpoint answers **200** with:

```json
{ "ok": true, "configured": false, "missing": ["GOOGLE_PRIVATE_KEY"], "basis": "consented" }
```

The screen renders a setup panel naming exactly what is absent. **Variable names
only — never values**, asserted by a test that sets `GA4_PROPERTY_ID` and
requires the response not to contain it.

This is the difference between a feature waiting for credentials and a feature
that is broken, and the two must not look the same to whoever opens the page. An
empty dashboard would additionally imply nobody visited the site, which is a
false statement rather than a missing one.

---

## 5. Caching

A `Map` in one warm instance's memory, 5-minute TTL, keyed by range.

Described honestly: it does not survive a cold start and does not coordinate
between concurrent instances, so it means *at most one Google call per five
minutes per warm instance*, not *per five minutes*. It is not called a rate
limiter and is not load-bearing for anything but cost — the Data API has
per-property quotas and a dashboard that refetches on every mount will spend
them.

Asserted: a second request inside the TTL makes no Google call; each range
caches separately (one shared entry would serve 7-day figures to someone who
asked for 90); an expired entry refetches; and **a cached payload is still
refused to an account that may not read it** — the cache sits behind the guards,
never in front of them.

The access token is cached too, and renewed a minute early so a request cannot
begin with three seconds left on the clock and finish after expiry.

---

## 6. Failure behaviour

| Failure | Response | What is logged |
|---|---|---|
| Bad or revoked key | 502 `UPSTREAM_FAILED` | the crypto or token error message |
| Service account lacks property access | 502 `UPSTREAM_FAILED` | Google's status and first 400 chars |
| Google outage | 502 `UPSTREAM_FAILED` | the status |
| Realtime alone fails | **200**, `realtimeActiveUsers: null` | one line |
| Property has no data | **200**, every figure `0` | nothing |

Google's error body quotes the request, the property and the service-account
address. It goes to the function log and nowhere else; a test asserts the 502
body contains neither `gserviceaccount`, nor the Property ID, nor
`PERMISSION_DENIED`, nor a stack frame.

Realtime degrading on its own is deliberate: it is the one number the dashboard
can do without, and losing the whole screen over it would be the wrong trade.

---

## 7. Test coverage

**49 assertions**, `tests/portal-analytics.spec.ts`, in the `node` project — no
browser, and it runs once rather than five times over.

Method (4) · authentication (9) · authorization (5) · range (10) ·
unconfigured (4) · report mapping (6) · upstream failure (2) · cache (4) ·
credential containment (5).

Each test imports a **fresh module instance** with the environment it wants, via
a unique query string on the specifier. The configuration is read at import
time, which is what makes the unconfigured state a real state rather than a
flag, and this is what keeps the tests independent of one another.

---

## 8. What is still required from the site owner

Everything below is outside this repository. **None of it is marked pass.**

| # | Step | Where |
|---|---|---|
| 1 | Enable the **Google Analytics Data API** | Google Cloud console, on the project that will own the service account |
| 2 | Create a **service account** and download its JSON key | Google Cloud → IAM → Service Accounts |
| 3 | **Add the service account to the GA4 property** with the **Viewer** role | GA4 Admin → Property access management |
| 4 | Set `GA4_PROPERTY_ID` = `15392224433` | Netlify → Environment variables, **scoped to Functions** |
| 5 | Set `GOOGLE_SERVICE_ACCOUNT_EMAIL` = the key file's `client_email` | as above |
| 6 | Set `GOOGLE_PRIVATE_KEY` = the key file's `private_key`, `\n` escapes intact | as above |
| 7 | Compare one range against the GA4 interface | after deploy |

### Step 3 is the one that gets missed

Creating the service account and enabling the API both happen in **Google
Cloud**. Granting it access happens in **Google Analytics**, which is a different
product with a different admin screen. Skipping it produces a service account
that authenticates perfectly and is refused by the property — a 403 from Google,
surfaced here as a 502, with a log line that names the address to add.

### On step 7

Small differences from the GA4 interface are expected and are not a defect:
GA4's own reports apply modelling and thresholding that the Data API does not.
Compare **directions and magnitudes**, not exact integers. A figure that is a
different *order* is worth investigating; one that is 3% off is not.

### The private key is a real secret

Anyone holding it can read the property. It belongs in the Netlify UI, scoped to
Functions, and nowhere else — not in `.env`, not in `netlify.toml`, not in this
repository. `npm run scan:secrets` covers Google private-key material, and that
rule was added in Phase 9 **before** the credential it looks for existed.

---

## 9. Limits, stated rather than glossed

1. **No figure has come from the real property.** Every number that has ever
   passed through this code was a fixture. The mapping is asserted; that it
   matches what Google returns for *this* property cannot be known until step 7.
2. **The signed-in screen is not covered by an automated test.** The suite runs
   without Supabase credentials, so the portal's authenticated states need a
   seeded staging user — the same gap the three existing manual Portal checks
   have. The guard is covered: an unauthenticated visitor is redirected, and the
   endpoint refuses them independently of the UI.
3. **The portal is English-only**, as it was before this screen. The public site
   is trilingual; the portal is a single-language staff tool and Workstream U's
   localisation requirements are about public-facing surfaces. Adding a
   translation layer for one new screen would have made the portal
   inconsistent with itself.
4. **The cache is per-instance**, and is documented as such rather than as
   durable.
5. **Realtime is a 30-minute window** — GA4's own definition, not a choice made
   here.

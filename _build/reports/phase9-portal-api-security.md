# Phase 9 — Workstreams L and M: Portal and API security

Two findings were fixed in this phase. Everything else was already correct and
is recorded with the evidence, not the impression.

| | |
|---|---|
| **Finding 1 — fixed** | `href={o.website}` in the portal rendered a stored, client-supplied address straight into a link. `javascript:alert(1).co` satisfies the public form's URL check, so a `javascript:` URL could reach the database and be one click away from executing inside an authenticated admin session. |
| **Finding 2 — fixed** | A load-dependent race in `tests/portal.spec.ts` that read as a flake. Diagnosis and evidence in `phase9-test-reconciliation.md`. |
| **Not implemented** | The Portal Analytics screen does not exist. See §4. |

---

## 1. Workstream L — the Portal

### 1.1 Authentication and access

| Check | Result | Evidence |
|---|---|---|
| Authentication required | **pass** | `ProtectedRoute` wraps every non-auth route in `App.tsx` |
| Unauthenticated visitor is redirected | **pass** | `an unauthenticated visitor is sent to sign in` |
| Deep links redirect rather than render | **pass** | `protected routes redirect rather than render` drives the router straight at `/portal/leads`, as someone poking at the bundle would, and asserts the sign-in heading **and** the absence of the admin navigation |
| No lead data before authentication | **pass** | Same test. Additionally, RLS means the data is not reachable even if a guard were bypassed — see 1.2 |
| No service-role key in the frontend | **pass** | `the bundle contains no service role key` fetches every script the shell references and greps each one |
| No self-registration | **pass** | `offers no route to create an account` |
| Password reset does not reveal account existence | **pass** | `does not reveal whether an address has an account` |
| Session handling | Supabase `persistSession` + `autoRefreshToken`, PKCE flow, `localStorage` on the `/portal` origin | `portal/src/lib/supabase.ts` |

### 1.2 Row Level Security

`supabase/migrations/20260801000200_rls.sql`. RLS is enabled on all nine tables
and **forced** on `leads`, so a table owner or a future definer function cannot
quietly bypass the policies. Role lookups go through `SECURITY DEFINER`
functions with a pinned `search_path`, which is the standard answer to "read my
own role inside a policy on the table that stores roles".

The design principle is stated in the migration itself and is the right one:
*the portal's React route guards are a convenience, not a control.* A client who
opens devtools and calls PostgREST with their own token gets exactly what the
policies allow.

### 1.3 Caching and indexing

| Check | Result | Where |
|---|---|---|
| Not publicly cached | **pass** | `Cache-Control: no-store, must-revalidate` on `/portal/*` in `netlify.toml` |
| Hashed assets cached | **pass** | `/portal/assets/*` is `immutable` — correct, those filenames are content-addressed |
| `noindex` | **pass** | `X-Robots-Tag: noindex, nofollow, noarchive` header **and** a `<meta name="robots">` in the shell. Asserted by `is marked noindex` |
| Excluded from the sitemap | **pass** | The sitemap is built from `_build/routes.json`, which has no portal route. Asserted by the SEO audit |
| `robots.txt` | **pass** | `Disallow: /portal` |

### 1.4 Rendering what visitors typed — **the finding**

Every lead the portal renders is untrusted input: validated for shape and length
and nothing else, with free-text fields that are genuinely free.

**What was wrong.** `organizations.website` was rendered as
`<a href={o.website}>`. That value originates from a client's own answer, and
the public form's URL check (`URL_RE` in `lead-contract.mjs`) is deliberately
permissive about formatting — it refuses text, not schemes. `javascript:alert(1).co`
matches it: `javascript:alert(1)` satisfies `[^\s.]+`, then the literal dot,
then `co` satisfies `[^\s]{2,}`. Stored, then rendered, then one click away from
running inside a session that can read every lead.

**Fix.** `safeUrl()` decides the scheme at the point of use and permits only
`http:` and `https:`. A bare `example.com` is upgraded to `https://` rather than
rejected, because a client typing their address without a scheme is the normal
case. Anything else renders as plain text — still visible, still copyable, not
clickable. Losing a link is a shrug; running someone else's script inside an
authenticated admin is not.

Now asserted, on the built bundle, against `javascript:`, `data:`, `vbscript:`,
`file:`, `about:`, a leading-space variant and a mixed-case variant.

| Requirement | Status | Evidence |
|---|---|---|
| Plain text renders safely | **pass** | React escapes text children. No `dangerouslySetInnerHTML`, `.innerHTML =`, `.outerHTML =` or `document.write` anywhere in `portal/src` — asserted by grep across every source file, so it holds for code written after this audit too |
| Multiline answers survive | **pass** | `whitespace-pre-wrap` on every stored-value renderer, asserted |
| Long unbroken content cannot destroy the layout | **pass** | `break-words` on the same elements, asserted. A 4000-character pasted URL would otherwise take the table and the page with it |
| URLs | **pass** | `safeUrl()`, above |
| Legacy unknown fields | **pass** | `Object.entries(meta)` and `Object.entries(payload)` render whatever keys exist; the label table is for readability and never filters. Asserted — including that no `.filter()` is added to it later |
| HTML injection | **pass** | Impossible without one of the four escapes above |
| Script execution | **pass** | Same, plus the scheme allow-list |
| Unsafe URL protocols | **pass** | `safeUrl()` |
| Layout destruction | **pass** | wrap classes, asserted |

Attribution is now displayed. `meta` was fetched by nothing and rendered
nowhere, so the campaign data Workstream D collects would have been invisible to
the only people who would ever look at it. Added to the `select()` and to the
lead detail, with readable labels and unknown keys falling through under their
raw name.

### 1.5 What could not be tested here

The suite runs with **no Supabase credentials**, deliberately — that is what
makes it prove the guards hold when the backend is absent. Three items need a
live project and a seeded user:

| Item | How to verify | Owner |
|---|---|---|
| Sign-out clears the session | Sign in, sign out, confirm `sb-*-auth-token` is gone from `localStorage` and `/portal/leads` redirects | manual, pre-launch |
| Browser **back** after logout shows no data | Sign in, open Leads, sign out, press Back. The guard must re-run and redirect; `Cache-Control: no-store` on `/portal/*` is what stops the document being restored from a shared cache | manual, pre-launch |
| RLS holds against a hand-made request | With a client-role token, `curl` PostgREST for `leads` directly and confirm it returns nothing | manual, pre-launch |

> **REQUIRES USER FACTUAL INPUT** — a seeded staging user, so these three become
> automated rather than remaining a checklist.

---

## 2. Workstream M — `POST /api/lead`

`netlify/functions/submit-lead.mjs`, with the contract in `lead-contract.mjs`.
Gates run cheapest-and-most-certain first, so a flood costs as little as
possible.

| Check | Result | Detail |
|---|---|---|
| Allowed methods | **pass** | POST only; 405 otherwise, decided before the locale is read |
| Content type | **pass** | `application/json` required; 415 otherwise |
| Body-size limit | **pass** | 64 KB, checked **twice** — the declared `Content-Length` before reading, and the measured length after, because `Content-Length` can lie or be absent |
| Malformed JSON | **pass** | 400, no detail |
| Strict schema | **pass** | Closed per-form schemas; a name the schema does not declare is dropped before storage |
| Field allow-lists | **pass** | `FORMS`, `META`, `LEGACY_FIELDS` — three closed lists, and the insert uses an explicit column list |
| Field-length limits | **pass** | Per-field `max`, then capped again after mapping, because a mapper can concatenate two valid fields into one that is over the limit |
| Honeypot | **pass** | `meta.botField`, answered with a byte-identical success so a bot cannot tell acceptance from rejection and tune against the filter |
| Timing gate | **pass** | Under 3 s is dropped the same silent way. The client waits out the remainder rather than being dropped by it |
| Idempotency | **pass** | Unique index on `submission_id`; a duplicate insert is impossible and the loser reads the winner's row back. The guarantee is Postgres's, not the function's |
| Generic public errors | **pass** | Stable `code`, visitor-safe `message`, nothing else |
| No stack trace | **pass** | The store step is wrapped; an unhandled throw in a Netlify function is answered by the platform with `{ errorType, errorMessage, trace }` publicly, which has happened here once and is what the try/catch exists for |
| No raw Supabase error | **pass** | Postgres messages name columns and constraints; they go to the function log and never to a response body |
| No secret leakage | **pass** | No environment value is ever echoed |
| No full payload logging | **pass** | `audit()` logs ids, type, locale, route, field **count** and outcome. Questionnaire payloads carry a business's plans, budget and contacts; none of it is in the log |
| CORS | **pass** | **No CORS headers at all**, which is the correct answer for a same-origin form endpoint — the browser refuses cross-origin reads by default and there is no wildcard to get wrong |
| Environment-variable validation | **pass** | Missing credentials and a failed client construction are two distinct log lines with the same 503 for the visitor. They used to be one line, and an outage was spent pointing at the wrong panel |
| Correct Node runtime | **pass** | `NODE_VERSION = "22"` in `netlify.toml`, load-bearing: `createClient()` builds a realtime client needing a global `WebSocket`, which Node gained in 22 |
| Timeout handling | **warning** | See below |

### 2.1 Rate limiting — stated accurately, not claimed

The in-memory limiter (5 requests per IP per 60 s) **is not durable**:

- it does not survive a cold start;
- it does not coordinate across concurrent instances, and Netlify runs as many
  as it needs;
- an attacker rotating source addresses defeats it entirely.

It stops one client hammering one warm instance. That is worth having and it is
not a production rate limit, and this report does not claim it is one.

`CLOUDFLARE.md` documents a Cloudflare rate-limiting rule as the real ceiling.
**Whether Cloudflare is actually in front of this site is not knowable from the
repository**, and the document is written for `media-stratos.com` — the Wix
apex — rather than for `stratosweb.hu`, so it predates the current domain plan.

> **REQUIRES USER FACTUAL INPUT** — is Cloudflare proxying this site today? If
> not, there is no durable rate limiting on `/api/lead` and the honest statement
> is that there is none.

**Recommendation, in preference order:** Netlify's own rate limiting on
`/api/*` if the plan includes it — one config block, no vendor, no code. Failing
that, Cloudflare per `CLOUDFLARE.md`, updated for the real domain. Failing that,
a Supabase-backed counter keyed on `ip_hash`, which is durable and costs one
round trip per submission.

**No CAPTCHA.** There is no measured abuse, and a CAPTCHA is a tax on every
honest visitor for a problem nobody has demonstrated. The honeypot and the
timing gate are the proportionate answer until there is evidence.

### 2.2 Timeout handling — the one open item

The handler sets no timeout on the Supabase insert. If Supabase is slow rather
than down, the request occupies the function until Netlify's own limit and the
visitor sees a browser-level failure instead of the 503 the contract promises.

Not fixed in Phase 9 because it has never been observed and the fix has its own
failure mode: an `AbortSignal.timeout()` shorter than the platform's turns a
slow-but-successful insert into a lost lead, and choosing the number requires
latency data this project does not have.

**Recommendation:** collect insert latency from the function logs first, then set
the timeout at a large multiple of the observed p99, and answer a timeout with
the same 503 as a missing credential.

---

## 3. What is NOT in the repository

- **No API key, token or secret** of any kind. Confirmed by `npm run scan:secrets`
  and by the dependency audit's own scan.
- **No `.env`.** `.env.example` carries placeholders only. Its `VITE_SITE_URL`
  example said `https://media-stratos.com` — the Wix site — and has been
  corrected to `https://stratosweb.hu`, because it is the exact value that was
  once hardcoded into every canonical on this site and an example is a thing
  people copy.

---

## 4. The Portal Analytics screen — not implemented

The Phase 9 brief specifies what it **must** do. It does not exist:

- there is no analytics screen in `portal/src/pages/screens.tsx`;
- there is no analytics Netlify function;
- there is no Google service-account credential anywhere, and no code that would
  read one.

The GA4 **Property ID** `15392224433` appears in exactly three places, all of
them prose: `.env.example`, a comment in `_build/build.py`, and
`phase9-event-taxonomy.md`. **It is absent from `dist/` entirely** — verified.
That is the state the brief requires: server-side or documentation-only, with
the Portal reporting kept separate from website measurement.

So the brief's Portal-Analytics requirements are **not applicable** rather than
passing or failing. Each becomes a requirement on the day the screen is built,
and they are carried into the readiness manifest with `not-applicable` and a
note rather than dropped:

- require authentication;
- expose no Google credential to the browser;
- show no personal visitor data;
- private cache controls;
- a controlled unconfigured state;
- distinguish staging from production traffic.

The prerequisites for building it are user-side and are listed in
`phase9-report.md` under pending GA4 Console configuration: a service account
with Viewer access to the property, and the Analytics Data API enabled.

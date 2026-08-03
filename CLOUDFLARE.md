# Cloudflare in front of Netlify

Netlify already terminates TLS and serves the headers in `netlify.toml`.
Cloudflare adds what Netlify does not: a WAF, bot scoring, and rate limiting
that sees a request *before* it costs a function invocation.

Nothing here is required for the site to work. It is the hardening pass.

---

## 1. DNS

| Type | Name | Value | Proxy |
|---|---|---|---|
| CNAME | `media-stratos.com` | `<site>.netlify.app` | **Proxied** |
| CNAME | `www` | `<site>.netlify.app` | **Proxied** |

Add the apex and `www` as custom domains in Netlify **first**, and let Netlify
issue its certificate before switching the proxy on. Otherwise the ACME
challenge is intercepted by Cloudflare and the Netlify certificate never issues.

## 2. SSL/TLS

- Mode: **Full (strict)**. Not "Flexible" — Flexible sends plaintext between
  Cloudflare and Netlify and makes every page report as HTTPS while it is not.
- Always Use HTTPS: **on**
- Minimum TLS: **1.2**
- HSTS: **on**, 12 months, include subdomains, preload

`netlify.toml` already sends `Strict-Transport-Security`. Enabling it in
Cloudflare too is harmless; enabling it in *neither* is the failure to avoid.

## 3. Caching

The rules that matter, in order:

| Order | Match | Action | Why |
|---|---|---|---|
| 1 | `/portal*` | **Bypass cache** | Authenticated. A cached shell or an edge-stored response is a session leak between visitors. |
| 2 | `/api/*` | **Bypass cache** | Every response is either a mutation or a per-request answer. |
| 3 | `/assets/*` | Cache everything, edge TTL 7 days | Immutable enough; the generator rewrites paths on change. |
| 4 | `/portal/assets/*` | Cache everything, edge TTL 1 year | Content-hashed filenames. |
| 5 | `/*.html` | Cache, edge TTL 1 hour, respect origin | Generated pages change on deploy. |

> **Do not enable "Cache Everything" globally.** With rule 1 absent, Cloudflare
> will happily store a signed-in visitor's portal response and serve it to the
> next person on the same edge.

Also disable **Rocket Loader** and **Auto Minify (JS)** for `/portal*` and `/`.
Rocket Loader reorders script execution, and the ascent depends on
`flight.js` initialising before first paint.

## 4. WAF

Managed rules:

- **Cloudflare Managed Ruleset** — on
- **OWASP Core Ruleset** — on, paranoia level 1, anomaly threshold 40

Start in **Log** mode for a week and read what it catches before switching to
Block. The OWASP set at higher paranoia will block ordinary Hungarian prose in a
message field.

Custom rules:

```
# Only these methods are ever needed.
(http.request.method in {"POST" "PUT" "PATCH" "DELETE"}
 and not http.request.uri.path in {"/api/lead"}
 and not starts_with(http.request.uri.path, "/portal"))
→ Block

# The portal is for humans with accounts.
(starts_with(http.request.uri.path, "/portal") and cf.client.bot_score lt 10)
→ Managed Challenge
```

## 5. Rate limiting

The function has an in-memory limiter, but it lives per-instance and does not
survive a cold start. This is the real ceiling.

| Rule | Match | Limit | Action |
|---|---|---|---|
| Form submissions | `/api/lead` | 5 / minute per IP | Block, 1 min |
| Sign-in attempts | `/portal/login` | 10 / 5 minutes per IP | Managed Challenge |
| Everything | `/*` | 300 / minute per IP | Managed Challenge |

Supabase applies its own auth rate limits server-side; this stops the traffic
before it reaches them.

## 6. Bot protection

- **Bot Fight Mode** — on (free tier) or **Super Bot Fight Mode** on Pro
- Allow verified bots: **yes**, or the site leaves Google's index
- `/portal*`: challenge anything scoring below 10

Do not put a challenge on `/` — an interstitial in front of the homepage costs
more in bounced visitors than it saves.

## 7. Verifying it worked

```bash
# Security headers survive the proxy
curl -sI https://media-stratos.com | grep -iE 'strict-transport|content-security|x-content-type'

# The portal is not cached at the edge
curl -sI https://media-stratos.com/portal/ | grep -i 'cf-cache-status'
# expect BYPASS or DYNAMIC — never HIT

# Rate limiting bites
for i in $(seq 1 12); do
  curl -s -o /dev/null -w "%{http_code} " -X POST https://media-stratos.com/api/lead \
    -H 'content-type: application/json' -d '{}'
done
# expect 4xx codes to appear before the twelfth
```

---

## Order of operations

1. Deploy to Netlify, confirm the site works on `<site>.netlify.app`
2. Add custom domains in Netlify, let certificates issue
3. Point DNS at Cloudflare, proxy **off**, confirm the site still works
4. Turn the proxy **on**, set SSL to Full (strict)
5. Add the cache bypass rules for `/portal*` and `/api/*` — **before** any
   caching rule
6. WAF in Log mode; read the logs for a week
7. Rate limiting
8. WAF to Block

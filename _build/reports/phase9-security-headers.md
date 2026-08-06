# Phase 9 — Workstream N: security headers and CSP

Status: **Implemented and statically validated. Live header validation pending
domain cutover.**

One source of truth: `netlify.toml`. There is no `_headers` file, no `_headers`
in `dist/`, and no header set anywhere in application code — so what this
document describes is the whole of it.

---

## 1. Where headers come from

| Source | Present | Notes |
|---|---|---|
| `netlify.toml` | **yes** | Four `[[headers]]` blocks, one `[build.environment]`, seven redirects |
| `_headers` (root or `dist/`) | **no** | Nothing generates one. If one ever appears it would *merge* with `netlify.toml` and the interaction is confusing; keeping it absent is deliberate |
| Generated per-page headers | **no** | The site is static files |
| Function responses | `/api/lead` sets `content-type` and `cache-control: no-store` on every response, including errors | `submit-lead.mjs` |
| Node version | `NODE_VERSION = "22"` | Load-bearing — `createClient()` needs a global `WebSocket`, which Node gained in 22. See the note in `netlify.toml` before lowering it |
| Preview configuration | Inherited. Netlify applies `netlify.toml` to deploy previews identically | Indexing is handled separately, in `robots.txt` — see §5 |

---

## 2. The headers, and the assessment of each

Applied to `/*`:

| Header | Value | Assessment |
|---|---|---|
| `X-Content-Type-Options` | `nosniff` | **Correct.** No downside, and it closes MIME-confusion on the JSON data blocks the pages carry |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | **Correct and deliberate.** Sends the full URL same-origin, the origin only cross-origin, and nothing over a downgrade. This is also what makes `meta.referrerOrigin` an origin rather than a URL — the browser is not giving us more than that, by our own instruction |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), interest-cohort=(), payment=()` | **Correct.** Five features the site does not use, denied to itself and to anything embedded. `interest-cohort=()` is the FLoC opt-out; harmless now that FLoC is dead, and cheaper to keep than to argue about |
| `X-Frame-Options` | `DENY` | **Correct**, with `frame-ancestors 'none'` in the CSP as the modern equivalent. Belt and braces on purpose: `X-Frame-Options` is what older agents honour |
| `Cross-Origin-Opener-Policy` | `same-origin` | **Correct.** Severs `window.opener` for anything this site opens |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains; preload` | **See §4 — the one item flagged** |
| HTTPS redirect | Netlify default, plus `upgrade-insecure-requests` in the CSP | **Correct** |

Per-path:

| Path | Header | Assessment |
|---|---|---|
| `/portal/*` | `Cache-Control: no-store, must-revalidate` | **Correct.** Authenticated; a cached shell in a shared cache is a session leak between visitors |
| `/portal/*` | `X-Robots-Tag: noindex, nofollow, noarchive` | **Correct**, and belt-and-braces with the `<meta name="robots">` in the shell and `Disallow: /portal` in `robots.txt` |
| `/portal/assets/*` | `Cache-Control: public, max-age=31536000, immutable` | **Correct.** Content-addressed filenames; immutability is a fact about them, not a bet |
| `/assets/*` | `Cache-Control: public, max-age=604800` | **Correct**, and safe because `scripts/fingerprint-assets.mjs` appends a content hash as `?v=`, so a deploy invalidates its own cache |
| `/api/*` | `Cache-Control: no-store`, `X-Robots-Tag: noindex` | **Correct** |

---

## 3. The Content Security Policy

```
default-src 'self';
script-src  'self' https://www.googletagmanager.com;
worker-src  'self' blob:;
style-src   'self' 'unsafe-inline';
font-src    'self';
img-src     'self' data: blob: https://*.supabase.co
            https://www.google-analytics.com https://www.googletagmanager.com;
connect-src 'self' https://*.supabase.co wss://*.supabase.co
            https://www.google-analytics.com https://*.google-analytics.com
            https://*.analytics.google.com https://www.googletagmanager.com;
form-action 'self';
frame-ancestors 'none';
base-uri 'self';
object-src 'none';
upgrade-insecure-requests
```

### 3.1 The Google origins, exactly — what and why

| Origin | Directive | Why it is required | Consent-gated? |
|---|---|---|---|
| `www.googletagmanager.com` | `script-src` | `gtag.js` is served from here. It is the only third-party script origin in the policy | **Yes.** The tag is not injected until consent is granted |
| `www.google-analytics.com` | `connect-src` | The primary collection endpoint | **Yes** |
| `*.google-analytics.com` | `connect-src` | GA4 selects a regional collection endpoint at runtime; the host is not knowable in advance | **Yes** |
| `*.analytics.google.com` | `connect-src` | The second regional endpoint family GA4 uses | **Yes** |
| `www.googletagmanager.com` | `connect-src` | gtag fetches its own configuration from here | **Yes** |
| `www.google-analytics.com` | `img-src` | The pixel fallback, used when `sendBeacon` and `fetch` are unavailable | **Yes** |
| `www.googletagmanager.com` | `img-src` | Same fallback path | **Yes** |

**A CSP entry is permission, not instruction.** These hosts being allowed does
not mean anything contacts them. Under Basic Consent Mode as implemented here,
a visitor who refuses — or who has not answered — causes **zero** requests to
any of them, because `gtag.js` is never injected.

### 3.2 What is deliberately absent

| Absent | Why it matters |
|---|---|
| `stats.g.doubleclick.net` and every other advertising host | This is the line between analytics and ad tracking. Google Signals is off and ad personalisation is denied; adding an advertising host is what would make those settings the only thing standing in the way |
| `'unsafe-eval'` | Not present on any directive |
| `'wasm-unsafe-eval'` | Measured, not assumed. `experiments/probe-draco-csp.mjs` proved the JavaScript Draco decoder works under the narrow policy at 106 ms / 76 ms once, in a worker. The WASM decoder is ~4× faster and therefore not *required*, so it is not allowed. `MOUNTAIN_DECODER` is pinned to `'js'` to match |
| `'unsafe-inline'` on `script-src` | The strongest part of this policy. `gtag` loads as an external script and is configured from `assets/js/analytics.js`, so no inline block is needed |
| Wildcard sources (`*`, `https:`, `data:` on `script-src`) | None. Every wildcard in the policy is a **subdomain** wildcard on a named vendor domain — `*.supabase.co`, `*.google-analytics.com` — never a scheme or a bare host |

`'unsafe-inline'` **is** on `style-src`, and that is a real weakening worth
naming rather than burying: the site sets per-frame custom properties on element
`style` attributes, which the CSP counts as inline styles. The alternative is a
nonce or a hash on every animated element on every page. Inline *style* cannot
execute script; the risk it carries is presentational injection, and it is
accepted knowingly.

`blob:` on `worker-src` is likewise accepted knowingly and is narrower than it
looks: `script-src` stays `'self'` with no `unsafe-inline` and no eval, so there
is no route by which injected script could author the blob in the first place.

### 3.3 Testing

Asserted by `tests/analytics.spec.ts`
(`the CSP permits gtag and nothing from the advertising side`), which reads the
policy out of `netlify.toml` and checks both the presence of the four Google
origins and the **absence** of doubleclick, `unsafe-eval` and `unsafe-inline` on
`script-src`.

Behaviourally exercised across:

| Surface | Covered by |
|---|---|
| Homepage, Services, Work, Contact, Questionnaire | `tests/public-site.spec.ts`, `tests/lead-forms.spec.ts` — including `no built page carries an executable inline script`, which walks every built page. This is the check that matters most, because a CSP refusal is **not** a JavaScript error: nothing throws, the console stays clean, and the page simply renders empty. The quote wizard shipped that way in all three languages and was dead in production |
| Portal | `tests/portal.spec.ts` — `serves and boots without crashing` fails on any page error |
| GA4 consent acceptance | `accepting loads gtag, and only then` |
| GA4 refusal | `refusing loads nothing, and is remembered`, `nothing is contacted, stored or sent before an answer is given` |
| HU / EN / DE | Every public-site test runs against all three locales |
| Preview host | `the adapter refuses to run on a host that is not allowlisted` — `127.0.0.1` is not on the list, and the shipped adapter refuses to start there |
| Production host configuration | `the host allowlist excludes local, preview and the known-bad domain` |

**What is not proven:** that Netlify actually emits these headers, which is
observable only on a deploy. The policy is enforced (not report-only) and has
been in force since before Phase 9, so this is not a new risk being taken — the
Phase 9 change is a narrow widening of an already-enforced policy, and the site
has been running under it.

Post-deploy verification:

```
curl -sI https://stratosweb.hu/ | grep -i 'content-security-policy\|strict-transport\|x-frame'
```

No report-only candidate is proposed, because enforcement is already the status
quo and proposing a report-only version would be a step backwards.

---

## 4. HSTS `preload` — flagged, not changed

`Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`

The `preload` token is present. It pre-dates Phase 9 and has **not** been added
here — the brief's instruction is not to enable preload automatically, and it
has not been.

It is flagged because it deserves a decision before cutover, for two reasons:

1. **Submission to the preload list is effectively irreversible.** Removal takes
   months and is at the browser vendors' discretion. `includeSubDomains` with
   preload means *every* subdomain of the apex must serve valid HTTPS forever —
   including ones that do not exist yet, and including any that might one day be
   pointed at a service that does not.
2. **The token alone does nothing.** Preloading only takes effect after the
   domain is submitted at `hstspreload.org`. So today it is a declaration of
   intent, not a live constraint.

> **REQUIRES USER FACTUAL INPUT** — before cutover, decide one of:
> **(a)** keep `preload` and submit the domain deliberately, after confirming
> every current and planned subdomain will serve HTTPS indefinitely; or
> **(b)** drop the `preload` token and keep `max-age` and `includeSubDomains`,
> which is 95% of the protection with none of the one-way door.
>
> Recommendation: **(b) until the domain has been live and stable on HTTPS for a
> few weeks**, then (a) if wanted. Nothing is lost by waiting; a mistake made by
> submitting early cannot be taken back.

`CLOUDFLARE.md` also recommends enabling HSTS with preload at the Cloudflare
layer. Same decision, same document, and that file is additionally written for
`media-stratos.com` rather than `stratosweb.hu` — see §6.

---

## 5. Preview and staging

| Concern | Handling |
|---|---|
| Preview deploys must not be indexed | `robots.txt` is `Disallow: /` for any `netlify.app` origin and for any Netlify context that is not `production` — `isPreviewOrigin()` in `scripts/site-origin.mjs` |
| Preview must not measure | Three independent gates: the host allow-list checked in the browser against the real hostname, the presence of a Measurement ID, and consent. A local build, a deploy preview or a fork measures nothing however it is configured |
| Preview traffic must be separable if it does measure | Everything off the two production domains is labelled `staging` on every event and as GA4's own `traffic_type` |
| Preview headers | Identical to production. This is correct — a preview that is more permissive than production tests the wrong policy |

---

## 6. Findings and open items

| # | Item | Severity | Status |
|---|---|---|---|
| 1 | HSTS `preload` token present without a deliberate decision | **medium** — irreversible if acted on | **REQUIRES USER FACTUAL INPUT**, §4 |
| 2 | `CLOUDFLARE.md` is written for `media-stratos.com`, the Wix apex, not for `stratosweb.hu` | **low** — a document, not a control | Flagged. It is a runbook nobody has executed; rewriting it belongs with the cutover, when the real DNS is known |
| 3 | Whether Cloudflare is in front of this site at all | **medium** — the durable rate limit depends on it | **REQUIRES USER FACTUAL INPUT**. See `phase9-portal-api-security.md` §2.1 |
| 4 | `'unsafe-inline'` on `style-src` | **low** — accepted knowingly | Documented, §3.2. Removing it means a nonce or hash per animated element |
| 5 | Live header emission unverified | **low** | Pending cutover; one curl, written down in §3.3 |

No header was changed in this workstream. The CSP widening for GA4 was made in
the earlier Phase 9 commit and is documented here rather than re-litigated.

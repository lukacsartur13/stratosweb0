# Phase 9 — Workstream I: redirects and the 404

Status: **Implemented and statically validated. Live final-domain validation
pending domain cutover.**

The domain has not moved. `stratosweb.hu` is still served by Wix; this site is
served from `stratosweb1.netlify.app`. That limits what can be *proved* here and
is stated per item rather than glossed.

---

## 1. The redirect table, in full

Every rule is in `netlify.toml`. There is no `_redirects` file, no
`_headers` file, and no redirect anywhere else — one place, and it is
version-controlled.

| # | From | To | Status | Kind | Purpose |
|---|---|---|---|---|---|
| 1 | `/portal/*` | `/portal/index.html` | 200 | rewrite | SPA shell; the router resolves the path |
| 2 | `/portal` | `/portal/index.html` | 200 | rewrite | bare path |
| 3 | `/index.html` | `/` | 301 | redirect | **new in Phase 9** |
| 4 | `/en/index.html` | `/en/` | 301 | redirect | **new in Phase 9** |
| 5 | `/de/index.html` | `/de/` | 301 | redirect | **new in Phase 9** |
| 6 | `/login` | `/portal/login` | 302 | redirect | legacy guess |
| 7 | `/dashboard/*` | `/portal/` | 302 | redirect | legacy guess |

### Loops and chains

- **Loops: none.** Rules 3–5 match the request path `/index.html`; the target
  `/` is a different request path and matches no rule. Rules 1–2 are rewrites,
  which do not re-enter the redirect engine.
- **Chains: none that a browser sees.** `/login` → `/portal/login` (302) is
  followed by a *rewrite* to the SPA shell, which is a 200 and not a second hop.
  `/dashboard/x` → `/portal/` (302) then rewrite. Both are one redirect.
- **Locale is preserved** by every rule. Nothing crosses a language boundary.
- **Query strings are preserved** — Netlify's default for a redirect with no
  query in the target. This matters more than it used to: attribution is read
  from `utm_*` on arrival, so a campaign link to `/index.html?utm_source=…`
  must keep its parameters through rule 3, and does.
- **Nothing redirects to the homepage.** In particular there is no
  catch-all `/* → /` rule, which is the single most common way a site ends up
  answering 200 for a dozen URLs that do not exist.

### Why 301 and not 302 on rules 3–5

The homepage's address is permanent. A 302 asks every crawler to keep re-checking
the old URL indefinitely and never consolidates the signals, which is the entire
thing these three rules exist to do.

---

## 2. What was audited

| Class | Finding | Action |
|---|---|---|
| **Duplicate homepage paths** | `/` and `/index.html` both answered 200 and were the same document. The shells' canonical said `/`; the sitemap and every internal link said `/index.html`. | **Fixed.** `absolute()` in `_build/build.py` is now the single statement of every canonical URL, the sitemap is built from it, internal links use it, and rules 3–5 retire the old path. |
| **Locale paths** | `/en/`, `/de/` — correct and canonical. `/en/index.html` and `/de/index.html` had the same duplicate problem. | **Fixed** by rules 4–5. |
| **Old `.html` paths** | The current routes *are* `.html` paths and are the canonical form. Nothing to redirect. | No action. |
| **Clean-route variants** (`/kkv` for `/kkv.html`) | Netlify serves an extensionless request from the matching `.html` file with a 200. Both URLs therefore resolve. The `<link rel="canonical">` on the page names the `.html` form, which is what resolves the duplication for a crawler. | No redirect added — see §3, item 1. |
| **Trailing slashes** | No route has a trailing-slash variant except the three homepages, where the trailing slash *is* the canonical form. | No action. |
| **Renamed service routes** | The Phase 8 route rework created new routes; it renamed none. Verified against `_build/routes.json` and the Phase 8 route matrix. | No action. |
| **Old Work and Contact paths** | Same — new routes, not renames. | No action. |
| **Draft case-study paths** | The three case studies are `summary`. They are live, reachable, `noindex, follow`, and absent from the sitemap. Redirecting them would be wrong twice over: they exist, and a redirect to `/munkaink.html` would imply the full case study lives there. | **No redirect, deliberately.** |
| **Uppercase / lowercase conflicts** | Every generated filename is lower-case ASCII with hyphens. No route differs from another by case only. | No action. |
| **Old Wix URLs** | **REQUIRES USER FACTUAL INPUT** — see §3, item 2. | Blocked. |

---

## 3. Open items, and what each is blocked on

### 1. Netlify "Pretty URLs" — must be checked before cutover

Netlify has a site setting that **301-redirects `/page.html` to `/page`**. If it
is enabled on this site, then every `<link rel="canonical">` this build emits
points at a URL that immediately redirects — a canonical to a redirect, on all
60 indexable routes at once. That is a genuine defect and it is invisible from
the repository, because it is a dashboard setting rather than a file.

> **REQUIRES USER FACTUAL INPUT** — in the Netlify dashboard, confirm whether
> *Pretty URLs* (under Build & deploy → Post processing / Asset optimization) is
> **off**. If it is on, either turn it off, or say so and the generator will emit
> extensionless canonicals instead. Either is correct; the two disagreeing is
> not.

Verification once the site is reachable:
`curl -sI https://<host>/kkv.html` must return `200`, not `301`.

### 2. The Wix URL inventory

The pre-rework site is a Wix site on `media-stratos.com`, and its URL structure
is not in this repository. Redirect rules cannot be written for URLs nobody has
listed, and inventing plausible ones would produce redirects that either never
fire or fire for the wrong thing.

> **REQUIRES USER FACTUAL INPUT** — the list of old public URLs worth
> preserving. The two practical sources are Google Search Console's *Pages*
> report on the existing property, and the Wix sitemap
> (`https://media-stratos.com/sitemap.xml`) taken before the DNS moves.
> Once that list exists, each entry maps to one of: a 301 to the equivalent new
> route, or nothing at all if the page has no equivalent — in which case the 404
> below is the correct answer and is better than a redirect that lies.

This is a **Phase 10 domain-cutover dependency**, and it has to be collected
*before* the cutover, because the Wix site stops being readable at the moment
DNS changes.

### 3. Live status verification

The HTTP status of every rule above is Netlify's to produce and can only be
observed on a deploy. Statically the rules are correct and the loop/chain
analysis holds by inspection.

---

## 4. The 404

`404.html`, `en/404.html`, `de/404.html` — generated by `build_not_found()` in
`_build/build.py`, one per locale. Netlify serves `<dir>/404.html` for paths
under that directory and `/404.html` for everything else, with a real 404
status.

| Requirement | Status | How it is verified |
|---|---|---|
| Returns HTTP 404 | **Implemented; live validation pending** | Netlify's `404.html` convention. The test suite runs against `python3 -m http.server`, which has never heard of `404.html` and answers with its own body — so an assertion here would pass for the wrong reason. Post-deploy check: `curl -sI https://<host>/no-such-page` → `HTTP/2 404`. |
| Localised | **pass** | Three documents; `tests/not-found.spec.ts` asserts `lang`, the heading and the four links per locale |
| Links to Home, Services, Work, Contact | **pass** | Four links, and the suite fetches each one and requires a 200 — no dead ends off a dead end |
| Lightweight | **pass** | The ordinary page chrome and nothing else |
| No homepage WebGL | **pass** | Asserted: no `.glb` request, no `/assets/home/` bundle, no 3D context. The only canvas is `.contrail`, the 2D decoration every generated page carries |
| No auto-redirect | **pass** | No `meta refresh`, and the suite checks the URL is unchanged 1.5 s after load |
| No fake search field | **pass** | Asserted absent. The site has no search, and a box that does nothing when you type in it costs the visitor an attempt before telling them so |
| Says nothing to a crawler about a page that does not exist | **pass** | `noindex, follow`, and no canonical, no `rel="alternate"`, no Open Graph, no JSON-LD |

### Why it is a page and not a redirect

A catch-all to the homepage answers **200 for a page that does not exist**. A
crawler then indexes the homepage under every dead address it tries, and a
visitor who mistyped is never told they mistyped — they simply arrive somewhere
else and have to work out why. The 404 status is the useful half of the answer
and a redirect throws it away.

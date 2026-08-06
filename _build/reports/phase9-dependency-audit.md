# Phase 9 — Workstream O: dependencies and secrets

Three manifests, three lockfiles. `npm audit` was run against each; **nothing
was upgraded, and `npm audit fix --force` was not run.**

| Workspace | Direct deps | Vulnerabilities | Verdict |
|---|---|---|---|
| root (Netlify Functions + test runner) | 2 | **0** | clean |
| `experiments/` (homepage bundle) | 6 + 7 dev | **0** | clean |
| `portal/` (private admin SPA) | 10 + 9 dev | **3 moderate**, all in `react-router` | see §2 |

Secret scan: **clean**, 546 files, 12 rules — five of them added in this phase.

---

## 1. What is depended on, and why each is there

### Root — `package.json`

| Package | Kind | Why |
|---|---|---|
| `@supabase/supabase-js` | **production** | The Netlify Functions' only runtime dependency. It is declared here rather than in `portal/` because Netlify bundles `netlify/functions/*` against the **root** manifest; having it only under `portal/` is what made every lead submission crash with `ERR_MODULE_NOT_FOUND` |
| `@playwright/test` | dev | The test runner |

**The public site ships no third-party JavaScript at all.** `assets/js/*` is
hand-written, dependency-free, classic-script code. The only runtime
dependencies in the whole deployed public surface are the ones the homepage
bundle carries.

### `experiments/` — the homepage

`three`, `@react-three/fiber`, `@react-three/drei`, `gsap`, `react`,
`react-dom`. All six are used; none is redundant. This is the 3D journey, and
it is the reason the homepage is a bundle rather than a document.

### `portal/` — the private admin

All ten production dependencies are used: `react`, `react-dom`,
`react-router-dom`, `@supabase/supabase-js`, `react-hook-form` +
`@hookform/resolvers` + `zod` (one validation stack, not three), `clsx` +
`tailwind-merge` (class composition), `lucide-react` (icons).

### Duplicates and deprecations

- `react`, `react-dom`, `@vitejs/plugin-react`, `typescript`, `vite`,
  `@types/*` appear in both `portal/` and `experiments/`, at the **same
  versions**. Two separate applications with two separate chunk graphs and two
  separate build outputs; sharing a `node_modules` would couple them without
  benefit. Not a duplicate to resolve.
- `@supabase/supabase-js` is in root and `portal/` at the same range, for the
  bundling reason above. Deliberate.
- No package in any manifest is deprecated by its publisher.

### Runtime compatibility

Node 22, pinned in `netlify.toml` and load-bearing rather than housekeeping —
`createClient()` builds a realtime client that requires a global `WebSocket`,
which Node gained in 22. On 20 it threw on every request and `/api/lead`
answered 503 for every submission while the credentials were correct.

### Lockfiles and reproducibility

Three `package-lock.json` files, all committed, all current — `npm ci` is what
`postinstall` runs for the two sub-projects, so a build installs exactly the
locked tree. Reproducible.

---

## 2. The three `react-router` advisories

`react-router-dom@6.30.4` / `react-router@6.30.4`.

| Advisory | CVSS | Applies here? |
|---|---|---|
| [GHSA-jjmj-jmhj-qwj2](https://github.com/advisories/GHSA-jjmj-jmhj-qwj2) — open redirect leading to XSS | 6.9 | **No** |
| [GHSA-wrjc-x8rr-h8h6](https://github.com/advisories/GHSA-wrjc-x8rr-h8h6) — open redirect via backslash in `<Link>` and `useNavigate` | — | **No** |
| [GHSA-337j-9hxr-rhxg](https://github.com/advisories/GHSA-337j-9hxr-rhxg) — arbitrary constructor injection via `deserializeErrors()` in SSR hydration | 6.1 | **No** |

### Why not, specifically

The first two require the application to pass **attacker-controlled input** to a
navigation target. Every navigation target in this portal is a literal string,
and that was verified rather than assumed — the complete list:

```
App.tsx:83                    <Navigate to="/" replace />
auth/pages.tsx:56             <Navigate to="/" replace />
auth/pages.tsx:170            navigate('/', { replace: true })
auth/ProtectedRoute.tsx:37    <Navigate to="/login" replace state={{ from: location.pathname }} />
auth/ProtectedRoute.tsx:58    <Navigate to="/" replace />
```

There is no `<Link to={…}>` built from a query parameter, from a route
parameter, or from stored data. `location.pathname` at ProtectedRoute.tsx:37 is
carried in router **state**, not used as a destination.

The third requires server-side rendering. The portal is a client-only Vite SPA:
no `renderToString`, no `hydrateRoot`, no `StaticRouter`, no
`createStaticHandler`. `deserializeErrors()` is never reached.

### Why it was not upgraded

`fixAvailable` is real, and the fixed range is **`> 7.17.0`** — the vulnerable
range is `6.0.0 – 7.17.0`. Getting the fix means **react-router 6 → 7**, which
is a major version with breaking changes to the data APIs and the router
factory. The brief forbids uncontrolled major upgrades and forbids
`npm audit fix --force`, and both prohibitions are right here: a major router
upgrade in the last hour of a finalisation phase, to close three advisories none
of which the application is exposed to, would be trading a real regression risk
for a theoretical one.

### Recommendation

Schedule the react-router 6 → 7 migration as **its own change**, with its own
test run, in Phase 10 or later. It is not urgent and it is not free.

**A regression guard is cheap and worth adding with the migration**, not
before: an assertion that no navigation target in `portal/src` is a non-literal
expression. `tests/portal.spec.ts` already carries the sibling check for `href`
(`no link is built from a stored value without a fixed scheme`), which is the
same idea applied to the same class of bug and which found a real vulnerability
when it was written.

---

## 3. Secret scan

`npm run scan:secrets` — 546 files, 12 rules, **clean**.

Five rules were added in this phase, and the ordering matters: they were added
**before** the credentials they look for exist. A scanner written after a leak is
a scanner whose first run certifies the leak as clean.

| New rule | Looks for | Why now |
|---|---|---|
| `google-service-account` | `"type": "service_account"`, `"private_key_id"` | The Portal's Analytics Data API integration will be authenticated by a service-account JSON. The PEM block was already caught; the JSON wrapper is how the key actually arrives from Google |
| `supabase-secret-key` | `sb_secret_…` | The current Supabase secret-key model. It is not a JWT, so the existing `jwt` rule does not see it |
| `netlify-token` | `nfp_…` | A Netlify personal access token |
| `database-url` | `postgres://user:pass@…` and the mysql/mongodb equivalents | A connection string with credentials in it. A bare `postgres://host` is not a secret and is not flagged |
| `vcs-token` | `ghp_…`, `github_pat_…`, `glpat-…` | Version-control access tokens |

Pre-existing rules: the published Web3Forms key and endpoint, `access_key`,
`service_role`, JWT literals, PEM private keys, AWS access key ids.

### What is and is not a secret here

| Value | Classification | Where it may appear |
|---|---|---|
| GA4 **Measurement ID** `G-JZD43PHJ41` | **Not a secret.** A public identifier that ships in the page by design | `_build/build.py`, every generated page. Its safety comes from the host allow-list, not from concealment |
| GA4 **Property ID** `15392224433` | **Not a secret**, but server-side/documentation-only by policy | `.env.example`, a comment in `_build/build.py`, `phase9-event-taxonomy.md`. **Verified absent from `dist/`** |
| Google service-account **private key** | **Secret** | Nowhere in this repository, now scanned for |
| Supabase **anon key** | Public by design; RLS is the control | Portal bundle |
| Supabase **secret / service-role key** | **Secret** | Netlify function environment only. Asserted absent from the portal bundle by `the bundle contains no service role key` |
| `IP_HASH_SALT` | **Secret** | Netlify function environment only |

**No `.env` file exists in the repository**; `.env.example` carries placeholders
only. Its `VITE_SITE_URL` example named `https://media-stratos.com` — the Wix
site this project replaces, and the exact value that was once hardcoded into
every canonical here. Corrected to `https://stratosweb.hu`, because an example
is a thing people copy.

**No secret value is printed anywhere in this report**, per the brief. Findings
would be reported as type, location class and remediation status; there are
none.

---

## 4. Summary

| Item | Status |
|---|---|
| Direct dependencies reviewed | 18 production, 16 dev, across three manifests |
| Unused dependencies | **0** |
| Deprecated packages | **0** |
| Genuine duplicates | **0** (the shared React/Vite/TypeScript versions across two independent applications are deliberate and identical) |
| Vulnerabilities | 3 moderate, all `react-router`, **none applicable** — analysed per advisory in §2 |
| `npm audit fix --force` | **not run** |
| Major upgrades performed | **none** |
| Lockfiles | 3, committed, current, `npm ci`-installed |
| Runtime compatibility | Node 22, pinned, load-bearing |
| Secret scan | **clean** — 546 files, 12 rules |
| Secrets in the repository | **none** |

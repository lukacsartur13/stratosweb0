# Phase 9 — continuation baseline

Recorded before any Phase 9 edit, so that every later claim in this phase can be
measured against a state that actually existed rather than one that was assumed.

Everything below is observed: from the working tree, from `dist/`, or from a
live probe of the deployed site. Where a number is derived rather than counted,
the derivation is shown.

---

## 1. Branch and source safety

| | |
|---|---|
| Branch created | `phase-9-conversion-seo-production-finalisation` |
| Branched from | `main` |
| Baseline commit | `ad798d7` — *feat: integrate homepage navigation and arrival footer* |
| `main` vs `origin/main` | 0 ahead, 0 behind — exactly in sync |
| Phase 8.5 commit present | Yes |
| Commits rewritten | None. No reset, rebase, squash or amend was performed. |

### Working-tree state inherited from Phase 8.5

The tree was **not** clean at the start of Phase 9. Per the Phase 9 brief §3 the
branch was not created until the contents had been identified and reported, and
nothing was discarded without an explicit decision.

**No source code was modified.** Every uncommitted path was a generated report,
a throwaway probe script, a local settings file, or a build cache. Nothing under
the site source, `netlify/`, `supabase/`, `portal/src`, `scripts/`, `_build/pages`
or `tests/` was touched.

| Path | State | Disposition |
|---|---|---|
| `_build/reports/content-baseline.json` | modified | **Kept.** The working version is a strictly more complete run — 66 routes vs the committed 33. It is the source of the CTA and form counts in §5 below. |
| `_build/reports/phase8-route-audit.json` | modified | **Reverted to `HEAD`.** The working copy was a narrower re-run: 2 viewports / 132 checks, against the committed 12 viewports / 792 checks. Both reported 0 failing. Keeping the working copy would have destroyed audit coverage. The reverted file is preserved out-of-tree. |
| `_build/reports/phase8-route-matrix.json` | modified | Kept. Same content, later timestamp only. |
| `portal/tsconfig.app.tsbuildinfo` | modified | Machine-specific TypeScript incremental cache. Tracked today; a candidate for untracking. |
| `.claude/settings.local.json` | modified | Local tool-permission allowlist. Personal, not project state. |
| `experiments/.tmp-edges.mjs` | deleted | **Restored.** One of 20 tracked throwaway probes. |
| 66 × `experiments/.tmp-*` | untracked | 292 KB of Phase 7/8.5 probe scripts. Left in place. |
| 59 × `_build/reports/**` | untracked | **246.7 MB** of review screenshots and baselines. Left on disk; must not be committed wholesale. |

---

## 2. Route and indexability inventory

Counted from `dist/`, excluding `dist/portal/**` and excluding iCloud `" 2."`
duplicates.

| Metric | Count |
|---|---|
| Public HTML pages | **69** |
| — generated routes (`_build/routes.json`) | 66 |
| — homepage shells (built separately by `build:home`) | 3 |
| Locales | 3 — `hu` (root), `en/`, `de/` |
| Indexable routes | **60** |
| `noindex` routes | **9** |
| Sitemap `<url>` entries | **60** |

The three numbers reconcile exactly: 69 − 9 = 60 = sitemap entries. There is no
page that is indexable but absent from the sitemap, and none listed in the
sitemap that carries `noindex`.

### The 9 `noindex` routes

All nine are case studies, three projects × three locales, carrying
`<meta name="robots" content="noindex, follow">`:

```
dist/munka-rapidkert.html      dist/en/work-rapidkert.html      dist/de/projekt-rapidkert.html
dist/munka-barbershop.html     dist/en/work-barbershop.html     dist/de/projekt-barbershop.html
dist/munka-mentaltrening.html  dist/en/work-mentaltrening.html  dist/de/projekt-mentaltrening.html
```

This is deliberate and correct. `CASE_STATUS` in `_build/build.py` marks all
three projects `summary` rather than `full`; `summary` means reachable and
linked but not promoted — no sitemap entry, `noindex, follow`, and no
"read the full case study" call to action. `follow` preserves outbound link
equity. Promoting a project later is a one-word edit in `CASE_STATUS`.

**Phase 9 must not create full-case-study CTAs for any of these nine routes.**

---

## 3. Redirect inventory

Four redirects, all in `netlify.toml`, none of them content redirects:

| From | To | Status | Purpose |
|---|---|---|---|
| `/portal/*` | `/portal/index.html` | 200 | SPA shell rewrite |
| `/portal` | `/portal/index.html` | 200 | bare-path convenience |
| `/login` | `/portal/login` | 302 | legacy guess |
| `/dashboard/*` | `/portal/` | 302 | legacy guess |

No locale redirects, no legacy-URL redirects, no `www`/apex normalisation in
`netlify.toml` — the latter is handled at DNS/Netlify level, not in config.

---

## 4. Structured data

**None.** Zero occurrences of `application/ld+json` or `schema.org` in the
generator, in any template, in any source file, or anywhere in built `dist/`
output.

This is a clean greenfield for Phase 9 — there is no existing structured data to
migrate, reconcile or contradict.

---

## 5. Conversion surface

From `_build/reports/content-baseline.json`, regenerated across all 66 routes:

| Metric | Count |
|---|---|
| Routes measured | 66 |
| Sections | 453 |
| Meaningful words | **41,017** |
| Images | 102 |
| CTAs | **225** |
| Forms | **9** |

The 41,017 figure supersedes the ~40,302 quoted in the Phase 9 brief; the brief's
number predates the final Phase 8.5 copy.

### Form inventory

Four form *types* are declared in `netlify/functions/lead-contract.mjs`, all
posting to the single canonical endpoint `POST /api/lead`:

| Form type | Required fields | Consent field |
|---|---|---|
| `newsletter` | `email` | — |
| `contact` | `vezeteknev`, `keresztnev`, `email`, `telefon`, `ceg`, `megjegyzes` | `adatvedelem_elfogadva` (required), `hirlevel` (optional) |
| `impact` | `org`, `kapcs`, `mail`, `terulet`, `mivel`, `hatas`, `miert` | `adatkezeles_elfogadva` (required) |
| `questionnaire` | `cegnev`, `email` + branch fields | — |

The count of 9 in the table above is the three substantive forms
(`contact`, `impact`, `questionnaire`) × three locales. The `newsletter` form is
additionally embedded in the footer of essentially every route, which is why it
is not counted per-route.

Schemas are closed: a field name the schema does not declare is dropped before
storage. Honeypot protection and idempotency (a unique index in
`20260805000100_lead_envelope.sql`) are in place.

---

## 6. Analytics, cookies and storage — current state

This is the most consequential section for Workstreams B and C, because the
answer in every case is *nothing*.

### Analytics scripts

**None.** No Google Analytics, no GTM, no Meta Pixel, no LinkedIn Insight Tag,
no Clarity, no Hotjar, no Plausible, Fathom, Umami, Matomo, PostHog, Segment,
Mixpanel or Amplitude. No Netlify Analytics. No custom or server-side tracking.
No consent script.

The only matches for tracker-like strings in the codebase are:

- outbound `rel="noopener"` social links to LinkedIn / Instagram / Facebook in
  page footers — links, not scripts, loading nothing;
- a rendering metric variable named `clarity` in the experiments harness, which
  is unrelated to Microsoft Clarity.

`VITE_ANALYTICS_ID` **is declared** — in `.env.example`, in `README.md` ("Empty
means no analytics loads") and as an optional key in
`portal/src/vite-env.d.ts`. It is **referenced by no implementation anywhere**.
It is a reserved name with no consumer.

Note also that `VITE_*` variables are compiled into the *portal* Vite bundle. The
public site is static output from `_build/build.py` and is not a Vite build, so
`VITE_ANALYTICS_ID` cannot reach the public site as currently defined. Any Phase 9
adapter for the public site needs its own configuration route.

### Cookies

**Zero.** Confirmed two ways: no `document.cookie` write anywhere in the public
site source, and a live probe of the deployed homepage returns **no `Set-Cookie`
header at all**.

### Local / session storage

**Zero on the public site.** No `localStorage`, `sessionStorage` or `indexedDB`
use in `assets/`, `_build/`, `scripts/` or `netlify/`.

The **portal only** persists a Supabase auth session — `portal/src/lib/supabase.ts`
sets `persistSession: true`, which uses `localStorage`. This is strictly-necessary
authentication state on a private, `noindex, nofollow, noarchive`, `no-store`
route. It is not analytics and not a consent-requiring cookie.

### Consequence

Because the site currently sets no cookies and no storage, **no consent banner is
legally required today**. Any Phase 9 measurement decision that introduces
cookies or device storage changes that answer and pulls consent infrastructure
into scope. A measurement design that stays cookieless keeps the current, clean
position — this should be treated as a deliberate constraint, not an accident.

---

## 7. Security headers

Set in `netlify.toml` and **verified live** on the deployed site.

| Header | Value |
|---|---|
| `content-security-policy` | `default-src 'self'; script-src 'self'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob: https://*.supabase.co; connect-src 'self' https://*.supabase.co wss://*.supabase.co; form-action 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'; upgrade-insecure-requests` |
| `strict-transport-security` | `max-age=31536000; includeSubDomains; preload` |
| `x-frame-options` | `DENY` |
| `x-content-type-options` | `nosniff` |
| `referrer-policy` | `strict-origin-when-cross-origin` |
| `permissions-policy` | `camera=(), microphone=(), geolocation=(), interest-cohort=(), payment=()` |
| `cross-origin-opener-policy` | `same-origin` |

Route-scoped policy: `/portal/*` is `no-store, must-revalidate` +
`X-Robots-Tag: noindex, nofollow, noarchive`; `/api/*` is `no-store` +
`X-Robots-Tag: noindex`; `/portal/assets/*` and `/assets/*` are cached.

### The CSP is the binding constraint on Workstream C

`script-src 'self'` — no CDN, no inline script, no `eval`. There is no
`'unsafe-inline'` on `script-src`, and `connect-src` allows only `'self'` and
Supabase.

**No third-party analytics provider can load or transmit under this policy
without widening it.** That is not a defect; it is the current, deliberate
posture, achieved and documented over earlier phases. Phase 9 must therefore
either keep measurement first-party and same-origin, or make CSP widening an
explicit, argued decision rather than a side effect.

---

## 8. Deployment reality — the principal production blocker

The live probe found that the intended production domain is **not serving this
site**.

| Host | Serves | Evidence |
|---|---|---|
| `https://www.stratosweb.hu/` | **the old Wix site** | `server: Pepyaka`; `x-wix-request-id`; preconnects to `static.parastorage.com` / `static.wixstatic.com`; Wix-generated `robots.txt` ("go to SEO Tools > Robots.txt Editor"); `Disallow: *?lightbox=`; `Set-Cookie: ssr-caching=…`, `sec-fetch-unsupported=1`; **none** of the Stratos security headers |
| `https://stratosweb.hu/` | → 301 → `www.stratosweb.hu` | same Wix site |
| `https://media-stratos.com/` | → 301 → `www.stratosweb.hu` | same Wix site |
| `https://stratosweb1.netlify.app/` | **the Stratos site** | `server: Netlify`; full CSP and all security headers present; no `Set-Cookie` |

So the domain cutover from Wix to Netlify **has not happened**.

### What follows from that

1. **The Stratos site is currently entirely non-indexable, by design.**
   `isPreviewOrigin()` in `scripts/site-origin.mjs` returns true for any
   `netlify.app` host, so `assemble.mjs` emits a preview `robots.txt`. Verified
   live:

   ```
   # Preview deploy — not the canonical site. See scripts/site-origin.mjs.
   User-agent: *
   Disallow: /
   ```

   This is the correct behaviour — it stops a second crawlable copy competing
   with the real site — but it means **no SEO work in Phase 9 can be validated
   against a live index** until the domain moves.

2. **Every canonical currently points at the preview host.** The live homepage
   emits `<link rel="canonical" href="https://stratosweb1.netlify.app/" />`.
   This is self-correcting: the origin is resolved at build time from
   `SITE_URL` → `VITE_SITE_URL` → Netlify's `URL` → fallback, so attaching the
   custom domain fixes every canonical, `og:url` and sitemap entry in one
   deploy with no source edit. The mechanism is sound; it simply has not been
   triggered yet.

3. The `dist/` in the working tree was built locally and therefore fell through
   to `FALLBACK_ORIGIN`, giving `https://stratosweb.hu` (apex, no `www`) in
   `robots.txt` and the sitemap. Production would resolve `www` from Netlify's
   `URL`. Local `dist/` is not evidence of production output.

4. `.env.example` sets `VITE_SITE_URL=https://media-stratos.com`. Per
   `site-origin.mjs`'s own comment that value is the known-bad origin that
   "has already been wrong once". The example file advertises the stale domain.

5. `README.md` line 7 still names `media-stratos.com` as the site's domain.

Item 8 is an operational blocker for Phase 10, not something Phase 9 can fix in
code. It is recorded here so it is not discovered at launch.

---

## 9. Legal-page factual accuracy — a confirmed defect

Legal routes present, six in total across three locales:

```
adatkezelesi-tajekoztato.html   en/privacy-policy.html   de/datenschutz.html
impresszum.html                 en/imprint.html          de/impressum.html
```

The privacy policy declares data processing that **does not occur**. Verified
identically in all three locales.

| The policy claims | Reality |
|---|---|
| "A weboldal cookie-kat használ" / "The website uses cookies" / "Die Website verwendet Cookies" — for UX, statistics **and marketing** | The site sets **zero** cookies. Confirmed by source audit and by a live probe returning no `Set-Cookie`. |
| Data processor: **Google LLC** — Google Analytics, Search Console, advertising and analytics systems | No Google Analytics. No Google tag of any kind. Nothing Google-owned loads. |
| Data processor: **Meta Platforms Ireland Ltd.** — Facebook, Instagram, **Meta Pixel** | No Meta Pixel. The only Meta-related markup is outbound footer links. |
| Data processor: **Netlify, Inc.** — hosting and Functions | **Accurate.** |
| Data processor: **Supabase Pte. Ltd.** — lead storage and Portal | **Accurate.** |

This is an over-declaration: the policy names three processing activities and a
whole cookie taxonomy that the system does not perform. It is almost certainly
inherited from the pre-rework Wix site, where those trackers did exist.

It matters in both directions. It is inaccurate to the visitor, and it describes
a site that would require a consent banner — which this site does not have, and
correctly does not need. The document and the system disagree, and right now the
document is the one that is wrong.

This is a Workstream-D defect and is in scope for Phase 9 under §2 question 4.

---

## 10. Third-party services and environment

### Third-party services actually in use

| Service | Role |
|---|---|
| Netlify | hosting, build, Functions (`/api/lead`) |
| Supabase | Postgres `leads` table, auth for the private Portal |

Nothing else. No CDN for fonts (Archivo and JetBrains Mono are self-hosted under
`/assets/fonts`), no analytics vendor, no tag manager, no chat widget, no
embedded media.

### Environment variables

| Variable | Scope | Status |
|---|---|---|
| `VITE_SUPABASE_URL` | browser bundle (portal) | required |
| `VITE_SUPABASE_ANON_KEY` | browser bundle (portal) | required |
| `VITE_SITE_URL` | build | optional override; example value is stale |
| `VITE_ANALYTICS_ID` | browser bundle (portal) | **declared, unused** |
| `SUPABASE_URL` | function only | required |
| `SUPABASE_SECRET_KEY` | function only | preferred |
| `SUPABASE_SERVICE_ROLE_KEY` | function only | legacy fallback |
| `IP_HASH_SALT` | function only | required — submitter IPs are hashed, not stored raw |
| `SITE_URL` | build | optional override |
| `URL` | build | set by Netlify |

No `.env` file exists in the repository; `.env.example` carries no real values.
`npm run scan:secrets` exists as a guard.

Note for Workstream E: submitter IP addresses are **hashed with a salt before
storage**, never stored raw. That is already the correct posture and should be
preserved and documented, not changed.

### Dependency state

Root: `@supabase/supabase-js ^2.47.10`; dev `@playwright/test ^1.49.1`.

Portal: React 18.3.1, react-router-dom 6.28.1, react-hook-form 7.54.2, zod
3.24.1, @hookform/resolvers 3.9.1, lucide-react 0.468.0, clsx, tailwind-merge;
dev TypeScript 5.7.2, Vite 6.0.7, Tailwind 3.4.17, PostCSS, autoprefixer.

Deliberately absent: no animation framework, no SPA router on the public site,
no analytics SDK. Node is pinned to 22 in `netlify.toml` because
`@supabase/supabase-js` needs a global `WebSocket`.

### Test totals

143 tests across the five canonical Playwright specs:

| Spec | Tests |
|---|---|
| `tests/lead-endpoint.spec.ts` | 55 |
| `tests/homepage-chrome.spec.ts` | 36 |
| `tests/lead-forms.spec.ts` | 23 |
| `tests/public-site.spec.ts` | 17 |
| `tests/portal.spec.ts` | 12 |
| **Total** | **143** |

(The five `" 2.ts"` duplicates alongside them are iCloud artefacts, gitignored
and not executed.)

---

## 11. Hygiene notes carried into Phase 9

Not defects in the shipped site, but facts that affect how Phase 9 must work:

1. **`netlify/functions/submit-lead 2.mjs` exists on disk.** This is precisely
   the hazard `.gitignore` warns about — a stray duplicate would deploy as a
   second Function. It is gitignored and Netlify builds from git, so production
   is unaffected. It is still sitting in the functions directory.
2. iCloud `" 2."` duplicates exist throughout the tree, including next to
   `netlify.toml`, `package.json` and every Playwright config. All gitignored via
   `* [0-9].*`. `assemble.mjs` filters them from `dist/` for the same reason.
3. `_build/reports/` is a tracked directory now holding 246.7 MB of untracked
   screenshots. A `git add -A` on this branch would commit all of it. Phase 9
   commits must stage explicit paths.
4. 20 `experiments/.tmp-*` probe scripts are tracked; 66 more are untracked.

---

## 12. Where Phase 9 stands before any edit

Answering the six questions in the Phase 9 brief §2, as observed today:

1. **Conversion path** — 225 CTAs across 66 routes exist, but no intent map,
   no primary/secondary hierarchy and no integrity audit. Workstream A.
2. **Measurement** — nothing is measured. No analytics, no event model. The
   greenfield is clean, and the cookieless, CSP-constrained starting position is
   an asset worth keeping. Workstreams B and C.
3. **Crawl and index** — foundations are strong: canonical, Open Graph, Twitter,
   hreflang with `x-default`, a correct 60-entry sitemap, a coherent
   noindex policy. Two gaps: **no structured data at all**, and **the site is
   currently `Disallow: /` because it is on a preview host**.
4. **Legal accuracy** — **confirmed defect.** The privacy policy declares
   Google Analytics, Meta Pixel and a marketing-cookie taxonomy that do not
   exist, in all three locales.
5. **Protection** — strong. Strict CSP, full header set, closed form schemas,
   honeypot, idempotency, salted IP hashing, private `no-store` portal.
6. **Launch readiness** — **blocked by an operational fact outside the code**:
   `www.stratosweb.hu` still serves Wix. Until the domain moves, no SEO or
   measurement work can be validated live.

# Stratos Media

The public site is a climb from 420 m to 30,000 m. The portal is the instrument
panel behind it.

```
media-stratos.com
├── /              static, trilingual (HU · EN · DE), no runtime dependencies
├── /portal/*      React SPA — admin now, client accounts next
└── /api/*         Netlify Functions
```

Two applications, one domain. `ARCHITECTURE.md` explains why it is not one.

> **Szerkesztesz?** A tartalom és a designrendszer magyar leírása:
> [`_build/SZERKESZTES.md`](_build/SZERKESZTES.md).

---

## Running it locally

### Public site

No build step, no dependencies:

```bash
python3 -m http.server 4321
```

Then open <http://localhost:4321>.

Edit content in `_build/pages/*.html` (Hungarian — the source language) and
translations in `_build/i18n/*.json`, then regenerate:

```bash
python3 _build/build.py
```

> Never edit the `.html` files in the repository root, `en/` or `de/` — they are
> generated and will be overwritten.

### Portal

```bash
cp .env.example .env      # fill in your Supabase values
npm --prefix portal install
npm run dev:portal        # http://localhost:5174
```

The portal boots without credentials. Routing, guards, validation and every
empty state work; data screens show "Not connected". That is what makes the
test suite runnable without a live project.

### Everything, as deployed

```bash
npm install
npm run build             # generate → assemble → vite
npm run serve:dist        # http://localhost:4322
```

---

## Environment variables

Copy `.env.example` to `.env`. In production these go in the Netlify UI under
**Site settings → Environment variables**.

| Variable | Where it lives | Notes |
|---|---|---|
| `VITE_SUPABASE_URL` | browser bundle | Public. |
| `VITE_SUPABASE_ANON_KEY` | browser bundle | Public by design — RLS decides what it can do. |
| `VITE_SITE_URL` | browser + build | Canonical origin, used for the sitemap. |
| `GA4_MEASUREMENT_ID` | build only | Optional override. The real ID lives in `_build/build.py`; set this only to point a build at another property. |
| `ANALYTICS_ENDPOINT` | build only | Optional first-party sink. Not the production solution. Must be same-origin. |
| `ANALYTICS_SITE` | build only | Optional. Property identifier echoed on events. |
| `ANALYTICS_CONSENT` | build only | Optional. Redundant under GA4, which forces consent on. |
| `ANALYTICS_DEBUG` | build only | Optional. `1` logs dropped events. |
| `SUPABASE_URL` | functions only | |
| `SUPABASE_SERVICE_ROLE_KEY` | **functions only** | Bypasses RLS entirely. |
| `IP_HASH_SALT` | functions only | Any long random string. |

### Measurement

**Google Analytics 4**, Measurement ID `G-JZD43PHJ41`, through the
provider-neutral adapter in `assets/js/analytics.js`. Three independent gates
have to open before a single byte reaches Google:

1. **Consent.** Basic Consent Mode, strictly: `gtag.js` is not injected until
   the visitor agrees. Refuse, and nothing is loaded and nothing is contacted.
2. **The host allowlist** (`GA4_ALLOWED_HOSTS` in `_build/build.py`) — the two
   real domains and the current Netlify address. A local build, a deploy
   preview or a fork measures nothing, however it is configured.
3. **A Measurement ID.** Removing it disables GA4 everywhere.

Advertising is off and stays off: `ad_storage`, `ad_user_data` and
`ad_personalization` are permanently denied, Google Signals is disabled, and no
advertising host is on the CSP. Traffic from anything other than the two
production domains is marked `staging`, so pre-cutover testing never mixes with
real visitors.

Consent is withdrawable from the footer of every page, and withdrawing deletes
the `_ga` cookies rather than only stopping new ones.

No personal data is ever sent — names, emails, phones, form contents,
questionnaire answers and submission IDs are refused as parameter keys, and the
test suite derives that list from the lead schema so a new form field fails the
build until it is refused too.

The event model is `_build/reports/phase9-event-taxonomy.md`. The Portal's
reporting integration is separate and uses the numeric Property ID with
server-side credentials; that ID must never appear in a browser bundle.

`VITE_ANALYTICS_ID` used to be listed here. It never had an implementation, and
could not have worked: `VITE_*` variables are compiled into the *portal's*
bundle, and the public site is static output from `_build/build.py`.

> Anything prefixed `VITE_` is compiled into JavaScript that ships to browsers.
> **Never** prefix the service role key. A Playwright test asserts it is absent
> from every emitted bundle; if that test fails, rotate the key immediately.

---

## Supabase setup

1. Create a project at [supabase.com](https://supabase.com).
2. Run the migrations, in order, in the SQL editor:
   - `supabase/migrations/20260801000100_schema.sql`
   - `supabase/migrations/20260801000200_rls.sql`
2. **Authentication → Providers**: enable Email. Turn **off** "Enable email
   signups" once your own accounts exist — there is no public registration in
   this product.
3. **Authentication → URL configuration**: set Site URL to your origin and add
   `https://<origin>/portal/reset-password` to the redirect allow-list.
5. Create the first account by signing up through the portal. It lands as
   `client`. Promote it once, in the SQL editor:

   ```sql
   update profiles set role = 'super_admin' where email = 'you@media-stratos.com';
   ```

   There is deliberately no other path to an elevated role. Every later change
   goes through the portal's Users screen.

### Roles

| Role | Reach |
|---|---|
| `super_admin` | Everything, including role management |
| `admin` | Leads, projects, clients, case studies, content |
| `team_member` | Projects they are assigned to |
| `client` | Their own organisation only |

Enforced by RLS, not by the frontend. See `ARCHITECTURE.md`.

---

## Tests

```bash
npm run build         # tests run against dist/, not the source tree
npm test
npm run scan:secrets  # repository-wide, exits 1 on any finding
```

### The full-ascent suite

`npm run test:full` covers the 0–30 000 m journey. It needs a route that a
normal production build does not emit, so run it through:

```bash
npm run validate:full
```

which clears `dist/experiments` and `test-results`, runs the ordinary
production build, then runs `test:full` (which builds the experiment route
itself before invoking Playwright).

It deliberately does *not* clear `experiments/screenshots/` — those are the
accepted art-direction stills, written by `shots-mountains.mjs`, and a test run
is not entitled to delete the evidence a human signed off on.

**The order is the point, and it is not interchangeable.** `scripts/assemble.mjs`
clears every entry in `dist/` except `portal`, so a production build run *after*
`build:full` deletes the route the suite is about to request. `validate:full`
builds production first and the experiment route second.

The experiment route is deliberately not part of `npm run build`: it is
`noindex` development output and does not belong in every production bundle.
That is what makes the dependency easy to forget, so it is enforced rather than
documented — `playwright.full.config.ts` refuses to start its static server
unless `dist/experiments/stratos-ascent-full/index.html` exists, and fails with
the command to run instead of a wall of 404s.

### What each command runs, and what it reported

Three suites, three commands, three different sets of numbers. They are listed
separately because they are not interchangeable and a single headline total for
"the tests" has been wrong here before — the figure this section used to carry,
265 passed / 4 skipped / 0 failed, was recorded before the homepage became the
Meridian ascent and stayed in the README while fifteen assertions in the main
suite were failing against markup that no longer existed.

Every number below is dated and names the command that produced it. Treat a
figure without those two things as unverified.

| Command | Projects | Result |
|---|---|---|
| `npm test` | 6 | 567 passed, 40 skipped, 4 failed — see the note below |
| `npm run validate:full` | 5 | see below |
| `npm run test:experiments` | 1 | the 0–8 000 m prototype, run on demand |

**Baseline date: 6 August 2026**, against the build produced by `npm run build`
on the same day. Re-record both numbers and the date together; a count without
its command and date goes stale silently, which is how the previous one did.

> **The 4 failures are a known, load-dependent flake, not a regression.** They
> are `homepage-chrome.spec.ts` "opens from every header state" and "focus is
> trapped inside the layer while it is open", on the two desktop projects. Each
> passes in isolation, every time, but takes anywhere from 2.4 s to 10.7 s: the
> homepage drives a ~1 MB WebGL bundle, and under full parallel load these
> cross the 30 s test timeout. Verified pre-existing on 6 August 2026 by
> stashing all working changes, rebuilding, and reproducing the same failures at
> `HEAD`. If you need a clean signal, run that spec on its own.

#### `npm test` — the production regression suite

Six projects: `endpoint` (in-process, no browser), 1440×900, 1920×1080,
iPhone 13 (390×844), iPhone 14 Pro Max (430×932), and a reduced-motion pass.
The 10 skips are project-scoped by design — the reduced-motion assertions run
only in their own project, and the scroll-driven altitude tests are skipped
there because that path deliberately has no scroll-driven clock.

#### `npm run validate:full` — the 0–30 000 m journey

Five projects: desktop 1440×900, three phone widths (390×844, 430×932,
375×667) and a reduced-motion pass. Most of its skips are the arithmetic tests,
which assert pure functions and are marked device-independent: they run once, in
the `desktop` project, and are skipped in the other four. A skip count of
roughly four times the number of arithmetic tests is the expected shape, not a
sign that something is not running.

#### What is not covered by any of them

Physical-device validation. Everything above runs in headless Chromium on
SwiftShader — a software rasteriser — or in Playwright's WebKit build. None of
it is evidence about:

- a real mobile GPU's shader compilation, fill rate or precision;
- thermal throttling over a long scroll;
- driver-level VRAM reclamation after a context is dropped;
- iOS Safari's own sticky-positioning and scroll behaviour on a real device.

Those need a device in a hand. They are listed here rather than omitted so the
suite is not read as covering them.

What the suites cover:

- Homepage loads, altitude climbs with scroll and stays inside 0–30 000 m
- No console errors, no sideways scrolling at any width
- All 12 Hungarian pages plus the EN and DE homepages respond with titles and
  descriptions; `hreflang` and `x-default` are present
- Every image declares `alt`
- The hero CTA reaches the questionnaire
- Reduced motion turns the ascent into a readable document with nothing hidden
- Portal boots, is `noindex`, redirects unauthenticated visitors, and refuses
  protected routes
- Sign-in validates before submitting; there is no route to create an account
- Password reset does not reveal whether an address has an account
- A valid submission on every form reaches `/api/lead` with its fields mapped
  into the lead schema, and the success state appears
- Invalid payloads never leave the page; the endpoint rejects them with `422`
- A filled honeypot is answered with the same `200` a real submission gets, and
  never reaches the database
- A submission completed in under three seconds is dropped the same way
- Rapid repeated submissions from one address are rate limited with `429`, and
  one noisy address does not limit anyone else
- Error responses name no column, table or product
- **No emitted asset contains a Web3Forms URL, an `access_key`, or the key that
  was previously exposed**
- **No emitted bundle contains a service role key**
- The journey stage at a given altitude is the same in both scroll directions,
  and the mountain root carries its canonical transform even while hidden
- The mountain range's silhouette is gated on shape, not only on placement —
  see `experiments/silhouette-metrics.mjs`

### The Phase 5 probes

Not part of any suite. They need the dev server, they take minutes rather than
seconds, and each answers one question a pass/fail assertion cannot:

```bash
npm run dev:home                          # serves :5177, in another terminal
node experiments/probe-determinism.mjs    # stage, root transform, settled scroll state
node experiments/probe-geometry.mjs       # what the geometry counter is counting
node experiments/probe-screenshots.mjs    # where the screenshot variation is
node experiments/probe-assets.mjs         # every image decodes, dev and production
node experiments/validate-flatrun.mjs     # the shape gate, against both populations
node experiments/shots-mountains.mjs      # the accepted stills, with their metrics
```

Each exits non-zero on a real failure. `PHASE_5C.md` records what they found.

### Running the authenticated tests

Signed-in behaviour needs a live project and a seeded user, so it is not in the
default run. Point `.env` at a **development** Supabase project, create a user
per role, and drive `page.goto('/portal/login')` with those credentials. Do not
run this against production data.

---

## Deploying

Netlify, from `netlify.toml`:

| | |
|---|---|
| Build | `npm run build` |
| Publish | `dist` |
| Functions | `netlify/functions` |

`/portal/*` is rewritten to the SPA shell so deep links resolve on a cold load.
`/login` redirects to `/portal/login`.

Security headers ship with the build: CSP, HSTS, `X-Content-Type-Options`,
`X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`. The portal is
`no-store` and `noindex`; hashed assets are immutable.

`CLOUDFLARE.md` covers the edge layer: WAF, bot scoring, rate limiting, and —
the one that matters most — **bypassing cache on `/portal*` and `/api/*`**, so
a signed-in response is never served to the next visitor.

---

## Public form security

The previous arrangement put a Web3Forms access key in `assets/js/main.js`,
where anyone could read it and post mail as Stratos, with no validation and no
ceiling on volume. It is gone. **Every** public form — the newsletter fields,
the contact form, the Impact Program application and the questionnaire — now
posts JSON to `POST /api/lead`, which writes to the `leads` table.

| Form | `data-lead` / source | Where |
|---|---|---|
| Newsletter | `newsletter` | footer of every page, plus the home page panel and the blog card |
| Contact | `contact` | `ugyfelszolgalat.html` |
| Impact Program | `impact` | `impact-program.html` |
| Questionnaire | `questionnaire` | `arajanlat.html`, its own wizard script |

Nothing leaves the origin: the CSP already restricts `connect-src` and
`form-action` to `'self'`, so the old third-party POST would be blocked today
even if it came back.

### What the endpoint does

- re-validates everything server-side and caps every field's length
- strips control characters
- drops honeypot fills and sub-3-second submissions, returning `200` either way
  so a bot gets no signal to tune against
- rate limits per IP (per instance — the real ceiling is the Cloudflare rule)
- stores a salted hash of the IP, never the address itself
- returns a generic message on failure; the Postgres error goes to the log
- keeps the service role key server-side; the browser never sees a credential

### What the page does

Client-side validation is a convenience and is **not** trusted. It exists so the
visitor gets an answer without a round trip, and so every reply has a state:

| State | Shown as |
|---|---|
| submitting | button reads "Sending…", `data-state="submitting"` |
| success | thank-you line, form cleared, button stays disabled |
| validation error | the offending field named, nothing sent |
| server error | one generic line and an address to write to |
| rate limited | "wait a minute", the button re-enabled |

Field mapping lives in one place per surface: `MAPPERS` in `assets/js/main.js`
for the three markup forms, `buildLead()` in `_build/pages/arajanlat.html` for
the questionnaire. Anything the `leads` table has no column for travels
labelled inside `message`, so no answer is lost.

Each form carries a hidden `company_website` input (`.hp`). It is the honeypot —
do not remove it, and do not make it visible.

> **Rotate the old key.** It was published in every built bundle for the life of
> the previous arrangement and must be treated as compromised. It also still
> exists inside `_backup/2026-08-01/`, which is gitignored and never deployed —
> `npm run scan:secrets` deliberately skips that folder, so delete the backup
> once you no longer need it.

---

## Blender assets

None. No `.blend` files were created and no GLB is loaded.

The hero instrument, the ridge range, the craft and the globe are SVG, canvas
and a WebGL fragment shader authored in `assets/js/flight.js` and
`assets/css/flight.css`. On this page that is the lighter and more robust
choice: no model download, no decode cost, and the reduced-motion and no-WebGL
fallbacks already work. Adding a Draco-compressed GLB altimeter is a reasonable
future step, but it would replace a working hero with a heavier one, so it was
not done blind.

---

## Known limitations

Named plainly rather than left to be discovered:

1. **The admin is read-only.** Every screen reads through RLS. Creating and
   editing rows is done in the Supabase dashboard for now.
2. **Client portal screens are not built.** Schema, roles and policies are in
   place; a `client` today sees an overview and their projects.
3. **No Three.js or Blender assets.** See above.
4. **No cookie consent banner.** The old site ran Usercentrics. Nothing tracks
   today, so nothing is required — but it is needed before any Google or Meta
   tag goes back on.
5. **Content blocks are not wired to the public site.** The table and policies
   exist; the site still renders content from code. This is the intended
   phase 1.
6. **Blog articles are titles and covers only.** Carried over from the previous
   site's RSS; the bodies were never migrated.
7. **CSP needs `'unsafe-inline'` for styles.** Google Fonts injects an inline
   `<style>` and the ascent writes custom properties to `style` attributes.
   Self-hosting the fonts would remove half the reason.
8. **Some translations are missing.** The build reports 45 untranslated strings
   each for EN and DE; they fall back to Hungarian rather than breaking. See
   `_build/missing-en.json` and `_build/missing-de.json`.
9. **Lead rate limiting is per function instance.** The in-memory window does
   not survive a cold start or coordinate across concurrent instances. The real
   ceiling is the Cloudflare rule in `CLOUDFLARE.md`.
10. **Performance is unmeasured.** No Lighthouse run, no field data. No claim
    is made about frame rate or Core Web Vitals.

---

## Recovering the previous site

A full copy of everything as it stood before this work is in
`_backup/2026-08-01/` — pages, assets, generator and translations. It is
gitignored on purpose: a point-in-time safety net, not history.

---

## Documentation

| File | |
|---|---|
| `ARCHITECTURE.md` | Frontend, 3D, data, auth, RLS, deployment |
| `CONTENT_GUIDE.md` | Voice, typography, headlines, altitude metaphor |
| `CLOUDFLARE.md` | Edge configuration, in the order to apply it |
| `_build/SZERKESZTES.md` | Content authoring and the design system (Hungarian) |
| `supabase/migrations/` | Schema and every RLS policy, commented |

---

## The homepage is a Vite build (2026-08-03)

`/`, `/en/` and `/de/` are the Altimeter Meridian ascent, built by
`npm run build:home` from `experiments/vite.home.config.ts`. The other eleven
pages per language are still generated by `_build/build.py`.

```
npm run build   =  generate (python)      11 pages x 3 languages
                -> build:site (assemble)  dist/ + robots + sitemap
                -> build:home (vite)      dist/{index,en/index,de/index}.html
                -> build:portal (vite)    dist/portal
```

Order matters: `build:site` clears and populates `dist/`, then `build:home`
overwrites the three homepages. `build:home` runs with `emptyOutDir: false` for
exactly that reason.

**One chunk graph, three documents.** The three shells in `experiments/home/`
are separate Rollup inputs that share one bundle, so all three reference the
same `/assets/home/*.js`. Switching language costs one 2.9 kB document and no
JavaScript re-download. The locale reaches the app through `<html lang>`, so it
is correct before any script runs.

**Metadata.** `hreflang` (hu/en/de/x-default) and the per-language title and
description are migrated verbatim from the pages they replace. `rel=canonical`
and Open Graph / Twitter cards are **new** — the previous homepage carried
neither, in any language.

**Translations.** The homepage narrative is Hungarian on all three routes. That
is the pre-existing state, not a regression: `npm run generate` used to report
`45 untranslated` for both `en` and `de` against the old homepage, and it now
reports none, because those 45 strings *were* the old homepage. The layer that
replaces them is `experiments/src/full/i18n.ts`, keyed on the Hungarian source
sentence exactly as `_build/i18n.py` is. `npm run i18n:meridian` writes the
worklist to `_build/missing-meridian-{en,de}.json` — 110 strings today.

Read the "WHAT IS WIRED, AND WHAT IS NOT" note in `i18n.ts` before translating:
the content tables, stage labels and footer are routed through the layer; about
54 strings of narrative prose written directly as JSX are not yet, and closing
that gap is hand work.

**Removed with the old homepage:** `_build/pages/index.html`,
`_build/i18n/index.json`, `assets/css/flight.css`, `assets/js/flight.js`, the
`mode: flight` branch and the HUD chrome in `build.py`. The `SLUGS["index"]`
entry stays — it is how every subpage links home. `experiments/bench.mjs` lost
its old-hero arm; those numbers survive in `CURRENT_HERO_NOTE.md` and the
regression baseline as history, not as a live comparison.

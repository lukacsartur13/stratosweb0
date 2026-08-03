# Architecture

## The shape of the thing, and why

Stratos is **two applications behind one domain**, not one application.

```
media-stratos.com
├── /                 static, generated, trilingual  ← the public site
├── /portal/*         React SPA                      ← private
└── /api/*            Netlify Functions              ← the only public write path
```

This is a deliberate departure from a single React app, and the reasoning matters
more than the diagram.

The public site already existed as 36 pages (12 × 3 languages) generated from a
single Hungarian source by `_build/build.py`, with zero JavaScript dependencies
and zero console errors. Its entire creative concept — a scroll-driven ascent
from 420 m to 30,000 m, with a live altimeter, atmospheric layers and a WebGL sky
— was already built and working. Rebuilding that in React would have meant
discarding a working translation pipeline and reimplementing a bespoke scroll
system, in exchange for a heavier page and a slower first paint. There was no
user-visible gain available.

What genuinely needed a build system was the part that did not exist: an
authenticated product with roles, tables, forms and a database. That is the
portal, and it is React, TypeScript, Vite and Tailwind.

The two never share a runtime. They share a domain, a design language and a set
of colour tokens.

---

## Frontend — public site

| | |
|---|---|
| Source | `_build/pages/*.html` (Hungarian only), `_build/i18n/*.json` |
| Generator | `_build/build.py` — owns `<head>`, header, footer, nav, altimeter |
| Output | `*.html`, `en/*.html`, `de/*.html` |
| Styles | `assets/css/main.css`, `assets/css/flight.css` |
| Behaviour | `assets/js/main.js`, `assets/js/flight.js` |

### The ascent

One number drives everything: altitude. `flight.js` derives it from scroll
position and writes four custom properties once per frame:

| Property | Range | Meaning |
|---|---|---|
| `--alt` | 0…1 | 420 m → 30,000 m, the whole journey |
| `--climb` | 0…1 | 420 m → 8,848 m, the mountain |
| `--fly` | 0…1 | 8,848 m → 30,000 m, the flight |
| `--p` | 0…1 | progress through the current stage |

Every moving part — the sky shader, the ridge parallax, the route line, the
craft, the globe, the instrument readouts — is a pure function of those. Nothing
animates on its own clock. That is why they cannot drift out of sync, and it is
why a stage can declare its own altitude band in markup:

```html
<section class="st" data-from="8848" data-to="9600" data-label="Csúcs">
```

The readout shows 8,848 m exactly when the summit stage is centred. The numbers
on screen are the real structure of the document.

### Atmospheric progression

The sky is a fragment shader (`flight.js`, `skyTop`/`skyBot`). The daylight
window is deliberately short — daylight peaks at `--alt` ≈ 0.14 (~4,500 m) and
the blue is fully drained by 0.55. A real climb loses colour fast, and holding a
bright daytime blue into the upper stages flattens the second half of the page.

Once the blue is gone the atmosphere returns as a **limb**: a thin lit band along
the bottom edge, the air seen edge-on. It keeps a light source in frame without
undoing the darkness the upper stages exist to deliver.

The ridge range fades out by ~12,800 m and sinks fast on `--fly`, because above
the summit you are moving *away* from the ground, not past it.

### Degradation

Three tiers, none of which lose content:

1. **WebGL + motion** — the full ascent.
2. **No WebGL** — `.no-sky` swaps the shader for a CSS gradient; everything else
   still moves.
3. **`prefers-reduced-motion`** — stages stop pinning, all transforms and
   opacity animations are dropped, the page becomes an ordinary readable
   document in order. This path is built in `flight.css`, not bolted on, and is
   asserted by a dedicated Playwright project.

---

## Frontend — portal

```
portal/src/
├── App.tsx                    router, error boundary
├── lib/
│   ├── supabase.ts            client + a stub for credential-free environments
│   ├── permissions.ts         the capability matrix (presentation only)
│   └── useRows.ts             RLS-trusting data reads
├── features/auth/
│   ├── AuthProvider.tsx       session + profile, role read from the DB
│   ├── ProtectedRoute.tsx     route guard (usability, not security)
│   └── pages.tsx              sign in, forgot, reset
├── components/
│   ├── ui/                    button, field, panel, table, states
│   └── layout/AdminLayout.tsx sidebar + accessible mobile drawer
└── pages/screens.tsx          overview, leads, projects, clients, …
```

### The one rule

**`permissions.ts` decides what to draw. The database decides what may be read.**

Every select in `useRows.ts` is unqualified:

```ts
supabase.from('projects').select('*')
```

A client running that gets their own organisation's rows — not because the
frontend remembered a `where`, but because the RLS policy said so. If the
capability matrix and the policies ever disagree, the database wins and the user
sees an empty table rather than someone else's records.

Route guards exist so a signed-out visitor does not see a flash of admin chrome.
They are not a control. The bundle is public and the routes are in it.

---

## Data

```
organizations ──┬── profiles (role, organization_id)
                ├── projects ── project_members ── profiles
                └── media_assets

leads            (written only by the Netlify function)
case_studies     (published rows readable by anon)
content_blocks   (staged CMS)
activity_logs    (append-only)
```

UUID primary keys, `created_at`/`updated_at` on everything mutable via a shared
`set_updated_at()` trigger, indexes on every foreign key and on the columns the
portal actually filters and sorts by.

### Roles

| Role | Reach |
|---|---|
| `super_admin` | Everything, including role management |
| `admin` | Operational data: leads, projects, clients, case studies, content |
| `team_member` | Projects they are assigned to, via `project_members` |
| `client` | Their own organisation only |

`role` lives in `profiles`, **never** in `auth.users.raw_user_meta_data`. User
metadata is writable by the user; a role stored there is a one-line privilege
escalation.

---

## Authorization — RLS

Full policies in `supabase/migrations/20260801000200_rls.sql`. The load-bearing
ones:

**Nobody may change their own role.** `profiles_update_self` lets a user edit
their name and avatar, and its `WITH CHECK` re-reads the stored row to require
that `role` and `organization_id` are unchanged. Without this clause, a `PATCH`
to `/rest/v1/profiles?id=eq.<self>` with `{"role":"super_admin"}` succeeds.

**New users are always `client`.** The `handle_new_user` trigger hardcodes it.
Nothing in the signup path can select a role.

**Leads have no insert policy at all.** The public form does not write from the
browser. The Netlify function writes with the service key, which bypasses RLS —
which is precisely the point, because that is where validation, length caps,
honeypot checks and rate limiting live. An anonymous visitor has no path to the
table.

**`FORCE ROW LEVEL SECURITY`** on `leads`, `profiles` and `activity_logs`, so a
mistake in a `SECURITY DEFINER` function cannot quietly bypass every policy.

The role helpers (`auth_role()`, `is_admin()`, …) are `SECURITY DEFINER` with a
pinned `search_path`. Without that they would be subject to RLS on `profiles` and
recurse while evaluating a policy on `profiles`.

### Bootstrapping

There is no self-service path to an elevated role. Sign the first user up
through the portal — they land as `client` — then run once in the SQL editor:

```sql
update profiles set role = 'super_admin' where email = 'you@media-stratos.com';
```

Every later change goes through the Users screen, gated by
`profiles_admin_write`.

---

## Auth flow

```
visitor → /portal/*
            │
            ├─ no session ──────────────→ /portal/login
            │
            └─ session ─→ read profiles.id = auth.uid()   (via RLS)
                            │
                            ├─ no row ──→ "no profile" state, fails closed
                            └─ role ────→ capability check → screen
                                              │
                                              └─ every query re-checked by RLS
```

Sessions persist in `localStorage` and auto-refresh. PKCE, because the future
Google and Microsoft providers need it.

Auth errors are collapsed to one message. Supabase distinguishes "invalid
credentials" from "user not found"; that distinction is a free account-enumeration
oracle. Password reset always returns the same confirmation for the same reason.

---

## Deployment

```
npm run build
  ├── generate     python3 _build/build.py   →  36 HTML pages in the repo root
  ├── build:site   node scripts/assemble.mjs →  dist/ + robots.txt + sitemap.xml
  └── build:portal vite                      →  dist/portal/
```

`scripts/assemble.mjs` only ever *writes* to `dist/`. The repository root stays a
directly servable site, so `python3 -m http.server 4321` in the project root
works exactly as it did before any of this existed. The authoring loop is
unchanged.

Netlify publishes `dist`, rewrites `/portal/*` to the SPA shell so deep links
resolve, and applies the headers in `netlify.toml`.

### CSP

`script-src 'self'` — no inline scripts, no CDN, no `eval`. The WebGL shaders are
strings passed to `gl.shaderSource`, not scripts, so they are unaffected.

`style-src` needs `'unsafe-inline'`: Google Fonts injects an inline `<style>`,
and the ascent sets per-frame custom properties on element `style` attributes.
Removing it would mean self-hosting the fonts and moving the custom properties to
a stylesheet updated via CSSOM — worth doing, not done.

---

## What is not built

Named plainly so nobody discovers it by surprise:

- **Client portal features** — schema and policies are in place; the screens are
  not. A `client` today sees an overview and their projects.
- **Write paths in the admin** — every screen reads. Creating and editing rows is
  done in the Supabase dashboard for now.
- **Storage buckets** — `media_assets` records exist; bucket policies do not.
- **Content blocks as a CMS** — the table and policies exist and the public site
  does not read from them yet. Phase 1 (static content in code) is intentional.
- **Three.js / Blender GLB assets** — see README, "Known limitations".

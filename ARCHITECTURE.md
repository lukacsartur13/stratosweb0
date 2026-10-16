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
| Generator | `_build/build.py` — owns `<head>`, both shells, header, footer, nav |
| Output | `*.html`, `en/*.html`, `de/*.html` (homepage: `index.html`, `en/index.html`, `de/index.html`) |
| Styles | v2 shell: `assets/css/type.css`, `system.css`, `home.css` · original shell: `type.css`, `chrome.css`, `main.css`, `motion.css`, `transitions.css` |
| Behaviour | v2 shell: `assets/js/shell.js` · original shell: `main.js`, `header.js`, `motion.js`, `transitions.js` · both: `lead.js`, `analytics.js`, `consent.js` |

### Two shells, during a migration

The October 2026 redesign introduced a second shell — light, typography-led,
no altitude instrument — and moved exactly one route onto it, the homepage
(`SHELL_V2_ROUTES` in build.py). The other routes keep the original shell (the
dark flight deck and the altimeter rail) until the new direction is approved;
moving a route is adding its key to that set. Both shells read the same slug
table, the same dictionaries and the same `<head>` builders, so canonical,
hreflang, Open Graph and JSON-LD are identical in kind on either.

The design system is written down in
`_build/reports/stratos-redesign/02-design-system.md`.

### No WebGL

From August to October 2026 the homepage was a React + three.js ascent with a
3D altimeter, built separately by Vite. It was removed in the redesign, with its
models, its Draco decoder and the CSP allowance the decoder needed. The public
site now ships no framework and no canvas; the homepage's scripts are four
deferred files, about 25 KB in total.

### Degradation

The static page is the design. `shell.js` only ever *dims* or *holds back*
elements that are still below the fold, so without it — blocked, failed, or a
reader who asked for `prefers-reduced-motion` — every element is in its final,
visible state, and no information depends on motion or hover.

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
| `super_admin` | Everything except projects, including role management. Projects: only the designated owner |
| `admin` | Operational data: leads, sales, clients, case studies, content — not projects |
| `team_member` | Dashboard, case studies, media — not projects (since the owner lockdown) |
| `client` | Their own organisation record only — not its projects |

**The owner is not a role.** Projects, checkpoints, project costs, links, notes
and log events belong to one designated account (`portal_owner` /
`is_owner()`), which must also be a `super_admin`; no other role reaches them.
The Impact Program — its application pipeline, Impact projects and their
market values — is owner-only on the same terms. See `supabase/OWNER_TRACKER.md`.
So is the document library (phase 3): every project's files in the private
`project-documents` bucket, keyed `<project id>/<document id>`, with
restrictive storage policies no other policy can widen. See `supabase/DOCUMENTS.md`.

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
and the original shell's rail and motion primitives set custom properties on
element `style` attributes.
Removing it would mean self-hosting the fonts and moving the custom properties to
a stylesheet updated via CSSOM — worth doing, not done.

---

## What is not built

Named plainly so nobody discovers it by surprise:

- **Client e-mail from Supabase** — client accounts, the Hungarian client portal,
  sharing and "Nyersanyag leadása" are built (`supabase/CLIENT_PORTAL.md`), but
  an invitation is a link the owner sends by hand; no e-mail is sent.
- **Write paths in the admin** — every screen reads. Creating and editing rows is
  done in the Supabase dashboard for now.
- **Storage for anything but project documents** — the owner's document library
  has its own private bucket and policies (`supabase/DOCUMENTS.md`);
  `media_assets` is an older scaffold with no bucket and no policies.
- **A server-side content check of client uploads** — sizes are checked on the
  server, file contents only in the browser (`supabase/DOCUMENTS.md` §3).
- **Content blocks as a CMS** — the table and policies exist and the public site
  does not read from them yet. Phase 1 (static content in code) is intentional.
- **Three.js / Blender GLB assets** — see README, "Known limitations".

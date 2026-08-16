# Portal P1 — audit of the Portal as it stands

Read before anything was changed. Every path is relative to the repository root
and every line number is against the tree at the start of this phase.

---

## 1. What exists today

### Routes

Declared in `portal/src/App.tsx`, all under the `/portal` basename.

| Path | Screen | Guard | Source |
|---|---|---|---|
| `/login` | sign in | public | `features/auth/pages.tsx` |
| `/forgot-password` | request a reset | public | `features/auth/pages.tsx` |
| `/reset-password` | set a new password | public | `features/auth/pages.tsx` |
| `/` | Command Center | session | `pages/overview.tsx` |
| `/leads` | pipeline + inline detail | `view_leads` | `pages/leads.tsx` |
| `/projects` | project table | `view_projects` | `pages/screens.tsx` |
| `/clients` | organisation table | `view_clients` | `pages/screens.tsx` |
| `/case-studies` | case-study table | `view_case_studies` | `pages/screens.tsx` |
| `/analytics` | GA4 dashboard | `view_analytics` | `pages/analytics.tsx` |
| `/users` | account table | `manage_users` | `pages/screens.tsx` |
| `/activity` | audit log table | `view_activity` | `pages/screens.tsx` |
| `/settings` | account + environment + health | `manage_settings` | `pages/screens.tsx` |
| `*` | 404 inside the shell | session | `pages/screens.tsx` |

There is **no** `/system` route and **no** `/leads/:id` route. System health is a
panel rendered twice — once on the Command Center and once on Settings. Lead
detail is an expanded `<tr>` inside the leads table.

### Layout shell

`components/layout/AdminLayout.tsx`, 151 lines.

- `lg:grid-cols-[240px_1fr]` — a 240 px sidebar, correct width, kept.
- One flat nav list of **nine** items, filtered by capability.
- No command bar. Page-level controls live inside each screen's `PageHead`.
- Mobile: a top bar with a `Menu` button opening a focus-trapped drawer.
  Escape closes it, body scroll is locked, focus moves to the close control.
  This is good and is kept.
- Footer: name/email, role label, sign-out. No environment indicator.

### Shared components

`components/ui/index.tsx` — `Button`, `Field`, `Input`, `Textarea`, `Panel`,
`PanelHeader`, `Badge`, `Skeleton`, `EmptyState`, `ErrorState`, `Table`, `Row`,
`Cell`, `cn`.

`components/charts.tsx` — `TrendChart`, `Meter`, `BarList`, `Funnel`,
`Segmented`, `Delta`, `Stat`. Hand-written SVG; **no chart library**, which is
the right call under the CSP and is kept.

### Typography, spacing, tokens

`portal/tailwind.config.ts` defines colours (`ink`, `deck`, `panel`, `hair`,
`signal`, `chrome`, `paper`, `haze`, `danger`, `good`), three families
(Aboreto / Archivo / JetBrains Mono, self-hosted via `/assets/css/type.css`),
and a four-step radius. `styles.css` adds `.num` and `.label`.

There is no spacing scale beyond Tailwind's default and no surface-level system:
`bg-panel/60` is the only surface, used for every panel, every `Stat` and every
`StageTile` alike.

### Data layer

| Module | Reads | Failure model |
|---|---|---|
| `lib/useRows.ts` | Supabase through RLS, `limit(200)` | `loading / ready / error / unconfigured` |
| `lib/analytics.ts` | `/api/portal-analytics`, one request per screen | `loading / unconfigured / error / ready` |
| `lib/health.ts` | `/api/portal-health` | `loading / error / ready` |
| `lib/leads.ts` | pipeline model, mutations, notes, timeline | per-call error strings |

All three are sound and none of them is rewritten in this phase.

---

## 2. Classification

### Shell and navigation

| Surface | Verdict | Why |
|---|---|---|
| `AdminLayout` grid + skip link | **KEEP** | 240 px sidebar and `min-h-dvh` grid are already right. |
| Mobile drawer (focus trap, Escape, scroll lock) | **KEEP** | Accessible and correct; only its contents change. |
| Nine-item flat nav | **RESTRUCTURE** | Dashboard, Analytics, Leads and System have to read as the products; Projects/Clients/Case studies/Users/Activity/Settings are records and admin, not products, and cannot sit at the same weight. |
| No environment indicator in the sidebar | **RESTRUCTURE** | §4 asks for `● Production` in the footer. The health endpoint already returns `environment`; nothing new is fetched for it. |
| No command bar | **RESTRUCTURE** | Section title, date range and environment currently live inside three different screens' headers at three different weights. |
| Brand lockup `STRATOS · PORTAL` | **RESTYLE** | Correct content, wrong weight — `label` yellow on `PORTAL` competes with the active nav item. |

### Command Center → Dashboard

| Surface | Verdict | Why |
|---|---|---|
| "Good to see you, {name}" greeting | **REMOVE** | The first line of an operating screen should be the section it is, not a salutation. The name stays in the sidebar footer where identity belongs. |
| Four lead `Stat` cards (`overview.tsx:71-85`) | **RESTRUCTURE** | Four floating cards, all leads, no traffic. Becomes two cells of one executive strip. |
| Five traffic `Stat` cards (`overview.tsx:148-170`) | **RESTRUCTURE** | A second, visually identical row of floating cards below the first. Nine KPI cards in two disconnected rows is the single largest hierarchy failure on the screen. |
| Pipeline panel, six bordered count tiles | **MOVE** | This is the Leads page's status summary strip (§26). It answers "who needs action", not "what is happening now". |
| "Latest enquiries" table | **KEEP / RESTYLE** | Right idea, right place. Rows become clickable to Lead Detail; `Interest` drops for `Source`. |
| "Strongest sources" BarList | **RESTRUCTURE** | Becomes the Acquisition table (§14) with SOURCE / SESSIONS / LEADS / CVR rather than a bar list. |
| `SystemHealth` panel, full four-service readout | **RESTRUCTURE** | §18: the Dashboard gets one status line. The full readout moves to `/system`. |
| `liveProjects` count in the enquiries header | **REMOVE** | An unrelated number in another panel's header — the exact "collection of unrelated cards" failure. Projects keeps its own screen. |
| Conversion funnel | **MISSING** | Not on the Dashboard at all today. §12 requires it. |
| Realtime | **RESTRUCTURE** | Present only as one `Stat` labelled "Active now". §11 requires a distinct LIVE panel with the pages being viewed. |
| Needs attention | **MISSING** | §17. Nothing on the screen tells the operator what to do. |

### Analytics

| Surface | Verdict | Why |
|---|---|---|
| One request for the whole screen (`useAnalytics`) | **KEEP** | Correct and deliberate; documented in `lib/analytics.ts`. |
| `NotConnected` setup screen | **KEEP** | Exactly the "NOT CONFIGURED" state §41 asks for, and it already names only variable names. |
| Eight KPI `Stat` cards | **RESTRUCTURE** | Same floating-card problem as the Dashboard. Becomes one Overview strip. |
| Realtime panel | **MOVE** | Realtime is a Dashboard question ("is anyone live now"). Analytics is retrospective. It stays reachable but is no longer Analytics' second section. |
| Trend panel + metric `Segmented` | **KEEP / RESTYLE** | The chart is good. It becomes the TRAFFIC section under a section header. |
| Acquisition table | **KEEP / RESTYLE** | Already a dense table with the right columns. |
| Funnel panel | **RESTYLE** | §13: less bar, more editorial. The honesty note under it is kept verbatim. |
| Devices panel | **MOVE** | Becomes the AUDIENCE section (§25) rather than a card wedged beside the funnel. |
| Pages / Landing tabs | **KEEP** | Already the CONTENT section §23 describes. |
| Measurement note | **KEEP** | Non-negotiable honesty about consented measurement. |
| No section structure | **RESTRUCTURE** | Nine panels in a mosaic. §19 requires OVERVIEW / TRAFFIC / ACQUISITION / CONTENT / CONVERSION / AUDIENCE. |
| No comparison toggle | **RESTRUCTURE** | The payload already carries `overview.previous`; the screen only ever shows it as a delta. |

### Leads

| Surface | Verdict | Why |
|---|---|---|
| `useLeadFilter` (search, stage, sort) | **KEEP** | In-browser over ≤200 rows, correct. |
| Seven `StageTile` buttons | **RESTYLE** | Correct behaviour, wrong surface — seven separate bordered cards become one status strip. |
| Main table | **KEEP / RESTRUCTURE** | Stays the primary object. Rows become links; the `Open`/`Hide` column goes. |
| Inline expanded `<tr>` detail | **MOVE** | §29 requires a 12-column detail surface. A `colSpan` row inside a scrolling table cannot be one — the `w-0 min-w-full` hack in `leads.tsx:328` exists precisely because it was fighting the table's width algorithm. |
| "Where they came from" facet panel | **MOVE** | Lead attribution is analysis, not work. Belongs on Analytics' acquisition section as the Portal-side measure; the Leads page keeps `source` as a table column and a filter. |
| No source / locale / form filters | **RESTRUCTURE** | §27 asks for them; the data is already on every row. |

### System / Settings

| Surface | Verdict | Why |
|---|---|---|
| `SystemHealth` rendered on Overview *and* Settings | **DUPLICATED** | Same component, two screens, and now a third place would want it. One `/system` page owns it. |
| Settings "This account" | **KEEP** | Real account data, real place for it. |
| Settings "Environment" (Supabase / Origin / service-key note) | **MOVE** | Diagnostics. Belongs on `/system`. |
| No `/system` route | **RESTRUCTURE** | §30. |

### Records screens

| Surface | Verdict | Why |
|---|---|---|
| Projects, Clients, Case studies, Users, Activity | **KEEP / MOVE** | All five read real tables through real RLS policies and all five work. §1 forbids removing working functionality, so none is deleted — they move out of the primary nav into a subordinate group so the four products read as the products. |
| `DataPanel` in `screens.tsx` | **KEEP** | Already the single place that decides skeleton / error / empty / table. Renamed and shared rather than replaced. |

---

## 3. The hierarchy problems, stated plainly

1. **Nine KPI cards in two identical rows.** The Command Center opens with four
   lead cards and then five traffic cards, at the same size, weight and surface.
   Nothing on the screen says which of the nine matters.
2. **Every piece of data is its own card.** `Stat`, `StageTile` and the pipeline
   tiles each carry `border-hair` + `bg-panel/60` + `shadow-panel`. On the
   Command Center that is fifteen bordered rectangles before the first table.
3. **One surface level.** `bg-panel/60` is the page's only surface, so a section
   and a single figure inside it are drawn identically and depth carries no
   meaning.
4. **System health is on three screens.** Overview, Settings, and (correctly)
   wanted on a System page that does not exist.
5. **Analytics and the Dashboard answer the same question twice.** Both show
   users/sessions/views/lead-rate at the top, from the same endpoint, in the same
   component, at two different ranges — and neither says which is the one to
   read.
6. **Lead detail is inside the table it belongs to.** Forty fields in a
   `colSpan` cell, with a documented width hack holding the layout together.
7. **Nothing tells the operator what to do.** There is no attention surface: a
   lead sitting at New for four days looks exactly like one that arrived a
   minute ago.
8. **Realtime is a number in a row of nine.** The one genuinely live signal on
   the screen has no more weight than "Leads, 30 days".
9. **Yellow is not scarce.** `text-signal` is on the "Leads today" figure, the
   "Active now" figure, the funnel's last bar, every non-zero lead count in
   three tables, the 404 and the nav's active icon.
10. **No global chrome.** Range and environment selectors exist only on
    Analytics, inside its page header, so they read as page furniture rather
    than as application controls.

---

## 4. What must not change

Recorded here so the rebuild is measured against it.

- Supabase auth, `ProtectedRoute`, and the capability matrix in
  `lib/permissions.ts`.
- Server-only Google credentials. The bundle carries no Google identifier; the
  suite asserts it (`tests/portal-analytics.spec.ts`).
- The health endpoint's structural guarantee: booleans, enums and variable
  names, never a value.
- RLS as the only authority on what can be read; `useRows` stays unqualified.
- Every stored value rendered as a text node. No `dangerouslySetInnerHTML`, no
  dynamic `href` without a literal scheme, `safeUrl` for stored addresses.
- Self-hosted fonts. No Google Fonts link returns.
- One horizontal scroller, `Table`, and nothing else.
- The public site: homepage, mobile Altimeter, typography, navigation, history
  restoration and scroll architecture are untouched by this phase.

---

## 5. Decisions taken before writing code

**Clients stays out of the primary nav.** §2 reserves Clients for actual client
records. `organizations` is a real table with real policies and the screen reads
it — but it is an organisation list, not a client product: there is no client
account, no client-visible surface and no client workflow. It therefore keeps
its screen in the records group and does not become a fifth product.

**Projects, Case studies, Users, Activity and Settings keep their routes.** §3
says not to *add* them to the primary navigation, and they are not added. §1
says not to remove working functionality, and they are not removed. They sit
under a divider, at a lower weight, below the four products.

**Lead Detail becomes a route.** `/leads/:id`. This is the one structural change
that goes beyond restyling, and §29's 12-column split cannot be built inside a
`colSpan` cell of a horizontally scrolling table.

**No backend contract changes.** Every number on every rebuilt screen comes from
`/api/portal-analytics`, `/api/portal-health` or Supabase exactly as they answer
today.

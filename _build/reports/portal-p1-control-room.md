# Portal P1 — Control Room

The Portal's first dedicated information-architecture and design-system phase.
Nothing in it adds a feature; all of it decides what the features already there
mean, in what order they are read, and what they look like when there is nothing
to show.

The surface-by-surface audit that preceded any code is
`_build/reports/portal-p1/current-ui-audit.md`. The captures are in
`_build/reports/portal-p1/review/` — every one of them mock data, banner and all.

---

## Before

### The information-architecture problems

**Nine KPI cards in two identical rows.** The Command Center opened with four
lead cards and then five traffic cards, at the same size, weight and surface.
Nothing on the screen said which of the nine mattered, so all nine were read at
the same speed — which is to say none of them was.

**Every piece of data was its own card.** `Stat`, `StageTile` and the pipeline
tiles each carried `border-hair` + `bg-panel/60` + `shadow-panel`. The Command
Center drew fifteen bordered rectangles before the first table.

**One surface level.** `bg-panel/60` was the whole product's only surface, so a
section and a single figure inside it were drawn identically. Depth carried no
meaning, which is the same as having no depth.

**Duplicated information.**

| Fact | Drawn on |
|---|---|
| System health, all four services | Command Center **and** Settings |
| Users / sessions / views / lead rate | Command Center **and** Analytics, at two different ranges, from the same endpoint |
| Lead attribution | Command Center ("Strongest sources") **and** Leads ("Where they came from") |
| Lead counts | Command Center (four cards) **and** Leads (seven tiles) |

**Mixed responsibilities.** The Dashboard held a full status page. Leads held an
attribution study. Settings held infrastructure diagnostics. Analytics held
realtime. None of the four screens answered one question.

**Lead detail lived inside the table it belonged to.** Forty fields in a
`colSpan` cell, held together by a documented `w-0 min-w-full` hack whose only
job was to remove the cell from the table's width calculation — because without
it the expanded row pushed the table ~500px past its own scroll container.

**Nothing said what to do.** There was no attention surface. A lead sitting at
New for four days looked exactly like one that had arrived a minute ago.

**Yellow was not scarce.** `text-signal` was on "Leads today", "Active now", the
funnel's last bar, every non-zero lead count in three tables, the 404 and the
active nav icon.

**No application chrome.** The range and environment selectors existed only
inside Analytics' page header, so they read as that page's furniture rather than
as global state — and the Dashboard, hard-wired to seven days, silently
disagreed with whatever Analytics was showing.

---

## The new information architecture

```
Dashboard   decisions      what is happening right now
Analytics   analysis       what happened, and why
Leads       work           who needs action
System      diagnostics    is the infrastructure up
```

Four products, in the sidebar's primary group, in that order. Under a divider, a
subordinate **Records** group: Projects, Clients, Case studies, Users, Activity,
Settings — six screens that read real tables through real RLS policies, that all
work, and that are none of the four questions.

Two decisions worth stating outright.

**Clients is not a fifth product.** `organizations` is a real table and the
screen reads it, but an organisation list is not a client portal: there is no
client account, no client-facing surface and no client workflow. A top-level
Clients item today would be a promise the product cannot keep.

**Nothing was deleted.** Projects, Case studies, Users, Activity and Settings
were not added to the primary navigation and were not removed from the product.
Removing a working screen because its presentation changed would have been the
wrong trade; drawing it at the same weight as Leads was the problem, and weight
is what changed.

### The shell

- **Sidebar**, 228px, persistent on desktop, `position: sticky` at full height.
  Brand lockup, four products, a divider, six records, then environment ·
  identity · sign out.
- **Command bar**, 56px minimum, sticky. The page's `<h1>` on the left; the
  period and the deployment on the right, on the two screens they apply to; one
  Refresh.
- **Main grid**, twelve columns at every width, 16px gutters. Children declare
  `col-span-12 lg:col-span-8`; the grid never changes shape underneath them.

The period, the deployment and the refresh generation live in a `ScopeProvider`
around the shell. That is what stops the Dashboard and Analytics silently
describing different thirty days, and it is why Refresh reloads every panel at
once rather than the one you happen to be looking at.

**No "Custom" date range was added.** `/api/portal-analytics` accepts four
ranges and nothing else. A custom picker would be a control the endpoint cannot
honour; adding it is a backend change and belongs in a phase that documents it
first.

---

## The Dashboard

Six sections, fixed order, business state → website activity → acquisition and
conversion → operational work → required action → infrastructure.

### 01 — Executive summary

One surface. A common background, hairline dividers, one baseline, five cells:

```
ACTIVE USERS   SESSIONS   LEADS   CONVERSION   REALTIME
```

Every figure is real. Active users, sessions and conversion come from GA4 for
the selected period; **Leads is counted by the Portal from its own rows** over
the same window, and says so; Realtime is the GA4 realtime report and is the one
figure allowed to be yellow, because it is the only one that is true *now*
rather than true for a period.

Pipeline value is not on the strip. There is no opportunity-value system in this
product, and a fifth figure invented to fill a slot is a figure somebody
eventually acts on.

A role without `view_analytics` sees a two-cell strip — Leads and Unanswered —
and the analytics requests are never made, because a 403 rendered as an error is
a screen telling somebody they are broken when they are simply not an admin.

### 02 — Traffic pulse (8/12) + Live (4/12)

**Traffic** is one series at a time — Users / Sessions / Views — over the scope's
period. When comparison is on, the previous period is drawn as a **dashed rule at
its mean per interval**, labelled as an average. GA4's Data API returns one
series per request: the previous period has a level in the payload and not a
shape, and drawing a curve nobody measured would have been the easy lie.

**Live** is visually distinct: the count at 4xl in the accent, then the pages
being viewed as a two-column table. When GA4 is not configured it says
`Analytics not configured`, not `0 active`.

### 03 — Conversion path (5/12) + Acquisition (7/12)

The funnel is **editorial, not a graphic**: the count is the largest thing on
each row, the stage name sits under it in the section face, and the step
conversion lives in the gap *between* two stages, because that is a property of
the step and not of either stage. A 1px rule carries share-of-entry for anyone
who wants the shape.

Stages are the five the event taxonomy genuinely collects — Sessions, CTA
interaction, Form started, Form submitted, Lead confirmed. No checkout, no
booking, no purchase. The note that stages after the first are *event counts, not
unique users* is kept verbatim.

Acquisition is a dense table: SOURCE / SESSIONS / LEADS / CVR, from GA4's own
session-scoped attribution. When GA4 is unavailable it falls back to the
Portal's own attribution — the UTM parameters each lead submitted — labelled as
that, **with no conversion rate**, because a CVR built by dividing Supabase lead
rows by GA4 sessions is a number with no meaning presented at two decimals.

### 04 — Recent leads

A table, not cards. TIME / COMPANY · CONTACT / SOURCE / FORM / STATUS. Rows are
clickable and each carries a real link in its second cell — the click is the
enhancement, the anchor is what a keyboard reaches, a screen reader announces and
a middle click opens. `View all leads →` top right.

### 05 — Needs attention

Derived conditions only:

- new leads that have waited more than a day
- proposals out for more than a week
- analytics not configured, or unavailable
- a service the health endpoint reports as unconfigured, degraded or unreachable
- notifications off

Urgent first. Nothing else — no invoice, no deadline, no missing asset, because
none of those has a source of truth here. When there is nothing:
`Nothing requires attention.` on one line, not a green success panel.

> A real bug was found and fixed here during the visual review: an unconfigured
> GA4 produced both an analytics item and a health item, both keyed `ga4`, so
> React rendered one of them twice and the heading's count disagreed with the
> list. The keys are now namespaced and `scripts/portal-shots.mjs` asserts that
> the count and the list agree.

### 06 — System status

One line. `● All systems operational` or `● N systems require attention`,
linking to `/system`. The Dashboard draws no per-service row at all.

---

## Analytics

Six sections down the page, with a jump list and one comparison toggle:

`Overview · Traffic · Acquisition · Content · Conversion · Audience`

Section headings sit **outside** the panels, above a rule. That is the whole
difference between "six sections" and "nine cards": a title above a rule says the
things under it belong together; a title inside a bordered box says only that the
box has a name.

- **Overview** — one six-cell strip, same primitive as the Dashboard's.
- **Traffic** — the large time series, metric switch, comparison baseline.
- **Acquisition** — Source/medium and Campaign as two genuine aggregations of
  the same rows. Engagement is re-weighted by sessions before it is summed;
  averaging the rates would give a two-session row the same say as a
  two-thousand-session one.
- **Content** — Top pages / Landing pages as tabs of one section.
- **Conversion** — the funnel *beside the raw event counts that produced it*.
  That pairing is the point: the Dashboard says conversion moved, this says which
  event moved, which is the only form of the answer anybody can act on.
- **Audience** — device only. Country and locale are absent for the same reason
  they are absent from the endpoint: they are not in the report, and adding them
  is a backend change with a privacy question attached, not a layout decision.

Realtime is **not** on Analytics. "Is anyone on the site right now" is a
decision-making question and it lives on the Dashboard.

---

## Leads

**Status strip** — one bounded surface, seven cells (All + six stages), real
counts, each a toggle with `aria-pressed`.

**One control row** — search, date, form, source, locale, sort, and a Clear that
appears only when something is narrowed. Every option list is built from the
values the rows actually carry; a Source menu offering `linkedin` when no lead
ever came from LinkedIn is a menu that teaches the operator to distrust it.

**One table** — DATE / COMPANY · PERSON / FORM / SOURCE / STATUS / LOCALE, sticky
head. Status is a 4px marker plus text emphasis rather than six bright colours;
colour is spent only on the two ends of the pipeline and on `new`, which is the
one status that is a request for action rather than a description of one.

`/leads?status=new` is how the Dashboard's attention items arrive, read once as
the filter's initial value.

**Lead detail is now `/leads/:id`** — the one structural change in this phase
that goes beyond presentation. It buys a URL somebody can send to a colleague, a
back button that means something, and the 8/4 split the screen actually wants:
the enquiry, the answers and the activity at reading width on the left; stage,
origin and the remaining metadata in a column on the right that never competes
with it. The `w-0 min-w-full` hack is gone with the accordion that needed it.

Everything unrecognised in `meta` still renders under its raw key. That property
is unchanged and still asserted.

---

## System

Supabase · Lead API · GA4 Data API · Notifications, one state each; deploy
context; whether this bundle is configured; and the standing fact that the
service role key is server-only.

Booleans, enums and variable **names**. The suite asserts this on the response
*type* rather than on the module: every field of `Health` is a boolean, a
`ServiceState`, a `string[]` of variable names, or one of four enumerated
strings — so no render of it can leak a credential, and that is structural
rather than disciplinary.

---

## Design system

### Surfaces — three, and only three

| Level | Token | Used for |
|---|---|---|
| 0 | `ink` `#0B0F16` | the page, flat, no gradient |
| 1 | `deck` `#10161F` | a section |
| 1 raised | `panel` `#141C27` | the executive strip and the status strip |
| 2 | `flare` `rgba(244,244,244,0.055)` | hover, selected, active row, input |

The radial blue wash the page used to carry is gone. The public site opens with
one because it is a horizon; an operating screen is not a horizon, and a coloured
wash behind a dense grid moves every surface's apparent value depending on where
it sits on the page.

Stopping at three is the mechanism: when there is nowhere further to nest,
nesting stops. A section holds data without every figure becoming another card.

### Borders — two hairlines, not one

`hair` (0.10) bounds a section. `hairline` (0.06) separates rows and cells
*inside* one. A table drawn entirely in `hair` reads as twenty stacked boxes
rather than as one table.

### Typography — six levels, defined once

```
.t-page      the section this screen is        13px mono, caps, 0.22em
.t-section   a group of data inside it         10px mono, caps, 0.18em
.t-metric    a figure somebody came here for   28px mono, tabular
.t-row       the subject of a row              13px body
.t-meta      a fact about that subject         11px mono
.t-note      a qualification of either         10px, sentence case
```

Anything that does not fit one of these is a seventh level and should not exist.
All numerals are tabular. Text colour carries **two** levels — `paper` and
`haze` — deliberately: a third, darker grey tested at 3.5:1 against the page,
below the 4.5:1 floor, so hierarchy below `haze` is carried by size and family
instead of by contrast.

`Aboreto` is the **mark and nothing else** — sidebar lockup, mobile bar, drawer
header, sign-in lockup. Four places, all of them the brand, none of them a page
title. The suite enforces the budget. Fonts remain self-hosted; no Google Fonts
link returns.

### Spacing and radius

Tailwind's default scale, used as 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 and not
tuned per component. Two radii: 2px on anything you can press, 4px on anything
that contains something else. Nothing in this product is a rounded card. The
panel shadow is now a 1px inset highlight — depth comes from the three surfaces,
and a drop shadow on every panel is how a dense screen turns into a pile of
floating rectangles.

### Accent

Yellow appears on: the active navigation marker, the realtime figure, the live
count, the last funnel stage, the selected status count, a focused control, and
the focus ring. It was removed from every table's lead column during review —
five yellow numbers in one column is a column, not an accent. The Dashboard's
`text-signal` budget is asserted at four.

### Tables and charts

One `Table` primitive, one horizontal scroller in the product, opt-in sticky
heads, right-aligned numeric columns. One chart system: one axis colour, two
gridlines, one accent, one secondary tone, one empty state — and still **no chart
library**, for the three reasons in `components/charts.tsx`.

### Primitives

`PortalShell`, `CommandBar`, `Grid`, `Panel`, `SectionHeader`, `MetricStrip`,
`MetricCell`, `StatusPill`, `Badge`, `Table`/`Row`/`Cell`, `Select`, `Button`,
`Skeleton`, `DataState`, `NoFigure`, `HealthRow`, plus the four charts.

---

## The four ways of having nothing

This is the contract the phase is proudest of.

| State | Renders as |
|---|---|
| **zero** | `0`, in the metric, at full size, with its label intact — it is a measurement |
| **empty** | "No leads yet", with what would put something there |
| **unavailable** | "Unavailable", `role="alert"`, the rest of the screen unaffected |
| **not configured** | "Analytics not configured", naming the outstanding variables |

A figure that cannot be measured renders as an em dash with a reason, at the size
of the number it replaces, so a strip with one missing cell keeps its baseline
and does not imply zero. `data-state` is on the DOM so a rendered test can tell
the three non-zero cases apart.

`MOCK-dashboard-not-configured.png` is the state this deployment is actually in
today, and it reads `—  not configured` five times rather than `0` five times.

---

## Responsive

**Desktop** — sidebar plus 12 columns. At 1512×945 (a 13" MacBook), the
executive strip, the whole traffic pulse and the live panel are above the fold;
the capture harness asserts it by measuring bounding boxes rather than by
eyeballing a screenshot.

**Tablet** — the 12-column spans collapse at `lg`, so 8+4 and 5+7 become stacked
full-width sections with their hierarchy intact. The sidebar collapses to the top
bar and drawer.

**Mobile (390×844)** — top app bar, command bar with the scope controls, a
two-column executive strip, stacked sections, tables scrolling inside their own
containers. The drawer is a focus-trapped `role="dialog"` with Escape, scroll
lock and focus move — unchanged from before, because it was already right. The
section name was removed from the mobile top bar during review: the command bar's
`h1` sits forty pixels below it and two lines were saying one thing.

The Portal's mobile experience deliberately does **not** imitate the public
site's cinematic one. It is a utility.

---

## Accessibility

- One `<h1>` per screen, in the command bar; sections are real `<h2>`/`<h3>`,
  so the page has an outline to jump between.
- Every clickable row also carries a real link. No row-click-only affordance.
- Native `<select>` for the six filter dropdowns — the platform's keyboard
  handling, announced correctly, instead of 200 lines re-implementing it.
- `aria-pressed` on every toggle; `aria-label` on every icon-only control;
  `role="group"` on the segmented controls.
- Charts carry `role="img"` with a described label.
- The focus ring is the site's, unchanged, and reaches everything.
- Contrast: the muted text level was kept at `haze` (6.5:1) rather than
  introducing a darker one at 3.5:1.
- The active navigation item is marked by background *and* a leading rule, not
  by colour alone.

---

## Performance

Measured by building the tree at `HEAD` and the tree after, both production
builds, same machine.

| Chunk | Before | After |
|---|---|---|
| entry `index` | 187.50 kB (53.28 gz) | **189.14 kB (54.72 gz)** |
| `vendor` | 165.16 kB | 165.94 kB |
| `supabase` | 218.46 kB | 218.46 kB |
| `analytics` (lazy) | — | 15.25 kB (4.48 gz) |
| `screens` (lazy) | — | 6.78 kB (2.23 gz) |
| CSS | 18.45 kB (4.75 gz) | 20.01 kB (5.05 gz) |

**Initial JS on the Dashboard: +1.64 kB raw, +1.44 kB gzipped (+2.7%)** — for a
shell, a rebuilt Dashboard, a rebuilt Leads, a new Lead Detail and a new System
screen. Analytics (the largest single screen, and never a landing page) and the
six record screens are now split out and are not parsed before the Dashboard can
draw. Total application code grew 187.50 → 211.17 kB; what is on the critical
path grew by 1.64.

**Requests.** Unchanged per screen — three in parallel on the Dashboard (leads,
analytics, health), one on Analytics, one on Leads. `lib/health.ts` gained a
shared in-flight cache keyed by token and reload generation: the sidebar footer
and the System page both want the environment, and on `/system` that was two
identical round trips, each of which made the function probe Supabase. It is now
one. The cache holds the *promise*, not the result, so Refresh is not a no-op for
the second caller.

**Rerenders.** The scope context memoises its value; `MetricStrip` and the tables
are plain functions of their props; the reload generation is a dependency rather
than an imperative call, so a refresh is one state change and one render pass
across every panel.

No chart library, no new runtime dependency, no CDN. `package.json` is unchanged.

---

## Regression

**Ran:** the full Playwright suite — 1038 passed, 121 skipped.

Two homepage specs (`homepage-chrome`, `homepage-modality`, both at
desktop-1920) failed in the full parallel run and **both pass when re-run**
serially. They are the WebGL-heavy suites the config's own comment describes as
sitting close to the 30 s timeout under parallel load, they touch no Portal code,
and no file under `dist/` that they read was rebuilt by this phase. Recorded as a
pre-existing timing flake rather than as a regression, and not fixed here.

**Preserved and asserted:**

- Supabase auth, `ProtectedRoute`, unauthenticated redirect, the capability
  matrix. Every rebuilt route is capability-guarded and the suite reads the
  route table to prove it.
- `/leads/:id` and `/system` are guarded exactly like `/leads` — checked both at
  the source and by driving the router at them in a browser.
- Server-only Google credentials. The bundle carries no Google identifier; the
  check now also refuses a private-key header and a `properties/NNNNNN` id.
- Health endpoint's structural guarantee, re-asserted on the response type.
- RLS as the only authority. `useRows` and the new `useLead` both issue
  unqualified selects.
- PII: every stored value a text node, no `dangerouslySetInnerHTML`, no dynamic
  `href` without a literal scheme, `safeUrl` unchanged and still fuzzed against
  eight hostile schemes.
- GA4 consent architecture and the measurement note, verbatim.
- Lead persistence, pipeline mutations, notes, timeline — all moved screens,
  none rewritten.
- Self-hosted fonts, CSP, sign-out, one horizontal scroller.
- `npm run scan:secrets` — clean. `npm run typecheck` — clean.

**Not touched:** the public homepage, the mobile Altimeter, mobile typography,
homepage navigation, history restoration, homepage scroll architecture. No file
outside `portal/`, `tests/`, `scripts/portal-shots.mjs`,
`scripts/secret-scan.mjs` and `playwright.config.ts` was changed.

**Backend contracts:** unchanged. No function, migration or endpoint was edited.
Two frontend-only additions to `lib/permissions.ts` (`view_system`) and
`lib/analytics.ts` (`RANGE_DAYS`), neither of which the server sees.

---

## Testing

Two halves, because `dist/portal` has no credentials and therefore cannot sign
anybody in — every rebuilt screen is behind the guard, so a rendered test can
reach the sign-in page and nothing else.

**`tests/portal-control-room.spec.ts`** — 30 structural contracts asserted where
they are decided: navigation composition and order, the records group's
subordination, capability guards on every item and route, the command bar's
contents, drawer semantics, Dashboard section order, the executive strip being
one surface, the accent budget, attention items being derived rather than
invented, the four nothing-states, Leads' columns and filters, the 8/4 detail
split, System holding no business surface and no field that could carry a secret,
the three surfaces, the font budget, the six typographic levels, and the absence
of any chart library. Plus rendered checks against the built artefact.

**`scripts/portal-shots.mjs`** — now a gate as well as a camera. It builds a
separate credentialled bundle, intercepts every request (anything unmatched is
aborted), drives each screen with fixtures, and **asserts the rendered contracts
before capturing**, exiting non-zero on failure. 31 captures across 1920×1080,
1440×900, 1512×945, 834×1112 and 390×844, including the unconfigured states. It
caught both bugs this phase fixed.

Its PostgREST mock now honours `id=eq.…`, because `.maybeSingle()` requires it —
without that the lead detail rendered its error state and looked exactly like a
product bug.

Nothing is asserted against a pixel coordinate.

---

## Acceptance

**Dashboard (§50)** — at 1512×945, the ten-second scan answers: activity (strip
+ traffic), leads in (strip + recent leads), conversion (strip + path), anyone
live (Live), where from (Acquisition), latest enquiries (Recent leads), anything
to do (Attention), systems healthy (one line). The first three sections are
above the fold and the harness measures it.

**Analytics (§51)** — what happened, where traffic came from, what content
performed, what converted: six sections, one each, in that order.

**Leads (§52)** — who needs action: status strip, one control row, one table,
one click to the lead.

**System (§53)** — is the infrastructure operational: four services, one
environment, nothing else.

---

## What was deliberately not done

- No custom date range (the endpoint accepts four).
- No previous-period *curve* (GA4 returns one series; a mean rule instead).
- No country or locale in Audience (not in the report; a backend change with a
  privacy question).
- No pipeline value (no source of truth).
- No Clients product, no Revenue, no Operations, no Project Management, no
  Finance, no AI.

---

PORTAL P1 CONTROL ROOM READY FOR REVIEW

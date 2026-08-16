# Portal P2 — audit of the current operating model

*Written before a single line of P2 was designed. The purpose is to find out what
this system already knows, so that P2 adds the things it is missing rather than a
second copy of the things it has.*

---

## 1. What was inspected

| Area | Files read |
| --- | --- |
| Schema | `supabase/migrations/20260801000100_schema.sql` |
| RLS | `supabase/migrations/20260801000200_rls.sql` |
| Lead envelope | `supabase/migrations/20260805000100_lead_envelope.sql` |
| Lead pipeline | `supabase/migrations/20260814000100_lead_pipeline.sql` |
| Portal routes | `portal/src/App.tsx` |
| Shell / IA | `portal/src/components/shell/PortalShell.tsx` |
| Dashboard | `portal/src/pages/dashboard.tsx` |
| Analytics | `portal/src/pages/analytics.tsx`, `portal/src/lib/analytics.ts` |
| Leads | `portal/src/pages/leads.tsx`, `lead-detail.tsx`, `portal/src/lib/leads.ts` |
| Records | `portal/src/pages/screens.tsx` |
| Permissions | `portal/src/lib/permissions.ts` |
| Data access | `portal/src/lib/useRows.ts`, `portal/src/lib/supabase.ts` |
| Server | `netlify/functions/portal-analytics.mjs`, `portal-health.mjs`, `submit-lead.mjs`, `lead-contract.mjs`, `lead-notify.mjs` |
| Review harness | `scripts/portal-shots.mjs`, `tests/portal-control-room.spec.ts` |

---

## 2. What already exists

### 2.1 Tables

| Table | Purpose today | P2 relevance |
| --- | --- | --- |
| `leads` | Every public-form submission, with attribution in `meta` | **The head of the chain.** Source of Opportunity. |
| `lead_notes` | Private plain-text notes on a lead, authored by a real profile | Pattern to follow for other records. |
| `organizations` | Company records: `name`, `slug`, `website`, `status` (`org_status`) | **This is the Client entity.** Do not create a second one. |
| `projects` | `organization_id`, `name`, `slug`, `description`, `status` (`project_status`), `start_date`, `target_date` | **This is the Project entity.** Extend, do not replace. |
| `project_members` | Which staff are on which project | Ownership already partly modelled here. |
| `profiles` | One row per auth user, with `role` | **Real Portal identity exists.** `responsible` can be a real FK. |
| `activity_logs` | Append-only event log: `action`, `entity_type`, `entity_id`, `metadata`, `user_id` | **This is the audit log.** Do not create a second one. |
| `case_studies`, `content_blocks`, `media_assets` | Content records | Out of scope for P2. |

### 2.2 Enums

```
user_role       super_admin | admin | team_member | client
lead_status     new | contacted | qualified | proposal | won | lost | spam
project_status  discovery | design | build | launch | care | archived
org_status      prospect | active | paused | former
```

Two of these matter a great deal to P2.

**`lead_status` already carries the exact vocabulary §1 of the brief asks about**
— New, Contacted, Qualified, Proposal, Won, Lost. P2 reuses those words for the
Opportunity stage where they mean the same thing, and adds only the one commercial
stage the lead pipeline has no business carrying (`negotiation`). Lead status and
Opportunity stage stay separate columns on separate tables, exactly as §5 requires.

**`project_status` is a *phase* vocabulary, not a *state* vocabulary.**
`discovery → design → build → launch → care` describes where a website project has
got to. §22's proposed list — Planned, Active, Client Review, Blocked, Completed,
On Hold — describes whether it is moving. These are two different axes, and the
existing enum has taken the phase axis. §23 asks for a milestone model, which is
the phase axis done properly. So P2:

- gives phases to **milestones**, where they belong and where they can be
  per-service rather than hard-coded onto every project;
- extends `project_status` additively with the operational states;
- keeps every legacy value renderable, with no data migration and no rewrite.

### 2.3 Attribution that already exists

`leads.meta` is a jsonb column written by the server from a strict allow-list
(`META` in `lead-contract.mjs`). It carries `utmSource`, `utmMedium`,
`utmCampaign`, `landingRoute`, `landingReferrerHost`, viewport and timing.
`portal/src/lib/leads.ts` already derives a readable source from it (`leadSource`)
and already groups leads by source, medium, campaign, landing page, locale and
form (`FACETS`, `groupBy`).

**This is the left-hand half of §33's chain and it is already built.** P2 does not
re-derive it; it carries those fields onto the Opportunity at conversion so the
chain survives past the lead, and then joins the aggregate to won value.

### 2.4 Activity that already exists

- `leads.received` — written by `submit-lead.mjs` with the service key.
- `lead.status_changed` — written by a `security definer` trigger
  (`log_lead_status_change`), so it records changes made from *anywhere*, not only
  from React.
- `activity_entity_idx` on `(entity_type, entity_id, created_at desc)` already
  exists and is exactly the index a per-record timeline needs.

**The established pattern for audit is a database trigger, not an application
insert**, and `activity_logs` has deliberately no INSERT policy — staff may read,
nobody may write through the API. P2 follows this: every commercial audit entry in
§63 is written by a trigger, so it cannot be forged from the browser and cannot be
missed when a change is made from the SQL editor.

### 2.5 RLS posture

- `is_staff()` / `is_admin()` / `is_super_admin()` — `security definer`,
  `search_path` pinned, the standard Supabase pattern.
- Every business table: staff select, admin write. `leads` additionally has
  `force row level security`.
- `activity_logs`: admin select only, no write policy at all.
- `lead_notes`: staff select, admin insert **with `author_id = auth.uid()`**,
  author-only delete, no update — a note is a record, not a draft.

P2 has one job here: every new table gets the same treatment, and the note table
copies the author clause verbatim.

### 2.6 Data access architecture

`portal/src/lib/useRows.ts` issues **unqualified** selects through the anon key and
lets RLS decide what comes back. There is no server API for business data and there
does not need to be: PostgREST + RLS *is* the API, the policies are the
authorisation, and adding a Netlify function in front of it would move the
authorisation decision to a place where it can be forgotten.

Two Netlify functions exist and both are for things RLS cannot do:
`portal-analytics` (Google credentials must not reach a browser) and
`portal-health` (reads the environment). Both verify the bearer token against
Supabase, read the role from `profiles` rather than the JWT, allowlist GET, and
never return a variable's value.

**P2 therefore adds no new HTTP endpoints.** §44's checklist is satisfied by not
creating the surface it governs; where server-side aggregation is needed (§59) it
is a `stable`, **`security invoker`** SQL function, which runs under the caller's
own policies rather than around them.

### 2.7 The Control Room (P1, accepted)

- Tokens: three surfaces (`ink`/`deck`/`flare`), two hairlines, one accent.
- Typography: six levels, `.t-page` … `.t-note`, tabular figures everywhere.
- Layout: one 12-column grid, `Grid` from `PortalShell`.
- Primitives in `components/ui`: `Panel`, `SectionHeader`, `MetricStrip`,
  `MetricCell`, `Table`/`Row`/`Cell`, `StatusPill`, `Badge`, `DataState`,
  `EmptyState`, `ErrorState`, `NoFigure`, `Skeleton`, `Button`, `Select`, `Input`.
- Navigation: four products + a subordinate Records group.
- `DataState` already distinguishes **empty / unavailable / unconfigured / zero**,
  which is precisely what §31's "`Not recorded` rather than false zero" needs.
- `safeUrl()` in `pages/screens.tsx` already implements §25's protocol handling
  (http/https only, bare hosts upgraded, everything else rendered as text).

### 2.8 The review and test harness

- `tests/portal-control-room.spec.ts` asserts structure **at the source**, because
  `dist/portal` has no credentials and cannot sign anybody in.
- `scripts/portal-shots.mjs` builds a *separate* credentialled bundle, intercepts
  every request, drives each screen with fixtures, **asserts rendered contracts**
  and exits non-zero on failure.

P2 extends both rather than inventing a third mechanism.

---

## 3. What does not exist

| Missing | Consequence today |
| --- | --- |
| Any commercial value, anywhere | The Dashboard's own docstring says "pipeline value … does not exist in this system and is therefore not invented". |
| An Opportunity | A qualified lead and a live deal are the same row. There is nowhere to record what it is worth. |
| A stage separate from lead status | `leads.status = 'proposal'` is doing two jobs. |
| Probability, expected close, next action | No forecast is possible; no follow-up is scheduled. |
| A Client distinct from an organisation record | `organizations` exists but nothing ever writes to it, and no path leads from a won lead to a client. |
| Project commercial data | `projects` has no value, no costs, no hours, no responsible person, no link to what sold it. |
| Milestones | No answer to "where is it now". |
| Client contacts | One lead's name is the only contact information the system keeps. |
| Costs / contribution | Profitability cannot be computed. |
| Source → revenue | Attribution stops at the lead. |
| Follow-up view | Nothing to work from in the morning. |
| Lost reasons | Losses leave no intelligence behind. |

The `Clients` and `Projects` screens in `pages/screens.tsx` are read-only tables
over `organizations` and `projects` with no writes and no detail route. They are
the seed of the P2 modules, not competitors to them.

---

## 4. Decisions this audit forces

1. **Client = `organizations`.** Extended, not replaced. `org_status` already
   distinguishes prospect/active/paused/former, which is §18's "status".
2. **Project = `projects`.** Extended with commerce, hours, delivery state,
   milestones, costs and links. `project_status` gains operational values
   additively; legacy phase values keep rendering.
3. **Audit = `activity_logs`**, written by triggers, never by the client.
4. **Notes** get one polymorphic table for the three new record types rather than
   three near-identical tables. `lead_notes` is left exactly as it is — leads have
   a hard FK and a cascade, which is worth keeping.
5. **Follow-ups are fields on the Opportunity** (`next_action`, `next_action_on`),
   not a task table. §14 forbids a project-task manager; a view over two columns
   cannot become one.
6. **No new HTTP endpoint.** Business data moves through PostgREST + RLS. Two
   `security invoker` SQL functions provide server-side aggregation for the
   Dashboard so it never has to load the whole business (§59).
7. **`responsible` is a real `profiles` FK and is nullable.** §39 is satisfiable
   here — there is genuine multi-user identity — but there is exactly one account
   today, so nothing may assume a second.
8. **Sessions are never joined to a named record.** §33 is an *aggregate* join:
   GA4 sessions by source, Portal leads/opportunities/revenue by source, matched on
   the source string with the methodology stated on the screen.

---

## 5. Concepts P2 must NOT create

- A second client table, a second project table, a second activity log.
- A `lead_status` value for anything commercial — that belongs to the Opportunity.
- A generic task manager, an invoice, a ledger, a chart of accounts.
- A team-member name that is not a `profiles` row.
- A historical Lost reason, a reconstructed activity entry, or a demo opportunity.

---

*Audit complete. Design proceeds from here.*

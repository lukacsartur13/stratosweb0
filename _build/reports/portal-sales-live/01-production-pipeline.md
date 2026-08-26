# Portal Sales — making the pipeline live

*Turning the P2 Sales workspace from a designed screen into a tool the Stratos
team can use against the production database.*

Project `onyynfpowjwsoivkefcz`. Audited 2026-08-26.

> **Status: root cause established and proven against production; repair
> prepared; production migration NOT YET APPLIED at the time of writing.**
> Sections **C (result)**, **F**, **H** and the completion gate are marked
> `PENDING` and will be completed against the live database, not inferred.
> Nothing in this document is a claim about a test double.

---

## A. Root cause

**`public.opportunities` does not exist in the production database, and never
has.** The Sales screen was reading a table that was never created.

This was measured, not deduced. The production PostgREST endpoint was probed
directly with the **public anon key** — the same identifier the deployed browser
bundle carries, which is a public identifier by design and not a secret. No
credential, session or service key was used or needed.

| Probe | Production answer | Reading |
| --- | --- | --- |
| `GET /rest/v1/opportunities` | **`404` · `PGRST205`** · *Could not find the table 'public.opportunities' in the schema cache* | the table is absent |
| `POST /rest/v1/rpc/portal_sales_summary` | `PGRST202` · function not in schema cache | the aggregate is absent |
| `POST /rest/v1/rpc/portal_revenue_attribution` | `PGRST202` | absent |
| `GET /rest/v1/leads` | `200 []` | present, RLS returning nothing to anon — correct |
| `GET /rest/v1/profiles`, `organizations`, `projects`, `activity_logs`, `case_studies` | `200 []` | present |
| `GET /rest/v1/client_contacts`, `project_milestones`, `project_costs`, `project_links`, `record_notes` | `404` · `PGRST205` | absent |
| `GET /rest/v1/lead_notes` | `404` · `PGRST205` | absent |
| `GET /rest/v1/leads?status=eq.proposal` | `400` · `22P02` *invalid input value for enum lead_status: "proposal"* | the enum value is absent |
| `POST /rest/v1/rpc/is_staff` | `200 false` | the P1 authorization model **is** installed and answering |

### Three things the brief assumed that turned out not to be true

**1. The migration named in the brief is not the pipeline's migration.**
`supabase/migrations/20260814000100_lead_pipeline.sql` adds `lead_notes`, a
`lead_status` value and a status-change trigger — all about **leads**.
`opportunities`, the table the Sales screen actually reads, is created by
`supabase/migrations/20260816000100_revenue_operations.sql`. Both are unapplied;
the **second** is the one causing `UNAVAILABLE`.

**2. This was never an RLS problem, and could not have been.**
An RLS policy that hides rows on `SELECT` does not produce an error. PostgREST
answers `200 []` and the screen renders an empty pipeline. The `UNAVAILABLE`
panel is only reachable from a genuine error, and RLS on a read cannot generate
one. Every audit that looked at policies was looking at the one layer that was
already correct — `is_staff()` is installed in production and answering.

**3. The error message was misclassified, and that is what made this take six
audits.**
`portal/src/lib/sales.ts` tested `error.code === '42P01'` to mean "the table is
missing". `42P01` is Postgres's `undefined_table` **and PostgREST does not
return it** — a relation missing from the schema cache is a `404 PGRST205`. So
the one branch that would have said *run the migrations* never matched, and the
fallback fired instead:

> The database refused the request. Check that your account may read the
> pipeline.

A database that had simply never been migrated described itself as a permissions
problem, in a sentence naming the reader's own account. The message pointed at
the only layer that was working.

---

## B. Production schema state, before any change

Determined by probe, per the table in §A.

| Migration | State | Evidence |
| --- | --- | --- |
| `20260801000100_schema.sql` | **applied** | `profiles`, `organizations`, `projects`, `leads`, `activity_logs`, `case_studies` all answer |
| `20260801000200_rls.sql` | **applied** | `is_staff()` executes and returns `false` for anon |
| `20260805000100_lead_envelope.sql` | **applied** | `leads.meta`, `.payload`, `.submission_id`, `.form_type`, `.locale` all selectable |
| `20260814000100_lead_pipeline.sql` | **NOT applied** | `lead_notes` absent; `lead_status` has no `proposal` |
| `20260816000100_revenue_operations.sql` | **NOT applied** | `opportunities` + 5 tables + 2 functions absent |

This matches the written record: `_build/reports/portal-p2-revenue-operations.md`
§8 states *"prepared, reviewed, NOT APPLIED"* and *"Nothing in this phase applies
a production migration."* The probe confirms it rather than trusting it.

---

## C. Migration

### C.1 What was reviewed

Both unapplied migrations were read line by line before anything was prepared.
A mechanical scan for destructive operations over the non-comment source of
both files finds:

* no `DROP TABLE`, `DROP TYPE`, `DROP SCHEMA`, `DROP DATABASE`, `DROP OWNED`
* no `TRUNCATE`, no `DELETE FROM`
* no `ALTER TABLE … DROP COLUMN`
* no data migration, backfill or `UPDATE` of any existing row

Every `drop` present is `drop trigger if exists` or `drop policy if exists`
immediately followed by the `create` that replaces it — the standard re-runnable
pattern. **`leads` is not modified by a single statement.** Every added column is
nullable or defaulted. This is asserted, not just stated, by
`tests/portal-sales-live.spec.ts` › *neither migration drops, truncates or
rewrites anything*.

The one irreversible element, unchanged from the P2 review: six inert
`project_status` enum labels and one `lead_status` label. Postgres cannot drop an
enum value without rewriting every table using the type, which is the exclusive
lock these migrations exist to avoid. Nothing depends on the new labels; the
rollback in `supabase/checks/revenue-operations-rollback.sql` moves any row using
them back to a legacy value.

### C.2 A safe amendment — a migration that would have failed silently

`20260814000100_lead_pipeline.sql` contained:

```sql
do $$ begin
  alter type lead_status add value if not exists 'proposal' after 'qualified';
exception when others then null; end $$;
```

A PL/pgSQL block **with an exception handler** runs its body in a
subtransaction, and a subtransaction is precisely the one context in which
Postgres still refuses `ALTER TYPE … ADD VALUE`:

```
ERROR:  ALTER TYPE ... ADD cannot run inside a transaction block
```

`exception when others then null` would then have caught that refusal and
discarded it. **The migration reports success, `proposal` is never added, and
nothing says so.** A guard that converts a hard failure into a silent no-op is
worse than no guard at all.

The statement is now a bare top-level one, with the reason recorded in the file.
`if not exists` does everything the handler was there for, and a top-level
statement takes no subtransaction. The later migration had already reached this
conclusion independently — its `project_status` loop carries a comment saying so
— which is why only the earlier file needed correcting.

`tests/portal-sales-live.spec.ts` › *the lead_status enum addition can no longer
fail silently* asserts the statement is not inside a `do $$ … end $$` block and
that the file contains no `exception when others then null`.

### C.3 What was handed over to apply

Two scripts, generated from the repository migrations so the two stay
reproducible, in `_build/reports/portal-sales-live/`:

| Script | Contents |
| --- | --- |
| `apply-01-enums.sql` | the two `ALTER TYPE … ADD VALUE` statements, alone |
| `apply-02-pipeline.sql` | both migrations verbatim, with only those two statements removed |

**Why two runs.** The Supabase SQL editor executes a submitted script as one
implicit transaction. `ALTER TYPE … ADD VALUE` is permitted inside a transaction
on Postgres 12+, but the value it adds cannot be *used* until that transaction
commits. Nothing in step 2 uses the new values — verified: the aggregate compares
`status::text`, never an enum literal — so a single combined script would in fact
work. It is split anyway, because "would in fact work" is a claim about the
current text of step 2, and a separate 40-millisecond run is a cheaper guarantee
than the claim. Step 2 is atomic: any failure applies nothing.

`tests/portal-sales-live.spec.ts` asserts step 1 contains both enum extensions
and creates no table, and that step 2's non-comment source contains no
`add value` at all.

### C.4 Result

**PENDING** — to be completed against production after the scripts are run.

---

## D. RLS

**No policy was weakened, disabled or added. RLS was correct before this phase
and is untouched by it.** The access model below arrives with
`20260816000100_revenue_operations.sql` exactly as written.

### The model

Authorization is a role on `profiles`, read inside the policies by two
`security definer` helpers with pinned `search_path` — `is_staff()` and
`is_admin()` — installed by `20260801000200_rls.sql` and confirmed live in
production. The role is read from `profiles`, never from the JWT's user
metadata, which is user-writable and would be a one-line privilege escalation.

| Table | SELECT | INSERT | UPDATE | DELETE |
| --- | --- | --- | --- | --- |
| `opportunities` | `is_staff()` | `is_admin()` | `is_admin()` | **no policy — deletion is impossible** |
| `client_contacts` | `is_staff()` | `is_admin()` | `is_admin()` | `is_admin()` |
| `record_notes` | `is_staff()` | `is_admin() and author_id = auth.uid()` | **no policy** | `is_admin() and author_id = auth.uid()` |
| `project_milestones` | via the project's own visibility | `is_admin()` | `is_admin()` | `is_admin()` |
| `project_costs` | `is_admin()` — **not** staff | `is_admin()` | `is_admin()` | `is_admin()` |

Every one of the six tables gets `enable row level security` **and**
`force row level security`, so a mistake in a definer function or an
owner-context script cannot bypass them.

Two independent locks, not one: `anon` is `revoke all`'d on all six tables, so an
unauthenticated caller is refused by the privilege system *before* RLS is
consulted. `authenticated` is granted table access and RLS is the gate.

**Deletion of an opportunity is not a policy the UI declines to use — it does not
exist.** An opportunity is archived by setting `archived_at`, which is an update.
A `DELETE` from the browser is refused by the database.

Both aggregate functions are `SECURITY INVOKER`, written out explicitly rather
than left to the default. A definer function would compute the company's revenue
without the caller's policies, making every figure readable by any authenticated
account including a client.

**The browser continues to use the ordinary anon key plus the user's session.**
No service-role key is in, or goes near, client code —
`tests/portal.spec.ts:55` asserts it over the scripts the deployed shell
actually loads.

### The one thing worth flagging

`opportunities` grants `SELECT` to `is_staff()`, which includes `team_member`,
while the Portal's capability matrix withholds `view_sales` from that role. A
team member therefore **cannot** reach Sales in the UI but **can** read the
pipeline through PostgREST with their own token. This is pre-existing, is
documented as deliberate in `portal/src/lib/permissions.ts`, and the line that
actually matters — `project_costs` — is admin-only. It is recorded here because
it is a real difference between what the UI implies and what the database
enforces, not because this phase changed it. See §I.

---

## E. Data flow

```
  pages/sales.tsx
    ├── useOpportunities()          lib/sales.ts
    │     └── supabase.from('opportunities')
    │           .select(OPPORTUNITY_COLUMNS)      ← embeds organizations, profiles
    │           .is('archived_at', null)
    │           .order('updated_at', desc).limit(200)
    │                 ↓
    │           anon key + the user's session JWT
    │                 ↓
    │           PostgREST → RLS: opportunities_select_staff → is_staff() → profiles.role
    │
    └── useSalesSummary()           lib/business.ts
          └── supabase.rpc('portal_sales_summary')
                ↓
          SECURITY INVOKER: the aggregate is built from exactly the rows
          this caller could have selected themselves
```

**One fetch, four views.** Pipeline, Table, Follow-ups and Performance are four
readings of one list — `useOpportunities` for the first three, the server-side
aggregate for the strip and Performance. There is no second state layer and no
duplicated cache, so Table cannot drift from Pipeline: they render the same
array. The view lives in the URL (`/sales?view=table`).

**Stage moves are not optimistic.** `setStage` awaits the `update`, and only
`onChanged()` — a refetch — updates what is on screen. A rejected mutation
therefore cannot leave a card sitting in a column the database never accepted;
the error is rendered on the card itself via `role="alert"`. There is nothing to
roll back because nothing was moved ahead of the server.

---

## F. CRUD verification

**PENDING** — to be executed against production, through the browser, as a
signed-in user. Nothing here will be reported from a fixture.

---

## G. KPI formulas

Every figure is the **database's** answer, from `portal_sales_summary()`, not a
client-side sum over the truncated 200-row list.

Definitions, exactly as computed:

```sql
live      := opportunities where archived_at is null
open_opps := live where stage not in ('won', 'lost')
```

| Card | Formula | Notes |
| --- | --- | --- |
| **Total pipeline** | `sum(estimated_value)` over `open_opps`, grouped by currency | Open only. Won and lost are excluded, so the pipeline does not grow every time something closes. |
| **Weighted** | `sum(estimated_value * probability / 100.0)` over `open_opps` | See the probability note below. |
| **Closing this month** | `sum(estimated_value)` over `open_opps` where `expected_close_on` is within `[date_trunc('month', current_date), +1 month)` | **Total expected value**, with the record count shown beside it. Open deals only — a deal already won this month is not still "closing". |
| **Won this month** | `sum(estimated_value)` over `live` where `stage = 'won'` and `won_at >= date_trunc('month', current_date)` | Genuinely marked won. `won_at` is stamped by a database trigger, never by the browser, so it cannot drift from the stage. |

### Probability is converted exactly once

`opportunities.probability` is `smallint`, constrained `between 0 and 100`, and
is stored as **0–100**. The single division by `100.0` happens in
`portal_sales_summary()`. `lib/pipeline.ts`'s `weighted()` performs the same
`/100` for the per-row `Weighted` column in Table view. Neither multiplies back;
there is no second conversion anywhere in the path.

### Two currencies are never added

Every monetary aggregate is grouped **by currency**. The strip prints the largest
group and, beside it, a count of the records not in it — `12.5M Ft` `+2 in EUR`.
Nothing in this system holds an exchange rate, so nothing converts; a total that
silently spanned two currencies would be a fiction. Formatting is
`1 250 000 Ft` exact / `1.25M Ft` compact, space-grouped, locale-independent.

### What is deliberately *not* inferred

Won is read from the stage and the trigger-stamped `won_at`, **never** from a
100% probability. Win rate is `null` — rendered *Not recorded*, not `0%` — until
at least one deal has actually closed.

---

## H. QA evidence

**PENDING** — production test sequence and results.

---

## I. Remaining limitations

Stated plainly rather than absorbed.

1. **A frontend deployment is required for the error-handling repair, and only
   for that.** The Sales pipeline itself needs **no code change** to work: the
   currently deployed bundle reads the schema correctly, and applying the
   migration is sufficient to clear `UNAVAILABLE`. The `lib/dbError.ts` work in
   §J is a separate, non-blocking improvement that reaches the live Portal only
   on the next deploy. Nothing was pushed, merged or deployed by this phase.

2. **The same misclassification survives in four other modules.**
   `lib/useRows.ts:35`, `lib/records.ts:123`, `lib/operations.ts:126` and
   `:417`, and `lib/leads.ts:406` each still test `error.code === '42P01'` and
   will mis-describe a missing table on the Leads, Clients and Projects screens
   exactly as Sales did. They were left alone because they are outside this
   phase's scope (§19, *do not modify unrelated Portal modules*). Each is a
   one-line change to call `refusal()` from `lib/dbError.ts`.

3. **Performance is real but thin, and was not extended.** It computes won MTD /
   YTD, average won deal, open and weighted pipeline, win rate and the stage
   distribution — all from `portal_sales_summary()`, all defined by P2. It was
   blocked solely by the missing aggregate function. No analytics suite was
   invented on top of it.

4. **Follow-ups are two columns on the opportunity, not a task table.** A
   follow-up is `next_action` plus `next_action_on`, grouped into Overdue /
   Today / Upcoming. There is deliberately **nothing to tick off**: a row leaves
   the list when the action on the deal changes. Marking a follow-up "complete"
   independently of the deal is not in the P2 schema and was not added — that is
   a task manager, which §14 of the P2 brief rules out. A deal with an action and
   no date is absent by design; it surfaces on the Dashboard's attention list as
   *has no next action date*.

5. **`team_member` can read the pipeline over the API but not in the UI.** See
   §D. Pre-existing and deliberate; recorded because it is a real gap between
   what the UI implies and what the database enforces.

6. **The 200-row cap is real and is visible.** The list is bounded at 200 rows,
   newest-updated first, and the Table view says so when the cap is reached.
   Filtering happens in the browser over those rows.

7. **The lead → opportunity path was not touched.** Public capture
   (`browser form → /api/lead → Netlify function → leads`) and its envelope are
   unmodified by every statement in both migrations; `leads` gains only the enum
   value. Conversion is verified in §H.

---

## J. Code changed in this phase

| File | Change |
| --- | --- |
| `supabase/migrations/20260814000100_lead_pipeline.sql` | the silently-swallowed enum addition, corrected (§C.2) |
| `portal/src/lib/dbError.ts` | **new.** No imports. Classifies a PostgREST error into the seven causes §11 asks to distinguish; produces the safe sentence; logs only the four PostgREST fields |
| `portal/src/lib/sales.ts` | the list read, the detail read and every mutation classify through `dbError`; the hand-rolled ladder and the `42P01` test are gone |
| `portal/src/lib/business.ts` | `useSalesSummary` now carries a message and a cause instead of failing silently |
| `portal/src/pages/sales.tsx` | the KPI strip gains a cause line and a Retry beneath its four unchanged cells; Performance prints the real cause instead of guessing *"It may need the P2 migration"* |
| `tests/portal-sales-live.spec.ts` | **new.** 84 assertions × the project matrix |

**Nothing was redesigned.** The strip keeps its four cells and its
`xl:grid-cols-4` layout, the four tabs are unchanged, the yellow action colour is
untouched, and the only additions are an error line and a retry — asserted by
`tests/portal-sales-live.spec.ts` › *the KPI strip keeps its four cells and gains
a cause line*.

### Local verification of the code change

| Check | Result |
| --- | --- |
| `npm run typecheck` | clean |
| `npm run build:portal` | builds |
| `npm run scan:secrets` | 1153 files, 12 rules, clean |
| `portal.spec.ts` + `portal-control-room.spec.ts` + `portal-revenue.spec.ts` + `portal-sales-live.spec.ts` | **394 / 394 pass** |

---

## K. Completion gate

**PENDING** — every box is verified against production or it is not ticked.

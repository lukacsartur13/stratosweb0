# Migration safety review — `20260816000100_revenue_operations.sql`

**Status: NOT APPLIED.** This migration has not been run against any database.
Neither has `20260814000100_lead_pipeline.sql`, which precedes it and which the
Portal Analytics report already lists as outstanding. Applying both is a manual
step and is the first item under *External requirements* in the final P2 report.

---

## 0. How to read this

Every object the migration creates or touches is listed below with its impact on
existing data and its rollback. Two companion files exist:

| File | Purpose |
| --- | --- |
| `supabase/checks/revenue-operations-verify.sql` | Run AFTER applying. Sections 1–8 are read-only; section 9 writes inside a transaction that ends in `ROLLBACK`. |
| `supabase/checks/revenue-operations-rollback.sql` | Reverses everything reversible. Read its header before running. |

The migration was reviewed by hand and by
`tests/portal-revenue.spec.ts` → *the migration*, which asserts the additivity,
the RLS, the absence of a delete policy, the `SECURITY INVOKER` on the
aggregates, the pinned `search_path` on every definer function and the database
constraints. **No Postgres was available in this environment**, so the SQL has
not been executed anywhere; the verification file exists precisely because a
hand review is not an execution.

---

## 1. New types

| Type | Values | Existing-data impact | Rollback |
| --- | --- | --- | --- |
| `opportunity_stage` | qualified, discovery, proposal, negotiation, won, lost | None — new type, no existing column uses it | `drop type` after the table |
| `opportunity_lost_reason` | price, no_response, competitor, timing, scope_mismatch, internal_decision, other | None | `drop type` |
| `milestone_state` | pending, in_progress, done, blocked | None | `drop type` |
| `payment_state` | not_invoiced, invoiced, partially_paid, paid | None | `drop type` after `projects.payment_state` |
| `project_cost_category` | collaborator, subcontractor, media, software, production, other | None | `drop type` |

## 2. Extended type — the one irreversible change

| Type | Added | Impact | Rollback |
| --- | --- | --- | --- |
| `project_status` | `planned`, `active`, `client_review`, `blocked`, `on_hold`, `completed` | **None.** No existing row is rewritten; the six original values (`discovery`, `design`, `build`, `launch`, `care`, `archived`) all remain valid and all still render, under their own labels, via `PROJECT_STATUS` in `lib/pipeline.ts`. | **Not reversible.** Postgres cannot drop an enum value without rewriting every table using the type — which is the exclusive lock this migration exists to avoid. |

The rollback script moves any row that took an operational value back onto a
legacy one, so that after a rollback the six added labels are unused by data.
They remain in the type, inert.

**Why the values were added rather than the enum replaced:** replacing means
rewriting the column, which means rewriting the table, which means an exclusive
lock on `projects`. `add value if not exists` takes no lock at all. This is the
same reasoning `20260814000100` used for `lead_status`.

**Why the block has no exception handler:** `ALTER TYPE … ADD VALUE` inside a
PL/pgSQL block that HAS one runs in a subtransaction, which is the context
Postgres still refuses it in. The migration uses a plain `foreach` loop with
`if not exists` semantics instead. The added values are also not *used* anywhere
in the same transaction — `portal_sales_summary` compares `status::text`, never
an enum literal — which is the other condition.

## 3. New tables

Every one: `create table if not exists`, RLS enabled **and forced**, no `anon`
privilege, indexes on the columns its screens actually filter by.

| Table | Rows | RLS select | RLS write | Delete allowed | Rollback |
| --- | --- | --- | --- | --- | --- |
| `opportunities` | The commercial pipeline | `is_staff()` | `is_admin()` insert + update | **No policy at all** (§41 — archive via `archived_at`) | `drop table` |
| `client_contacts` | Deliberately entered client contacts | `is_staff()` | `is_admin()` all | Yes — a phone number is not business history | `drop table` |
| `project_milestones` | Delivery checklist | inherits `projects` visibility via `exists (…)` | `is_admin()` all | Yes | `drop table` |
| `project_costs` | Direct project costs | **`is_admin()` only** | `is_admin()` all | Yes, and audited | `drop table` |
| `project_links` | External links | inherits `projects` visibility | `is_admin()` all | Yes | `drop table` |
| `record_notes` | Notes on opportunity / client / project | `is_staff()` | `is_admin()` **and `author_id = auth.uid()`** | Author only. **No update policy** | `drop table` |

Two policy decisions worth stating explicitly:

* **`project_costs` is admin-only, not staff-readable.** What a collaborator was
  paid is commercially sensitive in a way a milestone is not, and `is_staff()`
  here would put every subcontractor fee in front of every subcontractor.
* **`record_notes` has no UPDATE policy.** A note that can be rewritten after the
  fact is not a record, and the timeline it appears in is meant to be one. This
  is copied verbatim from `lead_notes`.

## 4. New columns on existing tables

All nullable or defaulted. **No existing row can be invalidated by this
migration** — asserted mechanically by `tests/portal-revenue.spec.ts` → *every
new column is nullable or defaulted*.

### `organizations` (the Client)

| Column | Type | Default | Impact |
| --- | --- | --- | --- |
| `acquisition_source` | text | null | none |
| `acquisition_medium` | text | null | none |
| `acquisition_campaign` | text | null | none |
| `primary_service` | text | null | none |
| `archived_at` | timestamptz | null | none |

Plus `organizations_name_norm_idx` on `lower(btrim(name))` — an **index**, not a
unique constraint, because two clients can legitimately share a name and §40
requires that possible duplicates be presented for confirmation rather than
merged.

### `projects` (the Project)

| Column | Type | Default | Impact |
| --- | --- | --- | --- |
| `service` | text | null | none |
| `value` | numeric(14,2) | null | none |
| `currency` | text **not null** | `'HUF'` | Existing rows take `HUF`. This is the only added column with a `not null`, and it has a default, so no row is invalidated. Verification section 6 confirms the count. |
| `opportunity_id` | uuid → opportunities | null | none |
| `responsible_id` | uuid → profiles | null | none |
| `estimated_hours`, `actual_hours` | numeric(8,2) | null | none |
| `payment_state` | payment_state **not null** | `'not_invoiced'` | Existing rows take `not_invoiced`, which is the honest starting value |
| `invoiced_amount`, `paid_amount` | numeric(14,2) | null | none |
| `completed_at`, `archived_at` | timestamptz | null | none |

### New constraints on `projects`

`projects_value_check`, `projects_currency_check`, `projects_hours_check`,
`projects_payment_amounts_check`. Every one is satisfied by `NULL`, so every
existing row validates. Added inside `do $$ … exception when duplicate_object`
blocks, so re-running is safe.

## 5. Indexes

| Index | On | Why |
| --- | --- | --- |
| `opportunities_stage_idx` | (stage, updated_at desc) | the board and the list |
| `opportunities_close_idx` | (expected_close_on) where not archived | the forecast, the overdue rule |
| `opportunities_action_idx` | (next_action_on) where not archived | the follow-up view |
| `opportunities_org_idx` | (organization_id) | the client hub |
| `opportunities_lead_idx` | (lead_id) | the lead's own pipeline panel |
| `opportunities_owner_idx` | (owner_id) | the responsible filter |
| `opportunities_won_idx` | (won_at desc) where stage = 'won' | won-value reporting |
| `client_contacts_org_idx` | (organization_id) | the contact list |
| `client_contacts_primary_key` | unique (organization_id) where is_primary | at most one primary contact |
| `project_milestones_project_idx` | (project_id, position) | the delivery list, in order |
| `project_costs_project_idx` | (project_id, incurred_on desc) | the cost list |
| `project_links_project_idx` | (project_id) | the links list |
| `record_notes_entity_idx` | (entity_type, entity_id, created_at desc) | every record's notes |
| `projects_opportunity_idx`, `projects_responsible_idx`, `projects_target_idx` | | the won→project link, the owner, the overdue rule |
| `organizations_name_norm_idx` | lower(btrim(name)) | duplicate detection |

All `create index if not exists`. On an empty or near-empty database each is
instantaneous; none is `concurrently`, which is correct for tables this size and
would be the thing to change if these tables ever held millions of rows.

## 6. Triggers and functions

| Object | Kind | Security | search_path | Purpose |
| --- | --- | --- | --- | --- |
| `is_supported_currency(text)` | sql immutable | invoker | — | the currency allow-list, used by check constraints |
| `opportunity_default_probability(stage)` | sql immutable | invoker | — | publishes the stage defaults where they live |
| `opportunity_close_stamp()` | plpgsql | **definer** | **pinned** | stamps `won_at` / `lost_at`, forces probability to 100/0 |
| `milestone_complete_stamp()` | plpgsql | **definer** | **pinned** | stamps `completed_at` |
| `log_business_change()` | plpgsql | **definer** | **pinned** | writes the audit rows |
| `log_project_cost_change()` | plpgsql | **definer** | **pinned** | writes cost add/remove audit rows |
| `portal_sales_summary()` | sql stable | **invoker** | pinned | the Dashboard's pipeline aggregate |
| `portal_revenue_attribution(text)` | plpgsql stable | **invoker** | pinned | source → revenue |

**The two aggregates are `SECURITY INVOKER` and this is the most important line
in the migration.** A definer function would compute the totals as its owner —
that is, without the caller's RLS — and the company's revenue would become
readable by any authenticated account, including a `client`. Invoker means each
figure is built from exactly the rows the caller could have selected themselves.
Asserted in the suite; verified again by section 7 of the verification file,
which prints `prosecdef` for all eight.

Triggers registered:

| Trigger | Table | When | Function |
| --- | --- | --- | --- |
| `opportunities_updated_at` | opportunities | before update | `set_updated_at` (existing) |
| `opportunities_close_stamp` | opportunities | before insert / update of stage | `opportunity_close_stamp` |
| `opportunities_audit_insert` / `_update` | opportunities | after | `log_business_change('opportunity')` |
| `organizations_audit_insert` / `_update` | organizations | after | `log_business_change('client')` |
| `projects_audit_insert` / `_update` | projects | after | `log_business_change('project')` |
| `project_costs_audit` | project_costs | after insert or delete | `log_project_cost_change` |
| `project_milestones_complete` | project_milestones | before insert / update of state | `milestone_complete_stamp` |
| `project_milestones_updated_at`, `client_contacts_updated_at` | | before update | `set_updated_at` (existing) |

**Impact on existing writes:** the two triggers added to `organizations` and
`projects` mean that any update to an existing row now *may* append a row to
`activity_logs`. It appends only when a status or a value actually changed, and
it appends nothing on any other update. Nothing existing breaks; the audit trail
simply begins from the moment the migration is applied.

### One thing to verify after applying

`activity_logs` carries `force row level security` and has **no insert policy**.
The audit functions are `SECURITY DEFINER` and therefore write as their owner,
which in a Supabase project is `postgres` — a role that holds `BYPASSRLS`, which
is what makes the write succeed despite `FORCE`. This is the identical mechanism
`log_lead_status_change` in `20260814000100` already relies on, so P2 introduces
no new assumption. **It has never been executed**, because neither migration has
been applied. Section 9c of the verification file proves it in one query: create
an opportunity, change its stage, and read back the two `activity_logs` rows. If
they are absent, the same is true of the lead pipeline's trigger and both need
the same fix.

## 7. Privileges

```
revoke all on table <each new table> from anon;
grant  select, insert, update, delete on table <each new table> to authenticated;
revoke all on function portal_sales_summary(), portal_revenue_attribution(text) from public, anon;
grant  execute on those functions to authenticated;
```

Guarded by `if exists (select 1 from pg_roles where rolname = …)`, so the file
also runs on a bare Postgres. This is defence in depth, not the control: RLS is
the control, and an unauthenticated caller is now refused by the privilege system
*before* RLS is consulted. Verification section 3 asserts `anon` holds nothing.

## 8. Rollback strategy

`supabase/checks/revenue-operations-rollback.sql`, in order: triggers →
functions → tables → columns and constraints → types. It is safe to run more
than once and it prints two confirmation queries at the end.

**It destroys data.** Between applying the migration and using the Portal it is
lossless. After a single opportunity exists, section 0 of that file lists the
exports to take first. The one thing it cannot undo is the six `project_status`
labels; it moves any row using them back to a legacy value so nothing depends on
them.

## 9. What this migration deliberately does not do

* No `not null` without a default on an existing table.
* No unique constraint on any existing column.
* No data migration, no backfill, no invented history. There are no fabricated
  lost reasons, no reconstructed activity entries and no demo opportunities.
* No change to `leads` at all. The head of the chain is untouched.
* No cascade from `opportunities` to `leads` — `on delete set null`, because §41
  requires that a converted lead is never deleted and, if one ever were, losing
  the deal with it would be worse.
* No currency conversion. There is no rate anywhere in this schema, so every
  monetary aggregate is grouped **by currency** and nothing sums across.

---

## Verdict

The migration is additive in every statement, invalidates no existing row,
takes no exclusive lock, is reversible except for six inert enum labels, and its
two aggregate functions run under the caller's own row-level security. The one
behaviour that cannot be proved without a database — that a `SECURITY DEFINER`
trigger can write to a `FORCE`d `activity_logs` — is pre-existing, is shared with
the already-pending lead-pipeline migration, and is the first check in the
verification file.

**MIGRATION SAFE FOR REVIEW**

*It must be applied by hand, in the Supabase SQL editor, after
`20260814000100_lead_pipeline.sql`. Nothing in this phase applies it
automatically.*

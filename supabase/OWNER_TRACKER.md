# Owner access, the project tracker and the Impact Program

Phase 1 of the tracker plan: the designated owner, checkpoints, closing and
reopening, and the one-off celebration. Phase 2 (§9): the separate Impact
pipeline and Impact projects, built on phase 1. Nothing here has been applied
to the production database or deployed, and no invitation has been sent. This
file is the runbook for doing so. **The complete apply order for all five phases
is `PORTAL_RELEASE.md`** (§10 below covers phases 1–2 only).

Phase 1
- Migrations: `migrations/20260928000100_owner_tracker_enums.sql`,
  `…000200_owner_tracker.sql`, `…000300_owner_lockdown.sql`
- Checks: `checks/owner-tracker-preflight.sql`, `checks/owner-tracker-verify.sql`
- Rollbacks: `checks/owner-lockdown-rollback.sql`, `checks/owner-tracker-rollback.sql`
- Tests: `tests/portal-owner-db.spec.ts` (real Postgres via PGlite),
  `tests/portal-tracker.spec.ts` (pure rules and source contracts),
  `scripts/portal-tracker-check.mjs` (rendered UI against mock data)

Phase 2
- Migrations: `migrations/20260929000100_project_links_url_check.sql` (the
  separate link fix, §7), `…000200_impact_enums.sql`, `…000300_impact_program.sql`
- Checks: `checks/impact-preflight.sql`, `checks/impact-verify.sql`
- Rollback: `checks/impact-rollback.sql`
- Tests: `tests/portal-impact-db.spec.ts` (PGlite), `tests/portal-impact.spec.ts`
  (pure rules, source contracts), the `impact:` checks in
  `scripts/portal-tracker-check.mjs`

---

## 1. What is known about production, and what is not

Probed on 2026-09-27 with the **public anon key only**, read-only `GET`/`POST
rpc` requests. A `42501 permission denied` proves an object exists and anon may
not use it; `PGRST205`/`PGRST202` proves it does not exist; `42703` proves a
column is missing; `22P02` proves an enum value is missing.

**Verified**

| Fact | Evidence |
| --- | --- |
| `projects` has the P2 columns (`service, value, currency, opportunity_id, responsible_id, payment_state, paid_amount, completed_at, archived_at`) | `200 []`; a made-up column returns `42703` on the same table |
| `project_status` has `completed` and `client_review` | filter returns `200`; a made-up value returns `22P02` |
| `organizations` has `acquisition_source, primary_service, archived_at` | `200 []` |
| `lead_notes` exists with its columns; `lead_status` has `proposal` | `200` |
| `opportunities`, `client_contacts`, `project_milestones`, `project_costs`, `record_notes` exist | `42501`, not `PGRST205` |
| `portal_sales_summary()` and `portal_revenue_attribution()` exist | `42501 permission denied for function` |
| `is_staff()` exists and answers `false` to anon | `200 false` |
| none of this phase's objects exist (`is_owner`, `program` column…) | `PGRST202` / `42703` |

**Not verified — assumptions until the preflight is run**

- The column set of the anon-revoked tables (e.g. `project_milestones.state`,
  `due_on`), the `milestone_state` labels, every policy, trigger and grant to
  `authenticated`. A `42501` says the table exists, nothing more.
- That production was migrated from exactly these files (the
  `_build/reports/portal-sales-live` report still says "NOT APPLIED" and was
  evidently overtaken; its `PENDING` sections were never filled in).
- Who holds which role, how many super_admins exist, and whether any
  `project_members` rows or client profiles with an `organization_id` exist.
- The hosted Postgres version and whether the `postgres` role has `BYPASSRLS`
  (the tests run as a superuser; the migrations are written to work either way).

`checks/owner-tracker-preflight.sql` answers every one of these from inside the
database. Run it first; any `false` in its first result stops the rollout.

---

## 2. Apply order — and why it cannot lock the owner out

Each step is a separate run in the Supabase SQL editor.

1. **Preflight** — `checks/owner-tracker-preflight.sql`. Read-only. Review:
   every object present; the policy list (anything not named in
   `…000300_owner_lockdown.sql` is an extra path to review first); the staff
   list (these accounts will lose project access in step 5).
2. **Enum** — `…000100_owner_tracker_enums.sql`, alone, and let it commit.
3. **Tracker** — `…000200_owner_tracker.sql`. Adds the owner table and
   functions, the checkpoint fields and rules, the close rule and the
   templates. Changes nobody's access to existing data.
4. **Designate the owner** (see §3).
5. **Lockdown** — `…000300_owner_lockdown.sql`. It **refuses to run** unless an
   owner is designated and that account is a `super_admin`, so it cannot be
   applied in an order that locks everyone out.
6. **Verify** — `checks/owner-tracker-verify.sql`. Impersonates the owner and
   every other account inside a transaction that ends in `ROLLBACK`. Every row
   must read `ok`.
7. **Deploy the Portal.** Before step 3 the new Portal hides the tracker from
   everyone (the `is_owner` call fails, and the flag fails closed); after step
   4 it shows it to the owner. Deploying the old Portal after step 5 leaves
   admins with empty project screens, not errors.

---

## 3. Designating the owner

The owner is a row in `portal_owner`, not a role. `super_admin` alone is not
enough: a super_admin can grant that role to someone else, and a second
super_admin must not see the tracker.

Prerequisites: the account has signed in to the Portal once (so it has a
profile) and its role is `super_admin`.

```sql
select portal_set_owner('<the email you sign in with>');
```

- Refuses an unknown email, an email that matches two profiles, and any role
  other than `super_admin`. Matching is case- and whitespace-insensitive.
- Running it again with another email **replaces** the owner; there is only
  ever one row.
- It is executable only from the SQL editor. Both browser-facing API roles
  (`anon`, `authenticated`) have had `EXECUTE` revoked, and `portal_owner` has
  no grants to them at all. The server-side secret key is deliberately not
  restricted: by Supabase's design it bypasses RLS and holds every grant, it
  lives only in the Netlify functions, and none of them touches this table.
  Revoking from it would be a promise the platform does not keep.
- `is_owner()` is true only while the designated account is still a
  `super_admin`. If that account is demoted, the tracker closes until the role
  is restored — it does not stay open to an account no longer trusted with the
  rest of the portal.

No owner email is written anywhere in this repository.

### Local development without the production owner

Nothing needs the production owner:

- `npx playwright test tests/portal-owner-db.spec.ts` builds a fresh database,
  creates a test owner and designates it with the same function.
- `node scripts/portal-tracker-check.mjs` drives the UI with a mocked
  `is_owner = true` (and a mocked `false` for the non-owner checks).
- Against a separate development Supabase project: sign in once, promote that
  account (`update profiles set role = 'super_admin' where email = …`), then
  `select portal_set_owner('…')` in that project.

---

## 4. Rollback

Both scripts change behaviour and policies only. No row written in the meantime
is deleted.

1. `checks/owner-lockdown-rollback.sql` restores, name for name, the previous
   policies on `projects`, `project_milestones`, `project_costs`,
   `project_links`, `project_members`, `record_notes`, `activity_logs`.
2. `checks/owner-tracker-rollback.sql` removes the close rule, the checkpoint
   freeze and the blocked constraint. It keeps the new columns and their
   values, every template, `portal_owner` and its functions, and every
   `waiting_client` checkpoint (an enum value cannot be dropped, and rewriting
   those rows would invent history — the old Portal shows the raw state name).

Both are exercised in `tests/portal-owner-db.spec.ts`, including re-applying
the lockdown after a rollback.

---

## 5. Decisions this phase made

- **Closed = `status = 'completed'`**, set only by the close rule. **Archived =
  `archived_at`**, untouched, and archived projects appear in neither view.
  **Payment** is independent of both; closing never reads it.
- **A project with no checkpoints cannot be closed.** "Every step is done" is
  vacuously true of an empty list. Add one checkpoint (e.g. "Handover") and mark
  it done.
- **A project cannot be inserted as `completed`.**
- **`completed_at` is the database's.** Stamped on close, kept on later edits of
  a closed project, cleared on reopen. The Portal no longer sends it.
- **A closed project's checkpoints are frozen** (insert, update, delete) until
  it is reopened, so "closed" keeps meaning "every checkpoint was done".
- **Blocked** requires both a reason and a next step (a `CHECK`, added `NOT
  VALID` and validated only if no legacy blocked row lacks them). Leaving
  `blocked` clears the reason; the next step is kept.
- **Checkpoint assignee is free text** — most people responsible for a step
  (the client, a collaborator) have no portal account.
- **Templates are copied**, never linked. Editing or retiring one never touches
  an existing project. Retired, not deleted.
- **Late, waiting on client and blocked** are three separate signals, derived
  from the checkpoints (`trackerOf` in `portal/src/lib/pipeline.ts`).
- **The celebration** fires from the write, not from state: only when the
  database returns the row that actually moved (`.neq('status','completed')`
  on close, `.neq('stage','won')` on a win). A refused save, a repeat save, a
  reload or a revisit cannot trigger it. Under `prefers-reduced-motion: reduce`
  only the status line is shown. Creating a deal that is already `won` is not
  a transition and does not celebrate.

---

## 6. Access paths after the lockdown

| Path | Owner | Any other role |
| --- | --- | --- |
| `projects`, `project_milestones`, `project_costs`, `project_links` | all | nothing (RLS) |
| `project_members` | all | own membership rows only (project id, nothing else) |
| `record_notes` with `entity_type = 'project'` | all | nothing; opportunity/client notes unchanged |
| `activity_logs` with `entity_type = 'project'` | all | nothing; other events unchanged for admins |
| `checkpoint_templates` | all | nothing |
| `portal_sales_summary()` `projects_*` buckets | counted | absent (SECURITY INVOKER) |
| `portal_owner`, `portal_set_owner()` | no API access | no API access |
| Netlify functions | none of them read project data | — |
| Views | none exist | — |

Leads, opportunities, clients and contacts keep their previous rules. On
screen: non-owners get no Projects navigation, the project routes redirect, and
the Dashboard, client list, client detail and won-deal panel do not send a
project query at all (they say "Private to the portal owner" where a count
would otherwise be).

---

## 7. A pre-existing defect: found in phase 1, fixed in phase 2

`project_links.url` was checked with `'^https?://[^\s]{3,500}$'`
(`20260816000100_revenue_operations.sql`). Postgres regexes cap a repetition
count at 255, so the check raised `2201B invalid regular expression: invalid
repetition count(s)` on **every** insert: no project link could be stored.

- **Reproduced** before any change, on PostgreSQL 18.3 (PGlite): `{3,255}`
  compiles, `{3,256}` and `{3,500}` do not; an insert against the shipped check
  fails (`tests/portal-impact-db.spec.ts` → "project_links.url" asserts the
  failure first). The limit is in the regex engine every Postgres ships, so the
  hosted project is expected to behave the same — not observed there.
- **Fixed** separately, in `20260929000100_project_links_url_check.sql`: one
  drop-if-exists and one add. Same rule without a large repetition count:
  `^https?://[^[:space:]]{3,}$` and at most 500 characters after the scheme.
  Idempotent; independent of every other migration of that date.
- **Checked** with valid URLs (http, https, upper case, path/query/fragment,
  non-ASCII path, exactly 3 and exactly 500 characters after the scheme) and
  invalid ones (`javascript:`, `ftp:`, bare host, 2 and 501 characters, inner
  space, trailing newline, leading space, empty). The phase-1 harness now applies
  this file instead of its own workaround.
- Not in `impact-rollback.sql`: restoring a check that cannot compile would only
  break link writes again.

---

## 8. Recorded for later phases (not built)

- ~~Impact~~ and ~~archiving vs. delivered support~~: built in phase 2 (§9).
- ~~Documents are private by default~~: the owner's private library is built in
  phase 3 — see `DOCUMENTS.md`. ~~Sharing~~ per client account, file or folder,
  revocably: built in phase 4 — see `CLIENT_PORTAL.md`.
- ~~Clients upload through a separate "Nyersanyag leadása" surface~~ and never
  see internal project data: built in phase 4 (`CLIENT_PORTAL.md`).
- **Upload safety cannot rest on the extension or the browser-supplied MIME
  type alone** — check the stored object's size and magic bytes server-side.
  Phase 3 checks size server-side and content in the browser (`DOCUMENTS.md`
  §3); the server-side content check of CLIENT uploads is still open.
- ~~**Payment schedule:** choose ONE source of truth for the paid total~~: built
  in phase 5 (`20261002000100_payment_schedule.sql`) — the three single-sum
  columns are derived from instalments and payments for every project and a
  disagreeing write is refused. The full release order for phases 1–5 is
  **`PORTAL_RELEASE.md`**.

---

## 9. Phase 2 — the Impact Program

### 9.1 What it is

| Piece | Where | Rule |
| --- | --- | --- |
| Application pipeline | `impact_applications` | One row per Impact lead (`lead_id` unique). States: applied, review, consultation, accepted, project_started, rejected, deferred. Answers and contact stay on the lead. |
| Capture | `leads_impact_capture` (AFTER INSERT on `leads`) | An Impact submission is in the pipeline when its insert commits. `on conflict (lead_id) do nothing`. |
| "Is this Impact?" | `lead_is_impact(form_type, source)` | `form_type = 'impact'`, or legacy `form_type is null and source = 'impact'`. `service_interest` is not a signal. |
| The wall | `opportunities_not_impact` | An opportunity cannot be inserted — or re-pointed — at an Impact lead or with `form_type = 'impact'`. Any role, any path. |
| Relabel guard | `leads_program_fixed` | A lead cannot be moved into or out of Impact by editing `form_type`/`source`. |
| Programme | `projects.program` (`paid`/`impact`) | Fixed at creation (`projects_program_fixed`). |
| Free | `projects_impact_free_check` | Impact: fee null/0, nothing invoiced or paid, `payment_state = not_invoiced`, no opportunity, HUF. `project_costs` unrestricted. |
| Market value | `projects.market_value bigint` | Whole HUF, Impact only. `NULL` = not recorded ≠ 0. Every change logged old → new (`project.market_value_changed`). |
| Close | `project_close_rules` (replaced) | Phase-1 rule + an Impact project needs a market value to close, and a closed one keeps it. |
| Fell through | `project_status = 'cancelled'` | Neither committed nor delivered. Offered in the UI for Impact projects only. |
| Start | `impact_start_project(...)` | Accepted → (new or existing client) → project → template checkpoints → `project_started`. One transaction, row-locked, a retry returns the same project. No login, no invitation. |
| No orphans | `projects_impact_application` (deferred constraint trigger) | An Impact project exists only if an application points at it, checked at commit. |
| Counters | `impact_support_summary()` | Committed = market value of Impact projects not completed/cancelled; delivered = completed; plus the count still missing a value. `archived_at` is never read. |
| Paid separation | `portal_sales_summary()`, `portal_revenue_attribution()` (replaced) | Project buckets count paid only (`cancelled` = closed); attribution's lead side excludes Impact leads. GA4/web traffic untouched. |
| Legacy | `impact_sync_applications()`, `impact_legacy_conflicts()` | Backfill (re-runnable, SQL-editor only) and the conflict list. |

### 9.2 Existing Impact leads

The migration runs `impact_sync_applications()` once. Each Impact lead with no
application **and no opportunity** becomes an application (`origin =
'backfill'`, its date = the lead's date), status mapped and the original kept in
`legacy_lead_status`:

| lead status | new, | contacted | qualified, proposal | won | lost, spam |
| --- | --- | --- | --- | --- | --- |
| application | applied | review | consultation | accepted | rejected |

An Impact lead that **already has an opportunity** is a conflict: not captured,
not reclassified, nothing deleted; the deal and its projects keep working as
paid. They are listed by `impact_legacy_conflicts()` (on the Impact screen, and
in `impact-preflight.sql` §4) for the owner to decide by hand. Leads that only
*mention* Impact in free text are listed in preflight §5 and left alone.

Re-running the sync — or the whole migration — adds nothing twice (tested).

### 9.3 Decisions this phase made

- **The lead is the record; the application is derived.** Nothing the applicant
  wrote is copied. `lead_id` is `on delete restrict`: the original is kept.
- **The capture cannot lose a lead.** Its insert is wrapped: a failure becomes a
  Postgres `WARNING` and the lead is stored. Such a lead shows as "not in the
  pipeline" on the Impact screen and fails `impact-verify.sql`;
  `select * from impact_sync_applications();` repairs it. This is the only
  exception handler in the phase, and why is in the migration.
- **`impact_applications` is RLS-enabled but not FORCED**, unlike the other
  private tables: the capture writes as the function owner, whose BYPASSRLS on
  the hosted project is unverified (§1). API roles are bound by the policies
  either way.
- **No API insert or delete on applications.** Select/update for the owner only.
- **"Project started" cannot be set by hand** (CHECK: started ⇔ project linked);
  once started, the application's status and project are fixed.
- **An Impact project cannot be deleted** while its application points at it
  (`on delete restrict`): cancel it instead.
- **Legacy phase statuses** (discovery…archived) are refused on Impact projects,
  so the counters never have to guess.
- **Legacy conflicts stay paid** in every paid figure until the owner decides.
- **Impact leads remain visible in Leads to staff**, as before (lead RLS is
  unchanged); the lead screen shows an Impact notice instead of "Convert to
  opportunity". Hiding them from non-owner staff would be a lead-RLS change and
  was not made.
- **UI language**: the Portal is English, so the pipeline states read Applied,
  In review, Consultation, Accepted, Project started, Rejected, Deferred. The
  applicant's answers are shown under the form's own Hungarian questions.
- **The celebration** is the phase-1 one, unchanged: the Impact close goes
  through the same `close()` and the same guarded `.neq('status','completed')`.

### 9.4 Access after phase 2

| Path | Owner | Any other role |
| --- | --- | --- |
| `impact_applications` | select, update | nothing (RLS); anon: no grant |
| Impact projects, market values, their checkpoints/costs/links/notes | all | nothing (phase-1 lockdown) |
| `activity_logs` with `entity_type = 'impact_application'` | all | nothing |
| `impact_support_summary()` | figures | zeros (invoker, sees no project); anon: no execute |
| `impact_legacy_conflicts()` | rows | empty (`is_owner()` filter); anon: no execute |
| `impact_start_project()` | allowed | `42501`; anon: no execute |
| `impact_sync_applications()` | SQL editor only | no execute |
| Portal `/impact`, `/impact/applications/:id` | shown | redirected; no Impact request is sent |

### 9.5 Rollback

`checks/impact-rollback.sql`: removes the triggers, the Impact-only constraints,
the Impact close addition and the paid-only filters (functions restored verbatim
from the earlier migrations), restores the phase-1 activity policy, and revokes
the Impact functions from `authenticated`. Keeps every application, every Impact
project and market value, `program`, `cancelled`, and the link fix. Re-applying
`…000300` afterwards is safe and captures what arrived meanwhile (tested).

### 9.6 What was verified, and what was not

**Verified locally (PGlite — real Postgres 18.3, not Supabase):** backfill
mapping and conflicts; ambiguous rows untouched; capture on insert; replay and
re-run without duplicates; capture failure keeps the lead and the sync repairs
it; the wall for admin, owner, second super_admin and superuser; relabel guard;
free-check on every money field; program fixed; no orphan Impact project; start
rolls back fully on failure; retry returns the same project; existing-client
attach; non-owners refused; market value null ≠ 0, logged old → new; close
refused without a value; close/reopen/archive/cancel move the counters as
specified; costs still recordable; paid close unchanged; attribution and
delivery buckets paid-only; every non-owner role reads and writes nothing;
no definer function reads projects or applications; no views; preflight is
read-only; verify all `ok` and FAILs on a missing capture; rollback keeps data;
the link fix. **Rendered (mocked PostgREST):** counters, missing-value warning,
lists, application screen, one RPC per double click, close gate, confetti once /
not on reload / not under reduced motion, no conversion on an Impact lead,
nothing for a non-owner.

**Not verified:** anything against the hosted Supabase project, PostgREST or
GoTrue (no call was made in phase 2); truly concurrent start calls (one PGlite
connection — the row lock is written but not exercised); the Netlify function
inserting an Impact lead end to end; the hosted `postgres` role's BYPASSRLS
(preflight §2 reports it).

---

## 10. Apply order, both phases

Each step is a separate run in the Supabase SQL editor unless marked.

1. `checks/owner-tracker-preflight.sql` — read-only; any `false` stops.
2. `20260928000100_owner_tracker_enums.sql` — alone; let it commit.
3. `20260928000200_owner_tracker.sql`
4. `select portal_set_owner('<email>');` (§3)
5. `20260928000300_owner_lockdown.sql` — refuses without step 4.
6. `checks/owner-tracker-verify.sql` — every row `ok`.
7. `checks/impact-preflight.sql` — read-only. First result all `true`; review
   the lead-by-lead outcome, the conflicts and the ambiguous rows.
8. `20260929000100_project_links_url_check.sql` — independent; may also run any
   time after `20260816000100`.
9. `20260929000200_impact_enums.sql` — alone; let it commit.
10. `20260929000300_impact_program.sql` — refuses without steps 4-5 and 9.
    Prints `(captured, conflicts)` from the backfill.
11. `checks/impact-verify.sql` — every row `ok`.
12. **Deploy the Portal** (not SQL). The new Portal reads `projects.program` and
    `projects.market_value`; deployed before step 10, the project screens show a
    read error and the Dashboard's project block is empty. Deploy after it.

Undo in reverse: `impact-rollback.sql`, then (if needed)
`owner-lockdown-rollback.sql`, `owner-tracker-rollback.sql`.

Phase 3 (the document library) continues at step 12: `DOCUMENTS.md` §7. Phase 4 (client
accounts, sharing, "Nyersanyag leadása") continues at step 19: `CLIENT_PORTAL.md` §7. Its
rollback (`documents-rollback.sql`) comes first when undoing everything.

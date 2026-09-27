-- =============================================================================
-- Stratos — Impact, step 2 of 2: its own pipeline, its own projects
--
-- The Impact Program is free, always. An application arrives through the public
-- Impact form, is judged in its OWN pipeline, and — if accepted — becomes a
-- project tracked with exactly the checkpoints, templates, signals and close
-- rule a paid project uses. It never becomes a paid deal and never touches the
-- sales pipeline, the forecast or the paid lead-conversion figures.
--
--   1. vocabulary     `impact_status`, `lead_is_impact()`
--   2. projects       `program` (paid | impact), `market_value` (whole HUF),
--                     "an Impact project is free" as a CHECK, the program is
--                     fixed at creation, no close without a market value, and
--                     every market-value change is logged old → new
--   3. applications   `impact_applications`: one row per Impact lead, pointing
--                     at the untouched lead (answers and contact stay THERE)
--   4. capture        a trigger on `leads`: an Impact submission lands in the
--                     pipeline at insert time, idempotently
--   5. the wall       an Impact lead can never become an opportunity — enforced
--                     on `opportunities`, so no client, script or PATCH can
--   6. backfill       existing Impact leads, conflicts reported not resolved
--   7. start          `impact_start_project()`: create (or attach) the client,
--                     create the project, copy the checkpoints and mark the
--                     application started — one transaction, retry-safe
--   8. counters       `impact_support_summary()`: committed and delivered
--                     support, computed from the projects every time
--   9. separation     the paid aggregates stop counting Impact
--  10. access         owner-only, like every other project path
--
-- WHAT THIS DOES NOT DO
-- ---------------------
-- No DROP TABLE / TYPE / COLUMN, no TRUNCATE, no DELETE. No existing lead,
-- opportunity or project is rewritten or reclassified. The only rows written
-- are new `impact_applications` rows for existing Impact leads that have NO
-- opportunity; a lead that already has one is a conflict, listed by
-- `impact_legacy_conflicts()` and left exactly as it is.
--
-- Run after 20260929000200_impact_enums.sql has COMMITTED. Refuses to run until
-- the owner lockdown (20260928000300) is in place — see §0.
-- =============================================================================


-- ###########################################################################
-- 0. PRECONDITIONS
-- ###########################################################################

-- Market values and the Impact pipeline are the owner's. They live on
-- `projects`, so they are exactly as private as `projects` is — which is only
-- true after the lockdown. Applied before it, every admin would read them.
do $$
declare
  owner_role user_role;
  extra text;
begin
  select p.role into owner_role
  from portal_owner o join profiles p on p.id = o.user_id;
  if owner_role is distinct from 'super_admin' then
    raise exception 'No portal owner who is a super_admin is designated. Apply the owner tracker (20260928000100-0300) and portal_set_owner() first.';
  end if;

  if not exists (select 1 from pg_policies
                 where schemaname = 'public' and tablename = 'projects' and policyname = 'projects_owner_all') then
    raise exception 'The owner lockdown (20260928000300_owner_lockdown.sql) is not applied. Impact market values would be readable by every admin.';
  end if;

  select string_agg(policyname, ', ') into extra
  from pg_policies
  where schemaname = 'public' and tablename = 'projects' and policyname <> 'projects_owner_all';
  if extra is not null then
    raise exception 'projects carries policies besides projects_owner_all (%). Review them before exposing market values.', extra;
  end if;

  if not exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
                 where t.typname = 'project_status' and e.enumlabel = 'cancelled') then
    raise exception 'project_status has no ''cancelled'' value. Apply 20260929000200_impact_enums.sql first, alone.';
  end if;
end $$;


-- ###########################################################################
-- 1. VOCABULARY
-- ###########################################################################

-- The application pipeline. Its own enum, not `lead_status` and not
-- `opportunity_stage`: an Impact application is judged, not sold, and sharing a
-- column with either would put it on a board it must never appear on.
--
--   applied          arrived through the form (or was backfilled)
--   review           being assessed
--   consultation     talking it through with the applicant
--   accepted         yes — a project may now be started from it
--   project_started  a project exists; set ONLY by impact_start_project()
--   rejected         no
--   deferred         not now; kept for a later round
--
-- A new type may be used in the transaction that creates it (only ADD VALUE on
-- an existing type may not), so this lives here rather than in step 1.
do $$ begin
  create type impact_status as enum
    ('applied', 'review', 'consultation', 'accepted', 'project_started', 'rejected', 'deferred');
exception when duplicate_object then null; end $$;

-- ONE definition of "this lead came from the Impact form", used by the capture
-- trigger, the guard on opportunities, the backfill and the paid aggregates.
--
-- `form_type` is the checked value the envelope writes. Rows older than the
-- envelope migration have no `form_type`, only the free-text `source`, which
-- the pre-envelope form set to the same word. `service_interest = 'Impact
-- Program'` is deliberately NOT a signal: it is free text on legacy rows, and a
-- guess here would move somebody's paid enquiry out of the sales pipeline.
-- The preflight lists those rows for a human to look at instead.
create or replace function lead_is_impact(p_form_type text, p_source text)
returns boolean language sql immutable as $$
  select coalesce(p_form_type = 'impact', false)
      or (p_form_type is null and lower(btrim(coalesce(p_source, ''))) = 'impact')
$$;

comment on function lead_is_impact is
  'True for a lead from the Impact form: form_type = impact, or (legacy rows with no form_type) source = impact.';


-- ###########################################################################
-- 2. PROJECTS  —  paid or impact, and what "free" means in the database
-- ###########################################################################

-- `program` is the one classification. Every existing row is `paid`, which is
-- what every existing row is. Constant default, so no table rewrite.
alter table projects add column if not exists program text not null default 'paid';

do $$ begin
  alter table projects add constraint projects_program_check
    check (program in ('paid', 'impact'));
exception when duplicate_object then null; end $$;

-- What the support WOULD have cost, in whole forints. Not revenue, not an amount
-- owed, not a receivable: it feeds the two support counters and nothing else.
-- NULL is "not recorded yet", which is a different fact from 0 and is shown as
-- such. Only an Impact project carries one.
alter table projects add column if not exists market_value bigint;

do $$ begin
  alter table projects add constraint projects_market_value_check
    check (market_value is null
           or (market_value between 0 and 1000000000000 and program = 'impact'));
exception when duplicate_object then null; end $$;

-- FREE, in the database. An Impact project has no fee (null or 0), nothing
-- invoiced, nothing paid, no payment progress, no sale behind it, and is kept
-- in HUF so its market value is never read in another currency. Internal costs
-- are NOT restricted: free to the client is not free to deliver, and
-- `project_costs` keeps working exactly as for a paid project.
--
-- Every existing row is `paid`, so this validates immediately.
do $$ begin
  alter table projects add constraint projects_impact_free_check
    check (program <> 'impact' or (
      coalesce(value, 0) = 0
      and coalesce(invoiced_amount, 0) = 0
      and coalesce(paid_amount, 0) = 0
      and payment_state = 'not_invoiced'
      and opportunity_id is null
      and currency = 'HUF'));
exception when duplicate_object then null; end $$;

-- An Impact project uses the tracker's states plus `cancelled`. The pre-P2 phase
-- values (discovery, design, …, archived) predate Impact and would make the
-- counters guess whether such a project is in progress.
do $$ begin
  alter table projects add constraint projects_impact_status_check
    check (program <> 'impact' or status::text in
      ('planned', 'active', 'client_review', 'blocked', 'on_hold', 'completed', 'cancelled'));
exception when duplicate_object then null; end $$;

create index if not exists projects_program_idx on projects (program, status);

comment on column projects.program is
  'paid | impact. Fixed at creation. Impact projects are free: no fee, invoice, payment or opportunity (projects_impact_free_check).';
comment on column projects.market_value is
  'Impact only. What the donated work would have cost, whole HUF. NOT revenue, NOT owed. NULL = not recorded yet (distinct from 0).';

-- The program is decided once. Turning an Impact project paid would bill a free
-- engagement; turning a paid one Impact would erase revenue. Either is a new
-- project, not an edit.
create or replace function project_program_fixed() returns trigger
  language plpgsql set search_path = public
as $$
begin
  if new.program is distinct from old.program then
    raise exception 'stratos:project_program_fixed'
      using errcode = 'P0001',
            hint = 'A project is paid or Impact from the day it is created. Create a new project instead.';
  end if;
  return new;
end;
$$;

drop trigger if exists projects_program_fixed on projects;
create trigger projects_program_fixed
  before update of program on projects
  for each row execute function project_program_fixed();

-- THE CLOSE RULE, extended. Everything 20260928000200 says still holds; one
-- rule is added: an Impact project cannot be closed without a market value,
-- and a closed one cannot lose it. "Support delivered" is the sum of closed
-- projects' market values, and a delivered project with no value would make
-- that figure silently short. The Portal says what is missing before the
-- database has to.
create or replace function project_close_rules() returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  total      integer := 0;
  open_steps integer := 0;
begin
  if new.status = 'completed'
     and (tg_op = 'INSERT' or old.status is distinct from 'completed') then
    if tg_op = 'UPDATE' then
      select count(*), count(*) filter (where state <> 'done')
        into total, open_steps
      from project_milestones where project_id = new.id;
    end if;

    if total = 0 then
      raise exception 'stratos:project_close_no_checkpoints'
        using errcode = 'P0001',
              hint = 'A project needs at least one checkpoint, all done, before it can be closed.';
    end if;
    if open_steps > 0 then
      raise exception 'stratos:project_close_open_checkpoints'
        using errcode = 'P0001',
              detail = format('%s of %s checkpoints are not done.', open_steps, total),
              hint = 'Finish every checkpoint before closing the project.';
    end if;
    if new.program = 'impact' and new.market_value is null then
      raise exception 'stratos:impact_close_no_market_value'
        using errcode = 'P0001',
              hint = 'Record the market value of the donated work before closing an Impact project.';
    end if;

    new.completed_at := now();
  elsif new.status = 'completed' then
    if new.program = 'impact' and new.market_value is null then
      raise exception 'stratos:impact_close_no_market_value'
        using errcode = 'P0001',
              hint = 'A closed Impact project keeps its market value. Change it, or reopen the project first.';
    end if;
    new.completed_at := old.completed_at;
  else
    new.completed_at := null;
  end if;

  return new;
end;
$$;

comment on function project_close_rules is
  'Closing = status completed. Requires >= 1 checkpoint, all done, and (Impact) a market value. Stamps completed_at; clears it on reopen.';

-- Every market-value change, old → new, into the audit log. Its own trigger
-- rather than a branch of log_business_change(): that function records ONE
-- event per update, and a status change in the same save would hide this one.
create or replace function log_project_market_value() returns trigger
  language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' and new.market_value is null then
    return null;
  end if;
  if tg_op = 'UPDATE' and new.market_value is not distinct from old.market_value then
    return null;
  end if;
  insert into activity_logs (user_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'project.market_value_changed', 'project', new.id,
    jsonb_build_object(
      'from', case when tg_op = 'UPDATE' then old.market_value end,
      'to', new.market_value,
      'currency', 'HUF'));
  return null;
end;
$$;

drop trigger if exists projects_market_value_audit on projects;
create trigger projects_market_value_audit
  after insert or update of market_value on projects
  for each row execute function log_project_market_value();


-- ###########################################################################
-- 3. APPLICATIONS
-- ###########################################################################

-- One row per Impact lead. It holds the pipeline state and the link to the
-- project, and NOTHING the applicant wrote: the answers stay in `leads.payload`
-- and `leads.message`, the contact in `leads.name/email/phone`, exactly as the
-- form stored them. One copy of somebody's personal data, not two.
--
--   lead_id          unique — the idempotency key of the whole capture path.
--                    `on delete restrict`: the original submission is kept.
--   project_id       unique — one application, one project, never two.
--                    `on delete restrict`: an Impact project that fell through
--                    is `cancelled`, not deleted.
--   origin           form | backfill
--   legacy_lead_status  the lead's status when it was backfilled, for review
create table if not exists impact_applications (
  id                 uuid primary key default gen_random_uuid(),
  lead_id            uuid not null unique references leads(id) on delete restrict,
  status             impact_status not null default 'applied',
  status_changed_at  timestamptz not null default now(),
  decision_note      text check (decision_note is null or length(btrim(decision_note)) <= 2000),
  organization_id    uuid references organizations(id) on delete set null,
  project_id         uuid unique references projects(id) on delete restrict,
  origin             text not null default 'form' check (origin in ('form', 'backfill')),
  legacy_lead_status text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  -- "Project started" and "has a project" are the same fact, stated twice so
  -- neither can be set without the other.
  constraint impact_applications_started_check
    check ((status = 'project_started') = (project_id is not null))
);

create index if not exists impact_applications_status_idx
  on impact_applications (status, created_at desc);

comment on table impact_applications is
  'The Impact pipeline. One row per Impact lead; the answers and contact stay on the lead. Owner-only.';

-- The rules a CHECK cannot say.
--
--   * the lead is fixed — an application is ABOUT one submission
--   * once a project is started, status and project are fixed: the pipeline
--     has done its job, and the project's own state (active, closed,
--     cancelled) is where the story continues
--   * a project may only be attached if it is an Impact project
--
-- SECURITY INVOKER: it runs as whoever updates the row, which through the API
-- can only be the owner (RLS), so it sees exactly the projects they may see.
create or replace function impact_application_rules() returns trigger
  language plpgsql set search_path = public
as $$
begin
  if new.lead_id is distinct from old.lead_id then
    raise exception 'stratos:impact_application_lead_fixed' using errcode = 'P0001';
  end if;

  if old.status = 'project_started'
     and (new.status is distinct from old.status or new.project_id is distinct from old.project_id) then
    raise exception 'stratos:impact_application_started'
      using errcode = 'P0001',
            hint = 'A project has been started from this application. Manage it on the project.';
  end if;

  if new.project_id is not null and new.project_id is distinct from old.project_id
     and not exists (select 1 from projects p where p.id = new.project_id and p.program = 'impact') then
    raise exception 'stratos:impact_application_project_not_impact' using errcode = 'P0001';
  end if;

  if new.status is distinct from old.status then
    new.status_changed_at := now();
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists impact_applications_rules on impact_applications;
create trigger impact_applications_rules
  before update on impact_applications
  for each row execute function impact_application_rules();

-- The pipeline's own timeline. `entity_type = 'impact_application'`, which the
-- activity policy in §10 keeps from every account but the owner.
create or replace function log_impact_application() returns trigger
  language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into activity_logs (user_id, action, entity_type, entity_id, metadata)
    values (auth.uid(), 'impact.received', 'impact_application', new.id,
            jsonb_build_object('status', new.status::text, 'origin', new.origin, 'lead', new.lead_id));
  elsif new.status is distinct from old.status then
    insert into activity_logs (user_id, action, entity_type, entity_id, metadata)
    values (auth.uid(), 'impact.status_changed', 'impact_application', new.id,
            jsonb_build_object('from', old.status::text, 'to', new.status::text, 'project', new.project_id));
  end if;
  return null;
end;
$$;

drop trigger if exists impact_applications_audit on impact_applications;
create trigger impact_applications_audit
  after insert or update of status on impact_applications
  for each row execute function log_impact_application();

-- Every Impact project was started from an application, checked at COMMIT so
-- that impact_start_project() may insert the project and then link it. A
-- project inserted with `program = 'impact'` any other way is refused, so the
-- pipeline and the project list can never disagree about what exists.
create or replace function impact_project_has_application() returns trigger
  language plpgsql set search_path = public
as $$
begin
  if not exists (select 1 from impact_applications a where a.project_id = new.id) then
    raise exception 'stratos:impact_project_without_application'
      using errcode = 'P0001',
            hint = 'Impact projects are started from an accepted application.';
  end if;
  return null;
end;
$$;

drop trigger if exists projects_impact_application on projects;
create constraint trigger projects_impact_application
  after insert on projects
  deferrable initially deferred
  for each row
  when (new.program = 'impact')
  execute function impact_project_has_application();

-- ROW LEVEL SECURITY — ENABLED, DELIBERATELY NOT FORCED.
--
-- Every other private table here is `force row level security`. This one is not,
-- and the reason is the capture path: a public form submission is inserted into
-- `leads` by the Netlify function, and the trigger in §4 writes the application
-- as the function's owner. Whether that owner (`postgres` on Supabase) holds
-- BYPASSRLS is not verified (OWNER_TRACKER.md §1). If it does not and the table
-- were forced, the owner-only policy would refuse the write, the trigger would
-- raise, and the LEAD ITSELF would be lost. Unforced, the table owner is exempt
-- and every API role is still bound by the policies below.
alter table impact_applications enable row level security;

drop policy if exists impact_applications_owner_select on impact_applications;
drop policy if exists impact_applications_owner_update on impact_applications;

create policy impact_applications_owner_select on impact_applications
  for select using (is_owner());
create policy impact_applications_owner_update on impact_applications
  for update using (is_owner()) with check (is_owner());

-- No insert and no delete through the API, for anyone: rows arrive by capture
-- or backfill, and an application is never deleted.
do $$
begin
  execute 'revoke all on table impact_applications from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table impact_applications from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table impact_applications from authenticated';
    execute 'grant select, update on table impact_applications to authenticated';
  end if;
end $$;


-- ###########################################################################
-- 4. CAPTURE  —  from the form straight into the pipeline
-- ###########################################################################

-- AFTER INSERT on `leads`. The submission path (netlify/functions/submit-lead)
-- is untouched: whatever inserts an Impact lead — the function, a replay, the
-- table editor — the application exists by the time the insert commits.
--
-- Idempotent twice over: `leads.submission_id` already refuses a replayed
-- submission, and `on conflict (lead_id) do nothing` makes a second capture of
-- the same lead (the backfill after the trigger, say) a no-op.
--
-- THE ONE EXCEPTION HANDLER IN THIS FILE, and why it is not the silent no-op
-- 20260814000100 warns about. The capture writes two rows as the function's
-- owner: the application, and its audit entry in `activity_logs` (which is
-- FORCE RLS with no insert policy). If that owner turned out not to hold
-- BYPASSRLS on the hosted project — unverified, see OWNER_TRACKER.md §1 — an
-- unguarded failure here would abort the INSERT INTO leads and the applicant's
-- submission would be lost. The lead is the record; the application is derived
-- from it and can always be derived again. So a failure is raised as a WARNING
-- (it reaches the Postgres log), the lead is stored, and the gap is visible and
-- repairable: the Impact screen counts Impact leads with no application, the
-- verify script checks for them, and `select * from impact_sync_applications();`
-- captures them.
create or replace function impact_capture_lead() returns trigger
  language plpgsql security definer set search_path = public
as $$
begin
  if lead_is_impact(new.form_type, new.source) then
    begin
      insert into impact_applications (lead_id, origin)
      values (new.id, 'form')
      on conflict (lead_id) do nothing;
    exception when others then
      raise warning 'stratos:impact_capture_failed lead=% sqlstate=% message=%', new.id, sqlstate, sqlerrm;
    end;
  end if;
  return null;
end;
$$;

drop trigger if exists leads_impact_capture on leads;
create trigger leads_impact_capture
  after insert on leads
  for each row execute function impact_capture_lead();

-- A lead cannot be relabelled into or out of Impact afterwards. Out of it would
-- launder a free application into the sales pipeline; into it would pull a
-- paid enquiry out.
create or replace function lead_program_fixed() returns trigger
  language plpgsql set search_path = public
as $$
begin
  if lead_is_impact(old.form_type, old.source) is distinct from lead_is_impact(new.form_type, new.source) then
    raise exception 'stratos:lead_program_fixed'
      using errcode = 'P0001',
            hint = 'Whether a lead is an Impact application is decided by the form it came from.';
  end if;
  return new;
end;
$$;

drop trigger if exists leads_program_fixed on leads;
create trigger leads_program_fixed
  before update of form_type, source on leads
  for each row execute function lead_program_fixed();


-- ###########################################################################
-- 5. THE WALL  —  an Impact application is never a paid deal
-- ###########################################################################

-- On `opportunities`, so it holds for "Convert to opportunity", for a direct
-- POST /rest/v1/opportunities and for the table editor alike.
--
-- Fires on INSERT and on a change of `lead_id` or `form_type` only. A legacy
-- conflict (an Impact lead that ALREADY has an opportunity) is therefore left
-- working exactly as before — editable, closable — and is reported by
-- impact_legacy_conflicts(), not silently reclassified.
--
-- SECURITY DEFINER because an admin creating a deal may not read
-- `impact_applications` (owner-only), and the check must still see it.
create or replace function opportunity_not_impact() returns trigger
  language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
     and new.lead_id is not distinct from old.lead_id
     and new.form_type is not distinct from old.form_type then
    return new;
  end if;

  if coalesce(new.form_type, '') = 'impact'
     or (new.lead_id is not null and (
           exists (select 1 from impact_applications a where a.lead_id = new.lead_id)
        or exists (select 1 from leads l where l.id = new.lead_id and lead_is_impact(l.form_type, l.source)))) then
    raise exception 'stratos:impact_not_sellable'
      using errcode = 'P0001',
            hint = 'An Impact application is free. It is handled in the Impact pipeline and cannot become an opportunity.';
  end if;
  return new;
end;
$$;

drop trigger if exists opportunities_not_impact on opportunities;
create trigger opportunities_not_impact
  before insert or update of lead_id, form_type on opportunities
  for each row execute function opportunity_not_impact();


-- ###########################################################################
-- 6. BACKFILL  —  the Impact leads that already exist
-- ###########################################################################

-- Re-runnable, and run once below. Captures every Impact lead that has no
-- application yet AND no opportunity. The lead's status is mapped onto the
-- pipeline conservatively and kept verbatim in `legacy_lead_status`:
--
--   new → applied   contacted → review   qualified, proposal → consultation
--   won → accepted  lost, spam → rejected
--
-- An Impact lead that already has an opportunity is NOT captured: it is a paid
-- deal today, and turning it into a free application — or deleting the deal —
-- is a decision about a real client, not a migration step. It is counted in
-- `conflicts` and listed by impact_legacy_conflicts().
--
-- SQL-editor only (revoked from the API roles below).
create or replace function impact_sync_applications()
returns table (captured integer, conflicts integer)
language plpgsql security invoker set search_path = public
as $$
declare
  n_captured  integer;
  n_conflicts integer;
begin
  insert into impact_applications (lead_id, status, origin, legacy_lead_status, created_at)
  select l.id,
         (case l.status::text
            when 'new'       then 'applied'
            when 'contacted' then 'review'
            when 'qualified' then 'consultation'
            when 'proposal'  then 'consultation'
            when 'won'       then 'accepted'
            else 'rejected'
          end)::impact_status,
         'backfill',
         l.status::text,
         l.created_at
  from leads l
  where lead_is_impact(l.form_type, l.source)
    and not exists (select 1 from impact_applications a where a.lead_id = l.id)
    and not exists (select 1 from opportunities o where o.lead_id = l.id)
  on conflict (lead_id) do nothing;
  get diagnostics n_captured = row_count;

  select count(*) into n_conflicts
  from leads l
  where lead_is_impact(l.form_type, l.source)
    and not exists (select 1 from impact_applications a where a.lead_id = l.id)
    and exists (select 1 from opportunities o where o.lead_id = l.id);

  return query select n_captured, n_conflicts;
end;
$$;

comment on function impact_sync_applications is
  'Idempotent: captures Impact leads with no application and no opportunity. Returns (captured, conflicts). SQL editor only.';

select * from impact_sync_applications();

-- The conflicts, for the owner: every opportunity that is tied to an Impact lead
-- or labelled Impact, with the projects hanging off it. Read-only. Empty for
-- anybody but the owner.
create or replace function impact_legacy_conflicts()
returns table (
  lead_id           uuid,
  lead_name         text,
  company           text,
  lead_created_at   timestamptz,
  opportunity_id    uuid,
  opportunity_title text,
  stage             text,
  project_ids       uuid[]
)
language sql stable security invoker set search_path = public
as $$
  select l.id, l.name, l.company, l.created_at,
         o.id, o.title, o.stage::text,
         array(select p.id from projects p where p.opportunity_id = o.id order by p.created_at)
  from opportunities o
  left join leads l on l.id = o.lead_id
  where is_owner()
    and (o.form_type = 'impact' or lead_is_impact(l.form_type, l.source))
  order by coalesce(l.created_at, o.created_at), o.created_at
$$;

comment on function impact_legacy_conflicts is
  'Impact leads that already carry a paid opportunity (and its projects). Reported, never reclassified. Owner-only.';


-- ###########################################################################
-- 7. STARTING A PROJECT  —  one transaction
-- ###########################################################################

-- From an ACCEPTED application: attach an existing client or create one,
-- create the Impact project, copy the chosen template's steps as checkpoints,
-- and mark the application `project_started` with the project linked.
--
-- ONE FUNCTION CALL IS ONE TRANSACTION. Any failure — a duplicate slug, a
-- missing client, a refused checkpoint — rolls back all of it: no client
-- without a project, no project without its application, no application
-- pointing nowhere.
--
-- RETRY-SAFE. The application row is locked first (`for update`). A double
-- click or a retried request waits for the first call, then finds the
-- application already `project_started` and returns THAT project's id. It
-- never creates a second one — and `impact_applications.project_id` is unique,
-- should anything else try.
--
-- SECURITY INVOKER: every row is written as the caller, through the same
-- owner-only policies as the Portal's own writes. It creates no login, sends
-- no invitation and touches no profile.
create or replace function impact_start_project(
  p_application    uuid,
  p_organization   uuid,
  p_client_name    text,
  p_client_slug    text,
  p_client_website text,
  p_project_name   text,
  p_project_slug   text,
  p_service        text,
  p_steps          text[]
)
returns uuid
language plpgsql security invoker set search_path = public
as $$
declare
  app impact_applications%rowtype;
  org uuid;
  proj uuid;
begin
  if not is_owner() then
    raise exception 'stratos:owner_only' using errcode = '42501';
  end if;

  select * into app from impact_applications where id = p_application for update;
  if not found then
    raise exception 'stratos:impact_application_missing' using errcode = 'P0001';
  end if;

  if app.status = 'project_started' then
    return app.project_id;
  end if;
  if app.status <> 'accepted' then
    raise exception 'stratos:impact_not_accepted'
      using errcode = 'P0001',
            hint = 'Only an accepted application can start a project.';
  end if;

  if length(btrim(coalesce(p_project_name, ''))) = 0 or length(btrim(coalesce(p_project_slug, ''))) = 0 then
    raise exception 'stratos:impact_project_name_required' using errcode = 'P0001';
  end if;

  if p_organization is not null then
    select id into org from organizations where id = p_organization;
    if org is null then
      raise exception 'stratos:impact_client_missing' using errcode = 'P0001';
    end if;
  else
    if length(btrim(coalesce(p_client_name, ''))) = 0 or length(btrim(coalesce(p_client_slug, ''))) = 0 then
      raise exception 'stratos:impact_client_name_required' using errcode = 'P0001';
    end if;
    insert into organizations (name, slug, website, status, acquisition_source, primary_service)
    values (btrim(p_client_name), btrim(p_client_slug), nullif(btrim(coalesce(p_client_website, '')), ''),
            'active', 'impact', 'Impact Program')
    returning id into org;
  end if;

  insert into projects (organization_id, name, slug, service, program, status, currency)
  values (org, btrim(p_project_name), btrim(p_project_slug),
          nullif(btrim(coalesce(p_service, '')), ''), 'impact', 'planned', 'HUF')
  returning id into proj;

  if coalesce(cardinality(p_steps), 0) > 0 then
    insert into project_milestones (project_id, title, position)
    select proj, btrim(s), (o - 1)::smallint
    from unnest(p_steps) with ordinality as x(s, o)
    where length(btrim(coalesce(s, ''))) > 0;
  end if;

  update impact_applications
     set status = 'project_started', project_id = proj, organization_id = org
   where id = app.id;

  return proj;
end;
$$;

comment on function impact_start_project is
  'Accepted application → (client) → Impact project → checkpoints → project_started. One transaction; a retry returns the same project.';


-- ###########################################################################
-- 8. THE SUPPORT COUNTERS  —  always computed, never stored
-- ###########################################################################

--   committed  market value of Impact projects still in progress: not
--              completed and not cancelled. `archived_at` is NOT read —
--              archiving is layout and changes neither figure.
--   delivered  market value of completed Impact projects.
--   missing    in-progress projects with no market value yet; they are in
--              neither sum, and the Portal says so beside the figure.
--
-- Reopening moves a project from delivered back to committed, and changing a
-- value changes the sums, because nothing here is a running total — there is
-- nothing to increment, decrement or forget. SECURITY INVOKER: for anybody
-- but the owner every figure is 0 because RLS shows them no project.
create or replace function impact_support_summary()
returns table (
  committed          bigint,
  committed_projects bigint,
  committed_missing  bigint,
  delivered          bigint,
  delivered_projects bigint,
  cancelled_projects bigint
)
language sql stable security invoker set search_path = public
as $$
  select
    coalesce(sum(p.market_value) filter (where p.status not in ('completed', 'cancelled')), 0)::bigint,
    count(*) filter (where p.status not in ('completed', 'cancelled') and p.market_value is not null),
    count(*) filter (where p.status not in ('completed', 'cancelled') and p.market_value is null),
    coalesce(sum(p.market_value) filter (where p.status = 'completed'), 0)::bigint,
    count(*) filter (where p.status = 'completed'),
    count(*) filter (where p.status = 'cancelled')
  from projects p
  where p.program = 'impact'
$$;

comment on function impact_support_summary is
  'Committed (in progress, not cancelled) and delivered (completed) Impact support, from projects.market_value. Archive-blind. SECURITY INVOKER.';


-- ###########################################################################
-- 9. THE PAID FIGURES STOP COUNTING IMPACT
-- ###########################################################################

-- portal_sales_summary(): verbatim from 20260816000100 except the projects
-- block — paid projects only, and `cancelled` reads as closed. Opportunities
-- need no filter: §5 makes an Impact opportunity impossible from now on.
create or replace function portal_sales_summary()
returns table (
  bucket   text,
  currency text,
  items    bigint,
  value    numeric,
  weighted numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with live as (
    select * from opportunities where archived_at is null
  ),
  open_opps as (
    select * from live where stage not in ('won', 'lost')
  )
  select
    'stage:' || o.stage::text,
    o.currency,
    count(*),
    coalesce(sum(o.estimated_value), 0),
    coalesce(sum(o.estimated_value * o.probability / 100.0), 0)
  from live o
  where o.stage not in ('won', 'lost')
  group by o.stage, o.currency

  union all
  select 'open', o.currency, count(*),
         coalesce(sum(o.estimated_value), 0),
         coalesce(sum(o.estimated_value * o.probability / 100.0), 0)
  from open_opps o group by o.currency

  union all
  select 'closing_month', o.currency, count(*),
         coalesce(sum(o.estimated_value), 0),
         coalesce(sum(o.estimated_value * o.probability / 100.0), 0)
  from open_opps o
  where o.expected_close_on >= date_trunc('month', current_date)::date
    and o.expected_close_on <  (date_trunc('month', current_date) + interval '1 month')::date
  group by o.currency

  union all
  select 'won_mtd', o.currency, count(*), coalesce(sum(o.estimated_value), 0), 0::numeric
  from live o
  where o.stage = 'won' and o.won_at >= date_trunc('month', current_date)
  group by o.currency

  union all
  select 'won_ytd', o.currency, count(*), coalesce(sum(o.estimated_value), 0), 0::numeric
  from live o
  where o.stage = 'won' and o.won_at >= date_trunc('year', current_date)
  group by o.currency

  union all
  select 'won_all', o.currency, count(*), coalesce(sum(o.estimated_value), 0), 0::numeric
  from live o where o.stage = 'won' group by o.currency

  union all
  select 'lost_all', o.currency, count(*), coalesce(sum(o.estimated_value), 0), 0::numeric
  from live o where o.stage = 'lost' group by o.currency

  -- Paid delivery only. Impact has its own counters (impact_support_summary).
  union all
  select 'projects_' || (case
      when p.status::text in ('blocked', 'on_hold') then 'blocked'
      when p.status::text in ('completed', 'archived', 'cancelled') then 'closed'
      else 'active' end),
    null::text, count(*), 0::numeric, 0::numeric
  from projects p
  where p.archived_at is null and p.program = 'paid'
  group by 1

  union all
  select 'clients_active', null::text, count(*), 0::numeric, 0::numeric
  from organizations c
  where c.archived_at is null and c.status = 'active';
$$;

comment on function portal_sales_summary is
  'Server-side pipeline aggregate, one row per (bucket, currency). Paid only. SECURITY INVOKER: the caller''s RLS decides what is counted.';

-- portal_revenue_attribution(): verbatim except `lead_keyed`, which no longer
-- counts Impact applications as leads. They are not paid enquiries, and a
-- channel's paid lead → qualified → won figures must not be diluted by free
-- applications. GA4 sessions are not in this function and are unchanged.
-- Opportunities are counted as before — including legacy conflicts, which
-- remain paid deals until the owner decides otherwise.
create or replace function portal_revenue_attribution(dimension text default 'source')
returns table (
  key             text,
  leads           bigint,
  qualified       bigint,
  opportunities   bigint,
  won             bigint,
  won_value       numeric,
  won_currency    text,
  won_currencies  bigint
)
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  if dimension not in ('source', 'medium', 'campaign', 'landing') then
    raise exception 'unsupported dimension %', dimension
      using errcode = 'invalid_parameter_value';
  end if;

  return query
  with lead_keyed as (
    select
      l.id,
      l.status,
      case dimension
        when 'medium'   then nullif(l.meta->>'utmMedium', '')
        when 'campaign' then nullif(l.meta->>'utmCampaign', '')
        when 'landing'  then nullif(l.meta->>'landingRoute', '')
        else coalesce(nullif(l.meta->>'utmSource', ''),
                      nullif(l.meta->>'landingReferrerHost', ''))
      end as k
    from leads l
    where l.status <> 'spam'
      and not lead_is_impact(l.form_type, l.source)
  ),
  opp_keyed as (
    select
      o.stage,
      o.estimated_value,
      o.currency,
      case dimension
        when 'medium'   then coalesce(nullif(o.medium, ''),   lk.k)
        when 'campaign' then coalesce(nullif(o.campaign, ''), lk.k)
        when 'landing'  then coalesce(nullif(o.landing_route, ''), lk.k)
        else coalesce(nullif(o.source, ''), lk.k)
      end as k
    from opportunities o
    left join lead_keyed lk on lk.id = o.lead_id
    where o.archived_at is null
  ),
  lead_agg as (
    select
      coalesce(k, '(not set)') as k,
      count(*) as leads,
      count(*) filter (where status::text in ('qualified', 'proposal', 'won')) as qualified
    from lead_keyed group by 1
  ),
  opp_agg as (
    select
      coalesce(k, '(not set)') as k,
      count(*) as opportunities,
      count(*) filter (where stage = 'won') as won,
      coalesce(sum(estimated_value) filter (where stage = 'won'), 0) as won_value,
      (array_agg(distinct currency) filter (where stage = 'won'))[1] as won_currency,
      count(distinct currency) filter (where stage = 'won') as won_currencies
    from opp_keyed group by 1
  )
  select
    coalesce(l.k, o.k),
    coalesce(l.leads, 0),
    coalesce(l.qualified, 0),
    coalesce(o.opportunities, 0),
    coalesce(o.won, 0),
    coalesce(o.won_value, 0),
    o.won_currency,
    coalesce(o.won_currencies, 0)
  from lead_agg l
  full outer join opp_agg o on o.k = l.k
  order by coalesce(o.won_value, 0) desc, coalesce(l.leads, 0) desc;
end;
$$;

comment on function portal_revenue_attribution is
  'Aggregate source → paid leads → qualified → opportunities → won → value. Impact applications excluded. GA4 sessions are matched in the UI, never joined here.';


-- ###########################################################################
-- 10. ACCESS
-- ###########################################################################

-- The activity log: Impact pipeline events join project events as owner-only.
-- Everything else stays admin-readable, exactly as 20260928000300 left it.
drop policy if exists activity_select_admin on activity_logs;

create policy activity_select_admin on activity_logs
  for select using (
    (entity_type is distinct from 'project'
     and entity_type is distinct from 'impact_application'
     and is_admin())
    or is_owner()
  );

-- Functions. Supabase grants EXECUTE on every new function to anon and
-- authenticated by default, so each one is revoked and re-granted on purpose.
do $$
declare
  f text;
begin
  foreach f in array array[
    'impact_start_project(uuid, uuid, text, text, text, text, text, text, text[])',
    'impact_support_summary()',
    'impact_legacy_conflicts()',
    'impact_sync_applications()'
  ] loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', f);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on function %s from authenticated', f);
    end if;
  end loop;

  -- The three the owner's Portal calls. RLS and the is_owner() checks inside
  -- decide what they return; `impact_sync_applications()` stays SQL-editor only.
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function impact_start_project(uuid, uuid, text, text, text, text, text, text, text[]) to authenticated';
    execute 'grant execute on function impact_support_summary() to authenticated';
    execute 'grant execute on function impact_legacy_conflicts() to authenticated';
  end if;
end $$;

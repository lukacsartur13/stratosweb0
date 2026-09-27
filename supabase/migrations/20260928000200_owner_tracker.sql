-- =============================================================================
-- Stratos — owner tracker, step 2 of 3: the owner, the checkpoints, the close
--
-- Three things, all additive:
--
--   1. `portal_owner`, `is_owner()` and `portal_set_owner()` — the ONE account
--      the private project tracker belongs to
--   2. checkpoints: `project_milestones` gains an assignee, a note, a blocked
--      reason and a next step, and a blocked checkpoint must carry both
--   3. closing: a project can only become `completed` when it has at least one
--      checkpoint and every checkpoint is done, and a closed project's
--      checkpoints are frozen until it is reopened
--
-- plus `checkpoint_templates`, the per-service starting lists, editable.
--
-- WHAT THIS DOES NOT DO
-- ---------------------
-- It does not change who can read or write any EXISTING table. The policies
-- that make projects owner-only are step 3 (20260928000300_owner_lockdown.sql),
-- which refuses to run until an owner has been designated. Applying this file
-- on its own therefore cannot lock anybody out of anything.
--
-- No DROP TABLE, no TRUNCATE, no DELETE, no data migration. Every `drop` is a
-- `drop trigger if exists` or `drop policy if exists` followed by its `create`.
-- The only rows written are the four template seeds, and only if absent.
--
-- Run after 20260928000100_owner_tracker_enums.sql has COMMITTED.
-- =============================================================================


-- ###########################################################################
-- 1. THE OWNER
-- ###########################################################################

-- WHY NOT `super_admin`
-- ---------------------
-- `super_admin` is a role, and a role is something a super_admin can hand to
-- somebody else through `profiles_admin_write`. "Only the owner" has to name a
-- person, not a rank, so the owner is a row here — and this table has no write
-- path through the API at all. The only way in is `portal_set_owner()`, which is
-- executable by nobody but the database owner, i.e. the SQL editor.
--
-- WHY NOT A COLUMN ON `profiles`
-- ------------------------------
-- `profiles_update_self` lets every user update their own row and only pins
-- `role` and `organization_id`. A boolean added beside them would be writable by
-- its own subject: one PATCH and a client is the owner.
--
-- ONE ROW, ENFORCED
-- -----------------
-- The primary key is a constant `true`, so a second owner is a unique violation,
-- not a convention. `on delete restrict`: deleting the owner's profile has to
-- be a decision, not a side effect.
create table if not exists portal_owner (
  singleton      boolean primary key default true check (singleton),
  user_id        uuid not null unique references profiles(id) on delete restrict,
  designated_at  timestamptz not null default now(),
  designated_by  text not null default session_user
);

comment on table portal_owner is
  'The single account the private project tracker belongs to. Written only by portal_set_owner(), from the SQL editor.';

alter table portal_owner enable row level security;
alter table portal_owner force  row level security;

-- The owner may see their own row, which is also what lets `is_owner()` read it
-- if the function's owner is ever subject to RLS. Nobody may write through the
-- API: there is no insert, update or delete policy, and no table grant below.
drop policy if exists portal_owner_select_self on portal_owner;
create policy portal_owner_select_self on portal_owner
  for select using (user_id = auth.uid());

do $$
begin
  execute 'revoke all on table portal_owner from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table portal_owner from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table portal_owner from authenticated';
  end if;
end $$;

-- Designated AND still a super_admin. The second half is a floor, not the rule:
-- if the owner's account is ever demoted, the tracker closes rather than staying
-- open to an account that is no longer trusted with the rest of the portal.
create or replace function is_owner()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select p.role = 'super_admin'
    from portal_owner o
    join profiles p on p.id = o.user_id
    where o.user_id = auth.uid()
  ), false)
$$;

comment on function is_owner is
  'True only for the designated portal owner, and only while that account is a super_admin.';

-- Designate (or change) the owner. By email, because that is what a person
-- knows; refusing anything ambiguous, because a guess here is a lockout or a
-- leak.
create or replace function portal_set_owner(p_email text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  matches integer;
  target  uuid;
  target_role user_role;
begin
  select count(*) into matches
  from profiles where lower(email) = lower(btrim(p_email));

  if matches = 0 then
    raise exception 'No profile has the email %. Sign in to the portal with that account once first.', p_email;
  elsif matches > 1 then
    raise exception 'More than one profile has the email %. Resolve that before designating an owner.', p_email;
  end if;

  select id, role into target, target_role
  from profiles where lower(email) = lower(btrim(p_email));

  if target_role <> 'super_admin' then
    raise exception 'The owner must be a super_admin; % is %.', p_email, target_role;
  end if;

  insert into portal_owner (singleton, user_id)
  values (true, target)
  on conflict (singleton) do update
    set user_id = excluded.user_id,
        designated_at = now(),
        designated_by = session_user;

  return target;
end;
$$;

comment on function portal_set_owner is
  'Designates the portal owner by email. Executable only by the database owner (SQL editor), never through the API.';

-- `is_owner()` is called inside policies, so every role that queries those
-- tables needs EXECUTE — anon included, for whom it simply answers false.
-- `portal_set_owner()` is revoked from both browser-facing API roles: Supabase
-- grants EXECUTE on new functions to anon and authenticated by default, so "not
-- granted" is not the same as "revoked" here. The server-side secret key is not
-- listed: by Supabase's design it bypasses RLS and holds every grant, lives only
-- in the Netlify functions, and none of them touches this table.
do $$
declare
  r text;
begin
  execute 'revoke all on function is_owner() from public';
  execute 'revoke all on function portal_set_owner(text) from public';
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function portal_set_owner(text) from %I', r);
      execute format('grant execute on function is_owner() to %I', r);
    end if;
  end loop;
end $$;


-- ###########################################################################
-- 2. CHECKPOINTS
-- ###########################################################################

-- The existing table IS the checkpoint list. It gains the four fields a
-- checkpoint needs; `due_on` is already the deadline and `state` the status.
--
--   assignee        free text: "Stratos", "Ügyfél", a collaborator's name. Not
--                   a profile id, because most of the people responsible for a
--                   step do not have — and should not need — a portal account.
--   note            anything worth knowing about the step
--   blocked_reason  why it is stuck; required while `blocked`, cleared after
--   next_step       what happens next; required while `blocked`, kept otherwise
alter table project_milestones add column if not exists assignee text
  check (assignee is null or length(btrim(assignee)) <= 120);
alter table project_milestones add column if not exists note text
  check (note is null or length(btrim(note)) <= 2000);
alter table project_milestones add column if not exists blocked_reason text
  check (blocked_reason is null or length(btrim(blocked_reason)) <= 500);
alter table project_milestones add column if not exists next_step text
  check (next_step is null or length(btrim(next_step)) <= 500);

comment on column project_milestones.blocked_reason is
  'Why the checkpoint is blocked. Required while state = blocked; cleared when it leaves that state.';
comment on column project_milestones.next_step is
  'What happens next. Required while state = blocked.';

-- A blocked checkpoint says why and what next — in the database, so no client,
-- script or table-editor edit can leave one blank.
--
-- NOT VALID first: a row that was already `blocked` before this migration has no
-- reason, and a plain ADD CONSTRAINT would refuse to apply. NOT VALID still
-- binds every insert and every update from now on, so such a row cannot be
-- edited without being given one. Then, if no such row exists, the constraint
-- is validated outright.
do $$ begin
  alter table project_milestones add constraint project_milestones_blocked_check
    check (
      state <> 'blocked'
      or (length(btrim(coalesce(blocked_reason, ''))) > 0
          and length(btrim(coalesce(next_step, ''))) > 0)
    ) not valid;
exception when duplicate_object then null; end $$;

do $$ begin
  if not exists (
    select 1 from project_milestones
    where state = 'blocked'
      and (length(btrim(coalesce(blocked_reason, ''))) = 0
           or length(btrim(coalesce(next_step, ''))) = 0)
  ) then
    alter table project_milestones validate constraint project_milestones_blocked_check;
  end if;
end $$;

-- The checkpoint rules that are not expressible as a CHECK:
--
--   * a CLOSED project's checkpoints are frozen. Closing requires every one to
--     be done; allowing one to be reopened, added or removed afterwards would
--     make "closed" a state that no longer says what it said when it was set.
--     Reopen the project first.
--   * leaving `blocked` clears the reason, so the next block has to state its
--     own rather than silently inheriting a stale one.
create or replace function milestone_tracker_rules() returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  touched uuid[];
begin
  if tg_op = 'INSERT' then
    touched := array[new.project_id];
  elsif tg_op = 'UPDATE' then
    touched := array[old.project_id, new.project_id];
  else
    touched := array[old.project_id];
  end if;

  if exists (select 1 from projects p where p.id = any (touched) and p.status = 'completed') then
    raise exception 'stratos:project_closed'
      using errcode = 'P0001',
            hint = 'This project is closed. Reopen it to change its checkpoints.';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  if new.state is distinct from 'blocked' then
    new.blocked_reason := null;
  end if;
  return new;
end;
$$;

drop trigger if exists project_milestones_tracker_rules on project_milestones;
create trigger project_milestones_tracker_rules
  before insert or update or delete on project_milestones
  for each row execute function milestone_tracker_rules();


-- ###########################################################################
-- 3. CLOSING AND REOPENING
-- ###########################################################################

-- Closed means `status = 'completed'`, and ONLY that.
--
--   closed    `completed` — delivered, finished, shown under "Closed",
--             searchable, reopenable
--   archived  `archived_at` — put away. A separate column, a separate idea,
--             untouched here. A closed project is not archived by closing it,
--             and archiving does not close it.
--   paid      `payment_state` — independent of both. Closing never looks at it.
--
-- THE RULE, AND THE PROJECT WITH NO CHECKPOINTS
-- ---------------------------------------------
-- A project may become `completed` only if it has AT LEAST ONE checkpoint and
-- every checkpoint is `done`. A project with no checkpoints cannot be closed:
-- "every step is done" is vacuously true of an empty list, and a close that
-- asserts nothing is not a record of delivery. The fix is one click — add a
-- single "Handover" checkpoint and mark it done.
--
-- Enforced here, on the row, so it holds for the Portal, for a direct PATCH to
-- /rest/v1/projects and for the table editor alike. `completed_at` is stamped
-- by this trigger and cleared on reopen, whatever the caller sent.
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

    new.completed_at := now();
  elsif new.status = 'completed' then
    -- Still closed: the close date is the date it was closed, not the date of
    -- the latest edit.
    new.completed_at := old.completed_at;
  else
    -- Open, or reopened. An open project has no completion date.
    new.completed_at := null;
  end if;

  return new;
end;
$$;

drop trigger if exists projects_close_rules on projects;
create trigger projects_close_rules
  before insert or update on projects
  for each row execute function project_close_rules();

comment on function project_close_rules is
  'Closing = status completed. Requires >= 1 checkpoint, all done. Stamps completed_at; clears it on reopen.';


-- ###########################################################################
-- 4. CHECKPOINT TEMPLATES
-- ###########################################################################

-- Per-service starting lists. Applying one COPIES its steps into the project's
-- own checkpoints, so editing or retiring a template never rewrites a project
-- that already started from it. That is the whole design: no foreign key from
-- a checkpoint to a template exists to follow.
--
-- `service_keywords` is matched as a lowercase substring of the project's
-- service, exactly as the in-code lists in lib/pipeline.ts were. A template
-- with no keywords is a fallback.
create or replace function checkpoint_steps_valid(steps text[])
returns boolean language sql immutable as $$
  select cardinality(steps) between 1 and 40
     and not exists (
       select 1 from unnest(steps) s where s is null or length(btrim(s)) not between 1 and 160
     )
$$;

create table if not exists checkpoint_templates (
  id               uuid primary key default gen_random_uuid(),
  name             text not null check (length(btrim(name)) between 1 and 80),
  service_keywords text[] not null default '{}',
  steps            text[] not null check (checkpoint_steps_valid(steps)),
  position         smallint not null default 0,
  archived_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create unique index if not exists checkpoint_templates_name_key
  on checkpoint_templates (lower(btrim(name))) where archived_at is null;

drop trigger if exists checkpoint_templates_updated_at on checkpoint_templates;
create trigger checkpoint_templates_updated_at before update on checkpoint_templates
  for each row execute function set_updated_at();

comment on table checkpoint_templates is
  'Per-service checkpoint lists. Copied into a project on use; later edits never touch existing projects.';

alter table checkpoint_templates enable row level security;
alter table checkpoint_templates force  row level security;

drop policy if exists checkpoint_templates_owner_all on checkpoint_templates;
create policy checkpoint_templates_owner_all on checkpoint_templates
  for all using (is_owner()) with check (is_owner());

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table checkpoint_templates from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant select, insert, update, delete on table checkpoint_templates to authenticated';
  end if;
end $$;

-- The four lists the Portal shipped with (MILESTONE_TEMPLATES in
-- lib/pipeline.ts), seeded once. A name that already exists is left alone, so
-- re-running this file never overwrites the owner's edits.
insert into checkpoint_templates (name, service_keywords, steps, position)
select v.name, v.keywords, v.steps, v.position
from (values
  ('Website', array['web', 'site', 'oldal', 'landing'],
   array['Discovery', 'Research', 'UX / structure', 'Design', 'Development',
         'Content', 'QA', 'Client review', 'Launch', 'Maintenance'], 10),
  ('Ads', array['ad', 'hirdet', 'ppc', 'google ads', 'meta'],
   array['Audit', 'Account setup', 'Creative', 'Launch', 'Optimisation'], 20),
  ('Branding', array['brand', 'arculat', 'logo', 'identity'],
   array['Discovery', 'Direction', 'Design', 'Refinement', 'Handover'], 30),
  ('General', array[]::text[],
   array['Discovery', 'Delivery', 'Client review', 'Handover'], 90)
) as v(name, keywords, steps, position)
where not exists (
  select 1 from checkpoint_templates t
  where lower(btrim(t.name)) = lower(v.name) and t.archived_at is null
);

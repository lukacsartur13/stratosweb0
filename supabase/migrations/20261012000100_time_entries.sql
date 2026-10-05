-- =============================================================================
-- Stratos — hours worked, per person per day
--
--   time_entries  one line of work: who, which day, how many hours, on what —
--                 a project, or "other" with a free-text label — and a note.
--                 Several lines a day are normal.
--
--   who sees      every staff admin (the owner included) sees everybody's
--                 hours: the point is to see each other's;
--   who writes    everybody their OWN lines; the owner may correct anybody's;
--   projects      every staff admin may put hours on ANY project (the owner's
--                 decision of 2026-10-05). To choose one, an admin gets
--                 `time_projects()`: each project's name, its client's name and
--                 whether it is closed — nothing else. Values, payments,
--                 checkpoints and documents stay the owner's alone.
--                 A project's logged hours are summed from these lines when
--                 shown — never stored on the project, so an edit or a deletion
--                 can never leave a total behind.
--   a day         at most 24 hours per person.
--
-- Nothing is rewritten. Run after 20261011000100_notes_tasks_activity.sql.
-- =============================================================================

do $$
begin
  if current_user in ('anon', 'authenticated') then
    raise exception 'Run this migration from the SQL editor, not as an API role.';
  end if;
end $$;

create table if not exists time_entries (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(id) on delete cascade default auth.uid(),
  work_date   date not null,
  -- Quarter hours, 0.25 – 24.
  hours       numeric(4, 2) not null check (hours > 0 and hours <= 24 and (hours * 4) = trunc(hours * 4)),
  -- On a project, or on something else named in `label`.
  project_id  uuid references projects(id) on delete set null,
  label       text check (label is null or length(btrim(label)) between 1 and 120),
  note        text check (note is null or length(note) <= 1000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (project_id is not null or label is not null),
  check (work_date <= (now() at time zone 'Europe/Budapest')::date + 1)
);

create index if not exists time_entries_day_idx on time_entries (work_date, user_id);
create index if not exists time_entries_project_idx on time_entries (project_id) where project_id is not null;

drop trigger if exists time_entries_updated_at on time_entries;
create trigger time_entries_updated_at before update on time_entries
  for each row execute function set_updated_at();

comment on table time_entries is
  'Hours worked: one line per person, day and thing worked on (a project, or a free-text label). Project totals are summed from it, never stored.';

-- One person, one day: at most 24 hours, whoever writes the line.
create or replace function time_entries_day_limit() returns trigger
  language plpgsql security definer set search_path = public
as $$
declare
  total numeric;
begin
  select coalesce(sum(hours), 0) into total
  from time_entries
  where user_id = new.user_id and work_date = new.work_date and id <> new.id;
  if total + new.hours > 24 then
    raise exception 'stratos:time_day_over_24' using errcode = 'P0001',
      detail = format('%s hours are already logged for that day.', total);
  end if;
  return new;
end;
$$;

drop trigger if exists time_entries_day_limit on time_entries;
create trigger time_entries_day_limit before insert or update of hours, work_date, user_id on time_entries
  for each row execute function time_entries_day_limit();

alter table time_entries enable row level security;
alter table time_entries force row level security;

drop policy if exists time_entries_select on time_entries;
drop policy if exists time_entries_insert on time_entries;
drop policy if exists time_entries_update on time_entries;
drop policy if exists time_entries_delete on time_entries;

-- Everybody sees everybody's hours.
create policy time_entries_select on time_entries
  for select using (is_admin());
-- Your own lines, on any project; the owner may correct anybody's.
create policy time_entries_insert on time_entries
  for insert with check (is_admin() and user_id = auth.uid());
create policy time_entries_update on time_entries
  for update using (is_admin() and (user_id = auth.uid() or is_owner()))
  with check (is_admin() and (user_id = auth.uid() or is_owner()));
create policy time_entries_delete on time_entries
  for delete using (is_admin() and (user_id = auth.uid() or is_owner()));

-- The projects an admin may log hours on: name, client and closed — the only
-- project facts outside the owner's lockdown, and only for staff admins.
-- SECURITY DEFINER because projects are owner-only by RLS; it returns nothing
-- to anybody else.
create or replace function time_projects()
returns table (project_id uuid, project_name text, client_name text, closed boolean)
  language sql stable security definer set search_path = public
as $$
  select p.id, p.name, o.name, p.status = 'completed'
  from projects p
  left join organizations o on o.id = p.organization_id
  where is_admin() and p.archived_at is null
  order by (p.status = 'completed'), p.name
$$;

comment on function time_projects is
  'For logging hours: every live project''s name, client name and closed flag — to staff admins only. Nothing else about a project.';

do $$
begin
  execute 'revoke all on function time_projects() from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function time_projects() from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function time_projects() to authenticated';
  end if;
  execute 'revoke all on table time_entries from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table time_entries from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant select, insert, update, delete on table time_entries to authenticated';
  end if;
end $$;

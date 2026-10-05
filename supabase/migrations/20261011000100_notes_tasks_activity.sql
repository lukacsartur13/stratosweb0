-- =============================================================================
-- Stratos — notes, checklists, tasks and the activity log
--
--   1. notes         a note (free text) or a checklist, optionally about one
--                    client; pinned or not; archived instead of deleted
--   2. note_items    the checklist's points. A point with a due date is a TASK —
--                    there is no second task table — and the Today screen lists
--                    them. A point can become a project checkpoint; the link is
--                    kept (`milestone_id`)
--   3. interactions  the activity log: a call, an e-mail, a meeting, a message —
--                    logged against a client, a lead or a sales opportunity
--   4. access        staff admins (the owner included), like clients and leads;
--                    clients and team members see none of it
--
-- The existing `record_notes` (the timeline notes on a client, deal or project)
-- are untouched: those are entries in a record's history; these are working
-- documents that are edited.
--
-- Nothing is rewritten. Run after 20261010000100_help_translations.sql.
-- =============================================================================

do $$
begin
  if current_user in ('anon', 'authenticated') then
    raise exception 'Run this migration from the SQL editor, not as an API role.';
  end if;
end $$;


-- ###########################################################################
-- 1. NOTES
-- ###########################################################################

create table if not exists notes (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null default 'note' check (kind in ('note', 'checklist')),
  title           text not null check (length(btrim(title)) between 1 and 200),
  -- Plain text, rendered as text. Never markup.
  body            text check (body is null or length(body) <= 20000),
  -- A client the note is about. A client deleted for good leaves the note,
  -- unlinked: what was written is not the client's to take with it.
  organization_id uuid references organizations(id) on delete set null,
  pinned          boolean not null default false,
  archived_at     timestamptz,
  created_by      uuid references profiles(id) on delete set null default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists notes_live_idx on notes (pinned desc, updated_at desc) where archived_at is null;
create index if not exists notes_org_idx on notes (organization_id) where organization_id is not null;

drop trigger if exists notes_updated_at on notes;
create trigger notes_updated_at before update on notes
  for each row execute function set_updated_at();

comment on table notes is
  'Working notes and checklists, optionally about one client. Archived, not deleted.';


-- ###########################################################################
-- 2. CHECKLIST POINTS AND TASKS
-- ###########################################################################

create table if not exists note_items (
  id           uuid primary key default gen_random_uuid(),
  note_id      uuid not null references notes(id) on delete cascade,
  text         text not null check (length(btrim(text)) between 1 and 500),
  done         boolean not null default false,
  done_at      timestamptz,
  -- A due date makes the point a task: it appears on the Today screen.
  due_on       date,
  position     integer not null default 0,
  -- Set when the point was turned into a project checkpoint.
  milestone_id uuid references project_milestones(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check ((done_at is null) = (not done))
);

create index if not exists note_items_note_idx on note_items (note_id, position);
create index if not exists note_items_due_idx on note_items (due_on) where not done and due_on is not null;

drop trigger if exists note_items_updated_at on note_items;
create trigger note_items_updated_at before update on note_items
  for each row execute function set_updated_at();

-- `done_at` follows `done`: stamped when ticked, cleared when unticked, by
-- whatever path — the client never has to send it.
create or replace function note_item_done_at() returns trigger
  language plpgsql set search_path = public
as $$
begin
  if new.done and (tg_op = 'INSERT' or not old.done) then
    new.done_at := now();
  elsif not new.done then
    new.done_at := null;
  else
    new.done_at := old.done_at;
  end if;
  return new;
end;
$$;

drop trigger if exists note_items_done_at on note_items;
create trigger note_items_done_at before insert or update of done on note_items
  for each row execute function note_item_done_at();

-- A point becomes a checkpoint of a project — in one transaction, and only as
-- somebody who may write that project's checkpoints (the owner: RLS on
-- project_milestones decides). SECURITY INVOKER.
create or replace function note_item_to_milestone(p_item uuid, p_project uuid) returns uuid
  language plpgsql security invoker set search_path = public
as $$
declare
  item note_items%rowtype;
  ms   uuid;
  pos  integer;
begin
  select * into item from note_items where id = p_item for update;
  if not found then
    raise exception 'stratos:note_item_missing' using errcode = 'P0001';
  end if;
  if item.milestone_id is not null then
    return item.milestone_id;
  end if;
  select coalesce(max(position) + 1, 0) into pos from project_milestones where project_id = p_project;
  insert into project_milestones (project_id, title, position, due_on)
  values (p_project, left(btrim(item.text), 200), pos, item.due_on)
  returning id into ms;
  update note_items set milestone_id = ms where id = item.id;
  return ms;
end;
$$;


-- ###########################################################################
-- 3. THE ACTIVITY LOG
-- ###########################################################################

create table if not exists interactions (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null check (kind in ('call', 'email', 'meeting', 'message', 'other')),
  occurred_at     timestamptz not null default now(),
  summary         text not null check (length(btrim(summary)) between 1 and 4000),
  -- What it was with. Deleting that record deletes its log: a lead erased for
  -- privacy takes its calls with it.
  organization_id uuid references organizations(id) on delete cascade,
  lead_id         uuid references leads(id) on delete cascade,
  opportunity_id  uuid references opportunities(id) on delete cascade,
  created_by      uuid references profiles(id) on delete set null default auth.uid(),
  created_at      timestamptz not null default now(),
  check (num_nonnulls(organization_id, lead_id, opportunity_id) >= 1),
  check (occurred_at <= now() + interval '1 day')
);

create index if not exists interactions_org_idx on interactions (organization_id, occurred_at desc) where organization_id is not null;
create index if not exists interactions_lead_idx on interactions (lead_id, occurred_at desc) where lead_id is not null;
create index if not exists interactions_opp_idx on interactions (opportunity_id, occurred_at desc) where opportunity_id is not null;

comment on table interactions is
  'The activity log: a call, e-mail, meeting or message with a client, lead or opportunity.';


-- ###########################################################################
-- 4. ACCESS
-- ###########################################################################

alter table notes        enable row level security;
alter table note_items   enable row level security;
alter table interactions enable row level security;
alter table notes        force row level security;
alter table note_items   force row level security;
alter table interactions force row level security;

drop policy if exists notes_admin_all on notes;
drop policy if exists note_items_admin_all on note_items;
drop policy if exists interactions_admin_all on interactions;

create policy notes_admin_all on notes
  for all using (is_admin()) with check (is_admin());
create policy note_items_admin_all on note_items
  for all using (is_admin()) with check (is_admin());
create policy interactions_admin_all on interactions
  for all using (is_admin()) with check (is_admin());

do $$
begin
  execute 'revoke all on table notes, note_items, interactions from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table notes, note_items, interactions from anon';
    execute 'revoke all on function note_item_to_milestone(uuid, uuid) from anon';
  end if;
  execute 'revoke all on function note_item_to_milestone(uuid, uuid) from public';
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant select, insert, update, delete on table notes, note_items, interactions to authenticated';
    execute 'grant execute on function note_item_to_milestone(uuid, uuid) to authenticated';
  end if;
end $$;

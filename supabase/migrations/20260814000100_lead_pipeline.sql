-- =============================================================================
-- Stratos — the lead pipeline
--
-- Three additions, and every one of them is additive:
--
--   1. `proposal`, a stage the pipeline was missing between qualified and won
--   2. `lead_notes`, private internal notes with a real author
--   3. a status-change trigger, so the lead timeline is recorded rather than
--      reconstructed
--
-- NOTHING HERE DROPS, RENAMES OR REWRITES ANYTHING.
-- ------------------------------------------------
-- No column is removed, no type is replaced, no row is touched by a data
-- migration. Every existing lead keeps its status, its payload and its
-- attribution, and every existing `select` list in the portal keeps working
-- against a table that has only gained things. This is deliberate and it is the
-- constraint the work was designed under: a production database with real
-- enquiries in it is not a place to find out that a migration was reversible in
-- theory.
--
-- Run after 20260805000100_lead_envelope.sql.
-- =============================================================================

-- ------------------------------------------------------------------ 1. stage
-- The pipeline is New → Contacted → Qualified → Proposal → Won / Lost, and
-- `proposal` is the one stage the original enum did not have. Without it a
-- lead that has been quoted is indistinguishable from one that has merely been
-- qualified, which is the difference between "we are waiting on them" and "we
-- have not sent anything yet" — the single most useful thing to know when
-- looking at a pipeline.
--
-- `add value if not exists` rather than a new type: replacing an enum means
-- rewriting the column, which means rewriting the table, which means an
-- exclusive lock on `leads` and a window in which POST /api/lead fails. Adding
-- a value takes no lock at all.
--
-- `spam` is deliberately kept. It is not part of the pipeline the portal draws
-- and it is not offered as a status anyone can set from the UI, but rows
-- already carry it and dropping a value from an enum is not possible without
-- the table rewrite this migration exists to avoid.
do $$ begin
  alter type lead_status add value if not exists 'proposal' after 'qualified';
exception when others then null; end $$;

-- ------------------------------------------------------------------ 2. notes
-- Private working notes on a lead.
--
-- WHY THE AUTHOR IS A FOREIGN KEY AND NOT A NAME
-- ----------------------------------------------
-- The brief asks for no invented team identities. There is no need to invent
-- one: every writer is an authenticated portal user with a row in `profiles`,
-- so the author is that row's id and the portal renders whatever name that
-- profile actually has. A note whose author has since been removed keeps the
-- note and loses the attribution — `on delete set null` — rather than
-- disappearing with them, because the note is a record of the work and the
-- account is not.
--
-- WHY `body` IS TEXT AND NOTHING ELSE
-- -----------------------------------
-- No HTML, no markdown, no rich text. The portal renders this with
-- `white-space: pre-wrap` inside a text node, which is React's default and
-- cannot execute anything. Storing markup here would mean either rendering it —
-- which is a stored XSS in an authenticated admin — or storing it and showing
-- the tags, which is worse than not supporting it.
create table if not exists lead_notes (
  id         uuid primary key default gen_random_uuid(),
  lead_id    uuid not null references leads(id) on delete cascade,
  author_id  uuid references profiles(id) on delete set null,
  body       text not null check (length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index if not exists lead_notes_lead_idx on lead_notes (lead_id, created_at desc);

comment on table lead_notes is
  'Private internal notes on a lead. Never exposed by any public endpoint.';
comment on column lead_notes.body is
  'Plain text. Rendered as a text node — never as markup.';

alter table lead_notes enable row level security;
alter table lead_notes force row level security;

-- Staff read, admins write, and the author is the caller — always.
--
-- `author_id = auth.uid()` in the WITH CHECK is what stops an admin writing a
-- note in a colleague's name. It is a small thing and it is the whole value of
-- having an author at all: an attribution anyone can forge is decoration.
drop policy if exists lead_notes_select_staff on lead_notes;
drop policy if exists lead_notes_insert_admin on lead_notes;
drop policy if exists lead_notes_delete_author on lead_notes;

create policy lead_notes_select_staff on lead_notes
  for select using (is_staff());

create policy lead_notes_insert_admin on lead_notes
  for insert with check (is_admin() and author_id = auth.uid());

-- An author may withdraw their own note. Nobody may edit one: a note that can
-- be rewritten after the fact is not a record, and the timeline it appears in
-- is meant to be one.
create policy lead_notes_delete_author on lead_notes
  for delete using (is_admin() and author_id = auth.uid());

-- --------------------------------------------------------------- 3. timeline
-- Record status changes, so the lead timeline is history rather than a guess.
--
-- The portal's timeline shows what actually happened to a lead. Before this
-- there was exactly one recorded fact — `created_at` — and everything else
-- would have had to be inferred, which is the failure mode the brief names:
-- "do not fabricate historical events that were never stored".
--
-- A TRIGGER RATHER THAN AN APPLICATION WRITE
-- ------------------------------------------
-- The portal is not the only thing that can change a lead's status: the
-- Supabase table editor can, a future automation can, an SQL fix can. A trigger
-- records all of them; an insert in the React app records the ones that went
-- through the React app, and quietly leaves gaps that look like nothing
-- happened.
--
-- `activity_logs` already exists for exactly this, is append-only from the
-- API's point of view (staff may select and no policy grants insert, update or
-- delete), and is already the screen the Activity page renders.
create or replace function log_lead_status_change() returns trigger
  language plpgsql
  security definer
  -- Pinned, because a `security definer` function that resolves unqualified
  -- names through the caller's `search_path` is the classic privilege
  -- escalation: a caller who can create a schema in front of `public` chooses
  -- which `activity_logs` this writes to.
  set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    insert into activity_logs (user_id, action, entity_type, entity_id, metadata)
    values (
      -- Null when the change did not come from a signed-in session — a service
      -- key write, or SQL run in the dashboard. Null is the honest answer;
      -- attributing it to somebody would not be.
      auth.uid(),
      'lead.status_changed',
      'lead',
      new.id,
      jsonb_build_object('from', old.status::text, 'to', new.status::text)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists leads_status_change on leads;
create trigger leads_status_change
  after update of status on leads
  for each row
  execute function log_lead_status_change();

comment on function log_lead_status_change is
  'Appends a lead.status_changed row to activity_logs. The lead timeline reads these.';

-- ------------------------------------------------------------------ 4. index
-- The timeline reads `activity_logs` for one lead. Without this it is a
-- sequential scan of an append-only table that only ever grows.
create index if not exists activity_entity_idx
  on activity_logs (entity_type, entity_id, created_at desc);

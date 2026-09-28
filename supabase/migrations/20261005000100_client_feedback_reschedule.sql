-- =============================================================================
-- Stratos — phase 8: demo feedback and meeting reschedule requests
--
-- Owner decisions of 2026-09-28:
--   * under a demo the client can write feedback ("Észrevételek"), which the
--     owner reads in the portal;
--   * for a meeting the client can propose a new time with a message; the
--     owner accepts (the meeting is moved, atomically) or declines. The client
--     never moves a meeting by itself.
--
--   1. `demo_feedback`            one row per message; the owner marks it read
--   2. `meeting_change_requests`  one row per proposal: pending → accepted |
--                                 declined | withdrawn; at most one PENDING per
--                                 meeting and account
--   3. client functions           client_send_demo_feedback,
--                                 client_portal_demo_feedback,
--                                 client_request_meeting_change,
--                                 client_withdraw_meeting_request,
--                                 client_portal_meeting_requests — each checks
--                                 the caller's CURRENT assignment, like phase 4
--   4. owner function             owner_decide_meeting_request (invoker, owner)
--
-- No e-mail or notification is sent by any of this: the owner sees it in the
-- portal. Nothing is deleted through the API.
-- Run after 20261004000200_help_seed.sql.
-- =============================================================================

do $$
begin
  if to_regclass('public.project_demos') is null or to_regclass('public.project_meetings') is null then
    raise exception 'Phase 7 (20261004000100_client_demos_meetings_help.sql) is not applied.';
  end if;
  if current_user in ('anon', 'authenticated') then
    raise exception 'Run this migration from the SQL editor, not as an API role.';
  end if;
end $$;

create table if not exists demo_feedback (
  id          uuid primary key default gen_random_uuid(),
  demo_id     uuid not null references project_demos(id) on delete restrict,
  project_id  uuid not null references projects(id) on delete restrict,
  account_id  uuid not null references client_accounts(id) on delete restrict,
  body        text not null check (length(btrim(body)) between 1 and 2000),
  created_at  timestamptz not null default now(),
  read_at     timestamptz,
  read_by     uuid references profiles(id) on delete set null
);
create index if not exists demo_feedback_demo_idx on demo_feedback (demo_id, created_at);
create index if not exists demo_feedback_unread_idx on demo_feedback (project_id) where read_at is null;

create table if not exists meeting_change_requests (
  id                  uuid primary key default gen_random_uuid(),
  meeting_id          uuid not null references project_meetings(id) on delete restrict,
  project_id          uuid not null references projects(id) on delete restrict,
  account_id          uuid not null references client_accounts(id) on delete restrict,
  proposed_starts_at  timestamptz not null,
  proposed_ends_at    timestamptz not null,
  time_zone           text not null default 'Europe/Budapest',
  message             text check (message is null or length(message) <= 1000),
  status              text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'withdrawn')),
  owner_note          text check (owner_note is null or length(owner_note) <= 500),
  created_at          timestamptz not null default now(),
  decided_at          timestamptz,
  decided_by          uuid references profiles(id) on delete set null,
  check (proposed_ends_at > proposed_starts_at),
  check (proposed_ends_at - proposed_starts_at <= interval '24 hours'),
  check ((status = 'pending') = (decided_at is null))
);
create unique index if not exists meeting_change_requests_one_pending
  on meeting_change_requests (meeting_id, account_id) where status = 'pending';
create index if not exists meeting_change_requests_project_idx on meeting_change_requests (project_id, status);

-- The owner may only mark feedback read (or unread); the message is the client's.
create or replace function demo_feedback_rules() returns trigger
  language plpgsql set search_path = public
as $$
begin
  if (to_jsonb(new) - 'read_at' - 'read_by') is distinct from (to_jsonb(old) - 'read_at' - 'read_by') then
    raise exception 'stratos:feedback_fixed' using errcode = 'P0001';
  end if;
  new.read_by := case when new.read_at is null then null else coalesce(auth.uid(), new.read_by) end;
  return new;
end;
$$;
drop trigger if exists demo_feedback_rules on demo_feedback;
create trigger demo_feedback_rules before update on demo_feedback
  for each row execute function demo_feedback_rules();

-- A request is decided once; its proposal is fixed.
create or replace function meeting_request_rules() returns trigger
  language plpgsql set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if not portal_valid_time_zone(new.time_zone) then
      raise exception 'stratos:meeting_time_zone' using errcode = 'P0001';
    end if;
    if new.proposed_starts_at <= now() then
      raise exception 'stratos:meeting_request_past' using errcode = 'P0001';
    end if;
    return new;
  end if;
  if old.status <> 'pending' then
    raise exception 'stratos:meeting_request_decided' using errcode = 'P0001';
  end if;
  if (new.proposed_starts_at, new.proposed_ends_at, new.time_zone, new.message, new.meeting_id, new.account_id)
     is distinct from (old.proposed_starts_at, old.proposed_ends_at, old.time_zone, old.message, old.meeting_id, old.account_id) then
    raise exception 'stratos:meeting_request_fixed' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists meeting_change_requests_rules on meeting_change_requests;
create trigger meeting_change_requests_rules before insert or update on meeting_change_requests
  for each row execute function meeting_request_rules();

-- Access: owner reads and decides; the client functions (definer) write.
do $$
declare t text;
begin
  foreach t in array array['demo_feedback', 'meeting_change_requests'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists %I on %I', t || '_owner_all', t);
    execute format('create policy %I on %I for all using (is_owner()) with check (is_owner())', t || '_owner_all', t);
    execute format('drop policy if exists %I on %I', t || '_definer_all', t);
    execute format('create policy %I on %I for all to %I using (true) with check (true)', t || '_definer_all', t, client_definer_role());
    execute format('revoke all on table %I from public', t);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on table %I from anon', t);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on table %I from authenticated', t);
      -- Feedback: the owner marks it read. Requests: read only — a decision
      -- goes through owner_decide_meeting_request(), which moves the meeting
      -- in the same transaction; a bare status change could not.
      execute format('grant select%s on table %I to authenticated', case when t = 'demo_feedback' then ', update' else '' end, t);
    end if;
  end loop;
end $$;


-- ###########################################################################
-- THE CLIENT FUNCTIONS
-- ###########################################################################

-- Feedback on a PUBLISHED, not revoked demo of a project the caller still has.
-- At most 30 messages a day per account.
create or replace function client_send_demo_feedback(p_demo uuid, p_body text)
returns uuid
  language plpgsql volatile security definer set search_path = public as $$
declare
  me uuid := client_account_id();
  d project_demos;
  created uuid;
begin
  select * into d from project_demos where id = p_demo;
  if me is null or d.id is null or not d.published or d.revoked_at is not null or not client_has_project(d.project_id) then
    raise exception 'stratos:client_no_access' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_body, ''))) = 0 then
    raise exception 'stratos:feedback_empty' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('stratos:client_feedback:' || me::text, 0));
  if (select count(*) from demo_feedback f where f.account_id = me and f.created_at > now() - interval '24 hours') >= 30 then
    raise exception 'stratos:feedback_limit' using errcode = 'P0001';
  end if;
  insert into demo_feedback (demo_id, project_id, account_id, body) values (d.id, d.project_id, me, btrim(p_body))
  returning id into created;
  insert into activity_logs (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'project.demo_feedback', 'project', d.project_id, jsonb_build_object('demo', d.id, 'feedback', created));
  return created;
end;
$$;

-- The caller's own feedback on demos it can still see.
create or replace function client_portal_demo_feedback()
returns table (feedback_id uuid, demo_id uuid, body text, created_at timestamptz, seen boolean)
  language sql stable security definer set search_path = public as $$
  select f.id, f.demo_id, f.body, f.created_at, f.read_at is not null
  from demo_feedback f join project_demos d on d.id = f.demo_id
  where f.account_id = client_account_id() and client_account_id() is not null
    and d.published and d.revoked_at is null and client_has_project(f.project_id)
  order by f.created_at
$$;

-- A proposed new time for a meeting that is not cancelled and not over, in a
-- project the caller still has. One pending proposal per meeting and account.
create or replace function client_request_meeting_change(
  p_meeting uuid, p_starts timestamptz, p_ends timestamptz, p_time_zone text default 'Europe/Budapest', p_message text default null
) returns uuid
  language plpgsql volatile security definer set search_path = public as $$
declare
  me uuid := client_account_id();
  m project_meetings;
  created uuid;
begin
  select * into m from project_meetings where id = p_meeting;
  if me is null or m.id is null or not client_has_project(m.project_id) then
    raise exception 'stratos:client_no_access' using errcode = '42501';
  end if;
  if m.cancelled_at is not null or m.ends_at <= now() then
    raise exception 'stratos:meeting_closed' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('stratos:client_meeting:' || me::text, 0));
  if exists (select 1 from meeting_change_requests r where r.meeting_id = m.id and r.account_id = me and r.status = 'pending') then
    raise exception 'stratos:meeting_request_pending' using errcode = 'P0001';
  end if;
  insert into meeting_change_requests (meeting_id, project_id, account_id, proposed_starts_at, proposed_ends_at, time_zone, message)
  values (m.id, m.project_id, me, p_starts, p_ends, coalesce(nullif(p_time_zone, ''), 'Europe/Budapest'), nullif(btrim(coalesce(p_message, '')), ''))
  returning id into created;
  insert into activity_logs (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'project.meeting_change_requested', 'project', m.project_id,
          jsonb_build_object('meeting', m.id, 'request', created, 'starts', p_starts, 'ends', p_ends));
  return created;
end;
$$;

create or replace function client_withdraw_meeting_request(p_request uuid) returns text
  language plpgsql volatile security definer set search_path = public as $$
declare
  me uuid := client_account_id();
begin
  update meeting_change_requests set status = 'withdrawn', decided_at = now()
   where id = p_request and account_id = me and me is not null and status = 'pending'
     and client_has_project(project_id);
  if not found then
    raise exception 'stratos:meeting_request_missing' using errcode = 'P0002';
  end if;
  return 'withdrawn';
end;
$$;

create or replace function client_portal_meeting_requests()
returns table (request_id uuid, meeting_id uuid, proposed_starts_at timestamptz, proposed_ends_at timestamptz, time_zone text,
               message text, status text, owner_note text, created_at timestamptz, decided_at timestamptz)
  language sql stable security definer set search_path = public as $$
  select r.id, r.meeting_id, r.proposed_starts_at, r.proposed_ends_at, r.time_zone, r.message, r.status, r.owner_note,
         r.created_at, r.decided_at
  from meeting_change_requests r
  where r.account_id = client_account_id() and client_account_id() is not null
    and client_has_project(r.project_id)
  order by r.created_at
$$;


-- ###########################################################################
-- THE OWNER'S DECISION — one transaction
-- ###########################################################################

-- Accept: the meeting takes the proposed time (and is un-cancelled); every
-- other pending proposal for that meeting is declined. Decline: only the
-- request changes. SECURITY DEFINER because the API roles have no UPDATE on the
-- requests table; the owner check below is the gate.
create or replace function owner_decide_meeting_request(p_request uuid, p_accept boolean, p_note text default null)
returns text
  language plpgsql volatile security definer set search_path = public as $$
declare
  r meeting_change_requests;
begin
  if not is_owner() then
    raise exception 'stratos:owner_only' using errcode = '42501';
  end if;
  select * into r from meeting_change_requests where id = p_request for update;
  if r.id is null then
    raise exception 'stratos:meeting_request_missing' using errcode = 'P0002';
  end if;
  if r.status <> 'pending' then
    raise exception 'stratos:meeting_request_decided' using errcode = 'P0001';
  end if;
  if p_accept then
    update project_meetings
       set starts_at = r.proposed_starts_at, ends_at = r.proposed_ends_at, time_zone = r.time_zone, cancelled_at = null
     where id = r.meeting_id;
    update meeting_change_requests set status = 'declined', decided_at = now(), decided_by = auth.uid(),
           owner_note = 'Másik javaslat lett elfogadva.'
     where meeting_id = r.meeting_id and status = 'pending' and id <> r.id;
  end if;
  update meeting_change_requests
     set status = case when p_accept then 'accepted' else 'declined' end,
         decided_at = now(), decided_by = auth.uid(), owner_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = r.id;
  insert into activity_logs (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), case when p_accept then 'project.meeting_change_accepted' else 'project.meeting_change_declined' end,
          'project', r.project_id, jsonb_build_object('meeting', r.meeting_id, 'request', r.id));
  return case when p_accept then 'accepted' else 'declined' end;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'client_send_demo_feedback(uuid, text)', 'client_portal_demo_feedback()',
    'client_request_meeting_change(uuid, timestamptz, timestamptz, text, text)', 'client_withdraw_meeting_request(uuid)',
    'client_portal_meeting_requests()', 'owner_decide_meeting_request(uuid, boolean, text)'
  ] loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', f);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('grant execute on function %s to authenticated', f);
    end if;
  end loop;
end $$;

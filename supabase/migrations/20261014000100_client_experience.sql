-- =============================================================================
-- Stratos — client experience ("3. Ügyfélélmény")
--
-- Owner decisions of 2026-10-05:
--   1. approval      the owner asks the client to approve a published DEMO; the
--                    client answers "Jóváhagyom" or "Módosítást kérek" (a note
--                    is required for changes). One answer per request; the
--                    owner asks again for the next round.
--   2. "Rád várunk"  what Stratos is waiting for from the client: the owner's
--                    own requests (title, details, due date), which the client
--                    marks done — plus, in the client portal, the open
--                    approvals and surveys.
--   3. messages      one thread per project between the client and Stratos,
--                    no attachments.
--   4. satisfaction  "How likely are you to recommend us?" 1–10 + a comment;
--                    sent when a project is closed, every quarter to an active
--                    monthly client, or by hand. From 7 up the client is
--                    offered the Google review link (Settings).
--
-- Every client action tells the owner (push + e-mail, 20261013000100); the
-- owner tells the client when "E-mail the client" is ticked; a survey always
-- e-mails the client.
--
-- The client functions name no table of the projects or the library: they work
-- through client_has_project() and client_account_id(), like phase 4. Names
-- that need those tables (a client's name on a message) are filled in by
-- trigger functions.
--
-- Nothing is deleted through the API. Run after 20261013000100_notifications.sql.
-- =============================================================================

do $$
begin
  if to_regclass('public.notification_outbox') is null then
    raise exception '20261013000100_notifications.sql is not applied.';
  end if;
  if current_user in ('anon', 'authenticated') then
    raise exception 'Run this migration from the SQL editor, not as an API role.';
  end if;
end $$;


-- ###########################################################################
-- 0. SETTINGS: the Google review link
-- ###########################################################################

create table if not exists portal_settings (
  id                boolean primary key default true check (id),
  google_review_url text check (google_review_url is null or portal_safe_https_url(google_review_url)),
  updated_at        timestamptz not null default now()
);
insert into portal_settings (id) values (true) on conflict (id) do nothing;

alter table portal_settings enable row level security;
alter table portal_settings force row level security;
drop policy if exists portal_settings_owner on portal_settings;
create policy portal_settings_owner on portal_settings for all using (is_owner()) with check (is_owner());
drop policy if exists portal_settings_definer on portal_settings;
do $$ begin
  execute format('create policy portal_settings_definer on portal_settings for select to %I using (true)', client_definer_role());
end $$;


-- ###########################################################################
-- 1. APPROVAL OF A DEMO
-- ###########################################################################

alter table project_demos add column if not exists approval_requested_at timestamptz;
alter table project_demos add column if not exists approval_state text;
alter table project_demos add column if not exists approval_note text;
alter table project_demos add column if not exists approval_decided_at timestamptz;
alter table project_demos add column if not exists approval_account_id uuid references client_accounts(id) on delete set null;
alter table project_demos add column if not exists approval_seen_at timestamptz;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'project_demos_approval_check') then
    alter table project_demos add constraint project_demos_approval_check check (
      (approval_state is null or approval_state in ('approved', 'changes'))
      and (approval_note is null or length(approval_note) <= 2000)
      and ((approval_state is null) = (approval_decided_at is null))
      and (approval_state is null or approval_requested_at is not null));
  end if;
end $$;

-- The answer is the client's: only the client function writes it (rules bind
-- the API roles; the functions and the SQL editor run as another). The owner
-- asks (approval_requested_at), asks again (a new time clears the answer),
-- withdraws (null) and marks an answer seen.
create or replace function project_demo_approval_rules() returns trigger
  language plpgsql set search_path = public
as $$
begin
  if new.approval_requested_at is distinct from old.approval_requested_at then
    new.approval_state := null;
    new.approval_note := null;
    new.approval_decided_at := null;
    new.approval_account_id := null;
    new.approval_seen_at := null;
    if new.approval_requested_at is not null then
      new.approval_requested_at := now();
    end if;
  elsif (new.approval_state, new.approval_note, new.approval_decided_at, new.approval_account_id)
        is distinct from (old.approval_state, old.approval_note, old.approval_decided_at, old.approval_account_id)
        and current_user in ('anon', 'authenticated') then
    raise exception 'stratos:approval_is_the_clients' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists project_demos_approval_rules on project_demos;
create trigger project_demos_approval_rules before update on project_demos
  for each row execute function project_demo_approval_rules();

-- The client's answer to an open request, on a published demo of a project the
-- caller still has.
create or replace function client_decide_demo(p_demo uuid, p_approve boolean, p_note text default null)
returns text
  language plpgsql volatile security definer set search_path = public as $$
declare
  me uuid := client_account_id();
  d project_demos;
  note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select * into d from project_demos where id = p_demo for update;
  if me is null or d.id is null or not d.published or d.revoked_at is not null or not client_has_project(d.project_id) then
    raise exception 'stratos:client_no_access' using errcode = '42501';
  end if;
  if d.approval_requested_at is null then
    raise exception 'stratos:approval_not_requested' using errcode = 'P0001';
  end if;
  if d.approval_state is not null then
    raise exception 'stratos:approval_decided' using errcode = 'P0001';
  end if;
  if not coalesce(p_approve, false) and note is null then
    raise exception 'stratos:approval_note_needed' using errcode = 'P0001';
  end if;
  update project_demos
     set approval_state = case when p_approve then 'approved' else 'changes' end,
         approval_note = left(note, 2000), approval_decided_at = now(), approval_account_id = me
   where id = d.id;
  insert into activity_logs (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), case when p_approve then 'project.demo_approved' else 'project.demo_changes_requested' end,
          'project', d.project_id, jsonb_build_object('demo', d.id));
  return case when p_approve then 'approved' else 'changes' end;
end;
$$;

-- Open and answered approvals of the caller's demos (the demo itself comes from
-- client_portal_demos()).
create or replace function client_portal_approvals()
returns table (demo_id uuid, project_id uuid, requested_at timestamptz, state text, note text, decided_at timestamptz)
  language sql stable security definer set search_path = public as $$
  select d.id, d.project_id, d.approval_requested_at, d.approval_state, d.approval_note, d.approval_decided_at
  from project_demos d
  where d.approval_requested_at is not null and d.published and d.revoked_at is null
    and client_account_id() is not null and client_has_project(d.project_id)
  order by d.approval_requested_at
$$;


-- ###########################################################################
-- 2. WHAT STRATOS IS WAITING FOR ("Rád várunk")
-- ###########################################################################

create table if not exists client_requests (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references projects(id) on delete cascade,
  title           text not null check (length(btrim(title)) between 1 and 200),
  details         text check (details is null or length(details) <= 1000),
  due_on          date,
  created_by      uuid references profiles(id) on delete set null default auth.uid(),
  created_at      timestamptz not null default now(),
  done_at         timestamptz,
  done_account_id uuid references client_accounts(id) on delete set null,
  done_note       text check (done_note is null or length(done_note) <= 1000),
  seen_at         timestamptz,
  cancelled_at    timestamptz
);
create index if not exists client_requests_project_idx on client_requests (project_id, created_at);

-- Done is the client's to say (the client function); the owner may reopen it.
create or replace function client_request_rules() returns trigger
  language plpgsql set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.project_id is distinct from old.project_id then
    raise exception 'stratos:request_project_fixed' using errcode = 'P0001';
  end if;
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      new.done_at := null; new.done_account_id := null; new.done_note := null; new.seen_at := null;
    elsif new.done_at is null then
      -- Reopened by the owner.
      new.done_account_id := null; new.done_note := null; new.seen_at := null;
    elsif (new.done_at, new.done_account_id, new.done_note) is distinct from (old.done_at, old.done_account_id, old.done_note) then
      raise exception 'stratos:request_done_is_the_clients' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists client_requests_rules on client_requests;
create trigger client_requests_rules before insert or update on client_requests
  for each row execute function client_request_rules();

create or replace function client_complete_request(p_request uuid, p_note text default null)
returns text
  language plpgsql volatile security definer set search_path = public as $$
declare
  me uuid := client_account_id();
  r client_requests;
begin
  select * into r from client_requests where id = p_request for update;
  if me is null or r.id is null or r.cancelled_at is not null or not client_has_project(r.project_id) then
    raise exception 'stratos:client_no_access' using errcode = '42501';
  end if;
  if r.done_at is not null then
    return 'done';
  end if;
  update client_requests
     set done_at = now(), done_account_id = me, done_note = left(nullif(btrim(coalesce(p_note, '')), ''), 1000)
   where id = r.id;
  insert into activity_logs (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'project.client_request_done', 'project', r.project_id, jsonb_build_object('request', r.id));
  return 'done';
end;
$$;

-- Open requests, and the ones done in the last 30 days.
create or replace function client_portal_requests()
returns table (request_id uuid, project_id uuid, title text, details text, due_on date, created_at timestamptz,
               done_at timestamptz, done_note text)
  language sql stable security definer set search_path = public as $$
  select r.id, r.project_id, r.title, r.details, r.due_on, r.created_at, r.done_at, r.done_note
  from client_requests r
  where r.cancelled_at is null and (r.done_at is null or r.done_at > now() - interval '30 days')
    and client_account_id() is not null and client_has_project(r.project_id)
  order by r.done_at nulls first, r.due_on nulls last, r.created_at
$$;


-- ###########################################################################
-- 3. MESSAGES — one thread per project
-- ###########################################################################

create table if not exists project_messages (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  -- The client account that wrote it; NULL = Stratos.
  account_id  uuid references client_accounts(id) on delete set null,
  author_id   uuid references profiles(id) on delete set null default auth.uid(),
  author_name text not null default '' check (length(author_name) <= 200),
  body        text not null check (length(btrim(body)) between 1 and 4000),
  created_at  timestamptz not null default now(),
  -- A client's message, read by the owner.
  read_at     timestamptz
);
create index if not exists project_messages_project_idx on project_messages (project_id, created_at);
create index if not exists project_messages_unread_idx on project_messages (project_id) where read_at is null and account_id is not null;

create or replace function project_message_rules() returns trigger
  language plpgsql set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.read_at := null;
    -- Through the API only Stratos writes here; a client writes through
    -- client_send_message().
    if new.account_id is not null and current_user in ('anon', 'authenticated') then
      raise exception 'stratos:message_as_client' using errcode = '42501';
    end if;
    if new.account_id is not null then
      new.author_name := coalesce((select a.full_name from client_accounts a where a.id = new.account_id), '');
    else
      new.author_id := auth.uid();
      new.author_name := 'Stratos';
    end if;
    return new;
  end if;
  -- Only "read" changes, and only on a client's message.
  if (to_jsonb(new) - 'read_at') is distinct from (to_jsonb(old) - 'read_at') or (new.account_id is null and new.read_at is not null) then
    raise exception 'stratos:message_fixed' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists project_messages_rules on project_messages;
create trigger project_messages_rules before insert or update on project_messages
  for each row execute function project_message_rules();

-- Answering is reading: Stratos's message marks the client's earlier ones read.
create or replace function project_message_answered() returns trigger
  language plpgsql security definer set search_path = public
as $$
begin
  if new.account_id is null then
    update project_messages set read_at = now()
     where project_id = new.project_id and account_id is not null and read_at is null and created_at <= new.created_at;
  end if;
  return null;
end;
$$;
drop trigger if exists project_messages_answered on project_messages;
create trigger project_messages_answered after insert on project_messages
  for each row execute function project_message_answered();

-- At most 60 messages a day per account.
create or replace function client_send_message(p_project uuid, p_body text)
returns uuid
  language plpgsql volatile security definer set search_path = public as $$
declare
  me uuid := client_account_id();
  created uuid;
begin
  if me is null or p_project is null or not client_has_project(p_project) then
    raise exception 'stratos:client_no_access' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_body, ''))) = 0 then
    raise exception 'stratos:message_empty' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('stratos:client_message:' || me::text, 0));
  if (select count(*) from project_messages m where m.account_id = me and m.created_at > now() - interval '24 hours') >= 60 then
    raise exception 'stratos:message_limit' using errcode = 'P0001';
  end if;
  insert into project_messages (project_id, account_id, author_id, body)
  values (p_project, me, auth.uid(), left(btrim(p_body), 4000))
  returning id into created;
  return created;
end;
$$;

-- The thread of every project the caller has: Stratos's messages and every
-- client's of that project (colleagues see each other's).
create or replace function client_portal_messages()
returns table (message_id uuid, project_id uuid, body text, created_at timestamptz, from_stratos boolean, author_name text, mine boolean)
  language sql stable security definer set search_path = public as $$
  select m.id, m.project_id, m.body, m.created_at, m.account_id is null, m.author_name,
         m.account_id is not distinct from client_account_id()
  from project_messages m
  where client_account_id() is not null and client_has_project(m.project_id)
  order by m.created_at
$$;


-- ###########################################################################
-- 4. SATISFACTION
-- ###########################################################################

create table if not exists client_surveys (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references projects(id) on delete cascade,
  reason            text not null check (reason in ('closed', 'quarterly', 'manual')),
  -- 'closed' once per project, '2026-Q4' once per quarter; NULL for a manual one.
  period            text check (period is null or length(period) <= 20),
  created_by        uuid references profiles(id) on delete set null default auth.uid(),
  created_at        timestamptz not null default now(),
  score             smallint check (score is null or score between 1 and 10),
  comment           text check (comment is null or length(comment) <= 2000),
  answered_at       timestamptz,
  account_id        uuid references client_accounts(id) on delete set null,
  google_clicked_at timestamptz,
  seen_at           timestamptz,
  cancelled_at      timestamptz,
  check ((score is null) = (answered_at is null))
);
create unique index if not exists client_surveys_period_once on client_surveys (project_id, period) where period is not null;
create index if not exists client_surveys_project_idx on client_surveys (project_id, created_at);

-- The answer is the client's; the owner may cancel an open survey and mark an
-- answer seen.
create or replace function client_survey_rules() returns trigger
  language plpgsql set search_path = public
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.score := null; new.comment := null; new.answered_at := null; new.account_id := null;
    new.google_clicked_at := null; new.seen_at := null; new.cancelled_at := null;
    if new.reason <> 'manual' then
      raise exception 'stratos:survey_manual_only' using errcode = '42501';
    end if;
    new.period := null;
    return new;
  end if;
  if (to_jsonb(new) - 'seen_at' - 'cancelled_at') is distinct from (to_jsonb(old) - 'seen_at' - 'cancelled_at') then
    raise exception 'stratos:survey_is_the_clients' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists client_surveys_rules on client_surveys;
create trigger client_surveys_rules before insert or update on client_surveys
  for each row execute function client_survey_rules();

-- A survey always e-mails the project's clients.
create or replace function client_survey_notify() returns trigger
  language plpgsql security definer set search_path = public
as $$
begin
  begin
    insert into notification_outbox (audience, kind, project_id, payload, created_by)
    values ('client', 'survey_requested', new.project_id, jsonb_build_object('survey_id', new.id, 'reason', new.reason), null);
  exception when others then
    raise warning 'client_survey_notify failed: %', sqlerrm;
  end;
  return null;
end;
$$;
drop trigger if exists client_surveys_notify on client_surveys;
create trigger client_surveys_notify after insert on client_surveys
  for each row execute function client_survey_notify();

-- Closing a project asks its clients, once — if it has any.
create or replace function project_closed_survey() returns trigger
  language plpgsql security definer set search_path = public
as $$
begin
  begin
    if new.status = 'completed' and old.status is distinct from 'completed'
       and exists (select 1 from client_project_access x join client_accounts a on a.id = x.account_id
                   where x.project_id = new.id and x.revoked_at is null and a.status = 'active') then
      insert into client_surveys (project_id, reason, period, created_by)
      values (new.id, 'closed', 'closed', auth.uid())
      on conflict (project_id, period) where period is not null do nothing;
    end if;
  exception when others then
    raise warning 'project_closed_survey failed: %', sqlerrm;
  end;
  return null;
end;
$$;
drop trigger if exists projects_closed_survey on projects;
create trigger projects_closed_survey after update of status on projects
  for each row execute function project_closed_survey();

-- Every quarter, in its last month: one survey per running monthly contract
-- that ran the whole quarter and has an active client. Called by the sender
-- (netlify/functions/notify-dispatch.mjs) with the server key; idempotent.
-- `p_today` is for the tests; the sender leaves it out.
create or replace function survey_quarterly_due(p_today date default null) returns integer
  language plpgsql volatile security invoker set search_path = public
as $$
declare
  today date := coalesce(p_today, (now() at time zone 'Europe/Budapest')::date);
  q date := date_trunc('quarter', today)::date;
  label text := to_char(q, 'YYYY') || '-Q' || to_char(q, 'Q');
  n integer;
begin
  if today < (q + interval '2 months')::date then
    return 0;
  end if;
  insert into client_surveys (project_id, reason, period, created_by)
  select p.id, 'quarterly', label, null
  from projects p
  where p.billing = 'monthly' and p.status <> 'completed' and p.archived_at is null
    and coalesce(p.start_date, (p.created_at at time zone 'Europe/Budapest')::date) <= q
    and exists (select 1 from client_project_access x join client_accounts a on a.id = x.account_id
                where x.project_id = p.id and x.revoked_at is null and a.status = 'active' and a.user_id is not null)
  on conflict (project_id, period) where period is not null do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- The caller's open surveys (asked in the last 60 days) and the ones answered
-- in the last 30. The Google link only next to an answer of 7 or more.
create or replace function client_portal_surveys()
returns table (survey_id uuid, project_id uuid, reason text, period text, created_at timestamptz,
               score smallint, comment text, answered_at timestamptz, google_url text)
  language sql stable security definer set search_path = public as $$
  select s.id, s.project_id, s.reason, s.period, s.created_at, s.score, s.comment, s.answered_at,
         case when s.score >= 7 then (select g.google_review_url from portal_settings g where g.id) end
  from client_surveys s
  where s.cancelled_at is null
    and ((s.answered_at is null and s.created_at > now() - interval '60 days') or s.answered_at > now() - interval '30 days')
    and client_account_id() is not null and client_has_project(s.project_id)
  order by s.created_at
$$;

-- Answered once (the first colleague's answer counts). Returns the Google link
-- for 7 or more, else NULL.
create or replace function client_answer_survey(p_survey uuid, p_score integer, p_comment text default null)
returns text
  language plpgsql volatile security definer set search_path = public as $$
declare
  me uuid := client_account_id();
  s client_surveys;
begin
  select * into s from client_surveys where id = p_survey for update;
  if me is null or s.id is null or s.cancelled_at is not null or not client_has_project(s.project_id) then
    raise exception 'stratos:client_no_access' using errcode = '42501';
  end if;
  if s.answered_at is not null then
    raise exception 'stratos:survey_answered' using errcode = 'P0001';
  end if;
  if p_score is null or p_score < 1 or p_score > 10 then
    raise exception 'stratos:survey_score' using errcode = 'P0001';
  end if;
  update client_surveys
     set score = p_score, comment = left(nullif(btrim(coalesce(p_comment, '')), ''), 2000), answered_at = now(), account_id = me
   where id = s.id;
  insert into activity_logs (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'project.survey_answered', 'project', s.project_id, jsonb_build_object('survey', s.id, 'score', p_score));
  return case when p_score >= 7 then (select g.google_review_url from portal_settings g where g.id) end;
end;
$$;

-- The client opened the Google review page (for the owner's figures).
create or replace function client_survey_google(p_survey uuid) returns void
  language plpgsql volatile security definer set search_path = public as $$
begin
  update client_surveys set google_clicked_at = coalesce(google_clicked_at, now())
   where id = p_survey and account_id = client_account_id() and client_account_id() is not null and score >= 7
     and client_has_project(project_id);
end;
$$;


-- ###########################################################################
-- 5. NOTIFICATIONS — the new kinds, and the owner's triggers
-- ###########################################################################

alter table notification_outbox drop constraint if exists notification_outbox_kind_check;
alter table notification_outbox add constraint notification_outbox_kind_check check (kind in (
  -- to the owner, when a client acts
  'client_upload', 'client_feedback', 'client_reschedule', 'client_reschedule_withdrawn', 'test',
  'client_message', 'client_approved', 'client_changes_requested', 'client_request_done', 'client_survey',
  -- to a client
  'document_shared', 'demo_published', 'meeting_scheduled', 'meeting_changed', 'meeting_cancelled',
  'reschedule_decided', 'feedback_replied', 'request_added', 'message_posted', 'approval_requested', 'survey_requested'));

drop policy if exists notification_outbox_owner_insert on notification_outbox;
create policy notification_outbox_owner_insert on notification_outbox
  for insert with check (
    is_owner() and sent_at is null and attempts = 0 and claimed_at is null
    and ((audience = 'client' and kind in ('document_shared', 'demo_published', 'meeting_scheduled', 'meeting_changed',
                                          'meeting_cancelled', 'reschedule_decided', 'feedback_replied',
                                          'request_added', 'message_posted', 'approval_requested'))
         or (audience = 'owner' and kind = 'test')));

create or replace function notify_owner_client_experience() returns trigger
  language plpgsql security definer set search_path = public
as $$
begin
  -- A notification must never cost the client their action: a failure here is
  -- a warning in the Postgres log, nothing more.
  begin
    if tg_table_name = 'project_messages' then
      if new.account_id is not null then
        insert into notification_outbox (audience, kind, project_id, payload, created_by)
        values ('owner', 'client_message', new.project_id,
                jsonb_build_object('message_id', new.id, 'account_id', new.account_id, 'excerpt', left(new.body, 300)), null);
      end if;
    elsif tg_table_name = 'project_demos' then
      if new.approval_state is not null and old.approval_state is null then
        insert into notification_outbox (audience, kind, project_id, payload, created_by)
        values ('owner', case when new.approval_state = 'approved' then 'client_approved' else 'client_changes_requested' end,
                new.project_id, jsonb_build_object('demo_id', new.id, 'title', new.title, 'account_id', new.approval_account_id,
                                                   'excerpt', left(coalesce(new.approval_note, ''), 300)), null);
      end if;
    elsif tg_table_name = 'client_requests' then
      if new.done_at is not null and old.done_at is null and new.done_account_id is not null then
        insert into notification_outbox (audience, kind, project_id, payload, created_by)
        values ('owner', 'client_request_done', new.project_id,
                jsonb_build_object('request_id', new.id, 'title', new.title, 'account_id', new.done_account_id,
                                   'excerpt', left(coalesce(new.done_note, ''), 300)), null);
      end if;
    elsif tg_table_name = 'client_surveys' then
      if new.answered_at is not null and old.answered_at is null then
        insert into notification_outbox (audience, kind, project_id, payload, created_by)
        values ('owner', 'client_survey', new.project_id,
                jsonb_build_object('survey_id', new.id, 'score', new.score, 'account_id', new.account_id,
                                   'excerpt', left(coalesce(new.comment, ''), 300)), null);
      end if;
    end if;
  exception when others then
    raise warning 'notify_owner_client_experience failed: %', sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists project_messages_notify_owner on project_messages;
create trigger project_messages_notify_owner after insert on project_messages
  for each row execute function notify_owner_client_experience();
drop trigger if exists project_demos_notify_owner on project_demos;
create trigger project_demos_notify_owner after update of approval_state on project_demos
  for each row execute function notify_owner_client_experience();
drop trigger if exists client_requests_notify_owner on client_requests;
create trigger client_requests_notify_owner after update of done_at on client_requests
  for each row execute function notify_owner_client_experience();
drop trigger if exists client_surveys_notify_owner on client_surveys;
create trigger client_surveys_notify_owner after update of answered_at on client_surveys
  for each row execute function notify_owner_client_experience();


-- ###########################################################################
-- ACCESS
-- ###########################################################################

do $$
declare t text;
begin
  foreach t in array array['client_requests', 'project_messages', 'client_surveys'] loop
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
      execute format('grant select, insert, update on table %I to authenticated', t);
    end if;
  end loop;

  execute 'revoke all on table portal_settings from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table portal_settings from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table portal_settings from authenticated';
    execute 'grant select, update on table portal_settings to authenticated';
  end if;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'client_decide_demo(uuid, boolean, text)', 'client_portal_approvals()',
    'client_complete_request(uuid, text)', 'client_portal_requests()',
    'client_send_message(uuid, text)', 'client_portal_messages()',
    'client_portal_surveys()', 'client_answer_survey(uuid, integer, text)', 'client_survey_google(uuid)'
  ] loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', f);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('grant execute on function %s to authenticated', f);
    end if;
  end loop;

  -- The quarterly run: the sender's server key only.
  execute 'revoke all on function survey_quarterly_due(date) from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function survey_quarterly_due(date) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function survey_quarterly_due(date) from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function survey_quarterly_due(date) to service_role';
  end if;
end $$;

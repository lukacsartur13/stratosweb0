-- =============================================================================
-- Stratos — notifications: e-mail to clients, push and e-mail to the owner
--
--   1. push_subscriptions   a browser/phone that asked for push, per person
--   2. notification_outbox  what is to be said, to whom ('owner' | 'client').
--                           Rows for the OWNER are written by triggers when a
--                           client acts; rows for a CLIENT are written by the
--                           owner's Portal when "Notify the client" is ticked.
--                           netlify/functions/notify-dispatch.mjs sends them
--                           every minute and marks each one sent or failed.
--   3. recipients           resolved at send time, in the database, from what
--                           is true THEN: a client is mailed only while their
--                           account is active and still has the project
--   4. replies              the owner answers a client's demo feedback; the
--                           client sees the answer in the portal
--
-- Nothing is rewritten. Run after 20261012000100_time_entries.sql.
-- =============================================================================

do $$
begin
  if current_user in ('anon', 'authenticated') then
    raise exception 'Run this migration from the SQL editor, not as an API role.';
  end if;
end $$;


-- ###########################################################################
-- 1. PUSH SUBSCRIPTIONS
-- ###########################################################################

create table if not exists push_subscriptions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references profiles(id) on delete cascade default auth.uid(),
  endpoint        text not null unique check (endpoint ~ '^https://' and length(endpoint) <= 1000),
  p256dh          text not null check (length(p256dh) between 20 and 200),
  auth            text not null check (length(auth) between 8 and 100),
  user_agent      text check (user_agent is null or length(user_agent) <= 300),
  created_at      timestamptz not null default now(),
  last_success_at timestamptz,
  failures        integer not null default 0
);

alter table push_subscriptions enable row level security;
alter table push_subscriptions force row level security;
drop policy if exists push_subscriptions_own on push_subscriptions;
-- Staff only, and only their own devices.
create policy push_subscriptions_own on push_subscriptions
  for all using (user_id = auth.uid() and is_admin()) with check (user_id = auth.uid() and is_admin());

-- One device, one owner of it: subscribing again (or as another person on a
-- shared computer) replaces the row for that endpoint.
create or replace function push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns void
  language plpgsql security definer set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'stratos:push_forbidden' using errcode = '42501';
  end if;
  delete from push_subscriptions where endpoint = p_endpoint;
  insert into push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300));
end;
$$;


-- ###########################################################################
-- 2. THE OUTBOX
-- ###########################################################################

create table if not exists notification_outbox (
  id          uuid primary key default gen_random_uuid(),
  audience    text not null check (audience in ('owner', 'client')),
  kind        text not null check (kind in (
                -- to the owner, when a client acts
                'client_upload', 'client_feedback', 'client_reschedule', 'client_reschedule_withdrawn', 'test',
                -- to a client, when the owner chose to tell them
                'document_shared', 'demo_published', 'meeting_scheduled', 'meeting_changed', 'meeting_cancelled',
                'reschedule_decided', 'feedback_replied')),
  project_id  uuid references projects(id) on delete cascade,
  -- For a client message: only these accounts (still checked at send time).
  -- NULL = every account that has the project.
  account_ids uuid[],
  payload     jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object' and length(payload::text) <= 8000),
  created_by  uuid references profiles(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  claimed_at  timestamptz,
  attempts    integer not null default 0,
  sent_at     timestamptz,
  last_error  text check (last_error is null or length(last_error) <= 1000),
  check (audience = 'owner' or project_id is not null)
);

create index if not exists notification_outbox_pending_idx on notification_outbox (created_at) where sent_at is null;

alter table notification_outbox enable row level security;
alter table notification_outbox force row level security;
drop policy if exists notification_outbox_owner_select on notification_outbox;
drop policy if exists notification_outbox_owner_insert on notification_outbox;
create policy notification_outbox_owner_select on notification_outbox
  for select using (is_owner());
-- The role that owns the trigger functions (the migration runner, as in
-- 20261001000100) may write and read here even if it lacks BYPASSRLS.
drop policy if exists notification_outbox_definer_all on notification_outbox;
do $$ begin
  execute format('create policy notification_outbox_definer_all on notification_outbox for all to %I using (true) with check (true)',
                 client_definer_role());
end $$;

-- The owner's Portal writes client messages (and a test to themselves);
-- owner messages about clients are written by the triggers below.
create policy notification_outbox_owner_insert on notification_outbox
  for insert with check (
    is_owner() and sent_at is null and attempts = 0 and claimed_at is null
    and ((audience = 'client' and kind in ('document_shared', 'demo_published', 'meeting_scheduled', 'meeting_changed',
                                          'meeting_cancelled', 'reschedule_decided', 'feedback_replied'))
         or (audience = 'owner' and kind = 'test')));

-- Owner messages, written when a client acts. Trigger functions: they run with
-- the rights they need and are not callable through the API.
create or replace function notify_owner_client_upload() returns trigger
  language plpgsql security definer set search_path = public
as $$
begin
  -- A notification must never cost the client their upload, feedback or
  -- proposal: a failure here is a warning in the Postgres log, nothing more.
  begin
    if new.client_account_id is not null and new.upload_state = 'ready'
       and (tg_op = 'INSERT' or old.upload_state is distinct from 'ready') then
      insert into notification_outbox (audience, kind, project_id, payload, created_by)
      values ('owner', 'client_upload', new.project_id,
              jsonb_build_object('document_id', new.id, 'name', new.name, 'account_id', new.client_account_id), null);
    end if;
  exception when others then
    raise warning 'notify_owner_client_upload failed: %', sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists project_documents_notify_owner on project_documents;
create trigger project_documents_notify_owner after insert or update of upload_state on project_documents
  for each row execute function notify_owner_client_upload();

create or replace function notify_owner_client_feedback() returns trigger
  language plpgsql security definer set search_path = public
as $$
begin
  -- A notification must never cost the client their upload, feedback or
  -- proposal: a failure here is a warning in the Postgres log, nothing more.
  begin
    insert into notification_outbox (audience, kind, project_id, payload, created_by)
    values ('owner', 'client_feedback', new.project_id,
            jsonb_build_object('feedback_id', new.id, 'demo_id', new.demo_id, 'account_id', new.account_id,
                               'excerpt', left(new.body, 300)), null);
  exception when others then
    raise warning 'notify_owner_client_feedback failed: %', sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists demo_feedback_notify_owner on demo_feedback;
create trigger demo_feedback_notify_owner after insert on demo_feedback
  for each row execute function notify_owner_client_feedback();

create or replace function notify_owner_client_reschedule() returns trigger
  language plpgsql security definer set search_path = public
as $$
begin
  -- A notification must never cost the client their upload, feedback or
  -- proposal: a failure here is a warning in the Postgres log, nothing more.
  begin
    if tg_op = 'INSERT' then
      insert into notification_outbox (audience, kind, project_id, payload, created_by)
      values ('owner', 'client_reschedule', new.project_id,
              jsonb_build_object('request_id', new.id, 'meeting_id', new.meeting_id, 'account_id', new.account_id,
                                 'starts_at', new.proposed_starts_at, 'time_zone', new.time_zone,
                                 'message', left(coalesce(new.message, ''), 300)), null);
    elsif new.status = 'withdrawn' and old.status = 'pending' then
      insert into notification_outbox (audience, kind, project_id, payload, created_by)
      values ('owner', 'client_reschedule_withdrawn', new.project_id,
              jsonb_build_object('request_id', new.id, 'meeting_id', new.meeting_id, 'account_id', new.account_id), null);
    end if;
  exception when others then
    raise warning 'notify_owner_client_reschedule failed: %', sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists meeting_change_requests_notify_owner on meeting_change_requests;
create trigger meeting_change_requests_notify_owner after insert or update of status on meeting_change_requests
  for each row execute function notify_owner_client_reschedule();


-- ###########################################################################
-- 3. SENDING — for netlify/functions/notify-dispatch.mjs (server key only)
-- ###########################################################################

-- Claims up to `p_limit` unsent messages (one sender at a time per row: SKIP
-- LOCKED, and a claim older than 5 minutes is retried) and returns each with
-- its recipients resolved NOW. Gives up on a message after 5 attempts.
-- SECURITY INVOKER: callable only with the server key, which reads past RLS.
create or replace function notification_claim(p_limit integer default 50)
returns table (
  id uuid, audience text, kind text, payload jsonb, created_at timestamptz,
  project_id uuid, project_name text, client_name text, recipients jsonb
)
  language sql volatile security invoker set search_path = public
as $$
  with picked as (
    select o.id from notification_outbox o
    where o.sent_at is null and o.attempts < 5
      and (o.claimed_at is null or o.claimed_at < now() - interval '5 minutes')
    order by o.created_at
    limit greatest(1, least(p_limit, 200))
    for update skip locked
  ), claimed as (
    update notification_outbox o set claimed_at = now(), attempts = o.attempts + 1
    from picked where o.id = picked.id
    returning o.*
  )
  select c.id, c.audience, c.kind, c.payload, c.created_at, c.project_id, p.name, org.name,
    case c.audience
      when 'owner' then (
        select coalesce(jsonb_agg(jsonb_build_object('user_id', pr.id, 'email', pr.email,
                                                     'name', coalesce(pr.full_name, pr.email), 'locale', pr.locale)), '[]'::jsonb)
        from portal_owner po join profiles pr on pr.id = po.user_id)
      else (
        select coalesce(jsonb_agg(jsonb_build_object('user_id', a.user_id, 'email', a.email,
                                                     'name', a.full_name, 'locale', coalesce(pr.locale, 'hu'))), '[]'::jsonb)
        from client_accounts a
        join client_project_access x on x.account_id = a.id and x.project_id = c.project_id and x.revoked_at is null
        left join profiles pr on pr.id = a.user_id
        where a.status = 'active' and a.user_id is not null
          and (c.account_ids is null or a.id = any (c.account_ids)))
    end
  from claimed c
  left join projects p on p.id = c.project_id
  left join organizations org on org.id = p.organization_id
$$;

create or replace function notification_done(p_id uuid, p_error text default null) returns void
  language sql security invoker set search_path = public
as $$
  update notification_outbox
     set sent_at = case when p_error is null then now() else sent_at end,
         last_error = left(p_error, 1000),
         claimed_at = case when p_error is null then claimed_at else null end
   where id = p_id
$$;


-- ###########################################################################
-- 4. THE OWNER ANSWERS A CLIENT'S FEEDBACK
-- ###########################################################################

alter table demo_feedback add column if not exists owner_reply text
  check (owner_reply is null or length(btrim(owner_reply)) between 1 and 2000);
alter table demo_feedback add column if not exists replied_at timestamptz;
alter table demo_feedback add column if not exists replied_by uuid references profiles(id) on delete set null;

-- Same as 20261005000100, plus: the owner may write (or change) the reply; when
-- it is stamped and by whom is the database's to say.
create or replace function demo_feedback_rules() returns trigger
  language plpgsql set search_path = public
as $$
begin
  if (to_jsonb(new) - 'read_at' - 'read_by' - 'owner_reply' - 'replied_at' - 'replied_by')
     is distinct from (to_jsonb(old) - 'read_at' - 'read_by' - 'owner_reply' - 'replied_at' - 'replied_by') then
    raise exception 'stratos:feedback_fixed' using errcode = 'P0001';
  end if;
  new.read_by := case when new.read_at is null then null else coalesce(auth.uid(), new.read_by) end;
  if new.owner_reply is distinct from old.owner_reply then
    new.replied_at := case when new.owner_reply is null then null else now() end;
    new.replied_by := case when new.owner_reply is null then null else auth.uid() end;
    -- An answer is also a reading.
    if new.owner_reply is not null and new.read_at is null then
      new.read_at := now();
      new.read_by := auth.uid();
    end if;
  else
    new.replied_at := old.replied_at;
    new.replied_by := old.replied_by;
  end if;
  return new;
end;
$$;

-- Same as 20261005000100, plus the owner's reply. The return type grows.
drop function if exists client_portal_demo_feedback();
create function client_portal_demo_feedback()
returns table (feedback_id uuid, demo_id uuid, body text, created_at timestamptz, seen boolean, reply text, replied_at timestamptz)
  language sql stable security definer set search_path = public as $$
  select f.id, f.demo_id, f.body, f.created_at, f.read_at is not null, f.owner_reply, f.replied_at
  from demo_feedback f join project_demos d on d.id = f.demo_id
  where f.account_id = client_account_id() and client_account_id() is not null
    and d.published and d.revoked_at is null and client_has_project(f.project_id)
  order by f.created_at
$$;


-- ###########################################################################
-- GRANTS
-- ###########################################################################

do $$
declare f text;
begin
  execute 'revoke all on table push_subscriptions, notification_outbox from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table push_subscriptions, notification_outbox from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant select, delete on table push_subscriptions to authenticated';
    execute 'grant select, insert on table notification_outbox to authenticated';
  end if;

  foreach f in array array['push_subscribe(text, text, text, text)', 'client_portal_demo_feedback()'] loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', f);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('grant execute on function %s to authenticated', f);
    end if;
  end loop;

  -- The sender's two functions: the server key only.
  foreach f in array array['notification_claim(integer)', 'notification_done(uuid, text)'] loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', f);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on function %s from authenticated', f);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f);
    end if;
  end loop;
end $$;

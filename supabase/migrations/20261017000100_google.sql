-- =============================================================================
-- Stratos — Google: e-mail history (Gmail) and calendar sync
-- ("5. CRM" e-mail history + "6. Google integrations", 2026-10-05)
--
-- Owner decisions: every admin connects their OWN Google account in Settings;
-- the e-mails exchanged with a lead, a client contact or a deal's contact show
-- on that lead's, client's or deal's page; meetings made in the Portal go into
-- the Google Calendar of the person who made them (optionally with a Meet link
-- and the client invited).
--
--   1. google_accounts   one per person. The refresh token is stored ENCRYPTED
--                        by the server (AES-256-GCM, key GOOGLE_TOKEN_KEY in
--                        Netlify only) and is not readable through the API at
--                        all — not even by its owner.
--   2. email_messages    only messages whose From/To/Cc contains a KNOWN
--                        address (lead, client contact, deal contact): subject,
--                        addresses, date, a short snippet. No body, no
--                        attachment. Matched to the lead / client / deal.
--   3. meetings          project_meetings gains the Google event it is synced
--                        to; a change marks it for the next sync.
--
-- The syncing is done by netlify/functions/google-sync.mjs with the server key
-- (google_sync_targets(), email_store()). Run after
-- 20261016000100_revenue_report.sql. Re-runnable.
-- =============================================================================

do $$
begin
  if current_user in ('anon', 'authenticated') then
    raise exception 'Run this migration from the SQL editor, not as an API role.';
  end if;
end $$;


-- ###########################################################################
-- 1. CONNECTED ACCOUNTS
-- ###########################################################################

create table if not exists google_accounts (
  user_id           uuid primary key references profiles(id) on delete cascade,
  google_email      text not null check (length(google_email) <= 320),
  scopes            text not null default '',
  refresh_token_enc text not null check (length(refresh_token_enc) <= 4000),
  connected_at      timestamptz not null default now(),
  gmail_synced_at   timestamptz,
  calendar_synced_at timestamptz,
  last_error        text check (last_error is null or length(last_error) <= 500)
);

alter table google_accounts enable row level security;
alter table google_accounts force row level security;
drop policy if exists google_accounts_own_read on google_accounts;
create policy google_accounts_own_read on google_accounts for select using (user_id = auth.uid() and is_admin());
drop policy if exists google_accounts_own_delete on google_accounts;
create policy google_accounts_own_delete on google_accounts for delete using (user_id = auth.uid() and is_admin());


-- ###########################################################################
-- 2. E-MAIL HISTORY
-- ###########################################################################

create table if not exists email_messages (
  id              uuid primary key default gen_random_uuid(),
  mailbox_user_id uuid not null references profiles(id) on delete cascade,
  gmail_id        text not null check (length(gmail_id) <= 64),
  thread_id       text check (thread_id is null or length(thread_id) <= 64),
  direction       text not null check (direction in ('in', 'out')),
  from_email      text not null check (length(from_email) <= 320),
  from_name       text check (from_name is null or length(from_name) <= 200),
  to_emails       text[] not null default '{}',
  subject         text check (subject is null or length(subject) <= 500),
  snippet         text check (snippet is null or length(snippet) <= 500),
  sent_at         timestamptz not null,
  lead_id         uuid references leads(id) on delete set null,
  organization_id uuid references organizations(id) on delete set null,
  opportunity_id  uuid references opportunities(id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (mailbox_user_id, gmail_id),
  check (lead_id is not null or organization_id is not null or opportunity_id is not null)
);
create index if not exists email_messages_lead_idx on email_messages (lead_id, sent_at desc) where lead_id is not null;
create index if not exists email_messages_org_idx on email_messages (organization_id, sent_at desc) where organization_id is not null;
create index if not exists email_messages_deal_idx on email_messages (opportunity_id, sent_at desc) where opportunity_id is not null;

alter table email_messages enable row level security;
alter table email_messages force row level security;
-- The team's shared history: every admin reads it, as they read the leads,
-- clients and deals it belongs to. Written only by the sync (server key).
drop policy if exists email_messages_admin_read on email_messages;
create policy email_messages_admin_read on email_messages for select using (is_admin());

-- Every address the history is matched against, lower-cased: leads, client
-- contacts, deal contacts. For the sync (server key).
create or replace function email_known_addresses()
returns table (email text, lead_id uuid, organization_id uuid, opportunity_id uuid)
  language sql stable security invoker set search_path = public
as $$
  select lower(btrim(l.email)), l.id, null::uuid, null::uuid from leads l
   where l.trashed_at is null and l.email ~ '@'
  union all
  select lower(btrim(c.email)), null, c.organization_id, null from client_contacts c
   join organizations o on o.id = c.organization_id
   where c.email ~ '@' and o.archived_at is null
  union all
  select lower(btrim(o.contact_email)), null, o.organization_id, o.id from opportunities o
   where o.contact_email ~ '@' and o.archived_at is null
$$;

-- Stores one message (idempotent). An OUTGOING message to a lead that is still
-- 'new' is also logged as an e-mail in the lead's activity log, which is what
-- the "no reply" automation looks for (20261015000100).
create or replace function email_store(
  p_mailbox uuid, p_gmail_id text, p_thread_id text, p_direction text, p_from text, p_from_name text,
  p_to text[], p_subject text, p_snippet text, p_sent_at timestamptz,
  p_lead uuid, p_org uuid, p_deal uuid
) returns boolean
  language plpgsql volatile security invoker set search_path = public
as $$
declare
  made uuid;
begin
  insert into email_messages (mailbox_user_id, gmail_id, thread_id, direction, from_email, from_name, to_emails,
                              subject, snippet, sent_at, lead_id, organization_id, opportunity_id)
  values (p_mailbox, p_gmail_id, p_thread_id, p_direction, left(lower(p_from), 320), left(p_from_name, 200),
          (select coalesce(array_agg(left(lower(x), 320)), '{}') from unnest(p_to[1:50]) x),
          left(p_subject, 500), left(p_snippet, 500), p_sent_at, p_lead, p_org, p_deal)
  on conflict (mailbox_user_id, gmail_id) do nothing
  returning id into made;
  if made is null then
    return false;
  end if;
  if p_direction = 'out' and p_lead is not null
     and exists (select 1 from leads l where l.id = p_lead and l.status = 'new') then
    insert into interactions (kind, summary, lead_id, occurred_at, created_by)
    values ('email', left('E-mail: ' || coalesce(nullif(btrim(p_subject), ''), '—'), 500), p_lead, p_sent_at, p_mailbox);
  end if;
  return true;
end;
$$;


-- ###########################################################################
-- 3. CALENDAR
-- ###########################################################################

alter table project_meetings add column if not exists google_sync boolean not null default true;
alter table project_meetings add column if not exists google_meet boolean not null default false;
alter table project_meetings add column if not exists google_invite_clients boolean not null default false;
alter table project_meetings add column if not exists google_event_id text check (google_event_id is null or length(google_event_id) <= 200);
alter table project_meetings add column if not exists google_calendar_user uuid references profiles(id) on delete set null;
-- NULL = up to date; set when the meeting changes, cleared by the sync.
alter table project_meetings add column if not exists google_dirty_at timestamptz default now();
alter table project_meetings add column if not exists google_error text check (google_error is null or length(google_error) <= 500);

-- Any change the calendar would show marks the meeting for the next sync.
create or replace function project_meeting_google_dirty() returns trigger
  language plpgsql set search_path = public
as $$
begin
  -- The sync's own write-back (google_mark_synced) is not a change to push.
  if current_setting('stratos.google_sync', true) = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT'
     or (new.title, new.starts_at, new.ends_at, new.time_zone, new.join_url, new.location, new.client_note, new.cancelled_at,
         new.google_sync, new.google_meet, new.google_invite_clients)
        is distinct from
        (old.title, old.starts_at, old.ends_at, old.time_zone, old.join_url, old.location, old.client_note, old.cancelled_at,
         old.google_sync, old.google_meet, old.google_invite_clients) then
    new.google_dirty_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists project_meetings_google_dirty on project_meetings;
create trigger project_meetings_google_dirty before insert or update on project_meetings
  for each row execute function project_meeting_google_dirty();

-- What the sync must push now: every meeting changed since its last sync, with
-- the calendar it belongs in (the person who made it, if connected; else the
-- portal owner) and, if asked, the client addresses to invite.
create or replace function google_sync_targets()
returns table (meeting_id uuid, calendar_user uuid, event_id text, title text, starts_at timestamptz, ends_at timestamptz,
               time_zone text, join_url text, location text, note text, cancelled boolean, want_sync boolean,
               want_meet boolean, invite text[], project_name text, dirty_at timestamptz)
  language sql stable security invoker set search_path = public
as $$
  select m.id,
         coalesce(m.google_calendar_user,
                  case when exists (select 1 from google_accounts g where g.user_id = m.created_by) then m.created_by end,
                  (select po.user_id from portal_owner po join google_accounts g on g.user_id = po.user_id limit 1)),
         m.google_event_id, m.title, m.starts_at, m.ends_at, m.time_zone, m.join_url, m.location, m.client_note,
         m.cancelled_at is not null, m.google_sync, m.google_meet,
         case when m.google_invite_clients then (
           select coalesce(array_agg(distinct lower(a.email)), '{}')
           from client_project_access x join client_accounts a on a.id = x.account_id
           where x.project_id = m.project_id and x.revoked_at is null and a.status = 'active') else '{}' end,
         p.name, m.google_dirty_at
  from project_meetings m join projects p on p.id = m.project_id
  where m.google_dirty_at is not null
    and (m.google_event_id is not null or (m.google_sync and m.cancelled_at is null and m.ends_at > now()))
  order by m.google_dirty_at
  limit 50
$$;


-- The sync's result for one meeting: the event it now is (or NULL after a
-- delete), the Meet link Google made (written into join_url when the meeting
-- had none), or the error. Clears the mark only if nothing changed meanwhile.
create or replace function google_mark_synced(p_meeting uuid, p_seen timestamptz, p_event text, p_calendar_user uuid,
                                              p_meet_url text default null, p_error text default null)
returns void
  language plpgsql volatile security invoker set search_path = public
as $$
begin
  perform set_config('stratos.google_sync', 'on', true);
  update project_meetings
     set google_event_id = case when p_error is null then p_event else google_event_id end,
         google_calendar_user = coalesce(p_calendar_user, google_calendar_user),
         join_url = case when p_meet_url is not null and join_url is null then p_meet_url else join_url end,
         google_error = left(p_error, 500),
         google_dirty_at = case when p_error is null and google_dirty_at <= p_seen then null else google_dirty_at end
   where id = p_meeting;
  perform set_config('stratos.google_sync', 'off', true);
end;
$$;


-- ###########################################################################
-- ACCESS
-- ###########################################################################

do $$
declare f text;
begin
  -- google_accounts: the owner of the row reads everything but the token.
  execute 'revoke all on table google_accounts, email_messages from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table google_accounts, email_messages from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table google_accounts, email_messages from authenticated';
    execute 'grant select (user_id, google_email, scopes, connected_at, gmail_synced_at, calendar_synced_at, last_error) on google_accounts to authenticated';
    execute 'grant delete on google_accounts to authenticated';
    execute 'grant select on email_messages to authenticated';
  end if;

  foreach f in array array[
    'email_known_addresses()',
    'email_store(uuid, text, text, text, text, text, text[], text, text, timestamptz, uuid, uuid, uuid)',
    'google_sync_targets()',
    'google_mark_synced(uuid, timestamptz, text, uuid, text, text)'
  ] loop
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

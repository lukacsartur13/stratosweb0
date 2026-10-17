-- =============================================================================
-- Stratos — meeting booking: free times from the owner's Google Calendar,
-- every booking a Google Meet invitation ("Időpontfoglalás", 2026-10-18)
--
-- Owner decisions of 2026-10-18 (the defaults below):
--   * the public site (a free consultation; it becomes a lead) AND the
--     signed-in portal clients (tied to their project) may book;
--   * Monday–Friday 9:00–17:00 Budapest time; 30 minutes on the public site,
--     30 or 60 for a client; 15 minutes between two bookings; at least 24 hours
--     ahead, at most 30 days ahead; at most 4 bookings a day;
--   * the guest may cancel or move a booking up to 12 hours before it, with the
--     link they were given (a client: in the portal); later only by message;
--   * only the owner's primary Google calendar counts as busy;
--   * one open public booking per e-mail address.
--
--   1. booking_settings   one row: the rules above. Admins read, the owner edits.
--   2. bookings           one row per booking. An EXCLUSION CONSTRAINT makes two
--                         confirmed bookings (each with its trailing buffer)
--                         overlapping impossible, whatever happens in between —
--                         two people clicking the same time, two function
--                         instances, a retry.
--   3. the server's side  booking_reserve / booking_move / booking_cancel /
--                         booking_confirm / booking_fail / booking_restore — for
--                         netlify/functions/booking.mjs with the server key only.
--                         Each re-checks every rule here, so the function
--                         cannot book what the rules forbid.
--   4. clients            client_booking_identity(), client_portal_bookings().
--   5. leads and alerts   a confirmed public booking becomes (or joins) a lead
--                         with form_type 'booking'; the owner and the admins are
--                         told about bookings, moves and cancellations made by
--                         a guest or a client.
--
-- Google's own busy times are checked by the function (Calendar freeBusy) just
-- before it reserves; this database is the last word on the bookings it holds.
-- Run after 20261017000100_google.sql. Re-runnable.
-- =============================================================================

do $$
begin
  if to_regclass('public.google_accounts') is null then
    raise exception 'Google (20261017000100_google.sql) is not applied.';
  end if;
  if current_user in ('anon', 'authenticated') then
    raise exception 'Run this migration from the SQL editor, not as an API role.';
  end if;
end $$;


-- ###########################################################################
-- 1. SETTINGS
-- ###########################################################################

create table if not exists booking_settings (
  singleton       boolean primary key default true check (singleton),
  enabled         boolean not null default true,
  time_zone       text not null default 'Europe/Budapest',
  -- ISO weekdays: 1 = Monday … 7 = Sunday.
  weekdays        smallint[] not null default '{1,2,3,4,5}'
                  check (cardinality(weekdays) between 1 and 7 and weekdays <@ '{1,2,3,4,5,6,7}'::smallint[]),
  day_start       time not null default '09:00',
  day_end         time not null default '17:00',
  public_minutes  smallint not null default 30 check (public_minutes in (15, 30, 45, 60, 90)),
  client_minutes  smallint[] not null default '{30,60}'
                  check (cardinality(client_minutes) between 1 and 5 and client_minutes <@ '{15,30,45,60,90}'::smallint[]),
  buffer_minutes  smallint not null default 15 check (buffer_minutes between 0 and 120),
  notice_hours    smallint not null default 24 check (notice_hours between 0 and 336),
  horizon_days    smallint not null default 30 check (horizon_days between 1 and 180),
  daily_max       smallint not null default 4 check (daily_max between 1 and 20),
  change_hours    smallint not null default 12 check (change_hours between 0 and 168),
  -- Which of the owner's calendars count as busy. 'primary' = their main one.
  calendar_ids    text[] not null default '{primary}'
                  check (cardinality(calendar_ids) between 1 and 10),
  updated_at      timestamptz not null default now(),
  updated_by      uuid references profiles(id) on delete set null,
  check (day_end > day_start),
  check (extract(minute from day_start)::integer % 15 = 0 and extract(second from day_start) = 0
         and extract(minute from day_end)::integer % 15 = 0 and extract(second from day_end) = 0)
);

insert into booking_settings (singleton) values (true) on conflict do nothing;

create or replace function booking_settings_rules() returns trigger
  language plpgsql set search_path = public
as $$
begin
  if not portal_valid_time_zone(new.time_zone) then
    raise exception 'stratos:booking_time_zone' using errcode = 'P0001';
  end if;
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$$;
drop trigger if exists booking_settings_rules on booking_settings;
create trigger booking_settings_rules before insert or update on booking_settings
  for each row execute function booking_settings_rules();

alter table booking_settings enable row level security;
alter table booking_settings force row level security;
drop policy if exists booking_settings_admin_read on booking_settings;
create policy booking_settings_admin_read on booking_settings for select using (is_admin());
drop policy if exists booking_settings_owner_update on booking_settings;
create policy booking_settings_owner_update on booking_settings for update using (is_owner()) with check (is_owner());


-- ###########################################################################
-- 2. BOOKINGS
-- ###########################################################################

create table if not exists bookings (
  id                uuid primary key default gen_random_uuid(),
  kind              text not null check (kind in ('public', 'client')),
  -- confirmed: holds its time; cancelled: by the guest, the client or the
  -- owner; failed: reserved, but Google refused the event — never was real.
  status            text not null default 'confirmed' check (status in ('confirmed', 'cancelled', 'failed')),
  starts_at         timestamptz not null,
  ends_at           timestamptz not null,
  time_zone         text not null default 'Europe/Budapest',
  -- The gap kept free AFTER this booking, as it was when it was made.
  buffer_minutes    smallint not null default 0 check (buffer_minutes between 0 and 120),
  -- [starts_at, ends_at + buffer): what the exclusion constraint compares.
  -- Set by the trigger below, never by hand.
  blocks            tstzrange not null,
  guest_name        text not null check (length(btrim(guest_name)) between 1 and 120),
  guest_email       text not null
                    check (guest_email = lower(btrim(guest_email)) and length(guest_email) <= 254
                           and guest_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  guest_company     text check (guest_company is null or length(btrim(guest_company)) between 1 and 160),
  guest_phone       text check (guest_phone is null or guest_phone ~ '^[0-9+()./ -]{6,40}$'),
  topic             text check (topic is null or length(topic) <= 1000),
  locale            text not null default 'hu' check (locale in ('hu', 'en', 'de')),
  lead_id           uuid references leads(id) on delete set null,
  organization_id   uuid references organizations(id) on delete set null,
  project_id        uuid references projects(id) on delete set null,
  client_account_id uuid references client_accounts(id) on delete restrict,
  calendar_user     uuid references profiles(id) on delete set null,
  google_event_id   text check (google_event_id is null or length(google_event_id) <= 200),
  meet_url          text check (meet_url is null or (meet_url ~ '^https://meet\.google\.com/[A-Za-z0-9-]+$' and length(meet_url) <= 200)),
  -- SHA-256 (hex) of the guest's private link token; the token itself is
  -- never stored. Client bookings have none: they are managed in the portal.
  manage_hash       text unique check (manage_hash is null or manage_hash ~ '^[0-9a-f]{64}$'),
  error             text check (error is null or length(error) <= 500),
  moved_count       smallint not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  cancelled_at      timestamptz,
  cancelled_by      text check (cancelled_by is null or cancelled_by in ('guest', 'client', 'owner')),
  check (ends_at > starts_at),
  check (ends_at - starts_at <= interval '4 hours'),
  check (kind = 'public' or client_account_id is not null),
  check ((status = 'cancelled') = (cancelled_at is not null)),
  check ((status = 'cancelled') = (cancelled_by is not null))
);

create index if not exists bookings_starts_idx on bookings (starts_at) where status = 'confirmed';
create index if not exists bookings_email_idx on bookings (guest_email) where status = 'confirmed';
create index if not exists bookings_account_idx on bookings (client_account_id, starts_at) where client_account_id is not null;

create or replace function bookings_rules() returns trigger
  language plpgsql set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and (new.kind, new.guest_email, new.client_account_id) is distinct from (old.kind, old.guest_email, old.client_account_id) then
    raise exception 'stratos:booking_fixed' using errcode = 'P0001';
  end if;
  if not portal_valid_time_zone(new.time_zone) then
    raise exception 'stratos:booking_time_zone' using errcode = 'P0001';
  end if;
  new.blocks := tstzrange(new.starts_at, new.ends_at + make_interval(mins => new.buffer_minutes), '[)');
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists bookings_rules on bookings;
create trigger bookings_rules before insert or update on bookings
  for each row execute function bookings_rules();

-- Two confirmed bookings never overlap, buffers included. A plain range GiST
-- index: core Postgres, no extension.
do $$ begin
  alter table bookings add constraint bookings_no_overlap
    exclude using gist (blocks with &&) where (status = 'confirmed');
exception when duplicate_object or duplicate_table then null; end $$;

alter table bookings enable row level security;
alter table bookings force row level security;
-- The team's diary: every admin reads it. Nobody writes it through the API —
-- every change goes through the booking function, which also tells Google.
drop policy if exists bookings_admin_read on bookings;
create policy bookings_admin_read on bookings for select using (is_admin());


-- ###########################################################################
-- 3. THE SERVER'S SIDE (netlify/functions/booking.mjs, server key only)
-- ###########################################################################

-- Every rule a time must meet, for a booking of `p_kind` (or the booking
-- `p_ignore` being moved). Raises the first one it breaks.
create or replace function booking_check_time(p_kind text, p_starts timestamptz, p_ends timestamptz,
                                              p_ignore uuid default null, p_now timestamptz default null)
returns booking_settings
  language plpgsql stable security invoker set search_path = public
as $$
declare
  s booking_settings;
  now_ timestamptz := coalesce(p_now, now());
  ls timestamp;
  le timestamp;
  mins integer;
  taken integer;
begin
  select * into s from booking_settings where singleton;
  if s.singleton is null or not s.enabled then
    raise exception 'stratos:booking_disabled' using errcode = 'P0001';
  end if;
  mins := extract(epoch from (p_ends - p_starts))::integer / 60;
  if extract(epoch from (p_ends - p_starts))::integer % 60 <> 0
     or (p_kind = 'public' and mins <> s.public_minutes)
     or (p_kind = 'client' and not (mins::smallint = any (s.client_minutes))) then
    raise exception 'stratos:booking_length' using errcode = 'P0001';
  end if;
  if p_starts < now_ + make_interval(hours => s.notice_hours) then
    raise exception 'stratos:booking_too_soon' using errcode = 'P0001';
  end if;
  if p_starts > now_ + make_interval(days => s.horizon_days) then
    raise exception 'stratos:booking_too_far' using errcode = 'P0001';
  end if;
  ls := p_starts at time zone s.time_zone;
  le := p_ends at time zone s.time_zone;
  if ls::date <> le::date
     or not (extract(isodow from ls)::smallint = any (s.weekdays))
     or ls::time < s.day_start or le::time > s.day_end
     or extract(second from ls) <> 0 or extract(minute from ls)::integer % 15 <> 0 then
    raise exception 'stratos:booking_closed' using errcode = 'P0001';
  end if;
  select count(*) into taken from bookings b
   where b.status = 'confirmed' and b.id is distinct from p_ignore
     and (b.starts_at at time zone s.time_zone)::date = ls::date;
  if taken >= s.daily_max then
    raise exception 'stratos:booking_day_full' using errcode = 'P0001';
  end if;
  return s;
end;
$$;

-- A new booking, confirmed at once: the time is ours from this moment. The
-- function then creates the Google event and calls booking_confirm, or
-- booking_fail if Google refused. Returns the booking's id.
create or replace function booking_reserve(
  p_kind text, p_starts timestamptz, p_ends timestamptz,
  p_name text, p_email text, p_company text default null, p_phone text default null, p_topic text default null,
  p_locale text default 'hu', p_manage_hash text default null,
  p_account uuid default null, p_project uuid default null, p_now timestamptz default null
) returns uuid
  language plpgsql volatile security invoker set search_path = public
as $$
declare
  s booking_settings;
  acct client_accounts;
  email_ text := lower(btrim(coalesce(p_email, '')));
  made uuid;
begin
  -- One booking decision at a time: the day's count and the one-per-address
  -- rule are read and written under the same lock.
  perform pg_advisory_xact_lock(hashtextextended('stratos:booking', 0));
  s := booking_check_time(p_kind, p_starts, p_ends, null, p_now);
  if p_kind = 'client' then
    select * into acct from client_accounts where id = p_account and status = 'active';
    if acct.id is null
       or (p_project is not null and not exists (
             select 1 from client_project_access x
             where x.account_id = acct.id and x.project_id = p_project and x.revoked_at is null)) then
      raise exception 'stratos:client_no_access' using errcode = '42501';
    end if;
    if (select count(*) from bookings b where b.client_account_id = acct.id and b.status = 'confirmed'
          and b.ends_at > coalesce(p_now, now())) >= 3 then
      raise exception 'stratos:booking_client_limit' using errcode = 'P0001';
    end if;
  elsif p_kind = 'public' then
    if exists (select 1 from bookings b where b.guest_email = email_ and b.status = 'confirmed'
                 and b.ends_at > coalesce(p_now, now())) then
      raise exception 'stratos:booking_email_open' using errcode = 'P0001';
    end if;
  else
    raise exception 'stratos:booking_kind' using errcode = 'P0001';
  end if;
  begin
    insert into bookings (kind, starts_at, ends_at, time_zone, buffer_minutes, guest_name, guest_email, guest_company,
                          guest_phone, topic, locale, manage_hash, client_account_id, organization_id, project_id,
                          calendar_user)
    values (p_kind, p_starts, p_ends, s.time_zone, s.buffer_minutes,
            btrim(coalesce(case when p_kind = 'client' then acct.full_name else p_name end, '')),
            case when p_kind = 'client' then acct.email else email_ end,
            nullif(btrim(coalesce(p_company, '')), ''), nullif(btrim(coalesce(p_phone, '')), ''),
            nullif(btrim(coalesce(p_topic, '')), ''), coalesce(p_locale, 'hu'),
            case when p_kind = 'public' then p_manage_hash end,
            acct.id, acct.organization_id, case when p_kind = 'client' then p_project end,
            (select o.user_id from portal_owner o))
    returning id into made;
  exception when exclusion_violation then
    raise exception 'stratos:booking_taken' using errcode = 'P0001';
  end;
  return made;
end;
$$;

-- Google made the event: record it, and — for a public booking — make (or
-- join) the lead. The owner and the admins are told.
create or replace function booking_confirm(p_booking uuid, p_event text, p_meet_url text default null)
returns void
  language plpgsql volatile security invoker set search_path = public
as $$
declare
  b bookings;
  lead_ uuid;
begin
  update bookings set google_event_id = p_event, meet_url = p_meet_url, error = null
   where id = p_booking and status = 'confirmed'
  returning * into b;
  if b.id is null then
    raise exception 'stratos:booking_missing' using errcode = 'P0002';
  end if;
  if b.kind = 'public' and b.lead_id is null then
    -- The newest live lead with this address, if there is one; else a new one.
    select l.id into lead_ from leads l
     where lower(btrim(l.email)) = b.guest_email and l.trashed_at is null
     order by l.created_at desc limit 1;
    if lead_ is null then
      insert into leads (name, company, email, phone, message, source, form_type, locale, source_route, payload, meta)
      values (b.guest_name, b.guest_company, b.guest_email, b.guest_phone,
              coalesce(b.topic, ''), 'booking', 'booking', b.locale, null,
              jsonb_build_object('booking_id', b.id, 'starts_at', b.starts_at, 'time_zone', b.time_zone),
              jsonb_build_object('via', 'booking'))
      returning id into lead_;
    end if;
    update bookings set lead_id = lead_ where id = b.id;
    -- A booked call is an answer: the "nobody answered" alert stays quiet.
    insert into interactions (kind, summary, lead_id, occurred_at, created_by)
    values ('meeting',
            left('Időpontot foglalt: ' || to_char(b.starts_at at time zone b.time_zone, 'YYYY-MM-DD HH24:MI')
                 || ' (Google Meet)' || coalesce(' — ' || b.topic, ''), 4000),
            lead_, now(), null);
    b.lead_id := lead_;
  end if;
  perform booking_notify('booking_made', b);
end;
$$;

-- Google refused: the booking never was. Its time is free again.
create or replace function booking_fail(p_booking uuid, p_error text) returns void
  language plpgsql volatile security invoker set search_path = public
as $$
begin
  update bookings set status = 'failed', error = left(coalesce(p_error, 'failed'), 500)
   where id = p_booking and status = 'confirmed' and google_event_id is null;
end;
$$;

-- A new time for a confirmed booking: by its guest (or client) up to
-- change_hours before the CURRENT time; by the owner whenever. Every rule of
-- a new booking applies to the new time, except the one-per-address rule.
create or replace function booking_move(p_booking uuid, p_starts timestamptz, p_ends timestamptz, p_by text,
                                        p_now timestamptz default null)
returns bookings
  language plpgsql volatile security invoker set search_path = public
as $$
declare
  b bookings;
  s booking_settings;
begin
  perform pg_advisory_xact_lock(hashtextextended('stratos:booking', 0));
  select * into b from bookings where id = p_booking for update;
  if b.id is null or b.status <> 'confirmed' then
    raise exception 'stratos:booking_missing' using errcode = 'P0002';
  end if;
  select * into s from booking_settings where singleton;
  if p_by <> 'owner' and b.starts_at - make_interval(hours => s.change_hours) < coalesce(p_now, now()) then
    raise exception 'stratos:booking_too_late' using errcode = 'P0001';
  end if;
  perform booking_check_time(b.kind, p_starts, p_ends, b.id, p_now);
  begin
    update bookings set starts_at = p_starts, ends_at = p_ends, moved_count = moved_count + 1
     where id = b.id returning * into b;
  exception when exclusion_violation then
    raise exception 'stratos:booking_taken' using errcode = 'P0001';
  end;
  if p_by <> 'owner' then
    perform booking_notify('booking_moved', b);
  end if;
  return b;
end;
$$;

-- Google refused the moved event: back to the time it had. No rule is
-- re-checked (it was valid a moment ago); the overlap still is.
create or replace function booking_restore(p_booking uuid, p_starts timestamptz, p_ends timestamptz, p_error text)
returns void
  language plpgsql volatile security invoker set search_path = public
as $$
begin
  update bookings set starts_at = p_starts, ends_at = p_ends, moved_count = greatest(moved_count - 1, 0),
         error = left(p_error, 500)
   where id = p_booking and status = 'confirmed';
exception when exclusion_violation then
  update bookings set error = left('restore failed: ' || coalesce(p_error, ''), 500) where id = p_booking;
end;
$$;

-- Cancelled: by its guest (or client) up to change_hours before; by the
-- owner whenever. The time is free at once.
create or replace function booking_cancel(p_booking uuid, p_by text, p_now timestamptz default null)
returns bookings
  language plpgsql volatile security invoker set search_path = public
as $$
declare
  b bookings;
  s booking_settings;
begin
  if p_by not in ('guest', 'client', 'owner') then
    raise exception 'stratos:booking_kind' using errcode = 'P0001';
  end if;
  select * into b from bookings where id = p_booking for update;
  if b.id is null or b.status <> 'confirmed' then
    raise exception 'stratos:booking_missing' using errcode = 'P0002';
  end if;
  select * into s from booking_settings where singleton;
  if p_by <> 'owner' and b.starts_at - make_interval(hours => s.change_hours) < coalesce(p_now, now()) then
    raise exception 'stratos:booking_too_late' using errcode = 'P0001';
  end if;
  update bookings set status = 'cancelled', cancelled_at = now(), cancelled_by = p_by
   where id = b.id returning * into b;
  if p_by <> 'owner' then
    perform booking_notify('booking_cancelled', b);
  end if;
  return b;
end;
$$;

-- One owner message about a booking. A notification never costs the booking:
-- a failure is a warning in the Postgres log, nothing more.
create or replace function booking_notify(p_kind text, b bookings) returns void
  language plpgsql volatile security definer set search_path = public
as $$
begin
  begin
    insert into notification_outbox (audience, kind, project_id, payload, created_by)
    values ('owner', p_kind, b.project_id,
            jsonb_strip_nulls(jsonb_build_object(
              'booking_id', b.id, 'name', b.guest_name, 'starts_at', b.starts_at, 'time_zone', b.time_zone,
              'kind', b.kind, 'lead_id', b.lead_id, 'account_id', b.client_account_id)), null);
  exception when others then
    raise warning 'booking_notify failed: %', sqlerrm;
  end;
end;
$$;


-- ###########################################################################
-- 4. CLIENTS
-- ###########################################################################

-- Who the signed-in client is, for the booking function: their account, name,
-- address and the projects they have NOW. Nothing for anybody else.
create or replace function client_booking_identity()
returns table (account_id uuid, organization_id uuid, full_name text, email text, projects jsonb)
  language sql stable security definer set search_path = public as $$
  select a.id, a.organization_id, a.full_name, a.email,
         coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name) order by p.name)
                   from client_project_access x join projects p on p.id = x.project_id
                   where x.account_id = a.id and x.revoked_at is null), '[]'::jsonb)
  from client_accounts a
  where a.id = client_account_id()
$$;

-- The caller's own bookings: upcoming, and those of the last 30 days.
create or replace function client_portal_bookings()
returns table (booking_id uuid, starts_at timestamptz, ends_at timestamptz, time_zone text, status text,
               meet_url text, project_id uuid, project_name text, topic text, can_change boolean)
  language sql stable security definer set search_path = public as $$
  select b.id, b.starts_at, b.ends_at, b.time_zone, b.status, b.meet_url, b.project_id, p.name, b.topic,
         b.status = 'confirmed'
           and b.starts_at - make_interval(hours => (select s.change_hours from booking_settings s where s.singleton)) >= now()
  from bookings b left join projects p on p.id = b.project_id
  where b.client_account_id = client_account_id() and client_account_id() is not null
    and b.status in ('confirmed', 'cancelled')
    and b.ends_at > now() - interval '30 days'
  order by b.starts_at
$$;


-- ###########################################################################
-- 5. LEADS AND NOTIFICATIONS
-- ###########################################################################

alter table leads drop constraint if exists leads_form_type_check;
alter table leads add constraint leads_form_type_check
  check (form_type is null or form_type in ('newsletter', 'contact', 'impact', 'questionnaire', 'website', 'booking'));

alter table notification_outbox drop constraint if exists notification_outbox_kind_check;
alter table notification_outbox add constraint notification_outbox_kind_check check (kind in (
  -- to the owner and the admins
  'client_upload', 'client_feedback', 'client_reschedule', 'client_reschedule_withdrawn', 'test',
  'client_message', 'client_approved', 'client_changes_requested', 'client_request_done', 'client_survey',
  'auto_lead_unanswered', 'auto_deal_stale', 'auto_deal_won', 'auto_instalment_overdue', 'auto_deadline_soon',
  'booking_made', 'booking_moved', 'booking_cancelled',
  -- to a client
  'document_shared', 'demo_published', 'meeting_scheduled', 'meeting_changed', 'meeting_cancelled',
  'reschedule_decided', 'feedback_replied', 'request_added', 'message_posted', 'approval_requested', 'survey_requested'));


-- ###########################################################################
-- ACCESS
-- ###########################################################################

do $$
declare f text;
begin
  execute 'revoke all on table booking_settings, bookings from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table booking_settings, bookings from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table booking_settings, bookings from authenticated';
    execute 'grant select on table booking_settings, bookings to authenticated';
    execute 'grant update (enabled, weekdays, day_start, day_end, public_minutes, client_minutes, buffer_minutes,
                           notice_hours, horizon_days, daily_max, change_hours) on booking_settings to authenticated';
  end if;

  -- The server's functions: the booking function's key only.
  foreach f in array array[
    'booking_check_time(text, timestamptz, timestamptz, uuid, timestamptz)',
    'booking_reserve(text, timestamptz, timestamptz, text, text, text, text, text, text, text, uuid, uuid, timestamptz)',
    'booking_confirm(uuid, text, text)',
    'booking_fail(uuid, text)',
    'booking_move(uuid, timestamptz, timestamptz, text, timestamptz)',
    'booking_restore(uuid, timestamptz, timestamptz, text)',
    'booking_cancel(uuid, text, timestamptz)',
    'booking_notify(text, bookings)'
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

  -- The client's two: each answers only about the caller.
  foreach f in array array['client_booking_identity()', 'client_portal_bookings()'] loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', f);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('grant execute on function %s to authenticated', f);
    end if;
  end loop;
end $$;

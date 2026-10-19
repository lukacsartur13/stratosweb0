-- =============================================================================
-- Stratos — the newsletter: double opt-in, a welcome e-mail, campaigns sent
-- from the Portal, one-click unsubscribe ("Hírlevél", 2026-10-18)
--
-- Owner decisions of 2026-10-18:
--   * double opt-in: a signup is only a REQUEST until the address clicks the
--     confirmation link; then it gets a welcome e-mail;
--   * our own system, not a newsletter vendor: subscribers here, the mail
--     through Resend (as the Portal's notifications), written and sent from the
--     Portal.
--
--   1. newsletter_subscribers   one row per address. Its status is the whole
--                               consent story: pending → confirmed →
--                               unsubscribed / bounced / complained.
--   2. newsletter_campaigns     what the Portal writes and sends.
--   3. newsletter_deliveries    one row per campaign per recipient: the send
--                               queue, and the record of what went to whom.
--   4. the server's side        for netlify/functions/newsletter*.mjs with the
--                               server key only. Tokens are made HERE; only the
--                               confirmation token's SHA-256 is stored.
--   5. the Portal's side        sending or cancelling a campaign, asking the
--                               old (pre-2026-10-18) addresses to confirm,
--                               unsubscribing someone by hand — admins only.
--   6. the old requests         every newsletter lead becomes a PENDING row.
--                               Nothing is mailed to them until an admin asks,
--                               and nobody is a subscriber until they confirm.
--
-- Run after 20261018000100_booking.sql. Re-runnable.
-- =============================================================================

do $$
begin
  if to_regprocedure('public.client_definer_role()') is null then
    raise exception 'The client portal (20261001000100_client_portal.sql) is not applied.';
  end if;
  if current_user in ('anon', 'authenticated') then
    raise exception 'Run this migration from the SQL editor, not as an API role.';
  end if;
end $$;

-- 64 hex characters (two v4 UUIDs, 244 random bits). gen_random_uuid() is in
-- core Postgres, so no extension is needed.
create or replace function newsletter_new_token() returns text
  language sql volatile set search_path = public
as $$
  select replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
$$;

create or replace function newsletter_hash(p_token text) returns text
  language sql immutable set search_path = public
as $$
  select encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
$$;


-- ###########################################################################
-- 1. SUBSCRIBERS
-- ###########################################################################

create table if not exists newsletter_subscribers (
  id                    uuid primary key default gen_random_uuid(),
  email                 text not null unique
                        check (email = lower(btrim(email)) and length(email) <= 254
                               and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  locale                text not null default 'hu' check (locale in ('hu', 'en', 'de')),
  -- pending: asked, not confirmed — NOT a subscriber, gets no newsletter.
  status                text not null default 'pending'
                        check (status in ('pending', 'confirmed', 'unsubscribed', 'bounced', 'complained')),
  -- Where the latest signup came from: the newsletter form, the contact form's
  -- checkbox, the pre-2026-10-18 requests, or the Portal.
  source                text not null default 'newsletter' check (source in ('newsletter', 'contact', 'import', 'portal')),
  source_route          text check (source_route is null or length(source_route) <= 200),
  ip_hash               text check (ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$'),
  -- The latest confirmation request. Only the token's SHA-256 is kept.
  confirm_hash          text unique check (confirm_hash is null or confirm_hash ~ '^[0-9a-f]{64}$'),
  confirm_requested_at  timestamptz,
  confirm_claimed_at    timestamptz,
  confirm_sent_at       timestamptz,
  confirm_attempts      smallint not null default 0,
  confirm_error         text,
  -- Abuse ceiling: confirmation e-mails to one address in a rolling day.
  confirm_window_at     timestamptz,
  confirm_window_count  smallint not null default 0,
  confirmed_at          timestamptz,
  welcome_claimed_at    timestamptz,
  welcome_sent_at       timestamptz,
  welcome_attempts      smallint not null default 0,
  welcome_error         text,
  -- In every e-mail's unsubscribe link. Unsubscribing is all it can do.
  unsubscribe_token     text not null unique default newsletter_new_token()
                        check (unsubscribe_token ~ '^[0-9a-f]{64}$'),
  unsubscribed_at       timestamptz,
  unsubscribe_source    text check (unsubscribe_source is null
                                    or unsubscribe_source in ('link', 'one_click', 'portal', 'bounce', 'complaint')),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists newsletter_subscribers_status_idx on newsletter_subscribers (status, created_at desc);
create index if not exists newsletter_subscribers_confirm_due_idx on newsletter_subscribers (confirm_requested_at)
  where status = 'pending' and confirm_sent_at is null and confirm_requested_at is not null;

drop trigger if exists newsletter_subscribers_updated_at on newsletter_subscribers;
create trigger newsletter_subscribers_updated_at before update on newsletter_subscribers
  for each row execute function set_updated_at();

alter table newsletter_subscribers enable row level security;
alter table newsletter_subscribers force row level security;
drop policy if exists newsletter_subscribers_admin_read on newsletter_subscribers;
create policy newsletter_subscribers_admin_read on newsletter_subscribers for select using (is_admin());
-- Erasure on request: an admin deletes the row (and with it its deliveries).
drop policy if exists newsletter_subscribers_admin_delete on newsletter_subscribers;
create policy newsletter_subscribers_admin_delete on newsletter_subscribers for delete using (is_admin());
drop policy if exists newsletter_subscribers_definer_all on newsletter_subscribers;
do $$ begin
  execute format('create policy newsletter_subscribers_definer_all on newsletter_subscribers for all to %I using (true) with check (true)',
                 client_definer_role());
end $$;


-- ###########################################################################
-- 2. CAMPAIGNS
-- ###########################################################################

create table if not exists newsletter_campaigns (
  id           uuid primary key default gen_random_uuid(),
  subject      text not null check (length(btrim(subject)) between 1 and 200),
  -- The line mail apps show after the subject. Optional.
  preheader    text check (preheader is null or length(preheader) <= 200),
  -- Light markup (netlify/functions/newsletter-lib.mjs, renderBody): blank
  -- lines between paragraphs, "## " headings, "- " lists, **bold**,
  -- [text](https://…) links.
  body         text not null check (length(btrim(body)) between 1 and 50000),
  audience     text not null default 'all' check (audience in ('all', 'hu', 'en', 'de')),
  status       text not null default 'draft' check (status in ('draft', 'sending', 'sent', 'cancelled')),
  recipients   integer not null default 0,
  sent         integer not null default 0,
  failed       integer not null default 0,
  created_by   uuid references profiles(id) on delete set null,
  queued_at    timestamptz,
  queued_by    uuid references profiles(id) on delete set null,
  finished_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists newsletter_campaigns_created_idx on newsletter_campaigns (created_at desc);

create or replace function newsletter_campaigns_rules() returns trigger
  language plpgsql set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
  end if;
  new.subject := btrim(new.subject);
  new.preheader := nullif(btrim(coalesce(new.preheader, '')), '');
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists newsletter_campaigns_rules on newsletter_campaigns;
create trigger newsletter_campaigns_rules before insert or update on newsletter_campaigns
  for each row execute function newsletter_campaigns_rules();

alter table newsletter_campaigns enable row level security;
alter table newsletter_campaigns force row level security;
drop policy if exists newsletter_campaigns_admin_read on newsletter_campaigns;
create policy newsletter_campaigns_admin_read on newsletter_campaigns for select using (is_admin());
-- Only drafts are written by hand; sending goes through newsletter_campaign_send.
drop policy if exists newsletter_campaigns_admin_insert on newsletter_campaigns;
create policy newsletter_campaigns_admin_insert on newsletter_campaigns for insert
  with check (is_admin() and status = 'draft' and recipients = 0 and sent = 0 and failed = 0 and queued_at is null);
drop policy if exists newsletter_campaigns_admin_update on newsletter_campaigns;
create policy newsletter_campaigns_admin_update on newsletter_campaigns for update
  using (is_admin() and status = 'draft') with check (is_admin() and status = 'draft');
drop policy if exists newsletter_campaigns_admin_delete on newsletter_campaigns;
create policy newsletter_campaigns_admin_delete on newsletter_campaigns for delete using (is_admin() and status = 'draft');
drop policy if exists newsletter_campaigns_definer_all on newsletter_campaigns;
do $$ begin
  execute format('create policy newsletter_campaigns_definer_all on newsletter_campaigns for all to %I using (true) with check (true)',
                 client_definer_role());
end $$;


-- ###########################################################################
-- 3. DELIVERIES
-- ###########################################################################

create table if not exists newsletter_deliveries (
  id             uuid primary key default gen_random_uuid(),
  campaign_id    uuid not null references newsletter_campaigns(id) on delete cascade,
  subscriber_id  uuid not null references newsletter_subscribers(id) on delete cascade,
  -- skipped: the subscriber left (or bounced) before their turn came.
  status         text not null default 'queued' check (status in ('queued', 'sent', 'failed', 'skipped')),
  attempts       smallint not null default 0,
  claimed_at     timestamptz,
  sent_at        timestamptz,
  last_error     text,
  created_at     timestamptz not null default now(),
  unique (campaign_id, subscriber_id)
);
create index if not exists newsletter_deliveries_queued_idx on newsletter_deliveries (created_at) where status = 'queued';
create index if not exists newsletter_deliveries_subscriber_idx on newsletter_deliveries (subscriber_id);

alter table newsletter_deliveries enable row level security;
alter table newsletter_deliveries force row level security;
drop policy if exists newsletter_deliveries_admin_read on newsletter_deliveries;
create policy newsletter_deliveries_admin_read on newsletter_deliveries for select using (is_admin());
drop policy if exists newsletter_deliveries_definer_all on newsletter_deliveries;
do $$ begin
  execute format('create policy newsletter_deliveries_definer_all on newsletter_deliveries for all to %I using (true) with check (true)',
                 client_definer_role());
end $$;


-- ###########################################################################
-- 4. THE SERVER'S SIDE (the newsletter functions' key only)
-- ###########################################################################

-- A signup, from the newsletter form or the contact form's checkbox.
--   send       a confirmation is due: the caller e-mails `token` now
--   confirmed  already a subscriber: nothing to send
--   throttled  a confirmation went out minutes ago, or three today: nothing
-- The visitor is told the same thing in every case.
create or replace function newsletter_subscribe(
  p_email text, p_locale text, p_source text, p_route text default null, p_ip_hash text default null)
returns table (subscriber_id uuid, outcome text, email text, locale text, token text)
  language plpgsql volatile security invoker set search_path = public
as $$
#variable_conflict use_column
declare
  e text := lower(btrim(coalesce(p_email, '')));
  l text := case when p_locale in ('hu', 'en', 'de') then p_locale else 'hu' end;
  src text := case when p_source in ('newsletter', 'contact', 'portal') then p_source else 'newsletter' end;
  s newsletter_subscribers;
  t text;
begin
  if length(e) > 254 or e !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'stratos:newsletter_email' using errcode = 'P0001';
  end if;

  insert into newsletter_subscribers (email, locale, source, source_route, ip_hash)
  values (e, l, src, left(p_route, 200), case when p_ip_hash ~ '^[0-9a-f]{64}$' then p_ip_hash end)
  on conflict on constraint newsletter_subscribers_email_key do nothing;

  select * into s from newsletter_subscribers n where n.email = e for update;

  if s.status = 'confirmed' then
    return query select s.id, 'confirmed'::text, s.email, s.locale, null::text;
    return;
  end if;

  if (s.confirm_claimed_at is not null and s.confirm_claimed_at > now() - interval '2 minutes')
     or (s.confirm_window_at > now() - interval '1 day' and s.confirm_window_count >= 3) then
    return query select s.id, 'throttled'::text, s.email, s.locale, null::text;
    return;
  end if;

  t := newsletter_new_token();
  update newsletter_subscribers n set
    status = 'pending',
    locale = l,
    source = src,
    source_route = left(p_route, 200),
    ip_hash = case when p_ip_hash ~ '^[0-9a-f]{64}$' then p_ip_hash else n.ip_hash end,
    confirm_hash = newsletter_hash(t),
    confirm_requested_at = now(),
    confirm_claimed_at = now(),
    confirm_sent_at = null,
    confirm_attempts = 1,
    confirm_error = null,
    confirm_window_at = case when n.confirm_window_at is null or n.confirm_window_at <= now() - interval '1 day'
                             then now() else n.confirm_window_at end,
    confirm_window_count = case when n.confirm_window_at is null or n.confirm_window_at <= now() - interval '1 day'
                                then 1 else n.confirm_window_count + 1 end
  where n.id = s.id
  returning * into s;

  return query select s.id, 'send'::text, s.email, s.locale, t;
end;
$$;

-- Confirmations whose first try failed, and the old requests an admin asked to
-- confirm: claimed (one sender per row; a claim older than 5 minutes is
-- retried), each with a FRESH token — an earlier link stops working.
create or replace function newsletter_confirmations_due(p_limit integer default 50)
returns table (subscriber_id uuid, email text, locale text, token text)
  language plpgsql volatile security invoker set search_path = public
as $$
#variable_conflict use_column
declare r record; t text;
begin
  for r in
    select n.id from newsletter_subscribers n
    where n.status = 'pending' and n.confirm_requested_at is not null and n.confirm_sent_at is null
      and n.confirm_attempts < 5
      and (n.confirm_claimed_at is null or n.confirm_claimed_at < now() - interval '5 minutes')
    order by n.confirm_requested_at
    limit greatest(1, least(coalesce(p_limit, 50), 200))
    for update skip locked
  loop
    t := newsletter_new_token();
    return query
      update newsletter_subscribers n set
        confirm_hash = newsletter_hash(t), confirm_claimed_at = now(), confirm_attempts = n.confirm_attempts + 1
      where n.id = r.id
      returning n.id, n.email, n.locale, t;
  end loop;
end;
$$;

create or replace function newsletter_confirmation_done(p_id uuid, p_error text default null) returns void
  language sql volatile security invoker set search_path = public
as $$
  update newsletter_subscribers set
    confirm_sent_at = case when p_error is null then now() else null end,
    confirm_error = left(p_error, 500),
    confirm_claimed_at = case when p_error is null then confirm_claimed_at else null end
  where id = p_id
$$;

-- The click on the confirmation link (and the button on the page it opens).
--   confirmed  just now: the caller sends the welcome e-mail (already claimed)
--   already    was confirmed before
--   expired    the link is older than 30 days
--   unknown    no such link (or a newer one replaced it, or they left)
create or replace function newsletter_confirm(p_token text)
returns table (subscriber_id uuid, outcome text, email text, locale text, unsubscribe_token text)
  language plpgsql volatile security invoker set search_path = public
as $$
#variable_conflict use_column
declare s newsletter_subscribers;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return query select null::uuid, 'unknown'::text, null::text, null::text, null::text;
    return;
  end if;
  select * into s from newsletter_subscribers n where n.confirm_hash = newsletter_hash(p_token) for update;
  if s.id is null or s.status not in ('pending', 'confirmed') then
    return query select null::uuid, 'unknown'::text, null::text, s.locale, null::text;
    return;
  end if;
  if s.status = 'confirmed' then
    return query select s.id, 'already'::text, s.email, s.locale, null::text;
    return;
  end if;
  if s.confirm_requested_at < now() - interval '30 days' then
    return query select s.id, 'expired'::text, s.email, s.locale, null::text;
    return;
  end if;
  update newsletter_subscribers n set
    status = 'confirmed', confirmed_at = now(), unsubscribed_at = null, unsubscribe_source = null,
    welcome_claimed_at = case when n.welcome_sent_at is null then now() else n.welcome_claimed_at end,
    welcome_attempts = case when n.welcome_sent_at is null then n.welcome_attempts + 1 else n.welcome_attempts end
  where n.id = s.id
  returning * into s;
  return query select s.id, case when s.welcome_sent_at is null then 'confirmed' else 'already' end,
                      s.email, s.locale, s.unsubscribe_token;
end;
$$;

-- Welcome e-mails whose first try failed: claimed like the confirmations.
-- Not after a week — a welcome that late is noise.
create or replace function newsletter_welcomes_due(p_limit integer default 50)
returns table (subscriber_id uuid, email text, locale text, unsubscribe_token text)
  language sql volatile security invoker set search_path = public
as $$
  with picked as (
    select n.id from newsletter_subscribers n
    where n.status = 'confirmed' and n.welcome_sent_at is null and n.welcome_attempts < 5
      and n.confirmed_at > now() - interval '7 days'
      and (n.welcome_claimed_at is null or n.welcome_claimed_at < now() - interval '5 minutes')
    order by n.confirmed_at
    limit greatest(1, least(coalesce(p_limit, 50), 200))
    for update skip locked
  )
  update newsletter_subscribers n set welcome_claimed_at = now(), welcome_attempts = n.welcome_attempts + 1
  from picked where n.id = picked.id
  returning n.id, n.email, n.locale, n.unsubscribe_token
$$;

create or replace function newsletter_welcome_done(p_id uuid, p_error text default null) returns void
  language sql volatile security invoker set search_path = public
as $$
  update newsletter_subscribers set
    welcome_sent_at = case when p_error is null then now() else null end,
    welcome_error = left(p_error, 500),
    welcome_claimed_at = case when p_error is null then welcome_claimed_at else null end
  where id = p_id
$$;

-- The unsubscribe link (p_how 'link') or the mail app's one-click button
-- (RFC 8058, 'one_click'). Whatever is still queued for them is skipped.
--   done | already | unknown
create or replace function newsletter_unsubscribe(p_token text, p_how text default 'link')
returns table (outcome text, locale text)
  language plpgsql volatile security invoker set search_path = public
as $$
#variable_conflict use_column
declare s newsletter_subscribers;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return query select 'unknown'::text, null::text;
    return;
  end if;
  select * into s from newsletter_subscribers n where n.unsubscribe_token = p_token for update;
  if s.id is null then
    return query select 'unknown'::text, null::text;
    return;
  end if;
  if s.status not in ('pending', 'confirmed') then
    return query select 'already'::text, s.locale;
    return;
  end if;
  update newsletter_subscribers n set
    status = 'unsubscribed', unsubscribed_at = now(),
    unsubscribe_source = case when p_how = 'one_click' then 'one_click' else 'link' end,
    confirm_hash = null, confirm_requested_at = null, confirm_claimed_at = null
  where n.id = s.id;
  update newsletter_deliveries d set status = 'skipped', claimed_at = null
  where d.subscriber_id = s.id and d.status = 'queued';
  return query select 'done'::text, s.locale;
end;
$$;

-- "I clicked by mistake": the same token, straight back — only for someone who
-- had confirmed and left by their own link (not after a bounce or a complaint).
--   done | no
create or replace function newsletter_resubscribe(p_token text)
returns table (outcome text, locale text)
  language plpgsql volatile security invoker set search_path = public
as $$
#variable_conflict use_column
declare s newsletter_subscribers;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return query select 'no'::text, null::text;
    return;
  end if;
  select * into s from newsletter_subscribers n where n.unsubscribe_token = p_token for update;
  if s.id is null then
    return query select 'no'::text, null::text;
    return;
  end if;
  if s.status = 'confirmed' then
    return query select 'done'::text, s.locale;
    return;
  end if;
  if s.status <> 'unsubscribed' or s.confirmed_at is null or s.unsubscribe_source not in ('link', 'one_click') then
    return query select 'no'::text, s.locale;
    return;
  end if;
  update newsletter_subscribers n set status = 'confirmed', unsubscribed_at = null, unsubscribe_source = null
  where n.id = s.id;
  return query select 'done'::text, s.locale;
end;
$$;

-- A hard bounce or a spam complaint reported by Resend's webhook. Returns
-- whether the address was on the list.
create or replace function newsletter_suppress(p_email text, p_reason text) returns boolean
  language plpgsql volatile security invoker set search_path = public
as $$
declare s newsletter_subscribers;
begin
  select * into s from newsletter_subscribers n where n.email = lower(btrim(coalesce(p_email, ''))) for update;
  if s.id is null then return false; end if;
  if p_reason = 'complained' or s.status in ('pending', 'confirmed') then
    update newsletter_subscribers n set
      status = case when p_reason = 'complained' then 'complained' else 'bounced' end,
      unsubscribed_at = coalesce(n.unsubscribed_at, now()),
      unsubscribe_source = case when p_reason = 'complained' then 'complaint' else 'bounce' end,
      confirm_hash = null, confirm_requested_at = null, confirm_claimed_at = null
    where n.id = s.id;
  end if;
  update newsletter_deliveries d set status = 'skipped', claimed_at = null
  where d.subscriber_id = s.id and d.status = 'queued';
  return true;
end;
$$;

-- The next batch of a campaign that is being sent. Anyone who is no longer
-- confirmed is skipped first; a delivery is tried at most three times.
create or replace function newsletter_claim_deliveries(p_limit integer default 100)
returns table (delivery_id uuid, campaign_id uuid, subject text, preheader text, body text,
               email text, locale text, unsubscribe_token text)
  language sql volatile security invoker set search_path = public
as $$
  with gone as (
    update newsletter_deliveries d set status = 'skipped', claimed_at = null
    from newsletter_subscribers n
    where n.id = d.subscriber_id and d.status = 'queued' and n.status <> 'confirmed'
    returning d.id
  ), picked as (
    select d.id from newsletter_deliveries d
    join newsletter_campaigns c on c.id = d.campaign_id and c.status = 'sending'
    join newsletter_subscribers n on n.id = d.subscriber_id and n.status = 'confirmed'
    where d.status = 'queued' and d.attempts < 3
      and (d.claimed_at is null or d.claimed_at < now() - interval '5 minutes')
      and d.id not in (select id from gone)
    order by d.created_at, d.id
    limit greatest(1, least(coalesce(p_limit, 100), 500))
    for update of d skip locked
  ), claimed as (
    update newsletter_deliveries d set claimed_at = now(), attempts = d.attempts + 1
    from picked where d.id = picked.id
    returning d.*
  )
  select cl.id, c.id, c.subject, c.preheader, c.body, n.email, n.locale, n.unsubscribe_token
  from claimed cl
  join newsletter_campaigns c on c.id = cl.campaign_id
  join newsletter_subscribers n on n.id = cl.subscriber_id
  order by cl.created_at, cl.id
$$;

-- What happened to a claimed batch.
--   sent        delivered to Resend
--   failed      refused: tried again later, failed for good after 3 tries
--   released    not tried (Resend's rate limit or daily quota): back in the
--               queue without spending an attempt
create or replace function newsletter_deliveries_done(p_ids uuid[], p_result text, p_error text default null)
returns void
  language sql volatile security invoker set search_path = public
as $$
  update newsletter_deliveries d set
    status = case
      when p_result = 'sent' then 'sent'
      when p_result = 'failed' and d.attempts >= 3 then 'failed'
      else 'queued' end,
    sent_at = case when p_result = 'sent' then now() else d.sent_at end,
    attempts = case when p_result = 'released' then greatest(d.attempts - 1, 0) else d.attempts end,
    claimed_at = case when p_result = 'sent' then d.claimed_at else null end,
    last_error = case when p_result = 'sent' then null else left(p_error, 500) end
  where d.id = any (p_ids) and d.status = 'queued'
$$;

-- Counts every campaign that is being sent, and closes those with nothing
-- left in the queue. Returns how many it closed.
create or replace function newsletter_campaigns_settle() returns integer
  language plpgsql volatile security invoker set search_path = public
as $$
declare closed integer;
begin
  update newsletter_campaigns c set
    sent = x.sent, failed = x.failed
  from (
    select d.campaign_id,
           count(*) filter (where d.status = 'sent')::int as sent,
           count(*) filter (where d.status in ('failed', 'skipped'))::int as failed
    from newsletter_deliveries d
    join newsletter_campaigns c2 on c2.id = d.campaign_id and c2.status = 'sending'
    group by d.campaign_id
  ) x
  where c.id = x.campaign_id;

  with done as (
    update newsletter_campaigns c set status = 'sent', finished_at = now()
    where c.status = 'sending'
      and not exists (select 1 from newsletter_deliveries d where d.campaign_id = c.id and d.status = 'queued')
    returning c.id
  )
  select count(*)::int into closed from done;
  return closed;
end;
$$;

-- Data minimisation: a request that was never confirmed is deleted 30 days
-- after its last confirmation e-mail (or its last failed try). Old requests no
-- admin has asked about yet are kept.
create or replace function newsletter_purge() returns integer
  language sql volatile security invoker set search_path = public
as $$
  with gone as (
    delete from newsletter_subscribers n
    where n.status = 'pending'
      and ((n.confirm_sent_at is not null and n.confirm_sent_at < now() - interval '30 days')
        or (n.confirm_sent_at is null and n.confirm_attempts >= 5 and n.confirm_requested_at < now() - interval '30 days'))
    returning 1
  )
  select count(*)::int from gone
$$;


-- ###########################################################################
-- 5. THE PORTAL'S SIDE (admins)
-- ###########################################################################

-- Queue a draft for every confirmed subscriber in its audience. Returns how
-- many. The dispatcher (netlify/functions/newsletter-dispatch.mjs) sends it.
create or replace function newsletter_campaign_send(p_id uuid) returns integer
  language plpgsql volatile security definer set search_path = public
as $$
declare c newsletter_campaigns; n integer;
begin
  if not is_admin() then raise exception 'stratos:newsletter_forbidden' using errcode = '42501'; end if;
  select * into c from newsletter_campaigns where id = p_id for update;
  if c.id is null or c.status <> 'draft' then
    raise exception 'stratos:newsletter_not_draft' using errcode = 'P0001';
  end if;
  insert into newsletter_deliveries (campaign_id, subscriber_id)
  select c.id, s.id from newsletter_subscribers s
  where s.status = 'confirmed' and (c.audience = 'all' or s.locale = c.audience)
  on conflict (campaign_id, subscriber_id) do nothing;
  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'stratos:newsletter_no_recipients' using errcode = 'P0001';
  end if;
  update newsletter_campaigns set
    status = 'sending', recipients = n, sent = 0, failed = 0, queued_at = now(), queued_by = auth.uid()
  where id = c.id;
  return n;
end;
$$;

-- Stop a campaign that is still going out: what has not gone is skipped.
create or replace function newsletter_campaign_cancel(p_id uuid) returns integer
  language plpgsql volatile security definer set search_path = public
as $$
declare n integer;
begin
  if not is_admin() then raise exception 'stratos:newsletter_forbidden' using errcode = '42501'; end if;
  update newsletter_deliveries set status = 'skipped', claimed_at = null
  where campaign_id = p_id and status = 'queued';
  get diagnostics n = row_count;
  update newsletter_campaigns c set
    status = 'cancelled', finished_at = now(),
    sent = (select count(*) from newsletter_deliveries d where d.campaign_id = c.id and d.status = 'sent'),
    failed = (select count(*) from newsletter_deliveries d where d.campaign_id = c.id and d.status in ('failed', 'skipped'))
  where c.id = p_id and c.status = 'sending';
  return n;
end;
$$;

-- Ask the pre-2026-10-18 requests (source 'import') to confirm: each gets ONE
-- confirmation e-mail from the dispatcher; whoever does not confirm within 30
-- days is deleted (newsletter_purge). Returns how many were asked.
create or replace function newsletter_request_confirmations() returns integer
  language plpgsql volatile security definer set search_path = public
as $$
declare n integer;
begin
  if not is_admin() then raise exception 'stratos:newsletter_forbidden' using errcode = '42501'; end if;
  update newsletter_subscribers set
    confirm_requested_at = now(), confirm_sent_at = null, confirm_claimed_at = null,
    confirm_attempts = 0, confirm_error = null
  where status = 'pending' and source = 'import' and confirm_requested_at is null;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- An admin unsubscribes someone who asked by phone or by reply.
create or replace function newsletter_admin_unsubscribe(p_id uuid) returns void
  language plpgsql volatile security definer set search_path = public
as $$
begin
  if not is_admin() then raise exception 'stratos:newsletter_forbidden' using errcode = '42501'; end if;
  update newsletter_subscribers set
    status = 'unsubscribed', unsubscribed_at = now(), unsubscribe_source = 'portal',
    confirm_hash = null, confirm_requested_at = null, confirm_claimed_at = null
  where id = p_id and status in ('pending', 'confirmed');
  update newsletter_deliveries set status = 'skipped', claimed_at = null
  where subscriber_id = p_id and status = 'queued';
end;
$$;


-- ###########################################################################
-- 6. THE OLD REQUESTS
-- ###########################################################################

-- Until today the newsletter form stored a lead and promised nothing would be
-- sent. Those addresses never confirmed anything, so they come in as PENDING
-- and get no newsletter. An admin may ask them once to confirm (5. above).
insert into newsletter_subscribers (email, locale, source, created_at)
select distinct on (lower(btrim(l.email)))
       lower(btrim(l.email)),
       case when l.locale in ('hu', 'en', 'de') then l.locale else 'hu' end,
       'import', l.created_at
from leads l
where l.form_type = 'newsletter' and l.trashed_at is null
  and length(lower(btrim(l.email))) <= 254
  and lower(btrim(l.email)) ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  -- Only into an empty list (the first run): a re-run must not bring back an
  -- address an admin has since erased.
  and not exists (select 1 from newsletter_subscribers)
order by lower(btrim(l.email)), l.created_at
on conflict on constraint newsletter_subscribers_email_key do nothing;


-- ###########################################################################
-- ACCESS
-- ###########################################################################

do $$
declare f text;
begin
  execute 'revoke all on table newsletter_subscribers, newsletter_campaigns, newsletter_deliveries from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table newsletter_subscribers, newsletter_campaigns, newsletter_deliveries from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table newsletter_subscribers, newsletter_campaigns, newsletter_deliveries from authenticated';
    -- Never the tokens, the token hash or the IP hash.
    execute 'grant select (id, email, locale, status, source, source_route, confirm_requested_at, confirm_sent_at,
                           confirm_error, confirmed_at, welcome_sent_at, unsubscribed_at, unsubscribe_source,
                           created_at, updated_at) on newsletter_subscribers to authenticated';
    execute 'grant delete on newsletter_subscribers to authenticated';
    execute 'grant select, delete on newsletter_campaigns to authenticated';
    execute 'grant insert (subject, preheader, body, audience), update (subject, preheader, body, audience)
               on newsletter_campaigns to authenticated';
    execute 'grant select on newsletter_deliveries to authenticated';
  end if;

  -- The server's functions: the newsletter functions' key only.
  foreach f in array array[
    'newsletter_new_token()',
    'newsletter_subscribe(text, text, text, text, text)',
    'newsletter_confirmations_due(integer)',
    'newsletter_confirmation_done(uuid, text)',
    'newsletter_confirm(text)',
    'newsletter_welcomes_due(integer)',
    'newsletter_welcome_done(uuid, text)',
    'newsletter_unsubscribe(text, text)',
    'newsletter_resubscribe(text)',
    'newsletter_suppress(text, text)',
    'newsletter_claim_deliveries(integer)',
    'newsletter_deliveries_done(uuid[], text, text)',
    'newsletter_campaigns_settle()',
    'newsletter_purge()'
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

  -- The Portal's: each checks is_admin() itself.
  foreach f in array array[
    'newsletter_campaign_send(uuid)',
    'newsletter_campaign_cancel(uuid)',
    'newsletter_request_confirmations()',
    'newsletter_admin_unsubscribe(uuid)'
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

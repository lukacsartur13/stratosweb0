-- =============================================================================
-- Stratos — automatic e-mails ("Automatikus levelek", 2026-10-19)
--
-- Owner decisions of 2026-10-19, four of them:
--
--   1. a confirmation to whoever sends the contact form, the quote
--      questionnaire or the Impact application ("we have it, here is what
--      happens next") — fixed words only: nothing the sender typed is echoed,
--      so the form cannot be used to mail someone else's address with
--      someone else's text; one per address per day;
--   2. a reminder about a day before a booked call, with the Meet link — not
--      when the time was set less than 25 hours before (the invitation has
--      only just arrived);
--   3. a welcome series: a few e-mails after the welcome, days apart, written
--      in the Portal per language. The three seeded below are a DRAFT and are
--      switched off until an admin has read them;
--   4. new articles and case studies announced to the subscribers, from the
--      list the site's build publishes (assets/data/newsletter-feed.json).
--      What is on the list the first time is only remembered, never sent.
--
--   A. newsletter_settings     one row: what to do with a new article
--                              (send / draft / off)
--   B. newsletter_campaigns    + kind ('manual' | 'announce') and source_key
--   C. newsletter_announced    every article and case study already seen
--   D. newsletter_series       the welcome series' e-mails
--      newsletter_subscribers  + where each subscriber is in the series
--   E. bookings                + reminder columns
--   F. the server's side       for the functions, with the server key only
--
-- Run after 20261019000100_newsletter.sql. Re-runnable.
-- =============================================================================

do $$
begin
  if to_regclass('public.newsletter_subscribers') is null then
    raise exception 'The newsletter (20261019000100_newsletter.sql) is not applied.';
  end if;
  if to_regclass('public.bookings') is null then
    raise exception 'Booking (20261018000100_booking.sql) is not applied.';
  end if;
  if current_user in ('anon', 'authenticated') then
    raise exception 'Run this migration from the SQL editor, not as an API role.';
  end if;
end $$;


-- ###########################################################################
-- A. SETTINGS
-- ###########################################################################

create table if not exists newsletter_settings (
  singleton      boolean primary key default true check (singleton),
  -- A new article or case study on the site:
  --   send   announced to the subscribers of each language at once
  --   draft  a draft campaign per language, waiting in the Portal
  --   off    nothing
  auto_announce  text not null default 'send' check (auto_announce in ('send', 'draft', 'off')),
  updated_at     timestamptz not null default now(),
  updated_by     uuid references profiles(id) on delete set null
);
insert into newsletter_settings (singleton) values (true) on conflict do nothing;

create or replace function newsletter_settings_rules() returns trigger
  language plpgsql set search_path = public
as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$$;
drop trigger if exists newsletter_settings_rules on newsletter_settings;
create trigger newsletter_settings_rules before update on newsletter_settings
  for each row execute function newsletter_settings_rules();

alter table newsletter_settings enable row level security;
alter table newsletter_settings force row level security;
drop policy if exists newsletter_settings_admin_read on newsletter_settings;
create policy newsletter_settings_admin_read on newsletter_settings for select using (is_admin());
drop policy if exists newsletter_settings_admin_update on newsletter_settings;
create policy newsletter_settings_admin_update on newsletter_settings for update using (is_admin()) with check (is_admin());
drop policy if exists newsletter_settings_definer_all on newsletter_settings;
do $$ begin
  execute format('create policy newsletter_settings_definer_all on newsletter_settings for all to %I using (true) with check (true)',
                 client_definer_role());
end $$;


-- ###########################################################################
-- B. CAMPAIGNS: WHERE THEY CAME FROM
-- ###########################################################################

alter table newsletter_campaigns add column if not exists kind text not null default 'manual';
alter table newsletter_campaigns add column if not exists source_key text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'newsletter_campaigns_kind_check') then
    alter table newsletter_campaigns add constraint newsletter_campaigns_kind_check
      check (kind in ('manual', 'announce') and (kind = 'manual') = (source_key is null));
  end if;
end $$;


-- ###########################################################################
-- C. WHAT HAS BEEN ANNOUNCED
-- ###########################################################################

create table if not exists newsletter_announced (
  key            text primary key check (key ~ '^[a-z0-9-]{1,80}$'),
  type           text not null check (type in ('post', 'case')),
  first_seen_at  timestamptz not null default now(),
  -- On the list the first time the list was read: remembered, never sent.
  baseline       boolean not null default false,
  campaigns      integer not null default 0
);
alter table newsletter_announced enable row level security;
alter table newsletter_announced force row level security;
drop policy if exists newsletter_announced_admin_read on newsletter_announced;
create policy newsletter_announced_admin_read on newsletter_announced for select using (is_admin());


-- ###########################################################################
-- D. THE WELCOME SERIES
-- ###########################################################################

create table if not exists newsletter_series (
  id          uuid primary key default gen_random_uuid(),
  locale      text not null check (locale in ('hu', 'en', 'de')),
  position    smallint not null check (position between 1 and 10),
  -- Days after the confirmation.
  delay_days  smallint not null check (delay_days between 1 and 365),
  subject     text not null check (length(btrim(subject)) between 1 and 200),
  preheader   text check (preheader is null or length(preheader) <= 200),
  body        text not null check (length(btrim(body)) between 1 and 50000),
  enabled     boolean not null default false,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references profiles(id) on delete set null,
  unique (locale, position)
);

create or replace function newsletter_series_rules() returns trigger
  language plpgsql set search_path = public
as $$
begin
  new.subject := btrim(new.subject);
  new.preheader := nullif(btrim(coalesce(new.preheader, '')), '');
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$$;
drop trigger if exists newsletter_series_rules on newsletter_series;
create trigger newsletter_series_rules before insert or update on newsletter_series
  for each row execute function newsletter_series_rules();

alter table newsletter_series enable row level security;
alter table newsletter_series force row level security;
drop policy if exists newsletter_series_admin_all on newsletter_series;
create policy newsletter_series_admin_all on newsletter_series for all using (is_admin()) with check (is_admin());
drop policy if exists newsletter_series_definer_all on newsletter_series;
do $$ begin
  execute format('create policy newsletter_series_definer_all on newsletter_series for all to %I using (true) with check (true)',
                 client_definer_role());
end $$;

-- Where each subscriber is: the position of the last series e-mail sent (or
-- skipped). Whoever was ALREADY confirmed when the series was added is not
-- new, and gets none of it.
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'newsletter_subscribers' and column_name = 'series_position') then
    alter table newsletter_subscribers add column series_position smallint not null default 0;
    update newsletter_subscribers set series_position = 100 where status = 'confirmed';
  end if;
end $$;
alter table newsletter_subscribers add column if not exists series_claimed_at timestamptz;
alter table newsletter_subscribers add column if not exists series_attempts smallint not null default 0;
alter table newsletter_subscribers add column if not exists series_error text;

-- The draft series: three e-mails per language, switched OFF until an admin
-- has read them. Only what the site itself says — no figure, no promise it
-- does not make. Inserted once; an edited or deleted step is never re-seeded.
insert into newsletter_series (locale, position, delay_days, subject, preheader, body)
select v.locale, v.position, v.delay_days, v.subject, v.preheader, v.body
from (values
  ('hu', 1, 3, 'Min dolgoztunk mostanában?', 'A legjobban a munkáinkból látszik, hogyan dolgozunk.',
   E'Szia!\n\nA legjobban a munkáinkból látszik, hogyan dolgozunk. A Rapidkertnek például interaktív 3D weboldal, keresőoptimalizálás és Google Ads készült — a teljes történetet itt olvashatod: [a Rapidkert esettanulmánya](https://stratosweb.hu/munka-rapidkert.html).\n\nA többi munkánk egy helyen: [Munkáink](https://stratosweb.hu/munkaink.html)\n\nHa kérdésed van, egyszerűen válaszolj erre a levélre.'),
  ('hu', 2, 7, 'Mennyibe kerülne nálad egy weboldal?', 'A leggyakoribb kérdés, és a válasz rajtad múlik.',
   E'Szia!\n\nA leggyakoribb kérdés, amit kapunk: mennyibe kerül egy weboldal? Erre nincs egy szám — azt, hogy mitől függ, ebben a cikkben írtuk le: [Mennyibe kerül egy weboldal?](https://stratosweb.hu/blog-weboldal-arak.html)\n\nHa kíváncsi vagy, nálad mennyi lenne, töltsd ki az igényfelmérőt (nagyjából 8 perc), és személyre szabott árajánlatot küldünk: [Igényfelmérő](https://stratosweb.hu/arajanlat.html)'),
  ('hu', 3, 14, 'Beszéljünk fél órát?', 'Ingyenes, 30 perces konzultáció Google Meeten.',
   E'Szia!\n\nHa van egy ötleted vagy egy weboldalad, ami nem hozza, amit várnál, beszéljük át. A konzultáció díjmentes, 30 perc, Google Meeten.\n\n[Időpontot foglalok](https://stratosweb.hu/idopontfoglalas.html)\n\nHa inkább írnál, válaszolj erre a levélre.'),
  ('en', 1, 3, 'What have we been working on?', 'Our work shows best how we work.',
   E'Hello,\n\nOur work shows best how we work. For Rapidkert, for example, we built an interactive 3D website, search optimisation and Google Ads — the full story is here: [the Rapidkert case study](https://stratosweb.hu/en/work-rapidkert.html).\n\nAll our work in one place: [Work](https://stratosweb.hu/en/work.html)\n\nAny questions? Simply reply to this e-mail.'),
  ('en', 2, 7, 'What would a website cost you?', 'The most common question — and the answer depends on you.',
   E'Hello,\n\nThe question we hear most: what does a website cost? There is no single number — what it depends on is in this article: [What does a website cost?](https://stratosweb.hu/en/blog-website-cost.html)\n\nIf you would like to know what it would be for you, fill in the questionnaire (about 8 minutes) and we will send you a tailored quote: [Questionnaire](https://stratosweb.hu/en/quote.html)'),
  ('en', 3, 14, 'Shall we talk for half an hour?', 'A free 30-minute consultation on Google Meet.',
   E'Hello,\n\nIf you have an idea, or a website that does not bring what you expect, let us talk it through. The consultation is free, 30 minutes, on Google Meet.\n\n[Book a call](https://stratosweb.hu/en/book-a-call.html)\n\nIf you would rather write, reply to this e-mail.'),
  ('de', 1, 3, 'Woran haben wir zuletzt gearbeitet?', 'Wie wir arbeiten, zeigen unsere Projekte am besten.',
   E'Guten Tag,\n\nwie wir arbeiten, zeigen unsere Projekte am besten. Für Rapidkert entstanden zum Beispiel eine interaktive 3D-Website, Suchmaschinenoptimierung und Google Ads — die ganze Geschichte lesen Sie hier: [die Fallstudie Rapidkert](https://stratosweb.hu/de/projekt-rapidkert.html).\n\nAlle Projekte an einem Ort: [Projekte](https://stratosweb.hu/de/projekte.html)\n\nFragen? Antworten Sie einfach auf diese E-Mail.'),
  ('de', 2, 7, 'Was würde Ihre Website kosten?', 'Die häufigste Frage — und die Antwort hängt von Ihnen ab.',
   E'Guten Tag,\n\ndie Frage, die wir am häufigsten hören: Was kostet eine Website? Eine einzige Zahl gibt es nicht — wovon es abhängt, steht in diesem Artikel: [Was kostet eine Website?](https://stratosweb.hu/de/blog-website-kosten.html)\n\nWenn Sie wissen möchten, was es bei Ihnen wäre, füllen Sie den Fragebogen aus (etwa 8 Minuten), und wir senden Ihnen ein individuelles Angebot: [Fragebogen](https://stratosweb.hu/de/angebot.html)'),
  ('de', 3, 14, 'Sprechen wir eine halbe Stunde?', 'Ein kostenloses 30-minütiges Gespräch auf Google Meet.',
   E'Guten Tag,\n\nwenn Sie eine Idee haben oder eine Website, die nicht bringt, was Sie erwarten, sprechen wir darüber. Das Gespräch ist kostenlos, dauert 30 Minuten und findet auf Google Meet statt.\n\n[Termin buchen](https://stratosweb.hu/de/termin-buchen.html)\n\nWenn Sie lieber schreiben, antworten Sie auf diese E-Mail.')
) as v(locale, position, delay_days, subject, preheader, body)
where not exists (select 1 from newsletter_series);


-- ###########################################################################
-- E. BOOKINGS: THE REMINDER
-- ###########################################################################

alter table bookings add column if not exists scheduled_at timestamptz not null default now();
alter table bookings add column if not exists reminder_claimed_at timestamptz;
alter table bookings add column if not exists reminder_sent_at timestamptz;
alter table bookings add column if not exists reminder_attempts smallint not null default 0;
alter table bookings add column if not exists reminder_error text;

-- A moved booking is a new time: its reminder starts over, and "when was the
-- time set" is now.
create or replace function bookings_reminder_reset() returns trigger
  language plpgsql set search_path = public
as $$
begin
  if new.starts_at is distinct from old.starts_at then
    new.scheduled_at := now();
    new.reminder_claimed_at := null;
    new.reminder_sent_at := null;
    new.reminder_attempts := 0;
    new.reminder_error := null;
  end if;
  return new;
end;
$$;
drop trigger if exists bookings_reminder_reset on bookings;
create trigger bookings_reminder_reset before update on bookings
  for each row execute function bookings_reminder_reset();


-- ###########################################################################
-- F. THE SERVER'S SIDE
-- ###########################################################################

-- 1. May this address get a "we have it" e-mail? Only for its first form in
--    24 hours (the lead just stored is the one counted). The newsletter form
--    does not count: it has its own e-mails.
create or replace function lead_confirmation_allowed(p_email text) returns boolean
  language sql stable security invoker set search_path = public
as $$
  select count(*) <= 1 from leads
  where lower(btrim(email)) = lower(btrim(coalesce(p_email, '')))
    and form_type in ('contact', 'questionnaire', 'impact')
    and created_at > now() - interval '24 hours'
$$;

-- 2. Calls starting within the next 24 hours (and more than an hour away)
--    whose time was set more than 25 hours before they start. Claimed like
--    every other queue here; three tries at most.
create or replace function booking_reminders_due(p_limit integer default 50)
returns table (booking_id uuid, kind text, email text, locale text, starts_at timestamptz,
               ends_at timestamptz, time_zone text, meet_url text)
  language sql volatile security invoker set search_path = public
as $$
  with picked as (
    select b.id from bookings b
    where b.status = 'confirmed' and b.reminder_sent_at is null and b.reminder_attempts < 3
      and b.starts_at > now() + interval '1 hour'
      and b.starts_at <= now() + interval '24 hours'
      and b.scheduled_at < b.starts_at - interval '25 hours'
      and (b.reminder_claimed_at is null or b.reminder_claimed_at < now() - interval '5 minutes')
    order by b.starts_at
    limit greatest(1, least(coalesce(p_limit, 50), 200))
    for update skip locked
  )
  update bookings b set reminder_claimed_at = now(), reminder_attempts = b.reminder_attempts + 1
  from picked where b.id = picked.id
  returning b.id, b.kind, b.guest_email, b.locale, b.starts_at, b.ends_at, b.time_zone, b.meet_url
$$;

create or replace function booking_reminder_done(p_id uuid, p_error text default null) returns void
  language sql volatile security invoker set search_path = public
as $$
  update bookings set
    reminder_sent_at = case when p_error is null then now() else null end,
    reminder_error = left(p_error, 500),
    reminder_claimed_at = case when p_error is null then reminder_claimed_at else null end
  where id = p_id
$$;

-- 3. The welcome series: each confirmed subscriber's NEXT switched-on e-mail
--    in their language, once its day has come (days after the confirmation).
--    An e-mail more than 3 days overdue — a step added later, or a pause — is
--    skipped rather than sent late. Claimed; three tries, then skipped.
create or replace function newsletter_series_due(p_limit integer default 100)
returns table (subscriber_id uuid, email text, locale text, unsubscribe_token text,
               step smallint, subject text, preheader text, body text)
  language plpgsql volatile security invoker set search_path = public
as $$
#variable_conflict use_column
begin
  -- Overdue steps are passed over, one at a time, until none is.
  loop
    update newsletter_subscribers n set series_position = s.position, series_attempts = 0, series_error = null
    from newsletter_series s
    where n.status = 'confirmed' and n.welcome_sent_at is not null
      and s.locale = n.locale and s.enabled
      and s.position = (select min(x.position) from newsletter_series x
                        where x.locale = n.locale and x.enabled and x.position > n.series_position)
      and n.confirmed_at + make_interval(days => s.delay_days) < now() - interval '3 days';
    exit when not found;
  end loop;

  return query
  with nxt as (
    select n.id, s.position, s.subject, s.preheader, s.body
    from newsletter_subscribers n
    join newsletter_series s on s.locale = n.locale and s.enabled
      and s.position = (select min(x.position) from newsletter_series x
                        where x.locale = n.locale and x.enabled and x.position > n.series_position)
    where n.status = 'confirmed' and n.welcome_sent_at is not null and n.series_attempts < 3
      and n.confirmed_at + make_interval(days => s.delay_days) <= now()
      and (n.series_claimed_at is null or n.series_claimed_at < now() - interval '5 minutes')
    order by n.confirmed_at
    limit greatest(1, least(coalesce(p_limit, 100), 200))
    for update of n skip locked
  ), claimed as (
    update newsletter_subscribers n set series_claimed_at = now(), series_attempts = n.series_attempts + 1
    from nxt where n.id = nxt.id
    returning n.id, n.email, n.locale, n.unsubscribe_token
  )
  select c.id, c.email, c.locale, c.unsubscribe_token, nxt.position, nxt.subject, nxt.preheader, nxt.body
  from claimed c join nxt on nxt.id = c.id;
end;
$$;

-- Sent: the subscriber moves on. Failed: tried again; after three, skipped.
create or replace function newsletter_series_done(p_id uuid, p_position integer, p_error text default null) returns void
  language sql volatile security invoker set search_path = public
as $$
  update newsletter_subscribers set
    series_position = case when p_error is null or series_attempts >= 3 then greatest(series_position, p_position) else series_position end,
    series_attempts = case when p_error is null or series_attempts >= 3 then 0 else series_attempts end,
    series_error = left(p_error, 500),
    series_claimed_at = null
  where id = p_id
$$;

-- 4. The site's list of articles and case studies, as the dispatcher read it:
--    [{key, type, campaigns: [{audience, subject, preheader, body}]}].
--    The first list ever read is only remembered. After that each new key is
--    remembered and, by the setting, announced (one campaign per language
--    that has confirmed subscribers), drafted, or ignored. Returns how many
--    campaigns it made.
create or replace function newsletter_announce(p_items jsonb) returns integer
  language plpgsql volatile security invoker set search_path = public
as $$
declare
  mode text;
  first_time boolean;
  item jsonb;
  camp jsonb;
  made integer := 0;
  per_item integer;
  n integer;
  cid uuid;
begin
  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'stratos:newsletter_announce_items' using errcode = 'P0001';
  end if;
  select auto_announce into mode from newsletter_settings where singleton;
  mode := coalesce(mode, 'send');
  first_time := not exists (select 1 from newsletter_announced);

  for item in select * from jsonb_array_elements(p_items) loop
    if item->>'key' is null or item->>'key' !~ '^[a-z0-9-]{1,80}$' or item->>'type' not in ('post', 'case') then
      continue;
    end if;
    insert into newsletter_announced (key, type, baseline)
    values (item->>'key', item->>'type', first_time)
    on conflict (key) do nothing;
    if not found or first_time or mode = 'off' then
      continue;
    end if;

    per_item := 0;
    for camp in select * from jsonb_array_elements(coalesce(item->'campaigns', '[]'::jsonb)) loop
      if camp->>'audience' not in ('hu', 'en', 'de') then continue; end if;
      select count(*) into n from newsletter_subscribers s
      where s.status = 'confirmed' and s.locale = camp->>'audience';
      if mode = 'send' and n = 0 then continue; end if;
      insert into newsletter_campaigns (subject, preheader, body, audience, kind, source_key)
      values (left(camp->>'subject', 200), left(nullif(camp->>'preheader', ''), 200), camp->>'body',
              camp->>'audience', 'announce', item->>'key')
      returning id into cid;
      if mode = 'send' then
        insert into newsletter_deliveries (campaign_id, subscriber_id)
        select cid, s.id from newsletter_subscribers s
        where s.status = 'confirmed' and s.locale = camp->>'audience';
        update newsletter_campaigns set status = 'sending', recipients = n, queued_at = now() where id = cid;
      end if;
      per_item := per_item + 1;
    end loop;
    update newsletter_announced set campaigns = per_item where key = item->>'key';
    made := made + per_item;
  end loop;
  return made;
end;
$$;


-- ###########################################################################
-- ACCESS
-- ###########################################################################

do $$
declare f text;
begin
  execute 'revoke all on table newsletter_settings, newsletter_announced, newsletter_series from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table newsletter_settings, newsletter_announced, newsletter_series from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table newsletter_settings, newsletter_announced, newsletter_series from authenticated';
    execute 'grant select on newsletter_settings, newsletter_announced, newsletter_series to authenticated';
    execute 'grant update (auto_announce) on newsletter_settings to authenticated';
    execute 'grant insert (locale, position, delay_days, subject, preheader, body, enabled),
                   update (position, delay_days, subject, preheader, body, enabled), delete
               on newsletter_series to authenticated';
    -- The new columns of the newsletter's tables, readable like the rest.
    execute 'grant select (kind, source_key) on newsletter_campaigns to authenticated';
    execute 'grant select (series_position, series_error) on newsletter_subscribers to authenticated';
  end if;

  foreach f in array array[
    'lead_confirmation_allowed(text)',
    'booking_reminders_due(integer)',
    'booking_reminder_done(uuid, text)',
    'newsletter_series_due(integer)',
    'newsletter_series_done(uuid, integer, text)',
    'newsletter_announce(jsonb)'
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

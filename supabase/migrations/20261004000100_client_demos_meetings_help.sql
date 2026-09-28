-- =============================================================================
-- Stratos — phase 7: demo links, meetings and the help centre in the client
-- portal
--
--   1. demo links       `project_demos`: title, HTTPS URL, a short note for the
--                       client, published (default OFF), revoked. Several per
--                       project; no versioning.
--   2. meetings         `project_meetings`: title, start/end (timestamptz), IANA
--                       time zone (default Europe/Budapest), an HTTPS join link
--                       and/or a place, a note, cancelled.
--   3. help centre      `help_articles`: question, answer, topic, alternative
--                       phrasings, source, published|draft, and an internal
--                       review note. Seeded by 20261004000200_help_seed.sql.
--   4. the client API   `client_portal_demos()`, `client_portal_meetings()`,
--                       `client_help_articles()` — fixed columns, only the
--                       caller's CURRENT assignments (the same rule as every
--                       phase-4 function), only published demos, only
--                       published articles. Revoking an assignment or the
--                       account closes all three at once.
--
-- A URL is checked HERE, not only in the Portal: https only, a plain host, no
-- user:password@, no whitespace or control characters, at most 2000
-- characters. The database never fetches it.
--
-- The portal's access control does NOT protect the demo site itself: a
-- published demo URL is reachable by anyone who has it. The owner's screen
-- says so.
--
-- Nothing is deleted through the API: a demo is revoked, a meeting cancelled,
-- an article set back to draft. Run after 20261003000100_owner_delegates.sql.
-- =============================================================================

do $$
begin
  if to_regprocedure('public.client_has_project(uuid)') is null then
    raise exception 'The client portal (20261001000100_client_portal.sql) is not applied.';
  end if;
  if not exists (select 1 from portal_owner o join profiles p on p.id = o.user_id where p.role = 'super_admin') then
    raise exception 'No portal owner who is a super_admin is designated.';
  end if;
  if current_user in ('anon', 'authenticated') then
    raise exception 'Run this migration from the SQL editor, not as an API role.';
  end if;
end $$;

-- An https URL a browser may be sent to. Deliberately narrow: scheme https,
-- a host of letters/digits/dots/hyphens (so no user:pass@, no spaces), an
-- optional port, then anything without whitespace or control characters.
create or replace function portal_safe_https_url(p_url text) returns boolean
  language sql immutable set search_path = public
as $$
  select p_url is not null
     and length(p_url) <= 2000
     and p_url ~ '^https://[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+(:[0-9]{1,5})?([/?#][^[:space:][:cntrl:]]*)?$'
$$;

create or replace function portal_valid_time_zone(p_zone text) returns boolean
  language sql stable set search_path = public
as $$ select exists (select 1 from pg_timezone_names where name = p_zone) $$;


-- ###########################################################################
-- 1. DEMO LINKS
-- ###########################################################################

create table if not exists project_demos (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references projects(id) on delete restrict,
  title        text not null check (length(btrim(title)) between 1 and 120),
  url          text not null check (portal_safe_https_url(url)),
  client_note  text check (client_note is null or length(client_note) <= 500),
  published    boolean not null default false,
  revoked_at   timestamptz,
  position     smallint not null default 0,
  created_by   uuid references profiles(id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists project_demos_project_idx on project_demos (project_id, position);

-- The project is fixed; a revoked demo is never published.
create or replace function project_demo_rules() returns trigger
  language plpgsql set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.project_id is distinct from old.project_id then
    raise exception 'stratos:demo_project_fixed' using errcode = 'P0001';
  end if;
  if new.revoked_at is not null then
    new.published := false;
  end if;
  return new;
end;
$$;
drop trigger if exists project_demos_rules on project_demos;
create trigger project_demos_rules before insert or update on project_demos
  for each row execute function project_demo_rules();
drop trigger if exists project_demos_updated_at on project_demos;
create trigger project_demos_updated_at before update on project_demos
  for each row execute function set_updated_at();


-- ###########################################################################
-- 2. MEETINGS
-- ###########################################################################

create table if not exists project_meetings (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references projects(id) on delete restrict,
  title        text not null check (length(btrim(title)) between 1 and 160),
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  time_zone    text not null default 'Europe/Budapest',
  join_url     text check (join_url is null or portal_safe_https_url(join_url)),
  location     text check (location is null or length(btrim(location)) between 1 and 300),
  client_note  text check (client_note is null or length(client_note) <= 1000),
  cancelled_at timestamptz,
  created_by   uuid references profiles(id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (ends_at > starts_at),
  check (ends_at - starts_at <= interval '24 hours'),
  check (join_url is not null or location is not null)
);
create index if not exists project_meetings_project_idx on project_meetings (project_id, starts_at);

create or replace function project_meeting_rules() returns trigger
  language plpgsql set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.project_id is distinct from old.project_id then
    raise exception 'stratos:meeting_project_fixed' using errcode = 'P0001';
  end if;
  if not portal_valid_time_zone(new.time_zone) then
    raise exception 'stratos:meeting_time_zone' using errcode = 'P0001',
      hint = 'Use an IANA time zone name, e.g. Europe/Budapest.';
  end if;
  return new;
end;
$$;
drop trigger if exists project_meetings_rules on project_meetings;
create trigger project_meetings_rules before insert or update on project_meetings
  for each row execute function project_meeting_rules();
drop trigger if exists project_meetings_updated_at on project_meetings;
create trigger project_meetings_updated_at before update on project_meetings
  for each row execute function set_updated_at();


-- ###########################################################################
-- 3. HELP CENTRE
-- ###########################################################################

create table if not exists help_articles (
  id            uuid primary key default gen_random_uuid(),
  -- Stable key of a seeded article, so re-running the seed never overwrites
  -- an edit. Owner-created articles have none.
  slug          text unique check (slug is null or slug ~ '^[a-z0-9-]{3,80}$'),
  question      text not null check (length(btrim(question)) between 3 and 300),
  answer        text not null check (length(btrim(answer)) between 1 and 4000),
  topic         text not null check (length(btrim(topic)) between 1 and 80),
  alt_questions text[] not null default '{}' check (cardinality(alt_questions) <= 40),
  source        text check (source is null or length(source) <= 500),
  status        text not null default 'draft' check (status in ('published', 'draft')),
  -- Internal: why an article is a draft, what decision it waits for.
  review_note   text check (review_note is null or length(review_note) <= 1000),
  position      integer not null default 0,
  updated_by    uuid references profiles(id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists help_articles_topic_idx on help_articles (status, topic, position);
drop trigger if exists help_articles_updated_at on help_articles;
create trigger help_articles_updated_at before update on help_articles
  for each row execute function set_updated_at();


-- ###########################################################################
-- 4. ACCESS
-- ###########################################################################

do $$
declare t text;
begin
  foreach t in array array['project_demos', 'project_meetings', 'help_articles'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists %I on %I', t || '_owner_all', t);
    execute format('create policy %I on %I for all using (is_owner()) with check (is_owner())', t || '_owner_all', t);
    -- The client functions below run as their owner; FORCE applies to it too.
    execute format('drop policy if exists %I on %I', t || '_definer_select', t);
    execute format('create policy %I on %I for select to %I using (true)', t || '_definer_select', t, client_definer_role());
    execute format('revoke all on table %I from public', t);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on table %I from anon', t);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on table %I from authenticated', t);
      -- Never DELETE: revoke, cancel, or set back to draft.
      execute format('grant select, insert, update on table %I to authenticated', t);
    end if;
  end loop;
end $$;


-- ###########################################################################
-- 5. THE CLIENT API
-- ###########################################################################

-- Published, not revoked demos of the caller's CURRENT projects.
create or replace function client_portal_demos()
returns table (demo_id uuid, project_id uuid, project_name text, title text, url text, note text, updated_at timestamptz)
  language sql stable security definer set search_path = public as $$
  select d.id, d.project_id, p.name, d.title, d.url, d.client_note, d.updated_at
  from project_demos d join projects p on p.id = d.project_id
  where d.published and d.revoked_at is null
    and client_has_project(d.project_id)
  order by p.name, d.position, d.created_at
$$;

-- Meetings of the caller's CURRENT projects that have not ended yet —
-- cancelled ones included (flagged), so a client sees that one was called off.
create or replace function client_portal_meetings()
returns table (meeting_id uuid, project_id uuid, project_name text, title text, starts_at timestamptz,
               ends_at timestamptz, time_zone text, join_url text, location text, note text, cancelled boolean)
  language sql stable security definer set search_path = public as $$
  select m.id, m.project_id, p.name, m.title, m.starts_at, m.ends_at, m.time_zone,
         m.join_url, m.location, m.client_note, m.cancelled_at is not null
  from project_meetings m join projects p on p.id = m.project_id
  where m.ends_at > now()
    and client_has_project(m.project_id)
  order by m.starts_at
$$;

-- Published help articles, for a linked client account. No source, no review
-- note: those are the owner's.
create or replace function client_help_articles()
returns table (article_id uuid, question text, answer text, topic text, alt_questions text[])
  language sql stable security definer set search_path = public as $$
  select h.id, h.question, h.answer, h.topic, h.alt_questions
  from help_articles h
  where h.status = 'published' and client_account_id() is not null
  order by h.topic, h.position, h.question
$$;

do $$
declare f text;
begin
  foreach f in array array['client_portal_demos()', 'client_portal_meetings()', 'client_help_articles()'] loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', f);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('grant execute on function %s to authenticated', f);
    end if;
  end loop;
  foreach f in array array['portal_safe_https_url(text)', 'portal_valid_time_zone(text)'] loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('grant execute on function %s to anon', f);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('grant execute on function %s to authenticated', f);
    end if;
  end loop;
end $$;

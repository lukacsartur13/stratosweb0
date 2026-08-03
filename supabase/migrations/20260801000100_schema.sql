-- =============================================================================
-- Stratos — core schema
--
-- Everything here is owned by the portal. The public site stays static and
-- never talks to these tables directly; the only write path from the outside
-- world is the leads insert made by the Netlify function with the service key.
--
-- Run order: this file, then 20260801000200_rls.sql.
-- =============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- enum types
-- Roles are an enum rather than free text so that a typo in a policy fails
-- loudly at migration time instead of silently granting nothing (or worse,
-- silently matching nothing and locking an admin out).
do $$ begin
  create type user_role as enum ('super_admin', 'admin', 'team_member', 'client');
exception when duplicate_object then null; end $$;

do $$ begin
  create type lead_status as enum ('new', 'contacted', 'qualified', 'won', 'lost', 'spam');
exception when duplicate_object then null; end $$;

do $$ begin
  create type project_status as enum ('discovery', 'design', 'build', 'launch', 'care', 'archived');
exception when duplicate_object then null; end $$;

do $$ begin
  create type org_status as enum ('prospect', 'active', 'paused', 'former');
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------------ helpers
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ------------------------------------------------------------ organizations
create table if not exists organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,
  website     text,
  status      org_status not null default 'prospect',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger organizations_updated_at before update on organizations
  for each row execute function set_updated_at();

-- ------------------------------------------------------------------ profiles
-- One row per auth user. `role` lives here and NOT in user metadata, because
-- user metadata is writable by the user themselves — a client could promote
-- themselves to super_admin. See the role-change guard in the RLS migration.
create table if not exists profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  email           text not null,
  full_name       text,
  avatar_url      text,
  role            user_role not null default 'client',
  organization_id uuid references organizations(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists profiles_org_idx  on profiles(organization_id);
create index if not exists profiles_role_idx on profiles(role);
create trigger profiles_updated_at before update on profiles
  for each row execute function set_updated_at();

-- New auth users get a profile automatically, always at the lowest privilege.
-- Nothing in the signup path can choose a role.
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email, full_name, role)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name', 'client')
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- ------------------------------------------------------------------ projects
create table if not exists projects (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name            text not null,
  slug            text not null,
  description     text,
  status          project_status not null default 'discovery',
  start_date      date,
  target_date     date,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, slug)
);
create index if not exists projects_org_idx    on projects(organization_id);
create index if not exists projects_status_idx on projects(status);
create trigger projects_updated_at before update on projects
  for each row execute function set_updated_at();

-- Which team members are on which project. This is what makes `team_member`
-- narrower than `admin` — they see assigned work, not the whole book.
create table if not exists project_members (
  project_id uuid not null references projects(id) on delete cascade,
  user_id    uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index if not exists project_members_user_idx on project_members(user_id);

-- --------------------------------------------------------------------- leads
-- Written by the public contact form through a Netlify function. Nothing in
-- the browser may read this table — see the RLS migration.
create table if not exists leads (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  company          text,
  email            text not null,
  phone            text,
  website          text,
  service_interest text,
  budget_range     text,
  timeframe        text,
  message          text,
  source           text default 'website',
  locale           text default 'hu',
  status           lead_status not null default 'new',
  ip_hash          text,          -- salted hash, never the raw address
  user_agent       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists leads_status_idx  on leads(status);
create index if not exists leads_created_idx on leads(created_at desc);
create trigger leads_updated_at before update on leads
  for each row execute function set_updated_at();

-- -------------------------------------------------------------- case studies
create table if not exists case_studies (
  id                uuid primary key default gen_random_uuid(),
  title             text not null,
  slug              text not null unique,
  client_name       text,
  short_description text,
  challenge         text,
  solution          text,
  results           text,
  cover_image       text,
  published         boolean not null default false,
  sort_order        integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists case_studies_pub_idx on case_studies(published, sort_order);
create trigger case_studies_updated_at before update on case_studies
  for each row execute function set_updated_at();

-- ------------------------------------------------------------ content blocks
create table if not exists content_blocks (
  id         uuid primary key default gen_random_uuid(),
  key        text not null,
  locale     text not null default 'hu',
  content    jsonb not null default '{}'::jsonb,
  updated_by uuid references profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (key, locale)
);

-- -------------------------------------------------------------- media assets
create table if not exists media_assets (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  file_name       text not null,
  storage_path    text not null,
  mime_type       text,
  file_size       bigint,
  uploaded_by     uuid references profiles(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists media_org_idx on media_assets(organization_id);

-- ------------------------------------------------------------- activity logs
create table if not exists activity_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references profiles(id) on delete set null,
  action      text not null,
  entity_type text,
  entity_id   uuid,
  metadata    jsonb default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists activity_created_idx on activity_logs(created_at desc);
create index if not exists activity_user_idx    on activity_logs(user_id);

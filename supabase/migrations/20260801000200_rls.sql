-- =============================================================================
-- Stratos — row level security
--
-- The rule this file exists to enforce: the portal's React route guards are a
-- convenience, not a control. Every table below is readable and writable only
-- through these policies, so a client who opens devtools and calls the REST API
-- with their own token gets exactly what a client is allowed and nothing else.
--
-- Two helper functions do the role lookups. Both are SECURITY DEFINER with a
-- pinned search_path: without that they would themselves be subject to RLS on
-- `profiles` and recurse. This is the standard Supabase pattern for the
-- "read my own role inside a policy on the table that stores roles" problem.
-- =============================================================================

-- ------------------------------------------------------------------ helpers
create or replace function auth_role()
returns user_role
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid()
$$;

create or replace function auth_org()
returns uuid
language sql stable security definer set search_path = public as $$
  select organization_id from profiles where id = auth.uid()
$$;

-- Staff = everyone who works at Stratos. Clients are deliberately excluded.
create or replace function is_staff()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(auth_role() in ('super_admin', 'admin', 'team_member'), false)
$$;

create or replace function is_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(auth_role() in ('super_admin', 'admin'), false)
$$;

create or replace function is_super_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(auth_role() = 'super_admin', false)
$$;

-- --------------------------------------------------------- enable everywhere
alter table organizations  enable row level security;
alter table profiles       enable row level security;
alter table projects       enable row level security;
alter table project_members enable row level security;
alter table leads          enable row level security;
alter table case_studies   enable row level security;
alter table content_blocks enable row level security;
alter table media_assets   enable row level security;
alter table activity_logs  enable row level security;

-- Force RLS for table owners too, so a mistake in a definer function or a
-- future owner-context script cannot quietly bypass every policy below.
alter table leads         force row level security;
alter table profiles      force row level security;
alter table activity_logs force row level security;

-- ------------------------------------------------------------------ profiles
drop policy if exists profiles_select_self  on profiles;
drop policy if exists profiles_select_staff on profiles;
drop policy if exists profiles_update_self  on profiles;
drop policy if exists profiles_admin_write  on profiles;

create policy profiles_select_self on profiles
  for select using (id = auth.uid());

-- Staff can see the directory. Clients cannot enumerate other users at all.
create policy profiles_select_staff on profiles
  for select using (is_staff());

-- A user may edit their own name and avatar. They may NOT change their role or
-- move themselves to another organization — the WITH CHECK re-reads the stored
-- row and requires both to be unchanged. This is the single most important
-- policy in the file: without it, privilege escalation is a one-line PATCH.
create policy profiles_update_self on profiles
  for update using (id = auth.uid())
  with check (
    id = auth.uid()
    and role = (select p.role from profiles p where p.id = auth.uid())
    and organization_id is not distinct from
        (select p.organization_id from profiles p where p.id = auth.uid())
  );

-- Only super_admin manages roles and memberships.
create policy profiles_admin_write on profiles
  for all using (is_super_admin()) with check (is_super_admin());

-- ------------------------------------------------------------ organizations
drop policy if exists orgs_select_own   on organizations;
drop policy if exists orgs_select_staff on organizations;
drop policy if exists orgs_admin_write  on organizations;

create policy orgs_select_own on organizations
  for select using (id = auth_org());

create policy orgs_select_staff on organizations
  for select using (is_staff());

create policy orgs_admin_write on organizations
  for all using (is_admin()) with check (is_admin());

-- ------------------------------------------------------------------ projects
drop policy if exists projects_select_client on projects;
drop policy if exists projects_select_member on projects;
drop policy if exists projects_select_admin  on projects;
drop policy if exists projects_admin_write   on projects;

-- A client sees their own organization's projects and nothing else.
create policy projects_select_client on projects
  for select using (organization_id = auth_org());

-- A team member sees projects they are assigned to.
create policy projects_select_member on projects
  for select using (
    exists (select 1 from project_members m
            where m.project_id = projects.id and m.user_id = auth.uid())
  );

create policy projects_select_admin on projects
  for select using (is_admin());

create policy projects_admin_write on projects
  for all using (is_admin()) with check (is_admin());

-- ----------------------------------------------------------- project members
drop policy if exists pm_select_self  on project_members;
drop policy if exists pm_select_admin on project_members;
drop policy if exists pm_admin_write  on project_members;

create policy pm_select_self  on project_members for select using (user_id = auth.uid());
create policy pm_select_admin on project_members for select using (is_admin());
create policy pm_admin_write  on project_members for all
  using (is_admin()) with check (is_admin());

-- --------------------------------------------------------------------- leads
-- No insert policy, on purpose. The public form does not write here from the
-- browser; the Netlify function does, with the service role key, which bypasses
-- RLS. That keeps the write path server-side where validation and rate limiting
-- actually happen. An anonymous visitor has no path to this table at all.
drop policy if exists leads_select_staff on leads;
drop policy if exists leads_admin_write  on leads;

create policy leads_select_staff on leads for select using (is_staff());
create policy leads_admin_write  on leads for all
  using (is_admin()) with check (is_admin());

-- --------------------------------------------------------------- case studies
drop policy if exists cs_select_published on case_studies;
drop policy if exists cs_select_staff     on case_studies;
drop policy if exists cs_admin_write      on case_studies;

-- Published case studies are the one thing anon may read: this is what lets a
-- future public page pull them without a server round trip. Drafts stay hidden.
create policy cs_select_published on case_studies
  for select using (published = true);

create policy cs_select_staff on case_studies for select using (is_staff());
create policy cs_admin_write  on case_studies for all
  using (is_admin()) with check (is_admin());

-- ------------------------------------------------------------ content blocks
drop policy if exists content_select_all  on content_blocks;
drop policy if exists content_admin_write on content_blocks;

create policy content_select_all  on content_blocks for select using (true);
create policy content_admin_write on content_blocks for all
  using (is_admin()) with check (is_admin());

-- -------------------------------------------------------------- media assets
drop policy if exists media_select_org   on media_assets;
drop policy if exists media_select_staff on media_assets;
drop policy if exists media_staff_write  on media_assets;

create policy media_select_org   on media_assets for select using (organization_id = auth_org());
create policy media_select_staff on media_assets for select using (is_staff());
create policy media_staff_write  on media_assets for all
  using (is_staff()) with check (is_staff());

-- ------------------------------------------------------------- activity logs
-- Append-only from the application's point of view: staff may read, nobody may
-- update or delete through the API. Writes come from the service key.
drop policy if exists activity_select_admin on activity_logs;
create policy activity_select_admin on activity_logs for select using (is_admin());

-- =============================================================================
-- Bootstrapping the first super_admin
--
-- There is no self-service path to an elevated role — that is the point. To
-- create the first one, sign the user up through the portal (they land as
-- 'client'), then run this ONCE in the Supabase SQL editor, which executes as
-- table owner and is not subject to the policies above:
--
--   update profiles set role = 'super_admin' where email = 'you@media-stratos.com';
--
-- Every later role change goes through the portal's Users screen, which is
-- itself gated by profiles_admin_write.
-- =============================================================================

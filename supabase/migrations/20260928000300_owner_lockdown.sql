-- =============================================================================
-- Stratos — owner tracker, step 3 of 3: projects become the owner's alone
--
-- Before this file, a project was readable by
--
--   * any client whose profile points at the project's organization
--     (`projects_select_client`) — value, payment state and paid amount
--     included, because RLS filters rows, not columns
--   * any profile listed in `project_members` (`projects_select_member`)
--   * every admin and super_admin (`projects_select_admin`, `projects_admin_write`)
--
-- and the checkpoints and links followed the project's visibility, the costs
-- were admin-wide, project notes were staff-wide and every project event in the
-- activity log was admin-wide. After it, every one of those paths answers only
-- to `is_owner()`.
--
-- THE PATHS, ALL OF THEM
-- ----------------------
--   projects             4 policies  → 1 owner policy
--   project_milestones   2 policies  → 1 owner policy
--   project_costs        2 policies  → 1 owner policy
--   project_links        2 policies  → 1 owner policy
--   project_members      admin read/write → owner; a user still sees their own
--                        membership rows (project ids only, nothing else)
--   record_notes         project notes → owner; opportunity/client unchanged
--   activity_logs        project events → owner; everything else unchanged
--   portal_sales_summary SECURITY INVOKER — its `projects_*` buckets now count
--                        only what the caller may read, i.e. nothing unless owner
--   checkpoint_templates owner-only since step 2
--
-- Leads, opportunities, clients and contacts are NOT touched. What an admin
-- could do in Sales and Clients before, they can do after — except see the
-- projects hanging off a client or a won deal, which is the point.
--
-- SAFETY
-- ------
-- This file REFUSES TO RUN until an owner has been designated with
-- `select portal_set_owner('<email>');` and that account is a super_admin.
-- Without that guard, applying it would lock every account out of every project
-- — including the owner's.
--
-- Policy swaps only. No table, column, row or type is dropped or rewritten.
-- Undo with supabase/checks/owner-lockdown-rollback.sql, which restores the
-- previous policies and touches no data.
--
-- Run after 20260928000200_owner_tracker.sql AND after designating the owner.
-- =============================================================================

do $$
declare
  owner_role user_role;
begin
  select p.role into owner_role
  from portal_owner o join profiles p on p.id = o.user_id;

  if owner_role is null then
    raise exception 'No portal owner is designated. Run select portal_set_owner(''<email>''); first — this migration would otherwise lock everyone out of projects.';
  end if;
  if owner_role <> 'super_admin' then
    raise exception 'The designated owner is %, not super_admin. is_owner() would answer false for them; fix the role or the designation first.', owner_role;
  end if;
end $$;

-- ------------------------------------------------------------------ projects
drop policy if exists projects_select_client on projects;
drop policy if exists projects_select_member on projects;
drop policy if exists projects_select_admin  on projects;
drop policy if exists projects_admin_write   on projects;
drop policy if exists projects_owner_all     on projects;

create policy projects_owner_all on projects
  for all using (is_owner()) with check (is_owner());

-- Owner-context scripts and definer functions are held to the policy too.
alter table projects force row level security;

-- ------------------------------------------------------- project_milestones
drop policy if exists project_milestones_select    on project_milestones;
drop policy if exists project_milestones_write     on project_milestones;
drop policy if exists project_milestones_owner_all on project_milestones;

create policy project_milestones_owner_all on project_milestones
  for all using (is_owner()) with check (is_owner());

-- ------------------------------------------------------------ project_costs
drop policy if exists project_costs_select_admin on project_costs;
drop policy if exists project_costs_write_admin  on project_costs;
drop policy if exists project_costs_owner_all    on project_costs;

create policy project_costs_owner_all on project_costs
  for all using (is_owner()) with check (is_owner());

-- ------------------------------------------------------------ project_links
drop policy if exists project_links_select    on project_links;
drop policy if exists project_links_write     on project_links;
drop policy if exists project_links_owner_all on project_links;

create policy project_links_owner_all on project_links
  for all using (is_owner()) with check (is_owner());

-- ---------------------------------------------------------- project_members
-- No longer grants anything on `projects` (the member policy is gone above).
-- `pm_select_self` stays: a user may see their own membership rows, which carry
-- a project id and nothing else.
drop policy if exists pm_select_admin on project_members;
drop policy if exists pm_admin_write  on project_members;
drop policy if exists pm_owner_all    on project_members;

create policy pm_owner_all on project_members
  for all using (is_owner()) with check (is_owner());

-- ------------------------------------------------------------- record_notes
-- Opportunity and client notes keep exactly the rules they had. Project notes
-- follow the project.
drop policy if exists record_notes_select_staff  on record_notes;
drop policy if exists record_notes_insert_admin  on record_notes;
drop policy if exists record_notes_delete_author on record_notes;

create policy record_notes_select_staff on record_notes
  for select using (
    (entity_type <> 'project' and is_staff())
    or (entity_type = 'project' and is_owner())
  );

create policy record_notes_insert_admin on record_notes
  for insert with check (
    author_id = auth.uid()
    and ((entity_type <> 'project' and is_admin())
         or (entity_type = 'project' and is_owner()))
  );

create policy record_notes_delete_author on record_notes
  for delete using (
    author_id = auth.uid()
    and ((entity_type <> 'project' and is_admin())
         or (entity_type = 'project' and is_owner()))
  );

-- ------------------------------------------------------------ activity_logs
-- Project events (status changes, value changes, costs added and removed) name
-- the project's figures in `metadata`. Everything else stays admin-readable.
drop policy if exists activity_select_admin on activity_logs;

create policy activity_select_admin on activity_logs
  for select using (
    (entity_type is distinct from 'project' and is_admin())
    or is_owner()
  );

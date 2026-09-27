-- =============================================================================
-- Owner tracker — ROLLBACK of step 3 (20260928000300_owner_lockdown.sql).
--
-- Restores, name for name, the policies that 20260801000200_rls.sql and
-- 20260816000100_revenue_operations.sql had installed. Policies only: no row,
-- column or table is touched, so every project, checkpoint, note and log entry
-- written while the lockdown was in place is still there afterwards.
--
-- The owner designation and the tracker schema (step 2) are left as they are;
-- see owner-tracker-rollback.sql for step 2.
-- =============================================================================

begin;

-- projects
drop policy if exists projects_owner_all on projects;
drop policy if exists projects_select_client on projects;
drop policy if exists projects_select_member on projects;
drop policy if exists projects_select_admin  on projects;
drop policy if exists projects_admin_write   on projects;
create policy projects_select_client on projects
  for select using (organization_id = auth_org());
create policy projects_select_member on projects
  for select using (
    exists (select 1 from project_members m
            where m.project_id = projects.id and m.user_id = auth.uid())
  );
create policy projects_select_admin on projects
  for select using (is_admin());
create policy projects_admin_write on projects
  for all using (is_admin()) with check (is_admin());
alter table projects no force row level security;

-- project_milestones
drop policy if exists project_milestones_owner_all on project_milestones;
drop policy if exists project_milestones_select on project_milestones;
drop policy if exists project_milestones_write  on project_milestones;
create policy project_milestones_select on project_milestones
  for select using (
    exists (select 1 from projects p where p.id = project_milestones.project_id)
  );
create policy project_milestones_write on project_milestones
  for all using (is_admin()) with check (is_admin());

-- project_costs
drop policy if exists project_costs_owner_all on project_costs;
drop policy if exists project_costs_select_admin on project_costs;
drop policy if exists project_costs_write_admin  on project_costs;
create policy project_costs_select_admin on project_costs
  for select using (is_admin());
create policy project_costs_write_admin on project_costs
  for all using (is_admin()) with check (is_admin());

-- project_links
drop policy if exists project_links_owner_all on project_links;
drop policy if exists project_links_select on project_links;
drop policy if exists project_links_write  on project_links;
create policy project_links_select on project_links
  for select using (
    exists (select 1 from projects p where p.id = project_links.project_id)
  );
create policy project_links_write on project_links
  for all using (is_admin()) with check (is_admin());

-- project_members
drop policy if exists pm_owner_all on project_members;
drop policy if exists pm_select_admin on project_members;
drop policy if exists pm_admin_write  on project_members;
create policy pm_select_admin on project_members for select using (is_admin());
create policy pm_admin_write  on project_members for all
  using (is_admin()) with check (is_admin());

-- record_notes
drop policy if exists record_notes_select_staff  on record_notes;
drop policy if exists record_notes_insert_admin  on record_notes;
drop policy if exists record_notes_delete_author on record_notes;
create policy record_notes_select_staff on record_notes
  for select using (is_staff());
create policy record_notes_insert_admin on record_notes
  for insert with check (is_admin() and author_id = auth.uid());
create policy record_notes_delete_author on record_notes
  for delete using (is_admin() and author_id = auth.uid());

-- activity_logs
drop policy if exists activity_select_admin on activity_logs;
create policy activity_select_admin on activity_logs for select using (is_admin());

commit;

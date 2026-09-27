-- =============================================================================
-- Owner tracker — PREFLIGHT. Read-only. Run in the Supabase SQL editor BEFORE
-- applying 20260928000100/0200/0300.
--
-- The anonymous REST probes used during planning can prove that a table or a
-- function EXISTS (42501 "permission denied" versus PGRST205 "not found"), and
-- that anon-readable tables have given columns. They cannot see policies,
-- triggers, enum labels of tables anon may not read, grants to `authenticated`,
-- or who holds which role. This script answers those, from the inside.
--
-- Every statement is a SELECT. Nothing here writes.
-- =============================================================================

-- 1. Every object the three new migrations build on. Any `false` stops the plan.
select 'table ' || t as object, to_regclass('public.' || t) is not null as present
from unnest(array['profiles', 'organizations', 'projects', 'project_members',
  'project_milestones', 'project_costs', 'project_links', 'record_notes',
  'activity_logs', 'opportunities', 'client_contacts', 'lead_notes']) t
union all
select 'function ' || f, to_regprocedure('public.' || f) is not null
from unnest(array['is_staff()', 'is_admin()', 'is_super_admin()', 'auth_role()',
  'set_updated_at()', 'milestone_complete_stamp()', 'log_business_change()',
  'portal_sales_summary()', 'portal_revenue_attribution(text)']) f
union all
select 'column projects.' || c, exists (
  select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'projects' and column_name = c)
from unnest(array['status', 'completed_at', 'archived_at', 'service', 'payment_state']) c
union all
select 'column project_milestones.' || c, exists (
  select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'project_milestones' and column_name = c)
from unnest(array['project_id', 'title', 'position', 'state', 'due_on', 'completed_at']) c
order by 1;

-- 2. The enum labels this phase relies on.
select t.typname, array_agg(e.enumlabel order by e.enumsortorder) as labels
from pg_type t join pg_enum e on e.enumtypid = t.oid
where t.typname in ('milestone_state', 'project_status', 'user_role')
group by t.typname;

-- 3. The policies step 3 replaces. The expected names are listed in
--    20260928000300_owner_lockdown.sql; anything extra here is a path that
--    migration does not know about and must be reviewed before applying it.
select tablename, policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('projects', 'project_milestones', 'project_costs', 'project_links',
                    'project_members', 'record_notes', 'activity_logs')
order by tablename, policyname;

-- 4. Views and functions that read `projects` or its children. Each one is an
--    access path; a SECURITY DEFINER one would bypass the new policies.
select n.nspname, p.proname, p.prosecdef as security_definer
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prosrc ~* '\m(projects|project_milestones|project_costs|project_links|project_members)\M'
order by 2;

select table_name as view_name
from information_schema.views
where table_schema = 'public'
  and view_definition ~* '\m(projects|project_milestones|project_costs|project_links)\M';

-- 5. Who could become the owner, and who would lose project access.
select id, email, role, created_at
from profiles
where role in ('super_admin', 'admin', 'team_member')
order by role, created_at;

select role, count(*) from profiles group by role order by role;

select count(*) as client_profiles_linked_to_an_organization
from profiles where role = 'client' and organization_id is not null;

select count(*) as project_member_rows from project_members;

-- 6. Rows the new rules will look at.
select count(*) as blocked_checkpoints_without_reason
from project_milestones
where state = 'blocked';

select status, count(*) as projects,
       count(*) filter (where completed_at is null) as without_completed_at
from projects group by status order by status;

select count(*) as completed_projects_without_checkpoints
from projects p
where p.status = 'completed'
  and not exists (select 1 from project_milestones m where m.project_id = p.id);

-- 7. Already applied? (All false/absent on a first run.)
select to_regclass('public.portal_owner') is not null as portal_owner_exists,
       to_regclass('public.checkpoint_templates') is not null as templates_exist,
       to_regprocedure('public.is_owner()') is not null as is_owner_exists;

-- =============================================================================
-- Owner tracker — VERIFY. Run in the Supabase SQL editor AFTER all three steps
-- and the owner designation.
--
-- It impersonates accounts the way PostgREST does (`set local role
-- authenticated` + `request.jwt.claims`) inside ONE transaction that ends in
-- ROLLBACK, so nothing it does persists. Every result row should read `ok`.
-- =============================================================================

begin;

create temp table verify_result (check_name text, ok boolean, detail text) on commit drop;
grant insert on verify_result to authenticated;

-- ------------------------------------------------------------ structure
insert into verify_result
select 'owner designated and super_admin',
       coalesce((select p.role = 'super_admin' from portal_owner o join profiles p on p.id = o.user_id), false),
       (select p.email from portal_owner o join profiles p on p.id = o.user_id);

insert into verify_result
select 'waiting_client state exists',
       exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
               where t.typname = 'milestone_state' and e.enumlabel = 'waiting_client'), null;

insert into verify_result
select 'close trigger installed', exists (select 1 from pg_trigger where tgname = 'projects_close_rules'), null
union all
select 'checkpoint trigger installed', exists (select 1 from pg_trigger where tgname = 'project_milestones_tracker_rules'), null
union all
select 'blocked constraint installed', exists (select 1 from pg_constraint where conname = 'project_milestones_blocked_check'),
       (select case when convalidated then 'validated' else 'NOT VALID — existing blocked rows lack a reason' end
        from pg_constraint where conname = 'project_milestones_blocked_check')
union all
select 'only owner policies on projects',
       not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'projects'
                   and policyname <> 'projects_owner_all'),
       (select string_agg(policyname, ', ') from pg_policies where schemaname = 'public' and tablename = 'projects')
union all
select 'portal_set_owner not executable by API roles',
       not has_function_privilege('authenticated', 'portal_set_owner(text)', 'execute')
       and not has_function_privilege('anon', 'portal_set_owner(text)', 'execute'), null
union all
select 'portal_owner not readable by API roles',
       not has_table_privilege('authenticated', 'portal_owner', 'select')
       and not has_table_privilege('anon', 'portal_owner', 'select'), null;

-- ------------------------------------------------------------ as the owner
-- The true totals first, as the SQL editor's own role; then the same counts as
-- the owner, which must match.
create temp table verify_totals on commit drop as
select (select count(*) from projects) as projects,
       (select count(*) from project_milestones) as checkpoints;
grant select on verify_totals to authenticated;

select set_config('request.jwt.claims',
  json_build_object('sub', (select user_id from portal_owner), 'role', 'authenticated')::text, true);
set local role authenticated;

insert into verify_result
select 'owner: is_owner() is true', is_owner(), null
union all
select 'owner: reads every project and checkpoint',
       (select count(*) from projects) = t.projects and (select count(*) from project_milestones) = t.checkpoints,
       format('%s projects, %s checkpoints', t.projects, t.checkpoints)
from verify_totals t;

reset role;

-- ---------------------------------------- as every other staff account
-- Each non-owner staff account is impersonated in turn and must read nothing.
do $$
declare
  staff record;
  n_projects bigint; n_steps bigint; n_notes bigint; n_logs bigint; owner_flag boolean;
begin
  for staff in
    select id, email, role from profiles
    where role in ('super_admin', 'admin', 'team_member', 'client')
      and id <> (select user_id from portal_owner)
    order by role, email
    limit 20
  loop
    perform set_config('request.jwt.claims',
      json_build_object('sub', staff.id, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    select is_owner() into owner_flag;
    -- A named owner delegate (phase 6) has the owner's rights by design; that
    -- exactly the right accounts do is checked by owner-delegates-verify.sql.
    -- Before phase 6 no account but the owner can reach this branch.
    if owner_flag then
      execute 'reset role';
      insert into verify_result values (format('%s (%s) has owner rights — see owner-delegates-verify.sql', staff.email, staff.role), true, null);
      continue;
    end if;
    select count(*) into n_projects from projects;
    select count(*) into n_steps from project_milestones;
    select count(*) into n_notes from record_notes where entity_type = 'project';
    select count(*) into n_logs from activity_logs where entity_type = 'project';
    execute 'reset role';
    insert into verify_result values (
      format('%s (%s) sees no project data', staff.email, staff.role),
      not owner_flag and n_projects = 0 and n_steps = 0 and n_notes = 0 and n_logs = 0,
      format('is_owner=%s projects=%s checkpoints=%s notes=%s logs=%s',
             owner_flag, n_projects, n_steps, n_notes, n_logs));
  end loop;
end $$;

select case when ok then 'ok' else 'FAIL' end as result, check_name, detail
from verify_result order by ok, check_name;

rollback;

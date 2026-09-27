-- =============================================================================
-- Impact — VERIFY. Run in the Supabase SQL editor AFTER 20260929000100/0200/0300.
--
-- Like owner-tracker-verify.sql: it impersonates accounts the way PostgREST
-- does (`set local role authenticated` + `request.jwt.claims`) inside ONE
-- transaction that ends in ROLLBACK, so nothing it does persists — including
-- the test link it writes. Every result row should read `ok`.
-- =============================================================================

begin;

create temp table verify_result (check_name text, ok boolean, detail text) on commit drop;
grant insert on verify_result to authenticated;

-- ------------------------------------------------------------ structure
insert into verify_result
select 'cancelled project state exists',
       exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
               where t.typname = 'project_status' and e.enumlabel = 'cancelled'), null
union all
select 'impact_applications exists, RLS enabled',
       coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.impact_applications')), false), null
union all
select 'capture trigger on leads', exists (select 1 from pg_trigger where tgname = 'leads_impact_capture'), null
union all
select 'relabel guard on leads', exists (select 1 from pg_trigger where tgname = 'leads_program_fixed'), null
union all
select 'paid-conversion wall on opportunities', exists (select 1 from pg_trigger where tgname = 'opportunities_not_impact'), null
union all
select 'program fixed on projects', exists (select 1 from pg_trigger where tgname = 'projects_program_fixed'), null
union all
select 'market value audit on projects', exists (select 1 from pg_trigger where tgname = 'projects_market_value_audit'), null
union all
select 'impact project needs an application (deferred)', exists (
  select 1 from pg_trigger where tgname = 'projects_impact_application' and tgdeferrable and tginitdeferred), null
union all
select 'impact free constraint validated', coalesce((
  select convalidated from pg_constraint where conname = 'projects_impact_free_check'), false), null
union all
select 'project_links url check compiles',
       coalesce((select pg_get_constraintdef(oid) !~ '\{3,500\}' from pg_constraint where conname = 'project_links_url_check'), false),
       (select pg_get_constraintdef(oid) from pg_constraint where conname = 'project_links_url_check')
union all
select 'no API role may insert or delete applications',
       not has_table_privilege('authenticated', 'impact_applications', 'insert')
       and not has_table_privilege('authenticated', 'impact_applications', 'delete')
       and not has_table_privilege('anon', 'impact_applications', 'select'), null
union all
select 'backfill is SQL-editor only',
       not has_function_privilege('authenticated', 'impact_sync_applications()', 'execute')
       and not has_function_privilege('anon', 'impact_sync_applications()', 'execute'), null
union all
select 'anon cannot start projects or read counters',
       not has_function_privilege('anon', 'impact_start_project(uuid, uuid, text, text, text, text, text, text, text[])', 'execute')
       and not has_function_privilege('anon', 'impact_support_summary()', 'execute'), null
union all
select 'no Impact lead is missing from the pipeline (except reported conflicts)',
       not exists (
         select 1 from leads l
         where lead_is_impact(l.form_type, l.source)
           and not exists (select 1 from impact_applications a where a.lead_id = l.id)
           and not exists (select 1 from opportunities o where o.lead_id = l.id)),
       (select format('%s missing — run select * from impact_sync_applications();', count(*))
        from leads l
        where lead_is_impact(l.form_type, l.source)
          and not exists (select 1 from impact_applications a where a.lead_id = l.id)
          and not exists (select 1 from opportunities o where o.lead_id = l.id))
union all
select 'no Impact lead has an application AND an opportunity',
       not exists (select 1 from impact_applications a join opportunities o on o.lead_id = a.lead_id), null;

-- ------------------------------------------------------------ as the owner
create temp table verify_totals on commit drop as
select (select count(*) from impact_applications) as applications,
       (select count(*) from projects where program = 'impact') as impact_projects,
       (select count(*) from projects where program = 'impact' and (
          coalesce(value, 0) <> 0 or coalesce(paid_amount, 0) <> 0 or coalesce(invoiced_amount, 0) <> 0)) as charged,
       (select count(*) from projects p where p.program = 'impact'
          and not exists (select 1 from impact_applications a where a.project_id = p.id)) as orphans,
       (select coalesce(sum(market_value), 0) from projects
          where program = 'impact' and status not in ('completed', 'cancelled')) as committed,
       (select coalesce(sum(market_value), 0) from projects
          where program = 'impact' and status = 'completed') as delivered,
       (select id from projects limit 1) as any_project;
grant select on verify_totals to authenticated;

insert into verify_result
select 'no Impact project carries a fee, invoice or payment', t.charged = 0, format('%s', t.charged) from verify_totals t
union all
select 'every Impact project has its application', t.orphans = 0, format('%s', t.orphans) from verify_totals t;

select set_config('request.jwt.claims',
  json_build_object('sub', (select user_id from portal_owner), 'role', 'authenticated')::text, true);
set local role authenticated;

insert into verify_result
select 'owner: reads every application',
       (select count(*) from impact_applications) = t.applications, format('%s', t.applications)
from verify_totals t
union all
select 'owner: counters match the projects',
       s.committed = t.committed and s.delivered = t.delivered,
       format('committed %s, delivered %s, %s in progress without a value', s.committed, s.delivered, s.committed_missing)
from verify_totals t, impact_support_summary() s;

-- The link fix, for real: one link on any project, as the owner, rolled back.
do $$
declare
  target uuid := (select any_project from verify_totals);
begin
  if target is null then
    insert into verify_result values ('owner: a project link can be stored', true, 'no project to try it on');
    return;
  end if;
  begin
    insert into project_links (project_id, label, url) values (target, 'verify', 'https://example.com/verify');
    insert into verify_result values ('owner: a project link can be stored', true, null);
  exception when others then
    insert into verify_result values ('owner: a project link can be stored', false, sqlerrm);
  end;
  begin
    insert into project_links (project_id, label, url) values (target, 'verify', 'javascript:alert(1)');
    insert into verify_result values ('owner: a javascript: link is refused', false, 'it was accepted');
  exception when check_violation then
    insert into verify_result values ('owner: a javascript: link is refused', true, null);
  end;
end $$;

reset role;

-- ---------------------------------------- as every other account
do $$
declare
  acct record;
  n_apps bigint; n_logs bigint; n_conf bigint; n_projects bigint; s record;
begin
  for acct in
    select id, email, role from profiles
    where id <> (select user_id from portal_owner)
    order by role, email
    limit 20
  loop
    perform set_config('request.jwt.claims',
      json_build_object('sub', acct.id, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    -- A named owner delegate (phase 6) has the owner's rights by design; it is
    -- checked by owner-delegates-verify.sql, not here.
    if is_owner() then
      execute 'reset role';
      insert into verify_result values (format('%s (%s) has owner rights — see owner-delegates-verify.sql', acct.email, acct.role), true, null);
      continue;
    end if;
    select count(*) into n_apps from impact_applications;
    select count(*) into n_logs from activity_logs where entity_type in ('impact_application', 'project');
    select count(*) into n_conf from impact_legacy_conflicts();
    select count(*) into n_projects from projects where program = 'impact';
    select * into s from impact_support_summary();
    execute 'reset role';
    insert into verify_result values (
      format('%s (%s) sees no Impact data', acct.email, acct.role),
      n_apps = 0 and n_logs = 0 and n_conf = 0 and n_projects = 0
        and s.committed = 0 and s.delivered = 0 and s.committed_missing = 0,
      format('applications=%s logs=%s conflicts=%s projects=%s committed=%s delivered=%s',
             n_apps, n_logs, n_conf, n_projects, s.committed, s.delivered));
  end loop;
end $$;

select case when ok then 'ok' else 'FAIL' end as result, check_name, detail
from verify_result order by ok, check_name;

rollback;

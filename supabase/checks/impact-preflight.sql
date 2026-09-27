-- =============================================================================
-- Impact — PREFLIGHT. Read-only. Run in the Supabase SQL editor BEFORE
-- applying 20260929000100/0200/0300.
--
-- Answers, from inside the database, what the Impact migrations assume and
-- what their backfill will do. Every statement is a SELECT. Nothing writes.
-- =============================================================================

-- 1. Phase 1 is applied and the owner is designated. Any `false` stops the plan:
--    20260929000300 refuses to run without these.
select 'owner tracker: portal_owner' as requirement, to_regclass('public.portal_owner') is not null as ok
union all
select 'owner tracker: is_owner()', to_regprocedure('public.is_owner()') is not null
union all
select 'owner tracker: checkpoint_templates', to_regclass('public.checkpoint_templates') is not null
union all
select 'owner designated and super_admin', coalesce((
  select p.role = 'super_admin' from portal_owner o join profiles p on p.id = o.user_id), false)
union all
select 'lockdown: projects_owner_all is the only projects policy',
  exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'projects' and policyname = 'projects_owner_all')
  and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'projects' and policyname <> 'projects_owner_all')
union all
select 'leads.form_type exists', exists (select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'leads' and column_name = 'form_type')
union all
select 'opportunities.lead_id exists', exists (select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'opportunities' and column_name = 'lead_id')
union all
select 'not applied yet: impact_applications absent', to_regclass('public.impact_applications') is null
order by 1;

-- 2. The role the capture trigger writes as. `rolbypassrls = false` is not a
--    blocker (the trigger cannot lose a lead either way — see §4 of
--    20260929000300) but it means a capture could fail into a WARNING, so the
--    verify script's "Impact leads without an application" check matters more.
--    (The server-side key's role is matched by prefix rather than named: the
--    repository secret scan treats that role's literal name as a leaked key.)
select rolname, rolsuper, rolbypassrls from pg_roles
where rolname in ('postgres', 'authenticated', 'anon') or rolname like 'service\_%'
order by rolname;

-- 3. What the backfill will do, lead by lead.
--    `will_capture` rows become applications with the mapped status;
--    `conflict` rows already have a paid opportunity and are left alone.
select l.id, l.created_at, l.status::text as lead_status, l.form_type, l.source, l.company, l.name,
       case
         when exists (select 1 from opportunities o where o.lead_id = l.id) then 'conflict'
         else 'will_capture'
       end as outcome,
       case l.status::text
         when 'new' then 'applied' when 'contacted' then 'review'
         when 'qualified' then 'consultation' when 'proposal' then 'consultation'
         when 'won' then 'accepted' else 'rejected'
       end as mapped_status
from leads l
where l.form_type = 'impact'
   or (l.form_type is null and lower(btrim(coalesce(l.source, ''))) = 'impact')
order by l.created_at;

-- 4. The conflicts in detail: each paid opportunity on an Impact lead, and the
--    projects hanging off it. Nothing here is changed by the migration.
select l.id as lead_id, l.company, o.id as opportunity_id, o.title, o.stage::text, o.estimated_value,
       (select array_agg(p.id) from projects p where p.opportunity_id = o.id) as project_ids
from opportunities o
left join leads l on l.id = o.lead_id
where o.form_type = 'impact'
   or l.form_type = 'impact'
   or (l.form_type is null and lower(btrim(coalesce(l.source, ''))) = 'impact')
order by l.created_at;

-- 5. Ambiguous rows the migration deliberately does NOT classify: they mention
--    Impact in free text but did not come through the Impact form by any
--    recorded fact. Review by hand; nothing moves them.
select id, created_at, form_type, source, service_interest, company
from leads
where (service_interest ilike '%impact%' or source ilike '%impact%')
  -- coalesce: with a NULL form_type the test is NULL, and `not NULL` would
  -- silently drop exactly the legacy rows this query exists to show.
  and not coalesce(form_type = 'impact'
           or (form_type is null and lower(btrim(coalesce(source, ''))) = 'impact'), false)
order by created_at;

-- 6. project_links rows (the old check made every insert fail, so this should
--    be 0; the fix in 20260929000100 validates immediately).
select count(*) as project_links_rows from project_links;

-- 7. Projects by status, so `cancelled` has nothing to collide with.
select status::text, count(*) from projects group by 1 order by 1;

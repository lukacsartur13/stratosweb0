-- =============================================================================
-- Documents — PREFLIGHT. Read-only. Run in the Supabase SQL editor BEFORE
-- applying 20260930000100_document_library.sql.
--
-- Every statement is a SELECT. Nothing writes.
-- =============================================================================

-- 1. What the migration requires. Any `false` stops the plan: the migration
--    refuses to run without the first four.
select 'owner designated and super_admin' as requirement, coalesce((
  select p.role = 'super_admin' from portal_owner o join profiles p on p.id = o.user_id), false) as ok
union all
select 'lockdown: projects_owner_all is the only projects policy',
  exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'projects' and policyname = 'projects_owner_all')
  and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'projects' and policyname <> 'projects_owner_all')
union all
select 'impact applied: projects.program exists', exists (select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'projects' and column_name = 'program')
union all
select 'storage schema present', to_regclass('storage.objects') is not null and to_regclass('storage.buckets') is not null
union all
select 'storage.objects has RLS enabled', coalesce((select c.relrowsecurity from pg_class c
  join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'storage' and c.relname = 'objects'), false)
union all
select 'no bucket called project-documents yet (or it is private)',
  not exists (select 1 from storage.buckets where id = 'project-documents' and public)
order by 1;

-- 2. EVERY policy on storage.objects today. The migration adds restrictive
--    guards, so a broad policy here cannot open the document bucket — but a
--    policy that does not pin `bucket_id` is worth knowing about for the
--    buckets it does open.
select policyname, permissive, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
order by policyname;

-- 3. Existing buckets and whether any is public.
select id, public, file_size_limit, allowed_mime_types from storage.buckets order by id;

-- 4. Anything already stored under the name this bucket will use (should be
--    empty). Objects here before the migration would be reported as orphans.
select count(*) as objects_already_in_bucket
from storage.objects where bucket_id = 'project-documents';

-- 5. The grants `authenticated` holds on storage.objects. Supabase grants
--    select/insert/update/delete by default; the policies decide the rest.
select privilege_type from information_schema.role_table_grants
where table_schema = 'storage' and table_name = 'objects' and grantee = 'authenticated'
order by 1;

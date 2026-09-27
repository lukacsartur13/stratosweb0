-- =============================================================================
-- Documents — VERIFY. Run in the Supabase SQL editor AFTER
-- 20260930000100_document_library.sql.
--
-- Impersonates the owner and every other account the way PostgREST and Storage
-- do (`set local role authenticated` + `request.jwt.claims`) inside ONE
-- transaction that ends in ROLLBACK, so nothing it does persists — including
-- the test folder and pending upload it creates. Every row should read `ok`.
-- It uploads no bytes and creates no storage object.
-- =============================================================================

begin;

create temp table verify_result (check_name text, ok boolean, detail text) on commit drop;
grant insert, select on verify_result to authenticated;

-- ------------------------------------------------------------ structure
insert into verify_result
select 'bucket exists and is private',
       coalesce((select not public from storage.buckets where id = 'project-documents'), false),
       (select format('file_size_limit = %s', file_size_limit) from storage.buckets where id = 'project-documents')
union all
select 'bucket accepts only application/octet-stream',
       coalesce((select allowed_mime_types = array['application/octet-stream'] from storage.buckets where id = 'project-documents'), false), null
union all
select 'bucket size limit equals document_max_bytes()',
       coalesce((select file_size_limit = document_max_bytes() from storage.buckets where id = 'project-documents'), false), null
union all
select 'restrictive guards on storage.objects (4)',
       (select count(*) = 4 from pg_policies where schemaname = 'storage' and tablename = 'objects'
          and policyname like 'project_documents_guard_%' and permissive = 'RESTRICTIVE'), null
union all
select 'no permissive update/delete policy names this bucket',
       not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                   and permissive = 'PERMISSIVE' and cmd in ('UPDATE', 'DELETE', 'ALL')
                   and coalesce(qual, '') || coalesce(with_check, '') like '%project-documents%'), null
union all
select 'no-overwrite trigger on storage.objects',
       exists (select 1 from pg_trigger where tgname = 'project_documents_no_overwrite'
               and tgrelid = 'storage.objects'::regclass and not tgisinternal), null
union all
select 'only owner policies on the library tables',
       -- Phase 4 (20261001000100_client_portal.sql) adds one policy per table
       -- for the role that OWNS the client functions (never an API role), so
       -- that they work with or without BYPASSRLS. Anything else is a finding.
       not exists (select 1 from pg_policies where schemaname = 'public'
                   and tablename in ('project_documents', 'document_folders')
                   and policyname not in ('project_documents_owner_all', 'document_folders_owner_all')
                   and not (policyname in ('project_documents_definer_all', 'document_folders_definer_all')
                            and cardinality(roles) = 1
                            and roles[1] not in ('public', 'anon', 'authenticated'))),
       (select string_agg(policyname || ' ' || roles::text, ', ') from pg_policies where schemaname = 'public'
          and tablename in ('project_documents', 'document_folders')
          and policyname not in ('project_documents_owner_all', 'document_folders_owner_all'))
union all
select 'no DELETE grant to API roles',
       not has_table_privilege('authenticated', 'project_documents', 'delete')
       and not has_table_privilege('authenticated', 'document_folders', 'delete')
       and not has_table_privilege('anon', 'project_documents', 'select'), null
union all
select 'no API-callable definer function reads the library (the phase-4 client_* functions excepted)',
       not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.prosecdef and p.prorettype <> 'trigger'::regtype
                     and p.proname not like 'client\_%'
                     and p.prosrc ~* '\m(project_documents|document_folders)\M'), null;

-- The true totals, as the SQL editor's own role.
create temp table verify_totals on commit drop as
select (select count(*) from project_documents) as documents,
       (select count(*) from storage.objects where bucket_id = 'project-documents') as objects,
       (select id from projects order by created_at limit 1) as some_project;
grant select on verify_totals to authenticated;

-- ------------------------------------------------------------ as the owner
select set_config('request.jwt.claims',
  json_build_object('sub', (select user_id from portal_owner), 'role', 'authenticated')::text, true);
set local role authenticated;

insert into verify_result
select 'owner reads every document',
       (select count(*) from project_documents) = (select documents from verify_totals), null
union all
select 'owner reads every stored object',
       (select count(*) from storage.objects where bucket_id = 'project-documents') = (select objects from verify_totals), null;

-- A pending upload and a folder, rolled back at the end.
do $$
declare
  p uuid := (select some_project from verify_totals);
  d record;
begin
  if p is null then
    insert into verify_result values ('owner can start an upload', true, 'skipped: no project exists');
    return;
  end if;
  select * into d from document_begin_upload(p, null, 'verify-check.txt', 1, 'text/plain', 'text');
  insert into verify_result values ('owner can start an upload', d.storage_path = p::text || '/' || d.id::text, d.storage_path);
  insert into verify_result values ('finish without an object leaves it pending',
    document_finish_upload(d.id) = 'missing', null);
  insert into document_folders (project_id, name) values (p, 'verify-check-folder');
  insert into verify_result values ('owner can create a folder', true, null);
end $$;

reset role;

-- ------------------------------------------------------------ as everyone else
do $$
declare
  u record;
  n_docs bigint;
  n_objs bigint;
  refused boolean;
begin
  for u in
    select p.id, p.email, p.role from profiles p
    where p.id <> (select user_id from portal_owner)
    order by p.role, p.email
    limit 50
  loop
    perform set_config('request.jwt.claims', json_build_object('sub', u.id, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    -- A named owner delegate (phase 6) has the owner's rights by design; it is
    -- checked by owner-delegates-verify.sql, not here.
    if is_owner() then
      execute 'reset role';
      insert into verify_result values (format('%s (%s) has owner rights — see owner-delegates-verify.sql', u.email, u.role), true, null);
      continue;
    end if;
    select count(*) into n_docs from project_documents;
    select count(*) into n_objs from storage.objects where bucket_id = 'project-documents';
    begin
      perform document_begin_upload((select some_project from verify_totals), null, 'x.txt', 1, null, 'text');
      refused := false;
    exception when insufficient_privilege then
      refused := true;
    end;
    execute 'reset role';
    insert into verify_result values (format('%s (%s) sees no document, no object, cannot upload', u.email, u.role),
      n_docs = 0 and n_objs = 0 and refused, format('documents %s, objects %s', n_docs, n_objs));
  end loop;

  perform set_config('request.jwt.claims', '{}', true);
  execute 'set local role anon';
  select count(*) into n_objs from storage.objects where bucket_id = 'project-documents';
  begin
    select count(*) into n_docs from project_documents;
    refused := false;
  exception when insufficient_privilege then
    refused := true;
  end;
  execute 'reset role';
  insert into verify_result values ('anon: no table access, no object', refused and n_objs = 0, null);
end $$;

select * from verify_result order by ok, check_name;

rollback;

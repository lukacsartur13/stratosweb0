-- =============================================================================
-- Client portal (phase 4) — VERIFY. Run in the Supabase SQL editor AFTER
-- 20261001000100_client_portal.sql.
--
-- Impersonates the owner and EVERY other profile the way PostgREST and Storage
-- do, inside one transaction that ends in ROLLBACK. Nothing persists, no auth
-- user is created, no object is written. Every row should read `ok`.
-- =============================================================================

begin;

create temp table verify_result (check_name text, ok boolean, detail text) on commit drop;
grant insert, select on verify_result to authenticated, anon;

-- ------------------------------------------------------------ structure
insert into verify_result
select 'phase-4 tables force RLS',
       (select bool_and(c.relrowsecurity and c.relforcerowsecurity) from pg_class c
        where c.relname in ('client_accounts', 'client_project_access', 'document_shares', 'client_invite_log')
          and c.relnamespace = 'public'::regnamespace), null
union all
select 'no DELETE on phase-4 tables for API roles',
       not exists (select 1 from unnest(array['client_accounts', 'client_project_access', 'document_shares', 'client_invite_log']) t
                   where has_table_privilege('authenticated', t, 'delete') or has_table_privilege('anon', t, 'select')), null
union all
select 'definer functions reading projects or the library are exactly the client API',
       (select coalesce(array_agg(p.proname::text order by p.proname), '{}') from pg_proc p
        where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.prorettype <> 'trigger'::regtype
          and p.prosrc ~* '\m(projects|project_milestones|project_costs|project_links|impact_applications|project_documents|document_folders|document_shares|client_project_access|client_accounts)\M')
       = (select array_agg(x order by x) from unnest(
           array['client_account_id', 'client_begin_upload', 'client_finish_upload', 'client_has_project', 'client_mark_upload',
                 'client_may_read_document', 'client_may_read_object', 'client_may_upload_object', 'client_own_upload',
                 'client_portal_documents', 'client_portal_me', 'client_portal_projects', 'client_portal_uploads']
           -- phase 7 (20261004000100), when applied: the same client rules
           || case when to_regprocedure('public.client_portal_demos()') is not null
                   then array['client_portal_demos', 'client_portal_meetings'] else '{}'::text[] end) x),
       null
union all
select 'client storage policies present',
       (select count(*) = 2 from pg_policies where schemaname = 'storage' and tablename = 'objects'
          and policyname in ('project_documents_client_select', 'project_documents_client_insert')), null
union all
select 'no permissive update/delete policy names the bucket',
       not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                   and permissive = 'PERMISSIVE' and cmd in ('UPDATE', 'DELETE', 'ALL')
                   and coalesce(qual, '') || coalesce(with_check, '') like '%project-documents%'), null
union all
select 'every linked account''s profile is a client of the same company',
       not exists (select 1 from client_accounts a join profiles p on p.id = a.user_id
                   where p.role <> 'client' or p.organization_id is distinct from a.organization_id),
       (select string_agg(a.email, ', ') from client_accounts a join profiles p on p.id = a.user_id
        where p.role <> 'client' or p.organization_id is distinct from a.organization_id)
union all
select 'every live assignment is a project of the account''s company',
       not exists (select 1 from client_project_access x join client_accounts a on a.id = x.account_id
                   join projects p on p.id = x.project_id
                   where x.revoked_at is null and p.organization_id <> a.organization_id), null
union all
select 'a revoked account holds no live assignment',
       not exists (select 1 from client_project_access x join client_accounts a on a.id = x.account_id
                   where x.revoked_at is null and a.status = 'revoked'), null
union all
select 'no live share without a live assignment',
       not exists (select 1 from document_shares s where s.revoked_at is null and not exists (
                     select 1 from client_project_access x where x.account_id = s.account_id
                       and x.project_id = s.project_id and x.revoked_at is null)), null;

create temp table verify_expect on commit drop as
select a.user_id,
       (select count(*) from client_project_access x where x.account_id = a.id and x.revoked_at is null) as projects
from client_accounts a join profiles p on p.id = a.user_id
where a.status = 'active' and p.role = 'client';
grant select on verify_expect to authenticated;

-- ------------------------------------------------------------ as everyone
do $$
declare
  owner_like boolean;
  u record;
  n bigint;
  internal bigint;
  expected bigint;
  refused boolean;
begin
  for u in select p.id, p.email, p.role from profiles p order by p.role, p.email limit 200 loop
    perform set_config('request.jwt.claims', json_build_object('sub', u.id, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    owner_like := is_owner();

    select count(*) into n from client_portal_projects();
    select coalesce((select projects from verify_expect where user_id = u.id), 0) into expected;
    internal := 0;
    if u.role = 'client' then
      internal := (select count(*) from projects) + (select count(*) from project_documents)
                + (select count(*) from document_folders) + (select count(*) from project_milestones)
                + (select count(*) from client_accounts) + (select count(*) from document_shares);
    end if;
    begin
      perform * from client_invite_prepare(gen_random_uuid(), null, 'verify', 'verify@example.invalid', '{}');
      refused := false;
    exception when insufficient_privilege then
      refused := true;
    when others then
      refused := false;
    end;
    execute 'reset role';

    -- The owner, or a named owner delegate (phase 6): owner rights by design.
    if u.id = (select user_id from portal_owner) or owner_like then
      insert into verify_result values ('owner: may invite; is not a client', not refused and n = 0, null);
    else
      insert into verify_result values (
        format('%s (%s): client API = own assignments, no internal rows, cannot invite', u.email, u.role),
        n = expected and internal = 0 and refused,
        format('projects %s (expected %s), internal rows %s', n, expected, internal));
    end if;
  end loop;

  perform set_config('request.jwt.claims', '{}', true);
  execute 'set local role anon';
  begin
    perform * from client_portal_projects();
    refused := false;
  exception when insufficient_privilege then
    refused := true;
  end;
  select count(*) into n from storage.objects where bucket_id = 'project-documents';
  execute 'reset role';
  insert into verify_result values ('anon: no client API, no object', refused and n = 0, null);
end $$;

select * from verify_result order by ok, check_name;

rollback;

-- =============================================================================
-- Client portal (phase 4) — ROLLBACK of 20261001000100_client_portal.sql.
--
-- Closes every CLIENT path and keeps every row, account and file:
--
--   * the client storage policies are dropped and the bucket's guards and the
--     owner's insert policy are put back exactly as 20260930000100 left them
--     (owner-only)
--   * every client_* function is revoked from the API roles, so the client
--     screens get "permission denied" and read nothing
--
-- NOT deleted, NOT changed: client_accounts, client_project_access,
-- document_shares, client_invite_log, the raw-material folders and every
-- document in them, every stored object, every auth user and profile (a
-- client's profile keeps its organization). The owner's library keeps working.
-- The triggers stay: they only guard the data that stays.
--
-- Re-applying 20261001000100_client_portal.sql restores the client paths
-- exactly (tested in tests/portal-client-db.spec.ts).
-- =============================================================================

drop policy if exists project_documents_client_select  on storage.objects;
drop policy if exists project_documents_client_insert  on storage.objects;
drop policy if exists project_documents_definer_select on storage.objects;
drop policy if exists project_documents_guard_select   on storage.objects;
drop policy if exists project_documents_guard_insert   on storage.objects;
drop policy if exists project_documents_owner_insert   on storage.objects;

create policy project_documents_owner_insert on storage.objects
  as permissive for insert to authenticated
  with check (
    bucket_id = 'project-documents'
    and public.is_owner()
    and exists (select 1 from public.project_documents d
                where d.storage_path = objects.name and d.upload_state = 'pending' and d.trashed_at is null)
  );

create policy project_documents_guard_select on storage.objects
  as restrictive for select
  using (bucket_id <> 'project-documents' or public.is_owner());

create policy project_documents_guard_insert on storage.objects
  as restrictive for insert
  with check (
    bucket_id <> 'project-documents'
    or (public.is_owner()
        and exists (select 1 from public.project_documents d
                    where d.storage_path = objects.name and d.upload_state = 'pending' and d.trashed_at is null))
  );

do $$
declare
  f text;
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      foreach f in array array[
        'client_account_id()', 'client_has_project(uuid)', 'client_may_read_document(uuid)',
        'client_may_read_object(text)', 'client_may_upload_object(text)',
        'client_portal_me()', 'client_portal_projects()', 'client_portal_documents()', 'client_portal_uploads()',
        'client_begin_upload(uuid, text, bigint, text, text)', 'client_finish_upload(uuid)',
        'client_mark_upload(uuid, text, text)', 'client_own_upload(uuid)',
        'client_invite_prepare(uuid, uuid, text, text, uuid[])', 'client_invite_attach(uuid, uuid)'
      ] loop
        execute format('revoke all on function %s from %I', f, r);
      end loop;
    end if;
  end loop;
end $$;

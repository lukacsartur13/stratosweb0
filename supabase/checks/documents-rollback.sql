-- =============================================================================
-- Documents — ROLLBACK of 20260930000100_document_library.sql.
--
-- Closes every API path to the library and KEEPS every row and every stored
-- object. It does not drop the tables, the bucket or any file: those are the
-- owner's documents, and removing them is a decision, not a rollback.
--
--   * the owner's permissive storage policies are dropped
--   * the four restrictive guards are REPLACED by one that refuses every
--     operation in this bucket — so a broad policy written for another bucket
--     cannot open it once the owner's policies are gone
--   * table grants and function grants are revoked from the API roles
--
-- Re-applying the migration afterwards restores access exactly (tested in
-- tests/portal-documents-db.spec.ts).
-- =============================================================================

-- The no-overwrite trigger (project_documents_no_overwrite) STAYS: it only
-- protects the stored bytes this rollback keeps.
drop policy if exists project_documents_owner_select on storage.objects;
drop policy if exists project_documents_owner_insert on storage.objects;
drop policy if exists project_documents_guard_select on storage.objects;
drop policy if exists project_documents_guard_insert on storage.objects;
drop policy if exists project_documents_guard_update on storage.objects;
drop policy if exists project_documents_guard_delete on storage.objects;
drop policy if exists project_documents_sealed on storage.objects;

create policy project_documents_sealed on storage.objects
  as restrictive for all
  using (bucket_id <> 'project-documents')
  with check (bucket_id <> 'project-documents');

update storage.buckets set public = false where id = 'project-documents';

do $$
declare
  f text;
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table document_folders, project_documents from %I', r);
      foreach f in array array[
        'document_object_size(text)', 'document_lock(uuid)',
        'document_free_name(uuid, uuid, text, uuid, text)',
        'document_begin_upload(uuid, uuid, text, bigint, text, text)', 'document_finish_upload(uuid)',
        'document_move(uuid, uuid)', 'document_restore_folder_chain(uuid)', 'document_restore(uuid)',
        'document_trash_folder(uuid)', 'document_restore_folder(uuid)',
        'document_reconcile()', 'document_storage_report()'
      ] loop
        execute format('revoke all on function %s from %I', f, r);
      end loop;
    end if;
  end loop;
end $$;

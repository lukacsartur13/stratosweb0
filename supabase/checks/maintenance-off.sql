-- =============================================================================
-- Maintenance gate OFF — the Portal's API accepts writes again.
-- Run in the Supabase SQL editor at the END of the release window
-- (PORTAL_RELEASE.md §4, step 26), and in any rollback.
-- =============================================================================

alter role authenticator reset pgrst.db_pre_request;
select pg_notify('pgrst', 'reload config');
-- The function is NOT dropped here: PostgREST reloads its config a moment
-- after the notification, and a request in that moment would still call it.
-- Unused, it does nothing; drop it later with
--   drop function if exists public.portal_maintenance_gate();

-- Expect NO row.
select c as still_set from pg_roles r, unnest(coalesce(r.rolconfig, '{}')) c
where r.rolname = 'authenticator' and c like 'pgrst.db_pre_request=%';

-- =============================================================================
-- Maintenance gate ON — the Portal's API becomes READ-ONLY for signed-in users.
-- Run in the Supabase SQL editor at the START of the release window
-- (PORTAL_RELEASE.md §4, step 2b). Undo: maintenance-off.sql.
--
-- How it works: PostgREST calls a "pre-request" function before every API
-- request (`pgrst.db_pre_request` on the `authenticator` role). This one marks
-- the transaction read-only when the caller is a signed-in user
-- (`authenticated`). So during the switch:
--
--   * every Portal write (old or new Portal, any account, any table or RPC)
--     is refused with 25006 "read-only transaction" — nothing half-migrated
--     can be written, whoever clicks what;
--   * every read still works: people can look, not change;
--   * the public lead form keeps storing leads — it writes with the server key
--     (the server role), which this does not touch;
--   * the SQL editor (role postgres) is not an API request: migrations run.
--
-- Tested on a local Supabase stack (scripts/local-supabase-release.mjs).
-- NOT covered: Supabase Storage and Auth are separate services and are not
-- gated. During the window no Portal code writes to Storage (the document
-- bucket does not exist before step 16 and the old Portal has no library), and
-- sign-in must keep working anyway.
-- =============================================================================

do $$
declare
  existing text;
begin
  select split_part(c, '=', 2) into existing
  from pg_roles r, unnest(coalesce(r.rolconfig, '{}')) c
  where r.rolname = 'authenticator' and c like 'pgrst.db_pre_request=%';
  if existing is not null and existing <> 'public.portal_maintenance_gate' then
    raise exception 'A pre-request function is already configured (%). Stop: combine it with the gate by hand, do not overwrite it.', existing;
  end if;
end $$;

create or replace function public.portal_maintenance_gate() returns void
  language plpgsql
  set search_path = public
as $$
begin
  -- Visible on every API response while the gate is on, so it can be checked
  -- from outside with the public key alone: X-Stratos-Maintenance: on
  perform set_config('response.headers', '[{"X-Stratos-Maintenance": "on"}]', true);
  if current_user = 'authenticated' then
    perform set_config('transaction_read_only', 'on', true);
  end if;
end;
$$;

comment on function public.portal_maintenance_gate is
  'Release window only: makes every signed-in API request read-only. Removed by maintenance-off.sql.';

-- Executable by every API role through Postgres' default PUBLIC grant on
-- functions: PostgREST calls it as whichever role the request uses.

alter role authenticator set pgrst.db_pre_request = 'public.portal_maintenance_gate';
select pg_notify('pgrst', 'reload config');

-- Expect one row: pgrst.db_pre_request=public.portal_maintenance_gate
select c as active_setting from pg_roles r, unnest(r.rolconfig) c
where r.rolname = 'authenticator' and c like 'pgrst.db_pre_request=%';

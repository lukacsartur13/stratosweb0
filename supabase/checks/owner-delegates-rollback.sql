-- =============================================================================
-- Owner delegates (phase 6) — ROLLBACK of 20261003000100_owner_delegates.sql.
-- Restores the phase-1 is_owner(): only the designated owner, while a
-- super_admin. The delegate list is KEPT (re-applying the migration restores
-- the delegates' access exactly); nothing else is changed or deleted.
-- =============================================================================

create or replace function is_owner()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select p.role = 'super_admin'
    from portal_owner o
    join profiles p on p.id = o.user_id
    where o.user_id = auth.uid()
  ), false)
$$;

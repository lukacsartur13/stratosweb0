-- =============================================================================
-- Stratos — phase 6: named owner delegates
--
-- Decision of 2026-09-28 (the business owner): one named ADMIN account gets the
-- same rights as the portal owner — projects, checkpoints, costs, the payment
-- schedule, Impact, the document library, client accounts and sharing. Named,
-- not by role: giving someone the `admin` role later does NOT give them
-- projects.
--
-- How: every owner-only rule in phases 1–5 (row policies, storage policies,
-- the owner functions, the Portal's navigation) asks ONE function,
-- `is_owner()`. It now answers true for
--
--   * the designated owner (`portal_owner`), while a `super_admin` — unchanged;
--   * an account listed in `portal_owner_delegates`, while its role is
--     `admin` or `super_admin` (demote it and the access closes, as for the
--     owner).
--
-- Nothing else changes: no policy is rewritten, so there is no second path to
-- keep in step. The delegate list, like `portal_owner`, has no API access at
-- all; it is managed only from the SQL editor:
--
--   select portal_add_delegate('<email>');
--   select portal_remove_delegate('<email>');
--
-- Undo: supabase/checks/owner-delegates-rollback.sql (restores the phase-1
-- function; keeps the list).
-- Run after 20261002000100_payment_schedule.sql.
-- =============================================================================

do $$
begin
  if not exists (select 1 from portal_owner o join profiles p on p.id = o.user_id where p.role = 'super_admin') then
    raise exception 'No portal owner who is a super_admin is designated.';
  end if;
  if current_user in ('anon', 'authenticated') then
    raise exception 'Run this migration from the SQL editor, not as an API role.';
  end if;
end $$;

create table if not exists portal_owner_delegates (
  user_id    uuid primary key references profiles(id) on delete cascade,
  granted_at timestamptz not null default now(),
  note       text check (note is null or length(note) <= 200)
);

alter table portal_owner_delegates enable row level security;
alter table portal_owner_delegates force  row level security;
-- No policy and no grant: not readable or writable through the API by anyone.
do $$
declare r text;
begin
  execute 'revoke all on table portal_owner_delegates from public';
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table portal_owner_delegates from %I', r);
    end if;
  end loop;
end $$;

comment on table portal_owner_delegates is
  'Accounts with the owner''s rights while admin/super_admin. SQL editor only (portal_add_delegate / portal_remove_delegate).';

-- The one function every owner rule asks. Same signature, volatility and
-- rights as before, so every policy and grant keeps working unchanged.
create or replace function is_owner()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select p.role = 'super_admin'
    from portal_owner o
    join profiles p on p.id = o.user_id
    where o.user_id = auth.uid()
  ), false)
  or exists (
    select 1
    from portal_owner_delegates d
    join profiles p on p.id = d.user_id
    where d.user_id = auth.uid() and p.role in ('admin', 'super_admin')
  )
$$;

comment on function is_owner is
  'True for the designated owner while super_admin, and for a listed delegate while admin or super_admin.';

create or replace function portal_add_delegate(p_email text, p_note text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  hits integer;
  target profiles%rowtype;
begin
  select count(*) into hits from profiles where lower(btrim(email)) = lower(btrim(p_email));
  if hits = 0 then raise exception 'No profile has the email %. The account must sign in once first.', p_email; end if;
  if hits > 1 then raise exception 'More than one profile has the email %.', p_email; end if;
  select * into target from profiles where lower(btrim(email)) = lower(btrim(p_email));
  if target.role not in ('admin', 'super_admin') then
    raise exception 'The account % is %, not admin or super_admin.', p_email, target.role;
  end if;
  if exists (select 1 from portal_owner where user_id = target.id) then
    raise exception 'The account % is already the owner.', p_email;
  end if;
  insert into portal_owner_delegates (user_id, note) values (target.id, p_note)
  on conflict (user_id) do update set note = coalesce(excluded.note, portal_owner_delegates.note);
  insert into activity_logs (user_id, action, entity_type, entity_id, metadata)
  values (null, 'portal.owner_delegate_added', 'portal', target.id, jsonb_build_object('email', target.email));
  return target.id;
end;
$$;

create or replace function portal_remove_delegate(p_email text)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  gone uuid;
begin
  delete from portal_owner_delegates d
   using profiles p
   where p.id = d.user_id and lower(btrim(p.email)) = lower(btrim(p_email))
  returning d.user_id into gone;
  if gone is not null then
    insert into activity_logs (user_id, action, entity_type, entity_id, metadata)
    values (null, 'portal.owner_delegate_removed', 'portal', gone, jsonb_build_object('email', p_email));
  end if;
  return gone is not null;
end;
$$;

comment on function portal_add_delegate is 'SQL editor only. Gives a named admin the owner''s rights.';
comment on function portal_remove_delegate is 'SQL editor only. Ends a delegate''s owner rights.';

do $$
declare r text;
begin
  execute 'revoke all on function portal_add_delegate(text, text) from public';
  execute 'revoke all on function portal_remove_delegate(text) from public';
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function portal_add_delegate(text, text) from %I', r);
      execute format('revoke all on function portal_remove_delegate(text) from %I', r);
      execute format('grant execute on function is_owner() to %I', r);
    end if;
  end loop;
end $$;

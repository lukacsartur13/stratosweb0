-- =============================================================================
-- Stratos — notifications for every admin, not only the owner
--
-- Owner decision of 2026-10-05: an admin gets the same notifications as the
-- owner (push to their devices and an e-mail) and sets them up the same way,
-- in Settings.
--
--   1. recipients           an 'owner' message goes to the portal owner AND
--                           every super_admin / admin profile
--   2. notification_prefs   per person: e-mails on or off (push is per device,
--                           in the browser). Default: on.
--   3. a test               any admin may send one — to themselves only
--                           (payload.only = their id)
--
-- Run after 20261013000100_notifications.sql. Re-runnable.
-- =============================================================================

do $$
begin
  if to_regclass('public.notification_outbox') is null then
    raise exception '20261013000100_notifications.sql is not applied.';
  end if;
  if current_user in ('anon', 'authenticated') then
    raise exception 'Run this migration from the SQL editor, not as an API role.';
  end if;
end $$;

create table if not exists notification_prefs (
  user_id    uuid primary key references profiles(id) on delete cascade default auth.uid(),
  email      boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table notification_prefs enable row level security;
alter table notification_prefs force row level security;
drop policy if exists notification_prefs_own on notification_prefs;
create policy notification_prefs_own on notification_prefs
  for all using (user_id = auth.uid() and is_admin()) with check (user_id = auth.uid() and is_admin());

-- A test, by any admin, to themselves.
drop policy if exists notification_outbox_staff_test on notification_outbox;
create policy notification_outbox_staff_test on notification_outbox
  for insert with check (
    is_admin() and audience = 'owner' and kind = 'test' and payload->>'only' = auth.uid()::text
    and sent_at is null and attempts = 0 and claimed_at is null);

-- Same as 20261013000100, except who an 'owner' message reaches: the owner and
-- every admin (a test only the person named in payload.only), each with their
-- e-mail preference.
create or replace function notification_claim(p_limit integer default 50)
returns table (
  id uuid, audience text, kind text, payload jsonb, created_at timestamptz,
  project_id uuid, project_name text, client_name text, recipients jsonb
)
  language sql volatile security invoker set search_path = public
as $$
  with picked as (
    select o.id from notification_outbox o
    where o.sent_at is null and o.attempts < 5
      and (o.claimed_at is null or o.claimed_at < now() - interval '5 minutes')
    order by o.created_at
    limit greatest(1, least(p_limit, 200))
    for update skip locked
  ), claimed as (
    update notification_outbox o set claimed_at = now(), attempts = o.attempts + 1
    from picked where o.id = picked.id
    returning o.*
  )
  select c.id, c.audience, c.kind, c.payload, c.created_at, c.project_id, p.name, org.name,
    case c.audience
      when 'owner' then (
        select coalesce(jsonb_agg(jsonb_build_object('user_id', pr.id, 'email', pr.email,
                                                     'name', coalesce(pr.full_name, pr.email), 'locale', pr.locale,
                                                     'email_on', coalesce(np.email, true)) order by pr.created_at), '[]'::jsonb)
        from profiles pr
        left join notification_prefs np on np.user_id = pr.id
        where (pr.role in ('super_admin', 'admin') or pr.id in (select po.user_id from portal_owner po))
          and (c.payload->>'only' is null or pr.id::text = c.payload->>'only'))
      else (
        select coalesce(jsonb_agg(jsonb_build_object('user_id', a.user_id, 'email', a.email,
                                                     'name', a.full_name, 'locale', coalesce(pr.locale, 'hu'))), '[]'::jsonb)
        from client_accounts a
        join client_project_access x on x.account_id = a.id and x.project_id = c.project_id and x.revoked_at is null
        left join profiles pr on pr.id = a.user_id
        where a.status = 'active' and a.user_id is not null
          and (c.account_ids is null or a.id = any (c.account_ids)))
    end
  from claimed c
  left join projects p on p.id = c.project_id
  left join organizations org on org.id = p.organization_id
$$;

do $$
begin
  execute 'revoke all on table notification_prefs from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table notification_prefs from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant select, insert, update on table notification_prefs to authenticated';
  end if;
  -- create or replace keeps the grants of 20261013000100 (server key only).
end $$;

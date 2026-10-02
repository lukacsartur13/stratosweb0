-- =============================================================================
-- Stratos — the Trash: delete projects, clients and leads from the Portal
--
-- Deleting is two steps, on purpose:
--
--   1. MOVE TO TRASH  the record disappears from every list, total and screen,
--                     and can be restored. Projects and clients use the
--                     `archived_at` they already have; leads gain `trashed_at`.
--                     A plain column write under the existing policies.
--   2. DELETE         from the Trash only, permanently, through one function
--                     per kind. It refuses while anything that must not vanish
--                     silently hangs off the record — money, files, client
--                     portal access, sales deals — and says what, in
--                     `stratos:purge_blocked` (detail = the list).
--
--   3. hiding         a project in the Trash is hidden from its client portal
--                     too (`client_has_project`, `client_portal_projects`);
--                     restoring it gives the access back unchanged
--   4. figures        a lead in the Trash no longer counts in the source →
--                     lead → won attribution; an Impact project in the Trash
--                     no longer counts as committed or delivered support
--
-- Nothing is deleted by this migration. Run after
-- 20261006000100_monthly_contracts.sql.
-- =============================================================================


-- ###########################################################################
-- 0. PRECONDITIONS
-- ###########################################################################

do $$
begin
  if to_regprocedure('public.client_has_project(uuid)') is null then
    raise exception 'The client portal (20261001000100_client_portal.sql) is not applied.';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'projects' and column_name = 'billing') then
    raise exception 'The monthly contracts migration (20261006000100_monthly_contracts.sql) is not applied.';
  end if;
  if current_user in ('anon', 'authenticated') then
    raise exception 'Run this migration from the SQL editor, not as an API role.';
  end if;
end $$;


-- ###########################################################################
-- 1. LEADS GET A TRASH
-- ###########################################################################

alter table leads add column if not exists trashed_at timestamptz;
create index if not exists leads_live_created_idx on leads (created_at desc) where trashed_at is null;

comment on column leads.trashed_at is
  'Set = in the Portal''s Trash: hidden from every list and figure, restorable. Permanent deletion is purge_lead().';


-- ###########################################################################
-- 2. WHAT STOPS A PERMANENT DELETE
-- ###########################################################################

-- Human-readable, one entry per kind of thing in the way; empty = may be
-- deleted; NULL for anyone who may not delete it.
--
-- SECURITY INVOKER, like the purge functions below: the only definer functions
-- allowed to read projects and the document library are the client portal's
-- (tests/portal-client-db.spec.ts, supabase/checks/documents-verify.sql). The
-- owner's RLS shows every row counted here; an admin's RLS hides an Impact
-- application, and the foreign key still refuses that delete (said in words by
-- the Portal).
create or replace function project_purge_blockers(p_id uuid) returns text[]
  language sql stable security invoker set search_path = public
as $$
  select case when not is_owner() then null else (
  select coalesce(array_agg(b) filter (where b is not null), '{}') from (values
    ((select case when count(*) > 0 then count(*) || ' instalment(s) in the payment schedule' end
        from project_instalments where project_id = p_id)),
    ((select case when count(*) > 0 then count(*) || ' document(s), including the document trash' end
        from project_documents where project_id = p_id)),
    ((select case when count(*) > 0 then count(*) || ' document folder(s)' end
        from document_folders where project_id = p_id)),
    ((select case when count(*) > 0 then 'client portal access (current or past)' end
        from client_project_access where project_id = p_id)),
    ((select case when count(*) > 0 then count(*) || ' demo link(s)' end
        from project_demos where project_id = p_id)),
    ((select case when count(*) > 0 then count(*) || ' meeting(s)' end
        from project_meetings where project_id = p_id)),
    ((select case when count(*) > 0 then 'an Impact application' end
        from impact_applications where project_id = p_id))
  ) as t(b)
  ) end
$$;

create or replace function client_purge_blockers(p_id uuid) returns text[]
  language sql stable security invoker set search_path = public
as $$
  select case when not is_owner() then null else (
  select coalesce(array_agg(b) filter (where b is not null), '{}') from (values
    ((select case when count(*) > 0 then count(*) || ' project(s), including the Trash — delete those first' end
        from projects where organization_id = p_id)),
    ((select case when count(*) > 0 then count(*) || ' client portal account(s)' end
        from client_accounts where organization_id = p_id)),
    ((select case when count(*) > 0 then count(*) || ' sales opportunit(ies)' end
        from opportunities where organization_id = p_id))
  ) as t(b)
  ) end
$$;

create or replace function lead_purge_blockers(p_id uuid) returns text[]
  language sql stable security invoker set search_path = public
as $$
  select case when not is_admin() then null else (
  select coalesce(array_agg(b) filter (where b is not null), '{}') from (values
    ((select case when count(*) > 0 then 'an Impact application (decided in the Impact pipeline)' end
        from impact_applications where lead_id = p_id))
  ) as t(b)
  ) end
$$;


-- ###########################################################################
-- 3. PERMANENT DELETE — from the Trash only
-- ###########################################################################

-- Each: right role → the row exists → it is in the Trash → nothing blocks →
-- delete. SECURITY INVOKER: the delete runs under the caller's own RLS, so the
-- function can never do what the caller could not. The row is locked first, so
-- a restore racing the delete waits for it.

create or replace function purge_project(p_id uuid) returns void
  language plpgsql security invoker set search_path = public
as $$
declare
  trashed  timestamptz;
  blockers text[];
begin
  if not is_owner() then
    raise exception 'stratos:purge_forbidden' using errcode = '42501';
  end if;
  select archived_at into trashed from projects where id = p_id for update;
  if not found then
    raise exception 'stratos:purge_missing' using errcode = 'P0001';
  end if;
  if trashed is null then
    raise exception 'stratos:purge_not_trashed' using errcode = 'P0001',
      hint = 'Move the project to the Trash first.';
  end if;
  blockers := project_purge_blockers(p_id);
  if cardinality(blockers) > 0 then
    raise exception 'stratos:purge_blocked' using errcode = 'P0001',
      detail = array_to_string(blockers, '; ');
  end if;
  -- Checkpoints, costs, links and members go with it (on delete cascade);
  -- its notes and the audit line: record_deleted() below.
  delete from projects where id = p_id;
end;
$$;

create or replace function purge_client(p_id uuid) returns void
  language plpgsql security invoker set search_path = public
as $$
declare
  trashed  timestamptz;
  blockers text[];
begin
  -- Owner only: whether a client still has projects is the owner's to know.
  if not is_owner() then
    raise exception 'stratos:purge_forbidden' using errcode = '42501';
  end if;
  select archived_at into trashed from organizations where id = p_id for update;
  if not found then
    raise exception 'stratos:purge_missing' using errcode = 'P0001';
  end if;
  if trashed is null then
    raise exception 'stratos:purge_not_trashed' using errcode = 'P0001',
      hint = 'Move the client to the Trash first.';
  end if;
  blockers := client_purge_blockers(p_id);
  if cardinality(blockers) > 0 then
    raise exception 'stratos:purge_blocked' using errcode = 'P0001',
      detail = array_to_string(blockers, '; ');
  end if;
  -- Contacts and media rows go with it (on delete cascade).
  delete from organizations where id = p_id;
end;
$$;

create or replace function purge_lead(p_id uuid) returns void
  language plpgsql security invoker set search_path = public
as $$
declare
  trashed  timestamptz;
  blockers text[];
begin
  -- Admins manage leads (leads_admin_write); the same people may delete one.
  if not is_admin() then
    raise exception 'stratos:purge_forbidden' using errcode = '42501';
  end if;
  select trashed_at into trashed from leads where id = p_id for update;
  if not found then
    raise exception 'stratos:purge_missing' using errcode = 'P0001';
  end if;
  if trashed is null then
    raise exception 'stratos:purge_not_trashed' using errcode = 'P0001',
      hint = 'Move the lead to the Trash first.';
  end if;
  blockers := lead_purge_blockers(p_id);
  if cardinality(blockers) > 0 then
    raise exception 'stratos:purge_blocked' using errcode = 'P0001',
      detail = array_to_string(blockers, '; ');
  end if;
  -- Lead notes go with it (on delete cascade); a sales opportunity made from
  -- it stays, without the link (on delete set null).
  delete from leads where id = p_id;
end;
$$;

-- Whatever path deletes a project, client or lead: its record notes go with
-- it (notes are keyed by type + id, with no foreign key to cascade), and one
-- audit line is written. A trigger, so it runs with the rights it needs
-- (notes by other authors, the insert-only audit log) without an API-callable
-- definer function. The lead's line names no person: deleting a lead is how
-- personal data is erased, and the log must not keep a copy.
create or replace function record_deleted() returns trigger
  language plpgsql security definer set search_path = public
as $$
declare
  kind text := case tg_table_name when 'projects' then 'project' when 'organizations' then 'client' else 'lead' end;
  detail jsonb;
begin
  if kind in ('project', 'client') then
    delete from record_notes where entity_type = kind and entity_id = old.id;
  end if;
  detail := case kind
    when 'project' then jsonb_build_object('name', old.name, 'billing', to_jsonb(old)->>'billing', 'program', to_jsonb(old)->>'program')
    when 'client'  then jsonb_build_object('name', old.name)
    else jsonb_build_object('form_type', to_jsonb(old)->>'form_type') end;
  insert into activity_logs (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), kind || '.deleted', kind, old.id, detail);
  return null;
end;
$$;

drop trigger if exists projects_deleted on projects;
create trigger projects_deleted after delete on projects
  for each row execute function record_deleted();
drop trigger if exists organizations_deleted on organizations;
create trigger organizations_deleted after delete on organizations
  for each row execute function record_deleted();
drop trigger if exists leads_deleted on leads;
create trigger leads_deleted after delete on leads
  for each row execute function record_deleted();


-- ###########################################################################
-- 4. A PROJECT IN THE TRASH IS HIDDEN FROM ITS CLIENT
-- ###########################################################################

-- Same as 20261001000100, plus "the project is not in the Trash". Every client
-- read of a project's documents, demos and meetings goes through this.
create or replace function client_has_project(p_project uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from client_project_access x
    join projects p on p.id = x.project_id
    where x.account_id = client_account_id() and x.project_id = p_project and x.revoked_at is null
      and p.archived_at is null)
$$;

create or replace function client_portal_projects()
returns table (project_id uuid, project_name text)
  language plpgsql volatile security definer set search_path = public as $$
declare
  me uuid := client_account_id();
begin
  if me is null then
    return;
  end if;
  update client_accounts set first_seen_at = now() where id = me and first_seen_at is null;
  return query
    select p.id, p.name
    from client_project_access x join projects p on p.id = x.project_id
    where x.account_id = me and x.revoked_at is null and p.archived_at is null
    order by p.name;
end;
$$;


-- ###########################################################################
-- 5. A LEAD IN THE TRASH IS NOT COUNTED
-- ###########################################################################

-- Same as 20260929000300, plus `l.trashed_at is null`.
create or replace function portal_revenue_attribution(dimension text default 'source')
returns table (
  key             text,
  leads           bigint,
  qualified       bigint,
  opportunities   bigint,
  won             bigint,
  won_value       numeric,
  won_currency    text,
  won_currencies  bigint
)
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  if dimension not in ('source', 'medium', 'campaign', 'landing') then
    raise exception 'unsupported dimension %', dimension
      using errcode = 'invalid_parameter_value';
  end if;

  return query
  with lead_keyed as (
    select
      l.id,
      l.status,
      case dimension
        when 'medium'   then nullif(l.meta->>'utmMedium', '')
        when 'campaign' then nullif(l.meta->>'utmCampaign', '')
        when 'landing'  then nullif(l.meta->>'landingRoute', '')
        else coalesce(nullif(l.meta->>'utmSource', ''),
                      nullif(l.meta->>'landingReferrerHost', ''))
      end as k
    from leads l
    where l.status <> 'spam'
      and l.trashed_at is null
      and not lead_is_impact(l.form_type, l.source)
  ),
  opp_keyed as (
    select
      o.stage,
      o.estimated_value,
      o.currency,
      case dimension
        when 'medium'   then coalesce(nullif(o.medium, ''),   lk.k)
        when 'campaign' then coalesce(nullif(o.campaign, ''), lk.k)
        when 'landing'  then coalesce(nullif(o.landing_route, ''), lk.k)
        else coalesce(nullif(o.source, ''), lk.k)
      end as k
    from opportunities o
    left join lead_keyed lk on lk.id = o.lead_id
    where o.archived_at is null
  ),
  lead_agg as (
    select
      coalesce(k, '(not set)') as k,
      count(*) as leads,
      count(*) filter (where status::text in ('qualified', 'proposal', 'won')) as qualified
    from lead_keyed group by 1
  ),
  opp_agg as (
    select
      coalesce(k, '(not set)') as k,
      count(*) as opportunities,
      count(*) filter (where stage = 'won') as won,
      coalesce(sum(estimated_value) filter (where stage = 'won'), 0) as won_value,
      (array_agg(distinct currency) filter (where stage = 'won'))[1] as won_currency,
      count(distinct currency) filter (where stage = 'won') as won_currencies
    from opp_keyed group by 1
  )
  select
    coalesce(l.k, o.k),
    coalesce(l.leads, 0),
    coalesce(l.qualified, 0),
    coalesce(o.opportunities, 0),
    coalesce(o.won, 0),
    coalesce(o.won_value, 0),
    o.won_currency,
    coalesce(o.won_currencies, 0)
  from lead_agg l
  full outer join opp_agg o on o.k = l.k
  order by coalesce(o.won_value, 0) desc, coalesce(l.leads, 0) desc;
end;
$$;


-- Same as 20260929000300, which was "archive-blind" — archiving now IS the
-- Trash, and a project in the Trash is out of every total.
create or replace function impact_support_summary()
returns table (
  committed          bigint,
  committed_projects bigint,
  committed_missing  bigint,
  delivered          bigint,
  delivered_projects bigint,
  cancelled_projects bigint
)
language sql stable security invoker set search_path = public
as $$
  select
    coalesce(sum(p.market_value) filter (where p.status not in ('completed', 'cancelled')), 0)::bigint,
    count(*) filter (where p.status not in ('completed', 'cancelled') and p.market_value is not null),
    count(*) filter (where p.status not in ('completed', 'cancelled') and p.market_value is null),
    coalesce(sum(p.market_value) filter (where p.status = 'completed'), 0)::bigint,
    count(*) filter (where p.status = 'completed'),
    count(*) filter (where p.status = 'cancelled')
  from projects p
  where p.program = 'impact' and p.archived_at is null
$$;

comment on function impact_support_summary is
  'Committed (in progress, not cancelled) and delivered (completed) Impact support, from projects.market_value. Projects in the Trash are not counted. SECURITY INVOKER.';


-- ###########################################################################
-- GRANTS
-- ###########################################################################

do $$
declare
  f text;
begin
  foreach f in array array[
    'project_purge_blockers(uuid)', 'client_purge_blockers(uuid)', 'lead_purge_blockers(uuid)',
    'purge_project(uuid)', 'purge_client(uuid)', 'purge_lead(uuid)'
  ] loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', f);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('grant execute on function %s to authenticated', f);
    end if;
  end loop;
end $$;

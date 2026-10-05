-- =============================================================================
-- Stratos — Impact without an application, and deletable Impact leads
--
--   1. direct      an Impact project may be created by the owner without an
--                  application (`projects.impact_direct`). Everything else an
--                  Impact project is stays: free, HUF, fixed programme, closed
--                  only with a market value
--   2. lead delete deleting an Impact lead (from the Trash) deletes its
--                  application with it — owner only. A project started from it
--                  stays, as a direct Impact project
--
-- Nothing is deleted by this migration. Run after 20261007000100_trash.sql.
-- =============================================================================

do $$
begin
  if to_regprocedure('public.purge_lead(uuid)') is null then
    raise exception 'The Trash (20261007000100_trash.sql) is not applied.';
  end if;
  if current_user in ('anon', 'authenticated') then
    raise exception 'Run this migration from the SQL editor, not as an API role.';
  end if;
end $$;


-- ###########################################################################
-- 1. DIRECT IMPACT PROJECTS
-- ###########################################################################

alter table projects add column if not exists impact_direct boolean not null default false;

do $$ begin
  alter table projects add constraint projects_impact_direct_check
    check (not impact_direct or program = 'impact');
exception when duplicate_object then null; end $$;

comment on column projects.impact_direct is
  'Impact only: created by the owner without an application (or its application was deleted with its lead).';

-- Same as 20260929000300, except that a direct Impact project needs no
-- application. Still checked at COMMIT, still for every insert path.
create or replace function impact_project_has_application() returns trigger
  language plpgsql set search_path = public
as $$
begin
  if new.impact_direct then
    return null;
  end if;
  if not exists (select 1 from impact_applications a where a.project_id = new.id) then
    raise exception 'stratos:impact_project_without_application'
      using errcode = 'P0001',
            hint = 'Impact projects are started from an accepted application, or created directly.';
  end if;
  return null;
end;
$$;


-- ###########################################################################
-- 2. DELETING AN IMPACT LEAD
-- ###########################################################################

-- Before a lead is deleted (only purge_lead() deletes leads): its Impact
-- application goes with it. Only the owner may — the Impact pipeline is the
-- owner's. A project started from the application stays and becomes direct.
-- A trigger, so it can remove the application (no API role may delete one)
-- without an API-callable definer function.
create or replace function lead_delete_impact_application() returns trigger
  language plpgsql security definer set search_path = public
as $$
declare
  app impact_applications%rowtype;
begin
  select * into app from impact_applications where lead_id = old.id;
  if not found then
    return old;
  end if;
  if not is_owner() then
    raise exception 'stratos:purge_forbidden' using errcode = '42501',
      hint = 'Only the portal owner can delete an Impact application.';
  end if;
  if app.project_id is not null then
    update projects set impact_direct = true where id = app.project_id;
  end if;
  delete from impact_applications where id = app.id;
  insert into activity_logs (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'impact.deleted', 'impact_application', app.id,
          jsonb_build_object('status', app.status::text, 'project', app.project_id));
  return old;
end;
$$;

drop trigger if exists leads_delete_impact_application on leads;
create trigger leads_delete_impact_application
  before delete on leads
  for each row execute function lead_delete_impact_application();

-- Nothing blocks a lead any more: an Impact application is deleted with it
-- (owner only — the trigger above says so to anyone else).
create or replace function lead_purge_blockers(p_id uuid) returns text[]
  language sql stable security invoker set search_path = public
as $$
  select case when not is_admin() then null else '{}'::text[] end
$$;

-- An Impact project started from an application: the application is the link
-- to the original submission. Same as 20261007000100 with a clearer reason.
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
    ((select case when count(*) > 0 then 'the Impact application it was started from — delete that lead in the Trash first' end
        from impact_applications where project_id = p_id))
  ) as t(b)
  ) end
$$;

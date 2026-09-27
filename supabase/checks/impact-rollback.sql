-- =============================================================================
-- Impact — ROLLBACK of 20260929000300_impact_program.sql.
--
-- Run BEFORE owner-lockdown-rollback.sql / owner-tracker-rollback.sql if those
-- are being rolled back too.
--
-- WHAT THIS REMOVES: behaviour only.
--   * capture of new Impact leads, the relabel guard, the wall on
--     opportunities, the program-fixed rule, the market-value audit, the
--     "impact project needs an application" rule, the application rules
--   * the Impact-only constraints on projects (free, status)
--   * the Impact additions to the close rule — restored verbatim from
--     20260928000200_owner_tracker.sql
--   * the paid-only filters — portal_sales_summary() and
--     portal_revenue_attribution() restored verbatim from 20260816000100
--   * the owner-only rule for Impact events in activity_logs — restored to the
--     20260928000300 policy
--   * EXECUTE on the Impact functions for the API roles
--
-- WHAT THIS KEEPS — nothing written in the meantime is deleted:
--   * impact_applications and every row in it (still owner-only by its own
--     policies), every Impact project, `projects.program`, every market value
--   * the `cancelled` project state and every project in it (an enum value
--     cannot be dropped; the previous Portal shows the raw state name)
--   * the project_links fix (20260929000100) — it is independent and restoring
--     a check that cannot compile would only break link writes again
--
-- After this, the previous Portal treats Impact projects as ordinary projects
-- in the owner's tracker. Leads that arrive meanwhile are NOT captured; re-apply
-- 20260929000300 (idempotent) and its backfill picks them up.
-- =============================================================================

begin;

drop trigger if exists leads_impact_capture         on leads;
drop trigger if exists leads_program_fixed          on leads;
drop trigger if exists opportunities_not_impact     on opportunities;
drop trigger if exists projects_program_fixed       on projects;
drop trigger if exists projects_market_value_audit  on projects;
drop trigger if exists projects_impact_application  on projects;
drop trigger if exists impact_applications_rules    on impact_applications;
drop trigger if exists impact_applications_audit    on impact_applications;

alter table projects drop constraint if exists projects_impact_free_check;
alter table projects drop constraint if exists projects_impact_status_check;

-- ---------------------------------------------- close rule, as in 20260928000200
create or replace function project_close_rules() returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  total      integer := 0;
  open_steps integer := 0;
begin
  if new.status = 'completed'
     and (tg_op = 'INSERT' or old.status is distinct from 'completed') then
    if tg_op = 'UPDATE' then
      select count(*), count(*) filter (where state <> 'done')
        into total, open_steps
      from project_milestones where project_id = new.id;
    end if;

    if total = 0 then
      raise exception 'stratos:project_close_no_checkpoints'
        using errcode = 'P0001',
              hint = 'A project needs at least one checkpoint, all done, before it can be closed.';
    end if;
    if open_steps > 0 then
      raise exception 'stratos:project_close_open_checkpoints'
        using errcode = 'P0001',
              detail = format('%s of %s checkpoints are not done.', open_steps, total),
              hint = 'Finish every checkpoint before closing the project.';
    end if;

    new.completed_at := now();
  elsif new.status = 'completed' then
    -- Still closed: the close date is the date it was closed, not the date of
    -- the latest edit.
    new.completed_at := old.completed_at;
  else
    -- Open, or reopened. An open project has no completion date.
    new.completed_at := null;
  end if;

  return new;
end;
$$;

-- ------------------------------------ paid aggregates, as in 20260816000100
create or replace function portal_sales_summary()
returns table (
  bucket   text,
  currency text,
  items    bigint,
  value    numeric,
  weighted numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with live as (
    select * from opportunities where archived_at is null
  ),
  open_opps as (
    select * from live where stage not in ('won', 'lost')
  )
  -- One bucket per stage: the Dashboard's compact stage distribution (§9).
  select
    'stage:' || o.stage::text,
    o.currency,
    count(*),
    coalesce(sum(o.estimated_value), 0),
    coalesce(sum(o.estimated_value * o.probability / 100.0), 0)
  from live o
  where o.stage not in ('won', 'lost')
  group by o.stage, o.currency

  -- Total open pipeline, and the weighted forecast (§7).
  union all
  select 'open', o.currency, count(*),
         coalesce(sum(o.estimated_value), 0),
         coalesce(sum(o.estimated_value * o.probability / 100.0), 0)
  from open_opps o group by o.currency

  -- Expected to close inside the current calendar month (§7).
  union all
  select 'closing_month', o.currency, count(*),
         coalesce(sum(o.estimated_value), 0),
         coalesce(sum(o.estimated_value * o.probability / 100.0), 0)
  from open_opps o
  where o.expected_close_on >= date_trunc('month', current_date)::date
    and o.expected_close_on <  (date_trunc('month', current_date) + interval '1 month')::date
  group by o.currency

  -- Won, this month and this year (§7, §32). `won_at` is stamped by the
  -- database, so these cannot drift from the stage.
  union all
  select 'won_mtd', o.currency, count(*), coalesce(sum(o.estimated_value), 0), 0::numeric
  from live o
  where o.stage = 'won' and o.won_at >= date_trunc('month', current_date)
  group by o.currency

  union all
  select 'won_ytd', o.currency, count(*), coalesce(sum(o.estimated_value), 0), 0::numeric
  from live o
  where o.stage = 'won' and o.won_at >= date_trunc('year', current_date)
  group by o.currency

  -- Every closed deal, ever. The win rate and the average won deal are computed
  -- from these two buckets rather than stored, so they cannot go stale.
  union all
  select 'won_all', o.currency, count(*), coalesce(sum(o.estimated_value), 0), 0::numeric
  from live o where o.stage = 'won' group by o.currency

  union all
  select 'lost_all', o.currency, count(*), coalesce(sum(o.estimated_value), 0), 0::numeric
  from live o where o.stage = 'lost' group by o.currency

  -- Delivery, for the Dashboard's one-line project readout (§57).
  -- `currency` is not meaningful for a count of projects and is null rather than
  -- a placeholder that could be summed by accident.
  union all
  select 'projects_' || (case
      when p.status::text in ('blocked', 'on_hold') then 'blocked'
      when p.status::text in ('completed', 'archived') then 'closed'
      else 'active' end),
    null::text, count(*), 0::numeric, 0::numeric
  from projects p
  where p.archived_at is null
  group by 1

  union all
  select 'clients_active', null::text, count(*), 0::numeric, 0::numeric
  from organizations c
  where c.archived_at is null and c.status = 'active';
$$;

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
      -- "Qualified" means the lead reached qualification or beyond. It is a
      -- lead-side measure on purpose: it is the step between "an enquiry
      -- arrived" and "a deal exists", which is the step §33's chain names.
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

-- ------------------------------------------ activity policy, as in 20260928000300
drop policy if exists activity_select_admin on activity_logs;
create policy activity_select_admin on activity_logs
  for select using (
    (entity_type is distinct from 'project' and is_admin())
    or is_owner()
  );

-- -------------------------------------------------------- the Impact functions
do $$
declare
  f text;
begin
  foreach f in array array[
    'impact_start_project(uuid, uuid, text, text, text, text, text, text, text[])',
    'impact_support_summary()',
    'impact_legacy_conflicts()'
  ] loop
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on function %s from authenticated', f);
    end if;
  end loop;
end $$;

commit;

-- =============================================================================
-- Stratos — the revenue report ("5. CRM", second part)
--
-- Owner decision of 2026-10-05: four views, one function, every figure per
-- currency (never converted):
--
--   collected   money received (project_payments), per month — last 36 months
--   client      the same, per month and client
--   service     the same, per month and project service
--   mrr         the monthly fees of the monthly contracts running in each
--               month — last 24 months
--   forecast    the next 6 months (this one included):
--                 scheduled  the unpaid part of every instalment, by due month
--                            (anything already overdue counts in this month)
--                 monthly    the fee of each running monthly contract, for the
--                            months its schedule does not already cover
--                 pipeline   open deals, value × probability, by expected
--                            close month (deals with no date are left out)
--
-- SECURITY INVOKER: the caller's own rights decide — the payments and projects
-- are the owner's (and the owner's delegates'), so for anyone else the money
-- sections come back empty. Nothing is stored.
--
-- Run after 20261015000100_automations.sql. Re-runnable.
-- =============================================================================

do $$
begin
  if to_regprocedure('public.portal_today()') is null then
    raise exception 'The payment schedule (20261002000100) is not applied.';
  end if;
  if current_user in ('anon', 'authenticated') then
    raise exception 'Run this migration from the SQL editor, not as an API role.';
  end if;
end $$;

create or replace function portal_revenue_report(p_today date default null)
returns table (section text, month date, key text, label text, currency text, amount numeric)
  language sql stable security invoker set search_path = public
as $$
  with today as (
    select coalesce(p_today, portal_today()) as d, date_trunc('month', coalesce(p_today, portal_today()))::date as m
  ),
  paid as (
    select date_trunc('month', pp.paid_on)::date as month, p.currency, pp.amount,
           p.organization_id, coalesce(o.name, '—') as client, coalesce(nullif(btrim(p.service), ''), '—') as service
    from project_payments pp
    join projects p on p.id = pp.project_id
    left join organizations o on o.id = p.organization_id
    where pp.paid_on is not null and pp.paid_on >= (select m from today) - interval '35 months'
  ),
  contracts as (
    select p.id, p.currency, p.monthly_fee,
           date_trunc('month', coalesce(p.start_date, (p.created_at at time zone 'Europe/Budapest')::date))::date as first_month,
           case when p.status = 'completed' then date_trunc('month', coalesce((p.completed_at at time zone 'Europe/Budapest')::date, (select d from today)))::date end as last_month
    from projects p
    where p.billing = 'monthly' and p.monthly_fee is not null and p.archived_at is null
  ),
  months_back as (
    select (date_trunc('month', (select d from today)) - make_interval(months => g))::date as month from generate_series(0, 23) g
  ),
  months_ahead as (
    select (date_trunc('month', (select d from today)) + make_interval(months => g))::date as month from generate_series(0, 5) g
  ),
  open_instalments as (
    select i.project_id, p.currency,
           greatest(i.due_on, (select d from today)) as due,
           i.amount - coalesce((select sum(pp.amount) from project_payments pp where pp.instalment_id = i.id), 0) as unpaid
    from project_instalments i
    join projects p on p.id = i.project_id
    where i.due_on is not null and p.archived_at is null and p.status::text not in ('cancelled')
  )
  -- collected
  select 'collected', month, null, null, currency, sum(amount) from paid group by month, currency
  union all
  select 'client', month, organization_id::text, client, currency, sum(amount) from paid group by month, organization_id, client, currency
  union all
  select 'service', month, service, service, currency, sum(amount) from paid group by month, service, currency
  -- mrr
  union all
  select 'mrr', mb.month, null, null, c.currency, sum(c.monthly_fee)
  from months_back mb join contracts c on c.first_month <= mb.month and (c.last_month is null or c.last_month >= mb.month)
  group by mb.month, c.currency
  -- forecast
  union all
  select 'forecast', date_trunc('month', oi.due)::date, 'scheduled', null, oi.currency, sum(oi.unpaid)
  from open_instalments oi
  where oi.unpaid > 0 and oi.due < (select m from today) + interval '6 months'
  group by 2, oi.currency
  union all
  select 'forecast', ma.month, 'monthly', null, c.currency, sum(c.monthly_fee)
  from months_ahead ma join contracts c on c.first_month <= ma.month and c.last_month is null
  where not exists (select 1 from project_instalments i where i.project_id = c.id
                      and date_trunc('month', i.due_on)::date = ma.month)
  group by ma.month, c.currency
  union all
  select 'forecast', date_trunc('month', greatest(o.expected_close_on, (select d from today)))::date, 'pipeline', null, o.currency,
         sum(o.estimated_value * o.probability / 100.0)
  from opportunities o
  where o.stage not in ('won', 'lost') and o.archived_at is null and o.estimated_value is not null
    and o.expected_close_on is not null and o.expected_close_on < (select m from today) + interval '6 months'
  group by 2, o.currency
$$;

do $$
begin
  execute 'revoke all on function portal_revenue_report(date) from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function portal_revenue_report(date) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function portal_revenue_report(date) to authenticated';
  end if;
end $$;

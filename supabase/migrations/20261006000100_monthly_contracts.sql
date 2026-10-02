-- =============================================================================
-- Stratos — monthly contracts: a paid project billed by the month
--
-- A one-off project has a price (`value`) and is delivered once. A monthly
-- contract (retainer: care, ads management, SEO, …) has a MONTHLY FEE and runs
-- until it is ended. The two are kept apart: a monthly fee is never added to a
-- one-off project value, and a monthly contract is listed, counted and totalled
-- on its own.
--
--   1. billing        `projects.billing` (one_off | monthly), fixed at creation
--   2. the fee        `projects.monthly_fee`, in the project's currency;
--                     required on a monthly contract, refused on anything else.
--                     A monthly contract carries no one-off `value`
--   3. audit          every fee change is logged old → new
--   4. the end        ending a monthly contract = closing it (status
--                     `completed`); it needs no checkpoints
--   5. the figures    `project_payment_overview()` also returns `billing` and
--                     `monthly_fee`, so a monthly schedule is not reported as
--                     "schedule ≠ contract"
--
-- Payments are unchanged: a monthly contract uses the same payment schedule, one
-- instalment per month. Impact projects are never monthly (they are free).
--
-- Nothing is deleted or rewritten: every existing project is `one_off`, which is
-- what every existing project is. Constant default, no table rewrite.
--
-- Run after 20261005000100_client_feedback_reschedule.sql.
-- =============================================================================


-- ###########################################################################
-- 0. PRECONDITIONS
-- ###########################################################################

do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'projects' and column_name = 'program') then
    raise exception 'The Impact migration (20260929000300_impact_program.sql) is not applied.';
  end if;
  if to_regclass('public.project_instalments') is null then
    raise exception 'The payment schedule (20261002000100_payment_schedule.sql) is not applied.';
  end if;
  if current_user in ('anon', 'authenticated') then
    raise exception 'Run this migration from the SQL editor, not as an API role.';
  end if;
end $$;


-- ###########################################################################
-- 1–2. BILLING AND THE MONTHLY FEE
-- ###########################################################################

alter table projects add column if not exists billing text not null default 'one_off';

do $$ begin
  alter table projects add constraint projects_billing_check
    check (billing in ('one_off', 'monthly'));
exception when duplicate_object then null; end $$;

-- In the project's currency, like `value`. Per month, net of nothing: it is the
-- agreed fee, not what was received (that is the payment schedule's).
alter table projects add column if not exists monthly_fee numeric(14, 2);

do $$ begin
  alter table projects add constraint projects_monthly_fee_check
    check (monthly_fee is null or (monthly_fee > 0 and monthly_fee <= 1000000000000));
exception when duplicate_object then null; end $$;

-- A monthly contract: paid (never Impact), has a fee, and has no one-off value
-- (which would otherwise be added to the one-off totals). Anything else has no
-- monthly fee. Every existing row is one_off with no fee, so this validates
-- immediately.
do $$ begin
  alter table projects add constraint projects_monthly_shape_check
    check (case when billing = 'monthly'
                then program = 'paid' and monthly_fee is not null and value is null
                else monthly_fee is null end);
exception when duplicate_object then null; end $$;

create index if not exists projects_billing_idx on projects (billing, status) where archived_at is null;

comment on column projects.billing is
  'one_off | monthly. Fixed at creation. A monthly contract has a monthly_fee and no one-off value.';
comment on column projects.monthly_fee is
  'Monthly contracts only: the agreed fee per month, in the project''s currency. Not cash received.';

-- Decided once, like the programme. Turning a one-off project into a monthly
-- contract would drop its value from the one-off totals after the fact; either
-- way it is a new project, not an edit.
create or replace function project_billing_fixed() returns trigger
  language plpgsql set search_path = public
as $$
begin
  if new.billing is distinct from old.billing then
    raise exception 'stratos:project_billing_fixed'
      using errcode = 'P0001',
            hint = 'A project is one-off or a monthly contract from the day it is created. Create a new project instead.';
  end if;
  return new;
end;
$$;

drop trigger if exists projects_billing_fixed on projects;
create trigger projects_billing_fixed
  before update of billing on projects
  for each row execute function project_billing_fixed();


-- ###########################################################################
-- 3. AUDIT
-- ###########################################################################

create or replace function log_project_monthly_fee() returns trigger
  language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' and new.monthly_fee is null then
    return null;
  end if;
  if tg_op = 'UPDATE' and new.monthly_fee is not distinct from old.monthly_fee then
    return null;
  end if;
  insert into activity_logs (user_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'project.monthly_fee_changed', 'project', new.id,
    jsonb_build_object(
      'from', case when tg_op = 'UPDATE' then old.monthly_fee end,
      'to', new.monthly_fee,
      'currency', new.currency));
  return null;
end;
$$;

drop trigger if exists projects_monthly_fee_audit on projects;
create trigger projects_monthly_fee_audit
  after insert or update of monthly_fee on projects
  for each row execute function log_project_monthly_fee();


-- ###########################################################################
-- 4. THE END OF A MONTHLY CONTRACT
-- ###########################################################################

-- THE CLOSE RULE, extended once more. Everything 20260928000200 and
-- 20260929000300 say still holds for one-off and Impact projects. A monthly
-- contract has no "last checkpoint" — it runs until it is ended — so closing it
-- (ending the contract) does not read its checkpoints.
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
    if new.billing is distinct from 'monthly' then
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
    end if;
    if new.program = 'impact' and new.market_value is null then
      raise exception 'stratos:impact_close_no_market_value'
        using errcode = 'P0001',
              hint = 'Record the market value of the donated work before closing an Impact project.';
    end if;

    new.completed_at := now();
  elsif new.status = 'completed' then
    if new.program = 'impact' and new.market_value is null then
      raise exception 'stratos:impact_close_no_market_value'
        using errcode = 'P0001',
              hint = 'A closed Impact project keeps its market value. Change it, or reopen the project first.';
    end if;
    new.completed_at := old.completed_at;
  else
    new.completed_at := null;
  end if;

  return new;
end;
$$;

comment on function project_close_rules is
  'Closing = status completed. One-off/Impact: >= 1 checkpoint, all done, and (Impact) a market value. Monthly: ending the contract, no checkpoint rule. Stamps completed_at; clears it on reopen.';


-- ###########################################################################
-- 5. THE FIGURES
-- ###########################################################################

-- The same figures as 20261002000100, plus the billing and the monthly fee. The
-- return type grows, so the function is dropped and recreated (no data lives in
-- a function); its grants are re-applied below.
drop function if exists project_payment_overview(uuid);

create function project_payment_overview(p_project uuid default null)
returns table (
  project_id uuid, project_name text, client_name text, status text, archived boolean,
  currency text, contracted numeric, scheduled numeric, paid numeric, remaining numeric,
  overpaid numeric, overdue numeric, schedule_gap numeric, next_due_on date,
  instalments integer, payments integer, undated_payments integer,
  billing text, monthly_fee numeric
)
  language sql stable security invoker set search_path = public
as $$
  with inst as (
    select i.project_id, i.id, i.amount, i.due_on,
           coalesce((select sum(x.amount) from project_payments x where x.instalment_id = i.id), 0) as got
    from project_instalments i
    where p_project is null or i.project_id = p_project
  ), per as (
    select project_id,
           sum(amount) as scheduled,
           count(*)::int as n,
           sum(greatest(amount - got, 0)) filter (where due_on < portal_today()) as late,
           min(due_on) filter (where got < amount) as next_due
    from inst group by project_id
  ), pay as (
    select x.project_id, sum(x.amount) as paid, count(*)::int as n,
           count(*) filter (where x.paid_on is null)::int as undated
    from project_payments x
    where p_project is null or x.project_id = p_project
    group by x.project_id
  ), base as (
    select p.id, p.name, o.name as client_name, p.status::text as status, p.archived_at is not null as archived,
           p.currency, p.value, p.billing, p.monthly_fee,
           coalesce(per.scheduled, 0) as scheduled,
           coalesce(pay.paid, 0) as paid,
           coalesce(p.value, per.scheduled, 0) as basis,
           coalesce(per.late, 0) as late,
           per.next_due, coalesce(per.n, 0) as n_inst, coalesce(pay.n, 0) as n_pay,
           coalesce(pay.undated, 0) as undated
    from projects p
    left join organizations o on o.id = p.organization_id
    left join per on per.project_id = p.id
    left join pay on pay.project_id = p.id
    where p.program = 'paid' and (p_project is null or p.id = p_project)
  )
  select id, name, client_name, status, archived, currency,
         value, scheduled, paid,
         greatest(basis - paid, 0),
         greatest(paid - basis, 0),
         least(late, greatest(basis - paid, 0)),
         case when value is null then null else scheduled - value end,
         next_due, n_inst, n_pay, undated,
         billing, monthly_fee
  from base
  order by name
$$;


-- ###########################################################################
-- GRANTS
-- ###########################################################################

do $$
declare
  f text;
begin
  foreach f in array array[
    'project_payment_overview(uuid)'
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

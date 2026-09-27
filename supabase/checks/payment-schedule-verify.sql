-- =============================================================================
-- Payment schedule (phase 5) — VERIFY. Run in the Supabase SQL editor AFTER
-- 20261002000100_payment_schedule.sql.
--
-- Read-only in effect: one transaction that ends in ROLLBACK. Impersonates the
-- owner and EVERY other profile the way PostgREST does. Every row should read
-- `ok`. The carry-over's doubtful cases are NOT failures — they are listed by
-- the last query for the owner to decide (PORTAL_RELEASE.md §6).
-- =============================================================================

begin;

create temp table verify_result (check_name text, ok boolean, detail text) on commit drop;
grant insert, select on verify_result to authenticated, anon;

-- ------------------------------------------------------------ structure
insert into verify_result
select 'phase-5 tables force RLS',
       (select bool_and(c.relrowsecurity and c.relforcerowsecurity) from pg_class c
        where c.relname in ('project_instalments', 'project_payments', 'project_finance_legacy')
          and c.relnamespace = 'public'::regnamespace)
       and (select count(*) = 3 from pg_class c
            where c.relname in ('project_instalments', 'project_payments', 'project_finance_legacy')
              and c.relnamespace = 'public'::regnamespace), null
union all
select 'anon has no grant on the schedule; nobody may write the snapshot',
       not exists (select 1 from unnest(array['project_instalments', 'project_payments', 'project_finance_legacy']) t
                   where has_table_privilege('anon', t, 'select') or has_table_privilege('anon', t, 'insert'))
       and not has_table_privilege('authenticated', 'project_finance_legacy', 'insert')
       and not has_table_privilege('authenticated', 'project_finance_legacy', 'delete'), null
union all
select 'every policy on the schedule answers to is_owner()',
       not exists (select 1 from pg_policies where tablename in ('project_instalments', 'project_payments', 'project_finance_legacy')
                   and coalesce(qual, '') || coalesce(with_check, '') not like '%is_owner()%'), null
union all
select 'the carry-over is SQL-editor only',
       not has_function_privilege('authenticated', 'payment_carry_over()', 'execute')
       and not has_function_privilege('anon', 'payment_carry_over()', 'execute'), null
union all
select 'no definer function reads the schedule',
       not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef
                   and p.prorettype <> 'trigger'::regtype
                   and p.prosrc ~* '\m(project_instalments|project_payments|project_finance_legacy)\M'), null
union all
select 'the derive trigger is on projects',
       exists (select 1 from pg_trigger where tgname = 'projects_zz_payment_derive' and not tgisinternal), null
union all
select 'every project''s single-sum columns equal its schedule',
       not exists (select 1 from projects p, lateral project_payment_derived(p.id, p.value) d
                   where p.payment_state is distinct from d.payment_state
                      or p.invoiced_amount is distinct from d.invoiced_amount
                      or p.paid_amount is distinct from d.paid_amount),
       (select string_agg(p.name, ', ') from projects p, lateral project_payment_derived(p.id, p.value) d
        where p.payment_state is distinct from d.payment_state
           or p.invoiced_amount is distinct from d.invoiced_amount
           or p.paid_amount is distinct from d.paid_amount)
union all
select 'no Impact project has an instalment or a payment',
       not exists (select 1 from project_instalments i join projects p on p.id = i.project_id where p.program = 'impact')
       and not exists (select 1 from project_payments x join projects p on p.id = x.project_id where p.program = 'impact'), null
union all
select 'money received is unchanged by the carry-over (per currency)',
       not exists (
         select 1 from project_finance_legacy l
         group by l.currency
         having sum(coalesce(l.paid_amount, 0)) <> coalesce(sum((select sum(x.amount) from project_payments x
                                                                 where x.project_id = l.project_id and x.origin = 'legacy')), 0)),
       null
union all
select 'no carried payment was given an invented date',
       not exists (select 1 from project_payments x join project_finance_legacy l on l.payment_id = x.id
                   where x.paid_on is not null and x.updated_at = x.created_at), null
union all
select 'every snapshot row with money has its instalment',
       not exists (select 1 from project_finance_legacy l
                   where (coalesce(l.invoiced_amount, 0) > 0 or coalesce(l.paid_amount, 0) > 0 or coalesce(l.value, 0) > 0)
                     and l.instalment_id is null), null;

-- ------------------------------------------------------------ as everyone
do $$
declare
  owner_like boolean;
  u record;
  n bigint;
  refused boolean;
begin
  for u in select p.id, p.email, p.role from profiles p order by p.role, p.email limit 200 loop
    perform set_config('request.jwt.claims', json_build_object('sub', u.id, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    owner_like := is_owner();
    n := (select count(*) from project_instalments) + (select count(*) from project_payments)
       + (select count(*) from project_finance_legacy) + (select count(*) from project_payment_overview());
    begin
      insert into project_payments (instalment_id, project_id, amount, paid_on)
      select i.id, i.project_id, 1, current_date from project_instalments i limit 1;
      refused := not found;
    exception when others then
      refused := true;
    end;
    execute 'reset role';

    -- The owner, or a named owner delegate (phase 6): owner rights by design.
    if u.id = (select user_id from portal_owner) or owner_like then
      insert into verify_result values ('owner: reads the schedule', true,
        format('%s rows visible', n));
    else
      insert into verify_result values (
        format('%s (%s): reads nothing, writes nothing', u.email, u.role),
        n = 0 and refused, format('rows visible %s', n));
    end if;
  end loop;

  perform set_config('request.jwt.claims', '{}', true);
  execute 'set local role anon';
  begin
    perform * from project_payment_overview();
    refused := false;
  exception when insufficient_privilege then
    refused := true;
  end;
  execute 'reset role';
  insert into verify_result values ('anon: no payment overview', refused, null);
end $$;

select * from verify_result order by ok, check_name;

-- For the owner, not a pass/fail: the carry-over's doubtful cases.
select project_name, currency, value, payment_state, invoiced_amount, paid_amount,
       derived_state, issues, reviewed_at
from project_finance_legacy
where outcome = 'review'
order by project_name;

rollback;

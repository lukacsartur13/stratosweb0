-- =============================================================================
-- Owner delegates (phase 6) — VERIFY. Run in the SQL editor after
-- 20261003000100_owner_delegates.sql and after portal_add_delegate(...).
-- One transaction ending in ROLLBACK; impersonates every profile.
-- Every row should read `ok`.
-- =============================================================================

begin;

create temp table verify_result (check_name text, ok boolean, detail text) on commit drop;
grant insert, select on verify_result to authenticated, anon;

insert into verify_result
select 'delegate list has no API access',
       not has_table_privilege('authenticated', 'portal_owner_delegates', 'select')
       and not has_table_privilege('anon', 'portal_owner_delegates', 'select')
       and not has_function_privilege('authenticated', 'portal_add_delegate(text, text)', 'execute')
       and not has_function_privilege('anon', 'portal_add_delegate(text, text)', 'execute')
       and not has_function_privilege('authenticated', 'portal_remove_delegate(text)', 'execute'), null
union all
select 'every delegate is an admin or super_admin',
       not exists (select 1 from portal_owner_delegates d join profiles p on p.id = d.user_id
                   where p.role not in ('admin', 'super_admin')),
       (select string_agg(p.email || ' ' || p.role, ', ') from portal_owner_delegates d join profiles p on p.id = d.user_id)
union all
select 'owner still designated and super_admin',
       coalesce((select p.role = 'super_admin' from portal_owner o join profiles p on p.id = o.user_id), false), null;

-- is_owner() must be true for EXACTLY the owner and the listed delegates.
do $$
declare
  u record;
  flag boolean;
  expected boolean;
  n bigint;
begin
  for u in select id, email, role from profiles order by role, email limit 200 loop
    expected := u.id = (select user_id from portal_owner)
             or (u.id in (select user_id from portal_owner_delegates) and u.role in ('admin', 'super_admin'));
    perform set_config('request.jwt.claims', json_build_object('sub', u.id, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    select is_owner() into flag;
    select count(*) into n from projects;
    execute 'reset role';
    insert into verify_result values (
      format('%s (%s): is_owner()=%s as expected', u.email, u.role, flag),
      flag = expected and (flag or n = 0),
      format('expected %s, projects visible %s', expected, n));
  end loop;
end $$;

select * from verify_result order by ok, check_name;

rollback;

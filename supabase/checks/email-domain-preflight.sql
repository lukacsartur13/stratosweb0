-- =============================================================================
-- E-mail domain switch (media-stratos.com → stratosweb.hu) — PREFLIGHT.
-- Read-only. Run in the SQL editor before email-domain-switch.sql.
--
-- The first rows must read `ok = true`: each old address is exactly one
-- account, and neither new address is taken. The rows with `ok` empty are
-- information: every column (the public schema, auth.users, auth.identities)
-- that still holds "media-stratos" anywhere, with the number of rows. Data the
-- owner typed in (a contact, a note) is not changed by any script and is
-- decided by hand.
-- History (e-mails synced from Gmail, activity logs) is expected to stay.
-- =============================================================================

begin;

create temp table verify_result (check_name text, ok boolean, detail text) on commit drop;

insert into verify_result
select format('%s is exactly one account', m.old_email),
       count(u.id) = 1,
       coalesce(string_agg(coalesce(p.role::text, 'no profile'), ', '), 'not found')
from (values ('lukacs.artur@media-stratos.com'), ('info@media-stratos.com')) as m(old_email)
left join auth.users u on lower(u.email) = m.old_email
left join profiles p on p.id = u.id
group by m.old_email
union all
select format('%s is free', m.new_email),
       not exists (select 1 from auth.users u where lower(u.email) = m.new_email)
       and not exists (select 1 from profiles p where lower(p.email) = m.new_email),
       null
from (values ('lukacs.artur@stratosweb.hu'), ('timar.richard@stratosweb.hu')) as m(new_email);

-- Every text-like column, counted with one read-only query per column.
do $$
declare
  c record;
  n bigint;
begin
  for c in
    select col.table_schema, col.table_name, col.column_name
    from information_schema.columns col
    join information_schema.tables t
      on t.table_schema = col.table_schema and t.table_name = col.table_name and t.table_type = 'BASE TABLE'
    where (col.table_schema = 'public'
           or (col.table_schema = 'auth' and col.table_name in ('users', 'identities')))
      and col.data_type in ('text', 'character varying', 'jsonb', 'json', 'ARRAY', 'USER-DEFINED')
  loop
    execute format('select count(*) from %I.%I where %I::text ilike %L',
                   c.table_schema, c.table_name, c.column_name, '%media-stratos%') into n;
    if n > 0 then
      insert into verify_result
      values (format('"media-stratos" in %s.%s.%s', c.table_schema, c.table_name, c.column_name), null, n || ' row(s)');
    end if;
  end loop;
end $$;

select * from verify_result order by ok nulls last, check_name;

rollback;

-- =============================================================================
-- E-mail domain switch (media-stratos.com → stratosweb.hu) — VERIFY.
-- Read-only. Run in the SQL editor after email-domain-switch.sql and
-- 20261018000200_contact_email.sql. Every row should read `ok`.
-- =============================================================================

begin;

create temp table verify_result (check_name text, ok boolean, detail text) on commit drop;

insert into verify_result
select 'the owner signs in as lukacs.artur@stratosweb.hu',
       exists (select 1 from portal_owner o join auth.users u on u.id = o.user_id
               where u.email = 'lukacs.artur@stratosweb.hu'),
       (select u.email from portal_owner o join auth.users u on u.id = o.user_id)
union all
select 'the owner''s profile carries the same address',
       exists (select 1 from portal_owner o join profiles p on p.id = o.user_id
               where p.email = 'lukacs.artur@stratosweb.hu' and p.role = 'super_admin'),
       (select p.email || ' ' || p.role from portal_owner o join profiles p on p.id = o.user_id)
union all
select 'timar.richard@stratosweb.hu is an admin and still a delegate',
       exists (select 1 from auth.users u
               join profiles p on p.id = u.id and p.email = u.email
               join portal_owner_delegates d on d.user_id = u.id
               where u.email = 'timar.richard@stratosweb.hu' and p.role in ('admin', 'super_admin')),
       (select string_agg(p.email || ' ' || p.role, ', ')
          from portal_owner_delegates d join profiles p on p.id = d.user_id)
union all
select 'every e-mail identity matches its account',
       not exists (select 1 from auth.identities i join auth.users u on u.id = i.user_id
                   where i.provider = 'email' and lower(i.identity_data->>'email') <> lower(u.email)),
       null
union all
select 'every profile matches its account',
       not exists (select 1 from profiles p join auth.users u on u.id = p.id
                   where lower(p.email) <> lower(u.email)),
       (select string_agg(p.email || ' ≠ ' || u.email, ', ')
          from profiles p join auth.users u on u.id = p.id where lower(p.email) <> lower(u.email))
union all
select 'no account, identity or profile is left on media-stratos.com',
       not exists (select 1 from auth.users where email ilike '%@media-stratos.com')
       and not exists (select 1 from auth.identities where identity_data->>'email' ilike '%@media-stratos.com')
       and not exists (select 1 from profiles where email ilike '%@media-stratos.com'),
       null
union all
select 'no help article shows an old address',
       not exists (select 1 from help_articles
                   where answer ilike '%@media-stratos.com%' or translations::text ilike '%@media-stratos.com%'),
       null;

select * from verify_result order by ok, check_name;

rollback;

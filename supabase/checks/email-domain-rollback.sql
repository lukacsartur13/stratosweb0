-- =============================================================================
-- E-mail domain switch — ROLLBACK of email-domain-switch.sql.
-- Puts the two staff sign-ins back on their media-stratos.com addresses, in
-- the same three places, by user id. Nothing else is changed. The help article
-- (20261018000200) is left on the new address: the old one is still a working
-- alias, so it is not wrong, only not current.
-- =============================================================================

begin;

create temp table email_switch (
  user_id   uuid primary key,
  old_email text not null,
  new_email text not null
) on commit drop;

-- Here "old" is the stratosweb.hu address being undone.
insert into email_switch (user_id, old_email, new_email)
select u.id, m.old_email, m.new_email
from (values ('lukacs.artur@stratosweb.hu',   'lukacs.artur@media-stratos.com'),
             ('timar.richard@stratosweb.hu',  'info@media-stratos.com')) as m(old_email, new_email)
join auth.users u on lower(u.email) = m.old_email;

do $$
begin
  if (select count(*) from email_switch) <> 2 then
    raise exception 'Expected one account for each stratosweb.hu address; found only: %. Nothing changed.',
      coalesce((select string_agg(old_email, ', ') from email_switch), 'none');
  end if;
  if exists (select 1 from auth.users where lower(email) in (select new_email from email_switch)) then
    raise exception 'A media-stratos.com address already belongs to an account. Nothing changed.';
  end if;
end $$;

update auth.users u
set email              = s.new_email,
    raw_user_meta_data = case when u.raw_user_meta_data ? 'email'
                              then jsonb_set(u.raw_user_meta_data, '{email}', to_jsonb(s.new_email))
                              else u.raw_user_meta_data end,
    updated_at         = now()
from email_switch s
where u.id = s.user_id;

update auth.identities i
set identity_data = jsonb_set(i.identity_data, '{email}', to_jsonb(s.new_email)),
    provider_id   = case when lower(i.provider_id) = s.old_email then s.new_email else i.provider_id end,
    updated_at    = now()
from email_switch s
where i.user_id = s.user_id and i.provider = 'email';

update profiles p
set email = s.new_email
from email_switch s
where p.id = s.user_id;

select u.email as auth_email, p.email as profile_email, p.role
from email_switch s
join auth.users u on u.id = s.user_id
join profiles p   on p.id = s.user_id
order by p.role desc;

commit;

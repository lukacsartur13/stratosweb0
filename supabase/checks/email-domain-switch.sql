-- =============================================================================
-- E-mail domain switch — media-stratos.com → stratosweb.hu (2026-10-18).
-- RUN ONCE, in the SQL editor, after a backup and after
-- email-domain-preflight.sql read `ok` on every checked row.
--
-- Moves the two staff sign-ins to the new addresses:
--   lukacs.artur@media-stratos.com → lukacs.artur@stratosweb.hu   (owner, super_admin)
--   info@media-stratos.com         → timar.richard@stratosweb.hu  (admin, delegate)
--
-- Three places hold a sign-in address, and nothing keeps them in step:
--   auth.users.email     what GoTrue signs in with
--   auth.identities      the e-mail identity's own copy (identity_data.email)
--   profiles.email       what the portal shows, where notifications are sent,
--                        and what invites and delegation look addresses up in
--                        — written once by handle_new_user, never synced
-- All three change here, in one transaction, by user id. The password, the
-- role, the owner designation and the delegation (all keyed by user id) are
-- untouched, and sessions already open stay open.
--
-- Stops, changing nothing, if an old address is not exactly one account or a
-- new address already belongs to one.
-- Check: email-domain-verify.sql. Undo: email-domain-rollback.sql.
-- =============================================================================

begin;

create temp table email_switch (
  user_id   uuid primary key,
  old_email text not null,
  new_email text not null
) on commit drop;

insert into email_switch (user_id, old_email, new_email)
select u.id, m.old_email, m.new_email
from (values ('lukacs.artur@media-stratos.com', 'lukacs.artur@stratosweb.hu'),
             ('info@media-stratos.com',         'timar.richard@stratosweb.hu')) as m(old_email, new_email)
join auth.users u on lower(u.email) = m.old_email;

do $$
begin
  if (select count(*) from email_switch) <> 2 then
    raise exception 'Expected one account for each old address; found only: %. Nothing changed.',
      coalesce((select string_agg(old_email, ', ') from email_switch), 'none');
  end if;
  if exists (select 1 from auth.users where lower(email) in (select new_email from email_switch))
     or exists (select 1 from profiles where lower(email) in (select new_email from email_switch)) then
    raise exception 'A new address already belongs to an account or a profile. Nothing changed.';
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

select s.old_email,
       u.email                     as auth_email,
       p.email                     as profile_email,
       p.role,
       (select string_agg(i.identity_data->>'email', ', ')
          from auth.identities i where i.user_id = s.user_id) as identity_email
from email_switch s
join auth.users u on u.id = s.user_id
join profiles p   on p.id = s.user_id
order by p.role desc;

commit;

-- =============================================================================
-- Stratos — each account's portal language
--
-- `profiles.locale`: hu | en | de, or NULL = not chosen (every screen in the
-- language it is written in: the owner's screens English, the client portal
-- Hungarian). Each user sets their own through `profiles_update_self`, which
-- already lets a user edit their own row and pins only role and organization —
-- a language is not a privilege.
--
-- Nothing is rewritten: every existing profile starts as NULL, i.e. exactly as
-- today. Run after 20261008000100_impact_direct.sql.
-- =============================================================================

alter table profiles add column if not exists locale text;

do $$ begin
  alter table profiles add constraint profiles_locale_check
    check (locale is null or locale in ('hu', 'en', 'de'));
exception when duplicate_object then null; end $$;

comment on column profiles.locale is
  'The portal language this user chose: hu | en | de. NULL = not chosen (each screen in its source language).';

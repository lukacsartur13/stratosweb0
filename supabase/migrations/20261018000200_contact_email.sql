-- =============================================================================
-- Stratos — the contact address moves to hello@stratosweb.hu (2026-10-18)
--
-- The company mail moved from media-stratos.com to stratosweb.hu. The old
-- addresses live on as aliases, so nothing sent to them is lost, but every
-- place that gives the company's contact shows the new public address:
--   lukacs.artur@media-stratos.com → hello@stratosweb.hu
--   info@media-stratos.com         → hello@stratosweb.hu
--
-- The only database text the repository put an address into is the seeded
-- help article `portal-tovabbi-modositas` (20261004000200, translated in
-- 20261010000100); both seeds now carry the new address. This rewrites the
-- address in place — in the Hungarian answer and in every translation, of any
-- article that has it — so whatever the owner edited around it is kept.
--
-- Accounts (auth.users, profiles) are NOT touched here: they are data, not
-- schema. See supabase/checks/email-domain-switch.sql.
--
-- Re-runnable: a second run finds nothing to replace.
-- =============================================================================

update help_articles
set answer       = replace(replace(answer,
                     'lukacs.artur@media-stratos.com', 'hello@stratosweb.hu'),
                     'info@media-stratos.com', 'hello@stratosweb.hu'),
    translations = replace(replace(translations::text,
                     'lukacs.artur@media-stratos.com', 'hello@stratosweb.hu'),
                     'info@media-stratos.com', 'hello@stratosweb.hu')::jsonb
where answer ilike '%@media-stratos.com%'
   or translations::text ilike '%@media-stratos.com%';

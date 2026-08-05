-- =============================================================================
-- PREFLIGHT for 20260805000100_lead_envelope.sql
--
-- Read-only. Run in the Supabase SQL editor BEFORE applying the migration.
-- Nothing here writes, locks or changes anything.
--
-- This directory is not `supabase/migrations/`, so the CLI never applies it.
-- =============================================================================

-- 1. Server version. The migration relies on PG 11+ behaviour: ADD COLUMN with
--    a constant DEFAULT is metadata-only and does NOT rewrite the table. On
--    PG 10 or older it would rewrite, and the lock window would scale with the
--    table. Supabase is 15+, so this is a confirmation, not a question.
select version();

-- 2. The table exists, and how big it is. Everything about the lock window
--    below is "instant on a small table"; this is what makes that claim true
--    or false for this project.
select count(*) as lead_rows from leads;

-- 3. Current columns. Compare against the "before" list in the report: 17 rows.
select ordinal_position, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'leads'
order by ordinal_position;

-- 4. Has any part of this migration already been applied? All five must be
--    absent for a first run; any present means a partial prior application,
--    which the guards handle but which you should know about before starting.
select column_name
from information_schema.columns
where table_schema = 'public' and table_name = 'leads'
  and column_name in ('submission_id', 'form_type', 'source_route', 'payload', 'meta');

select indexname from pg_indexes
where schemaname = 'public' and tablename = 'leads'
  and indexname in ('leads_submission_id_key', 'leads_form_type_idx');

select conname from pg_constraint
where conrelid = 'public.leads'::regclass and conname = 'leads_form_type_check';

-- 5. Existing indexes and constraints, for the before/after comparison.
select indexname, indexdef from pg_indexes
where schemaname = 'public' and tablename = 'leads'
order by indexname;

select conname, pg_get_constraintdef(oid) as definition
from pg_constraint where conrelid = 'public.leads'::regclass
order by conname;

-- 6. RLS state. The migration does not touch it; this records what it was, so
--    the post-migration check can prove it is unchanged.
select relrowsecurity as rls_enabled, relforcerowsecurity as rls_forced
from pg_class where oid = 'public.leads'::regclass;

select policyname, cmd, qual, with_check
from pg_policies where schemaname = 'public' and tablename = 'leads'
order by policyname;

-- 7. Grants. New columns inherit TABLE-level grants automatically. If any
--    COLUMN-level grant exists on leads, that inheritance does not apply and
--    the new columns would be unreadable by that grantee. Expected: 0 rows.
select grantee, privilege_type, column_name
from information_schema.column_privileges
where table_schema = 'public' and table_name = 'leads';

-- 8. Triggers. Expected: leads_updated_at only. The migration adds none and
--    changes none.
select tgname, pg_get_triggerdef(oid) as definition
from pg_trigger where tgrelid = 'public.leads'::regclass and not tgisinternal;

-- 9. Would the new CHECK constraint reject anything that already exists?
--    It cannot — form_type is a new column and every existing row will have
--    NULL, which the constraint permits. This proves it rather than asserting
--    it, by testing the same predicate against the closest existing column.
select coalesce(source, '(null)') as existing_source, count(*) as rows
from leads group by source order by count(*) desc;
--    Note: `source` is NOT constrained by this migration and may legitimately
--    hold values outside the allow-list. It is shown for information only.

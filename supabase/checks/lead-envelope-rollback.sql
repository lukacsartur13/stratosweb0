-- =============================================================================
-- ROLLBACK for 20260805000100_lead_envelope.sql
--
-- Reverses the migration exactly. Safe to run more than once.
--
-- READ THIS BEFORE RUNNING
-- ------------------------
-- This is only lossless while the OLD application code is deployed. The
-- migration itself destroys nothing, but the rollback drops five columns — and
-- once the NEW function has stored even one lead, those columns hold data that
-- exists nowhere else:
--
--   * `payload` holds the questionnaire answers as structure. The prose
--     transcript in `message` survives, so the answers are not lost outright,
--     but the structure is.
--   * `submission_id` is the idempotency key. Dropping it means a retry of an
--     in-flight submission can create a second lead.
--   * `meta`, `form_type` and `source_route` are lost entirely. `source` still
--     carries the same value as `form_type`, so that one fact survives.
--
-- So: roll back freely between applying the migration and deploying the new
-- code. After the new code is live, export first — section 0 below.
--
-- Order matters. The index and the constraint are dropped before their
-- columns; `DROP COLUMN` would take them with it, but doing it explicitly
-- means a partial rollback leaves an obvious state rather than a subtle one.
-- =============================================================================

-- 0. OPTIONAL SAFETY NET. Run this first if any lead has been written by the
--    new code. It copies the five columns somewhere the rollback will not
--    touch, so nothing is unrecoverable.
--
--    Check whether it is needed:
--        select count(*) from leads where submission_id is not null;
--    If that is 0, skip this section.
--
-- create table if not exists leads_envelope_backup as
--   select id, submission_id, form_type, source_route, payload, meta
--   from leads
--   where submission_id is not null
--      or form_type is not null
--      or source_route is not null
--      or payload <> '{}'::jsonb
--      or meta <> '{}'::jsonb;
--
-- select count(*) as rows_backed_up from leads_envelope_backup;

-- 1. Indexes.
drop index if exists public.leads_submission_id_key;
drop index if exists public.leads_form_type_idx;

-- 2. Constraint.
alter table leads drop constraint if exists leads_form_type_check;

-- 3. Columns. `if exists` on each, so a partially-applied migration rolls back
--    as cleanly as a complete one.
alter table leads drop column if exists submission_id;
alter table leads drop column if exists form_type;
alter table leads drop column if exists source_route;
alter table leads drop column if exists payload;
alter table leads drop column if exists meta;

-- 4. Verify. Expected: 0 rows, then 17.
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'leads'
  and column_name in ('submission_id', 'form_type', 'source_route', 'payload', 'meta');

select count(*) as columns_remaining from information_schema.columns
where table_schema = 'public' and table_name = 'leads';

-- 5. Nothing else changed. RLS still on and forced, same two policies, same
--    trigger, same row count.
select relrowsecurity, relforcerowsecurity from pg_class
where oid = 'public.leads'::regclass;

select policyname from pg_policies
where schemaname = 'public' and tablename = 'leads' order by policyname;

select count(*) as lead_rows from leads;

-- 6. If the migration is also to be un-recorded so the CLI will re-apply it:
--
-- delete from supabase_migrations.schema_migrations
--  where version = '20260805000100';
--
--    Leave this commented unless you intend to re-apply. Deleting the row
--    without dropping the columns above would make the CLI re-run a migration
--    whose guards would then make it a no-op — harmless, but confusing.

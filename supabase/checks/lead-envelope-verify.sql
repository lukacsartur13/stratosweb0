-- =============================================================================
-- POST-MIGRATION VERIFICATION for 20260805000100_lead_envelope.sql
--
-- Run in the Supabase SQL editor AFTER applying the migration and BEFORE
-- deploying the new function and portal.
--
-- Sections 1-7 are read-only. Section 8 writes inside an explicit transaction
-- that ends in ROLLBACK, so it leaves nothing behind — it is the only way to
-- prove the partial unique index actually behaves as claimed rather than
-- merely existing.
-- =============================================================================

-- 1. All five columns exist, with the right type, nullability and default.
--
--    Expected:
--      submission_id  uuid   YES  (no default)
--      form_type      text   YES  (no default)
--      source_route   text   YES  (no default)
--      payload        jsonb  NO   '{}'::jsonb
--      meta           jsonb  NO   '{}'::jsonb
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'leads'
  and column_name in ('submission_id', 'form_type', 'source_route', 'payload', 'meta')
order by column_name;

-- 2. Nothing that existed before was renamed or removed. Expected: 17.
select count(*) as original_columns_still_present
from information_schema.columns
where table_schema = 'public' and table_name = 'leads'
  and column_name in (
    'id', 'name', 'company', 'email', 'phone', 'website', 'service_interest',
    'budget_range', 'timeframe', 'message', 'source', 'locale', 'status',
    'ip_hash', 'user_agent', 'created_at', 'updated_at');

-- 3. Total columns. Expected: 22 (17 + 5).
select count(*) as total_columns
from information_schema.columns
where table_schema = 'public' and table_name = 'leads';

-- 4. Both indexes exist, and the unique one carries the partial predicate.
--
--    Expected for leads_submission_id_key:
--      CREATE UNIQUE INDEX … ON public.leads USING btree (submission_id)
--        WHERE (submission_id IS NOT NULL)
--
--    The WHERE clause is the whole point. Without it the index would be a
--    plain unique index, and a second legacy row with a NULL submission_id
--    would still be fine (SQL NULLs never collide) — but a later NOT NULL
--    would have nothing to stand on and the intent would be lost.
select indexname, indexdef from pg_indexes
where schemaname = 'public' and tablename = 'leads'
  and indexname in ('leads_submission_id_key', 'leads_form_type_idx')
order by indexname;

-- 5. The CHECK constraint exists and permits NULL.
--
--    Expected:
--      CHECK (form_type IS NULL OR form_type = ANY (ARRAY['newsletter',
--             'contact', 'impact', 'questionnaire', 'website']))
select conname, pg_get_constraintdef(oid) as definition, convalidated
from pg_constraint
where conrelid = 'public.leads'::regclass and conname = 'leads_form_type_check';

-- 6. Existing rows are intact and correctly defaulted.
--
--    Expected: total unchanged from preflight; every pre-existing row has
--    payload = {} and meta = {} and NULL in the three nullable new columns.
select
  count(*)                                              as total_rows,
  count(*) filter (where payload = '{}'::jsonb)         as payload_defaulted,
  count(*) filter (where meta = '{}'::jsonb)            as meta_defaulted,
  count(*) filter (where payload is null)               as payload_null_must_be_0,
  count(*) filter (where meta is null)                  as meta_null_must_be_0,
  count(*) filter (where submission_id is null)         as legacy_rows_without_submission_id,
  count(*) filter (where form_type is null)             as legacy_rows_without_form_type
from leads;

-- 7. RLS and policies unchanged. Expected: t / t, and the same two policies.
select relrowsecurity as rls_enabled, relforcerowsecurity as rls_forced
from pg_class where oid = 'public.leads'::regclass;

select policyname, cmd from pg_policies
where schemaname = 'public' and tablename = 'leads' order by policyname;

-- 8. The index actually behaves. Writes, then rolls back — nothing persists.
--
--    Proves three things the DDL above only implies:
--      a. several NULL submission_ids can coexist  (legacy rows stay valid);
--      b. two equal non-null ids cannot            (idempotency is real);
--      c. the NOT NULL defaults fill themselves in (old code keeps working).
begin;

  -- (c) an insert shaped exactly like the OLD deployed function's, naming
  --     none of the new columns. It must succeed.
  insert into leads (name, email, source, locale, message)
  values ('ZZ preflight legacy A', 'zz-a@example.invalid', 'contact', 'hu', 'rollback me');

  insert into leads (name, email, source, locale, message)
  values ('ZZ preflight legacy B', 'zz-b@example.invalid', 'contact', 'hu', 'rollback me');

  -- (a) both landed, both with NULL submission_id and defaulted jsonb.
  select name, submission_id, form_type, payload, meta
  from leads where email like 'zz-%@example.invalid' order by name;

  -- (b) two rows with the SAME non-null id must not both exist.
  insert into leads (name, email, source, locale, submission_id, form_type)
  values ('ZZ preflight dup 1', 'zz-d@example.invalid', 'contact', 'hu',
          '00000000-0000-4000-8000-000000000001', 'contact');

  -- This one must FAIL with:
  --   ERROR: duplicate key value violates unique constraint
  --          "leads_submission_id_key"
  -- That error is the pass condition. If it inserts, the index is wrong and
  -- the migration must not be treated as applied.
  insert into leads (name, email, source, locale, submission_id, form_type)
  values ('ZZ preflight dup 2', 'zz-e@example.invalid', 'contact', 'hu',
          '00000000-0000-4000-8000-000000000001', 'contact');

rollback;

-- 9. Confirm section 8 left nothing. Expected: 0.
select count(*) as leftover_test_rows
from leads where email like 'zz-%@example.invalid';

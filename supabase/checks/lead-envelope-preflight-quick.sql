-- =============================================================================
-- PREFLIGHT — one query, one table of answers.
--
-- The same checks as lead-envelope-preflight.sql, collapsed into a single
-- result set so the Supabase SQL editor can show all of them at once. Paste the
-- whole file, press Run, read the `ok` column.
--
-- Read-only. Nothing here writes, locks or changes anything.
--
-- Use the long version when something reads LOOK and you need the detail —
-- which index, which policy, which grant.
-- =============================================================================

with checks as (

  -- The migration relies on PG 11+ behaviour: ADD COLUMN with a constant
  -- DEFAULT is metadata-only and does not rewrite the table.
  select 1 as n,
         'PostgreSQL major version' as item,
         split_part(split_part(version(), ' ', 2), '.', 1) as value,
         '11 or higher' as want,
         split_part(split_part(version(), ' ', 2), '.', 1)::int >= 11 as ok

  -- Informational: this is what makes "the lock window is instant" true or
  -- false for this project. A few thousand rows is nothing.
  union all
  select 2, 'Existing lead rows',
         (select count(*)::text from leads),
         'any — informational', true

  union all
  select 3, 'Current columns on leads',
         (select count(*)::text from information_schema.columns
           where table_schema = 'public' and table_name = 'leads'),
         '17',
         (select count(*) from information_schema.columns
           where table_schema = 'public' and table_name = 'leads') = 17

  -- 4-6: has any part of the migration already been applied? All three must be
  -- zero for a clean first run.
  union all
  select 4, 'New columns already present',
         (select count(*)::text from information_schema.columns
           where table_schema = 'public' and table_name = 'leads'
             and column_name in ('submission_id','form_type','source_route','payload','meta')),
         '0',
         (select count(*) from information_schema.columns
           where table_schema = 'public' and table_name = 'leads'
             and column_name in ('submission_id','form_type','source_route','payload','meta')) = 0

  union all
  select 5, 'New indexes already present',
         (select count(*)::text from pg_indexes
           where schemaname = 'public' and tablename = 'leads'
             and indexname in ('leads_submission_id_key','leads_form_type_idx')),
         '0',
         (select count(*) from pg_indexes
           where schemaname = 'public' and tablename = 'leads'
             and indexname in ('leads_submission_id_key','leads_form_type_idx')) = 0

  union all
  select 6, 'New constraint already present',
         (select count(*)::text from pg_constraint
           where conrelid = 'public.leads'::regclass
             and conname = 'leads_form_type_check'),
         '0',
         (select count(*) from pg_constraint
           where conrelid = 'public.leads'::regclass
             and conname = 'leads_form_type_check') = 0

  -- New columns inherit TABLE-level grants automatically. A real COLUMN-level
  -- grant would break that inheritance and leave the new columns unreadable.
  --
  -- Reads pg_attribute.attacl, which is non-null only for an explicit
  -- `GRANT … (column)` or column-level REVOKE. This check used to read
  -- information_schema.column_privileges, which is defined over pg_class.relacl
  -- too and therefore expands ordinary table-level grants into one row per
  -- column — a few hundred rows on a stock Supabase project, reported as a
  -- finding every single time. Measured here: attacl empty, column_privileges
  -- full. The view was answering a different question.
  union all
  select 7, 'Real column-level grants on leads',
         (select count(*)::text from pg_attribute
           where attrelid = 'public.leads'::regclass
             and attnum > 0 and not attisdropped and attacl is not null),
         '0',
         (select count(*) from pg_attribute
           where attrelid = 'public.leads'::regclass
             and attnum > 0 and not attisdropped and attacl is not null) = 0

  -- 8-10: recorded now so the post-migration check can prove they are unchanged.
  union all
  select 8, 'RLS enabled',
         (select relrowsecurity::text from pg_class where oid = 'public.leads'::regclass),
         'true',
         (select relrowsecurity from pg_class where oid = 'public.leads'::regclass)

  union all
  select 9, 'RLS forced',
         (select relforcerowsecurity::text from pg_class where oid = 'public.leads'::regclass),
         'true',
         (select relforcerowsecurity from pg_class where oid = 'public.leads'::regclass)

  union all
  select 10, 'Policies on leads',
         (select count(*)::text from pg_policies
           where schemaname = 'public' and tablename = 'leads'),
         '2',
         (select count(*) from pg_policies
           where schemaname = 'public' and tablename = 'leads') = 2

  union all
  select 11, 'Triggers on leads',
         (select count(*)::text from pg_trigger
           where tgrelid = 'public.leads'::regclass and not tgisinternal),
         '1 (leads_updated_at)',
         (select count(*) from pg_trigger
           where tgrelid = 'public.leads'::regclass and not tgisinternal) = 1
)

select n              as "#",
       item           as "check",
       value          as "found",
       want           as "expected",
       case when ok then 'OK' else 'LOOK' end as "verdict"
from checks
order by n;

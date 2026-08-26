-- =============================================================================
-- STRATOS SALES PIPELINE — STEP 1 of 2: enum values
--
-- RUN THIS ON ITS OWN, FIRST, AND LET IT COMMIT BEFORE RUNNING STEP 2.
--
-- WHY IT IS A SEPARATE RUN
-- ------------------------
-- The Supabase SQL editor executes a submitted script as ONE implicit
-- transaction. `ALTER TYPE ... ADD VALUE` is permitted inside a transaction on
-- Postgres 12+, but the value it adds CANNOT BE USED until that transaction has
-- committed. Nothing in step 2 uses these values, so one combined script would
-- in fact work — this is split anyway because "would in fact work" is a claim
-- about the current text of step 2, and a separate 40-millisecond run is a
-- cheaper guarantee than that claim.
--
-- Both statements are additive and take NO table lock. Adding a value to an
-- enum does not rewrite the column, the table or any row. `leads` keeps every
-- row, every status and every payload it has.
--
-- Safe to run more than once: both are `if not exists`.
--
-- Expected result: "Success. No rows returned."
-- =============================================================================

-- From 20260814000100_lead_pipeline.sql -------------------------------------
-- The pipeline is New -> Contacted -> Qualified -> Proposal -> Won / Lost, and
-- `proposal` is the one stage the original enum did not have. `spam` is
-- deliberately kept: rows already carry it, and dropping an enum value is not
-- possible without the table rewrite this avoids.
--
-- NOT wrapped in a DO block with an exception handler. Such a block runs its
-- body in a subtransaction, which is the one context Postgres still refuses
-- `ALTER TYPE ... ADD VALUE` in — and the handler would then swallow the
-- refusal, reporting success while adding nothing.
alter type lead_status add value if not exists 'proposal' after 'qualified';

-- From 20260816000100_revenue_operations.sql --------------------------------
-- `project_status` is EXTENDED, never replaced. The existing six labels
-- (discovery, design, build, launch, care, archived) are a PHASE vocabulary and
-- are kept; these six are the operational STATE vocabulary. Every existing
-- project keeps rendering under its own label.
--
-- A plain loop with no exception handler, for the same reason as above.
do $$
declare v text;
begin
  foreach v in array array['planned', 'active', 'client_review',
                           'blocked', 'on_hold', 'completed']
  loop
    execute format('alter type project_status add value if not exists %L', v);
  end loop;
end $$;

-- ---------------------------------------------------------------- confirm --
-- Expected: lead_status includes `proposal`; project_status has TWELVE labels —
-- the original six (discovery, design, build, launch, care, archived) plus the
-- six operational ones (planned, active, client_review, blocked, on_hold,
-- completed). The two lists do not overlap, so nothing is deduplicated.
select t.typname, array_agg(e.enumlabel order by e.enumsortorder) as labels
from pg_type t join pg_enum e on e.enumtypid = t.oid
where t.typname in ('lead_status', 'project_status')
group by t.typname
order by 1;

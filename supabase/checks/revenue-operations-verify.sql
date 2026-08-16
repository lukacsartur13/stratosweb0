-- =============================================================================
-- POST-MIGRATION VERIFICATION for 20260816000100_revenue_operations.sql
--
-- Run in the Supabase SQL editor AFTER applying the migration and BEFORE
-- deploying the P2 portal bundle.
--
-- Sections 1-8 are read-only. Section 9 writes inside an explicit transaction
-- that ends in ROLLBACK, so it leaves nothing behind — it is the only way to
-- prove that the audit triggers, the close stamps and the constraints actually
-- behave as claimed rather than merely existing.
-- =============================================================================


-- 1. Every new table exists, with RLS enabled AND forced.
--
--    Expected: six rows, both columns `t`.
select c.relname, c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('opportunities', 'client_contacts', 'project_milestones',
                    'project_costs', 'project_links', 'record_notes')
order by 1;


-- 2. Every policy that should exist, and nothing that should not.
--
--    Expected, and this is the important part: NO row with cmd = 'DELETE' for
--    `opportunities`. §41 — business records are archived, never deleted, and the
--    guarantee is that no delete policy exists at all.
select tablename, policyname, cmd, roles::text
from pg_policies
where schemaname = 'public'
  and tablename in ('opportunities', 'client_contacts', 'project_milestones',
                    'project_costs', 'project_links', 'record_notes')
order by tablename, cmd, policyname;


-- 3. `anon` holds no privilege on any new table.
--
--    Expected: ZERO rows. If this returns anything, an unauthenticated caller is
--    relying on RLS alone rather than on RLS behind a closed privilege door.
select table_name, privilege_type
from information_schema.role_table_grants
where grantee = 'anon'
  and table_schema = 'public'
  and table_name in ('opportunities', 'client_contacts', 'project_milestones',
                     'project_costs', 'project_links', 'record_notes')
order by 1, 2;


-- 4. The enums carry what they should, and `project_status` kept its old values.
--
--    Expected: project_status has ELEVEN labels — the original six plus the six
--    operational ones, minus the overlap ('archived' is in both lists only once).
select t.typname, array_agg(e.enumlabel order by e.enumsortorder) as labels
from pg_type t join pg_enum e on e.enumtypid = t.oid
where t.typname in ('opportunity_stage', 'opportunity_lost_reason', 'milestone_state',
                    'payment_state', 'project_cost_category', 'project_status', 'lead_status')
group by t.typname
order by 1;


-- 5. The new columns landed on the existing tables, and every one is nullable
--    or defaulted — nothing here can have invalidated an existing row.
select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and (
    (table_name = 'organizations' and column_name in
      ('acquisition_source', 'acquisition_medium', 'acquisition_campaign',
       'primary_service', 'archived_at'))
    or (table_name = 'projects' and column_name in
      ('service', 'value', 'currency', 'opportunity_id', 'responsible_id',
       'estimated_hours', 'actual_hours', 'payment_state', 'invoiced_amount',
       'paid_amount', 'completed_at', 'archived_at'))
  )
order by table_name, column_name;


-- 6. No existing row was invalidated.
--
--    Expected: both counts equal to the table's total. If `projects` had rows
--    before this migration they now carry currency 'HUF' and payment_state
--    'not_invoiced' by default, which is the honest starting value for both.
select
  (select count(*) from projects)                                as projects_total,
  (select count(*) from projects where currency = 'HUF')         as projects_defaulted,
  (select count(*) from organizations)                           as clients_total,
  (select count(*) from organizations where archived_at is null) as clients_live,
  (select count(*) from leads)                                   as leads_untouched;


-- 7. The functions exist, and the two aggregates are SECURITY INVOKER.
--
--    Expected: prosecdef = false for portal_sales_summary and
--    portal_revenue_attribution. A `true` here means the pipeline is readable by
--    any authenticated account regardless of policy, which is the one failure
--    mode of this migration that would not announce itself.
select p.proname, p.prosecdef as security_definer, p.provolatile as volatility
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('portal_sales_summary', 'portal_revenue_attribution',
                    'opportunity_default_probability', 'opportunity_close_stamp',
                    'milestone_complete_stamp', 'log_business_change',
                    'log_project_cost_change', 'is_supported_currency')
order by 1;


-- 8. The aggregates run and return sane shapes against an empty book.
--
--    Expected: portal_sales_summary returns zero rows on an empty database (no
--    opportunities, no projects, no active clients) rather than erroring, and
--    the attribution function returns one row per lead source that exists.
select * from portal_sales_summary();
select * from portal_revenue_attribution('source');
select * from portal_revenue_attribution('campaign');
-- Expected: ERROR invalid_parameter_value. An unsupported dimension must fail
-- loudly rather than quietly answering about something else.
-- select * from portal_revenue_attribution('email');


-- =============================================================================
-- 9. BEHAVIOUR — writes, inside a transaction that is rolled back.
--
-- Run this block as a whole. It ends in ROLLBACK and leaves nothing behind.
-- =============================================================================
begin;

-- 9a. An opportunity with neither a client nor a company name must be refused.
--     Expected: ERROR, opportunities_party_check.
-- insert into opportunities (title) values ('floating value');

-- 9b. A probability outside 0-100 must be refused.
--     Expected: ERROR, opportunities_probability_check.
-- insert into opportunities (title, company_name, probability)
-- values ('bad odds', 'Test Kft.', 120);

-- 9c. A won opportunity is stamped by the database, not by the caller.
insert into opportunities (id, title, company_name, stage, estimated_value, probability)
values ('00000000-0000-4000-8000-0000000000ff', 'verification deal', 'Test Kft.',
        'proposal', 1000000, 60);

update opportunities set stage = 'won'
where id = '00000000-0000-4000-8000-0000000000ff';

--     Expected: one row, won_at NOT NULL, lost_at NULL, probability 100.
select stage, probability, won_at is not null as won_stamped, lost_at
from opportunities where id = '00000000-0000-4000-8000-0000000000ff';

--     Expected: 'opportunity.created' and 'opportunity.stage_changed', in that
--     order, written by the trigger and NOT by any application code.
select action, metadata
from activity_logs
where entity_type = 'opportunity'
  and entity_id = '00000000-0000-4000-8000-0000000000ff'
order by created_at;

-- 9d. A lost reason on a non-lost deal must be refused.
--     Expected: ERROR, opportunities_lost_reason_check.
-- update opportunities set lost_reason = 'price'
-- where id = '00000000-0000-4000-8000-0000000000ff';

-- 9e. The pipeline aggregate sees it, grouped by currency.
--     Expected: a `won_mtd` row, currency HUF, items 1, value 1000000.
select * from portal_sales_summary() where bucket like 'won%';

rollback;

-- =============================================================================
-- 10. THE ONE THING THIS FILE CANNOT PROVE FROM THE SQL EDITOR
--
-- Every query above runs as `postgres`, which holds BYPASSRLS. That means
-- section 9 proves the triggers and constraints work; it does NOT prove that an
-- ordinary authenticated session is refused.
--
-- To prove that, sign in to the Portal as a `client`-role account and confirm
-- that `/portal/sales` is empty rather than populated, or run:
--
--     set local role authenticated;
--     set local request.jwt.claims = '{"sub":"<a client account uuid>"}';
--     select count(*) from opportunities;   -- expected: 0
--     reset role;
--
-- And confirm that an ANONYMOUS PostgREST call is refused outright:
--
--     curl -s "$SUPABASE_URL/rest/v1/opportunities?select=id" \
--          -H "apikey: $SUPABASE_ANON_KEY"
--     -- expected: a permission error, NOT an empty array.
--
-- An empty array would mean the request reached RLS. A permission error means it
-- did not get that far, which is the belt to RLS's braces.
-- =============================================================================

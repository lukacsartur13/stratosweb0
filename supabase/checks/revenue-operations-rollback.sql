-- =============================================================================
-- ROLLBACK for 20260816000100_revenue_operations.sql
--
-- Reverses everything the migration can reverse. Safe to run more than once.
--
-- READ THIS BEFORE RUNNING
-- ------------------------
-- The migration itself destroys nothing. This rollback DROPS TABLES, and the
-- data in them exists nowhere else:
--
--   * `opportunities` is the entire commercial pipeline — every deal, its value,
--     its stage, its close date and its lost reason.
--   * `project_costs` is every direct cost. Without it no contribution figure
--     can be recomputed.
--   * `project_milestones`, `project_links`, `client_contacts`, `record_notes`
--     are lost outright.
--   * The audit entries in `activity_logs` SURVIVE — they are in a table this
--     rollback does not touch — but they will point at ids that no longer
--     resolve.
--
-- So: roll back freely between applying the migration and using the Portal.
-- After a single opportunity has been created, export first — section 0.
--
-- WHAT CANNOT BE ROLLED BACK
-- --------------------------
-- The six values added to `project_status`. Postgres cannot drop an enum value
-- without rewriting every table that uses the type, which is exactly the
-- exclusive lock the migration was designed to avoid taking. They are inert: no
-- row uses them unless the Portal wrote one, and section 4 below moves any row
-- that does back onto a legacy value so the type is once again unused by data.
--
-- This is the one irreversible thing in the migration and it is why §42's
-- "reversible where practical" is answered with "reversible, except for six
-- unused enum labels".
-- =============================================================================


-- ---------------------------------------------------------------- 0. export
-- Run these FIRST if the Portal has been used. Save the output.
--
--   select * from opportunities;
--   select * from project_costs;
--   select * from project_milestones;
--   select * from project_links;
--   select * from client_contacts;
--   select * from record_notes;
--   select id, name, service, value, currency, opportunity_id, responsible_id,
--          estimated_hours, actual_hours, payment_state, invoiced_amount,
--          paid_amount, completed_at, archived_at
--     from projects;
--   select id, name, acquisition_source, acquisition_medium,
--          acquisition_campaign, primary_service, archived_at
--     from organizations;


-- ------------------------------------------------------------- 1. triggers
-- Before the functions, and before the tables: a trigger left behind pointing
-- at a dropped function is an error on the next write to a table that survives.
drop trigger if exists opportunities_audit_insert  on opportunities;
drop trigger if exists opportunities_audit_update  on opportunities;
drop trigger if exists opportunities_close_stamp   on opportunities;
drop trigger if exists opportunities_updated_at    on opportunities;
drop trigger if exists organizations_audit_insert  on organizations;
drop trigger if exists organizations_audit_update  on organizations;
drop trigger if exists projects_audit_insert       on projects;
drop trigger if exists projects_audit_update       on projects;
drop trigger if exists project_costs_audit         on project_costs;
drop trigger if exists project_milestones_complete on project_milestones;
drop trigger if exists project_milestones_updated_at on project_milestones;
drop trigger if exists client_contacts_updated_at  on client_contacts;


-- ------------------------------------------------------------ 2. functions
drop function if exists portal_sales_summary();
drop function if exists portal_revenue_attribution(text);
drop function if exists log_business_change();
drop function if exists log_project_cost_change();
drop function if exists opportunity_close_stamp();
drop function if exists milestone_complete_stamp();
drop function if exists opportunity_default_probability(opportunity_stage);


-- --------------------------------------------------------------- 3. tables
-- Order matters: `projects.opportunity_id` references `opportunities`, so the
-- constraint goes before the table it points at.
alter table projects drop constraint if exists projects_opportunity_id_fkey;

drop table if exists record_notes;
drop table if exists project_links;
drop table if exists project_costs;
drop table if exists project_milestones;
drop table if exists client_contacts;
drop table if exists opportunities;


-- ------------------------------------------- 4. columns on existing tables
-- Move any row that took an operational status back to a legacy value FIRST, so
-- that after this rollback no row anywhere uses one of the six labels that
-- cannot be removed.
update projects set status = 'discovery'
where status::text in ('planned', 'active', 'client_review', 'blocked', 'on_hold');
update projects set status = 'archived'
where status::text = 'completed';

alter table projects drop constraint if exists projects_value_check;
alter table projects drop constraint if exists projects_currency_check;
alter table projects drop constraint if exists projects_hours_check;
alter table projects drop constraint if exists projects_payment_amounts_check;

drop index if exists projects_opportunity_idx;
drop index if exists projects_responsible_idx;
drop index if exists projects_target_idx;
drop index if exists organizations_name_norm_idx;

alter table projects drop column if exists service;
alter table projects drop column if exists value;
alter table projects drop column if exists currency;
alter table projects drop column if exists opportunity_id;
alter table projects drop column if exists responsible_id;
alter table projects drop column if exists estimated_hours;
alter table projects drop column if exists actual_hours;
alter table projects drop column if exists payment_state;
alter table projects drop column if exists invoiced_amount;
alter table projects drop column if exists paid_amount;
alter table projects drop column if exists completed_at;
alter table projects drop column if exists archived_at;

alter table organizations drop column if exists acquisition_source;
alter table organizations drop column if exists acquisition_medium;
alter table organizations drop column if exists acquisition_campaign;
alter table organizations drop column if exists primary_service;
alter table organizations drop column if exists archived_at;


-- ---------------------------------------------------------------- 5. types
-- These are only droppable because sections 3 and 4 removed every column that
-- used them. `payment_state` in particular cannot go until
-- `projects.payment_state` has.
drop type if exists opportunity_stage;
drop type if exists opportunity_lost_reason;
drop type if exists milestone_state;
drop type if exists payment_state;
drop type if exists project_cost_category;
drop function if exists is_supported_currency(text);

-- `project_status` is NOT dropped and its six added labels are NOT removed.
-- See the note at the top of this file.


-- -------------------------------------------------------------- 6. confirm
--   Expected: zero rows.
select c.relname
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('opportunities', 'client_contacts', 'project_milestones',
                    'project_costs', 'project_links', 'record_notes');

--   Expected: zero rows — no project is left on an operational status.
select id, name, status from projects
where status::text in ('planned', 'active', 'client_review',
                       'blocked', 'on_hold', 'completed');

-- =============================================================================
-- Payment schedule (phase 5) — ROLLBACK of 20261002000100_payment_schedule.sql.
--
-- Returns the Portal to the single-sum payment fields and KEEPS EVERY ROW:
--
--   * the derive trigger is dropped, so `projects.payment_state`,
--     `invoiced_amount` and `paid_amount` are editable by hand again. They keep
--     the values the schedule last derived — which include every payment
--     recorded meanwhile — so nothing that arrived is forgotten on screen.
--   * the schedule tables are closed to the API (every grant revoked from
--     `anon` and `authenticated`); the owner reads them in the SQL editor.
--   * `opportunity_complete_action` and `project_payment_overview` are revoked
--     from the API roles. The Portal built for phase 5 then reports "could not
--     be read" on the schedule panel and "Done" fails with a message; deploy the
--     previous Portal with this rollback.
--
-- NOT deleted, NOT changed: project_instalments, project_payments,
-- project_finance_legacy, their audit entries, every project row. The rule
-- triggers stay (they only guard the rows that stay).
--
-- Re-applying 20261002000100_payment_schedule.sql restores the schedule exactly
-- (tested in tests/portal-payments-db.spec.ts). Its carry-over skips every
-- project already in the snapshot. CAUTION: if the single-sum fields were
-- edited by hand while rolled back, re-applying makes the schedule the source
-- again and the derive trigger REPLACES those hand edits with what the schedule
-- says — the verify script's doubtful-case list and the activity log show what
-- changed; enter the missing payments into the schedule first.
-- =============================================================================

drop trigger if exists projects_zz_payment_derive on projects;
drop trigger if exists projects_currency_fixed on projects;

do $$
declare
  f text;
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table project_instalments, project_payments, project_finance_legacy from %I', r);
      foreach f in array array[
        'project_payment_overview(uuid)', 'project_payment_derived(uuid, numeric)',
        'opportunity_complete_action(uuid, text)'
      ] loop
        execute format('revoke all on function %s from %I', f, r);
      end loop;
    end if;
  end loop;
end $$;

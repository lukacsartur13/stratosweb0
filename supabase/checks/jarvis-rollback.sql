-- =============================================================================
-- Jarvis (phase 2) — ROLLBACK of 20261019000300_jarvis.sql.
--
-- Closes the Jarvis tables to the API and KEEPS EVERY ROW: every grant is
-- revoked from `anon` and `authenticated`, so the Portal and /api/jarvis can
-- neither read nor write them; the owner still reads them in the SQL editor.
-- The activity-log trigger stays (it only fires on writes, and none can come).
--
-- Nothing else in the Portal depends on these tables, so the rest keeps
-- working unchanged. Re-applying 20261019000300_jarvis.sql restores the grants
-- exactly (it is re-runnable).
--
-- To remove Jarvis for good instead — conversations, actions, memory and all —
-- run the commented block at the end. The 'jarvis.*' rows of activity_logs stay.
-- =============================================================================

do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table jarvis_threads, jarvis_messages, jarvis_runs, jarvis_actions,
                                         jarvis_memory, jarvis_settings, jarvis_usage from %I', r);
    end if;
  end loop;
end $$;

-- drop table if exists jarvis_actions, jarvis_messages, jarvis_runs, jarvis_threads,
--                      jarvis_memory, jarvis_settings, jarvis_usage;
-- drop function if exists jarvis_threads_rules(), jarvis_messages_rules(), jarvis_actions_rules(),
--                         jarvis_actions_log(), jarvis_memory_rules(), jarvis_settings_rules(), jarvis_count_usage();

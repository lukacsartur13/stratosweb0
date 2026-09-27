-- =============================================================================
-- Stratos — owner tracker, step 1 of 3: the one enum value
--
-- `waiting_client` is the checkpoint state "waiting on the client". It is the
-- only thing in this phase that cannot live in the same script as the rest,
-- for the reason `20260814000100_lead_pipeline.sql` records: a value added by
-- ALTER TYPE cannot be USED in the transaction that added it, and the next
-- migration's code refers to the state by name.
--
-- A bare top-level statement, not a `do $$ … exception … $$` block — see that
-- file for why a handler would turn a refusal into a silent success.
--
-- Irreversible in the Postgres sense (an enum value cannot be dropped without
-- rewriting the table), and inert: nothing uses it until step 2 is applied.
--
-- Run after 20260816000100_revenue_operations.sql, ALONE, and let it commit.
-- =============================================================================

alter type milestone_state add value if not exists 'waiting_client' after 'in_progress';

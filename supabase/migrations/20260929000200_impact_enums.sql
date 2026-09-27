-- =============================================================================
-- Stratos — Impact, step 1 of 2: the one enum value
--
-- `cancelled` is the project state "this fell through". It is separate from
-- `completed` (delivered) and from `archived_at` (put away, a layout action):
-- an Impact project that fell through must count as neither committed nor
-- delivered support, and archiving must never change either figure. See
-- OWNER_TRACKER.md §8, where this was recorded as a requirement.
--
-- Alone, for the reason 20260928000100_owner_tracker_enums.sql gives: a value
-- added by ALTER TYPE cannot be USED in the transaction that added it, and the
-- next migration refers to it by name. A bare top-level statement, never a
-- `do $$ … exception … $$` block.
--
-- Inert until step 2: nothing sets or reads it before then.
--
-- Run after 20260928000300_owner_lockdown.sql, ALONE, and let it commit.
-- =============================================================================

alter type project_status add value if not exists 'cancelled';

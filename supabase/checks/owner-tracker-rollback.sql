-- =============================================================================
-- Owner tracker — ROLLBACK of step 2 (20260928000200_owner_tracker.sql).
--
-- Run owner-lockdown-rollback.sql FIRST if step 3 was applied: step 3's
-- policies call is_owner(), which this script keeps anyway, but the order keeps
-- the reasoning simple.
--
-- WHAT THIS REMOVES: behaviour only.
--   * the close rule on projects (projects_close_rules)
--   * the checkpoint freeze and blocked-reason reset (project_milestones_tracker_rules)
--   * the "blocked needs a reason and a next step" constraint
--
-- WHAT THIS KEEPS, deliberately — nothing written in the meantime is deleted:
--   * the four new checkpoint columns and every value in them
--   * checkpoint_templates and every template the owner edited or created
--   * portal_owner, is_owner(), portal_set_owner()
--   * every `waiting_client` checkpoint. The enum value cannot be dropped, and
--     rewriting those rows to another state would be inventing history; the
--     previous Portal renders an unknown state by its raw name.
--   * every completed_at the trigger stamped
-- =============================================================================

begin;

drop trigger if exists projects_close_rules on projects;
drop trigger if exists project_milestones_tracker_rules on project_milestones;
alter table project_milestones drop constraint if exists project_milestones_blocked_check;

commit;

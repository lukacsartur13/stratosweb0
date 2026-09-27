-- =============================================================================
-- Stratos — project_links.url: a check that can actually be evaluated
--
-- THE DEFECT
-- ----------
-- 20260816000100_revenue_operations.sql declared
--
--     url text not null check (url ~* '^https?://[^\s]{3,500}$')
--
-- Postgres regular expressions cap a bounded repetition at 255 (RE_DUP_MAX in
-- the regex engine every Postgres version ships). `{3,500}` is therefore not a
-- pattern that fails to match — it is a pattern that fails to COMPILE, and it is
-- compiled on every insert and every update of `url`:
--
--     ERROR 2201B: invalid regular expression: invalid repetition count(s)
--
-- So no project link has ever been storable. Reproduced on Postgres 18.3
-- (PGlite) before this file was written; `{3,255}` compiles, `{3,256}` does not.
--
-- THE FIX
-- -------
-- The same rule, split so that no repetition count is needed: the scheme is
-- http or https, what follows is at least three characters with no whitespace,
-- and what follows is at most 500 characters. Identical to what the original was
-- evidently meant to say, and to `safeUrl()` / `addLink()` in the Portal.
--
-- Idempotent: drop-if-exists then add, so it may be re-run. The table can hold
-- no rows written under the old check (every such write failed), so the new
-- constraint is validated immediately; a row that somehow violates it makes
-- this file fail loudly rather than be skipped.
--
-- Independent of every other migration of this date. Run after
-- 20260816000100_revenue_operations.sql; any time after that is fine.
-- =============================================================================

alter table project_links drop constraint if exists project_links_url_check;

alter table project_links add constraint project_links_url_check check (
  url ~* '^https?://[^[:space:]]{3,}$'
  and char_length(regexp_replace(url, '^[A-Za-z]+://', '')) <= 500
);

comment on column project_links.url is
  'http/https only, 3-500 characters after the scheme, no whitespace. Enforced here AND by safeUrl() at render time.';

-- =============================================================================
-- Stratos — the canonical lead record
--
-- The public site posts one envelope shape to POST /api/lead:
--
--     { submissionId, formType, locale, route, fields, meta }
--
-- Before this migration the `leads` table could hold the flattened commercial
-- summary of a submission (name, email, budget_range, a prose `message`) but
-- not the submission itself: which form it came from as a checked value rather
-- than a free-text `source`, which page it was sent from, the validated answers
-- as data rather than as a transcript, or any way to tell a retry from a second
-- enquiry.
--
-- This adds those five things and changes nothing that already exists. Every
-- column below is nullable or defaulted, so existing rows stay valid and the
-- portal's current `select` lists keep working untouched.
--
-- Run after 20260801000200_rls.sql.
-- =============================================================================

-- --------------------------------------------------------------- idempotency
-- The client generates a UUID once per submission attempt and re-sends the same
-- one on retry. The unique index is the guarantee: two concurrent inserts of
-- the same submission cannot both win, because Postgres decides, not the
-- function. See the ON CONFLICT path in netlify/functions/submit-lead.mjs.
--
-- Nullable, because every row written before this migration has no submission
-- id and a NOT NULL would reject them. A partial unique index is what makes
-- "unique when present" expressible: several legacy NULLs coexist, but two
-- equal non-null ids cannot.
alter table leads add column if not exists submission_id uuid;

create unique index if not exists leads_submission_id_key
  on leads (submission_id)
  where submission_id is not null;

-- ----------------------------------------------------------------- form type
-- `source` already carried this, as free text with a server-side allow-list.
-- `form_type` is the same fact under the name the request contract uses, and
-- the check constraint moves the allow-list into the database so a future
-- caller cannot invent a category. `source` is kept and written with the same
-- value: the portal and every existing row still read it, and dropping a column
-- that other code selects is not a compatibility change, it is a break.
alter table leads add column if not exists form_type text;

do $$ begin
  alter table leads add constraint leads_form_type_check
    check (form_type is null or form_type in
      ('newsletter', 'contact', 'impact', 'questionnaire', 'website'));
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------- provenance
-- The path the submission was sent from, e.g. '/en/contact.html'. Same-site
-- paths only; the function rejects anything with a scheme or a host.
alter table leads add column if not exists source_route text;

-- ------------------------------------------------------------------- payload
-- The validated, schema-approved answers as data. This is what makes a
-- questionnaire readable in the portal as fields rather than as one 8 KB prose
-- blob in `message`. `message` is still written, because it is what the team
-- reads today and what the existing portal renders.
--
-- Only fields that passed a per-form schema reach this column. Arbitrary
-- browser JSON never does — see FORMS in the function.
alter table leads add column if not exists payload jsonb not null default '{}'::jsonb;

-- ---------------------------------------------------------------------- meta
-- Approved attribution and timing only: elapsed fill time, referrer origin,
-- viewport class. Never raw IP (that is `ip_hash`), never full user input.
alter table leads add column if not exists meta jsonb not null default '{}'::jsonb;

-- ------------------------------------------------------------------- indexes
create index if not exists leads_form_type_idx on leads (form_type);

comment on column leads.submission_id is
  'Client-generated UUID, one per submission attempt. Idempotency key: a retry with the same id must not create a second lead.';
comment on column leads.form_type is
  'Which public form produced this row. Mirrors `source`; constrained to the allow-list.';
comment on column leads.source_route is
  'Same-site path the submission was sent from, e.g. /en/contact.html.';
comment on column leads.payload is
  'Schema-validated form answers as data. Never arbitrary client JSON.';
comment on column leads.meta is
  'Approved attribution and timing metadata. No raw IP, no free-text user input.';

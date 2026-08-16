-- =============================================================================
-- Stratos — revenue and operations
--
-- Phase P2. This is the layer that turns the Portal from a lead inbox into the
-- thing that answers "what is our pipeline worth", "what is likely to close",
-- "which channels produce revenue" and "what is each project actually earning".
--
-- THE CHAIN THIS MIGRATION COMPLETES
-- ----------------------------------
--     traffic → lead → opportunity → proposal → won → client → project → revenue
--       GA4     leads   opportunities          organizations  projects
--
-- Four of those eight already existed. This adds the missing middle and the
-- commercial tail, and it adds them to the tables that are already there rather
-- than beside them:
--
--   `organizations` IS the Client. It is extended, not replaced.
--   `projects`      IS the Project. It is extended, not replaced.
--   `activity_logs` IS the audit log. It is written to, not duplicated.
--   `leads`         IS the head of the chain. It is not touched at all.
--
-- NOTHING HERE DROPS, RENAMES OR REWRITES ANYTHING
-- ------------------------------------------------
-- Every statement is `create table if not exists`, `add column if not exists`,
-- `add value if not exists` or `create index if not exists`. No column is
-- removed, no type is replaced, no enum value is dropped, and no data migration
-- touches a single existing row. Every added column is nullable or defaulted, so
-- every existing `select` in the Portal keeps working against tables that have
-- only gained things.
--
-- The one enum that is EXTENDED rather than added is `project_status`, and the
-- reason is in §3 below.
--
-- Run after 20260814000100_lead_pipeline.sql.
-- Reviewed in _build/reports/portal-p2/migration-review.md.
-- =============================================================================


-- ###########################################################################
-- 1. VOCABULARIES
-- ###########################################################################

-- ------------------------------------------------------- opportunity stage
-- Six stages, and deliberately not twenty.
--
-- WHY THIS IS NOT `lead_status`
-- -----------------------------
-- They share four words and mean different things. `leads.status` answers "have
-- we dealt with this enquiry"; `opportunities.stage` answers "how close is this
-- deal to closing". One lead can produce two opportunities; an opportunity can
-- exist with no lead at all (§52); and a lead can be `won` in the sense that we
-- replied and it went somewhere while the deal is still in negotiation.
--
-- Sharing the words where they genuinely coincide is what §1 asks for. Sharing
-- the COLUMN would collapse two questions into one and is what §5 forbids.
--
-- `negotiation` is the one stage the lead pipeline has no business carrying: it
-- is a commercial state, not a correspondence state.
do $$ begin
  create type opportunity_stage as enum
    ('qualified', 'discovery', 'proposal', 'negotiation', 'won', 'lost');
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------- lost reason
-- §16. Controlled, because the entire value of a lost reason is that it can be
-- counted a year from now. Free text cannot be.
--
-- Nullable, always: no existing record gets a reason invented for it, and an
-- opportunity may be marked lost without one when nobody knows why.
do $$ begin
  create type opportunity_lost_reason as enum
    ('price', 'no_response', 'competitor', 'timing', 'scope_mismatch',
     'internal_decision', 'other');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------- milestone state
do $$ begin
  create type milestone_state as enum ('pending', 'in_progress', 'done', 'blocked');
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------ payment state
-- §27, and it stops here. Four states and two amounts is management
-- information; a fifth state, a due date and a document number is the start of
-- an invoicing product, which §27 explicitly rules out of this phase.
do $$ begin
  create type payment_state as enum
    ('not_invoiced', 'invoiced', 'partially_paid', 'paid');
exception when duplicate_object then null; end $$;

-- -------------------------------------------------------------- cost category
-- §28. Direct project costs only. There is no overhead category, no salary
-- category and no tax category, because this is not bookkeeping and a category
-- that invites those numbers in is how it becomes bookkeeping.
do $$ begin
  create type project_cost_category as enum
    ('collaborator', 'subcontractor', 'media', 'software', 'production', 'other');
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------- currency check
-- §4: HUF is the normal display currency, and the model must be explicit rather
-- than assume it forever. So every monetary column carries its own currency and
-- nothing anywhere converts between them — there is no rate in this system and
-- inventing one would make every total a fiction.
--
-- A check constraint rather than an enum: adding a currency later should be a
-- one-line constraint change, not an enum migration.
create or replace function is_supported_currency(code text)
returns boolean language sql immutable as $$
  select code in ('HUF', 'EUR', 'USD')
$$;

comment on function is_supported_currency is
  'The currencies the Portal will store. Nothing converts between them — no rate exists in this system.';


-- ###########################################################################
-- 2. OPPORTUNITIES
-- ###########################################################################

-- A commercially qualified sales possibility. §2, §4.
--
-- WHAT IT CARRIES FROM THE LEAD, AND WHAT IT DELIBERATELY DOES NOT
-- ---------------------------------------------------------------
-- §3 asks for lead reference, company, contact, source, medium, campaign,
-- landing route, locale, form type and created date — and asks that
-- questionnaire and personal data are NOT copied downstream. So the answers
-- stay in `leads.payload` where they were validated, the message stays in
-- `leads.message`, and this table takes only the commercial identity and the
-- attribution. `lead_id` is the traceability: anything else about the enquiry is
-- one join away and is never duplicated into a second place that can drift.
--
-- `on delete set null` on the lead, not cascade: §41 is explicit that a lead is
-- never deleted when converted, and if one ever were, losing the deal with it
-- would be the worse outcome.
create table if not exists opportunities (
  id                uuid primary key default gen_random_uuid(),

  -- ---- identity
  title             text not null check (length(btrim(title)) between 1 and 200),
  -- The client candidate. Null until the deal is won and a Client is created or
  -- matched (§17); `company_name` is what it is called before then.
  organization_id   uuid references organizations(id) on delete set null,
  company_name      text check (company_name is null or length(btrim(company_name)) <= 200),
  contact_name      text check (contact_name is null or length(btrim(contact_name)) <= 200),
  contact_email     text check (contact_email is null or length(btrim(contact_email)) <= 320),
  contact_phone     text check (contact_phone is null or length(btrim(contact_phone)) <= 64),

  -- An opportunity must be attributable to SOMEBODY. Either it is attached to a
  -- real client record or it names the company it is with; a row that is neither
  -- is a value floating in space.
  constraint opportunities_party_check check (
    organization_id is not null or length(btrim(coalesce(company_name, ''))) > 0
  ),

  -- ---- commerce
  service           text check (service is null or length(btrim(service)) <= 120),
  estimated_value   numeric(14, 2) check (estimated_value is null or estimated_value >= 0),
  currency          text not null default 'HUF' check (is_supported_currency(currency)),
  stage             opportunity_stage not null default 'qualified',
  -- §6. Stored per opportunity and editable. The stage defaults in
  -- `opportunity_default_probability` are OPERATIONAL DEFAULTS, not measured
  -- Stratos conversion rates, and the column exists so that the moment somebody
  -- knows better than the default, the better number is the one that is kept.
  probability       smallint not null default 20 check (probability between 0 and 100),
  expected_close_on date,

  -- ---- follow-up (§14)
  -- Two columns, not a task table. Sales follow-up is "the one next thing", and
  -- a table would make it a backlog, which §14 forbids.
  next_action       text check (next_action is null or length(btrim(next_action)) <= 200),
  next_action_on    date,

  -- ---- provenance (§3)
  lead_id           uuid references leads(id) on delete set null,
  source            text check (source is null or length(source) <= 120),
  medium            text check (medium is null or length(medium) <= 120),
  campaign          text check (campaign is null or length(campaign) <= 200),
  landing_route     text check (landing_route is null or length(landing_route) <= 300),
  locale            text check (locale is null or length(locale) <= 12),
  form_type         text check (form_type is null or length(form_type) <= 40),

  -- ---- ownership (§39)
  -- A real `profiles` row or nothing. There is exactly one account today, so
  -- nullable is not a convenience — it is the truthful default until there is a
  -- second person to assign work to.
  owner_id          uuid references profiles(id) on delete set null,
  created_by        uuid references profiles(id) on delete set null,

  -- ---- outcome (§16)
  lost_reason       opportunity_lost_reason,
  lost_note         text check (lost_note is null or length(btrim(lost_note)) <= 1000),
  won_at            timestamptz,
  lost_at           timestamptz,

  -- A reason only means anything on a lost deal. Without this, a won
  -- opportunity could carry `price` and the lost-reason report would be wrong.
  constraint opportunities_lost_reason_check check (
    (lost_reason is null and lost_note is null) or stage = 'lost'
  ),

  -- ---- lifecycle (§41)
  -- Archive, never delete. There is no delete policy on this table at all.
  archived_at       timestamptz,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

drop trigger if exists opportunities_updated_at on opportunities;
create trigger opportunities_updated_at before update on opportunities
  for each row execute function set_updated_at();

-- The queries this table actually serves: the pipeline board (by stage), the
-- forecast (by expected close), the follow-up view (by next action date), the
-- client hub (by organisation), the lead's own detail screen (by lead) and the
-- won-value reports (by won date).
create index if not exists opportunities_stage_idx   on opportunities (stage, updated_at desc);
create index if not exists opportunities_close_idx   on opportunities (expected_close_on) where archived_at is null;
create index if not exists opportunities_action_idx  on opportunities (next_action_on) where archived_at is null;
create index if not exists opportunities_org_idx     on opportunities (organization_id);
create index if not exists opportunities_lead_idx    on opportunities (lead_id);
create index if not exists opportunities_owner_idx   on opportunities (owner_id);
create index if not exists opportunities_won_idx     on opportunities (won_at desc) where stage = 'won';

comment on table opportunities is
  'A commercially qualified sales possibility. Separate from leads.status by design — see the note on opportunity_stage.';
comment on column opportunities.probability is
  'Percent, 0-100. Stage defaults are operational conventions, not measured Stratos rates.';
comment on column opportunities.lead_id is
  'Traceability back to the enquiry. The lead is never deleted on conversion.';
comment on column opportunities.archived_at is
  'Set instead of deleting. There is no delete policy on this table.';

-- ------------------------------------------------- the probability defaults
-- §6. Published as a function so the UI and the database agree on one table of
-- numbers, and so that "these are defaults" is written down where the defaults
-- live rather than only in a component.
create or replace function opportunity_default_probability(s opportunity_stage)
returns smallint language sql immutable as $$
  select case s
    when 'qualified'   then 20
    when 'discovery'   then 40
    when 'proposal'    then 60
    when 'negotiation' then 80
    when 'won'         then 100
    when 'lost'        then 0
  end::smallint
$$;

comment on function opportunity_default_probability is
  'Operational defaults only. NOT measured Stratos win rates. Stored probability per opportunity always wins.';

-- --------------------------------------------------------- closing the deal
-- Won and lost dates are stamped by the database, not by the browser.
--
-- The alternative is the application sending `won_at` alongside the stage, which
-- is correct exactly as often as every future caller remembers to — and a won
-- date that is sometimes missing makes every "won this month" figure quietly
-- wrong. A trigger is right for the same reason `log_lead_status_change` is.
--
-- Probability follows the terminal stages too: a won deal is 100 and a lost one
-- is 0, because a forecast weighted at 60% on a closed deal is not a forecast.
-- Moving OUT of a terminal stage (a mistake being corrected) clears the stamp.
create or replace function opportunity_close_stamp() returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if tg_op = 'INSERT' or new.stage is distinct from old.stage then
    if new.stage = 'won' then
      new.won_at  := coalesce(new.won_at, now());
      new.lost_at := null;
      new.probability := 100;
    elsif new.stage = 'lost' then
      new.lost_at := coalesce(new.lost_at, now());
      new.won_at  := null;
      new.probability := 0;
    else
      new.won_at  := null;
      new.lost_at := null;
      -- A reason belongs to a loss. Reopening a deal drops it rather than
      -- leaving `price` attached to a live negotiation.
      new.lost_reason := null;
      new.lost_note   := null;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists opportunities_close_stamp on opportunities;
create trigger opportunities_close_stamp
  before insert or update of stage on opportunities
  for each row execute function opportunity_close_stamp();


-- ###########################################################################
-- 3. CLIENTS  —  `organizations`, extended
-- ###########################################################################

-- §18. A Client is a company that has actually become a Stratos client, and
-- `organizations` is already exactly that table: it has a name, a slug, a
-- website and `org_status` (prospect / active / paused / former), which is the
-- status §18 asks for.
--
-- What it lacks is where the client CAME FROM, which is the whole point of §33:
-- without acquisition fields on the client, the chain breaks at the last step
-- and revenue cannot be attributed back to a channel.
alter table organizations add column if not exists acquisition_source   text;
alter table organizations add column if not exists acquisition_medium   text;
alter table organizations add column if not exists acquisition_campaign text;
alter table organizations add column if not exists primary_service      text;
-- §41 again: business records are archived, not deleted.
alter table organizations add column if not exists archived_at          timestamptz;

-- §40 — duplicate prevention.
--
-- An INDEX and not a UNIQUE CONSTRAINT, deliberately. Two clients can legitimately
-- be called "Kovács Kft."; what must not happen is creating a second one without
-- being shown the first. So the database makes the lookup fast and the
-- application presents the matches for confirmation, which is what §40 asks for:
-- "Do not automatically merge uncertain records."
create index if not exists organizations_name_norm_idx on organizations (lower(btrim(name)));

comment on column organizations.acquisition_source is
  'Where this client came from, carried forward from the won opportunity. Completes the source → revenue chain.';

-- -------------------------------------------------------- client contacts
-- §20. More than one contact per client, without duplicating the lead's personal
-- data: a contact here is entered deliberately by staff, and the enquiry's own
-- name and address stay on the lead.
create table if not exists client_contacts (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name            text not null check (length(btrim(name)) between 1 and 200),
  role            text check (role is null or length(btrim(role)) <= 120),
  email           text check (email is null or length(btrim(email)) <= 320),
  phone           text check (phone is null or length(btrim(phone)) <= 64),
  is_primary      boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

drop trigger if exists client_contacts_updated_at on client_contacts;
create trigger client_contacts_updated_at before update on client_contacts
  for each row execute function set_updated_at();

create index if not exists client_contacts_org_idx on client_contacts (organization_id);

-- One primary contact per client, enforced by the database. A partial unique
-- index is how "at most one true" is expressed without forbidding the false ones.
create unique index if not exists client_contacts_primary_key
  on client_contacts (organization_id) where is_primary;

comment on table client_contacts is
  'Deliberately entered client contacts. Not a copy of the lead''s personal data.';


-- ###########################################################################
-- 4. PROJECTS  —  extended
-- ###########################################################################

-- §21, §22. `projects` already exists with a client (`organization_id`), a name,
-- a slug, dates and a status. What it has never had is anything commercial.
--
-- WHY `project_status` IS EXTENDED RATHER THAN REPLACED
-- ----------------------------------------------------
-- The existing enum is `discovery | design | build | launch | care | archived`,
-- which is a PHASE vocabulary — where a website project has got to. §22 proposes
-- `Planned | Active | Client Review | Blocked | Completed | On Hold`, which is a
-- STATE vocabulary — whether it is moving. They are two different axes and the
-- brief asks for both: §23 asks for milestones, and milestones ARE the phase
-- axis, done properly and per-service instead of hard-coded onto every project.
--
-- So the phases move to `project_milestones` and the status column takes the
-- operational states. The legacy values are NOT dropped — dropping an enum value
-- requires rewriting the table, and every existing row keeps rendering under its
-- own label. `add value if not exists` takes no lock at all.
--
-- No exception handler, deliberately. `ALTER TYPE ... ADD VALUE` inside a
-- PL/pgSQL block that HAS one runs in a subtransaction, which is the one context
-- Postgres still refuses it in. A plain loop has no handler, so there is no
-- subtransaction, and `if not exists` does the work the handler would have.
--
-- The new values are not USED anywhere in this migration — the aggregate below
-- compares `status::text`, not an enum literal — which is the other condition
-- for adding a value inside a transaction.
do $$
declare v text;
begin
  foreach v in array array['planned', 'active', 'client_review',
                           'blocked', 'on_hold', 'completed']
  loop
    execute format('alter type project_status add value if not exists %L', v);
  end loop;
end $$;

-- ---- what we are delivering, and for how much
alter table projects add column if not exists service           text;
alter table projects add column if not exists value             numeric(14, 2);
alter table projects add column if not exists currency          text not null default 'HUF';
alter table projects add column if not exists opportunity_id    uuid references opportunities(id) on delete set null;
alter table projects add column if not exists responsible_id    uuid references profiles(id) on delete set null;

-- ---- hours (§29). Management information, entered by hand. This is explicitly
-- not a time tracker, and there is no timer table to make it into one.
alter table projects add column if not exists estimated_hours   numeric(8, 2);
alter table projects add column if not exists actual_hours      numeric(8, 2);

-- ---- payment (§27). Lightweight and optional. `not_invoiced` is the honest
-- default: it says nothing has been invoiced, which is true of a new project.
alter table projects add column if not exists payment_state     payment_state not null default 'not_invoiced';
alter table projects add column if not exists invoiced_amount   numeric(14, 2);
alter table projects add column if not exists paid_amount       numeric(14, 2);

alter table projects add column if not exists completed_at      timestamptz;
alter table projects add column if not exists archived_at       timestamptz;

-- Non-negative money and hours, in the database rather than in a form (§64).
do $$ begin
  alter table projects add constraint projects_value_check
    check (value is null or value >= 0);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table projects add constraint projects_currency_check
    check (is_supported_currency(currency));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table projects add constraint projects_hours_check
    check ((estimated_hours is null or estimated_hours >= 0)
       and (actual_hours    is null or actual_hours    >= 0));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table projects add constraint projects_payment_amounts_check
    check ((invoiced_amount is null or invoiced_amount >= 0)
       and (paid_amount     is null or paid_amount     >= 0));
exception when duplicate_object then null; end $$;

create index if not exists projects_opportunity_idx  on projects (opportunity_id);
create index if not exists projects_responsible_idx  on projects (responsible_id);
create index if not exists projects_target_idx       on projects (target_date) where archived_at is null;

comment on column projects.value is
  'Agreed project value. NOT cash received — see projects.paid_amount for that.';
comment on column projects.actual_hours is
  'Entered by hand. There is no time tracker in this phase.';

-- ------------------------------------------------------------- milestones
-- §23. A lightweight delivery model, and the reason project templates are an
-- APPLICATION concern rather than a database one: a website project's ten
-- milestones and a branding project's four are different lists, and hard-coding
-- either into the schema is what §23 forbids. The table stores whatever list was
-- created; `portal/src/lib/projects.ts` holds the per-service starting points.
create table if not exists project_milestones (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references projects(id) on delete cascade,
  title        text not null check (length(btrim(title)) between 1 and 160),
  position     smallint not null default 0,
  state        milestone_state not null default 'pending',
  due_on       date,
  completed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

drop trigger if exists project_milestones_updated_at on project_milestones;
create trigger project_milestones_updated_at before update on project_milestones
  for each row execute function set_updated_at();

create index if not exists project_milestones_project_idx
  on project_milestones (project_id, position);

-- Same argument as `opportunity_close_stamp`: a completion date the application
-- has to remember to send is a completion date that is sometimes missing.
create or replace function milestone_complete_stamp() returns trigger
  language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' or new.state is distinct from old.state then
    new.completed_at := case when new.state = 'done' then coalesce(new.completed_at, now()) end;
  end if;
  return new;
end;
$$;

drop trigger if exists project_milestones_complete on project_milestones;
create trigger project_milestones_complete
  before insert or update of state on project_milestones
  for each row execute function milestone_complete_stamp();

-- ------------------------------------------------------------------ costs
-- §28. Direct project costs, for management profitability and nothing else.
create table if not exists project_costs (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  description text not null check (length(btrim(description)) between 1 and 200),
  category    project_cost_category not null default 'other',
  amount      numeric(14, 2) not null check (amount >= 0),
  currency    text not null default 'HUF' check (is_supported_currency(currency)),
  incurred_on date not null default current_date,
  created_by  uuid references profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists project_costs_project_idx on project_costs (project_id, incurred_on desc);

comment on table project_costs is
  'Direct project costs for management contribution. Not bookkeeping — no overhead, salary or tax categories exist.';

-- ------------------------------------------------------------------ links
-- §25. Links, not integrations. The scheme is checked here AND at the point of
-- render (`safeUrl` in the Portal), because a stored `javascript:` URL that
-- reaches an `href` is a stored XSS in an authenticated admin session.
create table if not exists project_links (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  label      text not null check (length(btrim(label)) between 1 and 80),
  url        text not null check (url ~* '^https?://[^\s]{3,500}$'),
  created_at timestamptz not null default now()
);

create index if not exists project_links_project_idx on project_links (project_id);

comment on column project_links.url is
  'http/https only, enforced by check constraint AND by safeUrl() at render time.';


-- ###########################################################################
-- 5. NOTES
-- ###########################################################################

-- §37. One note table for the three new record types, rather than three
-- near-identical ones.
--
-- WHY THIS IS POLYMORPHIC AND `lead_notes` IS NOT
-- -----------------------------------------------
-- `lead_notes` has a hard foreign key and a cascade, which is genuinely better
-- and is worth keeping. Reproducing that three more times would mean three
-- tables, three sets of six policies and three of everything in the Portal, for
-- rows that differ only in which id they point at. So the new records share one
-- table keyed by `(entity_type, entity_id)`, and the entity type is constrained
-- so it cannot become a dumping ground.
--
-- The trade is real and is accepted: there is no referential integrity between
-- a note and its record. That costs nothing here, because §41 forbids deleting
-- these records in the first place — they are archived.
--
-- `body` is TEXT and nothing else, for the same reason as `lead_notes.body`: the
-- Portal renders it as a text node, and storing markup would mean either
-- rendering it (a stored XSS) or showing the tags.
create table if not exists record_notes (
  id          uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('opportunity', 'client', 'project')),
  entity_id   uuid not null,
  author_id   uuid references profiles(id) on delete set null,
  body        text not null check (length(btrim(body)) between 1 and 4000),
  created_at  timestamptz not null default now()
);

create index if not exists record_notes_entity_idx
  on record_notes (entity_type, entity_id, created_at desc);

comment on column record_notes.body is
  'Plain text. Rendered as a text node — never as markup.';


-- ###########################################################################
-- 6. AUDIT  —  into `activity_logs`, by trigger
-- ###########################################################################

-- §63. Commercially important state changes are recorded, and they are recorded
-- the way lead status changes already are: by a `security definer` trigger.
--
-- WHY A TRIGGER AND NOT AN APPLICATION INSERT
-- -------------------------------------------
-- Two reasons, and the second is the important one.
--
--   1. `activity_logs` has a select policy for admins and NO insert policy at
--      all. Writes come from the service key or from a definer function. That is
--      what makes the log append-only from the API's point of view, and it is
--      what stops an authenticated browser forging an entry.
--
--   2. The Portal is not the only thing that can change these rows. The Supabase
--      table editor can, a future automation can, a one-off SQL fix can. A
--      trigger records all of them. An insert in React records the ones that
--      went through React and leaves gaps that look like nothing happened.
--
-- `auth.uid()` is null when the change did not come from a signed-in session.
-- Null is the honest answer; attributing it to somebody would not be.
create or replace function log_business_change() returns trigger
  language plpgsql
  security definer
  -- Pinned. A definer function resolving unqualified names through the caller's
  -- search_path is the classic escalation: the caller chooses which
  -- `activity_logs` this writes to.
  set search_path = public
as $$
declare
  entity text := tg_argv[0];
  event  text;
  detail jsonb := '{}'::jsonb;
  target uuid;
begin
  -- IF branches rather than a CASE over `entity`. A CASE would put `new.title`
  -- and `new.name` in the same expression, and a record field that does not
  -- exist on the table the trigger fired for is a runtime error waiting for the
  -- first person who reuses this function on a fourth table.
  if tg_op = 'INSERT' then
    target := new.id;
    event  := entity || '.created';
    if entity = 'opportunity' then
      detail := jsonb_build_object('title', new.title, 'stage', new.stage::text);
    elsif entity = 'client' then
      detail := jsonb_build_object('name', new.name);
    elsif entity = 'project' then
      detail := jsonb_build_object('name', new.name, 'status', new.status::text);
    end if;

  else
    target := new.id;

    if entity = 'opportunity' then
      if new.stage is distinct from old.stage then
        event  := 'opportunity.stage_changed';
        detail := jsonb_build_object(
          'from', old.stage::text, 'to', new.stage::text,
          'reason', new.lost_reason::text);
      elsif new.estimated_value is distinct from old.estimated_value then
        event  := 'opportunity.value_changed';
        detail := jsonb_build_object(
          'from', old.estimated_value, 'to', new.estimated_value, 'currency', new.currency);
      elsif new.next_action is distinct from old.next_action
         or new.next_action_on is distinct from old.next_action_on then
        event  := 'opportunity.next_action_changed';
        detail := jsonb_build_object('action', new.next_action, 'due', new.next_action_on);
      elsif new.organization_id is distinct from old.organization_id
        and new.organization_id is not null then
        event  := 'opportunity.client_linked';
        detail := jsonb_build_object('client', new.organization_id);
      end if;

    elsif entity = 'project' then
      if new.status is distinct from old.status then
        event  := 'project.status_changed';
        detail := jsonb_build_object('from', old.status::text, 'to', new.status::text);
      elsif new.value is distinct from old.value then
        event  := 'project.value_changed';
        detail := jsonb_build_object('from', old.value, 'to', new.value, 'currency', new.currency);
      end if;

    elsif entity = 'client' then
      if new.status is distinct from old.status then
        event  := 'client.status_changed';
        detail := jsonb_build_object('from', old.status::text, 'to', new.status::text);
      end if;
    end if;
  end if;

  -- Nothing worth recording happened. An audit log that also records the
  -- updates that changed nothing is an audit log nobody reads.
  --
  -- `return null` throughout: every trigger below is AFTER, where the return
  -- value is discarded. Returning NEW here would imply this function could be
  -- used as a BEFORE trigger, which it must not be — a row whose audit entry is
  -- written before the change is committed is an audit entry for a change that
  -- may never have happened.
  if event is null then
    return null;
  end if;

  insert into activity_logs (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), event, entity, target, detail);

  return null;
end;
$$;

comment on function log_business_change is
  'Appends commercial state changes to activity_logs. The record timelines read these.';

drop trigger if exists opportunities_audit_insert on opportunities;
create trigger opportunities_audit_insert after insert on opportunities
  for each row execute function log_business_change('opportunity');

drop trigger if exists opportunities_audit_update on opportunities;
create trigger opportunities_audit_update after update on opportunities
  for each row execute function log_business_change('opportunity');

drop trigger if exists organizations_audit_insert on organizations;
create trigger organizations_audit_insert after insert on organizations
  for each row execute function log_business_change('client');

drop trigger if exists organizations_audit_update on organizations;
create trigger organizations_audit_update after update on organizations
  for each row execute function log_business_change('client');

drop trigger if exists projects_audit_insert on projects;
create trigger projects_audit_insert after insert on projects
  for each row execute function log_business_change('project');

drop trigger if exists projects_audit_update on projects;
create trigger projects_audit_update after update on projects
  for each row execute function log_business_change('project');

-- Costs are audited on both sides: §63 asks for cost addition AND removal, and a
-- cost that can be quietly removed is how a contribution figure changes without
-- anybody being able to say when.
create or replace function log_project_cost_change() returns trigger
  language plpgsql security definer set search_path = public
as $$
declare
  -- NEW and OLD are records and `coalesce(new, old)` is not a thing Postgres
  -- will do with them. One branch each.
  row_ record;
begin
  if tg_op = 'INSERT' then row_ := new; else row_ := old; end if;

  insert into activity_logs (user_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(),
    case tg_op when 'INSERT' then 'project.cost_added' else 'project.cost_removed' end,
    'project',
    row_.project_id,
    jsonb_build_object(
      'description', row_.description,
      'category', row_.category::text,
      'amount', row_.amount,
      'currency', row_.currency)
  );
  return null;
end;
$$;

drop trigger if exists project_costs_audit on project_costs;
create trigger project_costs_audit after insert or delete on project_costs
  for each row execute function log_project_cost_change();


-- ###########################################################################
-- 7. ROW LEVEL SECURITY
-- ###########################################################################

-- §43. Every new table, without exception. The rule the existing RLS migration
-- states applies unchanged: the Portal's React route guards are a convenience,
-- not a control. An account that opens devtools and calls PostgREST directly
-- gets exactly what these policies allow.
--
-- `force row level security` on all four business tables, so a mistake in a
-- definer function or a future owner-context script cannot bypass them.
alter table opportunities      enable row level security;
alter table opportunities      force  row level security;
alter table client_contacts    enable row level security;
alter table client_contacts    force  row level security;
alter table project_milestones enable row level security;
alter table project_milestones force  row level security;
alter table project_costs      enable row level security;
alter table project_costs      force  row level security;
alter table project_links      enable row level security;
alter table project_links      force  row level security;
alter table record_notes       enable row level security;
alter table record_notes       force  row level security;

-- ---------------------------------------------------------- opportunities
-- Staff read, admins write. The same shape as `leads`, because it is the same
-- kind of data: the commercial book of the business.
--
-- There is NO DELETE POLICY. §41 asks for archive over destructive delete on
-- business records, and the way to guarantee that is not to grant delete: an
-- opportunity is archived by setting `archived_at`, which is an update.
drop policy if exists opportunities_select_staff on opportunities;
drop policy if exists opportunities_insert_admin on opportunities;
drop policy if exists opportunities_update_admin on opportunities;

create policy opportunities_select_staff on opportunities
  for select using (is_staff());
create policy opportunities_insert_admin on opportunities
  for insert with check (is_admin());
create policy opportunities_update_admin on opportunities
  for update using (is_admin()) with check (is_admin());

-- -------------------------------------------------------- client contacts
-- A contact is personal data about a named person at a client company. Staff
-- read, admin write, and deleting a contact who has left is legitimate — this is
-- not a business record with a history, it is a phone number.
drop policy if exists client_contacts_select_staff on client_contacts;
drop policy if exists client_contacts_write_admin  on client_contacts;

create policy client_contacts_select_staff on client_contacts
  for select using (is_staff());
create policy client_contacts_write_admin on client_contacts
  for all using (is_admin()) with check (is_admin());

-- ------------------------------------------------------------- milestones
-- Milestones follow the project. A team member assigned to a project can see
-- them, because "where is this now" is exactly what an assigned person needs;
-- the `exists` subquery re-uses the project's own visibility rather than
-- inventing a second answer to who may see what.
drop policy if exists project_milestones_select on project_milestones;
drop policy if exists project_milestones_write  on project_milestones;

create policy project_milestones_select on project_milestones
  for select using (
    exists (select 1 from projects p where p.id = project_milestones.project_id)
  );
create policy project_milestones_write on project_milestones
  for all using (is_admin()) with check (is_admin());

-- ------------------------------------------------------------------ costs
-- Costs are NOT visible to a team member. What a collaborator was paid is
-- commercially sensitive in a way a milestone is not, and `is_staff()` here
-- would put every subcontractor fee in front of every subcontractor.
drop policy if exists project_costs_select_admin on project_costs;
drop policy if exists project_costs_write_admin  on project_costs;

create policy project_costs_select_admin on project_costs
  for select using (is_admin());
create policy project_costs_write_admin on project_costs
  for all using (is_admin()) with check (is_admin());

-- ------------------------------------------------------------------ links
drop policy if exists project_links_select on project_links;
drop policy if exists project_links_write  on project_links;

create policy project_links_select on project_links
  for select using (
    exists (select 1 from projects p where p.id = project_links.project_id)
  );
create policy project_links_write on project_links
  for all using (is_admin()) with check (is_admin());

-- ------------------------------------------------------------------ notes
-- Verbatim from `lead_notes`, including the clause that matters most:
-- `author_id = auth.uid()` in the WITH CHECK is what stops an admin writing a
-- note in a colleague's name. An attribution anyone can forge is decoration.
--
-- Nobody may UPDATE a note. A note that can be rewritten after the fact is not a
-- record, and the timeline it appears in is meant to be one.
drop policy if exists record_notes_select_staff  on record_notes;
drop policy if exists record_notes_insert_admin  on record_notes;
drop policy if exists record_notes_delete_author on record_notes;

create policy record_notes_select_staff on record_notes
  for select using (is_staff());
create policy record_notes_insert_admin on record_notes
  for insert with check (is_admin() and author_id = auth.uid());
create policy record_notes_delete_author on record_notes
  for delete using (is_admin() and author_id = auth.uid());

-- --------------------------------------------------------------- privileges
-- Defence in depth, and an explicit statement of intent.
--
-- Supabase's default privileges already grant table access to `anon` and
-- `authenticated` and leave RLS as the gate — which is why `lead_notes` works
-- today without a grant. These statements say the quiet part: `anon` gets
-- NOTHING on any of these tables, so an unauthenticated caller is refused by the
-- privilege system before RLS is ever consulted. Two independent locks.
--
-- Guarded, because the role names are a Supabase convention rather than a
-- Postgres guarantee, and a migration that fails on a bare Postgres is a
-- migration that cannot be tested locally.
do $$
declare
  t text;
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    foreach t in array array['opportunities', 'client_contacts', 'project_milestones',
                             'project_costs', 'project_links', 'record_notes']
    loop
      execute format('revoke all on table %I from anon', t);
    end loop;
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    foreach t in array array['opportunities', 'client_contacts', 'project_milestones',
                             'project_costs', 'project_links', 'record_notes']
    loop
      execute format('grant select, insert, update, delete on table %I to authenticated', t);
    end loop;
  end if;
end $$;


-- ###########################################################################
-- 8. SERVER-SIDE AGGREGATION
-- ###########################################################################

-- §59. The Dashboard must not load every opportunity, client and project in the
-- business to print six numbers. These two functions are how it does not.
--
-- WHY `security invoker` AND NOT `security definer`
-- ------------------------------------------------
-- This is the single most important line in this section. A definer function
-- would compute these totals as its owner, which means it would compute them
-- WITHOUT the caller's RLS policies — every one of these figures would be
-- readable by any authenticated account, including a client. Invoker means the
-- aggregate is built from exactly the rows the caller could have selected
-- themselves, so the policies above are the authorisation here too and there is
-- no second answer to who may see the pipeline.
--
-- `security invoker` is the default; it is written out because a future edit
-- that adds `security definer` for convenience would silently publish the
-- company's revenue.

-- ------------------------------------------------------------ the pipeline
-- One round trip, one row per (bucket, currency).
--
-- WHY CURRENCY IS A GROUPING KEY AND NOT A DETAIL
-- ----------------------------------------------
-- §4 and §65: nothing in this system converts between currencies, because no
-- rate exists in it. Summing 4 000 000 HUF and 10 000 EUR into one number
-- requires inventing one. So every monetary aggregate is grouped BY currency and
-- the Portal renders each group; in practice there is one, and on the day there
-- are two the screen says so instead of printing a fiction.
create or replace function portal_sales_summary()
returns table (
  bucket   text,
  currency text,
  items    bigint,
  value    numeric,
  weighted numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with live as (
    select * from opportunities where archived_at is null
  ),
  open_opps as (
    select * from live where stage not in ('won', 'lost')
  )
  -- One bucket per stage: the Dashboard's compact stage distribution (§9).
  select
    'stage:' || o.stage::text,
    o.currency,
    count(*),
    coalesce(sum(o.estimated_value), 0),
    coalesce(sum(o.estimated_value * o.probability / 100.0), 0)
  from live o
  where o.stage not in ('won', 'lost')
  group by o.stage, o.currency

  -- Total open pipeline, and the weighted forecast (§7).
  union all
  select 'open', o.currency, count(*),
         coalesce(sum(o.estimated_value), 0),
         coalesce(sum(o.estimated_value * o.probability / 100.0), 0)
  from open_opps o group by o.currency

  -- Expected to close inside the current calendar month (§7).
  union all
  select 'closing_month', o.currency, count(*),
         coalesce(sum(o.estimated_value), 0),
         coalesce(sum(o.estimated_value * o.probability / 100.0), 0)
  from open_opps o
  where o.expected_close_on >= date_trunc('month', current_date)::date
    and o.expected_close_on <  (date_trunc('month', current_date) + interval '1 month')::date
  group by o.currency

  -- Won, this month and this year (§7, §32). `won_at` is stamped by the
  -- database, so these cannot drift from the stage.
  union all
  select 'won_mtd', o.currency, count(*), coalesce(sum(o.estimated_value), 0), 0::numeric
  from live o
  where o.stage = 'won' and o.won_at >= date_trunc('month', current_date)
  group by o.currency

  union all
  select 'won_ytd', o.currency, count(*), coalesce(sum(o.estimated_value), 0), 0::numeric
  from live o
  where o.stage = 'won' and o.won_at >= date_trunc('year', current_date)
  group by o.currency

  -- Every closed deal, ever. The win rate and the average won deal are computed
  -- from these two buckets rather than stored, so they cannot go stale.
  union all
  select 'won_all', o.currency, count(*), coalesce(sum(o.estimated_value), 0), 0::numeric
  from live o where o.stage = 'won' group by o.currency

  union all
  select 'lost_all', o.currency, count(*), coalesce(sum(o.estimated_value), 0), 0::numeric
  from live o where o.stage = 'lost' group by o.currency

  -- Delivery, for the Dashboard's one-line project readout (§57).
  -- `currency` is not meaningful for a count of projects and is null rather than
  -- a placeholder that could be summed by accident.
  union all
  select 'projects_' || (case
      when p.status::text in ('blocked', 'on_hold') then 'blocked'
      when p.status::text in ('completed', 'archived') then 'closed'
      else 'active' end),
    null::text, count(*), 0::numeric, 0::numeric
  from projects p
  where p.archived_at is null
  group by 1

  union all
  select 'clients_active', null::text, count(*), 0::numeric, 0::numeric
  from organizations c
  where c.archived_at is null and c.status = 'active';
$$;

comment on function portal_sales_summary is
  'Server-side pipeline aggregate, one row per (bucket, currency). SECURITY INVOKER: the caller''s RLS decides what is counted.';

-- -------------------------------------------------- source → revenue (§33)
-- The chain, as an aggregate, over one dimension at a time.
--
-- WHAT THIS DOES AND DOES NOT JOIN
-- --------------------------------
-- It joins Portal records to Portal records: a lead's own recorded attribution
-- to the opportunity it produced to the value that opportunity closed for.
-- Sessions are NOT in here. GA4 session counts come from the analytics endpoint
-- and are matched to these rows in the Portal by the source string, with the
-- methodology stated on the screen — because a GA4 session and a named lead row
-- are not the same population and dividing one by the other produces a number
-- with no meaning presented at two decimal places (§34).
--
-- Nothing here identifies an individual and nothing here goes back to Google.
create or replace function portal_revenue_attribution(dimension text default 'source')
returns table (
  key             text,
  leads           bigint,
  qualified       bigint,
  opportunities   bigint,
  won             bigint,
  won_value       numeric,
  won_currency    text,
  won_currencies  bigint
)
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  if dimension not in ('source', 'medium', 'campaign', 'landing') then
    raise exception 'unsupported dimension %', dimension
      using errcode = 'invalid_parameter_value';
  end if;

  return query
  with lead_keyed as (
    select
      l.id,
      l.status,
      case dimension
        when 'medium'   then nullif(l.meta->>'utmMedium', '')
        when 'campaign' then nullif(l.meta->>'utmCampaign', '')
        when 'landing'  then nullif(l.meta->>'landingRoute', '')
        else coalesce(nullif(l.meta->>'utmSource', ''),
                      nullif(l.meta->>'landingReferrerHost', ''))
      end as k
    from leads l
    where l.status <> 'spam'
  ),
  opp_keyed as (
    select
      o.stage,
      o.estimated_value,
      o.currency,
      case dimension
        when 'medium'   then coalesce(nullif(o.medium, ''),   lk.k)
        when 'campaign' then coalesce(nullif(o.campaign, ''), lk.k)
        when 'landing'  then coalesce(nullif(o.landing_route, ''), lk.k)
        else coalesce(nullif(o.source, ''), lk.k)
      end as k
    from opportunities o
    left join lead_keyed lk on lk.id = o.lead_id
    where o.archived_at is null
  ),
  lead_agg as (
    select
      coalesce(k, '(not set)') as k,
      count(*) as leads,
      -- "Qualified" means the lead reached qualification or beyond. It is a
      -- lead-side measure on purpose: it is the step between "an enquiry
      -- arrived" and "a deal exists", which is the step §33's chain names.
      count(*) filter (where status::text in ('qualified', 'proposal', 'won')) as qualified
    from lead_keyed group by 1
  ),
  opp_agg as (
    select
      coalesce(k, '(not set)') as k,
      count(*) as opportunities,
      count(*) filter (where stage = 'won') as won,
      coalesce(sum(estimated_value) filter (where stage = 'won'), 0) as won_value,
      (array_agg(distinct currency) filter (where stage = 'won'))[1] as won_currency,
      count(distinct currency) filter (where stage = 'won') as won_currencies
    from opp_keyed group by 1
  )
  select
    coalesce(l.k, o.k),
    coalesce(l.leads, 0),
    coalesce(l.qualified, 0),
    coalesce(o.opportunities, 0),
    coalesce(o.won, 0),
    coalesce(o.won_value, 0),
    o.won_currency,
    coalesce(o.won_currencies, 0)
  from lead_agg l
  full outer join opp_agg o on o.k = l.k
  order by coalesce(o.won_value, 0) desc, coalesce(l.leads, 0) desc;
end;
$$;

comment on function portal_revenue_attribution is
  'Aggregate source → leads → qualified → opportunities → won → value. Portal records only; GA4 sessions are matched in the UI, never joined here.';

-- Neither function is for the public. `anon` holds an unauthenticated session
-- and there is nothing here it should be able to call, even though RLS would
-- give it nothing back: a function that answers is a function that can be timed.
do $$
declare
  f text;
begin
  foreach f in array array[
    'portal_sales_summary()',
    'portal_revenue_attribution(text)'
  ] loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', f);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('grant execute on function %s to authenticated', f);
    end if;
  end loop;
end $$;

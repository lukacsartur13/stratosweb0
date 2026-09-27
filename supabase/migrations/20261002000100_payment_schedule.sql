-- =============================================================================
-- Stratos — phase 5: the payment schedule, and one atomic "next action done"
--
--   1. instalments     `project_instalments`: per paid project, any number of
--                      planned parts (label, amount in the project's currency,
--                      due date, invoiced or not, note)
--   2. payments        `project_payments`: money actually received, each
--                      against ONE instalment, with its own amount and date.
--                      Several per instalment; partial and over-payment allowed
--                      and shown, never capped
--   3. one source      `projects.payment_state`, `invoiced_amount` and
--                      `paid_amount` are DERIVED from 1–2 from now on, for every
--                      project. A write that disagrees with the schedule is
--                      refused (`stratos:payment_derived`) — so the old Portal's
--                      edit form keeps working as long as it sends back what it
--                      read, and cannot contradict the schedule
--   4. the carry-over  every existing single-sum figure becomes a `legacy`
--                      instalment and payment; the original values are kept
--                      verbatim in `project_finance_legacy`, with every doubtful
--                      case listed. No payment date is invented: a carried
--                      payment has `paid_on = null` until the owner fills it in
--   5. rules           Impact projects take no instalment and no payment (any
--                      role, any path); a project's currency is fixed once it
--                      has a schedule; a payment is not dated in the future;
--                      closing a project is not read and does not block anything
--   6. the figures     `project_payment_overview()` — contracted, scheduled,
--                      paid, remaining, over-paid, overdue, per project, in the
--                      project's own currency (never summed across currencies)
--   7. audit           every instalment and payment added, changed or removed
--                      goes to `activity_logs` as a project event (owner-only)
--   8. access          owner only (RLS, FORCED); anon nothing
--   9. Sales           `opportunity_complete_action()` — the note and the clear
--                      in ONE transaction, guarded on the action it completes
--
-- Nothing here is deleted or rewritten except the three derived columns, whose
-- previous values are copied first. Undo: supabase/checks/payment-schedule-
-- rollback.sql (keeps every instalment, payment and snapshot row).
--
-- Run after 20261001000100_client_portal.sql. Refuses to run without the owner,
-- the lockdown and the Impact migration.
-- =============================================================================


-- ###########################################################################
-- 0. PRECONDITIONS
-- ###########################################################################

do $$
begin
  if not exists (select 1 from portal_owner o join profiles p on p.id = o.user_id where p.role = 'super_admin') then
    raise exception 'No portal owner who is a super_admin is designated.';
  end if;
  if not exists (select 1 from pg_policies where tablename = 'projects' and policyname = 'projects_owner_all') then
    raise exception 'The owner lockdown (20260928000300_owner_lockdown.sql) is not applied.';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'projects' and column_name = 'program') then
    raise exception 'The Impact migration (20260929000300_impact_program.sql) is not applied.';
  end if;
  if current_user in ('anon', 'authenticated') then
    raise exception 'Run this migration from the SQL editor, not as an API role.';
  end if;
  -- The carry-over (§4) reads and rewrites `projects`, which FORCES row
  -- security. A role without BYPASSRLS would see no project at all and the
  -- carry-over would silently do nothing. Refuse instead.
  if not exists (select 1 from pg_roles where rolname = current_user and (rolsuper or rolbypassrls)) then
    raise exception 'The role % has neither SUPERUSER nor BYPASSRLS; the carry-over could not see the projects. Run from the Supabase SQL editor (role postgres).', current_user;
  end if;
end $$;

-- The calendar day in Budapest. "Overdue" and "not in the future" are about the
-- business's day, not UTC's.
create or replace function portal_today() returns date
  language sql stable set search_path = public
as $$ select (now() at time zone 'Europe/Budapest')::date $$;


-- ###########################################################################
-- 1–2. INSTALMENTS AND PAYMENTS
-- ###########################################################################

create table if not exists project_instalments (
  id          uuid primary key default gen_random_uuid(),
  -- restrict: money history is not removed with a project. A project with a
  -- schedule cannot be deleted (none is, by the Portal); archive it instead.
  project_id  uuid not null references projects(id) on delete restrict,
  label       text not null check (length(btrim(label)) between 1 and 120),
  -- In the PROJECT's currency; there is deliberately no second currency column
  -- that could disagree with it (the project's currency is fixed below).
  amount      numeric(14, 2) not null check (amount > 0 and amount <= 1000000000000),
  due_on      date,
  -- Invoicing is its own fact, set by hand. It is NOT payment.
  invoiced    boolean not null default false,
  invoiced_on date,
  note        text check (note is null or length(note) <= 2000),
  position    smallint not null default 0,
  -- `legacy` = carried over from the single-sum fields by this migration.
  origin      text not null default 'manual' check (origin in ('manual', 'legacy')),
  created_by  uuid references profiles(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (id, project_id),
  check (invoiced_on is null or invoiced),
  -- A planned part needs a due date; only a carried-over one may lack it (its
  -- date was never recorded, and inventing one would make it look overdue).
  check (due_on is not null or origin = 'legacy')
);

create index if not exists project_instalments_project_idx on project_instalments (project_id, position, due_on);

create table if not exists project_payments (
  id             uuid primary key default gen_random_uuid(),
  instalment_id  uuid not null,
  project_id     uuid not null,
  -- The pair must be a real instalment of THAT project: a payment cannot be
  -- written against another project's instalment by any path.
  foreign key (instalment_id, project_id) references project_instalments (id, project_id)
    on delete restrict on update restrict,
  amount         numeric(14, 2) not null check (amount > 0 and amount <= 1000000000000),
  -- The day the money arrived. Unknown only for a carried-over payment.
  paid_on        date,
  note           text check (note is null or length(note) <= 2000),
  origin         text not null default 'manual' check (origin in ('manual', 'legacy')),
  created_by     uuid references profiles(id) on delete set null default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (paid_on is not null or origin = 'legacy')
);

create index if not exists project_payments_project_idx on project_payments (project_id, paid_on);
create index if not exists project_payments_instalment_idx on project_payments (instalment_id);

drop trigger if exists project_instalments_updated_at on project_instalments;
create trigger project_instalments_updated_at before update on project_instalments
  for each row execute function set_updated_at();
drop trigger if exists project_payments_updated_at on project_payments;
create trigger project_payments_updated_at before update on project_payments
  for each row execute function set_updated_at();

comment on table project_instalments is
  'Planned parts of a paid project''s price, in the project''s currency. Paid-ness is derived from project_payments, never stored.';
comment on table project_payments is
  'Money received, against one instalment. The only record of payment; projects.paid_amount is derived from it.';


-- ###########################################################################
-- 5. RULES
-- ###########################################################################

-- Instalments and payments: paid projects only; project fixed; origin fixed
-- and never claimed by an API caller; no payment dated in the future.
create or replace function project_payment_rules() returns trigger
  language plpgsql
  security invoker
  set search_path = public
as $$
declare
  prog text;
begin
  if tg_op = 'UPDATE' then
    if new.project_id is distinct from old.project_id then
      raise exception 'stratos:payment_project_fixed' using errcode = 'P0001';
    end if;
    if new.origin is distinct from old.origin then
      raise exception 'stratos:payment_origin_fixed' using errcode = 'P0001';
    end if;
  elsif new.origin = 'legacy' and current_user in ('anon', 'authenticated') then
    raise exception 'stratos:payment_origin_fixed' using errcode = 'P0001',
      hint = 'Carried-over rows are written by the migration only.';
  end if;

  -- Read the programme with the caller's rights: a caller who cannot see the
  -- project gets "not found" from RLS anyway, and must not learn it exists.
  select program into prog from projects where id = new.project_id;
  if prog = 'impact' then
    raise exception 'stratos:payment_impact_free' using errcode = 'P0001',
      hint = 'An Impact project is free: it has no payment schedule and takes no client payment.';
  end if;

  -- Nested, not ANDed: `new.paid_on` does not exist on an instalment, and
  -- PL/pgSQL does not short-circuit a field reference.
  if tg_table_name = 'project_payments' then
    if new.paid_on is not null and new.paid_on > portal_today() then
      raise exception 'stratos:payment_future_date' using errcode = 'P0001',
        hint = 'Record a payment on the day it arrived, not before.';
    end if;
    if tg_op = 'UPDATE' then
      if old.paid_on is not null and new.paid_on is null then
        raise exception 'stratos:payment_date_required' using errcode = 'P0001';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists project_instalments_rules on project_instalments;
create trigger project_instalments_rules before insert or update on project_instalments
  for each row execute function project_payment_rules();
drop trigger if exists project_payments_rules on project_payments;
create trigger project_payments_rules before insert or update on project_payments
  for each row execute function project_payment_rules();

-- A schedule is in the project's currency, so the currency is fixed once there
-- is one. Changing it would silently re-denominate every amount.
create or replace function project_currency_fixed() returns trigger
  language plpgsql security invoker set search_path = public
as $$
begin
  if new.currency is distinct from old.currency
     and exists (select 1 from project_instalments where project_id = new.id) then
    raise exception 'stratos:payment_currency_fixed' using errcode = 'P0001',
      hint = 'This project has a payment schedule in its current currency.';
  end if;
  return new;
end;
$$;

drop trigger if exists projects_currency_fixed on projects;
create trigger projects_currency_fixed before update of currency on projects
  for each row execute function project_currency_fixed();


-- ###########################################################################
-- 3. ONE SOURCE: THE SINGLE-SUM COLUMNS ARE DERIVED
-- ###########################################################################

-- What the schedule says the three old columns are.
--   paid_amount      sum of payments; null when there is none
--   invoiced_amount  sum of invoiced instalments; null when none is invoiced
--   payment_state    paid            payments reach the contract value (or, with
--                                    no contract value, the scheduled total)
--                    partially_paid  some payment, less than that
--                    invoiced        no payment, something invoiced
--                    not_invoiced    neither
create or replace function project_payment_derived(p_project uuid, p_value numeric)
returns table (payment_state payment_state, invoiced_amount numeric, paid_amount numeric)
  language sql stable security invoker set search_path = public
as $$
  with s as (
    select coalesce(sum(i.amount), 0) as scheduled,
           coalesce(sum(i.amount) filter (where i.invoiced), 0) as invoiced,
           count(*) filter (where i.invoiced) as n_invoiced
    from project_instalments i where i.project_id = p_project
  ), p as (
    select coalesce(sum(x.amount), 0) as paid, count(*) as n
    from project_payments x where x.project_id = p_project
  )
  select
    (case
       when p.n > 0 and coalesce(p_value, s.scheduled) > 0 and p.paid >= coalesce(p_value, s.scheduled) then 'paid'
       when p.n > 0 then 'partially_paid'
       when s.n_invoiced > 0 then 'invoiced'
       else 'not_invoiced'
     end)::payment_state,
    case when s.n_invoiced > 0 then s.invoiced end,
    case when p.n > 0 then p.paid end
  from s, p
$$;

-- On every insert and update of a project: the three columns are set from the
-- schedule. A caller who tries to CHANGE one of them to anything else is
-- refused rather than silently overruled, so no form can appear to save a
-- payment state the schedule does not support. Sending back the value that was
-- read (the old Portal's edit form does) is accepted.
create or replace function project_payment_derive() returns trigger
  language plpgsql security invoker set search_path = public
as $$
declare
  d record;
begin
  select * into d from project_payment_derived(new.id, new.value);

  if (tg_op = 'INSERT' and (
        new.payment_state is distinct from d.payment_state
        or new.invoiced_amount is distinct from d.invoiced_amount
        or new.paid_amount is distinct from d.paid_amount))
     or (tg_op = 'UPDATE' and (
        (new.payment_state is distinct from old.payment_state and new.payment_state is distinct from d.payment_state)
        or (new.invoiced_amount is distinct from old.invoiced_amount and new.invoiced_amount is distinct from d.invoiced_amount)
        or (new.paid_amount is distinct from old.paid_amount and new.paid_amount is distinct from d.paid_amount))) then
    raise exception 'stratos:payment_derived' using errcode = 'P0001',
      hint = 'Payment state, invoiced and paid amounts follow the payment schedule. Record an instalment or a payment instead.';
  end if;

  new.payment_state   := d.payment_state;
  new.invoiced_amount := d.invoiced_amount;
  new.paid_amount     := d.paid_amount;
  return new;
end;
$$;

-- `zz_` so it runs after every other BEFORE trigger on projects (alphabetical
-- order), i.e. on the final `value`.
drop trigger if exists projects_zz_payment_derive on projects;
create trigger projects_zz_payment_derive before insert or update on projects
  for each row execute function project_payment_derive();

-- After any schedule change, touch the project so the trigger above recomputes.
-- `set payment_state = payment_state` changes nothing by itself; the derive
-- trigger replaces it with the schedule's answer.
create or replace function project_payment_sync() returns trigger
  language plpgsql security invoker set search_path = public
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    update projects set payment_state = payment_state where id = old.project_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') and (tg_op = 'INSERT' or new.project_id is distinct from old.project_id) then
    update projects set payment_state = payment_state where id = new.project_id;
  end if;
  return null;
end;
$$;

drop trigger if exists project_instalments_sync on project_instalments;
create trigger project_instalments_sync after insert or update or delete on project_instalments
  for each row execute function project_payment_sync();
drop trigger if exists project_payments_sync on project_payments;
create trigger project_payments_sync after insert or update or delete on project_payments
  for each row execute function project_payment_sync();


-- ###########################################################################
-- 7. AUDIT
-- ###########################################################################

create or replace function log_payment_change() returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  kind   text := case tg_table_name when 'project_instalments' then 'instalment' else 'payment' end;
  target uuid;
  event  text;
  detail jsonb;
begin
  -- The amounts are in the project's currency, which is fixed while the
  -- schedule exists (project_currency_fixed). This definer function reads no
  -- project row on purpose: the rule "no API-reachable definer reads projects"
  -- (client-portal-verify.sql) stays exactly as phase 4 left it.
  target := case when tg_op = 'DELETE' then old.project_id else new.project_id end;

  if tg_op = 'INSERT' then
    event := 'project.' || kind || '_added';
    detail := to_jsonb(new) - 'created_by' - 'created_at' - 'updated_at';
  elsif tg_op = 'DELETE' then
    event := 'project.' || kind || '_removed';
    detail := to_jsonb(old) - 'created_by' - 'created_at' - 'updated_at';
  else
    -- Only the fields that changed, old → new. An update that changed nothing
    -- that matters (position, updated_at) is not logged.
    select jsonb_object_agg(k, jsonb_build_object('from', to_jsonb(old) -> k, 'to', to_jsonb(new) -> k))
      into detail
    from jsonb_object_keys(to_jsonb(new) - 'updated_at' - 'position' - 'created_at' - 'created_by') k
    where (to_jsonb(new) -> k) is distinct from (to_jsonb(old) -> k);
    if detail is null then return null; end if;
    event := 'project.' || kind || '_changed';
    detail := detail || jsonb_build_object('id', new.id);
  end if;

  insert into activity_logs (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), event, 'project', target, detail);
  return null;
end;
$$;

drop trigger if exists project_instalments_audit on project_instalments;
create trigger project_instalments_audit after insert or update or delete on project_instalments
  for each row execute function log_payment_change();
drop trigger if exists project_payments_audit on project_payments;
create trigger project_payments_audit after insert or update or delete on project_payments
  for each row execute function log_payment_change();


-- ###########################################################################
-- 8. ACCESS
-- ###########################################################################

alter table project_instalments enable row level security;
alter table project_instalments force  row level security;
alter table project_payments    enable row level security;
alter table project_payments    force  row level security;

drop policy if exists project_instalments_owner_all on project_instalments;
create policy project_instalments_owner_all on project_instalments
  for all using (is_owner()) with check (is_owner());
drop policy if exists project_payments_owner_all on project_payments;
create policy project_payments_owner_all on project_payments
  for all using (is_owner()) with check (is_owner());


-- ###########################################################################
-- 4. THE CARRY-OVER
-- ###########################################################################

-- The single-sum figures exactly as they were before this migration, one row per
-- project that had any, plus what became of them. Never rewritten by the API:
-- the owner may only mark a row reviewed.
create table if not exists project_finance_legacy (
  -- No foreign key on purpose: this is a record of what was there, and it
  -- stays even if the project row is later removed by hand.
  project_id       uuid primary key,
  project_name     text not null,
  currency         text not null,
  value            numeric(14, 2),
  payment_state    text not null,
  invoiced_amount  numeric(14, 2),
  paid_amount      numeric(14, 2),
  captured_at      timestamptz not null default now(),
  -- carried  = turned into a legacy instalment (and payment), nothing doubtful
  -- review   = carried as far as the figures allow; see `issues`
  outcome          text not null check (outcome in ('carried', 'review')),
  issues           text[] not null default '{}',
  instalment_id    uuid,
  payment_id       uuid,
  derived_state    text,
  reviewed_at      timestamptz,
  reviewed_by      uuid references profiles(id) on delete set null
);

alter table project_finance_legacy enable row level security;
alter table project_finance_legacy force  row level security;
drop policy if exists project_finance_legacy_owner_select on project_finance_legacy;
drop policy if exists project_finance_legacy_owner_review on project_finance_legacy;
create policy project_finance_legacy_owner_select on project_finance_legacy
  for select using (is_owner());
create policy project_finance_legacy_owner_review on project_finance_legacy
  for update using (is_owner()) with check (is_owner());

-- The owner may mark a row reviewed (or un-mark it), and change nothing else.
create or replace function project_finance_legacy_review() returns trigger
  language plpgsql security invoker set search_path = public
as $$
begin
  if (to_jsonb(new) - 'reviewed_at' - 'reviewed_by') is distinct from (to_jsonb(old) - 'reviewed_at' - 'reviewed_by')
     and current_user in ('anon', 'authenticated') then
    raise exception 'stratos:payment_legacy_fixed' using errcode = 'P0001';
  end if;
  if current_user in ('anon', 'authenticated') then
    new.reviewed_by := case when new.reviewed_at is null then null else auth.uid() end;
  end if;
  return new;
end;
$$;

drop trigger if exists project_finance_legacy_review on project_finance_legacy;
create trigger project_finance_legacy_review before update on project_finance_legacy
  for each row execute function project_finance_legacy_review();

-- The carry-over itself. Re-runnable: a project already in the snapshot is
-- skipped, so a second run (or re-applying the whole file) adds nothing.
--
-- Per paid project with any single-sum figure (a payment state other than
-- `not_invoiced`, an invoiced amount or a paid amount):
--   instalment  "Korábbi egyösszegű rögzítés", origin legacy, NO due date,
--               amount = invoiced amount, else contract value, else paid amount;
--               invoiced if the old state or amount said so
--   payment     the paid amount, origin legacy, NO date (it was never recorded)
-- If none of the three amounts is positive nothing can be carried: the snapshot
-- keeps the state and the row is listed for review.
create or replace function payment_carry_over()
returns table (carried integer, review integer)
  language plpgsql security invoker set search_path = public
as $$
declare
  r        record;
  base     numeric;
  inv      numeric;
  paid     numeric;
  issues   text[];
  ins_id   uuid;
  pay_id   uuid;
  n_carry  integer := 0;
  n_review integer := 0;
  derived  text;
begin
  for r in
    select p.* from projects p
    where p.program = 'paid'
      and (p.payment_state <> 'not_invoiced' or p.invoiced_amount is not null or p.paid_amount is not null)
      and not exists (select 1 from project_finance_legacy l where l.project_id = p.id)
      and not exists (select 1 from project_instalments i where i.project_id = p.id)
    order by p.created_at, p.id
    for update
  loop
    inv  := coalesce(r.invoiced_amount, 0);
    paid := coalesce(r.paid_amount, 0);
    base := case when inv > 0 then inv when coalesce(r.value, 0) > 0 then r.value when paid > 0 then paid end;
    issues := '{}';
    ins_id := null; pay_id := null;

    if paid > 0 then issues := array_append(issues, 'payment_date_unknown'); end if;
    if base is null then issues := array_append(issues, 'nothing_to_carry'); end if;
    if inv = 0 and base is not null and base = r.value and r.payment_state <> 'not_invoiced' then
      issues := array_append(issues, 'instalment_amount_from_contract_value');
    end if;
    if r.payment_state = 'paid' and paid = 0 then issues := array_append(issues, 'marked_paid_without_amount');
    elsif r.payment_state = 'paid' and paid < coalesce(r.value, inv) then issues := array_append(issues, 'marked_paid_amount_short');
    end if;
    if r.payment_state = 'partially_paid' and paid = 0 then issues := array_append(issues, 'partial_without_amount'); end if;
    if r.payment_state = 'not_invoiced' and (paid > 0 or inv > 0) then issues := array_append(issues, 'state_contradicts_amounts'); end if;
    if r.payment_state = 'invoiced' and paid > 0 then issues := array_append(issues, 'state_contradicts_amounts'); end if;
    if r.value is not null and paid > r.value then issues := array_append(issues, 'paid_exceeds_contract'); end if;
    if r.value is not null and inv > r.value then issues := array_append(issues, 'invoiced_exceeds_contract'); end if;
    if inv > 0 and paid > inv then issues := array_append(issues, 'paid_exceeds_invoiced'); end if;

    if base is not null then
      insert into project_instalments (project_id, label, amount, due_on, invoiced, note, origin, created_by)
      values (r.id, 'Korábbi egyösszegű rögzítés', base, null,
              inv > 0 or r.payment_state in ('invoiced', 'partially_paid', 'paid'),
              'Átvezetve a korábbi egyösszegű mezőkből. Esedékesség nem volt rögzítve.',
              'legacy', null)
      returning id into ins_id;
      if paid > 0 then
        insert into project_payments (instalment_id, project_id, amount, paid_on, note, origin, created_by)
        values (ins_id, r.id, paid, null,
                'Átvezetve a korábbi "befizetett összeg" mezőből. A befizetés dátuma nem volt rögzítve.',
                'legacy', null)
        returning id into pay_id;
      end if;
    end if;

    -- Apply the derived values now (the derive trigger does it on this touch)
    -- and record whether the visible state changed.
    update projects set payment_state = payment_state where id = r.id
      returning payment_state::text into derived;
    if derived is distinct from r.payment_state::text then
      issues := array_append(issues, ('state_changed:' || r.payment_state::text || '->' || derived));
    end if;

    insert into project_finance_legacy (project_id, project_name, currency, value, payment_state,
                                        invoiced_amount, paid_amount, outcome, issues,
                                        instalment_id, payment_id, derived_state)
    values (r.id, r.name, r.currency, r.value, r.payment_state::text, r.invoiced_amount, r.paid_amount,
            case when issues = '{}' or issues = array['payment_date_unknown'] then 'carried' else 'review' end,
            issues, ins_id, pay_id, derived);

    insert into activity_logs (user_id, action, entity_type, entity_id, metadata)
    values (null, 'project.finance_carried_over', 'project', r.id,
            jsonb_build_object('payment_state', r.payment_state::text, 'invoiced_amount', r.invoiced_amount,
                               'paid_amount', r.paid_amount, 'currency', r.currency, 'issues', to_jsonb(issues)));

    if issues = '{}' or issues = array['payment_date_unknown'] then n_carry := n_carry + 1;
    else n_review := n_review + 1; end if;
  end loop;

  return query select n_carry, n_review;
end;
$$;

comment on function payment_carry_over is
  'One-off, re-runnable carry-over of the single-sum payment fields into the schedule. SQL editor only.';

select * from payment_carry_over();

-- Every other project: make the derived columns true now. After the carry-over
-- the only rows this changes are projects that had nothing (all defaults), so it
-- is a no-op in practice — and a guarantee that no row disagrees with its
-- schedule from here on.
update projects p set payment_state = payment_state
where p.payment_state is distinct from (select d.payment_state from project_payment_derived(p.id, p.value) d)
   or p.invoiced_amount is distinct from (select d.invoiced_amount from project_payment_derived(p.id, p.value) d)
   or p.paid_amount is distinct from (select d.paid_amount from project_payment_derived(p.id, p.value) d);


-- ###########################################################################
-- 6. THE FIGURES
-- ###########################################################################

-- One row per paid project the caller may read (RLS: the owner, nobody else).
-- Every amount is in that row's `currency`; nothing here adds two currencies.
--
--   contracted   projects.value (null = not recorded)
--   scheduled    sum of instalments
--   paid         sum of payments (all of them — nothing is capped)
--   remaining    what is still to come against the contract value, or the
--                scheduled total when there is no contract value; never below 0
--   overpaid     paid beyond that basis; shown, never absorbed
--   overdue      shortfall of instalments whose due date has passed, capped at
--                `remaining` (money over-paid on one instalment is not owed on
--                another)
--   schedule_gap scheduled − contracted (null without a contract value);
--                anything but 0 is a mismatch to show
create or replace function project_payment_overview(p_project uuid default null)
returns table (
  project_id uuid, project_name text, client_name text, status text, archived boolean,
  currency text, contracted numeric, scheduled numeric, paid numeric, remaining numeric,
  overpaid numeric, overdue numeric, schedule_gap numeric, next_due_on date,
  instalments integer, payments integer, undated_payments integer
)
  language sql stable security invoker set search_path = public
as $$
  with inst as (
    select i.project_id, i.id, i.amount, i.due_on,
           coalesce((select sum(x.amount) from project_payments x where x.instalment_id = i.id), 0) as got
    from project_instalments i
    where p_project is null or i.project_id = p_project
  ), per as (
    select project_id,
           sum(amount) as scheduled,
           count(*)::int as n,
           sum(greatest(amount - got, 0)) filter (where due_on < portal_today()) as late,
           min(due_on) filter (where got < amount) as next_due
    from inst group by project_id
  ), pay as (
    select x.project_id, sum(x.amount) as paid, count(*)::int as n,
           count(*) filter (where x.paid_on is null)::int as undated
    from project_payments x
    where p_project is null or x.project_id = p_project
    group by x.project_id
  ), base as (
    select p.id, p.name, o.name as client_name, p.status::text as status, p.archived_at is not null as archived,
           p.currency, p.value,
           coalesce(per.scheduled, 0) as scheduled,
           coalesce(pay.paid, 0) as paid,
           coalesce(p.value, per.scheduled, 0) as basis,
           coalesce(per.late, 0) as late,
           per.next_due, coalesce(per.n, 0) as n_inst, coalesce(pay.n, 0) as n_pay,
           coalesce(pay.undated, 0) as undated
    from projects p
    left join organizations o on o.id = p.organization_id
    left join per on per.project_id = p.id
    left join pay on pay.project_id = p.id
    where p.program = 'paid' and (p_project is null or p.id = p_project)
  )
  select id, name, client_name, status, archived, currency,
         value, scheduled, paid,
         greatest(basis - paid, 0),
         greatest(paid - basis, 0),
         least(late, greatest(basis - paid, 0)),
         case when value is null then null else scheduled - value end,
         next_due, n_inst, n_pay, undated
  from base
  order by name
$$;


-- ###########################################################################
-- 9. SALES: "NEXT ACTION DONE", ATOMICALLY
-- ###########################################################################

-- Clears the next action and writes "Done: …" to the deal's notes in ONE
-- transaction, and only if the deal still has exactly the action the caller
-- saw. So:
--   * a failed save writes neither (no false "done" note);
--   * a retry or a double click after a success matches nothing and writes
--     nothing (returns false) — no duplicate note;
--   * a stale screen cannot clear an action somebody else has just set.
-- SECURITY INVOKER: the caller needs the same rights as before (admin: update
-- the deal and add a note).
create or replace function opportunity_complete_action(p_id uuid, p_expected text)
returns boolean
  language plpgsql security invoker set search_path = public
as $$
declare
  due  date;
  hits integer;
begin
  if p_expected is null or btrim(p_expected) = '' then
    return false;
  end if;

  -- Lock the deal first: two concurrent completions queue here, and the second
  -- then no longer finds the action it expected.
  select next_action_on into due from opportunities
   where id = p_id and next_action = p_expected
   for update;
  if not found then
    return false;
  end if;

  update opportunities
     set next_action = null, next_action_on = null
   where id = p_id and next_action = p_expected;
  get diagnostics hits = row_count;
  if hits = 0 then
    return false;
  end if;

  insert into record_notes (entity_type, entity_id, author_id, body)
  values ('opportunity', p_id, auth.uid(),
          'Done: ' || p_expected || coalesce(' (due ' || due::text || ')', ''));
  return true;
end;
$$;


-- ###########################################################################
-- GRANTS
-- ###########################################################################

do $$
declare
  f text;
begin
  execute 'revoke all on table project_instalments, project_payments, project_finance_legacy from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table project_instalments, project_payments, project_finance_legacy from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table project_instalments, project_payments, project_finance_legacy from authenticated';
    execute 'grant select, insert, update, delete on table project_instalments, project_payments to authenticated';
    execute 'grant select, update on table project_finance_legacy to authenticated';
  end if;

  foreach f in array array[
    'project_payment_overview(uuid)',
    'project_payment_derived(uuid, numeric)',
    'opportunity_complete_action(uuid, text)',
    'portal_today()'
  ] loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', f);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('grant execute on function %s to authenticated', f);
    end if;
  end loop;

  -- SQL editor only.
  execute 'revoke all on function payment_carry_over() from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function payment_carry_over() from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function payment_carry_over() from authenticated';
  end if;
end $$;

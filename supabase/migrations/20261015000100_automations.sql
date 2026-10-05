-- =============================================================================
-- Stratos — automations ("5. CRM", first part)
--
-- Owner decisions of 2026-10-05. Four rules, each producing an ALERT — a line
-- on Today with a link — and a push + e-mail to the owner and the admins:
--
--   1. lead_unanswered     a new lead nobody answered within N hours (no
--                          status change, no logged interaction)
--   2. deal_stale          an open deal that has not moved for N days and has
--                          no next step in the future
--   3. deal_won            a won deal with no project yet
--   4. instalment_overdue  a project with an overdue payment (the payment
--   + deadline_soon        schedule's own figure); a project deadline within
--                          N days
--
-- Once per thing: every alert has a key (e.g. the lead, or the deal and the day
-- it last moved), so a rule never repeats itself. An alert closes by itself when
-- its cause is gone (the lead was answered, the deal moved, the instalment was
-- paid, the project was closed); the owner can also tick it off.
--
-- `automation_run()` is called every minute by the sender
-- (netlify/functions/notify-dispatch.mjs) with the server key. The rules and
-- their thresholds are in Settings (portal_settings, owner only).
--
-- Run after 20261014000100_client_experience.sql. Re-runnable.
-- =============================================================================

do $$
begin
  if to_regclass('public.portal_settings') is null then
    raise exception '20261014000100_client_experience.sql is not applied.';
  end if;
  if current_user in ('anon', 'authenticated') then
    raise exception 'Run this migration from the SQL editor, not as an API role.';
  end if;
end $$;


-- ###########################################################################
-- 1. SETTINGS
-- ###########################################################################

alter table portal_settings add column if not exists auto_lead_on boolean not null default true;
alter table portal_settings add column if not exists auto_lead_hours integer not null default 24;
alter table portal_settings add column if not exists auto_deal_on boolean not null default true;
alter table portal_settings add column if not exists auto_deal_days integer not null default 14;
alter table portal_settings add column if not exists auto_won_on boolean not null default true;
alter table portal_settings add column if not exists auto_overdue_on boolean not null default true;
alter table portal_settings add column if not exists auto_deadline_on boolean not null default true;
alter table portal_settings add column if not exists auto_deadline_days integer not null default 3;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'portal_settings_auto_check') then
    alter table portal_settings add constraint portal_settings_auto_check check (
      auto_lead_hours between 1 and 720 and auto_deal_days between 1 and 365 and auto_deadline_days between 1 and 60);
  end if;
end $$;


-- ###########################################################################
-- 2. ALERTS
-- ###########################################################################

create table if not exists automation_alerts (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null check (kind in ('lead_unanswered', 'deal_stale', 'deal_won', 'instalment_overdue', 'deadline_soon')),
  -- Once per cause: 'lead:<id>', 'deal_stale:<id>:<day it last moved>', …
  dedupe         text not null unique,
  lead_id        uuid references leads(id) on delete cascade,
  opportunity_id uuid references opportunities(id) on delete cascade,
  project_id     uuid references projects(id) on delete cascade,
  title          text not null check (length(title) <= 300),
  detail         text check (detail is null or length(detail) <= 300),
  due_on         date,
  amount         numeric(14, 2),
  currency       text,
  created_at     timestamptz not null default now(),
  -- The cause went away (set by automation_run()).
  resolved_at    timestamptz,
  -- Ticked off by a person.
  done_at        timestamptz,
  done_by        uuid references profiles(id) on delete set null
);
create index if not exists automation_alerts_open_idx on automation_alerts (created_at desc) where done_at is null and resolved_at is null;

-- Through the API only "done" changes.
create or replace function automation_alert_rules() returns trigger
  language plpgsql set search_path = public
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if (to_jsonb(new) - 'done_at' - 'done_by') is distinct from (to_jsonb(old) - 'done_at' - 'done_by') then
      raise exception 'stratos:alert_fixed' using errcode = 'P0001';
    end if;
    new.done_by := case when new.done_at is null then null else auth.uid() end;
  end if;
  return new;
end;
$$;
drop trigger if exists automation_alerts_rules on automation_alerts;
create trigger automation_alerts_rules before update on automation_alerts
  for each row execute function automation_alert_rules();

alter table automation_alerts enable row level security;
alter table automation_alerts force row level security;
-- Admins see the lead and deal alerts; project alerts follow the projects
-- (the owner and the owner's delegates).
drop policy if exists automation_alerts_read on automation_alerts;
create policy automation_alerts_read on automation_alerts for select
  using (is_admin() and (project_id is null or is_owner()));
drop policy if exists automation_alerts_done on automation_alerts;
create policy automation_alerts_done on automation_alerts for update
  using (is_admin() and (project_id is null or is_owner()))
  with check (is_admin() and (project_id is null or is_owner()));


-- ###########################################################################
-- 3. NOTIFICATIONS — five owner kinds
-- ###########################################################################

alter table notification_outbox drop constraint if exists notification_outbox_kind_check;
alter table notification_outbox add constraint notification_outbox_kind_check check (kind in (
  -- to the owner and the admins
  'client_upload', 'client_feedback', 'client_reschedule', 'client_reschedule_withdrawn', 'test',
  'client_message', 'client_approved', 'client_changes_requested', 'client_request_done', 'client_survey',
  'auto_lead_unanswered', 'auto_deal_stale', 'auto_deal_won', 'auto_instalment_overdue', 'auto_deadline_soon',
  -- to a client
  'document_shared', 'demo_published', 'meeting_scheduled', 'meeting_changed', 'meeting_cancelled',
  'reschedule_decided', 'feedback_replied', 'request_added', 'message_posted', 'approval_requested', 'survey_requested'));


-- ###########################################################################
-- 4. THE RUN
-- ###########################################################################

-- Closes the alerts whose cause is gone, then raises the new ones and queues
-- one notification per new alert. Returns how many were raised. `p_now` is for
-- the tests; the sender leaves it out. SECURITY INVOKER: the server key only.
create or replace function automation_run(p_now timestamptz default null) returns integer
  language plpgsql volatile security invoker set search_path = public
as $$
declare
  now_ timestamptz := coalesce(p_now, now());
  today date := (now_ at time zone 'Europe/Budapest')::date;
  s portal_settings;
  n integer := 0;
  k integer;
begin
  select * into s from portal_settings where id;
  if s.id is null then
    return 0;
  end if;

  -- ---------------------------------------------------------- close the old
  update automation_alerts a set resolved_at = now_
   where a.done_at is null and a.resolved_at is null and (
     (a.kind = 'lead_unanswered' and (
        not exists (select 1 from leads l where l.id = a.lead_id and l.status = 'new' and l.trashed_at is null)
        or exists (select 1 from interactions i where i.lead_id = a.lead_id)))
     or (a.kind = 'deal_stale' and not exists (
        select 1 from opportunities o where o.id = a.opportunity_id and o.stage not in ('won', 'lost') and o.archived_at is null
          and greatest(o.updated_at, coalesce((select max(i.occurred_at) from interactions i where i.opportunity_id = o.id), o.updated_at)) <= a.created_at))
     or (a.kind = 'deal_won' and exists (select 1 from projects p where p.opportunity_id = a.opportunity_id))
     or (a.kind = 'instalment_overdue' and not exists (
        select 1 from project_payment_overview(a.project_id) v where v.overdue > 0))
     or (a.kind = 'deadline_soon' and not exists (
        select 1 from projects p where p.id = a.project_id and p.archived_at is null
          and p.status::text not in ('completed', 'cancelled', 'archived') and p.target_date = a.due_on)));

  -- ----------------------------------------------------------- raise the new
  create temp table if not exists automation_new (id uuid, kind text, project_id uuid, payload jsonb) on commit drop;
  truncate automation_new;

  if s.auto_lead_on then
    with ins as (
      insert into automation_alerts (kind, dedupe, lead_id, title, detail, created_at)
      select 'lead_unanswered', 'lead:' || l.id, l.id,
             left(coalesce(nullif(btrim(l.name), ''), l.email, '—'), 300),
             left(nullif(concat_ws(' · ', nullif(btrim(l.company), ''), nullif(btrim(l.service_interest), '')), ''), 300), now_
      from leads l
      where l.status = 'new' and l.trashed_at is null
        and l.created_at < now_ - make_interval(hours => s.auto_lead_hours)
        and l.created_at > now_ - interval '14 days'
        and not exists (select 1 from interactions i where i.lead_id = l.id)
      on conflict (dedupe) do nothing
      returning id, kind, title, detail, lead_id)
    insert into automation_new select ins.id, ins.kind, null,
      jsonb_build_object('alert_id', ins.id, 'lead_id', ins.lead_id, 'title', ins.title, 'detail', ins.detail, 'hours', s.auto_lead_hours)
    from ins;
  end if;

  if s.auto_deal_on then
    with moved as (
      select o.*, greatest(o.updated_at, coalesce((select max(i.occurred_at) from interactions i where i.opportunity_id = o.id), o.updated_at)) as last_move
      from opportunities o
      where o.stage not in ('won', 'lost') and o.archived_at is null
    ), ins as (
      insert into automation_alerts (kind, dedupe, opportunity_id, title, detail, created_at)
      select 'deal_stale', 'deal_stale:' || m.id || ':' || (m.last_move at time zone 'Europe/Budapest')::date, m.id,
             left(m.title, 300), left(nullif(btrim(coalesce(m.company_name, '')), ''), 300), now_
      from moved m
      where m.last_move < now_ - make_interval(days => s.auto_deal_days)
        and (m.next_action_on is null or m.next_action_on < today)
      on conflict (dedupe) do nothing
      returning id, kind, title, detail, opportunity_id)
    insert into automation_new select ins.id, ins.kind, null,
      jsonb_build_object('alert_id', ins.id, 'opportunity_id', ins.opportunity_id, 'title', ins.title, 'detail', ins.detail, 'days', s.auto_deal_days)
    from ins;
  end if;

  if s.auto_won_on then
    with ins as (
      insert into automation_alerts (kind, dedupe, opportunity_id, title, detail, created_at)
      select 'deal_won', 'won:' || o.id, o.id, left(o.title, 300), left(nullif(btrim(coalesce(o.company_name, '')), ''), 300), now_
      from opportunities o
      where o.stage = 'won' and o.archived_at is null and o.won_at > now_ - interval '30 days'
        and not exists (select 1 from projects p where p.opportunity_id = o.id)
      on conflict (dedupe) do nothing
      returning id, kind, title, detail, opportunity_id)
    insert into automation_new select ins.id, ins.kind, null,
      jsonb_build_object('alert_id', ins.id, 'opportunity_id', ins.opportunity_id, 'title', ins.title, 'detail', ins.detail)
    from ins;
  end if;

  if s.auto_overdue_on then
    with due as (
      select v.project_id, v.project_name, v.client_name, v.overdue, v.currency,
             (select min(i.due_on) from project_instalments i where i.project_id = v.project_id and i.due_on < today
                and i.amount > coalesce((select sum(pp.amount) from project_payments pp where pp.instalment_id = i.id), 0)) as first_due
      from project_payment_overview() v
      join projects p on p.id = v.project_id
      where v.overdue > 0 and p.archived_at is null
    ), ins as (
      insert into automation_alerts (kind, dedupe, project_id, title, detail, due_on, amount, currency, created_at)
      select 'instalment_overdue', 'overdue:' || d.project_id || ':' || coalesce(d.first_due::text, '-'), d.project_id,
             left(d.project_name, 300), left(d.client_name, 300), d.first_due, d.overdue, d.currency, now_
      from due d
      on conflict (dedupe) do nothing
      returning id, kind, title, detail, project_id, amount, currency, due_on)
    insert into automation_new select ins.id, ins.kind, ins.project_id,
      jsonb_build_object('alert_id', ins.id, 'title', ins.title, 'detail', ins.detail, 'amount', ins.amount, 'currency', ins.currency, 'due_on', ins.due_on)
    from ins;
  end if;

  if s.auto_deadline_on then
    with ins as (
      insert into automation_alerts (kind, dedupe, project_id, title, detail, due_on, created_at)
      select 'deadline_soon', 'deadline:' || p.id || ':' || p.target_date, p.id, left(p.name, 300),
             left((select o.name from organizations o where o.id = p.organization_id), 300), p.target_date, now_
      from projects p
      where p.archived_at is null and p.status::text not in ('completed', 'cancelled', 'archived')
        and p.target_date between today and today + s.auto_deadline_days
      on conflict (dedupe) do nothing
      returning id, kind, title, detail, project_id, due_on)
    insert into automation_new select ins.id, ins.kind, ins.project_id,
      jsonb_build_object('alert_id', ins.id, 'title', ins.title, 'detail', ins.detail, 'due_on', ins.due_on)
    from ins;
  end if;

  insert into notification_outbox (audience, kind, project_id, payload, created_by)
  select 'owner', 'auto_' || a.kind, a.project_id, a.payload, null from automation_new a;
  get diagnostics k = row_count;
  n := n + k;
  return n;
end;
$$;


-- ###########################################################################
-- ACCESS
-- ###########################################################################

do $$
begin
  execute 'revoke all on table automation_alerts from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table automation_alerts from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table automation_alerts from authenticated';
    execute 'grant select, update on table automation_alerts to authenticated';
  end if;

  execute 'revoke all on function automation_run(timestamptz) from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function automation_run(timestamptz) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function automation_run(timestamptz) from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function automation_run(timestamptz) to service_role';
  end if;
end $$;

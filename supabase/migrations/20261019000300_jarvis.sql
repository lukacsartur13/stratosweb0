-- =============================================================================
-- Stratos — Jarvis, the assistant in the Portal (JARVIS_SPEC.md §2, phase 2)
--
-- Owner decisions of 2026-10-19 (supabase/JARVIS.md §4): Jarvis runs in
-- Netlify Functions; owner and admins may use it (is_admin(), not is_staff():
-- a team member reaches almost none of the CRM); the migration is applied with
-- the Supabase MCP.
--
--   A. jarvis_threads    one conversation, its owner's alone; optionally about
--                        one record (lead | opportunity | client | project)
--   B. jarvis_messages   the conversation as the Claude API sees it: content
--                        blocks, the model, the tokens. Append-only.
--   C. jarvis_runs       background work: the morning brief, the agent's jobs,
--                        long jobs started from a chat
--   D. jarvis_actions    every write Jarvis makes or proposes. 'internal' ones
--                        are logged as done; 'external' ones (e-mail, invite,
--                        client message) wait for a person to approve them.
--                        The status moves one way only (see the rules below).
--                        Each new action and each change of status also goes
--                        into activity_logs as 'jarvis.<tool>'.
--   E. jarvis_memory     facts and preferences Jarvis is given or proposes.
--                        The owner keeps them; a proposal waits for approval.
--   F. jarvis_settings   one row: token budget, brief, agent jobs, voice,
--                        rate limit, how long conversations are kept
--   G. jarvis_usage      tokens per Budapest day and model, counted from B and
--                        C by a trigger: the daily budget is one read, for any
--                        admin, without anyone reading anyone else's messages
--
-- Who reaches what (RLS, FORCE on every table):
--   threads, messages   their own person, while an admin
--   actions             their own person, while an admin; and the owner, all
--                       of them. Not every admin all of them: a payload may
--                       carry owner-only project data.
--   runs                the owner; an admin the runs started for them
--   memory              the owner; an admin reads the approved facts and their
--                       own proposals, and may only PROPOSE one (source
--                       'jarvis', not approved)
--   settings            every admin reads; the owner changes
--   usage               every admin reads; only the trigger writes
--
-- Nothing here deletes CRM data, and Jarvis gets no table to do it with.
-- Run after 20261019000200_email_automations.sql. Re-runnable.
-- =============================================================================

do $$
begin
  if to_regprocedure('public.is_owner()') is null or to_regprocedure('public.is_admin()') is null then
    raise exception 'The role helpers (is_admin, is_owner) are missing: run the earlier migrations first.';
  end if;
  if current_user in ('anon', 'authenticated') then
    raise exception 'Run this migration from the SQL editor, not as an API role.';
  end if;
end $$;


-- ###########################################################################
-- A. THREADS
-- ###########################################################################

create table if not exists jarvis_threads (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null default auth.uid() references profiles(id) on delete cascade,
  title               text check (title is null or length(title) <= 200),
  -- The record the conversation is about, if any: the Portal's own words for
  -- them (record_notes says 'client' for an organization).
  context_entity_type text check (context_entity_type in ('lead', 'opportunity', 'client', 'project')),
  context_entity_id   uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  archived_at         timestamptz,
  check ((context_entity_type is null) = (context_entity_id is null))
);
create index if not exists jarvis_threads_user_idx on jarvis_threads (user_id, updated_at desc);
create index if not exists jarvis_threads_entity_idx on jarvis_threads (context_entity_type, context_entity_id)
  where context_entity_id is not null;

create or replace function jarvis_threads_rules() returns trigger
  language plpgsql set search_path = public
as $$
begin
  new.title := nullif(btrim(coalesce(new.title, '')), '');
  if tg_op = 'UPDATE' then
    if new.user_id is distinct from old.user_id or new.created_at is distinct from old.created_at
       or (new.context_entity_type, new.context_entity_id) is distinct from (old.context_entity_type, old.context_entity_id) then
      raise exception 'stratos:jarvis_thread_fixed' using errcode = 'P0001';
    end if;
    new.updated_at := now();
  else
    new.created_at := now();
    new.updated_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists jarvis_threads_rules on jarvis_threads;
create trigger jarvis_threads_rules before insert or update on jarvis_threads
  for each row execute function jarvis_threads_rules();

alter table jarvis_threads enable row level security;
alter table jarvis_threads force row level security;
drop policy if exists jarvis_threads_own_select on jarvis_threads;
create policy jarvis_threads_own_select on jarvis_threads for select to authenticated
  using (user_id = (select auth.uid()) and (select is_admin()));
drop policy if exists jarvis_threads_own_insert on jarvis_threads;
create policy jarvis_threads_own_insert on jarvis_threads for insert to authenticated
  with check (user_id = (select auth.uid()) and (select is_admin()));
drop policy if exists jarvis_threads_own_update on jarvis_threads;
create policy jarvis_threads_own_update on jarvis_threads for update to authenticated
  using (user_id = (select auth.uid()) and (select is_admin()))
  with check (user_id = (select auth.uid()) and (select is_admin()));
drop policy if exists jarvis_threads_own_delete on jarvis_threads;
create policy jarvis_threads_own_delete on jarvis_threads for delete to authenticated
  using (user_id = (select auth.uid()) and (select is_admin()));


-- ###########################################################################
-- B. MESSAGES
-- ###########################################################################

create table if not exists jarvis_messages (
  id                 uuid primary key default gen_random_uuid(),
  thread_id          uuid not null references jarvis_threads(id) on delete cascade,
  -- 'tool' is the user-role message that carries tool results back to the
  -- model; it is sent to the API as 'user'.
  role               text not null check (role in ('user', 'assistant', 'tool')),
  -- Claude content blocks, as sent or received.
  content            jsonb not null check (jsonb_typeof(content) = 'array' and length(content::text) <= 400000),
  model              text check (model is null or model ~ '^[a-z0-9][a-z0-9.-]{0,63}$'),
  input_tokens       integer check (input_tokens is null or input_tokens >= 0),
  output_tokens      integer check (output_tokens is null or output_tokens >= 0),
  cache_read_tokens  integer check (cache_read_tokens is null or cache_read_tokens >= 0),
  cache_write_tokens integer check (cache_write_tokens is null or cache_write_tokens >= 0),
  created_at         timestamptz not null default now()
);
create index if not exists jarvis_messages_thread_idx on jarvis_messages (thread_id, created_at);

alter table jarvis_messages enable row level security;
alter table jarvis_messages force row level security;
drop policy if exists jarvis_messages_own_select on jarvis_messages;
create policy jarvis_messages_own_select on jarvis_messages for select to authenticated
  using ((select is_admin()) and exists (select 1 from jarvis_threads t
                                         where t.id = thread_id and t.user_id = (select auth.uid())));
drop policy if exists jarvis_messages_own_insert on jarvis_messages;
create policy jarvis_messages_own_insert on jarvis_messages for insert to authenticated
  with check ((select is_admin()) and exists (select 1 from jarvis_threads t
                                              where t.id = thread_id and t.user_id = (select auth.uid())));

create or replace function jarvis_messages_rules() returns trigger
  language plpgsql set search_path = public
as $$
begin
  new.created_at := now();
  return new;
end;
$$;
drop trigger if exists jarvis_messages_rules on jarvis_messages;
create trigger jarvis_messages_rules before insert on jarvis_messages
  for each row execute function jarvis_messages_rules();


-- ###########################################################################
-- C. RUNS
-- ###########################################################################

create table if not exists jarvis_runs (
  id                 uuid primary key default gen_random_uuid(),
  kind               text not null check (kind ~ '^[a-z][a-z_]{0,39}$'),   -- 'brief' | 'lead_hunt' | 'pipeline_watch' | ...
  status             text not null default 'running' check (status in ('running', 'done', 'failed')),
  -- Whom it was for (a job started from a chat), or NULL (the brief, the agent).
  user_id            uuid references profiles(id) on delete set null,
  thread_id          uuid references jarvis_threads(id) on delete set null,
  output             jsonb check (output is null or length(output::text) <= 200000),
  model              text check (model is null or model ~ '^[a-z0-9][a-z0-9.-]{0,63}$'),
  input_tokens       integer not null default 0 check (input_tokens >= 0),
  output_tokens      integer not null default 0 check (output_tokens >= 0),
  cache_read_tokens  integer not null default 0 check (cache_read_tokens >= 0),
  cache_write_tokens integer not null default 0 check (cache_write_tokens >= 0),
  started_at         timestamptz not null default now(),
  finished_at        timestamptz,
  error              text check (error is null or length(error) <= 2000)
);
create index if not exists jarvis_runs_kind_idx on jarvis_runs (kind, started_at desc);
create index if not exists jarvis_runs_user_idx on jarvis_runs (user_id) where user_id is not null;
create index if not exists jarvis_runs_thread_idx on jarvis_runs (thread_id) where thread_id is not null;

alter table jarvis_runs enable row level security;
alter table jarvis_runs force row level security;
-- Written with the server key only (the brief, the agent, background jobs).
drop policy if exists jarvis_runs_read on jarvis_runs;
create policy jarvis_runs_read on jarvis_runs for select to authenticated
  using ((select is_owner()) or (user_id = (select auth.uid()) and (select is_admin())));


-- ###########################################################################
-- D. ACTIONS
-- ###########################################################################

create table if not exists jarvis_actions (
  id          uuid primary key default gen_random_uuid(),
  thread_id   uuid references jarvis_threads(id) on delete set null,
  run_id      uuid references jarvis_runs(id) on delete set null,
  user_id     uuid default auth.uid() references profiles(id) on delete set null,
  tool        text not null check (tool ~ '^[a-z][a-z0-9_]{0,63}$'),
  risk        text not null check (risk in ('internal', 'external')),
  payload     jsonb not null check (jsonb_typeof(payload) = 'object' and length(payload::text) <= 100000),
  -- What the approval card says, in plain words.
  summary     text not null check (length(btrim(summary)) between 1 and 1000),
  status      text not null default 'pending'
              check (status in ('pending', 'approved', 'executed', 'rejected', 'failed', 'reverted')),
  result      jsonb check (result is null or length(result::text) <= 100000),
  error       text check (error is null or length(error) <= 2000),
  created_at  timestamptz not null default now(),
  decided_at  timestamptz,
  decided_by  uuid references profiles(id) on delete set null,
  executed_at timestamptz
);
create index if not exists jarvis_actions_status_idx on jarvis_actions (status, created_at);
create index if not exists jarvis_actions_user_idx on jarvis_actions (user_id, created_at desc);
create index if not exists jarvis_actions_thread_idx on jarvis_actions (thread_id) where thread_id is not null;
create index if not exists jarvis_actions_run_idx on jarvis_actions (run_id) where run_id is not null;
create index if not exists jarvis_actions_decided_by_idx on jarvis_actions (decided_by) where decided_by is not null;

-- The life of an action:
--
--   internal   inserted as 'executed' or 'failed' (it ran before it was
--              logged), or 'pending' when Jarvis wants a person to look first
--   external   always inserted 'pending'
--
--   pending  → approved | rejected        a person decided (stamped here)
--   approved → executed | failed          the server ran it (stamped here)
--   failed   → approved                   tried again
--   executed → reverted                   undone
--
-- The tool, the risk and the people never change (a deleted thread, run or
-- person only empties the link). What the action does — payload and summary —
-- may be edited only while it is pending: what was approved is what runs.
create or replace function jarvis_actions_rules() returns trigger
  language plpgsql set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if not (new.status = 'pending' or (new.risk = 'internal' and new.status in ('executed', 'failed'))) then
      raise exception 'stratos:jarvis_action_start' using errcode = 'P0001';
    end if;
    new.summary := btrim(new.summary);
    new.created_at := now();
    new.decided_at := null;
    new.decided_by := null;
    new.executed_at := case when new.status in ('executed', 'failed') then now() end;
    return new;
  end if;

  if new.id is distinct from old.id or new.tool is distinct from old.tool or new.risk is distinct from old.risk
     or new.created_at is distinct from old.created_at
     or (new.thread_id is distinct from old.thread_id and new.thread_id is not null)
     or (new.run_id is distinct from old.run_id and new.run_id is not null)
     or (new.user_id is distinct from old.user_id and new.user_id is not null) then
    raise exception 'stratos:jarvis_action_fixed' using errcode = 'P0001';
  end if;
  if (new.payload, new.summary) is distinct from (old.payload, old.summary)
     and not (old.status = 'pending' and new.status in ('pending', 'approved')) then
    raise exception 'stratos:jarvis_action_decided' using errcode = 'P0001';
  end if;
  new.summary := btrim(new.summary);

  if new.status is distinct from old.status then
    if (old.status, new.status) not in (('pending', 'approved'), ('pending', 'rejected'), ('approved', 'executed'),
                                        ('approved', 'failed'), ('failed', 'approved'), ('executed', 'reverted')) then
      raise exception 'stratos:jarvis_action_transition' using errcode = 'P0001';
    end if;
    if new.status in ('approved', 'rejected') then
      new.decided_at := now();
      new.decided_by := coalesce(auth.uid(), old.decided_by);
      new.error := null;
    elsif new.status in ('executed', 'failed') then
      new.decided_at := old.decided_at;
      new.decided_by := old.decided_by;
      new.executed_at := now();
    else
      new.decided_at := old.decided_at;
      new.decided_by := old.decided_by;
      new.executed_at := old.executed_at;
    end if;
  else
    -- Stamps and outcomes move only with the status.
    new.decided_at := old.decided_at;
    new.decided_by := case when new.decided_by is null then null else old.decided_by end;
    new.executed_at := old.executed_at;
    new.result := old.result;
    new.error := old.error;
  end if;
  return new;
end;
$$;
drop trigger if exists jarvis_actions_rules on jarvis_actions;
create trigger jarvis_actions_rules before insert or update on jarvis_actions
  for each row execute function jarvis_actions_rules();

-- Every new action and every change of status, in the activity log, which
-- the API roles cannot write. Only the tool, the risk and the status: the
-- payload and the summary may name owner-only project data, and every admin
-- reads the log.
create or replace function jarvis_actions_log() returns trigger
  language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return null;
  end if;
  insert into activity_logs (user_id, action, entity_type, entity_id, metadata)
  values (coalesce(auth.uid(), new.user_id), 'jarvis.' || new.tool, 'jarvis_action', new.id,
          jsonb_build_object('status', new.status, 'risk', new.risk, 'background', new.run_id is not null));
  return null;
end;
$$;
drop trigger if exists jarvis_actions_log on jarvis_actions;
create trigger jarvis_actions_log after insert or update of status on jarvis_actions
  for each row execute function jarvis_actions_log();

alter table jarvis_actions enable row level security;
alter table jarvis_actions force row level security;
drop policy if exists jarvis_actions_read on jarvis_actions;
create policy jarvis_actions_read on jarvis_actions for select to authenticated
  using ((select is_owner()) or (user_id = (select auth.uid()) and (select is_admin())));
drop policy if exists jarvis_actions_own_insert on jarvis_actions;
create policy jarvis_actions_own_insert on jarvis_actions for insert to authenticated
  with check (user_id = (select auth.uid()) and (select is_admin())
              and (thread_id is null or exists (select 1 from jarvis_threads t
                                                where t.id = thread_id and t.user_id = (select auth.uid()))));
drop policy if exists jarvis_actions_decide on jarvis_actions;
create policy jarvis_actions_decide on jarvis_actions for update to authenticated
  using ((select is_owner()) or (user_id = (select auth.uid()) and (select is_admin())))
  with check ((select is_owner()) or (user_id = (select auth.uid()) and (select is_admin())));


-- ###########################################################################
-- E. MEMORY
-- ###########################################################################

create table if not exists jarvis_memory (
  id          uuid primary key default gen_random_uuid(),
  -- 'global', or one record: 'client:<uuid>', 'lead:<uuid>', ...
  scope       text not null default 'global'
              check (scope ~ '^(global|(lead|opportunity|client|project):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$'),
  fact        text not null check (length(btrim(fact)) between 1 and 1000),
  -- 'user': a person wrote it. 'jarvis': Jarvis proposed it; it counts only
  -- once the owner approves it.
  source      text not null default 'user' check (source in ('user', 'jarvis')),
  approved    boolean not null default false,
  created_by  uuid default auth.uid() references profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  archived_at timestamptz
);
create index if not exists jarvis_memory_scope_idx on jarvis_memory (scope) where archived_at is null;
create index if not exists jarvis_memory_created_by_idx on jarvis_memory (created_by) where created_by is not null;

create or replace function jarvis_memory_rules() returns trigger
  language plpgsql set search_path = public
as $$
begin
  new.fact := btrim(new.fact);
  if tg_op = 'UPDATE' then
    if new.source is distinct from old.source or new.created_at is distinct from old.created_at
       or (new.created_by is distinct from old.created_by and new.created_by is not null) then
      raise exception 'stratos:jarvis_memory_fixed' using errcode = 'P0001';
    end if;
  else
    new.created_at := now();
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists jarvis_memory_rules on jarvis_memory;
create trigger jarvis_memory_rules before insert or update on jarvis_memory
  for each row execute function jarvis_memory_rules();

alter table jarvis_memory enable row level security;
alter table jarvis_memory force row level security;
drop policy if exists jarvis_memory_read on jarvis_memory;
create policy jarvis_memory_read on jarvis_memory for select to authenticated
  using ((select is_owner())
         or ((select is_admin()) and archived_at is null and (approved or created_by = (select auth.uid()))));
drop policy if exists jarvis_memory_insert on jarvis_memory;
create policy jarvis_memory_insert on jarvis_memory for insert to authenticated
  with check (created_by = (select auth.uid())
              and ((select is_owner()) or ((select is_admin()) and source = 'jarvis' and not approved)));
drop policy if exists jarvis_memory_owner_update on jarvis_memory;
create policy jarvis_memory_owner_update on jarvis_memory for update to authenticated
  using ((select is_owner())) with check ((select is_owner()));
drop policy if exists jarvis_memory_owner_delete on jarvis_memory;
create policy jarvis_memory_owner_delete on jarvis_memory for delete to authenticated
  using ((select is_owner()));


-- ###########################################################################
-- F. SETTINGS
-- ###########################################################################

create table if not exists jarvis_settings (
  singleton             boolean primary key default true check (singleton),
  -- Tokens per Budapest day, every model and every person together. Over it,
  -- Jarvis answers with the small model and says so.
  daily_token_budget    integer not null default 2000000 check (daily_token_budget between 1000 and 1000000000),
  brief_enabled         boolean not null default true,
  brief_time            time not null default '07:45',
  -- [{kind, cron, enabled, params}]
  agent_jobs            jsonb not null default '[]'::jsonb
                        check (jsonb_typeof(agent_jobs) = 'array' and length(agent_jobs::text) <= 20000),
  voice_enabled         boolean not null default true,
  -- Requests per person per minute.
  rate_limit_per_minute smallint not null default 20 check (rate_limit_per_minute between 1 and 600),
  -- Days a conversation's messages are kept (GDPR), then deleted.
  retention_days        smallint not null default 180 check (retention_days between 7 and 3650),
  updated_at            timestamptz not null default now(),
  updated_by            uuid references profiles(id) on delete set null
);
insert into jarvis_settings (singleton) values (true) on conflict do nothing;
create index if not exists jarvis_settings_updated_by_idx on jarvis_settings (updated_by) where updated_by is not null;

create or replace function jarvis_settings_rules() returns trigger
  language plpgsql set search_path = public
as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$$;
drop trigger if exists jarvis_settings_rules on jarvis_settings;
create trigger jarvis_settings_rules before update on jarvis_settings
  for each row execute function jarvis_settings_rules();

alter table jarvis_settings enable row level security;
alter table jarvis_settings force row level security;
drop policy if exists jarvis_settings_admin_read on jarvis_settings;
create policy jarvis_settings_admin_read on jarvis_settings for select to authenticated
  using ((select is_admin()));
drop policy if exists jarvis_settings_owner_update on jarvis_settings;
create policy jarvis_settings_owner_update on jarvis_settings for update to authenticated
  using ((select is_owner())) with check ((select is_owner()));


-- ###########################################################################
-- G. USAGE
-- ###########################################################################

create table if not exists jarvis_usage (
  day                date not null,
  model              text not null check (length(model) between 1 and 64),
  input_tokens       bigint not null default 0,
  output_tokens      bigint not null default 0,
  cache_read_tokens  bigint not null default 0,
  cache_write_tokens bigint not null default 0,
  -- Model calls: assistant messages, plus runs.
  calls              integer not null default 0,
  primary key (day, model)
);

-- Counts the tokens of a new message, and the tokens a run adds as it goes,
-- into the Budapest day they were spent on. A new message also moves its
-- thread to the top of the list.
create or replace function jarvis_count_usage() returns trigger
  language plpgsql security definer set search_path = public
as $$
declare
  d_in bigint;
  d_out bigint;
  d_read bigint;
  d_write bigint;
  d_calls integer;
begin
  if tg_table_name = 'jarvis_messages' then
    update jarvis_threads set updated_at = now() where id = new.thread_id;
    d_in := coalesce(new.input_tokens, 0);
    d_out := coalesce(new.output_tokens, 0);
    d_read := coalesce(new.cache_read_tokens, 0);
    d_write := coalesce(new.cache_write_tokens, 0);
    d_calls := case when new.role = 'assistant' then 1 else 0 end;
  elsif tg_op = 'INSERT' then
    d_in := new.input_tokens;
    d_out := new.output_tokens;
    d_read := new.cache_read_tokens;
    d_write := new.cache_write_tokens;
    d_calls := 1;
  else
    d_in := new.input_tokens - old.input_tokens;
    d_out := new.output_tokens - old.output_tokens;
    d_read := new.cache_read_tokens - old.cache_read_tokens;
    d_write := new.cache_write_tokens - old.cache_write_tokens;
    d_calls := 0;
  end if;
  if d_in = 0 and d_out = 0 and d_read = 0 and d_write = 0 and d_calls = 0 then
    return null;
  end if;
  insert into jarvis_usage as u (day, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, calls)
  values ((now() at time zone 'Europe/Budapest')::date, coalesce(new.model, 'unknown'), d_in, d_out, d_read, d_write, d_calls)
  on conflict (day, model) do update set
    input_tokens = u.input_tokens + excluded.input_tokens,
    output_tokens = u.output_tokens + excluded.output_tokens,
    cache_read_tokens = u.cache_read_tokens + excluded.cache_read_tokens,
    cache_write_tokens = u.cache_write_tokens + excluded.cache_write_tokens,
    calls = u.calls + excluded.calls;
  return null;
end;
$$;
drop trigger if exists jarvis_messages_usage on jarvis_messages;
create trigger jarvis_messages_usage after insert on jarvis_messages
  for each row execute function jarvis_count_usage();
drop trigger if exists jarvis_runs_usage on jarvis_runs;
create trigger jarvis_runs_usage after insert or update of input_tokens, output_tokens, cache_read_tokens, cache_write_tokens
  on jarvis_runs for each row execute function jarvis_count_usage();

alter table jarvis_usage enable row level security;
alter table jarvis_usage force row level security;
drop policy if exists jarvis_usage_admin_read on jarvis_usage;
create policy jarvis_usage_admin_read on jarvis_usage for select to authenticated
  using ((select is_admin()));


-- ###########################################################################
-- ACCESS
-- ###########################################################################

do $$
declare
  t text := 'jarvis_threads, jarvis_messages, jarvis_runs, jarvis_actions, jarvis_memory, jarvis_settings, jarvis_usage';
  f text;
begin
  execute format('revoke all on table %s from public', t);
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute format('revoke all on table %s from anon', t);
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute format('revoke all on table %s from authenticated', t);
    execute format('grant select on table %s to authenticated', t);
    execute 'grant insert (title, context_entity_type, context_entity_id), update (title, archived_at), delete
               on jarvis_threads to authenticated';
    execute 'grant insert (thread_id, role, content, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens)
               on jarvis_messages to authenticated';
    execute 'grant insert (thread_id, run_id, tool, risk, payload, summary, status, result, error),
                   update (payload, summary, status, result, error)
               on jarvis_actions to authenticated';
    execute 'grant insert (scope, fact, source, approved), update (scope, fact, approved, archived_at), delete
               on jarvis_memory to authenticated';
    execute 'grant update (daily_token_budget, brief_enabled, brief_time, agent_jobs, voice_enabled,
                           rate_limit_per_minute, retention_days)
               on jarvis_settings to authenticated';
  end if;

  -- Trigger functions only: nobody calls them.
  foreach f in array array[
    'jarvis_threads_rules()', 'jarvis_messages_rules()', 'jarvis_actions_rules()', 'jarvis_actions_log()',
    'jarvis_memory_rules()', 'jarvis_settings_rules()', 'jarvis_count_usage()'
  ] loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', f);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on function %s from authenticated', f);
    end if;
  end loop;
end $$;

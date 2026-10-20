import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

/**
 * Jarvis — threads, messages, actions, memory, runs, settings, usage
 * (20261019000300_jarvis.sql) against a real Postgres (PGlite): who reaches
 * what, the one-way life of an action, the activity log, the token count.
 */

test.describe.configure({ mode: 'serial' });

const ROOT = process.cwd();
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations');
const JARVIS = '20261019000300_jarvis.sql';
const read = (f: string) => fs.readFileSync(path.join(MIGRATIONS, f), 'utf8');
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const U = { owner: id(1), admin: id(3), admin2: id(4), team: id(5), anna: id(6) } as const;
type Who = keyof typeof U | 'anon';

const STANDIN = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claims', true)::jsonb->>'sub', '')::uuid
  $$;
  grant usage on schema auth, public to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  alter default privileges in schema public grant all on tables    to anon, authenticated;
  alter default privileges in schema public grant all on functions to anon, authenticated;
  alter default privileges in schema public grant all on sequences to anon, authenticated;
  create schema storage;
  create table storage.buckets (
    id text primary key, name text not null, owner uuid, public boolean default false,
    file_size_limit bigint, allowed_mime_types text[],
    created_at timestamptz default now(), updated_at timestamptz default now());
  create table storage.objects (
    id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
    name text not null, owner uuid, metadata jsonb, created_at timestamptz default now(),
    unique (bucket_id, name));
  alter table storage.objects enable row level security;
  grant usage on schema storage to anon, authenticated;
  grant select, insert, update, delete on storage.objects to anon, authenticated;
  grant select on storage.buckets to anon, authenticated;
`;

async function as(db: PGlite, who: Who, sql: string, params: unknown[] = []) {
  const claims = JSON.stringify(who === 'anon' ? { role: 'anon' } : { sub: U[who], role: 'authenticated' });
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [claims]);
  await db.exec(`set role ${who === 'anon' ? 'anon' : 'authenticated'}`);
  try {
    const r = await db.query<Record<string, unknown>>(sql, params);
    return { rows: r.rows, affected: r.affectedRows ?? 0, error: null as null | string };
  } catch (e) {
    return { rows: [], affected: 0, error: (e as Error).message };
  } finally {
    await db.exec('reset role');
    // As the server key's requests carry: claims, but no person.
    await db.query(`select set_config('request.jwt.claims', '{}', false)`);
  }
}
const ok = async (db: PGlite, who: Who, sql: string, params: unknown[] = []) => {
  const r = await as(db, who, sql, params);
  if (r.error) throw new Error(`${who}: ${r.error}`);
  return r.rows;
};
/** The server key: no JWT, no RLS (the background jobs). */
const server = async (db: PGlite, sql: string, params: unknown[] = []) => (await db.query<Record<string, unknown>>(sql, params)).rows;

let db: PGlite;
let ownerThread = '';
let adminThread = '';

test.beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(STANDIN);
  const files = fs.readdirSync(MIGRATIONS).filter((f) => /^\d+_[a-z_]+\.sql$/.test(f)).sort();
  expect(files).toContain(JARVIS);
  for (const file of files.filter((f) => f <= '20260928000200_owner_tracker.sql')) await db.exec(read(file));
  await db.exec(`
    insert into auth.users (id, email) values ('${U.owner}', 'owner@example.invalid'), ('${U.admin}', 'admin@example.invalid'),
      ('${U.admin2}', 'admin2@example.invalid'), ('${U.team}', 'team@example.invalid'), ('${U.anna}', 'anna@a.example');
    update profiles set role = 'super_admin' where id = '${U.owner}';
    update profiles set role = 'admin' where id in ('${U.admin}', '${U.admin2}');
    update profiles set role = 'team_member' where id = '${U.team}';
  `);
  await db.query(`select portal_set_owner('owner@example.invalid')`);
  for (const file of files.filter((f) => f > '20260928000200_owner_tracker.sql')) await db.exec(read(file));
});

test('a thread is its own person\'s alone, and only for admins', async () => {
  [{ id: ownerThread }] = (await ok(db, 'owner', `insert into jarvis_threads (title) values ('  Pipeline  ') returning id, title`)) as { id: string }[];
  const [t] = await ok(db, 'admin', `insert into jarvis_threads (title, context_entity_type, context_entity_id) values ('Lead', 'lead', $1) returning *`, [id(401)]);
  adminThread = t.id as string;
  expect(t.user_id).toBe(U.admin);

  expect((await ok(db, 'owner', `select title from jarvis_threads`)).map((r) => r.title)).toEqual(['Pipeline']);
  expect((await ok(db, 'admin', `select id from jarvis_threads`)).map((r) => r.id)).toEqual([adminThread]);
  expect(await ok(db, 'admin2', `select id from jarvis_threads`)).toEqual([]);
  for (const who of ['team', 'anna', 'anon'] as const) {
    expect((await as(db, who, `select * from jarvis_threads`)).rows, who).toEqual([]);
    expect((await as(db, who, `insert into jarvis_threads (title) values ('x')`)).error, who).not.toBeNull();
  }

  // Nobody starts a thread in someone else's name, or moves one to another record.
  expect((await as(db, 'admin', `insert into jarvis_threads (user_id, title) values ($1, 'x')`, [U.owner])).error).toContain('permission');
  expect((await as(db, 'admin', `insert into jarvis_threads (context_entity_type) values ('lead')`)).error).toContain('check');
  expect((await as(db, 'admin', `insert into jarvis_threads (context_entity_type, context_entity_id) values ('organization', $1)`, [id(9)])).error).toContain('check');
  expect((await as(db, 'admin', `update jarvis_threads set context_entity_type = null`)).error).toContain('permission');
  // Another admin's thread is invisible, so not changeable either.
  expect((await as(db, 'admin2', `update jarvis_threads set title = 'mine' where id = $1`, [adminThread])).affected).toBe(0);
  expect((await ok(db, 'admin', `update jarvis_threads set title = 'Kiss Péter' returning title`))[0].title).toBe('Kiss Péter');
});

test('messages: append-only, in one\'s own thread; the tokens are counted per Budapest day and model', async () => {
  const [before] = await server(db, `select updated_at from jarvis_threads where id = $1`, [adminThread]);
  await ok(db, 'admin', `insert into jarvis_messages (thread_id, role, content) values ($1, 'user', '[{"type":"text","text":"Mi a helyzet?"}]')`, [adminThread]);
  await ok(db, 'admin', `insert into jarvis_messages (thread_id, role, content, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens)
                         values ($1, 'assistant', '[{"type":"text","text":"Három nyitott deal."}]', 'claude-sonnet-5-5', 1200, 80, 3000, 500)`, [adminThread]);
  await ok(db, 'owner', `insert into jarvis_messages (thread_id, role, content, model, input_tokens, output_tokens)
                         values ($1, 'assistant', '[]', 'claude-sonnet-5-5', 100, 20)`, [ownerThread]);

  const [after] = await server(db, `select updated_at from jarvis_threads where id = $1`, [adminThread]);
  expect(new Date(after.updated_at as string).getTime()).toBeGreaterThanOrEqual(new Date(before.updated_at as string).getTime());

  expect((await ok(db, 'admin', `select role from jarvis_messages order by created_at`)).map((r) => r.role)).toEqual(['user', 'assistant']);
  expect(await ok(db, 'admin2', `select * from jarvis_messages`)).toEqual([]);
  expect((await as(db, 'admin2', `insert into jarvis_messages (thread_id, role, content) values ($1, 'user', '[]')`, [adminThread])).error).not.toBeNull();
  expect((await as(db, 'admin', `update jarvis_messages set content = '[]'`)).error).toContain('permission');
  expect((await as(db, 'admin', `delete from jarvis_messages`)).error).toContain('permission');
  expect((await as(db, 'admin', `insert into jarvis_messages (thread_id, role, content) values ($1, 'system', '[]')`, [adminThread])).error).toContain('check');
  expect((await as(db, 'admin', `insert into jarvis_messages (thread_id, role, content) values ($1, 'user', '{}')`, [adminThread])).error).toContain('check');

  // The budget is one read for any admin, and covers everyone's tokens.
  const usage = await ok(db, 'admin2', `select model, input_tokens::int, output_tokens::int, cache_read_tokens::int, cache_write_tokens::int, calls,
                                               day = (now() at time zone 'Europe/Budapest')::date as today from jarvis_usage`);
  expect(usage).toEqual([{ model: 'claude-sonnet-5-5', input_tokens: 1300, output_tokens: 100, cache_read_tokens: 3000,
                           cache_write_tokens: 500, calls: 2, today: true }]);
  for (const who of ['team', 'anna', 'anon'] as const) expect((await as(db, who, `select * from jarvis_usage`)).rows, who).toEqual([]);
  expect((await as(db, 'owner', `insert into jarvis_usage (day, model) values (current_date, 'x')`)).error).toContain('permission');
});

test('an external action waits for approval; what was approved is what runs', async () => {
  const insert = (who: Who, status: string, risk = 'external') => as(db, who,
    `insert into jarvis_actions (thread_id, tool, risk, payload, summary, status) values ($1, 'gmail_create_draft', $2, '{"to":"peter@example.invalid"}', ' Piszkozat Kiss Péternek ', $3) returning *`,
    [adminThread, risk, status]);
  expect((await insert('admin', 'executed')).error).toContain('jarvis_action_start');
  expect((await insert('admin', 'approved')).error).toContain('jarvis_action_start');
  expect((await insert('admin2', 'pending')).error).not.toBeNull(); // not admin2's thread
  const { rows: [a] } = await insert('admin', 'pending');
  expect(a).toMatchObject({ user_id: U.admin, status: 'pending', summary: 'Piszkozat Kiss Péternek', decided_at: null, executed_at: null });

  // Pending: may be edited. Not run before a decision.
  await ok(db, 'admin', `update jarvis_actions set payload = '{"to":"peter@example.invalid","subject":"Ajánlat"}' where id = $1`, [a.id]);
  expect((await as(db, 'admin', `update jarvis_actions set status = 'executed' where id = $1`, [a.id])).error).toContain('jarvis_action_transition');
  // Another admin neither sees nor decides it.
  expect((await as(db, 'admin2', `update jarvis_actions set status = 'approved' where id = $1`, [a.id])).affected).toBe(0);

  const [approved] = await ok(db, 'admin', `update jarvis_actions set status = 'approved' where id = $1 returning *`, [a.id]);
  expect(approved.decided_by).toBe(U.admin);
  expect(approved.decided_at).not.toBeNull();
  expect((await as(db, 'admin', `update jarvis_actions set payload = '{"to":"x@example.invalid"}' where id = $1`, [a.id])).error).toContain('jarvis_action_decided');
  expect((await as(db, 'admin', `update jarvis_actions set decided_at = null where id = $1`, [a.id])).error).toContain('permission');

  const [done] = await ok(db, 'admin', `update jarvis_actions set status = 'executed', result = '{"draft_id":"r-1"}' where id = $1 returning *`, [a.id]);
  expect(done.executed_at).not.toBeNull();
  expect(done.result).toEqual({ draft_id: 'r-1' });
  // Stamps and outcomes move only with the status.
  const [same] = await ok(db, 'admin', `update jarvis_actions set result = '{"draft_id":"forged"}', error = 'x' where id = $1 returning result, error`, [a.id]);
  expect(same).toEqual({ result: { draft_id: 'r-1' }, error: null });
  expect((await as(db, 'admin', `update jarvis_actions set status = 'pending' where id = $1`, [a.id])).error).toContain('jarvis_action_transition');
  expect((await as(db, 'admin', `update jarvis_actions set tool = 'add_note' where id = $1`, [a.id])).error).toContain('permission');
  expect((await as(db, 'admin', `delete from jarvis_actions where id = $1`, [a.id])).error).toContain('permission');
});

test('an internal write is logged as done; it can be undone; the owner sees every action, an admin only their own', async () => {
  const [n] = await ok(db, 'owner', `insert into jarvis_actions (thread_id, tool, risk, payload, summary, status, result)
                                     values ($1, 'add_note', 'internal', '{"body":"Visszahívni"}', 'Jegyzet a leadhez', 'executed', '{"id":"n-1"}') returning *`, [ownerThread]);
  expect(n.executed_at).not.toBeNull();
  expect(n.decided_by).toBeNull();
  await ok(db, 'owner', `update jarvis_actions set status = 'reverted' where id = $1`, [n.id]);
  const failed = await ok(db, 'owner', `insert into jarvis_actions (tool, risk, payload, summary, status, error)
                                        values ('log_time', 'internal', '{}', 'Munkaidő', 'failed', 'project not found') returning status, error`);
  expect(failed).toEqual([{ status: 'failed', error: 'project not found' }]);
  // A failed action may be tried again: back to approved, then run.
  await ok(db, 'owner', `update jarvis_actions set status = 'approved' where tool = 'log_time'`);

  expect((await ok(db, 'owner', `select tool from jarvis_actions order by created_at`)).map((r) => r.tool)).toEqual(['gmail_create_draft', 'add_note', 'log_time']);
  expect((await ok(db, 'admin', `select tool from jarvis_actions`)).map((r) => r.tool)).toEqual(['gmail_create_draft']);
  expect(await ok(db, 'admin2', `select * from jarvis_actions`)).toEqual([]);
  for (const who of ['team', 'anna', 'anon'] as const) expect((await as(db, who, `select * from jarvis_actions`)).rows, who).toEqual([]);
  expect((await as(db, 'team', `insert into jarvis_actions (tool, risk, payload, summary) values ('add_note', 'internal', '{}', 'x')`)).error).not.toBeNull();
});

test('the activity log has every new action and every change of status — but not what it said', async () => {
  const log = await ok(db, 'owner', `select user_id, action, entity_type, metadata from activity_logs where action like 'jarvis.%' order by created_at`);
  expect(log.map((r) => `${r.action} ${(r.metadata as { status: string }).status}`)).toEqual([
    'jarvis.gmail_create_draft pending', 'jarvis.gmail_create_draft approved', 'jarvis.gmail_create_draft executed',
    'jarvis.add_note executed', 'jarvis.add_note reverted', 'jarvis.log_time failed', 'jarvis.log_time approved',
  ]);
  for (const r of log) {
    expect(r.entity_type).toBe('jarvis_action');
    expect(Object.keys(r.metadata as object).sort()).toEqual(['background', 'risk', 'status']);
  }
  expect(log.filter((r) => r.action === 'jarvis.gmail_create_draft').every((r) => r.user_id === U.admin)).toBe(true);
  // The API roles still cannot write the log themselves.
  expect((await as(db, 'owner', `insert into activity_logs (action) values ('jarvis.forged')`)).error).not.toBeNull();
});

test('memory: the owner keeps it; an admin reads what is approved and may only propose', async () => {
  await ok(db, 'owner', `insert into jarvis_memory (fact, approved) values ('  Az ajánlatok nettó árral mennek.  ', true)`);
  await ok(db, 'owner', `insert into jarvis_memory (scope, fact) values ($1, 'Csak délelőtt hívható.')`, [`client:${id(101)}`]);
  expect((await as(db, 'owner', `insert into jarvis_memory (scope, fact) values ('organization:x', 'x')`)).error).toContain('check');

  expect((await ok(db, 'admin', `select fact from jarvis_memory`)).map((r) => r.fact)).toEqual(['Az ajánlatok nettó árral mennek.']);
  const [p] = await ok(db, 'admin', `insert into jarvis_memory (fact, source) values ('Kiss Péter a döntéshozó.', 'jarvis') returning id, created_by, approved`);
  expect(p).toMatchObject({ created_by: U.admin, approved: false });
  // Its proposer sees it waiting; another admin does not, until it is approved.
  expect((await ok(db, 'admin', `select count(*)::int as n from jarvis_memory`))[0].n).toBe(2);
  expect((await ok(db, 'admin2', `select fact from jarvis_memory`)).map((r) => r.fact)).toEqual(['Az ajánlatok nettó árral mennek.']);
  expect((await as(db, 'admin', `insert into jarvis_memory (fact, source, approved) values ('x', 'jarvis', true)`)).error).not.toBeNull();
  expect((await as(db, 'admin', `insert into jarvis_memory (fact) values ('x')`)).error).not.toBeNull();
  expect((await as(db, 'admin', `update jarvis_memory set approved = true where id = $1`, [p.id])).affected).toBe(0);
  expect((await as(db, 'admin', `delete from jarvis_memory`)).affected).toBe(0);
  for (const who of ['team', 'anna', 'anon'] as const) {
    expect((await as(db, who, `select * from jarvis_memory`)).rows, who).toEqual([]);
    expect((await as(db, who, `insert into jarvis_memory (fact, source) values ('x', 'jarvis')`)).error, who).not.toBeNull();
  }

  await ok(db, 'owner', `update jarvis_memory set approved = true where id = $1`, [p.id]);
  expect((await ok(db, 'admin2', `select count(*)::int as n from jarvis_memory`))[0].n).toBe(2);
  expect((await as(db, 'owner', `update jarvis_memory set source = 'user' where id = $1`, [p.id])).error).toContain('permission');
  await ok(db, 'owner', `update jarvis_memory set archived_at = now() where id = $1`, [p.id]);
  expect((await ok(db, 'admin', `select count(*)::int as n from jarvis_memory`))[0].n).toBe(1);
});

test('settings: every admin reads them, only the owner changes them', async () => {
  const [s] = await ok(db, 'admin', `select daily_token_budget, brief_enabled, brief_time, agent_jobs, voice_enabled, rate_limit_per_minute, retention_days from jarvis_settings`);
  expect(s).toEqual({ daily_token_budget: 2000000, brief_enabled: true, brief_time: '07:45:00', agent_jobs: [], voice_enabled: true,
                      rate_limit_per_minute: 20, retention_days: 180 });
  expect((await as(db, 'admin', `update jarvis_settings set daily_token_budget = 5000000`)).affected).toBe(0);
  const [o] = await ok(db, 'owner', `update jarvis_settings set daily_token_budget = 3000000, brief_time = '08:00' returning updated_by`);
  expect(o.updated_by).toBe(U.owner);
  expect((await as(db, 'owner', `update jarvis_settings set retention_days = 1`)).error).toContain('check');
  expect((await as(db, 'owner', `update jarvis_settings set agent_jobs = '{}'`)).error).toContain('check');
  expect((await as(db, 'owner', `insert into jarvis_settings (singleton) values (true)`)).error).toContain('permission');
  expect((await as(db, 'owner', `update jarvis_settings set updated_by = null`)).error).toContain('permission');
  for (const who of ['team', 'anna', 'anon'] as const) expect((await as(db, who, `select * from jarvis_settings`)).rows, who).toEqual([]);
});

test('runs: written by the server; the owner reads them all, an admin those started for them; their tokens count', async () => {
  const [brief] = await server(db, `insert into jarvis_runs (kind, model) values ('brief', 'claude-haiku-5-5') returning id`);
  const [job] = await server(db, `insert into jarvis_runs (kind, user_id, thread_id, model) values ('generate_offer', $1, $2, 'claude-opus-5-5') returning id`, [U.admin, adminThread]);
  await server(db, `update jarvis_runs set input_tokens = 4000, output_tokens = 900 where id = $1`, [brief.id]);
  await server(db, `update jarvis_runs set input_tokens = 4500, output_tokens = 1000, status = 'done', finished_at = now() where id = $1`, [brief.id]);
  await server(db, `update jarvis_runs set output_tokens = 7000 where id = $1`, [job.id]);
  await server(db, `insert into jarvis_actions (run_id, user_id, tool, risk, payload, summary) values ($1, null, 'gmail_create_draft', 'external', '{}', 'Follow-up')`, [brief.id]);

  expect((await ok(db, 'owner', `select kind from jarvis_runs order by kind`)).map((r) => r.kind)).toEqual(['brief', 'generate_offer']);
  expect((await ok(db, 'admin', `select kind from jarvis_runs`)).map((r) => r.kind)).toEqual(['generate_offer']);
  expect(await ok(db, 'admin2', `select * from jarvis_runs`)).toEqual([]);
  expect((await as(db, 'owner', `insert into jarvis_runs (kind) values ('brief')`)).error).toContain('permission');
  expect((await as(db, 'owner', `update jarvis_runs set status = 'failed'`)).error).toContain('permission');

  const usage = await ok(db, 'owner', `select model, input_tokens::int, output_tokens::int, calls from jarvis_usage order by model`);
  expect(usage).toEqual([
    { model: 'claude-haiku-5-5', input_tokens: 4500, output_tokens: 1000, calls: 1 },
    { model: 'claude-opus-5-5', input_tokens: 0, output_tokens: 7000, calls: 1 },
    { model: 'claude-sonnet-5-5', input_tokens: 1300, output_tokens: 100, calls: 2 },
  ]);
  // A background action without a person: the owner approves it.
  const [bg] = await ok(db, 'owner', `update jarvis_actions set status = 'approved' where run_id = $1 returning decided_by`, [brief.id]);
  expect(bg.decided_by).toBe(U.owner);
  expect(await ok(db, 'admin', `select * from jarvis_actions where run_id is not null`)).toEqual([]);
});

test('the life the write tools give an action (phase 5): pending with its reason → approved as edited → executed with its undo → reverted', async () => {
  const [a] = await ok(db, 'admin', `insert into jarvis_actions (thread_id, tool, risk, payload, summary, status, result)
    values ($1, 'add_note', 'internal', '{"entity_type":"lead","body":"Eredeti"}', 'Jegyzet · lead: „Eredeti”', 'pending', '{"reason":"outside_text"}') returning *`, [adminThread]);
  expect(a.result).toEqual({ reason: 'outside_text' });
  const [approved] = await ok(db, 'admin', `update jarvis_actions set status = 'approved', payload = '{"entity_type":"lead","body":"Javított"}',
    summary = 'Jegyzet · lead: „Javított”' where id = $1 returning *`, [a.id]);
  expect(approved).toMatchObject({ status: 'approved', summary: 'Jegyzet · lead: „Javított”', decided_by: U.admin });
  const [done] = await ok(db, 'admin', `update jarvis_actions set status = 'executed', result = '{"reason":"outside_text","data":{"note_id":"n"},"undo":{"table":"lead_notes","id":"n"}}'
    where id = $1 returning result, executed_at`, [a.id]);
  expect(done.executed_at).not.toBeNull();
  const [undone] = await ok(db, 'admin', `update jarvis_actions set status = 'reverted', result = result || '{"reverted_at":"2026-10-20T10:00:00Z"}'
    where id = $1 returning status, result`, [a.id]);
  expect(undone).toMatchObject({ status: 'reverted', result: { undo: { table: 'lead_notes' }, reverted_at: '2026-10-20T10:00:00Z' } });
  // Approving a failed write again (retry) keeps what was approved.
  const [f] = await ok(db, 'admin', `insert into jarvis_actions (thread_id, tool, risk, payload, summary, status, error)
    values ($1, 'log_time', 'internal', '{"hours":1}', 'Munkaidő', 'failed', 'day limit') returning id`, [adminThread]);
  expect((await as(db, 'admin', `update jarvis_actions set status = 'approved', payload = '{"hours":2}' where id = $1`, [f.id])).error).toContain('jarvis_action_decided');
  await ok(db, 'admin', `update jarvis_actions set status = 'approved' where id = $1`, [f.id]);
});

test('re-running the migration changes nothing; a person who leaves takes their threads, their actions stay', async () => {
  await db.exec(read(JARVIS));
  expect((await ok(db, 'owner', `select daily_token_budget from jarvis_settings`))[0].daily_token_budget).toBe(3000000);
  expect((await ok(db, 'owner', `select count(*)::int as n from jarvis_actions`))[0].n).toBe(6);

  await db.exec(`delete from auth.users where id = '${U.admin}'`);
  expect((await server(db, `select count(*)::int as n from jarvis_threads where id = $1`, [adminThread]))[0].n).toBe(0);
  expect((await server(db, `select count(*)::int as n from jarvis_messages where thread_id = $1`, [adminThread]))[0].n).toBe(0);
  const left = await server(db, `select user_id, thread_id, decided_by, status from jarvis_actions where tool = 'gmail_create_draft' and run_id is null`);
  expect(left).toEqual([{ user_id: null, thread_id: null, decided_by: null, status: 'executed' }]);
  // The run started for them stays, unlinked, for the owner.
  expect((await ok(db, 'owner', `select user_id, thread_id from jarvis_runs where kind = 'generate_offer'`))).toEqual([{ user_id: null, thread_id: null }]);
});

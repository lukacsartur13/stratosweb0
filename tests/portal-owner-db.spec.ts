import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

/**
 * The owner tracker, against a real Postgres.
 *
 * ## What runs, and what it is not
 *
 * PGlite is PostgreSQL compiled to WebAssembly — the real planner, the real RLS,
 * the real trigger and constraint machinery — so every migration in
 * `supabase/migrations/` is applied here verbatim, in order, and every policy is
 * exercised the way PostgREST exercises it: `set role authenticated` plus a
 * `request.jwt.claims` setting that `auth.uid()` reads.
 *
 * It is NOT Supabase. The `auth` schema is a three-line stand-in, the API roles
 * are created here with Supabase's default grants, and the migrations run as a
 * superuser. PostgREST, GoTrue and the hosted Postgres version are not in the
 * loop. What this proves is that the SQL does what it says; that the hosted
 * project has the same objects is what supabase/checks/owner-tracker-preflight.sql
 * and owner-tracker-verify.sql are for.
 */

const ROOT = process.cwd();
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations');
const CHECKS = path.join(ROOT, 'supabase', 'checks');

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const U = {
  owner: id(1), super2: id(2), admin: id(3), team: id(4), clientA: id(5), clientB: id(6),
} as const;
const ORG = { a: id(101), b: id(102) };
const PROJECT = { a1: id(201), b1: id(202), empty: id(203) };
const DEAL = id(301);

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
  -- Supabase's defaults: every new public object is granted to the API roles,
  -- which is why the migrations have to REVOKE what they do not mean to expose.
  alter default privileges in schema public grant all on tables    to anon, authenticated;
  alter default privileges in schema public grant all on functions to anon, authenticated;
  alter default privileges in schema public grant all on sequences to anon, authenticated;
`;

const migrationFiles = () => fs.readdirSync(MIGRATIONS)
  .filter((f) => /^\d+_[a-z_]+\.sql$/.test(f))
  .sort();

async function migrate(db: PGlite, until?: string) {
  for (const file of migrationFiles()) {
    if (until && file > until) break;
    await db.exec(fs.readFileSync(path.join(MIGRATIONS, file), 'utf8'));
  }
}

async function seed(db: PGlite) {
  // `project_links.url`'s check as shipped in 20260816000100 (`[^\s]{3,500}`)
  // cannot compile — Postgres caps a repetition count at 255 — so every link
  // insert fails. This harness stops at the owner-tracker step, before the fix,
  // so it applies the fix itself: 20260929000100_project_links_url_check.sql,
  // verbatim (it is independent and idempotent). The defect and the fix are
  // exercised in tests/portal-impact-db.spec.ts → "project_links.url".
  await db.exec(fs.readFileSync(path.join(MIGRATIONS, '20260929000100_project_links_url_check.sql'), 'utf8'));
  await db.exec(`
    insert into auth.users (id, email) values
      ('${U.owner}', 'owner@example.invalid'), ('${U.super2}', 'super2@example.invalid'),
      ('${U.admin}', 'admin@example.invalid'), ('${U.team}', 'team@example.invalid'),
      ('${U.clientA}', 'a@example.invalid'), ('${U.clientB}', 'b@example.invalid');
    insert into organizations (id, name, slug, status) values
      ('${ORG.a}', 'Client A Kft.', 'client-a', 'active'),
      ('${ORG.b}', 'Client B Kft.', 'client-b', 'active');
    update profiles set role = 'super_admin' where id in ('${U.owner}', '${U.super2}');
    update profiles set role = 'admin'       where id = '${U.admin}';
    update profiles set role = 'team_member' where id = '${U.team}';
    update profiles set organization_id = '${ORG.a}' where id = '${U.clientA}';
    update profiles set organization_id = '${ORG.b}' where id = '${U.clientB}';

    insert into projects (id, organization_id, name, slug, status, value, currency, paid_amount) values
      ('${PROJECT.a1}', '${ORG.a}', 'A website', 'a-website', 'active', 1500000, 'HUF', 500000),
      ('${PROJECT.b1}', '${ORG.b}', 'B ads', 'b-ads', 'active', 400000, 'HUF', null),
      ('${PROJECT.empty}', '${ORG.b}', 'B no checkpoints', 'b-empty', 'planned', null, 'HUF', null);
    insert into project_milestones (project_id, title, position, state) values
      ('${PROJECT.a1}', 'Design', 0, 'done'),
      ('${PROJECT.a1}', 'Build', 1, 'in_progress'),
      ('${PROJECT.b1}', 'Audit', 0, 'pending');
    insert into project_members (project_id, user_id) values
      ('${PROJECT.a1}', '${U.clientA}'), ('${PROJECT.a1}', '${U.team}');
    insert into project_costs (project_id, description, amount) values ('${PROJECT.a1}', 'Fonts', 30000);
    insert into project_links (project_id, label, url) values ('${PROJECT.a1}', 'Staging', 'https://staging.example.invalid');

    insert into opportunities (id, title, organization_id, stage, estimated_value)
      values ('${DEAL}', 'A website deal', '${ORG.a}', 'proposal', 1500000);
    insert into record_notes (entity_type, entity_id, author_id, body) values
      ('project', '${PROJECT.a1}', '${U.owner}', 'Internal project note'),
      ('opportunity', '${DEAL}', '${U.admin}', 'Deal note');
    insert into leads (name, email, form_type, source) values ('Lead', 'lead@example.invalid', 'contact', 'contact');
  `);
}

async function fresh({ owner = true, lockdown = true } = {}) {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(STANDIN);
  await migrate(db, '20260928000200_owner_tracker.sql');
  await seed(db);
  if (owner) await db.query(`select portal_set_owner('owner@example.invalid')`);
  if (lockdown) {
    await db.exec(fs.readFileSync(path.join(MIGRATIONS, '20260928000300_owner_lockdown.sql'), 'utf8'));
  }
  return db;
}

/** Run one statement the way PostgREST would for `who`, and report rows or the error. */
async function as(db: PGlite, who: Who, sql: string, params: unknown[] = []) {
  const role = who === 'anon' ? 'anon' : 'authenticated';
  const claims = who === 'anon' ? '{}' : JSON.stringify({ sub: U[who] });
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [claims]);
  await db.exec(`set role ${role}`);
  try {
    const result = await db.query<Record<string, unknown>>(sql, params);
    return { rows: result.rows, affected: result.affectedRows ?? 0, error: null as null | { code?: string; message: string } };
  } catch (error) {
    const e = error as { code?: string; message: string };
    return { rows: [], affected: 0, error: { code: e.code, message: e.message } };
  } finally {
    await db.exec('reset role');
  }
}

const count = async (db: PGlite, who: Who, table: string, where = 'true') => {
  const r = await as(db, who, `select count(*)::int as n from ${table} where ${where}`);
  return r.error ? `error ${r.error.code}` : (r.rows[0].n as number);
};

/* ======================================================= designation == */

test.describe('owner designation', () => {
  test('step 3 refuses to run until an owner is designated', async () => {
    const db = await fresh({ owner: false, lockdown: false });
    await expect(db.exec(fs.readFileSync(
      path.join(MIGRATIONS, '20260928000300_owner_lockdown.sql'), 'utf8')))
      .rejects.toThrow(/No portal owner is designated/);
    // …and nothing was half-applied: an admin still reads projects the old way.
    expect(await count(db, 'admin', 'projects')).toBe(3);
  });

  test('step 3 refuses an owner who is no longer a super_admin', async () => {
    const db = await fresh({ owner: true, lockdown: false });
    await db.exec(`update profiles set role = 'admin' where id = '${U.owner}'`);
    await expect(db.exec(fs.readFileSync(
      path.join(MIGRATIONS, '20260928000300_owner_lockdown.sql'), 'utf8')))
      .rejects.toThrow(/not super_admin/);
  });

  test('only a unique, existing super_admin can be designated', async () => {
    const db = await fresh({ owner: false, lockdown: false });
    await expect(db.query(`select portal_set_owner('nobody@example.invalid')`)).rejects.toThrow(/No profile/);
    await expect(db.query(`select portal_set_owner('admin@example.invalid')`)).rejects.toThrow(/must be a super_admin/);
    await db.query(`select portal_set_owner('  OWNER@example.invalid ')`);
    const rows = await db.query<{ user_id: string }>('select user_id from portal_owner');
    expect(rows.rows).toEqual([{ user_id: U.owner }]);
    // A second call REPLACES the owner — there is never a second row.
    await db.query(`select portal_set_owner('super2@example.invalid')`);
    expect((await db.query('select count(*)::int as n from portal_owner')).rows[0]).toEqual({ n: 1 });
  });

  test('no browser-facing role can designate, read or write the owner', async () => {
    const db = await fresh();
    for (const who of ['anon', 'owner', 'super2', 'admin', 'clientA'] as Who[]) {
      const call = await as(db, who, `select portal_set_owner('super2@example.invalid')`);
      expect(call.error?.code, `${who} must not execute portal_set_owner`).toBe('42501');
      const read = await as(db, who, 'select * from portal_owner');
      expect(read.error?.code, `${who} reading portal_owner`).toBe('42501');
      const write = await as(db, who, `insert into portal_owner (user_id) values ('${U[who === 'anon' ? 'super2' : who]}')`);
      expect(write.error?.code, `${who} writing portal_owner`).toBe('42501');
    }
    expect((await db.query<{ user_id: string }>('select user_id from portal_owner')).rows)
      .toEqual([{ user_id: U.owner }]);
  });

  test('is_owner() is true for the designated super_admin and nobody else', async () => {
    const db = await fresh();
    const answers: Record<string, unknown> = {};
    for (const who of ['owner', 'super2', 'admin', 'team', 'clientA', 'clientB', 'anon'] as Who[]) {
      answers[who] = (await as(db, who, 'select is_owner() as v')).rows[0]?.v;
    }
    expect(answers).toEqual({
      owner: true, super2: false, admin: false, team: false, clientA: false, clientB: false, anon: false,
    });

    // Demoted, the designation alone is not enough.
    await db.exec(`update profiles set role = 'admin' where id = '${U.owner}'`);
    expect((await as(db, 'owner', 'select is_owner() as v')).rows[0].v).toBe(false);
  });

  test('a user cannot promote themselves into ownership through their profile', async () => {
    const db = await fresh();
    const r = await as(db, 'super2', `update profiles set role = 'super_admin' where id = '${U.super2}'`);
    expect(r.error).toBeNull();
    expect((await as(db, 'super2', 'select is_owner() as v')).rows[0].v).toBe(false);
  });
});

/* ========================================================= every path == */

test.describe('after the lockdown, every project path answers only to the owner', () => {
  let db: PGlite;
  test.beforeAll(async () => { db = await fresh(); });

  const TABLES: [string, string, number][] = [
    ['projects', 'true', 3],
    ['project_milestones', 'true', 3],
    ['project_costs', 'true', 1],
    ['project_links', 'true', 1],
    ['record_notes', `entity_type = 'project'`, 1],
    ['activity_logs', `entity_type = 'project'`, -1],
  ];

  test('the owner reads everything', async () => {
    for (const [table, where, expected] of TABLES) {
      const n = await count(db, 'owner', table, where);
      if (expected < 0) expect(n, table).toBeGreaterThan(0);
      else expect(n, table).toBe(expected);
    }
    expect(await count(db, 'owner', 'project_members')).toBe(2);
  });

  for (const who of ['super2', 'admin', 'team', 'clientA', 'clientB', 'anon'] as Who[]) {
    test(`${who} reads no project data`, async () => {
      for (const [table, where] of TABLES) {
        const n = await count(db, who, table, where);
        // anon has no grant on the P2 tables at all — a refusal, not an empty
        // list — and either is "no data".
        expect([0, 'error 42501'], `${who} on ${table}`).toContain(n);
      }
      // Membership rows: a member still sees their OWN row (a project id,
      // nothing else), and nobody sees anybody else's.
      const members = await count(db, who, 'project_members');
      expect(members).toBe(who === 'clientA' || who === 'team' ? 1 : who === 'anon' ? 0 : 0);
    });

    test(`${who} cannot write project data`, async () => {
      const attempts = [
        `insert into projects (organization_id, name, slug) values ('${ORG.a}', 'x', 'x-${who}')`,
        `update projects set name = 'hijacked' where id = '${PROJECT.a1}'`,
        `delete from projects where id = '${PROJECT.b1}'`,
        `insert into project_milestones (project_id, title) values ('${PROJECT.a1}', 'x')`,
        `update project_milestones set title = 'x'`,
        `delete from project_milestones`,
        `insert into project_costs (project_id, description, amount) values ('${PROJECT.a1}', 'x', 1)`,
        `insert into project_links (project_id, label, url) values ('${PROJECT.a1}', 'x', 'https://x.invalid')`,
        `insert into project_members (project_id, user_id) values ('${PROJECT.b1}', '${U[who === 'anon' ? 'team' : who as keyof typeof U]}')`,
        `insert into checkpoint_templates (name, steps) values ('x', array['a'])`,
      ];
      for (const sql of attempts) {
        const r = await as(db, who, sql);
        // Either refused outright (with-check / grant) or silently matched no
        // row (using) — both are RLS doing its job. What must never happen is a
        // row changing.
        expect(r.error !== null || r.affected === 0, `${who}: ${sql}`).toBe(true);
      }
      const state = await db.query<{ name: string }>(`select name from projects where id = '${PROJECT.a1}'`);
      expect(state.rows[0].name).toBe('A website');
      expect((await db.query('select count(*)::int as n from projects')).rows[0]).toEqual({ n: 3 });
      expect((await db.query('select count(*)::int as n from project_milestones')).rows[0]).toEqual({ n: 3 });
    });
  }

  test('no role but the owner can write a project note', async () => {
    for (const who of ['super2', 'admin'] as Who[]) {
      const r = await as(db, who, `insert into record_notes (entity_type, entity_id, author_id, body)
        values ('project', '${PROJECT.a1}', '${U[who as keyof typeof U]}', 'x')`);
      expect(r.error?.code, who).toBe('42501');
    }
    const ok = await as(db, 'owner', `insert into record_notes (entity_type, entity_id, author_id, body)
      values ('project', '${PROJECT.a1}', '${U.owner}', 'owner note') returning id`);
    expect(ok.error).toBeNull();
  });

  test('the sales summary counts projects only for the owner', async () => {
    const buckets = async (who: Who) => (await as(db, who,
      `select bucket, items::int from portal_sales_summary() where bucket like 'projects_%' order by 1`)).rows;
    expect(await buckets('owner')).toEqual([{ bucket: 'projects_active', items: 3 }]);
    expect(await buckets('admin')).toEqual([]);
    expect(await buckets('super2')).toEqual([]);
  });

  test('Leads and Sales keep exactly the access they had', async () => {
    expect(await count(db, 'admin', 'leads')).toBe(1);
    expect(await count(db, 'team', 'leads')).toBe(1);
    expect(await count(db, 'admin', 'opportunities')).toBe(1);
    expect(await count(db, 'super2', 'opportunities')).toBe(1);
    expect(await count(db, 'admin', 'record_notes', `entity_type = 'opportunity'`)).toBe(1);
    expect(await count(db, 'team', 'record_notes', `entity_type = 'opportunity'`)).toBe(1);
    expect(await count(db, 'admin', 'activity_logs', `entity_type = 'opportunity'`)).toBeGreaterThan(0);
    expect(await count(db, 'admin', 'organizations')).toBe(2);
    expect(await count(db, 'clientA', 'leads')).toBe(0);
    expect(await count(db, 'clientA', 'opportunities')).toBe(0);
    expect(await count(db, 'anon', 'opportunities')).toBe('error 42501');

    const upd = await as(db, 'admin', `update opportunities set stage = 'won' where id = '${DEAL}'`);
    expect(upd.error).toBeNull();
    expect(upd.affected).toBe(1);
    const note = await as(db, 'admin', `insert into record_notes (entity_type, entity_id, author_id, body)
      values ('opportunity', '${DEAL}', '${U.admin}', 'still allowed')`);
    expect(note.error).toBeNull();
  });

  test('two clients cannot see each other, or their own project, directly', async () => {
    expect(await count(db, 'clientA', 'projects', `organization_id = '${ORG.a}'`)).toBe(0);
    expect(await count(db, 'clientB', 'projects', `organization_id = '${ORG.b}'`)).toBe(0);
    expect(await count(db, 'clientA', 'projects', `organization_id = '${ORG.b}'`)).toBe(0);
    expect(await count(db, 'clientA', 'organizations')).toBe(1);
    expect(await count(db, 'clientB', 'organizations', `id = '${ORG.a}'`)).toBe(0);
  });

  test('checkpoint templates are the owner\'s alone', async () => {
    expect(await count(db, 'owner', 'checkpoint_templates')).toBe(4);
    for (const who of ['super2', 'admin', 'team', 'clientA'] as Who[]) {
      expect(await count(db, who, 'checkpoint_templates'), who).toBe(0);
    }
    expect(await count(db, 'anon', 'checkpoint_templates')).toBe('error 42501');
  });

  test('no function the API can call reads projects on a definer\'s authority', async () => {
    const rows = await db.query<{ proname: string }>(`
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef
        and p.prosrc ~* '\\m(projects|project_milestones|project_costs|project_links)\\M'
        and p.prorettype <> 'trigger'::regtype
      order by 1`);
    // Only trigger functions may: they run on a write the caller was already
    // allowed to make, and cannot be called through /rest/v1/rpc.
    expect(rows.rows).toEqual([]);
    const views = await db.query(`select table_name from information_schema.views where table_schema = 'public'`);
    expect(views.rows).toEqual([]);
  });
});

/* ======================================================== checkpoints == */

test.describe('checkpoints', () => {
  let db: PGlite;
  test.beforeAll(async () => { db = await fresh(); });

  test('blocked needs a reason AND a next step, in the database', async () => {
    const ins = (reason: string | null, next: string | null) => as(db, 'owner',
      `insert into project_milestones (project_id, title, state, blocked_reason, next_step)
       values ($1, 'Content', 'blocked', $2, $3)`, [PROJECT.b1, reason, next]);

    expect((await ins(null, null)).error?.code).toBe('23514');
    expect((await ins('Waiting for copy', null)).error?.code).toBe('23514');
    expect((await ins(null, 'Chase the client')).error?.code).toBe('23514');
    expect((await ins('   ', 'Chase the client')).error?.code).toBe('23514');
    expect((await ins('Waiting for copy', 'Chase the client')).error).toBeNull();

    // And on UPDATE: moving an existing step to blocked without them fails too.
    const upd = await as(db, 'owner',
      `update project_milestones set state = 'blocked' where project_id = $1 and title = 'Audit'`, [PROJECT.b1]);
    expect(upd.error?.code).toBe('23514');
  });

  test('leaving blocked clears the reason and keeps the next step', async () => {
    await as(db, 'owner',
      `update project_milestones set state = 'in_progress' where project_id = $1 and title = 'Content'`, [PROJECT.b1]);
    const row = await db.query(`select state, blocked_reason, next_step from project_milestones
      where project_id = '${PROJECT.b1}' and title = 'Content'`);
    expect(row.rows[0]).toEqual({ state: 'in_progress', blocked_reason: null, next_step: 'Chase the client' });
  });

  test('all five states are storable, with an assignee, a due date and a note', async () => {
    for (const state of ['pending', 'in_progress', 'waiting_client', 'done']) {
      const r = await as(db, 'owner', `insert into project_milestones
        (project_id, title, state, assignee, due_on, note) values ($1, $2, $3, 'Ügyfél', '2026-10-01', 'n')`,
      [PROJECT.b1, `S-${state}`, state]);
      expect(r.error, state).toBeNull();
    }
    const bad = await as(db, 'owner', `insert into project_milestones (project_id, title, state)
      values ($1, 'x', 'stuck')`, [PROJECT.b1]);
    expect(bad.error?.code).toBe('22P02');
  });
});

/* ============================================================ closing == */

test.describe('closing and reopening', () => {
  let db: PGlite;
  test.beforeAll(async () => { db = await fresh(); });

  const setStatus = (who: Who, project: string, status: string) =>
    as(db, who, `update projects set status = $2 where id = $1 returning status, completed_at, archived_at, payment_state`,
      [project, status]);

  test('a project with no checkpoints cannot be closed', async () => {
    const r = await setStatus('owner', PROJECT.empty, 'completed');
    expect(r.error?.message).toContain('stratos:project_close_no_checkpoints');
  });

  test('a project cannot be created already closed', async () => {
    const r = await as(db, 'owner', `insert into projects (organization_id, name, slug, status)
      values ($1, 'Born closed', 'born-closed', 'completed')`, [ORG.a]);
    expect(r.error?.message).toContain('stratos:project_close_no_checkpoints');
  });

  test('an open checkpoint blocks the close, whoever asks and however', async () => {
    const r = await setStatus('owner', PROJECT.a1, 'completed');
    expect(r.error?.message).toContain('stratos:project_close_open_checkpoints');
    // Setting the stamp directly does not close anything either.
    await as(db, 'owner', `update projects set completed_at = now() where id = $1`, [PROJECT.a1]);
    const row = await db.query(`select status, completed_at from projects where id = '${PROJECT.a1}'`);
    expect(row.rows[0]).toEqual({ status: 'active', completed_at: null });
  });

  test('every checkpoint done → the close succeeds, independent of payment and archive', async () => {
    await as(db, 'owner', `update project_milestones set state = 'done' where project_id = $1`, [PROJECT.a1]);
    const r = await setStatus('owner', PROJECT.a1, 'completed');
    expect(r.error).toBeNull();
    expect(r.rows[0].status).toBe('completed');
    expect(r.rows[0].completed_at).not.toBeNull();
    expect(r.rows[0].archived_at).toBeNull();
    expect(r.rows[0].payment_state).toBe('not_invoiced');

    const log = await db.query(`select metadata from activity_logs
      where entity_id = '${PROJECT.a1}' and action = 'project.status_changed' order by created_at desc limit 1`);
    expect(log.rows[0]).toEqual({ metadata: { from: 'active', to: 'completed' } });
  });

  test('a closed project\'s checkpoints are frozen', async () => {
    for (const sql of [
      `update project_milestones set state = 'in_progress' where project_id = '${PROJECT.a1}'`,
      `insert into project_milestones (project_id, title) values ('${PROJECT.a1}', 'Late extra')`,
      `delete from project_milestones where project_id = '${PROJECT.a1}'`,
    ]) {
      const r = await as(db, 'owner', sql);
      expect(r.error?.message, sql).toContain('stratos:project_closed');
    }
  });

  test('editing a closed project keeps its close date; archiving does not reopen it', async () => {
    const before = (await db.query<{ completed_at: Date }>(
      `select completed_at from projects where id = '${PROJECT.a1}'`)).rows[0].completed_at;
    await as(db, 'owner', `update projects set name = 'A website (live)', archived_at = now() where id = $1`, [PROJECT.a1]);
    const after = (await db.query<{ status: string; completed_at: Date; archived_at: Date | null }>(
      `select status, completed_at, archived_at from projects where id = '${PROJECT.a1}'`)).rows[0];
    expect(after.status).toBe('completed');
    expect(after.completed_at).toEqual(before);
    expect(after.archived_at).not.toBeNull();
    await as(db, 'owner', `update projects set archived_at = null where id = $1`, [PROJECT.a1]);
  });

  test('reopening clears the close date and unfreezes the checkpoints', async () => {
    const r = await setStatus('owner', PROJECT.a1, 'active');
    expect(r.error).toBeNull();
    expect(r.rows[0].completed_at).toBeNull();
    const edit = await as(db, 'owner',
      `update project_milestones set state = 'in_progress' where project_id = $1 and title = 'Build'`, [PROJECT.a1]);
    expect(edit.error).toBeNull();
    expect(edit.affected).toBe(1);
  });

  test('a non-owner cannot close or reopen', async () => {
    await as(db, 'owner', `update project_milestones set state = 'done' where project_id = $1`, [PROJECT.a1]);
    for (const who of ['super2', 'admin', 'clientA'] as Who[]) {
      const r = await setStatus(who, PROJECT.a1, 'completed');
      expect(r.affected, who).toBe(0);
    }
    expect((await db.query(`select status from projects where id = '${PROJECT.a1}'`)).rows[0])
      .toEqual({ status: 'active' });
  });
});

/* ========================================================== templates == */

test.describe('checkpoint templates', () => {
  let db: PGlite;
  test.beforeAll(async () => { db = await fresh(); });

  test('the four shipped lists are seeded once, and re-running step 2 adds nothing', async () => {
    await db.exec(fs.readFileSync(path.join(MIGRATIONS, '20260928000200_owner_tracker.sql'), 'utf8'));
    const rows = await db.query<{ name: string; n: number }>(
      `select name, cardinality(steps) as n from checkpoint_templates order by position`);
    expect(rows.rows).toEqual([
      { name: 'Website', n: 10 }, { name: 'Ads', n: 5 }, { name: 'Branding', n: 5 }, { name: 'General', n: 4 },
    ]);
  });

  test('a template is copied, so editing it never rewrites an existing project', async () => {
    const applied = await as(db, 'owner', `
      insert into project_milestones (project_id, title, position)
      select $1, s, o::int - 1 from checkpoint_templates t, unnest(t.steps) with ordinality as x(s, o)
      where t.name = 'Ads'`, [PROJECT.empty]);
    expect(applied.error).toBeNull();

    const edit = await as(db, 'owner',
      `update checkpoint_templates set steps = array['Only step'] where name = 'Ads'`);
    expect(edit.affected).toBe(1);

    const steps = await db.query<{ title: string }>(
      `select title from project_milestones where project_id = '${PROJECT.empty}' order by position`);
    expect(steps.rows.map((r) => r.title)).toEqual(['Audit', 'Account setup', 'Creative', 'Launch', 'Optimisation']);
  });

  test('a template needs one to forty non-blank steps and a unique live name', async () => {
    for (const steps of [`array[]::text[]`, `array['ok', '  ']`, `array[repeat('x', 161)]`]) {
      const r = await as(db, 'owner', `insert into checkpoint_templates (name, steps) values ('Bad', ${steps})`);
      expect(r.error?.code, steps).toBe('23514');
    }
    const dup = await as(db, 'owner', `insert into checkpoint_templates (name, steps) values (' website ', array['a'])`);
    expect(dup.error?.code).toBe('23505');
  });
});

/* =========================================================== rollback == */

test.describe('rollback keeps every row written in the meantime', () => {
  test('both rollbacks restore the old access and delete nothing', async () => {
    const db = await fresh();
    await as(db, 'owner', `insert into project_milestones (project_id, title, state, assignee, note)
      values ($1, 'Waiting', 'waiting_client', 'Ügyfél', 'kept')`, [PROJECT.b1]);
    await as(db, 'owner', `insert into checkpoint_templates (name, steps) values ('Custom', array['One'])`);
    await as(db, 'owner', `insert into record_notes (entity_type, entity_id, author_id, body)
      values ('project', $1, $2, 'written during lockdown')`, [PROJECT.b1, U.owner]);

    const snapshot = async () => (await db.query(`select
      (select count(*) from projects)::int as projects,
      (select count(*) from project_milestones)::int as milestones,
      (select count(*) from checkpoint_templates)::int as templates,
      (select count(*) from record_notes)::int as notes,
      (select count(*) from activity_logs)::int as logs,
      (select count(*) from project_milestones where state = 'waiting_client' and note = 'kept')::int as waiting`)).rows[0];

    const before = await snapshot();
    await db.exec(fs.readFileSync(path.join(CHECKS, 'owner-lockdown-rollback.sql'), 'utf8'));
    await db.exec(fs.readFileSync(path.join(CHECKS, 'owner-tracker-rollback.sql'), 'utf8'));
    expect(await snapshot()).toEqual(before);

    // The previous model is back: admins read projects, clients read their own.
    expect(await count(db, 'admin', 'projects')).toBe(3);
    expect(await count(db, 'clientA', 'projects')).toBe(1);
    // And the rules are gone: a blocked step without a reason is accepted again.
    const r = await as(db, 'admin', `insert into project_milestones (project_id, title, state)
      values ($1, 'x', 'blocked')`, [PROJECT.b1]);
    expect(r.error).toBeNull();
  });

  test('the lockdown can be re-applied after a rollback', async () => {
    const db = await fresh();
    await db.exec(fs.readFileSync(path.join(CHECKS, 'owner-lockdown-rollback.sql'), 'utf8'));
    await db.exec(fs.readFileSync(path.join(MIGRATIONS, '20260928000300_owner_lockdown.sql'), 'utf8'));
    expect(await count(db, 'admin', 'projects')).toBe(0);
    expect(await count(db, 'owner', 'projects')).toBe(3);
  });
});

/* ===================================================== the SQL checks == */

test.describe('the production check scripts', () => {
  test('verify reports every check ok, and leaves nothing behind', async () => {
    const db = await fresh();
    const results = await db.exec(fs.readFileSync(path.join(CHECKS, 'owner-tracker-verify.sql'), 'utf8'));
    const report = results.filter((r) => r.fields.some((f) => f.name === 'check_name')).pop()!;
    const failed = report.rows.filter((r) => r.result !== 'ok');
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    // five non-owner accounts impersonated, plus the structural checks
    expect(report.rows.filter((r) => String(r.check_name).includes('sees no project data')).length).toBe(5);
    expect((await db.query(`select to_regclass('pg_temp.verify_result') as t`)).rows[0]).toEqual({ t: null });
  });

  test('verify reports FAIL when the lockdown is missing', async () => {
    const db = await fresh({ lockdown: false });
    const results = await db.exec(fs.readFileSync(path.join(CHECKS, 'owner-tracker-verify.sql'), 'utf8'));
    const report = results.filter((r) => r.fields.some((f) => f.name === 'check_name')).pop()!;
    expect(report.rows.filter((r) => r.result === 'FAIL').length).toBeGreaterThan(0);
  });

  test('preflight is read-only and runs on the pre-phase schema', async () => {
    const db = new PGlite({ extensions: { pgcrypto } });
    await db.exec(STANDIN);
    await migrate(db, '20260816000100_revenue_operations.sql');
    await seed(db);
    const sql = fs.readFileSync(path.join(CHECKS, 'owner-tracker-preflight.sql'), 'utf8');
    expect(sql.replace(/--.*$/gm, '')).not.toMatch(/\b(insert|update|delete|alter|create|drop|grant|revoke)\b/i);
    const results = await db.exec(sql);
    const presence = results[0].rows as { object: string; present: boolean }[];
    expect(presence.filter((r) => !r.present)).toEqual([]);
  });
});

/* ========================================================== the files == */

test.describe('the three migrations', () => {
  const read = (name: string) => fs.readFileSync(path.join(MIGRATIONS, name), 'utf8')
    .replace(/--.*$/gm, '');

  test('none drops, truncates or deletes data', () => {
    for (const name of ['20260928000100_owner_tracker_enums.sql', '20260928000200_owner_tracker.sql',
      '20260928000300_owner_lockdown.sql']) {
      const sql = read(name);
      expect(sql, name).not.toMatch(/\bdrop\s+(table|type|schema|column|function)\b/i);
      expect(sql, name).not.toMatch(/\btruncate\b/i);
      expect(sql, name).not.toMatch(/\bdelete\s+from\b/i);
      expect(sql, name).not.toMatch(/\bupdate\s+\w+\s+set\b/i);
    }
  });

  test('the enum step is alone and cannot fail silently', () => {
    const sql = read('20260928000100_owner_tracker_enums.sql');
    expect(sql.trim().split(';').filter((s) => s.trim()).length).toBe(1);
    expect(sql).not.toMatch(/exception\s+when/i);
  });
});

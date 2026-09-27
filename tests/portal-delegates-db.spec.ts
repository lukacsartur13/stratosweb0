import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

/**
 * Phase 6 — a named owner delegate (20261003000100_owner_delegates.sql):
 * one admin with exactly the owner's rights, by name, not by role. PGlite
 * (real Postgres 18.3, superuser, one connection); the same storage and auth
 * stand-ins as the other suites.
 */

test.describe.configure({ mode: 'serial' });

const ROOT = process.cwd();
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations');
const CHECKS = path.join(ROOT, 'supabase', 'checks');
const PHASE6 = '20261003000100_owner_delegates.sql';
const read = (dir: string, file: string) => fs.readFileSync(path.join(dir, file), 'utf8');
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const U = { owner: id(1), delegate: id(2), admin: id(3), super2: id(4), team: id(5), client: id(6) } as const;
const ORG = id(101);
const P = id(201);
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


async function fresh(withPhase6 = true) {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(STANDIN);
  const files = fs.readdirSync(MIGRATIONS).filter((f) => /^\d+_[a-z_]+\.sql$/.test(f)).sort();
  for (const f of files.filter((x) => x <= '20260928000200_owner_tracker.sql')) await db.exec(read(MIGRATIONS, f));
  await db.exec(`
    insert into auth.users (id, email) values
      ('${U.owner}', 'owner@example.invalid'), ('${U.delegate}', 'info@example.invalid'), ('${U.admin}', 'admin2@example.invalid'),
      ('${U.super2}', 'super2@example.invalid'), ('${U.team}', 'team@example.invalid'), ('${U.client}', 'client@a.example');
    update profiles set role = 'super_admin' where id in ('${U.owner}', '${U.super2}');
    update profiles set role = 'admin' where id in ('${U.delegate}', '${U.admin}');
    update profiles set role = 'team_member' where id = '${U.team}';
    insert into organizations (id, name, slug, status) values ('${ORG}', 'A Kft.', 'a', 'active');
  `);
  await db.query(`select portal_set_owner('owner@example.invalid')`);
  for (const f of files.filter((x) => x > '20260928000200_owner_tracker.sql' && (withPhase6 || x < PHASE6))) await db.exec(read(MIGRATIONS, f));
  await db.exec(`
    insert into projects (id, organization_id, name, slug, status, value, currency) values ('${P}', '${ORG}', 'Web', 'web', 'active', 1000, 'HUF');
    insert into project_milestones (project_id, title, position, state) values ('${P}', 'Build', 0, 'in_progress');
  `);
  return db;
}

type Result = { rows: Record<string, unknown>[]; error: null | { code?: string; message: string } };
async function as(db: PGlite, who: Who, sql: string, params: unknown[] = []): Promise<Result> {
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [who === 'anon' ? '{}' : JSON.stringify({ sub: U[who], role: 'authenticated' })]);
  await db.exec(`set role ${who === 'anon' ? 'anon' : 'authenticated'}`);
  try { return { rows: (await db.query<Record<string, unknown>>(sql, params)).rows, error: null }; }
  catch (e) { const x = e as { code?: string; message: string }; return { rows: [], error: { code: x.code, message: x.message } }; }
  finally { await db.exec('reset role'); }
}
const reach = async (db: PGlite, who: Who) => {
  const n = async (sql: string) => { const r = await as(db, who, sql); return r.error ? -1 : Number(r.rows[0]?.n ?? 0); };
  return {
    isOwner: (await as(db, who, `select is_owner() as x`)).rows[0]?.x ?? false,
    projects: await n(`select count(*) as n from projects`),
    checkpoints: await n(`select count(*) as n from project_milestones`),
    writeProject: !(await as(db, who, `update projects set description = 'x' where id = $1 returning id`, [P])).error
      && (await as(db, who, `select count(*) as n from projects where description = 'x'`)).rows[0]?.n !== undefined,
    instalment: !(await as(db, who, `insert into project_instalments (project_id, label, amount, due_on) values ($1, 'x', 1, current_date)`, [P])).error,
    impact: await n(`select count(*) as n from impact_applications`),
    upload: !(await as(db, who, `select * from document_begin_upload($1, null, 'x.txt', 1, null, 'text')`, [P])).error,
    invite: !(await as(db, who, `select * from client_invite_prepare($1, null, 'x', 'x-${who}@a.example', '{}')`, [ORG])).error,
  };
};

test.describe('a named delegate has exactly the owner\'s rights', () => {
  let db: PGlite;
  test.beforeAll(async () => {
    db = await fresh();
    await db.exec(`insert into leads (name, email, form_type, source) values ('Imp', 'imp@example.invalid', 'impact', 'impact')`);
    await db.query(`select portal_add_delegate('INFO@example.invalid ')`);
  });

  test('the delegate reaches everything the owner reaches', async () => {
    const o = await reach(db, 'owner');
    const d = await reach(db, 'delegate');
    expect(o).toMatchObject({ isOwner: true, projects: 1, checkpoints: 1, instalment: true, impact: 1, upload: true, invite: true });
    expect(d).toMatchObject({ isOwner: true, projects: 1, checkpoints: 1, instalment: true, impact: 1, upload: true, invite: true });
  });

  for (const who of ['admin', 'super2', 'team', 'client', 'anon'] as const) {
    test(`${who}: still nothing`, async () => {
      const r = await reach(db, who);
      expect(r.isOwner === true).toBe(false);
      expect(r.projects <= 0 && r.checkpoints <= 0 && r.impact <= 0).toBe(true);
      expect(r.instalment || r.upload || r.invite).toBe(false);
    });
  }

  test('demoting the delegate closes the access; restoring the role reopens it', async () => {
    await db.exec(`update profiles set role = 'team_member' where id = '${U.delegate}'`);
    expect((await reach(db, 'delegate')).projects).toBe(0);
    await db.exec(`update profiles set role = 'admin' where id = '${U.delegate}'`);
    expect((await reach(db, 'delegate')).projects).toBe(1);
  });

  test('the delegate list and its functions are not reachable through the API', async () => {
    for (const who of ['owner', 'delegate', 'admin', 'anon'] as const) {
      expect((await as(db, who, `select * from portal_owner_delegates`)).error?.code, who).toBe('42501');
      expect((await as(db, who, `select portal_add_delegate('admin2@example.invalid')`)).error?.code, who).toBe('42501');
      expect((await as(db, who, `select portal_remove_delegate('info@example.invalid')`)).error?.code, who).toBe('42501');
    }
  });

  test('add refuses an unknown address, a team member, a client and the owner', async () => {
    for (const email of ['nobody@example.invalid', 'team@example.invalid', 'client@a.example', 'owner@example.invalid']) {
      await expect(db.query(`select portal_add_delegate($1)`, [email]), email).rejects.toThrow();
    }
    const log = await db.query<{ n: number }>(`select count(*)::int as n from activity_logs where action = 'portal.owner_delegate_added'`);
    expect(log.rows[0].n).toBe(1);
  });

  test('every verify script reads ok with a delegate present', async () => {
    for (const file of ['owner-tracker-verify.sql', 'impact-verify.sql', 'documents-verify.sql', 'client-portal-verify.sql',
      'payment-schedule-verify.sql', 'owner-delegates-verify.sql']) {
      await db.exec(read(CHECKS, file).replace(/rollback;\s*$/, ''));
      const rows = (await db.query<{ check_name: string; ok: boolean; detail: string | null }>(`select check_name, ok, detail from verify_result`)).rows;
      await db.exec('rollback');
      expect(rows.filter((r) => !r.ok), file).toEqual([]);
      expect(rows.length, file).toBeGreaterThan(3);
    }
  });

  test('removing the delegate ends the access; the owner keeps it', async () => {
    expect((await db.query<{ x: boolean }>(`select portal_remove_delegate('info@example.invalid') as x`)).rows[0].x).toBe(true);
    expect((await reach(db, 'delegate')).projects).toBe(0);
    expect((await reach(db, 'owner')).projects).toBe(1);
  });
});

test.describe('rollback and re-apply', () => {
  test('rollback restores owner-only and keeps the list; re-applying restores the delegate', async () => {
    const db = await fresh();
    await db.query(`select portal_add_delegate('info@example.invalid')`);
    await db.exec(read(CHECKS, 'owner-delegates-rollback.sql'));
    expect((await reach(db, 'delegate')).projects).toBe(0);
    expect((await reach(db, 'owner')).projects).toBe(1);
    expect((await db.query<{ n: number }>(`select count(*)::int as n from portal_owner_delegates`)).rows[0].n).toBe(1);
    await db.exec(read(MIGRATIONS, PHASE6));
    expect((await reach(db, 'delegate')).projects).toBe(1);
  });

  test('without the migration an admin is never the owner (phase 1–5 behaviour)', async () => {
    const db = await fresh(false);
    expect((await reach(db, 'delegate')).projects).toBe(0);
  });
});

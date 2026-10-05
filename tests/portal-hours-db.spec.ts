import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

/**
 * Hours worked (20261012000100_time_entries.sql) against a real Postgres (PGlite).
 */

test.describe.configure({ mode: 'serial' });

const ROOT = process.cwd();
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations');
const read = (f: string) => fs.readFileSync(path.join(MIGRATIONS, f), 'utf8');
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const U = { owner: id(1), admin: id(3), team: id(4), anna: id(5) } as const;
const ORG = id(101);
const PROJECT = id(201);
const LEAD = id(401);
type Who = keyof typeof U;

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
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: U[who], role: 'authenticated' })]);
  await db.exec('set role authenticated');
  try {
    const r = await db.query<Record<string, unknown>>(sql, params);
    return { rows: r.rows, affected: r.affectedRows ?? 0, error: null as null | string };
  } catch (e) {
    return { rows: [], affected: 0, error: (e as Error).message };
  } finally {
    await db.exec('reset role');
  }
}
const ok = async (db: PGlite, who: Who, sql: string, params: unknown[] = []) => {
  const r = await as(db, who, sql, params);
  if (r.error) throw new Error(`${who}: ${r.error}`);
  return r.rows;
};

let db: PGlite;
test.beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(STANDIN);
  const files = fs.readdirSync(MIGRATIONS).filter((f) => /^\d+_[a-z_]+\.sql$/.test(f)).sort();
  for (const file of files.filter((f) => f <= '20260928000200_owner_tracker.sql')) await db.exec(read(file));
  await db.exec(`
    insert into auth.users (id, email) values ('${U.owner}', 'owner@example.invalid'), ('${U.admin}', 'admin@example.invalid'),
      ('${U.team}', 'team@example.invalid'), ('${U.anna}', 'anna@a.example');
    update profiles set role = 'super_admin' where id = '${U.owner}';
    update profiles set role = 'admin' where id = '${U.admin}';
    update profiles set role = 'team_member' where id = '${U.team}';
    insert into organizations (id, name, slug, status) values ('${ORG}', 'A Kft.', 'a', 'active');
    update profiles set organization_id = '${ORG}' where id = '${U.anna}';
    insert into projects (id, organization_id, name, slug, status, currency) values ('${PROJECT}', '${ORG}', 'Web', 'web', 'active', 'HUF');
    insert into leads (id, name, email, status, form_type, source) values ('${LEAD}', 'Kiss Péter', 'peter@example.invalid', 'new', 'contact', 'website');
  `);
  await db.query(`select portal_set_owner('owner@example.invalid')`);
  for (const file of files.filter((f) => f > '20260928000200_owner_tracker.sql')) await db.exec(read(file));
});

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Budapest' }).format(new Date());

test('an admin logs their own hours on "other"; everybody sees everybody\'s; a team member and a client see none', async () => {
  await ok(db, 'admin', `insert into time_entries (work_date, hours, label, note) values ($1, 3.5, 'Administration', 'Invoices')`, [today()]);
  await ok(db, 'owner', `insert into time_entries (work_date, hours, project_id) values ($1, 4, $2)`, [today(), PROJECT]);
  expect((await ok(db, 'admin', `select user_id, hours from time_entries order by hours`)).length).toBe(2);
  expect((await ok(db, 'owner', `select * from time_entries`)).length).toBe(2);
  for (const who of ['team', 'anna'] as const) {
    expect((await ok(db, who, `select * from time_entries`)).length, who).toBe(0);
    expect((await as(db, who, `insert into time_entries (work_date, hours, label) values ($1, 1, 'x')`, [today()])).error, who).not.toBeNull();
  }
});

test('nobody writes another person\'s hours, except the owner correcting them', async () => {
  const forged = await as(db, 'admin', `insert into time_entries (user_id, work_date, hours, label) values ($1, $2, 1, 'x')`, [U.owner, today()]);
  expect(forged.error).not.toBeNull();
  expect((await as(db, 'admin', `update time_entries set hours = 9 where user_id = $1`, [U.owner])).affected).toBe(0);
  expect((await as(db, 'admin', `delete from time_entries where user_id = $1`, [U.owner])).affected).toBe(0);
  expect((await as(db, 'owner', `update time_entries set hours = 3 where user_id = $1`, [U.admin])).affected).toBe(1);
});

test('an admin puts hours on any project, chosen from names only; a project\'s hours are summed from the lines', async () => {
  // The admin sees each project's name, client and closed flag — and nothing else about it.
  const list = await ok(db, 'admin', `select * from time_projects()`);
  expect(list).toEqual([{ project_id: PROJECT, project_name: 'Web', client_name: 'A Kft.', closed: false }]);
  expect((await ok(db, 'admin', `select * from projects`)).length).toBe(0);
  for (const who of ['team', 'anna'] as const) expect((await ok(db, who, `select * from time_projects()`)).length, who).toBe(0);
  await ok(db, 'admin', `insert into time_entries (work_date, hours, project_id) values ($1, 1, $2)`, [today(), PROJECT]);
  await ok(db, 'owner', `insert into time_entries (work_date, hours, project_id, note) values ($1, 1.25, $2, 'Call')`, [today(), PROJECT]);
  const [{ sum }] = await ok(db, 'owner', `select sum(hours)::float as sum from time_entries where project_id = $1`, [PROJECT]);
  expect(sum).toBe(6.25);
});

test('quarter hours, a line needs a project or a label, and a day holds at most 24 hours', async () => {
  expect((await as(db, 'admin', `insert into time_entries (work_date, hours, label) values ($1, 1.1, 'x')`, [today()])).error).toContain('check');
  expect((await as(db, 'admin', `insert into time_entries (work_date, hours) values ($1, 1)`, [today()])).error).toContain('check');
  // The admin's day already holds 4 hours (3 corrected by the owner + 1 on the project).
  expect((await as(db, 'admin', `insert into time_entries (work_date, hours, label) values ($1, 20.25, 'x')`, [today()])).error).toContain('stratos:time_day_over_24');
  expect((await as(db, 'admin', `insert into time_entries (work_date, hours, label) values ($1, 20, 'x')`, [today()])).error).toBeNull();
});

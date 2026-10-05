import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

/**
 * Notes, checklists, tasks and the activity log
 * (20261011000100_notes_tasks_activity.sql) against a real Postgres (PGlite).
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

test('an admin writes a checklist about a client; a team member and a client see nothing', async () => {
  const [n] = await ok(db, 'admin', `insert into notes (kind, title, organization_id) values ('checklist', 'Meeting 10.12.', $1) returning id`, [ORG]);
  await ok(db, 'admin', `insert into note_items (note_id, text, position, due_on) values ($1, 'Send the offer', 0, current_date), ($1, 'Ask for the logo', 1, null)`, [n.id]);
  for (const who of ['team', 'anna'] as const) {
    expect((await ok(db, who, `select * from notes`)).length, who).toBe(0);
    expect((await ok(db, who, `select * from note_items`)).length, who).toBe(0);
    expect((await as(db, who, `insert into notes (title) values ('x')`)).error, who).not.toBeNull();
  }
  expect((await ok(db, 'owner', `select * from note_items where note_id = $1`, [n.id])).length).toBe(2);
});

test('ticking stamps done_at, unticking clears it; a task is a point with a due date', async () => {
  const [item] = await ok(db, 'admin', `update note_items set done = true where text = 'Send the offer' returning done_at`);
  expect(item.done_at).not.toBeNull();
  const [again] = await ok(db, 'admin', `update note_items set done = false where text = 'Send the offer' returning done_at`);
  expect(again.done_at).toBeNull();
  const due = await ok(db, 'admin', `select text from note_items where not done and due_on <= current_date`);
  expect(due.map((r) => r.text)).toEqual(['Send the offer']);
});

test('a point becomes a project checkpoint once, and only the owner may do it', async () => {
  const [item] = await ok(db, 'admin', `select id from note_items where text = 'Ask for the logo'`);
  const admin = await as(db, 'admin', `select note_item_to_milestone($1, $2)`, [item.id, PROJECT]);
  expect(admin.error).not.toBeNull();
  const [{ m }] = await ok(db, 'owner', `select note_item_to_milestone($1, $2) as m`, [item.id, PROJECT]);
  const [{ again }] = await ok(db, 'owner', `select note_item_to_milestone($1, $2) as again`, [item.id, PROJECT]);
  expect(again).toBe(m);
  const ms = await ok(db, 'owner', `select title from project_milestones where project_id = $1`, [PROJECT]);
  expect(ms.map((r) => r.title)).toEqual(['Ask for the logo']);
});

test('the activity log: needs a record, and goes with a lead erased for privacy', async () => {
  expect((await as(db, 'admin', `insert into interactions (kind, summary) values ('call', 'Called')`)).error).toContain('check');
  await ok(db, 'admin', `insert into interactions (kind, summary, lead_id) values ('call', 'First call', $1)`, [LEAD]);
  await ok(db, 'admin', `insert into interactions (kind, summary, organization_id) values ('meeting', 'Kick-off', $1)`, [ORG]);
  expect((await ok(db, 'team', `select * from interactions`)).length).toBe(0);
  await ok(db, 'admin', `update leads set trashed_at = now() where id = $1`, [LEAD]);
  await ok(db, 'admin', `select purge_lead($1)`, [LEAD]);
  const left = await ok(db, 'owner', `select summary from interactions order by summary`);
  expect(left.map((r) => r.summary)).toEqual(['Kick-off']);
});

test('a client deleted for good leaves its notes, unlinked', async () => {
  await ok(db, 'owner', `update projects set archived_at = now() where id = $1`, [PROJECT]);
  await ok(db, 'owner', `select purge_project($1)`, [PROJECT]).catch(() => null);
  await db.exec(`delete from project_milestones; delete from projects`);
  await ok(db, 'owner', `update organizations set archived_at = now() where id = $1`, [ORG]);
  await db.exec(`update profiles set organization_id = null where id = '${U.anna}'`);
  await ok(db, 'owner', `select purge_client($1)`, [ORG]);
  const notes = await ok(db, 'admin', `select title, organization_id from notes`);
  expect(notes).toEqual([{ title: 'Meeting 10.12.', organization_id: null }]);
  expect((await ok(db, 'owner', `select * from interactions`)).length).toBe(0);
});

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

/**
 * Google (20261017000100_google.sql): connected accounts whose token nobody can
 * read through the API, the e-mail history matched to leads, clients and deals,
 * and the meetings marked for the calendar sync — against real Postgres (PGlite).
 */

test.describe.configure({ mode: 'serial' });

const ROOT = process.cwd();
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations');
const CHECKS = path.join(ROOT, 'supabase', 'checks');
const read = (dir: string, file: string) => fs.readFileSync(path.join(dir, file), 'utf8');
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const U = {
  owner: id(1), super2: id(2), admin: id(3), team: id(4),
  a1: id(5), a2: id(6), b1: id(7), stranger: id(8),
} as const;
const ORG = { a: id(101), b: id(102) };
const P = { a1: id(201), a2: id(202), b1: id(203) };
const BUCKET = 'project-documents';

type Who = keyof typeof U | 'anon';
const STAFF: Who[] = ['super2', 'admin', 'team'];

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
  insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true);
  create policy careless_everything on storage.objects for all to authenticated using (true) with check (true);
`;

async function fresh() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(STANDIN);
  const files = fs.readdirSync(MIGRATIONS).filter((f) => /^\d+_[a-z_]+\.sql$/.test(f)).sort();
  for (const file of files.filter((f) => f <= '20260928000200_owner_tracker.sql')) await db.exec(read(MIGRATIONS, file));
  await db.exec(`
    insert into auth.users (id, email) values
      ('${U.owner}', 'owner@example.invalid'), ('${U.super2}', 'super2@example.invalid'),
      ('${U.admin}', 'admin@example.invalid'), ('${U.team}', 'team@example.invalid'),
      ('${U.a1}', 'anna@a.example'), ('${U.a2}', 'bela@a.example'), ('${U.b1}', 'cili@b.example'),
      ('${U.stranger}', 'stranger@c.example');
    insert into organizations (id, name, slug, status) values
      ('${ORG.a}', 'A Kft.', 'a', 'active'), ('${ORG.b}', 'B Kft.', 'b', 'active');
    update profiles set role = 'super_admin' where id in ('${U.owner}', '${U.super2}');
    update profiles set role = 'admin' where id = '${U.admin}';
    update profiles set role = 'team_member' where id = '${U.team}';
    insert into projects (id, organization_id, name, slug, status, value, currency, paid_amount) values
      ('${P.a1}', '${ORG.a}', 'A website', 'a-web', 'active', 1500000, 'HUF', 500000),
      ('${P.a2}', '${ORG.a}', 'A ads', 'a-ads', 'active', 300000, 'HUF', null),
      ('${P.b1}', '${ORG.b}', 'B brand', 'b-brand', 'active', 900000, 'HUF', null);
    insert into project_milestones (project_id, title, position, state, blocked_reason, next_step) values
      ('${P.a1}', 'Content', 0, 'blocked', 'Secret internal reason', 'Chase them');
    insert into client_contacts (id, organization_id, name, email) values
      ('${id(301)}', '${ORG.a}', 'Anna', 'anna@a.example'), ('${id(302)}', '${ORG.b}', 'Cili', 'cili@b.example');
  `);
  await db.query(`select portal_set_owner('owner@example.invalid')`);
  for (const file of files.filter((f) => f > '20260928000200_owner_tracker.sql')) await db.exec(read(MIGRATIONS, file));
  await db.exec(`insert into record_notes (entity_type, entity_id, author_id, body) values ('project', '${P.a1}', '${U.owner}', 'Internal note')`);
  return db;
}

type Result = { rows: Record<string, unknown>[]; affected: number; error: null | { code?: string; message: string } };
async function as(db: PGlite, who: Who, sql: string, params: unknown[] = []): Promise<Result> {
  const role = who === 'anon' ? 'anon' : 'authenticated';
  const claims = who === 'anon' ? '{}' : JSON.stringify({ sub: U[who], role: 'authenticated' });
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [claims]);
  await db.exec(`set role ${role}`);
  try {
    const r = await db.query<Record<string, unknown>>(sql, params);
    return { rows: r.rows, affected: r.affectedRows ?? 0, error: null };
  } catch (error) {
    const e = error as { code?: string; message: string };
    return { rows: [], affected: 0, error: { code: e.code, message: e.message } };
  } finally {
    await db.exec('reset role');
  }
}
const ok = async (db: PGlite, who: Who, sql: string, params: unknown[] = []) => {
  const r = await as(db, who, sql, params);
  if (r.error) throw new Error(`${who}: ${r.error.message}`);
  return r.rows;
};

async function canSign(db: PGlite, who: Who, objectName: string) {
  await db.exec('begin');
  try {
    await db.query(`select set_config('request.jwt.claims', $1, true)`,
      [who === 'anon' ? '{}' : JSON.stringify({ sub: U[who], role: 'authenticated' })]);
    await db.exec(`set local role ${who === 'anon' ? 'anon' : 'authenticated'}`);
    await db.query(`insert into storage.objects (bucket_id, name, owner, metadata) values ($1, $2, null, '{}')`, [BUCKET, objectName]);
    return true;
  } catch {
    return false;
  } finally {
    await db.exec('rollback');
  }
}
const storeObject = (db: PGlite, objectName: string, size: number) =>
  db.query(`insert into storage.objects (bucket_id, name, owner, metadata) values ($1, $2, null, $3)`,
    [BUCKET, objectName, JSON.stringify({ size })]);
const canRead = async (db: PGlite, who: Who, objectName: string) =>
  ((await as(db, who, `select count(*)::int as n from storage.objects where name = $1`, [objectName])).rows[0]?.n ?? 0) === 1;

/** The owner's two invite steps — what netlify/functions/portal-invite.mjs does around the auth user. */
async function invite(db: PGlite, org: string, name: string, email: string, projects: string[], user?: string) {
  const [acct] = await ok(db, 'owner', `select * from client_invite_prepare($1, null, $2, $3, $4::uuid[])`, [org, name, email, projects]);
  if (user) await ok(db, 'owner', `select client_invite_attach($1, $2)`, [acct.account_id, user]);
  return acct.account_id as string;
}
const accessId = async (db: PGlite, account: string, project: string) =>
  (await db.query<{ id: string }>(`select id from client_project_access where account_id = $1 and project_id = $2 and revoked_at is null`,
    [account, project])).rows[0]?.id;



const demo = (db: PGlite, project: string, extra: Record<string, unknown> = {}) =>
  as(db, 'owner', `insert into project_demos (project_id, title, url, client_note, published) values ($1, $2, $3, $4, $5) returning id`,
    [project, extra.title ?? 'Weboldal demó', extra.url ?? 'https://demo.example.com/v1', extra.note ?? 'Nézd meg!', extra.published ?? true]);
const meeting = (db: PGlite, project: string, startsIn: number, extra: Record<string, unknown> = {}) =>
  as(db, 'owner', `insert into project_meetings (project_id, title, starts_at, ends_at, time_zone, join_url, location, client_note)
                   values ($1, $2, now() + make_interval(hours => $3::int), now() + make_interval(hours => $3::int + 1), $4, $5, $6, $7) returning id`,
    [project, extra.title ?? 'Egyeztetés', startsIn, extra.zone ?? 'Europe/Budapest', extra.join ?? 'https://meet.example.com/abc', extra.location ?? null, extra.note ?? null]);




const account = (db: PGlite, who: string, email: string) =>
  db.exec(`insert into google_accounts (user_id, google_email, scopes, refresh_token_enc) values ('${who}', '${email}', 'gmail calendar', 'v1:secret') on conflict do nothing`);

test.describe('google', () => {
  let db: PGlite;
  test.beforeAll(async () => {
    db = await fresh();
    await account(db, U.owner, 'owner@media-stratos.example');
    await account(db, U.admin, 'admin@media-stratos.example');
  });

  test('a connected account: its owner reads it but never the token; nobody else reads it; it can be disconnected', async () => {
    const [mine] = await ok(db, 'owner', `select user_id, google_email, scopes from google_accounts`);
    expect(mine).toEqual({ user_id: U.owner, google_email: 'owner@media-stratos.example', scopes: 'gmail calendar' });
    expect((await as(db, 'owner', `select refresh_token_enc from google_accounts`)).error?.code).toBe('42501');
    expect((await as(db, 'owner', `select * from google_accounts`)).error?.code).toBe('42501');
    expect(await ok(db, 'super2', `select user_id from google_accounts`)).toEqual([]);
    expect((await as(db, 'owner', `insert into google_accounts (user_id, google_email, refresh_token_enc) values ($1, 'x@y', 'z')`, [U.owner])).error).not.toBeNull();
    expect((await as(db, 'owner', `update google_accounts set google_email = 'x' where user_id = $1`, [U.owner])).error).not.toBeNull();
    await ok(db, 'admin', `delete from google_accounts where user_id = $1`, [U.admin]);
    expect((await db.query(`select count(*)::int as n from google_accounts`)).rows[0]).toEqual({ n: 1 });
    await account(db, U.admin, 'admin@media-stratos.example');
  });

  test('the known addresses: leads, client contacts and deal contacts, lower-cased; the sync key only', async () => {
    await db.exec(`
      insert into leads (id, name, email, status, created_at) values ('${id(401)}', 'Kovács Anna', 'Anna@Kert.example', 'new', now() - interval '30 hours');
      insert into opportunities (id, title, company_name, contact_email, organization_id) values ('${id(501)}', 'Webshop', 'B Kft.', 'cili@b.example', '${ORG.b}');`);
    const rows = (await db.query<{ email: string; lead_id: string | null; organization_id: string | null; opportunity_id: string | null }>(
      `select * from email_known_addresses() order by email, opportunity_id nulls first`)).rows;
    expect(rows.map((r) => r.email)).toEqual(['anna@a.example', 'anna@kert.example', 'cili@b.example', 'cili@b.example']);
    expect(rows.find((r) => r.email === 'anna@kert.example')?.lead_id).toBe(id(401));
    expect((await as(db, 'owner', `select * from email_known_addresses()`)).error?.code).toBe('42501');
  });

  const store = (gmail: string, direction: 'in' | 'out', lead: string | null, org: string | null = null) =>
    db.query(`select email_store($1, $2, 't1', $3, $4, 'Owner', $5::text[], 'Árajánlat', 'Küldöm az ajánlatot…', now(), $6, $7, null) as made`,
      [U.owner, gmail, direction, direction === 'out' ? 'owner@media-stratos.example' : 'anna@kert.example',
       direction === 'out' ? ['anna@kert.example'] : ['owner@media-stratos.example'], lead, org]);

  test('a message is stored once; an outgoing one to a new lead is logged and answers the "no reply" alert', async () => {
    expect(await db.query(`select automation_run()`).then((r) => r.rows.length)).toBe(1);
    expect((await db.query(`select count(*)::int as n from automation_alerts where kind = 'lead_unanswered' and resolved_at is null`)).rows[0]).toEqual({ n: 1 });
    expect(((await store('g-1', 'in', id(401))).rows[0] as { made: boolean }).made).toBe(true);
    expect((await db.query(`select count(*)::int as n from interactions`)).rows[0]).toEqual({ n: 0 }); // incoming is not an answer
    expect(((await store('g-2', 'out', id(401))).rows[0] as { made: boolean }).made).toBe(true);
    expect(((await store('g-2', 'out', id(401))).rows[0] as { made: boolean }).made).toBe(false);
    const [log] = (await db.query<{ kind: string; summary: string }>(`select kind, summary from interactions`)).rows;
    expect(log).toEqual({ kind: 'email', summary: 'E-mail: Árajánlat' });
    await db.query(`select automation_run()`);
    expect((await db.query(`select count(*)::int as n from automation_alerts where kind = 'lead_unanswered' and resolved_at is null`)).rows[0]).toEqual({ n: 0 });
  });

  test('the history is the admins\' to read: not a team member\'s, not a client\'s, and nobody writes it through the API', async () => {
    expect((await ok(db, 'admin', `select gmail_id from email_messages order by gmail_id`)).map((r) => r.gmail_id)).toEqual(['g-1', 'g-2']);
    expect(await ok(db, 'team', `select * from email_messages`)).toEqual([]);
    expect((await as(db, 'owner', `insert into email_messages (mailbox_user_id, gmail_id, direction, from_email, sent_at, lead_id) values ($1, 'x', 'in', 'a@b', now(), $2)`, [U.owner, id(401)])).error).not.toBeNull();
    expect((await as(db, 'owner', `select email_store($1, 'x', null, 'in', 'a@b', null, '{}', null, null, now(), $2, null, null)`, [U.owner, id(401)])).error?.code).toBe('42501');
  });

  test('meetings: a new one is marked for the sync, in its maker\'s calendar; the clients only when asked; the write-back does not mark it again', async () => {
    await invite(db, ORG.a, 'Anna', 'anna@a.example', [P.a1], U.a1);
    const [m] = await ok(db, 'owner', `insert into project_meetings (project_id, title, starts_at, ends_at, join_url)
      values ($1, 'Egyeztetés', now() + interval '2 days', now() + interval '2 days 1 hour', 'https://meet.example.com/x') returning id`, [P.a1]);
    let [tg] = (await db.query<Record<string, unknown>>(`select * from google_sync_targets()`)).rows;
    expect([tg.meeting_id, tg.calendar_user, tg.want_sync, tg.cancelled, tg.invite]).toEqual([m.id, U.owner, true, false, []]);
    await db.query(`select google_mark_synced($1, $2, 'ev-1', $3, null, null)`, [m.id, tg.dirty_at, U.owner]);
    expect((await db.query(`select * from google_sync_targets()`)).rows).toEqual([]);
    // The owner moves it and asks for a Meet link: marked again.
    await ok(db, 'owner', `update project_meetings set starts_at = starts_at + interval '1 hour', ends_at = ends_at + interval '1 hour', google_meet = true, join_url = null, location = 'Iroda' where id = $1`, [m.id]);
    [tg] = (await db.query<Record<string, unknown>>(`select * from google_sync_targets()`)).rows;
    expect([tg.event_id, tg.want_meet, tg.invite]).toEqual(['ev-1', true, []]);
    await ok(db, 'owner', `update project_meetings set google_invite_clients = true where id = $1`, [m.id]);
    [tg] = (await db.query<Record<string, unknown>>(`select * from google_sync_targets()`)).rows;
    expect(tg.invite).toEqual(['anna@a.example']);
    await db.query(`select google_mark_synced($1, $2, 'ev-1', $3, 'https://meet.google.com/abc-defg-hij', null)`, [m.id, tg.dirty_at, U.owner]);
    const [row] = (await db.query<{ join_url: string; google_dirty_at: string | null }>(`select join_url, google_dirty_at from project_meetings where id = $1`, [m.id])).rows;
    expect(row).toEqual({ join_url: 'https://meet.google.com/abc-defg-hij', google_dirty_at: null });
    // Cancelled: still handed to the sync once, so the event is removed.
    await ok(db, 'owner', `update project_meetings set cancelled_at = now() where id = $1`, [m.id]);
    [tg] = (await db.query<Record<string, unknown>>(`select * from google_sync_targets()`)).rows;
    expect([tg.cancelled, tg.event_id]).toEqual([true, 'ev-1']);
    // An error keeps it marked, with the reason.
    await db.query(`select google_mark_synced($1, $2, null, null, null, 'calendar 403')`, [m.id, tg.dirty_at]);
    const [err] = (await db.query<{ google_error: string; google_dirty_at: string | null }>(`select google_error, google_dirty_at from project_meetings where id = $1`, [m.id])).rows;
    expect(err.google_error).toBe('calendar 403');
    expect(err.google_dirty_at).not.toBeNull();
  });
});

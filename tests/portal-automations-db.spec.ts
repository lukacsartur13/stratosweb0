import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

/**
 * Automations (20261015000100_automations.sql): the four rules, once per
 * cause, closing by themselves, the notifications, and who sees the alerts —
 * against real Postgres (PGlite). Same people and projects as
 * tests/portal-client-extras-db.spec.ts.
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



const run = async (db: PGlite, at?: string) => (await db.query<{ n: number }>(`select automation_run($1::timestamptz) as n`, [at ?? null])).rows[0].n;
const open = async (db: PGlite) => (await db.query<{ kind: string; title: string; detail: string | null }>(
  `select kind, title, detail from automation_alerts where done_at is null and resolved_at is null order by kind, title`)).rows;
const queued = async (db: PGlite) => (await db.query<{ kind: string; payload: Record<string, unknown> }>(
  `select kind, payload from notification_outbox where kind like 'auto_%' order by created_at, kind`)).rows;

test.describe('automations', () => {
  let db: PGlite;
  test.beforeAll(async () => {
    db = await fresh();
    // Other rules quiet unless a test wants them.
    await db.exec(`update portal_settings set auto_overdue_on = false, auto_deadline_on = false, auto_deal_on = false, auto_won_on = false`);
  });

  test('a new lead nobody answered for 24 hours raises one alert and one notification; a fresh or old one does not', async () => {
    await db.exec(`insert into leads (id, name, email, company, status, created_at) values
      ('${id(401)}', 'Kovács Anna', 'anna@x.example', 'Rapidkert', 'new', now() - interval '30 hours'),
      ('${id(402)}', 'Friss', 'f@x.example', null, 'new', now() - interval '2 hours'),
      ('${id(403)}', 'Régi', 'r@x.example', null, 'new', now() - interval '40 days'),
      ('${id(404)}', 'Válaszolt', 'v@x.example', null, 'contacted', now() - interval '30 hours')`);
    expect(await run(db)).toBe(1);
    expect(await open(db)).toEqual([{ kind: 'lead_unanswered', title: 'Kovács Anna', detail: 'Rapidkert' }]);
    expect(await run(db)).toBe(0); // once per cause
    const [q] = await queued(db);
    expect(q.kind).toBe('auto_lead_unanswered');
    expect([q.payload.title, q.payload.hours, q.payload.lead_id]).toEqual(['Kovács Anna', 24, id(401)]);
  });

  test('a logged call closes the lead alert by itself; the threshold comes from Settings', async () => {
    await db.exec(`insert into interactions (kind, summary, lead_id, occurred_at) values ('call', 'Felhívtam', '${id(401)}', now())`);
    await run(db);
    expect(await open(db)).toEqual([]);
    await db.exec(`update portal_settings set auto_lead_hours = 1`);
    expect(await run(db)).toBe(1); // "Friss" is now past the threshold
    await db.exec(`update leads set status = 'contacted' where id = '${id(402)}'`);
    await run(db);
    expect(await open(db)).toEqual([]);
    await db.exec(`update portal_settings set auto_lead_on = false; update portal_settings set auto_lead_on = true, auto_lead_hours = 24`);
  });

  test('a deal that has not moved for 14 days and has no future step is stalled; moving it closes the alert, a new stall raises a new one', async () => {
    await db.exec(`update portal_settings set auto_deal_on = true`);
    await db.exec(`insert into opportunities (id, title, company_name, stage, next_action_on, created_at, updated_at) values
      ('${id(501)}', 'Webshop', 'Kert Kft.', 'proposal', null, now() - interval '30 days', now() - interval '20 days'),
      ('${id(502)}', 'Logó', 'Ló Bt.', 'proposal', current_date + 5, now() - interval '30 days', now() - interval '20 days'),
      ('${id(503)}', 'SEO', 'Seo Kft.', 'proposal', null, now() - interval '30 days', now() - interval '3 days')`);
    expect(await run(db)).toBe(1);
    expect((await open(db)).map((a) => a.title)).toEqual(['Webshop']);
    await db.exec(`insert into interactions (kind, summary, opportunity_id, occurred_at) values ('email', 'Rákérdeztem', '${id(501)}', now())`);
    await run(db);
    expect(await open(db)).toEqual([]);
    // 20 days later it has stalled again: a new alert, keyed by the day it last moved
    // (and by then the other two have stalled as well: Logó's step is past, SEO is 23 days still).
    expect(await run(db, new Date(Date.now() + 20 * 864e5).toISOString())).toBe(3);
    expect((await db.query(`select count(*)::int as n from automation_alerts where opportunity_id = '${id(501)}'`)).rows[0]).toEqual({ n: 2 });
    await db.exec(`update portal_settings set auto_deal_on = false; update automation_alerts set done_at = now() where kind = 'deal_stale'`);
  });

  test('a won deal with no project raises an alert; creating the project closes it', async () => {
    await db.exec(`update portal_settings set auto_won_on = true`);
    await db.exec(`update opportunities set stage = 'won', organization_id = '${ORG.a}' where id = '${id(503)}'`);
    expect(await run(db)).toBe(1);
    expect((await open(db)).filter((a) => a.kind === 'deal_won').map((a) => a.title)).toEqual(['SEO']);
    await db.exec(`update projects set opportunity_id = '${id(503)}' where id = '${P.a2}'`);
    await run(db);
    expect((await open(db)).filter((a) => a.kind === 'deal_won')).toEqual([]);
    await db.exec(`update portal_settings set auto_won_on = false`);
  });

  test('an overdue instalment and a deadline within 3 days raise alerts; paying and closing end them', async () => {
    await db.exec(`update portal_settings set auto_overdue_on = true, auto_deadline_on = true`);
    await db.exec(`insert into project_instalments (id, project_id, label, amount, due_on) values ('${id(601)}', '${P.a1}', 'Előleg', 500000, current_date - 5)`);
    await db.exec(`update projects set target_date = current_date + 2 where id = '${P.b1}'`);
    const n = await run(db);
    expect(n).toBe(2);
    const kinds = Object.fromEntries((await open(db)).map((a) => [a.kind, a]));
    expect(kinds.instalment_overdue.title).toBe('A website');
    expect(kinds.deadline_soon.title).toBe('B brand');
    const q = (await queued(db)).filter((x) => x.kind === 'auto_instalment_overdue');
    expect([q[0].payload.amount, q[0].payload.currency]).toEqual([500000, 'HUF']);
    await db.exec(`insert into project_payments (instalment_id, project_id, amount, paid_on) values ('${id(601)}', '${P.a1}', 500000, current_date)`);
    await db.exec(`update projects set target_date = current_date + 30 where id = '${P.b1}'`);
    await run(db);
    expect(await open(db)).toEqual([]);
  });

  test('who sees the alerts: admins the lead and deal ones, project ones only the owner; only "done" can change', async () => {
    await db.exec(`update automation_alerts set resolved_at = null`);
    const seen = async (who: 'owner' | 'admin' | 'team' | 'a1') => (await as(db, who, `select kind from automation_alerts`)).rows.map((r) => r.kind as string);
    expect((await seen('owner')).sort()).toContain('instalment_overdue');
    const admin = await seen('admin');
    expect(admin.length).toBeGreaterThan(0);
    expect(admin.every((k) => ['lead_unanswered', 'deal_stale', 'deal_won'].includes(k))).toBe(true);
    expect(await seen('team')).toEqual([]);
    expect(await seen('a1')).toEqual([]);
    const [a] = await ok(db, 'admin', `select id from automation_alerts where kind = 'deal_stale' limit 1`);
    await ok(db, 'admin', `update automation_alerts set done_at = now() where id = $1`, [a.id]);
    const [row] = (await db.query(`select done_by from automation_alerts where id = $1`, [a.id])).rows as { done_by: string }[];
    expect(row.done_by).toBe(U.admin);
    expect((await as(db, 'admin', `update automation_alerts set title = 'x' where id = $1`, [a.id])).error?.message).toContain('alert_fixed');
    expect((await as(db, 'owner', `select automation_run()`)).error?.code).toBe('42501');
  });
});

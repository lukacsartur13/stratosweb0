import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

/**
 * The revenue report (20261016000100_revenue_report.sql): collected per month,
 * per client and service, the monthly fees, and the six-month forecast — on a
 * fixed day, against real Postgres (PGlite), every figure worked out by hand.
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




type Row = { section: string; month: string | null; key: string | null; label: string | null; currency: string; amount: string };
const day = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

test.describe('revenue report', () => {
  let db: PGlite;
  let rows: Row[];
  const pick = (section: string, key: string | null = null) => rows.filter((r) => r.section === section && (key === null || r.key === key))
    .map((r) => `${day(r.month)} ${r.label ?? r.key ?? ''} ${r.currency} ${Number(r.amount)}`.replace(/\s+/g, ' ').trim()).sort();

  test.beforeAll(async () => {
    db = await fresh();
    await db.exec(`
      update projects set service = 'Weboldal' where id = '${P.a1}';
      insert into projects (id, organization_id, name, slug, status, billing, monthly_fee, currency, start_date, service) values
        ('${id(204)}', '${ORG.a}', 'A havi', 'a-havi', 'active', 'monthly', 100000, 'HUF', '2026-07-01', 'SEO');
      insert into project_instalments (id, project_id, label, amount, due_on) values
        ('${id(601)}', '${P.a1}', 'Előleg', 500000, '2026-09-01'),
        ('${id(602)}', '${P.a1}', 'Végszámla', 1000000, '2026-11-20'),
        ('${id(603)}', '${id(204)}', 'Augusztus', 100000, '2026-08-01'),
        ('${id(604)}', '${id(204)}', 'November', 100000, '2026-11-05');
      insert into project_payments (instalment_id, project_id, amount, paid_on) values
        ('${id(601)}', '${P.a1}', 300000, '2026-09-05'),
        ('${id(603)}', '${id(204)}', 100000, '2026-08-03');
      insert into opportunities (title, company_name, stage, estimated_value, currency, probability, expected_close_on) values
        ('Webshop', 'Kert Kft.', 'proposal', 2000000, 'HUF', 50, '2026-12-10'),
        ('Dátum nélkül', 'X Kft.', 'proposal', 900000, 'HUF', 50, null);
    `);
    rows = (await ok(db, 'owner', `select * from portal_revenue_report('2026-10-15')`)) as unknown as Row[];
  });

  test('collected per month, per client and per service', () => {
    expect(pick('collected')).toEqual(['2026-08-01 HUF 100000', '2026-09-01 HUF 300000']);
    expect(pick('client')).toEqual(['2026-08-01 A Kft. HUF 100000', '2026-09-01 A Kft. HUF 300000']);
    expect(pick('service')).toEqual(['2026-08-01 SEO HUF 100000', '2026-09-01 Weboldal HUF 300000']);
  });

  test('the monthly fees of the contracts running in each month', () => {
    expect(pick('mrr')).toEqual(['2026-07-01 HUF 100000', '2026-08-01 HUF 100000', '2026-09-01 HUF 100000', '2026-10-01 HUF 100000']);
  });

  test('forecast: unpaid instalments (overdue counted now), fees not already scheduled, weighted deals with a date', () => {
    expect(pick('forecast', 'scheduled')).toEqual(['2026-10-01 scheduled HUF 200000', '2026-11-01 scheduled HUF 1100000']);
    expect(pick('forecast', 'monthly')).toEqual([
      '2026-10-01 monthly HUF 100000', '2026-12-01 monthly HUF 100000', '2027-01-01 monthly HUF 100000',
      '2027-02-01 monthly HUF 100000', '2027-03-01 monthly HUF 100000']);
    expect(pick('forecast', 'pipeline')).toEqual(['2026-12-01 pipeline HUF 1000000']);
  });

  test('an ended contract stops counting; a non-owner gets no money figures', async () => {
    await db.exec(`update projects set status = 'completed' where id = '${id(204)}'`);
    // Closing stamps completed_at (the database's own clock): the contract counts up to that month, not after.
    const [{ m }] = (await db.query<{ m: string }>(`select to_char(date_trunc('month', completed_at at time zone 'Europe/Budapest'), 'YYYY-MM-DD') as m from projects where id = '${id(204)}'`)).rows;
    const after = (await ok(db, 'owner', `select * from portal_revenue_report($1::date + 40)`, [m])) as unknown as Row[];
    const mrr = after.filter((r) => r.section === 'mrr').map((r) => day(r.month)).sort();
    expect(mrr[0]).toBe('2026-07-01');
    expect(mrr.at(-1)).toBe(m);
    expect(after.filter((r) => r.section === 'forecast' && r.key === 'monthly')).toEqual([]);
    const admin = (await ok(db, 'admin', `select * from portal_revenue_report('2026-10-15')`)) as unknown as Row[];
    expect(admin.filter((r) => r.section !== 'forecast' || r.key !== 'pipeline')).toEqual([]);
    expect((await as(db, 'anon', `select * from portal_revenue_report()`)).error?.code).toBe('42501');
  });
});

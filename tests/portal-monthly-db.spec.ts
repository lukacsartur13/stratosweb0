import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { monthlyTotals, monthsRunning } from '../portal/src/lib/pipeline';
import { hasScheduleMismatch, nextMonth } from '../portal/src/lib/paymentRules';

/**
 * Monthly contracts (20261006000100_monthly_contracts.sql) against a real
 * Postgres (PGlite): every migration applied verbatim, writes made as the owner
 * the way PostgREST makes them. Same harness and limits as
 * tests/portal-payments-db.spec.ts.
 */

test.describe.configure({ mode: 'serial' });

const ROOT = process.cwd();
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations');
const read = (file: string) => fs.readFileSync(path.join(MIGRATIONS, file), 'utf8');
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const U = { owner: id(1) } as const;
const ORG = id(101);
const P = { oneOff: id(201), monthly: id(202), legacy: id(203) };

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

const MONTHLY = '20261006000100_monthly_contracts.sql';

async function fresh() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(STANDIN);
  const files = fs.readdirSync(MIGRATIONS).filter((f) => /^\d+_[a-z_]+\.sql$/.test(f)).sort();
  for (const file of files.filter((f) => f <= '20260928000200_owner_tracker.sql')) await db.exec(read(file));
  await db.exec(`
    insert into auth.users (id, email) values ('${U.owner}', 'owner@example.invalid');
    insert into organizations (id, name, slug, status) values ('${ORG}', 'A Kft.', 'a', 'active');
    update profiles set role = 'super_admin' where id = '${U.owner}';
  `);
  await db.query(`select portal_set_owner('owner@example.invalid')`);
  for (const file of files.filter((f) => f > '20260928000200_owner_tracker.sql' && f < MONTHLY)) await db.exec(read(file));
  // A project that exists before the migration: it must come out one-off, untouched.
  await db.exec(`insert into projects (id, organization_id, name, slug, status, value, currency)
                 values ('${P.legacy}', '${ORG}', 'Legacy', 'legacy', 'active', 500000, 'HUF')`);
  for (const file of files.filter((f) => f >= MONTHLY)) await db.exec(read(file));
  return db;
}

type Result = { rows: Record<string, unknown>[]; error: null | { code?: string; message: string } };
async function owner(db: PGlite, sql: string, params: unknown[] = []): Promise<Result> {
  await db.query(`select set_config('request.jwt.claims', $1, false)`,
    [JSON.stringify({ sub: U.owner, role: 'authenticated' })]);
  await db.exec('set role authenticated');
  try {
    const r = await db.query<Record<string, unknown>>(sql, params);
    return { rows: r.rows, error: null };
  } catch (error) {
    const e = error as { code?: string; message: string };
    return { rows: [], error: { code: e.code, message: e.message } };
  } finally {
    await db.exec('reset role');
  }
}
const ok = async (db: PGlite, sql: string, params: unknown[] = []) => {
  const r = await owner(db, sql, params);
  if (r.error) throw new Error(r.error.message);
  return r.rows;
};

test.describe('monthly contracts are kept apart from one-off projects', () => {
  let db: PGlite;
  test.beforeAll(async () => { db = await fresh(); });

  test('an existing project is one-off, with its value untouched', async () => {
    const [r] = (await db.query<{ billing: string; monthly_fee: string | null; value: string }>(
      `select billing, monthly_fee, value from projects where id = $1`, [P.legacy])).rows;
    expect(r.billing).toBe('one_off');
    expect(r.monthly_fee).toBeNull();
    expect(Number(r.value)).toBe(500000);
  });

  test('the owner creates a monthly contract with a monthly fee, and the fee is logged', async () => {
    await ok(db, `insert into projects (id, organization_id, name, slug, status, currency, billing, monthly_fee, start_date)
                  values ($1, $2, 'Care', 'care', 'active', 'HUF', 'monthly', 150000, '2026-07-15')`, [P.monthly, ORG]);
    await ok(db, `insert into projects (id, organization_id, name, slug, status, value, currency)
                  values ($1, $2, 'Site', 'site', 'active', 900000, 'HUF')`, [P.oneOff, ORG]);
    await ok(db, `update projects set monthly_fee = 180000 where id = $1`, [P.monthly]);
    const log = await db.query<{ metadata: { from: unknown; to: unknown } }>(
      `select metadata from activity_logs where action = 'project.monthly_fee_changed' and entity_id = $1 order by created_at, id`,
      [P.monthly]);
    expect(log.rows.map((r) => [r.metadata.from === null ? null : Number(r.metadata.from), Number(r.metadata.to)]))
      .toEqual([[null, 150000], [150000, 180000]]);
  });

  test('the shape is enforced: a fee on monthly only, no one-off value, never Impact', async () => {
    const noFee = await owner(db, `insert into projects (organization_id, name, slug, currency, billing)
                                   values ($1, 'x', 'x1', 'HUF', 'monthly')`, [ORG]);
    expect(noFee.error?.message).toContain('projects_monthly_shape_check');
    const withValue = await owner(db, `update projects set value = 100 where id = $1`, [P.monthly]);
    expect(withValue.error?.message).toContain('projects_monthly_shape_check');
    const feeOnOneOff = await owner(db, `update projects set monthly_fee = 100 where id = $1`, [P.oneOff]);
    expect(feeOnOneOff.error?.message).toContain('projects_monthly_shape_check');
    const impact = await owner(db, `insert into projects (organization_id, name, slug, currency, billing, monthly_fee, program)
                                    values ($1, 'x', 'x2', 'HUF', 'monthly', 100, 'impact')`, [ORG]);
    expect(impact.error).not.toBeNull();
  });

  test('billing is fixed at creation, both ways', async () => {
    const r1 = await owner(db, `update projects set billing = 'one_off', monthly_fee = null where id = $1`, [P.monthly]);
    expect(r1.error?.message).toContain('stratos:project_billing_fixed');
    const r2 = await owner(db, `update projects set billing = 'monthly' where id = $1`, [P.oneOff]);
    expect(r2.error?.message).toContain('stratos:project_billing_fixed');
  });

  test('ending a monthly contract needs no checkpoint; a one-off close still does', async () => {
    const oneOff = await owner(db, `update projects set status = 'completed' where id = $1`, [P.oneOff]);
    expect(oneOff.error?.message).toContain('stratos:project_close_no_checkpoints');
    await ok(db, `update projects set status = 'completed' where id = $1`, [P.monthly]);
    const [r] = await ok(db, `select status::text, completed_at from projects where id = $1`, [P.monthly]);
    expect(r.status).toBe('completed');
    expect(r.completed_at).not.toBeNull();
    await ok(db, `update projects set status = 'active' where id = $1`, [P.monthly]);
    const [back] = await ok(db, `select completed_at from projects where id = $1`, [P.monthly]);
    expect(back.completed_at).toBeNull();
  });

  test('a monthly schedule is paid month by month and is never a "schedule ≠ contract"', async () => {
    const [i1] = await ok(db, `insert into project_instalments (project_id, label, amount, due_on)
                               values ($1, '2026. július', 180000, '2026-07-15') returning id`, [P.monthly]);
    await ok(db, `insert into project_instalments (project_id, label, amount, due_on)
                  values ($1, '2026. augusztus', 180000, '2026-08-15')`, [P.monthly]);
    await ok(db, `insert into project_payments (instalment_id, project_id, amount, paid_on)
                  values ($1, $2, 180000, '2026-07-20')`, [i1.id, P.monthly]);
    const [o] = await ok(db, `select * from project_payment_overview($1)`, [P.monthly]);
    expect(o.billing).toBe('monthly');
    expect(Number(o.monthly_fee)).toBe(180000);
    expect(o.contracted).toBeNull();
    expect(Number(o.scheduled)).toBe(360000);
    expect(Number(o.paid)).toBe(180000);
    expect(Number(o.remaining)).toBe(180000);
    expect(hasScheduleMismatch({
      instalments: Number(o.instalments), schedule_gap: null, contracted: null, billing: String(o.billing),
    })).toBe(false);
    // A one-off project without a contract value still is.
    expect(hasScheduleMismatch({ instalments: 1, schedule_gap: null, contracted: null, billing: 'one_off' })).toBe(true);
  });
});

test.describe('the monthly arithmetic', () => {
  test('monthly fees are totalled per currency, running contracts only', () => {
    const base = { archived_at: null, status: 'active' };
    expect(monthlyTotals([
      { ...base, billing: 'monthly', monthly_fee: 150000, currency: 'HUF' },
      { ...base, billing: 'monthly', monthly_fee: 99999.5, currency: 'HUF' },
      { ...base, billing: 'monthly', monthly_fee: 300, currency: 'EUR' },
      { ...base, billing: 'monthly', monthly_fee: 70000, currency: 'HUF', status: 'completed' },
      { ...base, billing: 'monthly', monthly_fee: 70000, currency: 'HUF', archived_at: '2026-01-01' },
      { ...base, billing: 'one_off', monthly_fee: null, currency: 'HUF' },
    ])).toEqual([
      { currency: 'HUF', total: 249999.5, contracts: 2 },
      { currency: 'EUR', total: 300, contracts: 1 },
    ]);
  });

  test('months running counts a begun month', () => {
    expect(monthsRunning(null, '2026-09-29')).toBeNull();
    expect(monthsRunning('2026-09-29', '2026-09-29')).toBe(1);
    expect(monthsRunning('2026-07-15', '2026-09-14')).toBe(2);
    expect(monthsRunning('2026-07-15', '2026-09-15')).toBe(3);
    expect(monthsRunning('2025-12-01', '2026-01-01')).toBe(2);
  });

  test('the next month keeps the day, clamps it, and crosses the year', () => {
    expect(nextMonth([], 150000, '2026-09-29')).toMatchObject({ amount: 150000, due_on: '2026-09-29' });
    expect(nextMonth(['2026-01-31', null], 1, '2026-09-29').due_on).toBe('2026-02-28');
    const dec = nextMonth(['2026-11-10', '2026-12-10'], 1, '2026-09-29');
    expect(dec.due_on).toBe('2027-01-10');
    expect(dec.label).toMatch(/2027/);
  });
});

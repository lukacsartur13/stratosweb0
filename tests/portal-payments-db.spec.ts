import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { derivedPaymentState, scheduleTotals, type Instalment, type Payment } from '../portal/src/lib/paymentRules';

/**
 * Phase 5 — the payment schedule, the carry-over of the single-sum figures, and
 * the atomic "next action done", against a real Postgres (PGlite, 18.3).
 *
 * PGLITE ONLY, ONE CONNECTION. Truly concurrent writes are exercised against a
 * real multi-connection Postgres by scripts/pg-concurrency-check.mjs.
 * `fresh()` applies every migration up to phase 4, writes projects carrying the
 * kinds of single-sum data production may hold, and only then applies phase 5 —
 * the same order as the release.
 */

test.describe.configure({ mode: 'serial' });

const ROOT = process.cwd();
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations');
const CHECKS = path.join(ROOT, 'supabase', 'checks');
const PHASE5 = '20261002000100_payment_schedule.sql';
const read = (dir: string, file: string) => fs.readFileSync(path.join(dir, file), 'utf8');
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const U = { owner: id(1), super2: id(2), admin: id(3), team: id(4), client: id(5) } as const;
const ORG = { a: id(101) };
// The legacy cases: what the single-sum fields may hold today.
const L = {
  clean: id(201),      // invoiced 1 000 000, paid 400 000, partially paid
  paidNoAmount: id(202), // "paid", no amount at all, a contract value
  stateOnly: id(203),  // "invoiced", no amount, no value
  overpaid: id(204),   // value 100 000, paid 150 000, "paid"
  contradicts: id(205), // "not invoiced" but 50 000 paid
  nothing: id(206),    // no payment data at all
  eur: id(207),        // EUR, fully paid
} as const;
const P = { fresh: id(301), other: id(302) };

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

const LEGACY = `
  insert into projects (id, organization_id, name, slug, status, value, currency, payment_state, invoiced_amount, paid_amount) values
    ('${L.clean}',        '${ORG.a}', 'Clean',        'clean',        'active',    1000000, 'HUF', 'partially_paid', 1000000, 400000),
    ('${L.paidNoAmount}', '${ORG.a}', 'Paid no sum',  'paid-no-sum',  'active',     800000, 'HUF', 'paid',           null,    null),
    ('${L.stateOnly}',    '${ORG.a}', 'State only',   'state-only',   'active',       null, 'HUF', 'invoiced',       null,    null),
    ('${L.overpaid}',     '${ORG.a}', 'Overpaid',     'overpaid',     'active',     100000, 'HUF', 'paid',           null,    150000),
    ('${L.contradicts}',  '${ORG.a}', 'Contradicts',  'contradicts',  'active',     300000, 'HUF', 'not_invoiced',   null,    50000),
    ('${L.nothing}',      '${ORG.a}', 'Nothing',      'nothing',      'active',     500000, 'HUF', 'not_invoiced',   null,    null),
    ('${L.eur}',          '${ORG.a}', 'Euro',         'euro',         'completed',    2000, 'EUR', 'paid',           2000,    2000);
`;

async function upToPhase4() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(STANDIN);
  const files = fs.readdirSync(MIGRATIONS).filter((f) => /^\d+_[a-z_]+\.sql$/.test(f)).sort();
  for (const file of files.filter((f) => f <= '20260928000200_owner_tracker.sql')) await db.exec(read(MIGRATIONS, file));
  await db.exec(`
    insert into auth.users (id, email) values
      ('${U.owner}', 'owner@example.invalid'), ('${U.super2}', 'super2@example.invalid'),
      ('${U.admin}', 'admin@example.invalid'), ('${U.team}', 'team@example.invalid'),
      ('${U.client}', 'client@a.example');
    insert into organizations (id, name, slug, status) values ('${ORG.a}', 'A Kft.', 'a', 'active');
    update profiles set role = 'super_admin' where id in ('${U.owner}', '${U.super2}');
    update profiles set role = 'admin' where id = '${U.admin}';
    update profiles set role = 'team_member' where id = '${U.team}';
    update profiles set organization_id = '${ORG.a}' where id = '${U.client}';
  `);
  await db.query(`select portal_set_owner('owner@example.invalid')`);
  for (const file of files.filter((f) => f > '20260928000200_owner_tracker.sql' && f < PHASE5)) {
    await db.exec(read(MIGRATIONS, file));
  }
  // The completed EUR project needs a done checkpoint to have been closed.
  await db.exec(LEGACY.replace(`'completed',    2000`, `'active',    2000`));
  await db.exec(`
    insert into project_milestones (project_id, title, position, state) values ('${L.eur}', 'Handover', 0, 'done');
    update projects set status = 'completed' where id = '${L.eur}';
    insert into projects (id, organization_id, name, slug, status, value, currency) values
      ('${P.fresh}', '${ORG.a}', 'Fresh', 'fresh', 'active', 1200000, 'HUF'),
      ('${P.other}', '${ORG.a}', 'Other', 'other', 'active', 900000, 'HUF');
    insert into project_milestones (project_id, title, position, state) values ('${P.fresh}', 'Handover', 0, 'done');
  `);
  return db;
}

async function fresh() {
  const db = await upToPhase4();
  await db.exec(read(MIGRATIONS, PHASE5));
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
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
async function overview(db: PGlite, project: string) {
  const [r] = await ok(db, 'owner', `select * from project_payment_overview($1)`, [project]);
  return Object.fromEntries(Object.entries(r).map(([k, v]) =>
    [k, ['contracted', 'scheduled', 'paid', 'remaining', 'overpaid', 'overdue', 'schedule_gap'].includes(k) ? num(v) : v]));
}
async function derived(db: PGlite, project: string) {
  const r = await db.query<{ payment_state: string; invoiced_amount: string | null; paid_amount: string | null }>(
    `select payment_state::text, invoiced_amount, paid_amount from projects where id = $1`, [project]);
  const x = r.rows[0];
  return { state: x.payment_state, invoiced: num(x.invoiced_amount), paid: num(x.paid_amount) };
}
const instalment = async (db: PGlite, project: string, amount: number, due: string, extra: Record<string, unknown> = {}) =>
  (await ok(db, 'owner', `insert into project_instalments (project_id, label, amount, due_on, invoiced) values ($1, $2, $3, $4, $5) returning id`,
    [project, extra.label ?? 'Part', amount, due, extra.invoiced ?? false]))[0].id as string;
const payment = (db: PGlite, who: Who, inst: string, project: string, amount: number, paidOn: string | null) =>
  as(db, who, `insert into project_payments (instalment_id, project_id, amount, paid_on) values ($1, $2, $3, $4) returning id`,
    [inst, project, amount, paidOn]);
const today = async (db: PGlite) => ((await db.query<{ d: string }>(`select portal_today()::text as d`)).rows[0].d);
const shift = (iso: string, days: number) => {
  const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10);
};

/* ========================================================= carry-over == */

test.describe('the single-sum figures are carried over without loss or invention', () => {
  let db: PGlite;
  test.beforeAll(async () => { db = await fresh(); });

  test('the snapshot keeps every original value verbatim, one row per project that had any', async () => {
    const r = await db.query<Record<string, unknown>>(`
      select project_id, payment_state, invoiced_amount, paid_amount, value, currency
      from project_finance_legacy order by project_name`);
    expect(r.rows.map((x) => x.project_id).sort()).toEqual(
      [L.clean, L.paidNoAmount, L.stateOnly, L.overpaid, L.contradicts, L.eur].sort());
    const clean = r.rows.find((x) => x.project_id === L.clean)!;
    expect([clean.payment_state, num(clean.invoiced_amount), num(clean.paid_amount), num(clean.value)])
      .toEqual(['partially_paid', 1000000, 400000, 1000000]);
    // Money received before equals money received after, per currency.
    const sums = await db.query<{ currency: string; before: string; after: string }>(`
      select l.currency, sum(coalesce(l.paid_amount, 0)) as before,
             coalesce(sum((select sum(x.amount) from project_payments x where x.project_id = l.project_id)), 0) as after
      from project_finance_legacy l group by l.currency order by 1`);
    for (const s of sums.rows) expect(num(s.after), s.currency).toBe(num(s.before));
  });

  test('no payment date is invented: every carried payment is undated, and flagged', async () => {
    const r = await db.query<{ n: number; dated: number }>(
      `select count(*)::int as n, count(paid_on)::int as dated from project_payments where origin = 'legacy'`);
    expect(r.rows[0]).toEqual({ n: 4, dated: 0 });
    const inst = await db.query<{ due: number }>(`select count(due_on)::int as due from project_instalments where origin = 'legacy'`);
    expect(inst.rows[0].due).toBe(0);
    expect((await overview(db, L.clean)).undated_payments).toBe(1);
  });

  test('a clean case is carried and reads exactly as before', async () => {
    const [l] = (await db.query<Record<string, unknown>>(`select * from project_finance_legacy where project_id = $1`, [L.clean])).rows;
    expect(l.outcome).toBe('carried');
    expect(l.issues).toEqual(['payment_date_unknown']);
    expect(await derived(db, L.clean)).toEqual({ state: 'partially_paid', invoiced: 1000000, paid: 400000 });
    expect(await overview(db, L.clean)).toMatchObject({ contracted: 1000000, scheduled: 1000000, paid: 400000, remaining: 600000, overdue: 0 });
  });

  test('doubtful cases are listed for review with what changed, never silently fixed', async () => {
    const r = await db.query<{ project_id: string; outcome: string; issues: string[]; derived_state: string }>(
      `select project_id, outcome, issues, derived_state from project_finance_legacy`);
    const by = Object.fromEntries(r.rows.map((x) => [x.project_id, x]));

    expect(by[L.paidNoAmount].outcome).toBe('review');
    expect(by[L.paidNoAmount].issues).toEqual(expect.arrayContaining([
      'marked_paid_without_amount', 'instalment_amount_from_contract_value', 'state_changed:paid->invoiced']));

    expect(by[L.stateOnly].issues).toEqual(expect.arrayContaining(['nothing_to_carry', 'state_changed:invoiced->not_invoiced']));
    expect((await db.query(`select 1 from project_instalments where project_id = $1`, [L.stateOnly])).rows).toHaveLength(0);

    expect(by[L.overpaid].issues).toEqual(expect.arrayContaining(['paid_exceeds_contract']));
    expect(await derived(db, L.overpaid)).toEqual({ state: 'paid', invoiced: 100000, paid: 150000 });
    // Over-payment is shown, not absorbed or cut.
    expect(await overview(db, L.overpaid)).toMatchObject({ paid: 150000, remaining: 0, overpaid: 50000 });

    expect(by[L.contradicts].issues).toEqual(expect.arrayContaining(['state_contradicts_amounts', 'state_changed:not_invoiced->partially_paid']));
    expect(by[L.eur]).toMatchObject({ outcome: 'carried', derived_state: 'paid' });
  });

  test('a project with no payment data, and every Impact project, is not touched', async () => {
    expect(await derived(db, L.nothing)).toEqual({ state: 'not_invoiced', invoiced: null, paid: null });
    expect((await db.query(`select 1 from project_finance_legacy where project_id = $1`, [L.nothing])).rows).toHaveLength(0);
  });

  test('every carried project is logged once', async () => {
    const r = await db.query<{ n: number }>(`select count(*)::int as n from activity_logs where action = 'project.finance_carried_over'`);
    expect(r.rows[0].n).toBe(6);
  });

  test('running the carry-over, or the whole migration, again adds nothing', async () => {
    const count = async () => (await db.query<{ i: number; p: number; l: number; a: number }>(`
      select (select count(*)::int from project_instalments) as i, (select count(*)::int from project_payments) as p,
             (select count(*)::int from project_finance_legacy) as l,
             (select count(*)::int from activity_logs where action = 'project.finance_carried_over') as a`)).rows[0];
    const before = await count();
    expect((await db.query(`select * from payment_carry_over()`)).rows[0]).toEqual({ carried: 0, review: 0 });
    await db.exec(read(MIGRATIONS, PHASE5));
    expect(await count()).toEqual(before);
    expect(await derived(db, L.clean)).toEqual({ state: 'partially_paid', invoiced: 1000000, paid: 400000 });
  });

  test('the owner can mark a doubtful row reviewed, and change nothing else in it', async () => {
    const r = await as(db, 'owner', `update project_finance_legacy set reviewed_at = now() where project_id = $1 returning reviewed_by`, [L.paidNoAmount]);
    expect(r.rows[0].reviewed_by).toBe(U.owner);
    const bad = await as(db, 'owner', `update project_finance_legacy set paid_amount = 1 where project_id = $1`, [L.paidNoAmount]);
    expect(bad.error?.message).toContain('stratos:payment_legacy_fixed');
    for (const who of ['super2', 'admin', 'team', 'client'] as const) {
      expect((await as(db, who, `update project_finance_legacy set reviewed_at = null`)).affected, who).toBe(0);
    }
  });
});

test.describe('the migration refuses to run where it would do harm', () => {
  test('without a designated owner', async () => {
    const db = await upToPhase4();
    await db.exec(`delete from portal_owner`);
    await expect(db.exec(read(MIGRATIONS, PHASE5))).rejects.toThrow(/No portal owner/);
    // Nothing of phase 5 was left behind.
    expect((await db.query(`select to_regclass('public.project_instalments') as t`)).rows[0]).toEqual({ t: null });
  });
});

/* ============================================================ the rules == */

test.describe('a schedule: instalments, payments, and what is derived from them', () => {
  let db: PGlite;
  let t: string;
  test.beforeAll(async () => { db = await fresh(); t = await today(db); });

  test('invoicing and paying move the state; nothing is set by hand', async () => {
    expect(await derived(db, P.fresh)).toEqual({ state: 'not_invoiced', invoiced: null, paid: null });
    const first = await instalment(db, P.fresh, 400000, shift(t, -10), { label: 'Előleg' });
    const second = await instalment(db, P.fresh, 800000, shift(t, 30), { label: 'Végszámla' });
    expect(await derived(db, P.fresh)).toEqual({ state: 'not_invoiced', invoiced: null, paid: null });

    await ok(db, 'owner', `update project_instalments set invoiced = true, invoiced_on = $2 where id = $1`, [first, shift(t, -12)]);
    expect(await derived(db, P.fresh)).toEqual({ state: 'invoiced', invoiced: 400000, paid: null });

    // Two partial payments against one instalment.
    expect((await payment(db, 'owner', first, P.fresh, 150000, shift(t, -5))).error).toBeNull();
    expect(await derived(db, P.fresh)).toMatchObject({ state: 'partially_paid', paid: 150000 });
    expect(await overview(db, P.fresh)).toMatchObject({
      contracted: 1200000, scheduled: 1200000, paid: 150000, remaining: 1050000, overdue: 250000, schedule_gap: 0,
    });
    expect((await payment(db, 'owner', first, P.fresh, 250000, t)).error).toBeNull();
    expect(await overview(db, P.fresh)).toMatchObject({ paid: 400000, remaining: 800000, overdue: 0 });

    expect((await payment(db, 'owner', second, P.fresh, 800000, t)).error).toBeNull();
    expect(await derived(db, P.fresh)).toMatchObject({ state: 'paid', paid: 1200000 });
  });

  test('an over-payment is kept and shown; overdue never exceeds what is still owed', async () => {
    const a = await instalment(db, P.other, 500000, shift(t, -20));
    const b = await instalment(db, P.other, 400000, shift(t, -1));
    expect((await payment(db, 'owner', a, P.other, 700000, shift(t, -2))).error).toBeNull();
    const [row] = await ok(db, 'owner', `select sum(amount) as s from project_payments where instalment_id = $1`, [a]);
    expect(num(row.s)).toBe(700000);
    // b is 400 000 short and late, but only 200 000 is still owed on the project.
    expect(await overview(db, P.other)).toMatchObject({ paid: 700000, remaining: 200000, overpaid: 0, overdue: 200000 });
    expect(b).toBeTruthy();
  });

  test('a schedule that does not add up to the contract is flagged, both ways', async () => {
    await ok(db, 'owner', `update projects set value = 1000000 where id = $1`, [P.other]);
    expect((await overview(db, P.other)).schedule_gap).toBe(-100000);
    await ok(db, 'owner', `update projects set value = 800000 where id = $1`, [P.other]);
    expect((await overview(db, P.other)).schedule_gap).toBe(100000);
    // Changing the contract value re-derives the state.
    await ok(db, 'owner', `update projects set value = 700000 where id = $1`, [P.other]);
    expect((await derived(db, P.other)).state).toBe('paid');
    await ok(db, 'owner', `update projects set value = 900000 where id = $1`, [P.other]);
    expect((await derived(db, P.other)).state).toBe('partially_paid');
  });

  test('the old single-sum columns cannot be edited against the schedule — sending back what was read is fine', async () => {
    for (const [sql, what] of [
      [`update projects set paid_amount = 1 where id = $1`, 'paid'],
      [`update projects set invoiced_amount = 5 where id = $1`, 'invoiced'],
      [`update projects set payment_state = 'paid' where id = $1`, 'state'],
    ] as const) {
      const r = await as(db, 'owner', sql, [P.other]);
      expect(r.error?.message, what).toContain('stratos:payment_derived');
    }
    // The old Portal's edit form: every field sent back unchanged, name edited.
    const d = await derived(db, P.other);
    const r = await as(db, 'owner', `update projects set name = 'Other 2', payment_state = $2, invoiced_amount = $3, paid_amount = $4 where id = $1`,
      [P.other, d.state, d.invoiced, d.paid]);
    expect(r.error).toBeNull();
    // A new project cannot be created claiming money either.
    const ins = await as(db, 'owner', `insert into projects (organization_id, name, slug, status, paid_amount) values ($1, 'x', 'x-paid', 'active', 10)`, [ORG.a]);
    expect(ins.error?.message).toContain('stratos:payment_derived');
  });

  test('a payment needs a real date, not in the future; carried-over rows cannot be forged', async () => {
    const [i] = await ok(db, 'owner', `select id from project_instalments where project_id = $1 limit 1`, [P.other]);
    expect((await payment(db, 'owner', i.id as string, P.other, 1, null)).error?.code).toBe('23514');
    expect((await payment(db, 'owner', i.id as string, P.other, 1, shift(t, 2))).error?.message).toContain('stratos:payment_future_date');
    expect((await payment(db, 'owner', i.id as string, P.other, 0, t)).error?.code).toBe('23514');
    expect((await payment(db, 'owner', i.id as string, P.other, -5, t)).error?.code).toBe('23514');
    const forged = await as(db, 'owner', `insert into project_payments (instalment_id, project_id, amount, paid_on, origin) values ($1, $2, 1, null, 'legacy')`,
      [i.id, P.other]);
    expect(forged.error?.message).toContain('stratos:payment_origin_fixed');
    const noDue = await as(db, 'owner', `insert into project_instalments (project_id, label, amount) values ($1, 'x', 5)`, [P.other]);
    expect(noDue.error?.code).toBe('23514');
  });

  test('a carried-over payment can be dated later, but a dated one cannot lose its date', async () => {
    const [p] = await ok(db, 'owner', `select id from project_payments where project_id = $1 and origin = 'legacy'`, [L.clean]);
    expect((await as(db, 'owner', `update project_payments set paid_on = $2 where id = $1`, [p.id, shift(t, -100)])).error).toBeNull();
    const r = await as(db, 'owner', `update project_payments set paid_on = null where id = $1`, [p.id]);
    expect(r.error?.message).toContain('stratos:payment_date_required');
  });

  test('a payment cannot be put on another project\'s instalment, nor moved to another project', async () => {
    const [i] = await ok(db, 'owner', `select id from project_instalments where project_id = $1 limit 1`, [P.fresh]);
    const cross = await payment(db, 'owner', i.id as string, P.other, 10, t);
    expect(cross.error?.code).toBe('23503');
    const [p] = await ok(db, 'owner', `select id from project_payments where project_id = $1 limit 1`, [P.fresh]);
    const moved = await as(db, 'owner', `update project_payments set project_id = $2 where id = $1`, [p.id, P.other]);
    expect(moved.error).not.toBeNull();
  });

  test('the currency is fixed once there is a schedule', async () => {
    const r = await as(db, 'owner', `update projects set currency = 'EUR' where id = $1`, [P.other]);
    expect(r.error?.message).toContain('stratos:payment_currency_fixed');
    expect((await as(db, 'owner', `update projects set currency = 'EUR' where id = $1`, [L.nothing])).error).toBeNull();
    await ok(db, 'owner', `update projects set currency = 'HUF' where id = $1`, [L.nothing]);
  });

  test('closing is independent: a closed project takes payments, and still shows what is owed', async () => {
    const [pr] = await ok(db, 'owner', `update projects set status = 'completed' where id = $1 returning status::text`, [P.fresh]);
    expect(pr.status).toBe('completed');
    const [i] = await ok(db, 'owner', `select id from project_instalments where project_id = $1 order by due_on limit 1`, [P.fresh]);
    // P.fresh is fully paid; add a later extra instalment on the closed project and pay part of it.
    const extra = await instalment(db, P.fresh, 100000, shift(t, -3), { label: 'Extra' });
    expect(await overview(db, P.fresh)).toMatchObject({ scheduled: 1300000, schedule_gap: 100000 });
    expect((await payment(db, 'owner', extra, P.fresh, 40000, t)).error).toBeNull();
    expect(await overview(db, P.fresh)).toMatchObject({ status: 'completed', paid: 1240000 });
    // An unpaid project can be closed (the close rule never reads payment).
    const [other] = await ok(db, 'owner', `select remaining from project_payment_overview($1)`, [P.other]);
    expect(num(other.remaining)).toBeGreaterThan(0);
    await ok(db, 'owner', `insert into project_milestones (project_id, title, position, state) values ($1, 'Done', 0, 'done')`, [P.other]);
    expect((await as(db, 'owner', `update projects set status = 'completed' where id = $1`, [P.other])).error).toBeNull();
    expect(i).toBeTruthy();
  });

  test('an instalment with payments cannot be deleted; a payment can, and it is logged', async () => {
    const [i] = await ok(db, 'owner', `select instalment_id, id, amount from project_payments where project_id = $1 limit 1`, [P.other]);
    const del = await as(db, 'owner', `delete from project_instalments where id = $1`, [i.instalment_id]);
    expect(del.error?.code).toBe('23001'); // restrict_violation: ON DELETE RESTRICT
    const before = await derived(db, P.other);
    expect((await as(db, 'owner', `delete from project_payments where id = $1`, [i.id])).affected).toBe(1);
    const after = await derived(db, P.other);
    expect(after.paid ?? 0).toBe((before.paid ?? 0) - Number(i.amount));
    const log = await db.query<{ action: string; metadata: Record<string, unknown> }>(
      `select action, metadata from activity_logs where entity_id = $1 and action like 'project.payment%' order by created_at`, [P.other]);
    expect(log.rows.map((x) => x.action)).toEqual(expect.arrayContaining(['project.payment_added', 'project.payment_removed']));
    expect(log.rows.find((x) => x.action === 'project.payment_removed')!.metadata.amount).toBeDefined();
  });

  test('every change to an instalment or payment is logged old → new', async () => {
    const [i] = await ok(db, 'owner', `select id from project_instalments where project_id = $1 order by due_on limit 1`, [P.other]);
    await ok(db, 'owner', `update project_instalments set amount = 450000, due_on = due_on + 1 where id = $1`, [i.id]);
    const [log] = (await db.query<{ metadata: Record<string, { from: unknown; to: unknown }> }>(
      `select metadata from activity_logs where action = 'project.instalment_changed' and entity_id = $1 order by created_at desc limit 1`, [P.other])).rows;
    expect(Number(log.metadata.amount.from)).toBe(500000);
    expect(Number(log.metadata.amount.to)).toBe(450000);
    expect(log.metadata.due_on).toBeDefined();
    // A position-only change is not an event.
    const n = async () => (await db.query<{ n: number }>(`select count(*)::int as n from activity_logs where action = 'project.instalment_changed'`)).rows[0].n;
    const before = await n();
    await ok(db, 'owner', `update project_instalments set position = 5 where id = $1`, [i.id]);
    expect(await n()).toBe(before);
  });
});

test.describe('an Impact project has no schedule and takes no client payment — by any path', () => {
  let db: PGlite;
  let impact: string;
  test.beforeAll(async () => {
    db = await fresh();
    await db.exec(`
      insert into leads (id, name, email, form_type, source, status) values
        ('${id(901)}', 'Impact applicant', 'imp@example.invalid', 'impact', 'impact', 'new');
    `);
    await db.exec(`update impact_applications set status = 'accepted' where lead_id = '${id(901)}'`);
    const [app] = (await db.query<{ id: string }>(`select id from impact_applications where lead_id = '${id(901)}'`)).rows;
    const [r] = await ok(db, 'owner',
      `select impact_start_project($1, null, 'Tanoda', 'tanoda', null, 'Tanoda web', 'tanoda-web', 'Website', array['Handover']) as id`, [app.id]);
    impact = r.id as string;
  });

  test('owner and superuser alike are refused an instalment', async () => {
    const r = await as(db, 'owner', `insert into project_instalments (project_id, label, amount, due_on) values ($1, 'x', 10, current_date)`, [impact]);
    expect(r.error?.message).toContain('stratos:payment_impact_free');
    await expect(db.query(`insert into project_instalments (project_id, label, amount, due_on) values ($1, 'x', 10, current_date)`, [impact]))
      .rejects.toThrow(/payment_impact_free/);
  });

  test('its derived columns stay "free", and it is not in the payment overview', async () => {
    expect(await derived(db, impact)).toEqual({ state: 'not_invoiced', invoiced: null, paid: null });
    expect(await ok(db, 'owner', `select * from project_payment_overview($1)`, [impact])).toEqual([]);
  });

  test('internal costs are still recordable on it', async () => {
    const r = await as(db, 'owner', `insert into project_costs (project_id, description, category, amount, currency) values ($1, 'Stock photos', 'other', 5000, 'HUF')`, [impact]);
    expect(r.error).toBeNull();
  });
});

/* ============================================= the two implementations == */

test.describe('the Portal\'s arithmetic equals the database\'s', () => {
  test('200 random schedules: every figure and the derived state agree', async () => {
    const db = await fresh();
    const t = await today(db);
    // A seeded generator, so a failure is reproducible.
    let seed = 20261002;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const money = () => Math.round(rnd() * 500000) / 100 + 0.01;
    for (let n = 0; n < 200; n += 1) {
      const pid = id(10000 + n);
      const value = rnd() < 0.2 ? null : money() * 3;
      await db.query(`insert into projects (id, organization_id, name, slug, status, value, currency) values ($1, $2, $3, $3, 'active', $4, 'HUF')`,
        [pid, ORG.a, `r${n}`, value]);
      const insts: Instalment[] = [];
      const pays: Payment[] = [];
      for (let k = 0, m = Math.floor(rnd() * 4); k < m; k += 1) {
        const due = shift(t, Math.floor(rnd() * 60) - 30);
        const amount = money();
        const invoiced = rnd() < 0.5;
        const [row] = await ok(db, 'owner', `insert into project_instalments (project_id, label, amount, due_on, invoiced) values ($1, 'x', $2, $3, $4) returning id`,
          [pid, amount, due, invoiced]);
        insts.push({ id: row.id as string, project_id: pid, label: 'x', amount, due_on: due, invoiced, invoiced_on: null, note: null, position: 0, origin: 'manual' });
        for (let j = 0, q = Math.floor(rnd() * 3); j < q; j += 1) {
          const a = rnd() < 0.15 ? amount * 1.5 : money() / 2;
          const on = shift(t, -Math.floor(rnd() * 20));
          const [pr] = await ok(db, 'owner', `insert into project_payments (instalment_id, project_id, amount, paid_on) values ($1, $2, round($3::numeric, 2), $4) returning id, amount`,
            [row.id, pid, a, on]);
          pays.push({ id: pr.id as string, instalment_id: row.id as string, project_id: pid, amount: Number(pr.amount), paid_on: on, note: null, origin: 'manual', created_at: '' });
        }
      }
      const ts = scheduleTotals(value, insts, pays, t);
      const sql = await overview(db, pid);
      expect({ scheduled: sql.scheduled, paid: sql.paid, remaining: sql.remaining, overpaid: sql.overpaid, overdue: sql.overdue, gap: sql.schedule_gap }, `project ${n}`)
        .toEqual({ scheduled: ts.scheduled, paid: ts.paid, remaining: ts.remaining, overpaid: ts.overpaid, overdue: ts.overdue, gap: ts.scheduleGap });
      expect((await derived(db, pid)).state, `state ${n}`).toBe(derivedPaymentState(value, insts, pays));
    }
  });
});

/* =============================================================== access == */

test.describe('the schedule is the owner\'s alone', () => {
  let db: PGlite;
  let inst: string;
  test.beforeAll(async () => {
    db = await fresh();
    inst = await instalment(db, P.fresh, 1000, '2026-01-01');
  });

  for (const who of ['super2', 'admin', 'team', 'client', 'anon'] as const) {
    test(`${who}: reads nothing, writes nothing, learns nothing`, async () => {
      for (const t of ['project_instalments', 'project_payments', 'project_finance_legacy']) {
        const r = await as(db, who, `select * from ${t}`);
        if (who === 'anon') expect(r.error?.code, t).toBe('42501');
        else expect(r.rows, t).toEqual([]);
      }
      const ins = await as(db, who, `insert into project_instalments (project_id, label, amount, due_on) values ($1, 'x', 10, current_date)`, [P.fresh]);
      expect(ins.error, 'insert instalment').not.toBeNull();
      const pay = await payment(db, who, inst, P.fresh, 10, '2026-01-02');
      expect(pay.error, 'insert payment').not.toBeNull();
      const upd = await as(db, who, `update project_instalments set amount = 1 where id = $1`, [inst]);
      expect(upd.affected + (upd.error ? 0 : 0), 'update').toBe(0);
      const del = await as(db, who, `delete from project_instalments where id = $1`, [inst]);
      expect(del.affected, 'delete').toBe(0);
      const ov = await as(db, who, `select * from project_payment_overview()`);
      if (who === 'anon') expect(ov.error?.code).toBe('42501');
      else expect(ov.rows).toEqual([]);
      const carry = await as(db, who, `select * from payment_carry_over()`);
      expect(carry.error?.code).toBe('42501');
    });
  }

  test('a second super_admin is not the owner: nothing', async () => {
    expect((await as(db, 'super2', `select count(*)::int as n from project_payments`)).rows[0].n).toBe(0);
  });

  test('no definer function reads the schedule, and there are still no views', async () => {
    const r = await db.query<{ proname: string }>(`
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef and p.prorettype <> 'trigger'::regtype
        and p.prosrc ~* '\\m(project_instalments|project_payments|project_finance_legacy)\\M'`);
    expect(r.rows).toEqual([]);
    expect((await db.query(`select table_name from information_schema.views where table_schema = 'public'`)).rows).toEqual([]);
  });
});

/* ======================================================== Sales: done == */

test.describe('"next action done" is one transaction, and idempotent', () => {
  let db: PGlite;
  const deal = id(701);
  test.beforeAll(async () => {
    db = await fresh();
    await db.exec(`
      insert into opportunities (id, title, company_name, stage, next_action, next_action_on, estimated_value, currency)
      values ('${deal}', 'Deal', 'Deal Kft.', 'proposal', 'Send the offer', '2026-01-01', 100000, 'HUF');
    `);
  });
  const notes = async () => (await db.query<{ body: string }>(
    `select body from record_notes where entity_type = 'opportunity' and entity_id = $1`, [deal])).rows.map((r) => r.body);
  const action = async () => (await db.query<{ next_action: string | null; next_action_on: string | null }>(
    `select next_action, next_action_on::text from opportunities where id = $1`, [deal])).rows[0];

  test('a refused save writes neither the note nor the clear', async () => {
    const r = await as(db, 'team', `select opportunity_complete_action($1, 'Send the offer') as done`, [deal]);
    // team_member may read deals but not change them: nothing happens.
    expect(r.error === null ? r.rows[0].done : false).toBe(false);
    expect(await notes()).toEqual([]);
    expect(await action()).toEqual({ next_action: 'Send the offer', next_action_on: '2026-01-01' });
    expect((await as(db, 'anon', `select opportunity_complete_action($1, 'Send the offer')`, [deal])).error?.code).toBe('42501');
  });

  test('a stale screen (another action by now) changes nothing', async () => {
    expect((await ok(db, 'admin', `select opportunity_complete_action($1, 'Something else') as done`, [deal]))[0].done).toBe(false);
    expect(await notes()).toEqual([]);
  });

  test('success: one note, the action cleared; a retry or double click adds nothing', async () => {
    expect((await ok(db, 'admin', `select opportunity_complete_action($1, 'Send the offer') as done`, [deal]))[0].done).toBe(true);
    expect(await notes()).toEqual(['Done: Send the offer (due 2026-01-01)']);
    expect(await action()).toEqual({ next_action: null, next_action_on: null });
    expect((await ok(db, 'admin', `select opportunity_complete_action($1, 'Send the offer') as done`, [deal]))[0].done).toBe(false);
    expect(await notes()).toHaveLength(1);
  });

  test('if the note cannot be written, the action is not cleared either', async () => {
    await db.exec(`update opportunities set next_action = 'Call', next_action_on = null where id = '${deal}'`);
    await db.exec(`alter table record_notes add constraint zz_block check (body <> 'Done: Call')`);
    const r = await as(db, 'admin', `select opportunity_complete_action($1, 'Call')`, [deal]);
    expect(r.error).not.toBeNull();
    expect(await action()).toEqual({ next_action: 'Call', next_action_on: null });
    await db.exec(`alter table record_notes drop constraint zz_block`);
    expect((await ok(db, 'admin', `select opportunity_complete_action($1, 'Call') as done`, [deal]))[0].done).toBe(true);
    expect((await notes()).filter((b) => b.startsWith('Done: Call'))).toEqual(['Done: Call']);
  });
});

/* ===================================================== verify, rollback == */

test.describe('the SQL-editor checks and the rollback', () => {
  test('verify: every row ok on a correct database, and it creates nothing', async () => {
    const db = await fresh();
    await db.exec(read(CHECKS, 'payment-schedule-verify.sql').replace(/rollback;\s*$/, ''));
    const rows = (await db.query<{ check_name: string; ok: boolean; detail: string | null }>(`select check_name, ok, detail from verify_result`)).rows;
    const counts = (await db.query<{ n: number }>(`select count(*)::int as n from project_instalments`)).rows[0].n;
    await db.exec('rollback');
    expect(rows.length).toBeGreaterThan(10);
    expect(rows.filter((r) => !r.ok)).toEqual([]);
    // It wrote nothing that outlives it.
    expect((await db.query<{ n: number }>(`select count(*)::int as n from project_instalments`)).rows[0].n).toBe(counts);
  });

  test('rollback keeps every instalment, payment and snapshot, and re-applying restores the rules', async () => {
    const db = await fresh();
    const inst = await instalment(db, P.fresh, 1000, '2026-01-01');
    await payment(db, 'owner', inst, P.fresh, 500, '2026-01-02');
    const count = async () => (await db.query<{ i: number; p: number; l: number }>(`
      select (select count(*)::int from project_instalments) as i, (select count(*)::int from project_payments) as p,
             (select count(*)::int from project_finance_legacy) as l`)).rows[0];
    const before = await count();
    await db.exec(read(CHECKS, 'payment-schedule-rollback.sql'));
    expect(await count()).toEqual(before);
    // The single-sum columns are editable again, and still hold the derived values.
    expect(await derived(db, P.fresh)).toMatchObject({ paid: 500 });
    expect((await as(db, 'owner', `select * from project_instalments`)).error?.code).toBe('42501');
    await db.exec(read(MIGRATIONS, PHASE5));
    expect(await count()).toEqual(before);
    expect((await as(db, 'owner', `update projects set paid_amount = 1 where id = $1`, [P.fresh])).error?.message)
      .toContain('stratos:payment_derived');
  });
});

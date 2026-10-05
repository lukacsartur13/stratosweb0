import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

/**
 * The Trash (20261007000100_trash.sql) against a real Postgres (PGlite): every
 * migration applied verbatim, every call made as PostgREST makes it
 * (`set role authenticated` + `request.jwt.claims`). Same harness and limits as
 * tests/portal-client-db.spec.ts.
 */

test.describe.configure({ mode: 'serial' });

const ROOT = process.cwd();
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations');
const read = (file: string) => fs.readFileSync(path.join(MIGRATIONS, file), 'utf8');
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const U = { owner: id(1), admin: id(3), team: id(4), anna: id(5) } as const;
const ORG = { a: id(101), empty: id(102) };
const P = { plain: id(201), closed: id(202), paid: id(203), shared: id(204), monthly: id(205) };
const L = { plain: id(401), impact: id(402), withDeal: id(403) };
const DEAL = id(501);
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

async function fresh() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(STANDIN);
  const files = fs.readdirSync(MIGRATIONS).filter((f) => /^\d+_[a-z_]+\.sql$/.test(f)).sort();
  for (const file of files.filter((f) => f <= '20260928000200_owner_tracker.sql')) await db.exec(read(file));
  await db.exec(`
    insert into auth.users (id, email) values
      ('${U.owner}', 'owner@example.invalid'), ('${U.admin}', 'admin@example.invalid'),
      ('${U.team}', 'team@example.invalid'), ('${U.anna}', 'anna@a.example');
    insert into organizations (id, name, slug, status) values
      ('${ORG.a}', 'A Kft.', 'a', 'active'), ('${ORG.empty}', 'Empty Kft.', 'empty', 'active');
    update profiles set role = 'super_admin' where id = '${U.owner}';
    update profiles set role = 'admin' where id = '${U.admin}';
    update profiles set role = 'team_member' where id = '${U.team}';
  `);
  await db.query(`select portal_set_owner('owner@example.invalid')`);
  for (const file of files.filter((f) => f > '20260928000200_owner_tracker.sql')) await db.exec(read(file));
  await db.exec(`
    insert into projects (id, organization_id, name, slug, status, value, currency) values
      ('${P.plain}',  '${ORG.a}', 'Plain',  'plain',  'active', 100000, 'HUF'),
      ('${P.closed}', '${ORG.a}', 'Closed', 'closed', 'active', 100000, 'HUF'),
      ('${P.paid}',   '${ORG.a}', 'Paid',   'paid',   'active', 100000, 'HUF'),
      ('${P.shared}', '${ORG.a}', 'Shared', 'shared', 'active', 100000, 'HUF');
    insert into projects (id, organization_id, name, slug, status, currency, billing, monthly_fee) values
      ('${P.monthly}', '${ORG.a}', 'Monthly', 'monthly', 'active', 'HUF', 'monthly', 50000);
    insert into project_milestones (project_id, title, position, state) values
      ('${P.plain}', 'Build', 0, 'in_progress'), ('${P.closed}', 'Handover', 0, 'done');
    update projects set status = 'completed' where id = '${P.closed}';
    insert into project_costs (project_id, description, category, amount, currency, incurred_on)
      values ('${P.plain}', 'Font', 'software', 1000, 'HUF', '2026-09-01');
    insert into record_notes (entity_type, entity_id, author_id, body) values
      ('project', '${P.plain}', '${U.admin}', 'Someone else''s note'), ('client', '${ORG.empty}', '${U.admin}', 'A note');
    insert into project_instalments (project_id, label, amount, due_on) values ('${P.paid}', 'Előleg', 50000, '2026-09-01');
    insert into leads (id, name, email, status, form_type, source) values
      ('${L.plain}', 'Kiss Péter', 'peter@example.invalid', 'new', 'contact', 'website'),
      ('${L.impact}', 'Nagy Éva', 'eva@example.invalid', 'new', 'impact', 'impact'),
      ('${L.withDeal}', 'Tóth Ádám', 'adam@example.invalid', 'qualified', 'contact', 'website');
    insert into opportunities (id, title, company_name, lead_id, stage, currency) values ('${DEAL}', 'Deal', 'Tóth Bt.', '${L.withDeal}', 'discovery', 'HUF');
  `);
  return db;
}

type Result = { rows: Record<string, unknown>[]; error: null | { code?: string; message: string; detail?: string } };
async function as(db: PGlite, who: Who, sql: string, params: unknown[] = []): Promise<Result> {
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: U[who], role: 'authenticated' })]);
  await db.exec('set role authenticated');
  try {
    const r = await db.query<Record<string, unknown>>(sql, params);
    return { rows: r.rows, error: null };
  } catch (error) {
    const e = error as { code?: string; message: string; detail?: string };
    return { rows: [], error: { code: e.code, message: e.message, detail: e.detail } };
  } finally {
    await db.exec('reset role');
  }
}
const ok = async (db: PGlite, who: Who, sql: string, params: unknown[] = []) => {
  const r = await as(db, who, sql, params);
  if (r.error) throw new Error(`${who}: ${r.error.message}`);
  return r.rows;
};
const exists = async (db: PGlite, table: string, rowId: string) =>
  (await db.query<{ n: number }>(`select count(*)::int as n from ${table} where id = $1`, [rowId])).rows[0].n === 1;

test.describe('projects', () => {
  let db: PGlite;
  test.beforeAll(async () => { db = await fresh(); });

  test('a project not in the Trash cannot be deleted', async () => {
    const r = await as(db, 'owner', `select purge_project($1)`, [P.plain]);
    expect(r.error?.message).toContain('stratos:purge_not_trashed');
    expect(await exists(db, 'projects', P.plain)).toBe(true);
  });

  test('trash, restore, trash again — then delete takes its checkpoints, costs and every note with it', async () => {
    await ok(db, 'owner', `update projects set archived_at = now() where id = $1`, [P.plain]);
    await ok(db, 'owner', `update projects set archived_at = null where id = $1`, [P.plain]);
    expect(await exists(db, 'projects', P.plain)).toBe(true);
    await ok(db, 'owner', `update projects set archived_at = now() where id = $1`, [P.plain]);
    expect(await ok(db, 'owner', `select project_purge_blockers($1) as b`, [P.plain])).toEqual([{ b: [] }]);
    await ok(db, 'owner', `select purge_project($1)`, [P.plain]);
    expect(await exists(db, 'projects', P.plain)).toBe(false);
    const left = await db.query<{ n: number }>(`
      select (select count(*) from project_milestones where project_id = $1)
           + (select count(*) from project_costs where project_id = $1)
           + (select count(*) from record_notes where entity_type = 'project' and entity_id = $1) as n`, [P.plain]);
    expect(Number(left.rows[0].n)).toBe(0);
    const log = await db.query<{ metadata: { name: string } }>(
      `select metadata from activity_logs where action = 'project.deleted' and entity_id = $1`, [P.plain]);
    expect(log.rows[0].metadata.name).toBe('Plain');
  });

  test('a closed project and a monthly contract can be deleted too', async () => {
    for (const p of [P.closed, P.monthly]) {
      await ok(db, 'owner', `update projects set archived_at = now() where id = $1`, [p]);
      await ok(db, 'owner', `select purge_project($1)`, [p]);
      expect(await exists(db, 'projects', p)).toBe(false);
    }
  });

  test('money blocks the delete, and the refusal names it', async () => {
    await ok(db, 'owner', `update projects set archived_at = now() where id = $1`, [P.paid]);
    const r = await as(db, 'owner', `select purge_project($1)`, [P.paid]);
    expect(r.error?.message).toContain('stratos:purge_blocked');
    expect(r.error?.detail).toContain('1 instalment(s) in the payment schedule');
    expect(await exists(db, 'projects', P.paid)).toBe(true);
  });

  test('only the owner may delete or read the blockers', async () => {
    for (const who of ['admin', 'team'] as const) {
      const r = await as(db, who, `select purge_project($1)`, [P.paid]);
      expect(r.error?.message, who).toContain('stratos:purge_forbidden');
      expect(await ok(db, who, `select project_purge_blockers($1) as b`, [P.paid])).toEqual([{ b: null }]);
    }
  });

  test('a project in the Trash is hidden from its client, and comes back on restore', async () => {
    const [acct] = await ok(db, 'owner', `select * from client_invite_prepare($1, null, 'Anna', 'anna@a.example', $2::uuid[])`,
      [ORG.a, [P.shared]]);
    await ok(db, 'owner', `select client_invite_attach($1, $2)`, [acct.account_id, U.anna]);
    const sees = async () => (await ok(db, 'anna', `select project_id from client_portal_projects()`)).map((r) => r.project_id);
    const has = async () => (await ok(db, 'anna', `select client_has_project($1) as h`, [P.shared]))[0].h;
    expect(await sees()).toEqual([P.shared]);
    expect(await has()).toBe(true);
    await ok(db, 'owner', `update projects set archived_at = now() where id = $1`, [P.shared]);
    expect(await sees()).toEqual([]);
    expect(await has()).toBe(false);
    const r = await as(db, 'owner', `select purge_project($1)`, [P.shared]);
    expect(r.error?.detail).toContain('client portal access');
    await ok(db, 'owner', `update projects set archived_at = null where id = $1`, [P.shared]);
    expect(await sees()).toEqual([P.shared]);
  });
});

test.describe('clients', () => {
  let db: PGlite;
  test.beforeAll(async () => { db = await fresh(); });

  test('a client with projects is blocked; an empty one is deleted with its contacts and notes', async () => {
    await ok(db, 'owner', `update organizations set archived_at = now() where id in ($1, $2)`, [ORG.a, ORG.empty]);
    const r = await as(db, 'owner', `select purge_client($1)`, [ORG.a]);
    expect(r.error?.detail).toContain('project(s)');
    await db.exec(`insert into client_contacts (organization_id, name) values ('${ORG.empty}', 'Someone')`);
    await ok(db, 'owner', `select purge_client($1)`, [ORG.empty]);
    expect(await exists(db, 'organizations', ORG.empty)).toBe(false);
    const left = await db.query<{ n: number }>(`
      select (select count(*) from client_contacts where organization_id = $1)
           + (select count(*) from record_notes where entity_type = 'client' and entity_id = $1) as n`, [ORG.empty]);
    expect(Number(left.rows[0].n)).toBe(0);
  });

  test('an admin may trash a client but not delete one', async () => {
    const r = await as(db, 'admin', `select purge_client($1)`, [ORG.a]);
    expect(r.error?.message).toContain('stratos:purge_forbidden');
  });
});

test.describe('leads', () => {
  let db: PGlite;
  test.beforeAll(async () => { db = await fresh(); });

  test('a lead in the Trash leaves the attribution; deleting it keeps the deal, unlinked', async () => {
    const count = async () => (await ok(db, 'admin', `select sum(leads)::int as n from portal_revenue_attribution('source')`))[0].n;
    const before = await count();
    await ok(db, 'admin', `update leads set trashed_at = now() where id in ($1, $2)`, [L.plain, L.withDeal]);
    expect(await count()).toBe(before - 2);
    for (const l of [L.plain, L.withDeal]) await ok(db, 'admin', `select purge_lead($1)`, [l]);
    expect(await exists(db, 'leads', L.plain)).toBe(false);
    const [deal] = (await db.query<{ lead_id: string | null }>(`select lead_id from opportunities where id = $1`, [DEAL])).rows;
    expect(deal.lead_id).toBeNull();
    const log = await db.query<{ metadata: Record<string, unknown> }>(`select metadata from activity_logs where action = 'lead.deleted'`);
    expect(JSON.stringify(log.rows)).not.toMatch(/Kiss|peter@|Tóth|adam@/);
  });

  test('an Impact lead: only the owner deletes it, and its application goes with it', async () => {
    await ok(db, 'admin', `update leads set trashed_at = now() where id = $1`, [L.impact]);
    const a = await as(db, 'admin', `select purge_lead($1)`, [L.impact]);
    expect(a.error?.message).toContain('stratos:purge_forbidden');
    const t = await as(db, 'team', `select purge_lead($1)`, [L.impact]);
    expect(t.error?.message).toContain('stratos:purge_forbidden');
    expect(await exists(db, 'leads', L.impact)).toBe(true);
    await ok(db, 'owner', `select purge_lead($1)`, [L.impact]);
    expect(await exists(db, 'leads', L.impact)).toBe(false);
    const apps = await db.query<{ n: number }>(`select count(*)::int as n from impact_applications where lead_id = $1`, [L.impact]);
    expect(apps.rows[0].n).toBe(0);
  });
});

test.describe('Impact without an application', () => {
  let db: PGlite;
  test.beforeAll(async () => { db = await fresh(); });

  test('the owner creates a direct Impact project; one without an application is still refused', async () => {
    await ok(db, 'owner', `insert into projects (organization_id, name, slug, program, impact_direct, status, currency)
                           values ($1, 'Direct', 'direct', 'impact', true, 'planned', 'HUF')`, [ORG.a]);
    const bare = await as(db, 'owner', `insert into projects (organization_id, name, slug, program, status, currency)
                                         values ($1, 'Bare', 'bare', 'impact', 'planned', 'HUF')`, [ORG.a]);
    expect(bare.error?.message).toContain('stratos:impact_project_without_application');
    const paid = await as(db, 'owner', `insert into projects (organization_id, name, slug, impact_direct, currency)
                                         values ($1, 'Paid', 'paid-direct', true, 'HUF')`, [ORG.a]);
    expect(paid.error?.message).toContain('projects_impact_direct_check');
  });

  test('deleting the lead of a started application keeps the project, as a direct one', async () => {
    const [app] = await ok(db, 'owner', `select id from impact_applications where lead_id = $1`, [L.impact]);
    await ok(db, 'owner', `update impact_applications set status = 'accepted' where id = $1`, [app.id]);
    const [{ p }] = await ok(db, 'owner', `select impact_start_project($1, $2, null, null, null, 'Started', 'started', null, '{}') as p`,
      [app.id, ORG.a]);
    await ok(db, 'owner', `update projects set archived_at = now() where id = $1`, [p]);
    const blocked = await as(db, 'owner', `select purge_project($1)`, [p]);
    expect(blocked.error?.detail).toContain('Impact application');
    await ok(db, 'owner', `update leads set trashed_at = now() where id = $1`, [L.impact]);
    await ok(db, 'owner', `select purge_lead($1)`, [L.impact]);
    const [proj] = (await db.query<{ impact_direct: boolean }>(`select impact_direct from projects where id = $1`, [p])).rows;
    expect(proj.impact_direct).toBe(true);
    await ok(db, 'owner', `update projects set archived_at = now() where id = $1`, [p]);
    await ok(db, 'owner', `select purge_project($1)`, [p]);
    expect(await exists(db, 'projects', p as string)).toBe(false);
  });
});

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

/**
 * The Impact pipeline and Impact projects, against a real Postgres (PGlite).
 *
 * Same harness and the same limits as tests/portal-owner-db.spec.ts: every
 * migration is applied verbatim and every policy is exercised the way
 * PostgREST exercises it (`set role authenticated` + `request.jwt.claims`), but
 * this is NOT Supabase — no PostgREST, no GoTrue, a stand-in `auth` schema, and
 * the migrations run as a superuser. What the hosted project does is what
 * supabase/checks/impact-preflight.sql and impact-verify.sql are for.
 *
 * One thing a single PGlite connection cannot do is run two transactions at
 * once, so "a double click creates one project" is proven sequentially (the
 * second call returns the first call's project). The row lock that serialises
 * truly concurrent calls is in the function and is NOT exercised here.
 */

// The tests inside each describe build on one another (accept → start → value
// → close → reopen), so they must run in order on one database.
test.describe.configure({ mode: 'serial' });

const ROOT = process.cwd();
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations');
const CHECKS = path.join(ROOT, 'supabase', 'checks');
const read = (dir: string, file: string) => fs.readFileSync(path.join(dir, file), 'utf8');

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const U = {
  owner: id(1), super2: id(2), admin: id(3), team: id(4), clientA: id(5), clientB: id(6),
} as const;
const ORG = { a: id(101), b: id(102) };
const PAID = { active: id(201), other: id(202) };
const LEAD = {
  impactNew: id(401), impactLegacy: id(402), impactConflict: id(403), contact: id(404),
  ambiguous: id(405), impactSpam: id(406), impactProposal: id(407),
};
const CONFLICT_DEAL = id(301);
const CONFLICT_PROJECT = id(203);

type Who = keyof typeof U | 'anon';
const OTHERS: Who[] = ['super2', 'admin', 'team', 'clientA', 'clientB', 'anon'];

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
`;

const IMPACT_FILES = [
  '20260929000100_project_links_url_check.sql',
  '20260929000200_impact_enums.sql',
  '20260929000300_impact_program.sql',
];

const PHASE1 = () => fs.readdirSync(MIGRATIONS)
  .filter((f) => /^\d+_[a-z_]+\.sql$/.test(f) && f <= '20260928000200_owner_tracker.sql')
  .sort();

const IMPACT_PAYLOAD = JSON.stringify({
  org: 'Zöld Kör Egyesület', kapcs: 'Kiss Anna', mail: 'anna@zoldkor.example',
  terulet: 'Környezetvédelem', mivel: 'Faültetés', hatas: '12 000 fa', miert: 'Láthatóság',
});

/** The world as it was before Impact existed: phase 1 applied, legacy leads, one conflict. */
async function fresh({ impact = true } = {}) {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(STANDIN);
  for (const file of PHASE1()) await db.exec(read(MIGRATIONS, file));
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
      ('${PAID.active}', '${ORG.a}', 'A website', 'a-website', 'active', 1500000, 'HUF', 500000),
      ('${PAID.other}', '${ORG.b}', 'B ads', 'b-ads', 'active', 400000, 'HUF', null);
    insert into project_milestones (project_id, title, position, state) values
      ('${PAID.active}', 'Design', 0, 'done'), ('${PAID.active}', 'Build', 1, 'in_progress');

    -- Legacy leads, as production may hold them.
    insert into leads (id, name, company, email, form_type, source, status, payload, message, created_at, meta) values
      ('${LEAD.impactNew}', 'Kiss Anna', 'Zöld Kör Egyesület', 'anna@zoldkor.example', 'impact', 'impact', 'new',
        '${IMPACT_PAYLOAD}'::jsonb, 'Tevékenységi terület: Környezetvédelem', '2026-09-01', '{"utmSource":"newsletter"}'),
      ('${LEAD.impactLegacy}', 'Nagy Béla', 'Régi Alapítvány', 'bela@example.invalid', null, 'impact', 'contacted',
        '{}'::jsonb, 'pre-envelope', '2026-07-01', '{"utmSource":"newsletter"}'),
      ('${LEAD.impactConflict}', 'Tóth Cili', 'Konflikt Egyesület', 'cili@example.invalid', 'impact', 'impact', 'won',
        '{}'::jsonb, null, '2026-08-01', '{}'),
      ('${LEAD.contact}', 'Paid Person', 'Paid Kft.', 'paid@example.invalid', 'contact', 'contact', 'qualified',
        '{}'::jsonb, null, '2026-09-02', '{"utmSource":"newsletter"}'),
      ('${LEAD.ambiguous}', 'Maybe', 'Maybe Kft.', 'maybe@example.invalid', null, 'website', 'new',
        '{}'::jsonb, null, '2026-06-01', '{}'),
      ('${LEAD.impactSpam}', 'Bot', null, 'bot@example.invalid', 'impact', 'impact', 'spam',
        '{}'::jsonb, null, '2026-09-03', '{}'),
      ('${LEAD.impactProposal}', 'Szabó Dóra', 'Tanoda Egyesület', 'dora@example.invalid', 'impact', 'impact', 'proposal',
        '{}'::jsonb, null, '2026-09-04', '{}');
    update leads set service_interest = 'Impact Program' where id = '${LEAD.ambiguous}';

    -- The conflict: an Impact lead somebody already sold, with a paid project.
    insert into opportunities (id, title, company_name, stage, estimated_value, lead_id, form_type)
      values ('${CONFLICT_DEAL}', 'Konflikt website', 'Konflikt Egyesület', 'won', 900000, '${LEAD.impactConflict}', 'impact');
    insert into projects (id, organization_id, name, slug, status, value, currency, opportunity_id)
      values ('${CONFLICT_PROJECT}', '${ORG.b}', 'Konflikt website', 'konflikt', 'active', 900000, 'HUF', '${CONFLICT_DEAL}');
  `);
  await db.query(`select portal_set_owner('owner@example.invalid')`);
  await db.exec(read(MIGRATIONS, '20260928000300_owner_lockdown.sql'));
  if (impact) for (const file of IMPACT_FILES) await db.exec(read(MIGRATIONS, file));
  return db;
}

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
    await db.query(`select set_config('request.jwt.claims', '{}', false)`);
  }
}

const count = async (db: PGlite, who: Who, table: string, where = 'true') => {
  const r = await as(db, who, `select count(*)::int as n from ${table} where ${where}`);
  return r.error ? `error ${r.error.code}` : (r.rows[0].n as number);
};

const one = async <T = Record<string, unknown>>(db: PGlite, sql: string) =>
  (await db.query<T>(sql)).rows[0];

const appFor = (db: PGlite, lead: string) => one<{ id: string; status: string; origin: string;
  legacy_lead_status: string | null; project_id: string | null }>(db,
  `select id, status::text, origin, legacy_lead_status, project_id from impact_applications where lead_id = '${lead}'`);

const START = `select impact_start_project($1, $2, $3, $4, $5, $6, $7, $8, $9) as id`;
const startArgs = (app: string, o: {
  org?: string | null; clientName?: string; clientSlug?: string; name?: string; slug?: string; steps?: string[];
} = {}) => [
  app, o.org ?? null, o.clientName ?? 'Zöld Kör Egyesület', o.clientSlug ?? 'zold-kor-egyesulet', 'zoldkor.example',
  o.name ?? 'Zöld Kör weboldal', o.slug ?? 'zold-kor-weboldal', 'Website', o.steps ?? ['Discovery', 'Build', 'Handover'],
];

const summary = async (db: PGlite, who: Who = 'owner') =>
  (await as(db, who, `select committed::int, committed_projects::int, committed_missing::int,
    delivered::int, delivered_projects::int, cancelled_projects::int from impact_support_summary()`)).rows[0];

/* ============================================ backfill and capture ===== */

test.describe('existing Impact leads are brought across safely', () => {
  let db: PGlite;
  test.beforeAll(async () => { db = await fresh(); });

  test('each Impact lead gets one application, its status mapped and the original kept', async () => {
    expect(await appFor(db, LEAD.impactNew)).toMatchObject({ status: 'applied', origin: 'backfill', legacy_lead_status: 'new' });
    expect(await appFor(db, LEAD.impactLegacy)).toMatchObject({ status: 'review', legacy_lead_status: 'contacted' });
    expect(await appFor(db, LEAD.impactProposal)).toMatchObject({ status: 'consultation', legacy_lead_status: 'proposal' });
    expect(await appFor(db, LEAD.impactSpam)).toMatchObject({ status: 'rejected', legacy_lead_status: 'spam' });
    // The lead itself is untouched: status, answers and contact exactly as stored.
    expect(await one(db, `select status::text, payload->>'hatas' as hatas, email from leads where id = '${LEAD.impactNew}'`))
      .toEqual({ status: 'new', hatas: '12 000 fa', email: 'anna@zoldkor.example' });
    // An application's date is the submission's date.
    expect(await one(db, `select (a.created_at = l.created_at) as same from impact_applications a
      join leads l on l.id = a.lead_id where a.lead_id = '${LEAD.impactLegacy}'`)).toEqual({ same: true });
  });

  test('an Impact lead that was already sold is a conflict: not captured, not changed, not deleted', async () => {
    expect(await appFor(db, LEAD.impactConflict)).toBeUndefined();
    expect(await one(db, `select stage::text, estimated_value::int as v from opportunities where id = '${CONFLICT_DEAL}'`))
      .toEqual({ stage: 'won', v: 900000 });
    expect(await one(db, `select program, value::int as v from projects where id = '${CONFLICT_PROJECT}'`))
      .toEqual({ program: 'paid', v: 900000 });
    const conflicts = await as(db, 'owner', 'select lead_id, opportunity_id, project_ids from impact_legacy_conflicts()');
    expect(conflicts.rows).toEqual([
      { lead_id: LEAD.impactConflict, opportunity_id: CONFLICT_DEAL, project_ids: [CONFLICT_PROJECT] },
    ]);
  });

  test('paid and ambiguous leads are left alone', async () => {
    expect(await appFor(db, LEAD.contact)).toBeUndefined();
    // service_interest says "Impact Program" but no recorded fact says the form did.
    expect(await appFor(db, LEAD.ambiguous)).toBeUndefined();
  });

  test('reprocessing is duplicate-free: the sync and the whole migration can run again', async () => {
    const before = await one(db, 'select count(*)::int as n from impact_applications');
    expect(await one(db, 'select captured, conflicts from impact_sync_applications()')).toEqual({ captured: 0, conflicts: 1 });
    await db.exec(read(MIGRATIONS, '20260929000300_impact_program.sql'));
    await db.exec(read(MIGRATIONS, '20260929000100_project_links_url_check.sql'));
    expect(await one(db, 'select count(*)::int as n from impact_applications')).toEqual(before);
  });
});

test.describe('a new Impact submission lands in the pipeline at insert time', () => {
  let db: PGlite;
  test.beforeAll(async () => { db = await fresh(); });

  const submit = (sub: string, form = 'impact') => db.query(
    `insert into leads (name, email, form_type, source, submission_id, payload)
     values ('Új Jelentkező', 'uj@example.invalid', $1, $1, $2, '{"org":"Új Egyesület"}') returning id`, [form, sub]);

  test('the service-key insert creates exactly one application', async () => {
    const lead = (await submit(id(900))).rows[0] as { id: string };
    expect(await appFor(db, lead.id)).toMatchObject({ status: 'applied', origin: 'form', project_id: null });
  });

  test('a replayed submission stays one lead and one application', async () => {
    await expect(submit(id(900))).rejects.toThrow(/leads_submission_id_key/);
    expect(await one(db, `select count(*)::int as n from impact_applications a join leads l on l.id = a.lead_id
      where l.submission_id = '${id(900)}'`)).toEqual({ n: 1 });
    expect(await one(db, 'select captured from impact_sync_applications()')).toEqual({ captured: 0 });
  });

  test('a contact submission creates no application', async () => {
    const lead = (await submit(id(901), 'contact')).rows[0] as { id: string };
    expect(await appFor(db, lead.id)).toBeUndefined();
  });

  test('if the capture fails, the lead is still stored and the sync repairs it', async () => {
    // Simulate a capture that cannot write (e.g. an owner without BYPASSRLS).
    await db.exec(`alter table impact_applications add constraint sim_fail check (origin <> 'form') not valid`);
    const lead = (await submit(id(902))).rows[0] as { id: string };
    expect(await one(db, `select count(*)::int as n from leads where id = '${lead.id}'`)).toEqual({ n: 1 });
    expect(await appFor(db, lead.id)).toBeUndefined();
    await db.exec('alter table impact_applications drop constraint sim_fail');
    expect(await one(db, 'select captured from impact_sync_applications()')).toEqual({ captured: 1 });
    expect(await appFor(db, lead.id)).toMatchObject({ status: 'applied', origin: 'backfill' });
  });

  test('a lead cannot be relabelled into or out of Impact', async () => {
    for (const [lead, to] of [[LEAD.impactNew, 'contact'], [LEAD.contact, 'impact']]) {
      const r = await as(db, 'admin', `update leads set form_type = $2, source = $2 where id = $1`, [lead, to]);
      expect(r.error?.message, `${lead} → ${to}`).toContain('stratos:lead_program_fixed');
    }
    // Other edits to an Impact lead are unaffected.
    const ok = await as(db, 'admin', `update leads set status = 'contacted' where id = $1`, [LEAD.impactNew]);
    expect(ok.error).toBeNull();
  });
});

/* ======================================================== the wall ===== */

test.describe('an Impact application can never become a paid deal', () => {
  let db: PGlite;
  test.beforeAll(async () => { db = await fresh(); });

  test('no role, and no direct write, can create an opportunity from an Impact lead', async () => {
    for (const who of ['admin', 'owner', 'super2'] as Who[]) {
      const r = await as(db, who, `insert into opportunities (title, company_name, lead_id) values ('x', 'x', $1)`,
        [LEAD.impactNew]);
      expect(r.error?.message, who).toContain('stratos:impact_not_sellable');
      const labelled = await as(db, who, `insert into opportunities (title, company_name, form_type) values ('x', 'x', 'impact')`);
      expect(labelled.error?.message, who).toContain('stratos:impact_not_sellable');
    }
    // The table editor / service key path too.
    await expect(db.query(`insert into opportunities (title, company_name, lead_id) values ('x', 'x', '${LEAD.impactLegacy}')`))
      .rejects.toThrow(/stratos:impact_not_sellable/);
    expect(await one(db, `select count(*)::int as n from opportunities`)).toEqual({ n: 1 });
  });

  test('an existing deal cannot be re-pointed at an Impact lead', async () => {
    const paid = await as(db, 'admin', `insert into opportunities (title, company_name, lead_id)
      values ('Paid deal', 'Paid Kft.', $1) returning id`, [LEAD.contact]);
    expect(paid.error).toBeNull();
    const r = await as(db, 'admin', `update opportunities set lead_id = $2 where id = $1`,
      [paid.rows[0].id, LEAD.impactNew]);
    expect(r.error?.message).toContain('stratos:impact_not_sellable');
  });

  test('the legacy conflict keeps working as the paid deal it already is', async () => {
    const r = await as(db, 'admin', `update opportunities set next_action = 'Call' where id = $1`, [CONFLICT_DEAL]);
    expect(r.error).toBeNull();
    expect(r.affected).toBe(1);
  });

  test('no project can be inserted as Impact outside the start function', async () => {
    const r = await as(db, 'owner', `insert into projects (organization_id, name, slug, program, status)
      values ($1, 'Sneaky', 'sneaky', 'impact', 'planned')`, [ORG.a]);
    expect(r.error?.message).toContain('stratos:impact_project_without_application');
  });

  test('a paid project cannot become Impact, and carries no market value', async () => {
    const flip = await as(db, 'owner', `update projects set program = 'impact' where id = $1`, [PAID.other]);
    expect(flip.error?.message).toContain('stratos:project_program_fixed');
    const mv = await as(db, 'owner', `update projects set market_value = 1 where id = $1`, [PAID.other]);
    expect(mv.error?.code).toBe('23514');
  });
});

/* ================================================ starting a project == */

test.describe('starting an Impact project from an accepted application', () => {
  let db: PGlite;
  let app: string;
  test.beforeAll(async () => {
    db = await fresh();
    app = (await appFor(db, LEAD.impactNew)).id;
  });

  test('only an accepted application can start one', async () => {
    const r = await as(db, 'owner', START, startArgs(app));
    expect(r.error?.message).toContain('stratos:impact_not_accepted');
    const moved = await as(db, 'owner', `update impact_applications set status = 'accepted' where id = $1`, [app]);
    expect(moved.error).toBeNull();
  });

  test('"project started" cannot be set by hand', async () => {
    const r = await as(db, 'owner', `update impact_applications set status = 'project_started' where id = $1`, [app]);
    expect(r.error?.code).toBe('23514');
  });

  test('a failure leaves nothing behind — no client, no project, no link', async () => {
    const before = await one(db, `select (select count(*) from organizations)::int as orgs,
      (select count(*) from projects)::int as projects, (select count(*) from project_milestones)::int as steps`);
    // The new client's slug collides with an existing one: the whole call rolls back.
    const r = await as(db, 'owner', START, startArgs(app, { clientSlug: 'client-a' }));
    expect(r.error?.code).toBe('23505');
    expect(await one(db, `select (select count(*) from organizations)::int as orgs,
      (select count(*) from projects)::int as projects, (select count(*) from project_milestones)::int as steps`))
      .toEqual(before);
    expect(await appFor(db, LEAD.impactNew)).toMatchObject({ status: 'accepted', project_id: null });
  });

  test('one call creates the client, the project and its checkpoints, and marks the application', async () => {
    const r = await as(db, 'owner', START, startArgs(app));
    expect(r.error).toBeNull();
    const project = r.rows[0].id as string;
    expect(await one(db, `select program, status::text, value, payment_state::text, market_value, currency
      from projects where id = '${project}'`)).toEqual({
      program: 'impact', status: 'planned', value: null, payment_state: 'not_invoiced', market_value: null, currency: 'HUF',
    });
    expect((await db.query(`select title from project_milestones where project_id = '${project}' order by position`)).rows)
      .toEqual([{ title: 'Discovery' }, { title: 'Build' }, { title: 'Handover' }]);
    expect(await appFor(db, LEAD.impactNew)).toMatchObject({ status: 'project_started', project_id: project });
    expect(await one(db, `select o.name, o.acquisition_source, (select count(*)::int from profiles p where p.organization_id = o.id) as logins
      from organizations o join projects p on p.organization_id = o.id where p.id = '${project}'`))
      .toEqual({ name: 'Zöld Kör Egyesület', acquisition_source: 'impact', logins: 0 });
  });

  test('a double click or a retry returns the same project and creates nothing', async () => {
    const before = await one(db, `select (select count(*) from organizations)::int as orgs,
      (select count(*) from projects)::int as projects`);
    const first = await appFor(db, LEAD.impactNew);
    for (let i = 0; i < 3; i += 1) {
      const r = await as(db, 'owner', START, startArgs(app, { clientSlug: `other-${i}`, slug: `other-${i}` }));
      expect(r.error).toBeNull();
      expect(r.rows[0].id).toBe(first.project_id);
    }
    expect(await one(db, `select (select count(*) from organizations)::int as orgs,
      (select count(*) from projects)::int as projects`)).toEqual(before);
  });

  test('once started, the application is fixed', async () => {
    const back = await as(db, 'owner', `update impact_applications set status = 'accepted' where id = $1`, [app]);
    expect(back.error?.message).toMatch(/stratos:impact_application_started|impact_applications_started_check/);
    const note = await as(db, 'owner', `update impact_applications set decision_note = 'Great fit' where id = $1`, [app]);
    expect(note.error).toBeNull();
  });

  test('an existing client can be attached instead of creating one', async () => {
    const other = (await appFor(db, LEAD.impactProposal)).id;
    await as(db, 'owner', `update impact_applications set status = 'accepted' where id = $1`, [other]);
    const orgs = await one(db, 'select count(*)::int as n from organizations');
    const r = await as(db, 'owner', START, startArgs(other, { org: ORG.b, name: 'Tanoda', slug: 'tanoda', steps: [] }));
    expect(r.error).toBeNull();
    expect(await one(db, 'select count(*)::int as n from organizations')).toEqual(orgs);
    expect(await one(db, `select organization_id from projects where id = '${r.rows[0].id}'`)).toEqual({ organization_id: ORG.b });
  });

  test('nobody but the owner can start one', async () => {
    const other = (await appFor(db, LEAD.impactLegacy)).id;
    await as(db, 'owner', `update impact_applications set status = 'accepted' where id = $1`, [other]);
    for (const who of OTHERS) {
      const r = await as(db, who, START, startArgs(other, { clientSlug: `x-${who}`, slug: `x-${who}` }));
      expect(r.error?.code, who).toBe('42501');
    }
    expect(await appFor(db, LEAD.impactLegacy)).toMatchObject({ status: 'accepted', project_id: null });
  });
});

/* ================================= free, market value, close, counters == */

test.describe('an Impact project is free, and its market value drives the counters', () => {
  let db: PGlite;
  let project: string;
  let second: string;
  test.beforeAll(async () => {
    db = await fresh();
    for (const lead of [LEAD.impactNew, LEAD.impactProposal]) {
      await db.exec(`update impact_applications set status = 'accepted' where lead_id = '${lead}'`);
    }
    const a = (await appFor(db, LEAD.impactNew)).id;
    const b = (await appFor(db, LEAD.impactProposal)).id;
    project = (await as(db, 'owner', START, startArgs(a))).rows[0].id as string;
    second = (await as(db, 'owner', START, startArgs(b, { clientSlug: 'tanoda', name: 'Tanoda', slug: 'tanoda' }))).rows[0].id as string;
  });

  test('no fee, invoice, payment or sale can be put on it — internal costs can', async () => {
    for (const [sql, why] of [
      [`update projects set value = 100 where id = $1`, 'fee'],
      [`update projects set invoiced_amount = 1 where id = $1`, 'invoiced'],
      [`update projects set paid_amount = 1 where id = $1`, 'paid'],
      [`update projects set payment_state = 'partially_paid' where id = $1`, 'payment state'],
      [`update projects set opportunity_id = '${CONFLICT_DEAL}' where id = $1`, 'opportunity'],
      [`update projects set currency = 'EUR' where id = $1`, 'currency'],
      [`update projects set market_value = -1 where id = $1`, 'negative market value'],
      [`update projects set status = 'discovery' where id = $1`, 'legacy phase'],
    ]) {
      const r = await as(db, 'owner', sql, [project]);
      expect(r.error?.code, why).toBe('23514');
    }
    expect((await as(db, 'owner', `update projects set value = 0 where id = $1`, [project])).error).toBeNull();
    const cost = await as(db, 'owner', `insert into project_costs (project_id, description, amount) values ($1, 'Stock photos', 25000)`, [project]);
    expect(cost.error).toBeNull();
  });

  test('an unset market value is not zero, and is reported as missing', async () => {
    expect(await summary(db)).toEqual({
      committed: 0, committed_projects: 0, committed_missing: 2, delivered: 0, delivered_projects: 0, cancelled_projects: 0,
    });
    await as(db, 'owner', `update projects set market_value = 0 where id = $1`, [second]);
    expect(await summary(db)).toMatchObject({ committed: 0, committed_projects: 1, committed_missing: 1 });
  });

  test('it cannot be closed without a market value, even with every checkpoint done', async () => {
    await as(db, 'owner', `update project_milestones set state = 'done' where project_id = $1`, [project]);
    const r = await as(db, 'owner', `update projects set status = 'completed' where id = $1`, [project]);
    expect(r.error?.message).toContain('stratos:impact_close_no_market_value');
  });

  test('every change of the value is logged old → new and moves the counter', async () => {
    await as(db, 'owner', `update projects set market_value = 500000 where id = $1`, [project]);
    expect(await summary(db)).toMatchObject({ committed: 500000, committed_missing: 0 });
    await as(db, 'owner', `update projects set market_value = 650000, name = 'Zöld Kör web' where id = $1`, [project]);
    expect(await summary(db)).toMatchObject({ committed: 650000 });
    const log = await as(db, 'owner', `select metadata from activity_logs
      where entity_id = $1 and action = 'project.market_value_changed' order by created_at, id`, [project]);
    expect(log.rows.map((r) => r.metadata)).toEqual([
      { from: null, to: 500000, currency: 'HUF' },
      { from: 500000, to: 650000, currency: 'HUF' },
    ]);
  });

  test('closing moves it from committed to delivered; the value stays', async () => {
    const r = await as(db, 'owner', `update projects set status = 'completed' where id = $1 and status <> 'completed' returning id`, [project]);
    expect(r.error).toBeNull();
    expect(r.affected).toBe(1);
    expect(await summary(db)).toMatchObject({ committed: 0, delivered: 650000, delivered_projects: 1 });
    const clear = await as(db, 'owner', `update projects set market_value = null where id = $1`, [project]);
    expect(clear.error?.message).toContain('stratos:impact_close_no_market_value');
  });

  test('archiving changes neither figure', async () => {
    await as(db, 'owner', `update projects set archived_at = now() where id in ($1, $2)`, [project, second]);
    expect(await summary(db)).toMatchObject({ committed: 0, delivered: 650000, committed_projects: 1 });
    await as(db, 'owner', `update projects set archived_at = null where id in ($1, $2)`, [project, second]);
  });

  test('reopening moves the value back from delivered to committed', async () => {
    const r = await as(db, 'owner', `update projects set status = 'active' where id = $1`, [project]);
    expect(r.error).toBeNull();
    expect(await summary(db)).toMatchObject({ committed: 650000, delivered: 0, delivered_projects: 0 });
  });

  test('a cancelled project counts as neither committed nor delivered', async () => {
    await as(db, 'owner', `update projects set market_value = 120000 where id = $1`, [second]);
    expect(await summary(db)).toMatchObject({ committed: 770000 });
    await as(db, 'owner', `update projects set status = 'cancelled' where id = $1`, [second]);
    expect(await summary(db)).toMatchObject({ committed: 650000, delivered: 0, cancelled_projects: 1 });
  });

  test('an Impact project cannot be deleted from under its application', async () => {
    const r = await as(db, 'owner', `delete from projects where id = $1`, [second]);
    expect(r.error?.code).toBe('23001'); // restrict_violation
  });

  test('a paid project closes exactly as before — no market value needed', async () => {
    await as(db, 'owner', `update project_milestones set state = 'done' where project_id = $1`, [PAID.active]);
    const r = await as(db, 'owner', `update projects set status = 'completed' where id = $1 returning completed_at`, [PAID.active]);
    expect(r.error).toBeNull();
    expect(r.rows[0].completed_at).not.toBeNull();
    const empty = await as(db, 'owner', `update projects set status = 'completed' where id = $1`, [PAID.other]);
    expect(empty.error?.message).toContain('stratos:project_close_no_checkpoints');
  });
});

/* ========================================================== access ===== */

test.describe('Impact data is the owner\'s alone', () => {
  let db: PGlite;
  test.beforeAll(async () => {
    db = await fresh();
    await db.exec(`update impact_applications set status = 'accepted' where lead_id = '${LEAD.impactNew}'`);
    const app = (await appFor(db, LEAD.impactNew)).id;
    const p = (await as(db, 'owner', START, startArgs(app))).rows[0].id as string;
    await as(db, 'owner', `update projects set market_value = 300000 where id = $1`, [p]);
  });

  test('the owner reads the pipeline, its events and the counters', async () => {
    expect(await count(db, 'owner', 'impact_applications')).toBe(4); // five Impact leads, one a conflict
    expect(await count(db, 'owner', 'activity_logs', `entity_type = 'impact_application'`)).toBeGreaterThan(0);
    expect(await summary(db)).toMatchObject({ committed: 300000 });
  });

  for (const who of OTHERS) {
    test(`${who} reads and changes nothing`, async () => {
      expect([0, 'error 42501'], 'applications').toContain(await count(db, who, 'impact_applications'));
      expect([0, 'error 42501'], 'impact events').toContain(
        await count(db, who, 'activity_logs', `entity_type = 'impact_application'`));
      expect([0, 'error 42501'], 'impact projects').toContain(await count(db, who, 'projects', `program = 'impact'`));
      const upd = await as(db, who, `update impact_applications set status = 'rejected'`);
      expect(upd.error !== null || upd.affected === 0).toBe(true);
      const ins = await as(db, who, `insert into impact_applications (lead_id) values ($1)`, [LEAD.contact]);
      expect(ins.error?.code).toBe('42501');
      const del = await as(db, who, `delete from impact_applications`);
      expect(del.error?.code).toBe('42501');
      const conf = await as(db, who, 'select count(*)::int as n from impact_legacy_conflicts()');
      expect(conf.error ? conf.error.code : conf.rows[0].n).toBe(who === 'anon' ? '42501' : 0);
      const s = await as(db, who, 'select committed::int, delivered::int from impact_support_summary()');
      if (who === 'anon') expect(s.error?.code).toBe('42501');
      else expect(s.rows[0]).toEqual({ committed: 0, delivered: 0 });
      const sync = await as(db, who, 'select * from impact_sync_applications()');
      expect(sync.error?.code).toBe('42501');
    });
  }

  test('non-owner admins still read the other events they always could', async () => {
    expect(await count(db, 'admin', 'activity_logs', `entity_type = 'lead'`)).toBeGreaterThanOrEqual(0);
    expect(await count(db, 'admin', 'activity_logs', `entity_type = 'opportunity'`)).toBeGreaterThan(0);
    expect(await count(db, 'admin', 'leads')).toBe(7);
  });

  test('no function the API can call reads projects on a definer\'s authority, and there are no views', async () => {
    const rows = await db.query<{ proname: string }>(`
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef
        and p.prosrc ~* '\\m(projects|project_milestones|project_costs|project_links|impact_applications)\\M'
        and p.prorettype <> 'trigger'::regtype
      order by 1`);
    expect(rows.rows).toEqual([]);
    expect((await db.query(`select table_name from information_schema.views where table_schema = 'public'`)).rows).toEqual([]);
  });
});

/* ================================================ paid separation ===== */

test.describe('the paid figures do not count Impact', () => {
  let db: PGlite;
  test.beforeAll(async () => {
    db = await fresh();
    await db.exec(`update impact_applications set status = 'accepted' where lead_id = '${LEAD.impactNew}'`);
    const app = (await appFor(db, LEAD.impactNew)).id;
    await as(db, 'owner', START, startArgs(app));
  });

  test('lead attribution counts paid leads only; opportunities as before', async () => {
    const r = await as(db, 'owner', `select key, leads::int, qualified::int, opportunities::int
      from portal_revenue_attribution('source') order by key`);
    // newsletter: the paid contact lead only — the Impact lead and the legacy
    // Impact lead that share the source are not paid leads.
    expect(r.rows.find((row) => row.key === 'newsletter')).toEqual({ key: 'newsletter', leads: 1, qualified: 1, opportunities: 0 });
    const total = r.rows.reduce((n, row) => n + (row.leads as number), 0);
    expect(total).toBe(2); // the contact lead and the ambiguous one
  });

  test('delivery buckets count paid projects only, and cancelled reads as closed', async () => {
    const buckets = async () => (await as(db, 'owner',
      `select bucket, items::int from portal_sales_summary() where bucket like 'projects_%' order by 1`)).rows;
    expect(await buckets()).toEqual([{ bucket: 'projects_active', items: 3 }]);
    await as(db, 'owner', `update projects set status = 'cancelled' where id = $1`, [PAID.other]);
    expect(await buckets()).toEqual([
      { bucket: 'projects_active', items: 2 }, { bucket: 'projects_closed', items: 1 },
    ]);
  });

  test('the pipeline and forecast hold no Impact deal', async () => {
    const r = await as(db, 'admin', `select bucket, items::int from portal_sales_summary() where bucket = 'won_all'`);
    // The one legacy conflict, which stays a paid deal until the owner decides.
    expect(r.rows).toEqual([{ bucket: 'won_all', items: 1 }]);
  });
});

/* ================================================== project_links fix == */

test.describe('project_links.url', () => {
  test('the shipped check cannot compile; the fix accepts valid and refuses invalid URLs', async () => {
    const db = await fresh({ impact: false });
    // Reproduce the defect first: the check as shipped raises on ANY insert.
    const broken = await as(db, 'owner', `insert into project_links (project_id, label, url)
      values ($1, 'x', 'https://example.com')`, [PAID.active]);
    expect(broken.error?.message).toContain('invalid repetition count');

    await db.exec(read(MIGRATIONS, '20260929000100_project_links_url_check.sql'));
    const tryUrl = async (url: string) => (await as(db, 'owner',
      `insert into project_links (project_id, label, url) values ($1, 'x', $2)`, [PAID.active, url])).error?.code ?? 'ok';

    for (const url of [
      'https://example.com', 'http://example.com', 'HTTPS://EXAMPLE.COM/Path?q=1#x',
      'https://abc', `https://${'a'.repeat(500)}`, 'https://staging.example.invalid/ő/ü',
    ]) expect(await tryUrl(url), url).toBe('ok');

    for (const url of [
      'javascript:alert(1)', 'ftp://example.com', 'https://', 'https://ab', 'https://exa mple.com',
      'https://example.com\n', `https://${'a'.repeat(501)}`, ' https://example.com', 'example.com', '',
    ]) expect(await tryUrl(url), JSON.stringify(url)).toBe('23514');
  });
});

/* ================================================= scripts & rollback == */

test.describe('the Impact check scripts', () => {
  test('preflight is read-only and runs on the pre-Impact schema', async () => {
    const db = await fresh({ impact: false });
    const sql = read(CHECKS, 'impact-preflight.sql');
    expect(sql.replace(/--.*$/gm, '')).not.toMatch(/\b(insert|update|delete|alter|create|drop|grant|revoke)\b/i);
    const results = await db.exec(sql);
    const requirements = results[0].rows as { requirement: string; ok: boolean }[];
    expect(requirements.filter((r) => !r.ok)).toEqual([]);
    const outcomes = (results[2].rows as { id: string; outcome: string }[]);
    expect(outcomes.filter((r) => r.outcome === 'conflict').map((r) => r.id)).toEqual([LEAD.impactConflict]);
    expect(outcomes.length).toBe(5);
    expect((results[4].rows as { id: string }[]).map((r) => r.id)).toEqual([LEAD.ambiguous]);
  });

  test('the Impact migration refuses to run before the owner lockdown', async () => {
    const db = new PGlite({ extensions: { pgcrypto } });
    await db.exec(STANDIN);
    for (const file of PHASE1()) await db.exec(read(MIGRATIONS, file));
    await db.exec(read(MIGRATIONS, '20260929000200_impact_enums.sql'));
    await expect(db.exec(read(MIGRATIONS, '20260929000300_impact_program.sql'))).rejects.toThrow(/owner/i);
    expect((await db.query(`select to_regclass('public.impact_applications') as t`)).rows[0]).toEqual({ t: null });
  });

  test('verify reports every check ok and leaves nothing behind', async () => {
    const db = await fresh();
    await db.exec(`update impact_applications set status = 'accepted' where lead_id = '${LEAD.impactNew}'`);
    await as(db, 'owner', START, startArgs((await appFor(db, LEAD.impactNew)).id));
    const before = await one(db, 'select count(*)::int as n from project_links');
    const results = await db.exec(read(CHECKS, 'impact-verify.sql'));
    const report = results.filter((r) => r.fields.some((f) => f.name === 'check_name')).pop()!;
    const failed = report.rows.filter((r) => r.result !== 'ok');
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.rows.filter((r) => String(r.check_name).includes('sees no Impact data')).length).toBe(5);
    expect(await one(db, 'select count(*)::int as n from project_links')).toEqual(before);
  });

  test('verify reports FAIL when an Impact lead is missing from the pipeline', async () => {
    const db = await fresh();
    await db.exec(`alter table impact_applications add constraint sim_fail check (origin <> 'form') not valid`);
    await db.query(`insert into leads (name, email, form_type, source) values ('x', 'x@example.invalid', 'impact', 'impact')`);
    const results = await db.exec(read(CHECKS, 'impact-verify.sql'));
    const report = results.filter((r) => r.fields.some((f) => f.name === 'check_name')).pop()!;
    expect(report.rows.filter((r) => r.result === 'FAIL').map((r) => r.check_name))
      .toContain('no Impact lead is missing from the pipeline (except reported conflicts)');
  });

  test('rollback keeps every row, restores the old behaviour, and re-applying works', async () => {
    const db = await fresh();
    await db.exec(`update impact_applications set status = 'accepted' where lead_id = '${LEAD.impactNew}'`);
    const p = (await as(db, 'owner', START, startArgs((await appFor(db, LEAD.impactNew)).id))).rows[0].id as string;
    await as(db, 'owner', `update projects set market_value = 1000 where id = $1`, [p]);
    const snapshot = async () => one(db, `select
      (select count(*) from impact_applications)::int as apps,
      (select count(*) from projects)::int as projects,
      (select count(*) from projects where program = 'impact' and market_value = 1000)::int as valued,
      (select count(*) from activity_logs)::int as logs`);
    const before = await snapshot();

    await db.exec(read(CHECKS, 'impact-rollback.sql'));
    expect(await snapshot()).toEqual(before);
    // Old behaviour: an Impact lead is no longer captured, and attribution counts it again.
    await db.query(`insert into leads (name, email, form_type, source) values ('Late', 'late@example.invalid', 'impact', 'impact')`);
    expect(await one(db, 'select count(*)::int as n from impact_applications')).toEqual({ n: before.apps });
    const legacy = await as(db, 'owner', `select sum(leads)::int as n from portal_revenue_attribution('source')`);
    expect(legacy.rows[0].n).toBe(7); // every non-spam lead, Impact included, as before
    expect((await as(db, 'owner', 'select * from impact_support_summary()')).error?.code).toBe('42501');

    // Re-applying picks up what arrived meanwhile.
    await db.exec(read(MIGRATIONS, '20260929000300_impact_program.sql'));
    expect(await one(db, 'select count(*)::int as n from impact_applications')).toEqual({ n: before.apps + 1 });
  });
});

/* ======================================================== the files ===== */

test.describe('the three Impact migrations', () => {
  const strip = (name: string) => read(MIGRATIONS, name).replace(/--.*$/gm, '');

  test('none drops a table, type or column, truncates, or deletes rows', () => {
    for (const name of IMPACT_FILES) {
      const sql = strip(name);
      expect(sql, name).not.toMatch(/\bdrop\s+(table|type|schema|column|function)\b/i);
      expect(sql, name).not.toMatch(/\btruncate\b/i);
      expect(sql, name).not.toMatch(/\bdelete\s+from\b/i);
    }
  });

  test('the enum step is alone and cannot fail silently', () => {
    const sql = strip('20260929000200_impact_enums.sql');
    expect(sql.trim().split(';').filter((s) => s.trim()).length).toBe(1);
    expect(sql).not.toMatch(/exception\s+when/i);
  });

  test('the link fix is one small constraint swap', () => {
    const sql = strip('20260929000100_project_links_url_check.sql');
    expect(sql.trim().split(';').filter((s) => s.trim()).length).toBe(3);
    expect(sql).not.toMatch(/\{\d+,\s*\d{3,}\}/);
  });
});

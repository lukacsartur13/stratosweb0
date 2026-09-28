// =============================================================================
// Every migration, check and concurrency rule against a REAL PostgreSQL server.
//
//     LOCAL_PG_URL=postgres://postgres@127.0.0.1:54329/postgres \
//     PG_CLIENT_DIR=/path/with/node_modules/pg \
//     node scripts/pg-integration-check.mjs
//
// WHY THIS EXISTS BESIDE THE PGLITE SUITES
// ----------------------------------------
// The PGlite suites (tests/portal-*-db.spec.ts) run real Postgres 18 in
// WebAssembly, as a SUPERUSER, over ONE connection. Three things they cannot
// show, and this can:
//
//   1. the release as Supabase's SQL editor runs it: each file as ONE implicit
//      transaction, as a role that is NOT a superuser but has BYPASSRLS (what
//      `postgres` is on Supabase) — so a migration that silently needs superuser,
//      or that adds an enum value and uses it in the same transaction, fails here;
//   2. an upgrade from the schema production is on today (up to
//      20260816000100), with representative old rows, checked row by row after;
//   3. truly CONCURRENT calls on separate connections: double starts, double
//      completions, parallel payments, parallel uploads under a limit.
//
// WHAT IT IS NOT
// --------------
// Not Supabase. There is no GoTrue, PostgREST or Storage server here: `auth` and
// `storage` are the same small stand-ins the PGlite suites use (auth.uid() from
// `request.jwt.claims`, a storage.objects catalogue), and an API call is
// "SET ROLE authenticated + the caller's JWT claims" — exactly what PostgREST
// does per request, minus PostgREST. The live Supabase checks
// (scripts/documents-live-check.mjs, scripts/client-portal-live-check.mjs) still
// need a local Supabase stack (Docker + Supabase CLI).
//
// Safety: refuses any host but 127.0.0.1 / localhost / ::1. Creates its own
// databases (stratos_it_*) and drops them at the end unless KEEP=1.
// Exit 0 when every check passes.
// =============================================================================
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const MIG = join(ROOT, 'supabase', 'migrations');
const CHK = join(ROOT, 'supabase', 'checks');
const read = (dir, f) => readFileSync(join(dir, f), 'utf8');

const require = createRequire(process.env.PG_CLIENT_DIR ? join(process.env.PG_CLIENT_DIR, 'x.js') : import.meta.url);
let pg;
try { pg = require('pg'); } catch {
  console.error('The `pg` client is not installed. Install it outside the repository (e.g. `npm i pg` in a scratch folder) and set PG_CLIENT_DIR to that folder.');
  process.exit(2);
}

const BASE_URL = process.env.LOCAL_PG_URL;
if (!BASE_URL) { console.error('Set LOCAL_PG_URL to a LOCAL PostgreSQL superuser URL.'); process.exit(2); }
const host = new URL(BASE_URL).hostname;
if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host)) {
  console.error(`Refusing ${host}: this script only ever runs against a local server.`); process.exit(2);
}

const RUN = Date.now().toString(36);
const created = [];
const results = [];
const report = { server: null, scenarios: {} };
async function check(name, fn) {
  try { const detail = await fn(); results.push({ name, ok: true, detail }); console.log(`  ok   ${name}${detail ? ` — ${detail}` : ''}`); }
  catch (e) { results.push({ name, ok: false, error: e.message }); console.log(`  FAIL ${name}\n       ${String(e.message).split('\n')[0]}`); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };

const urlFor = (db) => { const u = new URL(BASE_URL); u.pathname = `/${db}`; return u.toString(); };
async function connect(db) { const c = new pg.Client({ connectionString: urlFor(db) }); await c.connect(); return c; }

/* ------------------------------------------------ a Supabase-shaped database */

// Cluster-wide roles, once. `supa_postgres` is what Supabase's `postgres` is:
// not a superuser, BYPASSRLS, member of the API roles (so a check script can
// SET ROLE authenticated, as the verify scripts do).
async function roles() {
  const admin = await connect(new URL(BASE_URL).pathname.slice(1) || 'postgres');
  report.server = (await admin.query('select version()')).rows[0].version;
  await admin.query(`
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'supa_postgres') then
        create role supa_postgres nologin nosuperuser bypassrls createrole;
      end if;
    end $$;
    grant anon, authenticated to supa_postgres;
  `);
  await admin.end();
}

async function freshDb(label) {
  const name = `stratos_it_${label}_${RUN}`;
  const admin = await connect(new URL(BASE_URL).pathname.slice(1) || 'postgres');
  await admin.query(`create database ${name}`);
  await admin.end();
  created.push(name);
  const su = await connect(name);
  await su.query(`
    create extension if not exists pgcrypto;
    grant create, connect, temporary on database ${name} to supa_postgres;
    alter schema public owner to supa_postgres;
    grant usage on schema public to anon, authenticated;
    create schema auth authorization supa_postgres;
    create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb);
    alter table auth.users owner to supa_postgres;
    -- Supabase's own definition (auth schema, supabase/auth): an empty or unset
    -- claims setting is NULL, not a JSON error.
    create function auth.uid() returns uuid language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
    alter function auth.uid() owner to supa_postgres;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    alter default privileges for role supa_postgres in schema public grant all on tables    to anon, authenticated;
    alter default privileges for role supa_postgres in schema public grant all on functions to anon, authenticated;
    alter default privileges for role supa_postgres in schema public grant all on sequences to anon, authenticated;
    create schema storage authorization supa_postgres;
    create table storage.buckets (
      id text primary key, name text not null, owner uuid, public boolean default false,
      file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now(), updated_at timestamptz default now());
    create table storage.objects (
      id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
      name text not null, owner uuid, metadata jsonb, created_at timestamptz default now(), unique (bucket_id, name));
    alter table storage.buckets owner to supa_postgres;
    alter table storage.objects owner to supa_postgres;
    alter table storage.objects enable row level security;
    grant usage on schema storage to anon, authenticated;
    grant select, insert, update, delete on storage.objects to anon, authenticated;
    grant select on storage.buckets to anon, authenticated;
    insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true);
  `);
  return { name, su };
}

/** Run one file the way the Supabase SQL editor does: one implicit transaction, as `postgres` (here: supa_postgres). */
async function applyAsEditor(client, sql) {
  await client.query('set role supa_postgres');
  try { return await client.query(sql); } finally { await client.query('reset role'); }
}
const migrations = () => readdirSync(MIG).filter((f) => /^\d+_[a-z_]+\.sql$/.test(f)).sort();

/** A verify script: every row of verify_result must be ok. */
async function verify(client, file) {
  await client.query('set role supa_postgres');
  try {
    await client.query(read(CHK, file).replace(/rollback;\s*$/, ''));
    const rows = (await client.query('select check_name, ok, detail from verify_result')).rows;
    await client.query('rollback');
    return rows;
  } catch (e) { await client.query('rollback').catch(() => {}); throw e; } finally { await client.query('reset role'); }
}

/** An API call: what PostgREST does per request, on its own connection. */
async function asUser(client, userId, sql, params = []) {
  await client.query('begin');
  try {
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: userId, role: 'authenticated' })]);
    await client.query('set local role authenticated');
    const r = await client.query(sql, params);
    await client.query('commit');
    return { rows: r.rows, error: null };
  } catch (e) {
    await client.query('rollback').catch(() => {});
    return { rows: [], error: { code: e.code, message: e.message } };
  }
}

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const U = { owner: id(1), super2: id(2), admin: id(3), team: id(4), clientA: id(5), clientA2: id(6), clientB: id(7) };
const ORG = { a: id(101), b: id(102) };

async function people(su) {
  await su.query(`
    insert into auth.users (id, email) values
      ('${U.owner}', 'owner@example.invalid'), ('${U.super2}', 'super2@example.invalid'), ('${U.admin}', 'admin@example.invalid'),
      ('${U.team}', 'team@example.invalid'), ('${U.clientA}', 'anna@a.example'), ('${U.clientA2}', 'bela@a.example'),
      ('${U.clientB}', 'cili@b.example');
    update profiles set role = 'super_admin' where id in ('${U.owner}', '${U.super2}');
    update profiles set role = 'admin' where id = '${U.admin}';
    update profiles set role = 'team_member' where id = '${U.team}';
  `);
}

/* ------------------------------------------------------------- scenario A */

async function scenarioClean() {
  console.log('\nA. clean database, the full release order, as a non-superuser editor role');
  const { name, su } = await freshDb('clean');
  const files = migrations();
  const timing = {};
  await check('A: every migration up to the owner tracker applies', async () => {
    for (const f of files.filter((x) => x <= '20260928000200_owner_tracker.sql')) {
      const t0 = Date.now(); await applyAsEditor(su, read(MIG, f)); timing[f] = Date.now() - t0;
    }
  });
  await su.query(`insert into organizations (id, name, slug, status) values ('${ORG.a}', 'A Kft.', 'a', 'active'), ('${ORG.b}', 'B Kft.', 'b', 'active')`);
  await people(su);
  await check('A: the lockdown refuses to run before an owner is designated', async () => {
    let refused = false;
    try { await applyAsEditor(su, read(MIG, '20260928000300_owner_lockdown.sql')); } catch (e) { refused = /No portal owner/.test(e.message); }
    assert(refused, 'lockdown ran without an owner');
  });
  await applyAsEditor(su, `select portal_set_owner('owner@example.invalid')`);
  await check('A: every later migration applies, each in its own transaction', async () => {
    for (const f of files.filter((x) => x > '20260928000200_owner_tracker.sql')) {
      const t0 = Date.now(); await applyAsEditor(su, read(MIG, f)); timing[f] = Date.now() - t0;
    }
    return `${Object.keys(timing).length} files`;
  });
  for (const v of ['owner-tracker-verify.sql', 'impact-verify.sql', 'documents-verify.sql', 'client-portal-verify.sql', 'payment-schedule-verify.sql']) {
    await check(`A: ${v} — every row ok`, async () => {
      const rows = await verify(su, v);
      const bad = rows.filter((r) => !r.ok);
      assert(bad.length === 0, bad.map((r) => `${r.check_name}: ${r.detail ?? ''}`).join('; '));
      return `${rows.length} rows`;
    });
  }
  await check('A: re-applying every migration from phase 1 on is idempotent', async () => {
    for (const f of files.filter((x) => x >= '20260928000100_owner_tracker_enums.sql')) await applyAsEditor(su, read(MIG, f));
    const rows = await verify(su, 'payment-schedule-verify.sql');
    assert(rows.every((r) => r.ok), 'verify failed after re-apply');
  });
  report.scenarios.clean = { database: name, timing };
  await su.end();
}

/* ------------------------------------------------------------- scenario B */

// What production holds today, as far as the anon probes can tell
// (OWNER_TRACKER.md §1): everything up to 20260816000100, with leads,
// opportunities, clients, projects carrying single-sum payment figures,
// members and client profiles.
const OLD = {
  leads: [id(401), id(402), id(403), id(404)],
  opp: [id(501), id(502)],
  proj: { paid: id(601), partial: id(602), stateOnly: id(603), clean: id(604), withMember: id(605) },
};

async function scenarioUpgrade() {
  console.log('\nB. upgrade from the production schema (…20260816000100) with representative old rows');
  const { name, su } = await freshDb('upgrade');
  const files = migrations();
  for (const f of files.filter((x) => x <= '20260816000100_revenue_operations.sql')) await applyAsEditor(su, read(MIG, f));
  await su.query(`insert into organizations (id, name, slug, status) values ('${ORG.a}', 'A Kft.', 'a', 'active'), ('${ORG.b}', 'B Kft.', 'b', 'active')`);
  await people(su);
  await su.query(`
    update profiles set organization_id = '${ORG.a}' where id in ('${U.clientA}', '${U.clientA2}');
    update profiles set organization_id = '${ORG.b}' where id = '${U.clientB}';
    insert into leads (id, name, company, email, form_type, source, status, created_at) values
      ('${OLD.leads[0]}', 'Kiss Anna', 'Zöld Kör', 'anna@zold.example', 'impact', 'impact', 'contacted', '2026-08-20'),
      ('${OLD.leads[1]}', 'Nagy Béla', 'Régi Alapítvány', 'bela@regi.example', null, 'impact', 'new', '2026-08-21'),
      ('${OLD.leads[2]}', 'Tóth Cili', 'Sold Impact Kft.', 'cili@sold.example', 'impact', 'impact', 'won', '2026-08-22'),
      ('${OLD.leads[3]}', 'Szabó Dani', 'Paid Bt.', 'dani@paid.example', 'contact', 'google', 'qualified', '2026-08-23');
    insert into opportunities (id, title, company_name, stage, lead_id, estimated_value, currency, next_action, next_action_on) values
      ('${OLD.opp[0]}', 'Sold Impact (legacy conflict)', 'Sold Impact Kft.', 'won', '${OLD.leads[2]}', 900000, 'HUF', null, null),
      ('${OLD.opp[1]}', 'Paid Bt. website', 'Paid Bt.', 'proposal', '${OLD.leads[3]}', 1200000, 'HUF', 'Send the offer', '2026-09-01');
    insert into projects (id, organization_id, name, slug, status, value, currency, payment_state, invoiced_amount, paid_amount) values
      ('${OLD.proj.paid}',       '${ORG.a}', 'A website',  'a-web',   'active',    1500000, 'HUF', 'paid',           1500000, 1500000),
      ('${OLD.proj.partial}',    '${ORG.a}', 'A ads',      'a-ads',   'active',     300000, 'HUF', 'partially_paid', 300000,  100000),
      ('${OLD.proj.stateOnly}',  '${ORG.b}', 'B brand',    'b-brand', 'active',     900000, 'HUF', 'paid',           null,    null),
      ('${OLD.proj.clean}',      '${ORG.b}', 'B hosting',  'b-host',  'active',       null, 'EUR', 'not_invoiced',   null,    null),
      ('${OLD.proj.withMember}', '${ORG.a}', 'A shop',     'a-shop',  'active',    2000000, 'HUF', 'invoiced',       1000000, null);
    insert into project_members (project_id, user_id) values ('${OLD.proj.withMember}', '${U.team}');
    insert into project_milestones (project_id, title, position, state) values ('${OLD.proj.paid}', 'Launch', 0, 'done');
    insert into record_notes (entity_type, entity_id, author_id, body) values ('opportunity', '${OLD.opp[1]}', '${U.admin}', 'Old note');
  `);
  const snapshot = async () => (await su.query(`
    select (select count(*)::int from leads) as leads, (select count(*)::int from opportunities) as opps,
           (select count(*)::int from projects) as projects, (select count(*)::int from record_notes) as notes,
           (select count(*)::int from project_milestones) as milestones, (select count(*)::int from profiles) as profiles,
           (select coalesce(sum(paid_amount), 0)::numeric from projects) as paid`)).rows[0];
  const before = await snapshot();

  // The release, in PORTAL_RELEASE.md order. Preflights first (read-only).
  await check('B: owner-tracker preflight runs read-only and reports every object present', async () => {
    await su.query('set role supa_postgres');
    try {
      const r = await su.query(read(CHK, 'owner-tracker-preflight.sql'));
      const first = (Array.isArray(r) ? r[0] : r).rows;
      const missing = first.filter((x) => x.present === false);
      assert(missing.length === 0, `missing: ${missing.map((m) => m.object).join(', ')}`);
    } finally { await su.query('reset role'); }
  });
  const order = [
    '20260928000100_owner_tracker_enums.sql', '20260928000200_owner_tracker.sql', 'SET_OWNER',
    '20260928000300_owner_lockdown.sql', 'CHECK:owner-tracker-verify.sql', 'PRE:impact-preflight.sql',
    '20260929000100_project_links_url_check.sql', '20260929000200_impact_enums.sql', '20260929000300_impact_program.sql',
    'CHECK:impact-verify.sql', 'PRE:documents-preflight.sql', '20260930000100_document_library.sql', 'CHECK:documents-verify.sql',
    '20261001000100_client_portal.sql', 'CHECK:client-portal-verify.sql',
    '20261002000100_payment_schedule.sql', 'CHECK:payment-schedule-verify.sql',
    '20261003000100_owner_delegates.sql', 'CHECK:owner-delegates-verify.sql',
    '20261004000100_client_demos_meetings_help.sql', '20261004000200_help_seed.sql', '20261005000100_client_feedback_reschedule.sql', 'CHECK:client-extras-verify.sql',
  ];
  assert(JSON.stringify(order.filter((x) => x.endsWith('.sql') && !x.includes(':'))) === JSON.stringify(files.filter((f) => f > '20260816000100_revenue_operations.sql')),
    'the release order does not list every migration file');
  for (const step of order) {
    await check(`B: ${step}`, async () => {
      if (step === 'SET_OWNER') { await applyAsEditor(su, `select portal_set_owner('owner@example.invalid')`); return; }
      if (step.startsWith('CHECK:')) {
        const rows = await verify(su, step.slice(6));
        const bad = rows.filter((r) => !r.ok);
        assert(bad.length === 0, bad.map((r) => `${r.check_name}: ${r.detail ?? ''}`).join('; '));
        return `${rows.length} rows ok`;
      }
      if (step.startsWith('PRE:')) {
        await su.query('set role supa_postgres');
        try {
          const r = await su.query(read(CHK, step.slice(4)));
          const first = (Array.isArray(r) ? r[0] : r).rows;
          const bad = first.filter((x) => x.ok === false);
          assert(bad.length === 0, bad.map((x) => x.requirement).join(', '));
        } finally { await su.query('reset role'); }
        return;
      }
      const r = await applyAsEditor(su, read(MIG, step));
      const last = Array.isArray(r) ? r.filter((x) => x.rows?.length).pop() : r;
      return last?.rows?.[0] ? JSON.stringify(last.rows[0]) : undefined;
    });
  }

  await check('B: no row was lost, and money received is unchanged', async () => {
    const after = await snapshot();
    for (const k of ['leads', 'opps', 'projects', 'milestones', 'profiles']) assert(after[k] === before[k], `${k}: ${before[k]} → ${after[k]}`);
    assert(after.notes >= before.notes, 'notes lost');
    const pays = (await su.query(`select coalesce(sum(amount), 0)::numeric as s from project_payments`)).rows[0].s;
    assert(Number(pays) === Number(before.paid), `payments ${pays} vs legacy paid ${before.paid}`);
    return JSON.stringify(after);
  });
  await check('B: the Impact backfill captured the Impact leads and listed the sold one as a conflict', async () => {
    const apps = (await su.query(`select lead_id::text, status::text from impact_applications order by lead_id`)).rows;
    assert(apps.length === 2, `applications ${JSON.stringify(apps)}`);
    const conflicts = (await su.query(`select count(*)::int as n from project_finance_legacy`)).rows[0].n;
    return `${apps.length} applications; ${conflicts} projects in the payment snapshot`;
  });
  await check('B: the payment carry-over lists the doubtful project, keeps the original, invents no date', async () => {
    const r = (await su.query(`select project_id::text, outcome, issues from project_finance_legacy order by project_name`)).rows;
    const doubtful = r.find((x) => x.project_id === OLD.proj.stateOnly);
    assert(doubtful?.outcome === 'review' && doubtful.issues.includes('marked_paid_without_amount'), JSON.stringify(doubtful));
    const dated = (await su.query(`select count(*)::int as n from project_payments where origin = 'legacy' and paid_on is not null`)).rows[0].n;
    assert(dated === 0, `${dated} legacy payments dated`);
    return `${r.length} carried, ${r.filter((x) => x.outcome === 'review').length} for review`;
  });
  await check('B: a former project member (team) and the second super_admin lost project access; the owner kept it', async () => {
    const c = await connect(name);
    const team = await asUser(c, U.team, `select count(*)::int as n from projects`);
    const s2 = await asUser(c, U.super2, `select count(*)::int as n from projects`);
    const own = await asUser(c, U.owner, `select count(*)::int as n from projects`);
    const cl = await asUser(c, U.clientA, `select count(*)::int as n from projects`);
    await c.end();
    assert(team.rows[0].n === 0 && s2.rows[0].n === 0 && cl.rows[0].n === 0, `team ${team.rows[0].n}, super2 ${s2.rows[0].n}, client ${cl.rows[0].n}`);
    assert(own.rows[0].n === 5, `owner sees ${own.rows[0].n}`);
  });
  report.scenarios.upgrade = { database: name, before, after: await snapshot() };
  await su.end();
  return name;
}

/* ------------------------------------------------------------- scenario C */

async function parallel(db, n, fn) {
  const clients = await Promise.all(Array.from({ length: n }, () => connect(db)));
  try { return await Promise.all(clients.map((c, i) => fn(c, i))); } finally { await Promise.all(clients.map((c) => c.end())); }
}

async function scenarioConcurrency(db) {
  console.log('\nC. concurrent calls on separate connections (the upgraded database)');
  const su = await connect(db);

  await check('C: 8 simultaneous Impact starts of one application make ONE project', async () => {
    await su.query(`update impact_applications set status = 'accepted' where lead_id = '${OLD.leads[0]}'`);
    const app = (await su.query(`select id from impact_applications where lead_id = '${OLD.leads[0]}'`)).rows[0].id;
    const r = await parallel(db, 8, (c, i) => asUser(c, U.owner,
      `select impact_start_project($1, null, 'Zöld Kör', 'zold-kor', null, 'Zöld Kör web', 'zold-web', 'Website', array['Build','Handover']) as id`, [app]));
    const errors = r.filter((x) => x.error);
    const ids = new Set(r.filter((x) => !x.error).map((x) => x.rows[0].id));
    const projects = (await su.query(`select count(*)::int as n from projects where program = 'impact'`)).rows[0].n;
    const orgs = (await su.query(`select count(*)::int as n from organizations where slug = 'zold-kor'`)).rows[0].n;
    assert(ids.size === 1 && projects === 1 && orgs === 1, `ids ${ids.size}, projects ${projects}, orgs ${orgs}, errors ${JSON.stringify(errors.map((e) => e.error.message))}`);
    return `${r.length - errors.length} returned the same project, ${errors.length} errors`;
  });

  await check('C: 8 simultaneous "Done" on one next action write ONE note', async () => {
    const r = await parallel(db, 8, (c) => asUser(c, U.admin, `select opportunity_complete_action($1, 'Send the offer') as done`, [OLD.opp[1]]));
    const trues = r.filter((x) => x.rows[0]?.done === true).length;
    const notes = (await su.query(`select count(*)::int as n from record_notes where entity_id = $1 and body like 'Done:%'`, [OLD.opp[1]])).rows[0].n;
    assert(trues === 1 && notes === 1, `true ${trues}, notes ${notes}, errors ${r.filter((x) => x.error).map((x) => x.error.message)}`);
  });

  await check('C: 20 simultaneous payments on one project — the derived total equals the sum, state consistent', async () => {
    const pid = OLD.proj.clean; // EUR, no schedule yet
    await su.query(`update projects set value = 2000 where id = $1`, [pid]).catch(() => {});
    const inst = await asUser(su, U.owner, `insert into project_instalments (project_id, label, amount, due_on) values ($1, 'Anzahlung', 2000, current_date) returning id`, [pid]);
    assert(!inst.error, inst.error?.message);
    const r = await parallel(db, 20, (c) => asUser(c, U.owner,
      `insert into project_payments (instalment_id, project_id, amount, paid_on) values ($1, $2, 100, current_date)`, [inst.rows[0].id, pid]));
    const errs = r.filter((x) => x.error);
    const row = (await su.query(`select payment_state::text, paid_amount from projects where id = $1`, [pid])).rows[0];
    assert(errs.length === 0, errs.map((e) => e.error.message).join('; '));
    assert(Number(row.paid_amount) === 2000 && row.payment_state === 'paid', JSON.stringify(row));
    return JSON.stringify(row);
  });

  await check('C: 8 simultaneous owner uploads of the same name get 8 distinct names; finishing twice is idempotent', async () => {
    const pid = OLD.proj.paid;
    const r = await parallel(db, 8, (c) => asUser(c, U.owner, `select * from document_begin_upload($1, null, 'offer.pdf', 5, null, 'pdf')`, [pid]));
    const errs = r.filter((x) => x.error);
    const names = new Set(r.filter((x) => !x.error).map((x) => x.rows[0].name));
    assert(errs.length === 0, `errors: ${errs.map((e) => `${e.error.code} ${e.error.message}`).join('; ')}`);
    assert(names.size === 8, `names ${[...names]}`);
    const doc = r[0].rows[0];
    await su.query(`insert into storage.objects (bucket_id, name, metadata) values ('project-documents', $1, '{"size":5}')`, [doc.storage_path]);
    const fin = await parallel(db, 6, (c) => asUser(c, U.owner, `select document_finish_upload($1) as s`, [doc.id]));
    const states = fin.map((x) => x.error ? `error:${x.error.message}` : x.rows[0].s);
    assert(states.every((s) => s === 'ready'), states.join(','));
    return [...names].sort().join(', ');
  });

  await check('C: a client\'s 15 simultaneous uploads stop at the in-progress limit (10)', async () => {
    const own = await connect(db);
    const acct = await asUser(own, U.owner, `select * from client_invite_prepare($1, null, 'Anna', 'anna@a.example', array[$2]::uuid[])`, [ORG.a, OLD.proj.partial]);
    assert(!acct.error, acct.error?.message);
    const att = await asUser(own, U.owner, `select client_invite_attach($1, $2)`, [acct.rows[0].account_id, U.clientA]);
    assert(!att.error, att.error?.message);
    await own.end();
    const r = await parallel(db, 15, (c, i) => asUser(c, U.clientA, `select * from client_begin_upload($1, $2, 5, null, 'pdf')`, [OLD.proj.partial, `raw-${i}.pdf`]));
    const okN = r.filter((x) => !x.error).length;
    const pending = (await su.query(`select count(*)::int as n from project_documents where client_account_id is not null and upload_state = 'pending'`)).rows[0].n;
    assert(okN === 10 && pending === 10, `accepted ${okN}, pending ${pending}; errors ${[...new Set(r.filter((x) => x.error).map((x) => x.error.message))]}`);
    return `${okN} accepted, ${15 - okN} refused`;
  });

  await check('C: revoking access while a client upload finishes never leaves a ready document without access', async () => {
    const doc = (await su.query(`select id, storage_path from project_documents where client_account_id is not null and upload_state = 'pending' limit 1`)).rows[0];
    await su.query(`insert into storage.objects (bucket_id, name, metadata) values ('project-documents', $1, '{"size":5}')`, [doc.storage_path]);
    const access = (await su.query(`select x.id from client_project_access x join client_accounts a on a.id = x.account_id where a.user_id = $1 and x.revoked_at is null`, [U.clientA])).rows[0].id;
    const [fin, rev] = await Promise.all([
      (async () => { const c = await connect(db); const r = await asUser(c, U.clientA, `select client_finish_upload($1) as s`, [doc.id]); await c.end(); return r; })(),
      (async () => { const c = await connect(db); const r = await asUser(c, U.owner, `update client_project_access set revoked_at = now() where id = $1`, [access]); await c.end(); return r; })(),
    ]);
    const end = (await su.query(`select upload_state::text, failure_reason from project_documents where id = $1`, [doc.id])).rows[0];
    const live = (await su.query(`select count(*)::int as n from client_project_access where id = $1 and revoked_at is null`, [access])).rows[0].n;
    // Either order is legal; what must never happen is "ready AND the finish ran after the revoke".
    assert(!rev.error, rev.error?.message);
    assert(end.upload_state === 'ready' || (end.upload_state === 'failed' && end.failure_reason === 'access_revoked') || end.upload_state === 'pending',
      JSON.stringify({ end, fin }));
    assert(live === 0, 'revoke did not stick');
    return `${end.upload_state}${end.failure_reason ? ` (${end.failure_reason})` : ''}; finish said ${fin.error ? fin.error.message.slice(0, 60) : fin.rows[0].s}`;
  });

  await check('C: 6 simultaneous invitations of one address make ONE account', async () => {
    const r = await parallel(db, 6, (c) => asUser(c, U.owner, `select * from client_invite_prepare($1, null, 'Béla', 'bela@a.example', array[$2]::uuid[])`, [ORG.a, OLD.proj.partial]));
    const accounts = (await su.query(`select count(*)::int as n from client_accounts where email = 'bela@a.example'`)).rows[0].n;
    const errs = r.filter((x) => x.error).map((x) => `${x.error.code}`);
    assert(accounts === 1, `${accounts} accounts; errors ${errs}`);
    return `${r.length - errs.length} ok, ${errs.length} refused (${[...new Set(errs)].join(',') || 'none'})`;
  });

  await check('C: an existing staff account is never turned into a client by an invitation', async () => {
    const r = await asUser(su, U.owner, `select * from client_invite_prepare($1, null, 'Team', 'team@example.invalid', '{}')`, [ORG.a]);
    const role = (await su.query(`select role::text from profiles where id = $1`, [U.team])).rows[0].role;
    assert(r.error && role === 'team_member', `error ${r.error?.message}, role ${role}`);
  });

  await su.end();
}


/* ------------------------------------------------------------- scenario D */

// The two whole journeys, end to end, each call as the account that would make
// it through the Portal (SET ROLE authenticated + that user's claims). The
// confetti is the screen's (scripts/portal-tracker-check.mjs); here: the writes
// it is triggered by — a guarded move that returns the row exactly once.
async function scenarioJourneys(db) {
  console.log('\nD. the paid journey and the Impact journey, end to end');
  const c = await connect(db);
  const su = await connect(db);
  const q1 = async (who, sql, params) => { const r = await asUser(c, who, sql, params); if (r.error) throw new Error(`${sql.slice(0, 60)}… → ${r.error.message}`); return r.rows; };

  let deal; let project; let account; let doc;
  await check('D paid: lead → deal → won (the guarded move returns the row once)', async () => {
    await su.query(`insert into leads (id, name, company, email, form_type, source, status) values ($1, 'Varga Éva', 'Journey Kft.', 'eva@journey.example', 'contact', 'google', 'new')`, [id(801)]);
    [{ id: deal }] = await q1(U.admin, `insert into opportunities (title, company_name, stage, lead_id, estimated_value, currency) values ('Journey website', 'Journey Kft.', 'proposal', $1, 1200000, 'HUF') returning id`, [id(801)]);
    const first = await q1(U.admin, `update opportunities set stage = 'won' where id = $1 and stage <> 'won' returning id`, [deal]);
    const again = await q1(U.admin, `update opportunities set stage = 'won' where id = $1 and stage <> 'won' returning id`, [deal]);
    assert(first.length === 1 && again.length === 0, `won moves: ${first.length}, then ${again.length}`);
  });
  await check('D paid: the won deal becomes a client; it leaves the default pipeline and is still found', async () => {
    const [{ id: org }] = await q1(U.admin, `insert into organizations (name, slug, status) values ('Journey Kft.', 'journey', 'active') returning id`);
    await q1(U.admin, `update opportunities set organization_id = $2 where id = $1`, [deal, org]);
    const row = (await q1(U.admin, `select stage::text, organization_id from opportunities where id = $1`, [deal]))[0];
    assert(row.stage === 'won' && row.organization_id === org, JSON.stringify(row)); // isConverted() ⇒ hidden by default, listed under "Everything"
    [{ id: project }] = await q1(U.owner, `insert into projects (organization_id, name, slug, status, value, currency, opportunity_id) values ($1, 'Journey website', 'journey-web', 'planned', 1200000, 'HUF', $2) returning id`, [org, deal]);
    assert((await asUser(c, U.admin, `select count(*)::int as n from projects where id = $1`, [project])).rows[0].n === 0, 'admin sees the project');
  });
  await check('D paid: checkpoints, then a two-part schedule with a part payment', async () => {
    await q1(U.owner, `insert into project_milestones (project_id, title, position, state) values ($1, 'Design', 0, 'done'), ($1, 'Launch', 1, 'in_progress')`, [project]);
    const [{ id: a }] = await q1(U.owner, `insert into project_instalments (project_id, label, amount, due_on, invoiced) values ($1, 'Előleg', 600000, current_date - 5, true) returning id`, [project]);
    await q1(U.owner, `insert into project_instalments (project_id, label, amount, due_on) values ($1, 'Végszámla', 600000, current_date + 30)`, [project]);
    await q1(U.owner, `insert into project_payments (instalment_id, project_id, amount, paid_on) values ($1, $2, 250000, current_date)`, [a, project]);
    const o = (await q1(U.owner, `select * from project_payment_overview($1)`, [project]))[0];
    assert(Number(o.paid) === 250000 && Number(o.overdue) === 350000 && Number(o.schedule_gap) === 0, JSON.stringify(o));
  });
  await check('D paid: client account → assigned project → raw material → shared document', async () => {
    const org = (await su.query(`select organization_id from projects where id = $1`, [project])).rows[0].organization_id;
    await su.query(`insert into auth.users (id, email) values ($1, 'eva@journey.example')`, [id(802)]);
    [{ account_id: account }] = await q1(U.owner, `select * from client_invite_prepare($1, null, 'Varga Éva', 'eva@journey.example', array[$2]::uuid[])`, [org, project]);
    await q1(U.owner, `select client_invite_attach($1, $2)`, [account, id(802)]);
    const mine = await q1(id(802), `select * from client_portal_projects()`);
    assert(mine.length === 1 && mine[0].project_id === project && Object.keys(mine[0]).length === 2, JSON.stringify(mine));
    const [up] = await q1(id(802), `select * from client_begin_upload($1, 'logo.png', 7, 'image/png', 'png')`, [project]);
    await su.query(`insert into storage.objects (bucket_id, name, metadata) values ('project-documents', $1, '{"size":7}')`, [up.storage_path]);
    assert((await q1(id(802), `select client_finish_upload($1) as s`, [up.id]))[0].s === 'ready', 'upload not ready');
    [doc] = await q1(U.owner, `select * from document_begin_upload($1, null, 'Arculati kézikönyv.pdf', 5, null, 'pdf')`, [project]);
    await su.query(`insert into storage.objects (bucket_id, name, metadata) values ('project-documents', $1, '{"size":5}')`, [doc.storage_path]);
    await q1(U.owner, `select document_finish_upload($1)`, [doc.id]);
    await q1(U.owner, `insert into document_shares (account_id, project_id, document_id) values ($1, $2, $3)`, [account, project, doc.id]);
    const docs = await q1(id(802), `select name from client_portal_documents()`);
    assert(docs.map((d) => d.name).join() === 'Arculati kézikönyv.pdf', JSON.stringify(docs));
    const other = await asUser(c, U.clientB, `select name from client_portal_documents()`);
    assert(other.rows.length === 0, 'another company\'s client sees it');
  });
  await check('D paid: close refused while a checkpoint is open, then closes once; payment still recordable', async () => {
    const refused = await asUser(c, U.owner, `update projects set status = 'completed' where id = $1 and status <> 'completed' returning id`, [project]);
    assert(refused.error?.message.includes('project_close_open_checkpoints'), `close with open checkpoint: ${JSON.stringify(refused)}`);
    await q1(U.owner, `update project_milestones set state = 'done' where project_id = $1`, [project]);
    const first = await q1(U.owner, `update projects set status = 'completed' where id = $1 and status <> 'completed' returning id`, [project]);
    const again = await q1(U.owner, `update projects set status = 'completed' where id = $1 and status <> 'completed' returning id`, [project]);
    assert(first.length === 1 && again.length === 0, `close moves ${first.length}, then ${again.length}`);
    const [{ id: fin }] = await q1(U.owner, `select id from project_instalments where project_id = $1 and label = 'Végszámla'`, [project]);
    await q1(U.owner, `insert into project_payments (instalment_id, project_id, amount, paid_on) values ($1, $2, 600000, current_date)`, [fin, project]);
    const o = (await q1(U.owner, `select status, remaining, overdue from project_payment_overview($1)`, [project]))[0];
    assert(o.status === 'completed' && Number(o.remaining) === 350000 && Number(o.overdue) === 350000, JSON.stringify(o));
    const closed = await q1(U.owner, `select count(*)::int as n from projects where status = 'completed' and program = 'paid' and archived_at is null and id = $1`, [project]);
    assert(closed[0].n === 1, 'not in the closed list');
    const paidBuckets = await q1(U.owner, `select bucket, items from portal_sales_summary() where bucket like 'projects%'`);
    return JSON.stringify(paidBuckets);
  });

  let app; let impact;
  await check('D impact: form → captured → review → accepted → a free project', async () => {
    await su.query(`insert into leads (id, name, company, email, form_type, source, status) values ($1, 'Kovács Pál', 'Tanoda Egyesület', 'pal@tanoda.example', 'impact', 'impact', 'new')`, [id(803)]);
    [{ id: app }] = await q1(U.owner, `select id from impact_applications where lead_id = $1`, [id(803)]);
    await q1(U.owner, `update impact_applications set status = 'review' where id = $1`, [app]);
    await q1(U.owner, `update impact_applications set status = 'accepted' where id = $1`, [app]);
    [{ id: impact }] = await q1(U.owner, `select impact_start_project($1, null, 'Tanoda Egyesület', 'tanoda', null, 'Tanoda web', 'tanoda-web', 'Website', array['Build','Handover']) as id`, [app]);
    const p = (await su.query(`select program, value, payment_state::text, market_value from projects where id = $1`, [impact])).rows[0];
    assert(p.program === 'impact' && p.value === null && p.payment_state === 'not_invoiced' && p.market_value === null, JSON.stringify(p));
    const sold = await asUser(c, U.admin, `insert into opportunities (title, company_name, stage, lead_id) values ('x', 'Tanoda', 'proposal', $1)`, [id(803)]);
    assert(sold.error, 'an Impact lead became a paid deal');
    const inst = await asUser(c, U.owner, `insert into project_instalments (project_id, label, amount, due_on) values ($1, 'x', 1, current_date)`, [impact]);
    assert(inst.error?.message.includes('payment_impact_free'), 'an Impact project took an instalment');
  });
  await check('D impact: market value → checkpoints and a document → close → the counters move; paid figures do not', async () => {
    const summary = async () => (await q1(U.owner, `select * from impact_support_summary()`))[0];
    const paid = async () => JSON.stringify(await q1(U.owner, `select bucket, currency, items, value from portal_sales_summary() order by 1, 2`));
    const paidBefore = await paid();
    await q1(U.owner, `update projects set market_value = 900000 where id = $1`, [impact]);
    const s1 = await summary();
    assert(Number(s1.committed) >= 900000, JSON.stringify(s1));
    await q1(U.owner, `update projects set market_value = 950000 where id = $1`, [impact]);
    const log = await q1(U.owner, `select metadata from activity_logs where entity_id = $1 and action = 'project.market_value_changed' order by created_at`, [impact]);
    assert(log.length === 2, `value changes logged: ${log.length}`);
    const [d] = await q1(U.owner, `select * from document_begin_upload($1, null, 'Terv.pdf', 5, null, 'pdf')`, [impact]);
    assert(d.id, 'no document on the Impact project');
    await q1(U.owner, `update project_milestones set state = 'done' where project_id = $1`, [impact]);
    const deliveredBefore = Number(s1.delivered);
    await q1(U.owner, `update projects set status = 'completed' where id = $1 and status <> 'completed' returning id`, [impact]);
    const s2 = await summary();
    assert(Number(s2.delivered) === deliveredBefore + 950000, `delivered ${s2.delivered}`);
    await q1(U.owner, `update projects set archived_at = now() where id = $1`, [impact]);
    assert(Number((await summary()).delivered) === Number(s2.delivered), 'archiving moved the counter');
    await q1(U.owner, `update projects set archived_at = null, status = 'active' where id = $1`, [impact]);
    const s3 = await summary();
    assert(Number(s3.delivered) === deliveredBefore && Number(s3.committed) >= 950000, `reopen ${JSON.stringify(s3)}`);
    await q1(U.owner, `update projects set status = 'cancelled' where id = $1`, [impact]);
    const s4 = await summary();
    assert(Number(s4.cancelled_projects) >= 1 && Number(s4.committed) === Number(s3.committed) - 950000, `cancel ${JSON.stringify(s4)}`);
    assert(await paid() === paidBefore, 'an Impact change moved a paid figure');
  });

  await c.end(); await su.end();
}

/* ------------------------------------------------------------------ main */

try {
  await roles();
  await scenarioClean();
  const db = await scenarioUpgrade();
  await scenarioConcurrency(db);
  await scenarioJourneys(db);
} catch (e) {
  results.push({ name: 'harness', ok: false, error: e.stack });
  console.error(e);
} finally {
  if (process.env.KEEP !== '1') {
    const admin = await connect(new URL(BASE_URL).pathname.slice(1) || 'postgres');
    for (const d of created) await admin.query(`drop database if exists ${d} with (force)`).catch(() => {});
    await admin.end();
  }
}
const failed = results.filter((r) => !r.ok);
report.results = results;
if (process.env.REPORT) writeFileSync(process.env.REPORT, JSON.stringify(report, null, 2));
console.log(`\n${report.server}\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);

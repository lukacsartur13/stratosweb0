// =============================================================================
// The release, rehearsed on a LOCAL Supabase stack (`supabase start`).
//
//     LIVE_DB_URL=<DB_URL from `supabase status -o env`> \
//     LIVE_SUPABASE_URL=http://127.0.0.1:54321 \
//     LIVE_SUPABASE_SECRET_KEY=<local server key from `supabase status`> \
//     LIVE_CONFIRM_LOCAL=yes PG_CLIENT_DIR=<folder with node_modules/pg> \
//     OWNER_CREDENTIALS_FILE=<a file outside the repo, mode 600> \
//     node scripts/local-supabase-release.mjs
//
// What it does, in supabase/PORTAL_RELEASE.md §4 order (step numbers as there):
//   1. the schema production is on today (migrations up to 20260816000100) and
//      representative old rows — single-sum payment figures, Impact leads (one
//      already sold), a project member, client profiles;
//   2. every preflight (read-only), migration, owner designation and verify, as
//      `postgres` — which on Supabase is NOT a superuser but has BYPASSRLS, the
//      same role the SQL editor uses;
//   3. the local test owner is a real GoTrue user created through the Auth admin
//      API; its generated password goes ONLY to OWNER_CREDENTIALS_FILE (for the
//      browser check), never to the console.
//
// LOCAL ONLY: both URLs must point at localhost / 127.0.0.1 / ::1, and
// LIVE_CONFIRM_LOCAL=yes is required. Run it on a freshly reset stack
// (`supabase db reset` with an EMPTY migrations folder) — it refuses a
// database that already has the portal's tables.
// Exit 0 = every step ok, 1 = a step failed, 2 = refused to run.
// =============================================================================
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const ROOT = resolve(import.meta.dirname, '..');
const MIG = join(ROOT, 'supabase', 'migrations');
const CHK = join(ROOT, 'supabase', 'checks');
const read = (d, f) => readFileSync(join(d, f), 'utf8');
const refuse = (why) => { console.error(`local-supabase-release: refusing to run — ${why}`); process.exit(2); };

const LOCAL = (u) => { try { const h = new URL(u).hostname; return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(h); } catch { return false; } };
const DB = process.env.LIVE_DB_URL ?? '';
const API = process.env.LIVE_SUPABASE_URL ?? '';
const SERVER = process.env.LIVE_SUPABASE_SECRET_KEY ?? '';
const ANON = process.env.LIVE_SUPABASE_ANON_KEY ?? '';
if (!LOCAL(DB)) refuse('LIVE_DB_URL is not a local database');
if (!LOCAL(API)) refuse('LIVE_SUPABASE_URL is not a local Supabase');
if (process.env.LIVE_CONFIRM_LOCAL !== 'yes') refuse('set LIVE_CONFIRM_LOCAL=yes');
if (!SERVER || !ANON) refuse('LIVE_SUPABASE_SECRET_KEY and LIVE_SUPABASE_ANON_KEY are required');
if (!process.env.OWNER_CREDENTIALS_FILE) refuse('OWNER_CREDENTIALS_FILE is required (outside the repository)');
if (resolve(process.env.OWNER_CREDENTIALS_FILE).startsWith(ROOT)) refuse('OWNER_CREDENTIALS_FILE must be outside the repository');

const require = createRequire(process.env.PG_CLIENT_DIR ? join(process.env.PG_CLIENT_DIR, 'x.js') : import.meta.url);
let pg;
try { pg = require('pg'); } catch { refuse('the `pg` client is not installed; set PG_CLIENT_DIR'); }

const db = new pg.Client({ connectionString: DB });
await db.connect();
const who = (await db.query(`select current_user, rolsuper, rolbypassrls from pg_roles where rolname = current_user`)).rows[0];
if (who.current_user !== 'postgres') refuse(`connected as ${who.current_user}, not postgres (the SQL editor's role)`);
if ((await db.query(`select to_regclass('public.projects') is not null as x`)).rows[0].x) {
  refuse('this database already has the portal schema — reset the local stack first');
}
const admin = createClient(API, SERVER, { auth: { persistSession: false, autoRefreshToken: false } });

const results = [];
async function step(name, fn) {
  try { const note = await fn(); results.push(true); console.log(`  ok   ${name}${note ? ` — ${note}` : ''}`); }
  catch (e) { results.push(false); console.log(`  FAIL ${name}\n       ${String(e.message).split('\n')[0]}`); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const files = readdirSync(MIG).filter((f) => /^\d+_[a-z_]+\.sql$/.test(f)).sort();
const BASELINE = '20260816000100_revenue_operations.sql';

console.log(`local-supabase-release as ${who.current_user} (superuser: ${who.rolsuper}, bypassrls: ${who.rolbypassrls})`);

// ------------------------------------------------ 1. today's production shape
await step('baseline: the migrations production already has (…20260816000100)', async () => {
  for (const f of files.filter((x) => x <= BASELINE)) await db.query(read(MIG, f));
});

const email = { owner: 'owner-local@example.invalid', super2: 'super2-local@example.invalid', admin: 'admin-local@example.invalid', delegate: 'info-local@example.invalid', team: 'team-local@example.invalid' };
const ids = {};
const credentials = {};
await step('real GoTrue users: the local test owner and the staff', async () => {
  for (const [k, addr] of Object.entries(email)) {
    const password = randomBytes(18).toString('base64url') + 'aA1';
    const { data, error } = await admin.auth.admin.createUser({ email: addr, password, email_confirm: true });
    if (error) throw new Error(`${k}: ${error.message}`);
    ids[k] = data.user.id;
    credentials[k] = { email: addr, password };
  }
  await db.query(`update profiles set role = 'super_admin' where id = any($1)`, [[ids.owner, ids.super2]]);
  await db.query(`update profiles set role = 'admin' where id = any($1)`, [[ids.admin, ids.delegate]]);
  await db.query(`update profiles set role = 'team_member' where id = $1`, [ids.team]);
  writeFileSync(process.env.OWNER_CREDENTIALS_FILE, JSON.stringify({ ...credentials, ids }, null, 2), { mode: 0o600 });
  return 'passwords written to OWNER_CREDENTIALS_FILE only';
});

await step('representative old rows (legacy payments, Impact leads, a member)', async () => {
  await db.query(`
    insert into organizations (id, name, slug, status) values
      ('00000000-0000-4000-8000-000000000101', 'Régi Ügyfél Kft.', 'regi-ugyfel', 'active'),
      ('00000000-0000-4000-8000-000000000102', 'Másik Cég Bt.', 'masik-ceg', 'active');
    insert into leads (id, name, company, email, form_type, source, status, created_at) values
      ('00000000-0000-4000-8000-000000000401', 'Kiss Anna', 'Zöld Kör', 'anna@zold.example', 'impact', 'impact', 'contacted', '2026-08-20'),
      ('00000000-0000-4000-8000-000000000402', 'Nagy Béla', 'Régi Alapítvány', 'bela@regi.example', null, 'impact', 'new', '2026-08-21'),
      ('00000000-0000-4000-8000-000000000403', 'Tóth Cili', 'Sold Impact Kft.', 'cili@sold.example', 'impact', 'impact', 'won', '2026-08-22');
    insert into opportunities (id, title, company_name, stage, lead_id, estimated_value, currency, next_action, next_action_on) values
      ('00000000-0000-4000-8000-000000000501', 'Sold Impact (legacy conflict)', 'Sold Impact Kft.', 'won', '00000000-0000-4000-8000-000000000403', 900000, 'HUF', null, null),
      ('00000000-0000-4000-8000-000000000502', 'Régi ügyfél webshop', 'Régi Ügyfél Kft.', 'proposal', null, 1200000, 'HUF', 'Ajánlat küldése', current_date - 2);
    insert into projects (id, organization_id, name, slug, status, value, currency, payment_state, invoiced_amount, paid_amount) values
      ('00000000-0000-4000-8000-000000000601', '00000000-0000-4000-8000-000000000101', 'Régi weboldal', 'regi-web', 'active', 1500000, 'HUF', 'partially_paid', 1500000, 500000),
      ('00000000-0000-4000-8000-000000000602', '00000000-0000-4000-8000-000000000101', 'Régi arculat', 'regi-arculat', 'active', 800000, 'HUF', 'paid', null, null),
      ('00000000-0000-4000-8000-000000000603', '00000000-0000-4000-8000-000000000102', 'Másik hosting', 'masik-host', 'active', null, 'EUR', 'not_invoiced', null, null);
    insert into project_members (project_id, user_id) values ('00000000-0000-4000-8000-000000000601', $1);
  `.replace('$1', `'${ids.team}'`));
});

await step('legacy-data-review.sql on today\'s schema (read-only): the doubtful cases, from the rows', async () => {
  const r = await db.query(read(CHK, 'legacy-data-review.sql'));
  const sets = (Array.isArray(r) ? r : [r]).filter((x) => x.command === 'SELECT');
  const found = sets[0].rows.filter((x) => Number(x.rows) > 0).map((x) => `${x.category.split(':')[0]}:${x.rows}`);
  assert((await db.query(`select count(*)::int as n from projects`)).rows[0].n === 3, 'the review changed rows');
  return `${sets.length} result sets; non-zero: ${found.join(', ')}`;
});

// ------------------------------------------------ 2. the release, in order
async function verify(file) {
  await db.query(read(CHK, file).replace(/rollback;\s*$/, ''));
  const rows = (await db.query('select check_name, ok, detail from verify_result')).rows;
  await db.query('rollback');
  const bad = rows.filter((r) => !r.ok);
  assert(bad.length === 0, bad.map((r) => `${r.check_name}: ${r.detail ?? ''}`).join('; '));
  return `${rows.length} rows ok`;
}
async function preflight(file, col) {
  const r = await db.query(read(CHK, file));
  const first = (Array.isArray(r) ? r[0] : r).rows;
  const bad = first.filter((x) => x[col] === false);
  assert(bad.length === 0, `false: ${bad.map((x) => Object.values(x)[0]).join(', ')}`);
  return `${first.length} rows`;
}
// The maintenance gate, exercised through the real API: an owner session
// (writes refused, reads fine) and the server key (the lead form keeps working).
const ownerApi = createClient(API, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
async function probeWrites() {
  if (!(await ownerApi.auth.getSession()).data.session) await ownerApi.auth.signInWithPassword(credentials.owner);
  const w = await ownerApi.from('organizations').insert({ name: 'Gate probe', slug: `gate-${Date.now()}` }).select('id');
  const r = await ownerApi.from('organizations').select('id').limit(1);
  const lead = await admin.from('leads').insert({ name: 'Gate lead', email: 'gate@example.invalid', form_type: 'contact', source: 'release-rehearsal' }).select('id');
  return { write: w.error ? w.error.code : 'ok', read: r.error ? r.error.code : 'ok', lead: lead.error ? lead.error.code : 'ok' };
}
const waitFor = async (want) => {
  for (let i = 0; i < 30; i += 1) { const p = await probeWrites(); if (p.write === want) return p; await new Promise((x) => setTimeout(x, 500)); }
  return probeWrites();
};
let windowStart = 0;
const release = [
  ['4. role check', async () => { assert(who.rolbypassrls || who.rolsuper, 'no BYPASSRLS'); }],
  ['5. maintenance-on.sql: signed-in writes refused, reads and the lead form keep working', async () => {
    windowStart = Date.now();
    await db.query(read(CHK, 'maintenance-on.sql'));
    const p = await waitFor('25006');
    assert(p.write === '25006' && p.read === 'ok' && p.lead === 'ok', JSON.stringify(p));
    return JSON.stringify(p);
  }],
  ['6. owner-tracker-preflight.sql', () => preflight('owner-tracker-preflight.sql', 'present')],
  ['7. 20260928000100_owner_tracker_enums.sql', () => db.query(read(MIG, '20260928000100_owner_tracker_enums.sql'))],
  ['8. 20260928000200_owner_tracker.sql', () => db.query(read(MIG, '20260928000200_owner_tracker.sql'))],
  ['9. portal_set_owner(<local test owner>)', async () => {
    await db.query(`select portal_set_owner($1)`, [email.owner]);
    const r = (await db.query(`select p.email, p.role::text from portal_owner o join profiles p on p.id = o.user_id`)).rows;
    assert(r.length === 1 && r[0].role === 'super_admin', JSON.stringify(r));
  }],
  ['10. 20260928000300_owner_lockdown.sql', () => db.query(read(MIG, '20260928000300_owner_lockdown.sql'))],
  ['11. owner-tracker-verify.sql', () => verify('owner-tracker-verify.sql')],
  ['12. impact-preflight.sql', () => preflight('impact-preflight.sql', 'ok')],
  ['13. 20260929000100_project_links_url_check.sql', () => db.query(read(MIG, '20260929000100_project_links_url_check.sql'))],
  ['14. 20260929000200_impact_enums.sql', () => db.query(read(MIG, '20260929000200_impact_enums.sql'))],
  ['15. 20260929000300_impact_program.sql', async () => {
    const r = await db.query(read(MIG, '20260929000300_impact_program.sql'));
    const last = (Array.isArray(r) ? r : [r]).filter((x) => x.rows?.length).pop();
    return JSON.stringify(last?.rows?.[0]);
  }],
  ['16. impact-verify.sql', () => verify('impact-verify.sql')],
  ['17. documents-preflight.sql', () => preflight('documents-preflight.sql', 'ok')],
  ['18. 20260930000100_document_library.sql', () => db.query(read(MIG, '20260930000100_document_library.sql'))],
  ['19. documents-verify.sql', () => verify('documents-verify.sql')],
  ['20. 20261001000100_client_portal.sql', () => db.query(read(MIG, '20261001000100_client_portal.sql'))],
  ['21. client-portal-verify.sql', () => verify('client-portal-verify.sql')],
  ['22. legacy-data-review.sql (read-only)', async () => { const r = await db.query(read(CHK, 'legacy-data-review.sql')); const sets = (Array.isArray(r) ? r : [r]).filter((x) => x.command === 'SELECT'); return `${sets[0].rows.filter((x) => Number(x.rows) > 0).length} non-empty categories`; }],
  ['23. 20261002000100_payment_schedule.sql', async () => {
    const r = await db.query(read(MIG, '20261002000100_payment_schedule.sql'));
    const last = (Array.isArray(r) ? r : [r]).filter((x) => x.rows?.length && 'carried' in x.rows[0]).pop();
    return JSON.stringify(last?.rows?.[0]);
  }],
  ['24. payment-schedule-verify.sql', () => verify('payment-schedule-verify.sql')],
  ['25. 20261003000100_owner_delegates.sql', () => db.query(read(MIG, '20261003000100_owner_delegates.sql'))],
  ['26. portal_add_delegate(<local test admin>)', async () => { await db.query(`select portal_add_delegate($1)`, [email.delegate]); }],
  ['27. owner-delegates-verify.sql', () => verify('owner-delegates-verify.sql')],
  ['27b. through the real API: the delegate admin reads projects, another admin does not', async () => {
    const see = async (who) => {
      const c = createClient(API, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
      await c.auth.signInWithPassword(credentials[who]);
      const r = await c.from('projects').select('id');
      const o = await c.rpc('is_owner');
      return `${who}: is_owner=${o.data} projects=${r.error ? r.error.code : r.data.length}`;
    };
    const d = await see('delegate'); const a = await see('admin');
    assert(/is_owner=true projects=[1-9]/.test(d) && /is_owner=false projects=0/.test(a), `${d}; ${a}`);
    return `${d}; ${a}`;
  }],
  ['27c. 20261004000100_client_demos_meetings_help.sql', () => db.query(read(MIG, '20261004000100_client_demos_meetings_help.sql'))],
  ['27d. 20261004000200_help_seed.sql', () => db.query(read(MIG, '20261004000200_help_seed.sql'))],
  ['27f. 20261005000100_client_feedback_reschedule.sql', () => db.query(read(MIG, '20261005000100_client_feedback_reschedule.sql'))],
  ['27e. client-extras-verify.sql', () => verify('client-extras-verify.sql')],
  ['28. maintenance-off.sql: writes accepted again', async () => {
    await db.query(read(CHK, 'maintenance-off.sql'));
    const p = await waitFor('ok');
    assert(p.write === 'ok' && p.read === 'ok', JSON.stringify(p));
    return `window (SQL part) lasted ${Math.round((Date.now() - windowStart) / 1000)} s`;
  }],
];
const listed = release.map(([n]) => n.match(/(\d{14}_[a-z_]+\.sql)/)?.[1]).filter(Boolean);
await step('the release order lists every migration after the baseline', async () => {
  assert(JSON.stringify(listed) === JSON.stringify(files.filter((f) => f > BASELINE)), `listed ${listed.join(', ')}`);
});
for (const [name, fn] of release) await step(name, async () => { const r = await fn(); return typeof r === 'string' ? r : undefined; });

await step('the bucket exists in real Storage with the documented settings', async () => {
  const { data, error } = await admin.storage.getBucket('project-documents');
  assert(!error, error?.message);
  assert(data.public === false && Number(data.file_size_limit) === 52428800
    && JSON.stringify(data.allowed_mime_types) === '["application/octet-stream"]', JSON.stringify(data));
});

await db.end();
console.log(`\n${results.filter(Boolean).length}/${results.length} release steps ok`);
process.exit(results.every(Boolean) ? 0 : 1);

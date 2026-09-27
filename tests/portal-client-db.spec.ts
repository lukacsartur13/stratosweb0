import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

/**
 * Phase 4 — client accounts, sharing and raw-material uploads, against a real
 * Postgres (PGlite) with the same Storage catalogue stand-in as
 * tests/portal-documents-db.spec.ts (see there for what it is and is not).
 *
 * PGLITE ONLY. No Supabase Auth, PostgREST or Storage server is involved: an
 * "auth user" here is a row in a three-column stand-in, a "signed upload link"
 * is the INSERT policy tested as the caller (`canSign`), and "the upload" is the
 * superuser insert Storage performs with a token (`storeObject`). The live
 * counterpart is scripts/client-portal-live-check.mjs.
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

async function ownerUpload(db: PGlite, project: string, name: string, folder: string | null = null) {
  const [d] = await ok(db, 'owner', `select * from document_begin_upload($1, $2, $3, 5, null, 'pdf')`, [project, folder, name]);
  await storeObject(db, d.storage_path as string, 5);
  await ok(db, 'owner', `select document_finish_upload($1)`, [d.id]);
  return d as { id: string; storage_path: string; name: string };
}
async function folder(db: PGlite, project: string, name: string, parent: string | null = null) {
  const [f] = await ok(db, 'owner', `insert into document_folders (project_id, parent_id, name) values ($1, $2, $3) returning id`, [project, parent, name]);
  return f.id as string;
}
const share = (db: PGlite, account: string, project: string, target: { doc?: string; folder?: string }) =>
  as(db, 'owner', `insert into document_shares (account_id, project_id, document_id, folder_id) values ($1, $2, $3, $4) returning id`,
    [account, project, target.doc ?? null, target.folder ?? null]);
const visibleDocs = async (db: PGlite, who: Who) =>
  (await ok(db, who, `select name from client_portal_documents() order by name`)).map((r) => r.name);

/* ============================================================ structure == */

test.describe('structure', () => {
  let db: PGlite;
  test.beforeAll(async () => { db = await fresh(); });

  test('the definer functions that read projects or the library are exactly the client API', async () => {
    const r = await db.query<{ proname: string }>(`
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef and p.prorettype <> 'trigger'::regtype
        and p.prosrc ~* '\\m(projects|project_milestones|project_costs|project_links|impact_applications|project_documents|document_folders|document_shares|client_project_access|client_accounts)\\M'
      order by 1`);
    expect(r.rows.map((x) => x.proname)).toEqual([
      'client_account_id', 'client_begin_upload', 'client_finish_upload', 'client_has_project', 'client_mark_upload',
      'client_may_read_document', 'client_may_read_object', 'client_may_upload_object', 'client_own_upload',
      'client_portal_documents', 'client_portal_me', 'client_portal_projects', 'client_portal_uploads',
    ]);
    expect((await db.query(`select table_name from information_schema.views where table_schema = 'public'`)).rows).toEqual([]);
  });

  test('what the client API can return: fixed columns, none of them internal', async () => {
    const r = await db.query<{ proname: string; cols: string[] }>(`
      select p.proname, p.proargnames[p.pronargs + 1:] as cols from pg_proc p
      where p.proname in ('client_portal_me', 'client_portal_projects', 'client_portal_documents', 'client_portal_uploads')
      order by 1`);
    expect(Object.fromEntries(r.rows.map((x) => [x.proname, x.cols]))).toEqual({
      client_portal_documents: ['document_id', 'project_id', 'project_name', 'name', 'byte_size', 'shared_at', 'via_folder'],
      client_portal_me: ['full_name', 'company'],
      client_portal_projects: ['project_id', 'project_name'],
      client_portal_uploads: ['document_id', 'project_id', 'project_name', 'name', 'byte_size', 'uploaded_at', 'state', 'failure_reason'],
    });
  });

  test('no DELETE on any phase-4 table; anon has nothing', async () => {
    for (const t of ['client_accounts', 'client_project_access', 'document_shares', 'client_invite_log']) {
      const r = await db.query(`select has_table_privilege('authenticated', $1, 'delete') as d, has_table_privilege('anon', $1, 'select') as a`, [t]);
      expect(r.rows[0], t).toEqual({ d: false, a: false });
    }
    expect((await db.query(`select has_function_privilege('anon', 'client_begin_upload(uuid, text, bigint, text, text)', 'execute') as x`)).rows[0].x).toBe(false);
  });
});

/* ============================================================== invite == */

test.describe('inviting', () => {
  let db: PGlite;
  test.beforeAll(async () => { db = await fresh(); });

  test('an account opens nothing until it is attached; then exactly its projects', async () => {
    const acct = await invite(db, ORG.a, 'Anna', 'Anna@A.example ', [P.a1]);
    // Prepared (the auth user was created, but the attach step failed): nothing.
    expect(await ok(db, 'a1', `select * from client_portal_projects()`)).toEqual([]);
    await ok(db, 'owner', `select client_invite_attach($1, $2)`, [acct, U.a1]);
    expect(await ok(db, 'a1', `select * from client_portal_projects()`)).toEqual([{ project_id: P.a1, project_name: 'A website' }]);
    expect((await db.query(`select organization_id, role from profiles where id = $1`, [U.a1])).rows[0])
      .toEqual({ organization_id: ORG.a, role: 'client' });
  });

  test('inviting again reuses the account, adds projects, never duplicates', async () => {
    const again = await invite(db, ORG.a, 'Anna Kovács', 'anna@a.example', [P.a1, P.a2]);
    const rows = (await db.query(`select id, full_name, invite_count from client_accounts where email = 'anna@a.example'`)).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: again, full_name: 'Anna Kovács', invite_count: 2 });
    expect((await db.query(`select count(*)::int as n from client_project_access where account_id = $1 and revoked_at is null`, [again])).rows[0].n).toBe(2);
    // Attaching again (a retry) is a no-op.
    await ok(db, 'owner', `select client_invite_attach($1, $2)`, [again, U.a1]);
  });

  test('a staff address is refused and its role is untouched', async () => {
    for (const email of ['admin@example.invalid', 'team@example.invalid', 'super2@example.invalid', 'owner@example.invalid']) {
      const r = await as(db, 'owner', `select * from client_invite_prepare($1, null, 'X', $2, '{}')`, [ORG.a, email]);
      expect(r.error?.message, email).toMatch(/client_email_is_staff/);
    }
    expect((await db.query(`select role from profiles where id = $1`, [U.admin])).rows[0].role).toBe('admin');
  });

  test('another company\'s account is never switched over', async () => {
    await invite(db, ORG.b, 'Cili', 'cili@b.example', [P.b1], U.b1);
    const r = await as(db, 'owner', `select * from client_invite_prepare($1, null, 'Cili', 'cili@b.example', $2::uuid[])`, [ORG.a, [P.a1]]);
    expect(r.error?.message).toMatch(/client_other_company/);
    expect((await db.query(`select organization_id from profiles where id = $1`, [U.b1])).rows[0].organization_id).toBe(ORG.b);
    // A project of another company cannot be assigned either.
    const cross = await as(db, 'owner', `select * from client_invite_prepare($1, null, 'Anna', 'anna@a.example', $2::uuid[])`, [ORG.a, [P.b1]]);
    expect(cross.error?.message).toMatch(/client_project_other_company/);
  });

  test('attach links only the user whose own profile carries the address', async () => {
    const acct = await invite(db, ORG.a, 'Béla', 'bela@a.example', [P.a1]);
    for (const user of [U.stranger, U.admin, U.b1]) {
      const r = await as(db, 'owner', `select client_invite_attach($1, $2)`, [acct, user]);
      expect(r.error?.message, user).toMatch(/client_user_mismatch|client_email_is_staff|client_other_company/);
    }
    await ok(db, 'owner', `select client_invite_attach($1, $2)`, [acct, U.a2]);
    const relink = await as(db, 'owner', `select client_invite_attach($1, $2)`, [acct, U.stranger]);
    expect(relink.error?.message).toMatch(/client_user_fixed/);
  });

  test('only the owner can invite, attach or read accounts', async () => {
    for (const who of [...STAFF, 'a1', 'b1', 'anon'] as Who[]) {
      const r = await as(db, who, `select * from client_invite_prepare($1, null, 'X', 'x@a.example', '{}')`, [ORG.a]);
      expect(r.error?.code, who).toBe('42501');
      const acc = await as(db, who, `select count(*)::int as n from client_accounts`);
      expect(acc.error ? 0 : acc.rows[0].n, who).toBe(0);
    }
  });

  test('invitations are limited on the server: 30 an hour', async () => {
    const db2 = await fresh();
    for (let i = 0; i < 30; i += 1) await invite(db2, ORG.a, `N${i}`, `n${i}@a.example`, []);
    const r = await as(db2, 'owner', `select * from client_invite_prepare($1, null, 'N', 'n99@a.example', '{}')`, [ORG.a]);
    expect(r.error?.message).toMatch(/invite_limit/);
  });
});

/* ======================================================== client view == */

test.describe('what a client can see', () => {
  let db: PGlite;
  let anna: string;
  test.beforeAll(async () => {
    db = await fresh();
    anna = await invite(db, ORG.a, 'Anna', 'anna@a.example', [P.a1], U.a1);
    await invite(db, ORG.b, 'Cili', 'cili@b.example', [P.b1], U.b1);
    const d = await ownerUpload(db, P.a1, 'offer.pdf');
    await share(db, anna, P.a1, { doc: d.id });
  });

  test('no internal table answers a client, whatever the id', async () => {
    for (const t of ['projects', 'project_milestones', 'project_costs', 'project_links', 'record_notes',
      'project_documents', 'document_folders', 'document_shares', 'client_project_access', 'client_accounts',
      'checkpoint_templates', 'activity_logs', 'impact_applications']) {
      for (const who of ['a1', 'b1'] as Who[]) {
        const r = await as(db, who, `select count(*)::int as n from ${t}`);
        expect(r.error ? 0 : r.rows[0].n, `${who} ${t}`).toBe(0);
      }
    }
  });

  test('the API answers carry no checkpoint, note, blocker, money or market value', async () => {
    const all = JSON.stringify([
      await ok(db, 'a1', `select * from client_portal_me()`),
      await ok(db, 'a1', `select * from client_portal_projects()`),
      await ok(db, 'a1', `select * from client_portal_documents()`),
      await ok(db, 'a1', `select * from client_portal_uploads()`),
    ]);
    expect(all).toContain('A website');
    expect(all).toContain('offer.pdf');
    expect(all).not.toMatch(/Secret internal reason|Chase them|Internal note|1500000|500000|market|checkpoint|blocked|Content/);
  });

  test('a client sees only their own company\'s assigned projects', async () => {
    expect((await ok(db, 'b1', `select project_name from client_portal_projects()`)).map((r) => r.project_name)).toEqual(['B brand']);
    expect(await visibleDocs(db, 'b1')).toEqual([]);
  });

  test('staff roles are not clients: the client API gives them nothing', async () => {
    for (const who of [...STAFF, 'owner'] as Who[]) {
      expect(await ok(db, who, `select * from client_portal_projects()`), who).toEqual([]);
      expect(await ok(db, who, `select * from client_portal_documents()`), who).toEqual([]);
    }
  });
});

/* ============================================================ sharing == */

test.describe('sharing, inheritance, moves and revocation', () => {
  let db: PGlite;
  let anna: string;
  let bela: string;
  let cili: string;
  test.beforeAll(async () => {
    db = await fresh();
    anna = await invite(db, ORG.a, 'Anna', 'anna@a.example', [P.a1], U.a1);
    bela = await invite(db, ORG.a, 'Béla', 'bela@a.example', [P.a1], U.a2);
    cili = await invite(db, ORG.b, 'Cili', 'cili@b.example', [P.b1], U.b1);
  });

  test('every file is private until shared, and a share is for one account', async () => {
    const d = await ownerUpload(db, P.a1, 'private.pdf');
    expect(await visibleDocs(db, 'a1')).toEqual([]);
    expect(await canRead(db, 'a1', d.storage_path)).toBe(false);
    expect((await share(db, anna, P.a1, { doc: d.id })).error).toBeNull();
    expect(await visibleDocs(db, 'a1')).toEqual(['private.pdf']);
    expect(await canRead(db, 'a1', d.storage_path)).toBe(true);
    expect(await visibleDocs(db, 'a2')).toEqual([]);            // same project, not shared with Béla
    expect(await canRead(db, 'a2', d.storage_path)).toBe(false);
  });

  test('a share needs a live assignment to that project; another company cannot be given one', async () => {
    const d = await ownerUpload(db, P.a1, 'x.pdf');
    expect((await share(db, cili, P.a1, { doc: d.id })).error?.message).toMatch(/share_not_assigned/);
    const other = await ownerUpload(db, P.b1, 'b.pdf');
    // A document of another project, under this project's id: the FK refuses it.
    expect((await share(db, anna, P.a1, { doc: other.id })).error?.code).toBe('23503');
  });

  test('a folder share reaches subfolders and files added later — through the current tree', async () => {
    const top = await folder(db, P.a1, 'Deliverables');
    const sub = await folder(db, P.a1, 'Logos', top);
    await share(db, anna, P.a1, { folder: top });
    const later = await ownerUpload(db, P.a1, 'logo-final.pdf', sub);
    expect(await visibleDocs(db, 'a1')).toContain('logo-final.pdf');
    const via = (await ok(db, 'a1', `select via_folder from client_portal_documents() where name = 'logo-final.pdf'`))[0].via_folder;
    expect(via).toBe('Deliverables');

    // Moved out of the shared tree: the inherited route ends at once.
    await ok(db, 'owner', `select document_move($1, null)`, [later.id]);
    expect(await visibleDocs(db, 'a1')).not.toContain('logo-final.pdf');
    expect(await canRead(db, 'a1', later.storage_path)).toBe(false);

    // A direct share survives a move.
    await share(db, anna, P.a1, { doc: later.id });
    await ok(db, 'owner', `select document_move($1, $2)`, [later.id, sub]);
    await ok(db, 'owner', `select document_move($1, null)`, [later.id]);
    expect(await visibleDocs(db, 'a1')).toContain('logo-final.pdf');
  });

  test('the trash hides everything: a trashed file, and files of a trashed folder', async () => {
    const f = await folder(db, P.a1, 'Photos');
    const inside = await ownerUpload(db, P.a1, 'photo.pdf', f);
    await share(db, anna, P.a1, { folder: f });
    expect(await canRead(db, 'a1', inside.storage_path)).toBe(true);
    await ok(db, 'owner', `select document_trash_folder($1)`, [f]);
    expect(await visibleDocs(db, 'a1')).not.toContain('photo.pdf');
    expect(await canRead(db, 'a1', inside.storage_path)).toBe(false);
    await ok(db, 'owner', `select document_restore_folder($1)`, [f]);
    expect(await canRead(db, 'a1', inside.storage_path)).toBe(true);

    const direct = await ownerUpload(db, P.a1, 'direct-trash.pdf');
    await share(db, anna, P.a1, { doc: direct.id });
    await ok(db, 'owner', `update project_documents set trashed_at = now() where id = $1`, [direct.id]);
    expect(await canRead(db, 'a1', direct.storage_path)).toBe(false);
    // A trashed item cannot be shared.
    expect((await share(db, bela, P.a1, { doc: direct.id })).error?.message).toMatch(/share_not_shareable/);
  });

  test('revoking a share ends it; revoked is final', async () => {
    const d = await ownerUpload(db, P.a1, 'revoke-me.pdf');
    const s = (await share(db, anna, P.a1, { doc: d.id })).rows[0].id as string;
    await ok(db, 'owner', `update document_shares set revoked_at = now() where id = $1`, [s]);
    expect(await canRead(db, 'a1', d.storage_path)).toBe(false);
    const undo = await as(db, 'owner', `update document_shares set revoked_at = null where id = $1`, [s]);
    expect(undo.error?.message).toMatch(/share_revoked_final/);
  });

  test('revoking the project ends every share in it; granting again revives none', async () => {
    const d = await ownerUpload(db, P.a1, 'kept.pdf');
    await share(db, bela, P.a1, { doc: d.id });
    expect(await canRead(db, 'a2', d.storage_path)).toBe(true);
    await ok(db, 'owner', `update client_project_access set revoked_at = now() where id = $1`, [await accessId(db, bela, P.a1)]);
    expect(await ok(db, 'a2', `select * from client_portal_projects()`)).toEqual([]);
    expect(await canRead(db, 'a2', d.storage_path)).toBe(false);
    await ok(db, 'owner', `insert into client_project_access (account_id, project_id) values ($1, $2)`, [bela, P.a1]);
    expect((await ok(db, 'a2', `select project_name from client_portal_projects()`)).length).toBe(1);
    expect(await visibleDocs(db, 'a2')).toEqual([]);
    expect(await canRead(db, 'a2', d.storage_path)).toBe(false);
  });

  test('revoking the account ends everything; inviting again revives no share', async () => {
    const d = await ownerUpload(db, P.a1, 'account-level.pdf');
    await share(db, anna, P.a1, { doc: d.id });
    await ok(db, 'owner', `update client_accounts set status = 'revoked' where id = $1`, [anna]);
    expect(await ok(db, 'a1', `select * from client_portal_projects()`)).toEqual([]);
    expect(await canRead(db, 'a1', d.storage_path)).toBe(false);
    await invite(db, ORG.a, 'Anna', 'anna@a.example', [P.a1]);
    expect((await ok(db, 'a1', `select * from client_portal_projects()`)).length).toBe(1);
    expect(await canRead(db, 'a1', d.storage_path)).toBe(false);
  });

  test('a client with a foreign id gets nothing', async () => {
    const d = await ownerUpload(db, P.b1, 'b-secret.pdf');
    await share(db, cili, P.b1, { doc: d.id });
    for (const who of ['a1', 'a2'] as Who[]) {
      expect(await canRead(db, who, d.storage_path), who).toBe(false);
      expect((await ok(db, who, `select client_may_read_document($1) as x`, [d.id]))[0].x, who).toBe(false);
      const begin = await as(db, who, `select * from client_begin_upload($1, 'x.pdf', 5, null, 'pdf')`, [P.b1]);
      expect(begin.error?.code, who).toBe('42501');
      const finish = await as(db, who, `select client_finish_upload($1)`, [d.id]);
      expect(finish.error?.code, who).toBe('P0002');
      const mark = await as(db, who, `select client_mark_upload($1, 'pending')`, [d.id]);
      expect(mark.error?.code, who).toBe('P0002');
    }
  });
});

/* ======================================================= raw material == */

test.describe('Nyersanyag leadása', () => {
  let db: PGlite;
  let anna: string;
  test.beforeAll(async () => {
    db = await fresh();
    anna = await invite(db, ORG.a, 'Anna', 'anna@a.example', [P.a1, P.a2], U.a1);
    await invite(db, ORG.a, 'Béla', 'bela@a.example', [P.a1], U.a2);
  });

  const begin = async (who: Who, project: string, name: string, size = 5, kind = 'pdf') =>
    as(db, who, `select * from client_begin_upload($1, $2, $3, null, $4)`, [project, name, size, kind]);

  test('an upload lands in the project\'s raw-material folder, through the same lifecycle', async () => {
    const r = await begin('a1', P.a1, 'logo.pdf');
    expect(r.error).toBeNull();
    const d = r.rows[0] as { id: string; storage_path: string };
    const row = (await db.query(`select d.upload_state, d.client_account_id, d.uploaded_by, f.name as folder, f.purpose
      from project_documents d join document_folders f on f.id = d.folder_id where d.id = $1`, [d.id])).rows[0];
    expect(row).toEqual({ upload_state: 'pending', client_account_id: anna, uploaded_by: U.a1,
      folder: 'Ügyféltől érkezett nyersanyagok', purpose: 'client_uploads' });
    expect(await canSign(db, 'a1', d.storage_path)).toBe(true);
    expect(await canSign(db, 'a2', d.storage_path)).toBe(false);       // not Béla's
    expect(await canSign(db, 'owner', d.storage_path)).toBe(false);    // the owner signs only their own
    expect((await ok(db, 'a1', `select client_finish_upload($1) as s`, [d.id]))[0].s).toBe('missing');
    await storeObject(db, d.storage_path, 5);
    expect((await ok(db, 'a1', `select client_finish_upload($1) as s`, [d.id]))[0].s).toBe('ready');
    expect((await ok(db, 'a1', `select client_finish_upload($1) as s`, [d.id]))[0].s).toBe('ready');
    // The owner sees it in the library, with who and when.
    const lib = await ok(db, 'owner', `select name, client_account_id, uploaded_by, created_at from project_documents where id = $1`, [d.id]);
    expect(lib[0]).toMatchObject({ name: 'logo.pdf', client_account_id: anna, uploaded_by: U.a1 });
  });

  test('one raw-material folder per project; a new version is a new file', async () => {
    const r = await begin('a1', P.a1, 'logo.pdf');
    expect((r.rows[0] as { name: string }).name).toBe('logo (2).pdf');
    const folders = await db.query(`select count(*)::int as n from document_folders where project_id = $1 and purpose = 'client_uploads'`, [P.a1]);
    expect(folders.rows[0].n).toBe(1);
  });

  test('a client sees only their own uploads — not another client\'s in the same project', async () => {
    await begin('a2', P.a1, 'bela.pdf');
    const anna = (await ok(db, 'a1', `select name from client_portal_uploads() order by name`)).map((r) => r.name);
    const bela = (await ok(db, 'a2', `select name from client_portal_uploads() order by name`)).map((r) => r.name);
    expect(anna).toEqual(['logo (2).pdf', 'logo.pdf']);
    expect(bela).toEqual(['bela.pdf']);
    // And the raw-material folder is not shared by being written to.
    expect(await visibleDocs(db, 'a1')).toEqual([]);
  });

  test('a client cannot delete, move, rename or overwrite what they handed in', async () => {
    const [d] = await ok(db, 'a1', `select document_id, name from client_portal_uploads() where name = 'logo.pdf'`);
    const docId = d.document_id as string;
    const path = (await db.query(`select storage_path from project_documents where id = $1`, [docId])).rows[0].storage_path as string;
    for (const sql of [
      `update project_documents set name = 'x.pdf' where id = $1`,
      `update project_documents set trashed_at = now() where id = $1`,
      `update project_documents set folder_id = null where id = $1`,
      `delete from project_documents where id = $1`,
    ]) {
      const r = await as(db, 'a1', sql, [docId]);
      expect(r.error !== null || r.affected === 0, sql).toBe(true);
    }
    expect((await as(db, 'a1', `select document_move($1, null)`, [docId])).error).not.toBeNull();
    expect(await canSign(db, 'a1', path)).toBe(false);
    await expect(storeObject(db, path, 99)).rejects.toThrow(/duplicate key|unique/);
    const upd = await as(db, 'a1', `update storage.objects set metadata = '{"size":1}' where name = $1`, [path]);
    expect(upd.affected).toBe(0);
    expect((await as(db, 'a1', `select client_mark_upload($1, 'failed', 'network')`, [docId])).error?.message).toMatch(/client_upload_state/);
  });

  test('types, the 50 MB limit and the per-account limits hold for clients too', async () => {
    expect((await begin('a1', P.a2, 'setup.exe', 5, 'zip')).error?.message).toMatch(/document_type_not_allowed/);
    expect((await begin('a1', P.a2, 'fake.pdf', 5, 'text')).error?.message).toMatch(/document_type_not_allowed/);
    expect((await begin('a1', P.a2, 'big.mp4', 52428801, 'isobmff')).error?.message).toMatch(/document_too_large/);
    const pending = (await db.query(`select count(*)::int as n from project_documents where client_account_id = $1 and upload_state = 'pending'`, [anna])).rows[0].n as number;
    for (let i = pending; i < 10; i += 1) expect((await begin('a1', P.a2, `p${i}.pdf`)).error).toBeNull();
    expect((await begin('a1', P.a2, 'one-too-many.pdf')).error?.message).toMatch(/client_upload_limit/);
  });

  test('retry: a failed upload goes back to pending on the same row; a finished one never does', async () => {
    const [d] = (await begin('a2', P.a1, 'retry.pdf')).rows as { id: string; storage_path: string }[];
    expect((await ok(db, 'a2', `select client_mark_upload($1, 'failed', 'network') as s`, [d.id]))[0].s).toBe('failed');
    expect(await canSign(db, 'a2', d.storage_path)).toBe(false);
    expect((await ok(db, 'a2', `select client_mark_upload($1, 'pending') as s`, [d.id]))[0].s).toBe('pending');
    expect(await canSign(db, 'a2', d.storage_path)).toBe(true);
  });
});

/* ====================================================== revoked mid-way == */

test.describe('access revoked during an upload', () => {
  test('no new link, and a file arriving through an old link never becomes a document', async () => {
    const db = await fresh();
    const bela = await invite(db, ORG.a, 'Béla', 'bela@a.example', [P.a1], U.a2);
    const [d] = (await as(db, 'a2', `select * from client_begin_upload($1, 'late.pdf', 5, null, 'pdf')`, [P.a1])).rows as { id: string; storage_path: string }[];
    expect(await canSign(db, 'a2', d.storage_path)).toBe(true);        // the link is issued now…
    await ok(db, 'owner', `update client_project_access set revoked_at = now() where id = $1`, [await accessId(db, bela, P.a1)]);
    expect(await canSign(db, 'a2', d.storage_path)).toBe(false);       // …and no new one after
    expect((await db.query(`select upload_state, failure_reason from project_documents where id = $1`, [d.id])).rows[0])
      .toEqual({ upload_state: 'failed', failure_reason: 'access_revoked' });
    await storeObject(db, d.storage_path, 5);                          // the old link is used anyway
    expect((await ok(db, 'a2', `select client_finish_upload($1) as s`, [d.id]))[0].s).toBe('failed');
    // Not by the owner's finish, not by the reconcile, not by a PATCH.
    expect((await ok(db, 'owner', `select document_finish_upload($1) as s`, [d.id]))[0].s).not.toBe('ready');
    await ok(db, 'owner', `select * from document_reconcile()`);
    await ok(db, 'owner', `update project_documents set upload_state = 'ready' where id = $1`, [d.id]);
    expect((await db.query(`select upload_state from project_documents where id = $1`, [d.id])).rows[0].upload_state).toBe('failed');
    // It is identifiable: the report lists the object of an unfinished upload.
    const report = await ok(db, 'owner', `select kind from document_storage_report() where storage_path = $1`, [d.storage_path]);
    expect(report).toEqual([{ kind: 'unfinished_object' }]);
  });

  test('a pending upload finished after a revoke-and-regrant still refuses to become ready', async () => {
    const db = await fresh();
    const anna = await invite(db, ORG.a, 'Anna', 'anna@a.example', [P.a1], U.a1);
    const [d] = (await as(db, 'a1', `select * from client_begin_upload($1, 'x.pdf', 5, null, 'pdf')`, [P.a1])).rows as { id: string; storage_path: string }[];
    await ok(db, 'owner', `update client_project_access set revoked_at = now() where id = $1`, [await accessId(db, anna, P.a1)]);
    await ok(db, 'owner', `insert into client_project_access (account_id, project_id) values ($1, $2)`, [anna, P.a1]);
    await storeObject(db, d.storage_path, 5);
    // The row failed at the revoke; a regrant does not resurrect it.
    expect((await ok(db, 'a1', `select client_finish_upload($1) as s`, [d.id]))[0].s).toBe('failed');
    expect((await as(db, 'a1', `select client_mark_upload($1, 'pending')`, [d.id])).error?.message).toMatch(/client_upload_state/);
  });
});

/* ================================================= owner's own uploads == */

test.describe('the owner\'s library is unchanged', () => {
  test('owner uploads, signing and access work as before; clients cannot use the owner\'s paths', async () => {
    const db = await fresh();
    await invite(db, ORG.a, 'Anna', 'anna@a.example', [P.a1], U.a1);
    const [d] = await ok(db, 'owner', `select * from document_begin_upload($1, null, 'own.pdf', 5, null, 'pdf')`, [P.a1]);
    expect(await canSign(db, 'owner', d.storage_path as string)).toBe(true);
    expect(await canSign(db, 'a1', d.storage_path as string)).toBe(false);
    for (const who of STAFF) expect(await canSign(db, who, d.storage_path as string), who).toBe(false);
  });
});

/* ============================================================= checks == */

test.describe('the SQL-editor checks', () => {
  test('verify reads all ok', async () => {
    const db = await fresh();
    await invite(db, ORG.a, 'Anna', 'anna@a.example', [P.a1], U.a1);
    await db.exec(read(CHECKS, 'client-portal-verify.sql').replace(/rollback;\s*$/, ''));
    const rows = (await db.query<{ check_name: string; ok: boolean; detail: string | null }>(`select check_name, ok, detail from verify_result`)).rows;
    await db.exec('rollback');
    expect(rows.length).toBeGreaterThan(5);
    expect(rows.filter((r) => !r.ok)).toEqual([]);
  });

  test('rollback closes the client paths and keeps every account, assignment, share and file', async () => {
    const db = await fresh();
    const anna = await invite(db, ORG.a, 'Anna', 'anna@a.example', [P.a1], U.a1);
    const d = await ownerUpload(db, P.a1, 'kept.pdf');
    await share(db, anna, P.a1, { doc: d.id });
    const [u] = (await as(db, 'a1', `select * from client_begin_upload($1, 'up.pdf', 5, null, 'pdf')`, [P.a1])).rows as { id: string; storage_path: string }[];
    await storeObject(db, u.storage_path, 5);
    await ok(db, 'a1', `select client_finish_upload($1)`, [u.id]);
    const counts = async () => (await db.query(`select
      (select count(*)::int from client_accounts) as accounts, (select count(*)::int from client_project_access) as access,
      (select count(*)::int from document_shares) as shares, (select count(*)::int from project_documents) as docs,
      (select count(*)::int from storage.objects where bucket_id = '${BUCKET}') as objects,
      (select count(*)::int from auth.users) as users`)).rows[0];
    const before = await counts();

    await db.exec(read(CHECKS, 'client-portal-rollback.sql'));
    expect(await counts()).toEqual(before);
    expect(await canRead(db, 'a1', d.storage_path)).toBe(false);
    expect((await as(db, 'a1', `select * from client_portal_projects()`)).error?.code).toBe('42501');
    // The owner's library still works.
    expect(await canRead(db, 'owner', d.storage_path)).toBe(true);
    expect((await ok(db, 'owner', `select count(*)::int as n from project_documents`))[0].n).toBe(before.docs);

    await db.exec(read(MIGRATIONS, '20261001000100_client_portal.sql'));
    expect(await canRead(db, 'a1', d.storage_path)).toBe(true);
  });
});

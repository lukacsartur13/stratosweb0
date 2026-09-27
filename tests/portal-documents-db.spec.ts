import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { ALLOWED_TYPES, extensionOf } from '../portal/src/lib/documentRules';

/**
 * Phase 3 — the owner's document library, against a real Postgres (PGlite).
 *
 * ## What the Storage stand-in is, and is not
 *
 * Supabase Storage keeps its catalogue in `storage.objects` and asks Postgres,
 * with the caller's JWT, whether an operation is allowed. That part is real
 * here: the stand-in creates `storage.buckets` / `storage.objects` with RLS and
 * Supabase's default grants, and every policy in the migration is evaluated by
 * the real planner. The server around it is simulated, as the storage-api
 * source does it (checked 2026-09-27, supabase/storage `master`):
 *
 *   createSignedUploadUrl → `canUpload`: an INSERT tested as the caller and
 *                           rolled back                  → `canSign()` below
 *   upload with the token → `asSuperUser()`, upsert from the TOKEN, a
 *                           duplicate path is 409          → `storeObject()`
 *   download / signed URL → SELECT as the caller          → `as(..., select)`
 *
 * The byte transfer, the bucket's size limit and the token's lifetime are the
 * storage server's, not Postgres's, and are NOT exercised here — see
 * supabase/DOCUMENTS.md §5 and §10 for what was and was not verified.
 */

test.describe.configure({ mode: 'serial' });

const ROOT = process.cwd();
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations');
const CHECKS = path.join(ROOT, 'supabase', 'checks');
const read = (dir: string, file: string) => fs.readFileSync(path.join(dir, file), 'utf8');

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const U = { owner: id(1), super2: id(2), admin: id(3), team: id(4), clientA: id(5) } as const;
const ORG = { a: id(101), b: id(102) };
const P = { a: id(201), b: id(202) };
const BUCKET = 'project-documents';
const MAX = 52428800;

type Who = keyof typeof U | 'anon';
const OTHERS: Who[] = ['super2', 'admin', 'team', 'clientA', 'anon'];

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

  -- Supabase Storage's catalogue, as far as policies can see it.
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

  -- A careless policy somebody wrote for ANOTHER bucket, on a real project.
  -- Permissive policies are ORed, so without the migration's restrictive
  -- guards this alone would open the document bucket to every signed-in user.
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
      ('${U.clientA}', 'a@example.invalid');
    insert into organizations (id, name, slug, status) values
      ('${ORG.a}', 'Client A Kft.', 'client-a', 'active'), ('${ORG.b}', 'Client B Kft.', 'client-b', 'active');
    update profiles set role = 'super_admin' where id in ('${U.owner}', '${U.super2}');
    update profiles set role = 'admin' where id = '${U.admin}';
    update profiles set role = 'team_member' where id = '${U.team}';
    update profiles set organization_id = '${ORG.a}' where id = '${U.clientA}';
    insert into projects (id, organization_id, name, slug, status, value, currency) values
      ('${P.a}', '${ORG.a}', 'A website', 'a-website', 'active', 1500000, 'HUF'),
      ('${P.b}', '${ORG.b}', 'B ads', 'b-ads', 'active', 400000, 'HUF');
    insert into project_milestones (project_id, title, position, state) values ('${P.a}', 'Handover', 0, 'done');
    insert into project_members (project_id, user_id) values ('${P.a}', '${U.clientA}'), ('${P.a}', '${U.team}');
  `);
  await db.query(`select portal_set_owner('owner@example.invalid')`);
  for (const file of files.filter((f) => f > '20260928000200_owner_tracker.sql' && f < '20260930000100')) {
    await db.exec(read(MIGRATIONS, file));
  }
  await db.exec(read(MIGRATIONS, '20260930000100_document_library.sql'));
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

/** Storage's `canUpload` for a signed upload URL: the INSERT, tested as the caller, rolled back. */
async function canSign(db: PGlite, who: Who, objectName: string, bucket = BUCKET) {
  await db.exec('begin');
  try {
    await db.query(`select set_config('request.jwt.claims', $1, true)`,
      [who === 'anon' ? '{}' : JSON.stringify({ sub: U[who], role: 'authenticated' })]);
    await db.exec(`set local role ${who === 'anon' ? 'anon' : 'authenticated'}`);
    await db.query(`insert into storage.objects (bucket_id, name, owner, metadata) values ($1, $2, $3, '{}')`,
      [bucket, objectName, who === 'anon' ? null : U[who]]);
    return true;
  } catch {
    return false;
  } finally {
    await db.exec('rollback');
  }
}

/** The upload through a signed URL: `asSuperUser()`, no upsert. A duplicate path throws (storage answers 409). */
const storeObject = (db: PGlite, objectName: string, size: number) =>
  db.query(`insert into storage.objects (bucket_id, name, owner, metadata) values ($1, $2, $3, $4)`,
    [BUCKET, objectName, U.owner, JSON.stringify({ size, mimetype: 'application/octet-stream' })]);

/** The content kind the browser would have detected for a genuine file of this name. */
const kindFor = (name: string) => ALLOWED_TYPES[extensionOf(name)]?.[0] ?? 'text';
const begin = async (db: PGlite, name: string, size = 1000, folder: string | null = null, project = P.a) => {
  const r = await as(db, 'owner', `select * from document_begin_upload($1, $2, $3, $4, null, $5)`,
    [project, folder, name, size, kindFor(name)]);
  if (r.error) throw new Error(r.error.message);
  return r.rows[0] as { id: string; name: string; storage_path: string };
};
const finish = async (db: PGlite, docId: string, who: Who = 'owner') => {
  const r = await as(db, who, `select document_finish_upload($1) as s`, [docId]);
  if (r.error && who === 'owner') throw new Error(r.error.message);
  return r;
};
const doc = async (db: PGlite, docId: string) =>
  (await db.query<Record<string, unknown>>(`select * from project_documents where id = $1`, [docId])).rows[0];
const upload = async (db: PGlite, name: string, size = 1000, folder: string | null = null, project = P.a) => {
  const d = await begin(db, name, size, folder, project);
  await storeObject(db, d.storage_path, size);
  expect((await finish(db, d.id)).rows[0].s).toBe('ready');
  return d;
};
const folder = async (db: PGlite, name: string, parent: string | null = null, project = P.a) => {
  const r = await as(db, 'owner', `insert into document_folders (project_id, parent_id, name) values ($1, $2, $3) returning id`,
    [project, parent, name]);
  if (r.error) throw new Error(r.error.message);
  return r.rows[0].id as string;
};

/* ============================================================ structure == */

test.describe('structure', () => {
  let db: PGlite;
  test.beforeAll(async () => { db = await fresh(); });

  test('the bucket is private and size-limited, and re-applying keeps it so', async () => {
    const bucket = async () => (await db.query(`select public, file_size_limit::int as lim from storage.buckets where id = $1`, [BUCKET])).rows[0];
    expect(await bucket()).toEqual({ public: false, lim: MAX });
    await db.exec(`update storage.buckets set public = true, file_size_limit = null where id = '${BUCKET}'`);
    await db.exec(read(MIGRATIONS, '20260930000100_document_library.sql'));
    expect(await bucket()).toEqual({ public: false, lim: MAX });
  });

  test('refuses to run before the owner lockdown', async () => {
    const bare = new PGlite({ extensions: { pgcrypto } });
    await bare.exec(STANDIN);
    const files = fs.readdirSync(MIGRATIONS).filter((f) => /^\d+_[a-z_]+\.sql$/.test(f)).sort();
    for (const file of files.filter((f) => f <= '20260928000200_owner_tracker.sql')) await bare.exec(read(MIGRATIONS, file));
    await expect(bare.exec(read(MIGRATIONS, '20260930000100_document_library.sql'))).rejects.toThrow(/owner/);
  });

  test('nobody has DELETE on the tables, anon has nothing at all', async () => {
    const r = await db.query(`select
      has_table_privilege('authenticated', 'project_documents', 'delete') as d1,
      has_table_privilege('authenticated', 'document_folders', 'delete') as d2,
      has_table_privilege('anon', 'project_documents', 'select') as a1,
      has_table_privilege('anon', 'document_folders', 'select') as a2,
      has_function_privilege('anon', 'document_begin_upload(uuid, uuid, text, bigint, text, text)', 'execute') as a3`);
    expect(r.rows[0]).toEqual({ d1: false, d2: false, a1: false, a2: false, a3: false });
  });

  test('no definer function reads the library or projects; no views', async () => {
    const r = await db.query(`
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef
        and p.prosrc ~* '\\m(projects|project_documents|document_folders|storage)\\M'
        and p.prorettype <> 'trigger'::regtype`);
    expect(r.rows).toEqual([]);
    expect((await db.query(`select table_name from information_schema.views where table_schema = 'public'`)).rows).toEqual([]);
  });
});

/* ======================================================= the upload == */

test.describe('upload lifecycle', () => {
  let db: PGlite;
  test.beforeAll(async () => { db = await fresh(); });

  test('the storage key is two ids, never the file name', async () => {
    const d = await begin(db, 'Árajánlat végleges.pdf');
    expect(d.storage_path).toBe(`${P.a}/${d.id}`);
    expect(d.name).toBe('Árajánlat végleges.pdf');
    expect((await doc(db, d.id)).upload_state).toBe('pending');
  });

  test('a signed upload URL can be issued for that one pending path and no other', async () => {
    const d = await begin(db, 'brief.docx');
    expect(await canSign(db, 'owner', d.storage_path)).toBe(true);
    expect(await canSign(db, 'owner', `${P.a}/${id(999)}`)).toBe(false);     // no row
    expect(await canSign(db, 'owner', `${P.a}/brief.docx`)).toBe(false);     // a name, not an id
    expect(await canSign(db, 'owner', `${P.b}/${d.id}`)).toBe(false);        // other project
    for (const who of OTHERS) expect(await canSign(db, who, d.storage_path), who).toBe(false);
  });

  test('finish: missing → stays pending; stored → ready; again → ready', async () => {
    const d = await begin(db, 'photo.jpg', 2048);
    expect((await finish(db, d.id)).rows[0].s).toBe('missing');
    expect((await doc(db, d.id)).upload_state).toBe('pending');
    await storeObject(db, d.storage_path, 2048);
    expect((await finish(db, d.id)).rows[0].s).toBe('ready');
    expect((await finish(db, d.id)).rows[0].s).toBe('ready');
    const row = await doc(db, d.id);
    expect(row.upload_state).toBe('ready');
    expect(row.completed_at).not.toBeNull();
  });

  test('a finished path cannot be signed again, and a link issued earlier cannot overwrite it', async () => {
    // The link is issued while the row is pending — the only time it can be.
    const d = await begin(db, 'contract.pdf');
    expect(await canSign(db, 'owner', d.storage_path)).toBe(true);
    await storeObject(db, d.storage_path, 1000);
    expect((await finish(db, d.id)).rows[0].s).toBe('ready');
    // That same link, used again after the document is finished: Storage's
    // insert (as superuser, no upsert) hits the existing object and fails.
    expect(await canSign(db, 'owner', d.storage_path)).toBe(false);
    await expect(storeObject(db, d.storage_path, 5)).rejects.toThrow(/duplicate key|unique/);
    expect(await doc(db, d.id)).toMatchObject({ upload_state: 'ready', byte_size: 1000 });
    // …and the owner cannot overwrite (upsert) or delete it through the API,
    // even with the careless policy in place: the restrictive guard filters it.
    const upd = await as(db, 'owner', `update storage.objects set metadata = '{"size":5}' where name = $1`, [d.storage_path]);
    expect(upd.affected).toBe(0);
    const del = await as(db, 'owner', `delete from storage.objects where name = $1`, [d.storage_path]);
    expect(del.affected).toBe(0);
    expect((await db.query(`select (metadata->>'size')::int as s from storage.objects where name = $1`, [d.storage_path])).rows)
      .toEqual([{ s: 1000 }]);
  });

  test('ready cannot be claimed without the object, and is final', async () => {
    const d = await begin(db, 'claimed.pdf');
    const forged = await as(db, 'owner', `update project_documents set upload_state = 'ready' where id = $1`, [d.id]);
    expect(forged.error?.message).toMatch(/document_not_uploaded/);
    const done = await upload(db, 'final.pdf');
    const back = await as(db, 'owner', `update project_documents set upload_state = 'pending' where id = $1`, [done.id]);
    expect(back.error?.message).toMatch(/document_ready_final/);
    const resize = await as(db, 'owner', `update project_documents set byte_size = 1 where id = $1`, [done.id]);
    expect(resize.error?.message).toMatch(/document_fact_fixed/);
  });

  test('too large is refused at the start; a wrong-size or oversized object fails the finish', async () => {
    const big = await as(db, 'owner', `select * from document_begin_upload($1, null, 'huge.mov', $2, null, 'isobmff')`, [P.a, MAX + 1]);
    expect(big.error?.message).toMatch(/document_too_large/);

    const d = await begin(db, 'short.pdf', 1000);
    await storeObject(db, d.storage_path, 999);
    expect((await finish(db, d.id)).rows[0].s).toBe('failed');
    expect(await doc(db, d.id)).toMatchObject({ upload_state: 'failed', failure_reason: 'size_mismatch' });

    const e = await begin(db, 'grown.pdf', 1000);
    await storeObject(db, e.storage_path, MAX + 10);
    expect((await finish(db, e.id)).rows[0].s).toBe('failed');
    expect(await doc(db, e.id)).toMatchObject({ upload_state: 'failed', failure_reason: 'too_large' });
  });

  test('a network failure is recorded, retried and finished under the same name and path', async () => {
    const d = await begin(db, 'retry.zip', 4096);
    const fail = await as(db, 'owner', `update project_documents set upload_state = 'failed', failure_reason = 'network' where id = $1`, [d.id]);
    expect(fail.error).toBeNull();
    expect(await canSign(db, 'owner', d.storage_path)).toBe(false);   // failed: no new URL
    await as(db, 'owner', `update project_documents set upload_state = 'pending' where id = $1`, [d.id]);
    expect((await doc(db, d.id)).failure_reason).toBeNull();
    expect(await canSign(db, 'owner', d.storage_path)).toBe(true);
    await storeObject(db, d.storage_path, 4096);
    expect((await finish(db, d.id)).rows[0].s).toBe('ready');
    expect((await doc(db, d.id)).name).toBe('retry.zip');
  });

  test('the upload arrived but the finish was lost: a later finish (or reconcile) completes it', async () => {
    const d = await begin(db, 'lost-finish.pdf');
    await as(db, 'owner', `update project_documents set upload_state = 'failed', failure_reason = 'network' where id = $1`, [d.id]);
    await storeObject(db, d.storage_path, 1000);
    const r = await as(db, 'owner', `select * from document_reconcile()`);
    expect(r.rows[0].finished).toBeGreaterThanOrEqual(1);
    expect((await doc(db, d.id)).upload_state).toBe('ready');
  });

  test('reconcile expires a pending upload older than the TTL, and deletes nothing', async () => {
    const d = await begin(db, 'abandoned.pdf');
    // Four hours pass. created_at is immutable to every caller, so the clock is
    // turned back with the rule trigger briefly off, as the superuser.
    await db.exec('alter table project_documents disable trigger project_documents_rules');
    await db.query(`update project_documents set created_at = now() - interval '4 hours' where id = $1`, [d.id]);
    await db.exec('alter table project_documents enable trigger project_documents_rules');
    const before = (await db.query(`select count(*)::int as n from project_documents`)).rows[0];
    const r = await as(db, 'owner', `select * from document_reconcile()`);
    expect(r.rows[0].expired).toBeGreaterThanOrEqual(1);
    expect(await doc(db, d.id)).toMatchObject({ upload_state: 'failed', failure_reason: 'expired' });
    expect((await db.query(`select count(*)::int as n from project_documents`)).rows[0]).toEqual(before);
  });

  test('the storage report lists orphans, missing and trashed objects', async () => {
    const orphan = `${P.a}/${id(777)}`;
    await storeObject(db, orphan, 12);
    const gone = await upload(db, 'gone.pdf');
    await db.query(`delete from storage.objects where name = $1`, [gone.storage_path]);   // lost behind our back
    const swapped = await upload(db, 'swapped.pdf');
    // Removed by hand in the dashboard, then recreated by a link issued while
    // it was pending: a different object under a finished document.
    // (Delete + insert, as that happens for real: an UPDATE of an object in this
    // bucket is refused by the no-overwrite trigger — tested below.)
    await db.query(`delete from storage.objects where name = $1`, [swapped.storage_path]);
    await storeObject(db, swapped.storage_path, 7);
    const binned = await upload(db, 'binned.pdf');
    await as(db, 'owner', `update project_documents set trashed_at = now() where id = $1`, [binned.id]);

    const r = await as(db, 'owner', `select kind, storage_path from document_storage_report()`);
    expect(r.rows).toEqual(expect.arrayContaining([
      { kind: 'orphan_object', storage_path: orphan },
      { kind: 'missing_object', storage_path: gone.storage_path },
      { kind: 'changed_object', storage_path: swapped.storage_path },
      { kind: 'trashed_object', storage_path: binned.storage_path },
    ]));
    for (const who of ['super2', 'admin', 'clientA'] as Who[]) {
      expect((await as(db, who, `select * from document_storage_report()`)).rows, who).toEqual([]);
    }
  });
});

test.describe('no overwrite of a stored object, by any path', () => {
  test('an update of an object in the bucket is refused even for Storage\'s superuser; other buckets are untouched', async () => {
    const db = await fresh();
    const d = await upload(db, 'keep.pdf');
    // What a token upload with upsert does: Storage (superuser) updates the row.
    await expect(db.query(`update storage.objects set metadata = '{"size": 99}' where name = $1`, [d.storage_path]))
      .rejects.toThrow(/stratos:document_object_immutable/);
    expect((await db.query<{ m: { size: number } }>(`select metadata as m from storage.objects where name = $1`, [d.storage_path])).rows[0].m.size).toBe(1000);
    await db.query(`insert into storage.objects (bucket_id, name, metadata) values ('avatars', 'a.png', '{}')`);
    await db.query(`update storage.objects set metadata = '{"size": 1}' where bucket_id = 'avatars'`);
  });
});

/* ======================================================= file types == */

test.describe('file types and limits', () => {
  let db: PGlite;
  test.beforeAll(async () => { db = await fresh(); });

  test('the allowlist is the same list in the database and in the browser', async () => {
    for (const [ext, kinds] of Object.entries(ALLOWED_TYPES)) {
      const r = await db.query<{ k: string[] }>(`select document_kinds_for($1) as k`, [ext]);
      expect(r.rows[0].k, ext).toEqual([...kinds]);
    }
    for (const ext of ['exe', 'html', 'htm', 'js', 'sh', 'bat', 'dmg', 'rar', '7z', 'php', 'jar', '']) {
      const r = await db.query<{ k: string[] | null }>(`select document_kinds_for($1) as k`, [ext]);
      expect(r.rows[0].k, ext).toBeNull();
    }
  });

  test('a type off the list, a name/content mismatch or an unknown kind is refused at the start', async () => {
    const start = (name: string, kind: string | null) =>
      as(db, 'owner', `select * from document_begin_upload($1, null, $2, 10, null, $3)`, [P.a, name, kind]);
    for (const [name, kind] of [['setup.exe', 'zip'], ['page.html', 'text'], ['README', 'text'], ['invoice.pdf', 'text'],
      ['invoice.pdf', 'zip'], ['report.docx', 'pdf'], ['logo.svg', 'text'], ['notes.txt', null]] as [string, string | null][]) {
      expect((await start(name, kind)).error?.message, `${name} as ${kind}`).toMatch(/document_type_not_allowed/);
    }
    expect((await start('Brand kit.zip', 'zip')).error).toBeNull();
    expect((await start('logo.svg', 'svg')).error).toBeNull();
  });

  test('a rename cannot change what kind of file it claims to be', async () => {
    const d = await upload(db, 'quote.pdf');
    for (const name of ['quote.html', 'quote.docx', 'quote', 'quote.exe']) {
      const r = await as(db, 'owner', `update project_documents set name = $2 where id = $1`, [d.id, name]);
      expect(r.error?.code, name).toBe('23514');
    }
    expect((await as(db, 'owner', `update project_documents set name = 'Final quote.PDF' where id = $1`, [d.id])).error).toBeNull();
    const kind = await as(db, 'owner', `update project_documents set content_kind = 'zip' where id = $1`, [d.id]);
    expect(kind.error?.message).toMatch(/document_fact_fixed/);
  });

  test('the bucket accepts only application/octet-stream, and re-applying restores that', async () => {
    const mimes = async () => (await db.query(`select allowed_mime_types as m from storage.buckets where id = $1`, [BUCKET])).rows[0].m;
    expect(await mimes()).toEqual(['application/octet-stream']);
    await db.exec(`update storage.buckets set allowed_mime_types = null where id = '${BUCKET}'`);
    await db.exec(read(MIGRATIONS, '20260930000100_document_library.sql'));
    expect(await mimes()).toEqual(['application/octet-stream']);
  });

  test('50 MB exactly is accepted, one byte more is refused at the start and at the finish', async () => {
    const ok = await begin(db, 'exact.mp4', MAX);
    await storeObject(db, ok.storage_path, MAX);
    expect((await finish(db, ok.id)).rows[0].s).toBe('ready');
    const over = await as(db, 'owner', `select * from document_begin_upload($1, null, 'over.mp4', $2, null, 'isobmff')`, [P.a, MAX + 1]);
    expect(over.error?.message).toMatch(/document_too_large/);
  });
});

/* ============================================================ names == */

test.describe('names', () => {
  let db: PGlite;
  test.beforeAll(async () => { db = await fresh(); });

  test('the same name never overwrites: it is numbered, case-insensitively', async () => {
    const a = await upload(db, 'offer.pdf');
    const b = await begin(db, 'offer.pdf');
    const c = await begin(db, 'OFFER.pdf');
    const d = await begin(db, 'notes.txt');
    const e = await begin(db, 'notes.txt');
    expect([a.name, b.name, c.name, d.name, e.name]).toEqual(['offer.pdf', 'offer (2).pdf', 'OFFER (3).pdf', 'notes.txt', 'notes (2).txt']);
    expect(new Set([a.storage_path, b.storage_path, c.storage_path]).size).toBe(3);
  });

  test('a browser-supplied name is made safe to show', async () => {
    expect((await begin(db, '../../etc/passwd.txt')).name).toBe('.._.._etc_passwd.txt');
    expect((await begin(db, 'bad\u0007name.txt')).name).toBe('bad_name.txt');
    expect((await db.query(`select document_clean_name('   ') as n`)).rows[0].n).toBe('file');
    const long = await begin(db, `${'a'.repeat(300)}.pdf`);
    expect(long.name.length).toBe(200);
    expect(long.name.endsWith('.pdf')).toBe(true);
  });

  test('a typed rename that collides is refused, not numbered', async () => {
    const x = await upload(db, 'x.pdf');
    await upload(db, 'y.pdf');
    const r = await as(db, 'owner', `update project_documents set name = 'Y.pdf' where id = $1`, [x.id]);
    expect(r.error?.code).toBe('23505');
    const bad = await as(db, 'owner', `update project_documents set name = 'a/b.pdf' where id = $1`, [x.id]);
    expect(bad.error?.code).toBe('23514');
  });
});

/* ========================================================== folders == */

test.describe('folders and moves', () => {
  let db: PGlite;
  test.beforeAll(async () => { db = await fresh(); });

  test('rename and move change a row, never the storage key', async () => {
    const f = await folder(db, 'Szerződések');
    const d = await upload(db, 'draft.pdf');
    await as(db, 'owner', `update project_documents set name = 'signed.pdf' where id = $1`, [d.id]);
    const moved = await as(db, 'owner', `select document_move($1, $2) as n`, [d.id, f]);
    expect(moved.rows[0].n).toBe('signed.pdf');
    await as(db, 'owner', `update document_folders set name = 'Contracts' where id = $1`, [f]);
    expect(await doc(db, d.id)).toMatchObject({ storage_path: d.storage_path, folder_id: f, name: 'signed.pdf' });
    expect((await db.query(`select count(*)::int as n from storage.objects where name = $1`, [d.storage_path])).rows[0].n).toBe(1);
  });

  test('moving onto a taken name numbers the moved file', async () => {
    const f = await folder(db, 'Assets');
    await upload(db, 'logo.svg', 10, f);
    const d = await upload(db, 'logo.svg', 10);
    expect((await as(db, 'owner', `select document_move($1, $2) as n`, [d.id, f])).rows[0].n).toBe('logo (2).svg');
  });

  test('sibling folders cannot share a name; nested ones can', async () => {
    const f = await folder(db, 'Design');
    const dup = await as(db, 'owner', `insert into document_folders (project_id, name) values ($1, 'design')`, [P.a]);
    expect(dup.error?.code).toBe('23505');
    await folder(db, 'Design', f);
  });

  test('no cycles, and no parent or folder in another project', async () => {
    const top = await folder(db, 'Top');
    const mid = await folder(db, 'Mid', top);
    const low = await folder(db, 'Low', mid);
    const cycle = await as(db, 'owner', `update document_folders set parent_id = $1 where id = $2`, [low, top]);
    expect(cycle.error?.message).toMatch(/document_folder_cycle/);
    const self = await as(db, 'owner', `update document_folders set parent_id = id where id = $1`, [top]);
    // The trigger's cycle walk sees it first; the CHECK would refuse it too.
    expect(self.error?.message).toMatch(/document_folder_cycle|parent_id/);

    const other = await folder(db, 'Other project', null, P.b);
    const crossParent = await as(db, 'owner', `insert into document_folders (project_id, parent_id, name) values ($1, $2, 'x')`, [P.a, other]);
    expect(crossParent.error?.code).toBe('23503');
    const d = await upload(db, 'here.pdf');
    const crossMove = await as(db, 'owner', `select document_move($1, $2)`, [d.id, other]);
    expect(crossMove.error?.code).toBe('23503');
    const reproject = await as(db, 'owner', `update project_documents set project_id = $1 where id = $2`, [P.b, d.id]);
    expect(reproject.error?.message).toMatch(/document_project_fixed/);
  });
});

/* ============================================================ trash == */

test.describe('the trash', () => {
  let db: PGlite;
  test.beforeAll(async () => { db = await fresh(); });

  test('trash and restore a file; a name taken meanwhile is numbered', async () => {
    const d = await upload(db, 'plan.pdf');
    await as(db, 'owner', `update project_documents set trashed_at = now() where id = $1`, [d.id]);
    const row = await doc(db, d.id);
    expect(row.trashed_by).toBe(U.owner);
    await upload(db, 'plan.pdf');
    expect((await as(db, 'owner', `select document_restore($1) as n`, [d.id])).rows[0].n).toBe('plan (2).pdf');
    expect((await doc(db, d.id)).trashed_at).toBeNull();
    // The object never moved or went away.
    expect((await db.query(`select count(*)::int as n from storage.objects where name = $1`, [d.storage_path])).rows[0].n).toBe(1);
  });

  test('a folder takes its contents to the trash and brings back exactly those', async () => {
    const top = await folder(db, 'Brand');
    const sub = await folder(db, 'Logos', top);
    const deep = await folder(db, 'Old', sub);
    const a = await upload(db, 'a.png', 10, top);
    const b = await upload(db, 'b.png', 10, deep);
    const earlier = await upload(db, 'earlier.png', 10, sub);
    await as(db, 'owner', `update project_documents set trashed_at = now() where id = $1`, [earlier.id]);

    expect((await as(db, 'owner', `select document_trash_folder($1) as n`, [top])).rows[0].n).toBe(2);
    const blocked = await as(db, 'owner', `insert into document_folders (project_id, parent_id, name) values ($1, $2, 'x')`, [P.a, sub]);
    expect(blocked.error?.message).toMatch(/document_folder_trashed/);
    const intoTrash = await as(db, 'owner', `select document_move($1, $2)`, [(await upload(db, 'c.png')).id, top]);
    expect(intoTrash.error?.message).toMatch(/document_folder_trashed/);

    await as(db, 'owner', `select document_restore_folder($1)`, [top]);
    const live = await db.query(`select id from project_documents where trashed_at is null and id in ($1, $2, $3)`, [a.id, b.id, earlier.id]);
    expect(live.rows.map((r) => r.id).sort()).toEqual([a.id, b.id].sort());
    expect((await db.query(`select count(*)::int as n from document_folders where id in ($1, $2, $3) and trashed_at is null`, [top, sub, deep])).rows[0].n).toBe(3);
  });

  test('restoring a file from a trashed folder brings its folders back with it', async () => {
    const top = await folder(db, 'Invoices');
    const sub = await folder(db, '2026', top);
    const d = await upload(db, 'jan.pdf', 10, sub);
    await as(db, 'owner', `select document_trash_folder($1)`, [top]);
    await folder(db, 'Invoices');   // the name is taken meanwhile
    await as(db, 'owner', `select document_restore($1)`, [d.id]);
    const names = await db.query(`select name from document_folders where id in ($1, $2) and trashed_at is null order by name`, [top, sub]);
    expect(names.rows).toEqual([{ name: '2026' }, { name: 'Invoices (2)' }]);
  });

  test('there is no permanent delete: not for the owner, not for anyone', async () => {
    const d = await upload(db, 'keep.pdf');
    for (const who of ['owner', ...OTHERS] as Who[]) {
      const r = await as(db, who, `delete from project_documents where id = $1`, [d.id]);
      expect(r.error?.code, who).toBe('42501');
      const f = await as(db, who, `delete from document_folders`);
      expect(f.error?.code, who).toBe('42501');
    }
    expect(await doc(db, d.id)).toBeTruthy();
  });
});

/* ======================================================= the project == */

test.describe('the project around the library', () => {
  let db: PGlite;
  test.beforeAll(async () => { db = await fresh(); });

  test('closing, archiving and reopening a project move and delete nothing', async () => {
    const f = await folder(db, 'Deliverables');
    const d = await upload(db, 'site.zip', 100, f);
    const snapshot = async () => (await db.query(`select id, folder_id, name, storage_path, upload_state, trashed_at from project_documents order by id`)).rows;
    const before = await snapshot();
    expect((await as(db, 'owner', `update projects set status = 'completed' where id = $1`, [P.a])).error).toBeNull();
    expect((await as(db, 'owner', `update projects set archived_at = now() where id = $1`, [P.a])).error).toBeNull();
    expect(await snapshot()).toEqual(before);
    // Still readable and downloadable while closed and archived.
    expect((await as(db, 'owner', `select count(*)::int as n from project_documents where project_id = $1`, [P.a])).rows[0].n).toBe(1);
    expect((await as(db, 'owner', `select count(*)::int as n from storage.objects where name = $1`, [d.storage_path])).rows[0].n).toBe(1);
    await as(db, 'owner', `update projects set archived_at = null, status = 'active' where id = $1`, [P.a]);
    expect(await snapshot()).toEqual(before);
  });

  test('a project with documents cannot be deleted out from under them', async () => {
    const r = await as(db, 'owner', `delete from projects where id = $1`, [P.a]);
    expect(r.error?.code).toBe('23001');   // restrict_violation: `on delete restrict`
  });

  test('Impact projects use the same library', async () => {
    await db.exec(`insert into leads (id, name, company, email, form_type, source) values
      ('${id(401)}', 'Kiss Anna', 'Zöld Kör', 'anna@example.invalid', 'impact', 'impact')`);
    await db.exec(`update impact_applications set status = 'accepted' where lead_id = '${id(401)}'`);
    const app = (await db.query<{ id: string }>(`select id from impact_applications where lead_id = '${id(401)}'`)).rows[0].id;
    const started = await as(db, 'owner', `select impact_start_project($1, null, 'Zöld Kör', 'zold-kor', null, 'Zöld Kör web', 'zold-kor-web', 'Website', array['Build']) as id`, [app]);
    expect(started.error).toBeNull();
    const d = await upload(db, 'impact-brief.pdf', 10, null, started.rows[0].id as string);
    expect(d.storage_path.startsWith(`${started.rows[0].id}/`)).toBe(true);
  });
});

/* ========================================================== access == */

test.describe('access', () => {
  let db: PGlite;
  let d: { id: string; storage_path: string };
  let f: string;
  test.beforeAll(async () => {
    db = await fresh();
    f = await folder(db, 'Private');
    d = await upload(db, 'secret.pdf', 10, f);
  });

  test('the owner reads everything', async () => {
    expect((await as(db, 'owner', `select count(*)::int as n from project_documents`)).rows[0].n).toBe(1);
    expect((await as(db, 'owner', `select count(*)::int as n from storage.objects where bucket_id = $1`, [BUCKET])).rows[0].n).toBe(1);
  });

  test('every other account — second super_admin, admin, team, client, anon — reads and writes nothing', async () => {
    for (const who of OTHERS) {
      const docs = await as(db, who, `select count(*)::int as n from project_documents`);
      const folders = await as(db, who, `select count(*)::int as n from document_folders`);
      if (who === 'anon') {
        expect(docs.error?.code).toBe('42501');
        expect(folders.error?.code).toBe('42501');
      } else {
        expect(docs.rows[0].n, who).toBe(0);
        expect(folders.rows[0].n, who).toBe(0);
      }
      // Storage: invisible even with the careless allow-all policy present.
      const objects = await as(db, who, `select count(*)::int as n from storage.objects where bucket_id = $1`, [BUCKET]);
      expect(objects.rows[0]?.n ?? 0, who).toBe(0);
      const update = await as(db, who, `update storage.objects set owner = null where bucket_id = $1`, [BUCKET]);
      expect(update.affected, who).toBe(0);
      const del = await as(db, who, `delete from storage.objects where bucket_id = $1`, [BUCKET]);
      expect(del.affected, who).toBe(0);

      const started = await as(db, who, `select * from document_begin_upload($1, null, 'x.pdf', 10, null, 'pdf')`, [P.a]);
      expect(started.error?.code, who).toBe('42501');
      const insert = await as(db, who, `insert into project_documents (project_id, name, byte_size, content_kind) values ($1, 'x.pdf', 1, 'pdf')`, [P.a]);
      expect(insert.error?.code, who).toBe('42501');
      const rename = await as(db, who, `update project_documents set name = 'pwned.pdf' where id = $1`, [d.id]);
      expect(rename.affected, who).toBe(0);
      const trash = await as(db, who, `update document_folders set trashed_at = now() where id = $1`, [f]);
      expect(trash.affected, who).toBe(0);
      if (who !== 'anon') {
        const moved = await as(db, who, `select document_move($1, null)`, [d.id]);
        expect(moved.error?.code, who).toBe('P0002');   // not found: RLS hides it
        expect((await as(db, who, `select document_finish_upload($1)`, [d.id])).error?.code, who).toBe('P0002');
      }
    }
    expect(await doc(db, d.id)).toMatchObject({ name: 'secret.pdf', folder_id: f, trashed_at: null });
    expect((await db.query(`select count(*)::int as n from storage.objects where bucket_id = $1`, [BUCKET])).rows[0].n).toBe(1);
  });

  test('a demoted owner loses the library with the rest of the tracker', async () => {
    await db.exec(`update profiles set role = 'admin' where id = '${U.owner}'`);
    expect((await as(db, 'owner', `select count(*)::int as n from project_documents`)).rows[0].n).toBe(0);
    expect(await canSign(db, 'owner', d.storage_path)).toBe(false);
    await db.exec(`update profiles set role = 'super_admin' where id = '${U.owner}'`);
  });

  test('the guards do not break other buckets', async () => {
    expect(await canSign(db, 'admin', 'someone/avatar.png', 'avatars')).toBe(true);
  });
});

/* ============================================================ checks == */

test.describe('the SQL-editor checks', () => {
  test('preflight is read-only and verify reads all ok', async () => {
    const db = await fresh();
    await upload(db, 'one.pdf');
    const before = (await db.query(`select count(*)::int as n from project_documents`)).rows[0];
    await db.exec(read(CHECKS, 'documents-preflight.sql'));
    // verify ends in ROLLBACK; run it up to there, read its results, then roll back.
    await db.exec(read(CHECKS, 'documents-verify.sql').replace(/rollback;\s*$/, ''));
    const rows = (await db.query<{ check_name: string; ok: boolean; detail: string | null }>(
      `select check_name, ok, detail from verify_result`)).rows;
    await db.exec('rollback');
    expect(rows.length).toBeGreaterThan(5);
    expect(rows.filter((r) => !r.ok)).toEqual([]);
    expect((await db.query(`select count(*)::int as n from project_documents`)).rows[0]).toEqual(before);
  });

  test('rollback closes every API path and keeps every row and object', async () => {
    const db = await fresh();
    const d = await upload(db, 'kept.pdf');
    await db.exec(read(CHECKS, 'documents-rollback.sql'));
    expect((await as(db, 'owner', `select count(*)::int as n from project_documents`)).error?.code).toBe('42501');
    expect((await as(db, 'owner', `select count(*)::int as n from storage.objects where bucket_id = $1`, [BUCKET])).rows[0].n).toBe(0);
    expect((await db.query(`select count(*)::int as n from project_documents`)).rows[0].n).toBe(1);
    expect((await db.query(`select count(*)::int as n from storage.objects where name = $1`, [d.storage_path])).rows[0].n).toBe(1);
    // Re-applying restores access.
    await db.exec(read(MIGRATIONS, '20260930000100_document_library.sql'));
    expect((await as(db, 'owner', `select count(*)::int as n from project_documents`)).rows[0].n).toBe(1);
  });
});

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { buildIndex, reply, type HelpArticle } from '../portal/src/lib/helpMatcher';
import { isSafeHttpsUrl } from '../portal/src/lib/meetings';

/**
 * Phase 7 — demo links, meetings and the help centre in the client portal
 * (20261004000100_client_demos_meetings_help.sql, 20261004000200_help_seed.sql),
 * against real Postgres (PGlite). Same people and projects as
 * tests/portal-client-db.spec.ts: a1, a2 = two clients of company A on project
 * a1; b1 = a client of company B on project b1.
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

test.describe('demo links', () => {
  let db: PGlite;
  test.beforeAll(async () => {
    db = await fresh();
    await invite(db, ORG.a, 'Anna', 'anna@a.example', [P.a1], U.a1);
    await invite(db, ORG.a, 'Béla', 'bela@a.example', [P.a2], U.a2);
    await invite(db, ORG.b, 'Cili', 'cili@b.example', [P.b1], U.b1);
  });

  test('a published demo reaches exactly the clients of its project; an unpublished one nobody', async () => {
    const pub = await demo(db, P.a1, { title: 'Publikált' });
    const hidden = await demo(db, P.a1, { title: 'Rejtett', published: false });
    expect(pub.error, pub.error?.message).toBeNull();
    expect(hidden.error).toBeNull();
    expect((await ok(db, 'a1', `select title from client_portal_demos()`)).map((r) => r.title)).toEqual(['Publikált']);
    expect(await ok(db, 'a2', `select title from client_portal_demos()`)).toEqual([]);
    expect(await ok(db, 'b1', `select title from client_portal_demos()`)).toEqual([]);
  });

  test('the client API returns fixed columns only', async () => {
    const [row] = await ok(db, 'a1', `select * from client_portal_demos()`);
    expect(Object.keys(row).sort()).toEqual(['demo_id', 'note', 'project_id', 'project_name', 'title', 'updated_at', 'url']);
  });

  test('unpublishing, revoking the demo, and revoking the assignment each take it away', async () => {
    const [{ id }] = await ok(db, 'owner', `select id from project_demos where title = 'Publikált'`);
    await ok(db, 'owner', `update project_demos set published = false where id = $1`, [id]);
    expect(await ok(db, 'a1', `select * from client_portal_demos()`)).toEqual([]);
    await ok(db, 'owner', `update project_demos set published = true where id = $1`, [id]);
    await ok(db, 'owner', `update project_demos set revoked_at = now() where id = $1`, [id]);
    expect(await ok(db, 'a1', `select * from client_portal_demos()`)).toEqual([]);
    const [r] = await ok(db, 'owner', `select published from project_demos where id = $1`, [id]);
    expect(r.published).toBe(false); // revoked is never published
    await ok(db, 'owner', `update project_demos set revoked_at = null, published = true where id = $1`, [id]);
    expect((await ok(db, 'a1', `select * from client_portal_demos()`)).length).toBe(1);
    const access = await accessId(db, (await ok(db, 'owner', `select id from client_accounts where email = 'anna@a.example'`))[0].id as string, P.a1);
    await ok(db, 'owner', `update client_project_access set revoked_at = now() where id = $1`, [access]);
    expect(await ok(db, 'a1', `select * from client_portal_demos()`)).toEqual([]);
  });

  test('dangerous and malformed URLs are refused by the database, and the Portal agrees', async () => {
    const bad = ['javascript:alert(1)', 'http://demo.example.com', 'data:text/html,<b>x</b>', 'https://', 'https://demo example.com',
      'https://user:pass@demo.example.com', 'https://demo.example.com/a b', 'ftp://demo.example.com', ' https://demo.example.com',
      'https://demo.example.com/\n', 'https://localhost', 'HTTPS://demo.example.com', 'https://-bad.example.com', `https://demo.example.com/${'x'.repeat(2000)}`,
      '//demo.example.com', 'https://demo.example.com\u0000'];
    const good = ['https://demo.example.com', 'https://demo.example.com/', 'https://a.b.hu:8443/path?x=1&y=ő#frag', 'https://stratos-demo.netlify.app/oldal'];
    for (const url of bad) {
      const r = await demo(db, P.a1, { url });
      expect(r.error, url).not.toBeNull();
      expect(isSafeHttpsUrl(url), url).toBe(false);
    }
    for (const url of good) {
      const r = await demo(db, P.b1, { url, published: false });
      expect(r.error, url).toBeNull();
      expect(isSafeHttpsUrl(url), url).toBe(true);
    }
  });

  test('nobody but the owner writes or reads the table; a client cannot reach it directly', async () => {
    for (const who of ['super2', 'admin', 'team', 'a1', 'b1'] as const) {
      expect((await as(db, who, `select * from project_demos`)).rows, who).toEqual([]);
      const w = await as(db, who, `insert into project_demos (project_id, title, url) values ($1, 'x', 'https://x.example.com')`, [P.a1]);
      expect(w.error, who).not.toBeNull();
    }
    expect((await as(db, 'anon', `select * from client_portal_demos()`)).error?.code).toBe('42501');
  });
});

test.describe('meetings', () => {
  let db: PGlite;
  test.beforeAll(async () => {
    db = await fresh();
    await invite(db, ORG.a, 'Anna', 'anna@a.example', [P.a1], U.a1);
    await invite(db, ORG.b, 'Cili', 'cili@b.example', [P.b1], U.b1);
  });

  test('a client sees the upcoming meetings of its projects, cancelled ones flagged, past ones not at all', async () => {
    await meeting(db, P.a1, 48, { title: 'Második' });
    await meeting(db, P.a1, 24, { title: 'Első' });
    await meeting(db, P.a1, -5, { title: 'Múltbeli' });
    const [c] = await ok(db, 'owner', `insert into project_meetings (project_id, title, starts_at, ends_at, location) values ($1, 'Lemondott', now() + interval '2 hours', now() + interval '3 hours', 'Iroda') returning id`, [P.a1]);
    await ok(db, 'owner', `update project_meetings set cancelled_at = now() where id = $1`, [c.id]);
    await meeting(db, P.b1, 10, { title: 'B cég' });
    const rows = await ok(db, 'a1', `select title, cancelled from client_portal_meetings()`);
    expect(rows).toEqual([{ title: 'Lemondott', cancelled: true }, { title: 'Első', cancelled: false }, { title: 'Második', cancelled: false }]);
    expect((await ok(db, 'b1', `select title from client_portal_meetings()`)).map((r) => r.title)).toEqual(['B cég']);
  });

  test('a changed time is what the client sees next time', async () => {
    const [m] = await ok(db, 'owner', `select id from project_meetings where title = 'Első'`);
    await ok(db, 'owner', `update project_meetings set starts_at = starts_at + interval '72 hours', ends_at = ends_at + interval '72 hours' where id = $1`, [m.id]);
    expect((await ok(db, 'a1', `select title from client_portal_meetings() where not cancelled`)).map((r) => r.title)).toEqual(['Második', 'Első']);
  });

  test('the database refuses a bad time zone, an end before the start, no link or place, and an unsafe link', async () => {
    const cases: [string, unknown[]][] = [
      [`insert into project_meetings (project_id, title, starts_at, ends_at, time_zone, location) values ($1, 'x', now(), now() + interval '1 hour', 'Mars/Olympus', 'x')`, [P.a1]],
      [`insert into project_meetings (project_id, title, starts_at, ends_at, location) values ($1, 'x', now(), now() - interval '1 hour', 'x')`, [P.a1]],
      [`insert into project_meetings (project_id, title, starts_at, ends_at) values ($1, 'x', now(), now() + interval '1 hour')`, [P.a1]],
      [`insert into project_meetings (project_id, title, starts_at, ends_at, join_url) values ($1, 'x', now(), now() + interval '1 hour', 'javascript:alert(1)')`, [P.a1]],
      [`insert into project_meetings (project_id, title, starts_at, ends_at, location) values ($1, 'x', now(), now() + interval '25 hours', 'x')`, [P.a1]],
    ];
    for (const [sql, params] of cases) expect((await as(db, 'owner', sql, params)).error, sql).not.toBeNull();
    const okZone = await as(db, 'owner', `insert into project_meetings (project_id, title, starts_at, ends_at, time_zone, location) values ($1, 'NY', now() + interval '1 day', now() + interval '25 hours', 'America/New_York', 'x') returning id`, [P.a1]);
    expect(okZone.error).toBeNull();
  });

  test('revoking the assignment takes the meetings away; nobody else reads or writes them', async () => {
    const acct = (await ok(db, 'owner', `select id from client_accounts where email = 'anna@a.example'`))[0].id as string;
    await ok(db, 'owner', `update client_project_access set revoked_at = now() where account_id = $1 and revoked_at is null`, [acct]);
    expect(await ok(db, 'a1', `select * from client_portal_meetings()`)).toEqual([]);
    for (const who of ['super2', 'admin', 'team', 'b1'] as const) {
      expect((await as(db, who, `select * from project_meetings`)).rows, who).toEqual([]);
    }
    const [row] = await ok(db, 'b1', `select * from client_portal_meetings()`);
    expect(Object.keys(row).sort()).toEqual(['cancelled', 'ends_at', 'join_url', 'location', 'meeting_id', 'note', 'project_id', 'project_name', 'starts_at', 'time_zone', 'title']);
  });
});

test.describe('the help centre', () => {
  let db: PGlite;
  test.beforeAll(async () => {
    db = await fresh();
    await invite(db, ORG.a, 'Anna', 'anna@a.example', [P.a1], U.a1);
  });

  test('the seed: 60 site FAQ topics and 14 client-portal questions, all published after the owner\'s decisions', async () => {
    const [c] = await ok(db, 'owner', `select count(*) filter (where slug like 'web-%')::int as web, count(*) filter (where slug like 'portal-%')::int as portal,
                                             count(*) filter (where status = 'draft')::int as drafts from help_articles`);
    expect(c).toEqual({ web: 60, portal: 14, drafts: 0 });
    const [w] = await ok(db, 'owner', `select answer from help_articles where slug = 'web-kkv-1'`);
    expect(w.answer).toBe('A pontos határidőt a projekt terjedelme és a szükséges anyagok rendelkezésre állása alapján, az egyeztetés során rögzítjük.');
    const [m] = await ok(db, 'owner', `select answer from help_articles where slug = 'portal-tovabbi-modositas'`);
    expect(m.answer).toMatch(/szerződésedben/);
    expect(m.answer).toMatch(/1 munkanapon belül/);
  });

  test('a client gets published articles only, without source or review note', async () => {
    const rows = await ok(db, 'a1', `select * from client_help_articles()`);
    expect(rows.length).toBe(74);
    expect(Object.keys(rows[0]).sort()).toEqual(['alt_questions', 'answer', 'article_id', 'question', 'topic']);
    // A draft never reaches a client: make one and look.
    await ok(db, 'owner', `update help_articles set status = 'draft' where slug = 'portal-masik-idopont'`);
    const again = await ok(db, 'a1', `select question from client_help_articles()`);
    expect(again.some((r) => String(r.question).includes('Hogyan kérhetek másik időpontot'))).toBe(false);
    await ok(db, 'owner', `update help_articles set status = 'published' where slug = 'portal-masik-idopont'`);
  });

  test('staff without owner rights, an unlinked user and anon get nothing', async () => {
    for (const who of ['super2', 'admin', 'team', 'stranger'] as const) {
      expect(await ok(db, who, `select * from client_help_articles()`), who).toEqual([]);
      expect((await as(db, who, `select * from help_articles`)).rows, who).toEqual([]);
    }
    expect((await as(db, 'anon', `select * from client_help_articles()`)).error?.code).toBe('42501');
  });

  test('re-running the seed never overwrites the owner\'s edit', async () => {
    await ok(db, 'owner', `update help_articles set answer = 'Szerkesztve' where slug = 'portal-fajltipusok'`);
    await db.exec(read(MIGRATIONS, '20261004000200_help_seed.sql'));
    expect((await ok(db, 'owner', `select answer from help_articles where slug = 'portal-fajltipusok'`))[0].answer).toBe('Szerkesztve');
  });

  test('the assistant on the real, published knowledge base: known, rephrased, ambiguous and unknown questions', async () => {
    const articles = (await ok(db, 'a1', `select * from client_help_articles()`)) as unknown as HelpArticle[];
    const idx = buildIndex(articles);
    const ans = (q: string) => { const r = reply(idx, q); return r.kind === 'answer' ? r.article.question : r.kind; };
    expect(ans('Hol adhatom le a képeket, logót és szövegeket?')).toBe('Hol adhatom le a képeket, a logót és a szövegeket?');
    expect(ans('mekkora fájlokat tölthetek fel')).toBe('Milyen fájlokat tölthetek fel?');
    expect(ans('hogyan küldök javított verziót')).toBe('Hogyan adhatok le egy javított változatot?');
    expect(ans('elfelejtettem a jelszavam')).toBe('Mit tegyek, ha nem tudok belépni?');
    expect(ans('betehetem a google naptárba?')).toBe('Hogyan tehetem be a naptáramba?');
    expect(ans('nem sikerül feltölteni a fájlt')).toBe('Mit tegyek, ha nem sikerül a feltöltés?');
    expect(ans('hol tart a projektem')).toBe('Hol látom a projekt állapotát, határidejét vagy a fizetéseket?');
    const clarify = reply(idx, 'időpont');
    expect(clarify.kind).toBe('clarify');
    // The owner's decisions are now answers.
    expect(ans('kérhetek másik időpontot')).toBe('Hogyan kérhetek másik időpontot?');
    expect(ans('hogyan jelezzek vissza a demóról')).toBe('Hogyan jelezzek vissza a demóról?');
    expect(ans('mennyi idő alatt készül el a weboldal')).toBe('Mennyi idő alatt készül el egy weboldal?');
    expect(reply(idx, 'szeretnék pizzát rendelni').kind).toBe('unknown');
    expect(reply(idx, 'milyen idő lesz holnap').kind).toBe('unknown');
  });
});

test.describe('the SQL-editor verify', () => {
  test('client-extras-verify.sql: every row ok with clients, shares and drafts present', async () => {
    const db = await fresh();
    await invite(db, ORG.a, 'Anna', 'anna@a.example', [P.a1], U.a1);
    await invite(db, ORG.b, 'Cili', 'cili@b.example', [P.b1], U.b1);
    await demo(db, P.a1);
    await meeting(db, P.b1, 5);
    await db.exec(read(CHECKS, 'client-extras-verify.sql').replace(/rollback;\s*$/, ''));
    const rows = (await db.query<{ check_name: string; ok: boolean; detail: string | null }>(`select check_name, ok, detail from verify_result`)).rows;
    await db.exec('rollback');
    expect(rows.filter((r) => !r.ok)).toEqual([]);
    expect(rows.length).toBeGreaterThan(8);
  });
});

/* ============================================ phase 8: feedback, reschedule */

test.describe('demo feedback', () => {
  let db: PGlite;
  let d: string;
  test.beforeAll(async () => {
    db = await fresh();
    await invite(db, ORG.a, 'Anna', 'anna@a.example', [P.a1], U.a1);
    await invite(db, ORG.a, 'Béla', 'bela@a.example', [P.a1], U.a2);
    await invite(db, ORG.b, 'Cili', 'cili@b.example', [P.b1], U.b1);
    d = (await demo(db, P.a1)).rows[0].id as string;
  });

  test('an assigned client writes feedback; only that client and the owner see it; the owner marks it read', async () => {
    const r = await as(db, 'a1', `select client_send_demo_feedback($1, $2) as id`, [d, 'A menü túl kicsi mobilon.']);
    expect(r.error, r.error?.message).toBeNull();
    expect((await ok(db, 'a1', `select body, seen from client_portal_demo_feedback()`))).toEqual([{ body: 'A menü túl kicsi mobilon.', seen: false }]);
    expect(await ok(db, 'a2', `select * from client_portal_demo_feedback()`)).toEqual([]);
    const [f] = await ok(db, 'owner', `select id, body, read_at from demo_feedback`);
    expect(f.body).toBe('A menü túl kicsi mobilon.');
    await ok(db, 'owner', `update demo_feedback set read_at = now() where id = $1`, [f.id]);
    expect((await ok(db, 'a1', `select seen from client_portal_demo_feedback()`))[0].seen).toBe(true);
    expect((await as(db, 'owner', `update demo_feedback set body = 'x' where id = $1`, [f.id])).error?.message).toContain('stratos:feedback_fixed');
    expect((await ok(db, 'owner', `select count(*)::int as n from activity_logs where action = 'project.demo_feedback'`))[0].n).toBe(1);
  });

  test('another company, an unpublished or revoked demo, an empty message and a lost assignment are refused', async () => {
    expect((await as(db, 'b1', `select client_send_demo_feedback($1, 'x')`, [d])).error?.code).toBe('42501');
    expect((await as(db, 'a1', `select client_send_demo_feedback($1, '   ')`, [d])).error?.message).toContain('feedback_empty');
    const hidden = (await demo(db, P.a1, { published: false, title: 'Rejtett' })).rows[0].id as string;
    expect((await as(db, 'a1', `select client_send_demo_feedback($1, 'x')`, [hidden])).error?.code).toBe('42501');
    await ok(db, 'owner', `update project_demos set revoked_at = now() where id = $1`, [d]);
    expect((await as(db, 'a1', `select client_send_demo_feedback($1, 'x')`, [d])).error?.code).toBe('42501');
    expect(await ok(db, 'a1', `select * from client_portal_demo_feedback()`)).toEqual([]);
    await ok(db, 'owner', `update project_demos set revoked_at = null, published = true where id = $1`, [d]);
    const acct = (await ok(db, 'owner', `select id from client_accounts where email = 'bela@a.example'`))[0].id as string;
    await ok(db, 'owner', `update client_project_access set revoked_at = now() where account_id = $1 and revoked_at is null`, [acct]);
    expect((await as(db, 'a2', `select client_send_demo_feedback($1, 'x')`, [d])).error?.code).toBe('42501');
  });

  test('at most 30 messages a day per account', async () => {
    for (let i = 0; i < 29; i += 1) await ok(db, 'a1', `select client_send_demo_feedback($1, $2)`, [d, `üzenet ${i}`]);
    expect((await as(db, 'a1', `select client_send_demo_feedback($1, 'egy túl sok')`, [d])).error?.message).toContain('feedback_limit');
  });

  test('nobody reads or writes the table directly but the owner', async () => {
    for (const who of ['a1', 'b1', 'admin', 'team', 'super2'] as const) {
      expect((await as(db, who, `select * from demo_feedback`)).rows, who).toEqual([]);
      expect((await as(db, who, `insert into demo_feedback (demo_id, project_id, account_id, body) select $1, $2, id, 'x' from client_accounts limit 1`, [d, P.a1])).error, who).not.toBeNull();
    }
  });
});

test.describe('meeting reschedule requests', () => {
  let db: PGlite;
  let m: string;
  test.beforeAll(async () => {
    db = await fresh();
    await invite(db, ORG.a, 'Anna', 'anna@a.example', [P.a1], U.a1);
    await invite(db, ORG.a, 'Béla', 'bela@a.example', [P.a1], U.a2);
    await invite(db, ORG.b, 'Cili', 'cili@b.example', [P.b1], U.b1);
    m = (await meeting(db, P.a1, 48, { title: 'Egyeztetés' })).rows[0].id as string;
  });
  const propose = (who: 'a1' | 'a2' | 'b1', h: number, msg: string | null = null) =>
    as(db, who, `select client_request_meeting_change($1, now() + make_interval(hours => $2::int), now() + make_interval(hours => $2::int + 1), 'Europe/Budapest', $3) as id`, [m, h, msg]);

  test('a client proposes a time; a second pending one is refused until it is withdrawn', async () => {
    const r = await propose('a1', 72, 'Csütörtök jobb lenne.');
    expect(r.error, r.error?.message).toBeNull();
    expect((await propose('a1', 96)).error?.message).toContain('meeting_request_pending');
    const [mine] = await ok(db, 'a1', `select request_id, status, message from client_portal_meeting_requests()`);
    expect(mine).toMatchObject({ status: 'pending', message: 'Csütörtök jobb lenne.' });
    expect(await ok(db, 'a2', `select * from client_portal_meeting_requests()`)).toEqual([]);
    expect((await ok(db, 'a1', `select client_withdraw_meeting_request($1) as s`, [mine.request_id]))[0].s).toBe('withdrawn');
    expect((await propose('a1', 96)).error).toBeNull();
  });

  test('a past time, another company\'s meeting and a cancelled meeting are refused', async () => {
    expect((await propose('a2', -3)).error?.message).toContain('meeting_request_past');
    expect((await propose('b1', 60)).error?.code).toBe('42501');
    const c = (await meeting(db, P.a1, 30, { title: 'Lemondott' })).rows[0].id as string;
    await ok(db, 'owner', `update project_meetings set cancelled_at = now() where id = $1`, [c]);
    const r = await as(db, 'a1', `select client_request_meeting_change($1, now() + interval '5 days', now() + interval '5 days 1 hour')`, [c]);
    expect(r.error?.message).toContain('meeting_closed');
  });

  test('accept moves the meeting and declines the other pending proposal, in one step; decided means decided', async () => {
    await propose('a2', 120, 'Nekem péntek.');
    const pending = await ok(db, 'owner', `select id, account_id, proposed_starts_at from meeting_change_requests where status = 'pending' order by created_at`);
    expect(pending.length).toBe(2);
    const [win] = pending;
    expect((await ok(db, 'owner', `select owner_decide_meeting_request($1, true, null) as s`, [win.id]))[0].s).toBe('accepted');
    const [mt] = await ok(db, 'owner', `select starts_at from project_meetings where id = $1`, [m]);
    expect(new Date(mt.starts_at as string).getTime()).toBe(new Date(win.proposed_starts_at as string).getTime());
    const statuses = (await ok(db, 'owner', `select status from meeting_change_requests where status <> 'withdrawn' order by created_at`)).map((r) => r.status);
    expect(statuses).toEqual(['accepted', 'declined']);
    expect((await as(db, 'owner', `select owner_decide_meeting_request($1, false, null)`, [win.id])).error?.message).toContain('meeting_request_decided');
    const [seen] = await ok(db, 'a1', `select starts_at from client_portal_meetings() where meeting_id = $1`, [m]);
    expect(new Date(seen.starts_at as string).getTime()).toBe(new Date(win.proposed_starts_at as string).getTime());
  });

  test('decline keeps the meeting and carries the owner\'s note to the client', async () => {
    await propose('a1', 150);
    const [r] = await ok(db, 'owner', `select id from meeting_change_requests where status = 'pending'`);
    const [before] = await ok(db, 'owner', `select starts_at from project_meetings where id = $1`, [m]);
    await ok(db, 'owner', `select owner_decide_meeting_request($1, false, 'Sajnos akkor nem érünk rá.')`, [r.id]);
    const [after] = await ok(db, 'owner', `select starts_at from project_meetings where id = $1`, [m]);
    expect(after.starts_at).toEqual(before.starts_at);
    const mine = await ok(db, 'a1', `select status, owner_note from client_portal_meeting_requests() where status = 'declined'`);
    expect(mine.some((x) => x.owner_note === 'Sajnos akkor nem érünk rá.')).toBe(true);
  });

  test('no direct write: not the client, not even the owner — only the decision function; non-owners cannot decide', async () => {
    const [r] = await ok(db, 'owner', `select id from meeting_change_requests limit 1`);
    for (const who of ['owner', 'a1', 'admin'] as const) {
      const u = await as(db, who, `update meeting_change_requests set status = 'accepted' where id = $1`, [r.id]);
      expect(u.error ?? (u.affected === 0 ? { code: 'none' } : null), who).not.toBeNull();
    }
    await propose('a2', 170);
    const [p] = await ok(db, 'owner', `select id from meeting_change_requests where status = 'pending'`);
    for (const who of ['admin', 'super2', 'team', 'a1'] as const) {
      expect((await as(db, who, `select owner_decide_meeting_request($1, true, null)`, [p.id])).error?.code, who).toBe('42501');
    }
  });

  test('the definer-function rule and the verify scripts still hold', async () => {
    for (const file of ['client-portal-verify.sql', 'client-extras-verify.sql']) {
      await db.exec(read(CHECKS, file).replace(/rollback;\s*$/, ''));
      const rows = (await db.query<{ check_name: string; ok: boolean; detail: string | null }>(`select check_name, ok, detail from verify_result`)).rows;
      await db.exec('rollback');
      expect(rows.filter((x) => !x.ok), file).toEqual([]);
    }
  });
});

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

/**
 * Client experience (20261014000100_client_experience.sql): demo approval,
 * "Rád várunk" requests, the project message thread and the satisfaction
 * survey, against real Postgres (PGlite). Same people and projects as
 * tests/portal-client-extras-db.spec.ts.
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


const outbox = async (db: PGlite) => (await db.query<{ audience: string; kind: string; project_id: string; payload: Record<string, unknown>; account_ids: string[] | null }>(
  `select audience, kind, project_id, payload, account_ids from notification_outbox order by created_at, kind`)).rows;
const kinds = async (db: PGlite) => (await outbox(db)).map((r) => `${r.audience}:${r.kind}`);
const clearOutbox = (db: PGlite) => db.exec(`delete from notification_outbox`);

test.describe('demo approval', () => {
  let db: PGlite;
  let d: string;
  test.beforeAll(async () => {
    db = await fresh();
    await invite(db, ORG.a, 'Anna', 'anna@a.example', [P.a1], U.a1);
    await invite(db, ORG.b, 'Cili', 'cili@b.example', [P.b1], U.b1);
    d = (await demo(db, P.a1)).rows[0].id as string;
  });

  test('nothing to approve until the owner asks', async () => {
    expect(await ok(db, 'a1', `select * from client_portal_approvals()`)).toEqual([]);
    expect((await as(db, 'a1', `select client_decide_demo($1, true)`, [d])).error?.message).toContain('approval_not_requested');
  });

  test('the owner asks; the client approves once; the owner is told', async () => {
    await ok(db, 'owner', `update project_demos set approval_requested_at = now() where id = $1`, [d]);
    const [open] = await ok(db, 'a1', `select * from client_portal_approvals()`);
    expect(Object.keys(open).sort()).toEqual(['decided_at', 'demo_id', 'note', 'project_id', 'requested_at', 'state']);
    expect(open.state).toBeNull();
    expect((await as(db, 'b1', `select client_decide_demo($1, true)`, [d])).error?.code).toBe('42501');
    await clearOutbox(db);
    expect((await ok(db, 'a1', `select client_decide_demo($1, true) as r`, [d]))[0].r).toBe('approved');
    expect((await as(db, 'a1', `select client_decide_demo($1, false, 'mégse')`, [d])).error?.message).toContain('approval_decided');
    expect(await kinds(db)).toEqual(['owner:client_approved']);
    expect((await outbox(db))[0].payload.title).toBe('Weboldal demó');
  });

  test('the answer is the client\'s: the owner cannot write it, but can ask again, which clears it', async () => {
    expect((await as(db, 'owner', `update project_demos set approval_state = 'changes' where id = $1`, [d])).error?.message).toContain('approval_is_the_clients');
    await ok(db, 'owner', `update project_demos set approval_seen_at = now() where id = $1`, [d]);
    await ok(db, 'owner', `update project_demos set approval_requested_at = now() + interval '1 second' where id = $1`, [d]);
    const [row] = await ok(db, 'owner', `select approval_state, approval_seen_at from project_demos where id = $1`, [d]);
    expect(row).toEqual({ approval_state: null, approval_seen_at: null });
  });

  test('asking for changes needs a note', async () => {
    expect((await as(db, 'a1', `select client_decide_demo($1, false, '  ')`, [d])).error?.message).toContain('approval_note_needed');
    await clearOutbox(db);
    await ok(db, 'a1', `select client_decide_demo($1, false, 'A logó legyen nagyobb.')`, [d]);
    const [o] = await outbox(db);
    expect(o.kind).toBe('client_changes_requested');
    expect(o.payload.excerpt).toBe('A logó legyen nagyobb.');
    const [mine] = await ok(db, 'a1', `select state, note from client_portal_approvals()`);
    expect(mine).toEqual({ state: 'changes', note: 'A logó legyen nagyobb.' });
  });

  test('an unpublished demo is not offered for approval', async () => {
    await ok(db, 'owner', `update project_demos set published = false where id = $1`, [d]);
    expect(await ok(db, 'a1', `select * from client_portal_approvals()`)).toEqual([]);
  });
});

test.describe('"Rád várunk" requests', () => {
  let db: PGlite;
  let r: string;
  test.beforeAll(async () => {
    db = await fresh();
    await invite(db, ORG.a, 'Anna', 'anna@a.example', [P.a1], U.a1);
    await invite(db, ORG.a, 'Béla', 'bela@a.example', [P.a2], U.a2);
  });

  test('only the owner writes requests; a client reads their project\'s only', async () => {
    for (const who of ['admin', 'super2', 'a1'] as const) {
      expect((await as(db, who, `insert into client_requests (project_id, title) values ($1, 'Logó')`, [P.a1])).error, who).not.toBeNull();
    }
    [{ id: r }] = await ok(db, 'owner', `insert into client_requests (project_id, title, details, due_on, done_at) values ($1, 'Logó vektorosan', 'AI vagy SVG', current_date + 3, now()) returning id`, [P.a1]) as { id: string }[];
    const [row] = await ok(db, 'owner', `select done_at from client_requests where id = $1`, [r]);
    expect(row.done_at).toBeNull(); // done is never the owner's to set
    const mine = await ok(db, 'a1', `select * from client_portal_requests()`);
    expect(mine.map((x) => x.title)).toEqual(['Logó vektorosan']);
    expect(Object.keys(mine[0]).sort()).toEqual(['created_at', 'details', 'done_at', 'done_note', 'due_on', 'project_id', 'request_id', 'title']);
    expect(await ok(db, 'a2', `select * from client_portal_requests()`)).toEqual([]);
  });

  test('the client marks it done with a note; the owner is told; done twice is still once', async () => {
    expect((await as(db, 'a2', `select client_complete_request($1)`, [r])).error?.code).toBe('42501');
    await clearOutbox(db);
    await ok(db, 'a1', `select client_complete_request($1, 'Feltöltöttem a nyersanyaghoz.')`, [r]);
    await ok(db, 'a1', `select client_complete_request($1)`, [r]);
    expect(await kinds(db)).toEqual(['owner:client_request_done']);
    const [x] = await ok(db, 'a1', `select done_at, done_note from client_portal_requests()`);
    expect(x.done_note).toBe('Feltöltöttem a nyersanyaghoz.');
    expect((await as(db, 'owner', `update client_requests set done_note = 'más' where id = $1`, [r])).error?.message).toContain('request_done_is_the_clients');
  });

  test('the owner reopens or cancels; a cancelled request disappears for the client', async () => {
    await ok(db, 'owner', `update client_requests set done_at = null where id = $1`, [r]);
    const [x] = await ok(db, 'owner', `select done_account_id, done_note from client_requests where id = $1`, [r]);
    expect(x).toEqual({ done_account_id: null, done_note: null });
    await ok(db, 'owner', `update client_requests set cancelled_at = now() where id = $1`, [r]);
    expect(await ok(db, 'a1', `select * from client_portal_requests()`)).toEqual([]);
    expect((await as(db, 'a1', `select client_complete_request($1)`, [r])).error?.code).toBe('42501');
  });
});

test.describe('project messages', () => {
  let db: PGlite;
  test.beforeAll(async () => {
    db = await fresh();
    await invite(db, ORG.a, 'Anna', 'anna@a.example', [P.a1], U.a1);
    await invite(db, ORG.a, 'Béla', 'bela@a.example', [P.a1], U.a2);
    await invite(db, ORG.b, 'Cili', 'cili@b.example', [P.b1], U.b1);
  });

  test('a client writes to their project only; the owner is told; the name comes from the account', async () => {
    expect((await as(db, 'b1', `select client_send_message($1, 'szia')`, [P.a1])).error?.code).toBe('42501');
    expect((await as(db, 'a1', `select client_send_message($1, '   ')`, [P.a1])).error?.message).toContain('message_empty');
    await ok(db, 'a1', `select client_send_message($1, 'Mikor lesz kész a demó?')`, [P.a1]);
    expect(await kinds(db)).toEqual(['owner:client_message']);
    const [m] = await ok(db, 'owner', `select author_name, read_at, account_id is not null as from_client from project_messages`);
    expect(m).toEqual({ author_name: 'Anna', read_at: null, from_client: true });
  });

  test('nobody writes as a client through the API; staff other than the owner write nothing', async () => {
    const [{ id: anna }] = await ok(db, 'owner', `select id from client_accounts where email = 'anna@a.example'`);
    expect((await as(db, 'owner', `insert into project_messages (project_id, account_id, body) values ($1, $2, 'hamis')`, [P.a1, anna])).error?.message).toContain('message_as_client');
    expect((await as(db, 'admin', `insert into project_messages (project_id, body) values ($1, 'x')`, [P.a1])).error).not.toBeNull();
    expect((await as(db, 'a1', `insert into project_messages (project_id, body) values ($1, 'x')`, [P.a1])).error).not.toBeNull();
  });

  test('the owner answers: that marks the client\'s message read; colleagues see the thread; others nothing', async () => {
    await ok(db, 'owner', `insert into project_messages (project_id, body) values ($1, 'Pénteken.')`, [P.a1]);
    expect((await ok(db, 'owner', `select count(*)::int as n from project_messages where read_at is null and account_id is not null`))[0].n).toBe(0);
    const bela = await ok(db, 'a2', `select body, from_stratos, author_name, mine from client_portal_messages()`);
    expect(bela).toEqual([
      { body: 'Mikor lesz kész a demó?', from_stratos: false, author_name: 'Anna', mine: false },
      { body: 'Pénteken.', from_stratos: true, author_name: 'Stratos', mine: false },
    ]);
    expect(await ok(db, 'b1', `select * from client_portal_messages()`)).toEqual([]);
    expect((await as(db, 'owner', `update project_messages set body = 'más' where author_name = 'Stratos'`)).error?.message).toContain('message_fixed');
  });

  test('at most 60 a day per account', async () => {
    for (let i = 0; i < 59; i += 1) await ok(db, 'a2', `select client_send_message($1, $2)`, [P.a1, `üzenet ${i}`]);
    await ok(db, 'a2', `select client_send_message($1, 'hatvanadik')`, [P.a1]);
    expect((await as(db, 'a2', `select client_send_message($1, 'egy túl sok')`, [P.a1])).error?.message).toContain('message_limit');
  });
});

test.describe('satisfaction', () => {
  let db: PGlite;
  test.beforeAll(async () => {
    db = await fresh();
    await invite(db, ORG.a, 'Anna', 'anna@a.example', [P.a1], U.a1);
    await invite(db, ORG.a, 'Béla', 'bela@a.example', [P.a1], U.a2);
  });

  test('closing a project asks its clients once and e-mails them; a project without clients is not asked', async () => {
    await db.exec(`insert into project_milestones (project_id, title, position, state) values ('${P.a2}', 'Kész', 0, 'done');
                   update project_milestones set state = 'done' where project_id = '${P.a1}'`);
    await ok(db, 'owner', `update projects set status = 'completed' where id = $1`, [P.a1]);
    await ok(db, 'owner', `update projects set status = 'completed' where id = $1`, [P.a2]);
    await ok(db, 'owner', `update projects set status = 'active' where id = $1`, [P.a1]);
    await ok(db, 'owner', `update projects set status = 'completed' where id = $1`, [P.a1]);
    const s = await ok(db, 'owner', `select project_id, reason, period from client_surveys`);
    expect(s).toEqual([{ project_id: P.a1, reason: 'closed', period: 'closed' }]);
    expect((await kinds(db)).filter((k) => k.endsWith('survey_requested'))).toEqual(['client:survey_requested']);
  });

  test('the owner may only ask by hand; the answer is the client\'s', async () => {
    expect((await as(db, 'owner', `insert into client_surveys (project_id, reason, period) values ($1, 'quarterly', '2026-Q4')`, [P.a1])).error?.message).toContain('survey_manual_only');
    await ok(db, 'owner', `insert into client_surveys (project_id, reason, score) values ($1, 'manual', 10)`, [P.a1]);
    const [m] = await ok(db, 'owner', `select score, period from client_surveys where reason = 'manual'`);
    expect(m).toEqual({ score: null, period: null });
    expect((await as(db, 'owner', `update client_surveys set score = 10 where reason = 'manual'`)).error?.message).toContain('survey_is_the_clients');
    await ok(db, 'owner', `update client_surveys set cancelled_at = now() where reason = 'manual'`);
    expect((await ok(db, 'a1', `select reason from client_portal_surveys()`)).map((x) => x.reason)).toEqual(['closed']);
  });

  test('7 or more is offered the Google link from Settings; below 7 is not; answered once', async () => {
    await ok(db, 'owner', `update portal_settings set google_review_url = 'https://g.page/r/stratos/review'`);
    expect((await as(db, 'owner', `update portal_settings set google_review_url = 'javascript:alert(1)'`)).error).not.toBeNull();
    expect((await as(db, 'admin', `select * from portal_settings`)).rows).toEqual([]);
    const [{ survey_id: sid }] = await ok(db, 'a1', `select survey_id from client_portal_surveys()`);
    expect((await as(db, 'a1', `select client_answer_survey($1, 11)`, [sid])).error?.message).toContain('survey_score');
    await clearOutbox(db);
    expect((await ok(db, 'a1', `select client_answer_survey($1, 7, 'Gyorsak voltatok.') as url`, [sid]))[0].url).toBe('https://g.page/r/stratos/review');
    expect((await as(db, 'a2', `select client_answer_survey($1, 3)`, [sid])).error?.message).toContain('survey_answered');
    const [o] = await outbox(db);
    expect([o.kind, o.payload.score, o.payload.excerpt]).toEqual(['client_survey', 7, 'Gyorsak voltatok.']);
    await ok(db, 'a1', `select client_survey_google($1)`, [sid]);
    const [row] = await ok(db, 'owner', `select google_clicked_at is not null as clicked from client_surveys where id = $1`, [sid]);
    expect(row.clicked).toBe(true);
    // A colleague sees the answer and the link, too.
    const [b] = await ok(db, 'a2', `select score, google_url from client_portal_surveys()`);
    expect(b).toEqual({ score: 7, google_url: 'https://g.page/r/stratos/review' });
  });

  test('a score of 6 gets no Google link', async () => {
    await ok(db, 'owner', `insert into client_surveys (project_id, reason) values ($1, 'manual')`, [P.a1]);
    const [{ survey_id: sid }] = await ok(db, 'a1', `select survey_id from client_portal_surveys() where answered_at is null`);
    expect((await ok(db, 'a1', `select client_answer_survey($1, 6) as url`, [sid]))[0].url).toBeNull();
  });

  test('quarterly: in the last month of a quarter, one per running monthly contract with a client; never twice', async () => {
    await db.exec(`insert into projects (id, organization_id, name, slug, status, billing, monthly_fee, currency, start_date, created_at) values
      ('${id(204)}', '${ORG.a}', 'A havi', 'a-havi', 'active', 'monthly', 100000, 'HUF', '2025-01-01', '2025-01-01'),
      ('${id(205)}', '${ORG.a}', 'A havi új', 'a-havi-uj', 'active', 'monthly', 100000, 'HUF', current_date, now())`);
    await ok(db, 'owner', `insert into client_project_access (account_id, project_id) select id, '${id(204)}' from client_accounts where email = 'anna@a.example'`);
    await ok(db, 'owner', `insert into client_project_access (account_id, project_id) select id, '${id(205)}' from client_accounts where email = 'anna@a.example'`);
    expect((await as(db, 'owner', `select survey_quarterly_due()`)).error?.code).toBe('42501');
    const due = async (day: string) => (await db.query<{ n: number }>(`select survey_quarterly_due($1::date) as n`, [day])).rows[0].n;
    expect(await due('2026-11-30')).toBe(0); // not yet the quarter's last month
    // 2026-12-10: A havi ran the whole quarter; A havi új started today, i.e. inside it.
    await db.exec(`update projects set start_date = '2026-10-15' where id = '${id(205)}'`);
    expect(await due('2026-12-10')).toBe(1);
    expect(await due('2026-12-20')).toBe(0);
    const s = (await db.query<{ project_id: string; period: string }>(`select project_id, period from client_surveys where reason = 'quarterly'`)).rows;
    expect(s).toEqual([{ project_id: id(204), period: '2026-Q4' }]);
    expect(await due('2027-03-05')).toBe(2); // next quarter: both ran all of it
    expect((await db.query(`select count(*)::int as n from notification_outbox where kind = 'survey_requested'`)).rows[0]).toEqual({ n: 4 });
    // Ended contracts are not asked.
    await db.exec(`update projects set status = 'completed' where id = '${id(204)}'`);
    expect(await due('2027-06-05')).toBe(1);
  });
});

test.describe('structure', () => {
  test('the new client functions name no project or library table; grants are as intended', async () => {
    const db = await fresh();
    const r = await db.query<{ proname: string }>(`
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef and p.prorettype <> 'trigger'::regtype
        and p.proname in ('client_decide_demo', 'client_portal_approvals', 'client_complete_request', 'client_portal_requests',
                          'client_send_message', 'client_portal_messages', 'client_portal_surveys', 'client_answer_survey', 'client_survey_google')
        and p.prosrc ~* '\\m(projects|project_milestones|project_costs|project_links|impact_applications|project_documents|document_folders|document_shares|client_project_access|client_accounts|storage)\\M'`);
    expect(r.rows).toEqual([]);
    const g = await db.query(`select
      has_function_privilege('authenticated', 'survey_quarterly_due(date)', 'execute') as q,
      has_table_privilege('authenticated', 'project_messages', 'delete') as d1,
      has_table_privilege('authenticated', 'client_requests', 'delete') as d2,
      has_table_privilege('anon', 'client_surveys', 'select') as a1,
      has_function_privilege('anon', 'client_send_message(uuid, text)', 'execute') as a2`);
    expect(g.rows[0]).toEqual({ q: false, d1: false, d2: false, a1: false, a2: false });
  });
});

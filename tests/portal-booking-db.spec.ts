import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

/**
 * Booking (20261018000100_booking.sql) against real Postgres (PGlite): the
 * rules a time must meet, the overlap the database itself refuses, the lead a
 * public booking becomes, the owner's messages, moving and cancelling, and who
 * may read or write what through the API. The function side is
 * tests/booking.spec.ts.
 */

test.describe.configure({ mode: 'serial' });

const ROOT = process.cwd();
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations');
const read = (dir: string, file: string) => fs.readFileSync(path.join(dir, file), 'utf8');
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const U = {
  owner: id(1), super2: id(2), admin: id(3), team: id(4),
  a1: id(5), a2: id(6), b1: id(7), stranger: id(8),
} as const;
const ORG = { a: id(101), b: id(102) };
const P = { a1: id(201), a2: id(202), b1: id(203) };

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
    insert into client_contacts (id, organization_id, name, email) values
      ('${id(301)}', '${ORG.a}', 'Anna', 'anna@a.example'), ('${id(302)}', '${ORG.b}', 'Cili', 'cili@b.example');
  `);
  await db.query(`select portal_set_owner('owner@example.invalid')`);
  for (const file of files.filter((f) => f > '20260928000200_owner_tracker.sql')) await db.exec(read(MIGRATIONS, file));
  return db;
}

type Result = { rows: Record<string, unknown>[]; affected: number; error: null | { code?: string; message: string } };
/** As a person through the API, or — `server` — as the booking function's server key does (here: the owner of the database). */
async function as(db: PGlite, who: Who | 'server', sql: string, params: unknown[] = []): Promise<Result> {
  const claims = who === 'anon' || who === 'server' ? '{}' : JSON.stringify({ sub: U[who], role: 'authenticated' });
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [claims]);
  if (who !== 'server') await db.exec(`set role ${who === 'anon' ? 'anon' : 'authenticated'}`);
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
const ok = async (db: PGlite, who: Who | 'server', sql: string, params: unknown[] = []) => {
  const r = await as(db, who, sql, params);
  if (r.error) throw new Error(`${who}: ${r.error.message}`);
  return r.rows;
};

/** The owner's two invite steps — what netlify/functions/portal-invite.mjs does around the auth user. */
async function invite(db: PGlite, org: string, name: string, email: string, projects: string[], user?: string) {
  const [acct] = await ok(db, 'owner', `select * from client_invite_prepare($1, null, $2, $3, $4::uuid[])`, [org, name, email, projects]);
  if (user) await ok(db, 'owner', `select client_invite_attach($1, $2)`, [acct.account_id, user]);
  return acct.account_id as string;
}

test.describe('booking', () => {
  let db: PGlite;
  // A Monday two weeks from now, so every time below is ahead whenever this runs.
  let monday = '';
  let NOW = '';
  /** Budapest wall-clock `hhmm` on Monday + `day` days, as an ISO instant. */
  const at = async (day: number, hhmm: string) =>
    (await db.query<{ t: string }>(`select ((($1::date + $2::int) + $3::time) at time zone 'Europe/Budapest')::text as t`,
      [monday, day, hhmm])).rows[0].t;
  const reserve = (kind: string, starts: string, ends: string, extra: Record<string, unknown> = {}, now = NOW) =>
    as(db, 'server', `select booking_reserve($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) as id`,
      [kind, starts, ends, extra.name ?? 'Kovács Anna', extra.email ?? 'anna@kert.example', extra.company ?? null, extra.phone ?? null,
       extra.topic ?? 'Új weboldal', extra.locale ?? 'hu', extra.hash ?? null, extra.account ?? null, extra.project ?? null, now]);
  const made = async (r: Result) => {
    if (r.error) throw new Error(r.error.message);
    return r.rows[0].id as string;
  };
  const refusal = (r: Result) => /stratos:[a-z_]+/.exec(r.error?.message ?? '')?.[0] ?? r.error?.code ?? null;

  test.beforeAll(async () => {
    db = await fresh();
    monday = (await db.query<{ d: string }>(
      `select (date_trunc('week', now() at time zone 'Europe/Budapest') + interval '14 days')::date::text as d`)).rows[0].d;
    NOW = await at(-7, '10:00');
  });

  test('settings: the defaults; admins read them, only the owner changes them, and only the rule columns', async () => {
    const [s] = await ok(db, 'admin', `select weekdays, day_start::text, day_end::text, public_minutes, client_minutes, buffer_minutes,
                                              notice_hours, horizon_days, daily_max, change_hours, calendar_ids, time_zone from booking_settings`);
    expect(s).toEqual({ weekdays: [1, 2, 3, 4, 5], day_start: '09:00:00', day_end: '17:00:00', public_minutes: 30, client_minutes: [30, 60],
      buffer_minutes: 15, notice_hours: 24, horizon_days: 30, daily_max: 4, change_hours: 12, calendar_ids: ['primary'], time_zone: 'Europe/Budapest' });
    expect(await ok(db, 'team', `select * from booking_settings`)).toEqual([]);
    expect((await as(db, 'anon', `select * from booking_settings`)).error?.code).toBe('42501');
    expect((await as(db, 'super2', `update booking_settings set daily_max = 9`)).affected).toBe(0);
    expect((await as(db, 'admin', `update booking_settings set daily_max = 9`)).affected).toBe(0);
    expect((await as(db, 'owner', `update booking_settings set time_zone = 'Europe/Vienna'`)).error?.code).toBe('42501');
    expect((await as(db, 'owner', `update booking_settings set day_end = '08:00'`)).error?.code).toBe('23514');
    expect((await as(db, 'owner', `update booking_settings set day_start = '09:10'`)).error?.code).toBe('23514');
    expect((await as(db, 'owner', `update booking_settings set public_minutes = 25`)).error?.code).toBe('23514');
    expect((await as(db, 'owner', `update booking_settings set daily_max = 5`)).affected).toBe(1);
    const [after] = await ok(db, 'owner', `select daily_max, updated_by from booking_settings`);
    expect(after).toEqual({ daily_max: 5, updated_by: U.owner });
    await ok(db, 'owner', `update booking_settings set daily_max = 4`);
  });

  test('a public booking holds its time and the 15 minutes after it; the database refuses an overlap', async () => {
    const first = await made(await reserve('public', await at(0, '10:00'), await at(0, '10:30'), { hash: 'a'.repeat(64) }));
    const [row] = await ok(db, 'admin', `select kind, status, guest_name, guest_email, buffer_minutes, calendar_user, lower(blocks)::text as b0, upper(blocks)::text as b1 from bookings where id = $1`, [first]);
    expect(row).toMatchObject({ kind: 'public', status: 'confirmed', guest_name: 'Kovács Anna', guest_email: 'anna@kert.example', buffer_minutes: 15, calendar_user: U.owner });
    expect(new Date(row.b1 as string).getTime() - new Date(row.b0 as string).getTime()).toBe(45 * 60_000);
    // The same time, a time inside it, and the start of its buffer: taken.
    expect(refusal(await reserve('public', await at(0, '10:00'), await at(0, '10:30'), { email: 'b@b.example' }))).toBe('stratos:booking_taken');
    expect(refusal(await reserve('public', await at(0, '10:30'), await at(0, '11:00'), { email: 'b@b.example' }))).toBe('stratos:booking_taken');
    expect(refusal(await reserve('public', await at(0, '09:30'), await at(0, '10:00'), { email: 'b@b.example' }))).toBe('stratos:booking_taken');
    // 15 minutes clear on both sides: fine.
    await made(await reserve('public', await at(0, '10:45'), await at(0, '11:15'), { email: 'b@b.example' }));
    await made(await reserve('public', await at(0, '09:00'), await at(0, '09:30'), { email: 'c@c.example' }));
    // Even written past the function, two confirmed bookings cannot overlap.
    const raw = await as(db, 'server', `insert into bookings (kind, starts_at, ends_at, guest_name, guest_email) values ('public', $1, $2, 'X', 'x@x.example')`,
      [await at(0, '10:15'), await at(0, '10:45')]);
    expect(raw.error?.code).toBe('23P01');
  });

  test('the rules: notice, horizon, working hours, weekdays, the grid, the length, the day\'s maximum, one open booking per address', async () => {
    const r = (s: string, e: string, extra: Record<string, unknown> = {}, now = NOW) => reserve('public', s, e, { email: 'd@d.example', ...extra }, now);
    expect(refusal(await r(await at(1, '10:00'), await at(1, '10:30'), {}, await at(0, '12:00')))).toBe('stratos:booking_too_soon');
    expect(refusal(await r(await at(1, '10:00'), await at(1, '10:30'), {}, await at(-30, '09:00')))).toBe('stratos:booking_too_far');
    expect(refusal(await r(await at(1, '08:30'), await at(1, '09:00')))).toBe('stratos:booking_closed');
    expect(refusal(await r(await at(1, '16:45'), await at(1, '17:15')))).toBe('stratos:booking_closed');
    expect(refusal(await r(await at(5, '10:00'), await at(5, '10:30')))).toBe('stratos:booking_closed'); // Saturday
    expect(refusal(await r(await at(1, '10:10'), await at(1, '10:40')))).toBe('stratos:booking_closed');
    expect(refusal(await r(await at(1, '10:00'), await at(1, '11:00')))).toBe('stratos:booking_length');
    expect(refusal(await reserve('client', await at(1, '10:00'), await at(1, '10:45'), { account: id(999) }))).toBe('stratos:booking_length');
    // Monday already has three; a fourth fits, a fifth does not.
    await made(await r(await at(0, '14:00'), await at(0, '14:30')));
    expect(refusal(await r(await at(0, '15:00'), await at(0, '15:30'), { email: 'e@e.example' }))).toBe('stratos:booking_day_full');
    // d@d.example has an open booking now.
    expect(refusal(await r(await at(2, '10:00'), await at(2, '10:30')))).toBe('stratos:booking_email_open');
    expect(refusal(await r(await at(2, '10:00'), await at(2, '10:30'), { email: '  D@D.example ' }))).toBe('stratos:booking_email_open');
    await ok(db, 'owner', `update booking_settings set enabled = false`);
    expect(refusal(await r(await at(2, '10:00'), await at(2, '10:30'), { email: 'f@f.example' }))).toBe('stratos:booking_disabled');
    await ok(db, 'owner', `update booking_settings set enabled = true`);
  });

  test('confirmed by Google: a public booking becomes a lead (or joins one), is logged as answered, and the owner is told', async () => {
    const [b] = await ok(db, 'server', `select id from bookings where guest_email = 'anna@kert.example'`);
    await ok(db, 'server', `select booking_confirm($1, 'ev-1', 'https://meet.google.com/abc-defg-hij')`, [b.id]);
    const [row] = await ok(db, 'admin', `select google_event_id, meet_url, lead_id from bookings where id = $1`, [b.id]);
    expect([row.google_event_id, row.meet_url]).toEqual(['ev-1', 'https://meet.google.com/abc-defg-hij']);
    const [lead] = await ok(db, 'admin', `select name, email, form_type, source, status, message from leads where id = $1`, [row.lead_id]);
    expect(lead).toEqual({ name: 'Kovács Anna', email: 'anna@kert.example', form_type: 'booking', source: 'booking', status: 'new', message: 'Új weboldal' });
    const [log] = await ok(db, 'admin', `select kind, summary from interactions where lead_id = $1`, [row.lead_id]);
    expect(log.kind).toBe('meeting');
    expect(log.summary).toMatch(/^Időpontot foglalt: \d{4}-\d{2}-\d{2} 10:00 \(Google Meet\) — Új weboldal$/);
    const [note] = (await db.query<{ audience: string; kind: string; payload: Record<string, unknown> }>(
      `select audience, kind, payload from notification_outbox where kind = 'booking_made'`)).rows;
    expect(note).toMatchObject({ audience: 'owner', kind: 'booking_made', payload: { booking_id: b.id, name: 'Kovács Anna', lead_id: row.lead_id, kind: 'public' } });
    // An address that already has a live lead joins it rather than making a second.
    await db.exec(`insert into leads (id, name, email, status) values ('${id(401)}', 'Béla', 'b@b.example', 'contacted')`);
    const [b2] = await ok(db, 'server', `select id from bookings where guest_email = 'b@b.example'`);
    await ok(db, 'server', `select booking_confirm($1, 'ev-2', null)`, [b2.id]);
    expect((await ok(db, 'admin', `select lead_id from bookings where id = $1`, [b2.id]))[0].lead_id).toBe(id(401));
    expect((await db.query(`select count(*)::int as n from leads where email = 'b@b.example'`)).rows[0]).toEqual({ n: 1 });
    // A booking that is not confirmed any more cannot be confirmed.
    expect(refusal(await as(db, 'server', `select booking_confirm($1, 'ev-x', null)`, [id(998)]))).toBe('stratos:booking_missing');
  });

  test('refused by Google: the booking is marked failed and its time is free again', async () => {
    const r = await made(await reserve('public', await at(1, '11:00'), await at(1, '11:30'), { email: 'g@g.example' }));
    await ok(db, 'server', `select booking_fail($1, 'calendar 403')`, [r]);
    expect((await ok(db, 'admin', `select status, error from bookings where id = $1`, [r]))[0]).toEqual({ status: 'failed', error: 'calendar 403' });
    await made(await reserve('public', await at(1, '11:00'), await at(1, '11:30'), { email: 'g@g.example' }));
  });

  test('moving: into a free time it goes, into a taken one or too late it does not; the owner may move whenever', async () => {
    const [b] = await ok(db, 'server', `select id, starts_at from bookings where guest_email = 'g@g.example' and status = 'confirmed'`);
    const moved = await ok(db, 'server', `select (booking_move($1, $2, $3, 'guest', $4)).starts_at`, [b.id, await at(1, '13:00'), await at(1, '13:30'), NOW]);
    expect(new Date(moved[0].starts_at as string).toISOString()).toBe(new Date(await at(1, '13:00')).toISOString());
    expect((await db.query(`select count(*)::int as n from notification_outbox where kind = 'booking_moved'`)).rows[0]).toEqual({ n: 1 });
    // Into a time that overlaps its OWN old time: allowed (it does not block itself).
    await ok(db, 'server', `select booking_move($1, $2, $3, 'guest', $4)`, [b.id, await at(1, '13:15'), await at(1, '13:45'), NOW]);
    // Into Monday's taken 10:00.
    expect(refusal(await as(db, 'server', `select booking_move($1, $2, $3, 'guest', $4)`, [b.id, await at(0, '10:00'), await at(0, '10:30'), NOW])))
      .toBe('stratos:booking_day_full');
    await ok(db, 'server', `select booking_move($1, $2, $3, 'guest', $4)`, [b.id, await at(1, '13:00'), await at(1, '13:30'), NOW]);
    const other = await made(await reserve('public', await at(1, '14:00'), await at(1, '14:30'), { email: 'h@h.example' }));
    expect(refusal(await as(db, 'server', `select booking_move($1, $2, $3, 'guest', $4)`, [other, await at(1, '13:30'), await at(1, '14:00'), NOW])))
      .toBe('stratos:booking_taken');
    // 11 hours before it: too late for the guest, not for the owner.
    const late = await at(1, '03:00');
    expect(refusal(await as(db, 'server', `select booking_move($1, $2, $3, 'guest', $4)`, [other, await at(2, '14:00'), await at(2, '14:30'), late])))
      .toBe('stratos:booking_too_late');
    // The new time still has to meet the rules, the owner's included (notice from `late`).
    expect(refusal(await as(db, 'server', `select booking_move($1, $2, $3, 'owner', $4)`, [other, await at(1, '15:00'), await at(1, '15:30'), late])))
      .toBe('stratos:booking_too_soon');
    await ok(db, 'server', `select booking_move($1, $2, $3, 'owner', $4)`, [other, await at(2, '15:00'), await at(2, '15:30'), late]);
    expect((await db.query(`select count(*)::int as n from notification_outbox where kind = 'booking_moved'`)).rows[0]).toEqual({ n: 3 });
    // Google refused the move: back to where it was, the count with it.
    await ok(db, 'server', `select booking_restore($1, $2, $3, 'calendar 500')`, [other, await at(1, '14:00'), await at(1, '14:30')]);
    const [back] = await ok(db, 'admin', `select starts_at, moved_count, error from bookings where id = $1`, [other]);
    expect([new Date(back.starts_at as string).toISOString(), back.moved_count, back.error]).toEqual([new Date(await at(1, '14:00')).toISOString(), 0, 'calendar 500']);
  });

  test('cancelling: the guest up to 12 hours before, the owner whenever; the time is free at once; the owner is told only of others\' cancellations', async () => {
    const [b] = await ok(db, 'server', `select id from bookings where guest_email = 'h@h.example'`);
    expect(refusal(await as(db, 'server', `select booking_cancel($1, 'guest', $2)`, [b.id, await at(1, '03:00')]))).toBe('stratos:booking_too_late');
    expect(refusal(await as(db, 'server', `select booking_cancel($1, 'nobody', $2)`, [b.id, NOW]))).toBe('stratos:booking_kind');
    const [c] = await ok(db, 'server', `select (booking_cancel($1, 'guest', $2)).status`, [b.id, NOW]);
    expect(c.status).toBe('cancelled');
    expect(refusal(await as(db, 'server', `select booking_cancel($1, 'guest', $2)`, [b.id, NOW]))).toBe('stratos:booking_missing');
    expect((await db.query(`select count(*)::int as n from notification_outbox where kind = 'booking_cancelled'`)).rows[0]).toEqual({ n: 1 });
    // Free again, and the address may book again.
    await made(await reserve('public', await at(1, '14:00'), await at(1, '14:30'), { email: 'h@h.example' }));
    const [again] = await ok(db, 'server', `select id from bookings where guest_email = 'h@h.example' and status = 'confirmed'`);
    await ok(db, 'server', `select booking_cancel($1, 'owner', $2)`, [again.id, await at(1, '13:59')]);
    expect((await db.query(`select count(*)::int as n from notification_outbox where kind = 'booking_cancelled'`)).rows[0]).toEqual({ n: 1 });
  });

  test('a client books for their own project, as themselves; not for another\'s; at most three open', async () => {
    const anna = await invite(db, ORG.a, 'Anna', 'anna@a.example', [P.a1], U.a1);
    const [me] = await ok(db, 'a1', `select * from client_booking_identity()`);
    expect(me).toEqual({ account_id: anna, organization_id: ORG.a, full_name: 'Anna', email: 'anna@a.example', projects: [{ id: P.a1, name: 'A website' }] });
    expect(await ok(db, 'admin', `select * from client_booking_identity()`)).toEqual([]);
    const c1 = await made(await reserve('client', await at(3, '10:00'), await at(3, '11:00'), { account: anna, project: P.a1, name: 'Ignored', email: 'ignored@x.example' }));
    const [row] = await ok(db, 'admin', `select guest_name, guest_email, organization_id, project_id, manage_hash from bookings where id = $1`, [c1]);
    expect(row).toEqual({ guest_name: 'Anna', guest_email: 'anna@a.example', organization_id: ORG.a, project_id: P.a1, manage_hash: null });
    expect(refusal(await reserve('client', await at(3, '13:00'), await at(3, '13:30'), { account: anna, project: P.b1 }))).toBe('stratos:client_no_access');
    expect(refusal(await reserve('client', await at(3, '13:00'), await at(3, '13:30'), { account: id(999) }))).toBe('stratos:client_no_access');
    await made(await reserve('client', await at(3, '13:00'), await at(3, '13:30'), { account: anna }));
    await made(await reserve('client', await at(3, '14:00'), await at(3, '14:30'), { account: anna }));
    expect(refusal(await reserve('client', await at(3, '15:00'), await at(3, '15:30'), { account: anna }))).toBe('stratos:booking_client_limit');
    await ok(db, 'server', `select booking_confirm($1, 'ev-c1', null)`, [c1]);
    const [note] = (await db.query<{ project_id: string; payload: Record<string, unknown> }>(
      `select project_id, payload from notification_outbox where kind = 'booking_made' and payload->>'booking_id' = $1`, [c1])).rows;
    expect(note).toMatchObject({ project_id: P.a1, payload: { kind: 'client', account_id: anna } });
    expect((await ok(db, 'admin', `select lead_id from bookings where id = $1`, [c1]))[0].lead_id).toBeNull();
  });

  test('the client portal: each client sees their own bookings and whether they may still change them; nobody else\'s', async () => {
    await invite(db, ORG.b, 'Cili', 'cili@b.example', [P.b1], U.b1);
    const mine = await ok(db, 'a1', `select project_name, status, can_change from client_portal_bookings()`);
    expect(mine).toEqual([
      { project_name: 'A website', status: 'confirmed', can_change: true },
      { project_name: null, status: 'confirmed', can_change: true },
      { project_name: null, status: 'confirmed', can_change: true },
    ]);
    expect(await ok(db, 'b1', `select * from client_portal_bookings()`)).toEqual([]);
    expect(await ok(db, 'admin', `select * from client_portal_bookings()`)).toEqual([]);
    expect((await as(db, 'anon', `select * from client_portal_bookings()`)).error?.code).toBe('42501');
  });

  test('the API: admins read the diary; team members, clients and visitors do not; nobody writes it; the server functions are the server\'s', async () => {
    expect((await ok(db, 'admin', `select count(*)::int as n from bookings`))[0].n).toBeGreaterThan(5);
    expect(await ok(db, 'team', `select * from bookings`)).toEqual([]);
    expect(await ok(db, 'a1', `select * from bookings`)).toEqual([]);
    expect((await as(db, 'anon', `select * from bookings`)).error?.code).toBe('42501');
    expect((await as(db, 'owner', `insert into bookings (kind, starts_at, ends_at, guest_name, guest_email) values ('public', now() + interval '3 days', now() + interval '3 days 30 minutes', 'X', 'x@x.example')`)).error?.code).toBe('42501');
    expect((await as(db, 'owner', `update bookings set status = 'cancelled'`)).error?.code).toBe('42501');
    expect((await as(db, 'owner', `delete from bookings`)).error?.code).toBe('42501');
    for (const fn of [
      `booking_reserve('public', now(), now(), 'x', 'x@x.example')`, `booking_confirm('${id(1)}', 'e')`, `booking_fail('${id(1)}', 'e')`,
      `booking_move('${id(1)}', now(), now(), 'owner')`, `booking_cancel('${id(1)}', 'owner')`, `booking_restore('${id(1)}', now(), now(), 'e')`,
    ]) {
      expect((await as(db, 'owner', `select ${fn}`)).error?.code, fn).toBe('42501');
      expect((await as(db, 'a1', `select ${fn}`)).error?.code, fn).toBe('42501');
      expect((await as(db, 'anon', `select ${fn}`)).error?.code, fn).toBe('42501');
    }
    // The fixed facts of a booking stay fixed, even for the server.
    const [b] = await ok(db, 'server', `select id from bookings where kind = 'public' and status = 'confirmed' limit 1`);
    expect(refusal(await as(db, 'server', `update bookings set guest_email = 'other@x.example' where id = $1`, [b.id]))).toBe('stratos:booking_fixed');
  });

  test('the migration runs twice without harm', async () => {
    await db.exec(read(MIGRATIONS, '20261018000100_booking.sql'));
    expect((await db.query(`select count(*)::int as n from booking_settings`)).rows[0]).toEqual({ n: 1 });
  });
});

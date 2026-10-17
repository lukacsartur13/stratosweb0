import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
// @ts-expect-error — plain .mjs Netlify function modules
import { __net, sealToken, FREEBUSY_SCOPE, SCOPES } from '../netlify/functions/google-lib.mjs';
import {
  zoned, wallClock, candidateSlots, freeSlots, without, readBooking, bookingEvent, meetLink, manageUrl, newToken, hashToken, googleBusy,
// @ts-expect-error — plain .mjs Netlify function modules
} from '../netlify/functions/booking-lib.mjs';
// @ts-expect-error — plain .mjs Netlify function modules
import { makeHandler, restDb, __resetLimits } from '../netlify/functions/booking.mjs';

/**
 * Booking (netlify/functions/booking*.mjs): the time arithmetic and the form
 * as pure functions; then /api/booking end to end against real Postgres
 * (PGlite, every migration) with a fake Google — free times, a booking that
 * lands in the calendar with a Meet link and Google's invitation, the guest's
 * link, moving and cancelling, a client's booking, and every refusal. The
 * database alone is tests/portal-booking-db.spec.ts.
 */

process.env.GOOGLE_TOKEN_KEY = Buffer.alloc(32, 9).toString('base64');
const ZONE = 'Europe/Budapest';
const MIN = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();

/* ============================================================ pure parts */

test('time zones: a skipped hour does not exist, a repeated one takes its first occurrence, winter and summer both right', () => {
  expect(zoned(2026, 3, 29, 2, 30, ZONE)).toBeNull();
  expect(iso(zoned(2026, 10, 25, 2, 30, ZONE))).toBe('2026-10-25T00:30:00.000Z');
  expect(iso(zoned(2026, 11, 2, 9, 0, ZONE))).toBe('2026-11-02T08:00:00.000Z');
  expect(iso(zoned(2026, 7, 6, 9, 0, ZONE))).toBe('2026-07-06T07:00:00.000Z');
  expect(wallClock(Date.parse('2026-11-02T08:00:00Z'), ZONE)).toMatchObject({ y: 2026, m: 11, d: 2, h: 9, mi: 0, wd: 1 });
});

const SETTINGS = {
  time_zone: ZONE, weekdays: [1, 2, 3, 4, 5], day_start: '09:00:00', day_end: '17:00:00', public_minutes: 30, client_minutes: [30, 60],
  buffer_minutes: 15, notice_hours: 24, horizon_days: 30, daily_max: 4, change_hours: 12, calendar_ids: ['primary'], enabled: true,
};

test('the grid: weekdays 9–17 in Budapest across the clock change, every 30 minutes; a 60-minute call ends by 17:00', () => {
  const from = Date.parse('2026-10-23T00:00:00Z'); // Friday, summer time
  const to = Date.parse('2026-10-27T00:00:00Z');   // Tuesday, winter time
  const s30 = candidateSlots(SETTINGS, 30, from, to);
  expect([...new Set(s30.map((s: { day: string }) => s.day))]).toEqual(['2026-10-23', '2026-10-26']);
  expect(s30.filter((s: { day: string }) => s.day === '2026-10-23')).toHaveLength(16);
  expect(iso(s30[0].start)).toBe('2026-10-23T07:00:00.000Z');
  expect(iso(s30.find((s: { day: string }) => s.day === '2026-10-26').start)).toBe('2026-10-26T08:00:00.000Z');
  expect(iso(s30.at(-1).end)).toBe('2026-10-26T16:00:00.000Z'); // 17:00 Budapest
  const s60 = candidateSlots(SETTINGS, 60, from, to);
  expect(s60.filter((s: { day: string }) => s.day === '2026-10-26')).toHaveLength(15);
  expect(iso(s60.at(-1).start)).toBe('2026-10-26T15:00:00.000Z'); // 16:00, ends 17:00
  expect(candidateSlots({ ...SETTINGS, weekdays: [6] }, 30, from, to).map((s: { day: string }) => s.day)[0]).toBe('2026-10-24');
});

test('free: 15 minutes clear of anything busy on both sides; a full day offers nothing; a booking being moved does not block itself', () => {
  const day = candidateSlots(SETTINGS, 30, Date.parse('2026-11-02T00:00:00Z'), Date.parse('2026-11-02T23:00:00Z'));
  const at = (h: number, m = 0) => zoned(2026, 11, 2, h, m, ZONE);
  const busy = [{ start: at(10), end: at(11) }];
  const free = freeSlots(day, { busy, buffer: 15 }).map((s: { start: number }) => wallClock(s.start, ZONE)).map((w: { h: number; mi: number }) => `${w.h}:${w.mi}`);
  expect(free.slice(0, 3)).toEqual(['9:0', '11:30', '12:0']);
  expect(freeSlots(day, { busy: [], buffer: 15, dailyMax: 4, perDay: { '2026-11-02': 4 } })).toEqual([]);
  expect(without(busy, at(10), at(10, 30))).toEqual([{ start: at(10, 30), end: at(11) }]);
  expect(without([{ start: at(9), end: at(12) }], at(10), at(10, 30))).toEqual([{ start: at(9), end: at(10) }, { start: at(10, 30), end: at(12) }]);
});

test('the form: required name, address, topic and consent; capped; cleaned; a client sends only the topic and project', () => {
  expect(readBooking({}).errors).toEqual({ start: 'invalid', minutes: 'invalid', name: 'required', email: 'required', topic: 'required', consent: 'required' });
  const r = readBooking({ start: '2026-11-02T08:00:00Z', minutes: 30, name: '  Kovács Anna\u0007 ', email: ' Anna@Kert.HU ', topic: 'Új webshop',
    phone: '+36 30 123 4567', consent: true, locale: 'de', extra: 'ignored' });
  expect(r.value).toEqual({ start: '2026-11-02T08:00:00Z', minutes: 30, topic: 'Új webshop', locale: 'de', name: 'Kovács Anna', email: 'anna@kert.hu', company: '', phone: '+36 30 123 4567' });
  expect(readBooking({ start: 'x', minutes: 30, name: 'a'.repeat(121), email: 'no-at', topic: 'ok?', phone: 'call me', consent: true }).errors)
    .toEqual({ start: 'invalid', name: 'too_long', email: 'invalid', phone: 'invalid' });
  expect(readBooking({ start: '2026-11-02T08:00:00Z', minutes: 60, topic: '', projectId: 'not-a-uuid' }, { client: true }).value)
    .toEqual({ start: '2026-11-02T08:00:00Z', minutes: 60, topic: '', locale: 'hu', projectId: null });
});

test('the event: in the owner\'s calendar with the guest invited, a Meet request, and the guest\'s link — in the guest\'s language', () => {
  const b = { id: 'b1', kind: 'public', starts_at: '2026-11-02T08:00:00Z', ends_at: '2026-11-02T08:30:00Z', time_zone: ZONE,
    guest_name: 'Kovács Anna', guest_email: 'anna@kert.hu', guest_company: 'Kert Kft.', guest_phone: null, topic: 'Webshop', locale: 'hu' };
  const e = bookingEvent(b, { origin: 'https://stratosweb.hu', manage: 'https://stratosweb.hu/idopontfoglalas#m=x', changeHours: 12 });
  expect(e.summary).toBe('Stratos konzultáció — Kovács Anna (Kert Kft.)');
  expect(e.attendees).toEqual([{ email: 'anna@kert.hu', displayName: 'Kovács Anna' }]);
  expect(e.start).toEqual({ dateTime: '2026-11-02T08:00:00.000Z', timeZone: ZONE });
  expect(e.conferenceData.createRequest).toEqual({ requestId: 'booking-b1', conferenceSolutionKey: { type: 'hangoutsMeet' } });
  expect(e.description).toBe('Téma: Webshop\n\nLemondás vagy áthelyezés (legkésőbb 12 órával előtte): https://stratosweb.hu/idopontfoglalas#m=x');
  const c = bookingEvent({ ...b, kind: 'client', locale: 'en', guest_company: null, topic: null }, { origin: 'https://stratosweb.hu', projectName: 'Rapidkert' });
  expect(c.summary).toBe('Stratos meeting — Kovács Anna');
  expect(c.description).toBe('Project: Rapidkert\n\nCancel or move it in the client portal (at least 12 hours before): https://stratosweb.hu/portal/');
  expect(meetLink({ hangoutLink: 'https://meet.google.com/abc-defg-hij' })).toBe('https://meet.google.com/abc-defg-hij');
  expect(meetLink({ hangoutLink: 'https://evil.example/x' })).toBeNull();
  expect(manageUrl('https://stratosweb.hu', 'de', 'tok')).toBe('https://stratosweb.hu/de/termin-buchen#m=tok');
  const t = newToken();
  expect(t.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
  expect(t.hash).toBe(hashToken(t.token));
  expect(t.hash).toMatch(/^[0-9a-f]{64}$/);
});

test('freeBusy: asked in chunks of at most 60 days; any calendar error is a refusal, never "free"', async () => {
  const asked: { timeMin: string; timeMax: string; items: unknown }[] = [];
  const fetchJson = async (_t: string, _u: string, init: { body: string }) => {
    asked.push(JSON.parse(init.body));
    return { ok: true, status: 200, body: { calendars: { primary: { busy: [{ start: '2026-11-02T09:00:00Z', end: '2026-11-02T10:00:00Z' }] } } } };
  };
  const from = Date.parse('2026-11-01T00:00:00Z');
  const busy = await googleBusy(fetchJson, 'at', { calendars: ['primary'], fromMs: from, toMs: from + 100 * 864e5, zone: ZONE });
  expect(asked).toHaveLength(2);
  expect(asked[0].items).toEqual([{ id: 'primary' }]);
  expect(busy).toHaveLength(2);
  await expect(googleBusy(async () => ({ ok: true, status: 200, body: { calendars: { primary: { errors: [{ reason: 'notFound' }] } } } }), 'at',
    { calendars: ['primary'], fromMs: from, toMs: from + 864e5, zone: ZONE })).rejects.toThrow('freebusy calendar');
  await expect(googleBusy(async () => ({ ok: false, status: 403, body: {} }), 'at',
    { calendars: ['primary'], fromMs: from, toMs: from + 864e5, zone: ZONE })).rejects.toThrow('freebusy 403');
  expect(SCOPES).toContain(FREEBUSY_SCOPE);
});

test('the database through PostgREST: the server key, the right filters, the session checked as the person', async () => {
  const seen: { url: string; auth: string | null; body: string | null }[] = [];
  const original = __net.fetch;
  __net.fetch = async (url: string, init: { headers?: Record<string, string>; body?: string } = {}) => {
    seen.push({ url, auth: init.headers?.authorization ?? null, body: init.body ?? null });
    if (url.endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id: 'u1' }), { status: 200 });
    if (url.endsWith('/rpc/is_admin')) return new Response('false', { status: 200 });
    if (url.endsWith('/rpc/client_booking_identity')) return new Response(JSON.stringify([{ account_id: 'a1', projects: [] }]), { status: 200 });
    if (url.includes('/rpc/booking_reserve')) return new Response(JSON.stringify({ code: 'P0001', message: 'stratos:booking_taken' }), { status: 400 });
    return new Response('[]', { status: 200 });
  };
  try {
    const db = restDb({ supabase: 'https://x.supabase.co', publicKey: 'pub', serverKey: 'srv' });
    await db.taken('2026-11-02T00:00:00.000Z', '2026-11-03T00:00:00.000Z');
    await db.booking({ hash: 'ab'.repeat(32) });
    expect(await db.rpc('booking_reserve', { p_kind: 'public' })).toEqual({ data: null, error: { code: 'P0001', message: 'stratos:booking_taken' } });
    expect(await db.identify('session-token')).toEqual({ admin: false, client: { account_id: 'a1', projects: [] } });
    expect(seen[0].url).toBe('https://x.supabase.co/rest/v1/bookings?select=id,starts_at,ends_at,buffer_minutes&status=eq.confirmed&starts_at=lt.2026-11-03T00%3A00%3A00.000Z&ends_at=gt.2026-11-02T00%3A00%3A00.000Z');
    expect(seen[0].auth).toBe('Bearer srv');
    expect(seen[1].url).toBe(`https://x.supabase.co/rest/v1/bookings?select=*&manage_hash=eq.${'ab'.repeat(32)}`);
    expect(JSON.parse(seen[2].body!)).toEqual({ p_kind: 'public' });
    expect(seen.slice(3).map((s) => [s.url.replace('https://x.supabase.co', ''), s.auth])).toEqual([
      ['/auth/v1/user', 'Bearer session-token'], ['/rest/v1/rpc/is_admin', 'Bearer session-token'], ['/rest/v1/rpc/client_booking_identity', 'Bearer session-token'],
    ]);
  } finally {
    __net.fetch = original;
  }
});

/* ===================================================== end to end, PGlite */

const ROOT = process.cwd();
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations');
const read = (file: string) => fs.readFileSync(path.join(MIGRATIONS, file), 'utf8');
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const U = { owner: id(1), admin: id(3), a1: id(5), b1: id(7) };
const ORG = { a: id(101), b: id(102) };
const P = { a1: id(201), a2: id(202), b1: id(203) };

const STANDIN = `
  create role anon nologin; create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claims', true)::jsonb->>'sub', '')::uuid $$;
  grant usage on schema auth, public to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on functions to anon, authenticated;
  alter default privileges in schema public grant all on sequences to anon, authenticated;
  create schema storage;
  create table storage.buckets (id text primary key, name text not null, owner uuid, public boolean default false,
    file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now(), updated_at timestamptz default now());
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
    name text not null, owner uuid, metadata jsonb, created_at timestamptz default now(), unique (bucket_id, name));
  alter table storage.objects enable row level security;
  grant usage on schema storage to anon, authenticated;
  grant select, insert, update, delete on storage.objects to anon, authenticated;
  grant select on storage.buckets to anon, authenticated;
  insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true);
`;

async function fresh() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(STANDIN);
  const files = fs.readdirSync(MIGRATIONS).filter((f) => /^\d+_[a-z_]+\.sql$/.test(f)).sort();
  for (const f of files.filter((x) => x <= '20260928000200_owner_tracker.sql')) await db.exec(read(f));
  await db.exec(`
    insert into auth.users (id, email) values ('${U.owner}', 'owner@example.invalid'), ('${U.admin}', 'admin@example.invalid'),
      ('${U.a1}', 'anna@a.example'), ('${U.b1}', 'cili@b.example');
    insert into organizations (id, name, slug, status) values ('${ORG.a}', 'A Kft.', 'a', 'active'), ('${ORG.b}', 'B Kft.', 'b', 'active');
    update profiles set role = 'super_admin' where id = '${U.owner}';
    update profiles set role = 'admin' where id = '${U.admin}';
    insert into projects (id, organization_id, name, slug, status, value, currency) values
      ('${P.a1}', '${ORG.a}', 'Rapidkert weboldal', 'a-web', 'active', 1, 'HUF'), ('${P.a2}', '${ORG.a}', 'A ads', 'a-ads', 'active', 1, 'HUF'),
      ('${P.b1}', '${ORG.b}', 'B brand', 'b-brand', 'active', 1, 'HUF');
  `);
  await db.query(`select portal_set_owner('owner@example.invalid')`);
  for (const f of files.filter((x) => x > '20260928000200_owner_tracker.sql')) await db.exec(read(f));
  return db;
}

async function asUser(db: PGlite, user: string, sql: string, params: unknown[] = []) {
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: user, role: 'authenticated' })]);
  await db.exec('set role authenticated');
  try { return (await db.query<Record<string, unknown>>(sql, params)).rows; } finally { await db.exec('reset role'); }
}

/** The booking function's view of the database, on PGlite, past RLS as its server key is — what restDb does over PostgREST. */
function pgDb(db: PGlite, sessions: Record<string, string>) {
  const server = async (sql: string, params: unknown[] = []) => {
    await db.query(`select set_config('request.jwt.claims', '{}', false)`);
    return (await db.query<Record<string, unknown>>(sql, params)).rows;
  };
  const named = (args: Record<string, unknown>) => {
    const keys = Object.keys(args);
    return { list: keys.map((k, i) => `${k} => $${i + 1}`).join(', '), values: keys.map((k) => args[k]) };
  };
  return {
    hooks: { taken: true },
    settings: async () => (await server(`select * from booking_settings where singleton`))[0] ?? null,
    owner: async () => (await server(`select user_id from portal_owner`))[0]?.user_id ?? null,
    calendarOf: async (u: string) => (await server(`select user_id, scopes, refresh_token_enc, last_error from google_accounts where user_id = $1`, [u]))[0] ?? null,
    async taken(from: string, to: string) {
      if (!this.hooks.taken) return [];
      return server(`select id, starts_at::text, ends_at::text, buffer_minutes from bookings where status = 'confirmed' and starts_at < $2 and ends_at > $1`, [from, to]);
    },
    booking: async ({ id: bid, hash }: { id?: string; hash?: string }) =>
      (await server(`select *, starts_at::text as starts_at, ends_at::text as ends_at from bookings where ${bid ? 'id' : 'manage_hash'} = $1`, [bid ?? hash]))[0] ?? null,
    async rpc(fn: string, args: Record<string, unknown>) {
      const { list, values } = named(args);
      try {
        if (fn === 'booking_move' || fn === 'booking_cancel') return { data: (await server(`select to_jsonb(x) as r from ${fn}(${list}) x`, values))[0].r, error: null };
        return { data: (await server(`select ${fn}(${list})::text as r`, values))[0].r || null, error: null };
      } catch (e) {
        const err = e as { code?: string; message: string };
        return { data: null, error: { code: err.code, message: err.message } };
      }
    },
    async identify(token: string) {
      const user = sessions[token];
      if (!user) return null;
      if (user === U.owner || user === U.admin) return { admin: true, client: null };
      return { admin: false, client: (await asUser(db, user, `select * from client_booking_identity()`))[0] ?? null };
    },
  };
}

type Sent = { method: string; url: string; body: Record<string, unknown> | null };
function fakeGoogle() {
  const g = { sent: [] as Sent[], busy: [] as { start: string; end: string }[], fail: '' as '' | 'insert' | 'delete' | 'patch' | 'freebusy', events: 0 };
  __net.fetch = async (url: string, init: { method?: string; body?: string } = {}) => {
    const method = init.method ?? 'GET';
    const body = init.body && !url.includes('oauth2') ? JSON.parse(init.body) : null;
    g.sent.push({ method, url, body });
    if (url.startsWith('https://oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'at-1' }), { status: 200 });
    if (url.endsWith('/freeBusy')) {
      if (g.fail === 'freebusy') return new Response('{}', { status: 500 });
      return new Response(JSON.stringify({ calendars: { primary: { busy: g.busy } } }), { status: 200 });
    }
    if (url.includes('/calendars/primary/events')) {
      if (method === 'POST') {
        if (g.fail === 'insert') return new Response('{}', { status: 403 });
        g.events += 1;
        return new Response(JSON.stringify({ id: `ev-${g.events}`, hangoutLink: 'https://meet.google.com/abc-defg-hij' }), { status: 200 });
      }
      if (method === 'DELETE') return new Response(null, { status: g.fail === 'delete' ? 500 : 204 });
      if (method === 'PATCH') return g.fail === 'patch' ? new Response('{}', { status: 500 }) : new Response(JSON.stringify({ id: 'ev' }), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  };
  return g;
}

test.describe('/api/booking', () => {
  test.describe.configure({ mode: 'serial' });
  let db: PGlite;
  let api: (req: Request) => Promise<Response>;
  let store: ReturnType<typeof pgDb>;
  let g: ReturnType<typeof fakeGoogle>;
  const original = __net.fetch;
  const ORIGIN = 'https://stratosweb.hu';
  const SESSIONS = { 'owner-session': U.owner, 'anna-session': U.a1, 'cili-session': U.b1, 'nobody-session': '' };

  const get = async (q = '', auth?: string) => {
    const r = await api(new Request(`${ORIGIN}/api/booking${q}`, { headers: auth ? { authorization: `Bearer ${auth}` } : {} }));
    return { status: r.status, body: await r.json() };
  };
  const post = async (body: Record<string, unknown>, auth?: string, ip = '203.0.113.7') => {
    const r = await api(new Request(`${ORIGIN}/api/booking`, {
      method: 'POST', body: JSON.stringify(body),
      headers: { 'content-type': 'application/json', 'x-nf-client-connection-ip': ip, ...(auth ? { authorization: `Bearer ${auth}` } : {}) },
    }));
    return { status: r.status, body: await r.json() };
  };
  const guest = (start: string, extra: Record<string, unknown> = {}) => ({
    action: 'book', start, minutes: 30, name: 'Kovács Anna', email: 'anna@kert.example', company: 'Kert Kft.', topic: 'Új webshop',
    consent: true, locale: 'hu', elapsedMs: 9000, company_website: '', ...extra,
  });
  const rows = (sql: string, params: unknown[] = []) => db.query<Record<string, unknown>>(sql, params).then((r) => r.rows);
  /** The first free start of each of the first `n` days that have one. */
  const days = (slots: { start: string }[]) => {
    const seen = new Map<string, string>();
    for (const s of slots) {
      const w = wallClock(Date.parse(s.start), ZONE);
      const k = `${w.y}-${w.m}-${w.d}`;
      if (!seen.has(k)) seen.set(k, s.start);
    }
    return [...seen.values()];
  };

  test.beforeAll(async () => {
    db = await fresh();
    store = pgDb(db, SESSIONS);
    api = makeHandler({ db: store, origin: ORIGIN, creds: { clientId: 'cid', clientSecret: 'secret' } });
    g = fakeGoogle();
  });
  test.afterAll(() => { __net.fetch = original; });
  test.beforeEach(() => { __resetLimits(); g.fail = ''; g.busy = []; });

  test('nothing to book until the owner\'s Google is connected — and connected with the freeBusy permission', async () => {
    expect(await get()).toEqual({ status: 503, body: { ok: false, code: 'CALENDAR_NOT_CONNECTED' } });
    await db.query(`insert into google_accounts (user_id, google_email, scopes, refresh_token_enc) values ($1, 'owner@media-stratos.example', $2, $3)`,
      [U.owner, 'openid email https://www.googleapis.com/auth/calendar.events', sealToken('1//refresh')]);
    expect((await get()).body.code).toBe('CALENDAR_RECONNECT');
    await db.query(`update google_accounts set scopes = $1`, [SCOPES.join(' ')]);
    expect((await get()).status).toBe(200);
  });

  test('the free times: 30 minutes, weekdays 9–17 Budapest, from 24 hours to 30 days ahead, and 15 minutes clear of the owner\'s events', async () => {
    const { body } = await get();
    expect(body).toMatchObject({ ok: true, timeZone: ZONE, minutes: 30, options: [30], changeHours: 12 });
    const first = Date.parse(body.slots[0].start);
    expect(first).toBeGreaterThanOrEqual(Date.now() + 24 * 3600_000 - 60_000);
    expect(Date.parse(body.slots.at(-1).start)).toBeLessThanOrEqual(Date.now() + 30 * 864e5);
    for (const s of body.slots) {
      const w = wallClock(Date.parse(s.start), ZONE);
      expect(w.wd).toBeLessThanOrEqual(5);
      expect(w.h * 60 + w.mi).toBeGreaterThanOrEqual(9 * 60);
      expect(Date.parse(s.end) - Date.parse(s.start)).toBe(30 * MIN);
      expect(w.mi % 30).toBe(0);
    }
    // The owner has something 10:00–11:00 on the second free day.
    const day = wallClock(Date.parse(days(body.slots)[1]), ZONE);
    g.busy = [{ start: iso(zoned(day.y, day.m, day.d, 10, 0, ZONE)), end: iso(zoned(day.y, day.m, day.d, 11, 0, ZONE)) }];
    const after = (await get()).body.slots.map((s: { start: string }) => wallClock(Date.parse(s.start), ZONE))
      .filter((w: { d: number; m: number }) => w.d === day.d && w.m === day.m).map((w: { h: number; mi: number }) => `${w.h}:${String(w.mi).padStart(2, '0')}`);
    expect(after.slice(0, 2)).toEqual(['9:00', '11:30']);
    const ask = g.sent.filter((x) => x.url.endsWith('/freeBusy')).at(-1)!;
    expect(ask.body).toMatchObject({ timeZone: ZONE, items: [{ id: 'primary' }] });
    // Google unreachable: no times at all rather than times that may be taken.
    g.fail = 'freebusy';
    expect(await get()).toEqual({ status: 502, body: { ok: false, code: 'CALENDAR_UNREACHABLE' } });
  });

  test('a booking: Google gets the event with the guest, a Meet request and sendUpdates=all; it is confirmed, becomes a lead, and its time is gone', async () => {
    const free = (await get()).body.slots;
    const start = days(free)[0];
    const res = await post(guest(start));
    expect(res.status).toBe(200);
    expect(res.body.booking).toMatchObject({ start: iso(Date.parse(start)), minutes: 30, status: 'confirmed', meetUrl: 'https://meet.google.com/abc-defg-hij',
      email: 'anna@kert.example', canChange: true });
    expect(res.body.booking.manageUrl).toMatch(/^https:\/\/stratosweb\.hu\/idopontfoglalas#m=[A-Za-z0-9_-]{32}$/);
    const insert = g.sent.find((x) => x.method === 'POST' && x.url.includes('/events'))!;
    expect(insert.url).toBe('https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all');
    expect(insert.body).toMatchObject({
      summary: 'Stratos konzultáció — Kovács Anna (Kert Kft.)',
      attendees: [{ email: 'anna@kert.example', displayName: 'Kovács Anna' }],
      conferenceData: { createRequest: { conferenceSolutionKey: { type: 'hangoutsMeet' } } },
    });
    expect(String(insert.body!.description)).toContain(res.body.booking.manageUrl);
    const [row] = await rows(`select status, google_event_id, meet_url, lead_id, manage_hash from bookings`);
    expect(row).toMatchObject({ status: 'confirmed', google_event_id: 'ev-1', meet_url: 'https://meet.google.com/abc-defg-hij' });
    expect(row.manage_hash).toBe(hashToken(res.body.booking.manageUrl.split('#m=')[1]));
    expect((await rows(`select form_type from leads where id = $1`, [row.lead_id]))[0]).toEqual({ form_type: 'booking' });
    // Gone from the free times, and so are the neighbours inside the 15 minutes.
    const now = (await get()).body.slots.map((s: { start: string }) => s.start);
    expect(now).not.toContain(free[0].start);
    expect(now).not.toContain(free[1].start);
    // The same address cannot hold two open bookings.
    expect((await post(guest(free[4].start))).body.code).toBe('EMAIL_OPEN');
  });

  test('a time that is no longer free is refused — by the check, and by the database when the check misses it', async () => {
    const taken = (await rows(`select starts_at from bookings where status = 'confirmed'`))[0].starts_at as Date;
    expect(await post(guest(iso(new Date(taken).getTime()), { email: 'b@b.example' }))).toEqual({ status: 409, body: { ok: false, code: 'TAKEN' } });
    store.hooks.taken = false;
    try {
      expect(await post(guest(iso(new Date(taken).getTime()), { email: 'b@b.example' }))).toEqual({ status: 409, body: { ok: false, code: 'TAKEN' } });
    } finally {
      store.hooks.taken = true;
    }
    // Off the grid, a weekend, or too soon: not offered, not bookable.
    expect((await post(guest(iso(new Date(taken).getTime() + 10 * MIN), { email: 'b@b.example' }))).body.code).toBe('UNAVAILABLE');
    expect((await post(guest(iso(Date.now() + 3600_000), { email: 'b@b.example' }))).body.code).toBe('UNAVAILABLE');
    expect((await post(guest(iso(new Date(taken).getTime()), { email: 'b@b.example', minutes: 60 }))).body.code).toBe('UNAVAILABLE');
  });

  test('Google refuses the event: nothing is booked, the time is free again, and the guest is told to try again', async () => {
    const start = days((await get()).body.slots)[1];
    g.fail = 'insert';
    expect(await post(guest(start, { email: 'c@c.example' }))).toEqual({ status: 502, body: { ok: false, code: 'CALENDAR_FAILED' } });
    expect((await rows(`select status, error from bookings where guest_email = 'c@c.example'`))[0]).toEqual({ status: 'failed', error: 'calendar 403' });
    g.fail = '';
    expect((await get()).body.slots.map((s: { start: string }) => s.start)).toContain(start);
    expect((await post(guest(start, { email: 'c@c.example' }))).status).toBe(200);
  });

  test('robots and bad forms: a filled hidden field or a too-fast form is dropped silently; a bad form is answered field by field', async () => {
    const start = days((await get()).body.slots)[2];
    const before = (await rows(`select count(*)::int as n from bookings`))[0].n;
    expect(await post(guest(start, { email: 'bot@x.example', company_website: 'http://spam' }))).toEqual({ status: 200, body: { ok: true, booking: null } });
    expect(await post(guest(start, { email: 'bot@x.example', elapsedMs: 400 }))).toEqual({ status: 200, body: { ok: true, booking: null } });
    expect((await rows(`select count(*)::int as n from bookings`))[0].n).toBe(before);
    const bad = await post(guest(start, { email: 'nope', consent: false, topic: '' }));
    expect(bad).toEqual({ status: 422, body: { ok: false, code: 'INVALID', fields: { email: 'invalid', topic: 'required', consent: 'required' } } });
    for (let i = 0; i < 4; i += 1) await post(guest(start, { email: 'nope' }), undefined, '198.51.100.9');
    expect((await post(guest(start, { email: 'nope' }), undefined, '198.51.100.9')).body.code).toBe('INVALID');
    expect((await post(guest(start, { email: 'nope' }), undefined, '198.51.100.9')).body.code).toBe('RATE_LIMITED');
    expect((await api(new Request(`${ORIGIN}/api/booking`, { method: 'POST', body: '{}', headers: { 'content-type': 'text/plain' } }))).status).toBe(415);
    expect((await post({ action: 'whatever' })).body.code).toBe('ACTION');
    expect((await api(new Request(`${ORIGIN}/api/booking`, { method: 'DELETE' }))).status).toBe(405);
  });

  test('the guest\'s link: shows the booking and where it could move; a wrong token shows nothing', async () => {
    const start = days((await get()).body.slots)[3];
    const made = await post(guest(start, { email: 'd@d.example', locale: 'en' }));
    const token = made.body.booking.manageUrl.split('#m=')[1];
    expect(made.body.booking.manageUrl.startsWith('https://stratosweb.hu/en/book-a-call#m=')).toBe(true);
    const m = await post({ action: 'manage', token });
    expect(m.status).toBe(200);
    expect(m.body.booking).toMatchObject({ start: iso(Date.parse(start)), status: 'confirmed', canChange: true, minutes: 30, name: 'Kovács Anna' });
    expect(m.body.slots.length).toBeGreaterThan(10);
    expect(await post({ action: 'manage', token: 'x'.repeat(32) })).toEqual({ status: 404, body: { ok: false, code: 'NOT_FOUND' } });
    expect(await post({ action: 'manage', token: 'short' })).toEqual({ status: 400, body: { ok: false, code: 'TOKEN' } });
  });

  test('moving with the link: the database first, then Google with sendUpdates=all; if Google refuses, back to where it was', async () => {
    const [b] = await rows(`select id, starts_at, manage_hash from bookings where guest_email = 'd@d.example'`);
    // The token lives only in the guest's link: the test gives the booking a new one it knows.
    const fresh = newToken();
    await db.query(`update bookings set manage_hash = $1 where id = $2`, [fresh.hash, b.id]);
    const { body: m } = await post({ action: 'manage', token: fresh.token });
    const target = m.slots.find((s: { start: string }) => Date.parse(s.start) > new Date(b.starts_at as Date).getTime() + 3 * 864e5).start;
    const moved = await post({ action: 'move', token: fresh.token, start: target });
    expect(moved.status).toBe(200);
    expect(moved.body.booking.start).toBe(iso(Date.parse(target)));
    const patch = g.sent.filter((x) => x.method === 'PATCH').at(-1)!;
    expect(patch.url).toMatch(/\/events\/ev-\d+\?sendUpdates=all$/);
    expect(patch.body).toMatchObject({ start: { dateTime: iso(Date.parse(target)), timeZone: ZONE } });
    expect(new Date((await rows(`select starts_at from bookings where id = $1`, [b.id]))[0].starts_at as Date).toISOString()).toBe(iso(Date.parse(target)));
    // Google refuses the next move: the booking keeps the time it has.
    g.fail = 'patch';
    const other = (await post({ action: 'manage', token: fresh.token })).body.slots.find((s: { start: string }) => s.start !== target).start;
    expect(await post({ action: 'move', token: fresh.token, start: other })).toEqual({ status: 502, body: { ok: false, code: 'CALENDAR_FAILED' } });
    expect(new Date((await rows(`select starts_at from bookings where id = $1`, [b.id]))[0].starts_at as Date).toISOString()).toBe(iso(Date.parse(target)));
  });

  test('cancelling with the link: Google first (it tells the guest), then here; too late for the guest, never for the owner', async () => {
    const [b] = await rows(`select id from bookings where guest_email = 'd@d.example'`);
    const t = newToken();
    await db.query(`update bookings set manage_hash = $1 where id = $2`, [t.hash, b.id]);
    g.fail = 'delete';
    expect((await post({ action: 'cancel', token: t.token })).body.code).toBe('CALENDAR_FAILED');
    expect((await rows(`select status from bookings where id = $1`, [b.id]))[0].status).toBe('confirmed');
    g.fail = '';
    expect(await post({ action: 'cancel', token: t.token })).toEqual({ status: 200, body: { ok: true } });
    const del = g.sent.filter((x) => x.method === 'DELETE').at(-1)!;
    expect(del.url).toMatch(/\/events\/ev-\d+\?sendUpdates=all$/);
    expect((await rows(`select status, cancelled_by from bookings where id = $1`, [b.id]))[0]).toEqual({ status: 'cancelled', cancelled_by: 'guest' });
    expect((await post({ action: 'cancel', token: t.token })).body.code).toBe('NOT_ACTIVE');
    // A week's notice required now: the guest is too late, the owner is not.
    await db.query(`update booking_settings set change_hours = 168`);
    const [anna] = await rows(`select id from bookings where guest_email = 'anna@kert.example' and status = 'confirmed'`);
    const t2 = newToken();
    await db.query(`update bookings set manage_hash = $1 where id = $2`, [t2.hash, anna.id]);
    expect((await post({ action: 'manage', token: t2.token })).body.booking.canChange).toBe(false);
    expect((await post({ action: 'cancel', token: t2.token })).body.code).toBe('TOO_LATE');
    expect((await post({ action: 'move', token: t2.token, start: iso(Date.now() + 5 * 864e5) })).body.code).toBe('TOO_LATE');
    expect(await post({ action: 'cancel', id: anna.id }, 'owner-session')).toEqual({ status: 200, body: { ok: true } });
    expect((await rows(`select cancelled_by from bookings where id = $1`, [anna.id]))[0].cancelled_by).toBe('owner');
    await db.query(`update booking_settings set change_hours = 12`);
  });

  test('a client: 30 or 60 minutes, for their own project, as themselves; manages it by id in the portal; nobody else\'s', async () => {
    await asUser(db, U.owner, `select * from client_invite_prepare($1, null, 'Anna', 'anna@a.example', $2::uuid[])`, [ORG.a, [P.a1]])
      .then(([a]) => asUser(db, U.owner, `select client_invite_attach($1, $2)`, [a.account_id, U.a1]));
    await asUser(db, U.owner, `select * from client_invite_prepare($1, null, 'Cili', 'cili@b.example', $2::uuid[])`, [ORG.b, [P.b1]])
      .then(([a]) => asUser(db, U.owner, `select client_invite_attach($1, $2)`, [a.account_id, U.b1]));
    const { body } = await get('?minutes=60', 'anna-session');
    expect(body).toMatchObject({ minutes: 60, options: [30, 60], projects: [{ id: P.a1, name: 'Rapidkert weboldal' }] });
    expect(Date.parse(body.slots[0].end) - Date.parse(body.slots[0].start)).toBe(60 * MIN);
    const start = days(body.slots)[5];
    const made = await post({ action: 'book', start, minutes: 60, topic: 'Tartalom', locale: 'hu', name: 'Spoof', email: 'spoof@x.example' }, 'anna-session');
    expect(made.status).toBe(200);
    expect(made.body.booking.manageUrl).toBeNull();
    const [row] = await rows(`select kind, guest_name, guest_email, project_id, manage_hash, lead_id from bookings where google_event_id = $1`,
      [`ev-${g.events}`]);
    expect(row).toEqual({ kind: 'client', guest_name: 'Anna', guest_email: 'anna@a.example', project_id: P.a1, manage_hash: null, lead_id: null });
    const insert = g.sent.filter((x) => x.method === 'POST' && x.url.includes('/events')).at(-1)!;
    expect(insert.body).toMatchObject({ summary: 'Stratos megbeszélés — Anna', attendees: [{ email: 'anna@a.example', displayName: 'Anna' }] });
    expect(String(insert.body!.description)).toContain('Projekt: Rapidkert weboldal');
    expect((await post({ action: 'book', start, minutes: 60, projectId: P.b1 }, 'anna-session')).body.code).toBe('FORBIDDEN');
    const [mine] = await asUser(db, U.a1, `select booking_id from client_portal_bookings() where status = 'confirmed'`);
    expect((await post({ action: 'cancel', id: mine.booking_id }, 'cili-session')).status).toBe(404);
    expect((await post({ action: 'manage', id: mine.booking_id }, 'anna-session')).body.booking.canChange).toBe(true);
    expect(await post({ action: 'cancel', id: mine.booking_id }, 'anna-session')).toEqual({ status: 200, body: { ok: true } });
    expect((await rows(`select cancelled_by from bookings where id = $1`, [mine.booking_id]))[0].cancelled_by).toBe('client');
    // Staff do not book through it; a dead session is refused.
    expect((await post(guest(start), 'owner-session')).body.code).toBe('STAFF');
    expect((await get('', 'nobody-session')).status).toBe(401);
    expect((await post({ action: 'cancel', id: mine.booking_id })).status).toBe(401);
  });

  test('switched off by the owner: no times, no bookings', async () => {
    await db.query(`update booking_settings set enabled = false`);
    expect((await get()).body.code).toBe('BOOKING_OFF');
    expect((await post(guest(iso(Date.now() + 3 * 864e5), { email: 'z@z.example' }))).body.code).toBe('BOOKING_OFF');
    await db.query(`update booking_settings set enabled = true`);
  });
});

// =============================================================================
// /api/booking — booking a Google Meet call with the owner
// (20261018000100_booking.sql; the pure part is booking-lib.mjs)
//
//   GET  ?minutes=30                     the free times: the working-hours grid
//                                        minus the owner's busy times in Google
//                                        (freeBusy, live) and our own bookings,
//                                        each kept `buffer` minutes clear
//   POST {action:'book', start, …}       books one: re-checks Google, reserves
//                                        it in the database (which refuses any
//                                        overlap), creates the event in the
//                                        owner's calendar with a Meet link and
//                                        sendUpdates=all — the guest gets
//                                        Google's own invitation — then
//                                        confirms it (a public booking becomes
//                                        a lead). If Google refuses, the
//                                        reservation is released.
//   POST {action:'manage', token}        the guest's own booking, and the free
//                                        times it could move to
//   POST {action:'cancel', token | id}   cancels it in Google (Google tells the
//                                        guest), then here
//   POST {action:'move', token | id, start}
//                                        moves it here, then in Google; back if
//                                        Google refuses
//
// Who: a visitor (public booking; managed with the private link's token), a
// signed-in client (Bearer = their Supabase session; booked as themselves,
// for their own project), or an admin (Bearer; cancels or moves any booking).
// The calendar is the PORTAL OWNER's Google account, connected in Settings
// with the freeBusy permission (google-lib.mjs SCOPES).
//
// Configuration: as google-oauth.mjs (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
// GOOGLE_TOKEN_KEY, SUPABASE_URL + public and server key, PORTAL_ORIGIN or URL).
// Nothing personal is logged: codes and statuses only.
// =============================================================================
import { __net, FREEBUSY_SCOPE, accessToken, google, openToken } from './google-lib.mjs';
import {
  MINUTE, bookingEvent, candidateSlots, freeSlots, googleBusy, hashToken, localDay, manageUrl, meetLink, newToken,
  readBooking, tokenShape, without,
} from './booking-lib.mjs';

const env = (k) => (typeof process !== 'undefined' ? process.env[k] : undefined);
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const EVENTS = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const MAX_BODY = 8 * 1024;
const MIN_FILL_MS = 3000;

const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store, max-age=0' },
});

class Refusal extends Error {
  constructor(status, code, extra = {}) { super(code); this.status = status; this.code = code; this.extra = extra; }
}

/* ================================================================ the limit */

// Per instance, like /api/lead: the cheap inner layer under Cloudflare's rule.
const hits = new Map();
const LIMITS = { slots: [40, 60_000], book: [5, 10 * 60_000], manage: [30, 10 * 60_000] };
export function overLimit(kind, key, now = Date.now()) {
  const [max, windowMs] = LIMITS[kind];
  const k = `${kind}:${key}`;
  const seen = (hits.get(k) ?? []).filter((t) => now - t < windowMs);
  seen.push(now);
  hits.set(k, seen);
  if (hits.size > 5000) hits.clear();
  return seen.length > max;
}
export const __resetLimits = () => hits.clear();

/* ============================================================ the database */

/** The database through PostgREST with the server key (tests pass their own `db`). */
export function restDb(c) {
  const server = { apikey: c.serverKey, authorization: `Bearer ${c.serverKey}`, 'content-type': 'application/json' };
  async function call(path, init = {}) {
    const res = await __net.fetch(`${c.supabase}${path}`, init);
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = null; }
    return { ok: res.ok, status: res.status, body };
  }
  const rows = async (path) => {
    const r = await call(path, { headers: server });
    if (!r.ok) throw new Refusal(r.status === 404 ? 503 : 502, r.status === 404 ? 'NOT_INSTALLED' : 'DATABASE');
    return Array.isArray(r.body) ? r.body : [];
  };
  const q = encodeURIComponent;
  return {
    async settings() { return (await rows('/rest/v1/booking_settings?select=*&singleton=eq.true'))[0] ?? null; },
    async owner() { return (await rows('/rest/v1/portal_owner?select=user_id'))[0]?.user_id ?? null; },
    async calendarOf(userId) {
      return (await rows(`/rest/v1/google_accounts?select=user_id,scopes,refresh_token_enc,last_error&user_id=eq.${q(userId)}`))[0] ?? null;
    },
    async taken(fromIso, toIso) {
      return rows(`/rest/v1/bookings?select=id,starts_at,ends_at,buffer_minutes&status=eq.confirmed&starts_at=lt.${q(toIso)}&ends_at=gt.${q(fromIso)}`);
    },
    async booking({ id, hash }) {
      const where = id ? `id=eq.${q(id)}` : `manage_hash=eq.${q(hash)}`;
      return (await rows(`/rest/v1/bookings?select=*&${where}`))[0] ?? null;
    },
    async rpc(fn, args) {
      const r = await call(`/rest/v1/rpc/${fn}`, { method: 'POST', headers: server, body: JSON.stringify(args) });
      return r.ok ? { data: r.body, error: null } : { data: null, error: { code: r.body?.code ?? String(r.status), message: r.body?.message ?? '' } };
    },
    /** The person behind a session token: { admin, client } — or null if the token is not a live session. */
    async identify(token) {
      const asUser = { apikey: c.publicKey, authorization: `Bearer ${token}`, 'content-type': 'application/json' };
      const me = await call('/auth/v1/user', { headers: asUser });
      if (!me.ok || !me.body?.id) return null;
      const admin = await call('/rest/v1/rpc/is_admin', { method: 'POST', headers: asUser, body: '{}' });
      if (admin.ok && admin.body === true) return { admin: true, client: null };
      const client = await call('/rest/v1/rpc/client_booking_identity', { method: 'POST', headers: asUser, body: '{}' });
      return { admin: false, client: client.ok && Array.isArray(client.body) ? client.body[0] ?? null : null };
    },
  };
}

/* ============================================================ the refusals */

const RPC_REFUSALS = {
  booking_taken: [409, 'TAKEN'], booking_day_full: [409, 'TAKEN'], booking_email_open: [409, 'EMAIL_OPEN'],
  booking_too_soon: [409, 'UNAVAILABLE'], booking_too_far: [409, 'UNAVAILABLE'], booking_closed: [409, 'UNAVAILABLE'],
  booking_length: [409, 'UNAVAILABLE'], booking_client_limit: [409, 'CLIENT_LIMIT'], booking_too_late: [409, 'TOO_LATE'],
  booking_missing: [409, 'NOT_ACTIVE'], booking_disabled: [503, 'BOOKING_OFF'], client_no_access: [403, 'FORBIDDEN'],
};

function refusalOf(error) {
  const key = /stratos:([a-z_]+)/.exec(error?.message ?? '')?.[1];
  if (key && RPC_REFUSALS[key]) return new Refusal(...RPC_REFUSALS[key]);
  if (error?.code === 'PGRST202' || error?.code === '42883') return new Refusal(503, 'NOT_INSTALLED');
  console.error('[booking] rpc', error?.code ?? 'unknown');
  return new Refusal(500, 'FAILED');
}

/* =============================================================== the work */

export function makeHandler({ db, origin, creds, now = () => Date.now() }) {
  /** The rules and the owner's calendar; refuses when booking cannot work right now. */
  async function context(calendarUser = null) {
    const s = await db.settings();
    if (!s) throw new Refusal(503, 'NOT_INSTALLED');
    const userId = calendarUser ?? await db.owner();
    const account = userId ? await db.calendarOf(userId) : null;
    if (!account) throw new Refusal(503, 'CALENDAR_NOT_CONNECTED');
    if (account.last_error === 'revoked' || !String(account.scopes ?? '').split(/\s+/).includes(FREEBUSY_SCOPE)) {
      throw new Refusal(503, 'CALENDAR_RECONNECT');
    }
    let token;
    try {
      token = await accessToken({ refreshToken: openToken(account.refresh_token_enc), ...creds });
    } catch (e) {
      throw new Refusal(503, String(e?.message) === 'revoked' ? 'CALENDAR_RECONNECT' : 'CALENDAR_UNREACHABLE');
    }
    return { s, token };
  }

  /** The free starts for `minutes` in [fromMs, toMs]; `ignore` = a booking being moved. */
  async function available({ s, token }, minutes, fromMs, toMs, ignore = null) {
    const slots = candidateSlots(s, minutes, fromMs, toMs);
    if (slots.length === 0) return [];
    const gap = s.buffer_minutes * MINUTE;
    let busy;
    try {
      busy = await googleBusy(google, token, {
        calendars: s.calendar_ids, fromMs: slots[0].start - gap, toMs: slots.at(-1).end + gap, zone: s.time_zone,
      });
    } catch (e) {
      console.error('[booking] google', String(e?.message ?? e).slice(0, 40));
      throw new Refusal(502, 'CALENDAR_UNREACHABLE');
    }
    let taken = await db.taken(new Date(slots[0].start - DAY).toISOString(), new Date(slots.at(-1).end + DAY).toISOString());
    if (ignore) {
      busy = without(busy, ignore.start, ignore.end);
      taken = taken.filter((t) => t.id !== ignore.id);
    }
    const perDay = {};
    for (const t of taken) {
      const day = localDay(Date.parse(t.starts_at), s.time_zone);
      perDay[day] = (perDay[day] ?? 0) + 1;
      busy.push({ start: Date.parse(t.starts_at), end: Date.parse(t.ends_at) });
    }
    return freeSlots(slots, { busy, buffer: s.buffer_minutes, dailyMax: s.daily_max, perDay });
  }

  const window_ = (s) => ({ from: now() + s.notice_hours * HOUR, to: now() + s.horizon_days * DAY });

  /** Is `start` itself a free start? 'UNAVAILABLE' if it is not on the grid at all, 'TAKEN' if it is busy. */
  async function assertFree(ctx, minutes, start, ignore = null) {
    const w = window_(ctx.s);
    const onGrid = start >= w.from && start <= w.to && candidateSlots(ctx.s, minutes, start, start).some((x) => x.start === start);
    if (!onGrid) throw new Refusal(409, 'UNAVAILABLE');
    if (!(await available(ctx, minutes, start, start, ignore)).some((x) => x.start === start)) throw new Refusal(409, 'TAKEN');
  }

  async function rpc(fn, args) {
    const r = await db.rpc(fn, args);
    if (r.error) throw refusalOf(r.error);
    return r.data;
  }

  /** The person behind the Authorization header: null without one; refused if it is not a live session. */
  async function person(req) {
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (!token) return null;
    const who = await db.identify(token);
    if (!who || (!who.admin && !who.client)) throw new Refusal(401, 'UNAUTHENTICATED');
    return who;
  }

  /** The booking a request is about, and who is acting on it: the guest (token), its client, or an admin. */
  async function target(req, body) {
    if (body.token !== undefined) {
      if (!tokenShape(body.token)) throw new Refusal(400, 'TOKEN');
      const b = await db.booking({ hash: hashToken(body.token) });
      if (!b || b.kind !== 'public' || b.status === 'failed') throw new Refusal(404, 'NOT_FOUND');
      return { b, by: 'guest' };
    }
    const who = await person(req);
    if (!who) throw new Refusal(401, 'UNAUTHENTICATED');
    if (typeof body.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.id)) throw new Refusal(400, 'ID');
    const b = await db.booking({ id: body.id });
    if (!b || b.status === 'failed') throw new Refusal(404, 'NOT_FOUND');
    if (who.admin) return { b, by: 'owner' };
    if (b.client_account_id && b.client_account_id === who.client.account_id) return { b, by: 'client' };
    throw new Refusal(404, 'NOT_FOUND');
  }

  const canChange = (b, s, by) => b.status === 'confirmed'
    && (by === 'owner' || Date.parse(b.starts_at) - s.change_hours * HOUR >= now());

  const view = (b, s, by) => ({
    id: b.id, start: new Date(b.starts_at).toISOString(), end: new Date(b.ends_at).toISOString(), timeZone: b.time_zone,
    minutes: Math.round((Date.parse(b.ends_at) - Date.parse(b.starts_at)) / MINUTE), status: b.status,
    meetUrl: b.meet_url ?? null, name: b.guest_name, canChange: canChange(b, s, by),
  });

  const slotList = (slots) => slots.map((x) => ({ start: new Date(x.start).toISOString(), end: new Date(x.end).toISOString() }));

  /* ------------------------------------------------------------ GET slots */
  async function slots(req, url) {
    const who = await person(req);
    const client = !!who?.client;
    const ctx = await context();
    const { s } = ctx;
    if (!s.enabled) throw new Refusal(503, 'BOOKING_OFF');
    const asked = Number.parseInt(url.searchParams.get('minutes') ?? '', 10);
    const options = client ? s.client_minutes.map(Number) : [Number(s.public_minutes)];
    const minutes = options.includes(asked) ? asked : options[0];
    const w = window_(s);
    const free = await available(ctx, minutes, w.from, w.to);
    return json(200, {
      ok: true, timeZone: s.time_zone, minutes, options, changeHours: s.change_hours, slots: slotList(free),
      projects: client ? who.client.projects ?? [] : undefined,
    });
  }

  /* ------------------------------------------------------------ POST book */
  async function book(req, body, ip) {
    const who = await person(req);
    if (who?.admin) throw new Refusal(403, 'STAFF');
    const client = who?.client ?? null;
    if (!client) {
      // The same two gates as /api/lead: a filled hidden field, or a form
      // filled faster than a person can. Answered as if accepted.
      const elapsed = Number(body.elapsedMs);
      if ((typeof body.company_website === 'string' && body.company_website.trim() !== '') || !(elapsed >= MIN_FILL_MS)) {
        console.log('[booking] dropped');
        return json(200, { ok: true, booking: null });
      }
    }
    if (overLimit('book', client ? client.account_id : ip, now())) throw new Refusal(429, 'RATE_LIMITED');
    const read = readBooking(body, { client: !!client });
    if (read.errors) return json(422, { ok: false, code: 'INVALID', fields: read.errors });
    const v = read.value;

    const ctx = await context();
    const { s, token } = ctx;
    if (!s.enabled) throw new Refusal(503, 'BOOKING_OFF');
    const allowed = client ? s.client_minutes.map(Number) : [Number(s.public_minutes)];
    if (!allowed.includes(v.minutes)) throw new Refusal(409, 'UNAVAILABLE');
    const projects = client?.projects ?? [];
    let projectId = null;
    if (client) {
      if (v.projectId && !projects.some((p) => p.id === v.projectId)) throw new Refusal(403, 'FORBIDDEN');
      projectId = v.projectId ?? (projects.length === 1 ? projects[0].id : null);
    }
    const start = Date.parse(v.start);
    const end = start + v.minutes * MINUTE;
    await assertFree(ctx, v.minutes, start);

    const link = client ? null : newToken();
    const id = await rpc('booking_reserve', {
      p_kind: client ? 'client' : 'public', p_starts: new Date(start).toISOString(), p_ends: new Date(end).toISOString(),
      p_name: client ? null : v.name, p_email: client ? null : v.email, p_company: client ? null : v.company || null,
      p_phone: client ? null : v.phone || null, p_topic: v.topic || null, p_locale: v.locale,
      p_manage_hash: link?.hash ?? null, p_account: client?.account_id ?? null, p_project: projectId,
    });
    const b = await db.booking({ id });
    const manage = link ? manageUrl(origin, b.locale, link.token) : null;
    const event = bookingEvent(b, {
      origin, manage, changeHours: s.change_hours, projectName: projects.find((p) => p.id === projectId)?.name ?? null,
    });
    const made = await google(token, `${EVENTS}?conferenceDataVersion=1&sendUpdates=all`, { method: 'POST', body: JSON.stringify(event) });
    if (!made.ok || !made.body?.id) {
      console.error('[booking] calendar', made.status);
      await db.rpc('booking_fail', { p_booking: id, p_error: `calendar ${made.status}` });
      throw new Refusal(502, 'CALENDAR_FAILED');
    }
    const meet = meetLink(made.body);
    const confirmed = await db.rpc('booking_confirm', { p_booking: id, p_event: made.body.id, p_meet_url: meet });
    if (confirmed.error) console.error('[booking] confirm', confirmed.error.code);
    return json(200, {
      ok: true,
      booking: { ...view({ ...b, meet_url: meet }, s, client ? 'client' : 'guest'), email: b.guest_email, manageUrl: manage },
    });
  }

  /* ---------------------------------------------------------- POST manage */
  async function manage(req, body) {
    const { b, by } = await target(req, body);
    const s = await db.settings();
    const out = { ok: true, booking: view(b, s, by), changeHours: s.change_hours, timeZone: s.time_zone, slots: null };
    if (out.booking.canChange) {
      try {
        const ctx = await context(b.calendar_user);
        const w = window_(ctx.s);
        out.slots = slotList(await available(ctx, out.booking.minutes, w.from, w.to,
          { id: b.id, start: Date.parse(b.starts_at), end: Date.parse(b.ends_at) }));
      } catch (e) {
        if (!(e instanceof Refusal)) throw e;
        out.slotsCode = e.code;
      }
    }
    return json(200, out);
  }

  /* ---------------------------------------------------------- POST cancel */
  async function cancel(req, body) {
    const { b, by } = await target(req, body);
    const s = await db.settings();
    if (b.status !== 'confirmed') throw new Refusal(409, 'NOT_ACTIVE');
    if (!canChange(b, s, by)) throw new Refusal(409, 'TOO_LATE');
    if (b.google_event_id) {
      const { token } = await context(b.calendar_user);
      const r = await google(token, `${EVENTS}/${encodeURIComponent(b.google_event_id)}?sendUpdates=all`, { method: 'DELETE' });
      if (!r.ok && r.status !== 404 && r.status !== 410) {
        console.error('[booking] calendar delete', r.status);
        throw new Refusal(502, 'CALENDAR_FAILED');
      }
    }
    await rpc('booking_cancel', { p_booking: b.id, p_by: by });
    return json(200, { ok: true });
  }

  /* ------------------------------------------------------------ POST move */
  async function move(req, body) {
    const { b, by } = await target(req, body);
    const ctx = await context(b.calendar_user);
    if (b.status !== 'confirmed') throw new Refusal(409, 'NOT_ACTIVE');
    if (!canChange(b, ctx.s, by)) throw new Refusal(409, 'TOO_LATE');
    const start = Date.parse(String(body.start ?? ''));
    if (Number.isNaN(start)) throw new Refusal(422, 'INVALID');
    const oldStart = Date.parse(b.starts_at);
    const oldEnd = Date.parse(b.ends_at);
    const minutes = Math.round((oldEnd - oldStart) / MINUTE);
    const end = start + minutes * MINUTE;
    await assertFree(ctx, minutes, start, { id: b.id, start: oldStart, end: oldEnd });
    const moved = await rpc('booking_move', { p_booking: b.id, p_starts: new Date(start).toISOString(), p_ends: new Date(end).toISOString(), p_by: by });
    if (b.google_event_id) {
      const r = await google(ctx.token, `${EVENTS}/${encodeURIComponent(b.google_event_id)}?sendUpdates=all`, {
        method: 'PATCH',
        body: JSON.stringify({ start: { dateTime: new Date(start).toISOString(), timeZone: b.time_zone }, end: { dateTime: new Date(end).toISOString(), timeZone: b.time_zone } }),
      });
      if (!r.ok) {
        console.error('[booking] calendar move', r.status);
        await db.rpc('booking_restore', { p_booking: b.id, p_starts: b.starts_at, p_ends: b.ends_at, p_error: `calendar ${r.status}` });
        throw new Refusal(502, 'CALENDAR_FAILED');
      }
    }
    const row = Array.isArray(moved) ? moved[0] : moved;
    return json(200, { ok: true, booking: view({ ...b, ...(row ?? {}), starts_at: new Date(start).toISOString(), ends_at: new Date(end).toISOString() }, ctx.s, by) });
  }

  return async (req) => {
    const url = new URL(req.url);
    const ip = req.headers.get('x-nf-client-connection-ip') || req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    try {
      if (req.method === 'GET') {
        if (overLimit('slots', ip, now())) throw new Refusal(429, 'RATE_LIMITED');
        return await slots(req, url);
      }
      if (req.method !== 'POST') return json(405, { ok: false, code: 'METHOD' });
      if (!(req.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) return json(415, { ok: false, code: 'CONTENT_TYPE' });
      if (Number(req.headers.get('content-length') || 0) > MAX_BODY) return json(413, { ok: false, code: 'TOO_LARGE' });
      const text = await req.text();
      if (text.length > MAX_BODY) return json(413, { ok: false, code: 'TOO_LARGE' });
      let body;
      try { body = JSON.parse(text); } catch { return json(400, { ok: false, code: 'JSON' }); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return json(400, { ok: false, code: 'JSON' });
      if (body.action === 'book') return await book(req, body, ip);
      if (overLimit('manage', ip, now())) throw new Refusal(429, 'RATE_LIMITED');
      if (body.action === 'manage') return await manage(req, body);
      if (body.action === 'cancel') return await cancel(req, body);
      if (body.action === 'move') return await move(req, body);
      return json(400, { ok: false, code: 'ACTION' });
    } catch (e) {
      if (e instanceof Refusal) return json(e.status, { ok: false, code: e.code, ...e.extra });
      console.error('[booking] failed', String(e?.message ?? e).slice(0, 60));
      return json(500, { ok: false, code: 'FAILED' });
    }
  };
}

export default async (req) => {
  const c = {
    supabase: (env('SUPABASE_URL') || env('VITE_SUPABASE_URL') || '').replace(/\/+$/, ''),
    publicKey: env('SUPABASE_ANON_KEY') || env('VITE_SUPABASE_ANON_KEY'),
    serverKey: env('SUPABASE_SECRET_KEY') || env('SUPABASE_SERVICE_ROLE_KEY'),
  };
  const creds = { clientId: env('GOOGLE_CLIENT_ID'), clientSecret: env('GOOGLE_CLIENT_SECRET') };
  if (!c.supabase || !c.publicKey || !c.serverKey || !creds.clientId || !creds.clientSecret || !env('GOOGLE_TOKEN_KEY')) {
    return json(503, { ok: false, code: 'NOT_CONFIGURED' });
  }
  const origin = (env('PORTAL_ORIGIN') || env('URL') || 'https://stratosweb.hu').replace(/\/+$/, '');
  return makeHandler({ db: restDb(c), origin, creds })(req);
};

export const config = { path: '/api/booking' };

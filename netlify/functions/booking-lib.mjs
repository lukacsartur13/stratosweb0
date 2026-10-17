// =============================================================================
// Booking — the pure part of /api/booking (20261018000100_booking.sql).
// No network, no database: every function here is tested with plain data
// (tests/booking.spec.ts).
//
//   wallClock / zoned     an instant in a zone and back, DST-safe: a wall time
//                         that does not exist (the spring-forward hour) is
//                         refused, a repeated one takes its first occurrence
//   candidateSlots        every start on the working-hours grid in a window
//   freeSlots             minus Google's busy times and our own bookings (both
//                         kept `buffer` minutes clear), minus the full days
//   readBooking           the guest's form, validated and capped
//   bookingEvent          a booking as a Google Calendar event with a Meet
//                         request and the guest invited
//   manageUrl / newToken  the guest's private link (only its hash is stored)
// =============================================================================
import { createHash, randomBytes } from 'node:crypto';

export const MINUTE = 60_000;
const DAY = 86_400_000;
const WD = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
const formats = new Map();

/** The wall clock of `ms` in `zone`: { y, m, d, h, mi, s, wd } (wd: 1 = Monday). */
export function wallClock(ms, zone) {
  let f = formats.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zone, hourCycle: 'h23', weekday: 'short',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    formats.set(zone, f);
  }
  const o = {};
  for (const p of f.formatToParts(new Date(ms))) o[p.type] = p.value;
  return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute, s: +o.second, wd: WD[o.weekday] };
}

const offsetAt = (ms, zone) => {
  const w = wallClock(ms, zone);
  return Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s) - Math.floor(ms / 1000) * 1000;
};

/**
 * The instant at which `zone` reads y-m-d h:mi, or null when it never does
 * (the hour skipped in spring). When it reads it twice (autumn), the first.
 */
export function zoned(y, m, d, h, mi, zone) {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const found = [guess - offsetAt(guess - DAY, zone), guess - offsetAt(guess + DAY, zone)].filter((t) => {
    const w = wallClock(t, zone);
    return w.y === y && w.m === m && w.d === d && w.h === h && w.mi === mi;
  });
  return found.length ? Math.min(...found) : null;
}

/** "09:00" or "09:00:00" → minutes after midnight. */
export const minutesOf = (time) => {
  const [h, mi] = String(time).split(':').map(Number);
  return h * 60 + mi;
};

/** The grid step for a booking of `minutes`: every 15 minutes for 15, else every 30. */
export const stepFor = (minutes) => (minutes === 15 ? 15 : 30);

/**
 * Every possible start in [fromMs, toMs] on the working-hours grid of
 * `settings` (weekdays, day_start, day_end, time_zone), for `minutes`.
 * Returns [{ start, end, day }] — ms, and the local date 'YYYY-MM-DD'.
 */
export function candidateSlots(settings, minutes, fromMs, toMs) {
  const zone = settings.time_zone;
  const days = new Set((settings.weekdays ?? []).map(Number));
  const open = minutesOf(settings.day_start);
  const close = minutesOf(settings.day_end);
  const step = stepFor(minutes);
  const first = wallClock(fromMs, zone);
  const out = [];
  for (let i = 0; ; i += 1) {
    const date = new Date(Date.UTC(first.y, first.m - 1, first.d + i));
    const y = date.getUTCFullYear(); const m = date.getUTCMonth() + 1; const d = date.getUTCDate();
    const noon = zoned(y, m, d, 12, 0, zone);
    if (noon !== null && noon - DAY / 2 > toMs) break;
    if (i > 400) break;
    const wd = ((date.getUTCDay() + 6) % 7) + 1;
    if (!days.has(wd)) continue;
    const day = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    for (let t = open; t + minutes <= close; t += step) {
      const start = zoned(y, m, d, Math.floor(t / 60), t % 60, zone);
      if (start === null || start < fromMs || start > toMs) continue;
      out.push({ start, end: start + minutes * MINUTE, day });
    }
  }
  return out;
}

/**
 * The candidates that are free: `buffer` minutes clear of every busy interval
 * ([{ start, end }] in ms — Google's, and our own confirmed bookings), and not
 * on a day that already has `dailyMax` bookings (`perDay`: { 'YYYY-MM-DD': n }).
 */
export function freeSlots(slots, { busy = [], buffer = 0, dailyMax = Infinity, perDay = {} }) {
  const gap = buffer * MINUTE;
  return slots.filter((s) => (perDay[s.day] ?? 0) < dailyMax
    && busy.every((b) => b.end + gap <= s.start || b.start >= s.end + gap));
}

/** The local date 'YYYY-MM-DD' of `ms` in `zone`. */
export function localDay(ms, zone) {
  const w = wallClock(ms, zone);
  return `${w.y}-${String(w.m).padStart(2, '0')}-${String(w.d).padStart(2, '0')}`;
}

/** Busy intervals minus [start, end): what a booking being moved must not count against itself. */
export function without(busy, start, end) {
  const out = [];
  for (const b of busy) {
    if (b.end <= start || b.start >= end) { out.push(b); continue; }
    if (b.start < start) out.push({ start: b.start, end: start });
    if (b.end > end) out.push({ start: end, end: b.end });
  }
  return out;
}

/* ================================================================ the form */

export const LOCALES = ['hu', 'en', 'de'];
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PHONE_RE = /^[0-9+()./ -]{6,40}$/;
const clean = (v) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim() : '');

/**
 * The guest's answers → { value } or { errors: { field: 'required' | 'invalid' | 'too_long' } }.
 * `client` = a signed-in client: their name and address come from their
 * account, so only the topic and the project are read.
 */
export function readBooking(raw, { client = false } = {}) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const errors = {};
  const value = {
    start: clean(r.start),
    minutes: Number.isInteger(r.minutes) ? r.minutes : Number.parseInt(String(r.minutes ?? ''), 10),
    topic: clean(r.topic),
    locale: LOCALES.includes(r.locale) ? r.locale : 'hu',
  };
  if (!value.start || Number.isNaN(Date.parse(value.start))) errors.start = 'invalid';
  if (!Number.isInteger(value.minutes) || value.minutes < 15 || value.minutes > 240) errors.minutes = 'invalid';
  if (value.topic.length > 1000) errors.topic = 'too_long';
  if (client) {
    value.projectId = typeof r.projectId === 'string' && /^[0-9a-f-]{36}$/i.test(r.projectId) ? r.projectId : null;
    return Object.keys(errors).length ? { errors } : { value };
  }
  value.name = clean(r.name);
  value.email = clean(r.email).toLowerCase();
  value.company = clean(r.company);
  value.phone = clean(r.phone);
  if (!value.name) errors.name = 'required';
  else if (value.name.length > 120) errors.name = 'too_long';
  if (!value.email) errors.email = 'required';
  else if (value.email.length > 254 || !EMAIL_RE.test(value.email)) errors.email = 'invalid';
  if (value.company.length > 160) errors.company = 'too_long';
  if (value.phone && !PHONE_RE.test(value.phone)) errors.phone = 'invalid';
  if (value.topic.length < 3) errors.topic = errors.topic ?? 'required';
  if (r.consent !== true) errors.consent = 'required';
  return Object.keys(errors).length ? { errors } : { value };
}

/* ======================================================== the guest's link */

const PAGE = { hu: '/idopontfoglalas', en: '/en/book-a-call', de: '/de/termin-buchen' };

/** A fresh private token and the hash the database keeps instead of it. */
export function newToken() {
  const token = randomBytes(24).toString('base64url');
  return { token, hash: hashToken(token) };
}
export const hashToken = (token) => createHash('sha256').update(String(token)).digest('hex');
export const tokenShape = (token) => typeof token === 'string' && /^[A-Za-z0-9_-]{32}$/.test(token);

/** The booking page with the token in the fragment — never sent to a server or a log. */
export const manageUrl = (origin, locale, token) => `${origin}${PAGE[locale] ?? PAGE.hu}#m=${token}`;

/* ================================================================ the event */

const COPY = {
  public: ['Stratos konzultáció', 'Stratos consultation', 'Stratos Beratung'],
  client: ['Stratos megbeszélés', 'Stratos meeting', 'Stratos Besprechung'],
  topic: ['Téma', 'Topic', 'Thema'],
  phone: ['Telefon', 'Phone', 'Telefon'],
  project: ['Projekt', 'Project', 'Projekt'],
  manage: [
    'Lemondás vagy áthelyezés (legkésőbb {h} órával előtte): {url}',
    'Cancel or move it (at least {h} hours before): {url}',
    'Absagen oder verschieben (spätestens {h} Stunden vorher): {url}',
  ],
  portal: [
    'Lemondás vagy áthelyezés az ügyfélportálon (legkésőbb {h} órával előtte): {url}',
    'Cancel or move it in the client portal (at least {h} hours before): {url}',
    'Absagen oder verschieben im Kundenportal (spätestens {h} Stunden vorher): {url}',
  ],
};
const L = { hu: 0, en: 1, de: 2 };
const fill = (s, ctx) => s.replace(/\{(\w+)\}/g, (_, k) => String(ctx[k] ?? ''));

/**
 * A booking as a Calendar event in the owner's calendar: the guest invited,
 * a Meet link requested (the booking id makes the request idempotent), the
 * guest's link to cancel or move it in the description.
 */
export function bookingEvent(b, { origin, manage = null, changeHours = 12, projectName = null }) {
  const i = L[b.locale] ?? 0;
  const who = b.guest_company ? `${b.guest_name} (${b.guest_company})` : b.guest_name;
  const lines = [
    b.topic ? `${COPY.topic[i]}: ${b.topic}` : null,
    projectName ? `${COPY.project[i]}: ${projectName}` : null,
    b.guest_phone ? `${COPY.phone[i]}: ${b.guest_phone}` : null,
    b.kind === 'client'
      ? fill(COPY.portal[i], { h: changeHours, url: `${origin}/portal/` })
      : (manage ? fill(COPY.manage[i], { h: changeHours, url: manage }) : null),
  ].filter(Boolean);
  return {
    summary: `${COPY[b.kind === 'client' ? 'client' : 'public'][i]} — ${who}`,
    description: lines.join('\n\n'),
    start: { dateTime: new Date(b.starts_at).toISOString(), timeZone: b.time_zone },
    end: { dateTime: new Date(b.ends_at).toISOString(), timeZone: b.time_zone },
    attendees: [{ email: b.guest_email, displayName: b.guest_name }],
    conferenceData: { createRequest: { requestId: `booking-${b.id}`, conferenceSolutionKey: { type: 'hangoutsMeet' } } },
    reminders: { useDefault: true },
    source: { title: 'Stratos', url: `${origin}/` },
    extendedProperties: { private: { stratosBooking: String(b.id) } },
  };
}

/** Google's Meet link, if it is one. */
export const meetLink = (event) => {
  const url = event?.hangoutLink ?? event?.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video')?.uri ?? null;
  return typeof url === 'string' && /^https:\/\/meet\.google\.com\/[A-Za-z0-9-]+$/.test(url) ? url : null;
};

/* ============================================================== free / busy */

/** Google's freeBusy over a window, in chunks of at most 60 days; throws on any calendar error. */
export async function googleBusy(fetchJson, token, { calendars, fromMs, toMs, zone }) {
  const busy = [];
  for (let a = fromMs; a < toMs; a += 60 * DAY) {
    const b = Math.min(toMs, a + 60 * DAY);
    const r = await fetchJson(token, 'https://www.googleapis.com/calendar/v3/freeBusy', {
      method: 'POST',
      body: JSON.stringify({ timeMin: new Date(a).toISOString(), timeMax: new Date(b).toISOString(), timeZone: zone, items: calendars.map((id) => ({ id })) }),
    });
    if (!r.ok) throw new Error(`freebusy ${r.status}`);
    for (const id of calendars) {
      // Keyed by the id asked for; with one calendar, whatever key Google used.
      const c = r.body?.calendars?.[id] ?? (calendars.length === 1 ? Object.values(r.body?.calendars ?? {})[0] : undefined);
      if (!c || (c.errors ?? []).length > 0) throw new Error('freebusy calendar');
      for (const x of c.busy ?? []) busy.push({ start: Date.parse(x.start), end: Date.parse(x.end) });
    }
  }
  return busy;
}

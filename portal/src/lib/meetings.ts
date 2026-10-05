// =============================================================================
// Meetings and demo links — the pure rules (no imports but `./i18n`), shared by the owner's
// panel and the client portal, and tested in tests/portal-client-extras.spec.ts.
//
// Instants are stored as timestamptz (UTC) together with the IANA zone the
// owner chose. The zone decides how a wall-clock time the owner types is read,
// and how the time is shown; the instant itself never changes meaning, so
// daylight-saving time cannot shift a meeting.
// =============================================================================

import { intlLocale } from './i18n.ts';

export interface MeetingLike {
  starts_at: string;
  ends_at: string;
  time_zone: string;
  cancelled: boolean;
}

/** The database's rule (portal_safe_https_url), said in TypeScript. */
export function isSafeHttpsUrl(raw: string): boolean {
  // Exactly the database's rule: no trimming here (the forms trim before they
  // check and save), so a value this accepts is a value the database accepts.
  const url = raw;
  if (url.length === 0 || url.length > 2000) return false;
  return /^https:\/\/[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+(:[0-9]{1,5})?([/?#][^\s\p{Cc}]*)?$/u.test(url);
}

/**
 * The href for a stored demo or join link: the value itself when it passes the
 * rule above, otherwise nothing (the anchor stays inert). The database already
 * refuses anything else; this is the second lock, at the point of use.
 */
export function safeHttpsUrl(raw: string | null | undefined): string | undefined {
  return raw && isSafeHttpsUrl(raw) ? raw : undefined;
}

/** Offset of `zone` from UTC, in minutes, at the given instant. */
function offsetMinutes(zone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - at.getTime()) / 60000);
}

export function isValidTimeZone(zone: string): boolean {
  try { new Intl.DateTimeFormat('en-US', { timeZone: zone }); return true; } catch { return false; }
}

/**
 * A wall-clock date and time in `zone` → the UTC instant.
 *
 *   * a time that does not exist (the hour skipped when clocks go forward) is
 *     refused, never silently moved;
 *   * a time that exists twice (the hour repeated when clocks go back) is
 *     read as the FIRST occurrence (summer time) and flagged `ambiguous`.
 */
export function zonedToUtc(date: string, time: string, zone: string):
  { iso: string; ambiguous: boolean } | { error: 'invalid' | 'nonexistent' } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  if (!m || !t || !isValidTimeZone(zone)) return { error: 'invalid' };
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +t[1], +t[2]);
  // The two offsets that can apply around this wall time.
  const candidates = [...new Set([offsetMinutes(zone, new Date(wall - 36e5 * 12)), offsetMinutes(zone, new Date(wall + 36e5 * 12))])]
    .map((off) => wall - off * 60000)
    .filter((instant) => wallClock(zone, new Date(instant)) === `${m[1]}-${m[2]}-${m[3]}T${t[1]}:${t[2]}`)
    .sort((a, b) => a - b);
  if (candidates.length === 0) return { error: 'nonexistent' };
  return { iso: new Date(candidates[0]).toISOString(), ambiguous: candidates.length > 1 };
}

/** YYYY-MM-DDTHH:MM of an instant, as a clock in `zone` shows it. */
export function wallClock(zone: string, at: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

/** "2026. október 25., vasárnap 10:00–11:00" in the meeting's own zone. */
export function formatMeetingTime(m: Pick<MeetingLike, 'starts_at' | 'ends_at' | 'time_zone'>): string {
  const start = new Date(m.starts_at);
  const end = new Date(m.ends_at);
  const day = new Intl.DateTimeFormat(intlLocale('hu-HU'), { timeZone: m.time_zone, year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }).format(start);
  const hm = (d: Date) => new Intl.DateTimeFormat(intlLocale('hu-HU'), { timeZone: m.time_zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
  const sameDay = wallClock(m.time_zone, start).slice(0, 10) === wallClock(m.time_zone, end).slice(0, 10);
  const endText = sameDay ? hm(end) : `${new Intl.DateTimeFormat(intlLocale('hu-HU'), { timeZone: m.time_zone, month: 'long', day: 'numeric' }).format(end)} ${hm(end)}`;
  const zoneNote = m.time_zone === 'Europe/Budapest' ? '' : ` (${m.time_zone})`;
  return `${day} ${hm(start)}–${endText}${zoneNote}`;
}

/**
 * The meeting to highlight: the earliest one that is not cancelled and has not
 * ended. A meeting in progress is still "next" (`inProgress`); an ended one
 * never is.
 */
export function nextMeeting<T extends MeetingLike>(meetings: T[], now = new Date()): { meeting: T; inProgress: boolean } | null {
  const live = meetings
    .filter((m) => !m.cancelled && new Date(m.ends_at).getTime() > now.getTime())
    .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
  if (live.length === 0) return null;
  return { meeting: live[0], inProgress: new Date(live[0].starts_at).getTime() <= now.getTime() };
}

const utcStamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

/**
 * Google Calendar's "create event" link, pre-filled:
 *
 *   https://calendar.google.com/calendar/render?action=TEMPLATE
 *     &text=…&dates=YYYYMMDDTHHMMSSZ/YYYYMMDDTHHMMSSZ&details=…&location=…&ctz=…
 *
 * The documented template parameters (action, text, dates, details, location,
 * ctz). `dates` is given in UTC (the trailing Z), so no daylight-saving rule
 * of any zone can shift it; `ctz` only chooses the zone Google shows it in.
 * Every value goes through encodeURIComponent — accents, &, #, ? and line
 * breaks included. Opens Google's own page; nothing is sent to Google by us.
 */
export function googleCalendarUrl(m: {
  title: string; starts_at: string; ends_at: string; time_zone: string;
  join_url: string | null; location: string | null; note: string | null; project_name?: string;
}): string {
  const details = [
    m.note?.trim() || null,
    m.join_url ? `Csatlakozás: ${m.join_url}` : null,
    m.project_name ? `Projekt: ${m.project_name}` : null,
  ].filter(Boolean).join('\n\n');
  const params: [string, string][] = [
    ['action', 'TEMPLATE'],
    ['text', m.title],
    ['dates', `${utcStamp(m.starts_at)}/${utcStamp(m.ends_at)}`],
    ['details', details],
    ['location', m.location?.trim() || m.join_url || ''],
    ['ctz', m.time_zone],
  ];
  return `https://calendar.google.com/calendar/render?${params
    .filter(([, v]) => v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&')}`;
}

/** The zones offered in the owner's form: Budapest first, then every zone the browser knows. */
export function timeZoneOptions(): string[] {
  const all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
  return ['Europe/Budapest', ...all.filter((z) => z !== 'Europe/Budapest')];
}

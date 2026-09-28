import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {
  formatMeetingTime, googleCalendarUrl, isSafeHttpsUrl, nextMeeting, safeHttpsUrl, wallClock, zonedToUtc,
} from '../portal/src/lib/meetings';
import { buildIndex, normalise, reply, stem, tokens } from '../portal/src/lib/helpMatcher';

/**
 * Phase 7 — the pure rules (meetings, calendar links, URL check, the help
 * matcher) and the structural contracts. The database half is
 * tests/portal-client-extras-db.spec.ts.
 */

const src = (...p: string[]) => fs.readFileSync(path.join(process.cwd(), 'portal', 'src', ...p), 'utf8');

test.describe('wall-clock time in a zone → the instant', () => {
  test('summer and winter time in Budapest', () => {
    expect(zonedToUtc('2026-07-15', '10:00', 'Europe/Budapest')).toEqual({ iso: '2026-07-15T08:00:00.000Z', ambiguous: false });
    expect(zonedToUtc('2026-12-15', '10:00', 'Europe/Budapest')).toEqual({ iso: '2026-12-15T09:00:00.000Z', ambiguous: false });
  });

  test('the hour skipped when summer time starts (2026-03-29 02:30) is refused, not moved', () => {
    expect(zonedToUtc('2026-03-29', '02:30', 'Europe/Budapest')).toEqual({ error: 'nonexistent' });
    expect(zonedToUtc('2026-03-29', '01:59', 'Europe/Budapest')).toEqual({ iso: '2026-03-29T00:59:00.000Z', ambiguous: false });
    expect(zonedToUtc('2026-03-29', '03:00', 'Europe/Budapest')).toEqual({ iso: '2026-03-29T01:00:00.000Z', ambiguous: false });
  });

  test('the hour repeated when summer time ends (2026-10-25 02:30) is the first occurrence, flagged', () => {
    expect(zonedToUtc('2026-10-25', '02:30', 'Europe/Budapest')).toEqual({ iso: '2026-10-25T00:30:00.000Z', ambiguous: true });
    expect(zonedToUtc('2026-10-25', '03:30', 'Europe/Budapest')).toEqual({ iso: '2026-10-25T02:30:00.000Z', ambiguous: false });
  });

  test('another zone with its own DST date (New York, 2026-03-08)', () => {
    expect(zonedToUtc('2026-03-08', '02:30', 'America/New_York')).toEqual({ error: 'nonexistent' });
    expect(zonedToUtc('2026-03-09', '09:00', 'America/New_York')).toEqual({ iso: '2026-03-09T13:00:00.000Z', ambiguous: false });
    expect(zonedToUtc('2026-03-09', '09:00', 'Mars/Olympus')).toEqual({ error: 'invalid' });
  });

  test('round trip: the wall clock of the stored instant is what was typed', () => {
    for (const [d, t] of [['2026-10-24', '23:30'], ['2026-10-25', '04:00'], ['2026-03-28', '12:00'], ['2026-03-30', '00:15']]) {
      const r = zonedToUtc(d, t, 'Europe/Budapest');
      if ('error' in r) throw new Error(`${d} ${t}`);
      expect(wallClock('Europe/Budapest', new Date(r.iso))).toBe(`${d}T${t}`);
    }
  });

  test('the client sees the time in the meeting\'s own zone, in Hungarian', () => {
    const text = formatMeetingTime({ starts_at: '2026-10-25T08:00:00Z', ends_at: '2026-10-25T09:00:00Z', time_zone: 'Europe/Budapest' });
    expect(text).toContain('2026. október 25.');
    expect(text).toContain('09:00–10:00'); // CET after the change: UTC+1
    expect(formatMeetingTime({ starts_at: '2026-07-01T08:00:00Z', ends_at: '2026-07-01T09:00:00Z', time_zone: 'America/New_York' })).toContain('(America/New_York)');
  });
});

test.describe('which meeting is "next"', () => {
  const at = (h: number) => new Date(Date.UTC(2026, 9, 1, h)).toISOString();
  const now = new Date(Date.UTC(2026, 9, 1, 12));
  const m = (id: string, s: number, e: number, cancelled = false) => ({ id, starts_at: at(s), ends_at: at(e), time_zone: 'Europe/Budapest', cancelled });

  test('the earliest not cancelled and not ended; cancelled and past ones never', () => {
    const list = [m('past', 8, 9), m('cancelled', 13, 14, true), m('later', 16, 17), m('soon', 14, 15)];
    expect(nextMeeting(list, now)?.meeting.id).toBe('soon');
    expect(nextMeeting([m('past', 8, 9), m('cancelled', 13, 14, true)], now)).toBeNull();
  });

  test('a meeting in progress is still highlighted, as in progress', () => {
    expect(nextMeeting([m('now', 11, 13), m('later', 16, 17)], now)).toMatchObject({ meeting: { id: 'now' }, inProgress: true });
  });
});

test.describe('the Google Calendar link', () => {
  const meeting = {
    title: 'Egyeztetés: árajánlat & „demó” #2?', starts_at: '2026-10-25T00:30:00.000Z', ends_at: '2026-10-25T01:30:00.000Z',
    time_zone: 'Europe/Budapest', join_url: 'https://meet.example.com/abc?x=1&y=2', location: null,
    note: 'Első sor – ékezetek: őű\nMásodik sor 100% / + jel', project_name: 'Webshop',
  };

  test('Google\'s template URL, every value encoded and recoverable exactly', () => {
    const url = new URL(googleCalendarUrl(meeting));
    expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render');
    expect(url.searchParams.get('action')).toBe('TEMPLATE');
    expect(url.searchParams.get('text')).toBe(meeting.title);
    expect(url.searchParams.get('dates')).toBe('20261025T003000Z/20261025T013000Z');
    expect(url.searchParams.get('details')).toBe(`${meeting.note}\n\nCsatlakozás: ${meeting.join_url}\n\nProjekt: Webshop`);
    expect(url.searchParams.get('location')).toBe(meeting.join_url);
    expect(url.searchParams.get('ctz')).toBe('Europe/Budapest');
    // No raw special character reaches the query string.
    expect(googleCalendarUrl(meeting).split('?')[1]).not.toMatch(/[ „”őű#\n]/);
  });

  test('a place wins as location; the join link stays in the details', () => {
    const url = new URL(googleCalendarUrl({ ...meeting, location: 'Budapest, Váci út 1.' }));
    expect(url.searchParams.get('location')).toBe('Budapest, Váci út 1.');
    expect(url.searchParams.get('details')).toContain('Csatlakozás: https://meet.example.com/abc?x=1&y=2');
  });

  test('UTC dates around both DST changes are exact', () => {
    const r = zonedToUtc('2026-03-29', '03:30', 'Europe/Budapest');
    if ('error' in r) throw new Error('unexpected');
    const url = new URL(googleCalendarUrl({ ...meeting, starts_at: r.iso, ends_at: new Date(new Date(r.iso).getTime() + 3600e3).toISOString() }));
    expect(url.searchParams.get('dates')).toBe('20260329T013000Z/20260329T023000Z');
  });
});

test.describe('the URL rule', () => {
  test('https only, a real host, nothing hidden', () => {
    for (const ok of ['https://demo.example.com', 'https://x.hu/a?b=c#d', 'https://a-b.c.hu:8443/']) expect(isSafeHttpsUrl(ok), ok).toBe(true);
    for (const bad of ['http://x.hu', 'javascript:alert(1)', 'https://u:p@x.hu', 'https://x .hu', 'https://x.hu/\t', 'https://x', 'vbscript:x', 'https://x.hu/\u0007'])
      expect(isSafeHttpsUrl(bad), bad).toBe(false);
  });

  test('the href helper passes a safe link through unchanged and drops anything else', () => {
    expect(safeHttpsUrl('https://demo.example.com/a?b=1')).toBe('https://demo.example.com/a?b=1');
    for (const bad of ['javascript:alert(1)', 'http://x.hu', 'data:text/html,x', '', null, undefined]) expect(safeHttpsUrl(bad)).toBeUndefined();
  });
});

test.describe('the help matcher', () => {
  const art = (id: string, topic: string, question: string, alt: string[] = [], answer = 'Válasz.') =>
    ({ article_id: id, topic, question, alt_questions: alt, answer });
  const idx = buildIndex([
    art('1', 'Feltöltés', 'Hol adhatom le a képeket és a logót?', ['hova töltsem fel a fájlokat']),
    art('2', 'Feltöltés', 'Milyen fájlokat tölthetek fel?', ['mekkora lehet a fájl']),
    art('3', 'Megbeszélés', 'Hol látom a következő megbeszélést?', ['mikor lesz a találkozó']),
    art('4', 'Megbeszélés', 'Hogyan tehetem be a naptáramba?', ['google naptár']),
  ]);

  test('normalising and stemming Hungarian', () => {
    expect(normalise('Árvíztűrő TÜKÖRFÚRÓGÉP!')).toBe('arvizturo tukorfurogep');
    expect(stem('fajlokat')).toBe('fajl');
    expect(tokens('Hol találom a naptáramban?')).toEqual(['talal', 'naptar']);
  });

  test('exact, rephrased, ambiguous, unknown', () => {
    expect(reply(idx, 'Milyen fájlokat tölthetek fel?')).toMatchObject({ kind: 'answer', article: { article_id: '2' } });
    expect(reply(idx, 'mikor lesz a következő találkozónk?')).toMatchObject({ kind: 'answer', article: { article_id: '3' } });
    expect(reply(idx, 'Google naptár')).toMatchObject({ kind: 'answer', article: { article_id: '4' } });
    expect(reply(idx, 'feltöltés').kind).toBe('clarify');
    expect(reply(idx, 'mennyibe kerül a pizza')).toMatchObject({ kind: 'unknown' });
    expect(reply(idx, '???').kind).toBe('unknown');
  });
});

test.describe('structural contracts', () => {
  test('the client portal reads only client_* functions — including the new ones', () => {
    const code = src('features', 'client', 'ClientApp.tsx') + src('features', 'client', 'HelpChat.tsx');
    expect(code).not.toMatch(/\.from\(\s*'/);
    const view = src('lib', 'clientView.ts');
    for (const fn of ['client_portal_demos', 'client_portal_meetings', 'client_help_articles']) expect(view).toContain(`useRpc<`);
    expect(view).toMatch(/useRpc<ClientDemo>\('client_portal_demos'/);
    expect(view).toMatch(/useRpc<ClientMeeting>\('client_portal_meetings'/);
    expect(view).toMatch(/useRpc<HelpArticle>\('client_help_articles'/);
  });

  test('a demo opens in a new tab, never embedded; nothing fetches the demo URL', () => {
    const files = [src('features', 'client', 'ClientApp.tsx'), src('features', 'client-view', 'ClientViewPanel.tsx')];
    for (const f of files) {
      expect(f).not.toMatch(/<iframe|<object|<embed/i);
      expect(f).not.toMatch(/fetch\(/);
      for (const a of f.matchAll(/<a\s[^>]*target="_blank"[^>]*>/g)) expect(a[0]).toContain('rel="noopener noreferrer"');
    }
    expect(src('lib', 'meetings.ts')).not.toMatch(/fetch\(|XMLHttpRequest/);
  });

  test('the assistant stores nothing and sends nothing', () => {
    const code = src('features', 'client', 'HelpChat.tsx') + src('lib', 'helpMatcher.ts');
    expect(code).not.toMatch(/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest|supabase|sendBeacon/);
    expect(src('features', 'client', 'HelpChat.tsx')).not.toMatch(/továbbítottam|továbbítottuk|elküldtem|elküldtük|megkapta a kollégánk/i);
  });

  test('the owner is told the demo site itself is public', () => {
    expect(src('features', 'client-view', 'ClientViewPanel.tsx')).toMatch(/anyone who has its\s+address can open it/);
  });
});

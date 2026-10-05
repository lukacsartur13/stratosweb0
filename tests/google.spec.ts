import { test, expect } from '@playwright/test';
// @ts-expect-error — plain .mjs Netlify function modules
import { __net, eventBody, openToken, parseAddresses, readState, sealToken, signState, consentUrl } from '../netlify/functions/google-lib.mjs';
// @ts-expect-error — plain .mjs Netlify function modules
import { syncCalendar, syncGmail } from '../netlify/functions/google-sync.mjs';
// @ts-expect-error — plain .mjs Netlify function modules
import oauth from '../netlify/functions/google-oauth.mjs';

/**
 * Google (netlify/functions/google-*.mjs): the sealed token, the signed state,
 * the address parsing, the calendar event, one calendar push and one Gmail
 * look with a fake Google and a fake database, and the OAuth endpoint's
 * refusals. The database side is tests/portal-google-db.spec.ts.
 */

process.env.GOOGLE_TOKEN_KEY = Buffer.alloc(32, 7).toString('base64');

test('the refresh token is sealed: it opens with the key, and a changed byte is refused', () => {
  const sealed = sealToken('1//refresh-token');
  expect(sealed).toMatch(/^v1\./);
  expect(sealed).not.toContain('refresh');
  expect(openToken(sealed)).toBe('1//refresh-token');
  const parts = sealed.split('.');
  parts[3] = `${parts[3].slice(0, -2)}AA`;
  expect(() => openToken(parts.join('.'))).toThrow();
});

test('the OAuth state names its user, expires after 10 minutes, and cannot be forged', () => {
  const now = Date.now();
  const s = signState('u-1', now);
  expect(readState(s, now + 60_000)).toBe('u-1');
  expect(readState(s, now + 11 * 60_000)).toBeNull();
  const [data] = s.split('.');
  const forged = `${Buffer.from(JSON.stringify({ u: 'u-2', e: now + 60_000, n: 'x' })).toString('base64url')}.${s.split('.')[1]}`;
  expect(readState(forged, now)).toBeNull();
  expect(readState(`${data}.`, now)).toBeNull();
  const url = new URL(consentUrl({ clientId: 'cid', origin: 'https://stratosweb.hu', state: s, loginHint: 'a@b.hu' }));
  expect(url.searchParams.get('redirect_uri')).toBe('https://stratosweb.hu/api/google-oauth');
  expect(url.searchParams.get('access_type')).toBe('offline');
  expect(url.searchParams.get('scope')).toContain('gmail.readonly');
  expect(url.searchParams.get('scope')).toContain('calendar.events');
});

test('addresses: names, quotes with commas, bare addresses; lower-cased', () => {
  expect(parseAddresses('"Kovács, Anna" <Anna@Kert.HU>, bela@b.hu, Cili <cili@c.hu>')).toEqual([
    { email: 'anna@kert.hu', name: 'Kovács, Anna' }, { email: 'bela@b.hu', name: null }, { email: 'cili@c.hu', name: 'Cili' },
  ]);
  expect(parseAddresses('')).toEqual([]);
});

test('a meeting as an event: time in its zone, the project in the title, a Meet request only when asked and there is no link', () => {
  const m = { meeting_id: 'm1', title: 'Egyeztetés', project_name: 'Rapidkert weboldal', starts_at: '2026-10-07T08:00:00Z', ends_at: '2026-10-07T09:00:00Z',
    time_zone: 'Europe/Budapest', join_url: null, location: 'Iroda', note: 'Hozd a logót.', invite: ['anna@a.example'], want_meet: true, dirty_at: '2026-10-05T10:00:00Z' };
  const e = eventBody(m, { origin: 'https://stratosweb.hu' });
  expect(e.summary).toBe('Egyeztetés — Rapidkert weboldal');
  expect(e.start).toEqual({ dateTime: '2026-10-07T08:00:00.000Z', timeZone: 'Europe/Budapest' });
  expect(e.attendees).toEqual([{ email: 'anna@a.example' }]);
  expect(e.conferenceData.createRequest.conferenceSolutionKey.type).toBe('hangoutsMeet');
  expect(eventBody({ ...m, join_url: 'https://meet.example.com/x' }, { origin: 'x' }).conferenceData).toBeUndefined();
});

function fakeDb(rpcAnswers: Record<string, unknown>) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const updates: unknown[] = [];
  return {
    calls, updates,
    rpc: async (fn: string, args: Record<string, unknown> = {}) => { calls.push({ fn, args }); return { data: typeof rpcAnswers[fn] === 'function' ? (rpcAnswers[fn] as (a: unknown) => unknown)(args) : rpcAnswers[fn] ?? null, error: null }; },
    from: () => ({ update: (v: unknown) => ({ eq: async () => { updates.push(v); return { error: null }; } }) }),
  };
}

test('calendar: a new meeting is created with a Meet link that comes back; a cancelled one is deleted; an error is recorded', async () => {
  const sent: { method: string; url: string; body: unknown }[] = [];
  const original = __net.fetch;
  __net.fetch = async (url: string, init: { method?: string; body?: string }) => {
    sent.push({ method: init.method ?? 'GET', url, body: init.body ? JSON.parse(init.body) : null });
    if (url.includes('ev-broken')) return new Response('{}', { status: 403 });
    if (init.method === 'DELETE') return new Response(null, { status: 204 });
    return new Response(JSON.stringify({ id: 'ev-new', hangoutLink: 'https://meet.google.com/abc' }), { status: 200 });
  };
  try {
    const base = { title: 'T', project_name: 'P', starts_at: '2026-10-07T08:00:00Z', ends_at: '2026-10-07T09:00:00Z', time_zone: 'Europe/Budapest',
      join_url: null, location: null, note: null, want_sync: true, invite: [], calendar_user: 'u-1', dirty_at: '2026-10-05T10:00:00Z' };
    const db = fakeDb({ google_sync_targets: [
      { ...base, meeting_id: 'm-new', event_id: null, cancelled: false, want_meet: true },
      { ...base, meeting_id: 'm-gone', event_id: 'ev-old', cancelled: true, want_meet: false },
      { ...base, meeting_id: 'm-bad', event_id: 'ev-broken', cancelled: false, want_meet: false },
      { ...base, meeting_id: 'm-nobody', event_id: null, cancelled: false, want_meet: false, calendar_user: null },
    ] });
    const r = await syncCalendar(db, { tokenFor: async () => 'tok', origin: 'https://stratosweb.hu' });
    expect(r.pushed).toBe(2);
    expect(sent.map((s) => `${s.method} ${s.url.replace('https://www.googleapis.com/calendar/v3/calendars/primary/events', '')}`)).toEqual([
      'POST ?conferenceDataVersion=1&sendUpdates=none', 'DELETE /ev-old?sendUpdates=none', 'PATCH /ev-broken?conferenceDataVersion=1&sendUpdates=none',
    ]);
    const marks = db.calls.filter((c) => c.fn === 'google_mark_synced').map((c) => [c.args.p_meeting, c.args.p_event, c.args.p_meet_url, c.args.p_error]);
    expect(marks).toEqual([['m-new', 'ev-new', 'https://meet.google.com/abc', null], ['m-gone', null, null, null], ['m-bad', null, null, 'calendar 403']]);
  } finally {
    __net.fetch = original;
  }
});

test('gmail: only messages with a known address are stored, matched to the lead/client/deal, in or out', async () => {
  const original = __net.fetch;
  const msgs: Record<string, unknown> = {
    a: { id: 'a', threadId: 't', internalDate: '1759600000000', snippet: 'Szia!', payload: { headers: [
      { name: 'From', value: 'Anna <anna@kert.example>' }, { name: 'To', value: 'owner@media-stratos.example' }, { name: 'Subject', value: 'Kérdés' }] } },
    b: { id: 'b', threadId: 't', internalDate: '1759600100000', snippet: 'Küldöm', payload: { headers: [
      { name: 'From', value: 'Owner <owner@media-stratos.example>' }, { name: 'To', value: 'anna@kert.example' }, { name: 'Cc', value: 'cili@b.example' }, { name: 'Subject', value: 'Re: Kérdés' }] } },
    c: { id: 'c', threadId: 'x', internalDate: '1759600200000', snippet: 'Hírlevél', payload: { headers: [
      { name: 'From', value: 'news@shop.example' }, { name: 'To', value: 'owner@media-stratos.example' }, { name: 'Subject', value: 'Akció' }] } },
  };
  __net.fetch = async (url: string) => {
    if (url.includes('/messages?')) return new Response(JSON.stringify({ messages: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }), { status: 200 });
    const id = url.split('/messages/')[1].split('?')[0];
    return new Response(JSON.stringify(msgs[id]), { status: 200 });
  };
  try {
    const db = fakeDb({ email_store: () => true });
    const known = new Map([
      ['anna@kert.example', [{ email: 'anna@kert.example', lead_id: 'l-1', organization_id: null, opportunity_id: null }]],
      ['cili@b.example', [{ email: 'cili@b.example', lead_id: null, organization_id: 'o-1', opportunity_id: 'd-1' }]],
    ]);
    const r = await syncGmail(db, { user_id: 'u-1', google_email: 'owner@media-stratos.example', gmail_synced_at: null },
      { tokenFor: async () => 'tok', known, now: 1759600300000 });
    expect(r.stored).toBe(2);
    const stored = db.calls.filter((c) => c.fn === 'email_store').map((c) => c.args);
    expect(stored.map((s) => [s.p_gmail_id, s.p_direction, s.p_lead, s.p_org, s.p_deal])).toEqual([
      ['a', 'in', 'l-1', null, null], ['b', 'out', 'l-1', 'o-1', 'd-1'],
    ]);
    expect(stored[1].p_to).toEqual(['anna@kert.example', 'cili@b.example']);
    expect(db.updates).toEqual([expect.objectContaining({ last_error: null })]);
  } finally {
    __net.fetch = original;
  }
});

test('the OAuth endpoint: a bad or expired state is sent back to Settings with a reason; start needs a signed-in admin', async () => {
  Object.assign(process.env, { SUPABASE_URL: 'https://db.example', SUPABASE_ANON_KEY: 'pub', SUPABASE_SECRET_KEY: 'srv',
    GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'csec', PORTAL_ORIGIN: 'https://stratosweb.hu' });
  const original = __net.fetch;
  __net.fetch = async (url: string, init: { headers?: Record<string, string> }) => {
    if (url.endsWith('/auth/v1/user')) return init.headers?.authorization === 'Bearer good' ? new Response(JSON.stringify({ id: 'u-1', email: 'a@b.hu' })) : new Response('{}', { status: 401 });
    if (url.endsWith('/rpc/is_admin')) return new Response('true');
    return new Response('{}', { status: 500 });
  };
  try {
    const bad = await oauth(new Request('https://stratosweb.hu/api/google-oauth?code=x&state=forged.sig'));
    expect(bad.status).toBe(302);
    expect(bad.headers.get('location')).toBe('https://stratosweb.hu/portal/settings?google=error&reason=expired');
    const declined = await oauth(new Request('https://stratosweb.hu/api/google-oauth?error=access_denied'));
    expect(declined.headers.get('location')).toContain('reason=declined');
    const anon = await oauth(new Request('https://stratosweb.hu/api/google-oauth', { method: 'POST', body: '{"action":"start"}' }));
    expect(anon.status).toBe(403);
    const ok = await oauth(new Request('https://stratosweb.hu/api/google-oauth', { method: 'POST', headers: { authorization: 'Bearer good' }, body: '{"action":"start"}' }));
    const { url } = await ok.json();
    expect(readState(new URL(url).searchParams.get('state'))).toBe('u-1');
  } finally {
    __net.fetch = original;
  }
});

// =============================================================================
// Every two minutes: the Google side of the Portal (20261017000100_google.sql)
//
//   calendar  every meeting changed since its last sync (google_sync_targets())
//             is created, updated or removed in the Google Calendar of the
//             person it belongs to; a Meet link Google makes is written back
//             into the meeting; the result goes through google_mark_synced().
//   gmail     at most every 10 minutes per connected account: the messages
//             since the last look (the first time: 90 days) whose From/To/Cc
//             contains a known address (email_known_addresses()) are stored
//             with email_store() — subject, addresses, date, snippet. Nothing
//             else of a message is read: format=metadata.
//
// A revoked grant is recorded on the account ("reconnect in Settings") and the
// account is skipped until it is reconnected. Nothing personal is logged.
// =============================================================================
import { createClient } from '@supabase/supabase-js';
import { __net, accessToken, eventBody, openToken, parseAddresses } from './google-lib.mjs';

const env = (k) => (typeof process !== 'undefined' ? process.env[k] : undefined);
const GMAIL_EVERY_MS = 10 * 60_000;
const FIRST_LOOK_DAYS = 90;

async function google(token, url, init = {}) {
  const res = await __net.fetch(url, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers ?? {}) } });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  return { ok: res.ok, status: res.status, body };
}

/** One access token per account per run; a revoked grant is written on the account. */
function tokens(db, accounts, creds) {
  const cache = new Map();
  return async (userId) => {
    if (cache.has(userId)) return cache.get(userId);
    const a = accounts.find((x) => x.user_id === userId);
    let token = null;
    if (a && !a.revoked) {
      try {
        token = await accessToken({ refreshToken: openToken(a.refresh_token_enc), ...creds });
      } catch (e) {
        const revoked = String(e?.message) === 'revoked';
        a.revoked = revoked;
        await db.from('google_accounts').update({ last_error: revoked ? 'revoked' : 'token' }).eq('user_id', userId);
        console.error('[google-sync] token', revoked ? 'revoked' : 'failed');
      }
    }
    cache.set(userId, token);
    return token;
  };
}

/* ============================================================== calendar */

export async function syncCalendar(db, { tokenFor, origin }) {
  const { data: targets, error } = await db.rpc('google_sync_targets');
  if (error) { console.error('[google-sync] targets', error.code); return { pushed: 0 }; }
  let pushed = 0;
  for (const m of targets ?? []) {
    const base = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
    const remove = m.cancelled || !m.want_sync;
    if (!m.calendar_user) {
      // Nobody's calendar to put it in yet (nobody connected): leave it marked.
      continue;
    }
    const token = await tokenFor(m.calendar_user);
    if (!token) continue;
    const send = (m.invite ?? []).length > 0 ? 'all' : 'none';
    let result;
    if (remove) {
      if (m.event_id) {
        const r = await google(token, `${base}/${encodeURIComponent(m.event_id)}?sendUpdates=${send}`, { method: 'DELETE' });
        result = r.ok || r.status === 404 || r.status === 410 ? { event: null } : { error: `calendar ${r.status}` };
      } else {
        result = { event: null };
      }
    } else {
      const body = JSON.stringify(eventBody(m, { origin }));
      const r = m.event_id
        ? await google(token, `${base}/${encodeURIComponent(m.event_id)}?conferenceDataVersion=1&sendUpdates=${send}`, { method: 'PATCH', body })
        : await google(token, `${base}?conferenceDataVersion=1&sendUpdates=${send}`, { method: 'POST', body });
      if (r.ok) result = { event: r.body?.id ?? m.event_id, meet: r.body?.hangoutLink ?? null };
      else if (m.event_id && (r.status === 404 || r.status === 410)) {
        // Deleted in Google by hand: make it again.
        const again = await google(token, `${base}?conferenceDataVersion=1&sendUpdates=${send}`, { method: 'POST', body });
        result = again.ok ? { event: again.body?.id, meet: again.body?.hangoutLink ?? null } : { error: `calendar ${again.status}` };
      } else result = { error: `calendar ${r.status}` };
    }
    await db.rpc('google_mark_synced', {
      p_meeting: m.meeting_id, p_seen: m.dirty_at, p_event: result.event ?? null, p_calendar_user: m.calendar_user,
      p_meet_url: result.meet ?? null, p_error: result.error ?? null,
    });
    if (result.error) console.error('[google-sync] calendar', result.error);
    else pushed += 1;
  }
  return { pushed };
}

/* ================================================================= gmail */

const header = (msg, name) => (msg.payload?.headers ?? []).find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';

export async function syncGmail(db, account, { tokenFor, known, now = Date.now() }) {
  const token = await tokenFor(account.user_id);
  if (!token) return { stored: 0 };
  const since = account.gmail_synced_at ? new Date(account.gmail_synced_at).getTime() - 60 * 60_000 : now - FIRST_LOOK_DAYS * 864e5;
  const q = `after:${Math.floor(since / 1000)} -in:chats`;
  const ids = [];
  let page = null;
  for (let i = 0; i < 5; i += 1) {
    const r = await google(token, `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=100&q=${encodeURIComponent(q)}${page ? `&pageToken=${page}` : ''}`);
    if (!r.ok) { console.error('[google-sync] gmail list', r.status); return { stored: 0, error: `gmail ${r.status}` }; }
    for (const m of r.body?.messages ?? []) ids.push(m);
    page = r.body?.nextPageToken;
    if (!page) break;
  }
  const mine = account.google_email.toLowerCase();
  let stored = 0;
  for (const { id } of ids) {
    const r = await google(token, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject&metadataHeaders=Date`);
    if (!r.ok) continue;
    const msg = r.body;
    const from = parseAddresses(header(msg, 'From'))[0];
    if (!from) continue;
    const to = [...parseAddresses(header(msg, 'To')), ...parseAddresses(header(msg, 'Cc'))].map((x) => x.email);
    const out = from.email === mine;
    // Whose message it is: the other side's addresses.
    const others = out ? to : [from.email];
    const hits = others.flatMap((e) => known.get(e) ?? []);
    if (hits.length === 0) continue;
    const lead = hits.find((h) => h.lead_id)?.lead_id ?? null;
    const org = hits.find((h) => h.organization_id)?.organization_id ?? null;
    const deal = hits.find((h) => h.opportunity_id)?.opportunity_id ?? null;
    const sent = Number(msg.internalDate) || Date.parse(header(msg, 'Date')) || now;
    const { data } = await db.rpc('email_store', {
      p_mailbox: account.user_id, p_gmail_id: msg.id, p_thread_id: msg.threadId ?? null, p_direction: out ? 'out' : 'in',
      p_from: from.email, p_from_name: from.name, p_to: to, p_subject: header(msg, 'Subject').slice(0, 500),
      p_snippet: String(msg.snippet ?? '').slice(0, 300), p_sent_at: new Date(sent).toISOString(), p_lead: lead, p_org: org, p_deal: deal,
    });
    if (data === true) stored += 1;
  }
  await db.from('google_accounts').update({ gmail_synced_at: new Date(now).toISOString(), last_error: null }).eq('user_id', account.user_id);
  return { stored };
}

/* ================================================================== run */

export async function run(db, { origin, now = Date.now(), creds }) {
  const { data: accounts, error } = await db.from('google_accounts').select('user_id, google_email, refresh_token_enc, gmail_synced_at, last_error');
  if (error) { console.error('[google-sync] accounts', error.code); return { accounts: 0 }; }
  const list = (accounts ?? []).map((a) => ({ ...a, revoked: a.last_error === 'revoked' }));
  if (list.length === 0) return { accounts: 0 };
  const tokenFor = tokens(db, list, creds);
  const cal = await syncCalendar(db, { tokenFor, origin });

  let stored = 0;
  const due = list.filter((a) => !a.revoked && (!a.gmail_synced_at || now - new Date(a.gmail_synced_at).getTime() >= GMAIL_EVERY_MS));
  if (due.length > 0) {
    const { data: rows, error: e2 } = await db.rpc('email_known_addresses');
    if (e2) console.error('[google-sync] addresses', e2.code);
    const known = new Map();
    for (const r of rows ?? []) known.set(r.email, [...(known.get(r.email) ?? []), r]);
    for (const a of due) stored += (await syncGmail(db, a, { tokenFor, known, now })).stored;
  }
  console.log('[google-sync]', JSON.stringify({ accounts: list.length, events: cal.pushed, emails: stored }));
  return { accounts: list.length, events: cal.pushed, emails: stored };
}

export default async () => {
  const url = (env('SUPABASE_URL') || env('VITE_SUPABASE_URL') || '').replace(/\/+$/, '');
  const key = env('SUPABASE_SECRET_KEY') || env('SUPABASE_SERVICE_ROLE_KEY');
  const creds = { clientId: env('GOOGLE_CLIENT_ID'), clientSecret: env('GOOGLE_CLIENT_SECRET') };
  if (!url || !key || !creds.clientId || !creds.clientSecret || !env('GOOGLE_TOKEN_KEY')) {
    return new Response(null, { status: 204 });
  }
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const origin = (env('PORTAL_ORIGIN') || env('URL') || 'https://stratosweb.hu').replace(/\/+$/, '');
  await run(db, { origin, creds });
  return new Response(null, { status: 204 });
};

// Every two minutes (Netlify Scheduled Functions; the published deploy only).
export const config = { schedule: '*/2 * * * *' };

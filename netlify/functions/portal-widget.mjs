// =============================================================================
// GET /api/widget — one small summary for the Stratos app and its widgets
//
// The phone and Mac widgets (and the app's home screen) show the same few
// numbers, so they read them in one call rather than ten. What comes back
// depends on who is asking:
//
//   owner   the Today page in brief: how much is due today or late (tasks,
//           deal follow-ups, project checkpoints, today's meetings, automation
//           alerts), the first few of those lines, the next meeting or booked
//           call, and how many new leads wait.
//   client  their projects, what Stratos is waiting on them for (open
//           requests, demos to approve) and their next meeting or booked call.
//
// Anyone else with a live session — staff who are not the owner — gets 403 for
// now: the app has no surface for them yet.
//
// WHO MAY CALL IT, AND AS WHOM
// ----------------------------
// The caller's own Supabase access token, the one the app signed in with. Every
// read below runs AS THAT USER through PostgREST, so RLS and the
// client_portal_* functions decide what it reaches — exactly what the same
// account reaches in the Portal. The server key is never read here. Each
// request re-checks the token with GoTrue, so a revoked session stops at once.
//
// THE DAY
// -------
// "Today" is the Portal's day: Europe/Budapest, whatever zone Netlify runs in
// (todayIso() in portal/src/lib/notes.ts does the same in the browser).
//
// CORS
// ----
// `*`, for the app's web build. Safe without an origin list: there is no
// cookie, and a response is only ever about the token the caller already holds.
// =============================================================================

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '');
const PUBLIC_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

const ZONE = 'Europe/Budapest';
const MAX_ITEMS = 8;
// The checklist quick tasks go into (inboxNoteId in portal/src/lib/notes.ts),
// in its three languages. Its title says nothing a task line does not.
const INBOX_TITLES = new Set(['Tasks', 'Teendők', 'Aufgaben']);

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-max-age': '86400',
};

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store, max-age=0', ...CORS },
  });
const fail = (status, code, message) => json(status, { ok: false, code, message });

/** A seam: the suite answers for Supabase. */
export const __net = { fetch: (...args) => globalThis.fetch(...args) };
const call = (url, init) => __net.fetch(url, { ...init, signal: AbortSignal.timeout(8000) });

/** One PostgREST call AS THE CALLER. `params` keep their order; values are encoded once. */
async function rest(token, method, path, { params = [], body, prefer } = {}) {
  const qs = params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  const headers = { apikey: PUBLIC_KEY, authorization: `Bearer ${token}`, accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (prefer) headers.prefer = prefer;
  const res = await call(`${SUPABASE_URL}/rest/v1${path}${qs ? `?${qs}` : ''}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text().catch(() => '');
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  return { ok: res.ok, status: res.status, body: data, range: res.headers.get('content-range') };
}
const rpc = (token, name) => rest(token, 'POST', `/rpc/${name}`, { body: {} });

class Unavailable extends Error {}
/** Rows, or the whole answer is 502: a widget showing half the truth as all of it is worse than its last good one. */
const rowsOf = (res, what) => {
  if (!res.ok || !Array.isArray(res.body)) {
    console.error('[portal-widget]', what, res.status, res.body?.code ?? '');
    throw new Unavailable(what);
  }
  return res.body;
};

// --------------------------------------------------------------------- the day

/** YYYY-MM-DD in Budapest. */
export const dayOf = (at) => new Intl.DateTimeFormat('en-CA', { timeZone: ZONE }).format(at);

/** How far Budapest's wall clock is ahead of UTC at `at`, in ms. */
function offsetAt(at) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ZONE, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at);
  const p = Object.fromEntries(parts.map((x) => [x.type, Number(x.value)]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(at.getTime() / 1000) * 1000;
}

/** The instant a Budapest day starts. Twice, so a day after a clock change lands right. */
export function startOf(day) {
  const wall = Date.parse(`${day}T00:00:00Z`);
  const first = wall - offsetAt(new Date(wall));
  return new Date(wall - offsetAt(new Date(first)));
}

const nextDay = (day) => new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

// ------------------------------------------------------------------ the owner

/** The count PostgREST puts after the slash of Content-Range ("0-0/12"). */
const countOf = (res) => {
  if (!res.ok) throw new Unavailable('count');
  const total = Number(/\/(\d+)$/.exec(res.range ?? '')?.[1]);
  return Number.isFinite(total) ? total : 0;
};

/** The earliest of the upcoming meetings and booked calls, or null. */
const earliest = (list) => list.filter(Boolean).sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0] ?? null;

async function owner(token, now) {
  const day = dayOf(now);
  const from = startOf(day).toISOString();
  const to = startOf(nextDay(day)).toISOString();
  const nowIso = now.toISOString();

  // The same five reads as the Today page (useToday, useAlerts), plus the
  // next meeting, the next booked call and the new leads.
  const [tk, fu, cp, mt, al, nm, nb, ld] = await Promise.all([
    rest(token, 'GET', '/note_items', { params: [
      ['select', 'id,text,due_on,note:notes!inner(title,archived_at,client:organizations(name))'],
      ['done', 'eq.false'], ['due_on', 'not.is.null'], ['due_on', `lte.${day}`], ['note.archived_at', 'is.null'],
      ['order', 'due_on.asc'], ['limit', '200']] }),
    rest(token, 'GET', '/opportunities', { params: [
      ['select', 'id,title,next_action,next_action_on,company_name'],
      ['archived_at', 'is.null'], ['next_action_on', 'not.is.null'], ['next_action_on', `lte.${day}`],
      ['stage', 'not.in.("won","lost")'], ['order', 'next_action_on.asc'], ['limit', '100']] }),
    rest(token, 'GET', '/project_milestones', { params: [
      ['select', 'id,title,due_on,project:projects!inner(name,archived_at,status)'],
      ['state', 'neq.done'], ['due_on', 'not.is.null'], ['due_on', `lte.${day}`],
      ['project.archived_at', 'is.null'], ['project.status', 'neq.completed'],
      ['order', 'due_on.asc'], ['limit', '100']] }),
    rest(token, 'GET', '/project_meetings', { params: [
      ['select', 'id,title,starts_at,project:projects(name)'],
      ['cancelled_at', 'is.null'], ['starts_at', `gte.${from}`], ['starts_at', `lt.${to}`],
      ['order', 'starts_at.asc'], ['limit', '50']] }),
    rest(token, 'GET', '/automation_alerts', { params: [
      ['select', 'id,kind,title,due_on,created_at'],
      ['done_at', 'is.null'], ['resolved_at', 'is.null'], ['order', 'created_at.desc'], ['limit', '100']] }),
    rest(token, 'GET', '/project_meetings', { params: [
      ['select', 'title,starts_at,join_url,project:projects(name)'],
      ['cancelled_at', 'is.null'], ['starts_at', `gte.${nowIso}`], ['order', 'starts_at.asc'], ['limit', '1']] }),
    rest(token, 'GET', '/bookings', { params: [
      ['select', 'guest_name,starts_at,meet_url'],
      ['status', 'eq.confirmed'], ['starts_at', `gte.${nowIso}`], ['order', 'starts_at.asc'], ['limit', '1']] }),
    rest(token, 'GET', '/leads', { params: [
      ['select', 'id'], ['status', 'eq.new'], ['trashed_at', 'is.null'], ['limit', '1']], prefer: 'count=exact' }),
  ]);

  const tasks = rowsOf(tk, 'note_items');
  const followUps = rowsOf(fu, 'opportunities');
  const checkpoints = rowsOf(cp, 'project_milestones');
  const meetings = rowsOf(mt, 'project_meetings');
  // Before 20261015000100 the table is missing: Today simply has no alerts.
  const alerts = !al.ok && al.body?.code === 'PGRST205' ? [] : rowsOf(al, 'automation_alerts');
  const meeting = rowsOf(nm, 'project_meetings.next')[0];
  // Before 20261018000100 there are no bookings either.
  const booking = !nb.ok && nb.body?.code === 'PGRST205' ? undefined : rowsOf(nb, 'bookings')[0];

  const late = (due) => due < day;
  const items = [
    ...alerts.map((a) => ({ kind: 'alert', title: a.title, detail: null, due: a.due_on ?? day })),
    ...tasks.map((t) => ({
      kind: 'task', title: t.text, due: t.due_on,
      detail: t.note?.client?.name ?? (t.note && !INBOX_TITLES.has(t.note.title) ? t.note.title : null),
    })),
    ...followUps.map((o) => ({ kind: 'followUp', title: o.next_action || o.title, detail: o.company_name ?? o.title, due: o.next_action_on })),
    ...checkpoints.map((c) => ({ kind: 'checkpoint', title: c.title, detail: c.project?.name ?? null, due: c.due_on })),
    ...meetings.map((m) => ({ kind: 'meeting', title: m.title, detail: m.project?.name ?? null, due: day, startsAt: m.starts_at })),
  ]
    .map((it) => ({ ...it, late: late(it.due) }))
    // Oldest first, so what is most late leads; a stable sort keeps each source's own order within a day.
    .sort((a, b) => a.due.localeCompare(b.due));

  return {
    ok: true,
    kind: 'owner',
    day,
    generatedAt: nowIso,
    today: {
      total: items.length,
      late: items.filter((it) => it.late).length,
      tasks: tasks.length, followUps: followUps.length, checkpoints: checkpoints.length,
      meetings: meetings.length, alerts: alerts.length,
    },
    newLeads: countOf(ld),
    nextMeeting: earliest([
      meeting && { kind: 'meeting', title: meeting.title, detail: meeting.project?.name ?? null, startsAt: meeting.starts_at, joinUrl: meeting.join_url ?? null },
      booking && { kind: 'booking', title: booking.guest_name, detail: null, startsAt: booking.starts_at, joinUrl: booking.meet_url ?? null },
    ]),
    items: items.slice(0, MAX_ITEMS),
  };
}

// ----------------------------------------------------------------- the client

async function client(token, me, now) {
  const day = dayOf(now);
  const nowIso = now.toISOString();
  const [pr, rq, ap, dm, mt, bk] = await Promise.all([
    rpc(token, 'client_portal_projects'),
    rpc(token, 'client_portal_requests'),
    rpc(token, 'client_portal_approvals'),
    rpc(token, 'client_portal_demos'),
    rpc(token, 'client_portal_meetings'),
    rpc(token, 'client_portal_bookings'),
  ]);
  const projects = rowsOf(pr, 'client_portal_projects').map((p) => ({ id: p.project_id, name: p.project_name }));
  const name = new Map(projects.map((p) => [p.id, p.name]));
  const demo = new Map(rowsOf(dm, 'client_portal_demos').map((d) => [d.demo_id, d.title]));

  const requests = rowsOf(rq, 'client_portal_requests').filter((r) => !r.done_at);
  // Asked for and not yet answered; an answered one has a state.
  const approvals = rowsOf(ap, 'client_portal_approvals').filter((a) => !a.state);
  const meeting = rowsOf(mt, 'client_portal_meetings').find((m) => !m.cancelled && m.starts_at >= nowIso);
  const booking = rowsOf(bk, 'client_portal_bookings').find((b) => b.status === 'confirmed' && b.starts_at >= nowIso);

  const items = [
    ...approvals.map((a) => ({ kind: 'approval', title: demo.get(a.demo_id) ?? null, detail: name.get(a.project_id) ?? null, due: null, late: false })),
    ...requests.map((r) => ({ kind: 'request', title: r.title, detail: name.get(r.project_id) ?? null, due: r.due_on ?? null, late: !!r.due_on && r.due_on < day })),
  ];

  return {
    ok: true,
    kind: 'client',
    day,
    generatedAt: nowIso,
    me: { name: me.full_name, company: me.company },
    projects,
    waitingOnYou: { total: items.length, requests: requests.length, approvals: approvals.length },
    nextMeeting: earliest([
      meeting && { kind: 'meeting', title: meeting.title, detail: meeting.project_name, startsAt: meeting.starts_at, joinUrl: meeting.join_url ?? null },
      booking && { kind: 'booking', title: booking.topic ?? null, detail: booking.project_name ?? null, startsAt: booking.starts_at, joinUrl: booking.meet_url ?? null },
    ]),
    items: items.slice(0, MAX_ITEMS),
  };
}

// ---------------------------------------------------------------------- entry

/** Who holds this token: null when it is not a live session, else the owner, a client account or neither. */
async function identify(token) {
  const [user, isOwner, me] = await Promise.all([
    call(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: PUBLIC_KEY, authorization: `Bearer ${token}` } }),
    rpc(token, 'is_owner'),
    rpc(token, 'client_portal_me'),
  ]);
  if (!user.ok) return null;
  if (isOwner.ok && isOwner.body === true) return { kind: 'owner' };
  const row = me.ok && Array.isArray(me.body) ? me.body[0] : null;
  return row ? { kind: 'client', me: row } : { kind: 'other' };
}

export default async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'GET') return fail(405, 'METHOD_NOT_ALLOWED', 'Use GET.');
  if (!SUPABASE_URL || !PUBLIC_KEY) return fail(503, 'UNCONFIGURED', 'The widget is not configured on this deployment.');

  const token = /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization') || '')?.[1]?.trim();
  if (!token) return fail(401, 'UNAUTHENTICATED', 'Sign in to the Stratos app first.');

  let who;
  try {
    who = await identify(token);
  } catch {
    return fail(503, 'UNAVAILABLE', 'The Portal could not be reached. Try again.');
  }
  if (!who) return fail(401, 'UNAUTHENTICATED', 'The sign-in has expired or was revoked.');
  if (who.kind === 'other') return fail(403, 'FORBIDDEN', 'The Stratos app is for the owner and client accounts.');

  try {
    const now = new Date();
    return json(200, who.kind === 'owner' ? await owner(token, now) : await client(token, who.me, now));
  } catch (e) {
    if (!(e instanceof Unavailable)) console.error('[portal-widget]', e?.name ?? 'error');
    return fail(502, 'UNAVAILABLE', 'The Portal did not answer in full. Try again.');
  }
};

export const config = { path: '/api/widget' };

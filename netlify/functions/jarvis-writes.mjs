// =============================================================================
// Jarvis — the write tools and the life of an action (JARVIS_SPEC.md §3,
// phase 5: internal writes, approval cards, the external flow)
//
// Every write is a jarvis_actions row (20261019000300_jarvis.sql), made with
// the CALLER'S token, so RLS decides what may be written exactly as it does in
// the Portal; the table's trigger keeps the status one-way and logs each step
// to activity_logs.
//
//   internal   runs at once, is stored as 'executed' (or 'failed') with what
//              it would take to undo it, and can be undone from the panel
//   pending    waits for a person: Approve (optionally edited), Reject. A
//              write is pending when its tool is external (phase 6: e-mail
//              drafts, invites, client messages) — or when it is internal but
//              the same turn read text that outsiders wrote (a form message,
//              an e-mail snippet: TAINT_SOURCES). Such text is data, never an
//              instruction, and a write it may have prompted waits for a
//              person.
//
// Nothing here deletes CRM data: there is no delete tool, and undo removes
// only what the action itself created (a note, an activity, a task item, an
// hours entry) or puts back what it changed. A lead or deal Jarvis created is
// moved to the Trash / archive, as the Portal does.
// =============================================================================
import { UUID, budapestDate, rest } from './jarvis-lib.mjs';
import { COMPOSE_SCOPE, EVENTS_SCOPE } from './google-lib.mjs';
import { zoned } from './booking-lib.mjs';
import { GoogleError, draftRaw, gapi, googleToken } from './jarvis-google.mjs';

export class WriteInputError extends Error {}
class WriteDbError extends Error {
  constructor(res) {
    super('db');
    const b = res.body && typeof res.body === 'object' ? res.body : {};
    this.detail = { status: res.status, code: b.code ?? null, message: b.message ?? null };
  }
}

/** Tools whose results carry free text written by outsiders (lead messages, notes, e-mail snippets). */
export const TAINT_SOURCES = new Set(['get_record', 'email_search']);

/* ========================================================== input checks */

const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
function str(v, field, { max = 200, required = false } = {}) {
  if (v === undefined || v === null || (typeof v === 'string' && !v.trim())) {
    if (required) throw new WriteInputError(`${field} is required`);
    return null;
  }
  if (typeof v !== 'string') throw new WriteInputError(`${field} must be a string`);
  if (v.trim().length > max) throw new WriteInputError(`${field} is longer than ${max} characters`);
  return v.trim();
}
function uuid(v, field, { required = false } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw new WriteInputError(`${field} is required`);
    return null;
  }
  if (typeof v !== 'string' || !UUID.test(v)) throw new WriteInputError(`${field} must be a uuid`);
  return v.toLowerCase();
}
function oneOf(v, field, list, { required = false } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw new WriteInputError(`${field} is required (one of: ${list.join(', ')})`);
    return null;
  }
  if (!list.includes(v)) throw new WriteInputError(`${field} must be one of: ${list.join(', ')}`);
  return v;
}
function day(v, field) {
  if (v === undefined || v === null || v === '') return null;
  if (!isDate(v)) throw new WriteInputError(`${field} must be a date, YYYY-MM-DD`);
  return v;
}
function num(v, field, { min, max }) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new WriteInputError(`${field} must be a number from ${min} to ${max}`);
  return n;
}
const email = (v, field, opts) => {
  const s = str(v, field, { max: 320, ...opts });
  if (s && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw new WriteInputError(`${field} must be an e-mail address`);
  return s ? s.toLowerCase() : s;
};
const short = (s, n = 80) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

/* ============================================================== the db */

async function call(ctx, method, path, { params = [], body, prefer } = {}) {
  const res = await rest(ctx.token, method, path, { params, body, prefer });
  if (!res.ok) throw new WriteDbError(res);
  return res.body;
}
const one = async (ctx, path, params) => (await call(ctx, 'GET', path, { params }))?.[0] ?? null;
const insert = async (ctx, table, row) => (await call(ctx, 'POST', `/${table}`, { body: row, prefer: 'return=representation' }))?.[0];
const patch = async (ctx, table, id, row) => (await call(ctx, 'PATCH', `/${table}`, { params: [['id', `eq.${id}`]], body: row, prefer: 'return=representation' }))?.[0];
const remove = (ctx, table, id) => call(ctx, 'DELETE', `/${table}`, { params: [['id', `eq.${id}`]], prefer: 'return=minimal' });

/* ============================================================== tools */

const LEAD_STATUS = ['new', 'contacted', 'qualified', 'proposal', 'won', 'lost', 'spam'];
const STAGES = ['qualified', 'discovery', 'proposal', 'negotiation', 'won', 'lost'];
const KINDS = ['call', 'email', 'meeting', 'message', 'other'];
const NOTE_TARGETS = ['lead', 'opportunity', 'client', 'project'];
const WORD = { lead: 'lead', opportunity: 'deal', client: 'ügyfél', project: 'projekt' };
const KIND_WORD = { call: 'hívás', email: 'e-mail', meeting: 'meeting', message: 'üzenet', other: 'egyéb' };
const TASK_NOTE_TITLE = 'Jarvis feladatai';
/** "The moment of the undo", in an undo plan: an object, so no stored text can be mistaken for it. */
const NOW = { $now: true };
const isNow = (v) => v !== null && typeof v === 'object' && v.$now === true;
const schema = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });

export const WRITE_TOOLS = [
  {
    name: 'add_note',
    description: 'Adds a note to a lead, deal, client or project (as the signed-in person). Runs at once and can be undone from the panel.',
    input_schema: schema({
      entity_type: { type: 'string', enum: NOTE_TARGETS },
      entity_id: { type: 'string', description: 'The record id (uuid).' },
      body: { type: 'string', description: 'The note, up to 4000 characters.' },
    }, ['entity_type', 'entity_id', 'body']),
    parse: (i) => ({
      entity_type: oneOf(i.entity_type, 'entity_type', NOTE_TARGETS, { required: true }),
      entity_id: uuid(i.entity_id, 'entity_id', { required: true }),
      body: str(i.body, 'body', { max: 4000, required: true }),
    }),
    summary: (a) => `Jegyzet · ${WORD[a.entity_type]}: „${short(a.body)}”`,
    execute: async (ctx, a) => {
      if (a.entity_type === 'lead') {
        const row = await insert(ctx, 'lead_notes', { lead_id: a.entity_id, author_id: ctx.userId, body: a.body });
        return { data: { note_id: row.id }, label: 'Jegyzet mentve', undo: { table: 'lead_notes', id: row.id } };
      }
      const type = a.entity_type === 'client' ? 'client' : a.entity_type;
      const row = await insert(ctx, 'record_notes', { entity_type: type, entity_id: a.entity_id, author_id: ctx.userId, body: a.body });
      return { data: { note_id: row.id }, label: 'Jegyzet mentve', undo: { table: 'record_notes', id: row.id } };
    },
  },
  {
    name: 'log_interaction',
    description: 'Records an activity (a call, e-mail, meeting, message) on a lead, a client and/or a deal: what happened, and when. Runs at once and can be undone.',
    input_schema: schema({
      kind: { type: 'string', enum: KINDS },
      summary: { type: 'string', description: 'What happened, up to 500 characters.' },
      occurred_on: { type: 'string', description: 'YYYY-MM-DD. Default today.' },
      lead_id: { type: 'string' }, organization_id: { type: 'string' }, opportunity_id: { type: 'string' },
    }, ['kind', 'summary']),
    parse: (i) => {
      const a = {
        kind: oneOf(i.kind, 'kind', KINDS, { required: true }),
        summary: str(i.summary, 'summary', { max: 500, required: true }),
        occurred_on: day(i.occurred_on, 'occurred_on'),
        lead_id: uuid(i.lead_id, 'lead_id'), organization_id: uuid(i.organization_id, 'organization_id'), opportunity_id: uuid(i.opportunity_id, 'opportunity_id'),
      };
      if (!a.lead_id && !a.organization_id && !a.opportunity_id) throw new WriteInputError('one of lead_id, organization_id, opportunity_id is required');
      if (a.occurred_on && a.occurred_on > budapestDate(new Date(), 1)) throw new WriteInputError('occurred_on cannot be in the future');
      return a;
    },
    summary: (a) => `Aktivitás · ${KIND_WORD[a.kind]}${a.occurred_on ? ` (${a.occurred_on})` : ''}: „${short(a.summary)}”`,
    execute: async (ctx, a) => {
      const row = await insert(ctx, 'interactions', {
        kind: a.kind, summary: a.summary, lead_id: a.lead_id, organization_id: a.organization_id, opportunity_id: a.opportunity_id,
        ...(a.occurred_on && a.occurred_on !== budapestDate() ? { occurred_at: `${a.occurred_on}T12:00:00Z` } : {}),
      });
      return { data: { interaction_id: row.id }, label: 'Aktivitás rögzítve', undo: { table: 'interactions', id: row.id } };
    },
  },
  {
    name: 'update_lead_status',
    description: 'Moves a lead to another status in the pipeline. Runs at once; undo puts the old status back.',
    input_schema: schema({ lead_id: { type: 'string' }, status: { type: 'string', enum: LEAD_STATUS } }, ['lead_id', 'status']),
    parse: (i) => ({ lead_id: uuid(i.lead_id, 'lead_id', { required: true }), status: oneOf(i.status, 'status', LEAD_STATUS, { required: true }) }),
    summary: (a) => `Lead státusza → ${a.status}`,
    execute: async (ctx, a) => {
      const before = await one(ctx, '/leads', [['select', 'id,name,status'], ['id', `eq.${a.lead_id}`], ['trashed_at', 'is.null']]);
      if (!before) throw new WriteInputError('No such lead, or this account cannot see it.');
      if (before.status === a.status) return { data: { lead_id: a.lead_id, status: a.status, unchanged: true }, label: `Lead státusza már ${a.status}`, undo: null };
      await patch(ctx, 'leads', a.lead_id, { status: a.status });
      return {
        data: { lead_id: a.lead_id, name: before.name, from: before.status, to: a.status },
        label: `Lead státusza: ${before.status} → ${a.status}`,
        undo: { table: 'leads', id: a.lead_id, set: { status: before.status } },
      };
    },
  },
  {
    name: 'create_opportunity',
    description: 'Creates a deal (sales opportunity) for a client or a company name, optionally from a lead. Runs at once; undo archives it.',
    input_schema: schema({
      title: { type: 'string' },
      organization_id: { type: 'string', description: 'The client (uuid), when it is one already.' },
      company_name: { type: 'string', description: 'When there is no client record yet.' },
      lead_id: { type: 'string' },
      contact_name: { type: 'string' }, contact_email: { type: 'string' },
      service: { type: 'string' },
      estimated_value: { type: 'number', minimum: 0 },
      currency: { type: 'string', enum: ['HUF', 'EUR', 'USD'] },
      stage: { type: 'string', enum: STAGES.filter((s) => s !== 'won' && s !== 'lost') },
      expected_close_on: { type: 'string', description: 'YYYY-MM-DD' },
      next_action: { type: 'string' }, next_action_on: { type: 'string', description: 'YYYY-MM-DD' },
    }, ['title']),
    parse: (i) => {
      const a = {
        title: str(i.title, 'title', { max: 200, required: true }),
        organization_id: uuid(i.organization_id, 'organization_id'), company_name: str(i.company_name, 'company_name', { max: 200 }),
        lead_id: uuid(i.lead_id, 'lead_id'), contact_name: str(i.contact_name, 'contact_name', { max: 200 }),
        contact_email: email(i.contact_email, 'contact_email'), service: str(i.service, 'service', { max: 120 }),
        estimated_value: num(i.estimated_value, 'estimated_value', { min: 0, max: 1e12 }),
        currency: oneOf(i.currency, 'currency', ['HUF', 'EUR', 'USD']),
        stage: oneOf(i.stage, 'stage', ['qualified', 'discovery', 'proposal', 'negotiation']),
        expected_close_on: day(i.expected_close_on, 'expected_close_on'),
        next_action: str(i.next_action, 'next_action', { max: 200 }), next_action_on: day(i.next_action_on, 'next_action_on'),
      };
      if (!a.organization_id && !a.company_name) throw new WriteInputError('organization_id or company_name is required');
      return a;
    },
    summary: (a) => `Új deal: ${short(a.title, 60)}${a.estimated_value != null ? ` · ${a.estimated_value} ${a.currency ?? 'HUF'}` : ''}`,
    execute: async (ctx, a) => {
      const row = Object.fromEntries(Object.entries({ ...a, created_by: ctx.userId, owner_id: ctx.userId }).filter(([, v]) => v !== null));
      const made = await insert(ctx, 'opportunities', row);
      return { data: { opportunity_id: made.id, stage: made.stage }, label: `Deal létrehozva · ${short(a.title, 40)}`, undo: { table: 'opportunities', id: made.id, set: { archived_at: NOW } } };
    },
  },
  {
    name: 'update_opportunity',
    description: 'Changes a deal: stage, next action and its date, probability, expected close date. Runs at once; undo puts the old values back. Marking a deal won or lost is not done here.',
    input_schema: schema({
      id: { type: 'string' },
      stage: { type: 'string', enum: ['qualified', 'discovery', 'proposal', 'negotiation'] },
      next_action: { type: 'string' }, next_action_on: { type: 'string', description: 'YYYY-MM-DD' },
      probability: { type: 'integer', minimum: 0, maximum: 100 },
      expected_close_on: { type: 'string', description: 'YYYY-MM-DD' },
    }, ['id']),
    parse: (i) => {
      const a = {
        id: uuid(i.id, 'id', { required: true }),
        stage: oneOf(i.stage, 'stage', ['qualified', 'discovery', 'proposal', 'negotiation']),
        next_action: str(i.next_action, 'next_action', { max: 200 }), next_action_on: day(i.next_action_on, 'next_action_on'),
        probability: num(i.probability, 'probability', { min: 0, max: 100 }),
        expected_close_on: day(i.expected_close_on, 'expected_close_on'),
      };
      if (a.probability !== null && !Number.isInteger(a.probability)) throw new WriteInputError('probability must be an integer');
      if (Object.entries(a).every(([k, v]) => k === 'id' || v === null)) throw new WriteInputError('nothing to change');
      return a;
    },
    summary: (a) => `Deal módosítása: ${Object.entries(a).filter(([k, v]) => k !== 'id' && v !== null).map(([k, v]) => `${k} = ${short(v, 40)}`).join(', ')}`,
    execute: async (ctx, a) => {
      const fields = Object.keys(a).filter((k) => k !== 'id' && a[k] !== null);
      const before = await one(ctx, '/opportunities', [['select', `id,title,stage,${fields.join(',')}`], ['id', `eq.${a.id}`], ['archived_at', 'is.null']]);
      if (!before) throw new WriteInputError('No such deal, or this account cannot see it.');
      if (before.stage === 'won' || before.stage === 'lost') throw new WriteInputError('This deal is closed (won or lost); change it in the Portal.');
      const set = Object.fromEntries(fields.map((k) => [k, a[k]]));
      await patch(ctx, 'opportunities', a.id, set);
      return {
        data: { opportunity_id: a.id, title: before.title, changed: set },
        label: `Deal módosítva · ${short(before.title, 40)}`,
        undo: { table: 'opportunities', id: a.id, set: Object.fromEntries(fields.map((k) => [k, before[k] ?? null])) },
      };
    },
  },
  {
    name: 'create_task',
    description: 'Adds a task (a checklist item, optionally with a due date) to the given checklist note, or to the person\'s own "Jarvis feladatai" checklist. Runs at once; undo removes the item.',
    input_schema: schema({
      title: { type: 'string', description: 'The task, up to 500 characters.' },
      due_on: { type: 'string', description: 'YYYY-MM-DD' },
      note_id: { type: 'string', description: 'A checklist note (uuid). Default: the person\'s Jarvis checklist.' },
    }, ['title']),
    parse: (i) => ({ title: str(i.title, 'title', { max: 500, required: true }), due_on: day(i.due_on, 'due_on'), note_id: uuid(i.note_id, 'note_id') }),
    summary: (a) => `Feladat: ${short(a.title, 70)}${a.due_on ? ` · határidő ${a.due_on}` : ''}`,
    execute: async (ctx, a) => {
      let noteId = a.note_id;
      if (noteId) {
        if (!(await one(ctx, '/notes', [['select', 'id'], ['id', `eq.${noteId}`], ['archived_at', 'is.null']]))) throw new WriteInputError('No such note.');
      } else {
        const mine = await one(ctx, '/notes', [['select', 'id'], ['created_by', `eq.${ctx.userId}`], ['title', `eq.${TASK_NOTE_TITLE}`],
          ['kind', 'eq.checklist'], ['archived_at', 'is.null'], ['limit', '1']]);
        noteId = mine?.id ?? (await insert(ctx, 'notes', { kind: 'checklist', title: TASK_NOTE_TITLE })).id;
      }
      const last = await one(ctx, '/note_items', [['select', 'position'], ['note_id', `eq.${noteId}`], ['order', 'position.desc'], ['limit', '1']]);
      const item = await insert(ctx, 'note_items', { note_id: noteId, text: a.title, due_on: a.due_on, position: (last?.position ?? -1) + 1 });
      return { data: { task_id: item.id, note_id: noteId }, label: `Feladat felvéve${a.due_on ? ` · ${a.due_on}` : ''}`, undo: { table: 'note_items', id: item.id } };
    },
  },
  {
    name: 'log_time',
    description: 'Records hours the signed-in person worked: on a project, or under a label (e.g. "Admin", "Sales"). Quarter hours, up to 24 a day. Runs at once; undo removes the entry.',
    input_schema: schema({
      hours: { type: 'number', minimum: 0.25, maximum: 24, description: 'In quarter hours: 0.25, 0.5, 1.75, …' },
      work_date: { type: 'string', description: 'YYYY-MM-DD. Default today.' },
      project_id: { type: 'string' }, label: { type: 'string' }, note: { type: 'string' },
    }, ['hours']),
    parse: (i) => {
      const a = {
        hours: num(i.hours, 'hours', { min: 0.25, max: 24 }), work_date: day(i.work_date, 'work_date') ?? budapestDate(),
        project_id: uuid(i.project_id, 'project_id'), label: str(i.label, 'label', { max: 120 }), note: str(i.note, 'note', { max: 1000 }),
      };
      if (a.hours === null) throw new WriteInputError('hours is required');
      if (a.hours * 4 !== Math.trunc(a.hours * 4)) throw new WriteInputError('hours must be in quarter hours');
      if (!a.project_id && !a.label) throw new WriteInputError('project_id or label is required');
      if (a.work_date > budapestDate(new Date(), 1)) throw new WriteInputError('work_date cannot be in the future');
      return a;
    },
    summary: (a) => `Munkaidő: ${String(a.hours).replace('.', ',')} óra · ${a.work_date}${a.label ? ` · ${short(a.label, 40)}` : ''}`,
    execute: async (ctx, a) => {
      const row = await insert(ctx, 'time_entries', { work_date: a.work_date, hours: a.hours, project_id: a.project_id, label: a.project_id ? null : a.label, note: a.note });
      return { data: { time_entry_id: row.id }, label: `Munkaidő rögzítve · ${String(a.hours).replace('.', ',')} óra`, undo: { table: 'time_entries', id: row.id } };
    },
  },
  {
    name: 'create_lead',
    description: 'Creates a lead (source "jarvis", status new, marked for review), e.g. from research. A name and an e-mail address are required. Refuses when a live lead has the same e-mail. Runs at once; undo moves it to the Trash.',
    input_schema: schema({
      name: { type: 'string' }, email: { type: 'string' }, company: { type: 'string' }, phone: { type: 'string' },
      website: { type: 'string' }, service_interest: { type: 'string' }, message: { type: 'string', description: 'Why this lead: what was found, and where.' },
    }, ['name', 'email']),
    parse: (i) => ({
      name: str(i.name, 'name', { max: 200, required: true }), email: email(i.email, 'email', { required: true }),
      company: str(i.company, 'company', { max: 200 }), phone: str(i.phone, 'phone', { max: 64 }),
      website: str(i.website, 'website', { max: 300 }), service_interest: str(i.service_interest, 'service_interest', { max: 200 }),
      message: str(i.message, 'message', { max: 4000 }),
    }),
    summary: (a) => `Új lead: ${short(a.name, 50)} (${a.email})`,
    execute: async (ctx, a) => {
      const twin = await one(ctx, '/leads', [['select', 'id,name,status'], ['email', `ilike.${a.email.replace(/[%_*]/g, '')}`], ['trashed_at', 'is.null'], ['limit', '1']]);
      if (twin) throw new WriteInputError(`A lead with this e-mail exists already: ${twin.id} (${twin.name}, ${twin.status}).`);
      const row = await insert(ctx, 'leads', { ...a, source: 'jarvis', status: 'new', meta: { jarvis_review: true, created_by: ctx.userId } });
      return { data: { lead_id: row.id }, label: `Lead létrehozva · ${short(a.name, 40)}`, undo: { table: 'leads', id: row.id, set: { trashed_at: NOW } } };
    },
  },
].map((t) => ({ roles: ['owner', 'admin'], risk: 'internal', ...t }));

/* ===================================================== external (phase 6) */

const TZ = 'Europe/Budapest';
const emails = (v, field, { max = 10, required = false } = {}) => {
  const list = v === undefined || v === null ? [] : Array.isArray(v) ? v : [v];
  if (required && list.length === 0) throw new WriteInputError(`${field} is required`);
  if (list.length > max) throw new WriteInputError(`${field}: at most ${max} addresses`);
  return [...new Set(list.map((x) => email(x, field, { required: true })))];
};
const oneLine = (v, field, opts) => { const t = str(v, field, opts); return t ? t.replace(/[\r\n]+/g, ' ') : t; };
const flag = (v) => v === true;

/** A start time: "YYYY-MM-DDTHH:MM" on Budapest's clock, or an ISO instant with its offset. → ms */
function startOf(v) {
  if (typeof v !== 'string') throw new WriteInputError('start is required: YYYY-MM-DDTHH:MM (Budapest time)');
  const local = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/.exec(v.trim());
  const ms = local ? zoned(+local[1], +local[2], +local[3], +local[4], +local[5], TZ)
    : /(Z|[+-]\d{2}:\d{2})$/.test(v.trim()) ? Date.parse(v.trim()) : NaN;
  if (ms === null || !Number.isFinite(ms)) throw new WriteInputError('start must be YYYY-MM-DDTHH:MM (Budapest time) or an ISO time with its offset');
  return ms;
}
const clock = (ms) => new Intl.DateTimeFormat('hu-HU', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(ms);

export const EXTERNAL_TOOLS = [
  {
    name: 'gmail_create_draft',
    description: 'Writes an e-mail as a DRAFT in the Gmail of the person who approves it (plain text). It is never sent: the person reviews and sends it from Gmail. Waits for approval in the panel.',
    input_schema: schema({
      to: { type: 'array', items: { type: 'string' }, description: 'Recipients\' e-mail addresses.' },
      cc: { type: 'array', items: { type: 'string' } },
      subject: { type: 'string', description: 'Up to 200 characters, one line.' },
      body: { type: 'string', description: 'The e-mail, plain text, up to 20000 characters. Sign it as the person, not as Jarvis.' },
      lead_id: { type: 'string' }, organization_id: { type: 'string' }, opportunity_id: { type: 'string' },
    }, ['to', 'subject', 'body']),
    parse: (i) => ({
      to: emails(i.to, 'to', { required: true }), cc: emails(i.cc, 'cc'),
      subject: oneLine(i.subject, 'subject', { max: 200, required: true }), body: str(i.body, 'body', { max: 20000, required: true }),
      lead_id: uuid(i.lead_id, 'lead_id'), organization_id: uuid(i.organization_id, 'organization_id'), opportunity_id: uuid(i.opportunity_id, 'opportunity_id'),
    }),
    summary: (a) => `Gmail-piszkozat → ${a.to.join(', ')}: „${short(a.subject, 60)}”`,
    execute: async (ctx, a) => {
      const { token, email: mailbox } = await googleToken(ctx.userId, COMPOSE_SCOPE);
      const r = await gapi(token, 'https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
        method: 'POST', body: JSON.stringify({ message: { raw: draftRaw(a) } }),
      });
      if (!r.ok || !r.body?.id) throw new GoogleError('GOOGLE_FAILED', `Gmail did not take the draft (HTTP ${r.status}).`);
      return {
        data: { draft_id: r.body.id, mailbox, link: 'https://mail.google.com/mail/u/0/#drafts' },
        label: `Piszkozat a Gmailben · ${short(a.subject, 40)}`, undo: null,
      };
    },
  },
  {
    name: 'calendar_create_event',
    description: 'Schedules a meeting. With project_id: a project meeting — shown to the project\'s clients in the client portal, who also get an e-mail; it goes into Google Calendar within two minutes, with a Meet link if asked and, with invite_clients, the clients invited. Without project_id: an event in the approver\'s own Google Calendar, optionally with attendees (Google e-mails them an invitation). Waits for approval.',
    input_schema: schema({
      title: { type: 'string', description: 'Up to 160 characters.' },
      start: { type: 'string', description: 'YYYY-MM-DDTHH:MM on Budapest\'s clock.' },
      minutes: { type: 'integer', minimum: 15, maximum: 480, description: 'Default 30.' },
      project_id: { type: 'string' },
      location: { type: 'string', description: 'A place or an address. Not needed with meet.' },
      note: { type: 'string', description: 'For the participants, up to 1000 characters.' },
      meet: { type: 'boolean', description: 'Add a Google Meet link.' },
      invite_clients: { type: 'boolean', description: 'Project meetings only: invite the project\'s client accounts from Google Calendar.' },
      attendees: { type: 'array', items: { type: 'string' }, description: 'Events without a project only: e-mail addresses to invite.' },
    }, ['title', 'start']),
    parse: (i) => {
      const a = {
        title: oneLine(i.title, 'title', { max: 160, required: true }), start: null, minutes: num(i.minutes, 'minutes', { min: 15, max: 480 }) ?? 30,
        project_id: uuid(i.project_id, 'project_id'), location: oneLine(i.location, 'location', { max: 300 }), note: str(i.note, 'note', { max: 1000 }),
        meet: flag(i.meet), invite_clients: flag(i.invite_clients), attendees: emails(i.attendees, 'attendees', { max: 20 }),
      };
      const ms = startOf(i.start);
      if (ms < Date.now() + 5 * 60_000) throw new WriteInputError('start must be in the future');
      a.start = new Date(ms).toISOString();
      if (!Number.isInteger(a.minutes)) throw new WriteInputError('minutes must be a whole number');
      if (a.project_id && a.attendees.length) throw new WriteInputError('a project meeting invites its clients with invite_clients, not attendees');
      if (!a.project_id && a.invite_clients) throw new WriteInputError('invite_clients needs project_id');
      if (!a.location && !a.meet) throw new WriteInputError('give a location, or meet: true');
      return a;
    },
    summary: (a) => `${a.project_id ? 'Projektmeeting' : 'Naptáresemény'}: „${short(a.title, 50)}” · ${clock(Date.parse(a.start))} · ${a.minutes} perc`
      + `${a.meet ? ' · Meet' : ''}${a.invite_clients ? ' · a kliens meghívva' : ''}${a.attendees.length ? ` · meghívottak: ${a.attendees.join(', ')}` : ''}`,
    execute: async (ctx, a) => {
      const end = new Date(Date.parse(a.start) + a.minutes * 60_000).toISOString();
      if (a.project_id) {
        const made = await insert(ctx, 'project_meetings', {
          project_id: a.project_id, title: a.title, starts_at: a.start, ends_at: end, time_zone: TZ,
          location: a.location ?? 'Google Meet', client_note: a.note, google_meet: a.meet, google_invite_clients: a.invite_clients,
        });
        // As the Portal does when a meeting is made: the client is told (notify-dispatch sends it).
        const told = await rest(ctx.token, 'POST', '/notification_outbox', {
          body: { audience: 'client', kind: 'meeting_scheduled', project_id: a.project_id, payload: { title: a.title, starts_at: a.start, time_zone: TZ } },
          prefer: 'return=minimal',
        });
        return {
          data: { meeting_id: made.id, client_notified: told.ok, calendar: 'Google Calendar within two minutes (the Portal\'s sync)' },
          label: `Projektmeeting felvéve · ${clock(Date.parse(a.start))}`, undo: null,
        };
      }
      const { token } = await googleToken(ctx.userId, EVENTS_SCOPE);
      const event = {
        summary: a.title, description: a.note ?? undefined, location: a.location ?? undefined,
        start: { dateTime: a.start, timeZone: TZ }, end: { dateTime: end, timeZone: TZ },
        attendees: a.attendees.map((x) => ({ email: x })), source: { title: 'Stratos', url: 'https://stratosweb.hu/portal/' },
        ...(a.meet ? { conferenceData: { createRequest: { requestId: `jarvis-${Date.parse(a.start)}-${Math.random().toString(36).slice(2, 10)}`, conferenceSolutionKey: { type: 'hangoutsMeet' } } } } : {}),
      };
      const r = await gapi(token, `https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=${a.attendees.length ? 'all' : 'none'}`, {
        method: 'POST', body: JSON.stringify(event),
      });
      if (!r.ok || !r.body?.id) throw new GoogleError('GOOGLE_FAILED', `Google Calendar did not take the event (HTTP ${r.status}).`);
      return {
        data: { event_id: r.body.id, link: r.body.htmlLink ?? null, meet: r.body.hangoutLink ?? null },
        label: `Naptáresemény felvéve · ${clock(Date.parse(a.start))}`, undo: null,
      };
    },
  },
  {
    name: 'client_portal_message',
    description: 'Posts a message from Stratos to a project\'s clients in the client portal; they also get an e-mail about it. Owner only (projects are). Waits for approval.',
    input_schema: schema({
      project_id: { type: 'string' },
      body: { type: 'string', description: 'The message, up to 4000 characters, in the clients\' language.' },
    }, ['project_id', 'body']),
    parse: (i) => ({ project_id: uuid(i.project_id, 'project_id', { required: true }), body: str(i.body, 'body', { max: 4000, required: true }) }),
    summary: (a) => `Kliensüzenet: „${short(a.body, 70)}”`,
    execute: async (ctx, a) => {
      const made = await insert(ctx, 'project_messages', { project_id: a.project_id, body: a.body });
      // As the Portal does after a message: the clients are told.
      const told = await rest(ctx.token, 'POST', '/notification_outbox', {
        body: { audience: 'client', kind: 'message_posted', project_id: a.project_id, payload: { excerpt: a.body.slice(0, 300) } },
        prefer: 'return=minimal',
      });
      return { data: { message_id: made.id, client_notified: told.ok }, label: 'Üzenet elküldve a kliensportálon', undo: null };
    },
  },
].map((t) => ({ roles: ['owner', 'admin'], risk: 'external', ...t }));

/** Every write tool, in a fixed order: internal, then external. */
export const ALL_WRITES = [...WRITE_TOOLS, ...EXTERNAL_TOOLS];
export const WRITES = new Map(ALL_WRITES.map((t) => [t.name, t]));

/* ======================================================= the life cycle */

/** An action as the panel draws it: what it does, its state, and why it waits (never the undo plan's internals). */
export function publicAction(a) {
  if (!a) return null;
  return {
    id: a.id, thread_id: a.thread_id ?? null, tool: a.tool, risk: a.risk, status: a.status, summary: a.summary, payload: a.payload,
    reason: a.result?.reason ?? null, error: a.error ?? null, undoable: a.status === 'executed' && a.risk === 'internal' && !!a.result?.undo,
    link: googleLink(a.result?.data?.link), meet: googleLink(a.result?.data?.meet),
  };
}

/** A link this server made to the person's own Gmail or Calendar — nothing else is passed on as a link. */
export function googleLink(v) {
  try {
    const u = new URL(String(v ?? ''));
    return u.protocol === 'https:' && ['mail.google.com', 'calendar.google.com', 'www.google.com', 'meet.google.com'].includes(u.hostname) ? u.href : null;
  } catch { return null; }
}

const actionError = (e) => {
  if (e instanceof WriteDbError) return { error: e.detail, text: `database: ${e.detail.message ?? e.detail.code ?? e.detail.status}` };
  if (e instanceof GoogleError) return { error: { code: e.code, message: e.message }, text: e.message };
  if (e instanceof WriteInputError) return { error: { message: e.message }, text: e.message };
  console.error('[jarvis] write', e?.name ?? 'error');
  return { error: { message: 'The Portal could not be reached.' }, text: 'The Portal could not be reached.' };
};

/** Runs a write: the database changes, then the action row says so (executed, with its undo; or failed). */
async function run(ctx, tool, args) {
  try {
    const out = await tool.execute(ctx, args);
    return { ok: true, out };
  } catch (e) {
    return { ok: false, ...actionError(e) };
  }
}

/**
 * A write tool called by Jarvis → { content, is_error, label, action }.
 * `ctx.tainted`: this turn read outsiders' text, so even an internal write waits.
 */
export async function writeTool(tool, input, ctx) {
  let args;
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new WriteInputError('the input must be an object');
    args = tool.parse(input);
  } catch (e) {
    return { content: JSON.stringify({ error: `INVALID_INPUT: ${e instanceof WriteInputError ? e.message : 'invalid input'}` }), is_error: true, label: `${tool.name}: hibás paraméter` };
  }
  const summary = tool.summary(args).slice(0, 1000);
  const waits = tool.risk === 'external' || ctx.tainted;
  const base = { thread_id: ctx.threadId ?? null, tool: tool.name, risk: tool.risk, payload: args, summary };

  if (waits) {
    const reason = tool.risk === 'external' ? 'external' : 'outside_text';
    const row = await rest(ctx.token, 'POST', '/jarvis_actions', { body: { ...base, status: 'pending', result: { reason } }, prefer: 'return=representation' });
    if (!row.ok) return { content: JSON.stringify({ error: 'The action could not be stored.' }), is_error: true, label: `${tool.name}: nem sikerült` };
    const action = row.body[0];
    return {
      content: JSON.stringify({
        status: 'waiting_for_approval', action_id: action.id, summary,
        note: reason === 'external'
          ? 'This acts outside the Portal: it runs only once a person approves it in the panel.'
          : 'This turn read text that outsiders wrote, so this write waits for a person to approve it in the panel.',
      }),
      is_error: false, label: `Jóváhagyásra vár · ${summary.slice(0, 60)}`, action,
    };
  }

  const done = await run(ctx, tool, args);
  const stored = await rest(ctx.token, 'POST', '/jarvis_actions', {
    body: done.ok
      ? { ...base, status: 'executed', result: { data: done.out.data, undo: done.out.undo ?? null } }
      : { ...base, status: 'failed', error: done.text.slice(0, 2000) },
    prefer: 'return=representation',
  });
  const action = stored.ok ? stored.body[0] : null;
  if (!stored.ok) console.error('[jarvis] action log', stored.status);
  if (!done.ok) return { content: JSON.stringify({ error: done.error }), is_error: true, label: `${tool.name}: nem sikerült`, action };
  return { content: JSON.stringify({ status: 'done', action_id: action?.id ?? null, ...done.out.data }), is_error: false, label: done.out.label, action };
}

/** Puts back what an executed action changed. */
async function undoWrite(ctx, undo) {
  if (!undo?.table || !undo?.id) throw new WriteInputError('This action cannot be undone.');
  if (undo.set) {
    const set = Object.fromEntries(Object.entries(undo.set).map(([k, v]) => [k, isNow(v) ? new Date().toISOString() : v]));
    await patch(ctx, undo.table, undo.id, set);
  } else {
    await remove(ctx, undo.table, undo.id);
  }
}

/**
 * A person's decision on an action: 'approve' (optionally with an edited
 * payload, checked again), 'reject', or 'undo' (an executed internal write).
 * → { status, body } for the HTTP answer.
 */
export async function decide(ctx, op, actionId, editedPayload) {
  if (!UUID.test(String(actionId ?? ''))) return { status: 400, body: { ok: false, code: 'INPUT' } };
  const found = await rest(ctx.token, 'GET', '/jarvis_actions', { params: [['select', '*'], ['id', `eq.${actionId}`]] });
  const action = found.ok && Array.isArray(found.body) ? found.body[0] : null;
  if (!action) return { status: 404, body: { ok: false, code: 'ACTION' } };
  const tool = WRITES.get(action.tool);
  if (!tool || !tool.roles.includes(ctx.role)) return { status: 409, body: { ok: false, code: 'TOOL' } };
  const save = async (row) => {
    const res = await rest(ctx.token, 'PATCH', '/jarvis_actions', { params: [['id', `eq.${action.id}`]], body: row, prefer: 'return=representation' });
    return res.ok && Array.isArray(res.body) && res.body[0] ? res.body[0] : null;
  };

  if (op === 'reject') {
    if (action.status !== 'pending') return { status: 409, body: { ok: false, code: 'STATE', action: publicAction(action) } };
    const saved = await save({ status: 'rejected' });
    return saved ? { status: 200, body: { ok: true, action: publicAction(saved) } } : { status: 502, body: { ok: false, code: 'SAVE' } };
  }

  if (op === 'approve') {
    if (action.status !== 'pending' && action.status !== 'failed') return { status: 409, body: { ok: false, code: 'STATE', action: publicAction(action) } };
    let args;
    try {
      args = tool.parse(editedPayload && typeof editedPayload === 'object' && !Array.isArray(editedPayload) ? editedPayload : action.payload);
    } catch (e) {
      return { status: 422, body: { ok: false, code: 'INVALID_INPUT', message: e instanceof WriteInputError ? e.message : 'invalid input' } };
    }
    const summary = tool.summary(args).slice(0, 1000);
    // What was approved is what runs: the payload is fixed with the approval.
    const approved = await save(action.status === 'pending' ? { status: 'approved', payload: args, summary } : { status: 'approved' });
    if (!approved) return { status: 502, body: { ok: false, code: 'SAVE' } };
    const done = await run(ctx, tool, approved.payload);
    const saved = await save(done.ok
      ? { status: 'executed', result: { ...(action.result ?? {}), data: done.out.data, undo: done.out.undo ?? null } }
      : { status: 'failed', error: done.text.slice(0, 2000) });
    return { status: 200, body: { ok: done.ok, action: publicAction(saved ?? approved), label: done.ok ? done.out.label : done.text } };
  }

  if (op === 'undo') {
    if (action.status !== 'executed' || action.risk !== 'internal') return { status: 409, body: { ok: false, code: 'STATE', action: publicAction(action) } };
    try {
      await undoWrite(ctx, action.result?.undo);
    } catch (e) {
      const { text } = actionError(e);
      return { status: 422, body: { ok: false, code: 'UNDO', message: text } };
    }
    const saved = await save({ status: 'reverted', result: { ...(action.result ?? {}), reverted_at: new Date().toISOString(), reverted_by: ctx.userId } });
    return saved ? { status: 200, body: { ok: true, action: publicAction(saved) } } : { status: 502, body: { ok: false, code: 'SAVE' } };
  }

  return { status: 400, body: { ok: false, code: 'OP' } };
}

// =============================================================================
// Jarvis — the tools (JARVIS_SPEC.md §3, phase 3: reading only)
//
// No raw SQL and no generic table access: each tool takes a few checked
// parameters and makes fixed PostgREST calls WITH THE CALLER'S TOKEN, so RLS
// decides what comes back — an admin gets no project, payment or meeting, the
// owner gets everything the Portal shows them. The registry is filtered by
// role (toolsFor), so the client version (round 2) gets its own narrow set.
//
// The list and its order are fixed: the tool definitions are part of the
// cached prompt prefix and of the check the API runs on thinking blocks.
//
// Each result is JSON, at most MAX_RESULT characters, plus a one-line
// Hungarian label for the Portal's tool rows ("Pipeline lekérdezve · 12 deal").
// Text that people wrote (form messages, notes, e-mail snippets) is data: the
// system prompt says so, and nothing here acts on it.
// =============================================================================
import { ENTITY_TYPES, UUID, budapestDate, budapestMidnight, rest } from './jarvis-lib.mjs';

const MAX_RESULT = 20_000;
const ROLES_STAFF = ['owner', 'admin'];

export class ToolInputError extends Error {}

/* ========================================================== input checks */

const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

function text(v, field, { max = 200, required = false } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw new ToolInputError(`${field} is required`);
    return null;
  }
  if (typeof v !== 'string') throw new ToolInputError(`${field} must be a string`);
  const s = v.trim().slice(0, max);
  if (required && !s) throw new ToolInputError(`${field} is required`);
  return s || null;
}
function id(v, field, { required = false } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw new ToolInputError(`${field} is required`);
    return null;
  }
  if (typeof v !== 'string' || !UUID.test(v)) throw new ToolInputError(`${field} must be a uuid`);
  return v.toLowerCase();
}
function date(v, field) {
  if (v === undefined || v === null || v === '') return null;
  if (!isDate(v)) throw new ToolInputError(`${field} must be a date, YYYY-MM-DD`);
  return v;
}
function oneOf(v, field, list) {
  if (v === undefined || v === null || v === '') return null;
  if (!list.includes(v)) throw new ToolInputError(`${field} must be one of: ${list.join(', ')}`);
  return v;
}
function count(v, field, { min = 1, max = 50, fallback = 20 } = {}) {
  if (v === undefined || v === null) return fallback;
  const n = Number(v);
  if (!Number.isInteger(n)) throw new ToolInputError(`${field} must be an integer`);
  return Math.min(max, Math.max(min, n));
}
const flag = (v) => v === true;

/** A search term safe inside a PostgREST or=() filter: quoted, with its wildcards. */
function like(term) {
  const clean = term.replace(/["\\*%]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!clean) throw new ToolInputError('text must contain letters or digits');
  return `"*${clean}*"`;
}

/* ============================================================== results */

class DbError extends Error {
  constructor(res) {
    super('db');
    const b = res.body && typeof res.body === 'object' ? res.body : {};
    this.detail = { status: res.status, code: b.code ?? null, message: b.message ?? null };
  }
}

async function get(ctx, path, params) {
  const res = await rest(ctx.token, 'GET', path, { params });
  if (!res.ok) throw new DbError(res);
  return Array.isArray(res.body) ? res.body : [];
}
async function rpc(ctx, fn, args = {}) {
  const res = await rest(ctx.token, 'POST', `/rpc/${fn}`, { body: args });
  if (!res.ok) throw new DbError(res);
  return Array.isArray(res.body) ? res.body : res.body;
}

/** JSON of at most MAX_RESULT characters: the longest list is halved until it fits, and it says so. */
export function fit(value) {
  let out = JSON.stringify(value);
  if (out.length <= MAX_RESULT) return out;
  const copy = structuredClone(value);
  for (let i = 0; i < 12 && out.length > MAX_RESULT; i += 1) {
    const lists = Object.entries(copy).filter(([, v]) => Array.isArray(v) && v.length > 1);
    if (lists.length === 0) break;
    const [key, list] = lists.sort((a, b) => JSON.stringify(b[1]).length - JSON.stringify(a[1]).length)[0];
    copy[key] = list.slice(0, Math.ceil(list.length / 2));
    copy.truncated = { ...(copy.truncated ?? {}), [key]: `showing ${copy[key].length}; ask with narrower filters for the rest` };
    out = JSON.stringify(copy);
  }
  return out.length <= MAX_RESULT ? out : `${out.slice(0, MAX_RESULT)}… [cut]`;
}

const today = () => budapestDate();
const plural = (n, word) => `${n} ${word}`;

/* ================================================================ tools */

const LEAD_STATUS = ['new', 'contacted', 'qualified', 'proposal', 'won', 'lost', 'spam'];
const STAGES = ['qualified', 'discovery', 'proposal', 'negotiation', 'won', 'lost'];
const PROJECT_STATUS = ['discovery', 'design', 'build', 'launch', 'care', 'archived', 'cancelled'];
const REPORT_SECTIONS = ['collected', 'client', 'service', 'mrr', 'forecast', 'attribution'];

const LEAD_COLS = 'id,name,company,email,phone,status,source,form_type,service_interest,budget_range,timeframe,created_at';
const OPP_COLS = 'id,title,company_name,contact_name,contact_email,stage,estimated_value,currency,probability,expected_close_on,next_action,next_action_on,organization_id,lead_id,updated_at';
const PROJECT_COLS = 'id,name,status,service,start_date,target_date,value,currency,payment_state,billing,monthly_fee,completed_at,organization:organizations(id,name)';

const schema = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });

const TOOLS = [
  {
    name: 'crm_search',
    description: 'Search leads, clients (companies and their contacts), deals and projects by name, company, e-mail, website or title. Use it to find the id of a record the user names, then get_record for the details.',
    input_schema: schema({
      text: { type: 'string', description: 'What to look for: a name, company, e-mail address, domain or title.' },
      types: { type: 'array', items: { type: 'string', enum: ENTITY_TYPES }, description: 'Limit the search to these kinds. Default: all four.' },
    }, ['text']),
    parse: (i) => {
      const types = Array.isArray(i.types) && i.types.length > 0 ? [...new Set(i.types.map((t) => oneOf(t, 'types', ENTITY_TYPES)))] : ENTITY_TYPES;
      return { text: text(i.text, 'text', { max: 100, required: true }), types };
    },
    run: async (ctx, { text: t, types }) => {
      const q = like(t);
      const out = {};
      const jobs = [];
      if (types.includes('lead')) {
        jobs.push(get(ctx, '/leads', [['select', 'id,name,company,email,status,source,created_at'], ['trashed_at', 'is.null'],
          ['or', `(name.ilike.${q},company.ilike.${q},email.ilike.${q},website.ilike.${q})`], ['order', 'created_at.desc'], ['limit', '10']])
          .then((r) => { out.leads = r; }));
      }
      if (types.includes('client')) {
        jobs.push(get(ctx, '/organizations', [['select', 'id,name,website,status'], ['archived_at', 'is.null'],
          ['or', `(name.ilike.${q},website.ilike.${q})`], ['order', 'name.asc'], ['limit', '10']]).then((r) => { out.clients = r; }));
        jobs.push(get(ctx, '/client_contacts', [['select', 'organization_id,name,role,email,phone'],
          ['or', `(name.ilike.${q},email.ilike.${q})`], ['limit', '10']]).then((r) => { out.client_contacts = r; }));
      }
      if (types.includes('opportunity')) {
        jobs.push(get(ctx, '/opportunities', [['select', 'id,title,company_name,contact_name,stage,estimated_value,currency,next_action_on'],
          ['archived_at', 'is.null'], ['or', `(title.ilike.${q},company_name.ilike.${q},contact_name.ilike.${q},contact_email.ilike.${q})`],
          ['order', 'updated_at.desc'], ['limit', '10']]).then((r) => { out.opportunities = r; }));
      }
      if (types.includes('project')) {
        jobs.push(get(ctx, '/projects', [['select', 'id,name,status,target_date,organization:organizations(name)'], ['archived_at', 'is.null'],
          ['or', `(name.ilike.${q},service.ilike.${q})`], ['order', 'updated_at.desc'], ['limit', '10']]).then((r) => { out.projects = r; }));
      }
      await Promise.all(jobs);
      const hits = Object.values(out).reduce((n, list) => n + list.length, 0);
      return { data: out, label: `Keresés: „${t}” · ${plural(hits, 'találat')}` };
    },
  },
  {
    name: 'get_record',
    description: 'One record with what belongs to it: a lead with its notes, activity, e-mails and deals; a deal with its notes, activity and e-mails; a client with contacts, deals, projects, notes, activity and e-mails; a project with checkpoints, notes, upcoming meetings and payments.',
    input_schema: schema({
      entity_type: { type: 'string', enum: ENTITY_TYPES },
      id: { type: 'string', description: 'The record id (uuid).' },
    }, ['entity_type', 'id']),
    parse: (i) => {
      const type = oneOf(i.entity_type, 'entity_type', ENTITY_TYPES);
      if (!type) throw new ToolInputError('entity_type is required');
      return { type, id: id(i.id, 'id', { required: true }) };
    },
    run: async (ctx, { type, id: rid }) => {
      const recent = (path, col, select, order) => get(ctx, path, [['select', select], [col, `eq.${rid}`], ['order', order], ['limit', '20']]);
      const emails = (col) => get(ctx, '/email_messages', [['select', 'direction,from_email,from_name,to_emails,subject,snippet,sent_at'], [col, `eq.${rid}`], ['order', 'sent_at.desc'], ['limit', '10']]);
      let data;
      let name;
      if (type === 'lead') {
        const [rows, notes, activity, mail, deals] = await Promise.all([
          get(ctx, '/leads', [['select', `${LEAD_COLS},website,message,locale,source_route,updated_at,trashed_at`], ['id', `eq.${rid}`]]),
          recent('/lead_notes', 'lead_id', 'body,created_at', 'created_at.desc'),
          recent('/interactions', 'lead_id', 'kind,summary,occurred_at', 'occurred_at.desc'),
          emails('lead_id'),
          get(ctx, '/opportunities', [['select', 'id,title,stage,estimated_value,currency'], ['lead_id', `eq.${rid}`], ['limit', '5']]),
        ]);
        if (!rows[0]) return null;
        data = { lead: rows[0], notes, activity, emails: mail, opportunities: deals };
        name = rows[0].name || rows[0].company || rows[0].email;
      } else if (type === 'opportunity') {
        const [rows, notes, activity, mail] = await Promise.all([
          get(ctx, '/opportunities', [['select', `${OPP_COLS},service,source,lost_reason,lost_note,won_at,lost_at,archived_at,organization:organizations(id,name)`], ['id', `eq.${rid}`]]),
          get(ctx, '/record_notes', [['select', 'body,created_at'], ['entity_type', 'eq.opportunity'], ['entity_id', `eq.${rid}`], ['order', 'created_at.desc'], ['limit', '20']]),
          recent('/interactions', 'opportunity_id', 'kind,summary,occurred_at', 'occurred_at.desc'),
          emails('opportunity_id'),
        ]);
        if (!rows[0]) return null;
        data = { opportunity: rows[0], notes, activity, emails: mail };
        name = rows[0].title;
      } else if (type === 'client') {
        const [rows, contacts, deals, projects, notes, activity, mail] = await Promise.all([
          get(ctx, '/organizations', [['select', 'id,name,website,status,primary_service,acquisition_source,created_at,archived_at'], ['id', `eq.${rid}`]]),
          get(ctx, '/client_contacts', [['select', 'name,role,email,phone,is_primary'], ['organization_id', `eq.${rid}`], ['order', 'is_primary.desc']]),
          get(ctx, '/opportunities', [['select', 'id,title,stage,estimated_value,currency,next_action,next_action_on'], ['organization_id', `eq.${rid}`], ['archived_at', 'is.null'], ['order', 'updated_at.desc'], ['limit', '20']]),
          get(ctx, '/projects', [['select', 'id,name,status,target_date,value,currency,payment_state'], ['organization_id', `eq.${rid}`], ['archived_at', 'is.null'], ['limit', '20']]),
          get(ctx, '/record_notes', [['select', 'body,created_at'], ['entity_type', 'eq.client'], ['entity_id', `eq.${rid}`], ['order', 'created_at.desc'], ['limit', '20']]),
          recent('/interactions', 'organization_id', 'kind,summary,occurred_at', 'occurred_at.desc'),
          emails('organization_id'),
        ]);
        if (!rows[0]) return null;
        data = { client: rows[0], contacts, opportunities: deals, projects, notes, activity, emails: mail };
        name = rows[0].name;
      } else {
        const from = budapestMidnight(today());
        const [rows, checkpoints, notes, meetings, payments] = await Promise.all([
          get(ctx, '/projects', [['select', `${PROJECT_COLS},description,estimated_hours,actual_hours,invoiced_amount,paid_amount,archived_at`], ['id', `eq.${rid}`]]),
          get(ctx, '/project_milestones', [['select', 'title,state,due_on,completed_at,assignee,next_step,blocked_reason'], ['project_id', `eq.${rid}`], ['order', 'position.asc']]),
          get(ctx, '/record_notes', [['select', 'body,created_at'], ['entity_type', 'eq.project'], ['entity_id', `eq.${rid}`], ['order', 'created_at.desc'], ['limit', '20']]),
          get(ctx, '/project_meetings', [['select', 'title,starts_at,ends_at,join_url,location'], ['project_id', `eq.${rid}`], ['cancelled_at', 'is.null'], ['starts_at', `gte.${from}`], ['order', 'starts_at.asc'], ['limit', '10']]),
          rpc(ctx, 'project_payment_overview', { p_project: rid }),
        ]);
        if (!rows[0]) return null;
        data = { project: rows[0], checkpoints, notes, upcoming_meetings: meetings, payments };
        name = rows[0].name;
      }
      return { data, label: `Rekord megnyitva · ${String(name ?? '').slice(0, 60) || type}` };
    },
  },
  {
    name: 'list_leads',
    description: 'Leads from the website forms and other sources, newest first. Trashed leads are left out.',
    input_schema: schema({
      status: { type: 'string', enum: LEAD_STATUS },
      source: { type: 'string', description: 'e.g. website' },
      created_after: { type: 'string', description: 'YYYY-MM-DD, inclusive' },
      created_before: { type: 'string', description: 'YYYY-MM-DD, exclusive' },
      limit: { type: 'integer', minimum: 1, maximum: 50 },
    }),
    parse: (i) => ({
      status: oneOf(i.status, 'status', LEAD_STATUS), source: text(i.source, 'source', { max: 60 }),
      after: date(i.created_after, 'created_after'), before: date(i.created_before, 'created_before'), limit: count(i.limit, 'limit'),
    }),
    run: async (ctx, a) => {
      const params = [['select', LEAD_COLS], ['trashed_at', 'is.null']];
      if (a.status) params.push(['status', `eq.${a.status}`]);
      if (a.source) params.push(['source', `eq.${a.source}`]);
      if (a.after) params.push(['created_at', `gte.${budapestMidnight(a.after)}`]);
      if (a.before) params.push(['created_at', `lt.${budapestMidnight(a.before)}`]);
      params.push(['order', 'created_at.desc'], ['limit', String(a.limit)]);
      const leads = await get(ctx, '/leads', params);
      return { data: { leads }, label: `Leadek lekérdezve · ${plural(leads.length, 'lead')}` };
    },
  },
  {
    name: 'list_opportunities',
    description: 'Deals (sales opportunities). By default the open ones (not won or lost), with the most urgent next action first.',
    input_schema: schema({
      stage: { type: 'string', enum: STAGES },
      include_closed: { type: 'boolean', description: 'Also won and lost deals.' },
      next_action_overdue: { type: 'boolean', description: 'Only deals whose next action date has passed.' },
      closing_before: { type: 'string', description: 'Only deals expected to close before this date, YYYY-MM-DD.' },
      limit: { type: 'integer', minimum: 1, maximum: 50 },
    }),
    parse: (i) => ({
      stage: oneOf(i.stage, 'stage', STAGES), closed: flag(i.include_closed), overdue: flag(i.next_action_overdue),
      closing: date(i.closing_before, 'closing_before'), limit: count(i.limit, 'limit'),
    }),
    run: async (ctx, a) => {
      const params = [['select', `${OPP_COLS},organization:organizations(name)`], ['archived_at', 'is.null']];
      if (a.stage) params.push(['stage', `eq.${a.stage}`]);
      else if (!a.closed) params.push(['stage', 'not.in.(won,lost)']);
      if (a.overdue) params.push(['next_action_on', `lt.${today()}`]);
      if (a.closing) params.push(['expected_close_on', `lt.${a.closing}`]);
      params.push(['order', 'next_action_on.asc.nullslast,updated_at.desc'], ['limit', String(a.limit)]);
      const opportunities = await get(ctx, '/opportunities', params);
      return { data: { today: today(), opportunities }, label: `Dealek lekérdezve · ${plural(opportunities.length, 'deal')}` };
    },
  },
  {
    name: 'list_projects',
    description: 'Projects that are not archived, with their late checkpoints (due date passed, not done). Owner only: for anyone else the list is empty.',
    input_schema: schema({
      status: { type: 'string', enum: PROJECT_STATUS },
      late_only: { type: 'boolean', description: 'Only projects with a late checkpoint or a passed target date.' },
      limit: { type: 'integer', minimum: 1, maximum: 50 },
    }),
    parse: (i) => ({ status: oneOf(i.status, 'status', PROJECT_STATUS), late: flag(i.late_only), limit: count(i.limit, 'limit', { fallback: 30 }) }),
    run: async (ctx, a) => {
      const params = [['select', PROJECT_COLS], ['archived_at', 'is.null']];
      if (a.status) params.push(['status', `eq.${a.status}`]);
      params.push(['order', 'target_date.asc.nullslast'], ['limit', String(a.limit)]);
      const [projects, late] = await Promise.all([
        get(ctx, '/projects', params),
        get(ctx, '/project_milestones', [['select', 'project_id,title,state,due_on'], ['due_on', `lt.${today()}`], ['state', 'neq.done'], ['order', 'due_on.asc'], ['limit', '200']]),
      ]);
      const byProject = new Map();
      for (const m of late) byProject.set(m.project_id, [...(byProject.get(m.project_id) ?? []), { title: m.title, state: m.state, due_on: m.due_on }]);
      let list = projects.map((p) => ({ ...p, late_checkpoints: byProject.get(p.id) ?? [] }));
      if (a.late) list = list.filter((p) => p.late_checkpoints.length > 0 || (p.target_date && p.target_date < today() && !p.completed_at));
      return { data: { today: today(), projects: list }, label: `Projektek lekérdezve · ${plural(list.length, 'projekt')}` };
    },
  },
  {
    name: 'pipeline_summary',
    description: 'The sales pipeline in figures: open deals per stage bucket and currency, with value and probability-weighted value.',
    input_schema: schema({}),
    parse: () => ({}),
    run: async (ctx) => {
      const rows = await rpc(ctx, 'portal_sales_summary');
      const items = (rows ?? []).reduce((n, r) => n + (Number(r.items) || 0), 0);
      return { data: { pipeline: rows }, label: `Pipeline lekérdezve · ${plural(items, 'deal')}` };
    },
  },
  {
    name: 'revenue_report',
    description: 'Revenue, per currency (never converted): collected per month (overall, per client, per service), MRR of monthly contracts, the 6-month forecast (scheduled instalments, monthly fees, weighted pipeline), and lead-to-deal attribution by source. Money figures are owner only.',
    input_schema: schema({
      sections: { type: 'array', items: { type: 'string', enum: REPORT_SECTIONS }, description: 'Default: collected, mrr, forecast.' },
      months: { type: 'integer', minimum: 1, maximum: 36, description: 'How many past months of the monthly sections. Default 6.' },
    }),
    parse: (i) => ({
      sections: Array.isArray(i.sections) && i.sections.length > 0 ? [...new Set(i.sections.map((s) => oneOf(s, 'sections', REPORT_SECTIONS)))] : ['collected', 'mrr', 'forecast'],
      months: count(i.months, 'months', { max: 36, fallback: 6 }),
    }),
    run: async (ctx, a) => {
      const day = today();
      const from = new Date(`${day.slice(0, 7)}-01T00:00:00Z`);
      from.setUTCMonth(from.getUTCMonth() - (a.months - 1));
      const since = from.toISOString().slice(0, 10);
      const wantReport = a.sections.some((s) => s !== 'attribution');
      const [report, attribution] = await Promise.all([
        wantReport ? rpc(ctx, 'portal_revenue_report', { p_today: day }) : [],
        a.sections.includes('attribution') ? rpc(ctx, 'portal_revenue_attribution', { dimension: 'source' }) : null,
      ]);
      const data = { today: day };
      for (const s of a.sections.filter((x) => x !== 'attribution')) {
        data[s] = (report ?? []).filter((r) => r.section === s && (s === 'forecast' || !r.month || r.month >= since))
          .map(({ section, ...r }) => r);
      }
      if (attribution) data.attribution = attribution;
      return { data, label: `Bevételi riport · ${a.sections.join(', ')}` };
    },
  },
  {
    name: 'payment_overview',
    description: 'Payments: per project the contracted, scheduled, paid, remaining and overdue amounts and the next due date. Without project_id, every live project, the most overdue first. Owner only.',
    input_schema: schema({ project_id: { type: 'string', description: 'One project (uuid). Omit for all.' } }),
    parse: (i) => ({ project: id(i.project_id, 'project_id') }),
    run: async (ctx, a) => {
      const rows = (await rpc(ctx, 'project_payment_overview', { p_project: a.project })) ?? [];
      const list = a.project ? rows : rows.filter((r) => !r.archived).sort((x, y) => (Number(y.overdue) || 0) - (Number(x.overdue) || 0));
      const overdue = list.filter((r) => Number(r.overdue) > 0).length;
      return { data: { today: today(), projects: list }, label: `Kintlévőségek · ${plural(list.length, 'projekt')}, ${overdue} lejárt` };
    },
  },
  {
    name: 'open_alerts',
    description: 'The open alerts on the Today page (unanswered leads, stale deals, overdue instalments, deadlines soon), newest first.',
    input_schema: schema({}),
    parse: () => ({}),
    run: async (ctx) => {
      const alerts = await get(ctx, '/automation_alerts', [['select', 'kind,title,detail,due_on,amount,currency,lead_id,opportunity_id,project_id,created_at'],
        ['resolved_at', 'is.null'], ['done_at', 'is.null'], ['order', 'created_at.desc'], ['limit', '50']]);
      return { data: { alerts }, label: `Nyitott figyelmeztetések · ${alerts.length}` };
    },
  },
  {
    name: 'email_search',
    description: 'E-mails exchanged with leads, clients and deal contacts (subject, addresses, date and a short snippet; never the body), newest first. Filter by text and/or one record.',
    input_schema: schema({
      text: { type: 'string', description: 'Words in the subject, snippet or sender.' },
      lead_id: { type: 'string' }, organization_id: { type: 'string' }, opportunity_id: { type: 'string' },
      limit: { type: 'integer', minimum: 1, maximum: 50 },
    }),
    parse: (i) => ({
      text: text(i.text, 'text', { max: 100 }), lead: id(i.lead_id, 'lead_id'), org: id(i.organization_id, 'organization_id'),
      deal: id(i.opportunity_id, 'opportunity_id'), limit: count(i.limit, 'limit'),
    }),
    run: async (ctx, a) => {
      const params = [['select', 'direction,from_email,from_name,to_emails,subject,snippet,sent_at,lead_id,organization_id,opportunity_id']];
      if (a.text) {
        const q = like(a.text);
        params.push(['or', `(subject.ilike.${q},snippet.ilike.${q},from_email.ilike.${q},from_name.ilike.${q})`]);
      }
      if (a.lead) params.push(['lead_id', `eq.${a.lead}`]);
      if (a.org) params.push(['organization_id', `eq.${a.org}`]);
      if (a.deal) params.push(['opportunity_id', `eq.${a.deal}`]);
      params.push(['order', 'sent_at.desc'], ['limit', String(a.limit)]);
      const emails = await get(ctx, '/email_messages', params);
      return { data: { emails }, label: `E-mailek · ${plural(emails.length, 'levél')}` };
    },
  },
  {
    name: 'list_meetings',
    description: 'Booked calls (from the booking page and the client portal) and project meetings in a date range, in time order. Default: today and the next 7 days. Free time slots are not computed here.',
    input_schema: schema({
      from: { type: 'string', description: 'YYYY-MM-DD, inclusive. Default today.' },
      to: { type: 'string', description: 'YYYY-MM-DD, inclusive. Default today + 7 days.' },
    }),
    parse: (i) => {
      const from = date(i.from, 'from') ?? today();
      const to = date(i.to, 'to') ?? budapestDate(new Date(`${from}T12:00:00Z`), 7);
      if (to < from) throw new ToolInputError('to must not be before from');
      return { from, to };
    },
    run: async (ctx, a) => {
      const start = budapestMidnight(a.from);
      const end = budapestMidnight(budapestDate(new Date(`${a.to}T12:00:00Z`), 1));
      const [bookings, meetings] = await Promise.all([
        get(ctx, '/bookings', [['select', 'kind,starts_at,ends_at,guest_name,guest_company,topic,meet_url,lead_id,organization_id,project_id'],
          ['status', 'eq.confirmed'], ['starts_at', `gte.${start}`], ['starts_at', `lt.${end}`], ['order', 'starts_at.asc'], ['limit', '100']]),
        get(ctx, '/project_meetings', [['select', 'title,starts_at,ends_at,join_url,location,project:projects(id,name)'],
          ['cancelled_at', 'is.null'], ['starts_at', `gte.${start}`], ['starts_at', `lt.${end}`], ['order', 'starts_at.asc'], ['limit', '100']]),
      ]);
      return { data: { from: a.from, to: a.to, bookings, project_meetings: meetings }, label: `Naptár · ${plural(bookings.length + meetings.length, 'esemény')}` };
    },
  },
  {
    name: 'time_summary',
    description: 'Hours worked in a date range: the total, per project or label, and per person, plus the entries. Default: the current month so far.',
    input_schema: schema({
      from: { type: 'string', description: 'YYYY-MM-DD, inclusive. Default the first of this month.' },
      to: { type: 'string', description: 'YYYY-MM-DD, inclusive. Default today.' },
    }),
    parse: (i) => {
      const from = date(i.from, 'from') ?? `${today().slice(0, 7)}-01`;
      const to = date(i.to, 'to') ?? today();
      if (to < from) throw new ToolInputError('to must not be before from');
      return { from, to };
    },
    run: async (ctx, a) => {
      const entries = await get(ctx, '/time_entries', [['select', 'work_date,hours,project_id,label,note,user_id'],
        ['work_date', `gte.${a.from}`], ['work_date', `lte.${a.to}`], ['order', 'work_date.desc'], ['limit', '1000']]);
      const projectIds = [...new Set(entries.map((e) => e.project_id).filter(Boolean))];
      const userIds = [...new Set(entries.map((e) => e.user_id).filter(Boolean))];
      const [projects, people] = await Promise.all([
        projectIds.length ? get(ctx, '/projects', [['select', 'id,name'], ['id', `in.(${projectIds.join(',')})`]]) : [],
        userIds.length ? get(ctx, '/profiles', [['select', 'id,full_name,email'], ['id', `in.(${userIds.join(',')})`]]) : [],
      ]);
      const pName = new Map(projects.map((p) => [p.id, p.name]));
      const uName = new Map(people.map((p) => [p.id, p.full_name || p.email]));
      const add = (map, key, h) => map.set(key, Math.round(((map.get(key) ?? 0) + h) * 100) / 100);
      const byWork = new Map();
      const byPerson = new Map();
      let total = 0;
      for (const e of entries) {
        const h = Number(e.hours) || 0;
        total += h;
        add(byWork, e.project_id ? (pName.get(e.project_id) ?? `projekt ${e.project_id}`) : (e.label || '—'), h);
        add(byPerson, uName.get(e.user_id) ?? e.user_id, h);
      }
      return {
        data: {
          from: a.from, to: a.to, total_hours: Math.round(total * 100) / 100,
          by_work: Object.fromEntries(byWork), by_person: Object.fromEntries(byPerson),
          entries: entries.map((e) => ({ work_date: e.work_date, hours: e.hours, work: e.project_id ? pName.get(e.project_id) ?? null : e.label, note: e.note })),
        },
        label: `Munkaidő · ${(Math.round(total * 10) / 10).toLocaleString('hu-HU')} óra`,
      };
    },
  },
].map((t) => ({ roles: ROLES_STAFF, ...t }));

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

/** The tool definitions one role may use, in a fixed order, as the Messages API takes them. */
export function toolsFor(role) {
  return TOOLS.filter((t) => t.roles.includes(role)).map(({ name, description, input_schema }) => ({
    name, description, input_schema, eager_input_streaming: true,
  }));
}

/**
 * One tool call → { content, is_error, label }. The input is checked first:
 * with eager input streaming the API does not validate it, and the model's
 * input is untrusted anyway. Nothing here throws.
 */
export async function runTool(name, input, ctx) {
  const tool = BY_NAME.get(name);
  if (!tool || !tool.roles.includes(ctx.role)) {
    return { content: JSON.stringify({ error: `No tool named ${name}. Available: ${toolsFor(ctx.role).map((t) => t.name).join(', ')}` }), is_error: true, label: `Ismeretlen tool: ${String(name).slice(0, 40)}` };
  }
  let args;
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ToolInputError('the input must be an object');
    args = tool.parse(input);
  } catch (e) {
    const message = e instanceof ToolInputError ? e.message : 'invalid input';
    return { content: JSON.stringify({ error: `INVALID_INPUT: ${message}` }), is_error: true, label: `${name}: hibás paraméter` };
  }
  try {
    const out = await tool.run(ctx, args);
    if (out === null) {
      return { content: JSON.stringify({ error: 'No such record, or this account cannot see it.' }), is_error: true, label: 'Nincs ilyen rekord' };
    }
    return { content: fit(out.data), is_error: false, label: out.label };
  } catch (e) {
    if (e instanceof DbError) return { content: JSON.stringify({ error: e.detail }), is_error: true, label: `${name}: adatbázis-hiba` };
    if (e instanceof ToolInputError) return { content: JSON.stringify({ error: `INVALID_INPUT: ${e.message}` }), is_error: true, label: `${name}: hibás paraméter` };
    console.error('[jarvis] tool', name, e?.name ?? 'error');
    return { content: JSON.stringify({ error: 'The Portal could not be reached. Try again.' }), is_error: true, label: `${name}: nem sikerült` };
  }
}

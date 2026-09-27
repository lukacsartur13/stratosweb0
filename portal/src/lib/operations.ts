import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, isConfigured } from '@/lib/supabase';
import { useAuth } from '@/features/auth/AuthProvider';
import { closeRefusal } from '@/lib/pipeline';
import { paymentRefusal } from '@/lib/paymentRules';

/**
 * Clients and projects — the delivery half of the operating system.
 *
 * ## Two existing tables, extended
 *
 * `organizations` IS the client and `projects` IS the project. Neither was
 * replaced, because a second clients table beside a working one is exactly the
 * duplicate concept §1 forbids. What they gained in P2 is everything
 * commercial: where the client came from, what a project is worth, what it cost,
 * how long it took and where it has got to.
 *
 * ## What this is not
 *
 * Not a project management platform (§21). There are no tasks, no dependencies,
 * no assignments beyond one responsible person, no gantt and no time tracker —
 * hours are two numbers a person types (§29). The milestone list is a checklist
 * of delivery stages, and that is the whole of it.
 */

/* ================================================================ clients == */

export interface Client {
  id: string;
  name: string;
  slug: string;
  website: string | null;
  status: string;
  acquisition_source: string | null;
  acquisition_medium: string | null;
  acquisition_campaign: string | null;
  primary_service: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export const CLIENT_COLUMNS =
  'id, name, slug, website, status, acquisition_source, acquisition_medium, '
  + 'acquisition_campaign, primary_service, archived_at, created_at, updated_at';

export interface ClientContact {
  id: string;
  organization_id: string;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  is_primary: boolean;
  created_at: string;
}

/* =============================================================== projects == */

export interface Project {
  id: string;
  organization_id: string;
  name: string;
  slug: string;
  description: string | null;
  status: string;
  service: string | null;
  value: number | null;
  currency: string;
  start_date: string | null;
  target_date: string | null;
  completed_at: string | null;
  archived_at: string | null;
  opportunity_id: string | null;
  responsible_id: string | null;
  estimated_hours: number | null;
  actual_hours: number | null;
  payment_state: string;
  invoiced_amount: number | null;
  paid_amount: number | null;
  /** `paid` | `impact`. Fixed at creation (20260929000300_impact_program.sql). */
  program: string;
  /**
   * Impact only: what the donated work would have cost, whole HUF. NOT
   * revenue, not owed. `null` is "not recorded yet", which is not 0.
   */
  market_value: number | null;
  created_at: string;
  updated_at: string;
  client?: { id: string; name: string } | null;
  responsible?: { id: string; full_name: string | null; email: string } | null;
}

export const PROJECT_COLUMNS =
  'id, organization_id, name, slug, description, status, service, value, currency, '
  + 'start_date, target_date, completed_at, archived_at, opportunity_id, responsible_id, '
  + 'estimated_hours, actual_hours, payment_state, invoiced_amount, paid_amount, '
  + 'program, market_value, created_at, updated_at, '
  // The foreign key is named: `project_members` is a second (many-to-many)
  // path from projects to profiles, and real PostgREST refuses an ambiguous
  // embed with PGRST201 — every project read failed on a real stack
  // (scripts/portal-live-browser-check.mjs). A mocked API cannot show this.
  + 'client:organizations(id, name), responsible:profiles!projects_responsible_id_fkey(id, full_name, email)';

/** A checkpoint. The table kept its P2 name, `project_milestones`. */
export interface Milestone {
  id: string;
  project_id: string;
  title: string;
  position: number;
  state: string;
  due_on: string | null;
  completed_at: string | null;
  assignee: string | null;
  note: string | null;
  blocked_reason: string | null;
  next_step: string | null;
}

export const MILESTONE_COLUMNS =
  'id, project_id, title, position, state, due_on, completed_at, '
  + 'assignee, note, blocked_reason, next_step';

/** A row of `checkpoint_templates`. */
export interface CheckpointTemplate {
  id: string;
  name: string;
  service_keywords: string[];
  steps: string[];
  position: number;
  archived_at: string | null;
}

/* ================================================================= costs == */

export interface ProjectCost {
  id: string;
  project_id: string;
  description: string;
  category: string;
  amount: number;
  currency: string;
  incurred_on: string;
  created_at: string;
}

export interface ProjectLink {
  id: string;
  project_id: string;
  label: string;
  url: string;
  created_at: string;
}

/* ============================================================= the reads == */

function readError(error: { code?: string }, what: string): string {
  return error.code === '42P01'
    ? `The ${what} table does not exist yet. Run the migrations in supabase/migrations.`
    : 'The database refused the request. Check that you have permission for this data.';
}

type ReadState = 'loading' | 'ready' | 'error' | 'unconfigured';

/**
 * A bounded read of one table, with the joins its screen needs.
 *
 * Shaped like `useRows` and separate from it for one reason: these selects carry
 * embedded resources (`client:organizations(...)`), which is what turns the "one
 * query per row to get the client name" N+1 into a single request. `useRows`
 * takes a column string and would do it too, but it also hard-codes
 * `created_at` ordering and a 200 limit, and the projects list wants its own.
 */
function useTable<T>(table: string, columns: string, order: string, reloadToken: number, limit = 200) {
  const [rows, setRows] = useState<T[]>([]);
  const [state, setState] = useState<ReadState>(isConfigured ? 'loading' : 'unconfigured');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    if (!isConfigured) return setState('unconfigured');
    setState('loading');
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .order(order, { ascending: false })
      .limit(limit);

    if (error) {
      console.error(`[${table}]`, error);
      setState('error');
      setMessage(readError(error, table));
      return;
    }
    setRows((data ?? []) as T[]);
    setState('ready');
  }, [table, columns, order, reloadToken, limit]);

  useEffect(() => { void load(); }, [load]);

  return useMemo(() => ({ rows, state, message, reload: load }), [rows, state, message, load]);
}

export const useClients = (reloadToken = 0) =>
  useTable<Client>('organizations', CLIENT_COLUMNS, 'created_at', reloadToken);

export const useProjects = (reloadToken = 0) =>
  useTable<Project>('projects', PROJECT_COLUMNS, 'updated_at', reloadToken);

/**
 * One client and everything that hangs off it (§19).
 *
 * Four queries in parallel, not four sequential ones and not one per project:
 * the client, its contacts, its projects and its opportunities. Each is filtered
 * on an indexed column, so the cost is four index lookups regardless of how many
 * clients exist.
 */
export function useClientDetail(id: string | undefined, reloadToken = 0, includeProjects = true) {
  const [client, setClient] = useState<Client | null>(null);
  const [contacts, setContacts] = useState<ClientContact[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [deals, setDeals] = useState<{
    id: string; title: string; stage: string; estimated_value: number | null;
    currency: string; won_at: string | null; expected_close_on: string | null;
  }[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error' | 'unconfigured'>(
    isConfigured ? 'loading' : 'unconfigured',
  );

  const load = useCallback(async () => {
    if (!isConfigured) return setState('unconfigured');
    if (!id) return setState('missing');
    setState('loading');

    const [clientRes, contactRes, projectRes, dealRes] = await Promise.all([
      supabase.from('organizations').select(CLIENT_COLUMNS).eq('id', id).maybeSingle(),
      supabase.from('client_contacts')
        .select('id, organization_id, name, role, email, phone, is_primary, created_at')
        .eq('organization_id', id).order('is_primary', { ascending: false }),
      // Projects are the owner's alone. For anybody else the request is not
      // sent at all, rather than sent and answered with an empty list that the
      // screen would render as "no projects".
      includeProjects
        ? supabase.from('projects').select(PROJECT_COLUMNS)
          .eq('organization_id', id).order('created_at', { ascending: false }).limit(100)
        : Promise.resolve({ data: [], error: null }),
      supabase.from('opportunities')
        .select('id, title, stage, estimated_value, currency, won_at, expected_close_on')
        .eq('organization_id', id).is('archived_at', null)
        .order('updated_at', { ascending: false }).limit(100),
    ]);

    if (clientRes.error) {
      console.error('[organizations.detail]', clientRes.error);
      setState(clientRes.error.code === '22P02' ? 'missing' : 'error');
      return;
    }
    // The three related reads are allowed to fail without taking the screen
    // with them: a missing `client_contacts` table means the migration has not
    // been applied, and the client's name and projects are still worth showing.
    if (contactRes.error) console.error('[client_contacts]', contactRes.error);
    if (projectRes.error) console.error('[projects.byClient]', projectRes.error);
    if (dealRes.error) console.error('[opportunities.byClient]', dealRes.error);

    setClient((clientRes.data ?? null) as unknown as Client | null);
    setContacts((contactRes.data ?? []) as unknown as ClientContact[]);
    setProjects((projectRes.data ?? []) as unknown as Project[]);
    setDeals((dealRes.data ?? []) as never);
    setState(clientRes.data ? 'ready' : 'missing');
  }, [id, reloadToken, includeProjects]);

  useEffect(() => { void load(); }, [load]);

  return { client, contacts, projects, deals, state, reload: load };
}

/**
 * One project, its checkpoints, its costs, its links and its client's contacts.
 * Five parallel reads.
 */
export function useProjectDetail(id: string | undefined, reloadToken = 0) {
  const [project, setProject] = useState<Project | null>(null);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [contacts, setContacts] = useState<ClientContact[]>([]);
  const [costs, setCosts] = useState<ProjectCost[]>([]);
  const [links, setLinks] = useState<ProjectLink[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error' | 'unconfigured'>(
    isConfigured ? 'loading' : 'unconfigured',
  );

  const load = useCallback(async () => {
    if (!isConfigured) return setState('unconfigured');
    if (!id) return setState('missing');
    setState('loading');

    const [projectRes, msRes, costRes, linkRes] = await Promise.all([
      supabase.from('projects').select(PROJECT_COLUMNS).eq('id', id).maybeSingle(),
      supabase.from('project_milestones')
        .select(MILESTONE_COLUMNS)
        .eq('project_id', id).order('position', { ascending: true }),
      supabase.from('project_costs')
        .select('id, project_id, description, category, amount, currency, incurred_on, created_at')
        .eq('project_id', id).order('incurred_on', { ascending: false }),
      supabase.from('project_links')
        .select('id, project_id, label, url, created_at')
        .eq('project_id', id).order('created_at', { ascending: true }),
    ]);

    if (projectRes.error) {
      console.error('[projects.detail]', projectRes.error);
      setState(projectRes.error.code === '22P02' ? 'missing' : 'error');
      return;
    }
    if (msRes.error) console.error('[project_milestones]', msRes.error);
    // Costs are admin-only by policy. A team member gets an empty list rather
    // than an error, which is the correct rendering of "you may not see this":
    // the panel says the costs are not recorded FOR YOU, not that they failed.
    if (costRes.error) console.error('[project_costs]', costRes.error);
    if (linkRes.error) console.error('[project_links]', linkRes.error);

    const found = (projectRes.data ?? null) as unknown as Project | null;
    // The client's contacts, for "who is this for". One indexed read once the
    // project says which client it belongs to.
    if (found) {
      const contactRes = await supabase.from('client_contacts')
        .select('id, organization_id, name, role, email, phone, is_primary, created_at')
        .eq('organization_id', found.organization_id)
        .order('is_primary', { ascending: false }).limit(20);
      if (contactRes.error) console.error('[client_contacts.byProject]', contactRes.error);
      setContacts((contactRes.data ?? []) as unknown as ClientContact[]);
    }

    setProject(found);
    setMilestones((msRes.data ?? []) as unknown as Milestone[]);
    setCosts((costRes.data ?? []) as unknown as ProjectCost[]);
    setLinks((linkRes.data ?? []) as unknown as ProjectLink[]);
    setState(found ? 'ready' : 'missing');
  }, [id, reloadToken]);

  useEffect(() => { void load(); }, [load]);

  return { project, milestones, contacts, costs, links, state, reload: load };
}

/**
 * Every checkpoint of every project on the list, and each client's primary
 * contact — for the tracker overview.
 *
 * TWO queries for the whole screen, not two per project. §70 asks for N+1
 * patterns to be identified and fixed; the overview needs, per project, the
 * current step, done/total, lateness, waiting and blocked, and all of that is
 * derived from the checkpoint rows by `trackerOf` in lib/pipeline.ts. Only the
 * columns that derivation reads are selected.
 */
export function useTrackerRows(projectIds: string[], orgIds: string[], reloadToken = 0) {
  const [checkpoints, setCheckpoints] = useState<Record<string, Milestone[]>>({});
  const [contacts, setContacts] = useState<Record<string, ClientContact>>({});
  const key = projectIds.slice().sort().join(',');
  const orgKey = orgIds.slice().sort().join(',');

  useEffect(() => {
    let cancelled = false;
    if (!isConfigured || projectIds.length === 0) return;

    void (async () => {
      const [msRes, contactRes] = await Promise.all([
        supabase
          .from('project_milestones')
          .select('id, project_id, title, position, state, due_on, blocked_reason, next_step')
          .in('project_id', projectIds)
          .order('position', { ascending: true })
          .limit(4000),
        orgIds.length === 0
          ? Promise.resolve({ data: [], error: null })
          : supabase
            .from('client_contacts')
            .select('id, organization_id, name, email, phone, is_primary')
            .in('organization_id', orgIds)
            .eq('is_primary', true)
            .limit(500),
      ]);

      if (msRes.error) console.error('[project_milestones.tracker]', msRes.error);
      if (contactRes.error) console.error('[client_contacts.primary]', contactRes.error);
      if (cancelled) return;

      const byProject: Record<string, Milestone[]> = {};
      for (const id of projectIds) byProject[id] = [];
      for (const row of (msRes.data ?? []) as unknown as Milestone[]) {
        (byProject[row.project_id] ??= []).push(row);
      }
      const byOrg: Record<string, ClientContact> = {};
      for (const row of (contactRes.data ?? []) as unknown as ClientContact[]) byOrg[row.organization_id] = row;

      setCheckpoints(byProject);
      setContacts(byOrg);
    })();

    return () => { cancelled = true; };
    // The keys rather than the arrays: a new array with the same ids must not
    // re-fetch on every render.
  }, [key, orgKey, reloadToken]); // eslint-disable-line react-hooks/exhaustive-deps

  return { checkpoints, contacts };
}

/** The owner's checkpoint templates, live ones first by position. */
export function useCheckpointTemplates(reloadToken = 0, enabled = true) {
  const [rows, setRows] = useState<CheckpointTemplate[]>([]);
  const [state, setState] = useState<ReadState>(isConfigured ? 'loading' : 'unconfigured');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    if (!isConfigured) return setState('unconfigured');
    if (!enabled) return setState('ready');
    setState('loading');
    const { data, error } = await supabase
      .from('checkpoint_templates')
      .select('id, name, service_keywords, steps, position, archived_at')
      .order('position', { ascending: true })
      .limit(200);
    if (error) {
      console.error('[checkpoint_templates]', error);
      setState('error');
      setMessage(readError(error, 'checkpoint templates'));
      return;
    }
    setRows((data ?? []) as CheckpointTemplate[]);
    setState('ready');
  }, [reloadToken, enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void load(); }, [load]);

  return { rows, live: rows.filter((t) => !t.archived_at), state, message, reload: load };
}

/* ============================================================ duplicates == */

/**
 * Clients that might already be the one about to be created (§40).
 *
 * Two signals, both cheap and both conservative:
 *
 *   name    normalised — trimmed, lowercased, punctuation and the common
 *           Hungarian and German company suffixes removed — so that
 *           "Rapidkert Kft." matches "rapidkert kft" and "Rapidkert".
 *   domain  the host of the client's website against the host of the contact's
 *           email address, which is what actually catches the case where the
 *           same company was entered twice under two spellings.
 *
 * It RETURNS matches. It does not merge, does not pick one and does not block
 * the creation — §40 is explicit that uncertain records are presented for
 * confirmation, because two clients genuinely can share a name and a system that
 * silently merged them would be worse than one that asked.
 */
const SUFFIXES = /\b(kft|bt|zrt|nyrt|kkt|ev|gmbh|ag|ltd|limited|inc|llc|bv|sa|oy|ab)\b/g;

export function normaliseCompany(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.,''"()]/g, ' ')
    .replace(SUFFIXES, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const hostOf = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const raw = value.includes('@') ? value.split('@').pop()! : value;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`);
    return url.hostname.replace(/^www\./, '').toLowerCase() || null;
  } catch {
    return null;
  }
};

export function findClientMatches(
  clients: Client[],
  candidate: { name: string | null | undefined; email?: string | null; website?: string | null },
): { client: Client; why: string }[] {
  const name = normaliseCompany(candidate.name ?? '');
  const domain = hostOf(candidate.email) ?? hostOf(candidate.website);
  const out: { client: Client; why: string }[] = [];

  for (const client of clients) {
    const clientName = normaliseCompany(client.name);
    const clientDomain = hostOf(client.website);

    if (name && clientName === name) {
      out.push({ client, why: 'the same company name' });
    } else if (domain && clientDomain && clientDomain === domain) {
      out.push({ client, why: `the same domain (${domain})` });
    } else if (name && clientName && (clientName.includes(name) || name.includes(clientName))) {
      out.push({ client, why: 'a similar company name' });
    }
  }
  return out;
}

/** A URL-safe slug, and a unique one against the slugs that already exist. */
export function uniqueSlug(name: string, taken: string[]): string {
  const base = name
    // Decompose, then drop the combining marks: "Bőr & Társa" → "bor-tarsa".
    // Escaped rather than literal, because a literal combining character in a
    // source file is invisible and survives exactly one careless edit.
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    .slice(0, 48) || 'client';
  if (!taken.includes(base)) return base;
  for (let n = 2; n < 200; n += 1) {
    if (!taken.includes(`${base}-${n}`)) return `${base}-${n}`;
  }
  return `${base}-${Date.now()}`;
}

/* ============================================================ mutations == */

function refusal(error: { code?: string; message?: string }, what: string): string {
  console.error(`[${what}]`, error);
  const closing = closeRefusal(error.message);
  if (closing) return closing;
  // The payment schedule's rules (a currency fixed by a schedule, payment
  // columns that follow it) — said in words, not as a generic refusal.
  if (error.message?.includes('stratos:payment_')) return paymentRefusal(error);
  if (error.code === '23514' && error.message?.includes('project_milestones_blocked_check')) {
    return 'A blocked checkpoint needs a reason and a next step.';
  }
  if (error.code === '23514' && error.message?.includes('checkpoint_steps_valid')) {
    return 'A template needs 1 to 40 steps, none of them blank or longer than 160 characters.';
  }
  if (error.code === '42P01') {
    return 'Those tables do not exist yet. Run the migrations in supabase/migrations.';
  }
  if (error.code === '23505') return 'A record with that name already exists.';
  if (error.code === '23514') return 'The database refused those values. Check the amounts and dates.';
  if (error.code === '23503') return 'That record no longer exists.';
  return 'The database refused that change. Check that your account may edit this data.';
}

export function useOperationsMutations(onChanged: () => void) {
  const { profile } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);

  /* ---------------------------------------------------------- clients */

  const createClient = useCallback(async (draft: {
    name: string; website?: string | null; status?: string; slug: string;
    acquisition_source?: string | null; acquisition_medium?: string | null;
    acquisition_campaign?: string | null; primary_service?: string | null;
  }): Promise<{ id: string } | string> => {
    if (!draft.name.trim()) return 'A client needs a name.';
    setBusy('client');
    const { data, error } = await supabase
      .from('organizations')
      .insert({ ...draft, status: draft.status ?? 'active' })
      .select('id')
      .single();
    setBusy(null);
    if (error) return refusal(error, 'organizations.insert');
    onChanged();
    return { id: (data as { id: string }).id };
  }, [onChanged]);

  const updateClient = useCallback(async (id: string, patch: Partial<Client>) => {
    setBusy(id);
    const { error } = await supabase.from('organizations').update(patch).eq('id', id);
    setBusy(null);
    if (error) return refusal(error, 'organizations.update');
    onChanged();
    return null;
  }, [onChanged]);

  const saveContact = useCallback(async (
    organizationId: string,
    contact: { id?: string; name: string; role?: string | null; email?: string | null;
      phone?: string | null; is_primary?: boolean },
  ) => {
    if (!contact.name.trim()) return 'A contact needs a name.';
    setBusy('contact');
    const { id, ...fields } = contact;
    const { error } = id
      ? await supabase.from('client_contacts').update(fields).eq('id', id)
      : await supabase.from('client_contacts').insert({ ...fields, organization_id: organizationId });
    setBusy(null);
    if (error) {
      // The partial unique index refuses a second primary contact. That is a
      // real rule and deserves a sentence rather than the generic refusal.
      if (error.code === '23505') return 'This client already has a primary contact.';
      return refusal(error, 'client_contacts.save');
    }
    onChanged();
    return null;
  }, [onChanged]);

  const removeContact = useCallback(async (id: string) => {
    setBusy(id);
    const { error } = await supabase.from('client_contacts').delete().eq('id', id);
    setBusy(null);
    if (error) return refusal(error, 'client_contacts.delete');
    onChanged();
    return null;
  }, [onChanged]);

  /* --------------------------------------------------------- projects */

  const createProject = useCallback(async (draft: {
    organization_id: string; name: string; slug: string; service?: string | null;
    status?: string; value?: number | null; currency?: string;
    start_date?: string | null; target_date?: string | null;
    opportunity_id?: string | null; responsible_id?: string | null;
    estimated_hours?: number | null; description?: string | null;
  }, milestones: string[] = []): Promise<{ id: string } | string> => {
    if (!draft.organization_id) return 'A project needs a client.';
    if (!draft.name.trim()) return 'A project needs a name.';

    setBusy('project');
    const { data, error } = await supabase
      .from('projects')
      .insert({ ...draft, status: draft.status ?? 'planned', currency: draft.currency ?? 'HUF' })
      .select('id')
      .single();

    if (error) { setBusy(null); return refusal(error, 'projects.insert'); }
    const id = (data as { id: string }).id;

    // The milestone list is written in ONE insert, not one per step. Ten round
    // trips to create a website project would be ten chances for the fifth to
    // fail and leave a half-built checklist.
    if (milestones.length > 0) {
      const { error: msError } = await supabase.from('project_milestones').insert(
        milestones.map((title, position) => ({ project_id: id, title, position })),
      );
      if (msError) console.error('[project_milestones.seed]', msError);
    }

    setBusy(null);
    onChanged();
    return { id };
  }, [onChanged]);

  const updateProject = useCallback(async (id: string, patch: Partial<Project>) => {
    setBusy(id);
    // `completed_at` is not sent: the database stamps it on close and clears it
    // on reopen (`project_close_rules`), whatever a caller would have said.
    const { completed_at: _ignored, ...next } = patch;
    const { error } = await supabase.from('projects').update(next).eq('id', id);
    setBusy(null);
    if (error) return refusal(error, 'projects.update');
    onChanged();
    return null;
  }, [onChanged]);

  /**
   * Close a project. The database decides: it accepts only when the project has
   * at least one checkpoint and every one is done, and stamps `completed_at`.
   * Returns `true` ONLY when a row actually moved from open to closed — the
   * `.neq('status', 'completed')` makes a second click on an already-closed
   * project match nothing — so the caller celebrates a close, not a click.
   */
  const closeProject = useCallback(async (id: string): Promise<true | string> => {
    setBusy(id);
    const { data, error } = await supabase
      .from('projects')
      .update({ status: 'completed' })
      .eq('id', id)
      .neq('status', 'completed')
      .select('id');
    setBusy(null);
    if (error) return refusal(error, 'projects.close');
    onChanged();
    if (!data || data.length === 0) return 'This project was already closed, or may not be changed by this account.';
    return true;
  }, [onChanged]);

  /** Reopen a closed project. It goes back to `active`; the close date is cleared by the database. */
  const reopenProject = useCallback(async (id: string) => {
    setBusy(id);
    const { error } = await supabase
      .from('projects')
      .update({ status: 'active' })
      .eq('id', id)
      .eq('status', 'completed');
    setBusy(null);
    if (error) return refusal(error, 'projects.reopen');
    onChanged();
    return null;
  }, [onChanged]);

  /* ------------------------------------------------------- milestones */

  const saveMilestone = useCallback(async (
    projectId: string,
    milestone: {
      id?: string; title: string; state?: string; due_on?: string | null; position?: number;
      assignee?: string | null; note?: string | null; blocked_reason?: string | null; next_step?: string | null;
    },
  ) => {
    if (!milestone.title.trim()) return 'A checkpoint needs a title.';
    // The same rule the database holds (project_milestones_blocked_check),
    // said here first so the answer is a sentence rather than a refusal.
    if (milestone.state === 'blocked'
      && (!milestone.blocked_reason?.trim() || !milestone.next_step?.trim())) {
      return 'A blocked checkpoint needs a reason and a next step.';
    }
    setBusy('milestone');
    const { id, ...fields } = milestone;
    const { error } = id
      ? await supabase.from('project_milestones').update(fields).eq('id', id)
      : await supabase.from('project_milestones').insert({ ...fields, project_id: projectId });
    setBusy(null);
    if (error) return refusal(error, 'project_milestones.save');
    onChanged();
    return null;
  }, [onChanged]);

  /**
   * Copy a template's steps into a project as its checkpoints, in ONE insert.
   * A copy, not a link: editing the template later changes nothing here.
   */
  const applyTemplate = useCallback(async (projectId: string, steps: string[], from = 0) => {
    if (steps.length === 0) return null;
    setBusy('milestone');
    const { error } = await supabase.from('project_milestones').insert(
      steps.map((title, i) => ({ project_id: projectId, title, position: from + i })),
    );
    setBusy(null);
    if (error) return refusal(error, 'project_milestones.template');
    onChanged();
    return null;
  }, [onChanged]);

  /* ------------------------------------------------------- templates */

  const saveTemplate = useCallback(async (template: {
    id?: string; name: string; service_keywords: string[]; steps: string[]; position: number;
  }) => {
    if (!template.name.trim()) return 'A template needs a name.';
    if (template.steps.length === 0) return 'A template needs at least one step.';
    setBusy('template');
    const { id, ...fields } = template;
    const { error } = id
      ? await supabase.from('checkpoint_templates').update(fields).eq('id', id)
      : await supabase.from('checkpoint_templates').insert(fields);
    setBusy(null);
    if (error) {
      if (error.code === '23505') return 'A template with that name already exists.';
      return refusal(error, 'checkpoint_templates.save');
    }
    onChanged();
    return null;
  }, [onChanged]);

  /** Retire (or restore) a template. Never deleted: nothing points at it, but its name is history. */
  const archiveTemplate = useCallback(async (id: string, archived: boolean) => {
    setBusy(id);
    const { error } = await supabase
      .from('checkpoint_templates')
      .update({ archived_at: archived ? new Date().toISOString() : null })
      .eq('id', id);
    setBusy(null);
    if (error) {
      if (error.code === '23505') return 'A live template already has that name.';
      return refusal(error, 'checkpoint_templates.archive');
    }
    onChanged();
    return null;
  }, [onChanged]);

  const removeMilestone = useCallback(async (id: string) => {
    setBusy(id);
    const { error } = await supabase.from('project_milestones').delete().eq('id', id);
    setBusy(null);
    if (error) return refusal(error, 'project_milestones.delete');
    onChanged();
    return null;
  }, [onChanged]);

  /* ------------------------------------------------------------ costs */

  const addCost = useCallback(async (projectId: string, cost: {
    description: string; category: string; amount: number; currency: string; incurred_on: string;
  }) => {
    if (!cost.description.trim()) return 'A cost needs a description.';
    if (!Number.isFinite(cost.amount) || cost.amount < 0) return 'A cost needs a non-negative amount.';
    setBusy('cost');
    const { error } = await supabase
      .from('project_costs')
      .insert({ ...cost, project_id: projectId, created_by: profile?.id ?? null });
    setBusy(null);
    if (error) return refusal(error, 'project_costs.insert');
    onChanged();
    return null;
  }, [onChanged, profile]);

  const removeCost = useCallback(async (id: string) => {
    setBusy(id);
    const { error } = await supabase.from('project_costs').delete().eq('id', id);
    setBusy(null);
    if (error) return refusal(error, 'project_costs.delete');
    onChanged();
    return null;
  }, [onChanged]);

  /* ------------------------------------------------------------ links */

  const addLink = useCallback(async (projectId: string, link: { label: string; url: string }) => {
    if (!link.label.trim()) return 'A link needs a label.';
    if (!/^https?:\/\//i.test(link.url.trim())) {
      // The same rule as the check constraint and as `safeUrl` at render time.
      // Refusing here means the operator is told why rather than shown a
      // database error, and the two layers behind it mean a bypass of this one
      // changes nothing.
      return 'Only http and https links can be stored.';
    }
    setBusy('link');
    const { error } = await supabase
      .from('project_links')
      .insert({ project_id: projectId, label: link.label.trim(), url: link.url.trim() });
    setBusy(null);
    if (error) return refusal(error, 'project_links.insert');
    onChanged();
    return null;
  }, [onChanged]);

  const removeLink = useCallback(async (id: string) => {
    setBusy(id);
    const { error } = await supabase.from('project_links').delete().eq('id', id);
    setBusy(null);
    if (error) return refusal(error, 'project_links.delete');
    onChanged();
    return null;
  }, [onChanged]);

  return {
    createClient, updateClient, saveContact, removeContact,
    createProject, updateProject, closeProject, reopenProject,
    saveMilestone, removeMilestone, applyTemplate, saveTemplate, archiveTemplate,
    addCost, removeCost, addLink, removeLink, busy,
  };
}

/** Total the costs on a project, per currency, so nothing sums two of them. */
export function costTotal(costs: ProjectCost[], currency: string): number | null {
  const matching = costs.filter((c) => c.currency === currency);
  // No costs recorded at all is `null` — "not recorded", not "zero" (§31). A
  // project whose costs are all in another currency is also null for THIS one,
  // which is the honest answer rather than a total that quietly excludes them.
  if (costs.length === 0) return null;
  return matching.reduce((sum, c) => sum + Number(c.amount), 0);
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, isConfigured } from '@/lib/supabase';
import { useAuth } from '@/features/auth/AuthProvider';

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
  created_at: string;
  updated_at: string;
  client?: { id: string; name: string } | null;
  responsible?: { id: string; full_name: string | null; email: string } | null;
}

export const PROJECT_COLUMNS =
  'id, organization_id, name, slug, description, status, service, value, currency, '
  + 'start_date, target_date, completed_at, archived_at, opportunity_id, responsible_id, '
  + 'estimated_hours, actual_hours, payment_state, invoiced_amount, paid_amount, '
  + 'created_at, updated_at, '
  + 'client:organizations(id, name), responsible:profiles(id, full_name, email)';

export interface Milestone {
  id: string;
  project_id: string;
  title: string;
  position: number;
  state: string;
  due_on: string | null;
  completed_at: string | null;
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
export function useClientDetail(id: string | undefined, reloadToken = 0) {
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
      supabase.from('projects').select(PROJECT_COLUMNS)
        .eq('organization_id', id).order('created_at', { ascending: false }).limit(100),
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
  }, [id, reloadToken]);

  useEffect(() => { void load(); }, [load]);

  return { client, contacts, projects, deals, state, reload: load };
}

/** One project, its milestones, its costs and its links. Four parallel reads. */
export function useProjectDetail(id: string | undefined, reloadToken = 0) {
  const [project, setProject] = useState<Project | null>(null);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
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
        .select('id, project_id, title, position, state, due_on, completed_at')
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

    setProject((projectRes.data ?? null) as unknown as Project | null);
    setMilestones((msRes.data ?? []) as unknown as Milestone[]);
    setCosts((costRes.data ?? []) as unknown as ProjectCost[]);
    setLinks((linkRes.data ?? []) as unknown as ProjectLink[]);
    setState(projectRes.data ? 'ready' : 'missing');
  }, [id, reloadToken]);

  useEffect(() => { void load(); }, [load]);

  return { project, milestones, costs, links, state, reload: load };
}

/**
 * How many milestones each project still has open, for a whole list.
 *
 * ONE query for every project on the screen, not one per project. §70 asks for
 * N+1 patterns to be identified and fixed before acceptance; this is the one
 * place the projects list would have had one, and the fix is to fetch the
 * milestone states in a single bounded read and count them here.
 */
export function useOpenMilestoneCounts(projectIds: string[], reloadToken = 0) {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const key = projectIds.slice().sort().join(',');

  useEffect(() => {
    let cancelled = false;
    if (!isConfigured || projectIds.length === 0) return;

    void (async () => {
      const { data, error } = await supabase
        .from('project_milestones')
        .select('project_id, state')
        .in('project_id', projectIds)
        .limit(2000);

      if (error) { console.error('[project_milestones.counts]', error); return; }
      if (cancelled) return;

      const next: Record<string, number> = {};
      for (const id of projectIds) next[id] = 0;
      for (const row of (data ?? []) as { project_id: string; state: string }[]) {
        if (row.state !== 'done') next[row.project_id] = (next[row.project_id] ?? 0) + 1;
      }
      setCounts(next);
    })();

    return () => { cancelled = true; };
    // `key` rather than the array: a new array with the same ids must not
    // re-fetch on every render.
  }, [key, reloadToken]); // eslint-disable-line react-hooks/exhaustive-deps

  return counts;
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
    // A completed project gets a completion date, stamped here rather than by a
    // trigger because — unlike a won deal — "completed" is not a terminal state
    // in the database's eyes and can legitimately be reversed.
    const next: Record<string, unknown> = { ...patch };
    if (patch.status === 'completed') next.completed_at = new Date().toISOString();
    if (patch.status && patch.status !== 'completed') next.completed_at = null;

    const { error } = await supabase.from('projects').update(next).eq('id', id);
    setBusy(null);
    if (error) return refusal(error, 'projects.update');
    onChanged();
    return null;
  }, [onChanged]);

  /* ------------------------------------------------------- milestones */

  const saveMilestone = useCallback(async (
    projectId: string,
    milestone: { id?: string; title: string; state?: string; due_on?: string | null; position?: number },
  ) => {
    if (!milestone.title.trim()) return 'A milestone needs a title.';
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
    createProject, updateProject, saveMilestone, removeMilestone,
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

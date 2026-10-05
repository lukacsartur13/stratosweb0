import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, isConfigured } from '@/lib/supabase';
import { PROJECT_COLUMNS, type Project } from '@/lib/operations';
import { closeRefusal } from '@/lib/pipeline';
import { impactRefusal, isImpactLead } from '@/lib/impactRules';

/**
 * The Impact Program — reads and writes.
 *
 * Every table and function behind this file is the portal owner's alone
 * (20260929000300_impact_program.sql): `impact_applications` answers to
 * `is_owner()`, Impact projects are rows of `projects` (owner-only since the
 * lockdown), and the three functions are either SECURITY INVOKER or check
 * `is_owner()` themselves. The screens are drawn only for the owner, and for
 * anybody else these reads are never sent.
 *
 * Nothing here copies what the applicant wrote. The application row points at
 * the lead; the answers and the contact are read from the lead, where the form
 * stored them.
 */

type ReadState = 'loading' | 'ready' | 'error' | 'unconfigured';

export interface ImpactLead {
  id: string;
  name: string;
  company: string | null;
  email: string;
  phone: string | null;
  website: string | null;
  status: string;
  form_type: string | null;
  source: string | null;
  locale: string | null;
  source_route: string | null;
  message: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
  /** Set = the lead is in the Trash (20261007000100_trash.sql). */
  trashed_at?: string | null;
}

export interface ImpactApplication {
  id: string;
  lead_id: string;
  status: string;
  status_changed_at: string;
  decision_note: string | null;
  organization_id: string | null;
  project_id: string | null;
  origin: string;
  legacy_lead_status: string | null;
  created_at: string;
  updated_at: string;
  lead: ImpactLead | null;
  project: { id: string; name: string; status: string; market_value: number | null } | null;
}

const APPLICATION_COLUMNS =
  'id, lead_id, status, status_changed_at, decision_note, organization_id, project_id, origin, '
  + 'legacy_lead_status, created_at, updated_at, '
  + 'lead:leads(id, name, company, email, phone, website, status, form_type, source, locale, '
  + 'source_route, message, payload, created_at, trashed_at), '
  + 'project:projects(id, name, status, market_value)';

export interface ImpactSummary {
  committed: number;
  committed_projects: number;
  committed_missing: number;
  delivered: number;
  delivered_projects: number;
  cancelled_projects: number;
}

export interface ImpactConflict {
  lead_id: string | null;
  lead_name: string | null;
  company: string | null;
  lead_created_at: string | null;
  opportunity_id: string;
  opportunity_title: string;
  stage: string;
  project_ids: string[];
}

function readMessage(error: { code?: string }): string {
  return error.code === '42P01' || error.code === 'PGRST205' || error.code === 'PGRST202'
    ? 'The Impact tables do not exist yet. Apply 20260929000100-0300 in supabase/migrations.'
    : 'The database refused the request. The Impact Program is readable by the portal owner only.';
}

/* ================================================================ reads == */

/** Every application, newest first, with its lead and project. One request. */
export function useImpactApplications(reloadToken = 0, enabled = true) {
  const [rows, setRows] = useState<ImpactApplication[]>([]);
  const [state, setState] = useState<ReadState>(isConfigured ? 'loading' : 'unconfigured');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    if (!isConfigured) return setState('unconfigured');
    if (!enabled) return setState('ready');
    setState('loading');
    const { data, error } = await supabase
      .from('impact_applications')
      .select(APPLICATION_COLUMNS)
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) {
      console.error('[impact_applications]', error);
      setState('error');
      setMessage(readMessage(error));
      return;
    }
    // An application whose lead is in the Trash is out of the pipeline; it is
    // deleted with the lead (20261008000100_impact_direct.sql).
    setRows(((data ?? []) as unknown as ImpactApplication[]).filter((a) => !a.lead?.trashed_at));
    setState('ready');
  }, [reloadToken, enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void load(); }, [load]);
  return useMemo(() => ({ rows, state, message, reload: load }), [rows, state, message, load]);
}

/** One application, with its lead and project. */
export function useImpactApplication(id: string | undefined, reloadToken = 0) {
  const [row, setRow] = useState<ImpactApplication | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error' | 'unconfigured'>(
    isConfigured ? 'loading' : 'unconfigured',
  );

  const load = useCallback(async () => {
    if (!isConfigured) return setState('unconfigured');
    if (!id) return setState('missing');
    setState('loading');
    const { data, error } = await supabase
      .from('impact_applications').select(APPLICATION_COLUMNS).eq('id', id).maybeSingle();
    if (error) {
      console.error('[impact_applications.detail]', error);
      setState(error.code === '22P02' ? 'missing' : 'error');
      return;
    }
    setRow((data ?? null) as unknown as ImpactApplication | null);
    setState(data ? 'ready' : 'missing');
  }, [id, reloadToken]);

  useEffect(() => { void load(); }, [load]);
  return { row, state, reload: load };
}

/** Every Impact project, active and closed and cancelled. */
export function useImpactProjects(reloadToken = 0, enabled = true) {
  const [rows, setRows] = useState<Project[]>([]);
  const [state, setState] = useState<ReadState>(isConfigured ? 'loading' : 'unconfigured');

  const load = useCallback(async () => {
    if (!isConfigured) return setState('unconfigured');
    if (!enabled) return setState('ready');
    setState('loading');
    const { data, error } = await supabase
      .from('projects').select(PROJECT_COLUMNS).eq('program', 'impact')
      .order('updated_at', { ascending: false }).limit(300);
    if (error) {
      console.error('[projects.impact]', error);
      setState('error');
      return;
    }
    setRows((data ?? []) as unknown as Project[]);
    setState('ready');
  }, [reloadToken, enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void load(); }, [load]);
  return useMemo(() => ({ rows, state, reload: load }), [rows, state, load]);
}

/**
 * The two support counters, from `impact_support_summary()` — computed from
 * the projects on every call, never a stored running total.
 */
export function useImpactSummary(reloadToken = 0, enabled = true) {
  const [summary, setSummary] = useState<ImpactSummary | null>(null);
  const [state, setState] = useState<ReadState>(isConfigured ? 'loading' : 'unconfigured');

  useEffect(() => {
    let cancelled = false;
    if (!isConfigured) { setState('unconfigured'); return; }
    if (!enabled) { setState('ready'); return; }
    setState('loading');
    void (async () => {
      const { data, error } = await supabase.rpc('impact_support_summary');
      if (cancelled) return;
      if (error) { console.error('[impact_support_summary]', error); setState('error'); return; }
      const row = (Array.isArray(data) ? data[0] : data) as Record<string, number | string> | undefined;
      // bigint arrives as a number or a numeric string depending on size; both
      // are whole forints, and Number() is exact below 2^53.
      setSummary(row ? {
        committed: Number(row.committed), committed_projects: Number(row.committed_projects),
        committed_missing: Number(row.committed_missing), delivered: Number(row.delivered),
        delivered_projects: Number(row.delivered_projects), cancelled_projects: Number(row.cancelled_projects),
      } : null);
      setState('ready');
    })();
    return () => { cancelled = true; };
  }, [reloadToken, enabled]);

  return { summary, state };
}

/** Impact leads that already carry a paid deal — reported, never reclassified. */
export function useImpactConflicts(reloadToken = 0, enabled = true) {
  const [rows, setRows] = useState<ImpactConflict[]>([]);
  useEffect(() => {
    let cancelled = false;
    if (!isConfigured || !enabled) return;
    void (async () => {
      const { data, error } = await supabase.rpc('impact_legacy_conflicts');
      if (error) { console.error('[impact_legacy_conflicts]', error); return; }
      if (!cancelled) setRows((data ?? []) as ImpactConflict[]);
    })();
    return () => { cancelled = true; };
  }, [reloadToken, enabled]);
  return rows;
}

/**
 * Impact leads with no application and no deal — a capture that failed into a
 * WARNING (see `impact_capture_lead`). Should always be empty; if it is not,
 * the screen says so and names the repair.
 */
export function useUncapturedImpactLeads(applications: ImpactApplication[], ready: boolean, conflicts: ImpactConflict[], reloadToken = 0) {
  const [ids, setIds] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    if (!isConfigured || !ready) return;
    void (async () => {
      const { data, error } = await supabase
        .from('leads').select('id, form_type, source')
        .or('form_type.eq.impact,and(form_type.is.null,source.ilike.impact)')
        .is('trashed_at', null)
        .limit(1000);
      if (error) { console.error('[leads.impact]', error); return; }
      const captured = new Set(applications.map((a) => a.lead_id));
      const sold = new Set(conflicts.map((c) => c.lead_id).filter(Boolean) as string[]);
      const missing = ((data ?? []) as { id: string; form_type: string | null; source: string | null }[])
        .filter((l) => isImpactLead(l) && !captured.has(l.id) && !sold.has(l.id))
        .map((l) => l.id);
      if (!cancelled) setIds(missing);
    })();
    return () => { cancelled = true; };
  }, [applications, ready, conflicts, reloadToken]);
  return ids;
}

/* ============================================================ mutations == */

function refusal(error: { code?: string; message?: string }, what: string): string {
  console.error(`[${what}]`, error);
  const said = impactRefusal(error.message) ?? closeRefusal(error.message);
  if (said) return said;
  if (error.code === '23505') return 'That name is already taken — a client or a project with the same address exists.';
  if (error.code === '42501') return 'Only the portal owner can change Impact data.';
  if (error.code === '23514') return 'The database refused those values.';
  return 'The database refused that change.';
}

export interface StartProjectInput {
  applicationId: string;
  /** An existing client, or null to create `client` below. */
  organizationId: string | null;
  client: { name: string; slug: string; website: string | null } | null;
  project: { name: string; slug: string; service: string | null };
  steps: string[];
}

export function useImpactMutations(onChanged: () => void) {
  const [busy, setBusy] = useState<string | null>(null);

  /** Any status but `project_started`, which only starting a project sets. */
  const setStatus = useCallback(async (id: string, status: string) => {
    setBusy(id);
    const { error } = await supabase.from('impact_applications').update({ status }).eq('id', id);
    setBusy(null);
    if (error) return refusal(error, 'impact_applications.status');
    onChanged();
    return null;
  }, [onChanged]);

  const saveDecisionNote = useCallback(async (id: string, note: string) => {
    setBusy(id);
    const { error } = await supabase.from('impact_applications')
      .update({ decision_note: note.trim() || null }).eq('id', id);
    setBusy(null);
    if (error) return refusal(error, 'impact_applications.note');
    onChanged();
    return null;
  }, [onChanged]);

  /**
   * Start the project: ONE call to `impact_start_project()`, which is one
   * transaction. A double click is disabled here and harmless there — a second
   * call finds the application already started and returns the same project.
   */
  const startProject = useCallback(async (input: StartProjectInput): Promise<{ id: string } | string> => {
    if (!input.project.name.trim()) return 'The project needs a name.';
    if (!input.organizationId && !input.client?.name.trim()) return 'Choose a client, or name a new one.';
    setBusy('start');
    const { data, error } = await supabase.rpc('impact_start_project', {
      p_application: input.applicationId,
      p_organization: input.organizationId,
      p_client_name: input.client?.name ?? null,
      p_client_slug: input.client?.slug ?? null,
      p_client_website: input.client?.website ?? null,
      p_project_name: input.project.name,
      p_project_slug: input.project.slug,
      p_service: input.project.service,
      p_steps: input.steps,
    });
    setBusy(null);
    if (error) return refusal(error, 'impact_start_project');
    onChanged();
    return { id: data as string };
  }, [onChanged]);

  /** Set (or clear) an Impact project's market value. The change is logged old → new by the database. */
  const setMarketValue = useCallback(async (projectId: string, value: number | null) => {
    setBusy(projectId);
    const { error } = await supabase.from('projects').update({ market_value: value }).eq('id', projectId);
    setBusy(null);
    if (error) return refusal(error, 'projects.market_value');
    onChanged();
    return null;
  }, [onChanged]);

  return { setStatus, saveDecisionNote, startProject, setMarketValue, busy };
}

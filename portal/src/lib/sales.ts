import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, isConfigured } from '@/lib/supabase';
import { useAuth } from '@/features/auth/AuthProvider';
import { defaultProbability, isOpen, OPEN_STAGES, type Stage } from '@/lib/pipeline';
import type { OpportunityDraft } from '@/lib/business';

// Re-exported so a screen that already imports the opportunity type does not
// need a second import for the shape it edits. A `type` re-export is erased at
// build time and creates no module edge — see the chunking note in business.ts.
export type { OpportunityDraft };

/**
 * The sales layer: opportunities, the pipeline aggregate, and the conversions in
 * and out of it.
 *
 * ## Where authority lives — unchanged from P1
 *
 * The database. Every write below is unqualified — `update opportunities set
 * stage` — and succeeds or fails on the RLS policy, not on anything this file
 * remembered to check. `permissions.ts` decides whether a control is DRAWN;
 * `opportunities_update_admin` decides whether the change HAPPENS. If they
 * disagree the database wins and the operator sees an error rather than someone
 * else's row quietly changing.
 *
 * ## What is deliberately not here
 *
 * No stage automation, no scoring, no reminder emails, no sequence, no
 * assignment rules. Every one of those needs a source of truth this system does
 * not have, and §10 is explicit that this is a Sales workspace and not a CRM
 * product.
 */

/* =========================================================== the shape === */

export interface Opportunity {
  id: string;
  title: string;
  organization_id: string | null;
  company_name: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  service: string | null;
  estimated_value: number | null;
  currency: string;
  stage: string;
  probability: number;
  expected_close_on: string | null;
  next_action: string | null;
  next_action_on: string | null;
  lead_id: string | null;
  source: string | null;
  medium: string | null;
  campaign: string | null;
  landing_route: string | null;
  locale: string | null;
  form_type: string | null;
  owner_id: string | null;
  lost_reason: string | null;
  lost_note: string | null;
  won_at: string | null;
  lost_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  /** Joined, for the list and the board. Never written through. */
  client?: { id: string; name: string } | null;
  owner?: { id: string; full_name: string | null; email: string } | null;
}

export const OPPORTUNITY_COLUMNS =
  'id, title, organization_id, company_name, contact_name, contact_email, contact_phone, '
  + 'service, estimated_value, currency, stage, probability, expected_close_on, '
  + 'next_action, next_action_on, lead_id, source, medium, campaign, landing_route, '
  + 'locale, form_type, owner_id, lost_reason, lost_note, won_at, lost_at, archived_at, '
  + 'created_at, updated_at, '
  + 'client:organizations(id, name), owner:profiles(id, full_name, email)';

/** Who a deal is with, whether or not it has become a client yet. */
export const dealParty = (o: Opportunity): string =>
  o.client?.name || o.company_name || o.contact_name || '—';

/** Where a deal came from, as one readable string. Mirrors `leadSource`. */
export const dealSource = (o: Opportunity): string => {
  if (o.source) return o.medium ? `${o.source} / ${o.medium}` : o.source;
  return '(direct)';
};

/* ============================================================== the list == */

/**
 * The book of open and recently closed business.
 *
 * ## The cap, and why it is honest
 *
 * 200 rows, ordered newest-updated first, the same bound `useRows` applies to
 * every other table in this product. §60 asks that the design not assume there
 * will only ever be twenty records, and the answer is not to remove the bound —
 * it is to make the bound VISIBLE: the screen says `showing the 200 most
 * recently updated` when it is hit, so a growing business finds out from the UI
 * rather than from a total that quietly stops growing.
 *
 * Filtering happens in the browser over those rows, which is instant and costs
 * no round trip per keystroke. When the cap is genuinely reached in practice,
 * the change is to push the stage filter into the query — one line — rather than
 * to rewrite the screen.
 */
export function useOpportunities(reloadToken = 0, includeArchived = false) {
  const [rows, setRows] = useState<Opportunity[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'unconfigured'>(
    isConfigured ? 'loading' : 'unconfigured',
  );
  const [message, setMessage] = useState('');
  const [capped, setCapped] = useState(false);

  const LIMIT = 200;

  const load = useCallback(async () => {
    if (!isConfigured) return setState('unconfigured');
    setState('loading');

    let query = supabase
      .from('opportunities')
      .select(OPPORTUNITY_COLUMNS)
      .order('updated_at', { ascending: false })
      .limit(LIMIT);

    if (!includeArchived) query = query.is('archived_at', null);

    const { data, error } = await query;

    if (error) {
      console.error('[opportunities]', error);
      setState('error');
      setMessage(
        error.code === '42P01'
          ? 'The opportunities table does not exist yet. Run the migrations in supabase/migrations.'
          : 'The database refused the request. Check that your account may read the pipeline.',
      );
      return;
    }

    const list = (data ?? []) as unknown as Opportunity[];
    setRows(list);
    setCapped(list.length === LIMIT);
    setState('ready');
  }, [reloadToken, includeArchived]);

  useEffect(() => { void load(); }, [load]);

  return useMemo(
    () => ({ rows, state, message, capped, limit: LIMIT, reload: load }),
    [rows, state, message, capped, load],
  );
}

/**
 * One opportunity, by id.
 *
 * Read cold, through the same unqualified select and the same policy as the
 * list: a deal this account may not see comes back empty and the screen says
 * "not found" rather than "forbidden", because which records exist is itself
 * something not to leak.
 */
export function useOpportunity(id: string | undefined, reloadToken = 0) {
  const [deal, setDeal] = useState<Opportunity | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error' | 'unconfigured'>(
    isConfigured ? 'loading' : 'unconfigured',
  );

  const load = useCallback(async () => {
    if (!isConfigured) return setState('unconfigured');
    if (!id) return setState('missing');
    setState('loading');

    const { data, error } = await supabase
      .from('opportunities')
      .select(OPPORTUNITY_COLUMNS)
      .eq('id', id)
      .maybeSingle();

    if (error) {
      console.error('[opportunities.detail]', error);
      // A malformed id is a 22P02 from Postgres, which is a "no such record" in
      // every sense that matters to a reader — not an outage.
      setState(error.code === '22P02' ? 'missing' : 'error');
      return;
    }
    setDeal((data ?? null) as unknown as Opportunity | null);
    setState(data ? 'ready' : 'missing');
  }, [id, reloadToken]);

  useEffect(() => { void load(); }, [load]);

  return { deal, state, reload: load };
}

/* ============================================================= mutations == */

/** Turn a PostgREST failure into a sentence, without repeating the database. */
function refusal(error: { code?: string; message?: string }, what: string): string {
  console.error(`[opportunities.${what}]`, error);
  if (error.code === '42P01') {
    return 'The pipeline tables do not exist yet. Run the migrations in supabase/migrations.';
  }
  if (error.code === '23514') {
    // A check constraint. The database names columns and constraints in its
    // message, which is useful in the console and not something to paint across
    // an operator's screen.
    return 'The database refused those values. Check the amount, the probability and the stage.';
  }
  if (error.code === '23503') return 'That record no longer exists.';
  return 'The database refused that change. Check that your account may edit the pipeline.';
}

export function useOpportunityMutations(onChanged: () => void) {
  const { profile } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);

  /**
   * Create an opportunity from nothing (§52).
   *
   * Not every sales conversation begins on the website. The minimum is a title,
   * a party, a value and a stage; a lead association is optional and usually
   * absent for these.
   */
  const create = useCallback(async (draft: OpportunityDraft): Promise<{ id: string } | string> => {
    if (!draft.title?.trim()) return 'An opportunity needs a title.';
    if (!draft.company_name?.trim() && !draft.organization_id) {
      return 'An opportunity needs a company or an existing client.';
    }
    setBusy('create');
    const stage = draft.stage ?? 'qualified';
    const { data, error } = await supabase
      .from('opportunities')
      .insert({
        ...draft,
        stage,
        probability: draft.probability ?? defaultProbability(stage),
        currency: draft.currency ?? 'HUF',
        created_by: profile?.id ?? null,
      })
      .select('id')
      .single();
    setBusy(null);

    if (error) return refusal(error, 'create');
    onChanged();
    return { id: (data as { id: string }).id };
  }, [onChanged, profile]);

  /** Edit any subset of the editable fields. */
  const update = useCallback(async (id: string, draft: OpportunityDraft) => {
    setBusy(id);
    const { error } = await supabase.from('opportunities').update(draft).eq('id', id);
    setBusy(null);
    if (error) return refusal(error, 'update');
    onChanged();
    return null;
  }, [onChanged]);

  /**
   * Move a deal to a stage.
   *
   * The probability follows the stage's default UNLESS somebody has already set
   * a different one — moving a deal from Discovery to Proposal should raise a
   * default 40 to 60, and should not overwrite a considered 35 with 60. The
   * won/lost ends are stamped to 100/0 by the database trigger regardless, which
   * is right: a forecast weighted at 60% on a closed deal is not a forecast.
   */
  const setStage = useCallback(async (
    id: string,
    stage: Stage,
    current: { stage: string; probability: number },
    extra?: { lost_reason?: string | null; lost_note?: string | null },
  ) => {
    setBusy(id);
    const wasDefault = current.probability === defaultProbability(current.stage);
    const patch: OpportunityDraft = { stage, ...extra };
    if (wasDefault && isOpen(stage)) patch.probability = defaultProbability(stage);

    const { error } = await supabase.from('opportunities').update(patch).eq('id', id);
    setBusy(null);
    if (error) return refusal(error, 'stage');
    onChanged();
    return null;
  }, [onChanged]);

  /**
   * Archive, never delete (§41).
   *
   * There is no delete policy on `opportunities` at all, so this is not a
   * convention the UI is choosing to follow — a DELETE from the browser is
   * refused by the database.
   */
  const archive = useCallback(async (id: string, archived: boolean) => {
    setBusy(id);
    const { error } = await supabase
      .from('opportunities')
      .update({ archived_at: archived ? new Date().toISOString() : null })
      .eq('id', id);
    setBusy(null);
    if (error) return refusal(error, 'archive');
    onChanged();
    return null;
  }, [onChanged]);

  return { create, update, setStage, archive, busy };
}

/* ============================================================== filtering */

export type SalesSort = 'updated' | 'value' | 'close' | 'company';

export interface SalesFilters {
  query: string;
  stage: string;
  owner: string;
  service: string;
  source: string;
  /** `all`, `month` (closing this month), `overdue`, `quarter`. */
  close: string;
}

const BLANK: SalesFilters = {
  query: '', stage: 'all', owner: 'all', service: 'all', source: 'all', close: 'all',
};

export const CLOSE_OPTIONS = [
  { id: 'all', label: 'Any close date' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'month', label: 'This month' },
  { id: 'quarter', label: 'Next 90 days' },
  { id: 'none', label: 'No date set' },
];

/**
 * Search, filter and sort, in the browser, over the bounded list.
 *
 * Every option list is built from the values the rows actually carry — an
 * "Owner" menu naming somebody who owns nothing is a menu that teaches the
 * operator to distrust it. The owner filter therefore disappears entirely while
 * there is only one account, which is the honest rendering of §12's
 * "owner/responsible filter where real".
 */
export function useSalesFilter(rows: Opportunity[], initialStage = 'all') {
  const [filters, setFilters] = useState<SalesFilters>({ ...BLANK, stage: initialStage });
  const [sort, setSort] = useState<SalesSort>('updated');

  const set = useCallback(<K extends keyof SalesFilters>(key: K, value: SalesFilters[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }, []);
  const reset = useCallback(() => setFilters(BLANK), []);

  const options = useMemo(() => {
    const distinct = (of: (o: Opportunity) => string | null) =>
      [...new Set(rows.map(of).filter((v): v is string => Boolean(v)))].sort();
    return {
      services: distinct((o) => o.service),
      sources: distinct((o) => (o.source ? dealSource(o) : null)),
      owners: [...new Map(
        rows.filter((o) => o.owner).map((o) => [o.owner!.id, o.owner!]),
      ).values()],
    };
  }, [rows]);

  const filtered = useMemo(() => {
    const q = filters.query.trim().toLowerCase();
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    let out = rows;

    if (filters.stage === 'open') out = out.filter((o) => isOpen(o.stage));
    else if (filters.stage !== 'all') out = out.filter((o) => o.stage === filters.stage);

    if (filters.service !== 'all') out = out.filter((o) => o.service === filters.service);
    if (filters.source !== 'all') out = out.filter((o) => dealSource(o) === filters.source);
    if (filters.owner !== 'all') out = out.filter((o) => o.owner_id === filters.owner);

    if (filters.close !== 'all') {
      out = out.filter((o) => {
        if (filters.close === 'none') return !o.expected_close_on;
        if (!o.expected_close_on) return false;
        const at = new Date(`${o.expected_close_on}T00:00:00`);
        if (filters.close === 'overdue') return at < today && isOpen(o.stage);
        if (filters.close === 'month') return at >= monthStart && at < monthEnd;
        if (filters.close === 'quarter') return at >= today
          && at.getTime() <= today.getTime() + 90 * 86_400_000;
        return true;
      });
    }

    if (q) {
      out = out.filter((o) => [
        o.title, o.company_name, o.client?.name, o.contact_name, o.contact_email,
        o.service, o.next_action,
      ].some((field) => String(field ?? '').toLowerCase().includes(q)));
    }

    const order = [...out];
    if (sort === 'updated') order.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    if (sort === 'company') order.sort((a, b) => dealParty(a).localeCompare(dealParty(b)));
    if (sort === 'value') {
      // Nulls last, always. A deal with no value sorting above a 5M deal because
      // null reads as zero is the sort nobody asked for.
      order.sort((a, b) => (b.estimated_value ?? -1) - (a.estimated_value ?? -1));
    }
    if (sort === 'close') {
      order.sort((a, b) => {
        if (!a.expected_close_on) return 1;
        if (!b.expected_close_on) return -1;
        return a.expected_close_on.localeCompare(b.expected_close_on);
      });
    }
    return order;
  }, [rows, filters, sort]);

  const counts = useMemo(() => {
    const out: Record<string, number> = { all: rows.length, open: 0 };
    for (const row of rows) {
      out[row.stage] = (out[row.stage] ?? 0) + 1;
      if (isOpen(row.stage)) out.open += 1;
    }
    for (const stage of OPEN_STAGES) out[stage] = out[stage] ?? 0;
    return out;
  }, [rows]);

  const narrowed = (Object.keys(BLANK) as (keyof SalesFilters)[])
    .some((k) => filters[k] !== BLANK[k]);

  return { filters, set, reset, narrowed, options, sort, setSort, filtered, counts };
}

/* ============================================================== follow-ups */

export interface FollowUp {
  deal: Opportunity;
  group: 'overdue' | 'today' | 'upcoming';
}

/**
 * The morning list (§38).
 *
 * Three groups, from the two follow-up columns on the opportunity itself. This
 * is not a task manager and cannot become one: there is nothing to create here,
 * only deals whose next action has a date, and the only way to clear a row is to
 * change the action on the deal.
 *
 * A deal with an action and NO date is deliberately absent. It is not overdue,
 * it is not today, and putting it in "upcoming" would be a claim about when it
 * is due that nobody made. The Dashboard's attention list is where that deal
 * surfaces, as "has no next action date".
 */
export function followUps(rows: Opportunity[], now = new Date()): FollowUp[] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

  return rows
    .filter((o) => isOpen(o.stage) && !o.archived_at && o.next_action && o.next_action_on)
    .map((deal) => {
      const at = new Date(`${deal.next_action_on}T00:00:00`).getTime();
      const group: FollowUp['group'] = at < today ? 'overdue' : at === today ? 'today' : 'upcoming';
      return { deal, group };
    })
    .sort((a, b) => (a.deal.next_action_on ?? '').localeCompare(b.deal.next_action_on ?? ''));
}

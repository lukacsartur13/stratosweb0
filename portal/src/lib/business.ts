import { useCallback, useEffect, useState } from 'react';
import { supabase, isConfigured } from '@/lib/supabase';
import { defaultProbability, type SummaryRow } from '@/lib/pipeline';
import { metaText, type Lead } from '@/lib/leads';

/**
 * The reads the DASHBOARD makes, and the two cross-record lookups the LEADS
 * screens make.
 *
 * ## Why this module exists, and it is not a taste
 *
 * Everything here is imported by a screen in the ENTRY BUNDLE — the Dashboard,
 * the lead list, the lead detail. Everything in `lib/sales.ts` and
 * `lib/operations.ts` is imported by a LAZY chunk: the pipeline board, the
 * client hub, the project tracker.
 *
 * Rollup hoists a module shared between the entry and a lazy chunk into the
 * entry. So a Dashboard that imported `useSalesSummary` from `lib/sales.ts`
 * would ship the opportunity filters, the follow-up grouping and every mutation
 * in the first paint — which is exactly what happened on the first build of this
 * phase, and cost 42 kB of entry bundle for six numbers.
 *
 * The split is therefore by WHEN A SCREEN LOADS, not by what a record is called:
 *
 *   lib/pipeline.ts    pure model and vocabulary. Everyone. No imports at all.
 *   lib/money.ts       pure formatting. Everyone. No imports at all.
 *   lib/business.ts    THIS FILE — the aggregate reads the entry bundle makes.
 *   lib/sales.ts       the pipeline's own CRUD. Lazy chunks only.
 *   lib/operations.ts  clients and projects CRUD. Lazy chunks only.
 *
 * ## What every read here has in common
 *
 * None of them loads a table. `portal_sales_summary` and
 * `portal_revenue_attribution` are server-side aggregates under the caller's own
 * RLS; the other three are bounded, filtered selects with their columns named.
 * §59 asks that the Dashboard not fetch every record in the business to render,
 * and this is the file where that is either true or false.
 */

/** The fields a person may edit on an opportunity. Shared with `lib/sales.ts`. */
export interface OpportunityDraft {
  title?: string;
  company_name?: string | null;
  organization_id?: string | null;
  contact_name?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  service?: string | null;
  estimated_value?: number | null;
  currency?: string;
  stage?: string;
  probability?: number;
  expected_close_on?: string | null;
  next_action?: string | null;
  next_action_on?: string | null;
  owner_id?: string | null;
  lost_reason?: string | null;
  lost_note?: string | null;
  lead_id?: string | null;
  source?: string | null;
  medium?: string | null;
  campaign?: string | null;
  landing_route?: string | null;
  locale?: string | null;
  form_type?: string | null;
}

/* ========================================================== the aggregate */

/**
 * The pipeline, summed by the database (§59).
 *
 * One `rpc` call, one row per (bucket, currency), and — the point of the whole
 * exercise — the Dashboard never loads a single opportunity to print the
 * pipeline. `portal_sales_summary` is SECURITY INVOKER, so the totals are built
 * from exactly the rows this account could have selected itself.
 */
export function useSalesSummary(enabled = true, reloadToken = 0) {
  const [rows, setRows] = useState<SummaryRow[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'unconfigured' | 'idle'>(
    enabled ? (isConfigured ? 'loading' : 'unconfigured') : 'idle',
  );

  const load = useCallback(async () => {
    if (!enabled) return setState('idle');
    if (!isConfigured) return setState('unconfigured');
    setState('loading');

    const { data, error } = await supabase.rpc('portal_sales_summary');
    if (error) {
      console.error('[portal_sales_summary]', error);
      setState('error');
      return;
    }
    setRows(
      (data ?? []).map((row: Record<string, unknown>) => ({
        bucket: String(row.bucket),
        currency: row.currency === null ? null : String(row.currency),
        items: Number(row.items ?? 0),
        value: Number(row.value ?? 0),
        weighted: Number(row.weighted ?? 0),
      })),
    );
    setState('ready');
  }, [enabled, reloadToken]);

  useEffect(() => { void load(); }, [load]);

  return { rows, state, reload: load };
}

/* ==================================================== source → revenue == */

export interface AttributionRow {
  key: string;
  leads: number;
  qualified: number;
  opportunities: number;
  won: number;
  won_value: number;
  won_currency: string | null;
  /** More than one means the value cannot be printed as a single figure. */
  won_currencies: number;
}

export type AttributionDimension = 'source' | 'medium' | 'campaign' | 'landing';

/**
 * The chain, as an aggregate (§33, §35).
 *
 * The join is Portal-to-Portal: a lead's own recorded attribution, the
 * opportunity it produced, the value that closed. GA4 sessions are NOT joined
 * here — they are matched in the UI by the source string, and the screen says so
 * (§34). A session and a named lead row are not the same population, and a rate
 * built by dividing one by the other is a number with no meaning.
 */
export function useAttribution(
  dimension: AttributionDimension,
  enabled = true,
  reloadToken = 0,
) {
  const [rows, setRows] = useState<AttributionRow[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'unconfigured' | 'idle'>(
    enabled ? (isConfigured ? 'loading' : 'unconfigured') : 'idle',
  );

  const load = useCallback(async () => {
    if (!enabled) return setState('idle');
    if (!isConfigured) return setState('unconfigured');
    setState('loading');

    const { data, error } = await supabase.rpc('portal_revenue_attribution', { dimension });
    if (error) {
      console.error('[portal_revenue_attribution]', error);
      setState('error');
      return;
    }
    setRows(
      (data ?? []).map((row: Record<string, unknown>) => ({
        key: String(row.key ?? '(not set)'),
        leads: Number(row.leads ?? 0),
        qualified: Number(row.qualified ?? 0),
        opportunities: Number(row.opportunities ?? 0),
        won: Number(row.won ?? 0),
        won_value: Number(row.won_value ?? 0),
        won_currency: row.won_currency === null ? null : String(row.won_currency),
        won_currencies: Number(row.won_currencies ?? 0),
      })),
    );
    setState('ready');
  }, [dimension, enabled, reloadToken]);

  useEffect(() => { void load(); }, [load]);

  return { rows, state, reload: load };
}

/* ====================================================== lead → opportunity */

/**
 * What a lead contributes to the opportunity it becomes (§3).
 *
 * ## What is carried, and what is deliberately left behind
 *
 * Carried: the commercial identity (company, contact, service interest) and the
 * whole of the attribution — source, medium, campaign, landing route, locale,
 * form type — because that attribution is the thing §33's chain is made of, and
 * a chain that stops at the lead cannot reach revenue.
 *
 * Left behind: the message, the questionnaire answers, the budget prose, the
 * timing metadata. They stay in `leads`, where they were validated, and the
 * opportunity keeps `lead_id` so any of it is one click away. §3 asks for
 * exactly this — "do not copy unnecessary questionnaire/personal data into every
 * downstream table" — and the reason is not only tidiness: a second copy of
 * somebody's personal data is a second place it has to be found when they ask
 * for it to be erased.
 *
 * The lead's own `created_at` is NOT copied over the opportunity's. The
 * opportunity was created when it was created; the enquiry's date is on the
 * enquiry, and the detail screen shows both.
 */
export function draftFromLead(lead: Lead): OpportunityDraft {
  return {
    title: [lead.company || lead.name, lead.service_interest].filter(Boolean).join(' — ')
      || lead.name,
    company_name: lead.company || lead.name,
    contact_name: lead.name,
    contact_email: lead.email,
    contact_phone: lead.phone,
    service: lead.service_interest,
    stage: 'qualified',
    probability: defaultProbability('qualified'),
    currency: 'HUF',
    lead_id: lead.id,
    source: metaText(lead, 'utmSource') ?? metaText(lead, 'landingReferrerHost'),
    medium: metaText(lead, 'utmMedium'),
    campaign: metaText(lead, 'utmCampaign'),
    landing_route: metaText(lead, 'landingRoute') ?? lead.source_route,
    locale: lead.locale,
    form_type: lead.form_type,
  };
}

/**
 * Which leads already have an opportunity.
 *
 * One bounded query rather than one query per row. The result is a map, so the
 * Leads list can mark a converted enquiry without asking the database about each
 * one — the N+1 this exists to avoid is the single easiest performance mistake
 * to make on a list screen.
 */
export function useLeadConversions(reloadToken = 0) {
  const [map, setMap] = useState<Record<string, { id: string; stage: string; title: string }>>({});

  useEffect(() => {
    let cancelled = false;
    if (!isConfigured) return;

    void (async () => {
      const { data, error } = await supabase
        .from('opportunities')
        .select('id, lead_id, stage, title')
        .not('lead_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(500);

      if (error) {
        // Not worth shouting about: the migration may not be applied, and the
        // Leads screen is entirely usable without the conversion markers.
        console.error('[opportunities.byLead]', error);
        return;
      }
      if (cancelled) return;

      const next: Record<string, { id: string; stage: string; title: string }> = {};
      for (const row of (data ?? []) as { id: string; lead_id: string; stage: string; title: string }[]) {
        // Newest first, so the first one wins and a lead that produced two
        // opportunities links to the most recent.
        if (!next[row.lead_id]) next[row.lead_id] = { id: row.id, stage: row.stage, title: row.title };
      }
      setMap(next);
    })();

    return () => { cancelled = true; };
  }, [reloadToken]);

  return map;
}

/* ====================================================== the dashboard === */

/** The four columns the Dashboard's project block draws, and nothing more. */
export interface DashboardProject {
  id: string;
  name: string;
  status: string;
  value: number | null;
  currency: string;
  target_date: string | null;
  archived_at: string | null;
  client?: { id: string; name: string } | null;
}

/** The narrow shape the Dashboard's attention rules and deal block need. */
export interface AttentionDeal {
  id: string;
  title: string;
  company_name: string | null;
  stage: string;
  estimated_value: number | null;
  currency: string;
  probability: number;
  expected_close_on: string | null;
  next_action: string | null;
  next_action_on: string | null;
  organization_id: string | null;
  archived_at: string | null;
  client?: { name: string } | null;
}

/**
 * What the Dashboard needs from the operating layer, in two bounded queries.
 *
 * ## The rule this exists to obey
 *
 * §59: the Dashboard must not load every record in the business to draw two
 * panels. So neither of these is "the opportunities" or "the projects" — each is
 * a FILTERED, BOUNDED slice chosen to be exactly what the panel draws:
 *
 *   deals     open, or won-without-a-client. Everything the attention rules can
 *             possibly fire on, and nothing else. Capped at 40.
 *   projects  live only, soonest target first. Capped at 12, of which the panel
 *             shows six.
 *
 * Both selects name their columns. The totals on this screen do not come from
 * here at all — they come from `portal_sales_summary()`, which sums server-side.
 *
 * ## What is deliberately NOT fetched
 *
 * The per-project open-milestone counts. That would be a third query for one
 * attention rule ("active with no milestone left"), and the rule simply does not
 * fire on the Dashboard — `projectAttention` skips it when the count is absent.
 * The Projects screen, which already has the counts for its own list, is where
 * that one appears.
 */
export function useDashboardOperations(enabled = true, reloadToken = 0) {
  const [deals, setDeals] = useState<AttentionDeal[]>([]);
  const [projects, setProjects] = useState<DashboardProject[]>([]);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    enabled && isConfigured ? 'loading' : 'idle',
  );

  const load = useCallback(async () => {
    if (!enabled || !isConfigured) return setState('idle');
    setState('loading');
    const today = new Date().toISOString().slice(0, 10);

    const [dealRes, projectRes] = await Promise.all([
      supabase
        .from('opportunities')
        .select(
          'id, title, company_name, stage, estimated_value, currency, probability, '
          + 'expected_close_on, next_action, next_action_on, organization_id, archived_at, '
          + 'client:organizations(name)',
        )
        .is('archived_at', null)
        .neq('stage', 'lost')
        // Everything an attention rule could fire on, in one round trip: a live
        // deal with no next action, a late action, a late close date, or a won
        // deal with no client. A rule that needed a row outside this set would
        // be a rule this query has to grow to cover — which is why they are
        // written next to each other.
        .or(
          `and(stage.neq.won,next_action.is.null),`
          + `and(stage.neq.won,next_action_on.lte.${today}),`
          + `and(stage.neq.won,expected_close_on.lt.${today}),`
          + `and(stage.eq.won,organization_id.is.null)`,
        )
        .order('next_action_on', { ascending: true, nullsFirst: false })
        .limit(40),
      supabase
        .from('projects')
        // Its OWN column list, not the Projects screen's. The Dashboard block
        // draws four columns; asking for the description, the hours, the payment
        // amounts and the responsible profile would be a wider row over the wire
        // for data nothing on this screen renders.
        .select('id, name, status, value, currency, target_date, archived_at, '
          + 'client:organizations(id, name)')
        .is('archived_at', null)
        .not('status', 'in', '("completed","archived","care")')
        .order('target_date', { ascending: true, nullsFirst: false })
        .limit(12),
    ]);

    // Either can fail without taking the Dashboard with it — most likely because
    // the P2 migration has not been applied, in which case the rest of the
    // screen is exactly what it was before this phase.
    if (dealRes.error) console.error('[dashboard.deals]', dealRes.error);
    if (projectRes.error) console.error('[dashboard.projects]', projectRes.error);

    setDeals((dealRes.data ?? []) as unknown as AttentionDeal[]);
    setProjects((projectRes.data ?? []) as unknown as DashboardProject[]);
    setState(dealRes.error && projectRes.error ? 'error' : 'ready');
  }, [enabled, reloadToken]);

  useEffect(() => { void load(); }, [load]);

  return { deals, projects, state, reload: load };
}


import { useCallback, useEffect, useState } from 'react';
import { supabase, isConfigured } from '@/lib/supabase';
import { t } from '@/lib/i18n';

/**
 * Automations (20261015000100_automations.sql). The rules run in the database
 * every minute (automation_run(), called by the sender); what they raise is an
 * ALERT, read here for Today. An alert closes by itself when its cause is gone,
 * or is ticked off here. Admins read the lead and deal alerts; project alerts
 * only the owner (RLS).
 */

export type AlertKind = 'lead_unanswered' | 'deal_stale' | 'deal_won' | 'instalment_overdue' | 'deadline_soon';
export interface AutomationAlert {
  id: string; kind: AlertKind; title: string; detail: string | null; due_on: string | null;
  amount: number | null; currency: string | null; created_at: string;
  lead_id: string | null; opportunity_id: string | null; project_id: string | null;
}

type State = 'loading' | 'ready' | 'error' | 'unconfigured';

/** Where an alert is dealt with. */
export function alertLink(a: AutomationAlert): string {
  if (a.lead_id) return `/leads/${a.lead_id}`;
  if (a.opportunity_id) return `/sales/${a.opportunity_id}`;
  if (a.project_id) return `/projects/${a.project_id}`;
  return '/today';
}

export function useAlerts(reloadToken: number) {
  const [rows, setRows] = useState<AutomationAlert[]>([]);
  const [state, setState] = useState<State>(isConfigured ? 'loading' : 'unconfigured');
  const load = useCallback(async () => {
    if (!isConfigured) return setState('unconfigured');
    const { data, error } = await supabase.from('automation_alerts')
      .select('id, kind, title, detail, due_on, amount, currency, created_at, lead_id, opportunity_id, project_id')
      .is('done_at', null).is('resolved_at', null).order('created_at', { ascending: false }).limit(100);
    // Before the migration the table is missing: Today simply has no alerts.
    if (error) { console.error('[automation_alerts]', error.code); setRows([]); setState(error.code === 'PGRST205' ? 'ready' : 'error'); return; }
    setRows((data ?? []) as AutomationAlert[]);
    setState('ready');
  }, [reloadToken]);
  useEffect(() => { void load(); }, [load]);
  return { rows, state, reload: load };
}

export async function markAlertDone(id: string): Promise<string | null> {
  const { error } = await supabase.from('automation_alerts').update({ done_at: new Date().toISOString() }).eq('id', id);
  if (error) { console.error('[automation_alerts.done]', error.code); return t('The alert could not be ticked off. Try again.'); }
  return null;
}

/* ------------------------------------------------------------ settings */

export interface AutomationSettings {
  auto_lead_on: boolean; auto_lead_hours: number;
  auto_deal_on: boolean; auto_deal_days: number;
  auto_won_on: boolean; auto_overdue_on: boolean;
  auto_deadline_on: boolean; auto_deadline_days: number;
}
const COLUMNS = 'auto_lead_on, auto_lead_hours, auto_deal_on, auto_deal_days, auto_won_on, auto_overdue_on, auto_deadline_on, auto_deadline_days';

export function useAutomationSettings() {
  const [value, setValue] = useState<AutomationSettings | null>(null);
  const [state, setState] = useState<State>(isConfigured ? 'loading' : 'unconfigured');
  useEffect(() => {
    if (!isConfigured) return;
    void (async () => {
      const { data, error } = await supabase.from('portal_settings').select(COLUMNS).maybeSingle();
      if (error || !data) { console.error('[portal_settings.auto]', error?.code); setState('error'); return; }
      setValue(data as AutomationSettings);
      setState('ready');
    })();
  }, []);
  // Shown at once; put back if the save is refused.
  const save = async (patch: Partial<AutomationSettings>) => {
    const before = value;
    setValue((v) => (v ? { ...v, ...patch } : v));
    const { error } = await supabase.from('portal_settings').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', true);
    if (error) { console.error('[portal_settings.auto.save]', error.code); setValue(before); return t('The setting could not be saved. Try again.'); }
    return null;
  };
  return { value, state, save };
}

import { useCallback, useEffect, useState } from 'react';
import { supabase, isConfigured } from '@/lib/supabase';
import { useRpc } from '@/lib/clientPortal';
import { t } from '@/lib/i18n';

/**
 * Client experience (20261014000100_client_experience.sql): demo approval,
 * "Rád várunk" requests, the project message thread and the satisfaction
 * survey.
 *
 * OWNER side: the tables, owner-only by RLS. CLIENT side: only the `client_*`
 * functions, which re-check the caller's CURRENT assignment on every call.
 */

type State = 'loading' | 'ready' | 'error' | 'unconfigured';

/* ------------------------------------------------------------- the owner */

export interface ClientRequest {
  id: string; project_id: string; title: string; details: string | null; due_on: string | null; created_at: string;
  done_at: string | null; done_note: string | null; seen_at: string | null; cancelled_at: string | null;
  done_account?: { full_name: string } | null;
}
export interface ProjectMessage {
  id: string; project_id: string; account_id: string | null; author_name: string; body: string; created_at: string; read_at: string | null;
}
export interface Survey {
  id: string; project_id: string; reason: 'closed' | 'quarterly' | 'manual'; period: string | null; created_at: string;
  score: number | null; comment: string | null; answered_at: string | null; google_clicked_at: string | null;
  seen_at: string | null; cancelled_at: string | null; account?: { full_name: string } | null;
}

/** The database's refusals here, in words. */
export function experienceRefusal(error: { code?: string | null; message?: string | null } | null): string {
  const m = error?.message ?? '';
  if (/approval_is_the_clients|request_done_is_the_clients|survey_is_the_clients/.test(m)) return t('That answer is the client\'s; it cannot be changed here.');
  if (/message_fixed/.test(m)) return t('A sent message cannot be changed.');
  if (/portal_safe_https_url|google_review_url/.test(m)) return t('The link must be a plain https:// address.');
  if (error?.code === '23514') return t('The database refused those values. Check the lengths.');
  if (error?.code === '42501') return t('Only the portal owner can change this.');
  if (error?.code === 'PGRST205' || error?.code === 'PGRST202' || error?.code === '42P01') return t('This feature is not installed on the database yet (20261014000100).');
  return t('The change could not be saved. Try again.');
}

function useRows<T>(table: string, columns: string, projectId: string, order: string, reloadToken: number) {
  const [rows, setRows] = useState<T[]>([]);
  const [state, setState] = useState<State>(isConfigured ? 'loading' : 'unconfigured');
  const [message, setMessage] = useState('');
  const load = useCallback(async () => {
    if (!isConfigured) return setState('unconfigured');
    const { data, error } = await supabase.from(table).select(columns).eq('project_id', projectId).order(order, { ascending: true });
    if (error) { console.error(`[${table}]`, error.code); setMessage(experienceRefusal(error)); setState('error'); return; }
    setRows((data ?? []) as T[]);
    setState('ready');
  }, [table, columns, projectId, order, reloadToken]);
  useEffect(() => { void load(); }, [load]);
  return { rows, state, message, reload: load };
}

export const useClientRequests = (projectId: string, tick = 0) => useRows<ClientRequest>('client_requests',
  'id, project_id, title, details, due_on, created_at, done_at, done_note, seen_at, cancelled_at, done_account:client_accounts(full_name)', projectId, 'created_at', tick);
export const useProjectMessages = (projectId: string, tick = 0) => useRows<ProjectMessage>('project_messages',
  'id, project_id, account_id, author_name, body, created_at, read_at', projectId, 'created_at', tick);
export const useSurveys = (projectId: string, tick = 0) => useRows<Survey>('client_surveys',
  'id, project_id, reason, period, created_at, score, comment, answered_at, google_clicked_at, seen_at, cancelled_at, account:client_accounts(full_name)', projectId, 'created_at', tick);

/** Insert or update by id. Returns null or a sentence. */
export async function saveExperience(table: 'client_requests' | 'project_messages' | 'client_surveys' | 'project_demos', row: Record<string, unknown>, id?: string | string[]): Promise<string | null> {
  if (!isConfigured) return null;
  const { error } = id === undefined
    ? await supabase.from(table).insert(row)
    : Array.isArray(id) ? await supabase.from(table).update(row).in('id', id) : await supabase.from(table).update(row).eq('id', id);
  if (error) { console.error(`[${table}.save]`, error.code); return experienceRefusal(error); }
  return null;
}

/** The Google review link the survey offers from a score of 7 (Settings). */
export function useGoogleReviewUrl() {
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<State>(isConfigured ? 'loading' : 'unconfigured');
  const load = useCallback(async () => {
    if (!isConfigured) return;
    const { data, error } = await supabase.from('portal_settings').select('google_review_url').maybeSingle();
    if (error) { console.error('[portal_settings]', error.code); setState('error'); return; }
    setUrl((data as { google_review_url: string | null } | null)?.google_review_url ?? null);
    setState('ready');
  }, []);
  useEffect(() => { void load(); }, [load]);
  const save = async (next: string | null) => {
    const { error } = await supabase.from('portal_settings').update({ google_review_url: next, updated_at: new Date().toISOString() }).eq('id', true);
    if (error) { console.error('[portal_settings.save]', error.code); return experienceRefusal(error); }
    setUrl(next);
    return null;
  };
  return { url, state, save };
}

/* ------------------------------------------------------------ the client */

export interface ClientApproval { demo_id: string; project_id: string; requested_at: string; state: 'approved' | 'changes' | null; note: string | null; decided_at: string | null }
export interface ClientRequestRow { request_id: string; project_id: string; title: string; details: string | null; due_on: string | null; created_at: string; done_at: string | null; done_note: string | null }
export interface ClientMessage { message_id: string; project_id: string; body: string; created_at: string; from_stratos: boolean; author_name: string; mine: boolean }
export interface ClientSurvey {
  survey_id: string; project_id: string; reason: 'closed' | 'quarterly' | 'manual'; period: string | null; created_at: string;
  score: number | null; comment: string | null; answered_at: string | null; google_url: string | null;
}

export const useClientApprovals = (tick = 0) => useRpc<ClientApproval>('client_portal_approvals', tick);
export const useClientRequestsMine = (tick = 0) => useRpc<ClientRequestRow>('client_portal_requests', tick);
export const useClientMessages = (tick = 0) => useRpc<ClientMessage>('client_portal_messages', tick);
export const useClientSurveys = (tick = 0) => useRpc<ClientSurvey>('client_portal_surveys', tick);

function clientRefusal(error: { code?: string | null; message?: string | null }): string {
  const m = error.message ?? '';
  if (/approval_note_needed/.test(m)) return t('Írd le röviden, mit módosítsunk.');
  if (/approval_decided/.test(m)) return t('Erre már válaszoltál.');
  if (/approval_not_requested/.test(m)) return t('Ezt a demót most nem kell jóváhagynod.');
  if (/message_empty/.test(m)) return t('Írj valamit az üzenetbe.');
  if (/message_limit/.test(m)) return t('Ma már sok üzenetet küldtél. Holnap újra írhatsz, vagy keresd a Stratost e-mailben.');
  if (/survey_answered/.test(m)) return t('Erre a kérdőívre már válaszoltatok.');
  if (/survey_score/.test(m)) return t('Válassz egy számot 1 és 10 között.');
  if (/client_no_access/.test(m) || error.code === '42501') return t('Ehhez már nincs hozzáférésed.');
  return t('Nem sikerült elküldeni. Próbáld újra.');
}

async function call<T = unknown>(fn: string, args: Record<string, unknown>): Promise<{ data: T | null; problem: string | null }> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) { console.error(`[client.${fn}]`, error.code); return { data: null, problem: clientRefusal(error) }; }
  return { data: data as T, problem: null };
}

export const decideDemo = async (demoId: string, approve: boolean, note: string | null) =>
  (await call('client_decide_demo', { p_demo: demoId, p_approve: approve, p_note: note })).problem;
export const completeRequest = async (requestId: string, note: string | null) =>
  (await call('client_complete_request', { p_request: requestId, p_note: note })).problem;
export const sendMessage = async (projectId: string, body: string) =>
  (await call('client_send_message', { p_project: projectId, p_body: body })).problem;
/** Returns the Google link (score of 7 or more and a link set) or null. */
export const answerSurvey = async (surveyId: string, score: number, comment: string | null) => {
  const r = await call<string | null>('client_answer_survey', { p_survey: surveyId, p_score: score, p_comment: comment });
  return { url: r.data ?? null, problem: r.problem };
};
export const surveyGoogleClicked = async (surveyId: string) => { await call('client_survey_google', { p_survey: surveyId }); };

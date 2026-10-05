import { useCallback, useEffect, useState } from 'react';
import { supabase, isConfigured } from '@/lib/supabase';
import { t } from '@/lib/i18n';

/**
 * Google (20261017000100_google.sql): each admin connects their own account
 * (/api/google-oauth), the e-mails exchanged with leads, clients and deals are
 * read from it (google-sync.mjs), and meetings go into their calendar.
 * The token never reaches the browser.
 */

export interface GoogleAccount {
  google_email: string; scopes: string; connected_at: string;
  gmail_synced_at: string | null; calendar_synced_at: string | null; last_error: string | null;
}

type State = 'loading' | 'ready' | 'error' | 'unconfigured' | 'missing';

export function useGoogleAccount(userId: string | undefined) {
  const [account, setAccount] = useState<GoogleAccount | null>(null);
  const [state, setState] = useState<State>(isConfigured ? 'loading' : 'unconfigured');
  const load = useCallback(async () => {
    if (!isConfigured || !userId) return;
    const { data, error } = await supabase.from('google_accounts')
      .select('google_email, scopes, connected_at, gmail_synced_at, calendar_synced_at, last_error').eq('user_id', userId).maybeSingle();
    if (error) { console.error('[google_accounts]', error.code); setState(error.code === 'PGRST205' || error.code === '42P01' ? 'missing' : 'error'); return; }
    setAccount((data as GoogleAccount | null) ?? null);
    setState('ready');
  }, [userId]);
  useEffect(() => { void load(); }, [load]);
  return { account, state, reload: load };
}

async function call(action: 'start' | 'disconnect'): Promise<{ url?: string; error?: string }> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { error: t('Sign in again, then try once more.') };
  try {
    const res = await fetch('/api/google-oauth', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ action }),
    });
    const body = await res.json().catch(() => null) as { ok?: boolean; url?: string; code?: string } | null;
    if (res.ok && body?.ok) return { url: body.url };
    if (body?.code === 'GOOGLE_NOT_CONFIGURED') return { error: t('Google is not set up on the server yet (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_TOKEN_KEY).') };
    return { error: t('Google could not be reached. Try again.') };
  } catch {
    return { error: t('Google could not be reached. Try again.') };
  }
}

/** Sends the browser to Google's consent screen. Returns a sentence only on failure. */
export async function connectGoogle(): Promise<string | null> {
  const r = await call('start');
  if (r.url) { window.location.assign(r.url); return null; }
  return r.error ?? null;
}
export async function disconnectGoogle(): Promise<string | null> {
  return (await call('disconnect')).error ?? null;
}

/** What /api/google-oauth said when it sent the person back (?google=…). */
export function googleReturn(search: string): { ok: boolean; text: string } | null {
  const q = new URLSearchParams(search);
  const g = q.get('google');
  if (g === 'connected') return { ok: true, text: t('Google is connected. E-mails and meetings sync within a few minutes.') };
  if (g !== 'error') return null;
  const reason = q.get('reason');
  if (reason === 'declined') return { ok: false, text: t('The connection was cancelled on Google\'s page.') };
  if (reason === 'expired') return { ok: false, text: t('The connection took too long or was started elsewhere. Try again.') };
  if (reason === 'norefresh') return { ok: false, text: t('Google did not grant lasting access. Remove “Stratos Portál” at myaccount.google.com → Security → Third-party access, then connect again.') };
  return { ok: false, text: t('Google could not be connected. Try again.') };
}

/* ------------------------------------------------------------ history */

export interface EmailMessage {
  id: string; direction: 'in' | 'out'; from_email: string; from_name: string | null; to_emails: string[];
  subject: string | null; snippet: string | null; sent_at: string; thread_id: string | null; mailbox_user_id: string;
  mailbox: { full_name: string | null; email: string } | null;
}
export type EmailTarget = { lead_id: string } | { organization_id: string } | { opportunity_id: string };

export function useEmailHistory(target: EmailTarget, reloadToken = 0) {
  const [rows, setRows] = useState<EmailMessage[]>([]);
  const [state, setState] = useState<State>(isConfigured ? 'loading' : 'unconfigured');
  const [key, value] = Object.entries(target)[0];
  const load = useCallback(async () => {
    if (!isConfigured) return setState('unconfigured');
    const { data, error } = await supabase.from('email_messages')
      .select('id, direction, from_email, from_name, to_emails, subject, snippet, sent_at, thread_id, mailbox_user_id, mailbox:profiles(full_name, email)')
      .eq(key, value).order('sent_at', { ascending: false }).limit(100);
    if (error) { console.error('[email_messages]', error.code); setState(error.code === 'PGRST205' || error.code === '42P01' ? 'missing' : 'error'); return; }
    setRows((data ?? []) as unknown as EmailMessage[]);
    setState('ready');
  }, [key, value, reloadToken]);
  useEffect(() => { void load(); }, [load]);
  return { rows, state, reload: load };
}

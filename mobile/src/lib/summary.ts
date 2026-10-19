import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { API_ORIGIN } from './config';
import { supabase } from './supabase';

/**
 * GET /api/widget (netlify/functions/portal-widget.mjs): the one summary the
 * home screen and the widgets show. These types mirror what it returns.
 */

export type LineKind = 'task' | 'followUp' | 'checkpoint' | 'meeting' | 'alert' | 'request' | 'approval';

export interface Line {
  kind: LineKind;
  title: string | null;
  detail: string | null;
  /** YYYY-MM-DD, Budapest; null for a client line without a deadline. */
  due: string | null;
  late: boolean;
  /** Today's meetings only. */
  startsAt?: string;
}

export interface NextMeeting {
  kind: 'meeting' | 'booking';
  title: string | null;
  detail: string | null;
  startsAt: string;
  joinUrl: string | null;
}

interface Common {
  ok: true;
  /** The Portal's day (Europe/Budapest), YYYY-MM-DD. */
  day: string;
  generatedAt: string;
  nextMeeting: NextMeeting | null;
  /** At most eight; the totals count all of them. */
  items: Line[];
}

export interface OwnerSummary extends Common {
  kind: 'owner';
  today: { total: number; late: number; tasks: number; followUps: number; checkpoints: number; meetings: number; alerts: number };
  newLeads: number;
}

export interface ClientSummary extends Common {
  kind: 'client';
  me: { name: string; company: string };
  projects: { id: string; name: string }[];
  waitingOnYou: { total: number; requests: number; approvals: number };
}

export type Summary = OwnerSummary | ClientSummary;

/** Why there is no fresh summary: signed out elsewhere, an account the app is not for, no network, or the Portal. */
export type SummaryError = 'UNAUTHENTICATED' | 'FORBIDDEN' | 'OFFLINE' | 'UNAVAILABLE';

export async function fetchSummary(token: string): Promise<Summary | { error: SummaryError }> {
  try {
    const res = await fetch(`${API_ORIGIN}/api/widget`, { headers: { authorization: `Bearer ${token}` } });
    const body = await res.json().catch(() => null);
    if (res.ok && body?.ok) return body as Summary;
    if (res.status === 401) return { error: 'UNAUTHENTICATED' };
    if (res.status === 403) return { error: 'FORBIDDEN' };
    return { error: 'UNAVAILABLE' };
  } catch {
    return { error: 'OFFLINE' };
  }
}

/**
 * The summary for the signed-in account, read again on pull-to-refresh and
 * whenever the app comes back to the front. The last good one stays on screen
 * while a refresh fails.
 */
export function useSummary() {
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState<SummaryError | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    // getSession() refreshes an expired token first, so a 401 after it means
    // the session was ended elsewhere (revoked, password changed).
    const { data: auth } = await supabase.auth.getSession();
    const token = auth.session?.access_token;
    if (!token) { setRefreshing(false); return; }
    const result = await fetchSummary(token);
    if ('error' in result) {
      setError(result.error);
      if (result.error === 'UNAUTHENTICATED') await supabase.auth.signOut({ scope: 'local' });
    } else {
      setData(result);
      setError(null);
    }
    setRefreshing(false);
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => { if (state === 'active') void load(); });
    return () => sub.remove();
  }, [load]);

  return { data, error, refreshing, reload: load };
}

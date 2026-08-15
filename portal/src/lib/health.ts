import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/features/auth/AuthProvider';

/**
 * System health, read from `/api/portal-health`.
 *
 * ## What this can and cannot contain
 *
 * Booleans, enums and variable NAMES. The endpoint is built so that no value of
 * any secret can reach a response — `configured()` there takes a variable and
 * returns whether it is a non-empty string — and this module is the mirror of
 * that: there is no field in the types below that could hold a key, a URL or a
 * token, so there is nowhere for one to be rendered even if the endpoint
 * changed underneath it.
 */

export type ServiceState = 'ok' | 'degraded' | 'unconfigured' | 'unreachable' | 'disabled';

export interface Health {
  checkedAt: string;
  environment: string;
  services: {
    supabase: { state: ServiceState; urlConfigured: boolean; serviceKeyConfigured: boolean };
    leadApi: { state: ServiceState; storeConfigured: boolean; ipSaltConfigured: boolean };
    ga4: { state: ServiceState; missing: string[] };
    notifications: { state: ServiceState; transport: string; destinationConfigured: boolean };
  };
}

export type HealthState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; data: Health };

export function useHealth(enabled = true) {
  const { session } = useAuth();
  const token = session?.access_token;
  const [state, setState] = useState<HealthState>({ kind: 'loading' });

  const load = useCallback(async () => {
    if (!enabled) return;
    setState({ kind: 'loading' });
    if (!token) {
      setState({ kind: 'error', message: 'Your session has expired. Sign in again.' });
      return;
    }
    try {
      const res = await fetch('/api/portal-health', {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        setState({
          kind: 'error',
          message: res.status === 403
            ? 'This account cannot view system health.'
            : 'System health could not be read.',
        });
        return;
      }
      setState({ kind: 'ready', data: (await res.json()) as Health });
    } catch {
      // The common case in development: the static server has no functions
      // behind it. Not an outage, and worth saying so rather than showing red.
      setState({ kind: 'error', message: 'System health could not be reached.' });
    }
  }, [token, enabled]);

  useEffect(() => { void load(); }, [load]);

  return { state, reload: load };
}

/**
 * How a state should read.
 *
 * `disabled` is deliberately neutral rather than a warning. The notification
 * adapter defaults to sending nothing, which is a choice and not a fault —
 * leads land in the Portal and in the database either way. Painting a
 * deliberate configuration red teaches whoever reads this screen to ignore the
 * colour, which is the only thing that makes the colour worth having.
 */
export const TONE: Record<ServiceState, 'good' | 'warn' | 'bad' | 'neutral'> = {
  ok: 'good',
  degraded: 'warn',
  unconfigured: 'warn',
  unreachable: 'bad',
  disabled: 'neutral',
};

export const STATE_LABEL: Record<ServiceState, string> = {
  ok: 'OK',
  degraded: 'Degraded',
  unconfigured: 'Not configured',
  unreachable: 'Unreachable',
  disabled: 'Off',
};

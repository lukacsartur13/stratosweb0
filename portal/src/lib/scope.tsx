import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { Environment, Range } from '@/lib/analytics';

/**
 * The Control Room's scope: what period, which deployment, and when to look
 * again.
 *
 * ## Why this is application state and not page state
 *
 * Before this existed, "last 30 days" was a `useState` inside Analytics and the
 * Dashboard was hard-wired to seven days. The two screens therefore answered
 * the same question about different windows, silently, and nothing on either
 * said so. A period is a property of what the operator is currently looking at,
 * not of the screen they happen to be on — so it lives in the shell, is shown
 * in the command bar, and follows them from Dashboard to Analytics and back.
 *
 * ## `reloadToken`
 *
 * One counter, bumped by the Refresh control, and every data hook lists it as a
 * dependency. That is the whole of "refresh": no cache to invalidate, no event
 * bus, and no possibility of a screen where one panel refreshed and three did
 * not. The server's own cache decides whether a refresh actually costs a call
 * to Google.
 *
 * ## What is deliberately NOT here
 *
 * A custom date range. `/api/portal-analytics` accepts four ranges and nothing
 * else — see `RANGES` in lib/analytics.ts and the parameter check in the
 * function — so a "Custom" control would be a picker that cannot be honoured.
 * Adding one means adding start/end parameters to the endpoint, which is a
 * backend change and belongs in a phase that documents it first.
 */

export interface Scope {
  range: Range;
  setRange: (range: Range) => void;
  environment: Environment;
  setEnvironment: (environment: Environment) => void;
  /** Whether the previous period is drawn alongside the current one. */
  compare: boolean;
  setCompare: (compare: boolean) => void;
  reloadToken: number;
  refresh: () => void;
}

const Ctx = createContext<Scope | null>(null);

export function ScopeProvider({ children }: { children: ReactNode }) {
  const [range, setRange] = useState<Range>('30d');
  const [environment, setEnvironment] = useState<Environment>('production');
  const [compare, setCompare] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);

  const refresh = useCallback(() => setReloadToken((n) => n + 1), []);

  const value = useMemo<Scope>(
    () => ({ range, setRange, environment, setEnvironment, compare, setCompare, reloadToken, refresh }),
    [range, environment, compare, reloadToken, refresh],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useScope(): Scope {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useScope must be used inside <ScopeProvider>');
  return ctx;
}

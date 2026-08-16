import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/features/auth/AuthProvider';

/**
 * The Portal's one client for `/api/portal-analytics`.
 *
 * ## The whole security architecture, in one sentence
 *
 * This module sends the signed-in user's Supabase access token to a same-origin
 * endpoint and receives numbers.
 *
 * It holds no Google identifier of any kind: no service account, no private
 * key, no OAuth token, and not the numeric Property ID either. That is not
 * merely better practice than calling the Data API from here — calling it from
 * here is impossible to do safely, because any credential this bundle could use
 * is a credential anyone reading this bundle can use. The suite asserts the
 * absence rather than trusting it; see `the built portal bundle carries no
 * Google identifier` in tests/portal-analytics.spec.ts.
 *
 * ## Why one hook for nine sections
 *
 * The endpoint assembles the whole dashboard from four Google calls. A hook per
 * panel would undo that on the client side: nine components mounting nine
 * fetches, each of which would either miss the server cache or wait on it, for
 * a payload that is one object. So the screen fetches once and passes the
 * result down, and a section that has nothing to show renders its own empty
 * state rather than its own request.
 *
 * ## On the words used here
 *
 * GA4's terms, exactly as GA4 defines them. "Active users" are active users and
 * "sessions" are sessions; neither is called "visitors", because a session is
 * not a person and one person browsing twice is two sessions. The screen would
 * read more smoothly with the looser word and would then be quietly wrong on
 * every card.
 */

export type Range = 'today' | '7d' | '30d' | '90d';
export type Environment = 'production' | 'staging' | 'all';

export const RANGES: { id: Range; label: string; long: string }[] = [
  { id: 'today', label: 'Today', long: 'Today' },
  { id: '7d', label: '7d', long: 'Last 7 days' },
  { id: '30d', label: '30d', long: 'Last 30 days' },
  { id: '90d', label: '90d', long: 'Last 90 days' },
];

/**
 * How many days each range covers, for the figures the Portal counts itself.
 *
 * The lead totals on the Dashboard come from Supabase, not from Google, so they
 * need the same window the analytics call was given — otherwise the strip reads
 * "sessions, last 30 days" next to "leads, last 7 days" and nothing says so.
 * `today` is 1 here and is handled separately by `today()` in lib/leads.ts,
 * which is midnight in the reader's own timezone rather than 24 hours ago.
 */
export const RANGE_DAYS: Record<Range, number> = { today: 1, '7d': 7, '30d': 30, '90d': 90 };

export const ENVIRONMENTS: { id: Environment; label: string }[] = [
  { id: 'production', label: 'Production' },
  { id: 'staging', label: 'Staging' },
  { id: 'all', label: 'All' },
];

export interface Period {
  activeUsers: number;
  sessions: number;
  screenPageViews: number;
  newUsers: number;
  engagedSessions: number;
  /** Seconds per active user — GA4's own definition of average engagement time. */
  engagementPerUser: number;
  engagementRate: number | null;
  leadEvents: number;
  /** Lead events divided by sessions. Named for what it divides. */
  leadRate: number | null;
}

export interface Breakdown { key: string; value: number }

export interface TrendPoint {
  /** `YYYYMMDD`, or `YYYYMMDDHH` when the grain is hourly. */
  at: string;
  activeUsers: number;
  sessions: number;
  screenPageViews: number;
}

export interface AcquisitionRow {
  source: string;
  medium: string;
  campaign: string;
  sessions: number;
  activeUsers: number;
  newUsers: number;
  engagementRate: number | null;
  leadEvents: number;
  leadRate: number | null;
}

export interface PageRow {
  path: string;
  title: string;
  views: number;
  activeUsers: number;
  sessions: number;
  engagementPerUser: number;
  leadEvents: number;
  leadRate: number | null;
}

export interface LandingRow {
  path: string;
  sessions: number;
  activeUsers: number;
  engagementRate: number | null;
  bounceRate: number;
  leadEvents: number;
  leadRate: number | null;
}

export interface DeviceRow {
  device: string;
  sessions: number;
  activeUsers: number;
  screenPageViews: number;
  engagementRate: number | null;
  leadEvents: number;
  leadRate: number | null;
}

export interface FunnelStage {
  id: string;
  label: string;
  count: number;
  /** The GA4 event names this stage counts, or null for the session entry. */
  events: string[] | null;
  ofPrevious: number | null;
  ofEntry: number | null;
}

export interface Realtime {
  minutes: number;
  activeUsersByPage: number;
  byPage: Breakdown[];
  byEvent: Breakdown[];
  environmentFiltered: boolean;
  fetchedAt: string;
}

export interface Report {
  range: Range;
  rangeLabel: string;
  environment: Environment;
  environmentFilter: { applied: boolean; by: string; hosts: string[]; note: string };
  basis: string;
  comparison: { label: string; days: number };
  overview: { today: Period; current: Period; previous: Period };
  trend: { grain: 'date' | 'dateHour'; points: TrendPoint[] };
  pages: PageRow[];
  landingPages: LandingRow[];
  acquisition: AcquisitionRow[];
  devices: DeviceRow[];
  funnel: FunnelStage[];
  events: { name: string; count: number }[];
  realtime: Realtime | null;
  fetchedAt: string;
}

export type AnalyticsState =
  | { kind: 'loading' }
  | { kind: 'unconfigured'; missing: string[]; propertyConfigured: boolean }
  | { kind: 'error'; message: string; code: string }
  | { kind: 'ready'; data: Report; cached: boolean; realtimeCached: boolean };

/**
 * Fetch the dashboard.
 *
 * `enabled` exists for the Command Center, which shows analytics beside lead
 * data and must not fire a Google-backed request for a viewer whose role cannot
 * read the property — the endpoint would answer 403 and the screen would show
 * an error for a panel it should simply not be drawing.
 */
export function useAnalytics(range: Range, environment: Environment, enabled = true, reloadToken = 0) {
  const { session } = useAuth();
  const token = session?.access_token;
  const [state, setState] = useState<AnalyticsState>(
    enabled ? { kind: 'loading' } : { kind: 'error', message: '', code: 'DISABLED' },
  );

  /**
   * The request this component is currently interested in.
   *
   * Changing the range while a request is in flight is one click, and without
   * this the slower of the two responses wins: the screen settles on figures
   * for a range the selector is no longer showing. A counter rather than an
   * `AbortController` because the response is worth having in the server cache
   * either way — aborting would throw away work already paid for at Google.
   */
  const generation = useRef(0);

  const load = useCallback(async () => {
    if (!enabled) return;
    const mine = (generation.current += 1);
    setState({ kind: 'loading' });

    if (!token) {
      // The route is behind ProtectedRoute, so this is the moment between a
      // session expiring and the guard noticing rather than an anonymous view.
      setState({ kind: 'error', message: 'Your session has expired. Sign in again.', code: 'UNAUTHENTICATED' });
      return;
    }

    try {
      const res = await fetch(
        `/api/portal-analytics?range=${range}&environment=${environment}`,
        { headers: { authorization: `Bearer ${token}` } },
      );
      if (mine !== generation.current) return;

      // Every failure is a status plus a code. The endpoint deliberately does
      // not explain which of several causes produced a 401, so neither does
      // this — repeating a vague message in more words helps nobody.
      if (!res.ok) {
        setState({
          kind: 'error',
          code: res.status === 403 ? 'FORBIDDEN' : res.status === 401 ? 'UNAUTHENTICATED' : 'UPSTREAM',
          message: res.status === 403
            ? 'This account cannot view analytics.'
            : res.status === 401
              ? 'Your session has expired. Sign in again.'
              : 'Analytics could not be loaded right now.',
        });
        return;
      }

      const body = await res.json();
      if (mine !== generation.current) return;

      if (body?.configured === false) {
        setState({
          kind: 'unconfigured',
          missing: body.missing ?? [],
          propertyConfigured: Boolean(body.propertyConfigured),
        });
        return;
      }
      setState({
        kind: 'ready',
        data: body.data as Report,
        cached: Boolean(body.cached),
        realtimeCached: Boolean(body.realtimeCached),
      });
    } catch {
      if (mine !== generation.current) return;
      // A network failure, or a build with no functions behind it — `npm run
      // dev` on the static server is the common case.
      setState({ kind: 'error', message: 'Analytics could not be reached.', code: 'NETWORK' });
    }
    // `reloadToken` is the command bar's Refresh, and it is a dependency rather
    // than an imperative call so that every screen reading this hook reloads
    // together. A refresh that updated the panel you happened to be looking at
    // and left the other three stale is worse than no refresh at all.
  }, [range, environment, token, enabled, reloadToken]);

  useEffect(() => { void load(); }, [load]);

  return { state, reload: load };
}

/* ------------------------------------------------------------- formatting */

const nf = new Intl.NumberFormat('en-GB');
export const n = (value: number | null | undefined) =>
  value === null || value === undefined ? '—' : nf.format(value);

/** A ratio as a percentage, or an em dash. Never `NaN%`. */
export const pct = (value: number | null | undefined, digits = 1) =>
  value === null || value === undefined || !Number.isFinite(value)
    ? '—'
    : `${(value * 100).toFixed(digits)}%`;

/** Seconds as `m:ss`, which is how anyone actually reads an engagement time. */
export function duration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '—';
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/**
 * The change from the previous period, as a signed ratio.
 *
 * `null` when there is nothing to compare against — and "nothing" means the
 * previous period was zero, which is not a 100% rise or an infinite one. A
 * dashboard that reports `+Infinity%` for its first week is a dashboard nobody
 * trusts on the second.
 */
export function delta(now: number, before: number): number | null {
  if (!Number.isFinite(now) || !Number.isFinite(before) || before === 0) return null;
  return (now - before) / before;
}

/**
 * GA4's compact date keys, as something readable.
 *
 * `20260814` and `2026081409` are what the Data API returns for the `date` and
 * `dateHour` dimensions. Parsed by position rather than by `new Date(string)`,
 * which would interpret neither.
 */
export function trendLabel(at: string, grain: 'date' | 'dateHour'): string {
  const y = at.slice(0, 4);
  const m = at.slice(4, 6);
  const d = at.slice(6, 8);
  if (grain === 'dateHour') return `${at.slice(8, 10)}:00`;
  return `${d}/${m}`.replace(/^0/, '') || `${y}`;
}

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/features/auth/AuthProvider';
import { PageHead } from '@/pages/screens';
import {
  Badge, Button, Cell, EmptyState, ErrorState, Panel, PanelHeader, Row, Skeleton, Table, cn,
} from '@/components/ui';

/**
 * Portal Analytics — Phase 9, Workstream M.
 *
 * Everything on this screen comes from ONE same-origin request to
 * `/api/portal-analytics`, which is where the Google credentials live. This
 * component holds no Google identifier of any kind: no service account, no
 * private key, no OAuth token, and not the numeric Property ID either. It sends
 * the signed-in user's Supabase access token and receives numbers.
 *
 * That is the whole architecture, and it is worth stating plainly because the
 * shorter version — calling the Data API from here — is not merely worse
 * practice, it is impossible to do safely: any credential this bundle could use
 * is a credential anyone reading this bundle can use.
 *
 * ON THE WORDS USED HERE
 * ----------------------
 * GA4's terms, exactly as GA4 defines them. "Active users" are active users and
 * "sessions" are sessions; neither is called "visitors", because a session is
 * not a person and one person browsing twice is two sessions. The screen would
 * read more smoothly with the looser word and would then be quietly wrong on
 * every card.
 */

type Range = '7d' | '28d' | '90d';

const RANGES: { id: Range; label: string }[] = [
  { id: '7d', label: '7 days' },
  { id: '28d', label: '28 days' },
  { id: '90d', label: '90 days' },
];

interface Breakdown { key: string; value: number }

interface Report {
  range: Range;
  rangeLabel: string;
  basis: string;
  activeUsers: { today: number; last7Days: number; inRange: number };
  sessions: number;
  screenPageViews: number;
  newUsers: number;
  leadEvents: { total: number; byName: Breakdown[]; perSession: number | null };
  topPages: Breakdown[];
  trafficSources: Breakdown[];
  realtimeActiveUsers: number | null;
  fetchedAt: string;
}

type Screen =
  | { kind: 'loading' }
  | { kind: 'unconfigured'; missing: string[] }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; data: Report; cached: boolean };

const nf = new Intl.NumberFormat('en-GB');

export function AnalyticsScreen() {
  const { session } = useAuth();
  const [range, setRange] = useState<Range>('28d');
  const [screen, setScreen] = useState<Screen>({ kind: 'loading' });

  const load = useCallback(async () => {
    setScreen({ kind: 'loading' });

    const token = session?.access_token;
    if (!token) {
      // The route is behind ProtectedRoute, so this is the moment between a
      // session expiring and the guard noticing rather than an anonymous view.
      setScreen({ kind: 'error', message: 'Your session has expired. Sign in again.' });
      return;
    }

    try {
      const res = await fetch(`/api/portal-analytics?range=${range}`, {
        headers: { authorization: `Bearer ${token}` },
      });

      // Every failure is a status plus a code. The endpoint deliberately does
      // not explain which of several causes produced a 401, so neither does
      // this — repeating a vague message in more words helps nobody.
      if (!res.ok) {
        setScreen({
          kind: 'error',
          message: res.status === 403
            ? 'This account cannot view analytics.'
            : res.status === 401
              ? 'Your session has expired. Sign in again.'
              : 'Analytics could not be loaded right now.',
        });
        return;
      }

      const body = await res.json();
      if (body?.configured === false) {
        setScreen({ kind: 'unconfigured', missing: body.missing ?? [] });
        return;
      }
      setScreen({ kind: 'ready', data: body.data as Report, cached: Boolean(body.cached) });
    } catch {
      // A network failure, or a build with no functions behind it — `npm run
      // dev` on the static server is the common case.
      setScreen({ kind: 'error', message: 'Analytics could not be reached.' });
    }
  }, [range, session?.access_token]);

  useEffect(() => { void load(); }, [load]);

  return (
    <>
      <PageHead
        title="Analytics"
        lede="Google Analytics 4, read server-side. Figures describe measured traffic — see the note below."
        right={
          <div className="flex items-center gap-2">
            <div role="group" aria-label="Date range" className="flex rounded-sm border border-hair">
              {RANGES.map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={range === id}
                  onClick={() => setRange(id)}
                  className={cn(
                    'px-3 py-1.5 font-data text-[10px] uppercase tracking-[0.14em] transition-colors',
                    'focus-visible:outline-2 focus-visible:outline-signal',
                    range === id ? 'bg-white/[0.07] text-paper' : 'text-haze hover:text-paper',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <Button size="sm" onClick={() => void load()}>Refresh</Button>
          </div>
        }
      />

      {screen.kind === 'loading' && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-busy="true">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <Panel key={i} className="p-4"><Skeleton className="h-12 w-full" /></Panel>
          ))}
        </div>
      )}

      {screen.kind === 'unconfigured' && <NotConnected missing={screen.missing} />}

      {screen.kind === 'error' && (
        <Panel><ErrorState message={screen.message} onRetry={() => void load()} /></Panel>
      )}

      {screen.kind === 'ready' && <Dashboard data={screen.data} cached={screen.cached} />}
    </>
  );
}

/**
 * The controlled unconfigured state.
 *
 * No service account exists yet, and this is what that looks like: a setup
 * screen naming the variables that are missing, not an error and not an empty
 * dashboard implying nobody visited the site. The endpoint sends the variable
 * NAMES; it never sends a value, and there is nothing here that could render
 * one if it did.
 */
function NotConnected({ missing }: { missing: string[] }) {
  return (
    <Panel>
      <PanelHeader title="Not connected" />
      <div className="grid gap-4 px-5 py-6">
        <p className="max-w-prose text-sm text-haze">
          Portal Analytics is built and waiting for credentials. Reporting needs a Google service
          account with read access to the GA4 property — a separate thing from the measurement tag
          on the public site, which is already live.
        </p>
        {missing.length > 0 && (
          <div>
            <p className="label mb-1.5">Missing in the Netlify function environment</p>
            <ul className="grid gap-1">
              {missing.map((name) => (
                <li key={name} className="num text-xs text-paper">{name}</li>
              ))}
            </ul>
          </div>
        )}
        <p className="max-w-prose text-xs text-haze">
          The full sequence is in <span className="num">_build/reports/phase9-portal-analytics.md</span>:
          enable the Analytics Data API, create the service account, grant it Viewer on the
          property, then set the three variables above. Nothing on this screen changes until all
          three exist.
        </p>
      </div>
    </Panel>
  );
}

function Dashboard({ data, cached }: { data: Report; cached: boolean }) {
  const rate = data.leadEvents.perSession;

  return (
    <>
      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Active users, today" value={data.activeUsers.today} />
        <Stat label="Active users, 7 days" value={data.activeUsers.last7Days} />
        <Stat label={`Active users, ${data.rangeLabel.toLowerCase()}`} value={data.activeUsers.inRange} />
        <Stat
          label="Active users, last 30 min"
          value={data.realtimeActiveUsers}
          note={data.realtimeActiveUsers === null ? 'Realtime unavailable' : undefined}
        />

        <Stat label="Sessions" value={data.sessions} />
        <Stat label="Views" value={data.screenPageViews} />
        <Stat label="New users" value={data.newUsers} />
        <Stat
          label="Lead events"
          value={data.leadEvents.total}
          note={rate === null ? 'No sessions to compare' : `${(rate * 100).toFixed(2)}% of sessions`}
        />
      </div>

      {/* The caveat, on the screen rather than only in a document. Basic
          Consent Mode means a visitor who refused is not measured at all, so
          every figure above is a floor and not a count. Someone reading a
          dashboard makes decisions from it; the qualification has to be where
          the numbers are. */}
      <Panel className="mb-6 px-5 py-4">
        <p className="max-w-prose text-xs text-haze">
          <span className="text-paper">These are measured figures, not total traffic.</span>{' '}
          Analytics loads only after a visitor accepts it, and a visitor who declines is never
          contacted by Google at all — so real traffic is higher than every number above by an
          amount this property cannot know. GA4 terms are used as GA4 defines them: a session is a
          visit, not a person.
        </p>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <ListPanel
          title="Top pages"
          head={['Path', 'Views']}
          rows={data.topPages}
          empty="No page views in this range."
        />
        <ListPanel
          title="Traffic source / medium"
          head={['Source / medium', 'Sessions']}
          rows={data.trafficSources}
          empty="No sessions in this range."
        />
      </div>

      <p className="mt-5 flex flex-wrap items-center gap-2 text-xs text-haze">
        <span>
          Fetched {new Date(data.fetchedAt).toLocaleString('en-GB')} · {data.rangeLabel}
        </span>
        {cached && <Badge>cached</Badge>}
      </p>
    </>
  );
}

function Stat({ label, value, note }: { label: string; value: number | null; note?: string }) {
  return (
    <Panel className="p-4">
      <p className="label">{label}</p>
      <p className="num mt-1.5 text-2xl text-paper">
        {value === null ? '—' : nf.format(value)}
      </p>
      {note && <p className="mt-1 text-xs text-haze">{note}</p>}
    </Panel>
  );
}

/**
 * A dimension breakdown.
 *
 * The keys are page paths and source/medium strings that GA4 collected from
 * the open internet — a referrer is whatever the referring site put in the
 * header. So they are rendered as TEXT, never as a link: there is no `href`
 * anywhere on this screen, which is the same rule the Leads screen follows and
 * for the same reason. `break-words` is what stops one very long path from
 * widening the table and taking the page with it.
 */
function ListPanel({
  title, head, rows, empty,
}: { title: string; head: string[]; rows: Breakdown[]; empty: string }) {
  return (
    <Panel>
      <PanelHeader title={title} />
      {rows.length === 0 ? (
        <EmptyState title="Nothing yet" body={empty} />
      ) : (
        <Table head={head}>
          {rows.map((row) => (
            <Row key={row.key}>
              <Cell>
                <span className="break-words text-sm text-paper">{row.key || '—'}</span>
              </Cell>
              <Cell className="num text-right text-xs text-haze">{nf.format(row.value)}</Cell>
            </Row>
          ))}
        </Table>
      )}
    </Panel>
  );
}

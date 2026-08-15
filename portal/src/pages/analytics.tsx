import { useState, type ReactNode } from 'react';
import { PageHead } from '@/pages/screens';
import {
  Badge, Button, Cell, EmptyState, ErrorState, Panel, PanelHeader, Row, Skeleton, Table, cn,
} from '@/components/ui';
import { BarList, Funnel, Meter, Segmented, Stat, TrendChart } from '@/components/charts';
import {
  ENVIRONMENTS, RANGES, delta, duration, n, pct, trendLabel, useAnalytics,
  type AnalyticsState, type Environment, type Range, type Report,
} from '@/lib/analytics';

/**
 * Portal Analytics.
 *
 * Nine sections, one request. Everything on this screen comes from a single
 * same-origin call to `/api/portal-analytics`, which is where the Google
 * credentials live and stay; this component holds no Google identifier of any
 * kind. See `lib/analytics.ts` for the whole of that argument.
 *
 * ## What it is trying to be
 *
 * An operational instrument, not a report. The layout is dense on purpose:
 * eight KPIs above the fold, the trend beneath them, then acquisition, pages,
 * devices and the funnel — so that "what happened, where did it come from, and
 * did it turn into anything" is one scroll rather than four screens. Nothing
 * here is decorative. Every chart answers a question somebody would otherwise
 * have to open the GA4 interface to ask.
 */

export function AnalyticsScreen() {
  const [range, setRange] = useState<Range>('30d');
  const [environment, setEnvironment] = useState<Environment>('production');
  const { state, reload } = useAnalytics(range, environment);

  return (
    <>
      <PageHead
        title="Analytics"
        lede="Google Analytics 4, read server-side. Figures describe measured traffic — see the note below."
        right={
          <div className="flex flex-wrap items-center gap-2">
            <Segmented label="Environment" value={environment} options={ENVIRONMENTS} onChange={setEnvironment} />
            <Segmented label="Date range" value={range} options={RANGES} onChange={setRange} />
            <Button size="sm" onClick={() => void reload()}>Refresh</Button>
          </div>
        }
      />

      <Screen state={state} reload={reload} />
    </>
  );
}

function Screen({ state, reload }: { state: AnalyticsState; reload: () => void }) {
  if (state.kind === 'loading') {
    return (
      <div aria-busy="true" className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <Panel key={i} className="p-4"><Skeleton className="h-11 w-full" /></Panel>
          ))}
        </div>
        <Panel className="p-5"><Skeleton className="h-44 w-full" /></Panel>
        <div className="grid gap-4 xl:grid-cols-2">
          <Panel className="p-5"><Skeleton className="h-56 w-full" /></Panel>
          <Panel className="p-5"><Skeleton className="h-56 w-full" /></Panel>
        </div>
      </div>
    );
  }

  if (state.kind === 'unconfigured') {
    return <NotConnected missing={state.missing} propertyConfigured={state.propertyConfigured} />;
  }

  if (state.kind === 'error') {
    return <Panel><ErrorState message={state.message} onRetry={reload} /></Panel>;
  }

  return <Dashboard data={state.data} cached={state.cached} realtimeCached={state.realtimeCached} />;
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
function NotConnected({ missing, propertyConfigured }: { missing: string[]; propertyConfigured: boolean }) {
  return (
    <Panel>
      <PanelHeader title="Not connected" />
      <div className="grid gap-4 px-5 py-6">
        <p className="max-w-prose text-sm text-haze">
          Portal Analytics is built and waiting for credentials. Reporting needs a Google service
          account with read access to the GA4 property — a separate thing from the measurement tag
          on the public site, which is already live and collecting.
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
        {propertyConfigured && (
          <p className="text-xs text-haze">
            The property is already configured. Only the service account credentials are outstanding.
          </p>
        )}
        <ol className="grid max-w-prose gap-1.5 text-xs text-haze">
          <li>1 — Enable the Google Analytics Data API in the Google Cloud project.</li>
          <li>2 — Create a service account, and a JSON key for it.</li>
          <li>3 — Add its address as a Viewer on the GA4 property.</li>
          <li>4 — Set the three variables above in Netlify, then redeploy.</li>
        </ol>
        <p className="max-w-prose text-xs text-haze">
          The full sequence is in{' '}
          <span className="num">_build/reports/mobile-altimeter-portal-analytics-report.md</span>.
          Nothing on this screen changes until all three variables exist.
        </p>
      </div>
    </Panel>
  );
}

/* ================================================================ dashboard */

function Dashboard({
  data, cached, realtimeCached,
}: { data: Report; cached: boolean; realtimeCached: boolean }) {
  const now = data.overview.current;
  const was = data.overview.previous;

  return (
    <div className="grid gap-4">
      {/* ---------------------------------------------------------- KPIs -- */}
      <section aria-label="Key figures" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Active users"
          value={n(now.activeUsers)}
          delta={delta(now.activeUsers, was.activeUsers)}
          note={data.comparison.label.toLowerCase()}
        />
        <Stat
          label="Sessions"
          value={n(now.sessions)}
          delta={delta(now.sessions, was.sessions)}
          note={data.comparison.label.toLowerCase()}
        />
        <Stat
          label="Page views"
          value={n(now.screenPageViews)}
          delta={delta(now.screenPageViews, was.screenPageViews)}
          note={data.comparison.label.toLowerCase()}
        />
        <Stat
          label="New users"
          value={n(now.newUsers)}
          delta={delta(now.newUsers, was.newUsers)}
          note={data.comparison.label.toLowerCase()}
        />

        <Stat
          label="Lead events"
          tone="accent"
          value={n(now.leadEvents)}
          delta={delta(now.leadEvents, was.leadEvents)}
          note="form & questionnaire success"
        />
        <Stat
          label="Lead events / session"
          value={pct(now.leadRate, 2)}
          delta={now.leadRate !== null && was.leadRate !== null ? delta(now.leadRate, was.leadRate) : null}
        />
        <Stat
          label="Engagement rate"
          value={pct(now.engagementRate)}
          delta={now.engagementRate !== null && was.engagementRate !== null
            ? delta(now.engagementRate, was.engagementRate) : null}
          note="engaged sessions / sessions"
        />
        <Stat
          label="Avg engagement time"
          value={duration(now.engagementPerUser)}
          delta={delta(now.engagementPerUser, was.engagementPerUser)}
          note="per active user"
        />
      </section>

      {/* ------------------------------------------------------- realtime -- */}
      <RealtimePanel data={data} cached={realtimeCached} />

      {/* ---------------------------------------------------------- trend -- */}
      <TrendPanel data={data} />

      {/* ------------------------------------------- acquisition + funnel -- */}
      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <AcquisitionPanel data={data} />
        <div className="grid gap-4">
          <FunnelPanel data={data} />
          <DevicePanel data={data} />
        </div>
      </div>

      {/* ---------------------------------------------------------- pages -- */}
      <PagesPanel data={data} />

      {/* ----------------------------------------------------------- note -- */}
      <MeasurementNote data={data} cached={cached} />
    </div>
  );
}

/* ================================================================= realtime */

function RealtimePanel({ data, cached }: { data: Report; cached: boolean }) {
  const rt = data.realtime;

  return (
    <Panel>
      <PanelHeader
        title="Realtime"
        action={
          <span className="flex items-center gap-2">
            {rt && (
              <span className="flex items-center gap-1.5">
                {/* A dot, not a pulsing animation. The panel is a readout, and
                    something blinking in the corner of an operational screen is
                    a thing you learn to ignore. */}
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-good" aria-hidden="true" />
                <span className="label">last {rt.minutes} min</span>
              </span>
            )}
            {cached && <Badge>cached</Badge>}
          </span>
        }
      />
      {!rt ? (
        <EmptyState
          title="Realtime unavailable"
          body="The realtime report could not be read. The figures above are unaffected — they come from a different Google endpoint."
        />
      ) : (
        <div className="grid gap-0 lg:grid-cols-[220px_1fr_1fr] lg:divide-x lg:divide-hair">
          <div className="border-b border-hair px-5 py-4 lg:border-b-0">
            <p className="label">Active users</p>
            <p className="num mt-1 text-3xl text-signal">{n(rt.activeUsersByPage)}</p>
            {/* The honest caveat, in the place the number is. GA4 deduplicates
                users across a dimensioned realtime report and this is a sum of
                the rows, so a visitor who moved between two pages inside the
                window appears on both. */}
            <p className="mt-1 text-[10px] leading-relaxed text-haze">
              Summed across pages, so a visitor who moved between two is counted on both.
            </p>
            {!rt.environmentFiltered && data.environment !== 'all' && (
              <p className="mt-2 text-[10px] leading-relaxed text-haze">
                Whole property — GA4 does not expose hostname on realtime reports, so the{' '}
                {data.environment} filter above does not apply here.
              </p>
            )}
          </div>
          <div className="border-b border-hair lg:border-b-0">
            <p className="label px-5 pb-1 pt-4">Pages being viewed</p>
            <BarList rows={rt.byPage} empty="Nobody on the site right now." />
          </div>
          <div>
            <p className="label px-5 pb-1 pt-4">Events</p>
            <BarList rows={rt.byEvent} empty="No events in the window." />
          </div>
        </div>
      )}
    </Panel>
  );
}

/* ==================================================================== trend */

type Metric = 'activeUsers' | 'sessions' | 'screenPageViews';

const METRICS: { id: Metric; label: string }[] = [
  { id: 'activeUsers', label: 'Users' },
  { id: 'sessions', label: 'Sessions' },
  { id: 'screenPageViews', label: 'Views' },
];

function TrendPanel({ data }: { data: Report }) {
  const [metric, setMetric] = useState<Metric>('sessions');
  const points = data.trend.points.map((p) => p[metric]);
  const labels = data.trend.points.map((p) => trendLabel(p.at, data.trend.grain));

  return (
    <Panel>
      <PanelHeader
        title="Traffic"
        action={<Segmented label="Metric" value={metric} options={METRICS} onChange={setMetric} />}
      />
      <TrendChart
        points={points}
        labels={labels}
        label={`${METRICS.find((m) => m.id === metric)!.label} · ${data.rangeLabel.toLowerCase()}`}
      />
    </Panel>
  );
}

/* ============================================================== acquisition */

function AcquisitionPanel({ data }: { data: Report }) {
  const rows = data.acquisition;
  const max = Math.max(...rows.map((r) => r.sessions), 1);

  return (
    // `h-fit` so a short acquisition table does not stretch to match the two
    // stacked panels beside it and leave a screen of empty panel under six rows.
    <Panel className="h-fit min-w-0">
      <PanelHeader
        title="Acquisition"
        action={<span className="label">GA4 session-scoped attribution</span>}
      />
      {rows.length === 0 ? (
        <EmptyState title="No sessions" body="Nothing arrived in this range." />
      ) : (
        <Table head={['Source / medium', 'Campaign', 'Sessions', 'Users', 'Engaged', 'Leads']}>
          {rows.map((row) => (
            <Row key={`${row.source}|${row.medium}|${row.campaign}`}>
              <Cell>
                {/* Text, never a link. Source and referrer strings come from
                    whatever a referring site put in a header. */}
                <span className="break-words text-sm text-paper">{row.source}</span>
                <span className="num ml-1.5 text-[10px] text-haze">/ {row.medium}</span>
                <Meter value={row.sessions} max={max} />
              </Cell>
              {/* `break-all`, and the responsive suite is what caught this
                  missing. A campaign name is whatever somebody typed into a UTM
                  parameter — `spring-2026-kkv-remarketing-lookalike-1pct` is a
                  perfectly ordinary one — and a 48-character unbroken token in
                  a table cell sets that column's min-content width and pushes
                  the table past its scroll container. */}
              <Cell className="num break-all text-xs text-haze">{row.campaign}</Cell>
              <Cell className="num text-right text-xs text-paper">{n(row.sessions)}</Cell>
              <Cell className="num text-right text-xs text-haze">{n(row.activeUsers)}</Cell>
              <Cell className="num text-right text-xs text-haze">{pct(row.engagementRate, 0)}</Cell>
              <Cell className="num text-right text-xs">
                <span className={row.leadEvents > 0 ? 'text-signal' : 'text-haze'}>{n(row.leadEvents)}</span>
                <span className="ml-1.5 text-haze">{pct(row.leadRate, 1)}</span>
              </Cell>
            </Row>
          ))}
        </Table>
      )}
    </Panel>
  );
}

/* =================================================================== funnel */

function FunnelPanel({ data }: { data: Report }) {
  return (
    <Panel>
      <PanelHeader title="Lead funnel" />
      <Funnel
        stages={data.funnel.map((stage) => ({
          ...stage,
          hint: stage.events ? stage.events.join(' · ') : undefined,
        }))}
      />
      {/*
        The qualification, next to the numbers rather than in a document.

        These are EVENT counts against a SESSION count at the entry, which is
        not a like-for-like ratio. GA4 can build a true user-scoped funnel, but
        only through Funnel Exploration, which the Data API does not expose.
        Showing event counts and saying what they are is honest; showing them
        under the word "funnel" without this line would not be.
      */}
      <p className="border-t border-hair px-5 py-3 text-[11px] leading-relaxed text-haze">
        Stages after the first are <span className="text-paper">event counts</span>, not unique
        users: one visitor who clicks two CTAs is counted twice. GA4&rsquo;s user-scoped funnel is
        an Exploration and is not available through the Data API.
      </p>
    </Panel>
  );
}

/* ================================================================== devices */

function DevicePanel({ data }: { data: Report }) {
  const total = data.devices.reduce((sum, d) => sum + d.sessions, 0);

  return (
    <Panel>
      <PanelHeader title="Devices" action={<span className="label">mobile ≠ desktop here</span>} />
      {data.devices.length === 0 ? (
        <EmptyState title="No sessions" body="Nothing to break down in this range." />
      ) : (
        <ul className="grid gap-3 px-5 py-4">
          {data.devices.map((row) => (
            <li key={row.device}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm capitalize text-paper">{row.device}</span>
                <span className="num text-xs text-haze">
                  {n(row.sessions)} <span className="text-haze/70">({pct(total > 0 ? row.sessions / total : null, 0)})</span>
                </span>
              </div>
              <Meter value={row.sessions} max={Math.max(...data.devices.map((d) => d.sessions), 1)} />
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5">
                <Figure label="Users" value={n(row.activeUsers)} />
                <Figure label="Engaged" value={pct(row.engagementRate, 0)} />
                <Figure label="Leads" value={n(row.leadEvents)} accent={row.leadEvents > 0} />
                <Figure label="Rate" value={pct(row.leadRate, 2)} />
              </div>
            </li>
          ))}
        </ul>
      )}
      {/* The public site is two genuinely different experiences. This panel is
          the only place that difference is measurable, and saying so is what
          stops it reading as a stock breakdown nobody acts on. */}
      <p className="border-t border-hair px-5 py-3 text-[11px] leading-relaxed text-haze">
        The public site ships a separate portrait-mobile composition. A gap in the lead rate between
        the two is a product signal, not a device fact.
      </p>
    </Panel>
  );
}

function Figure({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="label">{label}</span>
      <span className={cn('num text-xs', accent ? 'text-signal' : 'text-paper')}>{value}</span>
    </span>
  );
}

/* ==================================================================== pages */

function PagesPanel({ data }: { data: Report }) {
  const [view, setView] = useState<'pages' | 'landing'>('pages');

  return (
    <Panel>
      <PanelHeader
        title="Pages"
        action={
          <Segmented
            label="Page view"
            value={view}
            options={[{ id: 'pages' as const, label: 'Top pages' }, { id: 'landing' as const, label: 'Landing' }]}
            onChange={setView}
          />
        }
      />

      {view === 'pages' ? (
        data.pages.length === 0 ? (
          <EmptyState title="No page views" body="Nothing was viewed in this range." />
        ) : (
          <Table head={['Page', 'Views', 'Users', 'Avg. time', 'Leads']}>
            {data.pages.map((row) => (
              <Row key={row.path}>
                <Cell>
                  <span className="break-words text-sm text-paper">{row.title || row.path}</span>
                  <span className="num mt-0.5 block break-all text-[10px] text-haze">{row.path}</span>
                  <Meter value={row.views} max={Math.max(...data.pages.map((p) => p.views), 1)} />
                </Cell>
                <Cell className="num text-right text-xs text-paper">{n(row.views)}</Cell>
                <Cell className="num text-right text-xs text-haze">{n(row.activeUsers)}</Cell>
                <Cell className="num text-right text-xs text-haze">{duration(row.engagementPerUser)}</Cell>
                <Cell className="num text-right text-xs">
                  <span className={row.leadEvents > 0 ? 'text-signal' : 'text-haze'}>{n(row.leadEvents)}</span>
                </Cell>
              </Row>
            ))}
          </Table>
        )
      ) : data.landingPages.length === 0 ? (
        <EmptyState title="No landing pages" body="No sessions started in this range." />
      ) : (
        <Table head={['Landing page', 'Sessions', 'Users', 'Bounce', 'Leads', 'Rate']}>
          {data.landingPages.map((row) => (
            <Row key={row.path}>
              <Cell>
                <span className="num break-all text-sm text-paper">{row.path}</span>
                <Meter value={row.sessions} max={Math.max(...data.landingPages.map((p) => p.sessions), 1)} />
              </Cell>
              <Cell className="num text-right text-xs text-paper">{n(row.sessions)}</Cell>
              <Cell className="num text-right text-xs text-haze">{n(row.activeUsers)}</Cell>
              <Cell className="num text-right text-xs">
                <span className="text-haze">{pct(row.bounceRate, 0)}</span>
              </Cell>
              <Cell className="num text-right text-xs">
                <span className={row.leadEvents > 0 ? 'text-signal' : 'text-haze'}>{n(row.leadEvents)}</span>
              </Cell>
              <Cell className="num text-right text-xs text-haze">{pct(row.leadRate, 2)}</Cell>
            </Row>
          ))}
        </Table>
      )}

      <p className="border-t border-hair px-5 py-3 text-[11px] leading-relaxed text-haze">
        {view === 'pages'
          ? 'Leads here are enquiries sent FROM that page.'
          : 'Leads here are enquiries attributed to the session that STARTED on that page — which is the number an ad campaign is judged on.'}
      </p>
    </Panel>
  );
}

/* ===================================================================== note */

function MeasurementNote({ data, cached }: { data: Report; cached: boolean }) {
  return (
    <Panel className="px-5 py-4">
      <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
        <p className="max-w-prose text-xs leading-relaxed text-haze">
          <span className="text-paper">Analytics reflects traffic where analytics measurement was permitted.</span>{' '}
          Google Analytics loads only after a visitor accepts it, and a visitor who declines is never
          contacted by Google at all — so real traffic is higher than every figure above by an amount
          this property cannot know. GA4 terms are used as GA4 defines them: a session is a visit,
          not a person.
        </p>
        <dl className="grid gap-1 text-[10px] lg:text-right">
          <Line term="Traffic" value={data.environmentFilter.note} />
          <Line
            term="Filter"
            value={
              data.environmentFilter.applied
                ? `${data.environmentFilter.by} · ${data.environmentFilter.hosts.join(', ')}`
                : 'none'
            }
          />
          <Line
            term="Fetched"
            value={`${new Date(data.fetchedAt).toLocaleString('en-GB')}${cached ? ' · cached' : ''}`}
          />
        </dl>
      </div>
    </Panel>
  );
}

function Line({ term, value }: { term: string; value: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-2 lg:justify-end">
      <dt className="label">{term}</dt>
      <dd className="num text-[10px] text-haze">{value}</dd>
    </div>
  );
}

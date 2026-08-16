import { useMemo, useState, type ReactNode } from 'react';
import { useScope } from '@/lib/scope';
import { Grid } from '@/components/shell/PortalShell';
import {
  Cell, DataState, ErrorState, MetricCell, MetricStrip, Panel, Row, SectionHeader, Skeleton,
  Table, cn,
} from '@/components/ui';
import { BarList, Delta, Funnel, Meter, Segmented, TrendChart } from '@/components/charts';
import {
  delta, duration, n, pct, trendLabel, useAnalytics,
  type AnalyticsState, type Report,
} from '@/lib/analytics';

/**
 * ANALYTICS — analysis.
 *
 * ## What this screen is for, and what the Dashboard is for
 *
 * The Dashboard answers "what is happening"; this answers "what happened, where
 * did it come from, what did people read, and what converted". They draw on the
 * same endpoint and they are not the same screen: the Dashboard shows five
 * figures and one chart because it is read in ten seconds, and this shows six
 * sections because it is read when somebody has a question.
 *
 * Realtime is deliberately NOT here. "Is anyone on the site right now" is a
 * decision-making question, it lives on the Dashboard, and duplicating it here
 * would be the third place the same number appeared.
 *
 * ## One request, six sections
 *
 * Everything below comes from a single same-origin call to
 * `/api/portal-analytics`, which is where the Google credentials live and stay;
 * this component holds no Google identifier of any kind. See `lib/analytics.ts`
 * for the whole of that argument. A hook per section would undo the server's
 * work: six components mounting six fetches, each of which would either miss the
 * server cache or wait on it, for a payload that is one object.
 *
 * ## The period and the deployment
 *
 * Both come from the command bar, not from this screen. They are properties of
 * what the operator is looking at rather than of the page they are on, which is
 * why the Dashboard and this screen can no longer silently disagree about which
 * thirty days they mean.
 */

const SECTIONS = [
  { id: 'overview', label: 'Overview' },
  { id: 'traffic', label: 'Traffic' },
  { id: 'acquisition', label: 'Acquisition' },
  { id: 'content', label: 'Content' },
  { id: 'conversion', label: 'Conversion' },
  { id: 'audience', label: 'Audience' },
] as const;

export function AnalyticsScreen() {
  const { range, environment, reloadToken, compare, setCompare } = useScope();
  const { state, reload } = useAnalytics(range, environment, true, reloadToken);

  return (
    <div className="grid gap-4">
      {/* One control row, and it holds only what the command bar does not:
          the comparison, and the jump list. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <nav aria-label="Analytics sections" className="flex flex-wrap gap-x-4 gap-y-1">
          {SECTIONS.map((s) => (
            <a key={s.id} href={`#${s.id}`} className="t-section hover:text-paper">{s.label}</a>
          ))}
        </nav>
        <label className="flex cursor-pointer items-center gap-2 text-[11px] text-haze hover:text-paper">
          <input
            type="checkbox"
            checked={compare}
            onChange={(e) => setCompare(e.target.checked)}
            className="h-3 w-3 accent-signal"
          />
          Compare previous period
        </label>
      </div>

      <Screen state={state} reload={reload} compare={compare} />
    </div>
  );
}

function Screen({
  state, reload, compare,
}: { state: AnalyticsState; reload: () => void; compare: boolean }) {
  if (state.kind === 'loading') {
    return (
      <div aria-busy="true" className="grid gap-4">
        <Skeleton className="h-[104px] w-full" />
        <Skeleton className="h-[280px] w-full" />
        <Grid>
          <Skeleton className="col-span-12 h-64 lg:col-span-7" />
          <Skeleton className="col-span-12 h-64 lg:col-span-5" />
        </Grid>
      </div>
    );
  }

  if (state.kind === 'unconfigured') {
    return <NotConnected missing={state.missing} propertyConfigured={state.propertyConfigured} />;
  }

  if (state.kind === 'error') {
    return <Panel><ErrorState message={state.message} onRetry={reload} /></Panel>;
  }

  return <Report_ data={state.data} cached={state.cached} compare={compare} />;
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
      <SectionHeader title="Not connected" />
      <div className="grid gap-4 px-4 py-5">
        <p className="max-w-prose text-sm text-haze">
          Portal Analytics is built and waiting for credentials. Reporting needs a Google service
          account with read access to the GA4 property — a separate thing from the measurement tag
          on the public site, which is already live and collecting.
        </p>
        {missing.length > 0 && (
          <div>
            <p className="label mb-1.5">Missing in the Netlify function environment</p>
            <ul className="grid gap-1">
              {missing.map((name) => <li key={name} className="num text-xs text-paper">{name}</li>)}
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

/* ================================================================ the page */

function Report_({ data, cached, compare }: { data: Report; cached: boolean; compare: boolean }) {
  return (
    <div className="grid gap-6">
      <Section id="overview" title="Overview">
        <Overview data={data} compare={compare} />
      </Section>

      <Section id="traffic" title="Traffic">
        <TrafficSection data={data} compare={compare} />
      </Section>

      <Section id="acquisition" title="Acquisition">
        <AcquisitionSection data={data} />
      </Section>

      <Section id="content" title="Content">
        <ContentSection data={data} />
      </Section>

      <Section id="conversion" title="Conversion">
        <ConversionSection data={data} />
      </Section>

      <Section id="audience" title="Audience">
        <AudienceSection data={data} />
      </Section>

      <MeasurementNote data={data} cached={cached} />
    </div>
  );
}

/**
 * A section of the page, with an anchor and a rule.
 *
 * The heading sits OUTSIDE the panels below it, which is the whole difference
 * between "six sections" and "nine cards": a title above a rule says the things
 * under it belong together, where a title inside a bordered box says only that
 * the box has a name.
 */
function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="scroll-mt-20">
      <div className="mb-2.5 flex items-center gap-3">
        <h2 id={`${id}-heading`} className="t-section text-chrome">{title}</h2>
        <span className="h-px flex-1 bg-hairline" aria-hidden="true" />
      </div>
      {children}
    </section>
  );
}

/* ============================================================== 1 overview */

function Overview({ data, compare }: { data: Report; compare: boolean }) {
  const now = data.overview.current;
  const was = data.overview.previous;
  const d = (a: number, b: number) => (compare ? <Delta value={delta(a, b)} /> : undefined);

  return (
    <MetricStrip label="Key figures" className="xl:grid-cols-6">
      <MetricCell label="Active users" value={n(now.activeUsers)} delta={d(now.activeUsers, was.activeUsers)} />
      <MetricCell label="Sessions" value={n(now.sessions)} delta={d(now.sessions, was.sessions)} />
      <MetricCell label="Views" value={n(now.screenPageViews)} delta={d(now.screenPageViews, was.screenPageViews)} />
      <MetricCell label="New users" value={n(now.newUsers)} delta={d(now.newUsers, was.newUsers)} />
      <MetricCell
        label="Lead events"
        value={n(now.leadEvents)}
        delta={d(now.leadEvents, was.leadEvents)}
        note="form & questionnaire success"
      />
      <MetricCell
        label="Conversion"
        value={pct(now.leadRate, 2)}
        delta={compare && now.leadRate !== null && was.leadRate !== null
          ? <Delta value={delta(now.leadRate, was.leadRate)} /> : undefined}
        note="lead events / session"
      />
    </MetricStrip>
  );
}

/* =============================================================== 2 traffic */

type Metric = 'activeUsers' | 'sessions' | 'screenPageViews';

const METRICS: { id: Metric; label: string }[] = [
  { id: 'activeUsers', label: 'Users' },
  { id: 'sessions', label: 'Sessions' },
  { id: 'screenPageViews', label: 'Views' },
];

function TrafficSection({ data, compare }: { data: Report; compare: boolean }) {
  const [metric, setMetric] = useState<Metric>('sessions');

  const baseline = useMemo(() => {
    if (!compare) return null;
    const points = data.trend.points.length;
    if (points === 0) return null;
    const mean = data.overview.previous[metric] / points;
    return mean > 0
      ? { value: mean, label: `previous period, ${Math.round(mean).toLocaleString('en-GB')} avg` }
      : null;
  }, [compare, data, metric]);

  return (
    <Panel>
      <SectionHeader
        title={METRICS.find((m) => m.id === metric)!.label}
        note={data.rangeLabel.toLowerCase()}
        action={<Segmented label="Metric" value={metric} options={METRICS} onChange={setMetric} />}
        level={3}
      />
      <TrendChart
        points={data.trend.points.map((p) => p[metric])}
        labels={data.trend.points.map((p) => trendLabel(p.at, data.trend.grain))}
        label={`${METRICS.find((m) => m.id === metric)!.label} · ${data.rangeLabel.toLowerCase()}`}
        baseline={baseline}
        height={260}
      />
      {/*
        Why there is no second curve.

        GA4's Data API returns one time series for the range that was asked for.
        The previous period's TOTAL is in the payload; its shape is not. A dashed
        rule at the previous period's mean is the honest form of that fact — the
        alternative would be drawing a curve nobody measured.
      */}
      {compare && (
        <p className="t-note border-t border-hairline px-4 py-2">
          The dashed rule is the previous period&rsquo;s <span className="text-paper">average per
          interval</span>. GA4 returns one series per request, so the previous period has a level
          here but not a shape.
        </p>
      )}
    </Panel>
  );
}

/* =========================================================== 3 acquisition */

type Grain = 'source' | 'campaign';

function AcquisitionSection({ data }: { data: Report }) {
  const [grain, setGrain] = useState<Grain>('source');

  /**
   * Source/medium, with campaigns folded in.
   *
   * The endpoint returns one row per source × medium × campaign. Reading that
   * raw makes `google / cpc` appear five times, once per campaign, which is the
   * campaign view wearing the source view's clothes. So the two tabs are two
   * genuine aggregations of the same rows rather than two slices of one.
   */
  const rows = useMemo(() => {
    const by = new Map<string, {
      key: string; sessions: number; activeUsers: number; engaged: number; leadEvents: number;
    }>();
    for (const row of data.acquisition) {
      const key = grain === 'source' ? `${row.source} / ${row.medium}` : row.campaign;
      const seen = by.get(key) ?? { key, sessions: 0, activeUsers: 0, engaged: 0, leadEvents: 0 };
      seen.sessions += row.sessions;
      seen.activeUsers += row.activeUsers;
      // Engagement is a rate per row, so it has to be re-weighted by sessions
      // before it can be summed — averaging the rates would give a two-session
      // row the same say as a two-thousand-session one.
      seen.engaged += (row.engagementRate ?? 0) * row.sessions;
      seen.leadEvents += row.leadEvents;
      by.set(key, seen);
    }
    return [...by.values()].sort((a, b) => b.sessions - a.sessions);
  }, [data.acquisition, grain]);

  const max = Math.max(...rows.map((r) => r.sessions), 1);

  return (
    <Panel className="min-w-0">
      <SectionHeader
        title={grain === 'source' ? 'Source / medium' : 'Campaign'}
        note="GA4 session-scoped attribution"
        level={3}
        action={
          <Segmented
            label="Acquisition breakdown"
            value={grain}
            options={[{ id: 'source' as const, label: 'Source / medium' }, { id: 'campaign' as const, label: 'Campaign' }]}
            onChange={setGrain}
          />
        }
      />
      {rows.length === 0 ? (
        <DataState kind="empty" title="No sessions" body="Nothing arrived in this range." />
      ) : (
        <Table
          head={[
            grain === 'source' ? 'Source / medium' : 'Campaign',
            { label: 'Sessions', align: 'right' },
            { label: 'Users', align: 'right' },
            { label: 'Engaged', align: 'right' },
            { label: 'Leads', align: 'right' },
            { label: 'CVR', align: 'right' },
          ]}
          minWidth={720}
        >
          {rows.map((row) => (
            <Row key={row.key}>
              <Cell className="min-w-0">
                {/* Text, never a link. Source and campaign strings come from
                    whatever a referring site put in a header, or from whatever
                    somebody typed into a UTM parameter. `break-all` because
                    `spring-2026-kkv-remarketing-lookalike-1pct` is an ordinary
                    campaign name and a 48-character unbroken token in a table
                    cell sets that column's min-content width. */}
                <span className="break-all text-xs text-paper">{row.key || '(not set)'}</span>
                <Meter value={row.sessions} max={max} />
              </Cell>
              <Cell align="right" className="num text-xs text-paper">{n(row.sessions)}</Cell>
              <Cell align="right" className="num text-xs text-haze">{n(row.activeUsers)}</Cell>
              <Cell align="right" className="num text-xs text-haze">
                {pct(row.sessions > 0 ? row.engaged / row.sessions : null, 0)}
              </Cell>
              <Cell align="right" className="num text-xs">
                <span className={row.leadEvents > 0 ? 'text-paper' : 'text-haze'}>{n(row.leadEvents)}</span>
              </Cell>
              <Cell align="right" className="num text-xs text-haze">
                {pct(row.sessions > 0 ? row.leadEvents / row.sessions : null, 2)}
              </Cell>
            </Row>
          ))}
        </Table>
      )}
    </Panel>
  );
}

/* =============================================================== 4 content */

function ContentSection({ data }: { data: Report }) {
  const [view, setView] = useState<'pages' | 'landing'>('pages');

  return (
    <Panel className="min-w-0">
      <SectionHeader
        title={view === 'pages' ? 'Top pages' : 'Landing pages'}
        level={3}
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
          <DataState kind="empty" title="No page views" body="Nothing was viewed in this range." />
        ) : (
          <Table
            head={[
              'Page',
              { label: 'Views', align: 'right' },
              { label: 'Users', align: 'right' },
              { label: 'Avg. time', align: 'right' },
              { label: 'Leads', align: 'right' },
            ]}
            minWidth={720}
          >
            {data.pages.map((row) => (
              <Row key={row.path}>
                <Cell className="min-w-0">
                  <span className="break-words text-xs text-paper">{row.title || row.path}</span>
                  <span className="num mt-0.5 block break-all text-[10px] text-haze">{row.path}</span>
                  <Meter value={row.views} max={Math.max(...data.pages.map((p) => p.views), 1)} />
                </Cell>
                <Cell align="right" className="num text-xs text-paper">{n(row.views)}</Cell>
                <Cell align="right" className="num text-xs text-haze">{n(row.activeUsers)}</Cell>
                <Cell align="right" className="num text-xs text-haze">{duration(row.engagementPerUser)}</Cell>
                <Cell align="right" className="num text-xs">
                  <span className={row.leadEvents > 0 ? 'text-paper' : 'text-haze'}>{n(row.leadEvents)}</span>
                </Cell>
              </Row>
            ))}
          </Table>
        )
      ) : data.landingPages.length === 0 ? (
        <DataState kind="empty" title="No landing pages" body="No sessions started in this range." />
      ) : (
        <Table
          head={[
            'Landing page',
            { label: 'Sessions', align: 'right' },
            { label: 'Users', align: 'right' },
            { label: 'Bounce', align: 'right' },
            { label: 'Leads', align: 'right' },
            { label: 'CVR', align: 'right' },
          ]}
          minWidth={720}
        >
          {data.landingPages.map((row) => (
            <Row key={row.path}>
              <Cell className="min-w-0">
                <span className="num break-all text-xs text-paper">{row.path}</span>
                <Meter value={row.sessions} max={Math.max(...data.landingPages.map((p) => p.sessions), 1)} />
              </Cell>
              <Cell align="right" className="num text-xs text-paper">{n(row.sessions)}</Cell>
              <Cell align="right" className="num text-xs text-haze">{n(row.activeUsers)}</Cell>
              <Cell align="right" className="num text-xs text-haze">{pct(row.bounceRate, 0)}</Cell>
              <Cell align="right" className="num text-xs">
                <span className={row.leadEvents > 0 ? 'text-paper' : 'text-haze'}>{n(row.leadEvents)}</span>
              </Cell>
              <Cell align="right" className="num text-xs text-haze">{pct(row.leadRate, 2)}</Cell>
            </Row>
          ))}
        </Table>
      )}

      <p className="t-note border-t border-hairline px-4 py-2.5">
        {view === 'pages'
          ? 'Leads here are enquiries sent FROM that page.'
          : 'Leads here are enquiries attributed to the session that STARTED on that page — which is the number an ad campaign is judged on.'}
      </p>
    </Panel>
  );
}

/* ============================================================ 5 conversion */

/**
 * The same journey the Dashboard shows, with the depth the Dashboard has no
 * room for: the stages beside the raw event counts that produced them.
 *
 * That pairing is the point of this section. The Dashboard says conversion
 * moved; this says which event moved, which is the only form of the answer
 * anybody can act on.
 */
function ConversionSection({ data }: { data: Report }) {
  const byForm = useMemo(() => {
    // The taxonomy splits the same step across the contact form and the quote
    // questionnaire. Naming them is worth more than a single total, because
    // they are two different products with two different failure modes.
    const label = (name: string) =>
      name.startsWith('questionnaire') ? 'Questionnaire' : name.startsWith('form') ? 'Form' : 'CTA';
    const out = new Map<string, number>();
    for (const event of data.events) out.set(label(event.name), (out.get(label(event.name)) ?? 0) + event.count);
    return [...out.entries()].map(([key, value]) => ({ key, value })).sort((a, b) => b.value - a.value);
  }, [data.events]);

  return (
    <Grid>
      <Panel className="col-span-12 min-w-0 lg:col-span-5">
        <SectionHeader title="Conversion path" level={3} note={data.rangeLabel.toLowerCase()} />
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
        <p className="t-note border-t border-hairline px-4 py-2.5">
          Stages after the first are <span className="text-paper">event counts</span>, not unique
          users: one visitor who clicks two CTAs is counted twice. GA4&rsquo;s user-scoped funnel is
          an Exploration and is not available through the Data API.
        </p>
      </Panel>

      <div className="col-span-12 grid min-w-0 gap-4 lg:col-span-7">
        <Panel className="min-w-0">
          <SectionHeader title="Events behind the stages" level={3} />
          {data.events.length === 0 ? (
            <DataState kind="empty" title="No events" body="No funnel event fired in this range." />
          ) : (
            <Table head={['Event', { label: 'Count', align: 'right' }]} minWidth={560}>
              {data.events.map((event) => (
                <Row key={event.name}>
                  <Cell className="num break-all text-xs text-paper">{event.name}</Cell>
                  <Cell align="right" className="num text-xs text-haze">{n(event.count)}</Cell>
                </Row>
              ))}
            </Table>
          )}
        </Panel>

        <Panel className="min-w-0">
          <SectionHeader title="By surface" level={3} note="which product the interaction was in" />
          <BarList rows={byForm} empty="No events to group." />
        </Panel>
      </div>
    </Grid>
  );
}

/* ============================================================== 6 audience */

/**
 * Aggregate segments, and only aggregate segments.
 *
 * Device, and nothing that could identify anybody. There is no visitor list
 * here, no session replay and no individual anything — GA4's Data API can
 * return dimensions this Portal deliberately never asks for. Country and locale
 * are absent for the same reason they are absent from the endpoint: they are not
 * in the report, and adding them is a backend change with a privacy question
 * attached, not a layout decision.
 */
function AudienceSection({ data }: { data: Report }) {
  const total = data.devices.reduce((sum, d) => sum + d.sessions, 0);

  return (
    <Panel className="min-w-0">
      <SectionHeader title="Device" level={3} note="mobile ≠ desktop here" />
      {data.devices.length === 0 ? (
        <DataState kind="empty" title="No sessions" body="Nothing to break down in this range." />
      ) : (
        <Table
          head={[
            'Device',
            { label: 'Sessions', align: 'right' },
            { label: 'Share', align: 'right' },
            { label: 'Users', align: 'right' },
            { label: 'Engaged', align: 'right' },
            { label: 'Leads', align: 'right' },
            { label: 'CVR', align: 'right' },
          ]}
          minWidth={720}
        >
          {data.devices.map((row) => (
            <Row key={row.device}>
              <Cell className="min-w-0">
                <span className="text-xs capitalize text-paper">{row.device}</span>
                <Meter value={row.sessions} max={Math.max(...data.devices.map((d) => d.sessions), 1)} />
              </Cell>
              <Cell align="right" className="num text-xs text-paper">{n(row.sessions)}</Cell>
              <Cell align="right" className="num text-xs text-haze">
                {pct(total > 0 ? row.sessions / total : null, 0)}
              </Cell>
              <Cell align="right" className="num text-xs text-haze">{n(row.activeUsers)}</Cell>
              <Cell align="right" className="num text-xs text-haze">{pct(row.engagementRate, 0)}</Cell>
              <Cell align="right" className="num text-xs">
                <span className={row.leadEvents > 0 ? 'text-paper' : 'text-haze'}>{n(row.leadEvents)}</span>
              </Cell>
              <Cell align="right" className="num text-xs text-haze">{pct(row.leadRate, 2)}</Cell>
            </Row>
          ))}
        </Table>
      )}
      {/* The public site is two genuinely different experiences. This section is
          the only place that difference is measurable, and saying so is what
          stops it reading as a stock breakdown nobody acts on. */}
      <p className="t-note border-t border-hairline px-4 py-2.5">
        The public site ships a separate portrait-mobile composition. A gap in the lead rate between
        the two is a product signal, not a device fact.
      </p>
    </Panel>
  );
}

/* ===================================================================== note */

function MeasurementNote({ data, cached }: { data: Report; cached: boolean }) {
  return (
    <Panel className="px-4 py-3.5">
      <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
        <p className="max-w-prose text-xs leading-relaxed text-haze">
          <span className="text-paper">Analytics reflects traffic where analytics measurement was permitted.</span>{' '}
          Google Analytics loads only after a visitor accepts it, and a visitor who declines is never
          contacted by Google at all — so real traffic is higher than every figure above by an amount
          this property cannot know. GA4 terms are used as GA4 defines them: a session is a visit,
          not a person.
        </p>
        <dl className="grid gap-1 lg:text-right">
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
    <div className={cn('flex flex-wrap items-baseline gap-2 lg:justify-end')}>
      <dt className="label">{term}</dt>
      <dd className="num text-[10px] text-haze">{value}</dd>
    </div>
  );
}

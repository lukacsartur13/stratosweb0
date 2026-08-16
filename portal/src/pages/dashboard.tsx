import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useRows } from '@/lib/useRows';
import { useAuth } from '@/features/auth/AuthProvider';
import { can } from '@/lib/permissions';
import { useScope } from '@/lib/scope';
import { Grid } from '@/components/shell/PortalShell';
import {
  Cell, DataState, MetricCell, MetricStrip, NoFigure, Panel, Row, SectionHeader, Skeleton,
  StatusPill, Table, cn,
} from '@/components/ui';
import { BarList, Delta, Funnel, Meter, Segmented, TrendChart } from '@/components/charts';
import { moneyCompact, primaryTotal, sumByCurrency } from '@/lib/money';
import {
  STAGE, bucket, dealAttention, dueTone, projectAttention, projectStatusLabel,
  projectStatusTone, rankAttention, shortDate, stageDistribution,
} from '@/lib/pipeline';
import { useAttribution, useDashboardOperations, useSalesSummary } from '@/lib/business';
import {
  RANGE_DAYS, delta, n, pct, trendLabel, useAnalytics, type Report,
} from '@/lib/analytics';
import { useHealth, type Health } from '@/lib/health';
import {
  FACETS, LEAD_COLUMNS, formatWhen, groupBy, leadSource, since, statusLabel,
  statusTone, today, type Lead,
} from '@/lib/leads';

/**
 * THE DASHBOARD — decisions.
 *
 * ## The ten-second contract
 *
 * Somebody opens this between two other things. §56 sets the bar: within about
 * fifteen seconds they must be able to read the traffic level, the leads, the
 * conversion, the pipeline value, the weighted pipeline, the won value, the
 * deals needing action, the active project count, the strongest acquisition
 * source and the system health — WITHOUT visiting another route.
 *
 * Every block on this screen answers one of those. Nothing on it answers
 * anything else.
 *
 * The order is fixed and is not a taste:
 *
 *   01  executive summary      what the business is doing
 *   02  traffic + live         what the website is doing
 *   03  pipeline + conversion  what is likely to close, and what converts
 *   04  acquisition + revenue  where it comes from, and what it is worth
 *   05  recent leads + projects  the work in front of us
 *   06  needs attention        what to do about it
 *   07  system status          whether anything is broken
 *
 * It runs from what you decide with to what you fix.
 *
 * ## What P2 did NOT do to this screen
 *
 * It did not become a mosaic. Three panels were added and one figure was
 * dropped from the strip; the section count went from six to seven, not to
 * twelve. §47's instruction when a Dashboard gets noisy is to reduce
 * information, not to add widgets — so the pipeline is a summary with a link
 * rather than a board, revenue attribution is four rows rather than a table, and
 * "recent opportunities" was deliberately NOT added as a sixth table, because
 * the pipeline block already shows the shape of the book and the attention list
 * already names the individual deals that need something doing.
 *
 * ## Why it draws from three sources and still loads once per source
 *
 * Leads come from Supabase through RLS, analytics from the GA4 function, health
 * from the health function. Three requests, in parallel, each with its own
 * failure: a Google outage must not blank the lead figures, and a database that
 * is slow must not delay the traffic panel. Every block below renders its own
 * state, so the screen is useful the moment any one of them lands.
 *
 * ## Roles
 *
 * A team member can reach this screen and cannot read property-wide analytics.
 * The analytics blocks are not merely hidden for them — the request is not made
 * at all, because a 403 rendered as an error is a screen telling somebody they
 * are broken when they are simply not an admin.
 *
 * ## What is NOT here
 *
 * The full System readout, which is what `/system` is for; the whole pipeline,
 * which is Leads' status strip; and pipeline value, which does not exist in
 * this system and is therefore not invented.
 */

export function DashboardScreen() {
  const { profile } = useAuth();
  const { range, environment, reloadToken, compare } = useScope();
  const mayAnalytics = can(profile?.role, 'view_analytics');
  const maySystem = can(profile?.role, 'view_system');
  const maySales = can(profile?.role, 'view_sales');
  const mayProjects = can(profile?.role, 'view_projects');

  const leads = useRows<Lead>('leads', LEAD_COLUMNS, 'created_at', reloadToken);
  const { state: analytics } = useAnalytics(range, environment, mayAnalytics, reloadToken);
  const { state: health } = useHealth(maySystem, reloadToken);

  // The commercial layer. `summary` is server-aggregated (§59) and `operations`
  // is two bounded, filtered reads — see `useDashboardOperations`. Neither loads
  // the pipeline, the client book or the project list.
  const summary = useSalesSummary(maySales, reloadToken);
  const operations = useDashboardOperations(maySales || mayProjects, reloadToken);

  const rows = leads.rows;
  const ready = leads.state === 'ready';
  const traffic = analytics.kind === 'ready' ? analytics.data : null;

  // §36 — the attribution call is made only when there is won revenue to
  // attribute. On an account with an empty pipeline this request is never sent
  // and the block degrades to nothing rather than to a table of zeroes.
  const wonExists = bucket(summary.rows, 'won_all').some((r) => r.items > 0);
  const attribution = useAttribution('source', maySales && wonExists, reloadToken);

  return (
    <div className="grid gap-4">
      {/* 01 */}
      <ExecutiveStrip
        rows={rows}
        leadsReady={ready}
        analytics={analytics}
        traffic={traffic}
        mayAnalytics={mayAnalytics}
        maySales={maySales}
        summary={summary}
        compare={compare}
      />

      {/* 02 */}
      {mayAnalytics && (
        <Grid>
          <TrafficPulse traffic={traffic} loading={analytics.kind === 'loading'} compare={compare} />
          <LivePanel analytics={analytics} traffic={traffic} />
        </Grid>
      )}

      {/* 03 */}
      <Grid>
        {maySales && <PipelineBlock summary={summary} />}
        {mayAnalytics && <ConversionPath traffic={traffic} loading={analytics.kind === 'loading'} wide={!maySales} />}
      </Grid>

      {/* 04 */}
      <Grid>
        {mayAnalytics && (
          <Acquisition
            traffic={traffic}
            leads={rows}
            loading={analytics.kind === 'loading'}
            wide={!maySales || !wonExists}
          />
        )}
        {maySales && wonExists && <TopRevenueSources rows={attribution.rows} state={attribution.state} />}
      </Grid>

      {/* 05 */}
      <Grid>
        <RecentLeads rows={rows} state={leads.state} />
        {mayProjects && <ActiveProjects projects={operations.projects} state={operations.state} />}
      </Grid>

      {/* 06 + 07 */}
      <Grid>
        <Attention
          rows={rows}
          leadsReady={ready}
          analytics={analytics}
          health={health}
          deals={operations.deals}
          projects={operations.projects}
          maySales={maySales}
        />
        <SystemLine health={health} maySystem={maySystem} />
      </Grid>
    </div>
  );
}

/* ================================================== 01 — executive summary */

type AnalyticsState = ReturnType<typeof useAnalytics>['state'];

/**
 * One surface, five figures, one baseline.
 *
 * Not five cards: a common background, hairline dividers, and every value at
 * the same height so the eye reads across rather than down.
 *
 * ## What P2 changed here, and why
 *
 * The strip used to be Active users · Sessions · Leads · Conversion · Realtime.
 * It is now Sessions · Leads · Conversion · Pipeline · Won MTD.
 *
 * Two figures left and two arrived, and §8 is explicit about the trade: a
 * commercial strip should immediately communicate *how much business is in
 * motion*, and "Realtime can remain visible in the Traffic/Live area instead of
 * consuming a primary business KPI slot if that produces better hierarchy". It
 * does. The Live panel one row below already prints the realtime count at 4xl in
 * yellow, which is a louder statement of the same fact than a strip cell was;
 * and Active users and Sessions were two readings of one thing, where Pipeline
 * and Won are two different questions the business could not previously ask at
 * all.
 *
 * NO figure in this strip is yellow any more, and that is deliberate. The accent
 * belonged to Realtime, Realtime moved to the Live panel, and it went with it.
 * Painting Won this month yellow instead would have been reusing the "true right
 * now" token for a month-to-date total.
 *
 * Every cell distinguishes the four ways of having nothing: a measured zero is
 * `0`, an absent service is an em dash with the reason, an unconfigured one
 * says so, and a role that may not read a figure is not shown the cell at all.
 */
function ExecutiveStrip({
  rows, leadsReady, analytics, traffic, mayAnalytics, maySales, summary, compare,
}: {
  rows: Lead[];
  leadsReady: boolean;
  analytics: AnalyticsState;
  traffic: Report | null;
  mayAnalytics: boolean;
  maySales: boolean;
  summary: ReturnType<typeof useSalesSummary>;
  compare: boolean;
}) {
  const { range } = useScope();
  const days = RANGE_DAYS[range];
  const leadCount = range === 'today' ? today(rows) : since(rows, days);
  const now = traffic?.overview.current;
  const was = traffic?.overview.previous;

  /** The same em dash and reason for every analytics cell, whatever went wrong. */
  const unavailable = (): { value: ReactNode; note: string } | null => {
    if (analytics.kind === 'loading') return { value: <Skeleton className="h-7 w-20" />, note: '' };
    if (analytics.kind === 'unconfigured') {
      return { value: <NoFigure reason="Analytics not configured" />, note: 'not configured' };
    }
    if (analytics.kind === 'error') {
      return { value: <NoFigure reason="Analytics unavailable" />, note: 'unavailable' };
    }
    return null;
  };
  const gap = unavailable();

  const periodNote = range === 'today' ? 'today' : `last ${days} days`;

  // The two commercial figures. Both are the database's own sums, per currency,
  // and neither is a client-side total over a truncated list.
  const openTotal = primaryTotal(sumByCurrency(bucket(summary.rows, 'open')));
  const wonTotal = primaryTotal(sumByCurrency(bucket(summary.rows, 'won_mtd')));

  /** A commercial cell: the figure, or a measured nothing — never a fake zero. */
  const commercial = (total: typeof openTotal, weighted: boolean) => {
    if (summary.state === 'loading') return <Skeleton className="h-7 w-24" />;
    if (summary.state === 'error') return <NoFigure reason="The pipeline summary could not be read" />;
    const figure = total.total;
    if (!figure || figure.items === 0) return <span className="text-haze">0</span>;
    return moneyCompact(weighted ? figure.weighted : figure.value, figure.currency);
  };

  return (
    <MetricStrip label="Executive summary">
      {mayAnalytics && (
        <MetricCell
          label="Sessions"
          value={gap ? gap.value : n(now?.sessions)}
          delta={!gap && compare && now && was ? <Delta value={delta(now.sessions, was.sessions)} /> : undefined}
          note={gap ? gap.note : periodNote}
        />
      )}

      {/* The Portal's own count, from Supabase. It is here rather than GA4's
          lead-event total because this is the number the business acts on: a
          row that exists, with a name on it, that somebody has to answer. */}
      <MetricCell
        label="Leads"
        value={leadsReady ? leadCount : <Skeleton className="h-7 w-14" />}
        note={`${periodNote} · from the Portal`}
      />

      {mayAnalytics && (
        <MetricCell
          label="Conversion"
          value={gap ? gap.value : pct(now?.leadRate, 2)}
          delta={
            !gap && compare && now?.leadRate != null && was?.leadRate != null
              ? <Delta value={delta(now.leadRate, was.leadRate)} />
              : undefined
          }
          note={gap ? gap.note : 'lead events / session'}
        />
      )}

      {/* The two commercial figures: what is in motion, and what has landed. */}
      {maySales && (
        <MetricCell
          label="Pipeline"
          value={commercial(openTotal, false)}
          note={openTotal.total && openTotal.total.items > 0
            ? `${openTotal.total.items} open · ${moneyCompact(openTotal.total.weighted, openTotal.total.currency)} weighted`
            : 'no open opportunities'}
        />
      )}

      {maySales && (
        <MetricCell
          label="Won this month"
          // NOT `tone="live"`. That token exists for the one figure that is true
          // RIGHT NOW rather than true for a period, and month-to-date revenue is
          // emphatically a period figure. Reusing it here would have put two
          // yellow numbers in one strip and diluted the only thing the accent
          // means — which is exactly what P1's "yellow is scarce" budget exists
          // to catch, and it caught it.
          //
          // The figure earns its prominence from being a large number in the
          // executive strip, which is prominence enough.
          value={commercial(wonTotal, false)}
          note={wonTotal.total && wonTotal.total.items > 0
            ? `${wonTotal.total.items} ${wonTotal.total.items === 1 ? 'deal' : 'deals'}`
            : 'nothing closed yet'}
        />
      )}

      {!mayAnalytics && !maySales && (
        <MetricCell
          label="Unanswered"
          value={leadsReady ? rows.filter((l) => l.status === 'new').length : <Skeleton className="h-7 w-14" />}
          note="still at New"
        />
      )}
    </MetricStrip>
  );
}

/* ==================================================== 03 — the pipeline == */

/**
 * PIPELINE (§9) — the shape of the commercial book, and nothing more.
 *
 * A compact stage distribution with a total and a weighted total, exactly as §9
 * specifies. Deliberately NOT a Kanban: this is a summary screen, the board is
 * one click away, and a drag-and-drop surface embedded in a dashboard is a
 * surface somebody moves a deal on by accident while scrolling.
 *
 * The figures come from `portal_sales_summary()`, so the Dashboard prints the
 * pipeline without loading a single opportunity.
 */
function PipelineBlock({ summary }: { summary: ReturnType<typeof useSalesSummary> }) {
  const stages = stageDistribution(summary.rows);
  const open = primaryTotal(sumByCurrency(bucket(summary.rows, 'open')));
  const max = Math.max(...stages.map((s) => s.value), 1);
  const anything = stages.some((s) => s.items > 0);

  return (
    <Panel className="col-span-12 min-w-0 lg:col-span-5">
      <SectionHeader
        title="Pipeline"
        note="open opportunities"
        action={
          <Link to="/sales" className="t-note inline-flex items-center gap-1 underline underline-offset-4 hover:text-paper">
            Opportunities <ArrowRight size={11} aria-hidden="true" />
          </Link>
        }
      />

      {summary.state === 'loading' && (
        <div className="space-y-1.5 p-4" aria-busy="true">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-7 w-full" />)}
        </div>
      )}

      {summary.state === 'error' && (
        <DataState
          kind="unavailable"
          title="Unavailable"
          body="The pipeline summary could not be read. It needs the P2 migration to have been applied."
        />
      )}

      {summary.state === 'unconfigured' && (
        <DataState kind="unconfigured" title="Not connected" body="No database is configured in this environment." />
      )}

      {summary.state === 'ready' && !anything && (
        <DataState
          kind="empty"
          title="No open opportunities"
          body="The pipeline is what qualified leads become. Nothing is in it yet."
          action={<Link to="/leads?status=qualified"><span className="t-note underline underline-offset-4">Convert a qualified lead</span></Link>}
        />
      )}

      {summary.state === 'ready' && anything && (
        <>
          <table className="w-full border-collapse">
            <caption className="sr-only">Open opportunities by stage</caption>
            <tbody>
              {stages.map((stage) => (
                <tr key={stage.stage} className="border-b border-hairline last:border-0">
                  <th scope="row" className="px-4 py-1.5 text-left font-normal">
                    <span className="t-section">{STAGE[stage.stage].label}</span>
                    <span className="mt-1 block"><Meter value={stage.value} max={max} /></span>
                  </th>
                  <td className="num w-12 px-2 py-1.5 text-right text-xs text-haze">{stage.items}</td>
                  <td className="num w-24 px-4 py-1.5 text-right text-xs text-paper">
                    {stage.items === 0 ? '—' : moneyCompact(stage.value, stage.currency ?? 'HUF')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* The two figures the whole panel exists to produce. */}
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-t border-hair px-4 py-2.5">
            <span className="t-section">Total</span>
            <span className="num text-sm text-paper">
              {open.total ? moneyCompact(open.total.value, open.total.currency) : '—'}
            </span>
            <span className="t-section">Weighted</span>
            <span className="num text-sm text-chrome">
              {open.total ? moneyCompact(open.total.weighted, open.total.currency) : '—'}
            </span>
          </div>
          {open.others > 0 && (
            <p className="t-note border-t border-hairline px-4 py-1.5 text-signal">
              {open.others} more in {open.otherCurrencies.join(', ')} — not added in, because nothing
              here converts between currencies.
            </p>
          )}
        </>
      )}
    </Panel>
  );
}

/* ============================================== 04 — where revenue came from */

/**
 * TOP REVENUE SOURCES (§36) — compact, and only when it is true.
 *
 * Not the whole attribution table: that is Analytics' job and putting it here
 * would be the second copy of a screen that §36 explicitly rules out. Three rows
 * and a link.
 *
 * The panel is not rendered at all unless won revenue exists, and the request
 * behind it is not even made — see `wonExists` in `DashboardScreen`. A revenue
 * block reading "Google / organic — 0 Ft" on a business that has closed nothing
 * is worse than no block.
 */
function TopRevenueSources({
  rows, state,
}: { rows: ReturnType<typeof useAttribution>['rows']; state: string }) {
  const top = rows.filter((r) => r.won_value > 0).slice(0, 4);
  const max = Math.max(...top.map((r) => r.won_value), 1);

  return (
    <Panel className="col-span-12 min-w-0 lg:col-span-5">
      <SectionHeader
        title="Top revenue sources"
        note="won value by acquisition source"
        action={
          <Link to="/analytics#revenue" className="t-note inline-flex items-center gap-1 underline underline-offset-4 hover:text-paper">
            Attribution <ArrowRight size={11} aria-hidden="true" />
          </Link>
        }
      />
      {state === 'loading' ? (
        <div className="space-y-1.5 p-4" aria-busy="true">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-7 w-full" />)}
        </div>
      ) : top.length === 0 ? (
        <DataState
          kind="empty"
          title="No attributed revenue"
          body="Won deals exist, but none of them carries an acquisition source."
        />
      ) : (
        <table className="w-full border-collapse">
          <caption className="sr-only">Won value by acquisition source</caption>
          <tbody>
            {top.map((row) => (
              <tr key={row.key} className="border-b border-hairline last:border-0">
                {/* Text, never a link. A source string is whatever a referring
                    site put in a header. */}
                <th scope="row" className="min-w-0 px-4 py-2 text-left font-normal">
                  <span className="break-words text-xs text-paper">{row.key}</span>
                  <span className="mt-1 block"><Meter value={row.won_value} max={max} /></span>
                </th>
                <td className="num w-24 px-4 py-2 text-right text-xs text-paper">
                  {row.won_currencies > 1
                    // Two currencies behind one figure. The count is true; the
                    // sum would not be, so it is not printed.
                    ? <span className="text-haze" title="Won in more than one currency">mixed</span>
                    : moneyCompact(row.won_value, row.won_currency ?? 'HUF')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

/* ============================================== 05 — the delivery readout */

/**
 * ACTIVE PROJECTS (§57) — four to six rows, and a link.
 *
 * Not a project management wall. Four columns: what, for whom, where it is, when
 * it is due — which is the whole of what a person scanning a dashboard needs to
 * know about delivery. Sorted by target date, soonest first, so the row that
 * matters is the first one.
 */
function ActiveProjects({
  projects, state,
}: { projects: ReturnType<typeof useDashboardOperations>['projects']; state: string }) {
  return (
    <Panel className="col-span-12 min-w-0 lg:col-span-5">
      <SectionHeader
        title="Active projects"
        note={projects.length > 0 ? `${projects.length} live` : undefined}
        action={
          <Link to="/projects" className="t-note inline-flex items-center gap-1 underline underline-offset-4 hover:text-paper">
            All projects <ArrowRight size={11} aria-hidden="true" />
          </Link>
        }
      />
      {state === 'loading' ? (
        <div className="space-y-1.5 p-4" aria-busy="true">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-8 w-full" />)}
        </div>
      ) : projects.length === 0 ? (
        <DataState
          kind="empty"
          title="No active projects"
          body="A project is created from a won opportunity, which keeps the delivery connected to what sold it."
        />
      ) : (
        <Table head={['Project', 'Client', 'Status', 'Target']} minWidth={560}>
          {projects.slice(0, 6).map((project) => {
            const tone = dueTone(project.target_date);
            return (
              <Row key={project.id}>
                <Cell className="min-w-0">
                  <Link to={`/projects/${project.id}`} className="text-[13px] text-paper hover:text-signal">
                    {project.name}
                  </Link>
                </Cell>
                <Cell className="truncate text-[11px] text-haze">{project.client?.name ?? '—'}</Cell>
                <Cell>
                  <StatusPill tone={projectStatusTone(project.status)}>
                    {projectStatusLabel(project.status)}
                  </StatusPill>
                </Cell>
                <Cell className={cn(
                  'num whitespace-nowrap text-[11px]',
                  tone === 'overdue' ? 'text-danger' : tone === 'today' ? 'text-signal' : 'text-haze',
                )}>
                  {shortDate(project.target_date)}
                </Cell>
              </Row>
            );
          })}
        </Table>
      )}
    </Panel>
  );
}

/* ====================================================== 02 — traffic pulse */

type Metric = 'activeUsers' | 'sessions' | 'screenPageViews';

const METRICS: { id: Metric; label: string }[] = [
  { id: 'activeUsers', label: 'Users' },
  { id: 'sessions', label: 'Sessions' },
  { id: 'screenPageViews', label: 'Views' },
];

function TrafficPulse({
  traffic, loading, compare,
}: { traffic: Report | null; loading: boolean; compare: boolean }) {
  const [metric, setMetric] = useState<Metric>('sessions');

  const baseline = useMemo(() => {
    if (!compare || !traffic) return null;
    const points = traffic.trend.points.length;
    if (points === 0) return null;
    const total = traffic.overview.previous[metric];
    const mean = total / points;
    return mean > 0
      ? { value: mean, label: `previous period, ${Math.round(mean).toLocaleString('en-GB')} avg` }
      : null;
  }, [compare, traffic, metric]);

  return (
    <Panel className="col-span-12 min-w-0 lg:col-span-8">
      <SectionHeader
        title="Traffic"
        note={traffic?.rangeLabel.toLowerCase()}
        action={<Segmented label="Metric" value={metric} options={METRICS} onChange={setMetric} />}
      />
      {loading ? (
        <div className="p-4" aria-busy="true"><Skeleton className="h-[200px] w-full" /></div>
      ) : !traffic ? (
        <DataState kind="unconfigured" title="No traffic data" body="Analytics is not available for this period." />
      ) : (
        <TrendChart
          points={traffic.trend.points.map((p) => p[metric])}
          labels={traffic.trend.points.map((p) => trendLabel(p.at, traffic.trend.grain))}
          label={METRICS.find((m) => m.id === metric)!.label}
          baseline={baseline}
        />
      )}
    </Panel>
  );
}

/**
 * LIVE — the one panel on this screen that is true right now.
 *
 * Deliberately distinct: the count is the largest figure on the row and the
 * only permanently yellow one, with the pages being viewed beneath it. And
 * `Analytics not configured` is NOT `0 active` — the difference between "nobody
 * is here" and "we cannot see" is the whole reason this panel is worth having.
 */
function LivePanel({ analytics, traffic }: { analytics: AnalyticsState; traffic: Report | null }) {
  const rt = traffic?.realtime ?? null;

  return (
    <Panel className="col-span-12 min-w-0 lg:col-span-4">
      <SectionHeader
        title="Live"
        action={
          rt ? (
            <span className="flex items-center gap-1.5">
              {/* A dot, not a pulsing animation. The panel is a readout, and
                  something blinking in the corner of an operational screen is a
                  thing you learn to ignore. */}
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-signal" aria-hidden="true" />
              <span className="t-note">last {rt.minutes} min</span>
            </span>
          ) : null
        }
      />

      {analytics.kind === 'loading' && (
        <div className="p-4" aria-busy="true"><Skeleton className="h-[180px] w-full" /></div>
      )}

      {analytics.kind === 'unconfigured' && (
        <DataState
          kind="unconfigured"
          title="Analytics not configured"
          body="No Google service account yet, so nobody can be counted — which is not the same as nobody being here."
        />
      )}

      {analytics.kind === 'error' && analytics.code !== 'DISABLED' && (
        <DataState kind="unavailable" title="Unavailable" body={analytics.message} />
      )}

      {analytics.kind === 'ready' && !rt && (
        <DataState
          kind="unavailable"
          title="Realtime unavailable"
          body="The realtime report could not be read. The figures above are unaffected — they come from a different Google endpoint."
        />
      )}

      {rt && (
        <>
          <div className="border-b border-hairline px-4 py-3">
            <p className="num text-4xl leading-none text-signal">{n(rt.activeUsersByPage)}</p>
            <p className="t-section mt-1.5">active now</p>
          </div>
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-hairline">
                <th scope="col" className="t-section px-4 py-1.5 text-left font-normal">Page</th>
                <th scope="col" className="t-section px-4 py-1.5 text-right font-normal">Active</th>
              </tr>
            </thead>
            <tbody>
              {rt.byPage.length === 0 && (
                <tr><td colSpan={2} className="px-4 py-5 text-center text-xs text-haze">Nobody on the site right now.</td></tr>
              )}
              {rt.byPage.slice(0, 6).map((page) => (
                <tr key={page.key} className="border-b border-hairline last:border-0">
                  {/* A text node. The key is a page title GA4 collected. */}
                  <td className="min-w-0 break-words px-4 py-1.5 text-xs text-paper">{page.key || '—'}</td>
                  <td className="num px-4 py-1.5 text-right text-xs text-paper">{page.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rt.environmentFiltered && (
            <p className="t-note border-t border-hairline px-4 py-2">
              Whole property — GA4 does not expose hostname on realtime reports.
            </p>
          )}
        </>
      )}
    </Panel>
  );
}

/* ========================================= 03 — conversion and acquisition */

function ConversionPath({
  traffic, loading, wide = false,
}: { traffic: Report | null; loading: boolean; wide?: boolean }) {
  return (
    <Panel className={cn('col-span-12 min-w-0', wide ? 'lg:col-span-12' : 'lg:col-span-7')}>
      <SectionHeader title="Conversion path" note="measured events" />
      {loading ? (
        <div className="p-4" aria-busy="true"><Skeleton className="h-48 w-full" /></div>
      ) : !traffic ? (
        <DataState kind="unconfigured" title="No conversion data" body="Analytics is not available for this period." />
      ) : (
        <>
          <Funnel stages={traffic.funnel} />
          {/*
            The qualification, next to the numbers rather than in a document.

            These are EVENT counts against a SESSION count at the entry, which is
            not a like-for-like ratio. GA4 can build a true user-scoped funnel,
            but only through Funnel Exploration, which the Data API does not
            expose. Showing event counts and saying what they are is honest;
            showing them under the word "funnel" without this line would not be.
          */}
          <p className="t-note border-t border-hairline px-4 py-2.5">
            Stages after the first are <span className="text-paper">event counts</span>, not unique
            users. Only events this property actually collects are shown.
          </p>
        </>
      )}
    </Panel>
  );
}

/**
 * Where it came from — GA4's attribution when there is any, and the Portal's
 * own when there is not.
 *
 * The two are different measurements of the same question and the panel says
 * which one it is showing. What it never does is join them: GA4 sessions and
 * named lead rows are not the same population, and a CVR built by dividing one
 * by the other would be a number with no meaning presented at two decimal
 * places.
 */
function Acquisition({
  traffic, leads, loading, wide = false,
}: { traffic: Report | null; leads: Lead[]; loading: boolean; wide?: boolean }) {
  const rows = traffic?.acquisition.slice(0, 6) ?? [];
  const max = Math.max(...rows.map((r) => r.sessions), 1);

  // Takes the whole row when there is no revenue block beside it — which is the
  // case on any account that has not won anything yet (§36 hides that block
  // rather than printing zeroes). A seven-column panel with five columns of
  // nothing next to it reads as a panel that failed to load.
  return (
    <Panel className={cn('col-span-12 min-w-0', wide ? 'lg:col-span-12' : 'lg:col-span-7')}>
      <SectionHeader
        title="Acquisition"
        note={traffic ? 'GA4 session-scoped' : 'from the leads themselves'}
        action={
          <Link to="/analytics" className="t-note underline underline-offset-4 hover:text-paper">
            Full breakdown
          </Link>
        }
      />
      {loading ? (
        <div className="p-4" aria-busy="true"><Skeleton className="h-40 w-full" /></div>
      ) : traffic ? (
        rows.length === 0 ? (
          <DataState kind="empty" title="No sessions" body="Nothing arrived in this period." />
        ) : (
          <Table
            head={[
              'Source',
              { label: 'Sessions', align: 'right' },
              { label: 'Leads', align: 'right' },
              { label: 'CVR', align: 'right' },
            ]}
            minWidth={560}
          >
            {rows.map((row) => (
              <Row key={`${row.source}|${row.medium}|${row.campaign}`}>
                <Cell>
                  {/* Text, never a link. A source string is whatever a referring
                      site put in a header. */}
                  <span className="break-words text-xs text-paper">{row.source}</span>
                  <span className="num ml-1.5 text-[10px] text-haze">/ {row.medium}</span>
                  <span className="mt-1 block h-px w-full bg-hairline" aria-hidden="true">
                    <span
                      className="block h-px bg-chrome/45"
                      style={{ width: `${((row.sessions / max) * 100).toFixed(2)}%` }}
                    />
                  </span>
                </Cell>
                <Cell align="right" className="num text-xs text-paper">{n(row.sessions)}</Cell>
                <Cell align="right" className="num text-xs">
                  <span className={row.leadEvents > 0 ? 'text-paper' : 'text-haze'}>{n(row.leadEvents)}</span>
                </Cell>
                <Cell align="right" className="num text-xs text-haze">{pct(row.leadRate, 2)}</Cell>
              </Row>
            ))}
          </Table>
        )
      ) : (
        <>
          {/* The Portal's own attribution, which needs no Google at all. It is a
              different measurement of the same question and it is the one that
              is always available. */}
          <BarList
            rows={groupBy(leads, FACETS[0].of, 6)}
            empty="No attribution recorded on these leads yet."
          />
          <p className="t-note border-t border-hairline px-4 py-2.5">
            Counted from each lead&rsquo;s own submission — sessions are not available, so no
            conversion rate is shown rather than one built from two populations.
          </p>
        </>
      )}
    </Panel>
  );
}

/* ========================================================= 04 — the leads */

function RecentLeads({ rows, state }: { rows: Lead[]; state: string }) {
  return (
    <Panel className="col-span-12 min-w-0 lg:col-span-7">
      <SectionHeader
        title="Recent leads"
        action={
          <Link to="/leads" className="t-note inline-flex items-center gap-1 underline underline-offset-4 hover:text-paper">
            View all leads <ArrowRight size={11} aria-hidden="true" />
          </Link>
        }
      />

      {state === 'loading' && (
        <div className="space-y-1.5 p-4" aria-busy="true">
          {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-8 w-full" />)}
        </div>
      )}

      {state === 'unconfigured' && (
        <DataState
          kind="unconfigured"
          title="Not connected"
          body="Supabase credentials are not set in this environment, so there is nothing to read yet."
        />
      )}

      {state === 'error' && (
        <DataState kind="unavailable" title="Unavailable" body="The lead list could not be read." />
      )}

      {state === 'ready' && rows.length === 0 && (
        <DataState
          kind="empty"
          title="No leads yet"
          body="Submissions from the public forms land here the moment they arrive."
        />
      )}

      {state === 'ready' && rows.length > 0 && (
        <Table head={['Time', 'Company / contact', 'Source', 'Status']} minWidth={560}>
          {rows.slice(0, 6).map((lead) => (
            <LeadRow key={lead.id} lead={lead} />
          ))}
        </Table>
      )}
    </Panel>
  );
}

/**
 * A clickable row — and the link inside it is the real affordance.
 *
 * The whole row navigates on click because that is what an operator expects of
 * a list they are working; the anchor in the second cell is what a keyboard
 * reaches, what a screen reader announces and what a middle click opens in a
 * tab. A row handler on its own would be a button no assistive technology can
 * find.
 */
export function LeadRow({ lead }: { lead: Lead }) {
  return (
    <Row>
      <Cell className="num whitespace-nowrap text-[11px] text-haze">{formatWhen(lead.created_at)}</Cell>
      <Cell className="min-w-0">
        <Link to={`/leads/${lead.id}`} className="text-[13px] text-paper hover:text-signal">
          {lead.company || lead.name}
        </Link>
        {lead.company && <span className="block truncate text-[11px] text-haze">{lead.name}</span>}
      </Cell>
      <Cell className="break-words text-[11px] text-haze">{leadSource(lead)}</Cell>
      <Cell><StatusPill tone={statusTone(lead.status)}>{statusLabel(lead.status)}</StatusPill></Cell>
    </Row>
  );
}

/* ====================================================== 05 — the attention */

interface Item { id: string; text: string; to: string; urgent?: boolean; because?: string }

/**
 * What actually needs doing, and nothing that does not.
 *
 * ## The four rules every item here obeys (§15)
 *
 *   1. It is derived from a condition that is actually STORED. There is no
 *      overdue invoice and no missing asset, because neither exists in this
 *      system and an invented one would be acted on.
 *   2. It EXPLAINS why it is there. Every commercial item carries a `because`,
 *      rendered under it, so an operator never has to guess what rule fired.
 *   3. It LINKS to the record.
 *   4. It DISAPPEARS when resolved. Nothing here is dismissed, snoozed or
 *      acknowledged — every item is recomputed from the data on every load, and
 *      fixing the data is the only way to clear it. That is what keeps this from
 *      becoming a notification inbox nobody reads.
 *
 * ## Where the commercial items come from
 *
 * `dealAttention` and `projectAttention` in `lib/pipeline.ts`, over the bounded
 * slice `useDashboardOperations` fetched. The rules are in that file rather than
 * this one so they can be tested directly — see `tests/portal-revenue.spec.ts`.
 *
 * When there is nothing, it says so in one line. A full-width green success
 * panel for "nothing is wrong" is a panel that trains you to skip the section.
 */
function Attention({
  rows, leadsReady, analytics, health, deals, projects, maySales,
}: {
  rows: Lead[];
  leadsReady: boolean;
  analytics: AnalyticsState;
  health: ReturnType<typeof useHealth>['state'];
  deals: ReturnType<typeof useDashboardOperations>['deals'];
  projects: ReturnType<typeof useDashboardOperations>['projects'];
  maySales: boolean;
}) {
  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    const hours = (iso: string) => (Date.now() - new Date(iso).getTime()) / 3_600_000;

    /* ---------------------------------------- the commercial rules */
    if (maySales) {
      const named = (recordId: string) => {
        const deal = deals.find((d) => d.id === recordId);
        return deal?.client?.name || deal?.company_name || deal?.title || 'An opportunity';
      };
      for (const item of dealAttention(deals.map((d) => ({
        id: d.id,
        stage: d.stage,
        estimated_value: d.estimated_value,
        currency: d.currency,
        probability: d.probability,
        expected_close_on: d.expected_close_on,
        next_action: d.next_action,
        next_action_on: d.next_action_on,
        organization_id: d.organization_id,
        archived_at: d.archived_at,
      })))) {
        out.push({
          id: item.id,
          to: item.to,
          urgent: item.urgent,
          text: `${named(item.record)} ${item.text}`,
          because: item.because,
        });
      }
    }

    // Delivery. `openMilestones` is deliberately absent — see the note in
    // `useDashboardOperations` on the query this screen does not make.
    for (const item of projectAttention(projects.map((p) => ({
      id: p.id, name: p.name, status: p.status, target_date: p.target_date,
      value: p.value, archived_at: p.archived_at,
    })))) {
      const project = projects.find((p) => p.id === item.record);
      out.push({
        id: item.id,
        to: item.to,
        urgent: item.urgent,
        text: `${project?.name ?? 'A project'} ${item.text}`,
        because: item.because,
      });
    }

    if (leadsReady) {
      const cold = rows.filter((l) => l.status === 'new' && hours(l.created_at) > 24);
      if (cold.length > 0) {
        out.push({
          id: 'new',
          to: '/leads?status=new',
          urgent: true,
          text: `${cold.length} new ${cold.length === 1 ? 'lead has' : 'leads have'} waited more than a day`,
        });
      }
      const stale = rows.filter((l) => l.status === 'proposal' && hours(l.created_at) > 7 * 24);
      if (stale.length > 0) {
        out.push({
          id: 'proposal',
          to: '/leads?status=proposal',
          text: `${stale.length} ${stale.length === 1 ? 'proposal has' : 'proposals have'} been out for over a week`,
        });
      }
    }

    if (analytics.kind === 'unconfigured') {
      out.push({ id: 'ga4', to: '/analytics', text: 'Analytics is not configured' });
    } else if (analytics.kind === 'error' && analytics.code !== 'DISABLED') {
      out.push({ id: 'ga4-error', to: '/analytics', text: 'Analytics is unavailable', urgent: true });
    }

    if (health.kind === 'ready') {
      for (const [key, label] of [
        ['supabase', 'Supabase'], ['leadApi', 'the lead API'], ['ga4', 'the GA4 Data API'],
      ] as const) {
        const service = health.data.services[key];
        // `health-` prefixed, and that is a fix rather than a flourish: an
        // unconfigured GA4 produces BOTH an analytics item and a health item,
        // and while both were keyed `ga4` React rendered one of them twice and
        // the count above the list disagreed with the list.
        if (service.state === 'unreachable') {
          out.push({ id: `health-${key}`, to: '/system', urgent: true, text: `${label} is unreachable` });
        } else if (service.state === 'unconfigured' || service.state === 'degraded') {
          out.push({ id: `health-${key}`, to: '/system', text: `${label} needs configuration` });
        }
      }
      if (health.data.services.notifications.state === 'disabled') {
        out.push({ id: 'notify', to: '/system', text: 'Lead notifications are off — leads arrive in the Portal only' });
      }
    }

    // Urgent first, and stable within each group. The list is read top down and
    // the thing somebody has to do today should not sit under a note about a
    // notification adapter that has been off since March.
    //
    // `rankAttention` is the same sort the commercial rules use, imported rather
    // than repeated so the two halves of this list cannot drift into two
    // different ideas of what "urgent first" means.
    return rankAttention(out.map((item) => ({
      ...item, record: '', to: item.to, because: item.because ?? '', urgent: Boolean(item.urgent),
    }))) as Item[];
  }, [rows, leadsReady, analytics, health, deals, projects, maySales]);

  return (
    <Panel className="col-span-12 min-w-0 lg:col-span-8">
      <SectionHeader
        title="Needs attention"
        note={items.length > 8 ? `showing 8 of ${items.length}` : items.length > 0 ? `${items.length}` : undefined}
      />
      {items.length === 0 ? (
        <p className="px-4 py-3.5 text-xs text-haze">Nothing requires attention.</p>
      ) : (
        <ul className="grid">
          {/* Capped at eight. A Dashboard section that can grow without limit is
              a Dashboard that becomes an inbox — and the rules above are
              deliberately narrow enough that eight is almost always all of them.
              The count in the header is the true total either way. */}
          {items.slice(0, 8).map((item) => (
            <li key={item.id} className="border-b border-hairline last:border-0">
              <Link
                to={item.to}
                className="flex items-start gap-2.5 px-4 py-2.5 transition-colors hover:bg-flare"
              >
                <span
                  className={cn('mt-1 h-1 w-1 shrink-0 rounded-full', item.urgent ? 'bg-signal' : 'bg-chrome/40')}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs text-paper">{item.text}</span>
                  {/* §15 — every item explains itself. The rule that fired is
                      named in a sentence, so nobody has to guess why a record is
                      on this list or what would take it off. */}
                  {item.because && <span className="t-note mt-0.5 block">{item.because}</span>}
                </span>
                <ArrowRight size={12} className="mt-0.5 shrink-0 text-haze" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/* ======================================================== 06 — the systems */

/**
 * One line, and a link to the screen that explains it.
 *
 * The Dashboard is not a status page. Repeating every service here would mean
 * two places to read the same four facts, and the one that got out of step
 * would be the one somebody read.
 */
function SystemLine({
  health, maySystem,
}: { health: ReturnType<typeof useHealth>['state']; maySystem: boolean }) {
  if (!maySystem) return null;

  const problems = health.kind === 'ready'
    ? Object.values(health.data.services as Health['services'])
      .filter((s) => s.state !== 'ok' && s.state !== 'disabled').length
    : 0;

  const label = health.kind === 'loading' ? 'Checking systems…'
    : health.kind === 'error' ? 'System status unavailable'
      : problems === 0 ? 'All systems operational'
        : `${problems} ${problems === 1 ? 'system requires' : 'systems require'} attention`;

  const tone = health.kind !== 'ready' ? 'bg-chrome/40' : problems === 0 ? 'bg-good' : 'bg-signal';

  return (
    <Panel className="col-span-12 min-w-0 lg:col-span-4">
      <Link
        to="/system"
        className="flex h-full items-center gap-2.5 px-4 py-3.5 transition-colors hover:bg-flare"
      >
        <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', tone)} aria-hidden="true" />
        <span className="min-w-0 flex-1 text-xs text-paper">{label}</span>
        <ArrowRight size={12} className="shrink-0 text-haze" aria-hidden="true" />
      </Link>
    </Panel>
  );
}

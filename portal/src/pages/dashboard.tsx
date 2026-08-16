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
import { BarList, Delta, Funnel, Segmented, TrendChart } from '@/components/charts';
import {
  RANGE_DAYS, delta, n, pct, trendLabel, useAnalytics, type Report,
} from '@/lib/analytics';
import { useHealth, type Health } from '@/lib/health';
import {
  FACETS, FORM_LABEL, LEAD_COLUMNS, formatWhen, groupBy, leadSource, since, statusLabel,
  statusTone, today, type Lead,
} from '@/lib/leads';

/**
 * THE DASHBOARD — decisions.
 *
 * ## The ten-second contract
 *
 * Somebody opens this between two other things. Before they scroll, they must
 * be able to answer: how much activity is there, how many leads came in, what
 * conversion looks like, whether anyone is on the site right now, where traffic
 * came from, what the latest enquiries are, whether anything needs doing, and
 * whether the infrastructure is up. Everything on this screen is one of those
 * eight answers; nothing on it is anything else.
 *
 * The order is fixed and is not a taste: business state → website activity →
 * acquisition and conversion → operational work → required action →
 * infrastructure. It runs from what you decide with to what you fix.
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

  const leads = useRows<Lead>('leads', LEAD_COLUMNS, 'created_at', reloadToken);
  const { state: analytics } = useAnalytics(range, environment, mayAnalytics, reloadToken);
  const { state: health } = useHealth(maySystem, reloadToken);

  const rows = leads.rows;
  const ready = leads.state === 'ready';
  const traffic = analytics.kind === 'ready' ? analytics.data : null;

  return (
    <div className="grid gap-4">
      <ExecutiveStrip
        rows={rows}
        leadsReady={ready}
        analytics={analytics}
        traffic={traffic}
        mayAnalytics={mayAnalytics}
        compare={compare}
      />

      {mayAnalytics && (
        <>
          <Grid>
            <TrafficPulse traffic={traffic} loading={analytics.kind === 'loading'} compare={compare} />
            <LivePanel analytics={analytics} traffic={traffic} />
          </Grid>

          <Grid>
            <ConversionPath traffic={traffic} loading={analytics.kind === 'loading'} />
            <Acquisition traffic={traffic} leads={rows} loading={analytics.kind === 'loading'} />
          </Grid>
        </>
      )}

      <RecentLeads rows={rows} state={leads.state} />

      <Grid>
        <Attention rows={rows} leadsReady={ready} analytics={analytics} health={health} />
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
 * the same height so the eye reads across rather than down. Yellow appears once
 * — on the realtime count — because that is the only figure here that is true
 * *now* rather than true for a period.
 *
 * Every cell distinguishes the four ways of having nothing: a measured zero is
 * `0`, an absent service is an em dash with the reason, an unconfigured one
 * says so, and a role that may not read a figure is not shown the cell at all.
 */
function ExecutiveStrip({
  rows, leadsReady, analytics, traffic, mayAnalytics, compare,
}: {
  rows: Lead[];
  leadsReady: boolean;
  analytics: AnalyticsState;
  traffic: Report | null;
  mayAnalytics: boolean;
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

  return (
    <MetricStrip label="Executive summary">
      {mayAnalytics && (
        <MetricCell
          label="Active users"
          value={gap ? gap.value : n(now?.activeUsers)}
          delta={!gap && compare && now && was ? <Delta value={delta(now.activeUsers, was.activeUsers)} /> : undefined}
          note={gap ? gap.note : periodNote}
        />
      )}
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

      {mayAnalytics && (
        <MetricCell
          label="Realtime"
          tone="live"
          value={
            gap ? gap.value
              : traffic?.realtime ? n(traffic.realtime.activeUsersByPage)
                : <NoFigure reason="Realtime unavailable" />
          }
          note={
            gap ? gap.note
              : traffic?.realtime ? `active, last ${traffic.realtime.minutes} min` : 'unavailable'
          }
        />
      )}

      {!mayAnalytics && (
        <MetricCell
          label="Unanswered"
          value={leadsReady ? rows.filter((l) => l.status === 'new').length : <Skeleton className="h-7 w-14" />}
          note="still at New"
        />
      )}
    </MetricStrip>
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

function ConversionPath({ traffic, loading }: { traffic: Report | null; loading: boolean }) {
  return (
    <Panel className="col-span-12 min-w-0 lg:col-span-5">
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
  traffic, leads, loading,
}: { traffic: Report | null; leads: Lead[]; loading: boolean }) {
  const rows = traffic?.acquisition.slice(0, 6) ?? [];
  const max = Math.max(...rows.map((r) => r.sessions), 1);

  return (
    <Panel className="col-span-12 min-w-0 lg:col-span-7">
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
    <Panel className="min-w-0">
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
        <Table head={['Time', 'Company / contact', 'Source', 'Form', 'Status']} minWidth={720}>
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
      <Cell className="text-[11px] text-haze">
        {FORM_LABEL[lead.form_type ?? ''] ?? lead.form_type ?? '—'}
      </Cell>
      <Cell><StatusPill tone={statusTone(lead.status)}>{statusLabel(lead.status)}</StatusPill></Cell>
    </Row>
  );
}

/* ====================================================== 05 — the attention */

interface Item { id: string; text: string; to: string; urgent?: boolean }

/**
 * What actually needs doing, and nothing that does not.
 *
 * Every item below is derived from a real condition in real data: a lead row
 * whose status and age can be read, a service the health endpoint reported on,
 * an analytics call that failed. There is no overdue invoice, no project
 * deadline and no missing asset, because none of those exists in this system
 * and an invented one would be acted on.
 *
 * When there is nothing, it says so in one line. A full-width green success
 * panel for "nothing is wrong" is a panel that trains you to skip the section.
 */
function Attention({
  rows, leadsReady, analytics, health,
}: {
  rows: Lead[];
  leadsReady: boolean;
  analytics: AnalyticsState;
  health: ReturnType<typeof useHealth>['state'];
}) {
  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    const hours = (iso: string) => (Date.now() - new Date(iso).getTime()) / 3_600_000;

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
    return [...out].sort((a, b) => Number(Boolean(b.urgent)) - Number(Boolean(a.urgent)));
  }, [rows, leadsReady, analytics, health]);

  return (
    <Panel className="col-span-12 min-w-0 lg:col-span-8">
      <SectionHeader title="Needs attention" note={items.length > 0 ? `${items.length}` : undefined} />
      {items.length === 0 ? (
        <p className="px-4 py-3.5 text-xs text-haze">Nothing requires attention.</p>
      ) : (
        <ul className="grid">
          {items.map((item) => (
            <li key={item.id} className="border-b border-hairline last:border-0">
              <Link
                to={item.to}
                className="flex items-center gap-2.5 px-4 py-2.5 transition-colors hover:bg-flare"
              >
                <span
                  className={cn('h-1 w-1 shrink-0 rounded-full', item.urgent ? 'bg-signal' : 'bg-chrome/40')}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1 text-xs text-paper">{item.text}</span>
                <ArrowRight size={12} className="shrink-0 text-haze" aria-hidden="true" />
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

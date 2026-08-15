import { Link } from 'react-router-dom';
import { useRows } from '@/lib/useRows';
import { useAuth } from '@/features/auth/AuthProvider';
import { can, ROLE_LABELS } from '@/lib/permissions';
import { PageHead } from '@/pages/screens';
import {
  Badge, Cell, EmptyState, Panel, PanelHeader, Row, Skeleton, Table, cn,
} from '@/components/ui';
import { BarList, Stat } from '@/components/charts';
import { delta, n, pct, useAnalytics } from '@/lib/analytics';
import { STATE_LABEL, TONE, useHealth, type ServiceState } from '@/lib/health';
import {
  FORM_LABEL, LEAD_COLUMNS, PIPELINE, STATUS, FACETS, formatWhen, groupBy, since,
  statusLabel, statusTone, today, type Lead,
} from '@/lib/leads';

/**
 * The Command Center — the Portal's landing screen.
 *
 * ## The question it answers
 *
 * "What is happening in Stratos right now?" — and it has to answer it in one
 * screen, without a click, for somebody who opened the Portal between two other
 * things. Everything on it is either a number that changed today or a state
 * that would ruin the week if it were wrong.
 *
 * ## Why it draws from three sources and still loads once
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
 */

export function OverviewScreen() {
  const { profile } = useAuth();
  const staffAnalytics = can(profile?.role, 'view_analytics');

  const leads = useRows<Lead>('leads', LEAD_COLUMNS);
  const projects = useRows<{ id: string; status: string }>('projects', 'id, status');
  const { state: analytics } = useAnalytics('7d', 'production', staffAnalytics);
  const { state: health } = useHealth(staffAnalytics);

  const rows = leads.rows;
  const ready = leads.state === 'ready';
  const traffic = analytics.kind === 'ready' ? analytics.data : null;
  const liveProjects = projects.rows.filter((p) => p.status !== 'archived').length;

  return (
    <>
      <PageHead
        title={`Good to see you${profile?.full_name ? `, ${profile.full_name.split(' ')[0]}` : ''}`}
        lede="Everything below is filtered by what your account is allowed to see."
        right={
          <span className="label">
            {profile ? ROLE_LABELS[profile.role] : '—'}
            {health.kind === 'ready' && <> · {health.data.environment}</>}
          </span>
        }
      />

      {/* ================================================== leads today == */}
      <section aria-label="Leads" className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Leads today"
          tone="accent"
          value={ready ? today(rows) : '—'}
          note="since midnight, your time"
        />
        <Stat label="Leads, 7 days" value={ready ? since(rows, 7) : '—'} />
        <Stat label="Leads, 30 days" value={ready ? since(rows, 30) : '—'} />
        <Stat
          label="Unanswered"
          value={ready ? rows.filter((l) => l.status === 'new').length : '—'}
          note="still at New"
        />
      </section>

      {/* ================================================== the pipeline == */}
      <Panel className="mb-4">
        <PanelHeader
          title="Pipeline"
          action={
            <Link to="/leads" className="label underline underline-offset-4 hover:text-paper">
              Open leads
            </Link>
          }
        />
        {!ready ? (
          <div className="p-5"><Skeleton className="h-14 w-full" /></div>
        ) : rows.length === 0 ? (
          <EmptyState title="No leads yet" body="Submissions from the public forms land here." />
        ) : (
          <div className="grid gap-2 px-5 py-4 sm:grid-cols-3 xl:grid-cols-6">
            {PIPELINE.map((stage) => {
              const count = rows.filter((l) => l.status === stage).length;
              return (
                <div key={stage} className="rounded-sm border border-hair px-3 py-2">
                  <p className="label truncate">{STATUS[stage].label}</p>
                  <p className={cn('num mt-0.5 text-lg', count === 0 ? 'text-haze' : 'text-paper')}>
                    {count}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      {/* ================================================ traffic today == */}
      {staffAnalytics && (
        <section aria-label="Traffic" className="mb-4">
          {analytics.kind === 'loading' && (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5" aria-busy="true">
              {[0, 1, 2, 3, 4].map((i) => (
                <Panel key={i} className="p-4"><Skeleton className="h-11 w-full" /></Panel>
              ))}
            </div>
          )}

          {analytics.kind === 'unconfigured' && (
            <Panel className="px-5 py-4">
              <p className="label mb-1">Analytics</p>
              <p className="max-w-prose text-xs text-haze">
                Not connected to a Google Analytics property yet.{' '}
                <Link to="/analytics" className="underline underline-offset-4 hover:text-paper">
                  See what is outstanding
                </Link>.
              </p>
            </Panel>
          )}

          {analytics.kind === 'error' && analytics.code !== 'DISABLED' && (
            <Panel className="px-5 py-4">
              <p className="label mb-1">Analytics</p>
              <p className="text-xs text-haze">{analytics.message}</p>
            </Panel>
          )}

          {traffic && (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <Stat label="Users today" value={n(traffic.overview.today.activeUsers)} />
              <Stat label="Sessions today" value={n(traffic.overview.today.sessions)} />
              <Stat label="Views today" value={n(traffic.overview.today.screenPageViews)} />
              <Stat
                label="Active now"
                tone="accent"
                value={traffic.realtime ? n(traffic.realtime.activeUsersByPage) : '—'}
                note={traffic.realtime ? `last ${traffic.realtime.minutes} min` : 'realtime unavailable'}
              />
              <Stat
                label="Lead events / session"
                value={pct(traffic.overview.current.leadRate, 2)}
                delta={
                  traffic.overview.current.leadRate !== null && traffic.overview.previous.leadRate !== null
                    ? delta(traffic.overview.current.leadRate, traffic.overview.previous.leadRate)
                    : null
                }
                note="last 7 days"
              />
            </div>
          )}
        </section>
      )}

      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        {/* ============================================== latest leads == */}
        <Panel className="min-w-0">
          <PanelHeader
            title="Latest enquiries"
            action={<span className="label">{liveProjects} live projects</span>}
          />
          {!ready ? (
            <div className="space-y-2 p-5" aria-busy="true">
              {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-9 w-full" />)}
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              title="No leads yet"
              body="Submissions from the public contact form and the quote questionnaire land here."
            />
          ) : (
            <Table head={['Name', 'Form', 'Company', 'Stage', 'Received']}>
              {rows.slice(0, 8).map((lead) => (
                <Row key={lead.id}>
                  <Cell className="text-sm">{lead.name}</Cell>
                  <Cell><Badge>{FORM_LABEL[lead.form_type ?? ''] ?? lead.form_type ?? '—'}</Badge></Cell>
                  <Cell className="text-haze">{lead.company || '—'}</Cell>
                  <Cell><Badge tone={statusTone(lead.status)}>{statusLabel(lead.status)}</Badge></Cell>
                  <Cell className="num whitespace-nowrap text-xs text-haze">
                    {formatWhen(lead.created_at)}
                  </Cell>
                </Row>
              ))}
            </Table>
          )}
        </Panel>

        <div className="grid gap-4">
          {/* ============================================= acquisition == */}
          <Panel>
            <PanelHeader
              title="Strongest sources"
              action={<span className="label">last 7 days</span>}
            />
            {traffic ? (
              <BarList
                rows={traffic.acquisition.slice(0, 6).map((row) => ({
                  key: `${row.source} / ${row.medium}`,
                  value: row.sessions,
                  note: row.leadEvents > 0 ? `${row.leadEvents} leads` : undefined,
                }))}
                empty="No sessions in the last seven days."
              />
            ) : (
              <BarList
                // The Portal's own attribution, which needs no Google at all.
                // It is a different measurement of the same question and it is
                // the one that is always available.
                rows={groupBy(rows, FACETS[0].of, 6)}
                empty="No attribution recorded yet."
              />
            )}
            <p className="border-t border-hair px-5 py-2.5 text-[10px] text-haze">
              {traffic ? 'GA4 sessions, production traffic.' : 'From the leads’ own submissions — GA4 is not connected.'}
            </p>
          </Panel>

          {/* ================================================== health == */}
          <SystemHealth />
        </div>
      </div>
    </>
  );
}

/* ============================================================ system health */

/**
 * The operational block, and it is deliberately four lines.
 *
 * Not a status page: four services, one state each, and the environment. Every
 * value is a boolean or an enum that came from `/api/portal-health`, which is
 * built so that no secret can reach a response — see the note at the top of
 * that file. There is no field here that could hold a key, a URL or a token.
 */
export function SystemHealth({ compact = false }: { compact?: boolean }) {
  const { state } = useHealth();

  return (
    <Panel className="h-fit">
      <PanelHeader
        title="System"
        action={
          state.kind === 'ready'
            ? <span className="label">{state.data.environment}</span>
            : null
        }
      />
      {state.kind === 'loading' && <div className="p-5"><Skeleton className="h-24 w-full" /></div>}

      {state.kind === 'error' && (
        <div className="px-5 py-4">
          <p className="text-xs text-haze">{state.message}</p>
          <p className="mt-1 text-[10px] text-haze">
            The static development server serves no functions, so this is expected outside a
            Netlify deploy.
          </p>
        </div>
      )}

      {state.kind === 'ready' && (
        <>
          <dl className="grid gap-0 px-5 py-3">
            <Service
              term="Supabase"
              state={state.data.services.supabase.state}
              note={
                state.data.services.supabase.state === 'ok'
                  ? 'URL and service key both answer'
                  : 'Check the URL and service key'
              }
            />
            <Service
              term="Lead API"
              state={state.data.services.leadApi.state}
              note={
                state.data.services.leadApi.ipSaltConfigured
                  ? 'store configured · IP hashing salted'
                  : 'store configured · IP salt missing'
              }
            />
            <Service
              term="GA4 Data API"
              state={state.data.services.ga4.state}
              note={
                state.data.services.ga4.missing.length
                  ? `${state.data.services.ga4.missing.length} variable(s) outstanding`
                  : 'service account configured'
              }
            />
            <Service
              term="Notifications"
              state={state.data.services.notifications.state}
              note={`transport: ${state.data.services.notifications.transport}`}
            />
          </dl>
          {!compact && (
            <p className="border-t border-hair px-5 py-2.5 text-[10px] leading-relaxed text-haze">
              Whether a credential exists — never its value. Checked{' '}
              {formatWhen(state.data.checkedAt)}.
            </p>
          )}
        </>
      )}
    </Panel>
  );
}

function Service({ term, state, note }: { term: string; state: ServiceState; note: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-hair/60 py-2 last:border-0">
      <div className="min-w-0">
        <dt className="text-xs text-paper">{term}</dt>
        <dd className="truncate text-[10px] text-haze">{note}</dd>
      </div>
      <Badge tone={TONE[state]}>{STATE_LABEL[state]}</Badge>
    </div>
  );
}

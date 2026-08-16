import { useScope } from '@/lib/scope';
import { useAuth } from '@/features/auth/AuthProvider';
import { Grid } from '@/components/shell/PortalShell';
import { Button, DataState, HealthRow, Panel, SectionHeader, Skeleton } from '@/components/ui';
import { STATE_LABEL, TONE, useHealth } from '@/lib/health';
import { formatWhen } from '@/lib/leads';

/**
 * SYSTEM — diagnostics.
 *
 * ## The question, and the discipline
 *
 * "Is the infrastructure operational?" That is the only question this screen
 * answers. It is not a second business dashboard and it never acquires one:
 * every figure that would make it interesting to a reader who is not debugging
 * belongs on the Dashboard.
 *
 * ## What can be on this screen
 *
 * Booleans, enums and variable NAMES. `/api/portal-health` is built so that no
 * value of any secret can reach a response — `configured()` there takes a
 * variable and returns whether it is a non-empty string — and this screen is the
 * mirror of that: there is no field in `lib/health.ts` that could hold a key, a
 * URL or a token, so there is nowhere for one to be rendered even if the
 * endpoint changed underneath it.
 *
 * `LEAD_NOTIFY_WEBHOOK_URL` in particular is reported as configured or not, and
 * never as a host, a path or a length. It is a capability: anyone holding it can
 * post into the channel it addresses.
 */

export function SystemScreen() {
  const { reloadToken } = useScope();
  const { configured } = useAuth();
  const { state, reload } = useHealth(true, reloadToken);

  return (
    <Grid>
      <Panel className="col-span-12 min-w-0 lg:col-span-8">
        <SectionHeader
          title="System status"
          note={state.kind === 'ready' ? `checked ${formatWhen(state.data.checkedAt)}` : undefined}
          action={<Button size="sm" variant="quiet" onClick={() => void reload()}>Check again</Button>}
        />

        {state.kind === 'loading' && (
          <div className="space-y-1.5 p-4" aria-busy="true">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-9 w-full" />)}
          </div>
        )}

        {state.kind === 'error' && (
          <DataState
            kind="unavailable"
            title="Cannot reach the health endpoint"
            body={`${state.message} The static development server serves no functions, so this is expected outside a Netlify deploy.`}
            action={<Button size="sm" onClick={() => void reload()}>Try again</Button>}
          />
        )}

        {state.kind === 'ready' && (
          <dl className="grid">
            <HealthRow
              term="Supabase"
              state={STATE_LABEL[state.data.services.supabase.state]}
              tone={TONE[state.data.services.supabase.state]}
              note={
                state.data.services.supabase.state === 'ok'
                  ? 'URL and service key both answer'
                  : 'Check the URL and the service key'
              }
            />
            <HealthRow
              term="Lead API"
              state={STATE_LABEL[state.data.services.leadApi.state]}
              tone={TONE[state.data.services.leadApi.state]}
              note={
                state.data.services.leadApi.ipSaltConfigured
                  ? 'store configured · IP hashing salted'
                  : 'store configured · IP salt missing'
              }
            />
            <HealthRow
              term="GA4 Data API"
              state={STATE_LABEL[state.data.services.ga4.state]}
              tone={TONE[state.data.services.ga4.state]}
              note={
                state.data.services.ga4.missing.length
                  ? `${state.data.services.ga4.missing.length} variable(s) outstanding`
                  : 'service account configured'
              }
            />
            <HealthRow
              term="Notifications"
              state={STATE_LABEL[state.data.services.notifications.state]}
              tone={TONE[state.data.services.notifications.state]}
              note={`transport: ${state.data.services.notifications.transport}`}
            />
          </dl>
        )}

        {state.kind === 'ready' && state.data.services.ga4.missing.length > 0 && (
          <div className="border-t border-hairline px-4 py-3">
            <p className="label mb-1.5">Outstanding in the function environment</p>
            <ul className="grid gap-0.5">
              {/* Names. The endpoint has no path by which a value could arrive
                  here, and neither has this list. */}
              {state.data.services.ga4.missing.map((name) => (
                <li key={name} className="num text-[11px] text-paper">{name}</li>
              ))}
            </ul>
          </div>
        )}
      </Panel>

      <div className="col-span-12 grid min-w-0 gap-4 lg:col-span-4">
        <Panel>
          <SectionHeader title="Environment" />
          <dl className="grid">
            <HealthRow
              term="Deploy context"
              state={state.kind === 'ready' ? state.data.environment : '—'}
              tone={state.kind === 'ready' && state.data.environment === 'production' ? 'good' : 'neutral'}
              note="Netlify's own context, not a hostname"
            />
            <HealthRow
              term="Portal client"
              state={configured ? 'Configured' : 'Not configured'}
              tone={configured ? 'good' : 'warn'}
              note="Supabase URL and anon key in this bundle"
            />
            <HealthRow
              term="Service role key"
              state="Server only"
              tone="good"
              note="Never present in this bundle"
            />
          </dl>
        </Panel>

        <Panel className="px-4 py-3.5">
          <p className="t-note">
            This screen reports whether a credential <span className="text-paper">exists</span> —
            never its value. No secret, token, webhook address or private key can reach it, by the
            shape of the endpoint rather than by discipline here.
          </p>
        </Panel>
      </div>
    </Grid>
  );
}

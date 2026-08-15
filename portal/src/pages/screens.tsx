import type { ReactNode } from 'react';
import { useRows, useSearch, formatDate, type LoadState } from '@/lib/useRows';
import { useAuth } from '@/features/auth/AuthProvider';
import { SystemHealth } from '@/pages/overview';
import { ROLE_LABELS, type Role } from '@/lib/permissions';
import {
  Badge, Cell, EmptyState, ErrorState, Input, Panel, PanelHeader, Row, Skeleton, Table,
} from '@/components/ui';

/* ---------------------------------------------------------------- shared */
export function PageHead({ title, lede, right }: { title: string; lede?: string; right?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-2xl tracking-wide text-paper">{title}</h1>
        {lede && <p className="mt-1 max-w-prose text-sm text-haze">{lede}</p>}
      </div>
      {right}
    </header>
  );
}

/**
 * One place that decides what a data screen shows: skeletons, an error, an
 * empty state, or the table. Every screen goes through it, so loading and
 * failure look the same everywhere and no screen forgets to handle a case.
 */
function DataPanel({
  title, state, message, count, empty, search, children, reload,
}: {
  title: string; state: LoadState; message: string; count: number;
  empty: { title: string; body: string };
  search?: { value: string; onChange: (v: string) => void; placeholder: string };
  children: ReactNode; reload: () => void;
}) {
  return (
    <Panel>
      <PanelHeader
        title={title}
        action={
          search && state === 'ready' ? (
            <Input
              type="search"
              value={search.value}
              onChange={(e) => search.onChange(e.target.value)}
              placeholder={search.placeholder}
              aria-label={`Search ${title.toLowerCase()}`}
              className="h-8 w-44 py-1 text-xs sm:w-56"
            />
          ) : null
        }
      />

      {state === 'loading' && (
        <div className="space-y-2 p-5" aria-busy="true">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      )}

      {state === 'unconfigured' && (
        <EmptyState
          title="Not connected"
          body="Supabase credentials are not set in this environment, so there is nothing to read yet. See README.md for the setup steps."
        />
      )}

      {state === 'error' && <ErrorState message={message} onRetry={reload} />}

      {state === 'ready' && count === 0 && <EmptyState title={empty.title} body={empty.body} />}
      {state === 'ready' && count > 0 && children}
    </Panel>
  );
}

/* ----------------------------------------------------------------- moved */
/**
 * `OverviewScreen` and `LeadsScreen` used to live here and now do not.
 *
 * Both outgrew a shared file. The overview became the Command Center — three
 * data sources, its own health block, its own failure per panel — and Leads
 * became a pipeline with a detail view, notes and a timeline. Keeping either in
 * a file of seven small screens would have meant one 1 200-line module in which
 * the Clients table and the lead timeline were neighbours.
 *
 *   pages/overview.tsx   the Command Center
 *   pages/leads.tsx      the pipeline, detail, notes and timeline
 *   lib/leads.ts         the status model and the mutations behind both
 *
 * What stays here is what it was for: the small, structurally identical table
 * screens, and the two components every screen shares.
 */

/**
 * A stored web address, as an href — or null, if it must not become one.
 *
 * This exists because `href={value}` on a value that came out of the database
 * is how a `javascript:` URL gets executed by a click. The path is real rather
 * than theoretical: `organizations.website` is populated from a client's own
 * answer, and the public form's URL check (`URL_RE` in lead-contract.mjs) is
 * deliberately permissive about formatting — it refuses text, not schemes. A
 * value of `javascript:alert(1).co` satisfies it.
 *
 * So the scheme is decided HERE, at the point of use, and only two are allowed.
 * A bare `example.com` is upgraded to https rather than rejected, because a
 * client typing their address without a scheme is the normal case and a link
 * that silently stops working is the wrong lesson to teach.
 *
 * Anything else renders as plain text: the value is still visible, still
 * copyable, and not clickable. Losing a link is a shrug; running someone else's
 * script inside an authenticated admin session is not.
 */
function safeUrl(value: string | null | undefined): string | null {
  const raw = (value ?? '').trim();
  if (!raw) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

/* --------------------------------------------------------------- projects */
interface Project {
  id: string; name: string; slug: string; status: string;
  start_date: string | null; target_date: string | null;
}

export function ProjectsScreen() {
  const { rows, state, message, reload } = useRows<Project>(
    'projects', 'id, name, slug, status, start_date, target_date, created_at',
  );
  const { query, setQuery, filtered } = useSearch(rows, ['name', 'slug']);

  return (
    <>
      <PageHead title="Projects" lede="Client work in flight. Team members see only what they are assigned to." />
      <DataPanel
        title="All projects"
        state={state} message={message} count={filtered.length} reload={reload}
        search={{ value: query, onChange: setQuery, placeholder: 'Project name…' }}
        empty={{ title: 'No projects', body: 'Projects you can see will appear here once they are created.' }}
      >
        <Table head={['Project', 'Status', 'Started', 'Target']}>
          {filtered.map((p) => (
            <Row key={p.id}>
              <Cell>
                {p.name}
                <span className="num ml-2 text-[10px] text-haze">/{p.slug}</span>
              </Cell>
              <Cell><Badge tone={p.status === 'archived' ? 'neutral' : 'warn'}>{p.status}</Badge></Cell>
              <Cell className="num text-xs text-haze">{formatDate(p.start_date)}</Cell>
              <Cell className="num text-xs text-haze">{formatDate(p.target_date)}</Cell>
            </Row>
          ))}
        </Table>
      </DataPanel>
    </>
  );
}

/* ---------------------------------------------------------------- clients */
interface Org { id: string; name: string; slug: string; website: string | null; status: string; created_at: string }

export function ClientsScreen() {
  const { rows, state, message, reload } = useRows<Org>('organizations', 'id, name, slug, website, status, created_at');
  const { query, setQuery, filtered } = useSearch(rows, ['name', 'slug']);

  return (
    <>
      <PageHead title="Clients" lede="Organisations. Each one is the boundary a client account can see across." />
      <DataPanel
        title="Organisations"
        state={state} message={message} count={filtered.length} reload={reload}
        search={{ value: query, onChange: setQuery, placeholder: 'Client name…' }}
        empty={{ title: 'No clients', body: 'Add an organisation to give a client account something to belong to.' }}
      >
        <Table head={['Name', 'Website', 'Status', 'Added']}>
          {filtered.map((o) => (
            <Row key={o.id}>
              <Cell>{o.name}</Cell>
              <Cell className="text-haze">
                {safeUrl(o.website) ? (
                  <a href={safeUrl(o.website)!} target="_blank" rel="noreferrer noopener"
                     className="underline underline-offset-4 hover:text-paper">{o.website}</a>
                ) : (o.website || '—')}
              </Cell>
              <Cell><Badge tone={o.status === 'active' ? 'good' : 'neutral'}>{o.status}</Badge></Cell>
              <Cell className="num text-xs text-haze">{formatDate(o.created_at)}</Cell>
            </Row>
          ))}
        </Table>
      </DataPanel>
    </>
  );
}

/* ----------------------------------------------------------- case studies */
interface CaseStudy {
  id: string; title: string; slug: string; client_name: string | null;
  published: boolean; sort_order: number; updated_at: string;
}

export function CaseStudiesScreen() {
  const { rows, state, message, reload } = useRows<CaseStudy>(
    'case_studies', 'id, title, slug, client_name, published, sort_order, updated_at', 'sort_order',
  );
  const { query, setQuery, filtered } = useSearch(rows, ['title', 'client_name']);

  return (
    <>
      <PageHead
        title="Case studies"
        lede="Published entries are readable by the public site; drafts are not."
      />
      <DataPanel
        title="All case studies"
        state={state} message={message} count={filtered.length} reload={reload}
        search={{ value: query, onChange: setQuery, placeholder: 'Title or client…' }}
        empty={{
          title: 'No case studies',
          body: 'Rapidkert, Barbershop Győr and mentáliserő.hu are the references to start from.',
        }}
      >
        <Table head={['Title', 'Client', 'State', 'Order', 'Updated']}>
          {filtered.map((c) => (
            <Row key={c.id}>
              <Cell>{c.title}</Cell>
              <Cell className="text-haze">{c.client_name || '—'}</Cell>
              <Cell><Badge tone={c.published ? 'good' : 'neutral'}>{c.published ? 'Published' : 'Draft'}</Badge></Cell>
              <Cell className="num text-xs text-haze">{c.sort_order}</Cell>
              <Cell className="num text-xs text-haze">{formatDate(c.updated_at)}</Cell>
            </Row>
          ))}
        </Table>
      </DataPanel>
    </>
  );
}

/* ------------------------------------------------------------------ users */
interface UserRow { id: string; email: string; full_name: string | null; role: Role; created_at: string }

export function UsersScreen() {
  const { rows, state, message, reload } = useRows<UserRow>('profiles', 'id, email, full_name, role, created_at');
  const { query, setQuery, filtered } = useSearch(rows, ['email', 'full_name']);

  return (
    <>
      <PageHead
        title="Users"
        lede="Only a super admin can reach this screen, and only a super admin can change a role — the database enforces both."
      />
      <DataPanel
        title="Accounts"
        state={state} message={message} count={filtered.length} reload={reload}
        search={{ value: query, onChange: setQuery, placeholder: 'Name or email…' }}
        empty={{ title: 'No users', body: 'Accounts appear here once they have signed up or been invited.' }}
      >
        <Table head={['Name', 'Email', 'Role', 'Joined']}>
          {filtered.map((u) => (
            <Row key={u.id}>
              <Cell>{u.full_name || '—'}</Cell>
              <Cell className="text-haze">{u.email}</Cell>
              <Cell>
                <Badge tone={u.role === 'super_admin' ? 'warn' : u.role === 'client' ? 'neutral' : 'good'}>
                  {ROLE_LABELS[u.role]}
                </Badge>
              </Cell>
              <Cell className="num text-xs text-haze">{formatDate(u.created_at)}</Cell>
            </Row>
          ))}
        </Table>
      </DataPanel>
    </>
  );
}

/* --------------------------------------------------------------- activity */
interface LogRow { id: string; action: string; entity_type: string | null; created_at: string }

export function ActivityScreen() {
  const { rows, state, message, reload } = useRows<LogRow>('activity_logs', 'id, action, entity_type, created_at');
  return (
    <>
      <PageHead title="Activity" lede="An append-only record of what changed and when." />
      <DataPanel
        title="Recent activity"
        state={state} message={message} count={rows.length} reload={reload}
        empty={{ title: 'Nothing logged', body: 'Writes made through the portal and the serverless functions are recorded here.' }}
      >
        <Table head={['Action', 'Entity', 'When']}>
          {rows.map((l) => (
            <Row key={l.id}>
              <Cell className="num text-xs">{l.action}</Cell>
              <Cell className="text-haze">{l.entity_type || '—'}</Cell>
              <Cell className="num text-xs text-haze">{formatDate(l.created_at)}</Cell>
            </Row>
          ))}
        </Table>
      </DataPanel>
    </>
  );
}

/* --------------------------------------------------------------- settings */
export function SettingsScreen() {
  const { profile, configured } = useAuth();
  return (
    <>
      <PageHead title="Settings" lede="Environment and account. Secrets are never shown here." />
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel>
          <PanelHeader title="This account" />
          <dl className="grid gap-3 p-5 text-sm">
            <Line term="Name" value={profile?.full_name || '—'} />
            <Line term="Email" value={profile?.email || '—'} />
            <Line term="Role" value={profile ? ROLE_LABELS[profile.role] : '—'} />
            <Line term="Organisation" value={profile?.organization_id ?? 'Stratos (staff)'} />
          </dl>
        </Panel>
        <Panel>
          <PanelHeader title="Environment" />
          <dl className="grid gap-3 p-5 text-sm">
            <Line term="Supabase" value={configured ? 'Connected' : 'Not configured'} />
            <Line term="Origin" value={window.location.origin} />
            {/* The anon key is public by design but there is no reason to paint
                it on a screen someone might screenshot, and the service role key
                does not exist in this bundle at all. */}
            <Line term="Service role key" value="Server-side only — never in this bundle" />
          </dl>
        </Panel>
        {/*
          The same block the Command Center draws, and deliberately the same
          component rather than a second one.

          Settings is where somebody goes when they suspect a configuration
          problem, so the operational readout belongs here as well as on the
          landing screen. Two copies of it would be two things to keep in step,
          and the one that got out of date would be the one somebody read.
        */}
        <SystemHealth />
      </div>
    </>
  );
}

function Line({ term, value }: { term: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-hair/60 pb-2 last:border-0">
      <dt className="label">{term}</dt>
      <dd className="truncate text-right text-paper">{value}</dd>
    </div>
  );
}

/* -------------------------------------------------------------- not found */
export function NotFoundScreen() {
  return (
    <div className="grid min-h-[60dvh] place-items-center text-center">
      <div>
        <p className="num text-4xl text-signal">404</p>
        <p className="mt-2 text-sm text-haze">That screen does not exist in the portal.</p>
        <a href="/portal/" className="mt-4 inline-block text-xs underline underline-offset-4 hover:text-paper">
          Back to overview
        </a>
      </div>
    </div>
  );
}

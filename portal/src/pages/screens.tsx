import type { ReactNode } from 'react';
import { useRows, useSearch, formatDate, type LoadState } from '@/lib/useRows';
import { useAuth } from '@/features/auth/AuthProvider';
import { useScope } from '@/lib/scope';
import { ROLE_LABELS, type Role } from '@/lib/permissions';
import {
  Badge, Cell, DataState, ErrorState, Input, Panel, Row, SectionHeader, Skeleton, Table,
} from '@/components/ui';

/**
 * The record tables.
 *
 * Everything here is a real table with a real RLS policy behind it, reachable
 * from the Records group in the sidebar. They are not one of the Portal's four
 * products — Dashboard, Analytics, Leads, System — and they are drawn at that
 * weight: one panel, one table, no dashboard framing.
 *
 * `OverviewScreen` and `LeadsScreen` used to live here and now do not. The
 * overview became the Dashboard and Leads became a list with its own detail
 * route:
 *
 *   pages/dashboard.tsx     the Dashboard
 *   pages/leads.tsx         the list, its status strip and its filters
 *   pages/lead-detail.tsx   one lead, its notes and its timeline
 *   pages/system.tsx        the health readout that used to be duplicated here
 *   lib/leads.ts            the status model and the mutations behind them
 */

/**
 * One place that decides what a data screen shows: skeletons, an error, an
 * empty state, or the table. Every screen in this file goes through it, so
 * loading and failure look the same everywhere and no screen forgets a case.
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
    <Panel className="min-w-0">
      <SectionHeader
        title={title}
        action={
          search && state === 'ready' ? (
            <Input
              type="search"
              value={search.value}
              onChange={(e) => search.onChange(e.target.value)}
              placeholder={search.placeholder}
              aria-label={`Search ${title.toLowerCase()}`}
              className="h-7 w-44 py-1 text-xs sm:w-56"
            />
          ) : null
        }
      />

      {state === 'loading' && (
        <div className="space-y-1.5 p-4" aria-busy="true">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-8 w-full" />)}
        </div>
      )}

      {state === 'unconfigured' && (
        <DataState
          kind="unconfigured"
          title="Not connected"
          body="Supabase credentials are not set in this environment, so there is nothing to read yet. See README.md for the setup steps."
        />
      )}

      {state === 'error' && <ErrorState message={message} onRetry={reload} />}

      {state === 'ready' && count === 0 && (
        <DataState kind="empty" title={empty.title} body={empty.body} />
      )}
      {state === 'ready' && count > 0 && children}
    </Panel>
  );
}

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
  const { reloadToken } = useScope();
  const { rows, state, message, reload } = useRows<Project>(
    'projects', 'id, name, slug, status, start_date, target_date, created_at', 'created_at', reloadToken,
  );
  const { query, setQuery, filtered } = useSearch(rows, ['name', 'slug']);

  return (
    <DataPanel
      title="All projects"
      state={state} message={message} count={filtered.length} reload={reload}
      search={{ value: query, onChange: setQuery, placeholder: 'Project name…' }}
      empty={{ title: 'No projects', body: 'Projects you can see will appear here once they are created.' }}
    >
      <Table head={['Project', 'Status', 'Started', 'Target']}>
        {filtered.map((p) => (
          <Row key={p.id}>
            <Cell className="text-[13px] text-paper">
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
  );
}

/* ---------------------------------------------------------------- clients */
interface Org { id: string; name: string; slug: string; website: string | null; status: string; created_at: string }

export function ClientsScreen() {
  const { reloadToken } = useScope();
  const { rows, state, message, reload } = useRows<Org>(
    'organizations', 'id, name, slug, website, status, created_at', 'created_at', reloadToken,
  );
  const { query, setQuery, filtered } = useSearch(rows, ['name', 'slug']);

  return (
    <DataPanel
      title="Organisations"
      state={state} message={message} count={filtered.length} reload={reload}
      search={{ value: query, onChange: setQuery, placeholder: 'Client name…' }}
      empty={{ title: 'No clients', body: 'Add an organisation to give a client account something to belong to.' }}
    >
      <Table head={['Name', 'Website', 'Status', 'Added']}>
        {filtered.map((o) => (
          <Row key={o.id}>
            <Cell className="text-[13px] text-paper">{o.name}</Cell>
            <Cell className="break-all text-xs text-haze">
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
  );
}

/* ----------------------------------------------------------- case studies */
interface CaseStudy {
  id: string; title: string; slug: string; client_name: string | null;
  published: boolean; sort_order: number; updated_at: string;
}

export function CaseStudiesScreen() {
  const { reloadToken } = useScope();
  const { rows, state, message, reload } = useRows<CaseStudy>(
    'case_studies', 'id, title, slug, client_name, published, sort_order, updated_at', 'sort_order', reloadToken,
  );
  const { query, setQuery, filtered } = useSearch(rows, ['title', 'client_name']);

  return (
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
            <Cell className="text-[13px] text-paper">{c.title}</Cell>
            <Cell className="text-xs text-haze">{c.client_name || '—'}</Cell>
            <Cell><Badge tone={c.published ? 'good' : 'neutral'}>{c.published ? 'Published' : 'Draft'}</Badge></Cell>
            <Cell className="num text-xs text-haze">{c.sort_order}</Cell>
            <Cell className="num text-xs text-haze">{formatDate(c.updated_at)}</Cell>
          </Row>
        ))}
      </Table>
    </DataPanel>
  );
}

/* ------------------------------------------------------------------ users */
interface UserRow { id: string; email: string; full_name: string | null; role: Role; created_at: string }

export function UsersScreen() {
  const { reloadToken } = useScope();
  const { rows, state, message, reload } = useRows<UserRow>(
    'profiles', 'id, email, full_name, role, created_at', 'created_at', reloadToken,
  );
  const { query, setQuery, filtered } = useSearch(rows, ['email', 'full_name']);

  return (
    <DataPanel
      title="Accounts"
      state={state} message={message} count={filtered.length} reload={reload}
      search={{ value: query, onChange: setQuery, placeholder: 'Name or email…' }}
      empty={{ title: 'No users', body: 'Accounts appear here once they have signed up or been invited.' }}
    >
      <Table head={['Name', 'Email', 'Role', 'Joined']}>
        {filtered.map((u) => (
          <Row key={u.id}>
            <Cell className="text-[13px] text-paper">{u.full_name || '—'}</Cell>
            <Cell className="break-all text-xs text-haze">{u.email}</Cell>
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
  );
}

/* --------------------------------------------------------------- activity */
interface LogRow { id: string; action: string; entity_type: string | null; created_at: string }

export function ActivityScreen() {
  const { reloadToken } = useScope();
  const { rows, state, message, reload } = useRows<LogRow>(
    'activity_logs', 'id, action, entity_type, created_at', 'created_at', reloadToken,
  );
  return (
    <DataPanel
      title="Recent activity"
      state={state} message={message} count={rows.length} reload={reload}
      empty={{ title: 'Nothing logged', body: 'Writes made through the portal and the serverless functions are recorded here.' }}
    >
      <Table head={['Action', 'Entity', 'When']}>
        {rows.map((l) => (
          <Row key={l.id}>
            <Cell className="num break-all text-xs text-paper">{l.action}</Cell>
            <Cell className="text-xs text-haze">{l.entity_type || '—'}</Cell>
            <Cell className="num text-xs text-haze">{formatDate(l.created_at)}</Cell>
          </Row>
        ))}
      </Table>
    </DataPanel>
  );
}

/* --------------------------------------------------------------- settings */

/**
 * The account, and only the account.
 *
 * The environment and health blocks that used to sit here are on `/system`.
 * Two copies of the same readout were two things to keep in step, and the one
 * that got out of date would have been the one somebody read.
 */
export function SettingsScreen() {
  const { profile } = useAuth();
  return (
    <div className="grid gap-4 lg:max-w-xl">
      <Panel>
        <SectionHeader title="This account" />
        <dl className="grid px-4 py-3 text-sm">
          <Line term="Name" value={profile?.full_name || '—'} />
          <Line term="Email" value={profile?.email || '—'} />
          <Line term="Role" value={profile ? ROLE_LABELS[profile.role] : '—'} />
          <Line term="Organisation" value={profile?.organization_id ?? 'Stratos (staff)'} />
        </dl>
      </Panel>
      <p className="t-note">
        Infrastructure, credentials and deploy context are on the System screen.
      </p>
    </div>
  );
}

function Line({ term, value }: { term: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-hairline py-2 last:border-0">
      <dt className="label">{term}</dt>
      <dd className="truncate text-right text-[13px] text-paper">{value}</dd>
    </div>
  );
}

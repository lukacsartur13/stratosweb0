import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Plus } from 'lucide-react';
import { useAuth } from '@/features/auth/AuthProvider';
import { can } from '@/lib/permissions';
import { useScope } from '@/lib/scope';
import { supabase, isConfigured } from '@/lib/supabase';
import { Grid } from '@/components/shell/PortalShell';
import {
  Badge, Button, Cell, DataLine, DataState, Dialog, ErrorState, Field, Input, NotRecorded,
  Panel, Row, SectionHeader, Select, Skeleton, StatusPill, Table, Textarea, cn,
} from '@/components/ui';
import { money, moneyCompact, primaryTotal, sumByCurrency } from '@/lib/money';
import {
  CLIENT_STATUS, CLIENT_STATUSES, isLiveProject, projectStatusLabel, projectStatusTone,
  shortDate, stageLabel, stageTone,
} from '@/lib/pipeline';
import {
  findClientMatches, uniqueSlug, useClientDetail, useClients, useOperationsMutations,
  type Client, type ClientContact,
} from '@/lib/operations';
import { buildRecordTimeline, useNoteMutation, useRecordDetail } from '@/lib/records';
import { formatWhen } from '@/lib/leads';

/**
 * CLIENTS — the relationship hub (§18, §19).
 *
 * ## A client is not a lead, and this list is not the lead list
 *
 * Every row here is a company that actually became a Stratos client. Leads live
 * on the Leads screen and opportunities on Sales; the traceable route between
 * them is Lead → Opportunity → Won → Client, and the client record carries the
 * acquisition fields that came down that route so revenue can be attributed to a
 * channel (§33).
 *
 * ## The list totals, and why they are two queries rather than N
 *
 * Active projects and won value are per-client aggregates. Fetching them per row
 * would be one query per client — the classic N+1 on a list screen. Instead the
 * projects and the won opportunities are read ONCE, bounded, with four columns
 * each, and grouped in memory. Two requests, regardless of how many clients
 * exist.
 */

interface Rollup {
  activeProjects: number;
  totalProjects: number;
  wonValue: { currency: string; value: number }[];
  wonCount: number;
  lastActivity: string | null;
}

/**
 * Everything the client list needs about projects and deals, in two reads.
 *
 * The selects are deliberately narrow: four columns from `projects` and five
 * from `opportunities`. A `select *` here would pull every project description
 * and every deal's contact details across the wire to compute two counts.
 */
function useClientRollups(reloadToken = 0) {
  const [rollups, setRollups] = useState<Record<string, Rollup>>({});

  useEffect(() => {
    let cancelled = false;
    if (!isConfigured) return;

    void (async () => {
      const [projectRes, dealRes] = await Promise.all([
        supabase.from('projects')
          .select('organization_id, status, archived_at, updated_at').limit(500),
        supabase.from('opportunities')
          .select('organization_id, stage, estimated_value, currency, won_at, updated_at')
          .not('organization_id', 'is', null).is('archived_at', null).limit(500),
      ]);

      if (projectRes.error) console.error('[projects.rollup]', projectRes.error);
      if (dealRes.error) console.error('[opportunities.rollup]', dealRes.error);
      if (cancelled) return;

      const out: Record<string, Rollup> = {};
      const entry = (id: string) => {
        out[id] ??= { activeProjects: 0, totalProjects: 0, wonValue: [], wonCount: 0, lastActivity: null };
        return out[id];
      };
      const touch = (row: Rollup, at: string | null) => {
        if (at && (!row.lastActivity || at > row.lastActivity)) row.lastActivity = at;
      };

      for (const p of (projectRes.data ?? []) as {
        organization_id: string; status: string; archived_at: string | null; updated_at: string;
      }[]) {
        const row = entry(p.organization_id);
        row.totalProjects += 1;
        if (isLiveProject(p)) row.activeProjects += 1;
        touch(row, p.updated_at);
      }

      for (const d of (dealRes.data ?? []) as {
        organization_id: string; stage: string; estimated_value: number | null;
        currency: string; won_at: string | null; updated_at: string;
      }[]) {
        const row = entry(d.organization_id);
        touch(row, d.updated_at);
        if (d.stage !== 'won') continue;
        row.wonCount += 1;
        // Per currency, never summed across. Same rule everywhere in P2.
        const hit = row.wonValue.find((v) => v.currency === d.currency);
        if (hit) hit.value += Number(d.estimated_value ?? 0);
        else row.wonValue.push({ currency: d.currency, value: Number(d.estimated_value ?? 0) });
      }

      setRollups(out);
    })();

    return () => { cancelled = true; };
  }, [reloadToken]);

  return rollups;
}

export function ClientsScreen() {
  const { profile } = useAuth();
  const { reloadToken } = useScope();
  const navigate = useNavigate();
  const mayEdit = can(profile?.role, 'manage_clients');

  const { rows, state, message, reload } = useClients(reloadToken);
  const rollups = useClientRollups(reloadToken);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [creating, setCreating] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter((c) => !c.archived_at)
      .filter((c) => status === 'all' || c.status === status)
      .filter((c) => !q || [c.name, c.slug, c.website, c.primary_service]
        .some((f) => String(f ?? '').toLowerCase().includes(q)));
  }, [rows, query, status]);

  return (
    <div className="grid gap-4">
      <Panel className="min-w-0">
        <SectionHeader
          title="Clients"
          note={state === 'ready' ? `${filtered.length} of ${rows.length}` : undefined}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <label className="sr-only" htmlFor="client-status">Status</label>
              <Select id="client-status" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="all">Any status</option>
                {CLIENT_STATUSES.map((s) => (
                  <option key={s} value={s}>{CLIENT_STATUS[s].label}</option>
                ))}
              </Select>
              <Input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Client or contact…"
                aria-label="Search clients"
                className="h-7 w-44 py-1 text-xs sm:w-56"
              />
              {mayEdit && (
                <Button size="sm" variant="primary" onClick={() => setCreating(true)}>
                  <Plus size={12} aria-hidden="true" /> New
                </Button>
              )}
            </div>
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
            body="Supabase credentials are not set in this environment, so there is nothing to read yet."
          />
        )}

        {state === 'error' && <ErrorState message={message} onRetry={reload} />}

        {state === 'ready' && filtered.length === 0 && (
          <DataState
            kind="empty"
            title={rows.length === 0 ? 'No clients yet' : 'Nothing matches'}
            body={rows.length === 0
              ? 'A client is created when an opportunity is won — that is the traceable route from an enquiry to a relationship. One can also be added directly.'
              : 'No client matches the filters above.'}
            action={rows.length === 0
              ? (
                <div className="flex flex-wrap justify-center gap-2">
                  <Link to="/sales"><Button size="sm">Open the pipeline</Button></Link>
                  {mayEdit && <Button size="sm" variant="primary" onClick={() => setCreating(true)}>Add a client</Button>}
                </div>
              )
              : <Button size="sm" onClick={() => { setQuery(''); setStatus('all'); }}>Clear</Button>}
          />
        )}

        {state === 'ready' && filtered.length > 0 && (
          <Table
            head={[
              'Client', 'Status',
              { label: 'Active projects', align: 'right' },
              { label: 'Won value', align: 'right' },
              'Primary service', 'Source', 'Last activity',
            ]}
            minWidth={840}
            sticky
          >
            {filtered.map((client) => {
              const roll = rollups[client.id];
              const won = primaryTotal(sumByCurrency(
                (roll?.wonValue ?? []).map((v) => ({ currency: v.currency, value: v.value })),
              ));
              return (
                <Row key={client.id} onClick={() => navigate(`/clients/${client.id}`)}>
                  <Cell className="min-w-0">
                    <Link to={`/clients/${client.id}`} className="text-[13px] text-paper hover:text-signal">
                      {client.name}
                    </Link>
                  </Cell>
                  <Cell>
                    <StatusPill tone={CLIENT_STATUS[client.status]?.tone ?? 'neutral'}>
                      {CLIENT_STATUS[client.status]?.label ?? client.status}
                    </StatusPill>
                  </Cell>
                  <Cell align="right" className="num text-xs text-paper">
                    {roll ? roll.activeProjects : <span className="text-haze">—</span>}
                  </Cell>
                  <Cell align="right" className="num text-xs text-paper">
                    {won.total && won.total.value > 0
                      ? moneyCompact(won.total.value, won.total.currency)
                      : <span className="text-haze">—</span>}
                  </Cell>
                  <Cell className="truncate text-[11px] text-haze">{client.primary_service || '—'}</Cell>
                  <Cell className="break-words text-[11px] text-haze">
                    {client.acquisition_source
                      ? [client.acquisition_source, client.acquisition_medium].filter(Boolean).join(' / ')
                      : '—'}
                  </Cell>
                  <Cell className="num whitespace-nowrap text-[11px] text-haze">
                    {roll?.lastActivity ? shortDate(roll.lastActivity) : '—'}
                  </Cell>
                </Row>
              );
            })}
          </Table>
        )}
      </Panel>

      {mayEdit && creating && (
        <NewClientDialog
          existing={rows}
          onClose={() => setCreating(false)}
          onCreated={(id) => { setCreating(false); void reload(); navigate(`/clients/${id}`); }}
        />
      )}
    </div>
  );
}

/* ============================================================= the detail */

/**
 * ONE CLIENT — the commercial relationship (§19).
 *
 * Top: who they are and what they are worth. Then their projects, their
 * opportunities, their contacts, their notes and their activity. Only what
 * genuinely exists: there is no org chart, no health score and no renewal date,
 * because none of those is stored and inventing one would put a number on the
 * screen that nobody entered.
 */
export function ClientDetailScreen() {
  const { id } = useParams<{ id: string }>();
  const { profile } = useAuth();
  const { reloadToken } = useScope();
  const mayEdit = can(profile?.role, 'manage_clients');

  const { client, contacts, projects, deals, state, reload } = useClientDetail(id, reloadToken);
  const detail = useRecordDetail('client', state === 'ready' ? id ?? null : null, reloadToken);
  const notes = useNoteMutation('client', () => { void detail.reload(); });
  const ops = useOperationsMutations(reload);

  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [contactOpen, setContactOpen] = useState<ClientContact | 'new' | null>(null);

  if (state === 'loading') {
    return (
      <Grid>
        <div className="col-span-12 grid gap-4 lg:col-span-8" aria-busy="true">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
        <Skeleton className="col-span-12 h-72 lg:col-span-4" />
      </Grid>
    );
  }

  if (state !== 'ready' || !client) {
    return (
      <Panel>
        <DataState
          kind={state === 'error' ? 'unavailable' : state === 'unconfigured' ? 'unconfigured' : 'empty'}
          title={state === 'error' ? 'Unavailable' : state === 'unconfigured' ? 'Not connected' : 'No such client'}
          body={state === 'error'
            ? 'The client could not be read right now.'
            : state === 'unconfigured'
              ? 'Supabase credentials are not set in this environment.'
              : 'This client does not exist, or this account may not read it.'}
          action={<Link to="/clients"><Button size="sm">All clients</Button></Link>}
        />
      </Panel>
    );
  }

  const wonDeals = deals.filter((d) => d.stage === 'won');
  const wonTotal = primaryTotal(sumByCurrency(
    wonDeals.map((d) => ({ currency: d.currency, value: Number(d.estimated_value ?? 0) })),
  ));
  const activeProjects = projects.filter(isLiveProject);
  const timeline = buildRecordTimeline(
    { at: client.created_at, title: 'Client created' },
    detail.notes,
    detail.log,
  );

  const submitNote = async () => {
    const problem = await notes.addNote(client.id, draft);
    setError(problem);
    if (!problem) setDraft('');
  };

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link to="/clients" className="t-note inline-flex items-center gap-1.5 underline underline-offset-4 hover:text-paper">
          <ArrowLeft size={11} aria-hidden="true" /> All clients
        </Link>
        <StatusPill tone={CLIENT_STATUS[client.status]?.tone ?? 'neutral'}>
          {CLIENT_STATUS[client.status]?.label ?? client.status}
        </StatusPill>
      </div>

      {/* -------------------------------------------- the summary strip */}
      <Panel
        aria-label="Client summary"
        className="grid grid-cols-2 divide-x divide-y divide-hairline bg-panel sm:grid-cols-3 xl:grid-cols-5 xl:divide-y-0"
      >
        <div className="col-span-2 min-w-0 px-4 py-3.5 sm:col-span-1">
          <p className="t-section">Client</p>
          <p className="mt-1.5 break-words text-lg leading-tight text-paper">{client.name}</p>
        </div>
        <div className="min-w-0 px-4 py-3.5">
          <p className="t-section">Won value</p>
          <p className="t-metric mt-1.5">
            {wonTotal.total && wonTotal.total.value > 0
              ? moneyCompact(wonTotal.total.value, wonTotal.total.currency)
              : <span className="text-haze">—</span>}
          </p>
          <p className="t-note mt-1">
            {wonDeals.length} won {wonDeals.length === 1 ? 'deal' : 'deals'}
          </p>
        </div>
        <div className="min-w-0 px-4 py-3.5">
          <p className="t-section">Active projects</p>
          <p className="t-metric mt-1.5">{activeProjects.length}</p>
          <p className="t-note mt-1">{projects.length} in total</p>
        </div>
        <div className="min-w-0 px-4 py-3.5">
          <p className="t-section">Opportunities</p>
          <p className="t-metric mt-1.5">{deals.length}</p>
          <p className="t-note mt-1">{deals.filter((d) => !['won', 'lost'].includes(d.stage)).length} open</p>
        </div>
        <div className="min-w-0 px-4 py-3.5">
          <p className="t-section">Source</p>
          <p className="mt-1.5 break-words text-[13px] text-paper">
            {client.acquisition_source
              ? [client.acquisition_source, client.acquisition_medium].filter(Boolean).join(' / ')
              : <span className="text-haze">Not recorded</span>}
          </p>
          {client.acquisition_campaign && <p className="t-note mt-1">{client.acquisition_campaign}</p>}
        </div>
      </Panel>

      <Grid>
        <div className="col-span-12 grid min-w-0 gap-4 lg:col-span-8">
          {/* ------------------------------------------------ projects */}
          <Panel className="min-w-0">
            <SectionHeader title="Projects" note={`${projects.length}`} />
            {projects.length === 0 ? (
              <p className="px-4 py-3 text-xs text-haze">No projects for this client yet.</p>
            ) : (
              <Table head={['Project', 'Status', { label: 'Value', align: 'right' }, 'Target']} minWidth={560}>
                {projects.map((p) => (
                  <Row key={p.id}>
                    <Cell className="min-w-0">
                      <Link to={`/projects/${p.id}`} className="text-[13px] text-paper hover:text-signal">
                        {p.name}
                      </Link>
                    </Cell>
                    <Cell>
                      <StatusPill tone={projectStatusTone(p.status)}>{projectStatusLabel(p.status)}</StatusPill>
                    </Cell>
                    <Cell align="right" className="num text-xs text-paper">
                      {money(p.value, p.currency) ?? <span className="text-haze">—</span>}
                    </Cell>
                    <Cell className="num whitespace-nowrap text-[11px] text-haze">{shortDate(p.target_date)}</Cell>
                  </Row>
                ))}
              </Table>
            )}
          </Panel>

          {/* ------------------------------------------- opportunities */}
          <Panel className="min-w-0">
            <SectionHeader title="Opportunities" note={`${deals.length}`} />
            {deals.length === 0 ? (
              <p className="px-4 py-3 text-xs text-haze">No opportunities recorded against this client.</p>
            ) : (
              <Table head={['Opportunity', 'Stage', { label: 'Value', align: 'right' }, 'Date']} minWidth={560}>
                {deals.map((d) => (
                  <Row key={d.id}>
                    <Cell className="min-w-0">
                      <Link to={`/sales/${d.id}`} className="text-[13px] text-paper hover:text-signal">
                        {d.title}
                      </Link>
                    </Cell>
                    <Cell><StatusPill tone={stageTone(d.stage)}>{stageLabel(d.stage)}</StatusPill></Cell>
                    <Cell align="right" className="num text-xs text-paper">
                      {money(d.estimated_value, d.currency) ?? <span className="text-haze">—</span>}
                    </Cell>
                    <Cell className="num whitespace-nowrap text-[11px] text-haze">
                      {shortDate(d.won_at ?? d.expected_close_on)}
                    </Cell>
                  </Row>
                ))}
              </Table>
            )}
          </Panel>

          {/* --------------------------------------------------- notes */}
          <Panel>
            <SectionHeader title="Notes" note={detail.notes.length > 0 ? `${detail.notes.length}` : undefined} />
            {mayEdit && (
              <div className="border-b border-hairline px-4 py-3">
                <label className="sr-only" htmlFor="client-note">Add a note</label>
                <Textarea id="client-note" value={draft} onChange={(e) => setDraft(e.target.value)}
                          placeholder="Anything worth remembering about this relationship."
                          className="min-h-20 text-[13px]" />
                <div className="mt-2 flex items-center justify-between gap-3">
                  {error ? <p role="alert" className="text-xs text-danger">{error}</p> : <span />}
                  <Button size="sm" variant="primary" onClick={submitNote} disabled={notes.busy}>Add note</Button>
                </div>
              </div>
            )}
            {detail.notes.length === 0 ? (
              <p className="px-4 py-3 text-xs text-haze">No notes yet.</p>
            ) : (
              <ul className="grid">
                {detail.notes.map((note) => (
                  <li key={note.id} className="border-b border-hairline px-4 py-3 last:border-0">
                    <p className="whitespace-pre-wrap text-[13px] text-paper">{note.body}</p>
                    <p className="t-note mt-1">
                      {note.author?.full_name || note.author?.email || 'Unknown'} · {formatWhen(note.created_at)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {/* ------------------------------------------------ activity */}
          <Panel>
            <SectionHeader title="Activity" note="only what was recorded" />
            <ol className="grid">
              {timeline.map((entry) => (
                <li key={entry.id} className="flex gap-3 border-b border-hairline px-4 py-2.5 last:border-0">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-chrome/40" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] text-paper">{entry.title}</p>
                    {entry.detail && <p className="mt-0.5 break-words text-[11px] text-haze">{entry.detail}</p>}
                    <p className="t-note">{formatWhen(entry.at)}{entry.by ? ` · ${entry.by}` : ''}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Panel>
        </div>

        {/* ------------------------------------------------- the rail */}
        <div className="col-span-12 grid min-w-0 gap-4 lg:col-span-4">
          <Panel>
            <SectionHeader
              title="Contacts"
              action={mayEdit
                ? <Button size="sm" variant="quiet" onClick={() => setContactOpen('new')}>
                    <Plus size={11} aria-hidden="true" /> Add
                  </Button>
                : undefined}
            />
            {contacts.length === 0 ? (
              <p className="px-4 py-3 text-xs text-haze">
                No contacts recorded. The enquiry&rsquo;s own name and address stay on the lead and are
                not copied here.
              </p>
            ) : (
              <ul className="grid">
                {contacts.map((contact) => (
                  <li key={contact.id} className="border-b border-hairline px-4 py-2.5 last:border-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[13px] text-paper">
                          {contact.name}
                          {contact.is_primary && <span className="ml-2"><Badge tone="warn">Primary</Badge></span>}
                        </p>
                        {contact.role && <p className="t-note">{contact.role}</p>}
                        {contact.email && (
                          <a href={`mailto:${contact.email}`}
                             className="block break-all text-[11px] text-haze underline underline-offset-4 hover:text-paper">
                            {contact.email}
                          </a>
                        )}
                        {contact.phone && <p className="num text-[11px] text-haze">{contact.phone}</p>}
                      </div>
                      {mayEdit && (
                        <Button size="sm" variant="quiet" onClick={() => setContactOpen(contact)}>Edit</Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel>
            <SectionHeader
              title="Client"
              action={mayEdit ? <ClientStatusControl client={client} onChanged={reload} /> : undefined}
            />
            <dl className="grid">
              <DataLine
                term="Website"
                value={safeUrl(client.website)
                  ? <a href={safeUrl(client.website)!} target="_blank" rel="noreferrer noopener"
                       className="break-all underline underline-offset-4 hover:text-signal">{client.website}</a>
                  : (client.website || <NotRecorded what="Website" />)}
              />
              <DataLine term="Primary service" value={client.primary_service || <NotRecorded />} />
              <DataLine term="Acquisition source" value={client.acquisition_source || <NotRecorded />} />
              <DataLine term="Campaign" value={client.acquisition_campaign || <span className="text-haze">—</span>} />
              <DataLine term="Client since" value={<span className="num text-[11px]">{shortDate(client.created_at)}</span>} />
              <DataLine term="Reference" value={<span className="num text-[11px]">{client.slug}</span>} />
            </dl>
          </Panel>
        </div>
      </Grid>

      {mayEdit && contactOpen && (
        <ContactDialog
          clientId={client.id}
          contact={contactOpen === 'new' ? null : contactOpen}
          onClose={() => setContactOpen(null)}
          onSaved={() => { setContactOpen(null); void reload(); }}
          onRemove={async (contactId) => {
            await ops.removeContact(contactId);
            setContactOpen(null);
          }}
        />
      )}
    </div>
  );
}

/* ================================================================ pieces */

function ClientStatusControl({ client, onChanged }: { client: Client; onChanged: () => void }) {
  const ops = useOperationsMutations(onChanged);
  return (
    <>
      <label className="sr-only" htmlFor="client-detail-status">Client status</label>
      <Select
        id="client-detail-status"
        value={client.status}
        onChange={(e) => void ops.updateClient(client.id, { status: e.target.value })}
      >
        {CLIENT_STATUSES.map((s) => <option key={s} value={s}>{CLIENT_STATUS[s].label}</option>)}
      </Select>
    </>
  );
}

/**
 * A stored web address, as an href — or null, if it must not become one.
 *
 * The same function, for the same reason, as the one P1 put in `pages/screens.tsx`:
 * `href={value}` on a value that came out of the database is how a `javascript:`
 * URL gets executed by a click. Two schemes are allowed, a bare host is upgraded
 * to https, and anything else renders as plain text — still visible, still
 * copyable, not clickable.
 */
export function safeUrl(value: string | null | undefined): string | null {
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

/* ============================================================== dialogs == */

/**
 * Adding a client by hand (§53), with the duplicate check §40 asks for.
 *
 * The preferred route is still Lead → Opportunity → Won → Client, and the dialog
 * says so: a client created here has no opportunity behind it and therefore no
 * acquisition source, which is a hole in the attribution chain rather than a
 * neutral choice.
 */
function NewClientDialog({
  existing, onClose, onCreated,
}: { existing: Client[]; onClose: () => void; onCreated: (id: string) => void }) {
  const ops = useOperationsMutations(() => {});
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', website: '', primary_service: '', status: 'active' });

  const matches = useMemo(
    () => (form.name.trim().length >= 2
      ? findClientMatches(existing, { name: form.name, website: form.website })
      : []),
    [existing, form.name, form.website],
  );

  const submit = async () => {
    const name = form.name.trim();
    if (!name) { setError('A client needs a name.'); return; }
    const result = await ops.createClient({
      name,
      slug: uniqueSlug(name, existing.map((c) => c.slug)),
      website: form.website.trim() || null,
      primary_service: form.primary_service.trim() || null,
      status: form.status,
    });
    if (typeof result === 'string') { setError(result); return; }
    onCreated(result.id);
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="New client"
      description="The traceable route is Lead → Opportunity → Won → Client. A client added here has no opportunity behind it, so it carries no acquisition source."
      footer={
        <>
          <Button size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" variant="primary" onClick={submit} disabled={ops.busy === 'client'}>Create</Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Field id="new-client-name" label="Name">
          <Input id="new-client-name" value={form.name}
                 onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
        </Field>

        {matches.length > 0 && (
          <div className="rounded-sm border border-signal/25 px-3 py-2.5" role="status">
            <p className="label mb-1 text-signal">This may already exist</p>
            <ul className="grid gap-0.5">
              {matches.map(({ client, why }) => (
                <li key={client.id} className="text-[12px] text-paper">
                  {client.name} <span className="t-note">— matched on {why}</span>
                </li>
              ))}
            </ul>
            <p className="t-note mt-1.5">
              Nothing is blocked and nothing is merged. Check before creating a second record for the
              same company.
            </p>
          </div>
        )}

        <Field id="new-client-website" label="Website">
          <Input id="new-client-website" value={form.website}
                 onChange={(e) => setForm((p) => ({ ...p, website: e.target.value }))}
                 placeholder="example.hu" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="new-client-service" label="Primary service">
            <Input id="new-client-service" value={form.primary_service}
                   onChange={(e) => setForm((p) => ({ ...p, primary_service: e.target.value }))} />
          </Field>
          <Field id="new-client-status" label="Status">
            <Select id="new-client-status" className="w-full py-2.5 text-sm" value={form.status}
                    onChange={(e) => setForm((p) => ({ ...p, status: e.target.value }))}>
              {CLIENT_STATUSES.map((s) => <option key={s} value={s}>{CLIENT_STATUS[s].label}</option>)}
            </Select>
          </Field>
        </div>

        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      </div>
    </Dialog>
  );
}

/** One contact (§20). Deliberately entered, never copied from a lead. */
function ContactDialog({
  clientId, contact, onClose, onSaved, onRemove,
}: {
  clientId: string;
  contact: ClientContact | null;
  onClose: () => void;
  onSaved: () => void;
  onRemove: (id: string) => void;
}) {
  const ops = useOperationsMutations(onSaved);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: contact?.name ?? '',
    role: contact?.role ?? '',
    email: contact?.email ?? '',
    phone: contact?.phone ?? '',
    is_primary: contact?.is_primary ?? false,
  });

  const submit = async () => {
    const problem = await ops.saveContact(clientId, {
      id: contact?.id,
      name: form.name.trim(),
      role: form.role.trim() || null,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      is_primary: form.is_primary,
    });
    if (problem) { setError(problem); return; }
    onSaved();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={contact ? 'Edit contact' : 'Add contact'}
      description="A contact is entered deliberately. The enquiry's own personal data stays on the lead."
      footer={
        <>
          {contact && (
            <Button size="sm" variant="danger" onClick={() => onRemove(contact.id)}>Remove</Button>
          )}
          <Button size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" variant="primary" onClick={submit} disabled={ops.busy === 'contact'}>Save</Button>
        </>
      }
    >
      <div className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="contact-name" label="Name">
            <Input id="contact-name" value={form.name}
                   onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
          </Field>
          <Field id="contact-role" label="Role">
            <Input id="contact-role" value={form.role}
                   onChange={(e) => setForm((p) => ({ ...p, role: e.target.value }))} />
          </Field>
          <Field id="contact-email" label="Email">
            <Input id="contact-email" type="email" value={form.email}
                   onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} />
          </Field>
          <Field id="contact-phone" label="Phone">
            <Input id="contact-phone" value={form.phone}
                   onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} />
          </Field>
        </div>
        <label className={cn('flex cursor-pointer items-center gap-2 text-xs text-haze hover:text-paper')}>
          <input
            type="checkbox"
            checked={form.is_primary}
            onChange={(e) => setForm((p) => ({ ...p, is_primary: e.target.checked }))}
            className="h-3 w-3 accent-signal"
          />
          Primary contact — a client can have only one
        </label>
        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      </div>
    </Dialog>
  );
}

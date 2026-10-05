import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Download } from 'lucide-react';
import { useScope } from '@/lib/scope';
import { Grid } from '@/components/shell/PortalShell';
import {
  Badge, Button, Cell, DataState, ErrorState, Input, Panel, Row, SectionHeader, Select, Skeleton, Table, cn,
} from '@/components/ui';
import { isClosedProject, projectStatusLabel, shortDate } from '@/lib/pipeline';
import { useProjects, type Project } from '@/lib/operations';
import {
  checkStorage, downloadDocument, formatBytes, useDocumentCounts, useDocumentSearch, type StorageReportRow,
} from '@/lib/documents';
import { ProjectLibrary } from '@/features/documents/ProjectLibrary';
import { ProjectFacts } from '@/features/documents/ProjectFacts';
import { t, tc } from '@/lib/i18n';

/**
 * DOCUMENTS — the owner's private document library.
 *
 * Every project is a folder here, paid and Impact alike, open, closed or
 * archived: archiving and reopening never move or remove a file, so a finished
 * project's documents stay exactly where they were. The same files appear on
 * the project's own screen, from the same rows.
 *
 * Owner-only: the route needs `view_documents` (lib/permissions), and every
 * table, function and stored object behind it answers only to `is_owner()`
 * (20260930000100_document_library.sql).
 */

type Filter = 'open' | 'closed' | 'all';

const isOpen = (p: Project) => !p.archived_at && !isClosedProject(p) && p.status !== 'cancelled';

export function DocumentsScreen() {
  const { reloadToken } = useScope();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const filter: Filter = params.get('show') === 'closed' ? 'closed' : params.get('show') === 'all' ? 'all' : 'open';
  const { rows, state, message, reload } = useProjects(reloadToken);
  const { counts, bytes } = useDocumentCounts(reloadToken);
  const [query, setQuery] = useState('');
  const [fileQuery, setFileQuery] = useState('');
  const search = useDocumentSearch(fileQuery, reloadToken);

  const setFilter = (next: Filter) => {
    const updated = new URLSearchParams(params);
    if (next === 'open') updated.delete('show'); else updated.set('show', next);
    setParams(updated, { replace: true });
  };

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter((p) => (filter === 'all' ? true : filter === 'open' ? isOpen(p) : !isOpen(p)))
      .filter((p) => !q || [p.name, p.client?.name, p.service].some((f) => String(f ?? '').toLowerCase().includes(q)))
      .sort((a, b) => a.name.localeCompare(b.name, 'hu'));
  }, [rows, filter, query]);

  return (
    <div className="grid gap-4">
      {/* ------------------------------------------------- file search */}
      <Panel aria-label={t('Find a file')}>
        <SectionHeader
          title={t('Find a file')}
          note={fileQuery.trim().length >= 2 && search.state === 'ready' ? t('{n} found', { n: `${search.hits.length}${search.hits.length === 50 ? '+' : ''}` }) : t('every project')}
          action={
            <Input
              type="search"
              value={fileQuery}
              onChange={(e) => setFileQuery(e.target.value)}
              placeholder={t('File name…')}
              aria-label={t('Search file names')}
              className="h-7 w-48 py-1 text-xs sm:w-72"
            />
          }
        />
        {fileQuery.trim().length >= 2 && (
          search.state === 'loading' ? (
            <div className="p-4" aria-busy="true"><Skeleton className="h-8 w-full" /></div>
          ) : search.state === 'error' ? (
            <p role="alert" className="px-4 py-3 text-xs text-danger">{t('The search could not be run.')}</p>
          ) : search.hits.length === 0 ? (
            <p className="px-4 py-3 text-xs text-haze">{t('No file name contains “{q}”.', { q: fileQuery.trim() })}</p>
          ) : (
            <ul className="grid" aria-label={t('Files found')}>
              {search.hits.map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-2 last:border-0">
                  <div className="min-w-0">
                    <Link
                      to={`/documents/${h.project_id}${h.folder_id ? `?folder=${h.folder_id}&file=${h.id}` : `?file=${h.id}`}`}
                      className="break-all text-[13px] text-paper hover:text-signal"
                    >
                      {h.name}
                    </Link>
                    <p className="t-note">
                      {h.project?.name ?? t('Project')}{h.folder ? ` / ${h.folder.name}` : ''} · {formatBytes(h.byte_size)} · {shortDate(h.completed_at)}
                    </p>
                  </div>
                  <Button size="sm" variant="quiet" aria-label={t('Download {name}', { name: h.name })} onClick={() => void downloadDocument(h)}>
                    <Download size={11} aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          )
        )}
      </Panel>

      {/* ------------------------------------------------ the projects */}
      <Panel className="min-w-0">
        <SectionHeader
          title={t('Project folders')}
          note={state === 'ready' ? t('{n} · {size} stored', { n: shown.length, size: formatBytes(bytes.live) }) : undefined}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <label className="sr-only" htmlFor="documents-show">{t('Show')}</label>
              <Select id="documents-show" value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
                <option value="open">{t('Open projects')}</option>
                <option value="closed">{t('Closed, cancelled and archived')}</option>
                <option value="all">{t('Every project')}</option>
              </Select>
              <Input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('Project, client, service…')}
                aria-label={t('Search projects')}
                className="h-7 w-44 py-1 text-xs sm:w-56"
              />
            </div>
          }
        />
        {state === 'loading' && (
          <div className="space-y-1.5 p-4" aria-busy="true">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
        )}
        {state === 'unconfigured' && (
          <DataState kind="unconfigured" title={t('Not connected')} body={t('Supabase credentials are not set in this environment.')} />
        )}
        {state === 'error' && <ErrorState message={message} onRetry={reload} />}
        {state === 'ready' && shown.length === 0 && (
          <DataState kind="empty" title={rows.length === 0 ? t('No projects yet') : t('Nothing matches')}
                     body={rows.length === 0 ? t('Every project gets a document folder of its own.') : t('No project in this view matches.')} />
        )}
        {state === 'ready' && shown.length > 0 && (
          <Table head={[t('Project'), t('Client'), t('Programme'), t('Status'), { label: t('Files'), align: 'right' }]} minWidth={640}>
            {shown.map((p) => (
              <Row key={p.id} onClick={() => navigate(`/documents/${p.id}`)}>
                <Cell>
                  <Link to={`/documents/${p.id}`} className="text-[13px] text-paper hover:text-signal">{p.name}</Link>
                </Cell>
                <Cell className="truncate text-[11px] text-haze">{p.client?.name ?? '—'}</Cell>
                <Cell>{p.program === 'impact' ? <Badge tone="good">Impact</Badge> : <span className="text-[11px] text-haze">{tc('programme', 'Paid')}</span>}</Cell>
                <Cell className="text-[11px] text-haze">
                  {isClosedProject(p) ? t('Closed') : projectStatusLabel(p.status)}{p.archived_at ? ` · ${t('archived')}` : ''}
                </Cell>
                <Cell align="right" className="num text-xs text-haze">{counts[p.id] ?? 0}</Cell>
              </Row>
            ))}
          </Table>
        )}
      </Panel>

      <Housekeeping trashedBytes={bytes.trashed} />
    </div>
  );
}

/**
 * Finish or expire uploads that never completed, and list what storage holds
 * that the library does not account for. Reports only: nothing here deletes.
 */
function Housekeeping({ trashedBytes }: { trashedBytes: number }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Awaited<ReturnType<typeof checkStorage>> | null>(null);
  const run = async () => { setBusy(true); setResult(await checkStorage()); setBusy(false); };
  const byKind = (rows: StorageReportRow[], kind: StorageReportRow['kind']) => rows.filter((r) => r.kind === kind);

  return (
    <Panel aria-label={t('Storage housekeeping')}>
      <SectionHeader
        title={t('Storage housekeeping')}
        note={t('{size} in the trash', { size: formatBytes(trashedBytes) })}
        action={<Button size="sm" onClick={() => void run()} disabled={busy}>{busy ? t('Checking…') : t('Check uploads')}</Button>}
      />
      <div className="grid gap-2 px-4 py-3 text-xs text-haze">
        <p>
          {t('Files in the trash still occupy storage: the trash is reversible, so nothing is ever deleted automatically and there is no permanent-delete button. Remove a file for good by hand in the Supabase dashboard (Storage → project-documents), after checking the report below.')}
        </p>
        {result && 'error' in result && <p role="alert" className="text-danger">{result.error}</p>}
        {result && !('error' in result) && (
          <ul className="grid gap-1 text-paper" aria-label={t('Storage report')}>
            <li>{t(result.finished === 1 ? '{n} unfinished upload completed; {expired} expired.' : '{n} unfinished uploads completed; {expired} expired.', { n: result.finished, expired: result.expired })}</li>
            {(['orphan_object', 'missing_object', 'changed_object', 'unfinished_object', 'trashed_object'] as const).map((k) => {
              const rows = byKind(result.report, k);
              const n = rows.length;
              const label = {
                orphan_object: t('{n} stored objects with no document', { n }),
                missing_object: t('{n} documents whose stored file is missing', { n }),
                changed_object: t('{n} documents whose stored file changed size since upload', { n }),
                unfinished_object: t('{n} stored objects of failed uploads', { n }),
                trashed_object: t('{n} trashed documents still stored', { n }),
              }[k];
              return (
                <li key={k} className={cn(rows.length > 0 && k !== 'trashed_object' && 'text-signal')}>
                  {label}{rows.length > 0 ? ` · ${formatBytes(rows.reduce((n, r) => n + Number(r.byte_size ?? 0), 0))}` : ''}
                  {rows.length > 0 && k !== 'trashed_object' && (
                    <span className="t-note block break-all">{rows.slice(0, 5).map((r) => r.document_name ?? r.storage_path).join(', ')}{rows.length > 5 ? '…' : ''}</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Panel>
  );
}

export function DocumentsProjectScreen() {
  const { id } = useParams<{ id: string }>();
  const { reloadToken } = useScope();
  const [params, setParams] = useSearchParams();
  const folder = params.get('folder');
  const file = params.get('file');

  const setFolder = (next: string | null) => {
    const updated = new URLSearchParams(params);
    updated.delete('file');
    if (next) updated.set('folder', next); else updated.delete('folder');
    setParams(updated);
  };

  if (!id) return null;
  return (
    <div className="grid gap-4">
      <Link to="/documents" className="t-note inline-flex items-center gap-1.5 underline underline-offset-4 hover:text-paper">
        <ArrowLeft size={11} aria-hidden="true" /> {t('All project folders')}
      </Link>
      <Grid>
        <div className="col-span-12 min-w-0 lg:col-span-8">
          {/* Keyed by project: another project's folder is another queue. */}
          <ProjectLibrary key={id} projectId={id} reloadToken={reloadToken} folderId={folder} onFolderChange={setFolder} highlight={file} />
        </div>
        <div className="col-span-12 min-w-0 lg:col-span-4">
          <ProjectFacts projectId={id} reloadToken={reloadToken} />
        </div>
      </Grid>
    </div>
  );
}

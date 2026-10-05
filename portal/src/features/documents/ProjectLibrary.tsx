import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import {
  ArrowUpFromLine, ChevronRight, Download, Eye, File as FileIcon, Folder, FolderInput, FolderPlus,
  Pencil, RotateCcw, Share2, Trash2, X,
} from 'lucide-react';
import {
  Badge, Button, DataState, Dialog, ErrorState, Field, Input, Panel, SectionHeader, Select, Skeleton, cn,
} from '@/components/ui';
import { shortDate } from '@/lib/pipeline';
import { intlLocale, t } from '@/lib/i18n';
import { FileViewerDialog } from '@/features/documents/FileViewer';
import {
  ALLOWED_SUMMARY, FAILURE_LABEL, MAX_DOCUMENT_BYTES, downloadDocument, folderPath, formatBytes, mayPreview,
  useDocumentMutations, useProjectLibrary, useUploader,
  type Doc, type DocFolder, type UploadItem,
} from '@/lib/documents';
import { useProjectSharing, type AssignedAccount, type LiveShare } from '@/lib/clientAccounts';

/**
 * ONE PROJECT'S DOCUMENTS — the only file browser in the Portal.
 *
 * Rendered by the Documents screen (full width, folder in the URL) and by the
 * project screen (compact, folder in local state). Both read the same rows
 * through `useProjectLibrary`; there is no second list to fall out of step.
 *
 * Owner-only like everything behind it: the route guards decide whether this
 * is drawn, and the policies in 20260930000100_document_library.sql decide
 * whether anything comes back.
 */
export function ProjectLibrary({
  projectId, reloadToken = 0, folderId: controlledFolder, onFolderChange, compact = false, highlight = null,
}: {
  projectId: string;
  reloadToken?: number;
  folderId?: string | null;
  onFolderChange?: (id: string | null) => void;
  compact?: boolean;
  highlight?: string | null;
}) {
  const { folders, docs, state, reload } = useProjectLibrary(projectId, reloadToken);
  const [localFolder, setLocalFolder] = useState<string | null>(null);
  const folderId = controlledFolder !== undefined ? controlledFolder : localFolder;
  const openFolder = useCallback((id: string | null) => {
    if (onFolderChange) onFolderChange(id); else setLocalFolder(id);
  }, [onFolderChange]);

  const refresh = useCallback(() => { void reload(); }, [reload]);
  const ops = useDocumentMutations(refresh);
  const uploads = useUploader(projectId, refresh);
  // Phase 4: who this project is assigned to, and what is shared with whom.
  // `available` is false (and nothing is drawn) before that migration exists.
  const sharing = useProjectSharing(projectId, reloadToken);
  const [sharingTarget, setSharingTarget] = useState<{ kind: 'document' | 'folder'; id: string; name: string } | null>(null);

  const [view, setView] = useState<'files' | 'trash'>('files');
  const [error, setError] = useState<string | null>(null);
  const [naming, setNaming] = useState<
    | { mode: 'new-folder' } | { mode: 'rename-folder'; folder: DocFolder } | { mode: 'rename-doc'; doc: Doc } | null
  >(null);
  const [moving, setMoving] = useState<Doc | null>(null);
  const [previewing, setPreviewing] = useState<Doc | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const live = useMemo(() => ({
    folders: folders.filter((f) => !f.trashed_at),
    docs: docs.filter((d) => !d.trashed_at),
  }), [folders, docs]);

  // A folder that was trashed (or never existed) is not somewhere to be.
  const current = folderId && live.folders.some((f) => f.id === folderId) ? folderId : null;
  useEffect(() => {
    if (state === 'ready' && folderId && current === null) openFolder(null);
  }, [state, folderId, current, openFolder]);

  const crumbs = folderPath(live.folders, current);
  const subfolders = live.folders.filter((f) => f.parent_id === current);
  const here = live.docs.filter((d) => d.folder_id === current);
  const inFolder = (id: string) => live.docs.filter((d) => d.folder_id === id).length
    + live.folders.filter((f) => f.parent_id === id).length;
  const readyCount = live.docs.filter((d) => d.upload_state === 'ready').length;
  const readyBytes = live.docs.filter((d) => d.upload_state === 'ready').reduce((n, d) => n + Number(d.byte_size), 0);
  const trashTop = {
    folders: folders.filter((f) => f.trashed_at && !f.trashed_with),
    docs: docs.filter((d) => d.trashed_at && !d.trashed_with),
  };
  const trashBytes = docs.filter((d) => d.trashed_at && d.upload_state === 'ready')
    .reduce((n, d) => n + Number(d.byte_size), 0);
  const locationOf = (id: string | null) => {
    const path = folderPath(folders, id);
    return path.length ? path.map((f) => f.name).join(' / ') : t('Top level');
  };

  const act = async (p: Promise<string | null>) => setError(await p);
  const addFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setView('files');
    uploads.add(files, current);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  };

  // An upload row that is pending in the database but not in this tab's queue
  // is one this tab is not sending: an earlier session left it unfinished.
  const queued = new Set(uploads.items.map((i) => i.docId).filter(Boolean));
  // …and one this tab IS sending right now cannot be trashed mid-flight.
  const inFlight = new Set(uploads.items
    .filter((i) => !['done', 'failed'].includes(i.phase)).map((i) => i.docId).filter(Boolean));

  return (
    <Panel
      className={cn('min-w-0', dragging && 'border-signal')}
      aria-label={t('Documents')}
    >
      <div
        onDragOver={(e) => { if (view === 'files') { e.preventDefault(); setDragging(true); } }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <SectionHeader
          title={view === 'trash' ? t('Trash') : t('Documents')}
          note={view === 'trash'
            ? t('{n} items · {size} still stored', { n: trashTop.folders.length + trashTop.docs.length, size: formatBytes(trashBytes) })
            : state === 'ready' ? t(readyCount === 1 ? '{n} file · {size}' : '{n} files · {size}', { n: readyCount, size: formatBytes(readyBytes) }) : undefined}
          action={
            <div className="flex flex-wrap items-center gap-1">
              {view === 'files' && (
                <>
                  <Button size="sm" className={TOUCH} variant="quiet" onClick={() => setNaming({ mode: 'new-folder' })}>
                    <FolderPlus size={11} aria-hidden="true" /> {t('Folder')}
                  </Button>
                  <input
                    ref={fileInput}
                    type="file"
                    multiple
                    className="sr-only"
                    tabIndex={-1}
                    id={`upload-${projectId}`}
                    aria-label={t('Upload files')}
                    onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
                  />
                  <Button size="sm" className={TOUCH} variant="primary" onClick={() => fileInput.current?.click()}>
                    <ArrowUpFromLine size={11} aria-hidden="true" /> {t('Upload')}
                  </Button>
                </>
              )}
              <Button
                size="sm"
                className={TOUCH}
                variant="quiet"
                aria-pressed={view === 'trash'}
                onClick={() => setView(view === 'trash' ? 'files' : 'trash')}
              >
                {view === 'trash' ? <><X size={11} aria-hidden="true" /> {t('Close trash')}</> : <><Trash2 size={11} aria-hidden="true" /> {t('Trash')}</>}
              </Button>
            </div>
          }
        />

        {uploads.items.length > 0 && (
          <UploadQueue items={uploads.items} onRetry={uploads.retry} onCancel={uploads.cancel} onClear={uploads.clearFinished} />
        )}

        {error && <p role="alert" className="border-b border-hairline px-4 py-2 text-xs text-danger">{error}</p>}

        {state === 'loading' && (
          <div className="space-y-1.5 p-4" aria-busy="true">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-8 w-full" />)}
          </div>
        )}
        {state === 'unconfigured' && (
          <DataState kind="unconfigured" title={t('Not connected')} body={t('Supabase credentials are not set in this environment.')} />
        )}
        {state === 'error' && (
          <ErrorState message={t('The documents could not be read. The library may not be set up in this database yet.')} onRetry={refresh} />
        )}

        {state === 'ready' && view === 'files' && (
          <>
            <nav aria-label={t('Folder path')} className="flex flex-wrap items-center gap-1 border-b border-hairline px-4 py-2 text-[12px]">
              <button type="button" onClick={() => openFolder(null)}
                      className={cn('hover:text-paper', current === null ? 'text-paper' : 'text-haze underline underline-offset-4')}
                      aria-current={current === null ? 'location' : undefined}>
                {t('Project files')}
              </button>
              {crumbs.map((f) => (
                <span key={f.id} className="inline-flex items-center gap-1">
                  <ChevronRight size={11} aria-hidden="true" className="text-haze" />
                  <button type="button" onClick={() => openFolder(f.id)}
                          className={cn('break-all hover:text-paper', f.id === current ? 'text-paper' : 'text-haze underline underline-offset-4')}
                          aria-current={f.id === current ? 'location' : undefined}>
                    {f.name}
                  </button>
                </span>
              ))}
            </nav>

            {subfolders.length === 0 && here.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-haze">
                {current === null
                  ? t('No documents yet. Upload files or drop them here — up to {max} each.', { max: formatBytes(MAX_DOCUMENT_BYTES) })
                  : t('This folder is empty. Upload files or drop them here.')}
              </p>
            ) : (
              <ul className={cn('grid', compact && 'max-h-[28rem] overflow-y-auto')} aria-label={t('Folder contents')}>
                {subfolders.map((f) => (
                  <li key={f.id} className="flex items-center justify-between gap-2 border-b border-hairline px-4 py-2 last:border-0">
                    <button type="button" onClick={() => openFolder(f.id)}
                            className="flex min-w-0 items-center gap-2 text-left text-[13px] text-paper hover:text-signal">
                      <Folder size={13} aria-hidden="true" className="shrink-0 text-chrome" />
                      <span className="break-all">{f.name}</span>
                      <span className="t-note shrink-0">{inFolder(f.id)}</span>
                      {f.purpose === 'client_uploads' && <Badge tone="neutral">{t('From clients')}</Badge>}
                      <ShareMark names={sharedNames(sharing.shares.filter((x) => x.folder_id === f.id), sharing.accounts)} />
                    </button>
                    <div className="flex shrink-0 items-center">
                      {sharing.available && (
                        <Button size="sm" className={TOUCH} variant="quiet" aria-label={t('Share folder {name}', { name: f.name })}
                                onClick={() => setSharingTarget({ kind: 'folder', id: f.id, name: f.name })}>
                          <Share2 size={11} aria-hidden="true" />
                        </Button>
                      )}
                      <Button size="sm" className={TOUCH} variant="quiet" aria-label={t('Rename folder {name}', { name: f.name })}
                              onClick={() => setNaming({ mode: 'rename-folder', folder: f })}>
                        <Pencil size={11} aria-hidden="true" />
                      </Button>
                      <Button size="sm" className={TOUCH} variant="quiet" aria-label={t('Move folder {name} to the trash', { name: f.name })}
                              disabled={ops.busy === `trash-${f.id}`}
                              onClick={() => void act(ops.trashFolder(f.id))}>
                        <Trash2 size={11} aria-hidden="true" />
                      </Button>
                    </div>
                  </li>
                ))}
                {here.map((d) => (
                  <li key={d.id}
                      className={cn('flex flex-wrap items-center justify-between gap-2 border-b border-hairline px-4 py-2 last:border-0',
                        highlight === d.id && 'bg-flare')}
                      data-document={d.id}>
                    <div className="flex min-w-0 items-center gap-2">
                      <FileIcon size={13} aria-hidden="true" className="shrink-0 text-haze" />
                      <div className="min-w-0">
                        <p className="break-all text-[13px] text-paper">{d.name}</p>
                        <p className="t-note">
                          {formatBytes(d.byte_size)} · {shortDate(d.completed_at ?? d.created_at)}
                          {d.client_account_id && <> · {t('from {name}', { name: d.uploader?.full_name ?? t('a client') })} · {new Date(d.created_at).toLocaleString(intlLocale('en-GB'), { dateStyle: 'medium', timeStyle: 'short' })}</>}
                          {d.upload_state === 'pending' && !queued.has(d.id) && <> · <Badge tone="warn">{t('Unfinished upload')}</Badge></>}
                          {d.upload_state === 'failed' && !queued.has(d.id) && (
                            <> · <Badge tone="bad">{t('Upload failed')}</Badge> {t(FAILURE_LABEL[d.failure_reason ?? ''] ?? '')} {t('Upload the file again.')}</>
                          )}
                        </p>
                      </div>
                    </div>
                    <ShareMark
                      names={sharedNames(sharing.shares.filter((x) => x.document_id === d.id), sharing.accounts)}
                      inherited={sharedNames(sharing.shares.filter((x) => x.folder_id
                        && folderPath(live.folders, d.folder_id).some((f) => f.id === x.folder_id)), sharing.accounts)}
                    />
                    <div className="flex shrink-0 items-center">
                      {sharing.available && d.upload_state === 'ready' && (
                        <Button size="sm" className={TOUCH} variant="quiet" aria-label={t('Share {name}', { name: d.name })}
                                onClick={() => setSharingTarget({ kind: 'document', id: d.id, name: d.name })}>
                          <Share2 size={11} aria-hidden="true" />
                        </Button>
                      )}
                      {d.upload_state === 'ready' && mayPreview(d) && (
                        <Button size="sm" className={TOUCH} variant="quiet" aria-label={t('Preview {name}', { name: d.name })} onClick={() => setPreviewing(d)}>
                          <Eye size={11} aria-hidden="true" />
                        </Button>
                      )}
                      {d.upload_state === 'ready' && (
                        <Button size="sm" className={TOUCH} variant="quiet" aria-label={t('Download {name}', { name: d.name })}
                                onClick={() => void act(downloadDocument(d))}>
                          <Download size={11} aria-hidden="true" />
                        </Button>
                      )}
                      <Button size="sm" className={TOUCH} variant="quiet" aria-label={t('Rename {name}', { name: d.name })}
                              onClick={() => setNaming({ mode: 'rename-doc', doc: d })}>
                        <Pencil size={11} aria-hidden="true" />
                      </Button>
                      <Button size="sm" className={TOUCH} variant="quiet" aria-label={t('Move {name}', { name: d.name })} onClick={() => setMoving(d)}>
                        <FolderInput size={11} aria-hidden="true" />
                      </Button>
                      <Button size="sm" className={TOUCH} variant="quiet" aria-label={t('Move {name} to the trash', { name: d.name })}
                              disabled={ops.busy === `trash-${d.id}` || inFlight.has(d.id)}
                              onClick={() => void act(ops.trashDocument(d.id))}>
                        <Trash2 size={11} aria-hidden="true" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <p className="t-note border-t border-hairline px-4 py-2">
              {t('Upload with the button or by dropping files here. Up to {max} each: {types}. Each file is checked by its content, not only its name — it is not virus-scanned.', {
                max: formatBytes(MAX_DOCUMENT_BYTES), types: t(ALLOWED_SUMMARY),
              })}
            </p>
            {dragging && (
              <p className="border-t border-hairline px-4 py-2 text-center text-xs text-signal">
                {t('Drop to upload into {folder}', { folder: crumbs.at(-1)?.name ?? t('the project’s top level') })}
              </p>
            )}
          </>
        )}

        {state === 'ready' && view === 'trash' && (
          <>
            <p className="t-note border-b border-hairline px-4 py-2">
              {t('Restoring puts an item back where it was. Nothing here is ever deleted automatically — and every file in the trash still occupies storage until it is removed by hand in the Supabase dashboard.')}
            </p>
            {trashTop.folders.length + trashTop.docs.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-haze">{t('The trash is empty.')}</p>
            ) : (
              <ul className="grid" aria-label={t('Trash')}>
                {trashTop.folders.map((f) => (
                  <li key={f.id} className="flex items-center justify-between gap-2 border-b border-hairline px-4 py-2 last:border-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <Folder size={13} aria-hidden="true" className="shrink-0 text-haze" />
                      <div className="min-w-0">
                        <p className="break-all text-[13px] text-paper">{f.name}</p>
                        <p className="t-note">
                          {t('from {location} · {n} files inside · trashed {date}', {
                            location: locationOf(f.parent_id), n: docs.filter((d) => d.trashed_with === f.id).length, date: shortDate(f.trashed_at),
                          })}
                        </p>
                      </div>
                    </div>
                    <Button size="sm" className={TOUCH} onClick={() => void act(ops.restoreFolder(f.id))} disabled={ops.busy === `restore-${f.id}`}>
                      <RotateCcw size={11} aria-hidden="true" /> {t('Restore')}
                    </Button>
                  </li>
                ))}
                {trashTop.docs.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-2 border-b border-hairline px-4 py-2 last:border-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <FileIcon size={13} aria-hidden="true" className="shrink-0 text-haze" />
                      <div className="min-w-0">
                        <p className="break-all text-[13px] text-paper">{d.name}</p>
                        <p className="t-note">{t('from {location} · {size} · trashed {date}', { location: locationOf(d.folder_id), size: formatBytes(d.byte_size), date: shortDate(d.trashed_at) })}</p>
                      </div>
                    </div>
                    <Button size="sm" className={TOUCH} onClick={() => void act(ops.restoreDocument(d.id))} disabled={ops.busy === `restore-${d.id}`}>
                      <RotateCcw size={11} aria-hidden="true" /> {t('Restore')}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      {naming && (
        <NameDialog
          title={naming.mode === 'new-folder' ? t('New folder') : naming.mode === 'rename-folder' ? t('Rename folder') : t('Rename file')}
          initial={naming.mode === 'rename-folder' ? naming.folder.name : naming.mode === 'rename-doc' ? naming.doc.name : ''}
          hint={naming.mode === 'new-folder'
            ? t('Inside {folder}.', { folder: crumbs.at(-1)?.name ?? t('the project’s top level') })
            : t('Renaming never moves or copies the stored file.')}
          onClose={() => setNaming(null)}
          onSave={async (name) => {
            const problem = naming.mode === 'new-folder'
              ? await ops.createFolder(projectId, current, name)
              : naming.mode === 'rename-folder'
                ? await ops.renameFolder(naming.folder.id, name)
                : await ops.renameDocument(naming.doc.id, name);
            if (!problem) setNaming(null);
            return problem;
          }}
        />
      )}
      {moving && (
        <MoveDialog
          doc={moving}
          folders={live.folders}
          onClose={() => setMoving(null)}
          onMove={async (target) => {
            const problem = await ops.moveDocument(moving.id, target);
            if (!problem) setMoving(null);
            return problem;
          }}
        />
      )}
      {previewing && <PreviewDialog doc={previewing} onClose={() => setPreviewing(null)} />}
      {sharingTarget && (
        <ShareDialog
          target={sharingTarget}
          accounts={sharing.accounts}
          shares={sharing.shares}
          inherited={sharingTarget.kind === 'document'
            ? sharing.shares.filter((x) => {
                const doc = docs.find((d) => d.id === sharingTarget.id);
                return x.folder_id && folderPath(live.folders, doc?.folder_id ?? null).some((f) => f.id === x.folder_id);
              })
            : []}
          folderName={(id) => folders.find((f) => f.id === id)?.name ?? t('a folder')}
          onShare={sharing.share}
          onUnshare={sharing.unshare}
          onClose={() => setSharingTarget(null)}
        />
      )}
    </Panel>
  );
}

/** At phone width every control is at least 40px square — a thumb, not a cursor. */
const TOUCH = 'max-sm:min-h-10 max-sm:min-w-10';

const sharedNames = (shares: LiveShare[], accounts: AssignedAccount[]) =>
  [...new Set(shares.map((x) => accounts.find((a) => a.account_id === x.account_id)?.full_name).filter(Boolean) as string[])];

/** Who can see this row: directly, and (for a file) through a folder above it. */
function ShareMark({ names, inherited = [] }: { names: string[]; inherited?: string[] }) {
  const via = inherited.filter((n) => !names.includes(n));
  if (names.length === 0 && via.length === 0) return null;
  return (
    <span className="t-note flex shrink-0 items-center gap-1" data-shared-with={[...names, ...via].join(', ')}>
      <Share2 size={10} aria-hidden="true" />
      {names.length > 0 && <span>{names.join(', ')}</span>}
      {via.length > 0 && <span>{names.length > 0 ? '; ' : ''}{t('via folder: {names}', { names: via.join(', ') })}</span>}
    </span>
  );
}

/**
 * Share one file or one folder with client accounts assigned to this project.
 * A folder share covers everything inside it — subfolders and files added
 * later — for as long as they stay inside.
 */
function ShareDialog({
  target, accounts, shares, inherited, folderName, onShare, onUnshare, onClose,
}: {
  target: { kind: 'document' | 'folder'; id: string; name: string };
  accounts: AssignedAccount[];
  shares: LiveShare[];
  inherited: LiveShare[];
  folderName: (id: string) => string;
  onShare: (accountId: string, t: { document_id?: string; folder_id?: string }) => Promise<string | null>;
  onUnshare: (shareId: string) => Promise<string | null>;
  onClose: () => void;
}) {
  const [problem, setProblem] = useState<string | null>(null);
  const direct = (accountId: string) => shares.find((x) => x.account_id === accountId
    && (target.kind === 'document' ? x.document_id === target.id : x.folder_id === target.id));
  return (
    <Dialog open onClose={onClose} wide title={t('Share {name}', { name: target.name })}
            description={target.kind === 'folder'
              ? t('Sharing a folder gives access to everything in it — its subfolders and any file added later — for as long as it stays inside. Moving a file out ends that access.')
              : t('Only this file. Files are private until shared; a client downloads with a one-minute link, and a copy already downloaded cannot be taken back.')}
            footer={<Button size="sm" onClick={onClose}>{t('Done')}</Button>}>
      {accounts.length === 0 ? (
        <p className="text-xs text-haze">{t('No client account is assigned to this project. Assign one on the client’s page first.')}</p>
      ) : (
        <ul className="grid gap-1" aria-label={t('Client accounts')}>
          {accounts.map((a) => {
            const s = direct(a.account_id);
            const via = inherited.filter((x) => x.account_id === a.account_id);
            return (
              <li key={a.account_id} className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline py-2 last:border-0">
                <div className="min-w-0">
                  <p className="text-[13px] text-paper">{a.full_name}</p>
                  <p className="t-note break-all">{a.email}{a.linked ? '' : ` · ${t('not linked yet')}`}</p>
                  {via.length > 0 && <p className="t-note">{t('Already sees it through “{folder}”.', { folder: folderName(via[0].folder_id!) })}</p>}
                </div>
                {s ? (
                  <Button size="sm" className={TOUCH} variant="danger" onClick={async () => setProblem(await onUnshare(s.id))}>{t('Stop sharing')}</Button>
                ) : (
                  <Button size="sm" className={TOUCH} onClick={async () => setProblem(await onShare(a.account_id,
                    target.kind === 'document' ? { document_id: target.id } : { folder_id: target.id }))}>
                    <Share2 size={11} aria-hidden="true" /> {t('Share')}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {problem && <p role="alert" className="mt-2 text-xs text-danger">{problem}</p>}
    </Dialog>
  );
}

const PHASE_LABEL: Record<UploadItem['phase'], string> = {
  queued: 'Waiting', starting: 'Starting', uploading: 'Uploading', verifying: 'Checking', done: 'Uploaded', failed: 'Failed',
};

function UploadQueue({
  items, onRetry, onCancel, onClear,
}: { items: UploadItem[]; onRetry: (k: string) => void; onCancel: (k: string) => void; onClear: () => void }) {
  const done = items.filter((i) => i.phase === 'done').length;
  return (
    <div className="border-b border-hairline" aria-label={t('Uploads')}>
      <div className="flex items-center justify-between gap-2 px-4 pt-2">
        <p className="t-note">{t('{done} of {total} uploaded', { done, total: items.length })}</p>
        {done > 0 && <Button size="sm" className={TOUCH} variant="quiet" onClick={onClear}>{t('Clear finished')}</Button>}
      </div>
      <ul className="grid gap-1.5 px-4 py-2" aria-live="polite">
        {items.map((i) => (
          <li key={i.key} className="grid gap-1" data-upload-phase={i.phase}>
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 break-all text-[12px] text-paper">{i.name}</span>
              <span className="flex shrink-0 items-center gap-1">
                <span className={cn('t-note', i.phase === 'failed' && 'text-danger', i.phase === 'done' && 'text-paper')}>
                  {t(PHASE_LABEL[i.phase])}{i.phase === 'uploading' ? ` ${Math.round(i.progress * 100)}%` : ''}
                </span>
                {i.phase === 'failed' && i.retryable && (
                  <Button size="sm" variant="quiet" className={TOUCH} onClick={() => onRetry(i.key)}>{t('Retry')}</Button>
                )}
                {(i.phase === 'uploading' || i.phase === 'starting') && (
                  <Button size="sm" className={TOUCH} variant="quiet" aria-label={t('Cancel {name}', { name: i.name })} onClick={() => onCancel(i.key)}>
                    <X size={11} aria-hidden="true" />
                  </Button>
                )}
              </span>
            </div>
            <div className="h-0.5 w-full overflow-hidden rounded-full bg-flare" role="progressbar"
                 aria-label={t('{name} upload', { name: i.name })} aria-valuemin={0} aria-valuemax={100}
                 aria-valuenow={Math.round((i.phase === 'done' ? 1 : i.progress) * 100)}>
              <div className={cn('h-full transition-[width]', i.phase === 'failed' ? 'bg-danger' : 'bg-signal')}
                   style={{ width: `${Math.round((i.phase === 'done' ? 1 : i.progress) * 100)}%` }} />
            </div>
            {i.message && <p role="alert" className="text-[11px] text-danger">{i.message}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function NameDialog({
  title, initial, hint, onClose, onSave,
}: { title: string; initial: string; hint: string; onClose: () => void; onSave: (name: string) => Promise<string | null> }) {
  const [name, setName] = useState(initial);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!name.trim()) { setProblem(t('A name is required.')); return; }
    setBusy(true);
    setProblem(await onSave(name));
    setBusy(false);
  };
  return (
    <Dialog open onClose={onClose} title={title}
            footer={<><Button size="sm" className={TOUCH} onClick={onClose}>{t('Cancel')}</Button>
              <Button size="sm" className={TOUCH} variant="primary" onClick={() => void submit()} disabled={busy}>{t('Save')}</Button></>}>
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <Field id="document-name" label={t('Name')} hint={hint} error={problem ?? undefined}>
          <Input id="document-name" data-autofocus value={name} maxLength={200} onChange={(e) => setName(e.target.value)} invalid={!!problem} />
        </Field>
      </form>
    </Dialog>
  );
}

function MoveDialog({
  doc, folders, onClose, onMove,
}: { doc: Doc; folders: DocFolder[]; onClose: () => void; onMove: (target: string | null) => Promise<string | null> }) {
  const [target, setTarget] = useState(doc.folder_id ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  const options = useMemo(() => folders
    .map((f) => ({ id: f.id, label: folderPath(folders, f.id).map((p) => p.name).join(' / ') }))
    .sort((a, b) => a.label.localeCompare(b.label)), [folders]);
  return (
    <Dialog open onClose={onClose} title={t('Move {name}', { name: doc.name })}
            description={t('Within this project. If the folder already has a file of this name, the moved one is numbered.')}
            footer={<><Button size="sm" className={TOUCH} onClick={onClose}>{t('Cancel')}</Button>
              <Button size="sm" className={TOUCH} variant="primary" disabled={(target || null) === doc.folder_id}
                      onClick={async () => setProblem(await onMove(target || null))}>{t('Move')}</Button></>}>
      <Field id="move-target" label={t('Folder')} error={problem ?? undefined}>
        <Select id="move-target" value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">{t('Project files (top level)')}</option>
          {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </Select>
      </Field>
    </Dialog>
  );
}

/**
 * A preview of a file whose BYTES say it is a raster image or plain text: an
 * `<img>` of a blob re-typed from the sniffed bytes, or a React text node. No
 * frame, no HTML injection, nothing that can run. Everything else downloads.
 */
function PreviewDialog({ doc, onClose }: { doc: Doc; onClose: () => void }) {
  return <FileViewerDialog doc={doc} onClose={onClose} onDownload={() => void downloadDocument(doc)} />;
}

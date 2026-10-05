import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase, isConfigured, publicConfig } from '@/lib/supabase';
import { t } from '@/lib/i18n';
import {
  DOCUMENT_BUCKET, DOWNLOAD_URL_SECONDS, FAILURE_LABEL, MAX_DOCUMENT_BYTES, cleanFileName, documentRefusal,
  DOC_COLUMNS, FOLDER_COLUMNS, SNIFF_BYTES, checkUploadable, escapeLike, sniffPreview,
  type Doc, type DocFolder, type PreviewKind,
} from '@/lib/documentRules';

export * from '@/lib/documentRules';

/**
 * THE DOCUMENT LIBRARY — data and rules.
 *
 * One library, per project, owner-only. The Documents screen and the project
 * screen both render `ProjectLibrary` over the rows read here; there is no
 * second store and no copy (20260930000100_document_library.sql).
 *
 * ## Where a file lives
 *
 * `project-documents/<project id>/<document id>`. The database generates that
 * key; nothing a person types is ever part of it. A rename or a move is one row
 * update and never touches the stored bytes.
 *
 * ## How a file gets there
 *
 *   1. `document_begin_upload` — a `pending` row under a free name
 *   2. a signed upload URL for exactly that row's path (Storage checks the
 *      owner's insert policy, which only admits a pending row's path)
 *   3. the browser PUTs the bytes straight to Storage — never through a Netlify
 *      function — as application/octet-stream, without upsert
 *   4. `document_finish_upload` — the database looks at what Storage holds and
 *      only then calls it `ready`
 *
 * Signed URLs (upload and download) are held in a local variable for the one
 * request that uses them. They are never put in state, storage, a URL of this
 * app, or a log line.
 */

/* ============================================================= reads == */

type ReadState = 'loading' | 'ready' | 'error' | 'unconfigured';

/** Every folder and document of one project, the trash included. Two indexed reads. */
export function useProjectLibrary(projectId: string | undefined, reloadToken = 0) {
  const [folders, setFolders] = useState<DocFolder[]>([]);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [state, setState] = useState<ReadState>(isConfigured ? 'loading' : 'unconfigured');

  const load = useCallback(async () => {
    if (!isConfigured) return setState('unconfigured');
    if (!projectId) return;
    const [f, d] = await Promise.all([
      supabase.from('document_folders').select(FOLDER_COLUMNS)
        .eq('project_id', projectId).order('name', { ascending: true }).limit(2000),
      supabase.from('project_documents').select(DOC_COLUMNS)
        .eq('project_id', projectId).order('name', { ascending: true }).limit(5000),
    ]);
    if (f.error || d.error) {
      console.error('[documents.library]', f.error?.code ?? d.error?.code);
      setState('error');
      return;
    }
    setFolders((f.data ?? []) as unknown as DocFolder[]);
    setDocs((d.data ?? []) as unknown as Doc[]);
    setState('ready');
  }, [projectId, reloadToken]);

  useEffect(() => { void load(); }, [load]);
  return { folders, docs, state, reload: load };
}

/** How many finished, untrashed files each project holds — for the project list. */
export function useDocumentCounts(reloadToken = 0) {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [bytes, setBytes] = useState<{ live: number; trashed: number }>({ live: 0, trashed: 0 });
  useEffect(() => {
    if (!isConfigured) return;
    let alive = true;
    void supabase.from('project_documents').select('project_id, byte_size, trashed_at')
      .eq('upload_state', 'ready').limit(10000)
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) { console.error('[documents.counts]', error.code); return; }
        const next: Record<string, number> = {};
        let live = 0;
        let trashed = 0;
        for (const r of (data ?? []) as { project_id: string; byte_size: number; trashed_at: string | null }[]) {
          if (r.trashed_at) { trashed += Number(r.byte_size); continue; }
          next[r.project_id] = (next[r.project_id] ?? 0) + 1;
          live += Number(r.byte_size);
        }
        setCounts(next);
        setBytes({ live, trashed });
      });
    return () => { alive = false; };
  }, [reloadToken]);
  return { counts, bytes };
}

export interface SearchHit extends Doc {
  project: { id: string; name: string } | null;
  folder: { id: string; name: string } | null;
}

/** File-name search across every document this account may read. Debounced; at most 50 hits. */
export function useDocumentSearch(query: string, reloadToken = 0) {
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const q = query.trim();

  useEffect(() => {
    if (!isConfigured || q.length < 2) { setHits([]); setState('idle'); return; }
    let alive = true;
    setState('loading');
    const timer = window.setTimeout(async () => {
      const { data, error } = await supabase.from('project_documents')
        .select(`${DOC_COLUMNS}, project:projects(id, name), folder:document_folders(id, name)`)
        .ilike('name', `%${escapeLike(q)}%`)
        .is('trashed_at', null).eq('upload_state', 'ready')
        .order('name', { ascending: true }).limit(50);
      if (!alive) return;
      if (error) { console.error('[documents.search]', error.code); setState('error'); return; }
      setHits((data ?? []) as unknown as SearchHit[]);
      setState('ready');
    }, 250);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [q, reloadToken]);

  return { hits, state };
}

/* =========================================================== changes == */

/** Every change but the upload. Each resolves to `null` on success or a sentence. */
export function useDocumentMutations(onChanged: () => void) {
  const [busy, setBusy] = useState<string | null>(null);

  const run = useCallback(async (key: string, op: () => PromiseLike<{ error: { code?: string; message?: string } | null }>) => {
    setBusy(key);
    try {
      const { error } = await op();
      if (error) { console.error(`[documents.${key}]`, error.code); return documentRefusal(error); }
      onChanged();
      return null;
    } finally {
      setBusy(null);
    }
  }, [onChanged]);

  return {
    busy,
    createFolder: (projectId: string, parentId: string | null, name: string) => run('folder',
      () => supabase.from('document_folders').insert({ project_id: projectId, parent_id: parentId, name: name.trim() })),
    renameFolder: (id: string, name: string) => run(`rename-${id}`,
      () => supabase.from('document_folders').update({ name: name.trim() }).eq('id', id)),
    trashFolder: (id: string) => run(`trash-${id}`, () => supabase.rpc('document_trash_folder', { p_folder: id })),
    restoreFolder: (id: string) => run(`restore-${id}`, () => supabase.rpc('document_restore_folder', { p_folder: id })),
    renameDocument: (id: string, name: string) => run(`rename-${id}`,
      () => supabase.from('project_documents').update({ name: name.trim() }).eq('id', id)),
    moveDocument: (id: string, folderId: string | null) => run(`move-${id}`,
      () => supabase.rpc('document_move', { p_id: id, p_folder: folderId })),
    // The database stamps the time and who; the value sent only says "yes".
    trashDocument: (id: string) => run(`trash-${id}`,
      () => supabase.from('project_documents').update({ trashed_at: new Date().toISOString() }).eq('id', id)),
    restoreDocument: (id: string) => run(`restore-${id}`, () => supabase.rpc('document_restore', { p_id: id })),
  };
}

/**
 * Start a download under the document's own name.
 *
 * A signed URL that lives one minute is fetched once, here, and the bytes are
 * saved from a `blob:` URL the page owns, with the display name in the
 * anchor's `download` attribute. Why not simply follow the signed URL:
 *
 *   - the browser ignores `download="…"` on a cross-origin URL and uses the
 *     server's Content-Disposition instead, and
 *   - Storage (1.77, observed on a real local stack) double-encodes a non-ASCII
 *     download name: "Ajánlat.pdf" arrived as "Aj%C3%A1nlat.pdf" — every
 *     Hungarian file name with an accent was saved garbled.
 *
 * The blob is typed `application/octet-stream` whatever the file is, so the
 * browser saves it and never renders it; it is only ever put in an anchor with
 * `download`, never in a frame or a new tab. The URL is revoked shortly after.
 */
export async function downloadDocument(doc: Pick<Doc, 'storage_path' | 'name'>): Promise<string | null> {
  const { data, error } = await supabase.storage.from(DOCUMENT_BUCKET)
    .createSignedUrl(doc.storage_path, DOWNLOAD_URL_SECONDS, { download: true });
  if (error || !data?.signedUrl) {
    console.error('[documents.download]', error?.name ?? 'none');
    return t('The download could not be started. Try again.');
  }
  let blob: Blob;
  try {
    const res = await fetch(data.signedUrl);
    if (!res.ok) {
      console.error('[documents.download]', res.status);
      return t('The download could not be started. Try again.');
    }
    blob = new Blob([await res.arrayBuffer()], { type: 'application/octet-stream' });
  } catch {
    console.error('[documents.download]', 'network');
    return t('The download could not be started. Try again.');
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener noreferrer';
  a.download = doc.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return null;
}

/** The bytes, for a preview — the owner's, or a client's shared file. The kind comes from the bytes. */
export async function loadPreview(doc: Pick<Doc, 'storage_path' | 'name'>):
Promise<{ kind: PreviewKind; blob: Blob; text?: string } | { error: string }> {
  const { data, error } = await supabase.storage.from(DOCUMENT_BUCKET).download(doc.storage_path);
  if (error || !data) {
    console.error('[documents.preview]', error?.name ?? 'none');
    return { error: t('The file could not be read. Try downloading it.') };
  }
  const head = new Uint8Array(await data.slice(0, 8192).arrayBuffer());
  const kind = sniffPreview(head, doc.name);
  if (!kind) return { error: t('This file is not shown inside the Portal. Download it instead.') };
  if (kind.kind === 'text') {
    const text = new TextDecoder('utf-8').decode(await data.slice(0, 200_000).arrayBuffer());
    return { kind, blob: data, text };
  }
  // An image is re-typed from the sniffed bytes, never from the stored or
  // declared type. PDF, .docx and .xlsx are read as bytes by their viewers.
  if (kind.kind === 'image') return { kind, blob: new Blob([data], { type: kind.mime }) };
  return { kind, blob: new Blob([data], { type: 'application/octet-stream' }) };
}

/* ============================================================ uploads == */

export type UploadPhase = 'queued' | 'starting' | 'uploading' | 'verifying' | 'done' | 'failed';

export interface UploadItem {
  key: string;
  file: File;
  folderId: string | null;
  phase: UploadPhase;
  progress: number;          // 0..1 of the bytes sent
  message: string | null;
  docId: string | null;
  path: string | null;
  name: string;
  attempts: number;
  /** False when retrying cannot help (a refused type, a file over the limit). */
  retryable: boolean;
}

class HttpError extends Error {
  constructor(public status: number) { super(`http ${status}`); }
}

/**
 * PUT the file to a signed upload URL with progress. Raw body (not a form), so
 * the object is stored as application/octet-stream; `x-upsert: false`, so an
 * existing object is never replaced (Storage answers 409).
 */
function putWithProgress(signedUrl: string, file: File, onProgress: (p: number) => void, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', signedUrl);
    xhr.setRequestHeader('content-type', 'application/octet-stream');
    xhr.setRequestHeader('x-upsert', 'false');
    xhr.setRequestHeader('cache-control', 'max-age=0');
    if (publicConfig.anonKey) xhr.setRequestHeader('apikey', publicConfig.anonKey);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new HttpError(xhr.status)));
    xhr.onerror = () => reject(new HttpError(0));
    xhr.ontimeout = () => reject(new HttpError(0));
    signal.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.onabort = () => reject(new DOMException('aborted', 'AbortError'));
    xhr.send(file);
  });
}

const wait = (ms: number) => new Promise((r) => window.setTimeout(r, ms));
/** Automatic retries for a dropped connection or a 5xx, before asking the person. */
const AUTO_RETRIES = 2;
const PARALLEL = 2;

type Refusal = { code?: string; message?: string } | null | undefined;

/**
 * The server side of one upload. The owner's library and the client's
 * "Nyersanyag leadása" run the SAME lifecycle below, each through its own
 * checked database functions (the client's re-check the current project
 * assignment at every step).
 */
export interface UploadApi {
  begin(a: { projectId: string; folderId: string | null; name: string; size: number; type: string | null; kind: string }):
  Promise<{ row: { id: string; name: string; storage_path: string } | null; error: Refusal }>;
  finish(id: string): Promise<'ready' | 'missing' | 'failed' | 'error'>;
  /** Why a row failed, as its stored reason. */
  reason(id: string): Promise<string | null>;
  /** failed → pending (a retry), or pending → failed with a reason. Best effort. */
  mark(id: string, state: 'pending' | 'failed', reason?: string): Promise<void>;
}

/** The words of an upload's outcome — English for the owner, Hungarian for a client. */
export interface UploadText {
  refusal(error: Refusal): string;
  failure(reason: string | null): string;
  typeRefused(v: { code: 'extension' | 'content'; ext: string }): string;
  unconfirmed: string;
  unexpected: string;
}

export const OWNER_UPLOAD_API: UploadApi = {
  async begin(a) {
    const { data, error } = await supabase.rpc('document_begin_upload', {
      p_project: a.projectId, p_folder: a.folderId, p_name: a.name, p_size: a.size, p_type: a.type, p_kind: a.kind,
    });
    return { row: (data as { id: string; name: string; storage_path: string }[] | null)?.[0] ?? null, error };
  },
  async finish(id) {
    const { data, error } = await supabase.rpc('document_finish_upload', { p_id: id });
    if (error) { console.error('[documents.finish]', error.code); return 'error'; }
    return data as 'ready' | 'missing' | 'failed';
  },
  async reason(id) {
    const { data } = await supabase.from('project_documents').select('failure_reason').eq('id', id).maybeSingle();
    return (data as { failure_reason: string | null } | null)?.failure_reason ?? null;
  },
  async mark(id, state, reason) {
    if (state === 'pending') {
      await supabase.from('project_documents').update({ upload_state: 'pending' }).eq('id', id).eq('upload_state', 'failed');
    } else {
      await supabase.from('project_documents').update({ upload_state: 'failed', failure_reason: reason })
        .eq('id', id).eq('upload_state', 'pending');
    }
  },
};

export const OWNER_UPLOAD_TEXT: UploadText = {
  refusal: documentRefusal,
  failure: (reason) => t(FAILURE_LABEL[reason ?? ''] ?? FAILURE_LABEL.storage_refused),
  typeRefused: (v) => (v.code === 'extension'
    ? (v.ext ? t('.{ext} files are not accepted.', { ext: v.ext }) : t('Files without an extension are not accepted.'))
    : t('This file\'s content does not match .{ext}, so it was not uploaded.', { ext: v.ext })),
  unconfirmed: 'The file was sent, but it could not be confirmed. Retry to check again.',
  unexpected: 'The upload stopped unexpectedly. Retry it.',
};

/**
 * The upload queue for one project. Every file is its own item with its own
 * progress and its own error; a failure in one never stops the others.
 */
export function useUploader(projectId: string, onChanged: () => void, api: UploadApi = OWNER_UPLOAD_API,
  text: UploadText = OWNER_UPLOAD_TEXT) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const itemsRef = useRef<UploadItem[]>([]);
  const running = useRef(new Map<string, AbortController>());
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  const patch = useCallback((key: string, next: Partial<UploadItem>) => {
    itemsRef.current = itemsRef.current.map((i) => (i.key === key ? { ...i, ...next } : i));
    setItems(itemsRef.current);
  }, []);

  const runOne = useCallback(async (item: UploadItem) => {
    const ctrl = new AbortController();
    running.current.set(item.key, ctrl);
    let { docId, path } = item;
    try {
      if (item.file.size > MAX_DOCUMENT_BYTES) {
        patch(item.key, { phase: 'failed', message: text.refusal({ message: 'document_too_large' }), retryable: false });
        return;
      }

      patch(item.key, { phase: 'starting', message: null, progress: 0 });
      if (!docId || !path) {
        // What the file IS, from its own first bytes — before any row exists.
        // A refused type costs one local read and no request.
        const name = cleanFileName(item.file.name);
        const verdict = checkUploadable(name, new Uint8Array(await item.file.slice(0, SNIFF_BYTES).arrayBuffer()));
        if (!verdict.ok) {
          patch(item.key, { phase: 'failed', message: text.typeRefused(verdict), retryable: false });
          return;
        }
        const { row, error } = await api.begin({
          projectId, folderId: item.folderId, name, size: item.file.size, type: item.file.type || null, kind: verdict.kind,
        });
        if (error || !row) {
          console.error('[documents.begin]', error?.code);
          patch(item.key, { phase: 'failed', message: text.refusal(error) });
          return;
        }
        docId = row.id; path = row.storage_path;
        patch(item.key, { docId, path, name: row.name });
        onChangedRef.current();
      } else {
        // A retry. The bytes may already be there — the last attempt may have
        // succeeded with only its answer lost — so ask before sending again.
        if ((await api.finish(docId)) === 'ready') {
          patch(item.key, { phase: 'done', progress: 1 });
          onChangedRef.current();
          return;
        }
        await api.mark(docId, 'pending');
      }

      let sent = false;
      let refused: number | null = null;
      for (let attempt = 0; attempt <= AUTO_RETRIES && !sent; attempt += 1) {
        if (attempt > 0) await wait(1000 * 3 ** (attempt - 1));
        const { data: signed, error: signError } = await supabase.storage.from(DOCUMENT_BUCKET)
          .createSignedUploadUrl(path);
        if (signError || !signed?.signedUrl) {
          console.error('[documents.sign]', signError?.name ?? 'none');
          continue;
        }
        patch(item.key, { phase: 'uploading', attempts: item.attempts + attempt + 1 });
        try {
          await putWithProgress(signed.signedUrl, item.file, (p) => patch(item.key, { progress: p }), ctrl.signal);
          sent = true;
        } catch (e) {
          if (e instanceof DOMException && e.name === 'AbortError') throw e;
          // 409: an object is already at this path — an earlier attempt landed.
          // The finish step decides whether it is the right one.
          if (e instanceof HttpError && e.status === 409) { sent = true; break; }
          if (e instanceof HttpError && e.status === 413) {
            await api.mark(docId, 'failed', 'too_large');
            patch(item.key, { phase: 'failed', message: text.refusal({ message: 'document_too_large' }), retryable: false });
            onChangedRef.current();
            return;
          }
          // Any other refusal — an expired or already-used link above all —
          // is answered with a FRESH link on the next attempt, never by
          // reusing the old one.
          if (e instanceof HttpError && e.status >= 400 && e.status < 500) refused = e.status;
          console.error('[documents.put]', e instanceof HttpError ? e.status : 'error');
        }
      }

      if (!sent && refused !== null) {
        await api.mark(docId, 'failed', 'storage_refused');
        patch(item.key, { phase: 'failed', message: text.failure('storage_refused') });
        onChangedRef.current();
        return;
      }

      patch(item.key, { phase: 'verifying', progress: 1 });
      const outcome = await api.finish(docId);
      if (outcome === 'ready') {
        patch(item.key, { phase: 'done', message: null });
      } else if (outcome === 'failed') {
        const reason = await api.reason(docId);
        // A failure that cannot be fixed by sending again (lost access, the
        // wrong size, too large) offers no Retry.
        patch(item.key, { phase: 'failed', message: text.failure(reason),
          retryable: !['access_revoked', 'too_large'].includes(reason ?? '') });
      } else {
        // Not there (the connection kept failing) or the finish call itself
        // failed. Record it; the row keeps its name for a retry, and a later
        // finish or `document_reconcile()` completes it if the bytes did land.
        await api.mark(docId, 'failed', 'network');
        patch(item.key, { phase: 'failed', message: outcome === 'error' ? t(text.unconfirmed) : text.failure('network') });
      }
      onChangedRef.current();
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        if (docId) {
          await api.mark(docId, 'failed', 'cancelled');
        }
        patch(item.key, { phase: 'failed', message: text.failure('cancelled') });
        onChangedRef.current();
        return;
      }
      console.error('[documents.upload]', e instanceof Error ? e.name : 'error');
      patch(item.key, { phase: 'failed', message: t(text.unexpected) });
    } finally {
      running.current.delete(item.key);
      pump();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, patch, api, text]);

  const pump = useCallback(() => {
    const active = itemsRef.current.filter((i) => ['starting', 'uploading', 'verifying'].includes(i.phase)).length;
    const next = itemsRef.current.filter((i) => i.phase === 'queued').slice(0, Math.max(0, PARALLEL - active));
    for (const item of next) {
      patch(item.key, { phase: 'starting' });
      void runOne({ ...item, phase: 'starting' });
    }
  }, [patch, runOne]);

  const add = useCallback((files: FileList | File[], folderId: string | null) => {
    const added = Array.from(files).map((file, i): UploadItem => ({
      key: `${Date.now()}-${i}-${file.name}`, file, folderId, phase: 'queued', progress: 0,
      message: null, docId: null, path: null, name: cleanFileName(file.name), attempts: 0, retryable: true,
    }));
    itemsRef.current = [...itemsRef.current, ...added];
    setItems(itemsRef.current);
    pump();
  }, [pump]);

  const retry = useCallback((key: string) => {
    patch(key, { phase: 'queued', message: null, progress: 0, retryable: true });
    pump();
  }, [patch, pump]);

  const cancel = useCallback((key: string) => running.current.get(key)?.abort(), []);
  const clearFinished = useCallback(() => {
    itemsRef.current = itemsRef.current.filter((i) => i.phase !== 'done');
    setItems(itemsRef.current);
  }, []);

  // Leaving the screen stops what is in flight; each such row is then a
  // `pending` upload that `document_reconcile()` finishes or expires.
  useEffect(() => () => { for (const c of running.current.values()) c.abort(); }, []);

  const active = useMemo(() => items.some((i) => !['done', 'failed'].includes(i.phase)), [items]);

  // Closing or reloading the tab mid-upload asks first.
  useEffect(() => {
    if (!active) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [active]);
  return { items, add, retry, cancel, clearFinished, active };
}

/* ======================================================= housekeeping == */

export interface StorageReportRow {
  kind: 'orphan_object' | 'missing_object' | 'changed_object' | 'unfinished_object' | 'trashed_object';
  storage_path: string;
  byte_size: number | null;
  document_id: string | null;
  document_name: string | null;
}

/** Reconcile unfinished uploads, then report what storage holds that the library does not account for. */
export async function checkStorage(): Promise<
  { finished: number; expired: number; report: StorageReportRow[] } | { error: string }
> {
  const rec = await supabase.rpc('document_reconcile');
  if (rec.error) { console.error('[documents.reconcile]', rec.error.code); return { error: documentRefusal(rec.error) }; }
  const rep = await supabase.rpc('document_storage_report');
  if (rep.error) { console.error('[documents.report]', rep.error.code); return { error: documentRefusal(rep.error) }; }
  const r = ((rec.data ?? []) as { finished: number; expired: number }[])[0] ?? { finished: 0, expired: 0 };
  return { finished: r.finished, expired: r.expired, report: (rep.data ?? []) as StorageReportRow[] };
}

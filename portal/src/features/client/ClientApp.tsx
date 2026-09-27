import { useMemo, useRef, useState, type DragEvent } from 'react';
import { Link, Navigate, NavLink, useLocation, useSearchParams } from 'react-router-dom';
import { ArrowUpFromLine, Download, LogOut, X } from 'lucide-react';
import { useAuth } from '@/features/auth/AuthProvider';
import { Badge, Button, DataState, ErrorState, Panel, SectionHeader, Select, Skeleton, cn } from '@/components/ui';
import { MAX_DOCUMENT_BYTES, formatBytes } from '@/lib/documentRules';
import { useUploader, type UploadItem } from '@/lib/documents';
import {
  CLIENT_ALLOWED_SUMMARY, CLIENT_UPLOAD_API, CLIENT_UPLOAD_TEXT, UPLOAD_STATE_HU, downloadShared, failureHu,
  useClientMe, useClientProjects, useClientUploads, useSharedDocuments, type ClientProject,
} from '@/lib/clientPortal';

/**
 * THE CLIENT PORTAL — what a client account sees, in Hungarian.
 *
 * Three pages and nothing else: Projektjeim, Megosztott dokumentumok,
 * Nyersanyag leadása. The staff screens are never rendered for a client (the
 * layout renders this instead of them), and none of their data could be read
 * anyway: every read here is a `client_portal_*` function with fixed columns.
 */

const TOUCH = 'max-sm:min-h-10 max-sm:min-w-10';
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('hu-HU', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

export function ClientApp() {
  const { signOut } = useAuth();
  const { pathname } = useLocation();
  const me = useClientMe();

  if (!['/', '/megosztott', '/nyersanyag'].includes(pathname)) return <Navigate to="/" replace />;

  const page = pathname === '/megosztott' ? <SharedPage /> : pathname === '/nyersanyag' ? <RawMaterialPage /> : <ProjectsPage />;
  const tabs: [string, string][] = [['/', 'Projektjeim'], ['/megosztott', 'Megosztott dokumentumok'], ['/nyersanyag', 'Nyersanyag leadása']];

  return (
    <div className="min-h-dvh" lang="hu">
      <header className="border-b border-hairline bg-deck">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="font-mark text-[15px] leading-none tracking-[0.26em] text-paper">STRATOS</p>
            <p className="t-note mt-1 truncate">{me.rows[0] ? `${me.rows[0].full_name} · ${me.rows[0].company}` : 'Ügyfélportál'}</p>
          </div>
          <Button size="sm" variant="quiet" className={TOUCH} onClick={() => void signOut()}>
            <LogOut size={11} aria-hidden="true" /> Kijelentkezés
          </Button>
        </div>
        <nav aria-label="Ügyfélportál" className="mx-auto flex max-w-4xl flex-wrap gap-1 px-4 pb-2">
          {tabs.map(([to, label]) => (
            <NavLink key={to} to={to} end
              className={({ isActive }) => cn('rounded-sm px-3 py-2 text-[13px] max-sm:min-h-10',
                isActive ? 'bg-flare text-paper' : 'text-haze hover:bg-flare hover:text-paper')}>
              {label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="mx-auto grid max-w-4xl gap-4 px-4 py-6">{page}</main>
    </div>
  );
}

function Loading() {
  return <div className="space-y-2 p-4" aria-busy="true">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-8 w-full" />)}</div>;
}

/* ============================================================ projects == */

function ProjectsPage() {
  const projects = useClientProjects();
  return (
    <Panel>
      <SectionHeader title="Projektjeim" />
      {projects.state === 'loading' && <Loading />}
      {projects.state === 'error' && <ErrorState message="A projektek nem tölthetők be." onRetry={projects.reload} />}
      {projects.state === 'ready' && projects.rows.length === 0 && (
        <DataState kind="empty" title="Nincs projekt" body="Jelenleg egy projekthez sincs hozzáférésed. Ha ez hiba, szólj a Stratosnak." />
      )}
      {projects.state === 'ready' && projects.rows.length > 0 && (
        <ul className="grid">
          {projects.rows.map((p) => (
            <li key={p.project_id} className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline px-4 py-3 last:border-0">
              <p className="text-[14px] text-paper">{p.project_name}</p>
              <div className="flex flex-wrap gap-2">
                <Link to={`/megosztott?projekt=${p.project_id}`} className="t-note underline underline-offset-4 hover:text-paper max-sm:py-2">Dokumentumok</Link>
                <Link to={`/nyersanyag?projekt=${p.project_id}`} className="t-note underline underline-offset-4 hover:text-paper max-sm:py-2">Nyersanyag leadása</Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/* ====================================================== shared files == */

function SharedPage() {
  const docs = useSharedDocuments();
  const [params] = useSearchParams();
  const only = params.get('projekt');
  const [error, setError] = useState<string | null>(null);
  const shown = only ? docs.rows.filter((d) => d.project_id === only) : docs.rows;
  const groups = useMemo(() => {
    const out = new Map<string, typeof shown>();
    for (const d of shown) out.set(d.project_name, [...(out.get(d.project_name) ?? []), d]);
    return [...out.entries()];
  }, [shown]);

  return (
    <Panel>
      <SectionHeader title="Megosztott dokumentumok" note={only ? 'egy projekt' : undefined}
        action={only ? <Link to="/megosztott" className="t-note underline underline-offset-4 hover:text-paper">Összes</Link> : undefined} />
      <p className="t-note border-b border-hairline px-4 py-2">
        Csak a veled megosztott fájlok látszanak. A letöltési link egy percig érvényes; a letöltött másolat a te gépeden marad.
      </p>
      {error && <p role="alert" className="border-b border-hairline px-4 py-2 text-xs text-danger">{error}</p>}
      {docs.state === 'loading' && <Loading />}
      {docs.state === 'error' && <ErrorState message="A dokumentumok nem tölthetők be." onRetry={docs.reload} />}
      {docs.state === 'ready' && shown.length === 0 && (
        <DataState kind="empty" title="Nincs megosztott dokumentum" body="Ha a Stratos megoszt veled egy fájlt vagy mappát, itt jelenik meg." />
      )}
      {groups.map(([project, rows]) => (
        <section key={project} aria-label={project}>
          <h3 className="t-section border-b border-hairline px-4 py-2 text-chrome">{project}</h3>
          <ul className="grid">
            {rows.map((d) => (
              <li key={d.document_id} className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline px-4 py-2 last:border-0" data-shared={d.document_id}>
                <div className="min-w-0">
                  <p className="break-all text-[13px] text-paper">{d.name}</p>
                  <p className="t-note">{formatBytes(d.byte_size)} · {when(d.shared_at)}{d.via_folder ? ` · a(z) „${d.via_folder}” mappán keresztül` : ''}</p>
                </div>
                <Button size="sm" className={TOUCH} aria-label={`${d.name} letöltése`} onClick={async () => setError(await downloadShared(d))}>
                  <Download size={11} aria-hidden="true" /> Letöltés
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </Panel>
  );
}

/* ======================================================= raw material == */

function RawMaterialPage() {
  const projects = useClientProjects();
  const [params, setParams] = useSearchParams();
  const wanted = params.get('projekt');
  const only = projects.rows.length === 1 ? projects.rows[0] : null;
  const chosen: ClientProject | null = only ?? projects.rows.find((p) => p.project_id === wanted) ?? null;
  const [tick, setTick] = useState(0);

  return (
    <div className="grid gap-4">
      <Panel>
        <SectionHeader title="Nyersanyag leadása" />
        <div className="grid gap-2 px-4 py-3 text-[13px] text-haze">
          <p>
            Itt adhatod le a projekthez szükséges anyagokat: logót, képeket, szövegeket és más fájlokat. A leadott fájlt nem
            lehet törölni, áthelyezni vagy felülírni — ha változott, töltsd fel az új változatot új fájlként.
          </p>
          <p className="t-note">
            Fájlonként legfeljebb {formatBytes(MAX_DOCUMENT_BYTES)}. Elfogadott: {CLIENT_ALLOWED_SUMMARY}. A fájlokat a tartalmuk
            alapján ellenőrizzük; vírusellenőrzés nincs.
          </p>
        </div>
        {projects.state === 'loading' && <Loading />}
        {projects.state === 'ready' && projects.rows.length === 0 && (
          <DataState kind="empty" title="Nincs projekt" body="Jelenleg egy projekthez sincs hozzáférésed, ezért most nem tudsz fájlt leadni." />
        )}
        {projects.state === 'ready' && projects.rows.length > 1 && (
          <div className="flex flex-wrap items-center gap-2 border-t border-hairline px-4 py-3">
            <label htmlFor="raw-project" className="label">Projekt</label>
            <Select id="raw-project" value={chosen?.project_id ?? ''} className="max-sm:min-h-10"
                    onChange={(e) => setParams(e.target.value ? { projekt: e.target.value } : {}, { replace: true })}>
              <option value="">Válassz projektet…</option>
              {projects.rows.map((p) => <option key={p.project_id} value={p.project_id}>{p.project_name}</option>)}
            </Select>
          </div>
        )}
        {chosen && <Uploader key={chosen.project_id} project={chosen} onChanged={() => setTick((n) => n + 1)} />}
      </Panel>
      <MyUploads projectId={chosen?.project_id ?? null} reloadToken={tick} />
    </div>
  );
}

function Uploader({ project, onChanged }: { project: ClientProject; onChanged: () => void }) {
  const uploads = useUploader(project.project_id, onChanged, CLIENT_UPLOAD_API, CLIENT_UPLOAD_TEXT);
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const onDrop = (e: DragEvent) => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files.length) uploads.add(e.dataTransfer.files, null); };

  return (
    <div
      className={cn('border-t border-hairline px-4 py-4', dragging && 'bg-flare')}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      aria-label={`Feltöltés: ${project.project_name}`}
    >
      <p className="text-[13px] text-paper">Ide kerül: <strong>{project.project_name}</strong></p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <input ref={input} type="file" multiple className="sr-only" tabIndex={-1} aria-label="Fájlok kiválasztása"
               onChange={(e) => { if (e.target.files?.length) uploads.add(e.target.files, null); e.target.value = ''; }} />
        <Button variant="primary" className={TOUCH} onClick={() => input.current?.click()}>
          <ArrowUpFromLine size={12} aria-hidden="true" /> Fájlok kiválasztása
        </Button>
        <span className="t-note">vagy húzd ide a fájlokat</span>
      </div>
      {uploads.items.length > 0 && <HuQueue items={uploads.items} onRetry={uploads.retry} onCancel={uploads.cancel} />}
    </div>
  );
}

const PHASE_HU: Record<UploadItem['phase'], string> = {
  queued: 'Várakozik', starting: 'Indul', uploading: 'Feltöltés', verifying: 'Ellenőrzés', done: 'Leadva', failed: 'Sikertelen',
};

function HuQueue({ items, onRetry, onCancel }: { items: UploadItem[]; onRetry: (k: string) => void; onCancel: (k: string) => void }) {
  return (
    <ul className="mt-4 grid gap-2" aria-label="Feltöltések" aria-live="polite">
      {items.map((i) => (
        <li key={i.key} className="grid gap-1" data-upload-phase={i.phase}>
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 break-all text-[13px] text-paper">{i.name}</span>
            <span className="flex shrink-0 items-center gap-1">
              <span className={cn('t-note', i.phase === 'failed' && 'text-danger', i.phase === 'done' && 'text-paper')}>
                {PHASE_HU[i.phase]}{i.phase === 'uploading' ? ` ${Math.round(i.progress * 100)}%` : ''}
              </span>
              {i.phase === 'failed' && i.retryable && (
                <Button size="sm" variant="quiet" className={TOUCH} onClick={() => onRetry(i.key)}>Újra</Button>
              )}
              {(i.phase === 'uploading' || i.phase === 'starting') && (
                <Button size="sm" variant="quiet" className={TOUCH} aria-label={`${i.name} megszakítása`} onClick={() => onCancel(i.key)}>
                  <X size={11} aria-hidden="true" />
                </Button>
              )}
            </span>
          </div>
          <div className="h-0.5 w-full overflow-hidden rounded-full bg-white/[0.06]" role="progressbar" aria-label={`${i.name} feltöltése`}
               aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((i.phase === 'done' ? 1 : i.progress) * 100)}>
            <div className={cn('h-full', i.phase === 'failed' ? 'bg-danger' : 'bg-signal')}
                 style={{ width: `${Math.round((i.phase === 'done' ? 1 : i.progress) * 100)}%` }} />
          </div>
          {i.message && <p role="alert" className="text-[12px] text-danger">{i.message}</p>}
        </li>
      ))}
    </ul>
  );
}

function MyUploads({ projectId, reloadToken }: { projectId: string | null; reloadToken: number }) {
  const uploads = useClientUploads(reloadToken);
  const rows = projectId ? uploads.rows.filter((u) => u.project_id === projectId) : uploads.rows;
  return (
    <Panel>
      <SectionHeader title="Korábbi leadásaim" note={uploads.state === 'ready' ? `${rows.length}` : undefined}
        action={<Button size="sm" variant="quiet" className={TOUCH} onClick={() => void uploads.reload()}>Frissítés</Button>} />
      {uploads.state === 'loading' && <Loading />}
      {uploads.state === 'ready' && rows.length === 0 && <p className="px-4 py-4 text-xs text-haze">Még nem adtál le fájlt.</p>}
      {rows.length > 0 && (
        <ul className="grid" aria-label="Leadott fájlok">
          {rows.map((u) => (
            <li key={u.document_id} className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline px-4 py-2 last:border-0">
              <div className="min-w-0">
                <p className="break-all text-[13px] text-paper">{u.name}</p>
                <p className="t-note">{u.project_name} · {formatBytes(u.byte_size)} · {when(u.uploaded_at)}</p>
                {u.state === 'failed' && <p className="text-[12px] text-danger">{failureHu(u.failure_reason)} Töltsd fel újra a fájlt.</p>}
              </div>
              <Badge tone={u.state === 'ready' ? 'good' : u.state === 'failed' ? 'bad' : 'warn'}>{UPLOAD_STATE_HU[u.state]}</Badge>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

import { useMemo, useRef, useState, type DragEvent } from 'react';
import { Link, Navigate, NavLink, useLocation, useSearchParams } from 'react-router-dom';
import { ArrowUpFromLine, CalendarPlus, Download, ExternalLink, Eye, LogOut, MapPin, Video, X } from 'lucide-react';
import { useAuth } from '@/features/auth/AuthProvider';
import { Badge, Button, DataState, ErrorState, Panel, SectionHeader, Select, Skeleton, cn } from '@/components/ui';
import { MAX_DOCUMENT_BYTES, formatBytes, mayPreview } from '@/lib/documentRules';
import { FileViewerDialog } from '@/features/documents/FileViewer';
import { useUploader, type UploadItem } from '@/lib/documents';
import {
  CLIENT_ALLOWED_SUMMARY, CLIENT_UPLOAD_API, CLIENT_UPLOAD_TEXT, UPLOAD_STATE_HU, downloadShared, failureHu,
  useClientMe, useClientProjects, useClientUploads, useSharedDocuments, type ClientProject, type SharedDocument,
} from '@/lib/clientPortal';
import {
  requestMeetingChange, sendDemoFeedback, useClientDemos, useClientFeedback, useClientHelp, useClientMeetingRequests, useClientMeetings,
  withdrawMeetingRequest, type ClientDemo, type ClientFeedback, type ClientMeeting, type ClientMeetingRequest,
} from '@/lib/clientView';
import {
  answerSurvey, completeRequest, decideDemo, sendMessage, surveyGoogleClicked, useClientApprovals, useClientMessages,
  useClientRequestsMine, useClientSurveys, type ClientApproval, type ClientMessage, type ClientRequestRow, type ClientSurvey,
} from '@/lib/clientExperience';
import { formatMeetingTime, googleCalendarUrl, nextMeeting, safeHttpsUrl, wallClock, zonedToUtc } from '@/lib/meetings';
import { HelpChat } from '@/features/client/HelpChat';
import { ThemeSwitch } from '@/components/ThemeSwitch';
import { LanguageSwitch } from '@/features/i18n/LanguageGate';
import { getLang, intlLocale, t } from '@/lib/i18n';

/**
 * THE CLIENT PORTAL — what a client account sees, in Hungarian.
 *
 * Four pages and nothing else: Projektjeim (with the project's published demos
 * and upcoming meetings), Megosztott dokumentumok, Nyersanyag leadása and
 * Segítség (the help assistant). The staff screens are never rendered for a client (the
 * layout renders this instead of them), and none of their data could be read
 * anyway: every read here is a `client_portal_*` function with fixed columns.
 */

const TOUCH = 'max-sm:min-h-10 max-sm:min-w-10';
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(intlLocale('hu-HU'), { dateStyle: 'medium', timeStyle: 'short' }) : '—');

export function ClientApp() {
  const { signOut } = useAuth();
  const { pathname } = useLocation();
  const me = useClientMe();

  if (!['/', '/megosztott', '/nyersanyag', '/segitseg'].includes(pathname)) return <Navigate to="/" replace />;

  const page = pathname === '/megosztott' ? <SharedPage /> : pathname === '/nyersanyag' ? <RawMaterialPage />
    : pathname === '/segitseg' ? <HelpPage /> : <ProjectsPage />;
  const tabs: [string, string][] = [['/', t('Projektjeim')], ['/megosztott', t('Megosztott dokumentumok')], ['/nyersanyag', t('Nyersanyag leadása')], ['/segitseg', t('Segítség')]];

  return (
    <div className="min-h-dvh" lang={getLang() ?? 'hu'}>
      <header className="border-b border-hairline bg-deck">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="font-mark text-[15px] leading-none tracking-[0.26em] text-paper">STRATOS</p>
            <p className="t-note mt-1 truncate">{me.rows[0] ? `${me.rows[0].full_name} · ${me.rows[0].company}` : t('Ügyfélportál')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ThemeSwitch lang="hu" />
            <LanguageSwitch fallback="hu" />
            <Button size="sm" variant="quiet" className={TOUCH} onClick={() => void signOut()}>
              <LogOut size={11} aria-hidden="true" /> {t('Kijelentkezés')}
            </Button>
          </div>
        </div>
        <nav aria-label={t('Ügyfélportál')} className="mx-auto flex max-w-4xl flex-wrap gap-1 px-4 pb-2">
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
  const [tick, setTick] = useState(0);
  const refresh = () => setTick((n) => n + 1);
  const demos = useClientDemos(tick);
  const meetings = useClientMeetings(tick);
  const feedback = useClientFeedback(tick);
  const requests = useClientMeetingRequests(tick);
  const approvals = useClientApprovals(tick);
  const asks = useClientRequestsMine(tick);
  const messages = useClientMessages(tick);
  const surveys = useClientSurveys(tick);
  const names = new Map(projects.rows.map((p) => [p.project_id, p.project_name]));
  return (
    <>
      {projects.state === 'ready' && projects.rows.length > 0 && (
        <WaitingForYou names={names} demos={demos.rows} approvals={approvals.rows} requests={asks.rows} surveys={surveys.rows}
          ready={approvals.state === 'ready' && asks.state === 'ready' && surveys.state === 'ready'} onChanged={refresh} />
      )}
      <Panel>
        <SectionHeader title={t('Projektjeim')} />
        {projects.state === 'loading' && <Loading />}
        {projects.state === 'error' && <ErrorState message={t('A projektek nem tölthetők be.')} onRetry={projects.reload} />}
        {projects.state === 'ready' && projects.rows.length === 0 && (
          <DataState kind="empty" title={t('Nincs projekt')} body={t('Jelenleg egy projekthez sincs hozzáférésed. Ha ez hiba, szólj a Stratosnak.')} />
        )}
        {projects.state === 'ready' && projects.rows.length > 0 && (
          <ul className="grid">
            {projects.rows.map((p) => (
              <li key={p.project_id} className="grid gap-3 border-b border-hairline px-4 py-4 last:border-0" data-project={p.project_id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-[15px] text-paper">{p.project_name}</h3>
                  <div className="flex flex-wrap gap-2">
                    <Link to={`/megosztott?projekt=${p.project_id}`} className="t-note underline underline-offset-4 hover:text-paper max-sm:py-2">{t('Dokumentumok')}</Link>
                    <Link to={`/nyersanyag?projekt=${p.project_id}`} className="t-note underline underline-offset-4 hover:text-paper max-sm:py-2">{t('Nyersanyag leadása')}</Link>
                  </div>
                </div>
                <ProjectMeetings rows={meetings.rows.filter((m) => m.project_id === p.project_id)} state={meetings.state}
                  requests={requests.rows} onChanged={refresh} />
                <ProjectDemos rows={demos.rows.filter((d) => d.project_id === p.project_id)} state={demos.state}
                  feedback={feedback.rows} approvals={approvals.rows} onChanged={refresh} />
                <ProjectMessages projectId={p.project_id} rows={messages.rows.filter((m) => m.project_id === p.project_id)}
                  state={messages.state} onChanged={refresh} />
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}

function ProjectDemos({ rows, state, feedback, approvals, onChanged }: {
  rows: ClientDemo[]; state: string; feedback: ClientFeedback[]; approvals: ClientApproval[]; onChanged: () => void;
}) {
  if (state === 'error') return <p className="t-note">{t('A demók most nem tölthetők be.')}</p>;
  if (rows.length === 0) return null;
  return (
    <section aria-label={t('Demók')} className="grid gap-2">
      {rows.map((d) => (
        <article key={d.demo_id} className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-signal/40 bg-deck px-4 py-3" data-client-demo={d.demo_id}>
          <div className="min-w-0">
            <p className="t-section text-signal">{t('Demó')}</p>
            <p className="text-[15px] text-paper">{d.title}</p>
            {d.note && <p className="t-note mt-0.5">{d.note}</p>}
            <ApprovalBadge approval={approvals.find((a) => a.demo_id === d.demo_id)} />
          </div>
          <a href={safeHttpsUrl(d.url)} target="_blank" rel="noopener noreferrer"
             className={cn('inline-flex items-center gap-1.5 rounded-sm bg-signal px-3 py-2 text-[13px] font-medium text-black hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal', TOUCH)}>
            {t('Demó megtekintése')} <ExternalLink size={12} aria-hidden="true" /><span className="sr-only"> {t('(új lapon nyílik)')}</span>
          </a>
          <DemoFeedback demo={d} mine={feedback.filter((f) => f.demo_id === d.demo_id)} onChanged={onChanged} />
        </article>
      ))}
    </section>
  );
}

function ProjectMeetings({ rows, state, requests, onChanged }: { rows: ClientMeeting[]; state: string; requests: ClientMeetingRequest[]; onChanged: () => void }) {
  if (state === 'error') return <p className="t-note">{t('A megbeszélések most nem tölthetők be.')}</p>;
  if (rows.length === 0) return null;
  const next = nextMeeting(rows);
  const rest = rows.filter((m) => m.meeting_id !== next?.meeting.meeting_id);
  return (
    <section aria-label={t('Megbeszélések')} className="grid gap-2">
      {next && <MeetingCard m={next.meeting} highlight inProgress={next.inProgress} requests={requests} onChanged={onChanged} />}
      {rest.length > 0 && (
        <ul className="grid gap-1.5" aria-label={t('További időpontok')}>
          {rest.map((m) => <li key={m.meeting_id}><MeetingCard m={m} requests={requests} onChanged={onChanged} /></li>)}
        </ul>
      )}
      <p className="t-note">{t('A portálon módosított időpont nem frissíti automatikusan a naptáradba korábban elmentett példányt — módosítás után mentsd el újra.')}</p>
    </section>
  );
}

function MeetingCard({ m, highlight = false, inProgress = false, requests, onChanged }: {
  m: ClientMeeting; highlight?: boolean; inProgress?: boolean; requests: ClientMeetingRequest[]; onChanged: () => void;
}) {
  return (
    <article className={cn('grid gap-1 rounded-sm border px-4 py-3', highlight ? 'border-paper/40 bg-deck' : 'border-hairline', m.cancelled && 'opacity-70')}
             data-client-meeting={m.meeting_id} data-highlight={highlight || undefined}>
      <p className="t-section text-chrome">
        {m.cancelled ? <Badge tone="bad">{t('Lemondva')}</Badge> : highlight ? (inProgress ? t('Most zajlik') : t('Következő megbeszélés')) : t('Későbbi időpont')}
      </p>
      <p className={cn('text-[14px] text-paper', m.cancelled && 'line-through')}>{m.title}</p>
      <p className="text-[13px] text-haze">{formatMeetingTime(m)}</p>
      {m.location && <p className="t-note inline-flex items-center gap-1"><MapPin size={11} aria-hidden="true" /> {m.location}</p>}
      {m.note && <p className="t-note">{m.note}</p>}
      {!m.cancelled && (
        <div className="mt-1 flex flex-wrap gap-2">
          {m.join_url && (
            <a href={safeHttpsUrl(m.join_url)} target="_blank" rel="noopener noreferrer" className={cn('inline-flex items-center gap-1 rounded-sm border border-hairline px-2.5 py-1.5 text-[12px] text-paper hover:bg-flare', TOUCH)}>
              <Video size={11} aria-hidden="true" /> {t('Csatlakozás')}<span className="sr-only"> {t('(új lapon nyílik)')}</span>
            </a>
          )}
          <a href={googleCalendarUrl({ ...m, project_name: m.project_name })} target="_blank" rel="noopener noreferrer"
             className={cn('inline-flex items-center gap-1 rounded-sm border border-hairline px-2.5 py-1.5 text-[12px] text-paper hover:bg-flare', TOUCH)}>
            <CalendarPlus size={11} aria-hidden="true" /> {t('Google Naptárba helyezés')}<span className="sr-only"> {t('(új lapon nyílik)')}</span>
          </a>
        </div>
      )}
      <Reschedule m={m} mine={requests.filter((r) => r.meeting_id === m.meeting_id)} onChanged={onChanged} />
    </article>
  );
}

/* ============================================================== help == */

function HelpPage() {
  const help = useClientHelp();
  return (
    <Panel>
      <SectionHeader title={t('Segítség')} />
      <div className="px-4 py-4">
        {help.state === 'loading' && <Loading />}
        {help.state === 'error' && <ErrorState message={t('A súgó most nem tölthető be.')} onRetry={help.reload} />}
        {help.state === 'ready' && help.rows.length === 0 && <DataState kind="empty" title={t('Nincs még súgócikk')} body={t('Keresd a Stratos kapcsolattartódat.')} />}
        {help.state === 'ready' && help.rows.length > 0 && <HelpChat articles={help.rows} />}
      </div>
    </Panel>
  );
}

/* ====================================================== shared files == */

function SharedPage() {
  const docs = useSharedDocuments();
  const [params] = useSearchParams();
  const only = params.get('projekt');
  const [error, setError] = useState<string | null>(null);
  // A shared PDF, Word, Excel, image or text file opens here, without downloading.
  const [opening, setOpening] = useState<SharedDocument | null>(null);
  const shown = only ? docs.rows.filter((d) => d.project_id === only) : docs.rows;
  const groups = useMemo(() => {
    const out = new Map<string, typeof shown>();
    for (const d of shown) out.set(d.project_name, [...(out.get(d.project_name) ?? []), d]);
    return [...out.entries()];
  }, [shown]);

  return (
    <Panel>
      <SectionHeader title={t('Megosztott dokumentumok')} note={only ? t('egy projekt') : undefined}
        action={only ? <Link to="/megosztott" className="t-note underline underline-offset-4 hover:text-paper">{t('Összes')}</Link> : undefined} />
      <p className="t-note border-b border-hairline px-4 py-2">
        {t('Csak a veled megosztott fájlok látszanak. A letöltési link egy percig érvényes; a letöltött másolat a te gépeden marad.')}
      </p>
      {error && <p role="alert" className="border-b border-hairline px-4 py-2 text-xs text-danger">{error}</p>}
      {docs.state === 'loading' && <Loading />}
      {docs.state === 'error' && <ErrorState message={t('A dokumentumok nem tölthetők be.')} onRetry={docs.reload} />}
      {docs.state === 'ready' && shown.length === 0 && (
        <DataState kind="empty" title={t('Nincs megosztott dokumentum')} body={t('Ha a Stratos megoszt veled egy fájlt vagy mappát, itt jelenik meg.')} />
      )}
      {groups.map(([project, rows]) => (
        <section key={project} aria-label={project}>
          <h3 className="t-section border-b border-hairline px-4 py-2 text-chrome">{project}</h3>
          <ul className="grid">
            {rows.map((d) => (
              <li key={d.document_id} className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline px-4 py-2 last:border-0" data-shared={d.document_id}>
                <div className="min-w-0">
                  <p className="break-all text-[13px] text-paper">{d.name}</p>
                  <p className="t-note">{formatBytes(d.byte_size)} · {when(d.shared_at)}{d.via_folder ? ` · ${t('a(z) „{folder}” mappán keresztül', { folder: d.via_folder })}` : ''}</p>
                </div>
                <span className="flex flex-wrap gap-1">
                  {mayPreview({ name: d.name, byte_size: d.byte_size }) && (
                    <Button size="sm" className={TOUCH} aria-label={t('{name} megnyitása', { name: d.name })} onClick={() => setOpening(d)}>
                      <Eye size={11} aria-hidden="true" /> {t('Megnyitás')}
                    </Button>
                  )}
                  <Button size="sm" className={TOUCH} aria-label={t('{name} letöltése', { name: d.name })} onClick={async () => setError(await downloadShared(d))}>
                    <Download size={11} aria-hidden="true" /> {t('Letöltés')}
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {opening && (
        <FileViewerDialog hungarian doc={{ storage_path: `${opening.project_id}/${opening.document_id}`, name: opening.name }}
                          onClose={() => setOpening(null)} onDownload={async () => setError(await downloadShared(opening))} />
      )}
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
        <SectionHeader title={t('Nyersanyag leadása')} />
        <div className="grid gap-2 px-4 py-3 text-[13px] text-haze">
          <p>
            {t('Itt adhatod le a projekthez szükséges anyagokat: logót, képeket, szövegeket és más fájlokat. A leadott fájlt nem lehet törölni, áthelyezni vagy felülírni — ha változott, töltsd fel az új változatot új fájlként.')}
          </p>
          <p className="t-note">
            {t('Fájlonként legfeljebb {max}. Elfogadott: {types}. A fájlokat a tartalmuk alapján ellenőrizzük; vírusellenőrzés nincs.',
              { max: formatBytes(MAX_DOCUMENT_BYTES), types: t(CLIENT_ALLOWED_SUMMARY) })}
          </p>
        </div>
        {projects.state === 'loading' && <Loading />}
        {projects.state === 'ready' && projects.rows.length === 0 && (
          <DataState kind="empty" title={t('Nincs projekt')} body={t('Jelenleg egy projekthez sincs hozzáférésed, ezért most nem tudsz fájlt leadni.')} />
        )}
        {projects.state === 'ready' && projects.rows.length > 1 && (
          <div className="flex flex-wrap items-center gap-2 border-t border-hairline px-4 py-3">
            <label htmlFor="raw-project" className="label">{t('Projekt')}</label>
            <Select id="raw-project" value={chosen?.project_id ?? ''} className="max-sm:min-h-10"
                    onChange={(e) => setParams(e.target.value ? { projekt: e.target.value } : {}, { replace: true })}>
              <option value="">{t('Válassz projektet…')}</option>
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
      aria-label={t('Feltöltés: {project}', { project: project.project_name })}
    >
      <p className="text-[13px] text-paper">{t('Ide kerül:')} <strong>{project.project_name}</strong></p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <input ref={input} type="file" multiple className="sr-only" tabIndex={-1} aria-label={t('Fájlok kiválasztása')}
               onChange={(e) => { if (e.target.files?.length) uploads.add(e.target.files, null); e.target.value = ''; }} />
        <Button variant="primary" className={TOUCH} onClick={() => input.current?.click()}>
          <ArrowUpFromLine size={12} aria-hidden="true" /> {t('Fájlok kiválasztása')}
        </Button>
        <span className="t-note">{t('vagy húzd ide a fájlokat')}</span>
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
    <ul className="mt-4 grid gap-2" aria-label={t('Feltöltések')} aria-live="polite">
      {items.map((i) => (
        <li key={i.key} className="grid gap-1" data-upload-phase={i.phase}>
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 break-all text-[13px] text-paper">{i.name}</span>
            <span className="flex shrink-0 items-center gap-1">
              <span className={cn('t-note', i.phase === 'failed' && 'text-danger', i.phase === 'done' && 'text-paper')}>
                {t(PHASE_HU[i.phase])}{i.phase === 'uploading' ? ` ${Math.round(i.progress * 100)}%` : ''}
              </span>
              {i.phase === 'failed' && i.retryable && (
                <Button size="sm" variant="quiet" className={TOUCH} onClick={() => onRetry(i.key)}>{t('Újra')}</Button>
              )}
              {(i.phase === 'uploading' || i.phase === 'starting') && (
                <Button size="sm" variant="quiet" className={TOUCH} aria-label={t('{name} megszakítása', { name: i.name })} onClick={() => onCancel(i.key)}>
                  <X size={11} aria-hidden="true" />
                </Button>
              )}
            </span>
          </div>
          <div className="h-0.5 w-full overflow-hidden rounded-full bg-flare" role="progressbar" aria-label={t('{name} feltöltése', { name: i.name })}
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
      <SectionHeader title={t('Korábbi leadásaim')} note={uploads.state === 'ready' ? `${rows.length}` : undefined}
        action={<Button size="sm" variant="quiet" className={TOUCH} onClick={() => void uploads.reload()}>{t('Frissítés')}</Button>} />
      {uploads.state === 'loading' && <Loading />}
      {uploads.state === 'ready' && rows.length === 0 && <p className="px-4 py-4 text-xs text-haze">{t('Még nem adtál le fájlt.')}</p>}
      {rows.length > 0 && (
        <ul className="grid" aria-label={t('Leadott fájlok')}>
          {rows.map((u) => (
            <li key={u.document_id} className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline px-4 py-2 last:border-0">
              <div className="min-w-0">
                <p className="break-all text-[13px] text-paper">{u.name}</p>
                <p className="t-note">{u.project_name} · {formatBytes(u.byte_size)} · {when(u.uploaded_at)}</p>
                {u.state === 'failed' && <p className="text-[12px] text-danger">{failureHu(u.failure_reason)} {t('Töltsd fel újra a fájlt.')}</p>}
              </div>
              <Badge tone={u.state === 'ready' ? 'good' : u.state === 'failed' ? 'bad' : 'warn'}>{t(UPLOAD_STATE_HU[u.state])}</Badge>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/* ============================================ demo feedback, reschedule == */

const hu = (iso: string) => new Date(iso).toLocaleString(intlLocale('hu-HU'), { dateStyle: 'medium', timeStyle: 'short' });

function DemoFeedback({ demo, mine, onChanged }: { demo: ClientDemo; mine: ClientFeedback[]; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const id = `fb-${demo.demo_id}`;
  const send = async () => {
    if (!text.trim()) return setError(t('Írj valamit az üzenetbe.'));
    setBusy(true);
    const problem = await sendDemoFeedback(demo.demo_id, text.trim());
    setBusy(false);
    setError(problem);
    if (!problem) { setText(''); setSent(true); onChanged(); }
  };
  return (
    <div className="w-full border-t border-hairline pt-2" data-demo-feedback={demo.demo_id}>
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}
              className={cn('text-[13px] text-chrome underline underline-offset-4 hover:text-paper focus-visible:outline-2 focus-visible:outline-signal', TOUCH)}>
        {t('Észrevételek')}{mine.length ? ` (${mine.length})` : ''}
      </button>
      {open && (
        <div id={id} className="mt-2 grid gap-2">
          {mine.length > 0 && (
            <ul className="grid gap-1" aria-label={t('Elküldött észrevételeid')}>
              {mine.map((f) => (
                <li key={f.feedback_id} className="rounded-sm border border-hairline px-3 py-2 text-[13px]">
                  <p className="whitespace-pre-line text-paper">{f.body}</p>
                  <p className="t-note mt-1">{hu(f.created_at)} · {f.seen ? t('A Stratos látta') : t('Még nem látta')}</p>
                  {f.reply && (
                    <div className="mt-2 border-l-2 border-signal/60 pl-2" data-feedback-reply>
                      <p className="t-section">{t('A Stratos válasza')}</p>
                      <p className="whitespace-pre-line text-paper">{f.reply}</p>
                      {f.replied_at && <p className="t-note">{hu(f.replied_at)}</p>}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          <label htmlFor={`${id}-text`} className="label">{t('Új észrevétel a demóról')}</label>
          <textarea id={`${id}-text`} value={text} maxLength={2000} rows={3} onChange={(e) => { setText(e.target.value); setSent(false); }}
                    className="w-full rounded-sm border border-hair bg-field px-3 py-2 text-sm text-paper focus-visible:outline-2 focus-visible:outline-signal" />
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="primary" className={TOUCH} onClick={send} disabled={busy || !text.trim()}>{t('Küldés')}</Button>
            <span className="t-note">{t('A Stratos a portálon látja; munkanapokon 1 munkanapon belül reagálunk.')}</span>
          </div>
          {sent && <p role="status" className="text-xs text-good">{t('Elküldve.')}</p>}
          {error && <p role="alert" className="text-xs text-danger">{error}</p>}
        </div>
      )}
    </div>
  );
}

const STATUS_HU: Record<ClientMeetingRequest['status'], string> = {
  pending: 'Függőben — a Stratos jóváhagyására vár', accepted: 'Elfogadva — a megbeszélés az új időpontra módosult',
  declined: 'Nem fogadtuk el', withdrawn: 'Visszavonva',
};

function Reschedule({ m, mine, onChanged }: { m: ClientMeeting; mine: ClientMeetingRequest[]; onChanged: () => void }) {
  const pending = mine.find((r) => r.status === 'pending');
  const last = [...mine].reverse().find((r) => r.status !== 'pending' && r.status !== 'withdrawn');
  const [open, setOpen] = useState(false);
  const start0 = wallClock(m.time_zone, new Date(m.starts_at));
  const end0 = wallClock(m.time_zone, new Date(m.ends_at));
  const [form, setForm] = useState({ date: start0.slice(0, 10), start: start0.slice(11, 16), end: end0.slice(11, 16), message: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = `rs-${m.meeting_id}`;
  if (m.cancelled && !pending) return null;

  const submit = async () => {
    const s = zonedToUtc(form.date, form.start, m.time_zone);
    const e = zonedToUtc(form.date, form.end, m.time_zone);
    if ('error' in s || 'error' in e) return setError(t('Adj meg létező dátumot és időpontot.'));
    let end = e.iso;
    if (new Date(end) <= new Date(s.iso)) end = new Date(new Date(end).getTime() + 24 * 3600e3).toISOString();
    if (new Date(s.iso) <= new Date()) return setError(t('A javasolt időpont már elmúlt.'));
    setBusy(true);
    const problem = await requestMeetingChange(m.meeting_id, s.iso, end, m.time_zone, form.message.trim() || null);
    setBusy(false);
    setError(problem);
    if (!problem) { setOpen(false); onChanged(); }
  };
  const withdraw = async () => { if (!pending) return; setBusy(true); setError(await withdrawMeetingRequest(pending.request_id)); setBusy(false); onChanged(); };

  return (
    <div className="mt-1 grid gap-2 border-t border-hairline pt-2" data-reschedule={m.meeting_id}>
      {pending && (
        <div className="grid gap-1 text-[13px]" data-request-status="pending">
          <p className="text-paper">{t('Javasolt új időpont: {time}', { time: formatMeetingTime({ starts_at: pending.proposed_starts_at, ends_at: pending.proposed_ends_at, time_zone: pending.time_zone }) })}</p>
          <p className="t-note">{t(STATUS_HU.pending)}</p>
          <div><Button size="sm" variant="quiet" className={TOUCH} onClick={withdraw} disabled={busy}>{t('Javaslat visszavonása')}</Button></div>
        </div>
      )}
      {!pending && last && (
        <p className="t-note" data-request-status={last.status}>
          {t('Legutóbbi javaslatod: {status}', { status: t(STATUS_HU[last.status]) })}{last.owner_note ? ` — „${last.owner_note}”` : ''}
        </p>
      )}
      {!pending && !m.cancelled && (
        <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}
                className={cn('justify-self-start text-[13px] text-chrome underline underline-offset-4 hover:text-paper focus-visible:outline-2 focus-visible:outline-signal', TOUCH)}>
          {t('Új időpont javaslása')}
        </button>
      )}
      {open && !pending && (
        <div id={id} className="grid gap-2">
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="grid gap-1 text-[12px] text-haze">{t('Dátum')}
              <input type="date" value={form.date} onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))}
                     className={cn('rounded-sm border border-hair bg-field px-2 py-1.5 text-sm text-paper', TOUCH)} /></label>
            <label className="grid gap-1 text-[12px] text-haze">{t('Kezdés')}
              <input type="time" value={form.start} onChange={(e) => setForm((p) => ({ ...p, start: e.target.value }))}
                     className={cn('rounded-sm border border-hair bg-field px-2 py-1.5 text-sm text-paper', TOUCH)} /></label>
            <label className="grid gap-1 text-[12px] text-haze">{t('Befejezés')}
              <input type="time" value={form.end} onChange={(e) => setForm((p) => ({ ...p, end: e.target.value }))}
                     className={cn('rounded-sm border border-hair bg-field px-2 py-1.5 text-sm text-paper', TOUCH)} /></label>
          </div>
          <p className="t-note">{t('Időzóna: {tz}', { tz: m.time_zone })}</p>
          <label className="grid gap-1 text-[12px] text-haze">{t('Üzenet (nem kötelező)')}
            <textarea rows={2} maxLength={1000} value={form.message} onChange={(e) => setForm((p) => ({ ...p, message: e.target.value }))}
                      className="rounded-sm border border-hair bg-field px-2 py-1.5 text-sm text-paper" /></label>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="primary" className={TOUCH} onClick={submit} disabled={busy}>{t('Javaslat elküldése')}</Button>
            <span className="t-note">{t('A megbeszélés csak akkor módosul, ha a Stratos elfogadja. Munkanapokon 1 munkanapon belül reagálunk.')}</span>
          </div>
        </div>
      )}
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  );
}

/* ================================================ client experience == */

const fieldCls = 'w-full rounded-sm border border-hair bg-field px-3 py-2 text-sm text-paper focus-visible:outline-2 focus-visible:outline-signal';
const dayHu = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString(intlLocale('hu-HU'), { month: 'long', day: 'numeric' });
const today = () => new Date().toLocaleDateString('sv-SE');

function ApprovalBadge({ approval }: { approval?: ClientApproval }) {
  if (!approval) return null;
  return (
    <p className="mt-1" data-approval-state={approval.state ?? 'waiting'}>
      {approval.state === 'approved' ? <Badge tone="good">{t('Jóváhagytad')}</Badge>
        : approval.state === 'changes' ? <Badge tone="warn">{t('Módosítást kértél')}</Badge>
          : <Badge tone="warn">{t('Jóváhagyásodra vár')}</Badge>}
    </p>
  );
}

/**
 * "Rád várunk": what Stratos is waiting for from the client — demos to
 * approve, the owner's requests and an open satisfaction survey — on top of
 * the projects page.
 */
function WaitingForYou({ names, demos, approvals, requests, surveys, ready, onChanged }: {
  names: Map<string, string>; demos: ClientDemo[]; approvals: ClientApproval[]; requests: ClientRequestRow[];
  surveys: ClientSurvey[]; ready: boolean; onChanged: () => void;
}) {
  const openApprovals = approvals.filter((a) => !a.state && demos.some((d) => d.demo_id === a.demo_id));
  const open = requests.filter((r) => !r.done_at);
  const done = requests.filter((r) => r.done_at).slice(0, 5);
  const openSurveys = surveys.filter((s) => !s.answered_at);
  const count = openApprovals.length + open.length + openSurveys.length;
  if (!ready) return null;
  return (
    <Panel aria-label={t('Rád várunk')}>
      <SectionHeader title={t('Rád várunk')} note={count ? `${count}` : undefined} />
      {count === 0 && <p className="px-4 py-3 text-[13px] text-haze">{t('Most semmi nem vár rád.')}</p>}
      <ul className="grid">
        {openSurveys.map((s) => <li key={s.survey_id} className="border-b border-hairline px-4 py-3 last:border-0"><SurveyCard survey={s} project={names.get(s.project_id) ?? ''} onChanged={onChanged} /></li>)}
        {openApprovals.map((a) => {
          const d = demos.find((x) => x.demo_id === a.demo_id)!;
          return <li key={a.demo_id} className="border-b border-hairline px-4 py-3 last:border-0"><ApprovalCard demo={d} onChanged={onChanged} /></li>;
        })}
        {open.map((r) => <li key={r.request_id} className="border-b border-hairline px-4 py-3 last:border-0"><RequestCard request={r} project={names.get(r.project_id) ?? ''} onChanged={onChanged} /></li>)}
      </ul>
      {done.length > 0 && (
        <details className="border-t border-hairline px-4 py-2">
          <summary className="t-note cursor-pointer">{t('Nemrég elintézve ({n})', { n: done.length })}</summary>
          <ul className="mt-1 grid gap-1">
            {done.map((r) => <li key={r.request_id} className="t-note"><Badge tone="good">{t('Kész')}</Badge> {r.title} · {names.get(r.project_id) ?? ''}</li>)}
          </ul>
        </details>
      )}
    </Panel>
  );
}

function ApprovalCard({ demo, onChanged }: { demo: ClientDemo; onChanged: () => void }) {
  const [changes, setChanges] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const decide = async (approve: boolean) => {
    if (!approve && !note.trim()) return setError(t('Írd le röviden, mit módosítsunk.'));
    setBusy(true);
    const problem = await decideDemo(demo.demo_id, approve, approve ? null : note.trim());
    setBusy(false);
    setError(problem);
    if (!problem) onChanged();
  };
  const id = `appr-${demo.demo_id}`;
  return (
    <div className="grid gap-2 text-[13px]" data-approve={demo.demo_id}>
      <div>
        <p className="t-section text-signal">{t('Jóváhagyásra vár')}</p>
        <p className="text-[15px] text-paper">{demo.title} <span className="t-note">· {demo.project_name}</span></p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <a href={safeHttpsUrl(demo.url)} target="_blank" rel="noopener noreferrer" className={cn('inline-flex items-center gap-1 rounded-sm border border-hairline px-2.5 py-1.5 text-[12px] text-paper hover:bg-flare', TOUCH)}>
          {t('Demó megtekintése')} <ExternalLink size={11} aria-hidden="true" /><span className="sr-only"> {t('(új lapon nyílik)')}</span>
        </a>
        <Button size="sm" variant="primary" className={TOUCH} disabled={busy} onClick={() => void decide(true)}>{t('Jóváhagyom')}</Button>
        <Button size="sm" className={TOUCH} disabled={busy} aria-expanded={changes} aria-controls={id} onClick={() => setChanges(!changes)}>{t('Módosítást kérek')}</Button>
      </div>
      {changes && (
        <div id={id} className="grid gap-2">
          <label htmlFor={`${id}-note`} className="label">{t('Mit módosítsunk?')}</label>
          <textarea id={`${id}-note`} rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} className={fieldCls} />
          <div><Button size="sm" variant="primary" className={TOUCH} disabled={busy || !note.trim()} onClick={() => void decide(false)}>{t('Módosítási kérés elküldése')}</Button></div>
        </div>
      )}
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  );
}

function RequestCard({ request: r, project, onChanged }: { request: ClientRequestRow; project: string; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const late = r.due_on !== null && r.due_on < today();
  const finish = async () => {
    setBusy(true);
    const problem = await completeRequest(r.request_id, note.trim() || null);
    setBusy(false);
    setError(problem);
    if (!problem) onChanged();
  };
  const id = `req-${r.request_id}`;
  return (
    <div className="grid gap-2 text-[13px]" data-client-ask={r.request_id}>
      <div>
        <p className="t-section text-chrome">{t('Kérés a Stratostól')} · {project}</p>
        <p className="text-[15px] text-paper">{r.title}</p>
        {r.details && <p className="t-note whitespace-pre-line">{r.details}</p>}
        {r.due_on && <p className={cn('t-note', late && 'text-danger')}>{late ? t('Határidő lejárt: {day}', { day: dayHu(r.due_on) }) : t('Határidő: {day}', { day: dayHu(r.due_on) })}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="primary" className={TOUCH} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>{t('Kész')}</Button>
        <Link to={`/nyersanyag?projekt=${r.project_id}`} className="t-note underline underline-offset-4 hover:text-paper max-sm:py-2">{t('Fájl leadása')}</Link>
      </div>
      {open && (
        <div id={id} className="grid gap-2">
          <label htmlFor={`${id}-note`} className="label">{t('Megjegyzés (nem kötelező)')}</label>
          <textarea id={`${id}-note`} rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} className={fieldCls} />
          <div><Button size="sm" variant="primary" className={TOUCH} disabled={busy} onClick={() => void finish()}>{t('Jelzem, hogy kész')}</Button></div>
        </div>
      )}
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  );
}

function SurveyCard({ survey, project, onChanged }: { survey: ClientSurvey; project: string; onChanged: () => void }) {
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [thanks, setThanks] = useState<{ url: string | null } | null>(null);
  const send = async () => {
    if (score === null) return setError(t('Válassz egy számot 1 és 10 között.'));
    setBusy(true);
    const r = await answerSurvey(survey.survey_id, score, comment.trim() || null);
    setBusy(false);
    setError(r.problem);
    if (!r.problem) setThanks({ url: r.url });
  };
  const id = `srv-${survey.survey_id}`;
  if (thanks) {
    return (
      <div className="grid gap-2 text-[13px]" data-survey-thanks>
        <p className="text-[15px] text-paper">{t('Köszönjük a visszajelzést!')}</p>
        {thanks.url ? (
          <>
            <p className="text-haze">{t('Ha van egy perced, írnál rólunk egy Google-értékelést? Sokat segít, hogy mások is megtaláljanak.')}</p>
            <div className="flex flex-wrap gap-2">
              <a href={safeHttpsUrl(thanks.url)} target="_blank" rel="noopener noreferrer" onClick={() => void surveyGoogleClicked(survey.survey_id)}
                 className={cn('inline-flex items-center gap-1.5 rounded-sm bg-signal px-3 py-2 text-[13px] font-medium text-black hover:opacity-90', TOUCH)}>
                {t('Google-értékelés írása')} <ExternalLink size={12} aria-hidden="true" /><span className="sr-only"> {t('(új lapon nyílik)')}</span>
              </a>
              <Button size="sm" variant="quiet" className={TOUCH} onClick={onChanged}>{t('Most nem')}</Button>
            </div>
          </>
        ) : (
          <div><Button size="sm" variant="quiet" className={TOUCH} onClick={onChanged}>{t('Bezárás')}</Button></div>
        )}
      </div>
    );
  }
  return (
    <div className="grid gap-2 text-[13px]" data-survey-open={survey.survey_id}>
      <div>
        <p className="t-section text-chrome">{t('Rövid kérdés')} · {project}</p>
        <p id={`${id}-q`} className="text-[15px] text-paper">{t('Mennyire ajánlanál minket egy ismerősödnek?')}</p>
      </div>
      <div role="radiogroup" aria-labelledby={`${id}-q`} className="flex flex-wrap gap-1">
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
          <button key={n} type="button" role="radio" aria-checked={score === n} onClick={() => { setScore(n); setError(null); }}
                  className={cn('h-10 w-10 rounded-sm border text-[14px] focus-visible:outline-2 focus-visible:outline-signal',
                    score === n ? 'border-signal bg-signal font-medium text-black' : 'border-hairline text-paper hover:bg-flare')}>
            {n}
          </button>
        ))}
      </div>
      <p className="t-note">{t('1 = egyáltalán nem, 10 = biztosan')}</p>
      <label htmlFor={`${id}-c`} className="label">{t('Szeretnél még valamit hozzáfűzni? (nem kötelező)')}</label>
      <textarea id={`${id}-c`} rows={2} maxLength={2000} value={comment} onChange={(e) => setComment(e.target.value)} className={fieldCls} />
      <div><Button size="sm" variant="primary" className={TOUCH} disabled={busy || score === null} onClick={() => void send()}>{t('Küldés')}</Button></div>
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  );
}

/** The project's message thread with Stratos. */
function ProjectMessages({ projectId, rows, state, onChanged }: { projectId: string; rows: ClientMessage[]; state: string; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = `msgs-${projectId}`;
  const send = async () => {
    if (!text.trim()) return setError(t('Írj valamit az üzenetbe.'));
    setBusy(true);
    const problem = await sendMessage(projectId, text.trim());
    setBusy(false);
    setError(problem);
    if (!problem) { setText(''); onChanged(); }
  };
  if (state === 'error') return <p className="t-note">{t('Az üzenetek most nem tölthetők be.')}</p>;
  return (
    <section aria-label={t('Üzenetek')} className="grid gap-2" data-client-messages={projectId}>
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}
              className={cn('justify-self-start text-[13px] text-chrome underline underline-offset-4 hover:text-paper focus-visible:outline-2 focus-visible:outline-signal', TOUCH)}>
        {t('Üzenetek a Stratosnak')}{rows.length ? ` (${rows.length})` : ''}
      </button>
      {open && (
        <div id={id} className="grid gap-2">
          {rows.length > 0 && (
            <ol className="grid max-h-96 gap-1.5 overflow-y-auto" aria-label={t('Üzenetek')}>
              {rows.slice(-50).map((m) => (
                <li key={m.message_id} className={cn('max-w-[85%] rounded-sm border px-3 py-2 text-[13px]',
                  m.from_stratos ? 'justify-self-start border-signal/40 bg-deck' : 'justify-self-end border-hairline bg-flare')}>
                  <p className="whitespace-pre-line text-paper">{m.body}</p>
                  <p className="t-note mt-1">{m.from_stratos ? 'Stratos' : m.mine ? t('Te') : m.author_name} · {hu(m.created_at)}</p>
                </li>
              ))}
            </ol>
          )}
          <label htmlFor={`${id}-text`} className="label">{t('Új üzenet')}</label>
          <textarea id={`${id}-text`} rows={3} maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} className={fieldCls} />
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="primary" className={TOUCH} disabled={busy || !text.trim()} onClick={() => void send()}>{t('Küldés')}</Button>
            <span className="t-note">{t('A projekt minden résztvevője látja. Munkanapokon 1 munkanapon belül válaszolunk.')}</span>
          </div>
          {error && <p role="alert" className="text-xs text-danger">{error}</p>}
        </div>
      )}
    </section>
  );
}

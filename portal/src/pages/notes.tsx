import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Archive, ArrowRightToLine, CheckSquare, Pin, PinOff, Plus, RotateCcw, StickyNote, Trash2 } from 'lucide-react';
import { useAuth } from '@/features/auth/AuthProvider';
import { canAccess } from '@/lib/permissions';
import { useScope } from '@/lib/scope';
import { supabase, isConfigured } from '@/lib/supabase';
import {
  Badge, Button, DataState, ErrorState, Input, Panel, SectionHeader, Select, Skeleton, Textarea, cn,
} from '@/components/ui';
import { shortDate } from '@/lib/pipeline';
import { t } from '@/lib/i18n';
import { todayIso, useNotes, useNotesMutations, type Note, type NoteItem } from '@/lib/notes';

/**
 * NOTES — working notes and checklists, optionally about one client.
 *
 * Made for writing while a meeting is going on: a new point is saved the
 * moment Enter is pressed, and the cursor stays in the line for the next one.
 * A point with a date is a task and shows on Today. A point can become a
 * checkpoint of one of the client's projects (owner only).
 *
 * Nothing is deleted: a note is archived, and can be brought back.
 */

type Filter = 'all' | 'pinned' | 'archived' | string; // or a client id

export function NotesScreen() {
  const { reloadToken } = useScope();
  const [params, setParams] = useSearchParams();
  const [tick, setTick] = useState(0);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const live = useNotes(reloadToken + tick);
  const archived = useNotes(reloadToken + tick, { archived: true });
  const ops = useNotesMutations(() => setTick((n) => n + 1));
  const clients = useClientNames();
  const [error, setError] = useState<string | null>(null);

  const source = filter === 'archived' ? archived : live;
  const q = query.trim().toLowerCase();
  const shown = useMemo(() => source.rows
    .filter((n) => filter === 'all' || filter === 'archived' || (filter === 'pinned' ? n.pinned : n.organization_id === filter))
    .filter((n) => !q || [n.title, n.body, n.client?.name, ...n.items.map((i) => i.text)]
      .some((f) => String(f ?? '').toLowerCase().includes(q))), [source.rows, filter, q]);

  const selectedId = params.get('note');
  const selected = [...live.rows, ...archived.rows].find((n) => n.id === selectedId) ?? null;
  const select = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('note', id); else next.delete('note');
    setParams(next, { replace: true });
  };

  const create = async (kind: Note['kind']) => {
    const client = filter !== 'all' && filter !== 'pinned' && filter !== 'archived' ? filter : null;
    const result = await ops.createNote({
      kind, title: kind === 'checklist' ? t('New checklist') : t('New note'), organization_id: client,
    });
    if (typeof result === 'string') { setError(result); return; }
    select(result.id);
  };

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="notes-filter">{t('Show')}</label>
          <Select id="notes-filter" value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">{t('Every note')}</option>
            <option value="pinned">{t('Pinned')}</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            <option value="archived">{t('Archived')}</option>
          </Select>
          <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('Search notes…')}
                 aria-label={t('Search notes')} className="h-7 w-48 py-1 text-xs sm:w-60" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => void create('note')} disabled={ops.busy === 'create'}>
            <StickyNote size={12} aria-hidden="true" /> {t('New note')}
          </Button>
          <Button size="sm" variant="primary" onClick={() => void create('checklist')} disabled={ops.busy === 'create'}>
            <CheckSquare size={12} aria-hidden="true" /> {t('New checklist')}
          </Button>
        </div>
      </div>
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Panel className="min-w-0 self-start" aria-label={t('Notes')}>
          <SectionHeader title={filter === 'archived' ? t('Archived') : t('Notes')} note={source.state === 'ready' ? String(shown.length) : undefined} />
          {source.state === 'loading' && <div className="space-y-1.5 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>}
          {source.state === 'unconfigured' && <DataState kind="unconfigured" title={t('Not connected')} />}
          {source.state === 'error' && <ErrorState message={source.message} onRetry={source.reload} />}
          {source.state === 'ready' && shown.length === 0 && (
            <DataState kind="empty" title={source.rows.length === 0 ? t('No notes yet') : t('Nothing matches')}
                       body={source.rows.length === 0 ? t('Start one with New note or New checklist — during a meeting, every line is saved as you press Enter.') : undefined} />
          )}
          <ul className="grid">
            {shown.map((n) => {
              const done = n.items.filter((i) => i.done).length;
              return (
                <li key={n.id}>
                  <button type="button" onClick={() => select(n.id)} aria-current={n.id === selectedId ? 'true' : undefined}
                          className={cn('grid w-full gap-0.5 border-b border-hairline px-4 py-2.5 text-left hover:bg-flare',
                            n.id === selectedId && 'bg-flare')} data-note={n.id}>
                    <span className="flex items-center gap-1.5 text-[13px] text-paper">
                      {n.pinned && <Pin size={11} aria-label={t('Pinned')} />}
                      {n.kind === 'checklist' ? <CheckSquare size={11} aria-hidden="true" /> : <StickyNote size={11} aria-hidden="true" />}
                      <span className="truncate">{n.title}</span>
                    </span>
                    <span className="t-note truncate">
                      {[n.client?.name, n.kind === 'checklist' ? t('{done}/{total} done', { done, total: n.items.length }) : n.body?.slice(0, 80),
                        shortDate(n.updated_at)].filter(Boolean).join(' · ')}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Panel>

        {selected
          ? <NoteEditor key={selected.id} note={selected} clients={clients} onChanged={() => setTick((n) => n + 1)} onClosed={() => select(null)} />
          : (
            <Panel className="self-start">
              <DataState kind="empty" title={t('Choose a note')} body={t('Or start a new one. A checklist point with a date also appears on Today.')} />
            </Panel>
          )}
      </div>
    </div>
  );
}

/** Live clients for the "about" select — names only. */
export function useClientNames() {
  const [rows, setRows] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    if (!isConfigured) return;
    let alive = true;
    void supabase.from('organizations').select('id, name').is('archived_at', null).order('name').limit(500)
      .then(({ data }) => { if (alive) setRows((data ?? []) as { id: string; name: string }[]); });
    return () => { alive = false; };
  }, []);
  return rows;
}

function NoteEditor({ note, clients, onChanged, onClosed }: {
  note: Note; clients: { id: string; name: string }[]; onChanged: () => void; onClosed: () => void;
}) {
  const { profile } = useAuth();
  const ops = useNotesMutations(onChanged);
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body ?? '');
  const [saved, setSaved] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState<string | null>(null);
  const archived = Boolean(note.archived_at);
  const mayCheckpoint = canAccess(profile, 'manage_projects') && Boolean(note.organization_id);

  const save = async (patch: Parameters<typeof ops.updateNote>[1]) => {
    setSaved('saving');
    const problem = await ops.updateNote(note.id, patch);
    setError(problem);
    setSaved(problem ? 'idle' : 'saved');
  };

  return (
    <Panel className="min-w-0 self-start" aria-label={t('Note')}>
      <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-4 py-3">
        <label className="sr-only" htmlFor="note-title">{t('Title')}</label>
        <Input id="note-title" value={title} maxLength={200} disabled={archived}
               onChange={(e) => setTitle(e.target.value)}
               onBlur={() => { if (title.trim() && title !== note.title) void save({ title: title.trim() }); }}
               className="min-w-0 flex-1 text-[15px]" />
        <Button size="sm" variant="quiet" disabled={archived} onClick={() => void save({ pinned: !note.pinned })}
                aria-pressed={note.pinned} aria-label={note.pinned ? t('Unpin') : t('Pin')}>
          {note.pinned ? <PinOff size={12} aria-hidden="true" /> : <Pin size={12} aria-hidden="true" />}
        </Button>
        {archived
          ? <Button size="sm" onClick={async () => setError(await ops.archiveNote(note.id, false))}><RotateCcw size={11} aria-hidden="true" /> {t('Restore')}</Button>
          : <Button size="sm" variant="quiet" aria-label={t('Archive')}
                    onClick={async () => { const p = await ops.archiveNote(note.id, true); if (p) setError(p); else onClosed(); }}>
              <Archive size={12} aria-hidden="true" />
            </Button>}
      </div>

      <div className="grid gap-3 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="t-note" htmlFor="note-client">{t('About')}</label>
          <Select id="note-client" value={note.organization_id ?? ''} disabled={archived}
                  onChange={(e) => void save({ organization_id: e.target.value || null })}>
            <option value="">{t('No client')}</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          {note.client && (
            <Link to={`/clients/${note.client.id}`} className="t-note underline underline-offset-4 hover:text-paper">{t('Open the client')}</Link>
          )}
          <span className="t-note ml-auto" aria-live="polite">{saved === 'saving' ? t('Saving…') : saved === 'saved' ? t('Saved') : ''}</span>
        </div>

        {note.kind === 'checklist' && (
          <Checklist note={note} ops={ops} archived={archived} mayCheckpoint={mayCheckpoint} onError={setError} />
        )}

        <div>
          <label className="label" htmlFor="note-body">{note.kind === 'checklist' ? t('Notes beside the list') : t('Note')}</label>
          <Textarea id="note-body" value={body} maxLength={20000} disabled={archived}
                    rows={note.kind === 'checklist' ? 3 : 14}
                    placeholder={t('Write freely — it is saved when you leave the field.')}
                    onChange={(e) => setBody(e.target.value)}
                    onBlur={() => { if (body !== (note.body ?? '')) void save({ body: body.trim() ? body : null }); }} />
        </div>

        {note.kind === 'note' && !archived && (
          <Button size="sm" variant="quiet" className="justify-self-start" onClick={() => void save({ kind: 'checklist' })}>
            <CheckSquare size={11} aria-hidden="true" /> {t('Add a checklist to this note')}
          </Button>
        )}
        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      </div>
    </Panel>
  );
}

function Checklist({ note, ops, archived, mayCheckpoint, onError }: {
  note: Note; ops: ReturnType<typeof useNotesMutations>; archived: boolean; mayCheckpoint: boolean; onError: (e: string | null) => void;
}) {
  const [draft, setDraft] = useState('');
  const [due, setDue] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const done = note.items.filter((i) => i.done).length;

  const add = async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    // The date belongs to this point only: the next line starts undated.
    const dueOn = due || null;
    setDue('');
    const problem = await ops.addItem(note.id, text, (note.items.at(-1)?.position ?? -1) + 1, dueOn);
    if (problem) { setDraft(text); setDue(dueOn ?? ''); onError(problem); }
    input.current?.focus();
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); void add(); }
  };

  return (
    <div className="grid gap-1" data-checklist>
      <p className="t-section">{t('Checklist')} <span className="t-note normal-case tracking-normal">{t('{done}/{total} done', { done, total: note.items.length })}</span></p>
      <ul className="grid">
        {note.items.map((item) => (
          <ChecklistRow key={item.id} item={item} ops={ops} archived={archived} mayCheckpoint={mayCheckpoint}
                        organizationId={note.organization_id} onError={onError} />
        ))}
      </ul>
      {!archived && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <label className="sr-only" htmlFor="note-new-item">{t('New point')}</label>
          <Input id="note-new-item" ref={input} value={draft} maxLength={500} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey}
                 placeholder={t('New point — Enter to add')} className="min-w-0 flex-1" />
          <label className="sr-only" htmlFor="note-new-due">{t('Due')}</label>
          <Input id="note-new-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} className="w-40" />
          <Button size="sm" onClick={() => void add()} disabled={!draft.trim()}><Plus size={11} aria-hidden="true" /> {t('Add')}</Button>
        </div>
      )}
    </div>
  );
}

function ChecklistRow({ item, ops, archived, mayCheckpoint, organizationId, onError }: {
  item: NoteItem; ops: ReturnType<typeof useNotesMutations>; archived: boolean; mayCheckpoint: boolean;
  organizationId: string | null; onError: (e: string | null) => void;
}) {
  const [text, setText] = useState(item.text);
  const [choosing, setChoosing] = useState(false);
  const today = todayIso();
  const late = !item.done && item.due_on !== null && item.due_on < today;

  return (
    <li className="flex flex-wrap items-center gap-2 border-b border-hairline py-1.5 last:border-0" data-item={item.done ? 'done' : 'open'}>
      <input type="checkbox" checked={item.done} disabled={archived} aria-label={t('Done: {text}', { text: item.text })}
             onChange={async (e) => onError(await ops.updateItem(item.id, { done: e.target.checked }))}
             className="h-4 w-4 shrink-0 accent-signal" />
      <label className="sr-only" htmlFor={`item-${item.id}`}>{t('Point')}</label>
      <input id={`item-${item.id}`} value={text} maxLength={500} disabled={archived}
             onChange={(e) => setText(e.target.value)}
             onBlur={async () => { if (text.trim() && text !== item.text) onError(await ops.updateItem(item.id, { text })); }}
             className={cn('min-w-0 flex-1 bg-transparent text-[13px] outline-none focus-visible:ring-1 focus-visible:ring-signal',
               item.done ? 'text-haze line-through' : 'text-paper')} />
      <label className="sr-only" htmlFor={`due-${item.id}`}>{t('Due')}</label>
      <input id={`due-${item.id}`} type="date" value={item.due_on ?? ''} disabled={archived}
             onChange={async (e) => onError(await ops.updateItem(item.id, { due_on: e.target.value || null }))}
             className={cn('num rounded-sm border border-hair bg-transparent px-1.5 py-0.5 text-[11px]', late ? 'text-danger' : 'text-haze')} />
      {item.milestone_id
        ? <Badge tone="good">{t('Checkpoint')}</Badge>
        : mayCheckpoint && !archived && !choosing && (
          <Button size="sm" variant="quiet" onClick={() => setChoosing(true)} aria-label={t('Make "{text}" a project checkpoint', { text: item.text })}>
            <ArrowRightToLine size={11} aria-hidden="true" />
          </Button>
        )}
      {!archived && (
        <Button size="sm" variant="quiet" aria-label={t('Remove {text}', { text: item.text })}
                onClick={async () => onError(await ops.removeItem(item.id))}>
          <Trash2 size={11} aria-hidden="true" />
        </Button>
      )}
      {choosing && organizationId && (
        <ProjectPicker organizationId={organizationId} onCancel={() => setChoosing(false)}
                       onPick={async (projectId) => { const p = await ops.toMilestone(item.id, projectId); onError(p); if (!p) setChoosing(false); }} />
      )}
    </li>
  );
}

/** The client's open projects, to turn a point into a checkpoint of one. */
function ProjectPicker({ organizationId, onPick, onCancel }: { organizationId: string; onPick: (id: string) => void; onCancel: () => void }) {
  const [rows, setRows] = useState<{ id: string; name: string }[] | null>(null);
  useEffect(() => {
    let alive = true;
    void supabase.from('projects').select('id, name').eq('organization_id', organizationId).is('archived_at', null)
      .neq('status', 'completed').order('name').limit(50)
      .then(({ data }) => { if (alive) setRows((data ?? []) as { id: string; name: string }[]); });
    return () => { alive = false; };
  }, [organizationId]);
  return (
    <div className="flex w-full flex-wrap items-center gap-2 pl-6">
      {rows === null ? <span className="t-note">{t('Loading…')}</span>
        : rows.length === 0 ? <span className="t-note">{t('This client has no open project.')}</span>
          : rows.map((p) => <Button key={p.id} size="sm" onClick={() => onPick(p.id)}>{t('Add to {project}', { project: p.name })}</Button>)}
      <Button size="sm" variant="quiet" onClick={onCancel}>{t('Cancel')}</Button>
    </div>
  );
}

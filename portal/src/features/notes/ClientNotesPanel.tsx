import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CheckSquare, Pin, StickyNote } from 'lucide-react';
import { Button, Panel, SectionHeader } from '@/components/ui';
import { shortDate } from '@/lib/pipeline';
import { t } from '@/lib/i18n';
import { useNotes, useNotesMutations, type Note } from '@/lib/notes';

/**
 * A client's notes and checklists, on the client's page. New ones are made
 * already about this client and open in Notes, ready to write in.
 */
export function ClientNotesPanel({ organizationId, mayEdit, reloadToken = 0 }: { organizationId: string; mayEdit: boolean; reloadToken?: number }) {
  const navigate = useNavigate();
  const notes = useNotes(reloadToken, { organizationId });
  const ops = useNotesMutations(() => {});
  const [error, setError] = useState<string | null>(null);

  const create = async (kind: Note['kind']) => {
    const r = await ops.createNote({ kind, title: kind === 'checklist' ? t('New checklist') : t('New note'), organization_id: organizationId });
    if (typeof r === 'string') { setError(r); return; }
    navigate(`/notes?note=${r.id}`);
  };

  return (
    <Panel aria-label={t('Notes and checklists')}>
      <SectionHeader
        title={t('Notes and checklists')}
        note={notes.state === 'ready' && notes.rows.length > 0 ? String(notes.rows.length) : undefined}
        action={mayEdit ? (
          <span className="flex gap-1">
            <Button size="sm" variant="quiet" onClick={() => void create('note')} aria-label={t('New note')}><StickyNote size={11} aria-hidden="true" /></Button>
            <Button size="sm" variant="quiet" onClick={() => void create('checklist')} aria-label={t('New checklist')}><CheckSquare size={11} aria-hidden="true" /></Button>
          </span>
        ) : undefined}
      />
      {notes.state === 'ready' && notes.rows.length === 0 && (
        <p className="px-4 py-3 text-xs text-haze">{t('No notes about this client yet. Start one when you meet — every line is saved as you type it.')}</p>
      )}
      {error && <p role="alert" className="px-4 py-2 text-xs text-danger">{error}</p>}
      <ul className="grid">
        {notes.rows.map((n) => {
          const open = n.items.filter((i) => !i.done).length;
          return (
            <li key={n.id} className="border-b border-hairline px-4 py-2 last:border-0">
              <Link to={`/notes?note=${n.id}`} className="flex items-center gap-1.5 text-[13px] text-paper hover:text-signal">
                {n.pinned && <Pin size={11} aria-label={t('Pinned')} />}
                {n.kind === 'checklist' ? <CheckSquare size={11} aria-hidden="true" /> : <StickyNote size={11} aria-hidden="true" />}
                <span className="truncate">{n.title}</span>
              </Link>
              <p className="t-note">
                {n.kind === 'checklist' ? t('{open} open of {total}', { open, total: n.items.length }) : shortDate(n.updated_at)}
              </p>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

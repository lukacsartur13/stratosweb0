import { useState } from 'react';
import { Link } from 'react-router-dom';
import { RotateCcw, Trash2 } from 'lucide-react';
import { useAuth } from '@/features/auth/AuthProvider';
import { can, canAccess } from '@/lib/permissions';
import { useScope } from '@/lib/scope';
import {
  Button, Cell, DataState, ErrorState, Panel, Row, SectionHeader, Skeleton, Table,
} from '@/components/ui';
import { formatWhen } from '@/lib/leads';
import { useTrash, useTrashMutations, type TrashKind, type TrashRow } from '@/lib/trash';
import { t } from '@/lib/i18n';

/**
 * THE TRASH — projects, clients and leads that were moved here.
 *
 * Restore puts a record back exactly as it was. Delete permanently removes it
 * and what belongs only to it (checkpoints, costs, notes, contacts); the
 * database refuses while money, files, client portal access or sales deals
 * hang off it, and the refusal names them (20261007000100_trash.sql).
 *
 * Who sees what: leads — anyone who manages leads; clients — anyone who
 * manages clients, but only the owner deletes one permanently; projects — the
 * owner alone, like every project screen.
 */

// English source text; translated where it is rendered (`t(section.title)`),
// never here — a module-level string is evaluated once, before any language.
const SECTIONS: { kind: TrashKind; title: string; path: (id: string) => string; note: string }[] = [
  { kind: 'project', title: 'Projects', path: (id) => `/projects/${id}`,
    note: 'Its checkpoints, costs, links and notes are deleted with it. Payments, documents and client portal access block a permanent delete.' },
  { kind: 'client', title: 'Clients', path: (id) => `/clients/${id}`,
    note: 'Its contacts and notes are deleted with it. Its projects (also those in the Trash), client portal accounts and sales opportunities block a permanent delete.' },
  { kind: 'lead', title: 'Leads', path: (id) => `/leads/${id}`,
    note: 'The enquiry, its personal data and its notes are deleted. A sales opportunity made from it stays, without the link.' },
];

export function TrashScreen() {
  const { profile } = useAuth();
  const { reloadToken } = useScope();
  const may: Record<TrashKind, boolean> = {
    project: canAccess(profile, 'manage_projects'),
    client: can(profile?.role, 'manage_clients'),
    lead: can(profile?.role, 'manage_leads'),
  };
  // Deleting a client reads whether it still has projects — the owner's to know.
  const mayPurge: Record<TrashKind, boolean> = { ...may, client: may.client && canAccess(profile, 'manage_projects') };
  const { rows, state, reload } = useTrash(reloadToken, may);
  const ops = useTrashMutations(() => { void reload(); });
  const [message, setMessage] = useState<{ id: string; text: string } | null>(null);

  const restore = async (r: TrashRow) => {
    const problem = await ops.restore(r.kind, r.id);
    setMessage(problem ? { id: r.id, text: problem } : null);
  };
  const purge = async (r: TrashRow) => {
    if (!window.confirm(t('Delete "{name}" permanently?\n\nThis cannot be undone.', { name: r.name }))) return;
    const problem = await ops.purge(r.kind, r.id);
    setMessage(problem ? { id: r.id, text: problem } : null);
  };

  return (
    <div className="grid gap-4">
      <p className="t-note">
        {t('Moved here from a project, client or lead screen. Nothing here appears in any list or total. Restore puts it back unchanged; Delete permanently cannot be undone.')}
      </p>

      {state === 'loading' && <Skeleton className="h-40 w-full" />}
      {state === 'unconfigured' && <Panel><DataState kind="unconfigured" title={t('Not connected')} /></Panel>}
      {state === 'error' && <Panel><ErrorState message={t('The Trash could not be read.')} onRetry={reload} /></Panel>}

      {state === 'ready' && SECTIONS.filter((s) => may[s.kind]).map((section) => {
        const items = rows.filter((r) => r.kind === section.kind);
        return (
          <Panel key={section.kind} aria-label={t('Trash: {section}', { section: t(section.title) })} className="min-w-0">
            <SectionHeader title={t(section.title)} note={`${items.length}`} />
            {items.length === 0 ? (
              <p className="px-4 py-3 text-xs text-haze">{t('Nothing in the Trash.')}</p>
            ) : (
              <Table head={[t('Name'), t('Details'), t('Trashed'), { label: '', align: 'right' }]} minWidth={640}>
                {items.map((r) => (
                  <Row key={r.id}>
                    <Cell className="min-w-0">
                      <Link to={section.path(r.id)} className="text-[13px] text-paper hover:text-signal">{r.name}</Link>
                      {message?.id === r.id && (
                        <p role="alert" className="mt-1 whitespace-normal text-xs text-danger">{message.text}</p>
                      )}
                    </Cell>
                    <Cell className="truncate text-[11px] text-haze">{r.detail ?? '—'}</Cell>
                    <Cell className="num whitespace-nowrap text-[11px] text-haze">{formatWhen(r.trashed_at)}</Cell>
                    <Cell align="right">
                      <span className="inline-flex gap-1">
                        <Button size="sm" className="whitespace-nowrap" onClick={() => void restore(r)} disabled={ops.busy === r.id}>
                          <RotateCcw size={11} aria-hidden="true" /> {t('Restore')}
                        </Button>
                        {mayPurge[r.kind] && (
                          <Button size="sm" variant="danger" className="whitespace-nowrap" onClick={() => void purge(r)} disabled={ops.busy === r.id}>
                            <Trash2 size={11} aria-hidden="true" /> {t('Delete permanently')}
                          </Button>
                        )}
                      </span>
                    </Cell>
                  </Row>
                ))}
              </Table>
            )}
            <p className="t-note border-t border-hairline px-4 py-2">{t(section.note)}</p>
          </Panel>
        );
      })}
    </div>
  );
}

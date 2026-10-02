import { useState } from 'react';
import { Link } from 'react-router-dom';
import { RotateCcw, Trash2 } from 'lucide-react';
import { Badge, Button, Panel } from '@/components/ui';
import { formatWhen } from '@/lib/leads';
import { TRASH_NOUN, useTrashMutations, type TrashKind } from '@/lib/trash';

/**
 * "Move to trash" on a record's own screen. Asks once, then hides the record
 * everywhere and calls `onTrashed` (the screen navigates back to its list).
 * Nothing is deleted: the Trash can restore it.
 */
export function MoveToTrashButton({
  kind, id, name, onTrashed,
}: { kind: TrashKind; id: string; name: string; onTrashed: () => void }) {
  const ops = useTrashMutations(onTrashed);
  const [error, setError] = useState<string | null>(null);

  const go = async () => {
    if (!window.confirm(`Move "${name}" to the Trash?\n\nIt disappears from every list and total. You can restore it from the Trash, or delete it permanently there.`)) return;
    setError(await ops.moveToTrash(kind, id));
  };

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button size="sm" variant="danger" onClick={go} disabled={ops.busy === id} data-trash={kind}>
        <Trash2 size={11} aria-hidden="true" /> Move to trash
      </Button>
      {error && <span role="alert" className="text-xs text-danger">{error}</span>}
    </span>
  );
}

/** Shown on a record's screen while it is in the Trash, with Restore. */
export function InTrashBanner({
  kind, id, at, onRestored,
}: { kind: TrashKind; id: string; at: string; onRestored: () => void }) {
  const ops = useTrashMutations(onRestored);
  const [error, setError] = useState<string | null>(null);
  return (
    <Panel className="flex flex-wrap items-center justify-between gap-3 border-danger/40 px-4 py-3" data-in-trash={kind}>
      <p className="text-xs text-paper">
        <Badge tone="bad">In the Trash</Badge>{' '}
        This {TRASH_NOUN[kind]} was moved to the Trash on {formatWhen(at)}. It is hidden from every list and total.
      </p>
      <span className="flex flex-wrap items-center gap-2">
        <Link to="/trash" className="t-note underline underline-offset-4 hover:text-paper">Open the Trash</Link>
        <Button size="sm" onClick={async () => setError(await ops.restore(kind, id))} disabled={ops.busy === id}>
          <RotateCcw size={11} aria-hidden="true" /> Restore
        </Button>
      </span>
      {error && <p role="alert" className="w-full text-xs text-danger">{error}</p>}
    </Panel>
  );
}

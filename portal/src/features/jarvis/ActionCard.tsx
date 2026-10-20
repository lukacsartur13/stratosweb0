import { useState, type FormEvent } from 'react';
import { Check, CircleSlash, Clock, ExternalLink, LoaderCircle, RotateCcw, TriangleAlert } from 'lucide-react';
import { Button, Input, Textarea, cn } from '@/components/ui';
import { budapestInput, decide, describeInput, errorText, googleLink, isInstant, type ActionState } from '@/lib/jarvis';
import { t } from '@/lib/i18n';

/**
 * One write Jarvis made or proposes (supabase/JARVIS.md, phase 5).
 *
 *   pending    an approval card: what it will do and why it waits; Approve,
 *              Edit (the fields, checked again by the server), Reject
 *   executed   done — with Undo while it is an internal write
 *   failed     what went wrong — Try again approves it once more
 *   rejected / reverted   said so, quietly
 *
 * Every decision is the server's (POST /api/jarvis { op }): this card asks,
 * shows the answer, and tells the panel so the "waiting" count can follow.
 */

const LONG = new Set(['body', 'summary', 'message', 'note', 'text', 'title', 'next_action']);
const isDay = (k: string) => k.endsWith('_on') || k === 'work_date';

export function ActionCard({ action, onChange }: { action: ActionState; onChange: (a: ActionState) => void }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});

  // Text, numbers and lists of addresses (to, cc, attendees: comma-separated) can be edited; yes/no switches cannot.
  const editable = Object.entries(action.payload ?? {}).filter(([, v]) => v === null || typeof v === 'string' || typeof v === 'number'
    || (Array.isArray(v) && v.every((x) => typeof x === 'string')));

  const act = async (op: 'approve' | 'reject' | 'undo', payload?: Record<string, unknown>) => {
    setBusy(true);
    setProblem(null);
    const r = await decide(op, action.id, payload);
    setBusy(false);
    if (r.action) onChange(r.action);
    if (r.ok) { setEditing(false); return; }
    setProblem(r.message ?? errorText(r.code));
  };

  const startEdit = () => {
    setDraft(Object.fromEntries(editable.map(([k, v]) => [k, v === null ? '' : Array.isArray(v) ? v.join(', ') : isInstant(v) ? budapestInput(v) : String(v)])));
    setEditing(true);
  };
  const approveEdited = (e: FormEvent) => {
    e.preventDefault();
    const payload: Record<string, unknown> = { ...action.payload };
    for (const [k, original] of editable) {
      const v = (draft[k] ?? '').trim();
      payload[k] = Array.isArray(original) ? v.split(/[,;\s]+/).filter(Boolean)
        : v === '' ? null : typeof original === 'number' ? Number(v.replace(',', '.')) : v;
    }
    void act('approve', payload);
  };

  const pending = action.status === 'pending';
  const tone = pending ? 'border-signal/50' : action.status === 'failed' ? 'border-danger/40' : 'border-hairline';
  const icon = action.status === 'executed' ? <Check size={11} className="shrink-0 text-good" aria-hidden="true" />
    : action.status === 'failed' ? <TriangleAlert size={11} className="shrink-0 text-danger" aria-hidden="true" />
      : action.status === 'reverted' || action.status === 'rejected' ? <CircleSlash size={11} className="shrink-0 text-haze" aria-hidden="true" />
        : pending ? <Clock size={11} className="shrink-0 text-signal" aria-hidden="true" />
          : <LoaderCircle size={11} className="shrink-0 motion-safe:animate-spin" aria-hidden="true" />;
  const state = {
    pending: t('Waiting for your approval'), approved: t('Running…'), executed: t('Done'),
    failed: t('Failed'), rejected: t('Rejected'), reverted: t('Undone'),
  }[action.status];

  return (
    <div className={cn('grid gap-2 rounded-sm border px-3 py-2', tone)} data-jarvis-action={action.status} role="group" aria-label={action.summary}>
      <p className="flex items-start gap-1.5 text-[12px] leading-relaxed text-paper">
        <span className="mt-1">{icon}</span>
        <span className={cn('min-w-0 break-words', (action.status === 'rejected' || action.status === 'reverted') && 'text-haze line-through')}>{action.summary}</span>
      </p>
      <p className="t-meta">{state}</p>

      {pending && action.reason && (
        <p className="t-note">
          {action.reason === 'external'
            ? t('This acts outside the Portal, so it runs only after you approve it.')
            : t('In this answer Jarvis read text that someone outside wrote (a form message, an e-mail), so a write waits for you.')}
        </p>
      )}

      {pending && !editing && editable.length > 0 && (
        <ul className="t-meta grid gap-0.5 border-t border-hairline pt-1.5">
          {describeInput(action.payload).map((p) => <li key={p} className="break-words">{p}</li>)}
        </ul>
      )}

      {pending && editing && (
        <form onSubmit={approveEdited} className="grid gap-2 border-t border-hairline pt-2" data-jarvis-edit>
          {editable.map(([k, original]) => {
            const id = `jarvis-edit-${action.id}-${k}`;
            const value = draft[k] ?? '';
            const set = (v: string) => setDraft((d) => ({ ...d, [k]: v }));
            return (
              <div key={k} className="grid gap-1">
                <label htmlFor={id} className="label">{k}</label>
                {LONG.has(k)
                  ? <Textarea id={id} rows={3} value={value} onChange={(e) => set(e.target.value)} className="min-h-0 py-1.5 text-[12px]" />
                  : <Input id={id} value={value} onChange={(e) => set(e.target.value)} className="py-1.5 text-[12px]"
                      // A time is edited on Budapest's clock; the server reads "YYYY-MM-DDTHH:MM" as such.
                      type={isInstant(original) ? 'datetime-local' : isDay(k) ? 'date' : 'text'} inputMode={typeof original === 'number' ? 'decimal' : undefined} />}
              </div>
            );
          })}
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="primary" type="submit" disabled={busy}>{t('Approve as edited')}</Button>
            <Button size="sm" variant="quiet" type="button" onClick={() => setEditing(false)} disabled={busy}>{t('Cancel')}</Button>
          </div>
        </form>
      )}

      {pending && !editing && (
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="primary" onClick={() => act('approve')} disabled={busy} data-jarvis-approve>{t('Approve')}</Button>
          {editable.length > 0 && <Button size="sm" onClick={startEdit} disabled={busy}>{t('Edit')}</Button>}
          <Button size="sm" variant="quiet" onClick={() => act('reject')} disabled={busy}>{t('Reject')}</Button>
        </div>
      )}

      {action.status === 'executed' && (googleLink(action.link) || googleLink(action.meet)) && (
        <p className="flex flex-wrap gap-3 text-[12px]">
          {googleLink(action.link) && (
            <a href={googleLink(action.link) as string} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-paper underline-offset-2 hover:underline" data-jarvis-link>
              <ExternalLink size={11} aria-hidden="true" /> {action.tool === 'gmail_create_draft' ? t('Open the drafts in Gmail') : t('Open in Google Calendar')}
            </a>
          )}
          {googleLink(action.meet) && (
            <a href={googleLink(action.meet) as string} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-paper underline-offset-2 hover:underline">
              <ExternalLink size={11} aria-hidden="true" /> Google Meet
            </a>
          )}
        </p>
      )}

      {action.status === 'executed' && action.undoable && (
        <div>
          <Button size="sm" variant="quiet" className="-ml-2" onClick={() => act('undo')} disabled={busy} data-jarvis-undo>
            <RotateCcw size={11} aria-hidden="true" /> {t('Undo')}
          </Button>
        </div>
      )}

      {action.status === 'failed' && (
        <>
          {action.error && <p className="text-[12px] text-danger">{action.error}</p>}
          <div><Button size="sm" onClick={() => act('approve')} disabled={busy}>{t('Try again')}</Button></div>
        </>
      )}

      {problem && <p role="alert" className="text-[12px] text-danger">{problem}</p>}
    </div>
  );
}

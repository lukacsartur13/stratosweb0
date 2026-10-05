import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Badge, Button, Field, Panel, SectionHeader, Select, Textarea } from '@/components/ui';
import { formatWhen } from '@/lib/leads';
import { t } from '@/lib/i18n';
import {
  INTERACTION_KINDS, INTERACTION_LABEL, logInteraction, removeInteraction, useInteractions,
  type InteractionKind, type InteractionTarget,
} from '@/lib/notes';

/** `YYYY-MM-DDTHH:mm` in local time, for a datetime-local input. */
const localNow = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

/**
 * THE ACTIVITY LOG of a client, a lead or a sales opportunity: calls,
 * e-mails, meetings and messages, logged in two clicks. Newest first.
 */
export function ActivityLog({ target, mayEdit, reloadToken = 0 }: { target: InteractionTarget; mayEdit: boolean; reloadToken?: number }) {
  const [tick, setTick] = useState(0);
  const log = useInteractions(target, reloadToken + tick);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<{ kind: InteractionKind; summary: string; at: string }>({ kind: 'call', summary: '', at: localNow() });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    const problem = await logInteraction(target, { kind: form.kind, summary: form.summary, occurred_at: new Date(form.at).toISOString() });
    setBusy(false);
    setError(problem);
    if (!problem) { setOpen(false); setForm({ kind: 'call', summary: '', at: localNow() }); setTick((n) => n + 1); }
  };

  return (
    <Panel aria-label={t('Activity log')}>
      <SectionHeader
        title={t('Activity log')}
        note={log.state === 'ready' && log.rows.length > 0 ? String(log.rows.length) : undefined}
        action={mayEdit && !open
          ? <Button size="sm" variant="quiet" onClick={() => setOpen(true)}><Plus size={11} aria-hidden="true" /> {t('Log')}</Button>
          : undefined}
      />
      {open && (
        <div className="grid gap-2 border-b border-hairline px-4 py-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <Field id="act-kind" label={t('What')}>
              <Select id="act-kind" className="w-full py-2 text-sm" value={form.kind}
                      onChange={(e) => setForm((p) => ({ ...p, kind: e.target.value as InteractionKind }))}>
                {INTERACTION_KINDS.map((k) => <option key={k} value={k}>{t(INTERACTION_LABEL[k])}</option>)}
              </Select>
            </Field>
            <Field id="act-at" label={t('When')}>
              <input id="act-at" type="datetime-local" value={form.at} onChange={(e) => setForm((p) => ({ ...p, at: e.target.value }))}
                     className="num w-full rounded-sm border border-hair bg-transparent px-2 py-2 text-sm text-paper" />
            </Field>
          </div>
          <Field id="act-summary" label={t('What was said or agreed')}>
            <Textarea id="act-summary" data-autofocus maxLength={4000} rows={3} value={form.summary}
                      onChange={(e) => setForm((p) => ({ ...p, summary: e.target.value }))} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button size="sm" onClick={() => { setOpen(false); setError(null); }}>{t('Cancel')}</Button>
            <Button size="sm" variant="primary" onClick={submit} disabled={busy || !form.summary.trim()}>{t('Save')}</Button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="border-b border-hairline px-4 py-2 text-xs text-danger">{error}</p>}
      {log.state === 'ready' && log.rows.length === 0 && !open && (
        <p className="px-4 py-3 text-xs text-haze">{t('Nothing logged yet. A call, an e-mail or a meeting takes two clicks.')}</p>
      )}
      {log.state === 'error' && (
        <p className="px-4 py-3 text-xs text-haze">{t('The activity log could not be read.')}</p>
      )}
      <ul className="grid">
        {log.rows.map((r) => (
          <li key={r.id} className="border-b border-hairline px-4 py-2.5 last:border-0" data-interaction={r.kind}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-[12px]"><Badge tone="neutral">{t(INTERACTION_LABEL[r.kind])}</Badge> <span className="t-note">{formatWhen(r.occurred_at)}{r.author ? ` · ${r.author.full_name || r.author.email}` : ''}</span></span>
              {mayEdit && (
                <Button size="sm" variant="quiet" aria-label={t('Remove this entry')}
                        onClick={async () => {
                          if (!window.confirm(t('Remove this entry from the activity log?'))) return;
                          const p = await removeInteraction(r.id); setError(p); if (!p) setTick((n) => n + 1);
                        }}>
                  <Trash2 size={11} aria-hidden="true" />
                </Button>
              )}
            </div>
            <p className="mt-1 whitespace-pre-wrap break-words text-[13px] text-paper">{r.summary}</p>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react';
import { useAuth } from '@/features/auth/AuthProvider';
import { canAccess } from '@/lib/permissions';
import { useScope } from '@/lib/scope';
import {
  Button, DataState, ErrorState, Field, Input, Panel, SectionHeader, Select, Skeleton, Textarea, cn,
} from '@/components/ui';
import { intlLocale, t } from '@/lib/i18n';
import {
  addDays, mondayOf, parseHours, showHours, todayIso, useHoursMutations, useWeek, weekDays,
  type Person, type TimeEntry, type TimeProject,
} from '@/lib/hours';

/**
 * HOURS — who worked how many hours on which day, and on what.
 *
 * Everybody logs their own day (several lines are normal: 3 h on a project,
 * 2 h of administration) and sees everybody else's week. A line is on a
 * project — any project; its hours then show on that project — or on
 * "Other", described in a few words.
 */

const OTHER = '__other__';

export function HoursScreen() {
  const { profile } = useAuth();
  const { reloadToken } = useScope();
  const [tick, setTick] = useState(0);
  const [monday, setMonday] = useState(() => mondayOf(todayIso()));
  const week = useWeek(monday, reloadToken + tick);
  const ops = useHoursMutations(() => setTick((n) => n + 1));
  const [editing, setEditing] = useState<TimeEntry | null>(null);
  const [focus, setFocus] = useState<{ user: string; day: string } | null>(null);
  const isOwner = canAccess(profile, 'manage_projects');
  const days = weekDays(monday);
  const today = todayIso();

  const projectName = useMemo(() => new Map(week.projects.map((p) => [p.project_id, p])), [week.projects]);
  const what = (e: TimeEntry) => {
    if (e.project_id) {
      const p = projectName.get(e.project_id);
      return p ? `${p.project_name}${p.client_name ? ` · ${p.client_name}` : ''}` : t('A project');
    }
    return e.label ?? '—';
  };
  // People who log hours, plus anybody with a line this week who is not (any longer) an admin.
  const people = useMemo(() => {
    const known = new Map(week.people.map((p) => [p.id, p]));
    for (const e of week.entries) if (!known.has(e.user_id)) known.set(e.user_id, { id: e.user_id, full_name: null, email: '—', role: '' });
    return [...known.values()];
  }, [week.people, week.entries]);
  const sum = (user: string, day?: string) => week.entries
    .filter((e) => e.user_id === user && (!day || e.work_date === day)).reduce((n, e) => n + e.hours, 0);
  const name = (p: Person) => p.full_name || p.email;
  const dayLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(intlLocale('en-GB'), { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const shown = focus ? week.entries.filter((e) => e.user_id === focus.user && e.work_date === focus.day) : week.entries;

  return (
    <div className="grid gap-4">
      <EntryForm projects={week.projects} busy={ops.busy} onSave={(d) => ops.save(d)} />

      <Panel className="min-w-0" aria-label={t('Week')}>
        <SectionHeader
          title={t('Week of {date}', { date: dayLabel(monday) })}
          action={
            <span className="flex items-center gap-1">
              <Button size="sm" variant="quiet" aria-label={t('Previous week')} onClick={() => { setMonday(addDays(monday, -7)); setFocus(null); }}><ChevronLeft size={12} aria-hidden="true" /></Button>
              <Button size="sm" onClick={() => { setMonday(mondayOf(today)); setFocus(null); }} disabled={monday === mondayOf(today)}>{t('This week')}</Button>
              <Button size="sm" variant="quiet" aria-label={t('Next week')} onClick={() => { setMonday(addDays(monday, 7)); setFocus(null); }}><ChevronRight size={12} aria-hidden="true" /></Button>
            </span>
          }
        />
        {week.state === 'loading' && <div className="p-4"><Skeleton className="h-32 w-full" /></div>}
        {week.state === 'unconfigured' && <DataState kind="unconfigured" title={t('Not connected')} />}
        {week.state === 'error' && <ErrorState message={week.message} onRetry={week.reload} />}
        {week.state === 'ready' && (
          <div className="overflow-x-auto">
            <table className="m-stack w-full min-w-[720px] border-collapse text-[12px]" data-hours-week>
              <thead>
                <tr className="text-haze">
                  <th className="t-section px-4 py-2 text-left font-normal">{t('Person')}</th>
                  {days.map((d) => (
                    <th key={d} className={cn('t-section px-2 py-2 text-right font-normal', d === today && 'text-signal')}>{dayLabel(d)}</th>
                  ))}
                  <th className="t-section px-4 py-2 text-right font-normal">{t('Week')}</th>
                </tr>
              </thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.id} className="border-t border-hairline" data-person={p.id}>
                    <td className="px-4 py-2 text-[13px] text-paper">{name(p)}{p.id === profile?.id && <span className="t-note"> · {t('you')}</span>}</td>
                    {days.map((d) => {
                      const h = sum(p.id, d);
                      const on = focus?.user === p.id && focus.day === d;
                      return (
                        <td key={d} className="px-1 py-1 text-right">
                          <button type="button" disabled={h === 0} onClick={() => setFocus(on ? null : { user: p.id, day: d })}
                                  aria-pressed={on} aria-label={t('{person}, {day}: {hours} hours', { person: name(p), day: dayLabel(d), hours: showHours(h) })}
                                  className={cn('num w-full rounded-sm px-2 py-1.5 text-right',
                                    h === 0 ? 'text-haze/50' : 'text-paper hover:bg-flare', on && 'bg-flare')}>
                            {h === 0 ? '—' : showHours(h)}
                          </button>
                        </td>
                      );
                    })}
                    <td className="num px-4 py-2 text-right text-[13px] text-paper">{showHours(sum(p.id))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {week.state === 'ready' && (
        <Panel aria-label={t('Lines')}>
          <SectionHeader
            title={focus
              ? t('{person} — {day}', { person: name(people.find((p) => p.id === focus.user)!), day: dayLabel(focus.day) })
              : t('Every line this week')}
            note={String(shown.length)}
            action={focus ? <Button size="sm" variant="quiet" onClick={() => setFocus(null)}>{t('Show the whole week')}</Button> : undefined}
          />
          {shown.length === 0 && <p className="px-4 py-3 text-xs text-haze">{t('Nobody has logged hours this week yet.')}</p>}
          <ul className="grid">
            {shown.map((e) => {
              const mine = e.user_id === profile?.id;
              const person = people.find((p) => p.id === e.user_id);
              return (
                <li key={e.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-hairline px-4 py-2 last:border-0" data-entry={e.id}>
                  <span className="num w-12 shrink-0 text-right text-[13px] text-paper">{showHours(e.hours)} {t('h')}</span>
                  <span className="min-w-0 flex-1 text-[13px] text-paper">
                    {what(e)}
                    {e.note && <span className="t-note"> · {e.note}</span>}
                  </span>
                  <span className="t-note">{person ? name(person) : '—'} · {dayLabel(e.work_date)}</span>
                  {(mine || isOwner) && (
                    <span className="flex gap-1">
                      <Button size="sm" variant="quiet" aria-label={t('Edit this line')} onClick={() => setEditing(e)}><Pencil size={11} aria-hidden="true" /></Button>
                      <Button size="sm" variant="quiet" aria-label={t('Remove this line')} disabled={ops.busy}
                              onClick={async () => { if (window.confirm(t('Remove this line of hours?'))) await ops.remove(e.id); }}>
                        <Trash2 size={11} aria-hidden="true" />
                      </Button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </Panel>
      )}

      {editing && (
        <Panel aria-label={t('Edit this line')}>
          <SectionHeader title={t('Edit this line')} action={<Button size="sm" variant="quiet" onClick={() => setEditing(null)}>{t('Cancel')}</Button>} />
          <EntryForm projects={week.projects} busy={ops.busy} initial={editing} embedded
                     onSave={async (d) => { const p = await ops.save(d, editing.id); if (!p) setEditing(null); return p; }} />
        </Panel>
      )}
    </div>
  );
}

/** Log a line: the day, the hours, on what, a note. */
function EntryForm({ projects, busy, onSave, initial, embedded = false }: {
  projects: TimeProject[]; busy: boolean; onSave: (d: { work_date: string; hours: number; project_id: string | null; label: string | null; note: string | null }) => Promise<string | null>;
  initial?: TimeEntry; embedded?: boolean;
}) {
  const [form, setForm] = useState({
    day: initial?.work_date ?? todayIso(),
    hours: initial ? showHours(initial.hours) : '',
    on: initial ? (initial.project_id ?? OTHER) : '',
    label: initial?.label ?? '',
    note: initial?.note ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((p) => ({ ...p, [k]: e.target.value }));
  const open = projects.filter((p) => !p.closed);
  const closed = projects.filter((p) => p.closed);

  const submit = async () => {
    const h = parseHours(form.hours);
    if ('error' in h) return setError(h.error);
    if (!form.on) return setError(t('Choose a project, or Other.'));
    if (form.on === OTHER && !form.label.trim()) return setError(t('Write in a few words what it was.'));
    const problem = await onSave({
      work_date: form.day, hours: h.value,
      project_id: form.on === OTHER ? null : form.on, label: form.on === OTHER ? form.label : null, note: form.note,
    });
    setError(problem);
    if (!problem && !initial) setForm((p) => ({ ...p, hours: '', note: '', label: p.on === OTHER ? '' : p.label }));
  };

  const body = (
    <div className="grid gap-3 px-4 py-3">
      <div className="grid gap-3 sm:grid-cols-[10rem_7rem_minmax(0,1fr)]">
        <Field id={`hr-day${initial ? '-edit' : ''}`} label={t('Day')}>
          <Input id={`hr-day${initial ? '-edit' : ''}`} type="date" value={form.day} max={addDays(todayIso(), 1)} onChange={set('day')} />
        </Field>
        <Field id={`hr-hours${initial ? '-edit' : ''}`} label={t('Hours')}>
          <Input id={`hr-hours${initial ? '-edit' : ''}`} inputMode="decimal" placeholder="6.5" value={form.hours} onChange={set('hours')} />
        </Field>
        <Field id={`hr-on${initial ? '-edit' : ''}`} label={t('On')}>
          <Select id={`hr-on${initial ? '-edit' : ''}`} className="w-full py-2.5 text-sm" value={form.on} onChange={set('on')}>
            <option value="">{t('Choose…')}</option>
            {open.length > 0 && (
              <optgroup label={t('Projects')}>
                {open.map((p) => <option key={p.project_id} value={p.project_id}>{p.project_name}{p.client_name ? ` · ${p.client_name}` : ''}</option>)}
              </optgroup>
            )}
            {closed.length > 0 && (
              <optgroup label={t('Closed projects')}>
                {closed.map((p) => <option key={p.project_id} value={p.project_id}>{p.project_name}{p.client_name ? ` · ${p.client_name}` : ''}</option>)}
              </optgroup>
            )}
            <option value={OTHER}>{t('Other — write what it was')}</option>
          </Select>
        </Field>
      </div>
      {form.on === OTHER && (
        <Field id={`hr-label${initial ? '-edit' : ''}`} label={t('What was it?')}>
          <Input id={`hr-label${initial ? '-edit' : ''}`} maxLength={120} placeholder={t('e.g. Administration, sales calls, learning')} value={form.label} onChange={set('label')} />
        </Field>
      )}
      <Field id={`hr-note${initial ? '-edit' : ''}`} label={t('Note (optional)')}>
        <Textarea id={`hr-note${initial ? '-edit' : ''}`} rows={2} maxLength={1000} value={form.note} onChange={set('note')} />
      </Field>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {error ? <p role="alert" className="text-xs text-danger">{error}</p> : <span className="t-note">{t('Several lines a day are fine — one per thing worked on.')}</span>}
        <Button size="sm" variant="primary" onClick={submit} disabled={busy}>
          {initial ? t('Save') : <><Plus size={11} aria-hidden="true" /> {t('Log hours')}</>}
        </Button>
      </div>
    </div>
  );

  return embedded ? body : <Panel aria-label={t('Log hours')}><SectionHeader title={t('Log hours')} />{body}</Panel>;
}

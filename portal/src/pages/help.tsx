import { useMemo, useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import {
  Badge, Button, DataState, Dialog, ErrorState, Field, Input, Panel, SectionHeader, Select, Skeleton, Textarea, cn,
} from '@/components/ui';
import { useScope } from '@/lib/scope';
import { useClientViewMutations, useHelpArticlesOwner, type OwnerHelpArticle } from '@/lib/clientView';
import { HelpChat } from '@/features/client/HelpChat';
import { LANG_NAMES, t } from '@/lib/i18n';
import type { HelpTranslation } from '@/lib/helpMatcher';

/**
 * THE HELP CENTRE — the knowledge base the client assistant answers from.
 *
 * Owner-only. Clients receive only `published` articles, through
 * client_help_articles(), without the source and the review note. A draft is
 * never shown to a client. Nothing is deleted: set an article back to draft.
 */
export function HelpCentreScreen() {
  const { reloadToken } = useScope();
  const [tick, setTick] = useState(0);
  const list = useHelpArticlesOwner(reloadToken + tick);
  const ops = useClientViewMutations(() => setTick((n) => n + 1));
  const [editing, setEditing] = useState<Partial<OwnerHelpArticle> | null>(null);
  const [status, setStatus] = useState<'all' | 'published' | 'draft'>('all');
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  const shown = useMemo(() => list.rows.filter((a) => (status === 'all' || a.status === status)
    && (!query.trim() || `${a.question} ${a.answer} ${a.topic}`.toLowerCase().includes(query.trim().toLowerCase()))), [list.rows, status, query]);
  const topics = useMemo(() => [...new Set(list.rows.map((a) => a.topic))], [list.rows]);
  const drafts = list.rows.filter((a) => a.status === 'draft');
  const published = list.rows.filter((a) => a.status === 'published')
    .map((a) => ({ article_id: a.id, question: a.question, answer: a.answer, topic: a.topic, alt_questions: a.alt_questions, translations: a.translations }));
  const untranslated = list.rows.filter((a) => a.status === 'published' && (!a.translations?.en || !a.translations?.de)).length;

  return (
    <div className="grid gap-4">
      <Panel>
        <SectionHeader title={t('Help centre')} note={t('{published} published · {drafts} draft', { published: published.length, drafts: drafts.length })}
          action={<Button size="sm" variant="primary" onClick={() => setEditing({ status: 'draft', alt_questions: [] })}><Plus size={11} aria-hidden="true" /> {t('Article')}</Button>} />
        {untranslated > 0 && (
          <p className="border-b border-hairline px-4 py-2 text-xs text-signal" data-help-untranslated>
            {t(untranslated === 1
              ? '{n} published article has no English or German text yet — clients who chose those languages see it in Hungarian.'
              : '{n} published articles have no English or German text yet — clients who chose those languages see them in Hungarian.', { n: untranslated })}
          </p>
        )}
        <p className="t-note border-b border-hairline px-4 py-2">
          {t('Clients see only published articles. A draft waits for your decision — its review note says which. Only publish what describes how things actually work; no promise of revision rounds, response times, guarantees or fees without a decision behind it.')}
        </p>
        <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-4 py-2">
          <label htmlFor="help-status" className="sr-only">{t('Status')}</label>
          <Select id="help-status" value={status} onChange={(e) => setStatus(e.target.value as never)}>
            <option value="all">{t('All')}</option><option value="published">{t('Published')}</option><option value="draft">{t('Drafts ({n})', { n: drafts.length })}</option>
          </Select>
          <Input type="search" aria-label={t('Search articles')} placeholder={t('Search…')} value={query} onChange={(e) => setQuery(e.target.value)} className="h-7 w-56 py-1 text-xs" />
        </div>
        {list.state === 'loading' && <div className="p-4"><Skeleton className="h-24 w-full" /></div>}
        {list.state === 'error' && <ErrorState message={list.message} onRetry={list.reload} />}
        {list.state === 'ready' && shown.length === 0 && <DataState kind="empty" title={t('No article')} />}
        <ul className="grid">
          {shown.map((a) => (
            <li key={a.id} className="flex flex-wrap items-start justify-between gap-2 border-b border-hairline px-4 py-3 last:border-0" data-article={a.slug ?? a.id}>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] text-paper">
                  {a.question} <Badge tone={a.status === 'published' ? 'good' : 'warn'}>{a.status === 'published' ? t('Published') : t('Draft')}</Badge>{' '}
                  {(['en', 'de'] as const).map((l) => (
                    <span key={l} className={cn('ml-1 font-data text-[10px] uppercase', a.translations?.[l] ? 'text-haze' : 'text-signal line-through')}
                          title={a.translations?.[l] ? t('Text in {language}', { language: LANG_NAMES[l] }) : t('No text in {language} — shown in Hungarian', { language: LANG_NAMES[l] })}>
                      {l}
                    </span>
                  ))}
                </p>
                <p className="t-note">{a.topic}{a.source ? ` · ${a.source}` : ''}</p>
                {a.review_note && <p className="mt-1 text-xs text-signal">{a.review_note}</p>}
                <p className="mt-1 line-clamp-2 text-[12px] text-haze">{a.answer}</p>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button size="sm" variant="quiet" disabled={ops.busy === a.id}
                        onClick={async () => setError(await ops.save('help_articles', { status: a.status === 'published' ? 'draft' : 'published' }, a.id))}>
                  {a.status === 'published' ? t('Unpublish') : t('Publish')}
                </Button>
                <Button size="sm" variant="quiet" aria-label={t('Edit {title}', { title: a.question })} onClick={() => setEditing(a)}><Pencil size={11} aria-hidden="true" /></Button>
              </div>
            </li>
          ))}
        </ul>
        {error && <p role="alert" className="px-4 py-2 text-xs text-danger">{error}</p>}
      </Panel>

      <Panel>
        <SectionHeader title={t('Try the assistant')} note={t('published articles only — exactly what a client gets')} />
        <div className="px-4 py-3"><HelpChat articles={published} label="Try" /></div>
      </Panel>

      {editing && (
        <ArticleDialog initial={editing} topics={topics} busy={ops.busy !== null} onClose={() => setEditing(null)}
          onSave={async (row) => {
            const problem = await ops.save('help_articles', editing.id ? row : { ...row, position: (list.rows.at(-1)?.position ?? 0) + 10 }, editing.id);
            if (!problem) setEditing(null);
            return problem;
          }} />
      )}
    </div>
  );
}

function ArticleDialog({ initial, topics, busy, onClose, onSave }: {
  initial: Partial<OwnerHelpArticle>; topics: string[]; busy: boolean; onClose: () => void;
  onSave: (row: Record<string, unknown>) => Promise<string | null>;
}) {
  const [form, setForm] = useState({
    question: initial.question ?? '', answer: initial.answer ?? '', topic: initial.topic ?? '',
    alts: (initial.alt_questions ?? []).join('\n'), source: initial.source ?? '', status: initial.status ?? 'draft', review: initial.review_note ?? '',
  });
  // English and German: optional; an empty language shows the Hungarian text.
  const blank = (x?: HelpTranslation) => ({
    question: x?.question ?? '', answer: x?.answer ?? '', topic: x?.topic ?? '', alts: (x?.alt_questions ?? []).join('\n'),
  });
  const [tr, setTr] = useState({ en: blank(initial.translations?.en), de: blank(initial.translations?.de) });
  const setTrField = (lang: 'en' | 'de', key: keyof ReturnType<typeof blank>) => (e: { target: { value: string } }) =>
    setTr((p) => ({ ...p, [lang]: { ...p[lang], [key]: e.target.value } }));
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (form.question.trim().length < 3) return setError(t('Write the question.'));
    if (!form.answer.trim()) return setError(t('Write the answer.'));
    if (!form.topic.trim()) return setError(t('Choose or type a topic.'));
    const alts = form.alts.split('\n').map((x) => x.trim()).filter(Boolean);
    if (alts.length > 40) return setError(t('At most 40 alternative phrasings.'));
    const translations: Record<string, HelpTranslation> = {};
    for (const lang of ['en', 'de'] as const) {
      const x = tr[lang];
      if (![x.question, x.answer, x.topic, x.alts].some((v) => v.trim())) continue;
      const name = LANG_NAMES[lang];
      if (x.question.trim().length < 3) return setError(t('{language}: write the question, or leave the whole language empty.', { language: name }));
      if (!x.answer.trim()) return setError(t('{language}: write the answer, or leave the whole language empty.', { language: name }));
      if (!x.topic.trim()) return setError(t('{language}: write the topic, or leave the whole language empty.', { language: name }));
      const xAlts = x.alts.split('\n').map((v) => v.trim()).filter(Boolean);
      if (xAlts.length > 40) return setError(t('At most 40 alternative phrasings.'));
      translations[lang] = { question: x.question.trim(), answer: x.answer.trim(), topic: x.topic.trim(), alt_questions: xAlts };
    }
    setError(await onSave({
      question: form.question.trim(), answer: form.answer.trim(), topic: form.topic.trim(), alt_questions: alts,
      source: form.source.trim() || null, status: form.status, review_note: form.review.trim() || null, translations,
    }));
  };
  return (
    <Dialog open wide onClose={onClose} title={initial.id ? t('Edit article') : t('New article')}
            description={t('Hungarian first, as the client reads it. English and German are shown to clients who chose those languages; left empty, they see the Hungarian.')}
            footer={<><Button size="sm" onClick={onClose}>{t('Cancel')}</Button><Button size="sm" variant="primary" onClick={submit} disabled={busy}>{t('Save')}</Button></>}>
      <div className="grid gap-3">
        <Field id="ha-question" label={t('Question')}><Input id="ha-question" data-autofocus maxLength={300} value={form.question} onChange={(e) => setForm((p) => ({ ...p, question: e.target.value }))} /></Field>
        <Field id="ha-answer" label={t('Answer')}><Textarea id="ha-answer" maxLength={4000} rows={6} value={form.answer} onChange={(e) => setForm((p) => ({ ...p, answer: e.target.value }))} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="ha-topic" label={t('Topic')}>
            <Input id="ha-topic" list="ha-topics" maxLength={80} value={form.topic} onChange={(e) => setForm((p) => ({ ...p, topic: e.target.value }))} />
          </Field>
          <Field id="ha-status" label={t('Status')}>
            <Select id="ha-status" className="w-full py-2.5 text-sm" value={form.status} onChange={(e) => setForm((p) => ({ ...p, status: e.target.value as never }))}>
              <option value="draft">{t('Draft — clients never see it')}</option><option value="published">{t('Published')}</option>
            </Select>
          </Field>
        </div>
        <datalist id="ha-topics">{topics.map((t) => <option key={t} value={t} />)}</datalist>
        <Field id="ha-alts" label={t('Other ways a client may ask (one per line)')} hint={t('Helps the assistant find this answer.')}>
          <Textarea id="ha-alts" rows={4} value={form.alts} onChange={(e) => setForm((p) => ({ ...p, alts: e.target.value }))} />
        </Field>
        {(['en', 'de'] as const).map((lang) => (
          <fieldset key={lang} className="grid gap-2 rounded-sm border border-hairline px-3 py-2.5" lang={lang} data-translation={lang}>
            <legend className="t-section px-1">{LANG_NAMES[lang]}</legend>
            <Field id={`ha-${lang}-question`} label={t('Question')}>
              <Input id={`ha-${lang}-question`} maxLength={300} value={tr[lang].question} onChange={setTrField(lang, 'question')} />
            </Field>
            <Field id={`ha-${lang}-answer`} label={t('Answer')}>
              <Textarea id={`ha-${lang}-answer`} maxLength={4000} rows={4} value={tr[lang].answer} onChange={setTrField(lang, 'answer')} />
            </Field>
            <div className="grid gap-2 sm:grid-cols-2">
              <Field id={`ha-${lang}-topic`} label={t('Topic')}>
                <Input id={`ha-${lang}-topic`} maxLength={80} value={tr[lang].topic} onChange={setTrField(lang, 'topic')} />
              </Field>
              <Field id={`ha-${lang}-alts`} label={t('Other ways to ask (one per line)')}>
                <Textarea id={`ha-${lang}-alts`} rows={2} value={tr[lang].alts} onChange={setTrField(lang, 'alts')} />
              </Field>
            </div>
          </fieldset>
        ))}
        <Field id="ha-source" label={t('Source or internal reference')}><Input id="ha-source" maxLength={500} value={form.source} onChange={(e) => setForm((p) => ({ ...p, source: e.target.value }))} /></Field>
        <Field id="ha-review" label={t('Review note (internal)')}><Textarea id="ha-review" maxLength={1000} value={form.review} onChange={(e) => setForm((p) => ({ ...p, review: e.target.value }))} /></Field>
        {error && <p role="alert" className={cn('text-xs text-danger')}>{error}</p>}
      </div>
    </Dialog>
  );
}

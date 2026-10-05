import { useMemo, useRef, useState, type FormEvent } from 'react';
import { Send } from 'lucide-react';
import { Button, Input, cn } from '@/components/ui';
import { buildIndex, reply, type HelpArticle, type HelpReply } from '@/lib/helpMatcher';
import { getLang, t } from '@/lib/i18n';

/**
 * The client help assistant (Hungarian). Answers ONLY from the published
 * articles it is given; matching runs in the browser (lib/helpMatcher.ts).
 * No external service, nothing stored: the conversation is this component's
 * state and is gone on reload. It never claims to forward a message.
 */

type Turn = { id: number; from: 'client' | 'bot'; text?: string; reply?: HelpReply };

const TOUCH = 'max-sm:min-h-10';

export function HelpChat({ articles, label = 'Segítség' }: { articles: HelpArticle[]; label?: string }) {
  const index = useMemo(() => buildIndex(articles), [articles]);
  const topics = useMemo(() => [...new Set(articles.map((a) => a.topic))], [articles]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [topic, setTopic] = useState<string | null>(null);
  const seq = useRef(0);
  const log = useRef<HTMLOListElement>(null);

  const push = (t: Omit<Turn, 'id'>[]) => {
    setTurns((prev) => [...prev, ...t.map((x) => ({ ...x, id: (seq.current += 1) }))]);
    requestAnimationFrame(() => log.current?.lastElementChild?.scrollIntoView({ block: 'nearest' }));
  };
  const ask = (question: string) => {
    const q = question.trim();
    if (!q) return;
    push([{ from: 'client', text: q }, { from: 'bot', reply: reply(index, q) }]);
    setDraft('');
  };
  const choose = (a: HelpArticle) => push([
    { from: 'client', text: a.question },
    { from: 'bot', reply: { kind: 'answer', article: a, related: articles.filter((x) => x.topic === a.topic && x.article_id !== a.article_id).slice(0, 3), score: 1 } },
  ]);
  const submit = (e: FormEvent) => { e.preventDefault(); ask(draft); };

  const suggestions = (topic ? articles.filter((a) => a.topic === topic) : articles.filter((a) => a.topic.startsWith('Ügyfélportál'))).slice(0, 8);

  return (
    <div className="grid gap-3" data-help-chat>
      <p className="t-note">
        {t('Kérdezz szabadon, vagy válassz az alábbi témák közül. A válaszok a Stratos által jóváhagyott tudásbázisból jönnek. A beszélgetést nem mentjük és senkinek nem továbbítjuk; ha itt nincs válasz, keresd a Stratos kapcsolattartódat.')}
      </p>
      {(getLang() === 'en' || getLang() === 'de') && (
        <p className="t-note" data-help-language-note>{t('A súgócikkek és a válaszok magyar nyelvűek.')}</p>
      )}

      <div role="group" aria-label={t('Témák')} className="flex flex-wrap gap-1.5">
        {topics.map((t) => (
          <button key={t} type="button" onClick={() => setTopic(topic === t ? null : t)} aria-pressed={topic === t}
                  className={cn('rounded-sm border border-hairline px-2.5 py-1.5 text-[12px] focus-visible:outline-2 focus-visible:outline-signal',
                    TOUCH, topic === t ? 'bg-flare text-paper' : 'text-haze hover:text-paper')}>
            {t}
          </button>
        ))}
      </div>

      <div className="grid gap-1" aria-label={t('Javasolt kérdések')} role="group">
        {suggestions.map((a) => (
          <button key={a.article_id} type="button" onClick={() => choose(a)}
                  className={cn('rounded-sm px-2 py-1.5 text-left text-[13px] text-chrome underline-offset-4 hover:text-paper hover:underline focus-visible:outline-2 focus-visible:outline-signal', TOUCH)}>
            {a.question}
          </button>
        ))}
      </div>

      <ol ref={log} className="grid max-h-[26rem] gap-2 overflow-y-auto" aria-live="polite" aria-label={t('Beszélgetés')}>
        {turns.map((t) => (
          <li key={t.id} className={cn('max-w-[46rem] rounded-sm border px-3 py-2 text-[13px]',
            t.from === 'client' ? 'justify-self-end border-hairline bg-flare text-paper' : 'border-hairline bg-deck text-paper')}>
            {t.text && <p>{t.text}</p>}
            {t.reply && <BotReply reply={t.reply} onChoose={choose} onTopic={setTopic} />}
          </li>
        ))}
      </ol>

      <form onSubmit={submit} className="flex gap-2">
        <label htmlFor="help-question" className="sr-only">{t('Kérdésed')}</label>
        <Input id="help-question" value={draft} maxLength={300} placeholder={t('Például: Hol adhatom le a logót?')}
               onChange={(e) => setDraft(e.target.value)} className={TOUCH} autoComplete="off" />
        <Button type="submit" size="sm" variant="primary" className={TOUCH} disabled={!draft.trim()}>
          <Send size={11} aria-hidden="true" /> {label === 'Segítség' ? t('Kérdezem') : t('Ask')}
        </Button>
      </form>
    </div>
  );
}

function BotReply({ reply: r, onChoose, onTopic }: { reply: HelpReply; onChoose: (a: HelpArticle) => void; onTopic: (t: string) => void }) {
  if (r.kind === 'answer') {
    return (
      <div className="grid gap-2" data-reply="answer">
        <p className="font-medium">{r.article.question}</p>
        <p className="whitespace-pre-line text-haze">{r.article.answer}</p>
        {r.related.length > 0 && (
          <div className="grid gap-0.5">
            <p className="t-note">{t('Kapcsolódó kérdések:')}</p>
            {r.related.map((a) => (
              <button key={a.article_id} type="button" className="text-left text-[12px] text-chrome underline underline-offset-4 hover:text-paper" onClick={() => onChoose(a)}>
                {a.question}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }
  if (r.kind === 'clarify') {
    return (
      <div className="grid gap-1" data-reply="clarify">
        <p>{t('Nem vagyok biztos benne, mire gondolsz. Ezek közül valamelyik?')}</p>
        {r.options.map((a) => (
          <button key={a.article_id} type="button" className="text-left text-[13px] text-chrome underline underline-offset-4 hover:text-paper" onClick={() => onChoose(a)}>
            {a.question}
          </button>
        ))}
        <p className="t-note">{t('Ha egyik sem, fogalmazd meg másképp, vagy keresd a Stratos kapcsolattartódat.')}</p>
      </div>
    );
  }
  return (
    <div className="grid gap-1" data-reply="unknown">
      <p>{t('Erre a kérdésre nincs kész válaszom. Nem találgatok: projektállapotról, határidőről vagy fizetésről itt nem tudok nyilatkozni.')}</p>
      <p className="t-note">{t('Ezekben a témákban tudok segíteni:')}</p>
      <div className="flex flex-wrap gap-1">
        {r.topics.map((t) => (
          <button key={t} type="button" className="rounded-sm border border-hairline px-2 py-1 text-[12px] text-haze hover:text-paper" onClick={() => onTopic(t)}>{t}</button>
        ))}
      </div>
      <p className="t-note">{t('Ha ezek egyike sem segít, keresd a Stratos kapcsolattartódat. Ez a felület nem küld üzenetet.')}</p>
    </div>
  );
}

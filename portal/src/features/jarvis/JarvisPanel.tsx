import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useLocation } from 'react-router-dom';
import { Check, ChevronRight, ClipboardCheck, History, LoaderCircle, Plus, Send, Sparkles, Square, TriangleAlert, X } from 'lucide-react';
import { Button, Textarea, cn } from '@/components/ui';
import {
  ENTITY_LABEL, JarvisError, describeInput, entityFromPath, errorText, listPending, listThreads, loadThread, resume, send,
  type ActionState, type JarvisEvent, type ThreadSummary, type ToolPart, type Turn,
} from '@/lib/jarvis';
import { getLang, t } from '@/lib/i18n';
import { Markdown } from './Markdown';
import { ActionCard } from './ActionCard';

/**
 * The Jarvis panel (supabase/JARVIS.md, phase 4).
 *
 * On a desk it is a column on the right, over the page and NOT modal: the
 * record it is talking about stays readable and clickable beside it. On a
 * phone it is the whole screen. It knows where you are — the route, and the
 * record when the screen is one (lead, deal, client, project) — and sends that
 * with every message; the server describes the record to Jarvis.
 *
 * It stays mounted once opened, so closing and reopening (Cmd/Ctrl+J, from
 * any screen) comes back to the same conversation. Conversations themselves
 * are the database's: History lists them, and opening one reads it back.
 *
 * Jarvis's answers are drawn by <Markdown>, which makes React elements and
 * never HTML. Tool calls are rows — what was asked, and how it went — and a
 * write is a card (<ActionCard>): done with Undo, or waiting for approval.
 * "Waiting" lists every write that waits, across conversations.
 */

type Retry = { kind: 'resume'; threadId: string } | { kind: 'resend'; message: string };

let seq = 0;
const nextId = () => `live-${(seq += 1)}`;

export function JarvisPanel({ open, onClose, pending = 0, onPendingChange }: {
  open: boolean; onClose: () => void; pending?: number; onPendingChange?: () => void;
}) {
  const location = useLocation();
  const entity = entityFromPath(location.pathname);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState<Retry | null>(null);
  const [view, setView] = useState<'chat' | 'history' | 'pending'>('chat');
  const [threads, setThreads] = useState<ThreadSummary[] | null>(null);
  const [waiting, setWaiting] = useState<ActionState[] | null>(null);
  const [waitingError, setWaitingError] = useState(false);
  const [historyError, setHistoryError] = useState(false);
  const [mobile, setMobile] = useState(() => !window.matchMedia('(min-width: 1024px)').matches);
  const input = useRef<HTMLTextAreaElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const abort = useRef<AbortController | null>(null);
  const pinned = useRef(true);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const on = () => setMobile(!mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  // Opening puts the cursor where the question goes. On a phone the panel is
  // the screen, so the page behind must not scroll.
  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => input.current?.focus());
    if (!mobile) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open, mobile]);

  // Follow the answer as it is written, unless the reader scrolled up.
  useEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [turns]);
  const onScroll = () => {
    const el = scroller.current;
    if (el) pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };

  /** Applies one server event to the answer being written (always the last turn). */
  const apply = useCallback((e: JarvisEvent) => {
    if (e.event === 'thread') { setThreadId(e.data.id); return; }
    if (e.event === 'action') {
      setTurns((prev) => withAction(prev, e.data.tool_use_id, e.data.action));
      if (e.data.action.status === 'pending') onPendingChange?.();
      return;
    }
    setTurns((prev) => {
      const turns = [...prev];
      if (e.event === 'notice') {
        const at = turns.length - 1;
        turns.splice(at, 0, { kind: 'notice', id: nextId(), text: e.data.text, tone: 'warn' });
        return turns;
      }
      const last = turns[turns.length - 1];
      if (!last || last.kind !== 'assistant') return prev;
      const parts = [...last.parts];
      if (e.event === 'step') {
        parts.push({ type: 'text', step: e.data.n, text: '' });
      } else if (e.event === 'text') {
        const i = parts.length - 1;
        const p = parts[i];
        if (p?.type === 'text') parts[i] = { ...p, text: p.text + e.data.delta };
        else parts.push({ type: 'text', step: 0, text: e.data.delta });
      } else if (e.event === 'discard') {
        for (let i = parts.length - 1; i >= 0; i -= 1) {
          const p = parts[i];
          if (p.type === 'text' && p.step === e.data.n) parts[i] = { ...p, text: '' };
        }
      } else if (e.event === 'tool') {
        const i = parts.findIndex((p) => p.type === 'tool' && p.id === e.data.id);
        const before = i >= 0 ? (parts[i] as ToolPart) : null;
        const part: ToolPart = {
          type: 'tool', id: e.data.id, name: e.data.name, status: e.data.status,
          label: e.data.label ?? before?.label ?? e.data.name, input: e.data.input ?? before?.input ?? null,
        };
        if (i >= 0) parts[i] = part; else parts.push(part);
      } else if (e.event === 'refusal') {
        turns[turns.length - 1] = { ...last, parts, refusal: true };
        return turns;
      } else if (e.event === 'done') {
        turns[turns.length - 1] = { ...last, parts, model: e.data.model };
        return turns;
      }
      turns[turns.length - 1] = { ...last, parts };
      return turns;
    });
  }, []);

  const run = async (job: (signal: AbortSignal) => Promise<string>, onFail: (code: string, started: boolean) => Retry) => {
    setBusy(true);
    setRetry(null);
    pinned.current = true;
    const controller = new AbortController();
    abort.current = controller;
    try {
      const id = await job(controller.signal);
      if (id) setThreadId(id);
      setThreads(null);
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return;
      const err = e instanceof JarvisError ? e : new JarvisError('ERROR', false);
      setTurns((prev) => [...prev, { kind: 'notice', id: nextId(), text: errorText(err.code), tone: 'danger' }]);
      setRetry(onFail(err.code, err.started));
    } finally {
      abort.current = null;
      setBusy(false);
    }
  };

  const ask = (text: string) => {
    const message = text.trim();
    if (!message || busy) return;
    setView('chat');
    setDraft('');
    setTurns((prev) => [...prev, { kind: 'user', id: nextId(), text: message }, { kind: 'assistant', id: nextId(), parts: [] }]);
    let known = threadId;
    void run(
      (signal) => send({ message, threadId, route: `/portal${location.pathname}`, entity }, (e) => {
        if (e.event === 'thread') known = e.data.id;
        apply(e);
      }, signal),
      (_code, started) => (started && known ? { kind: 'resume', threadId: known } : { kind: 'resend', message }),
    );
  };

  const again = () => {
    if (!retry || busy) return;
    if (retry.kind === 'resend') {
      // Nothing was stored: the failed turn (question, empty answer, error) goes, and the question is asked again.
      setTurns((prev) => prev.slice(0, -3));
      ask(retry.message);
      return;
    }
    const id = retry.threadId;
    setTurns((prev) => [...prev, { kind: 'assistant', id: nextId(), parts: [] }]);
    void run((signal) => resume(id, apply, signal), () => ({ kind: 'resume', threadId: id }));
  };

  const stop = () => abort.current?.abort();

  const fresh = () => {
    stop();
    setTurns([]);
    setThreadId(null);
    setRetry(null);
    setView('chat');
    requestAnimationFrame(() => input.current?.focus());
  };

  /** A card changed (approved, rejected, undone): the conversation, the Waiting list and the count follow. */
  const onAction = (toolUseId: string | null, a: ActionState) => {
    if (toolUseId) setTurns((prev) => withAction(prev, toolUseId, a));
    else setTurns((prev) => prev.map((turn) => (turn.kind !== 'assistant' ? turn : {
      ...turn, parts: turn.parts.map((p) => (p.type === 'tool' && p.action?.id === a.id ? { ...p, action: a } : p)),
    })));
    setWaiting((list) => list && list.map((x) => (x.id === a.id ? a : x)));
    onPendingChange?.();
  };

  const showPending = async () => {
    if (view === 'pending') { setView('chat'); return; }
    setView('pending');
    setWaitingError(false);
    setWaiting(null);
    try { setWaiting(await listPending()); } catch { setWaitingError(true); }
  };

  const showHistory = async () => {
    if (view === 'history') { setView('chat'); return; }
    setView('history');
    setHistoryError(false);
    try { setThreads(await listThreads()); } catch { setHistoryError(true); }
  };

  const openThread = async (id: string) => {
    stop();
    setView('chat');
    setRetry(null);
    setThreadId(id);
    setTurns([]);
    try { setTurns(await loadThread(id)); } catch {
      setTurns([{ kind: 'notice', id: nextId(), text: errorText('THREAD'), tone: 'danger' }]);
    }
    requestAnimationFrame(() => input.current?.focus());
  };

  const submit = (e: FormEvent) => { e.preventDefault(); ask(draft); };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); ask(draft); }
  };
  const onPanelKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
  };

  const suggestions = [
    ...(entity ? [t('What do we know about this?')] : []),
    t('What needs my attention today?'),
    t('Where does the pipeline stand?'),
    t('Which payments are overdue?'),
  ];

  return (
    <div
      id="jarvis-panel"
      role="dialog"
      aria-modal={mobile}
      aria-labelledby="jarvis-title"
      hidden={!open}
      onKeyDown={onPanelKey}
      data-jarvis-panel
      // `hidden` alone would lose to the display utility below; the class decides.
      className={cn('fixed inset-0 z-40 flex-col bg-deck lg:left-auto lg:w-[420px] lg:border-l lg:border-hair lg:shadow-panel', open ? 'flex' : 'hidden')}
    >
      <header className="flex items-center gap-2 border-b border-hairline px-3 py-2.5">
        <Sparkles size={14} strokeWidth={1.75} className="text-signal" aria-hidden="true" />
        <h2 id="jarvis-title" className="t-page">Jarvis</h2>
        {entity && (
          <span className="t-section truncate rounded-sm border border-hair px-1.5 py-0.5" title={t('Jarvis sees the record this screen shows.')} data-jarvis-context>
            {t('Context: {what}', { what: t(ENTITY_LABEL[entity.type]) })}
          </span>
        )}
        <div className="ml-auto flex items-center gap-0.5">
          <Button size="sm" variant="quiet" onClick={showPending} aria-pressed={view === 'pending'}
            aria-label={pending > 0 ? t('Waiting for approval: {n}', { n: pending }) : t('Waiting for approval')} data-jarvis-waiting>
            <ClipboardCheck size={13} aria-hidden="true" />
            {pending > 0 && <span className="num rounded-sm bg-signal px-1 text-[10px] leading-4 text-black">{pending}</span>}
          </Button>
          <Button size="sm" variant="quiet" onClick={showHistory} aria-pressed={view === 'history'} aria-label={t('Conversations')}>
            <History size={13} aria-hidden="true" />
          </Button>
          <Button size="sm" variant="quiet" onClick={fresh} aria-label={t('New conversation')}>
            <Plus size={13} aria-hidden="true" />
          </Button>
          <Button size="sm" variant="quiet" onClick={onClose} aria-label={t('Close Jarvis')}>
            <X size={13} aria-hidden="true" />
          </Button>
        </div>
      </header>

      <div ref={scroller} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {view === 'pending' ? (
          <WaitingList actions={waiting} failed={waitingError} onChange={(a) => onAction(null, a)} onOpen={openThread} />
        ) : view === 'history' ? (
          <ThreadList threads={threads} failed={historyError} current={threadId} onOpen={openThread} />
        ) : turns.length === 0 ? (
          <div className="grid gap-4">
            <p className="text-[13px] leading-relaxed text-haze">
              {t('Ask about leads, deals, clients, projects, payments, meetings or hours. Jarvis answers from the Portal, with your access, and says when it has no data. It can also add notes, activities, tasks and hours, change a lead\'s status or a deal, and create leads and deals: each shows here as a card you can undo. It does not delete, send e-mails or invite anyone.')}
            </p>
            <div className="grid gap-1.5" role="group" aria-label={t('Suggested questions')}>
              {suggestions.map((s) => (
                <button key={s} type="button" onClick={() => ask(s)}
                  className="rounded-sm border border-hair px-3 py-2 text-left text-[12px] text-paper transition-colors hover:bg-flare max-sm:min-h-10">
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <ol className="grid gap-5" aria-live="polite" aria-relevant="additions text" data-jarvis-log>
            {turns.map((turn, i) => (
              <TurnView key={turn.id} turn={turn} writing={busy && i === turns.length - 1} onAction={onAction} />
            ))}
          </ol>
        )}
        {retry && !busy && view === 'chat' && (
          <Button size="sm" className="mt-3" onClick={again} data-jarvis-retry>
            {retry.kind === 'resume' ? t('Continue') : t('Send again')}
          </Button>
        )}
      </div>

      <form onSubmit={submit} className="border-t border-hairline p-3">
        <label htmlFor="jarvis-input" className="sr-only">{t('Message to Jarvis')}</label>
        <Textarea
          id="jarvis-input"
          ref={input}
          rows={2}
          value={draft}
          maxLength={8000}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t('Ask Jarvis…')}
          className="min-h-0 resize-none py-2 text-[13px]"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <p className="t-note">{t('Enter to send · Shift+Enter for a new line')}</p>
          {busy ? (
            <Button size="sm" type="button" onClick={stop} data-jarvis-stop>
              <Square size={11} aria-hidden="true" /> {t('Stop')}
            </Button>
          ) : (
            <Button size="sm" variant="primary" type="submit" disabled={!draft.trim()}>
              <Send size={11} aria-hidden="true" /> {t('Send')}
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}

/* ================================================================ turns */

/** The turns with one tool call's write set to `a`. */
function withAction(turns: Turn[], toolUseId: string, a: ActionState): Turn[] {
  return turns.map((turn) => (turn.kind !== 'assistant' ? turn : {
    ...turn, parts: turn.parts.map((p) => (p.type === 'tool' && p.id === toolUseId ? { ...p, action: a } : p)),
  }));
}

function TurnView({ turn, writing, onAction }: { turn: Turn; writing: boolean; onAction: (toolUseId: string, a: ActionState) => void }) {
  if (turn.kind === 'user') {
    return (
      <li data-jarvis-turn="user">
        <p className="t-section mb-1">{t('You')}</p>
        <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-paper">{turn.text}</p>
      </li>
    );
  }
  if (turn.kind === 'notice') {
    return (
      <li role="status" data-jarvis-notice={turn.tone}
        className={cn('rounded-sm border px-3 py-2 text-[12px] leading-relaxed',
          turn.tone === 'danger' ? 'border-danger/40 text-danger' : 'border-signal/40 text-paper')}>
        {turn.text}
      </li>
    );
  }
  const visible = turn.parts.filter((p) => p.type === 'tool' || p.text.trim());
  // An answer that never began (the request failed first): the error below says so.
  if (visible.length === 0 && !writing && !turn.refusal) return null;
  return (
    <li data-jarvis-turn="assistant">
      <p className="t-section mb-1 text-signal">Jarvis</p>
      <div className="grid gap-2">
        {visible.map((p, i) => (p.type === 'tool'
          ? (p.action ? <ActionCard key={p.id} action={p.action} onChange={(a) => onAction(p.id, a)} /> : <ToolRow key={p.id} part={p} />)
          : <Markdown key={`t${i}`} text={p.text} />))}
        {turn.refusal && <p className="text-[12px] text-haze">{t('Jarvis did not answer this question.')}</p>}
        {writing && (
          <p className="t-meta flex items-center gap-1.5" data-jarvis-writing>
            <LoaderCircle size={11} className="motion-safe:animate-spin" aria-hidden="true" />
            {t('Working…')}
          </p>
        )}
      </div>
    </li>
  );
}

function ToolRow({ part }: { part: ToolPart }) {
  const params = describeInput(part.input);
  const icon = part.status === 'running'
    ? <LoaderCircle size={11} className="shrink-0 motion-safe:animate-spin" aria-hidden="true" />
    : part.status === 'error'
      ? <TriangleAlert size={11} className="shrink-0 text-danger" aria-hidden="true" />
      : <Check size={11} className="shrink-0 text-good" aria-hidden="true" />;
  const status = part.status === 'running' ? t('running') : part.status === 'error' ? t('failed') : t('done');
  const line = (
    <span className="flex min-w-0 items-center gap-1.5">
      {icon}
      <span className="truncate">{part.label}</span>
      <span className="sr-only">({status})</span>
    </span>
  );
  if (params.length === 0) {
    return <div className="t-meta rounded-sm border border-hairline px-2 py-1" data-jarvis-tool={part.status}>{line}</div>;
  }
  return (
    <details className="group t-meta rounded-sm border border-hairline" data-jarvis-tool={part.status}>
      <summary className="flex cursor-pointer list-none items-center gap-1 px-2 py-1 hover:bg-flare [&::-webkit-details-marker]:hidden">
        <ChevronRight size={11} className="shrink-0 transition-transform group-open:rotate-90" aria-hidden="true" />
        {line}
      </summary>
      <ul className="grid gap-0.5 border-t border-hairline px-2 py-1.5">
        {params.map((p) => <li key={p} className="break-words">{p}</li>)}
      </ul>
    </details>
  );
}

/* ============================================================== waiting */

function WaitingList({ actions, failed, onChange, onOpen }: {
  actions: ActionState[] | null; failed: boolean; onChange: (a: ActionState) => void; onOpen: (threadId: string) => void;
}) {
  if (failed) return <p className="text-[12px] text-danger">{t('The waiting writes could not be read.')}</p>;
  if (!actions) return <p className="t-meta">{t('Loading…')}</p>;
  return (
    <div>
      <p className="t-section mb-2">{t('Waiting for approval')}</p>
      {actions.length === 0
        ? <p className="text-[12px] text-haze">{t('Nothing is waiting for approval.')}</p>
        : (
          <ul className="grid gap-3" data-jarvis-waiting-list>
            {actions.map((a) => (
              <li key={a.id} className="grid gap-1">
                <ActionCard action={a} onChange={onChange} />
                {a.thread_id && (
                  <button type="button" onClick={() => onOpen(a.thread_id as string)} className="t-meta justify-self-start underline-offset-2 hover:underline">
                    {t('Open the conversation')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
    </div>
  );
}

/* ============================================================== history */

function ThreadList({ threads, failed, current, onOpen }: {
  threads: ThreadSummary[] | null; failed: boolean; current: string | null; onOpen: (id: string) => void;
}) {
  if (failed) return <p className="text-[12px] text-danger">{t('The conversations could not be read.')}</p>;
  if (!threads) return <p className="t-meta">{t('Loading…')}</p>;
  if (threads.length === 0) return <p className="text-[12px] text-haze">{t('No conversations yet.')}</p>;
  const when = new Intl.DateTimeFormat(getLang() === 'en' ? 'en-GB' : getLang() === 'de' ? 'de-DE' : 'hu-HU', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Budapest',
  });
  return (
    <div>
      <p className="t-section mb-2">{t('Conversations')}</p>
      <ul className="grid gap-1" data-jarvis-threads>
        {threads.map((th) => (
          <li key={th.id}>
            <button type="button" onClick={() => onOpen(th.id)} aria-current={th.id === current ? 'true' : undefined}
              className={cn('grid w-full gap-0.5 rounded-sm border px-3 py-2 text-left transition-colors hover:bg-flare max-sm:min-h-10',
                th.id === current ? 'border-signal/50' : 'border-hair')}>
              <span className="truncate text-[12px] text-paper">{th.title || t('Untitled conversation')}</span>
              <span className="t-meta">
                {when.format(new Date(th.updated_at))}
                {th.context_entity_type ? ` · ${t(ENTITY_LABEL[th.context_entity_type])}` : ''}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

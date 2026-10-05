import { ArrowDownLeft, ArrowUpRight, ExternalLink } from 'lucide-react';
import { useAuth } from '@/features/auth/AuthProvider';
import { Panel, SectionHeader } from '@/components/ui';
import { formatWhen } from '@/lib/leads';
import { useEmailHistory, type EmailTarget } from '@/lib/google';
import { t } from '@/lib/i18n';

/**
 * The e-mails exchanged with this lead, client or deal, from every connected
 * Google mailbox (20261017000100). Subject, addresses, date and Gmail's short
 * snippet — the message itself stays in Gmail, one click away for the person
 * whose mailbox it is.
 */
export function EmailHistory({ target, reloadToken = 0 }: { target: EmailTarget; reloadToken?: number }) {
  const { profile } = useAuth();
  const history = useEmailHistory(target, reloadToken);
  if (history.state === 'missing' || history.state === 'unconfigured') return null;
  return (
    <Panel aria-label={t('E-mails')}>
      <SectionHeader title={t('E-mails')} note={history.state === 'ready' ? String(history.rows.length) : undefined} />
      {history.state === 'error' && <p className="px-4 py-3 text-xs text-haze">{t('The e-mails could not be read.')}</p>}
      {history.state === 'ready' && history.rows.length === 0 && (
        <p className="px-4 py-3 text-xs text-haze">{t('No e-mail yet. Connect your Google account in Settings to see the messages exchanged with this address.')}</p>
      )}
      <ul className="grid">
        {history.rows.map((m) => (
          <li key={m.id} className="grid gap-0.5 border-b border-hairline px-4 py-2 text-[13px] last:border-0" data-email={m.direction}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="inline-flex min-w-0 items-center gap-1.5 text-paper">
                {m.direction === 'out'
                  ? <ArrowUpRight size={12} className="shrink-0 text-signal" aria-label={t('sent')} />
                  : <ArrowDownLeft size={12} className="shrink-0 text-good" aria-label={t('received')} />}
                <span className="truncate">{m.subject || t('(no subject)')}</span>
              </span>
              <span className="t-note shrink-0">{formatWhen(m.sent_at)}</span>
            </div>
            <p className="t-note truncate">
              {m.direction === 'out' ? t('to {who}', { who: m.to_emails.join(', ') }) : t('from {who}', { who: m.from_name || m.from_email })}
              {' · '}{t('mailbox: {who}', { who: m.mailbox?.full_name || m.mailbox?.email || '—' })}
            </p>
            {m.snippet && <p className="t-note line-clamp-2 text-haze">{m.snippet}</p>}
            {m.thread_id && m.mailbox_user_id === profile?.id && (
              <a href={`https://mail.google.com/mail/#all/${encodeURIComponent(m.thread_id)}`} target="_blank" rel="noopener noreferrer"
                 className="t-note inline-flex items-center gap-1 justify-self-start underline underline-offset-4 hover:text-paper">
                {t('Open in Gmail')} <ExternalLink size={10} aria-hidden="true" />
              </a>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

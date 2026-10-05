import { supabase, isConfigured } from '@/lib/supabase';
import { t } from '@/lib/i18n';

/**
 * Telling a client by e-mail (20261013000100_notifications.sql).
 *
 * The owner's Portal writes one row to `notification_outbox`; the sender
 * (netlify/functions/notify-dispatch.mjs) mails it within a minute, to the
 * clients the database names AT SEND TIME — an account that is active and
 * still has the project, and, when `accountIds` is given, one of those.
 *
 * A notification never undoes the action it is about: when writing it fails,
 * the action stands and the caller is told the client was NOT notified.
 */
export type ClientNotice =
  | 'document_shared' | 'demo_published' | 'meeting_scheduled' | 'meeting_changed'
  | 'meeting_cancelled' | 'reschedule_decided' | 'feedback_replied';

export async function notifyClient(kind: ClientNotice, projectId: string, payload: Record<string, unknown>, accountIds?: string[]): Promise<string | null> {
  if (!isConfigured) return null;
  const { error } = await supabase.from('notification_outbox').insert({
    audience: 'client', kind, project_id: projectId, payload, account_ids: accountIds && accountIds.length > 0 ? accountIds : null,
  });
  if (error) {
    console.error('[notify.client]', error.code);
    return t('Saved — but the client could not be notified by e-mail.');
  }
  return null;
}

/** A test message to the owner's own devices and inbox. */
export async function notifyOwnerTest(): Promise<string | null> {
  const { error } = await supabase.from('notification_outbox').insert({ audience: 'owner', kind: 'test', payload: {} });
  if (error) {
    console.error('[notify.test]', error.code);
    return t('The test could not be queued.');
  }
  return null;
}

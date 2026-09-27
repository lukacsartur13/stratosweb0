import { useCallback, useEffect, useState } from 'react';
import { supabase, isConfigured } from '@/lib/supabase';

/**
 * Client accounts and sharing — the OWNER's side (English, like the rest of the
 * staff Portal). Every table here is owner-only in the database
 * (20261001000100_client_portal.sql); the invite itself goes through
 * /api/portal-invite, the one place the server key creates an auth user.
 */

export interface ClientAccess { id: string; project_id: string; granted_at: string; revoked_at: string | null }
export interface ClientAccount {
  id: string;
  email: string;
  full_name: string;
  status: 'active' | 'revoked';
  user_id: string | null;
  contact_id: string | null;
  invite_count: number;
  last_invited_at: string | null;
  linked_at: string | null;
  first_seen_at: string | null;
  revoked_at: string | null;
  access: ClientAccess[];
}

const ACCOUNT_COLUMNS = 'id, email, full_name, status, user_id, contact_id, invite_count, last_invited_at, '
  + 'linked_at, first_seen_at, revoked_at, access:client_project_access(id, project_id, granted_at, revoked_at)';

export function useClientAccounts(organizationId: string | undefined, reloadToken = 0) {
  const [rows, setRows] = useState<ClientAccount[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'unconfigured'>(isConfigured ? 'loading' : 'unconfigured');
  const load = useCallback(async () => {
    if (!isConfigured || !organizationId) return;
    const { data, error } = await supabase.from('client_accounts').select(ACCOUNT_COLUMNS)
      .eq('organization_id', organizationId).order('created_at', { ascending: true });
    if (error) { console.error('[client_accounts]', error.code); setState('error'); return; }
    setRows((data ?? []) as unknown as ClientAccount[]);
    setState('ready');
  }, [organizationId, reloadToken]);
  useEffect(() => { void load(); }, [load]);
  return { rows, state, reload: load };
}

const INVITE_REFUSAL: Record<string, string> = {
  FORBIDDEN: 'Only the portal owner can invite clients.',
  UNAUTHENTICATED: 'Your session has ended. Sign in again.',
  INVITE_LIMIT: 'Too many invitations in the last hour. Try again later.',
  EMAIL_INVALID: 'That e-mail address is not valid.',
  EMAIL_IS_STAFF: 'That address belongs to a staff account. Its role is not changed, and it cannot be a client account.',
  OTHER_COMPANY: 'That address already belongs to another company\'s client account. It is not moved.',
  PROJECT_OTHER_COMPANY: 'One of the projects belongs to another company.',
  CONTACT_OTHER_COMPANY: 'That contact belongs to another company.',
  ACCOUNT_REVOKED: 'That account is revoked.',
  USER_MISMATCH: 'The sign-in account for that address could not be matched. Nothing was changed.',
  AMBIGUOUS: 'More than one sign-in account has that address. Resolve it in Supabase first.',
  PARTIAL: 'The sign-in account exists but is not linked yet. Try again — nothing will be duplicated, and no access is given until it is linked.',
  NOT_CONFIGURED: 'Invitations are not configured on this deployment (see supabase/CLIENT_PORTAL.md).',
  INVALID: 'A name, a valid e-mail address and the client are required.',
};

/**
 * Invite (or re-invite) a client account. Resolves to the one-time link, which
 * the caller shows once and forgets — it is not stored, logged or sent from here.
 */
export async function inviteClient(input: {
  organization_id: string; contact_id: string | null; full_name: string; email: string; project_ids: string[];
}): Promise<{ link: string; kind: 'invite' | 'recovery' } | { error: string }> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { error: INVITE_REFUSAL.UNAUTHENTICATED };
  try {
    const res = await fetch('/api/portal-invite', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(input),
    });
    const body = await res.json().catch(() => null) as { ok?: boolean; link?: string; kind?: 'invite' | 'recovery'; code?: string } | null;
    if (res.ok && body?.link) return { link: body.link, kind: body.kind ?? 'invite' };
    return { error: INVITE_REFUSAL[body?.code ?? ''] ?? 'The invitation could not be completed. Try again.' };
  } catch {
    return { error: 'The invitation service could not be reached. Try again.' };
  }
}

/* ============================================================ sharing == */

export interface AssignedAccount { account_id: string; full_name: string; email: string; linked: boolean }
export interface LiveShare { id: string; account_id: string; document_id: string | null; folder_id: string | null }

/** Who may be shared with in this project (live assignments), and what is shared now. */
export function useProjectSharing(projectId: string, reloadToken = 0) {
  const [accounts, setAccounts] = useState<AssignedAccount[]>([]);
  const [shares, setShares] = useState<LiveShare[]>([]);
  const [available, setAvailable] = useState(false);
  const load = useCallback(async () => {
    if (!isConfigured) return;
    const [a, s] = await Promise.all([
      supabase.from('client_project_access')
        .select('account_id, account:client_accounts(full_name, email, status, user_id)')
        .eq('project_id', projectId).is('revoked_at', null),
      supabase.from('document_shares').select('id, account_id, document_id, folder_id')
        .eq('project_id', projectId).is('revoked_at', null),
    ]);
    // Before 20261001000100 is applied these tables do not exist: sharing is
    // simply not offered, and the library works as before.
    if (a.error || s.error) { setAvailable(false); return; }
    setAvailable(true);
    setAccounts(((a.data ?? []) as unknown as { account_id: string; account: { full_name: string; email: string; status: string; user_id: string | null } | null }[])
      .filter((r) => r.account && r.account.status === 'active')
      .map((r) => ({ account_id: r.account_id, full_name: r.account!.full_name, email: r.account!.email, linked: Boolean(r.account!.user_id) })));
    setShares((s.data ?? []) as LiveShare[]);
  }, [projectId, reloadToken]);
  useEffect(() => { void load(); }, [load]);

  const refusal = (e: { message?: string; code?: string }) => (
    /share_not_assigned/.test(e.message ?? '') ? 'That client account is not assigned to this project.'
      : /share_not_shareable/.test(e.message ?? '') ? 'Only finished files outside the trash can be shared.'
        : e.code === '23505' ? 'Already shared.' : 'The share could not be changed. Try again.');

  return {
    available, accounts, shares, reload: load,
    async share(accountId: string, target: { document_id?: string; folder_id?: string }) {
      const { error } = await supabase.from('document_shares').insert({
        account_id: accountId, project_id: projectId, document_id: target.document_id ?? null, folder_id: target.folder_id ?? null,
      });
      if (error) { console.error('[document_shares.insert]', error.code); return refusal(error); }
      await load();
      return null;
    },
    async unshare(shareId: string) {
      const { error } = await supabase.from('document_shares').update({ revoked_at: new Date().toISOString() }).eq('id', shareId);
      if (error) { console.error('[document_shares.revoke]', error.code); return refusal(error); }
      await load();
      return null;
    },
  };
}

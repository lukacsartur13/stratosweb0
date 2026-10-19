import { useEffect, useRef, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import type { OAuthAuthorizationDetails } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/features/auth/AuthProvider';
import { AuthShell } from '@/features/auth/pages';
import { Button } from '@/components/ui';
import { t } from '@/lib/i18n';

/**
 * /portal/oauth/consent?authorization_id=…
 *
 * Where Supabase Auth's OAuth 2.1 server sends the owner when Claude — or any
 * other OAuth client — asks for access to the Portal: the "Authorization Path"
 * in Authentication → OAuth Server (supabase/CLAUDE_CONNECTOR.md). Approving
 * gives that client a token that acts as this account, through RLS, until the
 * grant is revoked. netlify/functions/portal-mcp.mjs serves the owner only, so
 * any other account is offered the refusal and nothing else.
 *
 * A request this account has already approved is not shown again: Supabase
 * answers with the redirect at once, and the page follows it.
 */

// Where Claude's OAuth callback lives (support.claude.com, "Building custom
// connectors via remote MCP servers"); claude.com is the announced successor.
const CLAUDE_HOSTS = new Set(['claude.ai', 'claude.com']);
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

const hostOf = (uri: string) => {
  try { return new URL(uri).hostname; } catch { return ''; }
};

type Phase =
  | { kind: 'loading' }
  | { kind: 'invalid' }
  | { kind: 'ask'; details: OAuthAuthorizationDetails }
  | { kind: 'leaving' };

export function OAuthConsentPage() {
  const { session, profile, loading } = useAuth();
  const location = useLocation();
  const id = new URLSearchParams(location.search).get('authorization_id');
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (!session || !id || started.current) return;
    started.current = true;
    void supabase.auth.oauth.getAuthorizationDetails(id).then(({ data, error: failed }) => {
      if (failed || !data) return setPhase({ kind: 'invalid' });
      if ('authorization_id' in data) return setPhase({ kind: 'ask', details: data });
      setPhase({ kind: 'leaving' });
      window.location.assign(data.redirect_url);
    }, () => setPhase({ kind: 'invalid' }));
  }, [session, id]);

  // Signed out: sign in first, and come back here with the same request.
  if (!loading && !session) {
    return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
  }

  if (!id || phase.kind === 'invalid') {
    return (
      <AuthShell title={t('This request is not valid')} lede={t('It has expired, has already been answered, or is incomplete.')}>
        <p className="text-sm text-haze">{t('Start the connection again from Claude.')}</p>
      </AuthShell>
    );
  }

  if (loading || phase.kind !== 'ask') {
    return (
      <AuthShell title={t('Checking…')} lede={t('One moment.')}>
        <p className="text-sm text-haze" aria-busy="true">{t('Reading the request.')}</p>
      </AuthShell>
    );
  }

  const { details } = phase;
  const name = details.client.name || t('An app');
  const host = hostOf(details.redirect_uri);
  const owner = profile?.is_owner === true;

  const decide = async (allow: boolean) => {
    setBusy(true);
    setError(null);
    const { data, error: failed } = allow
      ? await supabase.auth.oauth.approveAuthorization(details.authorization_id, { skipBrowserRedirect: true })
      : await supabase.auth.oauth.denyAuthorization(details.authorization_id, { skipBrowserRedirect: true });
    if (failed || !data?.redirect_url) {
      setBusy(false);
      setError(t('The answer could not be sent. Start the connection again from Claude.'));
      return;
    }
    setPhase({ kind: 'leaving' });
    window.location.assign(data.redirect_url);
  };

  return (
    <AuthShell title={t('Connect {name}', { name })} lede={t('{name} is asking to use the Portal as you.', { name })}>
      <dl className="mb-4 grid gap-2 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-haze">{t('Account')}</dt>
          <dd className="truncate text-paper">{details.user.email}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-haze">{t('Returns to')}</dt>
          <dd className="truncate font-data text-[12px] text-paper">{host || details.redirect_uri}</dd>
        </div>
      </dl>

      {owner ? (
        <p className="text-sm text-haze">
          {t('If you allow it, it can read and change everything this account reaches in the Portal — leads, clients, projects, payments, notes, hours, the newsletter — and run the Portal’s database functions. The database’s own rules still apply.')}
        </p>
      ) : (
        <p role="alert" className="rounded-sm border border-danger/30 bg-danger/5 p-2.5 text-xs text-danger">
          {t('Only the portal owner can connect an assistant. This account can only refuse.')}
        </p>
      )}

      {!CLAUDE_HOSTS.has(host) && (
        <p className="mt-3 rounded-sm border border-signal/30 bg-signal/5 p-2.5 text-xs text-haze">
          {LOCAL_HOSTS.has(host)
            ? t('This is an app on this computer, such as Claude Code. Allow it only if you started it yourself.')
            : t('This is not Claude’s address. Allow it only if you started this connection yourself.')}
        </p>
      )}

      {error && <p role="alert" className="mt-3 rounded-sm border border-danger/30 bg-danger/5 p-2.5 text-xs text-danger">{error}</p>}

      <div className="mt-5 grid gap-2">
        {owner && (
          <Button variant="primary" disabled={busy} onClick={() => void decide(true)}>
            {busy ? t('Sending…') : t('Allow')}
          </Button>
        )}
        <Button disabled={busy} onClick={() => void decide(false)}>{t('Deny')}</Button>
      </div>

      <p className="mt-4 text-xs text-haze">
        {t('To disconnect it later, remove the connector in Claude, then revoke the app in Supabase under Authentication → OAuth Apps.')}
      </p>
    </AuthShell>
  );
}

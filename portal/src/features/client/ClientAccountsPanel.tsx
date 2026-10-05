import { useState } from 'react';
import { Copy, Link2, UserPlus, X } from 'lucide-react';
import { Badge, Button, Dialog, Field, Input, Panel, SectionHeader, Select, cn } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { shortDate } from '@/lib/pipeline';
import { t } from '@/lib/i18n';
import { inviteClient, useClientAccounts, type ClientAccount } from '@/lib/clientAccounts';

/**
 * CLIENT ACCOUNTS — on a client's page, for the portal owner only.
 *
 * Invite by name and e-mail, bind to a contact and to projects, see who has
 * what, and take it back. The invitation is a link the owner sends by hand;
 * it is shown once, in a dialog, and forgotten when the dialog closes. The
 * owner never sees or sets a password.
 */
export function ClientAccountsPanel({
  clientId, contacts, projects,
}: {
  clientId: string;
  contacts: { id: string; name: string; email: string | null }[];
  projects: { id: string; name: string }[];
}) {
  const [tick, setTick] = useState(0);
  const accounts = useClientAccounts(clientId, tick);
  const reload = () => setTick((n) => n + 1);
  const [inviting, setInviting] = useState<Partial<ClientAccount> | null>(null);
  const [link, setLink] = useState<{ link: string; kind: string; email: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const projectName = (id: string) => projects.find((p) => p.id === id)?.name ?? t('A project');

  const act = async (op: PromiseLike<{ error: { code?: string } | null }>) => {
    const { error: e } = await op;
    setError(e ? t('The change could not be saved.') : null);
    reload();
  };

  return (
    <Panel aria-label={t('Client accounts')}>
      <SectionHeader
        title={t('Client accounts')}
        note={accounts.state === 'ready' ? t('{n} active', { n: accounts.rows.filter((a) => a.status === 'active').length }) : undefined}
        action={<Button size="sm" variant="quiet" onClick={() => setInviting({})}><UserPlus size={11} aria-hidden="true" /> {t('Invite')}</Button>}
      />
      {error && <p role="alert" className="border-b border-hairline px-4 py-2 text-xs text-danger">{error}</p>}
      {accounts.state === 'error' && (
        <p className="px-4 py-3 text-xs text-haze">{t('Client accounts are not set up in this database yet.')}</p>
      )}
      {accounts.state === 'ready' && accounts.rows.length === 0 && (
        <p className="px-4 py-3 text-xs text-haze">
          {t('No client accounts. An invited client sees only the projects you assign and the files you share — never the tracker, notes, money or market values.')}
        </p>
      )}
      <ul className="grid">
        {accounts.rows.map((a) => {
          const live = a.access.filter((x) => !x.revoked_at);
          const addable = projects.filter((p) => !live.some((x) => x.project_id === p.id));
          return (
            <li key={a.id} className={cn('grid gap-2 border-b border-hairline px-4 py-3 last:border-0', a.status === 'revoked' && 'opacity-60')}
                data-account={a.email}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[13px] text-paper">{a.full_name}</p>
                  <p className="t-note break-all">{a.email}</p>
                  <p className="t-note">
                    {a.status === 'revoked' ? t('Revoked {date}', { date: shortDate(a.revoked_at) })
                      : !a.user_id ? t('Invited, not linked yet')
                        : a.first_seen_at ? t('Active since {date}', { date: shortDate(a.first_seen_at) }) : t('Invited {date} · not signed in yet', { date: shortDate(a.last_invited_at) })}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1">
                  <Button size="sm" variant="quiet" onClick={() => setInviting(a)}>
                    <Link2 size={11} aria-hidden="true" /> {a.status === 'revoked' ? t('Re-invite') : t('New link')}
                  </Button>
                  {a.status === 'active' && (
                    <Button size="sm" variant="danger"
                            onClick={() => { if (window.confirm(t('Revoke {email}? Every project and every share of this account ends now.', { email: a.email }))) void act(supabase.from('client_accounts').update({ status: 'revoked' }).eq('id', a.id)); }}>
                      {t('Revoke')}
                    </Button>
                  )}
                </div>
              </div>
              {a.status === 'active' && (
                <div className="grid gap-1">
                  {live.length === 0 && <p className="t-note">{t('No project assigned — this account sees nothing.')}</p>}
                  {live.map((x) => (
                    <div key={x.id} className="flex items-center justify-between gap-2 text-[12px]">
                      <span className="text-paper">{projectName(x.project_id)}</span>
                      <Button size="sm" variant="quiet" aria-label={t('Remove {project} from {email}', { project: projectName(x.project_id), email: a.email })}
                              onClick={() => void act(supabase.from('client_project_access').update({ revoked_at: new Date().toISOString() }).eq('id', x.id))}>
                        <X size={11} aria-hidden="true" />
                      </Button>
                    </div>
                  ))}
                  {addable.length > 0 && (
                    <div className="flex items-center gap-1">
                      <label className="sr-only" htmlFor={`add-${a.id}`}>{t('Assign a project to {email}', { email: a.email })}</label>
                      <Select id={`add-${a.id}`} value="" className="h-7 py-0 text-xs"
                              onChange={(e) => { if (e.target.value) void act(supabase.from('client_project_access').insert({ account_id: a.id, project_id: e.target.value })); }}>
                        <option value="">{t('Assign a project…')}</option>
                        {addable.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </Select>
                    </div>
                  )}
                  <p className="t-note">{t('Removing a project ends every share in it. Assigning it again later restores no share.')}</p>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {inviting && (
        <InviteDialog
          clientId={clientId}
          account={inviting}
          contacts={contacts}
          projects={projects}
          onClose={() => setInviting(null)}
          onDone={(r) => { setInviting(null); setLink(r); reload(); }}
        />
      )}
      {link && <LinkDialog {...link} onClose={() => setLink(null)} />}
    </Panel>
  );
}

function InviteDialog({
  clientId, account, contacts, projects, onClose, onDone,
}: {
  clientId: string;
  account: Partial<ClientAccount>;
  contacts: { id: string; name: string; email: string | null }[];
  projects: { id: string; name: string }[];
  onClose: () => void;
  onDone: (r: { link: string; kind: string; email: string }) => void;
}) {
  const existing = Boolean(account.id);
  const [name, setName] = useState(account.full_name ?? '');
  const [email, setEmail] = useState(account.email ?? '');
  const [contact, setContact] = useState(account.contact_id ?? '');
  const [chosen, setChosen] = useState<string[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pickContact = (id: string) => {
    setContact(id);
    const c = contacts.find((x) => x.id === id);
    if (c && !existing) { setName(c.name); if (c.email) setEmail(c.email); }
  };
  const submit = async () => {
    setBusy(true);
    setProblem(null);
    const r = await inviteClient({ organization_id: clientId, contact_id: contact || null, full_name: name, email, project_ids: chosen });
    setBusy(false);
    if ('error' in r) setProblem(r.error);
    else onDone({ ...r, email: email.trim().toLowerCase() });
  };

  return (
    <Dialog open onClose={onClose} wide title={existing ? t('New link for {email}', { email: account.email }) : t('Invite a client account')}
            description={t('The client chooses their own password from the link. No e-mail is sent: you send the link yourself.')}
            footer={<><Button size="sm" onClick={onClose}>{t('Cancel')}</Button>
              <Button size="sm" variant="primary" onClick={() => void submit()} disabled={busy || !name.trim() || !email.trim()}>
                {busy ? t('Working…') : existing ? t('Make a new link') : t('Invite')}
              </Button></>}>
      <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        {!existing && contacts.length > 0 && (
          <Field id="invite-contact" label={t('Contact (optional)')}>
            <Select id="invite-contact" value={contact} onChange={(e) => pickContact(e.target.value)}>
              <option value="">{t('No contact')}</option>
              {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}{c.email ? ` · ${c.email}` : ''}</option>)}
            </Select>
          </Field>
        )}
        <Field id="invite-name" label={t('Name')}>
          <Input id="invite-name" data-autofocus value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field id="invite-email" label={t('E-mail')} hint={existing ? t('Fixed for an existing account.') : undefined}>
          <Input id="invite-email" type="email" value={email} maxLength={320} readOnly={existing} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <fieldset className="grid gap-1.5">
          <legend className="label">{existing ? t('Also assign') : t('Projects')}</legend>
          {projects.length === 0 && <p className="t-note">{t('This client has no projects yet.')}</p>}
          {projects.map((p) => (
            <label key={p.id} className="flex items-center gap-2 text-[13px] text-paper max-sm:min-h-10">
              <input type="checkbox" checked={chosen.includes(p.id)}
                     onChange={(e) => setChosen(e.target.checked ? [...chosen, p.id] : chosen.filter((x) => x !== p.id))} />
              {p.name}
            </label>
          ))}
        </fieldset>
        <p className="t-note">
          {t('A staff address, or one that already belongs to another company, is refused and left unchanged. Access starts only once the account is linked; if a step fails, inviting again is safe.')}
        </p>
        {problem && <p role="alert" className="text-xs text-danger">{problem}</p>}
      </form>
    </Dialog>
  );
}

function LinkDialog({ link, kind, email, onClose }: { link: string; kind: string; email: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <Dialog open onClose={onClose} wide title={kind === 'recovery' ? t('Password link ready') : t('Invitation link ready')}
            description={t('Send this to {email} yourself — by e-mail or message. It is shown only now.', { email })}
            footer={<Button size="sm" onClick={onClose}>{t('Done')}</Button>}>
      <div className="grid gap-3">
        <label className="sr-only" htmlFor="invite-link">{t('Link')}</label>
        <Input id="invite-link" readOnly value={link} data-autofocus onFocus={(e) => e.currentTarget.select()} className="font-data text-[11px]" />
        <div>
          <Button size="sm" onClick={async () => { await navigator.clipboard.writeText(link).catch(() => {}); setCopied(true); }}>
            <Copy size={11} aria-hidden="true" /> {copied ? t('Copied') : t('Copy link')}
          </Button>
        </div>
        <ul className="t-note grid gap-1">
          <li>{t('It works once, and expires (the project’s e-mail link expiry — 1 hour by default).')}</li>
          <li>{t('Making a new link makes this one stop working.')}</li>
          <li>{t('It is not stored anywhere. If it is lost, make a new one.')}</li>
          <li>{kind === 'recovery' ? t('This account already has a password: the link lets them choose a new one.') : t('The client chooses their own password.')}</li>
        </ul>
        <p className="text-xs text-haze"><Badge tone="warn">{t('Private')}</Badge> {t('Anyone holding the link can sign in as this client until it is used.')}</p>
      </div>
    </Dialog>
  );
}


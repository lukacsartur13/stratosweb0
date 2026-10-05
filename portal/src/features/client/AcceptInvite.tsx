import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/features/auth/AuthProvider';
import { AuthShell } from '@/features/auth/pages';
import { Button, Field, Input } from '@/components/ui';
import { t } from '@/lib/i18n';

/**
 * /portal/accept-invite#token_hash=…&type=invite|recovery
 *
 * The link the owner sent by hand (netlify/functions/portal-invite.mjs). The
 * token is in the FRAGMENT, so it never reached a server; it is read once,
 * removed from the address bar and the history entry at once, and exchanged
 * with verifyOtp(). It is single-use and expires (Supabase's e-mail link
 * expiry, 1 hour by default). Then the client chooses their own password —
 * nobody else ever handles it.
 */

const schema = z.object({
  password: z.string()
    .min(12, 'Legalább 12 karakter legyen.')
    .regex(/[a-z]/, 'Legyen benne kisbetű.')
    .regex(/[A-Z]/, 'Legyen benne nagybetű.')
    .regex(/[0-9]/, 'Legyen benne szám.'),
  confirm: z.string(),
}).refine((v) => v.password === v.confirm, { message: 'A két jelszó nem egyezik.', path: ['confirm'] });

function readFragment(): { token: string; type: 'invite' | 'recovery' } | null {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const token = params.get('token_hash');
  const type = params.get('type');
  return token && (type === 'invite' || type === 'recovery') ? { token, type } : null;
}

export function AcceptInvitePage() {
  const { updatePassword } = useAuth();
  const navigate = useNavigate();
  // Read before the effect clears it (StrictMode renders twice; both see it).
  const [link] = useState(readFragment);
  const started = useRef(false);
  const [phase, setPhase] = useState<'checking' | 'password' | 'invalid'>(link ? 'checking' : 'invalid');
  const [formError, setFormError] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } =
    useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });

  useEffect(() => {
    // Out of the address bar, the history and any later referrer.
    if (window.location.hash) window.history.replaceState(null, '', window.location.pathname);
    if (!link || started.current) return;
    started.current = true;
    void supabase.auth.verifyOtp({ token_hash: link.token, type: link.type })
      .then(({ error }) => setPhase(error ? 'invalid' : 'password'))
      .catch(() => setPhase('invalid'));
  }, [link]);

  if (phase === 'invalid') {
    return (
      <AuthShell title={t('A link nem érvényes')} lede={t('Lejárt, már felhasználták, vagy hiányos.')}>
        <p className="text-sm text-haze">
          {t('Kérj új meghívó linket a Stratostól. Biztonsági okból minden link csak egyszer használható, és korlátozott ideig érvényes.')}
        </p>
      </AuthShell>
    );
  }
  if (phase === 'checking') {
    return <AuthShell title={t('Ellenőrzés…')} lede={t('Egy pillanat.')}><p className="text-sm text-haze" aria-busy="true">{t('A link ellenőrzése folyamatban.')}</p></AuthShell>;
  }

  return (
    <AuthShell title={t('Jelszó beállítása')} lede={t('Ezzel a jelszóval lépsz be ezután. Senki más nem látja.')}>
      <form
        noValidate
        className="grid gap-4"
        onSubmit={handleSubmit(async (v) => {
          setFormError(null);
          const { error } = await updatePassword(v.password);
          if (error) setFormError(t('A jelszó mentése nem sikerült. Kérj új linket.'));
          else navigate('/', { replace: true });
        })}
      >
        <Field id="new-password" label={t('Új jelszó')} error={errors.password?.message && t(errors.password.message)}>
          <Input id="new-password" type="password" autoComplete="new-password" invalid={!!errors.password} {...register('password')} />
        </Field>
        <Field id="confirm-password" label={t('Jelszó még egyszer')} error={errors.confirm?.message && t(errors.confirm.message)}>
          <Input id="confirm-password" type="password" autoComplete="new-password" invalid={!!errors.confirm} {...register('confirm')} />
        </Field>
        {formError && <p role="alert" className="rounded-sm border border-danger/30 bg-danger/5 p-2.5 text-xs text-danger">{formError}</p>}
        <Button type="submit" variant="primary" disabled={isSubmitting}>{isSubmitting ? t('Mentés…') : t('Jelszó mentése')}</Button>
      </form>
    </AuthShell>
  );
}

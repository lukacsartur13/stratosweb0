import { useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import { Button, Field, Input, Panel } from '@/components/ui';

/* --------------------------------------------------------------- chrome */
function AuthShell({ title, lede, children }: { title: string; lede: string; children: ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          {/* The mark is Aboreto here for the same reason it is in the sidebar:
              one face draws the brand and nothing else in the product does. */}
          <p className="font-mark text-[15px] tracking-[0.26em] text-paper">STRATOS</p>
          <p className="t-section mt-1.5">Portal</p>
        </div>
        <Panel className="p-6">
          <h1 className="font-data text-[12px] uppercase tracking-[0.18em] text-chrome">{title}</h1>
          <p className="mb-5 mt-1.5 text-sm text-haze">{lede}</p>
          {children}
        </Panel>
        <p className="mt-5 text-center text-xs text-haze">
          {/* The label names no domain, on purpose. It used to say
              "media-stratos.com" — the Wix site this project replaces — while
              the href was already the correct same-origin "/". So it was wrong
              on the netlify.app address, wrong on stratosweb.hu after cutover,
              and right on the one host this site will never be served from.
              A relative link deserves a relative label; this one needs no
              maintenance when the domain moves. */}
          <a href="/" className="underline underline-offset-4 hover:text-paper">
            Back to the website
          </a>
        </p>
      </div>
    </main>
  );
}

function NotConfigured() {
  return (
    <p className="rounded-sm border border-signal/30 bg-signal/5 p-3 text-xs text-haze">
      Supabase is not configured in this environment. Copy <code className="text-chrome">.env.example</code> to{' '}
      <code className="text-chrome">.env</code> and restart the dev server.
    </p>
  );
}

/* ----------------------------------------------------------------- login */
const loginSchema = z.object({
  email: z.string().min(1, 'Enter your email address.').email('That does not look like an email address.'),
  password: z.string().min(1, 'Enter your password.'),
});
type LoginValues = z.infer<typeof loginSchema>;

export function LoginPage() {
  const { signIn, session, configured } = useAuth();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register, handleSubmit, formState: { errors, isSubmitting },
  } = useForm<LoginValues>({ resolver: zodResolver(loginSchema) });

  if (session) return <Navigate to="/" replace />;

  return (
    <AuthShell title="Sign in" lede="This area is for Stratos staff and clients.">
      {!configured && <div className="mb-4"><NotConfigured /></div>}
      <form
        noValidate
        className="grid gap-4"
        onSubmit={handleSubmit(async (v) => {
          setFormError(null);
          const { error } = await signIn(v.email, v.password);
          if (error) setFormError(error);
        })}
      >
        <Field id="email" label="Email" error={errors.email?.message}>
          <Input id="email" type="email" autoComplete="email" invalid={!!errors.email} {...register('email')} />
        </Field>
        <Field id="password" label="Password" error={errors.password?.message}>
          <Input id="password" type="password" autoComplete="current-password" invalid={!!errors.password} {...register('password')} />
        </Field>

        {formError && (
          <p role="alert" className="rounded-sm border border-danger/30 bg-danger/5 p-2.5 text-xs text-danger">
            {formError}
          </p>
        )}

        <Button type="submit" variant="primary" disabled={isSubmitting}>
          {isSubmitting ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>

      <p className="mt-4 text-xs text-haze">
        <a href="/portal/forgot-password" className="underline underline-offset-4 hover:text-paper">
          Forgotten your password?
        </a>
      </p>
      {/* No "create an account" link, and no public signup route. Accounts are
          created by a super_admin. See ARCHITECTURE.md. */}
    </AuthShell>
  );
}

/* ------------------------------------------------------- forgot password */
const emailSchema = z.object({
  email: z.string().min(1, 'Enter your email address.').email('That does not look like an email address.'),
});

export function ForgotPasswordPage() {
  const { requestReset, configured } = useAuth();
  const [sent, setSent] = useState(false);
  const {
    register, handleSubmit, formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof emailSchema>>({ resolver: zodResolver(emailSchema) });

  return (
    <AuthShell title="Reset password" lede="We will email you a link to choose a new one.">
      {!configured && <div className="mb-4"><NotConfigured /></div>}
      {sent ? (
        // The same message regardless of whether the address exists.
        <p role="status" className="rounded-sm border border-good/30 bg-good/5 p-3 text-sm text-haze">
          If that address has an account, a reset link is on its way. It expires in one hour.
        </p>
      ) : (
        <form
          noValidate
          className="grid gap-4"
          onSubmit={handleSubmit(async (v) => { await requestReset(v.email); setSent(true); })}
        >
          <Field id="reset-email" label="Email" error={errors.email?.message}>
            <Input id="reset-email" type="email" autoComplete="email" invalid={!!errors.email} {...register('email')} />
          </Field>
          <Button type="submit" variant="primary" disabled={isSubmitting}>
            {isSubmitting ? 'Sending…' : 'Send reset link'}
          </Button>
        </form>
      )}
      <p className="mt-4 text-xs text-haze">
        <a href="/portal/login" className="underline underline-offset-4 hover:text-paper">Back to sign in</a>
      </p>
    </AuthShell>
  );
}

/* -------------------------------------------------------- reset password */
const newPasswordSchema = z.object({
  password: z.string()
    .min(12, 'Use at least 12 characters.')
    .regex(/[a-z]/, 'Include a lower-case letter.')
    .regex(/[A-Z]/, 'Include an upper-case letter.')
    .regex(/[0-9]/, 'Include a number.'),
  confirm: z.string(),
}).refine((v) => v.password === v.confirm, {
  message: 'The two passwords do not match.',
  path: ['confirm'],
});

export function ResetPasswordPage() {
  const { updatePassword } = useAuth();
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register, handleSubmit, formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof newPasswordSchema>>({ resolver: zodResolver(newPasswordSchema) });

  return (
    <AuthShell title="Choose a new password" lede="Twelve characters or more, with a mix of cases and a number.">
      <form
        noValidate
        className="grid gap-4"
        onSubmit={handleSubmit(async (v) => {
          setFormError(null);
          const { error } = await updatePassword(v.password);
          if (error) setFormError('That link has expired or has already been used. Request a new one.');
          else navigate('/', { replace: true });
        })}
      >
        <Field id="new-password" label="New password" error={errors.password?.message}>
          <Input id="new-password" type="password" autoComplete="new-password" invalid={!!errors.password} {...register('password')} />
        </Field>
        <Field id="confirm-password" label="Confirm password" error={errors.confirm?.message}>
          <Input id="confirm-password" type="password" autoComplete="new-password" invalid={!!errors.confirm} {...register('confirm')} />
        </Field>
        {formError && (
          <p role="alert" className="rounded-sm border border-danger/30 bg-danger/5 p-2.5 text-xs text-danger">
            {formError}
          </p>
        )}
        <Button type="submit" variant="primary" disabled={isSubmitting}>
          {isSubmitting ? 'Saving…' : 'Save password'}
        </Button>
      </form>
    </AuthShell>
  );
}

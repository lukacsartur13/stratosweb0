import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type {
  ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes,
} from 'react';
import { forwardRef } from 'react';

export const cn = (...parts: unknown[]) => twMerge(clsx(parts));

/* ------------------------------------------------------------------ button */
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'ghost', size = 'md', ...rest }, ref) => (
    <button
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-sm font-data uppercase tracking-[0.14em]',
        'transition-colors disabled:cursor-not-allowed disabled:opacity-45',
        size === 'sm' ? 'px-3 py-1.5 text-[10px]' : 'px-4 py-2.5 text-[11px]',
        variant === 'primary' && 'bg-signal text-black hover:bg-signal/85',
        variant === 'ghost' &&
          'border border-hair text-paper hover:border-chrome/40 hover:bg-white/5',
        variant === 'danger' &&
          'border border-danger/40 text-danger hover:bg-danger/10',
        className,
      )}
      {...rest}
    />
  ),
);
Button.displayName = 'Button';

/* ------------------------------------------------------------- form fields */
type FieldProps = { label: string; error?: string; hint?: string; children: ReactNode; id: string };

export function Field({ label, error, hint, children, id }: FieldProps) {
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="label">{label}</label>
      {children}
      {hint && !error && <p className="text-xs text-haze">{hint}</p>}
      {/* Errors are announced, not just coloured — a red border is invisible to
          a screen reader and to a good share of sighted users. */}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-xs text-danger">{error}</p>
      )}
    </div>
  );
}

const fieldBase =
  'w-full rounded-sm border bg-black/30 px-3 py-2.5 text-sm text-paper placeholder:text-haze/60 ' +
  'transition-colors focus:border-signal/60 focus:outline-none focus-visible:outline-2 ' +
  'focus-visible:outline-signal';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  ({ className, invalid, ...rest }, ref) => (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(fieldBase, invalid ? 'border-danger/60' : 'border-hair', className)}
      {...rest}
    />
  ),
);
Input.displayName = 'Input';

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(
  ({ className, invalid, ...rest }, ref) => (
    <textarea
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(fieldBase, 'min-h-24 resize-y', invalid ? 'border-danger/60' : 'border-hair', className)}
      {...rest}
    />
  ),
);
Textarea.displayName = 'Textarea';

/* ------------------------------------------------------------------ panels */
export function Panel({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <section className={cn('rounded-lg border border-hair bg-panel/60 shadow-panel', className)}>
      {children}
    </section>
  );
}

export function PanelHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <header className="flex items-center justify-between gap-4 border-b border-hair px-5 py-3.5">
      <h2 className="font-data text-[11px] uppercase tracking-[0.18em] text-chrome">{title}</h2>
      {action}
    </header>
  );
}

/* ------------------------------------------------------------------- badge */
const TONES = {
  neutral: 'border-hair text-haze',
  good: 'border-good/40 text-good',
  warn: 'border-signal/40 text-signal',
  bad: 'border-danger/40 text-danger',
} as const;

export function Badge({ tone = 'neutral', children }: { tone?: keyof typeof TONES; children: ReactNode }) {
  return (
    <span className={cn(
      'inline-flex items-center rounded-sm border px-2 py-0.5 font-data text-[9px] uppercase tracking-[0.14em]',
      TONES[tone],
    )}>
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ states */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-sm bg-white/5', className)} aria-hidden="true" />;
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="grid place-items-center gap-2 px-6 py-16 text-center">
      <p className="font-data text-[11px] uppercase tracking-[0.18em] text-chrome">{title}</p>
      <p className="max-w-sm text-sm text-haze">{body}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="grid place-items-center gap-3 px-6 py-14 text-center">
      <p className="font-data text-[11px] uppercase tracking-[0.18em] text-danger">Could not load</p>
      <p className="max-w-md text-sm text-haze">{message}</p>
      {onRetry && <Button size="sm" onClick={onRetry}>Try again</Button>}
    </div>
  );
}

/* ------------------------------------------------------------------- table */
export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    // The wrapper scrolls, not the page: a wide table on a phone must never
    // give the whole document a horizontal scrollbar.
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-hair">
            {head.map((h) => (
              <th key={h} scope="col" className="label px-5 py-2.5 text-left font-normal">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Row({ children }: { children: ReactNode }) {
  return <tr className="border-b border-hair/60 last:border-0 hover:bg-white/[0.03]">{children}</tr>;
}

export function Cell({ children, className, colSpan }: { children: ReactNode; className?: string; colSpan?: number }) {
  return <td colSpan={colSpan} className={cn('px-5 py-3 align-middle', className)}>{children}</td>;
}

import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { X } from 'lucide-react';
import type {
  ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { forwardRef, useEffect, useRef } from 'react';

/**
 * The Control Room's primitives.
 *
 * Every surface in the Portal is built from what is in this file, which is the
 * only reason the Portal looks like one product. The rule the file follows: a
 * component here decides how something LOOKS and how it BEHAVES for a keyboard
 * or a screen reader, and never what it means. Nothing below knows what a lead
 * is.
 */

export const cn = (...parts: unknown[]) => twMerge(clsx(parts));

/* ------------------------------------------------------------------ button */
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'quiet' | 'danger';
  size?: 'sm' | 'md';
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'ghost', size = 'md', ...rest }, ref) => (
    <button
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-sm font-data uppercase tracking-[0.14em]',
        'transition-colors disabled:cursor-not-allowed disabled:opacity-45',
        size === 'sm' ? 'px-2.5 py-1.5 text-[10px]' : 'px-4 py-2.5 text-[11px]',
        variant === 'primary' && 'bg-signal text-black hover:bg-signal/85',
        variant === 'ghost' && 'border border-hair text-paper hover:bg-flare',
        // No border at all: for controls that sit inside a bounded surface,
        // where a second rectangle around them is one rectangle too many.
        variant === 'quiet' && 'text-haze hover:bg-flare hover:text-paper',
        variant === 'danger' && 'border border-danger/40 text-danger hover:bg-danger/10',
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

/**
 * A filter dropdown.
 *
 * A native `select`, deliberately. The Leads screen needs five of these in one
 * row and every one of them is a short list of known values — which is what a
 * `select` is for. A custom listbox would be ~200 lines of keyboard handling to
 * arrive back at what the platform already does, and it would be the only
 * control in the product that a screen reader had to be taught about.
 */
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...rest }, ref) => (
    <select
      ref={ref}
      className={cn(
        'rounded-sm border border-hair bg-black/30 px-2 py-1.5 font-data text-[11px] text-paper',
        'transition-colors hover:bg-flare focus:border-signal/60 focus:outline-none',
        'focus-visible:outline-2 focus-visible:outline-signal',
        className,
      )}
      {...rest}
    >
      {children}
    </select>
  ),
);
Select.displayName = 'Select';

/* ----------------------------------------------------------------- surfaces */

/**
 * Level 1 — a section.
 *
 * One border, one background, no shadow worth the name. Everything that belongs
 * together lives inside ONE of these; a figure inside a section does not get its
 * own, which is the difference between an interface and a pile of cards.
 */
export function Panel({
  className, children, as: Tag = 'section', ...rest
}: { className?: string; children: ReactNode; as?: 'section' | 'div' } & { 'aria-label'?: string }) {
  return (
    <Tag className={cn('rounded border border-hair bg-deck', className)} {...rest}>
      {children}
    </Tag>
  );
}

/**
 * The head of a section: what it is, optionally what it is measuring, and at
 * most one control.
 *
 * `title` is a `<h2>` by default so that the page has a real outline — a screen
 * reader user should be able to jump between "Traffic", "Live" and "Recent
 * leads" the way a sighted reader's eye does.
 */
export function SectionHeader({
  title, note, action, level = 2,
}: { title: string; note?: ReactNode; action?: ReactNode; level?: 2 | 3 }) {
  const Heading = level === 2 ? 'h2' : 'h3';
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-hairline px-4 py-2.5">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <Heading className="t-section text-chrome">{title}</Heading>
        {note && <span className="t-note truncate">{note}</span>}
      </div>
      {action}
    </header>
  );
}

/* ------------------------------------------------------------ metric strip */

/**
 * The executive strip — one surface, several figures.
 *
 * Not five cards. One bounded region, divided internally by a hairline, with
 * every cell on a common baseline: the label at the top, the figure at the
 * same height in every cell, the comparison beneath it. That common baseline is
 * the whole reason this reads as a summary rather than as five unrelated
 * numbers that happen to be next to each other.
 *
 * It wraps rather than scrolls below `lg`, and at phone widths it is two
 * columns — five figures on one line at 390px would be five illegible figures.
 */
export function MetricStrip({
  children, label, className,
}: { children: ReactNode; label: string; className?: string }) {
  return (
    <Panel
      aria-label={label}
      className={cn(
        'grid grid-cols-2 divide-x divide-y divide-hairline bg-panel',
        'sm:grid-cols-3 xl:grid-cols-5 xl:divide-y-0',
        className,
      )}
    >
      {children}
    </Panel>
  );
}

/**
 * One cell of it: small label, large value, small comparison.
 *
 * `tone="live"` is the ONE place a figure is allowed to be yellow by default,
 * and it exists for the realtime count — the only number on the Dashboard that
 * is true right now rather than true for a period.
 */
export function MetricCell({
  label, value, note, delta, selected, onSelect, tone = 'default',
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  delta?: ReactNode;
  selected?: boolean;
  onSelect?: () => void;
  tone?: 'default' | 'live';
}) {
  const body = (
    <>
      <p className="t-section truncate">{label}</p>
      <p className={cn('t-metric mt-1.5', tone === 'live' ? 'text-signal' : 'text-paper')}>{value}</p>
      <div className="mt-1 flex min-h-[14px] flex-wrap items-baseline gap-x-2">
        {delta}
        {note && <span className="t-note">{note}</span>}
      </div>
    </>
  );

  const shell = cn(
    'min-w-0 px-4 py-3.5 text-left transition-colors',
    selected && 'bg-flare',
  );

  if (!onSelect) return <div className={shell}>{body}</div>;
  return (
    <button type="button" onClick={onSelect} aria-pressed={selected} className={cn(shell, 'hover:bg-flare')}>
      {body}
    </button>
  );
}

/* ------------------------------------------------------------------- badge */
const TONES = {
  neutral: 'border-hair text-haze',
  good: 'border-good/35 text-good',
  warn: 'border-signal/35 text-signal',
  bad: 'border-danger/35 text-danger',
} as const;

export type Tone = keyof typeof TONES;

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={cn(
      'inline-flex items-center rounded-sm border px-1.5 py-0.5 font-data text-[9px] uppercase tracking-[0.14em]',
      TONES[tone],
    )}>
      {children}
    </span>
  );
}

/**
 * A pipeline status, as a marker and a word.
 *
 * Six statuses in six bright colours is a rainbow nobody learns. The
 * differentiation here is a 4px marker plus text emphasis, and colour is
 * reserved for the two ends of the pipeline that genuinely mean something —
 * won, and lost — plus `new`, which is the only status that is a request for
 * action rather than a description of one.
 */
const PILL_MARK: Record<Tone, string> = {
  neutral: 'bg-chrome/40',
  good: 'bg-good',
  warn: 'bg-signal',
  bad: 'bg-danger/70',
};

export function StatusPill({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className={cn('h-1 w-1 shrink-0 rounded-full', PILL_MARK[tone])} aria-hidden="true" />
      <span className={cn(
        'font-data text-[10px] uppercase tracking-[0.12em]',
        tone === 'neutral' ? 'text-haze' : 'text-paper',
      )}>
        {children}
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------ states */

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-sm bg-white/[0.04]', className)} aria-hidden="true" />;
}

/**
 * The four ways a surface can have nothing to show, and they are four.
 *
 *   empty           the records do not exist yet
 *   unavailable     a remote service failed
 *   unconfigured    a required credential is missing
 *   zero            the real, measured answer is zero
 *
 * Rendering all four as `0` is the failure this component exists to prevent. A
 * dashboard reading `0 users` when Google was never connected is not merely
 * unhelpful — it is wrong, and somebody acts on it.
 *
 * `zero` is deliberately NOT drawn by this component: a genuine zero is a
 * measurement and belongs in the same place, at the same size, as the figure it
 * would have been. It is `0`, in the metric, with its label intact.
 */
export function DataState({
  kind, title, body, action,
}: {
  kind: 'empty' | 'unavailable' | 'unconfigured';
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div
      className="grid place-items-center gap-1.5 px-6 py-10 text-center"
      role={kind === 'unavailable' ? 'alert' : undefined}
      data-state={kind}
    >
      <p className={cn(
        'font-data text-[10px] uppercase tracking-[0.18em]',
        kind === 'unavailable' ? 'text-danger' : 'text-chrome',
      )}>
        {title}
      </p>
      {body && <p className="max-w-sm text-xs leading-relaxed text-haze">{body}</p>}
      {action && <div className="mt-1.5">{action}</div>}
    </div>
  );
}

/** No records exist yet. */
export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return <DataState kind="empty" title={title} body={body} action={action} />;
}

/** A remote service failed. The rest of the screen is unaffected. */
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <DataState
      kind="unavailable"
      title="Unavailable"
      body={message}
      action={onRetry ? <Button size="sm" onClick={onRetry}>Try again</Button> : undefined}
    />
  );
}

/**
 * A figure that could not be measured, in the place the figure would be.
 *
 * An em dash and a reason, at the size of the number it replaces, so a strip
 * with one unavailable cell keeps its baseline and does not imply zero.
 */
export function NoFigure({ reason }: { reason: string }) {
  return (
    <span className="text-haze" title={reason} aria-label={reason}>—</span>
  );
}

/* ------------------------------------------------------------------- table */

/**
 * The one horizontally-scrolling container in this product.
 *
 * The wrapper scrolls, not the page: a wide table on a phone must never give
 * the whole document a horizontal scrollbar. `sticky` heads are opt-in, for the
 * long lists where the columns leave the screen before the rows do.
 */
export function Table({
  head, children, sticky = false, minWidth = 640,
}: {
  head: (string | { label: string; align?: 'left' | 'right' })[];
  children: ReactNode;
  sticky?: boolean;
  minWidth?: 560 | 640 | 720 | 840;
}) {
  // Tailwind cannot see through a template literal, so the widths are spelled
  // out. Kept in components/ui, which is the one place a pixel width is allowed
  // to be stated — see `only the table scrolls sideways` in the suite.
  const min = {
    560: 'min-w-[560px]', 640: 'min-w-[640px]', 720: 'min-w-[720px]', 840: 'min-w-[840px]',
  }[minWidth];

  return (
    <div className="overflow-x-auto">
      <table className={cn('w-full border-collapse text-sm', min)}>
        <thead className={cn(sticky && 'sticky top-0 z-10 bg-deck')}>
          <tr className="border-b border-hair">
            {head.map((h) => {
              const { label, align } = typeof h === 'string' ? { label: h, align: 'left' as const } : h;
              return (
                <th
                  key={label}
                  scope="col"
                  className={cn('t-section px-4 py-2 font-normal', align === 'right' ? 'text-right' : 'text-left')}
                >
                  {label}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/**
 * A row, optionally one you can click.
 *
 * `onClick` is an ENHANCEMENT and never the only way in. Every clickable row in
 * this product also carries a real link in its first cell, which is what a
 * keyboard reaches, what a screen reader announces and what a middle click
 * opens. A row handler that was the only affordance would be a button that no
 * assistive technology can find.
 */
export function Row({
  children, onClick, selected,
}: { children: ReactNode; onClick?: () => void; selected?: boolean }) {
  return (
    <tr
      onClick={onClick}
      className={cn(
        'border-b border-hairline last:border-0',
        selected ? 'bg-flare' : 'hover:bg-flare',
        onClick && 'cursor-pointer',
      )}
    >
      {children}
    </tr>
  );
}

export function Cell({
  children, className, colSpan, align,
}: { children: ReactNode; className?: string; colSpan?: number; align?: 'left' | 'right' }) {
  return (
    <td
      colSpan={colSpan}
      className={cn('px-4 py-2.5 align-middle', align === 'right' && 'text-right', className)}
    >
      {children}
    </td>
  );
}

/* ------------------------------------------------------------- detail line */

/**
 * One fact in a detail column: what it is, and what it is.
 *
 * The unit of the right-hand column on every detail screen in the product. A
 * column of these is ONE panel with a rule between each pair — not one card per
 * fact, which is how a detail screen becomes fifteen equal boxes and stops
 * having a hierarchy at all (§13).
 *
 * `value` takes a node rather than a string so that a figure that could not be
 * measured can be `<NoFigure>` or the words "Not recorded" at the same size and
 * in the same place as the number it replaces.
 */
export function DataLine({
  term, value, note, className,
}: { term: string; value: ReactNode; note?: ReactNode; className?: string }) {
  return (
    <div className={cn(
      'flex items-baseline justify-between gap-4 border-b border-hairline px-4 py-2 last:border-0',
      className,
    )}>
      <dt className="label shrink-0">{term}</dt>
      <dd className="min-w-0 text-right">
        <span className="block break-words text-[13px] text-paper">{value}</span>
        {note && <span className="t-note block">{note}</span>}
      </dd>
    </div>
  );
}

/**
 * A figure that was never entered.
 *
 * NOT a zero, and not an em dash either — this one has words, because §31 asks
 * specifically for `Not recorded` where a financial figure is missing. `0 Ft` of
 * costs and "nobody has written the costs down" are different facts and only one
 * of them makes a contribution figure meaningful.
 */
export function NotRecorded({ what }: { what?: string }) {
  return (
    <span className="text-[13px] text-haze" title={what ? `${what} has not been recorded` : undefined}>
      Not recorded
    </span>
  );
}

/* ------------------------------------------------------------------ dialog */

/**
 * A modal dialog, and everything a modal dialog owes a keyboard (§62).
 *
 * ## What this does that a `<div>` with `position: fixed` does not
 *
 *   - `role="dialog"` + `aria-modal` + `aria-labelledby`, so it is announced as
 *     a dialog with a name rather than as a pile of text that appeared.
 *   - Focus MOVES INTO it on open, to the first focusable thing inside.
 *   - Tab CYCLES inside it. A dialog you can Tab out of, into the page behind
 *     that you cannot see, is the single worst keyboard bug a modal can have.
 *   - Escape closes it.
 *   - Focus RETURNS to whatever opened it. Otherwise closing a dialog drops the
 *     keyboard user back at the top of the document.
 *   - The page behind does not scroll.
 *
 * The native `<dialog>` element does most of this, and is not used here for one
 * reason: `showModal()` has to be called imperatively against a ref, which means
 * every caller manages an effect to keep the DOM in step with its own `open`
 * state. This component takes `open` as a prop and is declarative, which is what
 * the rest of the product is.
 */
export function Dialog({
  open, onClose, title, description, children, footer, wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    returnTo.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focusable = () => Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), '
        + 'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    ).filter((el) => el.offsetParent !== null);

    // The first control, not the panel: a dialog that focuses its own container
    // announces its title and then leaves the user pressing Tab to find out what
    // is in it.
    focusable()[0]?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); onClose(); return; }
      if (event.key !== 'Tab') return;

      const items = focusable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && (active === first || !panelRef.current?.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = previousOverflow;
      returnTo.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  const titleId = `dialog-${title.replace(/\W+/g, '-').toLowerCase()}`;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto p-4">
      <div className="fixed inset-0 bg-black/75" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          'relative w-full rounded border border-hair bg-deck shadow-panel',
          wide ? 'max-w-2xl' : 'max-w-md',
        )}
      >
        <header className="flex items-start justify-between gap-4 border-b border-hairline px-4 py-3">
          <div className="min-w-0">
            <h2 id={titleId} className="t-section text-chrome">{title}</h2>
            {description && <p className="t-note mt-1 max-w-prose">{description}</p>}
          </div>
          <Button size="sm" variant="quiet" onClick={onClose} aria-label="Close">
            <X size={13} aria-hidden="true" />
          </Button>
        </header>

        <div className="max-h-[70dvh] overflow-y-auto px-4 py-4">{children}</div>

        {footer && (
          <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-hairline px-4 py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ health */

/**
 * One service, one state.
 *
 * Used by the System page and by nothing else that could ever be handed a
 * secret: the props are a name, an enum and a sentence, and there is no field
 * here that could hold a key, a URL or a token even if the endpoint changed
 * underneath it.
 */
export function HealthRow({
  term, state, note, tone,
}: { term: string; state: string; note: string; tone: Tone }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-hairline px-4 py-2.5 last:border-0">
      <div className="min-w-0">
        <dt className="t-row">{term}</dt>
        <dd className="t-note truncate">{note}</dd>
      </div>
      <Badge tone={tone}>{state}</Badge>
    </div>
  );
}

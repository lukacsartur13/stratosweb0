import type { KeyboardEvent } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { cn } from '@/components/ui';
import { useTheme, type ThemePref } from '@/lib/theme';

/**
 * System · Light · Dark — a three-way radio group, the same control on the
 * owner's sidebar, the client's header and the sign-in page. "System" follows
 * the device, live. The choice is remembered on this device only.
 */

const LABELS = {
  en: { group: 'Appearance', system: 'System', light: 'Light', dark: 'Dark' },
  hu: { group: 'Megjelenés', system: 'Rendszer', light: 'Világos', dark: 'Sötét' },
} as const;

const OPTIONS: { value: ThemePref; Icon: typeof Sun }[] = [
  { value: 'system', Icon: Monitor },
  { value: 'light', Icon: Sun },
  { value: 'dark', Icon: Moon },
];

export function ThemeSwitch({ lang = 'en', className }: { lang?: 'en' | 'hu'; className?: string }) {
  const { pref, choose } = useTheme();
  const t = LABELS[lang];

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const i = OPTIONS.findIndex((o) => o.value === pref);
    const next = OPTIONS[(i + step + OPTIONS.length) % OPTIONS.length].value;
    choose(next);
    e.currentTarget.querySelector<HTMLButtonElement>(`[data-value="${next}"]`)?.focus();
  };

  return (
    <div role="radiogroup" aria-label={t.group} onKeyDown={onKey} data-theme-switch=""
         className={cn('inline-flex rounded-sm border border-hair p-0.5', className)}>
      {OPTIONS.map(({ value, Icon }) => {
        const on = pref === value;
        return (
          <button key={value} type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1}
                  data-value={value} title={t[value]} onClick={() => choose(value)}
                  className={cn('inline-flex min-h-8 items-center gap-1 rounded-sm px-2 py-1 text-[11px]',
                    on ? 'bg-flare text-paper' : 'text-haze hover:text-paper')}>
            <Icon size={12} aria-hidden="true" />
            <span>{t[value]}</span>
          </button>
        );
      })}
    </div>
  );
}

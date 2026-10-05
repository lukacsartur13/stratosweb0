import {
  Fragment, createContext, useCallback, useContext, useEffect, useState, type KeyboardEvent, type ReactNode,
} from 'react';
import { useAuth } from '@/features/auth/AuthProvider';
import { supabase, isConfigured } from '@/lib/supabase';
import { LANGS, LANG_NAMES, getLang, isLang, setLang, t, type Lang } from '@/lib/i18n';
import { cn } from '@/components/ui';

/**
 * Which language the portal is in, for everyone: the signed-in profile's
 * choice (`profiles.locale`, 20261009000100_profile_locale.sql), else this
 * device's last choice, else none — every screen in the language it is
 * written in (owner screens English, client portal Hungarian).
 *
 * Changing it remounts everything under the gate, so every `t()` call — in a
 * component or in lib code — reads the new language on the next render.
 */

export const LANG_KEY = 'stratos.portal.lang';

export function readStoredLang(): Lang | null {
  try {
    const v = localStorage.getItem(LANG_KEY);
    return isLang(v) ? v : null;
  } catch {
    return null;
  }
}

function storeLang(lang: Lang) {
  try { localStorage.setItem(LANG_KEY, lang); } catch { /* private mode: this page only */ }
}

const Ctx = createContext<{ lang: Lang | null; choose(next: Lang): Promise<string | null> }>({
  lang: null,
  choose: async () => null,
});

export const useLanguage = () => useContext(Ctx);

export function LanguageGate({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const [lang, setState] = useState<Lang | null>(() => getLang());

  // The account's choice wins over the device's, once it is known.
  useEffect(() => {
    if (profile?.locale && profile.locale !== lang) {
      storeLang(profile.locale);
      setState(profile.locale);
    }
  }, [profile?.locale]); // eslint-disable-line react-hooks/exhaustive-deps

  // Render-time, before any child reads it.
  setLang(lang);

  useEffect(() => {
    if (lang) document.documentElement.lang = lang;
  }, [lang]);

  const choose = useCallback(async (next: Lang): Promise<string | null> => {
    storeLang(next);
    setState(next);
    if (!profile || !isConfigured) return null;
    const { error } = await supabase.from('profiles').update({ locale: next }).eq('id', profile.id);
    if (error) {
      // Before the migration the column does not exist: the choice still holds
      // on this device, it just does not follow the account yet.
      console.warn('[profiles.locale]', error.message);
      return t('Saved on this device only.');
    }
    return null;
  }, [profile]);

  return (
    <Ctx.Provider value={{ lang, choose }}>
      <Fragment key={lang ?? 'source'}>{children}</Fragment>
    </Ctx.Provider>
  );
}

/**
 * Magyar · English · Deutsch — a radio group like the appearance switch. Each
 * language is named in itself, so it can be found whatever is on screen.
 */
export function LanguageSwitch({ className, fallback = 'en' }: { className?: string; fallback?: Lang }) {
  const { lang, choose } = useLanguage();
  const on = lang ?? fallback;

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = LANGS[(LANGS.indexOf(on) + step + LANGS.length) % LANGS.length];
    void choose(next);
  };

  return (
    <div role="radiogroup" aria-label={t('Language')} onKeyDown={onKey} data-language-switch=""
         className={cn('inline-flex rounded-sm border border-hair p-0.5', className)}>
      {LANGS.map((value) => {
        const selected = on === value;
        return (
          <button key={value} type="button" role="radio" aria-checked={selected} tabIndex={selected ? 0 : -1}
                  data-value={value} lang={value} title={LANG_NAMES[value]} aria-label={LANG_NAMES[value]}
                  onClick={() => void choose(value)}
                  className={cn('inline-flex min-h-8 items-center rounded-sm px-2 py-1 font-data text-[11px] uppercase tracking-[0.1em]',
                    selected ? 'bg-flare text-paper' : 'text-haze hover:text-paper')}>
            {value}
          </button>
        );
      })}
    </div>
  );
}

import { useCallback, useEffect, useState } from 'react';

/**
 * The portal's colour theme: the viewer picks System, Light or Dark.
 *
 * The choice is kept per device and browser (localStorage), not on the
 * account — nothing is sent anywhere. "System" follows the device and changes
 * live when the device does. The result is written to
 * <html data-theme="light|dark">; styles.css holds the two palettes.
 * public/theme-boot.js applies the same rules before first paint.
 */

export type ThemePref = 'system' | 'light' | 'dark';
export type Theme = 'light' | 'dark';

export const THEME_KEY = 'stratos.portal.theme';
const EVENT = 'stratos:theme';

export function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

function systemTheme(): Theme {
  try {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export function resolveTheme(pref: ThemePref, system: Theme = systemTheme()): Theme {
  return pref === 'system' ? system : pref;
}

export function applyTheme(pref: ThemePref): Theme {
  const theme = resolveTheme(pref);
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.dataset.themePref = pref;
  return theme;
}

export function setPref(pref: ThemePref): void {
  try {
    if (pref === 'system') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, pref);
  } catch {
    // Storage blocked: the choice still applies until the page is reloaded.
  }
  applyTheme(pref);
  window.dispatchEvent(new CustomEvent(EVENT, { detail: pref }));
}

/** The current choice, the theme it resolves to, and a setter. */
export function useTheme() {
  const [pref, setState] = useState<ThemePref>(() => (typeof document !== 'undefined' && (document.documentElement.dataset.themePref as ThemePref)) || readPref());
  const [theme, setTheme] = useState<Theme>(() => resolveTheme(pref));

  useEffect(() => {
    const sync = (p: ThemePref) => { setState(p); setTheme(applyTheme(p)); };
    sync(pref);
    const onPick = (e: Event) => sync((e as CustomEvent<ThemePref>).detail);
    // Another tab changed it.
    const onStorage = (e: StorageEvent) => { if (e.key === THEME_KEY || e.key === null) sync(readPref()); };
    let mq: MediaQueryList | null = null;
    const onSystem = () => sync(readPref());
    try { mq = window.matchMedia('(prefers-color-scheme: light)'); mq.addEventListener('change', onSystem); } catch { /* no matchMedia */ }
    window.addEventListener(EVENT, onPick);
    window.addEventListener('storage', onStorage);
    return () => {
      mq?.removeEventListener('change', onSystem);
      window.removeEventListener(EVENT, onPick);
      window.removeEventListener('storage', onStorage);
    };
    // Subscribes once; `pref` only seeds the first sync.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const choose = useCallback((p: ThemePref) => setPref(p), []);
  return { pref, theme, choose };
}

/** A colour token as CSS, for SVG attributes and canvas (charts, confetti). */
export function token(name: string, alpha = 1): string {
  return `rgb(var(--c-${name}) / ${alpha})`;
}

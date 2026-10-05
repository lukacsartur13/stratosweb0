/**
 * The translations are fetched once, on first need — when a language is
 * chosen, or at start-up when this device or account already has one
 * (main.tsx, LanguageGate). Until then nothing is downloaded: a screen in its
 * source language needs no dictionary.
 */
let loading: Promise<void> | null = null;

export function ensureDictionaries(): Promise<void> {
  loading ??= import('./all').then((m) => m.registerAll()).catch((e) => {
    console.error('[i18n] the translations could not be loaded', e);
    loading = null; // a later choice tries again
  });
  return loading;
}

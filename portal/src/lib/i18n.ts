// =============================================================================
// The portal's languages: Hungarian, English, German.
//
// PURE — no imports — so the pure modules (pipeline.ts, money.ts, …) may use it
// and stay testable in Node, where no dictionary is registered and `t` returns
// its key.
//
// ## Keys are the source text
//
// `t('Monthly contracts')` — the key IS the string as written in the code. The
// owner's screens are written in English, the client portal in Hungarian, so a
// dictionary maps source text to a target language and a missing entry falls
// back to the source text itself: nothing ever renders as a key or as blank.
//
//   hu  English source → Hungarian   (the owner's screens)
//   en  Hungarian source → English   (the client portal)
//   de  both sources → German
//
// Placeholders: `t('{n} of {total}', { n, total })`. Plurals are two keys:
// `t(n === 1 ? '{n} project' : '{n} projects', { n })`.
//
// ## Which language is on
//
// One for the whole page, set by <LanguageGate> (features/i18n) from the
// signed-in profile, else this device's last choice, else the screen's own
// source language — so until somebody chooses, every screen reads exactly as
// it did before languages existed. Changing it remounts the tree, which is why
// plain function calls (not a hook) are enough everywhere, lib code included.
// =============================================================================

export type Lang = 'hu' | 'en' | 'de';

export const LANGS: readonly Lang[] = ['hu', 'en', 'de'];

/** Each language named in itself — the switch reads the same in every language. */
export const LANG_NAMES: Record<Lang, string> = { hu: 'Magyar', en: 'English', de: 'Deutsch' };

const INTL: Record<Lang, string> = { hu: 'hu-HU', en: 'en-GB', de: 'de-DE' };

const dicts: Record<Lang, Record<string, string>> = { hu: {}, en: {}, de: {} };
let current: Lang | null = null;

export const isLang = (v: unknown): v is Lang => v === 'hu' || v === 'en' || v === 'de';

/** Add entries to a language. Called once at start-up (i18n/index.ts). */
export function registerDictionary(lang: Lang, entries: Record<string, string>) {
  Object.assign(dicts[lang], entries);
}

/** The language chosen for this page, or `null` (every text in its source language). */
export const getLang = (): Lang | null => current;

export function setLang(lang: Lang | null) {
  current = lang;
}

/** Translate `key` into the current language; fill `{name}` placeholders. */
export function t(key: string, vars?: Record<string, string | number | null | undefined>): string {
  const text = (current && dicts[current][key]) || key;
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    (name in vars && vars[name] !== undefined && vars[name] !== null ? String(vars[name]) : whole));
}

/**
 * `t` for a word that means two things in English and two different words
 * elsewhere — "Production" the environment vs the cost category. The
 * dictionary key is `context|key` (e.g. `cost|Production`); without one the
 * plain key is used, and the source text is shown unchanged.
 */
export function tc(context: string, key: string, vars?: Record<string, string | number | null | undefined>): string {
  const own = current ? dicts[current][`${context}|${key}`] : undefined;
  return own ? t(`${context}|${key}`, vars) : t(key, vars);
}

/**
 * The Intl locale for dates and numbers: the chosen language's, else the
 * screen's own (`fallback`) — so an unchosen screen formats exactly as before.
 */
export const intlLocale = (fallback = 'en-GB'): string => (current ? INTL[current] : fallback);

/**
 * Locale layer for the homepage.
 *
 * WHY THE KEY IS THE HUNGARIAN SENTENCE
 * -------------------------------------
 * `_build/i18n.py` already translates this site, and it keys its dictionaries on
 * the Hungarian source string rather than on an invented identifier — see
 * `_build/i18n/index.json`, whose top-level keys are whole Hungarian sentences.
 * This module does the same thing for the same reason: a missing translation
 * then falls through to a correct Hungarian sentence instead of to a bare key
 * like `home.hero.title`, and the untranslated state is a language mismatch
 * rather than a broken page.
 *
 * It also means the copy in `content.ts` and `journey.ts` needs no edits at all.
 * Those modules stay plain Hungarian data structures; `localise` walks them once
 * at module load and swaps in whatever the locale table has.
 *
 * WHAT IS TRANSLATED TODAY — ALL OF IT
 * ------------------------------------
 * Both halves of the page are now covered in all three languages:
 *
 *   * the *narrative* — every heading, lead, body paragraph, CTA, eyebrow,
 *     altitude label, live-region announcement and fallback note — through `m`
 *     and `locales/messages.ts`, which is keyed and type-checked;
 *   * the *content model* — `content.ts`'s four case studies, nine system
 *     nodes, seven checkpoints and six capabilities — through `localise` and
 *     the sentence-keyed `locales/en.ts` / `locales/de.ts`.
 *
 * `npm run i18n:meridian` reports 0 of 91 outstanding for both locales and
 * writes empty worklists to `_build/missing-meridian-{en,de}.json`.
 *
 * TWO EARLIER CLAIMS IN THIS COMMENT WERE WRONG, AND WHY THAT MATTERED
 * -------------------------------------------------------------------
 * This block used to say the narrative was unwired — "roughly 54 strings of
 * narrative prose written directly as JSX text in FullAscent.tsx" — and that
 * the content model was 110 strings. Both were stale, and each was misleading
 * in a different direction:
 *
 *   * The 54 narrative strings had already been moved into `messages.ts`. The
 *     comment described work that was finished, so it pointed the next pass at
 *     a file that needed nothing and away from the two locale tables, which
 *     were still `{}` and were the whole of the actual gap.
 *
 *   * The 110 count included 19 strings that are not copy: six asset paths
 *     under `/assets/img/` and thirteen code identifiers (`rapidkert`, `ads`,
 *     `analytics`, …), collected because the walk looked at the *type* of a
 *     value and a path is a string. A translator handed
 *     `/assets/img/work-1.jpg` either wastes a minute on it or breaks an image.
 *     `NON_COPY_KEYS` below excludes them at the source, and the real figure is
 *     91.
 *
 * The count a worklist reports is the thing people act on, so it is worth more
 * care than a comment usually gets: 110 was not a rounding error, it was 19
 * items of busywork with two ways to go wrong.
 */

export type Locale = 'hu' | 'en' | 'de';

export const LOCALES: readonly Locale[] = ['hu', 'en', 'de'] as const;

const isLocale = (v: string): v is Locale => (LOCALES as readonly string[]).includes(v);

/**
 * The locale this document is being rendered in.
 *
 * Read from `<html lang>`, which the three homepage shells set statically. That
 * makes the locale a property of the *document* rather than of the URL, so it is
 * correct before any JavaScript runs, survives a static render, and is the same
 * value assistive technology is already using.
 */
export function detectLocale(doc: Document = document): Locale {
  const lang = (doc.documentElement.getAttribute('lang') || 'hu').slice(0, 2).toLowerCase();
  return isLocale(lang) ? lang : 'hu';
}

/** Where each locale's homepage lives. Mirrors the static site's layout. */
export const HOME_PATH: Record<Locale, string> = {
  hu: '/',
  en: '/en/',
  de: '/de/',
};

export const LOCALE_LABEL: Record<Locale, string> = { hu: 'HU', en: 'EN', de: 'DE' };

/** `Intl` tag per locale. `journey.ts` used to hard-code `hu-HU`. */
export const INTL_TAG: Record<Locale, string> = {
  hu: 'hu-HU',
  en: 'en-GB',
  de: 'de-DE',
};

/**
 * The site's pages, by locale.
 *
 * The three language trees use translated filenames — `rolunk.html`,
 * `about.html`, `ueber-uns.html` — so a homepage link cannot be one string with
 * a prefix swapped onto it. This is the same mapping `_build/build.py` applies
 * when it generates the other eleven pages; it is repeated here rather than
 * imported because the Python build and the Vite build do not share a runtime,
 * and a footer that links to a 404 in German is worse than a little duplication.
 *
 * `npm run build` regenerates the static pages from the same source, so a
 * rename shows up as a broken link in the link check rather than silently.
 */
type PageId = 'sme' | 'enterprise' | 'branding' | 'ads' | 'quote' | 'contact' | 'about'
  | 'imprint' | 'privacy';

const PAGES: Record<Locale, Record<PageId, string>> = {
  hu: {
    sme: 'kkv.html', enterprise: 'nagyvallalat.html', branding: 'branding.html',
    ads: 'hirdeteskezeles.html', quote: 'arajanlat.html', contact: 'ugyfelszolgalat.html',
    about: 'rolunk.html', imprint: 'impresszum.html', privacy: 'adatkezelesi-tajekoztato.html',
  },
  en: {
    sme: 'web-design-sme.html', enterprise: 'web-design-enterprise.html', branding: 'branding.html',
    ads: 'ads-management.html', quote: 'quote.html', contact: 'contact.html',
    about: 'about.html', imprint: 'imprint.html', privacy: 'privacy-policy.html',
  },
  de: {
    sme: 'webdesign-kmu.html', enterprise: 'webdesign-grossunternehmen.html', branding: 'branding.html',
    ads: 'werbeanzeigen.html', quote: 'angebot.html', contact: 'kontakt.html',
    about: 'ueber-uns.html', imprint: 'impressum.html', privacy: 'datenschutz.html',
  },
};

/** Absolute URL of one page in the active locale. */
export function pageHref(id: PageId, locale: Locale = active): string {
  return HOME_PATH[locale] + PAGES[locale][id];
}

type Table = Record<string, string>;

import { EN } from './locales/en';
import { DE } from './locales/de';
import { MESSAGES, type MessageKey } from './locales/messages';

const TABLES: Record<Locale, Table> = {
  hu: {},
  // Vite inlines these at build time. Both are `{}` today, so both builds add
  // two bytes and the tree-shaker cannot drop the lookup — which is correct:
  // the day a translator fills one in, nothing else has to change.
  en: EN,
  de: DE,
};

/** Strings that had no entry in the active locale's table. */
const misses = new Set<string>();

export function missingStrings(): string[] {
  return [...misses].sort();
}

/**
 * The active locale, resolved at module load.
 *
 * This is deliberately not a `setLocale()` that the app entry calls. `content.ts`
 * runs `localise()` at *its* module scope, and module evaluation order would
 * then decide whether the translation happened — a dependency of `content.ts`
 * has to already know the answer. Because `i18n.ts` is that dependency, doing
 * the detection here makes the ordering a property of the import graph instead
 * of something main.tsx has to remember.
 */
let active: Locale = typeof document === 'undefined' ? 'hu' : detectLocale();

/** Test seam. Re-running it after `content.ts` has loaded will not re-localise. */
export function setLocale(locale: Locale): void {
  active = locale;
  misses.clear();
}

export function getLocale(): Locale {
  return active;
}

/**
 * Translate one Hungarian source string.
 *
 * Hungarian is the source language, so on `hu` this is the identity function and
 * costs one comparison. On the other two it is a dictionary hit, and a miss
 * returns the Hungarian and records it.
 */
export function t(hu: string): string {
  if (active === 'hu') return hu;
  const hit = TABLES[active][hu];
  if (hit) return hit;
  if (hu.trim()) misses.add(hu);
  return hu;
}

/**
 * Resolve one keyed narrative message.
 *
 * The counterpart to `t`, and the mechanism for everything that is *markup*
 * rather than data — see `locales/messages.ts` for why the narrative cannot be
 * keyed on its own sentence the way `content.ts` is.
 *
 * There is no miss to record. `MessageKey` is `keyof typeof MESSAGES` and every
 * entry `satisfies Record<string, Message>`, so a key that does not exist is a
 * type error and a locale that is absent from an entry is a type error. The
 * worklist for these is therefore the compiler, not a runtime `Set` — which is
 * the whole reason to prefer them for copy a translator has to see in context.
 */
export function m(key: MessageKey): string {
  return MESSAGES[key][active];
}

/**
 * Content-model fields whose values are never copy, and are therefore neither
 * translated nor counted as an outstanding translation.
 *
 * `id` is a code identifier — `'rapidkert'`, `'analytics'` — used as a React
 * key, a `data-` attribute and a CSS hook. `src` is an asset path. Both are
 * strings in the same structures the narrative lives in, so a walk that only
 * looks at the *type* of a value cannot tell them apart from a sentence; before
 * this list existed the worklist handed a translator `/assets/img/work-1.jpg`
 * and `automation` alongside real prose, and a filled-in entry for either would
 * have broken a key, an image or a selector rather than translated anything.
 *
 * Deliberately not on the list: `alt`, `name`, `by` and `role`. Those *are*
 * user-facing — alt text is read aloud, and a proper noun still has to be
 * looked at by a person before it is decided that it stays as it is. Those are
 * kept in the tables with an identity value, which records the decision instead
 * of hiding it.
 */
export const NON_COPY_KEYS: ReadonlySet<string> = new Set(['id', 'src']);

/**
 * Deep-translate a content structure.
 *
 * Walks strings, arrays and plain objects, leaving everything else — numbers,
 * `null`, functions — identical. Object *keys* are never translated: they are
 * the content model's field names, not copy. A key in `NON_COPY_KEYS` has its
 * *value* left alone too.
 *
 * Returns a new value rather than mutating, so the untranslated source stays
 * available and a test can compare the two.
 */
export function localise<T>(value: T): T {
  if (typeof value === 'string') return t(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => localise(v)) as unknown as T;
  if (value && typeof value === 'object' && (value as object).constructor === Object) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = NON_COPY_KEYS.has(k) ? v : localise(v);
    }
    return out as T;
  }
  return value;
}

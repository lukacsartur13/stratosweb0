import { registerDictionary, type Lang } from '@/lib/i18n';

/**
 * Every translation, in ONE chunk that is loaded only when somebody has chosen
 * a language (i18n/index.ts). Nobody who reads the portal in its source
 * language downloads it.
 *
 * One file per source file in `parts/`, so screens are translated
 * independently. Each entry is keyed by the text exactly as it is written in
 * the code and gives the other languages:
 *
 *   { "Monthly contracts": { "hu": "Havi szerződések", "de": "Monatsverträge" } }   owner screens (English source)
 *   { "Nyersanyag leadása": { "en": "Hand over materials", "de": "Material übergeben" } }   client portal (Hungarian source)
 */
type Part = Record<string, Partial<Record<Lang, string>>>;

const parts = import.meta.glob<Part>('./parts/*.json', { eager: true, import: 'default' });

export function registerAll() {
  const by: Record<Lang, Record<string, string>> = { hu: {}, en: {}, de: {} };
  for (const part of Object.values(parts)) {
    for (const [key, langs] of Object.entries(part)) {
      for (const lang of ['hu', 'en', 'de'] as const) {
        const text = langs[lang];
        if (text) by[lang][key] = text;
      }
    }
  }
  for (const lang of ['hu', 'en', 'de'] as const) registerDictionary(lang, by[lang]);
}

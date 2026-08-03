import { HOME_PATH, LOCALES, LOCALE_LABEL, getLocale, m } from '../i18n';

/**
 * HU / EN / DE, matching the switcher the rest of the site already ships.
 *
 * The markup deliberately mirrors `_build/pages/*.html`: a `role="group"` with
 * an `aria-label`, one anchor per locale, `hreflang` and `lang` on each, and
 * `aria-current` on the active one. A visitor moving between the homepage and a
 * subpage should not be able to tell that one of them is React.
 *
 * These are real anchors to real documents, not client-side routing. Each
 * locale is its own HTML file emitted by `vite.home.config.ts`, and because all
 * three reference the same hashed chunks the switch costs one small document
 * and no JavaScript re-download.
 *
 * The three anchor labels are each language's own name in its own language, so
 * they need no translation. The *group* label does, and now gets it — see
 * `common.languageSwitch` in locales/messages.ts for why the trilingual string
 * that used to be here was wrong.
 */
export function LanguageSwitch() {
  const active = getLocale();
  return (
    <div className="lang" role="group" aria-label={m('common.languageSwitch')}>
      {LOCALES.map((code) => (
        <a
          key={code}
          href={HOME_PATH[code]}
          hrefLang={code}
          lang={code}
          {...(code === active ? { 'aria-current': 'true' as const } : {})}
        >
          {LOCALE_LABEL[code]}
        </a>
      ))}
    </div>
  );
}

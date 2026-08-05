// =============================================================================
// Where this site says it lives.
//
// One resolver, three consumers: scripts/assemble.mjs (sitemap and robots),
// experiments/vite.home.config.ts (the three homepage shells) and, in its own
// Python copy, _build/build.py (canonical and Open Graph on the other 33
// routes). Every absolute URL the site emits about itself comes from here.
//
// It is resolved rather than written down because the answer changes and has
// already been wrong once: every canonical and og:url pointed at
// `https://media-stratos.com`, which is a Wix site that 301s somewhere else.
// The planned arrangement is stratosweb.hu as the main domain and
// media-stratos.com secondary, but until that switch happens the site is served
// from a netlify.app subdomain — so hardcoding any of the three would be wrong
// for some period.
//
// ORDER
//   SITE_URL      an explicit override. Set this to force a value.
//   URL           Netlify sets this to the site's PRIMARY address — the custom
//                 domain once one is attached, the netlify.app subdomain until
//                 then. This is why nothing here has to choose between
//                 `stratosweb.hu` and `www.stratosweb.hu`: whichever is marked
//                 primary in Netlify is the one that appears in every canonical,
//                 automatically, with no second place to keep in step.
//   fallback      the intended main domain, for local builds.
// =============================================================================

export const FALLBACK_ORIGIN = 'https://stratosweb.hu';

/** The origin, with no trailing slash. */
export function siteOrigin(env = process.env) {
  const raw = env.SITE_URL || env.VITE_SITE_URL || env.URL || FALLBACK_ORIGIN;
  return String(raw).trim().replace(/\/+$/, '');
}

/**
 * Is this build a preview rather than the real site?
 *
 * True for a netlify.app address and for any Netlify context that is not
 * `production` — deploy previews and branch deploys. Used to keep a staging
 * copy out of the index: two crawlable copies of the same site compete with
 * each other, and the loser is usually not the one you wanted.
 */
export function isPreviewOrigin(env = process.env) {
  if (env.CONTEXT && env.CONTEXT !== 'production') return true;
  return /(^|\.)netlify\.app$/i.test(hostOf(siteOrigin(env)));
}

function hostOf(origin) {
  try {
    return new URL(origin).host;
  } catch {
    return '';
  }
}

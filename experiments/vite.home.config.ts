import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { siteAssets } from './vite-site-assets';
import { siteOrigin } from '../scripts/site-origin.mjs';

/**
 * The homepage build: the Altimeter Meridian ascent, served at `/`, `/en/` and
 * `/de/`.
 *
 * WHY THIS IS NOT `vite.full.config.ts` WITH A DIFFERENT `base`
 * -------------------------------------------------------------
 * `/experiments/stratos-ascent-full/` stays exactly where it is. It is the
 * fixed comparison baseline the benchmarks and `MERIDIAN_PERFORMANCE_AUDIT.md`
 * are written against, it is `noindex`, and the moment it shares a chunk graph
 * with the production homepage a change to one renames the other's hashed
 * chunks. Two configs, two output trees, one shared `src/full`.
 *
 * WHY THREE HTML INPUTS AND NOT THREE BUILDS
 * ------------------------------------------
 * The three locales are the same application. Building it three times would
 * produce three independently-hashed copies of React, three of `three`, and a
 * visitor who switches language would download the whole renderer again for
 * markup that is byte-identical apart from the `lang` attribute.
 *
 * One build with three HTML entries gives one chunk graph: `/`, `/en/` and
 * `/de/` all reference the same `/assets/home/*.js`, so the language switch is
 * an HTML document and nothing else — every chunk is already in cache. The
 * locale reaches the application through `<html lang>`, which each shell sets
 * statically, so it is correct before any JavaScript runs.
 */

/**
 * Emit `home/{hu,en,de}.html` as `index.html`, `en/index.html`, `de/index.html`.
 *
 * Vite derives an entry's output path from its location relative to the project
 * root, so without this the routes would be `/home/hu.html` and friends. Doing
 * the rename at emit time keeps the routes working on a plain static server
 * with no rewrite rules — the same reason `vite.full.config.ts` renames its
 * single entry, and what Netlify and the Playwright configs actually serve.
 */
/**
 * Substitute `%SITE_ORIGIN%` in the three homepage shells.
 *
 * The shells carry canonical, hreflang, og:url and og:image, all of which have
 * to be absolute. They used to hardcode `https://media-stratos.com` — a Wix
 * site that 301s elsewhere and was never this project's address. Resolving it
 * at build time means the homepage and the other 33 routes agree on one origin
 * without either of them stating it. See scripts/site-origin.mjs.
 */
function substituteOrigin(): Plugin {
  const origin = siteOrigin();
  return {
    name: 'stratos-site-origin',
    enforce: 'pre',
    transformIndexHtml(html) {
      if (html.includes('%SITE_ORIGIN%')) return html.split('%SITE_ORIGIN%').join(origin);
      // A shell that lost its placeholder would silently ship a relative
      // canonical, which is worse than a wrong one because nothing looks broken.
      throw new Error('a homepage shell has no %SITE_ORIGIN% placeholder');
    },
  };
}

/**
 * Substitute the site chrome into the three homepage shells.
 *
 * WHY THE CHROME IS GENERATED AND NOT WRITTEN HERE
 * ------------------------------------------------
 * The header, the full-screen menu, the Arrival and the ground-control footer
 * exist on 66 other routes. `_build/build.py` owns the slug table they link
 * against, the six primary destinations, the five services, the case-study
 * status gate and all three locales — so it renders them here too, into
 * `_build/home-chrome.json`, and this plugin drops the strings into the four
 * `<!--stratos:*-->` slots.
 *
 * The alternative was a React header component, and it is the wrong one: it
 * would be a second implementation of the same navigation, in a different
 * language, reading a second copy of the slug table, and the two would diverge
 * on the first route that was renamed. There is exactly one `.nav` in this
 * codebase and one `.foot`, and both of them are in build.py.
 *
 * `npm run build` runs `generate` (build.py) before `build:home`, so the file
 * is always current in a full build. It is committed for the same reason
 * `_build/routes.json` is: `npm run dev:home` must work without a Python run
 * first, and a diff on it is a readable record of what the homepage's chrome
 * actually is.
 */
function injectChrome(): Plugin {
  const SLOTS = ['head', 'deck', 'footer', 'scripts'] as const;
  const source = resolve(__dirname, '../_build/home-chrome.json');
  let chrome: Record<string, Record<string, string>> | null = null;

  return {
    name: 'stratos-home-chrome',
    enforce: 'pre',

    // Re-read on every transform rather than once at config time: in `dev:home`
    // the generator is a separate process, and a shell that still showed the
    // header from before a `npm run generate` would be a stale page nobody
    // could explain.
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        chrome = JSON.parse(readFileSync(source, 'utf8'));
        const lang = /home\/(hu|en|de)\.html$/.exec(ctx.filename.replace(/\\/g, '/'))?.[1];
        if (!lang || !chrome?.[lang]) {
          throw new Error(
            `no chrome for ${ctx.filename} — the homepage shells are home/{hu,en,de}.html`,
          );
        }
        for (const slot of SLOTS) {
          const token = `<!--stratos:${slot}-->`;
          // A shell that lost a slot would ship without a header or without a
          // footer and look, at a glance, exactly like one that never had them.
          if (!html.includes(token)) {
            throw new Error(`${ctx.filename} has no ${token} — the homepage shell lost a chrome slot`);
          }
          html = html.split(token).join(chrome[lang][slot]);
        }
        return html;
      },
    },
  };
}

function emitLocaleIndexes(): Plugin {
  const ROUTES: Record<string, string> = {
    'home/hu.html': 'index.html',
    'home/en.html': 'en/index.html',
    'home/de.html': 'de/index.html',
  };
  return {
    name: 'stratos-emit-locale-indexes',
    enforce: 'post',
    generateBundle(_options, bundle) {
      for (const [from, to] of Object.entries(ROUTES)) {
        const html = bundle[from];
        if (!html) {
          this.error(`expected ${from} in the bundle — the homepage inputs changed`);
          return;
        }
        delete bundle[from];
        html.fileName = to;
        bundle[to] = html;
      }
    },
  };
}

export default defineConfig({
  // Served from the site root. `/en/index.html` and `/de/index.html` reference
  // the same absolute `/assets/home/...` URLs, which is what makes one chunk
  // graph serve all three routes.
  base: '/',

  // The repo-root `public/` folder, exactly as the other two configs use it, so
  // the altimeter and mountain GLBs are reachable at `/models/...` with no copy
  // step and no second asset to keep in sync.
  publicDir: resolve(__dirname, '../public'),

  plugins: [react(), injectChrome(), substituteOrigin(), emitLocaleIndexes(), siteAssets(resolve(__dirname, '../assets'))],
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },

  build: {
    rollupOptions: {
      input: {
        hu: resolve(__dirname, 'home/hu.html'),
        en: resolve(__dirname, 'home/en.html'),
        de: resolve(__dirname, 'home/de.html'),
      },
      output: {
        // Namespaced under assets/home/ so this build can never collide with the
        // static site's hand-written `assets/css` and `assets/js`, which sit at
        // the same origin root and are copied in by scripts/assemble.mjs.
        entryFileNames: 'assets/home/[name]-[hash].js',
        chunkFileNames: 'assets/home/[name]-[hash].js',
        assetFileNames: 'assets/home/[name]-[hash][extname]',
      },
    },

    outDir: resolve(__dirname, '../dist'),

    // scripts/assemble.mjs has already populated dist/ by the time this runs,
    // and dist/portal is written by yet another build. Emptying here would
    // delete both. The three index.html files this emits deliberately overwrite
    // the ones assemble copied in.
    emptyOutDir: false,
    sourcemap: false,

    // No manualChunks, for the reason spelled out at length in
    // vite.full.config.ts: naming `three` as a manual chunk hoists it above the
    // dynamic-import boundary that is supposed to contain it, and the
    // reduced-motion and no-WebGL paths would eagerly download a renderer they
    // had already decided not to use.
  },

  server: { port: 5177, strictPort: false },
  preview: { port: 4326, strictPort: true },
});

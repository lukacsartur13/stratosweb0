import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
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

  plugins: [react(), substituteOrigin(), emitLocaleIndexes(), siteAssets(resolve(__dirname, '../assets'))],
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

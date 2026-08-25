import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { siteAssets } from './vite-site-assets';
import { siteOrigin } from '../scripts/site-origin.mjs';
import { MESSAGES } from './src/full/locales/messages';
import { pageHref, type Locale } from './src/full/i18n';

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

/**
 * The document's opening frame, as static markup inside the mount host.
 *
 * WHY THE FIRST SCREEN IS IN THE HTML
 * -----------------------------------
 * `<main class="journey">` is where React renders, and until it does the
 * document has nothing in its first viewport. That cost two of the five metrics
 * outright: the largest contentful paint was whatever the *footer* managed to
 * paint while waiting, and the first screen was blank for as long as the mount
 * took. Neither is a rendering problem — the page simply had not said anything
 * yet.
 *
 * It says it here instead. The headline and the lead sentence are the same two
 * strings both compositions open with, read from the same `MESSAGES` table they
 * read, so there is no second copy of the words to keep in step: a change to
 * `act.i.monument` changes the opening frame on the next build. The primary
 * action is the same `common.cta.ascend` link, resolved per locale through the
 * same `pageHref` the compositions use.
 *
 * WHY IT IS NOT A RENDERED COPY OF EITHER COMPOSITION
 * ---------------------------------------------------
 * There are two of them and one shell. `main.tsx` picks between the portrait
 * and the cinematic composition from `screen`'s short edge and the pointer
 * type, neither of which is knowable at build time or from a media query — so
 * prerendering one would be prerendering the wrong one for half the visitors.
 *
 * This is therefore a third thing, deliberately: the page's opening statement,
 * set plainly, before it becomes either composition. It is a handful of
 * elements with their own small block in `styles.css`, it reads correctly at
 * every width, and `createRoot`'s first commit removes it — see `mount()` in
 * `src/full/boot.tsx`.
 *
 * A shell that lost its slot is a build error, exactly as with the four chrome
 * slots above, and for the same reason: it would ship as a page that looks
 * finished and paints nothing.
 */
function openingFrame(): Plugin {
  const escape = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const frame = (lang: Locale) => {
    // The same five strings the Calibration panel opens with, in the same
    // order and with the same `<em>` on the same word — see `Calibration()` in
    // `src/full/FullAscent.tsx`. The line break between them is authored there
    // as a `<br />` and is authored here as two spans, because a heading that
    // re-wraps on its own is a different silhouette from the one that was
    // approved.
    const line1 = escape(MESSAGES['calibration.title.a'][lang]);
    const em = escape(MESSAGES['calibration.title.em'][lang]);
    const line2 = escape(MESSAGES['calibration.title.b'][lang]);
    return [
      '<div class="jboot" data-journey-opening>',
      '  <h1 class="jboot__h">',
      `    <span>${line1}</span>`,
      `    <span><em>${em}</em> ${line2}</span>`,
      '  </h1>',
      `  <p class="jboot__lede">${escape(MESSAGES['calibration.lead'][lang])}</p>`,
      `  <p class="jboot__act"><a href="${pageHref('quote', lang)}">${escape(MESSAGES['common.cta.ascend'][lang])}</a></p>`,
      '</div>',
    ].join('\n');
  };

  return {
    name: 'stratos-opening-frame',
    enforce: 'pre',
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        const lang = /home\/(hu|en|de)\.html$/.exec(ctx.filename.replace(/\\/g, '/'))?.[1] as
          | Locale
          | undefined;
        if (!lang) throw new Error(`no locale for ${ctx.filename} — the homepage shells are home/{hu,en,de}.html`);
        const token = '<!--stratos:opening-->';
        if (!html.includes(token)) {
          throw new Error(`${ctx.filename} has no ${token} — the homepage shell lost its opening frame`);
        }
        return html.split(token).join(frame(lang));
      },
    },
  };
}

/**
 * Publish the journey's chunk URLs so the entry can prefetch them at idle.
 *
 * `main.tsx` waits for the visitor to touch the page before it imports the
 * journey, which is what keeps 300 KB of React and three.js off the critical
 * path. Left there, the cost would simply have moved: the first `pointermove`
 * would start a cold download and the mount would wait on the network.
 *
 * So the bytes are fetched at the browser's lowest priority after `load`, and
 * the mount finds them in cache. The file names are content-hashed, so the only
 * place that can know them is here, after the bundle is generated. They are
 * emitted as JSON rather than as `<link>` tags in the markup because a `<link
 * rel="prefetch">` in the HTML is requested during the load it is meant to stay
 * out of.
 *
 * `application/json` is not executable, so `script-src 'self'` in netlify.toml
 * has nothing to say about it — the same reason the `#i18n` block beside it is
 * allowed to be inline.
 */
/**
 * Put the homepage's render-blocking stylesheets into the document.
 *
 * WHY, WITH NUMBERS
 * -----------------
 * Four stylesheets stand between this route and its first paint: `type.css`,
 * `chrome.css` and `transitions.css` from the shared static site, plus the
 * journey's own bundle. Together they are about 16 KB compressed — small — but
 * they are four separate requests that cannot even be *discovered* until the
 * HTML has arrived, so on a phone they cost a whole round trip before anything
 * can be drawn. Lighthouse's own estimate on the built page: 420 ms.
 *
 * Inlined, they arrive with the document that needs them and the first paint
 * waits on one response instead of five. The HTML grows from about 6 KB
 * compressed to about 20 KB, which is a fifth of a round trip's worth of extra
 * bytes to remove an entire round trip.
 *
 * WHY ONLY HERE, AND NOT ON THE OTHER 66 ROUTES
 * ---------------------------------------------
 * Because they share those files with each other and this route does not share
 * its own. `chrome.css` and `type.css` are one cache entry across the whole
 * site: a visitor who arrives anywhere has them for everywhere. Inlining them
 * into all 69 documents would trade one cached file for sixty-nine copies of it
 * — better on the first page, worse on every page after.
 *
 * The homepage is the exception worth making because it is the page people
 * arrive on, most often cold, most often on a phone, and it is the one route
 * whose stylesheet nobody else uses. It keeps the shared files *available* —
 * they are still on disk, still fingerprinted, still what every other route
 * links to — so the second page a visitor opens costs exactly what it did.
 *
 * `style-src` in netlify.toml is already `'self' 'unsafe-inline'`, for the
 * per-frame custom properties the journey writes onto style attributes, so this
 * needs no policy change. Nothing here inlines a *script*: `script-src` stays
 * `'self'` with no exceptions, which is the part of that policy worth keeping.
 */
function inlineCriticalCss(): Plugin {
  // The shared stylesheets, taken from dist rather than from the source tree:
  // `scripts/assemble.mjs` has already run by the time this build starts, and
  // the copy it made is the minified one that would have shipped. Inlining the
  // source would put 68 KB of comments into three documents.
  const shared = resolve(__dirname, '../dist/assets/css');

  return {
    name: 'stratos-inline-critical-css',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const inlined = new Set<string>();

      const styleFor = (href: string): string | null => {
        const path = href.split('?')[0];

        if (path.startsWith('/assets/css/')) {
          const file = resolve(shared, path.slice('/assets/css/'.length));
          if (!existsSync(file)) {
            this.error(`${path} is not in dist — assemble.mjs did not run before build:home`);
            return null;
          }
          // `@font-face` in type.css addresses its files as `../fonts/…`, which
          // resolves against the *stylesheet* while it is a stylesheet and
          // against the *document* once it is inlined — so at `/en/` it would
          // become `/en/fonts/…` and every face would 404. Absolute is the only
          // form that means the same thing in both places.
          return readFileSync(file, 'utf8').split('url(../fonts/').join('url(/assets/fonts/');
        }

        if (path.startsWith('/assets/home/')) {
          const asset = bundle[path.slice(1)];
          if (!asset || asset.type !== 'asset') return null;
          inlined.add(asset.fileName);
          return String(asset.source);
        }

        return null;
      };

      const LINK = /[ \t]*<link rel="stylesheet"[^>]*href="([^"]+)"[^>]*>\n?/g;

      for (const asset of Object.values(bundle)) {
        if (asset.type !== 'asset' || !asset.fileName.endsWith('.html')) continue;
        let count = 0;
        const html = String(asset.source).replace(LINK, (tag, href: string) => {
          const css = styleFor(href);
          if (css === null) return tag;
          count += 1;
          return `    <style>${css}</style>\n`;
        });
        if (count === 0) this.error(`${asset.fileName} has no stylesheet to inline — the shell changed shape`);
        asset.source = html;
      }

      // The emitted entry stylesheet is now a copy of bytes that are in all
      // three documents, and nothing links to it. Left in place it would be
      // dead weight in dist and — worse — a URL the prefetch manifest would
      // hand the browser at idle. The async chunk's own stylesheet is untouched:
      // that one is still fetched, by `__vitePreload`, when the journey mounts.
      for (const fileName of inlined) {
        delete bundle[fileName];
        for (const chunk of Object.values(bundle)) {
          if (chunk.type !== 'chunk') continue;
          chunk.viteMetadata?.importedCss?.delete(fileName);
        }
      }
    },
  };
}

function journeyChunks(): Plugin {
  return {
    name: 'stratos-journey-chunks',
    enforce: 'post',
    generateBundle(_options, bundle) {
      // The chunk and everything it imports statically. `facadeModuleId` is
      // null on a chunk Rollup merged other modules into, so the dynamic entry
      // is identified by its `name` — which is the source file's stem.
      const chunkNamed = (name: string) =>
        Object.values(bundle).find((c) => c.type === 'chunk' && c.isDynamicEntry && c.name === name);

      const walk = (start: string | undefined, into = new Set<string>()) => {
        if (!start) return into;
        const chunk = bundle[start];
        if (!chunk || chunk.type !== 'chunk' || into.has('/' + chunk.fileName)) return into;
        into.add('/' + chunk.fileName);
        for (const css of chunk.viteMetadata?.importedCss ?? []) into.add('/' + css);
        for (const imported of chunk.imports) walk(imported, into);
        return into;
      };

      const boot = chunkNamed('boot');
      if (!boot) {
        this.error('no dynamic boot chunk in the bundle — src/full/main.tsx stopped deferring the mount');
        return;
      }

      // Three lists, because there are three answers. `core` is React and both
      // compositions, which every visitor needs the moment they engage. The
      // other two are the renderers, and a visitor needs exactly one of them —
      // prefetching both would spend a phone's data on a scene it has no
      // composition to draw. `main.tsx` asks `isMobileHomepage()` and takes one.
      const manifest = {
        core: [...walk(boot.fileName)],
        mobile: [...walk(chunkNamed('MobileInstrument')?.fileName)],
        desktop: [...walk(chunkNamed('JourneyScene')?.fileName)],
      };
      // A renderer that stopped being its own chunk would be a renderer on the
      // critical path, which is the defect this whole arrangement exists to
      // prevent — so it fails the build rather than quietly shipping.
      for (const [key, list] of Object.entries(manifest)) {
        if (!list.length) this.error(`the ${key} chunk list is empty — the homepage's code split changed shape`);
      }

      const tag =
        `<script id="journey-chunks" type="application/json">${JSON.stringify(manifest)}</script>`;
      for (const asset of Object.values(bundle)) {
        if (asset.type !== 'asset' || !asset.fileName.endsWith('.html')) continue;
        const html = String(asset.source);
        if (!html.includes('</head>')) continue;
        asset.source = html.replace('</head>', `  ${tag}\n  </head>`);
      }
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

  plugins: [
    react(),
    injectChrome(),
    openingFrame(),
    substituteOrigin(),
    inlineCriticalCss(),
    journeyChunks(),
    emitLocaleIndexes(),
    siteAssets(resolve(__dirname, '../assets')),
  ],
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

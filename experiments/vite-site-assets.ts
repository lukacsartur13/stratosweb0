import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { Connect, Plugin } from 'vite';

/**
 * Serve the site's hand-written `assets/` tree on the dev server.
 *
 * ## The defect
 *
 * The case-study imagery is referenced by root-relative URL — `/assets/img/
 * work-1.jpg` — because that is what it is in production and what the other
 * eleven static pages already use. In production it resolves: `scripts/
 * assemble.mjs` copies the repo-root `assets/` tree into `dist/assets/`, and
 * the Vite build emits its own output alongside it under `assets/home/`, so one
 * static server answers both.
 *
 * On the dev server it did not, and the way it failed is why it survived so
 * long. Vite's `publicDir` here is the repo-root `public/`, which holds
 * `models/` and `draco/` and nothing else, and the project root is
 * `experiments/`. Neither contains `assets/img`, so the request fell through to
 * the SPA fallback and came back **200 OK with `Content-Type: text/html`** —
 * the index document, served in place of a JPEG. There is no 404 in the network
 * panel and no error in the console; the browser simply fails to decode an
 * image and draws the broken-image box. Every dev-server still captured at
 * 12 000 m, where the case studies are on screen, carried them.
 *
 * ## Why a middleware rather than moving files or changing the URL
 *
 * Moving `assets/` under `public/` would change what `assemble.mjs` copies and
 * what eleven generated pages link to. Making the URLs relative would break
 * them on `/en/` and `/de/`, which are nested one level down — a relative
 * `assets/img/work-1.jpg` from `/en/` asks for `/en/assets/img/work-1.jpg`.
 * Both of those change production to fix development, which is backwards: the
 * production URLs are correct and are the ones under test.
 *
 * So this closes the gap where the gap actually is. It runs in
 * `configureServer` only — dev and `vite preview` never share a code path with
 * `build`, and this plugin emits nothing — so the built output is byte-identical
 * with and without it.
 *
 * ## Scope
 *
 * Only `/assets/**`, only files that exist, and only inside the resolved root:
 * the path is normalised and re-checked against the root before anything is
 * opened, so `..` cannot walk out of it. Anything that is not a plain file
 * under there — including `/assets/home/*`, which is Vite's own build output
 * and does not exist on disk in development — falls through to the next
 * middleware untouched.
 */

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

export function siteAssets(rootDir: string): Plugin {
  const root = resolve(rootDir);
  let base = '/';

  return {
    name: 'stratos-site-assets',
    apply: 'serve',

    // The dev server needs the *resolved* base, not the literal one: a config
    // may omit it, and Vite normalises what it is given.
    configResolved(config) {
      base = config.base;
    },

    configureServer(server) {
      const handler: Connect.NextHandleFunction = (req, res, next) => {
        // Query strings and hashes are not part of the path, and a decode
        // failure means the request was never going to name a real file.
        let pathname: string;
        try {
          pathname = decodeURIComponent((req.url ?? '/').split('?')[0].split('#')[0]);
        } catch {
          return next();
        }

        const file = normalize(join(root, pathname));
        // The containment check, done on the resolved path rather than by
        // inspecting the URL for `..`. Anything that normalises outside the
        // assets root is somebody else's request.
        if (file !== root && !file.startsWith(root + sep)) return next();

        let stat;
        try {
          stat = statSync(file);
        } catch {
          return next();
        }
        if (!stat.isFile()) return next();

        res.setHeader('Content-Type', MIME[extname(file).toLowerCase()] ?? 'application/octet-stream');
        res.setHeader('Content-Length', String(stat.size));
        // No caching in development, so replacing an image is visible on the
        // next reload rather than on the next hard reload.
        res.setHeader('Cache-Control', 'no-cache');
        createReadStream(file).pipe(res);
      };

      // Two mount points, because in development the URL that reaches the
      // server is not the one written in the HTML.
      //
      // `/assets/css/type.css` is correct in production for every route: the
      // stylesheet, the fonts and the eleven generated pages all sit under one
      // `dist/assets/` tree served by one static server, and a build leaves the
      // URL untouched (Vite warns that it cannot resolve it and emits it
      // verbatim, which is the wanted behaviour).
      //
      // The dev server does not do that. It rewrites every root-relative URL in
      // HTML by prepending `base`, so under this config the browser asks for
      // `/experiments/stratos-ascent-full/assets/css/type.css` — a path that
      // never reached a middleware mounted at `/assets`, fell through to the
      // SPA fallback, and came back as the index document with
      // `Content-Type: text/html`. A stylesheet served as HTML is dropped
      // silently: no 404, no console error, and `--font-display` simply never
      // exists, so the whole page renders in the browser's default serif.
      //
      // That is exactly how the full-ascent route came to be validated in Times
      // while production rendered Archivo. Mounting the same handler at both
      // paths closes it. Connect strips the mount prefix before the handler
      // runs, so one handler serves both without knowing which it answered.
      server.middlewares.use('/assets', handler);
      if (base !== '/') server.middlewares.use(base.replace(/\/$/, '') + '/assets', handler);
    },
  };
}

import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { siteAssets } from './vite-site-assets';

/**
 * Emit the entry as `index.html` instead of `full.html`.
 *
 * The source file cannot simply be called `index.html` — that name is already
 * taken in this folder by the short prototype's entry, and Vite resolves an
 * entry's output path from its location relative to the project root, so
 * putting it in a subfolder would emit `.../stratos-ascent-full/full/index.html`
 * and the route would gain a directory nobody asked for.
 *
 * Renaming at emit time keeps one flat output and, more usefully, keeps the
 * route working on a plain static server with no rewrite rules — which is what
 * both the Playwright config and Netlify actually serve it with.
 */
function emitAsIndex(): Plugin {
  return {
    name: 'stratos-emit-as-index',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const html = bundle['full.html'];
      if (!html) return;
      delete bundle['full.html'];
      html.fileName = 'index.html';
      bundle['index.html'] = html;
    },
  };
}

// -----------------------------------------------------------------------------
// The full 0–30 000 m journey gets its own Vite config rather than becoming a
// second HTML entry inside vite.config.ts.
//
// A multi-page build would share one `base`, one chunk graph and one
// `emptyOutDir`, which means:
//
//   * the two routes' chunks get hashed and split together, so a change here
//     can rename and invalidate the short prototype's chunks — and the whole
//     point of keeping that route is that it stays a fixed comparison baseline;
//   * measuring either route's eager payload becomes an exercise in working out
//     which shared chunk belongs to whom.
//
// Two configs, two output directories, two independent chunk graphs. The source
// tree is still shared: this route imports `@/lib/capabilities` (stateless, no
// `three`) from the prototype, and both routes load the same GLB from the same
// `public/models/` path — one copy on disk, one download.
//
// Run from the repo root:  npm run build:full  /  npm run dev:full
// -----------------------------------------------------------------------------
export default defineConfig({
  base: '/experiments/stratos-ascent-full/',

  // The repo-root `public/` folder, served verbatim, exactly as the prototype
  // does — so the altimeter GLB is reachable at
  // /experiments/stratos-ascent-full/models/stratos-altimeter.glb with no copy
  // step and no second asset to keep in sync.
  publicDir: resolve(__dirname, '../public'),

  plugins: [react(), emitAsIndex(), siteAssets(resolve(__dirname, '../assets'))],
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },

  build: {
    rollupOptions: {
      input: resolve(__dirname, 'full.html'),
    },

    outDir: resolve(__dirname, '../dist/experiments/stratos-ascent-full'),
    emptyOutDir: true,
    sourcemap: false,

    // No manualChunks, deliberately, and this is load-bearing rather than a
    // default left alone.
    //
    // Naming `three` and `@react-three/*` as manual chunks turns them into a
    // *static* import of the entry chunk: Rollup hoists a manually-named chunk
    // above the dynamic-import boundary that was supposed to contain it, and
    // Vite then emits `<link rel="modulepreload">` for both in the HTML. The
    // reduced-motion and no-WebGL paths would download ~1.1 MB of renderer they
    // had already decided not to use — while every lazy-loading test still
    // passed, because the import *is* still dynamic. It is a silent regression
    // and the tests in experiments/tests/full-ascent.spec.ts assert against it
    // by inspecting the built HTML, not just the network log.
    //
    // Letting Rollup split along the dynamic import keeps the promise, and the
    // route's cost stays legible because the scene is one lazy chunk.
  },

  server: { port: 5176, strictPort: false },
  preview: { port: 4325, strictPort: true },
});

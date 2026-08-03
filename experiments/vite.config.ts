import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// -----------------------------------------------------------------------------
// The experiments app is deliberately its own Vite project, not a page inside
// the portal and not a route in the static generator:
//
//   * the static site has no bundler at all — it is Python-generated HTML — so
//     there is nowhere to put React Three Fiber without inventing a build step
//     for the production site;
//   * the portal is private, authenticated and cache-busted `no-store`, and its
//     bundle budget has nothing to do with a marketing hero.
//
// Keeping it separate means `npm run build` at the root is byte-for-byte what
// it was before this folder existed, and nothing here can reach Netlify by
// accident. See experiments/README.md.
// -----------------------------------------------------------------------------
export default defineConfig({
  base: '/experiments/stratos-ascent/',

  // The GLB lives at the repo-root `public/models/` the brief asked for. Vite
  // serves this folder verbatim, so the model is reachable at
  // /experiments/stratos-ascent/models/stratos-altimeter.glb in dev and build
  // alike, with one copy on disk.
  publicDir: resolve(__dirname, '../public'),

  plugins: [react()],
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },

  build: {
    // Written under dist/ so a single static server can serve the site and the
    // prototype side by side while they are being compared. `npm run build`
    // does not call this, and assemble.mjs clears only what it owns.
    outDir: resolve(__dirname, '../dist/experiments/stratos-ascent'),
    emptyOutDir: true,
    sourcemap: false,

    // No manualChunks here, deliberately. Naming `three` and `@react-three/*`
    // as manual chunks turned them into a *static* import of the entry chunk —
    // Rollup hoists a manually-named chunk above the dynamic-import boundary
    // that was supposed to contain it — and Vite then emitted
    // `<link rel="modulepreload">` for both in index.html. The reduced-motion
    // path downloaded ~1.1 MB of renderer it had already decided not to use.
    // Letting Rollup split along the dynamic import instead keeps that promise;
    // the prototype's cost stays legible because the scene is one lazy chunk.
  },

  server: { port: 5175, strictPort: false },
  preview: { port: 4323, strictPort: true },
});

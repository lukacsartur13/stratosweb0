import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// The portal is served from /portal on the same host as the static site, so it
// is built with that base and emitted straight into the site's dist folder.
// Netlify publishes `dist`, which therefore contains the static pages at the
// root and this SPA underneath them.
export default defineConfig({
  base: '/portal/',
  plugins: [react()],
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  build: {
    outDir: resolve(__dirname, '../dist/portal'),
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      output: {
        // Supabase is the single largest dependency and changes on a different
        // cadence than our code, so it gets its own long-lived chunk.
        manualChunks: {
          supabase: ['@supabase/supabase-js'],
          vendor: ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
  server: { port: 5174 },
});

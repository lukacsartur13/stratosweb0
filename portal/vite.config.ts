import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { supabaseKeyKind } from '../scripts/supabase-key-kind.mjs';

// The portal is served from /portal on the same host as the static site, so it
// is built with that base and emitted straight into the site's dist folder.
// Netlify publishes `dist`, which therefore contains the static pages at the
// root and this SPA underneath them.
export default defineConfig(({ mode }) => {
  // Every VITE_* value is compiled into the bundle every visitor downloads. The
  // Supabase key there must be the PUBLIC one (publishable, or the legacy anon
  // JWT). A secret key here would be published with the site, so the build
  // stops instead — before anything is written — and names only the variable,
  // never its value.
  const env = { ...loadEnv(mode, __dirname, 'VITE_'), ...process.env };
  if (supabaseKeyKind(env.VITE_SUPABASE_ANON_KEY) === 'secret') {
    throw new Error(
      'VITE_SUPABASE_ANON_KEY holds a Supabase SECRET key. Only the publishable/anon key may be '
      + 'compiled into the portal. Replace it, and rotate the secret key if this build was ever shared.',
    );
  }

  return {
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
  };
});

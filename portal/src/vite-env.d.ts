/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_SITE_URL?: string;
  // No VITE_ANALYTICS_ID. The public site's measurement is configured at build
  // time (ANALYTICS_ENDPOINT, read by _build/build.py) and never reaches this
  // bundle; the portal is private and is not measured at all.
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

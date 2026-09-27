// Types for supabase-key-kind.mjs, which is plain JavaScript because its other
// consumer (scripts/secret-scan.mjs) is. Only the Vite config needs this.

/** `public` may ship in a bundle; `secret` must never; `unknown` is not a Supabase key. */
export declare function supabaseKeyKind(key: unknown): 'missing' | 'public' | 'secret' | 'unknown';

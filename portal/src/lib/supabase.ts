import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Only the anon key ever reaches the browser. It is not a secret — it is a
// public identifier that says "an anonymous or logged-in user is asking" — and
// everything it can actually do is decided by the RLS policies in
// supabase/migrations/20260801000200_rls.sql. The service role key is never
// imported here; it exists only in the Netlify functions runtime.
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isConfigured = Boolean(url && anonKey);

/**
 * Without credentials the portal still has to boot, so that `npm run dev` and
 * the Playwright suite can exercise routing, guards and empty states without a
 * live project. Calls made through this stub reject with a recognisable error
 * which the UI turns into "not configured" rather than a stack trace.
 */
function makeStub(): SupabaseClient {
  const err = () =>
    Promise.reject(
      new Error(
        'Supabase is not configured. Copy .env.example to .env and set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
      ),
    );
  const table = {
    select: () => ({
      order: () => err(),
      eq: () => err(),
      limit: () => err(),
      then: (r: unknown) => err().then(r as never),
    }),
    insert: err,
    update: err,
    delete: err,
    upsert: err,
  };
  return {
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe() {} } },
      }),
      signInWithPassword: err,
      signOut: async () => ({ error: null }),
      resetPasswordForEmail: err,
      updateUser: err,
    },
    from: () => table,
  } as unknown as SupabaseClient;
}

export const supabase: SupabaseClient = isConfigured
  ? createClient(url!, anonKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        // The portal is a single origin app; PKCE is the right flow and is what
        // the future Google/Microsoft providers will need anyway.
        flowType: 'pkce',
      },
    })
  : makeStub();

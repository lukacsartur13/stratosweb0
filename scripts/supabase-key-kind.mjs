// =============================================================================
// Which kind of Supabase key is this — the one that may ship in a browser
// bundle, or the one that must never leave the server?
//
// Supabase has two public keys and two secret ones, and they are easy to mix up
// because the legacy pair look identical from the outside:
//
//   public   sb_publishable_…       the current publishable key
//            a JWT whose role is `anon`   the legacy anon key
//   secret   sb_secret_…            the current secret key
//            a JWT with ANY other role    the legacy server key (bypasses RLS)
//
// The public ones are identifiers, not secrets: every visitor's browser holds
// one and RLS decides what it can do. Treating one as a leak is a false alarm,
// and "fixing" that alarm by removing it breaks the Portal. Treating a secret
// one as public is a breach. So the decision is made from what the key SAYS
// (its prefix, or the role inside the JWT payload), never from its shape alone.
//
// A JWT that cannot be decoded is classed as secret: unknown is not safe.
//
// Used by scripts/secret-scan.mjs and portal/vite.config.ts. The browser runtime
// keeps its own copy (portal/src/lib/supabase.ts → `keyKind`), and
// tests/portal-documents.spec.ts asserts the two agree.
// =============================================================================

/** @param {string} segment */
function decodeSegment(segment) {
  const b64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

/**
 * @param {unknown} key
 * @returns {'missing' | 'public' | 'secret' | 'unknown'}
 */
export function supabaseKeyKind(key) {
  if (typeof key !== 'string' || key.trim() === '') return 'missing';
  const k = key.trim();
  if (k.startsWith('sb_publishable_')) return 'public';
  if (k.startsWith('sb_secret_')) return 'secret';
  const parts = k.split('.');
  if (parts.length === 3 && parts[0].startsWith('eyJ')) {
    try {
      const payload = decodeSegment(parts[1]);
      return payload && payload.role === 'anon' ? 'public' : 'secret';
    } catch {
      return 'secret';
    }
  }
  return 'unknown';
}

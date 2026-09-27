/**
 * Public or secret? The same decision as scripts/supabase-key-kind.mjs, which
 * the build uses to refuse a secret key outright; repeated here because the
 * browser bundle cannot import from outside `portal/` (tests/portal-documents.spec.ts
 * asserts the two agree). A publishable key or an anon-role JWT is public; a
 * secret key or a JWT with any other role — or one that cannot be read — is not.
 */
export function keyKind(key: string | undefined): 'missing' | 'public' | 'secret' | 'unknown' {
  if (!key || !key.trim()) return 'missing';
  const k = key.trim();
  if (k.startsWith('sb_publishable_')) return 'public';
  if (k.startsWith('sb_secret_')) return 'secret';
  const parts = k.split('.');
  if (parts.length === 3 && parts[0].startsWith('eyJ')) {
    try {
      const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const bytes = Uint8Array.from(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0));
      const payload = JSON.parse(new TextDecoder().decode(bytes)) as { role?: unknown };
      return payload.role === 'anon' ? 'public' : 'secret';
    } catch {
      return 'secret';
    }
  }
  return 'unknown';
}

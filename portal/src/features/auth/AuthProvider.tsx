import {
  createContext, useContext, useEffect, useMemo, useState, type ReactNode,
} from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, isConfigured } from '@/lib/supabase';
import type { Role } from '@/lib/permissions';

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  role: Role;
  organization_id: string | null;
}

interface AuthState {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  configured: boolean;
  signIn(email: string, password: string): Promise<{ error: string | null }>;
  signOut(): Promise<void>;
  requestReset(email: string): Promise<{ error: string | null }>;
  updatePassword(password: string): Promise<{ error: string | null }>;
}

const Ctx = createContext<AuthState | null>(null);

/**
 * Supabase returns precise auth errors ("Invalid login credentials" vs "User
 * not found"). Precise is useful to us and useful to someone enumerating which
 * addresses have accounts, so the UI gets one message for every failure to
 * authenticate. The real reason stays in the network response, which only the
 * person already holding the session can read.
 */
function safeAuthError(raw: string | undefined): string {
  if (!raw) return 'Sign-in failed. Please try again.';
  if (/rate|too many/i.test(raw)) return 'Too many attempts. Please wait a minute and try again.';
  if (/not confirmed|confirm/i.test(raw)) return 'Please confirm your email address first — check your inbox.';
  return 'Those details did not match an account.';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      setSession(data.session);
      if (!data.session) setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!alive) return;
      setSession(next);
      if (!next) {
        setProfile(null);
        setLoading(false);
      }
    });

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // The role is read from `profiles`, never from the JWT's user metadata —
  // metadata is user-writable and would be a privilege escalation waiting to
  // happen. This select is itself filtered by the profiles_select_self policy.
  useEffect(() => {
    if (!session?.user) return;
    let alive = true;
    setLoading(true);

    (async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, email, full_name, avatar_url, role, organization_id')
        .eq('id', session.user.id)
        .single();

      if (!alive) return;
      if (error) {
        console.warn('Could not load profile:', error.message);
        setProfile(null);
      } else {
        setProfile(data as Profile);
      }
      setLoading(false);
    })();

    return () => { alive = false; };
  }, [session?.user?.id]);

  const value = useMemo<AuthState>(() => ({
    session,
    profile,
    loading,
    configured: isConfigured,

    // Every method below swallows thrown errors as well as returned ones. A
    // network failure and a rejected credential must be indistinguishable from
    // the outside, and an unhandled rejection here would otherwise leave the
    // submit button stuck in its pending state.
    async signIn(email, password) {
      try {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        return { error: error ? safeAuthError(error.message) : null };
      } catch {
        return { error: 'Sign-in is unavailable right now. Please try again shortly.' };
      }
    },

    async signOut() {
      await supabase.auth.signOut();
      setProfile(null);
    },

    async requestReset(email) {
      try {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/portal/reset-password`,
        });
        // Deliberately not surfaced as "no such user": the same confirmation is
        // shown either way so the form cannot be used to test whether an address
        // has an account here. Rate limiting is the one thing worth saying out
        // loud, because the visitor can act on it.
        return {
          error: error && /rate|too many/i.test(error.message)
            ? 'Too many attempts. Please wait a minute and try again.'
            : null,
        };
      } catch {
        return { error: null };
      }
    },

    async updatePassword(password) {
      try {
        const { error } = await supabase.auth.updateUser({ password });
        return { error: error ? error.message : null };
      } catch {
        return { error: 'Could not save the new password. Request a fresh link.' };
      }
    },
  }), [session, profile, loading]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { isConfigured } from './config';
import { supabase } from './supabase';

interface SessionState {
  session: Session | null;
  /** True until the stored session has been read: the app shows nothing rather than flashing the sign-in. */
  loading: boolean;
  signIn(email: string, password: string): Promise<string | null>;
  signOut(): Promise<void>;
}

const Ctx = createContext<SessionState | null>(null);

/**
 * One message for every failed sign-in, as in the Portal (AuthProvider's
 * safeAuthError): a precise one tells a stranger which addresses have accounts.
 */
function refusal(message: string | undefined, status: number | undefined): string {
  if (status === 0 || /fetch|network/i.test(message ?? '')) return 'Nincs kapcsolat. Ellenőrizd a netet, és próbáld újra.';
  if (/rate|too many/i.test(message ?? '')) return 'Túl sok próbálkozás. Várj egy percet, és próbáld újra.';
  if (/not confirmed|confirm/i.test(message ?? '')) return 'Előbb erősítsd meg az e-mail-címed — nézd meg a postafiókod.';
  return 'Ezekkel az adatokkal nem található fiók.';
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(isConfigured);

  useEffect(() => {
    if (!isConfigured) return;
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  const value = useMemo<SessionState>(() => ({
    session,
    loading,
    async signIn(email, password) {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      return error ? refusal(error.message, error.status) : null;
    },
    async signOut() {
      // This device only. The default ('global') would also end the Portal in
      // every browser and the Claude connector's session.
      await supabase.auth.signOut({ scope: 'local' });
    },
  }), [session, loading]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionState {
  const value = useContext(Ctx);
  if (!value) throw new Error('useSession outside SessionProvider');
  return value;
}

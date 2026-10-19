import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, processLock } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';
import { SUPABASE_ANON_KEY, SUPABASE_URL, isConfigured } from './config';

/**
 * The same Supabase project and the same accounts as the Portal: the owner and
 * client accounts sign in here with the password they use there.
 *
 * An unconfigured build gets placeholder values so createClient does not throw;
 * the sign-in screen says what is missing and nothing is ever called.
 */
export const supabase = createClient(
  isConfigured ? SUPABASE_URL : 'https://unconfigured.invalid',
  isConfigured ? SUPABASE_ANON_KEY : 'unconfigured',
  {
    auth: {
      // On the web the client keeps the session in localStorage by itself.
      ...(Platform.OS !== 'web' ? { storage: AsyncStorage } : {}),
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      lock: processLock,
    },
  },
);

// Refresh the token only while the app is in front (Supabase's advice for React Native).
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') void supabase.auth.startAutoRefresh();
    else void supabase.auth.stopAutoRefresh();
  });
}

import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SessionProvider, useSession } from '@/lib/session';
import { usePalette } from '@/lib/theme';

void SplashScreen.preventAutoHideAsync();

/** Signed in: the home screen. Signed out: the sign-in. Expo Router sends each to the other's screen. */
function Routes() {
  const { session, loading } = useSession();
  const c = usePalette();
  useEffect(() => { if (!loading) void SplashScreen.hideAsync(); }, [loading]);
  if (loading) return null;
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.ink } }}>
      <Stack.Protected guard={!!session}>
        <Stack.Screen name="index" />
      </Stack.Protected>
      <Stack.Protected guard={!session}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <StatusBar style="auto" />
        <Routes />
      </SessionProvider>
    </SafeAreaProvider>
  );
}

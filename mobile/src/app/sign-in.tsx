import { useState } from 'react';
import { KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Field, Mark, Notice } from '@/components/ui';
import { isConfigured, PORTAL_URL } from '@/lib/config';
import { useSession } from '@/lib/session';
import { usePalette } from '@/lib/theme';

/**
 * The Portal's own accounts and passwords. There is no sign-up: owner and client
 * accounts are made in the Portal (a client through the invite link), and a
 * forgotten password is reset there too.
 */
export default function SignIn() {
  const c = usePalette();
  const { signIn } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (busy || !email.trim() || !password) return;
    setBusy(true);
    setError(await signIn(email, password));
    setBusy(false);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.ink }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
          <View style={s.form}>
            <Mark />
            <Text style={[s.title, { color: c.paper }]} accessibilityRole="header">Bejelentkezés</Text>
            <Text style={[s.lead, { color: c.haze }]}>Ugyanazzal az e-mail-címmel és jelszóval, amellyel a Stratos portálra lépsz be.</Text>
            {!isConfigured && (
              <Notice tone="danger">Az app nincs beállítva: hiányzik az EXPO_PUBLIC_SUPABASE_URL vagy az EXPO_PUBLIC_SUPABASE_ANON_KEY (mobile/.env.example).</Notice>
            )}
            <Field label="E-mail" value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false}
                   keyboardType="email-address" autoComplete="email" textContentType="username" returnKeyType="next" />
            <Field label="Jelszó" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password"
                   textContentType="password" returnKeyType="go" onSubmitEditing={() => void submit()} />
            {error ? <Notice tone="danger">{error}</Notice> : null}
            <Button title={busy ? 'Bejelentkezés…' : 'Bejelentkezés'} onPress={() => void submit()}
                    disabled={busy || !isConfigured || !email.trim() || !password} />
            <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(`${PORTAL_URL}forgot-password`)} style={s.link}>
              <Text style={{ color: c.haze, fontSize: 14 }}>Elfelejtett jelszó? <Text style={{ color: c.signalInk }}>Új jelszó kérése a portálon</Text></Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  page: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  form: { gap: 16, width: '100%', maxWidth: 420, alignSelf: 'center' },
  title: { fontSize: 28, fontWeight: '600', marginTop: 24 },
  lead: { fontSize: 15, lineHeight: 22, marginTop: -8 },
  link: { minHeight: 44, justifyContent: 'center' },
});

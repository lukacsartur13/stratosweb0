import { Linking, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ClientHome } from '@/components/ClientHome';
import { OwnerHome } from '@/components/OwnerHome';
import { Button, Mark, Muted, Notice, Spinner } from '@/components/ui';
import { PORTAL_URL } from '@/lib/config';
import { clock } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useSummary, type SummaryError } from '@/lib/summary';
import { usePalette } from '@/lib/theme';

const PROBLEM: Record<SummaryError, string> = {
  OFFLINE: 'Nincs kapcsolat. Húzd le a frissítéshez, ha újra van net.',
  UNAVAILABLE: 'A portál most nem válaszolt. Húzd le az újrapróbáláshoz.',
  FORBIDDEN: 'Ez a fiók nem használhatja az appot: a Stratos ügyfeleinek és a tulajdonosnak szól.',
  // The hook signs out at once; the sign-in screen follows.
  UNAUTHENTICATED: 'A bejelentkezés lejárt.',
};

/** Home: the owner's Today or a client's projects, by who signed in. */
export default function Home() {
  const c = usePalette();
  const { signOut } = useSession();
  const { data, error, refreshing, reload } = useSummary();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.ink }} edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={s.page}
        refreshControl={<RefreshControl refreshing={refreshing && !!data} onRefresh={() => void reload()} tintColor={c.haze} />}>
        <View style={s.column}>
          {data?.kind === 'owner' ? <OwnerHome summary={data} />
            : data?.kind === 'client' ? <ClientHome summary={data} />
            : <Mark />}
          {!data && !error ? <Spinner /> : null}
          {error ? <Notice tone={data ? undefined : 'danger'}>{PROBLEM[error]}</Notice> : null}
          {!data && error && error !== 'FORBIDDEN' ? <Button title="Újra" onPress={() => void reload()} /> : null}
          <View style={s.footer}>
            {data ? <Muted>Frissítve: {clock(data.generatedAt)}</Muted> : null}
            <Button variant="quiet" title={data?.kind === 'client' ? 'Ügyfélportál megnyitása' : 'Portál megnyitása'}
                    onPress={() => void Linking.openURL(PORTAL_URL)} />
            <Button variant="quiet" title="Kijelentkezés" onPress={() => void signOut()} />
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  page: { padding: 20, paddingBottom: 48 },
  column: { gap: 12, width: '100%', maxWidth: 560, alignSelf: 'center' },
  footer: { gap: 8, marginTop: 12 },
});

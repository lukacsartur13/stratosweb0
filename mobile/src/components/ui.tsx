import type { ReactNode } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { clock, KIND, shortDay, when } from '@/lib/format';
import type { Line, NextMeeting } from '@/lib/summary';
import { usePalette } from '@/lib/theme';

/**
 * The few pieces every screen is made of, in the Portal's three surfaces:
 * the page (ink), a section (deck) and an interaction (the yellow button).
 */

export function Mark() {
  const c = usePalette();
  return <Text style={[s.mark, { color: c.paper }]} accessibilityRole="header">STRATOS</Text>;
}

export function Header({ kicker, title }: { kicker: string; title: string }) {
  const c = usePalette();
  return (
    <View style={s.header}>
      <Mark />
      <Text style={[s.kicker, { color: c.haze }]}>{kicker}</Text>
      <Text style={[s.title, { color: c.paper }]} accessibilityRole="header">{title}</Text>
    </View>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  const c = usePalette();
  return (
    <View style={[s.section, { backgroundColor: c.deck, borderColor: c.hair }]}>
      <Text style={[s.sectionTitle, { color: c.haze }]} accessibilityRole="header">{title}</Text>
      {children}
    </View>
  );
}

export function Stat({ value, label, tone }: { value: number; label: string; tone?: 'danger' }) {
  const c = usePalette();
  return (
    <View style={[s.stat, { backgroundColor: c.deck, borderColor: c.hair }]} accessible accessibilityLabel={`${value} ${label}`}>
      <Text style={[s.statValue, { color: tone === 'danger' && value > 0 ? c.danger : c.paper }]}>{value}</Text>
      <Text style={[s.statLabel, { color: c.haze }]}>{label}</Text>
    </View>
  );
}

export function Muted({ children }: { children: ReactNode }) {
  const c = usePalette();
  return <Text style={[s.muted, { color: c.haze }]}>{children}</Text>;
}

export function Notice({ children, tone }: { children: ReactNode; tone?: 'danger' }) {
  const c = usePalette();
  return (
    <Text accessibilityRole="alert" style={[s.notice, { color: tone === 'danger' ? c.danger : c.haze, borderColor: c.hair }]}>
      {children}
    </Text>
  );
}

export function Button({ title, onPress, disabled, variant = 'primary' }:
  { title: string; onPress: () => void; disabled?: boolean; variant?: 'primary' | 'quiet' }) {
  const c = usePalette();
  const primary = variant === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        primary ? { backgroundColor: c.signal } : { borderColor: c.hair, borderWidth: StyleSheet.hairlineWidth },
        (pressed || disabled) && { opacity: 0.6 },
      ]}>
      <Text style={[s.buttonText, { color: primary ? c.onSignal : c.paper }]}>{title}</Text>
    </Pressable>
  );
}

export function Field({ label, ...input }: { label: string } & TextInputProps) {
  const c = usePalette();
  return (
    <View style={s.field}>
      <Text style={[s.fieldLabel, { color: c.haze }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={c.haze}
        style={[s.input, { color: c.paper, backgroundColor: c.field, borderColor: c.hair }]}
        {...input}
      />
    </View>
  );
}

export function Spinner() {
  const c = usePalette();
  return <ActivityIndicator color={c.haze} style={{ marginVertical: 48 }} />;
}

/** One line of the Today list or of "Rád várunk": what it is, when, and the thing itself. */
export function LineRow({ line, today, first }: { line: Line; today: string; first: boolean }) {
  const c = usePalette();
  const due = line.startsAt ? `ma ${clock(line.startsAt)}`
    : line.late && line.due ? `késik · ${shortDay(line.due)}`
    : line.due === today ? 'ma'
    : line.due ? `határidő: ${shortDay(line.due)}`
    : null;
  return (
    <View style={[s.line, !first && { borderTopColor: c.hairline, borderTopWidth: StyleSheet.hairlineWidth }]}>
      <Text style={[s.lineMeta, { color: line.late ? c.danger : c.haze }]}>
        {KIND[line.kind]}{due ? ` · ${due}` : ''}
      </Text>
      {line.title ? <Text style={[s.lineTitle, { color: c.paper }]}>{line.title}</Text> : null}
      {line.detail ? <Text style={[s.lineDetail, { color: c.haze }]}>{line.detail}</Text> : null}
    </View>
  );
}

export function MeetingCard({ meeting, today }: { meeting: NextMeeting; today: string }) {
  const c = usePalette();
  const url = meeting.joinUrl;
  return (
    <Section title="Következő megbeszélés">
      <Text style={[s.when, { color: c.signalInk }]}>{when(meeting.startsAt, today)}</Text>
      <Text style={[s.lineTitle, { color: c.paper }]}>
        {meeting.kind === 'booking' ? `Foglalt időpont${meeting.title ? ` · ${meeting.title}` : ''}` : meeting.title ?? 'Megbeszélés'}
      </Text>
      {meeting.detail ? <Text style={[s.lineDetail, { color: c.haze }]}>{meeting.detail}</Text> : null}
      {url ? <View style={{ marginTop: 12 }}><Button title="Csatlakozás" onPress={() => void Linking.openURL(url)} /></View> : null}
    </Section>
  );
}

const s = StyleSheet.create({
  mark: { fontSize: 13, letterSpacing: 4, fontWeight: '500' },
  header: { gap: 4, marginBottom: 4 },
  kicker: { fontSize: 13, marginTop: 20 },
  title: { fontSize: 28, fontWeight: '600' },
  section: { borderRadius: 6, borderWidth: StyleSheet.hairlineWidth, padding: 16 },
  sectionTitle: { fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 8 },
  stat: { flex: 1, borderRadius: 6, borderWidth: StyleSheet.hairlineWidth, paddingVertical: 14, paddingHorizontal: 12 },
  statValue: { fontSize: 28, fontWeight: '600', fontVariant: ['tabular-nums'] },
  statLabel: { fontSize: 12, marginTop: 2 },
  muted: { fontSize: 14, lineHeight: 20 },
  notice: { fontSize: 13, lineHeight: 19, borderWidth: StyleSheet.hairlineWidth, borderRadius: 6, padding: 12 },
  button: { minHeight: 44, borderRadius: 4, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  buttonText: { fontSize: 15, fontWeight: '600' },
  field: { gap: 6 },
  fieldLabel: { fontSize: 13 },
  input: { minHeight: 44, borderRadius: 4, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, fontSize: 16 },
  line: { paddingVertical: 10, gap: 2 },
  lineMeta: { fontSize: 12 },
  lineTitle: { fontSize: 15, lineHeight: 21 },
  lineDetail: { fontSize: 13 },
  when: { fontSize: 20, fontWeight: '600', marginBottom: 4 },
});

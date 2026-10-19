import { View } from 'react-native';
import { longDay } from '@/lib/format';
import type { OwnerSummary } from '@/lib/summary';
import { Header, LineRow, MeetingCard, Muted, Section, Stat } from './ui';

/** The owner's home: the Portal's Today page in brief, the same numbers the widget shows. */
export function OwnerHome({ summary }: { summary: OwnerSummary }) {
  const { today, items, day } = summary;
  const more = today.total - items.length;
  return (
    <>
      <Header kicker={longDay(day)} title="Ma" />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Stat value={today.total} label="mára" />
        <Stat value={today.late} label="késik" tone="danger" />
        <Stat value={summary.newLeads} label="új lead" />
      </View>
      {summary.nextMeeting ? <MeetingCard meeting={summary.nextMeeting} today={day} /> : null}
      <Section title="Teendők">
        {items.length === 0
          ? <Muted>Mára nincs teendő.</Muted>
          : items.map((line, i) => <LineRow key={`${line.kind}-${i}`} line={line} today={day} first={i === 0} />)}
        {more > 0 ? <Muted>+{more} további a portál Ma oldalán</Muted> : null}
      </Section>
    </>
  );
}

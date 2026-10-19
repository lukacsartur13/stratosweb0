import { Text, View } from 'react-native';
import type { ClientSummary } from '@/lib/summary';
import { usePalette } from '@/lib/theme';
import { Header, LineRow, MeetingCard, Muted, Section } from './ui';

/** A client's home: the client portal's front page in brief — what Stratos waits for, the next meeting, the projects. */
export function ClientHome({ summary }: { summary: ClientSummary }) {
  const c = usePalette();
  const { items, day } = summary;
  const more = summary.waitingOnYou.total - items.length;
  return (
    <>
      <Header kicker={summary.me.company} title={summary.me.name} />
      {summary.nextMeeting ? <MeetingCard meeting={summary.nextMeeting} today={day} /> : null}
      <Section title={`Rád várunk${summary.waitingOnYou.total ? ` · ${summary.waitingOnYou.total}` : ''}`}>
        {items.length === 0
          ? <Muted>Most nem várunk tőled semmire.</Muted>
          : items.map((line, i) => <LineRow key={`${line.kind}-${i}`} line={line} today={day} first={i === 0} />)}
        {more > 0 ? <Muted>+{more} további az ügyfélportálon</Muted> : null}
      </Section>
      <Section title="Projektjeim">
        {summary.projects.length === 0
          ? <Muted>Még nincs projekted a portálon.</Muted>
          : (
            <View style={{ gap: 8 }}>
              {summary.projects.map((p) => <Text key={p.id} style={{ color: c.paper, fontSize: 15 }}>{p.name}</Text>)}
            </View>
          )}
      </Section>
    </>
  );
}

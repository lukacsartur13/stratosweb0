import { Badge } from '@/components/ui';
import { stageLabel, stageTone } from '@/lib/pipeline';

/**
 * The two pieces of Sales that the LEADS screens need.
 *
 * ## Why this file exists at all
 *
 * `pages/leads.tsx` and `pages/lead-detail.tsx` are in the entry bundle — they
 * are two of the four screens an operator opens without thinking, so App.tsx
 * imports them eagerly. `pages/sales.tsx` is lazily loaded and must stay that
 * way: it is the pipeline board, the table, the follow-up view and the
 * performance page, and none of that belongs in the first paint of the Portal.
 *
 * Importing `StageBadge` from `pages/sales` — which is where it naturally wanted
 * to live — quietly defeated that. Vite said so plainly:
 *
 *     sales.tsx is dynamically imported by App.tsx but also statically imported
 *     by lead-detail.tsx, leads.tsx — dynamic import will not move module into
 *     another chunk
 *
 * One badge dragged the whole Sales module into the entry chunk. So the shared
 * pieces live here, in a file small enough that having it in the entry bundle
 * costs nothing, and the two big screens stay split.
 */

/** A pipeline stage, drawn the same way everywhere it appears. */
export function StageBadge({ stage }: { stage: string }) {
  return <Badge tone={stageTone(stage)}>{stageLabel(stage)}</Badge>;
}

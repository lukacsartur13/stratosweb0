import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, isConfigured } from '@/lib/supabase';
import { useAuth } from '@/features/auth/AuthProvider';

/**
 * The lead pipeline: the status model, the mutations, the notes and the
 * timeline.
 *
 * ## Why this is a small module and not a CRM
 *
 * The brief is explicit that this must not become an oversized CRM, and the
 * shape below is what that constraint produces: six stages, one mutation, one
 * append-only note table and a timeline assembled from records that already
 * exist. There is no assignment, no scoring, no reminder, no pipeline value and
 * no custom field, because none of those has a source of truth in this system
 * and inventing one would mean inventing the data to fill it.
 *
 * ## Where authority lives
 *
 * The database. Every write here is unqualified — `update leads set status` —
 * and succeeds or fails on the RLS policy, not on anything this file
 * remembered to check. `permissions.ts` decides whether the control is drawn;
 * `leads_admin_write` decides whether the change happens. If they ever disagree
 * the database wins and the user sees an error rather than someone else's row
 * quietly changing.
 */

/* ================================================================== stages == */

export const PIPELINE = ['new', 'contacted', 'qualified', 'proposal', 'won', 'lost'] as const;
export type Stage = (typeof PIPELINE)[number];

/**
 * Everything a status needs to be drawn, in one table.
 *
 * `spam` is present and is NOT in `PIPELINE`. Rows already carry it, so it has
 * to render; it is not a stage anyone can move a lead into from the Portal,
 * because "this was junk" is a judgement made once at triage and not a step on
 * the way to a sale.
 */
export const STATUS: Record<string, { label: string; tone: 'neutral' | 'good' | 'warn' | 'bad'; note: string }> = {
  new: { label: 'New', tone: 'warn', note: 'Arrived and not yet answered.' },
  contacted: { label: 'Contacted', tone: 'neutral', note: 'We have replied.' },
  qualified: { label: 'Qualified', tone: 'neutral', note: 'A real fit, worth a proposal.' },
  proposal: { label: 'Proposal', tone: 'neutral', note: 'A quote is with them.' },
  won: { label: 'Won', tone: 'good', note: 'Became a client.' },
  lost: { label: 'Lost', tone: 'bad', note: 'Went elsewhere, or went quiet.' },
  spam: { label: 'Spam', tone: 'bad', note: 'Junk. Kept, not deleted.' },
};

export const statusLabel = (status: string) => STATUS[status]?.label ?? status;
export const statusTone = (status: string) => STATUS[status]?.tone ?? 'neutral';

/** The four public forms, plus the pre-envelope fallback. */
export const FORM_LABEL: Record<string, string> = {
  newsletter: 'Newsletter',
  contact: 'Contact',
  impact: 'Impact',
  questionnaire: 'Questionnaire',
  website: 'Website',
};

/* ================================================================== a lead == */

export interface Lead {
  id: string;
  name: string;
  email: string;
  company: string | null;
  message: string | null;
  service_interest: string | null;
  budget_range: string | null;
  status: string;
  created_at: string;
  // Written by the canonical envelope — see netlify/functions/lead-contract.mjs.
  // Every one is nullable because rows created before that migration have none.
  form_type: string | null;
  locale: string | null;
  source_route: string | null;
  submission_id: string | null;
  payload: Record<string, unknown> | null;
  // Timing, coarse context and campaign attribution. Never user-entered text —
  // the server copies only the keys META declares in lead-contract.mjs, so
  // whatever a browser sent, only those can be here.
  meta: Record<string, unknown> | null;
}

export const LEAD_COLUMNS =
  'id, name, email, company, message, service_interest, budget_range, status, created_at, '
  + 'form_type, locale, source_route, submission_id, payload, meta';

/* =============================================================== attribution */

/** A `meta` value as a string, or null. `meta` is jsonb and can hold anything. */
export const metaText = (lead: Lead, key: string): string | null => {
  const value = lead.meta && typeof lead.meta === 'object'
    ? (lead.meta as Record<string, unknown>)[key]
    : undefined;
  if (value === null || value === undefined || value === '') return null;
  return String(value);
};

/**
 * Group leads by one attribute, biggest first.
 *
 * This is the whole of "leads by source / medium / campaign / landing page /
 * locale / form type": one function over rows the Portal already has, rather
 * than six queries or six GA4 dimensions.
 *
 * It is deliberately aggregate. Nothing here associates a named lead with a GA4
 * user, and nothing here goes back to GA4 at all — it counts rows the Portal is
 * already authorised to read, by a field those rows already carry.
 */
export function groupBy(
  leads: Lead[],
  key: (lead: Lead) => string | null,
  limit = 8,
): { key: string; value: number }[] {
  const counts = new Map<string, number>();
  for (const lead of leads) {
    const value = key(lead) ?? '(not set)';
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([k, value]) => ({ key: k, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

/** The attribution facets the Leads screen offers. */
export const FACETS: { id: string; label: string; of: (lead: Lead) => string | null }[] = [
  { id: 'source', label: 'Source', of: (l) => metaText(l, 'utmSource') ?? metaText(l, 'landingReferrerHost') },
  { id: 'medium', label: 'Medium', of: (l) => metaText(l, 'utmMedium') },
  { id: 'campaign', label: 'Campaign', of: (l) => metaText(l, 'utmCampaign') },
  { id: 'landing', label: 'Landing page', of: (l) => metaText(l, 'landingRoute') },
  { id: 'form', label: 'Form', of: (l) => (l.form_type ? FORM_LABEL[l.form_type] ?? l.form_type : null) },
  { id: 'locale', label: 'Locale', of: (l) => l.locale },
];

/* ==================================================================== notes */

export interface Note {
  id: string;
  lead_id: string;
  body: string;
  created_at: string;
  author_id: string | null;
  author: { full_name: string | null; email: string } | null;
}

export interface TimelineEntry {
  id: string;
  at: string;
  kind: 'received' | 'status' | 'note' | 'notified' | 'other';
  title: string;
  detail?: string;
  by?: string | null;
}

interface LogRow {
  id: string;
  action: string;
  created_at: string;
  metadata: Record<string, unknown> | null;
  user_id: string | null;
  actor: { full_name: string | null; email: string } | null;
}

/**
 * A lead's notes and its timeline, loaded together.
 *
 * Together because they are one screen and two round trips are two loading
 * states; and because the timeline is partly ASSEMBLED FROM the notes — a note
 * being added is an event on the lead, and reading them separately would mean
 * the two panels could disagree about whether one exists.
 *
 * ## What is in the timeline, and what deliberately is not
 *
 * Only things that were recorded:
 *
 *   received         `leads.created_at`, which every row has
 *   notified         an `activity_logs` row written by POST /api/lead
 *   status changed   an `activity_logs` row written by a database trigger
 *   note added       a `lead_notes` row
 *
 * Leads that predate the trigger and the audit row have neither, and their
 * timelines show only what they actually have. Filling that gap with inferred
 * events — "presumably contacted, since the status is 'contacted'" — is the one
 * thing a timeline must never do, because the whole value of it is that it
 * happened.
 */
export function useLeadDetail(leadId: string | null) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [log, setLog] = useState<LogRow[]>([]);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');

  const load = useCallback(async () => {
    if (!leadId || !isConfigured) return;
    setState('loading');

    const [noteRes, logRes] = await Promise.all([
      supabase
        .from('lead_notes')
        .select('id, lead_id, body, created_at, author_id, author:profiles(full_name, email)')
        .eq('lead_id', leadId)
        .order('created_at', { ascending: false }),
      supabase
        .from('activity_logs')
        .select('id, action, created_at, metadata, user_id, actor:profiles(full_name, email)')
        .eq('entity_type', 'lead')
        .eq('entity_id', leadId)
        .order('created_at', { ascending: false })
        .limit(100),
    ]);

    // A missing table is not an error worth shouting about: the migration may
    // not have been applied yet, and the rest of the screen is still useful.
    // Anything else is logged and shown as an empty panel rather than a crash.
    if (noteRes.error) console.error('[lead_notes]', noteRes.error);
    if (logRes.error) console.error('[activity_logs]', logRes.error);

    setNotes((noteRes.data ?? []) as unknown as Note[]);
    setLog((logRes.data ?? []) as unknown as LogRow[]);
    setState(noteRes.error && logRes.error ? 'error' : 'ready');
  }, [leadId]);

  useEffect(() => { void load(); }, [load]);

  return { notes, log, state, reload: load };
}

/** Assemble the timeline from what was recorded, newest first. */
export function buildTimeline(lead: Lead, notes: Note[], log: LogRow[]): TimelineEntry[] {
  const who = (row: { full_name: string | null; email: string } | null) =>
    row ? row.full_name || row.email : null;

  const entries: TimelineEntry[] = [
    {
      id: `received-${lead.id}`,
      at: lead.created_at,
      kind: 'received',
      title: 'Enquiry received',
      detail: [
        lead.form_type ? FORM_LABEL[lead.form_type] ?? lead.form_type : null,
        lead.source_route,
      ].filter(Boolean).join(' · ') || undefined,
    },
  ];

  for (const note of notes) {
    entries.push({
      id: `note-${note.id}`,
      at: note.created_at,
      kind: 'note',
      title: 'Note added',
      detail: note.body,
      by: who(note.author),
    });
  }

  for (const row of log) {
    if (row.action === 'lead.status_changed') {
      const from = String(row.metadata?.from ?? '?');
      const to = String(row.metadata?.to ?? '?');
      entries.push({
        id: `log-${row.id}`,
        at: row.created_at,
        kind: 'status',
        title: `Status ${statusLabel(from)} → ${statusLabel(to)}`,
        // Null when the change did not come from a signed-in session — a
        // service-key write, or SQL run in the dashboard. Null is the honest
        // answer and the screen renders nothing rather than a name.
        by: who(row.actor),
      });
    } else if (row.action === 'lead.received') {
      const notified = row.metadata?.notified;
      entries.push({
        id: `log-${row.id}`,
        at: row.created_at,
        kind: 'notified',
        title: notified === true
          ? 'Notification sent'
          : notified === false
            ? 'Notification not sent'
            : 'Notification attempted',
        detail: row.metadata?.notifyReason ? String(row.metadata.notifyReason) : undefined,
      });
    } else {
      entries.push({
        id: `log-${row.id}`,
        at: row.created_at,
        kind: 'other',
        title: row.action,
        by: who(row.actor),
      });
    }
  }

  return entries.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}

/* ================================================================ mutations */

/**
 * Change a lead's status, and add a note.
 *
 * Both return an error string or null. Neither optimistically mutates the list:
 * a status change that RLS refuses must not leave the screen showing a value
 * the database does not hold, and the reload after a success is one query
 * against a table the screen is already reading.
 */
export function useLeadMutations(onChanged: () => void) {
  const { profile } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);

  const setStatus = useCallback(async (leadId: string, status: Stage) => {
    setBusy(leadId);
    const { error } = await supabase.from('leads').update({ status }).eq('id', leadId);
    setBusy(null);
    if (error) {
      console.error('[leads.status]', error);
      return 'The database refused that change. Check that your account may edit leads.';
    }
    onChanged();
    return null;
  }, [onChanged]);

  const addNote = useCallback(async (leadId: string, body: string) => {
    const text = body.trim();
    if (!text) return 'Write something first.';
    if (!profile) return 'Your session has expired. Sign in again.';

    setBusy(leadId);
    // `author_id` is set from the signed-in profile and the policy requires it
    // to equal `auth.uid()`, so this cannot be used to write in someone else's
    // name even by editing the request.
    const { error } = await supabase
      .from('lead_notes')
      .insert({ lead_id: leadId, author_id: profile.id, body: text });
    setBusy(null);
    if (error) {
      console.error('[lead_notes.insert]', error);
      return error.code === '42P01'
        ? 'Notes are not set up in this database yet. Run the migrations in supabase/migrations.'
        : 'The database refused that note.';
    }
    onChanged();
    return null;
  }, [onChanged, profile]);

  return { setStatus, addNote, busy };
}

/* ================================================================= filtering */

/**
 * The Leads screen's filter, search and sort, done in the browser.
 *
 * The list is capped at 200 rows by `useRows`, which is the whole dataset for
 * this business for the foreseeable future, and filtering 200 objects in memory
 * is instant. Pushing it into PostgREST would mean a round trip per keystroke
 * for a result the client already has.
 */
export type Sort = 'newest' | 'oldest' | 'name' | 'status';

export function useLeadFilter(leads: Lead[]) {
  const [query, setQuery] = useState('');
  const [stage, setStage] = useState<string>('all');
  const [sort, setSort] = useState<Sort>('newest');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let rows = leads;

    if (stage !== 'all') rows = rows.filter((l) => l.status === stage);
    if (q) {
      rows = rows.filter((l) =>
        [l.name, l.company, l.email, l.message, l.service_interest, l.source_route]
          .some((field) => String(field ?? '').toLowerCase().includes(q)));
    }

    const order = [...rows];
    if (sort === 'newest') order.sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (sort === 'oldest') order.sort((a, b) => a.created_at.localeCompare(b.created_at));
    if (sort === 'name') order.sort((a, b) => a.name.localeCompare(b.name));
    if (sort === 'status') {
      // Pipeline order, not alphabetical: 'contacted' before 'lost' before
      // 'new' is a sort nobody asked for.
      const rank = (s: string) => {
        const i = (PIPELINE as readonly string[]).indexOf(s);
        return i === -1 ? PIPELINE.length : i;
      };
      order.sort((a, b) => rank(a.status) - rank(b.status) || b.created_at.localeCompare(a.created_at));
    }
    return order;
  }, [leads, query, stage, sort]);

  const counts = useMemo(() => {
    const out: Record<string, number> = { all: leads.length };
    for (const lead of leads) out[lead.status] = (out[lead.status] ?? 0) + 1;
    return out;
  }, [leads]);

  return { query, setQuery, stage, setStage, sort, setSort, filtered, counts };
}

/** How many leads arrived in the last `days` days. */
export const since = (leads: Lead[], days: number) => {
  const from = Date.now() - days * 86_400_000;
  return leads.filter((l) => new Date(l.created_at).getTime() >= from).length;
};

/** Leads received today, in the viewer's own timezone. */
export const today = (leads: Lead[]) => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return leads.filter((l) => new Date(l.created_at).getTime() >= start.getTime()).length;
};

export const formatWhen = (value: string | null | undefined) => {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString('en-GB', {
      year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit',
    });
};

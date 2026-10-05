// =============================================================================
// The commercial model.
//
// Stages, probabilities, pipeline arithmetic, profitability and the rules that
// decide what needs attention. Everything in this file is a PURE FUNCTION over
// plain data, and the file has NO IMPORTS but the pure `./i18n` (whose `t`
// returns its key in Node) — which is what lets
// `tests/portal-revenue.spec.ts` import it directly and assert the authoritative
// totals rather than assert that a screenshot has a number on it.
//
// WHERE THE AUTHORITY IS
// ----------------------
// Split, deliberately, and in the direction that makes each half trustworthy:
//
//   The DATABASE owns the aggregates the Dashboard reads. `portal_sales_summary()`
//   sums the pipeline server-side under the caller's own RLS, so the Dashboard
//   never loads the business to print six figures (§59).
//
//   THIS FILE owns the arithmetic that turns those aggregates into the things a
//   person reads — weighted values, margins, revenue per hour — and the rules
//   that decide whether a record is a problem.
//
// Neither half guesses. Where a figure cannot be computed the answer is `null`,
// and every screen renders `null` as "Not recorded" rather than as zero (§31).
// =============================================================================

// The one import this file may have: `t` and `intlLocale` are pure too, and in
// Node (the tests) `t` returns its key. The label maps below stay in English —
// module-level text is evaluated once, before any language is chosen — and the
// accessor functions translate them where they are read.
import { t, intlLocale } from './i18n.ts';

/* ================================================================= stages == */

export const STAGES = ['qualified', 'discovery', 'proposal', 'negotiation', 'won', 'lost'] as const;
export type Stage = (typeof STAGES)[number];

/** The stages a deal is still live in. The pipeline is the sum of these. */
export const OPEN_STAGES: Stage[] = ['qualified', 'discovery', 'proposal', 'negotiation'];

export const isOpen = (stage: string): boolean => (OPEN_STAGES as string[]).includes(stage);

/**
 * Everything a stage needs to be drawn, plus its default probability.
 *
 * ## The defaults are conventions, not measurements
 *
 * §6 is emphatic about this and so is the schema comment: 20 / 40 / 60 / 80 are
 * OPERATIONAL DEFAULTS. They are what a new opportunity starts at so that a
 * forecast exists on day one; they are not Stratos's measured win rates, because
 * Stratos has no measured win rates yet — there is no closed history to compute
 * them from.
 *
 * They are editable on every opportunity and the stored value always wins. The
 * day there is enough closed history, `winRate()` below is what will replace
 * them, and the fact that the number was always stored per-deal is what will
 * make that a reporting change rather than a migration.
 */
export const STAGE: Record<Stage, {
  label: string;
  probability: number;
  tone: 'neutral' | 'good' | 'warn' | 'bad';
  note: string;
}> = {
  qualified:   { label: 'Qualified',   probability: 20,  tone: 'neutral', note: 'A real commercial fit.' },
  discovery:   { label: 'Discovery',   probability: 40,  tone: 'neutral', note: 'We are working out the scope.' },
  proposal:    { label: 'Proposal',    probability: 60,  tone: 'warn',    note: 'A quote is with them.' },
  negotiation: { label: 'Negotiation', probability: 80,  tone: 'warn',    note: 'Terms are being agreed.' },
  won:         { label: 'Won',         probability: 100, tone: 'good',    note: 'Signed.' },
  lost:        { label: 'Lost',        probability: 0,   tone: 'bad',     note: 'Went elsewhere, or went quiet.' },
};

export const stageLabel = (stage: string) => { const s = STAGE[stage as Stage]; return s ? t(s.label) : stage; };
export const stageTone = (stage: string) => STAGE[stage as Stage]?.tone ?? 'neutral';
export const defaultProbability = (stage: string) => STAGE[stage as Stage]?.probability ?? 20;

/* ============================================================ lost reasons == */

export const LOST_REASONS = [
  'price', 'no_response', 'competitor', 'timing', 'scope_mismatch', 'internal_decision', 'other',
] as const;
export type LostReason = (typeof LOST_REASONS)[number];

export const LOST_REASON_LABEL: Record<LostReason, string> = {
  price: 'Price',
  no_response: 'No response',
  competitor: 'Competitor',
  timing: 'Timing',
  scope_mismatch: 'Scope mismatch',
  internal_decision: 'Internal decision',
  other: 'Other',
};

/* =============================================================== the shapes */

/** The subset of an opportunity every calculation here needs. */
export interface Deal {
  id: string;
  stage: string;
  estimated_value: number | null;
  currency: string;
  probability: number;
  expected_close_on: string | null;
  next_action: string | null;
  next_action_on: string | null;
  organization_id: string | null;
  archived_at?: string | null;
}

/** One row of `portal_sales_summary()`. */
export interface SummaryRow {
  bucket: string;
  currency: string | null;
  items: number;
  value: number;
  weighted: number;
}

/* ========================================================= pipeline maths == */

/**
 * `estimated value × probability` — the one calculation the whole forecast
 * rests on (§7).
 *
 * Null in, null out. An opportunity with no value has no weighted value either,
 * and treating a missing value as zero would make the forecast quietly lower
 * than the truth rather than visibly incomplete.
 */
export function weighted(deal: Pick<Deal, 'estimated_value' | 'probability'>): number | null {
  if (deal.estimated_value === null || deal.estimated_value === undefined) return null;
  return (deal.estimated_value * deal.probability) / 100;
}

/**
 * Pull one bucket out of the summary, per currency.
 *
 * The summary arrives as one row per (bucket, currency) precisely so that
 * nothing in the client has to decide whether two currencies can be added. They
 * cannot, so this returns the rows and `primaryTotal` in money.ts decides what
 * to print.
 */
export function bucket(rows: SummaryRow[], name: string): SummaryRow[] {
  return rows.filter((r) => r.bucket === name);
}

/** The per-stage distribution the Dashboard and the pipeline header draw (§9). */
export function stageDistribution(rows: SummaryRow[]): {
  stage: Stage;
  items: number;
  value: number;
  weighted: number;
  currency: string | null;
}[] {
  return OPEN_STAGES.map((stage) => {
    const matches = bucket(rows, `stage:${stage}`);
    return {
      stage,
      items: matches.reduce((n, r) => n + r.items, 0),
      value: matches.reduce((n, r) => n + r.value, 0),
      weighted: matches.reduce((n, r) => n + r.weighted, 0),
      // Null when a stage holds two currencies: the screen prints the count and
      // withholds the total rather than adding francs to forints.
      currency: matches.length === 1 ? matches[0].currency : null,
    };
  });
}

/**
 * Win rate: won ÷ (won + lost), over every closed deal there has ever been.
 *
 * Null — not `0%` — until at least one deal has closed. A win rate computed from
 * nothing is not zero, it is unknown, and printing `0%` on a new account would
 * be the first number a person read and the first one that was wrong.
 */
export function winRate(rows: SummaryRow[]): number | null {
  const won = bucket(rows, 'won_all').reduce((n, r) => n + r.items, 0);
  const lost = bucket(rows, 'lost_all').reduce((n, r) => n + r.items, 0);
  if (won + lost === 0) return null;
  return (won / (won + lost)) * 100;
}

/**
 * The average won deal, per currency.
 *
 * Per currency for the same reason everything else here is: an average across
 * currencies is not an average of anything.
 */
export function averageWonDeal(rows: SummaryRow[]): { currency: string; value: number }[] {
  return bucket(rows, 'won_all')
    .filter((r) => r.items > 0)
    .map((r) => ({ currency: r.currency ?? 'HUF', value: r.value / r.items }));
}

/** A plain count out of the summary — projects, clients, deals. */
export function count(rows: SummaryRow[], name: string): number {
  return bucket(rows, name).reduce((n, r) => n + r.items, 0);
}

/* ======================================================== profitability === */

export interface ProjectFinancials {
  value: number | null;
  currency: string;
  costs: number | null;
  estimated_hours: number | null;
  actual_hours: number | null;
}

/**
 * The management figures on a project (§30), and the labels are precise on
 * purpose.
 *
 * ## What these are NOT
 *
 * §65 forbids claiming profit, EBITDA, net income or recognised revenue, and
 * nothing here does. This is:
 *
 *     contribution   project value − direct project costs
 *     margin         contribution ÷ project value
 *     revenuePerHour project value ÷ actual hours
 *     contributionPerHour
 *
 * "Contribution" is the correct word for what it is: what the project put
 * towards everything the costs did not cover. It is not profit — there is no
 * overhead, no salary and no tax anywhere in this system, and there is not meant
 * to be.
 *
 * ## Null is the answer more often than zero
 *
 * Every one of these returns null when its inputs are missing, and §31 requires
 * the screen to render that as `Not recorded`. A project with a value and no
 * recorded costs has NO contribution figure — not a contribution equal to its
 * value — because "we have not written the costs down yet" and "it cost nothing"
 * are different and only one of them is usually true.
 */
export function financials(p: ProjectFinancials) {
  const hasValue = p.value !== null && p.value !== undefined;
  const hasCosts = p.costs !== null && p.costs !== undefined;
  const hours = p.actual_hours !== null && p.actual_hours !== undefined && p.actual_hours > 0
    ? p.actual_hours
    : null;

  const contribution = hasValue && hasCosts ? (p.value as number) - (p.costs as number) : null;

  return {
    value: hasValue ? (p.value as number) : null,
    costs: hasCosts ? (p.costs as number) : null,
    currency: p.currency,
    contribution,
    /** Percent. Null when there is no value to divide by — including a zero one. */
    margin: contribution !== null && hasValue && (p.value as number) > 0
      ? (contribution / (p.value as number)) * 100
      : null,
    revenuePerHour: hasValue && hours !== null ? (p.value as number) / hours : null,
    contributionPerHour: contribution !== null && hours !== null ? contribution / hours : null,
    estimatedHours: p.estimated_hours ?? null,
    actualHours: p.actual_hours ?? null,
    /** Whether the screen should draw the financial block prominently at all. */
    complete: hasValue && hasCosts,
  };
}

/* ============================================================== the dates == */

export type DueTone = 'overdue' | 'today' | 'soon' | 'later' | 'none';

/**
 * How a date should read (§49).
 *
 * Four states and a "no date", because "aggressive warning colours everywhere"
 * is what §49 forbids: `later` is the common case and is drawn in the same quiet
 * grey as every other date on the screen. Only `overdue` and `today` earn any
 * emphasis at all.
 *
 * Compared at DAY granularity in the viewer's own timezone, so a date due today
 * does not become overdue at midnight UTC for somebody in Budapest.
 */
export function dueTone(date: string | null | undefined, now = new Date()): DueTone {
  if (!date) return 'none';
  const due = new Date(`${date}T00:00:00`);
  if (Number.isNaN(due.getTime())) return 'none';

  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((due.getTime() - start.getTime()) / 86_400_000);

  if (days < 0) return 'overdue';
  if (days === 0) return 'today';
  if (days <= 7) return 'soon';
  return 'later';
}

/** A short local date for tables. `16 Aug 2026`. */
export function shortDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString(intlLocale('en-GB'), { year: 'numeric', month: 'short', day: '2-digit' });
}

/* ========================================================= what needs doing */

export interface AttentionItem {
  id: string;
  /**
   * The id of the record this is about.
   *
   * Carried explicitly rather than parsed back out of `id` or `to`. A caller
   * that needs the record's name — which the Dashboard does, to write "Rapidkert
   * has no next action" — should look it up by an id it was given, not by
   * pulling a UUID out of a string that was only ever meant to be a React key.
   */
  record: string;
  /** Where the item links to. */
  to: string;
  text: string;
  /** Why this item is here, in one sentence. §15 requires every item to say so. */
  because: string;
  urgent: boolean;
}

/**
 * The commercial attention rules (§15).
 *
 * ## The contract every rule here holds to
 *
 * Each item must (a) be derived from a condition that is actually stored,
 * (b) explain why it is there, (c) link to the record, and (d) DISAPPEAR when
 * the condition stops being true. That last one is what stops this becoming
 * notification spam: nothing is dismissed, acknowledged or snoozed, because
 * every item is recomputed from the data and resolving the data is the only way
 * to clear it.
 *
 * ## The rules, and what each one is really asking
 *
 *   no next action      A live deal nobody has decided the next move on.
 *   overdue action      The move was decided and the date has passed.
 *   close date passed   The forecast says it should have closed. It has not.
 *   won, not converted  A won deal with no client record — the chain from
 *                       revenue back to a channel is broken until it has one.
 *
 * There is deliberately no "proposal is old" rule based on `created_at`: the
 * brief suggests one, but "no activity for X days" needs an activity timestamp
 * per record and what this table has is `updated_at`, which changes when anyone
 * edits anything. A rule built on that would fire on deals somebody is actively
 * working, which is the opposite of what it is for. `next_action_on` answers the
 * same question honestly and is already here.
 */
export function dealAttention(deals: Deal[], now = new Date()): AttentionItem[] {
  const items: AttentionItem[] = [];

  for (const deal of deals) {
    if (deal.archived_at) continue;
    const to = `/sales/${deal.id}`;

    if (isOpen(deal.stage)) {
      if (!deal.next_action || !deal.next_action.trim()) {
        items.push({
          id: `no-action-${deal.id}`,
          record: deal.id,
          to,
          text: t('{name} has no next action'),
          because: t('A {stage} opportunity with nothing scheduled stops moving without anyone noticing.', { stage: stageLabel(deal.stage).toLowerCase() }),
          urgent: false,
        });
      } else if (dueTone(deal.next_action_on, now) === 'overdue') {
        items.push({
          id: `late-action-${deal.id}`,
          record: deal.id,
          to,
          text: t('{name} next action is overdue — {action}', { action: deal.next_action }),
          because: t('The date set for the next step has passed.'),
          urgent: true,
        });
      }

      if (dueTone(deal.expected_close_on, now) === 'overdue') {
        items.push({
          id: `late-close-${deal.id}`,
          record: deal.id,
          to,
          text: t('{name} expected close date has passed'),
          because: t('It is still open past the date it was forecast to close, so the forecast is wrong until it is re-dated or closed.'),
          urgent: true,
        });
      }
    }

    if (deal.stage === 'won' && !deal.organization_id) {
      items.push({
        id: `unconverted-${deal.id}`,
        record: deal.id,
        to,
        text: t('{name} is won but has no client record'),
        because: t('Won revenue with no client cannot be attributed to a relationship or given a project.'),
        urgent: false,
      });
    }
  }

  return items;
}

/** The subset of a project the attention rules need. */
export interface DeliveryProject {
  id: string;
  name: string;
  status: string;
  target_date: string | null;
  value: number | null;
  archived_at?: string | null;
  /** How many milestones are not done. Null when the project has none at all. */
  openMilestones?: number | null;
}

/**
 * The delivery attention rules (§58).
 *
 * Every one of these is answerable from what the schema stores. There is no
 * "client has not replied in N days" rule, because nothing records when a client
 * replied — inventing that state is exactly what §58's "do not invent rules that
 * current data cannot support" rules out.
 */
export function projectAttention(projects: DeliveryProject[], now = new Date()): AttentionItem[] {
  const items: AttentionItem[] = [];
  const closed = ['completed', 'archived', 'care'];

  for (const project of projects) {
    if (project.archived_at || closed.includes(project.status)) continue;
    const to = `/projects/${project.id}`;

    if (project.status === 'blocked') {
      items.push({
        id: `blocked-${project.id}`,
        record: project.id,
        to,
        text: t('{name} is blocked'),
        because: t('A blocked project consumes a target date without moving towards it.'),
        urgent: true,
      });
    }

    if (dueTone(project.target_date, now) === 'overdue') {
      items.push({
        id: `late-project-${project.id}`,
        record: project.id,
        to,
        text: t('{name} is past its target date'),
        because: t('The delivery date has passed and the project is not complete.'),
        urgent: true,
      });
    }

    if (project.status === 'client_review') {
      items.push({
        id: `review-${project.id}`,
        record: project.id,
        to,
        text: t('{name} is waiting on the client'),
        because: t('Nothing moves in client review until somebody asks for the review back.'),
        urgent: false,
      });
    }

    if (project.status === 'active' && project.openMilestones === 0) {
      items.push({
        id: `nomilestone-${project.id}`,
        record: project.id,
        to,
        text: t('{name} is active with no milestone left to do'),
        because: t('Either the work is finished and the status is stale, or the next milestone has not been written down.'),
        urgent: false,
      });
    }
  }

  return items;
}

/**
 * Urgent first, stable within each group.
 *
 * The list is read top down and the thing somebody has to do today should not
 * sit under a note about a project that has been in review since March.
 */
export function rankAttention(items: AttentionItem[]): AttentionItem[] {
  return [...items].sort((a, b) => Number(b.urgent) - Number(a.urgent));
}

/* =============================================== the delivery vocabulary == */

/**
 * Clients, projects, milestones, costs — the words, the labels and the tones.
 *
 * These live in the pure model rather than beside their data hooks in
 * `lib/operations.ts` for a reason that is entirely about what the browser
 * downloads. The Dashboard needs `projectStatusLabel` and nothing else from
 * the delivery layer; `lib/operations.ts` also holds every client and project
 * mutation, every detail read and the duplicate matcher. Importing one label
 * from that module puts all of it in the entry bundle, because Rollup hoists a
 * module shared between the entry and a lazy chunk into the entry.
 *
 * So the vocabulary is here, where it costs a few hundred bytes and is pure
 * enough to unit test, and the machinery stays in the chunk that uses it.
 */

export const CLIENT_STATUS: Record<string, { label: string; tone: 'neutral' | 'good' | 'warn' | 'bad' }> = {
  prospect: { label: 'Prospect', tone: 'neutral' },
  active:   { label: 'Active',   tone: 'good' },
  paused:   { label: 'Paused',   tone: 'warn' },
  former:   { label: 'Former',   tone: 'neutral' },
};

export const CLIENT_STATUSES = ['prospect', 'active', 'paused', 'former'] as const;

/**
 * The statuses a person may SET, and the statuses that can be DRAWN.
 *
 * They are different lists on purpose. `project_status` gained six operational
 * values in P2 and kept its six original phase values, because dropping an enum
 * value means rewriting the table. So:
 *
 *   PROJECT_STATES  what the dropdown offers — the operational axis
 *   PROJECT_STATUS  how any stored value renders, legacy ones included
 *
 * A project created before P2 sitting on `build` keeps saying Build until
 * somebody moves it, and nothing rewrote it to say something it was never set
 * to. The phase axis it belongs to now lives in the milestone list.
 */
export const PROJECT_STATES = [
  'planned', 'active', 'client_review', 'blocked', 'on_hold', 'completed',
] as const;

export const PROJECT_STATUS: Record<string, {
  label: string; tone: 'neutral' | 'good' | 'warn' | 'bad'; note: string;
}> = {
  planned:       { label: 'Planned',       tone: 'neutral', note: 'Agreed, not started.' },
  active:        { label: 'Active',        tone: 'good',    note: 'Being worked on.' },
  client_review: { label: 'Client review', tone: 'warn',    note: 'Waiting on the client.' },
  blocked:       { label: 'Blocked',       tone: 'bad',     note: 'Cannot proceed.' },
  on_hold:       { label: 'On hold',       tone: 'warn',    note: 'Paused deliberately.' },
  completed:     { label: 'Completed',     tone: 'good',    note: 'Delivered.' },
  // Fell through (20260929000200_impact_enums.sql). Offered for Impact
  // projects only; counts as neither committed nor delivered support.
  cancelled:     { label: 'Cancelled',     tone: 'bad',     note: 'Fell through. Not delivered.' },
  // The pre-P2 phase vocabulary. Rendered, never offered.
  discovery:     { label: 'Discovery',     tone: 'neutral', note: 'Legacy phase value.' },
  design:        { label: 'Design',        tone: 'neutral', note: 'Legacy phase value.' },
  build:         { label: 'Build',         tone: 'neutral', note: 'Legacy phase value.' },
  launch:        { label: 'Launch',        tone: 'neutral', note: 'Legacy phase value.' },
  care:          { label: 'Care',          tone: 'neutral', note: 'Legacy phase value.' },
  archived:      { label: 'Archived',      tone: 'neutral', note: 'Closed.' },
};

export const projectStatusLabel = (status: string) => { const s = PROJECT_STATUS[status]; return s ? t(s.label) : status; };
export const projectStatusTone = (status: string) => PROJECT_STATUS[status]?.tone ?? 'neutral';

/** A project is live if it is neither finished nor put away. */
export const isLiveProject = (p: { status: string; archived_at: string | null }) =>
  !p.archived_at && !['completed', 'archived', 'care', 'cancelled'].includes(p.status);

/**
 * Closed means `completed`, and only that — the database's close rule
 * (`project_close_rules` in 20260928000200_owner_tracker.sql) is what puts a
 * project there, so this is the one reading of "closed" the screens use.
 * Archiving is `archived_at`, a separate thing, and is not closing.
 */
export const isClosedProject = (p: { status: string }) => p.status === 'completed';

/**
 * What the status control offers. `completed` is not in it: a project is
 * closed with its own action, which the database only accepts once every
 * checkpoint is done, and reopened with another.
 */
export const SETTABLE_PROJECT_STATES = PROJECT_STATES.filter((s) => s !== 'completed');

/**
 * What an Impact project's status control offers: the same states, plus
 * `cancelled`. An Impact project that falls through must leave the support
 * counters, and archiving (a layout action) must not be how that happens.
 * Paid projects keep exactly the list they had.
 */
export const IMPACT_SETTABLE_STATES = [...SETTABLE_PROJECT_STATES, 'cancelled'] as const;

export const PAYMENT_STATES = ['not_invoiced', 'invoiced', 'partially_paid', 'paid'] as const;

export const PAYMENT_LABEL: Record<string, string> = {
  not_invoiced: 'Not invoiced',
  invoiced: 'Invoiced',
  partially_paid: 'Partially paid',
  paid: 'Paid',
};

/* ============================================================ milestones == */

/**
 * The five checkpoint states, in the order a checkpoint moves through them.
 * `pending` is the stored name of "not started"; the enum value predates the
 * label and renaming a stored enum value is a table rewrite.
 */
export const MILESTONE_STATES = ['pending', 'in_progress', 'waiting_client', 'blocked', 'done'] as const;

export const MILESTONE_LABEL: Record<string, string> = {
  pending: 'Not started',
  in_progress: 'In progress',
  waiting_client: 'Waiting on client',
  blocked: 'Blocked',
  done: 'Done',
};

/**
 * The lists the Portal shipped with, per kind of work (§23).
 *
 * These are now the SEED of `checkpoint_templates` (20260928000200), which is
 * what the tracker offers and the owner edits; the SQL seeds exactly these four.
 * They stay here because `templateFor` still answers "which kind of work is
 * this" for a service string without a database round trip, and the P2 tests
 * pin that behaviour.
 *
 * `match` is a substring test against the service, lowercased, because the
 * service is free text a person typed. Anything unrecognised gets the generic
 * four, which is a real delivery shape and not a placeholder.
 */
export const MILESTONE_TEMPLATES: { id: string; label: string; match: string[]; steps: string[] }[] = [
  {
    id: 'website',
    label: 'Website',
    match: ['web', 'site', 'oldal', 'landing'],
    steps: [
      'Discovery', 'Research', 'UX / structure', 'Design', 'Development',
      'Content', 'QA', 'Client review', 'Launch', 'Maintenance',
    ],
  },
  {
    id: 'ads',
    label: 'Ads',
    match: ['ad', 'hirdet', 'ppc', 'google ads', 'meta'],
    steps: ['Audit', 'Account setup', 'Creative', 'Launch', 'Optimisation'],
  },
  {
    id: 'branding',
    label: 'Branding',
    match: ['brand', 'arculat', 'logo', 'identity'],
    steps: ['Discovery', 'Direction', 'Design', 'Refinement', 'Handover'],
  },
  {
    id: 'general',
    label: 'General',
    match: [],
    steps: ['Discovery', 'Delivery', 'Client review', 'Handover'],
  },
];

export function templateFor(service: string | null | undefined) {
  const needle = (service ?? '').toLowerCase();
  if (needle) {
    const hit = MILESTONE_TEMPLATES.find((t) => t.match.some((m) => needle.includes(m)));
    if (hit) return hit;
  }
  return MILESTONE_TEMPLATES[MILESTONE_TEMPLATES.length - 1];
}

/**
 * Delivery progress, as a fraction of the milestones that are done.
 *
 * Takes `{ state }` rather than the full `Milestone` row so this module keeps
 * its no-imports property: a type import from `lib/operations.ts` would be
 * erased at build time, but it would also be a lie about where this file's
 * dependencies point.
 *
 * Null when there are no milestones — NOT zero. A project with no milestone list
 * has not made 0% progress, it has an unrecorded amount of progress, and §31 is
 * about exactly this distinction.
 */
export function progressOf(milestones: { state: string }[]): { done: number; total: number; percent: number | null } {
  const total = milestones.length;
  const done = milestones.filter((m) => m.state === 'done').length;
  return { done, total, percent: total > 0 ? (done / total) * 100 : null };
}

/** The subset of a `checkpoint_templates` row the matcher needs. */
export interface TemplateLike {
  name: string;
  service_keywords: string[];
  position: number;
  archived_at?: string | null;
}

/**
 * The stored template a project's service points at.
 *
 * Same rule as `templateFor`, over the owner's editable list: the first live
 * template, in `position` order, one of whose keywords is a substring of the
 * service; otherwise the last live template with no keywords (the fallback);
 * otherwise nothing.
 */
export function matchTemplate<T extends TemplateLike>(templates: T[], service: string | null | undefined): T | null {
  const live = templates.filter((t) => !t.archived_at).sort((a, b) => a.position - b.position);
  const needle = (service ?? '').toLowerCase().trim();
  if (needle) {
    const hit = live.find((t) => t.service_keywords.some((k) => k.trim() && needle.includes(k.toLowerCase().trim())));
    if (hit) return hit;
  }
  const fallbacks = live.filter((t) => t.service_keywords.every((k) => !k.trim()));
  return fallbacks[fallbacks.length - 1] ?? null;
}

/** The subset of a checkpoint the tracker summary reads. */
export interface CheckpointLike {
  title: string;
  state: string;
  position: number;
  due_on: string | null;
  blocked_reason?: string | null;
  next_step?: string | null;
}

export interface TrackerSummary {
  done: number;
  total: number;
  /** The first checkpoint, in order, that is not done. Null when all are, or none exist. */
  current: string | null;
  /** Every checkpoint exists and is done — the database's own close condition. */
  closable: boolean;
  /** Late: the project's target date has passed, or an open checkpoint's has. */
  late: boolean;
  lateBecause: string | null;
  /** Open checkpoints that are waiting on the client. */
  waiting: string[];
  /** Blocked checkpoints, each with the reason and the next step it must carry. */
  blocked: { title: string; reason: string | null; next: string | null }[];
}

/**
 * Where a project stands, from its checkpoints.
 *
 * Late, waiting and blocked are three SEPARATE answers, because they call for
 * three different things: a late project needs re-dating or pushing, a waiting
 * one needs the client chased, a blocked one needs the stated next step taken.
 * Collapsing them into one "attention" flag would hide which.
 *
 * A closed project is none of the three; the caller passes `closed` so a
 * finished project with a past target date does not read as late forever.
 */
export function trackerOf(
  checkpoints: CheckpointLike[],
  project: { target_date: string | null; closed?: boolean },
  now = new Date(),
): TrackerSummary {
  const ordered = [...checkpoints].sort((a, b) => a.position - b.position);
  const open = ordered.filter((c) => c.state !== 'done');
  const total = ordered.length;
  const done = total - open.length;

  let lateBecause: string | null = null;
  if (!project.closed) {
    if (dueTone(project.target_date, now) === 'overdue') {
      lateBecause = t('The target date has passed.');
    } else {
      const lateStep = open.find((c) => dueTone(c.due_on, now) === 'overdue');
      if (lateStep) lateBecause = t('“{title}” is past its due date.', { title: lateStep.title });
    }
  }

  return {
    done,
    total,
    current: open[0]?.title ?? null,
    closable: total > 0 && open.length === 0,
    late: lateBecause !== null,
    lateBecause,
    waiting: project.closed ? [] : open.filter((c) => c.state === 'waiting_client').map((c) => c.title),
    blocked: project.closed ? [] : open
      .filter((c) => c.state === 'blocked')
      .map((c) => ({ title: c.title, reason: c.blocked_reason ?? null, next: c.next_step ?? null })),
  };
}

/**
 * Why a close was refused, from the database's own words.
 *
 * The close rule raises `stratos:<reason>` (see `project_close_rules` and
 * `milestone_tracker_rules`); anything else is not a close refusal.
 */
export function closeRefusal(message: string | null | undefined): string | null {
  if (!message) return null;
  if (message.includes('stratos:project_close_no_checkpoints')) {
    return t('A project needs at least one checkpoint, all done, before it can be closed.');
  }
  if (message.includes('stratos:project_close_open_checkpoints')) {
    return t('Every checkpoint has to be done before the project can be closed.');
  }
  if (message.includes('stratos:project_closed')) {
    return t('This project is closed. Reopen it to change its checkpoints.');
  }
  if (message.includes('stratos:impact_close_no_market_value')) {
    return t('Record the market value of the donated work before closing an Impact project — and a closed one keeps it.');
  }
  if (message.includes('stratos:project_billing_fixed')) {
    return t('A project is one-off or a monthly contract from the day it is created.');
  }
  if (message.includes('projects_monthly_shape_check')) {
    return t('A monthly contract needs a monthly fee and has no one-off project value.');
  }
  if (message.includes('stratos:project_program_fixed')) {
    return t('A project is paid or Impact from the day it is created.');
  }
  return null;
}

export const COST_CATEGORIES = [
  'collaborator', 'subcontractor', 'media', 'software', 'production', 'other',
] as const;

export const COST_LABEL: Record<string, string> = {
  collaborator: 'Collaborator fee',
  subcontractor: 'Subcontractor',
  media: 'Stock / media',
  software: 'Software / service',
  production: 'Production',
  other: 'Other direct cost',
};

/* ====================================================== monthly contracts == */

/**
 * A monthly contract — billed by the month, listed and totalled apart from
 * one-off projects. `billing` is absent on rows read before the migration,
 * which are all one-off.
 */
export const isMonthly = (p: { billing?: string | null }) => p.billing === 'monthly';

/**
 * The monthly fees of the running (not ended, not archived) contracts, per
 * currency — never added across currencies.
 */
export function monthlyTotals(projects: {
  billing?: string | null; monthly_fee: number | null; currency: string; status: string; archived_at: string | null;
}[]) {
  const by = new Map<string, { currency: string; total: number; contracts: number }>();
  for (const p of projects) {
    if (p.billing !== 'monthly' || p.archived_at || p.status === 'completed' || p.status === 'cancelled') continue;
    const t = by.get(p.currency) ?? { currency: p.currency, total: 0, contracts: 0 };
    t.total = Math.round((t.total + Number(p.monthly_fee ?? 0)) * 100) / 100;
    t.contracts += 1;
    by.set(p.currency, t);
  }
  return [...by.values()].sort((a, b) => (a.currency === 'HUF' ? -1 : b.currency === 'HUF' ? 1 : a.currency.localeCompare(b.currency)));
}

/**
 * Whole months a contract has run: from its start to today, or to its end if
 * it has ended. `null` without a start date. A partial month counts as begun.
 */
export function monthsRunning(start: string | null, until: string): number | null {
  if (!start) return null;
  const [sy, sm, sd] = start.slice(0, 10).split('-').map(Number);
  const [uy, um, ud] = until.slice(0, 10).split('-').map(Number);
  const months = (uy - sy) * 12 + (um - sm) + (ud >= sd ? 1 : 0);
  return Math.max(months, 0);
}

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

import {
  CURRENCIES, group, money, moneyCompact, percent, primaryTotal, sumByCurrency,
} from '../portal/src/lib/money';
import {
  LOST_REASONS, OPEN_STAGES, STAGE, STAGES, averageWonDeal, bucket, count, dealAttention,
  defaultProbability, dueTone, financials, isLiveProject, isOpen, progressOf, projectAttention,
  projectStatusLabel, rankAttention, shortDate, stageDistribution, templateFor, weighted,
  winRate, type SummaryRow,
} from '../portal/src/lib/pipeline';

/**
 * Phase P2 — the revenue and operations contracts.
 *
 * ## Two kinds of test in this file, and why neither could be the other
 *
 * **Authoritative totals.** `lib/money.ts` and `lib/pipeline.ts` have no imports
 * at all — that is a deliberate architectural property, not an accident — so
 * this suite imports them directly and asserts the arithmetic. A pipeline total,
 * a weighted forecast, a contribution figure and a win rate are the numbers
 * somebody makes a decision with, and "the screenshot had a number on it" is not
 * a test of any of them.
 *
 * **Structural contracts, asserted at the source.** `dist/portal` has no
 * Supabase credentials and cannot sign anybody in, so every P2 screen is behind
 * the auth guard and a rendered test can reach exactly one of them: the sign-in
 * page. The properties that must hold for EVERY render — the RLS on every new
 * table, the absence of a delete policy, the accessible stage control, the fact
 * that no currency is ever converted — are therefore asserted where they are
 * decided.
 *
 * `node scripts/portal-shots.mjs` is the third leg: it builds a credentialled
 * bundle, drives every P2 screen with fixtures and asserts the RENDERED
 * contracts. All three run and none replaces the others.
 */

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'portal', 'src');
const read = (...parts: string[]) => fs.readFileSync(path.join(SRC, ...parts), 'utf8');

/** Comments stripped: a doc comment naming a hazard is not an occurrence of it. */
const code = (...parts: string[]) =>
  read(...parts).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const MIGRATION = fs.readFileSync(
  path.join(ROOT, 'supabase', 'migrations', '20260816000100_revenue_operations.sql'),
  'utf8',
);

/** SQL with its comment lines removed, for the same reason. */
const sql = MIGRATION.replace(/^\s*--.*$/gm, '');

/* ######################################################################### */
/* 1. MONEY                                                                  */
/* ######################################################################### */

test.describe('money', () => {
  test('an exact figure is grouped with spaces and carries its unit', () => {
    expect(money(1_250_000, 'HUF')).toBe('1 250 000 Ft');
    expect(money(640, 'HUF')).toBe('640 Ft');
    expect(money(1_250, 'EUR')).toBe('1 250 €');
    expect(money(0, 'HUF')).toBe('0 Ft');
  });

  test('grouping is not locale-dependent', () => {
    // The whole point of hand-rolling this: `toLocaleString` gives a different
    // separator depending on whose machine rendered it, and a figure that
    // changes shape between two people reading the same screen is a figure they
    // will eventually disagree about.
    expect(group(1_000)).toBe('1 000');
    expect(group(999)).toBe('999');
    expect(group(1_234_567_890)).toBe('1 234 567 890');
  });

  test('a missing figure is null, and is never zero', () => {
    // §31 — `Not recorded` and `0 Ft` are different facts and only one of them
    // makes a contribution figure meaningful.
    expect(money(null)).toBeNull();
    expect(money(undefined)).toBeNull();
    expect(moneyCompact(null)).toBeNull();
    expect(money(0)).not.toBeNull();
  });

  test('a compact figure trims decimals that are always zero', () => {
    expect(moneyCompact(1_250_000, 'HUF')).toBe('1.25M Ft');
    expect(moneyCompact(2_000_000, 'HUF')).toBe('2M Ft');
    expect(moneyCompact(850_000, 'HUF')).toBe('850k Ft');
    expect(moneyCompact(640, 'HUF')).toBe('640 Ft');
  });

  test('a negative figure uses a minus sign, not a hyphen', () => {
    // U+2212, which is the width of the digits beside it. A hyphen breaks the
    // alignment of a tabular column, which is the one thing tabular figures are
    // for.
    expect(money(-500, 'HUF')).toContain('−');
    expect(money(-500, 'HUF')).not.toContain('-');
  });

  test('two currencies are never added together', () => {
    // THE money rule of this phase (§4, §65). No rate exists in this system, so
    // a single total across currencies would be a fabrication.
    const totals = sumByCurrency([
      { currency: 'HUF', value: 4_000_000, weighted: 2_000_000 },
      { currency: 'HUF', value: 1_000_000, weighted: 600_000 },
      { currency: 'EUR', value: 10_000, weighted: 5_000 },
    ]);

    expect(totals).toHaveLength(2);
    const huf = totals.find((t) => t.currency === 'HUF')!;
    const eur = totals.find((t) => t.currency === 'EUR')!;
    expect(huf.value).toBe(5_000_000);
    expect(huf.items).toBe(2);
    expect(eur.value).toBe(10_000);

    // And the "one figure" a screen prints is the largest group plus a COUNT of
    // what is not in it — never a converted amount.
    const primary = primaryTotal(totals);
    expect(primary.total!.currency).toBe('HUF');
    expect(primary.total!.value).toBe(5_000_000);
    expect(primary.others).toBe(1);
    expect(primary.otherCurrencies).toEqual(['EUR']);
  });

  test('an empty book has no primary total at all', () => {
    const primary = primaryTotal([]);
    expect(primary.total).toBeNull();
    expect(primary.others).toBe(0);
  });

  test('percent is a percent', () => {
    expect(percent(62.4)).toBe('62%');
    expect(percent(62.4, 1)).toBe('62.4%');
    expect(percent(null)).toBeNull();
  });

  test('nothing in the money module converts between currencies', () => {
    const source = code('lib', 'money.ts');
    // A rate would look like one of these. None of them may appear.
    expect(source).not.toMatch(/\brate\b\s*[:=]/i);
    expect(source).not.toMatch(/\b(EURHUF|USDHUF|exchange|convert)\b/i);
    expect(CURRENCIES).toEqual(['HUF', 'EUR', 'USD']);
  });
});

/* ######################################################################### */
/* 2. THE PIPELINE                                                           */
/* ######################################################################### */

test.describe('the pipeline', () => {
  test('there are six stages and they are not twenty', () => {
    // §5 — a controlled pipeline, not micro-stages.
    expect(STAGES).toEqual(['qualified', 'discovery', 'proposal', 'negotiation', 'won', 'lost']);
    expect(OPEN_STAGES).toEqual(['qualified', 'discovery', 'proposal', 'negotiation']);
    expect(isOpen('proposal')).toBe(true);
    expect(isOpen('won')).toBe(false);
    expect(isOpen('lost')).toBe(false);
  });

  test('the stage probabilities are the documented operational defaults', () => {
    // §6. These are conventions, not measured Stratos rates — which is asserted
    // one test below, because the claim is the thing that matters.
    expect(defaultProbability('qualified')).toBe(20);
    expect(defaultProbability('discovery')).toBe(40);
    expect(defaultProbability('proposal')).toBe(60);
    expect(defaultProbability('negotiation')).toBe(80);
    expect(STAGE.won.probability).toBe(100);
    expect(STAGE.lost.probability).toBe(0);
  });

  test('the defaults are documented as defaults, in the code and in the schema', () => {
    // §6 — "do not silently treat those defaults as statistically proven".
    expect(code('lib', 'pipeline.ts')).not.toContain('measured');
    expect(read('lib', 'pipeline.ts')).toMatch(/OPERATIONAL DEFAULTS/);
    expect(MIGRATION).toMatch(/NOT measured Stratos win rates/);
  });

  test('weighted value is value times probability, and null when there is no value', () => {
    // §7 — the calculation the whole forecast rests on.
    expect(weighted({ estimated_value: 1_000_000, probability: 60 })).toBe(600_000);
    expect(weighted({ estimated_value: 1_000_000, probability: 0 })).toBe(0);
    expect(weighted({ estimated_value: 0, probability: 60 })).toBe(0);
    // Not zero: a deal with no value has no weighted value, and calling it zero
    // makes the forecast quietly wrong rather than visibly incomplete.
    expect(weighted({ estimated_value: null, probability: 60 })).toBeNull();
  });

  const SUMMARY: SummaryRow[] = [
    { bucket: 'stage:qualified', currency: 'HUF', items: 4, value: 1_200_000, weighted: 240_000 },
    { bucket: 'stage:discovery', currency: 'HUF', items: 3, value: 2_400_000, weighted: 960_000 },
    { bucket: 'stage:proposal', currency: 'HUF', items: 5, value: 5_800_000, weighted: 3_480_000 },
    { bucket: 'stage:negotiation', currency: 'HUF', items: 2, value: 3_100_000, weighted: 2_480_000 },
    { bucket: 'open', currency: 'HUF', items: 14, value: 12_500_000, weighted: 7_160_000 },
    { bucket: 'closing_month', currency: 'HUF', items: 3, value: 4_200_000, weighted: 2_600_000 },
    { bucket: 'won_mtd', currency: 'HUF', items: 2, value: 3_000_000, weighted: 0 },
    { bucket: 'won_ytd', currency: 'HUF', items: 6, value: 9_600_000, weighted: 0 },
    { bucket: 'won_all', currency: 'HUF', items: 6, value: 9_600_000, weighted: 0 },
    { bucket: 'lost_all', currency: 'HUF', items: 4, value: 3_200_000, weighted: 0 },
    { bucket: 'projects_active', currency: null, items: 5, value: 0, weighted: 0 },
  ];

  test('the stage distribution is the open stages, in pipeline order', () => {
    // §9 — the Dashboard's compact distribution.
    const stages = stageDistribution(SUMMARY);
    expect(stages.map((s) => s.stage)).toEqual(OPEN_STAGES);
    expect(stages.map((s) => s.items)).toEqual([4, 3, 5, 2]);
    // Won and lost are NOT in the pipeline. Counting a closed deal here would
    // make the pipeline grow every time something closed.
    expect(stages.reduce((n, s) => n + s.items, 0)).toBe(14);
    expect(stages.reduce((n, s) => n + s.value, 0)).toBe(12_500_000);
  });

  test('a stage holding two currencies withholds its total rather than adding them', () => {
    const mixed: SummaryRow[] = [
      { bucket: 'stage:proposal', currency: 'HUF', items: 2, value: 3_000_000, weighted: 1_800_000 },
      { bucket: 'stage:proposal', currency: 'EUR', items: 1, value: 8_000, weighted: 4_800 },
    ];
    const proposal = stageDistribution(mixed).find((s) => s.stage === 'proposal')!;
    expect(proposal.items).toBe(3);
    // The COUNT is true across currencies. The currency is null, which is the
    // screen's signal to print the count and not a single figure.
    expect(proposal.currency).toBeNull();
  });

  test('the pipeline and the forecast are the database aggregate, unchanged', () => {
    // §7 — real database-derived values, no demo values, no client-side re-sum.
    const open = primaryTotal(sumByCurrency(bucket(SUMMARY, 'open'))).total!;
    expect(open.value).toBe(12_500_000);
    expect(open.weighted).toBe(7_160_000);

    const closing = primaryTotal(sumByCurrency(bucket(SUMMARY, 'closing_month'))).total!;
    expect(closing.value).toBe(4_200_000);

    const won = primaryTotal(sumByCurrency(bucket(SUMMARY, 'won_mtd'))).total!;
    expect(won.value).toBe(3_000_000);
    expect(won.items).toBe(2);
  });

  test('the win rate is won over closed — and is unknown, not zero, before anything closes', () => {
    expect(winRate(SUMMARY)).toBeCloseTo(60, 5); // 6 won of 10 closed

    const fresh: SummaryRow[] = [
      { bucket: 'open', currency: 'HUF', items: 3, value: 900_000, weighted: 300_000 },
    ];
    // NOT 0. A rate computed from no closed deals is unknown, and printing 0%
    // would be the first number somebody read on a new account and the first one
    // that was wrong.
    expect(winRate(fresh)).toBeNull();
  });

  test('the average won deal is per currency and never across', () => {
    expect(averageWonDeal(SUMMARY)).toEqual([{ currency: 'HUF', value: 1_600_000 }]);

    const two: SummaryRow[] = [
      { bucket: 'won_all', currency: 'HUF', items: 2, value: 4_000_000, weighted: 0 },
      { bucket: 'won_all', currency: 'EUR', items: 1, value: 10_000, weighted: 0 },
    ];
    expect(averageWonDeal(two)).toHaveLength(2);
  });

  test('counts come out of the aggregate rather than out of a loaded table', () => {
    expect(count(SUMMARY, 'projects_active')).toBe(5);
    expect(count(SUMMARY, 'clients_active')).toBe(0);
  });
});

/* ######################################################################### */
/* 3. PROFITABILITY                                                          */
/* ######################################################################### */

test.describe('project contribution', () => {
  test('contribution is value minus direct costs, and margin is its share', () => {
    // §30. Note the words: contribution, not profit.
    const fin = financials({
      value: 2_000_000, currency: 'HUF', costs: 700_000,
      estimated_hours: 100, actual_hours: 125,
    });
    expect(fin.contribution).toBe(1_300_000);
    expect(fin.margin).toBeCloseTo(65, 5);
    expect(fin.revenuePerHour).toBe(16_000);
    expect(fin.contributionPerHour).toBe(10_400);
    expect(fin.complete).toBe(true);
  });

  test('a project with no recorded costs has NO contribution, not a full one', () => {
    // §31 — the failure this guards against is a project reading "100% margin"
    // because nobody has written the costs down yet.
    const fin = financials({
      value: 2_000_000, currency: 'HUF', costs: null,
      estimated_hours: null, actual_hours: null,
    });
    expect(fin.value).toBe(2_000_000);
    expect(fin.costs).toBeNull();
    expect(fin.contribution).toBeNull();
    expect(fin.margin).toBeNull();
    expect(fin.complete).toBe(false);
  });

  test('an hourly figure needs hours above zero, not merely hours', () => {
    const noHours = financials({
      value: 1_000_000, currency: 'HUF', costs: 400_000,
      estimated_hours: 40, actual_hours: 0,
    });
    // Dividing by zero hours is Infinity, which would render as a spectacular
    // and meaningless hourly rate.
    expect(noHours.revenuePerHour).toBeNull();
    expect(noHours.contributionPerHour).toBeNull();
    // The contribution itself is unaffected — hours and costs are different
    // inputs and one missing must not blank the other.
    expect(noHours.contribution).toBe(600_000);
  });

  test('a project worth nothing has no margin to compute', () => {
    const free = financials({
      value: 0, currency: 'HUF', costs: 50_000, estimated_hours: null, actual_hours: 10,
    });
    expect(free.contribution).toBe(-50_000);
    expect(free.margin).toBeNull();
    expect(free.revenuePerHour).toBe(0);
  });

  test('the labels never claim profit', () => {
    // §65. This is a management figure, not an accounting result, and the
    // vocabulary is what keeps that true.
    for (const file of [
      code('lib', 'pipeline.ts'),
      code('pages', 'projects.tsx'),
      code('pages', 'sales.tsx'),
    ]) {
      expect(file).not.toMatch(/\b(EBITDA|net income|after tax|recognised revenue|recognized revenue)\b/i);
      // "profit" appears nowhere as a label. `profitability` as a section name
      // for internal management metrics is allowed and is what §30 calls it.
      expect(file).not.toMatch(/>\s*(Net )?Profit\s*</);
    }
  });
});

/* ######################################################################### */
/* 4. DATES AND DELIVERY                                                     */
/* ######################################################################### */

test.describe('dates and delivery', () => {
  const NOW = new Date('2026-08-16T12:00:00');

  test('a due date reads as overdue, today, soon or later', () => {
    // §49 — and only the first two earn any emphasis.
    expect(dueTone('2026-08-10', NOW)).toBe('overdue');
    expect(dueTone('2026-08-16', NOW)).toBe('today');
    expect(dueTone('2026-08-20', NOW)).toBe('soon');
    expect(dueTone('2026-10-01', NOW)).toBe('later');
    expect(dueTone(null, NOW)).toBe('none');
    expect(dueTone('not a date', NOW)).toBe('none');
  });

  test('a date due today does not become overdue at midnight UTC', () => {
    // Compared at day granularity in the viewer's own timezone. The bug this
    // guards against is a Budapest morning showing every one of today's
    // follow-ups in red.
    expect(dueTone('2026-08-16', new Date('2026-08-16T00:30:00'))).toBe('today');
    expect(dueTone('2026-08-16', new Date('2026-08-16T23:30:00'))).toBe('today');
  });

  test('progress is a fraction of the milestones, and is unknown without any', () => {
    expect(progressOf([{ state: 'done' }, { state: 'done' }, { state: 'pending' }]))
      .toEqual({ done: 2, total: 3, percent: (2 / 3) * 100 });
    // NOT 0%. A project with no milestone list has an unrecorded amount of
    // progress, not zero progress.
    expect(progressOf([])).toEqual({ done: 0, total: 0, percent: null });
  });

  test('a legacy project status still renders under its own name', () => {
    // The P2 migration ADDED six operational values and dropped none, because
    // dropping an enum value means rewriting the table. A project that predates
    // the phase keeps saying what it was set to.
    expect(projectStatusLabel('build')).toBe('Build');
    expect(projectStatusLabel('client_review')).toBe('Client review');
    // Never rewritten to something it was never set to.
    expect(projectStatusLabel('build')).not.toBe('Planned');
  });

  test('a live project is one that is neither finished nor put away', () => {
    expect(isLiveProject({ status: 'active', archived_at: null })).toBe(true);
    expect(isLiveProject({ status: 'blocked', archived_at: null })).toBe(true);
    expect(isLiveProject({ status: 'completed', archived_at: null })).toBe(false);
    expect(isLiveProject({ status: 'active', archived_at: '2026-01-01' })).toBe(false);
  });

  test('milestone templates are per service, and website steps are not on everything', () => {
    // §23 — "do NOT hardcode website milestones onto every project type".
    expect(templateFor('Weboldal + hirdetés').id).toBe('website');
    expect(templateFor('Google Ads').id).toBe('ads');
    expect(templateFor('Branding').id).toBe('branding');
    expect(templateFor('Something else entirely').id).toBe('general');
    expect(templateFor(null).id).toBe('general');
    // The generic list is a real delivery shape, not a placeholder.
    expect(templateFor(null).steps.length).toBeGreaterThan(2);
    expect(templateFor('Ads').steps).not.toContain('UX / structure');
  });

  test('a short date is a short date', () => {
    expect(shortDate('2026-08-16')).toMatch(/16 Aug 2026/);
    expect(shortDate(null)).toBe('—');
  });
});

/* ######################################################################### */
/* 5. NEEDS ATTENTION                                                        */
/* ######################################################################### */

test.describe('the attention rules', () => {
  const NOW = new Date('2026-08-16T12:00:00');

  const deal = (over: Partial<Parameters<typeof dealAttention>[0][number]> = {}) => ({
    id: 'd1',
    stage: 'proposal',
    estimated_value: 1_000_000,
    currency: 'HUF',
    probability: 60,
    expected_close_on: '2026-09-30',
    next_action: 'Follow up the proposal',
    next_action_on: '2026-08-20',
    organization_id: null,
    archived_at: null,
    ...over,
  });

  test('a healthy open deal produces nothing at all', () => {
    expect(dealAttention([deal()], NOW)).toHaveLength(0);
  });

  test('an open deal with no next action is flagged, and explains itself', () => {
    const items = dealAttention([deal({ next_action: null })], NOW);
    expect(items).toHaveLength(1);
    expect(items[0].to).toBe('/sales/d1');
    expect(items[0].record).toBe('d1');
    // §15 — every item must explain WHY it is there.
    expect(items[0].because.length).toBeGreaterThan(20);
    expect(items[0].urgent).toBe(false);
  });

  test('an overdue next action is urgent', () => {
    const items = dealAttention([deal({ next_action_on: '2026-08-01' })], NOW);
    expect(items.some((i) => i.id.startsWith('late-action') && i.urgent)).toBe(true);
  });

  test('a passed close date is urgent, and only while the deal is still open', () => {
    expect(dealAttention([deal({ expected_close_on: '2026-07-01' })], NOW)
      .some((i) => i.id.startsWith('late-close'))).toBe(true);
    // A won deal cannot have a late close date — it closed.
    expect(dealAttention([deal({ stage: 'won', expected_close_on: '2026-07-01', organization_id: 'c1' })], NOW))
      .toHaveLength(0);
  });

  test('a won deal with no client is flagged — the chain to revenue is broken', () => {
    const items = dealAttention([deal({ stage: 'won', organization_id: null })], NOW);
    expect(items).toHaveLength(1);
    expect(items[0].id).toContain('unconverted');
  });

  test('every item disappears the moment the data resolves it', () => {
    // §15 — "disappear when resolved". Nothing here is dismissed or snoozed;
    // fixing the record is the only way to clear a row, which is the property
    // that stops this becoming a notification inbox.
    const broken = deal({ next_action: null, expected_close_on: '2026-07-01' });
    expect(dealAttention([broken], NOW).length).toBe(2);

    const fixed = { ...broken, next_action: 'Call them', next_action_on: '2026-08-20', expected_close_on: '2026-09-30' };
    expect(dealAttention([fixed], NOW)).toHaveLength(0);
  });

  test('an archived deal is not on anybody’s list', () => {
    expect(dealAttention([deal({ next_action: null, archived_at: '2026-08-01' })], NOW)).toHaveLength(0);
  });

  test('a lost deal is not on anybody’s list either', () => {
    expect(dealAttention([deal({ stage: 'lost', next_action: null })], NOW)).toHaveLength(0);
  });

  test('the project rules fire only on things the schema stores', () => {
    // §58 — no invented rules. Each of these reads a column that exists.
    const base = { id: 'p1', name: 'Relaunch', status: 'active', target_date: '2026-12-01', value: null,
      archived_at: null };

    expect(projectAttention([base], NOW)).toHaveLength(0);
    expect(projectAttention([{ ...base, status: 'blocked' }], NOW)[0].urgent).toBe(true);
    expect(projectAttention([{ ...base, target_date: '2026-07-01' }], NOW)[0].id).toContain('late-project');
    expect(projectAttention([{ ...base, status: 'client_review' }], NOW)[0].id).toContain('review');
    // Completed and archived projects are finished, not overdue.
    expect(projectAttention([{ ...base, status: 'completed', target_date: '2026-01-01' }], NOW)).toHaveLength(0);
  });

  test('the "no milestone left" rule does not fire when the count is unknown', () => {
    // The Dashboard deliberately does not fetch milestone counts — one extra
    // query for one rule. An absent count must mean "do not know", never "zero".
    const base = { id: 'p1', name: 'Relaunch', status: 'active', target_date: '2026-12-01',
      value: null, archived_at: null };
    expect(projectAttention([base], NOW)).toHaveLength(0);
    expect(projectAttention([{ ...base, openMilestones: 0 }], NOW)[0].id).toContain('nomilestone');
    expect(projectAttention([{ ...base, openMilestones: 3 }], NOW)).toHaveLength(0);
  });

  test('urgent items sort first', () => {
    const items = rankAttention([
      { id: 'a', record: 'r', to: '/x', text: 'quiet', because: '', urgent: false },
      { id: 'b', record: 'r', to: '/y', text: 'loud', because: '', urgent: true },
    ]);
    expect(items[0].id).toBe('b');
  });

  test('a lost reason vocabulary exists and is controlled', () => {
    // §16 — the entire value is that it can be counted a year from now.
    expect(LOST_REASONS).toContain('price');
    expect(LOST_REASONS).toContain('no_response');
    expect(LOST_REASONS).toContain('competitor');
    expect(LOST_REASONS.length).toBeLessThanOrEqual(8);
  });
});

/* ######################################################################### */
/* 6. THE MIGRATION                                                          */
/* ######################################################################### */

test.describe('the migration', () => {
  const TABLES = [
    'opportunities', 'client_contacts', 'project_milestones',
    'project_costs', 'project_links', 'record_notes',
  ];

  test('it is additive — nothing is dropped, renamed or rewritten', () => {
    // §42. The one constraint the whole file was designed under.
    expect(sql).not.toMatch(/\bdrop\s+table\b/i);
    expect(sql).not.toMatch(/\bdrop\s+column\b/i);
    expect(sql).not.toMatch(/\balter\s+column\b.*\btype\b/i);
    expect(sql).not.toMatch(/\brename\s+to\b/i);
    expect(sql).not.toMatch(/\btruncate\b/i);
    // No data migration touches an existing row.
    expect(sql).not.toMatch(/^\s*update\s+(leads|projects|organizations|profiles)\b/im);
    expect(sql).not.toMatch(/^\s*delete\s+from\b/im);
  });

  test('every new column is nullable or defaulted', () => {
    // An existing row must stay valid. A `not null` with no default on an
    // existing table is the one statement that could invalidate one.
    const added = [...sql.matchAll(/alter table \w+ add column if not exists ([\s\S]*?);/g)]
      .map((m) => m[1]);
    expect(added.length).toBeGreaterThan(10);
    for (const clause of added) {
      if (/not null/i.test(clause)) {
        expect(clause, `"${clause.trim()}" is NOT NULL and must therefore have a default`)
          .toMatch(/default/i);
      }
    }
  });

  test('every new table has RLS enabled and forced', () => {
    // §43. Forced, so a mistake in a definer function cannot bypass a policy.
    for (const table of TABLES) {
      expect(sql, `${table} must enable RLS`)
        .toMatch(new RegExp(`alter table ${table}\\s+enable row level security`));
      expect(sql, `${table} must force RLS`)
        .toMatch(new RegExp(`alter table ${table}\\s+force\\s+row level security`));
    }
  });

  test('there is no delete policy on the business records', () => {
    // §41 — archive over destructive delete, guaranteed by not granting delete
    // rather than by a convention the UI is trusted to follow.
    expect(sql).not.toMatch(/create policy \w+ on opportunities\s+for delete/);
    expect(sql).toMatch(/opportunities add column if not exists|archived_at\s+timestamptz/);
    // The two tables that DO allow delete are the two that are not business
    // history: a contact who left, and a note its own author withdraws.
    expect(sql).toMatch(/record_notes_delete_author/);
  });

  test('a note cannot be written in somebody else’s name', () => {
    // The clause that makes an attribution worth having.
    expect(sql).toMatch(/record_notes_insert_admin on record_notes\s+for insert with check \(is_admin\(\) and author_id = auth\.uid\(\)\)/);
    // And no update policy at all: a note that can be rewritten is not a record.
    expect(sql).not.toMatch(/create policy \w+ on record_notes\s+for update/);
  });

  test('anon holds nothing on any new table', () => {
    for (const table of TABLES) {
      expect(sql).toMatch(new RegExp(`revoke all on table %I from anon|'${table}'`));
    }
    expect(sql).toMatch(/revoke all on table %I from anon/);
    expect(sql).toMatch(/grant select, insert, update, delete on table %I to authenticated/);
  });

  test('the aggregates are SECURITY INVOKER', () => {
    // The single most important line in the migration. A definer function would
    // compute the company's revenue WITHOUT the caller's policies.
    const summary = sql.slice(sql.indexOf('function portal_sales_summary'));
    expect(summary).toMatch(/security invoker/);
    const attribution = sql.slice(sql.indexOf('function portal_revenue_attribution'));
    expect(attribution.slice(0, 1200)).toMatch(/security invoker/);
    // Neither may ever be definer.
    expect(sql).not.toMatch(/function portal_(sales_summary|revenue_attribution)[\s\S]{0,400}security definer/);
  });

  test('the audit triggers are definer with a pinned search_path', () => {
    // A definer function resolving unqualified names through the caller's
    // search_path is the classic privilege escalation.
    for (const fn of ['log_business_change', 'log_project_cost_change',
      'opportunity_close_stamp', 'milestone_complete_stamp']) {
      const body = sql.slice(sql.indexOf(`function ${fn}`), sql.indexOf(`function ${fn}`) + 400);
      expect(body, `${fn} must be security definer`).toMatch(/security definer/);
      expect(body, `${fn} must pin its search_path`).toMatch(/set search_path = public/);
    }
  });

  test('the database enforces the numbers, not only the dropdowns', () => {
    // §64.
    expect(sql).toMatch(/probability\s+smallint not null default 20 check \(probability between 0 and 100\)/);
    expect(sql).toMatch(/estimated_value\s+numeric\(14, 2\) check \(estimated_value is null or estimated_value >= 0\)/);
    expect(sql).toMatch(/amount\s+numeric\(14, 2\) not null check \(amount >= 0\)/);
    expect(sql).toMatch(/projects_value_check[\s\S]{0,120}value >= 0/);
    expect(sql).toMatch(/projects_hours_check/);
    expect(sql).toMatch(/is_supported_currency/);
  });

  test('an opportunity must belong to somebody', () => {
    expect(sql).toMatch(/opportunities_party_check[\s\S]{0,200}organization_id is not null or/);
  });

  test('a lost reason can only exist on a lost deal', () => {
    expect(sql).toMatch(/opportunities_lost_reason_check[\s\S]{0,200}stage = 'lost'/);
  });

  test('a project link can only ever be http or https', () => {
    // §25 — checked in the database AND at the point of render.
    expect(sql).toMatch(/url\s+text not null check \(url ~\* '\^https\?:\/\//);
  });

  test('a lead is never deleted when it is converted', () => {
    // §41 — traceability matters, and `on delete set null` is what says so.
    expect(sql).toMatch(/lead_id\s+uuid references leads\(id\) on delete set null/);
    // Nothing in the migration touches the leads table's own rows.
    expect(sql).not.toMatch(/alter table leads/);
  });

  test('nothing in the schema converts between currencies', () => {
    expect(sql).not.toMatch(/\b(exchange_rate|fx_rate|conversion_rate)\b/i);
    expect(MIGRATION).toMatch(/nothing converts between them/i);
  });

  test('the enum extension is used nowhere in the same transaction', () => {
    // `ALTER TYPE ... ADD VALUE` may run inside a transaction only if the new
    // value is not USED in it. The aggregate therefore compares `status::text`.
    const summary = sql.slice(sql.indexOf('function portal_sales_summary'));
    expect(summary).toMatch(/p\.status::text in/);
    expect(summary).not.toMatch(/p\.status in \('blocked'/);
  });
});

/* ######################################################################### */
/* 7. THE PORTAL'S STRUCTURE                                                 */
/* ######################################################################### */

test.describe('the P2 modules', () => {
  test('the navigation gains Sales, Clients and Projects as products', () => {
    // §45 — restrained, and no deep nesting for small features.
    const shell = code('components', 'shell', 'PortalShell.tsx');
    const primary = /const PRIMARY: NavItem\[\] = \[([\s\S]*?)\];/.exec(shell);
    const labels = [...primary![1].matchAll(/label: '([^']+)'/g)].map((m) => m[1]);
    expect(labels).toEqual([
      'Dashboard', 'Analytics', 'Leads', 'Sales', 'Clients', 'Projects', 'System',
    ]);

    // Sales does NOT get four sidebar children. Its four views are one screen
    // and live in a query parameter.
    expect(shell).not.toMatch(/'\/sales\/pipeline'|'\/sales\/followups'|'\/sales\/performance'/);
  });

  test('every P2 route is behind a capability guard', () => {
    // §43 — the route guard is a convenience and RLS is the control, but a
    // route with no guard at all is a screen that renders an error for the
    // people it was never meant for.
    const app = code('App.tsx');
    for (const [route, capability] of [
      ['sales', 'view_sales'], ['sales/:id', 'view_sales'],
      ['clients', 'view_clients'], ['clients/:id', 'view_clients'],
      ['projects', 'view_projects'], ['projects/:id', 'view_projects'],
    ]) {
      const pattern = new RegExp(
        `path="${route.replace('/', '\\/')}" element=\\{[\\s\\S]{0,120}capability="${capability}"`);
      expect(app, `${route} must require ${capability}`).toMatch(pattern);
    }
  });

  test('a client cannot reach the commercial book', () => {
    const permissions = code('lib', 'permissions.ts');
    const client = /client: \[([\s\S]*?)\],/.exec(permissions)![1];
    expect(client).not.toContain('view_sales');
    expect(client).not.toContain('manage_sales');
    expect(client).not.toContain('view_clients');

    const team = /team_member: \[([\s\S]*?)\],/.exec(permissions)![1];
    expect(team).not.toContain('view_sales');
    expect(team).not.toContain('manage_sales');
  });

  test('the pipeline stage can be changed without a mouse', () => {
    // §62 — IMPORTANT in the brief, and the strongest form of the requirement is
    // that there is no drag to need an alternative to.
    const sales = code('pages', 'sales.tsx');
    expect(sales).toMatch(/<Select[\s\S]{0,400}id=\{`stage-\$\{deal\.id\}`\}/);
    expect(sales).toMatch(/htmlFor=\{`stage-\$\{deal\.id\}`\}/);

    for (const file of ['pages/sales.tsx', 'pages/opportunity-detail.tsx']) {
      const source = code(...file.split('/'));
      for (const handler of ['onDragStart', 'onDragOver', 'onDrop', 'draggable']) {
        expect(source, `${file} must not depend on ${handler}`).not.toContain(handler);
      }
    }
  });

  test('the dialog does everything a modal owes a keyboard', () => {
    // §62 — modal focus. A dialog you can Tab out of into a page you cannot see
    // is the worst keyboard bug a modal can have.
    const ui = code('components', 'ui', 'index.tsx');
    const dialog = ui.slice(ui.indexOf('export function Dialog'));
    expect(dialog).toContain('role="dialog"');
    expect(dialog).toContain('aria-modal="true"');
    expect(dialog).toContain('aria-labelledby');
    expect(dialog).toMatch(/event\.key === 'Escape'/);
    expect(dialog).toMatch(/event\.key !== 'Tab'/);      // the focus trap
    expect(dialog).toMatch(/returnTo\.current\?\.focus/); // focus is restored
    expect(dialog).toMatch(/document\.body\.style\.overflow = 'hidden'/);
  });

  test('nothing in the P2 screens renders stored markup', () => {
    // The stored-XSS surface. Every P2 record holds text somebody typed.
    for (const file of [
      'pages/sales.tsx', 'pages/opportunity-detail.tsx', 'pages/clients.tsx',
      'pages/projects.tsx', 'features/sales/OpportunityForm.tsx', 'lib/records.ts',
    ]) {
      // Comments stripped: two of these files DOCUMENT that they contain no
      // dangerouslySetInnerHTML, and a doc comment naming a hazard is not an
      // occurrence of it.
      const source = code(...file.split('/'));
      expect(source, `${file} must not set inner HTML`).not.toContain('dangerouslySetInnerHTML');
      expect(source, `${file} must not build markup by hand`).not.toMatch(/\.innerHTML\s*=/);
    }
  });

  test('a stored URL only becomes an href through safeUrl', () => {
    // §25 — `href={value}` on a database value is how a javascript: URL gets
    // executed inside an authenticated admin session.
    const projects = code('pages', 'projects.tsx');
    expect(projects).toContain('safeUrl(link.url)');
    expect(projects).not.toMatch(/href=\{link\.url\}/);

    const clients = code('pages', 'clients.tsx');
    expect(clients).toMatch(/href=\{safeUrl\(client\.website\)!\}/);
    expect(clients).not.toMatch(/href=\{client\.website\}/);

    const safe = clients.slice(clients.indexOf('export function safeUrl'));
    expect(safe).toMatch(/protocol === 'https:' \|\| url\.protocol === 'http:'/);
  });

  test('the Dashboard never loads the business to summarise it', () => {
    // §59. The Dashboard imports the aggregate hooks and NOT the list hooks.
    const dashboard = code('pages', 'dashboard.tsx');
    expect(dashboard).toContain("from '@/lib/business'");
    expect(dashboard).not.toMatch(/useOpportunities|useProjects\b|useClients\b/);

    // And the aggregate is one RPC, not a select over the table.
    const business = code('lib', 'business.ts');
    expect(business).toContain("supabase.rpc('portal_sales_summary')");
    expect(business).toContain("supabase.rpc('portal_revenue_attribution'");
  });

  test('the entry bundle does not import the lazy modules', () => {
    // The chunking contract. `pages/leads.tsx` and `pages/lead-detail.tsx` are
    // eager; `pages/sales.tsx` must stay split, and one shared import would
    // undo that — see features/sales/bits.tsx.
    for (const file of ['pages/leads.tsx', 'pages/lead-detail.tsx', 'pages/dashboard.tsx']) {
      const source = code(...file.split('/'));
      expect(source, `${file} must not statically import a lazy page`)
        .not.toMatch(/^import[\s\S]{0,200}from '@\/pages\/(sales|clients|projects)'/m);
      expect(source, `${file} must not pull in the lazy data layer`)
        .not.toMatch(/^import[\s\S]{0,200}from '@\/lib\/(sales|operations)'/m);
    }
  });

  test('the pure modules stay pure', () => {
    // This is what makes the arithmetic above testable at all.
    for (const file of ['lib/money.ts', 'lib/pipeline.ts']) {
      const source = code(...file.split('/'));
      expect(source, `${file} must have no imports`).not.toMatch(/^\s*import\s/m);
    }
  });

  test('the P2 modules handle an empty account without inventing anything', () => {
    // §51 — no fake examples, and one clear action.
    const sales = read('pages', 'sales.tsx');
    expect(sales).toContain('No opportunities yet');
    expect(sales).toContain('Convert a qualified lead');
    expect(read('pages', 'clients.tsx')).toContain('No clients yet');
    expect(read('pages', 'projects.tsx')).toContain('No projects yet');
  });

  test('a missing figure reads as Not recorded, never as a zero', () => {
    // §31.
    const ui = code('components', 'ui', 'index.tsx');
    expect(ui).toContain('export function NotRecorded');
    for (const file of ['pages/projects.tsx', 'pages/opportunity-detail.tsx']) {
      expect(code(...file.split('/')), `${file} should use NotRecorded`).toContain('<NotRecorded');
    }
  });

  test('the attribution screen states its methodology beside the numbers', () => {
    // §34 — "where traffic and commercial records cannot be deterministically
    // joined, label the methodology. Do not manufacture precision."
    const analytics = read('pages', 'analytics.tsx');
    expect(analytics).toContain('Two measurements, side by side');
    expect(analytics).toMatch(/no conversion rate/i);
    // And there genuinely is no rate column in that table.
    const table = analytics.slice(analytics.indexOf('function RevenueAttribution'));
    expect(table).not.toMatch(/label: 'CVR'|label: 'Rate'/);
  });

  test('GA4 analytics is not regressed', () => {
    // §55 — revenue attribution is an additional layer, not a replacement.
    const analytics = code('pages', 'analytics.tsx');
    const sections = /const SECTIONS = \[([\s\S]*?)\] as const;/.exec(analytics)![1];
    for (const id of ['overview', 'traffic', 'acquisition', 'content', 'conversion', 'audience']) {
      expect(sections, `the ${id} section must survive P2`).toContain(`id: '${id}'`);
    }
    expect(sections).toContain("id: 'revenue'");
  });
});

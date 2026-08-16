// =============================================================================
// Money.
//
// This file has NO IMPORTS, on purpose. It is the one part of the commercial
// layer that a test can exercise directly — `tests/portal-revenue.spec.ts`
// imports it by relative path — and a module that pulls in the Supabase client
// to format a number cannot be tested without a browser.
//
// TWO FORMATS AND A RULE FOR CHOOSING (§48)
// -----------------------------------------
//     exact     1 250 000 Ft     tables, detail screens, anything editable
//     compact   1.25M Ft         the Dashboard, strip cells, chart labels
//
// The rule is not taste: a table is a place where figures are compared to each
// other and the digits have to line up, and a Dashboard is a place where a
// figure is read once at a glance. Mixing them inside one surface is the thing
// §48 forbids, so every call site picks one and uses it for the whole surface.
//
// GROUPING IS A SPACE, AND IS NOT LOCALE-DEPENDENT
// ------------------------------------------------
// `1 250 000`, always, on every machine. The rest of the Portal formats COUNTS
// with `toLocaleString('en-GB')` and gets `1,250`; money is grouped with spaces
// because that is the Hungarian convention for currency and this is a Hungarian
// business. The distinction is deliberate and consistent — counts one way, money
// the other — rather than the same figure changing shape depending on whose
// laptop rendered it.
//
// NOTHING HERE CONVERTS BETWEEN CURRENCIES
// ----------------------------------------
// There is no rate in this system (§4). Every function below takes the currency
// it is given and prints it; two amounts in different currencies are two
// figures, never one. `sumByCurrency` is the shape that makes that impossible to
// get wrong by accident.
// =============================================================================

/** The currencies the database will store. Mirrors `is_supported_currency`. */
export const CURRENCIES = ['HUF', 'EUR', 'USD'] as const;
export type Currency = (typeof CURRENCIES)[number];

/**
 * How each currency is written.
 *
 * `after` because all three read naturally that way in Hungarian — `1 250 Ft`,
 * `1 250 €` — and one placement rule is one fewer thing for the eye to parse
 * when a table has two currencies in it.
 */
const UNIT: Record<string, string> = { HUF: 'Ft', EUR: '€', USD: '$' };

export const currencyUnit = (currency: string | null | undefined) =>
  UNIT[currency ?? ''] ?? currency ?? '';

/**
 * `1250000` → `1 250 000`. A regular space, grouped in threes.
 *
 * Whole units only. Every amount this product stores is `numeric(14,2)` and
 * every amount it PRINTS is rounded to the unit, because a pipeline figure
 * quoted to the fillér is a false precision on a number that is an estimate in
 * the first place. The stored value keeps its decimals; the display does not.
 */
export function group(value: number): string {
  const rounded = Math.round(value);
  const spaced = String(Math.abs(rounded)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  // A minus sign (U+2212), not a hyphen: it is the same width as the digits
  // beside it, which is what keeps a column of tabular figures aligned.
  return `${rounded < 0 ? '−' : ''}${spaced}`;
}

/**
 * The exact figure. `1 250 000 Ft`.
 *
 * Returns null for null — NOT `0 Ft`. A project with no recorded value and a
 * project worth nothing are different facts, and §31 is explicit that the first
 * must read `Not recorded` rather than a false zero. Every call site therefore
 * has to decide what absence looks like, which is the point.
 */
export function money(
  value: number | null | undefined,
  currency: string | null | undefined = 'HUF',
): string | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  return `${group(value)} ${currencyUnit(currency)}`.trim();
}

/**
 * The glanceable figure. `1.25M Ft`, `850k Ft`, `640 Ft`.
 *
 * Two significant decimals at most, trailing zeros trimmed, so `2 000 000`
 * is `2M Ft` and not `2.00M Ft` — a decimal that is always zero is noise that
 * teaches the reader to stop looking at the decimals.
 */
export function moneyCompact(
  value: number | null | undefined,
  currency: string | null | undefined = 'HUF',
): string | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;

  const unit = currencyUnit(currency);
  const abs = Math.abs(value);
  const sign = value < 0 ? '−' : '';

  // Only ever trims INSIDE a decimal part. `/\.?0+$/` on "850" eats the last
  // digit and prints `85k Ft` for 850 000 — which is the kind of bug that is
  // invisible until somebody quotes the wrong number off a dashboard.
  const trim = (n: number, digits: number) => {
    const fixed = n.toFixed(digits);
    return fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed;
  };

  if (abs >= 1_000_000_000) return `${sign}${trim(abs / 1_000_000_000, 2)}B ${unit}`.trim();
  if (abs >= 1_000_000)     return `${sign}${trim(abs / 1_000_000, 2)}M ${unit}`.trim();
  if (abs >= 10_000)        return `${sign}${trim(abs / 1_000, 0)}k ${unit}`.trim();
  return `${sign}${group(Math.round(abs))} ${unit}`.trim();
}

/** A percentage, for margins and probabilities. `62%`. */
export function percent(value: number | null | undefined, digits = 0): string | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  return `${value.toFixed(digits)}%`;
}

/* ========================================================= many currencies */

export interface CurrencyTotal {
  currency: string;
  /** How many records are behind this total. */
  items: number;
  value: number;
  /** Only meaningful where a weighting exists — the pipeline, not won revenue. */
  weighted: number;
}

/**
 * Add up amounts that may not be in the same currency, without ever adding two
 * that are not.
 *
 * The return is a LIST, biggest first, and that shape is the whole point: there
 * is no way to accidentally read one total off it. A caller that wants "the"
 * pipeline figure asks for `primary()` and gets the largest group plus a count
 * of what is not in it, which is what the screens print:
 *
 *     12.5M Ft            + 2 in other currencies
 */
export function sumByCurrency(
  rows: {
    currency?: string | null;
    value?: number | null;
    weighted?: number | null;
    /**
     * How many records this row already stands for.
     *
     * The two callers are different in exactly this way and it matters. A list
     * of opportunities has one record per row, so `items` is absent and each row
     * counts once. A row of `portal_sales_summary()` is ALREADY an aggregate and
     * carries its own count — counting it as one would make the Dashboard print
     * "1 open opportunity" above a fourteen-deal pipeline.
     */
    items?: number | null;
  }[],
): CurrencyTotal[] {
  const totals = new Map<string, CurrencyTotal>();
  for (const row of rows) {
    const currency = row.currency || 'HUF';
    const entry = totals.get(currency) ?? { currency, items: 0, value: 0, weighted: 0 };
    entry.items += row.items ?? 1;
    entry.value += Number(row.value ?? 0);
    entry.weighted += Number(row.weighted ?? 0);
    totals.set(currency, entry);
  }
  return [...totals.values()].sort((a, b) => b.value - a.value);
}

/**
 * The group a screen should print, and how much is not in it.
 *
 * `others` is a count of RECORDS, never a converted amount. A screen showing
 * `12.5M Ft` with `+2 in other currencies` beside it is telling the truth; the
 * same screen showing one total that silently included them would not be.
 */
export function primaryTotal(totals: CurrencyTotal[]): {
  total: CurrencyTotal | null;
  others: number;
  otherCurrencies: string[];
} {
  if (totals.length === 0) return { total: null, others: 0, otherCurrencies: [] };
  const [first, ...rest] = totals;
  return {
    total: first,
    others: rest.reduce((sum, t) => sum + t.items, 0),
    otherCurrencies: rest.map((t) => t.currency),
  };
}

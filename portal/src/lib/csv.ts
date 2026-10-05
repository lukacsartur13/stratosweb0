/**
 * CSV for the Portal's import and export. Pure: no imports, so the tests run
 * it directly (tests/csv.spec.ts).
 *
 * Writing: semicolon-separated with a UTF-8 byte-order mark — what a
 * Hungarian Excel opens correctly with a double click (accents included).
 * A cell that starts with = + - @ is prefixed with an apostrophe, so a value
 * somebody typed into a form can never run as a spreadsheet formula.
 *
 * Reading: the delimiter is detected (semicolon, comma or tab), quotes and
 * line breaks inside quotes are honoured, a byte-order mark is dropped.
 */

export const BOM = '\uFEFF';

function cell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  let s = value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Rows to CSV text, with a header row from `columns` (key → header). */
export function toCsv<T extends Record<string, unknown>>(rows: T[], columns: { key: keyof T & string; header: string }[]): string {
  const lines = [columns.map((c) => cell(c.header)).join(';')];
  for (const r of rows) lines.push(columns.map((c) => cell(r[c.key])).join(';'));
  return `${BOM}${lines.join('\r\n')}\r\n`;
}

/** The delimiter used in the first line, outside quotes. */
function detect(text: string): string {
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  let inQuotes = false;
  const counts: Record<string, number> = { ';': 0, ',': 0, '\t': 0 };
  for (const ch of first) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch in counts) counts[ch] += 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][1] > 0
    ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] : ';';
}

/** CSV text to rows of strings (header row included). Empty lines are dropped. */
export function parseCsv(input: string): string[][] {
  const text = input.startsWith(BOM) ? input.slice(1) : input;
  const sep = detect(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (ch === '"') inQuotes = false;
      else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === sep) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field); field = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

/** Header-keyed records; `aliases` maps a canonical key to the headers that mean it (case- and accent-insensitive). */
export function records(rows: string[][], aliases: Record<string, string[]>): { data: Record<string, string>[]; matched: string[]; unknown: string[] } {
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const [header = [], ...body] = rows;
  const keyOf = header.map((h) => Object.entries(aliases).find(([, names]) => names.some((n) => norm(n) === norm(h)))?.[0] ?? null);
  const matched = [...new Set(keyOf.filter((k): k is string => k !== null))];
  const unknown = header.filter((_, i) => keyOf[i] === null && header[i].trim() !== '');
  const data = body.map((cells) => {
    const out: Record<string, string> = {};
    keyOf.forEach((k, i) => { if (k && cells[i] !== undefined && out[k] === undefined) out[k] = cells[i].trim(); });
    return out;
  });
  return { data, matched, unknown };
}

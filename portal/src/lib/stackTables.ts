/**
 * Column heads onto cells, for the phone card layout of `table.m-stack`
 * (styles.css, "PHONES"). Below 640px a table is shown as one card per row and
 * every cell prints its own label — which it can only do if it knows which
 * column it is in. This copies each <th>'s text onto the cells under it as
 * `data-label`, counting colspans, and marks a cell holding only a dash so the
 * card can leave that line out.
 *
 * One observer for the whole app rather than a hook per table: tables are
 * rendered by a dozen screens and re-rendered on every filter change, and the
 * labels have to follow every one of those renders.
 */
function label(table: HTMLTableElement) {
  const headRow = table.tHead?.rows[0];
  if (!headRow) return;
  const heads: string[] = [];
  for (const th of Array.from(headRow.cells)) {
    const text = (th.textContent || '').trim();
    for (let i = 0; i < th.colSpan; i += 1) heads.push(text);
  }
  for (const body of Array.from(table.tBodies)) {
    for (const row of Array.from(body.rows)) {
      // The card's title: the row's own link if one of its first three cells
      // carries it (a list's subject is the link — the date before it is a
      // fact about it), otherwise simply the first cell.
      const cells = Array.from(row.cells);
      const title = cells.slice(0, 3).find((c) => c.colSpan === 1 && c.querySelector('a[href]')) ?? cells[0];
      for (const c of cells) {
        if (c === title) { if (!c.hasAttribute('data-title')) c.setAttribute('data-title', ''); }
        else if (c.hasAttribute('data-title')) c.removeAttribute('data-title');
      }
      let col = 0;
      for (const cell of Array.from(row.cells)) {
        const want = cell.colSpan > 1 ? '' : heads[col] ?? '';
        if (cell.getAttribute('data-label') !== want) cell.setAttribute('data-label', want);
        const text = (cell.textContent || '').trim();
        const blank = cell.children.length === 0 ? text === '' || text === '—' || text === '–'
          : text === '—' && !cell.querySelector('button, a, input, select');
        if (blank) cell.setAttribute('data-empty', '');
        else cell.removeAttribute('data-empty');
        col += cell.colSpan;
      }
    }
  }
}

let queued = false;
function run() {
  queued = false;
  document.querySelectorAll<HTMLTableElement>('table.m-stack').forEach(label);
}

export function startTableLabels() {
  if (typeof MutationObserver === 'undefined') return;
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(run);
  };
  new MutationObserver(schedule).observe(document.body, {
    childList: true, subtree: true, characterData: true,
  });
  schedule();
}

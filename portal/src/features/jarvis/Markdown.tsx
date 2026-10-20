import { Fragment, type ReactNode } from 'react';

/**
 * Jarvis's answers, drawn from the little Markdown it writes: paragraphs,
 * lists, **bold**, `code`, headings, tables and code blocks.
 *
 * React elements only — no HTML is ever parsed or injected, so nothing in an
 * answer (which may quote a form message or an e-mail subject) can become
 * markup. Links are not made clickable either: an address in an answer is
 * text, because a link Jarvis was talked into writing is exactly the thing a
 * prompt injection would want someone to click.
 */

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(re)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const token = m[0];
    if (token.startsWith('**')) out.push(<strong key={`${key}-${i}`} className="font-semibold text-paper">{token.slice(2, -2)}</strong>);
    else out.push(<code key={`${key}-${i}`} className="rounded-sm bg-flare px-1 font-data text-[12px]">{token.slice(1, -1)}</code>);
    last = at + token.length;
    i += 1;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const cells = (line: string) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
const isRule = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let n = 0;
  const key = () => `b${(n += 1)}`;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i += 1; continue; }

    if (line.trim().startsWith('```')) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith('```')) body.push(lines[(i += 1) - 1]);
      i += 1;
      blocks.push(<pre key={key()} className="overflow-x-auto rounded-sm bg-flare p-2 font-data text-[12px] leading-relaxed">{body.join('\n')}</pre>);
      continue;
    }

    if (line.trim().startsWith('|')) {
      const rows: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(lines[(i += 1) - 1]);
      const [head, ...rest] = rows;
      const body = rest.filter((r) => !isRule(r));
      const k = key();
      blocks.push(
        <div key={k} className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-[12px]">
            <thead>
              <tr>{cells(head).map((c, j) => <th key={j} className="border-b border-hair px-2 py-1 font-data text-[10px] uppercase tracking-[0.12em] text-haze">{inline(c, `${k}h${j}`)}</th>)}</tr>
            </thead>
            <tbody>
              {body.map((r, ri) => (
                <tr key={ri} className="border-b border-hairline">
                  {cells(r).map((c, j) => <td key={j} className="px-2 py-1 align-top num">{inline(c, `${k}r${ri}c${j}`)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    const bullet = /^\s*[-*•]\s+/;
    const numbered = /^\s*\d+[.)]\s+/;
    if (bullet.test(line) || numbered.test(line)) {
      const ordered = numbered.test(line);
      const items: string[] = [];
      while (i < lines.length && (ordered ? numbered : bullet).test(lines[i])) {
        items.push(lines[i].replace(ordered ? numbered : bullet, ''));
        i += 1;
      }
      const k = key();
      const List = ordered ? 'ol' : 'ul';
      blocks.push(
        <List key={k} className={ordered ? 'grid list-decimal gap-1 pl-5' : 'grid list-disc gap-1 pl-5'}>
          {items.map((item, j) => <li key={j}>{inline(item, `${k}i${j}`)}</li>)}
        </List>,
      );
      continue;
    }

    const heading = /^#{1,4}\s+(.*)$/.exec(line);
    if (heading) {
      const k = key();
      blocks.push(<p key={k} className="font-semibold text-paper">{inline(heading[1], k)}</p>);
      i += 1;
      continue;
    }

    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^\s*([-*•]|\d+[.)]|#{1,4}|\||```)/.test(lines[i])) para.push(lines[(i += 1) - 1]);
    if (para.length === 0) { para.push(line); i += 1; }
    const k = key();
    blocks.push(
      <p key={k}>
        {para.map((p, j) => <Fragment key={j}>{j > 0 && <br />}{inline(p, `${k}l${j}`)}</Fragment>)}
      </p>,
    );
  }

  return <div className="grid gap-2 text-[13px] leading-relaxed text-paper">{blocks}</div>;
}

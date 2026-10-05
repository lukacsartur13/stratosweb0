import { createElement, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Download, Minus, Plus } from 'lucide-react';
import { Button, Dialog, Skeleton, cn } from '@/components/ui';
import { loadPreview, type PreviewKind } from '@/lib/documents';
import { intlLocale, t } from '@/lib/i18n';

/**
 * A project file opened INSIDE the Portal — for the owner and for clients —
 * without downloading it.
 *
 * Nothing here lets a file run anything in the page (documentRules.ts says
 * which kinds, decided from the name AND the bytes):
 *
 *   pdf   PDF.js draws each page onto a canvas. PDF scripts are not run and
 *         `isEvalSupported` is off.
 *   docx  mammoth turns the document into HTML TEXT, which is parsed (never
 *         inserted) and rebuilt from an allow-list of elements as React nodes:
 *         no attribute survives but a table cell's span, links lose their
 *         target, and only embedded raster images are kept.
 *   xlsx  cell values, as text, in a table.
 *
 * The three libraries are loaded only when such a file is opened.
 *
 * `hungarian`: the client portal is written in Hungarian, so its buttons and
 * messages here are keyed in Hungarian too.
 */

const TOUCH = 'max-sm:min-h-10';
const MAX_PDF_PAGES = 40;
const MAX_ROWS = 500;
const MAX_COLS = 60;

export function FileViewerDialog({ doc, onClose, onDownload, hungarian = false }: {
  doc: { storage_path: string; name: string };
  onClose: () => void;
  onDownload: () => void;
  hungarian?: boolean;
}) {
  const L = (en: string, hu: string, vars?: Record<string, string | number>) => t(hungarian ? hu : en, vars);
  const [shown, setShown] = useState<{ kind: PreviewKind; blob: Blob; url?: string; text?: string } | { error: string } | null>(null);

  useEffect(() => {
    let alive = true;
    let url: string | undefined;
    void loadPreview(doc).then((r) => {
      if (!alive) return;
      if ('error' in r) {
        // The owner gets the precise reason (it is in the owner's language);
        // the client portal one plain sentence in its own.
        setShown({ error: hungarian ? L('The file could not be opened. Download it instead.', 'A fájl nem nyitható meg. Töltsd le inkább.') : r.error });
        return;
      }
      if (r.kind.kind === 'image') url = URL.createObjectURL(r.blob);
      setShown({ kind: r.kind, blob: r.blob, url, text: r.text });
    });
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [doc.storage_path]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Dialog open wide onClose={onClose} title={doc.name}
            footer={<>
              <Button size="sm" className={TOUCH} onClick={onDownload}><Download size={11} aria-hidden="true" /> {L('Download', 'Letöltés')}</Button>
              <Button size="sm" className={TOUCH} onClick={onClose}>{L('Close', 'Bezárás')}</Button>
            </>}>
      <div data-file-viewer={shown && 'kind' in shown ? shown.kind.kind : 'loading'}>
        {!shown && <Skeleton className="h-64 w-full" />}
        {shown && 'error' in shown && <p role="alert" className="text-xs text-danger">{shown.error}</p>}
        {shown && 'kind' in shown && shown.kind.kind === 'image' && shown.url && (
          <img src={shown.url} alt={doc.name} className="mx-auto max-h-[70dvh] max-w-full object-contain" />
        )}
        {shown && 'kind' in shown && shown.kind.kind === 'text' && (
          <pre className="max-h-[70dvh] overflow-auto whitespace-pre-wrap break-words text-[12px] text-paper">{shown.text}</pre>
        )}
        {shown && 'kind' in shown && shown.kind.kind === 'pdf' && <PdfView blob={shown.blob} L={L} />}
        {shown && 'kind' in shown && shown.kind.kind === 'docx' && <DocxView blob={shown.blob} L={L} />}
        {shown && 'kind' in shown && shown.kind.kind === 'xlsx' && <XlsxView blob={shown.blob} L={L} />}
      </div>
    </Dialog>
  );
}

type Label = (en: string, hu: string, vars?: Record<string, string | number>) => string;

/* ===================================================================== pdf == */

function PdfView({ blob, L }: { blob: Blob; L: Label }) {
  const box = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pages, setPages] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    let destroy: (() => void) | undefined;
    void (async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
        const task = pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false, enableXfa: false });
        destroy = () => { void task.destroy(); };
        const pdf = await task.promise;
        if (!alive || !box.current) return;
        setPages(pdf.numPages);
        box.current.replaceChildren();
        const width = box.current.clientWidth || 800;
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        for (let n = 1; n <= Math.min(pdf.numPages, MAX_PDF_PAGES); n += 1) {
          const page = await pdf.getPage(n);
          if (!alive || !box.current) return;
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: (width / base.width) * zoom * ratio });
          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.style.width = `${Math.floor(viewport.width / ratio)}px`;
          canvas.className = 'mx-auto mb-3 block max-w-none bg-white shadow';
          canvas.setAttribute('aria-label', L('Page {n}', '{n}. oldal', { n }));
          canvas.setAttribute('role', 'img');
          box.current.appendChild(canvas);
          await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise;
        }
      } catch (e) {
        console.error('[viewer.pdf]', e);
        if (alive) setError(L('The PDF could not be shown. Download it instead.', 'A PDF nem jeleníthető meg. Töltsd le inkább.'));
      }
    })();
    return () => { alive = false; destroy?.(); };
  }, [blob, zoom]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="t-note">
          {pages === null ? L('Opening…', 'Megnyitás…')
            : pages > MAX_PDF_PAGES
              ? L('{shown} of {pages} pages shown — download it for the rest.', '{pages} oldalból {shown} látszik — a többihez töltsd le.', { shown: MAX_PDF_PAGES, pages })
              : L('{pages} pages', '{pages} oldal', { pages })}
        </span>
        <span className="flex items-center gap-1">
          <Button size="sm" variant="quiet" aria-label={L('Zoom out', 'Kicsinyítés')} disabled={zoom <= 0.5} onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}><Minus size={12} aria-hidden="true" /></Button>
          <span className="num w-12 text-center text-[11px] text-haze">{Math.round(zoom * 100)}%</span>
          <Button size="sm" variant="quiet" aria-label={L('Zoom in', 'Nagyítás')} disabled={zoom >= 3} onClick={() => setZoom((z) => Math.min(3, z + 0.25))}><Plus size={12} aria-hidden="true" /></Button>
        </span>
      </div>
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      <div ref={box} className="max-h-[70dvh] overflow-auto rounded-sm bg-flare p-2" data-pdf-pages />
    </div>
  );
}

/* ==================================================================== docx == */

const BLOCK: Record<string, string> = {
  p: 'mb-2', h1: 'mb-2 mt-3 text-xl', h2: 'mb-2 mt-3 text-lg', h3: 'mb-1.5 mt-2 text-base font-medium',
  h4: 'mb-1 mt-2 font-medium', h5: 'mb-1 mt-2 font-medium', h6: 'mb-1 mt-2 font-medium',
  ul: 'mb-2 list-disc pl-6', ol: 'mb-2 list-decimal pl-6', li: 'mb-0.5',
  table: 'mb-3 border-collapse text-[12px]', thead: '', tbody: '', tr: '',
  td: 'border border-hair px-2 py-1 align-top', th: 'border border-hair px-2 py-1 text-left font-medium',
  strong: 'font-semibold', b: 'font-semibold', em: 'italic', i: 'italic', u: 'underline', s: 'line-through',
  sup: '', sub: '', blockquote: 'mb-2 border-l-2 border-hair pl-3', br: '',
};
const SAFE_IMAGE = /^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=]+$/i;

/** HTML text → React nodes, keeping only the allow-listed elements. */
function rebuild(node: Node, key: string): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  const children = Array.from(el.childNodes).map((c, i) => rebuild(c, `${key}.${i}`));
  if (tag === 'img') {
    const src = el.getAttribute('src') ?? '';
    return SAFE_IMAGE.test(src) ? createElement('img', { key, src, alt: el.getAttribute('alt') ?? '', className: 'my-2 max-w-full' }) : null;
  }
  if (tag === 'a') return createElement('span', { key, className: 'underline' }, ...children);
  if (!(tag in BLOCK)) return createElement('span', { key }, ...children); // unknown: keep the text, drop the element
  const props: Record<string, unknown> = { key, className: BLOCK[tag] || undefined };
  if (tag === 'td' || tag === 'th') {
    const span = (n: string | null) => { const v = Number(n); return Number.isInteger(v) && v > 1 && v < 100 ? v : undefined; };
    props.colSpan = span(el.getAttribute('colspan'));
    props.rowSpan = span(el.getAttribute('rowspan'));
  }
  return tag === 'br' ? createElement('br', { key }) : createElement(tag, props, ...children);
}

function DocxView({ blob, L }: { blob: Blob; L: Label }) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const mod = await import('mammoth/mammoth.browser');
        const mammoth = (mod as unknown as { default?: typeof mod }).default ?? mod;
        const result = await mammoth.convertToHtml({ arrayBuffer: await blob.arrayBuffer() });
        if (alive) setHtml(result.value);
      } catch (e) {
        console.error('[viewer.docx]', e);
        if (alive) setError(L('The document could not be shown. Download it instead.', 'A dokumentum nem jeleníthető meg. Töltsd le inkább.'));
      }
    })();
    return () => { alive = false; };
  }, [blob]); // eslint-disable-line react-hooks/exhaustive-deps

  // DOMParser builds an inert document: nothing in it loads or runs.
  const nodes = useMemo(() => {
    if (html === null) return null;
    const body = new DOMParser().parseFromString(html, 'text/html').body;
    return Array.from(body.childNodes).map((n, i) => rebuild(n, String(i)));
  }, [html]);

  if (error) return <p role="alert" className="text-xs text-danger">{error}</p>;
  if (!nodes) return <Skeleton className="h-64 w-full" />;
  return (
    <div className="grid gap-2">
      <p className="t-note">{L('Shown as text: the content and structure are exact, the layout and fonts are simplified.',
        'Szövegként látszik: a tartalom és a szerkezet pontos, az elrendezés és a betűk egyszerűsítve.')}</p>
      <article className="max-h-[70dvh] overflow-auto rounded-sm bg-panel px-5 py-4 text-[13px] leading-relaxed text-paper" data-docx>
        {nodes.length > 0 ? nodes : <p className="text-haze">{L('The document is empty.', 'A dokumentum üres.')}</p>}
      </article>
    </div>
  );
}

/* ==================================================================== xlsx == */

type Cell = string | number | boolean | Date | null;

function XlsxView({ blob, L }: { blob: Blob; L: Label }) {
  const [sheets, setSheets] = useState<{ sheet: string; data: Cell[][] }[] | null>(null);
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const { default: readXlsxFile } = await import('read-excel-file/browser');
        const result = await readXlsxFile(blob);
        if (alive) setSheets(result as unknown as { sheet: string; data: Cell[][] }[]);
      } catch (e) {
        console.error('[viewer.xlsx]', e);
        if (alive) setError(L('The spreadsheet could not be shown. Download it instead.', 'A táblázat nem jeleníthető meg. Töltsd le inkább.'));
      }
    })();
    return () => { alive = false; };
  }, [blob]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <p role="alert" className="text-xs text-danger">{error}</p>;
  if (!sheets) return <Skeleton className="h-64 w-full" />;
  const sheet = sheets[active];
  const rows = sheet?.data ?? [];
  const cols = Math.min(MAX_COLS, Math.max(0, ...rows.slice(0, MAX_ROWS).map((r) => r.length)));
  const show = (v: Cell) => (v === null || v === undefined ? '' : v instanceof Date ? v.toLocaleDateString(intlLocale('en-GB')) : String(v));

  return (
    <div className="grid gap-2">
      {sheets.length > 1 && (
        <div role="tablist" aria-label={L('Sheets', 'Munkalapok')} className="flex flex-wrap gap-px">
          {sheets.map((s, i) => (
            <button key={s.sheet} type="button" role="tab" aria-selected={i === active} onClick={() => setActive(i)}
                    className={cn('rounded-sm px-2.5 py-1 text-[12px]', i === active ? 'bg-flare text-paper' : 'text-haze hover:text-paper')}>
              {s.sheet}
            </button>
          ))}
        </div>
      )}
      {(rows.length > MAX_ROWS || rows.some((r) => r.length > MAX_COLS)) && (
        <p className="t-note">{L('The first {rows} rows and {cols} columns are shown — download it for the rest.',
          'Az első {rows} sor és {cols} oszlop látszik — a többihez töltsd le.', { rows: MAX_ROWS, cols: MAX_COLS })}</p>
      )}
      <div className="max-h-[70dvh] overflow-auto rounded-sm border border-hairline" data-xlsx>
        {rows.length === 0 ? <p className="p-3 text-xs text-haze">{L('This sheet is empty.', 'Ez a munkalap üres.')}</p> : (
          <table className="border-collapse text-[12px] text-paper">
            <tbody>
              {rows.slice(0, MAX_ROWS).map((r, i) => (
                // eslint-disable-next-line react/no-array-index-key
                <tr key={i} className={i === 0 ? 'bg-flare font-medium' : undefined}>
                  <th className="sticky left-0 border border-hairline bg-deck px-1.5 py-1 text-right font-normal text-haze num">{i + 1}</th>
                  {Array.from({ length: cols }, (_, j) => (
                    <td key={j} className="whitespace-nowrap border border-hairline px-2 py-1">{show(r[j] ?? null)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

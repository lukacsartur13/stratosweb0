import { useRef, useState } from 'react';
import { Download, Upload } from 'lucide-react';
import { useAuth } from '@/features/auth/AuthProvider';
import { canAccess } from '@/lib/permissions';
import { Badge, Button, Panel, SectionHeader } from '@/components/ui';
import { Segmented } from '@/components/charts';
import { parseCsv, toCsv } from '@/lib/csv';
import { IMPORT_ALIASES, exportDataset, planImport, runImport, type Dataset, type ImportKind, type ImportPlan } from '@/lib/dataTransfer';
import { t } from '@/lib/i18n';

/**
 * IMPORT & EXPORT — every list as a CSV a Hungarian Excel opens, and clients
 * or leads brought in from one. An export holds only what the signed-in person
 * may see; an import shows its plan (what will be written, what is skipped and
 * why) before writing anything, and never overwrites.
 */

const EXPORTS: { id: Dataset; label: string; note: string; owner?: boolean }[] = [
  { id: 'leads', label: 'Leads', note: 'every lead not in the Trash' },
  { id: 'clients', label: 'Clients', note: 'with their main contact' },
  { id: 'deals', label: 'Deals', note: 'the sales pipeline, won and lost included' },
  { id: 'hours', label: 'Hours', note: 'everybody\'s logged hours' },
  { id: 'projects', label: 'Projects', note: 'paid, monthly and Impact', owner: true },
  { id: 'payments', label: 'Payments', note: 'every recorded payment', owner: true },
];

export function DataScreen() {
  const { profile } = useAuth();
  const owner = canAccess(profile, 'view_projects');
  const [busy, setBusy] = useState<Dataset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (d: Dataset) => { setBusy(d); setError(await exportDataset(d)); setBusy(null); };

  return (
    <div className="grid gap-4 lg:max-w-4xl">
      <Panel aria-label={t('Export')}>
        <SectionHeader title={t('Export')} note={t('CSV · opens in Excel')} />
        <ul className="grid">
          {EXPORTS.filter((e) => owner || !e.owner).map((e) => (
            <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline px-4 py-2 last:border-0">
              <div className="min-w-0">
                <p className="text-[13px] text-paper">{t(e.label)}</p>
                <p className="t-note">{t(e.note)}</p>
              </div>
              <Button size="sm" onClick={() => void run(e.id)} disabled={busy !== null} data-export={e.id}>
                <Download size={11} aria-hidden="true" /> {busy === e.id ? t('Preparing…') : t('Download CSV')}
              </Button>
            </li>
          ))}
        </ul>
        {error && <p role="alert" className="border-t border-hairline px-4 py-2 text-xs text-danger">{error}</p>}
      </Panel>
      <Importer />
    </div>
  );
}

const TEMPLATE_HEADERS: Record<ImportKind, string[]> = {
  clients: ['Cégnév', 'Weboldal', 'Szolgáltatás', 'Kapcsolattartó', 'Beosztás', 'E-mail', 'Telefon'],
  leads: ['Név', 'E-mail', 'Telefon', 'Cég', 'Weboldal', 'Szolgáltatás', 'Üzenet', 'Dátum', 'Állapot'],
};

function downloadTemplate(kind: ImportKind) {
  const headers = TEMPLATE_HEADERS[kind];
  const csv = toCsv([], headers.map((h) => ({ key: h, header: h })));
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `stratos-${kind}-minta.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function Importer() {
  const [kind, setKind] = useState<ImportKind>('clients');
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [file, setFile] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<{ written: number; failed: { label: string; reason: string }[] } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const reset = () => { setPlan(null); setFile(null); setError(null); setResult(null); setProgress(null); };
  const read = async (f: File) => {
    reset();
    if (f.size > 5 * 1024 * 1024) return setError(t('The file is larger than 5 MB.'));
    const text = await f.text();
    const table = parseCsv(text);
    if (table.length < 2) return setError(t('The file has no rows under the header.'));
    if (table.length > 5001) return setError(t('At most 5000 rows at a time.'));
    setFile(f.name);
    const p = await planImport(kind, table);
    if ('error' in p) return setError(p.error);
    setPlan(p);
  };
  const go = async () => {
    if (!plan) return;
    setProgress(0);
    setResult(await runImport(plan, setProgress));
    setProgress(null);
  };
  const shown = plan ? Object.keys(IMPORT_ALIASES[plan.kind]).filter((k) => plan.matched.includes(k)) : [];

  return (
    <Panel aria-label={t('Import')}>
      <SectionHeader title={t('Import')} note={t('clients or leads from CSV')}
        action={<Segmented label={t('What')} value={kind} onChange={(k) => { setKind(k); reset(); }}
          options={[{ id: 'clients', label: t('Clients') }, { id: 'leads', label: t('Leads') }]} />} />
      <div className="grid gap-2 px-4 py-3 text-[13px]">
        <p className="t-note">
          {kind === 'clients'
            ? t('One client per row. Recognised columns: name (required), website, service, contact, role, e-mail, phone — in Hungarian or English. A client whose name already exists is skipped.')
            : t('One lead per row. Recognised columns: e-mail (required), name, phone, company, website, service, message, date, status. A lead whose e-mail already exists is skipped. Without a status column they are imported as “contacted”, so the reply reminder does not fire for old leads.')}
        </p>
        <p className="t-note">{t('From Excel: File → Save As → “CSV UTF-8”.')}</p>
        <div className="flex flex-wrap items-center gap-2">
          <input ref={input} type="file" accept=".csv,text/csv" className="sr-only" tabIndex={-1} aria-label={t('Choose a CSV file')}
                 onChange={(e) => { const f = e.target.files?.[0]; if (f) void read(f); e.target.value = ''; }} data-import-file />
          <Button size="sm" variant="primary" onClick={() => input.current?.click()}><Upload size={11} aria-hidden="true" /> {t('Choose a CSV file')}</Button>
          <button type="button" className="t-note underline underline-offset-4 hover:text-paper" onClick={() => downloadTemplate(kind)}>{t('Download a template')}</button>
          {file && <span className="t-note">{file}</span>}
        </div>
        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      </div>

      {plan && !result && (
        <div className="grid gap-2 border-t border-hairline px-4 py-3 text-[13px]" data-import-plan>
          <p className="text-paper">
            <Badge tone="good">{t('{n} to import', { n: plan.ready.length })}</Badge>{' '}
            {plan.skipped.length > 0 && <Badge tone="warn">{t('{n} skipped', { n: plan.skipped.length })}</Badge>}
          </p>
          <p className="t-note">{t('Columns recognised: {list}', { list: shown.join(', ') })}{plan.unknown.length ? ` · ${t('ignored: {list}', { list: plan.unknown.join(', ') })}` : ''}</p>
          {plan.ready.length > 0 && (
            <div className="overflow-x-auto">
              <table className="m-stack w-full min-w-[480px] text-[12px]">
                <thead><tr className="border-b border-hairline text-left">{shown.map((k) => <th key={k} className="label px-2 py-1 font-normal">{k}</th>)}</tr></thead>
                <tbody>
                  {plan.ready.slice(0, 5).map((r, i) => (
                    <tr key={i} className="border-b border-hairline last:border-0">{shown.map((k) => <td key={k} className="max-w-48 truncate px-2 py-1 text-haze">{r[k] ?? ''}</td>)}</tr>
                  ))}
                </tbody>
              </table>
              {plan.ready.length > 5 && <p className="t-note mt-1">{t('… and {n} more', { n: plan.ready.length - 5 })}</p>}
            </div>
          )}
          {plan.skipped.length > 0 && (
            <details>
              <summary className="t-note cursor-pointer">{t('Skipped rows')}</summary>
              <ul className="mt-1 grid gap-0.5">
                {plan.skipped.slice(0, 100).map((s) => <li key={s.line} className="t-note">{t('line {n}', { n: s.line })} · {s.label} — {s.reason}</li>)}
              </ul>
            </details>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="primary" disabled={plan.ready.length === 0 || progress !== null} onClick={() => void go()} data-import-go>
              {progress !== null ? t('Importing… {done}/{all}', { done: progress, all: plan.ready.length }) : t('Import {n}', { n: plan.ready.length })}
            </Button>
            <Button size="sm" variant="quiet" onClick={reset} disabled={progress !== null}>{t('Cancel')}</Button>
          </div>
        </div>
      )}

      {result && (
        <div className="grid gap-1 border-t border-hairline px-4 py-3 text-[13px]" role="status" data-import-result>
          <p className="text-paper">{t('{n} imported.', { n: result.written })}</p>
          {result.failed.map((f, i) => <p key={i} className="text-xs text-danger">{f.label} — {f.reason}</p>)}
          <div><Button size="sm" variant="quiet" onClick={reset}>{t('Import another file')}</Button></div>
        </div>
      )}
    </Panel>
  );
}

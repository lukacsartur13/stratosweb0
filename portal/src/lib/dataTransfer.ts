import { supabase } from '@/lib/supabase';
import { records, toCsv } from '@/lib/csv';
import { uniqueSlug } from '@/lib/operations';
import { t } from '@/lib/i18n';

/**
 * Import and export (the Portal's "5. CRM", third part).
 *
 * EXPORT: each dataset is read with the signed-in person's own rights (RLS),
 * so an export can never contain more than that person may see; projects and
 * payments are the owner's. Written as CSV that a Hungarian Excel opens.
 *
 * IMPORT: clients (with their main contact) and leads, from CSV or an Excel
 * "Save as CSV". Nothing is overwritten: a row whose client name or lead
 * e-mail already exists is skipped and listed. Every row is checked before
 * anything is written; the owner sees the plan first and confirms it.
 */

/* ================================================================ export */

export type Dataset = 'leads' | 'clients' | 'deals' | 'projects' | 'payments' | 'hours';
type Col = { key: string; header: string };

const day = (v: unknown) => (typeof v === 'string' ? v.slice(0, 10) : '');

async function rowsOf(dataset: Dataset): Promise<{ rows: Record<string, unknown>[]; columns: Col[] } | { error: string }> {
  const fail = (e: { code?: string } | null) => { console.error(`[export.${dataset}]`, e?.code); return { error: t('The export could not be read. Try again.') }; };
  if (dataset === 'leads') {
    const { data, error } = await supabase.from('leads')
      .select('created_at, name, email, phone, company, website, service_interest, budget_range, timeframe, status, source, message')
      .is('trashed_at', null).order('created_at', { ascending: false }).limit(10000);
    if (error) return fail(error);
    return {
      rows: (data ?? []).map((r) => ({ ...r, created_at: day(r.created_at) })),
      columns: [
        { key: 'created_at', header: t('Date') }, { key: 'name', header: t('Name') }, { key: 'email', header: t('Email') },
        { key: 'phone', header: t('Phone') }, { key: 'company', header: t('Company') }, { key: 'website', header: t('Website') },
        { key: 'service_interest', header: t('Service') }, { key: 'budget_range', header: t('Budget') }, { key: 'timeframe', header: t('Timeframe') },
        { key: 'status', header: t('Status') }, { key: 'source', header: t('Source') }, { key: 'message', header: t('Message') },
      ],
    };
  }
  if (dataset === 'clients') {
    const { data, error } = await supabase.from('organizations')
      .select('name, website, status, primary_service, created_at, contacts:client_contacts(name, role, email, phone, is_primary)')
      .is('archived_at', null).order('name').limit(10000);
    if (error) return fail(error);
    type C = { name: string; role: string | null; email: string | null; phone: string | null; is_primary: boolean };
    return {
      rows: (data ?? []).map((r) => {
        const cs = ((r as { contacts?: C[] }).contacts ?? []);
        const main = cs.find((c) => c.is_primary) ?? cs[0];
        return { ...r, created_at: day(r.created_at), contact: main?.name ?? '', contact_role: main?.role ?? '', email: main?.email ?? '', phone: main?.phone ?? '' };
      }),
      columns: [
        { key: 'name', header: t('Client') }, { key: 'website', header: t('Website') }, { key: 'status', header: t('Status') },
        { key: 'primary_service', header: t('Service') }, { key: 'contact', header: t('Contact') }, { key: 'contact_role', header: t('Role') },
        { key: 'email', header: t('Email') }, { key: 'phone', header: t('Phone') }, { key: 'created_at', header: t('Created') },
      ],
    };
  }
  if (dataset === 'deals') {
    const { data, error } = await supabase.from('opportunities')
      .select('created_at, title, company_name, contact_name, contact_email, service, stage, estimated_value, currency, probability, expected_close_on, next_action, next_action_on, won_at, lost_at, source')
      .is('archived_at', null).order('created_at', { ascending: false }).limit(10000);
    if (error) return fail(error);
    return {
      rows: (data ?? []).map((r) => ({ ...r, created_at: day(r.created_at), won_at: day(r.won_at), lost_at: day(r.lost_at) })),
      columns: [
        { key: 'created_at', header: t('Created') }, { key: 'title', header: t('Deal') }, { key: 'company_name', header: t('Company') },
        { key: 'contact_name', header: t('Contact') }, { key: 'contact_email', header: t('Email') }, { key: 'service', header: t('Service') },
        { key: 'stage', header: t('Stage') }, { key: 'estimated_value', header: t('Value') }, { key: 'currency', header: t('Currency') },
        { key: 'probability', header: t('Probability %') }, { key: 'expected_close_on', header: t('Expected close') },
        { key: 'next_action', header: t('Next step') }, { key: 'next_action_on', header: t('Next step on') },
        { key: 'won_at', header: t('Won') }, { key: 'lost_at', header: t('Lost') }, { key: 'source', header: t('Source') },
      ],
    };
  }
  if (dataset === 'projects') {
    const { data, error } = await supabase.from('projects')
      .select('name, service, status, program, billing, value, monthly_fee, currency, start_date, target_date, completed_at, client:organizations(name)')
      .is('archived_at', null).order('created_at', { ascending: false }).limit(10000);
    if (error) return fail(error);
    return {
      rows: (data ?? []).map((r) => ({ ...r, client: (r as unknown as { client?: { name: string } | null }).client?.name ?? '', completed_at: day(r.completed_at) })),
      columns: [
        { key: 'name', header: t('Project') }, { key: 'client', header: t('Client') }, { key: 'service', header: t('Service') },
        { key: 'status', header: t('Status') }, { key: 'program', header: t('Programme') }, { key: 'billing', header: t('Billing') },
        { key: 'value', header: t('Value') }, { key: 'monthly_fee', header: t('Monthly fee') }, { key: 'currency', header: t('Currency') },
        { key: 'start_date', header: t('Start') }, { key: 'target_date', header: t('Deadline') }, { key: 'completed_at', header: t('Closed') },
      ],
    };
  }
  if (dataset === 'payments') {
    const { data, error } = await supabase.from('project_payments')
      .select('paid_on, amount, note, instalment:project_instalments(label, due_on), project:projects(name, currency, client:organizations(name))')
      .order('paid_on', { ascending: false }).limit(20000);
    if (error) return fail(error);
    type P = { name: string; currency: string; client: { name: string } | null } | null;
    return {
      rows: (data ?? []).map((r) => {
        const p = (r as unknown as { project?: P }).project;
        const i = (r as unknown as { instalment?: { label: string; due_on: string | null } | null }).instalment;
        return { ...r, project: p?.name ?? '', client: p?.client?.name ?? '', currency: p?.currency ?? '', label: i?.label ?? '', due_on: i?.due_on ?? '' };
      }),
      columns: [
        { key: 'paid_on', header: t('Paid on') }, { key: 'amount', header: t('Amount') }, { key: 'currency', header: t('Currency') },
        { key: 'project', header: t('Project') }, { key: 'client', header: t('Client') }, { key: 'label', header: t('Instalment') },
        { key: 'due_on', header: t('Due') }, { key: 'note', header: t('Note') },
      ],
    };
  }
  // hours
  const [entries, people, projects] = await Promise.all([
    supabase.from('time_entries').select('work_date, hours, label, note, user_id, project_id').order('work_date', { ascending: false }).limit(50000),
    supabase.from('profiles').select('id, full_name, email'),
    supabase.rpc('time_projects'),
  ]);
  if (entries.error) return fail(entries.error);
  const who = new Map((people.data ?? []).map((p) => [p.id as string, (p.full_name as string | null) || (p.email as string)]));
  const what = new Map(((projects.data ?? []) as { project_id: string; project_name: string }[]).map((p) => [p.project_id, p.project_name]));
  return {
    rows: (entries.data ?? []).map((e) => ({
      ...e, person: who.get(e.user_id as string) ?? '', on: e.project_id ? what.get(e.project_id as string) ?? t('Project') : (e.label ?? t('Other')),
    })),
    columns: [
      { key: 'work_date', header: t('Date') }, { key: 'person', header: t('Person') }, { key: 'hours', header: t('Hours') },
      { key: 'on', header: t('On') }, { key: 'note', header: t('Note') },
    ],
  };
}

/** Builds the CSV and hands it to the browser as a download. Returns null or a sentence. */
export async function exportDataset(dataset: Dataset): Promise<string | null> {
  const r = await rowsOf(dataset);
  if ('error' in r) return r.error;
  const csv = toCsv(r.rows, r.columns);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `stratos-${dataset}-${new Date().toLocaleDateString('sv-SE')}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return null;
}

/* ================================================================ import */

export type ImportKind = 'clients' | 'leads';

export const IMPORT_ALIASES: Record<ImportKind, Record<string, string[]>> = {
  clients: {
    name: ['name', 'client', 'company', 'company name', 'ügyfél', 'cég', 'cégnév', 'név', 'firma', 'kunde'],
    website: ['website', 'web', 'url', 'weboldal', 'honlap', 'webseite'],
    service: ['service', 'primary service', 'szolgáltatás', 'leistung'],
    contact: ['contact', 'contact name', 'kapcsolattartó', 'ansprechpartner'],
    role: ['role', 'position', 'beosztás', 'pozíció', 'rolle'],
    email: ['email', 'e-mail', 'mail', 'email cím', 'e-mail cím'],
    phone: ['phone', 'telephone', 'mobile', 'telefon', 'telefonszám', 'mobil'],
  },
  leads: {
    name: ['name', 'név', 'full name', 'teljes név'],
    email: ['email', 'e-mail', 'mail', 'email cím', 'e-mail cím'],
    phone: ['phone', 'telephone', 'mobile', 'telefon', 'telefonszám', 'mobil'],
    company: ['company', 'cég', 'cégnév', 'firma'],
    website: ['website', 'web', 'url', 'weboldal', 'honlap'],
    service: ['service', 'service interest', 'szolgáltatás', 'érdeklődés'],
    message: ['message', 'note', 'üzenet', 'megjegyzés', 'nachricht'],
    date: ['date', 'created', 'created at', 'dátum', 'datum'],
    status: ['status', 'állapot', 'státusz'],
  },
};

const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'proposal', 'won', 'lost'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ImportPlan {
  kind: ImportKind;
  /** Rows that will be written. */
  ready: Record<string, string>[];
  /** Rows that will not, each with the reason (1-based line in the file, header = 1). */
  skipped: { line: number; label: string; reason: string }[];
  matched: string[];
  unknown: string[];
}

/** Checks every row and sorts them into ready / skipped, against what exists. Writes nothing. */
export async function planImport(kind: ImportKind, table: string[][]): Promise<ImportPlan | { error: string }> {
  const { data, matched, unknown } = records(table, IMPORT_ALIASES[kind]);
  if (kind === 'clients' && !matched.includes('name')) {
    return { error: t('The file needs a column with the client name (e.g. "Name" or "Cégnév").') };
  }
  if (kind === 'leads' && !matched.includes('email')) {
    return { error: t('The file needs an e-mail column: every lead has an e-mail address.') };
  }
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const ready: Record<string, string>[] = [];
  const skipped: ImportPlan['skipped'] = [];
  if (kind === 'clients') {
    const { data: existing, error } = await supabase.from('organizations').select('name');
    if (error) return { error: t('The existing clients could not be read. Try again.') };
    const seen = new Set((existing ?? []).map((o) => norm(o.name as string)));
    data.forEach((r, i) => {
      const line = i + 2;
      if (!r.name) return skipped.push({ line, label: r.email || '—', reason: t('no name') });
      if (r.name.length > 200) return skipped.push({ line, label: r.name.slice(0, 40), reason: t('the name is too long') });
      if (seen.has(norm(r.name))) return skipped.push({ line, label: r.name, reason: t('already a client') });
      if (r.email && !EMAIL.test(r.email)) return skipped.push({ line, label: r.name, reason: t('the e-mail address is not valid') });
      seen.add(norm(r.name));
      ready.push(r);
    });
  } else {
    const { data: existing, error } = await supabase.from('leads').select('email').not('email', 'is', null);
    if (error) return { error: t('The existing leads could not be read. Try again.') };
    const seen = new Set((existing ?? []).map((l) => norm(String(l.email))));
    data.forEach((r, i) => {
      const line = i + 2;
      const label = r.name || r.email || '—';
      if (!r.email) return skipped.push({ line, label, reason: t('no e-mail address') });
      if (r.email && !EMAIL.test(r.email)) return skipped.push({ line, label, reason: t('the e-mail address is not valid') });
      if (r.email && seen.has(norm(r.email))) return skipped.push({ line, label, reason: t('a lead with this e-mail exists') });
      if (r.date && Number.isNaN(Date.parse(r.date))) return skipped.push({ line, label, reason: t('the date is not readable (use YYYY-MM-DD)') });
      if (r.email) seen.add(norm(r.email));
      ready.push(r);
    });
  }
  return { kind, ready, skipped, matched, unknown };
}

/** Writes the ready rows, one by one, and reports what was written. */
export async function runImport(plan: ImportPlan, onProgress: (done: number) => void): Promise<{ written: number; failed: { label: string; reason: string }[] }> {
  let written = 0;
  const failed: { label: string; reason: string }[] = [];
  if (plan.kind === 'clients') {
    const { data: slugs } = await supabase.from('organizations').select('slug');
    const taken = (slugs ?? []).map((s) => s.slug as string);
    for (const r of plan.ready) {
      const slug = uniqueSlug(r.name, taken);
      taken.push(slug);
      const org = await supabase.from('organizations').insert({
        name: r.name.trim(), slug, website: r.website || null, status: 'active', primary_service: r.service || null, acquisition_source: 'import',
      }).select('id').single();
      if (org.error) { console.error('[import.client]', org.error.code); failed.push({ label: r.name, reason: t('refused by the database') }); continue; }
      if (r.contact || r.email || r.phone) {
        const c = await supabase.from('client_contacts').insert({
          organization_id: (org.data as { id: string }).id, name: (r.contact || r.name).slice(0, 200), role: r.role || null,
          email: r.email || null, phone: r.phone || null, is_primary: true,
        });
        if (c.error) console.error('[import.contact]', c.error.code);
      }
      written += 1;
      onProgress(written);
    }
  } else {
    for (const r of plan.ready) {
      const status = LEAD_STATUSES.includes((r.status ?? '').toLowerCase()) ? r.status.toLowerCase() : 'contacted';
      const { error } = await supabase.from('leads').insert({
        // A lead has a name and an e-mail (both required); with no name, the address stands in.
        name: (r.name || r.email.split('@')[0]).slice(0, 200), email: r.email, phone: r.phone || null, company: r.company || null, website: r.website || null,
        service_interest: r.service || null, message: r.message || null, source: 'import', status,
        ...(r.date ? { created_at: new Date(r.date).toISOString() } : {}),
      });
      if (error) { console.error('[import.lead]', error.code); failed.push({ label: r.name || r.email, reason: t('refused by the database') }); continue; }
      written += 1;
      onProgress(written);
    }
  }
  return { written, failed };
}

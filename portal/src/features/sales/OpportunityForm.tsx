import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Dialog, Field, Input, Select } from '@/components/ui';
import { CURRENCIES } from '@/lib/money';
import { OPEN_STAGES, STAGE, type Stage } from '@/lib/pipeline';
import { useOpportunityMutations, type OpportunityDraft } from '@/lib/sales';

/**
 * The create-an-opportunity dialog.
 *
 * Lives outside `pages/sales.tsx` because it is used from THREE places — the
 * Sales screen, the lead detail screen's Convert action, and nothing else should
 * need a fourth — and because `pages/sales.tsx` is a lazily loaded chunk that
 * must not be dragged into the entry bundle by a screen that only wants the
 * form. See the note in `features/sales/bits.tsx`.
 */

/* ================================================== manual creation (§52) */

/**
 * Create an opportunity that did not come from a website form.
 *
 * The required minimum is §52's: a title, a company, a value and a stage. Every
 * other field is on the detail screen — a creation form with eighteen inputs is
 * a form nobody finishes.
 */
export function NewOpportunity({
  open, onClose, onCreated, initial, lockedLead,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  /**
   * A pre-filled draft — in practice always `draftFromLead(lead)`. Taking the
   * mutation's own draft type rather than a narrowed copy of it means the
   * conversion cannot silently stop carrying a field that gets added later.
   */
  initial?: OpportunityDraft;
  lockedLead?: boolean;
}) {
  const navigate = useNavigate();
  const mutate = useOpportunityMutations(onCreated);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: initial?.title ?? '',
    company_name: initial?.company_name ?? '',
    contact_name: initial?.contact_name ?? '',
    contact_email: initial?.contact_email ?? '',
    contact_phone: initial?.contact_phone ?? '',
    service: initial?.service ?? '',
    estimated_value: '',
    currency: 'HUF',
    stage: (initial?.stage ?? 'qualified') as Stage,
    expected_close_on: '',
    next_action: '',
    next_action_on: '',
  });

  // The dialog is mounted by its parent only while open, so the initial values
  // are read once — no effect syncing props into state, and no chance of the
  // form resetting under somebody mid-edit.
  const field = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const submit = async () => {
    const amount = form.estimated_value.trim();
    const parsed = amount === '' ? null : Number(amount.replace(/\s/g, '').replace(',', '.'));
    if (parsed !== null && (!Number.isFinite(parsed) || parsed < 0)) {
      setError('The value must be a number, and not a negative one.');
      return;
    }

    const result = await mutate.create({
      title: form.title.trim(),
      company_name: form.company_name.trim() || null,
      contact_name: form.contact_name.trim() || null,
      contact_email: form.contact_email.trim() || null,
      contact_phone: form.contact_phone.trim() || null,
      service: form.service.trim() || null,
      estimated_value: parsed,
      currency: form.currency,
      stage: form.stage,
      expected_close_on: form.expected_close_on || null,
      next_action: form.next_action.trim() || null,
      next_action_on: form.next_action_on || null,
      lead_id: initial?.lead_id ?? null,
      source: initial?.source ?? null,
      medium: initial?.medium ?? null,
      campaign: initial?.campaign ?? null,
      landing_route: initial?.landing_route ?? null,
      locale: initial?.locale ?? null,
      form_type: initial?.form_type ?? null,
    });

    if (typeof result === 'string') { setError(result); return; }
    onClose();
    navigate(`/sales/${result.id}`);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      wide
      title={lockedLead ? 'Convert to opportunity' : 'New opportunity'}
      description={lockedLead
        ? 'The company, contact and attribution are carried over from the lead. The enquiry itself stays on the lead and is not copied.'
        : 'For a conversation that did not start on the website. Everything else can be filled in afterwards.'}
      footer={
        <>
          <Button size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" variant="primary" onClick={submit} disabled={mutate.busy === 'create'}>
            {lockedLead ? 'Create opportunity' : 'Create'}
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Field id="opp-title" label="Title">
          <Input id="opp-title" value={form.title} onChange={(e) => field('title', e.target.value)}
                 placeholder="Rapidkert — website relaunch" />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="opp-company" label="Company">
            <Input id="opp-company" value={form.company_name}
                   onChange={(e) => field('company_name', e.target.value)} />
          </Field>
          <Field id="opp-service" label="Service">
            <Input id="opp-service" value={form.service}
                   onChange={(e) => field('service', e.target.value)} placeholder="Website, Ads, Branding…" />
          </Field>
          <Field id="opp-contact" label="Contact">
            <Input id="opp-contact" value={form.contact_name}
                   onChange={(e) => field('contact_name', e.target.value)} />
          </Field>
          <Field id="opp-email" label="Contact email">
            <Input id="opp-email" type="email" value={form.contact_email}
                   onChange={(e) => field('contact_email', e.target.value)} />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field id="opp-value" label="Estimated value" hint="Leave empty if unknown">
            <Input id="opp-value" inputMode="numeric" value={form.estimated_value}
                   onChange={(e) => field('estimated_value', e.target.value)} placeholder="1200000" />
          </Field>
          <Field id="opp-currency" label="Currency">
            <Select id="opp-currency" className="w-full py-2.5 text-sm" value={form.currency}
                    onChange={(e) => field('currency', e.target.value)}>
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </Field>
          <Field id="opp-stage" label="Stage">
            <Select id="opp-stage" className="w-full py-2.5 text-sm" value={form.stage}
                    onChange={(e) => field('stage', e.target.value as Stage)}>
              {OPEN_STAGES.map((s) => <option key={s} value={s}>{STAGE[s].label}</option>)}
            </Select>
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field id="opp-close" label="Expected close">
            <Input id="opp-close" type="date" value={form.expected_close_on}
                   onChange={(e) => field('expected_close_on', e.target.value)} />
          </Field>
          <Field id="opp-action" label="Next action">
            <Input id="opp-action" value={form.next_action}
                   onChange={(e) => field('next_action', e.target.value)} placeholder="Discovery call" />
          </Field>
          <Field id="opp-action-date" label="Next action date">
            <Input id="opp-action-date" type="date" value={form.next_action_on}
                   onChange={(e) => field('next_action_on', e.target.value)} />
          </Field>
        </div>

        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      </div>
    </Dialog>
  );
}

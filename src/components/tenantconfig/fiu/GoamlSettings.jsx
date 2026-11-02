import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FIU_TYPES, FIU_TYPE_CODES } from '@/lib/fiuTypes';
import { useTenant } from '@/lib/tenantContext';

function Field({ label, hint, children }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

const THRESHOLDS = [
  ['ctr_cash', 'CTR: cash per client per day'],
  ['ttr', 'TTR: all transactions per client per day'],
  ['ift', 'IFT: each cross-border transfer'],
  ['cbr', 'CBR: each cross-border cash / bearer instrument'],
];

/** goAML report header, enabled report types with their FIU codes, and the threshold-report limits. */
export default function GoamlSettings({ draft, set, disabled }) {
  const { tenant } = useTenant();
  const reportingCurrency = tenant?.tm_reporting_currency;
  const txt = (key, label, opts = {}) => (
    <Field label={label} hint={opts.hint}>
      <Input disabled={disabled} className={`h-8 text-xs ${opts.mono ? 'font-mono' : ''}`} value={draft[key] ?? ''} maxLength={opts.max}
        onChange={(e) => set({ [key]: opts.upper ? e.target.value.toUpperCase() : e.target.value })} />
    </Field>
  );
  const sub = (group, key, label, type = 'text') => (
    <Field label={label}>
      <Input type={type} disabled={disabled} className="h-8 text-xs" value={draft[group]?.[key] ?? ''}
        onChange={(e) => set({ [group]: { ...draft[group], [key]: e.target.value } })} />
    </Field>
  );
  const enabled = new Set(draft.enabled_report_types || []);
  const toggleType = (t, on) => set({ enabled_report_types: FIU_TYPE_CODES.filter((x) => (x === t ? on : enabled.has(x))) });

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">goAML reporting entity</h4>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {txt('rentity_id', 'Reporting entity ID', { mono: true, hint: 'Issued by the FIU at goAML registration.' })}
          {txt('rentity_branch', 'Branch (optional)')}
          <Field label="Submission code">
            <Select disabled={disabled} value={draft.submission_code || 'E'} onValueChange={(v) => set({ submission_code: v })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="E">E · Electronic</SelectItem><SelectItem value="M">M · Manual</SelectItem></SelectContent>
            </Select>
          </Field>
          {txt('country_code', 'Reporting country (ISO-2)', { upper: true, max: 2, hint: 'Used to spot cross-border transactions.' })}
          {txt('currency_code_local', 'Local currency (ISO-4217)', { upper: true, max: 3 })}
          <Field label="TFR deadline (hours)">
            <Input type="number" min="1" disabled={disabled} className="h-8 text-xs" value={draft.tf_report_deadline_hours ?? ''} onChange={(e) => set({ tf_report_deadline_hours: e.target.value })} />
          </Field>
        </div>
      </section>

      <section className="space-y-3">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Reporting person (goAML)</h4>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {sub('reporting_person', 'title', 'Title')}
          {sub('reporting_person', 'first_name', 'First name')}
          {sub('reporting_person', 'last_name', 'Last name')}
          {sub('reporting_person', 'email', 'Email', 'email')}
          {sub('reporting_person', 'phone', 'Phone', 'tel')}
          {sub('reporting_person', 'occupation', 'Occupation')}
        </div>
        <p className="text-[11px] text-muted-foreground">Empty fields fall back to the compliance officer who prepares the report.</p>
      </section>

      <section className="space-y-3">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Reporting location</h4>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          {sub('location', 'address', 'Address')}
          {sub('location', 'zip', 'Postcode')}
          {sub('location', 'city', 'City')}
          {sub('location', 'country_code', 'Country (ISO-2)')}
        </div>
      </section>

      <section className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Report types and goAML codes</h4>
        <div className="rounded-lg border border-border divide-y divide-border">
          {FIU_TYPE_CODES.map((t) => (
            <div key={t} className="flex flex-wrap items-center gap-3 px-3 py-2">
              <Checkbox id={`fiu-type-${t}`} disabled={disabled} checked={enabled.has(t)} onCheckedChange={(v) => toggleType(t, !!v)} />
              <label htmlFor={`fiu-type-${t}`} className="flex-1 min-w-40 text-xs"><span className="font-mono font-semibold mr-1.5">{t}</span>{FIU_TYPES[t].label}</label>
              <Input disabled={disabled || !enabled.has(t)} aria-label={`goAML report code for ${t}`} placeholder={t} className="h-7 w-32 text-xs font-mono"
                value={draft.report_codes?.[t] || ''} onChange={(e) => set({ report_codes: { ...draft.report_codes, [t]: e.target.value } })} />
              <Input disabled={disabled || !enabled.has(t)} aria-label={`Didit template ID for ${t}`} placeholder="Didit template (optional)" className="h-7 w-48 text-xs font-mono"
                value={draft.didit_template_ids?.[t] || ''} onChange={(e) => set({ didit_template_ids: { ...draft.didit_template_ids, [t]: e.target.value } })} />
            </div>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">The goAML code is written as report_code in the XML. Leave it empty to use the type code. Each FIU defines its own codes; confirm them before go-live.</p>
      </section>

      <section className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Threshold reports ({reportingCurrency || 'reporting currency'})</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {THRESHOLDS.map(([k, label]) => (
            <Field key={k} label={label}>
              <Input type="number" min="0" step="0.01" disabled={disabled} className="h-8 text-xs" placeholder="Off"
                value={draft.thresholds?.[k] ?? ''} onChange={(e) => set({ thresholds: { ...draft.thresholds, [k]: e.target.value } })} />
            </Field>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Every day Vitauri proposes draft reports for transactions at or above these amounts. Empty or 0 turns a proposal off.
          Terrorist-financing reports (TFR) are proposed from confirmed sanctions hits and TF scenario alerts.
        </p>
      </section>
    </div>
  );
}

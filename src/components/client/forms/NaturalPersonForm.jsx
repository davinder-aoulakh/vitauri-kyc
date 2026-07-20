import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { COUNTRIES } from '@/lib/countries';
const ID_TYPES = ['Passport','National ID Card','Drivers Licence','Residence Permit','Other'];
const SOURCE_CHANNELS = ['Manual','Batch','API_CRM'];

function Field({ label, value, onChange, type = 'text', placeholder, required }) {
  return (
    <div>
      <Label className="text-xs font-medium mb-1.5 block">{label}{required && ' *'}</Label>
      <Input type={type} value={value || ''} onChange={e => onChange(e.target.value)} placeholder={placeholder} className="h-9 text-sm" />
    </div>
  );
}

function SelectField({ label, value, onChange, options, required }) {
  return (
    <div>
      <Label className="text-xs font-medium mb-1.5 block">{label}{required && ' *'}</Label>
      <Select value={value || ''} onValueChange={onChange}>
        <SelectTrigger className="h-9 text-sm">
          <SelectValue placeholder={`Select ${label}`} />
        </SelectTrigger>
        <SelectContent>
          {options.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

// Step A: Core identity fields
export function NaturalPersonStep2A({ form, set }) {
  return (
    <div className="space-y-4">
      <Field label="Full Legal Name" value={form.full_name} onChange={v => set('full_name', v)} placeholder="First Middle Last" required />
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label className="text-xs font-medium mb-1.5 block">Date of Birth</Label>
          <Input type="date" value={form.date_of_birth || ''} onChange={e => set('date_of_birth', e.target.value)} className="h-9 text-sm" />
        </div>
        <SelectField label="Nationality" value={form.nationality} onChange={v => set('nationality', v)} options={COUNTRIES} />
      </div>
      <SelectField label="Country of Residence" value={form.country_of_residence} onChange={v => set('country_of_residence', v)} options={COUNTRIES} />
      <SelectField label="Source Channel" value={form.source_channel} onChange={v => set('source_channel', v)} options={SOURCE_CHANNELS} />
    </div>
  );
}

// Step B: ID document + contact
export function NaturalPersonStep2B({ form, set }) {
  return (
    <div className="space-y-4">
      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Identity Document</div>
      <div className="grid grid-cols-2 gap-4">
        <SelectField label="ID Type" value={form.id_type} onChange={v => set('id_type', v)} options={ID_TYPES} />
        <Field label="ID Number" value={form.id_number} onChange={v => set('id_number', v)} placeholder="e.g. AB1234567" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label className="text-xs font-medium mb-1.5 block">ID Expiry Date</Label>
          <Input type="date" value={form.id_expiry_date || ''} onChange={e => set('id_expiry_date', e.target.value)} className="h-9 text-sm" />
        </div>
      </div>
      <div className="border-t border-border pt-4">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Contact Information</div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Contact Email" value={form.primary_contact_email} onChange={v => set('primary_contact_email', v)} type="email" />
          <Field label="Contact Phone" value={form.primary_contact_phone} onChange={v => set('primary_contact_phone', v)} />
        </div>
      </div>
      <div className="border-t border-border pt-4">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Tax Compliance (FATCA/CRS)</div>
        <div className="grid grid-cols-2 gap-4">
          <SelectField label="Tax Residency" value={form.tax_residency} onChange={v => set('tax_residency', v)} options={COUNTRIES} />
          <Field label="TIN" value={form.tin} onChange={v => set('tin', v)} placeholder="Tax Identification Number" />
        </div>
        <div className="mt-2 text-xs text-muted-foreground bg-muted/40 rounded-lg p-2.5">
          ℹ FATCA/CRS classification details will be confirmed during the KYC case workflow.
        </div>
      </div>
    </div>
  );
}
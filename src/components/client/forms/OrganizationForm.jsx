import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const SECTORS = [
  'Financial Services','Real Estate','Legal Services','Consulting','Technology',
  'Manufacturing','Trading','Healthcare','Energy','Retail','Construction',
  'Transport & Logistics','Media & Entertainment','Non-Profit','Government','Other'
];
const LEGAL_FORMS = ['BV','NV','Ltd','SA','GmbH','LLC','Inc','PLC','SRL','AG','SARL','Other'];
const COUNTRIES = [
  'Netherlands (NL)','Belgium (BE)','Germany (DE)','France (FR)',
  'United Kingdom (GB)','United States (US)','Luxembourg (LU)',
  'Switzerland (CH)','Curaçao (CW)','Aruba (AW)','Suriname (SR)','Other'
];
const SOURCE_CHANNELS = ['Manual','Batch','API_CRM'];
const ENTITY_CLASSIFICATIONS = ['Active NFFE','Passive NFFE','Financial Institution','Excepted NFFE','Other'];

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

// Step A: Core corporate identity
export function OrganizationStep2A({ form, set }) {
  return (
    <div className="space-y-4">
      <Field label="Legal Name" value={form.full_name} onChange={v => set('full_name', v)} placeholder="Company Legal Name" required />
      <div className="grid grid-cols-2 gap-4">
        <SelectField label="Legal Form" value={form.legal_form} onChange={v => set('legal_form', v)} options={LEGAL_FORMS} required />
        <Field label="Registration No. / KvK" value={form.registration_number} onChange={v => set('registration_number', v)} required />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <SelectField label="Registered Country" value={form.registered_country} onChange={v => set('registered_country', v)} options={COUNTRIES} required />
        <Field label="LEI Code" value={form.lei_code} onChange={v => set('lei_code', v)} placeholder="Optional" />
      </div>
      <SelectField label="Sector / Industry" value={form.sector} onChange={v => set('sector', v)} options={SECTORS} required />
      <Field label="Registered Address" value={form.registered_address} onChange={v => set('registered_address', v)} placeholder="Street, City, Postcode, Country" required />
      <SelectField label="Source Channel" value={form.source_channel} onChange={v => set('source_channel', v)} options={SOURCE_CHANNELS} />
    </div>
  );
}

// Step B: Contact + FATCA/CRS
export function OrganizationStep2B({ form, set }) {
  return (
    <div className="space-y-4">
      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Primary Contact</div>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Contact Name" value={form.primary_contact_name} onChange={v => set('primary_contact_name', v)} required />
        <Field label="Contact Email" value={form.primary_contact_email} onChange={v => set('primary_contact_email', v)} type="email" required />
      </div>
      <Field label="Contact Phone" value={form.primary_contact_phone} onChange={v => set('primary_contact_phone', v)} />

      <div className="border-t border-border pt-4">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Tax Compliance (FATCA/CRS)</div>
        <div className="grid grid-cols-2 gap-4">
          <SelectField label="Tax Residency" value={form.tax_residency} onChange={v => set('tax_residency', v)} options={COUNTRIES} />
          <Field label="TIN" value={form.tin} onChange={v => set('tin', v)} placeholder="Tax Identification Number" />
        </div>
        <div className="mt-3">
          <SelectField label="Entity Classification" value={form.entity_classification} onChange={v => set('entity_classification', v)} options={ENTITY_CLASSIFICATIONS} />
        </div>
        <div className="mt-2 text-xs text-muted-foreground bg-muted/40 rounded-lg p-2.5">
          ℹ FATCA/CRS reporting status will be finalised during the KYC case workflow. Refer to Gino/Glenn for further classification guidance.
        </div>
      </div>
    </div>
  );
}
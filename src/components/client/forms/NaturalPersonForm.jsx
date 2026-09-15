import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { COUNTRIES } from '@/lib/countries';
import AddressFields from '@/components/client/forms/AddressFields';
import ContactEntriesTable from '@/components/client/forms/ContactEntriesTable';

const ID_TYPES = ['Passport','National ID Card','Drivers Licence','Residence Permit','Other'];
const SOURCE_CHANNELS = ['Manual','Batch','API_CRM'];
const GENDERS = ['Unknown','Male','Female','Other'];
const CATEGORIES = ['Klant','Prospect','Lead','Supplier','Other'];
const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'nl', label: 'Dutch' },
  { value: 'de', label: 'German' },
  { value: 'fr', label: 'French' },
  { value: 'es', label: 'Spanish' },
  { value: 'other', label: 'Other' },
];

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

// Step A: General Information
export function NaturalPersonStep2A({ form, set }) {
  return (
    <div className="space-y-4">
      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">General Information</div>
      <div className="grid grid-cols-2 gap-4">
        <Field label="First Names" value={form.first_names} onChange={v => set('first_names', v)} placeholder="e.g. Jan Willem" required />
        <Field label="Last Name" value={form.last_name} onChange={v => set('last_name', v)} placeholder="e.g. van der Berg" required />
        <Field label="Initials" value={form.initials} onChange={v => set('initials', v)} placeholder="e.g. J.W." />
        <Field label="Preferred Name" value={form.preferred_name} onChange={v => set('preferred_name', v)} placeholder="Optional" />
        <SelectField label="Gender" value={form.gender} onChange={v => set('gender', v)} options={GENDERS} />
        <SelectField label="Category" value={form.category} onChange={v => set('category', v)} options={CATEGORIES} />
        <SelectField label="Nationality" value={form.nationality} onChange={v => set('nationality', v)} options={COUNTRIES} />
        <Field label="External ID" value={form.external_id} onChange={v => set('external_id', v)} placeholder="Optional — CRM reference" />
        <div>
          <Label className="text-xs font-medium mb-1.5 block">Date of Birth</Label>
          <Input type="date" value={form.date_of_birth || ''} onChange={e => set('date_of_birth', e.target.value)} className="h-9 text-sm" />
        </div>
        <div>
          <Label className="text-xs font-medium mb-1.5 block">Decease Date</Label>
          <Input type="date" value={form.decease_date || ''} onChange={e => set('decease_date', e.target.value)} className="h-9 text-sm" />
        </div>
        <SelectField label="Country of Birth" value={form.country_of_birth} onChange={v => set('country_of_birth', v)} options={COUNTRIES} />
        <Field label="Place of Birth" value={form.place_of_birth} onChange={v => set('place_of_birth', v)} placeholder="City of birth" />
      </div>
      <SelectField label="Country of Residence" value={form.country_of_residence} onChange={v => set('country_of_residence', v)} options={COUNTRIES} />
      <SelectField label="Source Channel" value={form.source_channel} onChange={v => set('source_channel', v)} options={SOURCE_CHANNELS} />
    </div>
  );
}

// Step B: Communication, Addresses, ID document + Tax
export function NaturalPersonStep2B({ form, set }) {
  return (
    <div className="space-y-5">
      <div>
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Communication</div>
        <div className="grid grid-cols-2 gap-4 mb-3">
          <div>
            <Label className="text-xs font-medium mb-1.5 block">Language</Label>
            <Select value={form.language || 'en'} onValueChange={v => set('language', v)}>
              <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>{LANGUAGES.map(l => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <ContactEntriesTable entries={form.contact_entries} onChange={v => set('contact_entries', v)} />
      </div>

      <AddressFields title="Residential Address" value={form.residential_address} onChange={v => set('residential_address', v)} />
      <AddressFields title="Postal Address" value={form.postal_address} onChange={v => set('postal_address', v)} optionalNote="Optional — if different" />

      <div className="border-t border-border pt-4">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Identity Document</div>
        <div className="grid grid-cols-2 gap-4">
          <SelectField label="ID Type" value={form.id_type} onChange={v => set('id_type', v)} options={ID_TYPES} />
          <Field label="ID Number" value={form.id_number} onChange={v => set('id_number', v)} placeholder="e.g. AB1234567" />
        </div>
        <div className="grid grid-cols-2 gap-4 mt-4">
          <div>
            <Label className="text-xs font-medium mb-1.5 block">ID Expiry Date</Label>
            <Input type="date" value={form.id_expiry_date || ''} onChange={e => set('id_expiry_date', e.target.value)} className="h-9 text-sm" />
          </div>
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
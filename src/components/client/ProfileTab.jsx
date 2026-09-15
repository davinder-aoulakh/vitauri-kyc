import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/lib/tenantContext';
import { hasPermission } from '@/lib/permissions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertTriangle, Save, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import OcrResultPanel from '@/components/client/OcrResultPanel';
import AddressFields from '@/components/client/forms/AddressFields';
import ContactEntriesTable from '@/components/client/forms/ContactEntriesTable';
import { computeFullName, splitFullName, syncPreferredContacts } from '@/lib/clientNameUtils';

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

const COUNTRIES = [
  'Netherlands (NL)','Belgium (BE)','Germany (DE)','France (FR)',
  'United Kingdom (GB)','United States (US)','Luxembourg (LU)',
  'Switzerland (CH)','Austria (AT)','Spain (ES)','Italy (IT)',
  'Portugal (PT)','Sweden (SE)','Norway (NO)','Denmark (DK)',
  'Finland (FI)','Ireland (IE)','Poland (PL)','Czech Republic (CZ)',
  'Hungary (HU)','Romania (RO)','Bulgaria (BG)','Croatia (HR)',
  'Greece (GR)','Cyprus (CY)','Malta (MT)','Slovakia (SK)',
  'Slovenia (SI)','Estonia (EE)','Latvia (LV)','Lithuania (LT)',
  'Singapore (SG)','Hong Kong (HK)','Japan (JP)','South Korea (KR)',
  'China (CN)','India (IN)','Thailand (TH)','Malaysia (MY)',
  'Indonesia (ID)','Philippines (PH)','Vietnam (VN)','Taiwan (TW)',
  'United Arab Emirates (AE)','Saudi Arabia (SA)','Qatar (QA)',
  'Kuwait (KW)','Bahrain (BH)','Oman (OM)','Israel (IL)',
  'Turkey (TR)','South Africa (ZA)','Nigeria (NG)','Kenya (KE)',
  'Egypt (EG)','Morocco (MA)','Ghana (GH)',
  'Australia (AU)','New Zealand (NZ)',
  'Canada (CA)','Mexico (MX)','Brazil (BR)','Argentina (AR)',
  'Chile (CL)','Colombia (CO)','Peru (PE)','Venezuela (VE)',
  'Curaçao (CW)','Aruba (AW)','Suriname (SR)',
  'Russia (RU)','Ukraine (UA)',
  'Other',
];
const SECTORS   = ['Financial Services','Real Estate','Legal Services','Consulting','Technology','Manufacturing','Trading','Healthcare','Energy','Retail','Construction','Other'];
const LEGAL_FORMS = ['BV','NV','Ltd','SA','GmbH','LLC','Inc','PLC','SRL','AG','SARL','Other'];
const ID_TYPES    = ['Passport','National ID Card','Driving Licence','Residence Permit','Other'];

function F({ label, value, onChange, type = 'text', placeholder, readOnly, disabled }) {
  return (
    <div>
      <Label className="text-xs font-medium mb-1 block text-muted-foreground">{label}</Label>
      <Input
        type={type}
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled || readOnly}
        className="h-8 text-sm"
      />
    </div>
  );
}

function SF({ label, value, onChange, options, disabled }) {
  return (
    <div>
      <Label className="text-xs font-medium mb-1 block text-muted-foreground">{label}</Label>
      <Select value={value || ''} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="—" /></SelectTrigger>
        <SelectContent>{options.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  );
}

export default function ProfileTab({ client, onClientUpdated, pendingOcr, onOcrApplied }) {
  const { currentUser } = useTenant();
  // Backfill first_names/last_name from full_name on first load for existing NP clients
  const initialForm = { ...client };
  if (client.client_type === 'NP' && !initialForm.first_names && !initialForm.last_name && initialForm.full_name) {
    Object.assign(initialForm, splitFullName(initialForm.full_name));
  }
  const [form, setForm] = useState(initialForm);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // When parent pushes new OCR data, pre-fill form but don't auto-save
  useEffect(() => {
    if (pendingOcr && Object.keys(pendingOcr).length > 0) {
      setForm(f => ({ ...f, ...pendingOcr }));
      setSaved(false);
    }
  }, [pendingOcr]);
  const isOrg = client.client_type === 'ORG';
  const canEdit = hasPermission(currentUser?.app_role, 'createEditClient');

  const set = (field, val) => { setForm(f => ({ ...f, [field]: val })); setSaved(false); };

  const fProps = (field, extra = {}) => ({
    value: form[field] || '',
    onChange: v => set(field, v),
    disabled: !canEdit,
    ...extra,
  });

  async function handleSave() {
    setSaving(true);
    const { id, created_date, updated_date, created_by, tenant_id, ...rest } = form;
    if (!isOrg) {
      rest.full_name = computeFullName(rest.first_names, rest.last_name);
      Object.assign(rest, syncPreferredContacts(rest.contact_entries));
    }
    await base44.entities.Client.update(client.id, rest);
    await base44.entities.AuditEvent.create({
      tenant_id: client.tenant_id,
      client_id: client.id,
      actor_user_id: currentUser.id,
      actor_name: currentUser.full_name,
      actor_type: 'User',
      event_type: 'client_profile_updated',
      before_state: client,
      after_state: rest,
      notes: 'Profile updated via Client Detail screen',
    });
    setSaving(false);
    setSaved(true);
    onClientUpdated?.({ ...client, ...rest });
  }

  function handleOcrApply(fields) {
    setForm(f => ({ ...f, ...fields }));
    setSaved(false);
    onOcrApplied?.();
  }

  return (
    <div className="bg-card border border-border rounded-xl p-5 space-y-6">
      {/* OCR prefill banner */}
      {pendingOcr && Object.keys(pendingOcr).length > 0 && (
        <OcrResultPanel
          ocrResult={{ extracted: pendingOcr, confidence: null, warnings: [] }}
          onApply={handleOcrApply}
          onDismiss={() => onOcrApplied?.()}
        />
      )}
      {/* Core Details */}
      <div>
        <h3 className="text-sm font-semibold mb-3">{isOrg ? 'Organisation Details' : 'Personal Details'}</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {isOrg ? (
            <>
              <F label="Legal Name" {...fProps('full_name')} />
              <SF label="Legal Form" {...fProps('legal_form')} options={LEGAL_FORMS} />
              <F label="Registration No. / KvK" {...fProps('registration_number')} />
              <F label="LEI Code" {...fProps('lei_code')} placeholder="Optional" />
              <SF label="Registered Country" {...fProps('registered_country')} options={COUNTRIES} />
              <SF label="Sector / Industry" {...fProps('sector')} options={SECTORS} />
              <div className="md:col-span-2"><F label="Registered Address" {...fProps('registered_address')} /></div>
              <F label="Contact Name" {...fProps('primary_contact_name')} />
              <F label="Contact Email" {...fProps('primary_contact_email')} type="email" />
              <F label="Contact Phone" {...fProps('primary_contact_phone')} />
            </>
          ) : (
            <>
              <F label="First Names" {...fProps('first_names')} />
              <F label="Last Name" {...fProps('last_name')} />
              <F label="Initials" {...fProps('initials')} />
              <F label="Preferred Name" {...fProps('preferred_name')} />
              <SF label="Gender" {...fProps('gender')} options={GENDERS} />
              <SF label="Category" {...fProps('category')} options={CATEGORIES} />
              <F label="External ID" {...fProps('external_id')} />
              <div>
                <Label className="text-xs font-medium mb-1 block text-muted-foreground">Date of Birth</Label>
                <Input type="date" value={form.date_of_birth || ''} onChange={e => set('date_of_birth', e.target.value)} disabled={!canEdit} className="h-8 text-sm" />
              </div>
              <div>
                <Label className="text-xs font-medium mb-1 block text-muted-foreground">Decease Date</Label>
                <Input type="date" value={form.decease_date || ''} onChange={e => set('decease_date', e.target.value)} disabled={!canEdit} className="h-8 text-sm" />
              </div>
              <SF label="Country of Birth" {...fProps('country_of_birth')} options={COUNTRIES} />
              <F label="Place of Birth" {...fProps('place_of_birth')} />
              <SF label="Nationality" {...fProps('nationality')} options={COUNTRIES} />
              <SF label="Country of Residence" {...fProps('country_of_residence')} options={COUNTRIES} />
              <SF label="ID Type" {...fProps('id_type')} options={ID_TYPES} />
              <F label="ID Number" {...fProps('id_number')} />
            </>
          )}
        </div>
      </div>

      {!isOrg && (
        <div>
          <h3 className="text-sm font-semibold mb-3">Communication</h3>
          <div className="mb-3 max-w-xs">
            <Label className="text-xs font-medium mb-1 block text-muted-foreground">Language</Label>
            <Select value={form.language || 'en'} onValueChange={v => set('language', v)} disabled={!canEdit}>
              <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>{LANGUAGES.map(l => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <ContactEntriesTable entries={form.contact_entries} onChange={v => set('contact_entries', v)} />
        </div>
      )}

      {!isOrg && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <AddressFields title="Residential Address" value={form.residential_address} onChange={v => set('residential_address', v)} />
          <AddressFields title="Postal Address" value={form.postal_address} onChange={v => set('postal_address', v)} optionalNote="Optional — if different" />
        </div>
      )}

      {/* FATCA / CRS */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle className="w-4 h-4 text-amber-600" />
          <span className="text-xs font-semibold text-amber-800">FATCA / CRS Section</span>
          <span className="text-xs text-amber-600 italic ml-1">— Pending Gino/Glenn schema confirmation</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <F label="Tax Residency" {...fProps('tax_residency')} />
          <F label="TIN(s)" {...fProps('tin')} placeholder="e.g. NL123456789" />
          <div>
            <Label className="text-xs font-medium mb-1 block text-amber-700">Entity Classification</Label>
            <Select value={form.entity_classification || ''} onValueChange={v => set('entity_classification', v)} disabled={!canEdit}>
              <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                {['FFI','NFFE','Active NFFE','Passive NFFE'].map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <F label="FATCA Reporting Status" {...fProps('fatca_reporting_status')} placeholder="e.g. Reporting FI" />
        </div>
      </div>

      {canEdit && (
        <div className="flex items-center gap-3">
          <Button onClick={handleSave} disabled={saving} className="gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Changes
          </Button>
          {saved && <span className="text-xs text-emerald-600 font-medium">✓ Saved successfully</span>}
        </div>
      )}
    </div>
  );
}
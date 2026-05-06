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

const COUNTRIES = ['Netherlands (NL)','Belgium (BE)','Germany (DE)','France (FR)','United Kingdom (GB)','United States (US)','Luxembourg (LU)','Switzerland (CH)','Curaçao (CW)','Aruba (AW)','Suriname (SR)','Other'];
const SECTORS   = ['Financial Services','Real Estate','Legal Services','Consulting','Technology','Manufacturing','Trading','Healthcare','Energy','Retail','Construction','Other'];
const LEGAL_FORMS = ['BV','NV','Ltd','SA','GmbH','LLC','Inc','PLC','SRL','AG','SARL','Other'];
const ID_TYPES    = ['Passport','National ID Card','Driving Licence','Residence Permit','Other'];

export default function ProfileTab({ client, onClientUpdated, pendingOcr, onOcrApplied }) {
  const { currentUser } = useTenant();
  const [form, setForm] = useState({ ...client });
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

  async function handleSave() {
    setSaving(true);
    const { id, created_date, updated_date, created_by, tenant_id, ...rest } = form;
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

  function F({ label, field, type = 'text', placeholder, readOnly }) {
    return (
      <div>
        <Label className="text-xs font-medium mb-1 block text-muted-foreground">{label}</Label>
        <Input
          type={type}
          value={form[field] || ''}
          onChange={e => set(field, e.target.value)}
          placeholder={placeholder}
          disabled={!canEdit || readOnly}
          className="h-8 text-sm"
        />
      </div>
    );
  }

  function SF({ label, field, options }) {
    return (
      <div>
        <Label className="text-xs font-medium mb-1 block text-muted-foreground">{label}</Label>
        <Select value={form[field] || ''} onValueChange={v => set(field, v)} disabled={!canEdit}>
          <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="—" /></SelectTrigger>
          <SelectContent>{options.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
        </Select>
      </div>
    );
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
              <F label="Legal Name" field="full_name" />
              <SF label="Legal Form" field="legal_form" options={LEGAL_FORMS} />
              <F label="Registration No. / KvK" field="registration_number" />
              <F label="LEI Code" field="lei_code" placeholder="Optional" />
              <SF label="Registered Country" field="registered_country" options={COUNTRIES} />
              <SF label="Sector / Industry" field="sector" options={SECTORS} />
              <div className="md:col-span-2"><F label="Registered Address" field="registered_address" /></div>
              <F label="Contact Name" field="primary_contact_name" />
              <F label="Contact Email" field="primary_contact_email" type="email" />
              <F label="Contact Phone" field="primary_contact_phone" />
            </>
          ) : (
            <>
              <F label="Full Name" field="full_name" />
              <div>
                <Label className="text-xs font-medium mb-1 block text-muted-foreground">Date of Birth</Label>
                <Input type="date" value={form.date_of_birth || ''} onChange={e => set('date_of_birth', e.target.value)} disabled={!canEdit} className="h-8 text-sm" />
              </div>
              <SF label="Nationality" field="nationality" options={COUNTRIES} />
              <SF label="Country of Residence" field="country_of_residence" options={COUNTRIES} />
              <SF label="ID Type" field="id_type" options={ID_TYPES} />
              <F label="ID Number" field="id_number" />
              <F label="Contact Email" field="primary_contact_email" type="email" />
              <F label="Contact Phone" field="primary_contact_phone" />
            </>
          )}
        </div>
      </div>

      {/* FATCA / CRS */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle className="w-4 h-4 text-amber-600" />
          <span className="text-xs font-semibold text-amber-800">FATCA / CRS Section</span>
          <span className="text-xs text-amber-600 italic ml-1">— Pending Gino/Glenn schema confirmation</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <F label="Tax Residency" field="tax_residency" />
          <F label="TIN(s)" field="tin" placeholder="e.g. NL123456789" />
          <div>
            <Label className="text-xs font-medium mb-1 block text-amber-700">Entity Classification</Label>
            <Select value={form.entity_classification || ''} onValueChange={v => set('entity_classification', v)} disabled={!canEdit}>
              <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                {['FFI','NFFE','Active NFFE','Passive NFFE'].map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <F label="FATCA Reporting Status" field="fatca_reporting_status" placeholder="e.g. Reporting FI" />
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
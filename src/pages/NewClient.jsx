import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/lib/tenantContext';
import AppShell from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Building2, User, ChevronRight, ChevronLeft, CheckCircle, AlertTriangle, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';
import { addDays, format } from 'date-fns';
import { findDuplicates, DEDUP_THRESHOLD } from '@/lib/dedup';

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

export default function NewClient() {
  const { currentUser, tenant } = useTenant();
  const navigate = useNavigate();

  const [step, setStep]           = useState(1);
  const [clientType, setClientType] = useState(null);
  const [saving, setSaving]       = useState(false);
  const [allClients, setAllClients] = useState([]);
  const [dupWarning, setDupWarning] = useState(null); // { duplicates: [] } | null
  const tenantColor = tenant?.branding_primary_color || '#1A6BFF';

  const [form, setForm] = useState({
    full_name: '', date_of_birth: '', nationality: '', country_of_residence: '',
    primary_contact_email: '', primary_contact_phone: '', primary_contact_name: '',
    registration_number: '', lei_code: '', registered_country: '',
    registered_address: '', sector: '', legal_form: '',
    source_channel: 'Manual',
  });

  const set = (field, value) => setForm(f => ({ ...f, [field]: value }));

  useEffect(() => {
    if (currentUser?.tenant_id) {
      base44.entities.Client.filter({ tenant_id: currentUser.tenant_id }).then(d => setAllClients(d || []));
    }
  }, [currentUser]);

  function runDedup() {
    const country = form.registered_country || form.nationality || form.country_of_residence;
    const hits = findDuplicates(form.full_name, country, allClients);
    return hits;
  }

  function handleStepTwoNext() {
    const dups = runDedup();
    if (dups.length > 0) {
      setDupWarning({ duplicates: dups });
      return;
    }
    setStep(3);
  }

  async function handleCreate() {
    // Final dedup gate
    const dups = runDedup();
    if (dups.length > 0) {
      setDupWarning({ duplicates: dups });
      return;
    }

    setSaving(true);
    const client = await base44.entities.Client.create({
      ...form,
      tenant_id: currentUser.tenant_id,
      client_type: clientType,
      status: 'Prospect',
    });

    await base44.entities.AuditEvent.create({
      tenant_id: currentUser.tenant_id,
      client_id: client.id,
      actor_user_id: currentUser.id,
      actor_name: currentUser.full_name,
      actor_type: 'User',
      event_type: 'client_created',
      after_state: { ...form, client_type: clientType },
    });

    const dueDate = addDays(new Date(), 30);
    const kycCase = await base44.entities.KycCase.create({
      tenant_id: currentUser.tenant_id,
      client_id: client.id,
      case_type: 'Onboarding',
      status: 'Draft',
      assigned_analyst_id: currentUser.id,
      due_date: format(dueDate, 'yyyy-MM-dd'),
      created_by_user_id: currentUser.id,
    });

    navigate(`/case/${kycCase.id}`);
  }

  const StepIndicator = ({ n, label, active, done }) => (
    <div className={cn('flex items-center gap-2', !active && !done && 'opacity-40')}>
      <div className={cn(
        'w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold border-2',
        done ? 'bg-emerald-500 border-emerald-500 text-white'
          : active ? 'border-primary text-primary bg-primary/10'
          : 'border-border text-muted-foreground'
      )}>
        {done ? <CheckCircle className="w-3.5 h-3.5" /> : n}
      </div>
      <span className={cn('text-sm hidden sm:block', active ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
        {label}
      </span>
    </div>
  );

  return (
    <AppShell>
      <div className="p-6 max-w-2xl mx-auto">
        {/* Step indicators */}
        <div className="flex items-center gap-3 mb-8">
          <StepIndicator n={1} label="Client Type"   active={step===1} done={step>1} />
          <div className="flex-1 h-px bg-border" />
          <StepIndicator n={2} label="Details"       active={step===2} done={step>2} />
          <div className="flex-1 h-px bg-border" />
          <StepIndicator n={3} label="Review & Create" active={step===3} done={false} />
        </div>

        <div className="bg-card border border-border rounded-xl p-6">

          {/* ── Step 1: Client Type ── */}
          {step === 1 && (
            <div>
              <h2 className="text-lg font-semibold mb-1">Select Client Type</h2>
              <p className="text-sm text-muted-foreground mb-6">Choose the type of client you are onboarding</p>
              <div className="grid grid-cols-2 gap-4">
                {[
                  { type: 'NP',  icon: User,      label: 'Natural Person', sub: 'Individual client — passport, ID' },
                  { type: 'ORG', icon: Building2,  label: 'Organisation',   sub: 'Corporate entity — BV, NV, Ltd, etc.' },
                ].map(({ type, icon: Icon, label, sub }) => (
                  <button
                    key={type}
                    onClick={() => { setClientType(type); setStep(2); }}
                    className={cn(
                      'border-2 rounded-xl p-6 text-left transition-all hover:shadow-md',
                      clientType === type ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'
                    )}
                  >
                    <Icon className="w-8 h-8 mb-3 text-primary" />
                    <div className="font-semibold text-foreground">{label}</div>
                    <div className="text-xs text-muted-foreground mt-1">{sub}</div>
                  </button>
                ))}
              </div>
              <div className="mt-6 pt-5 border-t border-border">
                <button
                  className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => navigate('/batch-upload')}
                >
                  <Upload className="w-4 h-4" />
                  Batch upload multiple clients via CSV
                </button>
              </div>
            </div>
          )}

          {/* ── Step 2: Details ── */}
          {step === 2 && (
            <div>
              <h2 className="text-lg font-semibold mb-1">
                {clientType === 'NP' ? 'Natural Person Details' : 'Organisation Details'}
              </h2>
              <p className="text-sm text-muted-foreground mb-6">All fields marked * are required</p>

              {/* Dup warning from step transition */}
              {dupWarning && (
                <DupWarningBlock
                  duplicates={dupWarning.duplicates}
                  onDismiss={() => { setDupWarning(null); setStep(3); }}
                  onViewClient={id => navigate(`/client/${id}`)}
                />
              )}

              <div className="space-y-4">
                {clientType === 'NP' ? (
                  <>
                    <Field label="Full Name *" value={form.full_name} onChange={v => set('full_name', v)} placeholder="First Middle Last" />
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label className="text-xs font-medium mb-1.5 block">Date of Birth</Label>
                        <Input type="date" value={form.date_of_birth} onChange={e => set('date_of_birth', e.target.value)} className="h-9 text-sm" />
                      </div>
                      <SelectField label="Nationality" value={form.nationality} onChange={v => set('nationality', v)} options={COUNTRIES} />
                    </div>
                    <SelectField label="Country of Residence" value={form.country_of_residence} onChange={v => set('country_of_residence', v)} options={COUNTRIES} />
                    <div className="grid grid-cols-2 gap-4">
                      <Field label="Contact Email" value={form.primary_contact_email} onChange={v => set('primary_contact_email', v)} type="email" />
                      <Field label="Contact Phone" value={form.primary_contact_phone} onChange={v => set('primary_contact_phone', v)} />
                    </div>
                    <SelectField label="Source Channel" value={form.source_channel} onChange={v => set('source_channel', v)} options={SOURCE_CHANNELS} />
                  </>
                ) : (
                  <>
                    <Field label="Legal Name *" value={form.full_name} onChange={v => set('full_name', v)} placeholder="Company Legal Name" />
                    <div className="grid grid-cols-2 gap-4">
                      <SelectField label="Legal Form *" value={form.legal_form} onChange={v => set('legal_form', v)} options={LEGAL_FORMS} />
                      <Field label="Registration No. / KvK *" value={form.registration_number} onChange={v => set('registration_number', v)} />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <SelectField label="Registered Country *" value={form.registered_country} onChange={v => set('registered_country', v)} options={COUNTRIES} />
                      <Field label="LEI Code" value={form.lei_code} onChange={v => set('lei_code', v)} placeholder="Optional" />
                    </div>
                    <SelectField label="Sector / Industry *" value={form.sector} onChange={v => set('sector', v)} options={SECTORS} />
                    <Field label="Registered Address *" value={form.registered_address} onChange={v => set('registered_address', v)} placeholder="Street, City, Postcode, Country" />
                    <div className="grid grid-cols-2 gap-4">
                      <Field label="Contact Name *" value={form.primary_contact_name} onChange={v => set('primary_contact_name', v)} />
                      <Field label="Contact Email *" value={form.primary_contact_email} onChange={v => set('primary_contact_email', v)} type="email" />
                    </div>
                    <Field label="Contact Phone" value={form.primary_contact_phone} onChange={v => set('primary_contact_phone', v)} />
                    <SelectField label="Source Channel" value={form.source_channel} onChange={v => set('source_channel', v)} options={SOURCE_CHANNELS} />
                  </>
                )}
              </div>

              <div className="flex gap-3 mt-6">
                <Button variant="outline" onClick={() => setStep(1)}>
                  <ChevronLeft className="w-4 h-4 mr-1" /> Back
                </Button>
                <Button
                  onClick={handleStepTwoNext}
                  disabled={!form.full_name}
                  style={{ backgroundColor: tenantColor }}
                  className="flex-1 text-white"
                >
                  Continue to Review <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </div>
          )}

          {/* ── Step 3: Review ── */}
          {step === 3 && (
            <div>
              <h2 className="text-lg font-semibold mb-1">Review & Create</h2>
              <p className="text-sm text-muted-foreground mb-5">Confirm the details before creating the client and opening a KYC case</p>

              {dupWarning && (
                <DupWarningBlock
                  duplicates={dupWarning.duplicates}
                  onDismiss={() => setDupWarning(null)}
                  onViewClient={id => navigate(`/client/${id}`)}
                />
              )}

              <div className="bg-muted/40 rounded-lg p-4 space-y-2 text-sm mb-5 border border-border">
                <ReviewRow label="Client Type" value={clientType} />
                <ReviewRow label="Name" value={form.full_name} />
                {clientType === 'ORG' && <>
                  <ReviewRow label="Legal Form" value={form.legal_form} />
                  <ReviewRow label="Registration No." value={form.registration_number} />
                  <ReviewRow label="Registered Country" value={form.registered_country} />
                  <ReviewRow label="Sector" value={form.sector} />
                  <ReviewRow label="Address" value={form.registered_address} />
                </>}
                {clientType === 'NP' && <>
                  <ReviewRow label="Date of Birth" value={form.date_of_birth} />
                  <ReviewRow label="Nationality" value={form.nationality} />
                  <ReviewRow label="Country of Residence" value={form.country_of_residence} />
                </>}
                <ReviewRow label="Contact Email" value={form.primary_contact_email} />
                {form.primary_contact_name && <ReviewRow label="Contact Name" value={form.primary_contact_name} />}
                <ReviewRow label="Source Channel" value={form.source_channel} />
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-700 mb-5">
                A new <strong>Onboarding</strong> KYC case will be created and assigned to you with a 30-day due date.
              </div>

              <div className="flex gap-3">
                <Button variant="outline" onClick={() => setStep(2)}>
                  <ChevronLeft className="w-4 h-4 mr-1" /> Back
                </Button>
                <Button
                  onClick={handleCreate}
                  disabled={saving || !!dupWarning}
                  style={{ backgroundColor: tenantColor }}
                  className="flex-1 text-white"
                >
                  {saving ? 'Creating…' : 'Create Client & Open KYC Case'}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function DupWarningBlock({ duplicates, onDismiss, onViewClient }) {
  return (
    <div className="bg-red-50 border border-red-300 rounded-lg p-4 mb-4">
      <div className="flex gap-2 items-start mb-3">
        <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
        <div>
          <div className="text-sm font-semibold text-red-800">Duplicate client detected</div>
          <div className="text-xs text-red-600 mt-0.5">
            The following existing clients match at ≥{DEDUP_THRESHOLD}% similarity. Review before proceeding.
          </div>
        </div>
      </div>
      <div className="space-y-2 mb-3">
        {duplicates.map(({ client, score }) => (
          <div key={client.id} className="flex items-center justify-between bg-white border border-red-200 rounded px-3 py-2">
            <div>
              <span className="text-sm font-medium">{client.full_name}</span>
              <span className="ml-2 text-xs text-red-600 font-mono">{score}% match</span>
              <div className="text-xs text-muted-foreground">{client.status} · {client.registered_country || client.nationality || '—'}</div>
            </div>
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => onViewClient(client.id)}>
              View
            </Button>
          </div>
        ))}
      </div>
      <Button variant="destructive" size="sm" className="text-xs" onClick={onDismiss}>
        Confirm this is NOT a duplicate — proceed anyway
      </Button>
    </div>
  );
}

function ReviewRow({ label, value }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-right max-w-[60%]">{value || '—'}</span>
    </div>
  );
}

function Field({ label, value, onChange, type = 'text', placeholder }) {
  return (
    <div>
      <Label className="text-xs font-medium mb-1.5 block">{label}</Label>
      <Input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className="h-9 text-sm" />
    </div>
  );
}

function SelectField({ label, value, onChange, options }) {
  return (
    <div>
      <Label className="text-xs font-medium mb-1.5 block">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-9 text-sm">
          <SelectValue placeholder={`Select ${label.replace(' *','')}`} />
        </SelectTrigger>
        <SelectContent>
          {options.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}
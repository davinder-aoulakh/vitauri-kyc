import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/lib/tenantContext';
import AppShell from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Building2, User, ChevronRight, ChevronLeft, CheckCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { addDays, format } from 'date-fns';

const SECTORS = ['Financial Services', 'Real Estate', 'Legal Services', 'Consulting', 'Technology', 'Manufacturing', 'Trading', 'Healthcare', 'Energy', 'Other'];
const LEGAL_FORMS = ['BV', 'NV', 'Ltd', 'SA', 'GmbH', 'LLC', 'Inc', 'PLC', 'Other'];
const COUNTRIES = ['Netherlands (NL)', 'Belgium (BE)', 'Germany (DE)', 'France (FR)', 'United Kingdom (GB)', 'United States (US)', 'Curaçao (CW)', 'Aruba (AW)', 'Suriname (SR)', 'Other'];

export default function NewClient() {
  const { currentUser, tenant } = useTenant();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [clientType, setClientType] = useState(null);
  const [saving, setSaving] = useState(false);
  const tenantColor = tenant?.branding_primary_color || '#1A6BFF';

  const [form, setForm] = useState({
    full_name: '', date_of_birth: '', nationality: '', country_of_residence: '',
    primary_contact_email: '', primary_contact_phone: '', primary_contact_name: '',
    registration_number: '', lei_code: '', registered_country: '', registered_address: '',
    sector: '', legal_form: '', source_channel: 'Manual',
  });

  const set = (field, value) => setForm(f => ({ ...f, [field]: value }));

  async function handleCreate() {
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
      after_state: form,
    });

    // Create Onboarding case
    const dueDate = addDays(new Date(), 30);
    const kycCase = await base44.entities.KycCase.create({
      tenant_id: currentUser.tenant_id,
      client_id: client.id,
      client_name: form.full_name,
      client_type: clientType,
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
        'w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold border-2 transition-colors',
        done ? 'bg-emerald-500 border-emerald-500 text-white'
          : active ? 'border-primary text-primary bg-primary/10'
          : 'border-border text-muted-foreground'
      )}>
        {done ? <CheckCircle className="w-3.5 h-3.5" /> : n}
      </div>
      <span className={cn('text-sm', active ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
        {label}
      </span>
    </div>
  );

  return (
    <AppShell>
      <div className="p-6 max-w-2xl mx-auto">
        {/* Steps */}
        <div className="flex items-center gap-6 mb-8">
          <StepIndicator n={1} label="Client Type" active={step===1} done={step>1} />
          <div className="flex-1 h-px bg-border" />
          <StepIndicator n={2} label={clientType==='NP' ? 'Personal Details' : 'Organisation Details'} active={step===2} done={step>2} />
          <div className="flex-1 h-px bg-border" />
          <StepIndicator n={3} label="Review & Create" active={step===3} done={false} />
        </div>

        <div className="bg-card border border-border rounded-xl p-6">
          {/* Step 1 */}
          {step === 1 && (
            <div>
              <h2 className="text-lg font-semibold mb-1">Select Client Type</h2>
              <p className="text-sm text-muted-foreground mb-6">Choose the type of client you are onboarding</p>
              <div className="grid grid-cols-2 gap-4">
                {[
                  { type: 'NP', icon: User, label: 'Natural Person', sub: 'Individual client (NP)' },
                  { type: 'ORG', icon: Building2, label: 'Organisation', sub: 'Corporate entity (ORG)' },
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
            </div>
          )}

          {/* Step 2 */}
          {step === 2 && (
            <div>
              <h2 className="text-lg font-semibold mb-1">
                Step 2 of 3 — {clientType === 'NP' ? 'Personal' : 'Organisation'} Details
              </h2>
              <p className="text-sm text-muted-foreground mb-6">Enter the required information for this client</p>
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
                    <Field label="Registered Address *" value={form.registered_address} onChange={v => set('registered_address', v)} placeholder="Street, City, Postcode" />
                    <div className="grid grid-cols-2 gap-4">
                      <Field label="Contact Name *" value={form.primary_contact_name} onChange={v => set('primary_contact_name', v)} />
                      <Field label="Contact Email *" value={form.primary_contact_email} onChange={v => set('primary_contact_email', v)} type="email" />
                    </div>
                    <Field label="Contact Phone" value={form.primary_contact_phone} onChange={v => set('primary_contact_phone', v)} />
                  </>
                )}
              </div>
              <div className="flex gap-3 mt-6">
                <Button variant="outline" onClick={() => setStep(1)}>
                  <ChevronLeft className="w-4 h-4 mr-1" /> Back
                </Button>
                <Button
                  onClick={() => setStep(3)}
                  disabled={!form.full_name}
                  style={{ backgroundColor: tenantColor }}
                  className="flex-1 text-white"
                >
                  Continue to Review <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </div>
          )}

          {/* Step 3 */}
          {step === 3 && (
            <div>
              <h2 className="text-lg font-semibold mb-1">Step 3 of 3 — Review & Create</h2>
              <p className="text-sm text-muted-foreground mb-6">Confirm the details before creating the client and opening a KYC case</p>
              <div className="bg-muted/40 rounded-lg p-4 space-y-2 text-sm mb-6">
                <div className="flex justify-between"><span className="text-muted-foreground">Client Type</span><span className="font-medium">{clientType}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Name</span><span className="font-medium">{form.full_name}</span></div>
                {clientType === 'ORG' && (
                  <>
                    <div className="flex justify-between"><span className="text-muted-foreground">Legal Form</span><span className="font-medium">{form.legal_form}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Registration No.</span><span className="font-medium">{form.registration_number || '—'}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Country</span><span className="font-medium">{form.registered_country || '—'}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Sector</span><span className="font-medium">{form.sector || '—'}</span></div>
                  </>
                )}
                {clientType === 'NP' && (
                  <>
                    <div className="flex justify-between"><span className="text-muted-foreground">Date of Birth</span><span className="font-medium">{form.date_of_birth || '—'}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Nationality</span><span className="font-medium">{form.nationality || '—'}</span></div>
                  </>
                )}
                <div className="flex justify-between"><span className="text-muted-foreground">Contact Email</span><span className="font-medium">{form.primary_contact_email || '—'}</span></div>
              </div>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-700 mb-6">
                A new <strong>Onboarding</strong> KYC case will be created automatically and assigned to you.
              </div>
              <div className="flex gap-3">
                <Button variant="outline" onClick={() => setStep(2)}>
                  <ChevronLeft className="w-4 h-4 mr-1" /> Back
                </Button>
                <Button
                  onClick={handleCreate}
                  disabled={saving}
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
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/lib/tenantContext';
import AppShell from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { Building2, User, ChevronRight, ChevronLeft, CheckCircle, AlertTriangle, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';
import { addDays, format } from 'date-fns';
import { findDuplicates, DEDUP_THRESHOLD } from '@/lib/dedup';
import RestrictedClientGate from '@/components/archive/RestrictedClientGate';
import { NaturalPersonStep2A, NaturalPersonStep2B } from '@/components/client/forms/NaturalPersonForm';
import { OrganizationStep2A, OrganizationStep2B } from '@/components/client/forms/OrganizationForm';

// Steps: 1=Type, 2=Core Details, 3=Additional Details, 4=Review
const STEP_LABELS = {
  NP:  ['Client Type', 'Identity', 'ID & Contact', 'Review & Create'],
  ORG: ['Client Type', 'Organisation', 'Contact & Tax', 'Review & Create'],
};

export default function NewClient() {
  const { currentUser, tenant } = useTenant();
  const navigate = useNavigate();

  const [step, setStep]           = useState(1);
  const [clientType, setClientType] = useState(null);
  const [saving, setSaving]       = useState(false);
  const [allClients, setAllClients] = useState([]);
  const [dupWarning, setDupWarning] = useState(null);
  const [restrictedBlock, setRestrictedBlock] = useState(null);
  const tenantColor = tenant?.branding_primary_color || '#1A6BFF';

  const [form, setForm] = useState({
    full_name: '', date_of_birth: '', nationality: '', country_of_residence: '',
    id_type: '', id_number: '', id_expiry_date: '',
    primary_contact_email: '', primary_contact_phone: '', primary_contact_name: '',
    registration_number: '', lei_code: '', registered_country: '',
    registered_address: '', sector: '', legal_form: '',
    tax_residency: '', tin: '', entity_classification: '',
    source_channel: 'Manual',
  });

  const set = (field, value) => setForm(f => ({ ...f, [field]: value }));

  useEffect(() => {
    if (currentUser?.tenant_id) {
      base44.entities.Client.filter({ tenant_id: currentUser.tenant_id }).then(d => setAllClients((d || []).filter(c => !c.is_deleted)));
    }
  }, [currentUser]);

  function runDedup() {
    const country = form.registered_country || form.nationality || form.country_of_residence;
    return findDuplicates(form.full_name, country, allClients);
  }

  function splitDups(dups) {
    const restricted = dups.filter(d => ['Rejected', 'Unacceptable'].includes(d.client.status));
    const normal     = dups.filter(d => !['Rejected', 'Unacceptable'].includes(d.client.status));
    return { restricted, normal };
  }

  function handleStep2Next() {
    const dups = runDedup();
    if (dups.length > 0) {
      const { restricted, normal } = splitDups(dups);
      if (restricted.length > 0) { setRestrictedBlock(restricted); return; }
      setDupWarning({ duplicates: normal });
      return;
    }
    setStep(3);
  }

  async function handleCreate() {
    const dups = runDedup();
    if (dups.length > 0) {
      const { restricted, normal } = splitDups(dups);
      if (restricted.length > 0) { setRestrictedBlock(restricted); return; }
      setDupWarning({ duplicates: normal });
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

  const stepLabels = clientType ? STEP_LABELS[clientType] : ['Client Type', 'Details', 'Additional Details', 'Review & Create'];

  return (
    <AppShell>
      <div className="p-6 max-w-2xl mx-auto">
        {/* Step indicators */}
        <div className="flex items-center gap-2 mb-8">
          {stepLabels.map((label, i) => {
            const n = i + 1;
            const active = step === n;
            const done = step > n;
            return (
              <React.Fragment key={n}>
                {i > 0 && <div className={cn('flex-1 h-px transition-colors', done ? 'bg-primary' : 'bg-border')} />}
                <div className={cn('flex items-center gap-2', !active && !done && 'opacity-40')}>
                  <div className={cn(
                    'w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold border-2 flex-shrink-0',
                    done   ? 'bg-emerald-500 border-emerald-500 text-white'
                           : active ? 'border-primary text-primary bg-primary/10'
                           : 'border-border text-muted-foreground'
                  )}>
                    {done ? <CheckCircle className="w-3.5 h-3.5" /> : n}
                  </div>
                  <span className={cn('text-sm hidden sm:block whitespace-nowrap', active ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
                    {label}
                  </span>
                </div>
              </React.Fragment>
            );
          })}
        </div>

        <div className="bg-card border border-border rounded-xl p-6">

          {/* ── Step 1: Client Type ── */}
          {step === 1 && (
            <div>
              <h2 className="text-lg font-semibold mb-1">Select Client Type</h2>
              <p className="text-sm text-muted-foreground mb-6">Choose the type of client you are onboarding</p>
              <div className="grid grid-cols-2 gap-4">
                {[
                  { type: 'NP',  TypeIcon: User,     label: 'Natural Person', sub: 'Individual client — passport, national ID' },
                  { type: 'ORG', TypeIcon: Building2, label: 'Organisation',   sub: 'Corporate entity — BV, NV, Ltd, etc.' },
                ].map(({ type, TypeIcon, label, sub }) => (
                  <button
                    key={type}
                    onClick={() => { setClientType(type); setStep(2); }}
                    className={cn(
                      'border-2 rounded-xl p-6 text-left transition-all hover:shadow-md',
                      clientType === type ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'
                    )}
                  >
                    <TypeIcon className="w-8 h-8 mb-3 text-primary" />
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

          {/* ── Step 2: Core Details ── */}
          {step === 2 && (
            <div>
              <h2 className="text-lg font-semibold mb-1">
                {clientType === 'NP' ? 'Identity Details' : 'Organisation Details'}
              </h2>
              <p className="text-sm text-muted-foreground mb-5">Fields marked * are required</p>

              {restrictedBlock && (
                <RestrictedClientGate
                  matches={restrictedBlock}
                  currentUser={currentUser}
                  tenantId={currentUser?.tenant_id}
                  onDismiss={() => setRestrictedBlock(null)}
                />
              )}
              {!restrictedBlock && dupWarning && (
                <DupWarningBlock
                  duplicates={dupWarning.duplicates}
                  onDismiss={() => { setDupWarning(null); setStep(3); }}
                  onViewClient={id => navigate(`/client/${id}`)}
                />
              )}

              {!restrictedBlock && !dupWarning && (
                <>
                  {clientType === 'NP'
                    ? <NaturalPersonStep2A form={form} set={set} />
                    : <OrganizationStep2A form={form} set={set} />
                  }
                  <div className="flex gap-3 mt-6">
                    <Button variant="outline" onClick={() => setStep(1)}>
                      <ChevronLeft className="w-4 h-4 mr-1" /> Back
                    </Button>
                    <Button
                      onClick={handleStep2Next}
                      disabled={!form.full_name}
                      style={{ backgroundColor: tenantColor }}
                      className="flex-1 text-white"
                    >
                      Continue <ChevronRight className="w-4 h-4 ml-1" />
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── Step 3: Additional Details ── */}
          {step === 3 && (
            <div>
              <h2 className="text-lg font-semibold mb-1">
                {clientType === 'NP' ? 'ID Document & Contact' : 'Contact & Tax Compliance'}
              </h2>
              <p className="text-sm text-muted-foreground mb-5">
                {clientType === 'NP' ? 'Provide identity document details and contact information' : 'Primary contact and FATCA/CRS information'}
              </p>

              {clientType === 'NP'
                ? <NaturalPersonStep2B form={form} set={set} />
                : <OrganizationStep2B form={form} set={set} />
              }

              <div className="flex gap-3 mt-6">
                <Button variant="outline" onClick={() => setStep(2)}>
                  <ChevronLeft className="w-4 h-4 mr-1" /> Back
                </Button>
                <Button
                  onClick={() => setStep(4)}
                  style={{ backgroundColor: tenantColor }}
                  className="flex-1 text-white"
                >
                  Review & Create <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </div>
          )}

          {/* ── Step 4: Review ── */}
          {step === 4 && (
            <div>
              <h2 className="text-lg font-semibold mb-1">Review & Create</h2>
              <p className="text-sm text-muted-foreground mb-5">Confirm all details before creating the client and opening a KYC case</p>

              {dupWarning && (
                <DupWarningBlock
                  duplicates={dupWarning.duplicates}
                  onDismiss={() => setDupWarning(null)}
                  onViewClient={id => navigate(`/client/${id}`)}
                />
              )}

              <div className="bg-muted/40 rounded-lg p-4 space-y-0 text-sm mb-5 border border-border divide-y divide-border">
                <ReviewRow label="Client Type" value={clientType === 'NP' ? 'Natural Person' : 'Organisation'} />
                <ReviewRow label="Name" value={form.full_name} />
                {clientType === 'ORG' && <>
                  <ReviewRow label="Legal Form" value={form.legal_form} />
                  <ReviewRow label="Registration No." value={form.registration_number} />
                  <ReviewRow label="Registered Country" value={form.registered_country} />
                  <ReviewRow label="Sector" value={form.sector} />
                  <ReviewRow label="Address" value={form.registered_address} />
                  <ReviewRow label="Contact Name" value={form.primary_contact_name} />
                  <ReviewRow label="Entity Classification" value={form.entity_classification} />
                </>}
                {clientType === 'NP' && <>
                  <ReviewRow label="Date of Birth" value={form.date_of_birth} />
                  <ReviewRow label="Nationality" value={form.nationality} />
                  <ReviewRow label="Country of Residence" value={form.country_of_residence} />
                  <ReviewRow label="ID Type" value={form.id_type} />
                  <ReviewRow label="ID Number" value={form.id_number} />
                </>}
                <ReviewRow label="Contact Email" value={form.primary_contact_email} />
                <ReviewRow label="Tax Residency" value={form.tax_residency} />
                <ReviewRow label="TIN" value={form.tin} />
                <ReviewRow label="Source Channel" value={form.source_channel} />
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-700 mb-5">
                A new <strong>Onboarding</strong> KYC case will be created and assigned to you with a 30-day due date.
              </div>

              <div className="flex gap-3">
                <Button variant="outline" onClick={() => setStep(3)}>
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
    <div className="flex justify-between py-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-right max-w-[60%]">{value || '—'}</span>
    </div>
  );
}
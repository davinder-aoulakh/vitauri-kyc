import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/lib/tenantContext';
import AppShell from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { Building2, User, ChevronRight, ChevronLeft, CheckCircle, AlertTriangle, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';
import { addDays, format } from 'date-fns';
import { getDefaultStepConfig } from '@/lib/caseUtils';
import { findDuplicates, DEDUP_THRESHOLD } from '@/lib/dedup';
import RestrictedClientGate from '@/components/archive/RestrictedClientGate';
import { NaturalPersonStep2A, NaturalPersonStep2B } from '@/components/client/forms/NaturalPersonForm';
import { OrganizationStep2A, OrganizationStep2B } from '@/components/client/forms/OrganizationForm';
import { computeFullName, syncPreferredContacts } from '@/lib/clientNameUtils';
import { startCaseOpenTrace, markCaseOpen } from '@/lib/perfTrace';
import { toast } from '@/components/ui/use-toast';

// Only what the duplicate check and the duplicate warnings display.
const DEDUP_FIELDS = ['id', 'full_name', 'registered_country', 'nationality', 'country_of_residence', 'status', 'is_deleted', 'registration_number'];

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
  const clientsLoad = useRef(null);
  const creating = useRef(false);
  const [dupWarning, setDupWarning] = useState(null);
  // Name the user confirmed is NOT a duplicate, so Create doesn't re-block on it.
  const [dupAckName, setDupAckName] = useState(null);
  const [restrictedBlock, setRestrictedBlock] = useState(null);
  const tenantColor = tenant?.branding_primary_color || '#1A6BFF';

  const [form, setForm] = useState({
    full_name: '', first_names: '', last_name: '', initials: '', preferred_name: '',
    gender: 'Unknown', category: 'Klant', external_id: '',
    date_of_birth: '', decease_date: '', nationality: '', country_of_birth: '', place_of_birth: '',
    country_of_residence: '', language: 'en',
    id_type: '', id_number: '', id_expiry_date: '',
    residential_address: {}, postal_address: {}, contact_entries: [],
    primary_contact_email: '', primary_contact_phone: '', primary_contact_name: '',
    registration_number: '', lei_code: '', registered_country: '',
    registered_address: '', sector: '', legal_form: '',
    tax_residency: '', tin: '', entity_classification: '',
    source_channel: 'Manual',
  });

  const set = (field, value) => setForm(f => ({ ...f, [field]: value }));

  // Keep full_name computed for NP clients as first_names/last_name change
  useEffect(() => {
    if (clientType === 'NP') {
      setForm(f => ({ ...f, full_name: computeFullName(f.first_names, f.last_name) }));
    }
  }, [form.first_names, form.last_name, clientType]);

  useEffect(() => {
    if (currentUser?.tenant_id) {
      clientsLoad.current = base44.entities.Client
        .filter({ tenant_id: currentUser.tenant_id }, { limit: 1000, fields: DEDUP_FIELDS })
        .then(d => { const list = (d || []).filter(c => !c.is_deleted); setAllClients(list); return list; })
        .catch(err => { console.error('NewClient: duplicate-check list failed', err); return []; });
    }
  }, [currentUser?.tenant_id]);

  function runDedup(clients = allClients) {
    const country = form.registered_country || form.nationality || form.country_of_residence;
    return findDuplicates(form.full_name, country, clients);
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
    if (creating.current) return; // a create is already in flight
    creating.current = true;
    try {
      // Wait for the duplicate-check list if it hasn't arrived yet.
      const clients = allClients.length > 0 || !clientsLoad.current ? allClients : await clientsLoad.current;
      const dups = runDedup(clients);
      if (dups.length > 0) {
        const { restricted, normal } = splitDups(dups);
        if (restricted.length > 0) { setRestrictedBlock(restricted); return; }
        if (dupAckName !== form.full_name) { setDupWarning({ duplicates: normal }); return; }
      }

      setSaving(true);
      startCaseOpenTrace({ tenant_id: currentUser.tenant_id, user_id: currentUser.id, user_name: currentUser.full_name });
      const contactMirror = syncPreferredContacts(form.contact_entries);
      const clientData = {
        ...form,
        ...(form.contact_entries?.length > 0 ? contactMirror : {}),
        ...(clientType === 'ORG' ? { registered_country: form.residential_address?.country || form.registered_country } : {}),
      };
      const stepConfig = getDefaultStepConfig(clientType, 'Onboarding');
      const dueDate = format(addDays(new Date(), 30), 'yyyy-MM-dd');

      let created = null;
      try {
        const res = await base44.functions.invoke('createClientWithCase', {
          client: clientData,
          client_type: clientType,
          audit_after_state: { ...form, client_type: clientType },
          step_config: stepConfig,
          due_date: dueDate,
        });
        if (!res?.data?.kycCase?.id) throw new Error(res?.data?.error || 'The case could not be created');
        created = res.data;
      } catch (err) {
        // Fall back only when the function isn't deployed; any other error may
        // mean the client was already written, so retrying could duplicate it.
        const status = err?.response?.status ?? err?.status;
        if (status !== 404) throw new Error(err?.response?.data?.error || err?.message || 'Create failed');
        console.warn('createClientWithCase not available, using the step-by-step path');
      }
      if (!created) created = await createStepByStep(clientData, stepConfig, dueDate);

      markCaseOpen('created_ms', {
        client_id: created.client.id,
        server_ms: created.timings?.total_ms ?? null,
        path: created.timings ? 'function' : 'fallback',
      });
      navigate(`/case/${created.kycCase.id}`, { state: { kycCase: created.kycCase, client: created.client } });
      markCaseOpen('navigate_ms');
    } catch (err) {
      console.error('NewClient create failed', err);
      setSaving(false);
      toast({ variant: 'destructive', title: 'Could not create the client', description: err?.message || 'Please try again.' });
    } finally {
      creating.current = false;
    }
  }

  // Previous browser-side path; used only when createClientWithCase is unavailable.
  async function createStepByStep(clientData, stepConfig, dueDate) {
    const client = await base44.entities.Client.create({
      ...clientData,
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

    const kycCase = await base44.entities.KycCase.create({
      tenant_id: currentUser.tenant_id,
      client_id: client.id,
      case_type: 'Onboarding',
      status: 'Draft',
      assigned_analyst_id: currentUser.id,
      due_date: dueDate,
      created_by_user_id: currentUser.id,
      ...stepConfig,
    });

    return { client, kycCase, timings: null };
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
                  onDismiss={() => { setDupWarning(null); setDupAckName(form.full_name); setStep(3); }}
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
                      disabled={clientType === 'NP' ? (!form.first_names || !form.last_name) : !form.full_name}
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
                  onDismiss={() => { setDupWarning(null); setDupAckName(form.full_name); }}
                  onViewClient={id => navigate(`/client/${id}`)}
                />
              )}

              <div className="bg-muted/40 rounded-lg p-4 space-y-0 text-sm mb-5 border border-border divide-y divide-border">
                <ReviewRow label="Client Type" value={clientType === 'NP' ? 'Natural Person' : 'Organisation'} />
                <ReviewRow label="Name" value={form.full_name} />
                {clientType === 'ORG' && <>
                  <ReviewRow label="Legal Form" value={form.legal_form} />
                  <ReviewRow label="Registration No." value={form.registration_number} />
                  <ReviewRow label="Registered Country" value={form.residential_address?.country || form.registered_country} />
                  <ReviewRow label="Sector" value={form.sector} />
                  <ReviewRow label="Residential Address" value={[form.residential_address?.street, form.residential_address?.city, form.residential_address?.country].filter(Boolean).join(', ')} />
                  <ReviewRow label="Contact Name" value={form.primary_contact_name} />
                  <ReviewRow label="Entity Classification" value={form.entity_classification} />
                </>}
                {clientType === 'NP' && <>
                  <ReviewRow label="Preferred Name" value={form.preferred_name} />
                  <ReviewRow label="Gender" value={form.gender} />
                  <ReviewRow label="Date of Birth" value={form.date_of_birth} />
                  <ReviewRow label="Country / Place of Birth" value={[form.country_of_birth, form.place_of_birth].filter(Boolean).join(' / ')} />
                  <ReviewRow label="Nationality" value={form.nationality} />
                  <ReviewRow label="Country of Residence" value={form.country_of_residence} />
                  <ReviewRow label="ID Type" value={form.id_type} />
                  <ReviewRow label="ID Number" value={form.id_number} />
                  <ReviewRow label="Residential Address" value={[form.residential_address?.street, form.residential_address?.city, form.residential_address?.country].filter(Boolean).join(', ')} />
                </>}
                <ReviewRow label="Contact Email" value={syncPreferredContacts(form.contact_entries).primary_contact_email} />
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
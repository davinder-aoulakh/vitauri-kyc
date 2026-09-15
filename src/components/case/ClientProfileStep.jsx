/**
 * ClientProfileStep — Step 4
 * Sections:
 *   1A  Purpose & Nature of Business Relationship (unchanged)
 *   1B  Expected Transaction Behaviour (unchanged)
 *   2   Structured Profile Fields (replaces old narrative)
 *       - Run Pre-fill Pipeline button
 *       - NP or ORG field grid with per-field suggestions
 *       - Related Party suggestions sub-grid
 *       - Accept All High-Confidence batch action
 */
import React, { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { useAutoSave } from '@/hooks/useAutoSave';
import AutoSaveIndicator from '@/components/shared/AutoSaveIndicator';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import ProfileFieldRow from '@/components/case/profile/ProfileFieldRow';
import RelatedPartySuggestionRow from '@/components/case/profile/RelatedPartySuggestionRow';
import {
  Sparkles, Loader2, User, Building2, AlertTriangle,
  ChevronDown, ChevronUp, X, CheckCheck, RefreshCw, Info
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { getNestedValue, buildFieldUpdatePayload } from '@/lib/clientNameUtils';

const TX_TYPES = ['Payments', 'Investments', 'Transfers', 'FX', 'Other'];
const TX_FREQUENCIES = ['Daily', 'Weekly', 'Monthly', 'Quarterly', 'Annually', 'Ad hoc'];
const TX_VOLUMES = ['< €10k/year', '€10k–€100k/year', '€100k–€1M/year', '€1M–€10M/year', '> €10M/year'];
const GEOGRAPHIES = ['Domestic only', 'EU/EEA', 'UK', 'USA/Canada', 'Asia Pacific', 'Middle East', 'Africa', 'Latin America', 'Other'];
const CONFIDENCE_THRESHOLD = 70;

const NP_FIELD_LABELS = {
  full_name:           'Full Name',
  first_names:         'First Names',
  last_name:           'Last Name',
  initials:            'Initials',
  preferred_name:      'Preferred Name',
  gender:              'Gender',
  date_of_birth:       'Date of Birth',
  country_of_birth:    'Country of Birth',
  place_of_birth:      'Place of Birth',
  nationality:         'Nationality',
  country_of_residence:'Country of Residence',
  id_type:             'ID Type',
  id_number:           'ID Number',
  'residential_address.country': 'Residential Address — Country',
  'residential_address.street':  'Residential Address — Street',
  'residential_address.number':  'Residential Address — Number',
  'residential_address.zipcode': 'Residential Address — Zipcode',
  'residential_address.city':    'Residential Address — City',
};
const ORG_FIELD_LABELS = {
  full_name:           'Legal Entity Name',
  legal_form:          'Legal Form',
  registration_number: 'Registration Number',
  registered_country:  'Registered Country',
  registered_address:  'Registered Address',
  sector:              'Sector / Industry',
  lei_code:            'LEI Code',
};

function MultiSelectChips({ options, selected, onChange }) {
  return (
    <div className="space-y-2">
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map(s => (
            <span key={s} className="inline-flex items-center gap-1 text-xs bg-primary/10 text-primary border border-primary/20 rounded-full px-2.5 py-0.5 font-medium">
              {s}
              <button onClick={() => onChange(selected.filter(x => x !== s))} className="hover:text-red-500 ml-0.5">
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">
        {options.filter(o => !selected.includes(o)).map(o => (
          <button
            key={o}
            onClick={() => onChange([...selected, o])}
            className="text-xs px-2.5 py-1 rounded-full border border-border text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors"
          >
            + {o}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function ClientProfileStep({ kycCase, client, currentUser, onRegisterOsintAdd }) {
  const isOrg = client?.client_type === 'ORG';
  const fieldLabels = isOrg ? ORG_FIELD_LABELS : NP_FIELD_LABELS;

  // ── Section 1A ───────────────────────────────────────────────────────────────
  const [purposeText, setPurposeText]           = useState('');
  const [generatingPurpose, setGeneratingPurpose] = useState(false);

  // ── Section 1B ───────────────────────────────────────────────────────────────
  const [txExpanded, setTxExpanded] = useState(false);
  const [txBehavior, setTxBehavior] = useState({ types: [], frequency: '', counterparties: '', geographies: [], volumes: '' });

  // ── Section 2 — structured suggestions ──────────────────────────────────────
  const [suggestions, setSuggestions]       = useState(null); // full profile_suggestions object
  const [pipelineRunning, setPipelineRunning] = useState(false);
  const [acceptingField, setAcceptingField] = useState(null);

  const loaded = useRef(false);

  // Load saved data on mount
  useEffect(() => {
    if (kycCase?.purpose_nature_text) setPurposeText(kycCase.purpose_nature_text);
    if (kycCase?.expected_transaction_behavior) {
      try { setTxBehavior(JSON.parse(kycCase.expected_transaction_behavior)); } catch {}
    }
    if (kycCase?.profile_suggestions) setSuggestions(kycCase.profile_suggestions);
    loaded.current = true;
  }, [kycCase?.id]);

  // Register OSINT add callback (Section 1A purpose text append)
  useEffect(() => {
    if (onRegisterOsintAdd) {
      onRegisterOsintAdd((finding) => {
        const text = `\n\n[OSINT — ${finding.source_type?.toUpperCase()}] ${finding.title}: ${finding.summary}`;
        setPurposeText(d => d + text);
      });
    }
  }, [onRegisterOsintAdd]);

  // Auto-save 1A + 1B
  const { autoSaving, lastSaved } = useAutoSave(
    { purposeText, txBehavior },
    async (data) => {
      if (!kycCase?.id) return;
      await base44.entities.KycCase.update(kycCase.id, {
        purpose_nature_text: data.purposeText,
        expected_transaction_behavior: JSON.stringify(data.txBehavior),
      });
    },
    1500,
    !loaded.current,
  );

  // ── Section 1A AI draft ──────────────────────────────────────────────────────
  async function generatePurposeDraft() {
    setGeneratingPurpose(true);
    const outreachData = await base44.entities.OutreachRequest.filter({ case_id: kycCase.id });
    const outreachContext = outreachData?.map(o =>
      o.items?.map(i => `${i.label}: ${i.response_text || 'pending'}`).join('; ')
    ).join('\n') || 'No outreach responses';

    const result = await base44.integrations.Core.InvokeLLM({
      prompt: `You are a senior KYC analyst. Draft a concise, regulatory-grade "Purpose and Nature of Business Relationship" statement for:

CLIENT: ${client?.full_name} (${isOrg ? 'Organisation' : 'Natural Person'})
${isOrg
  ? `Sector: ${client?.sector || 'N/A'} | Legal Form: ${client?.legal_form || 'N/A'} | Country: ${client?.registered_country || 'N/A'}`
  : `Nationality: ${client?.nationality || 'N/A'} | Residence: ${client?.country_of_residence || 'N/A'}`}

CASE TYPE: ${kycCase?.case_type?.replace(/_/g, ' ')}
OUTREACH RESPONSES: ${outreachContext}

Write 2–4 sentences: (1) why the client is engaging, (2) intended products/services, (3) nature of relationship. Factual, precise. Note where information is not yet confirmed.`,
      model: 'claude_sonnet_4_6',
    });
    setPurposeText(typeof result === 'string' ? result : result?.statement || JSON.stringify(result));
    setGeneratingPurpose(false);
  }

  // ── Pipeline ─────────────────────────────────────────────────────────────────
  async function runPipeline(forceOsint = false) {
    setPipelineRunning(true);
    try {
      const res = await base44.functions.invoke('buildProfileSuggestions', {
        case_id:             kycCase.id,
        client_id:           kycCase.client_id,
        client_type:         client?.client_type,
        force_osint_refresh: forceOsint,
      });
      const data = res?.data ?? res;
      if (data?.suggestion) setSuggestions(data.suggestion);
    } catch (err) {
      console.error('Pipeline error:', err);
    } finally {
      setPipelineRunning(false);
    }
  }

  // Persist updated suggestions to KycCase
  async function saveSuggestions(updated) {
    setSuggestions(updated);
    await base44.entities.KycCase.update(kycCase.id, { profile_suggestions: updated });
  }

  // ── Field: Accept ────────────────────────────────────────────────────────────
  async function acceptField(fieldKey, suggestion) {
    setAcceptingField(fieldKey);
    const before = { [fieldKey]: getNestedValue(client, fieldKey) || null };
    const after  = { [fieldKey]: suggestion.value };

    // Atomic write to Client entity — handles "parent.child" dot-path keys (e.g. residential_address.city)
    await base44.entities.Client.update(client.id, buildFieldUpdatePayload(client, fieldKey, suggestion.value));

    // Update suggestion status
    const updated = {
      ...suggestions,
      client_fields: {
        ...suggestions.client_fields,
        [fieldKey]: { ...suggestion, status: 'confirmed' },
      },
    };
    await saveSuggestions(updated);

    // Audit event
    await base44.entities.AuditEvent.create({
      tenant_id:      kycCase.tenant_id,
      case_id:        kycCase.id,
      client_id:      kycCase.client_id,
      actor_user_id:  currentUser?.id,
      actor_name:     currentUser?.full_name,
      actor_type:     'User',
      event_type:     'profile_field_confirmed',
      before_state:   before,
      after_state:    after,
      notes:          `field=${fieldKey} source=${suggestion.source_type}:${suggestion.source_ref} confidence=${suggestion.confidence}%`,
    });
    setAcceptingField(null);
  }

  // ── Field: Reject ────────────────────────────────────────────────────────────
  async function rejectField(fieldKey) {
    const updated = {
      ...suggestions,
      client_fields: {
        ...suggestions.client_fields,
        [fieldKey]: { ...(suggestions.client_fields[fieldKey] || {}), status: 'rejected' },
      },
    };
    await saveSuggestions(updated);

    await base44.entities.AuditEvent.create({
      tenant_id:     kycCase.tenant_id,
      case_id:       kycCase.id,
      client_id:     kycCase.client_id,
      actor_user_id: currentUser?.id,
      actor_name:    currentUser?.full_name,
      actor_type:    'User',
      event_type:    'profile_field_rejected',
      notes:         `field=${fieldKey} reason=analyst rejected suggestion`,
    });
  }

  // ── Field: Manual edit ───────────────────────────────────────────────────────
  async function handleManualEdit(fieldKey, value) {
    const before = { [fieldKey]: getNestedValue(client, fieldKey) || null };
    const after  = { [fieldKey]: value };
    await base44.entities.Client.update(client.id, buildFieldUpdatePayload(client, fieldKey, value));
    const updated = {
      ...suggestions,
      client_fields: {
        ...(suggestions?.client_fields || {}),
        [fieldKey]: { value, confidence: 100, source_type: 'manual', source_ref: 'Analyst manual entry', status: 'confirmed', conflict_note: null },
      },
    };
    await saveSuggestions(updated);
    await base44.entities.AuditEvent.create({
      tenant_id:     kycCase.tenant_id,
      case_id:       kycCase.id,
      client_id:     kycCase.client_id,
      actor_user_id: currentUser?.id,
      actor_name:    currentUser?.full_name,
      actor_type:    'User',
      event_type:    'profile_field_confirmed',
      before_state:  before,
      after_state:   after,
      notes:         `field=${fieldKey} source=manual confidence=100%`,
    });
  }

  // ── Accept All High-Confidence ───────────────────────────────────────────────
  async function acceptAllHighConfidence() {
    if (!suggestions?.client_fields) return;
    const toAccept = Object.entries(suggestions.client_fields).filter(([, s]) => {
      return s.status === 'suggested' && s.confidence >= CONFIDENCE_THRESHOLD && s.value;
    });
    if (toAccept.length === 0) return;

    let clientUpdates = {};
    const fieldUpdates = { ...suggestions.client_fields };

    for (const [fieldKey, s] of toAccept) {
      clientUpdates = { ...clientUpdates, ...buildFieldUpdatePayload({ ...client, ...clientUpdates }, fieldKey, s.value) };
      fieldUpdates[fieldKey] = { ...s, status: 'confirmed' };
    }

    await base44.entities.Client.update(client.id, clientUpdates);
    const updated = { ...suggestions, client_fields: fieldUpdates };
    await saveSuggestions(updated);

    // One audit event per field
    for (const [fieldKey, s] of toAccept) {
      await base44.entities.AuditEvent.create({
        tenant_id:     kycCase.tenant_id,
        case_id:       kycCase.id,
        client_id:     kycCase.client_id,
        actor_user_id: currentUser?.id,
        actor_name:    currentUser?.full_name,
        actor_type:    'User',
        event_type:    'profile_field_confirmed',
        before_state:  { [fieldKey]: getNestedValue(client, fieldKey) || null },
        after_state:   { [fieldKey]: s.value },
        notes:         `field=${fieldKey} source=${s.source_type}:${s.source_ref} confidence=${s.confidence}% (batch accept)`,
      });
    }
  }

  // ── Related Party: Accept ────────────────────────────────────────────────────
  async function acceptRelatedParty(rpIndex, rp) {
    // Create RelatedParty record
    const rpRecord = await base44.entities.RelatedParty.create({
      tenant_id:            kycCase.tenant_id,
      party_type:           rp.party_type || 'NP',
      full_name:            rp.full_name,
      role_in_relationship: rp.role_in_relationship,
      ownership_percentage: rp.ownership_percentage ? Number(rp.ownership_percentage) : undefined,
      verification_status:  'Unverified',
    });

    // Link to client
    await base44.entities.ClientRelatedPartyLink.create({
      tenant_id:        kycCase.tenant_id,
      client_id:        kycCase.client_id,
      related_party_id: rpRecord.id,
      role:             rp.role_in_relationship,
      ownership_percentage: rp.ownership_percentage ? Number(rp.ownership_percentage) : undefined,
      added_by_user_id: currentUser?.id,
    });

    // Mark confirmed in suggestions
    const updatedRps = (suggestions.related_parties || []).map((r, i) =>
      i === rpIndex ? { ...r, status: 'confirmed', rp_id: rpRecord.id } : r
    );
    const updated = { ...suggestions, related_parties: updatedRps };
    await saveSuggestions(updated);

    await base44.entities.AuditEvent.create({
      tenant_id:     kycCase.tenant_id,
      case_id:       kycCase.id,
      client_id:     kycCase.client_id,
      actor_user_id: currentUser?.id,
      actor_name:    currentUser?.full_name,
      actor_type:    'User',
      event_type:    'profile_related_party_added',
      after_state:   { full_name: rp.full_name, role: rp.role_in_relationship, related_party_id: rpRecord.id },
      notes:         `Related party confirmed: ${rp.full_name} (${rp.role_in_relationship}) from source ${rp.fields?.full_name?.source_ref || 'unknown'}`,
    });
  }

  // ── Related Party: Reject ────────────────────────────────────────────────────
  async function rejectRelatedParty(rpIndex) {
    const updatedRps = (suggestions.related_parties || []).map((r, i) =>
      i === rpIndex ? { ...r, status: 'rejected' } : r
    );
    const updated = { ...suggestions, related_parties: updatedRps };
    await saveSuggestions(updated);
  }

  // ── Computed stats ────────────────────────────────────────────────────────────
  const clientFields = suggestions?.client_fields || {};
  const fieldKeys = Object.keys(fieldLabels);
  const confirmed = fieldKeys.filter(k => clientFields[k]?.status === 'confirmed').length;
  const conflicts = fieldKeys.filter(k => clientFields[k]?.status === 'conflict').length;
  const pending   = fieldKeys.filter(k => ['suggested','low_confidence'].includes(clientFields[k]?.status)).length;
  const highConfPending = fieldKeys.filter(k => clientFields[k]?.status === 'suggested' && clientFields[k]?.confidence >= CONFIDENCE_THRESHOLD).length;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-semibold text-sm text-foreground">Client Profile Builder</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Build a structured regulatory profile for {client?.full_name || 'this client'}
          </p>
        </div>
        <AutoSaveIndicator autoSaving={autoSaving} lastSaved={lastSaved} />
      </div>

      {/* Client Snapshot */}
      <div className="bg-muted/30 border border-border rounded-xl p-4">
        <div className="flex items-center gap-3">
          <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center', isOrg ? 'bg-blue-100 text-blue-700' : 'bg-violet-100 text-violet-700')}>
            {isOrg ? <Building2 className="w-4 h-4" /> : <User className="w-4 h-4" />}
          </div>
          <div>
            <div className="font-semibold text-sm">{client?.full_name}</div>
            <div className="text-xs text-muted-foreground">
              {isOrg
                ? `${client?.legal_form || 'Organisation'} · ${client?.sector || '—'} · ${client?.registered_country || '—'}`
                : `${client?.nationality || '—'} · ${client?.country_of_residence || '—'}`}
            </div>
          </div>
        </div>
      </div>

      {/* ─── SECTION 1A — Purpose & Nature ─── */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h4 className="font-semibold text-sm">1A — Purpose & Nature of Business Relationship</h4>
              <span className="text-xs font-medium text-red-500 bg-red-50 border border-red-200 rounded-full px-2 py-0.5">Mandatory</span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">Regulatory requirement — must be completed before this step can be marked complete</p>
          </div>
          <Button size="sm" className="gap-1.5 text-xs bg-purple-600 hover:bg-purple-700 text-white flex-shrink-0"
            onClick={generatePurposeDraft} disabled={generatingPurpose}>
            {generatingPurpose ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            {generatingPurpose ? 'Drafting…' : 'AI Draft'}
          </Button>
        </div>
        <Textarea
          value={purposeText}
          onChange={e => setPurposeText(e.target.value)}
          placeholder={`Describe the nature of the client relationship, intended products/services…`}
          className={cn('text-sm min-h-24 resize-none', !purposeText && 'border-amber-300 focus:ring-amber-400')}
        />
        {!purposeText && (
          <div className="flex items-center gap-1.5 text-xs text-amber-600">
            <AlertTriangle className="w-3 h-3" />
            This field is required to complete this step.
          </div>
        )}
      </div>

      {/* ─── SECTION 1B — Expected Transaction Behaviour ─── */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <button className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-muted/20 transition-colors"
          onClick={() => setTxExpanded(o => !o)}>
          <div>
            <span className="font-semibold text-sm">1B — Expected Transaction Behaviour</span>
            <span className="text-xs text-muted-foreground ml-2">(optional)</span>
          </div>
          {txExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </button>
        {txExpanded && (
          <div className="px-4 pb-4 space-y-4 border-t border-border">
            <div className="pt-3">
              <Label className="text-xs mb-2 block">Transaction Types</Label>
              <MultiSelectChips options={TX_TYPES} selected={txBehavior.types || []} onChange={v => setTxBehavior(s => ({ ...s, types: v }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs mb-1.5 block">Frequency</Label>
                <Select value={txBehavior.frequency} onValueChange={v => setTxBehavior(s => ({ ...s, frequency: v }))}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select…" /></SelectTrigger>
                  <SelectContent>{TX_FREQUENCIES.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs mb-1.5 block">Expected Volumes</Label>
                <Select value={txBehavior.volumes} onValueChange={v => setTxBehavior(s => ({ ...s, volumes: v }))}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select…" /></SelectTrigger>
                  <SelectContent>{TX_VOLUMES.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs mb-1.5 block">Expected Counterparties</Label>
              <Textarea value={txBehavior.counterparties} onChange={e => setTxBehavior(s => ({ ...s, counterparties: e.target.value }))}
                placeholder="Describe expected counterparties…" className="text-sm min-h-14 resize-none" />
            </div>
            <div>
              <Label className="text-xs mb-2 block">Geographies</Label>
              <MultiSelectChips options={GEOGRAPHIES} selected={txBehavior.geographies || []} onChange={v => setTxBehavior(s => ({ ...s, geographies: v }))} />
            </div>
          </div>
        )}
      </div>

      {/* ─── SECTION 2 — Structured Profile Fields ─── */}
      <div className="border-t border-border pt-5 space-y-4">
        {/* Section header + pipeline controls */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h4 className="font-semibold text-sm">2 — Structured Profile Fields</h4>
            <p className="text-xs text-muted-foreground mt-0.5">
              AI-extracted from documents, outreach responses &amp; OSINT · Confirm each field to write to client record
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {suggestions && highConfPending > 0 && (
              <Button size="sm" variant="outline" className="gap-1.5 text-xs text-emerald-700 border-emerald-300 hover:bg-emerald-50"
                onClick={acceptAllHighConfidence}>
                <CheckCheck className="w-3.5 h-3.5" /> Accept All High-Confidence ({highConfPending})
              </Button>
            )}
            <Button size="sm"
              className={cn('gap-1.5 text-xs', suggestions ? 'bg-slate-700 hover:bg-slate-800 text-white' : 'bg-purple-600 hover:bg-purple-700 text-white')}
              onClick={() => runPipeline(false)}
              disabled={pipelineRunning}
            >
              {pipelineRunning
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Running Pipeline…</>
                : suggestions
                  ? <><RefreshCw className="w-3.5 h-3.5" /> Re-run Pipeline</>
                  : <><Sparkles className="w-3.5 h-3.5" /> Run Pre-fill Pipeline</>
              }
            </Button>
          </div>
        </div>

        {/* Pipeline run metadata */}
        {suggestions?.run_at && (
          <div className="flex items-center gap-4 text-xs text-muted-foreground bg-muted/30 border border-border rounded-lg px-3 py-2">
            <span className="flex items-center gap-1">
              <Info className="w-3 h-3" />
              Last run: {format(new Date(suggestions.run_at), 'd MMM yyyy HH:mm')}
            </span>
            <span>{suggestions.sources_summary?.documents_processed || 0} docs OCR'd</span>
            <span>{suggestions.sources_summary?.outreach_requests || 0} outreach responses</span>
            <span>{suggestions.sources_summary?.osint_findings || 0} OSINT findings</span>
            {conflicts > 0 && <span className="text-red-600 font-medium flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> {conflicts} conflict{conflicts > 1 ? 's' : ''}</span>}
            <span className="text-emerald-600 font-medium">{confirmed}/{fieldKeys.length} confirmed</span>
          </div>
        )}

        {/* Idle state — no pipeline run yet */}
        {!suggestions && !pipelineRunning && (
          <div className="bg-card border border-border rounded-xl py-12 text-center space-y-3">
            <Sparkles className="w-8 h-8 text-purple-300 mx-auto" />
            <p className="text-sm font-medium text-foreground">No profile suggestions yet</p>
            <p className="text-xs text-muted-foreground max-w-sm mx-auto">
              Run the pre-fill pipeline to automatically extract {isOrg ? 'ORG' : 'NP'} profile fields from documents, outreach responses, and OSINT — each with a source and confidence score.
            </p>
          </div>
        )}

        {/* Pipeline running indicator */}
        {pipelineRunning && (
          <div className="bg-purple-50 border border-purple-200 rounded-xl py-10 text-center space-y-3">
            <div className="relative inline-block">
              <div className="w-12 h-12 rounded-full bg-purple-100 animate-ping absolute inset-0 opacity-40" />
              <div className="w-12 h-12 rounded-full bg-purple-100 border border-purple-300 flex items-center justify-center relative">
                <Sparkles className="w-5 h-5 text-purple-600 animate-pulse" />
              </div>
            </div>
            <div>
              <p className="text-sm font-medium text-purple-800">Pipeline running…</p>
              <p className="text-xs text-purple-600 mt-0.5">OCR'ing documents · reading outreach · running OSINT</p>
            </div>
          </div>
        )}

        {/* Structured Field Grid */}
        {suggestions && !pipelineRunning && (
          <div className="space-y-5">
            {/* Client fields */}
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center gap-2">
                {isOrg ? <Building2 className="w-4 h-4 text-blue-600" /> : <User className="w-4 h-4 text-violet-600" />}
                <span className="font-semibold text-sm">{isOrg ? 'Entity Profile Fields' : 'Personal Profile Fields'}</span>
                <span className="text-xs text-muted-foreground ml-auto">{confirmed}/{fieldKeys.length} confirmed</span>
              </div>
              <div className="p-4 grid grid-cols-1 gap-2.5">
                {fieldKeys.map(key => (
                  <ProfileFieldRow
                    key={key}
                    fieldKey={key}
                    label={fieldLabels[key]}
                    suggestion={clientFields[key] || null}
                    currentValue={getNestedValue(client, key) || ''}
                    onAccept={acceptField}
                    onReject={rejectField}
                    onManualEdit={handleManualEdit}
                    accepting={acceptingField === key}
                  />
                ))}
              </div>
            </div>

            {/* Related Parties */}
            {isOrg && (
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center gap-2">
                  <User className="w-4 h-4 text-blue-600" />
                  <span className="font-semibold text-sm">Related Party Suggestions</span>
                  <span className="text-xs text-muted-foreground">(from incorporation docs)</span>
                  <span className="text-xs text-muted-foreground ml-auto">
                    {(suggestions.related_parties || []).filter(r => r.status === 'confirmed').length}/{(suggestions.related_parties || []).length} confirmed
                  </span>
                </div>
                <div className="p-4 space-y-2.5">
                  {!suggestions.related_parties?.length ? (
                    <div className="text-sm text-muted-foreground py-4 text-center">
                      No related parties extracted from documents.<br />
                      <span className="text-xs">Directors, UBOs, and shareholders will appear here if found in incorporation docs.</span>
                    </div>
                  ) : (
                    suggestions.related_parties.map((rp, i) => (
                      <RelatedPartySuggestionRow
                        key={i}
                        rp={rp}
                        rpIndex={i}
                        onAccept={acceptRelatedParty}
                        onReject={rejectRelatedParty}
                        accepting={false}
                      />
                    ))
                  )}
                </div>
              </div>
            )}

            {/* Conflicts notice */}
            {conflicts > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
                <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-red-800">{conflicts} field conflict{conflicts > 1 ? 's' : ''} detected</p>
                  <p className="text-xs text-red-600 mt-0.5">
                    These fields have contradictory values across sources. Review each conflict manually and accept the correct value, or enter the correct value directly.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
/**
 * ClientProfileStep — Step 4
 * Sections:
 *   1A  Purpose & Nature of Business Relationship (unchanged)
 *   1B  Expected Transaction Behaviour (unchanged)
 *   2   Verified Profile Summary (read-only) — editing happens in Step 1 Profile Verification
 */
import React, { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { useAutoSave } from '@/hooks/useAutoSave';
import AutoSaveIndicator from '@/components/shared/AutoSaveIndicator';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Sparkles, Loader2, User, Building2, AlertTriangle,
  ChevronDown, ChevronUp, X, Pencil, FileText, Globe, MessageSquare
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { getNestedValue } from '@/lib/clientNameUtils';
import { NP_FIELD_LABELS, ORG_FIELD_LABELS } from '@/hooks/useProfileSuggestions';

const TX_TYPES = ['Payments', 'Investments', 'Transfers', 'FX', 'Other'];
const TX_FREQUENCIES = ['Daily', 'Weekly', 'Monthly', 'Quarterly', 'Annually', 'Ad hoc'];
const TX_VOLUMES = ['< €10k/year', '€10k–€100k/year', '€100k–€1M/year', '€1M–€10M/year', '> €10M/year'];
const GEOGRAPHIES = ['Domestic only', 'EU/EEA', 'UK', 'USA/Canada', 'Asia Pacific', 'Middle East', 'Africa', 'Latin America', 'Other'];

const SOURCE_ICONS = { document: FileText, outreach: MessageSquare, osint: Globe };
const SOURCE_COLORS = {
  document: 'bg-blue-100 text-blue-700 border-blue-200',
  outreach: 'bg-violet-100 text-violet-700 border-violet-200',
  osint:    'bg-emerald-100 text-emerald-700 border-emerald-200',
};

function SourceBadge({ source_type, source_ref }) {
  if (!source_type) return null;
  const Icon = SOURCE_ICONS[source_type] || Globe;
  const colorClass = SOURCE_COLORS[source_type] || 'bg-slate-100 text-slate-600';
  const parts = source_ref?.split('::') || [];
  const label = source_type === 'document' ? (parts[1] || 'Document')
    : source_type === 'osint' ? (parts[0] || 'OSINT')
    : (source_ref || 'Outreach');
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded border font-medium max-w-[140px] truncate', colorClass)}>
      <Icon className="w-2.5 h-2.5 flex-shrink-0" />
      <span className="truncate">{label}</span>
    </span>
  );
}

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

export default function ClientProfileStep({ kycCase, client, currentUser, onRegisterOsintAdd, onNavigateToStep }) {
  const isOrg = client?.client_type === 'ORG';
  const fieldLabels = isOrg ? ORG_FIELD_LABELS : NP_FIELD_LABELS;

  // ── Section 1A ───────────────────────────────────────────────────────────────
  const [purposeText, setPurposeText]           = useState('');
  const [generatingPurpose, setGeneratingPurpose] = useState(false);

  // ── Section 1B ───────────────────────────────────────────────────────────────
  const [txExpanded, setTxExpanded] = useState(false);
  const [txBehavior, setTxBehavior] = useState({ types: [], frequency: '', counterparties: '', geographies: [], volumes: '' });

  // ── Section 2 — verified profile summary (read-only; editing happens in Step 1) ──
  const [suggestions, setSuggestions] = useState(null); // full profile_suggestions object

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

  // ── Computed stats (read-only summary) ───────────────────────────────────────
  const clientFields = suggestions?.client_fields || {};
  const fieldKeys = Object.keys(fieldLabels);
  const confirmedKeys = fieldKeys.filter(k => clientFields[k]?.status === 'confirmed');

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

      {/* ─── SECTION 2 — Verified Profile Summary (read-only) ─── */}
      <div className="border-t border-border pt-5 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h4 className="font-semibold text-sm">2 — Verified Profile Summary</h4>
            <p className="text-xs text-muted-foreground mt-0.5">
              Fields confirmed in Step 1 — Profile Verification. All editing happens there.
            </p>
          </div>
          <button
            className="flex items-center gap-1 text-xs text-primary hover:underline flex-shrink-0"
            onClick={() => onNavigateToStep?.(1)}
          >
            <Pencil className="w-3 h-3" /> Go to Profile Verification
          </button>
        </div>

        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center gap-2">
            {isOrg ? <Building2 className="w-4 h-4 text-blue-600" /> : <User className="w-4 h-4 text-violet-600" />}
            <span className="font-semibold text-sm">{isOrg ? 'Entity Profile Fields' : 'Personal Profile Fields'}</span>
            <span className="text-xs text-muted-foreground ml-auto">{confirmedKeys.length}/{fieldKeys.length} confirmed</span>
          </div>
          {!suggestions ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No profile fields verified yet.<br />
              <span className="text-xs">Run the pipeline in Step 1 — Profile Verification to get started.</span>
            </div>
          ) : confirmedKeys.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No fields confirmed yet. Accept fields in Step 1 — Profile Verification.
            </div>
          ) : (
            <div className="divide-y divide-border/50">
              {confirmedKeys.map(key => {
                const s = clientFields[key];
                return (
                  <div key={key} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">{fieldLabels[key]}</div>
                      <div className="text-sm font-medium text-foreground truncate">{getNestedValue(client, key) || s.value}</div>
                    </div>
                    <SourceBadge source_type={s.source_type} source_ref={s.source_ref} />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
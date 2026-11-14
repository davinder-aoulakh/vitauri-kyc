/**
 * ClientProfileStep — Step 4
 * Sections:
 *   1A  Purpose & Nature of Business Relationship (unchanged)
 *   1B  Expected Transaction Behaviour (unchanged)
 *   2   Verified Profile Summary (read-only) — editing happens in Step 1 Profile Verification
 */
import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
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
import InlineError from '@/components/shared/InlineError';
import { useAiOrchestrator } from '@/hooks/useAiOrchestrator';
import ExpectedProfileEditor from '@/components/case/tm/ExpectedProfileEditor';
import { EXPECTED_USE } from '@/lib/profileFieldMap';
import { countryByName } from '@/lib/countries';
import { collectExpectedUse, mergeExpectedUse, showAnswer } from '@/lib/expectedUseFromOutreach';
import { loadSelected, patchSelected, onSelectedChange, removeSelected, stripPastedLine, selectedForPrompt, selectedFromCache, pastedLine } from '@/lib/osintSelected';

const DRAFT_TIMEOUT_MS = 60000;
const OUTREACH_FETCH_TIMEOUT_MS = 3000;

// One list of options for the screen and for the linked outreach questions
const TX_TYPES = EXPECTED_USE.types;
const TX_FREQUENCIES = EXPECTED_USE.frequency;
const TX_VOLUMES = EXPECTED_USE.volumes;
const GEOGRAPHIES = EXPECTED_USE.geographies;
const USE_LABELS = { types: 'Transaction Types', frequency: 'Frequency', volumes: 'Expected Volumes', inbound_month: 'Incoming per month', outbound_month: 'Outgoing per month', counterparties: 'Expected Counterparties', geographies: 'Geographies', cash: 'Cash use' };

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
  const purposeRef = useRef(null);
  // Grow the purpose box with its text (typing, AI draft, load); CSS caps it at 70vh, after which it scrolls.
  useLayoutEffect(() => {
    const el = purposeRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [purposeText]);
  const [generatingPurpose, setGeneratingPurpose] = useState(false);
  const [purposeError, setPurposeError]         = useState(null);
  const [draftStage, setDraftStage]             = useState('drafting'); // 'gathering' | 'drafting'
  // OSINT findings the analyst added (stored on the case): shown under the box and given to the AI rewrite
  const [osintSelected, setOsintSelected]       = useState(() => selectedFromCache(kycCase?.osint_cache));
  const [previousText, setPreviousText]         = useState(null);     // text before the last AI rewrite (for Restore)
  useEffect(() => {
    if (!kycCase?.id) return undefined;
    let alive = true;
    loadSelected(kycCase.id).then((l) => { if (alive) setOsintSelected(l); }).catch(() => {});
    const off = onSelectedChange((caseId, l) => { if (caseId === kycCase.id) setOsintSelected(l); });
    return () => { alive = false; off(); };
  }, [kycCase?.id]);

  async function removeOsintFinding(s) {
    setPurposeText((t) => stripPastedLine(t, s));
    try {
      await patchSelected(kycCase.id, (list) => removeSelected(list, s.key));
      await base44.entities.AuditEvent.create({
        tenant_id: kycCase.tenant_id, case_id: kycCase.id, client_id: kycCase.client_id,
        actor_user_id: currentUser?.id, actor_name: currentUser?.full_name, actor_type: 'User',
        event_type: 'osint_finding_removed', before_state: { title: s.title, source_url: s.source_url || null }, after_state: {},
        notes: `OSINT finding removed from the profile: ${s.title}`,
      });
    } catch (e) { console.warn('OSINT selection not saved', e?.message); }
  }

  const { invoke: invokePurposeDraft, cancel: cancelPurposeDraft } = useAiOrchestrator({
    caseId: kycCase?.id,
    tenantId: client?.tenant_id,
    currentUser,
  });

  // ── Section 1B ───────────────────────────────────────────────────────────────
  const [txExpanded, setTxExpanded] = useState(true);
  // The client's own answers about the expected use (outreach questions linked to expected_use.*)
  const [useAnswers, setUseAnswers] = useState({ values: {}, at: null });
  const [useFilled, setUseFilled] = useState([]);
  const [txBehavior, setTxBehavior] = useState({ types: [], frequency: '', counterparties: '', geographies: [], volumes: '' });

  // ── Section 2 — verified profile summary (read-only; editing happens in Step 1) ──
  const [suggestions, setSuggestions] = useState(null); // full profile_suggestions object
  const useDiffering = mergeExpectedUse(txBehavior, useAnswers.values).differing;

  const loaded = useRef(false);

  // Load saved data on mount
  useEffect(() => {
    if (kycCase?.purpose_nature_text) setPurposeText(kycCase.purpose_nature_text);
    if (kycCase?.expected_transaction_behavior) {
      try { setTxBehavior(JSON.parse(kycCase.expected_transaction_behavior)); } catch {}
    }
    if (kycCase?.profile_suggestions) setSuggestions(kycCase.profile_suggestions);
    loaded.current = true;

    // Answers the client gave in the outreach land here: empty fields are filled, the analyst's entries are kept
    let alive = true;
    base44.entities.OutreachRequest.filter({ case_id: kycCase.id }).then((reqs) => {
      if (!alive) return;
      const found = collectExpectedUse(reqs || []);
      if (!Object.keys(found.values).length) return;
      setUseAnswers(found);
      let saved = {};
      try { saved = JSON.parse(kycCase?.expected_transaction_behavior || '{}') || {}; } catch { saved = {}; }
      const { filled } = mergeExpectedUse(saved, found.values);
      if (!filled.length) return;
      setTxBehavior((cur) => mergeExpectedUse(cur, found.values).next);
      setUseFilled(filled);
      base44.entities.AuditEvent.create({
        tenant_id: kycCase.tenant_id, case_id: kycCase.id, client_id: kycCase.client_id,
        actor_user_id: currentUser?.id, actor_name: currentUser?.full_name, actor_type: 'System',
        event_type: 'expected_use_prefilled_from_outreach', before_state: {}, after_state: { fields: filled },
        notes: `Expected use filled from the client's outreach answers: ${filled.join(', ')}`,
      }).catch(() => {});
    }).catch(() => {});
    return () => { alive = false; };
  }, [kycCase?.id]);

  // Register OSINT add callback (Section 1A purpose text append)
  useEffect(() => {
    if (onRegisterOsintAdd) {
      onRegisterOsintAdd((finding) => {
        setPurposeText(d => `${d}\n\n${pastedLine(finding)}`);
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
    setPurposeError(null);
    setDraftStage('gathering');
    const textBefore = purposeText || '';
    // Latest stored selection (a finding may have been added seconds ago)
    const osintForDraft = await loadSelected(kycCase.id).catch(() => osintSelected);
    const stageTimer = setTimeout(() => setDraftStage('drafting'), 1000);

    try {
      // Best-effort outreach context — never blocks the draft call
      const outreachPromise = base44.entities.OutreachRequest.filter({ case_id: kycCase.id })
        .then(outreachData => outreachData?.map(o =>
          o.items?.map(i => `${i.label}: ${i.response_text || 'pending'}`).join('; ')
        ).join('\n') || null)
        .catch(() => null);
      const outreachTimeout = new Promise(resolve => setTimeout(() => resolve(null), OUTREACH_FETCH_TIMEOUT_MS));
      const outreachSummary = await Promise.race([outreachPromise, outreachTimeout]);

      const confirmedFieldsSummary = confirmedKeys.length > 0
        ? confirmedKeys.map(k => `${fieldLabels[k]}: ${getNestedValue(client, k) || clientFields[k]?.value}`).join('; ')
        : undefined;

      // Race only the LLM call against the deadline. The DB persist runs
      // AFTER the race resolves — a slow entity-throttle queue should never
      // eat into the AI generation budget, and the debounced autosave is a
      // backstop if the user navigates away before the persist completes.
      const result = await Promise.race([
        invokePurposeDraft('PurposeDraft', {
          client, caseType: kycCase?.case_type, outreachSummary: outreachSummary || undefined, confirmedFieldsSummary,
          // Bring it together: the findings the analyst added and the text already in the box
          osintFindings: selectedForPrompt(osintForDraft) || undefined,
          currentText: textBefore.trim() || undefined,
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('AI draft timed out — please try again.')), DRAFT_TIMEOUT_MS)),
      ]);

      if (!result) throw new Error('Failed to generate draft. Please try again.');
      const draftText = result?.statement || '';
      if (!draftText.trim()) throw new Error('The AI returned an empty draft. Your text was left unchanged.');
      if (textBefore.trim() && textBefore.trim() !== draftText.trim()) setPreviousText(textBefore);
      setPurposeText(draftText);
      if (kycCase?.id) {
        base44.entities.KycCase.update(kycCase.id, { purpose_nature_text: draftText })
          .catch(err => console.error('Failed to persist AI draft:', err));
      }
    } catch (err) {
      console.error('generatePurposeDraft error:', err);
      setPurposeError(err?.message || 'Failed to generate draft. Please try again.');
      // The invoke() call may still resolve later — tell the hook to ignore it.
      cancelPurposeDraft?.();
    } finally {
      clearTimeout(stageTimer);
      setGeneratingPurpose(false);
    }
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
            onClick={generatePurposeDraft} disabled={generatingPurpose}
            title={purposeText.trim() || osintSelected.length ? `Rewrites the statement from the file, your current text${osintSelected.length ? ` and ${osintSelected.length} added OSINT finding${osintSelected.length === 1 ? '' : 's'}` : ''}` : 'Drafts the statement from the file'}>
            {generatingPurpose ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            {generatingPurpose ? (draftStage === 'gathering' ? 'Gathering context…' : 'Drafting…') : (purposeText.trim() || osintSelected.length ? 'AI Rewrite' : 'AI Draft')}
          </Button>
        </div>
        <Textarea
          ref={purposeRef}
          value={purposeText}
          onChange={e => { setPurposeText(e.target.value); }}
          placeholder={`Describe the nature of the client relationship, intended products/services…`}
          className={cn('text-sm leading-relaxed min-h-56 max-h-[70vh] overflow-y-auto resize-y', !purposeText && 'border-amber-300 focus:ring-amber-400')}
        />
        {!purposeText && !purposeError && (
          <div className="flex items-center gap-1.5 text-xs text-amber-600">
            <AlertTriangle className="w-3 h-3" />
            This field is required to complete this step.
          </div>
        )}
        {purposeError && (
          <InlineError message={purposeError} onRetry={generatePurposeDraft} />
        )}
        {previousText != null && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-purple-200 bg-purple-50 px-3 py-1.5 text-xs text-purple-900">
            <Sparkles className="h-3 w-3" /> Rewritten by AI — check it before you continue.
            <button type="button" className="ml-auto font-medium underline" onClick={() => { setPurposeText(previousText); setPreviousText(null); }}>Restore previous text</button>
            <button type="button" className="text-purple-700/70 hover:text-purple-900" onClick={() => setPreviousText(null)}>Dismiss</button>
          </div>
        )}
        {osintSelected.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-xs font-medium text-muted-foreground">OSINT findings in this profile ({osintSelected.length}) — included in the next AI rewrite</div>
            <div className="flex flex-wrap gap-1.5">
              {osintSelected.map((s) => (
                <span key={s.key} className={cn('inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs', s.is_adverse ? 'border-red-200 bg-red-50 text-red-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800')} title={s.summary}>
                  <Globe className="h-3 w-3 flex-shrink-0" />
                  {s.source_url
                    ? <a href={s.source_url} target="_blank" rel="noopener noreferrer" className="truncate max-w-[22rem] hover:underline">{s.title}</a>
                    : <span className="truncate max-w-[22rem]">{s.title}</span>}
                  {s.source_type && <span className="opacity-60">· {s.source_type}</span>}
                  <button type="button" aria-label={`Remove ${s.title}`} className="opacity-60 hover:opacity-100" onClick={() => removeOsintFinding(s)}>×</button>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ─── SECTION 1B — Expected use of the account: what the client expects + the limits monitoring tests (was 1B and 1C) ─── */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <button className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-muted/20 transition-colors"
          onClick={() => setTxExpanded(o => !o)}>
          <div>
            <span className="font-semibold text-sm">1B — Expected use of the account</span>
            <span className="text-xs text-muted-foreground ml-2">expected transactions and the profile transaction monitoring tests against</span>
          </div>
          {txExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </button>
        {txExpanded && (
          <>
          <div className="px-4 pb-4 space-y-4 border-t border-border">
            {useAnswers.at && (
              <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900 space-y-1">
                <div className="flex items-center gap-1.5 font-medium">
                  <MessageSquare className="h-3.5 w-3.5" /> Answered by the client in the outreach{useAnswers.at ? ` (${new Date(useAnswers.at).toLocaleDateString()})` : ''}
                  {useFilled.length > 0 && <span className="font-normal">· {useFilled.length} field{useFilled.length === 1 ? '' : 's'} filled from the answers</span>}
                </div>
                {useDiffering.map((k) => (
                  <div key={k} className="flex flex-wrap items-center gap-1.5">
                    <span>Client answered for “{USE_LABELS[k]}”: <b>{showAnswer(useAnswers.values[k])}</b></span>
                    <button type="button" className="font-medium underline" onClick={() => setTxBehavior(s => ({ ...s, [k]: useAnswers.values[k] }))}>Apply</button>
                  </div>
                ))}
              </div>
            )}
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
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-xs mb-1.5 block">Incoming per month (optional)</Label>
                <input inputMode="decimal" value={txBehavior.inbound_month || ''} placeholder="Amount"
                  onChange={e => setTxBehavior(s => ({ ...s, inbound_month: e.target.value.replace(/[^\d.]/g, '') }))}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" aria-label="Expected incoming per month" />
              </div>
              <div>
                <Label className="text-xs mb-1.5 block">Outgoing per month (optional)</Label>
                <input inputMode="decimal" value={txBehavior.outbound_month || ''} placeholder="Amount"
                  onChange={e => setTxBehavior(s => ({ ...s, outbound_month: e.target.value.replace(/[^\d.]/g, '') }))}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" aria-label="Expected outgoing per month" />
              </div>
              <div>
                <Label className="text-xs mb-1.5 block">Cash use</Label>
                <Select value={txBehavior.cash || ''} onValueChange={v => setTxBehavior(s => ({ ...s, cash: v }))}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select…" /></SelectTrigger>
                  <SelectContent>{EXPECTED_USE.cash.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent>
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
          {/* Monitoring limits (only when transaction monitoring is on for the tenant) */}
          <ExpectedProfileEditor embedded kycCase={kycCase} client={client} behavior={txBehavior}
            homeCountry={countryByName(client?.registered_country || client?.country_of_residence || client?.nationality)?.iso2 || ''}
            readOnly={['Approved', 'Rejected', 'Closed'].includes(kycCase?.status)} />
          </>
        )}
      </div>

      {/* ─── SECTION 2 — Verified Profile Summary (read-only) ─── */}
      <div className="border-t border-border pt-5 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h4 className="font-semibold text-sm">2 — Verified Profile Summary</h4>
            <p className="text-xs text-muted-foreground mt-0.5">
              Fields confirmed in the Profile Verification panel (Outreach & Documents step). All editing happens there.
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
              <span className="text-xs">Run the pipeline in the Profile Verification step to get started.</span>
            </div>
          ) : confirmedKeys.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No fields confirmed yet. Accept fields in the Profile Verification step.
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
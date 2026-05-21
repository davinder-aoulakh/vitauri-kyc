import React, { useState, useEffect, useCallback } from 'react';
import { useAutoSave } from '@/hooks/useAutoSave';
import AutoSaveIndicator from '@/components/shared/AutoSaveIndicator';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Sparkles, CheckCircle, Loader2, Paperclip,
  RefreshCw, Link2, ToggleLeft, ToggleRight, X, Eye
} from 'lucide-react';
import DocumentViewer from '@/components/shared/DocumentViewer';
import { cn } from '@/lib/utils';

const SOF_SOURCES_NP  = ['Salary / Employment Income','Business Income / Dividends','Sale of Property','Inheritance','Investment Returns','Pension','Loan / Credit Facility','Gift','Other'];
const SOF_SOURCES_ORG = ['Trading / Operating Revenue','Investment Income','Dividend Income','Loan / Debt Facility','Capital Raise / Equity','Asset Sale Proceeds','Other'];
const SOW_SOURCES_NP  = ['Lifetime Savings','Business Ownership / Sale','Inheritance / Gift','Property Portfolio','Investment Portfolio','Pension / Retirement Funds','Compensation / Settlement','Other'];
const ADEQUACY_LEVELS = ['Fully Adequate','Mostly Adequate','Partially Adequate','Inadequate','Unable to Assess'];

function SourceMultiSelect({ sources, selected, onChange }) {
  const [otherText, setOtherText] = useState('');
  const hasOther = selected.includes('Other');

  function toggle(src) {
    if (selected.includes(src)) {
      onChange(selected.filter(s => s !== src));
    } else {
      onChange([...selected, src]);
    }
  }

  function handleOtherText(val) {
    setOtherText(val);
    // store as "Other: <text>" in the array, replacing any previous "Other:…"
    const without = selected.filter(s => !s.startsWith('Other'));
    if (val.trim()) {
      onChange([...without, `Other: ${val.trim()}`]);
    } else {
      onChange([...without, 'Other']);
    }
  }

  return (
    <div className="space-y-2">
      {/* Selected chips */}
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
      {/* Checkbox list */}
      <div className="grid grid-cols-1 gap-1 border border-border rounded-lg p-2 bg-muted/20 max-h-48 overflow-y-auto">
        {sources.map(src => {
          const isOtherOption = src === 'Other';
          const isChecked = isOtherOption ? selected.some(s => s === 'Other' || s.startsWith('Other:')) : selected.includes(src);
          return (
            <label key={src} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted/50 cursor-pointer text-xs">
              <input
                type="checkbox"
                checked={isChecked}
                onChange={() => toggle(src)}
                className="rounded border-border accent-primary"
              />
              <span className={cn('flex-1', isChecked && 'font-medium text-foreground')}>{src}</span>
            </label>
          );
        })}
      </div>
      {/* Other free text */}
      {hasOther && (
        <input
          type="text"
          value={otherText}
          onChange={e => handleOtherText(e.target.value)}
          placeholder="Specify other source…"
          className="w-full text-sm border border-border rounded-md px-3 py-1.5 bg-transparent focus:outline-none focus:ring-1 focus:ring-ring"
        />
      )}
    </div>
  );
}

function SectionCard({ title, state, setState, sources }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 space-y-3">
      <h4 className="font-medium text-sm">{title}</h4>
      <div className="space-y-3">
        <div>
          <Label className="text-xs mb-1.5 block">Sources (select all that apply)</Label>
          <SourceMultiSelect
            sources={sources}
            selected={state.sources || []}
            onChange={v => setState(s => ({ ...s, sources: v }))}
          />
        </div>
        <div>
          <Label className="text-xs mb-1.5 block">Explanation / Details</Label>
          <Textarea
            value={state.explanation}
            onChange={e => setState(s => ({ ...s, explanation: e.target.value }))}
            className="text-sm min-h-16 resize-none"
            placeholder="Describe the source in detail, including amounts where known…"
          />
        </div>
        <div>
          <Label className="text-xs mb-1.5 block">Adequacy Assessment</Label>
          <Select value={state.adequacy} onValueChange={v => setState(s => ({ ...s, adequacy: v }))}>
            <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select…" /></SelectTrigger>
            <SelectContent>{ADEQUACY_LEVELS.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}

export default function SoFSoWStep({ kycCase, client, currentUser }) {
  const isNP = client?.client_type === 'NP';

  const [sof, setSof] = useState({ sources: [], explanation: '', adequacy: '' });
  const [sow, setSow] = useState({ sources: [], explanation: '', adequacy: '' });

  const [narrative, setNarrative] = useState('');
  const [generating, setGenerating] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [acceptedBy, setAcceptedBy] = useState(null);
  const [overrideMode, setOverrideMode] = useState(false);
  const [overrideJustification, setOverrideJustification] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Auto-save sof, sow, narrative and evidence to KycCase as JSON fields
  const { autoSaving, lastSaved } = useAutoSave(
    { sof, sow, narrative, evidence },
    async (data) => {
      if (!kycCase?.id) return;
      await base44.entities.KycCase.update(kycCase.id, {
        sof_narrative: JSON.stringify({ sof: data.sof, sow: data.sow, narrative: data.narrative, evidence: data.evidence }),
      });
    },
    1500,
  );

  // Documents for evidence linking
  const [documents, setDocuments] = useState([]);
  const [evidence, setEvidence] = useState([]); // [{ doc_id, doc_name, claim, verified }]
  const [evidencePickerOpen, setEvidencePickerOpen] = useState(false);
  const [pendingClaim, setPendingClaim] = useState('');
  const [viewerDoc, setViewerDoc] = useState(null);

  useEffect(() => {
    if (kycCase?.client_id) {
      base44.entities.Document.filter({ client_id: kycCase.client_id }).then(d => setDocuments(d || []));
    }
  }, [kycCase?.client_id]);

  async function generateNarrative() {
    setGenerating(true);
    setAccepted(false);

    const [outreachData] = await Promise.all([
      base44.entities.OutreachRequest.filter({ case_id: kycCase.id }),
    ]);

    const outreachSoF = outreachData?.flatMap(o =>
      (o.items || []).filter(i => i.label?.toLowerCase().includes('fund') || i.label?.toLowerCase().includes('wealth') || i.label?.toLowerCase().includes('income'))
        .map(i => `${i.label}: ${i.response_text || 'no response'}`)
    ).join('\n') || 'No outreach responses for SoF/SoW';

    const docList = documents.map(d => `${d.doc_type}: ${d.file_name}`).join('\n') || 'No documents uploaded';
    const evidenceList = evidence.map(e => `${e.claim} — supported by: ${e.doc_name} (${e.verified ? 'Verified' : 'Unverified'})`).join('\n') || '';

    const result = await base44.integrations.Core.InvokeLLM({
      prompt: `You are a senior KYC analyst at a regulated financial institution.

CLIENT: ${client?.full_name} (${client?.client_type})
${isNP ? `
SOURCE OF FUNDS: ${(sof.sources || []).join(', ') || 'Not specified'}
SoF Details: ${sof.explanation || 'None provided'}
SoF Adequacy: ${sof.adequacy || 'Not assessed'}

SOURCE OF WEALTH: ${(sow.sources || []).join(', ') || 'Not specified'}
SoW Details: ${sow.explanation || 'None provided'}
SoW Adequacy: ${sow.adequacy || 'Not assessed'}
` : `
SOURCE OF FUNDS (Organisation): ${(sof.sources || []).join(', ') || 'Not specified'}
Revenue/Funding Details: ${sof.explanation || 'None provided'}
Adequacy: ${sof.adequacy || 'Not assessed'}
`}

DOCUMENTS ON FILE:
${docList}

OUTREACH RESPONSES (SoF/SoW related):
${outreachSoF}

${evidenceList ? `EVIDENCE LINKED:\n${evidenceList}` : ''}

Draft a professional, regulatory-grade Source of Funds${isNP ? ' and Source of Wealth' : ''} assessment. Cover:
1. Primary funding sources and their origin
2. Plausibility and consistency with client profile
3. Adequacy of documentary evidence
4. Gaps in evidence or areas requiring further clarification
5. Risk observation / conclusion

Write in factual, neutral, third-person tone. 3–6 paragraphs.`,
      model: 'claude_sonnet_4_6',
    });

    setNarrative(typeof result === 'string' ? result : result?.narrative || result?.assessment || JSON.stringify(result));
    setGenerating(false);
  }

  function addEvidence(doc, claim) {
    setEvidence(e => [...e, { doc_id: doc.id, doc_name: `${doc.doc_type}: ${doc.file_name}`, claim, verified: false }]);
    setEvidencePickerOpen(false);
    setPendingClaim('');
  }

  function toggleVerified(idx) {
    setEvidence(e => e.map((item, i) => i === idx ? { ...item, verified: !item.verified } : item));
  }

  function removeEvidence(idx) {
    setEvidence(e => e.filter((_, i) => i !== idx));
  }

  async function acceptNarrative(mode) {
    setSaving(true);
    setAcceptedBy(mode);
    setAccepted(true);

    await base44.entities.AuditEvent.create({
      tenant_id: kycCase.tenant_id,
      case_id: kycCase.id,
      client_id: kycCase.client_id,
      actor_user_id: currentUser?.id,
      actor_name: currentUser?.full_name,
      actor_type: 'User',
      event_type: mode === 'accept' ? 'sof_sow_accepted' : 'sof_sow_edited_accepted',
      notes: `SoF/SoW assessment ${mode === 'accept' ? 'accepted as-is' : 'edited and accepted'}. SoF: ${(sof.sources || []).join(', ')} (${sof.adequacy}) | ${isNP ? `SoW: ${(sow.sources || []).join(', ')} (${sow.adequacy})` : ''}. Evidence items: ${evidence.length}.`,
    });

    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  async function handleOverride() {
    if (overrideJustification.length < 20) return;
    setSaving(true);
    await base44.entities.AuditEvent.create({
      tenant_id: kycCase.tenant_id,
      case_id: kycCase.id,
      client_id: kycCase.client_id,
      actor_user_id: currentUser?.id,
      actor_name: currentUser?.full_name,
      actor_type: 'User',
      event_type: 'sof_sow_overridden',
      notes: overrideJustification,
      is_override: true,
    });
    setAccepted(true);
    setAcceptedBy('override');
    setOverrideMode(false);
    setSaving(false);
    setSaved(true);
  }

  const handleSetSof = useCallback(setSof, []);
  const handleSetSow = useCallback(setSow, []);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-3">
            <h3 className="font-semibold text-sm text-foreground">Source of Funds / Source of Wealth</h3>
            <AutoSaveIndicator autoSaving={autoSaving} lastSaved={lastSaved} />
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">Document and assess the client's sources of funds{isNP ? ' and wealth' : ''}</p>
        </div>
        <Button
          size="sm"
          className="gap-1.5 text-xs bg-purple-600 hover:bg-purple-700 text-white"
          onClick={generateNarrative}
          disabled={generating}
        >
          {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
          {generating ? 'Generating…' : 'Draft SoF/SoW Assessment'}
        </Button>
      </div>

      {/* Source Cards */}
      <SectionCard title="Source of Funds (SoF)" state={sof} setState={handleSetSof} sources={isNP ? SOF_SOURCES_NP : SOF_SOURCES_ORG} />
      {isNP && <SectionCard title="Source of Wealth (SoW)" state={sow} setState={handleSetSow} sources={SOW_SOURCES_NP} />}

      {/* Evidence Linker */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="font-medium text-sm flex items-center gap-1.5">
            <Link2 className="w-4 h-4 text-muted-foreground" />
            Evidence Documents
          </h4>
          <Button
            size="sm" variant="outline" className="text-xs gap-1.5 h-7"
            onClick={() => setEvidencePickerOpen(true)}
            disabled={documents.length === 0}
          >
            <Paperclip className="w-3 h-3" /> Link Document
          </Button>
        </div>

        {documents.length === 0 && (
          <p className="text-xs text-muted-foreground italic">No documents uploaded for this client yet.</p>
        )}

        {evidence.length > 0 ? (
          <div className="space-y-2">
            {evidence.map((e, i) => (
              <div key={i} className="flex items-start gap-3 text-xs border border-border rounded-lg p-2.5 bg-muted/20">
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-foreground truncate">{e.doc_name}</div>
                  {e.claim && <div className="text-muted-foreground mt-0.5 italic">"{e.claim}"</div>}
                </div>
                <button
                  onClick={() => toggleVerified(i)}
                  className={cn('flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium flex-shrink-0 transition-colors',
                    e.verified ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600 hover:bg-emerald-50 hover:text-emerald-600'
                  )}
                >
                  {e.verified ? <ToggleRight className="w-3.5 h-3.5" /> : <ToggleLeft className="w-3.5 h-3.5" />}
                  {e.verified ? 'Verified' : 'Unverified'}
                </button>
                <button onClick={() => removeEvidence(i)} className="text-muted-foreground hover:text-red-500 flex-shrink-0">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground italic">No evidence linked yet. Link documents to support each SoF/SoW claim.</p>
        )}
      </div>

      {/* AI Narrative */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="font-medium text-sm">SoF/SoW Assessment Narrative</h4>
          {accepted && (
            <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium',
              acceptedBy === 'override' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
            )}>
              {acceptedBy === 'override' ? '⚠ Override' : '✓ Accepted'}
            </span>
          )}
        </div>
        <Textarea
          value={narrative}
          onChange={e => { setNarrative(e.target.value); setAccepted(false); }}
          placeholder="Click 'Draft SoF/SoW Assessment' or enter narrative manually…"
          className="text-sm min-h-48 resize-y leading-relaxed"
        />
        <div className="text-xs text-muted-foreground">{narrative.length} characters</div>

        {narrative && !accepted && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => acceptNarrative('accept')} disabled={saving}>
              <CheckCircle className="w-3.5 h-3.5" /> Accept Assessment
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => acceptNarrative('edit')} disabled={saving}>
              Edit & Accept
            </Button>
            <Button size="sm" variant="ghost" className="gap-1.5" onClick={generateNarrative} disabled={generating}>
              <RefreshCw className="w-3.5 h-3.5" /> Regenerate
            </Button>
            <Button size="sm" variant="ghost" className="gap-1.5 text-amber-600 hover:bg-amber-50" onClick={() => setOverrideMode(true)}>
              Override
            </Button>
          </div>
        )}

        {accepted && (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="text-xs" onClick={() => setAccepted(false)}>Edit</Button>
            <Button size="sm" variant="ghost" className="text-xs gap-1" onClick={generateNarrative} disabled={generating}>
              <RefreshCw className="w-3 h-3" /> Regenerate
            </Button>
          </div>
        )}

        {saved && <div className="text-xs text-emerald-600 font-medium">✓ Assessment saved</div>}
      </div>

      {/* Evidence Picker Modal */}
      {evidencePickerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-card border border-border rounded-xl p-5 w-[480px] shadow-xl space-y-4 max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm">Link Evidence Document</h3>
              <button onClick={() => setEvidencePickerOpen(false)}><X className="w-4 h-4 text-muted-foreground" /></button>
            </div>
            <div>
              <Label className="text-xs mb-1.5 block">Claim / Note (optional)</Label>
              <Textarea
                value={pendingClaim}
                onChange={e => setPendingClaim(e.target.value)}
                placeholder="E.g. 'Salary slip confirms employment income of €4,200/month'"
                className="text-sm min-h-12 resize-none"
              />
            </div>
            <div className="flex-1 overflow-y-auto space-y-2">
              {documents.map(doc => (
                <div
                  key={doc.id}
                  className="flex items-center gap-2 p-3 rounded-lg border border-border hover:bg-muted/40 transition-colors text-xs"
                >
                  <button
                    className="flex-1 text-left flex items-center gap-3"
                    onClick={() => addEvidence(doc, pendingClaim)}
                  >
                    <Paperclip className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                    <div>
                      <div className="font-medium text-foreground">{doc.doc_type?.replace(/_/g, ' ')}</div>
                      <div className="text-muted-foreground">{doc.file_name}</div>
                    </div>
                  </button>
                  {doc.file_url && (
                    <button
                      className="text-muted-foreground hover:text-primary flex-shrink-0 p-1"
                      onClick={() => setViewerDoc({ url: doc.file_url, name: doc.file_name })}
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {viewerDoc && (
        <DocumentViewer
          fileUrl={viewerDoc.url}
          fileName={viewerDoc.name}
          onClose={() => setViewerDoc(null)}
        />
      )}

      {/* Override Modal */}
      {overrideMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-card border border-border rounded-xl p-5 w-96 shadow-xl space-y-4">
            <h3 className="font-semibold text-sm">Override AI Assessment</h3>
            <p className="text-xs text-muted-foreground">Justification required (min 20 characters). Will be logged as an audit event.</p>
            <Textarea value={overrideJustification} onChange={e => setOverrideJustification(e.target.value)} className="text-sm min-h-16" placeholder="Reason for override…" />
            <div className="text-xs text-muted-foreground">{overrideJustification.length}/20</div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setOverrideMode(false)}>Cancel</Button>
              <Button size="sm" className="bg-amber-600 hover:bg-amber-700 text-white" disabled={overrideJustification.length < 20 || saving} onClick={handleOverride}>
                Confirm Override
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
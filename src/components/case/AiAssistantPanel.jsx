/**
 * AI Assistant Panel — right-rail panel in the Case Workspace.
 * Uses the central AI Orchestrator via useAiOrchestrator hook.
 * Supports: Generate, Edit, Accept, Override (with justification), Reject, Regenerate.
 */
import React, { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { useAiOrchestrator } from '@/hooks/useAiOrchestrator';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Sparkles, Loader2, Check, Pencil, AlertTriangle, X, ChevronRight, XCircle, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import ReactMarkdown from 'react-markdown';

const STEP_CONFIGS = {
  1: { agentType: 'OutreachCopilot',        agentLabel: 'Outreach Co-pilot',       description: 'Recommend documents to request and draft outreach email' },
  2: { agentType: 'IdentityVerificationSummary', agentLabel: 'Identity Summary', description: 'Summarise identity verification findings' },
  3: { agentType: 'ScreeningTriage',         agentLabel: 'Screening Triage',         description: 'Analyse Didit AML hits and recommend analyst decisions' },
  4: { agentType: 'ClientProfile',           agentLabel: 'Client Profile',           description: 'Assess profile completeness and draft narrative' },
  5: { agentType: 'SoFSoW',                 agentLabel: 'SoF / SoW Agent',          description: 'Draft Source of Funds & Wealth assessment' },
  6: { agentType: 'RiskNarrative',           agentLabel: 'Risk Narrative',           description: 'Generate indicator narratives and risk assessment' },
  7: { agentType: 'WorkflowOptimisation',    agentLabel: 'Control Measures',         description: 'Suggest SMART control measures for this risk level' },
  8: { agentType: 'RiskNarrative',           agentLabel: 'Sign-Off Summary',         description: 'Draft executive sign-off summary for approver' },
};

function buildPayload(activeStep, kycCase, client) {
  const base = { client: client || {}, caseType: kycCase?.case_type };
  switch (activeStep) {
    case 1: return { client: client || {}, caseType: kycCase?.case_type, gaps: [] };
    case 3: return { hitData: {}, entityData: { sector: client?.sector, country: client?.registered_country || client?.nationality } };
    case 5: return { client: client || {}, sofStated: '', sowStated: '' };
    case 6: return { client: client || {}, indicatorData: { name: 'Risk Assessment', score: kycCase?.risk_classification || 'Unknown', caseContext: kycCase?.case_notes || '' } };
    default: return { client: client || {} };
  }
}

export default function AiAssistantPanel({ kycCase, client, activeStep, currentUser, collapsed, onToggleCollapse, screeningData, idvData, tenant }) {
  const config = STEP_CONFIGS[activeStep] || STEP_CONFIGS[1];

  const { invoke, logAction, reset, loading, output, error, tokenInfo } = useAiOrchestrator({
    caseId: kycCase?.id,
    tenantId: kycCase?.tenant_id,
    currentUser,
  });

  // Persist accepted outputs and action statuses across step navigation
  const acceptedOutputsRef = useRef({}); // { [step]: { output, actionStatus, editedText } }

  const [editedText, setEditedText]               = useState('');
  const [editing, setEditing]                     = useState(false);
  const [overrideMode, setOverrideMode]           = useState(false);
  const [overrideJustification, setOverrideJust] = useState('');
  const [actionStatus, setActionStatus]           = useState(null);

  // On step change: save current accepted state, restore previous if available
  useEffect(() => {
    // Restore saved state for this step (if previously accepted)
    const saved = acceptedOutputsRef.current[activeStep];
    if (saved) {
      setEditedText(saved.editedText || '');
      setActionStatus(saved.actionStatus || null);
      // Don't call reset — let the output persist via savedOutput below
    } else {
      reset();
      setEditedText('');
      setEditing(false);
      setOverrideMode(false);
      setOverrideJust('');
      setActionStatus(null);
    }
    setEditing(false);
    setOverrideMode(false);
    setOverrideJust('');
  }, [activeStep]);

  // Sync edited text when fresh output arrives
  useEffect(() => {
    if (output) {
      const text = output.narrative || output.email_draft || output.summary || output.answer || JSON.stringify(output, null, 2);
      setEditedText(text);
    }
  }, [output]);

  // Effective output: live output OR previously accepted output for this step
  const effectiveOutput = output || acceptedOutputsRef.current[activeStep]?.output || null;

  async function generate() {
    reset();
    // Clear saved state for this step so we start fresh
    delete acceptedOutputsRef.current[activeStep];
    setEditedText('');
    setEditing(false);
    setOverrideMode(false);
    setActionStatus(null);
    const payload = buildPayload(activeStep, kycCase, client);
    // For step 2, always send client + idvData (idvData may be null if not yet completed)
    if (activeStep === 2) {
      payload.client = client || {};
      payload.idvData = idvData || null;
    }
    // For step 3, fetch AML data directly and enrich payload
    if (activeStep === 3) {
      const clientName = client?.full_name || 'Unknown';
      const clientType = client?.client_type === 'NP' ? 'Natural Person (individual)' : client?.client_type === 'ORG' ? 'Organisation (legal entity)' : 'Unknown';
      const country = client?.registered_country || client?.country_of_residence || client?.nationality || 'Unknown';

      payload.entityData = {
        name: clientName,
        client_type: clientType,
        date_of_birth: client?.date_of_birth || null,
        nationality: client?.nationality || null,
        country_of_residence: client?.country_of_residence || null,
        sector: client?.sector || null,
        registration_number: client?.registration_number || null,
        country,
      };

      // Use prop if already loaded (from ScreeningStep), otherwise fetch from outreach + live Didit session
      let amlData = screeningData;
      if (!amlData && kycCase?.id) {
        try {
          // Find IDV item with a didit_session_id from response_text
          const outreaches = await base44.entities.OutreachRequest.filter({ case_id: kycCase.id });
          let sessionId = null;
          let baseAml = null;

          for (const req of (outreaches || [])) {
            for (const item of (req.items || [])) {
              if (!item.response_text) continue;
              let parsed = null;
              try { parsed = JSON.parse(item.response_text); } catch { continue; }
              if (parsed?.didit_session_id && parsed?.idv_aml_hits != null) {
                sessionId = parsed.didit_session_id;
                baseAml = {
                  total_hits: parsed.idv_aml_hits,
                  status: parsed.idv_aml_hits === 0 ? 'Clear' : 'Flagged',
                  warnings: parsed.idv_aml_warnings || [],
                  ongoing_monitoring: parsed.idv_aml_ongoing_monitoring || false,
                };
                break;
              }
            }
            if (sessionId) break;
          }

          // If we have hits, fetch full hit details from Didit live session
          if (sessionId && baseAml?.total_hits > 0) {
            try {
              const res = await base44.functions.invoke('getDiditSessionDetails', {
                session_id: sessionId,
                tenant_id: tenant?.id || null,
                didit_api_key: tenant?.didit_api_key || null,
                action: 'details',
              });
              const data = res?.data ?? res;
              if (data?.aml_hits) {
                baseAml.screenings = [{ hits: data.aml_hits }];
              }
            } catch (e) {
              console.warn('AiAssistantPanel: failed to fetch Didit session details', e);
            }
          }
          if (baseAml) amlData = baseAml;
        } catch (e) {
          console.warn('AiAssistantPanel: failed to fetch AML data', e);
        }
      }

      if (amlData) {
        const hits = amlData.screenings?.[0]?.hits || amlData.hits || [];
        payload.hitData = {
          total_hits: amlData.total_hits,
          status: amlData.status,
          warnings: amlData.warnings || [],
          hits: hits.map(h => ({
            name: h.caption || h.name,
            match_score: h.match_score ?? (h.score != null ? Math.round(h.score * 100) : null),
            risk_score: h.risk_score,
            review_status: h.review_status || 'Unreviewed',
            datasets: h.datasets || h.categories || [],
            sources: h.sources || [],
            properties: h.properties || {},
          })),
          screened_data: amlData.screenings?.[0]?.screened_data || {},
          ongoing_monitoring: amlData.ongoing_monitoring,
        };
      } else {
        payload.hitData = { total_hits: 0, hits: [], status: 'No AML screening data available yet' };
      }

      payload.instructions = `You are a KYC compliance analyst. The subject being screened is: ${clientName} (${clientType}, ${country}).

Review the AML screening results and provide a structured triage analysis:
1) State the subject's identity type and key profile details.
2) Summarise each screening hit: name on list, which sanctions/PEP/adverse media lists, match score, risk score.
3) For each hit, recommend: False Positive / Possible Match / Confirmed Match — with justification.
4) Highlight any high-risk findings.
5) Recommend overall next steps.

Be specific about the actual hits found. Do not say data is insufficient if hits are present above.`;
    }
    await invoke(config.agentType, payload);
  }

  async function handleAccept() {
    const action = editing ? 'Edited' : 'Accepted';
    await logAction(action, '');
    // Persist accepted output so it survives step navigation
    acceptedOutputsRef.current[activeStep] = {
      output: effectiveOutput,
      actionStatus: action,
      editedText,
    };
    setActionStatus(action);
    setEditing(false);
  }

  async function handleReject() {
    await logAction('Rejected', 'Analyst rejected AI output');
    // Clear saved state on reject
    delete acceptedOutputsRef.current[activeStep];
    setActionStatus('Rejected');
  }

  async function handleOverride() {
    if (overrideJustification.length < 10) return;
    await logAction('Overridden', overrideJustification);
    setActionStatus('Overridden');
    setOverrideMode(false);
  }

  // Render output as readable text — narrative/summary fields only, never raw JSON
  function getDisplayText() {
    if (!effectiveOutput) return '';
    if (typeof effectiveOutput === 'string') return effectiveOutput;
    return effectiveOutput.narrative || effectiveOutput.email_draft || effectiveOutput.summary || effectiveOutput.answer || effectiveOutput.rationale || '';
  }

  // Key points / structured extras
  function getKeyPoints() {
    if (!effectiveOutput) return [];
    return effectiveOutput.key_risks || effectiveOutput.evidence_gaps || effectiveOutput.capacity_warnings || effectiveOutput.checklist?.map(c => `${c.label}: ${c.justification}`) || [];
  }

  if (collapsed) {
    return (
      <div className="w-8 flex-shrink-0 bg-purple-50/40 border-l border-purple-100 flex flex-col items-center py-4 gap-2">
        <button onClick={onToggleCollapse} className="text-purple-400 hover:text-purple-600 transition-colors">
          <ChevronRight className="w-4 h-4" />
        </button>
        <div className="mt-2 text-purple-400" style={{ writingMode: 'vertical-rl', fontSize: 10 }}>AI Assistant</div>
      </div>
    );
  }

  return (
    <div className="w-72 flex-shrink-0 bg-purple-50/40 border-l border-purple-100 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-purple-100 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles className="w-4 h-4 text-purple-600 flex-shrink-0" />
          <div className="min-w-0">
            <div className="text-xs font-semibold text-purple-800 truncate">{config.agentLabel}</div>
            <div className="text-xs text-purple-500 leading-tight truncate">{config.description}</div>
          </div>
        </div>
        <button onClick={onToggleCollapse} className="text-purple-400 hover:text-purple-600 ml-1 flex-shrink-0">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">

        {/* Idle */}
        {!effectiveOutput && !loading && !error && (
          <div className="text-center py-6 space-y-3">
            <Sparkles className="w-8 h-8 text-purple-300 mx-auto" />
            <p className="text-xs text-purple-600">Get AI assistance for this step.</p>
            <Button size="sm" onClick={generate} className="gap-2 bg-purple-600 hover:bg-purple-700 text-white w-full text-xs">
              <Sparkles className="w-3 h-3" /> Generate
            </Button>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex flex-col items-center py-8 gap-2">
            <Loader2 className="w-5 h-5 animate-spin text-purple-500" />
            <p className="text-xs text-purple-600">Analysing…</p>
          </div>
        )}

        {/* Error */}
        {error && !loading && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-red-700">
              <AlertTriangle className="w-3.5 h-3.5" /> Error
            </div>
            <p className="text-xs text-red-600">{error}</p>
            <Button size="sm" onClick={generate} variant="outline" className="text-xs w-full">Retry</Button>
          </div>
        )}

        {/* Output */}
        {effectiveOutput && !loading && (
          <div className="space-y-3">
            {/* Action status banner */}
            {actionStatus === 'Accepted' && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1.5 flex items-center gap-1.5 text-xs text-emerald-700">
                <Check className="w-3 h-3" /> Accepted &amp; logged
              </div>
            )}
            {actionStatus === 'Edited' && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg px-2.5 py-1.5 flex items-center gap-1.5 text-xs text-blue-700">
                <Pencil className="w-3 h-3" /> Edit accepted &amp; logged
              </div>
            )}
            {actionStatus === 'Overridden' && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 flex items-center gap-1.5 text-xs text-amber-700">
                <AlertTriangle className="w-3 h-3" /> Override logged
              </div>
            )}
            {actionStatus === 'Rejected' && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-2.5 py-1.5 flex items-center gap-1.5 text-xs text-red-700">
                <XCircle className="w-3 h-3" /> Output rejected
              </div>
            )}

            {/* Key points */}
            {getKeyPoints().length > 0 && (
              <div className="bg-purple-100/60 rounded-lg p-2.5">
                <div className="text-xs font-semibold text-purple-700 mb-1.5">Key Points</div>
                <ul className="space-y-1">
                  {getKeyPoints().slice(0, 5).map((pt, i) => (
                    <li key={i} className="text-xs text-purple-800 flex items-start gap-1.5">
                      <span className="text-purple-400 mt-0.5 flex-shrink-0">•</span>{String(pt)}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* AI output text — editable */}
            {editing ? (
              <Textarea value={editedText} onChange={e => setEditedText(e.target.value)}
                className="text-xs min-h-32 bg-white resize-none" autoFocus />
            ) : (
              <div className="bg-white border border-purple-100 rounded-lg p-2.5 overflow-y-auto prose prose-xs max-w-none text-xs text-foreground/80 [&_h1]:text-xs [&_h2]:text-xs [&_h3]:text-xs [&_h4]:text-xs [&_strong]:font-semibold [&_ul]:pl-4 [&_li]:my-0.5">
                <ReactMarkdown>{getDisplayText()}</ReactMarkdown>
              </div>
            )}

            {/* Token info */}
            {tokenInfo && (
              <div className="flex items-center gap-1 text-xs text-purple-400">
                <Info className="w-3 h-3" />
                {tokenInfo.remaining.toLocaleString()} tokens remaining today
              </div>
            )}

            {/* Action buttons */}
            {!actionStatus && (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-1.5">
                  <Button size="sm" className="text-xs gap-1 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={handleAccept}>
                    <Check className="w-3 h-3" /> {editing ? 'Accept Edit' : 'Accept'}
                  </Button>
                  <Button size="sm" variant="outline" className="text-xs gap-1 border-purple-200 text-purple-700 hover:bg-purple-50"
                    onClick={() => { setEditing(e => !e); setOverrideMode(false); }}>
                    <Pencil className="w-3 h-3" /> {editing ? 'Preview' : 'Edit'}
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <button className="text-xs text-amber-600 hover:text-amber-800 font-medium flex items-center justify-center gap-1 py-1 border border-amber-200 rounded-md hover:bg-amber-50"
                    onClick={() => { setOverrideMode(o => !o); setEditing(false); }}>
                    <AlertTriangle className="w-3 h-3" /> Override
                  </button>
                  <button className="text-xs text-red-500 hover:text-red-700 font-medium flex items-center justify-center gap-1 py-1 border border-red-200 rounded-md hover:bg-red-50"
                    onClick={handleReject}>
                    <XCircle className="w-3 h-3" /> Reject
                  </button>
                </div>

                {overrideMode && (
                  <div className="space-y-1.5 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
                    <div className="text-xs font-semibold text-amber-700">Override Justification *</div>
                    <Textarea value={overrideJustification} onChange={e => setOverrideJust(e.target.value)}
                      placeholder="Mandatory — min 10 characters…" className="text-xs min-h-14 bg-white resize-none" />
                    <div className="text-xs text-amber-600">{overrideJustification.length}/10</div>
                    <Button size="sm" className="w-full text-xs bg-amber-600 hover:bg-amber-700 text-white"
                      disabled={overrideJustification.length < 10} onClick={handleOverride}>
                      Confirm Override
                    </Button>
                  </div>
                )}
              </div>
            )}

            <Button size="sm" variant="ghost" className="text-xs w-full text-purple-500 hover:text-purple-700" onClick={generate}>
              <Sparkles className="w-3 h-3 mr-1" /> Regenerate
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
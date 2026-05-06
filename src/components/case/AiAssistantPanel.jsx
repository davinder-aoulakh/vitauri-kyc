import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Sparkles, Loader2, Check, Pencil, AlertTriangle, X, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Context configs per step:
 * stepConfig: { agentLabel, prompt, schema }
 */
const STEP_CONFIGS = {
  1: { agentLabel: 'Outreach Copilot', description: 'Draft client outreach messages and checklists' },
  2: { agentLabel: 'Identity Verification', description: 'Summarise identity document findings' },
  3: { agentLabel: 'Screening Triage', description: 'Analyse screening hits and suggest decisions' },
  4: { agentLabel: 'Client Profile', description: 'Analyse client profile for completeness and risks' },
  5: { agentLabel: 'SoF / SoW Analysis', description: 'Assess source of funds and wealth narratives' },
  6: { agentLabel: 'Risk Narrative', description: 'Generate risk narratives per indicator' },
  7: { agentLabel: 'Control Measures', description: 'Suggest SMART control measures' },
  8: { agentLabel: 'Sign-Off Report', description: 'Draft executive sign-off summary' },
};

export default function AiAssistantPanel({ kycCase, client, activeStep, currentUser, collapsed, onToggleCollapse }) {
  const [output, setOutput]         = useState(null);
  const [generating, setGenerating] = useState(false);
  const [editedOutput, setEditedOutput] = useState('');
  const [editing, setEditing]       = useState(false);
  const [overrideMode, setOverrideMode] = useState(false);
  const [overrideJustification, setOverrideJustification] = useState('');
  const [status, setStatus]         = useState(null); // null | 'accepted' | 'overridden'

  const config = STEP_CONFIGS[activeStep] || STEP_CONFIGS[1];

  // Reset when step changes
  React.useEffect(() => {
    setOutput(null); setEditing(false); setOverrideMode(false);
    setOverrideJustification(''); setStatus(null);
  }, [activeStep]);

  async function generate() {
    setGenerating(true);
    setOutput(null); setStatus(null); setEditing(false); setOverrideMode(false);

    const prompts = {
      1: `You are a KYC analyst drafting client outreach. Client: ${client?.full_name} (${client?.client_type}). Draft a professional outreach email and a checklist of required documents for an ${kycCase?.case_type?.replace(/_/g,' ')} review. Be concise and professional.`,
      2: `You are a KYC analyst. Review the identity verification status for ${client?.full_name} (${client?.client_type === 'NP' ? 'Natural Person' : 'Organisation'}). Summarise what identity documents would be required and typical verification findings. Flag any typical risks.`,
      3: `You are a KYC screening analyst. Summarise the screening status for ${client?.full_name}. Identify likely PEP, sanctions, or adverse media risks given sector: ${client?.sector || 'unknown'} and country: ${client?.registered_country || client?.nationality || 'unknown'}. Recommend next steps.`,
      4: `You are a KYC analyst. Assess the completeness of the client profile for ${client?.full_name}. Identify any missing data fields that should be collected and note any profile-level risk indicators.`,
      5: `You are a KYC analyst. For ${client?.full_name} (${client?.sector || 'unknown sector'}, ${client?.registered_country || 'unknown country'}), draft a Source of Funds and Source of Wealth assessment framework. Identify what evidence should be requested and what risks to look for.`,
      6: `You are a KYC risk analyst. For ${client?.full_name} (${client?.client_type}, ${client?.sector || 'unknown sector'}), list the key risk indicators that apply and your recommended risk rating per indicator. Justify each with a short narrative.`,
      7: `You are a KYC compliance analyst. For ${client?.full_name} with risk level ${kycCase?.risk_classification || 'unknown'}, suggest SMART control measures that should be applied. Format as a numbered list of specific, measurable, time-bound actions.`,
      8: `You are a KYC compliance analyst drafting a sign-off summary. Client: ${client?.full_name}. Case type: ${kycCase?.case_type?.replace(/_/g,' ')}. Risk classification: ${kycCase?.risk_classification || 'unclassified'}. Draft a concise executive summary suitable for the approver, covering key findings and recommendation.`,
    };

    const result = await base44.integrations.Core.InvokeLLM({
      prompt: prompts[activeStep] || prompts[1],
      response_json_schema: {
        type: 'object',
        properties: { output: { type: 'string' }, key_points: { type: 'array', items: { type: 'string' } } },
      },
    });

    // Log agent run
    await base44.entities.AiAgentRun.create({
      tenant_id: kycCase.tenant_id,
      case_id: kycCase.id,
      agent_type: activeStep === 3 ? 'ScreeningTriage' : activeStep === 6 ? 'RiskNarrative' : activeStep === 1 ? 'OutreachCopilot' : activeStep === 8 ? 'SoFSoW' : 'ClientProfile',
      output_summary: (result?.output || '').substring(0, 200),
    });

    setOutput(result);
    setEditedOutput(result?.output || '');
    setGenerating(false);
  }

  async function handleAccept() {
    await logAnalystAction('Accepted', editedOutput || output?.output || '');
    setStatus('accepted');
    setEditing(false);
  }

  async function handleOverride() {
    if (overrideJustification.length < 10) return;
    await logAnalystAction('Overridden', overrideJustification);
    setStatus('overridden');
    setOverrideMode(false);
  }

  async function logAnalystAction(action, notes) {
    await base44.entities.AuditEvent.create({
      tenant_id: kycCase.tenant_id,
      case_id: kycCase.id,
      actor_user_id: currentUser?.id,
      actor_name: currentUser?.full_name,
      actor_type: 'User',
      event_type: `ai_suggestion_${action.toLowerCase()}`,
      notes: `Step ${activeStep} — ${config.agentLabel}: ${notes.substring(0, 200)}`,
      is_override: action === 'Overridden',
    });
  }

  if (collapsed) {
    return (
      <div className="w-8 flex-shrink-0 bg-purple-50/40 border-l border-purple-100 flex flex-col items-center py-4">
        <button onClick={onToggleCollapse} className="text-purple-400 hover:text-purple-600 transition-colors" title="Expand AI Panel">
          <ChevronRight className="w-4 h-4" />
        </button>
        <div className="mt-3 text-purple-400 writing-mode-vertical" style={{ writingMode: 'vertical-rl', fontSize: 10 }}>AI Assistant</div>
      </div>
    );
  }

  return (
    <div className="w-72 flex-shrink-0 bg-purple-50/40 border-l border-purple-100 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-purple-100 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-purple-600" />
          <div>
            <div className="text-xs font-semibold text-purple-800">{config.agentLabel}</div>
            <div className="text-xs text-purple-500 leading-tight">{config.description}</div>
          </div>
        </div>
        <button onClick={onToggleCollapse} className="text-purple-400 hover:text-purple-600 ml-1">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">

        {/* Idle */}
        {!output && !generating && (
          <div className="text-center py-6 space-y-3">
            <Sparkles className="w-8 h-8 text-purple-300 mx-auto" />
            <p className="text-xs text-purple-600">Click Generate to get AI assistance for this step.</p>
            <Button size="sm" onClick={generate} className="gap-2 bg-purple-600 hover:bg-purple-700 text-white w-full text-xs">
              <Sparkles className="w-3 h-3" /> Generate Suggestion
            </Button>
          </div>
        )}

        {/* Generating */}
        {generating && (
          <div className="flex flex-col items-center py-8 gap-2">
            <Loader2 className="w-5 h-5 animate-spin text-purple-500" />
            <p className="text-xs text-purple-600">Analysing…</p>
          </div>
        )}

        {/* Output */}
        {output && !generating && (
          <div className="space-y-3">
            {/* Status banner */}
            {status === 'accepted' && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1.5 flex items-center gap-1.5 text-xs text-emerald-700">
                <Check className="w-3 h-3" /> Accepted & logged
              </div>
            )}
            {status === 'overridden' && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 flex items-center gap-1.5 text-xs text-amber-700">
                <AlertTriangle className="w-3 h-3" /> Override logged
              </div>
            )}

            {/* Key points */}
            {output.key_points?.length > 0 && (
              <div className="bg-purple-100/60 rounded-lg p-2.5">
                <div className="text-xs font-semibold text-purple-700 mb-1.5">Key Points</div>
                <ul className="space-y-1">
                  {output.key_points.map((pt, i) => (
                    <li key={i} className="text-xs text-purple-800 flex items-start gap-1.5">
                      <span className="text-purple-400 mt-0.5">•</span>{pt}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* AI Output text */}
            {editing ? (
              <Textarea
                value={editedOutput}
                onChange={e => setEditedOutput(e.target.value)}
                className="text-xs min-h-32 bg-white"
                autoFocus
              />
            ) : (
              <div className="bg-white border border-purple-100 rounded-lg p-2.5">
                <p className="text-xs text-foreground/80 leading-relaxed whitespace-pre-wrap">{editedOutput || output.output}</p>
              </div>
            )}

            {/* Actions — only if not yet actioned */}
            {!status && (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-1.5">
                  <Button size="sm" className="text-xs gap-1 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={handleAccept}>
                    <Check className="w-3 h-3" /> Accept
                  </Button>
                  <Button size="sm" variant="outline" className="text-xs gap-1 border-purple-200 text-purple-700 hover:bg-purple-50"
                    onClick={() => { setEditing(e => !e); setOverrideMode(false); }}
                  >
                    <Pencil className="w-3 h-3" /> {editing ? 'Done' : 'Edit'}
                  </Button>
                </div>
                {editing && (
                  <Button size="sm" className="text-xs w-full bg-emerald-600 hover:bg-emerald-700 text-white gap-1" onClick={handleAccept}>
                    <Check className="w-3 h-3" /> Accept Edited Version
                  </Button>
                )}
                <button
                  className="w-full text-xs text-amber-600 hover:text-amber-800 font-medium flex items-center justify-center gap-1 py-1"
                  onClick={() => { setOverrideMode(o => !o); setEditing(false); }}
                >
                  <AlertTriangle className="w-3 h-3" /> Override (requires justification)
                </button>

                {overrideMode && (
                  <div className="space-y-1.5 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
                    <div className="text-xs font-semibold text-amber-700">Override Justification *</div>
                    <Textarea
                      value={overrideJustification}
                      onChange={e => setOverrideJustification(e.target.value)}
                      placeholder="Mandatory — min 10 characters…"
                      className="text-xs min-h-16 bg-white"
                    />
                    <div className="text-xs text-amber-600">{overrideJustification.length}/10 min</div>
                    <Button
                      size="sm"
                      className="w-full text-xs bg-amber-600 hover:bg-amber-700 text-white"
                      disabled={overrideJustification.length < 10}
                      onClick={handleOverride}
                    >
                      Confirm Override
                    </Button>
                  </div>
                )}
              </div>
            )}

            {/* Regenerate always available */}
            <Button size="sm" variant="ghost" className="text-xs w-full text-purple-500 hover:text-purple-700" onClick={generate}>
              <Sparkles className="w-3 h-3 mr-1" /> Regenerate
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
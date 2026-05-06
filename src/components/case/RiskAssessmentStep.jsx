import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { AlertTriangle, Loader2, Sparkles, CheckCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { RISK_COLORS } from '@/lib/riskColors';

const DEFAULT_INDICATORS = [
  { name: 'High-Risk Geography', description: 'Operating in a high-risk or non-cooperative jurisdiction' },
  { name: 'PEP Status', description: 'Client or related party is a Politically Exposed Person' },
  { name: 'Adverse Media / Screening Hit', description: 'Confirmed adverse media or sanctions match' },
  { name: 'Complex Ownership Structure', description: 'Multi-layered or opaque ownership arrangements' },
  { name: 'High-Risk Sector / Industry', description: 'Operating in a high-risk sector (e.g. gambling, crypto)' },
  { name: 'Cash-Intensive Business', description: 'Primary operations involve large cash volumes' },
  { name: 'Inconsistent SoF/SoW', description: 'Source of funds or wealth cannot be adequately explained' },
];

const RISK_LEVELS = ['Low', 'Medium', 'High', 'Unacceptable'];

export default function RiskAssessmentStep({ kycCase, client, currentUser, onCaseUpdate }) {
  const [assessments, setAssessments] = useState({});
  const [narratives, setNarratives] = useState({});
  const [generatingNarrative, setGeneratingNarrative] = useState(null);
  const [consolidated, setConsolidated] = useState(kycCase?.risk_classification || null);
  const [overrideMode, setOverrideMode] = useState(false);
  const [overrideJustification, setOverrideJustification] = useState('');
  const [saving, setSaving] = useState(false);

  function getConsolidated() {
    const order = ['Unacceptable', 'High', 'Medium', 'Low'];
    const scores = Object.values(assessments).map(a => a.score).filter(Boolean);
    if (scores.length === 0) return null;
    for (const level of order) {
      if (scores.includes(level)) return level;
    }
    return null;
  }

  const proposedRisk = getConsolidated();

  async function generateNarrative(indicatorName) {
    setGeneratingNarrative(indicatorName);
    const score = assessments[indicatorName]?.score || 'Medium';
    const result = await base44.integrations.Core.InvokeLLM({
      prompt: `You are a KYC compliance analyst writing a professional risk narrative.
Client: ${client?.full_name || 'Unknown'} (${kycCase?.client_type})
Risk Indicator: ${indicatorName}
Score Assigned: ${score}

Write a professional KYC risk narrative using pyramidal structure:
1. Opening sentence: state the conclusion directly (e.g. "The client's [X] presents a [SCORE] risk.")
2. 2-3 sentences of supporting evidence
3. Any mitigating factors if applicable

Keep it factual, neutral, regulatory-grade. 3-5 sentences total.`,
      response_json_schema: {
        type: 'object',
        properties: {
          narrative: { type: 'string' },
        },
      },
    });
    setNarratives(n => ({ ...n, [indicatorName]: result?.narrative || '' }));
    setGeneratingNarrative(null);
  }

  async function saveAndProceed() {
    setSaving(true);
    const finalRisk = overrideMode ? (assessments['__override']?.score || proposedRisk) : proposedRisk;
    await base44.entities.KycCase.update(kycCase.id, {
      risk_classification: finalRisk,
      step_6_status: 'complete',
    });
    if (currentUser) {
      await base44.entities.AuditEvent.create({
        tenant_id: kycCase.tenant_id,
        case_id: kycCase.id,
        actor_user_id: currentUser.id,
        actor_name: currentUser.full_name,
        actor_type: 'User',
        event_type: overrideMode ? 'risk_override' : 'risk_assessment_complete',
        notes: overrideMode ? overrideJustification : `Risk classified as ${finalRisk}`,
        is_override: overrideMode,
      });
    }
    onCaseUpdate?.(prev => ({ ...prev, risk_classification: finalRisk, step_6_status: 'complete' }));
    setSaving(false);
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="font-semibold text-sm">Risk Indicator Assessment</h3>
        <p className="text-xs text-muted-foreground mt-0.5">Score each applicable risk indicator for {client?.full_name || 'the client'}</p>
      </div>

      {/* Indicators */}
      {DEFAULT_INDICATORS.map(indicator => {
        const score = assessments[indicator.name]?.score;
        const narrative = narratives[indicator.name];
        const isGenerating = generatingNarrative === indicator.name;

        return (
          <div key={indicator.name} className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="p-4">
              <div className="flex items-start justify-between gap-4 mb-3">
                <div>
                  <div className="font-medium text-sm text-foreground">{indicator.name}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{indicator.description}</div>
                </div>
                {score && (
                  <span className={cn('text-xs font-semibold px-2.5 py-1 rounded-full flex-shrink-0',
                    RISK_COLORS[score]?.badge || 'bg-slate-100 text-slate-600'
                  )}>
                    {score}
                  </span>
                )}
              </div>

              {/* Score Selector */}
              <div className="flex flex-wrap gap-2 mb-3">
                {RISK_LEVELS.map(level => (
                  <button
                    key={level}
                    onClick={() => setAssessments(a => ({ ...a, [indicator.name]: { ...a[indicator.name], score: level } }))}
                    className={cn(
                      'text-xs px-3 py-1.5 rounded-lg border font-medium transition-all',
                      score === level
                        ? cn('border-transparent', RISK_COLORS[level]?.badge)
                        : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground'
                    )}
                  >
                    {level}
                  </button>
                ))}
                {score && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs gap-1 text-purple-600 hover:text-purple-700 hover:bg-purple-50"
                    onClick={() => generateNarrative(indicator.name)}
                    disabled={isGenerating}
                  >
                    {isGenerating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                    {isGenerating ? 'Generating…' : 'AI Narrative'}
                  </Button>
                )}
              </div>

              {/* AI Narrative */}
              {narrative && (
                <div className="bg-purple-50/40 border border-purple-100 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-semibold text-purple-700">AI Narrative</span>
                    <div className="flex gap-1.5 text-xs">
                      <button className="px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded hover:bg-emerald-100 transition-colors font-medium">✓ Accept</button>
                      <button className="px-2 py-0.5 bg-amber-50 text-amber-700 rounded hover:bg-amber-100 transition-colors font-medium">✏ Edit</button>
                    </div>
                  </div>
                  <p className="text-xs text-foreground/80 leading-relaxed">{narrative}</p>
                </div>
              )}
            </div>
          </div>
        );
      })}

      {/* Consolidated Risk */}
      {proposedRisk && (
        <div className={cn(
          'rounded-xl border-2 p-5',
          RISK_COLORS[proposedRisk]?.border || 'border-border',
          RISK_COLORS[proposedRisk]?.bg || 'bg-muted'
        )}>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide opacity-70 mb-1">System Proposed Classification</div>
              <div className={cn('text-2xl font-bold', RISK_COLORS[proposedRisk]?.text)}>
                {proposedRisk.toUpperCase()} RISK
              </div>
              <div className="text-xs opacity-70 mt-1">Highest-risk-wins · Based on {Object.values(assessments).filter(a=>a.score).length} indicators</div>
            </div>
            <button
              onClick={() => setOverrideMode(!overrideMode)}
              className="text-xs font-medium text-foreground/60 hover:text-foreground border border-current rounded-lg px-3 py-1.5 transition-colors"
            >
              {overrideMode ? 'Cancel Override' : '⚠ Override'}
            </button>
          </div>

          {overrideMode && (
            <div className="mt-4 pt-4 border-t border-current/20 space-y-3">
              <div className="flex flex-wrap gap-2">
                {RISK_LEVELS.map(level => (
                  <button
                    key={level}
                    onClick={() => setAssessments(a => ({ ...a, __override: { score: level } }))}
                    className={cn('text-xs px-3 py-1.5 rounded-lg border font-medium transition-all',
                      assessments.__override?.score === level ? cn('border-transparent', RISK_COLORS[level]?.badge) : 'border-current/30 opacity-70 hover:opacity-100'
                    )}
                  >
                    {level}
                  </button>
                ))}
              </div>
              <Textarea
                value={overrideJustification}
                onChange={e => setOverrideJustification(e.target.value)}
                placeholder="Mandatory justification required (min 30 characters)…"
                className="text-xs min-h-16"
              />
            </div>
          )}
        </div>
      )}

      {proposedRisk && (
        <Button
          onClick={saveAndProceed}
          disabled={saving || (overrideMode && overrideJustification.length < 30)}
          className="w-full gap-2"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
          {saving ? 'Saving…' : 'Accept → Proceed to Control Measures'}
        </Button>
      )}
    </div>
  );
}
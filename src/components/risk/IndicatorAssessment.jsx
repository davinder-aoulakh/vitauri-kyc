/**
 * S-091: Risk Assessment Workspace
 * Per-indicator scoring, AI narrative, evidence linking
 */
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { base44 } from '@/api/base44Client';
import {
  Sparkles, Loader2, CheckCircle, ChevronDown, ChevronUp,
  Paperclip, RefreshCw, AlertTriangle, X
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { RISK_COLORS } from '@/lib/riskColors';
import { ALL_INDICATORS } from './IndicatorPicker';

const RISK_LEVELS = ['Low', 'Medium', 'High', 'Unacceptable'];

function getProposedRisk(entityScores) {
  const order = ['Unacceptable', 'High', 'Medium', 'Low'];
  const scores = Object.values(entityScores).map(a => a?.score).filter(Boolean);
  if (scores.length === 0) return null;
  for (const level of order) if (scores.includes(level)) return level;
  return null;
}

export default function IndicatorAssessment({
  entityKey, entityLabel, entityType, client,
  selectedIndicatorIds, kycCase, currentUser,
  scores, onScoresChange,
  persistedData, onPersistedDataChange,
}) {
  const [expanded, setExpanded] = useState(null);
  // Initialise from persisted data on mount
  const [narratives, setNarratives] = useState(persistedData?.narratives || {});
  const [narrativeAccepted, setNarrativeAccepted] = useState(persistedData?.narrativeAccepted || {});
  const [generatingNarrative, setGeneratingNarrative] = useState(null);
  const [overallNarrative, setOverallNarrative] = useState(persistedData?.overallNarrative || '');
  const [generatingOverall, setGeneratingOverall] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(null);
  const [documents, setDocuments] = useState([]);
  // Initialise evidence links from persisted data
  const [evidenceLinks, setEvidenceLinks] = useState(persistedData?.evidenceLinks || {});
  const [overrideMode, setOverrideMode] = useState(false);
  const [overrideScore, setOverrideScore] = useState(scores?.__override?.score || '');
  const [overrideJust, setOverrideJust] = useState('');
  const [overrideApplied, setOverrideApplied] = useState(!!scores?.__override?.score);
  const [saving, setSaving] = useState(false);

  const indicators = selectedIndicatorIds.map(id => ALL_INDICATORS.find(i => i.id === id)).filter(Boolean);
  const proposedRisk = getProposedRisk(scores);
  const scoredCount = indicators.filter(ind => scores[ind.id]?.score).length;
  const totalCount = indicators.length;

  async function loadDocs() {
    const docs = await base44.entities.Document.filter({ client_id: kycCase?.client_id });
    setDocuments(docs || []);
  }

  async function generateIndicatorNarrative(ind) {
    setGeneratingNarrative(ind.id);
    const score = scores[ind.id]?.score || 'Medium';
    const result = await base44.integrations.Core.InvokeLLM({
      prompt: `You are a KYC compliance analyst. Write a professional, pyramidal-structure risk narrative.

Entity: ${entityLabel} (${entityType})
Risk Indicator: ${ind.name}
Indicator Description: ${ind.description}
Score Assigned: ${score}
Client: ${client?.full_name} (${client?.client_type})
Country: ${client?.registered_country || client?.nationality || 'Unknown'}
Sector: ${client?.sector || 'Unknown'}

Structure (strictly follow):
1. Opening sentence: state conclusion directly. E.g. "The client's [X] presents a [SCORE] risk due to [key reason]."
2. 2–3 sentences of supporting evidence or observations
3. One sentence on mitigating factors, if any (or state "No mitigating factors identified.")

Tone: factual, neutral, third-person, regulatory-grade. Total: 3–5 sentences.`,
      model: 'claude_sonnet_4_6',
    });
    const text = typeof result === 'string' ? result : result?.narrative || result?.text || JSON.stringify(result);
    setNarratives(n => {
      const next = { ...n, [ind.id]: text };
      onPersistedDataChange?.({ narratives: next });
      return next;
    });
    setNarrativeAccepted(a => {
      const next = { ...a, [ind.id]: false };
      onPersistedDataChange?.({ narrativeAccepted: next });
      return next;
    });
    setGeneratingNarrative(null);
  }

  async function generateOverallNarrative() {
    setGeneratingOverall(true);
    const scoredIndicators = indicators.map(ind => ({
      name: ind.name,
      score: scores[ind.id]?.score || 'Not scored',
      narrative: narratives[ind.id] || '',
    }));

    const result = await base44.integrations.Core.InvokeLLM({
      prompt: `You are a senior KYC compliance officer. Synthesise the following individual risk indicator assessments into a single, consolidated risk narrative for this entity.

Entity: ${entityLabel} (${entityType})
Proposed Risk Classification: ${proposedRisk || 'Not yet determined'}

INDICATOR ASSESSMENTS:
${scoredIndicators.map(i => `- ${i.name} [${i.score}]: ${i.narrative || 'No narrative'}`).join('\n')}

Write a consolidated narrative (4–6 paragraphs) that:
1. States the overall risk classification and rationale in the opening
2. Summarises the key risk drivers (highest-scoring indicators)
3. Discusses the interplay between indicators where relevant
4. Notes evidence gaps or areas requiring monitoring
5. Concludes with a risk appetite statement and recommended treatment

Tone: professional, regulatory-grade, suitable for a compliance file.`,
      model: 'claude_sonnet_4_6',
    });
    const text = typeof result === 'string' ? result : result?.narrative || JSON.stringify(result);
    setOverallNarrative(text);
    onPersistedDataChange?.({ overallNarrative: text });
    setGeneratingOverall(false);
  }

  async function applyOverride() {
    if (!overrideScore || overrideJust.length < 30) return;
    setSaving(true);
    await base44.entities.AuditEvent.create({
      tenant_id: kycCase?.tenant_id,
      case_id: kycCase?.id,
      actor_user_id: currentUser?.id,
      actor_name: currentUser?.full_name,
      actor_type: 'User',
      event_type: 'risk_classification_override',
      before_state: { proposed: proposedRisk },
      after_state: { override: overrideScore },
      notes: overrideJust,
      is_override: true,
    });
    setOverrideApplied(true);
    setOverrideMode(false);
    const overrideData = { score: overrideScore, justification: overrideJust };
    onScoresChange({ ...scores, __override: overrideData });
    setSaving(false);
  }

  function toggleEvidence(indicatorId, doc) {
    const current = evidenceLinks[indicatorId] || [];
    const exists = current.find(d => d.id === doc.id);
    setEvidenceLinks(e => {
      const next = { ...e, [indicatorId]: exists ? current.filter(d => d.id !== doc.id) : [...current, doc] };
      onPersistedDataChange?.({ evidenceLinks: next });
      return next;
    });
    setEvidenceOpen(null);
  }

  const RISK_COLORS_PROGRESS = {
    Low:          { bar: 'bg-emerald-500', text: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200' },
    Medium:       { bar: 'bg-amber-500',   text: 'text-amber-700',   bg: 'bg-amber-50 border-amber-200' },
    High:         { bar: 'bg-red-500',     text: 'text-red-700',     bg: 'bg-red-50 border-red-200' },
    Unacceptable: { bar: 'bg-rose-800',    text: 'text-rose-900',    bg: 'bg-rose-50 border-rose-300' },
  };
  const finalRisk = scores.__override?.score || proposedRisk;
  const riskCfg = RISK_COLORS_PROGRESS[finalRisk];

  return (
    <div className="space-y-4">
      {/* Live Scoring Progress Bar */}
      {totalCount > 0 && (
        <div className={cn('rounded-xl border p-3 space-y-2 transition-all', riskCfg ? riskCfg.bg : 'bg-muted/30 border-border')}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-foreground">
                {entityLabel}
              </span>
              <span className="text-xs text-muted-foreground">
                {scoredCount}/{totalCount} indicators scored
              </span>
            </div>
            {finalRisk ? (
              <span className={cn('text-xs font-bold px-2.5 py-1 rounded-full border', RISK_COLORS[finalRisk]?.badge)}>
                {scores.__override?.score ? '⚠ Override: ' : ''}{finalRisk.toUpperCase()}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground bg-muted px-2.5 py-1 rounded-full border border-border">
                Not yet scored
              </span>
            )}
          </div>
          <div className="h-2 bg-black/10 rounded-full overflow-hidden">
            <div
              className={cn('h-full rounded-full transition-all duration-500', riskCfg?.bar || 'bg-muted-foreground/30')}
              style={{ width: totalCount > 0 ? `${(scoredCount / totalCount) * 100}%` : '0%' }}
            />
          </div>
          {/* Per-indicator chips */}
          <div className="flex flex-wrap gap-1.5">
            {indicators.map(ind => {
              const s = scores[ind.id]?.score;
              const cfg = s ? RISK_COLORS_PROGRESS[s] : null;
              return (
                <span
                  key={ind.id}
                  className={cn(
                    'text-xs px-2 py-0.5 rounded-full border font-medium cursor-pointer transition-colors',
                    cfg ? cn('border-transparent', RISK_COLORS[s]?.badge) : 'border-border bg-muted text-muted-foreground'
                  )}
                  onClick={() => setExpanded(expanded === ind.id ? null : ind.id)}
                  title={ind.name}
                >
                  {ind.name.split(' ').slice(0, 2).join(' ')}{s ? '' : ' …'}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Indicators */}
      {indicators.length === 0 && (
        <div className="text-center text-muted-foreground text-sm py-8 bg-card border border-border rounded-xl">
          No indicators selected for this entity. Go back to Step 1 to add indicators.
        </div>
      )}

      {indicators.map(ind => {
        const score = scores[ind.id]?.score;
        const narrative = narratives[ind.id];
        const accepted = narrativeAccepted[ind.id];
        const isExpanded = expanded === ind.id;
        const isGenerating = generatingNarrative === ind.id;
        const evLinks = evidenceLinks[ind.id] || [];

        return (
          <div key={ind.id} className="bg-card border border-border rounded-xl overflow-hidden">
            {/* Header row */}
            <button
              className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/20 transition-colors"
              onClick={() => setExpanded(isExpanded ? null : ind.id)}
            >
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm text-foreground">{ind.name}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{ind.description}</div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {score ? (
                  <span className={cn('text-xs font-semibold px-2.5 py-1 rounded-full border', RISK_COLORS[score]?.badge)}>
                    {score}
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground bg-muted px-2.5 py-1 rounded-full">Not scored</span>
                )}
                {accepted && <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />}
                {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
              </div>
            </button>

            {isExpanded && (
              <div className="border-t border-border p-4 space-y-4">
                {/* Score Selection */}
                <div>
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Risk Score</div>
                  <div className="flex flex-wrap gap-2">
                    {RISK_LEVELS.map(level => (
                      <button
                        key={level}
                        onClick={() => onScoresChange({ ...scores, [ind.id]: { ...scores[ind.id], score: level } })}
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
                  </div>
                </div>

                {/* Notes */}
                <div>
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Assessment Notes</div>
                  <Textarea
                    value={scores[ind.id]?.notes || ''}
                    onChange={e => onScoresChange({ ...scores, [ind.id]: { ...scores[ind.id], notes: e.target.value } })}
                    placeholder="Add analyst notes for this indicator…"
                    className="text-sm min-h-12 resize-none"
                  />
                </div>

                {/* Evidence Links */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Evidence</div>
                    <button
                      className="text-xs text-primary flex items-center gap-1 hover:underline"
                      onClick={() => { loadDocs(); setEvidenceOpen(ind.id); }}
                    >
                      <Paperclip className="w-3 h-3" /> Link document
                    </button>
                  </div>
                  {evLinks.length > 0 ? (
                    <div className="space-y-1.5">
                      {evLinks.map(doc => (
                        <div key={doc.id} className="flex items-center justify-between text-xs bg-muted/30 border border-border rounded-lg px-2.5 py-1.5">
                          <span className="font-medium">{doc.doc_type?.replace(/_/g,' ')}: {doc.file_name}</span>
                          <button onClick={() => toggleEvidence(ind.id, doc)}><X className="w-3 h-3 text-muted-foreground hover:text-destructive" /></button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground italic">No evidence linked</div>
                  )}
                </div>

                {/* AI Narrative */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Risk Narrative</div>
                    <div className="flex gap-1.5">
                      {narrative && (
                        <button
                          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                          onClick={() => generateIndicatorNarrative(ind)}
                          disabled={isGenerating}
                        >
                          <RefreshCw className="w-3 h-3" /> Regenerate
                        </button>
                      )}
                      <Button
                        size="sm" variant="ghost"
                        className="text-xs gap-1 text-purple-600 hover:bg-purple-50 h-6 px-2"
                        onClick={() => generateIndicatorNarrative(ind)}
                        disabled={isGenerating || !score}
                      >
                        {isGenerating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                        {isGenerating ? 'Generating…' : narrative ? 'Regenerate' : 'AI Narrative'}
                      </Button>
                    </div>
                  </div>

                  {narrative ? (
                    <div className="space-y-2">
                      <div className={cn('bg-purple-50/50 border border-purple-200 rounded-lg p-3 space-y-2', accepted && 'border-emerald-200 bg-emerald-50/30')}>
                        {accepted && (
                          <div className="flex items-center gap-1 text-xs text-emerald-600 font-medium">
                            <CheckCircle className="w-3 h-3" /> Accepted
                          </div>
                        )}
                        <Textarea
                          value={narrative}
                          onChange={e => { setNarratives(n => ({ ...n, [ind.id]: e.target.value })); setNarrativeAccepted(a => ({ ...a, [ind.id]: false })); }}
                          className="text-xs min-h-20 bg-transparent border-0 p-0 focus-visible:ring-0 resize-none leading-relaxed"
                        />
                      </div>
                      {!accepted && (
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" className="text-xs gap-1 border-emerald-300 text-emerald-700 hover:bg-emerald-50 h-7"
                           onClick={() => {
                             setNarrativeAccepted(a => {
                               const next = { ...a, [ind.id]: true };
                               onPersistedDataChange?.({ narrativeAccepted: next });
                               return next;
                             });
                           }}>
                            <CheckCircle className="w-3 h-3" /> Accept
                          </Button>
                          <Button size="sm" variant="ghost" className="text-xs gap-1 text-amber-600 hover:bg-amber-50 h-7"
                            onClick={() => generateIndicatorNarrative(ind)}>
                            Edit &amp; Re-draft
                          </Button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground italic">Score the indicator first, then generate an AI narrative.</div>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* Evidence picker modal */}
      {evidenceOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-card border border-border rounded-xl p-5 w-[420px] shadow-xl max-h-[70vh] flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-sm">Link Evidence Document</h3>
              <button onClick={() => setEvidenceOpen(null)}><X className="w-4 h-4 text-muted-foreground" /></button>
            </div>
            <div className="flex-1 overflow-y-auto space-y-1.5">
              {documents.length === 0 ? (
                <div className="text-xs text-muted-foreground italic py-4 text-center">No documents uploaded for this client</div>
              ) : documents.map(doc => (
                <button key={doc.id} className="w-full text-left flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-muted/40 text-xs transition-colors"
                  onClick={() => toggleEvidence(evidenceOpen, doc)}>
                  <Paperclip className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                  <div>
                    <div className="font-medium">{doc.doc_type?.replace(/_/g,' ')}</div>
                    <div className="text-muted-foreground">{doc.file_name}</div>
                  </div>
                  {(evidenceLinks[evidenceOpen] || []).find(d => d.id === doc.id) && (
                    <CheckCircle className="w-3.5 h-3.5 text-emerald-500 ml-auto" />
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Risk Classification Banner */}
      {indicators.length > 0 && (
        <div className={cn(
          'rounded-xl border-2 p-5 space-y-3',
          finalRisk ? (RISK_COLORS[finalRisk]?.border + ' ' + RISK_COLORS[finalRisk]?.bg) : 'border-border bg-muted'
        )}>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide opacity-60 mb-1">
                {overrideApplied ? 'Analyst-Overridden Classification' : 'System-Proposed Classification'}
              </div>
              <div className={cn('text-2xl font-bold', finalRisk ? RISK_COLORS[finalRisk]?.text : 'text-muted-foreground')}>
                {finalRisk ? `${finalRisk.toUpperCase()} RISK` : 'Not yet scored'}
              </div>
              <div className="text-xs opacity-60 mt-1">
                Based on {Object.values(scores).filter(s => s?.score && !('__override' in {})).length} scored indicators · Highest-risk-wins
              </div>
              {overrideApplied && (
                <div className="flex items-center gap-1 mt-1.5 text-xs text-amber-700 font-semibold">
                  <AlertTriangle className="w-3.5 h-3.5" /> ⚠ Overridden by analyst
                </div>
              )}
            </div>
            {finalRisk && !overrideApplied && (
              <button
                onClick={() => setOverrideMode(!overrideMode)}
                className="text-xs font-medium border border-current/40 rounded-lg px-3 py-1.5 transition-colors hover:bg-black/5"
              >
                {overrideMode ? 'Cancel' : '⚠ Override'}
              </button>
            )}
          </div>

          {overrideMode && (
            <div className="pt-3 border-t border-current/20 space-y-3">
              <div className="flex flex-wrap gap-2">
                {RISK_LEVELS.map(level => (
                  <button key={level}
                    onClick={() => setOverrideScore(level)}
                    className={cn('text-xs px-3 py-1.5 rounded-lg border font-medium transition-all',
                      overrideScore === level ? cn('border-transparent', RISK_COLORS[level]?.badge) : 'border-current/30 opacity-70 hover:opacity-100'
                    )}>
                    {level}
                  </button>
                ))}
              </div>
              <Textarea
                value={overrideJust}
                onChange={e => setOverrideJust(e.target.value)}
                placeholder="Mandatory justification required (min 30 characters)…"
                className="text-xs min-h-16 resize-none"
              />
              <div className="flex items-center gap-2">
                <div className="text-xs text-muted-foreground">{overrideJust.length}/30</div>
                <Button size="sm" className="gap-1 text-xs bg-amber-600 hover:bg-amber-700 text-white ml-auto"
                  disabled={!overrideScore || overrideJust.length < 30 || saving}
                  onClick={applyOverride}>
                  {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <AlertTriangle className="w-3 h-3" />}
                  Apply Override
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Overall Narrative */}
      {indicators.length > 0 && Object.values(scores).some(s => s?.score) && (
        <div className="bg-card border border-border rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold text-sm">Consolidated Risk Narrative</h4>
            <Button
              size="sm" variant="outline"
              className="gap-1.5 text-xs text-purple-600 border-purple-200 hover:bg-purple-50"
              onClick={generateOverallNarrative}
              disabled={generatingOverall}
            >
              {generatingOverall ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {generatingOverall ? 'Generating…' : 'Generate Overall Narrative'}
            </Button>
          </div>
          <Textarea
            value={overallNarrative}
            onChange={e => {
              setOverallNarrative(e.target.value);
              onPersistedDataChange?.({ overallNarrative: e.target.value });
            }}
            placeholder="Click 'Generate Overall Narrative' to synthesise all indicator assessments into a consolidated risk narrative…"
            className="text-sm min-h-40 resize-y leading-relaxed"
          />
        </div>
      )}
    </div>
  );
}
/**
 * S-092: Consolidated Risk View
 * Roll up across Client + all Related Parties
 */
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { base44 } from '@/api/base44Client';
import { AlertTriangle, CheckCircle, Loader2, ArrowRight, User, Building2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { RISK_COLORS } from '@/lib/riskColors';
import { ALL_INDICATORS } from './IndicatorPicker';

const RISK_ORDER = ['Unacceptable', 'High', 'Medium', 'Low'];

function getHighestRisk(scores) {
  const allScores = Object.values(scores).map(s => s?.score).filter(Boolean).filter(s => s !== '__override');
  const override = scores.__override?.score;
  if (override) return override;
  if (allScores.length === 0) return null;
  for (const level of RISK_ORDER) if (allScores.includes(level)) return level;
  return null;
}

export default function ConsolidatedRiskView({
  entities, allScores, kycCase, client, currentUser, onProceed,
}) {
  const [overrideMode, setOverrideMode] = useState(false);
  const [overrideLevel, setOverrideLevel] = useState('');
  const [overrideJust, setOverrideJust] = useState('');
  const [overrideApplied, setOverrideApplied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [proceeding, setProceeding] = useState(false);

  // Per-entity summaries
  const entitySummaries = entities.map(e => {
    const scores = allScores[e.key] || {};
    const highest = getHighestRisk(scores);
    const indicatorCount = Object.values(scores).filter(s => s?.score).length;
    return { ...e, highest, indicatorCount };
  });

  // Consolidated = highest across all entities (Unacceptable wins)
  const allHighest = entitySummaries.map(e => e.highest).filter(Boolean);
  let consolidated = null;
  for (const level of RISK_ORDER) {
    if (allHighest.includes(level)) { consolidated = level; break; }
  }
  const finalConsolidated = overrideApplied ? overrideLevel : consolidated;

  async function applyOverride() {
    if (!overrideLevel || overrideJust.length < 30) return;
    setSaving(true);
    await base44.entities.AuditEvent.create({
      tenant_id: kycCase?.tenant_id,
      case_id: kycCase?.id,
      actor_user_id: currentUser?.id,
      actor_name: currentUser?.full_name,
      actor_type: 'User',
      event_type: 'consolidated_risk_override',
      before_state: { consolidated },
      after_state: { override: overrideLevel },
      notes: overrideJust,
      is_override: true,
    });
    setOverrideApplied(true);
    setOverrideMode(false);
    setSaving(false);
  }

  async function proceedToControlMeasures() {
    setProceeding(true);
    // Save consolidated classification to case
    await base44.entities.KycCase.update(kycCase.id, {
      risk_classification: finalConsolidated,
      step_6_status: 'complete',
    });
    await base44.entities.AuditEvent.create({
      tenant_id: kycCase.tenant_id,
      case_id: kycCase.id,
      actor_user_id: currentUser?.id,
      actor_name: currentUser?.full_name,
      actor_type: 'User',
      event_type: overrideApplied ? 'risk_assessment_complete_override' : 'risk_assessment_complete',
      notes: `Consolidated risk classification: ${finalConsolidated}. ${overrideApplied ? `Override applied: ${overrideJust}` : ''}`,
      is_override: overrideApplied,
    });
    setProceeding(false);
    onProceed?.(finalConsolidated);
  }

  const RISK_LEVELS = ['Low', 'Medium', 'High', 'Unacceptable'];

  return (
    <div className="space-y-5">
      <div>
        <h3 className="font-semibold text-sm text-foreground">Consolidated Risk View</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Risk roll-up across all entities — highest-risk-wins rule applies
        </p>
      </div>

      {/* Entity Risk Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/40 border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
              <th className="text-left px-4 py-3">Entity</th>
              <th className="text-left px-4 py-3">Type</th>
              <th className="text-left px-4 py-3">Role</th>
              <th className="text-left px-4 py-3">Indicators Scored</th>
              <th className="text-left px-4 py-3">Highest Score</th>
              <th className="text-left px-4 py-3">Classification</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {entitySummaries.map(e => (
              <tr key={e.key} className={cn('hover:bg-muted/20', e.highest === 'Unacceptable' && 'bg-red-950/5')}>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    {e.type?.startsWith('ORG') ? <Building2 className="w-3.5 h-3.5 text-blue-500" /> : <User className="w-3.5 h-3.5 text-violet-500" />}
                    <span className="text-xs font-medium">{e.label}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">{e.type?.replace(/_/g,' ')}</td>
                <td className="px-4 py-3 text-xs text-muted-foreground">{e.role || (e.key === 'client' ? 'Primary Client' : 'Related Party')}</td>
                <td className="px-4 py-3 text-xs font-medium">{e.indicatorCount}</td>
                <td className="px-4 py-3">
                  {e.highest ? (
                    <span className={cn('text-xs font-semibold px-2 py-0.5 rounded-full border', RISK_COLORS[e.highest]?.badge)}>
                      {e.highest}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">Not scored</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {e.highest ? (
                    <div className="flex items-center gap-1.5">
                      <span className={cn('w-2 h-2 rounded-full', RISK_COLORS[e.highest]?.dot)} />
                      <span className={cn('text-xs font-semibold', RISK_COLORS[e.highest]?.text)}>{e.highest}</span>
                      {e.highest === 'Unacceptable' && <AlertTriangle className="w-3.5 h-3.5 text-red-400" />}
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground italic">Pending</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Consolidated Banner */}
      <div className={cn(
        'rounded-xl border-2 p-6',
        finalConsolidated
          ? (RISK_COLORS[finalConsolidated]?.border + ' ' + RISK_COLORS[finalConsolidated]?.bg)
          : 'border-border bg-muted/20'
      )}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-widest opacity-60 mb-2">
              {overrideApplied ? 'Consolidated Risk — Analyst Override' : 'Consolidated Risk Classification'}
            </div>
            <div className={cn('text-3xl font-bold tracking-tight', finalConsolidated ? RISK_COLORS[finalConsolidated]?.text : 'text-muted-foreground')}>
              {finalConsolidated ? `${finalConsolidated.toUpperCase()} RISK` : 'Pending Assessment'}
            </div>
            <div className="text-xs opacity-60 mt-2">
              {consolidated === 'Unacceptable'
                ? '⚠ One or more entities scored Unacceptable — consolidated classification is automatically Unacceptable.'
                : 'Highest-risk-wins rule · Across all entities'
              }
            </div>
            {overrideApplied && (
              <div className="flex items-center gap-1 mt-2 text-xs font-semibold text-amber-700">
                <AlertTriangle className="w-3.5 h-3.5" /> ⚠ Overridden by analyst
              </div>
            )}
          </div>
          {finalConsolidated && !overrideApplied && (
            <button
              onClick={() => setOverrideMode(!overrideMode)}
              className="text-xs font-medium border border-current/40 rounded-lg px-3 py-2 transition-colors hover:bg-black/5 flex-shrink-0"
            >
              {overrideMode ? 'Cancel' : '⚠ Override'}
            </button>
          )}
        </div>

        {overrideMode && (
          <div className="mt-4 pt-4 border-t border-current/20 space-y-3">
            <div className="text-xs font-semibold text-foreground/70 mb-1">Select override classification:</div>
            <div className="flex flex-wrap gap-2">
              {RISK_LEVELS.map(level => (
                <button key={level}
                  onClick={() => setOverrideLevel(level)}
                  className={cn('text-xs px-3 py-1.5 rounded-lg border font-medium transition-all',
                    overrideLevel === level ? cn('border-transparent', RISK_COLORS[level]?.badge) : 'border-current/30 opacity-70 hover:opacity-100'
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
              <span className="text-xs text-muted-foreground">{overrideJust.length}/30</span>
              <Button
                size="sm"
                className="gap-1 text-xs bg-amber-600 hover:bg-amber-700 text-white ml-auto"
                disabled={!overrideLevel || overrideJust.length < 30 || saving}
                onClick={applyOverride}
              >
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <AlertTriangle className="w-3 h-3" />}
                Apply Override
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Proceed Button */}
      <Button
        className="w-full gap-2"
        disabled={!finalConsolidated || proceeding}
        onClick={proceedToControlMeasures}
      >
        {proceeding
          ? <Loader2 className="w-4 h-4 animate-spin" />
          : <ArrowRight className="w-4 h-4" />
        }
        {proceeding ? 'Saving…' : 'Accept Classification → Proceed to Control Measures'}
      </Button>
    </div>
  );
}
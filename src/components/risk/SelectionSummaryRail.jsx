/**
 * SelectionSummaryRail — always-visible right rail for S-090.
 * Shows: total selected, per-entity breakdown, progress, pending-scoring chip.
 */
import React from 'react';
import { User, Building2, BarChart3, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { RISK_COLORS } from '@/lib/riskColors';

const RISK_LEVELS_ORDER = ['Unacceptable', 'High', 'Medium', 'Low'];

function getProposedRisk(allScores) {
  const scores = Object.values(allScores || {}).flatMap(entityScores =>
    Object.values(entityScores || {}).map(a => a?.score).filter(Boolean)
  );
  if (scores.length === 0) return null;
  for (const level of RISK_LEVELS_ORDER) {
    if (scores.includes(level)) return level;
  }
  return null;
}

export default function SelectionSummaryRail({
  entities, selections, totalIndicators, reviewedCount, allScores,
}) {
  const totalSelected = Object.values(selections).flat().length;
  const proposedRisk = getProposedRisk(allScores);
  const progress = Math.round((reviewedCount / Math.max(totalIndicators, 1)) * 100);

  return (
    <div className="space-y-4 sticky top-4">
      {/* Summary card */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-4">
        <div>
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Selection Summary</div>
          <div className="text-2xl font-bold text-foreground">{totalSelected}</div>
          <div className="text-xs text-muted-foreground">indicator{totalSelected !== 1 ? 's' : ''} selected across all entities</div>
        </div>

        {/* Per-entity breakdown */}
        <div className="space-y-2">
          {entities.map(e => {
            const count = (selections[e.key] || []).length;
            const isOrg = e.type?.startsWith('ORG');
            return (
              <div key={e.key} className="flex items-center gap-2">
                <div className={cn(
                  'w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0',
                  isOrg ? 'bg-blue-100 text-blue-600' : 'bg-violet-100 text-violet-600'
                )}>
                  {isOrg ? <Building2 className="w-3 h-3" /> : <User className="w-3 h-3" />}
                </div>
                <span className="text-xs text-foreground flex-1 truncate">{e.label}</span>
                <span className={cn(
                  'text-xs font-semibold px-2 py-0.5 rounded-full',
                  count > 0 ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                )}>
                  {count}
                </span>
              </div>
            );
          })}
        </div>

        {/* Progress */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Review progress</span>
            <span className="text-xs font-semibold text-foreground">{reviewedCount} of {totalIndicators}</span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary/70 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="text-xs text-muted-foreground">{progress}% reviewed</div>
        </div>

        {/* Risk level chip */}
        <div className="pt-1 border-t border-border">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Risk Level</div>
          {proposedRisk ? (
            <span className={cn(
              'inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full border',
              RISK_COLORS[proposedRisk]?.badge
            )}>
              <BarChart3 className="w-3 h-3" />
              {proposedRisk.toUpperCase()}
              <span className="font-normal opacity-70">· from scoring</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border border-border bg-muted/50 text-muted-foreground cursor-default select-none">
              <Clock className="w-3 h-3" />
              Pending scoring
            </span>
          )}
        </div>
      </div>

      {/* Role reminder */}
      <div className="bg-amber-50/60 border border-amber-200/60 rounded-xl p-3 text-xs text-amber-700 leading-relaxed">
        <span className="font-semibold">Tip:</span> Toggle indicators directly on the entity chips. Multiple entities can share an indicator. Confirm when all applicable indicators are reviewed.
      </div>
    </div>
  );
}
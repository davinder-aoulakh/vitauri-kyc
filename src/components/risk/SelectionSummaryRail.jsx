/**
 * SelectionSummaryRail — right rail for S-090 indicator picker.
 * Mockup-aligned: Editing For dropdown → Case Risk Preview → Confirm button → tip note.
 */
import React from 'react';
import { User, Building2, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { RISK_COLORS } from '@/lib/riskColors';

const RISK_LEVELS_ORDER = ['Unacceptable', 'High', 'Medium', 'Low'];

const RISK_PREVIEW_STYLES = {
  Low:          { bg: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-700', dot: 'bg-emerald-500', label: 'Low' },
  Medium:       { bg: 'bg-amber-50 border-amber-200',    text: 'text-amber-700',    dot: 'bg-amber-500',   label: 'Medium' },
  High:         { bg: 'bg-red-50 border-red-200',        text: 'text-red-700',      dot: 'bg-red-500',     label: 'High' },
  Unacceptable: { bg: 'bg-rose-50 border-rose-300',      text: 'text-rose-800',     dot: 'bg-rose-700',    label: 'Unacceptable' },
};

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
  activeEntityKey, onActiveEntityChange, onConfirm,
}) {
  const totalSelected = Object.values(selections).flat().length;
  const proposedRisk = getProposedRisk(allScores);
  const riskStyle = proposedRisk ? RISK_PREVIEW_STYLES[proposedRisk] : null;

  // Active entity for "Editing Indicators For"
  const activeEntity = entities.find(e => e.key === activeEntityKey) || entities[0];
  const activeCount = activeEntity ? (selections[activeEntity.key] || []).length : 0;

  return (
    <div className="space-y-3 sticky top-4">

      {/* Editing Indicators For: one row per relation (client + related parties); click to switch */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-2.5">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Editing Indicators For
        </div>
        <div className="space-y-1.5">
          {entities.map(e => {
            const count = (selections[e.key] || []).length;
            const active = e.key === activeEntity?.key;
            const single = entities.length === 1;
            return (
              <button
                key={e.key}
                type="button"
                title={e.label}
                aria-pressed={active}
                disabled={single}
                onClick={() => onActiveEntityChange?.(e.key)}
                className={cn(
                  'w-full grid grid-cols-[auto_1fr] gap-x-2.5 gap-y-1.5 items-start text-left px-3 py-2.5 rounded-lg border transition-colors',
                  active ? 'bg-primary/5 border-primary/30' : 'bg-muted/20 border-border hover:bg-muted/50',
                  single && 'cursor-default'
                )}
              >
                <div className={cn(
                  'w-6 h-6 rounded-full flex items-center justify-center mt-0.5',
                  e.type?.startsWith('ORG') ? 'bg-blue-100 text-blue-600' : 'bg-violet-100 text-violet-600'
                )}>
                  {e.type?.startsWith('ORG') ? <Building2 className="w-3 h-3" /> : <User className="w-3 h-3" />}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground leading-snug line-clamp-2 break-words">{e.label}</div>
                  {e.role && <div className="text-[11px] text-muted-foreground truncate">{e.role}</div>}
                </div>
                <div className="col-start-2">
                  <span className={cn(
                    'inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full',
                    count > 0 ? 'text-primary bg-primary/10' : 'text-muted-foreground bg-muted'
                  )}>
                    {count} selected
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Case Risk Preview */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Case Risk Preview
        </div>

        {riskStyle ? (
          <div className={cn('flex items-center gap-2.5 px-3 py-2.5 rounded-lg border', riskStyle.bg)}>
            <div className={cn('w-2.5 h-2.5 rounded-full flex-shrink-0', riskStyle.dot)} />
            <div>
              <div className="text-xs text-muted-foreground">Preliminary level</div>
              <div className={cn('text-sm font-bold', riskStyle.text)}>{riskStyle.label}</div>
            </div>
            <CheckCircle className={cn('w-4 h-4 ml-auto flex-shrink-0', riskStyle.text)} />
          </div>
        ) : (
          <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-border bg-muted/30">
            <div className="w-2.5 h-2.5 rounded-full bg-muted-foreground/30 flex-shrink-0" />
            <div>
              <div className="text-xs text-muted-foreground">Preliminary level</div>
              <div className="text-sm font-bold text-muted-foreground">—</div>
            </div>
          </div>
        )}

        <div className="text-xs text-muted-foreground">
          {totalSelected === 0
            ? 'No indicators selected yet'
            : `${totalSelected} indicator${totalSelected !== 1 ? 's' : ''} selected across all entities`
          }
        </div>

        {/* Confirm button */}
        <Button
          className="w-full gap-2 text-sm"
          disabled={totalSelected === 0}
          onClick={onConfirm}
        >
          <CheckCircle className="w-4 h-4" />
          Confirm selection ({totalSelected})
        </Button>

        <p className="text-[11px] text-muted-foreground leading-relaxed">
          {entities.length > 1 ? 'Selections are kept per relation; pick a relation above to edit its indicators.' : 'Next: score each selected indicator in Relation View.'}
        </p>
      </div>

      {/* Tip */}
      <div className="bg-amber-50/60 border border-amber-200/60 rounded-xl p-3 text-xs text-amber-700 leading-relaxed">
        <span className="font-semibold">Tip:</span> Toggle indicators directly on the entity toggles. Multiple entities can share an indicator. Confirm when all applicable indicators are reviewed.
      </div>
    </div>
  );
}
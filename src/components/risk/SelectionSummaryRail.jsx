/**
 * SelectionSummaryRail — right rail for S-090 indicator picker.
 * Mockup-aligned: Editing For dropdown → Case Risk Preview → Confirm button → tip note.
 */
import React from 'react';
import { User, Building2, Clock, ChevronDown, CheckCircle } from 'lucide-react';
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

      {/* Editing Indicators For */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Editing Indicators For
        </div>

        {/* Entity dropdown */}
        <div className="relative">
          <select
            value={activeEntity?.key || ''}
            onChange={e => onActiveEntityChange?.(e.target.value)}
            className="w-full appearance-none bg-muted/40 border border-border rounded-lg px-3 py-2 text-sm font-medium text-foreground pr-8 focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {entities.map(e => (
              <option key={e.key} value={e.key}>{e.label}</option>
            ))}
          </select>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
        </div>

        {/* Active entity count row */}
        {activeEntity && (
          <div className={cn(
            'flex items-center justify-between px-3 py-2 rounded-lg border text-xs',
            activeCount > 0 ? 'bg-primary/5 border-primary/20' : 'bg-muted/30 border-border'
          )}>
            <div className="flex items-center gap-2">
              <div className={cn(
                'w-5 h-5 rounded-full flex items-center justify-center',
                activeEntity.type?.startsWith('ORG') ? 'bg-blue-100 text-blue-600' : 'bg-violet-100 text-violet-600'
              )}>
                {activeEntity.type?.startsWith('ORG')
                  ? <Building2 className="w-2.5 h-2.5" />
                  : <User className="w-2.5 h-2.5" />
                }
              </div>
              <span className="font-medium text-foreground truncate max-w-[120px]">{activeEntity.label}</span>
            </div>
            <span className={cn(
              'font-bold px-2 py-0.5 rounded-full',
              activeCount > 0 ? 'text-primary bg-primary/10' : 'text-muted-foreground bg-muted'
            )}>
              {activeCount} selected
            </span>
          </div>
        )}
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
          Confirm Selection ({totalSelected})
        </Button>

        <p className="text-xs text-muted-foreground leading-relaxed">
          Selections are scoped per entity. Switch entities above to review related parties or organisation clients in the same case.
        </p>
      </div>

      {/* Tip */}
      <div className="bg-amber-50/60 border border-amber-200/60 rounded-xl p-3 text-xs text-amber-700 leading-relaxed">
        <span className="font-semibold">Tip:</span> Toggle indicators directly on the entity toggles. Multiple entities can share an indicator. Confirm when all applicable indicators are reviewed.
      </div>
    </div>
  );
}
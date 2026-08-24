/**
 * IndicatorCard — single risk indicator card in the S-090 picker.
 * Props:
 *   indicator   — { indicator_id, name, description, applies[] }
 *   entities    — [{ key, label, type }]
 *   selections  — { entityKey: [indicatorId] }
 *   onToggle(entityKey, indicatorId)
 *   aiBadges    — { entityKey: { reason, dismissed } } | null
 *   onDismissAiBadge(entityKey, indicatorId)
 */
import React, { useState } from 'react';
import { Sparkles, X, User, Building2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const ENTITY_TYPE_COLORS = {
  NP_Client:          'bg-violet-100 text-violet-700 border-violet-200',
  ORG_Client:         'bg-blue-100 text-blue-700 border-blue-200',
  NP_Related_Party:   'bg-amber-100 text-amber-700 border-amber-200',
  ORG_Related_Party:  'bg-teal-100 text-teal-700 border-teal-200',
};

function EntityToggle({ entity, indicatorId, indicatorName, selected, onToggle }) {
  const isOrg = entity.type?.startsWith('ORG');
  const colorClass = ENTITY_TYPE_COLORS[entity.type] || 'bg-muted text-muted-foreground border-border';

  return (
    <button
      role="switch"
      aria-checked={selected}
      aria-label={`Toggle ${indicatorName} for ${entity.label}`}
      onClick={() => onToggle(entity.key, indicatorId)}
      className={cn(
        'inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full border font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected
          ? 'bg-primary text-primary-foreground border-primary shadow-sm'
          : cn('hover:border-primary/40', colorClass)
      )}
    >
      {isOrg ? <Building2 className="w-2.5 h-2.5 flex-shrink-0" /> : <User className="w-2.5 h-2.5 flex-shrink-0" />}
      <span className="max-w-[100px] truncate">{entity.label}</span>
      {/* Visual toggle indicator */}
      <span className={cn(
        'w-3.5 h-2 rounded-full flex-shrink-0 transition-colors border',
        selected ? 'bg-white/70 border-white/40' : 'bg-current/20 border-current/30'
      )} />
    </button>
  );
}

export default function IndicatorCard({ indicator, entities, selections, onToggle, aiBadges, onDismissAiBadge }) {
  const { indicator_id, name, description, applies } = indicator;

  // Only show entity chips for entities whose type is in indicator.applies
  const relevantEntities = entities.filter(e => applies.includes(e.type));

  // Is any entity selected for this indicator?
  const anySelected = relevantEntities.some(e => (selections[e.key] || []).includes(indicator_id));

  return (
    <div className={cn(
      'bg-card border rounded-xl px-4 py-3 space-y-2.5 transition-colors',
      anySelected ? 'border-primary/30 bg-primary/[0.02]' : 'border-border hover:border-border/80'
    )}>
      {/* Title row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-foreground">{name}</div>
          <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{description}</div>
        </div>
        {anySelected && (
          <span className="flex-shrink-0 w-2 h-2 rounded-full bg-primary mt-1.5" aria-label="Selected" />
        )}
      </div>

      {/* Entity toggle chips */}
      {relevantEntities.length > 0 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={`Entity selection for ${name}`}>
          {relevantEntities.map(entity => (
            <EntityToggle
              key={entity.key}
              entity={entity}
              indicatorId={indicator_id}
              indicatorName={name}
              selected={(selections[entity.key] || []).includes(indicator_id)}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}

      {/* AI badges */}
      {aiBadges && Object.entries(aiBadges).map(([entityKey, badge]) => {
        if (badge.dismissed) return null;
        const entity = entities.find(e => e.key === entityKey);
        if (!entity) return null;
        return (
          <div key={entityKey} className="flex items-start gap-2 bg-purple-50 border border-purple-200 rounded-lg px-2.5 py-2">
            <Sparkles className="w-3 h-3 text-purple-500 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <span className="text-xs text-purple-700 font-medium">{entity.label}: </span>
              <span className="text-xs text-purple-700">{badge.reason}</span>
            </div>
            <button
              onClick={() => onDismissAiBadge(entityKey, indicator_id)}
              className="text-purple-400 hover:text-purple-600 flex-shrink-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-purple-400 rounded"
              aria-label={`Dismiss AI suggestion for ${name} on ${entity.label}`}
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
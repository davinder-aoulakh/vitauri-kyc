/**
 * IndicatorCard — single risk indicator row in the S-090 picker.
 * Mockup-aligned: colored dot, name/description, entity-scope tags, AI badge, per-entity toggle switches.
 */
import React from 'react';
import { Switch } from '@/components/ui/switch';
import { Sparkles, X } from 'lucide-react';
import { cn } from '@/lib/utils';

// Severity dot color per indicator (heuristic by canonical id)
const INDICATOR_DOT = {
  geo:        'bg-red-500',
  sector:     'bg-orange-500',
  cash:       'bg-orange-400',
  pep:        'bg-red-600',
  sanctions:  'bg-red-500',
  pep_rp:     'bg-red-500',
  ownership:  'bg-orange-500',
  opaque:     'bg-orange-400',
  txn:        'bg-amber-500',
  sof:        'bg-amber-500',
  nftf:       'bg-blue-400',
  introducer: 'bg-blue-400',
};

const ENTITY_TAG_COLORS = {
  NP_Client:         'bg-violet-50 text-violet-700 border-violet-200',
  ORG_Client:        'bg-blue-50 text-blue-700 border-blue-200',
  NP_Related_Party:  'bg-amber-50 text-amber-700 border-amber-200',
  ORG_Related_Party: 'bg-teal-50 text-teal-700 border-teal-200',
};

const ENTITY_TAG_LABELS = {
  NP_Client:         'NP Client',
  ORG_Client:        'ORG Client',
  NP_Related_Party:  'NP Related Party',
  ORG_Related_Party: 'ORG Related Party',
};

export default function IndicatorCard({ indicator, entities, selections, onToggle, aiBadges, onDismissAiBadge }) {
  const { indicator_id, name, description, applies } = indicator;
  const dotColor = INDICATOR_DOT[indicator_id] || 'bg-slate-400';

  // Entities relevant to this indicator
  const relevantEntities = entities.filter(e => (applies || []).includes(e.type));

  // Unique entity types this indicator applies to (for scope tags)
  const applicableTypes = [...new Set(applies || [])];

  return (
    <div className="bg-card border border-border rounded-xl px-4 py-3.5 space-y-3 transition-colors hover:border-border/80">
      {/* Title row */}
      <div className="flex items-start gap-3">
        {/* Severity dot */}
        <span className={cn('w-2.5 h-2.5 rounded-full flex-shrink-0 mt-1', dotColor)} />

        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-foreground">{name}</div>
          <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{description}</div>

          {/* Scope tags */}
          <div className="flex flex-wrap gap-1 mt-2">
            {applicableTypes.map(type => (
              <span
                key={type}
                className={cn('text-xs px-1.5 py-0.5 rounded border font-medium', ENTITY_TAG_COLORS[type] || 'bg-muted text-muted-foreground border-border')}
              >
                {ENTITY_TAG_LABELS[type] || type.replace(/_/g, ' ')}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Per-entity toggle switches */}
      {relevantEntities.length > 0 && (
        <div className="space-y-1.5 pl-5">
          {relevantEntities.map(entity => {
            const selected = (selections[entity.key] || []).includes(indicator_id);
            const hasBadge = aiBadges?.[entity.key] && !aiBadges[entity.key].dismissed;
            return (
              <div key={entity.key} className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs text-foreground truncate font-medium">{entity.label}</span>
                  {hasBadge && (
                    <span className="inline-flex items-center gap-0.5 text-xs bg-purple-50 text-purple-600 border border-purple-200 px-1.5 py-0.5 rounded-full font-medium">
                      <Sparkles className="w-2.5 h-2.5" />
                      AI suggests
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {hasBadge && (
                    <button
                      onClick={() => onDismissAiBadge(entity.key, indicator_id)}
                      className="text-purple-400 hover:text-purple-600"
                      aria-label="Dismiss AI suggestion"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                  <Switch
                    checked={selected}
                    onCheckedChange={() => onToggle(entity.key, indicator_id)}
                    aria-label={`Toggle ${name} for ${entity.label}`}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* AI badge reason (if dismissed=false and has reason text) */}
      {aiBadges && Object.entries(aiBadges).map(([entityKey, badge]) => {
        if (badge.dismissed || !badge.reason) return null;
        const entity = entities.find(e => e.key === entityKey);
        if (!entity) return null;
        return (
          <div key={entityKey} className="ml-5 flex items-start gap-2 bg-purple-50 border border-purple-100 rounded-lg px-2.5 py-2">
            <Sparkles className="w-3 h-3 text-purple-500 flex-shrink-0 mt-0.5" />
            <span className="text-xs text-purple-700 leading-relaxed">
              <span className="font-medium">{entity.label}: </span>
              {badge.reason}
            </span>
          </div>
        );
      })}
    </div>
  );
}
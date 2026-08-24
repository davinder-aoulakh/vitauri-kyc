/**
 * IndicatorCategoryGroup — collapsible category section wrapping IndicatorCards.
 */
import React, { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import IndicatorCard from '@/components/risk/IndicatorCard';

const CATEGORY_ICONS = {
  'Geography & Sector':               '🌍',
  'PEP & Sanctions':                  '🚨',
  'Ownership & Structure':            '🏛',
  'Transaction & Financial Behaviour':'💸',
  'Relationship & Onboarding':        '🤝',
};

export default function IndicatorCategoryGroup({
  category, indicators, entities, selections, onToggle,
  aiBadges, onDismissAiBadge,
}) {
  const [collapsed, setCollapsed] = useState(false);

  // Live count: number of indicators in this category that have at least one entity selected
  const selectedCount = indicators.filter(ind =>
    entities.some(e => (selections[e.key] || []).includes(ind.indicator_id))
  ).length;

  return (
    <div className="rounded-xl border border-border overflow-hidden">
      {/* Category header */}
      <button
        className="w-full flex items-center gap-3 px-4 py-3 bg-muted/30 hover:bg-muted/50 transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        onClick={() => setCollapsed(c => !c)}
        aria-expanded={!collapsed}
        aria-controls={`category-${category}`}
      >
        <span className="text-base leading-none">{CATEGORY_ICONS[category] || '📋'}</span>
        <span className="font-semibold text-sm text-foreground flex-1">{category}</span>
        {selectedCount > 0 && (
          <span className="text-xs font-semibold bg-primary/10 text-primary border border-primary/20 px-2 py-0.5 rounded-full">
            {selectedCount} selected
          </span>
        )}
        <span className="text-xs text-muted-foreground">{indicators.length} indicators</span>
        {collapsed
          ? <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          : <ChevronUp className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        }
      </button>

      {/* Cards */}
      {!collapsed && (
        <div id={`category-${category}`} className="divide-y divide-border/60">
          {indicators.map(ind => (
            <div key={ind.indicator_id} className="px-3 py-2.5">
              <IndicatorCard
                indicator={ind}
                entities={entities}
                selections={selections}
                onToggle={onToggle}
                aiBadges={aiBadges?.[ind.indicator_id] || null}
                onDismissAiBadge={onDismissAiBadge}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
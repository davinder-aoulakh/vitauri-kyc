import React from 'react';
import { FILTERS } from '@/lib/tmAlerts';
import { cn } from '@/lib/utils';

export default function AlertFilters({ value, onChange }) {
  return (
    <div className="flex flex-wrap gap-2 mb-4" role="tablist" aria-label="Alert filters">
      {FILTERS.map((f) => (
        <button
          key={f.key}
          role="tab"
          aria-selected={value === f.key}
          onClick={() => onChange(f.key)}
          className={cn(
            'px-3.5 py-1.5 rounded-full text-xs font-medium border transition-colors',
            value === f.key ? 'bg-primary text-primary-foreground border-primary' : 'bg-card text-muted-foreground border-border hover:text-foreground'
          )}
        >
          {f.label}
        </button>
      ))}
    </div>
  );
}
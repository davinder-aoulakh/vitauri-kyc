import React from 'react';
import { cn } from '@/lib/utils';

const TONE = {
  green: 'bg-emerald-500',
  lightgreen: 'bg-emerald-300',
  amber: 'bg-amber-400',
  red: 'bg-red-500',
  none: 'bg-muted',
};

export default function CoverageStrip({ cells }) {
  return (
    <div className="flex gap-[2px]" role="img" aria-label="Coverage for the last 30 days">
      {cells.map((c) => (
        <span
          key={c.date}
          title={`${c.date} · ${c.label}`}
          className={cn('h-5 w-2 rounded-[2px] flex-shrink-0', TONE[c.tone])}
        />
      ))}
    </div>
  );
}

export function CoverageLegend() {
  const items = [['bg-emerald-500', 'Reviewed / processed'], ['bg-amber-400', 'Awaiting'], ['bg-red-500', 'Missing'], ['bg-muted', 'Not expected']];
  return (
    <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
      {items.map(([cls, label]) => (
        <span key={label} className="flex items-center gap-1.5"><span className={cn('h-3 w-3 rounded-[2px]', cls)} />{label}</span>
      ))}
    </div>
  );
}
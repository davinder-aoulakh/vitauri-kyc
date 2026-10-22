import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { Activity, ClipboardCheck, FileText, Gavel, Zap } from 'lucide-react';
import EmptyState from '@/components/shared/EmptyState';
import { cn } from '@/lib/utils';

// Kinds come from the getCustomerFile timeline: kyc | tm | fiu | decision | trigger.
const ICONS = { kyc: ClipboardCheck, tm: Activity, fiu: FileText, decision: Gavel, trigger: Zap };
const FILTERS = [
  { key: 'all', label: 'All', kinds: null },
  { key: 'kyc', label: 'KYC', kinds: ['kyc'] },
  { key: 'tm', label: 'TM', kinds: ['tm', 'trigger'] },
  { key: 'fiu', label: 'FIU', kinds: ['fiu'] },
  { key: 'decision', label: 'Decisions', kinds: ['decision'] },
];

export default function MonitoringTimeline({ items = [] }) {
  const [filter, setFilter] = useState('all');
  const kinds = FILTERS.find((f) => f.key === filter)?.kinds;
  const shown = kinds ? items.filter((it) => kinds.includes(it.kind)) : items;

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Timeline</h3>
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={cn('rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors',
                filter === f.key ? 'border-primary bg-primary text-white' : 'border-border bg-background text-muted-foreground hover:bg-muted')}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      {shown.length === 0 ? <EmptyState title="No events yet" /> : (
        <ul className="max-h-96 space-y-3 overflow-y-auto pr-1">
          {shown.map((it, i) => {
            const Icon = ICONS[it.kind] || Activity;
            const title = <span className="font-medium text-foreground">{it.title}</span>;
            return (
              <li key={i} className="flex gap-3">
                <div className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-muted"><Icon className="h-3.5 w-3.5 text-muted-foreground" /></div>
                <div className="min-w-0 text-xs">
                  {it.link ? <Link to={it.link} className="hover:underline">{title}</Link> : title}
                  {it.detail && <div className="truncate text-muted-foreground">{String(it.detail).replace(/_/g, ' ')}</div>}
                  <div className="text-[11px] text-muted-foreground">{format(new Date(it.at), 'd MMM yyyy HH:mm')}</div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
